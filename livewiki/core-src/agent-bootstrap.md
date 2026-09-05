---
title: Agent Bootstrap Queue Orchestration
owner: generated
anchors:
  - packages/core/src/agent-bootstrap.ts#AGENT_CLAIM_LEASE_MS
  - packages/core/src/agent-bootstrap.ts#advancePhase
  - packages/core/src/agent-bootstrap.ts#buildPlanningSnapshot
  - packages/core/src/agent-bootstrap.ts#checkpointForTask
  - packages/core/src/agent-bootstrap.ts#createAgentRun
  - packages/core/src/agent-bootstrap.ts#diagnosticAttempt
  - packages/core/src/agent-bootstrap.ts#emptySummary
  - packages/core/src/agent-bootstrap.ts#existingPageFacts
  - packages/core/src/agent-bootstrap.ts#fileTask
  - packages/core/src/agent-bootstrap.ts#finalizeAgentRun
  - packages/core/src/agent-bootstrap.ts#flowGroups
  - packages/core/src/agent-bootstrap.ts#forceOwner
  - packages/core/src/agent-bootstrap.ts#injectManualBlocks
  - packages/core/src/agent-bootstrap.ts#insertTask
  - packages/core/src/agent-bootstrap.ts#latestAgentRun
  - packages/core/src/agent-bootstrap.ts#makeRunState
  - packages/core/src/agent-bootstrap.ts#manualBlocks
  - packages/core/src/agent-bootstrap.ts#materializeFlowPhase
  - packages/core/src/agent-bootstrap.ts#materializeFolderPhase
  - packages/core/src/agent-bootstrap.ts#materializeTopicPhase
  - packages/core/src/agent-bootstrap.ts#materializeUnderstandingPhase
  - packages/core/src/agent-bootstrap.ts#newClaimId
  - packages/core/src/agent-bootstrap.ts#nextAgentBootstrapTask
  - packages/core/src/agent-bootstrap.ts#pageExists
  - packages/core/src/agent-bootstrap.ts#parseJson
  - packages/core/src/agent-bootstrap.ts#persistAttempt
  - packages/core/src/agent-bootstrap.ts#persistRunState
  - packages/core/src/agent-bootstrap.ts#prepareSubmission
  - packages/core/src/agent-bootstrap.ts#proseTitles
  - packages/core/src/agent-bootstrap.ts#readAgentState
  - packages/core/src/agent-bootstrap.ts#readAgentTask
  - packages/core/src/agent-bootstrap.ts#readOwner
  - packages/core/src/agent-bootstrap.ts#receiptEvidence
  - packages/core/src/agent-bootstrap.ts#receiptTaskId
  - packages/core/src/agent-bootstrap.ts#recoverTaskArtifacts
  - packages/core/src/agent-bootstrap.ts#refreshCompletedTaskReceipts
  - packages/core/src/agent-bootstrap.ts#renderFolderArtifact
  - packages/core/src/agent-bootstrap.ts#renewAgentBootstrapClaim
  - packages/core/src/agent-bootstrap.ts#restoreSnapshots
  - packages/core/src/agent-bootstrap.ts#sectionMapRecord
  - packages/core/src/agent-bootstrap.ts#staleClaimError
  - packages/core/src/agent-bootstrap.ts#submissionErrors
  - packages/core/src/agent-bootstrap.ts#submitAgentBootstrapTask
  - packages/core/src/agent-bootstrap.ts#taskCounts
  - packages/core/src/agent-bootstrap.ts#taskPresentation
  - packages/core/src/agent-bootstrap.ts#usageAttempt
  - packages/core/src/agent-bootstrap.ts#withEvidenceRetrievalGuidance
  - packages/core/src/agent-bootstrap.ts#withTestsPointer
  - packages/core/src/agent-bootstrap.ts#writeAndVerifySubmission
---

# Agent Bootstrap Queue Orchestration

This page explains how `agent-bootstrap.ts` implements the MCP execution surface for livewiki's deterministic batch plan, where a user's coding agent supplies Markdown content while livewiki handles task ordering, validation, transactional writes, and run finalization.

## When to use this page

- Understand how the agent-driven documentation pipeline differs from the API-driven `batch` module.
- Learn the task lifecycle from claiming through lease expiration to submission and verification.
- See how phase materialization (files → folders → flows → topics → understanding) is sequenced and advanced.
- Trace how manual-block preservation, owner detection, and receipt recovery work during agent submissions.

## How it fits

`agent-bootstrap.ts` sits in `packages/core/src/` as the counterpart to the LLM-driven `batch` pipeline. While the batch module owns the API-driven flow, this file orchestrates the "agent-written bootstrap queue" — the surface through which a connected coding agent (like Claude Code or Copilot) receives documentation tasks and submits Markdown that livewiki validates, writes, and finalizes.

The module deliberately has no dependency on `llm/index.ts` or `batch.ts`. Instead, it coordinates with the planner modules (`modules.ts`, `page-units.ts`, `flows.ts`, `topics.ts`, `understanding.ts`), the validation layer (`artifact.ts`, `verify.ts`, `mermaid-validator.ts`), and persistence (`db.ts`, `safe-io.ts`, `documentation-commit.ts`) to maintain the SQLite `batch_runs` and `batch_tasks` tables that record the agent run's progress.

This file exposes its public surface through two exported functions — `nextAgentBootstrapTask` and `submitAgentBootstrapTask` — which the MCP server layer calls to drive the agent through the documentation plan. The rest of the file is internal machinery for materializing phases, persisting state, recovering receipts, and submitting validated content.

## Run Creation and Deterministic Planning
<!-- lw:anchors packages/core/src/agent-bootstrap.ts#AGENT_CLAIM_LEASE_MS packages/core/src/agent-bootstrap.ts#buildPlanningSnapshot packages/core/src/agent-bootstrap.ts#makeRunState packages/core/src/agent-bootstrap.ts#fileTask packages/core/src/agent-bootstrap.ts#insertTask packages/core/src/agent-bootstrap.ts#createAgentRun -->

These anchors identify indexed symbols whose implementation is part of this module.

## Run Creation and Deterministic Planning

The agent run lifecycle begins with `createAgentRun(repoRoot: string): Promise<RunRow>`:

```ts
async function createAgentRun(repoRoot: string): Promise<RunRow> {
```

This entry point takes a repository root path and returns a `RunRow` representing the newly created run. It is deliberately free of any LLM client or orchestration logic — it performs only the deterministic planning necessary to persist a run and its initial task queue. The comment at its top explains that the `batch` field is intentionally absent so that this code path cannot accidentally pull in the API orchestrator.

The first step is to `runInit({ repoRoot, quiet: true })`, which ensures the repository's `.livewiki` database and any supporting structure exist before anything else touches them. With the database ready, it loads the raw configuration with `loadConfig(repoRoot)` and then calls `buildPlanningSnapshot(repoRoot, rawConfig)` to produce a full snapshot of the workspace — see below — followed by `makeRunState(rawConfig, snapshot)` to serialize that snapshot into an `AgentRunState`.

### Building the Planning Snapshot

`buildPlanningSnapshot(repoRoot: string, rawConfig: LivewikiConfig): Promise<PlanningSnapshot>`:

```ts
async function buildPlanningSnapshot(
  repoRoot: string,
  rawConfig: LivewikiConfig,
): Promise<PlanningSnapshot> {
```

This async function takes the repository root and the raw configuration and returns a `PlanningSnapshot` — a data structure capturing everything the run will need later: symbols, modules, ordering, edges, page units, and flow candidates. It applies defaults to the raw config with `applyDefaults(rawConfig)` so that all subsequent logic works against a fully populated configuration. It then opens the index database and reads two active rowsets: all symbols with `status = 'active'` ordered by key, and all active files ordered by path. From the file rows it builds `filePaths` (the list of paths), `sizeByPath` (a map from path to byte count), and two derived maps — `symbolCountByPath` and `symbolsByFile` — by iterating over the symbol rows and grouping each symbol's key by the part before the `#` separator, which identifies its file.

Next the snapshot delegates to `planPageUnits`, passing the file paths, per-file symbol counts, and sizes, along with a configuration object that carries the path roles if provided and the file-split source byte threshold (falling back to `CONFIG_DEFAULTS.fileSplitSourceBytes`). This returns a `pageUnits` structure of file units and folder units. From the folder units it constructs an initial array of `Module` objects, each with an id, the list of file paths it covers, and a summed symbol count across its files. It then runs `makeUniqueDeterministicIds(modules)` so that module ids are stable and unique regardless of the order the folder units came in, followed by `assertExactPathPartition` and `assertUniqueModuleIds` to guarantee the modules partition the file set exactly once.

With the module partition settled, the snapshot resolves the dependency graph. It calls `collectImportsForFiles(repoRoot, filePaths)` to extract import statements from each file, then loads workspace package metadata via `loadWorkspacePackages(repoRoot)` and the effective TypeScript config via `loadEffectiveTsconfig`. It also loads the Go module path with `loadGoModulePath` and the Rust crate name with `loadRustCrateName`. All of these feed into `resolveImportEdges`, which decides which imports are resolvable within the known file set and workspace; the result is a list of `resolvedImportEdges`. From there `resolveModuleEdges` derives edges between modules based on those resolved imports, and `prioritizeModules(modules, edges, config.pathRoles)` produces the `ordered` module list — the deterministic build order the run will follow.

The final data the snapshot gathers are flow candidates — groups of related symbols likely to belong to a single narrative flow. It first builds a `resolvedOccurrences` set from every resolved edge (keyed as `fromFile` plus a null byte plus the source string) so it can separate *internal* references from truly external ones. It then constructs `externalImportsByFile` by filtering each file's imports down to those whose source is not present in that resolved set — meaning the import resolves to something outside the workspace. Those external references, together with the ordered modules, module edges, per-file symbol lists, and resolved edges, are handed to `detectFlowCandidates`, along with the path-role and flow-signal configuration and the various flow limits (`maxFlows`, `flowMaxAnchors`, `flowMaxOverlap`) drawn from defaults. The cross-module callee set is computed on the fly via `computeCrossModuleCallees(db, ordered)` from the still-open database. The snapshot object then returns all of this — symbols, modules, ordered list, edges, page units, symbol counts per path, and flow candidates — and the function closes the database in a `finally` block.

### Serializing Config into Run State

`makeRunState(rawConfig: LivewikiConfig, snapshot: PlanningSnapshot): AgentRunState`:

```ts
function makeRunState(
  rawConfig: LivewikiConfig,
  snapshot: PlanningSnapshot,
): AgentRunState {
```

This pure function takes the raw configuration and a `PlanningSnapshot` and returns an `AgentRunState` — the complete recipe for the run, ready to be serialized as JSON into the database. It first applies config defaults the same way the snapshot builder does, then assembles the state object. The state records a `version` of 1, an `executor` of `"agent"`, and an initial `phase` of `"files"` (meaning the run starts by generating file pages). It sets the `language` from config or `"en"`, and computes `maxAttempts` as `1 + (config.maxRepairAttempts ?? CONFIG_DEFAULTS.maxRepairAttempts)` so the run always gets at least one repair attempt on top of the initial attempt. It also copies in the `TOPIC_REFINE` constant for topic refinement.

The bulk of the state is the `config` field, which flattens every configurable limit and toggle that the run later needs — `maxFlows`, `flowMaxAnchors`, `flowMaxOverlap`, `flowMaxDiagramNodes`, `flowMaxDiagramEdges`, `moduleMaxDiagramNodes`, `moduleMaxDiagramEdges`, `maxTopics`, `topicMaxAnchors`, `topicMaxSourceChars`, `concernTopics`, `rationaleMaxChars`, `understandingSynthesis`, `moduleDiagrams`, `deepHierarchy`, and — only if defined — `pathRoles`. Each value falls back to its `CONFIG_DEFAULTS` counterpart when absent from the config. The state then copies the practical results of planning: `modules`, `ordered`, and `edges` straight from the snapshot, plus `fileUnits` and `folderUnits` as shallow copies of the snapshot's arrays, `symbolCountByPath` converted from a `Map` to a plain object, and the `flowCandidates` list. It initializes `acceptedTopicSlugs` to an empty array, ready for topics to be accepted as pages are written.

### Persisting the Run and Its Initial Task Queue

Back in `createAgentRun`, after the snapshot and state exist, the function opens the index database a second time (the snapshot builder opened and closed its own handle) and in a `try` block performs the persistence. It captures `now` as `Date.now()`, then inserts a row into `batch_runs` with the timestamp, `'agent'` as the starter, stage `4`, the full serialized state as `config_json`, and status `'running'`. The new run's id comes back as `lastInsertRowid`.

To decide the order in which file tasks will run, the function consults the prioritized module list. It builds a `folderPriority` map from the `ordered` modules, associating each module id with its index. Then it sorts the snapshot's `fileUnits` by that priority — first by the folder's position, then by descending symbol count within the same folder, and finally by the file unit's id as a tiebreaker for full determinism. The sorted `fileUnits` become the run's working queue.

Before creating tasks, the function reconstructs the per-file symbol key lists from `snapshot.symbols` the same way the snapshot builder did — splitting each symbol key at `#` to find its file — and stores them in `keysByFile`. Then, for every file unit in the sorted order, it calls `insertTask` with the repository root, the open database, the run id, stage `4`, the unit's id as its target, and `fileTask(unit, state, ...)` to build the actual task; the keys for that file are passed sorted. Each insert commits a pending `batch_tasks` row whose `checkpoint_json` marks the task as not yet done.

`fileTask(unit: FileUnit, state: AgentRunState, closedKeys: string[]): PersistedAgentTask`:

```ts
function fileTask(
  unit: FileUnit,
  state: AgentRunState,
  closedKeys: string[],
): PersistedAgentTask {
```

This synchronous helper takes a `FileUnit`, the `AgentRunState`, and the list of closed symbol keys for that file, and returns a `PersistedAgentTask` of kind `"file-page"`. It constructs a single-file `Module` from the unit — its id, a one-element paths array, and the unit's symbol count — then classifies that module's role via `classifyModuleRole(module, state.config.pathRoles)` and packs everything into the task shape: `targetPath` from the unit's page path, the `closedKeys`, the source path, the module role, the synthetic module, and the original file unit. This task object is what `insertTask` will persist.

`insertTask(repoRoot: string, db: Database.Database, runId: number, stage: 4 | 5, target: string, task: PersistedAgentTask, state: AgentRunState, now: number): Promise<number>`:

```ts
async function insertTask(
  repoRoot: string,
  db: Database.Database,
  runId: number,
  stage: 4 | 5,
  target: string,
  task: PersistedAgentTask,
  state: AgentRunState,
  now: number,
): Promise<number> {
```

This async function takes the repository root, an open database, the run id, a stage (4 or 5), a target identifier, the task to persist, the run state, and a timestamp, and returns the new row id. Its first act is to call `recoverTaskArtifacts(repoRoot, task, state)` — a recovery probe that checks whether any artifacts for this task already exist on disk from a previous, interrupted run. If artifacts are found, the task is considered already done: the function sets the checkpoint's `status` to `"done"`, stamps `finishedAt` with `now`, and attaches the recovered artifacts. Otherwise the task stays `"pending"`. Either way, it builds the checkpoint via `checkpointForTask(task, stage, now)`, then inserts a row into `batch_tasks` with the run id, stage, target, `"pending"` or `"done"` as the status, serialized checkpoint JSON, and the timestamp. The function returns the database-assigned row id, all wrapped in a `finally` block that closes the database handle after the run row and tasks are persisted.

The constant that governs how long a claimed task may go without progress before another agent can reclaim it is `AGENT_CLAIM_LEASE_MS`:

```ts
export const AGENT_CLAIM_LEASE_MS = 30 * 60 * 1000;
```

This value — thirty minutes in milliseconds — is the lease duration an agent holds on a claimed task before the lease expires and the task becomes claimable again. It is a module-level constant so that both the planner (which creates pending tasks) and the agent loop (which later claims them) agree on the same timeout window, keeping task ownership deterministic even across process restarts.

## Phase Materialization Pipelines
<!-- lw:anchors packages/core/src/agent-bootstrap.ts#recoverTaskArtifacts packages/core/src/agent-bootstrap.ts#existingPageFacts packages/core/src/agent-bootstrap.ts#proseTitles packages/core/src/agent-bootstrap.ts#renderFolderArtifact packages/core/src/agent-bootstrap.ts#pageExists packages/core/src/agent-bootstrap.ts#materializeFolderPhase packages/core/src/agent-bootstrap.ts#materializeFlowPhase packages/core/src/agent-bootstrap.ts#materializeTopicPhase packages/core/src/agent-bootstrap.ts#materializeUnderstandingPhase packages/core/src/agent-bootstrap.ts#persistRunState packages/core/src/agent-bootstrap.ts#advancePhase -->

The phase materialization pipelines are the engine that converts a persisted batch run's accumulated state into concrete wiki artifacts, stage by stage. Each phase has its own materializer function (one per artifact kind), and they are orchestrated by `advancePhase`, which acts as a state machine driving the run forward.

`advancePhase` is the dispatcher. It switches on the current `state.phase` and calls the corresponding materializer, which mutates state and persists it before returning.

```ts
async function advancePhase(
  repoRoot: string,
  db: Database.Database,
  run: RunRow,
  state: AgentRunState,
): Promise<"advanced" | "completed" | "completed_with_failures">
```

It takes the repository root, database, run row, and current agent state, and returns a status string indicating whether the run advanced to the next phase or finished. The flow starts with the `"files"` phase (materializeFolderPhase builds folder pages), moves to `"folders"` (materializeFlowPhase) for flow pages, then `"flows"` (materializeTopicPhase) for topic pages, then `"topics"` (materializeUnderstandingPhase) for the understanding page, and finally reaches either `"understanding"` or `"finalizing"` which delegates to `finalizeAgentRun` to complete the whole process.

Each materializer follows a similar pattern: it builds a task object, decides whether the artifact needs a user's model (by calling `insertTask`) or can be written deterministically right away, then sets the phase forward and calls `persistRunState`.

`persistRunState` records the new phase and current config. It runs a SQL update on the batch_runs table, choosing stage 4 for the early file/folder phases or stage 5 for flow/topic/understanding, and stores the entire state JSON for resumability.

**Folder phase — deterministic pages and queued work.** `materializeFolderPhase` loops over every module in `state.ordered`. Product-role modules get their folder-page task handed to `insertTask` for the agent pipeline. Every other folder page type — auxiliary ones for non-product roles — is written right here without asking a model. For these, it reads any existing page, checks its `readOwner`. If the owner is `"human"`, `"untrusted"`, or `"unparseable"`, it skips writing entirely to keep human authoring intact. Otherwise it renders the fresh page with `renderFolderArtifact`, and if a page already existed it merges in any manually written blocks through `injectManualBlocks` and forces a `"mixed"` owner label when the page was a mix of human and generated content. After the write, the phase advances to `"folders"` and persists.

`renderFolderArtifact` is the helper that produces these deterministic folder pages. It takes the repository root, the folder-page task (narrowed to the `folder-page` kind), and a purpose string.

```ts
async function renderFolderArtifact(
  repoRoot: string,
  task: Extract<PersistedAgentTask, { kind: "folder-page" }>,
  purpose: string,
): Promise<string>
```

It takes the repo root, the folder-page task, and a purpose string, and returns the rendered Markdown page text. It gathers facts about which target pages already exist on disk in `existingPageFacts`, then delegates to `renderFolderPage` with the file-unit metadata, the symbol counts, the existing page paths, and titles. It also surfaces the role only when the module role is not `"product"`, so the page includes role-aware annotations.

`existingPageFacts` is the survey step. It scans each file unit and returns a summary object: which pages already have content, what their titles are (from `extractPageTitle`), and an opening digest per page that later stages can use to detect manual edits.

```ts
async function existingPageFacts(repoRoot: string, fileUnits: readonly FileUnit[]): Promise<{
  existingPagePaths: Set<string>;
  titlesByPagePath: Map<string, string>;
  openingsByPagePath: Map<string, string>;
}>
```

It takes the repository root and a list of file units, and returns a structure with the three maps/sets describing the on-disk state. Each file page is read via `safeIo.readText`; only readable files count as existing.

`proseTitles` is a narrower companion for folder entries — it walks a folder's `"inert"` Markdown entries and extracts their titles, producing a `filePath → title` map so the folder page can list its prose files with human-readable names.

`pageExists` is the tiny probe used across all phases.

```ts
async function pageExists(repoRoot: string, path: string): Promise<boolean>
```

It takes the repo root and a wiki-relative path, and returns `true` when the file is readable, `false` otherwise (any read failure means absent).

**Flow phase — skipping immature candidates.** `materializeFlowPhase` iterates the planned flow candidates. A candidate is skipped when it carries an explicit `skip` marker, and also when any of its participant module pages (`livewiki/<id>/index.md`) do not exist yet — a flow cannot be materialized before its source modules do. For surviving candidates it collects every source path from the participating modules and records a `flow` task via `insertTask` with the seed keys that will later seed the model prompt. Phase advances to `"flows"`.

**Topic phase — a deterministic planning gate.** `materializeTopicPhase` first builds the set of flow slugs whose pages actually got written (`acceptedFlowSlugs`). Only those flows are admissible as anchors for topics. When `state.config.maxTopics` is greater than zero, it assembles a planning inventory with `buildTopicPlanningInventory` (passing optional path-role config if present) and runs `proposeTopicPlanDeterministically` with the allowed flow slugs and the centrality scores computed from `computeCallerCentrality(db)`. The accepted topic slugs are stored back onto the state. For each proposed topic candidate it gathers source paths from its modules plus its flow pages, de-duplicates and sorts them, and enqueues a `topic` task keyed on the candidate's `evidenceHash` so the agent pipeline can later produce the topic page.

**Understanding phase — gated on a real basis.** `materializeUnderstandingPhase` only enqueues work when `state.config.understandingSynthesis` is enabled. It builds the evidence via `buildUnderstandingEvidence`, and proceeds only when `hasUnderstandingBasis(evidence)` returns true — meaning the repository actually has enough module/page material to synthesize a meaningful overview. The source path list is the union of the repository `README.md` (when present at the root), every file-unit page, every folder page, every flow page, and every accepted topic page. Any `livewiki/` path that does not yet exist on disk is dropped before enqueueing, the rest are sorted and deduplicated. The `understanding` task records the evidence hash for change detection and carries a suggested title taken from the repo's README when one is available, defaulting to "Repository understanding".

**Recovering prior work instead of repeating it.** `recoverTaskArtifacts` is the mechanism that lets the same run resume old completed work without burning model calls. For non-file tasks it delegates to `recoverDocumentationReceipt`, supplying the evidence and, for flow-kind tasks, the expected diagram path. For a `file-page` task it first requires that the current contract baseline hasn't drifted (`hasCurrentContractBaseline`), then it reads the existing page and normalizes it with `normalizeStage4Artifact`. Only a page whose content survives `validateStage4Artifact` counts as recoverable — and the validation may run in relaxed mode when the page was accepted under degraded quality. When module diagrams are configured, it also checks that the companion Mermaid diagram exists, parses cleanly under `validateMermaidSyntax`, and respects the node/edge limits from `state.config`; when diagrams are not configured, the artifacts are just the page and its hash. Any failure along this chain returns `null`, which tells the caller the task must be regenerated from scratch.

## Task Ownership and Claiming
<!-- lw:anchors packages/core/src/agent-bootstrap.ts#newClaimId packages/core/src/agent-bootstrap.ts#checkpointForTask packages/core/src/agent-bootstrap.ts#nextAgentBootstrapTask packages/core/src/agent-bootstrap.ts#readAgentState packages/core/src/agent-bootstrap.ts#readAgentTask packages/core/src/agent-bootstrap.ts#latestAgentRun -->

The claiming mechanism is driven by **leases with atomic compare-and-swap** so that, amid concurrent callers, **each task row is handed to exactly one executor**. This section explains the five symbols that make that true and the loop that uses them inside `nextAgentBootstrapTask`.

`newClaimId()` returns a fresh UUID — `nodeCrypto.randomUUID()` — which becomes the unique `claim_id` stamped on a row when an executor successfully reserves it. The UUID is the token that lets the claiming executor prove ownership later, and its uniqueness is what makes two callers never share a lease.

`checkpointForTask(task: PersistedAgentTask, stage: 4 | 5, startedAt: number): TaskCheckpoint` fabricates a pessimistic `TaskCheckpoint` snapshot: it sets `stage` to the given phase, `status` to `"pending"`, `attempt` to `0`, carries the wall-clock `startedAt`, and seeds empty `usageHistory` and `diagnosticHistory` arrays, then embeds the full `task` descriptor. Executors call this when materializing a newly discovered task — before any claim attempt — so the checkpoint always begins in a well-formed, not-yet-leased state. (`checkpointForTask` is not directly exercised in this section's source slice, but it establishes the baseline shape that the claiming loop later mutates.)

`readAgentTask(row: TaskRow): { task: PersistedAgentTask; checkpoint: TaskCheckpoint }` parses the row's stored `checkpoint_json` into a `TaskCheckpoint` and requires that `checkpoint.agentTask` is present — else it throws. It returns both the parsed `checkpoint` and its embedded `task`. Callers use it after a `SELECT` to recover the descriptor they are about to claim and to know which `status`/`lease` fields they must overwrite.

`readAgentState(run: RunRow): AgentRunState` reconstructs the run-wide configuration by parsing the run's `config_json` into an `AgentRunState` and enforcing two invariants: `version === 1` and `executor === "agent"`; anything else raises an error identifying the run. This is the guard that keeps the claiming loop from proceeding on a run whose persisted state does not match the agent-bootstrap schema, since the later phase-transitions all read and mutate that same state.

`latestAgentRun(db: Database.Database): RunRow | undefined` queries `batch_runs` for the most recent row that `started_by = 'agent'` (highest `id`) and returns it, or `undefined` when no agent run exists yet. It is the entry point used to locate the run whose tasks are to be claimed. A final helper, `latestAgentRun`, selects the most recent agent run by descending `id`, returning `undefined` when none exists.

The orchestration lives in `nextAgentBootstrapTask(repoRoot: string): Promise<AgentQueueResult>`, which is exported and serves as the claimant-facing API. It first resolves `repoRoot` to an absolute path, checks whether `.livewiki/index.db` exists, and — if not — calls `createAgentRun` to seed an initial run. It then opens the index database and resolves it through `safeIo.resolveAndValidate`. After opening, it fetches the current run via `latestAgentRun`; if none exists, it closes the handle, calls `createAgentRun` again, reopens, and retries. Once a run is found, the function inspects `run.status`. A run already `"completed"` or `"completed_with_failures"` is returned immediately with its status and the fixed `ACCOUNTING`/`TOPIC_REFINE` payloads. A status other than `"running"` is unrecoverable and throws. Only a `"running"` run proceeds to the claiming loop.

Inside that loop, the function reads run state via `readAgentState`, then enters an infinite loop. Each iteration computes `now`, and runs a `SELECT` that picks **only rows nobody owns** — the `UNCLAIMED_PREDICATE` in the `WHERE` filters out rows whose lease is still alive (i.e. `lease_expires_at` greater than `now`), plus any that are completed or failed. The ordering favors `"running"` rows first, then by id, so resume work is tried before fresh claims. If no such row exists, the loop breaks out of the claiming branch into the phase-advance logic (described below). If a candidate row is found, the function increments `claimAttempts` and aborts after `MAX_CLAIM_ATTEMPTS` consecutive lost races, throwing a descriptive error. Otherwise it calls `readAgentTask` to recover the parsed `task` and `checkpoint`, then calls `newClaimId()` to mint a fresh UUID and computes `leaseExpiresAt = now + AGENT_CLAIM_LEASE_MS`. It flips the checkpoint status to `"running"` and executes **the atomic claim**: a single `UPDATE` that sets `status = 'running'`, the new `claim_id`, the lease expiration, the serialized checkpoint, and `updated_at`, with the `WHERE` clause again containing the full `UNCLAIMED_PREDICATE` so that the update only succeeds if the row was still unowned at that instant. Because SQLite applies the `UPDATE` atomically, exactly one concurrent caller can observe `changes === 1`; any caller whose update reports `changes !== 1` lost the race and simply `continue`s the loop, never having advanced the phase. The winner returns an `AgentQueueResult` of `status: "task"` with `taskPresentation` (including the fresh `claimId` and `leaseExpiresAt`) plus the standard accounting books.

When the candidate `SELECT` comes back empty, the empty set is handled with deliberate care: it does *not* mean the phase is finished. Work leased to another executor is still in flight and invisible to that `SELECT` by design, so advancing here could materialize the next phase — or, on the last phase, finalize the whole run — while another writer is active. Instead the function runs a `COUNT` over all `pending`/`running` rows in the run and also fetches the soonest lease expiration. If that count is above zero, it returns `status: "busy"` with the in-flight task count and the earliest lease timestamp so callers know when the work may become claimable again. Only when that count is zero — meaning no pending and no running rows remain — does the function call `advancePhase(absRoot, db, run, state)`. That call transitions the run to the next phase or, when no phases remain, to its final state. If `advancePhase` returns something other than `"advanced"` (e.g. a terminal status), the function returns that status directly with the accounting payloads. If it did advance, the local `run` copy is refreshed with the new `config_json` by serializing the mutated `state`, and the loop restarts to claim tasks in the new phase. The `try/finally` guarantees the database handle is closed no matter which return path is taken.

## Contract Presentation and Evidence Guidance
<!-- lw:anchors packages/core/src/agent-bootstrap.ts#sectionMapRecord packages/core/src/agent-bootstrap.ts#flowGroups packages/core/src/agent-bootstrap.ts#withEvidenceRetrievalGuidance packages/core/src/agent-bootstrap.ts#taskPresentation -->

The `taskPresentation` function is the central mechanism that transforms a persisted task into an enriched contract bundle for the agent. It takes the numeric `taskId`, the `task` (a `PersistedAgentTask`), a `checkpoint` to track retry usage, the current `state` holding configuration and language settings, and `claim` metadata for lease tracking. It returns an `AgentBootstrapTask` object that includes the prompt pair, validation data, and execution metadata.

The function begins by declaring two local variables: `formatContract`, which will hold the generated prompt pair, and `validation`, an empty `AgentTaskValidationSummary` object that will accumulate structured hints about the task. It then dispatches on `task.kind` to build the appropriate prompt.

For a `"file-page"` task, the function configures optional diagram parameters from `state.config.moduleDiagrams` (extracting `maxNodes` and `maxEdges` from `moduleMaxDiagramNodes` and `moduleMaxDiagramEdges`). It calls `buildStage4Prompt` with the task's module, closed keys, empty strings for placeholders, the language, module role, and an options object that conditionally includes the diagrams and `deepHierarchy` flag. The resulting contract is assigned to `formatContract`. If diagrams are enabled, the function sets `validation.moduleDiagramPath` to a path under `livewiki/diagrams/` constructed via `moduleSlug(task.module.id)`.

For `"folder-page"` tasks, the function calls `buildFolderPurposePrompt` with an empty string and the language, producing the contract.

Flow tasks follow a more elaborate path. The function calls `assignFlowKeySections(task.candidate)` to obtain a `sectionMap` that associates keys with section identifiers. It then builds the prompt via `buildStage5Prompt`, passing the candidate, closed keys, empty strings, language, diagram node/edge limits from the config, the `flowGroups(task.candidate)` result, and the `sectionMap`. At this point, `flowGroups` simply repackages the candidate's `entryKeys`, `boundaryKeys`, and `sinkKeys` into a structured object, preserving them for the prompt builder. After building the contract, the function populates `validation`: it sets the `title` from the candidate's `titleSeed`, collects `moduleIds` into `modules`, and derives `sectionByKey` by invoking `sectionMapRecord(sectionMap, FLOW_SECTION_TITLES)`.

`sectionMapRecord` takes a `ReadonlyMap<string, string>` and a record of titles. It constructs a plain object by spreading the map's entries and mapping each value: if the section identifier has a title in the titles record, that title is used; otherwise the raw section string is kept as a fallback. This yields human-readable section labels that are passed along in validation, making the mapping between closed keys and display titles explicit.

For `"topic"` tasks, the function similarly computes a section map via `assignTopicKeySections(task.candidate)`. It builds the contract with `buildTopicPrompt` using the candidate, empty strings, language, and the section map. Then it populates `validation` more richly: `title` from `task.candidate.title`, `order` from `planOrder`, `intent`, plus spread arrays for `modules` and `flows`, and finally `sectionByKey` through `sectionMapRecord` with `TOPIC_SECTION_TITLES`.

For `"understanding"` tasks, the function calls `buildUnderstandingPrompt` with an empty string and language, and sets the validation title from `task.suggestedTitle`.

Once the switch completes, the function constructs the final `AgentBootstrapTask`, embedding all core metadata: the `taskId`, `kind`, `targetPath`, a defensive copy of `closedKeys`, and `sourcePaths`. Crucially, the `formatContract` is passed through `withEvidenceRetrievalGuidance` an augmentation layer that brings in retrieval instructions for the agent.

`withEvidenceRetrievalGuidance` accepts the contract prompt pair and the task. It checks whether `task.sourcePaths` has any entries; if so, it joins them with commas; otherwise, it substitutes a placeholder declaring the task documents no source file directly. It then returns a new `PromptPair`: the system prompt is passed through unchanged, but the user prompt is extended with a special `# Evidence retrieval` section. That section explains that the payload deliberately carries no inline evidence — the contract is authoritative, and the agent must fetch supporting material itself. It instructs the agent to treat `closedKeys` as the anchor whitelist, never inventing a key though a symbol discovered later might be interesting. It also names `sourcePaths` as the files to consult and recommends using the `livewiki_search` and `livewiki_read` tools as well as direct reads of the source paths.

Finally, the function attaches the `validation` record, `attempts` reflecting the checkpoint used versus the total limit, and the claim identifiers. It returns the assembled object, ready for distribution to the agent as a self-contained task description that explicitly tells the agent what to write, what anchors are legal, where evidence lies, and how hard it may try before giving up. The whole flow ensures that every task kind carries a uniform envelope while letting the kind-specific prompt builders impose their own structure, with the evidence guidance layer appended uniformly across all kinds.

## Submission Validation and Artifact Preparation
<!-- lw:anchors packages/core/src/agent-bootstrap.ts#submissionErrors packages/core/src/agent-bootstrap.ts#prepareSubmission packages/core/src/agent-bootstrap.ts#withTestsPointer -->

`prepareSubmission` is the single choke point through which every agent-produced artifact must pass before it can be persisted into the wiki. Its role in the larger mechanism is to take the raw Markdown an agent returned for a task, normalize it, validate it against the rules for that task kind, and produce a `PreparedSubmission` that describes either a ready-to-write page or a set of rejection errors. Everything downstream — persistence, re-prompting, failure reporting — consumes only this prepared shape, so `prepareSubmission` is what guarantees that the wiki never stores an artifact that violates the project's structural or content contracts. It also decides, per task kind, whether the errors it finds are severe enough to reject the submission outright or merely worth reporting.

The function begins by branching on the task kind, and the first two branches handle the simplest cases. When the task is a `folder-page`, it runs `validateFolderPurpose(rawContent)` on the raw content and converts the result with `submissionErrors` — a thin adapter that takes the validator's flat error records and reshapes them into `AgentSubmissionError` objects, copying over the optional `location`, `sectionSlug`, and `offending` fields only when they are present. If validation produced no errors, it renders the final artifact by calling `renderFolderArtifact(repoRoot, task, rawContent.trim())`, trimming leading and trailing whitespace first; otherwise it returns an empty `pageContent` alongside the errors. Note that `folder-page` submissions are never rejected outright (`rejectAnySeverity` is always `false`) — folder pages are treated as advisory, so their errors are surfaced but do not block the write.

For every other task kind, `prepareSubmission` first runs `normalizeStage4Artifact(rawContent)` to canonicalize the Markdown (fixing formatting, normalizing headings, and so on). If normalization fails, it returns an empty page with the normalization errors, and it rejects the submission outright only when the task is a `flow` or `topic` — these are pages whose structural integrity depends on exact section layout, so a failure to normalize is fatal. An `understanding` task is handled next: it validates the normalized content with `validateUnderstandingArtifact`, and regardless of the outcome returns the normalized content as the page while setting `rejectAnySeverity: true`, meaning understanding artifacts are always held to a strict standard — any validation error rejects the submission.

The `file-page` branch is where the most preparation happens. It first computes the module slug from the task's module id and, when the run configuration has module diagrams enabled, attempts to extract an inline Mermaid diagram from the page content. The extraction is validated in two ways: `validateMermaidSyntax` checks whether the diagram source is valid Mermaid, and `countFlowDiagramElements` measures its size; if the diagram is too large or syntax-invalid, or if it exceeds the configured node/edge limits, the function returns immediately with diagram-specific errors and an empty page. When the diagram passes, its source is set aside as a companion artifact at `livewiki/diagrams/${slug}.mmd` and the diagram is stripped from the page content. The function then builds a `Stage4ValidationContext` describing the module, and calls `validateStage4Artifact` on the (possibly diagram-stripped) page. If validation succeeds, the page content is passed through `withTestsPointer`, which appends a Tests section noting the same-name test file on disk and any name-prefix-matched test paths; if validation fails, the raw validated content is kept so the agent can see what it produced, and the validation errors are converted via `submissionErrors` and returned alongside the optional diagram companion.

The `flow` branch generates its diagram programmatically rather than extracting it from content: `generateFlowDiagram` builds a Mermaid source from the task's candidate and module list, constrained by the configured node/edge limits, and that source is syntax-checked — a failure here rejects the submission outright. The diagram is then inserted into the normalized content via `insertFlowDiagramSection`, which returns `null` if the content lacks the required “Ordered flow” and “Invariants” sections, in which case the function rejects with a `flow_missing_required_section` error. Otherwise the page is validated against a context that expects the flow diagram path and the set of modules the flow must reference, and the function returns the page content, the diagram as a companion file at `livewiki/diagrams/flow-${task.candidate.slug}.mmd`, and `rejectAnySeverity: true` so any validation failure blocks the submission.

The final branch, for `topic` tasks, validates the normalized content against a rich context that pins the expected title, ordering, intent, modules, flows, key groups, and — importantly — which product keys the topic is allowed to seed, computed by filtering the candidate's seed keys through `classifyPathRole`. No diagram companion is produced for topics, and `rejectAnySeverity` is `true`, so any validation error rejects the submission. Across all branches, `submissionErrors` normalizes the heterogeneous error shapes from the various validators into a uniform `AgentSubmissionError[]`, and `withTestsPointer` is the only place the file touches test-file references — it appends them to the page content itself rather than returning them as structured data.

## Transactional Write, Verification, and Rollback
<!-- lw:anchors packages/core/src/agent-bootstrap.ts#restoreSnapshots packages/core/src/agent-bootstrap.ts#writeAndVerifySubmission packages/core/src/agent-bootstrap.ts#parseJson packages/core/src/agent-bootstrap.ts#persistAttempt -->

The submission pipeline must guarantee that a failed agent write never leaves the repository in a partially modified state. `writeAndVerifySubmission` orchestrates this by capturing the original state of every file it will touch, writing the new content, running verification, and — if anything fails — restoring the originals via `restoreSnapshots`.

`restoreSnapshots` is the rollback primitive. It accepts the `repoRoot` and an array of file paths paired with their original content (or `null` when the file did not previously exist). It iterates over the array in reverse order to undo writes in the opposite sequence they were applied, and for each entry either removes the file (when `content` is `null`) or writes the original text back. Because a rollback is itself an I/O operation that can fail, the function does not throw; instead, it collects any failure messages into a `string[]` and returns that list so the caller can report partial rollback.

Before writing anything, `writeAndVerifySubmission` prepares the exact file set it will mutate and records the current disk state of each. It starts by reading the target page at `task.targetPath`; if that read succeeds, it merges any preserved manual blocks from the existing page into the prepared content via `injectManualBlocks` and may force the owner marker to `"mixed"` when the original page was mixed. It then builds the `snapshots` array: always the target page, optionally the companion file referenced in `prepared.companion`, and — depending on the task kind — the flow or topic hub index. Each snapshot captures the file's current text with a fallback of `null` when the file does not exist yet, so the rollback knows whether to restore or delete.

With snapshots recorded, the function enters the transactional write phase. It writes the merged `finalPage` to the target path, writes the companion file (ensuring a trailing newline), and, for flow or topic tasks, resynchronizes the hub indexes by calling `syncFlowsIndexHub` or `syncTopicsIndexHub`. After all writes succeed, it invokes the injected `verify` function against the whole repository. The verification issues are filtered down to those that mention the target or companion path in `wikiPath`, that are not `baseline_entry_without_anchor`, and that violate the configured severity gate (`prepared.rejectAnySeverity` or severity `"error"`). If no issues remain, the function returns success immediately with the final page content and no errors. If issues do remain, it calls `restoreSnapshots` to revert all files and returns a failure result carrying the mapped submission errors and a `rollbackFailed` flag indicating whether restoration itself encountered problems.

Any thrown exception during the write or verify phase is handled by a single `catch` block that also triggers `restoreSnapshots`. In this branch the function cannot map individual verification issues, so it returns a single error whose code is either `write_verify_exception` or `rollback_failed` (when restoration also failed) and whose `location` is `"global"`. The role of the `pageContent` field in all three return shapes is to give the caller the attempted final content so it can be stored in the task's diagnostic history even when the write did not persist.

After the file-system transaction settles, the outcome needs to be recorded durably in the database. `persistAttempt` takes the task row, a mutable `checkpoint` object, the content that was written, any errors, and options describing success or terminal failure. It increments `checkpoint.attempt`, pushes a new usage marker via `usageAttempt`, and appends a diagnostic entry via `diagnosticAttempt` that captures the content, errors, and success flag. It then derives the batch status: `"done"` on success, `"failed"` when the submission is terminal but unsuccessful, and `"running"` otherwise. On success it stamps `finishedAt`, requires `opts.artifacts` (throwing if absent, since a successful agent task must have produced artifact metadata), and stores those artifacts while clearing any prior error. On terminal failure it stamps `finishedAt` and records an `error` object whose code and message come from the first submission error, defaulting to `"agent_submission_failed"`. Finally it writes the updated status, checkpoint JSON, and timestamp back to the `batch_tasks` row with a parameterized `UPDATE` statement and returns the computed status.

## Run Finalization and Receipt Handling
<!-- lw:anchors packages/core/src/agent-bootstrap.ts#emptySummary packages/core/src/agent-bootstrap.ts#taskCounts packages/core/src/agent-bootstrap.ts#finalizeAgentRun packages/core/src/agent-bootstrap.ts#refreshCompletedTaskReceipts packages/core/src/agent-bootstrap.ts#receiptTaskId packages/core/src/agent-bootstrap.ts#receiptEvidence -->

When an agent run finishes its task executions, it does not simply stop — it must close out the run in a way that leaves a coherent, verified, and accountable record. `finalizeAgentRun` is the orchestrator of that closeout. It is an `async` function that accepts the repository root, the database, the numeric `runId`, and the in-memory `AgentRunState`, and returns a `Promise` resolving to the string `"completed"` or `"completed_with_failures"`; that is, it drives the run to one of two terminal states based on whether any failures or verification issues remain. The function's responsibilities span three phases: persisting the final state, verifying the repository's integrity, and recording a summary for the batch run.

`finalizeAgentRun` opens by flipping the run's phase to `"finalizing"` and persisting that state via `persistRunState`; this signals to any observers that the run is being wrapped up, and it ensures the transition is recoverable if the process dies mid-finalization. Next, it triggers a series of housekeeping steps over the repository: `regenerateArchitectureOverview` rebuilds the architecture overview using the topics that have been accepted in `state.acceptedTopicSlugs`, `runLedger` regenerates the ledger quietly, and `runVerify` performs a verification pass over the repo. These steps matter because the finalization output must reflect the actual, current state of the documentation, not just the tasks that ran.

After those regeneration and verification passes, `finalizeAgentRun` needs to know how many tasks actually completed, failed, or remain pending. It calls `taskCounts`, a helper that takes the database and `runId` and returns an object `{ done: number; failed: number; pending: number }`. `taskCounts` queries the `batch_tasks` table for the run, grouping rows by `status` and counting each group; it treats rows with status `"done"` as done, rows with `"failed"` as failed, and rows with either `"pending"` or `"running"` as pending. The function derives the three counts by looking up those statuses in the result set, defaulting any absence to zero.

With those counts in hand, `finalizeAgentRun` decides the terminal `status` string: if any tasks failed (`counts.failed > 0`) or verification flagged issues (`verify.issues.length > 0`), the run is marked `"completed_with_failures"`; otherwise it is `"completed"`. Only when the run is fully clean does the function call `refreshCompletedTaskReceipts` to reconcile the receipts of completed tasks against the repository content that may have been rewritten by the navigation regeneration. After that, it builds a `BatchRunSummary` — the report payload that describes totals, per-stage and per-module breakdowns, and the final task counts — using the `emptySummary` helper.

`emptySummary` takes an options object carrying the module list and the three counts (`done`, `failed`, `pending`) and returns a `BatchRunSummary` instance. It zeroes out the token totals, leaves `costUsd` null, marks the usage as incomplete because no per-task usage aggregation happens at this point, and provides empty `byStage` and `byModule` containers plus the supplied `modulesRefined` entries derived from each module's id, paths, and optional display title. The function hardcodes the `executor` as `"agent"` and attaches the ambient accounting and topic-refine configuration constants, making this summary a canonical, if sparse, record of the run.

`finalizeAgentRun` then persists this summary into the database: it issues an `UPDATE` on the `batch_runs` row for `runId`, setting the terminal `status`, a `finished_at` timestamp from `Date.now()`, the fixed stage value `5`, and JSON-encoded copies of the summary and the full run state. This write is the authoritative close of the run record. Finally, the function computes a new snapshot hash of the repository via `computeSnapshotHash` and rewrites the manifest state so the last documented commit is null and the pending batch is cleared; this leaves the repo in a state ready for the next batch, and the function returns the computed `status`.

Receipt handling itself is the job of `refreshCompletedTaskReceipts`, an `async` function that takes `repoRoot`, the database, and `runId`. It begins by selecting every task row for the run whose status is `"done"`, ordered by id, and reading each into a task object via `readAgentTask`. The comments inside the function explain its intent: the finalize navigation regeneration may have rewrittten pages, so the artifacts that were receipted at task completion need their hashes refreshed — but the baseline is deliberately **not** advanced here. If code drifted after a task completed, that drift must surface as a `changed` artifact in the next diff, never be silently folded into the accepted baseline.

For each done task, `refreshCompletedTaskReceipts` skips those of kind `"file-page"` and otherwise pushes the task's `targetPath` onto a `changedPaths` list. For a `"flow"` task it also pushes the diagram path for the candidate's slug, so the regenerated Mermaid artifact gets re-hashed alongside the page. Once the list is assembled, it hands the collection to `refreshArtifactReceiptHashes`, which recomputes and updates the stored receipt hashes for exactly those paths. The effect is that a completed task's receipt reflects the repository content as of finalization, not as of the moment the task first concluded.

Two small helpers make receipts self-describing. `receiptTaskId` takes a `PersistedAgentTask` and returns a stable, kind-prefixed string identifier for it — `file:` for a file page's `targetPath`, `folder:` for a folder page's target, `flow:` for a candidate's slug, and `topic:` or `understanding:` for evidence hashes. `receiptEvidence` takes the same task shape and returns the payload that constitutes the evidence of that task's result — the file unit for a file page, the folder for a folder page, and the candidate object for flow and topic tasks (with a hash-only envelope for understanding tasks). Together these two functions give any caller a canonical way to name and to substantiate what a completed task produced, which is what makes receipt refresh and later audits possible.

## Owner Preservation and Manual Block Reinstatement
<!-- lw:anchors packages/core/src/agent-bootstrap.ts#readOwner packages/core/src/agent-bootstrap.ts#forceOwner packages/core/src/agent-bootstrap.ts#manualBlocks packages/core/src/agent-bootstrap.ts#injectManualBlocks -->

The `agent-bootstrap.ts` module enforces a strict policy: AI-generated content may never overwrite human-authored sections. When merging new candidate content into an existing wiki page, this mechanism must preserve ownership metadata and reinstate any manual blocks, ensuring the generator never clobbers hand-written contributions.

## The Ownership Contract

```typescript
function readOwner(content: string | null): ExistingOwner {
```

This function accepts a file's raw content or `null` and returns an `ExistingOwner` — a union type representing the page's current ownership status. It handles the absence of content by returning `null` immediately, then normalizes the text by stripping a leading byte-order mark and converting CRLF line endings to LF.

The function then checks whether the content begins with a YAML frontmatter block (`---\n`). If not, it returns `"untrusted"`, signaling that no reliable ownership claim exists. For content with frontmatter, it parses the block and inspects the `owner` field. Only the literal values `"generated"`, `"mixed"`, or `"human"` are accepted as valid; anything else — including a missing field — yields `"untrusted"`. If frontmatter parsing throws an exception, `readOwner` returns `"unparseable"`.

## Enforcing the Desired Owner

```typescript
function forceOwner(content: string, owner: "generated" | "mixed"): string {
```

Given a page's content and a target owner value (restricted to `"generated"` or `"mixed"` — `"human"` pages are never rewritten by the generator), this function rewrites the YAML frontmatter's `owner` field in place. It verifies the content truly starts with frontmatter and locates the closing `\n---` delimiter; if absent, it returns the content untouched.

Inside the frontmatter, it checks whether an `owner:` key already exists using a line-anchored regular expression. If present, the function replaces that line's value with the new owner. If absent, it appends `owner: <value>` to the end of the YAML block. The function then reconstructs the full content by concatenating the opening `---\n`, the modified YAML, and everything after the closing delimiter — preserving all body text byte-for-byte.

## Locating Manual Blocks in Existing Content

Manual blocks are human-authored regions delimited by `` and `` HTML comments. Because these blocks are the exclusive property of human editors, they must be carried over verbatim into any candidate regeneration.

```typescript
function manualBlocks(content: string): PositionedManualBlock[] {
```

This function scans the given content with a global regular expression that matches from an opening `lw:manual` comment through the closing comment, capturing everything in between, including nested markers. For each match, it determines the section heading under which the block resides: it slices the content before the block's start index and finds the most recent Markdown heading (lines matching `^#{1,6}\s+`), then lowercases its text.

Each match becomes a `PositionedManualBlock` object with two fields: `section` — the lowercase heading text that precedes the block (or `null` if none exists) — and `bytes`, the exact raw text of the matched block including its comment delimiters.

## Reinstating Manual Blocks into Candidate Content

The final step merges preserved manual blocks back into freshly generated content, producing a candidate that nevertheless respects the original page's human contributions.

```typescript
function injectManualBlocks(existing: string, candidate: string): string {
```

This function accepts the existing page content and the generator's candidate output. It first extracts the manual blocks from the existing page via `manualBlocks`. If the existing page has no manual blocks, the candidate is returned unchanged — nothing to preserve, no reason to modify.

For pages that do contain manual blocks, the function treats the candidate as a sequence of lines and attempts to relocate each block under its corresponding section heading within the candidate. For each block with a non-null `section`, it scans the candidate lines for a heading whose lowercased text matches the block's recorded section. Once found at line index `start` (recording the heading's level — the count of `#` characters), it scans forward to find the next heading at the same or shallower level; that line index defines the section's end boundary. The function then trims trailing blank lines from the section and splices the block's bytes — prefixed and suffixed by blank lines — just before the section's end, recording the block as successfully inserted.

After processing all blocks, any that could not be placed because their section heading was absent from the candidate are collected as *orphaned* blocks. The function joins the modified lines, collapses runs of four or more newlines down to three, and trims trailing whitespace. If orphans exist, it appends them at the very end of the document, separated by blank lines, appended after any existing content. The result is the candidate page with its human-authored blocks reinstated under their original sections when possible, or preserved at the document's tail when their sections were lost in regeneration.

## Claim Renewal and Submission Endpoints
<!-- lw:anchors packages/core/src/agent-bootstrap.ts#diagnosticAttempt packages/core/src/agent-bootstrap.ts#staleClaimError packages/core/src/agent-bootstrap.ts#renewAgentBootstrapClaim packages/core/src/agent-bootstrap.ts#submitAgentBootstrapTask packages/core/src/agent-bootstrap.ts#usageAttempt -->

The claim lifecycle in `packages/core/src/agent-bootstrap.ts` is enforced through two endpoints: one for renewing a lease on an in-progress task and one for submitting a completed task. Both are gatekeepers that ensure only the current claim holder can act, and both record every attempt so retry budgets are spent deliberately.

## Renewing a lease

`renewAgentBootstrapClaim` is a lightweight, atomic operation that lets an agent that is still actively working on a task extend its lease before it expires. It resolves the repository root to an absolute path, opens the SQLite index database at `.livewiki/index.db`, and issues a conditional `UPDATE` statement:

```ts
export async function renewAgentBootstrapClaim(
  opts: RenewAgentBootstrapClaimOptions,
): Promise<AgentClaimRenewalResult> {
```

This function takes an options object containing the task id, claim id, and repository root, and returns a result indicating whether the renewal succeeded or failed. The update sets a new `lease_expires_at` timestamp (now plus `AGENT_CLAIM_LEASE_MS`) but only for rows that match all the conditions: the task id, the claim id, a status of `running`, and a lease that has not yet expired. If exactly one row was updated, the renewal succeeded and the function returns the new expiry. If zero rows matched — for example, because the lease already lapsed or another executor re-claimed the task — the function returns a failure result whose error is built by `staleClaimError`, informing the caller that the claim is no longer valid and nothing was written.

## Submitting a completed task

`submitAgentBootstrapTask` is the main write path for agent-generated documentation. It performs a strict sequence of checks before any filesystem work, and it routes results (success, validation failure, or write failure) through helper functions that persist attempt records.

```ts
export async function submitAgentBootstrapTask(
  opts: SubmitAgentBootstrapTaskOptions,
): Promise<AgentSubmissionResult> {
```

The function takes an options object that includes the task id, claim id, content, and repository root, and returns a submission result describing whether the task succeeded and what artifacts were written.

After opening the database, the function loads the task row joined with its run, then loads the run status and the agent state from that run. It reads the task and its checkpoint from the row. The claim gate runs **before any filesystem work and before the attempt counter moves** — if the row's claim id does not match the submitted claim id, or the lease has expired, the function returns immediately with a stale-claim error, deliberately not consuming a retry for a task that now belongs to another executor.

Next, the function verifies that the submitted path matches the task's target path, and reads any existing file at that target. If the existing page declares a human owner, untrusted metadata, or is unparseable, the function refuses to overwrite it, records a terminal attempt via `persistAttempt`, and returns with an error. Otherwise, it calls `prepareSubmission` to validate and normalize the content; if validation produces errors, the function persists a failed attempt (terminal if the retry budget is exhausted) and returns those errors. If preparation succeeds, `writeAndVerifySubmission` writes the file; on failure, the function again persists the attempt and returns the write errors, marking the task terminal if rollback itself failed or the attempt limit was reached.

On success, the function assembles the list of written paths (the target page plus any companion artifact), computes SHA-256 hashes for the receipt, calls `commitDocumentationTask` to record the completion, and persists a successful terminal attempt before returning `ok: true`.

## Recording attempt diagnostics

Every submission path ultimately records what happened through one of two helper functions that shape diagnostic data for the attempt ledger. `usageAttempt` constructs a `UsageAttempt` object capturing the attempt number, placeholder usage fields (`usage`, `usageKnown`, `costUsd`), and a `finishedAt` timestamp:

```ts
function usageAttempt(attempt: number): UsageAttempt {
```

The function takes the attempt number and returns a usage record with null usage and cost, marking usage as unknown and stamping the current time. `diagnosticAttempt` builds a `DiagnosticAttempt` from an attempt number, the candidate content, any errors, and a success flag:

```ts
function diagnosticAttempt(
  attempt: number,
  content: string,
  errors: readonly AgentSubmissionError[],
  success: boolean,
): DiagnosticAttempt {
```

The function takes the attempt number, the submitted content, the list of validation errors, and a boolean success indicator, and returns a diagnostic record summarizing the outcome. It normalizes each error into an `ArtifactValidationError` shape (coercing any unrecognized location to `"global"` and preserving optional `sectionSlug` and `offending` fields), then records the prompt kind as `"initial"` for the first attempt and `"repair"` for retries, the content's length, its SHA-256 hash, and a timestamp.

## Reporting an invalid claim

Both endpoints share a single message factory for the stale-claim failure mode. `staleClaimError` produces a structured error object:

```ts
function staleClaimError(taskId: number, detail: string): AgentSubmissionError {
```

The function takes a task id and a human-readable detail string, and returns an error indicating that the claim was lost, that the caller should invoke `livewiki_next_task` to obtain a fresh claim, and that nothing was written to disk.

## Tests

Likely also exercised by `packages/core/src/agent-bootstrap-boundary.test.ts` (name-prefix match, not verified).
Likely also exercised by `packages/core/src/agent-bootstrap-claim.test.ts` (name-prefix match, not verified).
