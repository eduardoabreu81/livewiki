# livewiki MiniMax-M3 CLEAN bootstrap (post U–X)

Date: 2026-07-10  
Commit under test: `a61170d`  
Target: `C:\Users\Eduardo\AppData\Local\Temp\livewiki-bench-clean`  
**Precondition:** committed dogfooding `livewiki/` **deleted** before run  
  (true full bootstrap — no Sonnet pages on disk).  
Route: openai-compat → token-proxy → `https://api.minimax.io`  
Model: `MiniMax-M3` · language: `en` · `maxRepairAttempts`: 2  

This is the **valid** livewiki side of the MiniMax A/B (same wire as OpenWiki).  
Do **not** use `rerun/` (first attempt) for comparison — it mixed in Sonnet wiki.

## Batch result

| Field | Value |
|---|---|
| Command | `init --batch` |
| Exit code | **1** |
| Run status | **`completed_with_failures`** |
| Wall clock | **319.7 s** (~5.3 min) |
| Stage-4 | **7 done / 1 failed** (`core-src` → `repair_exhausted`) |
| Stage-2 refine | Failed JSON parse → heuristic (degradable; not a hard fail) |

### Failed task

- **Module:** `core-src` (`packages/core/src/**`, largest module)
- **Attempts:** 3 (1 initial + 2 repairs)
- **Last diagnostic:** `invalid_frontmatter` (YAML frontmatter did not parse)
- **Disk:** page **not** left behind (transactional rollback) — correct U–X behavior

### Module pages on disk (no orphans)

```text
commands.md, cli-src.md, llm.md, mcp-src.md, tools.md,
sample-ts-repo-src.md, fase2-repo-src.md
+ quickstart.md, architecture/*, diagrams/*
```

**No** `core.md` / `cli.md` / `mcp.md` (Sonnet).  
**No** `core-src.md` (failed + rolled back).

IDs use path suffixes where needed: `core-src`, `cli-src`, `mcp-src`.

## Verify (repository-wide)

| Field | Value |
|---|---|
| `ok` | **true** |
| `pagesChecked` | 9 |
| `issues` | **0** |

Clean verify is meaningful only because the tree had **no stale wiki**.  
Criterion “batch complete + verify zero issues” is **not** fully met (one module missing), but every **accepted** page verifies clean.

## Wire tokens (proxy)

| Metric | Clean rerun | Failed baseline livewiki | OpenWiki baseline |
|---|---:|---:|---:|
| Calls | 14 | 8 | 157 |
| Prompt tokens | 188,255 | 79,850 | 13,668,064 |
| Completion tokens | 40,153 | 22,357 | 38,724 |
| **Total tokens** | **228,408** | **102,207** | **13,706,788** |
| Cached prompt (reported) | 60,827 | n/a | n/a |
| Reasoning (reported) | 19,881 | n/a | n/a |
| HTTP errors | 0 | 0 | n/a |

**Token ratio OpenWiki / clean livewiki ≈ 60×** (13.7M / 228k).  
This is a **cost-at-the-wire** comparison under the same openai-compat route.  
It is **not** a quality winner claim (livewiki still missing the largest module page).

## What this run validates

1. **Clean bootstrap** of livewiki batch after U–X (unique module IDs, repairs, rollback).
2. **Fair protocol vs OpenWiki** (both openai-compat via proxy to MiniMax-M3).
3. **Anti-hallucination path works:** bad `core-src` artifact never stays on disk; verify green on remaining wiki.
4. **Honest incomplete outcome:** `completed_with_failures` when one module exhausts repairs.

## What it does **not** validate

- Full equivalent coverage to OpenWiki’s 11 pages / Sonnet’s full wiki.
- Quality ranking or public “winner”.
- Incremental document-as-you-go (different product mode).
- MiniMax Anthropic-compat preset / prompt caching product path.

## Artifacts

```text
docs/benchmarks/2026-07-10-minimax-m3/rerun-clean/
  notes.md
  metrics/
    livewiki-config.json
    livewiki-batch-run.log
    batch-status.json
    verify.json
    token-proxy-livewiki-clean.json
    token-proxy-livewiki-clean.jsonl
  livewiki/          # generated wiki only (no Sonnet pages)
```

`raw/` remains the immutable pre-U–X baseline (do not modify).

## Follow-ups (optional)

1. Raise output budget / tighten prompts so large modules (`core-src`) emit valid frontmatter.
2. Re-run with `--only core-src` after prompt/budget tweak for a full 8/8 completion.
3. Side-by-side **quality** sample (N factual claims) vs `raw/openwiki/` before any marketing table.
