---
title: src/update-metrics.ts
owner: generated
anchors:
  - packages/core/src/update-metrics.ts#metricsPath
  - packages/core/src/update-metrics.ts#readMetrics
  - packages/core/src/update-metrics.ts#writeMetrics
  - packages/core/src/update-metrics.ts#recordUpdateMetric
  - packages/core/src/update-metrics.ts#snapshotMetrics
  - packages/core/src/update-metrics.ts#clearMetricsForTests
---

# src/update-metrics.ts

Incremental bookkeeping for the `update` workflow. Stores metrics as a
JSON file at `.livewiki/update_metrics.json` (append-only, schema
version 1) instead of extending the SQLite schema. Rationale: the file
is reconstructable, queries are limited to "latest value" and "sum by
kind", and append-only semantics avoid migration bookkeeping.

Each entry is a discriminated union with `kind` either
`package_emitted` (emitted by `loadWorkPackage`) or `write_received`
(emitted when an agent or human returns a doc). The
`packageEmittedTokens / writeReceivedTokens` ratio exposes the
product thesis: how much code the agent processed per line of doc
produced.

## Filesystem helpers
<!-- lw:anchors packages/core/src/update-metrics.ts#metricsPath packages/core/src/update-metrics.ts#readMetrics packages/core/src/update-metrics.ts#writeMetrics -->

- `metricsPath(repoRoot)` — resolves the absolute path of the metrics
  file under the validated repo root via `safeIo.resolveAndValidate`.
- `readMetrics(repoRoot)` — reads and parses the JSON file; returns a
  fresh `{ version: 1, entries: [] }` if the file is missing,
  unreadable, or has an invalid shape (corruption is recovered by
  starting over — the repository of record is the markdown/manifest
  tree, not this file).
- `writeMetrics(repoRoot, file)` — serializes the file with two-space
  indentation and a trailing newline via `safeIo.writeText`.

## Recording entries
<!-- lw:anchors packages/core/src/update-metrics.ts#recordUpdateMetric -->

`recordUpdateMetric(repoRoot, metric)` appends a single
`UpdateMetric` entry. The call is best-effort: errors are swallowed so
that bookkeeping failures never block the main `update` flow. The
exported function is intentionally fire-and-forget.

## Aggregated snapshot
<!-- lw:anchors packages/core/src/update-metrics.ts#snapshotMetrics -->

`snapshotMetrics(repoRoot)` returns an `UpdateMetricsSnapshot`
computed by a single pass over the entries array:

- `packagesEmitted`, `totalPackageTokens`, `lastPackage` — derived
  from `package_emitted` entries.
- `writesReceived`, `totalWriteTokens`, `lastWrite` — derived from
  `write_received` entries.
- `efficiencyRatio` — `totalWriteTokens / totalPackageTokens`, or
  `null` when no packages have been emitted yet. Values below `1.0`
  indicate the agent wrote less than it read (the desired regime).

Consumed by `status --json` to surface the product thesis.

## Test-only reset
<!-- lw:anchors packages/core/src/update-metrics.ts#clearMetricsForTests -->

`clearMetricsForTests(repoRoot)` ensures `.livewiki/` exists and
overwrites the metrics file with an empty `{ version: 1, entries: [] }`.
Destructive: never call from production code paths.