# Clean v7 — MiniMax-M3 livewiki bootstrap (product gate)

**Status:** **PASS** — all 8 acceptance gates green, `verify` zero issues.
**No product code change** during this run. **No** OpenWiki. **No**
`docs/BENCHMARK.md` update. **No** public winner claim.

`rerun-clean-v4/`, `rerun-clean-v5/`, and `rerun-clean-v6/` were **not**
modified by this run.

## Publish-time sanitization

The published `_orchestrate-v7.ps1` harness wrapper in this directory was
sanitized before commit, with **no change to metrics, wiki, or the PASS
result**:

- `metrics/clone-path.local.txt` (an absolute local temp-dir path) was
  deleted — it only recorded where the disposable worktree lived and is
  not part of the run's evidence.
- `repoRoot` is now derived from `$PSScriptRoot` (this script's own
  location, 4 levels up from `docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v7/`)
  instead of a hardcoded local absolute path.
- The `. "<absolute-path>\bench-secrets.ps1"` dot-source line was removed.
  The wrapper now only checks that `MINIMAX_API_KEY` is **already present in
  the calling environment** and throws if it is missing — it does not know
  or assume where any secrets file lives.
- Confirmed (grep across the whole `rerun-clean-v7/` tree) that no secret
  values, `Authorization`/bearer tokens, or absolute local paths
  (`C:\Users\...`, `AppData\Local\Temp\...`) remain anywhere in the
  published directory.

## Run identity

| Field | Value |
|-------|-------|
| Commit under test | **`4f7bbaa`** (`fix(core): ignore Markdown code in link verification`) |
| Full SHA | `4f7bbaae8cb1b334695af0b56e6a0b3cbe5420f6` |
| Command | `livewiki init --batch --no-refine --json` |
| Model / route | MiniMax-M3 via openai-compat → local token-proxy `:8900` → `https://api.minimax.io` |
| Thinking | `disabled` |
| stage4MaxOutputTokens | 8192 |
| maxRepairAttempts | 2 |
| maxModuleFiles / maxModuleSymbols | 12 / 80 |
| Timeout policy | product default (`timeoutMs` omitted → **300_000** ms) |
| Language | en |
| Disposable tree | temporary git worktree at `4f7bbaa` (versioned `livewiki/` stripped) |
| Wall clock (batch only) | **299.4 s** (~5.0 min) |
| `process_exitCode` | **0** |
| `batchExitCode` | **0** (`completed`) |
| Proxy label | `livewiki-clean-v7` |
| Acceptance helper | **versioned**: `docs/benchmarks/2026-07-10-minimax-m3/tools/acceptance-analysis.mjs` (invoked with explicit proxy basename `token-proxy-livewiki-clean-v7.json`) |

## Harness (same stable harness validated in v6)

| Step | Result |
|------|--------|
| Same foreground orchestration for proxy + batch | **PASS** |
| Proxy PID recorded (`metrics/proxy-pid.txt`) | **40768** |
| Wait until port **8900** accepts local TCP | **PASS** |
| Proxy process alive **before** batch start | **PASS** |
| No preflight chat completion | **PASS** (none issued) |
| Proxy alive for entire batch | **PASS** (`proxy_died_mid_batch=False`) |
| Controlled proxy stop after collection | **PASS** |
| Single attempt (no `--only` / resume / replay / retry) | **PASS** |

Orchestrator log: `metrics/orchestrator.log` (also `metrics/orchestrator-console.log`).

## Terminal outcome

| Metric | Value |
|--------|------:|
| Run status | **`completed`** |
| Stage-4 tasks done | **12** |
| Stage-4 tasks failed | **0** |
| Stage 2 tokens (batch) | **0 / 0** (`--no-refine`) |
| Stage 4 / totals (batch) | **174 432** in / **32 263** out |
| Proxy wire tokens | **174 432** prompt / **32 263** completion / **0** reasoning |
| Proxy calls | **15** (HTTP errors at proxy: **0**) |
| Module pages on disk | **12 / 12** planned modules |
| Declared anchors | **386** (`===` `plannedSymbols` **386**, strict equality) |
| Duplicate / unknown anchors | **0** |
| `src-*-ts` explosion | **0** |
| Duplicate page IDs | **0** |
| `verify --json` | exit **0**, `ok: true`, **0 issues** (errors and warnings) |

Batch totals **match** proxy wire totals exactly (174 432/32 263 both sides) —
accounting reconciled, no timeout/retry gap.

## Acceptance gate result (helper output)

```json
{
  "overallGate": "PASS",
  "runStatus": "completed",
  "tasksFailed": 0,
  "missing": 0,
  "proxyCalls": 15,
  "declared": 386,
  "plannedSymbols": 386,
  "realDups": 0,
  "gates": {
    "statusCompleted": true,
    "zeroFailed": true,
    "allModulePages": true,
    "noExplosion": true,
    "noDupPageIds": true,
    "verifyZero": true,
    "noRealDuplicateAnchors": true,
    "fullSymbolCoverage": true
  }
}
```

All 8 gates **PASS**, including the strict `declaredAnchorCount === plannedSymbols`
check (introduced after the v5 finding) and `verifyZero` (introduced/enforced
after the v6 finding — `verify.issues` array is empty, not just error-free).

## v6 → v7 regression check

The v6 FAIL was 2 `warning`-severity `broken_internal_link` issues on
`livewiki/core-src-04.md`, caused by `verify.ts`'s own link-checker matching
`` `[text](page.md)` `` markdown-link syntax written as a **documentation
example inside inline code** (that page documents `verify.ts` itself, whose
source describes its own link-checking rule using that exact literal
example). The fix (commits `cdac97a` + `4f7bbaa`) masks fenced-code and
inline-code content before the link scan.

In this v7 run, `core-src-04.md` was regenerated fresh by the LLM (new
content, 9.7K vs. v6's 15.7K — the split across pages differs since anchor
distribution isn't deterministic call-to-call) and `verify` reports **zero**
issues on it. No manual correction was applied to any page; the pass is the
product fix + a normal MiniMax-M3 generation.

## Module structure

Planned modules (12): `cli-src`, `commands`, `core-src-01`…`04`,
`fase2-repo-src`, `llm`, `mcp-src`, `sample-ts-repo-src`, `scripts`,
`tools`.

| Check | Result |
|-------|--------|
| Legacy `src-*-ts` explosion | **0** |
| Duplicate page IDs | **0** |
| Missing page | none — all 12 present |
| Anchors declared vs. planned symbols | **386 == 386** (exact) |
| `verify` issues (errors + warnings) | **0** |

## Token accounting

| Source | Prompt | Completion | Calls |
|--------|-------:|----------:|------:|
| Proxy (wire, authoritative) | 174 432 | 32 263 | 15 |
| Batch status totals | 174 432 | 32 263 | (attributed) |

Reasoning tokens: **0**. No secret keys in config or logs.

## Artifacts

```text
docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v7/
  notes.md
  _orchestrate-v7.ps1          # harness only (not product)
  livewiki/                    # 12 module pages + quickstart + architecture (all planned modules present)
  metrics/
    livewiki-config.json       # no secrets
    run-meta.txt                # sanitized clonePath
    orchestrator.log / orchestrator-console.log
    proxy-pid.txt
    proxy-stdout.log / proxy-stderr.log
    livewiki-batch-run.log / stdout / stderr
    batch-status-early.json
    batch-status.json
    verify.json
    acceptance-analysis.json
    token-proxy-livewiki-clean-v7.json
    token-proxy-livewiki-clean-v7.jsonl
```

## Explicit non-actions

- No second pipeline execution
- No `--only` / resume / replay / manual retry
- No manual correction of the generated pages or the harness
- No product code changes
- No OpenWiki
- No `docs/BENCHMARK.md` update
- No commit / push
- No public winner claim
- **`rerun-clean-v4/`, `rerun-clean-v5/`, and `rerun-clean-v6/` left untouched**
