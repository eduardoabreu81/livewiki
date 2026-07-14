# Invalid clean-v3 attempt 1 — `--no-refine` CLI wiring bug

**Date:** 2026-07-11  
**Commit:** `59e313d973e358ef811ec7868d18f03f8ab547c8`  
**Intended mode:** `livewiki init --batch --no-refine`  
**Result:** invalid protocol attempt; manually stopped and excluded from A/B.

## Why this attempt is invalid

The CLI accepted `--no-refine`, but stage 2 still called MiniMax-M3. Commander
stores a negated option as `opts.refine === false`; the init wrapper reads
`opts.noRefine`, so it did not pass `noRefine: true` to core.

The stage-2 checkpoint proves the unintended call occurred:

- input tokens: 702
- output tokens: 363
- result: `refine_incomplete_partition` (29/70 paths), heuristic retained

Because the agreed clean-v3 protocol was deterministic `--no-refine`, the
process and proxy were stopped as soon as the mismatch was confirmed. The run
remains `running` in its disposable checkpoint because it was force-stopped;
it must not be resumed or included in comparison tables.

## Partial evidence

- Proxy calls: 10
- Prompt tokens: 176,497
- Completion tokens: 12,017
- Total tokens: 188,514
- Cached prompt tokens: 1,024
- Reasoning tokens: 0
- HTTP/proxy errors: 0
- Completed stage-4 modules: `core-src-02`, `core-src-03`, `cli-src`
- Failed stage-4 modules: `core-src-04`, `core-src-01`
- Failure shape: three attempts each ended with incomplete/unclosed
  frontmatter and `repair_exhausted`

The partial wiki and raw proxy JSON/JSONL are preserved only for debugging.
No OpenWiki run was started, and no winner claim is supported by this attempt.

## Required next action

Fix and test CLI propagation of `--no-refine`, commit/push that fix, then start
a new clean target and a new proxy/output directory. Do not reuse this target
or checkpoint.

