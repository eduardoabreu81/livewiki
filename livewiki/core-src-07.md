---
title: "Core source utilities for orientation, output budgeting, parsing, pointer blocks, presets, and pricing"
owner: generated
anchors:
  - packages/core/src/orientation.ts#PURPOSE_MAX_CHARS
  - packages/core/src/orientation.ts#clipSentence
  - packages/core/src/orientation.ts#detectSurfaces
  - packages/core/src/orientation.ts#extractPurpose
  - packages/core/src/orientation.ts#extractRepoOrientation
  - packages/core/src/orientation.ts#findFastPathSection
  - packages/core/src/orientation.ts#findPrimaryReadme
  - packages/core/src/orientation.ts#isBadgeOrLinkOnlyLine
  - packages/core/src/orientation.ts#isListLeadIn
  - packages/core/src/orientation.ts#isMeaningfulProse
  - packages/core/src/orientation.ts#readBounded
  - packages/core/src/orientation.ts#readdirNames
  - packages/core/src/orientation.ts#stripHtmlTags
  - packages/core/src/output-budget.ts#MODULE_OUTPUT_BUDGET_OPTIONS
  - packages/core/src/output-budget.ts#TOPIC_REFINE_OUTPUT_BUDGET_OPTIONS
  - packages/core/src/output-budget.ts#computeDynamicOutputTokenBudget
  - packages/core/src/parser.ts#_grammarToExtensionForTest
  - packages/core/src/parser.ts#grammarForExtension
  - packages/core/src/parser.ts#grammarState
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
---

# Core source utilities for orientation, output budgeting, parsing, pointer blocks, presets, and pricing

This module page documents the deterministic helpers that sit under the livewiki core: pulling first-paragraph purpose from a repository's README, sizing LLM output budgets per page, wrapping web-tree-sitter with a grammar cache, writing the opt-in `livewiki:start/end` pointer block to `AGENTS.md`/`CLAUDE.md`, embedding the provider preset table, and computing reported USD cost from token usage.

## When to use this page

- **Reach for `extractRepoOrientation`** when a workflow needs README purpose, root-surface hints, and a fast-path section heading without invoking an LLM.
- **Compute a content-scaled token budget** with `computeDynamicOutputTokenBudget` and one of the two presets (`MODULE_OUTPUT_BUDGET_OPTIONS` or `TOPIC_REFINE_OUTPUT_BUDGET_OPTIONS`) instead of a flat cap.
- **Insert or remove the opt-in pointer block** in `AGENTS.md`/`CLAUDE.md` via `insertPointer`/`removePointer`, status-check with `readPointerStatus`, and pick the canonical target file with `pickPointerFile`.
- **Resolve a provider preset or override** with `resolvePreset`/`resolveProviderConfig`, and look up USD cost of a model call with `lookupPricing`/`calculateCostUsd`/`formatCost`.

## How it fits

This module lives under `packages/core/src/` and groups six cooperating files that the indexer and CLI call between them. `orientation.ts` reads the repository root for deterministic, free evidence (a README purpose paragraph plus ordered entry-point hints from well-known root files); `output-budget.ts` sizes LLM `max_tokens` per page from anchor count and source chars; `parser.ts` wraps `web-tree-sitter` with a per-grammar `Language` cache loaded from vendored `.wasm` files; `pointer.ts` is the file I/O path solely for the opt-in `livewiki:start/end` block in `AGENTS.md`/`CLAUDE.md`; `presets.ts` is the embedded provider table and override expansion; `pricing.ts` is the embedded USD/1M-token table and the lookup/format helpers that turn real token usage into the reported cost. The module exports both pure helpers (testable on strings) and async disk functions that hold the only `allowPointer` exception against the livewiki safe-write rules.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-07.mmd
```

## Repository orientation
<!-- lw:anchors packages/core/src/orientation.ts#PURPOSE_MAX_CHARS packages/core/src/orientation.ts#extractRepoOrientation packages/core/src/orientation.ts#findPrimaryReadme packages/core/src/orientation.ts#readdirNames packages/core/src/orientation.ts#readBounded packages/core/src/orientation.ts#extractPurpose packages/core/src/orientation.ts#stripHtmlTags packages/core/src/orientation.ts#isListLeadIn packages/core/src/orientation.ts#isBadgeOrLinkOnlyLine packages/core/src/orientation.ts#isMeaningfulProse packages/core/src/orientation.ts#clipSentence packages/core/src/orientation.ts#findFastPathSection packages/core/src/orientation.ts#detectSurfaces -->

The orientation helpers turn the repository root into deterministic, free product-orientation evidence — no LLM, no writes. The exported entry point is `extractRepoOrientation(absRoot)`, which on a missing or unreadable README degrades every field to `null` or empty rather than throwing. The purpose excerpt is bounded by `PURPOSE_MAX_CHARS` (600 chars):

```ts
export const PURPOSE_MAX_CHARS = 600;
```

### Primary README selection

`findPrimaryReadme(root)` picks the README in a stable order: `README.md`, then `README.en.md`, then any other `README*.{md,markdown}` at the root sorted case-insensitively. The directory listing is read through `readdirNames(root)`, which returns file names (filtered by `entry.isFile()`) and returns `[]` on any read error rather than propagating the failure.

### Bounded README read

`readBounded(absFile)` reads the README through a 256 KiB cap so the evidence stays near the top of the file. Files at or below the cap are read whole; larger files are opened, the first `README_MAX_BYTES` are read with `handle.read`, and the handle is closed in a `finally`.

### Purpose extraction

```ts
export function extractPurpose(markdown: string): string | null
```

`extractPurpose` walks the README line by line, tracking fenced code and multi-line HTML openers, and accumulates the first paragraph with enough real prose. Markdown and HTML headings (`# …`, `<h1>`–`<h6>`), thematic breaks, list items, badge/image/link-only lines, and fenced code blocks are skipped. Container blocks (`<div>`, `<p>`, `<section>`, …) are traversed: `stripHtmlTags(text)` removes every HTML tag so only the text content remains. A candidate ending with a colon (checked by `isListLeadIn`) is treated as a list lead-in and scanning continues. `isMeaningfulProse` enforces a min character floor and the presence of at least one letter.

### Sentence clipping

```ts
export function clipSentence(text: string, maxChars: number = PURPOSE_MAX_CHARS): string
```

`clipSentence` returns the original text when it fits the cap, otherwise clips at the last sentence boundary inside the cap (period, exclamation, question mark, including CJK variants, with optional closing quote/bracket). If no sentence boundary sits at or below the cap, it falls back to the last word boundary and appends an ellipsis.

### Fast-path section detection

`findFastPathSection(markdown)` scans the first ATX-style heading whose text matches `/quick ?start|getting started|installation|setup|run locally|local development|usage/i` and returns its heading text.

### Surface hints

`detectSurfaces(root)` returns an ordered list of one-line entry-point hints generated from well-known root files: `main.py`, `manage.py`, `package.json` (with `bin`/`main`), `Dockerfile*`, `pyproject.toml`, `go.mod`, `Cargo.toml`. An unreadable or malformed `package.json` is swallowed and yields no surface hint.

## Output budget
<!-- lw:anchors packages/core/src/output-budget.ts#MODULE_OUTPUT_BUDGET_OPTIONS packages/core/src/output-budget.ts#TOPIC_REFINE_OUTPUT_BUDGET_OPTIONS packages/core/src/output-budget.ts#computeDynamicOutputTokenBudget -->

The output-budget module computes a content-scaled `maxTokens` instead of a flat cap, so a module with many anchors does not silently starve against an 8192 ceiling.

### Preset options

```ts
export const MODULE_OUTPUT_BUDGET_OPTIONS: OutputBudgetOptions
export const TOPIC_REFINE_OUTPUT_BUDGET_OPTIONS: OutputBudgetOptions
```

`MODULE_OUTPUT_BUDGET_OPTIONS` is the preset for module pages, flow pages, and individual topic-page prose (`base: 2048`, `perAnchor: 300`, `floor: 4096`, `ceiling: 32_768`). `TOPIC_REFINE_OUTPUT_BUDGET_OPTIONS` is the preset for the topic-plan LLM refine pass — a compact structured payload, not final prose (`base: 1024`, `perAnchor: 40`, `floor: 4096`, `ceiling: 32_768`).

### Budget computation

```ts
export function computeDynamicOutputTokenBudget(
  signals: OutputBudgetSignals,
  opts: OutputBudgetOptions,
): number
```

`computeDynamicOutputTokenBudget` computes `base + perAnchor * anchorCount` (with `anchorCount` clamped at zero), optionally adds `ceil(anchorSourceChars / 40)` when `signals.anchorSourceChars` is supplied, rounds up to the nearest 256 (`TOKEN_ROUNDING_STEP`), and finally clamps the result into `[floor, ceiling]`. The `anchorSourceChars` step approximates 40 source chars per output token because the page summarizes rather than copies.

## Tree-sitter parser
<!-- lw:anchors packages/core/src/parser.ts#initParser packages/core/src/parser.ts#grammarsDir packages/core/src/parser.ts#loadLanguage packages/core/src/parser.ts#grammarForExtension packages/core/src/parser.ts#grammarState packages/core/src/parser.ts#parseSource packages/core/src/parser.ts#listSupportedGrammars packages/core/src/parser.ts#_grammarToExtensionForTest -->

The parser module wraps `web-tree-sitter` with a per-grammar `Language` cache and a vendored `.wasm` directory resolved relative to the package's own `package.json`.

### Initialization

```ts
export async function initParser(): Promise<void>
```

`initParser` is idempotent: the first call stores `Parser.init()` in `initPromise`, and subsequent calls return the same promise without re-initializing the WASM runtime.

### Grammar directory

`grammarsDir()` resolves the `grammars/` directory by trying `./package.json` (dev: `src/`) then `../package.json` (build: `dist/`) via `createRequire(import.meta.url)`. If neither resolves, the function throws because it cannot locate the package.

### Grammar loading and parsing

`loadLanguage(name)` looks up `tree-sitter-<name>.wasm` in `grammarsDir()`, checks existence synchronously, and on a miss throws because the grammar is not vendored in this build. The resolved `Language` is cached in a `Map<string, Language>` so subsequent calls return the cached instance. `parseSource(ext, source)` calls `initParser`, looks up the grammar by lowercased extension through `grammarForExtension`, throws when no grammar is mapped, otherwise parses with a fresh `Parser` and throws when tree-sitter returns `null` (so the caller never has to handle a null tree).

### Introspection

`listSupportedGrammars()` lists the `.wasm` files in `grammarsDir()` (returning `[]` when the directory is absent) and strips the `tree-sitter-` prefix and `.wasm` suffix. `grammarState()` returns the rich grammar-set state used by the indexer to direct re-parses — a `map` of extension-to-grammar and an `artifacts` map of grammar name to the sha256 of its vendored `.wasm` (or `"missing"` when absent). `_grammarToExtensionForTest` is a test-only helper that returns the first extension mapped to a given grammar name.

## Pointer block
<!-- lw:anchors packages/core/src/pointer.ts#POINTER_START packages/core/src/pointer.ts#POINTER_END packages/core/src/pointer.ts#POINTER_FILES packages/core/src/pointer.ts#pickPointerFile packages/core/src/pointer.ts#buildPointerBlock packages/core/src/pointer.ts#findPointerBlock packages/core/src/pointer.ts#applyPointerReplace packages/core/src/pointer.ts#applyPointerRemove packages/core/src/pointer.ts#insertPointer packages/core/src/pointer.ts#removePointer packages/core/src/pointer.ts#readPointerStatus packages/core/src/pointer.ts#ensurePointerFile packages/core/src/pointer.ts#_internal -->

The pointer module is the only file I/O path that touches `AGENTS.md`/`CLAUDE.md` — every other write goes through `safe-io.ts` with its standard allowlist. The markers are stable strings and any parser may depend on them:

```ts
export const POINTER_START = "<!-- livewiki:start -->";
export const POINTER_END = "<!-- livewiki:end -->";
export const POINTER_FILES = ["AGENTS.md", "CLAUDE.md"] as const;
```

### File selection and block construction

`pickPointerFile(hasAgentsMd, hasClaudeMd, requested)` returns the explicit `requested` if provided, otherwise prefers `AGENTS.md` when present, else `CLAUDE.md` when present, else `AGENTS.md` as the create target. `buildPointerBlock()` returns the standard block: the two markers surrounding one short PT-BR paragraph and one link to `livewiki/quickstart.md`. The text is intentionally short — agents and humans who read the file see the pointer and follow the link.

### Pure block parsing and transformation

`findPointerBlock(content)` locates the first `livewiki:start` and `livewiki:end` markers (tolerating whitespace around either marker's tag content), returns `{ startIdx, endIdx, inner }`, or `null` when either marker is absent. A truncated block (start without end) is treated as absent so corrupt documents are not damaged. `applyPointerReplace(content, newBlock)` appends `newBlock` when no block exists or substitutes the first block in place; if the substituted string equals the input, it returns `action: "unchanged"` so callers can skip a no-op write. `applyPointerRemove(content)` removes the block and trims one adjacent newline so the surrounding whitespace does not grow.

### Disk operations

`insertPointer(repoRoot, opts)` resolves the repo root, picks the target file via `pickPointerFile` (with `safeIo.exists` checks that swallow errors as `false`), double-validates the file against `POINTER_FILES`, reads the existing content via `safe-io` with `allowPointer: true`, applies `applyPointerReplace`, and writes only when the action is not `unchanged`. The returned `PointerInsertResult` reports the chosen file, the action (`inserted`/`replaced`/`unchanged`), and the bytes written (zero when `unchanged`). `removePointer(repoRoot, opts)` mirrors that flow with `applyPointerRemove`, reporting `replaced` with non-zero bytes when the block was actually removed and `unchanged` otherwise. `readPointerStatus(repoRoot, opts)` checks the requested file first, or both `POINTER_FILES` when no file is requested, returning the file holding the block plus the inner content trimmed (or `file: null` when neither file contains a block). `ensurePointerFile(repoRoot, file)` writes an empty file when the targeted pointer file is absent. `_internal` re-exports the `node:fs/promises` module so the file is the only consumer of `allowPointer` paths.

## Provider presets
<!-- lw:anchors packages/core/src/presets.ts#PRESET_TABLE packages/core/src/presets.ts#AVAILABLE_PRESETS packages/core/src/presets.ts#UnknownPresetError packages/core/src/presets.ts#UnknownPresetError.constructor packages/core/src/presets.ts#resolvePreset packages/core/src/presets.ts#resolveProviderConfig packages/core/src/presets.ts#isKnownPreset -->

The presets module is the embedded provider table referenced by `.livewiki/config.json`. Each preset carries the adapter, base URL, env var name, default pricing, operational notes, and a default thinking policy — `provider` config can override the adapter, and `config.pricing` overrides the per-model dollar figures.

### Preset table

```ts
export const PRESET_TABLE: Record<PresetName, ProviderPreset>
export const AVAILABLE_PRESETS: readonly PresetName[]
```

`PRESET_TABLE` covers ten providers: `anthropic` (Anthropic Messages), `openai`, `openrouter`, `deepseek`, `kimi`, `minimax` (Anthropic-compat endpoint, so the anthropic adapter is used for prompt caching), `gemini`, `nvidia` (NIM), `ollama` (local, `localhost:11434`), and `lmstudio` (local, `localhost:1234`). Local providers report input/output of zero rather than omitting prices so the cost report is explicit. `AVAILABLE_PRESETS` is the ordered list used for `--help` and error messages.

### Error and resolution

```ts
export class UnknownPresetError extends Error {
  constructor(name: string, available: readonly string[])
}
```

`UnknownPresetError` extends `Error`, sets `name = "UnknownPresetError"`, and exposes the unknown name plus the available list in its message. `resolvePreset(name)` looks up the preset in `PRESET_TABLE` and throws `UnknownPresetError` when the name is not a `PresetName`. `isKnownPreset(name)` is a non-throwing check that returns `name is PresetName` via `Object.prototype.hasOwnProperty.call`. `resolveProviderConfig({ preset?, provider?, baseUrl?, pricing? })` resolves the preset when `preset` is set (and lets `provider` override the adapter), covers the legacy path that only sets `provider` (throwing for an unknown adapter), and throws when neither is set because callers must catch that earlier in `validateConfigForBatch`.

## Pricing
<!-- lw:anchors packages/core/src/pricing.ts#PRICING_REFERENCE_DATE packages/core/src/pricing.ts#PRICING_TABLE packages/core/src/pricing.ts#lookupPricing packages/core/src/pricing.ts#calculateCostUsd packages/core/src/pricing.ts#formatCost -->

The pricing module is the embedded USD-per-1M-token table and the lookup/format helpers that turn real token usage into the reported cost. The reference date stamps every report so the user knows whether the prices are fresh:

```ts
export const PRICING_REFERENCE_DATE = "2026-07-09";
```

### Embedded table

`PRICING_TABLE` covers the MVP models — the Anthropic Claude 4.5 family (`claude-opus-4-5`, `claude-sonnet-5`, `claude-haiku-4`) and the OpenAI-compat MVP entries (`gpt-4o`, `gpt-4o-mini`) — in USD per 1,000,000 tokens. Models not in the table can be added via `.livewiki/config.json` `pricing` overrides.

### Lookup and cost

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

`lookupPricing` returns the override first if present, then the embedded entry, and otherwise returns `{ tokensOnly: true }` so the report can show tokens without inventing a USD number. `calculateCostUsd` returns `null` for an unknown model (so the report never quotes a fabricated cost) and otherwise scales the input and output tokens by the per-1M figures into `input`, `output`, `total`, and `refDate`. `formatCost` returns the literal `(no price for model X)` when the cost is `null` and `$$<total.toFixed(4)>` otherwise, making the absence of data explicit.

<!-- livewiki:navigate:start -->
## Navigate

- [core indexing, imports, flows, and frontmatter](core-src-04.md) — dependency and dependent
- [Safe I/O, section guarding, status reporting, and symbol extraction](core-src-09.md) — dependency
- [core topics, understanding, update metrics, update, and verify](core-src-10.md) — dependent
<!-- livewiki:navigate:end -->
