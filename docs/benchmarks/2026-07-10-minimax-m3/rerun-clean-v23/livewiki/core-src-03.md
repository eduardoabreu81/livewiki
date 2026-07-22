---
title: Batch orchestration, configuration, index, and diagram generation
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

# Batch orchestration, configuration, index, and diagram generation

This page describes the four core modules that drive livewiki's documentation pipeline: the resumable batch orchestrator, the per-repository configuration loader, the SQLite index with schema migrations, and the deterministic Mermaid diagram generators.

## When to use this page

- **Run** the resumable batch pipeline with `runBatch`/`resumeBatch`/`runOnly` and inspect `BatchRunResult`.
- **Load or persist** the `.livewiki/config.json` file with `loadConfig`/`saveConfig` and resolve defaults via `applyDefaults`/`resolveBaseUrl`/`resolveProviderFromConfig`.
- **Open the SQLite index** at `<repo>/.livewiki/index.db` and migrate its schema with `openIndex`/`migrationsFor`.
- **Render Mermaid artifacts** for `structure.mmd`, `modules.mmd`, and per-module class diagrams with the three `generate*` helpers.

## How it fits

`packages/core/src/batch.ts` is the heart of Phase 3/5: it indexes the repository, splits it into modules, and runs an LLM task per module under a circuit breaker, with checkpoint-based resume and transactional writes that preserve `lw:manual` blocks. `packages/core/src/config.ts` validates the local config the batch reads at startup, applying defaults (including the Phase-5 repair/incomplete-retry knobs) and refusing to fall back to a hardcoded model. `packages/core/src/db.ts` owns the SQLite schema and idempotent migrations that let older repositories upgrade in place. `packages/core/src/diagrams.ts` produces the deterministic architecture and class diagrams written next to the documentation, with no LLM in the loop.

## Pipeline entry points

<!-- lw:anchors packages/core/src/batch.ts#runBatch packages/core/src/batch.ts#resumeBatch packages/core/src/batch.ts#runOnly packages/core/src/batch.ts#orchestrate packages/core/src/batch.ts#EmptyPipelineError packages/core/src/batch.ts#EmptyPipelineError.constructor packages/core/src/batch.ts#TaskError packages/core/src/batch.ts#TaskError.constructor packages/core/src/batch.ts#statusToExitCode -->

`runBatch` is the public entry for the full four-stage documentation pipeline. Its signature is:

```ts
export async function runBatch(opts: BatchOptions): Promise<BatchRunResult>
```

It loads the config, runs the indexer and anchor ledger, partitions files into modules, and dispatches one LLM task per module through `orchestrate`. `resumeBatch` re-attaches to an existing `batch_runs` row and continues from the checkpoint; `runOnly` re-runs a single task (by module id or run id) while preserving `lw:manual` byte-for-byte and refusing to overwrite `owner: human` content. The early-return path `orchestrate` takes when the pipeline finds no work is signalled by `EmptyPipelineError`, thrown from its `constructor(message: string)`. Per-task failures are wrapped in `TaskError` (`constructor(code: string, message: string)`) — the orchestrator marks the task failed and continues unless the circuit breaker triggers. `statusToExitCode` translates the final `BatchRunResult.status` (`"completed" | "completed_with_failures" | "aborted"`) into a process exit code; `runBatch` does not guarantee a zero exit on completed runs if any task failed.

## Stage 4 and stage 5 task attempts

<!-- lw:anchors packages/core/src/batch.ts#attemptStage4Generation packages/core/src/batch.ts#attemptStage5Generation packages/core/src/batch.ts#runSemanticTopicStage packages/core/src/batch.ts#attemptTopicGeneration packages/core/src/batch.ts#buildModuleDocContext packages/core/src/batch.ts#buildFlowDocContext packages/core/src/batch.ts#buildTopicDocContext packages/core/src/batch.ts#buildFairTruncatedSource packages/core/src/batch.ts#getModuleSymbolRows packages/core/src/batch.ts#getFileIdsForModule packages/core/src/batch.ts#extractModuleOpeningDigest packages/core/src/batch.ts#collectAllImports -->

Stage 4 (one LLM call per module) and stage 5 (one gated task per detected flow candidate) share the same machinery shape: bounded repair slots, transactional write, and circuit-breaker accounting. `attemptStage4Generation` and `attemptStage5Generation` each wrap a single generate→repair sequence and return a structured attempt outcome. `runSemanticTopicStage` plans and executes the semantic-topic layer after stage 5, calling `attemptTopicGeneration` (`async function attemptTopicGeneration(opts: TopicAttemptOpts): Promise<Stage4AttemptResult>`) per topic candidate. The context builders — `buildModuleDocContext`, `buildFlowDocContext`, `buildTopicDocContext` — assemble the prompt payload; `buildFairTruncatedSource` enforces the per-task source budget; `getModuleSymbolRows` and `getFileIdsForModule` project SQLite rows for the prompt; `extractModuleOpeningDigest` harvests the page opening from a previously written module page; `collectAllImports` walks the dependency graph for module-level context.

## Checkpointing, results, and accounting

<!-- lw:anchors packages/core/src/batch.ts#getOrCreateTask packages/core/src/batch.ts#createOrGetTask packages/core/src/batch.ts#finalizeRun packages/core/src/batch.ts#buildResult packages/core/src/batch.ts#emptyUsage packages/core/src/batch.ts#accumulateUsage packages/core/src/batch.ts#aggregateTotals packages/core/src/batch.ts#computeCostFromUsage packages/core/src/batch.ts#validateRefinedModules packages/core/src/batch.ts#safeJsonParse -->

Tasks are persisted via `getOrCreateTask` / `createOrGetTask` (both functions), which upsert `batch_tasks` rows keyed by `(run_id, stage, target)`. `finalizeRun` writes the audit `summary_json` and authoritative `cb.done` / `cb.fails` counters into `batch_runs`; the `BatchRunResult.tasksDone` / `tasksFailed` fields are taken from those counters rather than from `byModule.length`, which mixes done and failed entries. `buildResult` assembles the `BatchRunResult` object and the per-module usage rows. Usage helpers — `emptyUsage`, `aggregateTotals`, `accumulateUsage` — produce and combine `StageUsage` values; `computeCostFromUsage` multiplies token counts against the pricing lookup. `validateRefinedModules` enforces post-refine invariants (unique ids, exact path partition, etc.). `safeJsonParse` parses LLM transcripts without throwing on malformed JSON.

## Diagnostics and attempt repair

<!-- lw:anchors packages/core/src/batch.ts#diagnosticAttempt packages/core/src/batch.ts#topicAttemptDiagnostic packages/core/src/batch.ts#topicPlanDiagnostic packages/core/src/batch.ts#summarizeLlmDiagnosticError packages/core/src/batch.ts#summarizeVerifyDiagnosticErrors packages/core/src/batch.ts#verifyIssuesToValidationErrors packages/core/src/batch.ts#tryWriteAndVerify packages/core/src/batch.ts#tryWriteFlowAndVerify packages/core/src/batch.ts#rollbackWrittenArtifacts -->

`diagnosticAttempt`, `topicAttemptDiagnostic`, and `topicPlanDiagnostic` describe one bounded attempt (initial call plus its repair sequence) for stages 4, 5, and topic respectively. `summarizeLlmDiagnosticError` and `summarizeVerifyDiagnosticErrors` cap error lists at `DIAGNOSTIC_MAX_ERRORS` and string lengths at `DIAGNOSTIC_TEXT_CAP` so diagnostic payloads stay inside the prompt budget. `verifyIssuesToValidationErrors` converts verifier findings into the `ArtifactValidationError` shape consumed by the repair prompt. `tryWriteAndVerify` and `tryWriteFlowAndVerify` execute the transactional write (snapshot → write → verify → restore/remove on failure); `rollbackWrittenArtifacts` is the rollback path when verification fails or the page fails structural checks — so writes are not atomic in the absence of an exception, only on the explicit rollback.

## Manual-block preservation and frontmatter ownership

<!-- lw:anchors packages/core/src/batch.ts#extractManualBlocksBySection packages/core/src/batch.ts#injectManualBlocksBySection packages/core/src/batch.ts#sectionRangeOf packages/core/src/batch.ts#slugifyHeadingText packages/core/src/batch.ts#readOwnerFromFrontmatter packages/core/src/batch.ts#forceOwnerInFrontmatter -->

`extractManualBlocksBySection` reads an existing page and groups `lw:manual` blocks by the heading slug they sit under; `injectManualBlocksBySection` re-inserts them into a regenerated page, returning `null` if the section layout has drifted so far that no safe merge is possible. `sectionRangeOf` (function) locates the byte range of one heading section, and `slugifyHeadingText` produces the matching slug. `readOwnerFromFrontmatter` returns a `PreOwnerCheck` with the parsed `owner` and an `unparseable` flag; `forceOwnerInFrontmatter` rewrites only the `owner` field (to `"generated"` or `"mixed"`), leaving the rest of the YAML untouched. Pages owned by `"human"` are never regenerated — the orchestrator treats them as immutable and records the skip in `skippedFlowsHub` / `skippedAuxiliaryHub` / `skippedTopicsHub` of the `BatchRunResult`.

## Configuration loading and validation

<!-- lw:anchors packages/core/src/config.ts#CONFIG_PATH packages/core/src/config.ts#CONFIG_FILENAME packages/core/src/config.ts#CONFIG_DEFAULTS packages/core/src/config.ts#loadConfig packages/core/src/config.ts#saveConfig packages/core/src/config.ts#applyDefaults packages/core/src/config.ts#validateConfigShape packages/core/src/config.ts#validateConfigForBatch packages/core/src/config.ts#MissingProviderConfigError packages/core/src/config.ts#MissingProviderConfigError.constructor packages/core/src/config.ts#resolveProviderFromConfig packages/core/src/config.ts#resolveBaseUrl packages/core/src/config.ts#resolveExtraIgnores packages/core/src/config.ts#assertValidTimeoutMs packages/core/src/config.ts#MAX_TIMEOUT_MS -->

The config file lives at `.livewiki/config.json`. `CONFIG_PATH` resolves to the relative path and `CONFIG_FILENAME` to its base name. `loadConfig(repoRoot)` reads the file (returning `{}` when absent) and `saveConfig(repoRoot, config)` writes it back through `safe-io`. `validateConfigShape` enforces the schema — known providers, presets, integer-bounded knobs — and forwards unknown keys silently. `applyDefaults` fills runtime defaults (`language: "en"`, `maxRepairAttempts: 2`, `timeoutMs: 300_000`, `maxFlows: 4`, etc.) but never fabricates a `provider` or `model`. `validateConfigForBatch` enforces that both are present before the LLM runs; otherwise it throws `MissingProviderConfigError` (`constructor(repoRoot: string, missingFields: Array<"provider" | "model">)`). `resolveProviderFromConfig` and `resolveBaseUrl` map the (possibly preset-based) config onto a concrete adapter and endpoint; `resolveExtraIgnores` returns the merged gitignore-style pattern list. `assertValidTimeoutMs` (signature `export function assertValidTimeoutMs(v: unknown): asserts v is number`) accepts only integers in `[0, MAX_TIMEOUT_MS]` where `MAX_TIMEOUT_MS = 2_147_483_647`; out-of-range or non-integer values throw with a message that includes the supplied value.

## SQLite index and migrations

<!-- lw:anchors packages/core/src/db.ts#CURRENT_SCHEMA_VERSION packages/core/src/db.ts#SCHEMA_VERSION_KEY packages/core/src/db.ts#SCHEMA_SQL packages/core/src/db.ts#MIGRATION_SQL_V3 packages/core/src/db.ts#migrateV3ToV4 packages/core/src/db.ts#migrationsFor packages/core/src/db.ts#openIndex packages/core/src/db.ts#postV3Migrations -->

`CURRENT_SCHEMA_VERSION = 4` is the version every freshly created database ends at; `SCHEMA_VERSION_KEY = "schema_version"` is the meta-table key `openIndex` reads and writes. `SCHEMA_SQL` is the idempotent create script for `files`, `symbols`, `meta`, `anchors`, `debt`, `undocumented`, `batch_runs`, `batch_tasks`, `doc_pages`, and `manual_blocks` plus their indices (notably the partial unique index `idx_symbols_active_key` that makes soft-deleted symbol rows safe to reinsert). `openIndex(dbPath)` opens the database, enables WAL journaling, and applies any pending migrations. `migrationsFor(fromVersion, toVersion)` returns the list of SQL statements or `db => void` functions to apply between two versions; `MIGRATION_SQL_V3` is the v2 → v3 step (adds `debt.symbol_key`, recreates `symbols` with a partial unique index, adds `idx_debt_open`), and `migrateV3ToV4` performs the v3 → v4 step (adds `batch_runs.finished_at`, `started_by`, `summary_json` plus the `idx_batch_*` indices), guarding each `ALTER TABLE ADD COLUMN` with `PRAGMA table_info` because SQLite has no `ADD COLUMN IF NOT EXISTS`. `postV3Migrations` runs the bookkeeping required after the v3 set completes.

## Mermaid diagram generation

<!-- lw:anchors packages/core/src/diagrams.ts#moduleSlug packages/core/src/diagrams.ts#generateStructure packages/core/src/diagrams.ts#generateModulesGraph packages/core/src/diagrams.ts#generateClassDiagram packages/core/src/diagrams.ts#classIdentity packages/core/src/diagrams.ts#mermaidId packages/core/src/diagrams.ts#mermaidMemberName packages/core/src/diagrams.ts#escapeLabel -->

`moduleSlug(value)` lowercases, strips diacritics, collapses non-alphanumerics to `-`, and trims leading/trailing dashes — producing the filename-friendly slug used for `diagrams/<slug>.classes.mmd`. `generateStructure(filePaths)` emits a `graph TD` flowchart of the repository's directory tree, deduplicating both nodes and parent → child edges. `generateModulesGraph(edges)` emits a `graph LR` flowchart of inter-module dependencies, deduplicating edges and declaring each node exactly once even when it appears as both source and target; an empty edge list renders a `No module edges detected` marker rather than an empty diagram. `generateClassDiagram(module, symbols)` returns `""` when the module has no classes in its paths; otherwise it emits a `classDiagram` block where each class is keyed by its full `(path, className)` identity via `classIdentity` — so two same-named classes in different files stay distinct and only receive their own file's methods. `mermaidId`, `mermaidMemberName`, and `escapeLabel` sanitize identifiers and labels so the output stays valid Mermaid (no raw quotes, brackets, or HTML-special characters).

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
- Flow: [CLI entry to core-src-04 export — semantic product flow](flows/cli-src-to-core-src-04.md)
- [Stage-5 planning, prompt templates, and safe disk I/O core](core-src-08.md) — dependency and dependent
- [Livewiki core source — export, flows, frontmatter, gitignore, hashes](core-src-04.md) — dependency and dependent
- [core library — manifest, markdown masking, mermaid validation, and module identification](core-src-06.md) — dependency and dependent
<!-- livewiki:navigate:end -->
