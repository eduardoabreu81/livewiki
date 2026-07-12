---
title: core-src-01
owner: generated
anchors:
  - packages/core/src/anchor-ledger.test.ts#nodeSqliteQuery
  - packages/core/src/anchor-ledger.test.ts#writeCode
  - packages/core/src/anchor-ledger.test.ts#writeWiki
  - packages/core/src/anchor-ledger.ts#AnchorParseError
  - packages/core/src/anchor-ledger.ts#AnchorParseError.constructor
  - packages/core/src/anchor-ledger.ts#assigneeFor
  - packages/core/src/anchor-ledger.ts#collectWikiPages
  - packages/core/src/anchor-ledger.ts#createDebt
  - packages/core/src/anchor-ledger.ts#detectMoves
  - packages/core/src/anchor-ledger.ts#escapeRegex
  - packages/core/src/anchor-ledger.ts#hasOpenDebt
  - packages/core/src/anchor-ledger.ts#hashContent
  - packages/core/src/anchor-ledger.ts#orchestrate
  - packages/core/src/anchor-ledger.ts#rewriteSymbolKeyInPage
  - packages/core/src/anchor-ledger.ts#run
  - packages/core/src/anchor-ledger.ts#upsertAnchor
  - packages/core/src/anchor-ledger.ts#upsertDocPage
  - packages/core/src/anchor-ledger.ts#upsertUndocumented
  - packages/core/src/anchors.ts#extractAnchors
  - packages/core/src/anchors.ts#isInsideAny
  - packages/core/src/anchors.ts#slugify
  - packages/core/src/artifact.ts#err
  - packages/core/src/artifact.ts#lastHeadingBefore
  - packages/core/src/artifact.ts#normalizeStage4Artifact
  - packages/core/src/artifact.ts#slugifyHeading
  - packages/core/src/artifact.ts#validateStage4Artifact
  - packages/core/src/batch-repair.test.ts#ProgrammableMockLlm
  - packages/core/src/batch-repair.test.ts#ProgrammableMockLlm.generate
  - packages/core/src/batch-repair.test.ts#makeValidPage
  - packages/core/src/batch-review.test.ts#MockLlm
  - packages/core/src/batch-review.test.ts#MockLlm.generate
  - packages/core/src/batch-review.test.ts#executablePlanPaths
  - packages/core/src/batch-review.test.ts#seedFiveFileRepo
  - packages/core/src/batch-review.test.ts#stage2ErrorCode
  - packages/core/src/batch-status.ts#aggregateUsageFromCheckpoint
  - packages/core/src/batch-status.ts#buildStatusReport
  - packages/core/src/batch-status.ts#emptyStageUsage
  - packages/core/src/batch-status.ts#listRuns
  - packages/core/src/batch-status.ts#mergeStageUsage
  - packages/core/src/batch-status.ts#parseRunSummary
  - packages/core/src/batch-status.ts#safeJsonParse
  - packages/core/src/batch.test.ts#MockLlm
  - packages/core/src/batch.test.ts#MockLlm.generate
  - packages/core/src/batch.ts#EmptyPipelineError
  - packages/core/src/batch.ts#EmptyPipelineError.constructor
  - packages/core/src/batch.ts#TaskError
  - packages/core/src/batch.ts#TaskError.constructor
  - packages/core/src/batch.ts#accumulateUsage
  - packages/core/src/batch.ts#aggregateTotals
  - packages/core/src/batch.ts#attemptStage4Generation
  - packages/core/src/batch.ts#buildFairTruncatedSource
  - packages/core/src/batch.ts#buildModuleDocContext
  - packages/core/src/batch.ts#buildResult
  - packages/core/src/batch.ts#collectAllImports
  - packages/core/src/batch.ts#computeCostFromUsage
  - packages/core/src/batch.ts#createOrGetTask
  - packages/core/src/batch.ts#emptyUsage
  - packages/core/src/batch.ts#extractManualBlocksBySection
  - packages/core/src/batch.ts#finalizeRun
  - packages/core/src/batch.ts#forceOwnerInFrontmatter
  - packages/core/src/batch.ts#getFileIdsForModule
  - packages/core/src/batch.ts#getOrCreateTask
  - packages/core/src/batch.ts#injectManualBlocksBySection
  - packages/core/src/batch.ts#orchestrate
  - packages/core/src/batch.ts#readOwnerFromFrontmatter
  - packages/core/src/batch.ts#resumeBatch
  - packages/core/src/batch.ts#runBatch
  - packages/core/src/batch.ts#runOnly
  - packages/core/src/batch.ts#safeJsonParse
  - packages/core/src/batch.ts#sectionRangeOf
  - packages/core/src/batch.ts#slugifyHeadingText
  - packages/core/src/batch.ts#statusToExitCode
  - packages/core/src/batch.ts#tryWriteAndVerify
  - packages/core/src/batch.ts#validateRefinedModules
  - packages/core/src/batch.ts#verifyIssuesToValidationErrors
---

## anchor-ledger.test.ts helpers
<!-- lw:anchors packages/core/src/anchor-ledger.test.ts#writeCode packages/core/src/anchor-ledger.test.ts#writeWiki packages/core/src/anchor-ledger.test.ts#nodeSqliteQuery -->

Test-side helpers for the ledger suite. Each test creates an isolated repo, wiki, and SQLite DB in a temp dir, runs the indexer, then the ledger.

- `writeCode` writes a source file under the test repo root.
- `writeWiki` writes a markdown page under the test repo root.
- `nodeSqliteQuery` executes a SQL string against the repo's `.livewiki/index.db` and returns rows as plain records.

## anchor-ledger.ts public API
<!-- lw:anchors packages/core/src/anchor-ledger.ts#run packages/core/src/anchor-ledger.ts#AnchorParseError packages/core/src/anchor-ledger.ts#AnchorParseError.constructor -->

The ledger's entry point and error type.

- `run` opens `.livewiki/index.db`, ensures the cache directory exists, and delegates to `orchestrate` before closing the DB. Returns a `LedgerResult` with page counts, anchor counts, debt counts per event, undocumented symbol count, and moved pairs.
- `AnchorParseError` is thrown when a wiki page cannot be parsed for anchors.
- `AnchorParseError.constructor` builds the message from `wikiPath` and the underlying cause.

## anchor-ledger.ts orchestration internals
<!-- lw:anchors packages/core/src/anchor-ledger.ts#orchestrate packages/core/src/anchor-ledger.ts#collectWikiPages packages/core/src/anchor-ledger.ts#upsertDocPage packages/core/src/anchor-ledger.ts#upsertAnchor packages/core/src/anchor-ledger.ts#createDebt packages/core/src/anchor-ledger.ts#hasOpenDebt packages/core/src/anchor-ledger.ts#detectMoves packages/core/src/anchor-ledger.ts#upsertUndocumented packages/core/src/anchor-ledger.ts#hashContent packages/core/src/anchor-ledger.ts#rewriteSymbolKeyInPage packages/core/src/anchor-ledger.ts#escapeRegex packages/core/src/anchor-ledger.ts#assigneeFor -->

Core ledger pipeline.

- `orchestrate` loads existing `doc_pages`, `anchors`, and `symbols` (active and deleted) from the DB, then walks every wiki page: parses anchors, upserts doc pages, upserts page and section anchors, and emits debt rows.
- `collectWikiPages` enumerates `.md` files under `livewiki/` (relative paths).
- `upsertDocPage` inserts/updates a `doc_pages` row keyed by `wiki_path`.
- `upsertAnchor` inserts/updates an `anchors` row keyed by `(doc_page_id, section_slug)`.
- `createDebt` writes a row to the `debt` table.
- `hasOpenDebt` checks whether an open debt row exists for a given anchor/symbol.
- `detectMoves` matches deleted symbols to active ones by `content_hash` (primary) or name+signature (fallback) to detect `moved` events.
- `upsertUndocumented` records symbols with no anchor coverage.
- `hashContent` computes the content hash used for change detection.
- `rewriteSymbolKeyInPage` updates the `symbol_key` of an anchor in the markdown source via safe-io, except inside manual blocks or human-owned pages.
- `escapeRegex` escapes regex metacharacters for safe literal matching.
- `assigneeFor` maps `(owner, inManualBlock)` to `agent` or `human` (mixed pages resolve to `agent`).

## anchors.ts — frontmatter and section anchor extraction
<!-- lw:anchors packages/core/src/anchors.ts#extractAnchors packages/core/src/anchors.ts#slugify packages/core/src/anchors.ts#isInsideAny -->

Parses a wiki page into page anchors (frontmatter list) and section anchors (marker-comments).

- `extractAnchors` returns `{ pageAnchors, sectionAnchors, manualBlocks, frontmatter, owner, body }`. Section anchors are associated with the most recent preceding heading; each anchor records whether it falls inside a manual block.
- `slugify` lowercases, strips diacritics, removes punctuation, and joins words with hyphens.
- `isInsideAny` returns true if `[start, end)` intersects any manual block range.

## artifact.ts — stage 4 normalization and validation
<!-- lw:anchors packages/core/src/artifact.ts#normalizeStage4Artifact packages/core/src/artifact.ts#validateStage4Artifact packages/core/src/artifact.ts#err packages/core/src/artifact.ts#slugifyHeading packages/core/src/artifact.ts#lastHeadingBefore -->

Stage 4 takes a normalized artifact, not the raw transcript.

- `normalizeStage4Artifact` strips a single leading `<think>…` block, rejects unclosed reasoning or reasoning-only output, and unwraps one outer `markdown`/`md` fence. Returns `{ ok, content, errors }`.
- `validateStage4Artifact` requires valid frontmatter with `owner: generated` explicit, requires `anchors:` when the closed list is non-empty, requires every key to be in the closed list, requires completeness (union of frontmatter + section markers covers every closed-list key), forbids duplicates, requires a non-empty body, and rejects any `lw:manual` block in the body (rule #6).
- `err` constructs a structured `ArtifactValidationError`.
- `slugifyHeading` produces a URL-safe slug from a heading.
- `lastHeadingBefore` finds the last heading preceding a given offset (used to associate markers with sections).

## batch-repair.test.ts mocks and helpers
<!-- lw:anchors packages/core/src/batch-repair.test.ts#ProgrammableMockLlm packages/core/src/batch-repair.test.ts#ProgrammableMockLlm.generate packages/core/src/batch-repair.test.ts#makeValidPage -->

Programmable LLM mock for the repair suite.

- `ProgrammableMockLlm` queues responses per call index, optionally throws on selected call indices, records prompts in `callLog`, and can auto-build a valid page from the closed key list extracted from the prompt.
- `ProgrammableMockLlm.generate` returns the next queued response or, if `autoPageFromPrompt` is true, generates a page from the prompt's closed keys.
- `makeValidPage` builds a syntactically valid Markdown page whose frontmatter lists every key in `closedKeyList`.

## batch-review.test.ts mocks and helpers
<!-- lw:anchors packages/core/src/batch-review.test.ts#MockLlm packages/core/src/batch-review.test.ts#MockLlm.generate packages/core/src/batch-review.test.ts#seedFiveFileRepo packages/core/src/batch-review.test.ts#stage2ErrorCode packages/core/src/batch-review.test.ts#executablePlanPaths -->

Programmable mock and repo seeders for the review-finding regression suite.

- `MockLlm` returns the next queued response or, when the queue is empty, builds a valid page from the closed keys in the prompt.
- `MockLlm.generate` returns the response and records usage.
- `seedFiveFileRepo` creates a 5-file repo fixture.
- `stage2ErrorCode` returns the stage 2 error code recorded for the current run, if any.
- `executablePlanPaths` returns the paths of plans flagged as executable.

## batch-status.ts — run and task reporting
<!-- lw:anchors packages/core/src/batch-status.ts#buildStatusReport packages/core/src/batch-status.ts#listRuns packages/core/src/batch-status.ts#emptyStageUsage packages/core/src/batch-status.ts#aggregateUsageFromCheckpoint packages/core/src/batch-status.ts#mergeStageUsage packages/core/src/batch-status.ts#parseRunSummary packages/core/src/batch-status.ts#safeJsonParse -->

Aggregates `batch_runs` and `batch_tasks` into a `BatchStatusReport`.

- `buildStatusReport` resolves a run (by id or latest), loads its tasks, aggregates usage per stage and per module (stage 4 only), and assembles task and failure report items with retry commands.
- `listRuns` returns summaries of all runs, newest first.
- `emptyStageUsage` returns a zeroed `StageUsage` with `costUsd: null` and no models.
- `aggregateUsageFromCheckpoint` sums usage across `usageHistory` of a checkpoint, propagating `usageIncomplete`.
- `mergeStageUsage` combines two `StageUsage` values.
- `parseRunSummary` parses the run's `summary_json` tolerantly.
- `safeJsonParse` returns parsed JSON or `null` on failure.

## batch.test.ts mocks
<!-- lw:anchors packages/core/src/batch.test.ts#MockLlm packages/core/src/batch.test.ts#MockLlm.generate -->

Mock LLM used by the main batch suite.

- `MockLlm` extracts the module id and first closed key from the user prompt and returns a valid markdown page referencing that key.
- `MockLlm.generate` increments `callCount` and returns the generated page with fixed token usage.

## batch.ts — public entry points and error types
<!-- lw:anchors packages/core/src/batch.ts#runBatch packages/core/src/batch.ts#resumeBatch packages/core/src/batch.ts#runOnly packages/core/src/batch.ts#orchestrate packages/core/src/batch.ts#EmptyPipelineError packages/core/src/batch.ts#EmptyPipelineError.constructor packages/core/src/batch.ts#TaskError packages/core/src/batch.ts#TaskError.constructor packages/core/src/batch.ts#statusToExitCode -->

The public pipeline surface.

- `runBatch` runs the full pipeline from scratch.
- `resumeBatch` resumes an interrupted run (continues pending/failed tasks).
- `runOnly` re-runs a single task (`onlyTarget` required), incrementing `attempt` and appending usage.
- `orchestrate` is the shared internal pipeline that dispatches by `mode` (`run` / `resume` / `only`), wires the indexer, ledger, modules, and stage 4 prompts, applies the circuit breaker policy (3 consecutive failures or >50% failure rate), and returns the run result.
- `EmptyPipelineError` is raised when the pipeline produces no work.
- `EmptyPipelineError.constructor` builds the message.
- `TaskError` carries a structured `{ code, message }` for task failures.
- `TaskError.constructor` initializes the error.
- `statusToExitCode` maps a run status to a process exit code (non-zero on `completed_with_failures` or `aborted`).

## batch.ts — usage accounting
<!-- lw:anchors packages/core/src/batch.ts#emptyUsage packages/core/src/batch.ts#aggregateTotals packages/core/src/batch.ts#accumulateUsage packages/core/src/batch.ts#computeCostFromUsage packages/core/src/batch.ts#safeJsonParse -->

Usage primitives.

- `emptyUsage` returns a zeroed per-task usage record.
- `aggregateTotals` combines two usage records.
- `accumulateUsage` appends an attempt's usage to a checkpoint's `usageHistory`.
- `computeCostFromUsage` computes the USD cost of a single usage attempt via the pricing module.
- `safeJsonParse` returns parsed JSON or `null` on failure.

## batch.ts — task creation and module context
<!-- lw:anchors packages/core/src/batch.ts#getOrCreateTask packages/core/src/batch.ts#createOrGetTask packages/core/src/batch.ts#validateRefinedModules packages/core/src/batch.ts#collectAllImports packages/core/src/batch.ts#getFileIdsForModule packages/core/src/batch.ts#buildModuleDocContext packages/core/src/batch.ts#buildFairTruncatedSource packages/core/src/batch.ts#attemptStage4Generation -->

Module grouping and stage 4 invocation.

- `getOrCreateTask` returns an existing task row or inserts a new one.
- `createOrGetTask` is an alias-style variant with the same idempotent semantics.
- `validateRefinedModules` enforces structural invariants on the modules produced by stage 2.
- `collectAllImports` gathers imports across the module's files.
- `getFileIdsForModule` resolves file ids from the index for a `Module`.
- `buildModuleDocContext` assembles the context block (truncated source + imports) sent to the LLM in stage 4.
- `buildFairTruncatedSource` truncates each file fairly within the `contextCharBudget`.
- `attemptStage4Generation` runs one stage 4 attempt (normalize → validate → optional repair loop) and returns the candidate artifact plus usage.

## batch.ts — frontmatter and manual-block handling
<!-- lw:anchors packages/core/src/batch.ts#readOwnerFromFrontmatter packages/core/src/batch.ts#forceOwnerInFrontmatter packages/core/src/batch.ts#extractManualBlocksBySection packages/core/src/batch.ts#slugifyHeadingText packages/core/src/batch.ts#sectionRangeOf packages/core/src/batch.ts#injectManualBlocksBySection packages/core/src/batch.ts#tryWriteAndVerify packages/core/src/batch.ts#verifyIssuesToValidationErrors packages/core/src/batch.ts#finalizeRun packages/core/src/batch.ts#buildResult -->

Transactional write and rule #6 protections.

- `readOwnerFromFrontmatter` parses the existing page's frontmatter and returns an owner pre-check.
- `forceOwnerInFrontmatter` rewrites the `owner:` line to `generated` or `mixed` (used to preserve the `mixed` signal before write/verify).
- `extractManualBlocksBySection` returns manual blocks grouped by their containing section (heading slug or `null`).
- `slugifyHeadingText` produces a section slug from a heading.
- `sectionRangeOf` computes the byte range covered by a section.
- `injectManualBlocksBySection` reinserts preserved manual blocks into the new content section-by-section (byte-identical), returning `null` if the new content lacks the expected sections.
- `tryWriteAndVerify` performs the transactional write: snapshot → write → verify; on verify failure it restores the previous page and removes the candidate.
- `verifyIssuesToValidationErrors` converts `VerifyIssue`s to `ArtifactValidationError`s for the repair prompt.
- `finalizeRun` writes the batch run summary and closes out the run record.
- `buildResult` constructs the `BatchRunResult` returned to the CLI.