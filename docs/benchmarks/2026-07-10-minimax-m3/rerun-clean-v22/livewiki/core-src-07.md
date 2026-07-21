---
title: Core source utilities for navigation, parsing, pointer files, presets, and pricing
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

# Core source utilities

This page documents the core library surface for navigation generation, source parsing, AGENTS.md/CLAUDE.md pointer management, provider preset resolution, and USD pricing lookups.

## When to use this page

- **Generate** navigation metadata and hub pages for modules, flows, and topics using `navigation.ts`.
- **Parse** TypeScript, TSX, JavaScript, or Python source files into a tree-sitter tree via `parser.ts`.
- **Resolve** a provider preset (anthropic, openai, ollama, and others) to a base URL, adapter, and env var name with `presets.ts`.
- **Look up** per-model USD pricing and compute call cost with `pricing.ts`.

## How it fits

The `packages/core/src` directory hosts the engine used by the livewiki CLI. `navigation.ts` derives `ModulePresentation`, `FlowPresentation`, and `TopicPresentation` records and renders quickstart, tasks, flows-index, topics-index, and auxiliary-index pages, while leaving module identity anchored to `Module.id`. `parser.ts` wraps `web-tree-sitter`, caching `Language` objects per grammar name and resolving the `.wasm` directory from this package's own `package.json`. `pointer.ts` is the only writer outside `safe-io` that may touch `AGENTS.md` / `CLAUDE.md`, and only when explicitly invoked. `presets.ts` is a pure data table feeding the LLM client factory; `pricing.ts` is a lookup layered with `PricingOverride` from `.livewiki/config.json`. The two `prompts.test.ts` helpers (`copyableAnchorMarkers`, `outerFenceFor`) parse prompt strings during test runs.

## Navigation helpers — building per-module and per-flow presentations

<!-- lw:anchors packages/core/src/navigation.ts#buildDisplayTitleFallbacks packages/core/src/navigation.ts#loadModulePresentations packages/core/src/navigation.ts#loadFlowPresentations packages/core/src/navigation.ts#loadTopicPresentations packages/core/src/navigation.ts#compareModules packages/core/src/navigation.ts#commonDirectory packages/core/src/navigation.ts#humanizeSegments packages/core/src/navigation.ts#normalizeLabel packages/core/src/navigation.ts#compareTopics -->

The presentation layer turns raw `Module`/`Flow` records into title-bearing metadata suitable for hub rendering. `buildDisplayTitleFallbacks` builds a presentation-only title map keyed by `Module.id`; the `module.id` field remains the sole identity used by graphs, pages, tasks, checkpoints, anchors, and filenames.

```ts
export function buildDisplayTitleFallbacks(modules: Module[]): Map<string, string> {
```

The function sorts modules via `compareModules`, finds `commonDirectory(module.paths)` for each, derives a humanized suffix via `humanizeSegments`, detects collisions with siblings in the same directory group, and appends `— part N of M` when a directory bucket contains multiple modules. A segment equal (case-insensitively) to the module's literal `id` triggers a `… module` suffix to keep titles distinct.

`loadModulePresentations(repoRoot, modules)` reads the existing `livewiki/<moduleId>.md` page when present, parses its frontmatter, and lifts `owner` and `title` into the returned `ModulePresentation` map. A malformed page is not trusted: it falls through to the fallback title and `owner: null`, and a missing page is reported as `pageExists: false`. `loadFlowPresentations(repoRoot)` reads every `livewiki/flows/<slug>.md` except `index.md`; absent or unparseable frontmatter degrades to `title: null`. `loadTopicPresentations` is the analogous function for topics. `compareModules` and `compareTopics` are the deterministic sort comparators used by all three loaders. `commonDirectory`, `humanizeSegments`, and `normalizeLabel` are pure helpers used both by `buildDisplayTitleFallbacks` and by other presentation code in this module.

## Navigation helpers — generating and syncing hub pages

<!-- lw:anchors packages/core/src/navigation.ts#generateQuickstart packages/core/src/navigation.ts#generateTasksPage packages/core/src/navigation.ts#generateAuxiliaryIndex packages/core/src/navigation.ts#generateFlowsIndex packages/core/src/navigation.ts#generateTopicsIndex packages/core/src/navigation.ts#ensureTopicsIndexScaffold packages/core/src/navigation.ts#syncTopicsIndexHub packages/core/src/navigation.ts#syncFlowsIndexHub packages/core/src/navigation.ts#syncAuxiliaryIndexHub packages/core/src/navigation.ts#readHubDeclaredOwner -->

These functions render markdown for the four hub pages (`quickstart`, `tasks`, `flows/index`, `topics/index`) plus an auxiliary index that surfaces fixtures, tooling, and repository documentation. The `generate*` family is pure: given the loaded presentations, they return the rendered string. `ensureTopicsIndexScaffold` and the `sync*IndexHub` family read the current on-disk hub, compare it to the freshly generated content, and either leave the file untouched or rewrite it. `readHubDeclaredOwner` inspects the existing file to distinguish `generated`, `human`, `mixed`, or `null` ownership before any overwrite, so manually maintained hubs are never silently overwritten by a sync.

The visible `NAV_START`/`NAV_END` and `TOPIC_RELATED_START`/`TOPIC_RELATED_END` markers delimit the bounded regions inside module pages that this module is allowed to overwrite. The `MANUAL_BLOCK_RE` regex identifies `lw:manual` regions, which are reserved for human-authored content and skipped during sync. The excerpt does not establish the full overwrite policy; refer to the source for the exact merge logic.

## Navigation helpers — links, related modules, and small utilities

<!-- lw:anchors packages/core/src/navigation.ts#updateModuleNavigateBlocks packages/core/src/navigation.ts#updateFlowTopicLinks packages/core/src/navigation.ts#selectRelatedModules packages/core/src/navigation.ts#buildNavigateBlock packages/core/src/navigation.ts#sameStrings -->

`updateModuleNavigateBlocks` rewrites the bounded `NAV_START`/`NAV_END` region in each module page with a freshly rendered navigation block, while `updateFlowTopicLinks` rewrites the bounded `TOPIC_RELATED_START`/`TOPIC_RELATED_END` region in each topic page. Both functions are idempotent and preserve surrounding human-authored content. `selectRelatedModules(opts)` chooses which `RelatedModule` entries (with `direction: "dependency" | "dependent" | "both"`) to surface for a given module. `buildNavigateBlock` is the lower-level helper that composes the navigate-region markdown. `sameStrings(a, b)` is a strict-equal helper used by multiple sync paths.

## Tree-sitter parser wrapper

<!-- lw:anchors packages/core/src/parser.ts#initParser packages/core/src/parser.ts#grammarsDir packages/core/src/parser.ts#loadLanguage packages/core/src/parser.ts#grammarForExtension packages/core/src/parser.ts#parseSource packages/core/src/parser.ts#listSupportedGrammars packages/core/src/parser.ts#_grammarToExtensionForTest -->

```ts
export async function initParser(): Promise<void> {
```

`initParser` is a global, idempotent initializer for the WASM runtime: subsequent calls return the same in-flight `initPromise`. `grammarsDir()` resolves the directory containing the `.wasm` files by walking from `import.meta.url` to this package's own `package.json` (trying `./package.json` then `../package.json` to cover both dev/`src/` and build/`dist/` layouts); if neither exists it throws.

`loadLanguage(name)` is a memoized loader: cached `Language` objects are reused, and a missing `tree-sitter-<name>.wasm` throws rather than falling back. `grammarForExtension(ext)` is case-insensitive and returns the grammar name (`"typescript"`, `"tsx"`, `"javascript"`, `"python"`) or `undefined` for unknown extensions. `parseSource(ext, source)` is the public entry point: it ensures `initParser` has run, looks up the grammar, loads (or reuses) the `Language`, parses the source, and throws if tree-sitter returns `null`. `listSupportedGrammars()` scans the grammar directory and returns the names of every `.wasm` file present. `_grammarToExtensionForTest` is exported only so tests can confirm that each loaded grammar is also reachable from at least one extension.

## Pointer block — markers, block construction, and pure transforms

<!-- lw:anchors packages/core/src/pointer.ts#POINTER_START packages/core/src/pointer.ts#POINTER_END packages/core/src/pointer.ts#POINTER_FILES packages/core/src/pointer.ts#buildPointerBlock packages/core/src/pointer.ts#findPointerBlock packages/core/src/pointer.ts#applyPointerReplace packages/core/src/pointer.ts#applyPointerRemove packages/core/src/pointer.ts#pickPointerFile -->

```ts
export const POINTER_START = "<!-- livewiki:start -->";
```

```ts
export const POINTER_END = "<!-- livewiki:end -->";
```

```ts
export const POINTER_FILES = ["AGENTS.md", "CLAUDE.md"] as const;
```

The marker strings are stable constants: external parsers (including the livewiki tests in `pointer.test.ts`) depend on their exact bytes. `buildPointerBlock()` returns the default block content — one short PT-BR paragraph and a single relative link to `./livewiki/quickstart.md`. The block is deliberately kept under 800 bytes; the tests assert this as a regression guard against silent duplication of wiki content into AGENTS.md/CLAUDE.md.

`findPointerBlock(content)` is the pure parser: it returns `{ startIdx, endIdx, inner }` for a well-formed block or `null` if either marker is missing or whitespace-truncated. The search tolerates leading whitespace and extra spaces inside markers (defense against CRLF/BOM). `applyPointerReplace(content, newBlock)` either appends (`"inserted"`) when no block exists, replaces in place (`"replaced"`), or returns `"unchanged"` when the new block is byte-identical to the existing one. `applyPointerRemove(content)` returns `{ content, removed }` and trims one adjacent blank line so the file stays clean. `pickPointerFile(hasAgentsMd, hasClaudeMd, requested?)` decides the target: explicit request wins, otherwise `AGENTS.md` is preferred, falling back to `CLAUDE.md` or `AGENTS.md` (for new files).

## Pointer block — filesystem operations

<!-- lw:anchors packages/core/src/pointer.ts#insertPointer packages/core/src/pointer.ts#removePointer packages/core/src/pointer.ts#readPointerStatus packages/core/src/pointer.ts#ensurePointerFile packages/core/src/pointer.ts#_internal -->

The filesystem layer composes the pure helpers with `safe-io` so that writes to AGENTS.md/CLAUDE.md go through the same allowPointer path. `insertPointer(repoRoot, opts)` resolves the target file via `pickPointerFile`, reads the current content if any, calls `applyPointerReplace`, and writes back the result. The returned `PointerInsertResult` carries the chosen file, the action (`"inserted" | "replaced" | "unchanged"`), and `bytesWritten` (zero on `"unchanged"`). `removePointer(repoRoot, opts)` is the inverse: it removes the block if present and reports whether anything was changed. `readPointerStatus(repoRoot)` reports presence/absence of the block on the preferred file without modifying it. `ensurePointerFile(repoRoot, file)` makes sure the chosen pointer file exists (creating an empty one if needed) so subsequent `insertPointer` calls have a target. `_internal` re-exports `nodeFs` strictly for test seams; it is not a public extension surface.

## Provider presets — data table and resolution

<!-- lw:anchors packages/core/src/presets.ts#PRESET_TABLE packages/core/src/presets.ts#AVAILABLE_PRESETS packages/core/src/presets.ts#UnknownPresetError packages/core/src/presets.ts#UnknownPresetError.constructor packages/core/src/presets.ts#resolvePreset packages/core/src/presets.ts#resolveProviderConfig packages/core/src/presets.ts#isKnownPreset -->

```ts
export const PRESET_TABLE: Record<PresetName, ProviderPreset> = {
```

`PRESET_TABLE` is the single source of truth for the 10 known providers (`anthropic`, `openai`, `openrouter`, `deepseek`, `kimi`, `minimax`, `gemini`, `nvidia`, `ollama`, `lmstudio`). Each `ProviderPreset` carries `adapter` (`"anthropic" | "openai-compat"`), `baseUrl`, `envVar`, a default `pricing` map, free-form `notes`, and optional `thinkingDefault` / `preferMaxCompletionTokens` / `defaultMaxOutputTokens` flags. The `minimax` preset is deliberately Anthropic-compat to inherit prompt caching. The `notes` field is operational context only — `key-leak.test.ts` enforces that no preset carries an API key inline. `AVAILABLE_PRESETS` mirrors the table keys in canonical order.

```ts
constructor(name: string, available: readonly string[]) {
```

`UnknownPresetError` is thrown by `resolvePreset(name)` when the name is not in `PRESET_TABLE`. Its message lists the available presets and points users at `.livewiki/config.json` or `--provider`. `resolvePreset(name)` returns the matching `ProviderPreset` or throws. `isKnownPreset(name)` is a type guard narrowing `string` to `PresetName`. `resolveProviderConfig(args)` merges a `PRESET_TABLE` entry with user overrides and resolves the API key from `process.env[<envVar>]` — this is the only place keys are read, and the resolved config carries the value, never the env var name, downstream.

## Pricing — table, lookup, and cost calculation

<!-- lw:anchors packages/core/src/pricing.ts#PRICING_REFERENCE_DATE packages/core/src/pricing.ts#PRICING_TABLE packages/core/src/pricing.ts#lookupPricing packages/core/src/pricing.ts#calculateCostUsd packages/core/src/pricing.ts#formatCost -->

```ts
export const PRICING_REFERENCE_DATE = "2026-07-09";
```

```ts
export function lookupPricing(model: string, override?: PricingOverride): PricingLookup {
```

`PRICING_REFERENCE_DATE` is the compile date of the embedded `PRICING_TABLE`. Every successful `lookupPricing` echoes this date on its result so reports tell users whether they are looking at fresh or stale prices. `PRICING_TABLE` itself covers the MVP model set: `claude-opus-4-5`, `claude-sonnet-5`, `claude-haiku-4`, `gpt-4o`, `gpt-4o-mini` (USD per 1M tokens).

`lookupPricing(model, override?)` resolves in priority order: `override[model]` first, then `PRICING_TABLE[model]`. When neither exists it returns `{ tokensOnly: true }` — the caller is expected to surface "tokens without USD" rather than fabricate a number. On hit it returns `{ tokensOnly: false, inputUsd, outputUsd, refDate }`. `calculateCostUsd(inputTokens, outputTokens, model, override?)` multiplies tokens by USD/1M, returning `{ input, output, total, refDate }` or `null` for unknown models. `formatCost(cost, model)` renders the human-readable string: `"$<total.toFixed(4)>"` for a real cost, or `"(no price for model <model>)"` when the cost is `null`.

## Prompts test helpers

<!-- lw:anchors packages/core/src/prompts.test.ts#copyableAnchorMarkers packages/core/src/prompts.test.ts#outerFenceFor -->

```ts
function copyableAnchorMarkers(text: string): string[][] {
```

`copyableAnchorMarkers` extracts the body of every `lw:anchors` marker from a prompt string and returns the list of whitespace-split key arrays. It underpins the assertion that the stage-4 system prompt contains the COMPLETENESS rule, the primary-section rule, and the never-abbreviated rule for anchor markers.

`outerFenceFor(text)` finds the outer Markdown fenced-code block surrounding a given snippet and is used by the prompts tests to assert that quoted code samples remain balanced. The excerpt does not establish the full body of `outerFenceFor`; only its signature and use as a test helper are visible here.

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
- [Batch orchestration, config, index DB, and diagram generators](core-src-03.md) — dependency and dependent
- [Core prompt, I/O allowlist, symbol extraction, status and topic planning](core-src-08.md) — dependency and dependent
- [Wiki export, flow detection, and parser helpers](core-src-04.md) — dependency
<!-- livewiki:navigate:end -->
