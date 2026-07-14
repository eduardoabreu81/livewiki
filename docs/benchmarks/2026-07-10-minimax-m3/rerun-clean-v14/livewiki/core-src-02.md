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

## Batch pipeline entry points
<!-- lw:anchors packages/core/src/batch.ts#runBatch packages/core/src/batch.ts#resumeBatch packages/core/src/batch.ts#runOnly packages/core/src/batch.ts#orchestrate -->

`runBatch` is the primary entry point. It runs the documentation pipeline from scratch (new run) by delegating to `orchestrate` with `mode: "run"`. The signature accepts a `BatchOptions` object and returns a `Promise<BatchRunResult>`.

`resumeBatch` continues an interrupted run. It picks up the latest run with status `'running'` and proceeds with pending/failed tasks. Internally it calls `orchestrate` with `mode: "resume"`.

`runOnly` re-runs a single task (the `--only` target). It requires `opts.onlyTarget` (a module id or runId), increments the attempt counter, and accumulates usage. Guardrails apply: `lw:manual` blocks are preserved byte-for-byte and `owner: human` is refused. It delegates to `orchestrate` with `mode: "only"`.

`orchestrate` is the internal implementation shared by all three entry points. It receives an extended `OrchestrateOpts` (which adds a `mode` discriminator) and resolves the repository root, prepares `.livewiki/`, opens the SQLite index, loads and defaults the config, resolves the language, and determines whether an LLM client is required based on mode. It then drives the 4-stage pipeline (scan, module identification, prioritization, coordinated documentation) and returns a `BatchRunResult` describing totals, per-module usage, failures, and circuit-breaker state.

## Pipeline errors
<!-- lw:anchors packages/core/src/batch.ts#EmptyPipelineError packages/core/src/batch.ts#EmptyPipelineError.constructor packages/core/src/batch.ts#TaskError packages/core/src/batch.ts#TaskError.constructor packages/core/src/batch.ts#statusToExitCode -->

`EmptyPipelineError` is an `Error` subclass raised when the pipeline has no work to do (for example, zero modules were produced). Its constructor takes a `message: string` and forwards it to the base `Error` class.

`TaskError` is an internal `Error` subclass used to carry a structured failure from a batch task. Its constructor signature is `(code: string, message: string)`, where `code` is a stable failure code and `message` describes the cause.

`statusToExitCode` is an exported helper that maps a `BatchStatusReport` status string (`completed`, `completed_with_failures`, `aborted`, etc.) to a process exit code, so the CLI can surface failures to the shell.

## Usage accounting
<!-- lw:anchors packages/core/src/batch.ts#emptyUsage packages/core/src/batch.ts#aggregateTotals packages/core/src/batch.ts#accumulateUsage packages/core/src/batch.ts#computeCostFromUsage -->

`emptyUsage` returns a fresh, zeroed `StageUsage` record used to seed per-task accumulation.

`aggregateTotals` combines two `StageUsage` values into a new total (`a + b`), used for summing per-module usage into the run-level totals.

`accumulateUsage` merges a single attempt's `StageUsage` into a running accumulator, threading through usage history and the attempt counter.

`computeCostFromUsage` derives a USD cost from a usage record, given the configured pricing (used in the run summary).

## Task lifecycle
<!-- lw:anchors packages/core/src/batch.ts#getOrCreateTask packages/core/src/batch.ts#createOrGetTask packages/core/src/batch.ts#finalizeRun packages/core/src/batch.ts#buildResult -->

`getOrCreateTask` looks up an existing `batch_tasks` row for a given `(runId, stage, target)` triple and returns it, creating a new row if none exists.

`createOrGetTask` is the public alias used by the orchestrator: it ensures a task row exists and returns its id and checkpoint state.

`finalizeRun` writes the final `summary_json`, `status`, and `finished_at` for a `batch_runs` row, and is called once at the end of a run (or on abort).

`buildResult` assembles the final `BatchRunResult` object (totals, per-module usage, failures, circuit-breaker flag) from the orchestrator's in-memory state.

## Pipeline safety helpers
<!-- lw:anchors packages/core/src/batch.ts#safeJsonParse packages/core/src/batch.ts#validateRefinedModules packages/core/src/batch.ts#collectAllImports packages/core/src/batch.ts#getFileIdsForModule -->

`safeJsonParse` is a generic JSON parser wrapper that returns `null` on parse failure instead of throwing, used when reading checkpoint blobs and other free-form JSON from SQLite.

`validateRefinedModules` checks the LLM-refined module list (stage 2) against the structural invariants the orchestrator relies on (unique ids, exact path partition, no peer-directory fragmentation).

`collectAllImports` asynchronously walks the modules and gathers every import edge, used to feed the module-edge graph and prioritization.

`getFileIdsForModule` returns the SQLite `files.id` values that belong to a `Module`, used to scope symbol queries and write attempts to a single module.

## Owner and frontmatter handling
<!-- lw:anchors packages/core/src/batch.ts#readOwnerFromFrontmatter packages/core/src/batch.ts#forceOwnerInFrontmatter packages/core/src/batch.ts#extractManualBlocksBySection packages/core/src/batch.ts#injectManualBlocksBySection packages/core/src/batch.ts#sectionRangeOf packages/core/src/batch.ts#slugifyHeadingText -->

`readOwnerFromFrontmatter` parses a markdown source and returns a `PreOwnerCheck` describing whether the existing frontmatter has `owner: human`, `owner: generated`, `owner: mixed`, or no owner at all.

`forceOwnerInFrontmatter` rewrites the `owner:` field of a markdown page's frontmatter to either `"generated"` or `"mixed"`, preserving all other content. It is used when the orchestrator writes a regenerated page and must not silently take over a `human` page.

`extractManualBlocksBySection` finds every `lw:manual` block in a page and groups them by the heading section they live under (or `null` for blocks before the first heading).

`injectManualBlocksBySection` is the inverse operation: it takes the previously extracted manual blocks and re-injects them into the freshly generated content at the matching section anchors, preserving byte content. Returns `null` when no injection is possible (page structure changed too much).

`sectionRangeOf` computes the byte range `{ endOffset }` of the section that starts at the given heading offset, used to scope manual-block injection to the correct section.

`slugifyHeadingText` produces the deterministic heading slug used as the section key for manual-block grouping (matches the slugifier used elsewhere in the frontmatter/anchor ledger).

## Write and verify path
<!-- lw:anchors packages/core/src/batch.ts#tryWriteAndVerify packages/core/src/batch.ts#verifyIssuesToValidationErrors packages/core/src/batch.ts#buildModuleDocContext packages/core/src/batch.ts#buildFairTruncatedSource -->

`tryWriteAndVerify` performs the transactional write of a generated page: snapshot the existing file, write the new content, run the verifier, and on failure either restore the snapshot or remove the partial write (so a half-written page never lands in the repo).

`verifyIssuesToValidationErrors` converts the verifier's structured `VerifyIssue` list into the `ArtifactValidationError` shape consumed by the repair-prompt builder.

`buildModuleDocContext` assembles the per-module context bundle fed to the stage-4 LLM call: truncated source, import list, symbol table, and any prior diagnostic summaries.

`buildFairTruncatedSource` (exported) produces a deterministically truncated source string for the prompt, respecting the `contextCharBudget` while preserving balanced cuts around symbols.

## Diagnostics and repair
<!-- lw:anchors packages/core/src/batch.ts#summarizeLlmDiagnosticError packages/core/src/batch.ts#summarizeVerifyDiagnosticErrors packages/core/src/batch.ts#diagnosticAttempt packages/core/src/batch.ts#attemptStage4Generation -->

`summarizeLlmDiagnosticError` reduces an LLM transport/SDK error (timeout, rate limit, malformed response) to a compact `DiagnosticErrorSummary` suitable for the report and the next repair attempt's prompt.

`summarizeVerifyDiagnosticErrors` does the same for a batch of structural verification issues, capped at `DIAGNOSTIC_MAX_ERRORS` and `DIAGNOSTIC_TEXT_CAP` to keep the repair prompt bounded.

`diagnosticAttempt` is the typed input passed to the repair sequencer: it carries the previous artifact, the validation errors, and an attempt counter.

`attemptStage4Generation` runs a single stage-4 generation cycle (initial call or repair), invoking the LLM with the appropriate prompt and returning either a normalized artifact or a diagnostic outcome.

## Config constants
<!-- lw:anchors packages/core/src/config.ts#CONFIG_DEFAULTS packages/core/src/config.ts#MAX_TIMEOUT_MS packages/core/src/config.ts#CONFIG_FILENAME packages/core/src/config.ts#CONFIG_PATH -->

`CONFIG_DEFAULTS` is the runtime defaults table (not written to disk). It carries `language`, `languages`, `baseUrls` per provider, `maxRepairAttempts` (default `2`), `stage4MaxOutputTokens` (`8192`), `maxModuleFiles` (`12`), `maxModuleSymbols` (`80`), and `timeoutMs` (`300_000`).

`MAX_TIMEOUT_MS` is the upper bound for any timeout value (`2_147_483_647`), chosen to stay within Node's safe `setTimeout` range (signed 32-bit ms).

`CONFIG_FILENAME` is the basename of the config path (`config.json`).

`CONFIG_PATH` is the relative path of the repo-local config file (`.livewiki/config.json`).

## Config validation
<!-- lw:anchors packages/core/src/config.ts#assertValidTimeoutMs packages/core/src/config.ts#MissingProviderConfigError packages/core/src/config.ts#MissingProviderConfigError.constructor packages/core/src/config.ts#validateConfigShape packages/core/src/config.ts#validateConfigForBatch -->

`assertValidTimeoutMs` is a type-predicate function that throws if `v` is not an integer in `[0, MAX_TIMEOUT_MS]`. It guards both the config-load path and the programmatic `createLlmClient` path.

`MissingProviderConfigError` is the error raised by `validateConfigForBatch` when the LLM stage is about to run but the config lacks a `provider` and/or `model`. The constructor takes `(repoRoot, missingFields)` and emits a message pointing at `.livewiki/config.json` with a copy-paste example (the example model is illustrative only — `livewiki` never silently picks a model).

`validateConfigShape` performs the structural check on the raw parsed JSON: known keys only, correct types for `maxRepairAttempts`, `stage4MaxOutputTokens`, `maxModuleFiles`, `maxModuleSymbols`, `timeoutMs`, `pathRoles`, and so on. Returns a fully typed `LivewikiConfig`.

`validateConfigForBatch` is the entry-point-level guard called by `batch.ts` before the LLM client is constructed; it throws `MissingProviderConfigError` when the config is not usable for an LLM run.

## Config load/save and resolution
<!-- lw:anchors packages/core/src/config.ts#loadConfig packages/core/src/config.ts#saveConfig packages/core/src/config.ts#applyDefaults packages/core/src/config.ts#resolveProviderFromConfig packages/core/src/config.ts#resolveBaseUrl -->

`loadConfig` reads `.livewiki/config.json` from the repo root. Missing file → empty config. Empty content → empty config. Malformed JSON → thrown error pointing at the path with a hint to delete it for a clean start.

`saveConfig` writes a `LivewikiConfig` back to `.livewiki/config.json` (used by the interactive `init` flow).

`applyDefaults` fills in runtime defaults from `CONFIG_DEFAULTS` for any field omitted from the loaded config, producing the effective config used by the pipeline. Only `language` carries an explicit default in the persisted file; other fields stay undefined here so callers are forced to pick.

`resolveProviderFromConfig` resolves the effective provider config by expanding `preset` (if any) on top of `provider`/`model`/`baseUrl`/`pricing`, applying per-field overrides, and returning the final adapter-relevant settings.

`resolveBaseUrl` returns the effective base URL for the chosen provider, falling back to `CONFIG_DEFAULTS.baseUrls[provider]` when `config.baseUrl` is absent.

## Schema metadata
<!-- lw:anchors packages/core/src/db.ts#CURRENT_SCHEMA_VERSION packages/core/src/db.ts#SCHEMA_VERSION_KEY packages/core/src/db.ts#SCHEMA_SQL -->

`CURRENT_SCHEMA_VERSION` is the integer version of the schema this build expects (`4`).

`SCHEMA_VERSION_KEY` is the `meta.key` value used to record the on-disk schema version in the `meta` table.

`SCHEMA_SQL` is the idempotent CREATE TABLE / CREATE INDEX block run on every `openIndex`. It defines `files`, `symbols` (with the partial unique index `idx_symbols_active_key`), `meta`, `anchors`, `debt` (with the partial open-debt index `idx_debt_open`), `undocumented`, `batch_runs`, `batch_tasks`, `doc_pages`, and `manual_blocks`. It is safe to run on a fresh or existing DB.

## Migrations
<!-- lw:anchors packages/core/src/db.ts#MIGRATION_SQL_V3 packages/core/src/db.ts#migrateV3ToV4 packages/core/src/db.ts#migrationsFor packages/core/src/db.ts#postV3Migrations -->

`MIGRATION_SQL_V3` is the SQL script that migrates a v2 schema to v3: adds `debt.symbol_key`, rebuilds `symbols` without the inline UNIQUE, creates the partial unique index `idx_symbols_active_key`, and creates the partial open-debt index `idx_debt_open`.

`migrateV3ToV4` migrates v3 to v4 in code (not as a raw SQL string) because the v4 columns need `PRAGMA table_info` introspection before `ALTER TABLE ADD COLUMN` (SQLite has no `ADD COLUMN IF NOT EXISTS`). It adds `finished_at`, `started_by` (default `'cli'`), and `summary_json` to `batch_runs`, and creates the `idx_batch_runs_status` / `idx_batch_tasks_*` indexes.

`migrationsFor` returns the list of migration steps (SQL string or JS function) needed to move the DB from `fromVersion` to `toVersion`, ordered by destination version.

`postV3Migrations` runs the v3 SQL migration directly (used by `openIndex` when the stored version is `< 3`).

## DB lifecycle
<!-- lw:anchors packages/core/src/db.ts#openIndex -->

`openIndex` opens (or creates) `<repoRoot>/.livewiki/index.db`, ensures the schema is at the latest version by applying any pending migrations from `migrationsFor`, and returns the open `better-sqlite3` handle ready for use by the indexer, ledger, batch, and verifier.

## Mermaid diagram generation
<!-- lw:anchors packages/core/src/diagrams.ts#moduleSlug packages/core/src/diagrams.ts#generateStructure packages/core/src/diagrams.ts#generateModulesGraph packages/core/src/diagrams.ts#generateClassDiagram -->

`moduleSlug` produces a lowercase, accent-stripped, hyphen-separated slug for any string (used for the module-level Mermaid file names).

`generateStructure` emits a `graph TD` Mermaid diagram for the repository's directory tree given a list of file paths, deduplicating nodes and edges.

`generateModulesGraph` emits a `graph LR` Mermaid diagram for the inter-module import edges. When the edge list is empty it falls back to a single `root[No module edges detected]` node.

`generateClassDiagram` emits a `classDiagram` for a single module's classes and their methods. Classes with the same display name in different files receive distinct Mermaid IDs (`class_1`, `class_2`, …), and methods are grouped by the full `(path, className)` identity to keep class boundaries stable.

## Mermaid identifier helpers
<!-- lw:anchors packages/core/src/diagrams.ts#classIdentity packages/core/src/diagrams.ts#mermaidId packages/core/src/diagrams.ts#mermaidMemberName packages/core/src/diagrams.ts#escapeLabel -->

`classIdentity` returns the JSON-stringified `[path, className]` pair used as the canonical key for grouping methods under their owning class.

`mermaidId` maps any string to a Mermaid-safe identifier by replacing every non-alphanumeric character with `_`.

`mermaidMemberName` sanitizes a method/field name for Mermaid by keeping only `[A-Za-z0-9_.]`, substituting the rest with `_`, and falling back to the literal `"method"` for empty results.

`escapeLabel` escapes a string for safe use inside a Mermaid node label: `&` → `&amp;`, `"` → `&quot;`, `[` → `&#91;`, `]` → `&#93;`.

## Frontmatter parsing
<!-- lw:anchors packages/core/src/frontmatter.ts#FrontmatterParseError packages/core/src/frontmatter.ts#FrontmatterParseError.constructor packages/core/src/frontmatter.ts#parseFrontmatter packages/core/src/frontmatter.ts#parseYamlBlock packages/core/src/frontmatter.ts#stripComment -->

`FrontmatterParseError` is thrown for any structural problem in the YAML subset. Its constructor `(message, line)` prefixes the message with `Frontmatter parse error (line N):` and stores `line` for callers.

`parseFrontmatter` splits a page into `{ frontmatter, body, bodyOffset }`. If the page does not begin with `---\n`, `frontmatter` is `null` and the body is the entire source. Otherwise it locates the closing `---\n`, slices the YAML block, and returns the parsed map plus the body offset.

`parseYamlBlock` is the internal YAML-subset parser. It supports top-level keys, list-of-strings values via indented `- value`, and `#` comments. Nested maps, multi-line strings (`|`/`>`), booleans/null, anchors, and `\"` escapes are intentionally not supported.

`stripComment` removes an unquoted ` #` comment suffix from a single line (the parser does not recognize `#` inside strings).

## Frontmatter helpers
<!-- lw:anchors packages/core/src/frontmatter.ts#getAnchors packages/core/src/frontmatter.ts#getOwner -->

`getAnchors` reads the `anchors` field from a parsed frontmatter map and returns it as a `string[]`. Returns `[]` when the field is missing or is a scalar string.

`getOwner` reads the `owner` field and returns `"generated" | "human" | "mixed"`. Unknown values (including missing) fall back to `"generated"`, matching the orchestrator's safe default.

## Gitignore management
<!-- lw:anchors packages/core/src/gitignore.ts#readGitignore packages/core/src/gitignore.ts#ensureGitignoreEntries packages/core/src/gitignore.ts#extractManagedBlock packages/core/src/gitignore.ts#mergeBlockLines packages/core/src/gitignore.ts#renderBlock packages/core/src/gitignore.ts#replaceManagedBlock -->

`readGitignore` reads the repo's `.gitignore` and returns its UTF-8 content, or an empty string if the file does not exist.

`ensureGitignoreEntries` is the idempotent writer. Given a list of entries, it adds any that are missing inside a managed block delimited by `# livewiki:start` / `# livewiki:end`, never duplicates, never removes existing user entries, and returns `{ file, changed, added }` so the caller can report what happened. Behavior depends on whether a managed block already exists: missing → append, present → rewrite only the block.

`extractManagedBlock` parses the content and returns the lines between the start/end markers (whitespace-tolerant), or `null` if no complete block is present (a truncated block is ignored to avoid corrupting the file).

`mergeBlockLines` unions the existing block lines with the requested new entries, preserving order (existing first, then new), and de-duplicating via a `Set`.

`renderBlock` returns the managed block as a single string (`BLOCK_START\n<lines>\nBLOCK_END`).

`replaceManagedBlock` replaces the existing managed block range (or appends a new one) with the rendered block, preserving surrounding content and ensuring correct newline separators.

## Content hashing
<!-- lw:anchors packages/core/src/hashes.ts#sha256 packages/core/src/hashes.ts#sha256Slice -->

`sha256` returns the lowercase hex SHA-256 digest of a `string` or `Uint8Array`. It has no salt — it is a content fingerprint, not an authentication primitive.

`sha256Slice` is a thin wrapper that hashes only the `[startByte, endByte)` slice of a source string, used by the indexer to detect local symbol changes without re-parsing the whole file.