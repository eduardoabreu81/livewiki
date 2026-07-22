---
title: core navigation, parser, pointer, presets, and pricing
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

# Core navigation, parser, pointer, presets, and pricing

This page documents the livewiki `packages/core/src` modules that build navigation metadata, parse source via web-tree-sitter, manage the opt-in `AGENTS.md`/`CLAUDE.md` pointer block, ship the embedded provider presets, and price LLM usage in USD.

## When to use this page

- **Build module, flow, and topic presentations** with `navigation.ts` loaders, sorters, and label helpers.
- **Parse source files** with `parser.ts`, look up grammars by extension, and inspect supported languages.
- **Resolve provider presets** and **estimate LLM cost in USD** using `presets.ts` and `pricing.ts`.
- **Manage the livewiki pointer block** in `AGENTS.md` or `CLAUDE.md` using pure helpers and I/O wrappers in `pointer.ts`.

## How it fits

The `packages/core/src` directory is the engine room of the livewiki CLI: `navigation.ts` reads the existing `livewiki/` tree and its frontmatter to produce hub pages; `parser.ts` wraps `web-tree-sitter` to expose typed ASTs of TypeScript, TSX/JSX, JavaScript, and Python; `pointer.ts` is the sole opt-in exception to safe I/O and edits `AGENTS.md`/`CLAUDE.md` only with explicit flags; `presets.ts` carries the embedded provider table that `.livewiki/config.json` references; and `pricing.ts` translates token counts into USD using a best-effort embedded table with user overrides. Test files (`*.test.ts`) cover each module's invariants. The excerpts in this page are truncated by token budget, so behavior described here covers only what the supplied source visibly establishes.

## Module presentations and label helpers

<!-- lw:anchors packages/core/src/navigation.ts#buildDisplayTitleFallbacks packages/core/src/navigation.ts#loadModulePresentations packages/core/src/navigation.ts#commonDirectory packages/core/src/navigation.ts#compareModules packages/core/src/navigation.ts#humanizeSegments packages/core/src/navigation.ts#normalizeLabel packages/core/src/navigation.ts#selectRelatedModules packages/core/src/navigation.ts#compareTopics packages/core/src/navigation.ts#sameStrings -->

`buildDisplayTitleFallbacks` produces a presentation-only fallback title per module id without changing module identity:

```ts
export function buildDisplayTitleFallbacks(modules: Module[]): Map<string, string> {
```

It sorts modules via `compareModules`, computes each module's `commonDirectory(paths)` segments, expands the candidate suffix outward until no collision remains, appends `"source"` when the trailing segments omit `src|source` even though deeper segments include it, and finally humanizes the result via `humanizeSegments`. Modules that share a directory get a `" — part N of M"` suffix derived from the directory-group ordering. `normalizeLabel` is the case- and whitespace-normalization helper used to compare titles against module ids.

`loadModulePresentations` reads `livewiki/<moduleId>.md` and returns a `Map<string, ModulePresentation>` whose `owner` field is one of `"generated" | "mixed" | "human" | null` based on the page frontmatter; a missing or unparseable frontmatter silently leaves `owner` as `null`. When the page's `title` differs (after `normalizeLabel`) from `module.id`, the frontmatter title is preferred over the fallback. The excerpt's `loadModulePresentations` signature is truncated after the parameter list, so behavior beyond the visible fallback-resolution path is not documented here.

`selectRelatedModules`, `compareTopics`, and `sameStrings` are exported sort/equality helpers used to order related modules, order topics by `planOrder`, and compare string arrays for equality.

## Topic, flow, and quickstart pages

<!-- lw:anchors packages/core/src/navigation.ts#loadTopicPresentations packages/core/src/navigation.ts#loadFlowPresentations packages/core/src/navigation.ts#generateTopicsIndex packages/core/src/navigation.ts#generateFlowsIndex packages/core/src/navigation.ts#generateAuxiliaryIndex packages/core/src/navigation.ts#generateQuickstart packages/core/src/navigation.ts#generateTasksPage packages/core/src/navigation.ts#ensureTopicsIndexScaffold packages/core/src/navigation.ts#syncTopicsIndexHub packages/core/src/navigation.ts#syncFlowsIndexHub packages/core/src/navigation.ts#syncAuxiliaryIndexHub packages/core/src/navigation.ts#readHubDeclaredOwner packages/core/src/navigation.ts#updateFlowTopicLinks packages/core/src/navigation.ts#updateModuleNavigateBlocks packages/core/src/navigation.ts#buildNavigateBlock -->

`loadTopicPresentations` and `loadFlowPresentations` walk the `livewiki/topics/` and `livewiki/flows/` directories (excluding the hub `index.md`) and parse each page's frontmatter; missing or malformed frontmatter degrades to honest defaults (`title: null` for flows, falling back to slug). `generateTopicsIndex`, `generateFlowsIndex`, `generateAuxiliaryIndex`, `generateQuickstart`, and `generateTasksPage` render the corresponding hub pages and use `AUXILIARY_ROLE_SECTIONS` to bucket fixture/tooling/docs modules. `ensureTopicsIndexScaffold` materializes the topic hub if absent.

`syncTopicsIndexHub`, `syncFlowsIndexHub`, and `syncAuxiliaryIndexHub` reconcile each hub against the live presentations; they strip pre-existing manual-region content before rewriting. `readHubDeclaredOwner` reports whether a hub is `"generated" | "human" | "mixed" | null` from its frontmatter:

```ts
function readHubDeclaredOwner(content: string): "generated" | "human" | "mixed" | null {
```

`updateFlowTopicLinks` rewrites the topic-related block bounded by the `TOPIC_RELATED_START` / `TOPIC_RELATED_END` markers inside flow pages; `updateModuleNavigateBlocks` rewrites the navigation block bounded by `NAV_START` / `NAV_END` inside module pages. Both helpers delegate to `buildNavigateBlock`, whose signature is not exposed in the supplied source — only its name and use site are visible here, and the excerpt does not establish exhaustive behavior for these sync/update routines.

## Parser and grammar cache

<!-- lw:anchors packages/core/src/parser.ts#initParser packages/core/src/parser.ts#grammarsDir packages/core/src/parser.ts#loadLanguage packages/core/src/parser.ts#grammarForExtension packages/core/src/parser.ts#parseSource packages/core/src/parser.ts#listSupportedGrammars packages/core/src/parser.ts#_grammarToExtensionForTest -->

`initParser` is a global, idempotent initializer:

```ts
export async function initParser(): Promise<void> {
```

It caches the underlying `Parser.init()` promise so repeated calls return the same in-flight or resolved promise. `grammarsDir` resolves the `grammars/` directory by trying `./package.json` (dev layout) and then `../package.json` (build layout) via `createRequire(import.meta.url)`; if both lookups fail it throws. The function is module-private, but is documented here because every other parser entry point depends on it.

`loadLanguage` is the WASM loader:

```ts
async function loadLanguage(name: string): Promise<Language> {
```

It first checks the in-process `languageCache` (loading WASM is expensive), then constructs `<grammarsDir>/tree-sitter-<name>.wasm`. If the file is absent, the loader throws an explicit "grammar WASM not found" error; if the file exists, it is loaded via `Language.load(wasmPath)` and cached. Module-private: callers go through `parseSource`.

`grammarForExtension` and `parseSource` are the public entry points:

```ts
export function grammarForExtension(ext: string): string | undefined {
export async function parseSource(
  ext: string,
  source: string,
): Promise<Tree> {
```

`grammarForExtension` is case-insensitive (the lower-cased extension is looked up in `EXT_TO_GRAMMAR`). `parseSource` awaits `initParser`, looks up the grammar for the lower-cased extension, throws when the extension has no grammar (`"Sem gramática tree-sitter para extensão <ext>"`), instantiates a fresh `Parser` per call, sets the language, parses the source, and throws if tree-sitter returns `null`. The extension-to-grammar table covers `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.py`, with `.jsx` mapped to the `tsx` grammar.

`listSupportedGrammars` returns grammar names derived from every `tree-sitter-*.wasm` file in `grammarsDir()` (empty array if the directory is missing). `_grammarToExtensionForTest` exposes the inverse `GRAMMAR_TO_EXT` map for tests that need to verify grammar → extension references:

```ts
export function _grammarToExtensionForTest(grammar: string): string | undefined {
```

## Pointer block in AGENTS.md / CLAUDE.md

<!-- lw:anchors packages/core/src/pointer.ts#POINTER_START packages/core/src/pointer.ts#POINTER_END packages/core/src/pointer.ts#POINTER_FILES packages/core/src/pointer.ts#pickPointerFile packages/core/src/pointer.ts#buildPointerBlock packages/core/src/pointer.ts#findPointerBlock packages/core/src/pointer.ts#applyPointerReplace packages/core/src/pointer.ts#applyPointerRemove packages/core/src/pointer.ts#insertPointer packages/core/src/pointer.ts#removePointer packages/core/src/pointer.ts#readPointerStatus packages/core/src/pointer.ts#ensurePointerFile packages/core/src/pointer.ts#_internal -->

The pointer module is the single opt-in exception to the safe-IO allow-list. The three exported constants anchor the marker grammar:

```ts
export const POINTER_START = "<!-- livewiki:start -->";
export const POINTER_END = "<!-- livewiki:end -->";
export const POINTER_FILES = ["AGENTS.md", "CLAUDE.md"] as const;
```

External parsers depend on these literals being byte-stable, so the test file pins them verbatim.

`pickPointerFile` decides which of the two allowed files to target:

```ts
export function pickPointerFile(
  hasAgentsMd: boolean,
  hasClaudeMd: boolean,
  requested?: PointerFile,
): PointerFile
```

It honors an explicit `requested` value, otherwise prefers `AGENTS.md` (when present), falls back to `CLAUDE.md`, and finally defaults to creating `AGENTS.md` when neither exists. `buildPointerBlock` returns the default PT-BR one-paragraph block pointing at `./livewiki/quickstart.md`; the pointer deliberately stays under 800 bytes so it does not duplicate wiki content:

```ts
export function buildPointerBlock(): string {
```

The pure helpers are the parsing/transform layer:

```ts
export function findPointerBlock(
  content: string,
): { startIdx: number; endIdx: number; inner: string } | null
export function applyPointerReplace(
  content: string,
  newBlock: string,
): { content: string; action: PointerAction }
export function applyPointerRemove(content: string): {
  content: string;
  removed: boolean;
}
```

`findPointerBlock` tolerates whitespace inside the markers and treats a truncated block (only `start` or only `end` present) as absent — it returns `null` rather than corrupting the document. `applyPointerReplace` returns `action: "inserted" | "replaced" | "unchanged"`; the `"unchanged"` branch fires when the replacement is byte-identical to the current content, which defends against no-op writes. `applyPointerRemove` collapses adjacent blank lines that bracket the removed block and returns `removed: false` when there was no block to strip.

The I/O wrappers (`insertPointer`, `removePointer`, `readPointerStatus`, `ensurePointerFile`) bridge the pure helpers to `node:fs/promises` and `safe-io.ts`. Their full bodies are truncated in the supplied source, so behavior beyond the visible signatures and the wrapping `Promise<PointerInsertResult>` shape is not documented here. `_internal` exposes `{ nodeFs }` for tests:

```ts
export const _internal = { nodeFs };
```

## Provider presets

<!-- lw:anchors packages/core/src/presets.ts#PRESET_TABLE packages/core/src/presets.ts#AVAILABLE_PRESETS packages/core/src/presets.ts#UnknownPresetError packages/core/src/presets.ts#UnknownPresetError.constructor packages/core/src/presets.ts#isKnownPreset packages/core/src/presets.ts#resolvePreset packages/core/src/presets.ts#resolveProviderConfig -->

`PRESET_TABLE` is the data-driven registry of ten providers (anthropic, openai, openrouter, deepseek, kimi, minimax, gemini, nvidia, ollama, lmstudio). Each entry carries `adapter`, `baseUrl`, `envVar`, `pricing`, `notes`, and optional `thinkingDefault` / `preferMaxCompletionTokens` / `defaultMaxOutputTokens` flags; `envVar` is a *name* only and the value is never serialized:

```ts
export const PRESET_TABLE: Record<PresetName, ProviderPreset> = {
export const AVAILABLE_PRESETS: readonly PresetName[] = [
```

`AVAILABLE_PRESETS` is the same list as a readonly `PresetName[]` for autocomplete and CLI listings. The test file locks down the table contents — including the rule that no entry contains an inline API key (regex sweep for `sk-`, `ghp_`, `gsk_` substrings).

`UnknownPresetError` is the error type for unsupported preset names:

```ts
export class UnknownPresetError extends Error {
  constructor(name: string, available: readonly string[]) {
```

Its constructor stores `presetName` and `available` and sets `this.name = "UnknownPresetError"`. The error message lists the available presets and points users at `.livewiki/config.json` or `--provider`.

`resolvePreset`, `resolveProviderConfig`, and `isKnownPreset` are the public lookups:

```ts
export function resolvePreset(name: string): ProviderPreset
export function resolveProviderConfig(args: { /* … */ }): /* … */
export function isKnownPreset(name: string): name is PresetName
```

`isKnownPreset` is a TypeScript type guard used to narrow `string` into `PresetName`. `resolvePreset` throws `UnknownPresetError` on unknown names; `resolveProviderConfig` layers a config-file override on top — the excerpt does not expose its parameter shape, so only the name and intent are documented here.

## Pricing table and cost calculation

<!-- lw:anchors packages/core/src/pricing.ts#PRICING_REFERENCE_DATE packages/core/src/pricing.ts#PRICING_TABLE packages/core/src/pricing.ts#lookupPricing packages/core/src/pricing.ts#calculateCostUsd packages/core/src/pricing.ts#formatCost -->

Pricing is a best-effort embedded table with explicit user overrides. The reference date signals staleness:

```ts
export const PRICING_REFERENCE_DATE = "2026-07-09";
export const PRICING_TABLE: PricingTable = {
```

`PRICING_TABLE` covers the Anthropic Claude 4.5 family (`claude-opus-4-5`, `claude-sonnet-5`, `claude-haiku-4`) and OpenAI-compat models (`gpt-4o`, `gpt-4o-mini`), each priced in USD per 1M tokens. The test file asserts every entry has strictly positive `input` and `output`.

`lookupPricing` is the priority chain:

```ts
export function lookupPricing(model: string, override?: PricingOverride): PricingLookup
```

Override → embedded table → `{ tokensOnly: true }`. The `tokensOnly` variant is the visible fail-open branch: when neither override nor table has the model, the function returns `{ tokensOnly: true }` rather than inventing a price, so reports can show token counts without fabricating USD.

`calculateCostUsd` computes one call's cost:

```ts
export function calculateCostUsd(
  inputTokens: number,
  outputTokens: number,
  model: string,
  override?: PricingOverride,
): { input: number; output: number; total: number; refDate: string } | null
```

It returns `null` when the lookup resolves to `tokensOnly`; otherwise it scales each token count by the price per 1M tokens and sums them. `formatCost` renders the total to four decimal places:

```ts
export function formatCost(cost: { total: number } | null, model: string): string
```

When `cost` is `null`, it returns the explicit literal `(no price for model <model>)` so the absence is visible in the report rather than hidden behind a fabricated zero.

## Prompt-builder test helpers

<!-- lw:anchors packages/core/src/prompts.test.ts#copyableAnchorMarkers packages/core/src/prompts.test.ts#outerFenceFor -->

`copyableAnchorMarkers` extracts every `lw:anchors` marker body from a prompt string and returns them as `string[][]` (one inner array per match, split on whitespace, empty tokens filtered). It underpins the prompt tests that verify stage-4 system prompts carry the canonical key list verbatim.

`outerFenceFor` is a helper used by the prompt-builder tests to pick the right outer code fence for a given prompt body; its body is truncated in the supplied source, so only its name and call-site role are documented here.

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
- Flow: [cli-src to core-src-07 — Command invocation through navigation hub emission](flows/cli-src-to-core-src-07.md)
- [Batch orchestration, config, index schema, and deterministic diagrams](core-src-03.md) — dependency and dependent
- [Core source — prompts, safe I/O, status, symbols, topics](core-src-08.md) — dependency and dependent
- [Export, frontmatter, flows, and hashing primitives](core-src-04.md) — dependency
<!-- livewiki:navigate:end -->
