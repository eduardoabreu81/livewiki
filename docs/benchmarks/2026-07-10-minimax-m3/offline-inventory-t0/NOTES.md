# T0 offline module inventory (real index/plan)

**Generated:** 2026-07-11T13:00:43.087Z  
**Method:** disposable copy of the **working tree** + `runInit({ plan: true })`  
(same walker, parser, indexer, AST symbol extraction, `loadConfig`, and
unique → split → exact-partition → unique planner as batch).  
**Not** a synthetic file walk with 1 symbol/file.

**Partition base:** `plan.filePaths` = distinct paths from **active AST symbols**
(same as batch). The `files` table may list walked files with zero extractable
symbols; those are recorded under `filesNotInPlanInventory` and are outside
the module plan contract.

## Caps (resolved)

| Key | Value |
|-----|------:|
| maxModuleFiles | 12 |
| maxModuleSymbols | 80 |
| normalized maxFiles | 12 |
| normalized maxSymbols | 80 |

## Audits

| Check | Result |
|-------|--------|
| Exact partition vs **plan.filePaths** | **true** |
| Unique module IDs | **true** |
| Plan files (symbol-bearing) | 70 |
| Files table (active) | 99 |
| Zero-symbol files (not in plan) | 29 |
| Active symbols (AST) | 366 |
| Modules | 12 |
| Max files / module | 12 |
| Max symbols / module | 74 |
| Sum module symbols | 366 (matches plan total: true) |
| Unsplittable | 0 |
| Legacy `src-*-ts` explosion | 0 |
| .mjs in plan | true |
| .mjs in files table | true |
| Plan extensions | {".mjs":2,".ts":68} |

## Modules (id × files × symbols)

- `cli-src` files=5 symbols=24
- `commands` files=11 symbols=24
- `core-src-01` files=9 symbols=74
- `core-src-02` files=12 symbols=64
- `core-src-03` files=8 symbols=73
- `core-src-04` files=11 symbols=50
- `fase2-repo-src` files=1 symbols=4
- `llm` files=5 symbols=17
- `mcp-src` files=5 symbols=18
- `sample-ts-repo-src` files=1 symbols=6
- `scripts` files=1 symbols=4
- `tools` files=1 symbols=8

See `modules.json` for `planFilePaths`, per-file AST counts, and modules.

**Reproduce:** `pnpm --filter @livewiki/core build && node scripts/offline-inventory-t0.mjs`  
**Do not** treat as OpenWiki A/B winner. No paid batch / clean v3.
