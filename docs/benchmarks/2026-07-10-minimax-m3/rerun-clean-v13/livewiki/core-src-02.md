---
title: core-src-02
owner: generated
anchors:
  - packages/core/src/batch.ts#EmptyPipelineError
  - packages/core/src/batch.ts#EmptyPipelineError.constructor
  - packages/core/src/batch.ts#TaskError
  - packages/core/src/batch.ts#TaskError.constructor
  - packages/core/src/batch.ts#accumulateUsage
  - packages/core/src/batch.ts#aggregateTotals
  - packages/core/src/batch.ts#attemptStage4Generation
  - packages/core/src/batch.ts#buildFairTruncatedSource
  - packages/core/src/batch.ts#buildModuleDocContext
  - packages/core/src/batch.ts#buildResult
  - packages/core/src/batch.ts#collectAllImports
  - packages/core/src/batch.ts#computeCostFromUsage
  - packages/core/src/batch.ts#createOrGetTask
  - packages/core/src/batch.ts#diagnosticAttempt
  - packages/core/src/batch.ts#emptyUsage
  - packages/core/src/batch.ts#extractManualBlocksBySection
  - packages/core/src/batch.ts#finalizeRun
  - packages/core/src/batch.ts#forceOwnerInFrontmatter
  - packages/core/src/batch.ts#getFileIdsForModule
  - packages/core/src/batch.ts#getOrCreateTask
  - packages/core/src/batch.ts#injectManualBlocksBySection
  - packages/core/src/batch.ts#orchestrate
  - packages/core/src/batch.ts#readOwnerFromFrontmatter
  - packages/core/src/batch.ts#resumeBatch
  - packages/core/src/batch.ts#runBatch
  - packages/core/src/batch.ts#runOnly
  - packages/core/src/batch.ts#safeJsonParse
  - packages/core/src/batch.ts#sectionRangeOf
  - packages/core/src/batch.ts#slugifyHeadingText
  - packages/core/src/batch.ts#statusToExitCode
  - packages/core/src/batch.ts#summarizeLlmDiagnosticError
  - packages/core/src/batch.ts#summarizeVerifyDiagnosticErrors
  - packages/core/src/batch.ts#tryWriteAndVerify
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
  - packages/core/src/frontmatter.ts#FrontmatterParseError
  - packages/core/src/frontmatter.ts#FrontmatterParseError.constructor
  - packages/core/src/frontmatter.ts#getAnchors
  - packages/core/src/frontmatter.ts#getOwner
  - packages/core/src/frontmatter.ts#parseFrontmatter
  - packages/core/src/frontmatter.ts#parseYamlBlock
  - packages/core/src/frontmatter.ts#stripComment
  - packages/core/src/gitignore.ts#ensureGitignoreEntries
  - packages/core/src/gitignore.ts#extractManagedBlock
  - packages/core/src/gitignore.ts#mergeBlockLines
  - packages/core/src/gitignore.ts#readGitignore
  - packages/core/src/gitignore.ts#renderBlock
  - packages/core/src/gitignore.ts#replaceManagedBlock
  - packages/core/src/hashes.ts#sha256
  - packages/core/src/hashes.ts#sha256Slice
---

## Batch pipeline entry points and orchestration

<!-- lw:anchors packages/core/src/batch.ts#runBatch packages/core/src/batch.ts#resumeBatch packages/core/src/batch.ts#runOnly packages/core/src/batch.ts#orchestrate packages/core/src/batch.ts#EmptyPipelineError packages/core/src/batch.ts#EmptyPipelineError.constructor packages/core/src/batch.ts#TaskError packages/core/src/batch.ts#TaskError.constructor -->

The `batch` module orchestrates the full documentation pipeline. `runBatch` starts a fresh run by delegating to `orchestrate` with `mode: "run"`. `resumeBatch` continues an interrupted run by picking up the latest `running` row and resuming pending or failed tasks, also via `orchestrate` with `mode: "resume"`. `runOnly` re-executes a single task (used by `--only` and by the in-session mode of Phase 5); it requires `onlyTarget` to be set, then forwards to `orchestrate` with `mode: "only"`. It enforces guardrail #6: `lw:manual` blocks are preserved byte-for-byte and the run refuses an `owner: human` page.

`orchestrate` accepts the three modes plus the shared `BatchOptions` and resolves the repo root, opens the SQLite index, loads and defaults the config, picks the language, and computes the effective values of `maxRepairAttempts`, `stage4MaxOutputTokens`, `contextCharBudget`, `thinking`, and the split thresholds from `normalizeSplitLimits`. It validates `maxRepairAttempts` is a non-negative integer, then lazily creates the LLM client when one is needed (`run`/`resume`/`only` or any non-`noRefine` path) and fails loudly via `validateConfigForBatch` if config is missing.

Two error classes are exported here for the pipeline's failure model. `EmptyPipelineError` extends `Error` and signals that a configured pipeline produced no tasks to run. `TaskError` extends `Error`, carries a `code: string` and `message: string`, and represents a single-task failure surfaced in checkpoints.

## Batch usage aggregation and cost

<!-- lw:anchors packages/core/src/batch.ts#emptyUsage packages/core/src/batch.ts#aggregateTotals packages/core/src/batch.ts#accumulateUsage packages/core/src/batch.ts#computeCostFromUsage packages/core/src/batch.ts#statusToExitCode packages/core/src/batch.ts#buildResult packages/core/src/batch.ts#finalizeRun -->

`emptyUsage()` returns a zeroed `StageUsage` value. `aggregateTotals(a, b)` combines two `StageUsage` instances element-wise. `accumulateUsage(...)` is the variant that adds new usage into an accumulator with the per-attempt + per-module shape needed for checkpoint history. `computeCostFromUsage(...)` converts accumulated usage into USD using the pricing tables from `./pricing.js`. `statusToExitCode(...)` maps a run status (`completed` / `completed_with_failures` / `aborted`) into a process exit code so the CLI can report non-zero on any failure-laden run. `buildResult(...)` constructs a `BatchRunResult` from the in-memory state, and `finalizeRun(...)` closes out the run record (writing `finished_at`, `summary_json`, and selecting the final status from accumulated failures and circuit-breaker state).

## Batch tasks, validation, and imports

<!-- lw:anchors packages/core/src/batch.ts#getOrCreateTask packages/core/src/batch.ts#createOrGetTask packages/core/src/batch.ts#safeJsonParse packages/core/src/batch.ts#validateRefinedModules packages/core/src/batch.ts#collectAllImports packages/core/src/batch.ts#getFileIdsForModule -->

Task bookkeeping lives in `getOrCreateTask(...)` and `createOrGetTask(...)`, both backed by the `batch_tasks` table; `getOrCreateTask` is the idempotent form used to reuse a row across retries, while `createOrGetTask` covers the create-or-fetch path. `safeJsonParse<T>(s)` parses JSON into `T | null`, returning `null` instead of throwing so checkpoints with corrupted `checkpoint_json` don't blow up the run. `validateRefinedModules(...)` validates the LLM-refined module list before it is committed. `collectAllImports(...)` walks the index for the import set used to build module edges. `getFileIdsForModule(absRoot, module)` returns the file IDs belonging to a module for downstream context assembly.

## Frontmatter handling and manual blocks

<!-- lw:anchors packages/core/src/batch.ts#readOwnerFromFrontmatter packages/core/src/batch.ts#forceOwnerInFrontmatter packages/core/src/batch.ts#extractManualBlocksBySection packages/core/src/batch.ts#slugifyHeadingText packages/core/src/batch.ts#injectManualBlocksBySection packages/core/src/batch.ts#sectionRangeOf -->

Frontmatter handling in the batch path enforces rule #6 (preserve manual content and refuse human owners). `readOwnerFromFrontmatter(content)` returns a `PreOwnerCheck` describing the current owner so the pipeline can decide whether to overwrite. `forceOwnerInFrontmatter(content, owner)` rewrites the owner field to `"generated"` or `"mixed"` as needed. `extractManualBlocksBySection(content)` returns a `Map<sectionHeading | null, string[]>` of `lw:manual` blocks keyed by their enclosing heading (or `null` for blocks before any heading). `slugifyHeadingText(text)` produces a deterministic section slug used as the key for re-injection. `injectManualBlocksBySection(existing, newContent)` merges the previously extracted manual blocks into freshly regenerated markdown by matching section ranges; `sectionRangeOf(headingOffset)` returns the `{ endOffset }` of a section starting at the given byte offset so the merger knows where each block belongs.

## Stage-4 generation, repair, and verification

<!-- lw:anchors packages/core/src/batch.ts#tryWriteAndVerify packages/core/src/batch.ts#verifyIssuesToValidationErrors packages/core/src/batch.ts#summarizeLlmDiagnosticError packages/core/src/batch.ts#summarizeVerifyDiagnosticErrors packages/core/src/batch.ts#diagnosticAttempt packages/core/src/batch.ts#attemptStage4Generation packages/core/src/batch.ts#buildModuleDocContext packages/core/src/batch.ts#buildFairTruncatedSource -->

Stage 4 writes docs transactionally: `tryWriteAndVerify(...)` performs snapshot → write → verify → restore/remove on any failure. `verifyIssuesToValidationErrors(...)` maps `VerifyIssue[]` from `./verify.js` into the structural `ArtifactValidationError[]` shape that the repair prompts consume. `summarizeLlmDiagnosticError(error)` and `summarizeVerifyDiagnosticErrors(...)` produce compact summaries respecting `DIAGNOSTIC_MAX_ERRORS` and `DIAGNOSTIC_TEXT_CAP` from `./batch-state.js`. `diagnosticAttempt(input)` wraps a single stage-4 call plus its optional repairs into a `DiagnosticAttempt`, capturing per-attempt outcomes. `attemptStage4Generation(...)` runs the bounded repair sequence (initial call + up to `maxRepairAttempts` corrective calls), normalizing the artifact via `normalizeStage4Artifact` and validating with `validateStage4Artifact` between attempts. `buildModuleDocContext(...)` assembles the prompt context per module, and `buildFairTruncatedSource(...)` produces the truncated source string passed into the stage-4 prompt while respecting the configured `contextCharBudget`.

## Config defaults, paths, and timeout validation

<!-- lw:anchors packages/core/src/config.ts#CONFIG_DEFAULTS packages/core/src/config.ts#MAX_TIMEOUT_MS packages/core/src/config.ts#assertValidTimeoutMs packages/core/src/config.ts#CONFIG_PATH packages/core/src/config.ts#CONFIG_FILENAME -->

`CONFIG_DEFAULTS` is the runtime-only default table applied by `applyDefaults` (never written into the config file): `language: "en"`, the `languages` extension allowlist (`ts/tsx/js/jsx/py`), per-provider `baseUrls`, the Phase-5 `maxRepairAttempts: 2`, `stage4MaxOutputTokens: 8192`, split thresholds `maxModuleFiles: 12` / `maxModuleSymbols: 80`, and `timeoutMs: 300_000`. `MAX_TIMEOUT_MS = 2_147_483_647` is the signed 32-bit safe maximum for Node's `setTimeout`. `assertValidTimeoutMs(v)` is a TypeScript assertion that accepts only integers in `[0, MAX_TIMEOUT_MS]` and throws a descriptive error otherwise. `CONFIG_PATH` is the relative `.livewiki/config.json` and `CONFIG_FILENAME` is its basename.

## Config errors, load/save, and shape validation

<!-- lw:anchors packages/core/src/config.ts#MissingProviderConfigError packages/core/src/config.ts#MissingProviderConfigError.constructor packages/core/src/config.ts#loadConfig packages/core/src/config.ts#saveConfig packages/core/src/config.ts#validateConfigShape packages/core/src/config.ts#applyDefaults packages/core/src/config.ts#validateConfigForBatch -->

`MissingProviderConfigError` extends `Error` and is raised when the LLM batch is launched without `provider` and/or `model` declared. Its constructor captures `repoRoot` and the list of `missingFields`, producing a message that names the file, lists the missing fields, and shows a non-defaulting example (`claude-sonnet-5` etc.); API keys are explicitly pointed at env vars. `loadConfig(repoRoot)` reads `.livewiki/config.json` (returning `{}` if missing or empty) and runs the result through `validateConfigShape`, failing closed on malformed JSON. `saveConfig(...)` writes the validated config back atomically. `validateConfigShape(parsed)` rejects unknown shapes and enforces the integer/non-negative invariant on `maxRepairAttempts` and the integer range on `timeoutMs` (via `assertValidTimeoutMs`). `applyDefaults(config)` fills in `CONFIG_DEFAULTS` for fields the user omitted, and `validateConfigForBatch(repoRoot, config)` is the pre-flight check called by `orchestrate` before creating the LLM client.

## Provider resolution

<!-- lw:anchors packages/core/src/config.ts#resolveProviderFromConfig packages/core/src/config.ts#resolveBaseUrl -->

`resolveProviderFromConfig(...)` expands `preset` (Phase 5 step 5: `anthropic`/`openai`/`openrouter`/`deepseek`/`kimi`/`minimax`/`gemini`/`nvidia`/`ollama`/`lmstudio`) into the resolved adapter, `baseUrl`, env-var, and pricing table, while honoring individual overrides on `baseUrl` and `pricing` and preserving legacy `provider` for back-compat. `resolveBaseUrl(config)` returns the effective base URL, preferring `config.baseUrl` then the preset default then `CONFIG_DEFAULTS.baseUrls[provider]`.

## SQLite schema and version constants

<!-- lw:anchors packages/core/src/db.ts#CURRENT_SCHEMA_VERSION packages/core/src/db.ts#SCHEMA_VERSION_KEY packages/core/src/db.ts#SCHEMA_SQL packages/core/src/db.ts#MIGRATION_SQL_V3 -->

`CURRENT_SCHEMA_VERSION = 4` and `SCHEMA_VERSION_KEY = "schema_version"` (the `meta` key that tracks schema state). `SCHEMA_SQL` is the idempotent set of `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` statements covering `files`, `symbols` (with a partial unique index `idx_symbols_active_key ON symbols(key) WHERE status = 'active'` so soft-deletes don't conflict with re-inserts), `meta`, `anchors`, `debt` (with partial `idx_debt_open ON debt(anchor_id, event) WHERE resolved_at IS NULL`), `undocumented`, `batch_runs`, `batch_tasks`, `doc_pages`, and `manual_blocks`. `MIGRATION_SQL_V3` is the v2→v3 migration that adds `debt.symbol_key`, recreates `symbols` to drop the inline `UNIQUE` (which SQLite doesn't allow `DROP INDEX` on), and adds the partial unique index plus `idx_debt_open`.

## Migrations and index lifecycle

<!-- lw:anchors packages/core/src/db.ts#migrateV3ToV4 packages/core/src/db.ts#migrationsFor packages/core/src/db.ts#postV3Migrations packages/core/src/db.ts#openIndex -->

`migrateV3ToV4(db)` is the v3→v4 migration: it inspects `PRAGMA table_info(batch_runs)` and idempotently adds `finished_at`, `started_by` (default `'cli'`), and `summary_json`, then creates the `idx_batch_runs_status`, `idx_batch_tasks_run_id`, and `idx_batch_tasks_status` indices. It is implemented as a function rather than a string because `SCHEMA_SQL` already runs at v4 on fresh DBs, so the migration must be idempotent. `migrationsFor(fromVersion, toVersion)` returns the ordered list of SQL strings and migration functions to apply for any version range. `postV3Migrations(...)` runs the post-v3 cleanup/verification steps after migrations complete. `openIndex(dbPath)` opens (or creates) a `better-sqlite3` connection at the validated path.

## Module structure and import graphs

<!-- lw:anchors packages/core/src/diagrams.ts#generateStructure packages/core/src/diagrams.ts#generateModulesGraph packages/core/src/diagrams.ts#moduleSlug -->

All three functions produce deterministic Mermaid text — no LLM. `generateStructure(filePaths)` emits a `graph TD` of the repository's directory tree, deduping nodes and edges. `generateModulesGraph(edges)` emits a `graph LR` of module-to-module import edges (with a placeholder `root` node when the edge list is empty). `moduleSlug(value)` lowercases, strips diacritics via NFD + combining-mark removal, replaces non-alphanumerics with `-`, and trims leading/trailing dashes to produce a filesystem-safe module name.

## Class diagrams and Mermaid helpers

<!-- lw:anchors packages/core/src/diagrams.ts#generateClassDiagram packages/core/src/diagrams.ts#classIdentity packages/core/src/diagrams.ts#mermaidId packages/core/src/diagrams.ts#mermaidMemberName packages/core/src/diagrams.ts#escapeLabel -->

`generateClassDiagram(module, symbols)` produces a `classDiagram` block filtered to symbols whose `key` starts with one of `module.paths`. It distinguishes classes across files by `classIdentity(path, className)`, groups each class's methods by that same identity, sorts methods by `key`, and assigns synthetic `class_<n>` IDs while showing the real class name in the label. `classIdentity(path, className)` returns `JSON.stringify([path, className])` as a stable key. `mermaidId(value)` sanitizes any value into a valid Mermaid identifier (`[^a-zA-Z0-9]` → `_`). `mermaidMemberName(value)` sanitizes method names similarly and falls back to `"method"` for the empty result. `escapeLabel(value)` escapes `&`, `"`, `[`, and `]` for safe embedding inside Mermaid label strings.

## Frontmatter parsing

<!-- lw:anchors packages/core/src/frontmatter.ts#parseFrontmatter packages/core/src/frontmatter.ts#parseYamlBlock packages/core/src/frontmatter.ts#stripComment packages/core/src/frontmatter.ts#FrontmatterParseError packages/core/src/frontmatter.ts#FrontmatterParseError.constructor -->

`parseFrontmatter(source)` normalizes CRLF to LF, detects the leading `---\n` opener, finds the closing `\n---`, slices out the YAML block, strips one leading newline from the body, and delegates to `parseYamlBlock`. It returns `{ frontmatter, body, bodyOffset }`, with `frontmatter: null` when no opener is present. `parseYamlBlock(yaml)` walks the YAML line by line, supporting top-level `key: value` and `key:` followed by indented `  - item` list items; unknown shapes raise `FrontmatterParseError`. `stripComment(s)` removes a trailing ` #...` comment fragment (no `#` escape inside strings; users must quote if needed). `FrontmatterParseError` extends `Error` and carries the failing `line` number in its message and on the instance.

## Frontmatter accessors

<!-- lw:anchors packages/core/src/frontmatter.ts#getAnchors packages/core/src/frontmatter.ts#getOwner -->

`getAnchors(fm)` returns the `anchors` field as `string[]` (empty array when missing or non-array). `getOwner(fm)` returns `"generated" | "human" | "mixed"` based on the `owner` field, defaulting to `"generated"` when absent or unrecognized — the same default used to overwrite pages owned by the pipeline.

## .gitignore read and ensure-entries

<!-- lw:anchors packages/core/src/gitignore.ts#readGitignore packages/core/src/gitignore.ts#ensureGitignoreEntries -->

`readGitignore(repoRoot)` returns the repo's `.gitignore` contents as a UTF-8 string, or `""` when the file doesn't exist (so callers don't need to handle ENOENT). `ensureGitignoreEntries(repoRoot, entries)` is the idempotent writer. It reads the current file via `readGitignore`, extracts any existing managed block via `extractManagedBlock`, computes the membership set (block contents if present, otherwise all non-comment non-blank lines), filters out already-present entries, and short-circuits with `changed: false` when nothing is missing. Otherwise it merges via `mergeBlockLines`, renders via `renderBlock`, splices back via `replaceManagedBlock`, writes the file, and returns `{ file, changed: true, added: missing }`.

## .gitignore block manipulation

<!-- lw:anchors packages/core/src/gitignore.ts#extractManagedBlock packages/core/src/gitignore.ts#mergeBlockLines packages/core/src/gitignore.ts#renderBlock packages/core/src/gitignore.ts#replaceManagedBlock -->

`extractManagedBlock(content)` matches `^#\s*livewiki:start\s*$` and `^#\s*livewiki:end\s*$` (multiline), trims and filters the inner lines, and returns `null` if either marker is missing (a truncated block is treated as absent to avoid clobbering). `mergeBlockLines(existing, toAdd)` appends only trimmed entries not already in the existing list, preserving order. `renderBlock(lines)` joins `[BLOCK_START, ...lines, BLOCK_END]` with newlines. `replaceManagedBlock(content, newBlock)` rewrites only the marker-delimited range when both markers are present (inserting a separator newline if the following content doesn't already start with one); otherwise it appends the block at end-of-file with the appropriate leading separators.

## Content hashing

<!-- lw:anchors packages/core/src/hashes.ts#sha256 packages/core/src/hashes.ts#sha256Slice -->

`sha256(content)` returns a lowercase hex SHA-256 digest for a string or `Uint8Array`. `sha256Slice(source, startByte, endByte)` slices the source by byte offset and delegates to `sha256`, producing the per-symbol fingerprint used by the indexer to detect local symbol changes without re-parsing the whole file.