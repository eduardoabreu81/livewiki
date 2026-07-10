# Handoff: Batch Resilience U-X and Benchmark Review

Date: 2026-07-10

## Purpose

Continue the uncommitted Batch Resilience U-X work, correct the remaining
review findings, and stop for independent review before any paid benchmark.

The repository contract is `SPEC.md`. Read `AGENTS.md`, `VISION.md`,
`SPEC.md`, and `docs/plans/batch-resilience-u-x.md` before acting.

## Product Frame

livewiki is agent-first and is delivered through CLI, MCP, and skills. The
same LLM that changed code should be able to update documentation without a
separate provider. A configured API provider is optional.

There are two independent dimensions:

| Work scope | In-session agent executor | Configured API executor |
|---|---|---|
| Initial full documentation | Resumable agent task queue | Autonomous batch |
| Incremental maintenance | Same coding agent pays focused debt | Optional API/CI automation |

The full-repository benchmark is a bootstrap stress test. The primary daily
workflow remains: task completed -> commit -> hook detects debt -> the same
agent updates affected sections via MCP while context is fresh -> verify ->
manifest update.

The resulting Markdown wiki must serve agents and humans. Deterministic
Mermaid structure, module dependency, and class diagrams already exist.
Export/viewer work comes later; do not expand the current U-X implementation
into Phases 6 or 7.

## Git and Working Tree

Current branch and remote:

```text
main at 04d6198, synchronized with origin/main
```

No commit or push has been made for U-X. The working tree is intentionally
dirty:

```text
 M SPEC.md
 M packages/core/package.json
 M packages/core/src/batch.ts
 M packages/core/src/config.test.ts
 M packages/core/src/config.ts
 M packages/core/src/index.ts
 M packages/core/src/init.ts
 M packages/core/src/modules.test.ts
 M packages/core/src/modules.ts
 M packages/core/src/prompts.test.ts
 M packages/core/src/prompts.ts
?? .codegraph/
?? docs/benchmarks/
?? docs/plans/
?? packages/core/src/artifact.test.ts
?? packages/core/src/artifact.ts
?? packages/core/src/batch-repair.test.ts
?? packages/core/src/batch-review.test.ts
```

The `SPEC.md` diff is the pre-implementation normative U-X draft. Preserve it
and review it against the final implementation. The raw benchmark artifacts
under `docs/benchmarks/2026-07-10-minimax-m3/raw/` are immutable evidence.

Never run `git clean -fdx`. Do not revert unrelated Markdown files.

## Benchmark Evidence

Benchmark source snapshot: repository commit `04d6198`. The OpenWiki target
was initialized as a temporary git repository at commit `02436b0`, whose
message records that it is a snapshot of `04d6198`.

Both tools used MiniMax-M3 through the same local HTTP proxy at
`http://127.0.0.1:8900/v1`.

### livewiki baseline

```text
Calls:             8
Prompt tokens:     79,850
Completion tokens: 22,357
Total tokens:      102,207
```

This was not a successful equivalent output:

- one call was stage-2 refinement and seven were stage-4 iterations;
- stage-2 returned invalid JSON and degraded to the heuristic;
- five heuristic modules shared the ID `src`;
- those modules reused one task row and overwrote `livewiki/src.md`;
- iteration counters reported five done and two failed;
- only three unique LLM page paths existed: `commands.md`, `llm.md`, and
  `src.md`;
- `commands.md` exhausted its output budget inside `<think>...</think>` and
  was incorrectly marked done;
- raw reasoning also leaked into other generated files.

Treat 102,207 tokens as a failed baseline and evidence of efficiency
potential, not as the cost of completed equivalent documentation.

### OpenWiki baseline

```text
Calls:             157
Prompt tokens:     13,668,064
Completion tokens: 38,724
Total tokens:      13,706,788
Elapsed:           819.4 seconds
Exit code:         0
```

OpenWiki produced 11 Markdown pages plus `.last-update.json`. It also modified
`AGENTS.md` and created `.github/`, including a workflow later cited by its own
documentation. Record those side effects in the quality review.

The raw token ratio is 134.1x, but no public winner claim is valid until
livewiki completes a corrected run and both outputs receive a factual quality
review.

### Evidence locations

```text
docs/benchmarks/2026-07-10-minimax-m3/raw/metrics/
docs/benchmarks/2026-07-10-minimax-m3/raw/livewiki/
docs/benchmarks/2026-07-10-minimax-m3/raw/openwiki/
docs/benchmarks/2026-07-10-minimax-m3/tools/token-proxy.mjs
```

The proxy process was stopped and port 8900 was confirmed free. Temporary
targets remain under:

```text
C:\Users\Eduardo\AppData\Local\Temp\claude\bench-c1\
```

`C:\Users\Eduardo\bench-secrets.ps1` was not read by the reviewer. Do not use
it during implementation or tests. It is only for a separately authorized
paid rerun.

## Sonnet Dogfooding Track

The earlier Sonnet run is a separate agent-assisted/MCP case study, not part
of the MiniMax batch A/B. It produced a complete 304/304-symbol wiki and found
real product bugs, but used a long 155-turn session.

The reported approximately 31.7M processed tokens include fresh input, cache
creation, cache reads, and all assistant output. The reported 231K output
tokens are not the final wiki alone; they include reasoning, drafts, tool
coordination, retries, and discarded output. Tokenize `livewiki/` directly to
measure accepted artifact size. Do not compare the Sonnet transcript directly
with the MiniMax proxy totals.

## U-X Scope Implemented So Far

The external executor added:

- prompt hardening and a repair prompt;
- stage-4 response normalization and artifact validation;
- configurable `maxRepairAttempts`, default 2;
- bounded initial generation plus corrective attempts;
- transactional candidate write and rollback reporting;
- stage-4 pricing override propagation;
- explicit generated-owner validation;
- reasoning/fence normalization;
- rejection of model-invented manual blocks;
- module-ID uniqueness gates in batch and init planning;
- structured final repair diagnostics;
- new unit and integration tests.

Verified improvements from the second pass:

- LF, CRLF, and BOM `owner: human` pages are no longer overwritten;
- missing/wrong owner in a generated artifact is rejected;
- config pricing overrides reach initial and corrective calls;
- a defensive module-ID exception records an aborted run instead of leaving it
  running;
- rollback failure is detected and reported;
- the prompt demonstrates section-marker syntax with real closed keys when
  keys exist;
- final repair exhaustion includes the last structured diagnostic;
- init planning now applies the same uniqueness gate before edges and derived
  artifacts.

## Current Validation State

Independent reviewer results after the second executor pass:

```text
pnpm -r build: passed
pnpm -r test: 504 passed, 8 skipped
```

Green tests do not make the implementation acceptable. Minimal reproductions
confirmed remaining contract defects not covered correctly by the suite.

## Remaining Findings: Must Fix

### 1. P0: module identity algorithm still discards refined IDs

`makeUniqueDeterministicIds` still derives candidates from the first file path
instead of starting from `module.id`.

Observed reproduction:

```text
auth-service    -> core-src
command-surface -> cli-src
```

Required behavior:

- normalize and preserve `module.id` when globally unique;
- expand path suffixes only for colliding IDs;
- preserve the LLM refinement name when it is already valid and unique.

### 2. P0: uniqueness assignment ignores already-taken IDs

A unique existing `core-src` and a colliding `src` group can both receive
`core-src` because the wave assignment checks only current-wave claim count,
not the global `taken` set.

Observed reproduction:

```text
tools/core-src/x.ts      -> core-src
packages/core/src/x.ts   -> core-src
packages/cli/src/x.ts    -> cli-src
```

Required behavior:

- never assign a candidate already present in `taken`;
- continue expanding the colliding path;
- use a stable full-path-derived fallback, not input order;
- tests must compare path-to-ID mappings, not sorted ID sets only.

### 3. P0: `owner: mixed` is incorrectly refused

The current pre-owner check treats `mixed` as untrusted and performs zero LLM
calls. This contradicts the ownership model:

- `owner: human`: refuse the entire automated rewrite;
- `owner: generated`: allow rewrite;
- `owner: mixed`: allow generated sections to change while preserving every
  `lw:manual` block byte-for-byte and retaining `owner: mixed`.

Add an end-to-end mixed-page test that proves the LLM is called, generated
content changes, owner remains mixed, and all manual blocks are unchanged.

### 4. P0: multiple manual blocks in one section are not supported

`extractManualBlocksBySection` stores one string per section slug. A second
block overwrites the first in the Map.

Observed reproduction with two blocks under one heading:

```text
status: completed_with_failures
last error: manual_block_altered
page: rolled back to the previous version
```

Use an ordered list per section, or stable placeholders, and preserve every
block in order. Add a test with two blocks in the same section that completes
successfully and compares exact block bytes.

### 5. P0: rollback failure is not terminal for the run

The current code exits the repair loop and records a failed task, then enters
normal circuit-breaker handling. With one failure it may continue to later
modules even though the disk may contain an invalid candidate.

Required behavior:

- checkpoint the failed task with `rollback_failed`;
- immediately finalize the run as `aborted`;
- perform no later LLM calls or page writes;
- return/surface the affected path and rollback error.

Test with at least two modules: rollback fails on the first and the second is
never attempted.

### 6. P1: usage attempt numbers still reset in `runOnly`

The orchestrator increments the accumulated checkpoint counter but passes
`i + 1` into each new `UsageAttempt`.

Observed reproduction:

```json
{"checkpointAttempt":2,"usageAttempts":[1,1]}
```

Pass the accumulated `attempt` value. Tests must assert:

```text
usageHistory.map(entry => entry.attempt) == [1, 2, 3, 4]
```

after repeated `runOnly` calls.

### 7. P2: empty closed-list prompt still emits a fake anchor

When `closedKeyList` is empty, the prompt emits
`<key from the closed list above>` inside marker syntax. Reject refined modules
with no valid paths/symbols before stage 4, and emit no marker example when no
real canonical key exists.

### 8. P2: new durable text still violates the English policy

Many new comments, test names, and messages remain in Portuguese, including
new additions in `batch.ts`, `artifact.ts`, and `batch-review.test.ts`.

Translate only the new U-X additions. Do not churn unrelated legacy text.
Audit added lines with `git diff` before reporting completion.

## Required Next Executor Workflow

1. Read the required documents and inspect the current uncommitted diff.
2. Fix only the eight findings above; do not broaden into export/viewer or a
   new executor-neutral task protocol in this patch.
3. Add targeted regressions that fail on the current code.
4. Run focused tests while developing.
5. Run the complete validation workflow from `AGENTS.md`.
6. Stop without commit, push, secret access, or paid network calls.
7. Return changed files, exact test results, `git diff --stat`, and remaining
   risks.

## Review Gate

No MiniMax rerun and no `docs/BENCHMARK.md` winner claim until an independent
review confirms:

- all eight findings are closed;
- build and full tests pass;
- run/task/page/overview/diagram identities agree;
- mixed/manual ownership semantics are intact;
- rollback failure aborts the full run;
- usage attempt history is monotonic;
- no new Portuguese durable text remains.

After approval, improve the proxy to record per-call cached tokens, reasoning
tokens, timestamps, status, and errors. Then rerun only livewiki on the frozen
snapshot with MiniMax-M3 and compare completion, quality, side effects, time,
and tokens against the preserved OpenWiki output.

## Suggested Launch Prompt

```text
You are the external implementation executor for livewiki.

Read AGENTS.md, VISION.md, SPEC.md,
docs/plans/batch-resilience-u-x.md, and
docs/handoffs/2026-07-10-batch-resilience.md.

Continue from the current uncommitted working tree. Fix only the remaining
findings in the handoff. The raw benchmark is immutable. Do not read secrets,
make network/paid LLM calls, rerun the benchmark, commit, or push.

If code and handoff disagree, the repository contract in SPEC.md wins and you
must report the discrepancy before coding. All new durable text must be English.

Stop after focused tests plus the complete AGENTS.md validation workflow.
Return the diff stat, test results, design decisions, and unresolved risks for
independent review.
```
