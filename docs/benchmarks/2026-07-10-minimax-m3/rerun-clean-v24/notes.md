# rerun-clean-v24 — validation of the v23 follow-up fixes (topic-plan gate, upper-bound partial repair, tooling classification)

**Date:** 2026-07-21
**Commit under test:** `41d1519` + an uncommitted patch isolating exactly 3 fixes
(`docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v24/metrics/fixes-under-test.patch`),
kept separate from unrelated in-progress work (call-resolution/blast-radius) so
this run measures only the fixes below.
**Purpose:** validate the three fixes made after v23:

1. `modules.ts` — `toolingPatterns` default changed `scripts/**` → `**/scripts/**`
   so nested package `scripts/` dirs (e.g. `packages/mcp/scripts/`) classify as
   `tooling` (deterministic auxiliary page, no LLM), not `product`.
2. `artifact-repair.ts` — `repairUpperBoundArtifactMechanically` no longer
   aborts the whole mechanical repair when an error code it doesn't recognize
   rides along with `duplicate_anchor`/`missing_closed_key`; it applies what it
   can and lets the mandatory final re-validation be the actual gate.
3. `topics.ts` — `repairTopicPlanSourceBudgetMechanically`'s gate now checks
   per-proposal (only proposals actually flagged `topic_plan_source_budget`),
   instead of requiring every error in the whole plan to be that one code.

## Setup

Same throwaway-worktree + mmx-cli OAuth-bridge-proxy methodology as v23 (port
4559 this time). Config: `{"provider":"openai-compat","model":"MiniMax-M3","language":"en","baseUrl":"http://127.0.0.1:4559/v1"}`.
Command: `livewiki init --batch --json`.

## Result

- **Run status:** `aborted` (circuit breaker), `batchExitCode: 2` — worse
  top-line status than v23's `completed_with_failures`, but see below: the
  abort happened on 3 different, weaker failures than v23's, not a regression
  of the same class.
- **Tasks:** 42 done / 3 failed (45 total).
- **Tokens:** 797,738 total (674,083 input + 123,655 output), 37 HTTP calls.
- **Verify:** `ok: true`, 0 issues across the 42 written pages.
- **Pages written:** 46 files under `livewiki/`.

## Targeted-fix verification

| Fix | Result |
|---|---|
| `**/scripts/**` tooling classification | **Held.** `mcp-scripts` and `cli-scripts` both completed as deterministic auxiliary pages — the `missing_page_opening` failure from v23 did not recur anywhere in this run. |
| `repairTopicPlanSourceBudgetMechanically` per-proposal gate | **Held, and meaningfully better.** `topic-plan` itself no longer appears in the failures at all (v23 had `topic_plan_exhausted`) — the plan converged and topic pages were generated. Failures moved one layer downstream, to individual topic PAGE generation (see new finding below), which the topic-plan fix was never meant to touch. |
| `repairUpperBoundArtifactMechanically` skip-unrecognized-error | **Partially held.** `flow:cli-src-to-core-src-05`'s final attempt mixed `duplicate_anchor` with 2 `anchor_outside_closed_list` and 2 `missing_closed_key` errors — the mechanical repair correctly still returned null, because `anchor_outside_closed_list` is a genuinely unfixed defect (an invented anchor not in scope), not a false blocker. This is the fix working as designed (fail-closed when a real, unaddressed defect remains), not a failure of the fix itself. |

## New findings (not seen in v21/v22/v23)

1. **Topic PAGE generation has no mechanical repair fallback at all.**
   `attemptTopicGeneration` (batch.ts) validates topic pages under the exact
   same "upper bound" contract as flow pages (`buildTopicRepairPrompt` mirrors
   `buildStage5RepairPrompt` by design), but never called
   `repairUpperBoundArtifactMechanically` — only the flow-page code path did.
   Two topic tasks failed this run:
   - `topic:70bd2de9bbc3`: the model produced a page with essentially zero
     section-marker anchors across all 3 attempts (identical
     `candidateSha256` on attempts 1 and 2) — a genuine, non-mechanical
     content failure the model never recovered from.
   - `topic:fd0daad4007e`: attempt 1 had a real defect
     (`model_invented_manual` plus missing markers); attempt 2's own repair
     dumped 13 duplicate anchors into one section; attempt 3 (the last slot)
     was down to a **single** `duplicate_anchor` — exactly the shape
     `repairUpperBoundArtifactMechanically` fixes for flow pages, but topic
     pages had no equivalent fallback, so the task failed on a defect that
     was otherwise one mechanical dedup away from passing.

   **Fixed in this same pass** (after this run, not yet re-validated):
   wired `repairUpperBoundArtifactMechanically` into `attemptTopicGeneration`,
   mirroring the flow-page call site exactly. TypeScript compiles clean and
   the full core/cli/mcp suite (1049/23/86 tests) stays green — no dedicated
   unit test was added for this specific wiring since `attemptTopicGeneration`
   is internal and `repairUpperBoundArtifactMechanically` itself already has
   11+ direct unit tests; real validation is deferred to the next paid rerun
   (v25).

2. **`anchor_outside_closed_list` is a real, unaddressed gap class.**
   `flow:cli-src-to-core-src-05`'s last attempt had the model citing keys
   like `packages/core/src/output.ts#emit` (note: `core`, not `cli` — likely
   a path confusion with the real `packages/cli/src/output.ts#emit`) that are
   outside the flow's closed list. No mechanical fix exists for this class
   (would require deciding whether to strip the citation or substitute the
   correct key) — noted as a candidate for a future pass, not fixed here.

## Next steps

1. Run v25 against the just-added topic-page mechanical repair wiring to
   confirm it resolves the `fd0daad4007e`-shaped single-duplicate case.
2. `topic:70bd2de9bbc3`'s zero-anchor failure and
   `flow:cli-src-to-core-src-05`'s `anchor_outside_closed_list` are both
   genuine model-content failures with no safe mechanical fix identified yet
   — track separately, do not conflate with the mechanical-repair gaps closed
   this pass.

## Artifacts

- `livewiki/` — full generated corpus (copied from the worktree).
- `metrics/livewiki-config.json`, `metrics/batch-status.json`,
  `metrics/verify.json`, `metrics/init-batch-output.json` — same shape as v23.
- `metrics/token-proxy-livewiki-r10-r11-v24.jsonl` — per-call proxy log.
- `metrics/fixes-under-test.patch` — the exact 3-fix diff applied on top of
  `41d1519` for this run (isolated from unrelated uncommitted WIP).
