---
title: "Core library surfaces — navigation, parser, pointer, presets, pricing, prompts, safe I/O, status"
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

# Core library surfaces — navigation, parser, pointer, presets, pricing, prompts, safe I/O, status

This page documents the implementation surfaces of the `packages/core/src` library that drive repository indexing, documentation generation, and controlled on-disk writes for the livewiki tool.

## When to use this page

- Look up the public API and signatures of navigation, parsing, pointer, presets, pricing, prompts, safe I/O, and status modules.
- Trace how a generated wiki page is produced, validated, and persisted under the allowlist.
- Verify how provider presets, pricing overrides, and prompt rules are wired into the batch pipeline.
- Audit the allowlist, symlink, and pointer exceptions before adding new I/O or write paths.

## How it fits

These modules live under `packages/core/src` and form the in-process library that the livewiki CLI and batch pipeline call into. They cover parse-once indexing (`parser`, `symbols`), policy data (`presets`, `pricing`), prompt construction (`prompts`), markdown rendering and navigation (`navigation`), the sole sanctioned on-disk writer (`safe-io`), the opt-in pointer exception (`pointer`), and the human/JSON status report (`status`). The excerpt below is truncated at the source budget; several bodies end mid-function and are documented only for their visible signatures and any visible failure paths.

## Navigation page assembly

<!-- lw:anchors packages/core/src/navigation.ts#buildDisplayTitleFallbacks packages/core/src/navigation.ts#buildNavigateBlock packages/core/src/navigation.ts#commonDirectory packages/core/src/navigation.ts#compareModules packages/core/src/navigation.ts#extractTaskBullets packages/core/src/navigation.ts#generateQuickstart packages/core/src/navigation.ts#generateTasksPage packages/core/src/navigation.ts#humanizeSegments packages/core/src/navigation.ts#loadModulePresentations packages/core/src/navigation.ts#normalizeLabel packages/core/src/navigation.ts#sameStrings packages/core/src/navigation.ts#selectRelatedModules packages/core/src/navigation.ts#updateModuleNavigateBlocks -->

The `navigation.ts` module derives human-facing titles from `Module[]`, loads per-module presentation metadata from existing pages, and produces the wiki navigation block plus quickstart and tasks pages.

`buildDisplayTitleFallbacks` is keyed on `Module.id` and only emits a `Map<string, string>`; the visible source does not establish exhaustive disambiguation behavior beyond walking increasingly long directory suffixes and appending `source` when a `src`/`source` segment is dropped.

```ts
export function buildDisplayTitleFallbacks(modules: Module[]): Map<string, string> {
```

`loadModulePresentations` reads `livewiki/<moduleId>.md` for each module via `safe-io`. The source visibly contains a `try`/`catch` that swallows malformed-page errors (a malformed page is not trusted as a source of navigation metadata) and a `.catch(() => false)` on `safeIo.exists` so a missing page is treated as "not present"; the function does not throw on a missing page.

```ts
export async function loadModulePresentations(
```

`generateQuickstart` returns the human quickstart string given a totals tuple.

```ts
export function generateQuickstart(opts: {
```

`generateTasksPage` is a sibling emitter for the tasks page.

```ts
export function generateTasksPage(opts: {
```

`selectRelatedModules` chooses related modules given an options object.

```ts
export function selectRelatedModules(opts: {
```

`updateModuleNavigateBlocks` is the async on-disk writer that updates navigation blocks; the excerpt truncates before its body, so exhaustive behavior (retry, rollback) is not established.

```ts
export async function updateModuleNavigateBlocks(opts: {
```

`buildNavigateBlock` is the renderer for the navigation block content; its full body is not in the excerpt.

```ts
function buildNavigateBlock(
```

`extractTaskBullets` extracts ordered task bullets from a markdown body string.

```ts
function extractTaskBullets(body: string): string[] {
```

`commonDirectory` computes the longest shared path prefix across a list of file paths.

```ts
function commonDirectory(paths: string[]): string[] {
```

`humanizeSegments` turns the resolved directory segments into a readable title fragment.

```ts
function humanizeSegments(segments: string[]): string {
```

`normalizeLabel` is the comparator used to decide whether a frontmatter title should override a module-derived title.

```ts
function normalizeLabel(value: string): string {
```

`compareModules` is the sort key used by `buildDisplayTitleFallbacks` and `loadModulePresentations`.

```ts
function compareModules(a: Module, b: Module): number {
```

`sameStrings` is a content-equality helper used when comparing frontmatter or label sets.

```ts
function sameStrings(a: string[], b: string[]): boolean {
```

## Parser and grammar registry

<!-- lw:anchors packages/core/src/parser.ts#_grammarToExtensionForTest packages/core/src/parser.ts#grammarForExtension packages/core/src/parser.ts#grammarsDir packages/core/src/parser.ts#initParser packages/core/src/parser.ts#listSupportedGrammars packages/core/src/parser.ts#loadLanguage packages/core/src/parser.ts#parseSource -->

`parser.ts` wraps `web-tree-sitter` with a per-package WASM grammar cache. The visible MVP set is TypeScript, TSX, JavaScript variants, and Python.

`initParser` is idempotent and is cached behind a module-local `initPromise`; re-entries resolve to the original promise rather than re-initializing.

```ts
export async function initParser(): Promise<void> {
```

`grammarsDir` resolves the grammar directory relative to the package's own `package.json`, trying `./package.json` and then `../package.json`. The visible source shows a fallback loop: if `req.resolve(rel)` throws, it advances to the next candidate; if all candidates fail it throws a descriptive `Error`. This means in a misbuilt package the failure surfaces as an exception rather than a silent fallback.

```ts
function grammarsDir(): string {
```

`loadLanguage` caches `Language` instances by name, reads `tree-sitter-<name>.wasm` from `grammarsDir()`, and visibly throws when the WASM file is missing on disk.

```ts
async function loadLanguage(name: string): Promise<Language> {
```

`grammarForExtension` performs a case-insensitive lookup against the embedded extension map; it returns the grammar name or `undefined` for unknown extensions.

```ts
export function grammarForExtension(ext: string): string | undefined {
```

`parseSource` is the public parse entrypoint. It visibly throws on an unsupported extension (no grammar for that file type) and on a `null` tree (described in the source as a rare path, treated as an error rather than propagated).

```ts
export async function parseSource(
```

`listSupportedGrammars` enumerates `.wasm` files in the grammar directory; if the directory is absent it returns an empty array rather than throwing.

```ts
export function listSupportedGrammars(): string[] {
```

`_grammarToExtensionForTest` reverses the extension map for tests asserting grammar reachability.

```ts
export function _grammarToExtensionForTest(grammar: string): string | undefined {
```

## Pointer injection into AGENTS.md / CLAUDE.md

<!-- lw:anchors packages/core/src/pointer.ts#POINTER_END packages/core/src/pointer.ts#POINTER_FILES packages/core/src/pointer.ts#POINTER_START packages/core/src/pointer.ts#_internal packages/core/src/pointer.ts#applyPointerRemove packages/core/src/pointer.ts#applyPointerReplace packages/core/src/pointer.ts#buildPointerBlock packages/core/src/pointer.ts#ensurePointerFile packages/core/src/pointer.ts#findPointerBlock packages/core/src/pointer.ts#insertPointer packages/core/src/pointer.ts#pickPointerFile packages/core/src/pointer.ts#readPointerStatus packages/core/src/pointer.ts#removePointer -->

The pointer module is the explicit, opt-in exception to the allowlist in `safe-io`. It manages the `<!-- livewiki:start --> ... <!-- livewiki:end -->` block in `AGENTS.md` or `CLAUDE.md`.

`POINTER_START`, `POINTER_END`, and `POINTER_FILES` are the stable string markers and the allowed target-file list (`AGENTS.md`, `CLAUDE.md`). External parsers depend on these strings, so they are kept as exported constants.

```ts
export const POINTER_START = "<!-- livewiki:start -->";
export const POINTER_END = "<!-- livewiki:end -->";
export const POINTER_FILES = ["AGENTS.md", "CLAUDE.md"] as const;
```

`_internal` re-exports `nodeFs` for test seams that need to stub filesystem behavior.

```ts
export const _internal = { nodeFs };
```

`pickPointerFile` chooses the target by precedence: explicit `requested`; otherwise `AGENTS.md` if present, then `CLAUDE.md` if present, otherwise default to creating `AGENTS.md`. It does not create files itself — that is the caller's responsibility.

```ts
export function pickPointerFile(
```

`buildPointerBlock` renders the default block content (one short paragraph pointing to `livewiki/quickstart.md` plus the two markers).

```ts
export function buildPointerBlock(): string {
```

`findPointerBlock` parses an in-memory markdown string for the pointer region. It visibly tolerates leading whitespace before the start marker and accepts an end marker even with whitespace around it. The visible branch: if the end marker is missing (truncated block) it returns `null` rather than corrupting the document; if both are present it returns `{ startIdx, endIdx, inner }` of the first match.

```ts
export function findPointerBlock(
```

`applyPointerReplace` is a pure string operation. If the block is absent it appends with a one-line separator (or no separator if the buffer was empty); if present, it substitutes in place and returns `"unchanged"` when the result is byte-identical to the input.

```ts
export function applyPointerReplace(
```

`applyPointerRemove` is declared in the signature table but the source excerpt truncates before its body.

```ts
export function applyPointerRemove(content: string): {
```

`insertPointer` is the on-disk writer; its full body is not in the excerpt, so retry and rollback behavior is not established here.

```ts
export async function insertPointer(
```

`removePointer` mirrors `insertPointer` for deletion; body not in excerpt.

```ts
export async function removePointer(
```

`readPointerStatus` reports the current state for status consumers.

```ts
export async function readPointerStatus(
```

`ensurePointerFile` creates the target pointer file if it does not yet exist; body not in excerpt.

```ts
export async function ensurePointerFile(
```

## Provider preset table

<!-- lw:anchors packages/core/src/presets.ts#AVAILABLE_PRESETS packages/core/src/presets.ts#PRESET_TABLE packages/core/src/presets.ts#UnknownPresetError packages/core/src/presets.ts#UnknownPresetError.constructor packages/core/src/presets.ts#isKnownPreset packages/core/src/presets.ts#resolvePreset packages/core/src/presets.ts#resolveProviderConfig -->

`presets.ts` is the embedded provider table (data, not logic). Each entry carries adapter, base URL, env-var name (never the key value), pricing defaults, and operational notes.

`PRESET_TABLE` is the source-of-truth map from `PresetName` to `ProviderPreset`. The visible source confirms `anthropic` is included; the rest of the table is truncated by the budget, so this page does not enumerate every entry — use the file itself for the canonical list. Pricing values shown in the table are best-effort and stamped with `PRICING_REFERENCE_DATE` from `pricing.ts`.

```ts
export const PRESET_TABLE: Record<PresetName, ProviderPreset> = {
```

`AVAILABLE_PRESETS` is the runtime iteration order of preset names; body truncated.

```ts
export const AVAILABLE_PRESETS: readonly PresetName[] = [
```

`UnknownPresetError` is thrown when `resolvePreset` is given a name not present in `PRESET_TABLE`. The constructor records the offending name and the available list; it does not perform a lookup itself.

```ts
export class UnknownPresetError extends Error {
```

```ts
constructor(name: string, available: readonly string[]) {
```

`resolvePreset` looks up a preset by name; the visible source confirms it throws `UnknownPresetError` on miss. Full body truncated.

```ts
export function resolvePreset(name: string): ProviderPreset {
```

`resolveProviderConfig` combines a preset with user overrides; the excerpt does not include its body, so override-merging semantics are not exhaustively documented here.

```ts
export function resolveProviderConfig(args: {
```

`isKnownPreset` is the type-narrowing predicate for `PresetName`.

```ts
export function isKnownPreset(name: string): name is PresetName {
```

## Pricing table and cost formatting

<!-- lw:anchors packages/core/src/pricing.ts#PRICING_REFERENCE_DATE packages/core/src/pricing.ts#PRICING_TABLE packages/core/src/pricing.ts#calculateCostUsd packages/core/src/pricing.ts#formatCost packages/core/src/pricing.ts#lookupPricing -->

`pricing.ts` carries the embedded USD-per-1M-tokens reference and the override-aware lookup used by the status and batch reports.

`PRICING_REFERENCE_DATE` is the stamp embedded in every cost report so the user knows how fresh the numbers are.

```ts
export const PRICING_REFERENCE_DATE = "2026-07-09";
```

`PRICING_TABLE` is the visible MVP subset: Claude 4.5 family entries plus selected OpenAI-compat entries. The table is intentionally short — stale prices are reported as stale rather than guessed.

```ts
export const PRICING_TABLE: PricingTable = {
```

`lookupPricing` resolves a model to a `PricingLookup`. Precedence is: per-model override from `.livewiki/config.json`, then the embedded table, then a `tokensOnly` result. It never invents USD numbers.

```ts
export function lookupPricing(model: string, override?: PricingOverride): PricingLookup {
```

`calculateCostUsd` multiplies token counts by the resolved per-million rates. The visible source shows the early return: when `lookup` returns `tokensOnly`, `calculateCostUsd` returns `null`; callers in the report formatter must therefore tolerate a `null` total.

```ts
export function calculateCostUsd(
```

`formatCost` turns a numeric or `null` total into a human string. When `cost` is `null` it returns the literal `(no price for model X)` instead of fabricating a number.

```ts
export function formatCost(cost: { total: number } | null, model: string): string {
```

## Prompt templates and marker neutralization

<!-- lw:anchors packages/core/src/prompts.test.ts#copyableAnchorMarkers packages/core/src/prompts.ts#DEFAULT_CONTEXT_TOKEN_BUDGET packages/core/src/prompts.ts#DEFAULT_OUTPUT_TOKEN_BUDGET packages/core/src/prompts.ts#EXCEPTION_BRANCH_PROMPT_RULE packages/core/src/prompts.ts#LITERAL_SIGNATURE_PROMPT_RULE packages/core/src/prompts.ts#PAGE_OPENING_PROMPT_RULES packages/core/src/prompts.ts#buildOverviewPrompt packages/core/src/prompts.ts#buildQuickstartPrompt packages/core/src/prompts.ts#buildRepairPrompt packages/core/src/prompts.ts#buildStage2RefinePrompt packages/core/src/prompts.ts#buildStage4Prompt packages/core/src/prompts.ts#neutralizeUntrustedControlMarkers packages/core/src/prompts.ts#neutralizeUntrustedControlMarkersExceptValidAnchors -->

`prompts.ts` builds the `system`/`user` pairs sent to the LLM during batch documentation, plus the rules they must obey.

`DEFAULT_CONTEXT_TOKEN_BUDGET` and `DEFAULT_OUTPUT_TOKEN_BUDGET` are the budgets applied to the code context and to the generated Markdown respectively.

```ts
export const DEFAULT_CONTEXT_TOKEN_BUDGET = 30_000;
export const DEFAULT_OUTPUT_TOKEN_BUDGET = 4_000;
```

`PAGE_OPENING_PROMPT_RULES`, `LITERAL_SIGNATURE_PROMPT_RULE`, and `EXCEPTION_BRANCH_PROMPT_RULE` are shared rules reused by both initial and repair prompts so they cannot drift. The visible text requires: a fixed opening structure (H1, responsibility sentence, `When to use this page`, action-verb task bullets, `How it fits`, repository-context paragraph); no opening `lw:anchors` marker; literal byte-for-byte signatures from the symbol table; and explicit exception-branch scoping when the source contains a visible `throw`/`catch`/fallback.

```ts
export const PAGE_OPENING_PROMPT_RULES = [
export const LITERAL_SIGNATURE_PROMPT_RULE =
export const EXCEPTION_BRANCH_PROMPT_RULE =
```

`buildStage4Prompt` is the per-module generator entrypoint. Its body is truncated past the signature, so exhaustive parameter handling is not documented here.

```ts
export function buildStage4Prompt(
```

`buildStage2RefinePrompt`, `buildQuickstartPrompt`, `buildOverviewPrompt`, and `buildRepairPrompt` are sibling prompt builders for stage 2, quickstart generation, overview pages, and post-validation repairs. Bodies truncated.

```ts
export function buildStage2RefinePrompt(
export function buildQuickstartPrompt(
export function buildOverviewPrompt(
export function buildRepairPrompt(
```

`neutralizeUntrustedControlMarkers` rewrites any `<!-- lw:TYPE ... -->` / `<!-- /lw:TYPE -->` substring found in untrusted text into whitespace of the same length before it reaches the prompt. The visible rationale in the source describes a real failure mode where the previous bracketed placeholder was itself copied verbatim by the model; the current implementation removes the marker with no visible token left behind, so the model has nothing to echo.

```ts
export function neutralizeUntrustedControlMarkers(text: string): string {
```

`neutralizeUntrustedControlMarkersExceptValidAnchors` is the variant used when valid, real anchor markers in the untrusted text must survive — only the not-in-the-allowlist markers are masked. Body truncated.

```ts
export function neutralizeUntrustedControlMarkersExceptValidAnchors(
```

`copyableAnchorMarkers` is the test helper that scans a prompt string and returns every `<!-- lw:anchors ... -->` body as an array of key arrays. It only recognizes `<!-- lw:anchors ... -->` blocks and ignores the other `lw:*` block types.

```ts
function copyableAnchorMarkers(text: string): string[][] {
```

## Safe on-disk I/O and allowlist enforcement

<!-- lw:anchors packages/core/src/safe-io.ts#ALLOWED_DIRS packages/core/src/safe-io.ts#InvalidRelativePathError packages/core/src/safe-io.ts#InvalidRelativePathError.constructor packages/core/src/safe-io.ts#PathOutsideAllowlistError packages/core/src/safe-io.ts#PathOutsideAllowlistError.constructor packages/core/src/safe-io.ts#allowedAbs packages/core/src/safe-io.ts#allowlistFor packages/core/src/safe-io.ts#exists packages/core/src/safe-io.ts#findDeepestExisting packages/core/src/safe-io.ts#isInsideAllowlist packages/core/src/safe-io.ts#mkdir packages/core/src/safe-io.ts#readText packages/core/src/safe-io.ts#remove packages/core/src/safe-io.ts#resolveAndValidate packages/core/src/safe-io.ts#validateDeclared packages/core/src/safe-io.ts#writeText -->

`safe-io.ts` is the only module authorized to write to disk. It validates every path against the allowlist and additionally walks the realpath chain to defeat symlink escapes.

`ALLOWED_DIRS` is the literal allowlist: `livewiki` and `.livewiki` relative to the resolved repo root.

```ts
export const ALLOWED_DIRS = ["livewiki", ".livewiki"] as const;
```

`PathOutsideAllowlistError` is thrown when the resolved path escapes the allowlist (declared or via symlink). Its constructor records repo root, attempted path, and allowlist for diagnostic output.

```ts
export class PathOutsideAllowlistError extends Error {
```

```ts
constructor(repoRoot: string, attempted: string, allowlist: readonly string[]) {
```

`InvalidRelativePathError` is thrown for shape errors on the declared path — absolute paths or `..` traversal segments — before allowlist checks.

```ts
export class InvalidRelativePathError extends Error {
```

```ts
constructor(relPath: string, reason: string) {
```

`allowlistFor` materializes the effective allowlist given options: when `allowPointer` is true, `AGENTS.md` and `CLAUDE.md` are appended to the literal allowlist; otherwise only `ALLOWED_DIRS` applies.

```ts
function allowlistFor(opts: SafeIoOptions): readonly string[] {
```

`allowedAbs` resolves a literal allowlist entry under the repo root and visibly throws if the resolved directory somehow escapes the repo root (a defense-in-depth check on the literal table).

```ts
function allowedAbs(repoRoot: string, dir: AllowedDir): string {
```

`isInsideAllowlist` is the public predicate. It visibly does not touch the disk. When `allowPointer` is enabled, it accepts the root-level `AGENTS.md` or `CLAUDE.md` by exact filename match; subdirectories containing `AGENTS.md` are rejected. The allowlist check uses prefix-plus-separator semantics (`livewiki-evil` is not inside `livewiki/`), explicitly tested.

```ts
export function isInsideAllowlist(
```

`validateDeclared` rejects absolute paths and any `..` segment in the declared path, then runs the declared allowlist check. The body beyond the early `throw` branches is truncated.

```ts
function validateDeclared(
```

`findDeepestExisting` walks from the resolved target up to the deepest existing ancestor. It is used by the symlink check to `realpath` an anchor we trust, then re-resolve the rest. Body truncated.

```ts
function findDeepestExisting(
```

`resolveAndValidate` is the public entrypoint: declared-path validation, then realpath defense. The visible source ends mid-function; full behavior is not established here.

```ts
export async function resolveAndValidate(
```

`writeText` and `readText` are the policy-checked wrappers over `node:fs/promises` for ASCII text round-trips.

```ts
export async function writeText(
export async function readText(
```

`exists`, `mkdir`, and `remove` are the corresponding predicates and directory operations.

```ts
export async function exists(
export async function mkdir(
export async function remove(
```

## Status report assembly

<!-- lw:anchors packages/core/src/status.ts#collect packages/core/src/status.ts#formatHuman packages/core/src/status.ts#run -->

`status.ts` builds the multi-section report rendered by `livewiki status` in either human or JSON form.

`run` opens the SQLite index via `safe-io` (the only place outside tests that legitimately touches `.livewiki/index.db`), collects the snapshot, and snapshots the incremental token metrics. The visible source shows a `try`/`finally` that closes the database handle on completion, and a separate `try`/`catch` around `snapshotMetrics` so a metrics failure downgrades `report.metrics` to `null` rather than failing the status command.

```ts
export async function run(
```

`collect` runs the SQL aggregations: per-language file counts, per-kind symbol counts, top-N files by symbol count, the unresolved-debt join, undocumented symbol counts, and the schema meta rows. Body truncated.

```ts
function collect(db: import("better-sqlite3").Database, topN: number): StatusReport {
```

`formatHuman` renders the structured report as a multi-line string for terminal output.

```ts
export function formatHuman(report: StatusReport): string {
```

## Test helpers

<!-- lw:anchors packages/core/src/safe-io.test.ts#detectSymlinkSupport packages/core/src/symbols.test.ts#parse -->

Two test-only helpers appear in this module.

`symbols.test.ts#parse` is a thin local wrapper around `parseSource` to keep test call sites terse and to centralize the extension-and-source pair.

```ts
async function parse(ext: string, src: string) {
```

`safe-io.test.ts#detectSymlinkSupport` probes symlink capability once per test run by writing a target file and creating/cleaning up a symlink. The visible source contains a top-level `try`/`catch`: when symlink creation fails (Windows without Developer Mode, restricted sandboxes) it returns `false` so `it.runIf(canSymlink)` can skip the symlink-sensitive cases.

```ts
async function detectSymlinkSupport(): Promise<boolean> {
```
