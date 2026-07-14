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
<!-- lw:anchors packages/core/src/anchor-ledger.test.ts#writeCode packages/core/src/anchor-ledger.test.ts#writeWiki packages/core/src/anchor-ledger.test.ts#nodeSqliteQuery -->

The `anchor-ledger.test.ts` suite spins up an isolated repo + wiki + SQLite index per test by using a `mkdtemp` root that is removed in `afterEach`. Two filesystem helpers materialise both code files and wiki pages under that root, ensuring directory layout (`mkdir({ recursive: true })`) before writing content.

- `writeCode(rel, content)` writes an indexable source file under the temp `repoRoot` so the indexer has something to pick up.
- `writeWiki(rel, content)` writes a wiki page under the same root; the page format is the standard markdown with frontmatter that `extractAnchors` understands.
- `nodeSqliteQuery(repoRoot, sql)` returns rows from `.livewiki/index.db` as `Array<Record<string, unknown>>` — used to assert ledger side effects (e.g. rows in the `debt` table) without coupling to a specific driver API.

## anchor-ledger entry points and orchestration
<!-- lw:anchors packages/core/src/anchor-ledger.ts#run packages/core/src/anchor-ledger.ts#orchestrate packages/core/src/anchor-ledger.ts#AnchorParseError packages/core/src/anchor-ledger.ts#AnchorParseError.constructor packages/core/src/anchor-ledger.ts#collectWikiPages packages/core/src/anchor-ledger.ts#hashContent packages/core/src/anchor-ledger.ts#escapeRegex -->

`run(repoRoot, opts)` is the public entry point: it ensures `.livewiki/` exists, resolves and validates the DB path, opens the SQLite index, and delegates to `orchestrate`, closing the DB on the way out. The result aggregates counts of processed/skipped pages, anchors upserted, debt created (broken down by event), undocumented symbols, and `movedPairs` for telemetry.

`orchestrate(db, absRoot, opts)` drives the per-page loop: it collects wiki pages, snapshots the existing `doc_pages`, `anchors`, and active/deleted `symbols` maps, then walks each page. Page read failures and `extractAnchors` failures both increment `pagesSkipped` and emit a warning when `opts.quiet` is false. `AnchorParseError` is the structured error class thrown when anchor parsing fails on a wiki page; its constructor takes the offending `wikiPath` plus the original `cause` and stamps `name = "AnchorParseError"`.

`collectWikiPages(absRoot)` is the async discovery routine that returns `{ relPath }[]` entries for every `.md` page under the wiki root. `hashContent(content)` produces the content hash used to detect doc-page changes. `escapeRegex(s)` is the small utility used when rewriting anchors inside markdown — escaping regex metacharacters before building a literal pattern.

## anchor-ledger DB writers and debt detection
<!-- lw:anchors packages/core/src/anchor-ledger.ts#upsertDocPage packages/core/src/anchor-ledger.ts#upsertAnchor packages/core/src/anchor-ledger.ts#createDebt packages/core/src/anchor-ledger.ts#hasOpenDebt packages/core/src/anchor-ledger.ts#detectMoves packages/core/src/anchor-ledger.ts#upsertUndocumented packages/core/src/anchor-ledger.ts#assigneeFor packages/core/src/anchor-ledger.ts#rewriteSymbolKeyInPage -->

`upsertDocPage` writes a row to `doc_pages` keyed by `wiki_path`, keeping the previous `id` and `content_hash` snapshots handy so subsequent diffs can detect change. `upsertAnchor` is the per-section write into `anchors`, indexed by `(doc_page_id, section_slug)`.

`createDebt` records a new debt row for one of the three `DebtEvent` kinds — `changed`, `moved`, or `deleted`. `hasOpenDebt` is consulted to avoid stacking duplicate open debt rows for the same symbol/section pair. `detectMoves` matches newly-deleted symbols (by `content_hash` first, name+signature as fallback) to active ones and reports the cross-file moves; when a move is detected and the destination lives on a non-protected page, `rewriteSymbolKeyInPage` performs the safe-IO markdown rewrite of both frontmatter entries and section markers. `upsertUndocumented` flags active symbols that have no anchor in any current wiki page.

`assigneeFor(owner, inManualBlock)` is the policy function that maps page ownership (`generated` / `human` / `mixed`) plus whether the anchor sits inside a manual block to the `Assignee` value (`agent` or `human`). Generated content and mixed pages route debt to `agent`; pure human pages and anchors sitting in `lw:manual` zones route debt to `human` and skip the markdown rewrite.

## anchors.ts — markdown extraction
<!-- lw:anchors packages/core/src/anchors.ts#extractAnchors packages/core/src/anchors.ts#slugify packages/core/src/anchors.ts#isInsideAny -->

`extractAnchors(source)` is the single function that turns a raw wiki markdown string into an `ExtractedAnchors` value: it parses frontmatter, walks `lw:manual` ranges, walks heading lines, then pairs every `lw:anchors` marker with the most recent preceding heading. The output separates `pageAnchors` (frontmatter list) from `sectionAnchors` (per-heading) and exposes `manualBlocks` ranges plus the original `body` slice.

`slugify(heading)` produces the section slug used both as the join key with `anchors.section_slug` and inside the `lw:anchors` markers themselves; it is the canonical lowercased, accent-stripped, dash-joined form. `isInsideAny(start, end, blocks)` answers whether a `(start, end)` range falls inside any of the supplied `ManualBlock` ranges — the predicate that flags anchors as protected so the ledger routes their debt to humans instead of rewriting the markdown.

## artifact.ts — stage 4 normalization and validation
<!-- lw:anchors packages/core/src/artifact.ts#normalizeStage4Artifact packages/core/src/artifact.ts#validateStage4Artifact packages/core/src/artifact.ts#hasRealProse packages/core/src/artifact.ts#err packages/core/src/artifact.ts#slugifyHeading packages/core/src/artifact.ts#lastHeadingBefore -->

`normalizeStage4Artifact(raw)` strips a BOM, normalises line endings, removes exactly one leading `<think>…</think>` block, detects unclosed reasoning or thinking-only outputs (rejected), and unwraps one outer ```` ```markdown ```` / ```` ```md ```` fence. The output is either a clean markdown string plus an empty error list, or an empty string plus a structured `empty_after_normalize` / `unclosed_reasoning` / `reasoning_only` error.

`validateStage4Artifact(artifact, closedKeyList)` enforces the full stage-4 contract on the normalised artifact: explicit `owner: generated` (no implicit default), `anchors:` list present when the closed list is non-empty, every anchor key present in the closed list, both the frontmatter list AND the per-section markers covering every closed-list key independently (no union / short-circuit), no duplicate keys across frontmatter and markers, every section marker followed by real prose (no blank or placeholder-only sections), fully closed Markdown (no unclosed fences or inline-code spans), no placeholder markers outside code fences or `lw:manual`, non-empty body, and rejection of any `lw:manual` block in the body (manual blocks are reserved for the orchestrator to re-inject).

`hasRealProse(text)` is the predicate used by `empty_section` checks — it returns false for blank or whitespace-only content. `err(code, message, location)` is the constructor helper that produces a structured `ArtifactValidationError` with a known `ArtifactValidationCode`. `slugifyHeading(text)` mirrors the slugification used for section anchors so validator lookups stay consistent. `lastHeadingBefore(...)` is the lookup helper that finds the most recent heading preceding a given offset inside the body.

## batch-repair test mocks and fixtures
<!-- lw:anchors packages/core/src/batch-repair.test.ts#ProgrammableMockLlm packages/core/src/batch-repair.test.ts#ProgrammableMockLlm.generate packages/core/src/batch-repair.test.ts#makeValidPage packages/core/src/batch-repair.test.ts#makeInvalidPage packages/core/src/batch-repair.test.ts#readStage4Checkpoint packages/core/src/batch-repair.test.ts#expectJoinedAttempts -->

`ProgrammableMockLlm` is the programmable LLM client used by the repair tests: it queues responses (and stop reasons) by call index, can be configured to throw on specific indices, logs each `{system, user}` prompt, and — when `autoPageFromPrompt` is enabled — parses the closed-key list directly out of the prompt and synthesises a valid page via `makeValidPage`. `generate(req)` implements the `LlmClient.generate` contract, returning a `GenerateResult` with a fixed-shape usage payload and the queued response.

`makeValidPage(closedKeyList)` synthesises a minimal but valid stage-4 artifact that lists every supplied key in `anchors:` and includes a section marker plus a "Body." prose line, so tests can assert repair success without manually constructing each artifact. `makeInvalidPage(uniqueText)` produces an artifact that fails validation by design — useful for negative tests around repair prompts.

`readStage4Checkpoint(root, target)` opens the live `.livewiki/index.db` read-only and returns the parsed `TaskCheckpoint` for the given `target` module at stage 4. `expectJoinedAttempts(checkpoint)` asserts the invariant that `diagnosticHistory` length equals `usageHistory` length and that their `attempt` counters line up position by position — the join key for the per-attempt 1:1 contract.

## batch-review test mocks and helpers
<!-- lw:anchors packages/core/src/batch-review.test.ts#MockLlm packages/core/src/batch-review.test.ts#MockLlm.generate packages/core/src/batch-review.test.ts#seedFiveFileRepo packages/core/src/batch-review.test.ts#stage2ErrorCode packages/core/src/batch-review.test.ts#executablePlanPaths -->

`MockLlm` is the simpler LLM client used by the reviewer-finding regressions. It derives a module id and the first closed key directly from the prompt and emits a valid page that lists that key in `anchors:` with a section marker and a "Body." prose line. `generate(req)` returns the synthesised content plus a fixed-shape usage record and records the cost input for later assertion.

`seedFiveFileRepo` lays down a fixture repo with five source files — the minimal scaffolding needed by tests that exercise the module-id uniqueness rule and multi-module repair flow. `stage2ErrorCode` returns the structured `error.code` from the stage-2 task in the most recent batch run, used by reviewer tests that want to assert the exact failure classification. `executablePlanPaths` returns the file paths referenced by the executable plan so tests can verify they exist on disk after a run.

## batch-state — diagnostics caps and summariser
<!-- lw:anchors packages/core/src/batch-state.ts#DIAGNOSTIC_TEXT_CAP packages/core/src/batch-state.ts#DIAGNOSTIC_MAX_ERRORS packages/core/src/batch-state.ts#summarizeDiagnosticErrors -->

`DIAGNOSTIC_TEXT_CAP` and `DIAGNOSTIC_MAX_ERRORS` are the two bounded-summary constants (200 chars and 50 errors respectively) used by every diagnostic persistence path so that a single bad attempt cannot bloat the `batch_tasks.checkpoint_json` payload.

`summarizeDiagnosticErrors(input)` slices the input to at most `DIAGNOSTIC_MAX_ERRORS` entries, trims `offending` and `message` to `DIAGNOSTIC_TEXT_CAP`, and returns both the bounded list and a `truncatedErrorCount` so downstream consumers can surface the fact that more errors existed than were persisted. This is the sole function that builds a `DiagnosticErrorSummary[]` from an `ArtifactValidationError[]`.

## batch-status test mocks and fixtures
<!-- lw:anchors packages/core/src/batch-status.test.ts#OneShotMockLlm packages/core/src/batch-status.test.ts#OneShotMockLlm.generate packages/core/src/batch-status.test.ts#ValidMockLlm packages/core/src/batch-status.test.ts#ValidMockLlm.generate packages/core/src/batch-status.test.ts#OneModuleMockLlm packages/core/src/batch-status.test.ts#OneModuleMockLlm.generate packages/core/src/batch-status.test.ts#seedLegacyCheckpoint -->

`OneShotMockLlm` is the LLM client used by the H6 backward-compat test: its `generate` deliberately throws, because that test never goes through the LLM at all — it seeds the DB directly. `ValidMockLlm` is used to drive a real (stubbed) batch run when the test needs a checkpoint that already carries the post-Lot A `diagnosticHistory` field, contrasting with the legacy shape. `OneModuleMockLlm` is the variant used by tests that need exactly one module in the batch.

`generate()` for each of these classes implements the `LlmClient.generate` contract with the minimal payload required by `runBatch`. `seedLegacyCheckpoint` inserts a `batch_runs` row plus one `batch_tasks` row whose `checkpoint_json` is the pre-Lot A shape — `usageHistory` populated, no `diagnosticHistory` field — and returns the runId so the status report path can be invoked against it. This is the seed used to assert that the additive field stays absent for legacy checkpoints.

## batch-status — reporting and aggregation
<!-- lw:anchors packages/core/src/batch-status.ts#buildStatusReport packages/core/src/batch-status.ts#listRuns packages/core/src/batch-status.ts#emptyStageUsage packages/core/src/batch-status.ts#aggregateUsageFromCheckpoint packages/core/src/batch-status.ts#mergeStageUsage packages/core/src/batch-status.ts#safeJsonParse packages/core/src/batch-status.ts#parseRunSummary -->

`buildStatusReport(repoRoot, runId)` is the public report builder. It resolves the run (specific id, or the latest when `runId` is null), loads all `batch_tasks` rows for that run, parses each `checkpoint_json` safely, aggregates usage into totals / per-stage / per-module maps, and emits a `BatchStatusReport` whose per-task items conditionally include `diagnosticHistory` only when the checkpoint has it (preserving byte-stable output for legacy checkpoints). Totals also propagate the `usageIncomplete` flag whenever any contributing attempt had `usageKnown === false`.

`listRuns(repoRoot)` returns a minimal summary list (id, timestamps, status, startedBy) of every `batch_runs` row — used by `livewiki batch status` to enumerate history.

`emptyStageUsage()` returns a zeroed `StageUsage` value used as the neutral element for merging. `aggregateUsageFromCheckpoint(cp)` sums the input/output tokens and USD cost across every `usageHistory` entry of one checkpoint while honouring the `usageKnown === false` rule (does not invent zero-token usage) and propagating `usageIncomplete`. `mergeStageUsage(a, b)` is the monoidal combine that adds two `StageUsage` values while keeping the `usageIncomplete` flag sticky. `safeJsonParse<T>(s)` wraps `JSON.parse` in a try/catch and returns `null` on failure — used for every read of `checkpoint_json` and `summary_json`. `parseRunSummary(raw)` decodes the `summary_json` blob into a `BatchRunSummary` (or null) and is the single point where the `modulesRefined` field surfaced by FIX J enters the report.

## batch.test.ts — orchestrator mocks
<!-- lw:anchors packages/core/src/batch.test.ts#MockLlm packages/core/src/batch.test.ts#MockLlm.generate -->

`MockLlm` is the simplest LLM client used by `batch.test.ts` end-to-end orchestrator tests: it parses the module id and the first closed key out of the user prompt, then emits a valid stage-4 artifact that lists that key in `anchors:` with a section marker plus a short prose body. `generate(req)` increments `callCount` and returns a fixed-shape usage record (`inputTokens: 100, outputTokens: 50`) so the `usageHistory` accounting in the checkpoint is easy to assert against. The same mock is used both for `runBatch` (which calls LLM once per module at stage 4) and for `runOnly` (which appends a second attempt to the existing checkpoint).