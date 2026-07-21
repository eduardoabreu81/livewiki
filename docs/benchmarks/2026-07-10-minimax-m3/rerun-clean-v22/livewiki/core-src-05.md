---
title: core-src-05 — import resolution, indexing and init pipelines
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

# core-src-05 — import resolution, indexing and init pipelines

This module bundles the `packages/core/src` implementation that turns a repository into a deterministic module graph and then into a documented wiki: import extraction, import resolution, incremental indexing, and the init orchestration that produces quickstart, architecture overview, class diagrams, and stale-artifact cleanup.

## When to use this page

- **Resolve** a specifier to a repo file with the strict import-resolution contract.
- **Diagnose** why an import edge is or is not produced by `resolveImportEdges`.
- **Run or extend** the indexer (`run`, `ensureLivewikiDir`, `orchestrateIndex`) and the init pipeline (`runInit`, `regenerateArchitectureOverview`, `syncClassDiagrams`, `syncStaleFlowArtifacts`, `syncStaleTopicArtifacts`).
- **Inspect** the regression fixtures that guard ignores propagation, key-leak safety, and overview link integrity.

## How it fits

`packages/core/src/index.ts` re-exports this work as the `imports`, `importResolution`, `indexer`, and `init` namespaces of `@livewiki/core`. The pieces feed each other in a fixed order: `imports` walks tree-sitter trees to collect raw specifiers; `import-resolution` joins those specifiers against the workspace map and per-package `tsconfig.json` to emit file-level edges; `indexer.run` walks the repo and upserts files and symbols into SQLite; `init.runInit` combines all of the above with module heuristics to lay out the wiki and, optionally, kick off the batch LLM pipeline.

## Import extraction
<!-- lw:anchors packages/core/src/imports.ts#extractImportsFromTree packages/core/src/imports.ts#collectImports packages/core/src/import-resolution.test.ts#imp packages/core/src/ignores-propagation.test.ts#activeFilePaths packages/core/src/ignores-propagation.test.ts#writeIgnores -->

The `imports` module reads imports from a tree-sitter tree without doing I/O, then `collectImports` initializes the parser once and parses a file by extension. The supplied source defines:

```ts
export function extractImportsFromTree(tree: Tree, lang: string): ExtractedImport[]
export async function collectImports(relPath: string, content: string): Promise<ExtractedImport[]>
```

`extractImportsFromTree` walks the cursor and handles three node kinds: `import_statement` (TS `from "x"` strips quotes and emits `ts-import`; Python dotted-name children emit `py-import`), `export_statement` (only the `from "x"` form, emitted as `ts-export`), and `import_from_statement` (Python `from .x import y` with collected names, emitted as `py-from`). `collectImports` initialises the parser, picks `python` for `py` extensions and `ts` otherwise, and on parse failure returns `[]` — the visible graceful-degradation path for malformed sources.

The `import-resolution.test.ts` fixture helper `imp(source: string): ExtractedImport` is a one-liner used by the workspace-specifier tests to synthesise import records; the source excerpt does not show the body of `writeFile` or `writeAcmeCoreManifest`, only their declarations `async function writeFile(rel: string, content: string): Promise<void>` and `async function writeAcmeCoreManifest(): Promise<void>`. Likewise, the `ignores-propagation.test.ts` helpers `writeIgnores` and `activeFilePaths` are visible only as declarations `async function writeIgnores(ignores: string[]): Promise<void>` and `async function activeFilePaths(root: string): Promise<string[]>` in the supplied excerpt — the bodies are truncated.

## Import resolution
<!-- lw:anchors packages/core/src/import-resolution.ts#loadWorkspacePackages packages/core/src/import-resolution.ts#loadPackageTsconfig packages/core/src/import-resolution.ts#loadEffectiveTsconfig packages/core/src/import-resolution.ts#resolveImportEdges packages/core/src/import-resolution.ts#resolveSpecifier packages/core/src/import-resolution.ts#resolvePackageTarget packages/core/src/import-resolution.ts#resolveExportsValue packages/core/src/import-resolution.ts#mapCompiledTargetToSource packages/core/src/import-resolution.ts#sourceCandidatesForCompiled packages/core/src/import-resolution.ts#readWorkspaceGlobs packages/core/src/import-resolution.ts#parsePnpmWorkspaceGlobs packages/core/src/import-resolution.ts#expandWorkspaceGlob packages/core/src/import-resolution.ts#hasPackageManifest packages/core/src/import-resolution.ts#readPackageManifest packages/core/src/import-resolution.ts#readTextIfExists packages/core/src/import-resolution.ts#stringEntries packages/core/src/import-resolution.ts#isPlainObject packages/core/src/import-resolution.ts#stripLeadingDotSlash packages/core/src/import-resolution.ts#normalizeDirOption packages/core/src/import-resolution.test.ts#edgesOf packages/core/src/import-resolution.test.ts#writeAcmeCoreManifest packages/core/src/import-resolution.test.ts#writeFile -->

The `import-resolution` module exposes the strict, no-guessing contract called out in its doc-block: a single resolver produces one edge type, consumed by both the module graph and the stage-5 flow detector. The exported entry points (signatures copied verbatim from the symbol table) are:

```ts
export async function loadWorkspacePackages(repoRoot: string): Promise<WorkspacePackage[]>
export async function loadPackageTsconfig(
export async function loadEffectiveTsconfig(
export function resolveImportEdges(opts: {
```

`loadWorkspacePackages` is the declared-workspace loader: it reads `pnpm-workspace.yaml` first (a line-based YAML subset covering `packages:` followed by quoted or bare `- <glob>` entries), then the root `package.json` `workspaces` (array or `{ packages: [] }`). Glob expansion is intentionally narrow — literal directories or a single trailing `/*` one-level expansion; anything more complex (`**`, mid-path `*`, `?`, character classes) falls outside this contract.

`resolveImportEdges` is the single internal operation that turns specifiers into `ResolvedImportEdge { fromFile, toFile, source }`. Per the doc-block contract, relative specifiers reuse `modules.ts:resolveRelativeImport` (NodeNext extension stripping and barrel index included), workspace specifiers resolve only against declared packages, and `tsconfig.paths` is explicitly deferred. The compiled-target mapping reads BOTH `rootDir` and `outDir` from the direct `compilerOptions` of the matched package's own `tsconfig.json`; a package with no entry in `EffectiveTsconfigs` gets no compiled-target mapping — the literal target is tried and nothing else.

The `edgesOf` test helper wraps the resolver and accepts the optional per-package layouts (`tsconfigs`) as a `Record<string, PackageTsconfig>` so individual cases can supply or omit compiled-target mappings. The supplied excerpt only declares `function edgesOf(` — its body is the wrapper shown above; the rest of the file (including the bodies of `writeAcmeCoreManifest` and `writeFile`) is truncated in this excerpt.

The supporting helpers in the file — `resolveSpecifier`, `resolvePackageTarget`, `resolveExportsValue`, `mapCompiledTargetToSource`, `sourceCandidatesForCompiled`, `readWorkspaceGlobs`, `parsePnpmWorkspaceGlobs`, `expandWorkspaceGlob`, `hasPackageManifest`, `readPackageManifest`, `readTextIfExists`, `stringEntries`, `isPlainObject`, `stripLeadingDotSlash`, `normalizeDirOption` — back the workspace, manifest, and tsconfig loaders. Their signatures appear verbatim in the symbol table; the supplied source excerpt does not include all of their bodies, so this page scopes its claims to the contract and the visible loader behaviour rather than reconstructing internals.

## Indexer pipeline
<!-- lw:anchors packages/core/src/indexer.ts#run packages/core/src/indexer.ts#ensureLivewikiDir packages/core/src/indexer.ts#orchestrateIndex packages/core/src/indexer.ts#formatHuman packages/core/src/indexer.test.ts#activeSymbolsForKey -->

`indexer.run` is the public entry point that orchestrates walk → read → hash → parse → extract → upsert inside one atomic SQLite transaction. Its signature:

```ts
export async function run(repoRoot: string, opts: IndexOptions = {}): Promise<IndexResult>
```

The visible flow inside `run` is: resolve `repoRoot` to an absolute path, call `ensureLivewikiDir(absRoot, Boolean(opts.quiet))`, resolve the db path through `safeIo.resolveAndValidate`, walk the repo, open the index, then delegate to `orchestrateIndex` and close the DB in `finally`. `ensureLivewikiDir` creates `.livewiki/` via `safeIo.mkdir`; if that fails, the visible fallback path is `if (!(await nodeFs.stat(...).catch(() => null))) throw new Error("failed to create .livewiki/")`. When `livewiki/` is missing and `quiet` is false, it logs a one-line informational note suggesting `livewiki init`; in quiet mode (the hook context) the terminal stays clean.

`orchestrateIndex` separates async I/O (read + parse) from the synchronous SQLite transaction because better-sqlite3 transactions cannot contain `await`. It loads the existing files map, builds a `FilePlan` per walked entry, and returns the result counters from `IndexResult`. The supplied excerpt truncates the body of `orchestrateIndex` mid-stream, so the prose above is scoped to the visible orchestration shape rather than the full diff/upsert path. `formatHuman(result: IndexResult): string` produces the human-readable counter summary for CLI output; its body is not visible in the excerpt.

The test helper `activeSymbolsForKey(key: string)` opens the on-disk SQLite index in read-only mode and returns rows from `symbols WHERE key = ? AND status = 'active'`; the test cases verify that the first run adds 2 files / 6 symbols, that a second unchanged run is fully idempotent, that file modification re-extracts symbols, and that file deletion marks the symbols as deleted with `status='deleted'`.

## Init pipeline
<!-- lw:anchors packages/core/src/init.ts#runInit packages/core/src/init.ts#buildPlan packages/core/src/init.ts#generateArchitectureOverview packages/core/src/init.ts#regenerateArchitectureOverview packages/core/src/init.ts#syncClassDiagrams packages/core/src/init.ts#syncStaleFlowArtifacts packages/core/src/init.ts#syncStaleTopicArtifacts packages/core/src/init.ts#readFlowPageOwner packages/core/src/init.ts#formatNeighbors packages/core/src/init.ts#escapeHtmlId -->

`init.runInit` is the public entry point for `livewiki init`, with the signatures:

```ts
export async function runInit(opts: InitOptions): Promise<InitResult>
export async function syncClassDiagrams(
export async function syncStaleFlowArtifacts(
export async function syncStaleTopicArtifacts(
export async function regenerateArchitectureOverview(
```

The exported result type carries `filesWritten`, optional `plan` (only when `opts.plan`), optional `batchSummary` plus `batchExitCode: 0 | 1 | 2` (only when `--batch`), and three skipped-hub fields: `skippedFlowsHub` (R10.1 C), `skippedAuxiliaryHub` (R11-NAV), and `skippedTopicsHub` (R11-A), each `{ path; owner: "human" | "mixed" | null }`. The contract encoded in the visible doc-block is: `init --plan` and plain `init` never require LLM config; only `--batch` requires it when LLM is invoked; `init --batch --no-refine` skips step-2 refinement.

`buildPlan` is the deterministic module-identification step used by `init --plan` (no LLM, no writes). `generateArchitectureOverview` is the per-module link builder for `overview.md`; `regenerateArchitectureOverview` is the public wrapper invoked by the regression test. The visible regression `init-overview.test.ts` asserts that a module with zero classes produces no `[class diagram]` link and no dangling `.mmd` file, while a module with a class emits an existing `<module>.classes.mmd` link and prunes stale `*.classes.mmd` files from `livewiki/diagrams/` — the overview only links artifacts that exist on disk. The fail-closed config regression (`init-config.test.ts`) asserts that malformed `.livewiki/config.json` causes `runInit({ plan: true })` to reject (matching `/Failed to parse|\.livewiki\/config\.json|JSON/i`) and that a missing config returns the plan with `applyDefaults`.

`syncClassDiagrams`, `syncStaleFlowArtifacts`, and `syncStaleTopicArtifacts` are the stale-artifact cleanup passes; their full bodies are truncated in the supplied excerpt, so their observable contract here is the names and the high-level intent (remove `.mmd`, flow, and topic artifacts that no longer correspond to a generated page). `readFlowPageOwner(content: string): "generated" | "other"` is the frontmatter owner classifier used to decide whether automation may rewrite a hub; `formatNeighbors` and `escapeHtmlId` are navigation-helpers whose signatures appear in the symbol table but whose bodies are not visible in this excerpt.

## Ignores propagation fixture
<!-- lw:anchors packages/core/src/ignores-propagation.test.ts#FullMockLlm packages/core/src/ignores-propagation.test.ts#FullMockLlm.generate -->

The regression test `ignores-propagation.test.ts` exercises the end-to-end claim that `.livewiki/config.json` `ignores` excludes configured paths from the indexed inventory, the module plan, the batch tasks, the LLM work, and the generated pages — across both `livewiki init` and a fresh `livewiki batch`. The fixture uses `FullMockLlm` because the existing `MockLlm` in `batch.test.ts` only emits single-key pages and would fail closed-list validation:

```ts
class FullMockLlm implements LlmClient {
  public readonly provider = "anthropic" as const;
  public readonly model = "claude-test-mock";
  public readonly documentedModules: string[] = [];
  async generate(req: GenerateRequest): Promise<GenerateResult> {
```

`FullMockLlm.generate` parses the closed-list block out of the prompt (lines starting with `- ` between the `Closed list of canonical keys` header and the next non-empty non-`- ` line), and if any keys were collected it uses them directly to populate frontmatter `anchors:` and the section `lw:anchors` marker. Otherwise it falls back to a single placeholder key. The generated page opens with `H1`, one responsibility sentence, `H2 "When to use this page"` with two verb-led bullets, and `H2 "How it fits"` — and never emits an `lw:anchors` marker in the opening, since the validator rejects that placement. Resume / `--only` are explicitly noted in the test header as NOT rescanning: they operate on the existing snapshot, so a configured ignored path cannot re-enter via resume.

The fixture `beforeEach` creates two product source files (`src/auth/login.ts` containing `login` and `AuthService`) that must be indexed and documented, and two ignored-path files (`benchmarks/tooling/harness.ts` and `raw/openwiki/peer.ts`) that must NEVER enter the inventory, plan, tasks, LLM work, or generated pages. The supplied excerpt truncates after the `writeIgnores` helper declaration, so this page scopes the fixture description to the visible setup and the `FullMockLlm` contract.

## Key-leak safety fixture
<!-- lw:anchors packages/core/src/key-leak.test.ts#assertCanaryNotPresent packages/core/src/key-leak.test.ts#generate -->

The `key-leak.test.ts` regression uses the canary string `KEY-LEAK-CANARY-DONOTUSE-7f3a` to assert that the API key never leaks through any error message, persisted JSON, or console output:

```ts
function assertCanaryNotPresent(value: string, context: string): void {
  if (value.includes(CANARY_KEY)) {
    throw new Error(
      `CANARY KEY leaked in ${context}!\n` +
        `Canary: ${CANARY_KEY}\n` +
        `Value (first 500 chars): ${value.slice(0, 500)}`,
    );
  }
}
```

`generate` is the test's mock LLM method (its full body is truncated in the excerpt). The visible cases cover `MissingApiKeyError.message`, `MissingProviderConfigError.message` and `.stack`, and the `AnthropicAdapter` 500-error path (`LlmRequestError` with a worst-case provider body that mentions the canary) — none of those surfaces may contain the canary, and the body of a successful `adapter.generate` is not asserted in the visible excerpt. `console.log`, `console.warn`, and `console.error` are spied via `vi.spyOn` with `mockImplementation(() => {})` in `beforeEach` and restored in `afterEach`, so console output from the SUT is captured for later canary checks.

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
- Flow: [CLI bootstrap to wiki export (cli-src to core-src-04)](flows/cli-src-to-core-src-04.md)
- [Batch orchestration, config, index DB, and diagram generators](core-src-03.md) — dependency and dependent
- [Core prompt, I/O allowlist, symbol extraction, status and topic planning](core-src-08.md) — dependency
- [Wiki export, flow detection, and parser helpers](core-src-04.md) — dependency and dependent
<!-- livewiki:navigate:end -->
