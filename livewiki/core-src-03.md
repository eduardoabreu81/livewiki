---
title: "Core Source 03: Config, Index, Export, Diagrams, Diff Preview"
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
  - packages/core/src/config.ts#resolveExtraIgnores
  - packages/core/src/config.ts#resolveProviderFromConfig
  - packages/core/src/config.ts#saveConfig
  - packages/core/src/config.ts#validateConfigForBatch
  - packages/core/src/config.ts#validateConfigShape
  - packages/core/src/db.ts#CURRENT_SCHEMA_VERSION
  - packages/core/src/db.ts#MIGRATION_SQL_V3
  - packages/core/src/db.ts#SCHEMA_SQL
  - packages/core/src/db.ts#SCHEMA_VERSION_KEY
  - packages/core/src/db.ts#migrateV3ToV4
  - packages/core/src/db.ts#migrateV4ToV5
  - packages/core/src/db.ts#migrateV5ToV6
  - packages/core/src/db.ts#migrateV6ToV7
  - packages/core/src/db.ts#migrateV7ToV8
  - packages/core/src/db.ts#migrationsFor
  - packages/core/src/db.ts#openIndex
  - packages/core/src/db.ts#postV3Migrations
  - packages/core/src/diagrams.ts#STRUCTURE_MAX_EDGES
  - packages/core/src/diagrams.ts#buildCollapsedStructureLines
  - packages/core/src/diagrams.ts#buildExactStructureLines
  - packages/core/src/diagrams.ts#classIdentity
  - packages/core/src/diagrams.ts#escapeLabel
  - packages/core/src/diagrams.ts#generateClassDiagram
  - packages/core/src/diagrams.ts#generateModulesGraph
  - packages/core/src/diagrams.ts#generateStructure
  - packages/core/src/diagrams.ts#mermaidId
  - packages/core/src/diagrams.ts#mermaidMemberName
  - packages/core/src/diagrams.ts#moduleDiagramPlaceholder
  - packages/core/src/diagrams.ts#moduleSlug
  - packages/core/src/diff-preview.ts#MOVED_SCOPE_NOTE
  - packages/core/src/diff-preview.ts#formatDiffPreviewHuman
  - packages/core/src/diff-preview.ts#parseGitDiffOutput
  - packages/core/src/diff-preview.ts#previewWorkingTreeDebt
  - packages/core/src/diff-preview.ts#runGitDiff
  - packages/core/src/export.ts#EXPORT_TARGETS
  - packages/core/src/export.ts#ExportError
  - packages/core/src/export.ts#ExportError.constructor
  - packages/core/src/export.ts#GENERATED_MARKER_PREFIX
  - packages/core/src/export.ts#GENERATED_MARKER_SUFFIX
  - packages/core/src/export.ts#buildMarker
  - packages/core/src/export.ts#detectMarker
  - packages/core/src/export.ts#ensureExtension
  - packages/core/src/export.ts#enumerateDestination
  - packages/core/src/export.ts#enumerateSourcePages
  - packages/core/src/export.ts#errMessage
  - packages/core/src/export.ts#exportWiki
  - packages/core/src/export.ts#flattenPath
  - packages/core/src/export.ts#parseLinkHref
  - packages/core/src/export.ts#renderMarkdownHeader
  - packages/core/src/export.ts#replaceMermaidPlaceholder
  - packages/core/src/export.ts#resolveLinkSource
  - packages/core/src/export.ts#rewriteInternalLinks
  - packages/core/src/export.ts#splitRawFrontmatter
  - packages/core/src/export.ts#stripAnchorMarkers
  - packages/core/src/export.ts#stripAnchorsField
  - packages/core/src/export.ts#transformMarkdownPage
  - packages/core/src/export.ts#transformMermaidPage
  - packages/core/src/export.ts#transformPage
  - packages/core/src/export.ts#validateTarget
  - packages/core/src/flow-diagram.ts#FLOW_DIAGRAM_MODULE_GRANULARITY_THRESHOLD
  - packages/core/src/flow-diagram.ts#annotateLabel
  - packages/core/src/flow-diagram.ts#buildDiagramContext
  - packages/core/src/flow-diagram.ts#escapeMermaidLabel
  - packages/core/src/flow-diagram.ts#generateFlowDiagram
  - packages/core/src/flow-diagram.ts#insertFlowDiagramSection
  - packages/core/src/flow-diagram.ts#moduleGranularityIr
  - packages/core/src/flow-diagram.ts#renderFlowchartMermaid
  - packages/core/src/flow-diagram.ts#symbolGranularityIr
  - packages/core/src/flow-diagram.ts#symbolLabel
  - packages/core/src/flow-diagram.ts#truncateFlowchartToBudget
---

# Core Source 03: Config, Index, Export, Diagrams, Diff Preview

This page documents the deterministic, non-LLM subsystems that back livewiki's source repo support: the per-repo JSON config, the SQLite schema and migrations that hold the index, the diagram generators that produce Mermaid from facts, the read-only working-tree diff preview, and the local export that mirrors the on-disk snapshot.

## When to use this page

- **Load or edit `.livewiki/config.json` for the target repo** — start with `loadConfig` and `saveConfig`, then read the `applyDefaults` and `validateConfigShape` rules.
- **Open or migrate `.livewiki/index.db`** — read `openIndex`, `CURRENT_SCHEMA_VERSION`, and the `migrateV*ToV*` ladder before touching any index code.
- **Preview anchor drift before committing** — call `previewWorkingTreeDebt`; it never writes the index.
- **Mirror `livewiki/` to a host wiki target (generic / github-wiki / gitlab-wiki)** — invoke `exportWiki` and inspect `ExportError` / `validateTarget` for the contract.

## How it fits

This module groups five related services under `packages/core/src/`. `config.ts` reads and writes the per-repo `.livewiki/config.json` and never holds credentials (those stay in `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`). `db.ts` defines the SQLite schema (`SCHEMA_SQL`), the current `CURRENT_SCHEMA_VERSION`, and the migration ladder that upgrades an existing `.livewiki/index.db` to the current shape (the database is a derived cache; deleting `.livewiki/` is non-destructive). `diagrams.ts` produces Mermaid source for the structure graph (`generateStructure`), the import graph (`generateModulesGraph`), and the per-module class diagram (`generateClassDiagram`); `flow-diagram.ts` produces a deterministic flowchart for stage-5 flow pages instead of letting the LLM emit the syntax. `diff-preview.ts` reuses the indexer's own parse path to read the working tree and produces a `DiffPreviewResult` without any writes. `export.ts` runs the local deterministic transformation of `livewiki/` into `.livewiki/export/<target>/`, with all writes going through `safe-io`.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-03.mmd
```

## Config load / save and provider resolution

<!-- lw:anchors packages/core/src/config.ts#CONFIG_DEFAULTS packages/core/src/config.ts#CONFIG_FILENAME packages/core/src/config.ts#CONFIG_PATH packages/core/src/config.ts#MAX_TIMEOUT_MS packages/core/src/config.ts#MissingProviderConfigError packages/core/src/config.ts#MissingProviderConfigError.constructor packages/core/src/config.ts#applyDefaults packages/core/src/config.ts#assertValidTimeoutMs packages/core/src/config.ts#loadConfig packages/core/src/config.ts#resolveBaseUrl packages/core/src/config.ts#resolveExtraIgnores packages/core/src/config.ts#resolveProviderFromConfig packages/core/src/config.ts#saveConfig packages/core/src/config.ts#validateConfigForBatch packages/core/src/config.ts#validateConfigShape -->

`loadConfig` reads `.livewiki/config.json` from the repo root and returns a parsed `LivewikiConfig`; `saveConfig` writes it back through `safe-io`. The path is fixed via `CONFIG_PATH` (the relative path) and `CONFIG_FILENAME` (its basename). `validateConfigShape` is the structural guard that rejects floats, strings, NaN, or negatives for the integer-typed options; `applyDefaults` fills in built-in defaults when keys are missing — `language` is the only field with an explicit default (`"en"`), while `provider`, `model`, and friends stay undefined on purpose so no silent fallback happens. When the LLM batch runs without those keys, `validateConfigForBatch(repoRoot, config)` raises `MissingProviderConfigError` (constructor wires the repo root and `missingFields` array into the message), and the supplied config object is untouched. Provider resolution delegates to `resolveProviderFromConfig` (which handles preset expansion via `presets.ts`) and `resolveBaseUrl` / `resolveExtraIgnores` project the merged config into the values the rest of the pipeline consumes. `assertValidTimeoutMs(v)` is the type predicate that rejects any number outside `0..MAX_TIMEOUT_MS` (and `MAX_TIMEOUT_MS` is `2_147_483_647`, the Node `setTimeout` safe max). The visible exception path: `validateConfigForBatch` throws on missing provider/model; `assertValidTimeoutMs` throws on out-of-range timeouts; `loadConfig` / `saveConfig` propagate I/O errors from `safe-io`.

## SQLite index schema and migrations

<!-- lw:anchors packages/core/src/db.ts#CURRENT_SCHEMA_VERSION packages/core/src/db.ts#SCHEMA_VERSION_KEY packages/core/src/db.ts#SCHEMA_SQL packages/core/src/db.ts#MIGRATION_SQL_V3 packages/core/src/db.ts#migrateV3ToV4 packages/core/src/db.ts#migrateV4ToV5 packages/core/src/db.ts#migrateV5ToV6 packages/core/src/db.ts#migrateV6ToV7 packages/core/src/db.ts#migrateV7ToV8 packages/core/src/db.ts#migrationsFor packages/core/src/db.ts#openIndex packages/core/src/db.ts#postV3Migrations -->

`openIndex(dbPath)` opens (creating if missing) the SQLite database and runs the idempotent `SCHEMA_SQL`, then enforces the migration ladder by comparing `schema_version` (written under `SCHEMA_VERSION_KEY` in `meta`) to `CURRENT_SCHEMA_VERSION`. The schema ships the tables `files`, `symbols`, `meta`, `anchors`, `debt`, `undocumented`, `batch_runs`, `batch_tasks`, `doc_pages`, `manual_blocks`, `calls`, `rationales` — each guarded by a partial unique index where status semantics require it. The migration ladder is `migrateV3ToV4 → migrateV4ToV5 → migrateV5ToV6 → migrateV6ToV7 → migrateV7ToV8`. `migrateV3ToV4` swaps the inline `UNIQUE` on `symbols.key` for the partial unique index over `status='active'`, adds `debt.symbol_key`, and creates the partial index `idx_debt_open`. The v2→v3 SQL is exposed as `MIGRATION_SQL_V3`. `migrationsFor(from, to)` returns the ordered subset of `migrateV*ToV*` functions needed to upgrade from `from` to `to`; `postV3Migrations(from, to, db)` is the post-v3 dispatcher. The visible branches: when `from >= to`, no migrations run; when an unsupported `from` is requested, `migrationsFor` returns no plan and the caller decides how to fail; the SQLite engine itself enforces per-statement errors and they propagate from `openIndex`.

## Deterministic Mermaid diagrams

<!-- lw:anchors packages/core/src/diagrams.ts#STRUCTURE_MAX_EDGES packages/core/src/diagrams.ts#buildCollapsedStructureLines packages/core/src/diagrams.ts#buildExactStructureLines packages/core/src/diagrams.ts#classIdentity packages/core/src/diagrams.ts#escapeLabel packages/core/src/diagrams.ts#generateClassDiagram packages/core/src/diagrams.ts#generateModulesGraph packages/core/src/diagrams.ts#generateStructure packages/core/src/diagrams.ts#mermaidId packages/core/src/diagrams.ts#mermaidMemberName packages/core/src/diagrams.ts#moduleDiagramPlaceholder packages/core/src/diagrams.ts#moduleSlug -->

`generateStructure(filePaths)` produces the repo directory graph in `LR` orientation. The exact graph (every directory and file as a node) is built by `buildExactStructureLines` and counted against `STRUCTURE_MAX_EDGES` (450, chosen below Mermaid's 500-edge parser limit). When the exact graph would exceed 450 edges, `buildCollapsedStructureLines` emits the directory chain plus one `(N files)` node per directory instead. `generateModulesGraph(edges)` emits `graph LR` followed by deduped import edges; an empty edge array yields a single `root[No module edges detected]` node. `generateClassDiagram(module, symbols)` emits a `classDiagram` with `direction TB` and one block per class; methods are grouped per `(path, className)` via `classIdentity`. `mermaidId(value)` normalizes a path or name into a Mermaid-safe identifier; `escapeLabel(value)` strips characters that would break `[...]` labels; `mermaidMemberName(value)` produces the `+name()` style member token. `moduleDiagramPlaceholder(slug)` returns the exact `%% livewiki/diagrams/<slug>.mmd` placeholder the on-disk module page embeds, and `moduleSlug(value)` derives the filesystem-safe slug used across the diagram filenames.

## Working-tree diff preview

<!-- lw:anchors packages/core/src/diff-preview.ts#MOVED_SCOPE_NOTE packages/core/src/diff-preview.ts#parseGitDiffOutput packages/core/src/diff-preview.ts#runGitDiff packages/core/src/diff-preview.ts#previewWorkingTreeDebt packages/core/src/diff-preview.ts#formatDiffPreviewHuman -->

`previewWorkingTreeDebt(repoRoot)` is the read-only pre-commit anchor preview: it runs ONE `git diff --name-only --relative HEAD` (via `runGitDiff` with `shell: false`, `core.quotepath=false`, and `--relative` for subdirectory work trees) and decomposes the output through `parseGitDiffOutput` (sorted, deduped, blank-line tolerant). For each changed file it re-reads the working tree, normalizes EOLs, and re-extracts symbols via the same `parseSource` / `extractSymbols` path the indexer uses; files the indexer would skip (over `MAX_FILE_BYTES`, NUL byte sniff, or unreadable) are tracked in `skippedFiles` and excluded from comparison. Every anchor row whose `symbol_key` belongs to a changed file is then compared: missing from the working set → `deleted`; present but `content_hash` mismatch → `changed`. The combined hits are deduped per page and sorted by `wikiPath`, with the inner items sorted by `symbolKey`. The visible branches: `runGitDiff` returns `null` whenever git is missing, the dir is not a repo, no HEAD exists, or any non-zero exit fires — and `previewWorkingTreeDebt` translates that into `notGitRepo: true` rather than throwing; if no `.livewiki/index.db` exists the function returns an empty `pages` list (no anchors exist to check); parse failures are swallowed and treated as zero symbols for that file. `formatDiffPreviewHuman(result)` renders the structured output, appending the `MOVED_SCOPE_NOTE` so the human output explicitly states that `moved` is a post-commit signal covered by the ledger, not by the preview.

## Local export to host wikis

<!-- lw:anchors packages/core/src/export.ts#EXPORT_TARGETS packages/core/src/export.ts#ExportError packages/core/src/export.ts#ExportError.constructor packages/core/src/export.ts#GENERATED_MARKER_PREFIX packages/core/src/export.ts#GENERATED_MARKER_SUFFIX packages/core/src/export.ts#buildMarker packages/core/src/export.ts#detectMarker packages/core/src/export.ts#ensureExtension packages/core/src/export.ts#enumerateDestination packages/core/src/export.ts#enumerateSourcePages packages/core/src/export.ts#errMessage packages/core/src/export.ts#exportWiki packages/core/src/export.ts#flattenPath packages/core/src/export.ts#parseLinkHref packages/core/src/export.ts#renderMarkdownHeader packages/core/src/export.ts#replaceMermaidPlaceholder packages/core/src/export.ts#resolveLinkSource packages/core/src/export.ts#rewriteInternalLinks packages/core/src/export.ts#splitRawFrontmatter packages/core/src/export.ts#stripAnchorMarkers packages/core/src/export.ts#stripAnchorsField packages/core/src/export.ts#transformMarkdownPage packages/core/src/export.ts#transformMermaidPage packages/core/src/export.ts#transformPage packages/core/src/export.ts#validateTarget -->

`exportWiki(opts)` is the Phase 6 Lot 6A entry point. It validates `opts.target` via `validateTarget` (which throws `ExportError` from the constructor — `issues: ExportIssue[]` → flattened message, with `issues` preserved on the instance), rejects `--push` before any I/O, and resolves both `livewiki/` and `.livewiki/export/<target>/` through `safe-io` (`source_path_unsafe` / `destination_path_unsafe` otherwise). `EXPORT_TARGETS` enumerates `generic`, `github-wiki`, and `gitlab-wiki`; each gets its own home-page mapping. `enumerateSourcePages` walks `livewiki/`, `flattenPath` derives the flat destination name (collision detection: `flattening_collision` is a fatal preflight issue), and per-page the transform branches: `transformMarkdownPage` runs `splitRawFrontmatter` → `parseFrontmatter` → `stripAnchorMarkers` / `stripAnchorsField` → `renderMarkdownHeader` (which embeds the `GENERATED_MARKER_PREFIX` + `buildMarker(sourceRel)` + `GENERATED_MARKER_SUFFIX` token) → `rewriteInternalLinks` (via `resolveLinkSource` and `parseLinkHref`). `transformMermaidPage` swaps the `%% livewiki/...` placeholder through `replaceMermaidPlaceholder`. `transformPage` is the dispatcher. `enumerateDestination` then reads each planned entry (after `safe-io` validation) and classifies it via `detectMarker`. The preflight loops reject `frontmatter_parse_error`, `missing_diagram`, `broken_internal_link`, `flattening_collision`, `destination_conflict`, `destination_unsafe`. The visible branches: preflight failure (`ok: false`) leaves the destination unchanged; an unforeseen filesystem failure during write or removal MAY leave the export partially updated and the command returns exit 1 with an idempotent rerun repairing it. `ensureExtension` and `errMessage` are the supporting helpers. The export never touches `livewiki/` and never spawns a Git subprocess or uses the network.

## Deterministic flow diagrams

<!-- lw:anchors packages/core/src/flow-diagram.ts#FLOW_DIAGRAM_MODULE_GRANULARITY_THRESHOLD packages/core/src/flow-diagram.ts#annotateLabel packages/core/src/flow-diagram.ts#buildDiagramContext packages/core/src/flow-diagram.ts#escapeMermaidLabel packages/core/src/flow-diagram.ts#generateFlowDiagram packages/core/src/flow-diagram.ts#insertFlowDiagramSection packages/core/src/flow-diagram.ts#moduleGranularityIr packages/core/src/flow-diagram.ts#renderFlowchartMermaid packages/core/src/flow-diagram.ts#symbolGranularityIr packages/core/src/flow-diagram.ts#symbolLabel packages/core/src/flow-diagram.ts#truncateFlowchartToBudget -->

`generateFlowDiagram(candidate, modules, budget)` builds the deterministic flowchart for a stage-5 flow page. Above `FLOW_DIAGRAM_MODULE_GRANULARITY_THRESHOLD` (6 modules) it calls `moduleGranularityIr`, which draws one node per participating module in walk order chained `n0 → n1 → ... → nN`. At or below the threshold it calls `symbolGranularityIr`, which orders the entry/boundary/sink tiers (T4/T5 are intentionally omitted so the diagram stays a story rather than a key dump), chains every entry key into the first boundary key (or into the first sink key when there is no boundary), chains boundary keys in sequence, and feeds every sink key from the last boundary key. Both IR builders funnel through `annotateLabel(baseLabel, moduleId, ctx)` to prepend `Entry:` or append ` - persists` when the owning module is in the entry or persistence signal sets from `buildDiagramContext(candidate, modules)`. `symbolLabel(key)` extracts the trailing name from a closed-list key, and `escapeMermaidLabel` strips `[ ] { } ( ) | "` so the label stays a single token. The resulting `FlowchartIR` is reduced by `truncateFlowchartToBudget(ir, maxNodes, maxEdges)` (kept nodes are the first `maxNodes` in appearance order; kept edges are the first `maxEdges` whose endpoints both survived) and re-serialized by `renderFlowchartMermaid` into a `flowchart LR` source. `insertFlowDiagramSection` is the orchestrator-side helper that replaces a placeholder in a flow page with the rendered Mermaid block. The visible exception path: re-truncating an already-small IR returns it unchanged (idempotent), and isolated kept nodes (no surviving edges after truncation) still receive a standalone declaration line so they do not silently vanish.

<!-- livewiki:navigate:start -->
## Navigate

- Flow: [CLI command surface to core pipeline wiring](flows/cli-src-to-core-src-02.md)
- [core indexing, imports, flows, and frontmatter](core-src-04.md) — dependency and dependent
- [Safe I/O, section guarding, status reporting, and symbol extraction](core-src-09.md) — dependency and dependent
- [Stage 4 artifact normalization, validation, and auxiliary page assembly](core-src-01.md) — dependency and dependent

> Coverage note: this module's source (6 files, ~133k chars) exceeded the prompt budget and was excerpted; this page documents the closed-list symbols.
<!-- livewiki:navigate:end -->
