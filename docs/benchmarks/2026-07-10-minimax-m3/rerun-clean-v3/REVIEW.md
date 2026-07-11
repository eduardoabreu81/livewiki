# Clean v3 independent validation

Date: 2026-07-11  
Reviewed commit: `4e62536c2138b0342109e82c08f163a2889b4478`  
Scope: livewiki clean v3 artifacts only. No OpenWiki comparison and no winner claim.

## Verdict

| Area | Verdict | Evidence |
| --- | --- | --- |
| Run protocol integrity | PASS | `--no-refine` was honored: stage 2 reports zero calls and zero tokens, and the first proxy call is stage 4. Thinking/reasoning tokens are zero. |
| T0 structural module plan | PASS | The run produced 12 planned modules with ordinal flat-directory chunks, no legacy `src-*-ts` page explosion, and no duplicate page IDs. |
| Batch completion | FAIL | The terminal status is `completed_with_failures`: 11 of 12 stage-4 tasks completed. `core-src-01` failed after repair exhaustion and has no Markdown page. |
| Validation of emitted pages | PASS | `verify` reports exit 0 and zero issues across 13 checked pages. This validates existing pages; it does not establish plan completeness. |
| Documentation completeness | FAIL | The missing `core-src-01` page represents 74 indexed symbols. The 11 successful module pages contain 292 unique code anchors, exactly `366 - 74`, so the gap is isolated and measurable. |
| Sample content quality | PASS-WITH-CHANGES | Sampled pages are generally useful and well anchored, but contain repetition, TODO text, and factual imprecision described below. |
| Equivalent A/B or public-result readiness | NOT READY | The run is protocol-valid evidence for the planner fix, but it is incomplete and has not undergone the frozen OpenWiki quality comparison. |

## Confirmed run facts

- Command: `livewiki init --batch --no-refine`.
- Wall time: approximately 617 seconds.
- Batch-attributed usage: 163,592 input and 30,786 output tokens; stage 2 is 0/0.
- Proxy wire usage: 265,211 prompt and 67,933 completion tokens over 18 HTTP calls; zero reasoning tokens and zero HTTP errors.
- Terminal result: 11 done, 1 failed (`core-src-01`), exit classification `completed_with_failures`.
- Failed task: `repair_exhausted`; last validation error `anchor_outside_closed_list`.
- Existing output: 11 module pages plus `quickstart.md`; `core-src-01.md` is absent.
- `verify.json`: `ok: true`, 13 pages checked, zero issues.

## Token-accounting finding

The proxy-to-batch difference is fully explained by five MiniMax responses that exceeded the client's default 60-second per-attempt timeout. The client aborted and retried while the local proxy continued waiting for the upstream request and later recorded an HTTP 200 response.

Those five wire calls total exactly 101,619 prompt and 37,147 completion tokens, which equals the complete difference between proxy and batch totals:

- Prompt: `265,211 - 163,592 = 101,619`
- Completion: `67,933 - 30,786 = 37,147`

The batch therefore reports usage only for responses that returned to the adapter, while the proxy captures all provider work. For this provider/run, proxy wire accounting is authoritative for cost and resource use.

This is a product finding, not merely benchmark overhead: a fixed 60-second timeout can cause duplicate paid calls and under-report usage when the provider completes successfully after the client aborts. Before another paid retry, the timeout/retry policy and accounting of timed-out in-flight requests should be reviewed. A blind retry may reproduce the same cost amplification.

## Module-plan validation

The clean v3 run demonstrates that the T0 structural split fixed the original one-file-module explosion:

- flat peer files are chunked into ordinal modules instead of deriving structure from filenames;
- real subdirectories remain structural modules;
- no legacy `src-*-ts` output pages were found;
- no duplicate page IDs were found;
- the missing documentation is one failed generation task, not a partition loss or duplicate assignment.

The run is therefore valid evidence that the deterministic planner behaves as intended. It is not evidence that the full batch completed successfully.

## Sample content review

The sampled output is anchored to real symbols and generally describes the implementation usefully. The following defects prevent an unqualified quality pass:

1. `livewiki/llm.md` repeats several explanations, including the sections around `requestWithRetry`, `sleep`, `readText`, and adapter configuration. The page needs editorial deduplication.
2. Generated pages retain TODO-style prose, which weakens their value as finished reference documentation.
3. `livewiki/core-src-03.md` says both `assertExactPathPartition` and `refinePeerDirectoryFragmentationError` throw `ExactPartitionError`. The source shows that only the former throws; the latter returns `string | null`.
4. The same page describes flat chunk naming in terms of `fileStem`/`slugifyIdSegment`, which is imprecise for the current ordinal IDs (`core-src-01`, `core-src-02`, and so on).

Anchor validity and factual/editorial quality are separate gates. A zero-issue `verify` result does not catch these prose defects.

## Artifact hygiene

`metrics/run-meta.txt` contains a machine-local absolute `clonePath`. Replace it with a stable placeholder or repository-relative description before committing or publishing these artifacts. No API key was found in the reviewed artifact set.

## Recommended next steps

### T0 — before another paid call

1. Treat this run as accepted planner evidence but explicitly incomplete batch evidence.
2. Investigate/configure the 60-second adapter timeout and ensure usage reporting can expose timed-out provider work when a proxy or provider usage source is available.
3. Sanitize the absolute path in `metrics/run-meta.txt` and correct `notes.md` so the token discrepancy is attributed specifically to the five timed-out calls.

### T1 — controlled recovery

1. Decide whether to retry only `core-src-01` after the timeout policy is addressed. Do not retry under the same known timeout behavior merely to obtain a green status.
2. If a retry is performed, preserve it as a distinct artifact and report both the original clean-run result and retry usage. Do not rewrite the original run into an apparently first-pass success.

### T2 — quality comparison

1. Perform the frozen OpenWiki quality review using an explicit rubric for completeness, factual accuracy, structure, redundancy, and navigability.
2. Count the missing `core-src-01` page against livewiki completeness.
3. Make no public winner claim until that review is complete and the limitations are reported.

## Actions intentionally not taken

- No paid retry or additional API request.
- No OpenWiki execution or comparison.
- No change to `BENCHMARK.md`.
- No commit or push.
