---
title: scripts
owner: generated
anchors:
  - scripts/offline-inventory-t0.mjs#copyWorkingTree
  - scripts/offline-inventory-t0.mjs#importDist
  - scripts/offline-inventory-t0.mjs#tallyExtensions
  - scripts/offline-inventory-t0.mjs#walk
---

# scripts/offline-inventory-t0.mjs

T0 offline module inventory using the **real** `runInit({ plan: true })` path (same walker, parser, indexer, AST symbol extraction, `loadConfig`, and unique → split → exact-partition → unique planner as the batch flow). The script copies the working tree into a disposable directory, writes a plan-only config with structural thresholds, audits the resulting partition/uniqueness/caps/unsplittable output, and writes `modules.json` plus a Markdown summary. It does not call any LLM or paid API.

Usage (from repo root, after `pnpm --filter @livewiki/core build`):

```
node scripts/offline-inventory-t0.mjs
```

## Dynamic import helper

<!-- lw:anchors scripts/offline-inventory-t0.mjs#importDist -->

`importDist(relFromRoot)` resolves a path relative to the repository root and dynamic-imports the corresponding ESM file. It underpins all imports from the built `packages/core/dist/*` artifacts used by the script:

- `packages/core/dist/init.js` — for `runInit`.
- `packages/core/dist/db.js` — for `openIndex`.
- `packages/core/dist/config.js` — for `applyDefaults` and `CONFIG_DEFAULTS`.
- `packages/core/dist/modules.js` — for `assertExactPathPartition`, `assertUniqueModuleIds`, and `normalizeSplitLimits`.

The implementation converts the relative path to an absolute POSIX path via `pathToFileURL(join(root, relFromRoot)).href` and forwards it to `import()`.

## Working tree copy

<!-- lw:anchors scripts/offline-inventory-t0.mjs#copyWorkingTree -->

`copyWorkingTree(srcRoot, destRoot)` creates `destRoot` (recursive), then recursively replicates the working tree from `srcRoot` while skipping known noisy directories:

- `node_modules`, `.git`, `.livewiki`, `livewiki`, `dist`, `coverage`, `.codegraph`.

For each non-skipped entry under the current directory it stats the source path (entries that error during `statSync` are silently skipped), creates the corresponding directory in the destination tree, and copies files with `cpSync`. The recursive descent is delegated to the inner `walk` (see below). The copy is the surface on which `runInit({ plan: true })` is later run.

## Recursive directory walk

<!-- lw:anchors scripts/offline-inventory-t0.mjs#walk -->

`walk(relPosix)` is the inner recursive helper used by `copyWorkingTree`. The argument is a POSIX-style relative path; an empty string denotes the `srcRoot` itself. For each directory entry under the current absolute path:

- Skip if the entry name is in `SKIP_DIR_NAMES`.
- Resolve the source path and compute the child relative path (forward-slash joined).
- `statSync` the source; on error, skip silently.
- If the entry is a directory, `mkdirSync` the destination and recurse with the new relative path.
- If it is a file, ensure the destination directory exists and `cpSync` the file.

The walk does not follow symlinks beyond what `statSync` reports and never operates on `srcRoot` itself when its name is a skip entry.

## Extension tally

<!-- lw:anchors scripts/offline-inventory-t0.mjs#tallyExtensions -->

`tallyExtensions(paths)` returns a plain object mapping each file extension (suffix after the last `.` in the path, or the literal `"(none)"` for paths without a dot) to the number of times it occurs across `paths`. It is used twice in the audit summary:

- `extensionsPlan` — over `plan.filePaths` (distinct paths from active AST symbols).
- `extensionsFilesTable` — over all active rows in the `files` table.

## Pipeline summary

The top-level script:

1. Creates a disposable temp root via `mkdtempSync(join(tmpdir(), "livewiki-t0-inv-"))` and ensures `outDir = docs/benchmarks/2026-07-10-minimax-m3/offline-inventory-t0` exists.
2. Calls `copyWorkingTree(root, disposable)` to materialize the working tree.
3. Writes `.livewiki/config.json` with `language: "en"` and the four `CONFIG_DEFAULTS` caps (`maxModuleFiles`, `maxModuleSymbols`, `stage4MaxOutputTokens`, `maxRepairAttempts`); no LLM provider is configured.
4. Runs `runInit({ repoRoot: disposable, plan: true, quiet: true })`; aborts if no plan is returned.
5. Re-loads the config via `applyDefaults(...)` and normalizes the split limits via `normalizeSplitLimits(...)`.
6. Opens `disposable/.livewiki/index.db` with `openIndex(...)`, reads active `files` rows (`path`, `lang`, `size`) and active `symbols` rows to derive a `symbolCountByPath` map keyed by the path portion of each symbol key.
7. Computes `planPaths` (distinct paths from active symbols, sorted) and diffs them against `filesTablePaths` to classify zero-symbol files and files absent from the planner inventory.
8. Audits `assertExactPathPartition(modules, planPaths)` and `assertUniqueModuleIds(modules)`; sets `process.exitCode = 1` if either fails.
9. Builds a `summary` object (method, caps, inventory, audits, `planFilePaths`, per-file AST counts, modules, `orderedIds`, edge count), writes `modules.json`, and writes a human-readable `NOTES.md` that includes cap tables, audit tables, and the per-module `id × files × symbols` listing.
10. Prints a concise JSON line on stdout summarising output dir, plan/files-table counts, audit results, extension tallies, and per-module counts.
11. In `finally`, removes the disposable copy (warnings are emitted on failure rather than thrown).

## Inputs and outputs

- **Input surface:** the repository working tree, root const resolved as `dirname(fileURLToPath(import.meta.url))/..`.
- **Config written:** `.livewiki/config.json` inside the disposable copy (removed after run).
- **Outputs (under `outDir`):** `modules.json` (full machine-readable summary) and `NOTES.md` (Markdown report with cap and audit tables).
- **Reproduce:** `pnpm --filter @livewiki/core build && node scripts/offline-inventory-t0.mjs`.

## Notes

- The partition contract being audited is **exact partition over `plan.filePaths`** (distinct paths from active AST symbols), matching the batch flow. Walked files with zero extractable symbols appear in the `files` table but are intentionally outside the plan contract and are reported under `filesNotInPlanInventory` (and `filesWithZeroSymbols`).
- TODO: source surface clean v3 — this script is the T0 plane; clean v3 batch documentation lives elsewhere.