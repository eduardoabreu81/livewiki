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

## batch.ts — entry points

<!-- lw:anchors packages/core/src/batch.ts#runBatch packages/core/src/batch.ts#resumeBatch packages/core/src/batch.ts#runOnly packages/core/src/batch.ts#orchestrate -->

`runBatch`, `resumeBatch`, and `runOnly` are the three public entry points. They all delegate to `orchestrate`, parameterizing the run mode (`"run"`, `"resume"`, `"only"`). `runOnly` validates that `opts.onlyTarget` is provided and throws otherwise. `orchestrate` resolves the repo root, ensures `.livewiki/` exists, opens the index DB, loads config, applies defaults, and resolves the language, repair budget, output-token budget, char budget, thinking mode, and module-split limits. It creates an `LlmClient` unless one was injected, and only when the mode actually needs one (any mode except `--no-refine` cases where the LLM is unused).

## batch.ts — pipeline, task, and error primitives

<!-- lw:anchors packages/core/src/batch.ts#EmptyPipelineError packages/core/src/batch.ts#EmptyPipelineError.constructor packages/core/src/batch.ts#TaskError packages/core/src/batch.ts#TaskError.constructor packages/core/src/batch.ts#emptyUsage packages/core/src/batch.ts#aggregateTotals packages/core/src/batch.ts#accumulateUsage packages/core/src/batch.ts#getOrCreateTask packages/core/src/batch.ts#createOrGetTask packages/core/src/batch.ts#safeJsonParse -->

`EmptyPipelineError` is thrown when the pipeline produces no work (its `constructor` takes a `message: string`). `TaskError` is the structured per-task failure (constructor takes `code: string` and `message: string`). `emptyUsage` constructs a zero-valued `StageUsage`; `aggregateTotals` and `accumulateUsage` combine usage records across stages and attempts. `getOrCreateTask` and `createOrGetTask` manage `batch_tasks` rows keyed by `(run_id, target)`. `safeJsonParse<T>` is a defensive JSON parse that returns `T | null` on failure.

## batch.ts — module discovery and validation

<!-- lw:anchors packages/core/src/batch.ts#validateRefinedModules packages/core/src/batch.ts#collectAllImports packages/core/src/batch.ts#getFileIdsForModule packages/core/src/batch.ts#buildModuleDocContext packages/core/src/batch.ts#buildFairTruncatedSource -->

`validateRefinedModules` enforces shape constraints on the LLM-refined module list. `collectAllImports` walks the index to aggregate import edges across all files in scope. `getFileIdsForModule` resolves a `Module` to its underlying `files.id` rows. `buildModuleDocContext` and `buildFairTruncatedSource` assemble the per-module prompt context, applying a character budget with a deterministic fair-truncation strategy.

## batch.ts — frontmatter preservation and manual blocks

<!-- lw:anchors packages/core/src/batch.ts#readOwnerFromFrontmatter packages/core/src/batch.ts#forceOwnerInFrontmatter packages/core/src/batch.ts#extractManualBlocksBySection packages/core/src/batch.ts#slugifyHeadingText packages/core/src/batch.ts#injectManualBlocksBySection packages/core/src/batch.ts#sectionRangeOf -->

`readOwnerFromFrontmatter` returns a `PreOwnerCheck` describing the current owner state of a doc page. `forceOwnerInFrontmatter` overwrites the owner to `generated` or `mixed` while preserving the rest of the block. `extractManualBlocksBySection` and `injectManualBlocksBySection` protect and re-insert `lw:manual` content, keyed by the section heading they were attached to. `sectionRangeOf` computes the body offset range of a heading. `slugifyHeadingText` produces the section slug used as the key in that map.

## batch.ts — verify, diagnostics, and stage-4 retry

<!-- lw:anchors packages/core/src/batch.ts#tryWriteAndVerify packages/core/src/batch.ts#verifyIssuesToValidationErrors packages/core/src/batch.ts#summarizeLlmDiagnosticError packages/core/src/batch.ts#summarizeVerifyDiagnosticErrors packages/core/src/batch.ts#diagnosticAttempt packages/core/src/batch.ts#attemptStage4Generation packages/core/src/batch.ts#computeCostFromUsage -->

`tryWriteAndVerify` performs the transactional write path (snapshot → write → verify → restore/remove on failure). `verifyIssuesToValidationErrors` maps `VerifyIssue[]` into the structured errors the artifact normalizer expects. `summarizeLlmDiagnosticError` and `summarizeVerifyDiagnosticErrors` produce human-readable error summaries; `diagnosticAttempt` orchestrates one bounded repair attempt using those summaries. `attemptStage4Generation` runs the initial stage-4 call plus the bounded repair sequence. `computeCostFromUsage` resolves a `StageUsage` plus a pricing table into a USD total.

## batch.ts — run finalization

<!-- lw:anchors packages/core/src/batch.ts#finalizeRun packages/core/src/batch.ts#buildResult packages/core/src/batch.ts#statusToExitCode -->

`finalizeRun` closes out a `batch_runs` row: stamps `finished_at`, writes `summary_json`, and marks the run status. `buildResult` assembles the final `BatchRunResult` (status, totals, by-module usage, failures, circuit-breaker flag) from the task checkpoints. `statusToExitCode` maps the run status into the process exit code (`completed_with_failures` and `aborted` produce non-zero codes).

## config.ts — constants and validation

<!-- lw:anchors packages/core/src/config.ts#MAX_TIMEOUT_MS packages/core/src/config.ts#assertValidTimeoutMs packages/core/src/config.ts#CONFIG_DEFAULTS packages/core/src/config.ts#CONFIG_PATH packages/core/src/config.ts#CONFIG_FILENAME -->

`MAX_TIMEOUT_MS` is the signed-32-bit `setTimeout` ceiling (`2_147_483_647`). `assertValidTimeoutMs` is an assertion function that narrows `unknown` to `number` and rejects non-integers, negatives, or values above the ceiling. `CONFIG_DEFAULTS` holds runtime defaults (language, language list, per-provider base URLs, repair budget, output-token budget, split thresholds, timeout) that are not persisted to disk. `CONFIG_PATH` is the repo-relative `.livewiki/config.json`; `CONFIG_FILENAME` is its basename.

## config.ts — error and load path

<!-- lw:anchors packages/core/src/config.ts#MissingProviderConfigError packages/core/src/config.ts#MissingProviderConfigError.constructor packages/core/src/config.ts#loadConfig packages/core/src/config.ts#validateConfigShape -->

`MissingProviderConfigError` (constructor takes `repoRoot` and `missingFields: Array<"provider" | "model">`) is thrown when the LLM batch is invoked without provider/model configured. `loadConfig` reads `.livewiki/config.json`, returns `{}` if absent or empty, and throws a clear error on malformed JSON. `validateConfigShape` enforces the parsed-object shape: required types per field, valid `LlmProvider` values, integer ranges for `maxRepairAttempts`, `stage4MaxOutputTokens`, `maxModuleFiles`, `maxModuleSymbols`, and `timeoutMs`.

## config.ts — resolve, apply, and save

<!-- lw:anchors packages/core/src/config.ts#applyDefaults packages/core/src/config.ts#resolveProviderFromConfig packages/core/src/config.ts#resolveBaseUrl packages/core/src/config.ts#validateConfigForBatch packages/core/src/config.ts#saveConfig -->

`applyDefaults` overlays `CONFIG_DEFAULTS` onto a loaded config (without mutating the file). `resolveProviderFromConfig` expands a `preset` (Fase 5) into concrete provider, base URL, env var, and pricing, while honoring per-field overrides. `resolveBaseUrl` returns the final base URL (config override, preset default, or `CONFIG_DEFAULTS.baseUrls`). `validateConfigForBatch` throws `MissingProviderConfigError` if provider/model is missing before LLM client construction. `saveConfig` writes the config back to `.livewiki/config.json` (atomic, never writes API keys).

## db.ts — schema and version constants

<!-- lw:anchors packages/core/src/db.ts#CURRENT_SCHEMA_VERSION packages/core/src/db.ts#SCHEMA_VERSION_KEY packages/core/src/db.ts#SCHEMA_SQL packages/core/src/db.ts#MIGRATION_SQL_V3 -->

`CURRENT_SCHEMA_VERSION` is `4`. `SCHEMA_VERSION_KEY` is the `meta.key` used to record the on-disk version. `SCHEMA_SQL` is the canonical, idempotent schema (`files`, `symbols` with a partial unique index on `status='active'`, `meta`, `anchors`, `debt` with a partial index on open rows, `undocumented`, `batch_runs` with `started_by`/`finished_at`/`summary_json`, `batch_tasks`, `doc_pages`, `manual_blocks`). `MIGRATION_SQL_V3` is the v2→v3 migration: `ALTER TABLE debt ADD COLUMN symbol_key`, recreate `symbols` without the inline UNIQUE, add the partial unique index, and add the open-debt partial index.

## db.ts — open and migrate

<!-- lw:anchors packages/core/src/db.ts#openIndex packages/core/src/db.ts#migrateV3ToV4 packages/core/src/db.ts#migrationsFor packages/core/src/db.ts#postV3Migrations -->

`openIndex` opens a `better-sqlite3` connection at the given path. `migrateV3ToV4` is a JS function (not raw SQL) because the v4 columns (`finished_at`, `started_by`, `summary_json`) are conditional on the current `PRAGMA table_info(batch_runs)`; it also creates the supporting indexes. `migrationsFor(fromVersion, toVersion)` returns the ordered list of SQL strings and JS migration functions to apply when upgrading across that range. `postV3Migrations` applies any v4+ migrations after the v3 SQL has been run.

## diagrams.ts — deterministic Mermaid generation

<!-- lw:anchors packages/core/src/diagrams.ts#moduleSlug packages/core/src/diagrams.ts#generateStructure packages/core/src/diagrams.ts#generateModulesGraph packages/core/src/diagrams.ts#generateClassDiagram -->

`moduleSlug` produces a lowercase, accent-folded, dash-separated slug. `generateStructure` emits a Mermaid `graph TD` over the directory tree implied by the file paths. `generateModulesGraph` emits a Mermaid `graph LR` over the `(from, to)` import edges, with a single fallback `root` node if the edge list is empty. `generateClassDiagram` emits a Mermaid `classDiagram` for one module's classes and their methods, keyed by `(path, className)` identity to disambiguate same-named classes in different files.

## diagrams.ts — Mermaid helpers

<!-- lw:anchors packages/core/src/diagrams.ts#classIdentity packages/core/src/diagrams.ts#mermaidId packages/core/src/diagrams.ts#mermaidMemberName packages/core/src/diagrams.ts#escapeLabel -->

`classIdentity` is the stable `(path, className)` key used to group methods with their owning class. `mermaidId` is the ID sanitizer (non-alphanumerics → `_`). `mermaidMemberName` sanitizes method names while preserving `.` and `_`, defaulting to `"method"` for empty input. `escapeLabel` XML-escapes `&`, `"`, `[`, `]` for use in Mermaid `["..."]` labels.

## frontmatter.ts — parse entry and error

<!-- lw:anchors packages/core/src/frontmatter.ts#FrontmatterParseError packages/core/src/frontmatter.ts#FrontmatterParseError.constructor packages/core/src/frontmatter.ts#parseFrontmatter packages/core/src/frontmatter.ts#parseYamlBlock packages/core/src/frontmatter.ts#stripComment -->

`FrontmatterParseError` (constructor takes `message: string` and `line: number`) is the typed error thrown by the parser; the message is prefixed with the offending line. `parseFrontmatter` returns `frontmatter`, `body`, and `bodyOffset`. A source that does not start with `---\n` is not an error — it returns `frontmatter: null`. `parseYamlBlock` implements the YAML subset: top-level `key: value` strings, lists of strings, and `#` comments (handled by `stripComment`, which strips ` #` outside of strings). Unknown line shapes throw `FrontmatterParseError`.

## frontmatter.ts — frontmatter helpers

<!-- lw:anchors packages/core/src/frontmatter.ts#getAnchors packages/core/src/frontmatter.ts#getOwner -->

`getAnchors` returns the `anchors` field as a `string[]` (empty array when missing or not a list). `getOwner` returns `"generated" | "human" | "mixed"`, defaulting to `"generated"` when the field is missing or has an unexpected value.

## gitignore.ts — public API

<!-- lw:anchors packages/core/src/gitignore.ts#readGitignore packages/core/src/gitignore.ts#ensureGitignoreEntries -->

`readGitignore` returns the contents of the repo's `.gitignore`, or `""` if it does not exist. `ensureGitignoreEntries(repoRoot, entries)` ensures every entry is present inside the managed `# livewiki:start` / `# livewiki:end` block; returns `{ file, changed, added }`. It is idempotent and never duplicates or removes user-added entries.

## gitignore.ts — managed-block primitives

<!-- lw:anchors packages/core/src/gitignore.ts#extractManagedBlock packages/core/src/gitignore.ts#mergeBlockLines packages/core/src/gitignore.ts#renderBlock packages/core/src/gitignore.ts#replaceManagedBlock -->

`extractManagedBlock` parses the `# livewiki:start` / `# livewiki:end` block (tolerant of whitespace), returning its trimmed non-empty lines or `null` if absent or truncated. `mergeBlockLines` unions the existing block lines with new entries, preserving existing order and deduping case-sensitively after trim. `renderBlock` emits the canonical `# livewiki:start` / lines / `# livewiki:end` text. `replaceManagedBlock` swaps the block in place (preserving user content around it) or appends a new block with a separator if none exists.

## hashes.ts — SHA-256 helpers

<!-- lw:anchors packages/core/src/hashes.ts#sha256 packages/core/src/hashes.ts#sha256Slice -->

`sha256(content)` returns the lowercase hex SHA-256 of a string or `Uint8Array` (no salt — fingerprints, not authentication). `sha256Slice(source, startByte, endByte)` hashes the `startByte..endByte` slice of `source`; used to fingerprint a single symbol's body for incremental index updates.