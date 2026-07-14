---
title: src-modules-ts
owner: generated
anchors:
  - packages/core/src/modules.ts#DuplicateModuleIdError
  - packages/core/src/modules.ts#DuplicateModuleIdError.constructor
  - packages/core/src/modules.ts#MODULE_SPLIT_DEFAULTS
  - packages/core/src/modules.ts#assertUniqueModuleIds
  - packages/core/src/modules.ts#candidateIdSequence
  - packages/core/src/modules.ts#countSymbols
  - packages/core/src/modules.ts#dirToModuleId
  - packages/core/src/modules.ts#fileStem
  - packages/core/src/modules.ts#groupPathsByNextSegment
  - packages/core/src/modules.ts#identifyModulesHeuristic
  - packages/core/src/modules.ts#makeUniqueDeterministicIds
  - packages/core/src/modules.ts#pathSegmentsFor
  - packages/core/src/modules.ts#pathSlugOf
  - packages/core/src/modules.ts#prioritizeModules
  - packages/core/src/modules.ts#resolveModuleEdges
  - packages/core/src/modules.ts#resolveRelativeImport
  - packages/core/src/modules.ts#slugifyIdSegment
  - packages/core/src/modules.ts#slugifySegment
  - packages/core/src/modules.ts#splitOneModule
  - packages/core/src/modules.ts#splitOversizedModules
  - packages/core/src/modules.ts#stripNodeNextExtension
---

# modules

Stage 2 of the livewiki batch pipeline. Groups repository files into `Module`s using a deterministic directory-based heuristic, splits oversized modules, resolves import edges between modules, and guarantees globally unique module ids before stage 4 page writes.

## Heuristic grouping

<!-- lw:anchors packages/core/src/modules.ts#identifyModulesHeuristic packages/core/src/modules.ts#dirToModuleId -->

`identifyModulesHeuristic(filePaths, symbolCountByPath?)` groups files by top-level directory. For each directory it computes an id via `dirToModuleId`, which returns:

- the file basename (sans extension) when the repository has a single root file,
- `"root"` for an empty directory when other modules also exist,
- the last path segment of the directory otherwise.

The resulting list is sorted by id for deterministic output. Each `Module` carries `id`, `paths`, and `symbolCount` (sum of `symbolCountByPath` entries; defaults to `0` for missing paths).

## Oversized module splitting

<!-- lw:anchors packages/core/src/modules.ts#splitOversizedModules packages/core/src/modules.ts#MODULE_SPLIT_DEFAULTS packages/core/src/modules.ts#splitOneModule packages/core/src/modules.ts#groupPathsByNextSegment packages/core/src/modules.ts#fileStem packages/core/src/modules.ts#slugifyIdSegment packages/core/src/modules.ts#countSymbols -->

`splitOversizedModules(modules, opts?)` enforces the structural limits defined by `MODULE_SPLIT_DEFAULTS`:

- `maxFiles` — split when a module has more files than this.
- `maxSymbols` — split when total symbols exceed this.

Both can be overridden via `SplitOversizedOptions`. For each module, `splitOneModule` first checks the limits (recounting `symbolCount` via `countSymbols` when zero). If exceeded, it tries structural splitting:

1. `groupPathsByNextSegment` finds the longest common directory prefix and groups by the next segment; sub-ids are formed as `${parentId}-${slugifyIdSegment(seg)}`.
2. If still flat (single group), sorted paths are chunked by `maxFiles` and sub-ids are derived from `fileStem(paths[0])`.

`slugifyIdSegment` lowercases, normalizes, strips diacritics, replaces non-word characters with `-`, trims leading/trailing dashes, and truncates to 48 chars (falling back to `"part"` if empty).

Does not guarantee global id uniqueness; call `makeUniqueDeterministicIds` after.

## Import graph edges

<!-- lw:anchors packages/core/src/modules.ts#resolveModuleEdges packages/core/src/modules.ts#resolveRelativeImport packages/core/src/modules.ts#stripNodeNextExtension -->

`resolveModuleEdges(modules, importsByFile, knownFiles)` builds a `file → moduleId` map and, for each `ExtractedImport`, considers only relative imports (`./` or `../`).

`resolveRelativeImport` normalizes the path (`./` and `../` segments), then strips a NodeNext-style extension (`stripNodeNextExtension`: `.js`, `.jsx`, `.mjs`, `.cjs`) and tries candidates:

- the bare base,
- `.ts`, `.tsx`, `.js`, `.jsx`, `.py` extensions,
- barrels: `${base}/index.ts`, `${base}/index.tsx`, `${base}/index.js`, `${base}/index.jsx`, `${base}/__init__.py`.

Edges between different modules are deduplicated by `from→to` and sorted by `(from, to)` for determinism.

## Module prioritization

<!-- lw:anchors packages/core/src/modules.ts#prioritizeModules -->

`prioritizeModules(modules, edges)` scores each module by `indegree * 1000 + symbolCount` (where `indegree` counts incoming module-to-module edges) and sorts descending. Higher centrality and larger symbol counts are processed first.

## Unique id assignment

<!-- lw:anchors packages/core/src/modules.ts#makeUniqueDeterministicIds packages/core/src/modules.ts#candidateIdSequence packages/core/src/modules.ts#pathSegmentsFor packages/core/src/modules.ts#pathSlugOf packages/core/src/modules.ts#slugifySegment -->

`makeUniqueDeterministicIds(modules)` assigns globally unique ids without mutating inputs. For each module, `candidateIdSequence` produces:

- candidate 0: the module's existing `m.id` (preserves LLM-refined ids),
- candidates 1..N: right-to-left path expansions (leaf, leaf+parent, ...), each deduplicated against prior candidates.

A wave-based loop locks a candidate only when (a) no other unlocked module offers the same candidate at that level, and (b) no previously locked module already took it; collisions advance to the next level.

For modules still unlocked after the sequence is exhausted, a stable fallback uses `pathSlugOf(m)` (segments joined by `-`, each run through `slugifySegment`) plus an 8-char `sha256` of `paths.join("|")` and a counter, applied in path-sorted order. The function returns new `Module` objects.

## Defensive uniqueness check

<!-- lw:anchors packages/core/src/modules.ts#assertUniqueModuleIds packages/core/src/modules.ts#DuplicateModuleIdError packages/core/src/modules.ts#DuplicateModuleIdError.constructor -->

`assertUniqueModuleIds(modules)` counts occurrences of each `id`. If any id appears more than once, it throws `DuplicateModuleIdError` (a terminal error: caller must abort the run with a non-zero status). The constructor sets `this.name = "DuplicateModuleIdError"`. This is the last barrier before stage 4 disk writes and defends against regressions in the heuristic or id-uniqueness layers.