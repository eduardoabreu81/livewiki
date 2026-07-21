---
title: Batch review, stage 5, and status aggregation
owner: generated
anchors:
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

# Batch review, stage 5, and status aggregation

This page documents the test fixtures and aggregation helpers that exercise the batch orchestrator's reviewer regressions, stage-5 flow handling, and the per-run status report.

## When to use this page

- **Read** the reviewer-regression test scaffolding when adding or fixing a `findings #N` invariant in `batch-review.test.ts`.
- **Reuse** the stage-5 fixture builders and mock LLM when extending flow-page or diagram behavior.
- **Inspect** the status-report aggregation helpers when adding fields to `BatchStatusReport` or `BatchRunSummary`.

## How it fits

The files under `packages/core/src/` covered here are test fixtures (`batch-review.test.ts`, `batch-stage5.test.ts`, `batch-status.test.ts`, `batch.test.ts`) and two production helpers: `batch-state.ts` (shape of `batch_tasks.checkpoint_json` plus diagnostic-summary caps) and `batch-status.ts` (the `buildStatusReport` / `listRuns` aggregation entry points that `livewiki batch status` calls). The fixtures drive `runBatch` and `runOnly` against tmp repos seeded in-memory; the status module reads `batch_runs` and `batch_tasks` from the SQLite index opened via `openIndex` from `db.js`. The stage-5 tests additionally depend on `extractInlineFlowDiagram`, `countFlowDiagramElements`, and `FLOW_DIAGRAM_SOURCE_MAX_CHARS` from `artifact.js`.

## Reviewer regression fixtures

<!-- lw:anchors packages/core/src/batch-review.test.ts#MockLlm packages/core/src/batch-review.test.ts#MockLlm.generate packages/core/src/batch-review.test.ts#makeCompactAuxiliaryPage packages/core/src/batch-review.test.ts#seedFiveFileRepo packages/core/src/batch-review.test.ts#stage2ErrorCode packages/core/src/batch-review.test.ts#executablePlanPaths -->

The `batch-review.test.ts` file holds the 11 reviewer findings, each as one `describe` block. The shared scaffolding below feeds every test in the file.

```ts
function makeCompactAuxiliaryPage(closedKeys: string[]): string
class MockLlm implements LlmClient {
  public readonly provider = "anthropic" as const;
  public readonly model = "claude-test-mock";
  public callCount = 0;
  public responses: string[] = [];
  public costInputs: Array<{ inputTokens: number; outputTokens: number; model: string }> = [];
  async generate(req: import("./llm/types.js").GenerateRequest): Promise<GenerateResult>
}
async function seedFiveFileRepo(): Promise<void>
async function stage2ErrorCode(): Promise<string | undefined>
async function executablePlanPaths(): Promise<string[]>
```

`MockLlm.generate` parses the closed-key list from `req.user` (one `- <key>` per line) and decides between two synthesized pages. When the prompt mentions the compact-auxiliary contract, it returns `makeCompactAuxiliaryPage(closedKeys)`; otherwise it returns a `Module responsibilities` page whose anchors mirror the same closed list. If no `responses` queue entry is available and no closed keys parse out, it falls back to the literal string `"# t\n"` — so callers that need deterministic prose must pre-fill `llm.responses`.

`makeCompactAuxiliaryPage` is a pure string builder. It produces a full Markdown page with `owner: generated`, every supplied `closedKey` listed once under `anchors:`, and a `## Reference` section with one `### <key>` per entry. The page body it emits is example output for the validator and is not a livewiki control marker (the validator only honors markers that appear in this rendered Markdown page).

`seedFiveFileRepo` is the temp-repo bootstrap: it creates a tmp directory under `os.tmpdir()`, makes `src/auth/`, and writes `login.ts` with two exported functions. `beforeEach`/`afterEach` reuse the same scaffolding across all reviewer findings, and each finding owns its `responses` queue (so finding #1 explicitly proves zero LLM calls by setting `responses = ["OVERWRITTEN — should not appear"]` and asserting `llm.callCount === 0` after `runBatch`).

`stage2ErrorCode` reads the first failure's `error.code` from the `runBatch` result and returns `undefined` when the failures list is empty. `executablePlanPaths` returns the planner paths materialised on disk after stage 2 completes. The `batch-review.test.ts` excerpt visible here does not establish what happens when `runBatch` throws before populating `result.failures`; treat the helpers as usable on the normal completion path.

## Stage-5 fixtures and helpers

<!-- lw:anchors packages/core/src/batch-stage5.test.ts#Stage5MockLlm packages/core/src/batch-stage5.test.ts#Stage5MockLlm.generate packages/core/src/batch-stage5.test.ts#parseClosedKeys packages/core/src/batch-stage5.test.ts#parseFlowPrompt packages/core/src/batch-stage5.test.ts#makeValidPage packages/core/src/batch-stage5.test.ts#makeCompactAuxiliaryPage packages/core/src/batch-stage5.test.ts#makeFlowPage packages/core/src/batch-stage5.test.ts#makeFlowPageWithSections packages/core/src/batch-stage5.test.ts#writeFlowRepo packages/core/src/batch-stage5.test.ts#writeGroupFlowRepo packages/core/src/batch-stage5.test.ts#readTaskCheckpoint packages/core/src/batch-stage5.test.ts#countStage5Tasks packages/core/src/batch-stage5.test.ts#fileExists -->

`batch-stage5.test.ts` exercises the stage-5 (semantic product flow) pipeline with helpers that build prompts, parse them back, and stub the LLM.

```ts
function parseClosedKeys(user: string): string[]
function parseFlowPrompt(user: string): FlowPromptCtx
function makeValidPage(closedKeyList: string[]): string
function makeCompactAuxiliaryPage(closedKeyList: string[]): string
function makeFlowPage(ctx: FlowPromptCtx, diagramSource: string): string
function makeFlowPageWithSections(/* ... */): string
class Stage5MockLlm implements LlmClient {
  public readonly provider = "anthropic" as const;
  public readonly model = "claude-test-mock";
  public callCount = 0;
  public flowCallCount = 0;
  public callLog: Array<{ system: string; user: string }> = [];
  public flowResponder: ((ctx: FlowPromptCtx, flowCallIndex: number) => string) | null = null;
  public throwOnFlowCall: { index: number; error: Error } | null = null;
  public onBeforeFlowResponse: ((flowCallIndex: number) => Promise<void> | void) | null = null;
  async generate(req: GenerateRequest): Promise<GenerateResult>
}
async function writeFlowRepo(root: string): Promise<void>
async function writeGroupFlowRepo(root: string): Promise<void>
async function readTaskCheckpoint(root: string, stage: number, target: string): Promise<TaskCheckpoint | null>
async function countStage5Tasks(root: string): Promise<number>
async function fileExists(root: string, rel: string): Promise<boolean>
```

`parseClosedKeys` extracts canonical anchor keys from the user prompt with the regex `^- (\S+#\S+)$`. `parseFlowPrompt` then derives a `FlowPromptCtx` carrying the slug (matched by `# Flow: (\S+)$`), participating module ids (matched by `# Participating modules .*: (.+)$`), the closed keys, and the original prompt. Tests use the slug default `"unknown-flow"` when the header is absent.

`makeFlowPage` produces a valid model-emitted flow page in the inline-diagram form: frontmatter `anchors` mirrors `ctx.closedKeys`, a `modules:` list mirrors `ctx.moduleIds`, and the body opens `## Purpose`, `## Ordered flow`, `## Diagram`, `## Invariants`, `## Failure and recovery`, and `## Related pages` sections. The first closed key anchors `Purpose`, the second anchors `Ordered flow`, and the remaining keys anchor `Failure and recovery` (so dual completeness holds for any list of two or more keys). The diagram block is a fenced ```mermaid``` fence around `diagramSource`. `makeFlowPageWithSections` is the same builder variant; its full signature is elided from the supplied excerpt.

`Stage5MockLlm.generate` branches on the user prompt: when `^# Flow: \S+$` is present, it bumps `flowCallCount`, optionally throws `throwOnFlowCall.error` when `flowCallCount - 1` matches `throwOnFlowCall.index`, runs the `onBeforeFlowResponse` hook, and either delegates to `flowResponder(ctx, flowIdx)` or returns `makeFlowPage(ctx, "flowchart LR\n  cli --> core")`. Non-flow calls parse the closed-key list and emit either `makeCompactAuxiliaryPage` (when the compact-auxiliary contract string appears) or `makeValidPage`. The mock always reports `usage = { inputTokens: 100, outputTokens: 50, model: this.model }`.

The disk helpers build and inspect minimal repos. `writeFlowRepo` makes `cli/` and `core/` directories and writes a `cli/index.ts` that imports from `../core/db` plus a `core/db.ts` exporting `connect`. `writeGroupFlowRepo` is its multi-flow counterpart (full contents not visible in the excerpt). `readTaskCheckpoint` opens `.livewiki/index.db` read-only and selects `checkpoint_json` by `(stage, target)`; it returns `null` when the row is absent or the column is empty. `countStage5Tasks` and `fileExists` are count/existence probes used by stale-cleanup and zero-candidate tests.

## Diagnostic-shape constants

<!-- lw:anchors packages/core/src/batch-state.ts#DIAGNOSTIC_TEXT_CAP packages/core/src/batch-state.ts#DIAGNOSTIC_MAX_ERRORS packages/core/src/batch-state.ts#summarizeDiagnosticErrors -->

`batch-state.ts` defines the contract used by stage-4 diagnostics: the caps are exported as numeric constants and consumed by `summarizeDiagnosticErrors` to bound the persisted error lists.

```ts
export const DIAGNOSTIC_TEXT_CAP = 200;
export const DIAGNOSTIC_MAX_ERRORS = 50;
export function summarizeDiagnosticErrors(
  input: ReadonlyArray<ArtifactValidationError>,
): { errors: DiagnosticErrorSummary[]; truncatedErrorCount: number }
```

`summarizeDiagnosticErrors` slices the input to `DIAGNOSTIC_MAX_ERRORS` entries (default 50), copies `code`, `location`, and optional `sectionSlug` verbatim, truncates `offending` and `message` to `DIAGNOSTIC_TEXT_CAP` characters (default 200), and returns the bounded `errors` array plus `truncatedErrorCount = max(0, input.length - errors.length)`. The function does not mutate the caller's array. The excerpt does not show how `summarizeDiagnosticErrors` behaves when the input array length is shorter than `DIAGNOSTIC_MAX_ERRORS`; based on the visible source, `truncatedErrorCount` stays at `0` for any input of `≤ DIAGNOSTIC_MAX_ERRORS`.

## Status-report aggregation

<!-- lw:anchors packages/core/src/batch-status.ts#buildStatusReport packages/core/src/batch-status.ts#listRuns packages/core/src/batch-status.ts#emptyStageUsage packages/core/src/batch-status.ts#aggregateUsageFromCheckpoint packages/core/src/batch-status.ts#mergeStageUsage packages/core/src/batch-status.ts#safeJsonParse packages/core/src/batch-status.ts#parseRunSummary -->

`batch-status.ts` aggregates `batch_runs` + `batch_tasks` into the `BatchStatusReport` consumed by `livewiki batch status`.

```ts
export async function buildStatusReport(
  repoRoot: string,
  runId: number | null = null,
): Promise<BatchStatusReport>
export async function listRuns(repoRoot: string): Promise<Array<{
  id: number;
  startedAt: number;
  finishedAt: number | null;
  status: string;
  startedBy: string;
}>>
function emptyStageUsage(): StageUsage
function aggregateUsageFromCheckpoint(cp: TaskCheckpoint | null): StageUsage
function mergeStageUsage(a: StageUsage, b: StageUsage): StageUsage
function safeJsonParse<T>(s: string): T | null
function parseRunSummary(raw: string | null): BatchRunSummary | null
```

`buildStatusReport` resolves `.livewiki/index.db` via `safeIo.resolveAndValidate`, opens it with `openIndex`, then loads either a specific run (when `runId` is set) or the latest `batch_runs` row by `id DESC LIMIT 1`. It throws when the run is missing, with the message ``run ${runId} not found`` or ``no batch runs found``. For every task row it parses `checkpoint_json` with `safeJsonParse` (returning `null` on JSON failure), sums usage into `totals`, into `byStage[stage]`, and into `byModule[target]` (only when `stage === 4`). Per-task it builds a `TaskReportItem` with a `retryCommand` shaped like ``livewiki batch --only <target> <runId>`` and, per CONTRACT I5, adds `diagnosticHistory` only when the checkpoint already carries that field — older checkpoints serialize unchanged. Failures (`status === 'failed'`) are also pushed onto a `failures` array with the same `retryCommand` shape.

`emptyStageUsage` returns a fresh `StageUsage` (`{ inputTokens: 0, outputTokens: 0, costUsd: null, models: [], usageIncomplete: false }`). `aggregateUsageFromCheckpoint` walks `cp.usageHistory`, treats an attempt as known when `attempt.usage != null` and `attempt.usageKnown !== false`, and sums `inputTokens` / `outputTokens` across known attempts. Cost propagation is asymmetric: it takes the first priced attempt's `costUsd.total` as the seed, adds subsequent priced attempts, and resets to `null` as soon as any known attempt lacks pricing. When the history has entries but none are known (timeout-only runs), the returned `StageUsage` has `inputTokens = 0`, `outputTokens = 0`, `costUsd = null`, `models = []`, and `usageIncomplete = true`. `mergeStageUsage` combines two `StageUsage` values; its cost math follows the same null-propagation rule (null wins, non-null sums), and `usageIncomplete` is the boolean OR of both sides.

`listRuns` returns one row per `batch_runs` entry ordered by `id DESC`, mapping the snake-case columns to camelCase. `parseRunSummary` is the tolerant front for `summary_json`: it returns `null` when the column is empty and delegates JSON decoding to `safeJsonParse`, so the status report never breaks because of corrupted summary data.

## Backward-compatibility status fixtures

<!-- lw:anchors packages/core/src/batch-status.test.ts#OneShotMockLlm packages/core/src/batch-status.test.ts#OneShotMockLlm.generate packages/core/src/batch-status.test.ts#ValidMockLlm packages/core/src/batch-status.test.ts#ValidMockLlm.generate packages/core/src/batch-status.test.ts#OneModuleMockLlm packages/core/src/batch-status.test.ts#OneModuleMockLlm.generate packages/core/src/batch-status.test.ts#seedLegacyCheckpoint -->

`batch-status.test.ts` pins CONTRACT I5 (the additive `diagnosticHistory` invariant) and the byte-stability of the pre-Lot A status shape.

```ts
class OneShotMockLlm implements LlmClient {
  public readonly provider = "anthropic" as const;
  public readonly model = "claude-test-mock";
  async generate(): Promise<GenerateResult>
}
class ValidMockLlm implements LlmClient {
  public readonly provider = "anthropic" as const;
  public readonly model = "claude-test-mock";
  async generate(): Promise<GenerateResult>
}
class OneModuleMockLlm implements LlmClient {
  public readonly provider = "anthropic" as const;
  public readonly model = "claude-test-mock";
  async generate(): Promise<GenerateResult>
}
async function seedLegacyCheckpoint(): Promise<number>
```

`OneShotMockLlm.generate` is intentionally unreachable: the H6 tests seed the SQLite DB directly and never call `runBatch`, so the body throws `OneShotMockLlm.generate was called — should not happen`. `ValidMockLlm.generate` returns a complete module page with `owner: generated`, two anchor lines (`src/auth/login.ts#login`, `src/auth/login.ts#logout`), the standard opening (`# Authentication responsibilities` plus `## When to use this page` / `## How it fits` / `## Details` headings), a sentinel marker line, and `stopReason: "complete"`. `OneModuleMockLlm` is referenced from the closed list but its body is not visible in the supplied excerpt.

`seedLegacyCheckpoint` inserts one row into `batch_runs` (status `completed_with_failures`, started_by `'test'`, with a minimal config JSON) and one row into `batch_tasks` for `target = 'legacy'`. The task's `checkpoint_json` is the pre-Lot A shape: `usageHistory` carries two attempts with known usage, `error.code = 'repair_exhausted'`, and crucially no `diagnosticHistory` field. The function returns the runId so the test can call `buildStatusReport(repoRoot, runId)` and assert that `diagnosticHistory` is absent (`'diagnosticHistory' in task` is `false`) on the legacy path while the additive field appears on the post-Lot A path. The same file also covers an old `summary_json` whose `modulesRefined` lacks `displayTitle`: the loaded report must not synthesize that field.

## End-to-end batch fixtures

<!-- lw:anchors packages/core/src/batch.test.ts#MockLlm packages/core/src/batch.test.ts#MockLlm.generate -->

The base `batch.test.ts` file is the smallest end-to-end harness: a tmp repo with one file, a mock LLM, and assertions on `runBatch` / `runOnly` outcomes.

```ts
class MockLlm implements LlmClient {
  public readonly provider = "anthropic" as const;
  public readonly model = "claude-test-mock";
  public callCount = 0;
  public callLog: Array<{ system: string; user: string }> = [];
  async generate(req: import("./llm/types.js").GenerateRequest): Promise<GenerateResult>
}
```

`MockLlm.generate` extracts the module id from `^# Module: ([^\s]+)$` and the first canonical key from `^- (.+?#[\w.]+)$`. It always emits a single-anchor module page with `owner: generated`, the standard opening headings, a sentinel marker line, and `usage = { inputTokens: 100, outputTokens: 50, model: this.model }`. The `beforeEach` block creates one tmp repo with `src/auth/login.ts` exporting a `login()` function; tests then call `runBatch` with `noRefine: true` (default — no stage-2 LLM call) or `noRefine: false` (one extra stage-2 call). The end-to-end check verifies that `livewiki/auth.md` exists with `title: auth`, that `livewiki/.manifest.json` carries `"version": 1`, and that every stage-4 task in the DB has a one-entry `usageHistory` with a populated `usage.model` and `usage.inputTokens > 0`. The `runOnly` test re-runs one task by `moduleId` and asserts that the checkpoint's `attempt` advances to `2` with `usageHistory` length `2`.

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
- Flow: [CLI bootstrap to wiki export (cli-src to core-src-04)](flows/cli-src-to-core-src-04.md)
- [Batch orchestration, config, index DB, and diagram generators](core-src-03.md) — dependency and dependent
- [Core prompt, I/O allowlist, symbol extraction, status and topic planning](core-src-08.md) — dependency
- [Core source — manifest persistence, Markdown masking, Mermaid validation, and module identification](core-src-06.md) — dependency and dependent
<!-- livewiki:navigate:end -->
