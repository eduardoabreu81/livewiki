---
title: Planning repository page units
owner: generated
anchors:
  - packages/core/src/page-units.ts#DEFAULT_FILE_SPLIT_SOURCE_BYTES
  - packages/core/src/page-units.ts#dirOf
  - packages/core/src/page-units.ts#fileBaseName
  - packages/core/src/page-units.ts#folderCoverageSignal
  - packages/core/src/page-units.ts#planPageUnits
  - packages/core/src/page-units.ts#stripTestInfix
---

# Planning repository page units

This page documents the deterministic planner that decides which repository surfaces become livewiki pages — one per file or one per folder — and how test files are accounted for without ever becoming pages of their own.

## When to use this page

- **Tune the split threshold** for large source files by adjusting the constant `DEFAULT_FILE_SPLIT_SOURCE_BYTES` or its caller option.
- **Trace how a single indexed file is classified** (its `FileDisposition`: `page`, `inert`, `test-paired`, `test-likely`, or `test-orphan`) through `planPageUnits`.
- **Inspect the per-folder coverage signal** emitted by `folderCoverageSignal` to understand which symbol-bearing files lack a same-name test.
- **Debug wiki-path collisions** (folder-id suffixes, `-files` reservations, `index` page suffixing) when generation produces unexpected paths.

## How it fits

`packages/core/src/page-units.ts` lives in the `core` package alongside the indexing and classification modules. It is consumed by stage 4 of the livewiki generation pipeline: it takes the active indexed inventory of file paths together with per-file symbol counts and source sizes, and produces a `PageUnitsPlan` — a partition of the repository into `FileUnit`s and `FolderUnit`s whose ids and wiki paths are globally unique and byte-deterministic for a given input. The plan is pure: no I/O, no `Date`, no randomness — the same input always produces the same plan. Downstream stages consume the plan to decide which pages to write and where, and the test-disposition flags it carries are surfaced on the folder page so anomalies are stated instead of hidden.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-page-units.mmd
```

## Defaults and constants

<!-- lw:anchors packages/core/src/page-units.ts#DEFAULT_FILE_SPLIT_SOURCE_BYTES -->

The split threshold is the single tunable constant in this module. The planner decides for every symbol-bearing file whether its source fits in a single stage-4 documentation call or needs the plan-then-write (D2) flow; `DEFAULT_FILE_SPLIT_SOURCE_BYTES` is the cutoff it compares source size against.

```ts
export const DEFAULT_FILE_SPLIT_SOURCE_BYTES = 60_000;
```

`DEFAULT_FILE_SPLIT_SOURCE_BYTES` is a number (bytes) used as the default value when no `fileSplitSourceBytes` is supplied to `planPageUnits`. Above this size a file's `oversizedSource` flag becomes true, signalling the generator to use the plan-then-write path; at or below it, a file can be documented from full source in one call. Setting `fileSplitSourceBytes` to `0` in the options disables oversized handling entirely — no file is ever marked oversized. The constant itself is exported so callers and tests can reference a single source of truth.

## Path and name helpers

<!-- lw:anchors packages/core/src/page-units.ts#stripTestInfix packages/core/src/page-units.ts#fileBaseName packages/core/src/page-units.ts#dirOf -->

These three small helpers do the lexical work that the planner repeats for every input path: stripping a recognized test infix, producing the basename a file page will be slugged under, and recovering the directory a file lives in.

```ts
export function stripTestInfix(fileName: string): string | null {
```

`stripTestInfix` takes a basename (not a full path) and returns the same name with `.test.` or `.spec.` removed (e.g. `batch.test.ts` → `batch.ts`), or `null` when no recognized infix is present. The regex `TEST_INFIX_RE` restricts matching to `.test.<ext>` and `.spec.<ext>` only — it does not match arbitrary suffixes — and the function explicitly bails out with `null` for inputs that do not match, rather than returning a partial transformation.

```ts
function fileBaseName(filePath: string): string {
```

`fileBaseName` takes a repo-relative file path and returns the basename minus its last extension (e.g. `packages/core/src/batch.ts` → `batch`). When the last `.` is at position `0` or absent, the full basename is returned unchanged — it does not treat extensionless dotfiles as having an empty stem.

```ts
function dirOf(filePath: string): string {
```

`dirOf` takes a repo-relative file path and returns the directory portion, returning `""` for files at the repository root rather than `.` or `/`. Both `fileBaseName` and `dirOf` are file-internal (not exported) because the planner does all name/dir reasoning in one place and never wants callers to depend on these specific splits.

## Planning page units

<!-- lw:anchors packages/core/src/page-units.ts#planPageUnits -->

`planPageUnits` is the heart of the module. It takes the active indexed inventory plus optional symbol counts and source sizes, runs every input path through classification and test-pairing, then emits a `PageUnitsPlan` whose invariants (exact partition by directory, one file unit per symbol-bearing non-test file, globally unique deterministic ids and page paths) the rest of the pipeline relies on.

```ts
export function planPageUnits(
  input: {
    filePaths: readonly string[];
    symbolCountByPath: ReadonlyMap<string, number>;
    sizeByPath?: ReadonlyMap<string, number>;
  },
  opts: PlanPageUnitsOptions = {},
): PageUnitsPlan {
```

`planPageUnits` takes an `input` object containing the active indexed file paths, a map of AST-derived symbol counts per path (missing entries default to `0`), and an optional map of source sizes in bytes (missing entries default to `0`), plus an optional options bag. It returns a `PageUnitsPlan` containing `fileUnits` and `folderUnits`, both fully populated and deterministic.

The planner proceeds in stages:

1. **Classification.** Every input path is classified via `classifyPathRole` into at least `product` and `test` roles (the exact `PathRole` set depends on `opts.pathRoles`). The result is cached in `roleByPath` so each path is classified once.
2. **Test pairing.** For every test path, `stripTestInfix` is applied to recover the basename that a same-name product file would have; if such a product file exists in the same directory, the test is `test-paired` and the pairing is recorded both on the test entry and on the product file unit. Otherwise, the planner looks for prefix matches inside the same directory (`batch-repair.test.ts` → `batch.ts`) and, on the longest matching product base, records the test as `test-likely` — explicitly tagged as a plausibility, never asserted. A test with no match at all becomes `test-orphan`, an anomaly that surfaces on the folder page rather than being silently dropped.
3. **Folder id assignment.** Each unique directory is run through `makeUniqueDeterministicIds` to produce a module-style id (last directory segment, with `root` for the repo root). Reserved wiki hub names (`topics`, `flows`, `architecture`, `diagrams`, `auxiliary`) are suffixed with `-files` to keep the wiki tree clean. Dot-prefixed directory names are sanitized (`dot-foo-bar`) because livewiki's wiki walkers skip dot-directories — without sanitization the page would exist in the plan but be invisible to verification. Collisions are resolved by suffixing `-x` repeatedly.
4. **File unit construction.** Only `page`-disposition files become file units. Inside a folder, basename collisions (e.g. `a.ts` + `a.js`) are resolved by suffixing every colliding member with its extension; the basename `index` always takes the suffix so its page path does not collide with the folder page itself. Each file unit carries `oversizedSource` (true only when `threshold > 0` and the size exceeds it — a zero threshold therefore disables oversized handling), `pairedTestPath` for same-name test pairings, and the sorted list of `likelyTestPaths`.
5. **Folder unit construction.** Every directory becomes a folder unit whose entries are the exact partition of all input paths whose `dirOf` matches that directory — every input path appears in exactly one folder entry, including non-page files and tests. The `likelyProductPath` field is present only on `test-likely` entries and points at the product file the test plausibly covers.

`planPageUnits` never throws on the visible paths: a missing size entry defaults to `0` (which is therefore never oversized under a positive threshold), a missing symbol count defaults to `0` (which makes the file `inert` rather than throwing), and test-pairing fallbacks terminate in `test-orphan` rather than erroring. The function is pure and deterministic — given the same input arrays and maps (in iteration order), it returns byte-identical plans.

## Coverage signal

<!-- lw:anchors packages/core/src/page-units.ts#folderCoverageSignal -->

The planner produces an exact partition but the folder page also needs a zero-token honesty signal — how many of its symbol-bearing product files lack a 1:1 same-name test. `folderCoverageSignal` computes that signal from an already-built `FolderUnit`.

```ts
export function folderCoverageSignal(folder: FolderUnit): {
  pages: number;
  withoutSameNameTest: number;
} {
```

`folderCoverageSignal` takes a fully constructed `FolderUnit` and returns an object with `pages` (count of entries whose disposition is `page`) and `withoutSameNameTest` (`max(0, pages − test-paired)`, which is the count of symbol-bearing product files without a verifiable same-name test on disk). The result is surfaced on the folder page as a single honest line. It does not consult `test-likely` pairings — only `test-paired`, because only same-name pairing is a verifiable fact; prefix matches are reported separately as plausibilities on the individual entries.

## Tests

Covered by `packages/core/src/page-units.test.ts` (same-name test file on disk).
