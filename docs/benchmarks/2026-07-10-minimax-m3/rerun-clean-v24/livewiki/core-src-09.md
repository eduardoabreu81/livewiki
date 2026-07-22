---
title: Incremental update, metrics, and wiki verification
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

# Incremental update, metrics, and wiki verification

This page documents the module that powers livewiki's incremental `update` workflow, its append-only token accounting, the on-disk wiki verifier, and the file-system walker used to discover source files.

## When to use this page

- **Load** the per-repo update pipeline when you need to inspect how `loadWorkPackage` builds the focused work package emitted to an in-session agent.
- **Read** this page to understand the JSON-based metrics store (`.livewiki/update_metrics.json`), the `package_emitted` / `write_received` entry kinds, and the `efficiencyRatio` snapshot.
- **Verify** a wiki's integrity by following `run` in `verify.ts`, including broken-anchor detection, manual-block hash matching, and internal link resolution.
- **Walk** a repository using `walkRepo` to learn how `.gitignore`, defaults, and `extraIgnores` combine to produce the indexable file set.

## How it fits

This module sits inside `packages/core/src/` and is the backbone of livewiki's Phase 5 incremental mode. `update.ts` reads the manifest, asks `status.ts` for open debt items, fetches snippets for each debt symbol, and writes a JSON `WorkPackage` annotated with a rough token estimate. `update-metrics.ts` is the side-channel accounting store: it appends one entry per emitted package and per doc received back, so `status --json` can expose the ratio that backs the product thesis. `verify.ts` is the read-side counterpart — it walks the wiki on disk (so doc pages written after the last `index` are still validated), cross-checks page and section anchors against the active symbol set from the SQLite index, hashes stored manual blocks, and resolves internal links against the wiki namespace. `walker.ts` is the discovery primitive used by the indexer: it stacks directory traversals, merges `.gitignore` with hard-coded defaults, and emits relative POSIX paths keyed by extension language. The three `*.test.ts` files are colocated test drivers exercising these surfaces.

## Update metrics store

<!-- lw:anchors packages/core/src/update-metrics.ts#clearMetricsForTests packages/core/src/update-metrics.ts#metricsPath packages/core/src/update-metrics.ts#readMetrics packages/core/src/update-metrics.ts#recordUpdateMetric packages/core/src/update-metrics.ts#snapshotMetrics packages/core/src/update-metrics.ts#writeMetrics -->

`update-metrics.ts` is an append-only JSON ledger under `.livewiki/update_metrics.json`. The schema is `{ version: 1, entries: UpdateMetric[] }` where each entry is a discriminated union of `package_emitted` or `write_received` records. The store is intentionally reconstructable: deleting `.livewiki/` is allowed because markdown and the manifest are the source of truth.

```ts
async function metricsPath(repoRoot: string): Promise<string>
async function readMetrics(repoRoot: string): Promise<UpdateMetricsFile>
async function writeMetrics(repoRoot: string, file: UpdateMetricsFile): Promise<void>
export async function recordUpdateMetric(repoRoot: string, metric: UpdateMetric): Promise<void>
export async function snapshotMetrics(repoRoot: string): Promise<UpdateMetricsSnapshot>
export async function clearMetricsForTests(repoRoot: string): Promise<void>
```

- `metricsPath` resolves the ledger path through `safeIo.resolveAndValidate`, keeping all disk writes inside the repo root.
- `readMetrics` returns `{ version: 1, entries: [] }` when the file is missing or malformed (invalid `version`, non-array `entries`), so corrupt ledgers self-heal on next write.
- `writeMetrics` serializes with `JSON.stringify(file, null, 2)` plus a trailing newline; persistence is idempotent in the sense of "last coherent state wins".
- `recordUpdateMetric` is fire-and-forget by contract: its body wraps `readMetrics`, push, and `writeMetrics` in a single `try { ... } catch {}`. A failure here never breaks the calling operation (e.g. `loadWorkPackage`), which is why the function is documented as best-effort.
- `snapshotMetrics` folds every entry into counters and returns `packagesEmitted`, `totalPackageTokens`, `writesReceived`, `totalWriteTokens`, `efficiencyRatio` (writes/packages tokens, or `null` when no package has been emitted yet), and the most recent `lastPackage` / `lastWrite` of each kind.
- `clearMetricsForTests` exists only for test setup; it creates `.livewiki/` if needed and rewrites the file with an empty entries array. The header explicitly warns against production use.

## Update work package

<!-- lw:anchors packages/core/src/update.ts#CHARS_PER_TOKEN packages/core/src/update.ts#loadWorkPackage packages/core/src/update.ts#lookupSymbol packages/core/src/update.ts#recordDocWrittenBack packages/core/src/update.ts#snippetForSymbol -->

`update.ts` is the heart of Phase 5 incremental mode. It composes the `WorkPackage` shape that an in-session agent (or `--llm` flow elsewhere) consumes.

```ts
export const CHARS_PER_TOKEN = 4
export async function loadWorkPackage(repoRoot: string, opts?: WorkPackageOptions): Promise<WorkPackage>
async function snippetForSymbol(absRoot: string, symbolKey: string, window: number): Promise<DebtSnippet | null>
async function lookupSymbol(absRoot: string, symbolKey: string): Promise<{ startLine: number; endLine: number } | null>
export async function recordDocWrittenBack(repoRoot: string, payload: { wikiPath: string; bytes: number; tokensEstimated: number }): Promise<void>
```

- `CHARS_PER_TOKEN` is the fixed `4`-chars-per-token heuristic used to estimate the package size; the comment in source notes this is a coarse approximation suitable for the `efficiencyRatio` proxy.
- `loadWorkPackage` reads the manifest via `readManifest`, calls `runStatus` to obtain open debt items, builds at most `opts.maxSnippets ?? 50` snippets (capped defensively against a debt explosion), and computes `validAnchors` as the deduplicated, sorted set of debt `symbol_key`s. It then serializes the package once, derives `tokensEstimated = ceil(json.length / CHARS_PER_TOKEN)` and `bytes = json.length`, and finally calls `recordUpdateMetric` with a `package_emitted` entry before returning.
- `snippetForSymbol` opens the source file referenced by the symbol key and searches line-by-line for a `function` / `class` / `const` declaration matching the symbol name. The excerpt above is truncated before the windowing math completes; the excerpt does not establish the exact end-line behavior, but the visible code shows a 3-line context before the symbol start and a fallback when the file is missing (`return null`).
- `lookupSymbol` is the fallback used when the textual name scan fails: it consults the symbol index to recover `startLine` / `endLine`. The excerpt is truncated before the fallback's "first lines of the file" branch is shown, so the snippet in that path is not fully visible.
- `recordDocWrittenBack` (also truncated at the very end of `update.ts`) is the inverse append: it records a `write_received` entry tagged with `wikiPath`, `bytes`, and `tokensEstimated`. Its full signature is `export async function recordDocWrittenBack(...)` per the symbols table.

## Update test fixtures

<!-- lw:anchors packages/core/src/update.test.ts#setupWithAnchor packages/core/src/update.test.ts#writeCode packages/core/src/update.test.ts#writeWiki -->

The `update.test.ts` file contains three local helpers used to seed the temp repo created in `beforeEach`:

```ts
async function writeCode(rel: string, content: string): Promise<void>
async function writeWiki(rel: string, content: string): Promise<void>
async function setupWithAnchor(): Promise<void>
```

- `writeCode` and `writeWiki` differ only in intent (source vs. wiki page); both call `mkdir(join(abs, ".."), { recursive: true })` then `writeFile` against `repoRoot`.
- `setupWithAnchor` is the precondition for debt-generating tests: it writes a `src/foo.ts` with `export function bar()`, runs the indexer and the anchor ledger, drops a `livewiki/foo.md` page with `anchors: [src/foo.ts#bar]` in its frontmatter, then runs the indexer and ledger again. Without this setup, the anchor ledger has nothing to compare against and the changed-symbol detection branch never fires.
- The file also exercises package shape invariants: `manifest !== null` after `runInit`, `tokensEstimated > 0 && < 10000`, `validAnchors` contains the expected symbol key, `maxSnippets` is honored, and a custom `snippetWindow: 5` keeps the snippet under ~15 lines.

## Wiki verifier

<!-- lw:anchors packages/core/src/verify.ts#run packages/core/src/verify.ts#collectWikiPages packages/core/src/verify.ts#collectWikiArtifactPaths packages/core/src/verify.ts#collectSectionSlugs packages/core/src/verify.ts#resolveWikiLink packages/core/src/verify.ts#isInsideWiki packages/core/src/verify.ts#formatHuman -->

`verify.ts` is the read-only check that runs after a write — `run` is the entrypoint.

```ts
export async function run(repoRoot: string): Promise<VerifyResult>
async function collectWikiPages(absRoot: string): Promise<{ relPath: string }[]>
async function collectWikiArtifactPaths(absRoot: string): Promise<Set<string>>
async function collectSectionSlugs(absRoot: string, relPath: string): Promise<Set<string>>
function resolveWikiLink(fromRelPath: string, linkRaw: string): string | null
function isInsideWiki(wikiPath: string): boolean
export function formatHuman(result: VerifyResult): string
```

- `run` opens the SQLite index, builds an `activeSymbols` map keyed by symbol key, loads the `manual_blocks` rows grouped by their parent `doc_pages.wiki_path`, then walks the wiki from disk (not from `doc_pages` — see the Fix C note in the source header) via `collectWikiPages`. For each page it parses anchors with `extractAnchors`, checks page and section anchors against `activeSymbols`, matches stored manual block hashes against the on-disk block multiset, and finally scans internal links after masking inline code spans.
- `collectWikiPages` returns the set of `.md` pages under the wiki namespace; `collectWikiArtifactPaths` widens that set to include non-`.md` artifacts such as `.mmd` diagrams so link resolution is extension-driven rather than path-driven.
- `collectSectionSlugs` populates a per-page `Set<string>` of headings (via `slugify`) so `[text](page.md#section)` links can be resolved to a section slug rather than just a file.
- `resolveWikiLink` and `isInsideWiki` work together: the resolver picks the correct interpretation based on whether the link begins with `livewiki/`, is repo-absolute (`/foo.md`), or is page-relative (`./foo.md`, `../foo.md`, `foo.md`); the excerpt is truncated before the trailing `if (!isInsideWiki(...))` branch is shown, so the broken-link issuance for escape attempts is not fully visible here — the test file's "fora de livewiki" assertion is the source of truth for that branch's shape.
- `formatHuman` is the CLI-friendly text renderer for a `VerifyResult`, separate from the `ok` / `issues` shape consumed programmatically.

## Verify test fixtures

<!-- lw:anchors packages/core/src/verify.test.ts#writeCode packages/core/src/verify.test.ts#writeWiki -->

`verify.test.ts` mirrors the helpers from `update.test.ts` but reimplemented against `nodeFs` / `nodePath` / `nodeOs` directly:

```ts
async function writeCode(rel: string, content: string): Promise<void>
async function writeWiki(rel: string, content: string): Promise<void>
```

Both call `mkdir(dirname(abs), { recursive: true })` then `writeFile(abs, content)` against the temp `repoRoot`. The test bodies run the indexer and anchor-ledger before invoking `runVerify`, and assert against `result.issues.filter(...)` grouped by `code` (`broken_anchor`, `broken_internal_link`, `manual_block_altered`).

## File-system walker

<!-- lw:anchors packages/core/src/walker.ts#EXTENSION_LANG packages/core/src/walker.ts#buildIgnore packages/core/src/walker.ts#walkRepo -->

`walker.ts` enumerates indexable files for the indexer.

```ts
export const EXTENSION_LANG: Record<string, string>
async function buildIgnore(repoRoot: string, opts: WalkOptions): Promise<ReturnType<typeof ignore>>
export async function walkRepo(repoRoot: string, opts?: WalkOptions): Promise<WalkResult[]>
```

- `EXTENSION_LANG` is a static map of `.ts / .tsx / .js / .jsx / .mjs / .cjs / .py` to `typescript / tsx / javascript / tsx / javascript / javascript / python`. Files whose extension is absent from this map are skipped, which is how `bar.txt`, `baz.json`, and `image.png` are filtered out in the test.
- `buildIgnore` constructs an `ignore()` instance, seeds it with the default denies `.git/`, `node_modules/`, `.livewiki/`, `dist/`, `coverage/`, then layers `.gitignore` content on top (a missing file is silently ignored), and finally appends `opts.extraIgnores`. Order matters: defaults act as defense-in-depth even when `.gitignore` is absent.
- `walkRepo` is stack-based to avoid callstack blowups on deep repos. Each entry is converted to a relative POSIX path before being tested against the ignore filter (`relPosix = relFromRoot.split(nodePath.sep).join("/")`). Directories are pushed onto the stack; files are emitted with `{ path, lang }` only when `EXTENSION_LANG[ext]` resolves. A `readdir` failure (permission denied, directory disappeared) is logged via `console.warn` and skipped rather than thrown. The result is finally sorted by path so runs are diff-stable. Symlinks are intentionally ignored — neither `isFile()` nor `isDirectory()` returns true for them, so they are dropped silently.

## Walker test fixtures

<!-- lw:anchors packages/core/src/walker.test.ts#write -->

`walker.test.ts` exposes a single helper used by every `walkRepo` test:

```ts
async function write(rel: string, content = ""): Promise<void>
```

It mirrors the `writeCode` pattern from the other test files: `mkdir(dirname(abs), { recursive: true })` followed by `writeFile(abs, content)`. The test cases assert that `node_modules/`, `.git/`, `dist/`, `coverage/`, and `.gitignore`-listed paths are skipped; that `extraIgnores` is layered on top of `.gitignore`; that relative paths use forward slashes; that the output is sorted by path; that unknown extensions are filtered out; and that fresh repos without a `.gitignore` still honor the defaults.