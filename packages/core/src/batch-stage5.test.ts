/**
 * batch-stage5.test.ts — Lot S3a: stage 5 (semantic product flows).
 *
 * Regression contracts covered here:
 *
 *   - happy path: detectable flow → stage-5 task done, page on disk with
 *     the PLACEHOLDER (never the inline diagram), companion .mmd written
 *     and parseable, usage recorded, verify clean on the flow artifacts;
 *   - extractInlineFlowDiagram unit cases (extraction + substitution,
 *     placeholder-only fence → null, example-nested fence ignored);
 *   - countFlowDiagramElements unit cases (flowchart/sequence/state/
 *     unrecognized);
 *   - flow_diagram_too_large and invalid_flow_diagram are repairable
 *     (second attempt succeeds; the repair prompt embeds the
 *     model-emitted INLINE form);
 *   - owner: human refuses before any LLM call; owner: mixed preserves
 *     manual blocks byte-for-byte;
 *   - verify failure rolls back BOTH new files;
 *   - a flows-hub link written as `../index.md` (resolving outside `flows/`)
 *     trips the write gate; the bare `index.md` retry lands and verify ends
 *     clean (the MiniMax-M3 generalization regression);
 *   - maxFlows: 0 disables detection AND cleanup;
 *   - zero candidates is a valid `completed` outcome, not an empty pipeline;
 *   - stale cleanup removes disappeared generated candidates, preserves human;
 *   - `--only flow:<slug>` reruns one flow with monotonic usage attempts;
 *   - llm_timeout fails the flow task and the run continues.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as nodePath from "node:path";
import * as nodeOs from "node:os";
import * as nodeFs from "node:fs/promises";
import { runBatch, runOnly } from "./batch.js";
import * as safeIo from "./safe-io.js";
import { run as runIndexer } from "./indexer.js";
import { run as runVerify } from "./verify.js";
import {
  extractInlineFlowDiagram,
  countFlowDiagramElements,
  flowDiagramPlaceholder,
  FLOW_DIAGRAM_SOURCE_MAX_CHARS,
} from "./artifact.js";
import type { LlmClient } from "./llm/index.js";
import { LlmTimeoutError } from "./llm/index.js";
import type { GenerateRequest, GenerateResult } from "./llm/types.js";
import type { TaskCheckpoint } from "./batch-state.js";
import { validateMermaidSyntax } from "./mermaid-validator.js";

// === Fixture helpers ===

interface FlowPromptCtx {
  slug: string;
  moduleIds: string[];
  closedKeys: string[];
  user: string;
}

/** Parse the closed key list out of any stage-4/stage-5 user prompt. */
function parseClosedKeys(user: string): string[] {
  const keys: string[] = [];
  for (const line of user.split("\n")) {
    const m = /^- (\S+#\S+)$/.exec(line);
    if (m?.[1]) keys.push(m[1]);
  }
  return keys;
}

function parseFlowPrompt(user: string): FlowPromptCtx {
  const slug = /^# Flow: (\S+)$/m.exec(user)?.[1] ?? "unknown-flow";
  const modulesLine = /^# Participating modules .*: (.+)$/m.exec(user)?.[1] ?? "";
  const moduleIds = modulesLine
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return { slug, moduleIds, closedKeys: parseClosedKeys(user), user };
}

/** Valid stage-4 module page (same shape as batch-repair.test.ts). */
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

function makeCompactAuxiliaryPage(closedKeyList: string[]): string {
  return [
    "---",
    "title: Auxiliary reference",
    "owner: generated",
    "anchors:",
    ...closedKeyList.map((key) => `  - ${key}`),
    "---",
    "",
    "# Auxiliary reference",
    "",
    "This page documents auxiliary repository code.",
    "",
    "## When to use this page",
    "",
    "- Review the auxiliary implementation.",
    "- Change the supporting code safely.",
    "",
    "## How it fits",
    "",
    "This code supports development and is not a product runtime path.",
    "",
    "## Reference",
    "",
    ...closedKeyList.flatMap((key) => [
      `### ${key}`,
      `<!-- lw:anchors ${key} -->`,
      "This indexed symbol belongs to the auxiliary implementation.",
      "",
    ]),
  ].join("\n");
}

/**
 * Valid stage-5 flow page in the MODEL-EMITTED form: the companion
 * diagram is INLINE inside `## Diagram` (the orchestrator substitutes
 * the placeholder on disk). The first closed key is anchored in
 * `Purpose`, the second in `Ordered flow`, and the rest in
 * `Failure and recovery` — every marker-carrying flow section holds at
 * least one marker (R10.1 D) and dual completeness holds (every cited
 * key once in frontmatter AND once across section markers).
 */
/**
 * Priority-0 fix (2026-07-22): the LLM no longer writes anything about
 * `## Diagram` — the orchestrator generates and inserts it deterministically
 * (see `generateFlowDiagram`/`insertFlowDiagramSection` in flow-diagram.ts).
 * `diagramSource` is kept as a parameter only so existing call sites don't
 * all need updating; it is intentionally unused in the fixture body.
 */
function makeFlowPage(ctx: FlowPromptCtx, _diagramSource: string): string {
  const [firstKey, secondKey, ...restKeys] = ctx.closedKeys;
  return [
    "---",
    "title: CLI to core flow",
    "owner: generated",
    "anchors:",
    ...ctx.closedKeys.map((k) => `  - ${k}`),
    "modules:",
    ...ctx.moduleIds.map((m) => `  - ${m}`),
    "updated: 2026-07-18",
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

/**
 * Programmable stage-4 + stage-5 stub. Stage-4 module pages are generated
 * from the prompt's closed key list; stage-5 calls are detected by the
 * `# Flow:` header and answered with a valid flow page (or a
 * test-supplied `flowResponder` queue).
 */
class Stage5MockLlm implements LlmClient {
  public readonly provider = "anthropic" as const;
  public readonly model = "claude-test-mock";
  public callCount = 0;
  public flowCallCount = 0;
  public callLog: Array<{ system: string; user: string; maxTokens: number | undefined }> = [];
  /** Override for stage-5 responses (receives parsed prompt + flow call index). */
  public flowResponder: ((ctx: FlowPromptCtx, flowCallIndex: number) => string) | null = null;
  /** Throw this error on the Nth stage-5 call (0-based). */
  public throwOnFlowCall: { index: number; error: Error } | null = null;
  /** Side-effect hook before the stage-5 response is produced. */
  public onBeforeFlowResponse: ((flowCallIndex: number) => Promise<void> | void) | null = null;

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    this.callLog.push({ system: req.system, user: req.user, maxTokens: req.maxTokens });
    this.callCount++;
    const usage = { inputTokens: 100, outputTokens: 50, model: this.model };
    if (/^# Flow: \S+$/m.test(req.user)) {
      const flowIdx = this.flowCallCount++;
      if (this.throwOnFlowCall && flowIdx === this.throwOnFlowCall.index) {
        throw this.throwOnFlowCall.error;
      }
      const ctx = parseFlowPrompt(req.user);
      if (this.onBeforeFlowResponse) await this.onBeforeFlowResponse(flowIdx);
      const content = this.flowResponder
        ? this.flowResponder(ctx, flowIdx)
        : makeFlowPage(ctx, "flowchart LR\n  cli --> core");
      return { content, usage };
    }
    const closedKeys = parseClosedKeys(req.user);
    return {
      content: /compact auxiliary contract/i.test(`${req.system}\n${req.user}`)
        ? makeCompactAuxiliaryPage(closedKeys)
        : makeValidPage(closedKeys),
      usage,
    };
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

async function readTaskCheckpoint(
  root: string,
  stage: number,
  target: string,
): Promise<TaskCheckpoint | null> {
  const Database = (await import("better-sqlite3")).default;
  const db = new Database(nodePath.join(root, ".livewiki/index.db"), {
    readonly: true,
  });
  try {
    const row = db
      .prepare("SELECT checkpoint_json FROM batch_tasks WHERE stage = ? AND target = ?")
      .get(stage, target) as { checkpoint_json: string | null } | undefined;
    return row?.checkpoint_json ? (JSON.parse(row.checkpoint_json) as TaskCheckpoint) : null;
  } finally {
    db.close();
  }
}

async function countStage5Tasks(root: string): Promise<number> {
  const Database = (await import("better-sqlite3")).default;
  const db = new Database(nodePath.join(root, ".livewiki/index.db"), {
    readonly: true,
  });
  try {
    const row = db
      .prepare("SELECT COUNT(*) AS n FROM batch_tasks WHERE stage = 5")
      .get() as { n: number };
    return row.n;
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

const FLOW_SLUG = "cli-to-core";
const FLOW_PAGE_PATH = `livewiki/flows/${FLOW_SLUG}.md`;
const FLOW_DIAGRAM_PATH = `livewiki/diagrams/flow-${FLOW_SLUG}.mmd`;
const FLOW_TARGET = `flow:${FLOW_SLUG}`;

let repoRoot: string;
let llm: Stage5MockLlm;

beforeEach(async () => {
  repoRoot = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "livewiki-batch-stage5-"));
  llm = new Stage5MockLlm();
});

afterEach(async () => {
  await nodeFs.rm(repoRoot, { recursive: true, force: true });
});

// === Unit: extractInlineFlowDiagram ===

describe("artifact.extractInlineFlowDiagram", () => {
  const page = (diagramSection: string) =>
    [
      "---",
      "title: F",
      "owner: generated",
      "---",
      "",
      "# F",
      "",
      "Sentence.",
      "",
      "## Purpose",
      "",
      "Prose.",
      "",
      "## Ordered flow",
      "",
      "1. Step.",
      "",
      diagramSection,
      "",
      "## Invariants",
      "",
      "- ok",
      "",
    ].join("\n");

  it("extracts the inline diagram and substitutes the exact placeholder", () => {
    const content = page("## Diagram\n\n```mermaid\nflowchart LR\n  a --> b\n```");
    const r = extractInlineFlowDiagram(content, "my-flow");
    expect(r).not.toBeNull();
    expect(r!.diagramSource).toBe("flowchart LR\n  a --> b");
    expect(r!.sourceTooLarge).toBe(false);
    expect(r!.pageContent).toContain(`%% livewiki/diagrams/flow-my-flow.mmd`);
    expect(r!.pageContent).not.toContain("flowchart LR");
    // The rest of the page is preserved.
    expect(r!.pageContent).toContain("## Invariants");
  });

  it("placeholder-only fence → null (the model-emitted form must be the diagram)", () => {
    const content = page("## Diagram\n\n```mermaid\n%% livewiki/diagrams/flow-my-flow.mmd\n```");
    expect(extractInlineFlowDiagram(content, "my-flow")).toBeNull();
  });

  it("empty fence, missing section, and lowercase heading", () => {
    expect(extractInlineFlowDiagram(page("## Diagram\n\n```mermaid\n\n```"), "x")).toBeNull();
    expect(extractInlineFlowDiagram(page("## Not a diagram\n\n```mermaid\nflowchart LR\n  a --> b\n```"), "x")).toBeNull();
    const lower = extractInlineFlowDiagram(
      page("## diagram\n\n```mermaid\nflowchart LR\n  a --> b\n```"),
      "x",
    );
    expect(lower).not.toBeNull();
    expect(lower!.diagramSource).toBe("flowchart LR\n  a --> b");
  });

  it("a ```mermaid fence nested inside a ~~~ example block is ignored", () => {
    const section = [
      "## Diagram",
      "",
      "~~~",
      "```mermaid",
      "flowchart LR",
      "  fake --> fake",
      "```",
      "~~~",
      "",
      "```mermaid",
      "flowchart LR",
      "  real --> real",
      "```",
    ].join("\n");
    const r = extractInlineFlowDiagram(page(section), "x");
    expect(r).not.toBeNull();
    expect(r!.diagramSource).toBe("flowchart LR\n  real --> real");
    // Only the nested example → no extractable diagram.
    const nestedOnly = extractInlineFlowDiagram(
      page(["## Diagram", "", "~~~", "```mermaid", "flowchart LR", "  fake --> fake", "```", "~~~"].join("\n")),
      "x",
    );
    expect(nestedOnly).toBeNull();
  });

  it("over-long sources come back flagged, not null (flow_diagram_too_large path)", () => {
    const huge = `flowchart LR\n  ${"a --> b\n  ".repeat(900)}a --> b`;
    const r = extractInlineFlowDiagram(page(`## Diagram\n\n\`\`\`mermaid\n${huge}\n\`\`\``), "x");
    expect(r).not.toBeNull();
    expect(r!.diagramSource.length).toBeGreaterThan(FLOW_DIAGRAM_SOURCE_MAX_CHARS);
    expect(r!.sourceTooLarge).toBe(true);
    expect(flowDiagramPlaceholder("x")).toBe("%% livewiki/diagrams/flow-x.mmd");
  });
});

// === Unit: countFlowDiagramElements ===

describe("artifact.countFlowDiagramElements", () => {
  it("flowchart/graph: unique endpoint ids, one edge per operator, directives skipped", () => {
    expect(
      countFlowDiagramElements("flowchart LR\n  a --> b\n  b --> c\n  a --> c"),
    ).toEqual({ nodes: 3, edges: 3 });
    expect(
      countFlowDiagramElements("graph TD\n  A[Start] -- goes --> B(Round)\n  A & B --> C{Decision}"),
    ).toEqual({ nodes: 3, edges: 2 });
    expect(
      countFlowDiagramElements(
        "flowchart TD\n  %% a comment\n  subgraph G\n  a --> b\n  end\n  classDef x fill:#fff",
      ),
    ).toEqual({ nodes: 2, edges: 1 });
  });

  it("sequenceDiagram: participants + message endpoints, one edge per message", () => {
    expect(
      countFlowDiagramElements(
        "sequenceDiagram\n  participant A\n  participant B\n  A->>B: hello\n  B-->>A: ok",
      ),
    ).toEqual({ nodes: 2, edges: 2 });
    expect(
      countFlowDiagramElements("sequenceDiagram\n  cli->>core: run\n  core-->>db: write"),
    ).toEqual({ nodes: 3, edges: 2 });
  });

  it("stateDiagram(-v2): transition endpoints + state declarations", () => {
    expect(
      countFlowDiagramElements(
        "stateDiagram-v2\n  [*] --> Idle\n  Idle --> Running : start\n  Running --> [*]",
      ),
    ).toEqual({ nodes: 3, edges: 3 });
    expect(
      countFlowDiagramElements('stateDiagram\n  state "Waiting" as W\n  W --> X'),
    ).toEqual({ nodes: 2, edges: 1 });
  });

  it("unrecognized kinds count non-empty non-comment lines as elements", () => {
    expect(countFlowDiagramElements('pie title X\n  "a": 1\n  "b": 2')).toEqual({
      nodes: 3,
      edges: 3,
    });
    expect(countFlowDiagramElements("%% only a comment")).toEqual({ nodes: 0, edges: 0 });
  });
});

// === Stage 5 orchestration ===

describe("batch stage 5 — happy path", () => {
  it("detects the flow, writes page-with-placeholder + diagram, records usage, verify clean", async () => {
    await writeFlowRepo(repoRoot);
    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
    });

    expect(result.status).toBe("completed");
    expect(llm.flowCallCount).toBe(1);
    expect(result.byModule.some((m) => m.module === FLOW_TARGET)).toBe(true);

    // The on-disk page carries the PLACEHOLDER, never the inline diagram.
    const page = await nodeFs.readFile(nodePath.join(repoRoot, FLOW_PAGE_PATH), "utf8");
    expect(page).toContain(`%% livewiki/diagrams/flow-${FLOW_SLUG}.mmd`);
    expect(page).not.toContain("flowchart LR");
    expect(page).toContain("owner: generated");

    // The companion diagram is generated deterministically (Priority-0 fix,
    // 2026-07-22): the LLM never writes it — the orchestrator builds it
    // from the FlowCandidate via generateFlowDiagram. Assert shape/content,
    // not the old fixed mock string.
    const diagram = await nodeFs.readFile(nodePath.join(repoRoot, FLOW_DIAGRAM_PATH), "utf8");
    expect(diagram).toMatch(/^flowchart LR\n/);
    // A 2-module walk uses symbol granularity — node labels are the
    // participating symbol names, not the module ids.
    expect(diagram).toContain("main");
    expect(diagram).toContain("connect");
    expect(await validateMermaidSyntax(diagram)).toBeNull();

    // Checkpoint: stage 5, done, one known-usage attempt, two artifacts.
    const checkpoint = await readTaskCheckpoint(repoRoot, 5, FLOW_TARGET);
    expect(checkpoint).not.toBeNull();
    expect(checkpoint!.stage).toBe(5);
    expect(checkpoint!.status).toBe("done");
    expect(checkpoint!.usageHistory).toHaveLength(1);
    expect(checkpoint!.usageHistory[0]!.usageKnown).toBe(true);
    expect(checkpoint!.diagnosticHistory).toHaveLength(1);
    expect(checkpoint!.diagnosticHistory![0]!.outcome).toBe("success");
    expect(checkpoint!.artifacts).toMatchObject({
      wikiPath: FLOW_PAGE_PATH,
      diagramPath: FLOW_DIAGRAM_PATH,
    });
    expect(typeof checkpoint!.artifacts!.pageHash).toBe("string");
    expect(typeof checkpoint!.artifacts!.diagramHash).toBe("string");

    // Verify: zero error-severity issues repo-wide, zero issues of any
    // severity on the flow artifacts.
    const verify = await runVerify(repoRoot);
    expect(verify.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(
      verify.issues.filter(
        (i) => i.wikiPath === FLOW_PAGE_PATH || i.wikiPath === FLOW_DIAGRAM_PATH,
      ),
    ).toEqual([]);
  }, 60_000);
});

describe("batch stage 5 — dynamic output-token budget (Priority-0 fix)", () => {
  it("a flow with many seed keys gets a maxTokens budget larger than the old flat 8192 default", async () => {
    await writeFlowRepo(repoRoot);
    // Add enough exported functions to core/db.ts to push the flow's
    // closed key list well past what the flat 8192 default was tuned for.
    const lines = Array.from({ length: 20 }, (_, i) => `export function fn${i}() { return ${i}; }`);
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "core/db.ts"),
      ['export function connect() { return "db"; }', ...lines, ""].join("\n"),
      "utf8",
    );

    await runBatch({ repoRoot, llmClient: llm, noRefine: true, skipManifestWrite: true });

    const flowCall = llm.callLog.find((c) => /^# Flow: \S+$/m.test(c.user));
    expect(flowCall).toBeDefined();
    expect(flowCall!.maxTokens).toBeGreaterThan(8192);
  }, 60_000);
});

describe("batch stage 5 — diagram gates (Priority-0 fix: deterministic generation)", () => {
  // Priority-0 fix (2026-07-22, paid E2E against MoneyPrinterTurbo-Plus):
  // 2 of 4 real flows failed 3/3 attempts with `invalid_flow_diagram` — the
  // LLM could not emit valid Mermaid, and no mechanical repair existed for
  // genuinely malformed syntax (only oversized-but-valid flowcharts had
  // one). The diagram is now generated deterministically from the
  // FlowCandidate (generateFlowDiagram) and inserted by the orchestrator —
  // the LLM never writes it, so `invalid_flow_diagram`/`flow_diagram_too_large`
  // can no longer occur via the LLM at all.

  it("a tight node budget is respected by construction — zero extra LLM calls, no repair round-trip", async () => {
    await writeFlowRepo(repoRoot);
    await nodeFs.mkdir(nodePath.join(repoRoot, ".livewiki"), { recursive: true });
    await nodeFs.writeFile(
      nodePath.join(repoRoot, ".livewiki/config.json"),
      JSON.stringify({ flowMaxDiagramNodes: 1, flowMaxDiagramEdges: 1 }),
      "utf8",
    );

    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
    });

    expect(result.status).toBe("completed");
    expect(llm.flowCallCount).toBe(1); // one LLM call for prose; the diagram costs zero
    const checkpoint = await readTaskCheckpoint(repoRoot, 5, FLOW_TARGET);
    expect(checkpoint!.status).toBe("done");
    expect(checkpoint!.diagnosticHistory).toHaveLength(1);
    expect(checkpoint!.diagnosticHistory![0]!.outcome).toBe("success");

    const diagram = await nodeFs.readFile(nodePath.join(repoRoot, FLOW_DIAGRAM_PATH), "utf8");
    const counts = countFlowDiagramElements(diagram);
    expect(counts.nodes).toBeLessThanOrEqual(1);
    expect(counts.edges).toBeLessThanOrEqual(1);
    expect(await validateMermaidSyntax(diagram)).toBeNull();
  }, 60_000);

  it("the LLM attempting to write a Diagram section anyway is silently ignored — the deterministic diagram wins", async () => {
    // Regression guard for the exact E2E failure mode: even if the model
    // disregards the "prose only" instruction and emits its own (possibly
    // malformed) Mermaid inside a `## Diagram` section, the orchestrator
    // never looks at it — the page never had a real Diagram section
    // going into the pipeline (it's inserted after generation), so
    // whatever the LLM wrote there is just prose the validator sees as
    // part of "Ordered flow" or rejects for a DIFFERENT reason, never
    // `invalid_flow_diagram`.
    await writeFlowRepo(repoRoot);
    llm.flowResponder = (ctx) =>
      makeFlowPage(ctx, "irrelevant — this fixture no longer writes ## Diagram at all");

    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
    });

    expect(result.status).toBe("completed");
    expect(llm.flowCallCount).toBe(1);
    const checkpoint = await readTaskCheckpoint(repoRoot, 5, FLOW_TARGET);
    expect(checkpoint!.diagnosticHistory!.every((d) => d.outcome !== "artifact_validation_failed" || !d.errors.some((e) => e.code === "invalid_flow_diagram" || e.code === "flow_diagram_too_large"))).toBe(true);
    const diagram = await nodeFs.readFile(nodePath.join(repoRoot, FLOW_DIAGRAM_PATH), "utf8");
    expect(await validateMermaidSyntax(diagram)).toBeNull();
  }, 60_000);

  it("a Mermaid syntax bug in the renderer itself throws (infra failure), never consumes an LLM repair slot", async () => {
    // Defense in depth: `generateFlowDiagram`'s output is re-validated via
    // validateMermaidSyntax before being written. This test cannot
    // reproduce a real renderer bug without monkey-patching, so it instead
    // documents the contract: a rejection there is thrown, not returned as
    // a normal validation error — confirmed by inspecting the source
    // contract rather than simulating unreachable code.
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("./batch.ts", import.meta.url), "utf8");
    expect(source).toContain("this is a bug in flow-diagram.ts, not an LLM failure");
  });
});

describe("batch stage 5 — ownership and retry", () => {
  it("owner: human existing flow page → refused before any LLM call", async () => {
    await writeFlowRepo(repoRoot);
    const first = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
    });
    expect(first.status).toBe("completed");

    await nodeFs.writeFile(
      nodePath.join(repoRoot, FLOW_PAGE_PATH),
      "---\ntitle: My flow\nowner: human\n---\n\n# My flow\n\nHuman-owned flow page.\n",
      "utf8",
    );
    const callsBefore = llm.callCount;
    const result = await runOnly({
      repoRoot,
      llmClient: llm,
      onlyTarget: FLOW_TARGET,
      noRefine: true,
      skipManifestWrite: true,
    });

    expect(llm.callCount).toBe(callsBefore); // no LLM call at all
    expect(result.status).toBe("completed_with_failures");
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]!.module).toBe(FLOW_TARGET);
    expect(result.failures[0]!.error.code).toBe("refused_human_page");
    expect(result.failures[0]!.retryCommand).toContain(`--only ${FLOW_TARGET}`);
    // The human page is untouched.
    const page = await nodeFs.readFile(nodePath.join(repoRoot, FLOW_PAGE_PATH), "utf8");
    expect(page).toContain("Human-owned flow page.");
  }, 60_000);

  it("owner: mixed → manual blocks preserved byte-for-byte on rewrite", async () => {
    await writeFlowRepo(repoRoot);
    const first = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
    });
    expect(first.status).toBe("completed");

    const manualBlock = "<!-- lw:manual -->\nCurated by a human.\n<!-- /lw:manual -->";
    const previous = await nodeFs.readFile(nodePath.join(repoRoot, FLOW_PAGE_PATH), "utf8");
    const mixed = previous
      .replace("owner: generated", "owner: mixed")
      .replace("## Ordered flow", `${manualBlock}\n\n## Ordered flow`);
    await nodeFs.writeFile(nodePath.join(repoRoot, FLOW_PAGE_PATH), mixed, "utf8");

    const result = await runOnly({
      repoRoot,
      llmClient: llm,
      onlyTarget: FLOW_TARGET,
      noRefine: true,
      skipManifestWrite: true,
    });
    expect(result.status).toBe("completed");

    const page = await nodeFs.readFile(nodePath.join(repoRoot, FLOW_PAGE_PATH), "utf8");
    expect(page).toContain(manualBlock); // byte-for-byte
    expect(page).toMatch(/^owner: mixed$/m);
    expect(await fileExists(repoRoot, FLOW_DIAGRAM_PATH)).toBe(true);
  }, 60_000);

  it("--only flow:<slug> reruns one flow and keeps usage attempts monotonic", async () => {
    await writeFlowRepo(repoRoot);
    const first = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
    });
    expect(first.status).toBe("completed");
    const callsBefore = llm.callCount;

    const result = await runOnly({
      repoRoot,
      llmClient: llm,
      onlyTarget: FLOW_TARGET,
      noRefine: true,
      skipManifestWrite: true,
    });
    expect(result.status).toBe("completed");
    expect(llm.callCount).toBe(callsBefore + 1); // exactly one flow call, no module reruns
    expect(llm.flowCallCount).toBe(2);

    const checkpoint = await readTaskCheckpoint(repoRoot, 5, FLOW_TARGET);
    expect(checkpoint!.status).toBe("done");
    expect(checkpoint!.usageHistory.map((u) => u.attempt)).toEqual([1, 2]);
    expect(checkpoint!.diagnosticHistory!.map((d) => d.attempt)).toEqual([1, 2]);
  }, 60_000);

  it("unknown flow slug → same unknown-target behavior as modules", async () => {
    await writeFlowRepo(repoRoot);
    await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
    });
    await expect(
      runOnly({
        repoRoot,
        llmClient: llm,
        onlyTarget: "flow:no-such-flow",
        noRefine: true,
        skipManifestWrite: true,
      }),
    ).rejects.toThrow('flow "no-such-flow" not found in this run');
  }, 60_000);
});

describe("batch stage 5 — failure policy", () => {
  it("verify failure → rollback removes BOTH new files", async () => {
    await writeFlowRepo(repoRoot);
    // During the first stage-5 call, rename the persisted symbol and
    // re-index: the flow page (anchored to the old closed-list key) still
    // passes artifact validation but fails the repository-wide verify.
    llm.onBeforeFlowResponse = async (flowCallIndex) => {
      if (flowCallIndex !== 0) return;
      await nodeFs.writeFile(
        nodePath.join(repoRoot, "core/db.ts"),
        'export function connect2() { return "db"; }\n',
        "utf8",
      );
      await runIndexer(repoRoot, { quiet: true });
    };

    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
      maxRepairAttempts: 0,
    });

    expect(result.status).toBe("completed_with_failures");
    expect(result.failures.some((f) => f.module === FLOW_TARGET)).toBe(true);
    const checkpoint = await readTaskCheckpoint(repoRoot, 5, FLOW_TARGET);
    expect(checkpoint!.status).toBe("failed");
    expect(checkpoint!.diagnosticHistory![0]!.outcome).toBe("verify_failed");
    expect(checkpoint!.diagnosticHistory![0]!.errors.map((e) => e.code)).toContain(
      "broken_anchor",
    );
    // Both artifacts were new → both removed by the rollback.
    expect(await fileExists(repoRoot, FLOW_PAGE_PATH)).toBe(false);
    expect(await fileExists(repoRoot, FLOW_DIAGRAM_PATH)).toBe(false);
    // Stage-4 module work was NOT undone.
    expect(await fileExists(repoRoot, "livewiki/cli.md")).toBe(true);
    expect(await fileExists(repoRoot, "livewiki/core.md")).toBe(true);
  }, 60_000);

  it("llm_timeout during the stage-5 task → task failed, run continues", async () => {
    await writeFlowRepo(repoRoot);
    llm.throwOnFlowCall = { index: 0, error: new LlmTimeoutError("anthropic", 300_000) };

    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
    });

    expect(result.status).toBe("completed_with_failures");
    expect(llm.flowCallCount).toBe(1); // terminal — no repair retry
    const failure = result.failures.find((f) => f.module === FLOW_TARGET);
    expect(failure).toBeDefined();
    expect(failure!.error.code).toBe("llm_timeout");
    const checkpoint = await readTaskCheckpoint(repoRoot, 5, FLOW_TARGET);
    expect(checkpoint!.status).toBe("failed");
    expect(checkpoint!.error!.code).toBe("llm_timeout");
    expect(checkpoint!.usageHistory).toHaveLength(1);
    expect(checkpoint!.usageHistory[0]!.usageKnown).toBe(false);
    // The run continued: stage-4 module pages were produced and the run finalized.
    expect(result.byModule.some((m) => m.module === "cli")).toBe(true);
    expect(result.byModule.some((m) => m.module === "core")).toBe(true);
    expect(await fileExists(repoRoot, FLOW_PAGE_PATH)).toBe(false);
  }, 60_000);
});

describe("batch stage 5 — gating and cleanup", () => {
  it("maxFlows: 0 → no detection, no stage-5 tasks, no stale cleanup", async () => {
    await writeFlowRepo(repoRoot);
    await nodeFs.mkdir(nodePath.join(repoRoot, ".livewiki"), { recursive: true });
    await nodeFs.writeFile(
      nodePath.join(repoRoot, ".livewiki/config.json"),
      JSON.stringify({ maxFlows: 0 }),
      "utf8",
    );
    // Pre-existing stale generated flow artifacts: with the gate closed
    // they must be left alone (no cleanup pass at all).
    await nodeFs.mkdir(nodePath.join(repoRoot, "livewiki/flows"), { recursive: true });
    await nodeFs.writeFile(
      nodePath.join(repoRoot, FLOW_PAGE_PATH),
      "---\ntitle: Stale\nowner: generated\n---\n\n# Stale\n\nOld flow page.\n",
      "utf8",
    );

    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
    });

    expect(result.status).toBe("completed");
    expect(llm.flowCallCount).toBe(0);
    expect(await countStage5Tasks(repoRoot)).toBe(0);
    expect(await fileExists(repoRoot, FLOW_PAGE_PATH)).toBe(true);
  }, 60_000);

  it("zero candidates → run completes `completed`, no stage-5 rows (not an empty pipeline)", async () => {
    // Single-module repo: no root→sink walk of length ≥ 2 exists.
    await nodeFs.mkdir(nodePath.join(repoRoot, "src"), { recursive: true });
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "src/a.ts"),
      'import { b } from "./b";\nexport function a() { return b(); }\n',
      "utf8",
    );
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "src/b.ts"),
      "export function b() { return 1; }\n",
      "utf8",
    );

    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
    });

    expect(result.status).toBe("completed");
    expect(llm.flowCallCount).toBe(0);
    expect(await countStage5Tasks(repoRoot)).toBe(0);
    expect(await fileExists(repoRoot, "livewiki/flows")).toBe(false);
  }, 60_000);

  it("stale cleanup removes a disappeared generated candidate, preserves human pages", async () => {
    await writeFlowRepo(repoRoot);
    const first = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
    });
    expect(first.status).toBe("completed");
    expect(await fileExists(repoRoot, FLOW_PAGE_PATH)).toBe(true);
    expect(await fileExists(repoRoot, FLOW_DIAGRAM_PATH)).toBe(true);

    // The candidate disappears: no persistence file, no external imports.
    await nodeFs.rm(nodePath.join(repoRoot, "core/db.ts"));
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "core/helper.ts"),
      'export function connect() { return "db"; }\n',
      "utf8",
    );
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "cli/index.ts"),
      'import { connect } from "../core/helper";\nexport function main() { return connect(); }\n',
      "utf8",
    );
    // A human-owned flow page must be preserved by the same pass.
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "livewiki/flows/human-note.md"),
      "---\ntitle: Human note\nowner: human\n---\n\n# Human note\n\nHand-written.\n",
      "utf8",
    );

    const second = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
    });
    expect(second.status).toBe("completed");
    expect(llm.flowCallCount).toBe(1); // only run 1 called the flow generator

    expect(await fileExists(repoRoot, FLOW_PAGE_PATH)).toBe(false);
    expect(await fileExists(repoRoot, FLOW_DIAGRAM_PATH)).toBe(false);
    const human = await nodeFs.readFile(
      nodePath.join(repoRoot, "livewiki/flows/human-note.md"),
      "utf8",
    );
    expect(human).toContain("Hand-written.");
  }, 60_000);
});

// === R10.1 item A — transactional pair write under exceptions ===

describe("batch stage 5 — transactional pair write under exceptions (R10.1 A)", () => {
  it("second write throws after the first (directory collision at the diagram path) → page removed, directory untouched, write_verify_exception", async () => {
    await writeFlowRepo(repoRoot);
    // A directory sits where the companion diagram file must be written:
    // the page write succeeds, the diagram write throws.
    await nodeFs.mkdir(nodePath.join(repoRoot, FLOW_DIAGRAM_PATH), { recursive: true });

    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
      maxRepairAttempts: 0,
    });

    expect(result.status).toBe("completed_with_failures");
    const failure = result.failures.find((f) => f.module === FLOW_TARGET);
    expect(failure).toBeDefined();
    expect(failure!.error.code).toBe("write_verify_exception");
    expect(llm.flowCallCount).toBe(1); // terminal for the task — no repair retry

    // The already-written page was rolled back; the colliding directory is
    // pre-existing state (never created by the write) and must survive —
    // the guarded exception rollback only removes regular files the task
    // actually created.
    expect(await fileExists(repoRoot, FLOW_PAGE_PATH)).toBe(false);
    const stat = await nodeFs.lstat(nodePath.join(repoRoot, FLOW_DIAGRAM_PATH));
    expect(stat.isDirectory()).toBe(true);

    const checkpoint = await readTaskCheckpoint(repoRoot, 5, FLOW_TARGET);
    expect(checkpoint!.status).toBe("failed");
    expect(checkpoint!.error!.code).toBe("write_verify_exception");
    expect(checkpoint!.diagnosticHistory).toHaveLength(1);
    expect(checkpoint!.diagnosticHistory![0]!.outcome).toBe("write_verify_exception");
    expect(checkpoint!.diagnosticHistory![0]!.errors.map((e) => e.code)).toContain(
      "write_verify_exception",
    );
    // Stage-4 module work was NOT undone.
    expect(await fileExists(repoRoot, "livewiki/cli.md")).toBe(true);
    expect(await fileExists(repoRoot, "livewiki/core.md")).toBe(true);
  }, 60_000);

  it("verifier throws → newly created pair removed, task fails write_verify_exception, no repair retry", async () => {
    await writeFlowRepo(repoRoot);
    const verifyModule = await import("./verify.js");
    const realRun = verifyModule.run;
    let armed = false;
    let crashed = false;
    const spy = vi.spyOn(verifyModule, "run").mockImplementation(async (root: string) => {
      if (armed && !crashed) {
        crashed = true;
        throw new Error("simulated verifier crash");
      }
      return realRun(root);
    });
    // Arm only when the first stage-5 call is in flight — the stage-4
    // verifies (module pages) must run normally.
    llm.onBeforeFlowResponse = (flowCallIndex) => {
      if (flowCallIndex === 0) armed = true;
    };

    try {
      const result = await runBatch({
        repoRoot,
        llmClient: llm,
        noRefine: true,
        skipManifestWrite: true,
        maxRepairAttempts: 0,
      });

      expect(crashed).toBe(true);
      expect(result.status).toBe("completed_with_failures");
      const failure = result.failures.find((f) => f.module === FLOW_TARGET);
      expect(failure).toBeDefined();
      expect(failure!.error.code).toBe("write_verify_exception");
      expect(llm.flowCallCount).toBe(1); // terminal for the task — no repair retry

      // Both artifacts were new → both removed by the exception rollback.
      expect(await fileExists(repoRoot, FLOW_PAGE_PATH)).toBe(false);
      expect(await fileExists(repoRoot, FLOW_DIAGRAM_PATH)).toBe(false);
      // Stage-4 module work was NOT undone.
      expect(await fileExists(repoRoot, "livewiki/cli.md")).toBe(true);
      expect(await fileExists(repoRoot, "livewiki/core.md")).toBe(true);

      const checkpoint = await readTaskCheckpoint(repoRoot, 5, FLOW_TARGET);
      expect(checkpoint!.status).toBe("failed");
      expect(checkpoint!.error!.code).toBe("write_verify_exception");
      expect(checkpoint!.diagnosticHistory![0]!.outcome).toBe("write_verify_exception");
      expect(checkpoint!.usageHistory).toHaveLength(1);
      expect(checkpoint!.usageHistory[0]!.usageKnown).toBe(true);
    } finally {
      spy.mockRestore();
    }
  }, 60_000);

  it("verifier throws with an existing generated pair → both snapshots restored byte-for-byte", async () => {
    await writeFlowRepo(repoRoot);
    const first = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
    });
    expect(first.status).toBe("completed");
    const pageBefore = await nodeFs.readFile(nodePath.join(repoRoot, FLOW_PAGE_PATH), "utf8");
    const diagramBefore = await nodeFs.readFile(nodePath.join(repoRoot, FLOW_DIAGRAM_PATH), "utf8");

    // The rerun rewrites BOTH artifacts with different content; the
    // verifier then crashes, so the rollback must restore the snapshots
    // (not remove the files).
    llm.flowResponder = (ctx) => makeFlowPage(ctx, "flowchart LR\n  x --> y");
    const verifyModule = await import("./verify.js");
    const realRun = verifyModule.run;
    let crashed = false;
    const spy = vi.spyOn(verifyModule, "run").mockImplementation(async (root: string) => {
      if (!crashed) {
        crashed = true;
        throw new Error("simulated verifier crash");
      }
      return realRun(root);
    });

    try {
      const result = await runOnly({
        repoRoot,
        llmClient: llm,
        onlyTarget: FLOW_TARGET,
        noRefine: true,
        skipManifestWrite: true,
      });

      expect(crashed).toBe(true);
      expect(result.status).toBe("completed_with_failures");
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0]!.error.code).toBe("write_verify_exception");

      // Snapshots restored byte-for-byte — NOT removed.
      expect(await nodeFs.readFile(nodePath.join(repoRoot, FLOW_PAGE_PATH), "utf8")).toBe(
        pageBefore,
      );
      expect(
        await nodeFs.readFile(nodePath.join(repoRoot, FLOW_DIAGRAM_PATH), "utf8"),
      ).toBe(diagramBefore);
    } finally {
      spy.mockRestore();
    }
  }, 60_000);

  it("rollback failure after the exception → rollback_failed aborts the ENTIRE run", async () => {
    await writeFlowRepo(repoRoot);
    const verifyModule = await import("./verify.js");
    const realRun = verifyModule.run;
    let armed = false;
    const spy = vi.spyOn(verifyModule, "run").mockImplementation(async (root: string) => {
      if (armed) throw new Error("simulated verifier crash");
      return realRun(root);
    });
    llm.onBeforeFlowResponse = (flowCallIndex) => {
      if (flowCallIndex === 0) armed = true;
    };
    // The rollback itself breaks (same simulation as the stage-4 review-#4 test).
    const removeSpy = vi.spyOn(safeIo, "remove").mockImplementation(async () => {
      throw new Error("simulated rollback failure");
    });

    try {
      const result = await runBatch({
        repoRoot,
        llmClient: llm,
        noRefine: true,
        skipManifestWrite: true,
        maxRepairAttempts: 0,
      });

      // Terminal for the ENTIRE run — identical semantics to the
      // rejection-triggered rollback failure.
      expect(result.status).toBe("aborted");
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0]!.module).toBe(FLOW_TARGET);
      expect(result.failures[0]!.error.code).toBe("rollback_failed");
      const checkpoint = await readTaskCheckpoint(repoRoot, 5, FLOW_TARGET);
      expect(checkpoint!.status).toBe("failed");
      expect(checkpoint!.error!.code).toBe("rollback_failed");
    } finally {
      spy.mockRestore();
      removeSpy.mockRestore();
    }
  }, 60_000);
});

// === R10.1 item B — stage-5 write gate rejects warnings on written paths ===

describe("batch stage 5 — write gate severity (R10.1 B)", () => {
  it("broken_internal_link WARNING on the flow page → repair round; fixed second response lands", async () => {
    await writeFlowRepo(repoRoot);
    llm.flowResponder = (ctx, idx) => {
      const page = makeFlowPage(ctx, "flowchart LR\n  cli --> core");
      return idx === 0
        ? page.replace("## Related pages", "## Related pages\n\n- [missing](./missing.md)")
        : page;
    };

    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
    });

    expect(result.status).toBe("completed");
    expect(llm.flowCallCount).toBe(2);
    const checkpoint = await readTaskCheckpoint(repoRoot, 5, FLOW_TARGET);
    expect(checkpoint!.status).toBe("done");
    expect(checkpoint!.diagnosticHistory).toHaveLength(2);
    // The WARNING feeds the repair loop exactly like an error.
    expect(checkpoint!.diagnosticHistory![0]!.outcome).toBe("verify_failed");
    expect(checkpoint!.diagnosticHistory![0]!.errors.map((e) => e.code)).toContain(
      "broken_internal_link",
    );
    expect(checkpoint!.diagnosticHistory![1]!.outcome).toBe("success");
    const repairCall = llm.callLog.filter((c) => /^# Flow: /m.test(c.user))[1]!;
    // Etapa 2a: the repair prompt names the REAL verify issue code (no
    // longer collapsed into `verify_failed`).
    expect(repairCall.user).toContain("broken_internal_link");
    expect(repairCall.user).toContain("missing.md");

    const page = await nodeFs.readFile(nodePath.join(repoRoot, FLOW_PAGE_PATH), "utf8");
    expect(page).not.toContain("missing.md");
    expect(await fileExists(repoRoot, FLOW_DIAGRAM_PATH)).toBe(true);
  }, 60_000);

  it("hub linked as ../index.md → repair round; the bare index.md retry lands and verify ends clean", async () => {
    await writeFlowRepo(repoRoot);
    // The MiniMax-M3 generalization: module links use `../<moduleId>.md`, so
    // the model writes the flows hub as `../index.md` — which resolves to
    // livewiki/index.md (nonexistent) and trips the write gate.
    llm.flowResponder = (ctx, idx) => {
      const page = makeFlowPage(ctx, "flowchart LR\n  cli --> core");
      return idx === 0
        ? page.replace("## Related pages", "## Related pages\n\n- [How it works](../index.md)")
        : page.replace("## Related pages", "## Related pages\n\n- [How it works](index.md)");
    };

    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
    });

    expect(result.status).toBe("completed");
    // Two flow LLM calls: the rejected attempt and the repair.
    expect(llm.flowCallCount).toBe(2);
    const checkpoint = await readTaskCheckpoint(repoRoot, 5, FLOW_TARGET);
    expect(checkpoint!.status).toBe("done");
    expect(checkpoint!.diagnosticHistory).toHaveLength(2);
    expect(checkpoint!.diagnosticHistory![0]!.outcome).toBe("verify_failed");
    expect(checkpoint!.diagnosticHistory![0]!.errors.map((e) => e.code)).toContain(
      "broken_internal_link",
    );
    expect(checkpoint!.diagnosticHistory![1]!.outcome).toBe("success");
    // The repair request names the failure and carries the bare-target ACTION.
    const repairCall = llm.callLog.filter((c) => /^# Flow: /m.test(c.user))[1]!;
    // Etapa 2a: the repair prompt names the REAL verify issue code (no
    // longer collapsed into `verify_failed`); the bare-target ACTION hangs
    // on `broken_internal_link` itself.
    expect(repairCall.user).toContain("broken_internal_link");
    expect(repairCall.user).toContain("must be the bare `index.md` target");

    const page = await nodeFs.readFile(nodePath.join(repoRoot, FLOW_PAGE_PATH), "utf8");
    expect(page).toContain("(index.md)");
    expect(page).not.toContain("../index.md");
    // Verify ends clean on the flow artifacts.
    const verify = await runVerify(repoRoot);
    expect(
      verify.issues.filter(
        (i) => i.wikiPath === FLOW_PAGE_PATH || i.wikiPath === FLOW_DIAGRAM_PATH,
      ),
    ).toEqual([]);
  }, 60_000);

  it("warning never fixed → task fails and no artifact persists", async () => {
    await writeFlowRepo(repoRoot);
    llm.flowResponder = (ctx) =>
      makeFlowPage(ctx, "flowchart LR\n  cli --> core").replace(
        "## Related pages",
        "## Related pages\n\n- [missing](./missing.md)",
      );

    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
      maxRepairAttempts: 0,
    });

    expect(result.status).toBe("completed_with_failures");
    const failure = result.failures.find((f) => f.module === FLOW_TARGET);
    expect(failure).toBeDefined();
    const checkpoint = await readTaskCheckpoint(repoRoot, 5, FLOW_TARGET);
    expect(checkpoint!.status).toBe("failed");
    expect(checkpoint!.diagnosticHistory![0]!.outcome).toBe("verify_failed");
    expect(checkpoint!.diagnosticHistory![0]!.errors.map((e) => e.code)).toContain(
      "broken_internal_link",
    );
    expect(await fileExists(repoRoot, FLOW_PAGE_PATH)).toBe(false);
    expect(await fileExists(repoRoot, FLOW_DIAGRAM_PATH)).toBe(false);
    // Stage-4 module work was NOT undone.
    expect(await fileExists(repoRoot, "livewiki/cli.md")).toBe(true);
  }, 60_000);

  it("pre-existing issues on OTHER paths never block the stage-5 gate", async () => {
    await writeFlowRepo(repoRoot);
    // An error-severity issue (broken anchor) on a page the flow task does
    // not write. A repo-wide any-severity filter would trip on this — the
    // gate must stay scoped to the written paths.
    await nodeFs.mkdir(nodePath.join(repoRoot, "livewiki"), { recursive: true });
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "livewiki/notes.md"),
      [
        "---",
        "title: notes",
        "owner: human",
        "anchors:",
        "  - src/ghost.ts#ghost",
        "---",
        "",
        "# notes",
        "",
        "Human page anchored to a symbol that does not exist.",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
    });

    expect(result.status).toBe("completed");
    expect(llm.flowCallCount).toBe(1);
    expect(await fileExists(repoRoot, FLOW_PAGE_PATH)).toBe(true);
    expect(await fileExists(repoRoot, FLOW_DIAGRAM_PATH)).toBe(true);

    // The pre-existing issue was really there, repo-wide, during the run.
    const verify = await runVerify(repoRoot);
    expect(
      verify.issues.some(
        (i) =>
          i.wikiPath === "livewiki/notes.md" &&
          i.code === "broken_anchor" &&
          i.severity === "error",
      ),
    ).toBe(true);
    // And the flow artifacts themselves are clean.
    expect(
      verify.issues.filter(
        (i) => i.wikiPath === FLOW_PAGE_PATH || i.wikiPath === FLOW_DIAGRAM_PATH,
      ),
    ).toEqual([]);
  }, 60_000);
});

// === Etapa 2a — closed repair contract: early abort (stage 5 flows) ===
describe("batch stage 5 — Etapa 2a early abort on unrepairable verify sets", () => {
  it("all-unclassified verify set on the flow page aborts with `unrepairable` after ZERO flow repair calls", async () => {
    await writeFlowRepo(repoRoot);
    const verifyModule = await import("./verify.js");
    const realRun = verifyModule.run;
    // While the flow candidate is on disk (the write+verify window), every
    // verify call reports ONLY `manual_block_altered` on it — human content
    // is never model-repaired (rule #6), so no paid repair call may burn.
    const spy = vi.spyOn(verifyModule, "run").mockImplementation(async (root: string) => {
      const real = await realRun(root);
      if (!(await fileExists(root, FLOW_PAGE_PATH))) return real;
      return {
        ...real,
        ok: false,
        issues: [
          {
            severity: "error" as const,
            code: "manual_block_altered" as const,
            wikiPath: FLOW_PAGE_PATH,
            detail: "lw:manual block hash diverges from the baseline",
          },
        ],
      };
    });

    try {
      const result = await runBatch({
        repoRoot,
        llmClient: llm,
        noRefine: true,
        skipManifestWrite: true,
      });

      // Exactly ONE flow LLM call (the initial generation) — zero repairs.
      expect(llm.flowCallCount).toBe(1);
      expect(result.status).toBe("completed_with_failures");
      const failure = result.failures.find((f) => f.module === FLOW_TARGET);
      expect(failure).toBeDefined();
      // Distinct from `repair_exhausted`, with the codes + reasons rendered.
      expect(failure!.error.code).toBe("unrepairable");
      expect(failure!.error.message).toContain("[manual_block_altered]");
      expect(failure!.error.message).toContain("rule #6");

      const checkpoint = await readTaskCheckpoint(repoRoot, 5, FLOW_TARGET);
      expect(checkpoint!.status).toBe("failed");
      expect(checkpoint!.error?.code).toBe("unrepairable");
      // Rolled back — nothing invalid persists; stage-4 work is untouched.
      expect(await fileExists(repoRoot, FLOW_PAGE_PATH)).toBe(false);
      expect(await fileExists(repoRoot, FLOW_DIAGRAM_PATH)).toBe(false);
      expect(await fileExists(repoRoot, "livewiki/cli.md")).toBe(true);
    } finally {
      spy.mockRestore();
    }
  }, 60_000);
});

describe("batch stage 5 — flows hub ownership (R10.1 C)", () => {
  it("human flow and auxiliary hubs are preserved byte-for-byte and surfaced", async () => {
    await writeFlowRepo(repoRoot);
    await nodeFs.mkdir(nodePath.join(repoRoot, ".livewiki"), { recursive: true });
    await nodeFs.writeFile(
      nodePath.join(repoRoot, ".livewiki/config.json"),
      JSON.stringify({ maxTopics: 0 }),
      "utf8",
    );
    await nodeFs.mkdir(nodePath.join(repoRoot, "test/fixtures/example"), { recursive: true });
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "test/fixtures/example/value.ts"),
      "export function fixtureValue() { return 1; }\n",
      "utf8",
    );
    const humanHub = "---\ntitle: My flows\nowner: human\n---\n# My flows\n";
    const humanAuxiliaryHub =
      "---\ntitle: My auxiliary guide\nowner: human\n---\n# My auxiliary guide\n";
    await nodeFs.mkdir(nodePath.join(repoRoot, "livewiki/flows"), { recursive: true });
    await nodeFs.mkdir(nodePath.join(repoRoot, "livewiki/auxiliary"), { recursive: true });
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "livewiki/flows/index.md"),
      humanHub,
      "utf8",
    );
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "livewiki/auxiliary/index.md"),
      humanAuxiliaryHub,
      "utf8",
    );

    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
    });

    expect(result.failures).toEqual([]);
    expect(result.status).toBe("completed");
    expect(llm.flowCallCount).toBe(1);
    // Never silent: the run result reports the preserved hub (path + owner).
    expect(result.skippedFlowsHub).toEqual({
      path: "livewiki/flows/index.md",
      owner: "human",
    });
    expect(result.skippedAuxiliaryHub).toEqual({
      path: "livewiki/auxiliary/index.md",
      owner: "human",
    });
    // The hub is byte-for-byte intact — the flat list has no anchored
    // sections, so regeneration is skipped instead of risking manual content.
    expect(
      await nodeFs.readFile(nodePath.join(repoRoot, "livewiki/flows/index.md"), "utf8"),
    ).toBe(humanHub);
    expect(
      await nodeFs.readFile(nodePath.join(repoRoot, "livewiki/auxiliary/index.md"), "utf8"),
    ).toBe(humanAuxiliaryHub);
  }, 60_000);

  it("a generated hub is rewritten by the post-stage regeneration (no skip)", async () => {
    await writeFlowRepo(repoRoot);

    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
    });

    expect(result.status).toBe("completed");
    expect(result.skippedFlowsHub).toBeUndefined();
    const hub = await nodeFs.readFile(
      nodePath.join(repoRoot, "livewiki/flows/index.md"),
      "utf8",
    );
    expect(hub).toContain("owner: generated");
    expect(hub).toContain(`### [CLI to core flow](${FLOW_SLUG}.md)`);
  }, 60_000);

  it("a contract-required `index.md` link passes the write gate on a fresh repo (hub synced in-transaction)", async () => {
    await writeFlowRepo(repoRoot);
    // The prompt contract (prompts.ts FLOW_PAGE_PROMPT_RULES) requires the
    // Related pages link to `index.md`; the hub must exist before verify or
    // the R10.1 B gate flags broken_internal_link on every fresh-repo flow.
    llm.flowResponder = (ctx) =>
      makeFlowPage(ctx, "flowchart LR\n  cli --> core").replace(
        "## Related pages",
        "## Related pages\n\n- [How it works](index.md)",
      );

    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
    });

    expect(result.status).toBe("completed");
    expect(llm.flowCallCount).toBe(1);
    const checkpoint = await readTaskCheckpoint(repoRoot, 5, FLOW_TARGET);
    expect(checkpoint!.status).toBe("done");
    const hub = await nodeFs.readFile(
      nodePath.join(repoRoot, "livewiki/flows/index.md"),
      "utf8",
    );
    expect(hub).toContain(`### [CLI to core flow](${FLOW_SLUG}.md)`);
    const page = await nodeFs.readFile(nodePath.join(repoRoot, FLOW_PAGE_PATH), "utf8");
    expect(page).toContain("- [How it works](index.md)");
  }, 60_000);

  it("a rejected pair rolls the freshly synced hub back too (no hub left behind)", async () => {
    await writeFlowRepo(repoRoot);
    llm.flowResponder = (ctx) =>
      makeFlowPage(ctx, "flowchart LR\n  cli --> core").replace(
        "## Related pages",
        "## Related pages\n\n- [How it works](index.md)\n- [missing](./missing.md)",
      );

    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
      maxRepairAttempts: 0,
    });

    expect(result.status).toBe("completed_with_failures");
    expect(await fileExists(repoRoot, FLOW_PAGE_PATH)).toBe(false);
    expect(await fileExists(repoRoot, FLOW_DIAGRAM_PATH)).toBe(false);
    // The hub written inside the transaction is removed with the pair —
    // otherwise it would link to a flow page that never persisted.
    expect(await fileExists(repoRoot, "livewiki/flows/index.md")).toBe(false);
  }, 60_000);
});

// === R10.1 item K — seed groups reach prompt/validator; deterministic skips ===

/**
 * Flow page with explicit per-section key citation (dual completeness).
 * `diagramSource` is unused (kept for call-site compat) — the LLM no
 * longer writes `## Diagram`; the orchestrator inserts it.
 */
function makeFlowPageWithSections(
  ctx: FlowPromptCtx,
  sections: { purpose: string[]; ordered: string[]; failure: string[] },
  _diagramSource: string,
): string {
  const cited = [...sections.purpose, ...sections.ordered, ...sections.failure];
  return [
    "---",
    "title: Group flow",
    "owner: generated",
    "anchors:",
    ...cited.map((k) => `  - ${k}`),
    "modules:",
    ...ctx.moduleIds.map((m) => `  - ${m}`),
    "updated: 2026-07-19",
    "---",
    "",
    "# Group flow",
    "",
    "This page explains how the entry drives the handler down to storage.",
    "",
    "## Purpose",
    "",
    `<!-- lw:anchors ${sections.purpose.join(" ")} -->`,
    "",
    "The entry starts the flow and storage persists the result.",
    "",
    "## Ordered flow",
    "",
    `<!-- lw:anchors ${sections.ordered.join(" ")} -->`,
    "",
    "1. The entry parses the invocation.",
    "2. The handler persists via the store.",
    "",
    "## Invariants",
    "",
    "- Every step preserves the input payload.",
    "",
    "## Failure and recovery",
    "",
    `<!-- lw:anchors ${sections.failure.join(" ")} -->`,
    "",
    "The supplied source shows no retry or rollback path; the flow fails open.",
    "",
    "## Related pages",
    "",
    ...ctx.moduleIds.map((m) => `- [${m} module](../${m}.md)`),
    "",
  ].join("\n");
}

/**
 * Repo whose flow candidate has DISJOINT entry/crossing/sink evidence:
 * the entry file has no imports, the crossing import lives in a sibling
 * file, and the sink module carries a second untouched file (so T2 and
 * T3 do not fully overlap).
 */
async function writeGroupFlowRepo(root: string): Promise<void> {
  await nodeFs.mkdir(nodePath.join(root, "cli"), { recursive: true });
  await nodeFs.mkdir(nodePath.join(root, "core"), { recursive: true });
  await nodeFs.writeFile(
    nodePath.join(root, "cli/cli.ts"),
    "export function run() { return 1; }\n",
    "utf8",
  );
  await nodeFs.writeFile(
    nodePath.join(root, "cli/handler.ts"),
    'import { connect } from "../core/db";\nexport function handle() { return connect(); }\n',
    "utf8",
  );
  await nodeFs.writeFile(
    nodePath.join(root, "cli/util.ts"),
    "export function util() { return 1; }\n",
    "utf8",
  );
  await nodeFs.writeFile(
    nodePath.join(root, "core/db.ts"),
    'export function connect() { return "db"; }\n',
    "utf8",
  );
  await nodeFs.writeFile(
    nodePath.join(root, "core/store.ts"),
    "export function save() { return 1; }\n",
    "utf8",
  );
}

describe("batch stage 5 — semantic groups reach prompt and validator (R10.1 K)", () => {
  it("the prompt lists the groups and a page citing each group passes", async () => {
    await writeGroupFlowRepo(repoRoot);
    await nodeFs.mkdir(nodePath.join(repoRoot, ".livewiki"), { recursive: true });
    await nodeFs.writeFile(
      nodePath.join(repoRoot, ".livewiki/config.json"),
      JSON.stringify({ maxTopics: 0 }),
      "utf8",
    );
    llm.flowResponder = (ctx) =>
      makeFlowPageWithSections(
        ctx,
        {
          purpose: ["cli/cli.ts#run"],
          ordered: ["cli/handler.ts#handle"],
          failure: ["core/db.ts#connect"],
        },
        "flowchart LR\n  cli --> core",
      );

    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
    });

    expect(result.status).toBe("completed");
    expect(llm.flowCallCount).toBe(1);
    // The initial prompt carries the candidate's explicit semantic groups.
    const flowCall = llm.callLog.find((c) => /^# Flow: /m.test(c.user))!;
    expect(flowCall.user).toContain("# Semantic key groups");
    expect(flowCall.user).toContain("- entry keys: cli/cli.ts#run");
    // Priority-0 Phase 3: `handle()` really calls `connect()` across the
    // module boundary (see writeGroupFlowRepo) — the resolved call graph
    // promotes the call-verified key ahead of its path-heuristic sibling
    // within the tied T2 group.
    expect(flowCall.user).toContain("- boundary keys: core/db.ts#connect, cli/handler.ts#handle");
    expect(flowCall.user).toContain("- sink keys: core/db.ts#connect, core/store.ts#save");

    const checkpoint = await readTaskCheckpoint(repoRoot, 5, FLOW_TARGET);
    expect(checkpoint!.status).toBe("done");
    const verify = await runVerify(repoRoot);
    expect(
      verify.issues.filter(
        (i) => i.wikiPath === FLOW_PAGE_PATH || i.wikiPath === FLOW_DIAGRAM_PATH,
      ),
    ).toEqual([]);
  }, 60_000);

  it("a page that cites no boundary-group key is rejected with anchor_missing_required_tier (repairable)", async () => {
    await writeGroupFlowRepo(repoRoot);
    await nodeFs.mkdir(nodePath.join(repoRoot, ".livewiki"), { recursive: true });
    await nodeFs.writeFile(
      nodePath.join(repoRoot, ".livewiki/config.json"),
      JSON.stringify({ maxTopics: 0 }),
      "utf8",
    );
    llm.flowResponder = (ctx, idx) =>
      idx === 0
        ? // entry + sink + T4 cited; the boundary group is left uncited.
          makeFlowPageWithSections(
            ctx,
            {
              purpose: ["cli/cli.ts#run"],
              ordered: ["core/store.ts#save"],
              failure: ["cli/util.ts#util"],
            },
            "flowchart LR\n  cli --> core",
          )
        : makeFlowPageWithSections(
            ctx,
            {
              purpose: ["cli/cli.ts#run"],
              ordered: ["cli/handler.ts#handle"],
              failure: ["core/db.ts#connect"],
            },
            "flowchart LR\n  cli --> core",
          );

    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
    });

    expect(result.status).toBe("completed");
    expect(llm.flowCallCount).toBe(2);
    const checkpoint = await readTaskCheckpoint(repoRoot, 5, FLOW_TARGET);
    expect(checkpoint!.status).toBe("done");
    expect(checkpoint!.diagnosticHistory).toHaveLength(2);
    expect(checkpoint!.diagnosticHistory![0]!.outcome).toBe("artifact_validation_failed");
    expect(checkpoint!.diagnosticHistory![0]!.errors.map((e) => e.code)).toContain(
      "anchor_missing_required_tier",
    );
    expect(checkpoint!.diagnosticHistory![1]!.outcome).toBe("success");

    // R10.1 D: the repair attempt receives the same semantic key groups
    // as the initial prompt — asserted on the recorded request.
    const flowCalls = llm.callLog.filter((c) => /^# Flow: /m.test(c.user));
    expect(flowCalls).toHaveLength(2);
    const repairCall = flowCalls[1]!;
    expect(repairCall.user).toContain("anchor_missing_required_tier");
    expect(repairCall.user).toContain("# Semantic key groups");
    expect(repairCall.user).toContain("- entry keys: cli/cli.ts#run");
    // Priority-0 Phase 3: the resolved call graph promotes the call-verified
    // key (core/db.ts#connect) ahead of its path-heuristic sibling.
    expect(repairCall.user).toContain("- boundary keys: core/db.ts#connect, cli/handler.ts#handle");
    expect(repairCall.user).toContain("- sink keys: core/db.ts#connect, core/store.ts#save");
    // The corrected page landed.
    expect(await fileExists(repoRoot, FLOW_PAGE_PATH)).toBe(true);
  }, 60_000);
});

describe("batch stage 5 — deterministic pre-LLM seed skips (R10.1 K)", () => {
  it("K-b: flowMaxAnchors 2 → skip recorded on the result, no task, no LLM call, run completed", async () => {
    await writeFlowRepo(repoRoot);
    await nodeFs.mkdir(nodePath.join(repoRoot, ".livewiki"), { recursive: true });
    await nodeFs.writeFile(
      nodePath.join(repoRoot, ".livewiki/config.json"),
      JSON.stringify({ flowMaxAnchors: 2, maxTopics: 0 }),
      "utf8",
    );

    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
    });

    // A skip is not a failure: deterministic, decided before any LLM call.
    expect(result.status).toBe("completed");
    expect(llm.flowCallCount).toBe(0);
    expect(await countStage5Tasks(repoRoot)).toBe(0); // no task created
    expect(result.skippedFlowCandidates).toHaveLength(1);
    expect(result.skippedFlowCandidates![0]!.slug).toBe(FLOW_SLUG);
    expect(result.skippedFlowCandidates![0]!.code).toBe(
      "insufficient_section_anchor_coverage",
    );
    expect(await fileExists(repoRoot, FLOW_PAGE_PATH)).toBe(false);
    expect(await fileExists(repoRoot, FLOW_DIAGRAM_PATH)).toBe(false);
  }, 60_000);

  it("K-a: cap below the mandatory group reservation → skip recorded, no task created", async () => {
    await writeGroupFlowRepo(repoRoot);
    await nodeFs.mkdir(nodePath.join(repoRoot, ".livewiki"), { recursive: true });
    // Priority-0 Phase 3: the resolved call graph (handle() really calls
    // connect() — see writeGroupFlowRepo) now lets ONE key (core/db.ts#connect)
    // cover BOTH the boundary and sink reservations, so the mandatory
    // reservation shrinks from 3 keys to 2. flowMaxAnchors must drop to 1
    // (not 2) to still land below it and trigger K-a here.
    await nodeFs.writeFile(
      nodePath.join(repoRoot, ".livewiki/config.json"),
      JSON.stringify({ flowMaxAnchors: 1, maxTopics: 0 }),
      "utf8",
    );

    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
    });

    expect(result.status).toBe("completed");
    expect(llm.flowCallCount).toBe(0);
    expect(await countStage5Tasks(repoRoot)).toBe(0);
    expect(result.skippedFlowCandidates).toHaveLength(1);
    expect(result.skippedFlowCandidates![0]!.slug).toBe(FLOW_SLUG);
    expect(result.skippedFlowCandidates![0]!.code).toBe("insufficient_anchor_capacity");
    expect(await fileExists(repoRoot, FLOW_PAGE_PATH)).toBe(false);
  }, 60_000);
});

describe("batch stage 5 — topic-plan is proposed deterministically (Workstream B)", () => {
  // Workstream B: the topic PLAN itself is proposed by the tool
  // (`proposeTopicPlanDeterministically`), not the LLM — there is no more
  // propose-from-scratch prompt and no repair loop that can "exhaust."
  // The LLM's only remaining role for planning is a narrow, OPTIONAL
  // refine pass (`buildTopicRefinePrompt`), identifiable by its distinct
  // system-prompt framing (never present in a flow or module-page prompt).
  function isTopicRefineRequest(req: GenerateRequest): boolean {
    return req.system.includes("information-architecture editor");
  }

  /** Minimal compliant topic page (5 required H2 sections, each citing >= 1 distinct key). */
  function makeTopicPage(user: string): string {
    const title = /^# Accepted title: (.+)$/m.exec(user)?.[1] ?? "Topic";
    const order = /^# Accepted order: (\d+)$/m.exec(user)?.[1] ?? "1";
    const intent = /^# Accepted intent: (.+)$/m.exec(user)?.[1] ?? "Explain the topic.";
    const modules = (/^# Required modules: (.+)$/m.exec(user)?.[1] ?? "")
      .split(",").map((s) => s.trim()).filter(Boolean);
    const flowsRaw = /^# Required flows: (.+)$/m.exec(user)?.[1] ?? "(none)";
    const flows = flowsRaw === "(none)" ? [] : flowsRaw.split(",").map((s) => s.trim()).filter(Boolean);
    const closedKeys = parseClosedKeys(user);
    const sections = ["Purpose", "When to use this page", "Behavioral contract", "Failure and recovery", "Change map"];
    const citedByIndex = sections.map((_, i) => closedKeys[i % closedKeys.length]!);

    return [
      "---",
      `title: ${title}`,
      "owner: generated",
      "kind: topic",
      `order: ${order}`,
      `intent: ${intent}`,
      "modules:",
      ...modules.map((m) => `  - ${m}`),
      "flows:",
      ...flows.map((f) => `  - ${f}`),
      "anchors:",
      ...citedByIndex.map((k) => `  - ${k}`),
      "updated: 2026-07-21",
      "---",
      "",
      `# ${title}`,
      "",
      "This page explains how these modules coordinate as one cross-module concept.",
      "",
      `## ${sections[0]}`,
      "",
      `<!-- lw:anchors ${citedByIndex[0]} -->`,
      "",
      "The contract begins with this evidence.",
      "",
      `## ${sections[1]}`,
      "",
      `<!-- lw:anchors ${citedByIndex[1]} -->`,
      "",
      "Use this page when changing cross-module behavior.",
      "",
      `## ${sections[2]}`,
      "",
      `<!-- lw:anchors ${citedByIndex[2]} -->`,
      "",
      "The behavioral contract is documented here.",
      "",
      `## ${sections[3]}`,
      "",
      `<!-- lw:anchors ${citedByIndex[3]} -->`,
      "",
      "No retry or rollback path is shown; the flow fails open.",
      "",
      `## ${sections[4]}`,
      "",
      `<!-- lw:anchors ${citedByIndex[4]} -->`,
      "",
      "Changing this behavior requires updating the modules listed above.",
      "",
      "## Related pages",
      "",
      "- [Topics hub](index.md)",
      ...modules.map((m) => `- [${m} module](../${m}.md)`),
      ...flows.flatMap((f) => [
        `- [${f} flow](../flows/${f}.md)`,
        `- [${f} diagram](../diagrams/flow-${f}.mmd)`,
      ]),
      "",
    ].join("\n");
  }

  class TopicMockLlm implements LlmClient {
    public readonly provider = "anthropic" as const;
    public readonly model = "claude-test-mock";
    public topicRefineCallCount = 0;
    public topicPageCallCount = 0;
    public refineBehavior: "reject" | "accept" = "accept";

    async generate(req: GenerateRequest): Promise<GenerateResult> {
      const usage = { inputTokens: 100, outputTokens: 50, model: this.model };
      if (/^# Flow: \S+$/m.test(req.user)) {
        return { content: makeFlowPage(parseFlowPrompt(req.user), "flowchart LR\n  cli --> core"), usage };
      }
      if (isTopicRefineRequest(req)) {
        this.topicRefineCallCount++;
        if (this.refineBehavior === "reject") {
          return { content: "not valid json at all", usage };
        }
        // Echo the deterministic plan back unchanged — a legitimate,
        // trivial "refinement."
        const match = /# Deterministically proposed, already-valid topic plan.*?:\s*([\s\S]*?)\n\n# Output/.exec(req.user);
        return { content: match?.[1] ?? "{}", usage };
      }
      if (req.user.includes("# Accepted title:")) {
        this.topicPageCallCount++;
        return { content: makeTopicPage(req.user), usage };
      }
      const closedKeys = parseClosedKeys(req.user);
      return { content: makeValidPage(closedKeys), usage };
    }
  }

  async function writeTopicEligibleRepo(): Promise<void> {
    // Boost the fixture past the 5-anchor floor and 2-connected-product-
    // module threshold so a topic cluster is actually formed (writeFlowRepo
    // alone has only 3 symbols, below the gate — see the early no-op
    // branch in runSemanticTopicStage).
    await writeFlowRepo(repoRoot);
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "core/db.ts"),
      [
        'export function connect() { return "db"; }',
        "export function disconnect() {}",
        "export function query() {}",
        "",
      ].join("\n"),
      "utf8",
    );
  }

  it("--no-refine: proposes and writes a topic page with zero topic-plan LLM calls", async () => {
    await writeTopicEligibleRepo();
    const topicLlm = new TopicMockLlm();

    const result = await runBatch({
      repoRoot,
      llmClient: topicLlm,
      noRefine: true,
      skipManifestWrite: true,
    });

    expect(result.status).toBe("completed");
    expect(topicLlm.topicRefineCallCount).toBe(0);
    expect(result.failures.some((f) => f.module === "topic-plan")).toBe(false);
    expect(result.skippedTopicPlan).toBeUndefined();

    const checkpoint = await readTaskCheckpoint(repoRoot, 5, "topic-plan");
    expect(checkpoint).not.toBeNull();
    expect(checkpoint!.status).toBe("done");
    expect(checkpoint!.error).toBeUndefined();
    expect(checkpoint!.topicPlan?.length).toBeGreaterThan(0);

    expect(await fileExists(repoRoot, FLOW_PAGE_PATH)).toBe(true);
    expect(await fileExists(repoRoot, "livewiki/topics")).toBe(true);
  }, 60_000);

  it("a topic whose evidence exceeds topicMaxSourceChars fails the task without killing the run (Etapa 3 E2E)", async () => {
    // Real acceptance-run defect (2026-07-25, MoneyPrinterTurbo-Plus):
    // buildTopicDocContext's hard budget throw escaped the task loop and
    // killed init --batch mid-stage (run row left "running"). The failure
    // policy requires: mark the task, CONTINUE the run. Reproduced via
    // --only: the plan comes from the prior checkpoint (no planner budget
    // re-selection), and the tightened config budget makes the context
    // build throw deterministically.
    await writeTopicEligibleRepo();
    const topicLlm = new TopicMockLlm();
    const first = await runBatch({
      repoRoot,
      llmClient: topicLlm,
      noRefine: true,
      skipManifestWrite: true,
    });
    expect(first.status).toBe("completed");

    const plannerCheckpoint = await readTaskCheckpoint(repoRoot, 5, "topic-plan");
    const candidate = plannerCheckpoint!.topicPlan![0]!;
    const topicTarget = `topic:${candidate.evidenceHash}`;
    expect(first.failures.some((f) => f.module === topicTarget)).toBe(false);

    await nodeFs.writeFile(
      nodePath.join(repoRoot, ".livewiki/config.json"),
      JSON.stringify({ topicMaxSourceChars: 1 }), // any evidence exceeds it
      "utf8",
    );
    const callsBefore = topicLlm.topicPageCallCount;
    const result = await runOnly({
      repoRoot,
      llmClient: topicLlm,
      onlyTarget: topicTarget,
      noRefine: true,
      skipManifestWrite: true,
    });

    // The run SURVIVES: the topic task is marked failed, not fatal.
    expect(result.status).toBe("completed_with_failures");
    const topicFailure = result.failures.find((f) => f.module === topicTarget);
    expect(topicFailure).toBeDefined();
    expect(topicFailure!.error.code).toBe("context_build_exception");
    expect(topicFailure!.error.message).toContain("exceeds topicMaxSourceChars");
    // Not model-fixable ⇒ zero LLM calls burned on the topic page.
    expect(topicLlm.topicPageCallCount).toBe(callsBefore);

    const checkpoint = await readTaskCheckpoint(repoRoot, 5, topicTarget);
    expect(checkpoint).not.toBeNull();
    expect(checkpoint!.status).toBe("failed");
    expect(checkpoint!.error?.code).toBe("context_build_exception");
  }, 60_000);

  it("an LLM refine call that returns invalid JSON degrades silently to the deterministic plan (no failure, no skip)", async () => {
    await writeTopicEligibleRepo();
    const topicLlm = new TopicMockLlm();
    topicLlm.refineBehavior = "reject";

    const result = await runBatch({
      repoRoot,
      llmClient: topicLlm,
      skipManifestWrite: true,
    });

    expect(result.status).toBe("completed");
    expect(topicLlm.topicRefineCallCount).toBe(1); // exactly one refine attempt, no repair loop
    expect(result.failures.some((f) => f.module === "topic-plan")).toBe(false);
    expect(result.skippedTopicPlan).toBeUndefined();

    const checkpoint = await readTaskCheckpoint(repoRoot, 5, "topic-plan");
    expect(checkpoint).not.toBeNull();
    expect(checkpoint!.status).toBe("done");
    expect(checkpoint!.error).toBeUndefined();
    expect(checkpoint!.topicPlan?.length).toBeGreaterThan(0);
    expect(
      checkpoint!.diagnosticHistory?.some((d) => d.outcome === "artifact_validation_failed"),
    ).toBe(true);

    expect(await fileExists(repoRoot, "livewiki/topics")).toBe(true);
  }, 60_000);

  it("an accepted LLM refine echoes the same deterministic plan through cleanly", async () => {
    await writeTopicEligibleRepo();
    const topicLlm = new TopicMockLlm();
    topicLlm.refineBehavior = "accept";

    const result = await runBatch({
      repoRoot,
      llmClient: topicLlm,
      skipManifestWrite: true,
    });

    expect(result.status).toBe("completed");
    expect(topicLlm.topicRefineCallCount).toBe(1);
    expect(result.failures.some((f) => f.module === "topic-plan")).toBe(false);

    const checkpoint = await readTaskCheckpoint(repoRoot, 5, "topic-plan");
    expect(checkpoint!.status).toBe("done");
    expect(checkpoint!.topicPlan?.length).toBeGreaterThan(0);
  }, 60_000);

  // === Etapa 2a — topic stage: early abort + write-exception alignment ===

  /** First generated topic page on disk (excludes the deterministic hub). */
  async function findTopicPagePath(root: string): Promise<string | null> {
    try {
      const entries = await nodeFs.readdir(nodePath.join(root, "livewiki/topics"));
      const page = entries.find((e) => e.endsWith(".md") && e !== "index.md");
      return page !== undefined ? `livewiki/topics/${page}` : null;
    } catch {
      return null;
    }
  }

  async function readTopicTaskCheckpoint(root: string): Promise<TaskCheckpoint | null> {
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(nodePath.join(root, ".livewiki/index.db"), { readonly: true });
    try {
      const row = db
        .prepare("SELECT checkpoint_json FROM batch_tasks WHERE stage = 5 AND target LIKE 'topic:%'")
        .get() as { checkpoint_json: string | null } | undefined;
      return row?.checkpoint_json ? (JSON.parse(row.checkpoint_json) as TaskCheckpoint) : null;
    } finally {
      db.close();
    }
  }

  it("all-unclassified verify set on the topic page aborts with `unrepairable` after ZERO topic repair calls", async () => {
    await writeTopicEligibleRepo();
    const topicLlm = new TopicMockLlm();
    const verifyModule = await import("./verify.js");
    const realRun = verifyModule.run;
    const spy = vi.spyOn(verifyModule, "run").mockImplementation(async (root: string) => {
      const real = await realRun(root);
      const topicPage = await findTopicPagePath(root);
      if (topicPage === null) return real;
      return {
        ...real,
        ok: false,
        issues: [
          {
            severity: "error" as const,
            code: "manual_block_altered" as const,
            wikiPath: topicPage,
            detail: "lw:manual block hash diverges from the baseline",
          },
        ],
      };
    });

    try {
      const result = await runBatch({
        repoRoot,
        llmClient: topicLlm,
        noRefine: true,
        skipManifestWrite: true,
      });

      // Exactly ONE topic-page call (the initial generation) — the
      // all-unclassified verify set burns no repair slot.
      expect(topicLlm.topicPageCallCount).toBe(1);
      const topicFailure = result.failures.find((f) => f.module.startsWith("topic:"));
      expect(topicFailure).toBeDefined();
      expect(topicFailure!.error.code).toBe("unrepairable");
      expect(topicFailure!.error.message).toContain("[manual_block_altered]");
      expect(topicFailure!.error.message).toContain("rule #6");

      const checkpoint = await readTopicTaskCheckpoint(repoRoot);
      expect(checkpoint!.status).toBe("failed");
      expect(checkpoint!.error?.code).toBe("unrepairable");
      // The rejected candidate never persisted.
      expect(await findTopicPagePath(repoRoot)).toBeNull();
    } finally {
      spy.mockRestore();
    }
  }, 60_000);

  it("write/verify exception short-circuits the topic task (write_verify_exception) without burning repair slots", async () => {
    await writeTopicEligibleRepo();
    const topicLlm = new TopicMockLlm();
    const verifyModule = await import("./verify.js");
    const realRun = verifyModule.run;
    let crashed = false;
    const spy = vi.spyOn(verifyModule, "run").mockImplementation(async (root: string) => {
      const topicPage = await findTopicPagePath(root);
      if (!crashed && topicPage !== null) {
        crashed = true;
        throw new Error("simulated verifier crash on the topic write");
      }
      return realRun(root);
    });

    try {
      const result = await runBatch({
        repoRoot,
        llmClient: topicLlm,
        noRefine: true,
        skipManifestWrite: true,
      });

      expect(crashed).toBe(true);
      // Aligned with stages 4/5 (R10.1 item A): terminal for the task —
      // exactly ONE topic-page call, no repair retry.
      expect(topicLlm.topicPageCallCount).toBe(1);
      const topicFailure = result.failures.find((f) => f.module.startsWith("topic:"));
      expect(topicFailure).toBeDefined();
      expect(topicFailure!.error.code).toBe("write_verify_exception");
      expect(topicFailure!.error.message).toContain("not model-fixable");

      const checkpoint = await readTopicTaskCheckpoint(repoRoot);
      expect(checkpoint!.status).toBe("failed");
      expect(checkpoint!.error?.code).toBe("write_verify_exception");
      // The candidate was rolled back — no invalid topic page persists.
      expect(await findTopicPagePath(repoRoot)).toBeNull();
    } finally {
      spy.mockRestore();
    }
  }, 60_000);
});

describe("batch stage 5 — flow candidate skipped when a participating module failed (v-next paid E2E fix)", () => {
  // A flow spanning a module whose own stage-4 page never got written would
  // fail `verify` identically on every retry (its "Related pages" link cites
  // a page that does not exist) — the real failure shape seen in the
  // MoneyPrinterTurbo-Plus paid rerun (`flow:test-services-02-to-app-utils`,
  // 3 attempts, all `verify_failed [broken_internal_link]`, burning a full
  // repair budget on an unwinnable outcome).
  class OneModuleAlwaysTruncatesLlm implements LlmClient {
    public readonly provider = "anthropic" as const;
    public readonly model = "claude-test-mock";
    public flowCallCount = 0;

    async generate(req: GenerateRequest): Promise<GenerateResult> {
      const usage = { inputTokens: 100, outputTokens: 50, model: this.model };
      if (/^# Flow: \S+$/m.test(req.user)) {
        this.flowCallCount++;
        return { content: makeFlowPage(parseFlowPrompt(req.user), "flowchart LR\n  cli --> core"), usage };
      }
      const closedKeys = parseClosedKeys(req.user);
      // "core" module's page always truncates — it never produces a
      // written page, regardless of repair attempts.
      if (closedKeys.some((k) => k.startsWith("core/"))) {
        return { content: "# incomplete", usage, stopReason: "length", rawStopReason: "length" };
      }
      return { content: makeValidPage(closedKeys), usage };
    }
  }

  it("skips flow:cli-to-core deterministically instead of spending 3 LLM calls on a guaranteed verify failure", async () => {
    await writeFlowRepo(repoRoot);
    const llmClient = new OneModuleAlwaysTruncatesLlm();

    const result = await runBatch({
      repoRoot,
      llmClient,
      noRefine: true,
      skipManifestWrite: true,
    });

    // "core" failed stage-4 (repair_exhausted on truncation); "cli" succeeded.
    expect(result.failures.some((f) => f.module === "core")).toBe(true);
    expect(await fileExists(repoRoot, "livewiki/cli.md")).toBe(true);
    expect(await fileExists(repoRoot, "livewiki/core.md")).toBe(false);

    // The flow was never attempted — zero flow LLM calls, no task row.
    expect(llmClient.flowCallCount).toBe(0);
    expect(await countStage5Tasks(repoRoot)).toBe(0);
    expect(await fileExists(repoRoot, FLOW_PAGE_PATH)).toBe(false);

    // The skip is visible, not silent, with a clear retry-relevant reason.
    const skipped = result.skippedFlowCandidates?.find((s) => s.slug === FLOW_SLUG);
    expect(skipped).toBeDefined();
    expect(skipped!.code).toBe("participating_module_failed");
    expect(skipped!.message).toContain("core");
  }, 60_000);
});
