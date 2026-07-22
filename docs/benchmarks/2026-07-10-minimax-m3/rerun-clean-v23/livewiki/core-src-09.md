---
title: "core-src-09 — walker, update package, metrics, and verify pipeline"
owner: generated
anchors:
  - packages/core/src/walker.ts#EXTENSION_LANG
  - packages/core/src/walker.ts#buildIgnore
  - packages/core/src/walker.ts#walkRepo
  - packages/core/src/walker.test.ts#write
  - packages/core/src/update.ts#CHARS_PER_TOKEN
  - packages/core/src/update.ts#loadWorkPackage
  - packages/core/src/update.ts#lookupSymbol
  - packages/core/src/update.ts#recordDocWrittenBack
  - packages/core/src/update.ts#snippetForSymbol
  - packages/core/src/update-metrics.ts#clearMetricsForTests
  - packages/core/src/update-metrics.ts#metricsPath
  - packages/core/src/update-metrics.ts#readMetrics
  - packages/core/src/update-metrics.ts#recordUpdateMetric
  - packages/core/src/update-metrics.ts#snapshotMetrics
  - packages/core/src/update-metrics.ts#writeMetrics
  - packages/core/src/update.test.ts#setupWithAnchor
  - packages/core/src/update.test.ts#writeCode
  - packages/core/src/update.test.ts#writeWiki
  - packages/core/src/verify.ts#collectSectionSlugs
  - packages/core/src/verify.ts#collectWikiArtifactPaths
  - packages/core/src/verify.ts#collectWikiPages
  - packages/core/src/verify.ts#formatHuman
  - packages/core/src/verify.ts#isInsideWiki
  - packages/core/src/verify.ts#resolveWikiLink
  - packages/core/src/verify.ts#run
  - packages/core/src/verify.test.ts#writeCode
  - packages/core/src/verify.test.ts#writeWiki
---

# core-src-09 — walker, update package, metrics, and verify pipeline

This page documents the four cooperating core modules that make up livewiki's incremental flow: the repository `walker`, the `update` package builder, the `update-metrics` accounting journal, and the `verify` pipeline.

## When to use this page

- **Walk** a repository to discover indexable source files while honoring `.gitignore` and built-in defaults.
- **Run** the incremental `update` flow to assemble a focused work package (manifest + debt + snippets + valid anchors) for an in-session agent.
- **Inspect** the metrics journal that records every emitted package and every write received back, to compute the write/package efficiency ratio.
- **Validate** the wiki against the code index via `verify`, catching broken anchors, altered manual blocks, and broken internal links.

## How it fits

`packages/core/src/walker.ts` is the entry point for repo discovery — it produces the file list that feeds the indexer and ledger. `packages/core/src/update.ts` consumes status + manifest to build a small `WorkPackage` (rather than re-reading the repo), records a `package_emitted` metric via `update-metrics.ts`, and exposes `recordDocWrittenBack` so the agent's writes get counted. `packages/core/src/verify.ts` walks the wiki from disk (not from the database) and cross-references anchors, manual blocks, and internal links. Test files in this set only provide local filesystem fixtures (`writeCode`, `writeWiki`, `setupWithAnchor`, `write`) and do not affect production behavior.

## Repository walking and `.gitignore` filtering
<!-- lw:anchors packages/core/src/walker.ts#EXTENSION_LANG packages/core/src/walker.ts#buildIgnore packages/core/src/walker.ts#walkRepo packages/core/src/walker.test.ts#write -->

The walker uses the npm `ignore` library to combine defaults with the repo's own `.gitignore` and any caller-supplied extra patterns:

```ts
export const EXTENSION_LANG: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".jsx": "tsx",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
};
```

```ts
async function buildIgnore(repoRoot: string, opts: WalkOptions): Promise<ReturnType<typeof ignore>> {
```

`buildIgnore` always seeds the filter with `.git/`, `node_modules/`, `.livewiki/`, `dist/`, and `coverage/` as depth-in-depth defaults, then attempts to read `.gitignore` from `repoRoot`. A missing `.gitignore` is swallowed silently — the walker still runs on a fresh repo with just the defaults. `opts.extraIgnores` is appended last, overriding the gitignore when patterns conflict (the test "extraIgnores sobrepõe ao .gitignore" verifies this: even if a pattern is added twice, the file stays ignored).

```ts
export async function walkRepo(
```

`walkRepo` is iterative and stack-based rather than recursive, so deep repositories do not blow the call stack. Each directory is enumerated once with `readdir({ withFileTypes: true })`; symlinks and other non-file/non-directory entries are skipped (per the module header). Files whose extension is not in `EXTENSION_LANG` are dropped. Results carry POSIX-style relative paths and are sorted by `path.localeCompare` for stable diffs across runs. The supplied source confirms the normal path; if `readdir` fails on a directory, the walker logs a warning and continues — this is the only visible failure branch in the excerpt.

The test helper `write` is a one-liner for creating temp files under a per-test `repoRoot`.

## Incremental work package construction
<!-- lw:anchors packages/core/src/update.ts#CHARS_PER_TOKEN packages/core/src/update.ts#loadWorkPackage packages/core/src/update.ts#snippetForSymbol packages/core/src/update.ts#lookupSymbol packages/core/src/update.ts#recordDocWrittenBack packages/core/src/update.test.ts#setupWithAnchor packages/core/src/update.test.ts#writeCode packages/core/src/update.test.ts#writeWiki -->

```ts
export const CHARS_PER_TOKEN = 4;
```

```ts
export async function loadWorkPackage(
```

`loadWorkPackage` is the heart of Fase 5. It (1) reads the manifest, (2) reuses `runStatus` to obtain open debt, (3) for each debt item with a `symbol_key` it asks `snippetForSymbol` to extract a windowed source excerpt, (4) collects the unique `symbol_key` set as `validAnchors`, (5) serializes the package and estimates its size in tokens with `Math.ceil(json.length / CHARS_PER_TOKEN)`, and (6) records a `package_emitted` metric. The estimate is a coarse heuristic — ~4 chars/token for code/English. The package is intentionally narrow: only debt items, only a bounded number of snippets, and only anchors that match active symbols, so the agent receives roughly hundreds of tokens rather than the whole repo. The excerpt does not establish exhaustive behavior for unusual debt shapes (e.g. debt items with no `symbol_key` are silently skipped before snippet extraction).

```ts
async function snippetForSymbol(
```

`snippetForSymbol` splits the symbol key at `#`, reads the file from disk under `absRoot`, and looks for a defining line by simple textual match (`function name`, `class name`, `def name`, `const name`, and their `export` variants). On miss it falls back to `lookupSymbol`, which queries the SQLite index via `openIndex` for an authoritative `startLine`/`endLine`. If even the index misses, the snippet is taken from the top of the file — the agent still gets *some* context. The `absRoot` parameter is the resolved absolute repo root supplied by the caller; the function returns `null` when the source file has been deleted.

```ts
async function lookupSymbol(
```

`lookupSymbol` opens the index (best-effort) and returns the indexed symbol row for a given key; the supplied source does not show the full SELECT/return shape, so its precise fields beyond `startLine`/`endLine` cannot be confirmed from the excerpt.

```ts
export async function recordDocWrittenBack(
```

`recordDocWrittenBack` is the agent-side counterpart to the package emission: it appends a `write_received` entry to the metrics journal. The supplied source is truncated before the function body, so the exact arguments and error semantics are not visible in the excerpt.

Test helpers `writeCode`, `writeWiki`, and `setupWithAnchor` create temp source/wiki files and prime the indexer + ledger so debt actually appears (without a pre-existing anchor in a wiki page, the ledger has nothing to compare against, and the test "detecta changed quando source é modificado (anchor existente)" demonstrates this prerequisite).

## Metrics journal for incremental accounting
<!-- lw:anchors packages/core/src/update-metrics.ts#metricsPath packages/core/src/update-metrics.ts#readMetrics packages/core/src/update-metrics.ts#writeMetrics packages/core/src/update-metrics.ts#recordUpdateMetric packages/core/src/update-metrics.ts#snapshotMetrics packages/core/src/update-metrics.ts#clearMetricsForTests -->

The metrics module persists a small append-only JSON file at `.livewiki/update_metrics.json`. Its `UpdateMetric` is a discriminated union: `package_emitted` carries `tokensEstimated`, `bytes`, and `debtCount`; `write_received` carries `wikiPath`, `bytes`, and `tokensEstimated`.

```ts
async function metricsPath(repoRoot: string): Promise<string> {
```

`metricsPath` resolves the absolute path via `safeIo.resolveAndValidate`, ensuring writes never escape the repo root.

```ts
async function readMetrics(repoRoot: string): Promise<UpdateMetricsFile> {
```

`readMetrics` reads and parses the file. If the file is missing, unreadable, malformed, or has an unexpected `version` / non-array `entries`, it returns a fresh `{ version: 1, entries: [] }` — corrupted state is treated as empty rather than fatal.

```ts
async function writeMetrics(repoRoot: string, file: UpdateMetricsFile): Promise<void> {
```

`writeMetrics` serializes the file with two-space indent and a trailing newline, written through `safeIo.writeText` to keep the file under the repo boundary.

```ts
export async function recordUpdateMetric(
```

`recordUpdateMetric` is fire-and-forget by design: it reads, appends, writes, and swallows any thrown error so accounting never blocks the main `update` flow. The empty `catch {}` block in the source is the visible fail-open branch — a corrupt disk or permission error is silently dropped.

```ts
export async function snapshotMetrics(repoRoot: string): Promise<UpdateMetricsSnapshot> {
```

`snapshotMetrics` aggregates the journal in a single pass, counting `package_emitted` and `write_received` entries, summing their `tokensEstimated`, remembering the last entry of each kind, and computing `efficiencyRatio = totalWriteTokens / totalPackageTokens` (or `null` when no package has been emitted yet). The interface documents the ratio's intent: values below 1.0 mean the agent wrote fewer tokens than it received, which is the product thesis.

```ts
export async function clearMetricsForTests(repoRoot: string): Promise<void> {
```

`clearMetricsForTests` is destructive — it ensures `.livewiki/` exists and writes an empty file. The header comment marks it as test-only; production code must not call it.

## Wiki verification: anchors, manual blocks, and links
<!-- lw:anchors packages/core/src/verify.ts#run packages/core/src/verify.ts#collectWikiPages packages/core/src/verify.ts#collectWikiArtifactPaths packages/core/src/verify.ts#collectSectionSlugs packages/core/src/verify.ts#resolveWikiLink packages/core/src/verify.ts#isInsideWiki packages/core/src/verify.ts#formatHuman packages/core/src/verify.test.ts#writeCode packages/core/src/verify.test.ts#writeWiki -->

```ts
export async function run(repoRoot: string): Promise<VerifyResult> {
```

`run` is the orchestrator. It opens the index (read-only), builds a `key → SymbolRow` map of active symbols, loads `doc_pages` and `manual_blocks` for the rule-#6 byte-for-byte check, walks the wiki **from disk** (per Fix C — anchors in freshly written pages must be validated without re-indexing), and iterates each page. For each page it: extracts anchors, flags any anchor whose key is not in `activeSymbols` as `broken_anchor` (error severity); compares the multiset of stored `manual_blocks` content hashes against the current page to detect any missing or altered block as `manual_block_altered` (error); and finally scans internal links with a regex that matches `.md` and `.mmd` targets, after `maskCodeSpans` has stripped fenced and inline code so example syntax in the prose is not treated as a real link. The excerpt is truncated mid-scan, so the exact link-resolution branch behavior after `resolveWikiLink` returns a path is not fully visible.

```ts
async function collectWikiPages(absRoot: string): Promise<{ relPath: string }[]> {
```

`collectWikiPages` enumerates the `livewiki/` namespace on disk. The supplied source only shows the signature, not the traversal logic.

```ts
async function collectWikiArtifactPaths(absRoot: string): Promise<Set<string>> {
```

`collectWikiArtifactPaths` builds the existence set used for link resolution, including non-`.md` artifacts such as `.mmd` diagrams so that overview pages linking to class diagrams are caught the same way as broken page links.

```ts
async function collectSectionSlugs(
```

`collectSectionSlugs` is invoked once per wiki page to feed the section-anchor side of internal link checks. The signature is truncated; the function presumably invokes the shared `slugify` helper.

```ts
function resolveWikiLink(fromRelPath: string, linkRaw: string): string | null {
```

`resolveWikiLink` consolidates the three link cases called out in the source: absolute `livewiki/...` paths used as-is, root-anchored `/foo.md` resolved from the repo root, and `./` / `../` / bare-name links resolved relative to the linking page's directory. It returns `null` for malformed inputs; the caller then silently skips them (they may be external links or absolute paths that aren't wiki artifacts).

```ts
function isInsideWiki(wikiPath: string): boolean {
```

`isInsideWiki` is the allowlist check: a resolved link is only considered a candidate wiki artifact if it stays under the `livewiki/` namespace. The test "link relativo que escapa do namespace livewiki/" asserts the combined effect: a `../../etc/secrets.md` link is reported as `broken_internal_link` with `severity: "warning"` and a detail matching `/fora de livewiki/`.

```ts
export function formatHuman(result: VerifyResult): string {
```

`formatHuman` formats a `VerifyResult` for human-readable CLI output. The signature is visible; the body is not in the excerpt.

Test helpers `writeCode` and `writeWiki` mirror the `update.test.ts` helpers — they create temp files under a per-test `repoRoot` and create parent directories as needed. They do not call into `verify.ts` themselves; they only stage the filesystem state the test cases then assert against.

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
- [Batch orchestration, configuration, index, and diagram generation](core-src-03.md) — dependency and dependent
- [Stage-5 planning, prompt templates, and safe disk I/O core](core-src-08.md) — dependency and dependent
- [Livewiki core source — export, flows, frontmatter, gitignore, hashes](core-src-04.md) — dependency
<!-- livewiki:navigate:end -->
