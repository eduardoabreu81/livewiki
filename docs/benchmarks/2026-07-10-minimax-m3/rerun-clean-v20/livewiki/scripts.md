---
title: T0 offline module inventory script
owner: generated
anchors:
  - scripts/offline-inventory-t0.mjs#copyWorkingTree
  - scripts/offline-inventory-t0.mjs#importDist
  - scripts/offline-inventory-t0.mjs#tallyExtensions
  - scripts/offline-inventory-t0.mjs#walk
---

# T0 offline module inventory script

This page documents a benchmark/inventory script that reproduces the real index-and-plan pipeline offline against a disposable copy of the working tree.

## When to use this page

- **Run** the script to regenerate `docs/benchmarks/2026-07-10-minimax-m3/offline-inventory-t0/modules.json` after a `@livewiki/core` build.
- **Audit** the partition/unique/caps invariants that the planner must satisfy against `plan.filePaths`.
- **Inspect** the two helper functions (`copyWorkingTree`/`walk`, `importDist`, `tallyExtensions`) when changing the inventory methodology.
- **Compare** extension tallies between the symbol-bearing `plan.filePaths` inventory and the raw active `files` table.

## How it fits

The script lives at `scripts/offline-inventory-t0.mjs` and is a sibling of other repo-level Node tools. It does not live inside `@livewiki/core`; instead, it imports the already-built `packages/core/dist/*` artifacts and calls `runInit({ plan: true, quiet: true })` against a throwaway directory under `os.tmpdir()`. The output is benchmark material under `docs/benchmarks/2026-07-10-minimax-m3/offline-inventory-t0/`, not product code. The script deliberately avoids any LLM/paid batch and is not a substitute for the production batch indexer.

## Disposable copy and recursive walker

<!-- lw:anchors scripts/offline-inventory-t0.mjs#copyWorkingTree scripts/offline-inventory-t0.mjs#walk -->

The script first materialises a clean copy of the working tree, skipping well-known noise directories, then drives `runInit` against it. The recursive walker is the only tree-traversal primitive in this file; everything else reuses core exports.

`copyWorkingTree(srcRoot, destRoot)` is defined as:

```js
function copyWorkingTree(srcRoot, destRoot) {
```

It `mkdirSync`s `destRoot`, then delegates the traversal to the inner `walk`. Each non-skipped entry under `srcRoot` is either `mkdirSync`'d (for directories) or copied with `cpSync` after ensuring its parent exists. `walk` is the inner recursive helper defined as:

```js
function walk(relPosix) {
```

`walk` resolves `abs` relative to `srcRoot`, iterates `readdirSync(abs)`, filters against `SKIP_DIR_NAMES`, and recurses for directories or copies files. Note that `walk` uses a try/catch around `statSync`: if `statSync` throws for a given entry (for example a vanished symlink), the entry is silently skipped via `continue`. This means `copyWorkingTree` does not abort on transient stat failures — it proceeds with the remaining entries.

## Importing built core artifacts

<!-- lw:anchors scripts/offline-inventory-t0.mjs#importDist -->

Because the script runs against the already-built `@livewiki/core` package, every `packages/core/dist/*` import goes through a single helper that converts a repo-relative path into a `file://` URL rooted at the repo root.

`importDist(relFromRoot)` is defined as:

```js
function importDist(relFromRoot) {
```

It returns `import(pathToFileURL(join(root, relFromRoot)).href)`. The module-level `root` is computed once from `import.meta.url` as `dirname(fileURLToPath(import.meta.url))` joined with `".."`. All four core imports (`init.js`, `db.js`, `config.js`, `modules.js`) are loaded through this helper via top-level `await`.

## Extension tallies and inventory reporting

<!-- lw:anchors scripts/offline-inventory-t0.mjs#tallyExtensions -->

After `runInit` returns, the script distinguishes two path sets: `plan.filePaths` (symbol-bearing inventory — the partition base, matching the batch contract) and the raw active `files` table from `openIndex`. Both are fed into `tallyExtensions` for an extension histogram.

`tallyExtensions(paths)` is defined as:

```js
function tallyExtensions(paths) {
```

It returns a plain object `t` keyed by extension string. For each path `p`, it locates the last `.` with `lastIndexOf(".")`, slices from that index as the extension, and increments `t[ext]` (defaulting missing entries to `0` via `??`). Paths with no `.` map to the literal key `"(none)"`. The result feeds `summary.inventory.extensionsPlan` and `summary.inventory.extensionsFilesTable` directly.

The script's audit block also asserts, via try/catch, that `assertExactPathPartition(modules, planPaths)` and `assertUniqueModuleIds(modules)` both pass; if either throws, the caught message is recorded and `process.exitCode` is set to `1` before the `finally` cleans up the disposable copy. The `finally` block itself wraps `rmSync` in a try/catch and only logs a warning on failure — so a cleanup error never masks the audit result.

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
<!-- livewiki:navigate:end -->
