---
title: Module graph primitives for the livewiki batch pipeline
owner: generated
anchors:
  - packages/core/src/modules.ts#DEFAULT_FLOW_SIGNAL_PATTERNS
  - packages/core/src/modules.ts#DEFAULT_PATH_ROLE_PATTERNS
  - packages/core/src/modules.ts#DuplicateModuleIdError
  - packages/core/src/modules.ts#DuplicateModuleIdError.constructor
  - packages/core/src/modules.ts#ExactPartitionError
  - packages/core/src/modules.ts#ExactPartitionError.constructor
  - packages/core/src/modules.ts#assertExactPathPartition
  - packages/core/src/modules.ts#assertUniqueModuleIds
  - packages/core/src/modules.ts#candidateIdSequence
  - packages/core/src/modules.ts#classifyModuleRole
  - packages/core/src/modules.ts#classifyPathRole
  - packages/core/src/modules.ts#makeUniqueDeterministicIds
  - packages/core/src/modules.ts#matchesAnyPathPattern
  - packages/core/src/modules.ts#normalizeRepoPath
  - packages/core/src/modules.ts#pathSegmentsFor
  - packages/core/src/modules.ts#pathSlugOf
  - packages/core/src/modules.ts#prioritizeModules
  - packages/core/src/modules.ts#resolveModuleEdges
  - packages/core/src/modules.ts#resolveRelativeImport
  - packages/core/src/modules.ts#slugifySegment
  - packages/core/src/modules.ts#stripNodeNextExtension
---

# Module graph primitives for the livewiki batch pipeline

This page is the single source of truth for the batch pipeline's module graph — the data shape, the validation gates, the import-to-edge resolution, the path-role classifier, and the deterministic ID allocator that guarantees every module gets a globally unique slug before any `livewiki/<id>.md` file is written.

## When to use this page

- **Audit the partition invariants** that every batch run must satisfy before module construction advances — what `assertExactPathPartition` enforces and why it throws `ExactPartitionError`.
- **Trace how file-level imports become module-level edges** — when `resolveModuleEdges` is the right entry point versus reusing file edges already resolved by `import-resolution.ts`.
- **Understand the path-role classifier** that decides whether a path is `product`, `test`, `fixture`, `tooling`, or `docs`, and how that classification influences prioritization and zero-token auxiliary channels.
- **Investigate a `livewiki/<id>.md` collision** — how `makeUniqueDeterministicIds` expands colliding IDs right-to-left along the path, and how `assertUniqueModuleIds` is the last barrier before disk.

## How it fits

The file lives at `packages/core/src/modules.ts` and is the shared vocabulary for everything later in the pipeline that thinks in modules rather than files. Stage 2 (`page-units.ts`) constructs deterministic `Module` objects; this module then asserts that the constructed modules form an exact partition of the expected file inventory, resolves their import graph, classifies each by path role, sorts them by centrality, and finally rewrites colliding IDs into globally unique slugs. Widgets, generators, and later stages consume the resulting list without ever touching the file-level resolver again.

The module reuses — and never duplicates — the file-level resolver from `import-resolution.ts` (`resolveImportEdges`) and the gitignore-style matcher from `ignore`. It also depends on `hashes.ts` for the SHA-256 fallback suffix used by `makeUniqueDeterministicIds`. Calls that already resolved file edges earlier in the pipeline (batch stage 3, `init` buildPlan) pass them through; otherwise the module resolves them here with an empty workspace map, which preserves the historical behavior exactly.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-modules.mmd
```

## Path normalization
<!-- lw:anchors packages/core/src/modules.ts#normalizeRepoPath -->

Every other function in this module compares paths through one canonical shape, so the first rule of the file is the normalization helper.

```ts
export function normalizeRepoPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}
```

`normalizeRepoPath` takes a repo-relative path string and returns the same path with forward slashes and no leading `./`. It is the basis for every equality check between two paths in this module: `assertExactPathPartition` runs both the expected inventory and the module paths through it before the comparison. The visible implementation only handles a Windows-style backslash and a literal `./` prefix; other shapes (absolute paths, trailing-slash directories, trailing whitespace) are not normalized by this helper.

## Partition validation
<!-- lw:anchors packages/core/src/modules.ts#ExactPartitionError packages/core/src/modules.ts#ExactPartitionError.constructor packages/core/src/modules.ts#assertExactPathPartition -->

The partition invariant is the gate that decides whether the pipeline can proceed.

```ts
export function assertExactPathPartition(
  modules: Module[],
  expectedPaths: Iterable<string>,
): void
```

`assertExactPathPartition` takes a list of `Module` objects and an iterable of expected repository paths, and returns nothing on success — but it throws `ExactPartitionError` if any invariant is violated. Specifically: every module must be non-empty, every path inside every module must appear in the expected inventory after normalization, no path may appear in two modules, and every expected path must appear in exactly one module. Missing paths are reported up to a sample of five (sorted lexicographically) so the error message stays bounded even for large inventories.

```ts
export class ExactPartitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExactPartitionError";
  }
}
```

`ExactPartitionError.constructor` is the typed error constructor that `assertExactPathPartition` throws. It carries the supplied message and sets `name = "ExactPartitionError"` so the pipeline can branch on `instanceof` rather than string matching. The visible failure modes are: empty module, unknown path inside a module, duplicate path across modules, or missing path from the inventory.

## Module graph edges
<!-- lw:anchors packages/core/src/modules.ts#resolveModuleEdges packages/core/src/modules.ts#resolveRelativeImport packages/core/src/modules.ts#stripNodeNextExtension -->

Import resolution sits on top of the project's single file-level resolver — there is no second resolver hidden inside this module.

```ts
export function resolveModuleEdges(
  modules: Module[],
  importsByFile: Map<string, ExtractedImport[]>,
  knownFiles: Set<string>,
  resolvedEdges?: ResolvedImportEdge[],
): ModuleGraphEdge[]
```

`resolveModuleEdges` takes a module list, a per-file map of extracted imports, a set of known repository files, and an optional pre-resolved list of file-level edges; it returns the deduplicated, sorted list of `ModuleGraphEdge` objects. The function first builds a path-to-moduleId map, then either reuses the supplied `resolvedEdges` or falls back to `resolveImportEdges` with an empty workspace map — which is the historical behavior and produces edges only for relative imports pointing at files in `knownFiles`. For each file edge it discards anything whose `fromFile` is not in a module, anything whose `toFile` is not in a module, and any self-loop where both ends resolve to the same module. The surviving edges are deduplicated by a `from→to` key and sorted by `from` then `to` for deterministic output.

```ts
export function resolveRelativeImport(
  fromFile: string,
  importPath: string,
  knownFiles: ReadonlySet<string>,
): string | null
```

`resolveRelativeImport` takes a source file path, a relative import specifier (e.g. `./foo`, `../bar`), and a set of known files, and returns the resolved repository-relative path as a string, or `null` when no candidate matches. It walks `fromFile` to its directory, applies the `./` and `../` segments of the import, strips NodeNext-style `.js` / `.jsx` / `.mjs` / `.cjs` extensions, and then probes a fixed list of candidate extensions (`.ts`, `.tsx`, `.js`, `.jsx`, `.py`) plus barrel variants (`index.ts`, `index.tsx`, `index.js`, `index.jsx`, `__init__.py`). The first candidate present in `knownFiles` wins.

```ts
function stripNodeNextExtension(p: string): string {
  const idx = p.lastIndexOf("/");
  const base = idx === -1 ? p : p.slice(idx + 1);
  const dotIdx = base.lastIndexOf(".");
  if (dotIdx <= 0) return p;
  const ext = base.slice(dotIdx + 1);
  if (ext === "js" || ext === "jsx" || ext === "mjs" || ext === "cjs") {
    return p.slice(0, p.length - (base.length - dotIdx));
  }
  return p;
}
```

`stripNodeNextExtension` is the internal helper that takes a path string and returns it with the trailing `.js` / `.jsx` / `.mjs` / `.cjs` extension stripped from the basename. It is a no-op for paths that already lack an extension or whose final extension is something else (for example `.ts`); the only file-layout trick it does is also stripping `index.js` so the barrel mappings in `resolveRelativeImport` can re-append `${base}/index.*`. It is not exported.

## Path role classification
<!-- lw:anchors packages/core/src/modules.ts#DEFAULT_PATH_ROLE_PATTERNS packages/core/src/modules.ts#classifyPathRole packages/core/src/modules.ts#classifyModuleRole packages/core/src/modules.ts#matchesAnyPathPattern -->

Path role is a documentation-only derivation from a file path — it influences grouping and ranking, never file selection or coverage.

```ts
export const DEFAULT_PATH_ROLE_PATTERNS: Required<PathRoleConfig> = {
  testPatterns: [
    "**/*.test.*",
    "**/*.spec.*",
    "**/__tests__/**",
    "**/test_*.py",
    "**/*_test.py",
    "**/*_test.go",
    "**/*Test.java",
    "**/*Tests.java",
    "**/*Test.kt",
    "**/*Spec.kt",
    "**/*Spec.scala",
    "**/*Suite.scala",
    "**/*Tests.cs",
    "**/src/test/java/**",
    "**/src/test/kotlin/**",
  ],
  fixturePatterns: [
    "**/test/fixtures/**",
    "**/tests/fixtures/**",
    "**/__tests__/fixtures/**",
    "**/__fixtures__/**",
    "**/testdata/**",
  ],
  toolingPatterns: ["**/scripts/**", "**/tools/**", "**/benchmarks/**"],
  docsPatterns: ["docs/**", "**/docs/**"],
};
```

`DEFAULT_PATH_ROLE_PATTERNS` is the built-in gitignore-style pattern set the classifier falls back to when a `PathRoleConfig` does not override a category. It deliberately keeps the test patterns conservative (no bare `tests/` directory, no Rust `tests/` layout) so the default behavior matches the historical product-classification for repositories that have no fixture/tooling/docs trees. The literal patterns above are the only defaults; everything else is opt-in via `pathRoles` configuration.

```ts
export function classifyPathRole(path: string, config?: PathRoleConfig): PathRole
```

`classifyPathRole` takes a single path and an optional `PathRoleConfig`, and returns one of `"product"`, `"test"`, `"fixture"`, `"tooling"`, or `"docs"`. It evaluates fixtures first, then tests, then tooling, then docs — so a fixture that also matches a test filename convention stays a fixture. Config patterns fully replace the default array for any category they supply; an empty pattern list disables that category. Anything that matches none of the patterns is `"product"`, which is also the role a repo with no fixtures or tooling sees.

```ts
export function classifyModuleRole(module: Module, config?: PathRoleConfig): PathRole
```

`classifyModuleRole` takes a `Module` and an optional `PathRoleConfig`, and returns the module's role by majority vote over its paths. Ties are broken by a fixed priority list (`product > docs > tooling > fixture > test`), so a folder that mixes product code with same-count test files is classified as `product` — its page documents the product code, and test files are covered through deterministic zero-token auxiliary channels rather than through this module.

```ts
export function matchesAnyPathPattern(path: string, patterns: string[]): boolean
```

`matchesAnyPathPattern` is the shared gitignore-style matcher that both `classifyPathRole` and the stage-5 flow-signal detector (`flows.ts`) use. It takes a path and a list of patterns, normalizes the path to forward slashes, and returns `false` immediately when the pattern list is empty; otherwise it delegates to the `ignore` package with combined-list semantics (later negations apply).

## Stage-5 flow signal defaults
<!-- lw:anchors packages/core/src/modules.ts#DEFAULT_FLOW_SIGNAL_PATTERNS -->

Flow signals are the inputs the stage-5 semantic-layer detector consumes; the defaults live next to the path-role patterns so both kinds of configuration are colocated.

```ts
export const DEFAULT_FLOW_SIGNAL_PATTERNS: Required<FlowSignalConfig> = {
  entryPatterns: ["bin/**", "cmd/**", "**/cli.*", "**/main.*", "**/server.*", "**/app.*"],
  persistencePatterns: [
    "**/db.*",
    "**/database/**",
    "**/store/**",
    "**/state/**",
    "**/persistence/**",
    "**/repository/**",
  ],
  persistenceImportPatterns: [],
};
```

`DEFAULT_FLOW_SIGNAL_PATTERNS` is the built-in pattern set for the stage-5 flow-candidate signals. Entry patterns feed the entry-point signal; persistence patterns feed the persistence/files signal; `persistenceImportPatterns` is empty by default so the detector does not guess package names. Per-category replacement semantics match `PathRoleConfig` — a supplied category replaces its built-in patterns, an empty array disables it.

## Stage-4 prioritization
<!-- lw:anchors packages/core/src/modules.ts#prioritizeModules -->

The prioritization step feeds stage 4 by sorting modules so the first ones written are the ones most worth writing first.

```ts
export function prioritizeModules(
  modules: Module[],
  edges: ModuleGraphEdge[],
  pathRoleConfig?: PathRoleConfig,
): Module[]
```

`prioritizeModules` takes a list of modules, the module-level edges produced by `resolveModuleEdges`, and an optional `PathRoleConfig`, and returns a new list with no modules dropped — only reordered. Each module receives a `roleRank` of `0` for `product` and `1` for everything else, and a score of `indegree * 1000 + symbolCount`. Sorting is `roleRank` ascending, then score descending, then `id.localeCompare` for stability. The `pathRoleConfig` is entirely optional: a project with no fixture/tooling/docs paths produces an ordering identical to the pre-role versions of this function.

## Globally-unique deterministic IDs
<!-- lw:anchors packages/core/src/modules.ts#makeUniqueDeterministicIds packages/core/src/modules.ts#assertUniqueModuleIds packages/core/src/modules.ts#DuplicateModuleIdError packages/core/src/modules.ts#DuplicateModuleIdError.constructor packages/core/src/modules.ts#candidateIdSequence packages/core/src/modules.ts#pathSegmentsFor packages/core/src/modules.ts#pathSlugOf packages/core/src/modules.ts#slugifySegment -->

The ID allocator is the difference between a pipeline that produces one `livewiki/<id>.md` per module and one that overwrites its own files.

```ts
export function makeUniqueDeterministicIds(modules: Module[]): Module[]
```

`makeUniqueDeterministicIds` takes a list of modules (each already carrying a caller-supplied candidate identifier in `m.id`) and returns a new list where every `id` is globally unique. The algorithm works in waves over a candidate sequence per module: the first candidate is always `m.id` (so an already-unique refined ID is preserved), and subsequent candidates are right-to-left path expansions (`leaf`, `parent-leaf`, `grandparent-parent-leaf`, ...). At each wave, a group is locked only when (a) it contains exactly one module, and (b) its candidate is not already taken from a previous wave; otherwise its members advance to the next level or fall through to the fallback. Modules whose entire path is exhausted and still collide get a stable fallback: the full-path slug plus a SHA-256 slice of the path string plus a counter. The returned modules are fresh objects — the input is never mutated.

```ts
function candidateIdSequence(m: Module): string[]
```

`candidateIdSequence` takes a `Module` and returns the ordered candidate list used by `makeUniqueDeterministicIds`. The first entry is `m.id`; subsequent entries are suffix-joined path expansions starting from the leaf and growing toward the root, each appended only if it differs from the previous one. A module whose `id` already ends in `-tests` keeps that suffix through every expansion so that co-located product/test modules under a colliding leaf directory do not lose the "tests" hint.

```ts
function pathSegmentsFor(m: Module): string[]
```

`pathSegmentsFor` takes a `Module` and returns the directory segments of its first path, left-to-right and without the file basename. A path with no slash (such as a root-level `index.ts`) returns an empty list, which is why the candidate sequence for such a module collapses to just `m.id`.

```ts
function pathSlugOf(m: Module): string
```

`pathSlugOf` is the fallback base: it takes a `Module` and returns the full path slug (segments joined by `-` after `slugifySegment`). When the candidate sequence is exhausted, the fallback uses this slug plus a hash so that two modules with the same path but different `id` strings still get distinct page identifiers.

```ts
function slugifySegment(s: string): string
```

`slugifySegment` takes a single path segment and returns its lowercase, ASCII-only slug form: it normalizes accented characters to their NFD form, strips diacritics, drops non-word characters except hyphens, and trims leading/trailing hyphens.

```ts
export function assertUniqueModuleIds(modules: Module[]): void
```

`assertUniqueModuleIds` is the last barrier before stage 4 writes to disk. It takes the list of modules produced by `makeUniqueDeterministicIds` and returns nothing on success; on any duplicate it throws `DuplicateModuleIdError` with a sorted list of offending IDs and up to three sample paths per ID. The error message explicitly states that the run must abort — this is a hard pipeline error, not a recoverable condition.

```ts
export class DuplicateModuleIdError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DuplicateModuleIdError";
  }
}
```

`DuplicateModuleIdError.constructor` is the typed error constructor used by `assertUniqueModuleIds`. It carries the supplied message and sets `name = "DuplicateModuleIdError"` so the caller can `instanceof`-check it. The intended use is to terminate the run with a non-zero status before any `livewiki/<id>.md` write, so a regression that breaks uniqueness does not silently overwrite files.

## Tests

Covered by `packages/core/src/modules.test.ts` (same-name test file on disk).
