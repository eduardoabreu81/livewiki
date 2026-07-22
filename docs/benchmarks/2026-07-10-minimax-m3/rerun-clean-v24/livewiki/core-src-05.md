---
title: core/src indexer, init, and import resolution
owner: generated
anchors:
  - packages/core/src/ignores-propagation.test.ts#FullMockLlm
  - packages/core/src/ignores-propagation.test.ts#FullMockLlm.generate
  - packages/core/src/ignores-propagation.test.ts#activeFilePaths
  - packages/core/src/ignores-propagation.test.ts#writeIgnores
  - packages/core/src/import-resolution.test.ts#edgesOf
  - packages/core/src/import-resolution.test.ts#imp
  - packages/core/src/import-resolution.test.ts#writeAcmeCoreManifest
  - packages/core/src/import-resolution.test.ts#writeFile
  - packages/core/src/import-resolution.ts#expandWorkspaceGlob
  - packages/core/src/import-resolution.ts#hasPackageManifest
  - packages/core/src/import-resolution.ts#isPlainObject
  - packages/core/src/import-resolution.ts#loadEffectiveTsconfig
  - packages/core/src/import-resolution.ts#loadPackageTsconfig
  - packages/core/src/import-resolution.ts#loadWorkspacePackages
  - packages/core/src/import-resolution.ts#mapCompiledTargetToSource
  - packages/core/src/import-resolution.ts#normalizeDirOption
  - packages/core/src/import-resolution.ts#parsePnpmWorkspaceGlobs
  - packages/core/src/import-resolution.ts#readPackageManifest
  - packages/core/src/import-resolution.ts#readTextIfExists
  - packages/core/src/import-resolution.ts#readWorkspaceGlobs
  - packages/core/src/import-resolution.ts#resolveExportsValue
  - packages/core/src/import-resolution.ts#resolveImportEdges
  - packages/core/src/import-resolution.ts#resolvePackageTarget
  - packages/core/src/import-resolution.ts#resolveSpecifier
  - packages/core/src/import-resolution.ts#sourceCandidatesForCompiled
  - packages/core/src/import-resolution.ts#stringEntries
  - packages/core/src/import-resolution.ts#stripLeadingDotSlash
  - packages/core/src/imports.ts#collectImports
  - packages/core/src/imports.ts#extractImportsFromTree
  - packages/core/src/indexer.test.ts#activeSymbolsForKey
  - packages/core/src/indexer.ts#ensureLivewikiDir
  - packages/core/src/indexer.ts#formatHuman
  - packages/core/src/indexer.ts#orchestrateIndex
  - packages/core/src/indexer.ts#run
  - packages/core/src/init.ts#buildPlan
  - packages/core/src/init.ts#escapeHtmlId
  - packages/core/src/init.ts#formatNeighbors
  - packages/core/src/init.ts#generateArchitectureOverview
  - packages/core/src/init.ts#readFlowPageOwner
  - packages/core/src/init.ts#regenerateArchitectureOverview
  - packages/core/src/init.ts#runInit
  - packages/core/src/init.ts#syncClassDiagrams
  - packages/core/src/init.ts#syncStaleFlowArtifacts
  - packages/core/src/init.ts#syncStaleTopicArtifacts
  - packages/core/src/key-leak.test.ts#assertCanaryNotPresent
  - packages/core/src/key-leak.test.ts#generate
---

# core/src indexer, init, and import resolution

This page documents the responsibilities of the core-src-05 module: the indexer that scans a repository into the SQLite symbol index, the `init` flow that produces the deterministic layout, and the import resolver that maps import specifiers to repo-relative files.

## When to use this page

- **Read** when you need to know how `runInit`, `run` (indexer), and `resolveImportEdges` cooperate to turn source into a navigable wiki.
- **Modify** when changing the workspace-glob expansion, the compiled-target mapping, or the init-stage artifact sync (class diagrams, flow/topic artifacts, architecture overview).
- **Debug** ignores propagation, key-leak regressions, or architecture-overview link generation by starting from the matching test helpers.

## How it fits

The `packages/core/src` module bundles the pipeline pieces that sit between parsing and documentation. `indexer.ts` walks the repository, hashes files, and persists symbols; `init.ts` orchestrates the deterministic wiki layout (quickstart, architecture overview, class diagrams, manifest) and exposes the `--plan` and `--batch` entry points; `import-resolution.ts` provides the single resolver that maps every import specifier to a repo-relative target. `imports.ts` extracts raw import strings from the tree-sitter AST, and the test files exercise propagation, fail-closed config handling, and credential non-leakage. The public surface re-exports these subsystems from `index.ts`, so callers (the CLI, the batch runner) consume them as named namespaces.

## Import extraction
<!-- lw:anchors packages/core/src/imports.ts#extractImportsFromTree packages/core/src/imports.ts#collectImports -->

`extractImportsFromTree` walks a tree-sitter `Tree` and collects every import string literal, while `collectImports` adds file-loading and parser initialization on top. The signatures are:

```ts
export function extractImportsFromTree(tree: Tree, lang: string): ExtractedImport[]
export async function collectImports(relPath: string, content: string): Promise<ExtractedImport[]>
```

`extractImportsFromTree` returns one record per literal source it finds. For TypeScript/JavaScript it inspects `import_statement` and `export_statement` nodes, stripping the surrounding quotes off the `source` field. For Python it handles both `import os` and `import os.path` by collecting `dotted_name` children, and `from X import Y` by reading the `module_name` field plus the imported `dotted_name`/`aliased_import` children. Each result is tagged with an `ImportKind` so downstream resolvers can distinguish `ts-import`, `ts-export`, `py-import`, and `py-from`. `collectImports` calls `initParser`, picks a language by file extension (anything ending in `.py` becomes Python; everything else becomes TS), and on parse failure returns an empty array — a graceful-degradation path that the import-resolution tests rely on.

## Import resolution
<!-- lw:anchors packages/core/src/import-resolution.ts#loadWorkspacePackages packages/core/src/import-resolution.ts#loadPackageTsconfig packages/core/src/import-resolution.ts#loadEffectiveTsconfig packages/core/src/import-resolution.ts#resolveImportEdges packages/core/src/import-resolution.ts#resolveSpecifier packages/core/src/import-resolution.ts#resolvePackageTarget packages/core/src/import-resolution.ts#resolveExportsValue packages/core/src/import-resolution.ts#mapCompiledTargetToSource packages/core/src/import-resolution.ts#sourceCandidatesForCompiled packages/core/src/import-resolution.ts#readWorkspaceGlobs packages/core/src/import-resolution.ts#parsePnpmWorkspaceGlobs packages/core/src/import-resolution.ts#expandWorkspaceGlob packages/core/src/import-resolution.ts#hasPackageManifest packages/core/src/import-resolution.ts#readPackageManifest packages/core/src/import-resolution.ts#readTextIfExists packages/core/src/import-resolution.ts#stringEntries packages/core/src/import-resolution.ts#isPlainObject packages/core/src/import-resolution.ts#stripLeadingDotSlash packages/core/src/import-resolution.ts#normalizeDirOption packages/core/src/import-resolution.test.ts#imp packages/core/src/import-resolution.test.ts#edgesOf packages/core/src/import-resolution.test.ts#writeFile packages/core/src/import-resolution.test.ts#writeAcmeCoreManifest -->

The import resolver is a single pipeline that turns a file's `ExtractedImport[]` into a deduped, sorted list of `ResolvedImportEdge { fromFile, toFile, source }`. The exported entry points are:

```ts
export async function loadWorkspacePackages(repoRoot: string): Promise<WorkspacePackage[]>
export async function loadPackageTsconfig(/* ... */)
export async function loadEffectiveTsconfig(/* ... */)
export function resolveImportEdges(opts: { importsByFile: Map<string, ExtractedImport[]>; knownFiles: Set<string>; workspacePackages: WorkspacePackage[]; tsconfig?: EffectiveTsconfigs }): ResolvedImportEdge[]
function resolveSpecifier(/* ... */)
function resolvePackageTarget(pkg: WorkspacePackage, subpath: string): string | null
function resolveExportsValue(value: unknown): string | null
function mapCompiledTargetToSource(/* ... */)
function sourceCandidatesForCompiled(sourcePath: string): string[]
```

`loadWorkspacePackages` is the workspace-declaration loader. It first tries `pnpm-workspace.yaml` by reading the file, splitting on lines, and feeding the result to `parsePnpmWorkspaceGlobs`; if no `packages:` list is present it falls back to the root `package.json` `workspaces` field (array form or `{ packages: [] }`). Each glob is then handed to `expandWorkspaceGlob`, which only honors a literal directory or a single trailing `/*` — anything more complex (mid-path `*`, `**`, `?`) is rejected and the workspace entry is dropped rather than guessed. The package shape is normalized by `normalizeDirOption` (dirs are stripped of leading `./`, made posix, and lowercased on Windows) and by `readPackageManifest`, which is fed through `readTextIfExists` so missing files silently return `null`. `hasPackageManifest` is the cheap pre-check used during glob expansion.

`loadPackageTsconfig` reads a single package's `tsconfig.json` and returns the direct `compilerOptions.rootDir` and `outDir`. `loadEffectiveTsconfig` aggregates these into an `EffectiveTsconfigs` map keyed by the package's repo-relative `dir`. The contract is intentionally strict: a package with no readable tsconfig, missing `rootDir`, or missing `outDir` has no entry in the map and gets no compiled-target mapping. There is no `extends` chain walking, no `tsconfig.paths` support, and no inferred `src`/`dist` default.

`resolveImportEdges` is the orchestrator. For each specifier it asks `resolveSpecifier` to decide whether the import is a relative path, a workspace package, a `node:*` builtin, an absolute path, or an undeclared third-party. Relative specifiers reuse the historical `resolveRelativeImport` helper (NodeNext extension stripping plus barrel-index handling), so the graph and the existing module resolver stay aligned. Workspace specifiers only resolve against declared packages — a folder that merely looks like a package but isn't declared is never inferred. The `exports` field is parsed by `resolveExportsValue`, which accepts a string or an object with an `import` then `default` string condition; wildcards, arrays, nested conditions, and missing keys are NOT resolved, and the occurrence stays external. `resolvePackageTarget` converts a subpath into a target by reading the matched exports key (with the `main`/`index` fallback for bare specifiers when no exports map exists).

Once a target like `dist/index.js` is found, `mapCompiledTargetToSource` consults the matched package's own entry in `EffectiveTsconfigs` and asks `sourceCandidatesForCompiled` to produce the candidate source paths (with NodeNext extension normalization: `.js`→`.ts`/`.tsx`, `.jsx`→`.tsx`, `.mjs`→`.mts`, `.cjs`→`.cts`, plus the literal target). The first candidate that is present in `knownFiles` is accepted; zero or multiple matches leaves the occurrence external. The output is deduped, sorted by `(fromFile, toFile, source)`, and self-edges are dropped. The exposed helpers `stringEntries`, `isPlainObject`, `stripLeadingDotSlash`, and `normalizeDirOption` are the small utilities that the resolution logic relies on for input normalization.

The `import-resolution.test.ts` harness builds an `@acme/core` / `@acme/cli` / `@acme/web` fixture (`ACME_CORE`, `ACME_CLI`, `ACME_WEB`, plus per-package `ACME_TSCONFIGS` and a shared `ACME_FILES` known-files set) and exercises the resolver through `imp` (which constructs an `ExtractedImport` with a fixed `ts-import` kind) and `edgesOf` (which wraps `resolveImportEdges`). Test-side filesystem helpers `writeFile` and `writeAcmeCoreManifest` are used to build the manifest and the package's `tsconfig.json` on disk.

## Indexer
<!-- lw:anchors packages/core/src/indexer.ts#run packages/core/src/indexer.ts#orchestrateIndex packages/core/src/indexer.ts#ensureLivewikiDir packages/core/src/indexer.ts#formatHuman packages/core/src/indexer.test.ts#activeSymbolsForKey -->

The indexer is the entry point that turns a repository directory into the SQLite symbol index. The signature and types are:

```ts
export async function run(repoRoot: string, opts: IndexOptions = {}): Promise<IndexResult>
export interface IndexOptions { extraIgnores?: readonly string[]; quiet?: boolean }
export interface IndexResult { filesScanned: number; filesAdded: number; filesUpdated: number; filesDeleted: number; filesUnchanged: number; symbolsAdded: number; symbolsDeleted: number; durationMs: number }
```

`run` resolves the repo path, calls `ensureLivewikiDir` (which silently creates `.livewiki/` via the safe-io allowlist and, unless `quiet` is set, prints a single informational note suggesting `livewiki init` when the `livewiki/` directory is also missing — a path the hooks rely on to stay silent), validates the SQLite path through `safeIo.resolveAndValidate`, walks the repo with optional `extraIgnores`, opens the DB, and delegates to `orchestrateIndex`. The walk/parse/hash phase is deliberately outside the SQLite transaction (Phase A in the source) because better-sqlite3 transactions are synchronous; the upsert phase runs inside the transaction for atomicity. The `indexer.test.ts` helper `activeSymbolsForKey` opens the resulting `index.db` read-only and returns `key/kind/signature/start_line` rows for assertions about re-indexing behavior.

`formatHuman` is the JSON-friendly alternative used by the CLI in non-quiet mode; the supplied excerpt shows its signature but not its body. `orchestrateIndex` is the private worker that compares the current walk against the existing `FileRow` map and decides whether each file is added, updated, unchanged, or marked deleted. The `filesUnchanged` fast path (same `content_hash` as the persisted row) is what makes the second run cheap — only the walk and one hash per file, no parse.

## Init pipeline
<!-- lw:anchors packages/core/src/init.ts#runInit packages/core/src/init.ts#buildPlan packages/core/src/init.ts#generateArchitectureOverview packages/core/src/init.ts#regenerateArchitectureOverview packages/core/src/init.ts#syncClassDiagrams packages/core/src/init.ts#syncStaleFlowArtifacts packages/core/src/init.ts#syncStaleTopicArtifacts packages/core/src/init.ts#readFlowPageOwner packages/core/src/init.ts#formatNeighbors packages/core/src/init.ts#escapeHtmlId -->

`init.ts` is the deterministic-layout command. The exported entry point is:

```ts
export async function runInit(opts: InitOptions): Promise<InitResult>
export interface InitOptions { repoRoot: string; batch?: boolean; plan?: boolean; noRefine?: boolean; language?: string; quiet?: boolean }
```

Without flags, `runInit` indexes the repo, runs the heuristic module identifier, and writes `livewiki/quickstart.md`, `livewiki/architecture/structure.mmd`, `livewiki/architecture/modules.mmd`, per-module `livewiki/diagrams/<slug>.classes.mmd` (only when a module actually has classes), and `livewiki/.manifest.json` (via `computeSnapshotHash` / `writeManifestIfChanged`). The `plan` flag short-circuits the writes: `buildPlan` produces an `InitPlanReport { modules, edges, ordered, totalSymbols, totalFiles }` and returns without touching disk. The `batch` flag triggers the full LLM pipeline after the deterministic layout, with `noRefine` opting out of stage-2 refinement (a degradation-friendly path that the CLI advertises).

`generateArchitectureOverview` and `regenerateArchitectureOverview` write the per-module list inside `architecture/overview.md`. The overview only links a `.classes.mmd` file when that file actually exists on disk — the `init-overview.test.ts` regression test enforces that a module with zero classes produces no `funcsonly.classes.mmd` link, and a module with classes produces a link to a file that `stat` confirms is present. The neighbors section uses `formatNeighbors` to render the adjacency list and `escapeHtmlId` to produce safe HTML id slugs for the headings.

`syncClassDiagrams` writes the per-module Mermaid class diagrams and prunes any stale `.classes.mmd` files left over from a previous run whose module no longer has classes. `syncStaleFlowArtifacts` and `syncStaleTopicArtifacts` mirror that pattern for the stage-5 flow and topic outputs: they keep artifacts whose module still has flow/topic candidates and remove the ones that don't. `readFlowPageOwner` reads the frontmatter of an existing flow page and classifies its owner as `"generated" | "other"`, which is how the pipeline decides whether automation may overwrite a hand-edited page — human-owned pages are preserved and reported in `InitResult.skippedFlowsHub` rather than silently skipped.

## Ignores propagation
<!-- lw:anchors packages/core/src/ignores-propagation.test.ts#FullMockLlm packages/core/src/ignores-propagation.test.ts#FullMockLlm.generate packages/core/src/ignores-propagation.test.ts#writeIgnores packages/core/src/ignores-propagation.test.ts#activeFilePaths -->

The ignores-propagation suite asserts that the `ignores` list in `.livewiki/config.json` excludes the listed paths from the inventory, the module plan, the batch tasks, the LLM work, and the generated pages — across `livewiki init` and a subsequent batch run. The mock LLM in this suite is `FullMockLlm`:

```ts
class FullMockLlm implements LlmClient {
  public readonly provider = "anthropic" as const;
  public readonly model = "claude-test-mock";
  public readonly documentedModules: string[] = [];
  async generate(req: GenerateRequest): Promise<GenerateResult>
}
```

`FullMockLlm.generate` parses the request's `user` field, extracts the `# Module: <id>` line and the closed list of canonical keys, and synthesizes a valid artifact that lists every closed-list key in both the frontmatter `anchors` block and a single section marker. The existing single-key `MockLlm` from `batch.test.ts` would fail closed-list validation on this fixture, which is why a separate `FullMockLlm` exists. Test-side helpers `writeIgnores` (persists the configured ignore list to `.livewiki/config.json`) and `activeFilePaths` (reads the resulting inventory) are the assertion handles used to confirm that `benchmarks/tooling/` and `raw/openwiki/` never make it into any of the downstream stages.

## Key-leak regression
<!-- lw:anchors packages/core/src/key-leak.test.ts#assertCanaryNotPresent packages/core/src/key-leak.test.ts#generate -->

The key-leak test is a critical credential-non-leakage regression. It sets a recognizable canary string (`KEY-LEAK-CANARY-DONOTUSE-7f3a`), spies on `console.log`/`warn`/`error`, and walks every call site that could surface a key:

```ts
function assertCanaryNotPresent(value: string, context: string): void
```

The assertion is intentionally explicit: any leak in the supplied value, message, or stack throws with the canary, the context label, and the first 500 characters of the offending value. The suite checks `MissingApiKeyError` (only the env-var name should appear), `MissingProviderConfigError` (only the missing config key list), and the Anthropic adapter's `LlmRequestError` path (where a simulated 500 response carries the canary in its body — the adapter must NOT echo the body into the error message; only status and a truncated summary are allowed). The fixture's `generate` method corresponds to the LLM-client side exercised by the same checks; the suite's full body is truncated in the supplied excerpt, so exhaustive coverage of every error path is not established by this excerpt alone.