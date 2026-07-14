# Clean v12 — FAIL

## Identity

- Base commit: 10153f48e7dd372ea5db6dda685ec650405b9793
- Command: livewiki init --batch --no-refine --json
- Model: MiniMax-M3 through the monitored local proxy to api.minimax.io
- Thinking: disabled
- Product timeout: default (omitted from config)
- Install: pnpm install --frozen-lockfile --prefer-offline (exit 0 required)
- Batch process invocations: **1**; paid wire calls: **0**
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

- Product status: not_started
- Final gate: FAIL
- Qualitative gate: FAIL
- Stage-4 tasks: 0 done / 0 failed
- Batch process exit: 1
- Structured batch exit: n/a
- Wall clock: 2 seconds
- Proxy: 0 calls; 0 prompt / 0 completion / 0 reasoning tokens
- Verify exit: 0; issues: 0
- Harness error: livewiki init failed with `UNIQUE constraint failed: symbols.key` before creating a batch run

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

None. No batch run or stage-4 task was created, so no per-attempt diagnostic history exists.

## Artifacts and sanitization

- Generated wiki and structured proxy/batch/verify evidence are preserved here.
- Publish-time sanitization removes the temporary clone path and replaces local
  absolute repository/temp paths with placeholders.
- Authorization/Bearer values are defensively redacted.
- No generated page, metric, or result was manually repaired or rewritten to
  change its outcome.
- All prior benchmark directories through rerun-clean-v11/ were left untouched.

This was the only clean v12 batch process invocation. The monitored proxy
recorded zero wire calls, so zero paid API calls occurred. No OpenWiki call,
BENCHMARK.md edit, commit, or push was performed.

## Diagnosis (bootstrap outcome)

Credential, install, core build, CLI build, proxy readiness, and proxy PID
liveness gates all passed. The single `livewiki init --batch --no-refine
--json` process then exited 1 after 2 seconds with `UNIQUE constraint failed:
symbols.key`. The failure occurred during deterministic initialization before
a batch run was created and before stage 4; `livewiki batch status --json`
therefore returned `no batch runs found` and could not provide
`diagnosticHistory`.

The proxy remained alive and recorded exactly zero calls, zero prompt tokens,
zero completion tokens, zero reasoning tokens, and zero proxy errors. Verify
exited 0 with zero issues only because the corpus contained no module pages;
this does not satisfy full-corpus acceptance. The mechanical, qualitative,
and combined final gates are all FAIL.

## Sanitization performed

- No credential value or Authorization/Bearer token value is present.
- No absolute user, temporary-worktree, or repository path is present.
- No local credential-file path or loading command is preserved.
- Raw batch stderr, batch-status output, proxy metrics, generated layout, and
  verify output were not rewritten to change their outcomes.
- All prior benchmark directories through rerun-clean-v11 remain untouched.
