---
title: Batch Pipeline Orchestrator
owner: generated
anchors:
  - packages/core/src/batch.ts#EmptyPipelineError
  - packages/core/src/batch.ts#EmptyPipelineError.constructor
  - packages/core/src/batch.ts#TaskError
  - packages/core/src/batch.ts#TaskError.constructor
  - packages/core/src/batch.ts#accumulateUsage
  - packages/core/src/batch.ts#aggregateTotals
  - packages/core/src/batch.ts#attemptFolderGeneration
  - packages/core/src/batch.ts#attemptStage4Generation
  - packages/core/src/batch.ts#attemptStage5Generation
  - packages/core/src/batch.ts#attemptTopicGeneration
  - packages/core/src/batch.ts#attemptUnderstandingGeneration
  - packages/core/src/batch.ts#buildFairTruncatedSource
  - packages/core/src/batch.ts#buildFlowDocContext
  - packages/core/src/batch.ts#buildModuleDocContext
  - packages/core/src/batch.ts#buildResult
  - packages/core/src/batch.ts#buildSurgicalEvidenceSlice
  - packages/core/src/batch.ts#buildTopicDocContext
  - packages/core/src/batch.ts#computeCostFromUsage
  - packages/core/src/batch.ts#createOrGetTask
  - packages/core/src/batch.ts#diagnosticAttempt
  - packages/core/src/batch.ts#drainPendingMetrics
  - packages/core/src/batch.ts#emptyUsage
  - packages/core/src/batch.ts#extractManualBlocksBySection
  - packages/core/src/batch.ts#finalizeRun
  - packages/core/src/batch.ts#forceOwnerInFrontmatter
  - packages/core/src/batch.ts#generateOversizedFilePage
  - packages/core/src/batch.ts#getFileIdsForModule
  - packages/core/src/batch.ts#getModuleSymbolRows
  - packages/core/src/batch.ts#getOrCreateTask
  - packages/core/src/batch.ts#getRationaleEvidenceForPaths
  - packages/core/src/batch.ts#injectManualBlocksBySection
  - packages/core/src/batch.ts#isArtifactVerifyCode
  - packages/core/src/batch.ts#isDeferredBaselineIssue
  - packages/core/src/batch.ts#isRelaxedEligible
  - packages/core/src/batch.ts#orchestrate
  - packages/core/src/batch.ts#prepareSurgicalRepair
  - packages/core/src/batch.ts#readOwnerFromFrontmatter
  - packages/core/src/batch.ts#recoverStage4TaskArtifacts
  - packages/core/src/batch.ts#resetTaskToPending
  - packages/core/src/batch.ts#resolveOutputTokenBudget
  - packages/core/src/batch.ts#resumeBatch
  - packages/core/src/batch.ts#rollbackWrittenArtifacts
  - packages/core/src/batch.ts#runBatch
  - packages/core/src/batch.ts#runOnly
  - packages/core/src/batch.ts#runSemanticTopicStage
  - packages/core/src/batch.ts#runUnderstandingStage
  - packages/core/src/batch.ts#safeJsonParse
  - packages/core/src/batch.ts#sectionRangeOf
  - packages/core/src/batch.ts#slugifyHeadingText
  - packages/core/src/batch.ts#statusToExitCode
  - packages/core/src/batch.ts#summarizeLlmDiagnosticError
  - packages/core/src/batch.ts#summarizeVerifyDiagnosticErrors
  - packages/core/src/batch.ts#topicAttemptDiagnostic
  - packages/core/src/batch.ts#topicPlanDiagnostic
  - packages/core/src/batch.ts#tryWriteAndVerify
  - packages/core/src/batch.ts#tryWriteFlowAndVerify
  - packages/core/src/batch.ts#tryWriteModuleDiagramAndVerify
  - packages/core/src/batch.ts#understandingAttemptDiagnostic
  - packages/core/src/batch.ts#verifyIssuesToValidationErrors
---

# Batch Pipeline Orchestrator

This page documents the full batch documentation pipeline runner for the livewiki project.

## When to use this page

- Understand how the four-stage batch documentation pipeline (scan, module identification, prioritization, coordinated documentation) is orchestrated end-to-end.
- Learn how to invoke or resume a batch run, re-run a single task with `--only`, or interpret the run result's status fields and failure lists.
- Trace how task failures, circuit breakers, repair slots, degraded completions, and rollback failures are handled across stages.
- See how stage-5 flow and topic artifacts, understanding synthesis, and navigation hubs are coordinated after the core module pages.

## How it fits

`batch.ts` is the orchestrator that drives the entire documentation pipeline for a repository: it scans the codebase, partitions it into real file/folder page units, prioritizes those units, and then coordinates LLM-driven page generation with bounded repair loops, transactional writes, and verification. It sits at the top of the pipeline, delegating each step to dedicated modules: `indexer.ts` for scanning, `modules.ts` for partitioning and prioritization, `prompts.ts` for prompt construction, `artifact.ts` for artifact normalization and validation, and `verify.ts` for post-write verification. The file also implements the run/resume/only modes of the `livewiki batch` CLI command, managing checkpoint state in the SQLite index database and the run manifest.

The orchestrator enforces key invariants: human-owned pages are never rewritten, `lw:manual` blocks are preserved byte-for-byte, exact path partitions are asserted before generation, and hardware-level failures (like rollback failure) abort the entire run rather than continuing with potentially inconsistent disk state. It supports optional stages for flow diagrams, topic pages, and a repository-wide understanding synthesis, each with its own gating flags and bounded repair machinery.

## Batch entry points and orchestration modes
<!-- lw:anchors packages/core/src/batch.ts#runBatch packages/core/src/batch.ts#resumeBatch packages/core/src/batch.ts#runOnly packages/core/src/batch.ts#orchestrate -->

The four public entry points in this file are thin wrappers that all funnel into a single private orchestrator. `runBatch`, `resumeBatch`, and `runOnly` each accept a `BatchOptions` object, stamp it with a distinct mode string, and delegate to `orchestrate`. `resumeBatch` uses mode `"resume"`, `runOnly` uses `"only"`, and `runBatch` uses `"run"`. The `runOnly` wrapper adds one guard: if `opts.onlyTarget` is missing, it throws an `Error` with the message `"onlyTarget is required for runOnly"` before ever reaching the orchestrator.

```ts
export async function runBatch(opts: BatchOptions): Promise<BatchRunResult> {
```
This function takes batch options and returns a `BatchRunResult` — the full outcome of a batch processing run, including per-module results, usage statistics, and any failures encountered.

```ts
export async function resumeBatch(opts: BatchOptions): Promise<BatchRunResult> {
```
This function takes batch options and returns a `BatchRunResult` — it resumes a previously initiated batch run from its last recorded state rather than starting fresh.

```ts
export async function runOnly(opts: BatchOptions): Promise<BatchRunResult> {
```
This function takes batch options and returns a `BatchRunResult` — it executes only a single targeted task (specified via `onlyTarget`) within an existing batch run.

```ts
async function orchestrate(opts: OrchestrateOpts): Promise<BatchRunResult> {
```
This private function takes orchestration options (which extend batch options with the mode) and returns a `BatchRunResult` — it is the single implementation that all public entry points share.

## The orchestration pipeline

`orchestrate` is the heart of the batch system. It begins by resolving the repository root to an absolute path, creating the `.livewiki` directory if it does not exist, and opening the SQLite index database that persists run state. It then loads configuration from disk (unless injected), applies defaults, and determines the effective language — preferring an explicit option, falling back to config, and defaulting to `"en"`.

The next block resolves a series of tuning parameters, each following the same precedence pattern of option, then config, then built-in default. These include `maxRepairAttempts` (default 2), `maxIncompleteRetries` (default 2), `batchConcurrency` (clamped to 1–16), and boolean toggles like `surgicalRepair`, `relaxedRound`, `moduleDiagramsEnabled`, `concernTopics`, and `understandingSynthesis`. Each value is validated — non-integer or out-of-range numbers throw descriptive errors. The `moduleDiagramBudgets` object is built only when module diagrams are enabled, pulling node and edge maxima from config with defaults.

The LLM client is created lazily. If the caller injected one, it is reused; otherwise, if any mode requires an LLM (all three modes do, as does the absence of `noRefine`), the orchestrator validates the config, creates a client, and — unless disabled — runs a one-shot preflight probe against the provider. A failed or leaking probe aborts the run before any paid generation begins.

## Run identity and stage 1

Run identity is established by mode. For `"run"`, the orchestrator inserts a new row into `batch_runs` with config snapshotted as JSON, marking it `running` at stage 1. For `"resume"` and `"only"`, it selects the most recent run id, throwing if none exists. The `configuredExtraIgnores` — derived from the config's `ignores` array — are forwarded **only** on the `"run"` path to the indexer; resume and only operate on the existing snapshot and never rescan, so configured ignores were already applied at the original scan.

Stage 1 executes only for `"run"`: the indexer walks the repository (respecting configured ignores plus built-in defaults) and the ledger runs quietly. The orchestrator then checks the documentation baseline — if unavailable with active obligations it throws, if incompatible it throws, and if empty it writes an empty baseline.

With the index populated, it loads all active symbols and file paths, building a `symbolCountByPath` map. It then resolves file-level import edges once, hoisting this computation above all later stages so the community cross-check, module-edge projection, and stage-5 flow detection all share the same resolved edges.

## Stage 2: page units

Stage 2 plans real repository page units — files and folders — via `planPageUnits`, using the indexed inventory sizes and symbol counts. Folder units become `modules` (the analysis surface for stages 3 and 5), while file units become `fileModules` (the stage-4 detail layer). A deterministic planner guarantees unique ids and an exact partition of the inventory; the orchestrator re-applies `makeUniqueDeterministicIds` and `assertExactPathPartition` as defense in depth. If any assertion fails, the run is marked `aborted` with a summary carrying the error message, and the exception is re-thrown — the status must not remain `running`.

If community detection is enabled, the orchestrator runs a diagnostic cross-check comparing the deterministic partition against import-graph communities. Failures degrade silently to "no report"; the report never affects task or run status.

## Stages 3–5: prioritization, documentation, and targeting

Stage 3 resolves module edges from the hoisted import resolution and prioritizes modules, re-applying id uniqueness. Stage 4 builds the execution queue: file units first (ordered by their folder's priority, then symbol count, then id), followed by folder units in priority order. The orchestrator also parses `onlyTarget` into one of several special forms: `flow:<slug>` targets a flow task, `topic:<identity>` targets a topic task, `understanding` targets the understanding task, and `file:<path>` / `folder:<id>` aliases resolve to unit ids. Bare ids work verbatim. If `onlyTarget` is set but matches nothing, it throws; if the pipeline produced zero tasks but the planner found units, an `EmptyPipelineError` is thrown — this is a pipeline bug, not a completed run.

Before stage 4 begins, class diagrams are synchronized against the final module plan so obsolete files cannot fail the repository-wide verify. If `mode` is `"only"`, the orchestrator resets the targeted task to `pending` (preserving its usage history) so it can be re-run.

The per-module task runner, extracted so both the sequential and worker-pool drivers share identical code, handles each unit: it reads or creates the task, preserves prior usage/diagnostic history, computes the wiki path (folder index files versus per-file pages), checks the existing page's frontmatter owner, and — for `"generated"` or `"mixed"` owners — attempts to recover stage-4 artifacts from an interrupted previous attempt. `owner: human` and `untrusted` pages are refused outright with a `refused_human_page` error; unparseable frontmatter yields `refused_unparseable_page`. The `withTestsPointer` helper appends a deterministic test pointer to generated content: a same-name pairing is stated as fact, a prefix-only match as "likely" — never asserted.

## Configuration resolution and pipeline initialization
<!-- lw:anchors packages/core/src/batch.ts#resolveOutputTokenBudget packages/core/src/batch.ts#emptyUsage packages/core/src/batch.ts#createOrGetTask packages/core/src/batch.ts#getOrCreateTask packages/core/src/batch.ts#safeJsonParse packages/core/src/batch.ts#readOwnerFromFrontmatter packages/core/src/batch.ts#recoverStage4TaskArtifacts -->

The pipeline described in this file begins with a set of small, focused helpers that resolve configuration, initialize per-task state, and reconstruct prior work. These functions are the groundwork the batch runner relies on before it can execute any stage, so they are grouped here as the mechanism that turns raw inputs (a database handle, a run id, a stage label, and a target) into the concrete, typed values the runner can act on.

Three of these helpers are trivial by design. `safeJsonParse<T>(s: string): T | null` wraps `JSON.parse` in a `try/catch` and returns `null` on any failure, so callers never have to handle parse exceptions — a malformed checkpoint or receipt simply becomes a `null` and is treated as missing. It takes a JSON string and returns either the parsed value as type `T` or `null`. `emptyUsage` is equally simple: it returns a fresh `StageUsage` object with all counters zeroed, `costUsd` set to `null`, an empty `models` list, and `usageIncomplete` set to `false`, giving the runner a canonical "no work done yet" state to increment from. `resolveOutputTokenBudget(strategy: "dynamic" | "fixed", ceiling: number, signals: OutputBudgetSignals, preset: typeof MODULE_OUTPUT_BUDGET_OPTIONS): number` is the decision point for how many output tokens a stage may spend — when the strategy is `"fixed"` it simply returns the ceiling unchanged, and when it is `"dynamic"` it passes the signals and a merged preset (ceiling plus the module's default options) into `computeDynamicOutputTokenBudget`, letting the model's observed usage influence the limit. It takes a strategy name, a hard ceiling, runtime signals, and a preset options object, and returns the token budget number.

The task-registry layer is where the database is actually touched. `getOrCreateTask(db: import("better-sqlite3").Database, runId: number, stage: BatchStage, target: string): { id: number; attempt: number; checkpoint_json: string | null }` first queries `batch_tasks` for an existing row matching the run, stage, and target. If one exists, it parses the stored checkpoint (via `safeJsonParse`) to recover the attempt count, defaulting to `0` when the checkpoint is absent or unparseable, and returns the existing id with that attempt and the raw checkpoint JSON. If no row exists, it inserts a new row with status `"pending"` and the current timestamp, then returns the new row's last insert id with attempt `0` and a `null` checkpoint. This gives the runner idempotent task creation — repeated calls for the same key yield the same task rather than duplicating rows. `createOrGetTask` is a thin wrapper around this: it accepts the same four parameters plus a `mode` argument of `"run" | "resume" | "only"`, and simply returns `null` when the mode is `"only"` (a mode that runs only stage 4), otherwise delegating entirely to `getOrCreateTask`. Its contract is that resumable modes reuse or create a task row, while the `"only"` mode short-circuits to no task at all.

On the content side, `readOwnerFromFrontmatter(content: string | null): PreOwnerCheck` inspects a page's frontmatter to decide who owns the page's content. It returns `null` if the content itself is `null`. If the content starts with a byte-order mark, it strips it; then it verifies the frontmatter opener is exactly `---\n` or `---\r\n` (tolerating CRLF line endings so files saved on Windows or by generators with different conventions are still recognized), normalizes all CRLF to LF, and hands the result to `parseFrontmatter`. From there the function classifies the owner: no frontmatter at all yields `"unparseable"`, a missing or non-string `owner` key yields `"untrusted"`, and the recognized values are passed through — `"generated"` and `"mixed"` are accepted verbatim (the latter signaling a page that mixes human and generated content), `"human"` is returned as-is, and anything else falls through to `"untrusted"`. A parse exception also resolves to `"unparseable"`. This distinction matters because the runner rewrites only the generated portions of a page, preserving human-authored content byte-for-byte, so knowing the owner up front prevents accidental overwrites.

Finally, `recoverStage4TaskArtifacts` is the file's most involved helper, and it reconstructs the artifacts of a previously completed stage-4 task so a resumed run can skip already-finished work. It takes an options object with the repository root, the module, the wiki path, optional folder and file units, the existing page content (or `null`), path-role configuration, and the diagram limits; it returns either a `TaskCheckpoint["artifacts"]` object or `null`. Its flow is a sequence of gates. First, if `existing` is `null` there is nothing to recover, and it returns `null`. If a folder unit is present, it delegates to `recoverDocumentationReceipt` with the folder-style task id, returning whatever that function produces. Without a folder unit, a missing file unit also yields `null`. Next it reads the module's symbol rows, sorts their keys, and compares them against the current contract baseline via `hasCurrentContractBaseline` — if the module's symbol surface has drifted since the page was written, the existing artifact is considered stale and `null` is returned. It then normalizes the stored artifact with `normalizeStage4Artifact` (a parse step that can fail), computes the module's diagram slug, and validates the normalized content with `validateStage4Artifact`, passing along the module id, its role, a `relaxed` flag when the artifact was accepted under a degraded-quality round (so the relaxed contract is honored for pages that qualified under it), and the expected diagram path when module diagrams are enabled. Any validation failure returns `null`. On success it builds the base artifact with the wiki path and a SHA-256 hash of the page content; if module diagrams are not enabled, that base is the complete return value. Otherwise it reads the diagram file from `livewiki/diagrams/<slug>.mmd`, rejects it if unreadable or if `validateMermaidSyntax` reports an error, counts the diagram's flow elements with `countFlowDiagramElements`, and returns `null` if the node or edge counts exceed the configured maximums. Only when every check passes does it return an artifact carrying the wiki path, page hash, diagram path, and diagram hash — a fully validated snapshot of prior work that the runner can treat as trustworthy.

## Overall pipeline stages: scan, partition, prioritize
<!-- lw:anchors packages/core/src/batch.ts#buildFlowDocContext packages/core/src/batch.ts#buildModuleDocContext packages/core/src/batch.ts#buildTopicDocContext packages/core/src/batch.ts#getFileIdsForModule packages/core/src/batch.ts#getModuleSymbolRows packages/core/src/batch.ts#getRationaleEvidenceForPaths -->

These three context builders—`buildModuleDocContext`, `buildTopicDocContext`, and `buildFlowDocContext`—are the workhorses of the batch documentation pipeline. Each one assembles the complete evidence package that a later stage (the planner or writer) consumes to generate wiki pages for a candidate module, topic, or flow. They share a common three-stage structure: **scan** the index database for symbol metadata, **partition** that metadata into the structured tables and digests the downstream stage expects, and **prioritize** the available character budget so the most information-dense evidence survives truncation. Understanding this shared skeleton makes each builder's variations clear.

### Module context: the canonical pipeline

`buildModuleDocContext` is the most representative builder because it exercises every step of the pipeline:

```ts
export async function buildModuleDocContext(
  absRoot: string,
  module: Module,
  charBudget: number,
  rationaleMaxChars = 0,
): Promise<ModuleDocContext>
```

This function takes the repository root, a `Module` description, a character budget, and an optional rationale budget, and returns a `ModuleDocContext` containing the closed key list, symbols table, truncated source, and rationale evidence.

The pipeline starts with `getModuleSymbolRows`. This helper opens the index database, resolves the module's file IDs via `getFileIdsForModule`, and runs a prepared query selecting all active symbols (`status = 'active'`) whose `file_id` falls in that set. The query is built dynamically with parameter placeholders—one per file ID—so it's safe against SQL injection. If the module has no files, the function returns an empty array without executing the query. The result is a list of `ModuleSymbolRow` objects, each carrying the symbol's key, name, kind, signature, and line span.

Back in `buildModuleDocContext`, the pipeline partitions these rows into two artifacts. First, it extracts the sorted array of symbol keys—`closedKeyList`—which becomes the canonical anchor list the planner is allowed to reference. Second, it renders a human-readable `symbolsTable` as a Markdown bullet list, one line per symbol with its kind and signature. This table gives the downstream writer a compact but complete inventory of every documented symbol.

Then the prioritization stage begins. The function calls `getRationaleEvidenceForPaths` with `rationaleMaxChars`, asking it to collect decision rationale records (from the `rationales` table, joined with file paths) for the module's paths, rendered up to that character limit. The rationale evidence is subtracted from the total budget, leaving `sourceBudget` for actual source code. This ordering is deliberate: rationale records explain *why* a design decision was made, so they get first claim on the budget. The remaining source budget is handed to `buildFairTruncatedSource`, which implements a per-file fair-share truncation strategy rather than a sequential first-fit. That fairness matters because the comment notes that sequential truncation "left later files … with zero source context, which strongly correlates with invented anchors"—a later file with no source excerpt is more likely to get fabricated documentation. Every file gets at least a slice of the budget, so stage 4 always sees each module file's source.

### Rationale evidence: bounded, ordered, honest

`getRationaleEvidenceForPaths` is a focused helper that both `buildModuleDocContext` and `buildTopicDocContext` use (the latter inlines a variant of it). Its job is to extract design rationale records for a set of file paths, bounded by a character cap:

```ts
async function getRationaleEvidenceForPaths(
  absRoot: string,
  paths: ReadonlyArray<string>,
  maxChars: number,
): Promise<string>
```

It takes the repository root, a list of paths, and a maximum character count, and returns a rendered string of rationale evidence. The function short-circuits if `maxChars` is zero or the path list is empty, returning an empty string. Otherwise it opens the index database and runs a join between the `rationales` and `files` tables, selecting the file path, symbol key, rationale kind, text, and start line. The rows are ordered by file path, then by symbol position within the file, which ensures a stable, source-ordered presentation. The final `renderRationaleEvidence` call applies the character cap—this is where the bounding happens, not in the query itself.

### Module symbol rows: the scan-and-partition step

`getModuleSymbolRows` is the scan step for modules, and it composes two database operations:

```ts
async function getModuleSymbolRows(
  absRoot: string,
  module: Module,
): Promise<ModuleSymbolRow[]>
```

This function takes the repository root and a module, and returns an array of `ModuleSymbolRow` objects. It first calls `getFileIdsForModule` to translate the module's path list into file IDs, then runs the active-symbols query filtered by those IDs. The `fileIds.map(() => "?").join(",") || "NULL"` expression produces either the parameterized placeholder list or the SQL literal `NULL` when the list is empty—a subtle guard that makes the `IN` clause valid even with zero files. The ordering of rows is left to the caller; both consumers sort by key afterward.

`getFileIdsForModule` is the simpler dependency:

```ts
async function getFileIdsForModule(absRoot: string, module: Module): Promise<number[]> {
```

It takes the repository root and a module, and returns the numeric IDs of all files whose path appears in the module's path list. It runs a single parameterized query against the `files` table, then maps the result rows to their `id` values. The `placeholders || "''"` fallback handles the empty-paths case so the `IN` clause never receives an empty list.

### Topic context: seed keys and prose files

`buildTopicDocContext` follows the same pipeline shape but adapts it for topics, which are defined by seed keys rather than a module's file list:

```ts
export async function buildTopicDocContext(
  absRoot: string,
  candidate: TopicCandidate,
  charBudget: number,
  rationaleMaxChars = 0,
  modulePaths?: ReadonlyMap<string, readonly string[]>,
): Promise<TopicDocContext>
```

This function takes the repository root, a topic candidate, a character budget, an optional rationale budget, and an optional map of module IDs to file paths, and returns a `TopicDocContext`.

The scan stage differs: instead of collecting all symbols for a module's files, it selects only the symbols whose keys appear in `candidate.seedKeys`. The query additionally joins with the `files` table to recover each symbol's source path—something `getModuleSymbolRows` does not need, because the module context already knows its paths. The symbols are sorted by key for a deterministic table.

The partition stage synthesizes a module and flow digest. For each module ID in `candidate.modules`, it attempts to read `livewiki/<moduleId>/index.md`; a missing page is honestly reported as "Page unavailable" rather than fabricating content. The same treatment applies to flow pages under `livewiki/flows/`. This digest gives the writer a summary of related documentation that already exists.

The source extraction for topics is span-based: for each symbol, the function reads its containing file (caching file contents across symbols from the same path), then calls `renderTopicSourceSpan` to extract exactly the lines between `start_line` and `end_line`. The comment warns that this span math is shared with the topic planner's estimate in `topics.ts`—"the two must never drift"—so the actual source excerpt in the context matches what the planner planned for.

Rationale evidence is generated inline rather than via the shared helper, but with the same bounded, ordered logic. The subtracted budget accounts for it *before* the hard throw:

```ts
if (rationaleEvidence.length + truncatedSource.length > charBudget) {
  throw new Error(`accepted topic evidence exceeds topicMaxSourceChars (...)`);
}
```

This assertion catches the pathological case where accepted evidence exceeds the budget. The ordering matters: because rationale was subtracted first, the throw can never fire on rationale alone.

The last partition stage is prose evidence—a fix for a real gap the code comments document. Prose-tier files (Dockerfiles, compose files, launchers, docs) have no symbol keys, so the closed list can never reference them, and without their content the model could not honestly describe deployment surfaces. The comment recounts that the "deployment" topic came out wrong because `cli.py` owned every closed key. So the function, when `modulePaths` is provided, collects all paths from the candidate modules, filters to those with zero active symbols, and excerpts each one's content, carved from the budget *left over* after anchors and rationale. Each block is prefixed with a header telling the writer to "describe, never cite as an anchor"—an instruction that keeps these prose files out of the closed key list while still giving the model their substance.

### Flow context: walk-order aggregation

`buildFlowDocContext` is the simplest of the three builders, but it introduces the flow-specific notion of walk order:

```ts
async function buildFlowDocContext(
  absRoot: string,
  candidate: FlowCandidate,
  modules: ReadonlyArray<Module>,
  charBudget: number,
): Promise<FlowDocContext>
```

This function takes the repository root, a flow candidate, the full array of modules, and a character budget, and returns a `FlowDocContext`. The signature is an unexported async function, so it isn't part of the public API.

The scan stage mirrors the topic builder: collect seed symbols by key from the `symbols` table, restricted to active status, then sort by key. The partition stage builds module openings by walking `candidate.moduleIds` in order; for each module it reads `livewiki/<moduleId>/index.md`, extracts the opening digest, and joins them with `\n\n`. A missing module page gets a placeholder line.

The source aggregation happens in **walk order**—the order modules appear in `candidate.moduleIds`—with deduplication. The `moduleById` map lets the builder look up each module's paths quickly, and the `seenFiles` set prevents a file from appearing twice when a flow spans overlapping modules. This ordering is meaningful: the source excerpt preserves the flow's execution sequence rather than alphabetical or symbol order, so the downstream writer sees files in the order the flow reaches them.

Finally, `buildFairTruncatedSource` distributes the full `charBudget` across the deduplicated flow files, applying the same fair-share truncation as the module builder. Unlike `buildModuleDocContext`, there's no rationale subtraction here because flows, as a concept, don't have rationale rows in the v1 implementation—the builder trusts the fair-share truncation to keep the total within budget on its own.

### Put together

These three builders form one coherent pipeline with a consistent contract: **scan** the database for symbols and rationale rows, **partition** that raw evidence into sorted key lists, Markdown tables, page digests, and source excerpts, and **prioritize** the character budget so rationale and source both get representation while keeping the output within bounds. The module and flow variants differ mainly in *which* evidence they gather and *how* they truncate; the topic variant adds prose-file extraction as a deliberate correction to a known hallucination mode. Every builder closes its database connection in a `finally` block, and every source excerpt is either fair-shared or span-exact—there is no path where truncation silently drops one file entirely.

## Stage 4: module page generation and folder pages
<!-- lw:anchors packages/core/src/batch.ts#attemptStage4Generation packages/core/src/batch.ts#attemptFolderGeneration packages/core/src/batch.ts#generateOversizedFilePage packages/core/src/batch.ts#resetTaskToPending -->

Stage 4 of the batch pipeline is the point where the real page content gets produced. Two distinct generation flows live here: the standard single-call path that handles most modules, and a specialized plan-then-write pipeline reserved for oversized files that would otherwise blow past the context budget. The section also owns the folder-purpose generation that seeds the next stage's index work. The shared goal across all three is the same — produce a page that survives the stage's own validation gauntlet, because everything downstream (verification, writes to disk, and folder indexing) treats that validation as the contract.

`attemptStage4Generation` is the orchestrator for the whole stage. It takes the full `AttemptOpts` bundle and returns a `Stage4AttemptResult`, and the first thing it does is rebuild the module context from disk on every attempt via `buildModuleDocContext`. That reload is deliberate: repair attempts need the same symbol table and truncated source that the initial attempt saw, and since the closed key list derived from the index doesn't change between attempts, re-fetching it is safe. The early branch is the oversized-file special case. When `opts.promptKind === "initial"` and `opts.oversizedFile === true`, control hands entirely to `generateOversizedFilePage`, and the result flows through a normalization, optional degradation marking, and validation sequence that is byte-for-byte identical in spirit to the single-call path further down — the contract never relaxes just because the generation was multi-pass. Because an oversized candidate can never become a repair input (the char-budget guard discards it and the next attempt is always a fresh initial), the normal mechanical-fallback path gated on a final repair slot would never run here; instead, the code attempts `repairStage4ArtifactMechanically` immediately whenever validation fails, since that fallback is fail-closed (it returns null unless every error has a supported mechanical fix).

For the standard path, the function resolves the output-token budget via `resolveOutputTokenBudget` using the configured strategy and ceiling plus the anchor count from the closed key list. Prompt construction splits on whether this is a repair: repair attempts build either a surgical prompt (when `opts.surgicalRepair` is set, after `prepareSurgicalRepair` computes a plan) or a full `buildRepairPrompt`; initial attempts go straight to `buildStage4Prompt`. Both carry module role classification, rationale evidence, and optional diagram/deep-hierarchy flags. The LLM call itself is wrapped in a try/catch that distinguishes `LlmTimeoutError` from generic failures — both return an `llm_error` diagnostic outcome, but the timeout branch uses `llm_timeout` as its code. Cost accounting happens through `computeCostFromUsage` with the pricing override, so repairs are billed the same way as initial attempts.

The remainder of `attemptStage4Generation` is a sequence of gates that the raw model output must pass. Provider-declared non-completions (`stopReason === "length"` or `"incomplete"`) are rejected as artifacts with a specific error code — the partial text is retained only long enough to produce content-safe diagnostics and never becomes repair input. Normalization via `normalizeStage4Artifact` strips or converts things the validator can't handle; if it fails, the attempt ends with `diagnosticOutcome: "normalization_failed"`. For surgical repair attempts, the normalized content is spliced into the base page via `spliceSections`, and a null splice (meaning the model touched sections outside the named targets) rejects the attempt with the original errors and a `surgical_cascade_rejected` outcome. The relaxed writer marks the candidate degraded *before* validation so that what validation sees is exactly what reaches disk. When module diagrams are enabled, the companion diagram is extracted from the inline `## Diagram` section via `extractInlineModuleDiagram`, and the extraction is itself a validation gate: a missing section, an oversized or over-budget source, or a Mermaid syntax failure each produce a specific error code (placeholders, flow-diagram-too-large, invalid-flow-diagram) that the repair contract classifies as repairable, never as an infra failure. Only after all that does `validateStage4Artifact` run against the closed key list, and a final optional mechanical-repair fallback can rescue a page whose errors all have deterministic fixes.

`generateOversizedFilePage` implements the plan-then-write pipeline for single files that exceed the normal budget. It takes the module, the resolved `charBudget`, the LLM client, and a prebuilt `ModuleDocContext`, and returns a raw assembled page plus the accumulated token usage or a structured LLM error. The pipeline runs in three passes with an internal `call` helper that accumulates usage across every `llmClient.generate` call so cost reporting never loses sub-call billing. Pass 0 produces the file opening: it attempts a `buildFileOpeningPrompt`, retries once on a provider non-completion, and accepts the result only if it starts with a markdown H1 heading. Two failed attempts return an `llm_call_failed` error. Pass 1 plans the narrative arc: `buildFilePlanPrompt` asks for a section plan, `parseFilePlan` parses it against the closed key list, one retry is allowed, and a failed parse falls back to a deterministic source-order plan (`deterministicFallbackPlan`) with honest sequential headings — the split is treated as a generation concern, not a correctness one. Pass 2 then makes one prose call per planned section using `buildFileSectionPrompt`, feeding each call the section's *complete* source slice extracted by `extractSectionSource` (capped at 30,000 characters) rather than the truncated global view, so the model writes about the actual code. The per-section tables are rebuilt from the symbols table lines so the model sees only relevant symbols. Finally, `assembleFilePage` stitches the opening, the plan headings, and the section prose into a single raw markdown document. The whole operation catches timeouts and generic errors, reporting real billed usage even on failure.

`attemptFolderGeneration` produces the folder-purpose paragraph that anchors the folder page. It takes the folder unit, the file units inside it, and either generates a fresh purpose or repairs a prior failed one. The first step is evidence gathering: for each file that already has an accepted page on disk (checked via `existingPagePaths`), it reads that page and extracts a digest of the module opening via `extractModuleOpeningDigest`, building a map of page path to opening. That map, along with the symbol counts and file inventory, feeds `buildFolderPurposeContext`, which constructs the context block the prompts see. The prompt itself depends on the attempt kind: a repair uses `buildFolderPurposeRepairPrompt` carrying the prior purpose, the prior validation errors, and the current attempt/total position, while an initial attempt uses `buildFolderPurposePrompt`. The LLM call is wrapped in the same timeout-vs-generic error handling as the module path, and non-completion stop reasons are rejected with the appropriate code. The raw output goes through `validateFolderPurpose`; if it passes shape checks, the trimmed text becomes the `purpose` in the returned `FolderAttemptResult`, otherwise the attempt records `artifact_validation_failed` with the collected errors. Either way the result carries a full `UsageAttempt` entry so the caller can bill and record the attempt.

`resetTaskToPending` is the small bookkeeping primitive that supports retry loops around this stage:

```ts
function resetTaskToPending(db: import("better-sqlite3").Database, taskId: number): void {
```

It takes the SQLite database and a task ID, and issues a single `UPDATE` that sets the task's status back to `'pending'` with a fresh `updated_at` timestamp. The caller uses it to re-queue a task whose generation failed in a retryable way, so the next polling pass will pick it up again under a fresh attempt number.

## Stage 5: semantic topics, flows, and understanding
<!-- lw:anchors packages/core/src/batch.ts#runSemanticTopicStage packages/core/src/batch.ts#attemptTopicGeneration packages/core/src/batch.ts#attemptStage5Generation packages/core/src/batch.ts#runUnderstandingStage packages/core/src/batch.ts#attemptUnderstandingGeneration -->

Stage 5 is the semantic core of the batch pipeline: it turns the deterministic module and flow inventory into human-readable topic pages and an "understanding" document, each backed by LLM generation with strict validation, repair, and recovery. The stage is split into two orchestration functions — `runSemanticTopicStage` and `runUnderstandingStage` — plus two per-attempt generators (`attemptTopicGeneration` for topics and `attemptUnderstandingGeneration` for the understanding artifact). All four share the same failure-police contract: a failed task is recorded with a reason and the run continues; the circuit breaker halts only after sustained failures.

## Topic planning: the deterministic proposal and optional refine

`runSemanticTopicStage` accepts a broad options object covering the database handle, run id, module/edge inventory, flow candidates, LLM client, language, pricing, and a full set of toggles and caps (topic count, anchor count, source characters, rationale size, output tokens, repair attempts, and recovery tiers such as `surgicalRepair`, `relaxedRound`, and `concernTopics`). It returns a `TopicStageResult` summarizing usage, task counts, failures, candidates, and any circuit-breaker or rollback state.

The function opens by building a planning inventory from the module and flow data, then derives the set of active anchors and a map from module id to its source paths (used later for evidence blocks). It computes a `hasCrossModuleBasis` flag — true when at least two product-role modules or a flow spanning three or more modules exist — to decide whether planning is even worthwhile. For very small or weakly indexed repositories, planning is a deterministic no-op: the function returns early with the empty result rather than spending a paid LLM call.

When planning does proceed, the function locates or creates a planner task in the `batch_tasks` table (stage 5, target `"topic-plan"`), respecting `mode`: in `"only"` mode it requires an existing planner checkpoint and throws if absent; otherwise it reuses an existing task or, when the cross-module basis is insufficient, returns early. If a prior checkpoint already holds a completed `topicPlan`, the function adopts it directly; otherwise it starts a fresh planning attempt.

The plan itself is proposed deterministically first — no LLM call, no repair loop, no "exhausted" possibility — via `proposeTopicPlanDeterministically`, which uses call centrality computed from the database. The whole plan is then validated against the same caps the generator will later enforce (via `planValidationOpts`, which includes the `rationaleMaxChars` guard so a later accepted candidate cannot overflow the hard source-character throw).

Next comes an optional, narrowly-scoped LLM refine pass, gated by `refinePool.length > 0 && !opts.noRefine`. The refine pool deliberately excludes concern-origin candidates: the D2 pin comment explains that in two paid runs the LLM re-scoped deterministic deployment topics back to CLI-only, dropping Docker, so pinned concerns keep their deterministic title/intent and are re-merged afterward. The refine prompt is built from the proposals, and the LLM is called with a resolved output-token budget. Any rejection, invalid output, or infrastructure failure degrades silently back to the already-valid deterministic plan — a refine failure is never a planning failure. If the refine output validates cleanly and no pinned concerns exist, it replaces the candidates; if pinned concerns exist, the refined pool is re-merged with them in deterministic precedence order, then the whole merged plan is re-validated. On success the candidates are updated (with origin re-marked as `"concern"` for pinned evidence hashes); on failure the code keeps the deterministic plan and logs a diagnostic.

After the plan is set, the function persists it as a `"done"` planner checkpoint, then filters the candidates by `onlyIdentity` when that option is non-null (matching either evidence hash or slug, throwing if nothing matches). It ensures the topics index scaffold exists, then enters the per-topic loop.

## Per-topic generation loop: ownership, recovery, repair, and relaxed completion

For each candidate, `runSemanticTopicStage` loads or creates the task row, reads any prior checkpoint to seed attempt/usage/diagnostic state, and constructs the wiki path under `livewiki/topics/<slug>.md`. It reads any existing file and parses the frontmatter owner: if the owner is `"human"`, `"mixed"`, `"untrusted"`, or `"unparseable"`, the task is refused with a `refused_owned_topic` error preserving the human content. Otherwise, if recovery is enabled (not `"only"` mode) and the owner is `"generated"`, the function attempts to recover durable documentation receipts via `recoverDocumentationReceipt`, which can short-circuit the whole generation loop by supplying artifacts directly.

When no recovery applies, the loop iterates over a bounded number of slots — one initial attempt plus up to `maxRepairAttempts` repairs. For the initial slot it calls `attemptTopicGeneration` with `promptKind: "initial"`; for repairs it uses `"repair"` and passes prior errors plus repair-attempt context. Before burning a repair slot, it checks `isUnrepairableErrorSet` for topic pages: if every prior error is unclassified, the task fails immediately with an `unrepairable` code without spending a paid call. Each attempt is wrapped in a try/catch because `buildTopicDocContext` can throw on the hard `topicMaxSourceChars` guard; that exception is recorded as a `context_build_exception`, and — being not model-fixable — the task fails without retries, mirroring the `write_verify_exception` short-circuit.

Within the loop, after each attempt the function accumulates usage, tracks the prior candidate text and validation errors, and records a diagnostic. It handles several outcomes explicitly: an LLM error (including timeout, which terminates the task), an incomplete or truncated generation (which clears prior state and continues), a null artifact, and a success. When an artifact is produced, `tryWriteAndVerify` writes the page and verifies it; a rollback failure marks the run, a write/verify exception fails the task immediately, and verify issues feed back as prior errors for the next repair slot. Only a clean write-and-verify produces artifacts and exits the loop.

If the bounded loop exhausted without artifacts and no terminal error was set, the task checks the `relaxedRound` toggle and `isRelaxedEligible`: if both hold, it makes one extra relaxed attempt via `attemptTopicGeneration` with relaxed validation enabled (`relaxed: true`), fresh prior state, and `surgicalRepair: false`. That attempt may produce an artifact that writes and verifies cleanly, in which case the task is marked degraded and completed; any verify rejection keeps the original `repair_exhausted` path because verification never relaxes. If still no artifacts, the task fails with `repair_exhausted`.

Whether the task succeeds or fails, the function commits the checkpoint back to the database. On success, before writing the final `"done"` checkpoint, it calls `commitDocumentationTask` to durably commit the verified artifact to repository authority; a failure there is recorded as `durable_commit_failed`. Failed tasks increment the failure counters and push a failure entry including the exact retry command; successful tasks increment done counters and, if degraded, push the wiki path onto `degradedPages`. After each task, the circuit breaker checks three conditions — a rollback failure, three consecutive failures, or a failure rate above 50% after three or more attempts — and halts the loop when triggered.

## The understanding stage: one evidence block, one artifact

`runUnderstandingStage` mirrors the topic stage's orchestration but for a single understanding artifact. Its options object (visible at the call site in the source) includes the database, run id, absolute root, modules, edges, flow candidates, path-role config, LLM client, language, pricing, thinking mode, and the same `mode`/`onlyIdentity` handling. The stage builds an evidence block from the full inventory, then decides whether to reuse a prior checkpoint or start fresh. When generation is needed, it enters a bounded attempt loop very similar to the topic one: for the first slot it calls `attemptUnderstandingGeneration` with `promptKind: "initial"` and empty prior state; for repairs it uses `"repair"`, passing prior errors and repair context. The generator result is checked for truncation (which clears state and continues), LLM errors (timeout terminates, other errors continue), and validation failures (which feed back as prior errors). Only a fully validated artifact is written and verified; clean write/verify completes the task, issues feed back for another repair, and write/verify exceptions fail without further attempts. As in the topic stage, a relaxed completion round is available when the strict loop exhausts, and the durable commit path is identical. The final checkpoint records the attempt count, usage history, diagnostics, and either the artifact or the failure reason, and the same circuit-breaker logic gates the rest of the run.

## Per-attempt generators

`attemptUnderstandingGeneration` is the single-shot generator for the understanding artifact. It accepts an options object with the attempt number, the evidence block, language, prompt kind (`"initial"` or `"repair"`), prior candidate text, prior errors, pricing, an optional thinking mode, and optional repair-attempt context (attempt and total counts). It returns an `UnderstandingAttemptResult` that carries the usage entry, normalized raw text, a diagnostic candidate, a diagnostic outcome, the parsed artifact (or null), validation errors, and any LLM error.

The function first chooses the prompt: for repairs it calls `buildUnderstandingRepairPrompt` with the prior candidate, prior errors, a cap of 8,000 characters, language, and the repair context; otherwise it calls `buildUnderstandingPrompt` with the evidence block and language. It then calls the LLM client with `maxTokens` fixed at `UNDERSTANDING_MAX_OUTPUT_TOKENS` and the optional thinking mode. The try/catch around the call distinguishes a timeout (returning an `llm_timeout` error with null usage) from any other failure (returning `llm_call_failed` with the exception message). On success it computes cost from usage and builds the usage entry. If the stop reason is `"length"` or `"incomplete"`, it returns a truncated/incomplete diagnostic outcome with a corresponding validation error and no artifact. Otherwise it normalizes the raw text via `normalizeStage4Artifact`; the visible slice shows the function branching on whether normalization succeeded, with the success path (and the full normalized-artifact handling) continuing beyond the truncated source.

## Repair and recovery mechanisms
<!-- lw:anchors packages/core/src/batch.ts#prepareSurgicalRepair packages/core/src/batch.ts#buildSurgicalEvidenceSlice packages/core/src/batch.ts#isRelaxedEligible packages/core/src/batch.ts#topicPlanDiagnostic packages/core/src/batch.ts#topicAttemptDiagnostic packages/core/src/batch.ts#understandingAttemptDiagnostic packages/core/src/batch.ts#summarizeLlmDiagnosticError packages/core/src/batch.ts#summarizeVerifyDiagnosticErrors packages/core/src/batch.ts#diagnosticAttempt -->

The repair and recovery mechanisms in this file form the second-chance pipeline that runs after an initial topic-generation attempt fails validation. The pipeline is structured as a cascade: first it tries a *surgical* repair that targets only the specific sections that failed validation, then it falls back to a *relaxed* regeneration attempt, and finally it produces a rich diagnostic record of what happened at each stage. This staged approach means the system never blindly regenerates an entire topic from scratch when a smaller, more targeted fix would do.

## Surgical repair: preparing the plan

When an initial topic plan fails validation, `prepareSurgicalRepair` is the entry point that decides whether a surgical repair is even feasible. It takes the absolute root path of the workspace, the prior candidate content, the validation errors from the failed attempt, and the symbols table as a string, and returns a `SurgicalRepairPlan | null` — either a plan describing exactly what to fix, or `null` when surgical repair is not possible.

The function works in three steps. First, it calls `surgicalRepairTargetSections(priorErrors)` to identify which H2 sections of the artifact are implicated by the validation errors; if no sections can be identified (the function returns `null`), the whole repair is aborted. Second, it normalizes the prior candidate via `normalizeStage4Artifact(priorCandidate)` and, if that passes, splits it into H2 sections with `splitH2Sections(base.content)`. It then checks that every target section actually exists in the split content; if any is missing, it returns `null`, because there is nothing to surgically patch. Third, it scans the text of each target section for anchor keys cited inside `lw:anchors` comment blocks — these are the symbols the section depends on — and collects them into a set. Finally, it calls `buildSurgicalEvidenceSlice` with those keys and returns `{ basePage: base.content, targetSections, evidenceSlice }` — the base page, the list of sections to fix, and the evidence slice to feed the repair prompt.

The step of collecting cited keys from the `lw:anchors` comments is what makes the repair "surgical": instead of sending the whole artifact to the LLM for context, the repair prompt is built around only the symbol definitions that the failing sections actually reference. This keeps the repair focused and reduces the chance of the model introducing unrelated changes.

## Surgical repair: building the evidence slice

`buildSurgicalEvidenceSlice` is the worker that assembles the context the surgical repair prompt needs. It takes the workspace root, the symbols table as a string, and a list of cited key names, and returns a single string containing the relevant symbol rows and their source spans.

```typescript
async function buildSurgicalEvidenceSlice(
  absRoot: string,
  symbolsTable: string,
  citedKeys: readonly string[],
): Promise<string>
```

The function takes the workspace root, the raw symbols table text, and a list of symbol keys; it returns a formatted string of symbol definitions and source code for those keys. If `citedKeys` is empty, it immediately returns an empty string. Otherwise, it filters the symbols table for lines matching the cited keys (using a regex to extract each line's first token as the key), and computes a `spanBudget` — the maximum number of characters allowed for source excerpts — by subtracting the length of the rows block and a small margin from `SURGICAL_EVIDENCE_MAX_CHARS`. It then opens the index database with `openIndex` in a `try`/`finally` block to guarantee the connection is closed, queries for active symbol records matching the keys (joining with the files table to get each symbol's source path), sorts them by key, and iterates over them. For each symbol, it reads the source file, renders a span with `renderTopicSourceSpan`, and appends it to the growing `spans` array while decrementing the budget. If a span would exceed the remaining budget, it truncates the span with a `// ... (truncated by budget)` comment and stops. The final result combines the rows block and the source spans, separated by a blank line, returning whichever portion is non-empty.

## Relaxed eligibility gate

`isRelaxedEligible` is the gatekeeper for the relaxed regeneration fallback. It takes a page kind (one of `"module"`, `"flow"`, or `"topic"`) and the list of validation errors from the failed attempt, and returns a boolean.

```typescript
function isRelaxedEligible(
  pageKind: "module" | "flow" | "topic",
  errors: ReadonlyArray<ArtifactValidationError>,
): boolean
```

The function takes the type of page being generated and the list of validation errors; it returns `true` when a relaxed attempt should be permitted. The logic is a single check: there must be at least one error, and `collectUnclassified(pageKind, errors)` must return an empty list. In other words, relaxed repair is only allowed when every error is of a class the system understands how to recover from. If any error is "unclassified" — meaning the system does not know how to respond to it — the relaxed fallback is denied, because a blind retry would likely fail the same way. This guard prevents wasting budget on attempts that are doomed to repeat the same failure.

## Building diagnostic attempt records

The remaining functions are all diagnostic record builders: they convert the raw outcome of an attempt (whether LLM call, validation, or repair) into a normalized, truncated, JSON-serializable record that can be logged or surfaced to the caller. Each one enforces the same caps — `DIAGNOSTIC_MAX_ERRORS` for the number of error summaries and `DIAGNOSTIC_TEXT_CAP` for each error message — and each attaches a `finishedAt` timestamp.

`diagnosticAttempt` is the most general of the builders. It takes an input object with an `attemptResult`, a `promptKind` (`"initial"` or `"repair"`), an `outcome`, a `DiagnosticErrors` object, and an optional `budgetConsumed` flag, and returns a `DiagnosticAttemptWithSurgical`. It pulls the attempt number from the usage entry, conditionally includes `stopReason` and `rawStopReason` if present, attaches the outcome and prompt kind, and includes `budgetConsumed` only when the caller supplied it. It copies the pre-summarized `errors` and `truncatedErrorCount` straight through, and, when there is a candidate, computes `candidateChars` and `candidateSha256` via `sha256`. It forwards any `mechanicalRepairs`, `surgicalOutcome`, and a `relaxed: true` flag when a relaxed attempt was made.

`topicAttemptDiagnostic` builds a similar record but accepts a `Stage4AttemptResult` directly, which means it must do its own error summarization and has richer knowledge of the attempt. It calls `summarizeDiagnosticErrors(result.validationErrors)` to get the capped summaries, spreads in the stop reasons and outcome, includes the candidate fingerprint when present, and conditionally adds `surgicalOutcome` and the `relaxed` flag when the stage-4 result reports them.

`topicPlanDiagnostic` is the builder for the topic *plan* stage, before any stage-4 content exists. It takes the attempt number, prompt kind, an explicit `outcome`, the candidate plan string, the list of `TopicPlanValidationError`s, and optional stop reasons. It treats every error as having `"global"` location, caps the messages, and includes the candidate fingerprint only when the candidate string is non-empty.

`understandingAttemptDiagnostic` builds the record for a "understanding" stage attempt — a preliminary pass that produces an `UnderstandingAttemptResult`. It caps the validation errors, includes stop reasons, defaults the outcome to `"success"` when the result does not carry one, and includes the candidate fingerprint only when `diagnosticCandidate` is not `null`.

Finally, two small helpers handle error summarization. `summarizeLlmDiagnosticError` takes a single `{ code, message }` object and returns a `DiagnosticErrors` record with that one error (capped) and a `truncatedErrorCount` of zero — it is used when the only error is a generic LLM failure rather than a list of validation issues. `summarizeVerifyDiagnosticErrors` takes an array of `VerifyIssue` objects and converts them into capped error summaries, mapping each issue's location to either `"frontmatter"` or `"body"` based on whether its code is `"broken_anchor"`, and optionally attaching an `offending` path when the issue carries one. The chain of builders and summarizers means every stage of the repair pipeline — plan, understanding, stage-4 content, LLM failure, and verification failure — emits a uniform, budget-capped diagnostic record that callers can rely on regardless of which code path produced it.

## Verification, write, and rollback pipeline
<!-- lw:anchors packages/core/src/batch.ts#tryWriteAndVerify packages/core/src/batch.ts#tryWriteModuleDiagramAndVerify packages/core/src/batch.ts#tryWriteFlowAndVerify packages/core/src/batch.ts#verifyIssuesToValidationErrors packages/core/src/batch.ts#isArtifactVerifyCode packages/core/src/batch.ts#isDeferredBaselineIssue packages/core/src/batch.ts#rollbackWrittenArtifacts -->

The `batch.ts` verification pipeline is the safety-critical core of the artifact write path: it guarantees that no invalid or partially-written candidate ever persists on disk. The pipeline follows a strict sequence — pre-write content preservation, atomic write, verification, and, on failure, mandatory rollback — with each step enforced through a small set of helper functions. The whole flow is governed by three near-identical write-and-verify entry points (`tryWriteAndVerify`, `tryWriteModuleDiagramAndVerify`, `tryWriteFlowAndVerify`) that share one design pattern, differing only in the number of artifacts they manage and the strictness of their acceptance criteria.

`tryWriteAndVerify` is the simplest variant and establishes the pattern. It writes a single page, then verifies it. Before writing, it performs two content-preservation steps: it re-injects any manual blocks from the existing page into the new content at their original section positions (via `injectManualBlocksBySection`), and, if the existing page's frontmatter declared `owner: mixed`, it forces the final content's frontmatter back to `mixed` (via `forceOwnerInFrontmatter`) so the page isn't reclassified as purely generated. It then snapshots the existing content as the rollback reference and writes the page through `safeIo.writeText`, followed by a full repository verification via `runVerify` — all inside a single try/catch so that *any* exception (write failure, verifier crash) triggers an immediate rollback. After verification, it filters the issues to those that affect the written path and are not deferred baseline issues (`isDeferredBaselineIssue`); if `rejectAnySeverity` is set, warnings also block acceptance, otherwise only `error`-severity issues do. If any blocking issue is found, the pipeline performs a mandatory rollback and reports the issues; otherwise it returns the page's SHA-256 hash as the success artifact.

`tryWriteModuleDiagramAndVerify` extends this pattern to a page-and-diagram pair. It applies the identical manual-block and `owner: mixed` restoration steps to the page content, then snapshots *both* the existing page and the existing diagram file (reading the diagram snapshot with a catch for missing files). The write sequence is page-first, then diagram, then verification — all inside one try/catch so a failure at any point rolls back both artifacts together, since a page with a mismatched diagram is just as invalid as a missing one. Its acceptance gate is stricter than the single-page case: *any* `error`-severity issue on *either* written path (page or diagram) rejects the pair, regardless of `rejectAnySeverity`. On rejection, both artifacts are rolled back, and on success the result carries hashes for both the page and the diagram (with a trailing newline normalized into the diagram hash).

`tryWriteFlowAndVerify` adds a third artifact to the transaction: the flows hub page at `livewiki/flows/index.md`. It follows the same write-and-verify pattern but, after writing the page and diagram, it syncs the flows hub via `syncFlowsIndexHub` (passing the loaded flow presentations) and records whether the hub was actually rewritten (`hubWritten`). Crucially, only a hub that was actually touched enters the rollback set — a hub whose owner skipped the sync was never modified and needs no restore. The acceptance gate is the strictest of the three: *any* issue, whether error *or* warning, on either written path rejects the pair — a deliberate asymmetry from the error-only stage-4 gate, reflecting the higher risk of flow pages. On rejection, the rollback set includes the hub if it was written; on success, the result reports page and diagram hashes (the hub hash is not tracked as an artifact).

Behind all three entry points, `rollbackWrittenArtifacts` is the shared undo mechanism. It takes a list of `{ path, snapshot }` entries and, for each, either restores the previous content (when a snapshot exists) or removes the newly-created file (when the snapshot is null). The `guardedRemoval` flag adds a safety check: when true, the function uses `lstat` to confirm the path is an existing file before attempting removal, avoiding accidental deletion of directories or symlinks. Each failure to restore or remove is captured as a human-readable reason string, and the function returns the full list of failures so the caller can report a `rollbackFailed` result. A failed rollback is terminal — the caller signals it distinctly rather than silently treating the write as failed.

The helpers `verifyIssuesToValidationErrors`, `isArtifactVerifyCode`, and `isDeferredBaselineIssue` shape how verification issues are interpreted. `verifyIssuesToValidationErrors` converts raw verifier issues into the closed artifact-repair contract, filtering out repository-audit findings (like baseline compatibility and removed-anchor issues) that the model can't repair, and mapping each remaining issue to a `{ code, message, location, offending }` structure with `broken_anchor` classified as a frontmatter issue and everything else as a body issue. `isArtifactVerifyCode` is the gatekeeper that defines exactly which issue codes are model-repairable: broken anchors, broken internal links, invalid Mermaid diagrams, altered manual blocks, think blocks, and missing wiki paths. `isDeferredBaselineIssue` identifies issues with the `baseline_entry_without_anchor` code, which are always excluded from blocking conditions — they represent pre-existing repository state rather than problems introduced by the new write.

The entire pipeline is deliberately transactional: content is prepared, written atomically, verified, and either committed with hashes or rolled back with reasons. The three entry points differ only in transaction size (one artifact, two, or three) and acceptance strictness, but the invariants are universal — no invalid candidate persists, a failed rollback is always signaled, and every successful write returns cryptographic hashes that let the caller track exactly what landed.

## Usage accounting, result aggregation, and error handling
<!-- lw:anchors packages/core/src/batch.ts#accumulateUsage packages/core/src/batch.ts#aggregateTotals packages/core/src/batch.ts#computeCostFromUsage packages/core/src/batch.ts#finalizeRun packages/core/src/batch.ts#drainPendingMetrics packages/core/src/batch.ts#buildResult packages/core/src/batch.ts#statusToExitCode packages/core/src/batch.ts#EmptyPipelineError packages/core/src/batch.ts#EmptyPipelineError.constructor packages/core/src/batch.ts#TaskError packages/core/src/batch.ts#TaskError.constructor -->

This section covers the batch pipeline’s closing mechanics: how usage data from individual attempts is merged into run-level totals, how those totals are finalized and persisted, how the final result object is assembled, and how errors are typed and surfaced to the caller.

The pipeline’s error model is established by two exception classes. `EmptyPipelineError` is exported and thrown when a batch run is started with no tasks to execute. Its constructor takes a `message: string`, calls the base `Error` constructor, and sets the error name to `"EmptyPipelineError"` so callers can distinguish it from other failures. The non-exported `TaskError` carries a machine-readable `code` alongside a human-readable `message`; its constructor stores `code` on the instance and sets the name to `"TaskError"`. This lets downstream code branch on the code rather than parsing message text, and keeps task-level failures separate from pipeline-level ones.

Usage accumulation is the first step of the accounting flow. `accumulateUsage` folds a single attempt’s usage record into an accumulator of type `StageUsage`. It takes the accumulator, a subset of a usage attempt containing its `usage`, `usageKnown` flag, and optional `costUsd`, and a pricing override parameter (which is currently unused in the body). If the attempt’s usage is unknown or null, the function marks the accumulator as `usageIncomplete` and keeps the existing cost total unchanged — it does not guess or fabricate numbers. Otherwise it adds the attempt’s input and output token counts to the accumulator, merges the cost: if the accumulator has no cost yet it takes the attempt’s cost (or null), if the attempt has no cost it keeps the accumulator’s value, and if both exist it sums them. It also appends the model name to the accumulator’s `models` array if not already present, and preserves the `usageIncomplete` flag from the accumulator.

`aggregateTotals` combines two complete `StageUsage` objects, typically to merge per-stage totals into a run-wide total. It sums input and output tokens, and handles costs with the same null-tolerant logic: if either side’s cost is null it falls back to the other side’s non-null value, otherwise it adds them. Model lists are unioned with deduplication via a `Set`, and the `usageIncomplete` flag is set if either operand is incomplete. This function is the workhorse for turning many small per-attempt accumulations into a single comparable number set.

`computeCostFromUsage` calculates the dollar cost for a given token usage and model. It takes a `{ inputTokens, outputTokens, model }` object and an optional pricing override, returning the same type as `calculateCostUsd`. When an override is provided and the model appears in it, the function uses `calculateCostUsd` with that override. Otherwise it looks up the model in the standard pricing table via `lookupPricing`; if the model has no entry it returns null (signaling “no price known”), and if a price exists it computes the cost with the override (which may be undefined, causing `calculateCostUsd` to use the table).

The finalization step persists everything. `finalizeRun` takes the database handle, the absolute root path, the run ID, a final status (one of `"completed"`, `"completed_with_failures"`, or `"aborted"`), and an options object carrying the aggregated totals, per-stage and per-module breakdowns, refined module list, task counts, and an optional `degradedPages` recovery list. It builds a `BatchRunSummary` object that captures all of those aggregates plus zero pending tasks, conditionally spreading the degraded pages only when non-empty. It then updates the `batch_runs` table with the status, a finish timestamp, and the stringified summary JSON. After that, it attempts to write an entry to the append-only activity ledger via `recordUpdateMetric`, including token counts, cost, duration computed from the run’s start time, and task counts. This accounting write is deliberately fire-and-forget: the code wraps it in a try/catch and pushes the promise (with a `.catch(() => {})` attached) to a `pendingMetricWrites` array so that any ledger failure never affects the run’s outcome or exit code.

`drainPendingMetrics` awaits all pending metric writes from the `pendingMetricWrites` array by splicing it out and passing it to `Promise.all`. This is called at a safe point (typically after finalization) to let those background writes complete before the process exits, without blocking the main finalization path.

`buildResult` assembles the public `BatchRunResult` object from its individual components: the run ID, status, totals, per-module breakdown, failures list, circuit-breaker flag, and the counts of done and failed tasks. It returns a plain object with all of those fields set directly — no transformation or validation, just a convenient packaging of values the caller needs.

Finally, `statusToExitCode` maps a `BatchRunResult["status"]` to a process exit code: `"completed"` maps to 0 (success), `"completed_with_failures"` maps to 1 (partial success), and `"aborted"` maps to 2. This gives the CLI a consistent way to signal outcome to shells and scripts, with 0 meaning clean, 1 meaning something failed but the run finished, and 2 meaning the run was cut short.

## Manual-block preservation and frontmatter ownership rules
<!-- lw:anchors packages/core/src/batch.ts#extractManualBlocksBySection packages/core/src/batch.ts#slugifyHeadingText packages/core/src/batch.ts#injectManualBlocksBySection packages/core/src/batch.ts#sectionRangeOf packages/core/src/batch.ts#forceOwnerInFrontmatter packages/core/src/batch.ts#buildFairTruncatedSource -->

The manual-block preservation mechanism is the heart of the batch processor's ability to regenerate documentation without destroying human-authored content. When the tool rewrites a markdown page, it must distinguish between two kinds of text: content the generator owns and can freely replace, and content a human has explicitly marked as permanent. The `lw:manual` HTML comments delimit the latter, and the functions in this section implement the round-trip that keeps those blocks alive across regenerations.

The journey begins with `extractManualBlocksBySection(content: string): Map<string | null, string[]>`. This function takes the raw text of the existing page, scans it for paired `lw:manual` start and end comments, and groups each block under the heading that precedes it. It first collects every start and end marker offset into a sorted hit list, then walks that list to pair each start with its matching end. For each completed block, it finds the nearest preceding heading (by scanning a precomputed list of heading offsets) and uses that heading's slug — produced by `slugifyHeadingText(text: string): string` — as the map key. `slugifyHeadingText` normalizes a heading into a stable identifier by lowercasing, stripping diacritical marks, removing non-word characters, and converting spaces to hyphens. Blocks with no preceding heading fall under the `null` key. The return value is thus a map from section slug (or `null`) to an array of full manual-block strings, preserving their original markers.

Re-injection reverses the extraction. `injectManualBlocksBySection(existing: string, newContent: string): string | null` takes the old page and the freshly generated one, and splices the preserved manual blocks into the new content at the correct positions. It starts by calling `extractManualBlocksBySection` on the old text; if no blocks exist, it returns `null` to signal "nothing to preserve". Otherwise, it parses the new content's headings with their offsets and hierarchy levels. For each preserved block, it locates the corresponding heading in the new content by slug; a block whose section has vanished (or that had no heading at all) is appended to the very end of the new page so nothing is lost. For a matched heading, the function computes the section's end via the nested helper `sectionRangeOf(headingOffset: number): { endOffset: number }`, which scans forward from the heading and returns the offset of the next heading at the same or higher level — or the document end if none exists. It collects all insertion points, sorts them in descending offset order so later insertions don't shift earlier ones, and applies them to produce the final merged page.

Ownership enforcement complements preservation. `forceOwnerInFrontmatter(content: string, owner: "generated" | "mixed"): string` takes a page and ensures its YAML frontmatter declares the given owner. It bails out entirely if the content has no frontmatter. When an `owner:` line already exists (at any value), it replaces just that line's value; otherwise it injects a new `owner:` line immediately after the opening `---`. The two-argument union type `"generated" | "mixed"` captures the two legal states: a page that is purely machine output, or one that mixes generated content with preserved manual blocks.

Finally, `buildFairTruncatedSource(absRoot: string, paths: ReadonlyArray<string>, charBudget: number): Promise<string>` produces a bounded-length source listing — a compact concatenation of the given files, each preceded by a header — for contexts where the full source is too large. It resolves the root directory and reads every path, skipping any that fail. If the complete untruncated concatenation already fits in the budget, it returns that. Otherwise it divides the budget equally across files (with a 128-byte floor per file), truncates each body to its share minus its header, and appends a truncation marker. A final hard cap trims the aggregate result if the markers themselves overflow the budget, guaranteeing the return value never exceeds `charBudget` characters.

## Tests

Covered by `packages/core/src/batch.test.ts` (same-name test file on disk).
Likely also exercised by `packages/core/src/batch-community.test.ts` (name-prefix match, not verified).
Likely also exercised by `packages/core/src/batch-concurrency.test.ts` (name-prefix match, not verified).
Likely also exercised by `packages/core/src/batch-context.test.ts` (name-prefix match, not verified).
Likely also exercised by `packages/core/src/batch-module-diagrams.test.ts` (name-prefix match, not verified).
Likely also exercised by `packages/core/src/batch-repair.test.ts` (name-prefix match, not verified).
Likely also exercised by `packages/core/src/batch-review.test.ts` (name-prefix match, not verified).
Likely also exercised by `packages/core/src/batch-stage5.test.ts` (name-prefix match, not verified).
Likely also exercised by `packages/core/src/batch-surgical-repair.test.ts` (name-prefix match, not verified).
Likely also exercised by `packages/core/src/batch-test-role.test.ts` (name-prefix match, not verified).
Likely also exercised by `packages/core/src/batch-understanding.test.ts` (name-prefix match, not verified).
