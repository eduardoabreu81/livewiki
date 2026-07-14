---
title: core-src-02
owner: generated
anchors:
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
---

# core-src-02

Reference documentation for the core `packages/core/src` module: configuration
loading and persistence, SQLite index schema and migrations, deterministic
Mermaid diagram generation, frontmatter parsing, `.gitignore` management,
content hashing, import extraction, the indexer orchestrator, and `init`
entry point.

## Configuration

<!-- lw:anchors packages/core/src/config.ts#CONFIG_DEFAULTS packages/core/src/config.ts#CONFIG_FILENAME packages/core/src/config.ts#CONFIG_PATH packages/core/src/config.ts#MAX_TIMEOUT_MS packages/core/src/config.ts#MissingProviderConfigError packages/core/src/config.ts#MissingProviderConfigError.constructor packages/core/src/config.ts#applyDefaults packages/core/src/config.ts#assertValidTimeoutMs packages/core/src/config.ts#loadConfig packages/core/src/config.ts#resolveBaseUrl packages/core/src/config.ts#resolveProviderFromConfig packages/core/src/config.ts#saveConfig packages/core/src/config.ts#validateConfigForBatch packages/core/src/config.ts#validateConfigShape -->

`config.ts` owns `.livewiki/config.json` (the per-repo config). It defines
the `LivewikiConfig` shape (provider, model, preset, language, baseUrl,
pricing, languages, ignores, maxRepairAttempts, stage4MaxOutputTokens,
maxModuleFiles, maxModuleSymbols, thinking, timeoutMs) and is deliberately
absent of API keys — those live only in env vars (`ANTHROPIC_API_KEY`,
`OPENAI_API_KEY`), enforced by `key-leak.test.ts`.

- `CONFIG_FILENAME` — basename of the config file.
- `CONFIG_PATH` — full relative path (alias of `CONFIG_REL_PATH`).
- `CONFIG_DEFAULTS` — default config values.
- `MAX_TIMEOUT_MS` — `2_147_483_647`, the signed 32-bit ms safe max for
  Node's `setTimeout`.
- `applyDefaults(config)` — fills in defaults on a parsed config.
- `assertValidTimeoutMs(v)` — asserts `v` is an integer in `[0, MAX_TIMEOUT_MS]`.
- `loadConfig(repoRoot)` — async read of `.livewiki/config.json`.
- `saveConfig(...)` — async write back to disk via safe-io.
- `validateConfigShape(parsed)` — internal shape validator.
- `validateConfigForBatch(repoRoot, config)` — pre-flight check; throws
  `MissingProviderConfigError` if `provider` or `model` is missing when an
  LLM batch is about to run.
- `resolveProviderFromConfig(...)` / `resolveBaseUrl(config)` — derive the
  active provider adapter and base URL, honoring preset overrides.
- `MissingProviderConfigError` (class) and its `constructor(repoRoot, missingFields)`
  produce a user-facing message that points at `.livewiki/config.json` without
  leaking credentials.

## SQLite Index

<!-- lw:anchors packages/core/src/db.ts#CURRENT_SCHEMA_VERSION packages/core/src/db.ts#MIGRATION_SQL_V3 packages/core/src/db.ts#SCHEMA_SQL packages/core/src/db.ts#SCHEMA_VERSION_KEY packages/core/src/db.ts#migrateV3ToV4 packages/core/src/db.ts#migrationsFor packages/core/src/db.ts#openIndex packages/core/src/db.ts#postV3Migrations -->

`db.ts` defines the SQLite schema and the migration chain for
`<repoRoot>/.livewiki/index.db`. The DB is derived cache; deleting
`.livewiki/` lets `reindex` rebuild from source.

- `SCHEMA_VERSION_KEY` — `"schema_version"` meta key.
- `CURRENT_SCHEMA_VERSION` — `4`.
- `SCHEMA_SQL` — idempotent DDL covering `files`, `symbols`, `meta`,
  `anchors`, `debt`, `undocumented`, `batch_runs`, `batch_tasks`,
  `doc_pages`, `manual_blocks` and their indexes (including the partial
  `idx_symbols_active_key` and `idx_debt_open`).
- `MIGRATION_SQL_V3` — DDL applied for v2 → v3 (adds `debt.symbol_key`).
- `migrateV3ToV4(db)` — v3 → v4 migration.
- `migrationsFor(fromVersion, db)` — returns the migration steps to apply.
- `postV3Migrations(...)` — bookkeeping after v3+ migrations.
- `openIndex(dbPath)` — opens the DB and ensures schema is at
  `CURRENT_SCHEMA_VERSION`.

## Deterministic Diagrams

<!-- lw:anchors packages/core/src/diagrams.ts#escapeLabel packages/core/src/diagrams.ts#generateClassDiagram packages/core/src/diagrams.ts#generateModulesGraph packages/core/src/diagrams.ts#generateStructure packages/core/src/diagrams.ts#mermaidId packages/core/src/diagrams.ts#moduleSlug -->

`diagrams.ts` produces Mermaid output without LLM involvement. All artifacts
emit `owner: generated` and are regenerated on every `livewiki index` /
`livewiki init`.

- `moduleSlug(s)` — lowercase, diacritics-stripped, alnum + hyphen slug.
- `generateStructure(filePaths)` — `livewiki/architecture/structure.mmd`
  (Mermaid `graph TD` of the directory tree).
- `generateModulesGraph(edges)` — `livewiki/architecture/modules.mmd`
  (Mermaid `graph LR` of module imports).
- `generateClassDiagram(module, symbols)` —
  `livewiki/diagrams/<slug>.classes.mmd` (Mermaid `classDiagram` per module
  that contains classes; returns empty string when no classes).
- `mermaidId(s)` — internal: strips non-alnum to produce valid Mermaid node IDs.
- `escapeLabel(s)` — internal: escapes quotes and brackets for Mermaid labels.

## Frontmatter Parser

<!-- lw:anchors packages/core/src/frontmatter.ts#FrontmatterParseError packages/core/src/frontmatter.ts#FrontmatterParseError.constructor packages/core/src/frontmatter.ts#getAnchors packages/core/src/frontmatter.ts#getOwner packages/core/src/frontmatter.ts#parseFrontmatter packages/core/src/frontmatter.ts#parseYamlBlock packages/core/src/frontmatter.ts#stripComment -->

`frontmatter.ts` is a hand-rolled YAML subset parser tailored to the
frontmatter shape used by wiki pages. It supports top-level string keys and
lists of strings, with `#` comments; richer YAML features are out of scope.

- `parseFrontmatter(source)` — splits a markdown file into frontmatter + body
  (returns `frontmatter: null` when no leading `---`).
- `parseYamlBlock(yaml)` — internal: turns the YAML text into a
  `Frontmatter` record.
- `stripComment(s)` — internal: trims an inline `# ...` comment.
- `getAnchors(fm)` — returns the `anchors` list (always `string[]`).
- `getOwner(fm)` — returns `"generated" | "human" | "mixed"` (default
  `generated`).
- `FrontmatterParseError` (class) and its `constructor(message, line)`
  attach the offending line number for diagnostics.

## `.gitignore` Management

<!-- lw:anchors packages/core/src/gitignore.ts#ensureGitignoreEntries packages/core/src/gitignore.ts#extractManagedBlock packages/core/src/gitignore.ts#mergeBlockLines packages/core/src/gitignore.ts#readGitignore packages/core/src/gitignore.ts#renderBlock packages/core/src/gitignore.ts#replaceManagedBlock -->

`gitignore.ts` keeps `.livewiki/` out of version control (SPEC rule #3) by
maintaining a managed block delimited by `# livewiki:start` / `# livewiki:end`
inside the repo's `.gitignore`. Operations are idempotent and never remove
user-added entries.

- `readGitignore(repoRoot)` — returns file contents (empty string if absent).
- `ensureGitignoreEntries(repoRoot, entries)` — adds missing entries inside
  the managed block, returns `{ file, changed, added }`.
- `extractManagedBlock(content)` — internal: parses the managed block (null
  if absent or truncated).
- `mergeBlockLines(existing, toAdd)` — internal: dedup merge (existing first).
- `renderBlock(lines)` — internal: serializes the block with markers.
- `replaceManagedBlock(content, newBlock)` — internal: substitutes only the
  managed region, preserving surrounding user content.

## Hashing

<!-- lw:anchors packages/core/src/hashes.ts#sha256 packages/core/src/hashes.ts#sha256Slice -->

`hashes.ts` provides content fingerprints used by the indexer.

- `sha256(content)` — hex sha256 (lowercase, 64 chars) for `string | Uint8Array`.
- `sha256Slice(source, startByte, endByte)` — sha256 over a byte range, used
  for per-symbol change detection without re-reading the whole file.

## Import Extraction

<!-- lw:anchors packages/core/src/imports.ts#collectImports packages/core/src/imports.ts#extractImportsFromTree -->

`imports.ts` walks the tree-sitter AST to surface import strings.

- `extractImportsFromTree(tree, lang)` — pure parse: returns
  `ExtractedImport[]` for `ts-import`, `ts-export`, `py-import`, `py-from`.
- `collectImports(relPath, content)` — initializes the parser and calls
  `extractImportsFromTree`; returns `[]` for unparseable files (graceful
  degradation).

## Indexer Orchestrator

<!-- lw:anchors packages/core/src/indexer.ts#ensureLivewikiDir packages/core/src/indexer.ts#formatHuman packages/core/src/indexer.ts#orchestrateIndex packages/core/src/indexer.ts#run -->

`indexer.ts` drives walk → read → hash → parse → extract → upsert into the
SQLite index. Incremental: unchanged files are skipped via `content_hash`.

- `run(repoRoot, opts)` — top-level entry point, returns `IndexResult`.
- `ensureLivewikiDir(absRoot, quiet)` — creates `.livewiki/` and emits an
  informational note when `livewiki/` is also absent (suppressed in quiet
  mode).
- `orchestrateIndex(db, repoRoot, walked, startedAt)` — internal: does the
  I/O phase outside the SQLite transaction, then upserts inside one.
- `formatHuman(result)` — renders an `IndexResult` as a CLI-friendly string.

## Init Pipeline

<!-- lw:anchors packages/core/src/init.ts#buildPlan packages/core/src/init.ts#escapeHtmlId packages/core/src/init.ts#generateArchitectureOverview packages/core/src/init.ts#generateQuickstartDeterministic packages/core/src/init.ts#regenerateArchitectureOverview packages/core/src/init.ts#runInit -->

`init.ts` is `livewiki init`. Without `--batch` it produces the deterministic
layout (no LLM). With `--batch` it then runs the 4-stage pipeline.

- `runInit(opts)` — entry point; returns `InitResult` with `filesWritten`,
  optional `plan` (for `--plan`) and `batchSummary` (for `--batch`).
- `buildPlan(absRoot)` — internal: indexes, runs the anchor ledger, and
  derives the module plan.
- `generateQuickstartDeterministic(...)` — internal: writes
  `livewiki/quickstart.md`.
- `generateArchitectureOverview(opts)` — internal: writes the architecture
  overview page.
- `regenerateArchitectureOverview(repoRoot)` — public re-generation hook.
- `escapeHtmlId(s)` — internal: produces HTML-safe id fragments.

## Manifest

<!-- lw:anchors packages/core/src/manifest.ts#MANIFEST_REL_PATH packages/core/src/manifest.ts#MANIFEST_VERSION packages/core/src/manifest.ts#buildManifest packages/core/src/manifest.ts#computeSnapshotHash packages/core/src/manifest.ts#listFiles packages/core/src/manifest.ts#manifestsEqual packages/core/src/manifest.ts#pendingBatchEqual packages/core/src/manifest.ts#readManifest packages/core/src/manifest.ts#writeManifestIfChanged -->

`manifest.ts` writes `livewiki/.manifest.json` (versioned, the cross-machine
handoff artifact). `snapshotHash` excludes the manifest itself so writes are
idempotent and CI `git diff` stays clean.

- `MANIFEST_VERSION` — schema version, currently `1`.
- `MANIFEST_REL_PATH` — `"livewiki/.manifest.json"`.
- `readManifest(repoRoot)` — returns the manifest or `null` if missing /
  corrupt (tolerant).
- `computeSnapshotHash(repoRoot)` — deterministic sha256 over `livewiki/`
  contents (excluding the manifest).
- `listFiles(dir)` — internal: stack-based recursive directory walk.
- `buildManifest(args)` — constructs a `LivewikiManifest`.
- `writeManifestIfChanged(repoRoot, manifest)` — writes only if changed;
  returns `true` on write.
- `manifestsEqual(a, b)` — internal: compares `version`, `snapshotHash`,
  `lastDocumentedCommit`, and `pendingBatch` (ignores `updatedAt` so the
  file is not rewritten every commit).
- `pendingBatchEqual(a, b)` — internal: structural compare of
  `PendingBatchRef | null`.

## Regression Tests

<!-- lw:anchors packages/core/src/key-leak.test.ts#assertCanaryNotPresent packages/core/src/manifest.test.ts#writeLivewikiFile -->

Test-only helpers referenced by suite bodies.

- `assertCanaryNotPresent(value, context)` — fails the test if the
  `KEY-LEAK-CANARY-DONOTUSE-7f3a` string appears in `value`. Used by
  `key-leak.test.ts` to prove that API keys never appear in errors, logs,
  `checkpoint_json`, `config.json`, or `summary_json`.
- `writeLivewikiFile(relPath, content)` — `manifest.test.ts` helper that
  creates `livewiki/<relPath>` and writes `content` deterministically.