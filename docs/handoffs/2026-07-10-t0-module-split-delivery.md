# T0 delivery — module plan / split (for review)

**Date:** 2026-07-11  
**Status:** Implemented locally — **not committed**. No clean v3 / paid batch.

## Second-review pass (PASS-WITH-CHANGES follow-ups)

| # | Adjustment | Status |
|---|------------|--------|
| 1 | Real offline inventory via `runInit({ plan: true })` on disposable working-tree copy | done |
| 2 | True **99/100** refine incomplete-partition test | done |
| 3 | `symbolCountByPath` contract documented; chunk-without-map → children 0 | done |
| 4 | init fail-closed on malformed `config.json` | done |

## What shipped (T0 + exact refine partition)

| Item | Behavior |
|------|----------|
| True subdirs only | Peer filenames are **not** structural groups |
| Flat peers | One bucket → dual-axis pack (`maxFiles` + `maxSymbols`) |
| Chunk IDs | Ordinal: `core-src-01`, `core-src-02`, … |
| Atomic over-symbol file | `unsplittable: true`, batch **does not** abort |
| Order | unique → split → **exact partition vs indexed `filePaths`** → unique → assert |
| `0` thresholds | Axis disabled (`normalizeSplitLimits`) |
| Refine | **Exact 100%** partition of indexed inventory; unknown/duplicate/empty/peer-fragment rejected → full heuristic, no abort |
| `symbolCountByPath` | Required for correct per-chunk counts; intact modules keep input count without map; **chunk children without map get 0** |
| init config | Malformed JSON throws; no silent 12/80 |

## Files touched (code + contract)

- `packages/core/src/modules.ts`
- `packages/core/src/modules.test.ts`
- `packages/core/src/batch.ts`
- `packages/core/src/batch-review.test.ts`
- `packages/core/src/init.ts`
- `packages/core/src/init-config.test.ts` (new)
- `SPEC.md`, `AGENTS.md`
- `scripts/offline-inventory-t0.mjs` (reproducible real inventory)
- `docs/benchmarks/2026-07-10-minimax-m3/offline-inventory-t0/`

## Offline inventory (real path)

```text
pnpm --filter @livewiki/core build
node scripts/offline-inventory-t0.mjs
```

- Disposable copy of **working tree** (skips `node_modules`, `.git`, `dist`, `livewiki`, `.livewiki`, …)
- Config: plan-only thresholds (no provider)
- Entrypoint: **`runInit({ plan: true })`** → walker + parser + AST symbols + planner
- Partition base: **active-symbol paths** (`plan` / batch contract), not synthetic 1/file
- Artifacts: `modules.json`, `NOTES.md`

### Last run (2026-07-11, working tree under test)

| Metric | Value |
|--------|------:|
| Plan files (symbol-bearing) | **70** |
| Active AST symbols | **366** |
| Files table active (incl. 0-symbol) | 99 |
| Files not in plan inventory | 29 |
| Modules | **12** |
| Exact partition vs plan paths | **true** |
| Unique IDs | **true** |
| Legacy `src-*-ts` explosion | **0** |
| Max files / module | 12 |
| Max symbols / module | 74 |
| Unsplittable | 0 |
| Sum module symbols == plan total | **true** |
| .mjs in plan | yes (2) |

Modules (abbrev): `cli-src`, `commands`, `core-src-01..04`, `llm`, `mcp-src`, fixtures, `scripts`, `tools`.

## Validation (this pass)

| Command | Result |
|---------|--------|
| `git diff --check` | clean (CRLF warnings only on Windows) |
| `pnpm -r build` | green (core + cli + mcp) |
| `pnpm -r test` | core **483** + cli **42** + mcp **19** (8 skipped) |
| `node scripts/offline-inventory-t0.mjs` | exit 0; partition/unique true |

New/updated tests this pass: true **99/100** refine reject; chunk-without-map zeros children; `init-config.test.ts` malformed fail-closed.

## Explicitly not done

- Clean v3 / MiniMax bootstrap
- Commit / push
- Paid API calls

## Clean v3 note (after approval)

Recommended first paid run still uses structural planner isolation; refine guard is 100% partition + peer integrity. Prefer documenting whether v3 uses `--no-refine` or product default refine.
