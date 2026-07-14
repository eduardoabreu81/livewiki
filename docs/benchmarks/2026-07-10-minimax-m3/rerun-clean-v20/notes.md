# Clean v20 — FAIL

## Identity

- Base commit: 459af1412bf289a65783f54f7fbae4251d03f9e9
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

- Product status: not_started
- Final gate: n/a
- Qualitative gate: n/a
- Stage-4 tasks: 0 done / 0 failed
- Batch process exit: 0
- Structured batch exit: 1
- Orchestrator/final-gate process exit: 1
- Wall clock: 1332 seconds
- Proxy: 0 calls; 0 prompt / 0 completion / 0 reasoning tokens
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
Before audit execution, the copied v15 process.exit rule was verified as a
CLAIM-OF-CONTRADICTION check: it flags a page only when the page asserts that
the CLI calls process.exit. Negated or contrastive mentions such as "rather
than", "instead of", "never calls", and "avoids" are not flagged. The audit
copy is not a raw substring check. Every other v15 qualitative rule is unchanged.

## Per-attempt diagnostics

### core-src-04 (recovered)
- attempt 1: promptKind=initial; length -> truncated_by_token_limit [truncated_by_token_limit]
- attempt 2: promptKind=initial; complete -> artifact_validation_failed [missing_page_opening,missing_closed_key]
- attempt 3: promptKind=repair; complete -> success []
- Recovery: repair attempt 3 succeeded.
### core-src-03 (failed)
- attempt 1: promptKind=initial; complete -> artifact_validation_failed [missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,unclosed_markdown]
- attempt 2: promptKind=repair; complete -> artifact_validation_failed [missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,unclosed_markdown]
- attempt 3: promptKind=repair; complete -> artifact_validation_failed [missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,unclosed_markdown]
### rerun-clean-v18 (recovered)
- attempt 1: promptKind=initial; complete -> artifact_validation_failed [model_invented_manual]
- attempt 2: promptKind=repair; complete -> success []
- Recovery: repair attempt 2 succeeded.
### rerun-clean-v11 (failed)
- attempt 1: promptKind=initial; complete -> artifact_validation_failed [todo_marker_present,model_invented_manual]
- attempt 2: promptKind=repair; incomplete -> incomplete_generation [incomplete_generation] budgetConsumed: false
- attempt 3: promptKind=initial; complete -> artifact_validation_failed [anchor_outside_closed_list,missing_closed_key,unclosed_markdown,todo_marker_present,model_invented_manual]
- attempt 4: promptKind=repair; incomplete -> incomplete_generation [incomplete_generation] budgetConsumed: false
- attempt 5: promptKind=initial; complete -> artifact_validation_failed [todo_marker_present,model_invented_manual]
### rerun-clean-v12 (failed)
- attempt 1: promptKind=initial; complete -> artifact_validation_failed [todo_marker_present,model_invented_manual]
- attempt 2: promptKind=repair; complete -> artifact_validation_failed [todo_marker_present]
- attempt 3: promptKind=repair; incomplete -> incomplete_generation [incomplete_generation] budgetConsumed: false
- attempt 4: promptKind=initial; complete -> artifact_validation_failed [anchor_outside_closed_list,missing_closed_key]
### rerun-clean-v13 (recovered)
- attempt 1: promptKind=initial; complete -> artifact_validation_failed [model_invented_manual]
- attempt 2: promptKind=repair; incomplete -> incomplete_generation [incomplete_generation] budgetConsumed: false
- attempt 3: promptKind=initial; complete -> artifact_validation_failed [todo_marker_present,model_invented_manual]
- attempt 4: promptKind=repair; complete -> success []
- Recovery: repair attempt 4 succeeded.
- Recovery: non-consuming incomplete retry attempt(s) 2 preceded success on attempt 4.
### rerun-clean-v14 (failed)
- attempt 1: promptKind=initial; complete -> artifact_validation_failed [todo_marker_present,model_invented_manual]
- attempt 2: promptKind=repair; complete -> artifact_validation_failed [model_invented_manual]
- attempt 3: promptKind=repair; complete -> artifact_validation_failed [unclosed_markdown]
### rerun-clean-v15 (failed)
- attempt 1: promptKind=initial; complete -> artifact_validation_failed [missing_closed_key,unclosed_markdown,todo_marker_present,model_invented_manual]
- attempt 2: promptKind=repair; complete -> artifact_validation_failed [missing_closed_key,unclosed_markdown,todo_marker_present,model_invented_manual]
- attempt 3: promptKind=repair; complete -> artifact_validation_failed [missing_closed_key,unclosed_markdown,todo_marker_present]
### rerun-clean-v16 (recovered)
- attempt 1: promptKind=initial; complete -> artifact_validation_failed [model_invented_manual]
- attempt 2: promptKind=repair; incomplete -> incomplete_generation [incomplete_generation] budgetConsumed: false
- attempt 3: promptKind=initial; complete -> artifact_validation_failed [model_invented_manual]
- attempt 4: promptKind=repair; complete -> success []
- Recovery: repair attempt 4 succeeded.
- Recovery: non-consuming incomplete retry attempt(s) 2 preceded success on attempt 4.
### rerun-clean-v17 (failed)
- attempt 1: promptKind=initial; complete -> artifact_validation_failed [anchor_outside_closed_list,missing_closed_key,unclosed_markdown,todo_marker_present,model_invented_manual]
- attempt 2: promptKind=repair; complete -> artifact_validation_failed [missing_closed_key,unclosed_markdown,todo_marker_present]
- attempt 3: promptKind=repair; complete -> artifact_validation_failed [missing_closed_key,unclosed_markdown]
### rerun-clean-v8 (recovered)
- attempt 1: promptKind=initial; complete -> artifact_validation_failed [model_invented_manual]
- attempt 2: promptKind=repair; complete -> artifact_validation_failed [model_invented_manual]
- attempt 3: promptKind=repair; complete -> success []
- Recovery: repair attempt 3 succeeded.
### rerun-clean-v9 (failed)
- attempt 1: promptKind=initial; complete -> artifact_validation_failed [model_invented_manual]
- attempt 2: promptKind=repair; incomplete -> incomplete_generation [incomplete_generation] budgetConsumed: false
- attempt 3: promptKind=initial; complete -> artifact_validation_failed [model_invented_manual]
- attempt 4: promptKind=repair; complete -> artifact_validation_failed [model_invented_manual]

## Artifacts and sanitization

- Generated wiki and structured proxy/batch/verify evidence are preserved here.
- Publish-time sanitization removes the temporary clone path and replaces local
  absolute repository/temp paths with placeholders.
- Authorization/Bearer values are defensively redacted.
- No generated page, metric, or result was manually repaired or rewritten to
  change its outcome.
- All prior benchmark directories through rerun-clean-v19/ were left untouched.

This was the only paid clean v20 batch attempt. No OpenWiki call, BENCHMARK.md
edit, commit, or push was performed.