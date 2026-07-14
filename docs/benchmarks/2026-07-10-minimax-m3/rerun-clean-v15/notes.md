# Clean v15 — FAIL

## Identity

- Base commit: 651ec51a253a73d8631816285a9111ff0bb03812
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
- Qualitative gate: PASS
- Stage-4 tasks: 12 done / 1 failed
- Batch process exit: 0
- Structured batch exit: 1
- Wall clock: 406 seconds
- Proxy: 18 calls; 240379 prompt / 42415 completion / 0 reasoning tokens
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
For v15, the process.exit rule flags only affirmative claims that the CLI calls
process.exit; denials and contrasts such as "rather than", "instead of", and
"never calls" are excluded. Every other v14 qualitative rule is unchanged.

## Per-attempt diagnostics

### core-src-04 (recovered)
- attempt 1: complete -> artifact_validation_failed [missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key]
- attempt 2: complete -> success []
- Recovery: repair attempt 2 succeeded.
### core-src-01 (recovered)
- attempt 1: complete -> artifact_validation_failed [todo_marker_present]
- attempt 2: complete -> success []
- Recovery: repair attempt 2 succeeded.
### tools (failed)
- attempt 1: complete -> artifact_validation_failed [anchor_outside_closed_list]
- attempt 2: incomplete -> incomplete_generation [incomplete_generation]
- attempt 3: complete -> artifact_validation_failed [anchor_outside_closed_list]

## Diagnosis

- Lot G's placement guidance resolved the former `core-src-03` blocker: that
  task completed successfully on its first initial attempt, and its module page
  is present. The run reached 12/13 pages, one more than v14.
- `tools` remained the sole failure. Both fresh initial generations emitted the
  Unicode ellipsis `…` as a section anchor despite the explicit closed-list-only
  prohibition. Attempt 2, a repair of the first candidate, ended provider-
  incomplete; the state machine then correctly cleared repair inputs and used a
  fresh initial prompt for attempt 3, which emitted `…` again.
- Two repair paths succeeded: `core-src-04` added six missing section keys on
  attempt 2, and `core-src-01` removed a body TODO marker on attempt 2. `cli-src`
  also recovered from a provider-incomplete initial response through the
  required fresh initial generation.
- Mechanical acceptance failed because `tools.md` is missing and symbol
  coverage is 411 declared of 423 planned. Verification was clean for every
  page written, with zero issues and no real duplicate anchors.
- The corrected qualitative audit passed all checks across the 12 written
  module pages. Its `commandsContradiction` list is empty: denial/contrast
  wording is no longer misclassified, while the affirmative-claim rule remains
  active. No other qualitative rule changed.
- Batch and proxy accounting reconciled exactly at 240379 prompt and 42415
  completion tokens; reasoning tokens and proxy errors were both zero.

## Artifacts and sanitization

- Generated wiki and structured proxy/batch/verify evidence are preserved here.
- Publish-time sanitization removes the temporary clone path and replaces local
  absolute repository/temp paths with placeholders.
- Authorization/Bearer values are defensively redacted.
- No generated page, metric, or result was manually repaired or rewritten to
  change its outcome.
- All prior benchmark directories through rerun-clean-v14/ were left untouched.

This was the only paid clean v15 batch attempt. No OpenWiki call, BENCHMARK.md
edit, commit, or push was performed.
