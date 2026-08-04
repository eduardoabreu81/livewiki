/**
 * batch-understanding.test.ts — roadmap item 23 (repository understanding
 * layer): the stage-5c understanding task wired into the batch pipeline.
 *
 * Regression contracts covered here:
 *
 *   - happy path: ONE understanding task after flows/topics, page on disk,
 *     usage recorded under an `understanding:<hash>` target, verify clean,
 *     the quickstart prefers the synthesis with provenance, the README is
 *     quoted as evidence, and the prompt carries the closed inventory;
 *   - a contract violation (code span claiming a symbol) is rejected and
 *     the bounded repair round converges;
 *   - persistent violations exhaust the repair budget: the task fails, the
 *     run continues (module tasks still done), and NOTHING was persisted
 *     (transactional write rolled back);
 *   - idempotence: resuming with unchanged evidence makes ZERO new
 *     understanding LLM calls (checkpoint reuse like the topic planner);
 *   - `--only understanding` reruns the task with monotonic usage;
 *   - owner: human on the synthesis page is refused (rule #6) and
 *     preserved byte-for-byte;
 *   - understandingSynthesis: false disables the task entirely.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as nodePath from "node:path";
import * as nodeOs from "node:os";
import * as nodeFs from "node:fs/promises";
import { resumeBatch, runBatch, runOnly } from "./batch.js";
import { run as runVerify } from "./verify.js";
import { UNDERSTANDING_REL_PATH } from "./understanding.js";
import type { LlmClient } from "./llm/index.js";
import type { GenerateRequest, GenerateResult } from "./llm/types.js";
import type { TaskCheckpoint } from "./batch-state.js";

// === Fixture helpers (same shapes as batch-stage5.test.ts) ===

function parseClosedKeys(user: string): string[] {
  const keys: string[] = [];
  for (const line of user.split("\n")) {
    const m = /^- (\S+#\S+)$/.exec(line);
    if (m?.[1]) keys.push(m[1]);
  }
  return keys;
}

interface FlowPromptCtx {
  slug: string;
  moduleIds: string[];
  closedKeys: string[];
}

function parseFlowPrompt(user: string): FlowPromptCtx {
  const slug = /^# Flow: (\S+)$/m.exec(user)?.[1] ?? "unknown-flow";
  const modulesLine = /^# Participating modules .*: (.+)$/m.exec(user)?.[1] ?? "";
  return {
    slug,
    moduleIds: modulesLine.split(",").map((s) => s.trim()).filter(Boolean),
    closedKeys: parseClosedKeys(user),
  };
}

function makeValidPage(closedKeyList: string[]): string {
  return [
    "---",
    "title: test",
    "owner: generated",
    "anchors:",
    ...closedKeyList.map((k) => `  - ${k}`),
    "---",
    "",
    "# test",
    "",
    "This page documents the module's indexed responsibilities.",
    "",
    "## When to use this page",
    "",
    "- Review this module's behavior.",
    "- Change this module's implementation.",
    "",
    "## How it fits",
    "",
    "This module provides one part of the repository implementation.",
    "",
    "## Details",
    "",
    `<!-- lw:anchors ${closedKeyList.join(" ")} -->`,
    "",
    "Body.",
    "",
  ].join("\n");
}

function makeFlowPage(ctx: FlowPromptCtx): string {
  const [firstKey, secondKey, ...restKeys] = ctx.closedKeys;
  return [
    "---",
    "title: CLI to core flow",
    "owner: generated",
    "anchors:",
    ...ctx.closedKeys.map((k) => `  - ${k}`),
    "modules:",
    ...ctx.moduleIds.map((m) => `  - ${m}`),
    "updated: 2026-08-03",
    "---",
    "",
    "# CLI to core flow",
    "",
    "This page explains how the CLI drives the core end to end.",
    "",
    "## Purpose",
    "",
    ...(firstKey ? [`<!-- lw:anchors ${firstKey} -->`, ""] : []),
    "The CLI invocation starts the flow and the core produces a stored result.",
    "",
    "## Ordered flow",
    "",
    ...(secondKey ? [`<!-- lw:anchors ${secondKey} -->`, ""] : []),
    "1. The CLI parses the invocation.",
    "2. The core persists the result.",
    "",
    "## Invariants",
    "",
    "- Every step preserves the input payload.",
    "",
    "## Failure and recovery",
    "",
    ...(restKeys.length > 0 ? [`<!-- lw:anchors ${restKeys.join(" ")} -->`, ""] : []),
    "The supplied source shows no retry or rollback path; the flow fails open.",
    "",
    "## Related pages",
    "",
    ...ctx.moduleIds.map((m) => `- [${m} module](../${m}.md)`),
    "",
  ].join("\n");
}

const UNDERSTANDING_PURPOSE =
  "Flow Repo is a small command line application that parses invocations and persists records for its users.";

function makeUnderstandingPage(): string {
  return [
    "---",
    "title: Flow Repo",
    "owner: generated",
    "kind: understanding",
    "updated: 2026-08-03",
    "---",
    "",
    "# Flow Repo",
    "",
    UNDERSTANDING_PURPOSE,
    "",
    "## Key surfaces",
    "",
    "- Command line interface entry point",
    "- Persistence layer in the core module",
    "",
  ].join("\n");
}

/** Invalid understanding page: a code span claiming a source symbol. */
function makeInvalidUnderstandingPage(): string {
  return makeUnderstandingPage().replace(
    "persists records for its users.",
    "persists records via `core/db.ts#connect` for its users.",
  );
}

/**
 * Programmable stage-4/5/5c stub. Understanding calls are detected by the
 * `# Output: livewiki/understanding.md` header and answered with a valid
 * page (or a test-supplied responder queue).
 */
class UnderstandingMockLlm implements LlmClient {
  public readonly provider = "anthropic" as const;
  public readonly model = "claude-test-mock";
  public callCount = 0;
  public flowCallCount = 0;
  public understandingCallCount = 0;
  public understandingPrompts: Array<{ system: string; user: string }> = [];
  /** Override for understanding responses (receives the 0-based call index). */
  public understandingResponder: ((callIndex: number) => string) | null = null;

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    this.callCount++;
    const usage = { inputTokens: 100, outputTokens: 50, model: this.model };
    if (/^# Output: livewiki\/understanding\.md$/m.test(req.user)) {
      const index = this.understandingCallCount++;
      this.understandingPrompts.push({ system: req.system, user: req.user });
      return {
        content: this.understandingResponder
          ? this.understandingResponder(index)
          : makeUnderstandingPage(),
        usage,
      };
    }
    if (/^# Flow: \S+$/m.test(req.user)) {
      this.flowCallCount++;
      return { content: makeFlowPage(parseFlowPrompt(req.user)), usage };
    }
    return { content: makeValidPage(parseClosedKeys(req.user)), usage };
  }
}

/** Minimal repo with a detectable flow: cli (entry) → core (persistence, sink). */
async function writeFlowRepo(root: string): Promise<void> {
  await nodeFs.mkdir(nodePath.join(root, "cli"), { recursive: true });
  await nodeFs.mkdir(nodePath.join(root, "core"), { recursive: true });
  await nodeFs.writeFile(
    nodePath.join(root, "cli/index.ts"),
    'import { connect } from "../core/db";\nexport function main() { return connect(); }\nexport function parseArgs(args) { return args; }\n',
    "utf8",
  );
  await nodeFs.writeFile(
    nodePath.join(root, "core/db.ts"),
    'export function connect() { return "db"; }\n',
    "utf8",
  );
}

async function readLatestUnderstandingCheckpoint(root: string): Promise<TaskCheckpoint | null> {
  const Database = (await import("better-sqlite3")).default;
  const db = new Database(nodePath.join(root, ".livewiki/index.db"), { readonly: true });
  try {
    const row = db
      .prepare(
        "SELECT checkpoint_json FROM batch_tasks WHERE stage = 5 AND target LIKE 'understanding:%' ORDER BY run_id DESC, id DESC LIMIT 1",
      )
      .get() as { checkpoint_json: string | null } | undefined;
    return row?.checkpoint_json ? (JSON.parse(row.checkpoint_json) as TaskCheckpoint) : null;
  } finally {
    db.close();
  }
}

async function fileExists(root: string, rel: string): Promise<boolean> {
  try {
    await nodeFs.access(nodePath.join(root, rel));
    return true;
  } catch {
    return false;
  }
}

let repoRoot: string;
let llm: UnderstandingMockLlm;

beforeEach(async () => {
  repoRoot = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "livewiki-batch-understanding-"));
  llm = new UnderstandingMockLlm();
  // Roadmap #22: pin the pre-#22 stage-4 format — the understanding layer is
  // the subject here and the mock's module pages emit no Diagram section.
  // #22-on is covered by module-diagram-format.test.ts and
  // batch-module-diagrams.test.ts.
  await nodeFs.mkdir(nodePath.join(repoRoot, ".livewiki"), { recursive: true });
  await nodeFs.writeFile(
    nodePath.join(repoRoot, ".livewiki/config.json"),
    JSON.stringify({ moduleDiagrams: false, deepHierarchy: false }),
    "utf8",
  );
});

afterEach(async () => {
  await nodeFs.rm(repoRoot, { recursive: true, force: true });
});

describe("batch stage 5c — repository understanding", () => {
  it("happy path: one task, page on disk, usage recorded, verify clean, quickstart prefers the synthesis", async () => {
    await writeFlowRepo(repoRoot);
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "README.md"),
      "# Flow Repo\n\nFlow Repo is a small CLI that turns invocations into stored records.\n",
      "utf8",
    );
    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
    });

    expect(result.status).toBe("completed");
    expect(llm.understandingCallCount).toBe(1);
    expect(llm.flowCallCount).toBe(1);
    const understandingUsage = result.byModule.find((entry) => entry.module.startsWith("understanding:"));
    expect(understandingUsage).toBeDefined();
    expect(understandingUsage!.inputTokens).toBe(100);

    // The prompt carried the closed evidence inventory.
    const prompt = llm.understandingPrompts[0]!;
    expect(prompt.user).toContain("# Closed evidence inventory");
    expect(prompt.user).toContain("# Accepted module pages");
    expect(prompt.user).toContain("[cli]");
    expect(prompt.user).toContain("[core]");
    expect(prompt.user).toContain("# Accepted flow pages");
    expect(prompt.user).toContain("CLI to core flow");
    expect(prompt.user).toContain("Flow Repo is a small CLI that turns invocations into stored records.");
    expect(prompt.system).toContain("never the authority");

    // The page landed on disk and verify stays clean for it.
    const page = await nodeFs.readFile(nodePath.join(repoRoot, UNDERSTANDING_REL_PATH), "utf8");
    expect(page).toContain("owner: generated");
    expect(page).toContain("kind: understanding");
    expect(page).toContain(UNDERSTANDING_PURPOSE);
    const verify = await runVerify(repoRoot);
    expect(verify.issues.filter((issue) => issue.wikiPath === UNDERSTANDING_REL_PATH)).toEqual([]);

    // The quickstart (regenerated at batch end) prefers the synthesis with
    // provenance; the README purpose is quoted as evidence, not authority.
    const quickstart = await nodeFs.readFile(nodePath.join(repoRoot, "livewiki/quickstart.md"), "utf8");
    expect(quickstart).toContain(UNDERSTANDING_PURPOSE);
    expect(quickstart).toContain("*(Synthesized from the verified wiki pages — see `livewiki/understanding.md`.)*");
    expect(quickstart).toContain(
      "The repository README also states: Flow Repo is a small CLI that turns invocations into stored records.",
    );
    expect(quickstart).toContain("one evidence input, not the authority");
    expect(quickstart).toContain("- Command line interface entry point");

    const checkpoint = await readLatestUnderstandingCheckpoint(repoRoot);
    expect(checkpoint?.status).toBe("done");
    expect(checkpoint?.attempt).toBe(1);
  });

  it("a contract violation is rejected and the repair round converges", async () => {
    await writeFlowRepo(repoRoot);
    llm.understandingResponder = (index) =>
      index === 0 ? makeInvalidUnderstandingPage() : makeUnderstandingPage();
    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
    });

    expect(result.status).toBe("completed");
    expect(llm.understandingCallCount).toBe(2);
    // The second call was a REPAIR prompt embedding the validator error.
    expect(llm.understandingPrompts[1]!.system).toContain("REPAIR");
    expect(llm.understandingPrompts[1]!.system).toContain("[code_span_forbidden]");
    const checkpoint = await readLatestUnderstandingCheckpoint(repoRoot);
    expect(checkpoint?.status).toBe("done");
    expect(checkpoint?.attempt).toBe(2);
    expect(
      checkpoint?.diagnosticHistory?.map((entry) => entry.outcome),
    ).toEqual(["artifact_validation_failed", "success"]);
    // The valid page landed.
    const page = await nodeFs.readFile(nodePath.join(repoRoot, UNDERSTANDING_REL_PATH), "utf8");
    expect(page).not.toContain("core/db.ts#connect");
  });

  it("persistent violations exhaust the budget: task fails, run continues, nothing persists", async () => {
    await writeFlowRepo(repoRoot);
    llm.understandingResponder = () => makeInvalidUnderstandingPage();
    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
    });

    expect(result.status).toBe("completed_with_failures");
    const failure = result.failures.find((entry) => entry.module.startsWith("understanding:"));
    expect(failure).toBeDefined();
    expect(failure!.error.code).toBe("repair_exhausted");
    expect(failure!.retryCommand).toBe(`livewiki batch --only understanding ${result.runId}`);
    // The run continued: module + flow tasks completed normally.
    expect(result.tasksDone).toBeGreaterThanOrEqual(3);
    // Transactional write: the invalid page NEVER persisted.
    expect(await fileExists(repoRoot, UNDERSTANDING_REL_PATH)).toBe(false);
  });

  it("resume with unchanged evidence makes ZERO new understanding LLM calls", async () => {
    await writeFlowRepo(repoRoot);
    const first = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
    });
    expect(first.status).toBe("completed");
    expect(llm.understandingCallCount).toBe(1);

    const resumed = await resumeBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
    });
    expect(resumed.status).toBe("completed");
    // Module/flow tasks re-ran (resume regenerates), but the understanding
    // task found its done checkpoint for the SAME evidence hash and skipped.
    expect(llm.callCount).toBeGreaterThan(3);
    expect(llm.understandingCallCount).toBe(1);
  });

  it("--only understanding reruns the task with monotonic usage", async () => {
    await writeFlowRepo(repoRoot);
    const first = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
    });
    expect(first.status).toBe("completed");
    expect(llm.understandingCallCount).toBe(1);

    const rerun = await runOnly({
      repoRoot,
      llmClient: llm,
      onlyTarget: "understanding",
      noRefine: true,
      skipManifestWrite: true,
    });
    expect(rerun.status).toBe("completed");
    expect(llm.understandingCallCount).toBe(2);
    const checkpoint = await readLatestUnderstandingCheckpoint(repoRoot);
    expect(checkpoint?.status).toBe("done");
    expect(checkpoint?.usageHistory?.map((entry) => entry.attempt)).toEqual([1, 2]);
  });

  it("owner: human on the synthesis page is refused and preserved byte-for-byte", async () => {
    await writeFlowRepo(repoRoot);
    await nodeFs.mkdir(nodePath.join(repoRoot, "livewiki"), { recursive: true });
    const humanPage = [
      "---",
      "title: My understanding",
      "owner: human",
      "---",
      "",
      "# My understanding",
      "",
      "A human wrote this understanding of the repository and it must never be rewritten.",
      "",
    ].join("\n");
    await nodeFs.writeFile(nodePath.join(repoRoot, UNDERSTANDING_REL_PATH), humanPage, "utf8");

    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
    });
    expect(result.status).toBe("completed_with_failures");
    const failure = result.failures.find((entry) => entry.module.startsWith("understanding:"));
    expect(failure?.error.code).toBe("refused_owned_understanding");
    expect(llm.understandingCallCount).toBe(0);
    const onDisk = await nodeFs.readFile(nodePath.join(repoRoot, UNDERSTANDING_REL_PATH), "utf8");
    expect(onDisk).toBe(humanPage);
  });

  it("understandingSynthesis: false disables the task entirely", async () => {
    await writeFlowRepo(repoRoot);
    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
      understandingSynthesis: false,
    });
    expect(result.status).toBe("completed");
    expect(llm.understandingCallCount).toBe(0);
    expect(result.byModule.some((entry) => entry.module.startsWith("understanding:"))).toBe(false);
    expect(await fileExists(repoRoot, UNDERSTANDING_REL_PATH)).toBe(false);
    // The quickstart falls back to the deterministic chain (no synthesis).
    const quickstart = await nodeFs.readFile(nodePath.join(repoRoot, "livewiki/quickstart.md"), "utf8");
    expect(quickstart).not.toContain("Synthesized from the verified wiki pages");
  });
});
