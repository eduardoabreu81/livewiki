---
title: Core src 07 — navigation, parser, pointer, presets, pricing, and prompts
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

# Core src 07 — navigation, parser, pointer, presets, pricing, and prompts

This page documents the symbols that ship navigation scaffolding, a tree-sitter parser wrapper, the opt-in AGENTS.md/CLAUDE.md pointer, the provider preset table, the pricing model, and prompt-test helpers in `packages/core/src`.

## When to use this page

- **Configure** navigation hubs, quickstart, tasks, and topic pages using the helpers in `packages/core/src/navigation.ts`.
- **Extend** the tree-sitter parser wrapper in `packages/core/src/parser.ts` to support an additional language.
- **Toggle** the AGENTS.md/CLAUDE.md pointer block on or off using the explicit API in `packages/core/src/pointer.ts`.
- **Look up** provider presets and USD pricing for batch reporting using `packages/core/src/presets.ts` and `packages/core/src/pricing.ts`.

## How it fits

The module lives under `packages/core/src/` and is one slice of the livewiki core package. `navigation.ts` builds the wiki's hub pages and in-page navigation blocks from the module graph; `parser.ts` wraps `web-tree-sitter` with a per-extension grammar cache; `pointer.ts` is the single, explicit exception that can write outside `livewiki/` and `.livewiki/`; `presets.ts` and `pricing.ts` provide the data tables that the batch runner consumes when reporting tokens and USD cost; the prompt tests under `packages/core/src/prompts.test.ts` assert the structural invariants the documentation generator must respect.

## Navigation module presentations and label helpers

<!-- lw:anchors packages/core/src/navigation.ts#buildDisplayTitleFallbacks packages/core/src/navigation.ts#loadModulePresentations packages/core/src/navigation.ts#loadFlowPresentations packages/core/src/navigation.ts#loadTopicPresentations packages/core/src/navigation.ts#commonDirectory packages/core/src/navigation.ts#humanizeSegments packages/core/src/navigation.ts#normalizeLabel packages/core/src/navigation.ts#compareModules packages/core/src/navigation.ts#compareTopics packages/core/src/navigation.ts#sameStrings packages/core/src/navigation.ts#readHubDeclaredOwner -->

`buildDisplayTitleFallbacks` computes human-friendly fallback titles without changing module identity — the `Module.id` remains the sole key used by graphs, pages, tasks, checkpoints, anchors, and filenames. Its visible inputs are the `Module[]` array and it returns a `Map<string, string>` keyed by `module.id`. It walks the longest common path suffix per module, appends `"source"` when the directory contains a `src/` or `source/` segment, and de-duplicates collisions inside a directory by suffixing `" — part N of M"`.

The three `load*Presentations` functions read existing wiki pages back into presentation objects. `loadModulePresentations` reads `livewiki/<moduleId>.md`, prefers the frontmatter `title` (as long as it does not normalize to the module id) and surfaces a typed `owner`. `loadFlowPresentations` reads every `livewiki/flows/<slug>.md` except the hub `index.md`; a missing or unparseable frontmatter degrades honestly to `title: null`. `loadTopicPresentations` reads `livewiki/topics/<slug>.md`.

The smaller helpers provide the string machinery these loaders depend on: `commonDirectory(paths)` returns the shared path segments as an array, `humanizeSegments` converts a segment list to a title, `normalizeLabel` lowercases and trims for equality checks, `compareModules` and `compareTopics` order by stable id, `sameStrings` does element-wise equality on string arrays, and `readHubDeclaredOwner(content)` parses the hub frontmatter to return `"generated" | "human" | "mixed" | null`. If a module page is malformed, the loader swallows the error rather than propagating it — a malformed page is not trusted as a source of navigation metadata.

## Navigation page generators and in-place syncers

<!-- lw:anchors packages/core/src/navigation.ts#generateQuickstart packages/core/src/navigation.ts#generateTasksPage packages/core/src/navigation.ts#generateAuxiliaryIndex packages/core/src/navigation.ts#generateFlowsIndex packages/core/src/navigation.ts#generateTopicsIndex packages/core/src/navigation.ts#ensureTopicsIndexScaffold packages/core/src/navigation.ts#syncTopicsIndexHub packages/core/src/navigation.ts#syncFlowsIndexHub packages/core/src/navigation.ts#syncAuxiliaryIndexHub -->

These five `generate*` functions render the user-facing hubs from the presentation maps built earlier: a quickstart page, a tasks index, an auxiliary index for fixtures/tooling/docs, a flows index, and a topics index. Their exact option shapes are not visible in the supplied excerpt beyond their `opts` parameter; treat the prose here as scoped to what the symbols table confirms.

The three `sync*IndexHub` functions are the persistent counterparts: they regenerate the corresponding hub file in place while respecting an existing `lw:manual` block, and `ensureTopicsIndexScaffold` makes sure a topics hub exists before a sync runs. The hub-ownership detection (`readHubDeclaredOwner`) is what lets the syncers distinguish human content from generated scaffolding and avoid clobbering it. When the hub has manual blocks the supplied excerpt does not establish exhaustive behavior — that branch may not be fully visible here.

## Navigation selection, navigate blocks, and related-module updates

<!-- lw:anchors packages/core/src/navigation.ts#selectRelatedModules packages/core/src/navigation.ts#updateModuleNavigateBlocks packages/core/src/navigation.ts#updateFlowTopicLinks packages/core/src/navigation.ts#buildNavigateBlock -->

`selectRelatedModules` ranks candidate modules along dependency edges and returns `RelatedModule` entries tagged `"dependency" | "dependent" | "both"`. `updateModuleNavigateBlocks` walks the module pages and rewrites the per-page navigate region delimited by `NAV_START` / `NAV_END`; `buildNavigateBlock` produces the inner content for that region. `updateFlowTopicLinks` performs the analogous rewrite for the topic-related region in flow pages (delimited by `TOPIC_RELATED_START` / `TOPIC_RELATED_END`). The patterns explicitly match a manual-block regex (`MANUAL_BLOCK_RE`) so that human content delimited by `lw:manual` is preserved across rewrites. The excerpt does not establish the full ordering policy of `selectRelatedModules`, so describe its ranking as approximate.

## Tree-sitter parser wrapper

<!-- lw:anchors packages/core/src/parser.ts#initParser packages/core/src/parser.ts#grammarsDir packages/core/src/parser.ts#loadLanguage packages/core/src/parser.ts#grammarForExtension packages/core/src/parser.ts#parseSource packages/core/src/parser.ts#listSupportedGrammars packages/core/src/parser.ts#_grammarToExtensionForTest -->

```ts
export async function initParser(): Promise<void>
export function grammarForExtension(ext: string): string | undefined
export async function parseSource(ext: string, source: string): Promise<Tree>
export function listSupportedGrammars(): string[]
export function _grammarToExtensionForTest(grammar: string): string | undefined
```

`initParser` initializes the WASM runtime of `web-tree-sitter` and is idempotent: subsequent calls return the same cached `initPromise`. `parseSource` first calls `initParser`, then looks up the grammar for the lowercased extension, loads the `Language` (cached after the first hit), creates a fresh `Parser`, and parses the source. If the extension has no entry in the `EXT_TO_GRAMMAR` table it throws `Sem gramática tree-sitter para extensão <ext>`; if the WASM is missing, `loadLanguage` throws pointing at the missing path.

`grammarsDir` resolves the directory that ships the `.wasm` files: it tries `./package.json` (dev: `src/`) then `../package.json` (build: `dist/`) and throws if neither is reachable from `import.meta.url`. The supported extensions map to a small set: `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.py`. `listSupportedGrammars` lists the grammars actually present on disk by reading the directory synchronously and stripping the `tree-sitter-` prefix and `.wasm` suffix. `_grammarToExtensionForTest` is a one-line reverse lookup intended for unit tests asserting grammar↔extension round trips.

## Pointer markers, selection, and pure string transforms

<!-- lw:anchors packages/core/src/pointer.ts#POINTER_START packages/core/src/pointer.ts#POINTER_END packages/core/src/pointer.ts#POINTER_FILES packages/core/src/pointer.ts#pickPointerFile packages/core/src/pointer.ts#buildPointerBlock packages/core/src/pointer.ts#findPointerBlock packages/core/src/pointer.ts#applyPointerReplace packages/core/src/pointer.ts#applyPointerRemove packages/core/src/pointer.ts#_internal -->

```ts
export const POINTER_START = "<!-- livewiki:start -->"
export const POINTER_END = "<!-- livewiki:end -->"
export const POINTER_FILES = ["AGENTS.md", "CLAUDE.md"] as const
export function pickPointerFile(hasAgentsMd: boolean, hasClaudeMd: boolean, requested?: PointerFile): PointerFile
export function findPointerBlock(content: string): { startIdx: number; endIdx: number; inner: string } | null
export function applyPointerReplace(content: string, newBlock: string): { content: string; action: PointerAction }
export function applyPointerRemove(content: string): { content: string; removed: boolean }
export const _internal = { nodeFs }
```

The two markers are stable strings parsers may depend on, and `POINTER_FILES` is the only allow-list of pointer targets per the rule that pointer writes never happen outside an explicit flag. `pickPointerFile` resolves a target: an explicit `requested` always wins; otherwise `AGENTS.md` is preferred, then `CLAUDE.md`, and `AGENTS.md` is the default when neither exists.

`findPointerBlock` is a pure parser for the block. It uses tolerant regexes (`<!--\s*livewiki:start\s*-->` and the matching end variant), and explicitly returns `null` when the start marker has no end marker after it — a truncated block is treated as absent rather than corrupting the file. `buildPointerBlock` returns the default block content: a short Portuguese-language pointer paragraph plus a link to `./livewiki/quickstart.md`. The block is intentionally under 800 bytes so it stays a pointer, not a duplicated wiki.

`applyPointerReplace` either appends the new block (with a single blank separator) or replaces the existing block in place; it returns `"inserted" | "replaced" | "unchanged"` so callers can report bytes written. `applyPointerRemove` strips the block along with one trailing newline when possible. `_internal` exposes `nodeFs` for tests; it is the only place this module intentionally leaks the filesystem dependency.

## Pointer file I/O: insert, remove, status, and ensure

<!-- lw:anchors packages/core/src/pointer.ts#insertPointer packages/core/src/pointer.ts#removePointer packages/core/src/pointer.ts#readPointerStatus packages/core/src/pointer.ts#ensurePointerFile -->

```ts
export async function insertPointer(repoRoot: string, opts: PointerInsertOptions): Promise<PointerInsertResult>
export async function removePointer(repoRoot: string, opts: PointerInsertOptions): Promise<PointerAction | "removed" | "absent">
export async function readPointerStatus(repoRoot: string, file?: PointerFile): Promise<...>
export async function ensurePointerFile(repoRoot: string, file?: PointerFile): Promise<PointerFile>
```

These four functions are the disk-side counterparts to the pure helpers above. `insertPointer` resolves the target via `pickPointerFile`, computes the new content via `applyPointerReplace`, writes it through the project's `safe-io` boundary, and reports the resulting `action` plus `bytesWritten`. `removePointer` reads the file, calls `applyPointerRemove`, and writes only if `removed === true`. `readPointerStatus` reports whether a block exists and what its inner content is; `ensurePointerFile` creates an empty target file if none exists yet.

The pointer module is the documented exception to the "safe-io only writes inside `livewiki/` and `.livewiki/`" rule — writes are gated behind `--write-pointer` or explicit interactive confirmation, and never automatic.

## Provider presets: table, lookup, error, and resolver

<!-- lw:anchors packages/core/src/presets.ts#PRESET_TABLE packages/core/src/presets.ts#AVAILABLE_PRESETS packages/core/src/presets.ts#isKnownPreset packages/core/src/presets.ts#resolvePreset packages/core/src/presets.ts#resolveProviderConfig packages/core/src/presets.ts#UnknownPresetError packages/core/src/presets.ts#UnknownPresetError.constructor -->

```ts
export const PRESET_TABLE: Record<PresetName, ProviderPreset>
export const AVAILABLE_PRESETS: readonly PresetName[]
export function isKnownPreset(name: string): name is PresetName
export function resolvePreset(name: string): ProviderPreset
export function resolveProviderConfig(args: { ... }): ...
export class UnknownPresetError extends Error
constructor(name: string, available: readonly string[])
```

`PRESET_TABLE` is the data table of provider presets — `anthropic`, `openai`, `openrouter`, `deepseek`, `kimi`, `minimax`, `gemini`, `nvidia`, `ollama`, `lmstudio`. Each entry carries `adapter`, `baseUrl`, `envVar` (the variable name, never the value), a `pricing` table, `notes`, and optional thinking-policy / token-budget hints. `AVAILABLE_PRESETS` exposes the same keys as a readonly array. Per the data invariant, no preset entry contains an API key inline — the test suite asserts no `sk-…`, `ghp_…`, or `gsk_…` token shape is present anywhere in the serialized preset.

`isKnownPreset` is a type predicate. `resolvePreset(name)` returns the matching entry or throws `UnknownPresetError`, whose constructor stores `presetName` and `available` on the instance for structured handling by callers. `resolveProviderConfig(args)` merges a preset with explicit user overrides into a runtime provider config; its full option shape is not visible in the supplied excerpt beyond the `args` parameter.

## Pricing table and cost helpers

<!-- lw:anchors packages/core/src/pricing.ts#PRICING_REFERENCE_DATE packages/core/src/pricing.ts#PRICING_TABLE packages/core/src/pricing.ts#lookupPricing packages/core/src/pricing.ts#calculateCostUsd packages/core/src/pricing.ts#formatCost -->

```ts
export const PRICING_REFERENCE_DATE = "2026-07-09"
export const PRICING_TABLE: PricingTable
export function lookupPricing(model: string, override?: PricingOverride): PricingLookup
export function calculateCostUsd(inputTokens: number, outputTokens: number, model: string, override?: PricingOverride): { input: number; output: number; total: number; refDate: string } | null
export function formatCost(cost: { total: number } | null, model: string): string
```

`PRICING_REFERENCE_DATE` records when the embedded table was last reviewed and is included on every USD report so users can tell fresh from stale. `PRICING_TABLE` covers Claude 4.5 family and a small OpenAI-compat subset (`claude-opus-4-5`, `claude-sonnet-5`, `claude-haiku-4`, `gpt-4o`, `gpt-4o-mini`) at USD per 1M tokens; the comment in source notes it is deliberately short.

`lookupPricing` resolves with a three-way priority: user `override` first, embedded table second, and `{ tokensOnly: true }` when neither has the model — the function never invents a price. `calculateCostUsd` computes input and output cost by dividing token counts by `1_000_000` against the resolved per-million rate and returns `null` for unknown models. `formatCost` renders the cost as `$<total.toFixed(4)>` for known prices and `(no price for model <model>)` for null — the absence of data is explicit, not blank.

## Prompt tests: copyable anchor markers and fence detection

<!-- lw:anchors packages/core/src/prompts.test.ts#copyableAnchorMarkers packages/core/src/prompts.test.ts#outerFenceFor -->

```ts
function copyableAnchorMarkers(text: string): string[][]
function outerFenceFor(text: string): ...
```

`copyableAnchorMarkers` is a test-only extractor: it scans `text` for every `<!-- lw:anchors … -->` marker, splits the body on whitespace, drops empty tokens, and returns each marker's key list as an array. Tests use it to assert that the prompt's user section contains the closed-list keys verbatim and that the rendered documentation pages obey the EXACTLY-ONCE rule in both frontmatter and section markers.

`outerFenceFor` identifies the outer fenced code block in a prompt's user section (visible by name in the test suite); the supplied excerpt truncates its body, so this section limits prose to what the name and symbols-table kind confirm: it is a pure helper used by prompt-rendering tests. The full implementation is not visible in the provided source.

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
- Flow: [CLI batch stage-4 / stage-5 walk through the core slice](flows/cli-src-to-core-src-07.md)
- ["Core pipeline: batch orchestration, config, db, and diagrams"](core-src-03.md) — dependency and dependent
- [core-src-08 — prompts, safe I/O, status, symbol extraction, and topic planning](core-src-08.md) — dependency and dependent
- [Core export, frontmatter, gitignore, flow detection, and hashing](core-src-04.md) — dependency
<!-- livewiki:navigate:end -->
