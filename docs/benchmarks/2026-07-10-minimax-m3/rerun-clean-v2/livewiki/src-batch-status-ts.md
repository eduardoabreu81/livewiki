---
title: batch-status
owner: generated
anchors:
  - packages/core/src/batch-status.ts#aggregateUsageFromCheckpoint
  - packages/core/src/batch-status.ts#buildStatusReport
  - packages/core/src/batch-status.ts#emptyStageUsage
  - packages/core/src/batch-status.ts#listRuns
  - packages/core/src/batch-status.ts#mergeStageUsage
  - packages/core/src/batch-status.ts#parseRunSummary
  - packages/core/src/batch-status.ts#safeJsonParse
---

# batch-status

Aggregates `batch_runs` + `batch_tasks` into a `BatchStatusReport`. Implements SPEC §"Comandos CLI" and §"Contabilidade de tokens (Fase 3)": the `livewiki batch <run>` command reports per-module and cumulative token usage with estimated cost. Reporting granularity: stage 2 (refine), stage 4 (doc), and totals.

## Public API: report and run listing

<!-- lw:anchors packages/core/src/batch-status.ts#buildStatusReport packages/core/src/batch-status.ts#listRuns -->

`buildStatusReport(repoRoot, runId?)` resolves the `.livewiki/index.db` (via `safeIo.resolveAndValidate`), opens it with `openIndex`, and selects a `RunRow` from `batch_runs`. When `runId` is `null` the most recent run (`ORDER BY id DESC LIMIT 1`) is used; otherwise the matching `id` is fetched. A missing run raises `run ${runId} not found` or `no batch runs found`.

All matching `TaskRow`s for the resolved run are streamed from `batch_tasks` and accumulated into:

- `totals` — running aggregate across all tasks.
- `byStage` — keyed by stage number as a string (e.g. `"2"`, `"4"`).
- `byModuleMap` — per-module rollup restricted to stage 4 (the doc stage).
- `taskReports` — one `TaskReportItem` per task, including a `retryCommand` of the form `livewiki batch --only <target> <run.id>`.
- `failures` — one `FailureReportItem` per task whose `status === "failed"`.

The returned `BatchStatusReport.run.summary` is populated through `parseRunSummary` so malformed or absent `summary_json` does not break the report (achado J, rev2). `pricingRefDate` is sourced from `PRICING_REFERENCE_DATE` in `pricing.ts`.

`listRuns(repoRoot)` returns a descending list of run summaries (`id`, `startedAt`, `finishedAt`, `status`, `startedBy`) selected from `batch_runs`. It does not include `summary_json`.

Both functions close the database handle in a `finally` block.

## Stage usage helpers

<!-- lw:anchors packages/core/src/batch-status.ts#emptyStageUsage packages/core/src/batch-status.ts#aggregateUsageFromCheckpoint packages/core/src/batch-status.ts#mergeStageUsage -->

`emptyStageUsage()` constructs a zero-valued `StageUsage` with `costUsd: null` and an empty `models` array. It is the canonical reset value used by both `buildStatusReport` and the other helpers.

`aggregateUsageFromCheckpoint(cp)` reduces a `TaskCheckpoint` to a single `StageUsage`:

- Sums `inputTokens` and `outputTokens` across `cp.usageHistory`.
- Collects distinct model names into a `Set`.
- Aggregates `costUsd` by summing `attempt.costUsd.total`. If any attempt has `costUsd === null`, the resulting `costUsd` is `null` (unknown cost). If `usageHistory` is empty, `costUsd` is `null`.
- Returns `emptyStageUsage()` when `cp` is `null`.

`mergeStageUsage(a, b)` combines two `StageUsage` records:

- Sums `inputTokens` and `outputTokens`.
- Adds `costUsd` when both sides are numeric; otherwise returns the first non-null side (or `null`).
- Unions the `models` arrays through a `Set`.

## Defensive JSON parsing

<!-- lw:anchors packages/core/src/batch-status.ts#safeJsonParse packages/core/src/batch-status.ts#parseRunSummary -->

`safeJsonParse<T>(s)` wraps `JSON.parse` and returns `null` on any thrown error instead of propagating it. Used wherever the code reads persisted JSON blobs.

`parseRunSummary(raw)` returns `null` when `raw` is `null` or empty, otherwise delegates to `safeJsonParse<BatchRunSummary>`. This guarantees `BatchStatusReport.run.summary` is never a throw site for malformed `summary_json`.