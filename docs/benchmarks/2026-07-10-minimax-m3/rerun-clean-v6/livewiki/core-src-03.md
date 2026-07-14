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
  - packages/core/src/prompts.test.ts#copyableAnchorMarkers
  - packages/core/src/prompts.ts#DEFAULT_CONTEXT_TOKEN_BUDGET
  - packages/core/src/prompts.ts#DEFAULT_OUTPUT_TOKEN_BUDGET
  - packages/core/src/prompts.ts#REPAIR_PRIOR_CANDIDATE_CHAR_LIMIT
  - packages/core/src/prompts.ts#buildOverviewPrompt
  - packages/core/src/prompts.ts#buildQuickstartPrompt
  - packages/core/src/prompts.ts#buildRepairPrompt
  - packages/core/src/prompts.ts#buildStage2RefinePrompt
  - packages/core/src/prompts.ts#buildStage4Prompt
  - packages/core/src/prompts.ts#neutralizeUntrustedControlMarkers
  - packages/core/src/safe-io.test.ts#detectSymlinkSupport
---

## Module identification heuristic
<!-- lw:anchors packages/core/src/modules.test.ts#idFor packages/core/src/modules.ts#identifyModulesHeuristic packages/core/src/modules.ts#dirToModuleId packages/core/src/modules.ts#normalizeRepoPath packages/core/src/modules.ts#countSymbols -->

`identifyModulesHeuristic` groups repository files into `Module` records by
top-level directory using a deterministic, allocation-light strategy. The
helper `normalizeRepoPath` enforces forward-slash separators before the
last `/` is searched. `dirToModuleId` resolves the slug from the last path
segment, falling back to the file basename (sans extension) when the repo
contains a single root-level file, and to `"root"` when other modules exist
alongside root-level files. The optional `symbolCountByPath` map is summed
per module via `countSymbols`; modules are sorted by `id` for stable output.

## Oversized module splitting (T0)
<!-- lw:anchors packages/core/src/modules.ts#MODULE_SPLIT_DEFAULTS packages/core/src/modules.ts#SPLIT_AXIS_DISABLED packages/core/src/modules.ts#normalizeSplitLimits packages/core/src/modules.ts#splitOversizedModules packages/core/src/modules.ts#splitOneModule packages/core/src/modules.ts#groupPathsByNextSegment packages/core/src/modules.ts#chunkFlatBucket packages/core/src/modules.ts#axisEnabled packages/core/src/modules.ts#fitsLimits packages/core/src/modules.ts#resolveSymbolCount -->

`splitOversizedModules` enforces dual-axis size caps so stage-4 pages stay
inside the LLM context window. Defaults from `MODULE_SPLIT_DEFAULTS` are
`maxFiles: 12` and `maxSymbols: 80`; `normalizeSplitLimits` maps any
non-positive value to `SPLIT_AXIS_DISABLED` (`Number.MAX_SAFE_INTEGER`).

The strategy is documented as T0 in the source: split on true subdirectory
boundaries first via `groupPathsByNextSegment`; peer leaf files collapse
into one flat bucket; oversized buckets are packed by `splitOneModule`
with chunk IDs like `parent-01`, `parent-02`, …. `axisEnabled` and
`fitsLimits` gate inclusion, and `chunkFlatBucket` honors both file and
symbol counts. A single file exceeding `maxSymbols` is emitted with
`unsplittable: true` so the batch keeps scheduling it.

## Exact partition assertions
<!-- lw:anchors packages/core/src/modules.ts#ExactPartitionError packages/core/src/modules.ts#ExactPartitionError.constructor packages/core/src/modules.ts#assertExactPathPartition packages/core/src/modules.ts#refinePeerDirectoryFragmentationError packages/core/src/modules.ts#fileStem packages/core/src/modules.ts#stripNodeNextExtension packages/core/src/modules.ts#resolveRelativeImport packages/core/src/modules.ts#resolveModuleEdges packages/core/src/modules.ts#prioritizeModules -->

`assertExactPathPartition` guards that the paths emitted by the splitter
re-partition the original set with no losses or duplicates; failure raises
`ExactPartitionError`. `refinePeerDirectoryFragmentationError` rewrites
the message when LLM refinement broke a sibling-directory layout. `fileStem`
strips extensions, `stripNodeNextExtension` strips Node-ESM suffixes, and
`resolveRelativeImport` resolves `./` and `../` sources against a known
file set. `resolveModuleEdges` then builds the undirected `ModuleGraphEdge`
list (deduplicated, self-loops removed), which `prioritizeModules` consumes
to rank by descending indegree with `symbolCount` as the tiebreaker.

## Unique deterministic module IDs
<!-- lw:anchors packages/core/src/modules.ts#assertUniqueModuleIds packages/core/src/modules.ts#DuplicateModuleIdError packages/core/src/modules.ts#DuplicateModuleIdError.constructor packages/core/src/modules.ts#makeUniqueDeterministicIds packages/core/src/modules.ts#candidateIdSequence packages/core/src/modules.ts#pathSegmentsFor packages/core/src/modules.ts#pathSlugOf packages/core/src/modules.ts#slugifyIdSegment packages/core/src/modules.ts#slugifySegment -->

Stage 4 writes one `livewiki/<id>.md` per module, so the slug must be
globally unique. `makeUniqueDeterministicIds` walks `candidateIdSequence`
(basename → expand-with-parent → ordinal disambiguation) and renames on
collision using `pathSlugOf`, `pathSegmentsFor`, `slugifyIdSegment` and
`slugifySegment`. `assertUniqueModuleIds` is the final guard; a leftover
collision raises `DuplicateModuleIdError`.

## Tree-sitter parser wrapper
<!-- lw:anchors packages/core/src/parser.ts#initParser packages/core/src/parser.ts#grammarsDir packages/core/src/parser.ts#loadLanguage packages/core/src/parser.ts#grammarForExtension packages/core/src/parser.ts#parseSource packages/core/src/parser.ts#listSupportedGrammars packages/core/src/parser.ts#_grammarToExtensionForTest -->

`initParser` initializes the WASM runtime exactly once via a cached
`initPromise`. `grammarsDir` resolves the shipped WASM location by
walking from `import.meta.url` toward `./package.json` and then
`../package.json`. `loadLanguage` memoizes each `Language` instance after
loading `tree-sitter-<name>.wasm`. `grammarForExtension` maps file
extensions (`.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.py`) to grammar
names; `parseSource` combines init + lookup + parse + null-check.
`listSupportedGrammars` enumerates any `.wasm` present in the grammars
directory; `_grammarToExtensionForTest` reverses the map for tests.

## AGENTS.md / CLAUDE.md pointer block
<!-- lw:anchors packages/core/src/pointer.ts#POINTER_START packages/core/src/pointer.ts#POINTER_END packages/core/src/pointer.ts#POINTER_FILES packages/core/src/pointer.ts#pickPointerFile packages/core/src/pointer.ts#buildPointerBlock packages/core/src/pointer.ts#findPointerBlock packages/core/src/pointer.ts#applyPointerReplace packages/core/src/pointer.ts#applyPointerRemove packages/core/src/pointer.ts#insertPointer packages/core/src/pointer.ts#removePointer packages/core/src/pointer.ts#readPointerStatus packages/core/src/pointer.ts#ensurePointerFile packages/core/src/pointer.ts#_internal -->

This module implements the opt-in pointer block delimited by `POINTER_START`
(`<!-- livewiki:start -->`) and `POINTER_END` (`<!-- livewiki:end -->`),
allowed only in the `POINTER_FILES` allowlist (`AGENTS.md`, `CLAUDE.md`).
`pickPointerFile` chooses between them based on which exists at repo root;
`buildPointerBlock` produces the short PT-BR paragraph + link. `findPointerBlock`
returns the matched indices (tolerant to whitespace, treats truncated blocks
as absent). `applyPointerReplace` either appends or substitutes the block,
reporting `inserted` / `replaced` / `unchanged`; `applyPointerRemove` strips
the block and collapses surrounding blank lines. The `async` entry points
`insertPointer`, `removePointer`, `readPointerStatus`, and
`ensurePointerFile` invoke these string transforms via `safe-io`, with
`_internal` exposing `nodeFs` for direct unit testing. TODO: behavior of
`ensurePointerFile` against missing parent dir is not documented in the
sourced excerpt.

## Provider preset table
<!-- lw:anchors packages/core/src/presets.ts#PRESET_TABLE packages/core/src/presets.ts#AVAILABLE_PRESETS packages/core/src/presets.ts#UnknownPresetError packages/core/src/presets.ts#UnknownPresetError.constructor packages/core/src/presets.ts#isKnownPreset packages/core/src/presets.ts#resolvePreset packages/core/src/presets.ts#resolveProviderConfig -->

`PRESET_TABLE` is the embedded data table covering `anthropic`, `openai`,
`openrouter`, `deepseek`, `kimi`, `minimax` (Anthropic-compatible endpoint,
uses the `anthropic` adapter for prompt caching), `gemini`, `nvidia`,
`ollama`, and `lmstudio`. Each entry carries adapter, baseUrl, envVar,
embedded pricing, short notes, and a per-provider `thinkingDefault`
policy. `AVAILABLE_PRESETS` exposes the literal-union keys; `isKnownPreset`
narrows unknown names. `resolvePreset` looks up a preset by name and
throws `UnknownPresetError` (constructor stores `presetName` and
`available`) on miss. `resolveProviderConfig` fuses a preset with user
overrides from `.livewiki/config.json`.

## Pricing lookup and cost reporting
<!-- lw:anchors packages/core/src/pricing.ts#PRICING_REFERENCE_DATE packages/core/src/pricing.ts#PRICING_TABLE packages/core/src/pricing.ts#lookupPricing packages/core/src/pricing.ts#calculateCostUsd packages/core/src/pricing.ts#formatCost -->

`PRICING_REFERENCE_DATE` records the compilation date of the embedded
`PRICING_TABLE` (currently `"2026-07-09"`). `lookupPricing` consults the
`PricingOverride` first, then the table, and finally returns
`{ tokensOnly: true }` so the reporter can fall back to a token-only view
rather than invent a USD value. `calculateCostUsd` computes input,
output, and total cost per million tokens; it returns `null` when the
lookup is `tokensOnly`. `formatCost` renders the result as `$${total}`
with four decimals, or `(no price for model X)` when no price is known.

## LLM prompt templates
<!-- lw:anchors packages/core/src/prompts.ts#DEFAULT_CONTEXT_TOKEN_BUDGET packages/core/src/prompts.ts#DEFAULT_OUTPUT_TOKEN_BUDGET packages/core/src/prompts.ts#REPAIR_PRIOR_CANDIDATE_CHAR_LIMIT packages/core/src/prompts.ts#neutralizeUntrustedControlMarkers packages/core/src/prompts.ts#buildStage4Prompt packages/core/src/prompts.ts#buildStage2RefinePrompt packages/core/src/prompts.ts#buildRepairPrompt packages/core/src/prompts.ts#buildQuickstartPrompt packages/core/src/prompts.ts#buildOverviewPrompt packages/core/src/prompts.test.ts#copyableAnchorMarkers -->

Templates stay in English so reviewers can audit what reaches the LLM;
`${language}` is a hint to the model about the doc's output language.
`DEFAULT_CONTEXT_TOKEN_BUDGET = 30_000` and `DEFAULT_OUTPUT_TOKEN_BUDGET
= 4_000` cap the inputs and outputs respectively;
`REPAIR_PRIOR_CANDIDATE_CHAR_LIMIT = 16_000` widens the prior-candidate
window for the repair prompt. `neutralizeUntrustedControlMarkers` rewrites
any `<!-- lw:* ... -->` or `<!-- /lw:* ... -->` text found in untrusted
inputs (source code, prior LLM output) into a non-copyable placeholder
(`[untrusted lw:anchors control marker omitted]`-style) so the model never
sees a real-looking marker to copy. `buildStage4Prompt` carries the full
output rules block (closed-list invariants, COMPLETENESS, rejection
criteria, no `lw:manual` block); `buildStage2RefinePrompt` proposes
module renames/boundaries; `buildRepairPrompt` ingests structured
`ArtifactValidationError` reports with a multi-KB prior window;
`buildQuickstartPrompt` and `buildOverviewPrompt` produce the entry
documents. The test helper `copyableAnchorMarkers` extracts every
`lw:anchors` marker body from a rendered prompt to assert that only real
closed-list keys appear.

## Symlink probe in safe-io tests
<!-- lw:anchors packages/core/src/safe-io.test.ts#detectSymlinkSupport -->

`detectSymlinkSupport` is a one-shot capability probe used by the
`safe-io` test suite: it writes a temp file, creates a symlink to it,
and reports `true` only when the OS allows the operation (Windows
requires Developer Mode or admin). Symlink-sensitive tests use
`it.runIf(canSymlink)` to skip cleanly on hosts without privilege.
TODO: list of the affected tests is not included in this excerpt.