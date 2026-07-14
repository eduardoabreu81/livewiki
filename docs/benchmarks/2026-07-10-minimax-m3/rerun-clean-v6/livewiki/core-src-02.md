---
title: core-src-02 — Configuration, persistence, indexing and wiki generation
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
  - packages/core/src/diagrams.ts#escapeLabel
  - packages/core/src/diagrams.ts#generateClassDiagram
  - packages/core/src/diagrams.ts#generateModulesGraph
  - packages/core/src/diagrams.ts#generateStructure
  - packages/core/src/diagrams.ts#mermaidId
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
  - packages/core/src/imports.ts#collectImports
  - packages/core/src/imports.ts#extractImportsFromTree
  - packages/core/src/indexer.ts#ensureLivewikiDir
  - packages/core/src/indexer.ts#formatHuman
  - packages/core/src/indexer.ts#orchestrateIndex
  - packages/core/src/indexer.ts#run
  - packages/core/src/init.ts#buildPlan
  - packages/core/src/init.ts#escapeHtmlId
  - packages/core/src/init.ts#generateArchitectureOverview
  - packages/core/src/init.ts#generateQuickstartDeterministic
  - packages/core/src/init.ts#regenerateArchitectureOverview
  - packages/core/src/init.ts#runInit
  - packages/core/src/key-leak.test.ts#assertCanaryNotPresent
  - packages/core/src/manifest.test.ts#writeLivewikiFile
  - packages/core/src/manifest.ts#MANIFEST_REL_PATH
  - packages/core/src/manifest.ts#MANIFEST_VERSION
  - packages/core/src/manifest.ts#buildManifest
  - packages/core/src/manifest.ts#computeSnapshotHash
  - packages/core/src/manifest.ts#listFiles
  - packages/core/src/manifest.ts#manifestsEqual
  - packages/core/src/manifest.ts#pendingBatchEqual
  - packages/core/src/manifest.ts#readManifest
  - packages/core/src/manifest.ts#writeManifestIfChanged
---

## Configuration (`config.ts`)
<!-- lw:anchors packages/core/src/config.ts#CONFIG_DEFAULTS packages/core/src/config.ts#CONFIG_FILENAME packages/core/src/config.ts#CONFIG_PATH packages/core/src/config.ts#MAX_TIMEOUT_MS packages/core/src/config.ts#MissingProviderConfigError packages/core/src/config.ts#MissingProviderConfigError.constructor packages/core/src/config.ts#applyDefaults packages/core/src/config.ts#assertValidTimeoutMs packages/core/src/config.ts#loadConfig packages/core/src/config.ts#resolveBaseUrl packages/core/src/config.ts#resolveProviderFromConfig packages/core/src/config.ts#saveConfig packages/core/src/config.ts#validateConfigForBatch packages/core/src/config.ts#validateConfigShape -->

`config.ts` manages `.livewiki/config.json`, the local per-repo configuration file. It exposes path constants (`CONFIG_FILENAME`, `CONFIG_PATH`) and a defaults block (`CONFIG_DEFAULTS`) for the schema, and a hard cap (`MAX_TIMEOUT_MS = 2_147_483_647`) for the Node `setTimeout` ceiling.

`loadConfig` reads and parses the JSON file via `safeIo`; `saveConfig` writes it back. `applyDefaults` fills in derived fields when omitted, and `validateConfigShape` rejects malformed inputs (e.g. non-integer `timeoutMs`). `assertValidTimeoutMs` enforces integer-in-range as a type predicate. `resolveProviderFromConfig` and `resolveBaseUrl` translate the optional `preset` into concrete adapter configuration. `validateConfigForBatch` runs before any LLM call and throws `MissingProviderConfigError` if `provider` or `model` is missing (without a hardcoded default, per SPEC commit 3894f6e). The `MissingProviderConfigError` constructor takes `repoRoot` and the list of missing fields.

API keys never live in this file — they are pulled from `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` env vars only, enforced by `key-leak.test.ts`.

## SQLite index (`db.ts`)
<!-- lw:anchors packages/core/src/db.ts#CURRENT_SCHEMA_VERSION packages/core/src/db.ts#MIGRATION_SQL_V3 packages/core/src/db.ts#SCHEMA_SQL packages/core/src/db.ts#SCHEMA_VERSION_KEY packages/core/src/db.ts#migrateV3ToV4 packages/core/src/db.ts#migrationsFor packages/core/src/db.ts#openIndex packages/core/src/db.ts#postV3Migrations -->

The `.livewiki/index.db` schema is defined by an idempotent `SCHEMA_SQL` constant (`files`, `symbols`, `meta`, `anchors`, `debt`, `undocumented`, `batch_runs`, `batch_tasks`, `doc_pages`, `manual_blocks`). Current schema version is `CURRENT_SCHEMA_VERSION = 4` (keyed by `SCHEMA_VERSION_KEY = "schema_version"`). v3 added `debt.symbol_key` and a partial index `idx_debt_open`; v4 added batch-run accounting columns.

`openIndex` opens the database file under `<repoRoot>/.livewiki/index.db`. `migrationsFor` returns the migration steps to apply; `migrateV3ToV4` runs the v3→v4 SQL; `postV3Migrations` performs follow-up data backfills. The DB is purely derived — deleting `.livewiki/` lets a reindex rebuild it from the markdown source.

## Mermaid diagrams (`diagrams.ts`)
<!-- lw:anchors packages/core/src/diagrams.ts#escapeLabel packages/core/src/diagrams.ts#generateClassDiagram packages/core/src/diagrams.ts#generateModulesGraph packages/core/src/diagrams.ts#generateStructure packages/core/src/diagrams.ts#mermaidId packages/core/src/diagrams.ts#moduleSlug -->

Deterministic Mermaid generation (no LLM). `moduleSlug` lowercases, strips accents and non-alphanumerics into hyphen-separated filesystem-safe names. `mermaidId` and `escapeLabel` sanitize strings for use as node identifiers and quoted labels respectively.

Three renderers:
- `generateStructure` → `livewiki/architecture/structure.mmd` (`graph TD` org-chart of directory paths).
- `generateModulesGraph` → `livewiki/architecture/modules.mmd` (`graph LR` of import edges).
- `generateClassDiagram` → `livewiki/diagrams/<slug>.classes.mmd` (`classDiagram` with methods per module). Returns empty string if the module has no classes (no file written in that case).

All three are regenerated each `livewiki init` / `livewiki index`. They are `owner: generated` and never enter debt.

## Frontmatter parser (`frontmatter.ts`)
<!-- lw:anchors packages/core/src/frontmatter.ts#FrontmatterParseError packages/core/src/frontmatter.ts#FrontmatterParseError.constructor packages/core/src/frontmatter.ts#getAnchors packages/core/src/frontmatter.ts#getOwner packages/core/src/frontmatter.ts#parseFrontmatter packages/core/src/frontmatter.ts#parseYamlBlock packages/core/src/frontmatter.ts#stripComment -->

Subset-YAML parser used for wiki page frontmatter (covers strings and list-of-strings; no nesting, no multi-line, no rich types — see in-file comments for the exact dialect). `parseFrontmatter` splits the opening `---\n` block, locates the closing `\n---`, and returns `{ frontmatter, body, bodyOffset }`. `parseYamlBlock` walks the inner lines, handling `key: value` and `key:`-then-list forms. `stripComment` removes bare `# …` comments outside strings. `FrontmatterParseError` carries the offending line number; its `constructor(message, line)` produces a formatted message.

Helpers `getAnchors` and `getOwner` extract the `anchors` array (always a list) and the `owner` field (`"generated" | "human" | "mixed"`, defaulting to `"generated"`).

## `.gitignore` writer (`gitignore.ts`)
<!-- lw:anchors packages/core/src/gitignore.ts#ensureGitignoreEntries packages/core/src/gitignore.ts#extractManagedBlock packages/core/src/gitignore.ts#mergeBlockLines packages/core/src/gitignore.ts#readGitignore packages/core/src/gitignore.ts#renderBlock packages/core/src/gitignore.ts#replaceManagedBlock -->

Idempotent `.gitignore` writer used by `livewiki init` to keep `.livewiki/` out of git (SPEC "DB is derived"). `readGitignore` returns the file content (or `""` if missing). `ensureGitignoreEntries` adds the requested entries inside a managed block delimited by `# livewiki:start` / `# livewiki:end`; it never duplicates and never removes user entries.

The managed block is parsed by `extractManagedBlock`; line merging happens in `mergeBlockLines` (existing order preserved, new entries appended, dedup by trimmed string). `renderBlock` produces the block text and `replaceManagedBlock` rewrites only that region of the file. Returns `{ file, changed, added }`.

## Hashing (`hashes.ts`)
<!-- lw:anchors packages/core/src/hashes.ts#sha256 packages/core/src/hashes.ts#sha256Slice -->

Thin wrappers over `node:crypto`. `sha256(content)` returns lowercase hex digest (no salt — content fingerprint, not authentication). `sha256Slice(source, startByte, endByte)` hashes a byte range of a file, used by the indexer to detect intra-file symbol changes without reparsing.

## Import extraction (`imports.ts`)
<!-- lw:anchors packages/core/src/imports.ts#collectImports packages/core/src/imports.ts#extractImportsFromTree -->

Tree-sitter-based import extraction (no path resolution — that happens later in `modules.ts`). `extractImportsFromTree(tree, lang)` walks the tree and produces `ExtractedImport` records covering TypeScript/JavaScript `import`/`export` statements and Python `import`/`from … import`. Records expose `source` (literal string), `kind`, and `names` for Python `from` imports.

`collectImports(relPath, content)` is the high-level helper: it lazily initializes the parser, parses the source by extension (`.ts` / `.js` / `.py`), and returns the imports — or `[]` if the file fails to parse (graceful degradation).

## Indexer (`indexer.ts`)
<!-- lw:anchors packages/core/src/indexer.ts#ensureLivewikiDir packages/core/src/indexer.ts#formatHuman packages/core/src/indexer.ts#orchestrateIndex packages/core/src/indexer.ts#run -->

Phase-1 indexer: walk → read → hash → parse → upsert, all inside one SQLite transaction. `run(repoRoot, opts?)` is the public entry — it ensures `.livewiki/` exists, resolves the DB path via `safeIo`, walks the repo (respecting `.gitignore` and `extraIgnores`), opens the DB and delegates to `orchestrateIndex`. Incremental: files matching prior `content_hash` are skipped (no reparse). `formatHuman(result)` renders an `IndexResult` as a human-readable summary.

`ensureLivewikiDir(absRoot, quiet)` creates the cache directory silently and, in non-quiet mode, prints an informational note when `livewiki/` is also missing (suggesting `livewiki init`). `orchestrateIndex` performs the two-phase plan (async I/O outside the transaction, DB writes inside).

## Init / layout generation (`init.ts`)
<!-- lw:anchors packages/core/src/init.ts#buildPlan packages/core/src/init.ts#escapeHtmlId packages/core/src/init.ts#generateArchitectureOverview packages/core/src/init.ts#generateQuickstartDeterministic packages/core/src/init.ts#regenerateArchitectureOverview packages/core/src/init.ts#runInit -->

`runInit(opts)` is the entry point for `livewiki init`. Without `--batch` it runs the deterministic layout only (no LLM): ensure `.livewiki/` + `livewiki/` + subdirs, write `.gitignore` entry, run the indexer + ledger, load symbols/modules, then render `quickstart.md`, the architecture overview, and the Mermaid diagrams. `--plan` skips writes and returns an `InitPlanReport`; `--batch` continues into the LLM pipeline (optional `--no-refine` skips the stage-2 refine call).

`buildPlan(absRoot)` produces the module heuristic plan (modules, edges, ordering, totals). `generateQuickstartDeterministic` and `generateArchitectureOverview` (with `regenerateArchitectureOverview` for re-runs) compose the markdown overview pages. `escapeHtmlId` produces HTML-id-safe slugs for anchors.

## Manifest (`manifest.ts`)
<!-- lw:anchors packages/core/src/manifest.ts#MANIFEST_REL_PATH packages/core/src/manifest.ts#MANIFEST_VERSION packages/core/src/manifest.ts#buildManifest packages/core/src/manifest.ts#computeSnapshotHash packages/core/src/manifest.ts#listFiles packages/core/src/manifest.ts#manifestsEqual packages/core/src/manifest.ts#pendingBatchEqual packages/core/src/manifest.ts#readManifest packages/core/src/manifest.ts#writeManifestIfChanged -->

Versioned `livewiki/.manifest.json` (`MANIFEST_REL_PATH`, `MANIFEST_VERSION = 1`) that carries `lastDocumentedCommit`, `snapshotHash`, `updatedAt`, and an optional `pendingBatch` for cross-machine handoff of interrupted LLM runs.

`readManifest` returns the parsed manifest or `null` (tolerant of missing or corrupted JSON). `computeSnapshotHash` walks `livewiki/` recursively, sorts entries alphabetically, sha256s each file's content, and hashes the concatenation — *excluding* the manifest itself so self-references don't loop. `listFiles` is the recursive directory walker. `writeManifestIfChanged` writes only when `manifestsEqual` shows a real content change (ignoring `updatedAt`, since otherwise every call would dirty `git diff`). `pendingBatchEqual` compares the optional pending-batch refs. `buildManifest` constructs an in-memory manifest from the given commit, snapshot hash and pending batch.

## Tests
<!-- lw:anchors packages/core/src/key-leak.test.ts#assertCanaryNotPresent packages/core/src/manifest.test.ts#writeLivewikiFile -->

`key-leak.test.ts` regression: API keys must never appear in any output. `assertCanaryNotPresent(value, context)` is the shared assertion helper that throws if the canary string leaks into the tested value. Covers `MissingApiKeyError`, `MissingProviderConfigError`, `LlmRequestError`, and JSON written by `saveConfig`.

`manifest.test.ts` covers `computeSnapshotHash`, `readManifest`, and `writeManifestIfChanged`. `writeLivewikiFile(relPath, content)` is the test-side filesystem helper: it creates parent dirs and writes the file under the temp `repoRoot`.
