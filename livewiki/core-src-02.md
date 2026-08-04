---
title: Batch orchestration, status reporting, and graph analysis core
owner: generated
anchors:
  - packages/core/src/batch-state.ts#DIAGNOSTIC_MAX_ERRORS
  - packages/core/src/batch-state.ts#DIAGNOSTIC_TEXT_CAP
  - packages/core/src/batch-state.ts#summarizeDiagnosticErrors
  - packages/core/src/batch-status.ts#aggregateUsageFromCheckpoint
  - packages/core/src/batch-status.ts#buildStatusReport
  - packages/core/src/batch-status.ts#emptyStageUsage
  - packages/core/src/batch-status.ts#listRuns
  - packages/core/src/batch-status.ts#mergeStageUsage
  - packages/core/src/batch-status.ts#parseRunSummary
  - packages/core/src/batch-status.ts#safeJsonParse
  - packages/core/src/batch.ts#EmptyPipelineError
  - packages/core/src/batch.ts#EmptyPipelineError.constructor
  - packages/core/src/batch.ts#TaskError
  - packages/core/src/batch.ts#TaskError.constructor
  - packages/core/src/batch.ts#accumulateUsage
  - packages/core/src/batch.ts#aggregateTotals
  - packages/core/src/batch.ts#attemptStage4Generation
  - packages/core/src/batch.ts#attemptStage5Generation
  - packages/core/src/batch.ts#attemptTopicGeneration
  - packages/core/src/batch.ts#attemptUnderstandingGeneration
  - packages/core/src/batch.ts#buildFairTruncatedSource
  - packages/core/src/batch.ts#buildFlowDocContext
  - packages/core/src/batch.ts#buildModuleDocContext
  - packages/core/src/batch.ts#buildResult
  - packages/core/src/batch.ts#buildSurgicalEvidenceSlice
  - packages/core/src/batch.ts#buildTopicDocContext
  - packages/core/src/batch.ts#computeCostFromUsage
  - packages/core/src/batch.ts#createOrGetTask
  - packages/core/src/batch.ts#diagnosticAttempt
  - packages/core/src/batch.ts#drainPendingMetrics
  - packages/core/src/batch.ts#emptyUsage
  - packages/core/src/batch.ts#extractManualBlocksBySection
  - packages/core/src/batch.ts#finalizeRun
  - packages/core/src/batch.ts#forceOwnerInFrontmatter
  - packages/core/src/batch.ts#getFileIdsForModule
  - packages/core/src/batch.ts#getModuleSymbolRows
  - packages/core/src/batch.ts#getOrCreateTask
  - packages/core/src/batch.ts#getRationaleEvidenceForPaths
  - packages/core/src/batch.ts#injectManualBlocksBySection
  - packages/core/src/batch.ts#isRelaxedEligible
  - packages/core/src/batch.ts#orchestrate
  - packages/core/src/batch.ts#prepareSurgicalRepair
  - packages/core/src/batch.ts#readOwnerFromFrontmatter
  - packages/core/src/batch.ts#resetTaskToPending
  - packages/core/src/batch.ts#resolveOutputTokenBudget
  - packages/core/src/batch.ts#resumeBatch
  - packages/core/src/batch.ts#rollbackWrittenArtifacts
  - packages/core/src/batch.ts#runBatch
  - packages/core/src/batch.ts#runOnly
  - packages/core/src/batch.ts#runSemanticTopicStage
  - packages/core/src/batch.ts#runUnderstandingStage
  - packages/core/src/batch.ts#safeJsonParse
  - packages/core/src/batch.ts#sectionRangeOf
  - packages/core/src/batch.ts#slugifyHeadingText
  - packages/core/src/batch.ts#statusToExitCode
  - packages/core/src/batch.ts#summarizeLlmDiagnosticError
  - packages/core/src/batch.ts#summarizeVerifyDiagnosticErrors
  - packages/core/src/batch.ts#topicAttemptDiagnostic
  - packages/core/src/batch.ts#topicPlanDiagnostic
  - packages/core/src/batch.ts#tryWriteAndVerify
  - packages/core/src/batch.ts#tryWriteFlowAndVerify
  - packages/core/src/batch.ts#tryWriteModuleDiagramAndVerify
  - packages/core/src/batch.ts#understandingAttemptDiagnostic
  - packages/core/src/batch.ts#validateRefinedModules
  - packages/core/src/batch.ts#verifyIssuesToValidationErrors
  - packages/core/src/blast-radius.ts#computeBlastRadius
  - packages/core/src/blast-radius.ts#findAffectedPages
  - packages/core/src/call-resolution.ts#computeCallerCentrality
  - packages/core/src/call-resolution.ts#computeCrossModuleCallees
  - packages/core/src/call-resolution.ts#resolveCalls
  - packages/core/src/change-impact.ts#IMPACT_BUDGETS
  - packages/core/src/change-impact.ts#computeChangeImpact
  - packages/core/src/change-impact.ts#computeDirectImporters
  - packages/core/src/change-impact.ts#emptyImpact
  - packages/core/src/change-impact.ts#indexDbExists
  - packages/core/src/change-impact.ts#seedFromDebt
  - packages/core/src/community.ts#comparePartitions
  - packages/core/src/community.ts#detectFileCommunities
---

# Batch orchestration, status reporting, and graph analysis core

This page is the reference for the batch pipeline orchestrator, status aggregator, call-graph resolver, blast-radius walker, change-impact package, and deterministic community detection in `packages/core/src`.

## When to use this page

- **Run or resume** the multi-stage documentation batch via `runBatch`, `resumeBatch`, or `runOnly` and inspect the consolidated `BatchRunResult`.
- **Interpret** `BatchStatusReport` totals, per-stage, per-module, and per-task usage from `livewiki batch <run>` and `listRuns`.
- **Diagnose** changed-symbol impact on docs through `computeChangeImpact` (working-tree or debt mode), with bounded sections and pre-cap totals.
- **Inspect** the call graph and reachability with `resolveCalls`, `computeBlastRadius`, `computeCallerCentrality`, and `computeCrossModuleCallees`.

## How it fits

This module sits at the orchestration layer of `packages/core/src`. `batch.ts` drives the five-stage documentation pipeline and persists checkpoints; `batch-state.ts` defines the checkpoint, usage-history, and diagnostic shapes; `batch-status.ts` reads the persistence tables and emits the human-facing report. Around them, `blast-radius.ts` answers "what would break if I change symbol X", `call-resolution.ts` back-fills resolved callee keys and exposes cross-module/centrality signals, `change-impact.ts` composes changed-symbol, affected-pages, importers, and snippets into a bounded package, and `community.ts` cross-checks the stage-2 heuristic partition against a deterministic label-propagation of the import graph. The diagram below shows the high-level wiring among these files; consumers in `packages/cli`, `packages/mcp`, and Phase-5 navigation are not drawn.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-02.mmd
```

## Diagnostic error shaping

<!-- lw:anchors packages/core/src/batch-state.ts#DIAGNOSTIC_MAX_ERRORS packages/core/src/batch-state.ts#DIAGNOSTIC_TEXT_CAP packages/core/src/batch-state.ts#summarizeDiagnosticErrors packages/core/src/batch.ts#summarizeLlmDiagnosticError packages/core/src/batch.ts#summarizeVerifyDiagnosticErrors packages/core/src/batch.ts#verifyIssuesToValidationErrors packages/core/src/batch.ts#diagnosticAttempt packages/core/src/batch.ts#topicPlanDiagnostic packages/core/src/batch.ts#topicAttemptDiagnostic packages/core/src/batch.ts#understandingAttemptDiagnostic -->

The diagnostic layer caps the size of any structured error payload persisted into a checkpoint. The two exported constants set the upper bound on the count of errors and on the length of each truncated string field:

```ts
export const DIAGNOSTIC_MAX_ERRORS = 50;
export const DIAGNOSTIC_TEXT_CAP = 200;
```

`summarizeDiagnosticErrors` slices its `ReadonlyArray<ArtifactValidationError>` input to `DIAGNOSTIC_MAX_ERRORS`, truncates `offending` (when present) and `message` to `DIAGNOSTIC_TEXT_CAP` per entry, and reports the dropped count as `truncatedErrorCount`. On the orchestration side, `summarizeLlmDiagnosticError`, `summarizeVerifyDiagnosticErrors`, `verifyIssuesToValidationErrors`, and the per-stage probes `topicPlanDiagnostic`, `topicAttemptDiagnostic`, and `understandingAttemptDiagnostic` produce the bounded summaries that `diagnosticAttempt` records as a `DiagnosticAttempt`.

## Batch state shape

<!-- lw:anchors packages/core/src/batch.ts#runBatch packages/core/src/batch.ts#resumeBatch packages/core/src/batch.ts#runOnly packages/core/src/batch.ts#orchestrate packages/core/src/batch.ts#runSemanticTopicStage packages/core/src/batch.ts#runUnderstandingStage packages/core/src/batch.ts#attemptStage4Generation packages/core/src/batch.ts#attemptStage5Generation packages/core/src/batch.ts#attemptTopicGeneration packages/core/src/batch.ts#attemptUnderstandingGeneration packages/core/src/batch.ts#buildTopicDocContext packages/core/src/batch.ts#buildFlowDocContext packages/core/src/batch.ts#buildModuleDocContext packages/core/src/batch.ts#getFileIdsForModule packages/core/src/batch.ts#getModuleSymbolRows packages/core/src/batch.ts#getRationaleEvidenceForPaths packages/core/src/batch.ts#buildFairTruncatedSource packages/core/src/batch.ts#resetTaskToPending packages/core/src/batch.ts#getOrCreateTask packages/core/src/batch.ts#createOrGetTask packages/core/src/batch.ts#resolveOutputTokenBudget packages/core/src/batch.ts#isRelaxedEligible packages/core/src/batch.ts#prepareSurgicalRepair packages/core/src/batch.ts#buildSurgicalEvidenceSlice packages/core/src/batch.ts#injectManualBlocksBySection packages/core/src/batch.ts#extractManualBlocksBySection packages/core/src/batch.ts#sectionRangeOf packages/core/src/batch.ts#slugifyHeadingText packages/core/src/batch.ts#readOwnerFromFrontmatter packages/core/src/batch.ts#forceOwnerInFrontmatter packages/core/src/batch.ts#validateRefinedModules packages/core/src/batch.ts#rollbackWrittenArtifacts packages/core/src/batch.ts#tryWriteAndVerify packages/core/src/batch.ts#tryWriteFlowAndVerify packages/core/src/batch.ts#tryWriteModuleDiagramAndVerify packages/core/src/batch.ts#finalizeRun packages/core/src/batch.ts#drainPendingMetrics packages/core/src/batch.ts#buildResult packages/core/src/batch.ts#statusToExitCode packages/core/src/batch.ts#EmptyPipelineError packages/core/src/batch.ts#EmptyPipelineError.constructor packages/core/src/batch.ts#TaskError packages/core/src/batch.ts#TaskError.constructor packages/core/src/batch.ts#safeJsonParse packages/core/src/batch.ts#emptyUsage packages/core/src/batch.ts#accumulateUsage packages/core/src/batch.ts#aggregateTotals packages/core/src/batch.ts#computeCostFromUsage -->

`batch-state.ts` defines the canonical types persisted into `batch_tasks.checkpoint_json`. The accent of the schema is the `usageHistory: UsageAttempt[]` convention: every task that calls an LLM appends a new attempt rather than overwriting, so retry-aware aggregation is a sum over the list. When `usageKnown === false` (e.g. client timeout), `usage` is `null` and aggregators must not invent zero tokens — they merely propagate `usageIncomplete`. `DiagnosticAttempt` is the corresponding per-attempt diagnostic record (`outcome`, `promptKind`, `errors` capped to `DIAGNOSTIC_MAX_ERRORS`, candidate hash) and joins `UsageAttempt` one-to-one on `attempt`.

```ts
export async function runBatch(opts: BatchOptions): Promise<BatchRunResult> {
export async function resumeBatch(opts: BatchOptions): Promise<BatchRunResult> {
export async function runOnly(opts: BatchOptions): Promise<BatchRunResult> {
async function orchestrate(opts: OrchestrateOpts): Promise<BatchRunResult> {
```

`runBatch` drives the full five-stage pipeline, `resumeBatch` resumes from an existing checkpoint, and `runOnly` re-runs a single task (preserving `lw:manual` byte-for-byte, refusing `owner: human`). All three funnel into the internal `orchestrate`, which schedules stages 2–5 (semantic topics via `runSemanticTopicStage`, understanding via `runUnderstandingStage`, plus stage-4 and stage-5 generation).

The stage-4 path calls `attemptStage4Generation`, which can delegate to `attemptTopicGeneration` / `attemptUnderstandingGeneration` for the topic and understanding lanes. The stage-5 path calls `attemptStage5Generation`, which composes page + companion inline diagram. Contexts are built through `buildModuleDocContext`, `buildTopicDocContext`, and `buildFlowDocContext`, all of which consume the fair-truncated source from `buildFairTruncatedSource`, the rationale evidence rows from `getRationaleEvidenceForPaths`, the symbol rows from `getModuleSymbolRows`, and the file id list from `getFileIdsForModule`. `resolveOutputTokenBudget` picks an output budget per attempt, and `isRelaxedEligible` decides whether a task may complete under the degraded contract.

Surgical repair is a separate code path: `prepareSurgicalRepair` produces an evidence slice from `buildSurgicalEvidenceSlice`, the orchestrator runs a single bounded repair prompt, and `injectManualBlocksBySection` re-merges `lw:manual` blocks into the new page using `extractManualBlocksBySection`, `sectionRangeOf`, and `slugifyHeadingText`. Owner policy is enforced through `readOwnerFromFrontmatter` and `forceOwnerInFrontmatter` (the latter stamps `owner: generated` or `owner: mixed` when missing or wrong).

Task lifecycle helpers — `getOrCreateTask`, `createOrGetTask`, `resetTaskToPending`, `validateRefinedModules` — wrap SQLite calls. Write-time guard helpers do the transactional dance: `tryWriteAndVerify`, `tryWriteModuleDiagramAndVerify`, and `tryWriteFlowAndVerify` write then verify, while `rollbackWrittenArtifacts` restores snapshots on failure. `safeJsonParse<T>(s: string): T | null` and the usage helpers (`emptyUsage`, `accumulateUsage`, `aggregateTotals`, `computeCostFromUsage`) provide the deterministic accumulation of `StageUsage` totals; `computeCostFromUsage` returns `null` when the model is not in the pricing table.

Two named errors make failure modes explicit: `EmptyPipelineError` (no flow candidates; raised as a recoverable error inside the orchestrator) and `TaskError { code, message, failedAt? }` (stored in checkpoint when a task fails). `finalizeRun`, `drainPendingMetrics`, `buildResult`, and `statusToExitCode` complete the run lifecycle and translate `BatchRunStatus` into a CLI exit code.

## Status reporting

<!-- lw:anchors packages/core/src/batch-status.ts#buildStatusReport packages/core/src/batch-status.ts#listRuns packages/core/src/batch-status.ts#emptyStageUsage packages/core/src/batch-status.ts#aggregateUsageFromCheckpoint packages/core/src/batch-status.ts#mergeStageUsage packages/core/src/batch-status.ts#safeJsonParse packages/core/src/batch-status.ts#parseRunSummary -->

`batch-status.ts` reads `batch_runs` + `batch_tasks` and aggregates them into the public `BatchStatusReport`. Its public entry points are:

```ts
export async function buildStatusReport(
  repoRoot: string,
  runId: number | null = null,
): Promise<BatchStatusReport> {
export async function listRuns(repoRoot: string): Promise<Array<{
  id: number;
  startedAt: number;
  finishedAt: number | null;
  status: string;
  startedBy: string;
}>>;
```

`buildStatusReport` resolves the run (defaulting to the most recent), iterates every `batch_tasks` row, parses each `checkpoint_json` through `safeJsonParse<TaskCheckpoint>` (returning `null` for malformed JSON without throwing), and folds usage into three buckets: `totals` (run-wide), `byStage` (keyed by `StageUsage`), and `byModule` (only for stage-4 tasks, since stages 1/3 do not call the LLM and stage 5 is flows/topics). The aggregation helpers are `emptyStageUsage` (zero row with `costUsd: null`), `aggregateUsageFromCheckpoint` (sums `usageHistory` over known attempts only, flipping on `usageIncomplete` when any attempt is unknown), and `mergeStageUsage` (combines two `StageUsage` rows). `parseRunSummary` defensively parses `run.summary_json` into a `BatchRunSummary`, tolerating `null` and malformed JSON by returning `null` rather than throwing.

Per-task reports include an additive `diagnosticHistory` (only when the checkpoint has it) and `communityCrossCheck` (only when present), both gated through `...(?cond ? { ... } : {})` so older checkpoints serialize byte-stably. Failures are deduplicated into `failures: FailureReportItem[]` with a ready-to-run `retryCommand`.

## Call graph: resolution and reachability

<!-- lw:anchors packages/core/src/call-resolution.ts#resolveCalls packages/core/src/call-resolution.ts#computeCallerCentrality packages/core/src/call-resolution.ts#computeCrossModuleCallees packages/core/src/blast-radius.ts#computeBlastRadius packages/core/src/blast-radius.ts#findAffectedPages -->

`call-resolution.ts` back-fills `calls.resolved_callee_key` for rows the indexer inserted with `NULL`, in two unambiguous-match stages:

```ts
export function resolveCalls(db: Database.Database): ResolveCallsResult
export function computeCallerCentrality(db: Database.Database): Map<string, number>
export function computeCrossModuleCallees(
  db: Database.Database,
  modules: ReadonlyArray<{ id: string; paths: readonly string[] }>,
): Set<string>
```

Step 1 resolves same-file callers (a candidate whose `file_id` matches the call's `file_id`); step 2 resolves globally unique callee names. Both steps require exactly one matching active `function`/`export` row — zero or many candidates leave the column `NULL` rather than guessing. Confidence tags are stamped at extraction time and never changed here; only `'extracted'` rows participate in `computeCallerCentrality` (a god-node-lite proxy counting distinct callers) and `computeCrossModuleCallees` (keys with at least one `'extracted'` resolved edge crossing a module boundary).

`blast-radius.ts` answers the documentation-flavored reachability question by walking the resolved `calls` edges backward from a symbol, breadth-first, and intersecting with the `anchors`/`doc_pages` join:

```ts
export function computeBlastRadius(
  db: Database.Database,
  symbolKey: string,
  opts: BlastRadiusOptions = {},
): BlastRadiusResult
function findAffectedPages(db: Database.Database, symbolKeys: string[]): AffectedPage[]
```

`computeBlastRadius` BFS-expands from `symbolKey` through `caller_key` whose `resolved_callee_key` equals the current frontier node, bucketing depth-1 hits into `directCallers` and depth ≥ 2 into `transitiveCallers`. Defaults cap the walk at `maxDepth = 5` and `maxNodes = 200`; when either bound binds, `truncated` flips to `true`. `callerConfidence` (schema v7) records whether each collected edge was `'extracted'` or `'inferred'`. `findAffectedPages` runs a single `IN (...)` join against `anchors × doc_pages`, groups rows by `wikiPath`, and emits `{ wikiPath, citedSymbolKeys }`.

## Change impact and community cross-check

<!-- lw:anchors packages/core/src/change-impact.ts#computeChangeImpact packages/core/src/change-impact.ts#IMPACT_BUDGETS packages/core/src/change-impact.ts#emptyImpact packages/core/src/change-impact.ts#seedFromDebt packages/core/src/change-impact.ts#computeDirectImporters packages/core/src/change-impact.ts#indexDbExists packages/core/src/community.ts#detectFileCommunities packages/core/src/community.ts#comparePartitions -->

`change-impact.ts` composes three deterministic signals — changed symbols, affected anchors/pages, and direct importers — plus on-demand snippets, into one bounded package:

```ts
export const IMPACT_BUDGETS = {
  maxSymbols: 50,
  maxPages: 20,
  maxSnippets: 10,
  maxImporters: 25,
} as const;
export async function computeChangeImpact(
  repoRoot: string,
  opts: ChangeImpactOptions = {},
): Promise<ChangeImpact>
```

`computeChangeImpact` dispatches on `opts.mode` (`"working-tree"` defaults to a `git diff HEAD` preview via `previewWorkingTreeDebt`; `"debt"` reads open debt rows through `seedFromDebt`). Working-tree mode degrades to `emptyImpact(mode, true)` (`notGitRepo: true`, empty impact) when the diff cannot be produced — it does not throw. Each section caps independently via `IMPACT_BUDGETS`; if any cap binds, `truncated: true` and the `totals` block carries the pre-cap counts. Dependencies are recomputed through `computeDirectImporters(absRoot, new Set(changedFiles))`, but only when `indexDbExists(absRoot)` returns `true`. Snippets reuse `snippetForSymbol` from `update.ts` (no duplication), with `SNIPPET_WINDOW` as the default line window.

`community.ts` runs label propagation over the undirected file import graph as a deterministic diagnostic against the stage-2 heuristic partition:

```ts
export function detectFileCommunities(
  filePaths: string[],
  edges: ResolvedImportEdge[],
): Map<string, string>
export function comparePartitions(
  modules: Array<Pick<Module, "id" | "paths">>,
  communities: Map<string, string>,
): CommunityCrossCheckReport
```

Propagation visits nodes in `localeCompare` order over up to `MAX_PASSES = 10` passes, adopts the highest-count neighbor label (ties broken by the smallest label), and exits early when a pass changes nothing. The community is the winning label (a path), and `comparePartitions` emits one `perModule` row (`dominantCommunity`, `dominantShare`) plus a global `disagreementCount` and `verdict` (`"agree"` | `"divergent"`). Communities are diagnostic only — the heuristic partition always wins; never feed communities back as modules.

<!-- livewiki:navigate:start -->
## Navigate

- Flow: [CLI command surface to core pipeline wiring](flows/cli-src-to-core-src-02.md)
- [core indexing, imports, flows, and frontmatter](core-src-04.md) — dependency and dependent
- [Safe I/O, section guarding, status reporting, and symbol extraction](core-src-09.md) — dependency
- [Stage 4 artifact normalization, validation, and auxiliary page assembly](core-src-01.md) — dependency

> Coverage note: this module's source (7 files, ~322k chars) exceeded the prompt budget and was excerpted; this page documents the closed-list symbols.
<!-- livewiki:navigate:end -->
