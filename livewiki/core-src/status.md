---
title: Wiki Status Report & Index Summary
owner: generated
anchors:
- packages/core/src/status.ts#anchoredLangs
- packages/core/src/status.ts#applyFreshness
- packages/core/src/status.ts#applyRiskRanking
- packages/core/src/status.ts#applyVersionedBaseline
- packages/core/src/status.ts#collect
- packages/core/src/status.ts#collectDegradedPages
- packages/core/src/status.ts#compareText
- packages/core/src/status.ts#formatActivityEvent
- packages/core/src/status.ts#formatDuration
- packages/core/src/status.ts#formatHuman
- packages/core/src/status.ts#formatLocalTimestamp
- packages/core/src/status.ts#formatSnapshotAge
- packages/core/src/status.ts#run
---

# Wiki Status Report & Index Summary

This page produces a comprehensive snapshot of the wiki's state — indexed files, extracted symbols, documentation debt, freshness, and recovery-tier pages — as a structured `StatusReport` object, and formats that report as human-readable text.

## When to use this page

- Understand how a CLI or MCP subprocess assembles a complete status report from the SQLite index, baseline files, and disk state.
- Learn the rules that determine index staleness and how `stale` is computed without a full repository walk.
- See how open documentation debt is ranked by risk and how the report is rendered for human consumption.
- Trace how degraded pages, activity metrics, and baseline gaps are collected and merged into the final report.

## How it fits

`status.ts` is the core implementation behind the `status` command. It opens the local SQLite index (`index.db`), reads configuration and baseline files, and walks disk directories only where needed (degraded pages, file mtimes, and git churn). It depends on several sibling modules — `db`, `walker`, `config`, `risk`, `baseline`, `imports`, `import-resolution`, `modules`, `update-metrics`, `frontmatter`, and `safe-io` — to gather each part of the report. The file exports two public functions: the async orchestrator `run` and the pure formatter `formatHuman`. All other functions are internal helpers that build a single section of the report. No other module calls into this file; it is the terminal producer of status information.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-status.mmd
```

## Orchestration: building the full report

<!-- lw:anchors packages/core/src/status.ts#run -->

The main entry point is `run(repoRoot, opts)`, which resolves the repository root, opens the index database, and assembles the final `StatusReport`.

```typescript
export async function run(
  repoRoot: string,
  opts: StatusOptions = {},
): Promise<StatusReport>
```

`run` takes the repository path and optional display options (defaulting `topN` to 10) and returns the complete report object. It first resolves the root to an absolute path, validates the index database path, and opens the SQLite connection. It then loads the configuration defensively — if `.livewiki/config.json` is missing or unreadable, it falls back to defaults without throwing.

The pipeline proceeds in stages: it calls `collect` to read the index and build the core report, then `applyVersionedBaseline` to attach repository-level debt, then `applyFreshness` to compute staleness. If any open debt items exist, it calls `applyRiskRanking` to order them by risk. It also best-effort snapshots incremental activity metrics, and finally walks the disk to collect degraded pages. The database is always closed in a `finally` block so even a failure mid-pipeline does not leak the connection. The order matters — risk ranking only runs when there is something to rank, and metrics/degraded collection can fail without breaking the report.

## Collecting the index-backed inventory

<!-- lw:anchors packages/core/src/status.ts#collect packages/core/src/status.ts#anchoredLangs -->

The first stage reads active files and symbols from the database and builds the static portions of the report.

```typescript
function collect(
  db: import("better-sqlite3").Database,
  topN: number,
  config: LivewikiConfig,
): StatusReport
```

`collect` takes the open database, the top-N limit, and the configuration, and returns a report populated with file, symbol, debt, undocumented, and metadata fields (metrics and degraded pages are filled later by `run`). It queries all active rows from `files` and `symbols`, aggregates counts by language and by symbol kind, and calculates per-language coverage tiers. The tier is "anchored" when a tree-sitter grammar exists for that language, otherwise "prose".

The language-tier map is supplied by `anchoredLangs()`, which returns the set of language identifiers that have a tree-sitter grammar. This helper derives that set from the walker's extension-to-language map, kept import-light so `status` does not load web-tree-sitter just to label tiers.

For the top-N list, `collect` counts symbols per file, sorts descending by count, and keeps the first `topN`. It then queries open debt rows (unresolved) with a `LEFT JOIN` on anchors and doc pages. The join uses `COALESCE` so that `symbol_key` and `wiki_path` survive anchor deletion — identity comes from the durable debt columns rather than the join alone. Events and assignees are counted into buckets, and each row becomes a `DebtItem`.

Undocumented symbols are read from the `undocumented` table (where `dismissed = 0`), and each is classified by file-path role using the configuration's path roles. Only the first 20 samples per role are kept. Finally, metadata such as schema version, last indexed time, and last ledger time are read from the `meta` table, defaulting to 0 or `null` when absent.

## Evaluating the versioned baseline

<!-- lw:anchors packages/core/src/status.ts#applyVersionedBaseline packages/core/src/status.ts#compareText -->

The second stage attaches repository-portable debt authority by comparing the on-disk baseline against the current index.

```typescript
async function applyVersionedBaseline(
  db: import("better-sqlite3").Database,
  absRoot: string,
  report: StatusReport,
): Promise<void>
```

`applyVersionedBaseline` takes the database, the absolute repository root, and the partial report, and mutates the report's `debt` section in place. It loads the baseline file; if the baseline is `unavailable` or `incompatible`, it records that state (and any issues) and returns early. Otherwise it reads all active symbols, collects the baseline documentation inventory, and evaluates the baseline. The evaluation yields a health object with entries, moves, and removed anchors.

A set of removed identities prevents an anchor that vanished from being double-reported as a changed/deleted item — each such entry surfaces only under `removedAnchors`. Accepted entries whose state is `changed` become `changed` debt items; entries state `deleted` become `deleted` items unless they also appear as a move. Moves become their own items with a `detail` JSON describing the old-to-new key transition. The item list is sorted deterministically by wiki path, then symbol key, then event using `compareText`.

`compareText(left, right)` performs a simple lexicographic comparison and returns -1, 0, or 1. It takes two strings and returns their sort order, used solely to make the debt-item ordering stable and reproducible. The report's `repository` section then records totals, the `clean` count, and grouped gap lists for unbaselined, inferred, and removed-anchor entries.

## Computing index freshness

<!-- lw:anchors packages/core/src/status.ts#applyFreshness -->

The third stage determines whether the index snapshot is stale without walking the whole repository.

```typescript
async function applyFreshness(
  db: import("better-sqlite3").Database,
  absRoot: string,
  report: StatusReport,
): Promise<void>
```

`applyFreshness` takes the database, the absolute repository root, and the partial report, and mutates `report.meta` with a `snapshotAgeMs`, `stale`, and `staleChangedFiles`. If the index was never created (`lastIndexedAt` is `null`), the snapshot age is `null`, staleness is `false`, and the changed-file count is 0. Otherwise it computes `snapshotAgeMs` as the (non-negative) difference between now and the last indexed timestamp.

To detect staleness, it reads every active file path from the index and stats each one on disk. A file counts as changed when the stat fails (file missing) or when its mtime is newer than `lastIndexedAt`. The comparison deliberately uses `lastIndexedAt` rather than the per-row indexed mtime, because the indexer skips hash-unchanged files and does not refresh their row mtimes — a touch-then-reindex cycle would otherwise stay permanently stale. A file created but never indexed is out of scope by design; detecting those would require a full walk. If any changed file is found, the index is marked stale and the count is recorded.

## Ranking debt by risk

<!-- lw:anchors packages/core/src/status.ts#applyRiskRanking -->

The optional fourth stage orders open debt by a deterministic risk score and attaches additive metadata.

```typescript
async function applyRiskRanking(
  db: import("better-sqlite3").Database,
  absRoot: string,
  report: StatusReport,
  config: LivewikiConfig,
): Promise<void>
```

`applyRiskRanking` takes the database, the absolute repository root, the partial report, and the configuration, and reorders `report.debt.items` in place while adding a `risk` field to each item. It returns early when risk analysis is disabled in the config. Otherwise it reads active files, labels each by tier, and recomputes imports on demand for anchored paths only — prose-tier files have no grammar and would yield no edges, so they are skipped. Test coverage and fan-in are computed for the known file set, and git churn is collected only when the configured churn window is positive (otherwise it degrades to `null`).

For each debt item, the symbol key is mapped back to a path; when no path is derivable, tier and coverage are `null`, fan-in defaults to 0, and churn is `null`. The risk score is computed via `scoreDebtItem`, and the item list is sorted via `compareByRisk`. The debted identity and deduplication are untouched — only the presentation order and the additive `risk` field change.

## Collecting degraded pages from disk

<!-- lw:anchors packages/core/src/status.ts#collectDegradedPages -->

The recovery tier walks the `livewiki/` tree fresh from disk to find pages flagged `quality: degraded` in their frontmatter.

```typescript
async function collectDegradedPages(
  absRoot: string,
): Promise<{ total: number; pages: string[] }>
```

`collectDegradedPages` takes the absolute repository root and returns an object with the total count and sorted list of relative page paths. It traverses the `livewiki/` directory iteratively. Hidden directories (names starting with a dot) are never descended, but dot-prefixed pages are legitimate artifacts and are read normally. A page is considered degraded only when its frontmatter parses and its `quality` field equals `degraded`. An unreadable file or unparseable frontmatter simply does not count — `status` never fails because of a single broken page. Paths are normalized to forward slashes and sorted before being returned.

## Formatting the report for humans

<!-- lw:anchors packages/core/src/status.ts#formatHuman packages/core/src/status.ts#formatSnapshotAge packages/core/src/status.ts#formatLocalTimestamp packages/core/src/status.ts#formatActivityEvent packages/core/src/status.ts#formatDuration -->

The public formatter renders the structured report as multi-line text for terminal consumption.

```typescript
export function formatHuman(report: StatusReport): string
```

`formatHuman` takes the full `StatusReport` and returns a single string of newline-joined lines. It prints an "Indexed files" section with per-language counts and coverage tiers, then an "Extracted symbols" section grouped by kind, then the top-N files by symbol count (only when non-empty). The documentation baseline is printed as a single line, with any baseline issues and the repository-level debt breakdown when available (coverage gaps for unbaselined, inferred, and removed anchors). Local projected debt is shown with event and assignee buckets, and each open debt item gets a line with event, assignee, target, and an optional `[risk N]` marker.

Undocumented counts and a sample of symbols follow. If any degraded pages exist, they are listed under a "Degraded pages (relaxed contract)" header. Activity metrics are printed only when the ledger is non-empty and there is recent activity — the block is completely omitted otherwise, since JSON consumers read `metrics` separately. The final line reports the schema version and the last indexed/ledger timestamps.

Several small helpers support the text rendering. `formatSnapshotAge(ms)` takes a millisecond age and returns a compact label like `12s`, `5m`, `3h`, or `4d`. `formatLocalTimestamp(ts)` takes an epoch timestamp and returns a zero-padded local-time string in `YYYY-MM-DD HH:mm` form. `formatActivityEvent(e)` takes a single update metric event and produces a one-line summary describing package emission, write receipt, debt resolution, or batch-run status (the batch case uses `formatDuration`). `formatDuration(ms)` takes a millisecond wall-clock duration and renders it as `45s`, `30m`, or `1h12m` — the only compact form used for the activity block.

## Tests

Covered by `packages/core/src/status.test.ts` (same-name test file on disk).
