---
title: Core runtime config, schema, diagrams, diff preview, and export
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
  - packages/core/src/diagrams.ts#moduleSlug
  - packages/core/src/diff-preview.test.ts#git
  - packages/core/src/diff-preview.test.ts#gitCommitAll
  - packages/core/src/diff-preview.test.ts#gitInit
  - packages/core/src/diff-preview.test.ts#setupBaseline
  - packages/core/src/diff-preview.test.ts#writeRepoFile
  - packages/core/src/diff-preview.ts#MOVED_SCOPE_NOTE
  - packages/core/src/diff-preview.ts#formatDiffPreviewHuman
  - packages/core/src/diff-preview.ts#parseGitDiffOutput
  - packages/core/src/diff-preview.ts#previewWorkingTreeDebt
  - packages/core/src/diff-preview.ts#runGitDiff
  - packages/core/src/export.test.ts#bodyOf
  - packages/core/src/export.test.ts#detectSymlinkSupport
  - packages/core/src/export.test.ts#listDest
  - packages/core/src/export.test.ts#readDest
  - packages/core/src/export.test.ts#writeWiki
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
  - packages/core/src/flow-diagram.test.ts#candidate
  - packages/core/src/flow-diagram.test.ts#chainIr
  - packages/core/src/flow-diagram.test.ts#mod
---

# Core runtime config, schema, diagrams, diff preview, and export

This module groups the livewiki core runtime surfaces that operate below the LLM: per-repo config loading, the SQLite index schema and migrations, deterministic Mermaid generators, a read-only working-tree debt preview, and the deterministic exporter from `livewiki/` into target wiki trees.

## When to use this page

- **Configure** the per-repo `.livewiki/config.json` (load, validate, default-merge, save).
- **Inspect or evolve** the SQLite index schema and migration ladder in `db.ts`.
- **Generate** deterministic Mermaid diagrams (structure, module graph, class) without an LLM.
- **Preview** which wiki pages a working tree change would invalidate before committing, or **export** the `livewiki/` snapshot to `generic`, `github-wiki`, or `gitlab-wiki` destinations under `.livewiki/export/<target>/`.

## How it fits

These files live in `packages/core/src/` and are imported by the orchestrator and CLI commands. `config.ts` is the read/write surface for `.livewiki/config.json`. `db.ts` is opened by the indexer, the anchor ledger, and the diff preview. `diagrams.ts` produces `livewiki/architecture/structure.mmd`, `livewiki/architecture/modules.mmd`, and per-module class diagrams; its tests live alongside in `diagrams.test.ts`. `diff-preview.ts` reuses the indexer's read/parse/extract path against the working tree and runs SELECTs only; `flow-diagram.test.ts` is a sibling test file that builds the FlowchartIR / Module / FlowCandidate fixtures the diagram generators are exercised against. `export.ts` reads `livewiki/` and writes to `.livewiki/export/<target>/` through the `safe-io` allowlist.

## Config: load, validate, default, save

<!-- lw:anchors packages/core/src/config.ts#CONFIG_DEFAULTS packages/core/src/config.ts#CONFIG_FILENAME packages/core/src/config.ts#CONFIG_PATH packages/core/src/config.ts#MAX_TIMEOUT_MS packages/core/src/config.ts#MissingProviderConfigError packages/core/src/config.ts#MissingProviderConfigError.constructor packages/core/src/config.ts#applyDefaults packages/core/src/config.ts#assertValidTimeoutMs packages/core/src/config.ts#loadConfig packages/core/src/config.ts#resolveBaseUrl packages/core/src/config.ts#resolveExtraIgnores packages/core/src/config.ts#resolveProviderFromConfig packages/core/src/config.ts#saveConfig packages/core/src/config.ts#validateConfigForBatch packages/core/src/config.ts#validateConfigShape -->

The config schema keeps every field optional. `language` is the only field with an explicit default (`"en"`); the rest are deliberately undefined so the user is forced to choose without a silent fallback.

```ts
export const MAX_TIMEOUT_MS = 2_147_483_647;
export const CONFIG_PATH = CONFIG_REL_PATH;
export const CONFIG_FILENAME = nodePath.basename(CONFIG_REL_PATH);
export const CONFIG_DEFAULTS = {
  // (defaults table; only `language` carries an explicit "en" default)
};
```

- `export const MAX_TIMEOUT_MS = 2_147_483_647;` is the upper bound checked by `assertValidTimeoutMs`.
- `export async function loadConfig(repoRoot: string): Promise<LivewikiConfig> {` reads `.livewiki/config.json` and validates the parsed shape.
- `export function applyDefaults(config: LivewikiConfig): LivewikiConfig {` returns a config with default fields filled in.
- `export async function saveConfig(`, `export function resolveProviderFromConfig(`, `export function resolveBaseUrl(config: LivewikiConfig): string {`, `export function resolveExtraIgnores(config: LivewikiConfig): readonly string[] {` round out the read/write/derivation surface.
- `function validateConfigShape(parsed: unknown): LivewikiConfig {` is the internal shape gate that runs before defaults are applied.
- `export function validateConfigForBatch(repoRoot: string, config: LivewikiConfig): void {` throws `MissingProviderConfigError` when the batch path requires `provider`/`model` and they are absent.
- `export class MissingProviderConfigError extends Error {` carries the repo root and missing field list. `constructor(repoRoot: string, missingFields: Array<"provider" | "model">) {` builds the user-facing message pointing at `.livewiki/config.json`.
- `export function assertValidTimeoutMs(v: unknown): asserts v is number {` rejects values outside `0..MAX_TIMEOUT_MS` and non-integers.

Note on bounds: `assertValidTimeoutMs` enforces the upper end at `MAX_TIMEOUT_MS`; the visible source describes `0` as a separate "disable client abort" sentinel rather than a lower-bounded range. API keys are deliberately never stored in this file — only env vars hold credentials, so the config can be versioned without leaking secrets.

## SQLite index: schema, version, migrations

<!-- lw:anchors packages/core/src/db.ts#CURRENT_SCHEMA_VERSION packages/core/src/db.ts#MIGRATION_SQL_V3 packages/core/src/db.ts#SCHEMA_SQL packages/core/src/db.ts#SCHEMA_VERSION_KEY packages/core/src/db.ts#migrateV3ToV4 packages/core/src/db.ts#migrateV4ToV5 packages/core/src/db.ts#migrateV5ToV6 packages/core/src/db.ts#migrateV6ToV7 packages/core/src/db.ts#migrationsFor packages/core/src/db.ts#openIndex packages/core/src/db.ts#postV3Migrations -->

The index is a derived cache: deleting `.livewiki/` lets `reindex` rebuild it from the markdown source of truth.

```ts
export const CURRENT_SCHEMA_VERSION = 8;
export const SCHEMA_VERSION_KEY = "schema_version";
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL UNIQUE,
  ...
);
...
`;
export const MIGRATION_SQL_V3 = `...`;
```

- `export function openIndex(dbPath: string): Database.Database {` opens the SQLite handle, creates the schema, runs migrations, and stamps `SCHEMA_VERSION_KEY = String(CURRENT_SCHEMA_VERSION)`.
- `export function migrationsFor(`, `export function postV3Migrations(` select the migration steps to apply based on the current stored version.
- `export function migrateV3ToV4(db: Database.Database): void {`, `export function migrateV4ToV5(db: Database.Database): void {`, `export function migrateV5ToV6(db: Database.Database): void {`, `export function migrateV6ToV7(db: Database.Database): void {`, `export function migrateV7ToV8(db: Database.Database): void {` apply each step in order; each one only mutates tables that are present (an `if` guard skips the step when its target table is missing).
- Schema v8 adds `debt.doc_page_id` — the durable page reference for a debt row, which survives anchor removal (like `debt.symbol_key` before it). `migrateV7ToV8` is idempotent (`PRAGMA table_info` guard before `ALTER TABLE ADD COLUMN`) and backfills `doc_page_id` from the anchor rows that still exist.
- `SCHEMA_SQL` is idempotent — running it on an already-populated DB is a no-op, and the partial unique index on `symbols(key) WHERE status = 'active'` is what lets the indexer soft-delete and re-insert without violating uniqueness.
- `journal_mode = WAL` and `foreign_keys = ON` are enforced by `openIndex`; the accompanying test forces a write and checkpoints the WAL.

## Diagram generators

<!-- lw:anchors packages/core/src/diagrams.ts#STRUCTURE_MAX_EDGES packages/core/src/diagrams.ts#buildCollapsedStructureLines packages/core/src/diagrams.ts#buildExactStructureLines packages/core/src/diagrams.ts#classIdentity packages/core/src/diagrams.ts#escapeLabel packages/core/src/diagrams.ts#generateClassDiagram packages/core/src/diagrams.ts#generateModulesGraph packages/core/src/diagrams.ts#generateStructure packages/core/src/diagrams.ts#mermaidId packages/core/src/diagrams.ts#mermaidMemberName packages/core/src/diagrams.ts#moduleSlug -->

All output here is deterministic; no LLM is involved.

```ts
export const STRUCTURE_MAX_EDGES = 450;
export function generateStructure(filePaths: string[]): string { ... }
function buildExactStructureLines(filePaths: string[]): { lines: string[]; edgeCount: number } { ... }
function buildCollapsedStructureLines(filePaths: string[]): string[] { ... }
export function generateModulesGraph(edges: ModuleGraphEdge[]): string { ... }
export function generateClassDiagram(module: Module, symbols: SymbolRow[]): string { ... }
export function moduleSlug(value: string): string { ... }
function classIdentity(path: string, className: string): string { ... }
function mermaidId(value: string): string { ... }
function mermaidMemberName(value: string): string { ... }
function escapeLabel(value: string): string { ... }
```

- `export const STRUCTURE_MAX_EDGES = 450;` is the budget — Mermaid's parser rejects diagrams over 500 edges by default and `maxEdges` is a secure config; 450 leaves headroom for livewiki's own verify.
- `export function generateStructure(filePaths: string[]): string {` runs in `graph LR` orientation. When the exact graph fits under the budget, it emits every directory and file as a node with deduped parent→child edges; otherwise it collapses to per-directory nodes plus a `dir/… (N files)` node per directory. Orientation is LR (vertical growth) rather than TD to match the natural page-scroll direction.
- `export function generateModulesGraph(edges: ModuleGraphEdge[]): string {` emits `graph LR` with deduplicated `from --> to` edges; an empty edge list renders the `No module edges detected` placeholder.
- `export function generateClassDiagram(module: Module, symbols: SymbolRow[]): string {` returns `""` for modules with zero classes; otherwise emits a `classDiagram` with `direction TB` (sparse class lists would otherwise render as a tiny row), with classes keyed by `classIdentity(path, className)` so same-named classes in different files get distinct IDs.
- `export function moduleSlug(value: string): string {` lowercases, strips diacritics via NFD, collapses non-alphanumerics to `-`, and trims leading/trailing dashes — used for the per-module `livewiki/diagrams/<module-slug>.classes.mmd` filenames.
- `function escapeLabel(value: string): string {` and `function mermaidId(value: string): string {` are the safety nets: Mermaid would otherwise break on raw quotes inside labels, so any string crossing the boundary is normalised.

## Diff preview: read-only working-tree debt

<!-- lw:anchors packages/core/src/diff-preview.ts#MOVED_SCOPE_NOTE packages/core/src/diff-preview.ts#formatDiffPreviewHuman packages/core/src/diff-preview.ts#parseGitDiffOutput packages/core/src/diff-preview.ts#previewWorkingTreeDebt packages/core/src/diff-preview.ts#runGitDiff packages/core/src/diff-preview.test.ts#git packages/core/src/diff-preview.test.ts#gitCommitAll packages/core/src/diff-preview.test.ts#gitInit packages/core/src/diff-preview.test.ts#setupBaseline packages/core/src/diff-preview.test.ts#writeRepoFile -->

This is a pre-commit preview only — it never writes, never updates anchors, and never mutates the index.

```ts
export const MOVED_SCOPE_NOTE =
  "renames (`moved`) are detected by the post-commit ledger (`livewiki index`), not by this preview";
export function parseGitDiffOutput(text: string): string[] { ... }
function runGitDiff(absRoot: string): Promise<string | null> { ... }
export async function previewWorkingTreeDebt(repoRoot: string): Promise<DiffPreviewResult> { ... }
export function formatDiffPreviewHuman(result: DiffPreviewResult): string { ... }
```

- `export function parseGitDiffOutput(text: string): string[] {` turns `git diff --name-only` text into a sorted, deduped list of repo-relative posix paths, tolerating blank lines and CRLF.
- `function runGitDiff(absRoot: string): Promise<string | null> {` spawns a single `git -c core.quotepath=false diff --name-only --relative HEAD` with `shell: false`. ANY failure — git missing, not a repo, no HEAD yet, non-zero exit — resolves to `null` rather than throwing, and the caller degrades to `notGitRepo: true`.
- `export async function previewWorkingTreeDebt(repoRoot: string): Promise<DiffPreviewResult> {` returns `{ notGitRepo, changedFiles, pages }`. With `notGitRepo: true`, the result is `{ notGitRepo: true, changedFiles: [], pages: [] }` — an early return, not a throw. Otherwise it recomputes working-tree symbols for each changed file via the indexer's own read/parse/extract path, then runs the ledger's exact rule: missing → `deleted`, hash mismatch → `changed`. Files the indexer itself would skip (over `MAX_FILE_BYTES`, NUL byte, unreadable) are excluded from the comparison so their anchors are not false-flagged. `moved` is out of scope here — `MOVED_SCOPE_NOTE` carries that caveat into the human output.
- `export function formatDiffPreviewHuman(result: DiffPreviewResult): string {` formats the structured result for the CLI; the clean-tree branch prints the `working tree clean vs anchors` marker.
- The tests stand up real temp git repos: `function git(args: string[]): void {`, `function gitInit(): void {`, `function gitCommitAll(message: string): void {`, `async function writeRepoFile(rel: string, content: string): Promise<void> {`, and `async function setupBaseline(): Promise<void> {`. `setupBaseline` commits `.gitignore`, two TypeScript files, and matching `livewiki/` pages, then runs the real indexer + anchor ledger so `anchors.symbol_hash_at_doc` matches `symbols.content_hash` for every anchor — the hash equivalence that the clean-tree test asserts.

## Export: deterministic transformation to target wikis

<!-- lw:anchors packages/core/src/export.ts#EXPORT_TARGETS packages/core/src/export.ts#ExportError packages/core/src/export.ts#ExportError.constructor packages/core/src/export.ts#GENERATED_MARKER_PREFIX packages/core/src/export.ts#GENERATED_MARKER_SUFFIX packages/core/src/export.ts#buildMarker packages/core/src/export.ts#detectMarker packages/core/src/export.ts#ensureExtension packages/core/src/export.ts#enumerateDestination packages/core/src/export.ts#enumerateSourcePages packages/core/src/export.ts#errMessage packages/core/src/export.ts#exportWiki packages/core/src/export.ts#flattenPath packages/core/src/export.ts#parseLinkHref packages/core/src/export.ts#renderMarkdownHeader packages/core/src/export.ts#replaceMermaidPlaceholder packages/core/src/export.ts#resolveLinkSource packages/core/src/export.ts#rewriteInternalLinks packages/core/src/export.ts#splitRawFrontmatter packages/core/src/export.ts#stripAnchorMarkers packages/core/src/export.ts#stripAnchorsField packages/core/src/export.ts#transformMarkdownPage packages/core/src/export.ts#transformMermaidPage packages/core/src/export.ts#transformPage packages/core/src/export.ts#validateTarget packages/core/src/export.test.ts#bodyOf packages/core/src/export.test.ts#detectSymlinkSupport packages/core/src/export.test.ts#listDest packages/core/src/export.test.ts#readDest packages/core/src/export.test.ts#writeWiki -->

The export reads `livewiki/`, transforms each page, and writes to `.livewiki/export/<target>/`. It never touches the source.

```ts
export const EXPORT_TARGETS: readonly ExportTarget[] = [
  "generic",
  "github-wiki",
  "gitlab-wiki",
] as const;
export const GENERATED_MARKER_PREFIX = "<!-- livewiki:generated source=\"livewiki/";
export const GENERATED_MARKER_SUFFIX = "\" -->";
export class ExportError extends Error {
  public readonly issues: ExportIssue[];
  constructor(issues: ExportIssue[]) { ... }
}
export function validateTarget(target: string): ExportTarget { ... }
export async function exportWiki(opts: ExportOptions): Promise<ExportResult> { ... }
async function enumerateSourcePages( ... ) { ... }
function flattenPath(rel: string, target: ExportTarget): string { ... }
function buildMarker(sourceRel: string): string { ... }
function splitRawFrontmatter(source: string): { ... } { ... }
function stripAnchorsField(frontmatterBlock: string): string { ... }
function renderMarkdownHeader(source: string, sourceRel: string): string { ... }
function detectMarker(text: string): string | null { ... }
async function enumerateDestination( ... ) { ... }
function transformPage( ... ) { ... }
function transformMermaidPage(page: SourcePage): string { ... }
function transformMarkdownPage( ... ) { ... }
function stripAnchorMarkers(body: string): string { ... }
function replaceMermaidPlaceholder( ... ) { ... }
function parseLinkHref(href: string): ParsedLink { ... }
function rewriteInternalLinks( ... ) { ... }
function resolveLinkSource(pathPart: string, sourceRel: string): string { ... }
function ensureExtension(path: string): string { ... }
function errMessage(err: unknown): string { ... }
```

- `export const EXPORT_TARGETS: readonly ExportTarget[] = [` enumerates the three supported targets. `export function validateTarget(target: string): ExportTarget {` throws `ExportError` (with `code: "invalid_target"`) for anything else.
- The home-page rename per target lives next to `EXPORT_TARGETS`: `generic` keeps `quickstart.md`, `github-wiki` becomes `Home.md`, `gitlab-wiki` becomes `home.md`.
- `export const GENERATED_MARKER_PREFIX = "<!-- livewiki:generated source=\"livewiki/";` and `export const GENERATED_MARKER_SUFFIX = "\" -->";` define the marker every exported page carries so a re-export can identify its own prior output. `function buildMarker(sourceRel: string): string {` assembles the marker for a given source path; `function detectMarker(text: string): string | null {` parses it back out of a destination file's header (the search is bounded to a small header window of lines).
- `export class ExportError extends Error {` carries the structured `issues: ExportIssue[]`. `constructor(issues: ExportIssue[]) {` joins each issue's `code` and `detail` into the message.
- `export async function exportWiki(opts: ExportOptions): Promise<ExportResult> {` runs the full preflight-then-write pipeline: enumerate source pages, flatten their paths per target, transform each page, preflight against the destination (collisions, symlink escapes, missing diagrams, broken internal links), and only then write. A preflight failure leaves the destination unchanged; an unforeseen filesystem failure during write or removal may leave the export partially updated (the command returns exit 1 and an idempotent rerun repairs it — that is the explicit, honest contract).
- `async function enumerateSourcePages(` reads `livewiki/` through `safeIo.resolveAndValidate`; direct `nodeFs.readdir` is only used after safe-io has accepted the directory. Each page's rel is computed against the realpath-canonicalized wiki root (`safeLivewikiDir`), not the lexical repo root — the two differ on macOS (`/var` → `/private/var`) and Windows 8.3 paths, where the lexical comparison used to poison every downstream read and the export died with `empty_source`.
- `function flattenPath(rel: string, target: ExportTarget): string {` collapses directory prefixes into a flat filename per target, and a collision raises `flattening_collision` before any write.
- `function transformPage(` dispatches to `function transformMarkdownPage(` (which calls `function splitRawFrontmatter(source: string): { ... }`, `function stripAnchorsField(frontmatterBlock: string): string {` to remove the `anchors:` field, `function renderMarkdownHeader(source: string, sourceRel: string): string {`, `function stripAnchorMarkers(body: string): string {`, `function rewriteInternalLinks(` (which delegates to `function parseLinkHref(href: string): ParsedLink {`, `function resolveLinkSource(pathPart: string, sourceRel: string): string {`, `function ensureExtension(path: string): string {`)) or `function transformMermaidPage(page: SourcePage): string {` (which calls `function replaceMermaidPlaceholder(`).
- `async function enumerateDestination(` reads `.livewiki/export/<target>/` to classify each existing entry as an ordinary file with a marker, an ordinary file without a marker, or unsafe (symlink, directory, special file, unreadable). `--force` overwrites only ordinary files lacking a matching marker; unsafe entries never get force-overwritten.
- `function errMessage(err: unknown): string {` is the standard unknown-error stringifier used by the export's write paths.
- The tests stand up real temp dirs per case (`async function writeWiki(rel: string, content: string): Promise<void> {`, `async function readDest(target: ExportTarget, name: string): Promise<string | null> {`, `async function listDest(target: ExportTarget): Promise<string[]> {`, `async function bodyOf(transformed: string): Promise<string> {`); `async function detectSymlinkSupport(): Promise<boolean> {` is run once at boot, and on any non-Windows host that reports `false` the suite throws — that is the cross-platform CI contract for the symlink-escape regression coverage. On Windows the symlink-sensitive cases use `it.runIf(canSymlink)` and skip; on Unix the host's inability to create symlinks is treated as a CI contract violation, not a harmless skip.

## Flow diagram test helpers

<!-- lw:anchors packages/core/src/flow-diagram.test.ts#candidate packages/core/src/flow-diagram.test.ts#chainIr packages/core/src/flow-diagram.test.ts#mod -->

These helpers build the inputs the flow-diagram generator is exercised against.

```ts
function chainIr(ids: string[]): FlowchartIR { ... }
function mod(id: string, paths: string[], displayTitle?: string): Module { ... }
function candidate(overrides: Partial<FlowCandidate> & { moduleIds: string[] }): FlowCandidate { ... }
```

- `function chainIr(ids: string[]): FlowchartIR {` builds a linear-chain `FlowchartIR` (`A -> B -> C -> ...`) for an array of node ids — used to assert edge count and node count.
- `function mod(id: string, paths: string[], displayTitle?: string): Module {` constructs a `Module` with the minimum required fields; `displayTitle` is only included in the object when provided, so tests can exercise both the titled and the id-only fallback branches.
- `function candidate(overrides: Partial<FlowCandidate> & { moduleIds: string[] }): FlowCandidate {` returns a `FlowCandidate` with the empty default signals (`{ entry: [], persistence: [], external: [] }`) and any caller-supplied overrides applied on top.

<!-- livewiki:navigate:start -->
## Navigate

- Flow: [CLI to persistence flow — entry through `livewiki batch` to the SQLite index](flows/cli-src-01-to-core-src-05.md)
- [Core Repair, Status, Sectioning, Symbols, and Risk Pipeline](core-src-11.md) — dependency and dependent
- [Core module identification, manifest I/O, and Markdown mask helpers](core-src-08.md) — dependency and dependent
- [core-src-06 stage-5 internals (flows, diagrams, frontmatter, gitignore, hashes, import resolution)](core-src-06.md) — dependency and dependent

> Coverage note: this module's source (10 files, ~213k chars) exceeded the prompt budget and was excerpted; this page documents the closed-list symbols.
<!-- livewiki:navigate:end -->
