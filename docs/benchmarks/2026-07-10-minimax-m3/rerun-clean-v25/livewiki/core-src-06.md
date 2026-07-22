---
title: Core module identification, manifest IO, and Markdown masking
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

# Core module identification, manifest IO, and Markdown masking

The `packages/core/src` slice of the livewiki package owns the deterministic building blocks that turn a repo walk into navigable wiki pages: the persisted `.manifest.json` handoff, the Markdown code/construct masking utilities shared by structural scanners, the Mermaid syntax validator, and the module-identification heuristic (grouping, role classification, deduplication, oversized-module splitting).

## When to use this page

- **Diagnose** why `computeSnapshotHash` and `writeManifestIfChanged` keep `git diff` clean across re-runs in CI.
- **Audit** how `identifyModulesHeuristic` groups paths and how `splitOversizedModules`, `assertUniqueModuleIds`, and `assertExactPathPartition` keep IDs and partitions sound.
- **Inspect** the Markdown masking state machine (`createFenceState`, `consumeFenceLine`, `maskInlineCode`) used to detect truncated pages.
- **Trace** `validateMermaidSyntax` when a generated diagram fails verification under the serialized `window`/`document` swap.

## How it fits

This module sits inside `packages/core/src` and supplies the deterministic data that later pipeline stages (display-title refinement, presentation loading, navigation, and page generation in `navigation.ts` and `diagrams.ts`) consume. The manifest file (`livewiki/.manifest.json`) is the cross-machine handoff state for batch runs; the masking helpers are reused by `verify.ts`, `artifact.ts`, and `anchors.ts` so Markdown code constructs stay inert to structural scans. The Mermaid validator piggybacks on Mermaid's real parser under a temporary `JSDOM`. The module-identification path combines a path-based heuristic with import-graph edge resolution, role classification, ID deduplication, and size-driven splitting so each produced wiki page corresponds to one and only one set of repo paths.

## Manifest IO and write-test helper

<!-- lw:anchors packages/core/src/manifest.test.ts#writeLivewikiFile packages/core/src/manifest.ts#MANIFEST_REL_PATH packages/core/src/manifest.ts#MANIFEST_VERSION packages/core/src/manifest.ts#readManifest packages/core/src/manifest.ts#computeSnapshotHash packages/core/src/manifest.ts#listFiles packages/core/src/manifest.ts#writeManifestIfChanged packages/core/src/manifest.ts#manifestsEqual packages/core/src/manifest.ts#pendingBatchEqual packages/core/src/manifest.ts#buildManifest -->

`MANIFEST_VERSION` is the schema version (currently 1); `MANIFEST_REL_PATH` fixes the location as `livewiki/.manifest.json`.

```ts
export const MANIFEST_VERSION = 1;
export const MANIFEST_REL_PATH = "livewiki/.manifest.json";
```

`readManifest` (`export async function readManifest(repoRoot: string): Promise<LivewikiManifest | null>`) tolerates corruption: when the file is missing or unparseable, it falls into a `try/catch` and returns `null` instead of throwing, and also checks that the parsed `version` and `snapshotHash` are shaped correctly before accepting it.

`computeSnapshotHash` walks the `livewiki/` tree, excludes the manifest itself, sorts the remaining relative paths, and combines per-file SHA-256 digests; `listFiles` (`async function listFiles(dir: string): Promise<string[]>`) is an iterative DFS via an explicit stack, with `readdir` failures swallowed via `try { ... } catch { continue }` so an unreadable subdirectory is silently skipped rather than aborting the hash.

```ts
export async function writeManifestIfChanged(
```

That signature is truncated in the visible source; the function reads the current manifest with `readManifest`, delegates the byte-equality test to `manifestsEqual`/`pendingBatchEqual` (intentionally ignoring `updatedAt`, which is a timestamp, so re-runs don't keep mutating the file), and only when the content actually differs does it `JSON.stringify(..., null, 2) + "\n"` and write via `safeIo.writeText`, returning `true`. When content matches, it returns `false`. The truncated excerpt does not establish exhaustive behaviour beyond the visible body.

The test helper used by `manifest.test.ts`:

```ts
async function writeLivewikiFile(relPath: string, content: string): Promise<void> {
```

It `mkdir -p`s the parent directory under the per-test temp `repoRoot` and then writes the file in one step. The visible source for the body is truncated past the signature; the tests rely on it being an idempotent, deterministic under-temp-dir writer that pairs with the `beforeEach`/`afterEach` mkdtemp/rm lifecycle.

`manifestsEqual` compares `version`, `snapshotHash`, `lastDocumentedCommit`, and the structured `pendingBatch` (via `pendingBatchEqual`), while `pendingBatchEqual` deep-compares `runId`, `stage`, `done`, and `total` and short-circuits on null pairs. `buildManifest` constructs the typed object with `version: MANIFEST_VERSION` and `updatedAt: new Date().toISOString()` from a `lastDocumentedCommit`, `snapshotHash`, and optional `pendingBatch`.

## Markdown masking: fences, inline spans, and length-preserving output

<!-- lw:anchors packages/core/src/markdown-mask.ts#createFenceState packages/core/src/markdown-mask.ts#consumeFenceLine packages/core/src/markdown-mask.ts#maskFencedCodeBlocks packages/core/src/markdown-mask.ts#maskFencedCodeBlocksPreservingLength packages/core/src/markdown-mask.ts#maskInlineCode packages/core/src/markdown-mask.ts#maskCodeSpans packages/core/src/markdown-mask.ts#maskCodeSpansPreservingLength packages/core/src/markdown-mask.ts#hasUnclosedFence packages/core/src/markdown-mask.ts#hasUnclosedMarkdown -->

The fence state machine is a simple record plus a regex:

```ts
function consumeFenceLine(line: string, state: FenceState): boolean {
```

`createFenceState()` returns `{ inFence: false, fenceChar: "", fenceLen: 0 }`. `consumeFenceLine` either opens a fence on the matched `` ` `` / `~` run (caching character + length) or, while already inside, tests a dynamic `closeRe` built from the opener, returning `true` for any line that belongs to the fence (including opener and closer). `maskFencedCodeBlocks` splits on `/\r?\n/`, replacing every consumed line with `""`, and rejoins with `"\n"`; the comment in source explicitly calls out that a lone `"\n"` split would leave a trailing `"\r"` on CRLF lines and break the closing-fence match — the split regex deliberately avoids that.

`maskFencedCodeBlocksPreservingLength` keeps `"\r\n"` boundaries intact: it walks `text` char-by-char, slices each line by the (optional) leading `"\r"`, and emits `" ".repeat(line.length)` for masked lines, re-attaching the exact terminator (`"\r\n"` or `"\n"`). `maskInlineCode` implements CommonMark's exact-length backtick matching: it scans backtick runs, then linearly searches for a closing run of the same length; on a match it replaces the span with spaces (length preserved), otherwise it leaves the unmatched run literal so `hasUnclosedMarkdown` can flag it. The visible source truncates the closing branch (`closeStart === -1`) past the explanatory comment, but the no-match path returns the literal slice.

```ts
export function maskCodeSpans(text: string): string {
```

returns `maskInlineCode(maskFencedCodeBlocks(text))`. `maskCodeSpansPreservingLength` chains the length-preserving fence masker then the same `maskInlineCode` so every character inside any code construct maps to the same source index. `hasUnclosedFence` returns `true` when the fence state machine is still open at end-of-text; `hasUnclosedMarkdown` first checks for an unclosed fence, then runs the collapsing mask and checks for any surviving backtick in the output (objective truncation signal — not a length heuristic).

## Markdown masking: diagnostics and bounded excerpts

<!-- lw:anchors packages/core/src/markdown-mask.ts#unclosedMarkdownDiagnostic packages/core/src/markdown-mask.ts#boundedExcerpt -->

`unclosedMarkdownDiagnostic` is the structured payload the validator hands back to a repair prompt. The visible `UnclosedMarkdownDiagnostic` interface is truncated in the source, so the prose below sticks to facts visible in the comments and test names rather than inventing field shapes.

```ts
function boundedExcerpt(
```

The signature is truncated in the source; the surrounding test cases show the contract: produce a `kind` of `"fence"` or `"inline-code"`, a 1-based `lineNumber`, a capped `offending` excerpt that includes left/right truncation markers (`…`) and that *contains* the offending delimiter for delimiter runs that fit within the cap, plus an exact `delimiterLength` (e.g. 198, 260, or 5) carried separately so the repair model can emit the correct closing run when the excerpt can't show the whole run. For fence diagnostics the opening delimiter is the offender; for inline-code it's the unmatched backtick run. The tests assert that a 500-char prefix with an `oops` backtick still places a backtick inside `offending`, and that fence diagnostics preserve the opening triple-backtick (or `~~`) verbatim.

## Mermaid syntax validator under a temporary DOM

<!-- lw:anchors packages/core/src/mermaid-validator.ts#parseWithTemporaryDom packages/core/src/mermaid-validator.ts#restoreGlobal packages/core/src/mermaid-validator.ts#validateMermaidSyntax -->

```ts
export function validateMermaidSyntax(source: string): Promise<string | null> {
```

returns the result of `validationQueue.then(...)` (with both resolve and reject arms chaining through `parseWithTemporaryDom`) so concurrent calls are serialized — Mermaid mutates process-global `window`/`document`, so parallel calls would race. `parseWithTemporaryDom` snapshots the current `window`/`document` (recording `hadWindow`/`hadDocument` booleans and the previous values), assigns the module-level `parserDom.window` and `.document` to those globals, lazily `import("mermaid")` and `.initialize({ startOnLoad: false })` once into `mermaidInstance`, awaits `mermaidInstance.parse(source)`, and returns `null` on success or `error.message`/`String(error)` on failure. A `finally` block restores the snapshot via `restoreGlobal(globals, key, existed, previous)`, which re-assigns when the key previously existed or `delete globals[key]` otherwise — so an environment that never had `window` is left without one.

```ts
function restoreGlobal(
```

The signature is truncated in the visible source; the call sites show the four arguments described above.

## Module identification heuristic and ID derivation

<!-- lw:anchors packages/core/src/modules.ts#normalizeRepoPath packages/core/src/modules.ts#countSymbols packages/core/src/modules.ts#dirToModuleId packages/core/src/modules.ts#identifyModulesHeuristic packages/core/src/modules.ts#groupPathsByNextSegment packages/core/src/modules.test.ts#idFor packages/core/src/modules.ts#resolveModuleEdges packages/core/src/modules.ts#resolveRelativeImport packages/core/src/modules.ts#stripNodeNextExtension -->

```ts
export function identifyModulesHeuristic(
```

Signature truncated in the visible source; tests import it as `identifyModulesHeuristic(filePaths, symbolCountByPath?)`. It normalizes each path with `normalizeRepoPath` (`export function normalizeRepoPath(p: string): string`; visible signature, body truncated), buckets by the path's directory (the slice before the last `/`; `""` for root-level files), sums symbol counts via `countSymbols` (`function countSymbols(paths: string[], map: Map<string, number>): number`), derives a slug via `dirToModuleId` (`function dirToModuleId(dir: string, paths: string[], totalDirs: number): string`), and finally sorts modules by `id` with `localeCompare` for deterministic output. `dirToModuleId` returns the basename-without-extension when there is exactly one file in exactly one directory (root specialization), `"root"` when there are mixed root-level and nested files, and otherwise the last segment of the directory.

`groupPathsByNextSegment` (`function groupPathsByNextSegment(paths: string[]): { ... }`) groups adjacent paths by their next path segment — the exact return shape is not visible in the excerpt, but it underpins the iterative split logic.

The test helper `idFor(mod)` (`function idFor(mod: { id: string; paths: string[]; symbolCount: number }): string`) is presumably what tests use to compose a stable id from a module record; the body is not visible.

Edges between modules are produced by `resolveModuleEdges` (`export function resolveModuleEdges(...)`) and `resolveRelativeImport` (`export function resolveRelativeImport(...)`). Tests show it consumes `importsByFile: Map<string, ExtractedImport[]>` plus a `knownFiles` set, walks each import's `source`, only treats relative paths as candidates, and calls `stripNodeNextExtension` (`function stripNodeNextExtension(p: string): string`) to drop `.js`/`.mjs` suffixes that node-next emits for `.ts` sources; absolute imports and `node_modules` specifiers are skipped. The function dedupes parallel duplicates and drops self-loops (same module on both ends), returning `{ from, to }` pairs ordered stably.

## Module identity, deduplication, and partition assertion

<!-- lw:anchors packages/core/src/modules.ts#makeUniqueDeterministicIds packages/core/src/modules.ts#pathSlugOf packages/core/src/modules.ts#candidateIdSequence packages/core/src/modules.ts#pathSegmentsFor packages/core/src/modules.ts#slugifyIdSegment packages/core/src/modules.ts#slugifySegment packages/core/src/modules.ts#fileStem packages/core/src/modules.ts#assertUniqueModuleIds packages/core/src/modules.ts#DuplicateModuleIdError packages/core/src/modules.ts#DuplicateModuleIdError.constructor packages/core/src/modules.ts#assertExactPathPartition packages/core/src/modules.ts#ExactPartitionError packages/core/src/modules.ts#ExactPartitionError.constructor packages/core/src/modules.ts#refinePeerDirectoryFragmentationError -->

`makeUniqueDeterministicIds` (`export function makeUniqueDeterministicIds(modules: Module[]): Module[]`) takes the heuristic output and assigns globally unique slugs. The implementation pulls a candidate sequence per module from `pathSlugOf` (`function pathSlugOf(m: Module): string`) via `candidateIdSequence` (`function candidateIdSequence(m: Module): string[]`), which expands `pathSegmentsFor(m)` (`function pathSegmentsFor(m: Module): string[]`) into slugged variants, slugged with `slugifySegment` (`function slugifySegment(s: string): string`) / `slugifyIdSegment` (`function slugifyIdSegment(s: string): string`), then walks the candidates and falls back to disambiguated forms when a slug collides with an existing module's path slug. `fileStem` (`function fileStem(path: string): string`) supplies the basename-without-extension used at the leaf of these expansions.

`assertUniqueModuleIds` (`export function assertUniqueModuleIds(modules: Module[]): void`) is the defensive check that runs before stage 4 of the batch; on duplicate ids it throws `DuplicateModuleIdError`:

```ts
export class DuplicateModuleIdError extends Error {
```

with a `constructor(message: string)`. The visible source truncates the class body past the constructor signature.

`assertExactPathPartition` (`export function assertExactPathPartition(...)`) verifies that the union of `modules[*].paths` exactly equals the input file set with no overlap and no missing files; on mismatch it throws `ExactPartitionError` (`export class ExactPartitionError extends Error` with `constructor(message: string)` — bodies truncated). `refinePeerDirectoryFragmentationError` (`export function refinePeerDirectoryFragmentationError(...)`) rewrites a generic partition failure into a peer-directory-aware message that names the competing directories; signature visible, body truncated.

## Module role classification and prioritization

<!-- lw:anchors packages/core/src/modules.ts#DEFAULT_PATH_ROLE_PATTERNS packages/core/src/modules.ts#DEFAULT_FLOW_SIGNAL_PATTERNS packages/core/src/modules.ts#matchesAnyPathPattern packages/core/src/modules.ts#classifyPathRole packages/core/src/modules.ts#classifyModuleRole packages/core/src/modules.ts#prioritizeModules -->

`DEFAULT_PATH_ROLE_PATTERNS` and `DEFAULT_FLOW_SIGNAL_PATTERNS` are the built-in glob shapes:

```ts
export const DEFAULT_PATH_ROLE_PATTERNS: Required<PathRoleConfig> = {
export const DEFAULT_FLOW_SIGNAL_PATTERNS: Required<FlowSignalConfig> = {
```

Both shapes (per the table) are objects with required fields; the visible source shows their declarations but the literals are truncated past the opening brace, so prose here sticks to the exported shape rather than the field values.

`matchesAnyPathPattern` (`export function matchesAnyPathPattern(path: string, patterns: string[]): boolean`) is the matching primitive — visible signature, body truncated. `classifyPathRole` (`export function classifyPathRole(path: string, config?: PathRoleConfig): PathRole`) maps a single file path to a role via the configured patterns (or the defaults). `classifyModuleRole` (`export function classifyModuleRole(module: Module, config?: PathRoleConfig): PathRole`) reduces over the module's paths, classifying the module as a whole based on its constituents — the tests assert that `test/fixtures/**` is `fixture`, and the ranking step promotes product modules over fixtures even when the fixture has a much higher `symbolCount`.

`prioritizeModules` (`export function prioritizeModules(...)`) computes `indegree` from `ModuleGraphEdge` arrays, sorts by centrality descending, ties on `symbolCount`, then breaks ties deterministically by `Module.id` (the test exercises both an in-order and a reversed input and asserts identical output). The role-aware rank reorders without dropping modules (length and id set are invariants per the tests).

## Oversized-module splitting

<!-- lw:anchors packages/core/src/modules.ts#MODULE_SPLIT_DEFAULTS packages/core/src/modules.ts#SPLIT_AXIS_DISABLED packages/core/src/modules.ts#normalizeSplitLimits packages/core/src/modules.ts#axisEnabled packages/core/src/modules.ts#fitsLimits packages/core/src/modules.ts#resolveSymbolCount packages/core/src/modules.ts#splitOversizedModules packages/core/src/modules.ts#splitOneModule packages/core/src/modules.ts#chunkFlatBucket -->

```ts
export const MODULE_SPLIT_DEFAULTS = {
export const SPLIT_AXIS_DISABLED = Number.MAX_SAFE_INTEGER;
```

`MODULE_SPLIT_DEFAULTS` declares `maxFiles: 12` and `maxSymbols: 80`; the visible source truncates the object literal at the opening brace, so only the field names from the column comment are authoritative. `SPLIT_AXIS_DISABLED` is the sentinel value used when a size axis is turned off.

`normalizeSplitLimits` (`export function normalizeSplitLimits(maxFiles?: number, maxSymbols?: number): { maxFiles: number; maxSymbols: number }`) treats `undefined` as "use defaults" and `0` or negative as "disable this axis" (replaced with `SPLIT_AXIS_DISABLED`). `axisEnabled` (`function axisEnabled(limit: number): boolean`) gates the splitter on `limit !== SPLIT_AXIS_DISABLED`. `fitsLimits` (`function fitsLimits(...)`) and `resolveSymbolCount` (`function resolveSymbolCount(...)`) decide whether a candidate split passes both axes (visible signatures, bodies truncated).

`splitOneModule` (`function splitOneModule(...)`) and `chunkFlatBucket` (`function chunkFlatBucket(...)`) execute a single split; `chunkFlatBucket` walks the module's paths and emits sub-buckets aligned to the configured caps. `splitOversizedModules` (`export function splitOversizedModules(...)`) is the public entry point. The visible source truncates the orchestration body past the imports — but the configuration pipeline above (`normalizeSplitLimits` → `axisEnabled` → `fitsLimits` → `splitOneModule`/`chunkFlatBucket`) is fully defined, and the result is a list of modules where each one satisfies both size caps unless it carries `unsplittable: true` (a single oversized file that cannot be path-split further; downstream stages still schedule it and cap context at write time).

## Refined display titles

<!-- lw:anchors packages/core/src/modules.ts#applyRefinedDisplayTitles packages/core/src/modules.ts#normalizeRefinedDisplayTitle packages/core/src/modules.ts#normalizePresentationLabel -->

`applyRefinedDisplayTitles` (`export function applyRefinedDisplayTitles(...)`) accepts stage-2 LLM-suggested titles as advisory only: it never lets a candidate alter partition validation or identity. For each module it looks up the candidate by `module.id`, passes the value through `normalizeRefinedDisplayTitle(value: unknown, moduleId: string): string | null`, and keeps the normalized title only when it survives the validity checks (length 4–120, no control chars, contains at least one letter, not equal to `moduleId` after `normalizePresentationLabel`, and not one of the generic names `"module"`, `"source"`, `"code"`, `"repository-module"`).

```ts
function normalizeRefinedDisplayTitle(value: unknown, moduleId: string): string | null {
function normalizePresentationLabel(value: string): string {
```

Both bodies are truncated past the signatures, but the validity rules named above are visible in source comments. After per-module acceptance, `applyRefinedDisplayTitles` groups accepted titles by `normalizePresentationLabel(...)` and, when two modules end up with the same normalized label, drops *both* (preventing an "honest" title from duplicating across pages). Finally it returns a new module array with `displayTitle` set only when the candidate was accepted and unique.

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
- Flow: [cli-src → core-src-04 — export marker contract for stage-5 flows](flows/cli-src-to-core-src-04.md)
- [Batch orchestration, config, index schema, and deterministic diagrams](core-src-03.md) — dependency and dependent
- [Core source — prompts, safe I/O, status, symbols, topics](core-src-08.md) — dependency and dependent
- [Export, frontmatter, flows, and hashing primitives](core-src-04.md) — dependency and dependent
<!-- livewiki:navigate:end -->
