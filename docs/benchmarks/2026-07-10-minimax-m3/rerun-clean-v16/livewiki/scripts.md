---
title: scripts/offline-inventory-t0.mjs
owner: generated
anchors:
  - scripts/offline-inventory-t0.mjs#copyWorkingTree
  - scripts/offline-inventory-t0.mjs#importDist
  - scripts/offline-inventory-t0.mjs#tallyExtensions
  - scripts/offline-inventory-t0.mjs#walk
---

## Module helper: ESM dynamic import

<!-- lw:anchors scripts/offline-inventory-t0.mjs#importDist -->

`importDist(relFromRoot)` resolves a path relative to the repository root (one level above `scripts/`) and dynamically imports it via `pathToFileURL(...).href`. The script uses it at top level to load the prebuilt core entry points: `packages/core/dist/init.js` (`runInit`), `packages/core/dist/db.js` (`openIndex`), `packages/core/dist/config.js` (`applyDefaults`, `CONFIG_DEFAULTS`), and `packages/core/dist/modules.js` (`assertExactPathPartition`, `assertUniqueModuleIds`, `normalizeSplitLimits`). Because the imports are `await import(...)` at module top level, the script requires the core package to be built (`pnpm --filter @livewiki/core build`) before it can run.

## Working-tree copy

<!-- lw:anchors scripts/offline-inventory-t0.mjs#copyWorkingTree scripts/offline-inventory-t0.mjs#walk -->

`copyWorkingTree(srcRoot, destRoot)` materializes a disposable mirror of the working tree. It creates `destRoot` recursively, then drives an inner recursive `walk(relPosix)` (declared inside `copyWorkingTree`, which is the closed-list anchor for `walk`). The walker lists each entry under `srcRoot`/`relPosix`, skips a fixed set of directories (`SKIP_DIR_NAMES`: `node_modules`, `.git`, `.livewiki`, `livewiki`, `dist`, `coverage`, `.codegraph`), re-stats each remaining child defensively with `try { statSync } catch { continue }`, creates the matching destination directory, and copies regular files via `cpSync` (creating the parent on demand with `mkdirSync(dirname(destPath), { recursive: true })`). It seeds recursion with `walk("")` so the first call enumerates the root directly. The script uses this to populate a `mkdtempSync` directory under `tmpdir()` before rewriting `.livewiki/config.json` and calling `runInit({ plan: true })`; the disposable tree is `rmSync`d in `finally`.

## Inventory aggregation

<!-- lw:anchors scripts/offline-inventory-t0.mjs#tallyExtensions -->

`tallyExtensions(paths)` returns a plain object mapping each path's extension (the substring after the last `.`, or the literal `"(none)"` for files without one) to the number of times it appears. The script calls it twice when assembling the `inventory` block of `modules.json`: once over `planPaths` (the planner's symbol-bearing inventory) and once over `filesTablePaths` (the SQLite `files` table), and the two resulting maps are emitted as `extensionsPlan` and `extensionsFilesTable`.