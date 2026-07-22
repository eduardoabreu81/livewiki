---
title: Auxiliary module page generation and stage-4 artifact validation
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

# Auxiliary module page generation and stage-4 artifact validation

This page documents how `packages/core/src` reconciles livewiki anchor markers with the code index, normalizes and validates stage-4 Markdown artifacts, mechanically repairs a bounded set of structural defects, and assembles deterministic module pages for non-product roles.

## When to use this page

- **Run the anchor ledger** against a repository to upsert `anchors` rows and emit `changed`/`moved`/`deleted` debt.
- **Generate a deterministic module page** for a `fixture`, `tooling`, or `docs` module directly from the indexed symbols.
- **Validate or repair** a stage-4 artifact (module, flow, or topic) against its closed key list and opening contract.

## How it fits

This module groups three adjacent concerns under `packages/core/src`. The `anchor-ledger` and `anchors` files reconcile livewiki anchor markers with the code index and emit debt rows when anchors drift. The `artifact` and `artifact-repair` files define how stage-4 Markdown is normalized, validated against a closed key list, and mechanically repaired when the report fits a supported shape. The `auxiliary-page` files assemble a non-product module page deterministically from the indexed symbols, bypassing the stage-4 LLM loop. The supplied excerpt does not establish the complete call graph between these files; the symbols documented here are the ones visible in the source.

## Anchor extraction from Markdown

<!-- lw:anchors packages/core/src/anchors.ts#extractAnchors packages/core/src/anchors.ts#isInsideAny packages/core/src/anchors.ts#slugify -->

The `extractAnchors` function in `packages/core/src/anchors.ts` parses a Markdown source into page-level anchors (from the `anchors:` list in frontmatter), section-level anchors (from `lw:anchors` markers that follow an `H2`/`H3` heading), and ranges of manual blocks (from `lw:manual` open/close pairs). Each section anchor records its `sectionSlug`, `headingText`, the symbol keys listed in its marker, the byte offset of the marker, and an `inManualBlock` flag derived from the surrounding manual-block ranges. `slugify` lowercases, strips accents, and replaces non-alphanumeric runs with single hyphens; it is what produces the `sectionSlug` values. `isInsideAny` is a positional helper that tests whether a `[start, end]` interval falls inside any of the extracted manual-block ranges.

```ts
export function extractAnchors(source: string): ExtractedAnchors
```

The regexes `LW_ANCHORS_RE`, `LW_MANUAL_START_RE`, and `LW_MANUAL_END_RE` are the only markers recognized; `extractAnchors` masks code spans before scanning so that anchor-like syntax inside inline or fenced code does not get picked up. Manual blocks are matched as a flat start/end toggle — nested starts without a matching end are skipped silently. If the input has no frontmatter, the function still returns an empty `pageAnchors` list, no `sectionAnchors`, no `manualBlocks`, and defaults `owner` to `"generated"`.

```ts
export function slugify(heading: string): string
```

`slugify` is the heading-to-slug helper used to bind markers to their ancestor heading and to keep `sectionSlug` values consistent across runs.

## Anchor-ledger orchestration and debt

<!-- lw:anchors packages/core/src/anchor-ledger.ts#run packages/core/src/anchor-ledger.ts#orchestrate packages/core/src/anchor-ledger.ts#collectWikiPages packages/core/src/anchor-ledger.ts#upsertDocPage packages/core/src/anchor-ledger.ts#upsertAnchor packages/core/src/anchor-ledger.ts#hashContent packages/core/src/anchor-ledger.ts#detectMoves packages/core/src/anchor-ledger.ts#createDebt packages/core/src/anchor-ledger.ts#hasOpenDebt packages/core/src/anchor-ledger.ts#upsertUndocumented packages/core/src/anchor-ledger.ts#assigneeFor packages/core/src/anchor-ledger.ts#AnchorParseError packages/core/src/anchor-ledger.ts#AnchorParseError.constructor -->

The ledger's public entry point is `run(repoRoot, opts)`. It resolves the repository root, ensures `.livewiki/` exists through `safeIo.mkdir`, opens the SQLite index, then delegates to `orchestrate`. The visible orchestration:

1. `collectWikiPages(absRoot)` lists every `.md` under the wiki root.
2. Three maps are loaded from the DB: `existingDocPages` (keyed by `wiki_path`, carrying `content_hash` and `owner`), `existingAnchors` keyed by `${doc_page_id}|${section_slug ?? ""}|${symbol_key}`, and `existingSymbols` keyed by `symbol_key`. A separate `deletedSymbols` map is loaded for `moved` detection.
3. For each page, the file is parsed, `doc_pages` is upserted, and the extracted anchors are upserted into the `anchors` table. `upsertDocPage` and `upsertAnchor` are the row-level writers; `hashContent` is the visible content-hash helper that drives `changed` detection.

`detectMoves` reconciles moved symbols by `content_hash` (primary) or by name + signature fallback, and `createDebt` emits `changed`/`moved`/`deleted` rows. `assigneeFor(owner, inManualBlock)` resolves the assignee for a debt row: pages with `owner: generated` produce `agent`, `owner: human` produces `human`, and mixed pages resolve to `agent`; anchors sitting inside an `lw:manual` block resolve to `human` regardless of page owner (rule #6). `hasOpenDebt` is the predicate used to decide whether to reopen reconciliation, and `upsertUndocumented` records symbols that have no anchor in any page.

```ts
export class AnchorParseError extends Error {
  constructor(wikiPath: string, cause: Error) {
    super(`Falha ao parsear âncoras em ${wikiPath}: ${cause.message}`);
    this.name = "AnchorParseError";
  }
}
```

`AnchorParseError` is thrown when a page cannot be parsed; its constructor `constructor(wikiPath: string, cause: Error)` chains the underlying error's message and tags `this.name = "AnchorParseError"`. The excerpt does not establish whether `orchestrate` swallows that exception per-page or surfaces it; the visible path uses `collectWikiPages` and continues processing regardless of any individual parse failure.

## Markdown rewriting primitives

<!-- lw:anchors packages/core/src/anchor-ledger.ts#rewriteSymbolKeyInPage packages/core/src/anchor-ledger.ts#findFrontmatterEnd packages/core/src/anchor-ledger.ts#isDelimiterLineAt packages/core/src/anchor-ledger.ts#endOfLine packages/core/src/anchor-ledger.ts#nextLineStart packages/core/src/anchor-ledger.ts#extractManualBlockRangesFromBody packages/core/src/anchor-ledger.ts#rewriteFrontmatterAnchorsList packages/core/src/anchor-ledger.ts#rewriteBodyMarkers packages/core/src/anchor-ledger.ts#escapeRegex packages/core/src/anchor-ledger.ts#reconcileManualBlocks -->

The rewrite helpers operate on raw source strings and treat the frontmatter `---` block as a separately-edited region. `findFrontmatterEnd(source)` returns the byte offset of the closing `---` line. `isDelimiterLineAt(source, offset)` checks whether the line at `offset` is exactly `---`, which is what the rest of the ledger uses to find the frontmatter boundary; `endOfLine(source, lineStart)` returns the index of the newline that terminates the line starting at `lineStart`, and `nextLineStart(source, lineStart)` returns the index of the first character of the following line.

```ts
function findFrontmatterEnd(source: string): number
function isDelimiterLineAt(source: string, offset: number): boolean
function endOfLine(source: string, lineStart: number): number
function nextLineStart(source: string, lineStart: number): number
```

`extractManualBlockRangesFromBody` returns the half-open `[start, end)` ranges of `lw:manual` … `lw:/manual` blocks so that `rewriteBodyMarkers` and `rewriteSymbolKeyInPage` can avoid touching human-protected content. `rewriteFrontmatterAnchorsList` and `rewriteBodyMarkers` are the actual mutators; `rewriteSymbolKeyInPage` is the orchestrator that rewrites a moved/deleted key across the page. `escapeRegex` is the standard regex-escape helper used when constructing literal matchers for symbol keys. `reconcileManualBlocks` is the visible guard that ensures manual-block bytes survive a rewrite byte-for-byte. The source excerpt does not show all of these functions in full — only the symbols listed in the table are documented here.

```ts
function extractManualBlockRangesFromBody(/* ... */): /* ... */
function rewriteFrontmatterAnchorsList(/* ... */): /* ... */
function rewriteBodyMarkers(/* ... */): /* ... */
async function rewriteSymbolKeyInPage(/* ... */): /* ... */
function reconcileManualBlocks(/* ... */): /* ... */
function escapeRegex(s: string): string
```

## Ledger test helpers

<!-- lw:anchors packages/core/src/anchor-ledger.test.ts#writeCode packages/core/src/anchor-ledger.test.ts#writeWiki packages/core/src/anchor-ledger.test.ts#nodeSqliteQuery -->

```ts
async function writeCode(rel: string, content: string): Promise<void>
async function writeWiki(rel: string, content: string): Promise<void>
function nodeSqliteQuery(repoRoot: string, sql: string): Array<Record<string, unknown>>
```

The ledger tests share a per-test tmpdir plus three helpers. `writeCode(rel, content)` and `writeWiki(rel, content)` both resolve `rel` under the test's `repoRoot`, `mkdir -p` the parent, and write the file. `nodeSqliteQuery(repoRoot, sql)` is the synchronous query shim used to assert directly against the `.livewiki/index.db` after a ledger run. Together they form the test fixture: write source files, write wiki pages, run the indexer, run the ledger, then query.

## Stage-4 artifact normalization and validation

<!-- lw:anchors packages/core/src/artifact.ts#normalizeStage4Artifact packages/core/src/artifact.ts#validateStage4Artifact packages/core/src/artifact.ts#hasRealProse packages/core/src/artifact.ts#validateExactTopicList packages/core/src/artifact.ts#checkRequiredPageOpening packages/core/src/artifact.ts#checkRequiredTopicOpening packages/core/src/artifact.ts#checkRequiredFlowOpening packages/core/src/artifact.ts#flowSectionEnd packages/core/src/artifact.ts#flowSectionProseFailure packages/core/src/artifact.ts#findExactOpeningH2 packages/core/src/artifact.ts#findOpeningHeadingCandidate packages/core/src/artifact.ts#findNextH2 packages/core/src/artifact.ts#findFirstTodoPlaceholder packages/core/src/artifact.ts#findNextImplementationHeading packages/core/src/artifact.ts#firstPresentIndex packages/core/src/artifact.ts#offendingHeading packages/core/src/artifact.ts#openingSnippet packages/core/src/artifact.ts#proseBlockFailure packages/core/src/artifact.ts#err packages/core/src/artifact.ts#findOriginalLineStart packages/core/src/artifact.ts#findOriginalLineEnd packages/core/src/artifact.ts#countLines packages/core/src/artifact.ts#boundedOffendingExcerpt packages/core/src/artifact.ts#slugifyHeading packages/core/src/artifact.ts#lastHeadingBefore packages/core/src/artifact.ts#FLOW_DIAGRAM_SOURCE_MAX_CHARS packages/core/src/artifact.ts#flowDiagramPlaceholder packages/core/src/artifact.ts#extractInlineFlowDiagram packages/core/src/artifact.ts#countFlowDiagramElements packages/core/src/artifact.ts#countFlowchartElements packages/core/src/artifact.ts#countSequenceElements packages/core/src/artifact.ts#countStateElements -->

`normalizeStage4Artifact` strips a leading `<think>…` block (rejecting unclosed or reasoning-only outputs), unwraps one outer ` ```markdown ` / ` ```md ` fence, strips a BOM, and returns either the cleaned content or a structured `errors` array. `validateStage4Artifact` enforces the closed-list contract: every key from the closed list must appear exactly once in the frontmatter `anchors:` list AND exactly once across all `lw:anchors` section markers; `owner: generated` must be explicitly present; every fenced code block and inline-code span must be closed; the literal placeholder tokens `TODO` and `TBD` are banned outside code and outside manual blocks; manual blocks in the body are rejected because they are reserved for human content (rule #6).

The opening contract is selected per `pageKind`:

```ts
function checkRequiredPageOpening(text: string): PageOpeningFailure | null
function checkRequiredTopicOpening(masked: string, expectedTitle?: string): PageOpeningFailure | null
function checkRequiredFlowOpening(/* ... */): /* ... */
```

The helper `hasRealProse(text)` returns `true` when a section between markers contains non-empty, non-`TODO`/non-`TBD` prose; `validateExactTopicList` enforces an exact topic-key enumeration. For flow pages, `flowSectionEnd` finds the end of the section under a given heading, `flowSectionProseFailure` reports missing prose under one of the required headings, and `findExactOpeningH2`/`findOpeningHeadingCandidate`/`findNextH2`/`findNextImplementationHeading` walk the heading sequence. `findFirstTodoPlaceholder` locates a banned placeholder; `firstPresentIndex` picks the smallest of a list of indices; `offendingHeading`, `openingSnippet`, and `boundedOffendingExcerpt` build the diagnostic snippets; `err` constructs a single `ArtifactValidationError`. `lastHeadingBefore` is the visible helper that finds the nearest preceding heading at or before a given offset, and `slugifyHeading` is the heading-to-slug helper used to bind markers to their ancestor H2.

```ts
function findExactOpeningH2(/* ... */): /* ... */
function findOpeningHeadingCandidate(/* ... */): /* ... */
function findNextH2(lines: ReadonlyArray<string>, start: number): number
function findNextImplementationHeading(lines: ReadonlyArray<string>, start: number): number
function findFirstTodoPlaceholder(text: string): TodoPlaceholderMatch | null
function firstPresentIndex(...indices: number[]): number
function offendingHeading(/* ... */): /* ... */
function openingSnippet(lines: ReadonlyArray<string>): string
function boundedOffendingExcerpt(/* ... */): /* ... */
function lastHeadingBefore(/* ... */): /* ... */
function slugifyHeading(text: string): string
function err(/* ... */): /* ... */
function proseBlockFailure(/* ... */): /* ... */
function findOriginalLineStart(text: string, offset: number): number
function findOriginalLineEnd(text: string, offset: number): number
function countLines(text: string, offset: number): number
function flowSectionEnd(lines: ReadonlyArray<string>, headingIndex: number): number
function flowSectionProseFailure(/* ... */): /* ... */
```

`proseBlockFailure` is the wrapper that turns a missing-prose condition into a structured failure. The pair `findOriginalLineStart`/`findOriginalLineEnd` and `countLines` map offsets back to original-source line numbers for error reporting.

```ts
export const FLOW_DIAGRAM_SOURCE_MAX_CHARS = 8000;
export function flowDiagramPlaceholder(slug: string): string
export function extractInlineFlowDiagram(/* ... */): /* ... */
export function countFlowDiagramElements(source: string): FlowDiagramElementCount
function countFlowchartElements(body: string[]): FlowDiagramElementCount
function countSequenceElements(body: string[]): FlowDiagramElementCount
function countStateElements(body: string[]): FlowDiagramElementCount
```

`FLOW_DIAGRAM_SOURCE_MAX_CHARS` caps how much of a Mermaid source the diagram counter scans; `flowDiagramPlaceholder` builds the per-page placeholder; `extractInlineFlowDiagram` extracts a fenced `mermaid` block; and `countFlowchartElements`, `countSequenceElements`, and `countStateElements` count the elements inside each diagram flavor, rolled up by `countFlowDiagramElements`. These counters feed the flow-page validation rules.

## Mechanical artifact repair

<!-- lw:anchors packages/core/src/artifact-repair.ts#repairStage4ArtifactMechanically packages/core/src/artifact-repair.ts#repairUpperBoundArtifactMechanically packages/core/src/artifact-repair.ts#syncFrontmatterAnchorsList packages/core/src/artifact-repair.ts#stripManualControlMarkers packages/core/src/artifact-repair.ts#removeLaterSectionAnchorOccurrences packages/core/src/artifact-repair.ts#escapeFirstUnmatchedInlineDelimiter -->

```ts
export function repairStage4ArtifactMechanically(
  artifact: string,
  errors: ReadonlyArray<ArtifactValidationError>,
  closedKeyList: ReadonlyArray<string>,
  context?: Readonly<Stage4ValidationContext>,
): MechanicalArtifactRepairResult | null
export function repairUpperBoundArtifactMechanically(/* ... */): /* ... */
```

`repairStage4ArtifactMechanically` is the last-slot fallback. It classifies the incoming errors into supported shapes (unclosed inline markdown, missing section keys, empty anchored sections, duplicate section keys, invented manual markers). If any reported error is not in that supported set — including the R10.1 flow-placement codes `anchor_in_disallowed_section`, `anchor_missing_in_required_section`, and `anchor_missing_required_tier`, alone or combined with supported codes — the function returns `null` and stays fail-closed. Each supported shape has a matching repair record (`escape_unmatched_inline_delimiter`, `append_missing_section_anchors`, `fill_empty_anchored_section`, `remove_duplicate_section_anchors`, `strip_invented_manual_markers`). `repairUpperBoundArtifactMechanically` is the upper-bound variant used by flow pages: the closed list is treated as an upper bound rather than an exact assignment, so it can dedup a key cited in two section markers, add a section-cited key that the frontmatter list is missing, and re-sync the frontmatter `anchors:` list to the actually-cited keys.

```ts
function escapeFirstUnmatchedInlineDelimiter(text: string): string | null
function stripManualControlMarkers(text: string): string | null
function removeLaterSectionAnchorOccurrences(/* ... */): /* ... */
function syncFrontmatterAnchorsList(/* ... */): /* ... */
```

`escapeFirstUnmatchedInlineDelimiter` escapes the first unclosed backtick run (capped by `MAX_INLINE_DELIMITER_REPAIRS = 100` iterations before returning `null`). `stripManualControlMarkers` removes `lw:manual` … `lw:/manual` blocks the model invented — the validator rejects them, so stripping is the mechanical fix. `removeLaterSectionAnchorOccurrences` removes the later duplicates of a key cited in two section markers. `syncFrontmatterAnchorsList` rewrites the frontmatter `anchors:` list to match the set of keys actually cited in the body.

## Artifact repair tests

<!-- lw:anchors packages/core/src/artifact-repair.test.ts#makeFlowPage packages/core/src/artifact-repair.test.ts#validateFlow -->

```ts
function makeFlowPage(anchors: string[], modules: string[]): string
function validateFlow(content: string, closedKeyList: string[])
```

`makeFlowPage(anchors, modules)` is a test fixture that builds a minimal compliant flow page (frontmatter, `#` title, `## Purpose`, `## Ordered flow`, `## Diagram`, `## Invariants`, `## Failure and recovery`, `## Related pages`, and a `mermaid` block whose body is `flowDiagramPlaceholder("example-flow")`). The first anchor maps to the Purpose marker, the second to the Ordered-flow marker, and the rest collapse into the Failure-and-recovery marker. `validateFlow(content, closedKeyList)` wraps `validateStage4Artifact` with the matching `pageKind: "flow"` context (module id `example-flow`, role `product`, expected modules `a-mod`/`b-mod`, expected diagram source).

## Auxiliary module page generator

<!-- lw:anchors packages/core/src/auxiliary-page.ts#generateAuxiliaryModulePage packages/core/src/auxiliary-page.ts#howItFitsParagraph packages/core/src/auxiliary-page.ts#referenceParagraph packages/core/src/auxiliary-page.ts#disambiguateHeadings packages/core/src/auxiliary-page.ts#humanizeModuleId -->

`generateAuxiliaryModulePage` produces the complete Markdown artifact for one auxiliary module (role `fixture` | `tooling` | `docs`, per `classifyModuleRole`) directly from the indexed symbols — no LLM call. The visible contract is:

- Frontmatter `title:` (uses `module.displayTitle` if present, otherwise `humanizeModuleId(module.id)`), `owner: generated`, and an `anchors:` list that mirrors `closedKeyList` verbatim when non-empty.
- An H1 with the title and one opening sentence that names the module id and its role label.
- A `## When to use this page` H2 with three bullets drawn from `ROLE_BULLETS[role]`.
- A `## How it fits` H2 whose paragraph comes from `howItFitsParagraph(module, roleLabel)`.
- A `## Reference` H2 followed by one `### heading` per symbol, each with an `lw:anchors` marker and a `referenceParagraph` paragraph (capped at `MAX_REFERENCE_PARAGRAPH_CHARS = 500` total).

```ts
export function generateAuxiliaryModulePage(opts: {
  module: Module;
  role: AuxiliaryRole;
  symbols: AuxiliarySymbolRow[];
  closedKeyList: readonly string[];
}): string
function howItFitsParagraph(module: Module, roleLabel: string): string
function referenceParagraph(/* ... */): /* ... */
function disambiguateHeadings(/* ... */): /* ... */
function humanizeModuleId(id: string): string
```

`disambiguateHeadings(symbols)` returns `{ symbol, heading }` pairs and is what produces suffixes like `### run (a.ts)` when two symbols share a name across files. `humanizeModuleId(id)` is the visible fallback that derives a display title from the module id when `module.displayTitle` is missing. `referenceParagraph(module, roleLabel, symbol)` first strips backticks from the signature, then truncates the signature (not the assembled sentence) to keep the surrounding backtick pair balanced; this is why oversized signatures are cut at the signature boundary rather than mid-sentence. The visible test suite confirms that the output always passes `validateStage4Artifact` for the auxiliary contract.

## Auxiliary page test helpers

<!-- lw:anchors packages/core/src/auxiliary-page.test.ts#assertValid packages/core/src/auxiliary-page.test.ts#module -->

```ts
function module(overrides: Partial<Module> = {}): Module
function assertValid(artifact: string, closedKeyList: string[], moduleId: string, moduleRole: "fixture" | "tooling" | "docs")
```

`module(overrides)` is a small factory that returns a `Module` with `id: "test-fixtures"`, a single example path, and `symbolCount: 1`, applying any overrides. `assertValid(artifact, closedKeyList, moduleId, moduleRole)` normalizes the artifact via `normalizeStage4Artifact`, runs `validateStage4Artifact` with `pageKind: "module"`, and asserts both that `result.errors` is empty and that `result.ok` is true. These two helpers are the only fixtures used by every test in `auxiliary-page.test.ts`.

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
- Flow: [CLI entry to core-src-04 export — semantic product flow](flows/cli-src-to-core-src-04.md)
- [Batch orchestration, configuration, index, and diagram generation](core-src-03.md) — dependency and dependent
- [Stage-5 planning, prompt templates, and safe disk I/O core](core-src-08.md) — dependency
- [Livewiki core source — export, flows, frontmatter, gitignore, hashes](core-src-04.md) — dependency and dependent
<!-- livewiki:navigate:end -->
