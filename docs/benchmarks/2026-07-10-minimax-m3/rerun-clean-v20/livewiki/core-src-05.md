---
title: core SRC — incremental update, verification and walker
owner: generated
anchors:
  - packages/core/src/symbols.ts#extractSymbols
  - packages/core/src/symbols.ts#makeRecord
  - packages/core/src/symbols.ts#signatureFor
  - packages/core/src/symbols.ts#toSymbolRecord
  - packages/core/src/symbols.ts#walkNode
  - packages/core/src/update-metrics.ts#clearMetricsForTests
  - packages/core/src/update-metrics.ts#metricsPath
  - packages/core/src/update-metrics.ts#readMetrics
  - packages/core/src/update-metrics.ts#recordUpdateMetric
  - packages/core/src/update-metrics.ts#snapshotMetrics
  - packages/core/src/update-metrics.ts#writeMetrics
  - packages/core/src/update.test.ts#setupWithAnchor
  - packages/core/src/update.test.ts#writeCode
  - packages/core/src/update.test.ts#writeWiki
  - packages/core/src/update.ts#CHARS_PER_TOKEN
  - packages/core/src/update.ts#loadWorkPackage
  - packages/core/src/update.ts#lookupSymbol
  - packages/core/src/update.ts#recordDocWrittenBack
  - packages/core/src/update.ts#snippetForSymbol
  - packages/core/src/verify.test.ts#writeCode
  - packages/core/src/verify.test.ts#writeWiki
  - packages/core/src/verify.ts#collectSectionSlugs
  - packages/core/src/verify.ts#collectWikiArtifactPaths
  - packages/core/src/verify.ts#collectWikiPages
  - packages/core/src/verify.ts#formatHuman
  - packages/core/src/verify.ts#isInsideWiki
  - packages/core/src/verify.ts#resolveWikiLink
  - packages/core/src/verify.ts#run
  - packages/core/src/walker.test.ts#write
  - packages/core/src/walker.ts#EXTENSION_LANG
  - packages/core/src/walker.ts#buildIgnore
  - packages/core/src/walker.ts#walkRepo
---

# core SRC — incremental update, verification and walker

This module's responsibility is to extract code symbols from a tree-sitter AST, compute the incremental documentation debt of a repo, drive the wiki-against-code verification pass, and walk source files honoring `.gitignore`.

## When to use this page

- **Trace** how a single tree-sitter node becomes a `SymbolRecord` and what makes the symbol key unique across files.
- **Inspect** the on-disk metrics ledger (`.livewiki/update_metrics.json`) used to expose the read/write token economy of the incremental update flow.
- **Reason about** the shape of a `WorkPackage` and how `loadWorkPackage` assembles manifest, debt, snippets, valid anchors and the `package_emitted` metric.
- **Understand** how `verify` collects wiki pages from disk, resolves `.md`/`.mmd` links and detects altered manual blocks byte-for-byte.

## How it fits

`packages/core/src/symbols.ts`, `update.ts`, `update-metrics.ts`, `verify.ts` and `walker.ts` form the core's middle and right pillars. `walker.ts` enumerates indexable files (TS/TSX/JS/JSX/Python), the symbol extractor reads each AST and emits `SymbolRecord`s, and `update.ts` plus `update-metrics.ts` together drive the incremental phase where a focused `WorkPackage` is offered to the agent and its write-back is accounted. `verify.ts` reads the wiki fresh from disk and reconciles anchors, internal links and preserved manual blocks against the index. Test files (`*.test.ts`) live next to their subjects and rely on per-test temp directories plus small helpers that mirror the production filesystem layout.

## Symbol extraction from the AST
<!-- lw:anchors packages/core/src/symbols.ts#extractSymbols packages/core/src/symbols.ts#makeRecord packages/core/src/symbols.ts#signatureFor packages/core/src/symbols.ts#toSymbolRecord packages/core/src/symbols.ts#walkNode -->

```ts
export function extractSymbols(
  tree: Tree,
  relPath: string,
  source: string,
): SymbolRecord[]
```

`extractSymbols` walks a tree-sitter `Tree` and collects every referencable symbol in `relPath` (forward-slash, repo-relative). The result is de-duplicated by `key` and ordered first by `start_line`, then by `source_start_byte`, with discovery order as the final tie-breaker. Anonymous arrow functions and IIFEs are deliberately skipped: the symbol key has to be referencable, and a name is part of that contract.

```ts
function walkNode(
  node: Node,
  source: string,
  relPath: string,
  parentClassName: string | null,
  out: ExtractedSymbol[],
): void
```

`walkNode` dispatches on `node.type` and recognises `function_declaration`, `generator_function_declaration`, `class_declaration`, `method_definition`, `export_statement`, `function_definition`, `class_definition` and `decorated_definition`. For class bodies it descends manually (returning afterwards) so that `parentClassName` is threaded into nested `method_definition` / `function_definition` children — which is how Python methods become `Class.method`. `export_statement` is special: if the inner declaration is a function or a class the export emits a single entry (matching the inner kind) and does not descend again, preventing double-counting. `export const foo = …` emits one entry per declarator with `kind: "export"`.

```ts
function makeRecord(
  node: Node,
  source: string,
  relPath: string,
  name: string,
  kind: SymbolKind,
): ExtractedSymbol
```

`makeRecord` builds the candidate row: `key` is `${relPath}#${name}` (with the parent prefix already merged into `name` for methods), `name` is the last segment, `signature` is captured by `signatureFor`, `start_line` / `end_line` come from the node, and `content_hash` is a SHA-256 over a slice of the source.

```ts
function signatureFor(node: Node, source: string): string | null
```

`signatureFor` produces a small header (first line of the declaration) used as a human-friendly anchor hint. It may return `null` if the slice is empty or not extractable; downstream consumers must tolerate that.

```ts
function toSymbolRecord(symbol: ExtractedSymbol): SymbolRecord
```

`toSymbolRecord` strips the internal `source_start_byte` field and freezes the record into the public `SymbolRecord` shape — the byte offset is only used to break ordering ties inside `extractSymbols` and is not part of the on-disk index.

## Incremental token metrics
<!-- lw:anchors packages/core/src/update-metrics.ts#clearMetricsForTests packages/core/src/update-metrics.ts#metricsPath packages/core/src/update-metrics.ts#readMetrics packages/core/src/update-metrics.ts#recordUpdateMetric packages/core/src/update-metrics.ts#snapshotMetrics packages/core/src/update-metrics.ts#writeMetrics -->

```ts
async function metricsPath(repoRoot: string): Promise<string>
async function readMetrics(repoRoot: string): Promise<UpdateMetricsFile>
async function writeMetrics(repoRoot: string, file: UpdateMetricsFile): Promise<void>
export async function recordUpdateMetric(
  repoRoot: string,
  metric: UpdateMetric,
): Promise<void>
export async function snapshotMetrics(repoRoot: string): Promise<UpdateMetricsSnapshot>
export async function clearMetricsForTests(repoRoot: string): Promise<void>
```

The metrics file lives at `.livewiki/update_metrics.json` with `version: 1` and an append-only `entries: UpdateMetric[]` array. Each entry is a discriminated union of `package_emitted` (emitted by `loadWorkPackage`) and `write_received` (emitted by `recordDocWrittenBack`). The file is intentionally reconstructable: deleting `.livewiki/` simply resets accounting to zero.

`readMetrics` parses the JSON and, on `JSON.parse` failure or a shape mismatch (`version !== 1` or non-array `entries`), resets to an empty file — the regex "regra #3: tudo importante está versionado". `writeMetrics` persists the file through `safeIo.writeText` with a trailing newline. `metricsPath` resolves the absolute path via `safeIo.resolveAndValidate`, ensuring the target stays inside `repoRoot`.

`recordUpdateMetric` is best-effort: it reads, appends, writes, and swallows any error so accounting never blocks the primary `update` flow. `snapshotMetrics` reduces the file into an `UpdateMetricsSnapshot` (counts, totals, `efficiencyRatio = totalWriteTokens / totalPackageTokens` when `totalPackageTokens > 0`, plus the last entry of each kind). `clearMetricsForTests` is destructive and is documented as test-only.

## Update pipeline and work package
<!-- lw:anchors packages/core/src/update.ts#CHARS_PER_TOKEN packages/core/src/update.ts#loadWorkPackage packages/core/src/update.ts#lookupSymbol packages/core/src/update.ts#recordDocWrittenBack packages/core/src/update.ts#snippetForSymbol packages/core/src/update.test.ts#setupWithAnchor packages/core/src/update.test.ts#writeCode packages/core/src/update.test.ts#writeWiki -->

```ts
export const CHARS_PER_TOKEN = 4;
export async function loadWorkPackage(
  repoRoot: string,
  opts?: WorkPackageOptions,
): Promise<WorkPackage>
async function snippetForSymbol(
  absRoot: string,
  symbolKey: string,
  window: number,
): Promise<DebtSnippet | null>
export async function recordDocWrittenBack(
  repoRoot: string,
  wikiPath: string,
  bytes: number,
  tokensEstimated: number,
): Promise<void>
```

`loadWorkPackage` is the entry point of the incremental phase. It reads the manifest (possibly `null` on a never-initialised repo), pulls the debt list from `status`, builds up to `opts.maxSnippets ?? 50` snippets via `snippetForSymbol`, computes `validAnchors` as the unique, sorted, non-null `symbol_key` values from the debt list, serialises the package, sizes it (`tokensEstimated = ceil(json.length / CHARS_PER_TOKEN)`, `bytes = json.length`) and finally records a `package_emitted` metric. The visible source does not show a try/catch around `recordUpdateMetric`, but the metrics helper itself is best-effort and never throws back into the caller.

`snippetForSymbol` splits a `path#name` symbol key, reads the source from disk (returning `null` if the file is gone) and slices a window of `±window` lines around the symbol. It returns a `DebtSnippet` containing the snippet text, repo-relative `filePath`, `startLine` and `endLine`.

`recordDocWrittenBack` is the agent/HUMAN write-back hook: it appends a `write_received` metric so that `snapshotMetrics`'s `efficiencyRatio` reflects the cost of paying the debt.

`CHARS_PER_TOKEN` is the ~4 chars/token heuristic exposed as a constant so tests can assert against it.

The accompanying test file uses two helpers and one setup: `writeCode` and `writeWiki` create files inside a per-test temp repo, and `setupWithAnchor` writes a code file, indexes it, runs the anchor ledger, writes a wiki page with the matching frontmatter anchor, and re-runs both index/ledger steps — required because without an existing anchor the ledger cannot detect change.

## Verifying the wiki against the code
<!-- lw:anchors packages/core/src/verify.ts#collectSectionSlugs packages/core/src/verify.ts#collectWikiArtifactPaths packages/core/src/verify.ts#collectWikiPages packages/core/src/verify.ts#formatHuman packages/core/src/verify.ts#isInsideWiki packages/core/src/verify.ts#resolveWikiLink packages/core/src/verify.ts#run packages/core/src/verify.test.ts#writeCode packages/core/src/verify.test.ts#writeWiki -->

```ts
export async function run(repoRoot: string): Promise<VerifyResult>
async function collectWikiPages(absRoot: string): Promise<{ relPath: string }[]>
async function collectWikiArtifactPaths(absRoot: string): Promise<Set<string>>
async function collectSectionSlugs(
  absRoot: string,
  relPath: string,
): Promise<Set<string>>
function resolveWikiLink(fromRelPath: string, linkRaw: string): string | null
function isInsideWiki(wikiPath: string): boolean
export function formatHuman(result: VerifyResult): string
```

`run` opens the SQLite index, loads `active` symbols into a map keyed by `symbol.key`, builds per-`wiki_path` collections of stored manual blocks, and walks the wiki from disk (not from `doc_pages`) so freshly written pages are still verifiable without re-indexing — this is the "Fix C" / anti-alucination guarantee. For every page it extracts anchors (page and section), checks each anchor against `activeSymbols` (a missing reference produces a `broken_anchor` error), reconciles manual blocks by matching stored hashes against the current page's hash multiset (a missing/changed block produces a `manual_block_altered` error), and scans internal links with the regex `\[([^\]]*)\]\(([^)#]+\.(?:md|mmd))(#([^)]+))?\)` against `sourceForLinks` (code-fenced spans are masked first). The walk emits a `missing_wiki_path` when a `doc_pages` row no longer exists on disk.

`collectWikiPages` enumerates the on-disk wiki, `collectWikiArtifactPaths` widens the existence set to include `.mmd` diagrams so links to overviews can be checked the same way as page links, and `collectSectionSlugs` provides the per-page set of section slugs used to validate the optional `#section` portion of a link. `resolveWikiLink` resolves a link relative to the source page using `path.posix` (so `..` segments are handled correctly) and `isInsideWiki` enforces the `livewiki/` allowlist, flagging escapes as `broken_internal_link` (severity: warning). `formatHuman` renders a `VerifyResult` for the CLI.

The accompanying `verify.test.ts` mirrors the on-disk layout: per-test temp directories, `writeCode` and `writeWiki` helpers, and assertions that broken anchors (missing symbol or missing file) are detected, valid anchors pass cleanly, escaped links are flagged without blocking, and preserved manual blocks survive offset shifts or are reported as altered when their bytes change.

## Repository walker
<!-- lw:anchors packages/core/src/walker.ts#EXTENSION_LANG packages/core/src/walker.ts#buildIgnore packages/core/src/walker.ts#walkRepo packages/core/src/walker.test.ts#write -->

```ts
export const EXTENSION_LANG: Record<string, string>
async function buildIgnore(repoRoot: string, opts: WalkOptions): Promise<ReturnType<typeof ignore>>
export async function walkRepo(
  repoRoot: string,
  opts?: WalkOptions,
): Promise<WalkResult[]>
```

`EXTENSION_LANG` is the extension-to-language map for the MVP: `.ts → typescript`, `.tsx → tsx`, `.js → javascript`, `.jsx → tsx`, `.mjs/.cjs → javascript`, `.py → python`.

`buildIgnore` composes the filter: always-on defaults (`.git/`, `node_modules/`, `.livewiki/`, `dist/`, `coverage/`), then the repo's `.gitignore` if readable (silently skipped otherwise), then any `opts.extraIgnores`. `walkRepo` then drives a stack-based recursive descent (no recursion depth risk on deep repos) over `repoRoot`, converts each entry to a forward-slash relative path for `ignore()`, recurses into directories, and pushes a `{ path, lang }` only for files whose extension maps via `EXTENSION_LANG`. A `readdir` failure is logged via `console.warn` and that directory is skipped; symlinks and other non-regular entries are intentionally not followed. Results are sorted by `path` for stable diffs between runs.

The accompanying `walker.test.ts` uses a `write` helper to materialise files inside a per-test temp root, then asserts: TS/TSX/JS/JSX/Python are recognised with the right `lang`; `node_modules/`, `.git/`, `dist/` and `coverage/` are skipped by default; repo `.gitignore` rules are honoured; `extraIgnores` compounds with defaults; paths are returned with forward slashes on every platform; output order is stable and sorted; unknown extensions are dropped; and a fresh repo with no `.gitignore` still benefits from the defaults.

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
- [Core pipeline orchestration, config, schema, and helpers](core-src-02.md) — dependency and dependent
- [Core navigation, parsing, pointer, presets, pricing, prompts, safe I/O, and status surface](core-src-04.md) — dependency and dependent
- [anchor ledger, artifact validation, and batch status](core-src-01.md) — dependency
<!-- livewiki:navigate:end -->
