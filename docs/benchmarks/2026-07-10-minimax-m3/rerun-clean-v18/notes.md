# Clean v18 — PASS

## Identity

- Base commit: 572b8a3d0fa6f075f2bd51e84a10d543764f372b
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

## Setup gates

- Credential present: PASS (boolean check only; value never printed or persisted).
- pnpm install --frozen-lockfile --prefer-offline: exit 0.
- pnpm --filter @livewiki/core build: exit 0.
- pnpm --filter @livewiki/cli build: exit 0.
- Proxy port readiness and PID liveness before batch: PASS.

## Terminal metrics

- Product status: completed
- Corrected final gate: PASS
- Corrected mechanical gate: PASS
- Corrected qualitative gate: PASS
- Initial harness evaluator gate: FAIL (preserved noncompliant false positives;
  see the audit correction record below)
- Stage-4 tasks: 13 done / 0 failed
- Batch process exit: 0
- Structured batch exit: 0
- Orchestrator process exit: 1 (caused only by the preserved initial local
  evaluator result after the paid batch had already completed successfully)
- Corrected local final-gate process exit: 0
- Wall clock: 538.5 seconds
- Proxy: 16 calls; 217785 prompt / 35228 completion / 0 reasoning tokens
- Verify exit: 0; issues: 0
- Harness error: none

## Dynamic acceptance

The initial v17-style evaluator outputs are preserved as
metrics/acceptance-analysis-initial-raw-marker.json,
metrics/qualitative-audit-initial-noncompliant.json, and
metrics/final-gate-initial-noncompliant.json. They failed only because the
evaluator parsed an inline-code marker example as structural and treated
"process.exit(1) is avoided" / "avoiding process.exit(1)" as affirmative
claims. No generated page, batch status, proxy record, or verify result was
changed.

The authoritative v18 analyses are metrics/acceptance-analysis-corrected.json,
metrics/qualitative-audit-corrected.json, and
metrics/final-gate-corrected.json. Marker scans use the commit-under-test's
length-preserving fenced/inline-code semantic; all coverage and duplicate
requirements outside Markdown code are unchanged. The final gate additionally
requires stage 2 and reasoning zero, exact batch/proxy accounting, proxy
liveness, complete diagnostics, and the qualitative gate.

## Qualitative audit

metrics/qualitative-audit-corrected.json checks the clean v7 regressions without
editing output: independent frontmatter/section coverage, non-empty sections,
closed Markdown, no visible neutralization sentinel, no TODO/TBD prose, no
missing .mmd target, Important symbols heading (not Key concepts), no
benchmark helper under Important symbols, no duplicate deterministic Mermaid
declaration, and no commands page claim that contradicts the uniform
process.exitCode implementation.
The copied v15 audit initially passed an insufficient source-shape precheck,
then exposed that its raw `process.exit(1)` alternative still flagged the
forbidden negated forms. That initial result is preserved and is not the
authoritative audit. Before running the corrected audit, the rule was fixed and
verified in metrics/audit-rule-verification.json as a
CLAIM-OF-CONTRADICTION check: it flags a page only when the page asserts that
the CLI calls, uses, invokes, or exits via process.exit. Negated or contrastive
mentions such as "rather than", "instead of", "never calls", "is avoided",
"avoiding", and "avoids" are not flagged, and no raw substring alternative
remains. Every other v15 qualitative requirement is unchanged; marker parsing
was aligned only to the frozen fence/inline-code semantic under test.

## Per-attempt diagnostics

### core-src-01 (recovered)
- attempt 1: promptKind=initial; incomplete -> incomplete_generation [incomplete_generation] budgetConsumed: false
- attempt 2: promptKind=initial; incomplete -> incomplete_generation [incomplete_generation] budgetConsumed: false
- attempt 3: promptKind=initial; complete -> success []
- Recovery: non-consuming incomplete retry attempt(s) 1, 2 preceded success on attempt 3.
### core-src-05 (recovered)
- attempt 1: promptKind=initial; complete -> artifact_validation_failed [missing_closed_key,missing_closed_key]
- attempt 2: promptKind=repair; complete -> success []
- Recovery: repair attempt 2 succeeded.

No stage-4 task failed.

## Diagnosis

- The product completed all 13 planned modules. `tools.md` was accepted on its
  initial attempt: its inline-code `lw:anchors` syntax example remained display
  text, while all 12 real closed-list keys were covered by real markers.
- `core-src-01` recovered after two provider `abort` responses. Attempts 1 and
  2 were normalized to `incomplete`, recorded `budgetConsumed: false`, and did
  not consume repair slots; fresh initial attempt 3 succeeded.
- `core-src-05` failed closed-list coverage on initial attempt 1 for `writeCode`
  and `writeWiki`; repair attempt 2 added the missing real declarations and
  succeeded.
- The authoritative fence-aware acceptance analysis reports exactly 427 of 427
  planned symbols, 13 module pages, and zero real duplicate anchors. The initial
  raw evaluator counted the inline-code example as a 428th declaration; that
  false-positive file is retained for traceability.
- Batch and proxy accounting reconcile exactly at 217785 prompt and 35228
  completion tokens across 16 calls. Reasoning tokens, proxy errors, and proxy
  deaths were all zero.

## Artifacts and sanitization

- Generated wiki and structured proxy/batch/verify evidence are preserved here.
- Publish-time sanitization removes the temporary clone path and replaces local
  absolute repository/temp paths with placeholders.
- Authorization/Bearer values are defensively redacted.
- No generated page, proxy metric, batch status, or verify result was manually
  repaired or rewritten. Initial evaluator outputs were preserved before the
  required corrected local analyses were written to separate filenames.
- Final scans: zero exact secret-value matches, zero local absolute-user-path or
  secrets-file references, and zero suspicious Authorization/Bearer values.
- Controlled shutdown confirmed the proxy PID dead and port 8900 free.
- All prior benchmark directories through rerun-clean-v17/ were left untouched.

This was the only paid clean v18 batch attempt. No OpenWiki call, BENCHMARK.md
edit, commit, or push was performed.

**Verdict: PASS — the batch completed all 13 modules, verify reported zero
issues, 427/427 planned symbols reconciled under the frozen fence-aware marker
semantic, token accounting was exact, and the corrected qualitative gate passed.**
