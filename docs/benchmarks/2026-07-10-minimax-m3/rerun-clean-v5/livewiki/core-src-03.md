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
---

# core-src-03

## Module identification (heuristic)
<!-- lw:anchors packages/core/src/modules.test.ts#idFor packages/core/src/modules.ts#identifyModulesHeuristic packages/core/src/modules.ts#dirToModuleId packages/core/src/modules.ts#normalizeRepoPath -->

`identifyModulesHeuristic` groups repository files by top-level directory and returns deterministic `Module` records. Each module carries an `id`, `paths`, and `symbolCount`. The helper `idFor` is a test-only projection that extracts the `id` field from a module-shaped object.

`dirToModuleId` derives the slug from the last path segment; root-only repos with a single file fall back to the file basename. `normalizeRepoPath` enforces forward-slash, repo-relative paths before grouping.

## Module split defaults
<!-- lw:anchors packages/core/src/modules.ts#MODULE_SPLIT_DEFAULTS packages/core/src/modules.ts#SPLIT_AXIS_DISABLED packages/core/src/modules.ts#normalizeSplitLimits packages/core/src/modules.ts#axisEnabled -->

`MODULE_SPLIT_DEFAULTS` defines the per-module caps used by the structural splitter: `maxFiles: 12` and `maxSymbols: 80`. `SPLIT_AXIS_DISABLED` (`Number.MAX_SAFE_INTEGER`) is the sentinel that turns off a single axis when the user passes `0` or a negative value. `normalizeSplitLimits` applies that mapping to user-supplied thresholds, and `axisEnabled` checks whether a normalized limit is still active.

## Oversized module splitting
<!-- lw:anchors packages/core/src/modules.ts#splitOversizedModules packages/core/src/modules.ts#splitOneModule packages/core/src/modules.ts#countSymbols packages/core/src/modules.ts#resolveSymbolCount packages/core/src/modules.ts#fitsLimits packages/core/src/modules.ts#chunkFlatBucket packages/core/src/modules.ts#groupPathsByNextSegment packages/core/src/modules.ts#fileStem -->

`splitOversizedModules` partitions modules that exceed the configured caps into units small enough to complete stage-4 generation with valid frontmatter and verify. The strategy prefers true subdirectories first; peer leaf files in the same directory are gathered into a single flat bucket that is then chunked by dual-axis limits. Chunk ids are ordinal (`parent-01`, `parent-02`, …).

`countSymbols` sums per-path symbol counts for a list of paths. `resolveSymbolCount` looks up a path's count, defaulting to zero. `fitsLimits` checks both file and symbol axes against a module. `splitOneModule` is the per-module splitter. `chunkFlatBucket` packs an oversized flat bucket into ordered chunks. `groupPathsByNextSegment` re-buckets a flat bucket by its next path segment. `fileStem` strips a file extension to derive a stem.

## Partition and uniqueness assertions
<!-- lw:anchors packages/core/src/modules.ts#assertExactPathPartition packages/core/src/modules.ts#assertUniqueModuleIds packages/core/src/modules.ts#ExactPartitionError packages/core/src/modules.ts#ExactPartitionError.constructor packages/core/src/modules.ts#DuplicateModuleIdError packages/core/src/modules.ts#DuplicateModuleIdError.constructor packages/core/src/modules.ts#makeUniqueDeterministicIds packages/core/src/modules.ts#pathSlugOf packages/core/src/modules.ts#candidateIdSequence packages/core/src/modules.ts#pathSegmentsFor packages/core/src/modules.ts#slugifySegment packages/core/src/modules.ts#slugifyIdSegment -->

`assertExactPathPartition` verifies that a list of output modules forms an exact partition of the input path set. On failure it throws `ExactPartitionError` (constructed with a message). `assertUniqueModuleIds` guards against collisions; failures raise `DuplicateModuleIdError` (constructed with a message).

`makeUniqueDeterministicIds` rewrites colliding slugs by walking the path from the right (`core-src`, `cli-src`, …) until all module ids are unique. `pathSlugOf` produces a slug from a module's paths, `candidateIdSequence` enumerates fallback candidates, and `pathSegmentsFor` returns the contributing path segments. `slugifySegment` and `slugifyIdSegment` normalize raw segment text into stable id components.

## Module graph and edges
<!-- lw:anchors packages/core/src/modules.ts#resolveModuleEdges packages/core/src/modules.ts#resolveRelativeImport packages/core/src/modules.ts#stripNodeNextExtension packages/core/src/modules.ts#prioritizeModules packages/core/src/modules.ts#refinePeerDirectoryFragmentationError -->

`resolveModuleEdges` derives a directed module graph from per-file relative imports, ignoring absolute/`node_modules` sources and self-loops, and deduplicating parallel edges. `resolveRelativeImport` resolves a relative import string against its importing file's directory; `stripNodeNextExtension` normalizes NodeNext `.js`/`.mjs`/`.cjs` suffixes before lookup.

`prioritizeModules` orders modules for batch scheduling by decreasing indegree (centrality) with a tie-break on `symbolCount`. `refinePeerDirectoryFragmentationError` improves the error message returned when a heuristic pass over-fragments peer directories.

## Tree-sitter parser wrapper
<!-- lw:anchors packages/core/src/parser.ts#initParser packages/core/src/parser.ts#grammarsDir packages/core/src/parser.ts#loadLanguage packages/core/src/parser.ts#grammarForExtension packages/core/src/parser.ts#parseSource packages/core/src/parser.ts#listSupportedGrammars packages/core/src/parser.ts#_grammarToExtensionForTest -->

`initParser` initializes the WASM tree-sitter runtime; the call is idempotent and safe to invoke multiple times. `grammarsDir` resolves the `packages/core/grammars/` directory relative to this package's `package.json` (trying `./package.json` then `../package.json`). `loadLanguage` caches `Language` instances by name and loads `tree-sitter-<name>.wasm` from that directory.

`grammarForExtension` maps a file extension to a grammar name (TypeScript, TSX, JavaScript, Python). `parseSource` parses source code with the appropriate grammar and throws on unknown extensions or null trees. `listSupportedGrammars` enumerates the available `.wasm` files. `_grammarToExtensionForTest` reverses the extension-to-grammar map for test coverage.

## Pointer block (AGENTS.md / CLAUDE.md)
<!-- lw:anchors packages/core/src/pointer.ts#POINTER_START packages/core/src/pointer.ts#POINTER_END packages/core/src/pointer.ts#POINTER_FILES packages/core/src/pointer.ts#pickPointerFile packages/core/src/pointer.ts#buildPointerBlock packages/core/src/pointer.ts#findPointerBlock packages/core/src/pointer.ts#applyPointerReplace packages/core/src/pointer.ts#applyPointerRemove packages/core/src/pointer.ts#insertPointer packages/core/src/pointer.ts#removePointer packages/core/src/pointer.ts#readPointerStatus packages/core/src/pointer.ts#ensurePointerFile packages/core/src/pointer.ts#_internal -->

The pointer module manages an opt-in delimited block (`<!-- livewiki:start -->` … `<!-- livewiki:end -->`) appended to `AGENTS.md` or `CLAUDE.md`. It is the only allowed exception to the safe-io allowlist rule and is gated by an explicit opt-in.

`POINTER_START`, `POINTER_END`, and `POINTER_FILES` are the stable marker strings and the allowed file list. `pickPointerFile` chooses the target file given what already exists. `buildPointerBlock` returns the default block contents (a short paragraph linking to `quickstart.md`). `findPointerBlock` is a pure parser that locates an existing block (or `null`). `applyPointerReplace` and `applyPointerRemove` are pure string transforms for insertion and removal.

`insertPointer` and `removePointer` are the disk-touching entry points; they validate the target file and use safe-io with `allowPointer: true`. `readPointerStatus` reports whether a pointer currently exists. `ensurePointerFile` guarantees the chosen pointer file exists on disk. `_internal` exposes the underlying `node:fs` for advanced callers.

## Provider presets
<!-- lw:anchors packages/core/src/presets.ts#PRESET_TABLE packages/core/src/presets.ts#AVAILABLE_PRESETS packages/core/src/presets.ts#UnknownPresetError packages/core/src/presets.ts#UnknownPresetError.constructor packages/core/src/presets.ts#isKnownPreset packages/core/src/presets.ts#resolvePreset packages/core/src/presets.ts#resolveProviderConfig -->

`PRESET_TABLE` is the embedded data table of known providers (Anthropic, OpenAI, OpenRouter, DeepSeek, Kimi, MiniMax, Gemini, NVIDIA NIM, Ollama, LM Studio). Each entry carries the adapter, `baseUrl`, `envVar` name (never the value), default pricing, and operational notes. `AVAILABLE_PRESETS` is the read-only list of preset names derived from the table.

`UnknownPresetError` (constructed with the requested name and available list) is raised by `resolvePreset` when a name is not in the table. `isKnownPreset` is a type guard. `resolveProviderConfig` resolves a preset together with user `config.json` overrides into a concrete provider config, applying the rule that Anthropic-compat endpoints use the Anthropic adapter.

## Pricing table and cost calculation
<!-- lw:anchors packages/core/src/pricing.ts#PRICING_REFERENCE_DATE packages/core/src/pricing.ts#PRICING_TABLE packages/core/src/pricing.ts#lookupPricing packages/core/src/pricing.ts#calculateCostUsd packages/core/src/pricing.ts#formatCost -->

`PRICING_REFERENCE_DATE` records when `PRICING_TABLE` was last compiled; every cost report carries this date. `PRICING_TABLE` is the embedded best-effort map of model name to `ModelPrice` (USD per 1M input/output tokens).

`lookupPricing` resolves a model through the user override first, then the embedded table, returning either a priced `PricingLookup` or `tokensOnly: true` when no price is known. `calculateCostUsd` converts token counts to USD for a single LLM call and returns `null` when pricing is unavailable. `formatCost` renders a cost for the human report, returning `"(no price for model X)"` when the cost is `null` to keep the absence of data explicit.

## Prompt builders
<!-- lw:anchors packages/core/src/prompts.ts#DEFAULT_CONTEXT_TOKEN_BUDGET packages/core/src/prompts.ts#DEFAULT_OUTPUT_TOKEN_BUDGET packages/core/src/prompts.ts#REPAIR_PRIOR_CANDIDATE_CHAR_LIMIT packages/core/src/prompts.ts#buildStage4Prompt packages/core/src/prompts.ts#buildRepairPrompt packages/core/src/prompts.ts#buildStage2RefinePrompt packages/core/src/prompts.ts#buildQuickstartPrompt packages/core/src/prompts.ts#buildOverviewPrompt -->

`DEFAULT_CONTEXT_TOKEN_BUDGET` (30,000) and `DEFAULT_OUTPUT_TOKEN_BUDGET` (4,000) bound how much code is fed to stage-4 generation and how much Markdown is expected back. `REPAIR_PRIOR_CANDIDATE_CHAR_LIMIT` (16,000) caps the prior-candidate text embedded in repair prompts.

`buildStage4Prompt` returns the `{ system, user }` pair that drives the initial page generation, including the closed-list rule and the section-marker syntax. `buildRepairPrompt` produces a corrective prompt that lists structured validation errors and the truncated prior candidate. `buildStage2RefinePrompt` is the single LLM call that may rename or merge/split modules after the heuristic; failure here does not abort the run. `buildQuickstartPrompt` and `buildOverviewPrompt` produce prompts for the entry-point wiki pages.

## Safe-IO symlink probe
<!-- lw:anchors packages/core/src/safe-io.test.ts#detectSymlinkSupport -->

`detectSymlinkSupport` probes whether the current platform and user can create symlinks (Windows requires Developer Mode or admin). The result is used to gate the symlink-attack test cases in `safe-io.test.ts` via `it.runIf(canSymlink)`.