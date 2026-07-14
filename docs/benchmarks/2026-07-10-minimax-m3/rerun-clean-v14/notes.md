# Clean v14 — FAIL

## Identity

- Base commit: 0f6436e0052860a5c10ae7a493fc0b1580f67906
- Command: livewiki init --batch --no-refine --json
- Model: MiniMax-M3 through the monitored local proxy to api.minimax.io
- Thinking: disabled
- Product timeout: default (omitted from config)
- Install: pnpm install --frozen-lockfile --prefer-offline (exit 0 required)
- Paid batch attempts: **1**
- No preflight chat completion, --only, resume, replay, or retry was used.

## Harness

- Proxy and batch shared one foreground orchestration lifecycle.
- Proxy port readiness and PID liveness were checked before the batch.
- Proxy died mid-batch: false
- Controlled proxy shutdown was attempted in finally.
- MINIMAX_API_KEY was read only from the caller environment and was never printed or stored.
- Preserved harness does not source any local secrets file.

## Early gate

- Stage 2 was disabled by --no-refine.
- The first paid wire request, if any, belonged to stage 4; no paid preflight was issued.

## Terminal metrics

- Product status: completed_with_failures
- Final gate: FAIL
- Qualitative gate: FAIL
- Stage-4 tasks: 11 done / 2 failed
- Batch process exit: 0
- Structured batch exit: 1
- Wall clock: 514.3 seconds
- Proxy: 23 calls; 323874 prompt / 57029 completion / 0 reasoning tokens
- Verify exit: 0; issues: 0
- Harness error: none

## Dynamic acceptance

metrics/acceptance-analysis.json contains the versioned mechanical analysis.
metrics/final-gate.json additionally requires stage 2 and reasoning zero,
exact batch/proxy accounting, proxy liveness, and the qualitative gate.

## Qualitative audit

metrics/qualitative-audit.json checks the clean v7 regressions without
editing output: independent frontmatter/section coverage, non-empty sections,
closed Markdown, no visible neutralization sentinel, no TODO/TBD prose, no
missing .mmd target, Important symbols heading (not Key concepts), no
benchmark helper under Important symbols, no duplicate deterministic Mermaid
declaration, and no commands page claim that contradicts the uniform
process.exitCode implementation.

## Per-attempt diagnostics

### core-src-03 (failed)
- attempt 1: complete -> artifact_validation_failed [anchor_outside_closed_list,duplicate_anchor,duplicate_anchor,duplicate_anchor,duplicate_anchor,duplicate_anchor,duplicate_anchor,duplicate_anchor,duplicate_anchor,duplicate_anchor,duplicate_anchor,duplicate_anchor,duplicate_anchor,duplicate_anchor,duplicate_anchor,duplicate_anchor,duplicate_anchor,missing_closed_key]
- attempt 2: complete -> artifact_validation_failed [duplicate_anchor,duplicate_anchor,duplicate_anchor,duplicate_anchor,duplicate_anchor,duplicate_anchor,duplicate_anchor,duplicate_anchor,duplicate_anchor,duplicate_anchor,duplicate_anchor,duplicate_anchor,duplicate_anchor,duplicate_anchor,duplicate_anchor]
- attempt 3: complete -> artifact_validation_failed [duplicate_anchor,duplicate_anchor,duplicate_anchor,duplicate_anchor,duplicate_anchor,duplicate_anchor,duplicate_anchor,duplicate_anchor,duplicate_anchor,duplicate_anchor,duplicate_anchor,duplicate_anchor]
### core-src-05 (recovered)
- attempt 1: complete -> artifact_validation_failed [unclosed_markdown]
- attempt 2: complete -> success []
- Recovery: repair attempt 2 succeeded.
### cli-src (recovered)
- attempt 1: complete -> artifact_validation_failed [unclosed_markdown]
- attempt 2: complete -> success []
- Recovery: repair attempt 2 succeeded.
### tools (failed)
- attempt 1: complete -> artifact_validation_failed [anchor_outside_closed_list]
- attempt 2: incomplete -> incomplete_generation [incomplete_generation]
- attempt 3: complete -> artifact_validation_failed [anchor_outside_closed_list]
### sample-ts-repo-src (recovered)
- attempt 1: complete -> artifact_validation_failed [duplicate_anchor,duplicate_anchor,duplicate_anchor,duplicate_anchor,duplicate_anchor,empty_section]
- attempt 2: complete -> success []
- Recovery: repair attempt 2 succeeded.

## Diagnosis

- The duplicate-anchor guidance improved wire behavior but did not make the
  corpus complete. `sample-ts-repo-src` repaired five duplicate anchors and an
  empty section successfully on attempt 2. `core-src-03` reduced its duplicate
  anchors from 16 to 15 to 12 across the ordered attempts but still exhausted
  attempt 3, so its page was not written.
- `tools` remained provider-adversarial: attempt 1 emitted the literal `...` as
  an out-of-list section anchor; its repair ended incomplete; the required
  fresh attempt then emitted the Unicode ellipsis `…` as another out-of-list
  anchor. Its page was not written.
- The other two recovered tasks (`core-src-05` and `cli-src`) each repaired one
  `unclosed_markdown` error on attempt 2. In total, three tasks recovered through
  the repair path in this run.
- Mechanical acceptance failed because the run ended
  `completed_with_failures` with 11/13 pages and incomplete symbol coverage.
  Verification was nevertheless clean for the pages that were written.
- The inherited qualitative audit emitted FAIL on one sentence in
  `commands.md`. The sentence says errors use `process.exitCode = 1` "rather
  than calling `process.exit(1)`"; the audit's substring rule still classified
  it as a contradiction. The metric was preserved as emitted and was not
  rewritten post hoc. All other qualitative checks passed.
- Batch and proxy accounting reconciled exactly at 323874 prompt and 57029
  completion tokens; reasoning tokens and proxy errors were both zero.

## Artifacts and sanitization

- Generated wiki and structured proxy/batch/verify evidence are preserved here.
- Publish-time sanitization removes the temporary clone path and replaces local
  absolute repository/temp paths with placeholders.
- Authorization/Bearer values are defensively redacted.
- No generated page, metric, or result was manually repaired or rewritten to
  change its outcome.
- All prior benchmark directories through rerun-clean-v13/ were left untouched.

This was the only paid clean v14 batch attempt. No OpenWiki call, BENCHMARK.md
edit, commit, or push was performed.
