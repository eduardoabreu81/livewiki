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

T0 offline module inventory. Copies the current working tree into a disposable
directory, writes a plan-only config, runs `runInit({ plan: true })` against the
copy, then audits partition, uniqueness, caps, and unsplittable modules before
emitting `modules.json` and `NOTES.md`. No LLM and no paid batch are involved.

## importDist
<!-- lw:anchors scripts/offline-inventory-t0.mjs#importDist -->

`importDist(relFromRoot)` resolves a path relative to the repository root and
dynamically `import()`s the corresponding built ESM file via `pathToFileURL`.
It is used to load the compiled `dist` artifacts of `@livewiki/core`
(`init.js`, `db.js`, `config.js`, `modules.js`) without going through package
resolution.

```js
function importDist(relFromRoot) {
  return import(pathToFileURL(join(root, relFromRoot)).href);
}
```

## copyWorkingTree
<!-- lw:anchors scripts/offline-inventory-t0.mjs#copyWorkingTree -->

`copyWorkingTree(srcRoot, destRoot)` mirrors the livewiki working tree into a
throwaway directory. It `mkdirSync`s the destination, then recursively walks
`srcRoot` and copies each file with `cpSync`, recreating directory layout.
Directories in the `SKIP_DIR_NAMES` set (`node_modules`, `.git`, `.livewiki`,
`livewiki`, `dist`, `coverage`, `.codegraph`) are skipped so the inventory does
not include build output or VCS metadata.

```js
function copyWorkingTree(srcRoot, destRoot) {
  mkdirSync(destRoot, { recursive: true });
  walk("");
}
```

## walk
<!-- lw:anchors scripts/offline-inventory-t0.mjs#walk -->

`walk(relPosix)` is the inner recursive helper used by `copyWorkingTree`. It
takes a POSIX-style relative path (empty string at the root), iterates
`readdirSync`, filters `SKIP_DIR_NAMES`, stats each entry, and either recurses
into directories or copies regular files into the destination tree. Entries
that fail `statSync` are silently skipped.

```js
function walk(relPosix) {
  const abs = relPosix ? join(srcRoot, ...relPosix.split("/")) : srcRoot;
  // ...recurse or cpSync per entry...
}
```

## tallyExtensions
<!-- lw:anchors scripts/offline-inventory-t0.mjs#tallyExtensions -->

`tallyExtensions(paths)` returns a plain object whose keys are file extensions
(`(none)` for paths without a `.`) and whose values are occurrence counts. It
is used twice in the emitted summary: once over the planner's `plan.filePaths`
(symbol-bearing inventory) and once over the `files` table's active rows, so
the two surfaces can be compared.

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

## Workflow summary

1. `mkdtempSync` creates `livewiki-t0-inv-*` under `os.tmpdir()`; this is the
   disposable copy target.
2. `copyWorkingTree(root, disposable)` mirrors the working tree there.
3. A plan-only `config.json` is written under the disposable `.livewiki/`
   directory using `CONFIG_DEFAULTS` for `maxModuleFiles`, `maxModuleSymbols`,
   `stage4MaxOutputTokens`, and `maxRepairAttempts`.
4. `runInit({ repoRoot: disposable, plan: true, quiet: true })` produces the
   module plan; the script then opens `index.db`, pulls active `files` and
   `symbols`, and computes `planPaths` as the distinct paths appearing on
   active symbols (matching the batch contract).
5. `assertExactPathPartition` and `assertUniqueModuleIds` validate the plan;
   either failure sets `process.exitCode = 1`.
6. `modules.json` (machine-readable) and `NOTES.md` (human-readable) are
   written under `docs/benchmarks/2026-07-10-minimax-m3/offline-inventory-t0/`.
7. The disposable tree is removed in a `finally` block; a warning is logged
   if removal fails.

## Notes

- TODO: confirm whether `disposableRootNote` should also note that any
  `node_modules` produced by an in-tree postinstall would have been skipped
  by the `SKIP_DIR_NAMES` filter.
- TODO: extend `tallyExtensions` callers if `.cjs` should be surfaced as a
  plan-side bucket rather than only a files-table flag.
- The script does **not** invoke clean v3 and does **not** call any paid API.