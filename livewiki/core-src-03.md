---
title: Batch stage 5, status aggregation, and surgical repair fixtures
owner: generated
anchors:
  - packages/core/src/batch-stage5.test.ts#OneModuleAlwaysTruncatesLlm
  - packages/core/src/batch-stage5.test.ts#OneModuleAlwaysTruncatesLlm.generate
  - packages/core/src/batch-stage5.test.ts#RelaxedTopicMockLlm
  - packages/core/src/batch-stage5.test.ts#RelaxedTopicMockLlm.generate
  - packages/core/src/batch-stage5.test.ts#Stage5MockLlm
  - packages/core/src/batch-stage5.test.ts#Stage5MockLlm.generate
  - packages/core/src/batch-stage5.test.ts#TopicMockLlm
  - packages/core/src/batch-stage5.test.ts#TopicMockLlm.generate
  - packages/core/src/batch-stage5.test.ts#countStage5Tasks
  - packages/core/src/batch-stage5.test.ts#fileExists
  - packages/core/src/batch-stage5.test.ts#findTopicPagePath
  - packages/core/src/batch-stage5.test.ts#isTopicRefineRequest
  - packages/core/src/batch-stage5.test.ts#makeCompactAuxiliaryPage
  - packages/core/src/batch-stage5.test.ts#makeFlowPage
  - packages/core/src/batch-stage5.test.ts#makeFlowPageWithSections
  - packages/core/src/batch-stage5.test.ts#makeRelaxedFlowPage
  - packages/core/src/batch-stage5.test.ts#makeRelaxedTopicPage
  - packages/core/src/batch-stage5.test.ts#makeStrictFailingFlowPage
  - packages/core/src/batch-stage5.test.ts#makeStrictFailingTopicPage
  - packages/core/src/batch-stage5.test.ts#makeTopicPage
  - packages/core/src/batch-stage5.test.ts#makeValidPage
  - packages/core/src/batch-stage5.test.ts#parseClosedKeys
  - packages/core/src/batch-stage5.test.ts#parseFlowPrompt
  - packages/core/src/batch-stage5.test.ts#parseTopicPrompt
  - packages/core/src/batch-stage5.test.ts#readLatestRunTaskCheckpoint
  - packages/core/src/batch-stage5.test.ts#readTaskCheckpoint
  - packages/core/src/batch-stage5.test.ts#readTopicTaskCheckpoint
  - packages/core/src/batch-stage5.test.ts#topicFrontmatter
  - packages/core/src/batch-stage5.test.ts#topicRelatedPages
  - packages/core/src/batch-stage5.test.ts#writeFlowRepo
  - packages/core/src/batch-stage5.test.ts#writeGroupFlowRepo
  - packages/core/src/batch-stage5.test.ts#writeHubAndSpokeTopicRepo
  - packages/core/src/batch-stage5.test.ts#writeTopicEligibleRepo
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
  - packages/core/src/batch-surgical-repair.test.ts#SurgicalFlowMockLlm
  - packages/core/src/batch-surgical-repair.test.ts#SurgicalFlowMockLlm.generate
  - packages/core/src/batch-surgical-repair.test.ts#SurgicalModuleMockLlm
  - packages/core/src/batch-surgical-repair.test.ts#SurgicalModuleMockLlm.generate
  - packages/core/src/batch-surgical-repair.test.ts#SurgicalTopicMockLlm
  - packages/core/src/batch-surgical-repair.test.ts#SurgicalTopicMockLlm.generate
  - packages/core/src/batch-surgical-repair.test.ts#expectJoinedAttempts
  - packages/core/src/batch-surgical-repair.test.ts#makeEmptySectionPage
  - packages/core/src/batch-surgical-repair.test.ts#makeFlowPage
  - packages/core/src/batch-surgical-repair.test.ts#makeFlowPagePurposeBullets
  - packages/core/src/batch-surgical-repair.test.ts#makeTopicPage
  - packages/core/src/batch-surgical-repair.test.ts#makeTopicPageEmptyChangeMap
  - packages/core/src/batch-surgical-repair.test.ts#makeValidPage
  - packages/core/src/batch-surgical-repair.test.ts#parseClosedKeys
  - packages/core/src/batch-surgical-repair.test.ts#parseFlowPrompt
  - packages/core/src/batch-surgical-repair.test.ts#readTaskCheckpoint
  - packages/core/src/batch-surgical-repair.test.ts#readTopicTaskCheckpoint
  - packages/core/src/batch-surgical-repair.test.ts#surgicalOutcomeOf
  - packages/core/src/batch-surgical-repair.test.ts#writeFlowRepo
  - packages/core/src/batch-surgical-repair.test.ts#writeModuleRepo
  - packages/core/src/batch.test.ts#MockLlm
  - packages/core/src/batch.test.ts#MockLlm.generate
---

# Batch stage 5, status aggregation, and surgical repair fixtures

This module owns the test fixtures, mock LLM stubs, and aggregation helpers that exercise stage-5 (semantic flows / topics), the `batch status` report, and the surgical section-scoped repair path in `packages/core/src`.

## When to use this page

- **Run or extend** the stage-5 regression suite covering flow detection, topic refinement, and write-gate trips in `batch-stage5.test.ts`.
- **Inspect** how `buildStatusReport` aggregates checkpoint usage, surface legacy `diagnosticHistory` shapes, and emit per-task token costs in `batch-status.test.ts` and `batch-status.ts`.
- **Add** surgical-repair regression cases that exercise eligible / ineligible error sets, the cascade guard, and joined-attempts invariants in `batch-surgical-repair.test.ts`.
- **Update** the diagnostic summarization caps and the `summarizeDiagnosticErrors` contract used by the stage-4 LLM-attempt history in `batch-state.ts`.

## How it fits

This module lives under `packages/core/src/` and groups three sibling test suites plus the production helpers they depend on. `batch-stage5.test.ts`, `batch-status.test.ts`, and `batch-surgical-repair.test.ts` all import `runBatch` from `./batch.js` and the `LlmClient` interface from `./llm/index.js`. The status suite also imports `buildStatusReport` and `listRuns` from `./batch-status.js`, which in turn consume the `TaskCheckpoint` and `StageUsage` shapes defined in `./batch-state.ts`. The diagnostic-shape caps `DIAGNOSTIC_TEXT_CAP` and `DIAGNOSTIC_MAX_ERRORS` are re-exported by `batch-state.ts` and used by both the production summarizer and the tests that assert on truncated error slices.

## Stage-5 fixtures and prompt parsers
<!-- lw:anchors packages/core/src/batch-stage5.test.ts#parseClosedKeys packages/core/src/batch-stage5.test.ts#parseFlowPrompt packages/core/src/batch-stage5.test.ts#parseTopicPrompt packages/core/src/batch-stage5.test.ts#makeValidPage packages/core/src/batch-stage5.test.ts#makeCompactAuxiliaryPage packages/core/src/batch-stage5.test.ts#makeFlowPage packages/core/src/batch-stage5.test.ts#makeFlowPageWithSections packages/core/src/batch-stage5.test.ts#makeRelaxedFlowPage packages/core/src/batch-stage5.test.ts#makeStrictFailingFlowPage packages/core/src/batch-stage5.test.ts#makeTopicPage packages/core/src/batch-stage5.test.ts#makeRelaxedTopicPage packages/core/src/batch-stage5.test.ts#makeStrictFailingTopicPage packages/core/src/batch-stage5.test.ts#topicFrontmatter packages/core/src/batch-stage5.test.ts#topicRelatedPages -->

`parseClosedKeys(user)` extracts the closed anchor list from any stage-4 or stage-5 prompt by scanning lines that match `^- (\S+#\S+)$`. `parseFlowPrompt(user)` reads `# Flow: <slug>` and `# Participating modules <list>` and returns the `FlowPromptCtx` shape with `slug`, `moduleIds`, `closedKeys`, and the raw `user` string. `parseTopicPrompt(user)` returns a `TopicPrompt` object for the topic-refinement prompt variant.

The page-builder helpers emit model-shaped Markdown. `makeValidPage(closedKeyList)` builds a stage-4 module page with the standard frontmatter, anchors block, and "Details" placeholder run. `makeCompactAuxiliaryPage(closedKeyList)` emits the auxiliary-contract variant selected when the prompt asks for compact auxiliary output. `makeFlowPage(ctx, _diagramSource)` produces a stage-5 flow page in the MODEL-EMITTED form, placing the first closed key in `Purpose`, the second in `Ordered flow`, and any remainder in `Failure and recovery`; `_diagramSource` is intentionally unused because the orchestrator now inserts the diagram deterministically (see `generateFlowDiagram`/`insertFlowDiagramSection` in `flow-diagram.ts`). `makeFlowPageWithSections(...)` returns a variant with a configurable section layout, while `makeRelaxedFlowPage(ctx)` and `makeStrictFailingFlowPage(ctx)` exercise the relaxed (degraded) and strict-failing fixture paths. `makeTopicPage(user)` builds a compliant topic page; `makeRelaxedTopicPage(user)` and `makeStrictFailingTopicPage(user)` cover the relaxed and strict-failing topic variants. `topicFrontmatter(t, anchors)` produces the topic frontmatter block from a `TopicPrompt` and the assigned anchor list, and `topicRelatedPages(t)` returns the related-pages bullet list referencing modules and flows.

## Stage-5 mock LLM stubs
<!-- lw:anchors packages/core/src/batch-stage5.test.ts#Stage5MockLlm packages/core/src/batch-stage5.test.ts#Stage5MockLlm.generate packages/core/src/batch-stage5.test.ts#TopicMockLlm packages/core/src/batch-stage5.test.ts#TopicMockLlm.generate packages/core/src/batch-stage5.test.ts#RelaxedTopicMockLlm packages/core/src/batch-stage5.test.ts#RelaxedTopicMockLlm.generate packages/core/src/batch-stage5.test.ts#OneModuleAlwaysTruncatesLlm packages/core/src/batch-stage5.test.ts#OneModuleAlwaysTruncatesLlm.generate -->

`Stage5MockLlm` is the programmable stage-4 + stage-5 stub used by most regressions. Its `generate(req)` first records the call in `callLog`, increments `callCount`, then routes by prompt header: if `req.user` matches `^# Flow: \S+$`, it consumes the next flow-call slot, honors any `throwOnFlowCall` injection, optionally awaits `onBeforeFlowResponse(flowIdx)`, and answers either via the supplied `flowResponder(ctx, flowCallIndex)` queue or the default `makeFlowPage(ctx, "flowchart LR\n  cli --> core")`; otherwise it answers stage-4 prompts with `makeCompactAuxiliaryPage(closedKeys)` when the prompt mentions `compact auxiliary contract` and `makeValidPage(closedKeys)` for the standard module path. Each response carries a synthetic `{ inputTokens: 100, outputTokens: 50, model: "claude-test-mock" }` usage. `TopicMockLlm` is the stage-5 topic-path stub: its `generate(req)` returns a topic page built from the parsed prompt and the topic-relevant anchors. `RelaxedTopicMockLlm` extends `Stage5MockLlm` and overrides `generate(req)` to return the relaxed (degraded) topic page variant when it detects a topic-refinement request. `OneModuleAlwaysTruncatesLlm` is the truncation-fault stub: its `generate(req)` returns a deliberately truncated response on the single-module path so the verifier's `flow_diagram_too_large` / token-limit branches can be exercised.

## Stage-5 repo writers and checkpoint readers
<!-- lw:anchors packages/core/src/batch-stage5.test.ts#writeFlowRepo packages/core/src/batch-stage5.test.ts#writeGroupFlowRepo packages/core/src/batch-stage5.test.ts#writeTopicEligibleRepo packages/core/src/batch-stage5.test.ts#writeHubAndSpokeTopicRepo packages/core/src/batch-stage5.test.ts#countStage5Tasks packages/core/src/batch-stage5.test.ts#fileExists packages/core/src/batch-stage5.test.ts#findTopicPagePath packages/core/src/batch-stage5.test.ts#readTaskCheckpoint packages/core/src/batch-stage5.test.ts#readLatestRunTaskCheckpoint packages/core/src/batch-stage5.test.ts#readTopicTaskCheckpoint packages/core/src/batch-stage5.test.ts#isTopicRefineRequest -->

`writeFlowRepo(root)` materializes the minimal detectable-flow fixture (`cli` entry module → `core` persistence sink) used by happy-path and write-gate tests. `writeGroupFlowRepo(root)` produces a grouped flow fixture for tests that need multiple flows with shared participating modules. `writeTopicEligibleRepo()` and `writeHubAndSpokeTopicRepo()` create topic-eligible and hub-and-spoke topic fixtures, respectively. `countStage5Tasks(root)` returns the number of stage-5 tasks recorded in the index for a given repo root, and `fileExists(root, rel)` is a small async filesystem probe used by the write-gate and stale-cleanup assertions. `findTopicPagePath(root)` locates a topic page on disk, returning `null` when none exists. `readTaskCheckpoint(...)`, `readLatestRunTaskCheckpoint(...)`, and `readTopicTaskCheckpoint(root)` read the persisted `TaskCheckpoint` JSON for a specific `(stage, target)`, the latest run, or the topic-task row respectively, giving tests direct access to `usageHistory`, `diagnosticHistory`, and the `error` field. `isTopicRefineRequest(req)` is the predicate used by stubs and the orchestrator to route a `GenerateRequest` to the topic-refinement branch.

## Diagnostic summarization constants
<!-- lw:anchors packages/core/src/batch-state.ts#DIAGNOSTIC_MAX_ERRORS packages/core/src/batch-state.ts#DIAGNOSTIC_TEXT_CAP packages/core/src/batch-state.ts#summarizeDiagnosticErrors -->

`DIAGNOSTIC_TEXT_CAP = 200` is the per-field character cap applied to each `DiagnosticErrorSummary.offending` and `message` value when diagnostic records are persisted, and `DIAGNOSTIC_MAX_ERRORS = 50` caps the number of structured errors kept per `DiagnosticAttempt`. The exported `summarizeDiagnosticErrors(input)` function takes a readonly array of `ArtifactValidationError`, slices it to `DIAGNOSTIC_MAX_ERRORS`, and projects each surviving entry into a `DiagnosticErrorSummary` with the `offending` and `message` strings truncated to `DIAGNOSTIC_TEXT_CAP` characters; it returns both the surviving `errors` array and the `truncatedErrorCount` (number of dropped entries, clamped at zero). When `error.offending` or `error.sectionSlug` is `undefined`, those fields are omitted from the projected summary rather than emitted as `undefined`.

## Status-report aggregation helpers
<!-- lw:anchors packages/core/src/batch-status.ts#buildStatusReport packages/core/src/batch-status.ts#listRuns packages/core/src/batch-status.ts#emptyStageUsage packages/core/src/batch-status.ts#aggregateUsageFromCheckpoint packages/core/src/batch-status.ts#mergeStageUsage packages/core/src/batch-status.ts#parseRunSummary packages/core/src/batch-status.ts#safeJsonParse -->

`buildStatusReport(repoRoot, runId = null)` is the production entry point: it resolves `.livewiki/index.db` under `repoRoot`, picks the named run or the latest row, walks every `batch_tasks` row for that run, and emits a `BatchStatusReport` containing `run` (with parsed `summary`), `totals`, `byStage`, `byModule` (stage-4 only, keyed by module id), `tasks`, `failures`, and `pricingRefDate`. Per-task items additively surface `diagnosticHistory` and `communityCrossCheck` only when the checkpoint already carries those fields, preserving byte-stable output for older checkpoints. `listRuns(repoRoot)` returns the rows of `batch_runs` projected to `{ id, startedAt, finishedAt, status, startedBy }`, ordered newest first. `emptyStageUsage()` returns a zeroed `StageUsage` (`{ inputTokens: 0, outputTokens: 0, costUsd: null, models: [], usageIncomplete: false }`); `aggregateUsageFromCheckpoint(cp)` walks `cp.usageHistory`, treats an attempt as "known" when `usage` is a non-null object and `usageKnown !== false`, sums input/output tokens, collects distinct model names, sets `usageIncomplete` when any attempt is unknown, and keeps `costUsd` as `null` whenever any priced attempt is missing a price (no synthetic zero). `mergeStageUsage(a, b)` adds token counts, unions models, propagates `usageIncomplete`, and merges `costUsd` with the same null-takes-precedence rule. `safeJsonParse<T>(s)` is the tolerant JSON parser used to read `checkpoint_json` and `summary_json`. `parseRunSummary(raw)` decodes `summary_json` into a `BatchRunSummary | null`, returning `null` when the column is empty or unparseable.

## Status-report test fixtures and legacy-checkpoint seeding
<!-- lw:anchors packages/core/src/batch-status.test.ts#OneShotMockLlm packages/core/src/batch-status.test.ts#OneShotMockLlm.generate packages/core/src/batch-status.test.ts#ValidMockLlm packages/core/src/batch-status.test.ts#ValidMockLlm.generate packages/core/src/batch-status.test.ts#OneModuleMockLlm packages/core/src/batch-status.test.ts#OneModuleMockLlm.generate packages/core/src/batch-status.test.ts#seedLegacyCheckpoint -->

`OneShotMockLlm` is the unused-by-test stub whose `generate()` always throws "OneShotMockLlm.generate was called — should not happen"; it satisfies the `LlmClient` interface for tests that seed the DB directly instead of routing through the orchestrator. `ValidMockLlm` produces a compliant stage-4 module page (with anchors, `When to use this page` tasks, and the `Details` placeholder run) on every `generate()` and is used by the post-Lot A `diagnosticHistory` assertions. `OneModuleMockLlm` is the single-module stub used by the `unrepairable` and `missing_page_opening` regressions; its `generate()` returns a deterministic one-module response. `seedLegacyCheckpoint()` inserts a `batch_runs` row plus a single `batch_tasks` row whose `checkpoint_json` is the pre-Lot A shape (with `usageHistory` but no `diagnosticHistory`), returning the inserted `runId` so the test can verify that `buildStatusReport` loads it without ever adding a synthesized `diagnosticHistory` field to the per-task output (CONTRACT I5).

## Surgical-repair fixtures and assertions
<!-- lw:anchors packages/core/src/batch-surgical-repair.test.ts#parseClosedKeys packages/core/src/batch-surgical-repair.test.ts#parseFlowPrompt packages/core/src/batch-surgical-repair.test.ts#makeValidPage packages/core/src/batch-surgical-repair.test.ts#makeEmptySectionPage packages/core/src/batch-surgical-repair.test.ts#makeFlowPage packages/core/src/batch-surgical-repair.test.ts#makeFlowPagePurposeBullets packages/core/src/batch-surgical-repair.test.ts#makeTopicPage packages/core/src/batch-surgical-repair.test.ts#makeTopicPageEmptyChangeMap packages/core/src/batch-surgical-repair.test.ts#writeFlowRepo packages/core/src/batch-surgical-repair.test.ts#writeModuleRepo packages/core/src/batch-surgical-repair.test.ts#readTaskCheckpoint packages/core/src/batch-surgical-repair.test.ts#readTopicTaskCheckpoint packages/core/src/batch-surgical-repair.test.ts#expectJoinedAttempts packages/core/src/batch-surgical-repair.test.ts#surgicalOutcomeOf -->

The surgical-repair fixture helpers mirror the stage-5 harness. `parseClosedKeys(user)` re-uses the same line-by-line `^- (\S+#\S+)$` extraction. `parseFlowPrompt(user)` builds the same `FlowPromptCtx` shape (`slug`, `moduleIds`, `closedKeys`, `user`). `makeValidPage(closedKeyList)` emits the compliant stage-4 module page used to assert "page untouched" after a surgical cascade-rejection, and `makeEmptySectionPage(closedKeyList)` derives the same page with the trailing `Body.` paragraph removed to trigger an `empty_section` diagnostic. `makeFlowPage(ctx)` builds the model-emitted flow page variant used by stage-5 surgical repair tests; `makeFlowPagePurposeBullets(ctx)` substitutes the `Purpose` prose for a bullet list, producing a section-level `missing_page_opening` so the surgical path can resolve the target section from the error message. `makeTopicPage(user)` builds the compliant topic page; `makeTopicPageEmptyChangeMap(user)` drops the Change-map prose to surface a topic-level `empty_section`. `writeFlowRepo(root)` writes the minimal `cli` → `core` detectable-flow fixture, and `writeModuleRepo(root)` writes a single-module repo used by stage-4 surgical-repair cases. `readTaskCheckpoint(...)` and `readTopicTaskCheckpoint(root)` read the persisted `TaskCheckpoint` JSON from `.livewiki/index.db` for assertions on `attempt`, `usageHistory`, and `diagnosticHistory`. `expectJoinedAttempts(checkpoint)` asserts that the joined-attempts invariant holds — `usageHistory.length` equals `diagnosticHistory.length` (when `diagnosticHistory` is present) and the attempt numbers line up. `surgicalOutcomeOf(entry)` projects an unknown diagnostic entry to the surgical outcome string (`"surgical_ok"` or `"surgical_cascade_rejected"`) or returns `undefined` when the entry carries no surgical signal.

## Surgical-repair mock LLM stubs
<!-- lw:anchors packages/core/src/batch-surgical-repair.test.ts#SurgicalModuleMockLlm packages/core/src/batch-surgical-repair.test.ts#SurgicalModuleMockLlm.generate packages/core/src/batch-surgical-repair.test.ts#SurgicalFlowMockLlm packages/core/src/batch-surgical-repair.test.ts#SurgicalFlowMockLlm.generate packages/core/src/batch-surgical-repair.test.ts#SurgicalTopicMockLlm packages/core/src/batch-surgical-repair.test.ts#SurgicalTopicMockLlm.generate -->

`SurgicalModuleMockLlm` is the stage-4 surgical-path stub; its `generate(req)` answers module prompts with surgical-compliant content (e.g., the empty-section page when the previous attempt was flagged `empty_section`) so the eligible-error branch can be exercised without a real LLM. `SurgicalFlowMockLlm` is the stage-5 flow surgical-path stub; its `generate(req)` detects the `# Flow:` header and returns `makeFlowPagePurposeBullets(ctx)` (or another fixture) so the section-resolved repair target lands in `Purpose`. `SurgicalTopicMockLlm` is the topic-page surgical stub; its `generate(req)` returns `makeTopicPageEmptyChangeMap(user)` on the topic path to drive a topic-level `empty_section` repair. Each stub exposes a fixed `provider = "anthropic"` and `model = "claude-test-mock"` and returns a synthetic `{ inputTokens: 100, outputTokens: 50, ... }` usage so the orchestrator records a known attempt in the checkpoint's `usageHistory`.

## Base batch orchestrator fixture
<!-- lw:anchors packages/core/src/batch.test.ts#MockLlm packages/core/src/batch.test.ts#MockLlm.generate -->

`MockLlm` is the simplest stub used by the base `batch.test.ts` orchestrator regressions. Its `generate(req)` records the call into `callLog` (system, user, and the dynamic `maxTokens` budget), then extracts the module id from the first `# Module: <id>` line and the first closed key from `^- (.+?#[\w.]+)$` to build a valid module page that emits `title`, `owner: generated`, an `anchors` block with that key, the `When to use this page` and `How it fits` openers, and a `Details` placeholder run. The returned usage is `{ inputTokens: 100, outputTokens: 50, model: this.model }`. The dynamic-output-token-budget regressions read `mockLlm.callLog` to assert that a 40-symbol module clears the old 8192 ceiling, that the default tiny module stays below it, and that the `outputTokenStrategy: "fixed"` config overrides the dynamic formula.

<!-- livewiki:navigate:start -->
## Navigate

- Flow: [CLI to persistence flow — entry through `livewiki batch` to the SQLite index](flows/cli-src-01-to-core-src-05.md)
- [Core batch pipeline and call-graph analytics](core-src-04.md) — dependency and dependent
- [Core source module 09 — orientation, parser, pointer, output budget, navigation](core-src-09.md) — dependency and dependent
- [Anchor ledger and artifact repair](core-src-01.md) — dependency and dependent

> Coverage note: this module's source (6 files, ~132k chars) exceeded the prompt budget and was excerpted; this page documents the closed-list symbols.
<!-- livewiki:navigate:end -->
