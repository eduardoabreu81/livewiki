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

## Batch entry points

<!-- lw:anchors packages/core/src/batch.ts#runBatch packages/core/src/batch.ts#resumeBatch packages/core/src/batch.ts#runOnly packages/core/src/batch.ts#orchestrate packages/core/src/batch.ts#statusToExitCode -->

The `batch.ts` module orchestrates the four-stage documentation pipeline: scan, module identification, prioritization, and coordinated LLM documentation. Three top-level entry points delegate to a shared `orchestrate` worker tagged with a `mode` of `"run"`, `"resume"`, or `"only"`.

`runBatch` kicks off a fresh end-to-end run. `resumeBatch` continues the most recent interrupted run, picking up tasks still in `pending`/`failed`. `runOnly` re-runs a single task identified by module id or run id; it increments `attempt`, accumulates usage, and refuses pages whose frontmatter declares `owner: human`. All three return a `BatchRunResult` describing run id, status (`completed`, `completed_with_failures`, `aborted`), totals, per-module usage, failure list with retry commands, and whether the circuit breaker triggered.

`orchestrate` is the internal worker; it loads the SQLite index, resolves `BatchOptions` against config (`maxRepairAttempts`, `maxIncompleteRetries`, `stage4MaxOutputTokens`, split thresholds, thinking mode, language), constructs the LLM client when needed, then runs the stage loop. `statusToExitCode` converts a terminal `BatchRunResult.status` into a process exit code so the CLI can distinguish clean completion from partial failure.

## Batch errors and task lifecycle

<!-- lw:anchors packages/core/src/batch.ts#EmptyPipelineError packages/core/src/batch.ts#EmptyPipelineError.constructor packages/core/src/batch.ts#TaskError packages/core/src/batch.ts#TaskError.constructor packages/core/src/batch.ts#safeJsonParse packages/core/src/batch.ts#getOrCreateTask packages/core/src/batch.ts#createOrGetTask packages/core/src/batch.ts#emptyUsage packages/core/src/batch.ts#aggregateTotals packages/core/src/batch.ts#accumulateUsage -->

`EmptyPipelineError` is thrown when `orchestrate` is asked to operate on a pipeline with no tasks (e.g. `--only` against a run with nothing pending). Its constructor takes the human-readable message.

`TaskError` is an internal carrier for per-task failures: its constructor stores a short `code` (e.g. `"llm_timeout"`, `"verify_failed"`) plus a `message`. Errors propagate into the checkpoint, mark the task `failed`, and the run continues unless the circuit breaker trips (three consecutive failures or >50% task failure rate).

`safeJsonParse` wraps `JSON.parse` and returns `null` instead of throwing when the payload is malformed, used when consuming LLM outputs that may produce unparseable text. `getOrCreateTask` and `createOrGetTask` manage idempotent task row creation in `batch_tasks` keyed by `(runId, stage, target)`; either reuses an existing row or inserts a new one.

`emptyUsage`, `aggregateTotals`, and `accumulateUsage` track `StageUsage` totals (prompt tokens, completion tokens, cached tokens, cost). `emptyUsage` returns a zeroed struct; `aggregateTotals` sums two `StageUsage` values; `accumulateUsage` adds a `UsageAttempt` into the running per-module/per-run totals. These three are the only writers of the cost column in the final summary.

## Module selection and refinement

<!-- lw:anchors packages/core/src/batch.ts#validateRefinedModules packages/core/src/batch.ts#collectAllImports packages/core/src/batch.ts#readOwnerFromFrontmatter packages/core/src/batch.ts#forceOwnerInFrontmatter packages/core/src/batch.ts#extractManualBlocksBySection packages/core/src/batch.ts#injectManualBlocksBySection packages/core/src/batch.ts#slugifyHeadingText packages/core/src/batch.ts#sectionRangeOf packages/core/src/batch.ts#buildModuleDocContext packages/core/src/batch.ts#buildFairTruncatedSource packages/core/src/batch.ts#getFileIdsForModule -->

`validateRefinedModules` runs after stage-2 LLM refinement to enforce invariants: globally unique module ids before the first write, exact path partition (no overlap, no gaps), and bounded sizes. It surfaces `DuplicateModuleIdError` and `ExactPartitionError` from `modules.ts` with batch-specific context.

`collectAllImports` gathers cross-module `import` edges from the index to feed `resolveModuleEdges` and priority scoring. `readOwnerFromFrontmatter` and `forceOwnerInFrontmatter` read and rewrite the YAML frontmatter `owner` field on existing wiki pages; `forceOwnerInFrontmatter` is what `--only` uses to refuse or coerce `owner: human` content.

`extractManualBlocksBySection` and `injectManualBlocksBySection` are the round-trip pair for `lw:manual` regions. They slice existing pages by heading, return a `Map<section, string[]>` of byte ranges, and re-inject preserved blocks into the freshly generated content so human edits survive a re-run. `slugifyHeadingText` produces the same anchor slug format used elsewhere in the wiki, and `sectionRangeOf` computes the byte range for a single heading. Together these satisfy rule #6: `lw:manual` regions are preserved byte-for-byte.

`buildModuleDocContext` and `buildFairTruncatedSource` assemble the prompt payload for stage 4. `buildModuleDocContext` reads source files, joins their symbols, and produces the structured context object. `buildFairTruncatedSource` enforces the per-module character budget (default 60,000) by truncating proportionally across the module's files so no single file is starved. `getFileIdsForModule` maps a `Module` (set of paths) to the `files.id` rows used by the context builder.

## Stage 4 generation and repair

<!-- lw:anchors packages/core/src/batch.ts#tryWriteAndVerify packages/core/src/batch.ts#verifyIssuesToValidationErrors packages/core/src/batch.ts#summarizeLlmDiagnosticError packages/core/src/batch.ts#summarizeVerifyDiagnosticErrors packages/core/src/batch.ts#diagnosticAttempt packages/core/src/batch.ts#attemptStage4Generation packages/core/src/batch.ts#computeCostFromUsage -->

Stage 4 is a normalized artifact workflow: produce, validate, repair if structural errors, then write atomically. `attemptStage4Generation` is the bounded loop: initial call + up to `maxRepairAttempts` repair calls, each fed by `buildRepairPrompt` from the validator's errors. Non-consuming retries for incomplete (normalized but missing-required-fields) responses are tracked separately via `maxIncompleteRetries`.

`diagnosticAttempt` runs a single LLM call against a task's context and returns a `DiagnosticOutcome` (artifact, usage, error summary, stop reason). It calls `summarizeLlmDiagnosticError` on transport-level failures and `summarizeVerifyDiagnosticErrors` once `validateStage4Artifact` returns issues. The two summarizers cap error lists at `DIAGNOSTIC_MAX_ERRORS` and trim messages at `DIAGNOSTIC_TEXT_CAP` so a blown context window doesn't recurse.

`tryWriteAndVerify` performs the transactional write: snapshot → write → run `verify.ts` → on failure, restore the snapshot and remove the partial page. `verifyIssuesToValidationErrors` translates `VerifyIssue` rows into `ArtifactValidationError` entries the prompt builder can echo back to the LLM. `computeCostFromUsage` multiplies `StageUsage` token counts by `lookupPricing(config.pricing)` to produce USD cents for the summary.

## Run finalization

<!-- lw:anchors packages/core/src/batch.ts#finalizeRun packages/core/src/batch.ts#buildResult -->

`finalizeRun` is called once the per-task loop exits: it stamps `finished_at` and `summary_json` on `batch_runs` via `migrateV3ToV4`'s v4 columns, writes the manifest through `writeManifestIfChanged` (skippable via `BatchOptions.skipManifestWrite`), and regenerates the architecture overview if any task wrote. `buildResult` assembles the final `BatchRunResult` from the in-memory accumulator: totals, per-module breakdown, failure list with retry commands, and circuit-breaker boolean.

## Config module

<!-- lw:anchors packages/core/src/config.ts#MAX_TIMEOUT_MS packages/core/src/config.ts#assertValidTimeoutMs packages/core/src/config.ts#CONFIG_DEFAULTS packages/core/src/config.ts#MissingProviderConfigError packages/core/src/config.ts#MissingProviderConfigError.constructor packages/core/src/config.ts#loadConfig packages/core/src/config.ts#resolveProviderFromConfig packages/core/src/config.ts#saveConfig packages/core/src/config.ts#applyDefaults packages/core/src/config.ts#validateConfigForBatch packages/core/src/config.ts#resolveBaseUrl packages/core/src/config.ts#validateConfigShape packages/core/src/config.ts#CONFIG_PATH packages/core/src/config.ts#CONFIG_FILENAME -->

`config.ts` owns `.livewiki/config.json`: load, save, validate, defaults, and provider resolution.

`MAX_TIMEOUT_MS` is the signed 32-bit ceiling (`2_147_483_647`) for `setTimeout`. `assertValidTimeoutMs` enforces that `timeoutMs` is a non-negative integer in `[0, MAX_TIMEOUT_MS]`; anything else throws. The validator is shared between config load and the programmatic `createLlmClient` path.

`CONFIG_DEFAULTS` is the runtime-only default object: `language: "en"`, `languages: ["ts","tsx","js","jsx","py"]`, per-provider `baseUrls`, `maxRepairAttempts: 2`, `maxIncompleteRetries: 2`, `stage4MaxOutputTokens: 8192`, split thresholds (12 files / 80 symbols), and `timeoutMs: 300_000`. `applyDefaults` merges these into a `LivewikiConfig` without mutating the input.

`MissingProviderConfigError` is thrown when the batch needs an LLM but config lacks `provider` or `model`. Its constructor takes the repo root and the missing field list; the message points to `.livewiki/config.json` and shows an example block (`"claude-sonnet-5"`) — explicitly labeled example only, never a silent fallback.

`loadConfig` reads `.livewiki/config.json` if present, returns `{}` if missing or empty, and fails closed on JSON parse errors. `saveConfig` is the inverse; both go through `safe-io` to validate the path stays inside `repoRoot`. `validateConfigShape` rejects floats, NaN, strings, or negatives for the integer fields (`maxRepairAttempts`, `maxIncompleteRetries`, `timeoutMs`, `maxModuleFiles`, `maxModuleSymbols`).

`resolveProviderFromConfig` expands the `preset` (Fase 5 step 5) into concrete adapter fields, then merges any explicit `provider` / `baseUrl` / `pricing` overrides. `resolveBaseUrl` returns `config.baseUrl` if set, else the per-provider default from `CONFIG_DEFAULTS.baseUrls`. `validateConfigForBatch` is the gate called by `orchestrate` before constructing an LLM client: it ensures provider/model are present and raises `MissingProviderConfigError` otherwise.

`CONFIG_PATH` and `CONFIG_FILENAME` are derived from the internal `CONFIG_REL_PATH = ".livewiki/config.json"` constant via `nodePath`.

## SQLite schema and migrations

<!-- lw:anchors packages/core/src/db.ts#CURRENT_SCHEMA_VERSION packages/core/src/db.ts#SCHEMA_VERSION_KEY packages/core/src/db.ts#SCHEMA_SQL packages/core/src/db.ts#MIGRATION_SQL_V3 packages/core/src/db.ts#migrateV3ToV4 packages/core/src/db.ts#migrationsFor packages/core/src/db.ts#openIndex packages/core/src/db.ts#postV3Migrations -->

`db.ts` defines the SQLite index: schema, migration ladder, and the `openIndex` factory.

`CURRENT_SCHEMA_VERSION` is `4`. `SCHEMA_VERSION_KEY` is the meta-row key (`"schema_version"`) used to track the on-disk version. `SCHEMA_SQL` is the idempotent `CREATE TABLE IF NOT EXISTS` block: `files`, `symbols` (with the partial unique index `idx_symbols_active_key WHERE status='active'` so soft-deletes don't block re-insert), `meta`, `anchors`, `debt` (with the partial index `idx_debt_open WHERE resolved_at IS NULL`), `undocumented`, `batch_runs`, `batch_tasks`, `doc_pages`, and `manual_blocks`.

`MIGRATION_SQL_V3` is the v2→v3 string: adds `debt.symbol_key`, recreates `symbols` without the inline UNIQUE, and installs the partial indexes. `migrateV3ToV4` is the v3→v4 step (Fase 3 audit columns): adds `batch_runs.finished_at`, `started_by`, `summary_json` using `PRAGMA table_info` checks because SQLite lacks `ADD COLUMN IF NOT EXISTS`. It also creates `idx_batch_runs_status` and the `batch_tasks` lookup indexes.

`migrationsFor(fromVersion, toVersion)` returns the ordered list of SQL strings or `(db) => void` callbacks to apply. `postV3Migrations` is the v4-only fast path for databases already at v4 (used when `SCHEMA_SQL` runs on a fresh DB). `openIndex(dbPath)` opens the SQLite file, asserts the resulting version matches `CURRENT_SCHEMA_VERSION`, runs any pending migrations from `migrationsFor`, and returns the live `Database.Database` handle.

## Mermaid diagram generation

<!-- lw:anchors packages/core/src/diagrams.ts#moduleSlug packages/core/src/diagrams.ts#generateStructure packages/core/src/diagrams.ts#generateModulesGraph packages/core/src/diagrams.ts#generateClassDiagram packages/core/src/diagrams.ts#classIdentity packages/core/src/diagrams.ts#mermaidId packages/core/src/diagrams.ts#mermaidMemberName packages/core/src/diagrams.ts#escapeLabel -->

`diagrams.ts` produces deterministic Mermaid source for three diagram kinds. No LLM is involved.

`moduleSlug` lowercases the input, strips diacritics via NFD normalization, collapses non-alphanumerics into `-`, and trims leading/trailing dashes. It's the filesystem-safe name used for `livewiki/diagrams/<module-slug>.classes.mmd`.

`generateStructure(filePaths)` emits a `graph TD` directory tree: each path segment becomes a node, parent → child edges are deduplicated by `(parent, child)` pairs. `generateModulesGraph(edges)` emits a `graph LR` import-edge view with a synthetic `root[No module edges detected]` node when the edge list is empty.

`generateClassDiagram(module, symbols)` filters `symbols` to classes whose path is in `module.paths`, then groups methods by `classIdentity(path, className)` — a JSON-encoded `(path, className)` tuple so two classes with the same display name in different files get distinct `class_N` Mermaid ids. Methods are sorted by key and emitted as `+name()` members inside the class block.

The three internal helpers handle Mermaid syntax safety: `mermaidId` replaces every non-alphanumeric with `_`, `mermaidMemberName` keeps `[A-Za-z0-9_.]` and falls back to `"method"` for empty results, and `escapeLabel` HTML-escapes `&`, `"`, `[`, `]` so labels render correctly inside `[...]` syntax.

## Frontmatter parsing

<!-- lw:anchors packages/core/src/frontmatter.ts#FrontmatterParseError packages/core/src/frontmatter.ts#FrontmatterParseError.constructor packages/core/src/frontmatter.ts#parseFrontmatter packages/core/src/frontmatter.ts#parseYamlBlock packages/core/src/frontmatter.ts#stripComment packages/core/src/frontmatter.ts#getAnchors packages/core/src/frontmatter.ts#getOwner -->

`frontmatter.ts` is a YAML-subset parser tuned for the wiki's needs (top-level keys, string lists, `#` comments, no nested maps, no multi-line strings).

`FrontmatterParseError` carries the 1-based line number where the error occurred; its constructor formats the message as `Frontmatter parse error (line N): …`.

`parseFrontmatter(source)` normalizes line endings to `\n`, returns `frontmatter: null` when the file doesn't start with `---\n`, throws `FrontmatterParseError` when the closing `---` is missing, otherwise slices the YAML block and hands it to `parseYamlBlock`. It returns `{ frontmatter, body, bodyOffset }`.

`parseYamlBlock` walks the YAML lines: items indented as `- value` extend the current list, `key: value` sets a string, `key:` (empty value) opens a new list. `stripComment` removes a ` # …` suffix outside of strings (the parser does not handle `#` inside strings — use quotes).

`getAnchors` reads the `anchors` field and returns it as `string[]`, defaulting to `[]` when missing or non-array. `getOwner` returns `"generated" | "human" | "mixed"`, defaulting to `"generated"` for missing or unknown values.

## Gitignore management

<!-- lw:anchors packages/core/src/gitignore.ts#readGitignore packages/core/src/gitignore.ts#ensureGitignoreEntries packages/core/src/gitignore.ts#extractManagedBlock packages/core/src/gitignore.ts#mergeBlockLines packages/core/src/gitignore.ts#renderBlock packages/core/src/gitignore.ts#replaceManagedBlock -->

`gitignore.ts` keeps `.livewiki/` out of version control without ever removing user-written entries.

`readGitignore(repoRoot)` returns the file contents or `""` when the file is missing.

`ensureGitignoreEntries(repoRoot, entries)` is the public entry point. It reads the current `.gitignore`, locates the managed block, and computes the set of missing entries (case-sensitive, after trim). If nothing is missing it returns `{ changed: false, added: [] }`. Otherwise it merges the new entries into the block, rewrites the file, and returns `{ changed: true, added }`. The block is delimited by `# livewiki:start` and `# livewiki:end` so future updates can target only that range.

`extractManagedBlock` returns `{ lines }` or `null` for the lines between the start/end markers (tolerant of whitespace around the marker text). `mergeBlockLines` preserves existing order and appends new entries that aren't already present (case-sensitive trim match). `renderBlock` joins the lines into the final block text. `replaceManagedBlock` substitutes the managed range in-place, or appends the block at end-of-file when no block exists.

## Hash utilities

<!-- lw:anchors packages/core/src/hashes.ts#sha256 packages/core/src/hashes.ts#sha256Slice -->

`hashes.ts` exposes a single primitive: SHA-256 over text or bytes, always hex-lowercase, 64 chars, unsalted.

`sha256(content)` accepts `string | Uint8Array` and returns the hex digest. `sha256Slice(source, startByte, endByte)` slices a string and delegates to `sha256`. The slice variant is used by the indexer to fingerprint a single symbol's source range, so a change inside one symbol updates that symbol's `content_hash` without recomputing the file's hash.