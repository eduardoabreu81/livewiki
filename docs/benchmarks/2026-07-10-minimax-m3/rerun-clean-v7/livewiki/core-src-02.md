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

Manages `.livewiki/config.json` — the repo-local livewiki config (provider, model, languages, ignores, language, optional `preset`, `baseUrl`, `pricing`, `thinking`, `timeoutMs`, `maxRepairAttempts`, `stage4MaxOutputTokens`, `maxModuleFiles`, `maxModuleSymbols`). **API keys never live here**; they are read from `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` env vars only (covered by `key-leak.test.ts`). No hardcoded model default — if `provider` or `model` are missing when the LLM batch runs, `validateConfigForBatch` throws `MissingProviderConfigError`.

- `MAX_TIMEOUT_MS` is the signed 32-bit Node `setTimeout` cap (2_147_483_647). `assertValidTimeoutMs` rejects non-integers, NaN, strings, or out-of-range values.
- `CONFIG_PATH` is the relative path constant; `CONFIG_FILENAME` is derived via `nodePath.basename`. `CONFIG_DEFAULTS` carries the safe defaults applied by `applyDefaults` (notably `language: "en"`).
- `loadConfig` reads and `validateConfigShape`-checks the JSON. `saveConfig` writes through safe-io with allowlist enforcement.
- `resolveProviderFromConfig` resolves legacy `provider`/`baseUrl` fields against the Phase-5 preset table; `resolveBaseUrl` returns the effective base URL (preset → override).
- `MissingProviderConfigError` stores `repoRoot` + `missingFields: Array<"provider" | "model">` and emits a message pointing at `.livewiki/config.json` (its `.message` is verified not to leak API keys by the canary test).

## SQLite index (`db.ts`)
<!-- lw:anchors packages/core/src/db.ts#CURRENT_SCHEMA_VERSION packages/core/src/db.ts#SCHEMA_VERSION_KEY packages/core/src/db.ts#SCHEMA_SQL packages/core/src/db.ts#MIGRATION_SQL_V3 packages/core/src/db.ts#migrateV3ToV4 packages/core/src/db.ts#migrationsFor packages/core/src/db.ts#postV3Migrations packages/core/src/db.ts#openIndex -->

Idempotent SQLite schema for the cached index at `<repoRoot>/.livewiki/index.db`. The DB is derived — markdown on disk is the truth; rebuilding is a matter of re-running `index`.

- `CURRENT_SCHEMA_VERSION = 4`; `SCHEMA_VERSION_KEY` is the meta row key storing it.
- `SCHEMA_SQL` creates `files`, `symbols` (with the partial-unique `idx_symbols_active_key` so soft-deletes don't collide), `meta`, `anchors`, `debt` (with partial `idx_debt_open`), `undocumented`, `batch_runs`, `batch_tasks`, `doc_pages`, `manual_blocks`.
- `MIGRATION_SQL_V3` ships the v2→v3 additions (debt.symbol_key + open-debt partial index). `migrateV3ToV4` runs that script on demand.
- `migrationsFor` selects the SQL needed to bring an older DB up to `CURRENT_SCHEMA_VERSION`. `postV3Migrations` runs anything required after the v3 SQL is applied.
- `openIndex(dbPath)` opens the DB, runs `SCHEMA_SQL`, and returns the handle. Path resolution goes through safe-io (allowlist + symlink check).

## Deterministic Mermaid (`diagrams.ts`)
<!-- lw:anchors packages/core/src/diagrams.ts#moduleSlug packages/core/src/diagrams.ts#generateStructure packages/core/src/diagrams.ts#generateModulesGraph packages/core/src/diagrams.ts#generateClassDiagram packages/core/src/diagrams.ts#mermaidId packages/core/src/diagrams.ts#escapeLabel -->

LLM-free diagram generators. Outputs are `owner: generated` and never enter debt — they are rewritten every `init` / `index`. No call-graphs or sequence diagrams (out of scope).

- `moduleSlug` normalizes any string into a lowercase, alphanumeric + hyphen filename slug (NFD normalize, strip diacritics, collapse non-alnum to `-`, trim leading/trailing `-`).
- `generateStructure(filePaths)` emits `structure.mmd` as `graph TD` with one node per path segment chained to its parent.
- `generateModulesGraph(edges)` emits `modules.mmd` as `graph LR` from `ModuleGraphEdge[]` (falls back to a single `root[...]` node when no edges exist).
- `generateClassDiagram(module, symbols)` emits `diagrams/<slug>.classes.mmd` as a `classDiagram` for `kind === "class"` rows under the module; associated `kind === "method"` rows become method signatures. Returns `""` when no classes are present (no empty file).
- `mermaidId` strips non-alphanumerics into underscores; `escapeLabel` escapes `"`, `[`, `]` so labels survive Mermaid parsing.

## Frontmatter parser (`frontmatter.ts`)
<!-- lw:anchors packages/core/src/frontmatter.ts#parseFrontmatter packages/core/src/frontmatter.ts#parseYamlBlock packages/core/src/frontmatter.ts#stripComment packages/core/src/frontmatter.ts#getAnchors packages/core/src/frontmatter.ts#getOwner packages/core/src/frontmatter.ts#FrontmatterParseError packages/core/src/frontmatter.ts#FrontmatterParseError.constructor -->

YAML-subset parser for wiki frontmatter — top-level keys, string values, lists of strings, `# comments`. No nested maps/lists, no multiline scalars, no typed booleans/nulls.

- `parseFrontmatter(source)` returns `{ frontmatter, body, bodyOffset }`. Pages without a leading `---\n` get `frontmatter: null` (not an error).
- `parseYamlBlock` walks lines, handling `key: value` and `key:` (opens a string list); `stripComment` drops ` #…` comments outside strings. `FrontmatterParseError` records `line` for diagnostics.
- `getAnchors(fm | null)` returns `fm["anchors"]` as `string[]` (empty when missing or non-array).
- `getOwner(fm | null)` resolves the `owner` field — `"generated" | "human" | "mixed"`.

## `.gitignore` manager (`gitignore.ts`)
<!-- lw:anchors packages/core/src/gitignore.ts#readGitignore packages/core/src/gitignore.ts#ensureGitignoreEntries packages/core/src/gitignore.ts#extractManagedBlock packages/core/src/gitignore.ts#mergeBlockLines packages/core/src/gitignore.ts#renderBlock packages/core/src/gitignore.ts#replaceManagedBlock -->

Idempotent writer for `.gitignore` entries inside a parser-stable managed block (`# livewiki:start` … `# livewiki:end`). Required by SPEC rule #3 (the DB is derived, must not be committed).

- `readGitignore(repoRoot)` returns the file contents or `""` when absent.
- `ensureGitignoreEntries(repoRoot, entries)` adds missing entries inside the managed block; never duplicates, never deletes user lines, appends when no block exists, rewrites only the block when present.
- `extractManagedBlock` parses `# livewiki:start` / `# livewiki:end` markers (tolerant of whitespace). `mergeBlockLines` preserves existing order, appending new entries uniquely. `renderBlock` outputs the block; `replaceManagedBlock` swaps it in place.

## Hashing (`hashes.ts`)
<!-- lw:anchors packages/core/src/hashes.ts#sha256 packages/core/src/hashes.ts#sha256Slice -->

Thin wrapper over Node's `crypto.createHash("sha256")`. Always lower-case hex, 64 chars. No salt — fingerprints, not authentication.

- `sha256(content)` hashes a string or `Uint8Array`.
- `sha256Slice(source, startByte, endByte)` hashes a byte range (used for symbol-level change detection without re-parsing the whole file).

## Import extraction (`imports.ts`)
<!-- lw:anchors packages/core/src/imports.ts#collectImports packages/core/src/imports.ts#extractImportsFromTree -->

Deterministic, tree-sitter-based import extractor for TypeScript / JavaScript / Python. Output is a flat `ExtractedImport[]`; path resolution to file slugs happens later in `modules.ts`.

- `extractImportsFromTree(tree, lang)` walks the AST and yields `ts-import`, `ts-export`, `py-import`, `py-from` entries. `py-from` carries the imported `names` list.
- `collectImports(relPath, content)` parses with the cached `initParser()` and returns the same array (graceful `[]` on parse failure). Dynamic imports (`require()` with a variable, `import()` of an expression) are **not** resolved — they fall out of the graph as unknown.

## Indexer (`indexer.ts`)
<!-- lw:anchors packages/core/src/indexer.ts#run packages/core/src/indexer.ts#ensureLivewikiDir packages/core/src/indexer.ts#orchestrateIndex packages/core/src/indexer.ts#formatHuman -->

The `livewiki index` orchestrator: walk → read → hash → parse → extract → upsert. Incremental: files with an unchanged `content_hash` are skipped (read + hash only); removed files mark their symbols `status='deleted'`. Targets: 50k LOC < 30s cold, < 2s incremental — everything in one atomic SQLite transaction.

- `run(repoRoot, opts)` is the public entry; `IndexResult` reports added/updated/deleted/unchanged file + symbol counts and `durationMs`.
- `ensureLivewikiDir` creates `.livewiki/` via safe-io and (in non-quiet mode) prints a one-line note when `livewiki/` is also missing, nudging users toward `init`.
- `orchestrateIndex` is the internal pipeline — it splits I/O (read + parse) outside the SQLite transaction to avoid blocking on `await`, then upserts inside it.
- `formatHuman(result)` renders the `IndexResult` as a single-line CLI summary.

## Init (`init.ts`)
<!-- lw:anchors packages/core/src/init.ts#runInit packages/core/src/init.ts#buildPlan packages/core/src/init.ts#generateQuickstartDeterministic packages/core/src/init.ts#generateArchitectureOverview packages/core/src/init.ts#regenerateArchitectureOverview packages/core/src/init.ts#escapeHtmlId -->

The `livewiki init` entry — produces the deterministic layout (`livewiki/quickstart.md`, `livewiki/architecture/structure.mmd`, `modules.mmd`, `livewiki/diagrams/<slug>.classes.mmd`, `livewiki/.manifest.json`) without touching LLM APIs unless `--batch` is passed.

- `runInit(opts)` creates directories via safe-io, ensures `.livewiki/` is gitignored, runs `index` + the anchor ledger, then branches on `--plan` (report-only, no writes, no LLM) or full generation (with optional `--batch` LLM run).
- `buildPlan` heuristically identifies modules, resolves `ModuleGraphEdge`s, prioritizes, splits oversized modules, asserts the path partition + unique IDs, and returns `{ symbols, filePaths, modules, edges, ordered, totalSymbols, totalFiles }`.
- `generateQuickstartDeterministic` writes the low-token entry-point page.
- `generateArchitectureOverview` produces the architecture overview file; `regenerateArchitectureOverview` re-runs it (e.g., after index-driven changes).
- `escapeHtmlId` sanitizes strings for use as HTML anchor `id` attributes.

## Test helpers (`key-leak.test.ts`, `manifest.test.ts`)
<!-- lw:anchors packages/core/src/key-leak.test.ts#assertCanaryNotPresent packages/core/src/manifest.test.ts#writeLivewikiFile -->

Reusable helpers inside the test files.

- `assertCanaryNotPresent(value, context)` (from `key-leak.test.ts`) throws if the `KEY-LEAK-CANARY-DONOTUSE-7f3a` canary appears anywhere — used to assert API keys never leak into error messages, logs, JSON-serialized checkpoints/configs, or `MissingProviderConfigError` text.
- `writeLivewikiFile(relPath, content)` (from `manifest.test.ts`) is a small `mkdir -p` + `writeFile` helper that scopes writes under the per-test tmp `repoRoot`.

## Manifest (`manifest.ts`)
<!-- lw:anchors packages/core/src/manifest.ts#MANIFEST_VERSION packages/core/src/manifest.ts#MANIFEST_REL_PATH packages/core/src/manifest.ts#readManifest packages/core/src/manifest.ts#computeSnapshotHash packages/core/src/manifest.ts#listFiles packages/core/src/manifest.ts#writeManifestIfChanged packages/core/src/manifest.ts#buildManifest packages/core/src/manifest.ts#manifestsEqual packages/core/src/manifest.ts#pendingBatchEqual -->

Versioned `livewiki/.manifest.json` writer. Powers cross-machine handoff (`batch resume`) and the anti-loop CI property that keeps `git diff` clean.

- `MANIFEST_VERSION = 1`; `MANIFEST_REL_PATH = "livewiki/.manifest.json"`.
- `LivewikiManifest` shape: `version`, `lastDocumentedCommit`, `snapshotHash`, `updatedAt` (ISO 8601), `pendingBatch: PendingBatchRef | null`.
- `readManifest` returns `null` on missing/corrupt file (tolerant, CI-friendly — only `version` and `snapshotHash` are validated).
- `computeSnapshotHash` walks `livewiki/` recursively, **excludes the manifest itself from the hash**, sorts file paths alphabetically for determinism, and produces a sha256 over `relpath\n<sha256(content)>\n` per file.
- `listFiles` is the recursive directory walker backing `computeSnapshotHash`.
- `buildManifest(args)` constructs the object from `lastDocumentedCommit`, `snapshotHash`, and `pendingBatch`.
- `writeManifestIfChanged` writes via safe-io only when content actually differs — `manifestsEqual` compares version, snapshotHash, lastDocumentedCommit, and `pendingBatch` via `pendingBatchEqual` (ignoring `updatedAt` to avoid write-every-call loops). Returns `true` when it wrote, `false` when already current.