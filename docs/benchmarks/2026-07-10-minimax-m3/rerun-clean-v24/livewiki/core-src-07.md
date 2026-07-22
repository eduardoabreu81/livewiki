---
title: Navigation, parser, pointer, presets, and pricing support for the core
owner: generated
anchors:
  - packages/core/src/navigation.ts#buildDisplayTitleFallbacks
  - packages/core/src/navigation.ts#buildNavigateBlock
  - packages/core/src/navigation.ts#commonDirectory
  - packages/core/src/navigation.ts#compareModules
  - packages/core/src/navigation.ts#compareTopics
  - packages/core/src/navigation.ts#ensureTopicsIndexScaffold
  - packages/core/src/navigation.ts#generateAuxiliaryIndex
  - packages/core/src/navigation.ts#generateFlowsIndex
  - packages/core/src/navigation.ts#generateQuickstart
  - packages/core/src/navigation.ts#generateTasksPage
  - packages/core/src/navigation.ts#generateTopicsIndex
  - packages/core/src/navigation.ts#humanizeSegments
  - packages/core/src/navigation.ts#loadFlowPresentations
  - packages/core/src/navigation.ts#loadModulePresentations
  - packages/core/src/navigation.ts#loadTopicPresentations
  - packages/core/src/navigation.ts#normalizeLabel
  - packages/core/src/navigation.ts#readHubDeclaredOwner
  - packages/core/src/navigation.ts#sameStrings
  - packages/core/src/navigation.ts#selectRelatedModules
  - packages/core/src/navigation.ts#syncAuxiliaryIndexHub
  - packages/core/src/navigation.ts#syncFlowsIndexHub
  - packages/core/src/navigation.ts#syncTopicsIndexHub
  - packages/core/src/navigation.ts#updateFlowTopicLinks
  - packages/core/src/navigation.ts#updateModuleNavigateBlocks
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
  - packages/core/src/prompts.test.ts#outerFenceFor
---

# Navigation, parser, pointer, presets, and pricing support for the core

This page documents five cooperating core subsystems that produce the generated wiki pages, parse source code, manage the opt-in pointer block, supply built-in LLM provider presets, and convert token usage into USD costs.

## When to use this page

- **Use** these modules when you need to render generated module, flow, topic, and auxiliary index pages, and to keep their navigate blocks in sync with the dependency graph.
- **Use** these modules when you need to parse TypeScript, TSX/JSX, JavaScript, or Python source files into tree-sitter ASTs or to resolve a file extension to its supported grammar.
- **Use** these modules when you need to insert, replace, remove, or inspect the pointer block in `AGENTS.md` or `CLAUDE.md`, or to resolve a provider preset name and compute USD call costs.

## How it fits

`packages/core/src/navigation.ts` is the page-rendering layer: it loads `ModulePresentation`, `FlowPresentation`, and `TopicPresentation` records, sorts them with small comparator helpers, and emits Markdown for the module pages, quickstart, tasks, and the topic, flow, and auxiliary index hubs. `packages/core/src/parser.ts` wraps `web-tree-sitter`, caching `Language` objects keyed by grammar name and loading `tree-sitter-<name>.wasm` files from the `grammars/` directory that lives next to the package's `package.json`. `packages/core/src/pointer.ts` is the single module permitted to touch `AGENTS.md`/`CLAUDE.md`, and only behind an explicit opt-in; every other write goes through `safe-io.ts` against the `livewiki/` and `.livewiki/` allowlist. `packages/core/src/presets.ts` holds a data-only table of providers, so adding a provider is a one-entry change with no new adapter code. `packages/core/src/pricing.ts` supplies the cost arithmetic that the batch reporter reads, including the override-merge behavior so user-supplied prices in `.livewiki/config.json` always win. `packages/core/src/prompts.test.ts` contributes two local test helpers used by the prompt test suite; the prompt builder itself lives in `prompts.ts` and is out of scope for this page.

## Module presentation loading

<!-- lw:anchors packages/core/src/navigation.ts#buildDisplayTitleFallbacks packages/core/src/navigation.ts#loadModulePresentations packages/core/src/navigation.ts#loadFlowPresentations packages/core/src/navigation.ts#loadTopicPresentations packages/core/src/navigation.ts#readHubDeclaredOwner packages/core/src/navigation.ts#compareModules packages/core/src/navigation.ts#compareTopics packages/core/src/navigation.ts#commonDirectory packages/core/src/navigation.ts#humanizeSegments packages/core/src/navigation.ts#normalizeLabel packages/core/src/navigation.ts#sameStrings -->

`buildDisplayTitleFallbacks` returns a presentation-only `Map<string, string>` by grouping modules that share a common directory suffix and disambiguating with a "— part N of M" suffix when the group is larger than one. Module identity never changes: the map is a side artifact used only by renderers. `loadModulePresentations` reads each existing `livewiki/<id>.md` page, parses its frontmatter, and records the declared `owner` and a `displayTitle` (preferring the page's frontmatter title when it differs from the module id in normalized form). A malformed page is caught and treated as having no navigation metadata, so the fallback title wins. `loadFlowPresentations` walks `livewiki/flows/<slug>.md` (excluding `index.md`) and degrades honestly: a missing title becomes `null` and the hub falls back to the slug. `loadTopicPresentations` reads `livewiki/topics/<slug>.md` and produces `{ slug, title, intent, modules, flows, owner, planOrder }` records. `readHubDeclaredOwner` parses the literal `owner:` field of a hub's frontmatter and returns `"generated" | "human" | "mixed" | null`; null means the hub did not declare an owner and the writer's normal overwrite/skip logic applies. The remaining helpers in this section are tiny comparators and string utilities: `compareModules` and `compareTopics` provide stable ordering for the loaders, `commonDirectory` reduces a list of module paths to their shared prefix segments, `humanizeSegments` turns the suffix into a human label, `normalizeLabel` lowercases and strips a defined set of separators for case-insensitive equality, and `sameStrings` checks two string arrays for set equality after normalization.

## Page generation

<!-- lw:anchors packages/core/src/navigation.ts#generateQuickstart packages/core/src/navigation.ts#generateTasksPage packages/core/src/navigation.ts#generateAuxiliaryIndex packages/core/src/navigation.ts#generateFlowsIndex packages/core/src/navigation.ts#generateTopicsIndex packages/core/src/navigation.ts#selectRelatedModules -->

The five `generate*` functions emit Markdown bodies for the project's top-level pages. `generateQuickstart` produces the low-token entry page that the pointer block links to. `generateTasksPage` produces the actionable checklist of open documentation debt for human reviewers. `generateAuxiliaryIndex` rolls up modules whose role is `fixture`, `tooling`, or `docs` into three sections (Test fixtures, Tooling and benchmarks, Repository documentation), reflecting the policy of giving fixtures, tooling, benchmarks, and documentation honest task context rather than implying product prominence. `generateFlowsIndex` and `generateTopicsIndex` produce the hub pages for flows and topics respectively. `selectRelatedModules` chooses, for a given module, the modules that should appear in its "Related" section by inspecting both inbound and outbound edges of the dependency graph and returning a list with a `direction` discriminator of `"dependency"`, `"dependent"`, or `"both"`.

## Hub synchronization

<!-- lw:anchors packages/core/src/navigation.ts#ensureTopicsIndexScaffold packages/core/src/navigation.ts#syncTopicsIndexHub packages/core/src/navigation.ts#syncFlowsIndexHub packages/core/src/navigation.ts#syncAuxiliaryIndexHub packages/core/src/navigation.ts#updateModuleNavigateBlocks packages/core/src/navigation.ts#updateFlowTopicLinks packages/core/src/navigation.ts#buildNavigateBlock -->

These functions are the write side of the navigation pipeline. `ensureTopicsIndexScaffold` creates the `livewiki/topics/` directory and a placeholder `index.md` if neither exists, so the first run is non-destructive. The three `sync*IndexHub` functions regenerate a hub page in place; they consult a hub's declared `owner` so that a hub declaring `"human"` or `"mixed"` is not overwritten by the generator. `updateModuleNavigateBlocks` rewrites the per-module `<!-- livewiki:navigate:start -->` ... `<!-- livewiki:navigate:end -->` block inside each module page, and `updateFlowTopicLinks` rewrites the `<!-- livewiki:topics:start -->` ... `<!-- livewiki:topics:end -->` block inside each flow page. `buildNavigateBlock` is the lower-level helper that produces the navigate block body given a module and its related modules. The `MANUAL_BLOCK_RE` constant visible in the module preamble protects human-written manual sections inside generated pages from being overwritten.

## Tree-sitter parser wrapper

<!-- lw:anchors packages/core/src/parser.ts#initParser packages/core/src/parser.ts#grammarsDir packages/core/src/parser.ts#loadLanguage packages/core/src/parser.ts#grammarForExtension packages/core/src/parser.ts#parseSource packages/core/src/parser.ts#listSupportedGrammars packages/core/src/parser.ts#_grammarToExtensionForTest -->

The parser wraps `web-tree-sitter` with a per-process cache. `initParser` is the global, idempotent startup hook: the first call invokes `Parser.init()` and stores the resulting promise; every later call returns the same promise so concurrent callers share a single WASM runtime initialization. `grammarsDir` resolves the absolute path to the `grammars/` directory by trying `./package.json` (the dev path under `src/`) and then `../package.json` (the built path under `dist/`); if neither resolves it throws rather than falling back to `node_modules`. `loadLanguage` reads `tree-sitter-<name>.wasm` from that directory and caches the parsed `Language` in a `Map<string, Language>`; if the wasm file is missing it throws a clear error naming the unsupported grammar. `grammarForExtension` maps file extensions (`.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.py`) to grammar names case-insensitively and returns `undefined` for unknown extensions. `parseSource` resolves the grammar via `EXT_TO_GRAMMAR`, calls `loadLanguage` (which transitively calls `initParser`), constructs a `Parser`, sets its language, and returns the parsed `Tree`; if the grammar is not registered it throws `Sem gramática tree-sitter para extensão <ext>`, and if `parser.parse(source)` returns null (an exceptional case for empty input) it throws `tree-sitter retornou árvore nula para <ext>` rather than propagating a null tree. `listSupportedGrammars` lists the wasm files actually present in the grammars directory, returning an empty array when the directory itself is missing. `_grammarToExtensionForTest` is the inverse of `grammarForExtension`, exposed only for tests so they can verify the bidirectional mapping without depending on the private `EXT_TO_GRAMMAR` constant.

## Pointer block primitives

<!-- lw:anchors packages/core/src/pointer.ts#POINTER_START packages/core/src/pointer.ts#POINTER_END packages/core/src/pointer.ts#POINTER_FILES packages/core/src/pointer.ts#pickPointerFile packages/core/src/pointer.ts#buildPointerBlock packages/core/src/pointer.ts#findPointerBlock packages/core/src/pointer.ts#applyPointerReplace packages/core/src/pointer.ts#applyPointerRemove packages/core/src/pointer.ts#insertPointer packages/core/src/pointer.ts#removePointer packages/core/src/pointer.ts#readPointerStatus packages/core/src/pointer.ts#ensurePointerFile packages/core/src/pointer.ts#_internal -->

The pointer module is the single opt-in exception to the "no writes outside `livewiki/` and `.livewiki/`" rule. The block is delimited by the constants `POINTER_START` (`<!-- livewiki:start -->`) and `POINTER_END` (`<!-- livewiki:end -->`); both are deliberately stable because external parsers may key off them. `POINTER_FILES` is the readonly tuple `["AGENTS.md", "CLAUDE.md"]` from which the `PointerFile` type is derived. `pickPointerFile(hasAgentsMd, hasClaudeMd, requested)` decides which file the write will target: if `requested` is given it wins; otherwise the existing `AGENTS.md` is preferred, then existing `CLAUDE.md`, and if neither exists the default is to create `AGENTS.md`. `buildPointerBlock` returns a deliberately short block (under 800 bytes by test) containing one paragraph and one relative link to `./livewiki/quickstart.md`. `findPointerBlock` is a pure parser of an arbitrary markdown string: it locates the start and end markers (tolerating whitespace around them so CRLF/BOM-prefixed inputs still match) and returns `{ startIdx, endIdx, inner }` or `null` if either marker is missing — a truncated block (start without end, or end without start) is treated as absent so the writer never corrupts the document. `applyPointerReplace(content, newBlock)` is the pure string transform: when no block exists it appends the new block at the end (with a blank-line separator when the existing content does not end with a newline); when a block exists it replaces it in place; and when the replacement is byte-identical to the existing block it returns `action: "unchanged"` so callers can avoid a no-op write. `applyPointerRemove(content)` is the inverse: it removes the block (and one adjacent newline when removing would leave a double blank line) and returns `removed: false` when nothing was present. The disk-touching side is `insertPointer` (insert/replace with `PointerAction` reporting and a `bytesWritten` count), `removePointer`, `readPointerStatus` (returns the current state without writing), and `ensurePointerFile` (idempotent create of an empty target file). `_internal` exposes the `nodeFs` import for tests that need to spy on filesystem behavior without going through the public API.

## Provider presets

<!-- lw:anchors packages/core/src/presets.ts#PRESET_TABLE packages/core/src/presets.ts#AVAILABLE_PRESETS packages/core/src/presets.ts#resolvePreset packages/core/src/presets.ts#resolveProviderConfig packages/core/src/presets.ts#isKnownPreset packages/core/src/presets.ts#UnknownPresetError packages/core/src/presets.ts#UnknownPresetError.constructor -->

`PRESET_TABLE` is the data-only registry of ten providers: `anthropic`, `openai`, `openrouter`, `deepseek`, `kimi`, `minimax`, `gemini`, `nvidia`, `ollama`, `lmstudio`. Each `ProviderPreset` entry carries the adapter kind (`anthropic` or `openai-compat`), the base URL, the name of the env var holding the API key (the value is never stored), the default per-model pricing, short operational notes, and optional metadata for batch reasoning controls (`thinkingDefault`, `preferMaxCompletionTokens`, `defaultMaxOutputTokens`). Adding a new provider is an entry edit, not a code edit. `AVAILABLE_PRESETS` is the readonly ordered list of the same ten names exposed to callers. `isKnownPreset` is a type-guard that narrows a raw string to the `PresetName` union. `resolvePreset(name)` looks the name up in `PRESET_TABLE` and throws `UnknownPresetError` when the name is not registered; the error carries both the offending name and the sorted `available` list so the message can list every valid choice. `resolveProviderConfig(args)` merges a preset with user-supplied overrides (from `.livewiki/config.json`), letting the user override any field of the preset. `UnknownPresetError` extends `Error`, sets its `name` property to `"UnknownPresetError"`, and stores `presetName` and `available` as readonly fields for programmatic consumers.

## Pricing arithmetic

<!-- lw:anchors packages/core/src/pricing.ts#PRICING_REFERENCE_DATE packages/core/src/pricing.ts#PRICING_TABLE packages/core/src/pricing.ts#lookupPricing packages/core/src/pricing.ts#calculateCostUsd packages/core/src/pricing.ts#formatCost -->

`PRICING_REFERENCE_DATE` is the `"YYYY-MM-DD"` string indicating when `PRICING_TABLE` was last compiled; every cost report carries this date so readers know whether the numbers are fresh or stale. `PRICING_TABLE` is a `Record<string, ModelPrice>` of USD per 1M tokens covering the Anthropic Claude 4.5 family (`claude-opus-4-5`, `claude-sonnet-5`, `claude-haiku-4`) and a small OpenAI-compat set (`gpt-4o`, `gpt-4o-mini`); it is intentionally short because stale prices are worse than transparent absence. `lookupPricing(model, override)` resolves a model through three tiers in this strict order: the caller's `override` argument (always wins), then `PRICING_TABLE`, and finally `{ tokensOnly: true }` when neither has the model — the function deliberately never invents a price. `calculateCostUsd(inputTokens, outputTokens, model, override)` multiplies token counts by the per-million prices from `lookupPricing` and returns `{ input, output, total, refDate }`, or `null` when the lookup is `tokensOnly`. `formatCost(cost, model)` produces the human-facing string: a `null` cost is rendered as `(no price for model <model>)` so the absence of data is explicit, and a numeric cost is rendered with four decimal places.

## Prompt test helpers

<!-- lw:anchors packages/core/src/prompts.test.ts#copyableAnchorMarkers packages/core/src/prompts.test.ts#outerFenceFor -->

These helpers exist only inside the prompt test suite. `copyableAnchorMarkers(text)` scans `text` for every HTML-comment `<!-- lw:anchors ... -->` marker and returns a `string[][]` — one inner array per marker, each containing the trimmed, whitespace-split list of keys. Tests use it to assert exact coverage and ordering of the closed-list keys emitted into a generated prompt. `outerFenceFor` selects the appropriate outer Markdown code fence (backtick count) for a given snippet so that nested fences inside prompt templates do not prematurely close the example block. Neither helper is part of the published core surface; they are documented here only because the prompts test file is in this module's path inventory.