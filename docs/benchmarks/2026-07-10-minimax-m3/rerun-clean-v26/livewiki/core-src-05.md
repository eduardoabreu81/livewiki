---
title: core-src-05 responsibilities
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

# core-src-05 responsibilities

This page documents the import-resolution, imports, indexer, init, and regression-fixture surface of the `core-src-05` module slice inside `packages/core/src`.

## When to use this page

- **Trace** how a TypeScript or Python import specifier is parsed, then resolved to a repo-relative source file.
- **Audit** the indexing pipeline that walks a repository, hashes files, and persists symbols to SQLite.
- **Inspect** the deterministic `init` orchestration that plans modules, generates diagrams, and writes manifest artifacts.

## How it fits

`core-src-05` groups five cooperating sub-areas of the `@livewiki/core` package. `imports.ts` produces raw `ExtractedImport` records from a tree-sitter parse; `import-resolution.ts` consumes those records together with workspace and tsconfig metadata to produce `ResolvedImportEdge` rows. The `indexer.ts` module turns a repository root into the SQLite-backed index that `init.ts` then queries to build the deterministic `livewiki/` layout (quickstart, architecture overview, class diagrams, manifest). The fixture files (`import-resolution.test.ts`, `indexer.test.ts`, `ignores-propagation.test.ts`, `init-config.test.ts`, `init-overview.test.ts`, `key-leak.test.ts`) pin specific behaviors of the surrounding code so regressions surface in CI; they are not the product surface itself.

## Imports and specifier resolution

<!-- lw:anchors packages/core/src/imports.ts#collectImports packages/core/src/imports.ts#extractImportsFromTree packages/core/src/import-resolution.ts#loadWorkspacePackages packages/core/src/import-resolution.ts#loadPackageTsconfig packages/core/src/import-resolution.ts#loadEffectiveTsconfig packages/core/src/import-resolution.ts#resolveImportEdges packages/core/src/import-resolution.ts#resolveSpecifier packages/core/src/import-resolution.ts#resolvePackageTarget packages/core/src/import-resolution.ts#resolveExportsValue packages/core/src/import-resolution.ts#mapCompiledTargetToSource packages/core/src/import-resolution.ts#sourceCandidatesForCompiled packages/core/src/import-resolution.ts#readWorkspaceGlobs packages/core/src/import-resolution.ts#parsePnpmWorkspaceGlobs packages/core/src/import-resolution.ts#expandWorkspaceGlob packages/core/src/import-resolution.ts#hasPackageManifest packages/core/src/import-resolution.ts#readPackageManifest packages/core/src/import-resolution.ts#readTextIfExists packages/core/src/import-resolution.ts#stringEntries packages/core/src/import-resolution.ts#isPlainObject packages/core/src/import-resolution.ts#stripLeadingDotSlash packages/core/src/import-resolution.ts#normalizeDirOption -->

The `imports.ts` pair covers the parse side of the pipeline. `extractImportsFromTree` walks a tree-sitter `Tree` with a cursor, dispatching on `import_statement`, `export_statement`, and `import_from_statement`, and emits `ExtractedImport` records tagged as `ts-import`, `ts-export`, `py-import`, or `py-from`. For Python `from`-imports the function also collects the imported names into the `names` field. The signatures visible in the source are:

```ts
export function extractImportsFromTree(tree: Tree, lang: string): ExtractedImport[]
export async function collectImports(relPath: string, content: string): Promise<ExtractedImport[]>
```

`collectImports` is the higher-level entry point: it initializes the parser, infers the language from the file extension, calls `parseSource`, and degrades gracefully — if `parseSource` throws, `collectImports` returns an empty array rather than propagating the failure.

`import-resolution.ts` is the strict resolver. It loads declared workspace packages and per-package tsconfig layouts, then resolves a literal specifier to a repo-relative source file. The visible signatures:

```ts
export async function loadWorkspacePackages(repoRoot: string): Promise<WorkspacePackage[]>
export async function loadPackageTsconfig(...)
export async function loadEffectiveTsconfig(...)
export function resolveImportEdges(opts: { ... }): ResolvedImportEdge[]
function resolveSpecifier(...)
function resolvePackageTarget(pkg: WorkspacePackage, subpath: string): string | null
function resolveExportsValue(value: unknown): string | null
function mapCompiledTargetToSource(...)
function sourceCandidatesForCompiled(sourcePath: string): string[]
```

The resolver is intentionally narrow: relative specifiers reuse `resolveRelativeImport` from `modules.ts`; workspace specifiers resolve only against declared packages from `pnpm-workspace.yaml` `packages:` globs or the root `package.json` `workspaces` field; `exports` maps only support an explicit subpath key whose value is a string or an object with `import`/`default` string conditions; compiled targets map back to source via the matched package's own `rootDir`/`outDir` with NodeNext-style extension normalization. If the package's tsconfig is missing or unreadable, that package gets NO compiled-target mapping — the resolver tries the literal target and stops. `node:*` builtins, absolute paths, and undeclared third-party packages never produce edges. `tsconfig.paths` is explicitly deferred.

Supporting helpers cover the workspace manifest side: `readWorkspaceGlobs` and `parsePnpmWorkspaceGlobs` parse the `pnpm-workspace.yaml` line-based subset; `expandWorkspaceGlob` handles a literal directory or a single trailing `/*` one-level expansion; `hasPackageManifest` and `readPackageManifest` probe each candidate dir for a `package.json`; `readTextIfExists` returns `null` for missing files instead of throwing. `stringEntries`, `isPlainObject`, `stripLeadingDotSlash`, and `normalizeDirOption` are small normalizers used by the resolver. The visible signatures:

```ts
async function readWorkspaceGlobs(absRoot: string): Promise<string[]>
function parsePnpmWorkspaceGlobs(text: string): string[]
async function expandWorkspaceGlob(absRoot: string, glob: string): Promise<string[]>
async function hasPackageManifest(absRoot: string, dir: string): Promise<boolean>
async function readPackageManifest(...)
async function readTextIfExists(absPath: string): Promise<string | null>
function stringEntries(values: unknown[]): string[]
function isPlainObject(value: unknown): value is Record<string, unknown>
function stripLeadingDotSlash(p: string): string
function normalizeDirOption(value: unknown): string | undefined
```

Because the source excerpt is truncated, the exact body of `loadPackageTsconfig`, `loadEffectiveTsconfig`, `resolveImportEdges`, `resolveSpecifier`, `mapCompiledTargetToSource`, `resolveImportEdges`, `readPackageManifest`, and `loadPackageTsconfig` is not fully established here; this page documents the contract described in the file header and the parameter shapes exposed in the symbol table.

## Indexer orchestration

<!-- lw:anchors packages/core/src/indexer.ts#run packages/core/src/indexer.ts#ensureLivewikiDir packages/core/src/indexer.ts#orchestrateIndex packages/core/src/indexer.ts#formatHuman packages/core/src/indexer.test.ts#activeSymbolsForKey -->

`indexer.ts` orchestrates the read → hash → parse → extract → upsert pipeline described in the file header. `run` is the public entry point:

```ts
export async function run(repoRoot: string, opts: IndexOptions = {}): Promise<IndexResult>
```

`run` resolves the repo root, calls `ensureLivewikiDir` (which creates `.livewiki/` via the safe-io allowlist, swallows the "already exists" path, and emits an informational note when neither `livewiki/` nor `.livewiki/` exist — suppressed under `quiet: true`), then resolves and validates the SQLite path, walks the repository, opens the DB, and delegates to `orchestrateIndex`. The visible signature for orchestration is:

```ts
async function orchestrateIndex(
  db: import("better-sqlite3").Database,
  repoRoot: string,
  walked: { path: string; lang: string }[],
  startedAt: number,
): Promise<IndexResult>
```

The orchestration splits I/O (`readFile`, hash, parse, symbol extraction) from the synchronous SQLite transaction, so better-sqlite3's sync transaction never contains an `await`. The resulting `IndexResult` reports `filesScanned`, `filesAdded`, `filesUpdated`, `filesDeleted`, `filesUnchanged`, `symbolsAdded`, `symbolsDeleted`, and `durationMs`. The `formatHuman` helper renders that result for terminal output. The visible signature:

```ts
export function formatHuman(result: IndexResult): string
```

The `indexer.test.ts` fixture pins end-to-end behavior on a copy of `test/fixtures/sample-ts-repo` (two files: `src/auth.ts` and `lib/calc.py`). It uses `activeSymbolsForKey` to read the persisted SQLite state directly:

```ts
async function activeSymbolsForKey(key: string): Promise<ActiveSymbolRow[]>
```

The test asserts that the first run adds 2 files and 6 symbols, that a second run is idempotent (everything `Unchanged`), that modifying a file produces a `filesUpdated` count and an additional symbol, that deleting a file marks its symbols deleted, that `.livewiki/` is auto-created without warnings, and that the `status` report agrees with what was indexed. Because the source excerpt is truncated, the full body of `orchestrateIndex` and `formatHuman` is not exhaustively established here.

## Init orchestration and page generation

<!-- lw:anchors packages/core/src/init.ts#runInit packages/core/src/init.ts#buildPlan packages/core/src/init.ts#readFlowPageOwner packages/core/src/init.ts#syncClassDiagrams packages/core/src/init.ts#syncStaleFlowArtifacts packages/core/src/init.ts#syncStaleTopicArtifacts packages/core/src/init.ts#regenerateArchitectureOverview packages/core/src/init.ts#generateArchitectureOverview packages/core/src/init.ts#formatNeighbors packages/core/src/init.ts#escapeHtmlId -->

`init.ts` is the deterministic entry point of `livewiki init`. The visible top-level entry point:

```ts
export async function runInit(opts: InitOptions): Promise<InitResult>
```

`InitOptions` accepts `repoRoot`, `batch`, `plan`, `noRefine`, `language`, and `quiet`. The file header describes three modes: `init` (no flags) indexes the repo and writes a deterministic layout (`quickstart.md`, `architecture/structure.mmd`, `architecture/modules.mmd`, per-module `diagrams/<slug>.classes.mmd`, and `.manifest.json`); `init --plan` reports the module plan without writing files or consuming tokens; `init --batch` runs the full LLM pipeline afterwards (skipping the refinement step when `noRefine` is set). `runInit` returns the list of files written, an optional plan report, an optional batch summary with `runId` / `status` / `tasksDone` / `tasksFailed` / `batchExitCode`, and structured "skipped hub" entries (`skippedFlowsHub`, `skippedAuxiliaryHub`, `skippedTopicsHub`) that surface when ownership preservation blocks a regeneration.

`buildPlan` constructs the deterministic module plan. Its visible signature in the symbol table is:

```ts
async function buildPlan(...)
```

`buildPlan` drives the heuristics around `identifyModulesHeuristic`, `resolveModuleEdges`, `prioritizeModules`, `splitOversizedModules`, and the strict post-conditions (`assertExactPathPartition`, `assertUniqueModuleIds`).

Stale-artifact helpers gate the generated wiki against drift. `syncClassDiagrams` regenerates `livewiki/diagrams/<slug>.classes.mmd` for each module that owns at least one class and removes ones whose slug no longer maps to a module with classes — the `init-overview.test.ts` fixture pins both the "module with classes" and "module with zero classes" branches. `syncStaleFlowArtifacts` and `syncStaleTopicArtifacts` enforce similar determinism on the stage-5 flow and concept artifacts; both use `readFlowPageOwner` to decide whether a page is `generated`, `human`/`mixed`, or unparseable, and preserve pages whose ownership is not automation. The visible signatures:

```ts
export async function syncClassDiagrams(...)
export async function syncStaleFlowArtifacts(...)
export async function syncStaleTopicArtifacts(...)
function readFlowPageOwner(content: string): "generated" | "other"
```

Architecture overview generation is split across `regenerateArchitectureOverview` (the entry point consulted by `runInit`) and `generateArchitectureOverview` (the builder). Their visible signatures:

```ts
export async function regenerateArchitectureOverview(...)
async function generateArchitectureOverview(opts: { ... })
```

`generateArchitectureOverview` walks the indexed modules, derives the deterministic navigation block content via `formatNeighbors`, and emits an `overview.md` that only links to artifacts that actually exist on disk — that contract is pinned by `init-overview.test.ts`. `formatNeighbors` and `escapeHtmlId` are small helpers used by the overview to render neighbor links and to produce HTML-safe anchor identifiers:

```ts
function formatNeighbors(...)
function escapeHtmlId(s: string): string
```

Because the source excerpt is truncated, the full bodies of `runInit`, `buildPlan`, `generateArchitectureOverview`, and the sync helpers are not exhaustively established here.

## Regression fixtures

<!-- lw:anchors packages/core/src/ignores-propagation.test.ts#FullMockLlm packages/core/src/ignores-propagation.test.ts#FullMockLlm.generate packages/core/src/ignores-propagation.test.ts#activeFilePaths packages/core/src/ignores-propagation.test.ts#writeIgnores packages/core/src/import-resolution.test.ts#imp packages/core/src/import-resolution.test.ts#edgesOf packages/core/src/import-resolution.test.ts#writeFile packages/core/src/import-resolution.test.ts#writeAcmeCoreManifest packages/core/src/key-leak.test.ts#assertCanaryNotPresent packages/core/src/key-leak.test.ts#generate -->

The remaining files in this slice are regression fixtures. They exercise specific product code paths and are not the user-facing surface; this page treats them as test scaffolding rather than product modules.

`ignores-propagation.test.ts` asserts that `.livewiki/config.json` `ignores` entries exclude the listed paths from the indexed inventory, the module plan, batch tasks, LLM work, and the generated pages — across both `livewiki init` and a follow-up `livewiki batch` run. The file uses a `FullMockLlm` (an `LlmClient` implementation that emits a page satisfying the stage-4 normalizer's closed-list contract) and helpers `writeIgnores(ignores)` and `activeFilePaths(root)` to materialize the fixture repository. The visible signatures:

```ts
class FullMockLlm implements LlmClient {
  async generate(req: GenerateRequest): Promise<GenerateResult> { ... }
}
async function writeIgnores(ignores: string[]): Promise<void>
async function activeFilePaths(root: string): Promise<string[]>
```

`FullMockLlm.generate` parses the closed-list keys from the prompt's user message and renders a fixture page whose `anchors:` YAML and the section marker match that closed list byte-for-byte. The file header explicitly scopes the test: resume and `--only` do not rescan, so a configured ignored path cannot re-enter via resume; `init --batch` is covered through the existing CLI stub E2E in `packages/cli/src/cli-batch-e2e.test.ts`.

`import-resolution.test.ts` exercises `resolveImportEdges` against a neutral two-package workspace fixture (`@acme/core`, `@acme/cli`, `@acme/web`) with explicit per-package `tsconfig` layouts. Visible helpers:

```ts
function imp(source: string): ExtractedImport
function edgesOf(
  importsByFile: Map<string, ExtractedImport[]>,
  knownFiles: Set<string>,
  workspacePackages: WorkspacePackage[],
  tsconfigs?: Record<string, PackageTsconfig>,
): ResolvedImportEdge[]
async function writeFile(rel: string, content: string): Promise<void>
async function writeAcmeCoreManifest(): Promise<void>
```

The fixture pins the strict-mode contract: bare-name and explicit-subpath specifiers resolve via `exports`; legacy packages without `exports` fall back to `main` then `index`; name-prefix collisions (e.g. `@acme/core` vs `@acme/core-utils`) match only the exact package name or `name + '/'` — folder-name inference is forbidden.

`key-leak.test.ts` is a credential-leak guard. It plants a `KEY-LEAK-CANARY-DONOTUSE-7f3a` string into every plausible call site (`MissingApiKeyError`, `MissingProviderConfigError`, `LlmRequestError` from a simulated 500 response, persisted `config.json`, checkpoint and summary JSON, and captured `console.log` / `console.warn` / `console.error` output) and asserts that the canary never appears. Visible helpers:

```ts
function assertCanaryNotPresent(value: string, context: string): void
async generate() { ... }
```

The `generate` member visible in the symbol table is the `LlmClient.generate` shape used by the LLM adapter tests; its body is not shown in this excerpt, so this page does not document its specifics beyond its presence. Because the source excerpt is truncated, the full body of `writeAcmeCoreManifest` and `assertCanaryNotPresent`'s callers is not exhaustively established here.

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
- Flow: [CLI scaffold through export hashing](flows/cli-src-to-core-src-04.md)
- ["Core pipeline: batch orchestration, config, db, and diagrams"](core-src-03.md) — dependency and dependent
- [core-src-08 — prompts, safe I/O, status, symbol extraction, and topic planning](core-src-08.md) — dependency
- [Core export, frontmatter, gitignore, flow detection, and hashing](core-src-04.md) — dependency and dependent
<!-- livewiki:navigate:end -->
