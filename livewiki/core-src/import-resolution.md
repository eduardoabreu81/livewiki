---
title: Import resolution — one resolver, one edge type
owner: generated
anchors:
  - packages/core/src/import-resolution.ts#directJavaFilesOf
  - packages/core/src/import-resolution.ts#expandWorkspaceGlob
  - packages/core/src/import-resolution.ts#hasPackageManifest
  - packages/core/src/import-resolution.ts#isPlainObject
  - packages/core/src/import-resolution.ts#joinRustPath
  - packages/core/src/import-resolution.ts#loadEffectiveTsconfig
  - packages/core/src/import-resolution.ts#loadGoModulePath
  - packages/core/src/import-resolution.ts#loadPackageTsconfig
  - packages/core/src/import-resolution.ts#loadRustCrateName
  - packages/core/src/import-resolution.ts#loadWorkspacePackages
  - packages/core/src/import-resolution.ts#mapCompiledTargetToSource
  - packages/core/src/import-resolution.ts#normalizeDirOption
  - packages/core/src/import-resolution.ts#parsePnpmWorkspaceGlobs
  - packages/core/src/import-resolution.ts#pythonSourceBaseDir
  - packages/core/src/import-resolution.ts#readPackageManifest
  - packages/core/src/import-resolution.ts#readTextIfExists
  - packages/core/src/import-resolution.ts#readWorkspaceGlobs
  - packages/core/src/import-resolution.ts#resolveExportsValue
  - packages/core/src/import-resolution.ts#resolveGoSpecifier
  - packages/core/src/import-resolution.ts#resolveImportEdges
  - packages/core/src/import-resolution.ts#resolveJavaSpecifier
  - packages/core/src/import-resolution.ts#resolvePackageTarget
  - packages/core/src/import-resolution.ts#resolvePythonModulePath
  - packages/core/src/import-resolution.ts#resolvePythonSpecifier
  - packages/core/src/import-resolution.ts#resolveRustModulePath
  - packages/core/src/import-resolution.ts#resolveRustSpecifier
  - packages/core/src/import-resolution.ts#resolveSpecifier
  - packages/core/src/import-resolution.ts#rustCrateSourceRoot
  - packages/core/src/import-resolution.ts#rustModuleDir
  - packages/core/src/import-resolution.ts#sourceCandidatesForCompiled
  - packages/core/src/import-resolution.ts#stringEntries
  - packages/core/src/import-resolution.ts#stripLeadingDotSlash
---

# Import resolution — one resolver, one edge type

This page documents the single internal operation that resolves an import specifier to a repo file and emits a `ResolvedImportEdge` — the unified record consumed by the module graph and the stage-5 flow detector.

## When to use this page

- **Trace an unresolved import** back through `resolveImportEdges` to find which branch (TS, Python, Go, Rust, Java) rejected it.
- **Add support for a new language or specifier shape** by following how each existing per-language resolver is dispatched and deduped.
- **Debug a compiled-target mismatch** by reading the `rootDir`/`outDir` layout loaders and the NodeNext extension-normalization map.
- **Audit the workspace-discovery contract** when a declared package seems missing from the resolver's input.

## How it fits

`packages/core/src/import-resolution.ts` sits inside `packages/core/src/` next to `imports.ts` (which extracts `ExtractedImport` occurrences from source files) and `modules.ts` (which holds the historical `resolveRelativeImport` reused for `./`/`../` specifiers). Both the module-graph builder in `modules.ts` and the stage-5 flow detector feed their `importsByFile` maps through `resolveImportEdges` so that the graph and the flow signals can never disagree about where an import landed — there is one resolver, one edge type. Inputs are produced by sibling loaders: `loadWorkspacePackages` reads the workspace map, `loadEffectiveTsconfig` reads each package's own tsconfig layout, `loadGoModulePath` reads `go.mod`, and `loadRustCrateName` reads `Cargo.toml`. Outputs are a sorted, deduped list of `ResolvedImportEdge` records.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-import-resolution.mmd
```

## Workspace discovery

The resolver refuses to infer packages by folder name: it only resolves against declared workspace members, so the first stage is loading that declaration.

<!-- lw:anchors packages/core/src/import-resolution.ts#loadWorkspacePackages packages/core/src/import-resolution.ts#readWorkspaceGlobs packages/core/src/import-resolution.ts#parsePnpmWorkspaceGlobs packages/core/src/import-resolution.ts#expandWorkspaceGlob packages/core/src/import-resolution.ts#hasPackageManifest packages/core/src/import-resolution.ts#readPackageManifest packages/core/src/import-resolution.ts#readTextIfExists packages/core/src/import-resolution.ts#stringEntries -->

`loadWorkspacePackages` is the public entry point and the orchestrator that stitches the workspace map together.

```ts
export async function loadWorkspacePackages(repoRoot: string): Promise<WorkspacePackage[]>
```

Takes a repo root path and returns the declared `WorkspacePackage[]`, sorted by name then dir with first-dir-wins dedupe.

It calls `readWorkspaceGlobs` to discover candidate globs, `expandWorkspaceGlob` to expand each glob into repo-relative directories that actually contain a `package.json`, and `readPackageManifest` to capture the declared `name`, `main`, and `exports` for each. A missing or unparseable workspace file silently yields an empty list — no edges, no crash. `stringEntries` is reused here to strip non-string and empty entries whenever a JSON or YAML array crosses from untyped disk content into the resolver.

```ts
async function readWorkspaceGlobs(absRoot: string): Promise<string[]>
```

`readWorkspaceGlobs` first looks for `pnpm-workspace.yaml`; on success it delegates to `parsePnpmWorkspaceGlobs`, a line-based YAML subset that only recognizes bare or quoted `- <glob>` lines under a top-level `packages:` key (flow-style, comments, and `!`-negations are outside the subset and are skipped). When the pnpm file is absent, it falls back to the root `package.json` `workspaces` field, accepting either an array of strings or `{ packages: [...] }`; every array entry is funneled through `stringEntries` so non-strings and empty strings are silently dropped. A parse error anywhere down the path yields `[]` rather than throwing.

```ts
async function hasPackageManifest(absRoot: string, dir: string): Promise<boolean>
async function readPackageManifest(absRoot: string, dir: string): Promise<Record<string, unknown> | null>
```

`hasPackageManifest` answers whether a directory contains a parseable `package.json`, used as a filter inside `expandWorkspaceGlob`. `readPackageManifest` reads and parses that manifest, returning the object on success and `null` on missing file or parse failure — both rely on `readTextIfExists` for the disk read.

```ts
async function readTextIfExists(absPath: string): Promise<string | null>
```

Takes an absolute file path and returns its UTF-8 text, or `null` if the read fails (any error class — the contract treats "not on disk" and "unreadable" the same way).

`expandWorkspaceGlob` is the only fan-out point in workspace discovery. It supports two glob shapes — a literal directory, and a single trailing `/*` one-level expansion (`packages/*`). Anything more complex (`**`, mid-path `*`, `?`, character classes) returns `[]` rather than throwing; negation entries are dropped by `parsePnpmWorkspaceGlobs` upstream. The literal branch is a single `hasPackageManifest` check; the `/*` branch reads the parent directory and keeps every direct child that is itself a directory containing a `package.json`.

```ts
async function expandWorkspaceGlob(absRoot: string, glob: string): Promise<string[]>
```

Takes an absolute repo root and one workspace glob, and returns the repo-relative package directories that glob names (only literal or one-level `/*` shapes produce output).

```ts
function stringEntries(values: unknown[]): string[]
```

Takes any list and returns only the entries that are non-empty strings — the small guard reused at every JSON/YAML array boundary.

## Per-package TypeScript layout

The resolver maps compiled `.js` output back to `.ts`/`.tsx` source per package, so each package must independently expose a usable `rootDir`/`outDir` pair from its own `tsconfig.json` — there is no shared layout, no `extends` chain, and no `tsconfig.base.json` fallback.

`loadEffectiveTsconfig` is the orchestrator: it iterates over the declared workspace packages and calls `loadPackageTsconfig` for each, producing a `Map` keyed by `WorkspacePackage.dir`. When NO package yields a usable layout, the whole call returns `undefined` — and a `tsconfig` of `undefined` is what tells `mapCompiledTargetToSource` to skip the compiled-target branch entirely and try only the literal target.

<!-- lw:anchors packages/core/src/import-resolution.ts#loadEffectiveTsconfig packages/core/src/import-resolution.ts#loadPackageTsconfig packages/core/src/import-resolution.ts#normalizeDirOption packages/core/src/import-resolution.ts#isPlainObject -->

```ts
export async function loadEffectiveTsconfig(
  repoRoot: string,
  workspacePackages: WorkspacePackage[],
): Promise<EffectiveTsconfigs | undefined>
```

Takes the repo root and the list of declared packages, and returns a per-package map of effective layouts, or `undefined` when nothing was readable.

```ts
export async function loadPackageTsconfig(
  repoRoot: string,
  pkgDir: string,
): Promise<PackageTsconfig | undefined>
```

Takes the repo root and one repo-relative package directory, and returns the effective `{ rootDir, outDir }` or `undefined` if the file is unreadable, unparseable, or missing either value. The function reads a single `<pkgDir>/tsconfig.json`, parses it as plain JSON (JSONC comments are outside this subset and yield `undefined`), and reads ONLY the direct `compilerOptions.rootDir` and `compilerOptions.outDir`. Either value missing or malformed disables that package's compiled-target mapping entirely — partial layouts are not tolerated.

```ts
function normalizeDirOption(value: unknown): string | undefined
```

Takes any value and returns the cleaned directory string, or `undefined` if the input is unusable. It runs on each compiler-option value: it rejects non-strings, strips a leading `./`, trims trailing slashes, and collapses `""` to `undefined` — so `./src/` and `src` both yield `src`, and a stray `"."` or empty string means "no layout value".

```ts
function isPlainObject(value: unknown): value is Record<string, unknown>
```

Takes any value and narrows it to `Record<string, unknown>` when it is a non-array, non-null object — used in three places here: confirming `compilerOptions` is an object, parsing each `package.json` body, and inspecting `pkg.exports` shapes.

## The core resolver and its dispatch

`resolveImportEdges` is the single funnel every specifier must pass through. It is pure — no disk I/O — and consumes pre-loaded workspace packages, per-package tsconfigs, the Go module path, and the Rust crate name.

<!-- lw:anchors packages/core/src/import-resolution.ts#resolveImportEdges -->

```ts
export function resolveImportEdges(opts: {
  importsByFile: Map<string, ExtractedImport[]>;
  knownFiles: ReadonlySet<string>;
  workspacePackages: WorkspacePackage[];
  tsconfig?: EffectiveTsconfigs | undefined;
  goModulePath?: string | null | undefined;
  rustCrateName?: string | null | undefined;
}): ResolvedImportEdge[]
```

Takes the parsed imports grouped by source file, the set of known repo files, the declared workspace packages, optional per-package tsconfig map, optional Go module path, and optional Rust crate name; returns a sorted, deduped list of `ResolvedImportEdge` records with self-edges dropped.

The function sorts workspace packages longest-name-first so `@acme/core-utils` wins over `@acme/core` when both are declared (deterministic node-style longest-prefix match). For each `ExtractedImport` it dispatches on `kind`: Python, Go, Rust, and Java get their own per-language resolvers; everything else (TS/JS relative and bare specifiers) falls through `resolveSpecifier`. Self-edges (`toFile === fromFile`) are dropped, and the resulting edges are deduped by a `fromFile\0toFile\0source` key before being sorted lexicographically by `fromFile`, then `toFile`, then `source`.

## TypeScript / JavaScript specifier resolution

Relative (`./`, `../`) and bare workspace specifiers land here, and this is where the compiled-output-to-source mapping lives. `resolveSpecifier` runs first; it delegates to `resolveRelativeImport` for relative paths and to `resolvePackageTarget` for bare specifiers; the result then passes through `mapCompiledTargetToSource` to apply NodeNext extension normalization when the package has an effective layout.

<!-- lw:anchors packages/core/src/import-resolution.ts#resolveSpecifier packages/core/src/import-resolution.ts#resolvePackageTarget packages/core/src/import-resolution.ts#resolveExportsValue packages/core/src/import-resolution.ts#mapCompiledTargetToSource packages/core/src/import-resolution.ts#sourceCandidatesForCompiled packages/core/src/import-resolution.ts#stripLeadingDotSlash -->

```ts
function resolveSpecifier(
  fromFile: string,
  spec: string,
  packages: WorkspacePackage[],
  tsconfigs: EffectiveTsconfigs | undefined,
  knownFiles: ReadonlySet<string>,
): string | null
```

Takes the importing file's repo-relative path, the literal specifier text, the sorted workspace packages, the per-package tsconfig map, and the known-file set; returns one repo-relative target path or `null` when the specifier stays external.

The function's own contract is small. It rejects empty specifiers, `node:*` builtins, and absolute paths up front — none of those ever produce internal edges. Relative specifiers are handed to `resolveRelativeImport` (the historical module-graph helper, reused rather than duplicated). Bare specifiers must match a declared `WorkspacePackage.name` exactly or with a `/` subpath; an undeclared name that merely "looks like" a package folder is never inferred. Once a package matches, the subpath is fed into `resolvePackageTarget`, which inspects `pkg.exports` or falls back to `pkg.main` (then `index.js`) for the bare-name case.

```ts
function resolvePackageTarget(pkg: WorkspacePackage, subpath: string): string | null
```

Takes the matched package and a `./`-prefixed subpath (or `"."` for bare); returns the package-relative compiled target, or `null` when unsupported. It encodes the supported subset of the `package.json` `exports` field. An exports map MUST be a plain object; when the requested subpath key is present, its value is decoded by `resolveExportsValue`. When the exports map exists but the requested key is absent, the function returns `null` — `exports` encapsulates, so the `main` fallback does NOT kick in. Without an exports map, only the bare-name case (`subpath === "."`) can resolve, via `main` then `"index.js"`; any subpath without an exports map stays external.

```ts
function resolveExportsValue(value: unknown): string | null
```

Takes a single `exports` entry (a string or a condition object) and returns the first supported condition's path, stripped of any leading `./`. A string value is taken verbatim; an object is checked for an `import` string first, then a `default` string.

```ts
function stripLeadingDotSlash(p: string): string
```

Takes a path string and returns it with any single leading `./` removed — the tiny helper used everywhere `pkg.main` or an exports string flows back into a path.

`mapCompiledTargetToSource` is where the strict, per-package compiled-output mapping lives. The literal target (`<pkgDir>/<target>`) is always a candidate. When the package has an effective layout AND the target lives under `outDir`, the resolver rewrites `<pkgDir>/<outDir>/<rel>.<ext>` to its `<pkgDir>/<rootDir>/<rel>` equivalents via `sourceCandidatesForCompiled`, which generates NodeNext-family extension swaps: `.js` → `.ts` + `.tsx`, `.jsx` → `.tsx`, `.mjs` → `.mts`, `.cjs` → `.cts`; any other extension yields no mapped candidate. EXACTLY ONE of the candidates must be present in `knownFiles` — zero matches and ambiguous matches both return `null`. A package with no layout never gets the rewrite branch: it gets the literal target only (strict, no guessing, no defaults).

```ts
function mapCompiledTargetToSource(
  pkgDir: string,
  target: string,
  layout: PackageTsconfig | undefined,
  knownFiles: ReadonlySet<string>,
): string | null
```

Takes the package directory, the package-relative compiled target, the package's effective layout (or `undefined`), and the known-file set; returns the single mapped source file, or `null` if no candidate or more than one matches.

```ts
function sourceCandidatesForCompiled(sourcePath: string): string[]
```

Takes a source path (the literal target's `rootDir` equivalent) and returns the candidate extension swaps; an unrecognized extension yields `[]`.

## Python specifier resolution

Python was previously unimplemented at this layer — `imports.ts` extracted `py-import`/`py-from` correctly, but the occurrences fell through the TS-shaped branches and produced no internal edges. `resolvePythonSpecifier` closes that gap, dispatching on the `ExtractedImport.kind`.

<!-- lw:anchors packages/core/src/import-resolution.ts#resolvePythonSpecifier packages/core/src/import-resolution.ts#pythonSourceBaseDir packages/core/src/import-resolution.ts#resolvePythonModulePath -->

```ts
function resolvePythonSpecifier(
  fromFile: string,
  imp: ExtractedImport,
  knownFiles: ReadonlySet<string>,
): string[]
```

Takes the importing file's path, the `ExtractedImport` (kind and source/names), and the known-file set; returns one or more resolved target paths, or `[]` when the specifier stays external.

The function first computes the base directory with `pythonSourceBaseDir`: a specifier that does NOT start with `.` is an absolute Python import, so dots are turned into path separators from the repo root (no `./`/`../` prefix, never relative to the importing file). A leading-dot specifier is a RELATIVE import — one dot means the importing file's own directory (mirroring `from . import x`); each additional dot climbs one more directory. The remaining dotted segments (if any) join the surviving ancestor parts. A relative specifier that climbs above the repo root returns `null` here and short-circuits the rest of the Python path.

For a `py-import`, the whole dotted path names ONE module and is tried as `<base>.py` then `<base>/__init__.py`. For a `py-from`, the `source` is the package/module being imported FROM and `names` are the imported symbols; each name is tried FIRST as a submodule file of that path (`<base>/<name>.py` or `<base>/<name>/__init__.py`) — the common case for a package re-exporting its own submodules. If NO name resolves as its own submodule file, the "from" target itself is tried once as a fallback edge. `as`-aliases are stripped, and the wildcard `*` is skipped.

```ts
function pythonSourceBaseDir(fromFile: string, spec: string): string | null
```

Takes the importing file's path and the dotted specifier; returns the repo-relative directory path (no extension), or `null` when a relative specifier climbs above the repo root.

```ts
function resolvePythonModulePath(dir: string, knownFiles: ReadonlySet<string>): string | null
```

Takes a directory path and the known-file set; returns `<dir>.py` or `<dir>/__init__.py` whichever is known, or `null` if neither exists.

## Go specifier resolution

Go differs from TS/Python/Rust: the module name is taken from the root `go.mod`, and a Go package is a directory — so a Go import maps to the direct `.go` files of that directory.

<!-- lw:anchors packages/core/src/import-resolution.ts#loadGoModulePath packages/core/src/import-resolution.ts#resolveGoSpecifier -->

```ts
export async function loadGoModulePath(repoRoot: string): Promise<string | null>
```

Takes the repo root and returns the `module` directive from the root `go.mod`, or `null` when go.mod is missing, unreadable, or has no `module` line.

```ts
function resolveGoSpecifier(
  spec: string,
  knownFiles: ReadonlySet<string>,
  goModulePath: string | null,
): string[]
```

Takes the literal specifier text, the known-file set, and the repo's Go module path; returns the direct `.go` files of the imported directory, or `[]` when the specifier stays external.

When `goModulePath` is `null` or empty, every import stays external — `resolveGoSpecifier` short-circuits before walking `knownFiles`. The specifier is then checked in two forms: equal to `goModulePath` (the root package), or `<goModulePath>/<sub>` for a sub-package. Any other prefix — third-party modules, stdlib like `fmt`, or a subpath with no known `.go` files — returns `[]`. The matching pass keeps only files ending in `.go`, starting with the resolved directory prefix, and containing no further `/` (nested subdirectories are NOT included: an import names exactly one directory). `_test.go` files are kept — they belong to the same package. The matches are sorted before return.

## Rust specifier resolution

Rust is the most structured of the per-language paths because `rust-use` paths are anchored by a leading segment (`crate`, `self`, `super`, or the package's own name), with the rest resolved longest-prefix-first against `<path>.rs` / `<path>/mod.rs`.

<!-- lw:anchors packages/core/src/import-resolution.ts#loadRustCrateName packages/core/src/import-resolution.ts#resolveRustSpecifier packages/core/src/import-resolution.ts#rustModuleDir packages/core/src/import-resolution.ts#rustCrateSourceRoot packages/core/src/import-resolution.ts#resolveRustModulePath packages/core/src/import-resolution.ts#joinRustPath -->

```ts
export async function loadRustCrateName(repoRoot: string): Promise<string | null>
```

Takes the repo root and returns the `[package] name = "..."` value from the root `Cargo.toml`, or `null` when Cargo.toml is missing, unreadable, or has no package name. The function walks the file line-by-line, tracking a single `inPackage` flag that is set when a top-level `[package]` header (with optional trailing `#` comment) is seen and cleared by any other top-level section header. Inside `[package]`, the first `name = "..."` line wins. The crate name is purely an alias for `crate::`; `crate::`/`self::`/`super::` resolution does not depend on it.

```ts
function resolveRustSpecifier(
  fromFile: string,
  imp: ExtractedImport,
  knownFiles: ReadonlySet<string>,
  rustCrateName: string | null,
): string[]
```

Takes the importing file's path, the `ExtractedImport`, the known-file set, and the crate name (or `null`); returns the resolved module file, or `[]` when the specifier stays external.

`resolveRustSpecifier` first distinguishes `rust-mod` declarations from `rust-use` paths. A `rust-mod` declaration (`mod foo;`) always resolves relative to the importing file's module directory (see `rustModuleDir` below), and its body is treated as a single path segment fed into `resolveRustModulePath`. A `rust-use` path is split on `::`, with the first segment selecting the anchor:

- `crate` → the crate source root (`rustCrateSourceRoot`).
- `self` → the importing file's module directory.
- One or more `super` segments → climb one module directory per `super`; climbing above the repo root returns `[]`.
- The crate's own name (hyphens read as underscores — the form integration tests use) → the crate source root, treated as a `crate::` alias.
- Anything else (external crates, `std`, `core`, `alloc`) → `[]`, stays external.

The remaining segments are walked longest-prefix-first against `resolveRustModulePath`, so `crate::server::handler` resolves to `server/handler.rs` (or `server/handler/mod.rs`) when present, and `crate::server::Server` (a trailing item name) still resolves to the module file owning `crate::server`. EXACTLY ONE matching module file is accepted — `[]` when no prefix matches.

```ts
function rustModuleDir(file: string): string
```

Takes a repo-relative Rust file path and returns the directory its `mod` declarations resolve against. `main.rs`, `lib.rs`, and `mod.rs` live in their own directory; any other file (`src/server.rs`) lives in a directory named after its stem (`src/server`).

```ts
function rustCrateSourceRoot(knownFiles: ReadonlySet<string>): string
```

Takes the known-file set and returns the crate source root directory, applying Cargo convention: when `src/lib.rs` or `src/main.rs` is present in `knownFiles`, the crate source root is `src`; otherwise it falls back to the repo root (`""`).

```ts
function resolveRustModulePath(
  pathNoExt: string,
  knownFiles: ReadonlySet<string>,
): string | null
```

Takes an extensionless path and the known-file set; returns the matching `.rs` or `/mod.rs` path, or `null` when neither is known — the Rust analog of the Python module resolver: `<path>.rs` first, then `<path>/mod.rs`.

```ts
function joinRustPath(base: string, rel: string): string
```

Takes a base directory and a relative segment, and returns their `/`-joined form (or just `rel` when `base` is empty) — the path-composition helper that handles the empty-base case cleanly (no leading `/`).

## Java specifier resolution

Java is the opposite of Go and Rust: a Java import's dotted path is already a repo-relative directory path under the source root, so no manifest is read (there is no `loadJavaXxx` loader). The package IS the directory.

<!-- lw:anchors packages/core/src/import-resolution.ts#resolveJavaSpecifier packages/core/src/import-resolution.ts#directJavaFilesOf -->

```ts
function resolveJavaSpecifier(spec: string, knownFiles: ReadonlySet<string>): string[]
```

Takes the literal dotted specifier and the known-file set; returns the direct `.java` files of the matched package, or `[]` when the specifier stays external.

The function first collects every known `.java` file; if there are none, every Java import stays external. Then it picks the FIRST candidate source root (priority order: `src/main/java`, then `src/`, then the repo root) that actually contains at least one known `.java` file — the same root is used for every import in the run, and any source root with no `.java` files is skipped.

From that base, the function walks dotted-segment prefixes from LONGEST to shortest and asks `directJavaFilesOf` whether any prefix names a directory that directly holds `.java` files. The walk uniformly handles three import shapes through the same prefix-trimming logic: a plain import `a.b.C` drops the trailing type name to `a/b`; a static import `a.b.C.m` drops both the type and the member to `a/b`; a wildcard import `a.b` matches `a/b` directly. The edge targets the package's direct `.java` files (non-recursive, like Go). As a special case, a single-segment import (`import Foo;`) is treated as naming a type in the default package — its package directory IS the source root itself.

`java.*`/`javax.*` are NOT a special case in the code path: they simply have no matching prefix under the chosen source root and therefore stay external. Anything mapping to no repo package directory produces no edge.

```ts
function directJavaFilesOf(dir: string, javaFiles: string[]): string[]
```

Takes a package directory and the pre-filtered `.java` file list; returns the files directly inside that directory (no nested subpackages), sorted.

## Tests

Covered by `packages/core/src/import-resolution.test.ts` (same-name test file on disk).
