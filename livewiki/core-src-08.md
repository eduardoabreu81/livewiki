---
title: Core module identification, manifest I/O, and Markdown mask helpers
owner: generated
anchors:
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

# Core module identification, manifest I/O, and Markdown mask helpers

This page documents the core package's responsibilities for batch-stage 2 module identification and partitioning, the cross-machine manifest ledger under `livewiki/`, the deterministic Markdown code mask used by structural scans, and the Mermaid syntax validator that runs against parsed diagrams.

## When to use this page

- **Read the manifest layout** when wiring the pipeline's cross-machine handoff: `MANIFEST_VERSION`, `MANIFEST_REL_PATH`, `readManifest`, `writeManifestIfChanged`, and `computeSnapshotHash` together gate the idempotent write that keeps `git diff` clean in CI.
- **Debug structural-scan regressions** when an artifact validator claims it ran out of links inside code, by tracing `maskCodeSpans`, `maskFencedCodeBlocks`, `maskInlineCode`, and the `hasUnclosedMarkdown` signal that catches token-limit truncation.
- **Reason about module partitioning** when a heuristic runs into oversize or peer-directory fragmentation: `identifyModulesHeuristic`, `splitOversizedModules`, `assertExactPathPartition`, `assertUniqueModuleIds`, and the `DuplicateModuleIdError` and `ExactPartitionError` types explain the contracts the rest of the pipeline assumes.

## How it fits

The seven files in this module sit in `packages/core/src/` and form a tightly coupled cluster of helpers that other core modules consume. `manifest.ts` owns the on-disk ledger that every other stage reads at start-up to decide whether the prior run already documented the current commit. `modules.ts` produces the deterministic partition that downstream stages walk when generating per-module pages; its exports are the public surface other core modules import. `markdown-mask.ts` is shared infrastructure: per the file-level docstring, it is consumed by `verify.ts`, `artifact.ts`, and `anchors.ts` so structural scans do not drift. `mermaid-validator.ts` exposes a single validator that installs a temporary `window` and `document` around `mermaid.parse` so the rest of the process is unaffected. The two test files (`modules.test.ts`, `markdown-mask.test.ts`) pin down behavior for the heuristics and the mask respectively, and `navigation.test.ts` exercises helper functions from sibling modules but lives here for the consolidated test run.

## Manifest constants and on-disk layout

<!-- lw:anchors packages/core/src/manifest.ts#MANIFEST_REL_PATH packages/core/src/manifest.ts#MANIFEST_VERSION packages/core/src/manifest.ts#buildManifest packages/core/src/manifest.ts#computeSnapshotHash packages/core/src/manifest.ts#listFiles packages/core/src/manifest.ts#manifestsEqual packages/core/src/manifest.ts#pendingBatchEqual packages/core/src/manifest.ts#readManifest packages/core/src/manifest.ts#writeManifestIfChanged -->

The manifest lives under `livewiki/` and is the only file cross-machine handoff reads on resume. Two exported constants pin the schema and the relative path:

```ts
export const MANIFEST_VERSION = 1;
export const MANIFEST_REL_PATH = "livewiki/.manifest.json";
```

```ts
export async function readManifest(repoRoot: string): Promise<LivewikiManifest | null>
```

`readManifest` tolerates a missing or corrupted file: it returns `null` instead of throwing, swallowing both the existence probe failure and the JSON parse failure. The shape is guarded with two field-type checks (`version: number`, `snapshotHash: string`); a manifest with a missing or wrong-typed field also collapses to `null`. Per the docstring, this is intentional for CI friendliness.

```ts
export async function computeSnapshotHash(repoRoot: string): Promise<string>
```

`computeSnapshotHash` walks `livewiki/` recursively (excluding the manifest itself), sorts the resulting paths alphabetically so the hash is deterministic across machines, and combines each entry as `relpath\n<sha256(content)>\n` before hashing the joined buffer. The sort step exists because `nodeFs.readdir` does not guarantee an order on its own. The manifest filename is stripped by checking the suffix of `MANIFEST_REL_PATH.split("/").pop()`, so the manifest is never part of its own hash.

```ts
async function listFiles(dir: string): Promise<string[]>
```

`listFiles` is the iterative directory walker behind `computeSnapshotHash`: it pushes directories onto a stack, and per-directory `readdir` failures are swallowed (`try { entries = ... } catch { continue }`), so a transient unreadable subtree does not break hashing. Each file path is normalized to forward-slashes so the manifest stays portable.

```ts
export async function writeManifestIfChanged(
  repoRoot: string,
  manifest: LivewikiManifest,
): Promise<boolean>
```

`writeManifestIfChanged` is the idempotent gate: it returns `false` without writing when the current manifest compares equal to the candidate via `manifestsEqual`, and returns `true` after a successful `safeIo.writeText`. The JSON is written with a trailing newline. The `safe-io` wrapper constrains the write to the allowlisted `livewiki/` tree.

```ts
function manifestsEqual(a: LivewikiManifest, b: LivewikiManifest): boolean
```

`manifestsEqual` is the equality test used by `writeManifestIfChanged`. It deliberately ignores `updatedAt`; otherwise every run would mint a fresh timestamp and force a rewrite, defeating the CI anti-loop. The `pendingBatch` sub-record is delegated to `pendingBatchEqual`.

```ts
function pendingBatchEqual(a: PendingBatchRef | null, b: PendingBatchRef | null): boolean
```

`pendingBatchEqual` does a structural equality on the four `PendingBatchRef` fields (`runId`, `stage`, `done`, `total`); both-null collapses to true, mixed-null collapses to false.

```ts
export function buildManifest(args: {
  lastDocumentedCommit: string | null;
  snapshotHash: string;
  pendingBatch: PendingBatchRef | null;
}): LivewikiManifest
```

`buildManifest` is the pure factory the pipeline calls once it has computed `snapshotHash` and looked up the last documented commit. It stamps `version: MANIFEST_VERSION` and `updatedAt: new Date().toISOString()` for the caller. As noted above, `updatedAt` is a timestamp and is excluded from the idempotency comparison.

## Markdown code mask: combining and length-preserving entry points

<!-- lw:anchors packages/core/src/markdown-mask.ts#maskCodeSpans packages/core/src/markdown-mask.ts#maskCodeSpansPreservingLength packages/core/src/markdown-mask.ts#maskFencedCodeBlocks packages/core/src/markdown-mask.ts#maskFencedCodeBlocksPreservingLength packages/core/src/markdown-mask.ts#maskInlineCode packages/core/src/markdown-mask.ts#createFenceState packages/core/src/markdown-mask.ts#consumeFenceLine -->

The mask has two public entry points and one common backend pair (fenced-blocks and inline-code). The structural tests in `markdown-mask.test.ts` assert that the length-preserving variant keeps CRLF offsets intact and that the collapsing variant preserves the existing collapsing behaviour.

```ts
export function maskCodeSpans(text: string): string
```

`maskCodeSpans` is the combined mask: fenced blocks are blanked first, then inline code spans. Per the inline docstring, the order matters because inline-code scanning inside an already-blanked fenced block yields no spans, so the two scans do not double-process.

```ts
export function maskFencedCodeBlocks(text: string): string
```

`maskFencedCodeBlocks` blanks the opening line, content, and closing line of each fenced block. The implementation splits on `/\r?\n/` so a CRLF terminator's `\r` stays attached to the line; the docstring calls this out explicitly because a lone split would leave a trailing carriage return that breaks the closing-fence match on CRLF files and leaves the fence open for the rest of the page. The state machine is shared with `hasUnclosedFence` (see below).

```ts
export function maskCodeSpansPreservingLength(text: string): string
```

`maskCodeSpansPreservingLength` is the length-stable variant: every character inside code becomes a space, so the index of any non-code character in the output equals its index in the input. The test that keeps source length and real-content offsets stable confirms that a marker placed after the fence keeps its absolute position through the mask, which is what lets downstream marker extractors trust line and column offsets.

```ts
function maskFencedCodeBlocksPreservingLength(text: string): string
```

`maskFencedCodeBlocksPreservingLength` walks the text with a manual `lineStart` cursor instead of splitting on newline, so a CRLF pair becomes a single `\r\n` appended after the per-line blank-or-passthrough. The trailing slice after the last newline is fed through the same `consumeFenceLine` so an unclosed fence at end-of-file still blanks the remainder. The state object is shared with the collapsing variant (see `createFenceState` below).

```ts
export function maskInlineCode(text: string): string
```

`maskInlineCode` blanks inline code spans delimited by N backticks (N greater than or equal to one), applying the CommonMark rule that the closing run must have the same length as the opening one. The implementation scans a backtick run, then searches forward for a run of the same length; if none is found, the original backtick run is kept literal in the output. The inline docstring explicitly notes that this fallback is what `hasUnclosedMarkdown` uses to detect truncation mid code-span; surviving backticks after masking are the deterministic signal.

```ts
function createFenceState(): FenceState
```

`createFenceState` is the factory for the shared fence state object `{ inFence, fenceChar, fenceLen }`. Both `maskFencedCodeBlocks`, `maskFencedCodeBlocksPreservingLength`, and `hasUnclosedFence` allocate fresh state through it.

```ts
function consumeFenceLine(line: string, state: FenceState): boolean
```

`consumeFenceLine` advances the state machine for one line and returns `true` when the whole line belongs to a fenced block, including the opening and closing fence lines themselves. While open, the closing regex is rebuilt with the matching run lengthening at least as long as the opener. The opener regex allows up to three leading spaces or tabs.

## Markdown code mask: unclosed detection and bounded diagnostic

<!-- lw:anchors packages/core/src/markdown-mask.ts#hasUnclosedFence packages/core/src/markdown-mask.ts#hasUnclosedMarkdown packages/core/src/markdown-mask.ts#unclosedMarkdownDiagnostic packages/core/src/markdown-mask.ts#boundedExcerpt -->

The unclosed-Markdown signal is the deterministic truncation check: a well-formed document has zero backticks surviving `maskInlineCode` and zero fences left open after `hasUnclosedFence`. Per the inline docstring on `hasUnclosedMarkdown`, this is intentionally not a length heuristic; it is a structural property of the masked text.

```ts
export function hasUnclosedFence(text: string): boolean
```

`hasUnclosedFence` runs the line scanner with a fresh state and returns the `inFence` flag at the end. As the docstring notes, returning `true` means the scan ended still inside a fence, which is the unambiguous mid-fence truncation case.

```ts
export function hasUnclosedMarkdown(text: string): boolean
```

`hasUnclosedMarkdown` short-circuits on `hasUnclosedFence`, and otherwise runs the collapsing `maskFencedCodeBlocks` followed by `maskInlineCode` and checks whether any backtick survives in the result. A surviving backtick after both masks means an inline code span opened but never closed.

```ts
export function unclosedMarkdownDiagnostic(
  text: string,
): UnclosedMarkdownDiagnostic | null
```

`unclosedMarkdownDiagnostic` is the structured form of the same check. Its `UnclosedMarkdownDiagnostic` shape carries `kind` (`"fence"` or `"inline-code"`), `lineNumber`, a bounded `offending` excerpt, and the exact `delimiterLength` of the unmatched run. The `boundedExcerpt` helper (documented next) ensures a runaway long line cannot inflate the repair prompt: the excerpt is capped, and when the delimiter run is longer than the cap the visible portion is only representative; the exact length travels in `delimiterLength` instead. The diagnostic returns `null` when the body is well-formed.

```ts
function boundedExcerpt(line: string, cap: number): { ... }
```

`boundedExcerpt` centers the excerpt on the offending delimiter and adds left and right truncation markers when both ends are clipped. The test cases for unmatched backtick runs after column 500 and for a 198-backtick run with content on both sides pin the behavior: previously the helper returned a simple prefix and dropped the delimiter for backtick runs after column 200; the fix centers on the delimiter and reports the exact run length in a separate field.

## Module identification heuristic and role classification

<!-- lw:anchors packages/core/src/modules.ts#identifyModulesHeuristic packages/core/src/modules.ts#dirToModuleId packages/core/src/modules.ts#normalizeRepoPath packages/core/src/modules.ts#prioritizeModules packages/core/src/modules.ts#matchesAnyPathPattern packages/core/src/modules.ts#classifyPathRole packages/core/src/modules.ts#classifyModuleRole packages/core/src/modules.ts#DEFAULT_PATH_ROLE_PATTERNS packages/core/src/modules.ts#DEFAULT_FLOW_SIGNAL_PATTERNS -->

The deterministic heuristic groups files by top-level directory and assigns each group an id. The same directory layout is used by both the heuristic and the role classifier; `DEFAULT_PATH_ROLE_PATTERNS` and `DEFAULT_FLOW_SIGNAL_PATTERNS` are the default regex sets that label each path as `product`, `fixture`, `tooling`, `docs`, `benchmark`, or `flow`.

```ts
export function identifyModulesHeuristic(
  filePaths: string[],
  symbolCountByPath: Map<string, number> = new Map(),
): Module[]
```

`identifyModulesHeuristic` walks the file list, normalizes each path with `normalizeRepoPath`, buckets by directory (empty string for root files), and reduces the bucket to a `Module` with id from `dirToModuleId`, `paths` for the files, and `symbolCount` summed from the optional `symbolCountByPath` map. The output is sorted by id for deterministic output. Root handling lives in `dirToModuleId`: a single-file repo at the root uses the basename without extension; a multi-file root collapses to id `"root"`. Per the `modules.test.ts` cases, the heuristic also tags the `symbolCount` field per module and is used to exercise the prioritization order.

```ts
function dirToModuleId(dir: string, paths: string[], totalDirs: number): string
```

`dirToModuleId` is the id assignment. The non-root branch returns the last `/`-segment of the directory; the root branch picks between basename (only-file-in-repo) and the literal `"root"`. The third argument `totalDirs` is what disambiguates the two root cases.

```ts
export function normalizeRepoPath(p: string): string
```

`normalizeRepoPath` is the path-normalization helper used by the heuristic and the edge resolver. It collapses backslashes to forward slashes and removes any leading `./` so downstream segment math does not have to defend against either shape.

```ts
export function prioritizeModules(
  modules: Module[],
  edges: ModuleGraphEdge[],
): Module[]
```

`prioritizeModules` orders the modules for stage 4. The tests pin three rules: modules with higher in-degree centrality come first; when centrality is tied, the higher `symbolCount` wins; product roles outrank fixtures even when the fixture would otherwise win by score (this is the role-aware ranking). As a final deterministic tie-breaker, the function falls back to `Module.id` ascending order; the test that uses `Module.id` as the deterministic tie-breaker under input reordering checks that reversing the input still produces the same output order.

```ts
export function matchesAnyPathPattern(path: string, patterns: string[]): boolean
```

`matchesAnyPathPattern` is the small helper that classifies a single path against a list of glob patterns (translated internally to `ignore` semantics; the `ignore` package is the one imported at the top of the module). The default pattern sets feed into the two classifiers below.

```ts
export function classifyPathRole(path: string, config?: PathRoleConfig): PathRole
```

`classifyPathRole` runs the path through `DEFAULT_PATH_ROLE_PATTERNS` (or the caller-supplied `config`) and returns the matching role. The `modules.test.ts` cases pin four default mappings: `test/fixtures/**` is matched as fixture, both root-level and nested `scripts/**` are matched as tooling, `docs/**` (excluding benchmarks) is matched as docs, and benchmark subtrees are matched as benchmark. The nested `scripts/**` case is the regression caught in the v23 paid end-to-end run: only the root-level glob matched previously, and a path under `packages/mcp/scripts/` was misclassified and went down the LLM stage-4 path.

```ts
export function classifyModuleRole(module: Module, config?: PathRoleConfig): PathRole
```

`classifyModuleRole` lifts `classifyPathRole` to the module level: when all paths in the module share a role the module adopts it, and when roles disagree the module is treated as `"product"` so it is never silently demoted. This is the input that lets `prioritizeModules` rank product modules above fixtures.

## Module edge resolution and ID uniqueness

<!-- lw:anchors packages/core/src/modules.ts#resolveModuleEdges packages/core/src/modules.ts#resolveRelativeImport packages/core/src/modules.ts#stripNodeNextExtension packages/core/src/modules.ts#makeUniqueDeterministicIds packages/core/src/modules.ts#candidateIdSequence packages/core/src/modules.ts#pathSlugOf packages/core/src/modules.ts#pathSegmentsFor packages/core/src/modules.ts#slugifySegment packages/core/src/modules.ts#slugifyIdSegment packages/core/src/modules.ts#assertUniqueModuleIds packages/core/src/modules.ts#DuplicateModuleIdError packages/core/src/modules.ts#DuplicateModuleIdError.constructor -->

Edge resolution turns file-level imports into module-to-module edges; ID uniqueness ensures the slugs are safe to use as filenames in stage 4.

```ts
export function resolveModuleEdges(
  modules: Module[],
  importsByFile: Map<string, ExtractedImport[]>,
  knownFiles: Set<string>,
): ModuleGraphEdge[]
```

`resolveModuleEdges` enumerates each module's files and their imports, resolves each import through `resolveRelativeImport` after `stripNodeNextExtension`, filters imports that resolve to a known file in a different module, and emits one edge per unique (from, to) pair. The `modules.test.ts` cases pin the rules: absolute and node_modules imports are ignored; self-loops are dropped; parallel imports between the same pair collapse to one edge. The output is what `prioritizeModules` consumes for centrality.

```ts
function resolveRelativeImport(
  importer: string,
  spec: string,
  knownFiles: Set<string>,
): string | null
```

`resolveRelativeImport` is the file-level resolver. It strips any node-next extension, normalizes the relative path against the importer, and returns the resolved repo-relative path only if it is a member of `knownFiles`. Anything else (absolute spec, package, or unknown file) returns `null` and is therefore filtered out at the module-edge level.

```ts
function stripNodeNextExtension(p: string): string
```

`stripNodeNextExtension` removes NodeNext-style extensions from a path before relative resolution, so an import like `./session.js` resolves to `./session` regardless of the on-disk filename.

```ts
export function makeUniqueDeterministicIds(modules: Module[]): Module[]
```

`makeUniqueDeterministicIds` is the phase-5 slug uniqueifier called out in the file-level docstring: when two distinct trees share the same leaf, the slug is expanded from right to left until all modules are unique. The expansion uses `candidateIdSequence`, `pathSlugOf`, and `pathSegmentsFor` to derive the candidate slugs, and `slugifySegment` and `slugifyIdSegment` to normalize them.

```ts
function pathSlugOf(m: Module): string
```

`pathSlugOf` returns the canonical slug for a module's first path; it is used as the initial guess before uniqueness expansion.

```ts
function candidateIdSequence(m: Module): string[]
```

`candidateIdSequence` produces the ordered list of expansion candidates for a single module: the leaf, then progressively leftward segments, each joined with `-` and slugified. The sequence length is bounded by the path depth.

```ts
function pathSegmentsFor(m: Module): string[]
```

`pathSegmentsFor` returns the slash-split segments of a module's representative path, so `candidateIdSequence` can walk them.

```ts
function slugifySegment(s: string): string
```

`slugifySegment` is the per-segment slugifier used during uniqueness expansion: lowercased, non-alphanumerics replaced with `-`, leading and trailing dashes stripped.

```ts
function slugifyIdSegment(s: string): string
```

`slugifyIdSegment` is the strict variant used to sanitize existing ids before they hit the filesystem; it rejects collisions with reserved characters and emits an empty string on degenerate input.

```ts
export function assertUniqueModuleIds(modules: Module[]): void
```

`assertUniqueModuleIds` is the defensive assertion the file-level docstring calls out: it iterates the module list, builds a `Set<string>` of seen ids, and throws `DuplicateModuleIdError` on the first collision. Callers that want to repair the partition run `makeUniqueDeterministicIds` first and then this assertion before stage 4.

```ts
export class DuplicateModuleIdError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DuplicateModuleIdError";
  }
}
```

`DuplicateModuleIdError` is the typed failure thrown by `assertUniqueModuleIds`. It only carries the standard `Error` shape with `name` set; the message is built by the caller and describes which ids collided.

## Oversize splitting and partition assertions

<!-- lw:anchors packages/core/src/modules.ts#MODULE_SPLIT_DEFAULTS packages/core/src/modules.ts#SPLIT_AXIS_DISABLED packages/core/src/modules.ts#normalizeSplitLimits packages/core/src/modules.ts#splitOversizedModules packages/core/src/modules.ts#countSymbols packages/core/src/modules.ts#resolveSymbolCount packages/core/src/modules.ts#axisEnabled packages/core/src/modules.ts#fitsLimits packages/core/src/modules.ts#splitOneModule packages/core/src/modules.ts#chunkFlatBucket packages/core/src/modules.ts#groupPathsByNextSegment packages/core/src/modules.ts#fileStem packages/core/src/modules.ts#assertExactPathPartition packages/core/src/modules.ts#ExactPartitionError packages/core/src/modules.ts#ExactPartitionError.constructor packages/core/src/modules.ts#refinePeerDirectoryFragmentationError -->

These functions together enforce the completion-oriented structural budget on a module partition: no module may exceed the dual-axis limits, and the partition must be exact (every original file ends up in exactly one output module).

```ts
export const MODULE_SPLIT_DEFAULTS = {
  maxFiles: 12,
  maxSymbols: 80,
} as const;

export const SPLIT_AXIS_DISABLED = Number.MAX_SAFE_INTEGER;
```

`MODULE_SPLIT_DEFAULTS` is the dual-axis budget: at most 12 files per module, at most 80 symbols per module. `SPLIT_AXIS_DISABLED` is the sentinel for "axis off" (`Number.MAX_SAFE_INTEGER`). With the sentinel a `fitsLimits` check cannot trip on that axis.

```ts
export function normalizeSplitLimits(
  maxFiles?: number,
  maxSymbols?: number,
): { maxFiles: number; maxSymbols: number }
```

`normalizeSplitLimits` maps caller input onto the internal representation. `undefined` falls back to the default for that axis; `0` or negative values map to `SPLIT_AXIS_DISABLED` (so the axis is effectively unbounded). The pair is what `splitOversizedModules` consults before deciding whether a module needs splitting.

```ts
export function splitOversizedModules(
  modules: Module[],
  options: SplitOversizedOptions = {},
): Module[]
```

`splitOversizedModules` is the public splitter. The inline comments outline the four-step strategy: true subdirectories first; peer leaves form one flat bucket; oversized flat buckets are packed with dual-axis limits using `parent-01`, `parent-02`, and so on; a single file that exceeds limits is flagged `unsplittable: true` so stage 4 knows to bound context for that unit. Helpers used internally are documented next.

```ts
function countSymbols(paths: string[], map: Map<string, number>): number
```

`countSymbols` sums the symbol counts for a list of paths, treating missing entries as zero. It is the per-bucket totalizer called from `splitOneModule` and `chunkFlatBucket`.

```ts
function resolveSymbolCount(
  paths: string[],
  map: Map<string, number> | undefined,
): number
```

`resolveSymbolCount` is the safe variant that tolerates a missing `symbolCountByPath` (returns 0 in that case). It guards `splitOversizedModules` against an undefined map.

```ts
function axisEnabled(limit: number): boolean
```

`axisEnabled` is the small predicate that asks whether a given axis is on: returns `true` only when `limit` is strictly less than `SPLIT_AXIS_DISABLED`. It is the gate `fitsLimits` consults before counting an axis against the budget.

```ts
function fitsLimits(
  fileCount: number,
  symbolCount: number,
  limits: { maxFiles: number; maxSymbols: number },
): boolean
```

`fitsLimits` evaluates both axes (when enabled) and returns `true` only when neither is exceeded. The implementation caps the upper side only; there is no lower bound.

```ts
function splitOneModule(
  module: Module,
  limits: { maxFiles: number; maxSymbols: number },
  options: SplitOversizedOptions,
): Module[]
```

`splitOneModule` is the per-module splitter. It first attempts a true-subdirectory split (`groupPathsByNextSegment`), then a flat-bucket chunking pass (`chunkFlatBucket`) when the bucket still exceeds limits, and finally marks the module `unsplittable: true` when a single file is the unit and still exceeds. Per the inline comments, a single oversized file does not abort the run; stage 4 just has to bound context.

```ts
function chunkFlatBucket(
  paths: string[],
  limits: { maxFiles: number; maxSymbols: number },
  symbolCountByPath: Map<string, number> | undefined,
): string[][]
```

`chunkFlatBucket` packs the peer leaf files into sequential groups that respect the dual-axis limits. Each inner array is one chunk; sibling chunks share a parent id and are suffixed `-01`, `-02`, and so on in `splitOversizedModules`.

```ts
function groupPathsByNextSegment(paths: string[]): { [segment: string]: string[] }
```

`groupPathsByNextSegment` is the directory-driven grouper inside `splitOneModule`: paths are bucketed by their next path segment after the current directory. This is the "true subdirectories only" rule.

```ts
function fileStem(path: string): string
```

`fileStem` returns the filename without its extension. It backs the per-chunk ordinal id construction.

```ts
export function assertExactPathPartition(
  modules: Module[],
  originalPaths: Set<string>,
): void
```

`assertExactPathPartition` is the post-split invariant. It builds the union of all output paths and asserts equality with `originalPaths` (no path lost, no path duplicated). On mismatch it throws `ExactPartitionError`. This is the second of the two defensive assertions called out in the file-level docstring; `assertUniqueModuleIds` is the first.

```ts
export class ExactPartitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExactPartitionError";
  }
}
```

`ExactPartitionError` is the typed failure thrown by `assertExactPathPartition`. Same shape as `DuplicateModuleIdError`: standard `Error`, `name` overridden.

```ts
export function refinePeerDirectoryFragmentationError(
  error: ExactPartitionError,
  options: SplitOversizedOptions,
): ExactPartitionError
```

`refinePeerDirectoryFragmentationError` produces a more actionable `ExactPartitionError` message when the underlying failure is that every peer leaf became its own module (a fragmentation case). It does not fix the partition; it only rewrites the message so the repair stage can target the right axis.

## Display-title refinement

<!-- lw:anchors packages/core/src/modules.ts#applyRefinedDisplayTitles packages/core/src/modules.ts#normalizeRefinedDisplayTitle packages/core/src/modules.ts#normalizePresentationLabel -->

Stage 2 may suggest presentation-only titles for each module. These helpers accept the suggestions without making them part of partition validation.

```ts
export function applyRefinedDisplayTitles(
  modules: ReadonlyArray<Module>,
  candidates: ReadonlyArray<RefinedDisplayTitleCandidate>,
): Module[]
```

`applyRefinedDisplayTitles` validates each candidate via `normalizeRefinedDisplayTitle`, then drops any title whose normalized form is already used by another module (so navigation never has two pages with the same display title). Modules without an accepted title keep their deterministic id-based fallback; modules with a title get a `displayTitle` property in the output.

```ts
function normalizeRefinedDisplayTitle(value: unknown, moduleId: string): string | null
```

`normalizeRefinedDisplayTitle` is the per-candidate validator. It rejects non-strings, titles outside 4 to 120 chars, titles with control characters, titles without a single Unicode letter, titles that normalize to the module id itself, and titles that normalize to one of the reserved generic strings. Any rejection returns `null`, so the candidate is silently dropped.

```ts
function normalizePresentationLabel(value: string): string
```

`normalizePresentationLabel` is the NFKD-based normalizer used by both the validator and the duplicate-suppression map: it strips combining marks, lowercases, replaces non-alphanumerics with `-`, and trims leading and trailing dashes. The result is the canonical form used to detect title collisions and id-shaped titles.

## Mermaid syntax validator

<!-- lw:anchors packages/core/src/mermaid-validator.ts#validateMermaidSyntax packages/core/src/mermaid-validator.ts#parseWithTemporaryDom packages/core/src/mermaid-validator.ts#restoreGlobal -->

Mermaid's parser requires a browser-like `window` and `document`. The validator serializes calls and swaps those globals only for the duration of one parse, then restores them.

```ts
export function validateMermaidSyntax(source: string): Promise<string | null>
```

`validateMermaidSyntax` is the public entry point. Per the docstring, it chains the parse onto a module-level queue (initialized to a resolved promise), serializing callers so the global swap is never visible to two parses at once. The queue advances even when a prior parse rejected, so a single failure does not block subsequent validations. Returns the error message string, or `null` when the diagram is valid.

```ts
async function parseWithTemporaryDom(source: string): Promise<string | null>
```

`parseWithTemporaryDom` is the actual parse. It snapshots whether `window` and `document` already existed on `globalThis`, stashes the previous values, and overwrites them with a pre-built `JSDOM` instance for the lifetime of one `mermaid.parse`. The `mermaid` module is lazily imported and initialized once; subsequent calls reuse the same instance. Any thrown error is captured and returned as a message; non-`Error` throws are coerced through `String(error)`. The `finally` block restores both globals.

```ts
function restoreGlobal(
  globals: Record<string, unknown>,
  key: string,
  existed: boolean,
  previous: unknown,
): void
```

`restoreGlobal` is the restore helper used in the `finally` block. When the global pre-existed it reassigns the previous value; when it did not it deletes the key so the temporary `JSDOM` is fully gone. This is what prevents `validateMermaidSyntax` from leaking browser globals into the rest of the process.

## Module test helpers

<!-- lw:anchors packages/core/src/modules.test.ts#idFor -->

```ts
function idFor(mod: { id: string; paths: string[]; symbolCount: number }): string
```

`idFor` is a small projection helper used inside `modules.test.ts` to extract just the `id` field from a `Module`-shaped value for compact assertions. It does not appear in the production surface; it is a test-local convenience.

<!-- livewiki:navigate:start -->
## Navigate

- [Core batch pipeline and call-graph analytics](core-src-04.md) — dependency and dependent
- [Core source module 09 — orientation, parser, pointer, output budget, navigation](core-src-09.md) — dependency and dependent
- [Anchor ledger and artifact repair](core-src-01.md) — dependency and dependent

> Coverage note: this module's source (5 files, ~168k chars) exceeded the prompt budget and was excerpted; this page documents the closed-list symbols.
<!-- livewiki:navigate:end -->
