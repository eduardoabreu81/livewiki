---
title: scripts
owner: generated
anchors:
  - scripts/offline-inventory-t0.mjs#importDist
  - scripts/offline-inventory-t0.mjs#copyWorkingTree
  - scripts/offline-inventory-t0.mjs#walk
  - scripts/offline-inventory-t0.mjs#tallyExtensions
---

# scripts

## `scripts/offline-inventory-t0.mjs` — T0 offline inventory

<!-- lw:anchors scripts/offline-inventory-t0.mjs#importDist scripts/offline-inventory-t0.mjs#copyWorkingTree -->

The T0 script produces an offline module inventory of the **current working tree** by:

1. Copying the livewiki working tree into a disposable temp directory (skipping `node_modules`, `.git`, `.livewiki`, `livewiki`, `dist`, `coverage`, `.codegraph`).
2. Writing a plan-only config (structural thresholds only, no LLM provider).
3. Running `runInit({ plan: true, quiet: true })` against the disposable copy using the same walker, parser, indexer, AST symbol extraction, `loadConfig`, and unique → split → partition planner as batch.
4. Auditing the resulting partition (exact `plan.filePaths` partition + unique module IDs), and writing `modules.json` and `NOTES.md` under `docs/benchmarks/2026-07-10-minimax-m3/offline-inventory-t0/`.

No LLM, no paid API, no clean v3 batch. The disposable copy is removed on exit.

### `importDist(relFromRoot)`

Resolves a path relative to the repo root and dynamically `import()`s the corresponding built artifact (e.g. `packages/core/dist/init.js`). Used to load `runInit`, `openIndex`, `applyDefaults`, `CONFIG_DEFAULTS`, `assertExactPathPartition`, `assertUniqueModuleIds`, and `normalizeSplitLimits` from the compiled `@livewiki/core` distribution.

### `copyWorkingTree(srcRoot, destRoot)`

Recursively copies `srcRoot` into `destRoot`, skipping directories whose basename is in the skip set. It creates directories and copies files as it goes, ensuring `destRoot` mirrors `srcRoot` (minus the ignored directories) before the disposable run.

## Tree walker and extension tallies

<!-- lw:anchors scripts/offline-inventory-t0.mjs#walk scripts/offline-inventory-t0.mjs#tallyExtensions -->

### `walk(relPosix)`

The recursive file walker used inside `copyWorkingTree`. It starts at `srcRoot` when called with `""` and descends into each non-skipped child, calling itself with a POSIX-style `relPosix` for subdirectories. For each file it ensures the destination directory exists and copies the file via `cpSync`. Files whose `statSync` throws are silently skipped.

### `tallyExtensions(paths)`

Buckets a list of paths by their final extension (treating paths with no `.` as the literal extension `"(none)"`). Used twice in the output — once over `plan.filePaths` (the symbol-bearing partition base) and once over `filesTableActive` (all active rows from the `files` table) — so the two extension distributions can be compared side-by-side.