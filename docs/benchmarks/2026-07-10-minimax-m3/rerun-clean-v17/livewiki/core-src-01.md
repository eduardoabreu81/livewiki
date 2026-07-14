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

## anchor-ledger test helpers
<!-- lw:anchors packages/core/src/anchor-ledger.test.ts#nodeSqliteQuery packages/core/src/anchor-ledger.test.ts#writeCode packages/core/src/anchor-ledger.test.ts#writeWiki -->

The `anchor-ledger.test.ts` module sets up isolated, per-test repositories and wiki trees in `mkdtemp` so the indexer and the ledger can run against a clean slate. `writeCode(rel, content)` materializes an indexable source file inside the temp repo, and `writeWiki(rel, content)` materializes a wiki page at the matching relative path. The two helpers share their directory-creation logic and differ only in the semantic role of the file they create. `nodeSqliteQuery(repoRoot, sql)` opens the ledger's index DB read-only and executes a SQL statement, returning the rows as `Record<string, unknown>` for assertions such as verifying that a debt row with event `changed` and assignee `agent` is present after editing an anchored function.

## anchor-ledger error type
<!-- lw:anchors packages/core/src/anchor-ledger.ts#AnchorParseError packages/core/src/anchor-ledger.ts#AnchorParseError.constructor -->

`AnchorParseError` is exported from `anchor-ledger.ts` and extends `Error`. Its `constructor(wikiPath, cause)` composes a message of the form `Falha ao parsear âncoras em <wikiPath>: <cause.message>` and assigns `name = "AnchorParseError"`. The error type signals failures from the anchor-extraction step in the ledger so the orchestrator can surface a per-page parse error without conflating it with I/O errors.

## anchor-ledger orchestration
<!-- lw:anchors packages/core/src/anchor-ledger.ts#run packages/core/src/anchor-ledger.ts#orchestrate packages/core/src/anchor-ledger.ts#collectWikiPages packages/core/src/anchor-ledger.ts#hashContent -->

`run(repoRoot, opts)` is the public entry point. It resolves the repo path, ensures `.livewiki/` exists via `safeIo.mkdir`, opens the index DB at the validated `.livewiki/index.db` path, delegates the actual work to `orchestrate`, and guarantees `db.close()` in a `finally`. `orchestrate(db, absRoot, opts)` accumulates a `LedgerResult` (pages processed/skipped, anchors upserted, debt totals by event, undocumented symbol count, and moved pairs) and walks the pages collected by `collectWikiPages(absRoot)`. For each page it reads the source, calls `extractAnchors`, upserts the page row, then walks the page anchors and section anchors. `hashContent(content)` produces the content hash used to detect page-level changes.

## anchor-ledger DB upserts
<!-- lw:anchors packages/core/src/anchor-ledger.ts#upsertDocPage packages/core/src/anchor-ledger.ts#upsertAnchor packages/core/src/anchor-ledger.ts#upsertUndocumented packages/core/src/anchor-ledger.ts#createDebt packages/core/src/anchor-ledger.ts#hasOpenDebt -->

`upsertDocPage`, `upsertAnchor`, `upsertUndocumented`, `createDebt`, and `hasOpenDebt` are the DB-facing helpers inside the ledger. They keep the `doc_pages`, `anchors`, and `debt` tables in sync with the current wiki state and remember prior state so diff decisions (changed/moved/deleted) can be made deterministically. `hasOpenDebt` is the gate the ledger uses to avoid emitting duplicate debt rows for the same `(symbol_key, event)` pair across reruns.

## anchor-ledger move detection
<!-- lw:anchors packages/core/src/anchor-ledger.ts#detectMoves packages/core/src/anchor-ledger.ts#rewriteSymbolKeyInPage packages/core/src/anchor-ledger.ts#assigneeFor packages/core/src/anchor-ledger.ts#escapeRegex -->

`detectMoves` matches orphaned anchors (whose symbol_key no longer exists in `active` symbols) against rows in `symbols` with `status='deleted'` using `content_hash` first, then a name+signature fallback. `rewriteSymbolKeyInPage` updates the markdown source in place (frontmatter list and section anchor markers) so the markdown, not just the DB, reflects the new symbol key — honouring rule #6 which exempts `owner: human` pages and anything inside manual-block ranges. `assigneeFor(owner, inManualBlock)` maps a page's `Owner` plus an `inManualBlock` flag to `"agent"` (generated wins on mixed), `"human"` (human owner), or `"human"` (manual-block protection overrides owner). `escapeRegex(s)` escapes metacharacters so the rewriter can find literal symbol keys without regex surprises.

## anchors frontmatter and section markers
<!-- lw:anchors packages/core/src/anchors.ts#extractAnchors packages/core/src/anchors.ts#slugify packages/core/src/anchors.ts#isInsideAny -->

`extractAnchors(source)` parses a wiki page: it reads frontmatter (page anchors), walks the section anchor markers and associates each with the most recent preceding heading, and tracks the start/end ranges of manual blocks. It returns `pageAnchors`, `sectionAnchors` (each with `sectionSlug`, `headingText`, `symbolKeys`, `anchorMarkerOffset`, `inManualBlock`), `manualBlocks`, the parsed `frontmatter`, `owner`, and the `body`. `slugify(heading)` produces a deterministic section slug from the heading text (the same one downstream consumers expect). `isInsideAny(start, end, blocks)` answers whether a byte range overlaps any manual block — the predicate `inManualBlock` is built from this.

## stage-4 artifact normalization
<!-- lw:anchors packages/core/src/artifact.ts#normalizeStage4Artifact packages/core/src/artifact.ts#err -->

`normalizeStage4Artifact(raw)` strips BOM, normalizes CRLF to LF, removes exactly one leading `<think>…</think>` block, rejects an `<think>` left open at the start, and unwraps one outer `markdown` / `md` fence. It returns `{ ok, content, errors }`; if any precondition fails it returns `ok: false` with structured errors built via `err(code, message, location)` so the repair prompt can act on them. Crucially it never tries to "rescue" markdown inside an incomplete reasoning block.

## stage-4 artifact validation
<!-- lw:anchors packages/core/src/artifact.ts#validateStage4Artifact packages/core/src/artifact.ts#slugifyHeading packages/core/src/artifact.ts#hasRealProse packages/core/src/artifact.ts#lastHeadingBefore -->

`validateStage4Artifact(artifact, closedKeyList)` enforces the contract: valid frontmatter (with explicit `owner: generated`), an `anchors:` list matching `closedKeyList` (frontmatter ALONE and section markers ALONE must each cover the closed list — completeness is two independent requirements), no duplicate keys, a real prose section after every section anchor marker (presence of an anchor ≠ a documented section), fully closed Markdown (no unopened/untrialing fenced blocks or inline code spans), and manual blocks rejected in generated artifacts. `slugifyHeading(text)` produces the heading slug the validator maps to a section. `hasRealProse(text)` decides whether the prose under each section marker is actual content (not blank, not just a placeholder). `lastHeadingBefore(...)` resolves the section a given byte range belongs to.

## batch-repair mocks and helpers
<!-- lw:anchors packages/core/src/batch-repair.test.ts#ProgrammableMockLlm packages/core/src/batch-repair.test.ts#ProgrammableMockLlm.generate packages/core/src/batch-repair.test.ts#makeValidPage packages/core/src/batch-repair.test.ts#makeInvalidPage packages/core/src/batch-repair.test.ts#readStage4Checkpoint packages/core/src/batch-repair.test.ts#expectJoinedAttempts -->

`ProgrammableMockLlm` implements `LlmClient` with a response queue (`responses[]`, `stopReasons[]`, `rawStopReasons[]`), an optional `throwOn` set to inject simulated failures, a `callLog` for asserting prompt shape, and an `autoPageFromPrompt` flag that auto-generates a valid page from the closed key list parsed out of the user prompt. Its `generate(req)` consumes the next queued response (extracting closed keys from `- …` lines in the prompt), increments `callCount`, and returns a `GenerateResult`. `makeValidPage(closedKeyList)` produces a minimal valid artifact whose anchors list exactly matches the supplied keys; `makeInvalidPage(uniqueText)` produces a deliberately malformed body. `readStage4Checkpoint(root, target)` opens the index DB read-only and returns the deserialized `TaskCheckpoint` for `(stage=4, target)`. `expectJoinedAttempts(checkpoint)` asserts the `diagnosticHistory` length equals `usageHistory` length and that the `attempt` values line up 1:1 between the two histories (the invariant reviewers watch).

## batch-review mocks and fixtures
<!-- lw:anchors packages/core/src/batch-review.test.ts#MockLlm packages/core/src/batch-review.test.ts#MockLlm.generate packages/core/src/batch-review.test.ts#seedFiveFileRepo packages/core/src/batch-review.test.ts#stage2ErrorCode packages/core/src/batch-review.test.ts#executablePlanPaths -->

`MockLlm` implements `LlmClient` for the reviewer-finding regression suite: `generate(req)` extracts the closed key list from `- …` lines in the prompt, advances `callCount`, records `costInputs` for pricing assertions, and returns a minimal valid Markdown artifact whose anchors list mirrors the prompt. `seedFiveFileRepo()` provisions a temp repo with five source files used by uniqueness/multi-module assertions. `stage2ErrorCode()` and `executablePlanPaths()` are probe helpers that surface the failure category of stage-2 outputs and the paths the plan marks executable, respectively.

## diagnostic summarization
<!-- lw:anchors packages/core/src/batch-state.ts#DIAGNOSTIC_TEXT_CAP packages/core/src/batch-state.ts#DIAGNOSTIC_MAX_ERRORS packages/core/src/batch-state.ts#summarizeDiagnosticErrors -->

Two constants bound diagnostic persistence: `DIAGNOSTIC_TEXT_CAP` truncates each error's `message` and optional `offending` excerpt; `DIAGNOSTIC_MAX_ERRORS` caps the number of structured entries retained per attempt. `summarizeDiagnosticErrors(input)` projects raw `ArtifactValidationError` entries into `DiagnosticErrorSummary` rows (capping both lists, recording `truncatedErrorCount`) so the persisted checkpoint stays bounded and content-safe. The same summary shape is what `batch status` surfaces.

## batch-status mocks
<!-- lw:anchors packages/core/src/batch-status.test.ts#OneShotMockLlm packages/core/src/batch-status.test.ts#OneShotMockLlm.generate packages/core/src/batch-status.test.ts#ValidMockLlm packages/core/src/batch-status.test.ts#ValidMockLlm.generate packages/core/src/batch-status.test.ts#OneModuleMockLlm packages/core/src/batch-status.test.ts#OneModuleMockLlm.generate packages/core/src/batch-status.test.ts#seedLegacyCheckpoint -->

`OneShotMockLlm`, `ValidMockLlm`, and `OneModuleMockLlm` are LLMClient stubs tailored to the status-report tests. `OneShotMockLlm.generate` throws if invoked (the H6 backward-compat test never calls the LLM; it seeds the DB directly). `ValidMockLlm.generate` and `OneModuleMockLlm.generate` produce valid artifacts for the post-Lot A status-output cases that exercise the `diagnosticHistory` additive field. `seedLegacyCheckpoint()` writes a pre-Lot A checkpoint row — `usageHistory` populated, NO `diagnosticHistory` field — and returns its `runId` so the report can be inspected. CONTRACT I5: a checkpoint without `diagnosticHistory` must report it as absent, not synthesized.

## status aggregation primitives
<!-- lw:anchors packages/core/src/batch-status.ts#aggregateUsageFromCheckpoint packages/core/src/batch-status.ts#emptyStageUsage packages/core/src/batch-status.ts#mergeStageUsage packages/core/src/batch-status.ts#safeJsonParse packages/core/src/batch-status.ts#parseRunSummary -->

`aggregateUsageFromCheckpoint(cp)` collapses a `TaskCheckpoint`'s `usageHistory` into a single `StageUsage` (tokens, USD, and an `usageIncomplete` flag if any attempt had `usageKnown: false`). `emptyStageUsage()` allocates a fresh zero-valued `StageUsage`; `mergeStageUsage(a, b)` adds two usages together, propagating `usageIncomplete` and the `costUsd = null` semantics when either side is unknown. `safeJsonParse<T>(s)` is the tolerant deserializer used when reading `batch_tasks.checkpoint_json` and `batch_runs.summary_json`: it returns `null` instead of throwing so a single bad row never breaks the report. `parseRunSummary(raw)` turns the saved summary JSON into a structured `BatchRunSummary | null`, again tolerating null and invalid input.

## batch-status reporting and batch end-to-end mock
<!-- lw:anchors packages/core/src/batch-status.ts#buildStatusReport packages/core/src/batch-status.ts#listRuns packages/core/src/batch.test.ts#MockLlm packages/core/src/batch.test.ts#MockLlm.generate -->

`buildStatusReport(repoRoot, runId=null)` opens the index DB read-only, resolves the run (specific id or most recent), loads its task rows, aggregates per-stage and per-module usage, and assembles `BatchStatusReport` (`run`, `totals`, `byStage`, `byModule`, `tasks`, `failures`, `pricingRefDate`). It surfaces `diagnosticHistory` only when present in the checkpoint (additive, backward-compatible). `listRuns(repoRoot)` returns a compact summary of every batch run (id, started/finished timestamps, status, startedBy) for picker UIs and dashboards.

The `batch.test.ts` end-to-end suite drives the orchestrator with its own `MockLlm implements LlmClient`. Its `generate(req)` parses the user prompt for `# Module: <id>` and the first canonical key of the form `- <…#…>`, then returns a minimal valid Markdown artifact whose frontmatter `anchors:` lists that key and whose body contains a top-level heading plus a sub-section with real prose. The mock records `callCount` so tests assert the exact number of LLM calls across stages 2 and 4, distinguishing the `noRefine` default (stage 4 only) from a run that includes stage-2 refinement (stage 2 + stage 4). Together with `runBatch` and `runOnly`, this is what exercises the full pipeline end-to-end without a real provider.