# Clean v21 — FAIL

## Identity

- Base commit: 3325344f3c17c3bc703cda80a42f917607221a1b
- Command: livewiki init --batch --no-refine --json
- Model: MiniMax-M3 through the monitored local proxy to api.minimax.io
- Thinking: disabled
- Product timeout: default (omitted from config)
- maxRepairAttempts: default (2; omitted from config)
- maxIncompleteRetries: default (2; omitted from config)
- Install: pnpm install --frozen-lockfile --prefer-offline (exit 0 required)
- Paid batch attempts: **0**
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
- Batch process exit: n/a
- Structured batch exit: n/a
- Orchestrator/final-gate process exit: 1
- Wall clock: n/a seconds
- Proxy: 0 calls; 0 prompt / 0 completion / 0 reasoning tokens
- Verify exit: n/a; issues: n/a
- Harness error: repository HEAD mismatch: expected 3325344f3c17c3bc703cda80a42f917607221a1b, got 7cf0e021367e9edb2685cdfb7c80db8d1e7fb561

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

None. No failed or repair-recovered stage-4 task was reported.

## Artifacts and sanitization

- Generated wiki and structured proxy/batch/verify evidence are preserved here.
- Publish-time sanitization removes the temporary clone path and replaces local
  absolute repository/temp paths with placeholders.
- Authorization/Bearer values are defensively redacted.
- No generated page, metric, or result was manually repaired or rewritten to
  change its outcome.
- All prior benchmark directories through rerun-clean-v20/ were left untouched.

This was the only paid clean v21 batch attempt. No OpenWiki call, BENCHMARK.md
edit, commit, or push was performed.