---
title: Risk-weighted debt prioritization
owner: generated
anchors:
  - packages/core/src/risk.ts#bandPoints
  - packages/core/src/risk.ts#collectGitChurn
  - packages/core/src/risk.ts#compareByRisk
  - packages/core/src/risk.ts#computeTestCoverageAndFanIn
  - packages/core/src/risk.ts#derivePathFromSymbolKey
  - packages/core/src/risk.ts#parseGitChurnOutput
  - packages/core/src/risk.ts#runGitLog
  - packages/core/src/risk.ts#scoreDebtItem
---

# Risk-weighted debt prioritization

The `risk` module ranks open documentation debt items by a deterministic score computed from test coverage, import fan-in, and recent git activity.

## When to use this page

- **Compute a risk score for a single debt item** using `scoreDebtItem` after resolving its source path, tier, and per-file signals.
- **Build the file-level signals** (which files are covered by tests, and how many distinct files import each file) with `computeTestCoverageAndFanIn`.
- **Collect per-file git churn** from the recent commit log with `collectGitChurn`, or disable the spawn entirely.
- **Sort a debt list deterministically** by feeding items through `compareByRisk`.

## How it fits

`packages/core/src/risk.ts` sits inside `packages/core`, the shared core layer of the livewiki CLI. It consumes the module-graph edges produced by `import-resolution.ts`, reuses `isTestPath` from `flows.ts` to recognize test files, and relies on `normalizeRepoPath` from `modules.ts` to canonicalize the paths emitted by `git log`. None of its outputs are persisted: scores are computed on the fly every time `livewiki status` (and, through the same array, `livewiki update`'s work package) renders open debt. The JSON change is additive — `DebtItem.risk` is the only new field, and ranking never removes obligations, only orders them.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-risk.mmd
```

## Rubric shape and band lookup

`risk` expresses its scoring rubric as a few constants at the top of the file: event points (`changed`/`deleted` = 10, `moved` = 5), an anchored test-gap penalty (40), a flat prose test-gap value (10), and two band tables for fan-in and churn. Every file-derived factor contributes 0 when its input is missing — the score is the sum of the factors that did resolve. The band tables are evaluated top-down as `[min, max, points]` triples.

The shared lookup helper turns a numeric value into its band's point allotment.

<!-- lw:anchors packages/core/src/risk.ts#bandPoints -->

```ts
function bandPoints(bands: ReadonlyArray<readonly [number, number, number]>, value: number): number
```

Takes a list of `[min, max, points]` triples and a numeric value; returns the `points` field of the first band where `min <= value <= max`, or `0` if no band matches. Fan-in and churn both call it with their respective constant band tables.

## Resolving a debt item's source path

Debt items are keyed by `symbol_key`, formatted as `${relPath}#${name}` (see `symbols.ts`). Before any file-derived signal can be looked up, the path segment has to be split out of that key.

<!-- lw:anchors packages/core/src/risk.ts#derivePathFromSymbolKey -->

```ts
export function derivePathFromSymbolKey(key: string | null): string | null
```

Takes the `symbol_key` string (or `null`); returns the relative path prefix that precedes the `#`, or `null` when the input is `null` or has no path segment. A `null` result is not a hard error — the caller still applies the event factor and leaves the file-derived factors at `0`.

## Building the two file-level signals

Test coverage and fan-in are projected from the same import-edge graph. Rather than ask callers to compute them separately, `risk` walks the edges once and emits both signals in a single pass.

<!-- lw:anchors packages/core/src/risk.ts#computeTestCoverageAndFanIn -->

```ts
export function computeTestCoverageAndFanIn(opts: {
  importsByFile: Map<string, ExtractedImport[]>;
  knownFiles: ReadonlySet<string>;
  goModulePath?: string | null;
  rustCrateName?: string | null;
}): { coveredByTest: Set<string>; fanIn: Map<string, number> }
```

Takes the per-file extracted imports, the set of indexed files, and optional Go/Rust module hints; returns the set of files covered by at least one test and a per-file importer count. It calls `resolveImportEdges` with `workspacePackages: []`, which means workspace package specifiers are intentionally left unresolved — the same strictness the module graph uses without a workspace map, and relative edges (the only ones that carry this signal) resolve identically. As it walks each edge it tags the target file as test-covered when the importer matches `isTestPath`, and increments the importer set for the target so fan-in counts DISTINCT importers.

## Scoring a single debt item

Once the file-level signals are ready, scoring is a straight table lookup against the rubric constants. The item's tier (`anchored` vs `prose`) gates which factors apply: anchored files get the full test-gap and fan-in treatment, while prose-tier files always get a flat test-gap value and fan-in `0` because their imports are not extractable.

<!-- lw:anchors packages/core/src/risk.ts#scoreDebtItem -->

```ts
export function scoreDebtItem(opts: {
  event: "changed" | "moved" | "deleted";
  tier: "anchored" | "prose" | null;
  coveredByTest: boolean;
  fanIn: number;
  churnCount: number | null;
}): RiskScore
```

Takes the debt event, the file's tier, its test coverage flag, its fan-in count, and its churn count (or `null`); returns the total score together with the per-factor breakdown. A `null` tier short-circuits all file-derived factors to `0`; a `null` churn count zeroes only the churn factor.

## Sorting debt deterministically

The score alone is not enough to order a list — two items can tie. The comparator adds two stable tiebreakers so that the same input list always renders in the same order across runs.

<!-- lw:anchors packages/core/src/risk.ts#compareByRisk -->

```ts
export function compareByRisk(
  a: { id: number; detected_at: number; risk?: RiskScore },
  b: { id: number; detected_at: number; risk?: RiskScore },
): number
```

Takes two debt items and returns a standard comparator number. It sorts by score descending, then by `detected_at` ascending, then by `id` ascending. Items without a `risk` field compare as score `0` so the comparator stays safe for partially-scored input lists.

## Collecting git churn

The third signal — how recently a file has changed — comes from a single `git log` invocation. To keep `livewiki status` usable in environments without git or outside a repository, the collection path is built around graceful degradation: any failure short-circuits to `null` rather than throwing, and the spawn is skipped entirely when `maxCommits <= 0`.

<!-- lw:anchors packages/core/src/risk.ts#collectGitChurn packages/core/src/risk.ts#runGitLog packages/core/src/risk.ts#parseGitChurnOutput -->

```ts
export async function collectGitChurn(
  absRoot: string,
  maxCommits: number,
  spawnImpl: SpawnImpl = spawn,
): Promise<Map<string, number> | null>
```

Takes the absolute repo root, the commit-window size, and an injectable spawn implementation; returns a per-file commit count map, or `null` if anything goes wrong. The function first rejects non-positive or non-integer `maxCommits` without spawning; otherwise it delegates the spawn to `runGitLog` and parses whatever text comes back with `parseGitChurnOutput`.

```ts
function runGitLog(
  absRoot: string,
  maxCommits: number,
  spawnImpl: SpawnImpl,
): Promise<string | null>
```

Takes the repo root, the commit-window size, and the spawn implementation; returns the captured stdout as a string, or `null` on any failure. It runs `git -c core.quotepath=false log --no-merges --max-count=<N> --name-only --format=` with `shell: false`, accumulates stdout, and resolves `null` if the child errors, exits non-zero, or its construction throws synchronously. The `core.quotepath=false` flag is deliberate: without it, git C-quotes non-ASCII paths and the parsed names would never match the indexed files.

```ts
export function parseGitChurnOutput(text: string): Map<string, number>
```

Takes the raw `git log` text; returns a per-file commit count map. It splits on newlines, skips blanks, runs each path through `normalizeRepoPath` so the keys line up with indexed file paths, and increments the count for each occurrence. The function is pure — it makes no assumptions about git itself, only about the shape of its output.

## Tests

Covered by `packages/core/src/risk.test.ts` (same-name test file on disk).
