---
title: "core: status — wiki + index health report"
owner: generated
anchors:
  - packages/core/src/status.ts#anchoredLangs
  - packages/core/src/status.ts#run
  - packages/core/src/status.ts#collect
  - packages/core/src/status.ts#applyRiskRanking
  - packages/core/src/status.ts#applyFreshness
  - packages/core/src/status.ts#collectDegradedPages
  - packages/core/src/status.ts#formatSnapshotAge
  - packages/core/src/status.ts#formatLocalTimestamp
  - packages/core/src/status.ts#formatActivityEvent
  - packages/core/src/status.ts#formatDuration
  - packages/core/src/status.ts#formatHuman
---

# core: status — wiki + index health report

`packages/core/src/status.ts` builds the `StatusReport` snapshot that tells a developer (or an agent) where the wiki and the index stand right now.

## When to use this page

- **Run the status command** to inspect what `livewiki status` reports — files indexed, open debt, degraded pages, freshness, activity ledger.
- **Add a new section to the report** by extending `StatusReport` and threading the new field through `collect`, `applyFreshness`, `applyRiskRanking`, and `collectDegradedPages`.
- **Tune the human renderer** (`formatHuman`) when you need a new line, column, or block in the CLI text output without breaking the JSON shape.
- **Reason about the freshness rule** (`applyFreshness`) when a `stale: true`/`false` decision looks surprising — the rule is bounded by the index, not a repo walk.

## How it fits

This module sits on the read path of the livewiki CLI and MCP server. The orchestrator of the pipeline is `run`, which opens the SQLite index at `.livewiki/index.db`, calls `collect` to gather everything the database can answer in one shot, and then layers in four follow-up passes that need the repo on disk: `applyFreshness` (stat indexed files), `applyRiskRanking` (only when open debt exists — keeps clean repos cheap), `snapshotMetrics` for the activity ledger (wrapped in a try/catch so metrics failure never fails status), and `collectDegradedPages` (a fresh `livewiki/` walk for the recovery tier). The final shape is `StatusReport`, which `formatHuman` renders as multi-line text; JSON mode serializes the same object for agents. Adjacent collaborators it pulls in include the index layer (`./db.js`), the walker (`EXTENSION_LANG`), the import graph (`./imports.js`), the risk scorer (`./risk.js`), and the metrics ledger (`./update-metrics.js`).

## Diagram

```mermaid
%% livewiki/diagrams/core-src-status.mmd
```

## Report orchestration

<!-- lw:anchors packages/core/src/status.ts#run packages/core/src/status.ts#collect packages/core/src/status.ts#anchoredLangs -->

`run` is the public entry point. It resolves the repo root, locates the SQLite index inside it, opens it, and ensures `db.close()` runs in a `finally` block so a failure mid-pipeline never leaks the connection. The actual snapshot assembly is split so each pass owns one concern:

```ts
export async function run(
  repoRoot: string,
  opts: StatusOptions = {},
): Promise<StatusReport>
```

`run(repoRoot, opts)` opens the on-disk index, builds a `StatusReport`, applies freshness and risk in sequence, and returns the populated object — closing the index in `finally` regardless of how the pipeline ends.

The first pass is `collect(db, topN)`, which is the pure-database phase: it reads active files and symbols, builds the per-language and per-kind counts, computes the top-N files by symbol count, and walks the open debt plus undocumented tables. `collect` also derives the `tiers` map by asking `anchoredLangs()` whether each language is in the walker's `EXTENSION_LANG` projection — that projection is intentionally import-light so this CLI subprocess never drags `web-tree-sitter` into the bundle just to label tiers. Debt identity uses durable columns (`symbol_key`/`wiki_path`) first-classed alongside anchor joins, so rows stay actionable even when the joined anchor is gone. The function leaves `metrics` and `degraded` as stubs (`null` and `{ total: 0, pages: [] }`) for the later passes to overwrite.

## Index freshness

<!-- lw:anchors packages/core/src/status.ts#applyFreshness packages/core/src/status.ts#formatSnapshotAge -->

`applyFreshness` answers one question: is the on-disk world still what the index thinks it is? It computes `snapshotAgeMs` (lower bound `0` — clamped only on the lower side, since a negative age would be nonsense) and then stats every active indexed file once:

```ts
async function applyFreshness(
  db: import("better-sqlite3").Database,
  absRoot: string,
  report: StatusReport,
): Promise<void>
```

`applyFreshness(db, absRoot, report)` reads `report.meta.lastIndexedAt`, sets `snapshotAgeMs` (clamped at `0`), then stats the active indexed files — counting one for every file whose `mtimeMs` exceeds `lastIndexedAt` or that no longer exists on disk. The rule deliberately compares against `last_indexed_at` rather than the per-row indexed mtime so a touch-then-rehash cycle does not get stuck stale. Files created after indexing are out of reach by design (a full walk would be needed and the watcher covers them); when `lastIndexedAt` is `null`, freshness is reported as `stale: false` with `staleChangedFiles: 0`.

`formatSnapshotAge` is the small formatter the human renderer reaches for on the stale line. It rounds milliseconds into the coarsest unit that still reads naturally and only ever widens (seconds → minutes → hours → days), with hours switching to days past the 48-hour boundary:

```ts
function formatSnapshotAge(ms: number): string
```

`formatSnapshotAge(ms)` takes a positive millisecond duration and returns a compact label like `"12s"`, `"5m"`, `"3h"`, or `"4d"`. Note that the input is assumed non-negative — `applyFreshness` clamps the upper side at `0` before calling it.

## Risk-ranked debt ordering

<!-- lw:anchors packages/core/src/status.ts#applyRiskRanking -->

When `report.debt.items.length > 0`, `run` defers to `applyRiskRanking` to attach an additive `risk` field and reorder the items by score. Identity and dedup are untouched — this is presentation order plus metadata. The function is defensive on every external dependency so a repo with no config, no git, or no Go/Rust module manifest still gets a result:

```ts
async function applyRiskRanking(
  db: import("better-sqlite3").Database,
  absRoot: string,
  report: StatusReport,
): Promise<void>
```

`applyRiskRanking(db, absRoot, report)` loads the repo config with a fallback to defaults, bails out when `riskAnalysis === false`, recomputes the import graph for anchored-language files only (prose-tier files have no grammar and would yield no edges), pulls git churn over the configured window (degrading to `null` when git or a repo is unavailable), scores each debt item, and sorts the items via `compareByRisk`. Tier is keyed off `anchoredLangs()` so prose and anchored files get different signals.

## Recovery tier — degraded pages

<!-- lw:anchors packages/core/src/status.ts#collectDegradedPages -->

The degraded-pages block is the only section that does not trust the index. `collectDegradedPages` walks `livewiki/` fresh from disk every call (verify-style) and treats the frontmatter flag `quality: degraded` as the single source of truth:

```ts
async function collectDegradedPages(
  absRoot: string,
): Promise<{ total: number; pages: string[] }
```

`collectDegradedPages(absRoot)` walks the `livewiki/` tree under the repo root, descends into non-dotfile directories only, reads every Markdown page including dotfile-named ones, and collects those whose frontmatter declares `quality: degraded`. An unreadable file or unparseable frontmatter is silently skipped so a single broken page never breaks status; results are sorted before return and stored under `report.degraded` with repo-relative forward-slash paths.

## Human renderer and activity formatters

<!-- lw:anchors packages/core/src/status.ts#formatHuman packages/core/src/status.ts#formatLocalTimestamp packages/core/src/status.ts#formatActivityEvent packages/core/src/status.ts#formatDuration -->

`formatHuman` is the CLI text mode. It builds a multi-line string with a header, per-language counts annotated by tier, per-kind symbol counts, the top-N files, debt grouped by event and assignee, undocumented symbols, the degraded block, and — when the ledger is non-empty — an Activity block plus a stale line and a metadata footer:

```ts
export function formatHuman(report: StatusReport): string
```

`formatHuman(report)` renders a `StatusReport` into a stable multi-line text block consumed by the livewiki CLI; JSON consumers ignore this and read the structured `StatusReport` object directly.

The Activity block is composed from three small formatters. `formatLocalTimestamp` turns an epoch millisecond into a zero-padded local-time `YYYY-MM-DD HH:mm`:

```ts
function formatLocalTimestamp(ts: number): string
```

`formatLocalTimestamp(ts)` takes an epoch-millisecond timestamp and returns a zero-padded local-time string in the form `YYYY-MM-DD HH:mm`.

`formatActivityEvent` renders a single ledger entry (`UpdateMetric`) as one line, switching on `kind`:

```ts
function formatActivityEvent(e: UpdateMetric): string
```

`formatActivityEvent(e)` takes a single `UpdateMetric` ledger entry and returns a one-line summary like `package_emitted ~42 tokens, 1 debt items` or `batch_run #7 ok, 1200 in / 300 out, 45s`. The four covered kinds are `package_emitted`, `write_received`, `debt_resolved`, and `batch_run`.

`formatDuration` is the wall-clock formatter the batch-run line leans on:

```ts
function formatDuration(ms: number): string
```

`formatDuration(ms)` takes a non-negative millisecond duration and returns a compact label — `45s` under a minute, `30m` under an hour, `1h12m` (zero-padded minutes) past an hour, and `2h` when minutes are zero.

## Tests

Covered by `packages/core/src/status.test.ts` (same-name test file on disk).
