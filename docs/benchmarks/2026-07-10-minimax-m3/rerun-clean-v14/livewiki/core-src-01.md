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

Test setup helpers for the anchor-ledger test suite. Each test allocates an isolated tmpdir repo + wiki + DB, runs the indexer, then the ledger, and asserts against generated debt.

- `writeCode(rel, content)` creates an indexable code file under the test repo root, ensuring parent directories exist.
- `writeWiki(rel, content)` creates a wiki page under the test repo root, ensuring parent directories exist.
- `nodeSqliteQuery(repoRoot, sql)` opens the per-repo `.livewiki/index.db` read-only and returns rows as `Array<Record<string, unknown>>` for assertions on `debt`, `anchors`, and other ledger-managed tables.

## anchor-ledger runtime
<!-- lw:anchors packages/core/src/anchor-ledger.ts#AnchorParseError packages/core/src/anchor-ledger.ts#AnchorParseError.constructor packages/core/src/anchor-ledger.ts#assigneeFor packages/core/src/anchor-ledger.ts#collectWikiPages packages/core/src/anchor-ledger.ts#createDebt packages/core/src/anchor-ledger.ts#detectMoves packages/core/src/anchor-ledger.ts#escapeRegex packages/core/src/anchor-ledger.ts#hasOpenDebt packages/core/src/anchor-ledger.ts#hashContent packages/core/src/anchor-ledger.ts#orchestrate packages/core/src/anchor-ledger.ts#rewriteSymbolKeyInPage packages/core/src/anchor-ledger.ts#run packages/core/src/anchor-ledger.ts#upsertAnchor packages/core/src/anchor-ledger.ts#upsertDocPage packages/core/src/anchor-ledger.ts#upsertUndocumented -->

Synchronizes wiki anchors with the code index and emits `changed` / `moved` / `deleted` debt.

- `run(repoRoot, opts)` is the public entry point. It auto-initializes `.livewiki/`, opens the SQLite index, delegates to `orchestrate`, and closes the DB.
- `orchestrate(db, absRoot, opts)` walks every wiki page, upserts `doc_pages` and `anchors`, diffs against the previous state, and records debt events.
- `collectWikiPages(absRoot)` discovers `.md` files under `livewiki/`.
- `upsertDocPage(db, wikiPath, owner, contentHash, existing)` inserts or updates a `doc_pages` row keyed by `wiki_path`.
- `upsertAnchor(db, docPageId, sectionSlug, symbolKey, owner, inManualBlock, existing)` inserts or updates a row in `anchors` (UNIQUE by `doc_page_id` + `section_slug`).
- `createDebt(db, anchor, event, assignee)` writes a row to `debt` for the given anchor and event.
- `hasOpenDebt(db, anchor)` checks whether an anchor already has unresolved debt.
- `detectMoves(db, current, existingSymbols, deletedSymbols)` identifies symbols that relocated, primarily by `content_hash` and secondarily by name + signature.
- `upsertUndocumented(db, symbolKey, owner)` records symbols that are not yet anchored in any wiki page.
- `assigneeFor(owner, inManualBlock)` returns `"agent"` or `"human"` based on the page owner (mixed pages resolve to `agent` because the generated part dominates) and the manual-block flag.
- `rewriteSymbolKeyInPage(...)` performs the in-markdown rewrite of an anchor key when a symbol is detected as moved. The rewrite is skipped for `owner: human` pages and for anchors inside manual blocks (rule #6).
- `hashContent(content)` produces a stable hash used for `content_hash` columns and move detection.
- `escapeRegex(s)` escapes a string for safe use in `RegExp` construction during rewrites.
- `AnchorParseError` is thrown when anchor extraction fails. The `constructor(wikiPath, cause)` wraps the cause and sets `name = "AnchorParseError"`.

## anchor extraction
<!-- lw:anchors packages/core/src/anchors.ts#extractAnchors packages/core/src/anchors.ts#isInsideAny packages/core/src/anchors.ts#slugify -->

Parses a wiki Markdown source string into page anchors, section anchors, and manual-block ranges.

- `extractAnchors(source)` returns the full `ExtractedAnchors` value: `pageAnchors` (frontmatter list), `sectionAnchors` (one per section marker), `manualBlocks` (byte ranges for human-protected regions), the parsed `frontmatter`, the resolved `owner` (defaulting to `"generated"`), and the body string.
- `slugify(heading)` converts a heading into the slug used as `section_slug` (e.g. `"Fluxo de validação"` → `"fluxo-de-validacao"`).
- `isInsideAny(start, end, blocks)` reports whether a byte range falls inside any of the given manual blocks; it is used to flag anchors that are protected from automated rewrites.

## stage-4 artifact validation
<!-- lw:anchors packages/core/src/artifact.ts#err packages/core/src/artifact.ts#hasRealProse packages/core/src/artifact.ts#lastHeadingBefore packages/core/src/artifact.ts#normalizeStage4Artifact packages/core/src/artifact.ts#slugifyHeading packages/core/src/artifact.ts#validateStage4Artifact -->

Normalizes and validates the Markdown artifact produced by the stage-4 LLM call. A bad artifact is never silently repaired; it is rejected so a repair prompt can be issued.

- `normalizeStage4Artifact(raw)` strips a leading `<think>…</think>` block, rejects unclosed reasoning or reasoning-only output, unwraps a single outer ```` ```markdown ```` / ```` ```md ```` fence, and returns `{ ok, content, errors }`.
- `validateStage4Artifact(artifact, closedKeyList)` enforces: valid frontmatter with `owner: generated` explicit; the `anchors:` list and every `lw:anchors` marker covers the closed list independently and exactly once; no duplicate anchor keys; each section marker is followed by real prose; the Markdown is fully closed (no unterminated fences or inline code spans); no `TODO` / `TBD` in the body outside code/manual blocks; no `lw:manual` blocks in the generated body; and a non-empty body. Returns a list of structured `ArtifactValidationError` codes.
- `slugifyHeading(text)` produces a heading slug consistent with anchor extraction.
- `lastHeadingBefore(...)` locates the most recent heading preceding a given offset (used to bind section anchors to their heading).
- `hasRealProse(text)` returns `true` when the text contains substantive prose beyond whitespace and trivial boilerplate, used by the `empty_section` check.
- `err(code, message, location)` constructs a single `ArtifactValidationError` with the given code, message, and location tag (`frontmatter` | `section` | `body` | `global`).

## batch-repair test fixtures
<!-- lw:anchors packages/core/src/batch-repair.test.ts#ProgrammableMockLlm packages/core/src/batch-repair.test.ts#ProgrammableMockLlm.generate packages/core/src/batch-repair.test.ts#expectJoinedAttempts packages/core/src/batch-repair.test.ts#makeInvalidPage packages/core/src/batch-repair.test.ts#makeValidPage packages/core/src/batch-repair.test.ts#readStage4Checkpoint -->

Test scaffolding for the bounded corrective repair path: programmable LLM mock, fixture builders, and a checker for the 1:1 attempt / usage invariant.

- `ProgrammableMockLlm` is a queue-driven `LlmClient` whose `generate(req)` consumes the next queued response (or throws if the call index is in `throwOn`), records the prompt in `callLog`, and can synthesize a valid page from the closed key list embedded in the prompt when `autoPageFromPrompt` is enabled.
- `makeValidPage(closedKeyList)` builds a minimal valid artifact that references every key in `closedKeyList` from its frontmatter `anchors:` list.
- `makeInvalidPage(uniqueText)` builds an artifact that fails stage-4 validation (used to force the repair path).
- `readStage4Checkpoint(root, target)` opens the per-repo SQLite index read-only and returns the `TaskCheckpoint` JSON for the given stage-4 target.
- `expectJoinedAttempts(checkpoint)` asserts the 1:1 invariant between `usageHistory` and `diagnosticHistory`: their lengths match and the `attempt` fields line up element-for-element.

## batch-review test fixtures
<!-- lw:anchors packages/core/src/batch-review.test.ts#MockLlm packages/core/src/batch-review.test.ts#MockLlm.generate packages/core/src/batch-review.test.ts#executablePlanPaths packages/core/src/batch-review.test.ts#seedFiveFileRepo packages/core/src/batch-review.test.ts#stage2ErrorCode -->

Regressions for the 11 independent reviewer findings; minimal reproductions, all offline.

- `MockLlm` is a `LlmClient` whose `generate(req)` builds a valid artifact from the closed key list embedded in the user prompt (or falls back to a stub when none is present) and records token usage for cost assertions.
- `seedFiveFileRepo()` creates a five-file repo fixture used by uniqueness and module-id tests.
- `executablePlanPaths()` returns the plan file paths that the batch expects to find executable; used to assert path discovery and rejection of non-executable files.
- `stage2ErrorCode()` returns the first stage-2 error code recorded for the current run, or `undefined` when none was produced.

## batch-state types
<!-- lw:anchors packages/core/src/batch-state.ts#DIAGNOSTIC_MAX_ERRORS packages/core/src/batch-state.ts#DIAGNOSTIC_TEXT_CAP packages/core/src/batch-state.ts#summarizeDiagnosticErrors -->

Bounded, content-safe diagnostic summary types persisted in the per-task `checkpoint_json`.

- `DIAGNOSTIC_TEXT_CAP` is the maximum number of characters retained per `message` and `offending` field in a `DiagnosticErrorSummary` (values beyond the cap are truncated).
- `DIAGNOSTIC_MAX_ERRORS` is the maximum number of `DiagnosticErrorSummary` entries retained per attempt; any overflow is reported through `truncatedErrorCount` rather than silently dropped without signal.
- `summarizeDiagnosticErrors(input)` converts an array of `ArtifactValidationError` into persistence-safe `DiagnosticErrorSummary` records by slicing each list to the cap and truncating each string to `DIAGNOSTIC_TEXT_CAP` characters. It returns `{ errors, truncatedErrorCount }` and never mutates the caller's input.

## batch-status test fixtures
<!-- lw:anchors packages/core/src/batch-status.test.ts#OneModuleMockLlm packages/core/src/batch-status.test.ts#OneModuleMockLlm.generate packages/core/src/batch-status.test.ts#OneShotMockLlm packages/core/src/batch-status.test.ts#OneShotMockLlm.generate packages/core/src/batch-status.test.ts#ValidMockLlm packages/core/src/batch-status.test.ts#ValidMockLlm.generate packages/core/src/batch-status.test.ts#seedLegacyCheckpoint -->

Fixtures for the H6 backward-compatibility contract and the additive `diagnosticHistory` JSON shape.

- `OneShotMockLlm` is a `LlmClient` whose `generate()` always throws; it is included only so TypeScript narrows the interface — the H6 test seeds the DB directly and never calls into the LLM.
- `ValidMockLlm` is a `LlmClient` whose `generate()` returns a valid stage-4 artifact; used to produce a checkpoint that contains `diagnosticHistory` so the additive field is surfaced in `buildStatusReport` output.
- `OneModuleMockLlm` is a `LlmClient` whose `generate()` returns an artifact covering a single-module closed key list; used by tests that assert per-module aggregation paths.
- `seedLegacyCheckpoint()` inserts a `batch_runs` row plus a single `batch_tasks` row whose `checkpoint_json` is the pre-Lot A shape (no `diagnosticHistory` field). It returns the inserted `runId` so tests can call `buildStatusReport(root, runId)` and assert that the per-task output is byte-stable — the `diagnosticHistory` property is absent rather than serialized as `null` or `[]`.

## batch-status reporting
<!-- lw:anchors packages/core/src/batch-status.ts#aggregateUsageFromCheckpoint packages/core/src/batch-status.ts#buildStatusReport packages/core/src/batch-status.ts#emptyStageUsage packages/core/src/batch-status.ts#listRuns packages/core/src/batch-status.ts#mergeStageUsage packages/core/src/batch-status.ts#parseRunSummary packages/core/src/batch-status.ts#safeJsonParse -->

Aggregates `batch_runs` and `batch_tasks` into a `BatchStatusReport` for the `livewiki batch status <run>` command.

- `buildStatusReport(repoRoot, runId?)` resolves the run (latest when `runId` is `null`), loads every task, aggregates usage by stage, by module (stage 4 only), and totals, and surfaces the per-task `diagnosticHistory` only when the underlying checkpoint actually carries the field (backward-compat: legacy checkpoints serialize without it).
- `listRuns(repoRoot)` returns a one-line summary per run (`id`, `startedAt`, `finishedAt`, `status`, `startedBy`).
- `aggregateUsageFromCheckpoint(cp)` sums token usage, cost, and the `usageIncomplete` flag from a task's `usageHistory`.
- `emptyStageUsage()` returns a fresh zero-initialized `StageUsage` value (used as the seed for merges and totals).
- `mergeStageUsage(a, b)` adds two `StageUsage` values, propagating the `usageIncomplete` flag and treating `null` cost as "unknown" rather than zero.
- `parseRunSummary(raw)` tolerantly decodes a `summary_json` string into a `BatchRunSummary` (returns `null` on missing or malformed input so the report never breaks because of a corrupt summary).
- `safeJsonParse<T>(s)` wraps `JSON.parse` and returns `null` on any parse error, used wherever checkpoint or summary JSON is read off disk.

## batch orchestrator test fixtures
<!-- lw:anchors packages/core/src/batch.test.ts#MockLlm packages/core/src/batch.test.ts#MockLlm.generate -->

End-to-end test mock for the batch orchestrator.

- `MockLlm` is a `LlmClient` whose `generate(req)` extracts the module id and first canonical key from the user prompt and returns a structurally valid artifact referencing that key. Each call increments `callCount`, and the `usage` object it returns is asserted against `usageHistory` in the per-task checkpoint.
- `MockLlm.generate` records exactly one LLM invocation per call and the same `usage` shape (`inputTokens`, `outputTokens`, `model`) the real production adapters produce, so aggregate usage assertions in the test mirror the production aggregation path.