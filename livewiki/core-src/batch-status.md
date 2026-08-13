---
title: Batch status aggregation
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

# Batch status aggregation

This page documents how `packages/core/src/batch-status.ts` turns the raw `batch_runs` and `batch_tasks` SQLite tables into a structured status report consumed by the `livewiki batch` CLI.

## When to use this page

- **Inspect** a specific batch run's token and cost totals, including per-stage and per-module breakdowns.
- **List** all batch runs in a repository to find a run id before drilling into one.
- **Understand** how token accounting handles incomplete or unpriced attempts without breaking the report.
- **Trace** which persistence columns feed each field of the `BatchStatusReport` shape defined in `batch-state.ts`.

## How it fits

This module sits inside `packages/core/src/`, the shared core of the `livewiki` tool. The CLI command `livewiki batch <run>` is its primary caller: it opens the project's `.livewiki/index.db` (validated through `safe-io.resolveAndValidate`) via `db.openIndex`, reads batch run/task rows, and synthesizes a `BatchStatusReport`. Token-cost math leans on `pricing.ts` for the reference date that ends up in the report. Types come from `batch-state.ts`, which is the contract this module implements rather than defines.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-batch-status.mmd
```

## Run resolution and report assembly

<!-- lw:anchors packages/core/src/batch-status.ts#buildStatusReport packages/core/src/batch-status.ts#listRuns -->

The two public entry points both begin by resolving the repository root to an absolute path, asking `safe-io` to validate `.livewiki/index.db` against that root, and opening the SQLite index. The `try/finally` around `db.close()` ensures the database handle is released even when the report throws mid-assembly.

`buildStatusReport` is the heavy lifter. It selects either the `batch_runs` row whose `id` matches `runId`, or — when `runId` is `null` — the most recent run (`ORDER BY id DESC LIMIT 1`). If neither yields a row, it throws: `run ${runId} not found` for an explicit id, `no batch runs found` for the latest-run path. This is the only visible failure branch in the excerpt: a missing run aborts the report.

Once a run is in hand, it loads every `batch_tasks` row for that `run_id`, ordered by `id`, and walks them once. For each task it parses the `checkpoint_json` (when present) into a `TaskCheckpoint`, folds the checkpoint into a per-task `StageUsage`, and accumulates:

- a `totals` usage across all tasks,
- a per-stage map keyed by the stage number as a string,
- a per-module map restricted to stage 4 (`doc`), as a token/cost breakdown rather than a done count,
- a `TaskReportItem` carrying token counts, cost, attempt count, error, the stage-2 `communityCrossCheck`, the per-attempt `diagnosticHistory`, and a `retryCommand` of the form `livewiki batch --only <target> <runId>`,
- and, for any task whose status is `"failed"`, a `FailureReportItem` mirroring the task id, module, stage, error (or `{code:"unknown",message:"no error detail"}`), and the same retry command.

The final `BatchStatusReport` re-exposes the parsed `summary_json` through `parseRunSummary` so the run-level `modulesRefined` counter survives into the report, and it stamps `pricingRefDate` from `pricing.PRICING_REFERENCE_DATE` so consumers can interpret the cost figures.

`listRuns` is the lighter sibling: it selects the five summary columns from `batch_runs` ordered by `id DESC` and reshapes the snake_case row names into the camelCase contract callers expect (`startedAt`, `finishedAt`, `startedBy`). It does not touch `batch_tasks`.

The literal signature for the report builder is:

```ts
export async function buildStatusReport(
  repoRoot: string,
  runId: number | null = null,
): Promise<BatchStatusReport>
```

It takes the repository root (used to locate the SQLite index) and an optional run id; it returns the assembled `BatchStatusReport` whose shape is defined in `batch-state.ts`.

## Usage accounting and stage merging

<!-- lw:anchors packages/core/src/batch-status.ts#aggregateUsageFromCheckpoint packages/core/src/batch-status.ts#emptyStageUsage packages/core/src/batch-status.ts#mergeStageUsage -->

Token accounting goes through three small helpers. The blank slate comes from `emptyStageUsage`, which returns a `StageUsage` with zero token counters, `costUsd: null`, an empty `models` array, and `usageIncomplete: false`.

```ts
function emptyStageUsage(): StageUsage
```

A `StageUsage` is a fresh zero/null container with no arguments; the caller is expected to mutate it or merge into it.

```ts
function aggregateUsageFromCheckpoint(cp: TaskCheckpoint | null): StageUsage
```

`aggregateUsageFromCheckpoint` walks `cp.usageHistory`. An attempt is treated as "known" when its `usage` is a non-null object AND `usageKnown` is not explicitly `false`; the explicit `false` is the malformed/unknown sentinel, and any unknown attempt flips `usageIncomplete` to `true` and is skipped from totals. Known attempts contribute their `inputTokens`, `outputTokens`, and `model` to running sums. The cost accumulator has a deliberate three-state policy: `cost` starts as `null`, the first priced attempt seeds it with `attempt.costUsd.total`, later priced attempts add into it, but if any known attempt arrives without a price the overall `cost` is reset to `null` (the existing "known usage without price → cost unknown" rule). If no attempt was known at all — a timeout-only or empty-history checkpoint — the function returns a fresh empty usage with `costUsd: null` and `usageIncomplete: true` whenever `usageHistory` was non-empty, so a synthetic zero cost is never produced. A `null` checkpoint short-circuits to `emptyStageUsage()`.

```ts
function mergeStageUsage(a: StageUsage, b: StageUsage): StageUsage
```

`mergeStageUsage` combines two usage snapshots element-wise. Token counters add directly. `costUsd` follows the same three-state rule: if either side is `null`, the result is whichever side was non-null (or `null` if both are), otherwise it is the sum. The model lists are deduplicated through a `Set` round-trip, and `usageIncomplete` is the boolean OR of the two flags. `buildStatusReport` uses this helper both for the per-stage map and for the stage-4 per-module map.

## Tolerant JSON parsing

<!-- lw:anchors packages/core/src/batch-status.ts#safeJsonParse packages/core/src/batch-status.ts#parseRunSummary -->

Because checkpoint and summary payloads are stored as opaque JSON strings on disk, two tiny helpers insulate the rest of the module from corruption.

```ts
function safeJsonParse<T>(s: string): T | null
```

`safeJsonParse` wraps `JSON.parse` in a `try/catch` and returns `null` on any thrown exception; it never re-throws.

```ts
function parseRunSummary(raw: string | null): BatchRunSummary | null
```

`parseRunSummary` is the one-line wrapper the report builder calls: it returns `null` when `raw` is falsy and otherwise delegates to `safeJsonParse<BatchRunSummary>`. The combined behavior is that an absent or malformed `summary_json` collapses to `null` rather than aborting the report — the rationale comment calls this out explicitly as "finding J from rev2" so the status command never breaks on a bad row.

## Tests

Covered by `packages/core/src/batch-status.test.ts` (same-name test file on disk).
