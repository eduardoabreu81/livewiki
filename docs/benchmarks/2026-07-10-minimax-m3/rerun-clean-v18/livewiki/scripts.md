---
title: scripts/offline-inventory-t0.mjs
owner: generated
anchors:
  - scripts/offline-inventory-t0.mjs#importDist
  - scripts/offline-inventory-t0.mjs#copyWorkingTree
  - scripts/offline-inventory-t0.mjs#walk
  - scripts/offline-inventory-t0.mjs#tallyExtensions
---

## Overview

`scripts/offline-inventory-t0.mjs` is the T0 offline module-inventory entry point. It copies the livewiki working tree into a disposable directory, writes a plan-only config (structural thresholds, no LLM provider), then runs `runInit({ plan: true })` — the same walker, parser, indexer, AST symbol extraction, `loadConfig`, and unique→split→partition pipeline used by batch. The resulting `modules.json` and `NOTES.md` are written under `docs/benchmarks/2026-07-10-minimax-m3/offline-inventory-t0/`. No LLM or paid API is used.

The script imports its dependencies from `packages/core/dist/*.js` via a small dynamic-import helper, mirroring the same build artefacts that batch consumes.

## Dynamic import helper
<!-- lw:anchors scripts/offline-inventory-t0.mjs#importDist -->

`importDist(relFromRoot)` resolves a path relative to the repository root and returns a `Promise` of the corresponding ES module. It is implemented as `import(pathToFileURL(join(root, relFromRoot)).href)`, so callers can `await importDist("packages/core/dist/init.js")` without dealing with `file://` URL conversion. All `@livewiki/core` dependencies in this script (`init`, `db`, `config`, `modules`) are pulled through this helper, which keeps the path-from-root convention explicit and OS-portable.

## Working-tree copier
<!-- lw:anchors scripts/offline-inventory-t0.mjs#copyWorkingTree scripts/offline-inventory-t0.mjs#walk -->

`copyWorkingTree(srcRoot, destRoot)` materialises a disposable copy of the source tree. It creates `destRoot` (recursively), then delegates to the inner `walk(relPosix)` function. `walk` iterates `readdirSync` entries, skipping a fixed `SKIP_DIR_NAMES` set that contains `node_modules`, `.git`, `.livewiki`, `livewiki`, `dist`, `coverage`, and `.codegraph`; entries whose `statSync` fails are silently skipped. Directories are `mkdirSync`-created and recursed into; files are copied with `cpSync` after ensuring the parent directory exists. The recursion starts from an empty relative path so the root name is not prepended. This is the only consumer of `walk` in the file.

## Extension tally
<!-- lw:anchors scripts/offline-inventory-t0.mjs#tallyExtensions -->

`tallyExtensions(paths)` returns an object mapping each file extension to the number of paths that end with it. The extension is taken as the substring after the last `.` in each path; paths without a dot contribute to the synthetic key `"(none)"`. It is used twice in the final report — once over the plan file paths and once over the files-table active paths — so the resulting `summary.inventory.extensionsPlan` and `summary.inventory.extensionsFilesTable` keys are produced by this same function.