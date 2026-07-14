---
title: scripts
owner: generated
anchors:
  - scripts/offline-inventory-t0.mjs#importDist
  - scripts/offline-inventory-t0.mjs#copyWorkingTree
  - scripts/offline-inventory-t0.mjs#walk
  - scripts/offline-inventory-t0.mjs#tallyExtensions
---

# scripts/offline-inventory-t0.mjs

T0 offline module inventory entrypoint. The script copies the current livewiki working tree into a disposable temporary directory, writes a plan-only config (no LLM provider), invokes `runInit({ plan: true })`, audits partition/uniqueness/caps/unsplittable counts, and emits `modules.json` plus a human-readable `NOTES.md` under `docs/benchmarks/2026-07-10-minimax-m3/offline-inventory-t0/`.

It is executed from the repo root after `pnpm --filter @livewiki/core build`, with the working-tree copy removed in a `finally` block. Imports from `@livewiki/core` are resolved against the repo's compiled `dist` artefacts.

## Module-loading helpers
<!-- lw:anchors scripts/offline-inventory-t0.mjs#importDist -->

`importDist(relFromRoot)` is a thin dynamic import helper. It takes a path expressed relative to the repository root (e.g. `packages/core/dist/init.js`) and converts it to a `file://` URL anchored at the resolved repo root, then performs a dynamic `import()` against that URL. The module top-level uses it to pull `runInit` from `packages/core/dist/init.js`, `openIndex` from `packages/core/dist/db.js`, `applyDefaults` and `CONFIG_DEFAULTS` from `packages/core/dist/config.js`, and `assertExactPathPartition`, `assertUniqueModuleIds`, and `normalizeSplitLimits` from `packages/core/dist/modules.js`.

## Working-tree copy
<!-- lw:anchors scripts/offline-inventory-t0.mjs#copyWorkingTree scripts/offline-inventory-t0.mjs#walk -->

`copyWorkingTree(srcRoot, destRoot)` materialises a disposable mirror of the livewiki source surface. It starts by creating `destRoot`, then delegates to the nested `walk` helper starting with an empty relative path. Names inside `SKIP_DIR_NAMES` (`node_modules`, `.git`, `.livewiki`, `livewiki`, `dist`, `coverage`, `.codegraph`) are skipped, so the copy stays free of build artefacts, vcs metadata, prior livewiki state, and benchmark/coverage outputs.

`walk(relPosix)` is the recursive inner routine. It resolves the current absolute directory from `relPosix` (using `srcRoot` when `relPosix` is empty), reads its entries, and dispatches per entry. For each non-skipped child it tries `statSync`; entries whose stat fails are silently skipped. Directories are recreated under `destRoot` and recursed into; files have their parent directories ensured and are copied with `cpSync`. The walk is purely filesystem-driven and never touches the livewiki index.

## Inventory aggregation
<!-- lw:anchors scripts/offline-inventory-t0.mjs#tallyExtensions -->

`tallyExtensions(paths)` is a small reducer that turns a list of file paths into an extension → count map. It splits each path on the last `.`, uses `"(none)"` when no extension is present, and increments the corresponding bucket. The main flow calls it twice — once over `planPaths` (the partition base) and once over `filesTablePaths` (the full `files` table) — and stores both breakdowns under `summary.inventory.extensionsPlan` and `summary.inventory.extensionsFilesTable`.