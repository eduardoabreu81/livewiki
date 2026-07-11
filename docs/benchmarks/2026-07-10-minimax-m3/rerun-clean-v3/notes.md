# Clean v3 (valid) — MiniMax-M3 livewiki bootstrap

**Status:** terminal run captured; post-review hygiene applied.  
**Not** a winner claim vs OpenWiki. **Not** committed.

The run remains **`completed_with_failures`**: **11 / 12** stage-4 tasks done; **`core-src-01.md` is absent**. Any future paid retry of that module must be a **separate** artifact, not a rewrite of this run into an apparent first-pass success.

## Run identity

| Field | Value |
|-------|-------|
| Commit under test | `4e62536` (`fix(cli): honor no-refine in batch execution`) |
| Parent structural split | `59e313d` (T0 exact module plan) |
| Command | `livewiki init --batch --no-refine` |
| Model / route | MiniMax-M3 via openai-compat → local proxy → `api.minimax.io` |
| Thinking | `disabled` |
| stage4MaxOutputTokens | 8192 |
| maxRepairAttempts | 2 |
| maxModuleFiles / maxModuleSymbols | 12 / 80 |
| Language | en |
| Disposable clone | `<temporary-working-tree>` (stripped of versioned `livewiki/` before run) |
| Wall clock | **~617.3 s** (~10.3 min) |
| CLI `--json` exit | 0 (structured); `batchExitCode` **1** (`completed_with_failures`) |

## Early gate (required)

Polled `batch status --json` after start:

| Check | Result |
|-------|--------|
| Stage 2 input tokens | **0** |
| Stage 2 output tokens | **0** |
| Stage 2 refine LLM | **none** (`--no-refine` honored) |
| First proxy call | Stage 4 chat completion (`/v1/chat/completions`, MiniMax-M3) |
| Early gate | **PASS** (see `metrics/batch-status-early.json`) |

## Terminal outcome

| Metric | Value |
|--------|------:|
| Run status | **`completed_with_failures`** (unchanged) |
| Stage-4 tasks done | 11 |
| Stage-4 tasks failed | **1** (`core-src-01` — no page) |
| Stage 2 tokens (batch) | 0 / 0 |
| Stage 4 / totals (batch) | 163 592 in / 30 786 out |
| Proxy wire tokens | 265 211 prompt / 67 933 completion / **0** reasoning |
| Proxy calls | **18** (all HTTP 200 at proxy) |
| Verify | exit **0**, `ok: true`, **0** issues on **emitted** pages |

## Token accounting (proxy is authoritative for wire/cost)

**Do not** describe the proxy−batch gap as mere “overhead” or generic “repair usage.”

### Exact difference

| Source | Prompt | Completion |
|--------|-------:|----------:|
| Proxy (wire) | 265 211 | 67 933 |
| Batch (adapter-attributed) | 163 592 | 30 786 |
| **Difference** | **101 619** | **37 147** |

That difference equals the sum of **exactly five** proxy calls whose **duration exceeded 60 000 ms** (the client’s default per-attempt timeout in `packages/core/src/llm/base.ts`):

| Proxy call id | durationMs | prompt | completion | HTTP (proxy) |
|--------------:|----------:|-------:|-----------:|-------------:|
| 4 | 75 211 | 20 118 | 4 960 | 200 |
| 6 | 86 239 | 20 541 | 8 192 | 200 |
| 7 | 80 520 | 20 541 | 8 086 | 200 |
| 8 | 81 176 | 20 541 | 8 192 | 200 |
| 9 | 69 881 | 19 878 | 7 717 | 200 |
| **Sum** | | **101 619** | **37 147** | |

### Mechanism

1. Client starts `fetch` with `AbortController` + **60 s** timer (`requestWithRetry`).
2. Provider (MiniMax) is still generating; client aborts at 60 s → adapter treats as **timeout** and **retries** (up to `maxRetries`, default 3).
3. Local reverse proxy **keeps the upstream request open** and later records a successful **HTTP 200** with full usage when MiniMax finishes.
4. Batch usage only counts responses that **return into the adapter** after a non-aborted fetch. Timed-out in-flight work is **invisible to batch totals** but **fully visible and billable on the wire** (proxy).

Therefore, for this provider/run:

- **Proxy wire accounting is the authoritative source for cost and resource use.**
- Batch totals under-report paid work when timeouts and client-side retries stack against a slow but successful provider.

Related product risk: fixed 60 s + retries can **duplicate paid calls** and amplify cost without appearing fully in `batch status`. See post-review diagnosis in the agent response / `REVIEW.md` token-accounting finding. Do **not** blind-retry `core-src-01` under the same timeout policy without addressing this.

## Module structure (no over-split)

Pages written under `livewiki/`:

- `core-src-02`, `core-src-03`, `core-src-04` (ordinal chunks)
- **`core-src-01.md` missing** (task failed — not a planner partition loss)
- `cli-src`, `commands`, `llm`, `mcp-src`
- `tools`, `scripts`, `sample-ts-repo-src`, `fase2-repo-src`
- plus `quickstart.md`, architecture/diagrams

| Check | Result |
|-------|--------|
| Legacy `src-*-ts.md` explosion | **0** |
| Duplicate page IDs | **0** |
| Missing page | **`core-src-01.md`** |

## Failure detail (original, not hidden)

`core-src-01`: `repair_exhausted` after 3 LLM calls attributed by the batch.  
Last diagnostic: `anchor_outside_closed_list`.  
Recorded retry command: `livewiki batch --only core-src-01 1` — **not executed** in this session; if ever run, preserve as a **separate** artifact.

Proxy calls 6–8 (same large prompt ~20 541) also sit among the >60 s set and hit ~8192 completion (max_tokens / long generation), illustrating timeout + repair interaction on that module.

## Artifacts

```text
docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v3/
  notes.md
  REVIEW.md                   # independent validation (Codex)
  livewiki/
  metrics/
    livewiki-config.json      # no secrets
    run-meta.txt              # clonePath=<temporary-working-tree>
    livewiki-batch-run.log
    batch-status-early.json
    batch-status.json
    verify.json
    token-proxy-livewiki-clean-v3-valid.json
    token-proxy-livewiki-clean-v3-valid.jsonl
    failed-core-src-01.json
```

## Preserved (untouched)

- `raw/`
- `rerun-clean/`
- `rerun-clean-v2/`
- `rerun-clean-v3-attempt-invalid-1/`

## Explicit non-actions

- No OpenWiki run
- No paid retry of `core-src-01`
- No `docs/BENCHMARK.md` update
- No commit / push
- No public winner claim
