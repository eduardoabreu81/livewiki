---
title: core-src-01
owner: generated
anchors:
  - packages/core/src/anchors.ts#extractAnchors
  - packages/core/src/anchors.ts#isInsideAny
  - packages/core/src/anchors.ts#slugify
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
---

# core-src-01

## Anchor extraction from wiki pages
<!-- lw:anchors packages/core/src/anchors.ts#extractAnchors packages/core/src/anchors.ts#isInsideAny packages/core/src/anchors.ts#slugify -->

Parses a wiki Markdown source to recover frontmatter anchors, section-level
anchor markers, and the byte ranges of manual blocks.

- `extractAnchors` reads the frontmatter via `parseFrontmatter`, then walks the
  body to pair every `lw:anchors` marker with the preceding heading and to
  collect `lw:manual`/`/lw:manual` ranges as `ManualBlock`s. Each section
  anchor records its slug, heading text, symbol keys, and whether it falls
  inside a manual block. Body offsets are translated back into offsets on the
  original source so downstream consumers (ledger, verify) operate on the same
  byte positions.
- `slugify` lowercases the heading, strips diacritics via NFD, removes
  punctuation, and joins words with hyphens. Example: `"Fluxo de validação"`
  becomes `"fluxo-de-validacao"`.
- `isInsideAny` answers whether a given byte range (start inclusive, end
  exclusive) lies inside any collected `ManualBlock`. The ledger uses this to
  flag anchors that fall in human-protected zones.

## Anchor ledger orchestration
<!-- lw:anchors packages/core/src/anchor-ledger.ts#run packages/core/src/anchor-ledger.ts#orchestrate packages/core/src/anchor-ledger.ts#collectWikiPages packages/core/src/anchor-ledger.ts#upsertDocPage packages/core/src/anchor-ledger.ts#upsertAnchor packages/core/src/anchor-ledger.ts#createDebt packages/core/src/anchor-ledger.ts#hasOpenDebt packages/core/src/anchor-ledger.ts#detectMoves packages/core/src/anchor-ledger.ts#upsertUndocumented packages/core/src/anchor-ledger.ts#assigneeFor packages/core/src/anchor-ledger.ts#rewriteSymbolKeyInPage packages/core/src/anchor-ledger.ts#escapeRegex packages/core/src/anchor-ledger.ts#hashContent packages/core/src/anchor-ledger.ts#AnchorParseError packages/core/src/anchor-ledger.ts#AnchorParseError.constructor -->

Synchronizes wiki anchors with the indexed code symbols and produces
`changed`/`moved`/`deleted` debt rows.

- `run` is the public entry. It resolves the repo root, ensures `.livewiki/`
  exists via `safeIo.mkdir`, opens the SQLite index, and delegates to
  `orchestrate`. The DB handle is closed in a `finally` block.
- `orchestrate` is the core pipeline: collect wiki pages, load existing
  `doc_pages`/`anchors`/`symbols` (active + deleted) maps, then iterate each
  page to upsert docs and anchors and to gather the current anchor set for
  debt evaluation at the end. It also tracks `movedPairs` for telemetry.
- `collectWikiPages` enumerates `.md` files under `livewiki/` relative to the
  repo root.
- `upsertDocPage` inserts/updates a row in `doc_pages` keyed by `wiki_path`,
  carrying `owner` and the SHA-256 of the page source.
- `upsertAnchor` inserts/updates a row in `anchors` keyed by
  `(doc_page_id, section_slug)` and records whether the anchor is in a manual
  block and the symbol's prior `content_hash` (used to detect changes).
- `createDebt` and `hasOpenDebt` manage the `debt` table: an open debt row per
  `(symbol_key, event)` exists when the previous state has not yet been
  reconciled; `createDebt` inserts one with the resolved assignee.
- `detectMoves` looks for content-hash collisions between deleted symbols and
  currently active symbols (primary signal) and falls back to name+signature
  matching. When a move is detected, the new anchor key is recorded and the
  ledger rewrites the markdown.
- `upsertUndocumented` emits debt rows for indexed symbols that have no
  matching anchor at all (an "undocumented" backlog).
- `assigneeFor` decides whether debt for an anchor goes to `agent`
  (`owner: generated`, including `mixed` pages where generated dominates) or
  to `human` (anchor inside a manual block, or `owner: human` page).
- `rewriteSymbolKeyInPage` performs the on-disk anchor rewrite for a detected
  move. It updates both frontmatter entries and `lw:anchors` markers in the
  body, using `escapeRegex` to safely quote the old key.
- `escapeRegex` returns a string where regex metacharacters are backslash-escaped.
- `hashContent` returns the SHA-256 hex digest used to detect content changes
  on symbols and pages.
- `AnchorParseError` (with its `constructor`) wraps any parse failure during
  anchor extraction for a specific `wikiPath`, preserving the original cause
  in the message and setting `name = "AnchorParseError"`.

Rule #3 of the ledger mandates that detected moves also rewrite the markdown
itself (frontmatter and `lw:anchors` markers) — the DB alone is not the source
of truth. Rule #6 prohibits touching anchors that sit inside `lw:manual`
blocks or on pages whose `owner` is `human`; those only generate debt with
`assignee = human`.

## Stage 4 artifact normalization and validation
<!-- lw:anchors packages/core/src/artifact.ts#normalizeStage4Artifact packages/core/src/artifact.ts#validateStage4Artifact packages/core/src/artifact.ts#err packages/core/src/artifact.ts#slugifyHeading packages/core/src/artifact.ts#lastHeadingBefore -->

Prepares and checks the Markdown page the model returns in stage 4.

- `normalizeStage4Artifact` strips one leading `<think>…` block,
  rejects outputs whose reasoning block is unclosed or where the response is
  reasoning-only, and unwraps one outer ```markdown`/`md` fence (with optional
  info string). It returns a `NormalizeResult` with `ok`, the normalized
  `content`, and a list of structured `errors`. The function never tries to
  repair a malformed artifact — that is the repair prompt's job.
- `validateStage4Artifact` enforces the artifact contract: a top `---`
  frontmatter with `owner: generated` explicitly set, an `anchors:` list when
  the closed list is non-empty, every frontmatter and section-marker key
  present in the closed list, completeness of the closed list (no
  `missing_closed_key`), no duplicate keys in the frontmatter and no key used
  in more than one section marker, a non-empty body, and rejection of any
  `lw:manual` block (manual blocks are reserved for human content and must be
  re-injected by the orchestrator from the prior version, byte for byte).
- `err` builds a single structured `ArtifactValidationError` (code, message,
  scope) used by both normalization and validation.
- `slugifyHeading` produces a slug from heading text using the same lowercase
  + diacritic-strip + hyphen-join rules as `anchors.slugify`.
- `lastHeadingBefore` returns the nearest preceding heading (text + slug +
  offset) before a given offset, used to attach section anchors to the right
  heading when validating the artifact.

## Batch repair test support
<!-- lw:anchors packages/core/src/batch-repair.test.ts#ProgrammableMockLlm packages/core/src/batch-repair.test.ts#ProgrammableMockLlm.generate packages/core/src/batch-repair.test.ts#makeValidPage -->

Programmable LLM mock used by the repair test suite.

- `ProgrammableMockLlm` implements `LlmClient`. Each call consumes the next
  queued response or throws if the call index is in `throwOn`. It records the
  full prompt (`system`/`user`) into `callLog` and tracks `callCount`. A
  `autoPageFromPrompt` flag makes it build a valid page directly from the
  closed key list extracted from the user prompt — useful for tests that do
  not want to enumerate keys by hand.
- `ProgrammableMockLlm.generate` returns a `GenerateResult` whose `content`
  is either the queued response or a synthesized valid page, and whose
  `usage` reports fixed token counts for cost accounting.
- `makeValidPage` constructs a syntactically valid Markdown page (frontmatter
  with `owner: generated` and an `anchors:` list built from the supplied
  closed key list, followed by a heading and an `lw:anchors` section marker).

## Batch review test support
<!-- lw:anchors packages/core/src/batch-review.test.ts#MockLlm packages/core/src/batch-review.test.ts#MockLlm.generate packages/core/src/batch-review.test.ts#seedFiveFileRepo packages/core/src/batch-review.test.ts#stage2ErrorCode packages/core/src/batch-review.test.ts#executablePlanPaths -->

Test fixtures for the reviewer-finding regression suite.

- `MockLlm` implements `LlmClient`. It can return queued responses or, when
  the queue is empty, synthesize a valid page from the closed key list parsed
  out of the user prompt. It also records `costInputs` per call.
- `MockLlm.generate` consumes the next queued response (or synthesizes a
  page), returns a `GenerateResult` with deterministic usage, and logs the
  usage for later cost assertions.
- `seedFiveFileRepo` lays down a deterministic 5-file repo layout used by
  cross-module tests.
- `stage2ErrorCode` reads the stage-2 task's checkpoint and returns the
  error code (if any) recorded there — used to assert on refine outcomes
  without poking into the DB directly.
- `executablePlanPaths` returns the on-disk paths of the executable plan
  artifacts produced by the pipeline, for inspection in assertions.

## Batch status reporting
<!-- lw:anchors packages/core/src/batch-status.ts#buildStatusReport packages/core/src/batch-status.ts#listRuns packages/core/src/batch-status.ts#emptyStageUsage packages/core/src/batch-status.ts#aggregateUsageFromCheckpoint packages/core/src/batch-status.ts#mergeStageUsage packages/core/src/batch-status.ts#safeJsonParse packages/core/src/batch-status.ts#parseRunSummary -->

Aggregates `batch_runs` and `batch_tasks` into a per-run status report.

- `buildStatusReport` resolves a run (specific id or most recent), iterates
  its tasks, and computes totals, per-stage usage, per-module usage (stage 4
  only), task reports, and failure lists. Each task report includes a ready-
  to-paste retry command of the form `livewiki batch --only <target> <runId>`.
  The function tolerates missing/invalid `summary_json` so reports never
  break on legacy rows.
- `listRuns` returns a descending list of run summaries (id, started/finished
  timestamps, status, started-by).
- `emptyStageUsage` returns a zeroed `StageUsage` with `costUsd = null` and
  `usageIncomplete = false` — the canonical starting point for aggregation.
- `aggregateUsageFromCheckpoint` walks a task checkpoint's `usageHistory` and
  folds per-attempt usage into a single `StageUsage`, tracking the
  `usageIncomplete` flag and the set of models involved.
- `mergeStageUsage` combines two `StageUsage` values by summing tokens,
  adding known costs while preserving `null` semantics, and OR-ing the
  `usageIncomplete` flag.
- `safeJsonParse` is a thin wrapper around `JSON.parse` that returns `null`
  instead of throwing on invalid JSON.
- `parseRunSummary` decodes the `summary_json` blob of a run into a
  `BatchRunSummary`, returning `null` for missing or unparseable content.

## Batch orchestrator test support
<!-- lw:anchors packages/core/src/batch.test.ts#MockLlm packages/core/src/batch.test.ts#MockLlm.generate -->

Mock LLM used by the orchestrator's end-to-end tests.

- `MockLlm` implements `LlmClient` and produces a syntactically valid page per
  call. It derives the page's title from the `# Module: <id>` line in the
  user prompt and uses the first closed key it finds as the frontmatter
  anchor.
- `MockLlm.generate` increments `callCount` and returns a `GenerateResult`
  whose `content` is a synthesized page (frontmatter with `owner: generated`,
  one anchor, a heading, and an `lw:anchors` section marker) and whose
  `usage` reports fixed input/output token counts on the mock model.

## Batch orchestration core
<!-- lw:anchors packages/core/src/batch.ts#runBatch packages/core/src/batch.ts#resumeBatch packages/core/src/batch.ts#runOnly packages/core/src/batch.ts#orchestrate packages/core/src/batch.ts#EmptyPipelineError packages/core/src/batch.ts#EmptyPipelineError.constructor packages/core/src/batch.ts#TaskError packages/core/src/batch.ts#TaskError.constructor packages/core/src/batch.ts#emptyUsage packages/core/src/batch.ts#aggregateTotals packages/core/src/batch.ts#accumulateUsage packages/core/src/batch.ts#getOrCreateTask packages/core/src/batch.ts#createOrGetTask packages/core/src/batch.ts#safeJsonParse packages/core/src/batch.ts#validateRefinedModules packages/core/src/batch.ts#collectAllImports packages/core/src/batch.ts#readOwnerFromFrontmatter packages/core/src/batch.ts#forceOwnerInFrontmatter packages/core/src/batch.ts#extractManualBlocksBySection packages/core/src/batch.ts#slugifyHeadingText packages/core/src/batch.ts#injectManualBlocksBySection packages/core/src/batch.ts#sectionRangeOf packages/core/src/batch.ts#tryWriteAndVerify packages/core/src/batch.ts#verifyIssuesToValidationErrors packages/core/src/batch.ts#attemptStage4Generation packages/core/src/batch.ts#computeCostFromUsage packages/core/src/batch.ts#buildModuleDocContext packages/core/src/batch.ts#buildFairTruncatedSource packages/core/src/batch.ts#getFileIdsForModule packages/core/src/batch.ts#finalizeRun packages/core/src/batch.ts#buildResult packages/core/src/batch.ts#statusToExitCode -->

Pipeline that produces one wiki page per module with bounded repair,
transactional writes, and circuit-breaker failure handling.

- `runBatch`, `resumeBatch`, and `runOnly` are the three public entry points.
  They all delegate to `orchestrate` with a different `mode` (`"run"`,
  `"resume"`, `"only"`). `runOnly` requires `onlyTarget` (a module id or run
  id) and increments the existing task's attempt counter and `usageHistory`.
- `orchestrate` resolves config (with `applyDefaults`), validates it for batch
  use, picks the language, resolves `maxRepairAttempts` (opts > config >
  default), and drives the four stages: index → modules → prioritize →
  document. It also enforces refusal of `owner: human` pages pre-LLM and
  preservation of `lw:manual` blocks byte-for-byte.
- `EmptyPipelineError` (and its `constructor`) signals that the pipeline
  produced no modules to document — surfaced as an aborted run with a clear
  message.
- `TaskError` (and its `constructor`) wraps a `(code, message)` pair that the
  orchestrator attaches to a task's checkpoint when it fails (validation,
  LLM, or write errors).
- `emptyUsage` returns a zeroed `StageUsage` (inputTokens/outputTokens at 0,
  `costUsd = null`).
- `aggregateTotals` and `accumulateUsage` fold per-task usage into run-level
  totals. `accumulateUsage` records each LLM attempt (tokens + cost) into the
  task's checkpoint so retries never produce fake duplicate usage entries.
- `getOrCreateTask` and `createOrGetTask` ensure exactly one `batch_tasks` row
  per `(run_id, stage, target)`. `createOrGetTask` is the write side that
  initializes a new task with a checkpoint stub.
- `safeJsonParse` decodes JSON checkpoint blobs, returning `null` on parse
  failure rather than throwing.
- `validateRefinedModules` runs the structural checks on the refined module
  set (uniqueness, non-empty coverage, partition invariants) and surfaces a
  typed error when something is wrong.
- `collectAllImports` walks the repo to gather imports used by the module
  context builder.
- `readOwnerFromFrontmatter` parses just enough of an existing page to
  recover the `owner:` value, returning a discriminated result so callers can
  distinguish `generated`/`human`/`mixed`/missing.
- `forceOwnerInFrontmatter` rewrites an existing page so its frontmatter
  declares a specific `owner` — used to restore `owner: mixed` after stage 4
  regenerates with `owner: generated` per the validator rule.
- `extractManualBlocksBySection` returns a map from `sectionSlug | null`
  (null = page-level) to the byte-exact contents of each `lw:manual` block in
  that section. The orchestrator uses this to re-inject human content into
  the generated page.
- `slugifyHeadingText` is the section-level slugifier: lowercase, strip
  diacritics, replace non-word characters, join with hyphens.
- `injectManualBlocksBySection` puts the previously extracted manual blocks
  back into the freshly generated page in their original section. It returns
  `null` if no injection is needed.
- `sectionRangeOf` computes the byte range that a heading's section occupies
  in the body, so manual blocks can be matched to the right section.
- `tryWriteAndVerify` performs the transactional write: snapshot the existing
  page, write the new content, run verify, and either commit or restore the
  previous page if verification fails.
- `verifyIssuesToValidationErrors` converts `VerifyIssue`s into structured
  validation errors that can drive a repair prompt.
- `attemptStage4Generation` runs one full stage-4 attempt cycle (build
  context, call the LLM, normalize + validate, optionally repair). It
  accumulates real usage on every attempt; the result is either a finalized
  page or a structured failure.
- `computeCostFromUsage` looks up pricing for the model referenced in the
  usage record and computes the USD cost; returns `null` when no pricing
  data is available (preserving the "incomplete" semantics).
- `buildModuleDocContext` assembles the prompt context for a module: the
  module's code (fair-truncated), its imports, and any other inputs the
  prompt builder needs.
- `buildFairTruncatedSource` truncates a module's source on a code-aware
  boundary (function/class boundaries, not mid-line) so prompts stay under
  the configured character budget without chopping identifiers.
- `getFileIdsForModule` returns the SQLite file ids that belong to a given
  module, used to cross-reference symbols and imports.
- `finalizeRun` closes out a run: stamps `finished_at`, computes the run
  summary, and triggers manifest writes.
- `buildResult` packages a successful (or partially-successful) run into a
  `BatchRunResult` with totals, per-module usage, failures, and the circuit-
  breaker flag.
- `statusToExitCode` maps a run status (`completed`,
  `completed_with_failures`, `aborted`) to a process exit code so the CLI
  can signal success vs partial-failure vs abort to its caller.

## Anchor-ledger test helpers
<!-- lw:anchors packages/core/src/anchor-ledger.test.ts#writeCode packages/core/src/anchor-ledger.test.ts#writeWiki packages/core/src/anchor-ledger.test.ts#nodeSqliteQuery -->

Helpers shared across the anchor-ledger test suite.

- `writeCode` creates a code file at `rel` under the test's `repoRoot`,
  ensuring its parent directory exists, and writes the supplied content.
- `writeWiki` does the same for a wiki page under the test's `repoRoot`,
  making it easy to set up `livewiki/...` pages without sprinkling path
  joins through every test.
- `nodeSqliteQuery` opens `.livewiki/index.db` in readonly mode and runs the
  given SQL, returning each row as a plain record. Tests use it to assert on
  persisted debt rows, anchors, and doc pages without coupling to the DB
  driver.
