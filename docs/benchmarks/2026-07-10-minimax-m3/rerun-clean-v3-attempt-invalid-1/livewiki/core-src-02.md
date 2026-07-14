---
title: core-src-02
owner: generated
anchors:
- packages/core/src/config.ts#CONFIG_DEFAULTS
- packages/core/src/config.ts#CONFIG_FILENAME
- packages/core/src/config.ts#CONFIG_PATH
- packages/core/src/config.ts#MissingProviderConfigError
- packages/core/src/config.ts#MissingProviderConfigError.constructor
- packages/core/src/config.ts#applyDefaults
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

## config — `.livewiki/config.json`

<!-- lw:anchors packages/core/src/config.ts#CONFIG_DEFAULTS packages/core/src/config.ts#CONFIG_FILENAME packages/core/src/config.ts#CONFIG_PATH packages/core/src/config.ts#MissingProviderConfigError packages/core/src/config.ts#MissingProviderConfigError.constructor packages/core/src/config.ts#applyDefaults packages/core/src/config.ts#loadConfig packages/core/src/config.ts#resolveBaseUrl packages/core/src/config.ts#resolveProviderFromConfig packages/core/src/config.ts#saveConfig packages/core/src/config.ts#validateConfigForBatch packages/core/src/config.ts#validateConfigShape -->

`config.ts` reads/writes the local repo config at `.livewiki/config.json`. Defaults are applied at runtime, never written to disk. No model default is hardcoded; if `provider` or `model` are missing at batch time, `validateConfigForBatch` throws `MissingProviderConfigError` pointing at the config file. API keys never live here — they stay in `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` env vars.

`CONFIG_PATH` and `CONFIG_FILENAME` re-export the canonical config path and basename for callers. `loadConfig` returns an empty config when the file is missing and fails closed on malformed JSON. `saveConfig` writes through `safe-io`. `applyDefaults` merges `CONFIG_DEFAULTS` (language, languages, maxRepairAttempts, stage4MaxOutputTokens, maxModuleFiles, maxModuleSymbols) into the config without mutating the input. `validateConfigShape` rejects unknown keys and type errors (e.g. non-integer `maxRepairAttempts`, invalid `thinking` enum). `resolveProviderFromConfig` expands `preset` into provider/baseUrl/pricing via `presets.ts`. `resolveBaseUrl` returns `config.baseUrl` when present, else falls back to the preset's base URL, else to the per-provider default.

`MissingProviderConfigError` (and its `constructor`) records `repoRoot` and the missing fields, and embeds an example config snippet that names `claude-sonnet-5` only as an illustration — never as a silent default.

## db — SQLite schema and migrations

<!-- lw:anchors packages/core/src/db.ts#CURRENT_SCHEMA_VERSION packages/core/src/db.ts#MIGRATION_SQL_V3 packages/core/src/db.ts#SCHEMA_SQL packages/core/src/db.ts#SCHEMA_VERSION_KEY packages/core/src/db.ts#migrateV3ToV4 packages/core/src/db.ts#migrationsFor packages/core/src/db.ts#openIndex packages/core/src/db.ts#postV3Migrations -->

`db.ts` manages the local SQLite index at `<repoRoot>/.livewiki/index.db`. `CURRENT_SCHEMA_VERSION` is `4`. `SCHEMA_VERSION_KEY` is the `meta` row key used to track the on-disk version. `SCHEMA_SQL` declares the full schema idempotently (files, symbols with partial-unique index `idx_symbols_active_key`, meta, anchors, debt with `idx_debt_open`, undocumented, batch_runs, batch_tasks, doc_pages, manual_blocks) and can run on fresh or existing DBs.

`MIGRATION_SQL_V3` is the v2→v3 string migration: adds `debt.symbol_key`, rebuilds `symbols` to drop the inline UNIQUE, recreates `idx_symbols_active_key` as a partial unique, and creates `idx_debt_open`. `migrateV3ToV4` (function form) is the v3→v4 migration: idempotently adds `batch_runs.finished_at`, `started_by` (default `'cli'`), and `summary_json`, plus the run-status and task-status indices.

`migrationsFor` returns the string-SQL migrations between two versions; `postV3Migrations` returns the post-v3 function-form migrations. `openIndex` creates the DB (WAL, foreign keys, synchronous=NORMAL), runs `SCHEMA_SQL`, reads `schema_version` from `meta`, applies any pending migrations, and updates the version row on success.

## diagrams — deterministic Mermaid generation

<!-- lw:anchors packages/core/src/diagrams.ts#escapeLabel packages/core/src/diagrams.ts#generateClassDiagram packages/core/src/diagrams.ts#generateModulesGraph packages/core/src/diagrams.ts#generateStructure packages/core/src/diagrams.ts#mermaidId packages/core/src/diagrams.ts#moduleSlug -->

`diagrams.ts` emits `owner: generated` Mermaid files without an LLM. `moduleSlug` lowercases, strips diacritics, and collapses non-alphanumerics into hyphens for safe filenames. `generateStructure` produces `structure.mmd` (`graph TD`) chaining directory segments as parent → child nodes. `generateModulesGraph` produces `modules.mmd` (`graph LR`) over `ModuleGraphEdge[]`, falling back to a `root[No module edges detected]` node when empty.

`generateClassDiagram` emits `diagrams/<slug>.classes.mmd` (`classDiagram`) for a `Module`, listing each class with its methods (using `signature` if present, otherwise `+name()`), and returns `""` when the module has no classes (no file is written in that case). `mermaidId` (private) replaces non-`[a-zA-Z0-9]` with `_`; `escapeLabel` (private) escapes `"`, `[`, `]` for safe Mermaid labels.

## frontmatter — YAML-subset parser

<!-- lw:anchors packages/core/src/frontmatter.ts#FrontmatterParseError packages/core/src/frontmatter.ts#FrontmatterParseError.constructor packages/core/src/frontmatter.ts#getAnchors packages/core/src/frontmatter.ts#getOwner packages/core/src/frontmatter.ts#parseFrontmatter packages/core/src/frontmatter.ts#parseYamlBlock packages/core/src/frontmatter.ts#stripComment -->

`frontmatter.ts` is a deliberate YAML subset parser (top-level keys, string lists, `#` comments) — no nested maps, no multi-line strings, no booleans/null typing, no anchors. `FrontmatterParseError` (and its `constructor`) carries a 1-based `line` and reports position in the message.

`parseFrontmatter` returns `{ frontmatter, body, bodyOffset }`; pages without a leading `---\n` yield `frontmatter: null` (not an error). An opened block without a closing `---` raises `FrontmatterParseError`. `parseYamlBlock` (private) walks lines, collecting `key: value` strings or starting/continuing a string list via `  - value` items. `stripComment` (private) cuts off everything from the first ` #` outside a string. `getAnchors` returns `fm["anchors"]` as `string[]` (empty when missing or non-array). `getOwner` returns `"generated" | "human" | "mixed"`, defaulting to `"generated"` when the field is absent or unrecognized.

## gitignore — idempotent managed block

<!-- lw:anchors packages/core/src/gitignore.ts#ensureGitignoreEntries packages/core/src/gitignore.ts#extractManagedBlock packages/core/src/gitignore.ts#mergeBlockLines packages/core/src/gitignore.ts#readGitignore packages/core/src/gitignore.ts#renderBlock packages/core/src/gitignore.ts#replaceManagedBlock -->

`gitignore.ts` keeps `.livewiki/` and friends untracked per SPEC "Inviolable rules" #3. Entries live inside a managed block delimited by `# livewiki:start` / `# livewiki:end`; user entries outside the block are never touched. `readGitignore` returns `""` when the file is absent.

`ensureGitignoreEntries` reads the file, extracts the existing managed block (or treats non-comment lines as the "target" when none), computes which requested entries are missing (case-sensitive, trimmed), and returns `{ file, changed: false, added: [] }` if none are missing. Otherwise it merges, renders, and writes — creating the file from scratch or appending a block at EOF when no markers exist, or replacing only the block's inner contents when markers do exist. `extractManagedBlock`, `mergeBlockLines`, `renderBlock`, and `replaceManagedBlock` (all private) implement the matching/merging/rendering primitives.

## hashes — content fingerprints

<!-- lw:anchors packages/core/src/hashes.ts#sha256 packages/core/src/hashes.ts#sha256Slice -->

`hashes.ts` exposes two helpers around `node:crypto`. `sha256` returns the lowercase hex digest of either a `string` or `Uint8Array`. `sha256Slice` hashes `source.slice(startByte, endByte)` for per-symbol fingerprints (enabling incremental detection when the whole-file hash is unchanged but a symbol body changed).

## imports — tree-sitter import extraction

<!-- lw:anchors packages/core/src/imports.ts#collectImports packages/core/src/imports.ts#extractImportsFromTree -->

`imports.ts` walks a tree-sitter `Tree` to extract import strings without I/O. It covers TS/JS `import_statement` and `export_statement ... from "..."` and Python `import_statement` (dotted_name) and `import_from_statement` (with named imports). Dynamic `import()` and variable `require()` are not resolved (they surface as "unknown" in the module graph). Path resolution (`./foo` → `src/auth/foo.ts`) happens later in `modules.ts`.

`extractImportsFromTree` is the pure visitor; `collectImports` is the high-level wrapper that initializes the parser, dispatches by extension (`.py` vs others), and degrades gracefully to `[]` on parse failure.

## indexer — incremental orchestration

<!-- lw:anchors packages/core/src/indexer.ts#ensureLivewikiDir packages/core/src/indexer.ts#formatHuman packages/core/src/indexer.ts#orchestrateIndex packages/core/src/indexer.ts#run -->

`indexer.ts` is the entry point for `livewiki index`. `run` resolves the repo, ensures `.livewiki/` exists, revalidates `index.db` via `safe-io`, walks the repo, opens the DB, and delegates to `orchestrateIndex`. Phase A runs I/O and tree-sitter parses outside the transaction; phase B commits a single synchronous transaction containing all writes (atomic, fast).

`ensureLivewikiDir` creates `.livewiki/` and, when `livewiki/` is also missing and `quiet` is false, prints a one-line note suggesting `livewiki init` (suppressed in hook/quiet mode). `orchestrateIndex` compares hashes against the existing `files` map, soft-deletes prior symbols on update (preserving their `content_hash` so the ledger can detect moves), upserts new file/symbol rows, and soft-deletes files that disappeared from the walk. `formatHuman` renders the result with `+`/`~`/`=`/`-` counters and the elapsed milliseconds.

## init — `livewiki init`

<!-- lw:anchors packages/core/src/init.ts#buildPlan packages/core/src/init.ts#escapeHtmlId packages/core/src/init.ts#generateArchitectureOverview packages/core/src/init.ts#generateQuickstartDeterministic packages/core/src/init.ts#regenerateArchitectureOverview packages/core/src/init.ts#runInit -->

`init.ts` implements `livewiki init` (no-LLM by default), `init --plan` (read-only module plan), and `init --batch` (deterministic base + LLM pipeline). `runInit` is the entry point with `InitOptions { repoRoot, batch?, plan?, noRefine?, language?, quiet? }` and returns `InitResult { filesWritten, plan?, batchSummary? }`.

`buildPlan` (private) walks + identifies modules heuristically, resolves edges from imports, prioritizes modules, makes unique deterministic IDs, splits oversized modules by file/symbol counts, and asserts exact path-partition and unique-module-id invariants before returning `{ modules, edges, ordered, totalSymbols, totalFiles }`. `generateQuickstartDeterministic` (private) produces the low-token entry page. `generateArchitectureOverview` / `regenerateArchitectureOverview` produce the architecture overview using diagram generators and `moduleSlug`. `escapeHtmlId` (private) makes HTML-safe anchor IDs.

## tests — key-leak guard and livewiki file writer

<!-- lw:anchors packages/core/src/key-leak.test.ts#assertCanaryNotPresent packages/core/src/manifest.test.ts#writeLivewikiFile -->

`assertCanaryNotPresent` (in `key-leak.test.ts`) is a test helper that throws when a canary string (e.g. an API-key-shaped value) appears in the supplied `value`, scoping the assertion via the `context` label. `writeLivewikiFile` (in `manifest.test.ts`) is a test helper that writes `(relPath, content)` under the livewiki tree for fixture setup.

## manifest — snapshot tracking

<!-- lw:anchors packages/core/src/manifest.ts#MANIFEST_REL_PATH packages/core/src/manifest.ts#MANIFEST_VERSION packages/core/src/manifest.ts#buildManifest packages/core/src/manifest.ts#computeSnapshotHash packages/core/src/manifest.ts#listFiles packages/core/src/manifest.ts#manifestsEqual packages/core/src/manifest.ts#pendingBatchEqual packages/core/src/manifest.ts#readManifest packages/core/src/manifest.ts#writeManifestIfChanged -->

`manifest.ts` owns `livewiki/.manifest.json`. `MANIFEST_REL_PATH` is the canonical relative path; `MANIFEST_VERSION` is the on-disk format version. `readManifest` returns `LivewikiManifest | null`. `computeSnapshotHash` computes the current repo snapshot hash used to detect drift. `listFiles` (private) enumerates files under a directory. `buildManifest` constructs a manifest snapshot from the supplied args. `writeManifestIfChanged` writes only when the new manifest differs from the existing one (via `manifestsEqual` and `pendingBatchEqual`), avoiding no-op rewrites.