---
title: core-src-06 stage-5 internals (flows, diagrams, frontmatter, gitignore, hashes, import resolution)
owner: generated
anchors:
  - packages/core/src/flow-diagram.ts#FLOW_DIAGRAM_MODULE_GRANULARITY_THRESHOLD
  - packages/core/src/flow-diagram.ts#annotateLabel
  - packages/core/src/flow-diagram.ts#buildDiagramContext
  - packages/core/src/flow-diagram.ts#escapeMermaidLabel
  - packages/core/src/flow-diagram.ts#generateFlowDiagram
  - packages/core/src/flow-diagram.ts#insertFlowDiagramSection
  - packages/core/src/flow-diagram.ts#moduleGranularityIr
  - packages/core/src/flow-diagram.ts#renderFlowchartMermaid
  - packages/core/src/flow-diagram.ts#symbolGranularityIr
  - packages/core/src/flow-diagram.ts#symbolLabel
  - packages/core/src/flow-diagram.ts#truncateFlowchartToBudget
  - packages/core/src/flows.test.ts#mod
  - packages/core/src/flows.test.ts#overlapFixture
  - packages/core/src/flows.test.ts#shuffled
  - packages/core/src/flows.test.ts#shuffledMap
  - packages/core/src/flows.ts#FLOW_MAX_PATH_LENGTH
  - packages/core/src/flows.ts#FLOW_PER_ROOT_PATH_BUDGET
  - packages/core/src/flows.ts#assignFlowKeySections
  - packages/core/src/flows.ts#buildCandidate
  - packages/core/src/flows.ts#buildSeedKeyGroups
  - packages/core/src/flows.ts#capGroupsToSeedKeys
  - packages/core/src/flows.ts#compareLongestFirst
  - packages/core/src/flows.ts#comparePathLex
  - packages/core/src/flows.ts#computeModuleSignals
  - packages/core/src/flows.ts#crossesBoundary
  - packages/core/src/flows.ts#detectFlowCandidates
  - packages/core/src/flows.ts#displayName
  - packages/core/src/flows.ts#isExternalSpecifier
  - packages/core/src/flows.ts#isProperPrefix
  - packages/core/src/flows.ts#isTestPath
  - packages/core/src/flows.ts#matchedPatterns
  - packages/core/src/flows.ts#normalizeFileMap
  - packages/core/src/frontmatter.ts#FrontmatterParseError
  - packages/core/src/frontmatter.ts#FrontmatterParseError.constructor
  - packages/core/src/frontmatter.ts#getAnchors
  - packages/core/src/frontmatter.ts#getOwner
  - packages/core/src/frontmatter.ts#parseFrontmatter
  - packages/core/src/frontmatter.ts#parseYamlBlock
  - packages/core/src/frontmatter.ts#stripComment
  - packages/core/src/gitignore.ts#ensureGitignoreEntries
  - packages/core/src/gitignore.ts#extractManagedBlock
  - packages/core/src/gitignore.ts#mergeBlockLines
  - packages/core/src/gitignore.ts#readGitignore
  - packages/core/src/gitignore.ts#renderBlock
  - packages/core/src/gitignore.ts#replaceManagedBlock
  - packages/core/src/hashes.ts#expandEolToCrlf
  - packages/core/src/hashes.ts#normalizeEol
  - packages/core/src/hashes.ts#sha256
  - packages/core/src/hashes.ts#sha256Slice
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
  - packages/core/src/import-resolution.ts#pythonSourceBaseDir
  - packages/core/src/import-resolution.ts#readPackageManifest
  - packages/core/src/import-resolution.ts#readTextIfExists
  - packages/core/src/import-resolution.ts#readWorkspaceGlobs
  - packages/core/src/import-resolution.ts#resolveExportsValue
  - packages/core/src/import-resolution.ts#resolveImportEdges
  - packages/core/src/import-resolution.ts#resolvePackageTarget
  - packages/core/src/import-resolution.ts#resolvePythonModulePath
  - packages/core/src/import-resolution.ts#resolvePythonSpecifier
  - packages/core/src/import-resolution.ts#resolveSpecifier
  - packages/core/src/import-resolution.ts#sourceCandidatesForCompiled
  - packages/core/src/import-resolution.ts#stringEntries
  - packages/core/src/import-resolution.ts#stripLeadingDotSlash
---

# core-src-06 stage-5 internals (flows, diagrams, frontmatter, gitignore, hashes, import resolution)

This page documents the stage-5 cross-module flow machinery, the deterministic Mermaid flowchart renderer, the frontmatter parser, the `.gitignore` managed-block writer, the EOL-insensitive hash helpers, and the unified import resolver for the `packages/core/src` slice.

## When to use this page

- Read or extend the stage-5 flow candidate detector in `flows.ts` or change how Mermaid flowcharts are rendered in `flow-diagram.ts`.
- Modify the wiki frontmatter parser (`frontmatter.ts`), the `.gitignore` managed-block writer (`gitignore.ts`), the EOL-insensitive hash helpers (`hashes.ts`), or the unified import resolver (`import-resolution.ts`).

## How it fits

The `packages/core/src` source set sits at the center of livewiki's pipeline: `import-resolution.ts` turns per-file `ExtractedImport` lists into one canonical `ResolvedImportEdge` set consumed by both the module graph and the stage-5 flow signals, so the two views cannot disagree about where an import resolved. `hashes.ts` provides the EOL-insensitive `sha256` / `sha256Slice` used by the indexer to detect file- and symbol-level change; `gitignore.ts` keeps `.livewiki/` out of source control idempotently; `frontmatter.ts` parses the YAML subset that every generated wiki page opens with. `flows.ts` then consumes the resulting graph to enumerate ranked `FlowCandidate` walks, `flow-diagram.ts` deterministically renders each candidate into a Mermaid `flowchart` block, and the `*.test.ts` files in this slice pin down the contracts.

## Deterministic Mermaid flowchart generation
<!-- lw:anchors packages/core/src/flow-diagram.ts#FLOW_DIAGRAM_MODULE_GRANULARITY_THRESHOLD packages/core/src/flow-diagram.ts#annotateLabel packages/core/src/flow-diagram.ts#buildDiagramContext packages/core/src/flow-diagram.ts#escapeMermaidLabel packages/core/src/flow-diagram.ts#generateFlowDiagram packages/core/src/flow-diagram.ts#insertFlowDiagramSection packages/core/src/flow-diagram.ts#moduleGranularityIr packages/core/src/flow-diagram.ts#renderFlowchartMermaid packages/core/src/flow-diagram.ts#symbolGranularityIr packages/core/src/flow-diagram.ts#symbolLabel packages/core/src/flow-diagram.ts#truncateFlowchartToBudget -->

The `flow-diagram.ts` module replaces an earlier contract in which the LLM was asked to write the Mermaid `## Diagram` fence by hand — a contract that produced repeated `invalid_flow_diagram` failures with no mechanical repair for genuinely malformed syntax. The LLM never sees or writes anything about `## Diagram`; instead the orchestrator calls these functions and inserts the output wholesale.

The render path is: `generateFlowDiagram` builds a typed IR (`FlowchartIR` of `direction`, `nodes`, `edges`) from a `FlowCandidate`, `truncateFlowchartToBudget` enforces node/edge budgets, and `renderFlowchartMermaid` re-serializes the IR into valid, deterministic Mermaid source. The boundary between MODULE and SYMBOL granularity is fixed by `FLOW_DIAGRAM_MODULE_GRANULARITY_THRESHOLD = 6`: above it, one node per module in walk order; at or below it, one node per semantic-role symbol key (entry / boundary / sink). `symbolLabel` extracts the trailing symbol name from a closed-list key (`path/to/file.ts#name` → `name`), `escapeMermaidLabel` strips characters that would break a `[...]` label token, and `annotateLabel` enriches a base label with entry/persistence signals for the owning module when present. `buildDiagramContext` packages the per-candidate lookup tables the granularities consult.

`moduleGranularityIr` produces one node per module (walk-order adjacency). `symbolGranularityIr` covers only the semantically-tiered keys (entry / boundary / sink) — T4/T5 (`otherProductKeys` / `auxiliaryKeys`) are intentionally left out so the diagram stays the walk's "story" rather than a dump of every closed-list key; its edges are chained by tier order (every entry key into the first boundary key, that into the next, …, into every sink key), a deterministic, honestly-labeled approximation of role order rather than a proven call sequence. `insertFlowDiagramSection` is the orchestrator-side splice: it places the rendered Mermaid block into the stage-5 page, and because the input is already a complete IR → text pipeline the section's contents are guaranteed to be valid Mermaid as long as `truncateFlowchartToBudget` was applied against the supplied `FlowDiagramBudget`.

The key signatures (copied verbatim from the symbol table) for this section:

```ts
export function truncateFlowchartToBudget(
export function renderFlowchartMermaid(ir: FlowchartIR): string
export const FLOW_DIAGRAM_MODULE_GRANULARITY_THRESHOLD = 6
function symbolLabel(key: string): string
function escapeMermaidLabel(label: string): string
function annotateLabel(baseLabel: string, moduleId: string | undefined, ctx: DiagramContext): string
function buildDiagramContext(candidate: FlowCandidate, modules: ReadonlyArray<Module>): DiagramContext
function moduleGranularityIr(candidate: FlowCandidate, ctx: DiagramContext): FlowchartIR
function symbolGranularityIr(candidate: FlowCandidate, ctx: DiagramContext): FlowchartIR
export function generateFlowDiagram(
export function insertFlowDiagramSection(
```

A visible behavior in this pipeline is `truncateFlowchartToBudget` keeping only edges whose endpoints are both still kept: nodes that survive truncation but have no surviving edge are explicitly re-declared in `renderFlowchartMermaid` (the "isolated kept nodes" loop), so they do not silently vanish from the rendered diagram. `renderFlowchartMermaid` itself does not throw on a missing node — it falls back to an empty `shape` token for any edge endpoint whose id is not in `ir.nodes`, so a caller that produces a malformed IR still gets syntactically valid output but with bare-id nodes.

## Stage-5 flow candidate detection
<!-- lw:anchors packages/core/src/flows.ts#FLOW_MAX_PATH_LENGTH packages/core/src/flows.ts#FLOW_PER_ROOT_PATH_BUDGET packages/core/src/flows.ts#assignFlowKeySections packages/core/src/flows.ts#buildCandidate packages/core/src/flows.ts#buildSeedKeyGroups packages/core/src/flows.ts#capGroupsToSeedKeys packages/core/src/flows.ts#compareLongestFirst packages/core/src/flows.ts#comparePathLex packages/core/src/flows.ts#computeModuleSignals packages/core/src/flows.ts#crossesBoundary packages/core/src/flows.ts#detectFlowCandidates packages/core/src/flows.ts#displayName packages/core/src/flows.ts#isExternalSpecifier packages/core/src/flows.ts#isProperPrefix packages/core/src/flows.ts#isTestPath packages/core/src/flows.ts#matchedPatterns packages/core/src/flows.ts#normalizeFileMap -->

`detectFlowCandidates` decides WHICH cross-module product flows exist in a repo, purely from index facts (modules, edges, active symbol keys per file, external import specifiers per file). It is a pure function with no disk I/O, no db access, no LLM, and is deterministic under input reordering — input maps are normalized via `normalizeFileMap` into sorted lookup tables before any iteration happens, so shuffling the modules / edges arrays or the map insertion orders must produce byte-identical output.

The detector's constants are explicit budget knobs:

```ts
export const FLOW_PER_ROOT_PATH_BUDGET = 64
export const FLOW_MAX_PATH_LENGTH = 8
```

`computeModuleSignals` derives the per-module signals (`entry`, `persistence`, `external`, `sink`, plus the product-role ranking signal) by combining in/out-degree in the module graph with gitignore-style pattern matches (`matchedPatterns` is the shared helper used for both file and external-specifier pattern matching) and per-occurrence external-import accounting (`isExternalSpecifier` classifies a specifier as non-relative / non-`node:`; an occurrence with a resolved internal edge in `resolvedEdges` is NOT external — the same specifier may be internal in one file and external in another). `crossesBoundary` tests whether a walk passes through at least one persistence or external-boundary module.

Walk enumeration is a deterministic DFS (sorted module ids, sorted edges — `comparePathLex` and `compareLongestFirst` together impose the canonical ordering) with a `FLOW_PER_ROOT_PATH_BUDGET` cap per entry root. `isProperPrefix` is the prefix-drop helper used after enumeration: proper prefixes of a longer qualified path are dropped, and each entry+sink pair keeps only its longest path. `buildCandidate` is the per-path constructor that materializes a `FlowCandidate` from the walked module ids, the resolved closed-list keys, and the per-module signals. `isTestPath` guards the root selection — a zero-indegree module whose files are all test code is no longer eligible as a walk root, so the entry tier does not get filled with unittest test methods.

After ranking, `capGroupsToSeedKeys` is the bridge between the five tiered groups and the closed list: every truncated key is dropped from every group (order preserved), so the union of the five groups EQUALS `seedKeys` always. `buildSeedKeyGroups` performs the actual T1 (entry) / T2 (boundary) / T3 (boundary-sink) / T4 (other product) / T5 (auxiliary) classification. `assignFlowKeySections` is what downstream consumers call: it maps a candidate's tiered keys to the markdown sections (`## Entry` / `## Boundary` / `## Sink` / `## Other product` / `## Auxiliary`) the stage-5 page will host. `displayName` picks a human-meaningful module label for the diagram context (falling back to the module id when no `displayTitle` is set).

The ranking, overlap cap, and per-occurrence external rules are policy-level guarantees the detector enforces — the visible exceptions are the explicit test-only-root exclusion (`isTestPath`), the budget-driven truncation (`FLOW_PER_ROOT_PATH_BUDGET`, `FLOW_MAX_PATH_LENGTH`), and the overlap-drop rule that records a `seed_key_overlap` skip on the dropped candidate. A repo with no qualifying walk produces zero candidates — that is a valid outcome, not a failure.

## Flow detector test fixtures
<!-- lw:anchors packages/core/src/flows.test.ts#mod packages/core/src/flows.test.ts#overlapFixture packages/core/src/flows.test.ts#shuffled packages/core/src/flows.test.ts#shuffledMap -->

`flows.test.ts` is the contract pin for the detector. `mod` builds a minimal `Module` literal (id, paths, optional displayTitle, symbolCount 0) for graph-construction tests. `shuffled` and `shuffledMap` are deterministic Fisher–Yates shuffles (LCG-seeded) used to permute inputs and assert that the detector's output is byte-identical regardless of map insertion order. `overlapFixture` constructs the two-candidate pair used by the A/B round-5 overlap-cap regression (one candidate whose seed-key set overlaps another above `flowMaxOverlap` must be dropped with a `seed_key_overlap` skip).

```ts
function mod(id: string, paths: string[], displayTitle?: string): Module
function shuffled<T>(arr: readonly T[], seed: number): T[]
function shuffledMap<K, V>(entries: Array<[K, V]>, seed: number): Map<K, V>
function overlapFixture()
```

## Wiki frontmatter parser
<!-- lw:anchors packages/core/src/frontmatter.ts#FrontmatterParseError packages/core/src/frontmatter.ts#FrontmatterParseError.constructor packages/core/src/frontmatter.ts#getAnchors packages/core/src/frontmatter.ts#getOwner packages/core/src/frontmatter.ts#parseFrontmatter packages/core/src/frontmatter.ts#parseYamlBlock packages/core/src/frontmatter.ts#stripComment -->

`frontmatter.ts` is a small YAML-subset parser dedicated to wiki pages, deliberately scoped (top-level keys, lists of strings, comments, `\r\n` line endings) so the livewiki codebase carries no `yaml` library dependency. `parseFrontmatter` is the entry point — it normalizes line endings, detects the leading `---` opener, locates the closing `---`, slices the YAML block, then delegates to `parseYamlBlock`. The same parser handles inline flow-style lists (`key: [a, b, c]`) for both the YAML block and the `Frontmatter` record.

The error type is `FrontmatterParseError`; its constructor is:

```ts
constructor(message: string, line: number)
```

…and every parse failure (unclosed block, list item without a prior key, malformed line) is raised as one of these, with `line` pointing at the offending source line. The visible throw paths in `parseFrontmatter` are:

- the document does not start with `---\n` → returns `{ frontmatter: null, body: source, bodyOffset: 0 }` (NOT an error — pages without frontmatter are permitted);
- the opener is present but no closing `---` is found → `throw new FrontmatterParseError(...)` with line `1`.

`parseYamlBlock` raises on the malformed-line conditions; `stripComment` removes a trailing `# …` comment from a value before it is recorded. `getAnchors(fm)` returns the frontmatter `anchors` list (or `[]` when absent); `getOwner(fm)` returns the owner field normalized to the closed set `"generated" | "human" | "mixed"` (any other value is treated as missing and a default of `"generated"` is what downstream validators see).

`parseFrontmatter` and `getAnchors` / `getOwner` are the only public surface used by the page validator and the planner:

```ts
export function parseFrontmatter(source: string): ParseResult
export function getAnchors(fm: Frontmatter | null): string[]
export function getOwner(fm: Frontmatter | null): "generated" | "human" | "mixed"
```

## Idempotent `.gitignore` managed-block writer
<!-- lw:anchors packages/core/src/gitignore.ts#ensureGitignoreEntries packages/core/src/gitignore.ts#extractManagedBlock packages/core/src/gitignore.ts#mergeBlockLines packages/core/src/gitignore.ts#readGitignore packages/core/src/gitignore.ts#renderBlock packages/core/src/gitignore.ts#replaceManagedBlock -->

`gitignore.ts` keeps `.livewiki/` out of source control idempotently. The public surface is:

```ts
export async function readGitignore(repoRoot: string): Promise<string>
export async function ensureGitignoreEntries(
```

`readGitignore` is a thin wrapper around `node:fs/promises.readFile` that swallows the missing-file error and returns `""`. `ensureGitignoreEntries` is the policy enforcer: if every requested entry is already in the existing managed block (or, when there is no block, already present as a non-comment, non-blank line in the file), it returns `{ file, changed: false, added: [] }` without writing; otherwise it rebuilds the block with `mergeBlockLines`, re-renders it with `renderBlock`, splices it back with `replaceManagedBlock`, and writes the file. It never deletes entries the user added around the block.

The block is delimited by `# livewiki:start` / `# livewiki:end` comment markers. `extractManagedBlock` finds them via regex (tolerant of whitespace in the markers) and returns `{ lines }` between them, or `null` if either marker is missing — a truncated block (no `# livewiki:end`) is intentionally ignored so the file is treated as "no block" and a fresh one is appended. `mergeBlockLines` keeps existing block entries first, then appends the new ones (case-sensitive, exact-match after `trim`) preserving caller order; `renderBlock` emits the `# livewiki:start` / `# livewiki:end` markers around the line list; `replaceManagedBlock` swaps the block in place when one exists or appends a `\n\n` separator followed by the rendered block when it does not.

## EOL-insensitive content hashes
<!-- lw:anchors packages/core/src/hashes.ts#expandEolToCrlf packages/core/src/hashes.ts#normalizeEol packages/core/src/hashes.ts#sha256 packages/core/src/hashes.ts#sha256Slice -->

`hashes.ts` is the indexer's fingerprint helper. The four exported functions are:

```ts
export function sha256(content: string | Uint8Array): string
export function sha256Slice(source: string, startByte: number, endByte: number): string
export function normalizeEol(content: string): string
export function expandEolToCrlf(content: string): string
```

`sha256` is `node:crypto.createHash("sha256").update(...).digest("hex")` — deterministic lowercase hex, no salt. `sha256Slice` is a thin wrapper that hashes `source.slice(startByte, endByte)`; a zero-length slice hashes the empty string. `normalizeEol` collapses `\r\n` → `\n` and deliberately leaves lone `\r` alone (classic-Mac `\r` is not produced by git, and treating it as a line break would corrupt string literals containing a raw carriage return). `expandEolToCrlf` is the inverse — it expands every `\n` to `\r\n` — and is documented as ONLY safe on LF-only input: if the input already contains `\r\n`, those sequences would be double-expanded to `\r\r\n`, so callers MUST guarantee zero `\r\n` before calling it. The intended use is legacy-hash detection for databases indexed under the CRLF convention while the files on disk are now LF (or vice-versa).

The visible invariant the test suite pins: `sha256(normalizeEol(crlf)) === sha256(lf)` for the same content, and `sha256(expandEolToCrlf(lf)) === sha256(crlf)` for LF-only inputs. Mixed-EOL legacy files fall through to the normal updated path.

## Unified import resolver
<!-- lw:anchors packages/core/src/import-resolution.ts#expandWorkspaceGlob packages/core/src/import-resolution.ts#hasPackageManifest packages/core/src/import-resolution.ts#isPlainObject packages/core/src/import-resolution.ts#loadEffectiveTsconfig packages/core/src/import-resolution.ts#loadPackageTsconfig packages/core/src/import-resolution.ts#loadWorkspacePackages packages/core/src/import-resolution.ts#mapCompiledTargetToSource packages/core/src/import-resolution.ts#normalizeDirOption packages/core/src/import-resolution.ts#parsePnpmWorkspaceGlobs packages/core/src/import-resolution.ts#pythonSourceBaseDir packages/core/src/import-resolution.ts#readPackageManifest packages/core/src/import-resolution.ts#readTextIfExists packages/core/src/import-resolution.ts#readWorkspaceGlobs packages/core/src/import-resolution.ts#resolveExportsValue packages/core/src/import-resolution.ts#resolveImportEdges packages/core/src/import-resolution.ts#resolvePackageTarget packages/core/src/import-resolution.ts#resolvePythonModulePath packages/core/src/import-resolution.ts#resolvePythonSpecifier packages/core/src/import-resolution.ts#resolveSpecifier packages/core/src/import-resolution.ts#sourceCandidatesForCompiled packages/core/src/import-resolution.ts#stringEntries packages/core/src/import-resolution.ts#stripLeadingDotSlash -->

`import-resolution.ts` is the single internal operation that turns an `ExtractedImport` into a `ResolvedImportEdge { fromFile, toFile, source }`. Both the module graph and the stage-5 flow detector consume these same file edges, so the two views cannot disagree about where an import resolved.

The pipeline:

1. `loadWorkspacePackages` discovers declared packages. `readWorkspaceGlobs` reads `pnpm-workspace.yaml` (or the root `package.json` `workspaces`); `parsePnpmWorkspaceGlobs` extracts the bare or quoted `- <glob>` entries under a top-level `packages:` key; `expandWorkspaceGlob` expands each glob against the repo root and keeps only directories that satisfy `hasPackageManifest` (a real `package.json`). `readPackageManifest` parses each `package.json` (returning `name`, `dir`, optional `main` and verbatim `exports`).
2. `loadEffectiveTsconfig` reads a single package's own `tsconfig.json` and `loadPackageTsconfig` is the per-package variant that only consults the direct `compilerOptions` (no `extends` chain). The result is a per-package `PackageTsconfig { rootDir, outDir }` keyed by the package dir. `normalizeDirOption` normalizes an arbitrary tsconfig value into a repo-relative posix string; packages that lack either `rootDir` or `outDir` get NO compiled-target mapping — strict, no guessing.
3. `resolveImportEdges` is the public entry. It dedupes and sorts the output deterministically (`fromFile`, `toFile`, `source`) and drops self-edges.
4. `resolveSpecifier` dispatches by shape: relative (`./`, `../`) is delegated to `modules.ts:resolveRelativeImport` (NodeNext extension stripping + barrel index); workspace specifiers go through `resolvePackageTarget` + `resolveExportsValue`; compiled targets go through `mapCompiledTargetToSource` + `sourceCandidatesForCompiled`.
5. `resolveExportsValue` supports only the documented forms (string target, or an object with `import` then `default`); wildcards / arrays / nested conditions stay external.
6. `mapCompiledTargetToSource` + `sourceCandidatesForCompiled` perform the NodeNext extension flip (`.js` → `.ts`/`.tsx`, `.jsx` → `.tsx`, `.mjs` → `.mts`, `.cjs` → `.cts`) and try both the flipped candidates AND the literal target; exactly ONE candidate present in `knownFiles` is accepted — zero or ambiguous stays external.
7. `resolvePythonSpecifier` + `resolvePythonModulePath` + `pythonSourceBaseDir` handle Python resolution (`sourceBaseDir` is computed relative to the importing file).
8. `stripLeadingDotSlash`, `stringEntries`, `isPlainObject`, and `readTextIfExists` are the low-level helpers around path normalization, package-manifest arrays, and safe file reads.

Visible "non-edge" cases (no edge emitted): `node:*` builtins, absolute paths, undeclared third-party package names, lookalike workspace names that share a folder prefix but do not exactly match (`@acme/core-utils` must NOT resolve into `@acme/core`'s directory), and occurrences whose compiled target cannot be unambiguously mapped to a single source file.

## Import resolution test fixtures
<!-- lw:anchors packages/core/src/import-resolution.test.ts#edgesOf packages/core/src/import-resolution.test.ts#imp packages/core/src/import-resolution.test.ts#writeAcmeCoreManifest packages/core/src/import-resolution.test.ts#writeFile -->

```ts
function imp(source: string): ExtractedImport
function edgesOf(
async function writeFile(rel: string, content: string): Promise<void>
async function writeAcmeCoreManifest(): Promise<void>
```

`imp` is a literal factory that produces `{ source, kind: "ts-import" }`. `edgesOf` is the test-side convenience wrapper around `resolveImportEdges` — it forwards `tsconfigs` (when supplied) as a `Map` keyed by package dir, mirroring the production `EffectiveTsconfigs` shape, and accepts an undefined `tsconfigs` to exercise the no-compiled-mapping path. `writeFile` writes a UTF-8 file at a repo-relative path; `writeAcmeCoreManifest` writes the `@acme/core` `package.json` fixture used by the cross-package resolver tests (its exports / main mirror `ACME_CORE` above).

## End-to-end `ignores` propagation test harness
<!-- lw:anchors packages/core/src/ignores-propagation.test.ts#FullMockLlm packages/core/src/ignores-propagation.test.ts#FullMockLlm.generate packages/core/src/ignores-propagation.test.ts#activeFilePaths packages/core/src/ignores-propagation.test.ts#writeIgnores -->

This regression file proves that `.livewiki/config.json` `ignores` actually propagates: configured ignored paths must be absent from the indexed inventory, the module plan, the batch tasks, the LLM work, AND the generated pages across `livewiki init` and a subsequent `livewiki batch` run.

```ts
class FullMockLlm implements LlmClient
async generate(req: GenerateRequest): Promise<GenerateResult>
async function writeIgnores(ignores: string[]): Promise<void>
async function activeFilePaths(root: string): Promise<string[]>
```

`FullMockLlm` is a vitest-only mock that returns a minimum-valid stage-4 artifact — every closed-list key from the request appears in BOTH the frontmatter `anchors:` list AND a single section marker, the page-opening contract (H1, one responsibility sentence, `## When to use this page` with verb-led bullets, `## How it fits`) is satisfied, and no `lw:anchors` marker appears in the opening (the validator rejects that placement). `generate` parses the closed-list from the request, records the documented module id, and emits a synthetic page. `writeIgnores(ignores)` writes the `.livewiki/config.json` `ignores` block; `activeFilePaths(root)` walks the indexed snapshot (NOT the live filesystem) so the test asserts "what the pipeline saw", not "what is on disk now". Resume / `--only` are explicitly out of scope here: they operate on the existing run's snapshot, so a configured ignored path cannot re-enter via resume.

<!-- livewiki:navigate:start -->
## Navigate

- Flow: [CLI to persistence flow — entry through `livewiki batch` to the SQLite index](flows/cli-src-01-to-core-src-05.md)
- [Core batch pipeline and call-graph analytics](core-src-04.md) — dependency and dependent
- [Core source module 09 — orientation, parser, pointer, output budget, navigation](core-src-09.md) — dependency
- [Anchor ledger and artifact repair](core-src-01.md) — dependent

> Coverage note: this module's source (2 files, ~96k chars) exceeded the prompt budget and was excerpted; this page documents the closed-list symbols.
<!-- livewiki:navigate:end -->
