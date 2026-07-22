---
title: Core navigation, parser, pointer, presets, and pricing reference
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

# Core navigation, parser, pointer, presets, and pricing reference

This page documents the symbols exported from `packages/core/src` covered by the `core-src-07` inventory: navigation hub generation, tree-sitter parsing, AGENTS.md/CLAUDE.md pointer maintenance, provider presets, and the cost/pricing table.

## When to use this page

- **Inspect** how navigation hub pages and pointer blocks are generated, synced, and gated by the declared-owner check.
- **Resolve** a provider preset and pricing override, then calculate the USD cost of an LLM call against the embedded table.
- **Parse** source code with the embedded tree-sitter grammars and maintain the opt-in pointer block in `AGENTS.md` or `CLAUDE.md`.

## How it fits

This module sits inside `packages/core/src` and groups together the deterministic, side-effectful surfaces that back the livewiki batch and navigation commands. Navigation code reads module metadata, walks repository pages, and renders the navigation hubs into `livewiki/`. The parser module exposes a thin wrapper around `web-tree-sitter` and is the single place where grammar WASM files are located and cached. The pointer module is the opt-in exception to the safe-IO boundary: it is the only code allowed to touch `AGENTS.md` / `CLAUDE.md`, and only when explicitly invoked. The presets module is a pure data table that the rest of core consumes to resolve provider configuration; pricing depends on it. The excerpt shown here is truncated, so several functions are documented from their visible signature plus the visible prologue rather than full bodies.

## Navigation: module presentations and fallbacks

<!-- lw:anchors packages/core/src/navigation.ts#buildDisplayTitleFallbacks packages/core/src/navigation.ts#commonDirectory packages/core/src/navigation.ts#compareModules packages/core/src/navigation.ts#humanizeSegments packages/core/src/navigation.ts#loadModulePresentations packages/core/src/navigation.ts#normalizeLabel packages/core/src/navigation.ts#readHubDeclaredOwner packages/core/src/navigation.ts#sameStrings -->

The visible symbols here produce a per-module presentation: a display title, a flag for whether the page exists, and the owner kind read from frontmatter. `buildDisplayTitleFallbacks` is the pure function that synthesizes human-facing titles without changing module identity:

```ts
export function buildDisplayTitleFallbacks(modules: Module[]): Map<string, string> {
```

It sorts modules with `compareModules`, computes the `commonDirectory` of each module's paths, then picks the longest trailing directory segment that does not collide with another module. If every candidate collides, it falls back to `["repository"]` and, when the source tree contains `src` or `source`, appends `"source"` to disambiguate. When two or more modules share the same directory key, it appends ` — part N of M`. The fallback title is then humanized via `humanizeSegments` and post-processed so that if it normalizes to the same label as the module id, ` module` is appended.

`loadModulePresentations` is the async version that reads `livewiki/<moduleId>.md`, parses frontmatter, and surfaces `owner` (`generated` | `mixed` | `human` | `null`) and any human-supplied `title` that is non-empty and not just the module id repeated. When `safeIo.exists` rejects, `pageExists` is `false`. When the file exists but frontmatter parsing throws, the navigation metadata is treated as untrusted — `owner` stays `null` and the fallback title is used. This is the visible fail-closed branch; the excerpt does not establish exhaustive behavior.

`readHubDeclaredOwner(content: string): "generated" | "human" | "mixed" | null` parses a hub page body and returns the declared owner kind, used by sync routines to decide whether to overwrite a hub. `sameStrings` is an exact-equality helper used by comparison/sorting paths. `normalizeLabel` is the canonical label comparison used for idempotency checks.

## Navigation: flows and topics loading

<!-- lw:anchors packages/core/src/navigation.ts#loadFlowPresentations packages/core/src/navigation.ts#loadTopicPresentations packages/core/src/navigation.ts#compareTopics -->

`loadFlowPresentations` reads every `livewiki/flows/<slug>.md` page except `index.md` and yields `{ slug, title, modules }`. The visible prologue promises an honest degradation: when frontmatter is missing or unparseable, `title` is `null` and the hub falls back to the slug. The function short-circuits to an empty map when the `livewiki/flows` directory is absent (after swallowing `safeIo.exists` rejections).

`loadTopicPresentations` is the analogous function for the `livewiki/topics/` directory and produces `TopicPresentation` records (slug, title, intent, modules, flows, owner, planOrder). `compareTopics` orders topics for stable rendering. The excerpt does not show the bodies of these functions.

## Navigation: index and page generators

<!-- lw:anchors packages/core/src/navigation.ts#generateAuxiliaryIndex packages/core/src/navigation.ts#generateFlowsIndex packages/core/src/navigation.ts#generateQuickstart packages/core/src/navigation.ts#generateTasksPage packages/core/src/navigation.ts#generateTopicsIndex packages/core/src/navigation.ts#selectRelatedModules packages/core/src/navigation.ts#buildNavigateBlock -->

These pure renderers turn presentation data into Markdown bodies:

```ts
export function generateQuickstart(opts: {
export function generateTasksPage(opts: {
export function generateAuxiliaryIndex(opts: {
export function generateFlowsIndex(opts: {
export function generateTopicsIndex(opts: {
export function selectRelatedModules(opts: {
```

`generateAuxiliaryIndex` uses the visible `AUXILIARY_ROLE_SECTIONS` table (fixture → "Test fixtures", tooling → "Tooling and benchmarks", docs → "Repository documentation") to bucket modules by `classifyModuleRole`. `generateFlowsIndex` and `generateTopicsIndex` render their respective hubs. `generateQuickstart` and `generateTasksPage` produce the user-facing entry pages. `selectRelatedModules` chooses which neighbors to surface in a module's related-modules block.

`buildNavigateBlock` constructs the `

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
- Flow: [CLI entry to navigation rendering across core-src modules](flows/cli-src-to-core-src-07.md)
- [Batch orchestration, configuration, index, and diagram generation](core-src-03.md) — dependency and dependent
- [Stage-5 planning, prompt templates, and safe disk I/O core](core-src-08.md) — dependency and dependent
- [Livewiki core source — export, flows, frontmatter, gitignore, hashes](core-src-04.md) — dependency
<!-- livewiki:navigate:end -->` block used inside module pages. The constants `NAV_START`, `NAV_END`, `TOPIC_RELATED_START`, and `TOPIC_RELATED_END` are visible in the prologue, and `MANUAL_BLOCK_RE` is the regex used to strip manual blocks when rewriting navigation.

## Navigation: index hub sync and updates

<!-- lw:anchors packages/core/src/navigation.ts#syncAuxiliaryIndexHub packages/core/src/navigation.ts#syncFlowsIndexHub packages/core/src/navigation.ts#syncTopicsIndexHub packages/core/src/navigation.ts#ensureTopicsIndexScaffold packages/core/src/navigation.ts#updateFlowTopicLinks packages/core/src/navigation.ts#updateModuleNavigateBlocks -->

These are the I/O side of the navigation module — they read existing hubs, decide whether to overwrite them, and write the result back:

```ts
export async function syncTopicsIndexHub(
export async function syncFlowsIndexHub(
export async function syncAuxiliaryIndexHub(opts: {
export async function ensureTopicsIndexScaffold(
export async function updateFlowTopicLinks(
export async function updateModuleNavigateBlocks(opts: {
```

`readHubDeclaredOwner` is the gate these routines use: if the hub declares owner `human`, the sync routines must not overwrite it. The visible `MANUAL_BLOCK_RE` shows that manual sections are preserved through rewrites. `ensureTopicsIndexScaffold` materializes a starter topics index when none exists. The excerpt does not show the bodies of any of these async functions, so the precise write strategy (overwrite vs patch, atomic rename, etc.) is not established here.

## Parser: tree-sitter initialization and grammar lookup

<!-- lw:anchors packages/core/src/parser.ts#initParser packages/core/src/parser.ts#grammarsDir packages/core/src/parser.ts#grammarForExtension packages/core/src/parser.ts#listSupportedGrammars packages/core/src/parser.ts#loadLanguage packages/core/src/parser.ts#_grammarToExtensionForTest -->

`initParser` is the idempotent WASM-runtime initializer:

```ts
export async function initParser(): Promise<void> {
```

It memoizes the `Parser.init()` promise in `initPromise`; subsequent calls return the same resolved promise. This is the documented "global, idempotent" contract.

`grammarsDir` locates the `grammars/` folder by walking up from `import.meta.url` and trying `./package.json` then `../package.json` via `createRequire`. If both fail it throws — that throw is the visible fail-closed branch when the package layout is unexpected.

```ts
export function grammarForExtension(ext: string): string | undefined {
export function listSupportedGrammars(): string[] {
export function _grammarToExtensionForTest(grammar: string): string | undefined {
```

`grammarForExtension` lowercases the extension and looks it up in `EXT_TO_GRAMMAR`, returning `undefined` for unknown extensions. `listSupportedGrammars` reads `grammarsDir()` synchronously, filters `.wasm` files, and strips the `tree-sitter-` prefix and `.wasm` suffix; it returns `[]` when the directory is absent. `_grammarToExtensionForTest` is the inverse helper used by tests. `loadLanguage` caches `Language` instances by grammar name and throws when the WASM file is missing.

The visible `EXT_TO_GRAMMAR` covers: `.ts → typescript`, `.tsx → tsx`, `.js → javascript`, `.jsx → tsx`, `.mjs → javascript`, `.cjs → javascript`, `.py → python`.

## Parser: source parsing

<!-- lw:anchors packages/core/src/parser.ts#parseSource -->

`parseSource` is the public parse entry point:

```ts
export async function parseSource(
  ext: string,
  source: string,
): Promise<Tree> {
```

It calls `initParser()` (idempotent), resolves the grammar for the lowercase extension, and throws when no grammar is registered for the extension — the test suite asserts the message matches `/Sem gramática/`. It then loads the cached `Language`, builds a fresh `Parser`, sets the language, and parses. If `parser.parse(source)` returns `null`, the function throws — the visible comment notes that this only happens for genuinely exceptional inputs (e.g. empty source); the function never propagates `null`. The Tree is returned to the caller for AST traversal.

## Pointer: constants and file selection

<!-- lw:anchors packages/core/src/pointer.ts#POINTER_END packages/core/src/pointer.ts#POINTER_FILES packages/core/src/pointer.ts#POINTER_START packages/core/src/pointer.ts#pickPointerFile packages/core/src/pointer.ts#buildPointerBlock packages/core/src/pointer.ts#_internal -->

The pointer module is the only sanctioned exception to the `safe-io` boundary. Its public constants define the marker pair and the allowed file list:

```ts
export const POINTER_START = "<!-- livewiki:start -->";
export const POINTER_END = "<!-- livewiki:end -->";
export const POINTER_FILES = ["AGENTS.md", "CLAUDE.md"] as const;
```

These values are stable — external parsers may depend on them. `POINTER_FILES` is the visible enforcement of "SPEC rule #2" — the pointer only writes to one of those two files, never elsewhere.

`pickPointerFile` chooses the target:

```ts
export function pickPointerFile(
  hasAgentsMd: boolean,
  hasClaudeMd: boolean,
  requested?: PointerFile,
): PointerFile
```

If `requested` is given, it wins. Otherwise, `AGENTS.md` is preferred when present, then `CLAUDE.md`, and `AGENTS.md` is the default when neither exists.

`buildPointerBlock()` produces the default block body, which is intentionally short — one PT-BR paragraph pointing to `./livewiki/quickstart.md`. The block is bounded to <800 characters by a defensive test.

`_internal = { nodeFs }` exposes the underlying `node:fs/promises` module for tests that need to stub filesystem behavior; it is not part of the public surface for end users.

## Pointer: block parsing and pure transforms

<!-- lw:anchors packages/core/src/pointer.ts#findPointerBlock packages/core/src/pointer.ts#applyPointerRemove packages/core/src/pointer.ts#applyPointerReplace -->

`findPointerBlock` is the pure parser:

```ts
export function findPointerBlock(
  content: string,
): { startIdx: number; endIdx: number; inner: string } | null
```

It uses tolerant regexes (`<!--\s*livewiki:start\s*-->`, `<!--\s*livewiki:end\s*-->`) so leading/trailing whitespace (BOM/CRLF) does not break parsing. If either marker is missing, it returns `null` rather than guessing — the visible comment calls this a defense against truncating or corrupting the document.

`applyPointerReplace` is the pure insert-or-replace transform:

```ts
export function applyPointerReplace(
  content: string,
  newBlock: string,
): { content: string; action: PointerAction }
```

When no block is present it appends with a single blank-line separator (and only when `content` is non-empty). When a block is present it slices around `startIdx`/`endIdx` and splices `newBlock` in. It returns `action: "unchanged"` when the spliced string is byte-equal to the original — a guard against no-op writes. Visible actions are `"inserted" | "replaced" | "unchanged"`.

`applyPointerRemove` is the pure removal transform:

```ts
export function applyPointerRemove(content: string): {
  content: string;
  removed: boolean;
}
```

It returns `{ removed: false, content }` when no block exists, otherwise strips the block plus adjacent whitespace so that one stray blank line does not survive. The excerpt truncates before the exact whitespace rule is finalized.

## Pointer: filesystem-touching routines

<!-- lw:anchors packages/core/src/pointer.ts#ensurePointerFile packages/core/src/pointer.ts#insertPointer packages/core/src/pointer.ts#readPointerStatus packages/core/src/pointer.ts#removePointer -->

These functions pair the pure transforms above with `node:fs/promises` and `safeIo`:

```ts
export async function insertPointer(
export async function removePointer(
export async function readPointerStatus(
export async function ensurePointerFile(
```

`insertPointer` and `removePointer` are the I/O wrappers: they call `pickPointerFile`, read the file, run the pure transform (`applyPointerReplace` / `applyPointerRemove`), and write back through `safeIo`. Because the visible transform is pure, the I/O wrapper is the only place that can hit a `throw`. `readPointerStatus` reports whether the block is present, absent, or truncated (per `findPointerBlock`'s `null` semantics). `ensurePointerFile` creates the file (with default `AGENTS.md`) when neither pointer file exists. The excerpt does not show the bodies, so the precise error-handling contract (throw vs swallow) is not established here.

## Presets: data table and errors

<!-- lw:anchors packages/core/src/presets.ts#PRESET_TABLE packages/core/src/presets.ts#AVAILABLE_PRESETS packages/core/src/presets.ts#UnknownPresetError packages/core/src/presets.ts#UnknownPresetError.constructor -->

The presets module is pure data: ten providers wired with adapter, baseUrl, envVar, pricing, and operational notes. The full table is `PRESET_TABLE: Record<PresetName, ProviderPreset>`, and `AVAILABLE_PRESETS` is the `readonly PresetName[]` enumeration in the same order as SPEC §Stack. The visible excerpt covers `anthropic`, `openai`, and the start of `openrouter`; the test suite asserts all ten names are present and ordered: `["anthropic", "deepseek", "gemini", "kimi", "lmstudio", "minimax", "nvidia", "ollama", "openai", "openrouter"]`.

The table enforces a "key never inline" rule: env vars are referenced by name only, and the test suite asserts that no stringified preset matches `sk-…`, `ghp_…`, or `gsk_…` patterns. Local presets (`ollama`, `lmstudio`) carry explicit `0`/`0` prices rather than omitting pricing — the visible comment notes this is to keep reports honest.

`UnknownPresetError` is thrown by `resolvePreset` for unknown names:

```ts
export class UnknownPresetError extends Error {
  constructor(name: string, available: readonly string[]) {
```

Its message lists the available names and points the user to `.livewiki/config.json` or `--provider`. It exposes `presetName` and `available` as readonly fields.

## Presets: resolution and type guards

<!-- lw:anchors packages/core/src/presets.ts#isKnownPreset packages/core/src/presets.ts#resolvePreset packages/core/src/presets.ts#resolveProviderConfig -->

```ts
export function isKnownPreset(name: string): name is PresetName
export function resolvePreset(name: string): ProviderPreset
export function resolveProviderConfig(args: {
```

`isKnownPreset` is the type guard; it narrows `string` to `PresetName`. `resolvePreset` calls it and either returns the matching `PRESET_TABLE` entry or throws `UnknownPresetError` (the visible fail-closed branch for typos). `resolveProviderConfig` is the merge point: it takes user-supplied overrides from `.livewiki/config.json`, merges them on top of a preset, and returns the final `ProviderPreset` used by adapters. The exact merge order is not visible in the excerpt — the function signature is shown without the body.

The `PresetAdapter` type aliases `LlmProvider`, so adapter choices made by the preset flow directly into client construction. The visible `thinkingDefault` field (`"disabled" | "adaptive" | "omit" | "n/a"`) drives whether the client sends a `thinking` parameter; local presets and providers without thinking support carry `"n/a"` and are treated as `omit`.

## Pricing: embedded table and reference date

<!-- lw:anchors packages/core/src/pricing.ts#PRICING_REFERENCE_DATE packages/core/src/pricing.ts#PRICING_TABLE -->

`PRICING_TABLE` is a small, deliberate snapshot of USD-per-1M-tokens prices:

```ts
export const PRICING_TABLE: PricingTable = {
  "claude-opus-4-5": { input: 15, output: 75 },
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-haiku-4": { input: 0.8, output: 4 },
  "gpt-4o": { input: 5, output: 15 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
};
```

`PRICING_REFERENCE_DATE = "2026-07-09"` is the snapshot date. The module's docstring warns that prices are best-effort and stale data is worse than transparent reporting — every cost object carries `refDate` so the user knows what they're looking at. The test asserts that input/output prices are positive numbers; presets additionally test that local providers report `0`/`0` explicitly rather than being absent.

## Pricing: lookup and cost math

<!-- lw:anchors packages/core/src/pricing.ts#lookupPricing packages/core/src/pricing.ts#calculateCostUsd packages/core/src/pricing.ts#formatCost -->

```ts
export function lookupPricing(model: string, override?: PricingOverride): PricingLookup
export function calculateCostUsd(
  inputTokens: number,
  outputTokens: number,
  model: string,
  override?: PricingOverride,
): { input: number; output: number; total: number; refDate: string } | null
export function formatCost(cost: { total: number } | null, model: string): string
```

`lookupPricing` consults `override[model]` first, then `PRICING_TABLE[model]`. On a miss it returns `{ tokensOnly: true }` — never invents a price. The successful branch returns `{ tokensOnly: false, inputUsd, outputUsd, refDate }`.

`calculateCostUsd` is the call-level math. It divides tokens by `1_000_000` to apply the per-1M rate, computes input and output components, sums them, and tags the result with `refDate`. It returns `null` when `lookupPricing` reports `tokensOnly` — the visible fail-open-to-tokens branch, where reports intentionally omit USD rather than fabricate it.

`formatCost` is the human-facing formatter. With a non-null cost it returns `$<total.toFixed(4)>`. With `null` it returns `(no price for model <model>)` — the comment is explicit that absence is shown rather than hidden.

## Prompt test helpers

<!-- lw:anchors packages/core/src/prompts.test.ts#copyableAnchorMarkers packages/core/src/prompts.test.ts#outerFenceFor -->

These two helpers live in `prompts.test.ts` and are imported by the prompt-spec assertions:

```ts
function copyableAnchorMarkers(text: string): string[][] {
function outerFenceFor(
```

`copyableAnchorMarkers` extracts every `<!-- lw:anchors ... -->` marker body from a prompt string, splitting the body on whitespace and dropping empty tokens. The test suite uses it to assert that the closed list of canonical keys is reproduced verbatim in the stage 4 user prompt and that the prompt forbids aggregate/summary marker patterns. The function name is misleading only by intent — it returns marker bodies (the strings between `lw:anchors` and `-->`), not parsed anchors.

`outerFenceFor` is referenced by the same test file but its body is truncated in the supplied excerpt; the visible tests do not call it directly, so it appears to be a helper for wrapping prompt snippets in fenced code blocks. The signature is shown without the parameters or return type, so the exact contract is not established here.