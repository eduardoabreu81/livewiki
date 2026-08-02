---
title: Stage 4 artifact validator and auxiliary page assembly
owner: generated
anchors:
  - packages/core/src/artifact.ts#DEGRADED_NOTICE_PREFIX
  - packages/core/src/artifact.ts#FLOW_DIAGRAM_SOURCE_MAX_CHARS
  - packages/core/src/artifact.ts#boundedOffendingExcerpt
  - packages/core/src/artifact.ts#buildDegradedNotice
  - packages/core/src/artifact.ts#checkRequiredFlowOpening
  - packages/core/src/artifact.ts#checkRequiredPageOpening
  - packages/core/src/artifact.ts#checkRequiredTopicOpening
  - packages/core/src/artifact.ts#countFlowDiagramElements
  - packages/core/src/artifact.ts#countFlowchartElements
  - packages/core/src/artifact.ts#countLines
  - packages/core/src/artifact.ts#countSequenceElements
  - packages/core/src/artifact.ts#countStateElements
  - packages/core/src/artifact.ts#dropDegradedNoticeLines
  - packages/core/src/artifact.ts#err
  - packages/core/src/artifact.ts#extractDegradedTitle
  - packages/core/src/artifact.ts#extractInlineFlowDiagram
  - packages/core/src/artifact.ts#findExactOpeningH2
  - packages/core/src/artifact.ts#findFirstTodoPlaceholder
  - packages/core/src/artifact.ts#findNextH2
  - packages/core/src/artifact.ts#findNextImplementationHeading
  - packages/core/src/artifact.ts#findOpeningHeadingCandidate
  - packages/core/src/artifact.ts#findOriginalLineEnd
  - packages/core/src/artifact.ts#findOriginalLineStart
  - packages/core/src/artifact.ts#firstPresentIndex
  - packages/core/src/artifact.ts#flowDiagramPlaceholder
  - packages/core/src/artifact.ts#flowSectionEnd
  - packages/core/src/artifact.ts#flowSectionProseFailure
  - packages/core/src/artifact.ts#hasRealProse
  - packages/core/src/artifact.ts#lastHeadingBefore
  - packages/core/src/artifact.ts#markDegradedArtifact
  - packages/core/src/artifact.ts#normalizeStage4Artifact
  - packages/core/src/artifact.ts#offendingHeading
  - packages/core/src/artifact.ts#openingSnippet
  - packages/core/src/artifact.ts#proseBlockFailure
  - packages/core/src/artifact.ts#slugifyHeading
  - packages/core/src/artifact.ts#validateExactTopicList
  - packages/core/src/artifact.ts#validateStage4Artifact
  - packages/core/src/auxiliary-page.test.ts#assertValid
  - packages/core/src/auxiliary-page.test.ts#module
  - packages/core/src/auxiliary-page.ts#disambiguateHeadings
  - packages/core/src/auxiliary-page.ts#generateAuxiliaryModulePage
  - packages/core/src/auxiliary-page.ts#howItFitsParagraph
  - packages/core/src/auxiliary-page.ts#humanizeModuleId
  - packages/core/src/auxiliary-page.ts#referenceParagraph
  - packages/core/src/batch-community.test.ts#MockLlm
  - packages/core/src/batch-community.test.ts#MockLlm.generate
  - packages/core/src/batch-community.test.ts#readStage2Checkpoint
  - packages/core/src/batch-community.test.ts#writeDivergentFixture
  - packages/core/src/batch-concurrency.test.ts#FailingMockLlm
  - packages/core/src/batch-concurrency.test.ts#FailingMockLlm.calledModuleIds
  - packages/core/src/batch-concurrency.test.ts#FailingMockLlm.generate
  - packages/core/src/batch-concurrency.test.ts#ValidMockLlm
  - packages/core/src/batch-concurrency.test.ts#ValidMockLlm.calledModuleIds
  - packages/core/src/batch-concurrency.test.ts#ValidMockLlm.constructor
  - packages/core/src/batch-concurrency.test.ts#ValidMockLlm.generate
  - packages/core/src/batch-concurrency.test.ts#createRepo
  - packages/core/src/batch-concurrency.test.ts#makeRepo
  - packages/core/src/batch-repair.test.ts#ProgrammableMockLlm
  - packages/core/src/batch-repair.test.ts#ProgrammableMockLlm.generate
  - packages/core/src/batch-repair.test.ts#expectJoinedAttempts
  - packages/core/src/batch-repair.test.ts#makeBothFailingPage
  - packages/core/src/batch-repair.test.ts#makeInvalidPage
  - packages/core/src/batch-repair.test.ts#makeRelaxedOnlyPage
  - packages/core/src/batch-repair.test.ts#makeStrictFailingPage
  - packages/core/src/batch-repair.test.ts#makeValidPage
  - packages/core/src/batch-repair.test.ts#readStage4Checkpoint
  - packages/core/src/batch-review.test.ts#MockLlm
  - packages/core/src/batch-review.test.ts#MockLlm.generate
  - packages/core/src/batch-review.test.ts#executablePlanPaths
  - packages/core/src/batch-review.test.ts#makeCompactAuxiliaryPage
  - packages/core/src/batch-review.test.ts#seedFiveFileRepo
  - packages/core/src/batch-review.test.ts#stage2ErrorCode
---

# Stage 4 artifact validator and auxiliary page assembly

This module normalizes LLM stage-4 output, validates the resulting Markdown artifact against the closed anchor contract, and assembles auxiliary (`fixture` | `tooling` | `docs`) module pages deterministically, without an LLM call.

## When to use this page

- **Read** `normalizeStage4Artifact` and `validateStage4Artifact` when diagnosing a stage-4 repair-loop failure or audit finding.
- **Read** `generateAuxiliaryModulePage` when adding or changing a non-product module page.
- **Run** the batch and review test suites when modifying repair, concurrency, or community detection behavior.

## How it fits

Inside `packages/core/src`, this module sits at the seam between the LLM stages and the disk checkpoint. `artifact.ts` enforces the closed-anchor contract the orchestrator and reviewer rely on: frontmatter `owner: generated`, dual completeness of frontmatter `anchors:` and `lw:anchors` markers, no banned TODO/placeholder, fully closed Markdown, and the stage-5 flow opening contract when `context.pageKind === "flow"`. `auxiliary-page.ts` consumes the same index the main pipeline builds and emits fully compliant Markdown for non-product modules, bypassing the LLM stage-4 loop that used to drift from the exact shape. The remaining test files (`batch-community`, `batch-concurrency`, `batch-context`, `batch-repair`, `batch-review`) drive the integration behaviour of `runBatch` end-to-end against programmable LLM mocks.

## Stage-4 normalization and degraded marking
<!-- lw:anchors packages/core/src/artifact.ts#normalizeStage4Artifact packages/core/src/artifact.ts#DEGRADED_NOTICE_PREFIX packages/core/src/artifact.ts#buildDegradedNotice packages/core/src/artifact.ts#dropDegradedNoticeLines packages/core/src/artifact.ts#extractDegradedTitle packages/core/src/artifact.ts#markDegradedArtifact -->

`normalizeStage4Artifact(raw)` strips one leading `<think>…</think>` block, rejects an unclosed `<think>` and any reasoning-only response, and unwraps one outer ` ```markdown ` / ` ```md ` fence before handing the result to the validator.

```ts
export function normalizeStage4Artifact(raw: string): NormalizeResult
```

`DEGRADED_NOTICE_PREFIX` is the literal marker the degraded-notice machinery anchors on:

```ts
export const DEGRADED_NOTICE_PREFIX = "> **Degraded page** —";
```

`markDegradedArtifact(content)` prepends a degraded banner so downstream consumers can detect it without re-deriving the state. `buildDegradedNotice(title)` constructs the banner string, `extractDegradedTitle(yamlBlock, body)` recovers the original page title, and `dropDegradedNoticeLines(text)` strips the banner back out. None of these helpers is documented as accepting malformed input beyond the visible prefix contract, so callers must only apply them to Markdown that already conforms to the auxiliary page shape.

## Stage-4 artifact validator
<!-- lw:anchors packages/core/src/artifact.ts#validateStage4Artifact packages/core/src/artifact.ts#validateExactTopicList packages/core/src/artifact.ts#checkRequiredPageOpening packages/core/src/artifact.ts#checkRequiredTopicOpening packages/core/src/artifact.ts#checkRequiredFlowOpening packages/core/src/artifact.ts#findExactOpeningH2 packages/core/src/artifact.ts#findOpeningHeadingCandidate packages/core/src/artifact.ts#findNextH2 packages/core/src/artifact.ts#findNextImplementationHeading packages/core/src/artifact.ts#firstPresentIndex packages/core/src/artifact.ts#findFirstTodoPlaceholder packages/core/src/artifact.ts#hasRealProse packages/core/src/artifact.ts#flowSectionEnd packages/core/src/artifact.ts#flowSectionProseFailure packages/core/src/artifact.ts#proseBlockFailure packages/core/src/artifact.ts#offendingHeading packages/core/src/artifact.ts#openingSnippet packages/core/src/artifact.ts#err packages/core/src/artifact.ts#lastHeadingBefore packages/core/src/artifact.ts#findOriginalLineStart packages/core/src/artifact.ts#findOriginalLineEnd packages/core/src/artifact.ts#countLines packages/core/src/artifact.ts#boundedOffendingExcerpt packages/core/src/artifact.ts#slugifyHeading -->

`validateStage4Artifact` is the closed-list gate every generated page must pass.

```ts
export function validateStage4Artifact(
```

It returns a `ValidateResult` listing structured `ArtifactValidationError` codes; an empty list means the artifact is accepted. The visible contract requires:

- a valid `---` frontmatter with an explicit `owner: generated` line and an `anchors:` list (when the closed list is non-empty);
- every frontmatter `anchors:` key AND every `lw:anchors` section-marker key to be in the closed list, with completeness as two independent requirements (frontmatter alone and section markers alone must each contain every closed key exactly once);
- no duplicate keys in the frontmatter list and no key appearing in more than one section marker;
- every anchored section to be followed by real prose before the next heading, marker, or end of page;
- a fully closed Markdown body (no unclosed fences or inline-code spans);
- no `TODO`/`TBD` placeholders outside fenced or inline code;
- rejection of any `lw:manual` block in the body.

The helpers around it cooperate to produce the structured diagnostics: `checkRequiredPageOpening`, `checkRequiredTopicOpening`, and `checkRequiredFlowOpening` enforce the opening contract for module, topic, and flow page kinds respectively; `validateExactTopicList` enforces topic evidence coverage; `findExactOpeningH2`, `findOpeningHeadingCandidate`, `findNextH2`, `findNextImplementationHeading`, and `firstPresentIndex` walk the heading skeleton; `findFirstTodoPlaceholder`, `hasRealProse`, `flowSectionEnd`, `flowSectionProseFailure`, `proseBlockFailure`, `offendingHeading`, `openingSnippet`, `err`, and `lastHeadingBefore` build the diagnostic payload; and `findOriginalLineStart`, `findOriginalLineEnd`, `countLines`, `boundedOffendingExcerpt`, and `slugifyHeading` trim the offending excerpt to a fixed-width, line-anchored snippet suitable for repair prompts.

## Flow diagram source and element counting
<!-- lw:anchors packages/core/src/artifact.ts#FLOW_DIAGRAM_SOURCE_MAX_CHARS packages/core/src/artifact.ts#flowDiagramPlaceholder packages/core/src/artifact.ts#extractInlineFlowDiagram packages/core/src/artifact.ts#countFlowDiagramElements packages/core/src/artifact.ts#countFlowchartElements packages/core/src/artifact.ts#countSequenceElements packages/core/src/artifact.ts#countStateElements -->

The flow-opening contract binds the diagram section to an exact placeholder and counts its elements. The source budget is a fixed upper bound:

```ts
export const FLOW_DIAGRAM_SOURCE_MAX_CHARS = 8000;
```

`flowDiagramPlaceholder(slug)` renders the required placeholder for a given flow slug, `extractInlineFlowDiagram` pulls a fenced `mermaid` block out of the diagram section, and `countFlowDiagramElements` dispatches to `countFlowchartElements`, `countSequenceElements`, or `countStateElements` based on the diagram kind. The visible source enforces the upper bound only; it does not impose a lower bound on diagram source length.

## Auxiliary page assembly
<!-- lw:anchors packages/core/src/auxiliary-page.ts#generateAuxiliaryModulePage packages/core/src/auxiliary-page.ts#howItFitsParagraph packages/core/src/auxiliary-page.ts#referenceParagraph packages/core/src/auxiliary-page.ts#disambiguateHeadings packages/core/src/auxiliary-page.ts#humanizeModuleId -->

`generateAuxiliaryModulePage` is the deterministic alternative to the LLM stage-4 loop for non-product modules:

```ts
export function generateAuxiliaryModulePage(opts: {
```

For an `AuxiliaryRole` of `"fixture"`, `"tooling"`, or `"docs"`, the function emits a full Markdown artifact: frontmatter with `owner: generated`, an `anchors:` list populated from `closedKeyList` (omitted when the list is empty), the required opening structure, and one H3 + reference paragraph per indexed symbol. `howItFitsParagraph(module, roleLabel)` renders the prose that fits under the `## How it fits` heading and selects `"file"` versus `"files"` based on the module's path count; `referenceParagraph(module, roleLabel, symbol)` builds the per-symbol paragraph and truncates the signature so the paragraph stays under the 500-character single-paragraph limit while preserving backtick balance. `disambiguateHeadings(symbols)` appends the file basename to H3 titles when two symbols share a name across files, and `humanizeModuleId(id)` produces the deterministic fallback title used when no stage-2 `displayTitle` was accepted.

## Auxiliary page contract tests
<!-- lw:anchors packages/core/src/auxiliary-page.test.ts#module packages/core/src/auxiliary-page.test.ts#assertValid -->

`module(overrides)` is a `Partial<Module>` test factory defaulting to a single-path fixture module with one symbol, and `assertValid(artifact, closedKeyList, moduleId, moduleRole)` runs `normalizeStage4Artifact` and `validateStage4Artifact` against the artifact and asserts both calls return no errors. The visible tests cover full-contract auxiliary pages, zero-symbol empty closed lists, H3 disambiguation across files, signature backtick stripping, oversized reference paragraph truncation, the humanized-id fallback, and the stage-2 `displayTitle` override.

## Stage-2 community cross-check tests
<!-- lw:anchors packages/core/src/batch-community.test.ts#MockLlm packages/core/src/batch-community.test.ts#MockLlm.generate packages/core/src/batch-community.test.ts#writeDivergentFixture packages/core/src/batch-community.test.ts#readStage2Checkpoint -->

`MockLlm` is an offline `LlmClient` that synthesizes a closed-anchor module page by extracting `- <key>` lines from the user prompt and emitting a fixed-shape artifact with `owner: generated`. Its `generate(req)` increments `callCount` and returns a deterministic `GenerateResult`. The `writeDivergentFixture(repoRoot)` helper lays out a `src/a/{x,y}.ts` and `src/b/z.ts` tree where the directory heuristic disagrees with the import graph (x and z import each other while y is isolated). `readStage2Checkpoint(repoRoot)` opens `.livewiki/index.db` in read-only mode and parses the stage-2 `checkpoint_json` into a `TaskCheckpoint`.

## Stage-4 worker pool tests
<!-- lw:anchors packages/core/src/batch-concurrency.test.ts#ValidMockLlm packages/core/src/batch-concurrency.test.ts#ValidMockLlm.constructor packages/core/src/batch-concurrency.test.ts#ValidMockLlm.generate packages/core/src/batch-concurrency.test.ts#ValidMockLlm.calledModuleIds packages/core/src/batch-concurrency.test.ts#FailingMockLlm packages/core/src/batch-concurrency.test.ts#FailingMockLlm.generate packages/core/src/batch-concurrency.test.ts#FailingMockLlm.calledModuleIds packages/core/src/batch-concurrency.test.ts#createRepo packages/core/src/batch-concurrency.test.ts#makeRepo -->

`ValidMockLlm` records every prompt and tracks in-flight call depth to assert pool parallelism; its `constructor(private readonly delayMs = 5) {}` introduces artificial latency so concurrent workers overlap. `ValidMockLlm.generate(req)` returns a valid closed-anchor page keyed to the module id extracted from `# Module:` in the prompt, and `calledModuleIds()` returns the distinct module ids this mock received in stage-4 prompts. `FailingMockLlm` has the same shape but emits a bogus anchor key so every task exhausts its repair budget; its `calledModuleIds()` mirrors the valid variant. `createRepo(moduleIds)` seeds a fresh temp directory with one tiny module per id plus a `.livewiki/config.json` disabling stage 5, and `makeRepo(moduleIds)` wraps `createRepo` while registering the directory for `afterEach` cleanup.

## Stage-4 repair loop tests
<!-- lw:anchors packages/core/src/batch-repair.test.ts#ProgrammableMockLlm packages/core/src/batch-repair.test.ts#ProgrammableMockLlm.generate packages/core/src/batch-repair.test.ts#makeValidPage packages/core/src/batch-repair.test.ts#makeInvalidPage packages/core/src/batch-repair.test.ts#makeStrictFailingPage packages/core/src/batch-repair.test.ts#makeRelaxedOnlyPage packages/core/src/batch-repair.test.ts#makeBothFailingPage packages/core/src/batch-repair.test.ts#readStage4Checkpoint packages/core/src/batch-repair.test.ts#expectJoinedAttempts -->

`ProgrammableMockLlm` consumes a queued response per call, can throw on selected indices, and (with `autoPageFromPrompt = true`) auto-generates a valid closed-anchor page from the keys parsed out of the prompt. `ProgrammableMockLlm.generate(req)` records the prompt, advances `callCount`, and returns the next response or the last one as a fallback. `makeValidPage(closedKeyList)` builds a closed-anchor module artifact with the standard opening; `makeInvalidPage(uniqueText)` produces a header-only artifact that fails validation; `makeStrictFailingPage`, `makeRelaxedOnlyPage`, and `makeBothFailingPage` construct the three failure shapes used by recovery-tier tests. `readStage4Checkpoint(root, target)` opens the SQLite checkpoint for a specific stage-4 target and parses the `checkpoint_json`, and `expectJoinedAttempts(checkpoint)` asserts that `diagnosticHistory` and `usageHistory` have equal length with matching `attempt` indices.

## Review-finding regression tests
<!-- lw:anchors packages/core/src/batch-review.test.ts#MockLlm packages/core/src/batch-review.test.ts#MockLlm.generate packages/core/src/batch-review.test.ts#makeCompactAuxiliaryPage packages/core/src/batch-review.test.ts#seedFiveFileRepo packages/core/src/batch-review.test.ts#stage2ErrorCode packages/core/src/batch-review.test.ts#executablePlanPaths -->

`MockLlm` produces either a compact auxiliary page, a stage-4 module page from the prompt's closed keys, or a queued response, and records every usage tuple in `costInputs`. `MockLlm.generate(req)` increments `callCount` and returns the next queued response or synthesizes one based on whether the prompt mentions the compact auxiliary contract. `makeCompactAuxiliaryPage(closedKeys)` builds a reference-style auxiliary artifact with one H3 per key. `seedFiveFileRepo()` prepares a five-file repository fixture, `stage2ErrorCode()` reads the recorded stage-2 error code from the checkpoint, and `executablePlanPaths()` enumerates the executable plan paths used by the reviewer regression suite.

<!-- livewiki:navigate:start -->
## Navigate

- Flow: [CLI to persistence flow — entry through `livewiki batch` to the SQLite index](flows/cli-src-01-to-core-src-05.md)
- [Core Repair, Status, Sectioning, Symbols, and Risk Pipeline](core-src-11.md) — dependency
- [Core runtime config, schema, diagrams, diff preview, and export](core-src-05.md) — dependent
- [Core module identification, manifest I/O, and Markdown mask helpers](core-src-08.md) — dependency

> Coverage note: this module's source (8 files, ~307k chars) exceeded the prompt budget and was excerpted; this page documents the closed-list symbols.
<!-- livewiki:navigate:end -->
