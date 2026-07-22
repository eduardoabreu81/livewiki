---
title: Batch pipeline tests, state types, and status aggregation
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

# Batch pipeline tests, state types, and status aggregation

This page documents the test fixtures, type definitions, and status-aggregation helpers that back the livewiki batch pipeline's repair, review, stage-5, and status reporting flows.

## When to use this page

- **Run** the test suite in `packages/core/src` to validate batch pipeline behavior end to end.
- **Extend** `batch-state.ts` types or `batch-status.ts` aggregators when adding new metrics or schema fields.
- **Inspect** a batch run's checkpoint and status JSON when debugging repair, stage-5, or summary regressions.

## How it fits

This module is the supporting test and types layer for the livewiki batch pipeline under `packages/core/src`. The five `*.test.ts` files drive the orchestrator (`batch.ts`) with programmable LLM doubles; `batch-state.ts` defines the canonical shapes that flow through `batch_tasks.checkpoint_json`; `batch-status.ts` aggregates those shapes into the user-facing report. The page sits alongside the orchestrator and the SQLite-backed run/task tables rather than above them.

## Repair test fixtures and helpers

<!-- lw:anchors packages/core/src/batch-repair.test.ts#ProgrammableMockLlm packages/core/src/batch-repair.test.ts#ProgrammableMockLlm.generate packages/core/src/batch-repair.test.ts#makeValidPage packages/core/src/batch-repair.test.ts#makeInvalidPage packages/core/src/batch-repair.test.ts#readStage4Checkpoint packages/core/src/batch-repair.test.ts#expectJoinedAttempts -->

`batch-repair.test.ts` exercises the bounded corrective-repair plan. The programmable double lets each test feed a queue of responses, opt into simulated throws via `throwOn`, and inspect the system/user prompt actually received:

```ts
async generate(req: import("./llm/types.js").GenerateRequest): Promise<GenerateResult> {
```

`ProgrammableMockLlm` extracts `- <key>` lines from the user prompt and, when `autoPageFromPrompt` is set, synthesizes a valid page covering all keys. `makeValidPage` is the canonical scaffold used by the repair test and reappears in `batch-stage5.test.ts`:

```ts
function makeValidPage(closedKeyList: string[]): string {
```

`makeInvalidPage` injects a unique sentinel string so failed-page assertions can prove the right artifact (and only the right artifact) was rejected. `readStage4Checkpoint` opens the repo's `index.db` read-only and pulls the latest stage-4 checkpoint JSON for a target, which the repair assertions inspect for `diagnosticHistory`. `expectJoinedAttempts` enforces the 1:1 invariant between `usageHistory` and `diagnosticHistory` by zipping both arrays on the global `attempt` counter; tests visible in the excerpt check that mechanical repairs only land on the final repair slot, not on the earlier near-miss slots.

## Review test fixtures and helpers

<!-- lw:anchors packages/core/src/batch-review.test.ts#MockLlm packages/core/src/batch-review.test.ts#MockLlm.generate packages/core/src/batch-review.test.ts#makeCompactAuxiliaryPage packages/core/src/batch-review.test.ts#seedFiveFileRepo packages/core/src/batch-review.test.ts#stage2ErrorCode packages/core/src/batch-review.test.ts#executablePlanPaths -->

`batch-review.test.ts` regresses the 11 reviewer findings. The local `MockLlm` builds responses from the prompt's closed key list and switches into the auxiliary contract when the system/user text mentions `compact auxiliary contract`:

```ts
async generate(req: import("./llm/types.js").GenerateRequest): Promise<GenerateResult> {
```

The `compact auxiliary` page shape comes from `makeCompactAuxiliaryPage`:

```ts
function makeCompactAuxiliaryPage(closedKeys: string[]): string {
```

Helpers visible in the closed list but truncated in the excerpt — `seedFiveFileRepo`, `stage2ErrorCode`, and `executablePlanPaths` — are the repo-seeding, error-code probe, and plan-path enumerator used by the reviewer regressions. The excerpt shows assertions against `owner: human` (LF/CRLF/BOM), `owner: mixed` revisions, and the byte-exact preservation of `lw:manual` blocks when the LLM regenerates a mixed page.

## Stage-5 test fixtures and helpers

<!-- lw:anchors packages/core/src/batch-stage5.test.ts#Stage5MockLlm packages/core/src/batch-stage5.test.ts#Stage5MockLlm.generate packages/core/src/batch-stage5.test.ts#parseClosedKeys packages/core/src/batch-stage5.test.ts#parseFlowPrompt packages/core/src/batch-stage5.test.ts#makeValidPage packages/core/src/batch-stage5.test.ts#makeCompactAuxiliaryPage packages/core/src/batch-stage5.test.ts#makeFlowPage packages/core/src/batch-stage5.test.ts#makeFlowPageWithSections packages/core/src/batch-stage5.test.ts#writeFlowRepo packages/core/src/batch-stage5.test.ts#writeGroupFlowRepo packages/core/src/batch-stage5.test.ts#readTaskCheckpoint packages/core/src/batch-stage5.test.ts#countStage5Tasks packages/core/src/batch-stage5.test.ts#fileExists -->

`batch-stage5.test.ts` covers semantic product-flow detection and rendering. The prompt parsers are pure functions: `parseClosedKeys` pulls `- <key>#<key>` lines and `parseFlowPrompt` extracts the slug and participating modules from the `# Flow:` / `# Participating modules` headers:

```ts
function parseClosedKeys(user: string): string[] {
function parseFlowPrompt(user: string): FlowPromptCtx {
```

The fixture generators emit the model-emitted form, where the companion diagram is inline inside `## Diagram` and the orchestrator substitutes the placeholder on disk:

```ts
function makeFlowPage(ctx: FlowPromptCtx, diagramSource: string): string {
function makeFlowPageWithSections(
function makeValidPage(closedKeyList: string[]): string {
function makeCompactAuxiliaryPage(closedKeyList: string[]): string {
```

`Stage5MockLlm` distinguishes stage-4 (module) calls from stage-5 (flow) calls by scanning for `# Flow:` headers, then routes through an optional `flowResponder`, `throwOnFlowCall`, and `onBeforeFlowResponse` hook:

```ts
async generate(req: GenerateRequest): Promise<GenerateResult> {
```

The filesystem helpers (`writeFlowRepo`, `writeGroupFlowRepo`, `readTaskCheckpoint`, `countStage5Tasks`, `fileExists`) materialize flow repos under a temp root, read back the persisted checkpoint, and verify clean verify on the flow artifacts — the excerpt does not establish their full bodies, but their signatures are listed above.

## Diagnostic state types and caps

<!-- lw:anchors packages/core/src/batch-state.ts#DIAGNOSTIC_MAX_ERRORS packages/core/src/batch-state.ts#DIAGNOSTIC_TEXT_CAP packages/core/src/batch-state.ts#summarizeDiagnosticErrors -->

`batch-state.ts` defines the append-only diagnostic shape attached to each stage-4 attempt and the bounded helper that produces it. The two caps are exported as constants:

```ts
export const DIAGNOSTIC_TEXT_CAP = 200;
export const DIAGNOSTIC_MAX_ERRORS = 50;
```

`summarizeDiagnosticErrors` slices the caller-supplied errors to the cap and truncates both `offending` and `message` text to `DIAGNOSTIC_TEXT_CAP` characters, returning the surviving entries alongside the dropped count:

```ts
export function summarizeDiagnosticErrors(
  input: ReadonlyArray<ArtifactValidationError>,
): { errors: DiagnosticErrorSummary[]; truncatedErrorCount: number }
```

The exported `DiagnosticAttempt` interface shares the global `attempt` counter with `UsageAttempt`, which is the join key that `expectJoinedAttempts` validates downstream. When `usageKnown` is false (e.g., client timeout), `usage` is null and aggregators must not synthesize zero-token totals.

## Status report helpers

<!-- lw:anchors packages/core/src/batch-status.ts#buildStatusReport packages/core/src/batch-status.ts#listRuns packages/core/src/batch-status.ts#emptyStageUsage packages/core/src/batch-status.ts#aggregateUsageFromCheckpoint packages/core/src/batch-status.ts#mergeStageUsage packages/core/src/batch-status.ts#parseRunSummary packages/core/src/batch-status.ts#safeJsonParse -->

`batch-status.ts` aggregates `batch_runs` and `batch_tasks` into the user-facing report. `buildStatusReport` resolves the run (specific id or most recent), walks every task, and produces totals, by-stage, by-module, and per-task rows; the `diagnosticHistory` field is surfaced additively so that older checkpoints without it serialize byte-stable:

```ts
export async function buildStatusReport(
  repoRoot: string,
  runId: number | null = null,
): Promise<BatchStatusReport>
```

`listRuns` returns the run-level summary for `--list`:

```ts
export async function listRuns(repoRoot: string): Promise<Array<{
  id: number;
  startedAt: number;
  finishedAt: number | null;
  status: string;
  startedBy: string;
}>>
```

The aggregation helpers are private but exported in the symbol table: `emptyStageUsage` seeds a zero-usage row, `aggregateUsageFromCheckpoint` walks `usageHistory` and respects `usageKnown === false` to set `usageIncomplete` without inventing zeros, `mergeStageUsage` combines two rows, and `safeJsonParse` plus `parseRunSummary` tolerate null or malformed `summary_json`:

```ts
function emptyStageUsage(): StageUsage
function aggregateUsageFromCheckpoint(cp: TaskCheckpoint | null): StageUsage
function mergeStageUsage(a: StageUsage, b: StageUsage): StageUsage
function safeJsonParse<T>(s: string): T | null
function parseRunSummary(raw: string | null): BatchRunSummary | null
```

When `usageKnown` is false on a checkpoint attempt, the aggregator skips that attempt and propagates `usageIncomplete: true` instead of treating the timeout as a zero-token real usage.

## Status test fixtures

<!-- lw:anchors packages/core/src/batch-status.test.ts#OneShotMockLlm packages/core/src/batch-status.test.ts#OneShotMockLlm.generate packages/core/src/batch-status.test.ts#ValidMockLlm packages/core/src/batch-status.test.ts#ValidMockLlm.generate packages/core/src/batch-status.test.ts#OneModuleMockLlm packages/core/src/batch-status.test.ts#OneModuleMockLlm.generate packages/core/src/batch-status.test.ts#seedLegacyCheckpoint -->

`batch-status.test.ts` proves the CONTRACT I5 backward-compat guarantee for `diagnosticHistory`. `OneShotMockLlm` exists only so the test file satisfies the `LlmClient` interface for its unused-import path; its generate method throws if it is ever actually invoked:

```ts
async generate(): Promise<GenerateResult> {
  // ...throw new Error("OneShotMockLlm.generate was called — should not happen")
}
```

`ValidMockLlm` produces a complete module page with the required anchor list and is used to drive a real (stub) batch so the report surfaces `diagnosticHistory` additively. `OneModuleMockLlm` (whose `generate` method is listed in the symbols table) is the per-module variant used by adjacent cases. `seedLegacyCheckpoint` inserts a run + a task whose `checkpoint_json` matches the pre-Lot A shape (no `diagnosticHistory` field) so the test can assert that `buildStatusReport` produces byte-stable output for older data.

## End-to-end batch orchestrator test fixtures

<!-- lw:anchors packages/core/src/batch.test.ts#MockLlm packages/core/src/batch.test.ts#MockLlm.generate -->

`batch.test.ts` drives `runBatch` and `runOnly` with a `MockLlm` that synthesizes a valid page from the prompt's module id and first closed key, so the orchestrator can be exercised without a real model:

```ts
async generate(req: import("./llm/types.js").GenerateRequest): Promise<GenerateResult> {
```

The file asserts end-to-end behavior: the run lands a wiki page and a manifest under `livewiki/`, `--no-refine` skips stage-2 LLM calls (only the stage-4 call fires), enabling refine produces exactly one extra call, every stage-4 checkpoint's `usageHistory` is populated, and `runOnly` increments `attempt` and appends a second `usageHistory` entry on retry. The excerpt does not establish behavior outside the visible `describe` blocks.

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
- Flow: [cli-src → core-src-04 — export marker contract for stage-5 flows](flows/cli-src-to-core-src-04.md)
- [Batch orchestration, config, index schema, and deterministic diagrams](core-src-03.md) — dependency and dependent
- [Core source — prompts, safe I/O, status, symbols, topics](core-src-08.md) — dependency
- [Core module identification, manifest IO, and Markdown masking](core-src-06.md) — dependency and dependent
<!-- livewiki:navigate:end -->
