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

The read path separates "there is no history" from "the history cannot be read", because collapsing the two is what allowed the next append to erase the ledger.

```ts
async function readMetrics(repoRoot: string): Promise<MetricsRead>
async function writeMetrics(repoRoot: string, file: UpdateMetricsFile): Promise<void>
```

`readMetrics` takes a repository root and returns `{ file, corruption }`. A missing file is not an error: it yields an empty `{ version: 1, entries: [] }` with `corruption: null`, because no file legitimately means no history. Anything else that stops the ledger from being interpreted — unreadable bytes, invalid JSON, a `version` other than 1, a non-array `entries` — still yields the empty file so callers keep working, but reports the reason alongside it and, when the bytes were readable, the raw content. `corruption.raw` is `null` only when even the read failed; that case can neither be preserved nor safely replaced.

`writeMetrics` takes a repository root and a full `UpdateMetricsFile` and persists it as pretty-printed JSON plus a trailing newline via `safeIo.writeTextAtomic`. The atomic primitive matters here specifically: a ledger torn by an interrupted write is the failure this module exists to avoid, and a plain `writeText` truncates before it writes.

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

This takes a repository root and an `UpdateMetric` (one of the four `kind` variants) and returns nothing. On the happy path it reads the file, pushes the new entry, and writes the file back atomically. The body stays wrapped in a `try/catch` whose catch is empty, because accounting is best-effort and must not break the main `update` flow — the caller is documented as fire-and-forget.

What changed is what happens between the read and the write. When `readMetrics` reports corruption, the unreadable file is copied to a backup **before** anything replaces it, and only then does the new ledger get written. The new ledger contains just the incoming metric: nothing is reconstructed or guessed from the corrupt bytes.

The backup naming policy never destroys existing evidence. The first backup is `.livewiki/update_metrics.json.bak`; if that name is taken, the next is `.<epoch-ms>.bak`, then `.<epoch-ms>-<n>.bak`. Every candidate is created with the `wx` flag, so an existing backup survives — including against a concurrent writer racing for the same name. An older corruption outranks a newer one for the plain `.bak` name.

If the backup cannot be written at all, `preserveCorruptLedger` throws and the empty catch swallows it, which means **nothing is written**. That ordering is the guarantee: losing a single metric is recoverable, losing the history is not, so the original stays on disk untouched whenever it could not be copied. The same holds when the final write fails after a successful backup — the history is then recoverable from the `.bak` and the original is still in place.

## Aggregating: `snapshotMetrics`

<!-- lw:anchors
packages/core/src/update-metrics.ts#snapshotMetrics
-->

The aggregation entry point is what `status --json` and other status surfaces consume.

```ts
export async function snapshotMetrics(repoRoot: string): Promise<UpdateMetricsSnapshot>
```

This takes a repository root and returns an `UpdateMetricsSnapshot`. It reads the ledger once — and when that read reports corruption, it emits a `[livewiki] update-metrics:` warning before continuing, so the zeros it is about to return are not mistaken for a repository that never ran. Being a read-only path it takes no backup and mutates nothing; the file is left exactly as found, and the next write is what preserves it. It then folds over every entry to compute totals: `packagesEmitted` and `totalPackageTokens` (from `package_emitted`), `writesReceived` and `totalWriteTokens` (from `write_received`), `debtResolvedTotal` (a sum of `count` across `debt_resolved`), and `batchRuns` / `batchInputTokens` / `batchOutputTokens` (from `batch_run`). It also remembers the last `package_emitted` and the last `write_received` for debugging, exposes the last 10 entries as `recent`, and finally computes `efficiencyRatio` as `totalWriteTokens / totalPackageTokens` — but only when `totalPackageTokens > 0`; otherwise it returns `null` rather than `Infinity` or `NaN`. The ratio is the proxy that backs the product thesis ("800 tokens instead of re-reading the repo").

## Full history: `listUpdateMetrics`

<!-- lw:anchors
packages/core/src/update-metrics.ts#listUpdateMetrics
-->

While the snapshot exposes aggregates plus a short tail, the Phase 7 Activity viewer needs every entry.

```ts
export async function listUpdateMetrics(repoRoot: string): Promise<UpdateMetric[]>
```

This takes a repository root and returns the full `entries` array in insertion order (oldest first). It uses the same `readMetrics` path, so a corrupt ledger yields an empty list — but, as in `snapshotMetrics`, it warns first rather than passing off "unreadable" as "nothing happened". Like that path it is read-only: no backup, no mutation. The body stays wrapped in a `try/catch` that returns `[]` on any remaining failure, mirroring `recordUpdateMetric`'s "accounting never blocks the caller" posture — a path/realpath failure is treated as "no history" rather than an error.

The warning goes to `console.warn` with the `[livewiki]` prefix, the same channel `indexer`, `walker`, and `anchor-ledger` already use for conditions that must reach the operator without interrupting the run. No parallel reporting API was introduced.

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
