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

The T0 offline inventory script snapshots the livewiki working tree into a disposable directory, runs the real `runInit({ plan: true })` pipeline (walker, parser, AST symbol extraction, config, planner) against that copy, then audits the resulting partition and writes `modules.json` and `NOTES.md` under `docs/benchmarks/.../offline-inventory-t0/`. It uses no LLM and no paid batch — it is a structural self-check.

## Import helper
<!-- lw:anchors scripts/offline-inventory-t0.mjs#importDist -->

`importDist(relFromRoot)` resolves a path relative to the repo root (one directory above this script) into a `file://` URL and dynamically `import()`s the compiled artifact. All four `@livewiki/core` runtime pieces consumed by this script — `init.js`, `db.js`, `config.js`, and `modules.js` — are pulled in via this single helper.

```js
function importDist(relFromRoot) {
  return import(pathToFileURL(join(root, relFromRoot)).href);
}
```

## Working-tree snapshot
<!-- lw:anchors scripts/offline-inventory-t0.mjs#copyWorkingTree -->

`copyWorkingTree(srcRoot, destRoot)` mirrors the working tree into a disposable destination while skipping common noise directories: `node_modules`, `.git`, `.livewiki`, `livewiki`, `dist`, `coverage`, and `.codegraph`. Files are copied verbatim; missing entries that throw from `statSync` are silently skipped rather than aborting the snapshot.

## Recursive file walker
<!-- lw:anchors scripts/offline-inventory-t0.mjs#walk -->

`walk(relPosix)` is the inner recursive helper of `copyWorkingTree`. It descends `srcRoot` entry by entry, honoring the same skip set, creating each target directory before recursing, and copying every regular file into the corresponding position under `destRoot`. The empty-string initial call (`walk("")`) makes `relPosix` optional at the root.

## Extension tally
<!-- lw:anchors scripts/offline-inventory-t0.mjs#tallyExtensions -->

`tallyExtensions(paths)` returns a `Record<string, number>` mapping each file extension (including a literal `"(none)"` bucket for pathless-extension entries) to its occurrence count. The script uses it twice — once over the plan-bear/`AST`-bearing inventory, once over the `files` table — so the resulting counts can be compared directly in the emitted `NOTES.md`.