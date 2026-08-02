---
title: Livewiki core src 07
owner: generated
anchors:
  - packages/core/src/imports.ts#collectImports
  - packages/core/src/imports.ts#collectImportsForFiles
  - packages/core/src/imports.ts#extractImportsFromTree
  - packages/core/src/indexer.test.ts#activeSymbolsForKey
  - packages/core/src/indexer.test.ts#rationalesForFile
  - packages/core/src/indexer.ts#BINARY_SNIFF_BYTES
  - packages/core/src/indexer.ts#MAX_FILE_BYTES
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
  - packages/core/src/install.test.ts#writeHome
  - packages/core/src/install.ts#AGENT_REGISTRY
  - packages/core/src/install.ts#SHARED_SKILL_TARGET
  - packages/core/src/install.ts#TOML_BLOCK_END
  - packages/core/src/install.ts#TOML_BLOCK_START
  - packages/core/src/install.ts#applyInstall
  - packages/core/src/install.ts#buildLocalCommandEntry
  - packages/core/src/install.ts#buildMcpEntry
  - packages/core/src/install.ts#deepEqual
  - packages/core/src/install.ts#detectAgents
  - packages/core/src/install.ts#getAgentDefinition
  - packages/core/src/install.ts#isPlainObject
  - packages/core/src/install.ts#mergeClaudeCodeSettings
  - packages/core/src/install.ts#mergeMcpServersJson
  - packages/core/src/install.ts#mergeTomlManagedBlock
  - packages/core/src/install.ts#pathExists
  - packages/core/src/install.ts#planAgentHook
  - packages/core/src/install.ts#planGitHook
  - packages/core/src/install.ts#planInstall
  - packages/core/src/install.ts#planMcpConfig
  - packages/core/src/install.ts#planPointer
  - packages/core/src/install.ts#planSkill
  - packages/core/src/install.ts#readIfExists
  - packages/core/src/install.ts#renderTomlManagedBlock
  - packages/core/src/install.ts#renderYamlManagedBlock
  - packages/core/src/install.ts#stopEntryCommands
  - packages/core/src/install.ts#stripJsoncComments
  - packages/core/src/key-leak.test.ts#assertCanaryNotPresent
  - packages/core/src/key-leak.test.ts#generate
  - packages/core/src/manifest.test.ts#writeLivewikiFile
---

# Livewiki core src 07

This page documents the livewiki core source slice covering imports parsing, the indexer entry point, the `init` command pipeline, the `install` agent registry and merge adapters, and the regression helpers used by the indexer/install/key-leak/manifest test suites.

## When to use this page

- **Trace** how an import statement in a TypeScript or Python source file becomes an `ExtractedImport` record and feeds the module graph.
- **Configure or debug** the `livewiki install` flow by mapping each registered agent to its MCP entry shape, merge adapter, and skill target.
- **Verify** the regression guarantees enforced by the `indexer`, `install`, `key-leak`, and `manifest` test fixtures.
- **Understand** the orchestration performed by `runInit`, `run`, `planInstall`, and `applyInstall` when scaffolding or updating a wiki.

## How it fits

The `packages/core/src` slice ties the lower-level safe-io, hashing, parsing, and SQLite layers (re-exported through `packages/core/src/index.ts`) to the user-facing `init` and `install` commands. `imports.ts` produces the deterministic import graph consumed by `modules.ts` during init; `indexer.ts` walks the repository and persists symbols and rationales into `.livewiki/index.db`; `init.ts` rebuilds diagrams, navigation hubs, and the architecture overview from that index; `install.ts` operates outside the repo allowlist to detect and configure supported coding agents.

## Imports extraction

<!-- lw:anchors packages/core/src/imports.ts#collectImports packages/core/src/imports.ts#collectImportsForFiles packages/core/src/imports.ts#extractImportsFromTree -->

The imports module turns a source file's tree-sitter tree into `ExtractedImport` records. The pure parser path operates on an already-parsed tree, while the high-level entry point lazily initializes the parser and reads content from disk for a batch of files.

```ts
export function extractImportsFromTree(tree: Tree, lang: string): ExtractedImport[]
```

`extractImportsFromTree` walks the tree and emits entries for TypeScript `import_statement` and `export_statement` nodes (re-exports included), plus Python `import_statement` and `import_from_statement` nodes. TS source strings are unquoted; Python absolute dotted `from` targets (e.g. `from app.services import bgm`) are excluded from the `names` list by start/end index comparison, so `names` only contains the symbols the user actually imported. The function performs no I/O — it is the right call when callers already hold a parsed tree.

```ts
export async function collectImports(
  relPath: string,
  content: string,
): Promise<ExtractedImport[]>
```

`collectImports` initializes the parser once (cached) and parses the source from the file extension. When the source fails to parse, the function returns an empty array — graceful degradation rather than a throw, so callers in the indexing pipeline can keep moving.

```ts
export async function collectImportsForFiles(
```

`collectImportsForFiles` reads each repo-relative file from disk and extracts its imports, returning the per-file map. The rationale evidence notes that this helper was hoisted out of `batch.ts` so the on-demand status risk analysis recomputes the same map; imports are never persisted (plan option A). Unreadable or unparseable files are skipped — they do not abort the batch.

## Indexer entry point

<!-- lw:anchors packages/core/src/indexer.ts#BINARY_SNIFF_BYTES packages/core/src/indexer.ts#MAX_FILE_BYTES packages/core/src/indexer.ts#ensureLivewikiDir packages/core/src/indexer.ts#formatHuman packages/core/src/indexer.ts#orchestrateIndex packages/core/src/indexer.ts#run -->

The indexer is the single repository-wide walk that produces the SQLite index. It is invoked by `init` and by the CLI's `index` subcommand.

```ts
export const MAX_FILE_BYTES = 1024 * 1024;
export const BINARY_SNIFF_BYTES = 8 * 1024;
```

`MAX_FILE_BYTES` and `BINARY_SNIFF_BYTES` define the upper byte limits enforced during scanning: files larger than `MAX_FILE_BYTES` are skipped, and the first `BINARY_SNIFF_BYTES` of each candidate are sniffed for binary markers before parsing. Both are one-sided upper bounds; they do not impose a minimum size.

```ts
export async function run(repoRoot: string, opts: IndexOptions = {}): Promise<IndexResult>
```

`run` is the public entry point that opens the SQLite database, ensures `.livewiki/` exists, then delegates to `orchestrateIndex` for the actual walk. The function honors the EOL-insensitive hashing strategy documented in the module header so symbol byte ranges, hashes, and anchor realignment all share the same coordinate system; legacy DBs from before the normalized-hash switch are silently migrated without emitting artificial debt.

```ts
async function orchestrateIndex(
```

`orchestrateIndex` drives the walk → read → hash → parse → extract → upsert pipeline inside a single SQLite transaction. Per-file accounting distinguishes `filesScanned`, `filesAdded`, `filesUpdated`, `filesUnchanged`, and `filesDeleted`, and the same shape is reported per symbol. Failures in any single file do not abort the whole run; they are reflected in the result.

```ts
async function ensureLivewikiDir(absRoot: string, quiet: boolean): Promise<void>
```

`ensureLivewikiDir` auto-creates `.livewiki/` when missing and emits an informational note suggesting `livewiki init` only when the `livewiki/` directory itself is also absent — exit 0 in that case.

```ts
export function formatHuman(result: IndexResult): string
```

`formatHuman` renders an `IndexResult` as a multi-line, human-readable summary suitable for CLI output.

## Init command pipeline

<!-- lw:anchors packages/core/src/init.ts#buildPlan packages/core/src/init.ts#escapeHtmlId packages/core/src/init.ts#formatNeighbors packages/core/src/init.ts#generateArchitectureOverview packages/core/src/init.ts#readFlowPageOwner packages/core/src/init.ts#regenerateArchitectureOverview packages/core/src/init.ts#runInit packages/core/src/init.ts#syncClassDiagrams packages/core/src/init.ts#syncStaleFlowArtifacts packages/core/src/init.ts#syncStaleTopicArtifacts -->

`init.ts` is the entry point for `livewiki init`, supporting `--plan`, `--batch`, and `--no-refine` flags. It is intentionally split so that `--plan` never requires LLM credentials and never writes files.

```ts
export async function runInit(opts: InitOptions): Promise<InitResult>
```

`runInit` is the top-level orchestrator: when `plan` is set it returns an `InitPlanReport` without writing; otherwise it indexes the repository (via `runIndexer`), applies deterministic layouts and manifest writes, and — only when `batch` is set — hands off to the batch LLM pipeline. The function reports `batchExitCode` derived from `statusToExitCode` in `core/batch.ts` (the single source of truth for exit code semantics). R10.1 C notes that ownership-protected hubs are surfaced via `skippedFlowsHub` rather than silently skipped.

```ts
async function buildPlan(
```

`buildPlan` computes the deterministic module plan used by `--plan` and by the layout phase. It applies heuristics for module identification, edge resolution, prioritization, unique deterministic IDs, oversized-module splits, and post-conditions like `assertExactPathPartition` and `assertUniqueModuleIds`.

```ts
export async function regenerateArchitectureOverview(
```

```ts
async function generateArchitectureOverview(opts: {
```

`generateArchitectureOverview` builds the `livewiki/architecture/overview.md` artifact from the current index. `regenerateArchitectureOverview` wraps it and is the version other sync routines call after the layout phase. The `init-overview.test.ts` excerpt proves the per-module class-diagram link only appears when the underlying `.classes.mmd` file actually exists on disk; modules with zero classes receive no link, and stale `.mmd` files left over from earlier runs are pruned while unrelated custom `.mmd` files are preserved.

```ts
export async function syncClassDiagrams(
```

```ts
export async function syncStaleFlowArtifacts(
```

```ts
export async function syncStaleTopicArtifacts(
```

`syncClassDiagrams` reconciles `livewiki/diagrams/<slug>.classes.mmd` files with the current set of modules, creating one per module that actually contains classes. `syncStaleFlowArtifacts` and `syncStaleTopicArtifacts` walk their respective subtrees and remove or refresh artifacts whose owning source modules are gone, while respecting the ownership check `readFlowPageOwner` performs on each candidate page.

```ts
function readFlowPageOwner(content: string): "generated" | "other"
```

`readFlowPageOwner` inspects a flow page's frontmatter to decide whether the page is generated by livewiki (frontmatter `owner: generated`) or written by a human or in a mixed/unparseable state. R10.1 C relies on this to refuse silent overwrites of human-authored flow hubs.

```ts
function formatNeighbors(
```

```ts
function escapeHtmlId(s: string): string
```

`formatNeighbors` formats neighbor descriptors used by the architecture overview, and `escapeHtmlId` produces HTML-safe identifiers from arbitrary strings — these are emitted as anchor IDs that the markdown generator links against.

## Install: agent registry and merge adapters

<!-- lw:anchors packages/core/src/install.ts#AGENT_REGISTRY packages/core/src/install.ts#SHARED_SKILL_TARGET packages/core/src/install.ts#TOML_BLOCK_END packages/core/src/install.ts#TOML_BLOCK_START packages/core/src/install.ts#applyInstall packages/core/src/install.ts#buildLocalCommandEntry packages/core/src/install.ts#buildMcpEntry packages/core/src/install.ts#deepEqual packages/core/src/install.ts#detectAgents packages/core/src/install.ts#getAgentDefinition packages/core/src/install.ts#isPlainObject packages/core/src/install.ts#mergeClaudeCodeSettings packages/core/src/install.ts#mergeMcpServersJson packages/core/src/install.ts#mergeTomlManagedBlock packages/core/src/install.ts#pathExists packages/core/src/install.ts#planAgentHook packages/core/src/install.ts#planGitHook packages/core/src/install.ts#planInstall packages/core/src/install.ts#planMcpConfig packages/core/src/install.ts#planPointer packages/core/src/install.ts#planSkill packages/core/src/install.ts#readIfExists packages/core/src/install.ts#renderTomlManagedBlock packages/core/src/install.ts#renderYamlManagedBlock packages/core/src/install.ts#stopEntryCommands packages/core/src/install.ts#stripJsoncComments -->

`install.ts` is the implementation of `livewiki install`. Every write target lives outside the repository allowlist (home-directory agent configs), so the module deliberately bypasses `safe-io`; the bytes of every write are computed up front by `planInstall` and the CLI surfaces them through `--print` before any write occurs.

```ts
export const AGENT_REGISTRY: readonly AgentDefinition[]
```

```ts
export const SHARED_SKILL_TARGET = ".agents/skills/document-as-you-go/SKILL.md";
```

```ts
export const TOML_BLOCK_START = "# livewiki:start";
export const TOML_BLOCK_END = "# livewiki:end";
```

`AGENT_REGISTRY` is the read-only list of supported coding agents and their probe/merge metadata. The registry explicitly excludes `minimax`/`mmx` — that CLI is an LLM provider with no MCP-host convention, so `livewiki install` has nothing to configure. `SHARED_SKILL_TARGET` is the path agents that honor `~/.agents/skills/` are pointed at. `TOML_BLOCK_START` and `TOML_BLOCK_END` are the sentinel lines used to delimit the managed block that the install pipeline injects into Codex's `config.toml`.

```ts
export function getAgentDefinition(id: string): AgentDefinition | undefined
```

```ts
export async function detectAgents(opts: {
```

`getAgentDefinition` looks up an agent by id. `detectAgents` probes both home-directory config files and PATH binaries (Windows variants like `.cmd` included) and returns a per-agent detection result with `detected` plus an `evidence` list. The `install.test.ts` excerpt verifies that detected agents cite a specific evidence line (e.g. `config found: ~/.claude`) and that undetected agents report both the missing config probe and the missing PATH binary.

```ts
export function buildMcpEntry(repoRoot: string): McpEntry
```

```ts
export function buildLocalCommandEntry(repoRoot: string): LocalCommandMcpEntry
```

`buildMcpEntry` constructs the standard MCP entry used by JSON-shaped configs. `buildLocalCommandEntry` builds the local-command variant used by agents whose config shape is `json-local-command` (opencode).

```ts
function isPlainObject(v: unknown): v is Record<string, unknown>
```

```ts
function deepEqual(a: unknown, b: unknown): boolean
```

`isPlainObject` is a guard used by the JSON merge adapters to identify object nodes that should be recursed into rather than replaced wholesale. `deepEqual` compares two values structurally; both helpers together let the merger skip no-op writes when the livewiki entry is already byte-identical.

```ts
export function stripJsoncComments(text: string): string
```

`stripJsoncComments` is the string-aware JSONC comment stripper used for agents whose config files allow JSONC. Comment-aware stripping preserves string contents; a rewrite after stripping re-emits plain JSON, and the action reason surfaces the comment loss to the user.

```ts
export function mergeMcpServersJson(
```

```ts
export function mergeTomlManagedBlock(
```

```ts
export function mergeClaudeCodeSettings(
```

`mergeMcpServersJson` produces a result object describing whether the merged MCP servers JSON should be written, skipped, or refused, and supplies the new content payload. `mergeTomlManagedBlock` is the equivalent for Codex's `config.toml`, working on a delimited block delimited by `TOML_BLOCK_START`/`TOML_BLOCK_END` without parsing TOML. `mergeClaudeCodeSettings` merges the shipped Stop-hook template into the agent's settings while preserving unrelated keys.

```ts
export function renderTomlManagedBlock(repoRoot: string): string
```

```ts
export function renderYamlManagedBlock(repoRoot: string): string
```

`renderTomlManagedBlock` and `renderYamlManagedBlock` produce the canonical managed-block payloads (TOML for Codex, YAML for Hermes) that the merger later diffs against on-disk content.

```ts
function stopEntryCommands(entry: unknown): string[]
```

`stopEntryCommands` extracts the command strings from a Claude Code `Stop`-hook entry so the merger can decide whether an existing livewiki hook already matches.

```ts
async function pathExists(abs: string): Promise<boolean>
```

```ts
async function readIfExists(abs: string): Promise<string | null>
```

`pathExists` and `readIfExists` are the file-system primitives shared by every planner and merger; `readIfExists` returns `null` instead of throwing when the file is missing.

```ts
async function planMcpConfig(
```

```ts
async function planAgentHook(
```

```ts
async function planSkill(
```

```ts
async function planGitHook(
```

```ts
async function planPointer(
```

`planMcpConfig`, `planAgentHook`, `planSkill`, `planGitHook`, and `planPointer` each compute the actions for one facet of the install. Together they cover MCP server entries, the Claude Code Stop hook, the shared skill file at `SHARED_SKILL_TARGET`, the git post-commit hook template, and the opt-in `AGENTS.md`/`CLAUDE.md` pointer. The pointer is gated by `writePointer: true`; without it the action is `requires-opt-in` and `applyInstall` never writes it. The planners refuse rather than merge when a foreign file is present at the target.

```ts
export async function planInstall(opts: PlanInstallOptions): Promise<InstallAction[]>
```

```ts
export async function applyInstall(
```

`planInstall` is the orchestrator: it returns an exhaustive list of `InstallAction` items that the CLI shows before writing. `applyInstall` is the write phase; it executes only the actions that were approved, applies the safety rule that an existing foreign git hook, an unparseable JSON config, or a different file at the skill target is a refusal rather than a merge attempt, and requires explicit opt-in for pointer writes.

## Test regression helpers

<!-- lw:anchors packages/core/src/indexer.test.ts#activeSymbolsForKey packages/core/src/indexer.test.ts#rationalesForFile packages/core/src/install.test.ts#writeHome packages/core/src/key-leak.test.ts#assertCanaryNotPresent packages/core/src/key-leak.test.ts#generate packages/core/src/manifest.test.ts#writeLivewikiFile -->

The test suites share small filesystem and assertion helpers that show up across the indexer, install, key-leak, and manifest specs.

```ts
async function activeSymbolsForKey(key: string): Promise<ActiveSymbolRow[]>
```

```ts
async function rationalesForFile(path: string): Promise<RationaleQueryRow[]>
```

`activeSymbolsForKey` opens the indexer database in read-only mode and selects the rows from `symbols` whose `status` is `active` for the given key. `rationalesForFile` reads the rationales attached to a file path so indexer tests can assert on the persisted rationale evidence.

```ts
async function writeHome(rel: string, content: string): Promise<void>
```

`writeHome` writes a fixture file into a per-test home directory under the path `rel`, creating any missing parent directories — the install suite uses it to stage `~/.claude`, `~/.codex`, and other agent configs before calling `detectAgents` and the merger.

```ts
function assertCanaryNotPresent(value: string, context: string): void
```

```ts
async generate() {
```

`assertCanaryNotPresent` is the gatekeeper of the key-leak regression suite. It scans a string for the canary value `KEY-LEAK-CANARY-DONOTUSE-7f3a` and throws with the context label when the canary appears, so any test that exercises error messages, JSON serializations, console captures, or adapter stack traces must not include the canary. The companion `generate` method is the body hook called by the suite to drive LLM adapter paths with the canary key set.

```ts
async function writeLivewikiFile(relPath: string, content: string): Promise<void>
```

`writeLivewikiFile` writes a file under `livewiki/` (or any repo-relative path) for the manifest suite, creating the parent directory on demand. The suite uses it to stage pages, assert that `computeSnapshotHash` is stable and changes when content changes, and confirm that the manifest file itself is excluded from the snapshot hash.

<!-- livewiki:navigate:start -->
## Navigate

- [Core Repair, Status, Sectioning, Symbols, and Risk Pipeline](core-src-11.md) — dependency and dependent
- [Core runtime config, schema, diagrams, diff preview, and export](core-src-05.md) — dependency and dependent
- [Core module identification, manifest I/O, and Markdown mask helpers](core-src-08.md) — dependency and dependent

> Coverage note: this module's source (12 files, ~205k chars) exceeded the prompt budget and was excerpted; this page documents the closed-list symbols.
<!-- livewiki:navigate:end -->
