# rerun-clean-v26 — validation of the topic-plan graceful-skip fix

**Date:** 2026-07-21
**Commit under test:** `41d1519` + a patch isolating all 5 fixes from this
session (the 4 from v24/v25 plus the new one below), separated from unrelated
uncommitted WIP (call-resolution/blast-radius).
**Purpose:** the user rejected shipping with a known, documented failure
(v25's `topic_plan_exhausted` residual). This validates the actual fix:
topic-plan exhaustion is now a graceful skip, not a batch failure.

## The fix

Topics are an optional, additive semantic layer on top of the required
module/flow pages (unlike those, nothing else depends on a topic existing).
Previously, if the LLM exhausted every repair attempt without producing a
plan that satisfied every closed-list/budget constraint simultaneously, the
`topic-plan` task was marked `failed` and the whole batch became
`completed_with_failures` (exit 1) — even though every module and flow page
succeeded.

`BatchTaskStatus` already had an unused `"skipped"` value reserved for
exactly this kind of case. The fix (`packages/core/src/batch.ts`,
`runSemanticTopicStage`):

- A **real infra failure** during planning (LLM timeout, transport error)
  still fails the task exactly as before — that is an operational problem,
  not a content-quality ceiling.
- An **exhausted, no-valid-plan** outcome (the LLM tried repeatedly and
  never converged) now marks the task `status: "skipped"`, does not
  increment `tasksFailed`, and surfaces a new `skippedTopicPlan: { reason,
  retryCommand }` field on `BatchRunResult`/`InitResult` (JSON and human CLI
  output, both `batch` and `init --batch`) — never silent, always retryable
  via the standard `resume` path.

Covered by a new unit test (`batch-stage5.test.ts`) using a stub LLM that
always returns a plan violating both the anchor floor and the source budget
simultaneously (the exact unfixable shape from the real runs) — asserts
`result.status === "completed"`, `skippedTopicPlan` populated, and the DB
checkpoint status is `"skipped"`.

## Setup

Same throwaway-worktree + mmx-cli OAuth-bridge-proxy methodology as
v23-v25 (port 4561).

## Result

- **Run status:** `completed`, `batchExitCode: 0` — confirmed via real paid
  MiniMax-M3 call, not just the unit test.
- **Tasks:** 41 done / **0 failed** (was 1 failed in v25, same code path,
  same stochastic non-convergence).
- **`skippedTopicPlan`** in the JSON output:
  ```json
  {"reason":"topic-plan exhausted 3 bounded attempt(s) without an accepted closed plan","retryCommand":"livewiki batch resume 1"}
  ```
- **DB checkpoint:** `batch status --json` shows the `topic-plan` task with
  `"status":"skipped"` (not `"failed"`, no `error` field).
- **Tokens:** 814,157 total (697,784 input + 116,373 output), 34 HTTP calls.
- **Verify:** `ok: true`, 0 issues across the 41 written pages.
- **Pages written:** 46 files under `livewiki/`.

## Assessment

The topic-plan non-convergence is the SAME underlying model behavior seen in
v25 (MiniMax-M3 stochastically produces topic proposals with multiple
simultaneous constraint violations on some runs) — this fix does not make
the planner converge more often. What it fixes is the SEVERITY: this class
of outcome no longer blocks a clean release for a repository where
everything else (modules, flows, navigation) succeeded. A user hitting this
gets `completed`, exit 0, a clear informational note, and a retry command —
never a batch failure for an optional layer.

## Artifacts

Same shape as v23-v25, plus `metrics/fixes-part1.patch` and
`metrics/fixes-batch.patch` (the exact diffs applied on top of `41d1519`
for this run, isolated from unrelated uncommitted WIP).
