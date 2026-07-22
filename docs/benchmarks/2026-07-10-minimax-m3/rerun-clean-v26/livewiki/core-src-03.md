---
title: "Core pipeline: batch orchestration, config, db, and diagrams"
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

# Core pipeline: batch orchestration, config, db, and diagrams

This page documents the batch orchestration layer, configuration loader, SQLite index layer, and deterministic Mermaid diagram generators used by livewiki's core pipeline.

## When to use this page

- **Run or resume a batch** by calling `runBatch`, `resumeBatch`, or `runOnly` from `batch.ts` and inspecting the resulting `BatchRunResult`.
- **Validate or shape repository configuration** by loading `.livewiki/config.json` through `loadConfig`, normalizing with `applyDefaults`, and checking batch readiness with `validateConfigForBatch`.
- **Open or migrate the local index database** with `openIndex` and inspect `CURRENT_SCHEMA_VERSION` / `SCHEMA_VERSION_KEY` when troubleshooting or writing fixtures.
- **Generate architecture or class diagrams** deterministically with `generateStructure`, `generateModulesGraph`, and `generateClassDiagram` from `diagrams.ts`.

## How it fits

This module groups four cohesive subsystems that sit underneath the CLI and `index` flow. `batch.ts` orchestrates the resumable 4-stage documentation pipeline (varredura, identificação, priorização, documentação), enforces a circuit breaker on consecutive failures, and persists checkpoints via `db.ts`. `config.ts` owns `.livewiki/config.json` load/save and the `MissingProviderConfigError` contract that prevents silent fallback to a hardcoded model. `db.ts` defines the SQLite schema (`SCHEMA_SQL`) plus v2→v3 (`MIGRATION_SQL_V3`) and v3→v4 (`migrateV3ToV4`) upgrades, keeping the index derived from the markdown source rather than authoritative. `diagrams.ts` produces deterministic Mermaid artifacts (structure, modules graph, class diagrams) without invoking the LLM. Symbols in `batch.ts` reference config/db/diagrams through imports (`loadConfig`, `openIndex`, `moduleSlug`), and the tests under `*.test.ts` exercise the normal-path contracts of each subsystem.

## batch.ts — entry points and run shape

<!-- lw:anchors packages/core/src/batch.ts#runBatch packages/core/src/batch.ts#resumeBatch packages/core/src/batch.ts#runOnly packages/core/src/batch.ts#orchestrate packages/core/src/batch.ts#runSemanticTopicStage packages/core/src/batch.ts#finalizeRun packages/core/src/batch.ts#buildResult packages/core/src/batch.ts#statusToExitCode packages/core/src/batch.ts#EmptyPipelineError packages/core/src/batch.ts#EmptyPipelineError.constructor packages/core/src/batch.ts#TaskError packages/core/src/batch.ts#TaskError.constructor -->

The public surface is three functions: `runBatch`, `resumeBatch`, and `runOnly`. Their declared signatures are:

```
export async function runBatch(opts: BatchOptions): Promise<BatchRunResult>
export async function resumeBatch(opts: BatchOptions): Promise<BatchRunResult>
export async function runOnly(opts: BatchOptions): Promise<BatchRunResult>
```

`runBatch` runs the full 4-stage pipeline once; `resumeBatch` re-enters from the persisted checkpoint. `runOnly` re-runs a single task by module id or runId while preserving `lw:manual` byte-for-byte and refusing `owner: human`. The shared body is `orchestrate` (`async function orchestrate(opts: OrchestrateOpts): Promise<BatchRunResult>`), which delegates the post-stage-4 topic work to `runSemanticTopicStage` and finishes through `finalizeRun`, which writes the checkpoint summary, populates `tasksDone`/`tasksFailed` from the same circuit-breaker counters, and returns a `BatchRunResult`. The run classification surfaces as `status: "completed" | "completed_with_failures" | "aborted"`, and `statusToExitCode` maps that to a process exit code; a run with any failure is not `completed`. The empty-pipeline condition is signaled by `EmptyPipelineError` (`export class EmptyPipelineError extends Error` with `constructor(message: string)`); per-task structured failures are `TaskError` (`class TaskError extends Error` with `constructor(code: string, message: string)`).

## batch.ts — usage accounting and diagnostic helpers

<!-- lw:anchors packages/core/src/batch.ts#emptyUsage packages/core/src/batch.ts#aggregateTotals packages/core/src/batch.ts#accumulateUsage packages/core/src/batch.ts#computeCostFromUsage packages/core/src/batch.ts#summarizeLlmDiagnosticError packages/core/src/batch.ts#summarizeVerifyDiagnosticErrors packages/core/src/batch.ts#verifyIssuesToValidationErrors packages/core/src/batch.ts#diagnosticAttempt packages/core/src/batch.ts#topicPlanDiagnostic packages/core/src/batch.ts#topicAttemptDiagnostic packages/core/src/batch.ts#getOrCreateTask packages/core/src/batch.ts#createOrGetTask packages/core/src/batch.ts#safeJsonParse packages/core/src/batch.ts#validateRefinedModules packages/core/src/batch.ts#collectAllImports -->

Stage-4 / stage-5 / topic attempts share a `StageUsage` shape summed through `emptyUsage`, `aggregateTotals`, and `accumulateUsage`. `computeCostFromUsage` converts a `StageUsage` snapshot to USD using the configured `lookupPricing`/`calculateCostUsd` helpers. Diagnostics flow through `diagnosticAttempt`, with the topic planning and per-attempt variants `topicPlanDiagnostic` and `topicAttemptDiagnostic`; LLM errors are summarized by `summarizeLlmDiagnosticError` and verify issues by `summarizeVerifyDiagnosticErrors`, the latter depending on `verifyIssuesToValidationErrors`. Task persistence is split between `getOrCreateTask` and the alias-style `createOrGetTask`; both upsert into `batch_tasks`. `safeJsonParse<T>(s: string): T | null` returns `null` on malformed JSON rather than throwing, which downstream code must handle as "skip". `validateRefinedModules` runs the LLM-refined module shapes against the structural invariants enforced in `modules.ts`, and `collectAllImports` resolves workspace imports prior to stage 4.

## batch.ts — frontmatter ownership and manual block preservation

<!-- lw:anchors packages/core/src/batch.ts#readOwnerFromFrontmatter packages/core/src/batch.ts#forceOwnerInFrontmatter packages/core/src/batch.ts#extractManualBlocksBySection packages/core/src/batch.ts#slugifyHeadingText packages/core/src/batch.ts#injectManualBlocksBySection packages/core/src/batch.ts#sectionRangeOf packages/core/src/batch.ts#rollbackWrittenArtifacts packages/core/src/batch.ts#tryWriteAndVerify packages/core/src/batch.ts#tryWriteFlowAndVerify packages/core/src/batch.ts#extractModuleOpeningDigest packages/core/src/batch.ts#buildModuleDocContext packages/core/src/batch.ts#buildFairTruncatedSource packages/core/src/batch.ts#buildTopicDocContext packages/core/src/batch.ts#buildFlowDocContext packages/core/src/batch.ts#getModuleSymbolRows packages/core/src/batch.ts#getFileIdsForModule -->

Owner discipline is enforced before write: `readOwnerFromFrontmatter(content: string | null): PreOwnerCheck` classifies a page as `generated`, `mixed`, `human`, or `unparseable`; `forceOwnerInFrontmatter(content: string, owner: "generated" | "mixed"): string` is the only path that overwrites the owner field, and it requires the prior read to have classified the page as `generated`. `lw:manual` blocks are extracted per heading by `extractManualBlocksBySection(content: string): Map<string | null, string[]>`, where the `null` key represents the pre-first-heading region; on write, `injectManualBlocksBySection(existing: string, newContent: string): string | null` reattaches them to the matching slug, with `slugifyHeadingText` and `sectionRangeOf` computing the matching targets. Returning `null` from `injectManualBlocksBySection` indicates a placement collision and aborts the write. `tryWriteAndVerify` and `tryWriteFlowAndVerify` are the transactional write entry points (snapshot → write → verify → restore/remove on failure); `rollbackWrittenArtifacts` is the dedicated recovery path. Source-side, `buildModuleDocContext` and `buildFairTruncatedSource` shape the per-module prompt evidence; `buildTopicDocContext` and `buildFlowDocContext` produce the analogous evidence for stage-5 topics and flows; `extractModuleOpeningDigest` returns the leading digest region of an existing page. `getModuleSymbolRows` and `getFileIdsForModule` (`async function getFileIdsForModule(absRoot: string, module: Module): Promise<number[]>`) resolve the SQLite rows used to build that context.

## batch.ts — generation attempts (stage 4, stage 5, topics)

<!-- lw:anchors packages/core/src/batch.ts#attemptStage4Generation packages/core/src/batch.ts#attemptStage5Generation packages/core/src/batch.ts#attemptTopicGeneration -->

Stage-specific generation is funneled through three async attempts. `attemptStage4Generation` calls `buildStage4Prompt` and returns a normalized artifact after bounded mechanical and LLM repairs. `attemptStage5Generation` runs the flow prompt/repair pair against the candidate set produced by `detectFlowCandidates`. `attemptTopicGeneration(opts: TopicAttemptOpts): Promise<Stage4AttemptResult>` executes the topic planning + topic write loop. The shared retry/repair slot counters come from `BatchOptions.maxRepairAttempts` (default `CONFIG_DEFAULTS.maxRepairAttempts`, validated in `config.ts`); the bounded repair policy is enforced inside each attempt, and the orchestrator only sees the final artifact or a failure. Behavior on a fully failed repair sequence is per-attempt and is not exhaustively shown in the supplied excerpt.

## config.ts — constants and path helpers

<!-- lw:anchors packages/core/src/config.ts#CONFIG_DEFAULTS packages/core/src/config.ts#CONFIG_FILENAME packages/core/src/config.ts#CONFIG_PATH packages/core/src/config.ts#MAX_TIMEOUT_MS -->

`CONFIG_DEFAULTS` is the in-memory defaults table applied at runtime (language, per-provider base URLs, repair/incomplete-retry counts, stage-4 token cap, structural split thresholds, default `timeoutMs`, and the stage-5 flow/topic caps). It is never written into the user's `.livewiki/config.json`. `CONFIG_FILENAME` (`nodePath.basename(CONFIG_REL_PATH)`) and `CONFIG_PATH` (`CONFIG_REL_PATH`) are the public path constants used by every consumer. `MAX_TIMEOUT_MS` (`export const MAX_TIMEOUT_MS = 2_147_483_647`) is the inclusive upper bound for `timeoutMs`; it matches Node's signed 32-bit `setTimeout` ceiling and is used by `assertValidTimeoutMs`.

## config.ts — validation and load/save

<!-- lw:anchors packages/core/src/config.ts#assertValidTimeoutMs packages/core/src/config.ts#validateConfigShape packages/core/src/config.ts#loadConfig packages/core/src/config.ts#saveConfig packages/core/src/config.ts#applyDefaults packages/core/src/config.ts#resolveBaseUrl packages/core/src/config.ts#resolveProviderFromConfig packages/core/src/config.ts#validateConfigForBatch packages/core/src/config.ts#resolveExtraIgnores packages/core/src/config.ts#MissingProviderConfigError packages/core/src/config.ts#MissingProviderConfigError.constructor -->

`assertValidTimeoutMs(v: unknown): asserts v is number` accepts only integers in `[0, MAX_TIMEOUT_MS]`; any other type (float, NaN, string, negative) raises an explicit error. `loadConfig(repoRoot: string): Promise<LivewikiConfig>` reads `.livewiki/config.json` via `safe-io`, parses with `validateConfigShape(parsed: unknown): LivewikiConfig` (which rejects unknown providers and presets and forwards-compatible ignores unknown keys), and returns `{}` when the file is absent. `saveConfig` is the symmetric write path. `applyDefaults(config: LivewikiConfig): LivewikiConfig` fills runtime defaults but never injects a model or provider — both stay `undefined` unless explicitly set, which is what `validateConfigForBatch(repoRoot, config)` enforces. `validateConfigForBatch` throws `MissingProviderConfigError` (class with `constructor(repoRoot: string, missingFields: Array<"provider" | "model">)`) when neither a provider nor a preset reference satisfies the requirement, and the error message cites `claude-sonnet-5` as an example, not a fallback. `resolveProviderFromConfig` maps the config to an adapter (preset wins over legacy `provider`, per-field overrides win over preset defaults). `resolveBaseUrl(config: LivewikiConfig): string` falls back to `CONFIG_DEFAULTS.baseUrls[provider]` when `config.baseUrl` is unset. `resolveExtraIgnores(config: LivewikiConfig): readonly string[]` exposes the user-supplied `ignores` plus path-role ignores to the walker.

## db.ts — schema and version constants

<!-- lw:anchors packages/core/src/db.ts#CURRENT_SCHEMA_VERSION packages/core/src/db.ts#SCHEMA_VERSION_KEY packages/core/src/db.ts#SCHEMA_SQL packages/core/src/db.ts#MIGRATION_SQL_V3 -->

`CURRENT_SCHEMA_VERSION` (`export const CURRENT_SCHEMA_VERSION = 4`) is the version a fresh index receives after `openIndex`. `SCHEMA_VERSION_KEY` (`"schema_version"`) is the `meta` table key where the active version is recorded. `SCHEMA_SQL` is the idempotent DDL: `files`, `symbols` (with the partial unique index `idx_symbols_active_key` that respects `status='deleted'`), `meta`, `anchors`, `debt` (with the partial open-debt index `idx_debt_open`), `undocumented`, `batch_runs` (with the `finished_at`/`started_by`/`summary_json` audit columns from v4), `batch_tasks`, `doc_pages`, and `manual_blocks`. `MIGRATION_SQL_V3` is the v2→v3 upgrade payload: `ALTER TABLE debt ADD COLUMN symbol_key`, rebuild `symbols` without the inline UNIQUE so the partial unique index can take over, and add `idx_debt_open`.

## db.ts — migrations and open

<!-- lw:anchors packages/core/src/db.ts#migrateV3ToV4 packages/core/src/db.ts#migrationsFor packages/core/src/db.ts#postV3Migrations packages/core/src/db.ts#openIndex -->

`migrateV3ToV4(db: Database.Database): void` is the JS function form of the v3→v4 upgrade rather than a raw string. It inspects `PRAGMA table_info(batch_runs)` first (SQLite has no `ADD COLUMN IF NOT EXISTS`), then conditionally `ALTER TABLE`s `finished_at`, `started_by` (`NOT NULL DEFAULT 'cli'`), and `summary_json`, and finally issues the `CREATE INDEX IF NOT EXISTS` for `idx_batch_runs_status`, `idx_batch_tasks_run_id`, and `idx_batch_tasks_status`. `migrationsFor(fromVersion: number, toVersion: number)` returns the ordered upgrade payloads (strings or `(db) => void`) covering that range. `postV3Migrations(db)` is the hook consumed after `migrationsFor` resolves. `openIndex(dbPath: string): Database.Database` enables WAL and `foreign_keys`, runs `SCHEMA_SQL`, detects the stored version, applies the migration chain to `CURRENT_SCHEMA_VERSION`, and returns the open handle — opening twice is idempotent and does not duplicate tables.

## diagrams.ts — slug, label, and ID helpers

<!-- lw:anchors packages/core/src/diagrams.ts#moduleSlug packages/core/src/diagrams.ts#mermaidId packages/core/src/diagrams.ts#mermaidMemberName packages/core/src/diagrams.ts#escapeLabel packages/core/src/diagrams.ts#classIdentity -->

`moduleSlug(value: string): string` lowercases, NFKD-normalizes, strips combining marks, collapses non-alphanumerics into a single `-`, and trims leading/trailing hyphens — used for both filename and heading-slug generation. `mermaidId(value: string): string` rewrites anything outside `[a-zA-Z0-9]` as `_` for the node identifier. `mermaidMemberName(value: string): string` keeps `.` and `_` (for nested members), rewrites everything else to `_`, and falls back to `"method"` when the sanitized form is empty. `escapeLabel(value: string): string` HTML-escapes `&`, `"`, `[`, and `]` to keep labels safe inside Mermaid `["..."]` brackets. `classIdentity(path: string, className: string): string` returns the JSON-stringified `(path, className)` tuple that `generateClassDiagram` uses to disambiguate same-named classes across files.

## diagrams.ts — diagram generators

<!-- lw:anchors packages/core/src/diagrams.ts#generateStructure packages/core/src/diagrams.ts#generateModulesGraph packages/core/src/diagrams.ts#generateClassDiagram -->

`generateStructure(filePaths: string[]): string` emits a `graph TD` directory tree, deduplicating both nodes and parent→child edges via two `Set`s. An empty input yields the bare `graph TD` header. `generateModulesGraph(edges: ModuleGraphEdge[]): string` emits a `graph LR` import graph between module ids, declaring each node exactly once and emitting each edge exactly once, with a `root[No module edges detected]` placeholder when the edge list is empty. `generateClassDiagram(module: Module, symbols: SymbolRow[]): string` filters `symbols` to `class` rows whose path is part of the module, then groups `method` rows by `classIdentity(path, className)`, emits one `class class_<n>` block per class with the methods attached, and returns `""` when no classes are present. The class diagram test suite asserts that classes sharing a name across different files do not have their methods merged, and that diagrams round-trip through the real Mermaid parser.

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
- Flow: [CLI scaffold through export hashing](flows/cli-src-to-core-src-04.md)
- [core-src-08 — prompts, safe I/O, status, symbol extraction, and topic planning](core-src-08.md) — dependency and dependent
- [Core export, frontmatter, gitignore, flow detection, and hashing](core-src-04.md) — dependency and dependent
- [Manifest persistence, Markdown masking, module partitioning, and mermaid validation](core-src-06.md) — dependency and dependent
<!-- livewiki:navigate:end -->
