---
title: Batch pipeline, configuration, index database, and Mermaid diagrams
owner: generated
anchors:
  - packages/core/src/batch.ts#runBatch
  - packages/core/src/batch.ts#resumeBatch
  - packages/core/src/batch.ts#runOnly
  - packages/core/src/batch.ts#orchestrate
  - packages/core/src/batch.ts#runSemanticTopicStage
  - packages/core/src/batch.ts#topicPlanDiagnostic
  - packages/core/src/batch.ts#topicAttemptDiagnostic
  - packages/core/src/batch.ts#EmptyPipelineError
  - packages/core/src/batch.ts#EmptyPipelineError.constructor
  - packages/core/src/batch.ts#TaskError
  - packages/core/src/batch.ts#TaskError.constructor
  - packages/core/src/batch.ts#emptyUsage
  - packages/core/src/batch.ts#aggregateTotals
  - packages/core/src/batch.ts#accumulateUsage
  - packages/core/src/batch.ts#getOrCreateTask
  - packages/core/src/batch.ts#createOrGetTask
  - packages/core/src/batch.ts#safeJsonParse
  - packages/core/src/batch.ts#validateRefinedModules
  - packages/core/src/batch.ts#collectAllImports
  - packages/core/src/batch.ts#readOwnerFromFrontmatter
  - packages/core/src/batch.ts#forceOwnerInFrontmatter
  - packages/core/src/batch.ts#extractManualBlocksBySection
  - packages/core/src/batch.ts#slugifyHeadingText
  - packages/core/src/batch.ts#injectManualBlocksBySection
  - packages/core/src/batch.ts#sectionRangeOf
  - packages/core/src/batch.ts#rollbackWrittenArtifacts
  - packages/core/src/batch.ts#tryWriteAndVerify
  - packages/core/src/batch.ts#verifyIssuesToValidationErrors
  - packages/core/src/batch.ts#summarizeLlmDiagnosticError
  - packages/core/src/batch.ts#summarizeVerifyDiagnosticErrors
  - packages/core/src/batch.ts#diagnosticAttempt
  - packages/core/src/batch.ts#attemptStage4Generation
  - packages/core/src/batch.ts#computeCostFromUsage
  - packages/core/src/batch.ts#getModuleSymbolRows
  - packages/core/src/batch.ts#buildModuleDocContext
  - packages/core/src/batch.ts#buildFairTruncatedSource
  - packages/core/src/batch.ts#getFileIdsForModule
  - packages/core/src/batch.ts#finalizeRun
  - packages/core/src/batch.ts#buildResult
  - packages/core/src/batch.ts#statusToExitCode
  - packages/core/src/batch.ts#attemptStage5Generation
  - packages/core/src/batch.ts#attemptTopicGeneration
  - packages/core/src/batch.ts#buildTopicDocContext
  - packages/core/src/batch.ts#buildFlowDocContext
  - packages/core/src/batch.ts#extractModuleOpeningDigest
  - packages/core/src/batch.ts#tryWriteFlowAndVerify
  - packages/core/src/config.ts#CONFIG_DEFAULTS
  - packages/core/src/config.ts#CONFIG_FILENAME
  - packages/core/src/config.ts#CONFIG_PATH
  - packages/core/src/config.ts#MAX_TIMEOUT_MS
  - packages/core/src/config.ts#MissingProviderConfigError
  - packages/core/src/config.ts#MissingProviderConfigError.constructor
  - packages/core/src/config.ts#applyDefaults
  - packages/core/src/config.ts#assertValidTimeoutMs
  - packages/core/src/config.ts#loadConfig
  - packages/core/src/config.ts#resolveBaseUrl
  - packages/core/src/config.ts#resolveExtraIgnores
  - packages/core/src/config.ts#resolveProviderFromConfig
  - packages/core/src/config.ts#saveConfig
  - packages/core/src/config.ts#validateConfigForBatch
  - packages/core/src/config.ts#validateConfigShape
  - packages/core/src/db.ts#CURRENT_SCHEMA_VERSION
  - packages/core/src/db.ts#MIGRATION_SQL_V3
  - packages/core/src/db.ts#SCHEMA_SQL
  - packages/core/src/db.ts#SCHEMA_VERSION_KEY
  - packages/core/src/db.ts#migrateV3ToV4
  - packages/core/src/db.ts#migrationsFor
  - packages/core/src/db.ts#openIndex
  - packages/core/src/db.ts#postV3Migrations
  - packages/core/src/diagrams.ts#classIdentity
  - packages/core/src/diagrams.ts#escapeLabel
  - packages/core/src/diagrams.ts#generateClassDiagram
  - packages/core/src/diagrams.ts#generateModulesGraph
  - packages/core/src/diagrams.ts#generateStructure
  - packages/core/src/diagrams.ts#mermaidId
  - packages/core/src/diagrams.ts#mermaidMemberName
  - packages/core/src/diagrams.ts#moduleSlug
---

# Batch pipeline, configuration, index database, and Mermaid diagrams

This page documents how livewiki's batch orchestrator, configuration loader, SQLite index, and deterministic Mermaid diagram generators fit together to turn a repository into navigable documentation.

## When to use this page

- **Run** the multi-stage documentation pipeline end-to-end or resume an interrupted run.
- **Inspect** `.livewiki/config.json` for provider, model, language, and pipeline-cap defaults.
- **Open** or migrate the SQLite index database that stores files, symbols, anchors, debt, and batch run records.
- **Generate** Mermaid diagrams (directory structure, module graph, per-module class diagrams) without invoking an LLM.

## How it fits

The `packages/core/src` directory hosts the orchestration primitives that the livewiki CLI and one-shot tools call. `batch.ts` is the documented pipeline driver — it indexes the repo, identifies and prioritizes modules, then drives stage-4 LLM page generation (with bounded repair) and stage-5 flow/topic synthesis. `config.ts` provides the typed loader, saver, and validators for `.livewiki/config.json` (loaded by `batch.ts` before each run). `db.ts` owns the schema, migrations, and `openIndex` factory used both by the indexer and by the batch orchestrator. `diagrams.ts` produces deterministic Mermaid output (structure, module graph, per-module class diagram) consumed by the init and batch layers without any LLM involvement.

## Pipeline entry points and run orchestration

<!-- lw:anchors packages/core/src/batch.ts#runBatch packages/core/src/batch.ts#resumeBatch packages/core/src/batch.ts#runOnly packages/core/src/batch.ts#orchestrate packages/core/src/batch.ts#statusToExitCode -->

The three exported entry points share a common shape:

```ts
export async function runBatch(opts: BatchOptions): Promise<BatchRunResult> { /* ... */ }
export async function resumeBatch(opts: BatchOptions): Promise<BatchRunResult> { /* ... */ }
export async function runOnly(opts: BatchOptions): Promise<BatchRunResult> { /* ... */ }
async function orchestrate(opts: OrchestrateOpts): Promise<BatchRunResult> { /* ... */ }
```

`runBatch` performs the full 4-stage pipeline (scan, identify, prioritize, document) starting from a clean checkpoint. `resumeBatch` rehydrates an existing run and continues pending or retriable tasks. `runOnly` re-runs a single task identified by `--only <target>` (module id or runId), preserving any `lw:manual` blocks byte-for-byte and refusing `owner: human` rewrites — and adding a new attempt to `usageHistory` rather than overwriting it. All three delegate to the internal `orchestrate`, which holds the stage loop, the circuit breaker (3 consecutive failures OR >50% failure rate → abort), and the transactional write policy: snapshot → write → verify → restore or remove on failure.

Run termination is projected to a process exit code by:

```ts
export function statusToExitCode(status: BatchRunResult["status"]): number { /* ... */ }
```

A run that finished but contained any failed tasks becomes `completed_with_failures` (non-zero exit) so CI and shells can detect partial success without parsing JSON. The visible excerpt does not establish exhaustive behaviour for every status branch.

## Stage-5 flow and topic synthesis

<!-- lw:anchors packages/core/src/batch.ts#runSemanticTopicStage packages/core/src/batch.ts#attemptStage5Generation packages/core/src/batch.ts#buildFlowDocContext packages/core/src/batch.ts#tryWriteFlowAndVerify -->

After the stage-4 loop and before navigation sync, `runSemanticTopicStage` runs one gated task per detected flow candidate, using the same machinery shape as stage-4: bounded repair slots, transactional write (page + companion diagram as one unit), and the same circuit breaker / checkpoint semantics. The model emits the diagram INLINE; the orchestrator extracts it, validates the placeholder-substituted page, and writes both artifacts. Zero detected candidates is a valid outcome (not an empty pipeline), and `maxFlows: 0` disables the stage entirely.

```ts
async function runSemanticTopicStage(opts: { /* ... */ }): Promise<{ /* ... */ }> { /* ... */ }
async function attemptStage5Generation(/* ... */): Promise<Stage5AttemptResult> { /* ... */ }
async function buildFlowDocContext(/* ... */): Promise<FlowDocContext> { /* ... */ }
async function tryWriteFlowAndVerify(/* ... */): Promise<WriteFlowResult> { /* ... */ }
```

Flow candidates are seeded from the inventory by an external helper (the visible excerpt of `batch.ts` does not define the seeding function in this module); the orchestrator refuses to start any stage-5 task for a candidate that fails the deterministic K-a (anchor capacity) or K-b (section-anchor coverage) pre-flight, and surfaces the skip in the run result rather than persisting a `batch_tasks` row.

## Stage-4 generation, repair, and diagnostics

<!-- lw:anchors packages/core/src/batch.ts#attemptStage4Generation packages/core/src/batch.ts#attemptTopicGeneration packages/core/src/batch.ts#buildTopicDocContext packages/core/src/batch.ts#diagnosticAttempt packages/core/src/batch.ts#topicAttemptDiagnostic packages/core/src/batch.ts#topicPlanDiagnostic -->

Per-task generation and repair are produced by:

```ts
async function attemptStage4Generation(/* ... */): Promise<Stage4AttemptResult> { /* ... */ }
async function attemptTopicGeneration(opts: TopicAttemptOpts): Promise<Stage4AttemptResult> { /* ... */ }
async function buildTopicDocContext(/* ... */): Promise<TopicDocContext> { /* ... */ }
function diagnosticAttempt(input: { /* ... */ }): DiagnosticAttempt { /* ... */ }
function topicAttemptDiagnostic(/* ... */): TopicDiagnostic { /* ... */ }
function topicPlanDiagnostic(/* ... */): TopicPlanDiagnostic { /* ... */ }
```

Each stage-4 task accepts a normalized artifact (not the raw transcript). Structural failures trigger a bounded sequence of repair prompts (`buildRepairPrompt` from `./prompts.js`) — the number of repair slots defaults to `CONFIG_DEFAULTS.maxRepairAttempts = 2`, overridable per run via `BatchOptions.maxRepairAttempts`. A second non-consuming retry budget (`maxIncompleteRetries`, default 2) handles normalized incomplete responses without burning a repair slot. `diagnosticAttempt` produces a per-attempt diagnostic envelope for the human and JSON reporters; `topicAttemptDiagnostic` and `topicPlanDiagnostic` mirror the same shape for stage-5 topic tasks.

## Diagnostics, error summaries, cost computation, and validation mapping

<!-- lw:anchors packages/core/src/batch.ts#summarizeLlmDiagnosticError packages/core/src/batch.ts#summarizeVerifyDiagnosticErrors packages/core/src/batch.ts#verifyIssuesToValidationErrors packages/core/src/batch.ts#validateRefinedModules packages/core/src/batch.ts#computeCostFromUsage -->

LLM-side and verify-side failures are reduced to bounded, cap-sized summaries:

```ts
function summarizeLlmDiagnosticError(error: { /* ... */ }): DiagnosticErrorSummary { /* ... */ }
function summarizeVerifyDiagnosticErrors(/* ... */): DiagnosticErrorSummary { /* ... */ }
function verifyIssuesToValidationErrors(/* ... */): ValidationError[] { /* ... */ }
function validateRefinedModules(/* ... */): RefinedModulesValidation { /* ... */ }
function computeCostFromUsage(/* ... */): number { /* ... */ }
```

Both summarizers respect `DIAGNOSTIC_MAX_ERRORS` and `DIAGNOSTIC_TEXT_CAP` from `./batch-state.js`, so that a single LLM that emits thousands of token errors still produces a finite report. `verifyIssuesToValidationErrors` translates `VerifyIssue` rows into the structured `ValidationError` shape consumed by the artifact validators, `validateRefinedModules` validates the optional LLM-refined module list produced by stage 2 (`--no-refine` skips the LLM refinement entirely), and `computeCostFromUsage` derives the per-attempt USD cost consumed by `accumulateUsage` when folding into the run totals. The visible excerpt does not establish exhaustive behaviour for every cost branch when pricing data is missing.

## Usage accounting, task state, and the empty-pipeline guard

<!-- lw:anchors packages/core/src/batch.ts#EmptyPipelineError packages/core/src/batch.ts#EmptyPipelineError.constructor packages/core/src/batch.ts#TaskError packages/core/src/batch.ts#TaskError.constructor packages/core/src/batch.ts#emptyUsage packages/core/src/batch.ts#aggregateTotals packages/core/src/batch.ts#accumulateUsage packages/core/src/batch.ts#getOrCreateTask packages/core/src/batch.ts#createOrGetTask packages/core/src/batch.ts#safeJsonParse -->

Usage tracking uses a small algebra of pure helpers:

```ts
export class EmptyPipelineError extends Error { constructor(message: string) { /* ... */ } }
class TaskError extends Error { constructor(code: string, message: string) { /* ... */ } }
function emptyUsage(): StageUsage { /* ... */ }
function aggregateTotals(a: StageUsage, b: StageUsage): StageUsage { /* ... */ }
function accumulateUsage(/* ... */): StageUsage { /* ... */ }
function getOrCreateTask(/* ... */): TaskCheckpoint { /* ... */ }
function createOrGetTask(/* ... */): TaskCheckpoint { /* ... */ }
function safeJsonParse<T>(s: string): T | null { /* ... */ }
```

`EmptyPipelineError` is thrown when the run produced zero module candidates (zero candidates after heuristic + optional LLM refinement, or zero flow candidates when `maxFlows > 0`); it is the contract that callers check before treating the absence of output as a bug. `TaskError` carries an error `code` for categorization (e.g., `LLM_TIMEOUT`, `VERIFY_FAILED`, `INVALID_ARTIFACT`). `aggregateTotals` / `accumulateUsage` fold per-attempt usage into the run's totals; `finalizeRun` uses those totals to populate `BatchRunResult.totals`, `byModule`, and the persisted `batch_runs.summary_json`. `safeJsonParse` returns `null` on malformed JSON so checkpoint reads do not crash the orchestrator.

## Module context, source truncation, and per-file ID lookup

<!-- lw:anchors packages/core/src/batch.ts#buildModuleDocContext packages/core/src/batch.ts#buildFairTruncatedSource packages/core/src/batch.ts#getModuleSymbolRows packages/core/src/batch.ts#getFileIdsForModule packages/core/src/batch.ts#extractModuleOpeningDigest -->

Stage-4 prompt assembly and module-wide reads live in:

```ts
async function buildModuleDocContext(/* ... */): Promise<ModuleDocContext> { /* ... */ }
export async function buildFairTruncatedSource(/* ... */): Promise<TruncatedSource> { /* ... */ }
async function getModuleSymbolRows(/* ... */): Promise<SymbolRow[]> { /* ... */ }
async function getFileIdsForModule(absRoot: string, module: Module): Promise<number[]> { /* ... */ }
function extractModuleOpeningDigest(pageContent: string): string { /* ... */ }
```

`buildModuleDocContext` produces the per-task context object passed to `attemptStage4Generation`, including imports collected by `collectAllImports`. `buildFairTruncatedSource` enforces the per-module character budget (`contextCharBudget`, default `60_000`) and produces a deterministic, balanced truncation rather than a head-only slice. `getModuleSymbolRows` and `getFileIdsForModule` query the SQLite index opened by `openIndex` (from `./db.js`) to gather the inputs for the context. `extractModuleOpeningDigest` pulls the frontmatter + first H1 + leading paragraph so the runner can echo a one-line summary per module in the run report.

## Import collection, frontmatter handling, and manual-block preservation

<!-- lw:anchors packages/core/src/batch.ts#collectAllImports packages/core/src/batch.ts#readOwnerFromFrontmatter packages/core/src/batch.ts#forceOwnerInFrontmatter packages/core/src/batch.ts#extractManualBlocksBySection packages/core/src/batch.ts#slugifyHeadingText packages/core/src/batch.ts#injectManualBlocksBySection packages/core/src/batch.ts#sectionRangeOf packages/core/src/batch.ts#rollbackWrittenArtifacts packages/core/src/batch.ts#tryWriteAndVerify -->

These helpers govern how the orchestrator reads and rewrites existing pages without losing human-authored content:

```ts
async function collectAllImports(/* ... */): Promise<ImportEdge[]> { /* ... */ }
function readOwnerFromFrontmatter(content: string | null): PreOwnerCheck { /* ... */ }
function forceOwnerInFrontmatter(content: string, owner: "generated" | "mixed"): string { /* ... */ }
function extractManualBlocksBySection(content: string): Map<string | null, string[]> { /* ... */ }
function slugifyHeadingText(text: string): string { /* ... */ }
function injectManualBlocksBySection(existing: string, newContent: string): string | null { /* ... */ }
function sectionRangeOf(headingOffset: number): { endOffset: number } { /* ... */ }
async function rollbackWrittenArtifacts(/* ... */): Promise<void> { /* ... */ }
async function tryWriteAndVerify(/* ... */): Promise<WriteAttemptResult> { /* ... */ }
```

`collectAllImports` calls into `./imports.js` and `./import-resolution.js` to resolve `tsconfig` / workspace-aware import edges (the same source used by the modules layer to build the module graph). `readOwnerFromFrontmatter` classifies an existing page as `human`, `mixed`, `generated`, or unparseable; `forceOwnerInFrontmatter` normalizes only generated/mixed pages — human-owned pages are preserved. `extractManualBlocksBySection` slices existing content into a map keyed by section slug (with `null` for blocks before the first heading), `slugifyHeadingText` turns headings into stable slugs, `sectionRangeOf` computes end offsets, and `injectManualBlocksBySection` re-inserts the human blocks into the new generated page (returning `null` if no compatible section structure exists, which triggers a rollback). `rollbackWrittenArtifacts` is invoked when `tryWriteAndVerify` reports a structural failure: it restores the pre-write snapshot for every artifact the task touched, including the page and any companion diagram.

## Result building, run finalization, and exit-code mapping

<!-- lw:anchors packages/core/src/batch.ts#finalizeRun packages/core/src/batch.ts#buildResult -->

After the stage loops complete, the orchestrator closes out the run:

```ts
function finalizeRun(/* ... */): BatchRunResult { /* ... */ }
function buildResult(/* ... */): BatchRunResult { /* ... */ }
```

`finalizeRun` derives the authoritative `tasksDone` and `tasksFailed` from the same `cb.done` / `cb.fails` counters that get persisted into `batch_runs.summary_json` — a priority-0 fix that prevents the run report and `batch-status` command from reporting two different "done" counts for the same run. It also surfaces (but does not persist) the deterministic skips recorded by stage 5 (skipped flows hub, skipped auxiliary hub, skipped topics hub, skipped flow candidates) so that the human and JSON outputs reflect K-a / K-b / ownership decisions without writing noise into `batch_tasks`.

## Configuration: defaults, paths, and validation

<!-- lw:anchors packages/core/src/config.ts#CONFIG_DEFAULTS packages/core/src/config.ts#CONFIG_FILENAME packages/core/src/config.ts#CONFIG_PATH packages/core/src/config.ts#MAX_TIMEOUT_MS packages/core/src/config.ts#applyDefaults packages/core/src/config.ts#assertValidTimeoutMs packages/core/src/config.ts#loadConfig packages/core/src/config.ts#saveConfig packages/core/src/config.ts#validateConfigShape packages/core/src/config.ts#validateConfigForBatch packages/core/src/config.ts#MissingProviderConfigError packages/core/src/config.ts#MissingProviderConfigError.constructor packages/core/src/config.ts#resolveProviderFromConfig packages/core/src/config.ts#resolveBaseUrl packages/core/src/config.ts#resolveExtraIgnores -->

```ts
export const MAX_TIMEOUT_MS = 2_147_483_647;
export const CONFIG_DEFAULTS = { /* language, baseUrls, maxRepairAttempts, ... */ };
export const CONFIG_PATH = CONFIG_REL_PATH;
export const CONFIG_FILENAME = nodePath.basename(CONFIG_REL_PATH);

export function applyDefaults(config: LivewikiConfig): LivewikiConfig { /* ... */ }
export function assertValidTimeoutMs(v: unknown): asserts v is number { /* ... */ }
export async function loadConfig(repoRoot: string): Promise<LivewikiConfig> { /* ... */ }
export async function saveConfig(/* ... */): Promise<void> { /* ... */ }
function validateConfigShape(parsed: unknown): LivewikiConfig { /* ... */ }
export function validateConfigForBatch(repoRoot: string, config: LivewikiConfig): void { /* ... */ }
export class MissingProviderConfigError extends Error {
  constructor(repoRoot: string, missingFields: Array<"provider" | "model">) { /* ... */ }
}
export function resolveProviderFromConfig(/* ... */): ResolvedProvider { /* ... */ }
export function resolveBaseUrl(config: LivewikiConfig): string { /* ... */ }
export function resolveExtraIgnores(config: LivewikiConfig): readonly string[] { /* ... */ }
```

`CONFIG_DEFAULTS` is the runtime-only default set applied by `applyDefaults` (never written into the config file): `language = "en"`, the supported walker languages, per-provider base URLs, `maxRepairAttempts = 2`, `maxIncompleteRetries = 2`, `stage4MaxOutputTokens = 8192`, the module split thresholds, `timeoutMs = 300_000`, and the stage-5 caps (`maxFlows`, `flowMaxAnchors`, etc.). `MAX_TIMEOUT_MS` is the Node `setTimeout` safe upper bound (`2_147_483_647`); `assertValidTimeoutMs` enforces the integer-in-range contract for `timeoutMs`. `CONFIG_PATH` and `CONFIG_FILENAME` expose the resolved `.livewiki/config.json` location to other modules.

`loadConfig` reads `.livewiki/config.json` via `safe-io.js`; a missing file returns `{}` (no defaults applied yet), malformed JSON rejects with a `Failed to parse` error, and unknown provider / preset / path-role categories are rejected. `saveConfig` writes the supplied config atomically; the test suite covers a round-trip including `baseUrl` and `pricing`. `validateConfigShape` is the strict-typed gate called from `loadConfig`; `validateConfigForBatch` runs the project-level gate before a batch run starts — if `provider` (or `preset`) and `model` are absent, it throws `MissingProviderConfigError` with a message that points to `.livewiki/config.json`, names `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` as the API key location, and explicitly marks any example model id as "example only" so it is never mistaken for a silent default. `resolveProviderFromConfig` maps the legacy `provider` field and the new `preset` field (Fase 5 step 5: `anthropic`, `openai`, `openrouter`, `deepseek`, `kimi`, `minimax`, `gemini`, `nvidia`, `ollama`, `lmstudio`) into the adapter used by `createLlmClient`. `resolveBaseUrl` returns `config.baseUrl` when set or falls back to `CONFIG_DEFAULTS.baseUrls[provider]`. `resolveExtraIgnores` returns the user `ignores` list (defaults to `[]`), which the indexer merges with `.gitignore`.

## SQLite index: schema, migrations, and opener

<!-- lw:anchors packages/core/src/db.ts#CURRENT_SCHEMA_VERSION packages/core/src/db.ts#SCHEMA_VERSION_KEY packages/core/src/db.ts#SCHEMA_SQL packages/core/src/db.ts#MIGRATION_SQL_V3 packages/core/src/db.ts#migrateV3ToV4 packages/core/src/db.ts#migrationsFor packages/core/src/db.ts#postV3Migrations packages/core/src/db.ts#openIndex -->

```ts
export const CURRENT_SCHEMA_VERSION = 4;
export const SCHEMA_VERSION_KEY = "schema_version";
export const SCHEMA_SQL = `/* idempotent CREATE TABLE / CREATE INDEX statements */`;
export const MIGRATION_SQL_V3 = `/* ALTER TABLE debt + symbols rebuild + partial indices */`;

export function migrateV3ToV4(db: Database.Database): void { /* ... */ }
export function migrationsFor(
  fromVersion: number,
  toVersion: number,
): Array<string | ((db: Database.Database) => void)> { /* ... */ }
export function postV3Migrations(/* ... */): void { /* ... */ }
export function openIndex(dbPath: string): Database.Database { /* ... */ }
```

The database lives at `<repoRoot>/.livewiki/index.db` (the path is validated by `safe-io.js`). Schema v4 adds `batch_runs.finished_at`, `batch_runs.started_by` (default `'cli'`), and `batch_runs.summary_json`, plus indices on `batch_runs.status` and `batch_tasks(run_id, status)` so `batch status <run>` remains O(1) with old runs accumulating. The v3 → v4 migration is implemented in JavaScript (`migrateV3ToV4`) rather than as a string because `SCHEMA_SQL` always runs at the current version (a freshly created DB already has the new columns), so the migration must be idempotent — it inspects `PRAGMA table_info(batch_runs)` before each `ALTER TABLE ADD COLUMN` because SQLite does not support `ADD COLUMN IF NOT EXISTS`. `migrationsFor(fromVersion, toVersion)` returns the ordered list of SQL strings and JS migration functions to apply, and `postV3Migrations` runs the post-v3 hooks that backfill `summary_json` for any in-flight run discovered during open.

`openIndex(dbPath)` is the canonical opener: it creates the DB file if missing, enables `journal_mode = WAL` and `foreign_keys = ON`, runs `SCHEMA_SQL`, then applies `migrationsFor(legacyVersion, CURRENT_SCHEMA_VERSION)` and finally `postV3Migrations`, recording `schema_version = "4"` in `meta`. Test coverage confirms that opening a v2-shaped DB (with the inline `UNIQUE` on `symbols.key`) gets the v3 partial unique index `idx_symbols_active_key`, and that opening a v3 DB (with the original `batch_runs` columns) gets the v4 additions.

## Deterministic Mermaid generators

<!-- lw:anchors packages/core/src/diagrams.ts#moduleSlug packages/core/src/diagrams.ts#generateStructure packages/core/src/diagrams.ts#generateModulesGraph packages/core/src/diagrams.ts#generateClassDiagram packages/core/src/diagrams.ts#classIdentity packages/core/src/diagrams.ts#mermaidId packages/core/src/diagrams.ts#mermaidMemberName packages/core/src/diagrams.ts#escapeLabel -->

The diagram layer is pure and deterministic — no LLM, no randomness:

```ts
export function moduleSlug(value: string): string { /* ... */ }
export function generateStructure(filePaths: string[]): string { /* ... */ }
export function generateModulesGraph(edges: ModuleGraphEdge[]): string { /* ... */ }
export function generateClassDiagram(module: Module, symbols: SymbolRow[]): string { /* ... */ }
function classIdentity(path: string, className: string): string { /* ... */ }
function mermaidId(value: string): string { /* ... */ }
function mermaidMemberName(value: string): string { /* ... */ }
function escapeLabel(value: string): string { /* ... */ }
```

`moduleSlug` lowercases, strips diacritics (`NFD` + `[\u0300-\u036f]` removal), collapses non-alphanumerics into single hyphens, and trims leading/trailing hyphens — producing filesystem-safe slugs like `"autenticação"` → `"autenticacao"`. `generateStructure` emits a `graph TD` flowchart from a list of file paths: it walks each path segment-by-segment, declaring each directory as a node (`mermaidId(name)` for the id, `escapeLabel(name)` for the label) and emitting each parent → child edge exactly once. `generateModulesGraph` emits a `graph LR` diagram from `ModuleGraphEdge[]`, declaring each endpoint node once and emitting each `from → to` edge once (with a `root[No module edges detected]` marker when the input is empty). `generateClassDiagram` produces a `classDiagram` for one module, grouped by the full `(path, className)` identity so that two same-named classes in different files get distinct Mermaid IDs and their methods are not merged.

The three internal helpers make this safe to feed into a real Mermaid parser (the test suite uses `mermaid` + `jsdom` as devDependencies to confirm parseability): `classIdentity` builds the `(path, className)` key via `JSON.stringify` for stable comparisons, `mermaidId` strips non-alphanumeric characters to underscores so directory slugs remain valid Mermaid identifiers, `mermaidMemberName` sanitizes method names while preserving dots and underscores (falling back to `"method"` for an empty result), and `escapeLabel` HTML-escapes `&`, `"`, `[`, and `]` so labels with quotes or brackets do not break the syntax.

## Configuration test coverage

<!-- lw:anchors -->

The visible `config.test.ts` exercises `loadConfig` across the supported shapes (missing file returns `{}`, valid file round-trips `provider`/`model`/`language`, malformed JSON rejects, unknown `provider` and unknown `preset` reject, `preset` coexists with `provider` as a legacy field, unknown keys are silently dropped for forward compatibility, and `pathRoles` categories accept arrays and reject non-arrays). The round-trip test pairs `saveConfig` + `loadConfig` for a config that includes `baseUrl` and `pricing`. `applyDefaults` is asserted to apply `language = "en"` only when absent and to leave `provider`/`model` undefined. `validateConfigForBatch` is asserted to pass when provider + model are present, throw `MissingProviderConfigError` when provider or model is absent, and — as a regression for the preset-only config shape — pass with `preset + model` and no `provider` field, while still failing when `model` is absent even with a preset. `resolveBaseUrl` is asserted to prefer `config.baseUrl` and fall back to `CONFIG_DEFAULTS.baseUrls[provider]` otherwise. The `MissingProviderConfigError` constructor is exercised by every test that triggers the throw, verifying the message mentions the config path, names the relevant env vars, and labels any example model id as "example only".