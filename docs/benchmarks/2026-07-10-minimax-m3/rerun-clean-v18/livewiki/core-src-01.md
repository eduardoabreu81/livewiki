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
  - packages/core/src/artifact.ts#hasRealProse
  - packages/core/src/artifact.ts#lastHeadingBefore
  - packages/core/src/artifact.ts#normalizeStage4Artifact
  - packages/core/src/artifact.ts#slugifyHeading
  - packages/core/src/artifact.ts#validateStage4Artifact
  - packages/core/src/batch-repair.test.ts#ProgrammableMockLlm
  - packages/core/src/batch-repair.test.ts#ProgrammableMockLlm.generate
  - packages/core/src/batch-repair.test.ts#expectJoinedAttempts
  - packages/core/src/batch-repair.test.ts#makeInvalidPage
  - packages/core/src/batch-repair.test.ts#makeValidPage
  - packages/core/src/batch-repair.test.ts#readStage4Checkpoint
  - packages/core/src/batch-review.test.ts#MockLlm
  - packages/core/src/batch-review.test.ts#MockLlm.generate
  - packages/core/src/batch-review.test.ts#executablePlanPaths
  - packages/core/src/batch-review.test.ts#seedFiveFileRepo
  - packages/core/src/batch-review.test.ts#stage2ErrorCode
  - packages/core/src/batch-state.ts#DIAGNOSTIC_MAX_ERRORS
  - packages/core/src/batch-state.ts#DIAGNOSTIC_TEXT_CAP
  - packages/core/src/batch-state.ts#summarizeDiagnosticErrors
  - packages/core/src/batch-status.test.ts#OneModuleMockLlm
  - packages/core/src/batch-status.test.ts#OneModuleMockLlm.generate
  - packages/core/src/batch-status.test.ts#OneShotMockLlm
  - packages/core/src/batch-status.test.ts#OneShotMockLlm.generate
  - packages/core/src/batch-status.test.ts#ValidMockLlm
  - packages/core/src/batch-status.test.ts#ValidMockLlm.generate
  - packages/core/src/batch-status.test.ts#seedLegacyCheckpoint
  - packages/core/src/batch-status.ts#aggregateUsageFromCheckpoint
  - packages/core/src/batch-status.ts#buildStatusReport
  - packages/core/src/batch-status.ts#emptyStageUsage
  - packages/core/src/batch-status.ts#listRuns
  - packages/core/src/batch-status.ts#mergeStageUsage
  - packages/core/src/batch-status.ts#parseRunSummary
  - packages/core/src/batch-status.ts#safeJsonParse
  - packages/core/src/batch.test.ts#MockLlm
  - packages/core/src/batch.test.ts#MockLlm.generate
---

## Anchor ledger tests
<!-- lw:anchors packages/core/src/anchor-ledger.test.ts#nodeSqliteQuery packages/core/src/anchor-ledger.test.ts#writeCode packages/core/src/anchor-ledger.test.ts#writeWiki -->

Helpers used by the `anchor-ledger` test suite. Each test creates an isolated repository, wiki, and SQLite index in a temp dir, runs the indexer, then the ledger, and asserts on the resulting debt.

- `writeCode(rel, content)` writes a source file under the test repo root, creating intermediate directories.
- `writeWiki(rel, content)` writes a markdown page under the test repo root, creating intermediate directories.
- `nodeSqliteQuery(repoRoot, sql)` runs a `SELECT` against `.livewiki/index.db` and returns an array of row records.

## Anchor ledger core
<!-- lw:anchors packages/core/src/anchor-ledger.ts#AnchorParseError packages/core/src/anchor-ledger.ts#AnchorParseError.constructor packages/core/src/anchor-ledger.ts#assigneeFor packages/core/src/anchor-ledger.ts#collectWikiPages packages/core/src/anchor-ledger.ts#createDebt packages/core/src/anchor-ledger.ts#detectMoves packages/core/src/anchor-ledger.ts#escapeRegex packages/core/src/anchor-ledger.ts#hasOpenDebt packages/core/src/anchor-ledger.ts#hashContent packages/core/src/anchor-ledger.ts#orchestrate packages/core/src/anchor-ledger.ts#rewriteSymbolKeyInPage packages/core/src/anchor-ledger.ts#run packages/core/src/anchor-ledger.ts#upsertAnchor packages/core/src/anchor-ledger.ts#upsertDocPage packages/core/src/anchor-ledger.ts#upsertUndocumented -->

The ledger synchronizes wiki anchors with the code index and emits `changed` / `moved` / `deleted` debt. Per rule #3, when a symbol is detected as moved, the corresponding anchor is rewritten in the markdown (frontmatter and section markers) via safe-io; per rule #6, anchors inside manual blocks or in pages with `owner: human` are never rewritten and only generate debt assigned to the human.

- `run(repoRoot, opts)` is the public entry point. It ensures `.livewiki/` exists, opens the SQLite index, delegates to `orchestrate`, and closes the DB.
- `orchestrate(db, absRoot, opts)` walks every wiki page, upserts `doc_pages` and `anchors`, and diffs against previous state to emit debt rows.
- `AnchorParseError` is raised when anchor extraction fails for a page; the constructor wraps the wiki path and the original cause.
- `hashContent(content)` computes the content hash used to detect changes between runs.
- `upsertDocPage`, `upsertAnchor`, `upsertUndocumented` persist the per-run state of doc pages, anchors, and undocumented symbols.
- `createDebt` and `hasOpenDebt` manage rows in the `debt` table.
- `detectMoves` performs content-hash primary detection with a name+signature fallback.
- `collectWikiPages(absRoot)` enumerates `.md` files under the wiki root.
- `rewriteSymbolKeyInPage` updates anchor keys in markdown, respecting owner/manual-block protections.
- `assigneeFor(owner, inManualBlock)` returns `"agent"` or `"human"` per rule #6.
- `escapeRegex(s)` escapes regex metacharacters for safe pattern construction.

## Anchor extraction
<!-- lw:anchors packages/core/src/anchors.ts#extractAnchors packages/core/src/anchors.ts#isInsideAny packages/core/src/anchors.ts#slugify -->

Parses frontmatter and section anchors from a wiki markdown page.

- `extractAnchors(source)` returns page anchors (frontmatter), section anchors (marker comments), manual-block ranges, the parsed frontmatter, the declared owner, and the body. Manual blocks are detected by start/end markers; nested starts without ends are ignored silently.
- `isInsideAny(start, end, blocks)` checks whether a byte range falls inside any manual block.
- `slugify(heading)` produces the slug used for `section_slug` and matches the slug used by `artifact.ts`.

## Stage 4 artifact
<!-- lw:anchors packages/core/src/artifact.ts#err packages/core/src/artifact.ts#hasRealProse packages/core/src/artifact.ts#lastHeadingBefore packages/core/src/artifact.ts#normalizeStage4Artifact packages/core/src/artifact.ts#slugifyHeading packages/core/src/artifact.ts#validateStage4Artifact -->

Normalization and validation of the stage 4 markdown artifact.

- `normalizeStage4Artifact(raw)` strips one leading `<think>…` block, rejects unclosed reasoning blocks, rejects reasoning-only output, and unwraps one outer ` ```markdown ` or ` ```md ` fence. It does not attempt to rescue markdown inside an incomplete reasoning block.
- `validateStage4Artifact(artifact, closedKeyList)` enforces the stage-4 contract: explicit `owner: generated`, frontmatter `anchors:` present when the closed list is non-empty, every key in frontmatter and in section markers present in the closed list, both lists independently complete, no duplicate keys, every marked section followed by real prose, fully closed markdown (no unclosed fences or code spans), no banned `TODO`/`TBD` outside fenced examples or manual blocks, non-empty body, and rejection of any `lw:manual` block in the body.
- `err(code, message, location)` constructs a structured `ArtifactValidationError`.
- `hasRealProse(text)` checks for non-empty, non-whitespace-only, non-marker-only text.
- `lastHeadingBefore(body, offset)` returns the preceding heading for marker association.
- `slugifyHeading(text)` produces a slug compatible with `anchors.ts#slugify`.

## Batch repair tests
<!-- lw:anchors packages/core/src/batch-repair.test.ts#ProgrammableMockLlm packages/core/src/batch-repair.test.ts#ProgrammableMockLlm.generate packages/core/src/batch-repair.test.ts#expectJoinedAttempts packages/core/src/batch-repair.test.ts#makeInvalidPage packages/core/src/batch-repair.test.ts#makeValidPage packages/core/src/batch-repair.test.ts#readStage4Checkpoint -->

Helpers and the programmable mock used by the batch repair suite.

- `ProgrammableMockLlm` is an `LlmClient` that consumes a queue of scripted responses or throws on configured call indices; its `generate(req)` returns the next response with usage, optional stop reason, and raw stop reason.
- `ProgrammableMockLlm.generate` implements `LlmClient.generate` and pulls from `responses` / `stopReasons` / `rawStopReasons`, throwing on `throwOn` indices.
- `makeValidPage(closedKeyList)` builds a markdown page with frontmatter `anchors:` covering every key.
- `makeInvalidPage(uniqueText)` builds a syntactically invalid page used to drive repair flows.
- `readStage4Checkpoint(root, target)` reads `batch_tasks.checkpoint_json` for a given stage-4 target.
- `expectJoinedAttempts(checkpoint)` asserts the 1:1 invariant between `usageHistory` and `diagnosticHistory`.

## Batch review tests
<!-- lw:anchors packages/core/src/batch-review.test.ts#MockLlm packages/core/src/batch-review.test.ts#MockLlm.generate packages/core/src/batch-review.test.ts#executablePlanPaths packages/core/src/batch-review.test.ts#seedFiveFileRepo packages/core/src/batch-review.test.ts#stage2ErrorCode -->

Helpers and mock used by the reviewer-finding regression suite.

- `MockLlm` is an `LlmClient` that generates a valid page from the closed keys extracted from the prompt.
- `MockLlm.generate` consumes `responses` or synthesizes content from the prompt's key list, recording usage.
- `seedFiveFileRepo` materializes a small repository used to assert unique-module-ID behavior across stage 4.
- `stage2ErrorCode` returns the configured error code for stage-2 failure scenarios.
- `executablePlanPaths` enumerates plan artifact paths used in retry-command assertions.

## Batch state
<!-- lw:anchors packages/core/src/batch-state.ts#DIAGNOSTIC_MAX_ERRORS packages/core/src/batch-state.ts#DIAGNOSTIC_TEXT_CAP packages/core/src/batch-state.ts#summarizeDiagnosticErrors -->

Constants and helpers for the checkpoint diagnostics surface.

- `DIAGNOSTIC_TEXT_CAP` is the per-field character cap applied to diagnostic summaries.
- `DIAGNOSTIC_MAX_ERRORS` caps the number of structured error entries persisted per diagnostic attempt.
- `summarizeDiagnosticErrors(input)` truncates each error's `message` and `offending` text to `DIAGNOSTIC_TEXT_CAP` and slices the array to `DIAGNOSTIC_MAX_ERRORS`, returning the drop count.

## Batch status tests
<!-- lw:anchors packages/core/src/batch-status.test.ts#OneModuleMockLlm packages/core/src/batch-status.test.ts#OneModuleMockLlm.generate packages/core/src/batch-status.test.ts#OneShotMockLlm packages/core/src/batch-status.test.ts#OneShotMockLlm.generate packages/core/src/batch-status.test.ts#ValidMockLlm packages/core/src/batch-status.test.ts#ValidMockLlm.generate packages/core/src/batch-status.test.ts#seedLegacyCheckpoint -->

Mock LLMs and seed helpers for the status reporting suite.

- `OneShotMockLlm` throws on `generate`; used by tests that seed the DB directly and never invoke the LLM.
- `OneShotMockLlm.generate` is the throwing implementation.
- `ValidMockLlm` returns a successful response used by post-Lot-A shape tests.
- `ValidMockLlm.generate` returns the canned `GenerateResult`.
- `OneModuleMockLlm` is an additional `LlmClient` variant used by status tests; its `generate` returns the canned result.
- `OneModuleMockLlm.generate` implements the canned-response path.
- `seedLegacyCheckpoint` writes a pre-Lot-A checkpoint (no `diagnosticHistory`) directly into `batch_tasks` and returns the inserted `runId`.

## Batch status
<!-- lw:anchors packages/core/src/batch-status.ts#aggregateUsageFromCheckpoint packages/core/src/batch-status.ts#buildStatusReport packages/core/src/batch-status.ts#emptyStageUsage packages/core/src/batch-status.ts#listRuns packages/core/src/batch-status.ts#mergeStageUsage packages/core/src/batch-status.ts#parseRunSummary packages/core/src/batch-status.ts#safeJsonParse -->

Aggregates `batch_runs` and `batch_tasks` into the `BatchStatusReport` consumed by the CLI.

- `buildStatusReport(repoRoot, runId)` resolves a run (latest when `runId` is null), loads its tasks, computes totals, per-stage usage, per-module usage, per-task reports, and failures; tolerates a missing or invalid `summary_json`.
- `listRuns(repoRoot)` returns a summary list of all runs.
- `aggregateUsageFromCheckpoint(cp)` folds a checkpoint's `usageHistory` into a single `StageUsage`, preserving the `usageIncomplete` flag.
- `mergeStageUsage(a, b)` adds two `StageUsage` values, propagating `null` cost and the incomplete flag.
- `emptyStageUsage()` returns a zeroed `StageUsage`.
- `safeJsonParse(s)` parses JSON text and returns `null` on failure.
- `parseRunSummary(raw)` decodes `summary_json`, returning `null` when absent or invalid.

## Batch tests
<!-- lw:anchors packages/core/src/batch.test.ts#MockLlm packages/core/src/batch.test.ts#MockLlm.generate -->

The `MockLlm` used by the orchestrator end-to-end tests. Its `generate` extracts the module id and the first canonical key from the prompt and returns a valid markdown page that references that key, with usage reported as 100 input / 50 output tokens.
