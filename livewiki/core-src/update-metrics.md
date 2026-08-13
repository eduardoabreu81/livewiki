---
title: Update metrics ledger
owner: generated
anchors:
  - packages/core/src/update-metrics.ts#clearMetricsForTests
  - packages/core/src/update-metrics.ts#listUpdateMetrics
  - packages/core/src/update-metrics.ts#metricsPath
  - packages/core/src/update-metrics.ts#readMetrics
  - packages/core/src/update-metrics.ts#recordUpdateMetric
  - packages/core/src/update-metrics.ts#snapshotMetrics
  - packages/core/src/update-metrics.ts#writeMetrics
---

# Update metrics ledger

This page documents the incremental token accounting that backs livewiki's `update` workflow.

## When to use this page

- **Append a metric** when a `package_emitted`, `write_received`, `debt_resolved`, or `batch_run` event happens during `update`.
- **Read the aggregated snapshot** for `status --json` and other status surfaces that expose the product thesis (token efficiency ratio).
- **Inspect the full ledger** when the Activity viewer (Phase 7) needs every entry instead of just the last 10.
- **Reset the ledger** in test setup before exercising code paths that append metrics.

## How it fits

`packages/core/src/update-metrics.ts` lives in `packages/core/src/` and is the single source of truth for the append-only ledger stored at `.livewiki/update_metrics.json` inside a repository's `.livewiki/` directory. It does not touch the SQLite schema (v4) — accounting is intentionally isolated from the wiki's persisted content because the metrics are derivable from the versioned markdown/manifest and may be lost without harming correctness. The module is consumed by `update`, by `loadWorkPackage` (which emits `package_emitted`), by the `document-as-you-go` skill and the post-edit CLI (which emit `write_received`), by debt-resolution surfaces (which emit `debt_resolved`), by `finalizeRun` (which mirrors per-batch totals as `batch_run`), and by the Phase 7 Activity viewer (which reads the full history).

## Diagram

```mermaid
%% livewiki/diagrams/core-src-update-metrics.mmd
```

## Storage layout and the path helper

<!-- lw:anchors
packages/core/src/update-metrics.ts#metricsPath
-->

The ledger is a single JSON file at the relative path `.livewiki/update_metrics.json` inside the repository. Choosing a JSON file (rather than a SQLite table) keeps the schema untouched, lets the ledger be discarded at any time (the next `update` rebuilds it from scratch), and avoids schema migrations for an append-only log.

`metricsPath` resolves the absolute location of the ledger, and is the only producer of the path that the rest of the module uses.

```ts
async function metricsPath(repoRoot: string): Promise<string>
```

This takes a repository root (absolute or relative) and returns the absolute path of the metrics file, delegating bounds enforcement to `safeIo.resolveAndValidate` so the file cannot escape `.livewiki/`.

## Reading and writing the ledger

<!-- lw:anchors
packages/core/src/update-metrics.ts#readMetrics
packages/core/src/update-metrics.ts#writeMetrics
-->

The read path tolerates first-run and corruption as a normal case, while the write path is a straight serialisation.

```ts
async function readMetrics(repoRoot: string): Promise<UpdateMetricsFile>
async function writeMetrics(repoRoot: string, file: UpdateMetricsFile): Promise<void>
```

`readMetrics` takes a repository root and returns the parsed `UpdateMetricsFile`; if the file is missing, unreadable, or has an unexpected `version`/non-array `entries`, it returns an empty `{ version: 1, entries: [] }` instead of throwing — the ledger is reconstructible, so corruption is non-fatal. `writeMetrics` takes a repository root and a full `UpdateMetricsFile` and persists it as pretty-printed JSON plus a trailing newline via `safeIo.writeText`, producing a "last coherent state" snapshot.

## Append: `recordUpdateMetric`

<!-- lw:anchors
packages/core/src/update-metrics.ts#recordUpdateMetric
-->

The append entry point is the only function that mutates the file on disk.

```ts
export async function recordUpdateMetric(
  repoRoot: string,
  metric: UpdateMetric,
): Promise<void>
```

This takes a repository root and an `UpdateMetric` (one of the four `kind` variants) and returns nothing. Internally it reads the file, pushes the new entry, and writes the file back — but the entire body is wrapped in a `try/catch` whose catch is empty. The rationale is that accounting is best-effort: a failure here must not break the main `update` flow, and the caller is documented as fire-and-forget. So while the happy path appends and persists, the visible code path also swallows any read/write/parse error silently.

## Aggregating: `snapshotMetrics`

<!-- lw:anchors
packages/core/src/update-metrics.ts#snapshotMetrics
-->

The aggregation entry point is what `status --json` and other status surfaces consume.

```ts
export async function snapshotMetrics(repoRoot: string): Promise<UpdateMetricsSnapshot>
```

This takes a repository root and returns an `UpdateMetricsSnapshot`. It reads the ledger once, then folds over every entry to compute totals: `packagesEmitted` and `totalPackageTokens` (from `package_emitted`), `writesReceived` and `totalWriteTokens` (from `write_received`), `debtResolvedTotal` (a sum of `count` across `debt_resolved`), and `batchRuns` / `batchInputTokens` / `batchOutputTokens` (from `batch_run`). It also remembers the last `package_emitted` and the last `write_received` for debugging, exposes the last 10 entries as `recent`, and finally computes `efficiencyRatio` as `totalWriteTokens / totalPackageTokens` — but only when `totalPackageTokens > 0`; otherwise it returns `null` rather than `Infinity` or `NaN`. The ratio is the proxy that backs the product thesis ("800 tokens instead of re-reading the repo").

## Full history: `listUpdateMetrics`

<!-- lw:anchors
packages/core/src/update-metrics.ts#listUpdateMetrics
-->

While the snapshot exposes aggregates plus a short tail, the Phase 7 Activity viewer needs every entry.

```ts
export async function listUpdateMetrics(repoRoot: string): Promise<UpdateMetric[]>
```

This takes a repository root and returns the full `entries` array in insertion order (oldest first). It uses the same `readMetrics` path and therefore inherits the same tolerance for missing/corrupt files. The visible code wraps the body in a `try/catch` that returns `[]` on any failure, mirroring `recordUpdateMetric`'s "accounting never blocks the caller" posture — a path/realpath failure is treated as "no history" rather than an error.

## Test reset: `clearMetricsForTests`

<!-- lw:anchors
packages/core/src/update-metrics.ts#clearMetricsForTests
-->

The only destructive function in the module is explicitly reserved for tests.

```ts
export async function clearMetricsForTests(repoRoot: string): Promise<void>
```

This takes a repository root and returns nothing. It `resolve`s the root to an absolute path, ensures the `.livewiki/` directory exists via `safeIo.mkdir`, and then writes an empty `{ version: 1, entries: [] }` ledger via `writeMetrics`. The module-level comment is emphatic: never call this from production code — it is a setup helper that wipes observable state.

## Tests

Covered by `packages/core/src/update-metrics.test.ts` (same-name test file on disk).
