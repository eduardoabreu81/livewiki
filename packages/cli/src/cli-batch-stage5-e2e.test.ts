/**
 * CLI E2E — Lot S3b: batch stage 5 (semantic product flows) end to end.
 *
 * Mirrors the stub-HTTP-server pattern of cli-batch-e2e.test.ts (fixture
 * repo in a temp dir, in-process stub LLM, real CLI subprocess). The
 * fixture is a small TS project whose module heuristic yields exactly
 * three product modules with one detectable flow:
 *
 *   src/cli/cli.ts      (entry: in-degree 0 AND matches the cli.* entry pattern)
 *     └── imports ../core/engine.js   (NodeNext specifier, FIX K)
 *   src/core/engine.ts
 *     └── imports ../db/db.js
 *   src/db/db.ts        (persistence: matches the db.* persistence pattern)
 *
 * Expected detection: one candidate `cli-to-db`, moduleIds [cli, core, db].
 *
 * Scenarios:
 *   1. `init --batch` happy path — flow page with the on-disk placeholder
 *      (never the inline diagram), companion .mmd with the real diagram,
 *      the full navigation surface (hub, gated quickstart link, overview
 *      `## Flows`, `Flow:` lines in participating module Navigate blocks),
 *      verify zero issues, stage-5 task visible in `batch status --json`,
 *      and `batch --only flow:cli-to-db <runId>` rerunning the single flow
 *      with monotonically growing usage. Verify stays clean after it all.
 *   2. `maxFlows: 0` — run completes, no flows/ directory, no flow-*
 *      diagram, no quickstart "How it works" link, verify clean.
 *   3. Diagram budget — a stub flow response whose inline diagram exceeds
 *      the configured node budget gets a repair round; the repaired page
 *      and the shrunken diagram land correctly.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import * as http from "node:http";
import * as nodePath from "node:path";
import * as nodeOs from "node:os";
import * as nodeFs from "node:fs/promises";

interface StubServer {
  url: string;
  close: () => Promise<void>;
  setHandler: (h: (req: { system: string; user: string }) => StubResponse | null) => void;
  callCount: () => number;
}

interface StubResponse {
  status: number;
  body: unknown;
}

async function startStubServer(): Promise<StubServer> {
  let handler: (req: { system: string; user: string }) => StubResponse | null = () => null;
  let calls = 0;

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      calls++;
      let parsed: { system?: string; user?: string; messages?: Array<{ role: string; content: string }> } = {};
      try {
        parsed = JSON.parse(body);
      } catch {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "invalid json" }));
        return;
      }
      // Anthropic-shape: { system, messages: [{role:"user", content}] }
      // OpenAI-shape:  { messages: [{role:"system", content}, {role:"user", content}] }
      type ChatMsg = { role: string; content: string };
      const msgs = (parsed.messages ?? []) as ChatMsg[];
      const system = parsed.system ?? msgs.find((m) => m.role === "system")?.content ?? "";
      const user = msgs.filter((m) => m.role === "user").map((m) => m.content).join("\n") ?? parsed.user ?? "";

      const response = handler({ system, user });
      if (!response) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: "no handler configured" }));
        return;
      }
      res.writeHead(response.status, { "content-type": "application/json" });
      res.end(JSON.stringify(response.body));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("failed to bind stub server");
  const url = `http://127.0.0.1:${addr.port}`;

  return {
    url,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
    setHandler: (h) => {
      handler = h;
    },
    callCount: () => calls,
  };
}

/** Extract closed-list keys from any stage-4 / stage-5 user prompt. */
function closedKeysFromPrompt(user: string): string[] {
  const keys: string[] = [];
  for (const line of user.split("\n")) {
    const m = /^- (\S+#\S+)$/.exec(line);
    if (m?.[1]) keys.push(m[1]);
  }
  return keys;
}

/**
 * Stage 5c (roadmap item 23): the mandatory understanding task. Its prompt
 * carries `# Output: livewiki/understanding.md`; answer with a strict-contract
 * page (owner: generated, one H1, one 40–600-char purpose paragraph, no
 * anchors, no inline code, no links).
 */
const UNDERSTANDING_PAGE = `---
title: Test repository
owner: generated
kind: understanding
---

# Test repository

This test repository exercises the batch pipeline with a small product surface.
`;

/** Valid stage-4 module page (same response strategy as cli-batch-e2e). */
function modulePageHandler(req: { system: string; user: string }): StubResponse {
  if (req.user.includes("# Output: livewiki/understanding.md")) {
    return {
      status: 200,
      body: {
        content: [{ type: "text", text: UNDERSTANDING_PAGE }],
        model: "claude-test-mock",
        usage: { input_tokens: 100, output_tokens: 50 },
      },
    };
  }
  const moduleId = req.user.match(/# Module: ([^\s]+)/)?.[1] ?? "unknown";
  const closedKeys = closedKeysFromPrompt(req.user);
  const fmAnchors = closedKeys.map((k) => `  - ${k}`).join("\n");
  const displayTitle = `${moduleId.replace(/-/g, " ")} responsibilities`;
  const content = `---
title: ${displayTitle}
owner: generated
anchors:
${fmAnchors}
---

# ${displayTitle}

This page documents the indexed responsibilities of ${moduleId}.

## When to use this page

- Review ${moduleId} behavior.
- Change ${moduleId} implementation.

## How it fits

This module provides one part of the repository implementation visible in the supplied source.

## Details
<!-- lw:anchors ${closedKeys.join(" ")} -->

Some prose about ${moduleId}.
`;
  return {
    status: 200,
    body: {
      content: [{ type: "text", text: content }],
      model: "claude-test-mock",
      usage: { input_tokens: 100, output_tokens: 50 },
    },
  };
}

interface FlowPromptCtx {
  slug: string;
  moduleIds: string[];
  closedKeys: string[];
}

/** Parse the stage-5 (initial or repair) user prompt. */
function parseFlowPrompt(user: string): FlowPromptCtx {
  const slug = /^# Flow: (\S+)$/m.exec(user)?.[1] ?? "unknown-flow";
  const modulesLine = /^# Participating modules .*: (.+)$/m.exec(user)?.[1] ?? "";
  const moduleIds = modulesLine
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return { slug, moduleIds, closedKeys: closedKeysFromPrompt(user) };
}

const FLOW_TITLE = "CLI to database flow";

/**
 * Valid stage-5 flow page in the MODEL-EMITTED form. Priority-0 fix
 * (2026-07-22): the LLM no longer writes anything about `## Diagram` —
 * the orchestrator generates and inserts it deterministically. Dual
 * completeness: every closed key appears exactly once in frontmatter and
 * exactly once across the section markers (first key in `Purpose`,
 * second in `Ordered flow`, the rest in `Failure and recovery` — every
 * marker-carrying flow section holds at least one marker, R10.1 D).
 * `diagramSource` is unused (kept for call-site compat).
 */
function makeFlowPage(ctx: FlowPromptCtx, _diagramSource: string): string {
  const [firstKey, secondKey, ...restKeys] = ctx.closedKeys;
  return [
    "---",
    `title: ${FLOW_TITLE}`,
    "owner: generated",
    "anchors:",
    ...ctx.closedKeys.map((k) => `  - ${k}`),
    "modules:",
    ...ctx.moduleIds.map((m) => `  - ${m}`),
    "updated: 2026-07-18",
    "---",
    "",
    `# ${FLOW_TITLE}`,
    "",
    "This page explains how the CLI drives the engine down to the database end to end.",
    "",
    "## Purpose",
    "",
    ...(firstKey ? [`<!-- lw:anchors ${firstKey} -->`, ""] : []),
    "A CLI invocation starts the flow and the database module persists the produced record.",
    "",
    "## Ordered flow",
    "",
    ...(secondKey ? [`<!-- lw:anchors ${secondKey} -->`, ""] : []),
    "1. The CLI parses the invocation and calls the engine.",
    "2. The engine builds the plan and asks the database to persist it.",
    "3. The database stores the record and returns it to the caller.",
    "",
    "## Invariants",
    "",
    "- Every step preserves the invocation payload.",
    "",
    "## Failure and recovery",
    "",
    ...(restKeys.length > 0 ? [`<!-- lw:anchors ${restKeys.join(" ")} -->`, ""] : []),
    "The supplied source shows no retry or rollback path; the flow fails open.",
    "",
    "## Related pages",
    "",
    ...ctx.moduleIds.map((m) => `- [${m} module](../${m}.md)`),
    "- [How it works](index.md)",
    "",
  ].join("\n");
}

interface CliRun {
  status: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], env: Record<string, string> = {}): Promise<CliRun> {
  return new Promise((resolve) => {
    const opts: SpawnOptions = { env: { ...process.env, ...env } };
    const proc: ChildProcess = spawn(
      process.execPath,
      [nodePath.resolve(process.cwd(), "dist/index.js"), ...args],
      opts,
    );
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (d: Buffer | string) => (stdout += typeof d === "string" ? d : d.toString("utf8")));
    proc.stderr?.on("data", (d: Buffer | string) => (stderr += typeof d === "string" ? d : d.toString("utf8")));
    proc.on("close", (code: number | null) => resolve({ status: code ?? -1, stdout, stderr }));
  });
}

let stub: StubServer;
let repoRoot: string;

beforeAll(async () => {
  stub = await startStubServer();
});

afterAll(async () => {
  await stub.close();
});

beforeEach(async () => {
  repoRoot = await nodeFs.mkdtemp(
    nodePath.join(nodeOs.tmpdir(), "livewiki-e2e-s3b-"),
  );
});

afterEach(async () => {
  await nodeFs.rm(repoRoot, { recursive: true, force: true });
});

const FLOW_SLUG = "cli-to-db";
const FLOW_TARGET = `flow:${FLOW_SLUG}`;
const FLOW_PAGE_PATH = `livewiki/flows/${FLOW_SLUG}.md`;
const FLOW_DIAGRAM_PATH = `livewiki/diagrams/flow-${FLOW_SLUG}.mmd`;
const FLOW_PLACEHOLDER = `%% livewiki/diagrams/flow-${FLOW_SLUG}.mmd`;
const REAL_DIAGRAM = "flowchart LR\n  cli --> core\n  core --> db";

/** The three-module fixture with the detectable cli → core → db flow. */
async function writeFlowRepo(): Promise<void> {
  await writeCode(
    "src/cli/cli.ts",
    [
      'import { runEngine } from "../core/engine.js";',
      "",
      "export function main(): string {",
      "  return runEngine();",
      "}",
      "",
      "export function parseArgs(args: string[]): string[] {",
      "  return args;",
      "}",
      "",
    ].join("\n"),
  );
  await writeCode(
    "src/core/engine.ts",
    [
      'import { saveRecord } from "../db/db.js";',
      "",
      "export function runEngine(): string {",
      '  return saveRecord("result");',
      "}",
      "",
      "export function buildPlan(): string {",
      '  return "plan";',
      "}",
      "",
    ].join("\n"),
  );
  await writeCode(
    "src/db/db.ts",
    [
      "export function saveRecord(value: string): string {",
      "  return value;",
      "}",
      "",
      "export function openDatabase(): string {",
      '  return "db";',
      "}",
      "",
    ].join("\n"),
  );
}

async function writeCode(rel: string, content: string): Promise<void> {
  const abs = nodePath.join(repoRoot, rel);
  await nodeFs.mkdir(nodePath.dirname(abs), { recursive: true });
  await nodeFs.writeFile(abs, content);
}

async function writeConfig(extra: Record<string, unknown> = {}): Promise<void> {
  await nodeFs.mkdir(nodePath.join(repoRoot, ".livewiki"), { recursive: true });
  await nodeFs.writeFile(
    nodePath.join(repoRoot, ".livewiki/config.json"),
    JSON.stringify(
      {
        provider: "anthropic",
        model: "claude-test-mock",
        baseUrl: stub.url,
        maxTopics: 0,
        // Roadmap #22: pin the pre-#22 stage-4 format (stub pages emit no
        // Diagram section); #22-on is covered by the core #22 suites.
        moduleDiagrams: false,
        deepHierarchy: false,
        ...extra,
      },
      null,
      2,
    ),
    "utf8",
  );
}

async function readWiki(rel: string): Promise<string> {
  return nodeFs.readFile(nodePath.join(repoRoot, rel), "utf8");
}

async function pathExists(rel: string): Promise<boolean> {
  try {
    await nodeFs.access(nodePath.join(repoRoot, rel));
    return true;
  } catch {
    return false;
  }
}

/** Runs verify and asserts exit 0 + zero issues of any severity. */
async function expectVerifyClean(): Promise<void> {
  const verifyR = await runCli(["--json", "--repo", repoRoot, "verify"]);
  expect(verifyR.status, `verify failed: ${verifyR.stderr}`).toBe(0);
  const verifyReport = JSON.parse(verifyR.stdout) as { ok: boolean; issues: unknown[] };
  expect(
    verifyReport.issues.length,
    `verify reported ${verifyReport.issues.length} issue(s) (expected 0):\n${JSON.stringify(verifyReport.issues, null, 2)}`,
  ).toBe(0);
  expect(verifyReport.ok).toBe(true);
}

interface StatusTask {
  stage: number;
  target: string;
  status: string;
  attempts: number;
  inputTokens: number;
  outputTokens: number;
}

interface StatusReport {
  run: { id: number; status: string };
  totals: { inputTokens: number; outputTokens: number };
  byStage: Record<string, { inputTokens: number; outputTokens: number }>;
  tasks: StatusTask[];
}

async function readStatus(): Promise<StatusReport> {
  const statusR = await runCli(["--json", "--repo", repoRoot, "batch", "status"]);
  expect(statusR.status, `batch status failed: ${statusR.stderr}`).toBe(0);
  return JSON.parse(statusR.stdout) as StatusReport;
}

describe("CLI E2E stage 5 — semantic product flows with stub LLM", () => {
  it("init --batch detects cli-to-db, writes placeholder page + diagram + navigation, --only reruns it", async () => {
    await writeFlowRepo();
    await writeConfig();

    let flowCalls = 0;
    stub.setHandler((req) => {
      if (/^# Flow: \S+$/m.test(req.user)) {
        flowCalls++;
        return {
          status: 200,
          body: {
            content: [{ type: "text", text: makeFlowPage(parseFlowPrompt(req.user), REAL_DIAGRAM) }],
            model: "claude-test-mock",
            usage: { input_tokens: 100, output_tokens: 50 },
          },
        };
      }
      return modulePageHandler(req);
    });

    const env = { ANTHROPIC_API_KEY: "test-canary-stage5" };

    // 1. Full run: exit 0, batch completed, exactly one flow task.
    const initR = await runCli(["--json", "--repo", repoRoot, "init", "--batch"], env);
    expect(initR.status, `init --batch failed: ${initR.stderr}`).toBe(0);
    const initReport = JSON.parse(initR.stdout) as {
      batchSummary: { runId: number; status: string };
      batchExitCode: number;
    };
    expect(initReport.batchSummary.status).toBe("completed");
    expect(initReport.batchExitCode).toBe(0);
    expect(flowCalls).toBe(1);
    const runId = initReport.batchSummary.runId;

    // 2. Flow page carries the on-disk placeholder, never the inline diagram.
    const flowPage = await readWiki(FLOW_PAGE_PATH);
    expect(flowPage).toContain(FLOW_PLACEHOLDER);
    expect(flowPage).not.toContain("flowchart LR");
    expect(flowPage).not.toContain("cli --> core");
    expect(flowPage).toContain("owner: generated");

    // 3. Companion diagram is generated deterministically (Priority-0 fix,
    //    2026-07-22) — the LLM never writes it. A 3-module walk uses
    //    symbol granularity, so node labels are participating symbol names.
    const diagram = await readWiki(FLOW_DIAGRAM_PATH);
    expect(diagram).toContain("flowchart LR");
    expect(diagram).toContain("main");
    expect(diagram).toContain("saveRecord");

    // 4a. Navigation surface: deterministic flows hub.
    const hub = await readWiki("livewiki/flows/index.md");
    expect(hub).toContain("title: How it works");
    expect(hub).toContain(`[${FLOW_TITLE}](${FLOW_SLUG}.md)`);

    // 4b. Quickstart links the hub (existence-gated).
    const quickstart = await readWiki("livewiki/quickstart.md");
    expect(quickstart).toContain("[How it works](flows/index.md)");

    // 4c. Architecture overview gains the Flows section.
    const overview = await readWiki("livewiki/architecture/overview.md");
    expect(overview).toContain("## Flows");
    expect(overview).toContain("[How it works](../flows/index.md)");

    // 4d. Participating module pages link the flow in their Navigate blocks.
    for (const moduleId of ["cli", "core", "db"]) {
      const page = await readWiki(`livewiki/${moduleId}.md`);
      expect(page).toContain("## Navigate");
      expect(page).toContain(`- Flow: [${FLOW_TITLE}](flows/${FLOW_SLUG}.md)`);
    }

    // 4e. Verify: exit 0 + zero issues of any severity repo-wide.
    await expectVerifyClean();

    // 5. Status: the stage-5 task is recorded with known usage.
    const report = await readStatus();
    expect(report.run.status).toBe("completed");
    const flowTask = report.tasks.find((t) => t.stage === 5 && t.target === FLOW_TARGET);
    expect(flowTask, "stage-5 flow task missing from batch status").toBeDefined();
    expect(flowTask!.status).toBe("done");
    expect(flowTask!.inputTokens).toBeGreaterThan(0);
    expect(flowTask!.outputTokens).toBeGreaterThan(0);
    expect(report.byStage["5"]).toBeDefined();
    expect(report.byStage["5"]!.inputTokens).toBeGreaterThan(0);

    // 6. --only flow:<slug> reruns the single flow; usage grows monotonically.
    const totalsBefore = {
      input: report.totals.inputTokens,
      output: report.totals.outputTokens,
    };
    const onlyR = await runCli(
      ["--json", "--repo", repoRoot, "batch", "--only", FLOW_TARGET, String(runId)],
      env,
    );
    expect(onlyR.status, `batch --only failed: ${onlyR.stderr}`).toBe(0);
    const onlyResult = JSON.parse(onlyR.stdout) as { status: string };
    expect(onlyResult.status).toBe("completed");
    expect(flowCalls).toBe(2);

    const reportAfter = await readStatus();
    const flowTaskAfter = reportAfter.tasks.find((t) => t.stage === 5 && t.target === FLOW_TARGET);
    expect(flowTaskAfter).toBeDefined();
    expect(flowTaskAfter!.status).toBe("done");
    expect(flowTaskAfter!.attempts).toBe(2);
    expect(reportAfter.totals.inputTokens).toBeGreaterThan(totalsBefore.input);
    expect(reportAfter.totals.outputTokens).toBeGreaterThan(totalsBefore.output);

    // 7. After the rerun the whole wiki still verifies clean.
    await expectVerifyClean();

    // Key-leak canary: the env-only key never lands in any flow artifact or output.
    for (const content of [flowPage, diagram, hub, onlyR.stdout]) {
      expect(content).not.toContain("test-canary-stage5");
    }
  }, 180_000);

  it("maxFlows: 0 disables stage 5 — run completes, no flow artifacts, verify clean", async () => {
    await writeFlowRepo();
    await writeConfig({ maxFlows: 0 });

    let flowCalls = 0;
    stub.setHandler((req) => {
      if (/^# Flow: \S+$/m.test(req.user)) {
        flowCalls++;
        return {
          status: 200,
          body: {
            content: [{ type: "text", text: makeFlowPage(parseFlowPrompt(req.user), REAL_DIAGRAM) }],
            model: "claude-test-mock",
            usage: { input_tokens: 100, output_tokens: 50 },
          },
        };
      }
      return modulePageHandler(req);
    });

    const initR = await runCli(["--json", "--repo", repoRoot, "init", "--batch"], {
      ANTHROPIC_API_KEY: "test-canary-stage5-off",
    });
    expect(initR.status, `init --batch failed: ${initR.stderr}`).toBe(0);
    const initReport = JSON.parse(initR.stdout) as { batchSummary: { status: string } };
    expect(initReport.batchSummary.status).toBe("completed");

    // Stage 5 never ran: no flow prompt, no flow task rows. Stage 5c's
    // understanding task (roadmap item 23) is stage 5 too — exclude it.
    expect(flowCalls).toBe(0);
    const report = await readStatus();
    expect(report.tasks.filter((t) => t.stage === 5 && t.target.startsWith("flow:"))).toEqual([]);

    // No flow artifacts on disk.
    expect(await pathExists("livewiki/flows")).toBe(false);
    expect(await pathExists(FLOW_DIAGRAM_PATH)).toBe(false);

    // Navigation stays in the no-flows shape.
    const quickstart = await readWiki("livewiki/quickstart.md");
    expect(quickstart).not.toContain("How it works");
    const overview = await readWiki("livewiki/architecture/overview.md");
    expect(overview).not.toContain("## Flows");
    for (const moduleId of ["cli", "core", "db"]) {
      const page = await readWiki(`livewiki/${moduleId}.md`);
      expect(page).not.toContain("- Flow:");
    }

    await expectVerifyClean();
  }, 120_000);

  it("a tight diagram node budget is respected by construction; zero extra LLM calls", async () => {
    // Priority-0 fix (2026-07-22): the diagram is generated deterministically
    // from the FlowCandidate (generateFlowDiagram) and always respects the
    // configured budget from the start — there is no LLM-written diagram
    // left to repair, so a tight budget never costs an extra LLM call.
    await writeFlowRepo();
    await writeConfig({ flowMaxDiagramNodes: 2, flowMaxDiagramEdges: 1 });

    let flowCalls = 0;
    stub.setHandler((req) => {
      if (/^# Flow: \S+$/m.test(req.user)) {
        flowCalls++;
        return {
          status: 200,
          body: {
            content: [
              { type: "text", text: makeFlowPage(parseFlowPrompt(req.user), "unused") },
            ],
            model: "claude-test-mock",
            usage: { input_tokens: 100, output_tokens: 50 },
          },
        };
      }
      return modulePageHandler(req);
    });

    const initR = await runCli(["--json", "--repo", repoRoot, "init", "--batch"], {
      ANTHROPIC_API_KEY: "test-canary-stage5-repair",
    });
    expect(initR.status, `init --batch failed: ${initR.stderr}`).toBe(0);
    const initReport = JSON.parse(initR.stdout) as { batchSummary: { status: string } };
    expect(initReport.batchSummary.status).toBe("completed");

    // ONE attempt total — the diagram costs zero LLM calls either way.
    expect(flowCalls).toBe(1);

    const flowPage = await readWiki(FLOW_PAGE_PATH);
    expect(flowPage).toContain(FLOW_PLACEHOLDER);
    expect(flowPage).not.toContain("flowchart LR");
    const diagram = await readWiki(FLOW_DIAGRAM_PATH);
    expect(diagram).toContain("flowchart LR");
    const nodeTokens = new Set([...diagram.matchAll(/\bn\d+\b/g)].map((m) => m[0]));
    expect(nodeTokens.size).toBeLessThanOrEqual(2);
    const edgeLines = diagram.split("\n").filter((l) => l.includes("-->"));
    expect(edgeLines.length).toBeLessThanOrEqual(1);

    const report = await readStatus();
    const flowTask = report.tasks.find((t) => t.stage === 5 && t.target === FLOW_TARGET);
    expect(flowTask).toBeDefined();
    expect(flowTask!.status).toBe("done");

    await expectVerifyClean();
  }, 120_000);
});
