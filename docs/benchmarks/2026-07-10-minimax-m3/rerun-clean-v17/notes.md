# Clean v17 — FAIL

## Identity

- Base commit: 3bd7572275728f4639a744d303566f36296c9310
- Command: livewiki init --batch --no-refine --json
- Model: MiniMax-M3 through the monitored local proxy to api.minimax.io
- Thinking: disabled
- Product timeout: default (omitted from config)
- maxRepairAttempts: default (2; omitted from config)
- maxIncompleteRetries: default (2; omitted from config)
- Install: pnpm install --frozen-lockfile --prefer-offline (exit 0 required)
- Paid batch attempts: **1**
- No preflight chat completion, external second batch attempt, --only, resume,
  or replay was used. Internal bounded stage-4 retries remained at product defaults.

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
- Stage-4 tasks: 12 done / 1 failed
- Batch process exit: 0
- Structured batch exit: 1
- Orchestrator/final-gate process exit: 1
- Wall clock: 472.3 seconds
- Proxy: 18 calls; 249097 prompt / 45074 completion / 0 reasoning tokens
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
For v17, the process.exit rule flags only affirmative claims that the CLI calls
process.exit; denials and contrasts such as "rather than", "instead of", and
"never calls" are excluded. Every v15 qualitative rule is unchanged.

## Per-attempt diagnostics

### core-src-01 (recovered)
- attempt 1: promptKind=initial; complete -> artifact_validation_failed [todo_marker_present]
- attempt 2: promptKind=repair; incomplete -> incomplete_generation [incomplete_generation] budgetConsumed: false
- attempt 3: promptKind=initial; complete -> artifact_validation_failed [anchor_outside_closed_list,duplicate_anchor,anchor_outside_closed_list,duplicate_anchor,anchor_outside_closed_list,missing_closed_key,missing_closed_key,todo_marker_present,model_invented_manual]
- attempt 4: promptKind=repair; complete -> success []
- Recovery: repair attempt 4 succeeded.
- Recovery: non-consuming incomplete retry attempt(s) 2 preceded success on attempt 4.
### tools (failed)
- attempt 1: promptKind=initial; complete -> artifact_validation_failed [anchor_outside_closed_list]
- attempt 2: promptKind=repair; complete -> artifact_validation_failed [anchor_outside_closed_list]
- attempt 3: promptKind=repair; complete -> artifact_validation_failed [anchor_outside_closed_list]

## Diagnosis

- `tools` failed after three completed provider responses. The initial attempt
  and both repair attempts each retained one out-of-list section anchor: `...`
  on attempts 1-2 and `…` on attempt 3. No provider-incomplete outcome occurred
  for this task, so the new incomplete-retry budget was not exercised there.
- `core-src-01` recovered in four calls. Its repair attempt 2 ended with provider
  `abort`, normalized to `incomplete`, and correctly recorded
  `budgetConsumed: false`. The following attempt was a fresh initial generation;
  after that candidate failed validation, repair attempt 4 succeeded.
- Mechanical acceptance failed because `tools.md` is missing. The written corpus
  declares 411 of 423 planned symbols, so the corpus is incomplete even though
  verify reports zero issues across the 14 pages it checked.
- Batch and proxy accounting reconciled exactly at 249097 prompt and 45074
  completion tokens across 18 calls. Reasoning tokens, proxy errors, and proxy
  deaths were all zero.
- The unchanged qualitative audit listed two explanatory `commands.md` lines as
  `commandsContradiction`; both describe `process.exitCode` and mention
  `process.exit(1)` only as abrupt behavior avoided or explicitly negated. The
  stored qualitative gate is therefore FAIL and was not edited or rerun.

## Artifacts and sanitization

- Generated wiki and structured proxy/batch/verify evidence are preserved here.
- Publish-time sanitization removes the temporary clone path and replaces local
  absolute repository/temp paths with placeholders.
- Authorization/Bearer values are defensively redacted.
- No generated page, metric, or result was manually repaired or rewritten to
  change its outcome.
- All prior benchmark directories through rerun-clean-v16/ were left untouched.

This was the only paid clean v17 batch attempt. No OpenWiki call, BENCHMARK.md
edit, commit, or push was performed.
