# Clean v11 — FAIL

## Identity

- Base commit: efd9b21e0ea902ce4d7f9e4b0ebe89ff65d8e3cc
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

- Product status: aborted
- Final gate: FAIL
- Qualitative gate: FAIL
- Stage-4 tasks: 0 done / 3 failed
- Batch process exit: 0
- Structured batch exit: 2
- Wall clock: 329.5 seconds
- Proxy: 9 calls; 192879 prompt / 31925 completion / 0 reasoning tokens
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

### core-src-02
- attempt 1: complete -> artifact_validation_failed [anchor_outside_closed_list,missing_closed_key]
- attempt 2: complete -> artifact_validation_failed [missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key]
- attempt 3: incomplete -> incomplete_generation [incomplete_generation]
### core-src-03
- attempt 1: complete -> artifact_validation_failed [todo_marker_present]
- attempt 2: incomplete -> incomplete_generation [incomplete_generation]
- attempt 3: complete -> artifact_validation_failed [unclosed_markdown]
### core-src-04
- attempt 1: complete -> artifact_validation_failed [todo_marker_present]
- attempt 2: complete -> artifact_validation_failed [missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key]
- attempt 3: complete -> artifact_validation_failed [missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key,missing_closed_key]

## Artifacts and sanitization

- Generated wiki and structured proxy/batch/verify evidence are preserved here.
- Publish-time sanitization removes the temporary clone path and replaces local
  absolute repository/temp paths with placeholders.
- Authorization/Bearer values are defensively redacted.
- No generated page, metric, or result was manually repaired or rewritten to
  change its outcome.
- All prior benchmark directories through rerun-clean-v10/ were left untouched.

This was the only paid clean v11 batch attempt. No OpenWiki call, BENCHMARK.md
edit, commit, or push was performed.

## Diagnosis (product outcome)

All infrastructure gates passed. The proxy stayed alive for the complete paid
lifecycle, all nine calls returned without proxy errors, stage 2 and reasoning
used zero tokens, and stage-4 accounting reconciled exactly with the proxy
(192879 prompt / 31925 completion tokens).

The batch aborted after the first three stage-4 tasks all exhausted their three
bounded attempts. No module page was accepted, so all 13 planned module pages
are missing. `verify` is clean only for the deterministic/layout partial corpus;
it does not make the incomplete corpus a PASS. The qualitative gate also fails
because there are zero module pages to audit.

The new diagnostics recover the rejection causes that v9 lost:

- `core-src-02`: an outside-list anchor plus missing coverage, followed by 80
  missing-key errors, then provider incompletion (`abort`). Attempt 2 persisted
  50 errors and recorded 30 additional errors beyond the cap; total errors: 83.
- `core-src-03`: TODO/TBD prose rejection, then provider incompletion
  (`abort`), then a fresh initial attempt rejected for unclosed Markdown. This
  confirms incomplete output was not embedded into a repair prompt; total
  errors: 3.
- `core-src-04`: TODO/TBD prose rejection followed by two missing-key repair
  failures. Attempts 2 and 3 each persisted 50 errors and recorded 19 beyond
  the cap; total errors: 139.

This is a genuine product FAIL: `aborted`, zero accepted module pages, and the
full-corpus mechanical and qualitative requirements were not met.

## Sanitization performed

- No credential value or Authorization/Bearer token value is present.
- No absolute user, temporary-worktree, or repository path is present.
- No local credential-file path or loading command is preserved.
- Metrics, generated pages, batch status, and verify output were not rewritten
  to change their outcome.
- All prior benchmark directories through rerun-clean-v10/ remain untouched.
