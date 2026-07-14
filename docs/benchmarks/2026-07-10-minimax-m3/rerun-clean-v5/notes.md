# Clean v5 — MiniMax-M3 livewiki bootstrap (product gate)

**Status:** **FAIL** — `completed_with_failures` (1 module). Preserved as-is.  
**Not** a winner claim. **Not** committed. **No second run.** **No product code change.**

`rerun-clean-v4/` remains an **infrastructure FAIL** (0 wire calls) and was **not** modified.

This v5 run fixed **only the harness lifecycle** (proxy + batch in one foreground
orchestration). The product under test is still **`b84c130`**.

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
| Timeout policy | product default (`timeoutMs` omitted → **300_000** ms) |
| Language | en |
| Disposable tree | temporary git worktree at `b84c130` (versioned `livewiki/` stripped) |
| Wall clock | **~357.6 s** (~6.0 min) |
| CLI `--json` process exit | (empty in meta; structured output present) |
| `batchExitCode` | **1** (`completed_with_failures`) |

## Harness (v5 fix vs v4)

| Step | Result |
|------|--------|
| Same foreground orchestration for proxy + batch | **PASS** |
| Proxy PID recorded (`metrics/proxy-pid.txt`) | **49692** |
| Wait until port **8900** accepts local TCP | **PASS** |
| Proxy process alive **before** batch start | **PASS** |
| No preflight chat completion | **PASS** (none issued) |
| Proxy alive for entire batch | **PASS** (`proxy_died_mid_batch=False`) |
| Controlled proxy stop after collection | **PASS** |

Orchestrator log: `metrics/orchestrator.log`.

## Early gate

| Check | Result |
|-------|--------|
| Commit is `b84c130` | **PASS** |
| Stage 2 input / output tokens | **0 / 0** |
| Stage 2 refine LLM | **none** (`--no-refine`) |
| First wire traffic = stage-4 chat completions | **PASS** (proxy: 19 calls, all stage-4 path) |
| Reasoning tokens (proxy) | **0** |
| Early snapshot | `metrics/batch-status-early.json` (`running`, stage-2 = 0) |

## Terminal outcome

| Metric | Value |
|--------|------:|
| Run status | **`completed_with_failures`** |
| Stage-4 tasks done | **11** |
| Stage-4 tasks failed | **1** (`core-src-01`) |
| Stage 2 tokens (batch) | 0 / 0 |
| Stage 4 / totals (batch) | **269 757** in / **49 603** out |
| Proxy wire tokens | **269 757** prompt / **49 603** completion / **0** reasoning |
| Proxy calls | **19** (HTTP errors at proxy: **0**) |
| Module pages on disk | **11** (missing `core-src-01.md`) |
| Verify | exit **0**, `ok: true`, **0** issues on emitted pages |

Batch totals **match** proxy wire totals for this run (no timeout/retry gap).

## Failure detail (preserved)

`core-src-01` (task id 5):

- **status:** `failed`
- **attempts:** 3
- **usage (batch):** 67 667 in / 16 695 out
- **error code:** `repair_exhausted`
- **last diagnostic:** `anchor_outside_closed_list` (section anchor not in closed list)
- **total errors recorded:** 9
- **retry command recorded (not executed):** `livewiki batch --only core-src-01 1`

See `metrics/failed-core-src-01.json`.

This is a **product / model-artifact** failure under the closed-list validator at
`b84c130`, **not** a harness/proxy failure.

## Module structure

Planned modules (12): `core-src-01`…`04`, `cli-src`, `commands`, `llm`,
`mcp-src`, `tools`, `scripts`, `sample-ts-repo-src`, `fase2-repo-src`.

| Check | Result |
|-------|--------|
| Legacy `src-*-ts` explosion | **0** |
| Duplicate page IDs | **0** |
| Missing page | **`core-src-01.md`** |
| Pages present | `cli-src`, `commands`, `core-src-02`, `core-src-03`, `core-src-04`, `fase2-repo-src`, `llm`, `mcp-src`, `sample-ts-repo-src`, `scripts`, `tools` |

Unique anchors declared on emitted module pages (frontmatter ∪ `lw:anchors`):
**302** (consistent with full index minus the missing module’s symbols).

## Dynamic acceptance (this run’s plan)

| Criterion | Result |
|-----------|--------|
| status final = `completed` | **FAIL** (`completed_with_failures`) |
| zero tasks failed | **FAIL** (1) |
| page for every planned module | **FAIL** (`core-src-01`) |
| 100% of planned symbols declared | **FAIL** (missing module’s closed list not on disk) |
| no unknown/duplicate anchors (product contract) | **Partial** — failed task never persisted; surviving pages passed write+verify. Offline scan notes keys repeated across **frontmatter + section markers** (allowed by product: same key may appear once in FM and once in a single section). |
| verify zero issues | **PASS** on emitted pages |
| no explosion / no duplicate page IDs | **PASS** |

**Overall product gate: FAIL.**

## Token accounting

| Source | Prompt | Completion | Calls |
|--------|-------:|----------:|------:|
| Proxy (wire, authoritative) | 269 757 | 49 603 | 19 |
| Batch status totals | 269 757 | 49 603 | (attributed) |

Reasoning tokens: **0**. No secret keys in config or logs.

## Artifacts

```text
docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v5/
  notes.md
  livewiki/                    # 11 module pages + layout (no core-src-01.md)
  metrics/
    livewiki-config.json       # no secrets
    run-meta.txt               # sanitized clonePath
    orchestrator.log
    proxy-pid.txt
    proxy-stdout.log / proxy-stderr.log
    livewiki-batch-run.log / stdout / stderr
    batch-status-early.json
    batch-status.json
    failed-core-src-01.json
    verify.json
    acceptance-analysis.json
    token-proxy-livewiki-clean-v5.json
    token-proxy-livewiki-clean-v5.jsonl
  _orchestrate-v5.ps1          # harness only (not product)
  _acceptance.mjs              # offline acceptance helper
```

## Explicit non-actions

- No second pipeline execution  
- No `--only` / resume / replay / manual retry  
- No product code changes  
- No OpenWiki  
- No `docs/BENCHMARK.md` update  
- No commit / push  
- No public winner claim  
- **`rerun-clean-v4/` left untouched** as infrastructure FAIL evidence  

## Post-run alteration to `_acceptance.mjs` (documented, not restored byte-for-byte)

`_acceptance.mjs` in this directory was **rewritten after the v5 run completed**
to be a thin wrapper that delegates to `../tools/acceptance-analysis.mjs` (the
shared helper prepared for the *next* clean run). This is a **known deviation**
from "the exact script that produced `metrics/acceptance-analysis.json`" —
that original, self-contained script was not preserved anywhere (it was an
untracked file, overwritten in place, no git history) and **cannot be restored
byte-for-byte**.

Evidence of the drift: `metrics/acceptance-analysis.json` (the frozen v5
output) uses a different, now-superseded schema — `pageInternalDupAnchors` /
`noPageInternalDupAnchors` and a `fullSymbolCoverage` computed as `covered >=
plannedSymbols` — whereas the current shared `tools/acceptance-analysis.mjs`
uses `realDuplicateAnchors` / `noRealDuplicateAnchors` (with same-marker vs.
cross-section duplicate distinction) and, as of the Codex blocker fix, strict
`covered === plannedSymbols`. Re-running `_acceptance.mjs` today against the
v5 artifact tree will **not** reproduce `metrics/acceptance-analysis.json`
verbatim — the frozen file remains the authoritative record of what the v5
run actually produced; do not overwrite it by re-running the wrapper.

The shared helper (with the item-6/item-7 fixes) is intended for the **next**
clean run only, per the instruction that prompted this note.
