---
title: Batch orchestration, config, index DB, and diagram generators
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
  - packages/core/src/batch.ts#buildTopicDocContext
  - packages/core/src/batch.ts#collectAllImports
  - packages/core/src/batch.ts#computeCostFromUsage
  - packages/core/src/batch.ts#createOrGetTask
  - packages/core/src/batch.ts#diagnosticAttempt
  - packages/core/src/batch.ts#emptyUsage
  - packages/core/src/batch.ts#extractManualBlocksBySection
  - packages/core/src/batch.ts#extractModuleOpeningDigest
  - packages/core/src/batch.ts#finalizeRun
  - packages/core/src/batch.ts#forceOwnerInFrontmatter
  - packages/core/src/batch.ts#getFileIdsForModule
  - packages/core/src/batch.ts#getModuleSymbolRows
  - packages/core/src/batch.ts#getOrCreateTask
  - packages/core/src/batch.ts#injectManualBlocksBySection
  - packages/core/src/batch.ts#orchestrate
  - packages/core/src/batch.ts#readOwnerFromFrontmatter
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

# Batch orchestration, config, index DB, and diagram generators

This module coordinates the resumable batch pipeline that produces documentation pages, owns the local `.livewiki/config.json` schema, maintains the SQLite index used across phases, and deterministically emits the Mermaid diagrams that accompany generated pages.

## When to use this page

- **Run, resume, or re-run a single module's documentation task** by invoking the `runBatch`, `resumeBatch`, or `runOnly` entry points from `packages/core/src/batch.ts`.
- **Read or mutate the per-repo configuration** (provider, preset, model, timeout, defaults) using the loaders, validators, and defaults exported from `packages/core/src/config.ts`.
- **Inspect or migrate the local SQLite index** (schema, version key, idempotent migrations) via the helpers in `packages/core/src/db.ts`.
- **Generate the deterministic structure, modules, and class diagrams** that accompany architecture pages using `packages/core/src/diagrams.ts`.

## How it fits

The batch orchestrator is the consumer of the config loader, the index database, and the diagram generators. `loadConfig` plus `validateConfigForBatch` gate a run before any task is scheduled; `openIndex` is called during stage-1 scanning to materialize file/symbol rows the orchestrator reads back through `getModuleSymbolRows` and `getFileIdsForModule`. The orchestrator writes generated pages transactionally (snapshot → write → verify → restore on failure) and, on success, refreshes the auxiliary diagram files via the diagram helpers in this same module. The DB layer is treated as a derived cache; the SQLite migrations here keep `meta.schema_version` aligned with `CURRENT_SCHEMA_VERSION` so the index can be deleted and rebuilt without losing correctness. The diagram generators are pure functions of the index rows and the module partition — they produce no LLM output and are reused both at init time and after batch completion.

## Batch entry points and task lifecycle
<!-- lw:anchors packages/core/src/batch.ts#runBatch packages/core/src/batch.ts#resumeBatch packages/core/src/batch.ts#runOnly packages/core/src/batch.ts#orchestrate packages/core/src/batch.ts#runSemanticTopicStage packages/core/src/batch.ts#getOrCreateTask packages/core/src/batch.ts#createOrGetTask packages/core/src/batch.ts#emptyUsage packages/core/src/batch.ts#accumulateUsage packages/core/src/batch.ts#aggregateTotals packages/core/src/batch.ts#statusToExitCode packages/core/src/batch.ts#finalizeRun packages/core/src/batch.ts#buildResult -->

The three public entry points share an internal orchestrator. The signatures below are the authoritative shapes from the symbol table.

```ts
export async function runBatch(opts: BatchOptions): Promise<BatchRunResult>
export async function resumeBatch(opts: BatchOptions): Promise<BatchRunResult>
export async function runOnly(opts: BatchOptions): Promise<BatchRunResult>
async function orchestrate(opts: OrchestrateOpts): Promise<BatchRunResult>
```

`runBatch` performs a fresh scan + module identification + prioritization before scheduling one task per module. `resumeBatch` reads the existing checkpoint table to continue an interrupted run without re-running completed tasks; if the checkpoint is missing or fully failed it falls back to a fresh run. `runOnly` re-runs exactly one target (module id or run id), preserves any `lw:manual` block byte-for-byte, and rejects `owner: human` content before regenerating — it adds each attempt to `usageHistory` and increments the checkpoint's attempt counter rather than resetting it.

`orchestrate` is the shared inner driver used by all three entry points. It owns the circuit breaker (three consecutive failures OR more than 50% failure rate aborts the run) and decides between `completed`, `completed_with_failures`, and `aborted` status. Each scheduled task goes through `getOrCreateTask` (resume path) or `createOrGetTask` (fresh path) to obtain a `batch_tasks` row; `emptyUsage` is the zero-`StageUsage` value used to seed counters, while `accumulateUsage` and `aggregateTotals` fold per-attempt usage into the run totals. `finalizeRun` persists the summary JSON, sets `finished_at`, and stamps `tasksDone`/`tasksFailed` from the circuit-breaker counters so callers do not approximate "done" from `byModule.length`. `statusToExitCode` translates the final status to the CLI exit code (a `completed_with_failures` or `aborted` run exits non-zero). `buildResult` assembles the `BatchRunResult`, including the `skippedFlowsHub` / `skippedAuxiliaryHub` / `skippedTopicsHub` ownership-preservation notes and the deterministic-skip `skippedFlowCandidates` list. `runSemanticTopicStage` is the stage-5 topic pass that runs after stage 4 and before the navigation hook; it shares the same machinery shape as stage 4.

## Stage-4 and stage-5 attempt machinery
<!-- lw:anchors packages/core/src/batch.ts#attemptStage4Generation packages/core/src/batch.ts#attemptStage5Generation packages/core/src/batch.ts#attemptTopicGeneration packages/core/src/batch.ts#buildModuleDocContext packages/core/src/batch.ts#buildTopicDocContext packages/core/src/batch.ts#buildFlowDocContext packages/core/src/batch.ts#buildFairTruncatedSource packages/core/src/batch.ts#computeCostFromUsage packages/core/src/batch.ts#getModuleSymbolRows packages/core/src/batch.ts#getFileIdsForModule packages/core/src/batch.ts#collectAllImports packages/core/src/batch.ts#validateRefinedModules packages/core/src/batch.ts#safeJsonParse packages/core/src/batch.ts#topicAttemptDiagnostic packages/core/src/batch.ts#topicPlanDiagnostic packages/core/src/batch.ts#summarizeLlmDiagnosticError packages/core/src/batch.ts#summarizeVerifyDiagnosticErrors packages/core/src/batch.ts#diagnosticAttempt packages/core/src/batch.ts#verifyIssuesToValidationErrors packages/core/src/batch.ts#extractModuleOpeningDigest packages/core/src/batch.ts#readOwnerFromFrontmatter packages/core/src/batch.ts#forceOwnerInFrontmatter packages/core/src/batch.ts#extractManualBlocksBySection packages/core/src/batch.ts#injectManualBlocksBySection packages/core/src/batch.ts#sectionRangeOf packages/core/src/batch.ts#slugifyHeadingText packages/core/src/batch.ts#EmptyPipelineError packages/core/src/batch.ts#EmptyPipelineError.constructor packages/core/src/batch.ts#TaskError packages/core/src/batch.ts#TaskError.constructor packages/core/src/batch.ts#rollbackWrittenArtifacts packages/core/src/batch.ts#tryWriteAndVerify packages/core/src/batch.ts#tryWriteFlowAndVerify -->

Each per-module task runs through the same bounded repair loop: one initial generation, up to `config.maxRepairAttempts` repair calls, plus up to `config.maxIncompleteRetries` non-consuming retries for normalized incomplete responses. Stage 4 emits a normalized artifact (not the raw transcript); stage 5 emits one page per detected flow candidate with an inline diagram the orchestrator extracts and validates. Topic generation is gated by `config.maxTopics` (zero disables it).

```ts
async function attemptStage4Generation(/* ... */): Promise<Stage4AttemptResult>
async function attemptStage5Generation(/* ... */): Promise<Stage5AttemptResult>
async function attemptTopicGeneration(opts: TopicAttemptOpts): Promise<Stage4AttemptResult>
```

The builders construct the per-task LLM context: `buildModuleDocContext` assembles the stage-4 prompt payload from index rows (`getModuleSymbolRows` + `getFileIdsForModule` produce the symbol/file slice; `buildFairTruncatedSource` enforces a per-module character budget), `buildFlowDocContext` does the equivalent for a flow candidate, and `buildTopicDocContext` does it for one topic. `collectAllImports` walks the workspace's tsconfig + package set to resolve import edges used for module identification and edge graphs; `validateRefinedModules` enforces the invariants the stage-2 LLM-refined partition must satisfy. `safeJsonParse` is the tolerant JSON parser used when reading model outputs (returns `null` rather than throwing on malformed input). `computeCostFromUsage` converts a `StageUsage` to a USD cost using the pricing override or built-in table.

Diagnostics flow through `topicAttemptDiagnostic`, `topicPlanDiagnostic`, `summarizeLlmDiagnosticError`, `summarizeVerifyDiagnosticErrors`, and `diagnosticAttempt`. They normalize provider errors, verify findings, and plan-validation issues into bounded, text-capped summaries safe to embed in repair prompts and checkpoint JSON. `verifyIssuesToValidationErrors` converts the runtime verifier's output into the structured validation-error shape that downstream repair prompts consume.

Manual-block preservation is enforced by `readOwnerFromFrontmatter` (returns a `PreOwnerCheck` that classifies the frontmatter owner as `generated`, `human`, `mixed`, or unparseable), `forceOwnerInFrontmatter` (rewrites the owner field for pages the orchestrator owns), `extractManualBlocksBySection` (returns a `Map<sectionSlug | null, string[]>` of preserved blocks keyed by their containing section), `injectManualBlocksBySection` (re-injects the preserved blocks into the freshly generated page; returns `null` if the new content has no compatible section structure), `sectionRangeOf` (computes the byte range of a section given its heading offset), and `slugifyHeadingText` (the heading-to-slug helper that keys manual-block preservation). `extractModuleOpeningDigest` produces the short digest of an existing page used to detect semantic drift between runs.

`EmptyPipelineError` is raised when the orchestrator finds zero eligible modules after identification and prioritization (zero modules is a valid outcome for the diagram/topics stages but not for the document-modules stage); `TaskError` is the structured error type persisted on `batch_tasks.checkpoint_json` for failed tasks. The transactional write path is `tryWriteAndVerify` (stage-4 page write) and `tryWriteFlowAndVerify` (stage-5 flow page + companion diagram written as one unit); on failure `rollbackWrittenArtifacts` restores the prior state so the repo is never left half-written.

## Configuration: load, validate, and persist
<!-- lw:anchors packages/core/src/config.ts#CONFIG_DEFAULTS packages/core/src/config.ts#CONFIG_FILENAME packages/core/src/config.ts#CONFIG_PATH packages/core/src/config.ts#MAX_TIMEOUT_MS packages/core/src/config.ts#MissingProviderConfigError packages/core/src/config.ts#MissingProviderConfigError.constructor packages/core/src/config.ts#loadConfig packages/core/src/config.ts#saveConfig packages/core/src/config.ts#applyDefaults packages/core/src/config.ts#assertValidTimeoutMs packages/core/src/config.ts#resolveBaseUrl packages/core/src/config.ts#resolveProviderFromConfig packages/core/src/config.ts#resolveExtraIgnores packages/core/src/config.ts#validateConfigForBatch packages/core/src/config.ts#validateConfigShape -->

The config module reads and writes `.livewiki/config.json` (path constants `CONFIG_PATH` and `CONFIG_FILENAME`) and never stores API keys — credentials live in environment variables. The authoritative surface:

```ts
export async function loadConfig(repoRoot: string): Promise<LivewikiConfig>
export async function saveConfig(repoRoot: string, config: LivewikiConfig): Promise<void>
export function applyDefaults(config: LivewikiConfig): LivewikiConfig
export function validateConfigForBatch(repoRoot: string, config: LivewikiConfig): void
export function resolveBaseUrl(config: LivewikiConfig): string
export function resolveProviderFromConfig(/* ... */): ProviderResolution
export function resolveExtraIgnores(config: LivewikiConfig): readonly string[]
export function assertValidTimeoutMs(v: unknown): asserts v is number
```

`loadConfig` reads the file and returns `{}` when absent; malformed JSON throws and never returns a partial config. Unknown keys are silently ignored for forward compatibility; known malformed pattern categories (e.g. `pathRoles.fixturePatterns` not being an array) throw. `saveConfig` writes the config through safe-io so writes never escape `.livewiki/`. `applyDefaults` is the source of all runtime defaults — only `language` has an explicit default (`"en"`); `provider` and `model` are deliberately `undefined` so the user is forced to choose (no silent model fallback). The defaults are also exported as `CONFIG_DEFAULTS`, including `baseUrls`, `maxRepairAttempts` (default `2`), `maxIncompleteRetries` (default `2`), `stage4MaxOutputTokens` (default `8192`), `maxModuleFiles` / `maxModuleSymbols`, `timeoutMs` (default `300_000`), `maxFlows`, `flowMaxAnchors`, `flowMaxDiagramNodes` / `flowMaxDiagramEdges`, `maxTopics`, `topicMaxAnchors`, `topicMaxSourceChars`, and `topicMaxOutputTokens`.

`validateConfigForBatch` runs immediately before any LLM call and throws `MissingProviderConfigError` if `provider`/`model` are absent, citing both the example model name and the `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` env vars; a `preset` reference satisfies the provider requirement but does not satisfy the model requirement. `MissingProviderConfigError.constructor` records the offending repo root plus the missing field list. `resolveBaseUrl` returns `config.baseUrl` when set, otherwise the per-provider default from `CONFIG_DEFAULTS.baseUrls`. `resolveProviderFromConfig` resolves a preset or legacy `provider` field into the full adapter configuration (adapter, base URL, env var name, pricing). `resolveExtraIgnores` returns the final ignore patterns (config-supplied `ignores` plus the path-role patterns). `validateConfigShape` is the strict shape validator used during `loadConfig` (rejects floats, NaN, strings, and negatives in integer-typed fields). `MAX_TIMEOUT_MS` (`2_147_483_647`, the signed-32-bit `setTimeout` safe maximum) is the upper bound enforced by `assertValidTimeoutMs`.

## SQLite index: schema, version, and migrations
<!-- lw:anchors packages/core/src/db.ts#CURRENT_SCHEMA_VERSION packages/core/src/db.ts#SCHEMA_VERSION_KEY packages/core/src/db.ts#SCHEMA_SQL packages/core/src/db.ts#MIGRATION_SQL_V3 packages/core/src/db.ts#migrateV3ToV4 packages/core/src/db.ts#migrationsFor packages/core/src/db.ts#openIndex packages/core/src/db.ts#postV3Migrations -->

The DB layer is a derived cache; the authoritative source is the repository's markdown. The exported constants and the opener:

```ts
export const CURRENT_SCHEMA_VERSION = 4
export const SCHEMA_VERSION_KEY = "schema_version"
export const SCHEMA_SQL = /* ... */
export const MIGRATION_SQL_V3 = /* ... */
export function openIndex(dbPath: string): Database.Database
export function migrateV3ToV4(db: Database.Database): void
export function migrationsFor(fromVersion: number, toVersion: number): Array<string | ((db: Database.Database) => void)>
export function postV3Migrations(/* ... */): void
```

`openIndex` creates the database if missing, applies `SCHEMA_SQL` (idempotent — every statement uses `CREATE ... IF NOT EXISTS`), stamps `meta.schema_version` to `CURRENT_SCHEMA_VERSION` (`4`), and runs any pending migrations returned by `migrationsFor(currentVersion, CURRENT_SCHEMA_VERSION)`. The resulting connection is in `journal_mode = WAL` with `foreign_keys = ON`. Tables created: `files`, `symbols` (with partial unique index `idx_symbols_active_key` so soft-deleted rows do not block re-insert), `meta`, `anchors`, `debt` (with `symbol_key` surviving anchor removal and partial index `idx_debt_open` for open-debt dedup), `undocumented`, `batch_runs` (with `finished_at`, `started_by`, `summary_json` from v4), `batch_tasks`, `doc_pages`, and `manual_blocks`.

`MIGRATION_SQL_V3` is the v2→v3 migration: it adds `debt.symbol_key`, recreates `symbols` without the inline UNIQUE (SQLite cannot drop an inline UNIQUE index directly) and adds the partial unique index plus the supporting file/status indexes. `migrateV3ToV4` is the v3→v4 migration: it checks `PRAGMA table_info(batch_runs)` and adds `finished_at`/`started_by`/`summary_json` only when missing (SQLite has no `ADD COLUMN IF NOT EXISTS`), then creates the `idx_batch_runs_status`, `idx_batch_tasks_run_id`, and `idx_batch_tasks_status` indexes. `migrationsFor` is the version-to-version dispatch returning the migration plan; `postV3Migrations` is the post-migration hook used after v3 is reached. The visible source does not establish exhaustive behavior for every migration path beyond v4.

## Deterministic Mermaid diagram generation
<!-- lw:anchors packages/core/src/diagrams.ts#moduleSlug packages/core/src/diagrams.ts#generateStructure packages/core/src/diagrams.ts#generateModulesGraph packages/core/src/diagrams.ts#generateClassDiagram packages/core/src/diagrams.ts#classIdentity packages/core/src/diagrams.ts#mermaidId packages/core/src/diagrams.ts#mermaidMemberName packages/core/src/diagrams.ts#escapeLabel -->

The diagrams module produces the three deterministic Mermaid files emitted to the repo (`livewiki/architecture/structure.mmd`, `livewiki/architecture/modules.mmd`, `livewiki/diagrams/<module-slug>.classes.mmd`) with no LLM involvement.

```ts
export function moduleSlug(value: string): string
export function generateStructure(filePaths: string[]): string
export function generateModulesGraph(edges: ModuleGraphEdge[]): string
export function generateClassDiagram(module: Module, symbols: SymbolRow[]): string
```

`moduleSlug` lowercases, NFD-normalizes and strips combining marks (`\u0300`–`\u036f`), collapses non-alphanumeric runs to single hyphens, and trims leading/trailing hyphens. `generateStructure` emits a top-down (`graph TD`) parent→child graph of repository directories, de-duplicating both node declarations (by full path) and edges (by `[parent, child]` key). `generateModulesGraph` emits a left-to-right (`graph LR`) module-import graph, declaring each module once regardless of in/out degree and emitting a `"No module edges detected"` marker node for empty input; duplicate edges are de-duplicated by `[from, to]` key.

`generateClassDiagram` returns the empty string when the module contains no class-kind symbols in its own paths; otherwise it emits a `classDiagram` whose each block is keyed by `classIdentity(path, className)` (a `JSON.stringify([path, className])` string) so same-named classes in different files receive distinct method sets. Methods are collected per `(path, className)` identity, sorted by symbol key, and rendered as `+name()` lines. The internal helpers are `mermaidId` (replace non-alphanumeric with `_` for safe Mermaid node ids), `mermaidMemberName` (sanitize to `[a-zA-Z0-9_.]`, falling back to `"method"` for empty strings), and `escapeLabel` (HTML-escape `&`, `"`, `[`, `]` so labels do not break the Mermaid parser).

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
- Flow: [CLI bootstrap to wiki export (cli-src to core-src-04)](flows/cli-src-to-core-src-04.md)
- [Core prompt, I/O allowlist, symbol extraction, status and topic planning](core-src-08.md) — dependency and dependent
- [Wiki export, flow detection, and parser helpers](core-src-04.md) — dependency and dependent
- [Core source — manifest persistence, Markdown masking, Mermaid validation, and module identification](core-src-06.md) — dependency and dependent
<!-- livewiki:navigate:end -->
