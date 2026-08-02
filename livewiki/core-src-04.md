---
title: Core batch pipeline and call-graph analytics
owner: generated
anchors:
  - packages/core/src/batch.ts#EmptyPipelineError
  - packages/core/src/batch.ts#EmptyPipelineError.constructor
  - packages/core/src/batch.ts#TaskError
  - packages/core/src/batch.ts#TaskError.constructor
  - packages/core/src/batch.ts#accumulateUsage
  - packages/core/src/batch.ts#aggregateTotals
  - packages/core/src/batch.ts#attemptStage4Generation
  - packages/core/src/batch.ts#attemptStage5Generation
  - packages/core/src/batch.ts#attemptTopicGeneration
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
  - packages/core/src/batch.ts#resolveOutputTokenBudget
  - packages/core/src/batch.ts#resumeBatch
  - packages/core/src/batch.ts#rollbackWrittenArtifacts
  - packages/core/src/batch.ts#runBatch
  - packages/core/src/batch.ts#runOnly
  - packages/core/src/batch.ts#runSemanticTopicStage
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
  - packages/core/src/batch.ts#validateRefinedModules
  - packages/core/src/batch.ts#verifyIssuesToValidationErrors
  - packages/core/src/blast-radius.test.ts#insertAnchor
  - packages/core/src/blast-radius.test.ts#insertFile
  - packages/core/src/blast-radius.test.ts#insertPage
  - packages/core/src/blast-radius.test.ts#insertResolvedCall
  - packages/core/src/blast-radius.ts#computeBlastRadius
  - packages/core/src/blast-radius.ts#findAffectedPages
  - packages/core/src/call-resolution.test.ts#confidenceOf
  - packages/core/src/call-resolution.test.ts#insertCall
  - packages/core/src/call-resolution.test.ts#insertFile
  - packages/core/src/call-resolution.test.ts#insertResolvedCall
  - packages/core/src/call-resolution.test.ts#insertSymbol
  - packages/core/src/call-resolution.test.ts#resolvedKeyOf
  - packages/core/src/call-resolution.ts#computeCallerCentrality
  - packages/core/src/call-resolution.ts#computeCrossModuleCallees
  - packages/core/src/call-resolution.ts#resolveCalls
  - packages/core/src/calls.test.ts#parse
  - packages/core/src/change-impact.test.ts#git
  - packages/core/src/change-impact.test.ts#gitCommitAll
  - packages/core/src/change-impact.test.ts#gitInit
  - packages/core/src/change-impact.test.ts#setupBaseline
  - packages/core/src/change-impact.test.ts#writeRepoFile
  - packages/core/src/change-impact.ts#IMPACT_BUDGETS
  - packages/core/src/change-impact.ts#computeChangeImpact
  - packages/core/src/change-impact.ts#computeDirectImporters
  - packages/core/src/change-impact.ts#emptyImpact
  - packages/core/src/change-impact.ts#indexDbExists
  - packages/core/src/change-impact.ts#seedFromDebt
  - packages/core/src/community.test.ts#edge
  - packages/core/src/community.ts#comparePartitions
  - packages/core/src/community.ts#detectFileCommunities
---

# Core batch pipeline and call-graph analytics

This page documents the batch documentation pipeline and the supporting call-graph analytics that feed it.

## When to use this page

- **Run** the resumable batch pipeline with `runBatch` / `resumeBatch` / `runOnly` to generate wiki pages from the index DB.
- **Resolve** raw `calls` rows into `resolved_callee_key` keys via `resolveCalls`, then derive cross-module callees and caller centrality for downstream flow/topic planning.
- **Assess** documentation blast radius for a symbol using `computeBlastRadius` to identify pages that would be affected by a change.
- **Quantify** working-tree or open-debt change impact with `computeChangeImpact` against the bound `IMPACT_BUDGETS`.

## How it fits

This module sits inside `packages/core/src` and orchestrates the documentation pipeline that runs after indexing. `batch.ts` is the top-level driver: it opens the SQLite index produced by `indexer.ts`, applies the heuristic + optional LLM-refined module partition from `modules.ts`, and dispatches one documentation task per module. The call-graph layer (`call-resolution.ts`, `blast-radius.ts`, `community.ts`) reads from the same `calls` / `symbols` / `doc_pages` / `anchors` tables to enrich prompts and to feed change-impact analytics. The repo-local config loader in `config.ts` (and its tests) sits beside these as a thin dependency surface.

## Batch pipeline orchestration

<!-- lw:anchors packages/core/src/batch.ts#runBatch packages/core/src/batch.ts#resumeBatch packages/core/src/batch.ts#runOnly packages/core/src/batch.ts#orchestrate packages/core/src/batch.ts#runSemanticTopicStage packages/core/src/batch.ts#EmptyPipelineError packages/core/src/batch.ts#EmptyPipelineError.constructor packages/core/src/batch.ts#TaskError packages/core/src/batch.ts#TaskError.constructor packages/core/src/batch.ts#getOrCreateTask packages/core/src/batch.ts#createOrGetTask packages/core/src/batch.ts#finalizeRun packages/core/src/batch.ts#drainPendingMetrics packages/core/src/batch.ts#buildResult packages/core/src/batch.ts#statusToExitCode -->

The three public entry points share one internal orchestrator:

```ts
export async function runBatch(opts: BatchOptions): Promise<BatchRunResult> {
export async function resumeBatch(opts: BatchOptions): Promise<BatchRunResult> {
export async function runOnly(opts: BatchOptions): Promise<BatchRunResult> {
async function orchestrate(opts: OrchestrateOpts): Promise<BatchRunResult> {
```

`orchestrate` walks the four-stage pipeline: scan/index, identify modules (heuristic + opt-in LLM refine), prioritize by centrality + size, then document one task per module. Failures mark the task `failed` in the checkpoint and the run continues; a circuit breaker trips on 3 consecutive failures or >50% failure rate and aborts the run. Runs that finish with any failure report `completed_with_failures` and an exit code other than 0 via `statusToExitCode`. `runSemanticTopicStage` plugs in between the stage-4 loop and the navigation hook for the Phase-5 topic layer, gated per detected candidate; zero candidates is a valid outcome rather than an empty-pipeline error.

`getOrCreateTask` (and the test seam `createOrGetTask`) deduplicate tasks per `(runId, moduleId)` so `--only` retries add usage to the same checkpoint row. `finalizeRun` builds the aggregate `BatchRunResult` via `buildResult`, while `drainPendingMetrics` flushes any buffered metrics before the process exits. `runOnly` re-runs a single target by `module.id` or `runId`, preserves `lw:manual` blocks byte-for-byte, and refuses content with `owner: human`.

Two error classes are exported for callers to distinguish empty-pipeline exits from task-level failures:

```ts
export class EmptyPipelineError extends Error {
class TaskError extends Error {
  constructor(code: string, message: string) {
```

`EmptyPipelineError` signals that zero candidates passed a gated stage (for example, `maxFlows: 0` disabling stage 5, or zero detected topic candidates) — it is a normal outcome, not a throwable failure. `TaskError` carries a stable `code` plus `message` and is the type used internally to wrap per-task failures for the checkpoint.

## Stage-4 / stage-5 / topic attempt pipeline

<!-- lw:anchors packages/core/src/batch.ts#attemptStage4Generation packages/core/src/batch.ts#attemptStage5Generation packages/core/src/batch.ts#attemptTopicGeneration packages/core/src/batch.ts#topicPlanDiagnostic packages/core/src/batch.ts#topicAttemptDiagnostic packages/core/src/batch.ts#diagnosticAttempt packages/core/src/batch.ts#prepareSurgicalRepair packages/core/src/batch.ts#buildSurgicalEvidenceSlice packages/core/src/batch.ts#isRelaxedEligible packages/core/src/batch.ts#summarizeLlmDiagnosticError packages/core/src/batch.ts#summarizeVerifyDiagnosticErrors packages/core/src/batch.ts#tryWriteAndVerify packages/core/src/batch.ts#tryWriteFlowAndVerify packages/core/src/batch.ts#rollbackWrittenArtifacts packages/core/src/batch.ts#verifyIssuesToValidationErrors packages/core/src/batch.ts#validateRefinedModules packages/core/src/batch.ts#accumulateUsage packages/core/src/batch.ts#aggregateTotals packages/core/src/batch.ts#emptyUsage packages/core/src/batch.ts#resolveOutputTokenBudget packages/core/src/batch.ts#computeCostFromUsage -->

Each per-module / per-flow / per-topic attempt goes through one normalized artifact → bounded repair → transactional write sequence:

```ts
async function attemptStage4Generation(
async function attemptStage5Generation(
async function attemptTopicGeneration(opts: TopicAttemptOpts): Promise<Stage4AttemptResult> {
function topicPlanDiagnostic(
function topicAttemptDiagnostic(
function diagnosticAttempt(input: {
async function prepareSurgicalRepair(
async function buildSurgicalEvidenceSlice(
function isRelaxedEligible(
```

The structural validator (`validateRefinedModules` + `verifyIssuesToValidationErrors`) classifies failures, and `summarizeLlmDiagnosticError` / `summarizeVerifyDiagnosticErrors` condense each attempt's diagnostic into a compact, prompt-friendly form. `isRelaxedEligible` gates the recovery tier: when enabled in config, a strict loop that would mark `repair_exhausted` gets ONE final attempt under the relaxed presentation contract, with success flagging the page `quality: degraded`.

Surgical repairs run through `prepareSurgicalRepair` + `buildSurgicalEvidenceSlice` instead of the full-context repair prompt, guarded against prompt-cascade amplification. Non-consuming retries for normalized incomplete responses use the `nonConsumingRetries` option (default 2) and add to `usageHistory` rather than consuming a repair slot.

Writes go through `tryWriteAndVerify` / `tryWriteFlowAndVerify` (the latter for the flow-stage companion diagram + page pair). Each write is transactional: snapshot → write → verify → restore-or-remove on failure via `rollbackWrittenArtifacts`. Cost accounting uses `computeCostFromUsage`, budget resolution goes through `resolveOutputTokenBudget`, and per-stage usage rolls up through `accumulateUsage` / `aggregateTotals` over `emptyUsage()`.

## Module / topic context builders

<!-- lw:anchors packages/core/src/batch.ts#buildModuleDocContext packages/core/src/batch.ts#buildTopicDocContext packages/core/src/batch.ts#buildFlowDocContext packages/core/src/batch.ts#getModuleSymbolRows packages/core/src/batch.ts#getFileIdsForModule packages/core/src/batch.ts#getRationaleEvidenceForPaths packages/core/src/batch.ts#buildFairTruncatedSource -->

The context assemblers materialize the inputs that the LLM sees per task:

```ts
export async function buildModuleDocContext(
export async function buildTopicDocContext(
async function buildFlowDocContext(
async function getModuleSymbolRows(
async function getFileIdsForModule(absRoot: string, module: Module): Promise<number[]>
async function getRationaleEvidenceForPaths(
export async function buildFairTruncatedSource(
```

`getModuleSymbolRows` and `getFileIdsForModule` fetch the indexed rows for the current module; `getRationaleEvidenceForPaths` joins the rationale-evidence table for the WHY prompts. `buildFairTruncatedSource` enforces the per-module source character cap (default 60,000) and trims to a fair window before injection. `buildModuleDocContext`, `buildTopicDocContext`, and `buildFlowDocContext` are the three top-level assemblers — one per stage's artifact shape.

## Manual-block preservation and frontmatter ownership

<!-- lw:anchors packages/core/src/batch.ts#readOwnerFromFrontmatter packages/core/src/batch.ts#forceOwnerInFrontmatter packages/core/src/batch.ts#extractManualBlocksBySection packages/core/src/batch.ts#injectManualBlocksBySection packages/core/src/batch.ts#sectionRangeOf packages/core/src/batch.ts#slugifyHeadingText packages/core/src/batch.ts#safeJsonParse -->

These helpers enforce the two invariants around user-authored content:

```ts
function readOwnerFromFrontmatter(content: string | null): PreOwnerCheck {
function forceOwnerInFrontmatter(content: string, owner: "generated" | "mixed"): string {
function extractManualBlocksBySection(content: string): Map<string | null, string[]> {
function injectManualBlocksBySection(existing: string, newContent: string): string | null {
function sectionRangeOf(headingOffset: number): { endOffset: number } {
function slugifyHeadingText(text: string): string {
function safeJsonParse<T>(s: string): T | null {
```

`readOwnerFromFrontmatter` classifies a pre-existing page's owner before `--only` decides whether to overwrite it (content with `owner: human` is refused). `extractManualBlocksBySection` + `injectManualBlocksBySection` walk the section headings via `sectionRangeOf` (and `slugifyHeadingText` for section-key matching) so that human-authored content is preserved byte-for-byte across regenerations. `forceOwnerInFrontmatter` normalizes the frontmatter `owner` field after regeneration (only `generated` or `mixed`, never `human`). `safeJsonParse` is the generic JSON guard used wherever LLM output is parsed into an artifact.

## Call resolution

<!-- lw:anchors packages/core/src/call-resolution.ts#resolveCalls packages/core/src/call-resolution.ts#computeCrossModuleCallees packages/core/src/call-resolution.ts#computeCallerCentrality packages/core/src/call-resolution.test.ts#insertFile packages/core/src/call-resolution.test.ts#insertSymbol packages/core/src/call-resolution.test.ts#insertCall packages/core/src/call-resolution.test.ts#insertResolvedCall packages/core/src/call-resolution.test.ts#resolvedKeyOf packages/core/src/call-resolution.test.ts#confidenceOf packages/core/src/calls.test.ts#parse -->

`call-resolution.ts` fills `calls.resolved_callee_key` for rows the indexer inserted with it unset:

```ts
export function resolveCalls(db: Database.Database): ResolveCallsResult {
export function computeCrossModuleCallees(
  db: Database.Database,
  modules: ReadonlyArray<{ id: string; paths: readonly string[] }>,
): Set<string> {
export function computeCallerCentrality(db: Database.Database): Map<string, number> {
```

`resolveCalls` runs over every row with `resolved_callee_key IS NULL` and tries two steps in order: a same-file match (exactly one active symbol in the same file whose `name` equals `callee_name`) and then a global-unique match (exactly one active symbol anywhere). Ambiguous matches (zero or multiple candidates) leave the column NULL — never a guess. The `confidence` tag is set at extraction time and never modified by resolution; only `extracted`-confidence edges are walked by `computeCrossModuleCallees` and `computeCallerCentrality`. The latter two are deterministic, SQL-only analytics: cross-module callees is a `Set<string>` of symbol keys with at least one resolved cross-module caller, and caller centrality is the count of distinct resolved callers per callee key. `call-resolution.test.ts` and `calls.test.ts` (via the `parse` helper that wraps `parseSource`) cover both DB-level resolution and the parser-level extraction.

## Blast radius

<!-- lw:anchors packages/core/src/blast-radius.ts#computeBlastRadius packages/core/src/blast-radius.ts#findAffectedPages packages/core/src/blast-radius.test.ts#insertFile packages/core/src/blast-radius.test.ts#insertResolvedCall packages/core/src/blast-radius.test.ts#insertPage packages/core/src/blast-radius.test.ts#insertAnchor -->

`blast-radius.ts` answers "what would break if I change symbol X?" by walking the `calls` table backward from the target and cross-referencing with `anchors` / `doc_pages`:

```ts
export function computeBlastRadius(
function findAffectedPages(db: Database.Database, symbolKeys: string[]): AffectedPage[] {
```

Only `resolved_callee_key` edges are walked — unresolved raw calls would be either silent noise or wrong edges in a "what breaks" answer. The BFS is bounded by `maxDepth` (default 5) and `maxNodes` (default 200), and `truncated: true` reports when the bound, not "no more callers", ended the search. `callerConfidence` is recorded per collected caller so consumers can present direct vs inferred callers separately. `findAffectedPages` joins the result set against the `anchors` + `doc_pages` tables and returns the wiki paths whose pages cite any symbol in the blast radius, along with the cited symbol keys. The test helpers (`insertFile`, `insertResolvedCall`, `insertPage`, `insertAnchor`) build a synthetic SQLite DB and exercise direct callers, transitive chains, deduplication, depth / node caps, and pagination of affected pages.

## Change-impact analytics

<!-- lw:anchors packages/core/src/change-impact.ts#computeChangeImpact packages/core/src/change-impact.ts#IMPACT_BUDGETS packages/core/src/change-impact.ts#emptyImpact packages/core/src/change-impact.ts#indexDbExists packages/core/src/change-impact.ts#seedFromDebt packages/core/src/change-impact.ts#computeDirectImporters packages/core/src/change-impact.test.ts#git packages/core/src/change-impact.test.ts#gitInit packages/core/src/change-impact.test.ts#gitCommitAll packages/core/src/change-impact.test.ts#writeRepoFile packages/core/src/change-impact.test.ts#setupBaseline -->

`change-impact.ts` composes three existing deterministic signals (changed symbols, affected pages, direct importers, snippets) into one bounded package:

```ts
export async function computeChangeImpact(
export const IMPACT_BUDGETS = {
function emptyImpact(mode: "working-tree" | "debt", notGitRepo: boolean): ChangeImpact {
async function indexDbExists(absRoot: string): Promise<boolean>
async function seedFromDebt(
async function computeDirectImporters(
```

`computeChangeImpact` runs in either `working-tree` (default, one `git diff --name-only HEAD` spawn via `previewWorkingTreeDebt`) or `debt` (open debt rows via `status.run`) mode. Debt `moved` events pass through untouched. The package is bounded by `IMPACT_BUDGETS = { maxSymbols: 50, maxPages: 20, maxSnippets: 10, maxImporters: 25 }`; when any cap binds, `truncated: true` is reported alongside the pre-cap `totals` so a binding cap is never silent. It performs ZERO writes — no debt rows, no anchor updates, no index mutation — and degrades cleanly (not-a-git-repo returns `notGitRepo: true` with an empty impact, never a throw; missing index DB returns changed files only). Every list is sorted for determinism; identical inputs produce identical output.

`computeDirectImporters` resolves import edges on demand via the shared `resolveImportEdges` (imports are never persisted). `indexDbExists` guards the index-DB open. `emptyImpact` is the no-op result builder used by the not-a-git-repo and missing-index paths. The test helpers (`git`, `gitInit`, `gitCommitAll`, `writeRepoFile`, `setupBaseline`) build a real temp git repo with three anchored TypeScript files and matching wiki pages so the working-tree mode can exercise real `git diff` output.

## Community detection cross-check

<!-- lw:anchors packages/core/src/community.ts#detectFileCommunities packages/core/src/community.ts#comparePartitions packages/core/src/community.test.ts#edge -->

`community.ts` runs deterministic label propagation over the undirected file import graph to cross-check the stage-2 module partition:

```ts
export function detectFileCommunities(
export function comparePartitions(
```

`detectFileCommunities` propagates labels in `localeCompare` order for at most `MAX_PASSES = 10` passes, with ties broken by the smallest label; neighborless files keep their own path forever; self-edges and edges to unknown files are ignored. The output is a `Map<filePath, communityId>` where the community ID is one of the file paths (the winning label). `comparePartitions` produces a per-module `dominantCommunity` / `dominantShare` plus a `disagreementCount` and an `agree` / `divergent` verdict; the heuristic partition always wins, so this module exists only to surface divergence for human review. The `edge` test helper builds a `ResolvedImportEdge` for graph construction in the test suite.

## Config loader

The config layer (`config.ts`) is the thin dependency surface that loads `.livewiki/config.json`, validates providers / presets / path-role patterns, and applies defaults; `config.test.ts` exercises it via a temp `.livewiki/` directory. The test helper `parse` defined in `calls.test.ts` wraps `parseSource` for the call-extraction tests and is documented here for cross-reference, since `config` shares the same temp-directory fixture pattern as the other test files in this module.

<!-- livewiki:navigate:start -->
## Navigate

- Flow: [CLI to persistence flow — entry through `livewiki batch` to the SQLite index](flows/cli-src-01-to-core-src-05.md)
- [Core Repair, Status, Sectioning, Symbols, and Risk Pipeline](core-src-11.md) — dependency
- [Core runtime config, schema, diagrams, diff preview, and export](core-src-05.md) — dependency
- [Core module identification, manifest I/O, and Markdown mask helpers](core-src-08.md) — dependency

> Coverage note: this module's source (11 files, ~330k chars) exceeded the prompt budget and was excerpted; this page documents the closed-list symbols.
<!-- livewiki:navigate:end -->
