---
title: Core incremental update, verify, and repo walker
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

# Core incremental update, verify, and repo walker

This page documents the livewiki core modules that power the incremental `update` mode, the `verify` check that validates the wiki against the code index, and the repo `walker` that enumerates indexable source files.

## When to use this page

- **Build an incremental doc-update flow** with `packages/core/src/update.ts#loadWorkPackage`, which assembles manifest + debt + snippets + valid anchors into a single JSON-serializable work package.
- **Account for token economics** between agent packages and written-back docs using the append-only metrics file exposed by `packages/core/src/update-metrics.ts`.
- **Validate a wiki** with `packages/core/src/verify.ts#run`, which walks the wiki from disk and reports broken anchors, broken internal links, altered manual blocks, and other issues.
- **Enumerate indexable files** for a repo with `packages/core/src/walker.ts#walkRepo`, which respects `.gitignore` plus a fixed default ignore set.

## How it fits

The `core` package is the engine room of livewiki: it holds the indexing, ledger, manifest, status, update, verify, and walker pipelines that every CLI command in `packages/cli` ultimately calls into. This page focuses on three of those pipelines as they are visible in the supplied source.

`packages/core/src/walker.ts` is the front door for any command that needs to know what files exist in the repo: it combines a fixed deny-list (`.git/`, `node_modules/`, `.livewiki/`, `dist/`, `coverage/`) with the repo's own `.gitignore` and any caller-supplied `extraIgnores`, then returns only files whose extensions map to a known language. Its output is what later gets fed into the indexer and the symbol/anchor ledger.

`packages/core/src/update.ts` is the heart of the incremental mode. Given a repo, `loadWorkPackage` reads the manifest, asks `status` for the open debt, slices a bounded window of source around each debt item's symbol key, computes a token estimate, and records a `package_emitted` metric. `recordDocWrittenBack` is the symmetric write-side hook that records a `write_received` metric so the snapshot can compute a write/package efficiency ratio. `packages/core/src/update-metrics.ts` owns the on-disk JSON file that backs this accounting: it is append-only, reconstructible, and intentionally separated from the SQLite index used by the rest of the system.

`packages/core/src/verify.ts` is the read-only validator. It opens the SQLite index to look up active symbols and stored manual-block baselines, but it always re-reads the wiki from disk so that newly written pages are caught. It collects pages, section slugs, and non-`.md` wiki artifacts, then runs broken-anchor, manual-block, and internal-link checks before producing a `VerifyResult` that `formatHuman` renders for humans.

Test files (`update.test.ts`, `verify.test.ts`, `walker.test.ts`) use temp-dir fixtures under `os.tmpdir()` and small helpers like `writeCode` / `writeWiki` / `write` to keep their cases hermetic.

## Repo file enumeration

<!-- lw:anchors packages/core/src/walker.ts#walkRepo packages/core/src/walker.ts#buildIgnore packages/core/src/walker.ts#EXTENSION_LANG packages/core/src/walker.test.ts#write -->

`packages/core/src/walker.ts#walkRepo` is the public entry point. The supplied signature from the symbol table is:

```ts
export async function walkRepo(
  repoRoot: string,
  opts: WalkOptions = {},
): Promise<WalkResult[]>
```

It runs `buildIgnore` once, then walks the tree with an explicit directory stack (not recursion) so deeply nested repos do not blow the call stack. For each file, it computes a POSIX-style relative path, asks the `ignore` filter whether that path is excluded, and only keeps entries whose extension is a key of `EXTENSION_LANG`. The walker does not follow symlinks — if a symlink is encountered, neither `isFile()` nor `isDirectory()` is true and the entry is skipped (which can surface as either an error or a quiet skip depending on filesystem behavior; this is documented as intentional in the module header). Directories that cannot be read emit a `console.warn` and are skipped, so a single permission error does not abort the whole walk. The returned list is sorted by path for stable diffs across runs.

`packages/core/src/walker.ts#buildIgnore` seeds the filter with the default deny-list, then attempts to layer `.livewiki/.gitignore` and finally the caller's `extraIgnores`. A missing `.gitignore` is not an error — the walker still runs with just the defaults, which is what enables fresh repos to be scanned immediately after `init`.

`packages/core/src/walker.ts#EXTENSION_LANG` is the extension→language map consumed by `walkRepo`; only paths whose extension is a key are returned. The visible mapping covers `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, and `.py`.

`packages/core/src/walker.test.ts#write` is the test-only fixture helper that creates parent directories recursively before writing the requested file content into a temp repo root. The supplied signature from the symbol table is:

```ts
async function write(rel: string, content = ""): Promise<void>
```

## Incremental update pipeline

<!-- lw:anchors packages/core/src/update.ts#CHARS_PER_TOKEN packages/core/src/update.ts#loadWorkPackage packages/core/src/update.ts#recordDocWrittenBack packages/core/src/update.ts#snippetForSymbol packages/core/src/update.ts#lookupSymbol -->

`packages/core/src/update.ts#CHARS_PER_TOKEN` is the constant `export const CHARS_PER_TOKEN = 4;`. It is the chars-per-token heuristic used to translate the JSON length of a serialized `WorkPackage` into a `tokensEstimated` field. The module header notes this is an approximation; Phase 6+ may swap in a real tokenizer.

`packages/core/src/update.ts#loadWorkPackage` is the command-side entry point for incremental mode. The supplied signature from the symbol table is:

```ts
export async function loadWorkPackage(
  repoRoot: string,
  opts: WorkPackageOptions = {},
): Promise<WorkPackage>
```

Internally it (1) reads the manifest via `readManifest`, (2) asks `runStatus` for the open debt items, (3) caps the debt at `maxSnippets` (default 50) and asks `snippetForSymbol` for a bounded source window around each debt item's symbol key, (4) collects the unique, sorted `symbol_key`s as `validAnchors`, (5) JSON-stringifies the whole package, computes `tokensEstimated` as `ceil(json.length / CHARS_PER_TOKEN)` and `bytes` as `json.length`, and (6) records a `package_emitted` metric through `recordUpdateMetric` as a side effect. If the manifest does not exist, `pkg.manifest` is `null` but the package is still emitted (the supplied tests cover both cases).

`packages/core/src/update.ts#recordDocWrittenBack` is the symmetric write-side hook. Its full signature is not in the supplied symbol table, so this page only describes what is visible in the supplied test source: it accepts a `repoRoot` plus a payload that carries at least `wikiPath`, `bytes`, and `tokensEstimated`, and it appends a `write_received` entry so that `snapshotMetrics` can reflect the new efficiency ratio. The metric is intentionally best-effort — see the metrics section below.

`packages/core/src/update.ts#snippetForSymbol` reads the source file for a given `symbolKey` (split on `#`), finds the symbol by simple name-matching patterns (`function name`, `class name`, `def name`, `const name`, `export function name`, `export class name`, `export const name`, `export async function name`), and falls back to `lookupSymbol` when name-matching fails. Its full signature is not in the supplied symbol table. If the file is gone, the function returns `null` — the caller in `loadWorkPackage` skips that debt item silently rather than throwing.

`packages/core/src/update.ts#lookupSymbol` is the symbol-row lookup helper consulted by `snippetForSymbol` when name-matching fails. Its full signature is not in the supplied symbol table; it returns enough information for the snippet helper to set `symStart = indexed.startLine - 1` and `symEnd = indexed.endLine`. If even the index lookup fails, the snippet helper degrades to a `window`-line slice starting at line 0 so the agent still gets some context.

## Update metrics accounting

<!-- lw:anchors packages/core/src/update-metrics.ts#metricsPath packages/core/src/update-metrics.ts#readMetrics packages/core/src/update-metrics.ts#writeMetrics packages/core/src/update-metrics.ts#recordUpdateMetric packages/core/src/update-metrics.ts#snapshotMetrics packages/core/src/update-metrics.ts#clearMetricsForTests packages/core/src/update.test.ts#writeCode packages/core/src/update.test.ts#writeWiki packages/core/src/update.test.ts#setupWithAnchor -->

`packages/core/src/update-metrics.ts#metricsPath` resolves the canonical on-disk location of the metrics file. The supplied signature from the symbol table is:

```ts
async function metricsPath(repoRoot: string): Promise<string>
```

It delegates to `safeIo.resolveAndValidate(repoRoot, ".livewiki/update_metrics.json")`, which both pins the file inside `.livewiki/` and rejects any caller trying to escape via `..`.

`packages/core/src/update-metrics.ts#readMetrics` reads and parses that JSON. The supplied signature from the symbol table is:

```ts
async function readMetrics(repoRoot: string): Promise<UpdateMetricsFile>
```

The implementation has two visible fallback paths: a `try` around `readFile` + `JSON.parse` whose `catch` returns an empty file (so first-run repos do not error), and an in-`try` shape check that returns `{ version: 1, entries: [] }` if the file exists but is structurally wrong (e.g. wrong `version` or non-array `entries`). This is the "tudo importante está versionado" recovery path called out in the module header.

`packages/core/src/update-metrics.ts#writeMetrics` is the persistence step. The supplied signature from the symbol table is:

```ts
async function writeMetrics(repoRoot: string, file: UpdateMetricsFile): Promise<void>
```

It writes pretty-printed JSON through `safeIo.writeText`, so the file path is again constrained to be inside `.livewiki/`.

`packages/core/src/update-metrics.ts#recordUpdateMetric` is the public append hook. Its full signature is not in the supplied symbol table; what is visible in source is:

```ts
export async function recordUpdateMetric(
  repoRoot: string,
  metric: UpdateMetric,
): Promise<void>
```

It reads, pushes, writes — but wraps the whole body in `try { ... } catch { /* best-effort */ }`. This is intentional and called out in the module header: a metrics write failure must never block the main `update` flow, so callers (including `loadWorkPackage` and `recordDocWrittenBack`) do not need to await a critical-section guarantee here.

`packages/core/src/update-metrics.ts#snapshotMetrics` is the read-side aggregator. The supplied signature from the symbol table is:

```ts
export async function snapshotMetrics(repoRoot: string): Promise<UpdateMetricsSnapshot>
```

It iterates `entries` once, accumulating `packagesEmitted` / `totalPackageTokens` and `writesReceived` / `totalWriteTokens` while tracking `lastPackage` and `lastWrite`. The `efficiencyRatio` is `totalWriteTokens / totalPackageTokens` when `totalPackageTokens > 0`, and `null` otherwise — so the product thesis ("< 1.0 means the agent wrote less than it read") can be exposed as `null` instead of `Infinity` for repos with no packages emitted yet.

`packages/core/src/update-metrics.ts#clearMetricsForTests` is a destructive test-only helper. The supplied signature from the symbol table is:

```ts
export async function clearMetricsForTests(repoRoot: string): Promise<void>
```

It creates `.livewiki/` if missing and writes an empty `version: 1` file. The module header warns explicitly that this helper must never be called from production code.

`packages/core/src/update.test.ts#setupWithAnchor` is the shared test fixture. The supplied signature from the symbol table is:

```ts
async function setupWithAnchor(): Promise<void>
```

It writes a `src/foo.ts` exporting `bar`, runs the indexer and anchor-ledger, drops a `livewiki/foo.md` whose frontmatter anchors `src/foo.ts#bar`, then runs the indexer and ledger again — producing a state where a follow-up edit to `foo.ts` will create real debt. The module header calls this out as required: without an anchor, the ledger cannot detect a change, and so `loadWorkPackage` would see zero debt.

`packages/core/src/update.test.ts#writeCode` and `packages/core/src/update.test.ts#writeWiki` are the symmetric filesystem helpers used by `setupWithAnchor` and the surrounding tests. Both have the supplied signature:

```ts
async function writeCode(rel: string, content: string): Promise<void>
async function writeWiki(rel: string, content: string): Promise<void>
```

They `mkdir -p` the parent directory and then `writeFile` the absolute path inside the test's temp `repoRoot`.

## Verify pipeline

<!-- lw:anchors packages/core/src/verify.ts#run packages/core/src/verify.ts#collectWikiPages packages/core/src/verify.ts#collectWikiArtifactPaths packages/core/src/verify.ts#collectSectionSlugs packages/core/src/verify.ts#resolveWikiLink packages/core/src/verify.ts#isInsideWiki packages/core/src/verify.ts#formatHuman packages/core/src/verify.test.ts#writeCode packages/core/src/verify.test.ts#writeWiki -->

`packages/core/src/verify.ts#run` is the public entry point. The supplied signature from the symbol table is:

```ts
export async function run(repoRoot: string): Promise<VerifyResult>
```

It ensures `.livewiki/` exists, opens the SQLite index at `.livewiki/index.db`, builds the active-symbol map and the per-path manual-block baseline, then walks the wiki from disk through `collectWikiPages`. The source-visible `IssueCode`s are `broken_anchor`, `broken_internal_link`, `invalid_mermaid_diagram`, `manual_block_altered`, and `missing_wiki_path`. For each wiki page it parses anchors, hashes any current manual blocks, and matches the multiset of stored hashes against current hashes (so identical stored blocks are not double-counted), pushing `manual_block_altered` errors for any unmatched stored block. Internal links are masked via `maskCodeSpans` before the link regex runs, so links inside fenced code blocks or inline code spans are not interpreted as real references. The regex matches `.md` and `.mmd` targets, and each match goes through `resolveWikiLink` + `isInsideWiki` to decide whether the resolved target is a valid wiki artifact; resolutions that escape the wiki namespace are reported as `broken_internal_link` with `severity: "warning"`.

`packages/core/src/verify.ts#collectWikiPages` is the wiki-from-disk enumerator. The supplied signature from the symbol table is:

```ts
async function collectWikiPages(absRoot: string): Promise<{ relPath: string }[]>
```

It exists so `run` does not depend on `doc_pages` from the database — Fix C of the spec is to catch anchor breakage in pages that have never been indexed.

`packages/core/src/verify.ts#collectWikiArtifactPaths` is the existence set used for link resolution. The supplied signature from the symbol table is:

```ts
async function collectWikiArtifactPaths(absRoot: string): Promise<Set<string>>
```

The module header notes that this set includes non-`.md` wiki artifacts (notably `.mmd` diagrams) so that overview-to-diagram links are caught the same way as broken page links.

`packages/core/src/verify.ts#collectSectionSlugs` populates the per-page section-slug set consumed by the link regex's `#section` branch. Its full signature is not in the supplied symbol table; what is visible in the source is that it is awaited per page from inside `run`.

`packages/core/src/verify.ts#resolveWikiLink` normalizes a raw link target against the page's directory. The supplied signature from the symbol table is:

```ts
function resolveWikiLink(fromRelPath: string, linkRaw: string): string | null
```

The source comment enumerates the three cases it handles: an absolute `livewiki/...` or `livewiki/` prefix that is used as-is, a repo-root-absolute `/foo.md` form, and a relative `./foo.md` / `../foo.md` / `foo.md` form. The previous bug, where the relative form was incorrectly prepended with `livewiki/` (turning a `../auth.md` into `livewiki/../auth.md`), is fixed by this function — it now returns a normalized POSIX path that `isInsideWiki` can check. It returns `null` for malformed inputs, which `run` treats as "skip silently".

`packages/core/src/verify.ts#isInsideWiki` is the allowlist gate. The supplied signature from the symbol table is:

```ts
function isInsideWiki(wikiPath: string): boolean
```

It decides whether a resolved link target still lives under the wiki namespace; if not, `run` emits a `broken_internal_link` warning whose `detail` notes that the link is "fora de livewiki".

`packages/core/src/verify.ts#formatHuman` is the human renderer. The supplied signature from the symbol table is:

```ts
export function formatHuman(result: VerifyResult): string
```

It takes the `VerifyResult` produced by `run` and returns a printable string suitable for CLI output.

`packages/core/src/verify.test.ts#writeCode` and `packages/core/src/verify.test.ts#writeWiki` are the symmetric temp-dir fixtures for the verify tests. Both have the supplied signature:

```ts
async function writeCode(rel: string, content: string): Promise<void>
async function writeWiki(rel: string, content: string): Promise<void>
```

The visible cases in the supplied test source cover: anchors pointing at symbols that do not exist (`broken_anchor`), anchors pointing at files that do not exist (`broken_anchor`), valid anchors (no `broken_anchor` issues), an internal link that escapes the wiki namespace (reported as `broken_internal_link` with `severity: "warning"`), manual blocks that match the stored hash after large offset shifts (no `manual_block_altered`), and manual blocks that have been altered (reported as `manual_block_altered` with `severity: "error"`). The supplied excerpt is truncated, so this list reflects only the visible cases — not necessarily all cases the test file covers.

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
- [Batch orchestration, config, index schema, and deterministic diagrams](core-src-03.md) — dependency and dependent
- [Core source — prompts, safe I/O, status, symbols, topics](core-src-08.md) — dependency and dependent
- [Export, frontmatter, flows, and hashing primitives](core-src-04.md) — dependency
<!-- livewiki:navigate:end -->
