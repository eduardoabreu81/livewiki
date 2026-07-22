# rerun-clean-v23 — validation of the v22 follow-up fixes (41d1519)

**Date:** 2026-07-21
**Commit under test:** `41d1519` (mechanical repair for flow anchor drift and
topic-plan budget — the two "new findings" from v22)
**Purpose:** validate that the two fixes made after v22
(`repairUpperBoundArtifactMechanically` for `duplicate_anchor`/
`missing_closed_key`, `repairTopicPlanSourceBudgetMechanically` for
`topic_plan_source_budget`) hold against a real paid MiniMax-M3 call.

## Setup

- Target: throwaway `git worktree` of this repo at `41d1519`, pre-existing
  committed `livewiki/` output deleted before the run (RERUN.md hygiene rule).
- Proxy: local OAuth bridge (`mmx-cli` subprocess per call, not the raw-key
  `tools/token-proxy.mjs`), port 4558, forwarding to MiniMax-M3 through the
  authenticated `mmx` CLI session — same mechanism validated in the prior
  `acceptance-3` exploration, chosen because no raw API key was available
  in this session.
- Config: `{"provider":"openai-compat","model":"MiniMax-M3","language":"en","baseUrl":"http://127.0.0.1:4558/v1"}`.
- Command: `livewiki init --batch --json`.

## Result

- **Run status:** `completed_with_failures`, `batchExitCode: 1` (CLI process
  exit 0 because `--json` mode always exits 0 by design).
- **Tasks:** 40 done / 3 failed (43 total) — one more failed task than v22's
  2, all three on different targets.
- **Tokens:** 926,905 total (781,958 input + 144,947 output), 42 HTTP calls
  through the proxy (all `ok: true`, 0 transport errors).
- **Verify:** `ok: true`, 0 issues across the 40 written pages.
- **Pages written:** 44 files under `livewiki/`.

## Targeted-fix verification (the two things this rerun exists to check)

| Fix (41d1519) | Result |
|---|---|
| `repairUpperBoundArtifactMechanically` (duplicate_anchor / missing_closed_key on flow pages) | **Did not fully hold.** `flow:cli-src-to-core-src-06` hit the same `duplicate_anchor` class again. Root cause differs from what 41d1519 fixed: attempt 1 mixed 20 `duplicate_anchor` errors together with one `missing_page_opening` error — the mechanical repair function bails (`return null`) the instant ANY error in the batch is a code it doesn't recognize, so a real mechanical fix never even gets attempted while a co-occurring unrelated error is present. Attempt 3 ends with 3 pure `duplicate_anchor` errors (no other codes mixed in) that still fail mechanical repair, most likely because `repairUpperBoundArtifactMechanically` additionally requires each offending anchor to be present in the flow's closed key list (`closedSet.has(error.offending)`), and these three probably are not. |
| `repairTopicPlanSourceBudgetMechanically` (topic_plan_source_budget) | **Did not hold — as documented, working as designed but too narrow.** The commit message says it "only activates when every reported error is `topic_plan_source_budget`." In this run every attempt mixes `topic_plan_source_budget` with `topic_plan_text_budget`, `topic_plan_anchor_budget`, and (attempt 1) `topic_plan_unscoped_anchor` from other candidate topics in the same response, so the purity gate never opens and the exhausted failure repeats identically to before. |

## New finding (not seen in v21/v22)

- **`mcp-scripts`** (stage 4, product module): `missing_page_opening` —
  "How it fits" section must contain prose paragraphs but the model kept
  emitting headings/bullets/`lw:` markers instead, byte-identical across
  all 3 attempts (same `candidateSha256` for attempts 2 and 3 as attempt 1's
  content). The repair prompt is not giving the model anything new to act
  on for this case, and there is no mechanical fallback for
  `missing_page_opening`.

## Comparison to v22's "held" fixes (still holding)

- `auxiliary_page_not_compact`: absent again.
- `flow_diagram_too_large` (node/edge truncation): absent again — no flow
  in this run needed it, but nothing regressed either.
- Cross-stage circuit breaker isolation: topic-plan's failure did not affect
  the 39 successful module/flow tasks.

## Next steps

1. `repairUpperBoundArtifactMechanically`: stop bailing on the whole error
   set when a non-mechanical error is mixed in — apply the mechanical fixes
   it *can* make for the codes it recognizes, and only fall through to the
   LLM for the remainder. Separately, check whether the closed-set
   membership check is too strict for `flow:cli-src-to-core-src-06`'s three
   final-attempt anchors.
2. `repairTopicPlanSourceBudgetMechanically`: relax the "every error is
   `topic_plan_source_budget`" purity gate so it also handles the mixed
   case seen here (text/anchor budget violations on other candidates
   alongside a source-budget violation), or add sibling mechanical repairs
   for `topic_plan_text_budget`/`topic_plan_anchor_budget`.
3. `missing_page_opening` on `mcp-scripts`: inspect the actual candidate
   body (`livewiki/mcp-scripts.md` is not written since the task failed —
   pull it from the `diagnosticHistory` candidate) to see why the repair
   prompt isn't landing, and whether a mechanical fallback is feasible here
   too (e.g. detecting a heading/bullet-only "How it fits" section and
   inserting a minimal prose stub is likely unsafe without model input, so
   this one probably needs a prompt fix rather than a mechanical one).

## Artifacts

- `livewiki/` — full generated corpus (copied from the worktree).
- `metrics/livewiki-config.json` — the exact config used.
- `metrics/batch-status.json` — full `batch status --json` report.
- `metrics/verify.json` — full `verify --json` report.
- `metrics/init-batch-output.json` — raw `init --batch --json` stdout.
- `metrics/token-proxy-livewiki-r10-r11-v23.jsonl` — per-call proxy log
  (mmx-cli bridge; no raw provider `usage` object beyond prompt/completion
  tokens, unlike the `token-proxy.mjs` format used in v22).
