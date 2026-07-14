---
title: Core navigation, parsing, pointer, presets, pricing, prompts, safe I/O, and status surface
owner: generated
anchors:
- packages/core/src/navigation.ts#buildDisplayTitleFallbacks
- packages/core/src/navigation.ts#buildNavigateBlock
- packages/core/src/navigation.ts#commonDirectory
- packages/core/src/navigation.ts#compareModules
- packages/core/src/navigation.ts#extractTaskBullets
- packages/core/src/navigation.ts#generateQuickstart
- packages/core/src/navigation.ts#generateTasksPage
- packages/core/src/navigation.ts#humanizeSegments
- packages/core/src/navigation.ts#loadModulePresentations
- packages/core/src/navigation.ts#normalizeLabel
- packages/core/src/navigation.ts#sameStrings
- packages/core/src/navigation.ts#selectRelatedModules
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
- packages/core/src/prompts.ts#DEFAULT_CONTEXT_TOKEN_BUDGET
- packages/core/src/prompts.ts#DEFAULT_OUTPUT_TOKEN_BUDGET
- packages/core/src/prompts.ts#EXCEPTION_BRANCH_PROMPT_RULE
- packages/core/src/prompts.ts#LITERAL_SIGNATURE_PROMPT_RULE
- packages/core/src/prompts.ts#PAGE_OPENING_PROMPT_RULES
- packages/core/src/prompts.ts#buildOverviewPrompt
- packages/core/src/prompts.ts#buildQuickstartPrompt
- packages/core/src/prompts.ts#buildRepairPrompt
- packages/core/src/prompts.ts#buildStage2RefinePrompt
- packages/core/src/prompts.ts#buildStage4Prompt
- packages/core/src/prompts.ts#neutralizeUntrustedControlMarkers
- packages/core/src/prompts.ts#neutralizeUntrustedControlMarkersExceptValidAnchors
- packages/core/src/safe-io.test.ts#detectSymlinkSupport
- packages/core/src/safe-io.ts#ALLOWED_DIRS
- packages/core/src/safe-io.ts#InvalidRelativePathError
- packages/core/src/safe-io.ts#InvalidRelativePathError.constructor
- packages/core/src/safe-io.ts#PathOutsideAllowlistError
- packages/core/src/safe-io.ts#PathOutsideAllowlistError.constructor
- packages/core/src/safe-io.ts#allowedAbs
- packages/core/src/safe-io.ts#allowlistFor
- packages/core/src/safe-io.ts#exists
- packages/core/src/safe-io.ts#findDeepestExisting
- packages/core/src/safe-io.ts#isInsideAllowlist
- packages/core/src/safe-io.ts#mkdir
- packages/core/src/safe-io.ts#readText
- packages/core/src/safe-io.ts#remove
- packages/core/src/safe-io.ts#resolveAndValidate
- packages/core/src/safe-io.ts#validateDeclared
- packages/core/src/safe-io.ts#writeText
- packages/core/src/status.ts#collect
- packages/core/src/status.ts#formatHuman
- packages/core/src/status.ts#run
- packages/core/src/symbols.test.ts#parse
---

# Core navigation, parsing, pointer, presets, pricing, prompts, safe I/O, and status surface

This page documents the core-src-04 module's responsibility for navigation rendering, tree-sitter grammar loading, pointer-block management in agent instruction files, provider preset resolution, model pricing lookups, LLM prompt construction, sandboxed disk I/O, and wiki status reporting.

## When to use this page

- **Build or extend** navigation pages and per-module `navigate` blocks using the helpers in `navigation.ts`, **wire up** tree-sitter grammars via `parser.ts`, **manage** the `AGENTS.md` / `CLAUDE.md` pointer block via `pointer.ts`, and **resolve** provider presets and pricing through `presets.ts` and `pricing.ts`.
- **Compose** stage-2/4, repair, quickstart, and overview prompts with the editorial contract constants in `prompts.ts`, **sanitize** untrusted content with the `neutralizeUntrustedControlMarkers*` helpers, and **perform** all disk I/O through the allowlisted helpers in `safe-io.ts`.
- **Report** wiki status (file counts, symbol kinds, debt, undocumented, incremental metrics) through `status.ts`, and **drive** parser-backed symbol-extraction tests through the `parse` helper in `symbols.test.ts`.

## How it fits

The core-src-04 module bundles the orchestration, parsing, persistence, and presentation glue that other core modules and the CLI depend on. It sits beside sibling modules under `packages/core/src/` and is consumed by the batch pipeline (`buildStage4Prompt`, `pricing`, `presets`), by the writer that mutates the wiki on disk (`safe-io`, `pointer`), and by the `livewiki status` command (`status`). The module does not own a complete call graph of the product; it provides the leaf primitives and a small set of orchestrators (`run`, `updateModuleNavigateBlocks`, `insertPointer`) that the higher-level entry points compose.

## Navigation surface

<!-- lw:anchors packages/core/src/navigation.ts#buildDisplayTitleFallbacks packages/core/src/navigation.ts#commonDirectory packages/core/src/navigation.ts#compareModules packages/core/src/navigation.ts#humanizeSegments packages/core/src/navigation.ts#normalizeLabel packages/core/src/navigation.ts#sameStrings -->

The navigation helpers compute presentation metadata for modules without changing the stable `Module.id` key used by graphs, pages, tasks, checkpoints, anchors, and filenames. `buildDisplayTitleFallbacks` sorts modules via `compareModules`, derives a per-module `commonDirectory`, then shortens the directory suffix with collision detection against peers — a candidate is rejected if another module shares that lowercased suffix. The visible source shows that when no segments survive, the suffix falls back to the literal string `"repository"`, and that a segment `source` is appended if the common directory contains `src` or `source` but the chosen suffix does not. `humanizeSegments` produces the human-readable suffix, `normalizeLabel` lowercases and collapses whitespace for comparison, and `sameStrings` compares two label arrays for equality after normalization. `compareModules` is the canonical ordering used across the navigation surface.

```
export function buildDisplayTitleFallbacks(modules: Module[]): Map<string, string> {
```

```
function compareModules(a: Module, b: Module): number {
```

```
function commonDirectory(paths: string[]): string[] {
```

```
function humanizeSegments(segments: string[]): string {
```

```
function normalizeLabel(value: string): string {
```

```
function sameStrings(a: string[], b: string[]): boolean {
```

## Module presentations and page rendering

<!-- lw:anchors packages/core/src/navigation.ts#extractTaskBullets packages/core/src/navigation.ts#loadModulePresentations packages/core/src/navigation.ts#generateQuickstart packages/core/src/navigation.ts#generateTasksPage packages/core/src/navigation.ts#selectRelatedModules packages/core/src/navigation.ts#updateModuleNavigateBlocks packages/core/src/navigation.ts#buildNavigateBlock -->

`loadModulePresentations` reuses `buildDisplayTitleFallbacks` to seed titles, then reads each `livewiki/<moduleId>.md` page via `safeIo.exists` and `safeIo.readText`. The visible implementation shows that a missing page (`pageExists === false`) yields `owner: null`, and that a malformed page is intentionally ignored — the `try { ... } catch { /* A malformed page is not trusted as a source of navigation metadata. */ }` branch is the documented fallback when `parseFrontmatter` or `readText` throws. `extractTaskBullets` is a pure function that derives the `When to use this page` bullets from an existing page body.

```
export async function loadModulePresentations(
```

```
function extractTaskBullets(body: string): string[] {
```

`generateQuickstart` and `generateTasksPage` produce the wiki's top-level content pages; the excerpt provided does not establish exhaustive behavior for either (the source is truncated inside `generateQuickstart`).

```
export function generateQuickstart(opts: {
```

```
export function generateTasksPage(opts: {
```

`selectRelatedModules` ranks peer modules by shared directory and `Module` role; `updateModuleNavigateBlocks` is the async orchestrator that rewrites the per-module `

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
- [Core pipeline orchestration, config, schema, and helpers](core-src-02.md) — dependency and dependent
- [anchor ledger, artifact validation, and batch status](core-src-01.md) — dependent
- [core SRC — incremental update, verification and walker](core-src-05.md) — dependency and dependent
<!-- livewiki:navigate:end -->` blocks. `buildNavigateBlock` constructs the inner markdown for that block. The excerpt does not establish the exhaustive selection algorithm.

```
export function selectRelatedModules(opts: {
```

```
export async function updateModuleNavigateBlocks(opts: {
```

```
function buildNavigateBlock(
```

## Tree-sitter parser and grammar registry

<!-- lw:anchors packages/core/src/parser.ts#_grammarToExtensionForTest packages/core/src/parser.ts#grammarForExtension packages/core/src/parser.ts#grammarsDir packages/core/src/parser.ts#initParser packages/core/src/parser.ts#listSupportedGrammars packages/core/src/parser.ts#loadLanguage packages/core/src/parser.ts#parseSource -->

The parser module wraps `web-tree-sitter` with a per-name `Language` cache and resolves `.wasm` grammars relative to the package's own `package.json`. `initParser` is the global idempotent bootstrap; the visible source caches its promise in `initPromise` so repeated callers await the same future. `grammarsDir` tries `./package.json` first (dev: `src/`) and falls back to `../package.json` (build: `dist/`); the visible `try { ... } catch { /* tenta o próximo */ }` branch falls through on resolution failure, and the function throws a plain `Error` if neither lookup succeeds.

```
export async function initParser(): Promise<void> {
```

```
function grammarsDir(): string {
```

`loadLanguage` reads the `.wasm` file synchronously, throws a descriptive `Error` when the file is absent, and caches the `Language` in `languageCache`. `parseSource` resolves an extension to a grammar name via the `EXT_TO_GRAMMAR` map and throws a plain `Error` when the extension is unsupported; the `if (!tree)` branch throws rather than returning `null`, because tree-sitter returning null is exceptional for non-empty input. `listSupportedGrammars` reads `grammarsDir` synchronously and returns the names of `.wasm` files (with `tree-sitter-` prefix and `.wasm` suffix stripped); when the directory is missing it returns `[]`.

```
async function loadLanguage(name: string): Promise<Language> {
```

```
export function grammarForExtension(ext: string): string | undefined {
```

```
export async function parseSource(
```

```
export function listSupportedGrammars(): string[] {
```

`_grammarToExtensionForTest` is the inverse map used only by tests to assert grammar↔extension wiring.

```
export function _grammarToExtensionForTest(grammar: string): string | undefined {
```

## Pointer block in AGENTS.md / CLAUDE.md

<!-- lw:anchors packages/core/src/pointer.ts#POINTER_END packages/core/src/pointer.ts#POINTER_FILES packages/core/src/pointer.ts#POINTER_START packages/core/src/pointer.ts#buildPointerBlock packages/core/src/pointer.ts#findPointerBlock packages/core/src/pointer.ts#pickPointerFile packages/core/src/pointer.ts#applyPointerReplace packages/core/src/pointer.ts#applyPointerRemove packages/core/src/pointer.ts#insertPointer packages/core/src/pointer.ts#removePointer packages/core/src/pointer.ts#readPointerStatus packages/core/src/pointer.ts#ensurePointerFile packages/core/src/pointer.ts#_internal -->

The pointer module owns the only sanctioned write outside the `safe-io` allowlist. `POINTER_START`, `POINTER_END`, and `POINTER_FILES` are stable string constants; `POINTER_FILES` is a readonly tuple of the two allowed filenames.

```
export const POINTER_START = "<!-- livewiki:start -->";
```

```
export const POINTER_END = "<!-- livewiki:end -->";
```

```
export const POINTER_FILES = ["AGENTS.md", "CLAUDE.md"] as const;
```

`pickPointerFile` resolves the target file from `(hasAgentsMd, hasClaudeMd, requested?)`; the visible source prefers an explicit request, then `AGENTS.md` if it exists, then `CLAUDE.md` if it exists, and finally defaults to `AGENTS.md` for fresh creation.

```
export function pickPointerFile(
```

`buildPointerBlock` returns the default contents — a short bilingual-style paragraph pointing at `livewiki/quickstart.md`, wrapped between the two markers. `findPointerBlock` is a pure parser: it returns `{ startIdx, endIdx, inner }` or `null`; the visible `if (!endMatch) { /* Bloco truncado (sem end marker) — trata como ausente. Evita corromper o doc. */ return null; }` branch is the documented fallback when only the start marker is present. `applyPointerReplace` either appends (`action: "inserted"`) or substitutes (`action: "replaced"`); when the resulting string equals the input it returns `action: "unchanged"` to prevent no-op writes. `applyPointerRemove` is the symmetric helper that returns the slice with the block excised.

```
export function buildPointerBlock(): string {
```

```
export function findPointerBlock(
```

```
export function applyPointerReplace(
```

```
export function applyPointerRemove(content: string): {
```

`insertPointer` and `removePointer` are the disk-touching entry points; they load the chosen file via `node:fs/promises`, call `applyPointerReplace` / `applyPointerRemove`, and write back through `safe-io` so the pointer exception still goes through the validated allowlist path. `readPointerStatus` reports whether the pointer block is present in a file without mutating it, and `ensurePointerFile` is a convenience that creates an empty `AGENTS.md` / `CLAUDE.md` if neither exists. `_internal` exposes `nodeFs` for tests that need to swap the filesystem dependency.

```
export async function insertPointer(
```

```
export async function removePointer(
```

```
export async function readPointerStatus(
```

```
export async function ensurePointerFile(
```

```
export const _internal = { nodeFs };
```

## Provider presets

<!-- lw:anchors packages/core/src/presets.ts#AVAILABLE_PRESETS packages/core/src/presets.ts#PRESET_TABLE packages/core/src/presets.ts#UnknownPresetError packages/core/src/presets.ts#UnknownPresetError.constructor packages/core/src/presets.ts#isKnownPreset packages/core/src/presets.ts#resolvePreset packages/core/src/presets.ts#resolveProviderConfig -->

The presets module embeds a data-only table of known LLM providers. `PRESET_TABLE` maps a `PresetName` (`anthropic`, `openai`, `openrouter`, `deepseek`, `kimi`, `minimax`, `gemini`, `nvidia`, `ollama`, `lmstudio`) to a `ProviderPreset` describing the `adapter`, `baseUrl`, `envVar` name (never the value), default `pricing`, operational `notes`, and optional `thinkingDefault` / `preferMaxCompletionTokens` / `defaultMaxOutputTokens` policy fields. `AVAILABLE_PRESETS` exposes the keys as a readonly array for iteration.

```
export const PRESET_TABLE: Record<PresetName, ProviderPreset> = {
```

```
export const AVAILABLE_PRESETS: readonly PresetName[] = [
```

`isKnownPreset` narrows a free-form `string` to `PresetName`. `resolvePreset` looks up by name and throws `UnknownPresetError` on miss; the constructor captures both the offending `presetName` and the `available` list for error messages. `resolveProviderConfig` merges a preset with user-supplied overrides from `.livewiki/config.json`.

```
export class UnknownPresetError extends Error {
```

```
constructor(name: string, available: readonly string[]) {
```

```
export function isKnownPreset(name: string): name is PresetName {
```

```
export function resolvePreset(name: string): ProviderPreset {
```

```
export function resolveProviderConfig(args: {
```

## Pricing table and cost calculation

<!-- lw:anchors packages/core/src/pricing.ts#PRICING_REFERENCE_DATE packages/core/src/pricing.ts#PRICING_TABLE packages/core/src/pricing.ts#lookupPricing packages/core/src/pricing.ts#calculateCostUsd packages/core/src/pricing.ts#formatCost -->

`PRICING_REFERENCE_DATE` is the compile-time stamp embedded in every cost report so users can tell stale prices from fresh ones. `PRICING_TABLE` is a `PricingTable` of USD-per-1M-tokens prices for popular Anthropic and OpenAI-compat models.

```
export const PRICING_REFERENCE_DATE = "2026-07-09";
```

```
export const PRICING_TABLE: PricingTable = {
```

`lookupPricing` is the resolution priority chain: an explicit per-model `override` from `.livewiki/config.json` wins over the embedded table, and an unknown model returns `{ tokensOnly: true }` so the report shows token counts without inventing USD.

```
export function lookupPricing(model: string, override?: PricingOverride): PricingLookup {
```

`calculateCostUsd` multiplies token counts against the resolved price (dividing by `1_000_000` for per-million pricing) and returns `{ input, output, total, refDate }`; when `lookupPricing` reports `tokensOnly` it returns `null` instead of fabricating a cost.

```
export function calculateCostUsd(
```

`formatCost` produces the human-readable string. The visible source shows the documented null path: when `cost === null` it returns the literal `(no price for model X)` so the absence of pricing is explicit rather than hidden.

```
export function formatCost(cost: { total: number } | null, model: string): string {
```

## Prompt templates and editorial contract

<!-- lw:anchors packages/core/src/prompts.ts#DEFAULT_CONTEXT_TOKEN_BUDGET packages/core/src/prompts.ts#DEFAULT_OUTPUT_TOKEN_BUDGET packages/core/src/prompts.ts#PAGE_OPENING_PROMPT_RULES packages/core/src/prompts.ts#LITERAL_SIGNATURE_PROMPT_RULE packages/core/src/prompts.ts#EXCEPTION_BRANCH_PROMPT_RULE packages/core/src/prompts.ts#buildStage4Prompt packages/core/src/prompts.ts#buildRepairPrompt packages/core/src/prompts.ts#buildStage2RefinePrompt packages/core/src/prompts.ts#buildQuickstartPrompt packages/core/src/prompts.ts#buildOverviewPrompt packages/core/src/prompts.ts#neutralizeUntrustedControlMarkers packages/core/src/prompts.ts#neutralizeUntrustedControlMarkersExceptValidAnchors packages/core/src/prompts.test.ts#copyableAnchorMarkers -->

Prompt construction is data-driven. `DEFAULT_CONTEXT_TOKEN_BUDGET` (30,000) and `DEFAULT_OUTPUT_TOKEN_BUDGET` (4,000) bound the per-module context and expected output size. `PAGE_OPENING_PROMPT_RULES`, `LITERAL_SIGNATURE_PROMPT_RULE`, and `EXCEPTION_BRANCH_PROMPT_RULE` are shared string-array constants that the initial and repair prompts embed verbatim to keep editorial behavior from drifting.

```
export const DEFAULT_CONTEXT_TOKEN_BUDGET = 30_000;
```

```
export const DEFAULT_OUTPUT_TOKEN_BUDGET = 4_000;
```

```
export const PAGE_OPENING_PROMPT_RULES = [
```

```
export const LITERAL_SIGNATURE_PROMPT_RULE =
```

```
export const EXCEPTION_BRANCH_PROMPT_RULE =
```

The five `build*Prompt` factories (`buildStage4Prompt`, `buildRepairPrompt`, `buildStage2RefinePrompt`, `buildQuickstartPrompt`, `buildOverviewPrompt`) return a `PromptPair` of `{ system, user }`. The test excerpt shows the system prompt is language-agnostic — it is identical between `en` and `pt-BR` — and that `${language}` only appears in the user message as an explicit output-language instruction. The same test asserts the closed list of canonical keys is embedded verbatim into the user prompt.

```
export function buildStage4Prompt(
```

```
export function buildRepairPrompt(
```

```
export function buildStage2RefinePrompt(
```

```
export function buildQuickstartPrompt(
```

```
export function buildOverviewPrompt(
```

`neutralizeUntrustedControlMarkers` and `neutralizeUntrustedControlMarkersExceptValidAnchors` rewrite untrusted strings (repo source and prior LLM output) before they are embedded in a prompt. The visible source comment describes the original failure mode: a visible bracketed placeholder leaked into generated pages, so the helpers now replace matches with whitespace of the same length — there is no visible token left worth quoting or mistaking for real syntax. The `_ExceptValidAnchors` variant preserves anchors that match the closed-list format used downstream.

```
export function neutralizeUntrustedControlMarkers(text: string): string {
```

```
export function neutralizeUntrustedControlMarkersExceptValidAnchors(
```

The accompanying test helper `copyableAnchorMarkers` parses a prompt string into one entry per `                       ` marker, splitting the body on whitespace and filtering empty tokens — used by the prompt tests to assert closed-list coverage and exact-once placement.

```
function copyableAnchorMarkers(text: string): string[][] {
```

## Safe disk I/O allowlist

<!-- lw:anchors packages/core/src/safe-io.ts#ALLOWED_DIRS packages/core/src/safe-io.ts#PathOutsideAllowlistError packages/core/src/safe-io.ts#PathOutsideAllowlistError.constructor packages/core/src/safe-io.ts#InvalidRelativePathError packages/core/src/safe-io.ts#InvalidRelativePathError.constructor packages/core/src/safe-io.ts#allowlistFor packages/core/src/safe-io.ts#allowedAbs packages/core/src/safe-io.ts#isInsideAllowlist packages/core/src/safe-io.ts#validateDeclared packages/core/src/safe-io.ts#findDeepestExisting packages/core/src/safe-io.ts#resolveAndValidate packages/core/src/safe-io.ts#writeText packages/core/src/safe-io.ts#readText packages/core/src/safe-io.ts#exists packages/core/src/safe-io.ts#mkdir packages/core/src/safe-io.ts#remove packages/core/src/safe-io.test.ts#detectSymlinkSupport -->

`ALLOWED_DIRS` is the canonical allowlist of root-relative directories where writes are permitted. `PathOutsideAllowlistError` and `InvalidRelativePathError` are the two typed errors the safe-io surface throws; both capture enough context (the offending `attempted` path or `relPath`, and the `allowlist`) for callers to surface useful messages. Their constructors are exported members and follow the standard `Error` subclass pattern.

```
export const ALLOWED_DIRS = ["livewiki", ".livewiki"] as const;
```

```
export class PathOutsideAllowlistError extends Error {
```

```
constructor(repoRoot: string, attempted: string, allowlist: readonly string[]) {
```

```
export class InvalidRelativePathError extends Error {
```

```
constructor(relPath: string, reason: string) {
```

`allowlistFor` returns the effective allowlist for an options object — `[...ALLOWED_DIRS]` by default and `[...ALLOWED_DIRS, "AGENTS.md", "CLAUDE.md"]` when `allowPointer` is true. `allowedAbs` resolves an `AllowedDir` to an absolute path under `repoRoot` and throws if the resulting relative path escapes the root (defense in depth). `isInsideAllowlist` is a pure check: with `allowPointer` it allows `repoRoot/AGENTS.md` and `repoRoot/CLAUDE.md` by exact filename match; otherwise it compares by `nodePath.relative` prefix to avoid `livewiki-evil` being accepted as inside `livewiki/`. `validateDeclared` is the first-pass validator that throws `InvalidRelativePathError` on absolute paths or `..` segments and `PathOutsideAllowlistError` on targets outside the allowlist.

```
function allowlistFor(opts: SafeIoOptions): readonly string[] {
```

```
function allowedAbs(repoRoot: string, dir: AllowedDir): string {
```

```
export function isInsideAllowlist(
```

```
function validateDeclared(
```

`findDeepestExisting` is the symlink-defense helper that walks from a target up to its deepest existing ancestor so that `realpath` can be applied before revalidation. `resolveAndValidate` is the exported `async` entry point that combines `validateDeclared` and the symlink-aware recheck.

```
function findDeepestExisting(
```

```
export async function resolveAndValidate(
```

The filesystem primitives — `writeText`, `readText`, `exists`, `mkdir`, `remove` — are the only sanctioned disk operations; every higher-level module funnels its I/O through them. The excerpt does not establish their exact post-resolve behavior because the source is truncated.

```
export async function writeText(
```

```
export async function readText(
```

```
export async function exists(
```

```
export async function mkdir(
```

```
export async function remove(
```

The companion test helper `detectSymlinkSupport` probes whether the current platform allows `fs.symlink` (Windows requires admin or Developer Mode); the test suite gates symlink-sensitive cases on this detection.

```
async function detectSymlinkSupport(): Promise<boolean> {
```

## Status reporting

<!-- lw:anchors packages/core/src/status.ts#run packages/core/src/status.ts#collect packages/core/src/status.ts#formatHuman -->

`status.ts` produces the wiki's snapshot report. `run` is the public async entry point: it resolves `.livewiki/index.db` through `safeIo.resolveAndValidate`, opens the SQLite index, calls `collect`, attempts to attach `snapshotMetrics` (best-effort, swallowable failure), and closes the database in a `finally` block. The visible source shows the documented `try { report.metrics = await snapshotMetrics(absRoot); } catch { report.metrics = null; }` fallback path so an unreadable metrics file cannot break status.

```
export async function run(
```

`collect` builds the in-memory `StatusReport`: file totals by language, top-N files by symbol count, symbol totals by kind, debt rows joined to anchors and doc pages (filtered to `resolved_at IS NULL`), and undocumented symbols with `dismissed = 0`. The excerpt truncates before the final `meta` block is fully visible, so the exact schema-version and timestamp keys are partially visible only.

```
function collect(db: import("better-sqlite3").Database, topN: number): StatusReport {
```

`formatHuman` renders the same `StatusReport` as a multi-line human string.

```
export function formatHuman(report: StatusReport): string {
```

## Parser-symbol test seam

<!-- lw:anchors packages/core/src/symbols.test.ts#parse -->

The `symbols.test.ts` file defines a single test helper `parse` that wraps `parseSource` for use across the symbol-extraction tests. The visible source shows it calls `parseSource(ext, src)` directly after a top-level `beforeAll(initParser)` that initializes the tree-sitter runtime once for the suite.

```
async function parse(ext: string, src: string) {
```