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
  - packages/core/src/init.ts#selectImportantSymbols
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

## config — repo config load/save and validation
<!-- lw:anchors packages/core/src/config.ts#CONFIG_DEFAULTS packages/core/src/config.ts#CONFIG_FILENAME packages/core/src/config.ts#CONFIG_PATH packages/core/src/config.ts#MAX_TIMEOUT_MS packages/core/src/config.ts#MissingProviderConfigError packages/core/src/config.ts#MissingProviderConfigError.constructor packages/core/src/config.ts#applyDefaults packages/core/src/config.ts#assertValidTimeoutMs packages/core/src/config.ts#loadConfig packages/core/src/config.ts#resolveBaseUrl packages/core/src/config.ts#resolveProviderFromConfig packages/core/src/config.ts#saveConfig packages/core/src/config.ts#validateConfigForBatch packages/core/src/config.ts#validateConfigShape -->

`packages/core/src/config.ts` reads and writes the per-repo `.livewiki/config.json`, applying defaults, validating shape, and resolving provider/preset configuration.

`MAX_TIMEOUT_MS` is the signed-32-bit ms ceiling accepted by Node's `setTimeout` (2_147_483_647). `CONFIG_FILENAME` exposes the basename of the config path and `CONFIG_PATH` re-exports the relative path constant. `CONFIG_DEFAULTS` provides the documented default object applied when fields are absent.

`assertValidTimeoutMs` is a type-guard assertion: it narrows its argument to `number` and throws on values outside the supported range. `validateConfigShape` parses an unknown JSON value into a `LivewikiConfig`, rejecting structurally invalid input (negatives, NaN, floats for integer fields, etc.). `applyDefaults` returns a fully populated config by overlaying user fields onto `CONFIG_DEFAULTS`. `resolveBaseUrl` returns the effective base URL given a config (preset-derived or explicit `baseUrl`).

`loadConfig` reads `.livewiki/config.json` from the repo root, validates the parsed value, and applies defaults. `saveConfig` writes a config back through safe I/O. `resolveProviderFromConfig` resolves the effective provider configuration (preset expansion, base URL, env var, pricing) given a `LivewikiConfig`. `validateConfigForBatch` is called before any LLM-driven stage: it enforces that `provider` and `model` are set; if not, it throws `MissingProviderConfigError`.

`MissingProviderConfigError` extends `Error` and its constructor takes the repo root plus a list of missing fields (`"provider"` and/or `"model"`). The error message points the user at `.livewiki/config.json`.

## db — SQLite schema, migrations, and openIndex
<!-- lw:anchors packages/core/src/db.ts#CURRENT_SCHEMA_VERSION packages/core/src/db.ts#MIGRATION_SQL_V3 packages/core/src/db.ts#SCHEMA_SQL packages/core/src/db.ts#SCHEMA_VERSION_KEY packages/core/src/db.ts#migrateV3ToV4 packages/core/src/db.ts#migrationsFor packages/core/src/db.ts#openIndex packages/core/src/db.ts#postV3Migrations -->

`packages/core/src/db.ts` defines the SQLite schema and migration helpers used as the livewiki index cache. The database is treated as derived data; the markdown in the repo remains the source of truth.

`CURRENT_SCHEMA_VERSION` is the integer version this build expects (`4`). `SCHEMA_VERSION_KEY` is the `meta` key under which the current version is persisted (`"schema_version"`). `SCHEMA_SQL` is the idempotent DDL bundle (CREATE TABLE / CREATE INDEX statements) for `files`, `symbols`, `meta`, `anchors`, `debt`, `undocumented`, `batch_runs`, `batch_tasks`, `doc_pages`, and `manual_blocks`. The unique index on `symbols.key` is partial over `status = 'active'` so soft-deleted rows do not block re-insert. `MIGRATION_SQL_V3` contains the SQL applied to migrate v3 → v4.

`openIndex(dbPath)` opens a `better-sqlite3` database at the given path and applies `SCHEMA_SQL` plus any pending migrations. `migrationsFor(fromVersion, toVersion)` returns the ordered list of migrations to run between two schema versions. `postV3Migrations` is the set of migrations that may be applied after the v3 baseline. `migrateV3ToV4(db)` performs the v3 → v4 migration in place on the open database.

## diagrams — deterministic Mermaid emitters
<!-- lw:anchors packages/core/src/diagrams.ts#classIdentity packages/core/src/diagrams.ts#escapeLabel packages/core/src/diagrams.ts#generateClassDiagram packages/core/src/diagrams.ts#generateModulesGraph packages/core/src/diagrams.ts#generateStructure packages/core/src/diagrams.ts#mermaidId packages/core/src/diagrams.ts#mermaidMemberName packages/core/src/diagrams.ts#moduleSlug -->

`packages/core/src/diagrams.ts` produces Mermaid sources without invoking the LLM. Output is written under `livewiki/architecture/` and `livewiki/diagrams/`.

`moduleSlug(value)` lowercases, normalizes, strips diacritics, and collapses non-alphanumeric runs into a filesystem-safe slug. `generateStructure(filePaths)` emits a `graph TD` of directory nodes and parent→child edges derived from a list of file paths. `generateModulesGraph(edges)` emits a `graph LR` over `ModuleGraphEdge` records, with edge deduplication. `generateClassDiagram(module, symbols)` emits a `classDiagram` listing each class (filtered to `module.paths`) and its methods, grouping methods by `(path, className)` so identical class names in different files stay distinct.

`classIdentity(path, className)` is the JSON-stringified `(path, className)` pair used as the method-bucket key. `mermaidId(value)` replaces non-alphanumeric characters with `_` to make IDs that Mermaid accepts. `mermaidMemberName(value)` sanitizes a member name, falling back to `"method"` when the result is empty. `escapeLabel(value)` HTML-escapes characters that conflict with Mermaid's `["..."]` label syntax.

## frontmatter — YAML-subset parser and helpers
<!-- lw:anchors packages/core/src/frontmatter.ts#FrontmatterParseError packages/core/src/frontmatter.ts#FrontmatterParseError.constructor packages/core/src/frontmatter.ts#getAnchors packages/core/src/frontmatter.ts#getOwner packages/core/src/frontmatter.ts#parseFrontmatter packages/core/src/frontmatter.ts#parseYamlBlock packages/core/src/frontmatter.ts#stripComment -->

`packages/core/src/frontmatter.ts` parses the limited YAML subset used in wiki pages (top-level keys, string values, lists of strings, `#` comments). The subset is intentionally narrow so the implementation can avoid an extra dependency.

`FrontmatterParseError` extends `Error`; its constructor takes a message and a 1-based line number and stores it on `.line`. `parseFrontmatter(source)` returns a `ParseResult` containing the parsed map (or `null` when the input does not start with `---\n`), the body after the closing fence, and the byte offset where the body begins. `parseYamlBlock(yaml)` walks the lines of a YAML block, building the output object and tracking the active list key for `"- value"` items. `stripComment(s)` removes a trailing `# ...` comment fragment outside of strings.

`getAnchors(fm)` reads `anchors` from a frontmatter map and returns an empty array when missing or scalar. `getOwner(fm)` reads `owner` and returns one of `"generated"`, `"human"`, or `"mixed"`.

## gitignore — idempotent managed block writer
<!-- lw:anchors packages/core/src/gitignore.ts#ensureGitignoreEntries packages/core/src/gitignore.ts#extractManagedBlock packages/core/src/gitignore.ts#mergeBlockLines packages/core/src/gitignore.ts#readGitignore packages/core/src/gitignore.ts#renderBlock packages/core/src/gitignore.ts#replaceManagedBlock -->

`packages/core/src/gitignore.ts` ensures that the target repo's `.gitignore` contains entries such as `.livewiki/`, wrapped in a stable, parser-friendly managed block. The writer is idempotent: it never duplicates an entry and never removes user-authored lines outside the block.

`readGitignore(repoRoot)` returns the file contents, or an empty string when it does not exist. `ensureGitignoreEntries(repoRoot, entries)` is the public entry point: it computes the missing entries against the current contents (or against the full file when no managed block is present) and writes only the changes, returning `{ file, changed, added }`. `extractManagedBlock(content)` locates the `# livewiki:start` / `# livewiki:end` block and returns its trimmed lines or `null`. `mergeBlockLines(existing, toAdd)` returns a new array with new entries appended, preserving order and de-duplicating by trimmed membership. `renderBlock(lines)` emits the managed block as a string. `replaceManagedBlock(content, newBlock)` substitutes the old block in `content` (appending if absent).

## hashes — content hashing primitives
<!-- lw:anchors packages/core/src/hashes.ts#sha256 packages/core/src/hashes.ts#sha256Slice -->

`packages/core/src/hashes.ts` exposes SHA-256 helpers over `string` or `Uint8Array`. `sha256(content)` returns the lowercase hex digest. `sha256Slice(source, startByte, endByte)` is a convenience that hashes `source.slice(startByte, endByte)`, used by the indexer to fingerprint a symbol's text range.

## imports — tree-sitter import extraction
<!-- lw:anchors packages/core/src/imports.ts#collectImports packages/core/src/imports.ts#extractImportsFromTree -->

`packages/core/src/imports.ts` walks a `web-tree-sitter` `Tree` to extract import specifiers. `extractImportsFromTree(tree, lang)` returns `ExtractedImport[]` covering TypeScript/JavaScript `import_statement` and re-exporting `export_statement`, plus Python `import_statement` and `import_from_statement` (with `names` for `from`-style). Source strings are stripped of surrounding quotes where present.

`collectImports(relPath, content)` initializes the parser once, parses the source by extension, and forwards to `extractImportsFromTree`. Files that fail to parse return an empty list for graceful degradation.

## indexer — incremental index orchestration
<!-- lw:anchors packages/core/src/indexer.ts#ensureLivewikiDir packages/core/src/indexer.ts#formatHuman packages/core/src/indexer.ts#orchestrateIndex packages/core/src/indexer.ts#run -->

`packages/core/src/indexer.ts` coordinates walking the repo, reading files, hashing content, parsing with tree-sitter, extracting symbols, and upserting into SQLite — all inside an atomic transaction.

`run(repoRoot, opts)` is the public entry point. It ensures `.livewiki/` exists, resolves the DB path through safe I/O, walks the repo (respecting `.gitignore` plus optional `extraIgnores`), opens the index, and delegates to `orchestrateIndex`. It supports `{ quiet }` to suppress informational notes (used by hooks). `ensureLivewikiDir(absRoot, quiet)` creates the directory when missing and, in non-quiet mode, prints a hint to run `livewiki init` when the wiki itself is also absent. `orchestrateIndex(db, repoRoot, walked, startedAt)` performs the index: it loads the existing file map, skips files whose `content_hash` matches the prior record, and otherwise reads, parses, extracts symbols, and persists changes inside a transaction.

`formatHuman(result)` renders an `IndexResult` as a human-readable summary string suitable for terminal output.

## init — Phase-3 init command and architecture generator
<!-- lw:anchors packages/core/src/init.ts#buildPlan packages/core/src/init.ts#escapeHtmlId packages/core/src/init.ts#generateArchitectureOverview packages/core/src/init.ts#generateQuickstartDeterministic packages/core/src/init.ts#regenerateArchitectureOverview packages/core/src/init.ts#runInit packages/core/src/init.ts#selectImportantSymbols -->

`packages/core/src/init.ts` implements the `livewiki init` command. It creates both `.livewiki/` and `livewiki/`, ensures `.livewiki/` is gitignored, runs the indexer and ledger, then either reports a plan (`--plan`) or generates the deterministic layout (and optionally the full LLM batch with `--batch`).

`runInit(opts)` is the public entry point. It accepts `{ batch, plan, noRefine, language, quiet }` and returns an `InitResult` describing files written plus optional `plan` or `batchSummary` data. `buildPlan(absRoot)` loads indexed symbols, applies path-role config, and computes modules, edges, ordered prioritization, and totals for the deterministic plan output. `selectImportantSymbols` is the picker used by overview generation. `generateQuickstartDeterministic` produces the entry-point quickstart markdown without invoking the LLM. `generateArchitectureOverview(opts)` is the worker behind both initial and regeneration flows; `regenerateArchitectureOverview(repoRoot)` is the public API for re-emitting the overview against an existing index. `escapeHtmlId(s)` sanitizes strings for use as HTML IDs in the generated pages.

## test fixtures — key-leak and manifest helpers
<!-- lw:anchors packages/core/src/key-leak.test.ts#assertCanaryNotPresent packages/core/src/manifest.test.ts#writeLivewikiFile -->

These two helpers are visible only from the test files; they are documented here because their closed keys reference them.

`assertCanaryNotPresent(value, context)` (from `key-leak.test.ts`) throws when the canary string is found anywhere in `value`. It is used to assert that error messages, stacks, JSON-serialized checkpoints, and console output never echo the API key.

`writeLivewikiFile(relPath, content)` (from `manifest.test.ts`) is a test convenience that creates parent directories as needed and writes a file under `repoRoot`. It underpins the manifest snapshot-hash and write-if-changed tests.

## manifest — `.livewiki/.manifest.json` read/write and equality
<!-- lw:anchors packages/core/src/manifest.ts#MANIFEST_REL_PATH packages/core/src/manifest.ts#MANIFEST_VERSION packages/core/src/manifest.ts#buildManifest packages/core/src/manifest.ts#computeSnapshotHash packages/core/src/manifest.ts#listFiles packages/core/src/manifest.ts#manifestsEqual packages/core/src/manifest.ts#pendingBatchEqual packages/core/src/manifest.ts#readManifest packages/core/src/manifest.ts#writeManifestIfChanged -->

`packages/core/src/manifest.ts` owns the per-repo manifest that records the last documented commit, snapshot hash, timestamp, and any pending batch reference. The manifest is the cross-machine handoff vehicle for interrupted batch runs.

`MANIFEST_VERSION` is the schema version literal (`1`) and `MANIFEST_REL_PATH` is `"livewiki/.manifest.json"`. `buildManifest(args)` constructs a `LivewikiManifest` from supplied fields. `readManifest(repoRoot)` reads and parses the manifest, returning `null` on absence or corruption (tolerant for CI). `computeSnapshotHash(repoRoot)` recursively walks `livewiki/`, sorts paths alphabetically, sha256s each file, concatenates `rel\n<hash>\n` segments, and returns the digest of the concatenated buffer — excluding the manifest itself to avoid recursive invalidation. `listFiles(dir)` is the recursive directory walker used by the hash routine. `writeManifestIfChanged(repoRoot, manifest)` writes only when the new manifest differs from the current one (per `manifestsEqual`), enabling a clean `git diff` in CI. `manifestsEqual(a, b)` compares semantic fields and delegates to `pendingBatchEqual(a, b)` for the pending-batch reference, intentionally ignoring `updatedAt` so a re-render with the same content does not rewrite the file.