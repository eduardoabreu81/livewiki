---
title: scripts/offline-inventory-t0.mjs
owner: generated
anchors:
  - scripts/offline-inventory-t0.mjs#copyWorkingTree
  - scripts/offline-inventory-t0.mjs#importDist
  - scripts/offline-inventory-t0.mjs#tallyExtensions
  - scripts/offline-inventory-t0.mjs#walk
---

# scripts/offline-inventory-t0.mjs

T0 offline module inventory script. It snapshots the working tree into a
disposable directory, runs the real `runInit({ plan: true })` pipeline
(walker, parser, indexer, AST symbol extraction, config loading, and the
unique → split → exact-partition → unique planner), then audits the resulting
plan and writes `modules.json` plus a human-readable `NOTES.md`. No LLM
provider, no paid batch, and no synthetic one-symbol-per-file walk.

Entrypoint usage from the repo root, after `pnpm --filter @livewiki/core build`:

```
node scripts/offline-inventory-t0.mjs
```

## Internal loaders and helpers
<!-- lw:anchors scripts/offline-inventory-t0.mjs#importDist scripts/offline-inventory-t0.mjs#tallyExtensions -->

These helpers underpin the script: dynamic ESM imports of compiled
`packages/core/dist/*` modules, and a tally used by the inventory summary.

`importDist(relFromRoot)` resolves a path relative to the repository root and
dynamically imports it as an ES module via `pathToFileURL`. It is used to pull
in `init.js`, `db.js`, `config.js`, and `modules.js` from `packages/core/dist`.

`tallyExtensions(paths)` reduces a list of repository-relative paths to a
plain object mapping file extension (including the leading `.`, or the
literal `"(none)"` for paths without an extension) to its occurrence count.
The result is written into both `extensionsPlan` and `extensionsFilesTable`
of the summary.

## Working-tree snapshot
<!-- lw:anchors scripts/offline-inventory-t0.mjs#copyWorkingTree scripts/offline-inventory-t0.mjs#walk -->

The script needs a clean, disposable copy of the repository so that the
planner can be exercised without touching the developer's working tree.

`copyWorkingTree(srcRoot, destRoot)` materializes such a copy under a
`mkdtempSync` directory. It `mkdirSync`s `destRoot`, then recurses through the
source tree, skipping a fixed `SKIP_DIR_NAMES` set
(`node_modules`, `.git`, `.livewiki`, `livewiki`, `dist`, `coverage`,
`.codegraph`). Directories are recreated and files are copied with
`cpSync`, preserving relative layout.

`walk(relPosix)` is the inner recursive iterator used by `copyWorkingTree`.
Starting from the empty POSIX-relative path `""`, it `readdirSync`s each
level, computes the next child relative segment, and for each entry either
recurses (directory) or copies the file (file). `statSync` failures on a
given entry are swallowed and that entry is skipped, so a single unreadable
node does not abort the snapshot.