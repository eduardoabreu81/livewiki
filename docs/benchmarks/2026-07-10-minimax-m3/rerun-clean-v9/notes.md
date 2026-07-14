# Clean v9 — FAIL

## Identity

- Base commit: 74dba0963301b853db34a3fef60cb50ba35cebaa
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
- Qualitative gate: PASS
- Stage-4 tasks: 1 done / 2 failed
- Batch process exit: 0
- Structured batch exit: 2
- Wall clock: 128.7 seconds
- Proxy: 7 calls; 152872 prompt / 18403 completion / 0 reasoning tokens
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

## Artifacts and sanitization

- Generated wiki and structured proxy/batch/verify evidence are preserved here.
- Publish-time sanitization removes the temporary clone path and replaces local
  absolute repository/temp paths with placeholders.
- Authorization/Bearer values are defensively redacted.
- No generated page, metric, or result was manually repaired or rewritten to
  change its outcome.
- rerun-clean-v8/ was left byte-for-byte untouched (prior infrastructure FAIL).

This was the only paid clean v9 batch attempt. No OpenWiki call, BENCHMARK.md
edit, commit, or push was performed.

## Diagnosis (product outcome)

Install gate fixed by base commit `74dba09` (`pnpm install --frozen-lockfile
--prefer-offline` → exit 0). Proxy stayed alive; stage 2 tokens 0; reasoning
tokens 0; batch/proxy accounting exact (152872 / 18403).

Batch **aborted** after circuit-breaker: stage-4 order produced **1 done**
(`core-src-02`) then **2 consecutive failures** (`core-src-03`, `core-src-04`)
with `repair_exhausted` / `[incomplete_generation]` (provider reason: `abort`).
With ≥3 stage-4 attempts and >50% failed, the run aborted before the remaining
10 modules. Only `livewiki/core-src-02.md` exists among module pages.

`process.exitCode` from init process was **0** because `--json` always exits 0
(CLI convention); structured `batchExitCode` is **2** (`aborted`).

## Qualitative sampling (partial corpus)

| Sample target | Result |
|---|---|
| `commands.md` | **missing** (module not executed) |
| `tools.md` | **missing** (module not executed) |
| core-src with `prompts.ts` / `verify.ts` | planned as **core-src-04** — **page missing** (failed task) |
| `quickstart.md` | present; **Important symbols** (not Key concepts); product symbols only |
| `architecture/overview.md` | present; product / fixtures / tooling groups; mmd links resolve to existing files |
| `core-src-02.md` (only module page) | closed markdown; behavioral prose; no TODO/TBD/sentinel; 69 anchors covered |
| Automated qualitative gate | **PASS** on the partial corpus (1 module page) — **does not override** mechanical FAIL |

Genuine product FAIL: incomplete wiki (`aborted`, 12/13 module pages missing).

## Sanitization performed

- No secret values in tree.
- No Authorization/Bearer token values.
- No `C:\Users\…`, no raw `AppData\Local\Temp`, no secrets-file path, no
  absolute clone path (placeholders used where applicable).
- Harness does not source `bench-secrets`.
- Metrics/wiki/status **not** rewritten to flip FAIL → PASS.
- `rerun-clean-v8/` left byte-for-byte unchanged.