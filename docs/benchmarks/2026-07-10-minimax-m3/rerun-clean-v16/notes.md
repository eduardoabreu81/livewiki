# Clean v16 — FAIL

## Identity

- Base commit: c4cfb212d49f060322ebd1987e6e18b3d83f3e39
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
- Stage-4 tasks: 11 done / 2 failed
- Batch process exit: 0
- Structured batch exit: 1
- Wall clock: 361.7 seconds
- Proxy: 19 calls; 265647 prompt / 35087 completion / 0 reasoning tokens
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
For v16, the process.exit rule flags only affirmative claims that the CLI calls
process.exit; denials and contrasts such as "rather than", "instead of", and
"never calls" are excluded. Every v15 qualitative rule is unchanged.

## Per-attempt diagnostics

### core-src-03 (failed)
- attempt 1: complete -> artifact_validation_failed [unclosed_markdown]
- attempt 2: complete -> artifact_validation_failed [unclosed_markdown]
- attempt 3: incomplete -> incomplete_generation [incomplete_generation]
### core-src-01 (failed)
- attempt 1: incomplete -> incomplete_generation [incomplete_generation]
- attempt 2: incomplete -> incomplete_generation [incomplete_generation]
- attempt 3: incomplete -> incomplete_generation [incomplete_generation]

## Diagnosis

- The Lot H target, `tools`, no longer blocked the corpus. Its first initial
  attempt still abbreviated a marker with `...`; the abbreviation-specific
  repair attempt ended provider-incomplete, and the required fresh initial
  attempt then succeeded. No repair attempt succeeded in this run.
- `core-src-03` failed on `unclosed_markdown` after both its completed initial
  attempt and completed repair attempt. Its final repair attempt ended
  provider-incomplete, leaving the page unwritten.
- `core-src-01` received three provider-incomplete fresh initial generations.
  All three candidates had the same 1,447-character size and SHA-256, and the
  state machine correctly kept repair inputs cleared after each incompletion.
- Mechanical acceptance failed because `core-src-01.md` and `core-src-03.md`
  are missing and coverage is 288 declared anchors of 423 planned symbols.
  Verification remained clean for the written corpus, with zero issues and no
  real duplicate anchors.
- Batch and proxy accounting reconciled exactly at 265647 prompt and 35087
  completion tokens. Reasoning tokens, proxy errors, and proxy deaths were
  all zero; the qualitative audit passed all unchanged v15 checks across the
  11 written module pages.

## Artifacts and sanitization

- Generated wiki and structured proxy/batch/verify evidence are preserved here.
- Publish-time sanitization removes the temporary clone path and replaces local
  absolute repository/temp paths with placeholders.
- Authorization/Bearer values are defensively redacted.
- No generated page, metric, or result was manually repaired or rewritten to
  change its outcome.
- All prior benchmark directories through rerun-clean-v15/ were left untouched.

This was the only paid clean v16 batch attempt. No OpenWiki call, BENCHMARK.md
edit, commit, or push was performed.
