---
title: anchor ledger, artifact validation, and auxiliary page generation
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
  - packages/core/src/anchor-ledger.ts#endOfLine
  - packages/core/src/anchor-ledger.ts#escapeRegex
  - packages/core/src/anchor-ledger.ts#extractManualBlockRangesFromBody
  - packages/core/src/anchor-ledger.ts#findFrontmatterEnd
  - packages/core/src/anchor-ledger.ts#hasOpenDebt
  - packages/core/src/anchor-ledger.ts#hashContent
  - packages/core/src/anchor-ledger.ts#isDelimiterLineAt
  - packages/core/src/anchor-ledger.ts#nextLineStart
  - packages/core/src/anchor-ledger.ts#orchestrate
  - packages/core/src/anchor-ledger.ts#reconcileManualBlocks
  - packages/core/src/anchor-ledger.ts#rewriteBodyMarkers
  - packages/core/src/anchor-ledger.ts#rewriteFrontmatterAnchorsList
  - packages/core/src/anchor-ledger.ts#rewriteSymbolKeyInPage
  - packages/core/src/anchor-ledger.ts#run
  - packages/core/src/anchor-ledger.ts#upsertAnchor
  - packages/core/src/anchor-ledger.ts#upsertDocPage
  - packages/core/src/anchor-ledger.ts#upsertUndocumented
  - packages/core/src/anchors.ts#extractAnchors
  - packages/core/src/anchors.ts#isInsideAny
  - packages/core/src/anchors.ts#slugify
  - packages/core/src/artifact-repair.test.ts#makeFlowPage
  - packages/core/src/artifact-repair.test.ts#validateFlow
  - packages/core/src/artifact-repair.ts#escapeFirstUnmatchedInlineDelimiter
  - packages/core/src/artifact-repair.ts#removeLaterSectionAnchorOccurrences
  - packages/core/src/artifact-repair.ts#repairStage4ArtifactMechanically
  - packages/core/src/artifact-repair.ts#repairUpperBoundArtifactMechanically
  - packages/core/src/artifact-repair.ts#stripManualControlMarkers
  - packages/core/src/artifact-repair.ts#syncFrontmatterAnchorsList
  - packages/core/src/artifact.ts#FLOW_DIAGRAM_SOURCE_MAX_CHARS
  - packages/core/src/artifact.ts#boundedOffendingExcerpt
  - packages/core/src/artifact.ts#checkRequiredFlowOpening
  - packages/core/src/artifact.ts#checkRequiredPageOpening
  - packages/core/src/artifact.ts#checkRequiredTopicOpening
  - packages/core/src/artifact.ts#countFlowDiagramElements
  - packages/core/src/artifact.ts#countFlowchartElements
  - packages/core/src/artifact.ts#countLines
  - packages/core/src/artifact.ts#countSequenceElements
  - packages/core/src/artifact.ts#countStateElements
  - packages/core/src/artifact.ts#err
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
---

# Anchor ledger, artifact validation, and auxiliary page generation

This page documents the synchronization of wiki anchors against the indexed code, the structural validation and mechanical repair of stage-4 Markdown artifacts, and the deterministic generation of pages for non-product modules.

## When to use this page

- **Run** the anchor ledger after indexing when you need to upsert anchors into SQLite and detect `changed`/`moved`/`deleted` debt.
- **Validate** a stage-4 Markdown artifact against a closed key list when you need structured error codes before accepting or repairing it.
- **Repair** an artifact mechanically as a last-slot fallback when the artifact has well-shaped defects and you want a fail-closed recovery.
- **Generate** a non-product module page (`fixture` | `tooling` | `docs`) deterministically from indexed symbols when you want a guaranteed-satisfies-validator output with no LLM call.

## How it fits

This module lives under `packages/core/src/` and is consumed by the stage-2 orchestrator. The anchor ledger is the writer side of the Phase-2 anchor/debt pipeline: it reads each `livewiki/*.md`, parses anchors and manual blocks, upserts rows into the SQLite index opened by `db.ts`, and emits debt rows when symbols drift. The artifact layer sits between the LLM prompt layer (`prompts.ts`) and the page renderer: it normalizes raw model output (strips one leading `<think>…`, unwraps one outer markdown fence, rejects unclosed reasoning), then validates the frontmatter, section markers, prose, and closed-list coverage, returning a flat list of `ArtifactValidationError` codes. The artifact-repair layer is a content-safe last-slot fallback that takes those error codes and returns a transformed artifact only when every reported error is one of the supported shapes and the result re-validates. The auxiliary-page generator bypasses the LLM stage-4 loop for `fixture`/`tooling`/`docs` modules by assembling the same compact contract directly from indexed symbols. The included `*.test.ts` files exercise each layer with tmpdir-isolated repos, fixture flow pages, and synthetic failure shapes.

## Anchor ledger entry point and orchestration

<!-- lw:anchors packages/core/src/anchor-ledger.ts#AnchorParseError packages/core/src/anchor-ledger.ts#AnchorParseError.constructor packages/core/src/anchor-ledger.ts#run packages/core/src/anchor-ledger.ts#orchestrate packages/core/src/anchor-ledger.ts#collectWikiPages packages/core/src/anchor-ledger.ts#hashContent packages/core/src/anchor-ledger.ts#upsertDocPage packages/core/src/anchor-ledger.ts#upsertAnchor packages/core/src/anchor-ledger.ts#createDebt packages/core/src/anchor-ledger.ts#hasOpenDebt packages/core/src/anchor-ledger.ts#detectMoves packages/core/src/anchor-ledger.ts#upsertUndocumented packages/core/src/anchor-ledger.ts#assigneeFor -->

The ledger is exposed through `run`, which creates `.livewiki/`, resolves the SQLite path via `safe-io`, opens the index, and delegates to `orchestrate`. `AnchorParseError` wraps any frontmatter or anchor-extraction failure with the wiki path and underlying cause.

```ts
export async function run(
  repoRoot: string,
  opts: LedgerOptions = {},
): Promise<LedgerResult>
```

```ts
export class AnchorParseError extends Error {
  constructor(wikiPath: string, cause: Error) {
    super(`Falha ao parsear âncoras em ${wikiPath}: ${cause.message}`);
    this.name = "AnchorParseError";
  }
}
```

Inside `orchestrate`, `collectWikiPages` enumerates `livewiki/*.md`. Existing rows are pulled into three maps keyed by `wiki_path` (doc_pages), `${doc_page_id}|${section_slug ?? ""}|${symbol_key}` (anchors, to avoid overwriting multiple symbols on a single page slot), and `symbol_key` for active and deleted symbols. Each page is then parsed, upserted via `upsertDocPage`/`upsertAnchor`, diffed to compute new debt, and reconciled against deleted symbols by `detectMoves` (which uses `hashContent` and a name+signature fallback). Undocumented symbols are recorded via `upsertUndocumented`. The `assigneeFor` helper maps a page owner + whether an anchor lies inside a manual block to `"agent"` (the generated portion wins on mixed pages) or `"human"`. `createDebt` and `hasOpenDebt` open and look up debt rows for the deduplication and idempotency rules described in the file header. The source excerpt does not establish exhaustive behavior for every code path inside `orchestrate`.

## Markdown anchor and manual-block extraction

<!-- lw:anchors packages/core/src/anchors.ts#extractAnchors packages/core/src/anchors.ts#slugify packages/core/src/anchors.ts#isInsideAny packages/core/src/anchor-ledger.ts#findFrontmatterEnd packages/core/src/anchor-ledger.ts#isDelimiterLineAt packages/core/src/anchor-ledger.ts#endOfLine packages/core/src/anchor-ledger.ts#nextLineStart packages/core/src/anchor-ledger.ts#extractManualBlockRangesFromBody packages/core/src/anchor-ledger.ts#escapeRegex packages/core/src/anchor-ledger.ts#rewriteFrontmatterAnchorsList packages/core/src/anchor-ledger.ts#rewriteBodyMarkers packages/core/src/anchor-ledger.ts#rewriteSymbolKeyInPage packages/core/src/anchor-ledger.ts#reconcileManualBlocks -->

Frontmatter and section anchors are parsed by `extractAnchors`, which first delegates to `parseFrontmatter`, then scans the body (with code spans masked to preserve offsets) for `lw:anchors`, `lw:manual`, and `/lw:manual` markers. Manual block ranges are collected as a flat list (nested starts without a matching end are silently dropped) and used to flag any section anchor whose marker lies inside such a block via `inManualBlock`.

```ts
export function extractAnchors(source: string): ExtractedAnchors
```

```ts
export function slugify(heading: string): string
```

```ts
function isInsideAny(start: number, end: number, blocks: ManualBlock[]): boolean
```

`slugify` is used both for the section slug and for frontmatter/heading normalization (`slugifyHeading` in `artifact.ts`). The ledger rewrites the markdown (frontmatter anchors list and body `lw:anchors` markers) when a symbol is detected as `moved`, via `rewriteSymbolKeyInPage`, which calls into `rewriteFrontmatterAnchorsList` and `rewriteBodyMarkers` and respects manual-block and `owner: human` boundaries. `reconcileManualBlocks` keeps previously-stored manual ranges coherent after rewrite. Offset utilities — `findFrontmatterEnd`, `isDelimiterLineAt`, `endOfLine`, `nextLineStart`, `extractManualBlockRangesFromBody`, and `escapeRegex` — back the safe byte-level edits. The excerpt does not cover the full body of `reconcileManualBlocks` or the exact rewrite ordering inside `rewriteSymbolKeyInPage`.

## Anchor-ledger tests and helpers

<!-- lw:anchors packages/core/src/anchor-ledger.test.ts#writeCode packages/core/src/anchor-ledger.test.ts#writeWiki packages/core/src/anchor-ledger.test.ts#nodeSqliteQuery -->

The ledger test file creates an isolated repo + wiki + DB in a tmpdir per test, indexes with `runIndexer`, then runs the ledger and asserts on `LedgerResult` and DB rows. Two helpers create code and wiki files.

```ts
async function writeCode(rel: string, content: string): Promise<void>
```

```ts
async function writeWiki(rel: string, content: string): Promise<void>
```

```ts
function nodeSqliteQuery(repoRoot: string, sql: string): Array<Record<string, unknown>>
```

The tests cover the Phase-2 acceptance criteria: a baseline run upserts anchors without creating debt, editing an anchored function creates `changed` debt (assignee = `"agent"` for `owner: generated`, `"human"` for `owner: human`), section anchors become separate rows, and section anchors also emit `changed` debt when the function body is edited. The excerpt does not include the full `moved`/`deleted` test cases.

## Artifact normalization and structural validation

<!-- lw:anchors packages/core/src/artifact.ts#normalizeStage4Artifact packages/core/src/artifact.ts#validateStage4Artifact packages/core/src/artifact.ts#hasRealProse packages/core/src/artifact.ts#validateExactTopicList packages/core/src/artifact.ts#checkRequiredPageOpening packages/core/src/artifact.ts#checkRequiredTopicOpening packages/core/src/artifact.ts#checkRequiredFlowOpening packages/core/src/artifact.ts#flowSectionEnd packages/core/src/artifact.ts#flowSectionProseFailure packages/core/src/artifact.ts#findExactOpeningH2 packages/core/src/artifact.ts#findOpeningHeadingCandidate packages/core/src/artifact.ts#findNextH2 packages/core/src/artifact.ts#findFirstTodoPlaceholder packages/core/src/artifact.ts#findNextImplementationHeading packages/core/src/artifact.ts#firstPresentIndex packages/core/src/artifact.ts#offendingHeading packages/core/src/artifact.ts#openingSnippet packages/core/src/artifact.ts#proseBlockFailure packages/core/src/artifact.ts#err packages/core/src/artifact.ts#findOriginalLineStart packages/core/src/artifact.ts#findOriginalLineEnd packages/core/src/artifact.ts#countLines packages/core/src/artifact.ts#boundedOffendingExcerpt packages/core/src/artifact.ts#slugifyHeading packages/core/src/artifact.ts#lastHeadingBefore packages/core/src/artifact.ts#FLOW_DIAGRAM_SOURCE_MAX_CHARS packages/core/src/artifact.ts#flowDiagramPlaceholder packages/core/src/artifact.ts#extractInlineFlowDiagram packages/core/src/artifact.ts#countFlowDiagramElements packages/core/src/artifact.ts#countFlowchartElements packages/core/src/artifact.ts#countSequenceElements packages/core/src/artifact.ts#countStateElements -->

`normalizeStage4Artifact` strips one complete `<think>…` block at the start, unwraps one outer ` ```markdown ` or ` ```md ` fence, and rejects unclosed reasoning and reasoning-only output. `validateStage4Artifact` enforces the frontmatter (explicit `owner: generated`, `anchors:` present when the closed list is non-empty, every key in the closed list), section markers (every closed-list key cited in markers, no duplicates across markers), real prose after each anchored section, fully closed Markdown, banned `TODO`/`TBD` placeholders outside code spans and manual blocks, and rejects any `lw:manual` block in the body (rule #6). For `pageKind === "flow"` the module-opening contract is replaced with the flow contract (Purpose, Ordered flow, Diagram, Invariants, Failure and recovery, Related pages) and `modules:` is required in frontmatter; flow placement adds three R10.1 item D codes.

```ts
export function normalizeStage4Artifact(raw: string): NormalizeResult
```

```ts
export function validateStage4Artifact(
```

The opening-shape checks are split across `checkRequiredPageOpening`, `checkRequiredTopicOpening`, and `checkRequiredFlowOpening`; `flowSectionEnd` and `flowSectionProseFailure` look at the prose body inside the flow's allowed H2 sections. Heading and section navigation helpers — `findExactOpeningH2`, `findOpeningHeadingCandidate`, `findNextH2`, `findNextImplementationHeading`, `lastHeadingBefore`, `firstPresentIndex`, `offendingHeading`, `openingSnippet`, and the original-line pair `findOriginalLineStart`/`findOriginalLineEnd` — plus `countLines` and `boundedOffendingExcerpt` produce the `location`/`offending` excerpts attached to each `ArtifactValidationError`. `hasRealProse`, `proseBlockFailure`, `findFirstTodoPlaceholder`, and `slugifyHeading` gate the empty-section and placeholder checks. `validateExactTopicList` is the topic-page analogue of the closed-list check. The flow-diagram budget and element counters live alongside: `FLOW_DIAGRAM_SOURCE_MAX_CHARS` caps inline diagrams, `flowDiagramPlaceholder` emits the placeholder, `extractInlineFlowDiagram` pulls a mermaid body out, and `countFlowDiagramElements` dispatches to `countFlowchartElements`, `countSequenceElements`, and `countStateElements`. The low-level error builder `err` is the standard factory for `ArtifactValidationError` records. The excerpt does not show the full validator body; behavior beyond what is named here may exist.

## Artifact mechanical repair

<!-- lw:anchors packages/core/src/artifact-repair.ts#repairStage4ArtifactMechanically packages/core/src/artifact-repair.ts#repairUpperBoundArtifactMechanically packages/core/src/artifact-repair.ts#escapeFirstUnmatchedInlineDelimiter packages/core/src/artifact-repair.ts#removeLaterSectionAnchorOccurrences packages/core/src/artifact-repair.ts#stripManualControlMarkers packages/core/src/artifact-repair.ts#syncFrontmatterAnchorsList packages/core/src/artifact-repair.test.ts#makeFlowPage packages/core/src/artifact-repair.test.ts#validateFlow -->

`repairStage4ArtifactMechanically` is a content-safe last-slot fallback: it categorizes the supplied errors into `unclosed_markdown`, `missing_closed_key` (section), `empty_section`, `duplicate_anchor`, and `model_invented_manual`, applies the corresponding transforms, and returns `null` if any error has an unsupported code, if a transform does not change the content, or if the resulting content no longer passes `validateStage4Artifact`.

```ts
export function repairStage4ArtifactMechanically(
```

`repairUpperBoundArtifactMechanically` is the flow-page variant that uses the closed list as an upper bound rather than a required set (a key used on exactly one side is still `missing_closed_key`). The internal helpers are `escapeFirstUnmatchedInlineDelimiter` (balances the first inline-code delimiter mismatch, returning `null` when nothing to do), `removeLaterSectionAnchorOccurrences` (deduplicates keys cited in multiple section markers), `stripManualControlMarkers` (removes any `lw:manual`/`/lw:manual` the model invented), and `syncFrontmatterAnchorsList` (re-syncs the frontmatter list to the closed list for flow pages). The test helpers build a minimal compliant flow page and validate it through the full stage-4 artifact contract.

```ts
export function repairUpperBoundArtifactMechanically(
```

```ts
function escapeFirstUnmatchedInlineDelimiter(text: string): string | null
```

```ts
function removeLaterSectionAnchorOccurrences(
```

```ts
function stripManualControlMarkers(text: string): string | null
```

```ts
function syncFrontmatterAnchorsList(
```

```ts
function makeFlowPage(anchors: string[], modules: string[]): string
```

```ts
function validateFlow(content: string, closedKeyList: string[])
```

The artifact-repair tests assert fail-closed behavior on the R10.1 item D flow-placement codes (`anchor_in_disallowed_section`, `anchor_missing_in_required_section`, `anchor_missing_required_tier`) — these return `null` both alone and when accompanied by a supported code — and verify that the upper-bound repair dedupes duplicate section markers and back-fills a section-cited key missing from frontmatter. The excerpt does not include every assertion.

## Auxiliary module page generation

<!-- lw:anchors packages/core/src/auxiliary-page.ts#generateAuxiliaryModulePage packages/core/src/auxiliary-page.ts#howItFitsParagraph packages/core/src/auxiliary-page.ts#referenceParagraph packages/core/src/auxiliary-page.ts#disambiguateHeadings packages/core/src/auxiliary-page.ts#humanizeModuleId packages/core/src/auxiliary-page.test.ts#assertValid packages/core/src/auxiliary-page.test.ts#module -->

Auxiliary pages for `fixture` | `tooling` | `docs` modules are assembled directly from indexed symbols — no LLM call — so they always satisfy `validateStage4Artifact`'s auxiliary checks. `generateAuxiliaryModulePage` picks a title (`module.displayTitle` if present, else `humanizeModuleId`), writes frontmatter (with `anchors:` only when the closed list is non-empty), the fixed H2 set (`When to use this page`, `How it fits`, `Reference`), role-specific task bullets, and one H3 + one marker + one short paragraph per symbol.

```ts
export function generateAuxiliaryModulePage(opts: {
  module: Module;
  role: AuxiliaryRole;
  symbols: AuxiliarySymbolRow[];
  closedKeyList: readonly string[];
}): string
```

`howItFitsParagraph` produces a single sentence naming the module's path count and role; `referenceParagraph` builds a single-paragraph, code-span-balanced description truncated to `MAX_REFERENCE_PARAGRAPH_CHARS` (500) characters, with backticks in the signature stripped first so the wrapping backtick pair can never be left unbalanced. `disambiguateHeadings` ensures H3 headings remain unique when two symbols share a name across files (e.g. `### run (a.ts)` vs `### run (b.ts)`). `humanizeModuleId` is the fallback title generator. The tests build a fixture module, assert the generated artifact normalizes and validates cleanly, exercise disambiguation, signature sanitization, the 500-char cap, the empty-symbol case, the humanized title fallback, and the `displayTitle` override.

```ts
function howItFitsParagraph(module: Module, roleLabel: string): string
```

```ts
function referenceParagraph(
```

```ts
function disambiguateHeadings(
```

```ts
function humanizeModuleId(id: string): string
```

```ts
function module(overrides: Partial<Module> = {}): Module
```

```ts
function assertValid(artifact: string, closedKeyList: string[], moduleId: string, moduleRole: "fixture" | "tooling" | "docs")
```

The behavior of `referenceParagraph` and `disambiguateHeadings` beyond what is named above is not established by the supplied excerpt.
