---
title: core indexing, imports, flows, and frontmatter
owner: generated
anchors:
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
  - packages/core/src/imports.ts#collectImports
  - packages/core/src/imports.ts#collectImportsForFiles
  - packages/core/src/imports.ts#extractImportsFromTree
  - packages/core/src/imports.ts#pushGoImportSpec
  - packages/core/src/imports.ts#pushRustUsePath
  - packages/core/src/indexer.ts#BINARY_SNIFF_BYTES
  - packages/core/src/indexer.ts#MAX_FILE_BYTES
  - packages/core/src/indexer.ts#ensureLivewikiDir
  - packages/core/src/indexer.ts#formatHuman
  - packages/core/src/indexer.ts#grammarStateEqual
  - packages/core/src/indexer.ts#orchestrateIndex
  - packages/core/src/indexer.ts#run
---

# core indexing, imports, flows, and frontmatter

This page documents the `@livewiki/core` source files that drive the stage 5–adjacent pipeline: import extraction, import resolution, flow candidate detection, frontmatter parsing, content hashing, the indexer orchestration, and the `.gitignore` writer.

## When to use this page

- **Configure** workspace-aware import resolution for TypeScript, Rust, Go, Python, or Java files.
- **Inspect** the deterministic flow candidate detector that selects capped, ranked cross-module walks.
- **Debug** content-hash fingerprints, including the EOL normalization and legacy CRLF migration paths.

## How it fits

`packages/core/src/index.ts` re-exports every public module this page covers (`hashes`, `imports`, `import-resolution`, `flows`, `frontmatter`, `gitignore`, `indexer`). The indexer (`packages/core/src/indexer.ts`) orchestrates walk → read → hash → parse → extract → upsert, calling into `hashes.sha256` / `normalizeEol` for fingerprints and into `imports` for tree-sitter extraction. `import-resolution` consumes those extracted imports and produces deduped, sorted file-level edges used by both the module graph and the flow detector. `flows` is a pure function over those index facts — no I/O, no LLM, deterministic under input reordering. `frontmatter` and `gitignore` are small, file-format helpers used by the surrounding batch and init flows.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-04.mmd
```

## Content hashing

<!-- lw:anchors packages/core/src/hashes.ts#sha256 packages/core/src/hashes.ts#normalizeEol packages/core/src/hashes.ts#expandEolToCrlf packages/core/src/hashes.ts#sha256Slice -->

Hashes are SHA-256 hex digests over normalized text. The same normalized string feeds tree-sitter and every content-hash computation, so symbol byte ranges and hashes stay in a single coordinate system.

```ts
export function sha256(content: string | Uint8Array): string
export function normalizeEol(content: string): string
export function expandEolToCrlf(content: string): string
export function sha256Slice(source: string, startByte: number, endByte: number): string
```

`normalizeEol` collapses only `\r\n` to `\n`; lone `\r` is preserved. `expandEolToCrlf` is the inverse for legacy-hash detection only — its docstring explicitly warns that the caller must guarantee the input contains no `\r\n`, otherwise CRLF sequences are double-expanded. `sha256Slice` is `sha256` over `source.slice(startByte, endByte)` and is used by the indexer to detect per-symbol change without re-parsing the whole file.

## Frontmatter parsing

<!-- lw:anchors packages/core/src/frontmatter.ts#parseFrontmatter packages/core/src/frontmatter.ts#parseYamlBlock packages/core/src/frontmatter.ts#stripComment packages/core/src/frontmatter.ts#FrontmatterParseError packages/core/src/frontmatter.ts#FrontmatterParseError.constructor packages/core/src/frontmatter.ts#getAnchors packages/core/src/frontmatter.ts#getOwner -->

A deliberately small YAML subset is implemented in-house — keys with `string` or `string[]` values, inline flow-style lists at one level, `# comments` outside strings, no nested maps, no booleans/null typing, no `&`/`*` anchors. The header module comment explicitly lists the limitations.

```ts
export function parseFrontmatter(source: string): ParseResult
function parseYamlBlock(yaml: string): Frontmatter
function stripComment(s: string): string
export class FrontmatterParseError extends Error
export function getAnchors(fm: Frontmatter | null): string[]
export function getOwner(fm: Frontmatter | null): "generated" | "human" | "mixed"
```

`parseFrontmatter` returns `frontmatter: null` when the page does not start with `---\n` — this is a valid outcome, not an error. `FrontmatterParseError` carries a `line` field and a textual message naming the offending line. `stripComment` matches `#` at the start of value or preceded by whitespace; it does not support `#` inside strings. `getOwner` returns the literal `"generated"` when the field is absent or unrecognized.

## Gitignore writer

<!-- lw:anchors packages/core/src/gitignore.ts#readGitignore packages/core/src/gitignore.ts#ensureGitignoreEntries packages/core/src/gitignore.ts#extractManagedBlock packages/core/src/gitignore.ts#mergeBlockLines packages/core/src/gitignore.ts#renderBlock packages/core/src/gitignore.ts#replaceManagedBlock -->

Idempotent writer of a managed block delimited by `# livewiki:start` / `# livewiki:end`. The block is parser-stable so future updates can rewrite only that range.

```ts
export async function readGitignore(repoRoot: string): Promise<string>
export async function ensureGitignoreEntries(repoRoot: string, entries: readonly string[]): Promise<EnsureGitignoreResult>
function extractManagedBlock(content: string): { lines: string[] } | null
function mergeBlockLines(existing: readonly string[], toAdd: readonly string[]): string[]
function renderBlock(lines: string[]): string
function replaceManagedBlock(content: string, newBlock: string): string
```

`readGitignore` returns `""` when the file does not exist (caught error). `ensureGitignoreEntries` is idempotent: if all requested entries are already in the managed block (or in the file when no block exists), it returns `changed: false, added: []` without writing. `extractManagedBlock` returns `null` when the block is truncated (only a start marker) — the writer will then append a fresh block. `mergeBlockLines` keeps existing order and appends new entries after dedup against a trimmed set. `replaceManagedBlock` replaces the exact range when both markers exist; otherwise it appends with a separator that respects the file's trailing newline.

## Import extraction

<!-- lw:anchors packages/core/src/imports.ts#extractImportsFromTree packages/core/src/imports.ts#pushGoImportSpec packages/core/src/imports.ts#pushRustUsePath packages/core/src/imports.ts#collectImports packages/core/src/imports.ts#collectImportsForFiles -->

Tree-sitter walker that records the literal specifier text per kind. Path resolution happens later in `import-resolution`.

```ts
export function extractImportsFromTree(tree: Tree, lang: string): ExtractedImport[]
function pushGoImportSpec(spec: Node, out: ExtractedImport[]): void
function pushRustUsePath(argument: Node | null, out: ExtractedImport[]): void
export async function collectImports(...)
export async function collectImportsForFiles(...)
```

Coverage spans TS/JS `import_statement` + `export_statement` (re-exports), Python `import_statement` + `import_from_statement`, Go `import_declaration` (both single and grouped forms — the `import_spec` path is the spec's string literal, and blanks/aliases share the same path field), Rust `use_declaration` (always the module prefix path, never the imported item or alias) and inline-bodiless `mod_item` (kind `rust-mod`), and Java `import_declaration` (plain, `static`, and wildcard — the `*` is dropped from the recorded path; static members stay). `mod_item` with a body is not an import. Dynamic `import()` and `require()` with a variable expression are out of scope and become "unknown" downstream; this is documented as an accepted MVP limitation.

## Import resolution

<!-- lw:anchors packages/core/src/import-resolution.ts#resolveImportEdges packages/core/src/import-resolution.ts#resolveSpecifier packages/core/src/import-resolution.ts#resolvePackageTarget packages/core/src/import-resolution.ts#resolveExportsValue packages/core/src/import-resolution.ts#mapCompiledTargetToSource packages/core/src/import-resolution.ts#sourceCandidatesForCompiled packages/core/src/import-resolution.ts#resolvePythonSpecifier packages/core/src/import-resolution.ts#pythonSourceBaseDir packages/core/src/import-resolution.ts#resolvePythonModulePath packages/core/src/import-resolution.ts#resolveGoSpecifier packages/core/src/import-resolution.ts#resolveRustSpecifier packages/core/src/import-resolution.ts#rustModuleDir packages/core/src/import-resolution.ts#rustCrateSourceRoot packages/core/src/import-resolution.ts#resolveRustModulePath packages/core/src/import-resolution.ts#joinRustPath packages/core/src/import-resolution.ts#resolveJavaSpecifier packages/core/src/import-resolution.ts#directJavaFilesOf packages/core/src/import-resolution.ts#loadWorkspacePackages packages/core/src/import-resolution.ts#loadPackageTsconfig packages/core/src/import-resolution.ts#loadEffectiveTsconfig packages/core/src/import-resolution.ts#loadGoModulePath packages/core/src/import-resolution.ts#loadRustCrateName packages/core/src/import-resolution.ts#readWorkspaceGlobs packages/core/src/import-resolution.ts#parsePnpmWorkspaceGlobs packages/core/src/import-resolution.ts#expandWorkspaceGlob packages/core/src/import-resolution.ts#hasPackageManifest packages/core/src/import-resolution.ts#readPackageManifest packages/core/src/import-resolution.ts#readTextIfExists packages/core/src/import-resolution.ts#stringEntries packages/core/src/import-resolution.ts#isPlainObject packages/core/src/import-resolution.ts#stripLeadingDotSlash packages/core/src/import-resolution.ts#normalizeDirOption -->

A single resolver producing deduped, sorted `ResolvedImportEdge { fromFile, toFile, source }`. Self-edges are dropped. The same edge stream feeds the module graph and the stage-5 flow detector so the two cannot disagree about where an import resolved.

```ts
export function resolveImportEdges(opts: { ... }): ResolvedImportEdge[]
function resolveSpecifier(...)
function resolvePackageTarget(pkg: WorkspacePackage, subpath: string): string | null
function resolveExportsValue(value: unknown): string | null
function mapCompiledTargetToSource(...)
function sourceCandidatesForCompiled(sourcePath: string): string[]
function resolvePythonSpecifier(...)
function pythonSourceBaseDir(fromFile: string, spec: string): string | null
function resolvePythonModulePath(dir: string, knownFiles: ReadonlySet<string>): string | null
function resolveGoSpecifier(...)
function resolveRustSpecifier(...)
function rustModuleDir(file: string): string
function rustCrateSourceRoot(knownFiles: ReadonlySet<string>): string
function resolveRustModulePath(...)
function joinRustPath(base: string, rel: string): string
function resolveJavaSpecifier(spec: string, knownFiles: ReadonlySet<string>): string[]
function directJavaFilesOf(dir: string, javaFiles: string[]): string[]
export async function loadWorkspacePackages(repoRoot: string): Promise<WorkspacePackage[]>
export async function loadPackageTsconfig(...)
export async function loadEffectiveTsconfig(...)
export async function loadGoModulePath(repoRoot: string): Promise<string | null>
export async function loadRustCrateName(repoRoot: string): Promise<string | null>
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

Relative specifiers (`./*`, `../*`) reuse the existing `resolveRelativeImport` from `modules.ts` (NodeNext extension stripping + barrel index handling). Workspace specifiers resolve ONLY against declared packages from `pnpm-workspace.yaml` `packages:` globs (line-based YAML subset) or the root `package.json` `workspaces`; a folder that merely looks like a package but is not declared is never inferred. `exports` supports explicit subpath keys (`.`, `./sub`) whose value is a string or an object with `import` then `default` string conditions; `main` (then `index`) is the fallback for the bare-name specifier when no `exports` map exists. Wildcards, arrays, nested conditions, and missing keys are NOT resolved and the occurrence stays external.

Compiled targets are mapped back to source via the matched package's OWN `rootDir`/`outDir` from the direct `compilerOptions` of that package's `tsconfig.json` — no `extends` chain, no base-file fallback. A package whose tsconfig is unreadable or lacks either value gets NO compiled-target mapping; the literal target is tried and nothing else. NodeNext extension normalization is applied (`.js`→`.ts`/`.tsx`, `.jsx`→`.tsx`, `.mjs`→`.mts`, `.cjs`→`.cts`); the literal target is also tried. EXACTLY ONE candidate present in `knownFiles` is accepted — zero or ambiguous stays external. `tsconfig.paths` is explicitly deferred.

Language-specific resolution: Go resolves non-recursively via the root `go.mod` module path (one edge per direct `.go` file in the mapped directory; `<module>` alone maps to the root directory). Rust applies `crate::` from the crate source root (`src/` when `src/lib.rs`/`src/main.rs` exists, else the repo root), `self::` from the current file's module directory, `super::` climbing one directory per `super`, and the package's own `[package] name` from `Cargo.toml` as a `crate::` alias (hyphens read as underscores). The LONGEST segment prefix that names a known `<path>.rs` or `<path>/mod.rs` wins; a trailing item name like `crate::server::Server` resolves to the file owning `crate::server`. Java resolves by DIRECTORY — the LONGEST segment prefix that names a directory directly holding `.java` files wins (type/static-member suffixes are dropped uniformly by the longest-prefix walk), and the edge targets that package's direct `.java` files (non-recursive). Source root precedence for Java is `src/main/java`, then `src/`, then the repo root. `node:*`, absolute paths, undeclared third-party packages, and Go/Rust/Java imports that don't match the rule remain external. Cargo workspaces are OUT OF SCOPE for v1.

## Flow candidate detection

<!-- lw:anchors packages/core/src/flows.ts#FLOW_MAX_PATH_LENGTH packages/core/src/flows.ts#FLOW_PER_ROOT_PATH_BUDGET packages/core/src/flows.ts#detectFlowCandidates packages/core/src/flows.ts#computeModuleSignals packages/core/src/flows.ts#matchedPatterns packages/core/src/flows.ts#isExternalSpecifier packages/core/src/flows.ts#crossesBoundary packages/core/src/flows.ts#isProperPrefix packages/core/src/flows.ts#compareLongestFirst packages/core/src/flows.ts#comparePathLex packages/core/src/flows.ts#buildCandidate packages/core/src/flows.ts#displayName packages/core/src/flows.ts#isTestPath packages/core/src/flows.ts#buildSeedKeyGroups packages/core/src/flows.ts#capGroupsToSeedKeys packages/core/src/flows.ts#assignFlowKeySections packages/core/src/flows.ts#normalizeFileMap -->

Pure, deterministic detector over index facts. No I/O, no LLM, no DB access. Shuffling inputs at the array or map level produces byte-identical output: all iteration is over sorted structures; input maps are only looked up (each is copied once into a normalized lookup).

```ts
export const FLOW_PER_ROOT_PATH_BUDGET = 64
export const FLOW_MAX_PATH_LENGTH = 8
export function detectFlowCandidates(opts: FlowDetectionOptions): FlowCandidate[]
function computeModuleSignals(...)
function matchedPatterns(inputs: string[], patterns: string[]): string[]
function isExternalSpecifier(spec: string): boolean
function crossesBoundary(path: string[], signalsById: Map<string, ModuleSignals>): boolean
function isProperPrefix(p: string[], q: string[]): boolean
function compareLongestFirst(a: string[], b: string[]): number
function comparePathLex(a: string[], b: string[]): number
function buildCandidate(...)
function displayName(module: Module): string
export function isTestPath(path: string): boolean
function buildSeedKeyGroups(...)
function capGroupsToSeedKeys(groups: KeyGroups, seedKeys: readonly string[]): KeyGroups
export function assignFlowKeySections(candidate: FlowCandidate): FlowKeySectionMap
function normalizeFileMap(map: Map<string, string[]>): Map<string, string[]>
```

Per-module signals: `entry` (in-degree 0 OR a file matches the entry patterns via the same `ignore`-style matcher used by `classifyPathRole`); `persistence` (file matches persistence patterns OR file has an external specifier matching `persistenceImportPatterns`, default empty); `external` (file has a non-relative, non-`node:` specifier per `externalImportsByFile` — an absent map means no external signal); `sink` (out-degree 0). Per-occurrence accounting: an occurrence whose same specifier also has a resolved internal edge in `resolvedEdges` is NOT external; the same specifier may be internal in one file and external in another.

A candidate is a simple path (no repeated module) starting at a walk root — a module with the `entry` signal whose files are NOT entirely test code per `isTestPath` — stopped at a sink or at length 8, that crosses at least one boundary module (persistence or external) and has length ≥ 2. The DFS uses a per-root budget (`FLOW_PER_ROOT_PATH_BUDGET` enumerated paths per entry root); a root with more paths than the budget is truncated WITHOUT starving the other roots. Proper prefixes of a longer qualified path are dropped; each entry+sink pair keeps only its longest path.

Ranking favors product-role module count desc, then centrality desc (the number of qualified walks of the union sharing at least one module with the candidate), then slug asc. `maxFlows` (default 4; 0 disables) applies only after ranking. A repo with no qualifying walk produces zero candidates — a valid outcome, not a failure. After ranking, an overlap cap drops candidates whose seed-key set overlaps an already-accepted candidate's set above `flowMaxOverlap` (intersection over the smaller set, default 0.75, 1 disables), with the skip recorded as `seed_key_overlap`. Candidates already carrying a K-a/K-b skip never block others and are never blocked themselves.

Seed keys are the closed list behind every flow section. Pass 1 reserves one key per non-empty T1/T2/T3 group (the first key in round-robin order — modules in walk order, keys sorted within a module — covers every group it belongs to). Pass 2 fills in tier priority T1→T5 (round-robin across the walk's modules, one key per module per round) until `flowMaxAnchors`. The union of the five groups EQUALS `seedKeys`, always. Two deterministic pre-LLM skips are decided before any LLM call: `insufficient_anchor_capacity` (K-a, the cap cannot fit the mandatory T1/T2/T3 reservation) and `insufficient_section_anchor_coverage` (K-b, after pass 1 plus a top-up to three distinct keys from the remaining pool in the same T1→T5 priority order as pass 2, the list still holds fewer than 3 distinct keys — the three required flow sections each need their own anchor).

## Indexer orchestration

<!-- lw:anchors packages/core/src/indexer.ts#run packages/core/src/indexer.ts#orchestrateIndex packages/core/src/indexer.ts#ensureLivewikiDir packages/core/src/indexer.ts#grammarStateEqual packages/core/src/indexer.ts#formatHuman packages/core/src/indexer.ts#MAX_FILE_BYTES packages/core/src/indexer.ts#BINARY_SNIFF_BYTES -->

The orchestrator behind the public `run` entry: walk → read → hash → parse → extract → upsert. Runs as a single SQLite transaction; read and parse are intentionally serial.

```ts
export const MAX_FILE_BYTES = 1024 * 1024
export const BINARY_SNIFF_BYTES = 8 * 1024
export async function run(repoRoot: string, opts: IndexOptions = {}): Promise<IndexResult>
async function orchestrateIndex(...)
async function ensureLivewikiDir(absRoot: string, quiet: boolean): Promise<void>
function grammarStateEqual(a: GrammarState, b: GrammarState): boolean
export function formatHuman(result: IndexResult): string
```

Incremental: files whose normalized content hash matches the stored hash are skipped (read + hash only). New files are parsed. Files that disappeared from disk are marked `status='deleted'` on their symbols. Two skips are counted separately: `filesSkippedBinary` (NUL byte in the first 8 KiB) and `filesSkippedTooLarge` (over 1 MiB). `filesReprocessedGrammar` is counted separately from unchanged so a grammar-set upgrade is visible, not silent — the upgrade docstring explains it covers files indexed before their grammar landed and left prose-tier with zero symbols.

EOL-insensitive hashing (roadmap item 12): file text is normalized with `normalizeEol` ONCE right after read; the same normalized string feeds the content hash, tree-sitter, and every symbol extraction, so a silent `core.autocrlf` checkout conversion never changes a fingerprint. Databases written before this change store legacy raw-bytes hashes; on the first index after the upgrade, a file that fails the normalized-hash comparison is also hashed against the on-disk raw bytes — a match proves the on-disk bytes are unchanged and only the algorithm changed, so the file is silently migrated (the file row is re-hashed, symbols/calls/rationales are re-parsed, the file counts as UNCHANGED in the result accounting, and `anchors.symbol_hash_at_doc` is realigned in the same transaction). Files whose raw bytes genuinely changed never match the legacy hash and follow the normal debt path.

Flipped-EOL legacy coverage (two directions): legacy-LF DB + CRLF disk — `normalizeEol` of the current bytes IS the legacy raw hash, so the unchanged fast path absorbs it (no realignment needed). Legacy-CRLF DB + LF disk — when the current bytes contain zero `\r\n`, the indexer also hashes the CRLF-expanded variant (`expandEolToCrlf`) and compares against the stored hash; a match proves the file is EOL-only-changed and triggers the same silent migration (legacy symbol hashes were raw CRLF slices ≠ normalized hashes, so anchor realignment IS required here). A mixed-EOL legacy file matches neither convention and takes the normal updated path — accepted residue.

Per-symbol EOL realignment (item 12, follow-up 2): during the legacy window (the run before `meta.eol_hashes_normalized` is first written), the write phase compares each old soft-deleted symbol hash against `sha256` of the NEW symbol's slice expanded back to CRLF; a match proves the symbol's code is identical modulo EOL and its anchors are realigned to the new normalized hash in the same transaction, exactly like the per-file migration. A real edit fails the comparison and follows the normal `changed` path.

<!-- livewiki:navigate:start -->
## Navigate

- Flow: [CLI command surface to core pipeline wiring](flows/cli-src-to-core-src-02.md)
- [Safe I/O, section guarding, status reporting, and symbol extraction](core-src-09.md) — dependency and dependent
- [Stage 4 artifact normalization, validation, and auxiliary page assembly](core-src-01.md) — dependency and dependent
- [core topics, understanding, update metrics, update, and verify](core-src-10.md) — dependency and dependent

> Coverage note: this module's source (8 files, ~141k chars) exceeded the prompt budget and was excerpted; this page documents the closed-list symbols.
<!-- livewiki:navigate:end -->
