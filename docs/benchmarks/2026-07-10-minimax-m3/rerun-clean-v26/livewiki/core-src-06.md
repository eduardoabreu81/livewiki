---
title: Manifest persistence, Markdown masking, module partitioning, and mermaid validation
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

# Manifest persistence, Markdown masking, module partitioning, and mermaid validation

This module groups the cross-cutting pipeline helpers used by livewiki's batch run: the on-disk `.manifest.json` ledger, the Markdown code-masking primitives that protect structural scans from display text, the deterministic module identification / partition logic, and the sandboxed Mermaid validator.

## When to use this page

- **Inspect** the `.manifest.json` schema and idempotent write semantics when a CI run keeps touching the manifest for no reason.
- **Diagnose** unclosed Markdown constructs (fence or inline-code) reported by the verifier with `boundedExcerpt` and `unclosedMarkdownDiagnostic`.
- **Reason about** module partitioning (heuristic grouping, oversized splitting, unique deterministic IDs, and exact-partition assertions) when batch output unexpectedly merges or fragments files.
- **Validate** a Mermaid diagram with the JSDOM-based `validateMermaidSyntax` and interpret its serialized error message.

## How it fits

The `core/src` tree hosts the deterministic stage-2 / stage-3 workhorse: `manifest.ts` is the only writer of `livewiki/.manifest.json`, which carries the cross-machine batch handoff state; `markdown-mask.ts` is the shared masker consumed by `verify.ts`, `artifact.ts`, and `anchors.ts` so they all see the same view of code regions; `modules.ts` is the directory+import-graph partitioning engine that stage 4 (page write) reads from; `mermaid-validator.ts` exposes Mermaid's real parser behind a process-wide queue. The accompanying `*.test.ts` files are vitest specs that pin down the byte-level and partition-level behaviour these helpers guarantee.

## Manifest on disk and test fixture helper

<!-- lw:anchors packages/core/src/manifest.test.ts#writeLivewikiFile packages/core/src/manifest.ts#MANIFEST_VERSION packages/core/src/manifest.ts#MANIFEST_REL_PATH packages/core/src/manifest.ts#buildManifest packages/core/src/manifest.ts#readManifest packages/core/src/manifest.ts#writeManifestIfChanged packages/core/src/manifest.ts#manifestsEqual packages/core/src/manifest.ts#pendingBatchEqual packages/core/src/manifest.ts#computeSnapshotHash packages/core/src/manifest.ts#listFiles -->

The manifest is the only file in `livewiki/` that is allowed to be rewritten on every batch run — but only when its semantic content actually changes. `MANIFEST_VERSION` and `MANIFEST_REL_PATH` pin the schema and the relative location; `buildManifest` constructs the payload from `(lastDocumentedCommit, snapshotHash, pendingBatch)`, stamping `updatedAt` as the current ISO time. `readManifest` is deliberately tolerant: if the file is missing, unreadable, contains invalid JSON, or has a non-numeric `version` / `snapshotHash`, it returns `null` instead of throwing — a property the CI loop relies on. `writeManifestIfChanged` consults the current disk state and only writes through `safeIo` when `manifestsEqual` reports a semantic difference. That equality intentionally ignores `updatedAt` (otherwise the timestamp alone would defeat the anti-loop), and delegates to `pendingBatchEqual` for the batch reference.

`computeSnapshotHash` walks `livewiki/`, drops the manifest itself, sorts the file list alphabetically for determinism, hashes each file with `sha256`, concatenates `relpath\n<hash>\n` lines, and returns the sha256 of the concatenation. `listFiles` is the iterative depth-first walker behind it; a missing `livewiki/` directory returns an empty hash rather than throwing. The shared test helper `writeLivewikiFile` (in `manifest.test.ts`) materializes a path under a temp repo root via `nodeFs.mkdir(..., {recursive: true})` and `nodeFs.writeFile`, and is what makes the determinism and anti-loop specs reproducible.

```ts
async function writeLivewikiFile(relPath: string, content: string): Promise<void>
```

```ts
export const MANIFEST_VERSION = 1;
export const MANIFEST_REL_PATH = "livewiki/.manifest.json";
```

## Markdown code masking

<!-- lw:anchors packages/core/src/markdown-mask.ts#maskCodeSpans packages/core/src/markdown-mask.ts#maskCodeSpansPreservingLength packages/core/src/markdown-mask.ts#maskFencedCodeBlocks packages/core/src/markdown-mask.ts#maskFencedCodeBlocksPreservingLength packages/core/src/markdown-mask.ts#maskInlineCode packages/core/src/markdown-mask.ts#createFenceState packages/core/src/markdown-mask.ts#consumeFenceLine packages/core/src/markdown-mask.ts#hasUnclosedFence packages/core/src/markdown-mask.ts#hasUnclosedMarkdown packages/core/src/markdown-mask.ts#unclosedMarkdownDiagnostic packages/core/src/markdown-mask.ts#boundedExcerpt -->

The masking API has two flavours. `maskCodeSpans` collapses fenced blocks and inline code into empty strings — used when downstream code only needs a length-stable view of prose. `maskCodeSpansPreservingLength` keeps byte length and CRLF terminators intact while replacing code characters with spaces, so any index into the masked string maps to the same index in the original. Both rely on the shared `FenceState` produced by `createFenceState` and stepped by `consumeFenceLine`, which honours the `FENCE_OPEN_RE` opening rule (3+ backticks or tildes, 0–3 spaces indent) and closes when a run of at least the opener's length appears alone on a line. `maskInlineCode` follows CommonMark's exact-length closing rule for backtick runs; an unmatched run is preserved verbatim — that residue is precisely the signal `hasUnclosedMarkdown` keys on.

`hasUnclosedMarkdown` is the objective, non-size-based detector for documents cut mid-construct: it returns true if `hasUnclosedFence` is still inside a block after the walk, or if any backtick survives the masking (every backtick in a well-formed document is consumed as part of a matched pair). `unclosedMarkdownDiagnostic` produces a structured repair pointer — `kind` (`"fence"` or `"inline-code"`), 1-based `lineNumber`, the `offending` excerpt, and the exact `delimiterLength` so the repair prompt can emit a correctly-sized closing run. `boundedExcerpt` centres the excerpt on the offending delimiter and emits left/right truncation markers instead of slicing the prefix; without centring, a backtick past column 200 on a long line would never appear in the diagnostic and the repair model would loop.

```ts
export function hasUnclosedMarkdown(text: string): boolean {
  if (hasUnclosedFence(text)) return true;
  return maskInlineCode(maskFencedCodeBlocks(text)).includes("`");
}
```

## Module identification and partitioning

<!-- lw:anchors packages/core/src/modules.ts#identifyModulesHeuristic packages/core/src/modules.ts#dirToModuleId packages/core/src/modules.ts#normalizeRepoPath packages/core/src/modules.ts#resolveModuleEdges packages/core/src/modules.ts#resolveRelativeImport packages/core/src/modules.ts#stripNodeNextExtension packages/core/src/modules.ts#classifyPathRole packages/core/src/modules.ts#classifyModuleRole packages/core/src/modules.ts#matchesAnyPathPattern packages/core/src/modules.ts#DEFAULT_PATH_ROLE_PATTERNS packages/core/src/modules.ts#DEFAULT_FLOW_SIGNAL_PATTERNS packages/core/src/modules.ts#prioritizeModules packages/core/src/modules.ts#makeUniqueDeterministicIds packages/core/src/modules.ts#pathSlugOf packages/core/src/modules.ts#candidateIdSequence packages/core/src/modules.ts#pathSegmentsFor packages/core/src/modules.ts#slugifySegment packages/core/src/modules.ts#slugifyIdSegment packages/core/src/modules.ts#fileStem packages/core/src/modules.ts#assertUniqueModuleIds packages/core/src/modules.ts#DuplicateModuleIdError packages/core/src/modules.ts#DuplicateModuleIdError.constructor packages/core/src/modules.ts#applyRefinedDisplayTitles packages/core/src/modules.ts#normalizeRefinedDisplayTitle packages/core/src/modules.ts#normalizePresentationLabel -->

`identifyModulesHeuristic` is the deterministic stage-2 entry point: it normalizes each path via `normalizeRepoPath`, groups by top-level directory, counts symbols via the optional `symbolCountByPath` map, names each group with `dirToModuleId` (last path segment, with single-root-repo basename and multi-root-`root` handling), and emits modules sorted by id. `resolveModuleEdges` walks `ExtractedImport` records, resolves relative imports through `resolveRelativeImport` (after `stripNodeNextExtension` drops `.js` suffixes the TS source uses), drops absolute/node_modules targets and self-loops, and dedups parallel edges.

Path-role classification is pattern-driven. `DEFAULT_PATH_ROLE_PATTERNS` and `DEFAULT_FLOW_SIGNAL_PATTERNS` are the conservative defaults (tests, fixtures, build output excluded from "product" role); `matchesAnyPathPattern` is the glob matcher they feed. `classifyPathRole` resolves a single path; `classifyModuleRole` aggregates roles across a module's paths.

`prioritizeModules` orders the module list by descending in-degree (centrality), then descending symbol count, with role-aware promotion so product pages outrank fixtures on ties, and a deterministic id tie-break so input reorder does not perturb the order. `makeUniqueDeterministicIds` expands a colliding leaf slug right-to-left (e.g. `src` in two packages → `core-src`, `cli-src`) using `pathSegmentsFor`, `pathSlugOf`, `candidateIdSequence`, `slugifySegment`, and `slugifyIdSegment` to keep slugs ASCII and stable; `assertUniqueModuleIds` throws `DuplicateModuleIdError` (its `constructor` carrying the message) when the expansion still collides.

`applyRefinedDisplayTitles` accepts advisory stage-2 titles without making them part of partition validation. Each candidate flows through `normalizeRefinedDisplayTitle` (length 4–120, no control chars, must contain a letter, non-generic, not equal to the id after `normalizePresentationLabel`'s NFKD + lowercase + non-alnum collapsing); collisions on the normalized title silently drop every participant so navigation falls back to the deterministic title.

```ts
export function identifyModulesHeuristic(
  filePaths: string[],
  symbolCountByPath: Map<string, number> = new Map(),
): Module[]
```

## Oversized-module splitting and exact partition

<!-- lw:anchors packages/core/src/modules.ts#MODULE_SPLIT_DEFAULTS packages/core/src/modules.ts#SPLIT_AXIS_DISABLED packages/core/src/modules.ts#normalizeSplitLimits packages/core/src/modules.ts#splitOversizedModules packages/core/src/modules.ts#splitOneModule packages/core/src/modules.ts#chunkFlatBucket packages/core/src/modules.ts#groupPathsByNextSegment packages/core/src/modules.ts#fitsLimits packages/core/src/modules.ts#axisEnabled packages/core/src/modules.ts#countSymbols packages/core/src/modules.ts#resolveSymbolCount packages/core/src/modules.ts#assertExactPathPartition packages/core/src/modules.ts#refinePeerDirectoryFragmentationError packages/core/src/modules.ts#ExactPartitionError packages/core/src/modules.ts#ExactPartitionError.constructor packages/core/src/modules.test.ts#idFor -->

`MODULE_SPLIT_DEFAULTS` and `SPLIT_AXIS_DISABLED` (`Number.MAX_SAFE_INTEGER`) are the two knobs the splitter exposes: per-axis caps (`maxFiles`, `maxSymbols`), with `0` / negative meaning "axis disabled". `normalizeSplitLimits` maps user input onto those defaults and sentinel value; `axisEnabled` is the boolean helper and `fitsLimits` is the per-module predicate that drives the loop. `splitOversizedModules` partitions any module that fails `fitsLimits` via `splitOneModule`, which first calls `groupPathsByNextSegment` to honour the directory tree (siblings under the same folder stay together), then `chunkFlatBucket` to flat-pack the remainder once the structure is exhausted. Symbol counts come from `resolveSymbolCount` over the optional map, with `countSymbols` as the pure accumulator. `idFor` (in the test module) is the deterministic label used in the split-output assertions.

After splitting, `assertExactPathPartition` rebuilds a path set from the resulting modules and compares it against the input — any mismatch (paths lost, paths duplicated, paths invented) raises `ExactPartitionError` (with the `constructor` carrying the message). The splintered-folder error message is sharpened by `refinePeerDirectoryFragmentationError`, which rewrites the generic partition failure into one that names the directories the splitter fragmented, so the diagnostic points at the right place to widen the cap.

```ts
export const MODULE_SPLIT_DEFAULTS = {
  maxFiles: 12,
  maxSymbols: 80,
} as const;
export const SPLIT_AXIS_DISABLED = Number.MAX_SAFE_INTEGER;
```

## Mermaid syntax validation

<!-- lw:anchors packages/core/src/mermaid-validator.ts#validateMermaidSyntax packages/core/src/mermaid-validator.ts#parseWithTemporaryDom packages/core/src/mermaid-validator.ts#restoreGlobal -->

`validateMermaidSyntax` is the public entry point. Mermaid's parser requires browser-like `window` and `document` globals, so the validator installs a JSDOM-supplied `parserDom` for the duration of one parse and restores the prior globals in a `finally` block. The module-level `validationQueue` serializes calls because those globals are process-wide: each new call chains onto the previous one's resolution (success or failure), so a concurrent caller cannot see a half-swapped DOM. `parseWithTemporaryDom` snapshots `window` and `document` presence and prior values, installs the temporary ones, lazily loads and `initialize`s the Mermaid default export on first use, awaits `mermaidInstance.parse`, and on rejection returns the `Error.message` (or `String(error)`) as the diagnostic. `restoreGlobal` writes the previous value back when the global existed, or `delete`s it when it did not — so the validator never leaves a phantom `window` on a host that never had one.

```ts
export function validateMermaidSyntax(source: string): Promise<string | null>
```

```ts
async function parseWithTemporaryDom(source: string): Promise<string | null>
```

```ts
function restoreGlobal(
  globals: Record<string, unknown>,
  key: string,
  existed: boolean,
  previous: unknown,
): void
```

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
- Flow: [CLI scaffold through export hashing](flows/cli-src-to-core-src-04.md)
- ["Core pipeline: batch orchestration, config, db, and diagrams"](core-src-03.md) — dependency and dependent
- [core-src-08 — prompts, safe I/O, status, symbol extraction, and topic planning](core-src-08.md) — dependency and dependent
- [Core export, frontmatter, gitignore, flow detection, and hashing](core-src-04.md) — dependency and dependent
<!-- livewiki:navigate:end -->
