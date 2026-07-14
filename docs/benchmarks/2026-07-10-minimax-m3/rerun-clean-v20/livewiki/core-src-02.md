---
title: Core pipeline orchestration, config, schema, and helpers
owner: generated
anchors:
  - packages/core/src/batch.ts#EmptyPipelineError
  - packages/core/src/batch.ts#EmptyPipelineError.constructor
  - packages/core/src/batch.ts#TaskError
  - packages/core/src/batch.ts#TaskError.constructor
  - packages/core/src/batch.ts#emptyUsage
  - packages/core/src/batch.ts#aggregateTotals
  - packages/core/src/batch.ts#accumulateUsage
  - packages/core/src/batch.ts#getOrCreateTask
  - packages/core/src/batch.ts#createOrGetTask
  - packages/core/src/batch.ts#safeJsonParse
  - packages/core/src/batch.ts#validateRefinedModules
  - packages/core/src/batch.ts#collectAllImports
  - packages/core/src/batch.ts#readOwnerFromFrontmatter
  - packages/core/src/batch.ts#forceOwnerInFrontmatter
  - packages/core/src/batch.ts#extractManualBlocksBySection
  - packages/core/src/batch.ts#slugifyHeadingText
  - packages/core/src/batch.ts#injectManualBlocksBySection
  - packages/core/src/batch.ts#sectionRangeOf
  - packages/core/src/batch.ts#tryWriteAndVerify
  - packages/core/src/batch.ts#verifyIssuesToValidationErrors
  - packages/core/src/batch.ts#summarizeLlmDiagnosticError
  - packages/core/src/batch.ts#summarizeVerifyDiagnosticErrors
  - packages/core/src/batch.ts#diagnosticAttempt
  - packages/core/src/batch.ts#attemptStage4Generation
  - packages/core/src/batch.ts#computeCostFromUsage
  - packages/core/src/batch.ts#buildModuleDocContext
  - packages/core/src/batch.ts#buildFairTruncatedSource
  - packages/core/src/batch.ts#getFileIdsForModule
  - packages/core/src/batch.ts#finalizeRun
  - packages/core/src/batch.ts#buildResult
  - packages/core/src/batch.ts#statusToExitCode
  - packages/core/src/batch.ts#orchestrate
  - packages/core/src/batch.ts#resumeBatch
  - packages/core/src/batch.ts#runBatch
  - packages/core/src/batch.ts#runOnly
  - packages/core/src/config.ts#CONFIG_DEFAULTS
  - packages/core/src/config.ts#CONFIG_FILENAME
  - packages/core/src/config.ts#CONFIG_PATH
  - packages/core/src/config.ts#MAX_TIMEOUT_MS
  - packages/core/src/config.ts#MissingProviderConfigError
  - packages/core/src/config.ts#MissingProviderConfigError.constructor
  - packages/core/src/config.ts#applyDefaults
  - packages/core/src/config.ts#assertValidTimeoutMs
  - packages/core/src/config.ts#loadConfig
  - packages/core/src/config.ts#resolveBaseUrl
  - packages/core/src/config.ts#resolveProviderFromConfig
  - packages/core/src/config.ts#saveConfig
  - packages/core/src/config.ts#validateConfigForBatch
  - packages/core/src/config.ts#validateConfigShape
  - packages/core/src/db.ts#CURRENT_SCHEMA_VERSION
  - packages/core/src/db.ts#MIGRATION_SQL_V3
  - packages/core/src/db.ts#SCHEMA_SQL
  - packages/core/src/db.ts#SCHEMA_VERSION_KEY
  - packages/core/src/db.ts#migrateV3ToV4
  - packages/core/src/db.ts#migrationsFor
  - packages/core/src/db.ts#openIndex
  - packages/core/src/db.ts#postV3Migrations
  - packages/core/src/diagrams.ts#classIdentity
  - packages/core/src/diagrams.ts#escapeLabel
  - packages/core/src/diagrams.ts#generateClassDiagram
  - packages/core/src/diagrams.ts#generateModulesGraph
  - packages/core/src/diagrams.ts#generateStructure
  - packages/core/src/diagrams.ts#mermaidId
  - packages/core/src/diagrams.ts#mermaidMemberName
  - packages/core/src/diagrams.ts#moduleSlug
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
  - packages/core/src/hashes.ts#sha256
  - packages/core/src/hashes.ts#sha256Slice
---

# Core pipeline orchestration, config, schema, and helpers

This page documents the core orchestration module that drives livewiki's resumable batch pipeline, the persistent SQLite index, the per-repo configuration loader, the deterministic Mermaid diagram emitter, the YAML-subset frontmatter parser, the idempotent `.gitignore` block writer, and the content-hash helpers.

## When to use this page

- **Run, resume, or re-run a single** batch task by invoking `runBatch`, `resumeBatch`, or `runOnly` and inspecting the returned `BatchRunResult`.
- **Load or validate a repo's `.livewiki/config.json`** with `loadConfig`, `applyDefaults`, `validateConfigForBatch`, and `MissingProviderConfigError` before any LLM stage.
- **Open the SQLite index** with `openIndex`, inspect `CURRENT_SCHEMA_VERSION`, and apply pending migrations via `migrationsFor`, `migrateV3ToV4`, and `postV3Migrations`.
- **Render deterministic architecture diagrams** by calling `generateStructure`, `generateModulesGraph`, or `generateClassDiagram`, and slug modules with `moduleSlug`.

## How it fits

This module sits at the center of the `packages/core` workspace. `batch.ts` is the orchestration heart: it loads the config, opens the SQLite index via `db.ts`, runs the indexer, walks imports through `imports.ts`, classifies modules, and dispatches stage-4 LLM documentation with bounded repair attempts. Configuration flows in from `config.ts`, which is the only file that knows the `.livewiki/config.json` schema and the timeout envelope (`MAX_TIMEOUT_MS`). Diagram emission is purely deterministic and lives in `diagrams.ts`, called from the architecture-overview regeneration paths. Frontmatter parsing is encapsulated in `frontmatter.ts`, while `gitignore.ts` enforces that `.livewiki/` is never committed. `hashes.ts` is a thin wrapper over Node's crypto, used by both the indexer (file/symbol content hashes) and the manifest writer.

## Pipeline orchestration entry points

<!-- lw:anchors packages/core/src/batch.ts#runBatch packages/core/src/batch.ts#resumeBatch packages/core/src/batch.ts#runOnly packages/core/src/batch.ts#orchestrate packages/core/src/batch.ts#EmptyPipelineError packages/core/src/batch.ts#EmptyPipelineError.constructor packages/core/src/batch.ts#TaskError packages/core/src/batch.ts#TaskError.constructor -->

`runBatch` is the from-scratch entry point:

```ts
export async function runBatch(opts: BatchOptions): Promise<BatchRunResult>
```

It delegates immediately to `orchestrate({ ...opts, mode: "run" })`. The same delegation pattern is used by `resumeBatch` (mode `"resume"`) and `runOnly` (mode `"only"`); `runOnly` requires `opts.onlyTarget` and throws a plain `Error` if it is missing before calling `orchestrate`. `orchestrate` extends `BatchOptions` with an internal `mode` discriminant and is the single function that performs config load, index open, module identification, prioritization, and stage-4 dispatch.

Two custom error classes participate in this layer. `EmptyPipelineError` extends `Error` and signals that the pipeline produced no modules to document — its constructor takes a `message: string`. `TaskError` is the per-task failure shape used in checkpoints and summaries; its constructor is `constructor(code: string, message: string)` and carries a stable `code` plus a free-form `message`.

## Per-task state and checkpoint helpers

<!-- lw:anchors packages/core/src/batch.ts#emptyUsage packages/core/src/batch.ts#aggregateTotals packages/core/src/batch.ts#accumulateUsage packages/core/src/batch.ts#getOrCreateTask packages/core/src/batch.ts#createOrGetTask packages/core/src/batch.ts#safeJsonParse -->

`emptyUsage` returns a fresh `StageUsage` zero record used to initialize a task's accounting. Two helpers merge partial records: `aggregateTotals(a: StageUsage, b: StageUsage): StageUsage` combines two completed snapshots, while `accumulateUsage` adds usage into an existing accumulator (its parameter list is not visible in the truncated excerpt, so its exact arity is not established here). `getOrCreateTask` and `createOrGetTask` resolve the `batch_tasks` row for a given `(runId, stage, target)`; the visible distinction is naming only — both names appear as the canonical lookup and upsert helpers. `safeJsonParse<T>(s: string): T | null` wraps `JSON.parse` and returns `null` on failure rather than throwing, used wherever checkpoint JSON is read from disk.

## Module identification, imports, and refinement validation

<!-- lw:anchors packages/core/src/batch.ts#collectAllImports packages/core/src/batch.ts#validateRefinedModules packages/core/src/batch.ts#buildModuleDocContext packages/core/src/batch.ts#getFileIdsForModule packages/core/src/batch.ts#buildFairTruncatedSource -->

`collectAllImports` walks the file list asynchronously and aggregates import edges that feed `resolveModuleEdges`. `validateRefinedModules` is the structural gate on the stage-2 LLM output: it runs after `applyRefinedDisplayTitles` and before prioritization, and rejects refinement payloads that violate uniqueness or partition invariants. `buildModuleDocContext` assembles the per-task prompt payload — module metadata, file lists, symbols, and the truncated source produced by `buildFairTruncatedSource`. `getFileIdsForModule` resolves the integer `files.id` rows for a module's paths and is used to scope queries that follow the module partition:

```ts
async function getFileIdsForModule(absRoot: string, module: Module): Promise<number[]>
```

`buildFairTruncatedSource` is exported (noted by the `export` keyword on its declaration) and is the budget-aware source truncator invoked when the module exceeds `contextCharBudget`.

## Frontmatter ownership and manual-block preservation

<!-- lw:anchors packages/core/src/batch.ts#readOwnerFromFrontmatter packages/core/src/batch.ts#forceOwnerInFrontmatter packages/core/src/batch.ts#extractManualBlocksBySection packages/core/src/batch.ts#injectManualBlocksBySection packages/core/src/batch.ts#slugifyHeadingText packages/core/src/batch.ts#sectionRangeOf packages/core/src/frontmatter.ts#FrontmatterParseError packages/core/src/frontmatter.ts#FrontmatterParseError.constructor packages/core/src/frontmatter.ts#parseFrontmatter packages/core/src/frontmatter.ts#parseYamlBlock packages/core/src/frontmatter.ts#stripComment packages/core/src/frontmatter.ts#getAnchors packages/core/src/frontmatter.ts#getOwner -->

The owner-checking path is `readOwnerFromFrontmatter`, which inspects raw page content:

```ts
function readOwnerFromFrontmatter(content: string | null): PreOwnerCheck
```

It returns a `PreOwnerCheck` describing whether the existing frontmatter is absent, `generated`, `human`, or `mixed`. `forceOwnerInFrontmatter(content: string, owner: "generated" | "mixed")` rewrites the owner field while preserving `lw:manual` blocks byte-for-byte; it refuses `owner: "human"` per rule #6 (manual content is sacred).

Manual-block round-tripping uses two helpers: `extractManualBlocksBySection` returns a `Map<string | null, string[]>` keyed by H1 (or `null` for blocks before the first H1) of the manual block payloads, and `injectManualBlocksBySection` reinserts them into the new document, returning `null` when nothing could be re-injected. `slugifyHeadingText` converts a heading into the same slug form used by anchors and the manual-block map. `sectionRangeOf(headingOffset: number)` returns `{ endOffset: number }` marking the end of the H1's section so the caller knows where to splice the preserved manual content back in.

The frontmatter parser is a deliberate YAML subset: `parseFrontmatter(source: string): ParseResult` returns `{ frontmatter, body, bodyOffset }` or `frontmatter: null` when the page lacks a `---` opener. `parseYamlBlock` performs the line-by-line scan, building either string values or `string[]` lists; `stripComment` truncates content at the first ` #` that is not inside a string. On malformed input, `parseFrontmatter` throws `FrontmatterParseError`, whose constructor is `constructor(message: string, line: number)` and exposes the offending line. Two read-side helpers expose frontmatter to other code: `getAnchors(fm: Frontmatter | null): string[]` always returns a list, and `getOwner(fm: Frontmatter | null): "generated" | "human" | "mixed"` defaults to `"generated"` when the field is absent or unrecognized.

## Write–verify transactional path and diagnostic summarization

<!-- lw:anchors packages/core/src/batch.ts#tryWriteAndVerify packages/core/src/batch.ts#verifyIssuesToValidationErrors packages/core/src/batch.ts#summarizeLlmDiagnosticError packages/core/src/batch.ts#summarizeVerifyDiagnosticErrors packages/core/src/batch.ts#diagnosticAttempt packages/core/src/batch.ts#attemptStage4Generation packages/core/src/batch.ts#computeCostFromUsage packages/core/src/batch.ts#finalizeRun packages/core/src/batch.ts#buildResult packages/core/src/batch.ts#statusToExitCode -->

`tryWriteAndVerify` is the transactional writer: it snapshots, writes, and verifies, restoring from snapshot on verify failure. `verifyIssuesToValidationErrors` translates `VerifyIssue` records from `verify.ts` into the `ArtifactValidationError[]` shape consumed by the repair prompt. Two summarizers feed user-facing diagnostic output: `summarizeLlmDiagnosticError` handles a single LLM error object, while `summarizeVerifyDiagnosticErrors` reduces a list of verify issues to a digest string. `diagnosticAttempt` wraps one full try / repair / retry cycle with bounded attempt counts. `attemptStage4Generation` is the actual LLM call site for stage 4 (and its bounded repairs). `computeCostFromUsage` converts a `StageUsage` record into a USD cost using the resolved pricing model.

At the end of the run, `finalizeRun` writes the `batch_runs` summary row, `buildResult` assembles the `BatchRunResult` returned to the caller, and `statusToExitCode` (exported) maps a run status string to a process exit code:

```ts
export function statusToExitCode(
)
```

The signature in the symbols table is truncated after the open paren; only the `export function statusToExitCode(` portion is established by the supplied source.

## Configuration loading, defaults, and validation

<!-- lw:anchors packages/core/src/config.ts#CONFIG_DEFAULTS packages/core/src/config.ts#CONFIG_FILENAME packages/core/src/config.ts#CONFIG_PATH packages/core/src/config.ts#MAX_TIMEOUT_MS packages/core/src/config.ts#MissingProviderConfigError packages/core/src/config.ts#MissingProviderConfigError.constructor packages/core/src/config.ts#applyDefaults packages/core/src/config.ts#assertValidTimeoutMs packages/core/src/config.ts#loadConfig packages/core/src/config.ts#resolveBaseUrl packages/core/src/config.ts#resolveProviderFromConfig packages/core/src/config.ts#saveConfig packages/core/src/config.ts#validateConfigForBatch packages/core/src/config.ts#validateConfigShape -->

Two path constants describe the on-disk config: `CONFIG_PATH` (`export const CONFIG_PATH = CONFIG_REL_PATH`) and `CONFIG_FILENAME` (`export const CONFIG_FILENAME = nodePath.basename(CONFIG_REL_PATH)`). `MAX_TIMEOUT_MS` is `export const MAX_TIMEOUT_MS = 2_147_483_647`, the Node `setTimeout` safe upper bound. `CONFIG_DEFAULTS` is the runtime-only defaults object — note that it is NOT written back to the config file; defaults like `language: "en"`, `languages: ["ts","tsx","js","jsx","py"]`, `maxRepairAttempts: 2`, `maxIncompleteRetries: 2`, `stage4MaxOutputTokens: 8192`, `maxModuleFiles: 12`, `maxModuleSymbols: 80`, and `timeoutMs: 300_000` are layered in at use time.

`loadConfig(repoRoot: string): Promise<LivewikiConfig>` returns `{}` when the file is missing or empty, and throws on malformed JSON. `applyDefaults(config: LivewikiConfig): LivewikiConfig` fills in the runtime defaults. `validateConfigShape` is the structural validator used by `loadConfig`; it rejects non-integer `maxRepairAttempts` and `maxIncompleteRetries`, floats, NaN, and strings. `assertValidTimeoutMs` is the assertion guard used both at config load and at programmatic `createLlmClient` paths:

```ts
export function assertValidTimeoutMs(v: unknown): asserts v is number
```

It throws when `v` is not an integer in `0..MAX_TIMEOUT_MS`. `resolveBaseUrl(config: LivewikiConfig): string` returns the per-provider base URL, falling back to `CONFIG_DEFAULTS.baseUrls` when the config omits one. `resolveProviderFromConfig` resolves the effective preset / provider / model triple. `saveConfig` writes `.livewiki/config.json` back to disk.

`MissingProviderConfigError` is raised by `validateConfigForBatch(repoRoot, config)` when `provider` or `model` is missing before an LLM stage runs:

```ts
constructor(repoRoot: string, missingFields: Array<"provider" | "model">)
```

Its message points the user at `.livewiki/config.json` and includes a concrete example block; it sets `name = "MissingProviderConfigError"` and stores `repoRoot` on the instance.

## SQLite schema, migrations, and index open

<!-- lw:anchors packages/core/src/db.ts#CURRENT_SCHEMA_VERSION packages/core/src/db.ts#SCHEMA_VERSION_KEY packages/core/src/db.ts#SCHEMA_SQL packages/core/src/db.ts#MIGRATION_SQL_V3 packages/core/src/db.ts#migrateV3ToV4 packages/core/src/db.ts#migrationsFor packages/core/src/db.ts#openIndex packages/core/src/db.ts#postV3Migrations -->

The persistent index lives at `<repoRoot>/.livewiki/index.db` and is derived from the repo markdown (rule #3). `CURRENT_SCHEMA_VERSION` is `export const CURRENT_SCHEMA_VERSION = 4`. `SCHEMA_VERSION_KEY` is the `meta` row key under which the running version is stored (`"schema_version"`). `SCHEMA_SQL` is the idempotent set of `CREATE TABLE / CREATE INDEX IF NOT EXISTS` statements for files, symbols, meta, anchors, debt, undocumented, batch_runs, batch_tasks, doc_pages, and manual_blocks — and it includes the partial unique index `idx_symbols_active_key ON symbols(key) WHERE status = 'active'` that lets soft-deleted rows coexist with reinserted ones. `MIGRATION_SQL_V3` is the v2 → v3 SQL (adds `debt.symbol_key`, rebuilds `symbols` to drop the inline UNIQUE, recreates the partial unique index, and adds `idx_debt_open`).

`openIndex(dbPath: string): Database.Database` opens (and creates, if needed) the SQLite file. `migrateV3ToV4(db: Database.Database): void` is the JS function for v3 → v4: it inspects `PRAGMA table_info(batch_runs)` before each `ALTER TABLE ADD COLUMN` (SQLite has no `ADD COLUMN IF NOT EXISTS`) and adds `finished_at`, `started_by`, and `summary_json`. It then creates the `batch_runs.status` and `batch_tasks` indexes. `migrationsFor(fromVersion, toVersion)` returns the ordered list of migrations; the supplied excerpt is truncated after declaring the `out` array, so the exact return shape beyond an `Array<string | ((db: Database.Database) => void)>` is not established here. `postV3Migrations` runs the migrations that apply on top of v3 (its parameter list is not visible in the truncated excerpt).

## Deterministic Mermaid diagram emission

<!-- lw:anchors packages/core/src/diagrams.ts#moduleSlug packages/core/src/diagrams.ts#generateStructure packages/core/src/diagrams.ts#generateModulesGraph packages/core/src/diagrams.ts#generateClassDiagram packages/core/src/diagrams.ts#classIdentity packages/core/src/diagrams.ts#mermaidId packages/core/src/diagrams.ts#mermaidMemberName packages/core/src/diagrams.ts#escapeLabel -->

Diagram generation is entirely deterministic — no LLM is involved. `moduleSlug(value: string): string` lowercases, strips diacritics via Unicode NFD, replaces non-alphanumerics with `-`, and trims leading/trailing dashes; it is reused as both a Mermaid identifier base and a filename slug. `generateStructure(filePaths: string[]): string` emits a `graph TD` tree of the repository directory layout, deduplicating nodes and edges. `generateModulesGraph(edges: ModuleGraphEdge[]): string` emits a `graph LR` import graph; when `edges` is empty it produces a single `root[No module edges detected]` node instead of an empty graph. `generateClassDiagram(module: Module, symbols: SymbolRow[]): string` filters `symbols` to `kind === "class"` whose file path is inside `module.paths`, sorts them by `key`, and groups methods by full `(path, className)` identity via `classIdentity`. If no class symbols are present, it returns the empty string. `classIdentity(path: string, className: string): string` is the canonical `JSON.stringify([path, className])` key used by both `generateClassDiagram` and the methods map. `mermaidId(value: string)` replaces any non-alphanumeric character with `_`. `mermaidMemberName(value: string)` sanitizes a method name for Mermaid, returning the literal `"method"` for inputs that sanitize to the empty string. `escapeLabel(value: string)` HTML-escapes the four characters that break Mermaid labels: `&`, `"`, `[`, `]`.

## Idempotent `.gitignore` block writer

<!-- lw:anchors packages/core/src/gitignore.ts#readGitignore packages/core/src/gitignore.ts#ensureGitignoreEntries packages/core/src/gitignore.ts#extractManagedBlock packages/core/src/gitignore.ts#mergeBlockLines packages/core/src/gitignore.ts#renderBlock packages/core/src/gitignore.ts#replaceManagedBlock -->

`readGitignore(repoRoot: string): Promise<string>` returns the existing `.gitignore` content or `""` if it does not exist. `ensureGitignoreEntries(repoRoot, entries)` is the public entry point: it reads the file, extracts any existing managed block via `extractManagedBlock`, computes the set of already-present entries (either inside the block, or — when no block exists — across non-comment, non-blank lines), and writes only the missing entries. On a clean write it returns `{ file, changed: true, added: missing }`; when nothing is missing it returns `{ file, changed: false, added: [] }` and does not touch the file. `extractManagedBlock(content)` is regex-tolerant of whitespace in the markers and returns `{ lines: string[] } | null`; it returns `null` when only the start marker is present (truncated block is ignored). `mergeBlockLines(existing, toAdd)` preserves caller order — existing lines first, then new lines — and dedupes by trimmed string. `renderBlock(lines)` produces the literal text delimited by `# livewiki:start` / `# livewiki:end`. `replaceManagedBlock(content, newBlock)` swaps the existing block in place when both markers exist, otherwise appends the block at end-of-file with the correct separator newline.

## Content hashing

<!-- lw:anchors packages/core/src/hashes.ts#sha256 packages/core/src/hashes.ts#sha256Slice -->

`sha256(content: string | Uint8Array): string` returns the lowercase hex SHA-256 of either a string or byte buffer. It is the only hash function used by the indexer (for `files.content_hash`) and the manifest writer. `sha256Slice(source: string, startByte: number, endByte: number): string` is the per-symbol hash — it slices the source by byte offset and delegates to `sha256`. This is what makes local-symbol change detection possible without re-parsing the entire file: the file-level hash stays stable while the symbol-level hash flips.

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
- [Core navigation, parsing, pointer, presets, pricing, prompts, safe I/O, and status surface](core-src-04.md) — dependency and dependent
- [anchor ledger, artifact validation, and batch status](core-src-01.md) — dependency and dependent
- [core SRC — incremental update, verification and walker](core-src-05.md) — dependency and dependent
<!-- livewiki:navigate:end -->
