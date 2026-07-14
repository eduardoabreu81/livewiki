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
<!-- lw:anchors packages/core/src/batch.ts#runBatch packages/core/src/batch.ts#resumeBatch packages/core/src/batch.ts#runOnly packages/core/src/batch.ts#orchestrate packages/core/src/batch.ts#statusToExitCode -->

The `batch.ts` module orchestrates the 4-stage documentation pipeline. `runBatch` starts a fresh run, `resumeBatch` continues the most recent `running` run from pending or failed tasks, and `runOnly` re-runs a single task identified by `opts.onlyTarget` (a module id or run id). All three delegate to the internal `orchestrate` function with a `mode` discriminator (`"run" | "resume" | "only"`). The `--only` mode preserves `lw:manual` blocks byte-for-byte and refuses `owner: human` content. `statusToExitCode` converts a `BatchStatusReport` into a process exit code.

## Batch pipeline internals
<!-- lw:anchors packages/core/src/batch.ts#EmptyPipelineError packages/core/src/batch.ts#EmptyPipelineError.constructor packages/core/src/batch.ts#TaskError packages/core/src/batch.ts#TaskError.constructor packages/core/src/batch.ts#emptyUsage packages/core/src/batch.ts#aggregateTotals packages/core/src/batch.ts#accumulateUsage packages/core/src/batch.ts#getOrCreateTask packages/core/src/batch.ts#createOrGetTask packages/core/src/batch.ts#safeJsonParse packages/core/src/batch.ts#validateRefinedModules packages/core/src/batch.ts#collectAllImports packages/core/src/batch.ts#readOwnerFromFrontmatter packages/core/src/batch.ts#forceOwnerInFrontmatter packages/core/src/batch.ts#extractManualBlocksBySection packages/core/src/batch.ts#slugifyHeadingText packages/core/src/batch.ts#injectManualBlocksBySection packages/core/src/batch.ts#sectionRangeOf packages/core/src/batch.ts#tryWriteAndVerify packages/core/src/batch.ts#verifyIssuesToValidationErrors packages/core/src/batch.ts#summarizeLlmDiagnosticError packages/core/src/batch.ts#summarizeVerifyDiagnosticErrors packages/core/src/batch.ts#diagnosticAttempt packages/core/src/batch.ts#attemptStage4Generation packages/core/src/batch.ts#computeCostFromUsage packages/core/src/batch.ts#buildModuleDocContext packages/core/src/batch.ts#buildFairTruncatedSource packages/core/src/batch.ts#getFileIdsForModule packages/core/src/batch.ts#finalizeRun packages/core/src/batch.ts#buildResult -->

`EmptyPipelineError` and `TaskError` are the two error classes raised inside the pipeline. `EmptyPipelineError` extends `Error` and signals that no modules survived the stage-2 identification. `TaskError` carries a `code` and `message` for per-task failures that get recorded on the task checkpoint.

Usage accounting primitives: `emptyUsage` returns a zero-initialized `StageUsage`; `aggregateTotals` and `accumulateUsage` combine `StageUsage` values across modules and across retry attempts. `computeCostFromUsage` converts token usage into USD via the pricing table. `buildModuleDocContext` and `buildFairTruncatedSource` build the per-task prompt context, truncating source to the configured `contextCharBudget`.

Task management: `getOrCreateTask` and `createOrGetTask` manage `batch_tasks` rows. `safeJsonParse` tolerates malformed LLM JSON. `validateRefinedModules` checks LLM-refined module candidates, and `collectAllImports` walks the source tree for the import graph.

Frontmatter and manual-block handling: `readOwnerFromFrontmatter` reads the existing owner of a page; `forceOwnerInFrontmatter` rewrites it to `generated` or `mixed`. `extractManualBlocksBySection` and `injectManualBlocksBySection` preserve `lw:manual` content during regen, with `slugifyHeadingText` normalizing heading text and `sectionRangeOf` locating a section's byte range. `tryWriteAndVerify` performs the transactional snapshot → write → verify → restore/remove sequence; `verifyIssuesToValidationErrors` converts verify issues to validation errors, and `summarizeLlmDiagnosticError` plus `summarizeVerifyDiagnosticErrors` produce compact error digests. `diagnosticAttempt` and `attemptStage4Generation` drive the bounded repair-prompt sequence for stage 4. `getFileIdsForModule` resolves file rows for a module, and `finalizeRun` together with `buildResult` produces the `BatchRunResult` aggregate.

## Configuration
<!-- lw:anchors packages/core/src/config.ts#CONFIG_DEFAULTS packages/core/src/config.ts#CONFIG_FILENAME packages/core/src/config.ts#CONFIG_PATH packages/core/src/config.ts#MAX_TIMEOUT_MS packages/core/src/config.ts#MissingProviderConfigError packages/core/src/config.ts#MissingProviderConfigError.constructor packages/core/src/config.ts#assertValidTimeoutMs packages/core/src/config.ts#loadConfig packages/core/src/config.ts#resolveProviderFromConfig packages/core/src/config.ts#saveConfig packages/core/src/config.ts#applyDefaults packages/core/src/config.ts#validateConfigForBatch packages/core/src/config.ts#resolveBaseUrl packages/core/src/config.ts#validateConfigShape -->

`config.ts` owns the `.livewiki/config.json` schema. `CONFIG_FILENAME` is the basename (`config.json`) and `CONFIG_PATH` is the repo-relative path. `CONFIG_DEFAULTS` is the runtime defaults bag (language `"en"`, default `baseUrls` per provider, `maxRepairAttempts: 2`, `stage4MaxOutputTokens: 8192`, split thresholds, `timeoutMs: 300_000`). `MAX_TIMEOUT_MS` is the Node `setTimeout` safe max used by `assertValidTimeoutMs` to validate `timeoutMs` in the config and in programmatic client creation.

`MissingProviderConfigError` is raised by `validateConfigForBatch` when `provider` or `model` is absent before a batch run; its message points the user to `.livewiki/config.json`. `loadConfig` reads and parses the file (fails closed on malformed JSON); `validateConfigShape` rejects unknown shapes; `applyDefaults` merges `CONFIG_DEFAULTS`. `resolveProviderFromConfig` expands a `preset` name into a full provider config, and `resolveBaseUrl` picks the final base URL. `saveConfig` writes the config back to disk.

## SQLite index
<!-- lw:anchors packages/core/src/db.ts#CURRENT_SCHEMA_VERSION packages/core/src/db.ts#MIGRATION_SQL_V3 packages/core/src/db.ts#SCHEMA_SQL packages/core/src/db.ts#SCHEMA_VERSION_KEY packages/core/src/db.ts#migrateV3ToV4 packages/core/src/db.ts#migrationsFor packages/core/src/db.ts#openIndex packages/core/src/db.ts#postV3Migrations -->

`db.ts` defines the SQLite index. `CURRENT_SCHEMA_VERSION` is `4` and `SCHEMA_VERSION_KEY` is the meta key (`"schema_version"`) used to track the version inside the `meta` table. `SCHEMA_SQL` is the idempotent DDL for the current schema, covering `files`, `symbols` (with the partial-unique `idx_symbols_active_key` to allow soft-delete of replaced symbols), `meta`, `anchors`, `debt`, `undocumented`, `batch_runs`, `batch_tasks`, `doc_pages`, and `manual_blocks`. `MIGRATION_SQL_V3` is the v2→v3 migration adding `debt.symbol_key` and the partial unique index.

`migrateV3ToV4` adds `batch_runs.finished_at`, `started_by`, and `summary_json` (with `PRAGMA table_info` guards since SQLite has no `ADD COLUMN IF NOT EXISTS`). `migrationsFor(from, to)` returns the ordered list of SQL strings or JS functions needed to upgrade. `openIndex` opens a `better-sqlite3` connection at a validated path, and `postV3Migrations` runs the v3+ migration sequence after a fresh `SCHEMA_SQL` apply.

## Mermaid diagrams
<!-- lw:anchors packages/core/src/diagrams.ts#classIdentity packages/core/src/diagrams.ts#escapeLabel packages/core/src/diagrams.ts#generateClassDiagram packages/core/src/diagrams.ts#generateModulesGraph packages/core/src/diagrams.ts#generateStructure packages/core/src/diagrams.ts#mermaidId packages/core/src/diagrams.ts#mermaidMemberName packages/core/src/diagrams.ts#moduleSlug -->

`diagrams.ts` produces deterministic Mermaid output with no LLM involvement. `moduleSlug` lowercases, strips diacritics, and replaces non-alphanumerics with `-`. `generateStructure` emits the directory tree (`graph TD`), `generateModulesGraph` emits the inter-module import graph (`graph LR`, with a sentinel `root[No module edges detected]` when empty), and `generateClassDiagram` emits the per-module class diagram (`classDiagram`) by grouping methods via `classIdentity` so the same display name in different files stays distinct. `mermaidId` and `mermaidMemberName` sanitize identifiers for Mermaid; `escapeLabel` escapes `&`, `"`, `[`, `]` for use inside node labels.

## Frontmatter parsing
<!-- lw:anchors packages/core/src/frontmatter.ts#FrontmatterParseError packages/core/src/frontmatter.ts#FrontmatterParseError.constructor packages/core/src/frontmatter.ts#parseFrontmatter packages/core/src/frontmatter.ts#parseYamlBlock packages/core/src/frontmatter.ts#stripComment packages/core/src/frontmatter.ts#getAnchors packages/core/src/frontmatter.ts#getOwner -->

`frontmatter.ts` implements a YAML subset parser for wiki page frontmatter. `FrontmatterParseError` carries the 1-based `line` of the failure. `parseFrontmatter` detects the opening `---`, finds the closing `---`, and returns `{ frontmatter, body, bodyOffset }`; pages without a leading `---\n` return `frontmatter: null` (not an error). `parseYamlBlock` walks top-level keys and `- value` list items, throwing `FrontmatterParseError` for orphaned list items or invalid lines. `stripComment` trims `# ...` comments outside strings. `getAnchors` reads the `anchors` list (always `string[]`); `getOwner` reads `owner` and falls back to `"generated"` when missing or unrecognized.

## .gitignore management
<!-- lw:anchors packages/core/src/gitignore.ts#ensureGitignoreEntries packages/core/src/gitignore.ts#extractManagedBlock packages/core/src/gitignore.ts#mergeBlockLines packages/core/src/gitignore.ts#readGitignore packages/core/src/gitignore.ts#renderBlock packages/core/src/gitignore.ts#replaceManagedBlock -->

`gitignore.ts` keeps `.livewiki/` (and any other required entries) out of version control without duplicating or removing user-added lines. `readGitignore` returns the file content or `""` if absent. `ensureGitignoreEntries` is idempotent: it detects the `# livewiki:start` / `# livewiki:end` managed block via `extractManagedBlock`, merges new entries with `mergeBlockLines` (case-sensitive trim match, no duplicates), renders the block with `renderBlock`, and writes it back via `replaceManagedBlock` (which replaces the block in place when present and appends when absent, preserving surrounding content).

## Hashing
<!-- lw:anchors packages/core/src/hashes.ts#sha256 packages/core/src/hashes.ts#sha256Slice -->

`hashes.ts` exposes `sha256`, a thin wrapper over `node:crypto` returning lowercase hex (64 chars), and `sha256Slice`, which hashes `source.slice(startByte, endByte)` for per-symbol change detection during incremental indexing.