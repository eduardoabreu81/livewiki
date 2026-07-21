---
title: Core source — manifest persistence, Markdown masking, Mermaid validation, and module identification
owner: generated
anchors:
  - packages/core/src/manifest.test.ts#writeLivewikiFile
  - packages/core/src/manifest.ts#MANIFEST_REL_PATH
  - packages/core/src/manifest.ts#MANIFEST_VERSION
  - packages/core/src/manifest.ts#buildManifest
  - packages/core/src/manifest.ts#computeSnapshotHash
  - packages/core/src/manifest.ts#listFiles
  - packages/core/src/manifest.ts#manifestsEqual
  - packages/core/src/manifest.ts#pendingBatchEqual
  - packages/core/src/manifest.ts#readManifest
  - packages/core/src/manifest.ts#writeManifestIfChanged
  - packages/core/src/markdown-mask.ts#boundedExcerpt
  - packages/core/src/markdown-mask.ts#consumeFenceLine
  - packages/core/src/markdown-mask.ts#createFenceState
  - packages/core/src/markdown-mask.ts#hasUnclosedFence
  - packages/core/src/markdown-mask.ts#hasUnclosedMarkdown
  - packages/core/src/markdown-mask.ts#maskCodeSpans
  - packages/core/src/markdown-mask.ts#maskCodeSpansPreservingLength
  - packages/core/src/markdown-mask.ts#maskFencedCodeBlocks
  - packages/core/src/markdown-mask.ts#maskFencedCodeBlocksPreservingLength
  - packages/core/src/markdown-mask.ts#maskInlineCode
  - packages/core/src/markdown-mask.ts#unclosedMarkdownDiagnostic
  - packages/core/src/mermaid-validator.ts#parseWithTemporaryDom
  - packages/core/src/mermaid-validator.ts#restoreGlobal
  - packages/core/src/mermaid-validator.ts#validateMermaidSyntax
  - packages/core/src/modules.test.ts#idFor
  - packages/core/src/modules.ts#DEFAULT_FLOW_SIGNAL_PATTERNS
  - packages/core/src/modules.ts#DEFAULT_PATH_ROLE_PATTERNS
  - packages/core/src/modules.ts#DuplicateModuleIdError
  - packages/core/src/modules.ts#DuplicateModuleIdError.constructor
  - packages/core/src/modules.ts#ExactPartitionError
  - packages/core/src/modules.ts#ExactPartitionError.constructor
  - packages/core/src/modules.ts#MODULE_SPLIT_DEFAULTS
  - packages/core/src/modules.ts#SPLIT_AXIS_DISABLED
  - packages/core/src/modules.ts#applyRefinedDisplayTitles
  - packages/core/src/modules.ts#assertExactPathPartition
  - packages/core/src/modules.ts#assertUniqueModuleIds
  - packages/core/src/modules.ts#axisEnabled
  - packages/core/src/modules.ts#candidateIdSequence
  - packages/core/src/modules.ts#chunkFlatBucket
  - packages/core/src/modules.ts#classifyModuleRole
  - packages/core/src/modules.ts#classifyPathRole
  - packages/core/src/modules.ts#countSymbols
  - packages/core/src/modules.ts#dirToModuleId
  - packages/core/src/modules.ts#fileStem
  - packages/core/src/modules.ts#fitsLimits
  - packages/core/src/modules.ts#groupPathsByNextSegment
  - packages/core/src/modules.ts#identifyModulesHeuristic
  - packages/core/src/modules.ts#makeUniqueDeterministicIds
  - packages/core/src/modules.ts#matchesAnyPathPattern
  - packages/core/src/modules.ts#normalizePresentationLabel
  - packages/core/src/modules.ts#normalizeRefinedDisplayTitle
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

# Core source — manifest persistence, Markdown masking, Mermaid validation, and module identification

This page documents the deterministic helpers in `packages/core/src` that persist the livewiki `.manifest.json`, mask and inspect Markdown code constructs, validate Mermaid diagrams through a temporary DOM, and partition repository paths into uniquely identified modules.

## When to use this page

- **Read or write the on-disk `.manifest.json`** for a repo under documentation, including the `readManifest`, `writeManifestIfChanged`, `computeSnapshotHash`, `buildManifest`, `listFiles`, `manifestsEqual`, `pendingBatchEqual`, `MANIFEST_REL_PATH`, and `MANIFEST_VERSION` symbols, plus the test helper `writeLivewikiFile`.
- **Mask or inspect Markdown code constructs** in user-supplied wiki bodies using the `markdown-mask` exports and the inline-code/fence state machine behind `hasUnclosedFence`, `hasUnclosedMarkdown`, and `unclosedMarkdownDiagnostic`.
- **Validate Mermaid diagram sources** via `validateMermaidSyntax`, understanding how `parseWithTemporaryDom` and `restoreGlobal` isolate the global `window`/`document` for the duration of one parse.
- **Partition repository paths into modules**, classify their role, resolve import edges, and split oversized units with the `modules.ts` helpers and the `DuplicateModuleIdError` and `ExactPartitionError` validators.

## How it fits

These files sit in the `packages/core/src` directory of the livewiki repository and act as the deterministic substrate that the LLM-driven stages build on. `manifest.ts` writes `livewiki/.manifest.json` via the safe-io allowlist so the manifest is versioned alongside the wiki it describes; the snapshot hash deliberately excludes the manifest itself to avoid CI loops. `markdown-mask.ts` is consumed by `verify.ts`, `artifact.ts`, and `anchors.ts` so every structural scan agrees on what counts as Markdown code rather than a navigable link or anchor marker. `mermaid-validator.ts` lazily loads `mermaid` under a per-call `JSDOM` because the parser expects browser globals and parses are serialized to keep those globals stable. `modules.ts` groups files by directory, optionally disambiguates leaf collisions between sibling packages, and enforces uniqueness plus exact path coverage before the next batch stage writes pages. The sibling `*.test.ts` files describe the contract each helper must hold.

## Manifest persistence

<!-- lw:anchors packages/core/src/manifest.ts#MANIFEST_REL_PATH packages/core/src/manifest.ts#MANIFEST_VERSION packages/core/src/manifest.ts#readManifest packages/core/src/manifest.ts#writeManifestIfChanged packages/core/src/manifest.ts#computeSnapshotHash packages/core/src/manifest.ts#listFiles packages/core/src/manifest.ts#manifestsEqual packages/core/src/manifest.ts#pendingBatchEqual packages/core/src/manifest.ts#buildManifest packages/core/src/manifest.test.ts#writeLivewikiFile -->

The manifest module persists a small JSON sidecar that the batch pipeline reads on subsequent runs to resume cross-machine work. The two exported constants anchor the contract:

```ts
export const MANIFEST_VERSION = 1;
export const MANIFEST_REL_PATH = "livewiki/.manifest.json";
```

`readManifest` returns `LivewikiManifest | null` for a given repo root:

```ts
export async function readManifest(repoRoot: string): Promise<LivewikiManifest | null> {
```

The excerpt shows that it tolerates corruption by returning `null` instead of throwing when the file is missing, unreadable, or invalid JSON. If the parsed body is missing a numeric `version` or a string `snapshotHash`, the function also returns `null`. Callers can therefore treat `null` as "no prior state" without catching exceptions; this is the fail-open posture visible in the source.

`writeManifestIfChanged` is the write side and returns `Promise<boolean>` indicating whether it actually wrote to disk:

```ts
export async function writeManifestIfChanged(
  repoRoot: string,
  manifest: LivewikiManifest,
): Promise<boolean> {
```

The implementation reads the current manifest, compares it via `manifestsEqual`, and only writes through `safeIo.writeText` when content actually changed. This is the anti-loop guard the test suite asserts on: two successive init runs with identical content must return `false` on the second call so CI `git diff` stays clean.

`computeSnapshotHash` walks `livewiki/` recursively and hashes each file's content together with its relative path:

```ts
export async function computeSnapshotHash(repoRoot: string): Promise<string> {
```

The provided excerpt shows the deterministic-ordering recipe: it calls the internal `listFiles`, filters out the manifest's basename, sorts the remaining entries, concatenates `rel\n<sha256(content)>\n` lines, and finally hashes that concatenation. The hash format is a 64-character hex string and excludes the manifest itself; the test "EXCLUI o próprio `.manifest.json` do hash" verifies this directly. The truncated source does not establish behavior for every edge case (for example, permission errors during `readdir` are swallowed inside `listFiles`), so callers should not assume exhaustive coverage of every filesystem failure mode.

`listFiles` is the recursive walker used by `computeSnapshotHash`:

```ts
async function listFiles(dir: string): Promise<string[]> {
```

It uses a manual stack rather than recursion and silently skips directories whose `readdir` throws — a fail-open posture visible in the truncated excerpt.

`manifestsEqual` deliberately ignores `updatedAt`. Comparing timestamps would cause every call to rewrite the file and re-trigger the CI diff:

```ts
function manifestsEqual(a: LivewikiManifest, b: LivewikiManifest): boolean {
```

`pendingBatchEqual` compares the four fields `runId`, `stage`, `done`, and `total` only when both sides are non-null, returning `true` when both are null and `false` when exactly one is null:

```ts
function pendingBatchEqual(a: PendingBatchRef | null, b: PendingBatchRef | null): boolean {
```

`buildManifest` constructs a fresh `LivewikiManifest` from the supplied `lastDocumentedCommit`, `snapshotHash`, and `pendingBatch`, stamping `updatedAt` at call time:

```ts
export function buildManifest(args: {
  lastDocumentedCommit: string | null;
  snapshotHash: string;
  pendingBatch: PendingBatchRef | null;
}): LivewikiManifest {
```

The test helper `writeLivewikiFile` writes a file under a temporary `repoRoot` for the manifest tests:

```ts
async function writeLivewikiFile(relPath: string, content: string): Promise<void> {
```

It creates intermediate directories with `recursive: true` before writing, so each test can stage files at arbitrary depths without manual setup.

## Markdown masking and unclosed-construct diagnostics

<!-- lw:anchors packages/core/src/markdown-mask.ts#createFenceState packages/core/src/markdown-mask.ts#consumeFenceLine packages/core/src/markdown-mask.ts#maskFencedCodeBlocks packages/core/src/markdown-mask.ts#maskFencedCodeBlocksPreservingLength packages/core/src/markdown-mask.ts#maskInlineCode packages/core/src/markdown-mask.ts#maskCodeSpans packages/core/src/markdown-mask.ts#maskCodeSpansPreservingLength packages/core/src/markdown-mask.ts#hasUnclosedFence packages/core/src/markdown-mask.ts#hasUnclosedMarkdown packages/core/src/markdown-mask.ts#unclosedMarkdownDiagnostic packages/core/src/markdown-mask.ts#boundedExcerpt -->

The masking helpers share one fenced-block state machine built from `createFenceState` and `consumeFenceLine`. `createFenceState` returns a fresh object holding `inFence`, `fenceChar`, and `fenceLen`:

```ts
function createFenceState(): FenceState {
```

`consumeFenceLine` advances that state for a single line:

```ts
function consumeFenceLine(line: string, state: FenceState): boolean {
```

When not currently inside a fence, it tries to match the opening pattern `^[ \t]{0,3}(\`{3,}|~{3,})`; on a match it records the character and run length and returns `true`. While inside a fence, it constructs a closing regex from the recorded character and length and clears `inFence` when matched. The line belongs to the fence — opening, content, or closing — whenever the function returns `true`.

`maskFencedCodeBlocks` blanks every line consumed by the state machine:

```ts
export function maskFencedCodeBlocks(text: string): string {
```

It uses a CRLF-safe split (`text.split(/\r?\n/)`) and rejoins with `\n`. The source comment explicitly warns that a naive `\n` split would leave trailing `\r` on each line and break the closing-fence `$` anchor on Windows-style files, masking the rest of the page. `maskFencedCodeBlocksPreservingLength` performs the same walk but replaces consumed line contents with spaces and re-emits the original `\r\n` or `\n` terminators, so character offsets in the masked view map 1:1 to the original source:

```ts
function maskFencedCodeBlocksPreservingLength(text: string): string {
```

The truncated excerpt establishes the offset-preserving behavior; it does not exhaustively document what happens for exotic input such as embedded NULs or mixed line endings beyond `\r\n` and `\n`.

`maskInlineCode` blanks inline spans delimited by a backtick run whose closing run has the same length, following CommonMark:

```ts
export function maskInlineCode(text: string): string {
```

When no matching close is found the backticks are left as literal text — the early-return visible in the excerpt. `maskCodeSpans` composes both:

```ts
export function maskCodeSpans(text: string): string {
  return maskInlineCode(maskFencedCodeBlocks(text));
}

export function maskCodeSpansPreservingLength(text: string): string {
  return maskInlineCode(maskFencedCodeBlocksPreservingLength(text));
}
```

The two unclosed-construct detectors ride on top of those masks. `hasUnclosedFence` runs `consumeFenceLine` across the whole document and returns the final `state.inFence` value:

```ts
export function hasUnclosedFence(text: string): boolean {
  const lines = text.split(/\r?\n/);
  const state = createFenceState();
  for (const line of lines) {
    consumeFenceLine(line, state);
  }
  return state.inFence;
}
```

`hasUnclosedMarkdown` short-circuits on an unclosed fence and otherwise asks `maskInlineCode(maskFencedCodeBlocks(text))` whether any backtick survived — a well-formed document has none:

```ts
export function hasUnclosedMarkdown(text: string): boolean {
  if (hasUnclosedFence(text)) return true;
  return maskInlineCode(maskFencedCodeBlocks(text)).includes("`");
}
```

`unclosedMarkdownDiagnostic` returns a structured value so repair prompts can point at the specific delimiter instead of a generic message:

```ts
export function unclosedMarkdownDiagnostic(
```

The source comment notes the 200-character cap on the excerpt and the truncation marker for delimiter runs longer than the cap. The diagnostic carries the exact delimiter length separately because CommonMark requires the inline-code closer to match the opener exactly; the bounded excerpt shows a visible representative portion only. `boundedExcerpt` is the internal helper that centers the excerpt on the offending delimiter rather than slicing from column 0, which the test suite calls out as the previous bug:

```ts
function boundedExcerpt(
```

## Mermaid validation with a temporary DOM

<!-- lw:anchors packages/core/src/mermaid-validator.ts#validateMermaidSyntax packages/core/src/mermaid-validator.ts#parseWithTemporaryDom packages/core/src/mermaid-validator.ts#restoreGlobal -->

`validateMermaidSyntax` returns a concise error message from Mermaid's parser, or `null` when the diagram parses:

```ts
export function validateMermaidSyntax(source: string): Promise<string | null> {
```

It serializes calls through a module-level queue because Mermaid reads process-wide `window`/`document` globals. The visible implementation chains each new parse onto the previous queue, regardless of whether the prior parse resolved or rejected — a fail-open serialization choice the truncated excerpt confirms but does not exhaustively justify.

`parseWithTemporaryDom` installs the module-level parser DOM as `globalThis.window` and `globalThis.document` for the duration of one parse:

```ts
async function parseWithTemporaryDom(source: string): Promise<string | null> {
```

It captures whether each key existed on `globalThis` and the previous values so that `restoreGlobal` can put the originals back even when those keys did not exist on `globalThis` before. Mermaid itself is loaded lazily on the first parse and `initialize({ startOnLoad: false })` is called once; subsequent parses reuse the same instance. The `finally` block always calls `restoreGlobal`, so a thrown parse error still restores the globals — fail-closed with respect to global pollution, fail-open with respect to the validation result.

`restoreGlobal` keeps an existing key set to its previous value, or deletes it entirely if it did not exist on entry, so validation leaves no trace on `globalThis` regardless of the host environment:

```ts
function restoreGlobal(
  globals: Record<string, unknown>,
  key: string,
  existed: boolean,
  previous: unknown,
): void {
  if (existed) globals[key] = previous;
  else delete globals[key];
}
```

## Module identification, partitioning, and role classification

<!-- lw:anchors packages/core/src/modules.ts#identifyModulesHeuristic packages/core/src/modules.ts#dirToModuleId packages/core/src/modules.ts#normalizeRepoPath packages/core/src/modules.ts#fileStem packages/core/src/modules.ts#stripNodeNextExtension packages/core/src/modules.ts#resolveRelativeImport packages/core/src/modules.ts#resolveModuleEdges packages/core/src/modules.ts#resolveSymbolCount packages/core/src/modules.ts#countSymbols -->

The heuristic grouping is deterministic and LLM-independent. `identifyModulesHeuristic` walks the path list, normalizes each path through `normalizeRepoPath`, groups by directory, derives an id via `dirToModuleId`, sums `symbolCount` from the supplied map (defaulting to zero per file), and sorts the resulting modules by id:

```ts
export function identifyModulesHeuristic(
  filePaths: string[],
  symbolCountByPath: Map<string, number> = new Map(),
): Module[]
```

`dirToModuleId` uses the last directory segment for non-root paths, returns `"root"` for files in the repo root when other directories also exist, and falls back to the file basename (without extension) when the entire repo is a single root file:

```ts
function dirToModuleId(dir: string, paths: string[], totalDirs: number): string {
```

`normalizeRepoPath` and `fileStem` provide the path normalization and basename-extraction primitives the rest of the module pipeline relies on:

```ts
export function normalizeRepoPath(p: string): string {
```

```ts
function fileStem(path: string): string {
```

`resolveRelativeImport` turns a relative import specifier into a normalized path within the known file set, and `stripNodeNextExtension` removes the `.js` suffix that Node-style ESM imports require so resolution can match on the underlying TypeScript file:

```ts
function stripNodeNextExtension(p: string): string {
```

`resolveModuleEdges` and its helpers turn each file's import map into a deduplicated set of `ModuleGraphEdge` objects:

```ts
export function resolveModuleEdges(
```

The visible tests assert three behaviors: relative imports that cross modules produce an edge, absolute or `node_modules` imports produce no edge, and self-loops (imports within the same module) are filtered out. `countSymbols` and `resolveSymbolCount` walk the path-to-symbol-count map to aggregate totals per module:

```ts
function countSymbols(paths: string[], map: Map<string, number>): number {
```

```ts
function resolveSymbolCount(
```

## Unique IDs, title refinement, and uniqueness assertions

<!-- lw:anchors packages/core/src/modules.ts#pathSegmentsFor packages/core/src/modules.ts#slugifySegment packages/core/src/modules.ts#slugifyIdSegment packages/core/src/modules.ts#pathSlugOf packages/core/src/modules.ts#candidateIdSequence packages/core/src/modules.ts#makeUniqueDeterministicIds packages/core/src/modules.ts#assertUniqueModuleIds packages/core/src/modules.ts#DuplicateModuleIdError packages/core/src/modules.ts#DuplicateModuleIdError.constructor packages/core/src/modules.ts#applyRefinedDisplayTitles packages/core/src/modules.ts#normalizeRefinedDisplayTitle packages/core/src/modules.ts#normalizePresentationLabel packages/core/src/modules.test.ts#idFor -->

`pathSegmentsFor`, `slugifySegment`, and `slugifyIdSegment` are the building blocks for the unique-id disambiguation pass:

```ts
function pathSegmentsFor(m: Module): string[] {
```

```ts
function slugifySegment(s: string): string {
```

```ts
function slugifyIdSegment(s: string): string {
```

When two modules share the same leaf (for example, `packages/core/src` and `packages/cli/src` both slug to `src`), `makeUniqueDeterministicIds` expands the slug right-to-left until every id is globally unique:

```ts
export function makeUniqueDeterministicIds(modules: Module[]): Module[] {
```

`pathSlugOf` and `candidateIdSequence` are the helpers that build each candidate id list. `assertUniqueModuleIds` then enforces the invariant and throws `DuplicateModuleIdError` if any duplicate slips through:

```ts
export function assertUniqueModuleIds(modules: Module[]): void {
```

```ts
export class DuplicateModuleIdError extends Error {
```

```ts
constructor(message: string) {
```

The internal helper `idFor` is the test-side adapter used to build expected strings from a `Module`:

```ts
function idFor(mod: { id: string; paths: string[]; symbolCount: number }): string {
```

`applyRefinedDisplayTitles` accepts stage-2 LLM-suggested titles without letting them compromise partition validation:

```ts
export function applyRefinedDisplayTitles(
```

Each candidate is run through `normalizeRefinedDisplayTitle`, which rejects non-strings, overly short or long titles, control characters, titles with no letters, titles that normalize to the module id, and a small generic blacklist:

```ts
function normalizeRefinedDisplayTitle(value: unknown, moduleId: string): string | null {
```

Accepted titles that collide after `normalizePresentationLabel` are dropped to keep titles unique. `normalizePresentationLabel` lowercases, NFKD-strips, slugifies, and trims the value:

```ts
function normalizePresentationLabel(value: string): string {
```

## Splitting oversized modules

<!-- lw:anchors packages/core/src/modules.ts#MODULE_SPLIT_DEFAULTS packages/core/src/modules.ts#SPLIT_AXIS_DISABLED packages/core/src/modules.ts#normalizeSplitLimits packages/core/src/modules.ts#axisEnabled packages/core/src/modules.ts#fitsLimits packages/core/src/modules.ts#splitOneModule packages/core/src/modules.ts#splitOversizedModules packages/core/src/modules.ts#chunkFlatBucket packages/core/src/modules.ts#groupPathsByNextSegment -->

The split pipeline prevents oversized pages from breaking context budgets. `MODULE_SPLIT_DEFAULTS` is the structural, completion-oriented default, and `SPLIT_AXIS_DISABLED` is the sentinel returned by `normalizeSplitLimits` when a caller passes `0` or a negative value for an axis:

```ts
export const MODULE_SPLIT_DEFAULTS = {
```

```ts
export const SPLIT_AXIS_DISABLED = Number.MAX_SAFE_INTEGER;
```

`normalizeSplitLimits` normalizes the two thresholds, treating `undefined` as the default and non-positive values as disabled:

```ts
export function normalizeSplitLimits(
```

`axisEnabled` and `fitsLimits` are the small predicates the splitter uses to decide whether to act on a module:

```ts
function axisEnabled(limit: number): boolean {
```

```ts
function fitsLimits(
```

`splitOversizedModules` walks the input modules and dispatches oversized ones to `splitOneModule`:

```ts
export function splitOversizedModules(
```

```ts
function splitOneModule(
```

`splitOneModule` groups paths by next segment using `groupPathsByNextSegment`, respects a per-bucket `chunkFlatBucket` size cap, and recurses until every resulting module fits or marks itself `unsplittable`. The `unsplittable` flag tells stage 4 to bound the page's context rather than abort the batch:

```ts
function chunkFlatBucket(
```

```ts
function groupPathsByNextSegment(paths: string[]): {
```

## Partition validation and role classification

<!-- lw:anchors packages/core/src/modules.ts#assertExactPathPartition packages/core/src/modules.ts#ExactPartitionError packages/core/src/modules.ts#ExactPartitionError.constructor packages/core/src/modules.ts#refinePeerDirectoryFragmentationError packages/core/src/modules.ts#prioritizeModules packages/core/src/modules.ts#matchesAnyPathPattern packages/core/src/modules.ts#classifyPathRole packages/core/src/modules.ts#classifyModuleRole packages/core/src/modules.ts#DEFAULT_PATH_ROLE_PATTERNS packages/core/src/modules.ts#DEFAULT_FLOW_SIGNAL_PATTERNS -->

`assertExactPathPartition` enforces that the union of every `Module.paths` equals the original path set with no duplicates and no missing files. `ExactPartitionError` is thrown when the invariant breaks:

```ts
export function assertExactPathPartition(
```

```ts
export class ExactPartitionError extends Error {
```

```ts
constructor(message: string) {
```

`refinePeerDirectoryFragmentationError` upgrades the generic fragmentation error into a more actionable message when the cause is two sibling directories both splitting into the same leaf ids:

```ts
export function refinePeerDirectoryFragmentationError(
```

The truncated source does not document the exact message text, so callers should consult the implementation rather than assume wording.

Role classification and prioritization use two configuration constants and one matcher:

```ts
export const DEFAULT_PATH_ROLE_PATTERNS: Required<PathRoleConfig> = {
```

```ts
export const DEFAULT_FLOW_SIGNAL_PATTERNS: Required<FlowSignalConfig> = {
```

`matchesAnyPathPattern` tests a path against the supplied glob patterns:

```ts
export function matchesAnyPathPattern(path: string, patterns: string[]): boolean {
```

`classifyPathRole` returns a role for a single path, and `classifyModuleRole` rolls the path-level roles up into a module role:

```ts
export function classifyPathRole(path: string, config?: PathRoleConfig): PathRole {
```

```ts
export function classifyModuleRole(module: Module, config?: PathRoleConfig): PathRole {
```

`prioritizeModules` orders modules by decreasing indegree, breaking ties by `symbolCount` and then by `id`, with the role-aware upgrade making product modules outrank fixtures even when their raw score is lower:

```ts
export function prioritizeModules(
```

The visible tests confirm that the reorder is in-place and that no module is dropped during prioritization, and that input order does not affect the final ordering because the deterministic tie-breaker is `Module.id&#96;.

## Additional indexed symbols

<!-- lw:anchors packages/core/src/mermaid-validator.ts#parseWithTemporaryDom packages/core/src/mermaid-validator.ts#restoreGlobal packages/core/src/mermaid-validator.ts#validateMermaidSyntax packages/core/src/modules.test.ts#idFor packages/core/src/modules.ts#DEFAULT_FLOW_SIGNAL_PATTERNS packages/core/src/modules.ts#DEFAULT_PATH_ROLE_PATTERNS packages/core/src/modules.ts#DuplicateModuleIdError packages/core/src/modules.ts#DuplicateModuleIdError.constructor packages/core/src/modules.ts#ExactPartitionError packages/core/src/modules.ts#ExactPartitionError.constructor packages/core/src/modules.ts#MODULE_SPLIT_DEFAULTS packages/core/src/modules.ts#SPLIT_AXIS_DISABLED packages/core/src/modules.ts#applyRefinedDisplayTitles packages/core/src/modules.ts#assertExactPathPartition packages/core/src/modules.ts#assertUniqueModuleIds packages/core/src/modules.ts#axisEnabled packages/core/src/modules.ts#candidateIdSequence packages/core/src/modules.ts#chunkFlatBucket packages/core/src/modules.ts#classifyModuleRole packages/core/src/modules.ts#classifyPathRole packages/core/src/modules.ts#countSymbols packages/core/src/modules.ts#dirToModuleId packages/core/src/modules.ts#fileStem packages/core/src/modules.ts#fitsLimits packages/core/src/modules.ts#groupPathsByNextSegment packages/core/src/modules.ts#identifyModulesHeuristic packages/core/src/modules.ts#makeUniqueDeterministicIds packages/core/src/modules.ts#matchesAnyPathPattern packages/core/src/modules.ts#normalizePresentationLabel packages/core/src/modules.ts#normalizeRefinedDisplayTitle packages/core/src/modules.ts#normalizeRepoPath packages/core/src/modules.ts#normalizeSplitLimits packages/core/src/modules.ts#pathSegmentsFor packages/core/src/modules.ts#pathSlugOf packages/core/src/modules.ts#prioritizeModules packages/core/src/modules.ts#refinePeerDirectoryFragmentationError packages/core/src/modules.ts#resolveModuleEdges packages/core/src/modules.ts#resolveRelativeImport packages/core/src/modules.ts#resolveSymbolCount packages/core/src/modules.ts#slugifyIdSegment packages/core/src/modules.ts#slugifySegment packages/core/src/modules.ts#splitOneModule packages/core/src/modules.ts#splitOversizedModules packages/core/src/modules.ts#stripNodeNextExtension -->

These anchors identify indexed symbols in this module that were not assigned to an earlier generated section.

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
- Flow: [CLI bootstrap to wiki export (cli-src to core-src-04)](flows/cli-src-to-core-src-04.md)
- [Batch orchestration, config, index DB, and diagram generators](core-src-03.md) — dependency and dependent
- [Core prompt, I/O allowlist, symbol extraction, status and topic planning](core-src-08.md) — dependency and dependent
- [Wiki export, flow detection, and parser helpers](core-src-04.md) — dependency and dependent
<!-- livewiki:navigate:end -->
