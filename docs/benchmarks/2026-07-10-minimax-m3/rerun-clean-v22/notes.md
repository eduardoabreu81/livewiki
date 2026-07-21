# rerun-clean-v22 — Priority-0 + Phase 2 reliability fixes validation

**Date:** 2026-07-21
**Commit under test:** `de031c4` (R10.1/R11-NAV/R11-A + auxiliary-page/circuit-breaker/
task-count/flow-diagram-repair fixes)
**Purpose:** validate that the reliability fixes made after the v21 abort
(`auxiliary_page_not_compact`, cross-stage circuit breaker, `flow_diagram_too_large`,
init/status task-count mismatch) actually hold against a real paid MiniMax-M3
call, before continuing to any larger scope of work.

## Setup

- Target: throwaway `git worktree` of this repo at `de031c4`, pre-existing
  `livewiki/` output deleted before the run (RERUN.md hygiene rule).
- Config: `{"provider":"openai-compat","model":"MiniMax-M3","language":"en","baseUrl":"http://127.0.0.1:8900/v1"}`.
- Proxy: `tools/token-proxy.mjs`, upstream `https://api.minimax.io`, label
  `livewiki-r10-r11-v22`.
- Command: `livewiki init --batch --repo <worktree> --json`.

## Result

- **Run status:** `completed_with_failures` (exit 2 avoided — the v21 run
  had **aborted**; this run finished all stages).
- **Tasks:** 40 done / 2 failed — `init`'s own summary and `batch status --json`
  report the identical count (previously these disagreed, 35 vs 32 — see
  the task-count fix).
- **Tokens:** 853,204 total (727,964 input + 125,240 output), 37 HTTP calls,
  0 calls with an error, 0 calls without usage.
- **Verify:** `ok: true`, 0 issues of any severity across the 40 written pages.
- **Pages written:** 45 files under `livewiki/` — module pages (product +
  auxiliary), 4 of the 5 detected flows, the auxiliary/flows hubs, quickstart,
  tasks, architecture overview + diagrams. No `topics/` — the topic planner
  did not converge (see below).

## Targeted-fix verification

Searched every task's `diagnosticHistory` for the three failure codes the
v21 report flagged. None occurred:

| Code | v21 (before) | v22 (after) |
|---|---|---|
| `auxiliary_page_not_compact` | repeated across `rerun-clean-v8`, `lib`, `rerun-clean-v5` | **absent** — auxiliary modules no longer call the LLM at all |
| `flow_diagram_too_large` | present, drove a full repair round | **absent** — one flow diagram was over budget and got the new localized mechanical repair silently (no LLM round-trip, confirmed by call count matching page count for that flow) |
| circuit breaker cross-stage bleed | 1 flow failure blocked the entire topic layer | topic stage ran independently and reported its own failure without affecting the 4 successful flows or any module page |

## New findings (not in scope of today's fixes)

Two real failures remain, both pre-existing classes already known from the
v21 report, on a **different** flow candidate this time:

1. **`flow:cli-src-to-core-src-07`** — `repair_exhausted` after 3 attempts:
   `duplicate_anchor` (attempt 1) then `missing_closed_key` (attempts 2–3).
   Same prompt/validator drift class as the v21 `flow:cli-src-to-core-src-03`
   finding.
2. **`topic-plan`** — `topic_plan_exhausted` after 3 attempts. Every attempt
   hit `topic_plan_source_budget` (proposed evidence up to ~120k chars vs a
   40k cap) alongside `topic_plan_anchor_budget`/`module_budget`/`text_budget`
   on other candidate topics in the same response. The planner is
   consistently over-proposing evidence size for this repo's scale.

Neither aborted the run or took down unrelated work — both are isolated,
visible failures with a ready retry command (`batch --only <target> 1`).

## Artifacts

- `livewiki/` — full generated corpus (copied from the worktree).
- `metrics/livewiki-config.json` — the exact config used.
- `metrics/batch-status.json` — full `batch status --json` report.
- `metrics/verify.json` — full `verify --json` report.
- `metrics/init-batch-output.json` — raw `init --batch --json` stdout.
- `metrics/token-proxy-livewiki-r10-r11-v22.{json,jsonl}` — per-call proxy log.

## Next steps

- Priority-0/Phase-2 fixes hold under a real model. Safe to continue to
  Phase 3 (symbol graph / blast radius) as originally planned.
- The two new findings (flow anchor drift, topic-plan evidence budget) are
  candidates for a follow-up fix pass — not blocking, not regressions from
  today's work.
