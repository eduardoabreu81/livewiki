# Clean v6 — MiniMax-M3 livewiki bootstrap (product gate)

**Status:** **FAIL** — `completed` process-wise, but `verify` has 2 warning-level
`broken_internal_link` issues. Preserved as-is.
**Not** a winner claim. **Not** committed. **No second run.** **No manual correction.**
**No product code change.**

`rerun-clean-v4/` and `rerun-clean-v5/` were **not** modified by this run.

## Run identity

| Field | Value |
|-------|-------|
| Commit under test | **`d09550e`** (`fix(benchmark): align clean-run acceptance analysis`) |
| Full SHA | `d09550edaae1c383949b506b981d8ff4a8264e2c` |
| Command | `livewiki init --batch --no-refine --json` |
| Model / route | MiniMax-M3 via openai-compat → local token-proxy `:8900` → `https://api.minimax.io` |
| Thinking | `disabled` |
| stage4MaxOutputTokens | 8192 |
| maxRepairAttempts | 2 |
| maxModuleFiles / maxModuleSymbols | 12 / 80 |
| Timeout policy | product default (`timeoutMs` omitted → **300_000** ms) |
| Language | en |
| Disposable tree | temporary git worktree at `d09550e` (versioned `livewiki/` stripped) |
| Wall clock (batch only) | **283.4 s** (~4.7 min) |
| `process_exitCode` | **0** |
| `batchExitCode` | **0** (`completed`) |
| Proxy label | `livewiki-clean-v6` |
| Acceptance helper | **versioned**: `docs/benchmarks/2026-07-10-minimax-m3/tools/acceptance-analysis.mjs` (invoked with explicit proxy basename `token-proxy-livewiki-clean-v6.json`) |

## Harness (same as v5, validated)

| Step | Result |
|------|--------|
| Same foreground orchestration for proxy + batch | **PASS** |
| Proxy PID recorded (`metrics/proxy-pid.txt`) | **37616** |
| Wait until port **8900** accepts local TCP | **PASS** |
| Proxy process alive **before** batch start | **PASS** |
| No preflight chat completion | **PASS** (none issued) |
| Proxy alive for entire batch | **PASS** (`proxy_died_mid_batch=False`) |
| Controlled proxy stop after collection | **PASS** |

Orchestrator log: `metrics/orchestrator.log` (also `metrics/orchestrator-console.log`).

## Early gate

| Check | Result |
|-------|--------|
| Commit is `d09550e` | **PASS** |
| Stage 2 input / output tokens | **0 / 0** (`--no-refine`) |
| First wire traffic = stage-4 chat completions | **PASS** |
| Reasoning tokens (proxy) | **0** |

## Terminal outcome

| Metric | Value |
|--------|------:|
| Run status | **`completed`** |
| Stage-4 tasks done | **12** |
| Stage-4 tasks failed | **0** |
| Stage 2 tokens (batch) | 0 / 0 |
| Stage 4 / totals (batch) | **151 227** in / **30 148** out |
| Proxy wire tokens | **151 227** prompt / **30 148** completion / **0** reasoning |
| Proxy calls | **13** (HTTP errors at proxy: **0**) |
| Module pages on disk | **12 / 12** planned modules |
| Declared anchors | **383** (== `plannedSymbols` **383**, strict `===`) |
| Duplicate / unknown anchors | **0** |
| `src-*-ts` explosion | **0** |
| Duplicate page IDs | **0** |
| `verify --json` | exit **0**, `ok: true`, **2 warning issues** (0 errors) |

Batch totals **match** proxy wire totals exactly (no timeout/retry gap) — accounting
reconciled.

## Acceptance gate result (helper output)

```json
{
  "overallGate": "FAIL",
  "runStatus": "completed",
  "tasksFailed": 0,
  "missing": 0,
  "proxyCalls": 13,
  "declared": 383,
  "plannedSymbols": 383,
  "realDups": 0,
  "gates": {
    "statusCompleted": true,
    "zeroFailed": true,
    "allModulePages": true,
    "noExplosion": true,
    "noDupPageIds": true,
    "verifyZero": false,
    "noRealDuplicateAnchors": true,
    "fullSymbolCoverage": true
  }
}
```

**Only failing gate: `verifyZero`.** Every other criterion from the acceptance
list passed, including the strict `declaredAnchorCount === plannedSymbols`
check introduced after the v5 finding.

## Failure detail (preserved)

`verify --json` (`metrics/verify.json`) reported 2 `warning`-severity
`broken_internal_link` issues, both on `livewiki/core-src-04.md`:

```json
{
  "ok": true,
  "pagesChecked": 14,
  "issues": [
    {
      "severity": "warning",
      "code": "broken_internal_link",
      "wikiPath": "livewiki/core-src-04.md",
      "detail": "link para livewiki/page.md aponta para página inexistente"
    },
    {
      "severity": "warning",
      "code": "broken_internal_link",
      "wikiPath": "livewiki/core-src-04.md",
      "detail": "link para livewiki/page.md#section aponta para página inexistente"
    }
  ]
}
```

Root cause (from the emitted page, `livewiki/core-src-04.md` line 119): the
LLM was documenting `packages/core/src/verify.ts`, whose own source text
*describes* the wiki's internal-link syntax using the literal example
`` `[text](page.md)` `` and `` `[text](page.md#section)` `` inside inline
code spans:

> `` `broken_internal_link` (severity `warning`): `[text](page.md)` and
> `[text](page.md#section)` links must resolve to an existing page or
> section inside the wiki ``

`verify`'s link extractor does not appear to be code-span-aware, so it
matched `[text](page.md)` inside the backticks as if it were a real
Markdown link and flagged it as broken (there is no `page.md` in the wiki).
This is a **product-level finding distinct from the anchor/closed-list
hardening** shipped in `d09550e` — it is about the link checker treating
inline-code-quoted link syntax as a real link when the source text being
documented is itself about link syntax. `process_exitCode`/`batchExitCode`
stayed `0` because both issues are `warning`, not `error`, severity; the
acceptance gate here treats warnings as failing per the stricter "verify
zero issues (including warnings)" bar.

## Module structure

Planned modules (12): `cli-src`, `commands`, `core-src-01`…`04`,
`fase2-repo-src`, `llm`, `mcp-src`, `sample-ts-repo-src`, `scripts`,
`tools`.

| Check | Result |
|-------|--------|
| Legacy `src-*-ts` explosion | **0** |
| Duplicate page IDs | **0** |
| Missing page | none — all 12 present |
| Anchors declared vs. planned symbols | **383 == 383** (exact) |

## Token accounting

| Source | Prompt | Completion | Calls |
|--------|-------:|----------:|------:|
| Proxy (wire, authoritative) | 151 227 | 30 148 | 13 |
| Batch status totals | 151 227 | 30 148 | (attributed) |

Reasoning tokens: **0**. No secret keys in config or logs.

## Artifacts

```text
docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v6/
  notes.md
  _orchestrate-v6.ps1          # harness only (not product)
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
    token-proxy-livewiki-clean-v6.json
    token-proxy-livewiki-clean-v6.jsonl
```

## Explicit non-actions

- No second pipeline execution
- No `--only` / resume / replay / manual retry
- No manual correction of the generated pages or the harness after the run
- No product code changes
- No OpenWiki
- No `docs/BENCHMARK.md` update
- No commit / push
- No public winner claim
- **`rerun-clean-v4/` and `rerun-clean-v5/` left untouched**
