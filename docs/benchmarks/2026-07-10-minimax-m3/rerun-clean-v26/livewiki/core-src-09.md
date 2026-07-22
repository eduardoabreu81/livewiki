---
title: Update, verify, and walker core for livewiki
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

# Update, verify, and walker core for livewiki

This module groups the core runtime of livewiki's incremental documentation pipeline: emitting a focused work package for an agent, validating the wiki against the symbol index, and walking the repository to feed downstream stages.

## When to use this page

- **Generate** a focused work package for a documenting agent with `loadWorkPackage` and inspect its debt, snippets, and token estimate.
- **Record** docs written back by the agent so the efficiency metric updates through `recordDocWrittenBack` and `snapshotMetrics`.
- **Validate** a wiki against the active symbol index by running `verify.run` and rendering the report with `formatHuman`.
- **Walk** a repository's indexable files while honoring `.gitignore` and livewiki's default ignores via `walkRepo` / `buildIgnore` / `EXTENSION_LANG`.

## How it fits

`packages/core/src/update.ts` and `update-metrics.ts` sit at the center of livewiki's incremental mode (SPEC "Fase 5"). `update.ts` reads the manifest, asks `status` for open debt, builds bounded source snippets per debt item, and emits a `WorkPackage` whose token estimate is the product thesis ("800 tokens in lieu of re-reading the repo"). Every emission and every doc write-back is appended to `.livewiki/update_metrics.json` so the product's efficiency claim is auditable. `verify.ts` is the anti-hallucination gate: it re-reads the wiki from disk on each run, checks anchors against the active symbol map, enforces manual-block integrity by hash multiset, and resolves internal links (including diagrams) with namespace-aware path handling. `walker.ts` feeds upstream stages (indexer, ledger) by enumerating indexable files with cross-platform forward-slash paths and a defense-in-depth ignore set layered on top of any user `.gitignore`. The accompanying `*.test.ts` files are vitest specs that stage tmp repos, run the indexer and ledger, and assert the contract of the production modules; they are scaffolding rather than product surface.

## Update metrics — incremental accounting

<!-- lw:anchors packages/core/src/update-metrics.ts#metricsPath packages/core/src/update-metrics.ts#readMetrics packages/core/src/update-metrics.ts#writeMetrics packages/core/src/update-metrics.ts#recordUpdateMetric packages/core/src/update-metrics.ts#snapshotMetrics packages/core/src/update-metrics.ts#clearMetricsForTests -->

Metrics live in a single append-only JSON file at `.livewiki/update_metrics.json`, schema version 1. Two `kind`s are recorded:

- `package_emitted` — appended by `loadWorkPackage` after it builds the work package.
- `write_received` — appended when an agent or human returns a doc (skill "document-as-you-go" or CLI).

The file is intentionally a JSON store, not SQLite: queries are simple ("last value", "sum by kind"), the data is reconstructible from markdown/manifest sources, and there is no schema v4 migration cost. If the file is missing or corrupt, `readMetrics` swallows the error and returns an empty `{ version: 1, entries: [] }` file; this means a deleted `.livewiki/` starts accounting from zero on the next run.

```ts
async function metricsPath(repoRoot: string): Promise<string>
async function readMetrics(repoRoot: string): Promise<UpdateMetricsFile>
async function writeMetrics(repoRoot: string, file: UpdateMetricsFile): Promise<void>
export async function recordUpdateMetric(repoRoot: string, metric: UpdateMetric): Promise<void>
export async function snapshotMetrics(repoRoot: string): Promise<UpdateMetricsSnapshot>
export async function clearMetricsForTests(repoRoot: string): Promise<void>
```

`recordUpdateMetric` is best-effort by design — its body wraps `readMetrics` + append + `writeMetrics` in a single `try { ... } catch {}` so that an accounting failure cannot block the primary `update` operation. `snapshotMetrics` walks the entries once, counting `package_emitted` and `write_received` rows and summing their `tokensEstimated` fields, and exposes an `efficiencyRatio` of `totalWriteTokens / totalPackageTokens` (or `null` when no package has been emitted). `clearMetricsForTests` is destructive and named for its only intended caller (test setup); it ensures `.livewiki/` exists and writes an empty metrics file.

## Update work package

<!-- lw:anchors packages/core/src/update.ts#CHARS_PER_TOKEN packages/core/src/update.ts#loadWorkPackage packages/core/src/update.ts#snippetForSymbol packages/core/src/update.ts#lookupSymbol packages/core/src/update.ts#recordDocWrittenBack -->

The `update` module is the heart of Fase 5 — incremental mode. It does not call any LLM; it produces a `WorkPackage` for the agent in session (or for a separate `--llm` codepath).

```ts
export const CHARS_PER_TOKEN = 4;
export async function loadWorkPackage(
  repoRoot: string,
  opts: WorkPackageOptions = {},
): Promise<WorkPackage>
async function snippetForSymbol(absRoot: string, symbolKey: string, window: number): Promise<DebtSnippet | null>
async function lookupSymbol(absRoot: string, symbolKey: string): Promise<SymbolRow | null>
export async function recordDocWrittenBack(repoRoot: string, payload: WriteBackPayload): Promise<void>
```

`loadWorkPackage` runs in six stages: (1) read the manifest via `readManifest` (or produce `null` if the repo has never been initialized), (2) delegate to `status.run` as the single source of truth for open debt, (3) collect bounded source snippets per debt item using `snippetForSymbol` capped by `maxSnippets` (default 50), (4) derive `validAnchors` as the deduped, sorted subset of `symbol_key`s from debt, (5) serialize the package and estimate its token count as `Math.ceil(json.length / CHARS_PER_TOKEN)`, and (6) record a `package_emitted` metric via `recordUpdateMetric` (non-blocking from the caller's perspective because metrics writes swallow their own errors).

`snippetForSymbol` first tries to locate the symbol by a name match on the source (`function name`, `class name`, `def name`, `const name`, plus their `export` and `export async` variants), assuming a span of `window` lines. If that heuristic misses, it falls back to `lookupSymbol` against the index for accurate `startLine`/`endLine`. If the file was deleted between indexing and now, `readFile` throws and `snippetForSymbol` returns `null`, and the loop in `loadWorkPackage` simply skips that debt item.

`recordDocWrittenBack` is the matching write-back: it appends a `write_received` metric (wiki path, bytes, estimated tokens) so `snapshotMetrics` can recompute `efficiencyRatio`. `CHARS_PER_TOKEN = 4` is the shared "code/EN, ~4 chars per token" heuristic used by both the package size estimator and the metric accounting.

## Update tests

<!-- lw:anchors packages/core/src/update.test.ts#writeCode packages/core/src/update.test.ts#writeWiki packages/core/src/update.test.ts#setupWithAnchor -->

These vitest specs stage a tmp repo in `mkdtemp`, run the indexer and anchor ledger, and then exercise `loadWorkPackage` plus `recordDocWrittenBack`. Each test calls `clearMetricsForTests` in `beforeEach` so accumulated state from prior cases cannot leak.

```ts
async function writeCode(rel: string, content: string): Promise<void>
async function writeWiki(rel: string, content: string): Promise<void>
async function setupWithAnchor(): Promise<void>
```

`writeCode` and `writeWiki` both create the parent directory and write the file; the only difference is the conceptual namespace (source vs wiki page) used by the test author. `setupWithAnchor` is the canonical scenario: it writes `src/foo.ts` with `export function bar()`, runs the indexer and ledger once, writes a `livewiki/foo.md` page whose frontmatter anchors `src/foo.ts#bar`, then re-runs the indexer and ledger so the ledger has a record of the anchor. Without this anchor-to-wiki wiring, the ledger produces no debt and `loadWorkPackage` returns an empty debt list — the test author needs the anchor wired up before mutating the source to generate `changed` debt.

The "incremental mode" describe block asserts: the package contains a manifest when init has run, contains `null` manifest when init has not run, surfaces a `changed` debt item after mutating the source of an anchored symbol, embeds real source text (including mutated identifiers like `return 999`) in snippets, reports a sane `tokensEstimated` (positive and well under 10k), exposes `validAnchors` as active symbols, and honors both `maxSnippets` (caps `snippets.length`) and `snippetWindow` (caps the number of lines of context). The accounting block verifies that emitting a package bumps `packagesEmitted` and that a follow-up `recordDocWrittenBack` increments `writesReceived` and recomputes `efficiencyRatio`.

## Verify

<!-- lw:anchors packages/core/src/verify.ts#run packages/core/src/verify.ts#collectWikiPages packages/core/src/verify.ts#collectWikiArtifactPaths packages/core/src/verify.ts#collectSectionSlugs packages/core/src/verify.ts#resolveWikiLink packages/core/src/verify.ts#isInsideWiki packages/core/src/verify.ts#formatHuman -->

`verify.run` is the anti-hallucination gate. It opens the SQLite index read-only, builds a `key → SymbolRow` map of active symbols, loads `doc_pages` and `manual_blocks` from the DB, and then re-reads every wiki page from disk (Fix C from SPEC — never trust `doc_pages` for "did this page exist?"). For each page it parses anchors and section anchors via `extractAnchors`, fails on any anchor whose key is not in the active-symbol map (`broken_anchor`, severity `error`), and verifies preserved manual blocks by comparing the multiset of `sha256` hashes between the stored blocks and the blocks re-extracted from the current source — a missing or changed stored block is reported as `manual_block_altered` (severity `error`). Internal links are scanned from a code-span-masked copy of the source (so fenced/inline example link syntax is not parsed as a real link), and the matched targets are resolved through `resolveWikiLink` and gated by `isInsideWiki`; escapes outside the wiki namespace are reported as `broken_internal_link` with severity `warning` (verify is read-only and does not block).

```ts
export async function run(repoRoot: string): Promise<VerifyResult>
async function collectWikiPages(absRoot: string): Promise<{ relPath: string }[]>
async function collectWikiArtifactPaths(absRoot: string): Promise<Set<string>>
async function collectSectionSlugs(absRoot: string, relPath: string): Promise<Set<string>>
function resolveWikiLink(fromRelPath: string, linkRaw: string): string | null
function isInsideWiki(wikiPath: string): boolean
export function formatHuman(result: VerifyResult): string
```

The link resolver is the centerpiece of the namespace-escape fix: it now uses POSIX path semantics so a link like `[page](../auth.md)` from `livewiki/architecture/overview.md` resolves to `livewiki/auth.md` rather than the malformed `livewiki/../auth.md` that pre-fix verify emitted. `collectWikiArtifactPaths` exists so links to `.mmd` diagrams count as "existing artifacts" the same way `.md` page links do, without treating diagrams as full wiki pages (no anchors, no manual blocks, no section scan for them). `formatHuman` produces a CLI-friendly rendering of `VerifyResult.ok`, pages checked, and the issue list.

The excerpt does not establish exhaustive behavior for the trailing `linkRe` path-resolution branch or for every `IssueCode` variant; the code shown focuses on `broken_anchor`, `manual_block_altered`, and `broken_internal_link`.

## Verify tests

<!-- lw:anchors packages/core/src/verify.test.ts#writeCode packages/core/src/verify.test.ts#writeWiki -->

These vitest specs mirror the staging helpers used by the update tests.

```ts
async function writeCode(rel: string, content: string): Promise<void>
async function writeWiki(rel: string, content: string): Promise<void>
```

`writeCode` and `writeWiki` here are local helpers (separate declarations from the identically-named helpers in `update.test.ts`); each `mkdir -p`s the parent and writes the file under the spec's own `repoRoot`. The `describe` blocks cover: an anchor to a nonexistent symbol producing `broken_anchor`, an anchor to a missing file also producing `broken_anchor`, a valid anchor producing no `broken_anchor`, and a wiki page that mentions `lw:anchors` *inside* a fenced code block not being flagged. The "internal link escapes namespace" block confirms that `../../etc/secrets.md` from a wiki page is reported as `broken_internal_link` with `severity: "warning"` and a detail that mentions "fora de livewiki" — and the resolved wiki-path used in the detail is the cleaned namespace path, not the raw escape. The "manual block byte-a-byte" block confirms that a stored block is still detected as preserved even after a large prose insertion shifts its offset, that duplicate byte-identical blocks are counted correctly (one of two disappearing yields exactly one `manual_block_altered`), and that a real edit to a manual block surfaces as `manual_block_altered` with severity `error`.

## Walker

<!-- lw:anchors packages/core/src/walker.ts#EXTENSION_LANG packages/core/src/walker.ts#buildIgnore packages/core/src/walker.ts#walkRepo -->

`walker.ts` enumerates indexable files in a repo while honoring `.gitignore` and livewiki's own defaults. It is the source of truth for which files the indexer and ledger see.

```ts
export const EXTENSION_LANG: Record<string, string>
async function buildIgnore(repoRoot: string, opts: WalkOptions): Promise<ReturnType<typeof ignore>>
export async function walkRepo(repoRoot: string, opts: WalkOptions = {}): Promise<WalkResult[]>
```

`EXTENSION_LANG` is a flat `extension → language` table for the MVP languages (TS, TSX, JS, JSX as `tsx`, MJS/CJS as `javascript`, Python). Files whose extension is not in the table are silently skipped during the walk — the walker does not error on unknown extensions; it just does not yield them. `buildIgnore` constructs the layered `ignore` instance: it always adds `.git/`, `node_modules/`, `.livewiki/`, `dist/`, `coverage/` (defense in depth even if `.gitignore` is absent), then attempts to read the repo's `.gitignore` — the read is wrapped in `try { ... } catch {}` so a missing or unreadable `.gitignore` is a no-op rather than a thrown error — and finally appends any `opts.extraIgnores`. `walkRepo` uses an explicit stack rather than recursion to avoid blowing the call stack on deep repos, and for each `Dirent` it computes the repo-root-relative POSIX path (`path.sep` → `"/"`) and asks the `ignore` instance whether to skip; directories are pushed onto the stack, files are filtered to those with a known extension and pushed onto `out`, and symlinks fall through neither branch (deliberate — symlinks in source repos are not handled, per the module header). `readdir` failures are logged via `console.warn` and the directory is skipped (perm denied, directory vanished mid-walk); the walk continues. Final output is sorted by POSIX path, giving a stable order across runs and platforms.

## Walker tests

<!-- lw:anchors packages/core/src/walker.test.ts#write -->

The walker specs stage a tmp repo in `mkdtemp` and assert the walker's behavior across languages, ignore precedence, and path normalization.

```ts
async function write(rel: string, content = ""): Promise<void>
```

`write` is the only file-creation helper in this spec file — unlike the `update.test.ts`/`verify.test.ts` helpers, there is no separate wiki/code split because the walker treats both uniformly. The `describe("EXTENSION_LANG")` block asserts the extension mapping for `.ts`, `.tsx`, `.js`, `.jsx`, and `.py`. The `describe("walkRepo")` block covers: only files with known extensions are yielded (README/JSON/PNG excluded), `node_modules/`, `.git/`, `dist/`, and `coverage/` are always ignored even without `.gitignore`, a repo `.gitignore` is honored (with `extraIgnores` additive to it), paths are emitted with forward slashes only (no `\` even on Windows-hostile setups), order is stable and sorted, and the walker succeeds when `.gitignore` is absent — `src/foo.ts` is yielded and `node_modules/x.js` is dropped by the default ignore set.

The walker header explicitly notes that symlinks are not followed; the spec block does not exercise that path.

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
- ["Core pipeline: batch orchestration, config, db, and diagrams"](core-src-03.md) — dependency and dependent
- [core-src-08 — prompts, safe I/O, status, symbol extraction, and topic planning](core-src-08.md) — dependency and dependent
- [Core export, frontmatter, gitignore, flow detection, and hashing](core-src-04.md) — dependency
<!-- livewiki:navigate:end -->
