---
title: Update Metrics Ledger Management
owner: generated
anchors:
- packages/core/src/update-metrics.ts#backupRelPath
- packages/core/src/update-metrics.ts#clearMetricsForTests
- packages/core/src/update-metrics.ts#listUpdateMetrics
- packages/core/src/update-metrics.ts#metricsPath
- packages/core/src/update-metrics.ts#preserveCorruptLedger
- packages/core/src/update-metrics.ts#readMetrics
- packages/core/src/update-metrics.ts#recordUpdateMetric
- packages/core/src/update-metrics.ts#snapshotMetrics
- packages/core/src/update-metrics.ts#warnCorruptOnRead
- packages/core/src/update-metrics.ts#writeMetrics
---

# Update Metrics Ledger Management

This page describes the append-only JSON ledger that tracks token and work metrics during the `update` operation, ensuring accounting data is robustly persisted.

## When to use this page

- Understand how the `update` process records package emissions, agent write-backs, debt resolutions, and batch-run costs for incremental token accounting.
- Learn how to safely read or write the metrics file while protecting against data loss from corruption or concurrent processes.
- Discover how to obtain aggregated or full metrics for reporting and validation.
- Find the production-safe mechanism for clearing metrics, which is available for test setup.

## How it fits

The file `packages/core/src/update-metrics.ts` implements the token-accounting ledger for the `update` pipeline. It stores an append-only list of `UpdateMetric` entries in `.livewiki/update_metrics.json`. This module is designed for low-power, incremental queries—aggregates and "last value" lookups—rather than relational queries. Specifically, it offers a write path (`recordUpdateMetric`) that is fire-and-forget, and two read paths for reports: a `snapshotMetrics` aggregate and the full `listUpdateMetrics` history. The module ensures that any ledger corruption is preserved to a backup file before a new file is written, and read-only operations never overwrite or silently discard unreadable data. The ledger is intentionally rebuildable from versioned markdown sources—if `.livewiki` is deleted, the next `update` restarts metrics from scratch.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-update-metrics.mmd
```

## Metrics Path Resolution

<!-- lw:anchors packages/core/src/update-metrics.ts#metricsPath -->

This section explains how the module locates the ledger file, which is the first step for every read and write operation.

The function `metricsPath` converts a repository root into the absolute path of the metrics file. It begins resolution with a fixed relative path and confirms it lies safely within the repository.

```ts
async function metricsPath(repoRoot: string): Promise<string> {
```

It takes a repository root string and returns a promise of the absolute file path for `.livewiki/update_metrics.json`. It delegates to `safeIo.resolveAndValidate` to prevent path traversal outside the repo.

## Reading the Ledger

<!-- lw:anchors packages/core/src/update-metrics.ts#readMetrics -->

This section details the read operation, which distinguishes an absent file from a corrupt one—a distinction critical to preventing silent data loss.

`readMetrics` fetches the ledger, treating a missing file as legitimate history (returning an empty ledger) while flagging any file that cannot be parsed as corruption.

```ts
async function readMetrics(repoRoot: string): Promise<MetricsRead> {
```

It takes a repo root and returns a `MetricsRead` object holding an `UpdateMetricsFile` and an optional `LedgerCorruption` descriptor. The function first assumes a valid empty ledger, then attempts to read the file. If the file does not exist (an `ENOENT` error), it returns that empty structure with no corruption. If the file exists but cannot be read, it reports a corruption with a null `raw` byte content, meaning nothing can be preserved. If reading succeeds but parsing fails or the structure is not version 1 with an entries array, it reports corruption carrying the raw text. This design ensures no write operation later unknowingly overwrites an unreadable file.

## Corruption Preservation and Warning

<!-- lw:anchors packages/core/src/update-metrics.ts#backupRelPath packages/core/src/update-metrics.ts#preserveCorruptLedger packages/core/src/update-metrics.ts#warnCorruptOnRead -->

This section covers the safeguards that protect unreadable or corrupt ledger data before it can be replaced or silently ignored.

The module treats an earlier corrupt file as evidence that outranks newer data, and it ensures such evidence is never destroyed without a copy.

First, `backupRelPath` generates a repo-relative backup candidate name.

```ts
function backupRelPath(suffix: string): string {
```

It takes a suffix string and returns the ledger’s relative path with that suffix plus a `.bak` extension appended. Its purpose is to support a bounded search for a name that does not already exist.

Then `preserveCorruptLedger` writes the raw bytes of the corrupt file to a new backup before any overwrite.

```ts
async function preserveCorruptLedger(
  repoRoot: string,
  corruption: LedgerCorruption,
): Promise<string> {
```

It takes a repository root and a corruption descriptor, and returns the relative path of the successfully written backup. The function immediately throws if the corruption holds no raw data, since replacing a file whose bytes could not be read is unsafe. Otherwise, it searches up to 100 candidate names: first a plain `.bak`, then a timestamped `.<epoch-ms>.bak`, then `.<epoch-ms>-<n>.bak`. Each candidate is opened with the `wx` flag, ensuring atomic exclusive creation; an existing name triggers a retry with the next candidate. On success it writes the bytes, logs a warning that history was preserved, and returns the path. On failure, it throws a descriptive error, and the caller must treat that as a signal not to write anything.

Finally, `warnCorruptOnRead` issues a warning for read-only paths that never replace the file.

```ts
function warnCorruptOnRead(corruption: LedgerCorruption): void {
```

This takes a corruption descriptor and emits a standard console warning that explains the corruption reason and states the ledger is left untouched until a future write preserves it. It is used by the snapshot and list operations that never modify the file, so the corruption is observed without any destructive action.

## Persisting the Ledger

<!-- lw:anchors packages/core/src/update-metrics.ts#writeMetrics -->

This section describes the low-level atomic write operation that prevents torn or partial ledger files.

`writeMetrics` serializes the full metrics file and persists it in one atomic operation so readers never observe a half-written ledger.

```ts
async function writeMetrics(repoRoot: string, file: UpdateMetricsFile): Promise<void> {
```

It takes a repository root and the complete `UpdateMetricsFile` object, and returns a promise that resolves when the file is durably written. The function pretty-prints the JSON and calls `safeIo.writeTextAtomic` to replace the file atomically, which is central to the module’s robustness against failures.

## Recording a Metric

<!-- lw:anchors packages/core/src/update-metrics.ts#recordUpdateMetric -->

This section explains the main write path that the update pipeline uses to log a single metric event. The operation is intentionally resilient so that accounting failures never interrupt the primary update operation.

`recordUpdateMetric` appends one metric to an existing ledger, first preserving any corruption it encounters.

```ts
export async function recordUpdateMetric(
  repoRoot: string,
  metric: UpdateMetric,
): Promise<void> {
```

It takes a repository root and a single `UpdateMetric` event, and the function resolves when the metric is recorded or fails silently by design. The function reads the current ledger, and if corruption was detected, it tries to preserve the original file by moving it to a numbered backup. After a successful preservation (or when the ledger is valid), it appends the new metric to the in-memory entries and writes the whole file atomically. If any step fails—including the critical preservation step—the function catches the error and intentionally swallows it, because losing one metric is recoverable, but blocking the main update flow is not. This is a fail-open behavior for accounting that never invents entries from unreadable content while still reporting the corruption.

## Producing an Aggregated Snapshot

<!-- lw:anchors packages/core/src/update-metrics.ts#snapshotMetrics -->

This section details the read-only aggregation that exposes the key efficiency indicator of the entire accounting system. It is the primary report used by `status --json`.

`snapshotMetrics` scans the full ledger and computes a set of aggregate counters and recent entries, while warning about corruption without trying to recreate the file.

```ts
export async function snapshotMetrics(repoRoot: string): Promise<UpdateMetricsSnapshot> {
```

It takes a repository root string and returns a promise of an `UpdateMetricsSnapshot` containing totals, ratios, and the last few ledger entries. The function first reads the ledger and, if corruption was found, invokes `warnCorruptOnRead` because this read-only path does not write any backup. It then iterates through every entry, incrementing per-kind counters and capturing the last-seen metric of each major type. After the loop, it computes the `efficiencyRatio` as the total write-back tokens divided by the total package-emission tokens, or leaves it null when no packages have been emitted. The returned object includes the last ten entries (oldest first) so callers have a small recency window without loading the entire ledger.

## Retrieving Full History

<!-- lw:anchors packages/core/src/update-metrics.ts#listUpdateMetrics -->

This section explains the alternative read path that provides the complete ledger history for the reviewer’s Activity page, which requires every entry rather than aggregates.

`listUpdateMetrics` returns the array of all recorded metrics in oldest-to-newest order.

```ts
export async function listUpdateMetrics(repoRoot: string): Promise<UpdateMetric[]> {
```

It takes a repository root string and resolves to the full list of `UpdateMetric` entries. The function reads the ledger, and if it detects corruption it emits `warnCorruptOnRead` before returning the existing (valid) entries or an empty array. It has the same best-effort posture as `recordUpdateMetric`: any path-resolution failure is caught and translated into an empty result, since a missing or unreachable ledger legitimately means there is no history. Unlike the snapshot, this function never aggregates and never truncates, giving the viewer the complete timeline of every recorded event.

## Test Cleanup Helper

<!-- lw:anchors packages/core/src/update-metrics.ts#clearMetricsForTests -->

This section documents a destructive utility that is intended solely for test setup, never for production callers.

`clearMetricsForTests` resets the ledger to an empty state, which developers use to give each test a clean accounting baseline.

```ts
export async function clearMetricsForTests(repoRoot: string): Promise<void> {
```

It takes a repository root string and returns a promise that resolves once the empty ledger is written. The function first ensures the `.livewiki` directory exists, then writes a new file with no entries using the same atomic write path. This helper is exposed only for test fixtures and is documented as destructive—any metrics accumulated before the call are permanently erased.

## Tests

Covered by `packages/core/src/update-metrics.test.ts` (same-name test file on disk).
