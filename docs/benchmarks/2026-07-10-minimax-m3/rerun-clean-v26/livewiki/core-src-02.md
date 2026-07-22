---
title: Batch orchestrator status, diagnostics, and stage-5 helpers
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
  - packages/core/src/batch-stage5.test.ts#TopicExhaustingLlm
  - packages/core/src/batch-stage5.test.ts#TopicExhaustingLlm.generate
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

# Batch orchestrator status, diagnostics, and stage-5 helpers

This page documents the livewiki batch pipeline's checkpoint/status aggregation, diagnostic-history shape, and the stage-5 (semantic product flows) fixtures and report helpers used by their tests.

## When to use this page

- **Diagnose** a failing batch run by reading the persisted `checkpoint_json` shape, the diagnostic caps, and how `buildStatusReport` rolls it up.
- **Repair** stage-4 candidates by understanding how `ProgrammableMockLlm` simulates repair prompts, mechanical fallbacks, and `usageHistory` joining.
- **Review** stage-5 (flow) behavior using the `batch-stage5.test.ts` mocks, repo writers, and section helpers when changing flow detection, placeholder substitution, or cleanup.
- **Audit** backward compatibility for `diagnosticHistory` with the legacy checkpoint seeders in `batch-status.test.ts`.

## How it fits

These files live under `packages/core/src/` next to `batch.ts`, `artifact.ts`, and `db.ts`. `batch-state.ts` defines the JSON-serialized `TaskCheckpoint` shape persisted in `batch_tasks.checkpoint_json` (schema v4); `batch-status.ts` reads that shape back out and aggregates it into a `BatchStatusReport`. The four `*.test.ts` files are co-located test fixtures: `batch.test.ts` and `batch-repair.test.ts` exercise the stage-4 pipeline, `batch-review.test.ts` covers reviewer regressions, and `batch-stage5.test.ts` covers stage-5 flow detection and cleanup. Every test file uses an offline `LlmClient` mock so runs are hermetic.

## Batch checkpoint and diagnostic shape

<!-- lw:anchors packages/core/src/batch-state.ts#DIAGNOSTIC_TEXT_CAP packages/core/src/batch-state.ts#DIAGNOSTIC_MAX_ERRORS packages/core/src/batch-state.ts#summarizeDiagnosticErrors -->

The diagnostic-history fields live alongside `usageHistory` in `TaskCheckpoint` and are bounded by two exported caps.

```ts
export const DIAGNOSTIC_TEXT_CAP = 200;
export const DIAGNOSTIC_MAX_ERRORS = 50;
```

```ts
export function summarizeDiagnosticErrors(
  input: ReadonlyArray<ArtifactValidationError>,
): { errors: DiagnosticErrorSummary[]; truncatedErrorCount: number }
```

`summarizeDiagnosticErrors` slices the input array to at most `DIAGNOSTIC_MAX_ERRORS` entries and caps each `offending` / `message` string to `DIAGNOSTIC_TEXT_CAP` characters. The returned `truncatedErrorCount` reports the number of dropped entries (zero when nothing was dropped). The normal path produces bounded, content-safe summaries; the excerpt does not establish exhaustive behavior if the source is extended with additional per-error transforms.

## Status aggregation and backward compatibility

<!-- lw:anchors packages/core/src/batch-status.ts#buildStatusReport packages/core/src/batch-status.ts#listRuns packages/core/src/batch-status.ts#emptyStageUsage packages/core/src/batch-status.ts#aggregateUsageFromCheckpoint packages/core/src/batch-status.ts#mergeStageUsage packages/core/src/batch-status.ts#parseRunSummary packages/core/src/batch-status.ts#safeJsonParse -->

```ts
export async function buildStatusReport(
  repoRoot: string,
  runId: number | null = null,
): Promise<BatchStatusReport>
```

```ts
export async function listRuns(repoRoot: string): Promise<Array<{
  id: number;
  startedAt: number;
  finishedAt: number | null;
  status: string;
  startedBy: string;
}>>
```

`buildStatusReport` resolves a single run (the latest when `runId` is null), loads its `batch_tasks` rows, and aggregates usage into `totals`, `byStage`, and `byModule`. `listRuns` returns the column-shaped summary of every run for index-style listings. Both functions open the SQLite index with `openIndex` against `.livewiki/index.db` resolved through `safeIo.resolveAndValidate`, and close the handle in a `finally` block — the normal path always releases the DB.

```ts
function emptyStageUsage(): StageUsage
function aggregateUsageFromCheckpoint(cp: TaskCheckpoint | null): StageUsage
function mergeStageUsage(a: StageUsage, b: StageUsage): StageUsage
function safeJsonParse<T>(s: string): T | null
function parseRunSummary(raw: string | null): BatchRunSummary | null
```

`emptyStageUsage` returns a zeroed `StageUsage` with `usageIncomplete: false`. `aggregateUsageFromCheckpoint` walks `cp.usageHistory` and treats an attempt as "known" when its `usage` object is present and `usageKnown !== false`; unknown attempts set the `usageIncomplete` flag instead of contributing zero tokens. `mergeStageUsage` folds two stage totals into one. `safeJsonParse` returns `null` on parse failure rather than throwing, and `parseRunSummary` tolerates `null` / malformed `summary_json` so the report never breaks on bad persisted summaries. When a checkpoint has no `diagnosticHistory` field, `buildStatusReport` omits the per-task key entirely (CONTRACT I5 backward compat); the field is surfaced additively only when present.

## Stage-4 repair fixtures and orchestration

<!-- lw:anchors packages/core/src/batch-repair.test.ts#ProgrammableMockLlm packages/core/src/batch-repair.test.ts#ProgrammableMockLlm.generate packages/core/src/batch-repair.test.ts#makeValidPage packages/core/src/batch-repair.test.ts#makeInvalidPage packages/core/src/batch-repair.test.ts#readStage4Checkpoint packages/core/src/batch-repair.test.ts#expectJoinedAttempts packages/core/src/batch.test.ts#MockLlm packages/core/src/batch.test.ts#MockLlm.generate -->

```ts
class ProgrammableMockLlm implements LlmClient {
  // fields: provider, model, responses, stopReasons, rawStopReasons,
  // throwOn, callCount, callLog, autoPageFromPrompt
  async generate(req: import("./llm/types.js").GenerateRequest): Promise<GenerateResult>
}
```

`ProgrammableMockLlm.generate` logs the (system, user) prompt pair, increments `callCount`, and either throws (when `callCount` is in `throwOn`) or returns the next queued response by index — falling back to the last entry or an empty string. When `autoPageFromPrompt` is set, it parses the user prompt's `- <key>` lines and synthesizes a valid page via `makeValidPage`. `stopReason` / `rawStopReason` are emitted only when the corresponding queue entry is defined.

```ts
function makeValidPage(closedKeyList: string[]): string
function makeInvalidPage(uniqueText: string): string
async function readStage4Checkpoint(
  root: string,
  target = "auth",
): Promise<TaskCheckpoint>
function expectJoinedAttempts(checkpoint: TaskCheckpoint): void
```

`makeValidPage` emits a full livewiki document whose `anchors` list matches the supplied keys. `makeInvalidPage` returns a fragment with a unique injected marker for negative assertions. `readStage4Checkpoint` opens `better-sqlite3` in read-only mode against `.livewiki/index.db` and parses the row matching `stage = 4` and `target`; it closes the DB in a `finally` block. `expectJoinedAttempts` enforces the 1:1 invariant between `usageHistory.length` and `diagnosticHistory.length`, asserting the `attempt` counters align position-wise. `ProgrammableMockLlm` uses `makeValidPage` internally; the same helper appears again in `batch-stage5.test.ts` (documented in the stage-5 section). The `MockLlm` defined in `batch.test.ts` is a simpler always-valid responder used by the orchestrator end-to-end tests; its `generate` extracts a module ID and the first closed key from the user prompt and emits a synthetic valid page.

```ts
class MockLlm implements LlmClient {
  // fields: provider, model, callCount, responses, callLog
  async generate(req: import("./llm/types.js").GenerateRequest): Promise<GenerateResult>
}
```

The `batch.test.ts` `MockLlm.generate` returns a fixed-shape valid document with `owner: generated`, the discovered anchor, and standard section headings, and records every prompt pair into `callLog` so tests can assert against the last user message (e.g. ensuring stage-2 prompt markers are absent under `noRefine`).

## Reviewer-regression fixtures

<!-- lw:anchors packages/core/src/batch-review.test.ts#MockLlm packages/core/src/batch-review.test.ts#MockLlm.generate packages/core/src/batch-review.test.ts#makeCompactAuxiliaryPage packages/core/src/batch-review.test.ts#seedFiveFileRepo packages/core/src/batch-review.test.ts#stage2ErrorCode packages/core/src/batch-review.test.ts#executablePlanPaths -->

```ts
function makeCompactAuxiliaryPage(closedKeys: string[]): string
```

`makeCompactAuxiliaryPage` emits a compact `owner: generated` page whose anchors match the supplied keys and whose body sections each carry a marker line. It is reused by the reviewer suite when the prompt matches the "compact auxiliary" contract.

```ts
class MockLlm implements LlmClient {
  // fields: provider, model, callCount, responses, costInputs
  async generate(req: import("./llm/types.js").GenerateRequest): Promise<GenerateResult>
}
```

The reviewer `MockLlm.generate` parses closed keys from the user prompt and routes between the compact auxiliary contract (via `makeCompactAuxiliaryPage`) and a generic "module responsibilities" template based on whether the prompt mentions the compact contract. Each call appends its `usage` to `costInputs` for downstream cost assertions.

```ts
async function seedFiveFileRepo(): Promise<void>
async function stage2ErrorCode(): Promise<string | undefined>
async function executablePlanPaths(): Promise<string[]>
```

`seedFiveFileRepo` materializes a five-file fixture tree used by reviewer tests. `stage2ErrorCode` is a small accessor that reads back the latest stage-2 error code from the persisted checkpoint, returning `undefined` when no failure is recorded. `executablePlanPaths` enumerates the executable paths that the reviewer expects the planner to emit. The excerpt does not establish exhaustive behavior of these helpers beyond the visible shape.

## Stage-5 fixtures, mocks, and helpers

<!-- lw:anchors packages/core/src/batch-stage5.test.ts#parseClosedKeys packages/core/src/batch-stage5.test.ts#parseFlowPrompt packages/core/src/batch-stage5.test.ts#makeValidPage packages/core/src/batch-stage5.test.ts#makeCompactAuxiliaryPage packages/core/src/batch-stage5.test.ts#makeFlowPage packages/core/src/batch-stage5.test.ts#makeFlowPageWithSections packages/core/src/batch-stage5.test.ts#Stage5MockLlm packages/core/src/batch-stage5.test.ts#Stage5MockLlm.generate packages/core/src/batch-stage5.test.ts#TopicExhaustingLlm packages/core/src/batch-stage5.test.ts#TopicExhaustingLlm.generate packages/core/src/batch-stage5.test.ts#countStage5Tasks packages/core/src/batch-stage5.test.ts#fileExists packages/core/src/batch-stage5.test.ts#readTaskCheckpoint packages/core/src/batch-stage5.test.ts#writeFlowRepo packages/core/src/batch-stage5.test.ts#writeGroupFlowRepo -->

```ts
function parseClosedKeys(user: string): string[] {
  // regex: /^- (\S+#\S+)$/ per line
}
function parseFlowPrompt(user: string): FlowPromptCtx {
  // extracts slug, moduleIds, closedKeys, user
}
function makeValidPage(closedKeyList: string[]): string
function makeCompactAuxiliaryPage(closedKeyList: string[]): string
function makeFlowPage(ctx: FlowPromptCtx, diagramSource: string): string
function makeFlowPageWithSections(/* see source */): string
```

`parseClosedKeys` extracts every `- <key>#<symbol>` line from a prompt. `parseFlowPrompt` parses the `# Flow: <slug>` header, the `# Participating modules ...` line, and reuses `parseClosedKeys` to populate `FlowPromptCtx`. `makeValidPage` and `makeCompactAuxiliaryPage` mirror their counterparts in `batch-repair.test.ts`. `makeFlowPage` builds a model-emitted flow page whose companion Mermaid diagram is INLINE inside `## Diagram` (the orchestrator substitutes the placeholder on disk); the first closed key anchors `Purpose`, the second anchors `Ordered flow`, and the rest anchor `Failure and recovery`. `makeFlowPageWithSections` is a section-count variant for tests that vary the number of headed sections.

```ts
class Stage5MockLlm implements LlmClient {
  // fields: provider, model, callCount, flowCallCount, callLog,
  // flowResponder, throwOnFlowCall, onBeforeFlowResponse
  async generate(req: GenerateRequest): Promise<GenerateResult>
}
```

`Stage5MockLlm.generate` increments the global `callCount`, recognizes a stage-5 prompt by the `# Flow: <slug>` header line, and dispatches to `flowResponder(ctx, flowCallIndex)` when set — otherwise it emits `makeFlowPage(ctx, "flowchart LR\n  cli --> core")`. When `throwOnFlowCall` matches the current flow-call index it throws the supplied error; `onBeforeFlowResponse` is an awaited side-effect hook between index selection and response emission. Non-flow calls fall through to closed-key parsing and either the compact auxiliary contract or a default module page.

```ts
class TopicExhaustingLlm implements LlmClient {
  async generate(req: GenerateRequest): Promise<GenerateResult>
}
```

`TopicExhaustingLlm` exists to simulate a planner that emits a topic plan larger than the allowed candidate cap so the stage-5 detector's exhaustion handling can be exercised. The excerpt does not establish its full internal response queue beyond the class declaration.

```ts
async function countStage5Tasks(root: string): Promise<number>
async function fileExists(root: string, rel: string): Promise<boolean>
async function readTaskCheckpoint(/* see source */): Promise<TaskCheckpoint>
async function writeFlowRepo(root: string): Promise<void>
async function writeGroupFlowRepo(root: string): Promise<void>
```

`countStage5Tasks` counts stage-5 task rows persisted for the given `root`. `fileExists` resolves the path under `root` and returns whether it is a regular file. `readTaskCheckpoint` reads a single `batch_tasks.checkpoint_json` row for the requested stage/target. `writeFlowRepo` and `writeGroupFlowRepo` materialize flow and grouped-flow fixture trees on disk; both operate as fixtures only and do not invoke the orchestrator.

## Status backward-compat fixtures

<!-- lw:anchors packages/core/src/batch-status.test.ts#seedLegacyCheckpoint packages/core/src/batch-status.test.ts#OneShotMockLlm packages/core/src/batch-status.test.ts#OneShotMockLlm.generate packages/core/src/batch-status.test.ts#ValidMockLlm packages/core/src/batch-status.test.ts#ValidMockLlm.generate packages/core/src/batch-status.test.ts#OneModuleMockLlm packages/core/src/batch-status.test.ts#OneModuleMockLlm.generate -->

```ts
async function seedLegacyCheckpoint(): Promise<number>
```

`seedLegacyCheckpoint` inserts a `batch_runs` row plus a single `batch_tasks` row whose `checkpoint_json` is the pre-Lot-A shape — `usageHistory` populated, `diagnosticHistory` absent. It returns the new `runId`. The companion H6 test then asserts that `buildStatusReport` loads the row, leaves the `diagnosticHistory` key absent on the per-task object (`"diagnosticHistory" in task === false`), and keeps the byte-stable JSON contract for older checkpoints.

```ts
class OneShotMockLlm implements LlmClient {
  async generate(): Promise<GenerateResult> {
    throw new Error("OneShotMockLlm.generate was called — should not happen");
  }
}
```

`OneShotMockLlm.generate` is intentionally unused: it throws so any accidental dispatch fails loudly. The status suite exists to assert the report path, not to drive the orchestrator.

```ts
class ValidMockLlm implements LlmClient {
  async generate(): Promise<GenerateResult>
}
```

`ValidMockLlm.generate` returns a fully-formed `Authentication responsibilities` page with both `login` and `logout` anchors, `stopReason: "complete"`, and a fixed `(100, 50)` usage tuple. The companion test asserts the post-Lot-A path: after `runBatch` completes, `buildStatusReport` surfaces a non-empty `diagnosticHistory` for the resulting task — proving the additive field appears only when present in the checkpoint.

```ts
class OneModuleMockLlm implements LlmClient {
  async generate(): Promise<GenerateResult>
}
```

`OneModuleMockLlm` is the one-module responder used by additional status-report assertions; the excerpt does not establish its full response shape beyond the class declaration.

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
- Flow: [CLI scaffold through export hashing](flows/cli-src-to-core-src-04.md)
- ["Core pipeline: batch orchestration, config, db, and diagrams"](core-src-03.md) — dependency and dependent
- [core-src-08 — prompts, safe I/O, status, symbol extraction, and topic planning](core-src-08.md) — dependency
- [Manifest persistence, Markdown masking, module partitioning, and mermaid validation](core-src-06.md) — dependency and dependent
<!-- livewiki:navigate:end -->
