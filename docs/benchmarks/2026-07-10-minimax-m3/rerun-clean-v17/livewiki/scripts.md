---
title: scripts/offline-inventory-t0.mjs
owner: generated
anchors:
  - scripts/offline-inventory-t0.mjs#importDist
  - scripts/offline-inventory-t0.mjs#copyWorkingTree
  - scripts/offline-inventory-t0.mjs#walk
  - scripts/offline-inventory-t0.mjs#tallyExtensions
---

# scripts/offline-inventory-t0.mjs

T0 offline module inventory driver. Copies the livewiki working tree into a
disposable directory, writes a plan-only config, runs `runInit({ plan: true })`
against the copy, and audits the resulting partition. No LLM provider and no
paid batch are involved.

## Dynamic import helper
<!-- lw:anchors scripts/offline-inventory-t0.mjs#importDist -->

`importDist(relFromRoot)` resolves a path relative to the package root and
returns the dynamic `import()` promise for that URL. It is used to pull in
`runInit`, `openIndex`, `applyDefaults`, `CONFIG_DEFAULTS`, and the partition /
split-limit asserts from the compiled `@livewiki/core` dist.

```js
function importDist(relFromRoot) {
  return import(pathToFileURL(join(root, relFromRoot)).href);
}
```

## Working-tree copy
<!-- lw:anchors scripts/offline-inventory-t0.mjs#copyWorkingTree -->

`copyWorkingTree(srcRoot, destRoot)` materialises a disposable mirror of the
working tree under `destRoot`. It creates the destination directory and then
delegates traversal to the inner `walk` helper, skipping the directories listed
in `SKIP_DIR_NAMES` (`node_modules`, `.git`, `.livewiki`, `livewiki`, `dist`,
`coverage`, `.codegraph`). Files are copied via `cpSync`; missing `stat`
entries are tolerated by skipping them.

```js
function copyWorkingTree(srcRoot, destRoot) {
  mkdirSync(destRoot, { recursive: true });
  walk("");
}
```

### Recursive walker
<!-- lw:anchors scripts/offline-inventory-t0.mjs#walk -->

`walk(relPosix)` is the inner recursive traversal used by `copyWorkingTree`. It
takes a POSIX-style relative path (the empty string means the source root),
reads each entry, skips configured directory names, recreates directories under
the destination, and copies regular files. `walk` is defined inside
`copyWorkingTree` and is not exported.

```js
function walk(relPosix) {
  const abs = relPosix ? join(srcRoot, ...relPosix.split("/")) : srcRoot;
  // ... recurses into childRel for directories, cpSync for files
  walk(childRel);
}
```

## Extension tally
<!-- lw:anchors scripts/offline-inventory-t0.mjs#tallyExtensions -->

`tallyExtensions(paths)` reduces a list of file paths to a histogram keyed by
extension. Paths with no `.` segment are bucketed under the literal key
`"(none)"`. It is applied twice in the script: once over the planner's
symbol-bearing file paths and once over the active files table.

```js
function tallyExtensions(paths) {
  const t = {};
  for (const p of paths) {
    const i = p.lastIndexOf(".");
    const ext = i >= 0 ? p.slice(i) : "(none)";
    t[ext] = (t[ext] ?? 0) + 1;
  }
  return t;
}
```