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
<!-- lw:anchors packages/core/src/modules.test.ts#idFor packages/core/src/modules.ts#identifyModulesHeuristic packages/core/src/modules.ts#dirToModuleId packages/core/src/modules.ts#normalizeRepoPath -->

Groups repo files into modules by top-level directory. Each file's `dir` becomes a module; the slug is the last directory segment. Root files with no directory collapse to `root` (or to the basename when the entire repo is one file).

## Oversized-module splitting
<!-- lw:anchors packages/core/src/modules.ts#MODULE_SPLIT_DEFAULTS packages/core/src/modules.ts#SPLIT_AXIS_DISABLED packages/core/src/modules.ts#normalizeSplitLimits packages/core/src/modules.ts#splitOversizedModules packages/core/src/modules.ts#splitOneModule packages/core/src/modules.ts#chunkFlatBucket packages/core/src/modules.ts#groupPathsByNextSegment packages/core/src/modules.ts#fitsLimits packages/core/src/modules.ts#axisEnabled packages/core/src/modules.ts#countSymbols packages/core/src/modules.ts#resolveSymbolCount packages/core/src/modules.ts#fileStem packages/core/src/modules.ts#slugifyIdSegment -->

Splits modules that exceed `maxFiles` or `maxSymbols` using dual-axis limits. Strategy: true subdirectories become structural buckets (`{parent}-{seg}`); peer leaves at the same depth form a flat bucket chunked with ordinal ids (`{parent}-01`, `{parent}-02`, …). A single file over the symbol cap is emitted with `unsplittable: true` rather than exploded.

## Path normalization and helpers
<!-- lw:anchors packages/core/src/modules.ts#normalizeRepoPath packages/core/src/modules.ts#fileStem packages/core/src/modules.ts#slugifyIdSegment packages/core/src/modules.ts#slugifySegment packages/core/src/modules.ts#pathSegmentsFor packages/core/src/modules.ts#candidateIdSequence packages/core/src/modules.ts#pathSlugOf -->

Canonical repo-relative paths (forward slashes, no leading `./`), file-stem extraction, slug rules (NFD strip, `[^\w-]+` → `-`, lower-case, max 48 chars, fallback `part`), and path→candidate sequence helpers used by the uniqueness pass.

## Partition invariants and guards
<!-- lw:anchors packages/core/src/modules.ts#ExactPartitionError packages/core/src/modules.ts#ExactPartitionError.constructor packages/core/src/modules.ts#assertExactPathPartition packages/core/src/modules.ts#refinePeerDirectoryFragmentationError packages/core/src/modules.ts#DuplicateModuleIdError packages/core/src/modules.ts#DuplicateModuleIdError.constructor packages/core/src/modules.ts#assertUniqueModuleIds packages/core/src/modules.ts#makeUniqueDeterministicIds -->

Defensive gates around the module set. `assertExactPathPartition` rejects duplicates and missing paths; `refinePeerDirectoryFragmentationError` blocks the LLM refine step from fragmenting peer leaves; `assertUniqueModuleIds` throws `DuplicateModuleIdError` when two modules share an id (the message lists example paths). `makeUniqueDeterministicIds` resolves collisions deterministically: preserves unique refined ids, expands path segments right-to-left when colliding, and uses a stable `{slug}-{hash}-{n}` fallback when the path is exhausted.

## Module graph and ordering
<!-- lw:anchors packages/core/src/modules.ts#resolveModuleEdges packages/core/src/modules.ts#resolveRelativeImport packages/core/src/modules.ts#stripNodeNextExtension packages/core/src/modules.ts#prioritizeModules -->

Builds inter-module edges from relative imports (self-loops and absolute/node_modules imports are dropped) and orders modules for stage 4 by descending centrality with `symbolCount` as tiebreaker. Relative imports resolve NodeNext-style (`.js` stripped before generating `.ts`/`.tsx`/`.js`/`.jsx`/`.py` candidates and `index.*` barrels).

## Source parser
<!-- lw:anchors packages/core/src/parser.ts#initParser packages/core/src/parser.ts#grammarsDir packages/core/src/parser.ts#loadLanguage packages/core/src/parser.ts#grammarForExtension packages/core/src/parser.ts#parseSource packages/core/src/parser.ts#listSupportedGrammars packages/core/src/parser.ts#_grammarToExtensionForTest -->

Tree-sitter based parser. `initParser` lazily loads grammars on demand; `loadLanguage` reads `.wasm` files from the grammars directory and caches them. `parseSource` accepts a path or `Buffer` and returns the AST plus the chosen grammar. `grammarForExtension` maps extensions to grammars; `listSupportedGrammars` reports the loaded set; `_grammarToExtensionForTest` is the reverse lookup, exposed only for tests.

## Pointer file management
<!-- lw:anchors packages/core/src/pointer.ts#POINTER_START packages/core/src/pointer.ts#POINTER_END packages/core/src/pointer.ts#POINTER_FILES packages/core/src/pointer.ts#pickPointerFile packages/core/src/pointer.ts#buildPointerBlock packages/core/src/pointer.ts#findPointerBlock packages/core/src/pointer.ts#applyPointerReplace packages/core/src/pointer.ts#applyPointerRemove packages/core/src/pointer.ts#insertPointer packages/core/src/pointer.ts#removePointer packages/core/src/pointer.ts#readPointerStatus packages/core/src/pointer.ts#ensurePointerFile packages/core/src/pointer.ts#_internal -->

Manages the `<!-- livewiki:start --> … <!-- livewiki:end -->` block in agent pointer files (`AGENTS.md`, `CLAUDE.md`). `pickPointerFile` chooses between existing candidates. `findPointerBlock`/`applyPointerReplace`/`applyPointerRemove` implement locate-and-mutate; `insertPointer`/`removePointer`/`readPointerStatus` are the public async I/O wrappers. `ensurePointerFile` creates the pointer if missing. `_internal` re-exports `nodeFs` for tests.

## Provider presets
<!-- lw:anchors packages/core/src/presets.ts#PRESET_TABLE packages/core/src/presets.ts#AVAILABLE_PRESETS packages/core/src/presets.ts#resolvePreset packages/core/src/presets.ts#resolveProviderConfig packages/core/src/presets.ts#isKnownPreset packages/core/src/presets.ts#UnknownPresetError packages/core/src/presets.ts#UnknownPresetError.constructor -->

Provider presets registry. `PRESET_TABLE` maps `PresetName` to `ProviderPreset` (model, base URL, headers). `AVAILABLE_PRESETS` is the readonly list; `isKnownPreset` narrows the string type. `resolvePreset` throws `UnknownPresetError` (listing `available`) on unknown names; `resolveProviderConfig` merges the preset with per-call overrides.

## Pricing
<!-- lw:anchors packages/core/src/pricing.ts#PRICING_TABLE packages/core/src/pricing.ts#PRICING_REFERENCE_DATE packages/core/src/pricing.ts#lookupPricing packages/core/src/pricing.ts#calculateCostUsd packages/core/src/pricing.ts#formatCost -->

Per-model pricing table with a reference date (`PRICING_REFERENCE_DATE`) for staleness checks. `lookupPricing` resolves a model to a `PricingLookup` (input/output USD per million tokens) honoring caller overrides. `calculateCostUsd` multiplies token usage by the lookup; `formatCost` produces the human-readable string used in summaries.

## Prompt builders
<!-- lw:anchors packages/core/src/prompts.ts#DEFAULT_CONTEXT_TOKEN_BUDGET packages/core/src/prompts.ts#DEFAULT_OUTPUT_TOKEN_BUDGET packages/core/src/prompts.ts#buildStage4Prompt packages/core/src/prompts.ts#buildStage2RefinePrompt packages/core/src/prompts.ts#buildOverviewPrompt packages/core/src/prompts.ts#buildQuickstartPrompt packages/core/src/prompts.ts#buildRepairPrompt -->

Token budgets (`DEFAULT_CONTEXT_TOKEN_BUDGET`, `DEFAULT_OUTPUT_TOKEN_BUDGET`) gate prompt size. `buildStage4Prompt` produces the per-module page prompt; `buildStage2RefinePrompt` produces the module refinement prompt; `buildOverviewPrompt`, `buildQuickstartPrompt`, and `buildRepairPrompt` cover the overview/quickstart/fix-up stages. Exact prompt bodies are out of scope for this reference page.

## Safe I/O test helper
<!-- lw:anchors packages/core/src/safe-io.test.ts#detectSymlinkSupport -->

`detectSymlinkSupport` probes the runtime for working symlink semantics; used by the safe-IO test suite to skip or adapt cases on platforms where symlinks are not honored.
