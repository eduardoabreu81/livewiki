# rerun-clean-v25 — validation of the topic-page mechanical repair fix

**Date:** 2026-07-21
**Commit under test:** `41d1519` + a patch isolating 4 fixes (the 3 from v24 —
`**/scripts/**` tooling classification, `repairUpperBoundArtifactMechanically`
skip-unrecognized-error, `repairTopicPlanSourceBudgetMechanically` per-proposal
gate — plus the new one from this session: wiring
`repairUpperBoundArtifactMechanically` into `attemptTopicGeneration`, the topic
PAGE generation path, which previously had no mechanical fallback at all).
**Purpose:** validate whether wiring the mechanical repair into topic page
generation reduces failures further, and whether the other 3 fixes continue
to hold.

## Setup

Same throwaway-worktree + mmx-cli OAuth-bridge-proxy methodology as v23/v24
(port 4560 this time). Command: `livewiki init --batch --json`.

## Result

- **Run status:** `completed_with_failures`, `batchExitCode: 1` — a real
  improvement over v24's `aborted`.
- **Tasks:** 42 done / 1 failed (43 total) — down from v24's 3 failures.
- **Tokens:** 707,067 total (601,151 input + 106,916 output), 30 HTTP calls.
- **Verify:** `ok: true`, 0 issues across the 42 written pages.
- **Pages written:** 46 files under `livewiki/`.

## Targeted-fix verification

| Fix | Result |
|---|---|
| `**/scripts/**` tooling classification | **Held.** No `missing_page_opening` recurrence. |
| `repairUpperBoundArtifactMechanically` (flow pages) | **Held.** Zero flow-page failures this run (all flow candidates converged) — no direct stress test of the specific mixed-error fix, but no regression either. |
| `repairTopicPlanSourceBudgetMechanically` per-proposal gate | **Not conclusively tested this run** — see the one failure below; it's a different failure shape than what this fix targets. |
| `repairUpperBoundArtifactMechanically` wired into topic PAGE generation | **Not exercised.** `topic-plan` itself failed before any topic page task could be created (topic pages depend on an accepted plan), so this fix had nothing to repair this run. Needs a future run where the topic plan converges but an individual topic page still trips `duplicate_anchor`/`missing_closed_key` to actually confirm it.

## The one remaining failure: a known, already-documented limitation

`topic-plan` failed with `topic_plan_exhausted`. Unlike v23's failure (which
the per-proposal gate fix targets: one clean proposal blocked by an unrelated
error elsewhere), every attempt here has **multiple simultaneous violations on
the same proposals** — e.g. attempt 3 shows 3 different proposals each over
the source-character budget AND all 3 also failing the 5-18 anchor-count
budget, plus 2 module-count violations. No mechanical fix is safe here: fixing
source budget alone would still leave anchor/module-count violations
unresolved on the very same proposals, so the mandatory final re-validation
correctly still fails and the mechanical repair correctly declines (as
designed — see the artifact-repair v24 notes on fail-closed behavior).

This is the same class of gap flagged as a known limitation in the v23/v24
notes: **MiniMax-M3 sometimes proposes topic candidates with multiple
simultaneous constraint violations**, which is a model-behavior /
prompt-quality issue, not a mechanical-repair gap. It is stochastic — v24's
topic-plan converged cleanly on the same code; v25's did not, on an otherwise
identical fix set. Not a regression.

## Assessment for launch readiness

- The circuit breaker isolates this failure correctly: it did not abort the
  run or corrupt any other page (`completed_with_failures`, not `aborted`;
  `verify` clean). A user hitting this gets one clearly failed task with a
  `retryCommand`, not a broken wiki.
- Recommend treating "topic-plan may occasionally fail to converge on a
  proposal with multiple simultaneous constraint violations" as a documented
  known limitation for the initial public release, not a blocker. Topics are
  an additive semantic layer on top of the module/flow pages, which is the
  core value and which held clean across v22-v25.

## Artifacts

Same shape as v23/v24: `livewiki/`, `metrics/livewiki-config.json`,
`metrics/batch-status.json`, `metrics/verify.json`,
`metrics/init-batch-output.json`,
`metrics/token-proxy-livewiki-r10-r11-v25.jsonl`.
