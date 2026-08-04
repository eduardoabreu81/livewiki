/**
 * batch-surgical-repair.test.ts — recovery tier (Component 1): surgical
 * section-scoped repair calls with the deterministic anti-cascade guard.
 *
 * Harness mirrors ProgrammableMockLlm (batch-repair.test.ts) and
 * Stage5MockLlm/TopicMockLlm (batch-stage5.test.ts). Contracts covered:
 *
 *   - stage 4: an eligible error set (empty_section) uses the surgical
 *     prompt — small, scoped, without the closed list / full context;
 *   - stage 4: the guard rejects a cascade (model touched a non-target
 *     section) — attempt fails, page untouched, recovery on the next slot;
 *   - stage 4: an ineligible error set falls back to the full-context
 *     repair prompt (byte-identical legacy behavior);
 *   - stage 4: surgicalRepair off (BatchOptions override) → full-context
 *     path even for an eligible set;
 *   - stage 5 (flow): a section-level missing_page_opening (Purpose prose)
 *     resolves the target section from the message and repairs surgically;
 *   - stage 5 (topic): empty_section on a topic page repairs surgically;
 *   - diagnostic entries record surgical_ok / surgical_cascade_rejected
 *     (additive field) and the joined-attempts invariant holds.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as nodePath from "node:path";
import * as nodeOs from "node:os";
import * as nodeFs from "node:fs/promises";
import { runBatch } from "./batch.js";
import type { LlmClient } from "./llm/index.js";
import type { GenerateRequest, GenerateResult } from "./llm/types.js";
import type { TaskCheckpoint } from "./batch-state.js";

// === Fixture helpers (mirrored from batch-repair/stage5 test harnesses) ===

/** Parse the closed key list out of any stage-4/stage-5 user prompt. */
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
  user: string;
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

/** Same page but with NO prose after the Details marker → empty_section. */
function makeEmptySectionPage(closedKeyList: string[]): string {
  return makeValidPage(closedKeyList).replace("Body.\n", "");
}

/** Valid stage-5 flow page in the model-emitted form (mirrors stage5 tests). */
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

/** Flow page whose Purpose is a bullet list → section-level missing_page_opening. */
function makeFlowPagePurposeBullets(ctx: FlowPromptCtx): string {
  return makeFlowPage(ctx).replace(
    "The CLI invocation starts the flow and the core produces a stored result.",
    "- A bullet list is not prose.",
  );
}

/** Minimal compliant topic page (mirrors the stage5 topic harness). */
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

/** Topic page with NO prose after the Change map marker → empty_section. */
function makeTopicPageEmptyChangeMap(user: string): string {
  return makeTopicPage(user).replace(
    "Changing this behavior requires updating the modules listed above.\n",
    "",
  );
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

/** Additive recovery-tier field, not on the canonical DiagnosticAttempt type. */
function surgicalOutcomeOf(entry: unknown): string | undefined {
  return (entry as { surgicalOutcome?: string }).surgicalOutcome;
}

function expectJoinedAttempts(checkpoint: TaskCheckpoint): void {
  expect(checkpoint.diagnosticHistory).toBeDefined();
  expect(checkpoint.diagnosticHistory).toHaveLength(checkpoint.usageHistory.length);
  expect(checkpoint.diagnosticHistory!.map((entry) => entry.attempt)).toEqual(
    checkpoint.usageHistory.map((entry) => entry.attempt),
  );
}

const SURGICAL_CONTRACT_MARKER = "SURGICAL REPAIR";
const FULL_REPAIR_CONTEXT_MARKER = "# Closed list of canonical keys";

/** Valid stage-5c understanding page returned outside mock instrumentation. */
const VALID_UNDERSTANDING_PAGE = [
  "---",
  "title: Test repository",
  "owner: generated",
  "kind: understanding",
  "---",
  "",
  "# Test repository",
  "",
  "This test repository exercises the batch pipeline with a small product surface.",
  "",
].join("\n");

// === Stage 4 (module) harness ===

/**
 * Programmable mock (mirrors ProgrammableMockLlm): queued responses, plus a
 * call log capturing every prompt for shape assertions.
 */
class SurgicalModuleMockLlm implements LlmClient {
  public readonly provider = "anthropic" as const;
  public readonly model = "claude-test-mock";
  public responses: string[] = [];
  public callCount = 0;
  public callLog: Array<{ system: string; user: string }> = [];

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    // Stage 5c (item 23): answer the understanding task with a valid page
    // OUTSIDE this mock's instrumentation — stage 5c has its own dedicated
    // suite (batch-understanding.test.ts).
    if (/^# Output: livewiki\/understanding\.md$/m.test(req.user)) {
      return {
        content: VALID_UNDERSTANDING_PAGE,
        usage: { inputTokens: 100, outputTokens: 50, model: this.model },
      };
    }
    this.callLog.push({ system: req.system, user: req.user });
    const idx = this.callCount;
    this.callCount++;
    const content = this.responses[idx] ?? this.responses[this.responses.length - 1] ?? "";
    return {
      content,
      usage: { inputTokens: 100, outputTokens: 50, model: this.model },
    };
  }
}

let repoRoot: string;

beforeEach(async () => {
  repoRoot = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "livewiki-surgical-"));
  // Roadmap #22: pin the pre-#22 stage-4 format — the surgical repair
  // contract is the subject here and the mock pages emit no Diagram section.
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

async function writeModuleRepo(root: string): Promise<void> {
  await nodeFs.mkdir(nodePath.join(root, "src/auth"), { recursive: true });
  await nodeFs.writeFile(
    nodePath.join(root, "src/auth/login.ts"),
    "export function login() { return 'auth'; }\nexport function logout() { return 'bye'; }",
    "utf8",
  );
}

describe("batch surgical repair — stage 4 (module)", () => {
  it("an eligible error set (empty_section) uses the surgical prompt and lands", async () => {
    await writeModuleRepo(repoRoot);
    const llm = new SurgicalModuleMockLlm();
    const closedKeys = ["src/auth/login.ts#login", "src/auth/login.ts#logout"];
    llm.responses = [makeEmptySectionPage(closedKeys), makeValidPage(closedKeys)];

    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
      maxRepairAttempts: 2,
    });

    expect(result.status).toBe("completed");
    expect(llm.callCount).toBe(2);

    // The second call was surgical: small and scoped, WITHOUT the full
    // repair context (closed list, symbol table, full source dump).
    const repairPrompt = llm.callLog[1]!;
    expect(repairPrompt.system).toContain(SURGICAL_CONTRACT_MARKER);
    expect(repairPrompt.user).toContain("byte-for-byte identical");
    expect(repairPrompt.user).toContain('- "Details"');
    expect(repairPrompt.user).not.toContain(FULL_REPAIR_CONTEXT_MARKER);
    expect(repairPrompt.user).not.toContain("# Symbol table:");
    // Evidence slice: only the keys cited in the affected section.
    expect(repairPrompt.user).toContain("// === src/auth/login.ts#login");
    // Failed page embedded with its markers verbatim (the syntax to preserve).
    expect(repairPrompt.user).toContain("<!-- lw:anchors src/auth/login.ts#login src/auth/login.ts#logout -->");

    const checkpoint = await readTaskCheckpoint(repoRoot, 4, "auth");
    expect(checkpoint).not.toBeNull();
    expect(checkpoint!.status).toBe("done");
    expect(checkpoint!.diagnosticHistory!.map((d) => d.outcome)).toEqual([
      "artifact_validation_failed",
      "success",
    ]);
    expect(surgicalOutcomeOf(checkpoint!.diagnosticHistory![0])).toBeUndefined();
    expect(surgicalOutcomeOf(checkpoint!.diagnosticHistory![1])).toBe("surgical_ok");
    expectJoinedAttempts(checkpoint!);

    const page = await nodeFs.readFile(nodePath.join(repoRoot, "livewiki/auth.md"), "utf8");
    expect(page).toContain("Body.");
  }, 30_000);

  it("the guard rejects a cascade: non-target section changed → attempt fails, page untouched, next slot recovers", async () => {
    await writeModuleRepo(repoRoot);
    const llm = new SurgicalModuleMockLlm();
    const closedKeys = ["src/auth/login.ts#login", "src/auth/login.ts#logout"];
    const cascade = makeValidPage(closedKeys).replace(
      "This module provides one part of the repository implementation.",
      "The model rewrote a section it was told to keep.",
    );
    llm.responses = [
      makeEmptySectionPage(closedKeys),
      cascade,
      makeValidPage(closedKeys),
    ];

    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
      maxRepairAttempts: 2,
    });

    expect(result.status).toBe("completed");
    expect(llm.callCount).toBe(3);

    const checkpoint = await readTaskCheckpoint(repoRoot, 4, "auth");
    expect(checkpoint!.diagnosticHistory!.map((d) => d.outcome)).toEqual([
      "artifact_validation_failed",
      "artifact_validation_failed",
      "success",
    ]);
    expect(surgicalOutcomeOf(checkpoint!.diagnosticHistory![1])).toBe(
      "surgical_cascade_rejected",
    );
    expect(surgicalOutcomeOf(checkpoint!.diagnosticHistory![2])).toBe("surgical_ok");
    expectJoinedAttempts(checkpoint!);

    // The persisted page is the compliant splice: the original How it fits
    // text survived byte-for-byte; the cascade rewrite never touched disk.
    const page = await nodeFs.readFile(nodePath.join(repoRoot, "livewiki/auth.md"), "utf8");
    expect(page).toContain("This module provides one part of the repository implementation.");
    expect(page).not.toContain("The model rewrote a section it was told to keep.");
  }, 30_000);

  it("an ineligible error set falls back to the full-context repair prompt", async () => {
    await writeModuleRepo(repoRoot);
    const llm = new SurgicalModuleMockLlm();
    const closedKeys = ["src/auth/login.ts#login", "src/auth/login.ts#logout"];
    // anchor_outside_closed_list: NOT in the surgical-eligible code set.
    const badAnchor = makeValidPage([...closedKeys, "src/auth/login.ts#bogus"]);
    llm.responses = [badAnchor, makeValidPage(closedKeys)];

    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
      maxRepairAttempts: 2,
    });

    expect(result.status).toBe("completed");
    expect(llm.callCount).toBe(2);
    const repairPrompt = llm.callLog[1]!;
    expect(repairPrompt.system).not.toContain(SURGICAL_CONTRACT_MARKER);
    expect(repairPrompt.user).toContain(FULL_REPAIR_CONTEXT_MARKER);

    const checkpoint = await readTaskCheckpoint(repoRoot, 4, "auth");
    expect(surgicalOutcomeOf(checkpoint!.diagnosticHistory![1])).toBeUndefined();
    expectJoinedAttempts(checkpoint!);
  }, 30_000);

  it("surgicalRepair off → full-context repair even for an eligible set", async () => {
    await writeModuleRepo(repoRoot);
    const llm = new SurgicalModuleMockLlm();
    const closedKeys = ["src/auth/login.ts#login", "src/auth/login.ts#logout"];
    llm.responses = [makeEmptySectionPage(closedKeys), makeValidPage(closedKeys)];

    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
      maxRepairAttempts: 2,
      surgicalRepair: false,
    });

    expect(result.status).toBe("completed");
    expect(llm.callCount).toBe(2);
    const repairPrompt = llm.callLog[1]!;
    expect(repairPrompt.system).not.toContain(SURGICAL_CONTRACT_MARKER);
    expect(repairPrompt.user).toContain(FULL_REPAIR_CONTEXT_MARKER);

    const checkpoint = await readTaskCheckpoint(repoRoot, 4, "auth");
    expect(surgicalOutcomeOf(checkpoint!.diagnosticHistory![1])).toBeUndefined();
  }, 30_000);
});

// === Stage 5 (flow) harness ===

/**
 * Mirrors Stage5MockLlm: stage-4 module pages are generated from the
 * prompt's closed key list; flow calls are answered by `flowResponder`.
 * Surgical flow calls are detected by the `# Page kind: flow` header and
 * reuse the stashed context of the initial flow call (the surgical prompt
 * carries no closed list by design).
 */
class SurgicalFlowMockLlm implements LlmClient {
  public readonly provider = "anthropic" as const;
  public readonly model = "claude-test-mock";
  public callLog: Array<{ system: string; user: string }> = [];
  public flowCallCount = 0;
  public flowResponder: ((ctx: FlowPromptCtx, flowCallIndex: number) => string) | null = null;
  private lastFlowCtx: FlowPromptCtx | null = null;

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    // Stage 5c (item 23): answer the understanding task with a valid page
    // OUTSIDE this mock's instrumentation — stage 5c has its own dedicated
    // suite (batch-understanding.test.ts).
    if (/^# Output: livewiki\/understanding\.md$/m.test(req.user)) {
      return {
        content: VALID_UNDERSTANDING_PAGE,
        usage: { inputTokens: 100, outputTokens: 50, model: this.model },
      };
    }
    this.callLog.push({ system: req.system, user: req.user });
    const usage = { inputTokens: 100, outputTokens: 50, model: this.model };
    if (/^# Flow: \S+$/m.test(req.user)) {
      const idx = this.flowCallCount++;
      const ctx = parseFlowPrompt(req.user);
      this.lastFlowCtx = ctx;
      const content = this.flowResponder ? this.flowResponder(ctx, idx) : makeFlowPage(ctx);
      return { content, usage };
    }
    if (/^# Page kind: flow$/m.test(req.user)) {
      const idx = this.flowCallCount++;
      const ctx = this.lastFlowCtx!;
      return { content: this.flowResponder!(ctx, idx), usage };
    }
    const closedKeys = parseClosedKeys(req.user);
    return { content: makeValidPage(closedKeys), usage };
  }
}

describe("batch surgical repair — stage 5 (flow)", () => {
  it("a section-level missing_page_opening (Purpose prose) repairs surgically", async () => {
    await writeFlowRepo(repoRoot);
    const llm = new SurgicalFlowMockLlm();
    llm.flowResponder = (ctx, idx) =>
      idx === 0 ? makeFlowPagePurposeBullets(ctx) : makeFlowPage(ctx);

    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
      maxRepairAttempts: 2,
    });

    expect(result.status).toBe("completed");
    expect(llm.flowCallCount).toBe(2);

    // The second flow call used the surgical prompt.
    const surgicalCall = llm.callLog.find((c) => c.system.includes(SURGICAL_CONTRACT_MARKER));
    expect(surgicalCall).toBeDefined();
    expect(surgicalCall!.user).toContain('# Page kind: flow');
    expect(surgicalCall!.user).toContain('- "Purpose"');
    expect(surgicalCall!.user).not.toContain(FULL_REPAIR_CONTEXT_MARKER);
    // Evidence slice: the key cited in Purpose (the first closed key).
    expect(surgicalCall!.user).toContain("// === cli/index.ts#main");

    const checkpoint = await readTaskCheckpoint(repoRoot, 5, "flow:cli-to-core");
    expect(checkpoint).not.toBeNull();
    expect(checkpoint!.status).toBe("done");
    expect(checkpoint!.diagnosticHistory!.map((d) => d.outcome)).toEqual([
      "artifact_validation_failed",
      "success",
    ]);
    expect(surgicalOutcomeOf(checkpoint!.diagnosticHistory![1])).toBe("surgical_ok");
    expectJoinedAttempts(checkpoint!);

    const page = await nodeFs.readFile(
      nodePath.join(repoRoot, "livewiki/flows/cli-to-core.md"),
      "utf8",
    );
    expect(page).toContain("The CLI invocation starts the flow");
    expect(page).not.toContain("A bullet list is not prose.");
  }, 60_000);
});

// === Stage 5 (topic) harness ===

/**
 * Mirrors TopicMockLlm (no topic-plan LLM calls under --no-refine). Topic
 * page calls are detected by `# Accepted title:`; surgical topic calls by
 * the `# Page kind: topic` header, reusing the stashed initial user prompt
 * to rebuild the compliant page.
 */
class SurgicalTopicMockLlm implements LlmClient {
  public readonly provider = "anthropic" as const;
  public readonly model = "claude-test-mock";
  public callLog: Array<{ system: string; user: string }> = [];
  public topicPageCallCount = 0;
  public topicPageResponder: ((initialUser: string, callIndex: number) => string) | null = null;
  private lastTopicUser: string | null = null;

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    // Stage 5c (item 23): answer the understanding task with a valid page
    // OUTSIDE this mock's instrumentation — stage 5c has its own dedicated
    // suite (batch-understanding.test.ts).
    if (/^# Output: livewiki\/understanding\.md$/m.test(req.user)) {
      return {
        content: VALID_UNDERSTANDING_PAGE,
        usage: { inputTokens: 100, outputTokens: 50, model: this.model },
      };
    }
    this.callLog.push({ system: req.system, user: req.user });
    const usage = { inputTokens: 100, outputTokens: 50, model: this.model };
    if (/^# Flow: \S+$/m.test(req.user)) {
      return { content: makeFlowPage(parseFlowPrompt(req.user)), usage };
    }
    if (req.user.includes("# Accepted title:")) {
      const idx = this.topicPageCallCount++;
      this.lastTopicUser = req.user;
      const content = this.topicPageResponder
        ? this.topicPageResponder(req.user, idx)
        : makeTopicPage(req.user);
      return { content, usage };
    }
    if (/^# Page kind: topic$/m.test(req.user)) {
      const idx = this.topicPageCallCount++;
      return { content: this.topicPageResponder!(this.lastTopicUser!, idx), usage };
    }
    const closedKeys = parseClosedKeys(req.user);
    return { content: makeValidPage(closedKeys), usage };
  }
}

describe("batch surgical repair — stage 5 (topic)", () => {
  it("an empty_section on a topic page repairs surgically", async () => {
    // Boost the fixture past the topic-cluster gate (mirrors the stage5
    // topic harness: 6 symbols, 2 connected product modules).
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
    const llm = new SurgicalTopicMockLlm();
    llm.topicPageResponder = (initialUser, idx) =>
      idx === 0 ? makeTopicPageEmptyChangeMap(initialUser) : makeTopicPage(initialUser);

    const result = await runBatch({
      repoRoot,
      llmClient: llm,
      noRefine: true,
      skipManifestWrite: true,
      maxRepairAttempts: 2,
    });

    expect(result.status).toBe("completed");
    expect(llm.topicPageCallCount).toBe(2);

    const surgicalCall = llm.callLog.find(
      (c) => c.system.includes(SURGICAL_CONTRACT_MARKER) && c.user.includes("# Page kind: topic"),
    );
    expect(surgicalCall).toBeDefined();
    expect(surgicalCall!.user).toContain('- "Change map"');
    expect(surgicalCall!.user).not.toContain(FULL_REPAIR_CONTEXT_MARKER);
    expect(surgicalCall!.user).not.toContain("# Accepted title:");

    const checkpoint = await readTopicTaskCheckpoint(repoRoot);
    expect(checkpoint).not.toBeNull();
    expect(checkpoint!.status).toBe("done");
    expect(checkpoint!.diagnosticHistory!.map((d) => d.outcome)).toEqual([
      "artifact_validation_failed",
      "success",
    ]);
    expect(surgicalOutcomeOf(checkpoint!.diagnosticHistory![1])).toBe("surgical_ok");
    expectJoinedAttempts(checkpoint!);
  }, 60_000);
});
