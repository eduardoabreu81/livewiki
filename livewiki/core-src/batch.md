---
title: Batch Pipeline Orchestration for livewiki Documentation Generation
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

# Batch Pipeline Orchestration for livewiki Documentation Generation

This page documents how the batch pipeline orchestrates the full documentation generation process, from repository scanning through coordinated LLM-driven page writing with recovery and failure handling.

## When to use this page

- Understand how `runBatch`, `resumeBatch`, and `runOnly` drive the four-stage documentation pipeline (scan, module identification, prioritization, coordinated writing)
- Learn how the circuit breaker policy decides when to abort a run after consecutive or excessive failures
- Discover how `--only` re-runs a single task while preserving manual content and respecting ownership rules
- Explore the recovery tiers — surgical repair, relaxed rounds, and bounded retry slots — that rescue tasks from common LLM and validation failures

## How it fits

`batch.ts` is the central conductor of the livewiki documentation engine. It sits in `packages/core/src/` and coordinates every other subsystem: the indexer (`indexer.js`), module planner (`modules.js`), page-unit planner (`page-units.js`), prompt builders (`prompts.js`), artifact normalizer (`artifact.js`), verifier (`verify.js`), and persistence layers (`batch-state.js`, `manifest.js`, `documentation-commit.js`). The file exports three public entry functions — `runBatch`, `resumeBatch`, and `runOnly` — all delegating to the private `orchestrate` function that implements the complete pipeline.

The module enforces the project's documentation contracts: it refuses to rewrite human-owned pages, preserves manually written blocks byte-for-byte, writes pages transactionally with rollback on verification failure, and maintains a checkpoint system so interrupted runs can resume where they left off. Stage 5 extends the same machinery to flow diagrams, topic pages, and a repository-wide understanding synthesis, each with its own gated task queue and budget constraints.

## Batch Entry Points and Modes
<!-- lw:anchors packages/core/src/batch.ts#runBatch packages/core/src/batch.ts#resumeBatch packages/core/src/batch.ts#runOnly packages/core/src/batch.ts#statusToExitCode -->

The batch execution pipeline is entered through three small public functions that each normalize their caller's intent into a single internal `mode` value, then delegate to a shared `orchestrate` helper. This indirection keeps the entry surface minimal and lets each mode be expressed as a one-line configuration difference rather than a separate code path.

`runBatch` is the standard full-run entry point. It accepts a `BatchOptions` object and returns a `Promise<BatchRunResult>`, spreading the caller's options and forcing `mode: "run"` before handing control to `orchestrate`. This mode performs the complete batch, from initial session setup through every queued item.

`resumeBatch` behaves identically in shape but stamps `mode: "resume"` onto the options. This mode is the continuation path: instead of starting fresh, `orchestrate` locates the previously persisted batch state and picks up from where the last run stopped, reusing the stored session and progress markers so interrupted batches can be completed without redoing finished work.

`runOnly` is the selective-entry variant. Before delegating, it enforces a precondition: if the caller did not supply an `onlyTarget`, it throws an `Error` explaining that the field is required. Once validated, it passes the options through with `mode: "only"`, instructing `orchestrate` to execute just the single named target (in the current batch or a fresh one) and return that item's outcome, ignoring all other batch members.

The shared `orchestrate` function (not shown in this slice) receives the mode-tagged options and switches on that mode to select the appropriate execution strategy — whether that means creating a new session, resuming from the last checkpoint, or isolating one target. All three entry points funnel through it, which is why they share the same return type and option shape.

Once a batch finishes, `statusToExitCode` translates the result's terminal status into a process exit code suitable for shell scripting and CI integration:

```ts
export function statusToExitCode(
  status: BatchRunResult["status"],
): 0 | 1 | 2 {
  if (status === "completed") return 0;
  if (status === "completed_with_failures") return 1;
  return 2; // aborted
}
```

This function takes the `status` field of a `BatchRunResult` and returns a numeric `0`, `1`, or `2`. A fully successful run (all items passed) maps to `0`, a run that finished but saw one or more item failures maps to `1`, and any interrupted or canceled run maps to `2`. The mapping is deliberately coarse — it collapses the richer status vocabulary into just three exit codes — so that callers can branch on outcome without parsing the full result object. Note that the `return 2` branch catches every non-success status, including ones like "aborted," so the default fallthrough is both the error path and the catch-all.

## Configuration and Orchestration Setup
<!-- lw:anchors packages/core/src/batch.ts#orchestrate packages/core/src/batch.ts#resolveOutputTokenBudget packages/core/src/batch.ts#safeJsonParse packages/core/src/batch.ts#emptyUsage packages/core/src/batch.ts#aggregateTotals packages/core/src/batch.ts#accumulateUsage packages/core/src/batch.ts#EmptyPipelineError packages/core/src/batch.ts#EmptyPipelineError.constructor packages/core/src/batch.ts#TaskError packages/core/src/batch.ts#TaskError.constructor -->

`orchestrate` is the single entry point that drives an entire batch run. Its job is to turn the caller's `OrchestrateOpts` and the repository's `.livewiki/config.json` into a coordinated sequence of stages — scan, plan, generate, repair, and report — while persisting every decision and every meter of usage to the SQLite index at `.livewiki/index.db`. It resolves the filesystem root, opens the database, and then normalizes the configuration into a flat set of local constants that every downstream stage reads from, so no stage has to re-read config or re-derive defaults.

The function begins by resolving the absolute repository root and recording the wall-clock time of *this* invocation in `invocationStartedAt` — distinct from the run's original `started_at` so that a late `--only` debt-payment round reports its real duration. It then ensures `.livewiki` exists, validates and opens `index.db`, and loads configuration via `loadConfig` and `applyDefaults`, choosing the effective language from `opts.language`, then config, then `"en"`.

Next, `orchestrate` resolves the full set of tunables using a consistent precedence: option overrides the config file, which overrides a built-in default. It extracts `configuredExtraIgnores` from config (only forwarded to the indexer on a fresh `run` — resume and `--only` never rescan). It validates `maxRepairAttempts`, `maxIncompleteRetries`, and `batchConcurrency`, throwing on non-integer or out-of-range values. It then flips a series of feature toggles — `surgicalRepair`, `relaxedRound`, `moduleDiagramsEnabled`, `deepHierarchy`, `concernTopics`, `understandingSynthesis`, `communityDetection` — each defaulting to `true` (or `false` for module diagrams, which default off to preserve byte-identical output). It resolves the output token budget and strategy, the context character budget, the rationale-character cap, and the thinking mode. For module diagrams specifically, it builds a `FlowDiagramBudget` only when that feature is enabled, using the module's own node and edge limits from config.

If the LLM is needed — for any mode other than a pure `--no-refine` path — and no client was injected, `orchestrate` validates the config for batch use and creates a client via `createLlmClient`. When `preflight` is not disabled, it runs a single bounded probe through `probeProvider`; if the probe fails or leaks thinking, it throws with a message that mentions setting `"preflight": false` to bypass (not recommended).

With configuration settled, the function establishes the batch run identity. On `mode === "run"` it inserts a new row into `batch_runs` with a JSON snapshot of the key settings, and captures the new `runId`. On `resume` or `only`, it loads the most recent run id, throwing if none exists. For a fresh run it invokes `runIndexer` (forwarding the configured extra ignores) and `runLedger` to scan the repository; resume and `--only` skip this. It then reads the documentation baseline: if unavailable it collects an inventory of obligations and either errors (if any exist) or writes an empty baseline; if incompatible it refuses to advance.

The function then loads the active symbols and active file paths from the index, building `symbolCountByPath` — the set of active files is the single source of truth for all planning. It hoists file-level import resolution above stage 2: `collectImportsForFiles` gathers raw edges, and `resolveImportEdges` (given workspace packages, tsconfig, Go module path, and Rust crate name) produces one authoritative `resolvedImportEdges` set reused by later stages.

Stage 2 builds the real page units: folder units and file units produced by `planPageUnits`, driven by file paths, symbol counts, and sizes. It converts these into `Module` objects, then runs a deterministic partition check with `makeUniqueDeterministicIds` and `assertExactPathPartition`. If the partition assertion fails, it marks the run `aborted` with `emptyUsage()` totals and rethrows. Otherwise it persists a stage-2 task checkpoint (always `done`, since the planner is deterministic) and optionally attaches a `communityCrossCheck` report when that diagnostic is enabled.

Stage 3 projects module edges from the hoisted imports and prioritizes modules, re-applying uniqueness as defense in depth. Stage 4 sets up the coordinated documentation loop: a `stage4Queue` that orders file modules first (by their folder's priority, then symbol count, then id) followed by folder modules in priority order. It resolves `--only` targets — `flow:`, `topic:`, `understanding`, and the `file:`/`folder:` aliases — and filters `tasksToRun` accordingly, throwing if an `--only` target matches nothing. A critical guard follows: if the planner found units but `tasksToRun` is empty outside `only` mode, it throws `EmptyPipelineError`.

Before entering the stage-4 loop, `orchestrate` synchronizes class diagrams via `syncClassDiagrams`, accumulates any stage-2 usage from the checkpoint into `stageUsageTotals`, and declares the shared mutable state (`cb`, `failures`, `degradedPages`, `failedModuleIds`, `moduleUsage`) plus the per-module task runner `runStage4ModuleTask`. That runner — extracted so the sequential and worker-pool drivers share identical code — loads or creates the task, restores prior usage/diagnostic history, determines the wiki path (folder pages at `livewiki/<folder>/index.md`, file pages at `livewiki/<id>.md`), appends a deterministic test pointer via `withTestsPointer`, and checks the page owner: `human`, `untrusted`, and `unparseable` are refused with `TaskError`-style checkpoints, while `generated` and `mixed` pages in non-`only` modes trigger `recoverStage4TaskArtifacts`. Every stage-4 task writes its own checkpoint with cumulative usage and diagnostics, and the whole loop is guarded by a circuit breaker that aborts the run if any task reports a rollback failure.

## Task Creation and Recovery
<!-- lw:anchors packages/core/src/batch.ts#createOrGetTask packages/core/src/batch.ts#getOrCreateTask packages/core/src/batch.ts#resetTaskToPending packages/core/src/batch.ts#recoverStage4TaskArtifacts packages/core/src/batch.ts#finalizeRun packages/core/src/batch.ts#buildResult packages/core/src/batch.ts#drainPendingMetrics -->

Every batch run begins by materializing its work into durable rows in `batch_tasks`, because the entire recovery story hinges on those rows surviving across process restarts. The entry point is `createOrGetTask`, which routes to `getOrCreateTask` in every mode except `"only"`:

```ts
function createOrGetTask(
  db: import("better-sqlite3").Database,
  runId: number,
  stage: BatchStage,
  target: string,
  mode: "run" | "resume" | "only",
): { id: number; attempt: number; checkpoint_json: string | null } | null {
```

It takes the database connection plus the run, stage, and target identifiers, and returns either a task record (with its attempt counter and checkpoint) or `null` in `"only"` mode, which means only stage 4 runs and no prior-stage tasks are created.

`getOrCreateTask`, the workhorse underneath, first tries to read an existing row matching the triple `(run_id, stage, target)`. If found, it parses the stored checkpoint JSON to recover the attempt count — so a resumed run continues from where it left off rather than starting fresh. If no row exists, it inserts a new task with status `'pending'` and returns the fresh row with attempt `0` and no checkpoint. This idempotent lookup-and-insert is what allows the same batch invocation to be re-run safely.

Once a task is created, the recovery machinery takes over. The most involved piece is `recoverStage4TaskArtifacts`, which attempts to reconstruct the artifacts a stage-4 task produced in a previous session:

```ts
async function recoverStage4TaskArtifacts(opts: {
  absRoot: string;
  module: Module;
  wikiPath: string;
  folderUnit?: FolderUnit;
  fileUnit?: FileUnit;
  existing: string | null;
  pathRoleConfig?: import("./modules.js").PathRoleConfig;
  moduleDiagrams: boolean;
  moduleMaxDiagramNodes: number;
  moduleMaxDiagramEdges: number;
}): Promise<TaskCheckpoint["artifacts"] | null> {
```

This function takes the absolute repo root, the module being processed, the wiki path, the optional folder or file units, the previously written page content (if any), and configuration about diagrams. It returns either a validated artifacts object or `null` when recovery is not possible.

Recovery proceeds through several gates. First, if `existing` is `null` there is nothing to recover. For folder units, it delegates to `recoverDocumentationReceipt`, rebuilding the receipt artifact from the folder's evidence. For file units, it fetches the module's symbol keys via `getModuleSymbolRows`, checks that the current contract baseline still matches via `hasCurrentContractBaseline`, and then normalizes the existing content with `normalizeStage4Artifact`. Only if normalization succeeds does it validate the content against the closed symbol keys with `validateStage4Artifact`, passing a `relaxed` flag when the artifact was accepted under degraded quality, and expecting a module diagram when `moduleDiagrams` is set. A failed validation returns `null`, meaning the task will be redone rather than trusted.

If the content passes validation, the function builds the artifacts object with the wiki path and a SHA-256 hash of the page. When diagrams are enabled, it also reads the `.mmd` file for the module's slug, validates its Mermaid syntax with `validateMermaidSyntax`, and enforces node and edge limits via `countFlowDiagramElements`. Any failure at this stage also yields `null`. This layered validation means a previously completed task is only resumed when its output is provably consistent with the current contract.

When recovery fails or a task must restart, `resetTaskToPending` is the tool that brings the task back to a clean state:

```ts
function resetTaskToPending(db: import("better-sqlite3").Database, taskId: number): void {
```

It takes the database and a task ID, and updates the row to status `'pending'` with the current timestamp, discarding any previous completion state. This is the escape hatch that forces a task to be re-executed even if a checkpoint existed.

After all tasks for a run complete, `finalizeRun` writes the run's terminal summary:

```ts
function finalizeRun(
  db: import("better-sqlite3").Database,
  absRoot: string,
  runId: number,
  status: "completed" | "completed_with_failures" | "aborted",
  opts: {
    totals: StageUsage;
    byStage: Record<string, StageUsage>;
    byModule: BatchRunResult["byModule"];
    modulesRefined: Array<{ id: string; paths: string[]; displayTitle?: string }>;
    tasksDone: number;
    tasksFailed: number;
    invocationStartedAt: number;
    degradedPages?: string[];
  },
): void {
```

It takes the database, the repo root, the run ID, the final status, and a bundle of execution statistics. It updates `batch_runs` with the status, finish timestamp, and a serialized summary that aggregates totals, per-stage and per-module usage, task counts, refined modules, and any degraded pages. As a side effect, in-session cost accounting fires a best-effort write to the activity ledger via `recordUpdateMetric`, recording token and cost totals along with wall-clock duration; this write is pushed onto `pendingMetricWrites` so it can be flushed later without ever obstructing the run's outcome.

The pending accounting writes are drained by `drainPendingMetrics`, which awaits all of them with `Promise.all` and clears the queue. This guarantees that the ledger is fully updated before the process exits, while still keeping the accounting path fire-and-forget during finalization.

Finally, `buildResult` assembles the in-memory result object that the batch runner returns to its caller, packaging the run ID, status, usage totals, per-module breakdown, failures, and the circuit-breaker flag together:

```ts
function buildResult(
  runId: number,
  status: BatchRunResult["status"],
  totals: StageUsage,
  byModule: BatchRunResult["byModule"],
  failures: BatchRunResult["failures"],
  circuitBreakerTriggered: boolean,
  tasksDone: number,
  tasksFailed: number,
): BatchRunResult {
```

It takes the run ID, status, stages usage, per-module results, failure list, a circuit-breaker flag, and task counts, and returns the structured `BatchRunResult` ready for the caller to surface.

## Content Generation Pipeline
<!-- lw:anchors packages/core/src/batch.ts#attemptUnderstandingGeneration packages/core/src/batch.ts#attemptFolderGeneration packages/core/src/batch.ts#attemptStage4Generation packages/core/src/batch.ts#attemptStage5Generation packages/core/src/batch.ts#attemptTopicGeneration packages/core/src/batch.ts#runSemanticTopicStage packages/core/src/batch.ts#runUnderstandingStage packages/core/src/batch.ts#generateOversizedFilePage -->

The content generation pipeline in `batch.ts` is the execution engine that drives the batch run from a high-level plan down to written, verified wiki pages. It is organized as a series of stage entry points that share a common shape: each resolves a task record from the database, attempts LLM-driven content generation with a bounded repair loop, and finally commits or fails each artifact with full bookkeeping in `batch_tasks`. This section explains how the pipeline moves through semantic topic planning (stage 5) and understanding generation, and how it handles oversized files as a special case.

## Semantic Topic Planning (`runSemanticTopicStage`)

`runSemanticTopicStage` is the orchestrator for the semantic topic stage (stage 5 in the batch run). It takes a large options object that fully specifies the run context — database handle, run ID, module/edge inventory, LLM client, language, pricing, token budgets, repair limits, and several recovery-tier toggles. Its role is twofold: first, produce an accepted topic plan, then execute one generation task per topic in that plan, tracking usage, failures, and circuit-breaker conditions throughout.

The function begins by building a planning inventory via `buildTopicPlanningInventory`, which gathers the repository's modules, flows, and their anchors. From this it computes `activeAnchors` (all module and flow anchors), `topicModulePaths` (module ID → source paths, used later for prose evidence), and `hasCrossModuleBasis` (true when there are at least two product-role modules or a flow spanning three modules). Small or weakly indexed repositories — fewer than five anchors, or no cross-module basis — become a deterministic no-op that returns an empty result rather than spending a paid planner call.

For repositories that pass the gate, the function locates or creates the planner task in `batch_tasks` (stage 5, target `"topic-plan"`). In `--only` mode it requires an existing task and throws if none exists; otherwise it reuses a prior checkpoint if present, and only creates a new task when the inventory basis is sufficient. If a prior checkpoint already holds a completed `topicPlan`, the function reuses it as `result.candidates` and skips planning entirely.

When planning must run, the function increments `result.taskCount` and starts the planner task. Workstream B is central here: `proposeTopicPlanDeterministically` produces the initial candidate set with no LLM call, so the plan is always valid by construction. The `planValidationOpts` carries `maxTopics`, `maxAnchors`, `maxSourceChars`, and `rationaleMaxChars` (the latter ensuring the planner's source-budget estimate matches what the generator later appends). After computing caller centrality, the deterministic proposals are split into `pinnedConcernCandidates` (origin `"concern"`) and `refinePool` (everything else). Concern candidates are pinned because a documented D2 issue showed the LLM refine pass incorrectly re-scoping deployment topics — so only non-concern proposals are eligible for refinement.

If the refine pool is non-empty and `noRefine` is unset, the function builds a refine prompt via `buildTopicRefinePrompt` and calls the LLM with a budget resolved by `resolveOutputTokenBudget`. It validates three possible outcomes: a `length`/`incomplete` stop reason degrades silently to the deterministic plan; a valid refined plan with no pinned concerns replaces the candidates; and a valid refined plan with pinned concerns triggers a re-merge (refined first, then pinned) followed by full re-validation — if that merged plan is valid, concerns keep their `origin` marker by evidence hash. Any validation failure or LLM error (including timeouts) records a diagnostic and degrades back to the already-valid deterministic plan; an LLM refine failure is never treated as a planning failure.

After planning, the function filters candidates by `onlyIdentity` if set (matching evidence hash or slug, throwing if none found), then scaffolds the topics index with `ensureTopicsIndexScaffold`. The execution loop then iterates over each target candidate. For each topic, it gets or creates the task in the database and checks the existing wiki page's frontmatter owner: human, mixed, untrusted, or unparseable ownership immediately sets `refused_owned_topic` and preserves the page. If the owner is `"generated"` and not in `--only` mode, it tries `recoverDocumentationReceipt` to salvage a previously committed artifact.

The generation loop itself runs up to `1 + maxRepairAttempts` slots. Each slot determines `promptKind` (`"initial"` or `"repair"`), checks for an unrepairable error set to abort without burning a call, and increments the attempt counter. A key robustness fix wraps `attemptTopicGeneration` in a try/catch: `buildTopicDocContext` can throw the hard `topicMaxSourceChars` guard before any LLM call, and that exception must fail only this task (with code `context_build_exception`) rather than kill the whole run. A successful attempt records usage, updates `priorCandidate` and `priorErrors`, and dispatches on the outcome: LLM errors set `llm_error` and continue unless it's a timeout; incomplete/truncated generations reset state and continue; a valid artifact goes through `tryWriteAndVerify`. Rollback failure, a write/verify exception, or verify issues each have their own short-circuit path, while a clean write assigns `artifacts` and exits the loop.

When the bounded loop exhausts without artifacts and `relaxedRound` is enabled and the topic is relaxed-eligible, the function makes one additional relaxed attempt with `relaxed: true`, wider validation, and `surgicalRepair: false`. Success here marks the page as `degraded` and completes the task; a verify rejection still keeps the original `repair_exhausted` path because verify never relaxes. If no artifacts and no task error remain, the task fails with `repair_exhausted`.

The final step per topic commits via `commitDocumentationTask` on success (a durable-commit failure sets `durable_commit_failed`), then writes the checkpoint (done or failed) with full usage and diagnostic histories. The failure path increments `fails` and pushes a retry command; the success path increments `done` and resets the consecutive-failure counter. The circuit breaker trips — stopping the whole stage — when rollback failed, when three consecutive failures occur, or when more than half of the first three attempts failed, recording the trigger state in the result.

## Topic Generation Attempts (`attemptTopicGeneration`)

For each topic candidate, `attemptTopicGeneration` performs a single bounded generation attempt. It is a thin wrapper over the prompt/validate/write flow used by the repair loop; the batch loop calls it repeatedly with different `promptKind` and `priorCandidate`/`priorErrors` values to drive refinement. The function receives the candidate evidence, the source character budget, the rationale cap, and the module path map for context building, and returns a `Stage4AttemptResult` that the caller merges into its checkpoint.

## Understanding Generation (`attemptUnderstandingGeneration` / `runUnderstandingStage`)

`attemptUnderstandingGeneration` is a single-attempt generator for understanding artifacts. It accepts the evidence block, language, and the initial/repair prompt kind, then builds the corresponding prompt — `buildUnderstandingPrompt` for the first attempt or `buildUnderstandingRepairPrompt` (with prior candidate, prior errors, and an 8,000-character budget) for repairs. The LLM call is wrapped to translate both timeouts (`llm_timeout`) and other failures (`llm_call_failed`) into structured result objects with `usageEntry` but no artifact, so callers can record usage and move on without crashing. On a truncated or incomplete stop reason, the function records a `truncated_by_token_limit` or `incomplete_generation` validation error but still returns the raw text as `normalizedRaw` so the caller sees the partial output. Otherwise it runs `normalizeStage4Artifact` on the raw content; a normalization failure produces a structured validation error, and success yields the artifact plus its validation errors for further processing.

`runUnderstandingStage` mirrors the shape of `runSemanticTopicStage` but for understanding content: it iterates over target identities, gets or creates stage tasks, runs the bounded repair loop through `attemptUnderstandingGeneration`, and writes/verifies artifacts via `tryWriteAndVerify` with the same ownership checks and circuit-breaker logic. Each successful attempt commits the artifact and records usage; failures set `taskError` with an appropriate code and produce a checkpoint with diagnostic history.

## Folder and Oversized-File Generation (`attemptFolderGeneration` / `generateOversizedFilePage`)

`attemptFolderGeneration` and `generateOversizedFilePage` cover two edge cases in the pipeline. `attemptFolderGeneration` follows the same bounded-generation shape but targets folder index pages — building a prompt from the folder's module inventory, generating, validating, and writing the page with the identical repair and rollback semantics as topic generation. `generateOversizedFilePage` is a specialized entry path: when a source file exceeds the normal character budget, this function produces a page that is either a stub or a degraded summary rather than a full generation, since the content context cannot fit within budget. Both functions return structured results with usage and validation details so the outer stage loop can uniformly record them in checkpoints and the circuit breaker.

## Stage 4 and 5 Attempts (`attemptStage4Generation` / `attemptStage5Generation`)

`attemptStage4Generation` and `attemptStage5Generation` are the generic per-task generators for stages 4 and 5 respectively. They accept the task context (candidate evidence, language, LLM client, token budget, and repair context) and perform one LLM call to produce the artifact, followed by validation against the stage's schema. The batch loop invokes these in a repair loop identical to the topic path — initial attempt, then repair attempts with prior errors — and dispatches on each attempt's outcome: a valid artifact proceeds to `tryWriteAndVerify`; truncation resets state for another attempt; and LLM errors either fail the task immediately (on timeout) or allow a retry. Together, these functions give the pipeline a uniform "generate → validate → write/verify → checkpoint" rhythm across every content type, with recovery tiers and silent degradation isolating any single page's failure from the run as a whole.

## Page Assembly and Context Building
<!-- lw:anchors packages/core/src/batch.ts#buildModuleDocContext packages/core/src/batch.ts#buildTopicDocContext packages/core/src/batch.ts#buildFlowDocContext packages/core/src/batch.ts#buildFairTruncatedSource packages/core/src/batch.ts#buildSurgicalEvidenceSlice packages/core/src/batch.ts#getFileIdsForModule packages/core/src/batch.ts#getModuleSymbolRows packages/core/src/batch.ts#getRationaleEvidenceForPaths packages/core/src/batch.ts#computeCostFromUsage -->

The section covers the context-assembly layer of the batch pipeline: building the inputs that downstream stages (planning, drafting, and anchor resolution) consume. Every context object shares the same philosophy — the model must see a bounded, honest slice of the repository: a closed list of canonical symbol keys it may cite, a compact symbols table with signatures, a truncated source excerpt, and (where relevant) rationale evidence. The functions here differ in *what* they assemble — module, topic, or flow context — but they share helpers for fair source truncation and surgical evidence slicing.

`buildModuleDocContext` is the entry point for module-level page generation:

```ts
export async function buildModuleDocContext(
  absRoot: string,
  module: Module,
  charBudget: number,
  rationaleMaxChars = 0,
): Promise<ModuleDocContext>
```

It takes the project root, a `Module` descriptor, a total character budget, and an optional rationale cap; it returns an object containing `closedKeyList`, `symbolsTable`, `truncatedSource`, and `rationaleEvidence`. It first calls `getModuleSymbolRows` to fetch all active symbols for the module's files, then derives two artifacts from those rows: a sorted `closedKeyList` (the canonical keys the model may anchor) and a `symbolsTable` formatted as `- key (kind): signature` lines. It then calls `getRationaleEvidenceForPaths` with the module's paths and `rationaleMaxChars`, and — critically — carves the source budget from whatever remains: `sourceBudget = Math.max(0, charBudget - rationaleEvidence.length)`. That ensures rationale never pushes the total over budget. Finally it calls `buildFairTruncatedSource` with that remaining budget and assembles the return object.

`getModuleSymbolRows` is the query layer behind module context:

```ts
async function getModuleSymbolRows(
  absRoot: string,
  module: Module,
): Promise<ModuleSymbolRow[]>
```

It opens the index database, resolves the module's file IDs via `getFileIdsForModule`, then selects `key, name, kind, signature, start_line, end_line` for all active symbols in those files. When no files exist it returns an empty array (using a `NULL` fallback in the `IN` clause to avoid an SQL syntax error). `getFileIdsForModule` itself is a straightforward helper:

```ts
async function getFileIdsForModule(absRoot: string, module: Module): Promise<number[]> {
```

It maps `module.paths` to database file IDs by selecting `id` from `files WHERE path IN (...)`. Both functions open and close the index DB in a `finally` block, so callers never leak connections.

`getRationaleEvidenceForPaths` fetches stored rationale annotations for a set of paths:

```ts
async function getRationaleEvidenceForPaths(
  absRoot: string,
  paths: ReadonlyArray<string>,
  maxChars: number,
): Promise<string>
```

It takes the project root, the paths to query, and a maximum character count; it returns a formatted string of rationale evidence, or an empty string when `maxChars` is non-positive or no paths are given. The function joins the rationale table with files, orders by path and line, and hands the rows to `renderRationaleEvidence` (defined elsewhere), which applies the character bound.

`buildFairTruncatedSource` is the shared source-excerpt builder used by both module and flow contexts:

```ts
export async function buildFairTruncatedSource(
  absRoot: string,
  paths: ReadonlyArray<string>,
  charBudget: number,
): Promise<string>
```

It takes the project root, a list of file paths, and a budget; it returns a string of concatenated file contents with per-file headers. The fairness mechanism addresses a concrete failure mode: sequential first-fit truncation gave later files zero context, which correlated with hallucinated anchors (`// === path ===` headers mark each file). The function first reads every readable path into memory, skipping unreadable ones. If the untruncated total fits within budget, it returns the full assembly directly. Otherwise it divides the budget into equal shares per file — with a floor of 128 chars per file — and truncates each file's body to its share minus header overhead. A trailing `"// ... (truncated by budget)"` comment marks cuts, and a final hard cap handles the rare case where truncation markers push the result just over budget. The result is a context where every module file gets *some* representation, so the model can describe each surface accurately.

`buildTopicDocContext` builds context for a topic candidate:

```ts
export async function buildTopicDocContext(
  absRoot: string,
  candidate: TopicCandidate,
  charBudget: number,
  rationaleMaxChars = 0,
  modulePaths?: ReadonlyMap<string, readonly string[]>,
): Promise<TopicDocContext>
```

It takes the project root, a topic candidate, a character budget, an optional rationale cap, and an optional map of module IDs to paths; it returns a `TopicDocContext` with `symbolsTable`, `moduleDigest`, `truncatedSource`, `rationaleEvidence`, and `proseEvidence`. The function queries the index for all active symbols matching the candidate's `seedKeys`, sorts them by key, and formats the symbols table. It then builds a module/flow digest by reading each referenced module page and flow page, extracting opening digests via `extractModuleOpeningDigest` (with an honest `"Page unavailable"` fallback). For source, it reads each symbol's file (caching lines per path) and renders exact span excerpts via `renderTopicSourceSpan` — the same span math used by the planner estimate, so the two never drift. It then queries rationale rows for the symbol files, bounded by `rationaleMaxChars`, and throws if rationale plus source exceeds the budget — a guard that never fires on rationale alone because the preceding logic accounts for it.

The prose-evidence path is a follow-up for prose-tier files (Dockerfile, compose files, launchers, docs) that have no symbol keys and thus cannot appear in the closed list. Without their content, the model could not describe deployment surfaces honestly — a real observed failure where the "deployment" topic came out about the CLI because `cli.py` owned every key. When `modulePaths` is provided, the function collects the candidate modules' files, selects those with zero active symbols, and excerpts them from the budget *left over* after anchors and rationale. Each prose block carries a header instructing the model to describe but never cite it as an anchor (`// === path (prose file — no canonical keys; describe, never cite as an anchor) ===`), capped per file by `TOPIC_PROSE_FILE_MAX_CHARS`. The hard throw stays unreachable because the carving order guarantees the total fits.

`buildSurgicalEvidenceSlice` is a focused variant for producing a compact, cited-only evidence slice:

```ts
async function buildSurgicalEvidenceSlice(
  absRoot: string,
  symbolsTable: string,
  citedKeys: readonly string[],
): Promise<string>
```

It takes the project root, a pre-built symbols table, and the list of keys actually cited in a draft; it returns either an empty string (when no keys are cited), a rows-only block, a spans-only block, or both joined. When called, it filters the symbols table lines down to those whose keys appear in `citedKeys`, then computes a span budget as `SURGICAL_EVIDENCE_MAX_CHARS` minus the rows block length. It queries the index for active symbols matching the cited keys (joining `files` for paths), sorts them by key, and reads each file to render source spans; spans that exceed the remaining budget are truncated with a `"// ... (truncated by budget)"` comment, and the loop stops once the budget is exhausted. The function closes the DB in a `finally` block. This helps stage-4 anchor resolution: the model sees only the evidence relevant to what it actually cited, not the whole module.

`buildFlowDocContext` assembles context for a flow candidate:

```ts
async function buildFlowDocContext(
  absRoot: string,
  candidate: FlowCandidate,
  modules: ReadonlyArray<Module>,
  charBudget: number,
): Promise<FlowDocContext>
```

It takes the project root, a flow candidate, the full module list, and a character budget; it returns `closedKeyList`, `symbolsTable`, `moduleOpenings`, and `truncatedSource`. The function builds a sorted `closedKeyList` directly from `candidate.seedKeys`, queries the index for those keys' active symbols, and formats the symbols table. It then walks the candidate's `moduleIds` in order, reading each module's `index.md` and extracting an opening digest — again with an explicit `page unavailable` marker rather than an invented summary. Finally, it collects the candidate modules' files in walk order (deduplicated via a `seenFiles` set) and feeds them to `buildFairTruncatedSource`, which applies the same fair per-file share as the module path.

Rounding out the section is `computeCostFromUsage`, a pure utility used wherever callers need to price a generation:

```ts
function computeCostFromUsage(
  usage: { inputTokens: number; outputTokens: number; model: string },
  override: import("./pricing.js").PricingOverride | undefined,
): ReturnType<typeof calculateCostUsd>
```

It takes a token-usage object and an optional pricing override, and returns a cost in USD (or `null` when the model is unpriced). The function first tries the override — if the model is present there, it prices via `calculateCostUsd` with that override. Otherwise it falls back to `lookupPricing(usage.model)`; a missing table entry returns `null`, and a hit delegates to `calculateCostUsd` again. This gives callers a single, predictable pricing path that honors per-run overrides without breaking on unknown models.

## Write Verification and Repair
<!-- lw:anchors packages/core/src/batch.ts#tryWriteAndVerify packages/core/src/batch.ts#tryWriteFlowAndVerify packages/core/src/batch.ts#tryWriteModuleDiagramAndVerify packages/core/src/batch.ts#verifyIssuesToValidationErrors packages/core/src/batch.ts#isArtifactVerifyCode packages/core/src/batch.ts#isDeferredBaselineIssue packages/core/src/batch.ts#rollbackWrittenArtifacts packages/core/src/batch.ts#prepareSurgicalRepair packages/core/src/batch.ts#isRelaxedEligible -->

The write path for any artifact is built around a single invariant: **a candidate that fails verification must never persist on disk**. Everything downstream — the three `tryWrite*` entry points, the rollback helper, and the error-classification utilities — exists to defend that invariant while preserving anything a human already owns. Each entry point follows the same four-stage arc: prepare the candidate (preserving manual blocks and `owner` declarations), write it, verify it, and on any failure roll it back hard.

The core routine is `tryWriteAndVerify`, the single-page variant. Its first two steps mutate the incoming `newContent` before any write happens. If `existing` is non-null (the page already on disk), it calls `injectManualBlocksBySection(existing, newContent)` to re-insert any human-written manual blocks into the positions they occupied in the original page — blocks from sections that vanished in the new content are appended at the end of the page rather than lost. If the existing page's frontmatter declares `owner: mixed`, it calls `forceOwnerInFrontmatter(finalContent, "mixed")`, because the LLM always emits `owner: generated` and the classification must not silently downgrade a page the human marked as mixed. Only then does the function snapshot the existing content and move to the transaction:

```ts
async function tryWriteAndVerify(
  absRoot: string,
  wikiPath: string,
  newContent: string,
  existing: string | null,
  rejectAnySeverity = false,
): Promise<WriteResult>
```

It takes the repo root, the wiki-relative path, the prepared content, the previous content (or `null` for a brand-new page), and a flag that relaxes the rejection threshold from errors-only to any severity; it returns a `WriteResult` describing either the accepted artifacts, the rejected issues, or a rollback failure.

The write and the verify run inside **one** `try/catch`. If `safeIo.writeText` or `runVerify` throws, the catch handler calls `rollbackWrittenArtifacts` on the single entry `{ path: wikiPath, snapshot }`, restoring the original bytes. A throw here is treated exactly like a rejection: the page is rolled back best-effort, and the function reports either the rollback failure or the original exception. If verification completes, the function filters the reported issues to those that target this `wikiPath`, are not deferred baseline issues, and meet the severity threshold (`rejectAnySeverity` or `severity === "error"`). Any match triggers the rejection branch, which rolls back with `guardedRemoval` disabled — meaning even a delete of a newly-created file is unconditional — and returns the broken issues. Only a clean page passes through to produce `pageHash = sha256(finalContent)` and return `ok: true`.

`tryWriteFlowAndVerify` is the same four-stage arc widened to a transaction of **three** artifacts. Its signature reads:

```ts
async function tryWriteFlowAndVerify(
  absRoot: string,
  pagePath: string,
  diagramPath: string,
  pageContent: string,
  diagramSource: string,
  existingPage: string | null,
): Promise<FlowWriteResult>
```

It takes the repo root, the page path, the diagram path, the new page content, the raw diagram source, and the previous page (or null); it returns a `FlowWriteResult` describing the accepted pair and hub, the rejected issues, or a rollback failure. Step 1 is byte-for-byte identical to the single-page variant: manual-block repositioning and `owner: mixed` restoration, so both entry points share the same review-finding #7b semantics. Before writing, it snapshots not just the page and the diagram (`safeIo.readText` with a `null` fallback when the diagram is new) but also the flows hub at `livewiki/flows/index.md`, and initializes `hubWritten = false`. Inside the transaction it writes the page, writes the diagram (appending a trailing newline if the source lacks one), then calls `syncFlowsIndexHub` with the freshly loaded flow presentations; only if that sync reports `outcome === "written"` does it set `hubWritten` so the hub joins the rollback set. Then it runs the verifier. The exception path rolls back the page, the diagram, and — only if `hubWritten` — the hub. The rejection filter here is noticeably stricter than the single-page gate: it rejects the pair on **any** issue — error or warning — targeting either written path, a deliberate asymmetry documented as R10.1 item B; issues on other paths never block. A rejection rolls back all three artifacts and returns the issues; a clean run returns hashes of the final page content and the normalized diagram source.

`tryWriteModuleDiagramAndVerify` is the middle variant, a page-plus-diagram pair without the hub:

```ts
async function tryWriteModuleDiagramAndVerify(
  absRoot: string,
  pagePath: string,
  diagramPath: string,
  pageContent: string,
  diagramSource: string,
  existingPage: string | null,
): Promise<ModuleDiagramWriteResult>
```

It takes the same shape of inputs as the flow variant — repo root, page and diagram paths, page content, diagram source, existing page — and returns a `ModuleDiagramWriteResult`. Step 1 reuses the identical manual-block and `owner: mixed` mechanism. It snapshots the page and the diagram, then writes both inside one `try/catch`, with rollback of both on any exception. The rejection filter targets error-severity issues on either the page path or the diagram path only (the stage-4 gate: warnings never block), and rollback is mandatory for both artifacts. Success returns both hashes plus the diagram path.

Underpinning all three entry points is the rollback helper:

```ts
async function rollbackWrittenArtifacts(
  absRoot: string,
  entries: ReadonlyArray<{ path: string; snapshot: string | null }>,
  guardedRemoval: boolean,
): Promise<string[]>
```

It takes the repo root, a list of `{ path, snapshot }` pairs, and a flag controlling whether newly-created files are protected from deletion; it returns an array of human-readable failure reasons, empty on complete success. For each entry, a non-null snapshot means the file previously existed, so it restores the old bytes via `safeIo.writeText`. A null snapshot means the file is new; when `guardedRemoval` is true, it first `lstat`s the path and skips deletion unless the target is a regular file (the guard used on exception paths, where a concurrent writer might own the file), while a false flag removes unconditionally (the guarantee used on rejection paths, where the invalid candidate must not linger). Every restore or removal failure is captured as a reason string; the caller treats a non-empty reason array as a terminal `rollbackFailed` outcome.

Two classification helpers feed the severity filters and the repair pipeline. `isDeferredBaselineIssue` decides whether a verification finding is the special case that never blocks a write:

```ts
function isDeferredBaselineIssue(issue: VerifyIssue): boolean {
  return issue.code === "baseline_entry_without_anchor";
}
```

It takes a `VerifyIssue` and returns `true` when the finding describes a baseline entry missing an anchor — a deferred audit item, not a candidate-shape error — so every entry point in this section excludes it from its `broken` set. `isArtifactVerifyCode` narrows the opposite direction: it identifies which verifier codes describe defects the model can actually repair in the artifact's own shape:

```ts
function isArtifactVerifyCode(
  code: VerifyIssue["code"],
): code is Extract<ArtifactValidationError["code"], VerifyIssue["code"]> {
  return code === "broken_anchor" ||
    code === "broken_internal_link" ||
    code === "invalid_mermaid_diagram" ||
    code === "manual_block_altered" ||
    code === "think_block_present" ||
    code === "missing_wiki_path";
}
```

It takes a verifier issue code and returns a type predicate confirming, when true, that the code also exists in the `ArtifactValidationError` domain — the closed set of errors the repair contract understands. Codes outside this list — baseline-compatibility findings, removed-anchor audits, anything else the model cannot fix by editing the candidate — are deliberately excluded.

`verifyIssuesToValidationErrors` bridges from the verifier's output into that repair contract:

```ts
function verifyIssuesToValidationErrors(
  issues: ReadonlyArray<VerifyIssue>,
): ArtifactValidationError[] {
```

It takes the full list of verifier issues and returns the subset expressible as `ArtifactValidationError`. For each issue whose code passes `isArtifactVerifyCode`, it maps the code to a location (`"frontmatter"` for `broken_anchor`, `"body"` otherwise), keeps the detail message, and attaches the offending wiki path when present. Issues that are not artifact codes are dropped entirely — they are repository-audit failures, not candidate defects, and must not be fed back into a repair loop that would futilely edit the candidate.

`prepareSurgicalRepair` is the entry point to that loop, scoping a repair to only the sections that failed:

```ts
async function prepareSurgicalRepair(
  absRoot: string,
  priorCandidate: string,
  priorErrors: ReadonlyArray<ArtifactValidationError>,
  symbolsTable: string,
): Promise<SurgicalRepairPlan | null>
```

It takes the repo root, the previously rejected candidate content, the validation errors from that rejection, and the symbols-table text; it returns a `SurgicalRepairPlan` with the base page, the target section slugs, and an evidence slice — or `null` when no surgical repair is possible. It first calls `surgicalRepairTargetSections(priorErrors)` to derive which H2 sections the errors implicate; if that returns `null` (the errors are not section-localized), the whole repair is abandoned. It normalizes the prior candidate via `normalizeStage4Artifact` (aborting on failure), splits the content into H2 sections with `splitH2Sections`, and aborts unless every target section slug is present. The key work is extracting **anchor keys**: it scans each targeted section's raw text for `lw:anchors` comment markers, collecting the cited keys, then passes the sorted key list to `buildSurgicalEvidenceSlice` to pull the relevant symbol documentation from the symbols table. The resulting plan — base content, target slugs, and evidence — lets a later stage regenerate only the broken sections rather than the whole file.

Finally, `isRelaxedEligible` decides whether a page kind may take the relaxed re-verification path after repair:

```ts
function isRelaxedEligible(
  pageKind: "module" | "flow" | "topic",
  errors: ReadonlyArray<ArtifactValidationError>,
): boolean {
  return errors.length > 0 && collectUnclassified(pageKind, errors).length === 0;
}
```

It takes the page kind and the validation errors from the prior rejection, and returns `true` only when errors exist **and** every one of them is classifiable for that page kind (no unclassified remainder). A page with any error the classifier cannot map to a repair strategy is barred from the relaxed path, forcing the strict recovery route instead.

## Manual Content Preservation and Diagnostics
<!-- lw:anchors packages/core/src/batch.ts#readOwnerFromFrontmatter packages/core/src/batch.ts#forceOwnerInFrontmatter packages/core/src/batch.ts#extractManualBlocksBySection packages/core/src/batch.ts#slugifyHeadingText packages/core/src/batch.ts#injectManualBlocksBySection packages/core/src/batch.ts#sectionRangeOf packages/core/src/batch.ts#summarizeLlmDiagnosticError packages/core/src/batch.ts#summarizeVerifyDiagnosticErrors packages/core/src/batch.ts#diagnosticAttempt packages/core/src/batch.ts#understandingAttemptDiagnostic packages/core/src/batch.ts#topicAttemptDiagnostic packages/core/src/batch.ts#topicPlanDiagnostic -->

The pipeline's batch rewrite must never silently destroy content a human wrote by hand. Two mechanisms cooperate to guarantee this: a frontmatter `owner` marker that declares whether a page may be regenerated at all, and the `lw:manual` block markers that fence off human-authored fragments so the generator can surgically splice them back into freshly generated output. The functions below implement both halves, plus a family of diagnostics builders that report what each LLM attempt produced and how it failed.

**Owner detection and enforcement.** `readOwnerFromFrontmatter(content: string | null): PreOwnerCheck` inspects a document's frontmatter to answer one question: is this page owned by the generator, by a human, or is its provenance untrusted? It strips a UTF-8 BOM if present, accepts both LF and CRLF line endings after the leading `---` (defending against generators that save with Windows or `git autocrlf` conventions), and normalizes to LF before parsing. If the `owner` key is missing, is not a string, or holds a value other than `generated`, `mixed`, or `human`, the function reports `"untrusted"` — the caller must then refuse to overwrite. A `null` input or a missing/`unparseable` frontmatter also maps to a sentinel the caller treats as forbidden. The reviewer revision admits `owner: mixed` as a valid state: the page may be regenerated only in part, and any manual blocks within it must survive byte-for-byte.

`forceOwnerInFrontmatter(content: string, owner: "generated" | "mixed"): string` rewrites that ownership claim. Given a document that already opens with `---`, it locates the closing `---` of the frontmatter block, then either replaces an existing `owner: ...` line (matching any value via a multiline regex) or, if no `owner:` line exists, injects one immediately after the opening delimiter. If the string does not start with a frontmatter fence or the closing marker is absent, it returns the content unchanged rather than risking a malformed write. This is the surgical counterpart to `readOwnerFromFrontmatter`: read before deciding, force-write when the page is deemed safe to regenerate.

**Extracting manual sections from the old document.** `extractManualBlocksBySection(content: string): Map<string | null, string[]>` scans the existing page for every `lw:manual` start and `<!-- /lw:manual -->` end marker, recording their offsets in a sorted list. It simultaneously collects all markdown headings (levels 1–6) with their offsets, slugified via `slugifyHeadingText(text: string): string` — a lowercase, accent-stripped, punctuation-removed, whitespace-collapsed-to-hyphen form that lets the matcher compare headings across documents regardless of formatting drift. Walking the sorted marker hits, the function pairs each start with the next end; for each pair it determines the section by finding the heading whose offset immediately precedes the start marker, then slices the content between the markers (inclusive of both marker comment tokens) and appends that block to the list for its section slug. Blocks that appear before any heading are keyed under `null`. The result is a map from "which section this block lives in" to "the exact text to reinsert".

**Re-inserting the blocks into new output.** `injectManualBlocksBySection(existing: string, newContent: string): string | null` is the inverse operation. It first extracts the blocks from the old document; if none exist it returns `null` (no change needed). Otherwise it finds headings in the freshly generated `newContent` — again with slugs, offsets, and heading levels — and defines `sectionRangeOf(headingOffset: number): { endOffset: number }` to compute where a given heading's section ends: at the offset of the next heading of the same or lower level, or at the end of the document if no such successor exists. For each extracted section, the function locates the corresponding heading in the new content by its slug. If found, it inserts the block at the end of that section; if the section no longer exists in the new version, or the block had no preceding heading (`null` slug), it appends the block to the end of the page so the human content is never lost. All insertions are collected as `(offset, text)` pairs, sorted by offset in descending order, and spliced into the new content one by one — descending order guarantees earlier insertions do not shift the offsets of later ones. The joined blocks preserve their original blank-line separation, and the returned string is the new page with every manual block restored in place.

**Diagnostics builders.** The remaining functions shape structured records of what happened during LLM-driven generation attempts, so operators can understand failures without re-reading raw transcripts. `understandingAttemptDiagnostic(attempt: number, promptKind: "initial" | "repair", result: UnderstandingAttemptResult): DiagnosticAttempt` builds a record for a single understanding-stage attempt: it caps the validation errors at `DIAGNOSTIC_MAX_ERRORS`, truncates each message to `DIAGNOSTIC_TEXT_CAP` characters, counts how many errors were truncated, includes the candidate character count and SHA-256 hash when a candidate was produced, and snapshots `Date.now()` as the finish time. `topicAttemptDiagnostic(attempt: number, promptKind: "initial" | "repair", result: Stage4AttemptResult): DiagnosticAttemptWithSurgical` parallels this for the topic stage but also folds in a surgical outcome flag if present. `topicPlanDiagnostic(attempt: number, promptKind: "initial" | "repair", outcome: DiagnosticOutcome, candidate: string, errors: readonly TopicPlanValidationError[], stopReason?: StopReason, rawStopReason?: string): DiagnosticAttempt` covers the planning stage, assigning every error a `"global"` location since plan validation is not section-scoped. Two summarizers share the same capping and truncation logic for different error shapes: `summarizeLlmDiagnosticError(error: { code: string; message: string }): DiagnosticErrors` wraps a single LLM-reported error with a `"global"` location, and `summarizeVerifyDiagnosticErrors(issues: ReadonlyArray<VerifyIssue>): DiagnosticErrors` maps verification issues to `"frontmatter"` or `"body"` locations based on the `broken_anchor` code, optionally attaching the offending wiki path. Finally, `diagnosticAttempt(input: { attemptResult: Stage4AttemptResult; promptKind: "initial" | "repair"; outcome: DiagnosticOutcome; errors: DiagnosticErrors; budgetConsumed?: boolean }): DiagnosticAttemptWithSurgical` is the general-purpose constructor used by callers that already have a summarized error list; it merges the attempt number from the usage entry, preserves stop-reason and raw-stop-reason fields only when defined, records mechanical-repair and relaxed-attempt flags, and computes candidate statistics, with a `budgetConsumed` flag for the case where the recovery budget ran out. Together these builders give every failed or partial attempt a compact, machine-readable fingerprint — who tried, how far they got, what they produced, and what went wrong — that the orchestration layer can log, compare, and act on.

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
