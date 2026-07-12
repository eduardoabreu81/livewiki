# T0 offline module inventory (real index/plan)

**Generated:** 2026-07-12T20:05:50.014Z

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
| Plan files (symbol-bearing) | 74 |
| Files table (active) | 107 |
| Zero-symbol files (not in plan) | 33 |
| Active symbols (AST) | 402 |
| Modules | 13 |
| Max files / module | 12 |
| Max symbols / module | 78 |
| Sum module symbols | 402 (matches plan total: true) |
| Unsplittable | 0 |
| Legacy `src-*-ts` explosion | 0 |
| .mjs in plan | true |
| .mjs in files table | true |
| Plan extensions | {".mjs":3,".ts":71} |

## Modules (id × files × symbols)

- `cli-src` files=5 symbols=26
- `commands` files=11 symbols=25
- `core-src-01` files=9 symbols=76
- `core-src-02` files=12 symbols=69
- `core-src-03` files=9 symbols=78
- `core-src-04` files=12 symbols=58
- `core-src-05` files=1 symbols=3
- `fase2-repo-src` files=1 symbols=4
- `llm` files=5 symbols=23
- `mcp-src` files=5 symbols=18
- `sample-ts-repo-src` files=1 symbols=6
- `scripts` files=1 symbols=4
- `tools` files=2 symbols=12

See `modules.json` for `planFilePaths`, per-file AST counts, and modules.

**Reproduce:** `pnpm --filter @livewiki/core build && node scripts/offline-inventory-t0.mjs`
**Do not** treat as OpenWiki A/B winner. No paid batch / clean v3.
