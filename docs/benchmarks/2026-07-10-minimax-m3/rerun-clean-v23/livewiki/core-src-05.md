---
title: livewiki core index, init, and import-resolution internals
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

# livewiki core index, init, and import-resolution internals

This page documents the responsibilities of the core-src-05 module, which groups the indexer, init command, and import-resolution surfaces of `@livewiki/core` along with their regression fixtures.

## When to use this page

- **Review** how `runInit` and the indexer cooperate to produce the wiki layout.
- **Trace** how an import specifier is resolved to a repo-relative file edge.
- **Audit** the fixture helpers that simulate workspace tsconfigs, manifests, and LLM clients.
- **Investigate** regressions around ignore propagation, canary-key leaks, and config fail-closed behavior.

## How it fits

The module sits beside the other packages/core/src surfaces that the planner grouped together. It exposes the `indexer`, `init`, `imports`, and `import-resolution` namespaces through the public `@livewiki/core` entry point and pulls in helpers from `walker.js`, `parser.js`, `symbols.js`, `db.js`, `safe-io.js`, `modules.js`, `frontmatter.js`, `flows.js`, `topics.js`, `navigation.js`, `diagrams.js`, and `manifest.js`. Init additionally orchestrates the deterministic layout phase and, when `--batch` is set, hands off to the LLM batch pipeline.

## Indexer pipeline
<!-- lw:anchors packages/core/src/indexer.ts#run packages/core/src/indexer.ts#ensureLivewikiDir packages/core/src/indexer.ts#orchestrateIndex packages/core/src/indexer.ts#formatHuman packages/core/src/indexer.test.ts#activeSymbolsForKey -->

The indexer is the entry point that turns a repo tree into rows in `.livewiki/index.db`. `run` resolves the repo root, ensures `.livewiki/` exists, walks the repo, opens the SQLite index, and delegates to `orchestrateIndex` for the actual upsert.

`run` has the signature:

```ts
export async function run(repoRoot: string, opts: IndexOptions = {}): Promise<IndexResult>
```

`ensureLivewikiDir` is what silently creates the cache directory and, unless `quiet` is set, emits a one-line note suggesting `livewiki init` when the user-facing wiki directory is missing. If the mkdir fails for a reason other than the directory already existing, the helper re-throws via a `safeIo.mkdir` call wrapped in a try/catch that probes `nodeFs.stat` to distinguish "already present" from real failures. `orchestrateIndex` performs I/O and parsing outside the SQLite transaction (because `better-sqlite3` transactions are synchronous) and reports per-file counts in `IndexResult`. `formatHuman` is the public formatter used by CLI status output. The fixture helper `activeSymbolsForKey` in the test file opens the index in readonly mode and pulls rows for a single key — it is purely a verification seam for tests.

## Init command
<!-- lw:anchors packages/core/src/init.ts#runInit packages/core/src/init.ts#buildPlan packages/core/src/init.ts#regenerateArchitectureOverview packages/core/src/init.ts#generateArchitectureOverview packages/core/src/init.ts#syncClassDiagrams packages/core/src/init.ts#syncStaleFlowArtifacts packages/core/src/init.ts#syncStaleTopicArtifacts packages/core/src/init.ts#readFlowPageOwner packages/core/src/init.ts#formatNeighbors packages/core/src/init.ts#escapeHtmlId -->

`runInit` is the real `livewiki init` command:

```ts
export async function runInit(opts: InitOptions): Promise<InitResult>
```

It branches on the flags: `--plan` produces a deterministic module plan without LLM calls and without writes; `--batch` defers to the LLM pipeline after laying out the wiki; the default path generates the bounded quickstart, architecture overview, structure/modules graphs, per-module class diagrams (only when a module actually contains a class), and the snapshot manifest. The config-fail-closed regression test guarantees that malformed `.livewiki/config.json` rejects — `runInit` does not silently fall back to the `maxModuleFiles`/`maxModuleSymbols` defaults.

`buildPlan` is the deterministic planner that pulls the indexed files, applies the heuristic module identification, splits oversized modules, asserts exact-path partition and unique IDs, and returns the prioritized module order used by both `--plan` and the layout phase. `regenerateArchitectureOverview` rewrites `livewiki/architecture/overview.md`, only emitting a class-diagram link when the matching `.mmd` file exists on disk; `generateArchitectureOverview` is the lower-level builder it delegates to. `syncClassDiagrams` reconciles the per-module `<slug>.classes.mmd` files against actual class content, deleting stale ones and writing new ones only when the module has at least one class. `syncStaleFlowArtifacts` and `syncStaleTopicArtifacts` walk their respective presentation caches and prune entries that no longer correspond to live candidates. `readFlowPageOwner` parses a flow page's frontmatter to decide whether automation owns it (and may therefore overwrite) or whether a human/mixed owner preserves it; this is what allows the R10.1 ownership rules to skip the flows hub without silently dropping it. `formatNeighbors` and `escapeHtmlId` are formatting helpers used while rendering navigation blocks.

## Import extraction
<!-- lw:anchors packages/core/src/imports.ts#collectImports packages/core/src/imports.ts#extractImportsFromTree -->

`extractImportsFromTree` walks a tree-sitter `Tree` and returns `ExtractedImport` entries, distinguishing TS `import_statement`, TS re-exports (`export_statement` with a `source` child), Python bare `import_statement`s, and Python `import_from_statement`s. The `kind` discriminator feeds the resolver; TS quotes are stripped with a simple `replace(/^['"]|['"]$/g, "")` rather than a JSON parse.

`collectImports` is the higher-level entry:

```ts
export async function collectImports(
  relPath: string,
  content: string,
): Promise<ExtractedImport[]>
```

It initializes the cached parser, chooses the language by file extension, and falls back to `[]` (graceful degradation) when `parseSource` throws on unparseable input. The excerpt does not establish what happens for files with extensionless paths or for a `parseSource` rejection other than the catch block; behavior in those cases is scoped to the visible try/catch returning `[]`.

## Import resolution
<!-- lw:anchors packages/core/src/import-resolution.ts#resolveImportEdges packages/core/src/import-resolution.ts#resolveSpecifier packages/core/src/import-resolution.ts#resolvePackageTarget packages/core/src/import-resolution.ts#resolveExportsValue packages/core/src/import-resolution.ts#mapCompiledTargetToSource packages/core/src/import-resolution.ts#sourceCandidatesForCompiled packages/core/src/import-resolution.ts#loadWorkspacePackages packages/core/src/import-resolution.ts#loadPackageTsconfig packages/core/src/import-resolution.ts#loadEffectiveTsconfig packages/core/src/import-resolution.ts#readWorkspaceGlobs packages/core/src/import-resolution.ts#parsePnpmWorkspaceGlobs packages/core/src/import-resolution.ts#expandWorkspaceGlob packages/core/src/import-resolution.ts#hasPackageManifest packages/core/src/import-resolution.ts#readPackageManifest packages/core/src/import-resolution.ts#readTextIfExists packages/core/src/import-resolution.ts#stringEntries packages/core/src/import-resolution.ts#isPlainObject packages/core/src/import-resolution.ts#stripLeadingDotSlash packages/core/src/import-resolution.ts#normalizeDirOption -->

`resolveImportEdges` is the single resolver the module documents — it turns a file → `ExtractedImport[]` map plus a `knownFiles` set plus per-package tsconfigs into a deduplicated, deterministically sorted `ResolvedImportEdge[]`. Its signature is:

```ts
export function resolveImportEdges(opts: {
  importsByFile: Map<string, ExtractedImport[]>;
  knownFiles: Set<string>;
  workspacePackages: WorkspacePackage[];
  tsconfig?: EffectiveTsconfigs;
}): ResolvedImportEdge[]
```

The contract is strict and "no guessing": relative specifiers reuse `resolveRelativeImport` from `modules.ts` (NodeNext extension stripping and barrel handling); workspace specifiers match only declared packages by exact name or `name + '/'` — folder-name inference is forbidden; supported `exports` forms are explicit subpath keys (`.` or `./sub`) whose value is a string, or an object with `import` then `default` string conditions; bare-name specifiers fall back to `main` then `index`; wildcards, arrays, nested conditions, and missing keys leave the occurrence external. `node:*` builtins, absolute paths, and undeclared third-party packages never produce edges. `tsconfig.paths` is explicitly deferred.

`resolveSpecifier` and `resolvePackageTarget` decompose a single specifier into a target string: `resolveSpecifier` decides between relative and workspace dispatch, and `resolvePackageTarget` looks up a subpath against the matched package's `exports` map. `resolveExportsValue` walks the supported value shapes for a single exports key. `mapCompiledTargetToSource` and `sourceCandidatesForCompiled` translate compiled JS targets (e.g. `dist/index.js`) back to candidate source files using only the matched package's own `rootDir`/`outDir`; the literal target is also tried. EXACTLY ONE candidate present in `knownFiles` is accepted; zero or ambiguous stays external. `stripLeadingDotSlash` and `normalizeDirOption` are small string normalizers used while matching.

`loadWorkspacePackages` reads declared workspace packages from `pnpm-workspace.yaml`'s `packages:` globs first, then from the root `package.json`'s `workspaces` field. The YAML reader is a line-based subset (quoted or bare `- <glob>` entries under a top-level `packages:` key) parsed by `parsePnpmWorkspaceGlobs`. `readWorkspaceGlobs` fetches the YAML text and `expandWorkspaceGlob` does a literal-directory or trailing-`/*` one-level expansion (`packages/*`); the truncated excerpt notes that anything more complex (`**`, mid-path `*`, `?`, character classes) is not handled. `hasPackageManifest` checks whether a candidate directory contains a `package.json`. `loadPackageTsconfig` reads one package's `tsconfig.json` direct `compilerOptions`; `loadEffectiveTsconfig` aggregates them into an `EffectiveTsconfigs` map keyed by `WorkspacePackage.dir`. `readPackageManifest` reads a package's `package.json` and `readTextIfExists` is the shared null-on-missing reader. `stringEntries` and `isPlainObject` are small utilities that gate the strict-exports resolution on the visible shapes only.

## Import-resolution fixtures
<!-- lw:anchors packages/core/src/import-resolution.test.ts#imp packages/core/src/import-resolution.test.ts#edgesOf packages/core/src/import-resolution.test.ts#writeFile packages/core/src/import-resolution.test.ts#writeAcmeCoreManifest -->

The test file exercises `resolveImportEdges` with a neutral two-package workspace (`@acme/core`, `@acme/cli`, `@acme/web`, plus a `@acme/core-utils` lookalike). `imp` is the one-line helper that returns `{ source, kind: "ts-import" }` from a literal string, and `edgesOf` is the call-site shim that wraps `resolveImportEdges` and lets each test pin down per-package layouts through `ACME_TSCONFIGS`. The visible cases assert bare-name resolution via `exports "."`, explicit subpath resolution via `exports "./sub"`, `main`-then-`index` fallback for legacy packages, and exact-name-only matching (no folder-name inference between `@acme/core` and `@acme/core-utils`). `writeFile` and `writeAcmeCoreManifest` build the on-disk fixture; the excerpt does not establish exhaustive manifest contents, so behavior beyond what is visible in the truncated source is not asserted here.

## Ignores-propagation fixtures
<!-- lw:anchors packages/core/src/ignores-propagation.test.ts#FullMockLlm packages/core/src/ignores-propagation.test.ts#FullMockLlm.generate packages/core/src/ignores-propagation.test.ts#activeFilePaths packages/core/src/ignores-propagation.test.ts#writeIgnores -->

The ignores-propagation fixture is a regression harness: it asserts that `.livewiki/config.json`'s `ignores` propagates from the inventory through the plan, batch tasks, LLM work, and the generated pages. `FullMockLlm` is a stand-in for the production LLM client:

```ts
class FullMockLlm implements LlmClient {
  public readonly provider = "anthropic" as const;
  public readonly model = "claude-test-mock";
  public readonly documentedModules: string[] = [];
  async generate(req: GenerateRequest): Promise<GenerateResult> { /* ... */ }
}
```

Its `generate` parses the closed-list of canonical keys out of the orchestrator's prompt and emits a page that covers every key in both frontmatter and a single section marker — the minimum artifact the stage-4 normalizer accepts. The standard `MockLlm` in `batch.test.ts` is single-key only and would fail closed-list validation on this fixture, which is why a separate full-coverage mock exists. `activeFilePaths` and `writeIgnores` are the repo-scaffolding helpers used to build the temporary repo and to drop the ignore globs onto disk; the truncated excerpt does not show their full bodies, so behavior beyond what is visible in the source is not asserted here. The visible beforeEach creates a temporary `livewiki-ignores-` directory containing both product source (`src/auth/login.ts`) and ignored directories (`benchmarks/tooling/`, `raw/openwiki/`).

## Canary-key fixtures
<!-- lw:anchors packages/core/src/key-leak.test.ts#assertCanaryNotPresent packages/core/src/key-leak.test.ts#generate -->

The key-leak regression uses a literal canary string (`KEY-LEAK-CANARY-DONOTUSE-7f3a`) substituted into every API key position and asserts it never surfaces in error messages, serialized JSON, captured console output, or provider adapter failures. `assertCanaryNotPresent` is the helper used at every check site:

```ts
function assertCanaryNotPresent(value: string, context: string): void
```

If the canary is detected, the helper throws with the offending context and a 500-char excerpt — that is the only visible failure mode, and the truncated excerpt does not establish exhaustive assertion coverage beyond what is shown. The visible test cases cover `MissingApiKeyError.message`, `MissingProviderConfigError.message` and `.stack`, and the Anthropic adapter's `LlmRequestError.message`/`.stack` when the upstream provider returns a 500 with a body that mentions the canary. `generate` is the method-level fixture entry point used to drive each adapter scenario; the excerpt does not show its full body, so behavior beyond the visible try/catch handling is not asserted here.

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
- Flow: [CLI entry to core-src-04 export — semantic product flow](flows/cli-src-to-core-src-04.md)
- [Batch orchestration, configuration, index, and diagram generation](core-src-03.md) — dependency and dependent
- [Stage-5 planning, prompt templates, and safe disk I/O core](core-src-08.md) — dependency
- [Livewiki core source — export, flows, frontmatter, gitignore, hashes](core-src-04.md) — dependency and dependent
<!-- livewiki:navigate:end -->
