# Clean v4 — MiniMax-M3 livewiki bootstrap (product gate)

**Status:** **FAILED** (run terminal `aborted`). Preserved as-is.  
**Not** a winner claim. **Not** committed. **Not** patched after failure.

This is the single full pipeline execution requested after
`fix(core): require complete stage-4 documentation` (`b84c130`).
Internal product repairs were allowed; no `--only`, resume, replay, or
manual retry was used. No OpenWiki run. No `BENCHMARK.md` update.

## Run identity

| Field | Value |
|-------|-------|
| Commit under test | **`b84c130`** (`fix(core): require complete stage-4 documentation`) |
| Full SHA | `b84c13030ecce8c128dd328b649ffa18f81ded63` |
| Command | `livewiki init --batch --no-refine --json` |
| Model / route | MiniMax-M3 via openai-compat → local token-proxy `:8900` → `https://api.minimax.io` |
| Thinking | `disabled` |
| stage4MaxOutputTokens | 8192 |
| maxRepairAttempts | 2 |
| maxModuleFiles / maxModuleSymbols | 12 / 80 |
| Timeout policy | **product default** (`timeoutMs` omitted → **300_000** ms) |
| Language | en |
| Disposable tree | temporary git worktree at `b84c130` (versioned `livewiki/` stripped before run) |
| Wall clock | **~28.3 s** |
| CLI `--json` exit | 0 (structured); `batchExitCode` **2** (`aborted`) |

## Early gate

| Check | Result |
|-------|--------|
| Commit is `b84c130` | **PASS** |
| Stage 2 input tokens | **0** |
| Stage 2 output tokens | **0** |
| Stage 2 refine LLM | **none** (`--no-refine` honored; stage-2 task `done` with zero tokens) |
| First **successful** wire LLM call = stage 4 | **N/A — zero wire calls** |
| Reasoning tokens (proxy) | **0** (no calls) |
| Early status snapshot | `metrics/batch-status-early.json` (captured while run still `running`; stage-2 = 0 tokens) |

Early gate is **only partially satisfied**: `--no-refine` / stage-2 zero tokens are
correct, but the run never produced a successful stage-4 LLM call on the wire.

## Terminal outcome

| Metric | Value |
|--------|------:|
| Run status | **`aborted`** (circuit breaker after consecutive stage-4 failures) |
| Stage-4 tasks done | **0** |
| Stage-4 tasks failed | **3** (`core-src-02`, `core-src-03`, `core-src-04`) then abort |
| Stage 2 tokens (batch) | 0 / 0 |
| Stage 4 / totals (batch) | 0 / 0 (`usageIncomplete: true`) |
| Proxy wire tokens | **0** prompt / **0** completion / **0** reasoning |
| Proxy calls | **0** |
| Module pages written | **0** (only deterministic layout: quickstart, architecture, diagrams, manifest) |
| Verify | exit **0**, `ok: true`, **0** issues on **2** layout pages checked |

## Failure mode (preserved, not remended)

Every stage-4 attempt failed with network errors before any response reached the
adapter / proxy:

```text
[llm_error] LLM openai-compat request failed (status 0):
Failed after 3 attempts (last error: network)
```

- Tasks used 3 attempts each (`maxRepairAttempts=2` + initial) and ended
  `repair_exhausted` with last diagnostic `llm_error` / network.
- After **3 consecutive** module failures, the circuit breaker **aborted** the run
  (remaining modules never attempted).
- Proxy summary stayed at **0 calls** for the entire wall clock.
- Post-run connectivity check to `http://127.0.0.1:8900/v1` returned
  **connection refused** (proxy process no longer listening). Proxy had started
  successfully (see `metrics/proxy-stdout.log`) before the batch; it did not
  record any chat completion.

**Classification:** infrastructure / client↔proxy connectivity failure for this
attempt — **not** a stage-4 artifact validation failure (no model output was
validated against the closed list). Product completeness rules from `b84c130`
were never exercised by a live MiniMax response in this run.

## Dynamic acceptance (against this run’s plan)

Plan modules (from run `modulesRefined` / heuristic plan, 12 modules):

`cli-src`, `commands`, `core-src-01`…`04`, `fase2-repo-src`, `llm`, `mcp-src`,
`sample-ts-repo-src`, `scripts`, `tools`.

| Criterion | Result |
|-----------|--------|
| status final = `completed` | **FAIL** (`aborted`) |
| zero tasks failed | **FAIL** (3 failed) |
| page present for every planned module | **FAIL** (0 module pages) |
| union of anchors covers 100% planned symbols | **FAIL** (no module anchors) |
| no unknown or duplicate anchors | **N/A** (no module pages) |
| verify = zero issues | **PASS** on emitted layout only (not completeness) |
| no `src-*-ts` explosion | **PASS** (0 such pages) |
| no duplicate page IDs | **PASS** |

**Overall product gate: FAIL.**

## Token accounting

Proxy is authoritative for wire cost: **$0 / 0 tokens** on the wire for this
attempt (no upstream MiniMax usage recorded by the instrument). Batch totals
are also zero with `usageIncomplete` on failed network attempts.

## Artifacts

```text
docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v4/
  notes.md
  livewiki/                         # deterministic layout only (no module pages)
  metrics/
    livewiki-config.json            # no secrets; timeoutMs omitted (product default)
    run-meta.txt                    # sanitized clonePath
    livewiki-batch-run.log
    livewiki-batch-stdout.log
    livewiki-batch-stderr.log
    batch-status-early.json
    batch-status.json
    verify.json
    acceptance-analysis.json
    token-proxy-livewiki-clean-v4.json
    token-proxy-livewiki-clean-v4.jsonl
    proxy-stdout.log
    proxy-stderr.log
```

## Explicit non-actions

- No second full run / no remount of proxy for a “do-over” in this session  
  (single requested pipeline execution preserved)  
- No `--only` / resume / replay / manual retry  
- No OpenWiki  
- No `docs/BENCHMARK.md` update  
- No commit / push  
- No public winner claim  
- No silent patch of wiki or metrics  

## Operator note (out of band)

A clean paid gate still requires a future **new** disposable run with a
**stable** proxy lifecycle in the **same** process tree as the batch (or a
truly detached listener proven with a preflight chat completion). That would
be a **new** artifact directory (e.g. v4b / v5), not a rewrite of this failure.
