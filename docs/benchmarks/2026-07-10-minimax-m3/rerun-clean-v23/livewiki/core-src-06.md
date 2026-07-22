---
title: core library — manifest, markdown masking, mermaid validation, and module identification
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

# core library — manifest, markdown masking, mermaid validation, and module identification

This page documents a slice of `packages/core/src` covering the manifest persistence layer, deterministic Markdown code masking, Mermaid syntax validation under a temporary DOM, and the heuristic that turns a list of source paths into ordered, uniquely identified modules.

## When to use this page

- **Read** the manifest section when you need to understand how `livewiki/.manifest.json` is read, written idempotently, and excluded from its own snapshot hash.
- **Read** the markdown-mask section when you need to know how fenced code and inline code are blanked without shifting source indices, or how unclosed constructs are reported with bounded excerpts.
- **Read** the mermaid-validator section when you need to know how syntax validation is serialized and how process-wide globals are temporarily swapped.
- **Read** the modules section when you need to understand directory-based grouping, role-aware prioritization, oversized-module splitting, deterministic ID generation, and partition assertions.

## How it fits

The four files in this slice sit between the batch pipeline (stages 2–4) and the rest of `packages/core`. `manifest.ts` is the persistence boundary on disk, backed by `safe-io`; it reads and writes `livewiki/.manifest.json` via `safeIo.readText` and `safeIo.writeText` and hashes livewiki contents via `sha256`. `markdown-mask.ts` is a small shared utility consumed by `verify.ts`, `artifact.ts`, and `anchors.ts` so that code constructs are blanked (not deleted) before structural scans. `mermaid-validator.ts` is the only place that loads Mermaid and uses `jsdom`; it serializes calls and restores `window` and `document` after each parse. `modules.ts` is the deterministic backbone of batch stage 2 — its output is the input that the navigation tests (`navigation.test.ts`) and downstream stage 3/4 stages consume.

## Manifest constants and disk path
<!-- lw:anchors packages/core/src/manifest.ts#MANIFEST_VERSION packages/core/src/manifest.ts#MANIFEST_REL_PATH -->

```ts
export const MANIFEST_VERSION = 1;
export const MANIFEST_REL_PATH = "livewiki/.manifest.json";
```

`MANIFEST_VERSION` is the schema version stamped on every produced manifest. `MANIFEST_REL_PATH` is the on-disk location under `repoRoot`; every read/write in this module is relative to that path.

## Manifest read, write, and idempotence
<!-- lw:anchors packages/core/src/manifest.ts#readManifest packages/core/src/manifest.ts#writeManifestIfChanged packages/core/src/manifest.ts#buildManifest packages/core/src/manifest.ts#manifestsEqual packages/core/src/manifest.ts#pendingBatchEqual -->

`readManifest` returns `null` when the file does not exist, when `JSON.parse` throws on corrupted input, or when the parsed object lacks a numeric `version` or string `snapshotHash`. `writeManifestIfChanged` returns `false` when the existing manifest already matches; otherwise it serializes via `JSON.stringify(manifest, null, 2) + "\n"` and writes through `safeIo.writeText`.

`buildManifest` takes the three content fields and stamps `version` and `updatedAt`:

```ts
export function buildManifest(args: {
  lastDocumentedCommit: string | null;
  snapshotHash: string;
  pendingBatch: PendingBatchRef | null;
}): LivewikiManifest {
  return {
    version: MANIFEST_VERSION,
    lastDocumentedCommit: args.lastDocumentedCommit,
    snapshotHash: args.snapshotHash,
    updatedAt: new Date().toISOString(),
    pendingBatch: args.pendingBatch,
  };
}
```

The equality check intentionally ignores `updatedAt`, so a fresh `buildManifest` call against unchanged content does not rewrite:

```ts
function manifestsEqual(a: LivewikiManifest, b: LivewikiManifest): boolean {
  return (
    a.version === b.version &&
    a.snapshotHash === b.snapshotHash &&
    a.lastDocumentedCommit === b.lastDocumentedCommit &&
    pendingBatchEqual(a.pendingBatch, b.pendingBatch)
  );
}
```

`pendingBatchEqual` returns `true` only when both references are `null` or every field of `PendingBatchRef` (`runId`, `stage`, `done`, `total`) matches. If `readManifest` returns `null` (corrupted or absent) the equality short-circuits and `writeManifestIfChanged` rewrites — so a corrupt manifest is recoverable on the next run rather than propagating.

## Snapshot hash and directory walk
<!-- lw:anchors packages/core/src/manifest.ts#computeSnapshotHash packages/core/src/manifest.ts#listFiles -->

```ts
export async function computeSnapshotHash(repoRoot: string): Promise<string> {
  const livewikiDir = nodePath.join(repoRoot, "livewiki");
  const files = await listFiles(livewikiDir);
  const filtered = files.filter((f) => !f.endsWith(MANIFEST_REL_PATH.split("/").pop()!));
  filtered.sort();
  // combines "<relpath>\n<sha256(content)>\n" for each file, then sha256 of the concat
}
```

`computeSnapshotHash` filters out the manifest itself before hashing, sorts the remaining relative paths for determinism, and feeds the joined body to `sha256`. The exclusion is by `endsWith` against the leaf of `MANIFEST_REL_PATH`, so a stray `.manifest.json` written elsewhere is still included.

`listFiles` walks the tree with an explicit stack (no recursion) and uses `nodeFs.readdir(..., { withFileTypes: true })`; it catches read errors per directory and skips them rather than throwing. Paths are normalized with forward slashes regardless of the host platform, so the hash is portable across Windows and POSIX.

## Markdown masking — state machine and fences
<!-- lw:anchors packages/core/src/markdown-mask.ts#createFenceState packages/core/src/markdown-mask.ts#consumeFenceLine packages/core/src/markdown-mask.ts#maskFencedCodeBlocks packages/core/src/markdown-mask.ts#maskFencedCodeBlocksPreservingLength -->

```ts
function createFenceState(): FenceState {
  return { inFence: false, fenceChar: "", fenceLen: 0 };
}
```

`createFenceState` returns the shared mutable record threaded through `consumeFenceLine`, which advances the state machine for one line at a time. A fence is opened by a line matching `/^[ \t]{0,3}(`{3,}|~{3,})/`; it is closed by a line containing only the same character with at least the original run length, optionally surrounded by whitespace. `maskFencedCodeBlocks` splits on `/\r?\n/` and replaces every line that belongs to a fence (including opener and closer) with the empty string, joining back with `"\n"`.

`maskFencedCodeBlocksPreservingLength` walks character-by-character so the output stays index-aligned with the source. When a line belongs to a fence, the line is replaced by `" ".repeat(line.length)`; the original line terminator (`\r\n` or `\n`) is preserved verbatim, which matters for the CRLF-aware tests.

## Markdown masking — inline code and unclosed detection
<!-- lw:anchors packages/core/src/markdown-mask.ts#maskInlineCode packages/core/src/markdown-mask.ts#maskCodeSpans packages/core/src/markdown-mask.ts#maskCodeSpansPreservingLength packages/core/src/markdown-mask.ts#hasUnclosedFence packages/core/src/markdown-mask.ts#hasUnclosedMarkdown -->

```ts
export function maskCodeSpans(text: string): string {
  return maskInlineCode(maskFencedCodeBlocks(text));
}
```

`maskInlineCode` consumes backtick runs and matches the closing run by exact length (CommonMark rule). When no matching close exists for a run, the literal backticks survive in the output — that surviving backtick is the deterministic signal that the document was cut mid code-span. `maskCodeSpansPreservingLength` chains `maskFencedCodeBlocksPreservingLength` and `maskInlineCode` so output length and CRLF offsets match the source.

`hasUnclosedFence` simply runs the fence state machine to the end of the document and returns `state.inFence`. `hasUnclosedMarkdown` short-circuits on an unclosed fence and otherwise runs the collapsing mask and checks whether a backtick survived `maskInlineCode`. The excerpt shown in the source is truncated, so this page scopes the prose to the visible normal path: a well-formed document returns `false` from both checks, while truncation mid construct yields `true` for the relevant branch.

## Unclosed markdown diagnostic
<!-- lw:anchors packages/core/src/markdown-mask.ts#unclosedMarkdownDiagnostic packages/core/src/markdown-mask.ts#boundedExcerpt -->

`unclosedMarkdownDiagnostic` returns a structured record with `kind` (`"fence"` or `"inline-code"`), `lineNumber`, a bounded `offending` excerpt capped at 200 characters, and the exact `delimiterLength`. The closing rules differ between the two kinds (fence closes with at least the opener's run length; inline-code closes with the exact same run length), so `kind` and `delimiterLength` together let a repair prompt emit a correct closing delimiter even when the run exceeds the excerpt cap. `boundedExcerpt` centers the snippet on the offending delimiter and uses visible truncation markers on either side so a delimiter past column 200 is still present in the excerpt.

## Mermaid validation under a temporary DOM
<!-- lw:anchors packages/core/src/mermaid-validator.ts#validateMermaidSyntax packages/core/src/mermaid-validator.ts#parseWithTemporaryDom packages/core/src/mermaid-validator.ts#restoreGlobal -->

```ts
export function validateMermaidSyntax(source: string): Promise<string | null> {
  const result = validationQueue.then(
    () => parseWithTemporaryDom(source),
    () => parseWithTemporaryDom(source),
  );
  validationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
```

Calls are serialized through a module-scoped `validationQueue` because Mermaid mutates process-wide `window` and `document` globals. `parseWithTemporaryDom` snapshots whether `window` and `document` already exist on `globalThis`, saves their prior values, installs the pre-built `parserDom`, lazily imports Mermaid and calls `initialize({ startOnLoad: false })` on first use, then runs `mermaidInstance.parse(source)` and returns the error message or `null` on success. The `finally` block always restores the prior globals:

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

When a key did not exist before the call it is `delete`d; otherwise the previous value is restored. If `mermaidInstance.parse` throws a non-`Error`, it is coerced via `String(error)` before being returned, so callers always get a string or `null`.

## Module types and presentation titles
<!-- lw:anchors packages/core/src/modules.ts#applyRefinedDisplayTitles packages/core/src/modules.ts#normalizeRefinedDisplayTitle packages/core/src/modules.ts#normalizePresentationLabel -->

`applyRefinedDisplayTitles` is the LLM-refinement consumer: it accepts advisory `displayTitle` candidates but never lets them break the deterministic partition. A candidate is dropped if `normalizeRefinedDisplayTitle` returns `null`, and any title that normalizes identically to another's is also dropped to prevent duplicate display labels. The result is a new `Module[]` where accepted titles become the `displayTitle` field; rejected modules keep their original shape with no `displayTitle`.

`normalizeRefinedDisplayTitle` returns `null` for non-strings, titles outside the 4–120 character range, titles with control characters, titles that have no letter at all, titles whose normalized form equals the module id (so the title is never just the id), and titles whose normalized form is one of the generic placeholders `["module", "source", "code", "repository-module"]`. `normalizePresentationLabel` lowercases, strips diacritics via NFKD, collapses non-alphanumeric runs to `-`, and trims leading/trailing dashes — the same shape used for comparison.

## Heuristic module identification
<!-- lw:anchors packages/core/src/modules.ts#identifyModulesHeuristic packages/core/src/modules.ts#dirToModuleId packages/core/src/modules.ts#normalizeRepoPath -->

```ts
export function identifyModulesHeuristic(
  filePaths: string[],
  symbolCountByPath: Map<string, number> = new Map(),
): Module[] {
  const byDir = new Map<string, string[]>();
  for (const raw of filePaths) {
    const path = normalizeRepoPath(raw);
    const slash = path.lastIndexOf("/");
    const dir = slash === -1 ? "" : path.slice(0, slash);
    const arr = byDir.get(dir) ?? [];
    arr.push(path);
    byDir.set(dir, arr);
  }
  modules.sort((a, b) => a.id.localeCompare(b.id));
  return modules;
}
```

Each file is routed to its top-level directory; the `Module.symbolCount` is summed from the optional `symbolCountByPath` map (missing entries count as 0). Output is sorted by `id` so the function is input-order independent.

`dirToModuleId` returns the directory's last segment as the id. The single exception is when `dir === ""`: if the repo has exactly one file at the root, the id is the file's basename without extension; otherwise the id is the literal string `"root"`. `normalizeRepoPath` is the path-canonicalization helper used before grouping (its body is not in the visible excerpt, so this page scopes behavior to the routing shown above).

## Oversized-module splitting
<!-- lw:anchors packages/core/src/modules.ts#MODULE_SPLIT_DEFAULTS packages/core/src/modules.ts#SPLIT_AXIS_DISABLED packages/core/src/modules.ts#normalizeSplitLimits packages/core/src/modules.ts#splitOversizedModules packages/core/src/modules.ts#splitOneModule packages/core/src/modules.ts#axisEnabled packages/core/src/modules.ts#fitsLimits packages/core/src/modules.ts#chunkFlatBucket packages/core/src/modules.ts#groupPathsByNextSegment packages/core/src/modules.ts#countSymbols packages/core/src/modules.ts#resolveSymbolCount -->

```ts
export const MODULE_SPLIT_DEFAULTS = {
  maxFiles: 12,
  maxSymbols: 80,
} as const;

export const SPLIT_AXIS_DISABLED = Number.MAX_SAFE_INTEGER;
```

`MODULE_SPLIT_DEFAULTS` are the structural caps for completion-oriented splitting; `SPLIT_AXIS_DISABLED` (`Number.MAX_SAFE_INTEGER`) is the sentinel returned by `normalizeSplitLimits` when the user passes `0` or a negative value for an axis, so that axis never triggers a split. `axisEnabled` and `fitsLimits` are the gating helpers; `splitOversizedModules` iterates modules, calls `splitOneModule` on each, and accumulates results. `splitOneModule`, `chunkFlatBucket`, `groupPathsByNextSegment`, `countSymbols`, and `resolveSymbolCount` are the inner pieces that decide whether and how to partition a single oversized module. The excerpt shown here is truncated, so this page scopes the prose to the documented defaults and the disabled-axis sentinel rather than asserting internal partitioning behavior.

## Uniqueness, partition assertions, and id derivation
<!-- lw:anchors packages/core/src/modules.ts#assertUniqueModuleIds packages/core/src/modules.ts#DuplicateModuleIdError packages/core/src/modules.ts#DuplicateModuleIdError.constructor packages/core/src/modules.ts#assertExactPathPartition packages/core/src/modules.ts#ExactPartitionError packages/core/src/modules.ts#ExactPartitionError.constructor packages/core/src/modules.ts#refinePeerDirectoryFragmentationError packages/core/src/modules.ts#makeUniqueDeterministicIds packages/core/src/modules.ts#pathSlugOf packages/core/src/modules.ts#candidateIdSequence packages/core/src/modules.ts#pathSegmentsFor packages/core/src/modules.ts#slugifySegment packages/core/src/modules.ts#slugifyIdSegment packages/core/src/modules.ts#stripNodeNextExtension packages/core/src/modules.ts#fileStem packages/core/src/modules.test.ts#idFor -->

`assertUniqueModuleIds` throws `DuplicateModuleIdError` when two `Module.id` values collide. `DuplicateModuleIdError` extends `Error` and accepts a `message: string` constructor argument. `assertExactPathPartition` throws `ExactPartitionError` when the union of `Module.paths` is not exactly the input path set (no duplicates, no missing files). `ExactPartitionError` also extends `Error` and accepts a `message: string` constructor argument. `refinePeerDirectoryFragmentationError` produces a refined diagnostic when two peer trees share a leaf (for example `packages/core/src` and `packages/cli/src`) so the failure points at the colliding segment.

`makeUniqueDeterministicIds` resolves collisions by walking candidate sequences: `pathSlugOf` builds a slug from the file set, `candidateIdSequence` expands from right to left (`src` → `core-src` → `core-src-01`), and `pathSegmentsFor` plus `slugifySegment` and `slugifyIdSegment` produce the intermediate pieces. `stripNodeNextExtension` removes Node's `.js`/`.mjs`/`.cjs` suffix when resolving relative imports; `fileStem` and `idFor` (the test helper in `modules.test.ts`) give stable string keys for assertions.

## Role-aware classification and prioritization
<!-- lw:anchors packages/core/src/modules.ts#DEFAULT_PATH_ROLE_PATTERNS packages/core/src/modules.ts#DEFAULT_FLOW_SIGNAL_PATTERNS packages/core/src/modules.ts#matchesAnyPathPattern packages/core/src/modules.ts#classifyPathRole packages/core/src/modules.ts#classifyModuleRole packages/core/src/modules.ts#prioritizeModules packages/core/src/modules.ts#resolveModuleEdges packages/core/src/modules.ts#resolveRelativeImport -->

`DEFAULT_PATH_ROLE_PATTERNS` is the typed `Required<PathRoleConfig>` shipped as the default — it maps path globs to roles like `product`, `fixture`, `test`, etc. `DEFAULT_FLOW_SIGNAL_PATTERNS` is the matching `Required<FlowSignalConfig>` for flow detection. `matchesAnyPathPattern` is the predicate used by both classifiers. `classifyPathRole` resolves a single path to a role (using the default config when none is passed), and `classifyModuleRole` aggregates path roles into a single module role (with priority for product-shaped paths when both are present).

`prioritizeModules` ranks by inbound edge count, then by `symbolCount`, then by `id` for deterministic tie-breaking, and applies role-aware promotion so product modules outrank fixtures even with a smaller symbol count. `resolveModuleEdges` walks each module's relative imports via `resolveRelativeImport`, deduplicates parallel edges (multiple imports from `a` to `b` collapse to one), and drops self-loops. `resolveRelativeImport` delegates to `resolveImportEdges` from `./import-resolution.js`, which handles NodeNext extension stripping (via `stripNodeNextExtension`) and unknown-file pruning.

## Manifest snapshot test helper
<!-- lw:anchors packages/core/src/manifest.test.ts#writeLivewikiFile -->

The test helper `writeLivewikiFile` (in `manifest.test.ts`) is the only path used by the manifest test suite to place files under a temporary `repoRoot`:

```ts
async function writeLivewikiFile(relPath: string, content: string): Promise<void> {
  const abs = nodePath.join(repoRoot, relPath);
  await nodeFs.mkdir(nodePath.dirname(abs), { recursive: true });
  await nodeFs.writeFile(abs, content);
}
```

The tests rely on its deterministic write order (alphabetical walk order produces the same hash regardless of creation order) and on `nodeFs.rm(repoRoot, { recursive: true, force: true })` in `afterEach&#96; to isolate each case. The excerpt shown is truncated, so the page does not assert exhaustive test coverage beyond what is visible.

## Additional indexed symbols

<!-- lw:anchors packages/core/src/manifest.test.ts#writeLivewikiFile packages/core/src/markdown-mask.ts#boundedExcerpt packages/core/src/markdown-mask.ts#hasUnclosedFence packages/core/src/markdown-mask.ts#hasUnclosedMarkdown packages/core/src/markdown-mask.ts#maskCodeSpans packages/core/src/markdown-mask.ts#maskCodeSpansPreservingLength packages/core/src/markdown-mask.ts#maskInlineCode packages/core/src/markdown-mask.ts#unclosedMarkdownDiagnostic packages/core/src/mermaid-validator.ts#parseWithTemporaryDom packages/core/src/mermaid-validator.ts#restoreGlobal packages/core/src/mermaid-validator.ts#validateMermaidSyntax packages/core/src/modules.test.ts#idFor packages/core/src/modules.ts#DEFAULT_FLOW_SIGNAL_PATTERNS packages/core/src/modules.ts#DEFAULT_PATH_ROLE_PATTERNS packages/core/src/modules.ts#DuplicateModuleIdError packages/core/src/modules.ts#DuplicateModuleIdError.constructor packages/core/src/modules.ts#ExactPartitionError packages/core/src/modules.ts#ExactPartitionError.constructor packages/core/src/modules.ts#MODULE_SPLIT_DEFAULTS packages/core/src/modules.ts#SPLIT_AXIS_DISABLED packages/core/src/modules.ts#applyRefinedDisplayTitles packages/core/src/modules.ts#assertExactPathPartition packages/core/src/modules.ts#assertUniqueModuleIds packages/core/src/modules.ts#axisEnabled packages/core/src/modules.ts#candidateIdSequence packages/core/src/modules.ts#chunkFlatBucket packages/core/src/modules.ts#classifyModuleRole packages/core/src/modules.ts#classifyPathRole packages/core/src/modules.ts#countSymbols packages/core/src/modules.ts#dirToModuleId packages/core/src/modules.ts#fileStem packages/core/src/modules.ts#fitsLimits packages/core/src/modules.ts#groupPathsByNextSegment packages/core/src/modules.ts#identifyModulesHeuristic packages/core/src/modules.ts#makeUniqueDeterministicIds packages/core/src/modules.ts#matchesAnyPathPattern packages/core/src/modules.ts#normalizePresentationLabel packages/core/src/modules.ts#normalizeRefinedDisplayTitle packages/core/src/modules.ts#normalizeRepoPath packages/core/src/modules.ts#normalizeSplitLimits packages/core/src/modules.ts#pathSegmentsFor packages/core/src/modules.ts#pathSlugOf packages/core/src/modules.ts#prioritizeModules packages/core/src/modules.ts#refinePeerDirectoryFragmentationError packages/core/src/modules.ts#resolveModuleEdges packages/core/src/modules.ts#resolveRelativeImport packages/core/src/modules.ts#resolveSymbolCount packages/core/src/modules.ts#slugifyIdSegment packages/core/src/modules.ts#slugifySegment packages/core/src/modules.ts#splitOneModule packages/core/src/modules.ts#splitOversizedModules packages/core/src/modules.ts#stripNodeNextExtension -->

These anchors identify indexed symbols in this module that were not assigned to an earlier generated section.

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
- Flow: [CLI entry to core-src-04 export — semantic product flow](flows/cli-src-to-core-src-04.md)
- [Batch orchestration, configuration, index, and diagram generation](core-src-03.md) — dependency and dependent
- [Stage-5 planning, prompt templates, and safe disk I/O core](core-src-08.md) — dependency and dependent
- [Livewiki core source — export, flows, frontmatter, gitignore, hashes](core-src-04.md) — dependency and dependent
<!-- livewiki:navigate:end -->
