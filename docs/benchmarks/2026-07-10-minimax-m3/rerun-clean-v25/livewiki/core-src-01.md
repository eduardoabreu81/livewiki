---
title: Core stage-4 artifact pipeline and anchor ledger
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

# Core stage-4 artifact pipeline and anchor ledger

This page documents how livewiki's core normalizes, validates, repairs, and reconciles the stage-4 Markdown artifact with the anchor ledger that backs every doc page.

## When to use this page

- **Read** the artifact section when you need to know why a stage-4 output was rejected (missing frontmatter, unclosed reasoning, missing closed key, invented manual block).
- **Read** the anchor ledger section when you need to understand how edit/move/delete events on anchored code become `debt` rows with the right assignee.
- **Read** the auxiliary-page section when you are extending the deterministic path for fixture, tooling, or docs modules and want to keep the LLM-free contract intact.
- **Read** the repair section when you need to know which validation codes the mechanical last-slot fallback is allowed to fix and which force a re-prompt.

## How it fits

This module groups the core stage-4 and Phase-2 subsystems. `artifact.ts` normalizes and validates the raw LLM output, `artifact-repair.ts` patches the small, content-safe subset of validator errors, `anchors.ts` parses anchors and manual-block ranges out of an existing wiki page, and `anchor-ledger.ts` reconciles those anchors against the indexed code symbols to produce `debt` rows. `auxiliary-page.ts` is the deterministic sibling used when a module is classified as fixture/tooling/docs instead of product runtime.

The page also covers the test files (`anchor-ledger.test.ts`, `anchors.test.ts`, `artifact.test.ts`, `artifact-repair.test.ts`, `auxiliary-page.test.ts`, plus `batch-context.test.ts`) that pin the contracts for normalization, validation, repair, and auxiliary assembly.

## Stage-4 normalization and validation

`artifact.ts` is the gate every produced Markdown page has to clear. It runs in two passes: first the LLM raw output is reduced to clean Markdown, then the clean Markdown is checked against the closed key list and structural rules.

`normalizeStage4Artifact` rejects unclosed `<think>` blocks and "reasoning-only" outputs as `unclosed_reasoning` / `reasoning_only`, strips a single leading `<think>…` block, and unwraps an outer ```` ```markdown ```` or ```` ```md ```` fence. Empty inputs return `empty_after_normalize`. If you need to know what the LLM produced verbatim, look at the raw transcript — once normalization runs, the prose is the contract.

```ts
export function normalizeStage4Artifact(raw: string): NormalizeResult
```

`validateStage4Artifact` is the strict check on the normalized artifact. It demands explicit `owner: generated`, an `anchors:` list when the closed list is non-empty, every key in the frontmatter list to be a closed key, every key in section markers to be a closed key, no duplicate keys anywhere, real prose after every anchored section, fully closed Markdown (every fence and inline-code span balanced), and no `TODO` or `TBD` placeholders outside fenced or inline-code examples. Flow pages relax the closed-list rule to an upper-bound consistency rule and additionally bind each `lw:anchors` marker to its ancestor H2 — disallowed sections emit `anchor_in_disallowed_section`, missing required sections emit `anchor_missing_in_required_section`, and when `flowKeyGroups` is supplied a missing tier emits `anchor_missing_required_tier`.

```ts
export function validateStage4Artifact(
  artifact: string,
  closedKeyList: ReadonlyArray<string>,
  context?: Readonly<Stage4ValidationContext>,
): ValidateResult
```

The opening-contract helpers split the check by page kind. `checkRequiredPageOpening` enforces the product module opening (responsibility sentence, "When to use this page", task bullets, "How it fits"), `checkRequiredFlowOpening` enforces the flow contract (Purpose, Ordered flow, Diagram, Invariants, Failure and recovery, Related pages), and `checkRequiredTopicOpening` enforces the topic contract. The accompanying helpers `findExactOpeningH2`, `findOpeningHeadingCandidate`, `findNextH2`, `findNextImplementationHeading`, `lastHeadingBefore`, and `offendingHeading` locate which H2 a violation lives under; `openingSnippet`, `boundedOffendingExcerpt`, `findOriginalLineStart`, `findOriginalLineEnd`, `countLines`, and `hasRealProse` build the prose-excerpt evidence the validator returns; and `proseBlockFailure`, `flowSectionProseFailure`, `flowSectionEnd`, `firstPresentIndex`, `err`, and `findFirstTodoPlaceholder` produce the structured `ArtifactValidationError` records. `slugifyHeading` is the heading-to-slug helper used by both opening and section lookups.

The flow-diagram subsystem is independent of the prose check. `extractInlineFlowDiagram` pulls a Mermaid block out of the body, `countFlowDiagramElements` totals nodes/edges across diagram types, and `countFlowchartElements` / `countSequenceElements` / `countStateElements` are the per-kind counters. `flowDiagramPlaceholder` returns the canonical Mermaid skeleton for a given slug and `FLOW_DIAGRAM_SOURCE_MAX_CHARS` caps how many characters of a diagram source are accepted:

```ts
export const FLOW_DIAGRAM_SOURCE_MAX_CHARS = 8000;
```

`validateExactTopicList` is the topic counterpart: it verifies that the page lists exactly the expected set of subtopic slugs in the required slot.

<!-- lw:anchors packages/core/src/artifact.ts#FLOW_DIAGRAM_SOURCE_MAX_CHARS packages/core/src/artifact.ts#boundedOffendingExcerpt packages/core/src/artifact.ts#checkRequiredFlowOpening packages/core/src/artifact.ts#checkRequiredPageOpening packages/core/src/artifact.ts#checkRequiredTopicOpening packages/core/src/artifact.ts#countFlowDiagramElements packages/core/src/artifact.ts#countFlowchartElements packages/core/src/artifact.ts#countLines packages/core/src/artifact.ts#countSequenceElements packages/core/src/artifact.ts#countStateElements packages/core/src/artifact.ts#err packages/core/src/artifact.ts#extractInlineFlowDiagram packages/core/src/artifact.ts#findExactOpeningH2 packages/core/src/artifact.ts#findFirstTodoPlaceholder packages/core/src/artifact.ts#findNextH2 packages/core/src/artifact.ts#findNextImplementationHeading packages/core/src/artifact.ts#findOpeningHeadingCandidate packages/core/src/artifact.ts#findOriginalLineEnd packages/core/src/artifact.ts#findOriginalLineStart packages/core/src/artifact.ts#firstPresentIndex packages/core/src/artifact.ts#flowDiagramPlaceholder packages/core/src/artifact.ts#flowSectionEnd packages/core/src/artifact.ts#flowSectionProseFailure packages/core/src/artifact.ts#hasRealProse packages/core/src/artifact.ts#lastHeadingBefore packages/core/src/artifact.ts#normalizeStage4Artifact packages/core/src/artifact.ts#offendingHeading packages/core/src/artifact.ts#openingSnippet packages/core/src/artifact.ts#proseBlockFailure packages/core/src/artifact.ts#slugifyHeading packages/core/src/artifact.ts#validateExactTopicList packages/core/src/artifact.ts#validateStage4Artifact -->

The file also re-exports nothing — every check is reached through `validateStage4Artifact` plus the helpers above, and the validator returns a structured `errors` array whose codes (for example `missing_closed_key`, `duplicate_anchor`, `unclosed_markdown`, `todo_marker_present`, `anchor_in_disallowed_section`, `anchor_missing_in_required_section`, `anchor_missing_required_tier`) drive both the repair path and the prompt-side retry path.

## Mechanical stage-4 repair

`artifact-repair.ts` is the last-slot, content-safe fallback. The contract is fail-closed: every reported error must match a supported shape, every repair must leave the artifact acceptable to the full validator, and any deviation returns `null` so the orchestrator can re-prompt instead.

```ts
export function repairStage4ArtifactMechanically(
  artifact: string,
  errors: ReadonlyArray<ArtifactValidationError>,
  closedKeyList: ReadonlyArray<string>,
  context?: Readonly<Stage4ValidationContext>,
): MechanicalArtifactRepairResult | null
```

The supported repairs are listed in `MechanicalArtifactRepair`:

- `escape_unmatched_inline_delimiter` — for `unclosed_markdown` of kind `inline-code`, escaped up to `MAX_INLINE_DELIMITER_REPAIRS` times.
- `append_missing_section_anchors` — for `missing_closed_key` at section location, opens an "Additional indexed symbols" H2 and emits a single combined `lw:anchors` marker.
- `fill_empty_anchored_section` — for `empty_section` whose `offending` field is itself a complete `lw:anchors` marker, inserts the canonical prose sentence immediately after it.
- `remove_duplicate_section_anchors` — for `duplicate_anchor` with the "appears in more than one section marker" message, drops the later occurrences.
- `strip_invented_manual_markers` — for `model_invented_manual`, strips the invented markers so the orchestrator can reinsert any human content byte-for-byte.
- `sync_upper_bound_frontmatter_anchors` — used by the upper-bound variant to sync a section-cited key back into the frontmatter list.

Any other error code returns `null` immediately, and unsupported shapes that accompany supported ones also force `null` — that is the R10.1 item D guarantee that the new flow-placement codes are never silently mutated.

`repairUpperBoundArtifactMechanically` is the variant used for flow pages, where the closed list is an upper bound rather than an assignment. It runs the same fail-closed checks but routes `missing_closed_key` at `frontmatter` location into `sync_upper_bound_frontmatter_anchors` (via `syncFrontmatterAnchorsList`) instead of the section-marker fallback.

The supporting helpers do the byte-level work. `escapeFirstUnmatchedInlineDelimiter` is the inline-code escape used by the `unclosed_markdown` repair, `stripManualControlMarkers` removes invented `lw:manual` / `lw:/manual` markers without touching legitimate ones, `removeLaterSectionAnchorOccurrences` rewrites the page to keep only the first occurrence of each duplicated key in section markers, and `syncFrontmatterAnchorsList` rewrites the frontmatter `anchors:` block to match what the body actually cites.

The test file pins both the fail-closed guarantees and the upper-bound variant. `makeFlowPage(anchors, modules)` builds a minimal compliant flow page (frontmatter with `anchors:` and `modules:`, plus the six required H2 sections and a Mermaid `flowDiagramPlaceholder` block), and `validateFlow(content, closedKeyList)` runs the full `validateStage4Artifact` against it with `pageKind: "flow"` and the right `expectedFlowModules` / `expectedFlowDiagram` context. The suite asserts that `repairStage4ArtifactMechanically` returns `null` for the three new flow-placement codes alone or mixed with a supported code, and that `repairUpperBoundArtifactMechanically` succeeds for the duplicated-key and missing-from-frontmatter cases.

If a pass succeeds, the returned `MechanicalArtifactRepairResult.content` is the new artifact and `repairs` lists the operation codes that were applied. Any structural error means the validator must accept the transformed result before `repairStage4ArtifactMechanically` returns non-null — the excerpt does not establish the full implementation of that final guard.

<!-- lw:anchors packages/core/src/artifact-repair.ts#escapeFirstUnmatchedInlineDelimiter packages/core/src/artifact-repair.ts#removeLaterSectionAnchorOccurrences packages/core/src/artifact-repair.ts#repairStage4ArtifactMechanically packages/core/src/artifact-repair.ts#repairUpperBoundArtifactMechanically packages/core/src/artifact-repair.ts#stripManualControlMarkers packages/core/src/artifact-repair.ts#syncFrontmatterAnchorsList packages/core/src/artifact-repair.test.ts#makeFlowPage packages/core/src/artifact-repair.test.ts#validateFlow -->

These anchors identify indexed symbols whose implementation is part of this module.

## Anchors and manual blocks

`anchors.ts` is the markdown parser that extracts anchor metadata from an existing wiki page. Its result feeds both the validator (frontmatter list, section markers, manual-block ranges) and the anchor ledger (which page owns which symbol under which section).

```ts
export function extractAnchors(source: string): ExtractedAnchors
```

The returned shape has four parts:

- `pageAnchors` — keys listed under `anchors:` in the frontmatter, in order.
- `sectionAnchors` — one entry per `lw:anchors` marker, with the heading text, the derived `sectionSlug`, the keys, the byte offset of the marker, and an `inManualBlock` flag.
- `manualBlocks` — byte ranges of every `lw:manual` … `lw:/manual` pair.
- `frontmatter`, `owner`, and the body string (frontmatter included) for downstream consumers.

The parser first scans for manual-block events in the body, then for headings, then for `lw:anchors` markers. Each marker is bound to the nearest preceding heading at offset strictly less than the marker offset; a marker without a preceding heading is silently dropped (the `anchor sem heading anterior é ignorado` test codifies that decision). `inManualBlock` is derived per-anchor by asking `isInsideAny`:

```ts
function isInsideAny(start: number, end: number, blocks: ManualBlock[]): boolean
```

Section slugs come from `slugify`, which lowercases, strips accents, replaces whitespace runs with single hyphens, and removes punctuation. The slug identity test in `anchors.test.ts` ("Fluxo de validação" → `fluxo-de-validacao`, "Auth — login & sessão" → `auth-login-sessao`) defines the public shape.

The anchors parser is a pure function — it never reads or writes the database. The two consumers are `validateStage4Artifact` (which only needs the closed-key list and the marker keys) and the anchor ledger (which needs `owner`, `pageAnchors`, `sectionAnchors`, and `manualBlocks` to drive its diff).

<!-- lw:anchors packages/core/src/anchors.ts#extractAnchors packages/core/src/anchors.ts#isInsideAny packages/core/src/anchors.ts#slugify -->

These anchors identify indexed symbols whose implementation is part of this module.

## Anchor ledger

`anchor-ledger.ts` reconciles every wiki page against the indexed code symbols and produces `debt` rows for change, move, and delete events. The module's invariants are spelled out in the file header: when a symbol is detected as moved, the anchor must be rewritten in the markdown (frontmatter and `lw:anchors` markers), not just in the DB — and any anchor inside a `lw:manual` block or any page with `owner: human` is exempt from rewrite and only generates human-assigned debt.

```ts
export async function run(
  repoRoot: string,
  opts: LedgerOptions = {},
): Promise<LedgerResult>
```

The exported entry point opens `.livewiki/index.db`, calls `orchestrate`, and closes the DB in a `finally` block — `orchestrate` is the internal driver that walks `collectWikiPages`, loads existing doc pages / anchors / active symbols / deleted symbols, then for each page parses its anchors and upserts state. `AnchorParseError` is thrown when parsing a page fails, and its constructor captures both `wikiPath` and the underlying `cause`:

```ts
export class AnchorParseError extends Error {
  constructor(wikiPath: string, cause: Error) {
    super(`Falha ao parsear âncoras em ${wikiPath}: ${cause.message}`);
    this.name = "AnchorParseError";
  }
}
```

The upsert pipeline is split by responsibility. `upsertDocPage` writes (or refreshes) the doc page row, hashing the body so a later diff can detect drift. `upsertAnchor` writes the `(doc_page_id, section_slug, symbol_key)` row that uniquely identifies an anchor — the page slot can hold multiple symbols, so the key includes `symbol_key` to keep the in-memory map correct. `createDebt` records a `changed | moved | deleted` event and `hasOpenDebt` queries whether an open debt row already exists for that anchor (the dedupe rule). `detectMoves` is the content-hash-first / name+signature-fallback matcher that pairs deleted symbols to new ones; `upsertUndocumented` records active symbols that no page anchors; and `assigneeFor` resolves the assignee (`agent` for `generated` or `mixed`, `human` for `human`, and `human` for any anchor with `inManualBlock=true`) so the right queue picks the debt up.

The page-rewriting helpers do the safe byte-level work. `rewriteSymbolKeyInPage` is the per-page driver that combines frontmatter and body rewrites. `rewriteFrontmatterAnchorsList` rewrites the YAML `anchors:` list to the new symbol key, and `rewriteBodyMarkers` rewrites every `lw:anchors` marker in the body. `reconcileManualBlocks` is the byte-for-byte reconciliation that keeps the human content untouched. The smaller helpers cover parsing the YAML block and walking the page: `findFrontmatterEnd`, `isDelimiterLineAt`, `endOfLine`, `nextLineStart`, and `extractManualBlockRangesFromBody` together drive the safe-IO writer. `escapeRegex` is the regex-escape utility used when rewriting a key that may contain regex metacharacters, and `hashContent` produces the per-symbol content hash that anchors the move detection:

```ts
function hashContent(content: string): string
```

`collectWikiPages` is the disk walker that produces the `livewiki/` tree:

```ts
async function collectWikiPages(absRoot: string): Promise<{ relPath: string }[]>
```

When the orchestrator rewrites an anchor inside a `lw:manual` block or a `owner: human` page, rule #6 holds: the bytes are not modified, and the debt is filed with `assignee=human`. The excerpt does not establish every code path inside `orchestrate` — in particular, the exact reconciliation order after the upsert pipeline is truncated — so treat the list above as the public contract and the symbol table for the rest.

<!-- lw:anchors packages/core/src/anchor-ledger.ts#AnchorParseError packages/core/src/anchor-ledger.ts#AnchorParseError.constructor packages/core/src/anchor-ledger.ts#assigneeFor packages/core/src/anchor-ledger.ts#collectWikiPages packages/core/src/anchor-ledger.ts#createDebt packages/core/src/anchor-ledger.ts#detectMoves packages/core/src/anchor-ledger.ts#endOfLine packages/core/src/anchor-ledger.ts#escapeRegex packages/core/src/anchor-ledger.ts#extractManualBlockRangesFromBody packages/core/src/anchor-ledger.ts#findFrontmatterEnd packages/core/src/anchor-ledger.ts#hasOpenDebt packages/core/src/anchor-ledger.ts#hashContent packages/core/src/anchor-ledger.ts#isDelimiterLineAt packages/core/src/anchor-ledger.ts#nextLineStart packages/core/src/anchor-ledger.ts#orchestrate packages/core/src/anchor-ledger.ts#reconcileManualBlocks packages/core/src/anchor-ledger.ts#rewriteBodyMarkers packages/core/src/anchor-ledger.ts#rewriteFrontmatterAnchorsList packages/core/src/anchor-ledger.ts#rewriteSymbolKeyInPage packages/core/src/anchor-ledger.ts#run packages/core/src/anchor-ledger.ts#upsertAnchor packages/core/src/anchor-ledger.ts#upsertDocPage packages/core/src/anchor-ledger.ts#upsertUndocumented -->

These anchors identify indexed symbols whose implementation is part of this module.

## Anchor-ledger tests

`anchor-ledger.test.ts` is the contract suite for the ledger. It builds an isolated repo + wiki + DB per test in `tmpdir`, runs the indexer, then runs the ledger, and finally queries the SQLite store directly to assert on the generated debt.

The two helpers are the I/O primitives:

```ts
async function writeCode(rel: string, content: string): Promise<void>
async function writeWiki(rel: string, content: string): Promise<void>
```

Both create parent directories and write the file under `repoRoot`. The DB query helper is:

```ts
function nodeSqliteQuery(repoRoot: string, sql: string): Array<Record<string, unknown>>
```

The tests cover the Phase-2 acceptance criteria end to end:

- First run with a fresh wiki is the baseline — pages are processed, anchors are upserted, but no debt is created.
- Section anchors become separate anchor rows, distinct from the page-level anchors.
- Editing an anchored function produces `debt.event = "changed"` with `assignee = "agent"` for `owner: generated` and `assignee = "human"` for `owner: human`.
- Section anchors also produce `changed` debt when the underlying function changes.
- Moving a function (delete + new symbol with matching content hash) produces `debt.event = "moved"`.
- Deleting an anchored symbol produces `debt.event = "deleted"` and the debt is open until the page rewrites its anchor.

The test cases truncated in the excerpt establish the changed/moved/deleted event taxonomy, but the exact test names for the move and delete scenarios are not in the supplied source — treat the list above as the contract the suite enforces, not as a verbatim index.

<!-- lw:anchors packages/core/src/anchor-ledger.test.ts#nodeSqliteQuery packages/core/src/anchor-ledger.test.ts#writeCode packages/core/src/anchor-ledger.test.ts#writeWiki -->

These anchors identify indexed symbols whose implementation is part of this module.

## Deterministic auxiliary page generation

`auxiliary-page.ts` is the LLM-free path for fixture, tooling, and docs modules. The original LLM-based stage-4 loop was kept producing drift often enough to burn repair slots and trip the stage-4 circuit breaker on `auxiliary_page_not_compact`, so this module assembles the same contract directly from the indexed symbols.

```ts
export function generateAuxiliaryModulePage(opts: {
  module: Module;
  role: AuxiliaryRole;
  symbols: AuxiliarySymbolRow[];
  closedKeyList: readonly string[];
}): string
```

`AuxiliaryRole` is the `PathRole` union minus `"product"`, so it can only be `"fixture"`, `"tooling"`, or `"docs"`. `AuxiliarySymbolRow` is a flat row with `key`, `name`, `kind`, and `signature: string | null` (null when the symbol is `const` or otherwise unsignatured).

The output is a complete Markdown artifact:

- Frontmatter with `title` (the module's `displayTitle` or the humanized id), `owner: generated`, and `anchors:` listing every key in `closedKeyList` (omitted entirely when the list is empty).
- An H1 equal to the title, followed by the responsibility sentence that names the module's classification.
- A `## When to use this page` section with three role-specific bullets sourced from `ROLE_BULLETS`.
- A `## How it fits` paragraph from `howItFitsParagraph`, which counts the module's files and frames the surface as classified (not product runtime).

```ts
function howItFitsParagraph(module: Module, roleLabel: string): string
```

- A `## Reference` section that walks every symbol via `disambiguateHeadings` to produce one H3 per symbol (with disambiguators like `run (a.ts)` when names collide across files), a single `lw:anchors` marker after each H3, and one paragraph from `referenceParagraph`.

```ts
function referenceParagraph(
  module: Module,
  roleLabel: string,
  symbol: AuxiliarySymbolRow,
): string
```

`referenceParagraph` strips backticks from the signature (so the wrapping code-span stays balanced even for type-template strings), truncates the signature — not the assembled sentence — to a `MAX_REFERENCE_PARAGRAPH_CHARS` budget (with a trailing `…`), and writes a sentence that frames the symbol as part of the role surface, not product runtime. `humanizeModuleId` is the title-case fallback used when `displayTitle` is missing:

```ts
function humanizeModuleId(id: string): string
```

The test file pins every part of that contract. `module` builds a `Module` with overridable fields, and `assertValid` is the round-trip: it normalizes the generated artifact, runs `validateStage4Artifact` against it with `moduleRole` set to the right auxiliary role, and asserts both `result.errors` is empty and `result.ok` is true. The suite asserts the four critical properties — empty closed key list is valid, H3 disambiguation for duplicate symbol names, backtick stripping for type-template signatures, and the 500-char reference-paragraph cap — plus that the humanized title and `displayTitle` are both honored.

<!-- lw:anchors packages/core/src/auxiliary-page.ts#disambiguateHeadings packages/core/src/auxiliary-page.ts#generateAuxiliaryModulePage packages/core/src/auxiliary-page.ts#howItFitsParagraph packages/core/src/auxiliary-page.ts#humanizeModuleId packages/core/src/auxiliary-page.ts#referenceParagraph packages/core/src/auxiliary-page.test.ts#assertValid packages/core/src/auxiliary-page.test.ts#module -->

These anchors identify indexed symbols whose implementation is part of this module.

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
- Flow: [cli-src → core-src-04 — export marker contract for stage-5 flows](flows/cli-src-to-core-src-04.md)
- [Batch orchestration, config, index schema, and deterministic diagrams](core-src-03.md) — dependency and dependent
- [Core source — prompts, safe I/O, status, symbols, topics](core-src-08.md) — dependency
- [Export, frontmatter, flows, and hashing primitives](core-src-04.md) — dependency and dependent
<!-- livewiki:navigate:end -->
