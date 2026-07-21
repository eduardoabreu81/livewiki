---
title: Update, verify, walker and metrics
owner: generated
anchors:
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

# Update, verify, walker and metrics

This page documents the incremental `update` command, the `verify` wiki validator, the `walker` that drives the indexer, and the JSON-based token accounting that backs `status --json`.

## When to use this page

- **Run** incremental documentation by calling `loadWorkPackage` and inspecting `debt`/`snippets`/`validAnchors`.
- **Validate** wiki integrity with `verify.run` and human-readable output via `verify.formatHuman`.
- **Walk** a repository and produce indexable file entries with `walkRepo` and `EXTENSION_LANG`.
- **Record** token accounting with `recordUpdateMetric` and read aggregated `snapshotMetrics`.

## How it fits

The `update`, `verify`, and `walker` modules sit in `packages/core/src` and form the heart of the livewiki CLI. `walker` is the foundation: it enumerates source files respecting `.gitignore` and feeds the indexer. `verify` consumes that index plus on-disk wiki pages to detect broken anchors, manual-block tampering, and broken internal links. `update` ties both together: it asks `status` for open debt, slices the relevant source via `snippetForSymbol`/`lookupSymbol`, estimates a focused ~800-token package, and writes a `package_emitted` entry through `recordUpdateMetric`. The test files in this module set up temporary repos, write code and wiki fixtures, and exercise both production symbols and the test-only helpers `setupWithAnchor`, `writeCode`, `writeWiki`, and `write`.

## Update metrics — token accounting

<!-- lw:anchors packages/core/src/update-metrics.ts#clearMetricsForTests packages/core/src/update-metrics.ts#metricsPath packages/core/src/update-metrics.ts#readMetrics packages/core/src/update-metrics.ts#recordUpdateMetric packages/core/src/update-metrics.ts#snapshotMetrics packages/core/src/update-metrics.ts#writeMetrics -->

The accounting file lives at `.livewiki/update_metrics.json` and stores an append-only list of discriminated-union entries (`package_emitted` or `write_received`).

```ts
async function metricsPath(repoRoot: string): Promise<string>
async function readMetrics(repoRoot: string): Promise<UpdateMetricsFile>
async function writeMetrics(repoRoot: string, file: UpdateMetricsFile): Promise<void>
export async function recordUpdateMetric(repoRoot: string, metric: UpdateMetric): Promise<void>
export async function snapshotMetrics(repoRoot: string): Promise<UpdateMetricsSnapshot>
export async function clearMetricsForTests(repoRoot: string): Promise<void>
```

`metricsPath` resolves the JSON path through `safeIo.resolveAndValidate`. `readMetrics` parses the file; if `parsed.version !== 1` or `entries` is not an array, or any parse/read error occurs, it returns `{ version: 1, entries: [] }` (a corruption recovery path that lets the next `update` rebuild the ledger from zero). `writeMetrics` serializes the file via `safeIo.writeText`. `recordUpdateMetric` appends a new entry and is intentionally best-effort — the entire body is wrapped in `try { ... } catch { /* best-effort */ }`, so an accounting failure does NOT propagate and does NOT block the calling operation. `snapshotMetrics` aggregates totals and computes `efficiencyRatio = totalWriteTokens / totalPackageTokens` (or `null` when no package has been emitted yet) for `status --json`. `clearMetricsForTests` is destructive and is documented as test-only; it ensures `.livewiki/` exists and rewrites the metrics file with an empty entries array.

## Update — incremental work package

<!-- lw:anchors packages/core/src/update.ts#CHARS_PER_TOKEN packages/core/src/update.ts#loadWorkPackage packages/core/src/update.ts#lookupSymbol packages/core/src/update.ts#recordDocWrittenBack packages/core/src/update.ts#snippetForSymbol -->

`update` is the focal point of the product thesis: instead of re-reading the whole repo (~12.5k tokens), the agent receives a focused package (~800 tokens) with only the debt and snippets.

```ts
export const CHARS_PER_TOKEN = 4
export async function loadWorkPackage(repoRoot: string, opts?: WorkPackageOptions): Promise<WorkPackage>
async function snippetForSymbol(absRoot: string, symbolKey: string, window: number): Promise<DebtSnippet | null>
async function lookupSymbol(absRoot: string, symbolKey: string): Promise<...>
export async function recordDocWrittenBack(repoRoot: string, payload: ...): Promise<void>
```

`loadWorkPackage` reads the manifest via `readManifest`, queries open debt through `runStatus`, builds snippets with a default window of 20 lines (overridable via `WorkPackageOptions.snippetWindow`, capped by `maxSnippets` defaulting to 50), collects sorted `validAnchors` from the debt's `symbol_key`s, serializes the package, estimates `tokensEstimated = ceil(json.length / CHARS_PER_TOKEN)`, and finally calls `recordUpdateMetric` with a `package_emitted` entry. The package's `manifest` field is `null` when no manifest was ever written. `snippetForSymbol` first tries a name-based line scan (matching patterns like `function ${symName}`, `class ${symName}`, `export async function ${symName}`, etc.); if no match, it falls back to `lookupSymbol` to read `startLine`/`endLine` from the symbol index; if that also fails, it returns a minimal first-`window`-lines snippet anchored at line 0. If the source file is unreadable (file gone), it returns `null`. `recordDocWrittenBack` is the counterpart to package emission: after the agent writes documentation, it appends a `write_received` entry so `snapshotMetrics` can compute the efficiency ratio. The excerpt does not establish exhaustive behavior for every error branch inside `loadWorkPackage` — only the normal path plus the visible `recordUpdateMetric` swallow-and-continue is shown.

## Update test helpers

<!-- lw:anchors packages/core/src/update.test.ts#setupWithAnchor packages/core/src/update.test.ts#writeCode packages/core/src/update.test.ts#writeWiki -->

The `update.test.ts` fixture layer spins up a `mkdtemp` repo, runs `clearMetricsForTests` in `beforeEach`, and tears down in `afterEach`.

```ts
async function writeCode(rel: string, content: string): Promise<void>
async function writeWiki(rel: string, content: string): Promise<void>
async function setupWithAnchor(): Promise<void>
```

`writeCode` and `writeWiki` both create parent directories and write a file relative to `repoRoot` (the two helpers are structurally identical — both write a UTF-8 file — but are split so callers signal intent). `setupWithAnchor` is the canonical anchor fixture: it writes `src/foo.ts` with `export function bar()`, runs the indexer and ledger, writes a `livewiki/foo.md` page whose frontmatter anchors `src/foo.ts#bar`, then re-runs the indexer and ledger so the debt pipeline sees the anchor. Without this setup, the ledger does not emit debt and `loadWorkPackage` returns an empty package.

## Verify — wiki validator

<!-- lw:anchors packages/core/src/verify.ts#collectSectionSlugs packages/core/src/verify.ts#collectWikiArtifactPaths packages/core/src/verify.ts#collectWikiPages packages/core/src/verify.ts#formatHuman packages/core/src/verify.ts#isInsideWiki packages/core/src/verify.ts#resolveWikiLink packages/core/src/verify.ts#run -->

`verify` always reads wiki pages from disk (not from the index) so that pages created after the last `index` run are still checkable.

```ts
export async function run(repoRoot: string): Promise<VerifyResult>
async function collectWikiPages(absRoot: string): Promise<{ relPath: string }[]>
async function collectWikiArtifactPaths(absRoot: string): Promise<Set<string>>
async function collectSectionSlugs(absRoot: string, ...): Promise<...>
function resolveWikiLink(fromRelPath: string, linkRaw: string): string | null
function isInsideWiki(wikiPath: string): boolean
export function formatHuman(result: VerifyResult): string
```

`run` opens the SQLite index, builds a map of `activeSymbols`, loads `doc_pages` and `manual_blocks` baselines, then walks the wiki. For each page it extracts anchors via `extractAnchors`, reports `broken_anchor` for any symbol not in the active map (error severity, even for never-indexed pages — that is the anti-hallucination promise), and verifies stored manual blocks by comparing the multiset of SHA-256 hashes against currently-extracted blocks so duplicate blocks count correctly and offset shifts do not produce false positives. Internal links are matched with a regex targeting `.md`/`.mmd` targets after `maskCodeSpans` strips fenced/inline code; each link is fed to `resolveWikiLink`. `resolveWikiLink` handles three cases: an explicit `livewiki/` prefix (treated as absolute within the namespace), a leading `/` (absolute from repo root), and relative paths (resolved against the page's directory). `isInsideWiki` is the allowlist check used to flag links that escape the `livewiki/` namespace; the excerpt shows that escapes produce a `broken_internal_link` warning (not error, not blocking). `formatHuman` renders the `VerifyResult` for CLI consumption. The excerpt does not establish exhaustive behavior for every issue code beyond what is shown.

## Verify test helpers

<!-- lw:anchors packages/core/src/verify.test.ts#writeCode packages/core/src/verify.test.ts#writeWiki -->

```ts
async function writeCode(rel: string, content: string): Promise<void>
async function writeWiki(rel: string, content: string): Promise<void>
```

`verify.test.ts` mirrors the `update.test.ts` helpers: each creates the parent directory under a `mkdtemp` `repoRoot` and writes a UTF-8 file. Tests in this file exercise the four issue categories covered by the source — `broken_anchor` (including the fence-marker-ignore case), `broken_internal_link` (with namespace-escape detection), `manual_block_altered` (duplicate-block counting and missing-block detection), and the success path where valid anchors, intact manual blocks, and resolvable internal links all pass.

## Walker — repository traversal

<!-- lw:anchors packages/core/src/walker.ts#EXTENSION_LANG packages/core/src/walker.ts#buildIgnore packages/core/src/walker.ts#walkRepo -->

The walker is the entry point that every other command relies on for the file inventory.

```ts
export const EXTENSION_LANG: Record<string, string>
async function buildIgnore(repoRoot: string, opts: WalkOptions): Promise<ReturnType<typeof ignore>>
export async function walkRepo(repoRoot: string, opts?: WalkOptions): Promise<WalkResult[]>
```

`EXTENSION_LANG` is a static map from file extension (lowercased) to a recognized language: `.ts`→`typescript`, `.tsx`→`tsx`, `.js`/`.mjs`/`.cjs`→`javascript`, `.jsx`→`tsx`, `.py`→`python`. `buildIgnore` composes an `ignore` instance with hard-coded defaults (`.git/`, `node_modules/`, `.livewiki/`, `dist/`, `coverage/`), then appends the repo's `.gitignore` if readable (a missing `.gitignore` is silently tolerated), then appends `opts.extraIgnores` if supplied. `walkRepo` does a stack-based directory traversal using `readdir({ withFileTypes: true })`; each entry's path is converted to POSIX form before being tested against the ignore filter. Subdirectories are pushed to the stack, files with a recognized extension are recorded as `{ path, lang }` (extensionless or unknown-extension files are silently skipped), and symlinks are implicitly dropped because `entry.isFile()`/`isDirectory()` return `false`. The final result is sorted by path for stable diffs between runs. The traversal emits `console.warn` and `continue`s past directories it cannot read; the excerpt does not establish exhaustive behavior for every permission-failure branch.

## Walker test helper

<!-- lw:anchors packages/core/src/walker.test.ts#write -->

```ts
async function write(rel: string, content = ""): Promise<void>
```

`walker.test.ts` provides a single `write` fixture that creates the parent directory under a `mkdtemp` `repoRoot` and writes a UTF-8 file with a default empty body. Tests cover language detection across the supported extensions, default ignore of `node_modules/`, `.git/`, `dist/`, `coverage/`, respect for the repo's `.gitignore`, layering of `extraIgnores` over `.gitignore`, POSIX path normalization, stable ordering, skip-on-unknown-extension behavior, and walk behavior in a repo without a `.gitignore`.

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
- [Batch orchestration, config, index DB, and diagram generators](core-src-03.md) — dependency and dependent
- [Core prompt, I/O allowlist, symbol extraction, status and topic planning](core-src-08.md) — dependency and dependent
- [Wiki export, flow detection, and parser helpers](core-src-04.md) — dependency
<!-- livewiki:navigate:end -->
