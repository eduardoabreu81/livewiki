---
title: core — init, indexer, import resolution, and imports pipeline
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

# core — init, indexer, import resolution, and imports pipeline

This page documents the responsibilities of the `core-src-05` module.

## When to use this page

- Review **import-resolution** behavior when changing how bare, relative, or `exports`-mapped specifiers resolve.
- Audit the **indexer** run path when the SQLite inventory or `.livewiki/` bootstrap needs changes.
- Trace the **init** pipeline when adjusting quickstart, navigation hubs, or stale-artifact syncs.
- Investigate **key-leak** and **ignores-propagation** regressions to confirm secrets and ignore globs never leak into output.

## How it fits

`core-src-05` aggregates the central subsystems that sit between the safe-IO layer and the LLM-backed batch pipeline inside `@livewiki/core`. The module owns: the `imports.ts` tree-sitter extraction entry point, the `import-resolution.ts` strict specifier→file resolver (with its `tsconfig`-aware compiled-target mapping), the `indexer.ts` incremental SQLite runner, the `init.ts` `livewiki init` orchestrator, and the regression fixtures that lock down secret hygiene and ignore propagation. These pieces are reached from `packages/core/src/index.ts` and feed the same `ResolvedImportEdge` shape used by `modules.ts` and the stage-5 flow detector; this page does not claim a complete call graph beyond that direct relationship.

## Indexer and orchestrator
<!-- lw:anchors packages/core/src/indexer.ts#run packages/core/src/indexer.ts#ensureLivewikiDir packages/core/src/indexer.ts#orchestrateIndex packages/core/src/indexer.ts#formatHuman packages/core/src/indexer.test.ts#activeSymbolsForKey -->

The indexer entry point is:

```ts
export async function run(repoRoot: string, opts: IndexOptions = {}): Promise<IndexResult>
```

It resolves the repo root, ensures `.livewiki/` exists via `ensureLivewikiDir`, validates the SQLite path through `safe-io`, walks the repo, then delegates to `orchestrateIndex` for the read-hash-parse-upsert loop. The excerpt does not establish exhaustive behavior beyond the visible Phase A separation (I/O outside the SQLite transaction) and the `IndexResult` counters. If `safeIo.mkdir` rejects on a path other than "already exists", `ensureLivewikiDir` re-throws; the info note about a missing `livewiki/` is suppressed when `opts.quiet` is set, so hooks do not spam terminals.

`formatHuman` and `activeSymbolsForKey` are diagnostic helpers — `activeSymbolsForKey` reads the index DB read-only to fetch active `SymbolRow`s for an exact `key`, used by the `indexer.test.ts` suite to assert which symbols survived an incremental run.

## Init pipeline and navigation syncs
<!-- lw:anchors packages/core/src/init.ts#runInit packages/core/src/init.ts#buildPlan packages/core/src/init.ts#readFlowPageOwner packages/core/src/init.ts#regenerateArchitectureOverview packages/core/src/init.ts#generateArchitectureOverview packages/core/src/init.ts#syncClassDiagrams packages/core/src/init.ts#syncStaleFlowArtifacts packages/core/src/init.ts#syncStaleTopicArtifacts packages/core/src/init.ts#formatNeighbors packages/core/src/init.ts#escapeHtmlId -->

The init entry point is:

```ts
export async function runInit(opts: InitOptions): Promise<InitResult>
```

`runInit` performs the deterministic Phase 3 layout (quickstart, structure, modules graph, per-module class diagrams) without LLM tokens; `--plan` short-circuits into a `buildPlan`-driven report and `--batch` chains the LLM pipeline afterwards. The `InitResult` carries both the files written and an optional `plan`, plus `batchExitCode` / `skippedFlowsHub` / `skippedAuxiliaryHub` / `skippedTopicsHub` fields that surface ownership-aware skips without persisting them.

The flow/topic stale sync helpers (`syncStaleFlowArtifacts`, `syncStaleTopicArtifacts`) and `syncClassDiagrams` are paired with `readFlowPageOwner` and `generateArchitectureOverview` / `regenerateArchitectureOverview` to keep hub pages aligned with the current snapshot; `formatNeighbors` and `escapeHtmlId` are formatting primitives used inside the overview/neighbor rendering. The excerpt does not establish exhaustive behavior for these functions beyond their signatures and the fact that they participate in hub ownership checks.

## Import extraction
<!-- lw:anchors packages/core/src/imports.ts#extractImportsFromTree packages/core/src/imports.ts#collectImports -->

Tree-sitter-based extraction lives here:

```ts
export function extractImportsFromTree(tree: Tree, lang: string): ExtractedImport[]
export async function collectImports(
  relPath: string,
  content: string,
): Promise<ExtractedImport[]>
```

`extractImportsFromTree` walks the tree and emits `ExtractedImport` records for `import_statement`, `export_statement` (TS re-exports), and `import_from_statement` (Python `from … import …`); the high-level `collectImports` initializes the parser once, chooses a language by file extension, and returns `[]` on parse failure (graceful degradation rather than a throw).

## Import resolution — workspace specifiers
<!-- lw:anchors packages/core/src/import-resolution.ts#loadWorkspacePackages packages/core/src/import-resolution.ts#loadPackageTsconfig packages/core/src/import-resolution.ts#loadEffectiveTsconfig packages/core/src/import-resolution.ts#resolveImportEdges packages/core/src/import-resolution.ts#resolveSpecifier packages/core/src/import-resolution.ts#resolvePackageTarget packages/core/src/import-resolution.ts#resolveExportsValue packages/core/src/import-resolution.ts#mapCompiledTargetToSource packages/core/src/import-resolution.ts#sourceCandidatesForCompiled -->

The resolver's entry point is:

```ts
export function resolveImportEdges(opts: {
  importsByFile: Map<string, ExtractedImport[]>;
  knownFiles: Set<string>;
  workspacePackages: WorkspacePackage[];
  tsconfig?: EffectiveTsconfigs;
}): ResolvedImportEdge[]
```

`resolveImportEdges` consults the per-package `tsconfig` map (`loadEffectiveTsconfig` aggregates `loadPackageTsconfig` results) and rejects undeclared packages, `node:*` builtins, and absolute paths without inferring. Supported `package.json` `exports` forms are an explicit subpath key with a string value, or an object exposing `import` then `default`; `resolvePackageTarget` and `resolveExportsValue` enforce those shapes — anything else leaves the occurrence external. `resolveSpecifier` drives the bare-name fallback chain (`exports["."]` → `main` → `index`).

For workspace discovery:

```ts
export async function loadWorkspacePackages(repoRoot: string): Promise<WorkspacePackage[]>
```

`loadWorkspacePackages` reads `pnpm-workspace.yaml` first, then the root `package.json` `workspaces`, via `readWorkspaceGlobs` and `parsePnpmWorkspaceGlobs`. For each declared directory, `hasPackageManifest` gates the call to `readPackageManifest`, which uses `readTextIfExists` to fetch the manifest body and `normalizeDirOption` to coerce `exports`/`main` shapes. `expandWorkspaceGlob` handles the literal-or-trailing-`*` expansion rule.

## Import resolution — compiled-target mapping and helpers
<!-- lw:anchors packages/core/src/import-resolution.ts#readWorkspaceGlobs packages/core/src/import-resolution.ts#parsePnpmWorkspaceGlobs packages/core/src/import-resolution.ts#expandWorkspaceGlob packages/core/src/import-resolution.ts#hasPackageManifest packages/core/src/import-resolution.ts#readPackageManifest packages/core/src/import-resolution.ts#readTextIfExists packages/core/src/import-resolution.ts#stringEntries packages/core/src/import-resolution.ts#isPlainObject packages/core/src/import-resolution.ts#stripLeadingDotSlash packages/core/src/import-resolution.ts#normalizeDirOption -->

`mapCompiledTargetToSource` and `sourceCandidatesForCompiled` translate a compiled target back to source via NodeNext extension normalization (`.js`→`.ts`/`.tsx`, `.jsx`→`.tsx`, `.mjs`→`.mts`, `.cjs`→`.cts`); `stripLeadingDotSlash` handles the `./` prefix used in `exports` keys. EXACTLY ONE candidate present in `knownFiles` is accepted — zero or ambiguous stays external. A package whose tsconfig is unreadable or lacks either `rootDir` or `outDir` gets NO mapping; inferred `src`/`dist` defaults are never applied.

The `readTextIfExists`, `hasPackageManifest`, `readPackageManifest`, `stringEntries`, `isPlainObject`, and `normalizeDirOption` helpers are the small utilities the resolver composes; their signatures are listed in the symbol table and their behavior is limited to what the excerpt shows.

## Import resolution test fixtures
<!-- lw:anchors packages/core/src/import-resolution.test.ts#edgesOf packages/core/src/import-resolution.test.ts#imp packages/core/src/import-resolution.test.ts#writeFile packages/core/src/import-resolution.test.ts#writeAcmeCoreManifest -->

```ts
function edgesOf(
  importsByFile: Map<string, ExtractedImport[]>,
  knownFiles: Set<string>,
  workspacePackages: WorkspacePackage[],
  tsconfigs?: Record<string, PackageTsconfig>,
): ResolvedImportEdge[]
function imp(source: string): ExtractedImport
async function writeFile(rel: string, content: string): Promise<void>
async function writeAcmeCoreManifest(): Promise<void>
```

The test module builds a neutral two-package `@acme/core` / `@acme/cli` / `@acme/web` workspace (NOT livewiki-shaped) and asserts strict resolver behavior: bare-name and explicit subpath specifiers resolve to source, the legacy `main`/index fallback works, name-vs-folder inference is rejected, and `node:*` / undeclared lookalikes never produce edges. The excerpt does not show the `writeAcmeCoreManifest` body, but the symbol table records its signature.

## Ignores-propagation fixture
<!-- lw:anchors packages/core/src/ignores-propagation.test.ts#FullMockLlm packages/core/src/ignores-propagation.test.ts#FullMockLlm.generate packages/core/src/ignores-propagation.test.ts#activeFilePaths packages/core/src/ignores-propagation.test.ts#writeIgnores -->

```ts
class FullMockLlm implements LlmClient {
  public readonly provider = "anthropic" as const;
  public readonly model = "claude-test-mock";
  public readonly documentedModules: string[] = [];
  async generate(req: GenerateRequest): Promise<GenerateResult>
}
async function writeIgnores(ignores: string[]): Promise<void>
async function activeFilePaths(root: string): Promise<string[]>
```

`FullMockLlm.generate` parses the prompt for a `# Module:` line and the closed-list block, then emits a page that mirrors every closed key in both the frontmatter `anchors:` list and a single section marker — the minimum valid artifact for stage-4 validation. The fixture regression asserts that `.livewiki/config.json` `ignores` exclude configured paths from inventory, plan, tasks, LLM work, and generated pages across `livewiki init` and `livewiki batch`. The excerpt is truncated and does not establish the full set of file-system operations; `writeIgnores` and `activeFilePaths` are scoped to the visible test fixture setup.

## Key-leak fixture
<!-- lw:anchors packages/core/src/key-leak.test.ts#assertCanaryNotPresent packages/core/src/key-leak.test.ts#generate -->

```ts
function assertCanaryNotPresent(value: string, context: string): void
```

The `key-leak` regression inserts the canary string `KEY-LEAK-CANARY-DONOTUSE-7f3a` into every LLM/config/batch-state call site and asserts via `assertCanaryNotPresent` that it never appears in error messages, serialized JSON, console logs, or provider error bodies. The excerpt shows the canary scanner but does not enumerate every call site covered; the second `generate` key in the closed list refers to the per-fixture local `generate` referenced from this test module.

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
- Flow: [cli-src → core-src-04 — export marker contract for stage-5 flows](flows/cli-src-to-core-src-04.md)
- [Batch orchestration, config, index schema, and deterministic diagrams](core-src-03.md) — dependency and dependent
- [Core source — prompts, safe I/O, status, symbols, topics](core-src-08.md) — dependency
- [Export, frontmatter, flows, and hashing primitives](core-src-04.md) — dependency and dependent
<!-- livewiki:navigate:end -->
