---
title: Batch orchestration, config, index schema, and deterministic diagrams
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

# Batch orchestration, config, index schema, and deterministic diagrams

This page documents the runtime core that drives a livewiki documentation pass: the resumable batch orchestrator, the per-repo configuration loader, the SQLite index that backs the inventory, and the deterministic Mermaid diagram generators.

## When to use this page

- **Run or resume** the multi-stage documentation batch pipeline (stage 4 module docs, stage 5 flows and topics) and inspect `BatchRunResult` counts.
- **Configure** a repo's `.livewiki/config.json` (provider, model, language, repair attempts, timeouts, ignore lists, path roles) or validate it before a batch run.
- **Open or migrate** the local SQLite index at `<repoRoot>/.livewiki/index.db` and reason about schema versions and migrations.
- **Generate** the deterministic Mermaid artifacts (`structure`, `modules`, per-module `classes`) without invoking an LLM.

## How it fits

The `core` package sits between the livewiki CLI entry points and the per-repo `.livewiki/` working directory. `batch.ts` is the orchestrator that the CLI drives: it loads config, opens the index, walks modules, prompts the LLM, transactionalizes writes (snapshot → write → verify → restore/remove), and checkpoints progress so `resumeBatch` and `runOnly` can pick up mid-run. `config.ts` owns the per-repo `.livewiki/config.json` schema, defaults, and shape validation, including the `MissingProviderConfigError` thrown when an LLM batch is launched without a provider or model. `db.ts` owns the better-sqlite3 schema and migrations (`CURRENT_SCHEMA_VERSION` is bumped as the inventory grows). `diagrams.ts` produces three deterministic Mermaid files from the index without calling an LLM; their validity is asserted in `diagrams.test.ts` using `mermaid.parse`. The excerpt on this page covers a representative slice of each file; the public surface visible in the symbol table is the authoritative reference for behavior beyond the shown excerpts.

## Batch entry points and orchestration

<!-- lw:anchors packages/core/src/batch.ts#runBatch packages/core/src/batch.ts#resumeBatch packages/core/src/batch.ts#runOnly packages/core/src/batch.ts#orchestrate packages/core/src/batch.ts#runSemanticTopicStage packages/core/src/batch.ts#EmptyPipelineError packages/core/src/batch.ts#EmptyPipelineError.constructor packages/core/src/batch.ts#TaskError packages/core/src/batch.ts#TaskError.constructor packages/core/src/batch.ts#statusToExitCode packages/core/src/batch.ts#finalizeRun packages/core/src/batch.ts#buildResult packages/core/src/batch.ts#emptyUsage packages/core/src/batch.ts#aggregateTotals packages/core/src/batch.ts#accumulateUsage packages/core/src/batch.ts#computeCostFromUsage -->

The batch pipeline has three top-level entry points and one internal driver. The signatures below are copied from the supplied symbol table.

```ts
export async function runBatch(opts: BatchOptions): Promise<BatchRunResult>
export async function resumeBatch(opts: BatchOptions): Promise<BatchRunResult>
export async function runOnly(opts: BatchOptions): Promise<BatchRunResult>
async function orchestrate(opts: OrchestrateOpts): Promise<BatchRunResult>
async function runSemanticTopicStage(opts: { /* … */ }): Promise<BatchRunResult>
export function statusToExitCode(/* … */): number
```

`BatchOptions` carries the repo root, optional injected LLM client, language override, `--no-refine` flag, `--only` target, per-module context char budget, repair and incomplete-retry overrides, and split thresholds (`maxModuleFiles`, `maxModuleSymbols`). The header comment codifies the failure policy: a task that fails is recorded as `failed` with a reason and the run continues; a circuit breaker aborts after 3 consecutive failures or >50% failure rate, after which the run is reported as `completed_with_failures` with a non-zero exit code. `runOnly` is the deterministic re-run path used by `--only <target>` and by the in-session mode planned for Phase 5; it preserves `lw:manual` blocks byte-for-byte and rejects pages whose owner is `human`.

`BatchRunResult` is the human/JSON summary returned to the CLI:

```ts
interface BatchRunResult {
  runId: number;
  status: "completed" | "completed_with_failures" | "aborted";
  totals: StageUsage;
  byModule: Array<StageUsage & { module: string }>;
  failures: Array<{ taskId: number; module: string; error: { code: string; message: string }; retryCommand: string }>;
  circuitBreakerTriggered: boolean;
  tasksDone: number;
  tasksFailed: number;
  skippedFlowsHub?: { path: string; owner: "human" | "mixed" | null };
  skippedAuxiliaryHub?: { path: string; owner: "human" | "mixed" | null };
  skippedTopicsHub?: { path: string; owner: "human" | "mixed" | null };
}
```

The `tasksDone` / `tasksFailed` counts are taken from the same circuit-breaker counters `finalizeRun` persists (across stage 4, stage 5 flows, and stage 5 topics), so the count is consistent across human output, JSON output, and `batch-status` queries. `finalizeRun` and `buildResult` assemble the `BatchRunResult` and persist the aggregated `summary_json` into `batch_runs`. `statusToExitCode` converts the run status to a CLI exit code; the source establishes the mapping but the excerpt does not show the exact integer values.

Two error classes are visible in the orchestrator's namespace:

```ts
export class EmptyPipelineError extends Error {
  constructor(message: string) { /* … */ }
}
class TaskError extends Error {
  constructor(code: string, message: string) { /* … */ }
}
```

`EmptyPipelineError` is raised when the run produced zero documentation work (no modules after heuristic + optional LLM refine, or the `--only` target does not resolve); `TaskError` carries a stable error code alongside the message for `BatchRunResult.failures[].error.code`. Stage usage is accumulated by `emptyUsage`, `aggregateTotals`, `accumulateUsage`, and translated to a USD figure by `computeCostFromUsage`; the excerpt defines the function but not the bodies.

## Stage 4, stage 5, and topic generation

<!-- lw:anchors packages/core/src/batch.ts#attemptStage4Generation packages/core/src/batch.ts#attemptStage5Generation packages/core/src/batch.ts#attemptTopicGeneration packages/core/src/batch.ts#topicAttemptDiagnostic packages/core/src/batch.ts#topicPlanDiagnostic packages/core/src/batch.ts#diagnosticAttempt packages/core/src/batch.ts#safeJsonParse packages/core/src/batch.ts#validateRefinedModules packages/core/src/batch.ts#collectAllImports packages/core/src/batch.ts#getOrCreateTask packages/core/src/batch.ts#createOrGetTask packages/core/src/batch.ts#summarizeLlmDiagnosticError packages/core/src/batch.ts#summarizeVerifyDiagnosticErrors packages/core/src/batch.ts#verifyIssuesToValidationErrors -->

The stage-4 / stage-5 / topic attempt helpers are the per-task workers under `orchestrate`. Their signatures (copied from the symbol table):

```ts
async function attemptStage4Generation(/* … */): Promise<…>
async function attemptStage5Generation(/* … */): Promise<…>
async function attemptTopicGeneration(opts: TopicAttemptOpts): Promise<Stage4AttemptResult>
function topicPlanDiagnostic(/* … */): …        // stage 5 planning pre-flight
function topicAttemptDiagnostic(/* … */): …     // stage 5 topic generation pre-flight
function diagnosticAttempt(input: { /* … */ }): …
function safeJsonParse<T>(s: string): T | null
function validateRefinedModules(/* … */): …
async function collectAllImports(/* … */): …
function getOrCreateTask(/* … */): …
function createOrGetTask(/* … */): …
```

Per the header comment, the Phase-5 plan normalizes the stage-4 input: the LLM is given a structured prompt and emits a normalized artifact, not a raw transcript; structural failures trigger a bounded sequence of repair prompts (`maxRepairAttempts` from `config` or `BatchOptions`, default `2`). The stage-4 worker calls `safeJsonParse` to defensively parse model output, `validateRefinedModules` to assert the refined-module payload is well-formed, and `collectAllImports` to resolve cross-module dependencies before the LLM call. The shown source does not exhaustively describe the bounded-repair loop or the abort conditions on repeated structural failures; refer to the symbol table and the rest of the module for that detail.

Stage 5 has two halves. The flow half (`attemptStage5Generation`) runs after the stage-4 loop and before the navigation hook, gated by `maxFlows`; the model emits the Mermaid diagram INLINE, the orchestrator extracts and validates it (`extractInlineFlowDiagram` from `artifact.ts`), placeholder-substitutes the page, and writes the page + diagram as a single transactional unit. The topic half (`attemptTopicGeneration` + `topicPlanDiagnostic` + `topicAttemptDiagnostic`) is gated by `maxTopics`; zero candidates is a valid outcome, not an empty-pipeline error, and `maxTopics: 0` disables the stage entirely. `summarizeLlmDiagnosticError` and `summarizeVerifyDiagnosticErrors` reduce diagnostic output to the compact error envelopes surfaced in `BatchRunResult.failures`. `verifyIssuesToValidationErrors` adapts `VerifyIssue[]` into the validation-error shape used by the artifact pipeline.

## Manual block preservation and write/verify/rollback

<!-- lw:anchors packages/core/src/batch.ts#readOwnerFromFrontmatter packages/core/src/batch.ts#forceOwnerInFrontmatter packages/core/src/batch.ts#extractManualBlocksBySection packages/core/src/batch.ts#injectManualBlocksBySection packages/core/src/batch.ts#sectionRangeOf packages/core/src/batch.ts#slugifyHeadingText packages/core/src/batch.ts#rollbackWrittenArtifacts packages/core/src/batch.ts#tryWriteAndVerify packages/core/src/batch.ts#tryWriteFlowAndVerify packages/core/src/batch.ts#buildModuleDocContext packages/core/src/batch.ts#buildTopicDocContext packages/core/src/batch.ts#buildFlowDocContext packages/core/src/batch.ts#getModuleSymbolRows packages/core/src/batch.ts#getFileIdsForModule packages/core/src/batch.ts#extractModuleOpeningDigest packages/core/src/batch.ts#buildFairTruncatedSource -->

The deterministic half of the orchestrator handles Markdown ownership and the transactional write/verify path. Signatures visible in the symbol table:

```ts
function readOwnerFromFrontmatter(content: string | null): PreOwnerCheck
function forceOwnerInFrontmatter(content: string, owner: "generated" | "mixed"): string
function extractManualBlocksBySection(content: string): Map<string | null, string[]>
function injectManualBlocksBySection(existing: string, newContent: string): string | null
function sectionRangeOf(headingOffset: number): { endOffset: number }
function slugifyHeadingText(text: string): string
async function rollbackWrittenArtifacts(/* … */): Promise<void>
async function tryWriteAndVerify(/* … */): Promise<…>
async function tryWriteFlowAndVerify(/* … */): Promise<…>
async function getModuleSymbolRows(/* … */): Promise<…>
async function getFileIdsForModule(absRoot: string, module: Module): Promise<number[]>
async function buildModuleDocContext(/* … */): Promise<…>
async function buildTopicDocContext(/* … */): Promise<…>
async function buildFlowDocContext(/* … */): Promise<…>
function extractModuleOpeningDigest(pageContent: string): string
export async function buildFairTruncatedSource(/* … */): Promise<…>
```

`readOwnerFromFrontmatter` returns a pre-ownership check (parseable / owner value); pages whose owner is `human` are never overwritten — `forceOwnerInFrontmatter` only ever rewrites pages with owner `generated` or `mixed`, and `injectManualBlocksBySection` re-inserts `lw:manual` blocks into the newly generated content keyed by their original heading section. `slugifyHeadingText` + `sectionRangeOf` together locate where in the page a manual block belongs. If the verify pass fails, `rollbackWrittenArtifacts` is the only path that can remove partial writes; the excerpt does not establish whether it always succeeds (for example, when the snapshot itself fails to materialize), so callers should treat the rollback as best-effort.

The transactional write helpers (`tryWriteAndVerify` for stage 4, `tryWriteFlowAndVerify` for stage 5 flows) implement the snapshot → write → verify → restore/remove pattern called out in the header. `buildModuleDocContext`, `buildTopicDocContext`, and `buildFlowDocContext` produce the per-task prompt inputs; `getModuleSymbolRows` and `getFileIdsForModule` query the SQLite index. `buildFairTruncatedSource` truncates module source within the per-module char budget; `extractModuleOpeningDigest` extracts a short opening digest for prompt framing.

## Configuration: load, save, validate, resolve

<!-- lw:anchors packages/core/src/config.ts#CONFIG_DEFAULTS packages/core/src/config.ts#CONFIG_FILENAME packages/core/src/config.ts#CONFIG_PATH packages/core/src/config.ts#MAX_TIMEOUT_MS packages/core/src/config.ts#MissingProviderConfigError packages/core/src/config.ts#MissingProviderConfigError.constructor packages/core/src/config.ts#applyDefaults packages/core/src/config.ts#assertValidTimeoutMs packages/core/src/config.ts#loadConfig packages/core/src/config.ts#resolveBaseUrl packages/core/src/config.ts#resolveExtraIgnores packages/core/src/config.ts#resolveProviderFromConfig packages/core/src/config.ts#saveConfig packages/core/src/config.ts#validateConfigForBatch packages/core/src/config.ts#validateConfigShape -->

`config.ts` owns the `.livewiki/config.json` schema. The file is a per-repo plain JSON document; API keys never live here, only in environment variables. Visible exported constants:

```ts
export const MAX_TIMEOUT_MS = 2_147_483_647;
export const CONFIG_DEFAULTS = {
  language: "en",
  languages: ["ts", "tsx", "js", "jsx", "py"],
  baseUrls: { anthropic: "https://api.anthropic.com", "openai-compat": "https://api.openai.com" } as Record<LlmProvider, string>,
  maxRepairAttempts: 2,
  maxIncompleteRetries: 2,
  stage4MaxOutputTokens: 8192,
  maxModuleFiles: 12,
  maxModuleSymbols: 80,
  timeoutMs: 300_000,
  // … plus stage-5 flow and topic defaults
};
export const CONFIG_PATH = CONFIG_REL_PATH;
export const CONFIG_FILENAME = nodePath.basename(CONFIG_REL_PATH);
```

The function-level surface:

```ts
export function assertValidTimeoutMs(v: unknown): asserts v is number
export async function loadConfig(repoRoot: string): Promise<LivewikiConfig>
export function resolveProviderFromConfig(/* … */): …
export async function saveConfig(/* … */): Promise<void>
export function applyDefaults(config: LivewikiConfig): LivewikiConfig
export function resolveExtraIgnores(config: LivewikiConfig): readonly string[]
export function validateConfigForBatch(repoRoot: string, config: LivewikiConfig): void
export function resolveBaseUrl(config: LivewikiConfig): string
function validateConfigShape(parsed: unknown): LivewikiConfig
```

`loadConfig` returns `{}` if the file is missing; `saveConfig` is the symmetric write path. `validateConfigShape` rejects malformed JSON (an error matching `/Failed to parse/`), unknown providers, unknown presets, and unknown `pathRoles` categories — the test suite asserts each of those rejections. `applyDefaults` fills `language: "en"`, `languages`, `baseUrls`, `maxRepairAttempts: 2`, `maxIncompleteRetries: 2`, `stage4MaxOutputTokens: 8192`, `maxModuleFiles: 12`, `maxModuleSymbols: 80`, `timeoutMs: 300_000`, and the stage-5 caps; it deliberately does not default `provider` or `model`, forcing the user to choose. `validateConfigForBatch` throws `MissingProviderConfigError` when either is missing. `resolveBaseUrl` returns `config.baseUrl` if set, otherwise the per-provider default from `CONFIG_DEFAULTS.baseUrls`. `resolveExtraIgnores` returns the union of `config.ignores` with the always-on ignore list. `resolveProviderFromConfig` decides the active adapter from a `preset` first (Fase 5 step 5) and falls back to the legacy `provider` field, with any of `baseUrl` / `pricing` overridable per preset.

```ts
export class MissingProviderConfigError extends Error {
  constructor(repoRoot: string, missingFields: Array<"provider" | "model">) { /* … */ }
}
```

The error message cites an example model and explicitly marks it as an example, and reminds the user of the `ANTHROPIC_API_KEY` env var. The shown source documents that intent; the exact wording is in the test suite (`config.test.ts`). `assertValidTimeoutMs` is the only validator for `timeoutMs`: integer in `[0, MAX_TIMEOUT_MS]`, where `0` disables the abort timer and the upper bound is the Node `setTimeout` safe max.

## SQLite index: schema, migrations, and open

<!-- lw:anchors packages/core/src/db.ts#CURRENT_SCHEMA_VERSION packages/core/src/db.ts#MIGRATION_SQL_V3 packages/core/src/db.ts#SCHEMA_SQL packages/core/src/db.ts#SCHEMA_VERSION_KEY packages/core/src/db.ts#migrateV3ToV4 packages/core/src/db.ts#migrationsFor packages/core/src/db.ts#openIndex packages/core/src/db.ts#postV3Migrations -->

`db.ts` defines the SQLite schema, applies it idempotently, and runs lightweight migrations. Visible exported surface:

```ts
export const CURRENT_SCHEMA_VERSION = 4;
export const SCHEMA_VERSION_KEY = "schema_version";
export const SCHEMA_SQL = `…`;
export const MIGRATION_SQL_V3 = `…`;
export function migrateV3ToV4(db: Database.Database): void
export function migrationsFor(fromVersion: number, toVersion: number): Array<string | ((db: Database.Database) => void)>
export function postV3Migrations(/* … */): …
export function openIndex(dbPath: string): Database.Database
```

`CURRENT_SCHEMA_VERSION = 4`. The schema creates `files`, `symbols`, `meta`, `anchors`, `debt`, `undocumented`, `batch_runs`, `batch_tasks`, `doc_pages`, and `manual_blocks`. `symbols` uses a partial unique index `idx_symbols_active_key ON symbols(key) WHERE status = 'active'` so soft-deleted rows do not collide with re-inserted ones. `debt` has a partial index `idx_debt_open ON debt(anchor_id, event) WHERE resolved_at IS NULL` for cheap open-debt lookups. `batch_runs` carries `started_at`, `finished_at`, `started_by` (`'cli' | 'agent'`), `stage`, `config_json`, `status`, and `summary_json`; `batch_tasks` carries `(run_id, stage, target, status, checkpoint_json, updated_at)` and is indexed by `run_id` and by `(run_id, status)` so `batch-status <run>` is O(1) on large histories. `openIndex` is idempotent: opening the same DB twice does not duplicate tables, WAL mode is on, and `foreign_keys = ON`. The header documents the design rule that the DB is a cache — deleting `.livewiki/` and re-running `reindex` reconstructs it from the repo's markdown.

Migrations are split between SQL and JS. `MIGRATION_SQL_V3` adds `debt.symbol_key`, replaces the inline `UNIQUE` on `symbols.key` with the partial unique index `idx_symbols_active_key`, and creates `idx_debt_open`. `migrateV3ToV4` is a function rather than a SQL string because `batch_runs` needs idempotent column adds: `SCHEMA_SQL` always reflects the current schema, so a DB created from scratch already has the new columns — the migration checks `PRAGMA table_info(batch_runs)` before issuing `ALTER TABLE ADD COLUMN` (SQLite has no `ADD COLUMN IF NOT EXISTS`). `migrationsFor(from, to)` returns the ordered list of migration steps to apply; `postV3Migrations` is the post-step that runs after the v3 chain (the excerpt names it but does not show its body).

## Deterministic Mermaid generators

<!-- lw:anchors packages/core/src/diagrams.ts#classIdentity packages/core/src/diagrams.ts#escapeLabel packages/core/src/diagrams.ts#generateClassDiagram packages/core/src/diagrams.ts#generateModulesGraph packages/core/src/diagrams.ts#generateStructure packages/core/src/diagrams.ts#mermaidId packages/core/src/diagrams.ts#mermaidMemberName packages/core/src/diagrams.ts#moduleSlug -->

`diagrams.ts` produces three deterministic Mermaid files with no LLM in the loop. Visible exported and internal surface:

```ts
export function moduleSlug(value: string): string
export function generateStructure(filePaths: string[]): string
export function generateModulesGraph(edges: ModuleGraphEdge[]): string
export function generateClassDiagram(module: Module, symbols: SymbolRow[]): string
function classIdentity(path: string, className: string): string
function mermaidId(value: string): string
function mermaidMemberName(value: string): string
function escapeLabel(value: string): string
```

`moduleSlug` lowercases, strips diacritics via `NFD`, collapses non-alphanumerics into single hyphens, and trims leading/trailing hyphens — `"Auth Service"` → `"auth-service"`, `"autenticação"` → `"autenticacao"`, `"---foo---"` → `"foo"`.

`generateStructure` walks each path segment-by-segment, emits `  <node>["<label>"]` once per directory node, and emits a `parent --> child` edge only once per `(parent, child)` pair. Labels are passed through `escapeLabel` (escaping `&`, `"`, `[`, `]`) so paths containing quotes do not break the diagram. An empty input still produces the header line `"graph TD"`.

`generateModulesGraph` emits `"graph LR"` plus the deduped node declarations and deduped `from --> to` edges. An empty input produces `"No module edges detected"` as the only node. A node used both as a source and as a target is declared exactly once; duplicate edges collapse to a single line.

`generateClassDiagram` returns `""` when the module has no classes whose owning path is in `module.paths`. Classes are sorted by `key`; each class gets a stable id `class_<n>` and a `class class_n["<name>"] { … }` block. Methods are grouped by `classIdentity(path, className)`, so two same-named classes in different files stay distinct and each gets only its own methods (the test suite asserts an XOR: each block has exactly one of `+fromA()` / `+fromB()`, never both). `mermaidId` strips non-alphanumeric characters into `_` for use as Mermaid node ids; `mermaidMemberName` does the same for member names, falling back to `"method"` when the input sanitizes to empty; `escapeLabel` keeps user text safe inside Mermaid label brackets.

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
- Flow: [cli-src → core-src-04 — export marker contract for stage-5 flows](flows/cli-src-to-core-src-04.md)
- [Core source — prompts, safe I/O, status, symbols, topics](core-src-08.md) — dependency and dependent
- [Export, frontmatter, flows, and hashing primitives](core-src-04.md) — dependency and dependent
- [Core module identification, manifest IO, and Markdown masking](core-src-06.md) — dependency and dependent
<!-- livewiki:navigate:end -->
