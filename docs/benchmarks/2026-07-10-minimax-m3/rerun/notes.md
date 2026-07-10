# livewiki MiniMax-M3 rerun notes (post U–X)

Date: 2026-07-10  
Target: git worktree at `a61170d`  
Path: `C:\Users\Eduardo\AppData\Local\Temp\livewiki-bench-ux`  
Route: openai-compat → local token-proxy → `https://api.minimax.io`  
Model: `MiniMax-M3`  
Language: `en`  
`maxRepairAttempts`: 2  

## Result (batch)

| Field | Value |
|---|---|
| CLI | `init --batch` |
| Exit code | **0** |
| Wall clock | **333.2 s** (~5.6 min) |
| Run status | **completed** |
| Stage-4 tasks | **8 done / 0 failed** |
| Stage-2 refine | LLM JSON invalid → **heuristic kept** (expected degradable path) |

### Module IDs (stage 4 targets)

`core-src`, `commands`, `cli-src`, `llm`, `mcp-src`, `tools`, `sample-ts-repo-src`, `fase2-repo-src`

Unique path suffixes worked (no single `src.md` overwrite storm).

Repairs used: `core-src` 3 attempts, `commands` 2, `llm` 2; others 1.

## Proxy totals (wire)

| Metric | Rerun | Baseline livewiki (failed) | Baseline OpenWiki |
|---|---:|---:|---:|
| Calls | 13 | 8 | 157 |
| Prompt tokens | 161,957 | 79,850 | 13,668,064 |
| Completion tokens | 41,009 | 22,357 | 38,724 |
| **Total tokens** | **202,966** | **102,207** | **13,706,788** |
| Cached prompt (reported) | 1,650 | n/a | n/a |
| Reasoning (reported) | 21,718 | n/a | n/a |
| Calls w/ error | 0 | 0 | n/a |
| Calls w/o usage | 0 | 0 | n/a |

Note: rerun spent more tokens than the **failed** baseline because it completed more real pages + repairs. Vs OpenWiki raw total, wire tokens remain ~**67×** lower (13.7M / 203k) — **not a quality winner claim**.

## Verify

- `pagesChecked`: 13  
- `ok`: **false** (exit 1)  
- Issues: **6× `broken_anchor` error**, all on `livewiki/core.md`  
  - Hallucinated symbols: `batch.ts#checkPageOwner`, `#generateModuleDoc`, `#writeWikiPagePreservingManual`  

## Wiki artifacts

Copied to `rerun/livewiki/`.

Official task pages: `core-src.md`, `cli-src.md`, `mcp-src.md`, `commands.md`, `llm.md`, `tools.md`, fixtures pages, plus diagrams/overview/quickstart.

**Anomaly:** also present `core.md`, `cli.md`, `mcp.md` (large files) that are **not** in the stage-4 task target list. `core.md` is the only page failing verify. Investigate in a follow-up (orphan writes vs dual identity).

## Side effects

livewiki wrote only under `livewiki/` and `.livewiki/` in the throwaway worktree (allowlist). No `AGENTS.md` / `.github/` pollution (contrast OpenWiki baseline side effects).

## Honest comparison frame

| Dimension | Observation |
|---|---|
| Completion | Batch status completed 8/8 stage-4 tasks (exit 0) |
| Identity | Unique module IDs: `core-src` / `cli-src` / `mcp-src` (U–X goal met for tasks) |
| Verify clean | **Not yet** — errors on orphan/extra `core.md` |
| Tokens vs OpenWiki baseline | Much lower at the wire; apples-to-apples quality review still required |
| Tokens vs livewiki failed baseline | Higher (expected: more successful work + repairs) |
| Side effects | Cleaner than OpenWiki baseline |

## Artifacts

```text
rerun/metrics/token-proxy-livewiki-ux-rerun.json
rerun/metrics/token-proxy-livewiki-ux-rerun.jsonl
rerun/metrics/livewiki-config.json
rerun/metrics/livewiki-batch-run.log
rerun/metrics/batch-status.json
rerun/metrics/verify.json
rerun/livewiki/
rerun/notes.md
```

`raw/` left untouched.
