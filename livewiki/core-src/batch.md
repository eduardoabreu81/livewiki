---
title: batch.ts — the documentation pipeline orchestrator
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
  - packages/core/src/batch.ts#isRelaxedEligible
  - packages/core/src/batch.ts#orchestrate
  - packages/core/src/batch.ts#prepareSurgicalRepair
  - packages/core/src/batch.ts#readOwnerFromFrontmatter
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

# batch.ts — the documentation pipeline orchestrator

`batch.ts` owns the multi-stage documentation pipeline that turns an indexed repository into a verified `livewiki/` wiki: it loads the index, decides which file and folder units to document, drives the LLM workers that produce each page, writes and verifies each artifact transactionally, and records the run's progress in SQLite so it can be resumed or re-run per task.

## When to use this page

- **Run a full documentation pipeline** from a clean index with `runBatch`, or pick up a previously interrupted run with `resumeBatch`, and read the resulting `BatchRunResult` to drive UX, CLI output, or exit codes.
- **Re-run a single task** after a repair or a human edit with `runOnly` (the `--only` path), either to fix a failed module, file, or folder page, or to retry a `flow:`, `topic:`, or `understanding` target.
- **Diagnose a failed task** by inspecting the `usageHistory`, `diagnosticHistory`, and `error` fields persisted in the `batch_tasks` checkpoint, and by reading the human-readable summary produced by `summarizeLlmDiagnosticError`, `summarizeVerifyDiagnosticErrors`, and `summarizeDiagnosticErrors`.
- **Map progress to a run surface** (CLI table, JSON consumer, or `livewiki status`) using `statusToExitCode`, `buildResult`, `finalizeRun`, and the authoritative `tasksDone` / `tasksFailed` counters that account for every stage (4 + 5 flows + 5 topics + understanding).

## How it fits

`batch.ts` is the central orchestrator of the `packages/core` layer — it sits between the lower-level infrastructure (`safe-io`, `db`/`indexer`, `anchor-ledger`, `verify`, `manifest`, `frontmatter`) and the LLM-driven generation stages built on `prompts`, `artifact`, `artifact-repair`, `section-guard`, `flows`, `topics`, `understanding`, `flow-diagram`, `auxiliary-page`, and `output-budget`. A single `orchestrate` driver is responsible for the entire run shape: it opens the SQLite index, resolves runtime options against `config`, instantiates an `LlmClient` when needed, runs stages 1–3 (scan, page-unit planning, prioritization), then loops over the stage-4 module queue with a bounded repair budget, a circuit breaker, and concurrent workers controlled by `batchConcurrency`. After stage 4, the same orchestrator gates stage 5 (product flows, topics, and the optional repository understanding synthesis), and finally calls `finalizeRun` to drain pending metrics, persist the manifest, and produce a `BatchRunResult` that the CLI and dashboards render.

The three public entry points — `runBatch`, `resumeBatch`, and `runOnly` — are thin wrappers that pin the pipeline `mode` (`"run"`, `"resume"`, or `"only"`) and forward everything else to `orchestrate`. Resume and `--only` reuse the existing run snapshot and never re-run the indexer; they rely on the per-task checkpoints in `batch_tasks` to know which units are still pending or failed. The file owns the **batch policy** (circuit breaker, retryable-vs-skip outcomes, transactional write, manual-block preservation, exit-code mapping) but delegates every individual concern — prompt assembly, artifact normalization, surgical repair, diagram extraction, community detection, topic planning, understanding synthesis — to a dedicated module imported at the top of the file.

## Entry points and the run/resume/only orchestration spine
<!-- lw:anchors packages/core/src/batch.ts#runBatch packages/core/src/batch.ts#resumeBatch packages/core/src/batch.ts#runOnly packages/core/src/batch.ts#orchestrate packages/core/src/batch.ts#EmptyPipelineError packages/core/src/batch.ts#EmptyPipelineError.constructor packages/core/src/batch.ts#TaskError packages/core/src/batch.ts#TaskError.constructor -->

The batch module exposes three entry points that all funnel into the same internal orchestrator. The first is:

```ts
export async function runBatch(opts: BatchOptions): Promise<BatchRunResult>
```

The symbol takes a `BatchOptions` object and returns a `Promise<BatchRunResult>` — in plain terms, the user's options for a full batch run, and a promise that eventually yields the aggregated result of that run. `runBatch` simply forwards the call to `orchestrate` with `mode: "run"` attached, so a fresh run is just "run the whole pipeline". The second entry point is:

```ts
export async function resumeBatch(opts: BatchOptions): Promise<BatchRunResult>
```

`resumeBatch` takes the same `BatchOptions` shape and returns the same `BatchRunResult` promise — semantically identical to `runBatch` from the caller's point of view, except it tags the call with `mode: "resume"` so `orchestrate` reopens an existing batch run instead of starting a new one. The third entry point is:

```ts
export async function runOnly(opts: BatchOptions): Promise<BatchRunResult>
```

Like its siblings, `runOnly` takes `BatchOptions` and returns a `Promise<BatchRunResult>`. It guards against a missing `opts.onlyTarget` by throwing a plain `Error("onlyTarget is required for runOnly")` before delegating, so a caller who forgets the selector fails fast with a clear message rather than silently running the full pipeline. After that guard it forwards to `orchestrate` with `mode: "only"` — `runOnly` is the surgical "redo just this one target" path.

The actual pipeline work all lives in:

```ts
async function orchestrate(opts: OrchestrateOpts): Promise<BatchRunResult>
```

`orchestrate` takes an `OrchestrateOpts` record (the same options but now carrying an explicit `mode`) and returns a `Promise<BatchRunResult>` — it both begins the work and resolves the final result. It starts by resolving the repository root to an absolute path and ensuring the `.livewiki` directory exists, then resolves and validates the SQLite index database path and opens it via `openIndex`. With the database ready, it loads configuration from disk through `loadConfig`, applies defaults via `applyDefaults`, and picks the output language using the `opts.language ?? resolvedConfig.language ?? "en"` precedence rule.

Configuration continues with the resolution of `configuredExtraIgnores` from the on-disk config. This is the single source of truth for repository ignore patterns — there is no programmatic override on the programmatic API. The block comment makes the semantics explicit: resume and `--only` never rescan, so those ignore patterns only matter to the walker on the `mode === "run"` path; resume picks up the snapshot the original run already produced.

Several numeric and boolean tunables are resolved next, all following the same `opts > config > default` precedence with strict validation. `maxRepairAttempts` falls back to `2` and must be a non-negative integer, otherwise an `Error` describes the bad value. `maxIncompleteRetries` follows the same shape with the same default of `2`. `batchConcurrency` (the stage-4 worker pool size) falls back to `CONFIG_DEFAULTS.batchConcurrency`, must be an integer in `[1, 16]`, and values outside that range produce a validation `Error`. The two recovery-tier toggles `surgicalRepair` and `relaxedRound` both default to `true`. The roadmap-22 module-page feature flags `moduleDiagramsEnabled` and `deepHierarchy` default to `false`, and when module diagrams are on, `moduleDiagramBudgets` is built from the resolved config defaults so the module diagram gate uses its own per-module budget rather than reusing the flow budgets. `concernTopics` defaults to `true`, `understandingSynthesis` defaults to `true`, and `communityDetection` defaults to `true` but stays diagnostic-only. `stage4MaxOutputTokens` falls back to `8192`, `outputTokenStrategy` falls back to `"dynamic"`, `charBudget` falls back to `60_000` (with `rationaleMaxChars` carved inside it), and `thinkingMode` resolves from `opts.thinking ?? resolvedConfig.thinking`.

Legacy size-split knobs (`maxModuleFiles`, `maxModuleSymbols`) are noted in the source as no longer driving any split — pages are real file/folder units now — but the config keys still parse for backward compatibility.

An LLM client is created if not injected. The `needsLlm` predicate is true for `mode === "only"`, `"run"`, `"resume"`, or when `--no-refine` is *not* set; the comment is explicit that `--no-refine` only skips stage-2 refinement and must never skip client creation, otherwise stage 4 runs without an LLM and every doc task fails. When a client is needed and `opts.llmClient` is empty, `validateConfigForBatch` validates the resolved config and `createLlmClient` builds the client.

`runId` is then resolved. On a fresh `run`, a row is inserted into `batch_runs` with stage `1` and status `'running'`, capturing a JSON-serialized config snapshot (`language`, `noRefine`, `contextCharBudget`, `maxRepairAttempts`, `maxIncompleteRetries`, `batchConcurrency`), and the inserted id becomes `runId`. On `resume` or `only`, `orchestrate` looks up the most recent `batch_runs` row by descending id; if none exists it throws `Error("no batch run to resume/retry")`.

Stage 1 runs only on fresh runs. When `opts.mode === "run"`, `runIndexer` walks the repository — forwarding `configuredExtraIgnores` so a `livewiki batch` without a preceding `livewiki init` still honors the configured ignore set — and `runLedger` runs right after with `quiet: true` on both. After the indexer and ledger, `orchestrate` reads the active inventory in two queries: one for `symbols WHERE status = 'active'`, and one for `files WHERE status = 'active'`. The file-side query produces `filePaths` as a sorted unique set; the comment notes this is the single source of truth shared with `init.ts:buildPlan` — re-export-only barrels and other active files with zero symbols still appear here, while deleted file rows stay excluded. A `symbolCountByPath` map is built by splitting each symbol's key on `#` and incrementing the file-side counter.

File-level import edges are resolved once and hoisted above stage 2: `collectImportsForFiles` produces `importsByFile`, `knownFiles` is built from `filePaths`, `loadWorkspacePackages` resolves declared workspace packages, and `resolveImportEdges` consumes those plus the effective TypeScript config, Go module path, and Rust crate name. The comment is explicit that this is the single resolution for relative and declared-workspace specifiers, and the result is reused downstream by the community cross-check, stage 3's module-edge projection, and stage 5's flow detector.

Stage 2 is the real repository page units stage. The comment explains the contract: a FILE or a FOLDER, units the reader can actually see in the repository, with no LLM refine pass and no on-disk size-based chunk splitting. `--no-refine` is accepted but is a no-op for backward compatibility. `sizeRows` is read from `files WHERE status = 'active'` and turned into a `sizeByPath` map, and `planPageUnits` partitions the indexed inventory into file and folder units using `resolvedConfig.pathRoles` and `resolvedConfig.fileSplitSourceBytes` when present. The result yields a `folderUnitById` map and a `fileUnitById` map, which `orchestrate` then projects into `modules` (one per folder, with paths = every indexed file in that folder and an aggregated `symbolCount`) and `fileModules` (one per symbol-bearing non-test file, with the file's repo path and its own symbol count). A stage-2 task row is created via `createOrGetTask(db, runId, 2, "modules", opts.mode)`; when present, a checkpoint is written with `status: "done"` and the (deterministic) planner result. The community cross-check — when `communityDetection` is on — runs `detectFileCommunities` and `comparePartitions` to produce a `CommunityCrossCheckReport`; any exception in the cross-check degrades silently to `undefined` so the checkpoint never reports a status change from diagnostics.

The exact-partition gate asserts uniqueness and full coverage and rewrites IDs deterministically. `makeUniqueDeterministicIds(modules)` is called, `assertExactPathPartition(modules, filePaths)` verifies the folder modules cover every active file exactly once, then `makeUniqueDeterministicIds` is reapplied and `assertUniqueModuleIds(modules)` confirms there are no collisions. If any of those asserts fail, the error is caught, the batch run row is moved to terminal `status: "aborted"` with a `finished_at` timestamp and a `summary_json` describing the abort (so a REVIEW finding #3 compliance point is satisfied — the run never stays as `'running'`), and the original error is re-thrown so the caller sees it.

Stage 3 reuses the hoisted import data: `resolveModuleEdges(modules, importsByFile, knownFiles, resolvedImportEdges)` projects edges onto the folder module graph, and `prioritizeModules(modules, edges, resolvedConfig.pathRoles)` yields a priority-ordered list. Defense-in-depth applies the deterministic-id and uniqueness asserts again on the prioritized list.

Stage 4 orchestrates documentation. Counters `cb` (consecutive/fails/done), `moduleTasksDone`, and the `failures`, `degradedPages`, `moduleUsage`, `stage2UsageAcc`, `stageUsageTotals`, `byStageAcc`, and `failedModuleIds` are all initialized here, along with `runAbortedByRollback`. The stage-4 queue is built by sorting `fileModules` first (folder groups first by stage-3 priority, then `symbolCount` desc, then id) and appending the prioritized folder modules in stage-3 order; this guarantees each folder's accepted file pages exist before the folder synthesis runs. The `--only` target is decomposed into its possible forms: `onlyFlowSlug` for `flow:<slug>`, `onlyTopicIdentity` for `topic:<identity>`, `onlyUnderstanding` for the special `UNDERSTANDING_ONLY_TARGET` token, and an `onlyAlias` that translates `file:<repoPath>` and `folder:<folderId>` into unit ids while letting bare unit ids pass verbatim. `tasksToRun` then picks the matching entry from `stage4Queue` when an `--only` target is given, or the full queue otherwise; flow/topic/understanding-only targets collapse `tasksToRun` to `[]`. Two guards follow: when an `--only` target was given but resolved to no queue entry, a plain `Error` reports the unknown identifier; and when the queue is non-empty but `tasksToRun` ends up empty outside `mode === "only"`, a structural pipeline failure is reported by throwing:

```ts
export class EmptyPipelineError extends Error
```

```ts
new (message: string): EmptyPipelineError
```

The constructor takes a human-readable message describing the failure. This error class exists specifically to mark the case where the planner produced page units but no tasks made it through the filter — the comment explicitly labels this "a pipeline bug, not a completed run", so the caller can distinguish this from a routine empty run.

On `mode === "only"` with an `onlyTarget`, the existing task row for that target is reset by flipping its `status` back to `'pending'` and bumping `updated_at`, while leaving `usageHistory` from earlier attempts intact in the checkpoint_json. `withDegraded` is a small adapter that, when `degradedPages` is non-empty, attaches a `degradedPages` field to the final `BatchRunResult`. The class diagrams are synchronized with `syncClassDiagrams(absRoot, ordered, symbols)` before stage 4 so that obsolete files from a prior plan cannot survive and trip the repository-wide verify step.

The inner `runStage4ModuleTask` helper is the unit of work that both the sequential driver and the worker-pool driver share. It looks up (or creates) the stage-4 task via `getOrCreateTask`, accumulates its own `moduleUsageEntry`, carries forward `usageHistory` and `diagnosticHistory` from the previous checkpoint, and resolves which kind of unit it's handling: `folderUnit` for folder units and `fileUnit` for file units. The wiki path is computed from that — folder pages land at `livewiki/<folder>/index.md`, file pages at `livewiki/<id>.md` — and `withTestsPointer` decorates file-page content with a deterministic `## Tests` section that only references same-name test files (1:1) or name-prefix matches (reported as "likely", never asserted). A pre-LLM ownership check reads the existing page's frontmatter via `readOwnerFromFrontmatter`. The check recognizes four states:

```ts
class TaskError extends Error
```

```ts
new (code: string, message: string): TaskError
```

The constructor takes a stable error code and a human-readable message. `TaskError` instances are constructed and assigned to `taskError` when the pre-LLM check rejects a module — `refused_human_page` for `owner: human`, `owner: untrusted` (missing or invalid `owner:` line), `refused_unparseable_page` for frontmatter that did not parse. The comment notes rule #6: a human-owned page is untouchable, and a `mixed` page is allowed because the manual block is preserved byte-for-byte. Folder pages proceed with a deterministic skeleton plus, for product folders, one bounded LLM purpose paragraph; non-product folders are fully deterministic and consume zero tokens. Folder synthesis reads each accepted file page via `safeIo.readText` to harvest its on-disk title for the guide, populating `titlesByPagePath` for Markdown pages and `proseTitlesByFilePath` from inert `.md`/`.mdx`/`.markdown` files using plain filesystem reads (since `safeIo` is allowlist-restricted to wiki dirs and would silently reject source paths). The README-style guide is rendered by `renderFolderPage` and never model-generated; its links point only at pages that exist on disk.

## Validation, task setup, and the stage 1–3 planning flow
<!-- lw:anchors packages/core/src/batch.ts#safeJsonParse packages/core/src/batch.ts#createOrGetTask packages/core/src/batch.ts#getOrCreateTask packages/core/src/batch.ts#resetTaskToPending packages/core/src/batch.ts#runUnderstandingStage packages/core/src/batch.ts#runSemanticTopicStage -->

The planning flow in `batch.ts` is built on a small vocabulary of helpers that keep the SQL, JSON, and SQLite task lifecycle in one place. Every stage reuses these primitives so the conceptual steps — parse a checkpoint, find or create a task, reset a task, then run the understanding and topic stages — stay declarative.

The first helper is the JSON guard. `safeJsonParse<T>(s: string): T | null` accepts a JSON string and returns a typed value, or `null` if parsing fails. It is the single point where unreliable checkpoint JSON is tolerated: every place that reads a `checkpoint_json` blob from `batch_tasks` wraps the call in `safeJsonParse` so a malformed payload degrades to "no checkpoint" rather than crashing the run.

The next three helpers form the task lifecycle. `createOrGetTask` is the unconditional creator — it inserts a new `batch_tasks` row for a given `(run_id, stage, target)` tuple if none exists, otherwise returns the existing row. `getOrCreateTask` is the same operation but expressed as a single call that callers use when they do not care which branch satisfies them. `resetTaskToPending(db: import("better-sqlite3").Database, taskId: number): void` is the explicit rewind: it flips an existing task row back to a pending state so a retry can start clean, used by the `--only understanding` branch when the evidence hash has drifted since the original run completed. Together these three helpers let the stages express task bookkeeping without ever inline `INSERT ... ON CONFLICT` or `UPDATE ... SET status = 'pending'`.

`runUnderstandingStage(opts: { ... }): Promise<UnderstandingStageResult>` is stage 1 of the planning flow. It first assembles the evidence block for the repository by calling `buildUnderstandingEvidence` over the modules and their paths, then asks `hasUnderstandingBasis` whether the evidence is rich enough to plan with. A small or weakly documented repository is a deterministic no-op here: the function returns an empty result, and the caller does not pay for a failed planner. If the evidence is sufficient, the function computes an `evidenceHash` over it and forms the deterministic target string `${UNDERSTANDING_TASK_PREFIX}${evidenceHash}`. The task lookup then follows the lifecycle rules above. In `resume` mode, an existing row whose checkpoint status is `done` and whose evidence hash matches causes an immediate return with zero LLM calls — the work is already done. In `only` mode, the task is gotten or created and then `resetTaskToPending` is called so the synthesis reruns against the current evidence. In `run` mode, an existing row is reused (with its attempt counter carried over) or a new one is created. From there the stage proceeds to the bounded generation/repair loop against `attemptUnderstandingGeneration`, honoring the same `human`/`mixed`/`untrusted`/`unparseable` ownership guard that protects manual pages from being overwritten.

`runSemanticTopicStage(opts: { ... }): Promise<TopicStageResult>` is stage 3 and reuses the same lifecycle helpers but composes them in a more elaborate way. It begins by building the planning inventory — `inventory.modules`, `inventory.flows`, and the active anchor set — and computing two derived facts: `topicModulePaths` (the source paths used by the topic prose evidence block) and `hasCrossModuleBasis` (a deterministic gate that fires when at least two product-role modules exist or some flow spans three or more modules). The same small-repo guard is applied here: if there is no cross-module basis or fewer than five active anchors, the stage returns an empty result without paying for a planner. Otherwise the planner task is looked up by the fixed target `"topic-plan"`. In `only` mode the task must already exist (the function throws otherwise); in `resume` mode an existing row is reused; in `run` mode the small-repo guard is consulted and either an existing row is reused or a new one is created via `getOrCreateTask`. A prior checkpoint that already carries a `done` status with a `topicPlan` short-circuits the whole stage by hydrating `result.candidates` from the saved plan.

When the stage does run, it first generates a deterministic candidate set via `proposeTopicPlanDeterministically` — no LLM call, no repair loop, no possible exhausted outcome. That deterministic plan is always the valid baseline. The function then splits the candidates into `pinnedConcernCandidates` (origin `concern`) and `refinePool` (everything else). The D2 pin keeps concern-grouped candidates out of the LLM refine pass entirely, because the LLM has been observed to drop Docker from the deployment topic in repeated paid runs. Only the non-concern pool is shown to the LLM, and the pinned concerns are re-merged into the refined plan afterward. If the LLM refine call completes, the merged plan is re-validated; on any rejection, invalid output, or infra failure the stage degrades silently back to the already-valid deterministic plan rather than failing the task. Once the plan is finalized, the stage runs the per-topic generation loop with `getOrCreateTask` for each candidate's target `topic:<evidenceHash>`, applies the same ownership guard, and writes the topic page through `tryWriteAndVerify`. The `surgicalRepair` and `relaxedRound` toggles, the `unrepairable` early abort, the `context_build_exception` and `write_verify_exception` short-circuits, and the circuit breaker (`consecutive >= 3` or failure rate above 50% after at least three attempts) all sit on top of this same lifecycle, with checkpoints persisted via `UPDATE batch_tasks` and progress accumulated into the `target` array — but the underlying helpers are the same four functions the understanding stage already called.

## Stage 4 module tasks: generation, repair, and verification
<!-- lw:anchors packages/core/src/batch.ts#attemptUnderstandingGeneration packages/core/src/batch.ts#attemptFolderGeneration packages/core/src/batch.ts#attemptStage4Generation packages/core/src/batch.ts#understandingAttemptDiagnostic packages/core/src/batch.ts#topicPlanDiagnostic packages/core/src/batch.ts#topicAttemptDiagnostic -->

Stage 4 produces the per-module wiki pages, and these six functions together form the engine that drives each attempt: three of them call the model and shape its output into a validated artifact, while the other three convert the messy reality of a single attempt into a compact diagnostic record the rest of the pipeline can reason about.

The understanding attempt is the simplest of the three generation paths, and `attemptUnderstandingGeneration` shows the canonical "generate → normalize → validate" shape.

```ts
async function attemptUnderstandingGeneration(opts: {
  attemptNumber: number;
  evidenceBlock: string;
  language: Language;
  llmClient: LlmClient;
  promptKind: "initial" | "repair";
  priorCandidate: string;
  priorErrors: UnderstandingAttemptError[];
  pricing: import("./pricing.js").PricingOverride | undefined;
  thinking?: "disabled" | "adaptive" | "omit" | undefined;
  repairAttemptContext?: { attempt: number; total: number };
}): Promise<UnderstandingAttemptResult>
```

It takes everything needed for one understanding-doc attempt — the evidence block, the prior candidate, the prior errors, the language, the model client, and the prompt kind — and returns a `UnderstandingAttemptResult`. The function begins by choosing its prompt: a fresh understanding prompt for the initial pass, or a repair prompt seeded with the previous candidate and its errors when `promptKind === "repair"`. It then calls `opts.llmClient.generate`, wrapping the request in a try/catch so a thrown `LlmTimeoutError` becomes a structured `llm_error` result with `usageKnown: false` and a zero usage entry — the rest of the pipeline learns the request never produced billable usage. Any other thrown error is reported as `llm_call_failed` with the same opaque usage shape.

When the call succeeds, the function computes `cost` via `computeCostFromUsage(usage, opts.pricing)` and builds a `UsageAttempt` that records `attemptNumber`, real `usage`, the computed `costUsd`, `stopReason`, and (when the provider returned one) `rawStopReason`. If the provider declared the run non-complete — `stopReason === "length"` or `"incomplete"` — the function returns immediately with a `truncated_by_token_limit` or `incomplete_generation` outcome, carrying the raw text only as `diagnosticCandidate` so the caller can inspect it without treating it as a real artifact. Otherwise the raw text flows through `normalizeStage4Artifact(raw)`; a normalization failure becomes `diagnosticOutcome: "normalization_failed"` with the original error list remapped to `UnderstandingAttemptError` shapes. If normalization succeeds, `validateUnderstandingArtifact(normalize.content)` runs against the closed-key contract; any errors become `artifact_validation_failed`. Only when both stages pass does the function return the fully successful result with `artifact: normalize.content` and an empty `validationErrors` list.

The folder-purpose attempt follows the same skeleton but is anchored to a folder of files rather than a single module's evidence block.

```ts
async function attemptFolderGeneration(opts: {
  attemptNumber: number;
  absRoot: string;
  folder: FolderUnit;
  fileUnits: readonly FileUnit[];
  symbolCountByPath: ReadonlyMap<string, number>;
  existingPagePaths: ReadonlySet<string>;
  language: Language;
  llmClient: LlmClient;
  promptKind: "initial" | "repair";
  priorPurpose: string;
  priorErrors: ReadonlyArray<{ code: string; message: string }>;
  pricing: import("./pricing.js").PricingOverride | undefined;
  thinking?: "disabled" | "adaptive" | "omit" | undefined;
  maxRepairAttempts: number;
  consumedSlots: number;
}): Promise<FolderAttemptResult>
```

It takes a folder, its file units, a precomputed `symbolCountByPath`, the set of `existingPagePaths` already on disk, the language, the model client, prompt kind, the prior purpose and prior errors, the pricing override, a thinking mode, and the repair bookkeeping (`maxRepairAttempts` / `consumedSlots`), and returns a `FolderAttemptResult`. The first thing it does is gather evidence: for every `fileUnit` whose page already exists, it reads the on-disk page text via `safeIo.readText` and reduces it to an opening digest with `extractModuleOpeningDigest`. Those digests feed `buildFolderPurposeContext`, which assembles the deterministic inventory the model will see. From there the prompt is chosen — `buildFolderPurposePrompt` for an initial attempt, or `buildFolderPurposeRepairPrompt` seeded with the prior purpose and errors for a repair — and the model call proceeds against a 2,048 token ceiling.

The result path mirrors the understanding attempt: timeout → `llm_error`, other throw → `llm_call_failed`, `length`/`incomplete` → `truncated_by_token_limit` / `incomplete_generation` (which writes a single `folder_purpose_invalid_shape` `purposeErrors` entry), `validateFolderPurpose` failure → `artifact_validation_failed` carrying the raw text as both `rawPurpose` and `diagnosticCandidate`, or success → `purpose: raw.trim()` with the trimmed paragraph as the final artifact.

The module page attempt is the largest and most layered of the three, because it has to absorb several orthogonal concerns: oversized modules, surgical repair, the relaxed-writer recovery tier, the optional `moduleDiagrams` extraction, and the mechanical-repair fallback.

```ts
async function attemptStage4Generation(
  opts: AttemptOpts,
): Promise<Stage4AttemptResult>
```

It takes the full `AttemptOpts` for one module-page attempt and returns a `Stage4AttemptResult`. The first decision is structural: when `opts.promptKind === "initial"` and `opts.oversizedFile === true`, the function bypasses the single-call path entirely and invokes `generateOversizedFilePage`. The pipeline runs an opening pass, a plan pass, and per-section passes with complete source slices, then deterministically assembles a page that never reaches disk — the contract that validation sees is the same contract the single-call path would see. The assembled text is funneled through `normalizeStage4Artifact`; a normalization failure becomes a `normalization_failed` outcome. On success, the recovery tier (Component 2) optionally applies `markDegradedArtifact` to `pipelineNormalize.content` before validation, so validation sees byte-for-byte the artifact that would be written to disk. The pipeline then validates against the closed key list, with `moduleRole` derived from `classifyModuleRole(opts.module, opts.pathRoleConfig)`. When validation fails, the pipeline path attempts an immediate `repairStage4ArtifactMechanically` — fail-closed, returning `null` unless every error has a supported mechanical fix, and revalidating the whole contract — and on success returns the mechanically repaired artifact with its `mechanicalRepairs` list; otherwise it returns the original validation errors as `artifact_validation_failed`.

When the module is not oversized, the function resolves its output-token budget with `resolveOutputTokenBudget(opts.outputTokenStrategy, opts.outputTokenCeiling, { anchorCount: ctx.closedKeyList.length }, MODULE_OUTPUT_BUDGET_OPTIONS)` and chooses its prompt. For a repair attempt, the function may opt into the surgical path: when `opts.surgicalRepair` is set, `prepareSurgicalRepair` inspects `opts.priorCandidate`, `opts.priorErrors`, and the symbols table to decide whether the failure set is section-scoped enough to be safely targeted. The resulting `surgicalPlan` is consumed *after* normalization, before validation — meaning the model is asked to replace specific named sections, and the splice step enforces that constraint. If the plan is non-null, `buildSurgicalRepairPrompt` produces a section-targeted prompt; otherwise the function falls back to the full-context `buildRepairPrompt`, which embeds `priorCandidate`, `priorErrors`, the symbols table, the truncated source, the language, the repair-attempt counter, the module role, `ctx.rationaleEvidence`, and any optional `moduleDiagrams` / `deepHierarchy` flags. Initial attempts use `buildStage4Prompt` with the same module context but no prior-candidate payload.

The LLM call is wrapped in the same timeout / generic-throw handling as the other two attempt paths, producing the same opaque `llm_error` shapes when usage is unknown. After a successful call, `computeCostFromUsage(usage, opts.pricing)` produces a `UsageAttempt` entry that records both `stopReason` and the optional `rawStopReason`. Provider-declared non-completions (`length` / `incomplete`) become `truncated_by_token_limit` / `incomplete_generation` outcomes that carry the partial text only as `diagnosticCandidate`, never as a repair input.

For a successful non-truncated call, `normalizeStage4Artifact(raw)` runs first. A normalization failure returns immediately with `diagnosticOutcome: "normalization_failed"`. When the attempt was surgical and normalization succeeded, the function calls `spliceSections(surgicalPlan.basePage, normalize.content, surgicalPlan.targetSections)`; a `null` return means the model edited something outside the named sections, so the function fails the attempt with the *original* `opts.priorErrors` and tags the result `surgicalOutcome: "surgical_cascade_rejected"` — the page is unchanged by construction, and the next slot sees the original failed page as its repair input. A successful splice sets `candidateContent = spliced` and `surgicalOutcome = "surgical_ok"`.

If `opts.relaxed === true`, the function applies `markDegradedArtifact(candidateContent)` *before* validation, so the relaxed mark lands in the exact bytes validation (and, on success, the transactional write) inspects — the contract never relaxes between those two checkpoints. When `opts.moduleDiagrams` is set, the function extracts the inline diagram from the candidate: `extractInlineModuleDiagram(candidateContent, diagramSlug)` locates the `## Diagram` H2 and its accompanying mermaid fence; a missing block becomes `module_diagram_placeholder`; an oversized diagram (counted via `countFlowDiagramElements` against the configured `maxNodes` / `maxEdges`, or exceeding `FLOW_DIAGRAM_SOURCE_MAX_CHARS`) becomes `flow_diagram_too_large`; a syntactically invalid diagram — checked via `validateMermaidSyntax(extraction.diagramSource)` — becomes `invalid_flow_diagram`. The placeholder/mermaid/budget gates are deliberately classified as model-repairable validation failures rather than infrastructure errors. On a clean extraction the function sets `candidateContent = extraction.pageContent` and remembers `moduleDiagramSource` for downstream use.

Validation runs last via `validateStage4Artifact(candidateContent, ctx.closedKeyList, { moduleId, moduleRole, expectedModuleDiagram?, relaxed? })`. When validation fails and `opts.allowMechanicalFallback` is true, the function tries `repairStage4ArtifactMechanically(candidateContent, validation.errors, ctx.closedKeyList, { moduleId, moduleRole })`; a non-null return produces a success result carrying `mechanical.content`, the repaired artifact, and the `mechanical.repairs` list. A `null` return leaves the validation failure visible as `artifact_validation_failed` for the next repair slot. When validation succeeds, the function returns the final artifact with `diagnosticOutcome: null` and an empty `validationErrors`.

Once an attempt finishes — whether it succeeded, hit an LLM error, was truncated, was normalized away, was validated away, or was surgically rejected — the diagnostic recorders condense that reality into a `DiagnosticAttempt` that callers can persist without dragging the entire raw text along. `understandingAttemptDiagnostic` handles the understanding-doc path: it slices `result.validationErrors` to the first `DIAGNOSTIC_MAX_ERRORS`, truncates each message to `DIAGNOSTIC_TEXT_CAP` characters, attaches `stopReason` / `rawStopReason` when the underlying entry carries them, summarizes `diagnosticOutcome` (defaulting to `"success"`), and stamps a content fingerprint — `candidateChars` plus a `sha256(candidate)` — only when `diagnosticCandidate` is non-null. `topicPlanDiagnostic` plays the same role for the topic-plan flow: it takes the attempt number, the prompt kind, the `DiagnosticOutcome`, the candidate string, the raw errors, and optional stop reasons, then emits the same trimmed summaries and the same sha256 fingerprint whenever a candidate exists.

The richest of the three is `topicAttemptDiagnostic`, which records every Stage 4 attempt — including the surgical and relaxed flags the pipeline uses to reason about repair history. It calls `summarizeDiagnosticErrors(result.validationErrors)` to apply the same trim / cap / truncation-count rules, then mirrors the understanding recorder's stop-reason / outcome / fingerprint logic. Crucially, it conditionally attaches `surgicalOutcome` (only when the attempt result carries one — `"surgical_ok"` or `"surgical_cascade_rejected"`) and a `relaxed: true` flag (only when `result.relaxedAttempt === true`), so a downstream reader can see, attempt by attempt, whether a degraded tier or a surgical repair path was active without having to re-derive those signals from the raw attempt body.

## Frontmatter ownership and the lw:manual preservation contract
<!-- lw:anchors packages/core/src/batch.ts#readOwnerFromFrontmatter packages/core/src/batch.ts#forceOwnerInFrontmatter packages/core/src/batch.ts#extractManualBlocksBySection packages/core/src/batch.ts#slugifyHeadingText packages/core/src/batch.ts#injectManualBlocksBySection packages/core/src/batch.ts#sectionRangeOf -->

The first responsibility is to inspect the frontmatter that wraps the top of a page and decide whether the pipeline is allowed to rewrite it. `readOwnerFromFrontmatter` is the gate: it accepts the raw page text (or `null` if there is no page yet) and returns a `PreOwnerCheck` describing what it found. The literal signature is:

```ts
function readOwnerFromFrontmatter(content: string | null): PreOwnerCheck
```

It takes the page's raw text and returns a tag that classifies the frontmatter (`null`, `"unparseable"`, `"untrusted"`, `"human"`, `"generated"`, or `"mixed"`), which the rest of the pipeline uses as a permission signal.

Before it parses anything, the function normalizes a few realistic edge cases. It strips a leading BOM (`0xFEFF`) so pages saved by tools that prepend one are not rejected; it accepts either `---\n` or `---\r\n` as the opening fence so cross-platform line endings (Windows saves, `git autocrlf`) are not treated as missing frontmatter; and it folds any remaining `\r\n` sequences inside the frontmatter to `\n` so the parser sees consistent input. After normalization it delegates to `parseFrontmatter` and inspects the `owner` key. A genuine `owner: generated` or `owner: mixed` is handed back to the caller verbatim, since both are states in which the generator may rewrite the auto-produced content. `owner: human` is treated as a hard stop. Anything else — missing key, wrong type, an unknown literal — is collapsed into `"untrusted"`, and a `parseFrontmatter` exception collapses into `"unparseable"`. The `null` input case, where the file does not exist yet, short-circuits to the `null` return without attempting to parse.

Once the gate has decided to proceed, `forceOwnerInFrontmatter` stamps the chosen ownership label into the frontmatter so subsequent runs do not have to re-derive it. The literal signature is:

```ts
function forceOwnerInFrontmatter(content: string, owner: "generated" | "mixed"): string
```

It takes the raw page text and the ownership label to write, and returns the same text with the frontmatter `owner:` line set to that label.

The implementation first re-checks the opening fence using the same `---\n` / `---\r\n` rule from `readOwnerFromFrontmatter`; if no frontmatter is present the content is returned untouched. Otherwise it locates the closing `\n---` and slices the file into the frontmatter block and everything that follows. It then runs a multiline regex looking for an existing `owner: ...` line (with any current value and any leading indentation): if one exists, its value is replaced in place; if no such line exists, a new `owner: ${owner}` line is injected directly under the opening `---`, using the same line-ending length the fence used so CRLF pages stay CRLF. Because the frontmatter parsing rules and the writing rules use the same line-ending conventions, the ownership label survives round-trips through editors and version control without drifting into a different format.

The preservation contract itself begins with `extractManualBlocksBySection`, the function that lifts every reviewer-owned block out of a page and remembers where it belonged. The literal signature is:

```ts
function extractManualBlocksBySection(content: string): Map<string | null, string[]>
```

It takes the raw page text and returns a map from each section's slug (or `null` for blocks that precede any heading) to the list of manual blocks — including their opening and closing `lw:manual` markers — that lived in that section, in source order.

Scanning proceeds in three phases. First, the function walks the content twice with two regexes, one for `lw:manual` and one for the closing `/lw:manual`, collecting every match into a single `hits` array tagged with offset and kind, then sorting by offset so the markers alternate in document order regardless of how they were emitted. Second, it walks the same content with a heading regex `^(#{1,6})\s+(.+?)\s*$`, recording each heading's byte offset alongside a slug produced by `slugifyHeadingText`. Third, it iterates the sorted markers, pairing each `start` with the next `end`. When a pair closes, it finds the heading whose offset is the largest value `<= startOff` — i.e. the heading that owns the line just before the block — and stores the block under that section's slug. Any block whose `start` precedes the first heading falls out with `sectionSlug = null`, so doc-level manual content (above all headings) is preserved distinctly from section-level content. The marker text itself is preserved byte-for-byte inside the stored block, which is what lets the writer restore it later without losing invisible characters.

The `slugifyHeadingText` helper that both `extractManualBlocksBySection` and `injectManualBlocksBySection` rely on is small but worth pinning down. The literal signature is:

```ts
function slugifyHeadingText(text: string): string
```

It takes a heading's visible text and returns the slug used as the section key in the manual-block map.

The normalization chain is deliberate: lowercase the heading so case differences between the old page and the regenerated page do not break matching; apply Unicode NFD and strip the combining-diacritics range `\u0300-\u036f` so accented letters match their unaccented counterparts; strip punctuation that is not a word character, whitespace, or hyphen; trim, and finally collapse runs of whitespace into a single hyphen. The result is a stable identifier suitable for the section key in `Map<string, string[]>`, while remaining tolerant of small wording drift between pages.

`injectManualBlocksBySection` is the writer half of the contract: it splices the previously extracted blocks back into freshly generated content. The literal signature is:

```ts
function injectManualBlocksBySection(existing: string, newContent: string): string | null
```

It takes the existing (pre-rewrite) page and the newly produced page, and returns either the new page with the manual blocks reinserted in their original sections, or `null` when there were no blocks to preserve.

The function first calls `extractManualBlocksBySection(existing)` to recover the section → blocks map. A size of zero is a fast path that returns `null` — the orchestrator treats this as "nothing to preserve" rather than an error. Otherwise it scans `newContent` with the same heading regex used during extraction, recording each heading's slug, offset, and level (`#` count). With that scan in hand, an inner helper, `sectionRangeOf`, computes the byte range that a heading owns:

```ts
function sectionRangeOf(headingOffset: number): { endOffset: number }
```

Given the offset of a heading in the new page, it returns the offset of the next heading whose level is `<=` the heading's own level, or the end of the document if no such heading exists — i.e. the first byte that does not belong to this section.

Armed with that helper, the function builds an `insertions` list. For each `(sectionSlug, blocks)` pair it chooses one of three destinations. If `sectionSlug` is `null`, the blocks lived above all headings in the old page; in the new page they are appended after a blank line at `newContent.length` so doc-level content stays at the end of the document. If the section is missing from the new page entirely (no heading matches the slug), the blocks are also appended at the end — the contract is "never lose content", not "force into a missing section". For sections that do exist, `sectionRangeOf(targetHeading.offset)` gives the section's end, and the blocks are joined with blank lines and prepended with a single `\n` so they sit flush against the section's last paragraph without disrupting whatever the generator wrote there. All insertions are then sorted in **descending** offset order, which is essential: each insertion shifts later byte offsets, so applying them from highest to lowest keeps every recorded offset valid as the result string is built. Finally the function splices each insertion into `newContent` and returns the recombined string. The returned value is then what the file emitter writes in place of the raw generator output, satisfying the `lw:manual` preservation contract end-to-end: read ownership, force ownership, extract the blocks that must survive, and inject them back where they used to live.

## Write, verify, rollback, and surgical/relaxed recovery paths
<!-- lw:anchors packages/core/src/batch.ts#rollbackWrittenArtifacts packages/core/src/batch.ts#tryWriteAndVerify packages/core/src/batch.ts#tryWriteModuleDiagramAndVerify packages/core/src/batch.ts#tryWriteFlowAndVerify packages/core/src/batch.ts#verifyIssuesToValidationErrors packages/core/src/batch.ts#summarizeLlmDiagnosticError packages/core/src/batch.ts#summarizeVerifyDiagnosticErrors packages/core/src/batch.ts#diagnosticAttempt packages/core/src/batch.ts#prepareSurgicalRepair packages/core/src/batch.ts#buildSurgicalEvidenceSlice packages/core/src/batch.ts#isRelaxedEligible -->

The core of this section is the all-or-nothing contract that every write attempt must honor: a candidate page either lands on disk in a verified-clean state, or the filesystem is restored to its pre-attempt snapshot. Three layered write functions implement that contract, each with the same shape but progressively more artifacts under management.

The recovery primitive is `rollbackWrittenArtifacts(absRoot, entries, guardedRemoval)`, which walks a list of `{ path, snapshot }` entries and either restores the previous content from the snapshot or, when no snapshot exists, removes the new file. When `guardedRemoval` is true, missing files are silently ignored so a rollback triggered by an exception does not itself throw; when false, every removal is attempted so that a verify-rejection rollback surfaces any secondary failure. Any per-entry failure is captured into a `reasons` string; an empty list means the rollback succeeded for every artifact.

The single-artifact path is `tryWriteAndVerify(absRoot, wikiPath, newContent, existing, rejectAnySeverity)`. It first repositions any `lw:manual`-style blocks from the existing page into the new content via `injectManualBlocksBySection`, and if the existing page declared `owner: mixed` in its frontmatter it forces that owner back into the final content via `forceOwnerInFrontmatter` so the human-curated classification is not silently demoted to `generated`. After those preparations, the actual `safeIo.writeText` plus `runVerify` happens inside a single `try/catch`. The contract is: any exception — write failure, verify crash, anything — invokes `rollbackWrittenArtifacts` with the pre-write snapshot for the one page. If that rollback reports reasons, the run returns `rollbackFailed`; otherwise it returns the captured exception. After a clean write+verify, the function filters `verifyResult.issues` for the just-written `wikiPath` and either just errors (when `rejectAnySeverity` is true) or only `severity: "error"` issues (the default), and any nonzero broken list triggers the same mandatory rollback, now with `guardedRemoval: false` so a missing file is itself a rollback failure. On success, the function returns the `wikiPath` and a `sha256` of the final content.

The two-artifact path is `tryWriteModuleDiagramAndVerify(absRoot, pagePath, diagramPath, pageContent, diagramSource, existingPage)`, which wraps the page write and a sibling Mermaid diagram write (`safeIo.writeText` for the page, then the diagram, normalized to end with a newline) inside one `try/catch` and runs `runVerify` against the combined tree. If anything throws, both snapshots are rolled back: the page snapshot (the prior content) and the diagram snapshot (read up front, or `null` for a brand-new diagram). After a clean verify, only `severity: "error"` issues on either of the two written paths reject the pair — warnings never block this gate — and any rejection triggers the same mandatory dual rollback. On success, the function returns both `wikiPath`/`pageHash` and `diagramPath`/`diagramHash`.

The three-artifact path is `tryWriteFlowAndVerify`, which extends the module-diagram shape with a flows hub at `livewiki/flows/index.md`. The same manual-block and `owner: mixed` preservation runs first. Then the page writes, the diagram writes, and `syncFlowsIndexHub` updates the hub — but only the hub the sync actually rewrote (outcome `written`) joins the rollback set, so a human/mixed/unparseable hub that the sync skipped is not touched. Verify then runs against the whole tree. This path deliberately widens the rejection filter from "errors only" to "any issue — error or warning — on either written path," because the flow-page contract requires a `Related pages` link to the hub and any warning on the freshly written pair would also be a regression. As before, an exception or a verify rejection rolls the relevant artifacts back through `rollbackWrittenArtifacts`; a rollback failure is terminal.

Verification output is reshaped for the orchestrator by `verifyIssuesToValidationErrors(issues)`, which maps each `VerifyIssue` into an `ArtifactValidationError` carrying `code`, `detail` (renamed to `message`), a `location` that is `frontmatter` for `broken_anchor` and `body` otherwise, and an optional `offending` field set to `wikiPath` when present. This is the canonical shape downstream code consumes.

Diagnostic summarization feeds two complementary channels. `summarizeLlmDiagnosticError(error)` wraps a single LLM-side error (`code` + `message`) into a `DiagnosticErrors` payload with one truncated-to-`DIAGNOSTIC_TEXT_CAP` entry, location `global`, and `truncatedErrorCount: 0`. `summarizeVerifyDiagnosticErrors(issues)` caps the list at `DIAGNOSTIC_MAX_ERRORS`, caps each `message` and `offending` path at `DIAGNOSTIC_TEXT_CAP`, classifies location as `frontmatter` for `broken_anchor` and `body` otherwise, and reports the number of dropped issues as `truncatedErrorCount`. The two helpers share the same truncation discipline so the UI does not have to special-case LLMs versus the verifier.

`diagnosticAttempt` is the per-attempt envelope. It takes a `Stage4AttemptResult` plus the `promptKind` (`initial` or `repair`), the `outcome`, the `errors` payload, and an optional `budgetConsumed` flag, and produces a flat diagnostic record. It stamps the attempt number, the optional `stopReason`/`rawStopReason` from the model usage entry, the `promptKind`, the `errors.errors` array, the `truncatedErrorCount`, optional `candidateChars` and `candidateSha256` (when there was a candidate), optional `mechanicalRepairs` and `surgicalOutcome`, the `relaxed` flag when the attempt was a relaxed retry, and a `finishedAt` timestamp. This is the single record the run log consumes to describe each attempt.

When the LLM fails, the code does not immediately re-prompt with the full source tree. Instead, `prepareSurgicalRepair(absRoot, priorCandidate, priorErrors, symbolsTable)` decides whether a targeted repair is even possible. It first calls `surgicalRepairTargetSections` to map the prior errors to a set of H2 slugs; if the errors do not cleanly map to sections, the function returns `null` and the orchestrator falls back to a full retry. It then normalizes the prior candidate via `normalizeStage4Artifact` (it must succeed), splits the page into H2 sections, and confirms every targeted slug is present in the candidate — if any are missing, the function again returns `null`. For the surviving sections, it scans for `lw:anchors` markers and collects every cited symbol key, then asks `buildSurgicalEvidenceSlice` to assemble the minimal evidence needed to repair just those sections. The result is a `SurgicalRepairPlan` carrying the normalized base page, the target section slugs, and the evidence slice; otherwise `null` cues the orchestrator to use a full retry.

`buildSurgicalEvidenceSlice(absRoot, symbolsTable, citedKeys)` is what makes the surgical repair cheap. It gathers two kinds of evidence, both scoped to the cited keys. First, it filters the rendered symbols table down to the rows whose keys are in the cited set (matching the `- <key> (` format). Second, it opens the index database with `openIndex`, queries the `symbols`/`files` join for the cited keys (scoped to `status = 'active'`, sorted by key), and for each symbol reads the source file and renders just the topic span via `renderTopicSourceSpan`. A character budget (`SURGICAL_EVIDENCE_MAX_CHARS` minus the rows block) gates how many spans are appended; exceeding the budget truncates the current span and stops. The final string is rows plus spans separated by blank lines, with the database closed in a `finally` to guarantee release. Citing zero keys yields the empty string, which is the explicit "no extra evidence needed" signal.

The final piece is the retry-budget gate. `isRelaxedEligible(pageKind, errors)` returns `true` only when there are errors AND none of them are unclassifiable for the page kind — i.e. `collectUnclassified(pageKind, errors).length === 0`. A relaxed retry is therefore a privilege reserved for errors the system already knows how to mechanically patch; unknown error shapes force a full repair instead of consuming a relaxed attempt. This is what keeps the gentle path truly gentle: relaxed retries are only attempted when the system is confident the issue is mechanical, not when it would just be guessing.

## Oversized files, evidence slicing, and topic/flow page context builders
<!-- lw:anchors packages/core/src/batch.ts#generateOversizedFilePage packages/core/src/batch.ts#attemptStage5Generation packages/core/src/batch.ts#attemptTopicGeneration packages/core/src/batch.ts#buildTopicDocContext packages/core/src/batch.ts#buildFlowDocContext packages/core/src/batch.ts#buildFairTruncatedSource packages/core/src/batch.ts#buildModuleDocContext packages/core/src/batch.ts#getRationaleEvidenceForPaths packages/core/src/batch.ts#getFileIdsForModule packages/core/src/batch.ts#getModuleSymbolRows -->

The pipeline must gracefully handle two distinct failure shapes — files too large to fit in one prompt, and evidence budgets that must be sliced so every input gets a fair share — while still feeding topic and flow pages enough material to produce closed-list-valid prose. This section walks through the mechanism that does both: the oversized-file generator, the per-stage "one attempt" entry points, the evidence and source context builders they call, and the SQL helpers underneath.

## Oversized file page generation

For a module whose single file still won't fit, the pipeline falls back to a multi-pass plan-then-write routine. The signature is:

```ts
async function generateOversizedFilePage(opts: {
  absRoot: string;
  module: Module;
  language: Language;
  llmClient: LlmClient;
  charBudget: number;
  pricing: import("./pricing.js").PricingOverride | undefined;
  thinking?: "disabled" | "adaptive" | "omit" | undefined;
  ctx: ModuleDocContext;
}): Promise<{
  raw: string | null;
  usage: { inputTokens: number; outputTokens: number; model: string } | null;
  llmError: { code: string; message: string } | null;
}>;
```

It takes a module metadata record, the LLM client, the per-attempt character budget, optional pricing overrides and thinking mode, plus a `ModuleDocContext` (described below), and returns either the rendered page plus accumulated token usage, or `null` plus a typed `llmError` reason. The flow is:

1. Pick the (single) file path from `opts.module.paths[0]!`, capture the closed anchor key list from `opts.ctx.closedKeyList`, and load the per-symbol spans via `getModuleSymbolRows` (defined later). The full source is then read off disk; a missing file is tolerated as `null`.
2. Wrap every LLM call in a small inner `call(prompt, maxTokens)` that delegates to `opts.llmClient.generate` and accumulates `inputTokens`, `outputTokens`, and the `model` name into `usageAcc`. This guarantees that whatever the function returns, the usage report reflects real billing — including partial usage when the pipeline fails mid-way.
3. **Pass 0 — opening.** Up to two attempts call `buildFileOpeningPrompt`, accepting only output that contains an `#` heading line; a `length`/`incomplete` stop on the first attempt triggers one retry, after which the routine gives up and returns `code: "llm_call_failed"` with the exact message `plan-then-write: the opening pass produced no usable opening block after 2 attempts`.
4. **Pass 1 — narrative arc plan.** Two attempts feed the closed key list, the symbols table, the truncated source, and the language into `buildFilePlanPrompt`. The response is parsed by `parseFilePlan`, which returns either `{ ok: true, sections }` or an `error` string. If both attempts fail, the generator falls back to `deterministicFallbackPlan(closedKeyList)` — a source-order split that keeps the pipeline alive at the cost of "Part N" headings, a generation concern rather than a fatal error.
5. **Pass 2 — section prose.** For each section in the chosen plan, the routine looks up the corresponding spans from `spanByKey` (built from the symbol rows) and slices the full source via `extractSectionSource(fullSource, spans, 30_000)`. It also rebuilds a tiny per-section symbols table by joining the `symbolsTableByKey` lines for those keys. Each call to `buildFileSectionPrompt` is capped at 4 096 output tokens, and the resulting prose strings are appended to `sectionProse`.
6. Finally, `assembleFilePage({ opening, plan, sectionProse, closedKeyList })` glues the parts together. The whole thing is wrapped in a `try` that distinguishes `LlmTimeoutError` (reports the sub-call usage so far, because the provider may still bill for completed sub-calls) from any other thrown error (mapped to `code: "llm_call_failed"` with the message intact).

The repeated `usage: { ...usageAcc }` snapshots are intentional: callers need to see real sub-call costs even when the function ultimately returns `raw: null`.

## Bounded "one attempt" entry points for stages 4 and 5

Both stages use the same pattern: a function whose job is exactly *one* turn of a caller-driven retry loop. The loop itself (which decides how many attempts to spend) lives elsewhere; these functions only build context, call the LLM once, normalize, optionally splice, optionally mark degraded, validate, and return a result.

### Stage 5 — flow page attempts

```ts
async function attemptStage5Generation(opts: Stage5AttemptOpts): Promise<Stage5AttemptResult>
```

It first rebuilds the context via `buildFlowDocContext(opts.absRoot, opts.candidate, opts.modules, opts.charBudget)`, then resolves the output token budget from `opts.outputTokenStrategy` and `opts.outputTokenCeiling`, weighted by the closed anchor count.

Two pieces of state reach both the prompt and the validator:

- `flowKeyGroups: FlowKeyGroups` — entry/boundary/sink key sets from the candidate. They shape the prompt's R10.1 D presentation *and* the D3 tier-coverage check in the validator.
- `flowKeySectionMap = assignFlowKeySections(opts.candidate)` — a deterministic section home for every closed key. It reaches the prompt (as a fixed table) and the mechanical repair layer (which prefers the assigned section on dedup).

A repair turn may take the surgical path: when `opts.promptKind === "repair"` and `opts.surgicalRepair` is set, `prepareSurgicalRepair` produces a `SurgicalRepairPlan`, and the prompt becomes `buildSurgicalRepairPrompt("flow", …)`. Otherwise the prompt is `buildStage5RepairPrompt` or the initial `buildStage5Prompt`, both of which receive `flowKeyGroups`, `flowKeySectionMap`, and the diagram budgets.

After the LLM call (with identical error accounting to stage 4 — typed `LlmTimeoutError` becomes `usageKnown: false` and `llmError.code: "llm_timeout"`, anything else becomes `llm_error`), the response is filtered by stop reason. A `length` or `incomplete` stop is converted to the diagnostic outcome `truncated_by_token_limit` or `incomplete_generation` and surfaced as a validation error rather than an LLM error, so the orchestrator can decide whether to retry.

The artifact then goes through:

1. `normalizeStage4Artifact(raw)` — a hard structural requirement before anything else.
2. Surgical splice (`spliceSections`) — only on repair turns; failure to splice is the anti-cascade guard and returns the *original* failed page as the next repair input, with `surgicalOutcome: "surgical_cascade_rejected"`, to prevent the model from drifting further.
3. Relaxed marking — when `opts.relaxed === true`, `markDegradedArtifact` writes a degraded marker into the content before validation runs.
4. **Deterministic diagram generation.** `generateFlowDiagram(opts.candidate, opts.modules, opts.diagramBudgets)` produces the Mermaid source with zero LLM involvement. The flow docstring captures the priority-0 fix: the LLM no longer writes Mermaid, so `invalid_flow_diagram` no longer has to be recovered mechanically. `validateMermaidSyntax` still runs as defense in depth, but a rejection there throws rather than consume a repair slot — it represents a bug in the renderer, not an LLM failure.
5. `insertFlowDiagramSection` slots the complete `## Diagram` section (heading + fence + body) between `## Ordered flow` and `## Invariants`. Under the relaxed contract `## Invariants` is optional, so the inserter may anchor on the Ordered flow heading instead. If neither anchor is found, the routine returns `missing_page_opening`, signaling that the required opening skeleton is missing or out of order.
6. `validateStage4Artifact(pageWithDiagram, ctx.closedKeyList, validationContext)` validates the *complete* page with the diagram already inserted. The validation context carries `pageKind: "flow"`, `expectedFlowDiagram: "livewiki/diagrams/flow-${opts.candidate.slug}.mmd"`, the candidate's module ids, and the `flowKeyGroups` from above.

### Stage 4 — topic page attempts

```ts
async function attemptTopicGeneration(opts: TopicAttemptOpts): Promise<Stage4AttemptResult>
```

The shape mirrors stage 5 with topic-specific vocabulary. It rebuilds context via `buildTopicDocContext(opts.absRoot, opts.candidate, opts.charBudget, opts.rationaleMaxChars, opts.modulePaths)`, computes the topic section map via `assignTopicKeySections(opts.candidate)`, and resolves the output token budget with `opts.candidate.seedKeys.length` (and `anchorSourceChars` when known) feeding the resolver.

The prompt ladder is the same three-way switch:

- Initial → `buildTopicPrompt(candidate, moduleDigest, symbolsTable, truncatedSource, language, topicKeySectionMap, rationaleEvidence, proseEvidence)`.
- Repair + surgical available → `buildSurgicalRepairPrompt("topic", …)`.
- Repair without surgical → `buildTopicRepairPrompt(…, topicKeySectionMap, ctx.rationaleEvidence, ctx.proseEvidence)`.

Both the rationale block (etapa 2b) and the prose-evidence block (D2 follow-up) ride on the same context record; they are unfenced and unneutralized here and become fenced by the prompt builders.

LLM error accounting, stop-reason gate, normalization, surgical splice (with the same anti-drift rule that returns the original failed page), and relaxed marking are identical to stage 5. Validation then runs against a `TopicDocContext`-aware context:

```ts
const validationContext = {
  pageKind: "topic" as const,
  moduleId: opts.candidate.slug,
  moduleRole: "product" as const,
  expectedTopicTitle: opts.candidate.title,
  expectedTopicOrder: opts.candidate.planOrder,
  expectedTopicIntent: opts.candidate.intent,
  expectedTopicModules: opts.candidate.modules,
  expectedTopicFlows: opts.candidate.flows,
  topicKeyGroups: opts.candidate.groups,
  topicProductKeys: opts.candidate.seedKeys.filter((key) =>
    classifyPathRole(key.split("#", 1)[0] ?? "", opts.pathRoleConfig) === "product"
  ),
  ...(opts.relaxed === true ? { relaxed: true } : {}),
};
```

When validation fails, the upper-bound mechanical repair `repairUpperBoundArtifactMechanically(candidateContent, validation.errors, opts.candidate.seedKeys, validationContext, …)` runs first. The docstring on this branch records the v24 finding: a topic page's final repair attempt left with a single `duplicate_anchor` that this deterministic fallback resolves without another LLM call, and `topicKeySectionMap` lets dedup prefer the assigned section's occurrence, mirroring the flow path.

## Evidence and source context builders

These three builders — plus the two SQL helpers behind `buildModuleDocContext` — assemble everything the LLM actually sees.

```ts
export async function buildModuleDocContext(
  absRoot: string,
  module: Module,
  charBudget: number,
  rationaleMaxChars: number,
): Promise<ModuleDocContext>
```

It starts from `getModuleSymbolRows(absRoot, module)` (a `key, name, kind, signature, start_line, end_line` projection over active symbols in this module's files), renders them into the prompt's symbols table, then computes two bounded context blocks:

- **Rationale evidence** (`rationaleMaxChars`) — produced by `getRationaleEvidenceForPaths` below. The carve is *inside* `charBudget`: the source excerpt gets whatever the rationale block did not consume, enforced by `sourceBudget = Math.max(0, charBudget - rationaleEvidence.length)`.
- **Truncated source** (`sourceBudget`) — produced by `buildFairTruncatedSource(absRoot, module.paths, sourceBudget)`. The docstring explains the motivation: a sequential first-fit truncation left later files (and their closed-list keys) with zero source context, which correlated with invented anchors. The fair-share version guarantees every module path receives a slice.

The returned record shape is `ModuleDocContext = { closedKeyList, symbolsTable, truncatedSource, rationaleEvidence }`, where `rationaleEvidence` is documented as "unfenced, unneutralized — the prompt builders apply neutralize + safe fence. Empty string when there is nothing to show or `rationaleMaxChars` is 0`."

```ts
export async function buildTopicDocContext(
  absRoot: string,
  candidate: TopicCandidate,
  charBudget: number,
  rationaleMaxChars = 0,
  modulePaths?: ReadonlyMap<string, readonly string[]>,
): Promise<TopicDocContext>
```

The topic variant returns `{ symbolsTable, moduleDigest, truncatedSource, rationaleEvidence, proseEvidence }`. Two fields are topic-specific:

- `moduleDigest` — a compact per-module summary for the topic prompt.
- `proseEvidence` — D2 follow-up: rendered prose-file excerpts, unfenced and unneutralized, empty when no prose paths remain in budget. Each individual excerpt is capped by the constant `TOPIC_PROSE_FILE_MAX_CHARS = 1_500`.

```ts
async function buildFlowDocContext(
  absRoot: string,
  candidate: FlowCandidate,
  modules: ReadonlyMap<string, Module>,
  charBudget: number,
): Promise<FlowDocContext>
```

It feeds `attemptStage5Generation` and exposes the closed key list, the per-module opening snippets (`moduleOpenings`), the symbols table, and the truncated source — everything the flow prompt builder needs without per-attempt recomputation beyond what `attemptStage5Generation` already triggers (each attempt reloads context, matching the stage-4 contract that the closed list does not change between attempts of one run).

```ts
export async function buildFairTruncatedSource(
  absRoot: string,
  paths: ReadonlyArray<string>,
  charBudget: number,
): Promise<string>
```

The fair-truncation routine:

1. Early-exits when there are no paths or the budget is non-positive, and again when every read failed (silently skipped).
2. Computes the full concatenated form `full` with `// === path ===` headers. If `full.length <= charBudget` it returns `full` unchanged — no truncation is better than truncation.
3. Otherwise allocates `share = Math.max(128, Math.floor(charBudget / n))` chars per file, header included. Each file's body is then truncated to `share - header.length - 1`. The 128-byte floor prevents a single file from collapsing to nothing in tight budgets.

## Underlying SQL helpers

The two helpers underneath are deliberately small and shared between the module-context builder and the deterministic auxiliary-page path that uses no LLM and needs no source truncation:

```ts
async function getModuleSymbolRows(
  absRoot: string,
  module: Module,
): Promise<ModuleSymbolRow[]>
```

It opens the `.livewiki/index.db` SQLite handle (via `safeIo.resolveAndValidate` to keep reads inside the repo root), resolves the file ids via `getFileIdsForModule`, then runs

```sql
SELECT key, name, kind, signature, start_line, end_line FROM symbols
 WHERE status = 'active' AND file_id IN (?, ?, …)
```

— or an empty result when the file-id list is empty. The handle is always closed in `finally`. The docstring records the contract: `key, name, kind, signature` rows for one module's *active* symbols, shared between the product LLM prompt context and the no-LLM auxiliary page path.

```ts
async function getFileIdsForModule(absRoot: string, module: Module): Promise<number[]>
```

Resolves the module's paths into the integer file ids used by the `IN (…)` clause above.

```ts
async function getRationaleEvidenceForPaths(
  absRoot: string,
  paths: ReadonlyArray<string>,
  maxChars: number,
): Promise<string>
```

Etapa 2b's renderer. Early-exits on `maxChars <= 0` or empty `paths`. Opens the same SQLite handle, runs

```sql
SELECT f.path, r.symbol_key, r.kind, r.text, r.start_line
  FROM rationales r JOIN files f ON f.id = r.file_id
 WHERE f.path IN (?, ?, …)
 ORDER BY f.path, r.start_line, r.id
```

and delegates the actual bounded rendering to the shared `renderRationaleEvidence(rows, maxChars)`. The output stays unfenced and unneutralized here because the prompt builders apply the safe-fence treatment themselves.

## Usage tracking, cost computation, and result finalization
<!-- lw:anchors packages/core/src/batch.ts#resolveOutputTokenBudget packages/core/src/batch.ts#emptyUsage packages/core/src/batch.ts#aggregateTotals packages/core/src/batch.ts#accumulateUsage packages/core/src/batch.ts#computeCostFromUsage packages/core/src/batch.ts#finalizeRun packages/core/src/batch.ts#drainPendingMetrics packages/core/src/batch.ts#buildResult packages/core/src/batch.ts#statusToExitCode -->

Once a batch run has finished processing its tasks, the file turns to the bookkeeping: how many tokens were spent, what the run cost, and how the result is sealed into the database. This is the stage of the pipeline where partial observations are aggregated into a single coherent summary, and the run's terminal state is committed.

The budget that downstream stages respect is decided first. `resolveOutputTokenBudget` decides how much output a stage is allowed to produce, either by returning a fixed `ceiling` when the strategy is `"fixed"`, or by delegating to a dynamic computation when the strategy is `"dynamic"`.

```ts
function resolveOutputTokenBudget(
  strategy: "dynamic" | "fixed",
  ceiling: number,
  signals: OutputBudgetSignals,
  preset: typeof MODULE_OUTPUT_BUDGET_OPTIONS,
): number {
```

It takes a strategy name, a numeric ceiling, dynamic signals describing the current pressure on the system, and a preset of options; it returns the budget number that the rest of the pipeline should obey.

The accumulation pipeline needs a known starting point, which `emptyUsage` provides.

```ts
function emptyUsage(): StageUsage {
```

It takes no parameters and returns a `StageUsage` record whose token and cost fields are zeroed, whose model list is empty, and whose `usageIncomplete` flag is `false`.

Two per-stage usage snapshots are folded together by `aggregateTotals`. Token counts add directly; costs combine only when both sides have a concrete number, otherwise the result is whichever side has a known cost (and `null` if neither does). The model list is deduplicated via a `Set`, and the `usageIncomplete` flag is the logical OR of the two arguments, so any partial observation in either stage marks the merged total as incomplete too.

```ts
function aggregateTotals(a: StageUsage, b: StageUsage): StageUsage {
```

It takes two `StageUsage` records and returns a merged `StageUsage` that conservatively reflects whatever either side has seen.

When a single attempt's usage is folded into a running accumulator, `accumulateUsage` runs.

```ts
function accumulateUsage(
  acc: StageUsage,
  entry: Pick<UsageAttempt, "usage" | "usageKnown" | "costUsd">,
  _pricingOverride: Parameters<typeof calculateCostUsd>[3],
): StageUsage {
```

It takes the current accumulator, a single usage entry whose `usageKnown` flag signals whether the wire response reported token counts, and an optional pricing override; it returns the updated accumulator. If the entry is unknown or `usage` is `null`, the function conservatively returns the accumulator with `usageIncomplete: true` set, deliberately leaving the known cost untouched so already-recorded money is not lost. Otherwise, it adds the input and output tokens, extends the model list with the new model if it is not already present, and adds the entry's `costUsd.total` to the running cost using the same `null`/`number`/`null` rules as `aggregateTotals`.

The monetary side is computed by `computeCostFromUsage`, which translates a single attempt's token counts and chosen model into a dollar cost using the project's pricing tables; the resulting `costUsd` is what `accumulateUsage` then folds into the running totals.

Once every task has produced its own usage entry, `finalizeRun` writes the run's terminal record.

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
    /** Recovery tier (Component 2): persisted only when non-empty. */
    degradedPages?: string[];
  },
): void {
```

It takes the SQLite database handle, the absolute repository root, the numeric run id, the terminal status, and an options bag containing the aggregated totals, per-stage and per-module breakdowns, the list of refined modules, the done/failed task counts, and an optional `degradedPages` recovery list. It returns nothing. The function builds a `BatchRunSummary` from those inputs — merging the totals and breaking down by stage and by module, recording the refined modules, and conditionally including `degradedPages` only when the list is non-empty — and then writes the summary into the `batch_runs` row identified by `runId`, stamping the `finishedAt` timestamp and the terminal status.

The bookkeeping does not stop there. `finalizeRun` also enqueues a metric write for the run aggregate (token totals, computed cost, duration, and task counts). These writes are intended to be fire-and-forget from the caller's perspective, but the file provides a deterministic drain point:

```ts
async function drainPendingMetrics(): Promise<void> {
```

It takes no parameters and returns a `Promise<void>`. Every queued write is already wrapped in `.catch(() => {})`, so the function cannot throw; it simply waits for every pending ledger write that `finalizeRun` (or any other bookkeeping site) has scheduled. Callers invoke it immediately after `finalizeRun` so that the side-channel ledger is fully flushed before the CLI exit, which is what makes the run's accounting deterministic for tests and for the process exit code.

The high-level run record is shaped by `buildResult`, which assembles the user-facing `BatchRunResult` from the same ingredients: the terminal `status`, the per-stage totals, the per-module breakdown, the list of failures, whether the circuit breaker tripped, and the done/failed task counters. It is the seam between the internals (totals plus database ids) and the JSON shape that the rest of the system returns.

Finally, the CLI's exit code is decided by `statusToExitCode`, which maps the run's terminal status into a process exit signal. A clean `"completed"` is a success exit; `"completed_with_failures"` and `"aborted"&#96; map to non-zero codes so that shell pipelines and CI systems can detect that the batch did not finish cleanly. Together, these nine functions form the closing half of the pipeline: they turn a stream of partial usage observations into a single sealed summary, persist it, drain the supporting metrics, and surface the outcome as both a structured result and a process exit code.

## Additional indexed symbols

<!-- lw:anchors packages/core/src/batch.ts#accumulateUsage packages/core/src/batch.ts#aggregateTotals packages/core/src/batch.ts#buildResult packages/core/src/batch.ts#computeCostFromUsage packages/core/src/batch.ts#drainPendingMetrics packages/core/src/batch.ts#emptyUsage packages/core/src/batch.ts#finalizeRun packages/core/src/batch.ts#resolveOutputTokenBudget packages/core/src/batch.ts#statusToExitCode -->

These anchors identify indexed symbols in this module that were not assigned to an earlier generated section.

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
