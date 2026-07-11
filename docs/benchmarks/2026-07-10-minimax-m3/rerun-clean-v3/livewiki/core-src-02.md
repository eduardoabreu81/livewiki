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

## Config (`.livewiki/config.json`)
<!-- lw:anchors packages/core/src/config.ts#CONFIG_DEFAULTS packages/core/src/config.ts#CONFIG_FILENAME packages/core/src/config.ts#CONFIG_PATH packages/core/src/config.ts#MissingProviderConfigError packages/core/src/config.ts#MissingProviderConfigError.constructor packages/core/src/config.ts#applyDefaults packages/core/src/config.ts#loadConfig packages/core/src/config.ts#resolveBaseUrl packages/core/src/config.ts#resolveProviderFromConfig packages/core/src/config.ts#saveConfig packages/core/src/config.ts#validateConfigForBatch packages/core/src/config.ts#validateConfigShape -->

Loads and persists `.livewiki/config.json` via safe-io. No API keys live here — keys stay in env (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY`). No model/provider default; if either is missing when the LLM batch fires, `validateConfigForBatch` throws `MissingProviderConfigError` (constructed with `repoRoot` + `missingFields`) pointing the user to the config file. Defaults are applied at runtime via `applyDefaults` and never written to disk. `CONFIG_PATH`/`CONFIG_FILENAME` are re-exports of the canonical relative path so callers can import the resolved name. `resolveProviderFromConfig` expands `preset` and merges overrides. `resolveBaseUrl` honors `config.baseUrl` → preset → per-provider default. `validateConfigShape` performs shallow shape validation (rejects non-integer `maxRepairAttempts`, non-string providers, unknown presets, etc.).

## SQLite index (`db.ts`)
<!-- lw:anchors packages/core/src/db.ts#CURRENT_SCHEMA_VERSION packages/core/src/db.ts#SCHEMA_VERSION_KEY packages/core/src/db.ts#SCHEMA_SQL packages/core/src/db.ts#MIGRATION_SQL_V3 packages/core/src/db.ts#migrateV3ToV4 packages/core/src/db.ts#migrationsFor packages/core/src/db.ts#postV3Migrations packages/core/src/db.ts#openIndex -->

The SQLite cache is derived state (`<repoRoot>/.livewiki/index.db`); deleting `.livewiki/` forces a clean rebuild. `CURRENT_SCHEMA_VERSION` is `4`. `SCHEMA_VERSION_KEY` (`"schema_version"`) is the meta key. `SCHEMA_SQL` is the idempotent baseline (tables: `files`, `symbols`, `meta`, `anchors`, `debt`, `undocumented`, `batch_runs`, `batch_tasks`, `doc_pages`, `manual_blocks`; partial unique index `idx_symbols_active_key` on `symbols.key WHERE status='active'`; partial index `idx_debt_open` on open debt rows). `MIGRATION_SQL_V3` is the v2→v3 string migration (adds `debt.symbol_key`, recreates `symbols` without the inline UNIQUE, installs the partial unique index). `migrateV3ToV4` is the v3→v4 JS function that idempotently adds `finished_at`, `started_by`, `summary_json` to `batch_runs` (via `PRAGMA table_info` checks — SQLite has no `ADD COLUMN IF NOT EXISTS`) and installs the new run/task indices. `migrationsFor` returns SQL-string steps; `postV3Migrations` returns the JS-function steps; `openIndex` opens the DB, enables WAL/foreign-keys, runs `SCHEMA_SQL`, then dispatches migrations when the stored version differs from `CURRENT_SCHEMA_VERSION`.

## Diagrams (deterministic Mermaid)
<!-- lw:anchors packages/core/src/diagrams.ts#moduleSlug packages/core/src/diagrams.ts#generateStructure packages/core/src/diagrams.ts#generateModulesGraph packages/core/src/diagrams.ts#generateClassDiagram packages/core/src/diagrams.ts#mermaidId packages/core/src/diagrams.ts#escapeLabel -->

Deterministic Mermaid emitters — no LLM involvement, regenerated each index/init. `moduleSlug` lowercases, strips diacritics, collapses non-alphanumerics to `-`, trims leading/trailing hyphens. `generateStructure` emits `graph TD` for a directory tree (chained parent/child edges). `generateModulesGraph` emits `graph LR` from `ModuleGraphEdge[]` (falls back to a `root` node when empty). `generateClassDiagram` emits a `classDiagram` per module — returns empty string when no class symbols belong to the module; otherwise groups `method` symbols under each class key. `mermaidId` sanitises node IDs (non-alnum → `_`); `escapeLabel` escapes quotes and brackets for safe label rendering.

## Frontmatter parser
<!-- lw:anchors packages/core/src/frontmatter.ts#FrontmatterParseError packages/core/src/frontmatter.ts#FrontmatterParseError.constructor packages/core/src/frontmatter.ts#parseFrontmatter packages/core/src/frontmatter.ts#parseYamlBlock packages/core/src/frontmatter.ts#stripComment packages/core/src/frontmatter.ts#getAnchors packages/core/src/frontmatter.ts#getOwner -->

Custom YAML-subset parser for wiki pages (avoids the `yaml` dependency). Format: lines between `---\n` and `\n---`; supports top-level string keys and string lists via `- ` items; comments via `# ` outside values. `parseFrontmatter` normalises line endings, detects the opening `---`, locates the closing `\n---`, slices out the YAML block, and returns `{ frontmatter, body, bodyOffset }`. Missing frontmatter returns `frontmatter: null` (not an error). `parseYamlBlock` walks lines tracking a current list key; list items without a preceding key throw `FrontmatterParseError`. `stripComment` removes trailing `# …` outside strings. `FrontmatterParseError` carries the offending `line` number. Helpers: `getAnchors` returns the `anchors` list (always `string[]`); `getOwner` returns `"generated" | "human" | "mixed"` (defaults to `"generated"`).

## `.gitignore` writer
<!-- lw:anchors packages/core/src/gitignore.ts#readGitignore packages/core/src/gitignore.ts#ensureGitignoreEntries packages/core/src/gitignore.ts#extractManagedBlock packages/core/src/gitignore.ts#mergeBlockLines packages/core/src/gitignore.ts#renderBlock packages/core/src/gitignore.ts#replaceManagedBlock -->

Idempotent `.gitignore` writer for the required `.livewiki/` entry (SPEC rule). `readGitignore` is a pure wrapper that returns `""` when the file is missing. `ensureGitignoreEntries` detects the managed block delimited by `# livewiki:start` / `# livewiki:end`, computes the missing entries (exact, case-sensitive trim match), rebuilds only the block (preserving user entries outside it), and returns `{ file, changed, added }`. `extractManagedBlock` returns `{ lines }` for the inner content (tolerant of whitespace in markers, returns `null` on truncated block). `mergeBlockLines` preserves existing order then appends new entries without duplicates. `renderBlock` formats `[BLOCK_START, ...lines, BLOCK_END]` joined by `\n`. `replaceManagedBlock` swaps the managed block in place or appends a new block when none exists, handling trailing-newline edge cases.

## Hashes
<!-- lw:anchors packages/core/src/hashes.ts#sha256 packages/core/src/hashes.ts#sha256Slice -->

Pure SHA-256 helpers (no salt — content fingerprinting only). `sha256` accepts `string | Uint8Array` and returns lowercase hex (64 chars). `sha256Slice` is the per-symbol variant: `sha256(source.slice(startByte, endByte))`. Used for both file-level change detection and per-symbol slices (so a partial edit inside a file produces a different symbol hash without re-parsing everything).

## Imports (tree-sitter)
<!-- lw:anchors packages/core/src/imports.ts#extractImportsFromTree packages/core/src/imports.ts#collectImports -->

Tree-sitter-driven import extraction. Covers TS/JS `import_statement` (with `source` field) and `export_statement` (re-exports), plus Python `import_statement` (dotted_name children) and `import_from_statement` (with `module_name` + imported names). `extractImportsFromTree` is the pure walker (no I/O) — takes a `Tree` + lang and yields `ExtractedImport { source, kind, names? }`. `collectImports` is the high-level entry: calls `initParser()`, parses by extension, returns `[]` on parse failure (graceful degradation). Dynamic `require()`/expression `import()` are not resolved and become unconnected nodes — flagged as an MVP limitation.

## Indexer orchestration
<!-- lw:anchors packages/core/src/indexer.ts#run packages/core/src/indexer.ts#ensureLivewikiDir packages/core/src/indexer.ts#orchestrateIndex packages/core/src/indexer.ts#formatHuman -->

Top-level index orchestrator: walk → read → hash → parse → upsert. `run` resolves `repoRoot`, calls `ensureLivewikiDir`, resolves `.livewiki/index.db` via safe-io, walks via `walkRepo`, opens the DB, then delegates to `orchestrateIndex`. Incremental: files with unchanged `content_hash` are skipped after read+hash. `ensureLivewikiDir` creates `.livewiki/` via safe-io; emits a one-line note when `livewiki/` is also missing (suppressed in `quiet` mode for hooks). `orchestrateIndex` runs in two phases: phase A is async (read+parse) outside the SQLite transaction; phase B is one synchronous `db.transaction(...)` that performs all upserts/deletes atomically. Updates use soft-delete (`status='deleted'`) on the old symbol rows to preserve their `content_hash` for later moved-detection. Files present in the DB but missing from the walk are marked deleted (file + active symbols). `formatHuman` renders the result summary for the CLI.

## `init` command
<!-- lw:anchors packages/core/src/init.ts#runInit packages/core/src/init.ts#buildPlan packages/core/src/init.ts#generateQuickstartDeterministic packages/core/src/init.ts#generateArchitectureOverview packages/core/src/init.ts#regenerateArchitectureOverview packages/core/src/init.ts#escapeHtmlId -->

Phase-3 `livewiki init` (deterministic layout + optional LLM batch). `runInit` orchestrates: ensure `.gitignore` entries, ensure `.livewiki/`, run index, run anchor ledger, then generate `livewiki/quickstart.md` + `architecture/structure.mmd` + `architecture/modules.mmd` + `diagrams/<slug>.classes.mmd` + `.manifest.json`. With `--plan`, it returns a deterministic module plan (heuristic identification, edge resolution, prioritisation, unique IDs, oversized-split) without writing files or calling the LLM. With `--batch`, it dispatches the 4-stage LLM pipeline after the base init; `--no-refine` skips stage-2 refinement (refinement is opt-in / degradable). `buildPlan` produces the module/edge/ordered report. `generateQuickstartDeterministic` writes the low-token entry page. `generateArchitectureOverview` / `regenerateArchitectureOverview` write the architecture narrative (regen is for rerunning without full init). `escapeHtmlId` sanitises IDs for HTML anchors.

## Manifest
<!-- lw:anchors packages/core/src/manifest.ts#MANIFEST_VERSION packages/core/src/manifest.ts#MANIFEST_REL_PATH packages/core/src/manifest.ts#readManifest packages/core/src/manifest.ts#computeSnapshotHash packages/core/src/manifest.ts#listFiles packages/core/src/manifest.ts#writeManifestIfChanged packages/core/src/manifest.ts#manifestsEqual packages/core/src/manifest.ts#pendingBatchEqual packages/core/src/manifest.ts#buildManifest -->

The on-disk snapshot at `livewiki/.manifest.json` (`MANIFEST_REL_PATH`, `MANIFEST_VERSION = 1`). `readManifest` returns the manifest or `null` when absent. `computeSnapshotHash` produces the deterministic fingerprint used to detect repo changes between runs. `listFiles` walks the wiki tree. `writeManifestIfChanged` is the conditional writer: it computes the new manifest, compares with the existing one via `manifestsEqual`, and skips the write when unchanged (avoiding spurious diffs). `pendingBatchEqual` compares pending-batch references for idempotency. `buildManifest` assembles the manifest from the wiki state.

## Test helpers
<!-- lw:anchors packages/core/src/key-leak.test.ts#assertCanaryNotPresent packages/core/src/manifest.test.ts#writeLivewikiFile -->

`assertCanaryNotPresent` (key-leak test) is a guard that fails when a sentinel string appears in a value — used to verify the config layer never embeds API keys or other secrets (test fails if a canary leaks into the persisted config). `writeLivewikiFile` (manifest test) is a test-only helper that writes a wiki file at a relative path; the suite uses it to stage fixtures for manifest snapshot/equality tests.