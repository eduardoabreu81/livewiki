---
title: Anchor ledger, anchors parser, and stage-4 artifact normalization
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

# Anchor ledger, anchors parser, and stage-4 artifact normalization

This page documents the core package modules that synchronize wiki anchors against the indexed code graph, extract anchors and manual blocks from wiki markdown, normalize and validate stage-4 model artifacts, mechanically repair those artifacts, and deterministically assemble auxiliary (non-product) module pages.

## When to use this page

- **Run** `anchor-ledger` against a repo to refresh anchors and emit `changed` / `moved` / `deleted` debt rows against `livewiki/*.md`.
- **Parse** a wiki page's frontmatter, section `lw:anchors` markers, and `lw:manual` ranges via `extractAnchors` to drive downstream diff/verify passes.
- **Normalize and validate** the raw stage-4 model output with `normalizeStage4Artifact` and `validateStage4Artifact` before treating it as a doc artifact.
- **Repair or assemble** artifacts mechanically via `repairStage4ArtifactMechanically` / `repairUpperBoundArtifactMechanically`, or skip the LLM entirely with `generateAuxiliaryModulePage` for fixture/tooling/docs modules.

## How it fits

`packages/core/src/` hosts the structural backbone of livewiki's documentation pipeline. `anchor-ledger.ts` walks every page in `livewiki/`, extracts anchors, upserts them into the SQLite cache under `.livewiki/index.db`, and diffs the new state against the previous run to write debt rows whose `assignee` is derived from the page's `owner`. `anchors.ts` is the pure parser the ledger (and other tools) depend on to recognise page-level anchors (frontmatter `anchors:`), section anchors (`lw:anchors` markers after a heading), and `lw:manual` block ranges — together with the `inManualBlock` flag the ledger uses to decide whether an anchor can be rewritten on disk.

The stage-4 artifact pipeline is layered: `artifact.ts` normalises the raw model transcript (stripping a leading `<think>…`, unwrapping one outer ```` ```markdown ```` fence, rejecting unclosed reasoning) and then enforces the page-opening, frontmatter, marker completeness, manual-block, and closed-key contract. `artifact-repair.ts` provides the deterministic last-slot repair path that fixes mechanical defects before re-prompting the model — and returns `null` (fail-closed) when a defect is too semantic to patch safely. `auxiliary-page.ts` bypasses the LLM for non-product modules by emitting the same compact contract directly from the indexed symbol rows, and `batch-context.test.ts` exercises the fair-source truncation used to feed these prompts.

## Test fixtures and helpers

<!-- lw:anchors packages/core/src/anchor-ledger.test.ts#writeCode packages/core/src/anchor-ledger.test.ts#writeWiki packages/core/src/anchor-ledger.test.ts#nodeSqliteQuery packages/core/src/artifact-repair.test.ts#makeFlowPage packages/core/src/artifact-repair.test.ts#validateFlow packages/core/src/auxiliary-page.test.ts#module packages/core/src/auxiliary-page.test.ts#assertValid -->

The ledger tests rely on a tmpdir-backed repo: each test creates isolated files via `async function writeCode(rel: string, content: string): Promise<void>` and `async function writeWiki(rel: string, content: string): Promise<void>`, runs the indexer + ledger, then asserts on `result.pagesProcessed`, `result.anchorsUpserted`, and `result.debtCreated`. `function nodeSqliteQuery(repoRoot: string, sql: string): Array<Record<string, unknown>>` opens the project's `better-sqlite3` handle to read back the rows the ledger wrote, so tests can assert on `debt.event` / `debt.assignee` directly.

The artifact-repair tests use `function makeFlowPage(anchors: string[], modules: string[]): string` to build a minimal compliant flow page (frontmatter `anchors:` + `modules:` + `updated:`, then `## Purpose`, `## Ordered flow`, `## Diagram`, `## Invariants`, `## Failure and recovery`, `## Related pages`) and `function validateFlow(content: string, closedKeyList: string[])` to assert that page against the full `validateStage4Artifact` contract with `pageKind: "flow"` and a fixed `expectedFlowModules` / `expectedFlowDiagram` pair. Auxiliary tests use `function module(overrides: Partial<Module> = {}): Module` to fabricate a `Module` row and `function assertValid(artifact: string, closedKeyList: string[], moduleId: string, moduleRole: "fixture" | "tooling" | "docs")` to require the generated artifact round-trips `normalizeStage4Artifact` followed by `validateStage4Artifact` with `pageKind: "module"` and zero errors.

## Anchor ledger: run, orchestrate, parse, upsert

<!-- lw:anchors packages/core/src/anchor-ledger.ts#run packages/core/src/anchor-ledger.ts#orchestrate packages/core/src/anchor-ledger.ts#collectWikiPages packages/core/src/anchor-ledger.ts#hashContent packages/core/src/anchor-ledger.ts#upsertDocPage packages/core/src/anchor-ledger.ts#upsertAnchor packages/core/src/anchor-ledger.ts#createDebt packages/core/src/anchor-ledger.ts#hasOpenDebt packages/core/src/anchor-ledger.ts#detectMoves packages/core/src/anchor-ledger.ts#upsertUndocumented packages/core/src/anchor-ledger.ts#assigneeFor packages/core/src/anchor-ledger.ts#AnchorParseError packages/core/src/anchor-ledger.ts#AnchorParseError.constructor -->

`export async function run(` is the ledger's public entry point: it resolves `repoRoot`, ensures `.livewiki/` exists, opens the SQLite index at `.livewiki/index.db`, and delegates to `async function orchestrate(`. The `try { ... } finally { db.close(); }` around `orchestrate` guarantees the index handle is released even if upserts throw — the excerpt does not establish exhaustive behaviour for every internal failure mode, so callers should treat ledger errors as opaque and surface them to the caller without swallowing.

`orchestrate` is the heart of the pass: it calls `async function collectWikiPages(absRoot: string): Promise<{ relPath: string }[]>` to enumerate `.md` files under `livewiki/`, loads `doc_pages` / `anchors` / active `symbols` / deleted `symbols` into maps, then per page parses anchors and calls `function upsertDocPage(` and `function upsertAnchor(`. `function hashContent(content: string): string` (over `sha256`) computes the `content_hash` persisted on `doc_pages` so subsequent runs can detect edits even when no symbol changes.

Debt comes from diffing the freshly-upserted state against the previously-loaded map. `function detectMoves(` walks the set of symbols marked `deleted` and tries to match them to a newly-active symbol by `content_hash` first, then by name+signature as a fallback. `function createDebt(` writes a row into the `debt` table with the matched event type, and `function hasOpenDebt(` checks whether the candidate is already covered by an unaddressed row before re-emitting one — visible in the source as an early-return short-circuit, so a single edit cannot pile up duplicate debt. `function upsertUndocumented(` records symbols that exist in the index but are not referenced by any wiki page, so `undocumentedSymbols` shows up in the `LedgerResult` summary.

`function assigneeFor(owner: Owner, inManualBlock: boolean): Assignee` is the routing rule: pages with `owner: generated` and an anchor that falls outside a `lw:manual` block go to the `agent`; `owner: human` (or anchors inside a manual block) go to `human`; the comment in the source clarifies that a `mixed` page is treated as `agent` because the generated part wins. `export class AnchorParseError extends Error {` plus `constructor(wikiPath: string, cause: Error) {` is thrown when a page's anchors cannot be parsed; the constructor sets `this.name = "AnchorParseError"` and embeds the failing `wikiPath` in the message — the excerpt does not show every site that raises it, but it is the single typed failure the ledger surfaces for malformed wiki content.

## Anchor ledger: markdown rewriting

<!-- lw:anchors packages/core/src/anchor-ledger.ts#rewriteSymbolKeyInPage packages/core/src/anchor-ledger.ts#findFrontmatterEnd packages/core/src/anchor-ledger.ts#isDelimiterLineAt packages/core/src/anchor-ledger.ts#endOfLine packages/core/src/anchor-ledger.ts#nextLineStart packages/core/src/anchor-ledger.ts#extractManualBlockRangesFromBody packages/core/src/anchor-ledger.ts#rewriteFrontmatterAnchorsList packages/core/src/anchor-ledger.ts#rewriteBodyMarkers packages/core/src/anchor-ledger.ts#escapeRegex packages/core/src/anchor-ledger.ts#reconcileManualBlocks -->

Rule #3 (and #6) from the source comments says: when a symbol is detected as `moved`, the ledger MUST rewrite the anchor on disk in both the frontmatter `anchors:` list AND the in-body `lw:anchors` markers — the SQLite row update alone is not sufficient because the markdown is the source of truth. The exception (rule #6) is that anchors inside a `lw:manual` block, or on a page with `owner: human`, are never rewritten on disk; they only generate a `moved` debt row with `assignee: "human"` so a human can do the edit by hand. The excerpt for `async function rewriteSymbolKeyInPage(` is truncated and the visible source does not establish the full rewrite path; callers must treat this section as a description of the documented intent, not a guarantee.

The helpers around the rewrite path are deliberately byte-oriented. `function findFrontmatterEnd(source: string): number` scans forward from the opening `---` for the closing `---` delimiter; `function isDelimiterLineAt(source: string, offset: number): boolean` confirms a single line is exactly `---` (so the rewriter does not confuse a markdown horizontal rule with the frontmatter terminator). `function endOfLine(source: string, lineStart: number): number` and `function nextLineStart(source: string, lineStart: number): number` are the two low-level offsets the rewriter threads through every loop. `function escapeRegex(s: string): string` is used when building the regexes that match symbol keys inside markers, so keys containing `.` or other regex metacharacters match literally.

`function extractManualBlockRangesFromBody(` produces the byte ranges the rewriter must avoid; combined with `function rewriteFrontmatterAnchorsList(` (which edits the YAML `anchors:` entries between the frontmatter delimiters) and `function rewriteBodyMarkers(` (which edits only the `lw:anchors` markers under the matching H2), it gives the ledger a way to rewrite pages without disturbing `lw:manual` blocks. `function reconcileManualBlocks(` is the post-write consistency check — it ensures that after a rewrite the byte ranges of any `lw:manual` blocks still contain the original protected bytes, so a bad offset arithmetic fails the check instead of silently corrupting human-owned content.

## Anchor parser

<!-- lw:anchors packages/core/src/anchors.ts#extractAnchors packages/core/src/anchors.ts#slugify packages/core/src/anchors.ts#isInsideAny -->

`export function extractAnchors(source: string): ExtractedAnchors` is the pure parser both the ledger and the artifact validator consume. It runs `parseFrontmatter` first, then scans the body (with `maskCodeSpansPreservingLength` applied so that anchor markers inside code spans do not accidentally match) for the three regular expressions that recognise anchor markers, manual-block start, and manual-block end. The output bundles page-level `pageAnchors`, an array of `sectionAnchors` (each carrying `sectionSlug`, `headingText`, `symbolKeys`, `anchorMarkerOffset`, and `inManualBlock`), and the `manualBlocks` ranges. The `inManualBlock` flag is derived by walking the manual-block events in offset order and toggling an open flag, then asking `function isInsideAny(start: number, end: number, blocks: ManualBlock[]): boolean` whether a given anchor offset falls inside any open range — anchors inside a manual block are surfaced separately so downstream code can route them to the human assignee.

`export function slugify(heading: string): string` is the lowercase / hyphen / accent-stripping normaliser used to build `sectionSlug` from the H2/H3 heading text. The behaviour covered by the visible test excerpt: lowercase, hyphen-separated, accent-stripped (`"Fluxo de validação"` becomes `"fluxo-de-validacao"`), punctuation removed (`"Auth — login & sessão"` becomes `"auth-login-sessao"`), whitespace collapsed, leading/trailing trimmed, and digits preserved (`"Step 1: init"` becomes `"step-1-init"`). Slugs are NOT guaranteed unique within a page — the source comment notes that two headings sharing text produce duplicate slugs, and the database relies on `(wiki_path, section_slug)` UNIQUE rather than on `slugify` alone.

## Stage-4 artifact: normalization and validation

<!-- lw:anchors packages/core/src/artifact.ts#normalizeStage4Artifact packages/core/src/artifact.ts#validateStage4Artifact packages/core/src/artifact.ts#hasRealProse packages/core/src/artifact.ts#validateExactTopicList packages/core/src/artifact.ts#checkRequiredPageOpening packages/core/src/artifact.ts#checkRequiredTopicOpening packages/core/src/artifact.ts#checkRequiredFlowOpening packages/core/src/artifact.ts#flowSectionEnd packages/core/src/artifact.ts#flowSectionProseFailure packages/core/src/artifact.ts#findExactOpeningH2 packages/core/src/artifact.ts#findOpeningHeadingCandidate packages/core/src/artifact.ts#findNextH2 packages/core/src/artifact.ts#findFirstTodoPlaceholder packages/core/src/artifact.ts#findNextImplementationHeading packages/core/src/artifact.ts#firstPresentIndex packages/core/src/artifact.ts#offendingHeading packages/core/src/artifact.ts#openingSnippet packages/core/src/artifact.ts#proseBlockFailure packages/core/src/artifact.ts#err packages/core/src/artifact.ts#findOriginalLineStart packages/core/src/artifact.ts#findOriginalLineEnd packages/core/src/artifact.ts#countLines packages/core/src/artifact.ts#boundedOffendingExcerpt packages/core/src/artifact.ts#slugifyHeading packages/core/src/artifact.ts#lastHeadingBefore -->

`export function normalizeStage4Artifact(raw: string): NormalizeResult` is the entry point that prepares raw model output for validation. It strips a single leading `<think>…` block, detects unclosed reasoning (returns `ok: false` with `errors[0].code === "unclosed_reasoning"`), rejects reasoning-only output (`reasoning_only`), and unwraps one outer ```` ```markdown ```` or ```` ```md ```` fence (with optional info string). The excerpt shows that a fence with a non-markdown info string (`` ```ts ``) is intentionally NOT unwrapped — the artifact then starts with a fence and the validator complains downstream. Empty / whitespace-only / BOM-only input is rejected with `empty_after_normalize`. The visible source does not establish every corner case `normalizeStage4Artifact` covers; the contract listed in its top-of-file comment is the authoritative spec.

`export function validateStage4Artifact(` is the structural gate. Its top-of-file comment enumerates the rules: frontmatter between `---` at the top, an EXPLICIT `owner:` line with value `generated` (no implicit fallback), an `anchors:` list when the closed list is non-empty, every frontmatter key present in the closed list, every section-marker key present in the closed list, the frontmatter list and the union of section markers independently equal the closed list (flow pages relax this to an upper bound), no duplicate keys in the frontmatter list, no key cited in more than one section marker (frontmatter plus a single section marker is allowed), every anchored section followed by real prose (not blank and not placeholder-only), fully closed Markdown (no unclosed fence or code span), and any `lw:manual` block in the body is rejected because manual blocks are reserved for human content. `function hasRealProse(text: string): boolean` is the predicate that powers the "no empty anchored section" rule, and `function findFirstTodoPlaceholder(text: string): TodoPlaceholderMatch | null` is the predicate that powers the placeholder ban (allowing both inside fenced or inline code examples).

The page-opening contract has three siblings depending on `pageKind`: `function checkRequiredPageOpening(text: string): PageOpeningFailure | null` (modules), `function checkRequiredTopicOpening(masked: string, expectedTitle?: string): PageOpeningFailure | null` (topics — title-conditional), and `function checkRequiredFlowOpening(` (flow pages — Purpose, Ordered flow, Diagram, Invariants, Failure and recovery, Related pages). The helpers that drive these checks read the body as a line array and walk it forward: `function flowSectionEnd(lines: ReadonlyArray<string>, headingIndex: number): number` locates the next H2 after the given heading index; `function flowSectionProseFailure(` builds the prose-failure record for a flow section that lacks real prose after its marker; `function findExactOpeningH2(` and `function findOpeningHeadingCandidate(` match the opening heading against the canonical title (exact match first, candidate fallback); `function findNextH2(lines: ReadonlyArray<string>, start: number): number` and `function findNextImplementationHeading(lines: ReadonlyArray<string>, start: number): number` advance the scanner. `function firstPresentIndex(...indices: number[]): number` returns the smallest non-negative index from a variadic list (used to order the H1, the frontmatter H1 mirror, and the first implementation heading). `function offendingHeading(` and `function openingSnippet(lines: ReadonlyArray<string>): string` produce the diagnostic snippet attached to a `PageOpeningFailure`, `function proseBlockFailure(` wraps a prose-block failure record, and `function err(` is the small constructor used internally to build `ArtifactValidationError` records.

The validator also produces bounded, byte-accurate diagnostics. `function findOriginalLineStart(text: string, offset: number): number` and `function findOriginalLineEnd(text: string, offset: number): number` are used to slice a single source line around a problem offset, `function countLines(text: string, offset: number): number` gives the 1-based line number for a diagnostic, and `function boundedOffendingExcerpt(` produces a printable excerpt that respects a maximum length so error messages stay readable. `function slugifyHeading(text: string): string` and `function lastHeadingBefore(` round out the helpers — the slugifier mirrors `slugify` for section identification, and `lastHeadingBefore` resolves the most recent heading preceding a given offset for diagnostics on per-section failures. `function validateExactTopicList(` enforces the topic-page closed-list completeness rule using `TopicKeyGroups` from `./topics.js`.

## Stage-4 artifact: mechanical repair

<!-- lw:anchors packages/core/src/artifact-repair.ts#repairStage4ArtifactMechanically packages/core/src/artifact-repair.ts#repairUpperBoundArtifactMechanically packages/core/src/artifact-repair.ts#syncFrontmatterAnchorsList packages/core/src/artifact-repair.ts#stripManualControlMarkers packages/core/src/artifact-repair.ts#removeLaterSectionAnchorOccurrences packages/core/src/artifact-repair.ts#escapeFirstUnmatchedInlineDelimiter -->

`export function repairStage4ArtifactMechanically(` is the last-slot fallback for content-safe stage-4 defects. It is deliberately fail-closed: it enumerates the supported error shapes (`unclosed_markdown`, `missing_closed_key` in a section marker, `empty_section` matching a full `lw:anchors` marker line, `duplicate_anchor` whose message contains the "appears in more than one section marker" clause, and `model_invented_manual` whose offending is the `lw:manual` start marker), returns `null` the moment an unsupported code appears, and re-runs `validateStage4Artifact` at the end (the function comment states the validator must accept the transformed result before it can be returned). It patches in a fixed order: unclosed inline-code delimiters (capped at `MAX_INLINE_DELIMITER_REPAIRS = 100` repair passes), appending a trailing "## Additional indexed symbols" section for missing section keys, inserting a short sentence after empty anchored sections, deduplicating keys cited in two section markers via `function removeLaterSectionAnchorOccurrences(`, and stripping invented `lw:manual` markers via `function stripManualControlMarkers(text: string): string | null`. The R10.1 item D codes (`anchor_in_disallowed_section`, `anchor_missing_in_required_section`, `anchor_missing_required_tier`) are NOT supported and force `null` even when other supported codes accompany them — the source comment calls this out as a deliberate guarantee.

The three primitives behind the repairs: `function escapeFirstUnmatchedInlineDelimiter(text: string): string | null` finds the first unbalanced backtick run (a fence-unsafe token like a lone backtick or an unbalanced double-backtick pair) and escapes it; it returns `null` when there is nothing to fix. `function removeLaterSectionAnchorOccurrences(` rewrites the body so each key appears in at most one section marker (keeping the earliest citation and dropping later ones); it returns `null` when no progress is possible. `function stripManualControlMarkers(text: string): string | null` removes any `lw:manual` / `lw:/manual` lines the model invented; it returns `null` only on a structural failure, and returns the original string when there is nothing to strip.

`export function repairUpperBoundArtifactMechanically(` is the variant for `pageKind: "flow"`, where the closed list is treated as an upper bound rather than an assignment. It re-uses `validateStage4Artifact` and emits the same `MechanicalArtifactRepairResult` shape with the same `repairs` vocabulary. The artifact-repair tests exercise the variant directly: `makeFlowPage` builds a known-good flow page, the test mutates it (e.g. duplicates a key into a second section marker, or removes a key from the frontmatter `anchors:` list), then asserts that `validateFlow` reports the expected code and that the repair round-trips through validation. `function syncFrontmatterAnchorsList(` is the helper that re-aligns the frontmatter `anchors:` list with the section markers (adding keys cited only on one side and removing keys cited nowhere) so the upper-bound contract holds.

## Auxiliary module page generation

<!-- lw:anchors packages/core/src/auxiliary-page.ts#generateAuxiliaryModulePage packages/core/src/auxiliary-page.ts#howItFitsParagraph packages/core/src/auxiliary-page.ts#referenceParagraph packages/core/src/auxiliary-page.ts#disambiguateHeadings packages/core/src/auxiliary-page.ts#humanizeModuleId -->

`export function generateAuxiliaryModulePage(opts: {` is the deterministic replacement for the LLM stage-4 pass over non-product modules (`fixture` | `tooling` | `docs`, via `AuxiliaryRole = Exclude<PathRole, "product">`). The top-of-file comment is explicit about the priority: the "compact auxiliary contract" is fully mechanical, has no product-runtime semantics worth an LLM call, and the model drifted from the exact shape often enough to burn repair slots and trip `auxiliary_page_not_compact`. The function emits frontmatter (`title` from `module.displayTitle ?? humanizeModuleId(module.id)`, `owner: generated`, optional `anchors:`), then the H1, a `## When to use this page` H2 with the three role-specific bullets from `ROLE_BULLETS`, a `## How it fits` H2, and a `## Reference` H2 that iterates `function disambiguateHeadings(symbols)` to produce one H3 per symbol followed by an `lw:anchors` marker and one short paragraph from `function referenceParagraph(module, roleLabel, symbol)`.

`function howItFitsParagraph(module: Module, roleLabel: string): string` builds the single prose paragraph under "How it fits", wording "file" vs "files" based on `module.paths.length`. `function referenceParagraph(module: Module, roleLabel: string, symbol: AuxiliarySymbolRow): string` produces the single paragraph per symbol and applies a `MAX_REFERENCE_PARAGRAPH_CHARS = 500` cap by truncating the SIGNATURE (not the assembled sentence), replacing backticks with single quotes before slicing, and appending an ellipsis when truncated — the comment notes that truncating the assembled sentence could land inside a fence and leave `unclosed_markdown` behind, which is why the budget is taken against the raw signature string. `function disambiguateHeadings(` renames H3s that would otherwise collide (visible in the test as `### run (a.ts)` vs `### run (b.ts)` when two symbols in different files share a name), and `function humanizeModuleId(id: string): string` is the title-cased fallback used when `module.displayTitle` is not provided by stage 2.

## Flow diagram and diagram-element counters

<!-- lw:anchors packages/core/src/artifact.ts#FLOW_DIAGRAM_SOURCE_MAX_CHARS packages/core/src/artifact.ts#flowDiagramPlaceholder packages/core/src/artifact.ts#extractInlineFlowDiagram packages/core/src/artifact.ts#countFlowDiagramElements packages/core/src/artifact.ts#countFlowchartElements packages/core/src/artifact.ts#countSequenceElements packages/core/src/artifact.ts#countStateElements -->

`export const FLOW_DIAGRAM_SOURCE_MAX_CHARS = 8000;` is the byte budget for the Mermaid block embedded in flow pages; `export function flowDiagramPlaceholder(slug: string): string` is the canonical placeholder the artifact (and the artifact-repair tests) compare against — it returns the Mermaid source the validator expects inside the ```` ```mermaid ```` fence. `export function extractInlineFlowDiagram(` is the helper that pulls the diagram source out of a flow artifact for counting. `export function countFlowDiagramElements(source: string): FlowDiagramElementCount` is the dispatch that routes to `function countFlowchartElements(body: string[]): FlowDiagramElementCount`, `function countSequenceElements(body: string[]): FlowDiagramElementCount`, and `function countStateElements(body: string[]): FlowDiagramElementCount` based on the diagram kind detected in the Mermaid header. The return type is a single `FlowDiagramElementCount` record consumed by flow-validation rules that, for example, require a minimum number of nodes or transitions; the visible source does not establish the exact threshold values, so callers should read the prompt module for the contract.

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
- Flow: [CLI scaffold through export hashing](flows/cli-src-to-core-src-04.md)
- ["Core pipeline: batch orchestration, config, db, and diagrams"](core-src-03.md) — dependency and dependent
- [core-src-08 — prompts, safe I/O, status, symbol extraction, and topic planning](core-src-08.md) — dependency
- [Core export, frontmatter, gitignore, flow detection, and hashing](core-src-04.md) — dependency and dependent
<!-- livewiki:navigate:end -->
