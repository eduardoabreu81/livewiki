---
title: anchor ledger, artifact validation, and batch status
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
  - packages/core/src/artifact.ts#checkRequiredPageOpening
  - packages/core/src/artifact.ts#err
  - packages/core/src/artifact.ts#findExactOpeningH2
  - packages/core/src/artifact.ts#findNextH2
  - packages/core/src/artifact.ts#findOpeningHeadingCandidate
  - packages/core/src/artifact.ts#firstPresentIndex
  - packages/core/src/artifact.ts#hasRealProse
  - packages/core/src/artifact.ts#lastHeadingBefore
  - packages/core/src/artifact.ts#normalizeStage4Artifact
  - packages/core/src/artifact.ts#offendingHeading
  - packages/core/src/artifact.ts#openingSnippet
  - packages/core/src/artifact.ts#proseBlockFailure
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

# anchor ledger, artifact validation, and batch status

This module is responsible for keeping wiki anchors synchronized with the code index, validating stage-4 markdown artifacts, and reporting batch-run token usage.

## When to use this page

- Run the anchor ledger to detect changed, moved, or deleted symbols and emit debt rows.
- Validate or normalize a stage-4 LLM artifact before it is written to disk.
- Inspect batch-run usage, per-stage totals, and per-module breakdowns for a completed run.
- Extend or read the bounded diagnostic history attached to stage-4 task checkpoints.

## How it fits

Within `packages/core/src`, this surface spans the `anchor-ledger` and `batch` subsystems. `anchor-ledger.ts` reads each wiki page, extracts anchors, upserts `doc_pages` and `anchors` in the SQLite index, and diffs against the prior state to produce `changed`/`moved`/`deleted` debt rows. `anchors.ts` is the parser it relies on for frontmatter, section markers, and `lw:manual` ranges. `artifact.ts` normalizes and validates the markdown produced at stage 4 of the batch pipeline, enforcing frontmatter, completeness, and manual-block rules. `batch-state.ts` defines the persisted checkpoint shape including diagnostic caps, and `batch-status.ts` aggregates per-run and per-task usage from those checkpoints. The `*.test.ts` files in this set exercise the ledger diffing logic, artifact rules, repair-flow diagnostics, and status-report backward compatibility.

## anchor-ledger orchestration
<!-- lw:anchors packages/core/src/anchor-ledger.ts#run packages/core/src/anchor-ledger.ts#orchestrate packages/core/src/anchor-ledger.ts#collectWikiPages packages/core/src/anchor-ledger.ts#AnchorParseError packages/core/src/anchor-ledger.ts#AnchorParseError.constructor packages/core/src/anchor-ledger.ts#hashContent packages/core/src/anchor-ledger.ts#upsertDocPage packages/core/src/anchor-ledger.ts#escapeRegex packages/core/src/anchor-ledger.ts#detectMoves packages/core/src/anchor-ledger.ts#upsertUndocumented packages/core/src/anchor-ledger.ts#hasOpenDebt packages/core/src/anchor-ledger.ts#assigneeFor packages/core/src/anchor-ledger.ts#rewriteSymbolKeyInPage packages/core/src/anchor-ledger.ts#createDebt packages/core/src/anchor-ledger.ts#upsertAnchor -->

`run` opens the SQLite index and delegates to `orchestrate`, which iterates `collectWikiPages`, parses each page, upserts `doc_pages` via `upsertDocPage` keyed by `wiki_path`, and records anchors. `hashContent` produces the content hash used to detect page-level edits, and `escapeRegex` is the small helper used when rewriting anchor tokens inside markdown. When anchor extraction fails the source error is wrapped in `AnchorParseError` via its `constructor`, and `orchestrate` increments `pagesSkipped` instead of throwing. After all pages are processed, the ledger diffs against `existingAnchors` to mark removed anchors as `deleted` via `createDebt` and `hasOpenDebt`, then calls `detectMoves` to merge unmatched symbols by content hash (with name+signature as fallback); moved anchors are also rewritten on disk by `rewriteSymbolKeyInPage`. Unmatched active symbols are recorded by `upsertUndocumented`. `assigneeFor` maps the page owner (`generated`/`human`) and `inManualBlock` flag to an `agent`/`human` assignee — manual-block and human-owned anchors are excluded from rewrite per rule #6.

```ts
async function orchestrate(
  db: import("better-sqlite3").Database,
  absRoot: string,
  opts: LedgerOptions,
): Promise<LedgerResult>
```

The excerpt shows the normal happy path; if `safeIo.readText` or `extractAnchors` throws, the page is skipped with a console warning and the loop continues.

## anchor parsing primitives
<!-- lw:anchors packages/core/src/anchors.ts#extractAnchors packages/core/src/anchors.ts#isInsideAny packages/core/src/anchors.ts#slugify -->

`extractAnchors` parses frontmatter and walks the body to collect `pageAnchors`, `sectionAnchors`, and `manualBlocks` ranges (a simple start/end toggle — nested opens are ignored). Each section anchor is associated with the most recent preceding heading and tagged with `inManualBlock` by `isInsideAny` so downstream verifiers can distinguish protected zones. Heading slugs are produced by `slugify`, applied to the heading text captured by the same scan that locates `lw:anchors` markers.

```ts
export function extractAnchors(source: string): ExtractedAnchors
```

The source excerpt does not establish exhaustive edge-case behavior beyond what's described above; the truncated manual-block handling section is not visible.

## stage-4 artifact normalization and validation
<!-- lw:anchors packages/core/src/artifact.ts#normalizeStage4Artifact packages/core/src/artifact.ts#validateStage4Artifact packages/core/src/artifact.ts#err packages/core/src/artifact.ts#hasRealProse packages/core/src/artifact.ts#checkRequiredPageOpening packages/core/src/artifact.ts#findExactOpeningH2 packages/core/src/artifact.ts#findOpeningHeadingCandidate packages/core/src/artifact.ts#findNextH2 packages/core/src/artifact.ts#firstPresentIndex packages/core/src/artifact.ts#offendingHeading packages/core/src/artifact.ts#openingSnippet packages/core/src/artifact.ts#proseBlockFailure packages/core/src/artifact.ts#slugifyHeading packages/core/src/artifact.ts#lastHeadingBefore -->

`normalizeStage4Artifact` strips one leading `<think>…</think>` block, rejects unclosed reasoning or thinking-only output, and unwraps one outer `markdown`/`md` fence; an empty-after-normalize input fails immediately via the `err` helper. `validateStage4Artifact` then enforces the frontmatter contract — the `owner:` line must be explicitly `generated`, the `anchors:` list must mirror every closed key, and section markers (`lw:anchors` blocks) must independently cover every closed key. Duplicate anchors are rejected, body markdown must be fully closed, and `lw:manual` blocks in the body are rejected outright (rule #6). Helpers `hasRealProse` and `checkRequiredPageOpening` power the page-opening check; `findExactOpeningH2`, `findOpeningHeadingCandidate`, `findNextH2`, and `lastHeadingBefore` locate heading boundaries, `firstPresentIndex` returns the lowest non-negative index among candidates, `offendingHeading` extracts the offending H2 text, `openingSnippet` returns the contiguous opening region for diagnostics, `proseBlockFailure` builds a structured error for a section that fails the prose check, and `slugifyHeading` converts a heading to its expected slug form.

```ts
export function normalizeStage4Artifact(raw: string): NormalizeResult
export function validateStage4Artifact(
  /* params per symbols table */
): ValidateResult
```

Behavior asserted by the excerpt: normalization never attempts to rescue markdown inside an incomplete reasoning block; validation rejects pages whose frontmatter and markers do not independently cover the closed list (no union-allowed fallback).

## batch checkpoint state and diagnostic caps
<!-- lw:anchors packages/core/src/batch-state.ts#DIAGNOSTIC_TEXT_CAP packages/core/src/batch-state.ts#DIAGNOSTIC_MAX_ERRORS packages/core/src/batch-state.ts#summarizeDiagnosticErrors -->

`DIAGNOSTIC_TEXT_CAP` (200) and `DIAGNOSTIC_MAX_ERRORS` (50) bound what `summarizeDiagnosticErrors` retains per attempt. The function maps each `ArtifactValidationError` into a `DiagnosticErrorSummary`, truncating message and offending text to `DIAGNOSTIC_TEXT_CAP` and slicing the array to `DIAGNOSTIC_MAX_ERRORS` entries; it returns the resulting array plus a `truncatedErrorCount` for telemetry. The summaries preserve `code`, `location`, and optional `sectionSlug` so downstream consumers can join them 1:1 with usage history.

```ts
export const DIAGNOSTIC_TEXT_CAP = 200;
export const DIAGNOSTIC_MAX_ERRORS = 50;
export function summarizeDiagnosticErrors(
  input: ReadonlyArray<ArtifactValidationError>,
): { errors: DiagnosticErrorSummary[]; truncatedErrorCount: number }
```

## batch status reporting
<!-- lw:anchors packages/core/src/batch-status.ts#buildStatusReport packages/core/src/batch-status.ts#listRuns packages/core/src/batch-status.ts#safeJsonParse packages/core/src/batch-status.ts#parseRunSummary packages/core/src/batch-status.ts#aggregateUsageFromCheckpoint packages/core/src/batch-status.ts#mergeStageUsage packages/core/src/batch-status.ts#emptyStageUsage -->

`buildStatusReport` resolves a run row (specific id or most recent), then iterates `batch_tasks` to assemble totals, `byStage`, `byModule` (stage 4 only), per-task reports, and failures. Each checkpoint is parsed with `safeJsonParse`, summed through `aggregateUsageFromCheckpoint` and `mergeStageUsage` starting from `emptyStageUsage`, and surfaced as a `TaskReportItem` with a derived `retryCommand`. The `diagnosticHistory` field is only included when present on the checkpoint, preserving byte-stability for legacy rows. `parseRunSummary` tolerantly reads `summary_json` (returns `null` for missing or malformed JSON). `listRuns` returns a compact summary across all stored runs.

```ts
function safeJsonParse<T>(s: string): T | null
function parseRunSummary(raw: string | null): BatchRunSummary | null
function emptyStageUsage(): StageUsage
function mergeStageUsage(a: StageUsage, b: StageUsage): StageUsage
function aggregateUsageFromCheckpoint(cp: TaskCheckpoint | null): StageUsage
```

A missing run raises rather than returns null: the throw path is the documented failure mode for an unknown `runId` or empty `batch_runs` table.

## ledger test helpers and harness
<!-- lw:anchors packages/core/src/anchor-ledger.test.ts#writeCode packages/core/src/anchor-ledger.test.ts#writeWiki packages/core/src/anchor-ledger.test.ts#nodeSqliteQuery -->

`writeCode` and `writeWiki` create files under the per-test `repoRoot` (mkdtemp + rm in `beforeEach`/`afterEach`). `nodeSqliteQuery` runs a SQL statement against the ledger's SQLite file and returns the rows as a plain array, which the test suite uses to assert on emitted debt (`SELECT event, assignee FROM debt`).

```ts
async function writeCode(rel: string, content: string): Promise<void>
async function writeWiki(rel: string, content: string): Promise<void>
function nodeSqliteQuery(repoRoot: string, sql: string): Array<Record<string, unknown>>
```

## batch repair-flow tests
<!-- lw:anchors packages/core/src/batch-repair.test.ts#ProgrammableMockLlm packages/core/src/batch-repair.test.ts#ProgrammableMockLlm.generate packages/core/src/batch-repair.test.ts#makeValidPage packages/core/src/batch-repair.test.ts#makeInvalidPage packages/core/src/batch-repair.test.ts#readStage4Checkpoint packages/core/src/batch-repair.test.ts#expectJoinedAttempts -->

`ProgrammableMockLlm` is a queue-driven LLM stand-in: each `generate` call logs the prompt, optionally throws when the index is in `throwOn`, and either returns the queued response or — when `autoPageFromPrompt` is on — builds a valid page via `makeValidPage` from the closed keys scraped out of the user prompt. `makeInvalidPage` is the trivial counterpart used to seed an unparseable response. `readStage4Checkpoint` opens the index database read-only and returns the parsed checkpoint for a given `target`. `expectJoinedAttempts` asserts the 1:1 invariant between `usageHistory` and `diagnosticHistory` (same length, same per-attempt counter).

```ts
class ProgrammableMockLlm implements LlmClient {
  /* ...see excerpt for the fields tracked per call... */
}
async generate(req: import("./llm/types.js").GenerateRequest): Promise<GenerateResult>
function makeValidPage(closedKeyList: string[]): string
function makeInvalidPage(uniqueText: string): string
async function readStage4Checkpoint(
  root: string,
  target?: string,
): Promise<TaskCheckpoint>
function expectJoinedAttempts(checkpoint: TaskCheckpoint): void
```

## review-finding regression tests
<!-- lw:anchors packages/core/src/batch-review.test.ts#MockLlm packages/core/src/batch-review.test.ts#MockLlm.generate packages/core/src/batch-review.test.ts#seedFiveFileRepo packages/core/src/batch-review.test.ts#stage2ErrorCode packages/core/src/batch-review.test.ts#executablePlanPaths -->

`MockLlm` satisfies `LlmClient` and auto-builds a valid stage-4 page from the closed keys it scrapes from the user prompt; `generate` records cost-relevant usage on `costInputs`. `seedFiveFileRepo` lays out the multi-file fixture used by uniqueness/identity regression tests. `stage2ErrorCode` reads the latest failure code from a stage-2 task, and `executablePlanPaths` enumerates plan paths treated as executable during review.

```ts
class MockLlm implements LlmClient {
  /* provider = "anthropic", model = "claude-test-mock" */
}
async generate(req: import("./llm/types.js").GenerateRequest): Promise<GenerateResult>
async function seedFiveFileRepo(): Promise<void>
async function stage2ErrorCode(): Promise<string | undefined>
async function executablePlanPaths(): Promise<string[]>
```

## batch-status backward-compatibility tests
<!-- lw:anchors packages/core/src/batch-status.test.ts#OneShotMockLlm packages/core/src/batch-status.test.ts#OneShotMockLlm.generate packages/core/src/batch-status.test.ts#ValidMockLlm packages/core/src/batch-status.test.ts#ValidMockLlm.generate packages/core/src/batch-status.test.ts#OneModuleMockLlm packages/core/src/batch-status.test.ts#OneModuleMockLlm.generate packages/core/src/batch-status.test.ts#seedLegacyCheckpoint -->

The status test set covers CONTRACT I5: checkpoints written without `diagnosticHistory` must load with the field absent from the per-task report (not `undefined` printed as `null`, not a synthesized empty array). `seedLegacyCheckpoint` inserts a pre-Lot A checkpoint JSON (only `usageHistory`, with `diagnosticHistory` absent) and returns the `runId` for assertions. `OneShotMockLlm.generate` throws — the test paths that use it never reach the LLM. `ValidMockLlm.generate` and `OneModuleMockLlm.generate` produce valid stage-4 responses for the additive-contract counter-tests.

```ts
class OneShotMockLlm implements LlmClient {
  /* generate throws — test never invokes it */
}
class ValidMockLlm implements LlmClient { /* generates valid stage-4 page */ }
class OneModuleMockLlm implements LlmClient { /* single-module variant */ }
async function seedLegacyCheckpoint(): Promise<number>
```

## batch orchestrator tests
<!-- lw:anchors packages/core/src/batch.test.ts#MockLlm packages/core/src/batch.test.ts#MockLlm.generate -->

`MockLlm.generate` derives a page from the module name and first closed key it scrapes from the user prompt, returning one stage-4 content block per call. The test suite uses this mock to assert end-to-end batch behavior: `runBatch` populates `batch_runs` and `batch_tasks`, writes the wiki page and `.manifest.json`, and every persisted stage-4 checkpoint carries a `usageHistory` entry with non-zero tokens. The `--no-refine` and refine paths are exercised by counting mock invocations.

```ts
class MockLlm implements LlmClient {
  /* provider = "anthropic", model = "claude-test-mock" */
  public callCount = 0;
  public callLog: Array<{ system: string; user: string }> = [];
}
async generate(req: import("./llm/types.js").GenerateRequest): Promise<GenerateResult>
```

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
- [Core pipeline orchestration, config, schema, and helpers](core-src-02.md) — dependency and dependent
- [Core navigation, parsing, pointer, presets, pricing, prompts, safe I/O, and status surface](core-src-04.md) — dependency
- [core SRC — incremental update, verification and walker](core-src-05.md) — dependent
<!-- livewiki:navigate:end -->
