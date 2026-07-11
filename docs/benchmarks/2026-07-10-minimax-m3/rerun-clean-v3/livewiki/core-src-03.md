---
title: core-src-03
owner: generated
anchors:
  - packages/core/src/modules.test.ts#idFor
  - packages/core/src/modules.ts#DuplicateModuleIdError
  - packages/core/src/modules.ts#DuplicateModuleIdError.constructor
  - packages/core/src/modules.ts#ExactPartitionError
  - packages/core/src/modules.ts#ExactPartitionError.constructor
  - packages/core/src/modules.ts#MODULE_SPLIT_DEFAULTS
  - packages/core/src/modules.ts#SPLIT_AXIS_DISABLED
  - packages/core/src/modules.ts#assertExactPathPartition
  - packages/core/src/modules.ts#assertUniqueModuleIds
  - packages/core/src/modules.ts#axisEnabled
  - packages/core/src/modules.ts#candidateIdSequence
  - packages/core/src/modules.ts#chunkFlatBucket
  - packages/core/src/modules.ts#countSymbols
  - packages/core/src/modules.ts#dirToModuleId
  - packages/core/src/modules.ts#fileStem
  - packages/core/src/modules.ts#fitsLimits
  - packages/core/src/modules.ts#groupPathsByNextSegment
  - packages/core/src/modules.ts#identifyModulesHeuristic
  - packages/core/src/modules.ts#makeUniqueDeterministicIds
  - packages/core/src/modules.ts#normalizeRepoPath
  - packages/core/src/modules.ts#normalizeSplitLimits
  - packages/core/src/modules.ts#pathSegmentsFor
  - packages/core/src/modules.ts#pathSlugOf
  - packages/core/src/modules.ts#prioritizeModules
  - packages/core/src/modules.ts#refinePeerDirectoryFragmentationError
  - packages/core/src/modules.ts#resolveModuleEdges
  - packages/core/src/modules.ts#resolveRelativeImport
  - packages/core/src/modules.ts#resolveSymbolCount
  - packages/core/src/modules.ts#slugifyIdSegment
  - packages/core/src/modules.ts#slugifySegment
  - packages/core/src/modules.ts#splitOneModule
  - packages/core/src/modules.ts#splitOversizedModules
  - packages/core/src/modules.ts#stripNodeNextExtension
  - packages/core/src/parser.ts#_grammarToExtensionForTest
  - packages/core/src/parser.ts#grammarForExtension
  - packages/core/src/parser.ts#grammarsDir
  - packages/core/src/parser.ts#initParser
  - packages/core/src/parser.ts#listSupportedGrammars
  - packages/core/src/parser.ts#loadLanguage
  - packages/core/src/parser.ts#parseSource
  - packages/core/src/pointer.ts#POINTER_END
  - packages/core/src/pointer.ts#POINTER_FILES
  - packages/core/src/pointer.ts#POINTER_START
  - packages/core/src/pointer.ts#_internal
  - packages/core/src/pointer.ts#applyPointerRemove
  - packages/core/src/pointer.ts#applyPointerReplace
  - packages/core/src/pointer.ts#buildPointerBlock
  - packages/core/src/pointer.ts#ensurePointerFile
  - packages/core/src/pointer.ts#findPointerBlock
  - packages/core/src/pointer.ts#insertPointer
  - packages/core/src/pointer.ts#pickPointerFile
  - packages/core/src/pointer.ts#readPointerStatus
  - packages/core/src/pointer.ts#removePointer
  - packages/core/src/presets.ts#AVAILABLE_PRESETS
  - packages/core/src/presets.ts#PRESET_TABLE
  - packages/core/src/presets.ts#UnknownPresetError
  - packages/core/src/presets.ts#UnknownPresetError.constructor
  - packages/core/src/presets.ts#isKnownPreset
  - packages/core/src/presets.ts#resolvePreset
  - packages/core/src/presets.ts#resolveProviderConfig
  - packages/core/src/pricing.ts#PRICING_REFERENCE_DATE
  - packages/core/src/pricing.ts#PRICING_TABLE
  - packages/core/src/pricing.ts#calculateCostUsd
  - packages/core/src/pricing.ts#formatCost
  - packages/core/src/pricing.ts#lookupPricing
  - packages/core/src/prompts.ts#DEFAULT_CONTEXT_TOKEN_BUDGET
  - packages/core/src/prompts.ts#DEFAULT_OUTPUT_TOKEN_BUDGET
  - packages/core/src/prompts.ts#buildOverviewPrompt
  - packages/core/src/prompts.ts#buildQuickstartPrompt
  - packages/core/src/prompts.ts#buildRepairPrompt
  - packages/core/src/prompts.ts#buildStage2RefinePrompt
  - packages/core/src/prompts.ts#buildStage4Prompt
  - packages/core/src/safe-io.test.ts#detectSymlinkSupport
---

# core-src-03

## Module identification heuristic
<!-- lw:anchors packages/core/src/modules.ts#identifyModulesHeuristic packages/core/src/modules.ts#dirToModuleId packages/core/src/modules.ts#normalizeRepoPath packages/core/src/modules.test.ts#idFor -->

`identifyModulesHeuristic(filePaths, symbolCountByPath?)` groups files by their top-level directory and produces deterministic module IDs. Inputs are normalized via `normalizeRepoPath` (forward-slashes, no leading `./`). `dirToModuleId` chooses an id from the directory basename; root files collapse to `"root"` unless that is the only file in the repo, in which case the file's basename (without extension) is used. `modules.test.ts#idFor` is the unit helper that wraps `makeUniqueDeterministicIds` to assert a single-module path→id mapping.

## Splitting oversized modules
<!-- lw:anchors packages/core/src/modules.ts#splitOversizedModules packages/core/src/modules.ts#splitOneModule packages/core/src/modules.ts#MODULE_SPLIT_DEFAULTS packages/core/src/modules.ts#SPLIT_AXIS_DISABLED packages/core/src/modules.ts#normalizeSplitLimits packages/core/src/modules.ts#axisEnabled packages/core/src/modules.ts#fitsLimits packages/core/src/modules.ts#countSymbols packages/core/src/modules.ts#resolveSymbolCount packages/core/src/modules.ts#chunkFlatBucket packages/core/src/modules.ts#groupPathsByNextSegment packages/core/src/modules.ts#fileStem packages/core/src/modules.ts#slugifyIdSegment -->

`splitOversizedModules(modules, opts)` enforces per-module size caps with a dual-axis strategy (files + symbols). `MODULE_SPLIT_DEFAULTS` defines `{ maxFiles: 12, maxSymbols: 80 }` and `SPLIT_AXIS_DISABLED` is `Number.MAX_SAFE_INTEGER` for axes turned off. `normalizeSplitLimits` maps `0`/negative values to the disabled sentinel and `undefined` to defaults. `axisEnabled` and `fitsLimits` gate whether a chunk may be packed. `splitOneModule` recursively walks true subdirectories (via `groupPathsByNextSegment`) and sorts peer leaves via `fileStem` + `slugifyIdSegment`. `resolveSymbolCount` honors per-path entries from `symbolCountByPath` and falls back to module-level counts when the map has no entries for the module's paths; `countSymbols` is the summing helper used by chunks. `chunkFlatBucket` packs pure-flat directories with ordinal IDs (`-01`, `-02`, …) and marks single atomic over-symbol files with `unsplittable: true`.

## Path-based unique IDs (Phase-5 plan)
<!-- lw:anchors packages/core/src/modules.ts#makeUniqueDeterministicIds packages/core/src/modules.ts#pathSegmentsFor packages/core/src/modules.ts#pathSlugOf packages/core/src/modules.ts#slugifySegment packages/core/src/modules.ts#candidateIdSequence packages/core/src/modules.ts#assertUniqueModuleIds packages/core/src/modules.ts#DuplicateModuleIdError packages/core/src/modules.ts#DuplicateModuleIdError.constructor packages/core/src/modules.ts#ExactPartitionError packages/core/src/modules.ts#ExactPartitionError.constructor packages/core/src/modules.ts#assertExactPathPartition packages/core/src/modules.ts#refinePeerDirectoryFragmentationError packages/core/src/modules.ts#stripNodeNextExtension packages/core/src/modules.ts#resolveRelativeImport packages/core/src/modules.ts#prioritizeModules packages/core/src/modules.ts#resolveModuleEdges -->

`makeUniqueDeterministicIds(modules)` enforces globally unique module IDs. `candidateIdSequence` builds the per-module candidate list (m.id first, then right-to-left path expansions). `pathSegmentsFor` + `slugifySegment` + `pathSlugOf` produce a full-path slug used as the stable-fallback base when the wave loop exhausts every candidate. `assertUniqueModuleIds` is a defensive gate: it raises `DuplicateModuleIdError` when IDs collide. The same family includes `assertExactPathPartition` and `refinePeerDirectoryFragmentationError`, both throwing `ExactPartitionError` (a dedicated subclass of `Error` with a name-preserving constructor) when the partition invariant is broken or peer leaves were split. `resolveRelativeImport` and `stripNodeNextExtension` handle NodeNext-style `.js`/`.jsx`/`.mjs`/`.cjs` suffix stripping for the module graph. `resolveModuleEdges` produces deduplicated inter-module edges (no self-loops, ignores external imports), and `prioritizeModules` orders by indegree (×1000) then `symbolCount`.

## Parser bootstrap and grammar discovery
<!-- lw:anchors packages/core/src/parser.ts#initParser packages/core/src/parser.ts#grammarsDir packages/core/src/parser.ts#loadLanguage packages/core/src/parser.ts#grammarForExtension packages/core/src/parser.ts#parseSource packages/core/src/parser.ts#listSupportedGrammars packages/core/src/parser.ts#_grammarToExtensionForTest -->

`initParser` is the async bootstrap that prepares Tree-sitter grammars. `grammarsDir` locates the on-disk grammar assets and `loadLanguage(name)` materializes a `Language` handle. `grammarForExtension(ext)` maps file extensions to grammar names; its inverse (used only by tests) is `_grammarToExtensionForTest`. `parseSource` runs the parser on input source text, returning the parsed tree. `listSupportedGrammars` enumerates the grammars the package knows about.

## Pointer files (`AGENTS.md` / `CLAUDE.md`)
<!-- lw:anchors packages/core/src/pointer.ts#POINTER_START packages/core/src/pointer.ts#POINTER_END packages/core/src/pointer.ts#POINTER_FILES packages/core/src/pointer.ts#pickPointerFile packages/core/src/pointer.ts#buildPointerBlock packages/core/src/pointer.ts#findPointerBlock packages/core/src/pointer.ts#applyPointerReplace packages/core/src/pointer.ts#applyPointerRemove packages/core/src/pointer.ts#insertPointer packages/core/src/pointer.ts#removePointer packages/core/src/pointer.ts#readPointerStatus packages/core/src/pointer.ts#ensurePointerFile packages/core/src/pointer.ts#_internal -->

Pointer bookkeeping for the live-managed `AGENTS.md` / `CLAUDE.md` files. `POINTER_START` / `POINTER_END` are the surrounding markers; `POINTER_FILES` enumerates the well-known filenames. `pickPointerFile` chooses which file to manage. `buildPointerBlock` produces the marker-wrapped block; `findPointerBlock` locates it inside a file; `applyPointerReplace` rewrites the block in memory and `applyPointerRemove` strips it. I/O flows: `insertPointer`, `removePointer`, `readPointerStatus`, and `ensurePointerFile`. `pointer.ts#_internal` re-exports `nodeFs` for test access to the underlying filesystem shim.

## Provider presets
<!-- lw:anchors packages/core/src/presets.ts#PRESET_TABLE packages/core/src/presets.ts#AVAILABLE_PRESETS packages/core/src/presets.ts#isKnownPreset packages/core/src/presets.ts#resolvePreset packages/core/src/presets.ts#resolveProviderConfig packages/core/src/presets.ts#UnknownPresetError packages/core/src/presets.ts#UnknownPresetError.constructor -->

`PRESET_TABLE` is the canonical map from `PresetName` to its `ProviderPreset` (defaults for model, context budget, output budget, etc.). `AVAILABLE_PRESETS` is the readonly list of names in priority order. `isKnownPreset` is the type guard; `resolvePreset(name)` returns a preset or throws `UnknownPresetError` (a dedicated subclass with a constructor that captures the offending name and the available list). `resolveProviderConfig(args)` combines a preset with CLI overrides to produce the final config.

## Pricing
<!-- lw:anchors packages/core/src/pricing.ts#PRICING_TABLE packages/core/src/pricing.ts#PRICING_REFERENCE_DATE packages/core/src/pricing.ts#lookupPricing packages/core/src/pricing.ts#calculateCostUsd packages/core/src/pricing.ts#formatCost -->

`PRICING_TABLE` is the static model→pricing matrix, versioned by `PRICING_REFERENCE_DATE`. `lookupPricing(model, override?)` resolves pricing for a model with optional overrides (per-1k-token input/output rates). `calculateCostUsd` turns token usage + resolved rates into a USD total. `formatCost` produces a human-readable dollar string with the model name (or a placeholder when cost is `null`).

## Prompt construction
<!-- lw:anchors packages/core/src/prompts.ts#DEFAULT_CONTEXT_TOKEN_BUDGET packages/core/src/prompts.ts#DEFAULT_OUTPUT_TOKEN_BUDGET packages/core/src/prompts.ts#buildOverviewPrompt packages/core/src/prompts.ts#buildQuickstartPrompt packages/core/src/prompts.ts#buildStage2RefinePrompt packages/core/src/prompts.ts#buildStage4Prompt packages/core/src/prompts.ts#buildRepairPrompt -->

Default sizing constants: `DEFAULT_CONTEXT_TOKEN_BUDGET` (30 000) and `DEFAULT_OUTPUT_TOKEN_BUDGET` (4 000). Prompt builders: `buildOverviewPrompt` (repo-level orientation), `buildQuickstartPrompt` (fast-boot runbook), `buildStage2RefinePrompt` (the stage-2 LLM call that may rename modules and tweak boundaries), `buildStage4Prompt` (per-module page generation), and `buildRepairPrompt` (recovery prompt used after verification failures).

## Safe-IO test helper
<!-- lw:anchors packages/core/src/safe-io.test.ts#detectSymlinkSupport -->

`detectSymlinkSupport()` is the async test-only helper that probes the runtime for symlink capability before any safe-IO test can rely on `symlink(2)` semantics.

## TODO: invariants cross-references

TODO: link Livewiki invariants document for the duplicate-id and exact-partition assertions (`DuplicateModuleIdError`, `assertExactPathPartition`).
TODO: confirm whether `splitOversizedModules` mutates input — current implementation appears to deep-copy via `[{...m, paths}]` but a contract comment would clarify.
TODO: capture the exact provider list of `AVAILABLE_PRESETS` values; only the closed-list anchor was emitted.