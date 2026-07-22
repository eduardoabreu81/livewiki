---
title: Batch test fixtures, state types, and status aggregation
owner: generated
anchors:
  - packages/core/src/batch-repair.test.ts#ProgrammableMockLlm
  - packages/core/src/batch-repair.test.ts#ProgrammableMockLlm.generate
  - packages/core/src/batch-repair.test.ts#expectJoinedAttempts
  - packages/core/src/batch-repair.test.ts#makeInvalidPage
  - packages/core/src/batch-repair.test.ts#makeValidPage
  - packages/core/src/batch-repair.test.ts#readStage4Checkpoint
  - packages/core/src/batch-review.test.ts#MockLlm
  - packages/core/src/batch-review.test.ts#MockLlm.generate
  - packages/core/src/batch-review.test.ts#executablePlanPaths
  - packages/core/src/batch-review.test.ts#makeCompactAuxiliaryPage
  - packages/core/src/batch-review.test.ts#seedFiveFileRepo
  - packages/core/src/batch-review.test.ts#stage2ErrorCode
  - packages/core/src/batch-stage5.test.ts#Stage5MockLlm
  - packages/core/src/batch-stage5.test.ts#Stage5MockLlm.generate
  - packages/core/src/batch-stage5.test.ts#countStage5Tasks
  - packages/core/src/batch-stage5.test.ts#fileExists
  - packages/core/src/batch-stage5.test.ts#makeCompactAuxiliaryPage
  - packages/core/src/batch-stage5.test.ts#makeFlowPage
  - packages/core/src/batch-stage5.test.ts#makeFlowPageWithSections
  - packages/core/src/batch-stage5.test.ts#makeValidPage
  - packages/core/src/batch-stage5.test.ts#parseClosedKeys
  - packages/core/src/batch-stage5.test.ts#parseFlowPrompt
  - packages/core/src/batch-stage5.test.ts#readTaskCheckpoint
  - packages/core/src/batch-stage5.test.ts#writeFlowRepo
  - packages/core/src/batch-stage5.test.ts#writeGroupFlowRepo
  - packages/core/src/batch-state.ts#DIAGNOSTIC_MAX_ERRORS
  - packages/core/src/batch-state.ts#DIAGNOSTIC_TEXT_CAP
  - packages/core/src/batch-state.ts#summarizeDiagnosticErrors
  - packages/core/src/batch-status.test.ts#OneModuleMockLlm
  - packages/core/src/batch-status.test.ts#OneModuleMockLlm.generate
  - packages/core/src/batch-status.test.ts#OneShotMockLlm
  - packages/core/src/batch-status.test.ts#OneShotMockLlm.generate
  - packages/core/src/batch-status.test.ts#ValidMockLlm
  - packages/core/src/batch-status.test.ts#ValidMockLlm.generate
  - packages/core/src/batch-status.test.ts#seedLegacyCheckpoint
  - packages/core/src/batch-status.ts#aggregateUsageFromCheckpoint
  - packages/core/src/batch-status.ts#buildStatusReport
  - packages/core/src/batch-status.ts#emptyStageUsage
  - packages/core/src/batch-status.ts#listRuns
  - packages/core/src/batch-status.ts#mergeStageUsage
  - packages/core/src/batch-status.ts#parseRunSummary
  - packages/core/src/batch-status.ts#safeJsonParse
  - packages/core/src/batch.test.ts#MockLlm
  - packages/core/src/batch.test.ts#MockLlm.generate
---

# Batch test fixtures, state types, and status aggregation

This module groups the Vitest fixtures that drive `batch.ts`, the typed shape of the persisted `batch_tasks.checkpoint_json`, and the SQLite-backed aggregator that turns one run into a `BatchStatusReport`.

## When to use this page

- **Audit** the per-attempt usage and diagnostic history written by `runBatch` into `batch_tasks.checkpoint_json`.
- **Extend** the `BatchStatusReport` aggregation when adding new fields or stages.
- **Reuse** the programmable LLM mocks when writing new batch regressions that need scripted responses or thrown errors.
- **Add** fixtures (`parseClosedKeys`, `parseFlowPrompt`, `seedLegacyCheckpoint`, etc.) when a new batch test needs to inspect checkpoint contents directly.

## How it fits

The three non-test files (`batch-state.ts`, `batch-status.ts`) are the only production code in this module. `batch-state.ts` declares the TypeScript shape for the checkpoint JSON that every other module in `packages/core/src/` reads and writes, plus the `summarizeDiagnosticErrors` helper that caps error lists and message text before persistence. `batch-status.ts` opens `.livewiki/index.db` and aggregates `batch_runs` + `batch_tasks` rows into the report shape consumed by the CLI's `livewiki batch <run>` and `--json` outputs. The four `*.test.ts` files are sibling regressions that wire the production code to in-memory LLM stubs and a temporary repo root; they exist to keep the contract between the orchestrator, the persisted state, and the status reporter testable without network calls.

## Repair-flow fixtures and mocks

<!-- lw:anchors packages/core/src/batch-repair.test.ts#ProgrammableMockLlm packages/core/src/batch-repair.test.ts#ProgrammableMockLlm.generate packages/core/src/batch-repair.test.ts#makeValidPage packages/core/src/batch-repair.test.ts#makeInvalidPage packages/core/src/batch-repair.test.ts#readStage4Checkpoint packages/core/src/batch-repair.test.ts#expectJoinedAttempts -->

`ProgrammableMockLlm` is the test-only `LlmClient` that backs every repair test:

```ts
class ProgrammableMockLlm implements LlmClient {
  public readonly provider = "anthropic" as const;
  public readonly model = "claude-test-mock";
  // responses, stopReasons, rawStopReasons, throwOn, callCount, callLog,
  // autoPageFromPrompt
  async generate(req: import("./llm/types.js").GenerateRequest): Promise<GenerateResult> { ... }
}
```

Each call consumes the next entry from `responses` (or the most-recent fallback when the queue is short), and can be configured to throw on a specific call index via `throwOn`. The `callLog` records the `{system, user}` pair received on every call, which is what the tests assert against when checking the repair prompt. When `autoPageFromPrompt` is true the mock extracts the closed key list from the user prompt and emits a `makeValidPage` so the test author does not have to enumerate the keys.

The page builders are also exposed as helpers:

```ts
function makeValidPage(closedKeyList: string[]): string { ... }
function makeInvalidPage(uniqueText: string): string { ... }
```

`makeValidPage` produces the canonical "well-formed module page" used by both repair and stage-5 tests, with the supplied keys listed in frontmatter. `makeInvalidPage` is a deliberately minimal page used to verify that the orchestrator refuses or rolls it back.

`readStage4Checkpoint` opens the SQLite index directly so a test can inspect the post-run `TaskCheckpoint` shape:

```ts
async function readStage4Checkpoint(
  root: string,
  target = "auth",
): Promise<TaskCheckpoint> { ... }
```

`expectJoinedAttempts` enforces the 1:1 invariant between `usageHistory` and `diagnosticHistory` on the checkpoint — both must have the same length and their `attempt` fields must align.

## Reviewer-finding fixtures and mocks

<!-- lw:anchors packages/core/src/batch-review.test.ts#MockLlm packages/core/src/batch-review.test.ts#MockLlm.generate packages/core/src/batch-review.test.ts#makeCompactAuxiliaryPage packages/core/src/batch-review.test.ts#seedFiveFileRepo packages/core/src/batch-review.test.ts#stage2ErrorCode packages/core/src/batch-review.test.ts#executablePlanPaths -->

The reviewer regressions use a simpler stub:

```ts
class MockLlm implements LlmClient {
  public readonly provider = "anthropic" as const;
  public readonly model = "claude-test-mock";
  public callCount = 0;
  public responses: string[] = [];
  public costInputs: Array<{ inputTokens: number; outputTokens: number; model: string }> = [];
  async generate(req: import("./llm/types.js").GenerateRequest): Promise<GenerateResult> { ... }
}
```

The mock auto-extracts closed keys from the user prompt and emits either a `makeCompactAuxiliaryPage` (when the prompt references the "compact auxiliary contract") or a full module page; an explicit `responses` entry wins over auto-derivation. Every call appends its `usage` to `costInputs` so tests can assert against the cost stream without re-parsing the checkpoint.

`makeCompactAuxiliaryPage` is the auxiliary-page equivalent of `makeValidPage`:

```ts
function makeCompactAuxiliaryPage(closedKeys: string[]): string { ... }
```

It produces the short auxiliary page used when the orchestrator decides a module should be summarized rather than fully documented.

The remaining fixtures scaffold the multi-file review scenarios: `seedFiveFileRepo` writes a five-file source tree into the temporary repo root, `stage2ErrorCode` reads the stage-2 error from the checkpoint so a test can assert the failure code without re-running the pipeline, and `executablePlanPaths` returns the on-disk paths of the persisted planner plan. The implementation details for these three helpers are not visible in the supplied excerpt, so behavior should be confirmed against the test bodies before relying on them.

## Stage-5 flow fixtures and mocks

<!-- lw:anchors packages/core/src/batch-stage5.test.ts#Stage5MockLlm packages/core/src/batch-stage5.test.ts#Stage5MockLlm.generate packages/core/src/batch-stage5.test.ts#parseClosedKeys packages/core/src/batch-stage5.test.ts#parseFlowPrompt packages/core/src/batch-stage5.test.ts#makeValidPage packages/core/src/batch-stage5.test.ts#makeCompactAuxiliaryPage packages/core/src/batch-stage5.test.ts#makeFlowPage packages/core/src/batch-stage5.test.ts#makeFlowPageWithSections packages/core/src/batch-stage5.test.ts#writeFlowRepo packages/core/src/batch-stage5.test.ts#readTaskCheckpoint packages/core/src/batch-stage5.test.ts#countStage5Tasks packages/core/src/batch-stage5.test.ts#fileExists packages/core/src/batch-stage5.test.ts#writeGroupFlowRepo -->

Stage-5 testing layers one programmable mock on top of the stage-4 helpers:

```ts
class Stage5MockLlm implements LlmClient {
  public readonly provider = "anthropic" as const;
  public readonly model = "claude-test-mock";
  public callCount = 0;
  public flowCallCount = 0;
  // callLog, flowResponder, throwOnFlowCall, onBeforeFlowResponse
  async generate(req: GenerateRequest): Promise<GenerateResult> { ... }
}
```

`generate` distinguishes stage-4 from stage-5 by sniffing `/^# Flow: \S+$/m` in the user prompt. Stage-5 calls are counted separately in `flowCallCount` and routed through `flowResponder` (a `(ctx, flowCallIndex) => string` hook), with `throwOnFlowCall` available to inject a specific error on a chosen call. `onBeforeFlowResponse` is an async side-effect hook used to mutate disk state between detection and response. When no `flowResponder` is set, the mock returns `makeFlowPage(ctx, "flowchart LR\n  cli --> core")`.

Prompt parsing:

```ts
function parseClosedKeys(user: string): string[] { ... }
function parseFlowPrompt(user: string): FlowPromptCtx { ... }
```

`parseClosedKeys` matches lines shaped `- <key>#<tail>` and returns the captured keys. `parseFlowPrompt` extracts the `# Flow: <slug>` header and the `# Participating modules: a, b, c` line into `FlowPromptCtx { slug, moduleIds, closedKeys, user }`, defaulting to `"unknown-flow"` and `[]` when those headers are absent.

Page builders mirror the stage-4 shape but emit a flow-specific skeleton:

```ts
function makeValidPage(closedKeyList: string[]): string { ... }
function makeCompactAuxiliaryPage(closedKeyList: string[]): string { ... }
function makeFlowPage(ctx: FlowPromptCtx, diagramSource: string): string { ... }
function makeFlowPageWithSections(
  // signature not supplied in symbol table
): string { ... }
```

`makeFlowPage` distributes the closed keys across `Purpose`, `Ordered flow`, and `Failure and recovery` so that every marker-carrying section holds at least one marker (R10.1 D), and embeds the supplied Mermaid source inline under `## Diagram`. `makeFlowPageWithSections` is documented in the source comment as a variant that takes section-specific overrides; its parameter signature is not present in the supplied symbol table, so callers should consult the source for the exact shape.

Disk fixtures build the repo under test and inspect checkpoint state:

```ts
async function writeFlowRepo(root: string): Promise<void> { ... }
async function writeGroupFlowRepo(root: string): Promise<void> { ... }
async function readTaskCheckpoint(
  // signature not supplied in symbol table
): Promise<TaskCheckpoint> { ... }
async function countStage5Tasks(root: string): Promise<number> { ... }
async function fileExists(root: string, rel: string): Promise<boolean> { ... }
```

`writeFlowRepo` and `writeGroupFlowRepo` lay down source trees that trigger flow detection (single-flow and multi-flow variants). `readTaskCheckpoint` is the stage-5 counterpart of `readStage4Checkpoint`; its exact parameter list is not visible in the supplied symbol table. `countStage5Tasks` and `fileExists` are small helpers used to assert "exactly N flow tasks were planned" and "the companion `.mmd` was written" without re-running the pipeline.

## Checkpoint state shape and diagnostic caps

<!-- lw:anchors packages/core/src/batch-state.ts#DIAGNOSTIC_TEXT_CAP packages/core/src/batch-state.ts#DIAGNOSTIC_MAX_ERRORS packages/core/src/batch-state.ts#summarizeDiagnosticErrors -->

The diagnostic history is capped before it is persisted so a pathological error list cannot bloat the checkpoint JSON:

```ts
export const DIAGNOSTIC_TEXT_CAP = 200;
export const DIAGNOSTIC_MAX_ERRORS = 50;

export function summarizeDiagnosticErrors(
  input: ReadonlyArray<ArtifactValidationError>,
): { errors: DiagnosticErrorSummary[]; truncatedErrorCount: number } { ... }
```

`summarizeDiagnosticErrors` slices the input to the first `DIAGNOSTIC_MAX_ERRORS` entries, truncates each `offending` and `message` string to `DIAGNOSTIC_TEXT_CAP` characters, and returns `truncatedErrorCount` so the caller knows how many entries were dropped. The returned `errors` array carries `code`, `location`, optional `sectionSlug`, the truncated `offending`, and the truncated `message`. The function does not mutate the input array, so callers can safely pass read-only error lists from the validator.

## Status-report aggregation

<!-- lw:anchors packages/core/src/batch-status.ts#buildStatusReport packages/core/src/batch-status.ts#listRuns packages/core/src/batch-status.ts#emptyStageUsage packages/core/src/batch-status.ts#aggregateUsageFromCheckpoint packages/core/src/batch-status.ts#mergeStageUsage packages/core/src/batch-status.ts#parseRunSummary packages/core/src/batch-status.ts#safeJsonParse -->

`buildStatusReport` is the single entry point the CLI calls for `livewiki batch <run>` (or the latest run when `runId` is null):

```ts
export async function buildStatusReport(
  repoRoot: string,
  runId: number | null = null,
): Promise<BatchStatusReport> { ... }
```

It opens `.livewiki/index.db`, resolves the run (specific `runId` or `ORDER BY id DESC LIMIT 1`), iterates every `batch_tasks` row for that run, and aggregates usage via `aggregateUsageFromCheckpoint`. Aggregation rules: `costUsd` stays `null` until the first priced attempt, then accumulates; if any attempt has known usage without a price, `costUsd` is reset to `null`; the `usageIncomplete` flag propagates if any attempt has `usageKnown === false` (e.g. `LlmTimeoutError`). Tasks with `t.status === "failed"` are pushed into `failures` with a retry command of `livewiki batch --only <target> <runId>`. The per-task `diagnosticHistory` is surfaced additively — only when the checkpoint actually has the field — so pre-Lot A checkpoints remain byte-stable (CONTRACT I5).

`listRuns` returns a summary of every run in the index (ordered most-recent-first) for callers that need a picker before calling `buildStatusReport`:

```ts
export async function listRuns(repoRoot: string): Promise<Array<{
  id: number;
  startedAt: number;
  finishedAt: number | null;
  status: string;
  startedBy: string;
}>> { ... }
```

The aggregation helpers are deliberately tiny and exported only inside this module:

```ts
function emptyStageUsage(): StageUsage { ... }
function aggregateUsageFromCheckpoint(cp: TaskCheckpoint | null): StageUsage { ... }
function mergeStageUsage(a: StageUsage, b: StageUsage): StageUsage { ... }
function safeJsonParse<T>(s: string): T | null { ... }
function parseRunSummary(raw: string | null): BatchRunSummary | null { ... }
```

`emptyStageUsage` initializes a `StageUsage` with `costUsd: null`, an empty models list, and `usageIncomplete: false` so the first `mergeStageUsage` call has a clean baseline. `aggregateUsageFromCheckpoint` walks `cp.usageHistory` once, sums tokens, tracks the model set, and folds the cost rules described above; a missing or null checkpoint yields `emptyStageUsage()` rather than a crash. `mergeStageUsage` is the per-task + per-stage + per-module combiner used inside the run-level loop. `safeJsonParse` wraps `JSON.parse` in a `try/catch` and returns `null` on failure so a corrupt `checkpoint_json` does not break the whole report. `parseRunSummary` is the tolerant counterpart for the `summary_json` column — invalid JSON yields `null`, never a thrown error.

## Status-report backward-compat fixtures

<!-- lw:anchors packages/core/src/batch-status.test.ts#OneShotMockLlm packages/core/src/batch-status.test.ts#OneShotMockLlm.generate packages/core/src/batch-status.test.ts#ValidMockLlm packages/core/src/batch-status.test.ts#ValidMockLlm.generate packages/core/src/batch-status.test.ts#OneModuleMockLlm packages/core/src/batch-status.test.ts#OneModuleMockLlm.generate packages/core/src/batch-status.test.ts#seedLegacyCheckpoint -->

The status tests rely on three minimal LLM stubs and one DB-seeding helper. `OneShotMockLlm` exists only to satisfy the `LlmClient` interface for the H6 backward-compat test — it is never invoked:

```ts
class OneShotMockLlm implements LlmClient {
  public readonly provider = "anthropic" as const;
  public readonly model = "claude-test-mock";
  async generate(): Promise<GenerateResult> {
    throw new Error("OneShotMockLlm.generate was called — should not happen");
  }
}
```

The `generate` method therefore takes the fail-open branch and throws whenever it is called; the visible code makes that the contract. `ValidMockLlm` and `OneModuleMockLlm` are the stubs used to drive a real `runBatch` call so the resulting checkpoint has a populated `diagnosticHistory`:

```ts
class ValidMockLlm implements LlmClient { /* emits a valid auth page */ }
class OneModuleMockLlm implements LlmClient { /* one-module variant */ }
```

Both expose `async generate(): Promise<GenerateResult>` (no parameter list shown in the supplied symbol table; the parameter is whatever the production orchestrator passes).

The DB-seeding helper is the key piece for the legacy-shape test:

```ts
async function seedLegacyCheckpoint(): Promise<number> { ... }
```

It inserts a `batch_runs` row plus a single `batch_tasks` row whose `checkpoint_json` is the pre-Lot A shape — `usageHistory` populated but **no** `diagnosticHistory` field. It returns the inserted `runId` so the calling test can pass it straight into `buildStatusReport(repoRoot, runId)` and assert that the per-task `diagnosticHistory` property is absent (not `null`, not `[]`). The contract under test (CONTRACT I5) is that the status output for a legacy checkpoint is byte-stable: the property simply does not appear.

## Orchestrator end-to-end mock

<!-- lw:anchors packages/core/src/batch.test.ts#MockLlm packages/core/src/batch.test.ts#MockLlm.generate -->

The orchestrator's smoke tests use a separate `MockLlm` whose job is to derive a valid module page from the prompt's `# Module: <id>` header and first closed key:

```ts
class MockLlm implements LlmClient {
  public readonly provider = "anthropic" as const;
  public readonly model = "claude-test-mock";
  public callCount = 0;
  public callLog: Array<{ system: string; user: string }> = [];
  async generate(req: import("./llm/types.js").GenerateRequest): Promise<GenerateResult> { ... }
}
```

The mock records every `{system, user}` pair it receives, extracts the module id and first key from the user prompt, and emits a well-formed module page so `runBatch` can complete without any prompt-engineering. Each call reports a synthetic `usage` of `{ inputTokens: 100, outputTokens: 50, model: this.model }`. The `callLog` is what the tests assert against to confirm that stage 2 was skipped under `noRefine: true` (the stage-4 user prompt does not contain `# Suggested display title`) and that the checkpoint carries exactly one `usageHistory` entry per stage-4 task. Under `noRefine: false`, the mock produces one extra call for the stage-2 refine step, which the test asserts as `callCount - before === 2`.

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
- Flow: [CLI entry to core-src-04 export — semantic product flow](flows/cli-src-to-core-src-04.md)
- [Batch orchestration, configuration, index, and diagram generation](core-src-03.md) — dependency and dependent
- [Stage-5 planning, prompt templates, and safe disk I/O core](core-src-08.md) — dependency
- [core library — manifest, markdown masking, mermaid validation, and module identification](core-src-06.md) — dependency and dependent
<!-- livewiki:navigate:end -->
