---
title: core-src-01 artifact and ledger pipeline
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
  - packages/core/src/artifact-repair.ts#escapeFirstUnmatchedInlineDelimiter
  - packages/core/src/artifact-repair.ts#removeLaterSectionAnchorOccurrences
  - packages/core/src/artifact-repair.ts#repairStage4ArtifactMechanically
  - packages/core/src/artifact-repair.ts#stripManualControlMarkers
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
  - packages/core/src/batch-repair.test.ts#ProgrammableMockLlm
  - packages/core/src/batch-repair.test.ts#ProgrammableMockLlm.generate
  - packages/core/src/batch-repair.test.ts#expectJoinedAttempts
  - packages/core/src/batch-repair.test.ts#makeInvalidPage
  - packages/core/src/batch-repair.test.ts#makeValidPage
  - packages/core/src/batch-repair.test.ts#readStage4Checkpoint
---

# core-src-01 artifact and ledger pipeline

This module bundles the stage-4 artifact contract (normalization, validation, mechanical repair), the deterministic auxiliary-page generator, the anchor ledger that syncs wiki markdown with the SQLite index, and their unit tests.

## When to use this page

- **Review** how a generated wiki artifact is normalized, validated, and optionally mechanically repaired before acceptance.
- **Trace** why the anchor ledger reports `changed`, `moved`, or `deleted` debt for an edited symbol, and which rewrite path touches the markdown.
- **Run** the batch-repair suite when changing the ledger or batch flow, using the programmable LLM mock to script repair-call counts and stop reasons.
- **Inspect** the auxiliary-page generator to understand how non-product modules get a no-LLM Markdown page that still passes the stage-4 contract.

## How it fits

This module lives under `packages/core/src`, the heart of livewiki. The artifact layer (normalize/validate/repair) is what consumes the stage-4 LLM output; the auxiliary-page generator replaces the LLM for fixture/tooling/docs modules so those pages are built deterministically from the index; and the anchor-ledger pipeline sits between the SQLite index (written by the indexer) and the wiki markdown under `livewiki/`. The `batch-repair.test.ts` and `auxiliary-page.test.ts` suites wire these pieces into the higher-level batch flow without crossing into the livewiki live-check command itself.

## Stage-4 artifact normalization

<!-- lw:anchors packages/core/src/artifact.ts#normalizeStage4Artifact packages/core/src/artifact.ts#validateStage4Artifact packages/core/src/artifact.ts#hasRealProse packages/core/src/artifact.ts#checkRequiredPageOpening packages/core/src/artifact.ts#checkRequiredTopicOpening packages/core/src/artifact.ts#checkRequiredFlowOpening packages/core/src/artifact.ts#flowSectionEnd packages/core/src/artifact.ts#flowSectionProseFailure packages/core/src/artifact.ts#findExactOpeningH2 packages/core/src/artifact.ts#findOpeningHeadingCandidate packages/core/src/artifact.ts#findNextH2 packages/core/src/artifact.ts#findFirstTodoPlaceholder packages/core/src/artifact.ts#findNextImplementationHeading packages/core/src/artifact.ts#firstPresentIndex packages/core/src/artifact.ts#offendingHeading packages/core/src/artifact.ts#openingSnippet packages/core/src/artifact.ts#proseBlockFailure packages/core/src/artifact.ts#err packages/core/src/artifact.ts#findOriginalLineStart packages/core/src/artifact.ts#findOriginalLineEnd packages/core/src/artifact.ts#countLines packages/core/src/artifact.ts#boundedOffendingExcerpt packages/core/src/artifact.ts#slugifyHeading packages/core/src/artifact.ts#lastHeadingBefore packages/core/src/artifact.ts#FLOW_DIAGRAM_SOURCE_MAX_CHARS packages/core/src/artifact.ts#flowDiagramPlaceholder packages/core/src/artifact.ts#extractInlineFlowDiagram packages/core/src/artifact.ts#countFlowchartElements packages/core/src/artifact.ts#countSequenceElements packages/core/src/artifact.ts#countFlowDiagramElements packages/core/src/artifact.ts#countStateElements packages/core/src/artifact.ts#validateExactTopicList -->

The artifact layer accepts the raw model transcript and returns either a normalized string or a structured error list.

```ts
export function normalizeStage4Artifact(raw: string): NormalizeResult
export function validateStage4Artifact(
```

`normalizeStage4Artifact` strips at most one complete `<think>...</think>` block from the start of the output, unwraps one outer `` ```markdown `` or `` ```md `` fence (other info strings, like `` ```ts ``, are left in place so the validator catches them later), and reports `unclosed_reasoning` when a `<think>` block has no matching `</think>`. The validator then enforces the frontmatter contract: `owner: generated` must appear explicitly, the `anchors:` list must be present when the closed list is non-empty, and every key cited in frontmatter or section markers must be in the closed list. Completeness is checked twice — once against the frontmatter list alone, once against the section-marker union — so a page cannot pass by hiding every key in one place. Section markers cannot be empty (each must be followed by real prose), the body must be fully closed Markdown, and `TODO`/`TBD` placeholders are banned except inside fenced code, inline code, or a manual block. Manual blocks themselves are rejected from the body, since rule #6 reserves them for human content the orchestrator reinserts byte-for-byte.

The opening contract is enforced by `checkRequiredPageOpening`, `checkRequiredTopicOpening`, and `checkRequiredFlowOpening`; each returns a `PageOpeningFailure` describing the offending section when the heading sequence is wrong. `flowSectionEnd` and `flowSectionProseFailure` bound the prose block under each flow H2 so `checkRequiredFlowOpening` can decide whether the marker is actually documented. Topic and flow page kinds also enforce `validateExactTopicList`, which uses `firstPresentIndex` to locate the earliest matching opening H2 and to attribute the failure to the right heading via `offendingHeading`.

Helpers around these checks — `findExactOpeningH2`, `findOpeningHeadingCandidate`, `findNextH2`, `findNextImplementationHeading`, `lastHeadingBefore`, `openingSnippet`, `slugifyHeading`, `proseBlockFailure`, `err` — produce the snippets used in error messages. The location of an error is mapped back to the original text through `findOriginalLineStart`, `findOriginalLineEnd`, `countLines`, and `boundedOffendingExcerpt`, which bound the excerpt shown to the LLM during repair.

Flow diagrams are extracted with `extractInlineFlowDiagram` against `FLOW_DIAGRAM_SOURCE_MAX_CHARS = 8000` and counted by kind via `countFlowchartElements`, `countSequenceElements`, `countStateElements`, and `countFlowDiagramElements`; `flowDiagramPlaceholder` returns the canonical placeholder string for a given slug. `hasRealProse` decides whether an anchored section is genuinely documented, distinct from a marker-only stub. `findFirstTodoPlaceholder` and `validateExactTopicList` close the loop on topic-page discipline. The visible excerpt is truncated by the token budget, so this section only claims behavior that can be read in the supplied source.

## Mechanical stage-4 repair

<!-- lw:anchors packages/core/src/artifact-repair.ts#repairStage4ArtifactMechanically packages/core/src/artifact-repair.ts#stripManualControlMarkers packages/core/src/artifact-repair.ts#removeLaterSectionAnchorOccurrences packages/core/src/artifact-repair.ts#escapeFirstUnmatchedInlineDelimiter -->

```ts
export function repairStage4ArtifactMechanically(
```

`repairStage4ArtifactMechanically` is the bounded fallback invoked when a repair prompt is not appropriate. It classifies each reported error into the shapes it knows how to fix (`unclosed_markdown`, `missing_closed_key`, `empty_section`, `duplicate_anchor`, `model_invented_manual`); any error outside those shapes, or any R10.1 item D flow-placement code (`anchor_in_disallowed_section`, `anchor_missing_in_required_section`, `anchor_missing_required_tier`), causes the function to return `null`, preserving its fail-closed posture.

For unclosed inline code fences, `escapeFirstUnmatchedInlineDelimiter` rewrites the stray backtick run; the loop caps repairs at `MAX_INLINE_DELIMITER_REPAIRS = 100`, and an exhausted budget returns `null` rather than risk an unbounded patch. Missing section keys are appended to a single new "Additional indexed symbols" section under a marker that the function constructs inline; empty section markers are filled with a short contextual sentence computed by re-scanning the masked body via `maskCodeSpansPreservingLength`; duplicate section keys are de-duplicated by `removeLaterSectionAnchorOccurrences`; and an invented manual marker is stripped by `stripManualControlMarkers`. After every transformation step the validator must accept the artifact before it is returned. The excerpt is truncated, so the prose here describes the visible repair shape only.

## Deterministic auxiliary page generator

<!-- lw:anchors packages/core/src/auxiliary-page.ts#generateAuxiliaryModulePage packages/core/src/auxiliary-page.ts#howItFitsParagraph packages/core/src/auxiliary-page.ts#referenceParagraph packages/core/src/auxiliary-page.ts#disambiguateHeadings packages/core/src/auxiliary-page.ts#humanizeModuleId packages/core/src/auxiliary-page.test.ts#module packages/core/src/auxiliary-page.test.ts#assertValid -->

```ts
export function generateAuxiliaryModulePage(opts: {
  module: Module;
  role: AuxiliaryRole;
  symbols: AuxiliarySymbolRow[];
  closedKeyList: readonly string[];
}): string
```

`generateAuxiliaryModulePage` builds the full Markdown artifact for non-product modules (`fixture` | `tooling` | `docs`) without calling the LLM. The role drives both the `When to use this page` bullets and the label sentence embedded in the prose (`howItFitsParagraph` swaps between singular and plural file wording based on `module.paths.length`). The title falls back from `module.displayTitle` to a humanized form of the module ID via `humanizeModuleId`.

For each indexed symbol, `disambiguateHeadings` produces a heading that survives two symbols sharing a name across different files (suffixing with the path), and `referenceParagraph` composes a single short paragraph that embeds the literal signature (with backticks neutralized to single quotes to keep the outer backtick-span balanced) and truncated to `MAX_REFERENCE_PARAGRAPH_CHARS = 500`. The assembled artifact is normalized to at most one blank line between paragraphs. The tests in `auxiliary-page.test.ts` use the `module` helper to fabricate `Module` rows and the `assertValid` helper to normalize and validate the produced artifact, confirming that disambiguated headings, humanized titles, and zero-symbol cases all satisfy the contract.

## Anchor markdown parser

<!-- lw:anchors packages/core/src/anchors.ts#extractAnchors packages/core/src/anchors.ts#slugify packages/core/src/anchors.ts#isInsideAny -->

```ts
export function extractAnchors(source: string): ExtractedAnchors
export function slugify(heading: string): string
```

`extractAnchors` parses one markdown page into three structural layers: frontmatter page anchors (each emitted from the `anchors:` list), section markers placed under a heading (`SectionAnchor` rows with their resolved `sectionSlug`), and `ManualBlock` ranges used for byte-level preserves later. `slugify` is the heading-to-slug normalizer used for those section slugs; it lowercases, replaces whitespace with hyphens, strips diacritics, and collapses runs. `isInsideAny` answers whether a byte range falls inside one of the parsed `ManualBlock` ranges — the ledger consults it to decide whether an anchor is in a protected zone.

The parser works on the body after a `maskCodeSpansPreservingLength` pass, so anchor and manual-marker lines inside code spans are not mistaken for real markers; nested `lw:manual` starts without an end are silently skipped (no row is produced), and a stray end without a start is also ignored. Anchors without a preceding heading are dropped, and a duplicate section heading yields the same slug both times because the `(doc_page_id, section_slug)` key is what the ledger and validator actually care about.

## Anchor ledger pipeline

<!-- lw:anchors packages/core/src/anchor-ledger.ts#run packages/core/src/anchor-ledger.ts#orchestrate packages/core/src/anchor-ledger.ts#collectWikiPages packages/core/src/anchor-ledger.ts#upsertDocPage packages/core/src/anchor-ledger.ts#upsertAnchor packages/core/src/anchor-ledger.ts#createDebt packages/core/src/anchor-ledger.ts#hasOpenDebt packages/core/src/anchor-ledger.ts#detectMoves packages/core/src/anchor-ledger.ts#upsertUndocumented packages/core/src/anchor-ledger.ts#assigneeFor packages/core/src/anchor-ledger.ts#hashContent packages/core/src/anchor-ledger.ts#rewriteSymbolKeyInPage packages/core/src/anchor-ledger.ts#findFrontmatterEnd packages/core/src/anchor-ledger.ts#isDelimiterLineAt packages/core/src/anchor-ledger.ts#endOfLine packages/core/src/anchor-ledger.ts#nextLineStart packages/core/src/anchor-ledger.ts#extractManualBlockRangesFromBody packages/core/src/anchor-ledger.ts#rewriteFrontmatterAnchorsList packages/core/src/anchor-ledger.ts#rewriteBodyMarkers packages/core/src/anchor-ledger.ts#escapeRegex packages/core/src/anchor-ledger.ts#reconcileManualBlocks packages/core/src/anchor-ledger.ts#AnchorParseError packages/core/src/anchor-ledger.ts#AnchorParseError.constructor -->

```ts
export async function run(
  repoRoot: string,
  opts: LedgerOptions = {},
): Promise<LedgerResult>
```

`run` opens `.livewiki/index.db` and forwards to `orchestrate`, which gathers wiki pages via `collectWikiPages`, loads `doc_pages`, the existing anchor map, active symbols, and the deleted-symbols table used for `moved` detection. Anchors are keyed as `doc_page_id | section_slug | symbol_key` so that a single section can hold multiple frontmatter symbols without spurious `changed` debt. `hashContent` produces the `sha256` symbol fingerprint used by `detectMoves` (content-hash match is primary, name+signature is the fallback) and `createDebt`; `assigneeFor` decides `agent` vs `human` from the page owner, defaulting the `mixed` case to `agent`. `upsertAnchor` and `upsertDocPage` materialize the new rows; `upsertUndocumented` records active symbols not cited by any anchor; `hasOpenDebt` lets the ledger skip rewriting work when an open row already covers the case.

When a symbol is detected as moved, the rewrite happens in the markdown itself via safe-io (`rewriteSymbolKeyInPage`) — both the frontmatter list (`rewriteFrontmatterAnchorsList`) and the section-marker comments (`rewriteBodyMarkers`). These rewrites scan the source through byte-offset helpers (`findFrontmatterEnd`, `isDelimiterLineAt`, `endOfLine`, `nextLineStart`) and walk manual-block ranges (`extractManualBlockRangesFromBody`) to enforce rule #6: pages with `owner: human` and anchors inside a `lw:manual` block never have their text rewritten by the ledger. `escapeRegex` is reused wherever a symbolic key is interpolated into a replacement pattern. `reconcileManualBlocks` rehydrates manual content after the rewrite pass, and any anchor-parse failure that reaches the orchestrator surfaces as `AnchorParseError`, with its `constructor` wrapping the underlying `Error` and naming the offending wiki path.

The visible excerpt of this file is truncated before the diff-and-rewrite body of `orchestrate`, so the rewrite semantics described here are exactly those readable in the supplied source; the complete loop and rollback posture is not established by the excerpt alone.

## Anchor-ledger test harness

<!-- lw:anchors packages/core/src/anchor-ledger.test.ts#writeCode packages/core/src/anchor-ledger.test.ts#writeWiki packages/core/src/anchor-ledger.test.ts#nodeSqliteQuery -->

```ts
async function writeCode(rel: string, content: string): Promise<void>
async function writeWiki(rel: string, content: string): Promise<void>
function nodeSqliteQuery(repoRoot: string, sql: string): Array<Record<string, unknown>>
```

`writeCode` and `writeWiki` are per-test tempdir helpers that materialize an isolated repo + wiki on disk, allowing each `it` to run the indexer and ledger from a clean state. `nodeSqliteQuery` is the synchronous SQLite inspection helper used to assert on `debt` rows directly — for example, that a `changed` event carries `assignee: agent` for an `owner: generated` page and `assignee: human` for an `owner: human` page. The visible tests cover the empty-wiki baseline, the first-run anchor upsert, and the `changed`-debt criterion with both ownership kinds; further test bodies are truncated by the budget, so this section does not claim behavior beyond the helper signatures and the visible asserts.

## Batch-repair test harness

<!-- lw:anchors packages/core/src/batch-repair.test.ts#ProgrammableMockLlm packages/core/src/batch-repair.test.ts#ProgrammableMockLlm.generate packages/core/src/batch-repair.test.ts#makeValidPage packages/core/src/batch-repair.test.ts#makeInvalidPage packages/core/src/batch-repair.test.ts#readStage4Checkpoint packages/core/src/batch-repair.test.ts#expectJoinedAttempts -->

```ts
class ProgrammableMockLlm implements LlmClient {
  public readonly provider = "anthropic" as const;
  public readonly model = "claude-test-mock";
  ...
  async generate(req: import("./llm/types.js").GenerateRequest): Promise<GenerateResult>
```

`ProgrammableMockLlm` queues responses per call, optionally throws on selected indices, and can auto-construct a valid page from the closed key list embedded in the prompt, so uniqueness and repair tests don't have to enumerate symbol sets by hand. `makeValidPage` produces that auto-mode artifact; `makeInvalidPage` produces a content-shaped-but-non-conforming body whose `uniqueText` lets tests identify it across repair attempts. `readStage4Checkpoint` loads a per-task checkpoint via `better-sqlite3` so the test can inspect usage and stop-reason accumulators between repair slots, and `expectJoinedAttempts` asserts on the joined diagnostic attempts the batch exposes. The visible file is truncated before the `runBatch`/`runOnly` integration tests, so this section limits itself to the helper surface and the behavior visible above.

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
- Flow: [CLI bootstrap to wiki export (cli-src to core-src-04)](flows/cli-src-to-core-src-04.md)
- [Batch orchestration, config, index DB, and diagram generators](core-src-03.md) — dependency and dependent
- [Core prompt, I/O allowlist, symbol extraction, status and topic planning](core-src-08.md) — dependency
- [Wiki export, flow detection, and parser helpers](core-src-04.md) — dependency and dependent
<!-- livewiki:navigate:end -->
