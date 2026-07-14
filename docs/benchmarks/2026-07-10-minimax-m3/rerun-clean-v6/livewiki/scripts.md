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

T0 offline module inventory script. Copies the current livewiki working tree
into a disposable directory, drives the real `runInit({ plan: true })`
pipeline (walker, parser, indexer, AST symbols, `loadConfig`, unique →
split → exact-partition → unique planner), then audits the resulting
partition against the symbol-bearing path set and writes `modules.json`
plus `NOTES.md` into the output directory.

No LLM, no paid API, no synthetic 1-symbol-per-file walk.

## Entry-helpers

<!-- lw:anchors scripts/offline-inventory-t0.mjs#importDist -->

### `importDist(relFromRoot)`

Resolves a path relative to the repository root (`root`, computed from
`import.meta.url`) and dynamically imports the built `@livewiki/core`
artifact via `pathToFileURL(...)`. Returns the imported module namespace.

Used at module top-level to load `runInit`, `openIndex`, `applyDefaults`,
`CONFIG_DEFAULTS`, `assertExactPathPartition`,
`assertUniqueModuleIds`, and `normalizeSplitLimits` from
`packages/core/dist/*.js`.

## Tree cloning

<!-- lw:anchors scripts/offline-inventory-t0.mjs#copyWorkingTree scripts/offline-inventory-t0.mjs#walk -->

### `copyWorkingTree(srcRoot, destRoot)`

Recursively copies `srcRoot` into `destRoot`, skipping a fixed set of
non-source directory names:

- `node_modules`
- `.git`
- `.livewiki`
- `livewiki`
- `dist`
- `coverage`
- `.codegraph`

Directories are created on demand under `destRoot`; files are copied with
`cpSync`. The traversal is performed by the inner `walk(relPosix)`
function, which receives a POSIX-style relative path (empty string means
"start at `srcRoot`").

#### `walk(relPosix)` (inner)

Recursive helper used by `copyWorkingTree`. For each entry under
`abs = relPosix ? join(srcRoot, ...relPosix.split("/")) : srcRoot`:

- Skip when `SKIP_DIR_NAMES.has(name)`.
- `statSync` failures are swallowed (`continue`).
- Directories → `mkdirSync(destPath, { recursive: true })` then
  `walk(childRel)` with the child path extended by one segment.
- Files → ensure `dirname(destPath)` exists and `cpSync(from, destPath)`.

Always invoked with `walk("")` to start from `srcRoot`.

## Path accounting

<!-- lw:anchors scripts/offline-inventory-t0.mjs#tallyExtensions -->

### `tallyExtensions(paths)`

Reduces an iterable of path strings to a frequency map keyed by the
substring from the last `.` onward. Files without a `.` are bucketed
under the key `"(none)"`. Used twice in the summary:

- `extensionsPlan` — extension counts over the symbol-bearing plan path
  set.
- `extensionsFilesTable` — extension counts over the active `files`
  table rows.

### Top-level flow (informational)

1. Create a temp working copy via `mkdtempSync` and `copyWorkingTree`.
2. Write a plan-only `.livewiki/config.json` seeded from
   `CONFIG_DEFAULTS` (structural thresholds only).
3. Invoke `runInit({ repoRoot: disposable, plan: true, quiet: true })`
   and confirm `result.plan` is set.
4. Re-read the on-disk config with `applyDefaults`, derive split limits
   via `normalizeSplitLimits`.
5. `openIndex` the disposable `index.db`; query `files` (active) and
   tally per-path active-symbol counts from `symbols` (active). Close
   the DB before any further work.
6. Derive `planPaths` = distinct paths from active symbols (the
   authoritative planner inventory, matching the batch contract),
   plus `filesTablePaths` and the diff
   `filesNotInPlanInventory`.
7. Audit with `assertExactPathPartition(modules, planPaths)` and
   `assertUniqueModuleIds(modules)`, capturing `partitionError` /
   `uniqueError` on failure.
8. Build the `summary` object (caps, inventory, audits, plan paths,
   per-file table, per-module lists, ordered IDs, edge count) and
   serialize it as `docs/.../modules.json`, then write a human-readable
   `NOTES.md` companion.
9. Always remove the disposable copy in `finally`; failures are warned
   to `stderr` and do not mask the run's exit status.
10. Exit non-zero only when the partition or uniqueness audits fail.