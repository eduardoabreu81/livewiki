---
title: Stage 4 artifact normalization, validation, and auxiliary page assembly
owner: generated
anchors:
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
  - packages/core/src/artifact-repair.ts#MECHANICAL_STAGE4_CODES
  - packages/core/src/artifact-repair.ts#MECHANICAL_UPPER_BOUND_CODES
  - packages/core/src/artifact-repair.ts#TOPIC_SECTION_HEADING_MAP
  - packages/core/src/artifact-repair.ts#escapeFirstUnmatchedInlineDelimiter
  - packages/core/src/artifact-repair.ts#removeLaterSectionAnchorOccurrences
  - packages/core/src/artifact-repair.ts#repairStage4ArtifactMechanically
  - packages/core/src/artifact-repair.ts#repairUpperBoundArtifactMechanically
  - packages/core/src/artifact-repair.ts#sectionAncestorAt
  - packages/core/src/artifact-repair.ts#stripManualControlMarkers
  - packages/core/src/artifact-repair.ts#syncFrontmatterAnchorsList
  - packages/core/src/artifact.ts#DEGRADED_NOTICE_PREFIX
  - packages/core/src/artifact.ts#FLOW_DIAGRAM_SOURCE_MAX_CHARS
  - packages/core/src/artifact.ts#boundedOffendingExcerpt
  - packages/core/src/artifact.ts#buildDegradedNotice
  - packages/core/src/artifact.ts#checkModuleDiagramPlaceholder
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
  - packages/core/src/artifact.ts#extractInlineModuleDiagram
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
  - packages/core/src/auxiliary-page.ts#disambiguateHeadings
  - packages/core/src/auxiliary-page.ts#generateAuxiliaryModulePage
  - packages/core/src/auxiliary-page.ts#howItFitsParagraph
  - packages/core/src/auxiliary-page.ts#humanizeModuleId
  - packages/core/src/auxiliary-page.ts#referenceParagraph
---

# Stage 4 artifact normalization, validation, and auxiliary page assembly

This page documents the stage 4 artifact pipeline that normalizes and validates generated Markdown, the anchor ledger that reconciles those pages against the code index, the mechanical repairer for deterministic fixes, and the auxiliary page generator for non-product modules.

## When to use this page

- **Audit the stage 4 contract** by reading `artifact.ts` to see exactly which structural rules the validator enforces on a generated page (frontmatter identity, anchors closed list, prose-vs-marker placement, opening shape, TODO ban).
- **Trace anchor reconciliation** by reading `anchor-ledger.ts` to follow a page from `.md` parse, through anchor upsert and manual-block reconciliation, to debt creation on symbol move/change/delete.
- **Debug a deterministic repair** by checking the closed sets in `artifact-repair.ts` (`MECHANICAL_STAGE4_CODES`, `MECHANICAL_UPPER_BOUND_CODES`) and the failure paths of `repairStage4ArtifactMechanically` / `repairUpperBoundArtifactMechanically`.
- **Generate or audit an auxiliary page** by reading `auxiliary-page.ts`, which assembles the compact contract directly from indexed symbols without an LLM call.

## How it fits

This module sits inside `packages/core/src` and provides the deterministic backbone for the stage 4 generation pipeline. `artifact.ts` defines the contract: every generated page must satisfy a strict structural shape, and the validator returns structured error codes rather than trying to silently fix violations. `artifact-repair.ts` builds on that contract by applying well-scoped mechanical repairs for the closed set of fixable codes, always re-validating before returning; anything outside the closed set fails closed and returns `null`. `anchors.ts` parses the wiki Markdown to surface page anchors, section anchors (bound to their preceding heading), and manual-block ranges so other stages can distinguish protected human zones from generated prose. `anchor-ledger.ts` consumes that parsed output together with the code index, upserts `(doc_page, section, symbol)` rows, detects moved symbols via content-hash fallback, and writes both the DB and the Markdown rewrite — except inside `lw:manual` blocks or `owner: human` pages, which are protected by rule #6. `auxiliary-page.ts` produces the compact page shape for non-product modules directly from indexed symbols, sidestepping the LLM loop that previously drifted off the contract.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-01.mmd
```

## Anchor extraction and manual-block parsing

<!-- lw:anchors packages/core/src/anchors.ts#extractAnchors packages/core/src/anchors.ts#isInsideAny packages/core/src/anchors.ts#slugify -->

`extractAnchors(source)` is the single entry point that turns a wiki Markdown page into a structured `ExtractedAnchors`: frontmatter anchors (page-level), section anchors bound to their preceding heading, manual-block ranges, the parsed frontmatter object, the declared `owner`, and the body string. Code spans are masked before scanning so that marker-shaped tokens inside backticks cannot be misread as anchor delimiters.

```ts
export function extractAnchors(source: string): ExtractedAnchors {
```

Manual blocks are scanned as start/end events on the body — nested `lw:manual` opens without a matching close are dropped silently (verify surfaces structural problems later). `isInsideAny(start, end, blocks)` is the containment check: every section anchor records whether its marker falls inside a manual block so that downstream stages (the ledger in particular) can distinguish "anchor invalidated because code changed" from "anchor sits in a human-protected zone".

```ts
function isInsideAny(start: number, end: number, blocks: ManualBlock[]): boolean {
```

`slugify(heading)` is the heading-to-anchor slug helper used both here and in `artifact.ts`; it lowercases, strips diacritics via NFD, drops punctuation, and joins words with hyphens.

```ts
export function slugify(heading: string): string {
```

## Stage 4 artifact normalization and validation

<!-- lw:anchors packages/core/src/artifact.ts#normalizeStage4Artifact packages/core/src/artifact.ts#validateStage4Artifact packages/core/src/artifact.ts#hasRealProse packages/core/src/artifact.ts#validateExactTopicList packages/core/src/artifact.ts#checkRequiredPageOpening packages/core/src/artifact.ts#checkRequiredTopicOpening packages/core/src/artifact.ts#checkRequiredFlowOpening packages/core/src/artifact.ts#checkModuleDiagramPlaceholder packages/core/src/artifact.ts#flowSectionEnd packages/core/src/artifact.ts#flowSectionProseFailure packages/core/src/artifact.ts#findExactOpeningH2 packages/core/src/artifact.ts#findOpeningHeadingCandidate packages/core/src/artifact.ts#findNextH2 packages/core/src/artifact.ts#findFirstTodoPlaceholder packages/core/src/artifact.ts#findNextImplementationHeading packages/core/src/artifact.ts#firstPresentIndex packages/core/src/artifact.ts#offendingHeading packages/core/src/artifact.ts#openingSnippet packages/core/src/artifact.ts#proseBlockFailure packages/core/src/artifact.ts#err packages/core/src/artifact.ts#findOriginalLineStart packages/core/src/artifact.ts#findOriginalLineEnd packages/core/src/artifact.ts#countLines packages/core/src/artifact.ts#boundedOffendingExcerpt packages/core/src/artifact.ts#slugifyHeading packages/core/src/artifact.ts#lastHeadingBefore -->

`normalizeStage4Artifact(raw)` strips one leading `<think>…</think>` block, rejects an unclosed or reasoning-only output, and unwraps one outer ` ```markdown ` or ` ```md ` fence before handing the content to validation. The normal path is normalization-then-validation; the abnormal path (unclosed think block, no frontmatter, etc.) returns the structured errors instead of trying to fix them.

```ts
export function normalizeStage4Artifact(raw: string): NormalizeResult {
```

`validateStage4Artifact(artifact, closedKeyList, context?)` is the structural gate. It enforces the frontmatter shape (explicit `owner: generated`, non-empty `anchors:` when the closed list is non-empty), requires the closed list to be covered INDEPENDENTLY by both the frontmatter anchors list AND the union of section-marker keys, rejects duplicate keys within or across those two locations, requires real prose under every anchored section (`hasRealProse`), rejects unclosed fences/inline-code spans, and bans `TODO`/`TBD` placeholders outside fenced code and manual blocks. When `context.pageKind` is `"flow"` or `"topic"`, the opening contract switches to that page kind and additional section-binding rules apply (each `lw:anchors` marker must sit under a permitted ancestor H2, and required sections must keep at least one marker). Validation is fail-closed: any unrecognized code returns an error rather than passing silently.

```ts
export function validateStage4Artifact(
```

`hasRealProse(text)` is the section-content check used to reject empty or TODO-only sections behind an anchor marker — it scans for a non-blank line that is not a bare placeholder or marker before allowing the section to pass.

```ts
function hasRealProse(text: string): boolean {
```

`validateExactTopicList(...)` enforces the topic-page evidence contract: the topic identity (`expectedTopicTitle`, `expectedTopicOrder`, `expectedTopicIntent`), the participating modules and flows, and the closed key list must match exactly. Topic-key tier coverage is checked when `topicKeyGroups` and `topicProductKeys` are supplied.

The opening-shape checks share a common structure: each finds the expected first H2 via its canonical heading text (`findExactOpeningH2`, `findOpeningHeadingCandidate`, `findNextH2`), takes a bounded `openingSnippet`, and reports a `proseBlockFailure` if the section is empty or violates the relaxed/required shape. The flow contract additionally uses `flowSectionEnd` and `flowSectionProseFailure` to confirm that each required flow section carries real prose before the next H2, and `checkModuleDiagramPlaceholder` enforces the exact mermaid placeholder required by the contract.

```ts
function checkRequiredPageOpening(text: string, relaxed = false): PageOpeningFailure | null {
function checkRequiredTopicOpening(masked: string, expectedTitle?: string, relaxed = false): PageOpeningFailure | null {
function checkRequiredFlowOpening(
function checkModuleDiagramPlaceholder(
function flowSectionEnd(lines: ReadonlyArray<string>, headingIndex: number): number {
function flowSectionProseFailure(
```

Helpers around the line-oriented checks: `findFirstTodoPlaceholder` locates the first banned `TODO`/`TBD` in the body (excluding fenced code and manual blocks), `findNextImplementationHeading` finds the first H2/H3 after a given line, `firstPresentIndex` picks the smallest defined index from a small set, `offendingHeading` produces the heading text associated with a failure, `openingSnippet` returns a bounded slice of the opening lines, `err` constructs an `ArtifactValidationError`, `proseBlockFailure` builds the prose-block error shape, `findOriginalLineStart` / `findOriginalLineEnd` / `countLines` map between masked offsets and original line boundaries, `boundedOffendingExcerpt` produces a fixed-size excerpt for failure messages, `slugifyHeading` is the artifact-side slug normalizer, and `lastHeadingBefore` returns the nearest preceding H1/H2/H3.

```ts
function findExactOpeningH2(
function findOpeningHeadingCandidate(
function findNextH2(lines: ReadonlyArray<string>, start: number): number {
function findFirstTodoPlaceholder(text: string): TodoPlaceholderMatch | null {
function findNextImplementationHeading(lines: ReadonlyArray<string>, start: number): number {
function firstPresentIndex(...indices: number[]): number {
function offendingHeading(
function openingSnippet(lines: ReadonlyArray<string>): string {
function proseBlockFailure(
function err(
function findOriginalLineStart(text: string, offset: number): number {
function findOriginalLineEnd(text: string, offset: number): number {
function countLines(text: string, offset: number): number {
function boundedOffendingExcerpt(
function slugifyHeading(text: string): string {
function lastHeadingBefore(
```

## Degraded pages and diagram element counting

<!-- lw:anchors packages/core/src/artifact.ts#DEGRADED_NOTICE_PREFIX packages/core/src/artifact.ts#buildDegradedNotice packages/core/src/artifact.ts#dropDegradedNoticeLines packages/core/src/artifact.ts#extractDegradedTitle packages/core/src/artifact.ts#markDegradedArtifact packages/core/src/artifact.ts#FLOW_DIAGRAM_SOURCE_MAX_CHARS packages/core/src/artifact.ts#flowDiagramPlaceholder packages/core/src/artifact.ts#extractInlineFlowDiagram packages/core/src/artifact.ts#extractInlineModuleDiagram packages/core/src/artifact.ts#countFlowDiagramElements packages/core/src/artifact.ts#countFlowchartElements packages/core/src/artifact.ts#countSequenceElements packages/core/src/artifact.ts#countStateElements -->

When the strict loop exhausts its repair budget, a page may be completed under the relaxed contract and tagged with a degraded notice so readers see that anchors were verified but presentation is reduced. `DEGRADED_NOTICE_PREFIX` is the stable reader-visible prefix inserted as the FIRST body line; `buildDegradedNotice(title)` builds the full notice from that prefix plus the page title; `dropDegradedNoticeLines(text)` strips lines carrying the prefix during re-validation; `extractDegradedTitle(yamlBlock, body)` picks the first H1, then the frontmatter `title:`, then a neutral fallback; `markDegradedArtifact(content)` returns the content with the notice prepended.

```ts
export const DEGRADED_NOTICE_PREFIX = "> **Degraded page** —";
export function buildDegradedNotice(title: string): string {
function dropDegradedNoticeLines(text: string): string {
function extractDegradedTitle(yamlBlock: string, body: string): string {
export function markDegradedArtifact(content: string): string {
```

Diagram helpers enforce the size and shape contracts: `FLOW_DIAGRAM_SOURCE_MAX_CHARS` caps the inline flow-diagram source the stage accepts, `flowDiagramPlaceholder(slug)` returns the exact placeholder the writer must embed (and the validator must find), and `extractInlineFlowDiagram` / `extractInlineModuleDiagram` pull the embedded mermaid block back out of the page. `countFlowDiagramElements(source)` is the public entry point that dispatches to the flowchart / sequence / state counters; each of those walks the body lines to count nodes, edges, and tiers so a flow page can be checked against `context.flowKeyGroups`.

```ts
export const FLOW_DIAGRAM_SOURCE_MAX_CHARS = 8000;
export function flowDiagramPlaceholder(slug: string): string {
export function extractInlineFlowDiagram(
export function extractInlineModuleDiagram(
export function countFlowDiagramElements(source: string): FlowDiagramElementCount {
function countFlowchartElements(body: string[]): FlowDiagramElementCount {
function countSequenceElements(body: string[]): FlowDiagramElementCount {
function countStateElements(body: string[]): FlowDiagramElementCount {
```

## Mechanical repair of stage 4 and upper-bound artifacts

<!-- lw:anchors packages/core/src/artifact-repair.ts#MECHANICAL_STAGE4_CODES packages/core/src/artifact-repair.ts#MECHANICAL_UPPER_BOUND_CODES packages/core/src/artifact-repair.ts#TOPIC_SECTION_HEADING_MAP packages/core/src/artifact-repair.ts#escapeFirstUnmatchedInlineDelimiter packages/core/src/artifact-repair.ts#removeLaterSectionAnchorOccurrences packages/core/src/artifact-repair.ts#repairStage4ArtifactMechanically packages/core/src/artifact-repair.ts#repairUpperBoundArtifactMechanically packages/core/src/artifact-repair.ts#sectionAncestorAt packages/core/src/artifact-repair.ts#stripManualControlMarkers packages/core/src/artifact-repair.ts#syncFrontmatterAnchorsList -->

The two repairers apply deterministic fixes to specific validation codes and re-validate before returning — both return `null` whenever they cannot guarantee a clean result.

`repairStage4ArtifactMechanically(artifact, errors, closedKeyList, context?)` only acts when every error code is in `MECHANICAL_STAGE4_CODES` (`unclosed_markdown`, `missing_closed_key`, `empty_section`, `duplicate_anchor`, `model_invented_manual`); any unrecognized code aborts via `return null`. Inside the closed set it can escape one unmatched inline delimiter per pass (capped at `MAX_INLINE_DELIMITER_REPAIRS`), append a single `## Additional indexed symbols` section when section-level `missing_closed_key` keys are listed in the closed list, fill an empty anchored section by inserting a fixed explanatory paragraph after each empty marker, deduplicate section markers, and strip invented `lw:manual` markers. Every repaired artifact must pass a full `validateStage4Artifact` re-check or the function returns `null`.

```ts
export const MECHANICAL_STAGE4_CODES = [
export function repairStage4ArtifactMechanically(
```

`repairUpperBoundArtifactMechanically(artifact, errors, closedKeyList, context, keySectionMap?, headingMap?)` applies mechanical fixes to flow and topic pages under the upper-bound contract (frontmatter anchors and section-marker keys only need to equal each other, not the full closed list). It only acts on `MECHANICAL_UPPER_BOUND_CODES` (`duplicate_anchor`, `missing_closed_key`) and skips — rather than fails closed on — unrecognized codes, since the final full re-validation is the actual safety net. Unrecognized co-occurring errors no longer abort the whole repair (previously they did, see the priority-0 follow-up). When `keySectionMap` is supplied, deduping a key with more than one occurrence PREFERS the occurrence sitting in that key's assigned section over "keep first", with required-section coverage taking precedence over the assignment preference; `headingMap` selects which page's H2 vocabulary to resolve ancestry against (`TOPIC_SECTION_HEADING_MAP` for topic pages, the flow map otherwise). Without `keySectionMap` the behavior is exactly the original "keep first occurrence".

```ts
export const MECHANICAL_UPPER_BOUND_CODES = [
export function repairUpperBoundArtifactMechanically(
```

Helpers: `TOPIC_SECTION_HEADING_MAP` is the read-only heading vocabulary used to resolve topic-page ancestry; `escapeFirstUnmatchedInlineDelimiter(text)` returns the text with the first unmatched inline delimiter escaped, or `null` if none is found; `removeLaterSectionAnchorOccurrences(content, keys)` keeps the first marker occurrence per key (or the one in the assigned section when supplied) and drops the later ones; `sectionAncestorAt(lines, offset)` returns the ancestor H2 slug at a given line; `stripManualControlMarkers(text)` removes `lw:manual`/`/lw:manual` markers and returns `null` if none were present; `syncFrontmatterAnchorsList(content, desiredKeys)` aligns the frontmatter `anchors:` list with a desired key order.

```ts
export const TOPIC_SECTION_HEADING_MAP: Readonly<Record<string, string>> = {
function escapeFirstUnmatchedInlineDelimiter(text: string): string | null {
function removeLaterSectionAnchorOccurrences(
function sectionAncestorAt(
function stripManualControlMarkers(text: string): string | null {
function syncFrontmatterAnchorsList(
```

## Ledger orchestration and persistence

<!-- lw:anchors packages/core/src/anchor-ledger.ts#run packages/core/src/anchor-ledger.ts#orchestrate packages/core/src/anchor-ledger.ts#AnchorParseError packages/core/src/anchor-ledger.ts#AnchorParseError.constructor packages/core/src/anchor-ledger.ts#collectWikiPages packages/core/src/anchor-ledger.ts#hashContent packages/core/src/anchor-ledger.ts#upsertDocPage packages/core/src/anchor-ledger.ts#upsertAnchor packages/core/src/anchor-ledger.ts#upsertUndocumented packages/core/src/anchor-ledger.ts#assigneeFor packages/core/src/anchor-ledger.ts#hasOpenDebt packages/core/src/anchor-ledger.ts#createDebt packages/core/src/anchor-ledger.ts#detectMoves -->

`run(repoRoot, opts)` is the public entry point: it ensures `.livewiki/` exists, opens the SQLite index at `.livewiki/index.db`, and delegates to `orchestrate`, closing the database on completion. `orchestrate(db, absRoot, opts)` is the loop that walks every wiki page, parses it, upserts `doc_pages` and `anchors`, reconciles manual blocks, then computes symbol-level move detection and emits debt rows for changed/moved/deleted anchors.

```ts
export async function run(
async function orchestrate(
```

Read failures and parse failures are both treated as `pagesSkipped` rather than aborts: a page that cannot be read or parsed keeps its previously persisted anchors and is reconciled on the next successful run. `AnchorParseError` is the typed exception thrown for unrecoverable parse failures; its constructor wraps the cause message with the wiki path so callers can locate the offending page.

```ts
export class AnchorParseError extends Error {
  constructor(wikiPath: string, cause: Error) {
```

`collectWikiPages(absRoot)` lists every `.md` file under `livewiki/`; `hashContent(content)` returns a stable hash used for change detection; `upsertDocPage(db, relPath, owner, hash, existing)` and `upsertAnchor(db, docPageId, sectionSlug, symbolKey, owner, inManualBlock, existing, initialHash)` insert or update rows using UNIQUE-on-`(doc_page_id, section_slug, symbol_key)` for anchors (the section page slot is keyed by `symbol_key` to avoid last-loaded-row overwrites that produced spurious `changed` debt); `upsertUndocumented(db, symbolKey, inManualBlock)` records an active symbol that no current page references, so it shows up on the verification side.

```ts
async function collectWikiPages(absRoot: string): Promise<{ relPath: string }[]> {
function hashContent(content: string): string {
function upsertDocPage(
function upsertAnchor(
function upsertUndocumented(
```

Move detection and debt emission: `detectMoves(deletedSymbols, activeSymbols, movedMap, result)` pairs each deleted symbol with an active symbol whose `content_hash` matches in a different file, populating `movedMap` (oldKey → newKey) and recording each pair in `result.movedPairs` for telemetry; `createDebt(db, anchorId, event, assignee)` inserts a row into the `debt` table (the partial index `idx_debt_open` makes the dedup query O(1)); `hasOpenDebt(db, anchorId, event)` returns true when an unresolved debt row already exists for that `(anchor_id, event)` so re-runs do not re-flag the same item; `assigneeFor(owner, inManualBlock)` derives the assignee from page ownership AND the in-manual-block flag — anchors inside a manual block always go to human, regardless of page owner (rule #6).

```ts
function detectMoves(
function createDebt(
function hasOpenDebt(
function assigneeFor(owner: Owner, inManualBlock: boolean): Assignee {
```

The "conservative twin policy" applied by the move path: a disappeared symbol is accepted as `moved` only when its short name + kind does NOT survive as an active symbol elsewhere. When a twin survives, the disappearance is classified by the normal rules (`changed` if the file was updated, `deleted` if the file is gone) and the original anchors are not rewritten — rewriting them would re-anchor the page to an implementation its prose does not describe, and verify cannot catch that because the anchor still exists. Exact rotations, two-identical-surviving-copies, and any case where a same-kind twin exists are all classified non-`moved` by design.

## Anchor rewrite on the Markdown source

<!-- lw:anchors packages/core/src/anchor-ledger.ts#rewriteSymbolKeyInPage packages/core/src/anchor-ledger.ts#rewriteFrontmatterAnchorsList packages/core/src/anchor-ledger.ts#rewriteBodyMarkers packages/core/src/anchor-ledger.ts#findFrontmatterEnd packages/core/src/anchor-ledger.ts#isDelimiterLineAt packages/core/src/anchor-ledger.ts#endOfLine packages/core/src/anchor-ledger.ts#nextLineStart packages/core/src/anchor-ledger.ts#escapeRegex packages/core/src/anchor-ledger.ts#extractManualBlockRangesFromBody packages/core/src/anchor-ledger.ts#reconcileManualBlocks -->

`rewriteSymbolKeyInPage(...)` is the rule-#3 implementation: when a symbol is detected as `moved`, the anchor is rewritten in BOTH the frontmatter `anchors:` list AND the body `lw:anchors` markers via safe-io, because the Markdown is the source of truth. The function returns null (no rewrite) whenever the target page is `owner: human` or whenever every occurrence of the key sits inside an `lw:manual` block — those cases emit debt with `assignee: human` instead of rewriting. `rewriteFrontmatterAnchorsList(...)` updates the YAML list between the `---` delimiters; `rewriteBodyMarkers(...)` updates each `lw:anchors` marker in the body without touching protected zones.

```ts
async function rewriteSymbolKeyInPage(
function rewriteFrontmatterAnchorsList(
function rewriteBodyMarkers(
```

Low-level line-scanning helpers: `findFrontmatterEnd(source)` returns the offset of the closing `---` line; `isDelimiterLineAt(source, offset)` checks for a `---` line at a given offset; `endOfLine(source, lineStart)` and `nextLineStart(source, lineStart)` step through line boundaries; `escapeRegex(s)` escapes regex metacharacters so anchor keys can be matched literally.

```ts
function findFrontmatterEnd(source: string): number {
function isDelimiterLineAt(source: string, offset: number): boolean {
function endOfLine(source: string, lineStart: number): number {
function nextLineStart(source: string, lineStart: number): number {
function escapeRegex(s: string): string {
```

Manual-block reconciliation: `extractManualBlockRangesFromBody(body)` walks the body to collect every `lw:manual … /lw:manual` range; `reconcileManualBlocks(db, docPageId, currentBlocks)` performs a one-to-one reconciliation per `doc_page_id` — duplicate historical rows are deduped (no UNIQUE constraint exists), exact start/end matches preserve the stored baseline hash even when the freshly recomputed hash differs, same-hash / different-offset blocks update offsets only, new blocks are inserted as fresh baselines, and unmatched existing rows are left in place so a removed or altered block remains detectable by verify.

```ts
function extractManualBlockRangesFromBody(
function reconcileManualBlocks(
```

## Auxiliary module page assembly

<!-- lw:anchors packages/core/src/auxiliary-page.ts#generateAuxiliaryModulePage packages/core/src/auxiliary-page.ts#howItFitsParagraph packages/core/src/auxiliary-page.ts#referenceParagraph packages/core/src/auxiliary-page.ts#disambiguateHeadings packages/core/src/auxiliary-page.ts#humanizeModuleId -->

`generateAuxiliaryModulePage({ module, role, symbols, closedKeyList })` produces the complete Markdown for one auxiliary module page (role: `test` | `fixture` | `tooling` | `docs`) without any LLM call. It writes the frontmatter (title, `owner: generated`, full `anchors:` list from the closed key list), the required H1, a one-sentence responsibility, `## When to use this page` with three role-specific bullets, `## How it fits`, and `## Reference` with one H3 + one anchor marker + one paragraph per symbol. The output always satisfies `validateStage4Artifact`'s auxiliary checks because the contract is fully mechanical.

```ts
export function generateAuxiliaryModulePage(opts: {
```

`howItFitsParagraph(module, roleLabel)` returns the `## How it fits` paragraph; the wording uses `file`/`files` based on `module.paths.length`. `referenceParagraph(module, roleLabel, symbol)` returns the per-symbol paragraph, truncating the SIGNATURE (not the assembled sentence) so the backtick pair wrapping the signature always stays balanced — slicing the finished sentence could land inside a fence and leave an `unclosed_markdown` artifact behind.

```ts
function howItFitsParagraph(module: Module, roleLabel: string): string {
function referenceParagraph(
```

`disambiguateHeadings(symbols)` appends the file basename to H3 headings whose symbol name appears more than once in the module, so two `render` methods in different files do not collide on the same heading. `humanizeModuleId(id)` is the deterministic fallback title used when no stage-2 `displayTitle` was accepted.

```ts
function disambiguateHeadings(
function humanizeModuleId(id: string): string {
```

<!-- livewiki:navigate:start -->
## Navigate

- Flow: [CLI command surface to core pipeline wiring](flows/cli-src-to-core-src-02.md)
- [core indexing, imports, flows, and frontmatter](core-src-04.md) — dependency and dependent
- [Safe I/O, section guarding, status reporting, and symbol extraction](core-src-09.md) — dependency
- [core topics, understanding, update metrics, update, and verify](core-src-10.md) — dependency and dependent

> Coverage note: this module's source (5 files, ~185k chars) exceeded the prompt budget and was excerpted; this page documents the closed-list symbols.
<!-- livewiki:navigate:end -->
