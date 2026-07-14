# Clean v13 — FAIL

## Identity

- Base commit: 890c33acc82fa3ec9099c98954a450353681748a
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
- Stage-4 tasks: 10 done / 3 failed
- Batch process exit: 0
- Structured batch exit: 1
- Wall clock: 504.1 seconds
- Proxy: 20 calls; 266211 prompt / 49680 completion / 0 reasoning tokens
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

### core-src-04 (failed)
- attempt 1: complete -> artifact_validation_failed [anchor_outside_closed_list]
- attempt 2: complete -> artifact_validation_failed [anchor_outside_closed_list]
- attempt 3: incomplete -> incomplete_generation [incomplete_generation]
### core-src-01 (failed)
- attempt 1: incomplete -> incomplete_generation [incomplete_generation]
- attempt 2: complete -> artifact_validation_failed [duplicate_anchor,duplicate_anchor,duplicate_anchor,duplicate_anchor,duplicate_anchor,duplicate_anchor,duplicate_anchor,duplicate_anchor,duplicate_anchor,duplicate_anchor,duplicate_anchor,duplicate_anchor,duplicate_anchor,duplicate_anchor,duplicate_anchor,duplicate_anchor,duplicate_anchor,duplicate_anchor,unclosed_markdown,todo_marker_present]
- attempt 3: complete -> artifact_validation_failed [todo_marker_present]
### tools (recovered)
- attempt 1: complete -> artifact_validation_failed [anchor_outside_closed_list]
- attempt 2: complete -> success []
- Recovery: repair attempt 2 succeeded.
### fase2-repo-src (failed)
- attempt 1: complete -> artifact_validation_failed [duplicate_anchor,duplicate_anchor,duplicate_anchor,duplicate_anchor]
- attempt 2: complete -> artifact_validation_failed [duplicate_anchor,duplicate_anchor,duplicate_anchor,duplicate_anchor,empty_section]
- attempt 3: complete -> artifact_validation_failed [duplicate_anchor,duplicate_anchor,duplicate_anchor,duplicate_anchor]

## Artifacts and sanitization

- Generated wiki and structured proxy/batch/verify evidence are preserved here.
- Publish-time sanitization removes the temporary clone path and replaces local
  absolute repository/temp paths with placeholders.
- Authorization/Bearer values are defensively redacted.
- No generated page, metric, or result was manually repaired or rewritten to
  change its outcome.
- All prior benchmark directories through rerun-clean-v12/ were left untouched.

This was the only paid clean v13 batch attempt. No OpenWiki call, BENCHMARK.md
edit, commit, or push was performed.

## Diagnosis (product outcome)

All infrastructure gates passed. The duplicate-symbol indexer fix allowed
initialization and stage 4 to start, the proxy stayed alive for the complete
paid lifecycle, and all 20 calls returned without proxy errors. Stage 2 and
reasoning used zero tokens, and stage-4 accounting reconciled exactly with the
proxy (266211 prompt / 49680 completion tokens).

The repaired prompt path succeeded in a real wire call for `tools`: its initial
candidate was rejected for one `anchor_outside_closed_list`, and repair attempt
2 completed successfully. This confirms that a selectively preserved, complete
candidate can recover without the v11 missing-section collapse.

Three of 13 planned modules still exhausted their bounded attempts:

- `core-src-04` retained one outside-list section anchor through two completed
  candidates, then received an incomplete provider response on attempt 3.
- `core-src-01` received an incomplete initial response, then a fresh completed
  candidate with duplicate anchors, unclosed Markdown, and TODO prose. Its
  repair removed every rejection except `todo_marker_present`, which remained.
- `fase2-repo-src` retained four duplicate section anchors across the initial
  candidate and both repairs; attempt 2 additionally introduced an empty
  section.

The ten accepted module pages pass the qualitative audit, and `verify` reports
zero issues on the 12 pages present. The corpus is nevertheless incomplete:
`core-src-01`, `core-src-04`, and `fase2-repo-src` are missing, with 292 declared
anchors against 423 planned symbols. Therefore the mechanical and combined
gates correctly remain FAIL.

## Sanitization performed

- No credential value or Authorization/Bearer token value is present.
- No absolute user, temporary-worktree, or repository path is present.
- No local credential-file path or loading command is preserved.
- Metrics, generated pages, batch status, and verify output were not rewritten
  to change their outcome.
- All prior benchmark directories through rerun-clean-v12 remain untouched.
