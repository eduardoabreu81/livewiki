---
title: Anchor ledger and artifact repair
owner: generated
anchors:
  - packages/core/src/anchor-ledger.test.ts#nodeSqliteExec
  - packages/core/src/anchor-ledger.test.ts#nodeSqliteQuery
  - packages/core/src/anchor-ledger.test.ts#simulateLegacyCrlfDb
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
  - packages/core/src/artifact-repair.test.ts#makePage
  - packages/core/src/artifact-repair.test.ts#validateFlow
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
---

# Anchor ledger and artifact repair

This module reconciles wiki anchor metadata against the code index and mechanically repairs stage-4 documentation artifacts emitted by the model.

## When to use this page

- **Trace** how a wiki page's anchors and section markers become `changed`, `moved`, or `deleted` debt rows.
- **Validate** that the ledger honors rule #6 (never rewrites anchors on `owner: human` pages or inside `lw:manual` blocks).
- **Inspect** the closed set of validation codes the mechanical repairer is allowed to touch, and the fail-closed fallback for unsupported codes.
- **Review** the conservative twin policy that prevents false-positive `moved` detection when same-name same-kind symbols survive elsewhere.

## How it fits

This module sits between the code indexer and the wiki verification pipeline inside `packages/core/src/`. The anchor ledger reads every markdown page under `livewiki/`, diffs its anchors against the active symbol table from `.livewiki/index.db`, and writes debt rows that downstream stages consume. `anchors.ts` is the pure parser the ledger delegates to, and `artifact-repair.ts` is the last-slot fallback used after a stage-4 generation round, applying mechanical fixes (escaping inline delimiters, deduping section markers, syncing frontmatter lists) only when the validator's error set stays inside a closed whitelist.

The ledger also owns the markdown rewrite path: when a symbol is genuinely `moved` and no twin survives, it patches both the frontmatter `anchors:` list and the in-body `lw:anchors` markers in place, except on `owner: human` pages or inside `lw:manual` ranges — those only produce debt with `assignee=human`.

## Ledger entry point and orchestration

<!-- lw:anchors packages/core/src/anchor-ledger.ts#run packages/core/src/anchor-ledger.ts#orchestrate packages/core/src/anchor-ledger.ts#collectWikiPages packages/core/src/anchor-ledger.ts#hashContent packages/core/src/anchor-ledger.ts#upsertDocPage packages/core/src/anchor-ledger.ts#upsertAnchor packages/core/src/anchor-ledger.ts#AnchorParseError packages/core/src/anchor-ledger.ts#AnchorParseError.constructor -->

The public entry point is `run`, which resolves the repo root, ensures `.livewiki/` exists via `safe-io`, opens the SQLite index, and delegates to `orchestrate` before closing the database in a `finally` block. `orchestrate` builds four in-memory maps from `doc_pages`, `anchors`, active `symbols`, and `status='deleted'` symbols, then walks the wiki pages returned by `collectWikiPages` to upsert anchors and reconcile debt.

`collectWikiPages` returns `{ relPath: string }[]` for every `.md` page under `livewiki/`. For each page, the ledger reads the file with `safeIo.readText`, skipping (and counting) any page that throws, then calls `extractAnchors(source)`. A parse failure throws an `AnchorParseError`, whose constructor signature is:

```ts
constructor(wikiPath: string, cause: Error) {
```

The error message prefixes the failing wiki path and the underlying cause message; the class name is set to `AnchorParseError` so callers can `instanceof`-check without relying on the message text.

`upsertDocPage` reconciles the `(wiki_path, content_hash, owner)` triple against the `existingDocPages` map, and `upsertAnchor` writes a row keyed by `(doc_page_id, section_slug, symbol_key)` — the symbol key is part of the composite because frontmatter pages can list multiple symbols under `section_slug = null` and the diff loop would otherwise match every entry against whichever symbol the last-loaded row happened to point at. `hashContent` produces the page-level content hash used for change detection.

## Debt classification and assignee routing

<!-- lw:anchors packages/core/src/anchor-ledger.ts#createDebt packages/core/src/anchor-ledger.ts#hasOpenDebt packages/core/src/anchor-ledger.ts#detectMoves packages/core/src/anchor-ledger.ts#upsertUndocumented packages/core/src/anchor-ledger.ts#assigneeFor -->

For every anchor the ledger diffs current state against the previous row. A symbol whose `content_hash` changed becomes a `changed` row; one whose file disappeared becomes a `deleted` row. `detectMoves` applies the conservative twin policy: a disappeared symbol is accepted as `moved` only when no ACTIVE symbol with the same short name and same kind survives elsewhere (the match candidate itself excepted). A function and a class sharing a name are NOT twins because their kinds differ, but `Class.render` in two classes ARE twins because the method name and kind match — even when their qualified keys differ. When a twin survives, the disappearance is reclassified by the normal rules (`changed` if the file was updated, `deleted` if the file is gone) and anchors keep pointing at their original file, because rewriting to the twin would re-anchor the page to an implementation its prose does not describe.

`createDebt` writes the resulting row, `hasOpenDebt` queries whether an open debt already exists for the same anchor/event so the ledger doesn't double-emit, and `upsertUndocumented` flags active symbols that no page references. `assigneeFor` picks `agent` for `owner: generated`, `human` for `owner: human`, and `agent` for mixed pages (the generated portion wins). Its signature is:

```ts
function assigneeFor(owner: Owner, inManualBlock: boolean): Assignee
```

The `inManualBlock` flag is the lever that flips an anchor inside an `lw:manual` range — even on a `generated` page — to `assignee: human`, mirroring the rule that those ranges are never rewritten.

## Markdown rewrite primitives

<!-- lw:anchors packages/core/src/anchor-ledger.ts#findFrontmatterEnd packages/core/src/anchor-ledger.ts#isDelimiterLineAt packages/core/src/anchor-ledger.ts#endOfLine packages/core/src/anchor-ledger.ts#nextLineStart packages/core/src/anchor-ledger.ts#extractManualBlockRangesFromBody packages/core/src/anchor-ledger.ts#rewriteFrontmatterAnchorsList packages/core/src/anchor-ledger.ts#rewriteBodyMarkers packages/core/src/anchor-ledger.ts#rewriteSymbolKeyInPage packages/core/src/anchor-ledger.ts#escapeRegex packages/core/src/anchor-ledger.ts#reconcileManualBlocks -->

The rewrite path operates on the raw markdown because the DB is not the source of truth for anchor strings — only the page is. `findFrontmatterEnd` returns the byte offset of the closing `---` fence; `isDelimiterLineAt` checks whether a position sits on a fence line; `endOfLine` and `nextLineStart` advance through the body without a full split. `extractManualBlockRangesFromBody` returns the inclusive start / exclusive end byte ranges of every `lw:manual` … `/lw:manual` block, and `reconcileManualBlocks` enforces that those ranges match the just-parsed source so a hand-edited page cannot silently lose its protection.

`rewriteFrontmatterAnchorsList` replaces the `anchors:` YAML list inside the frontmatter block, and `rewriteBodyMarkers` rewrites every `lw:anchors` marker that cites a moved symbol. `rewriteSymbolKeyInPage` is the public entry that calls both, scoped to the non-manual body. `escapeRegex` exists for safe regex construction when matching symbol keys verbatim in the body. All four invariants of rule #3 (rewrite on the markdown, not the DB) and rule #6 (never touch human-owned or manual-blocked content) are enforced here: an `inManualBlock` anchor or an `owner: human` page returns from the diff loop without invoking any of the rewrite helpers, leaving only a debt row with `assignee=human`.

## Anchor parser (`anchors.ts`)

<!-- lw:anchors packages/core/src/anchors.ts#extractAnchors packages/core/src/anchors.ts#slugify packages/core/src/anchors.ts#isInsideAny -->

`extractAnchors` parses a single wiki page into `{ pageAnchors, sectionAnchors, manualBlocks, frontmatter, owner, body }`. It first delegates frontmatter parsing, then masks code spans with `maskCodeSpansPreservingLength` so that fenced code blocks and inline code cannot masquerade as real markers. Heading detection runs on the masked body; markers run on the masked body too, but their offsets are translated back into the original source via `fm.bodyOffset`. A marker with no preceding heading is dropped (malformed page). `inManualBlock` is computed by `isInsideAny`, which requires the marker interval `[start, end]` to lie entirely inside one manual block range — markers that merely touch the boundary do not flip the flag.

`slugify` lowercases the heading, normalizes to NFD, strips combining diacritics, removes punctuation, and collapses whitespace into single hyphens. Its signature is:

```ts
export function slugify(heading: string): string
```

"Fluxo de validação" becomes `fluxo-de-validacao`; "Auth — login & sessão" becomes `auth-login-sessao`. The slug is unique per heading text (deduped by the `(wiki_path, section_slug)` UNIQUE constraint, not by the function itself).

## Mechanical artifact repair (`artifact-repair.ts`)

<!-- lw:anchors packages/core/src/artifact-repair.ts#repairStage4ArtifactMechanically packages/core/src/artifact-repair.ts#MECHANICAL_STAGE4_CODES packages/core/src/artifact-repair.ts#escapeFirstUnmatchedInlineDelimiter packages/core/src/artifact-repair.ts#removeLaterSectionAnchorOccurrences packages/core/src/artifact-repair.ts#stripManualControlMarkers packages/core/src/artifact-repair.ts#sectionAncestorAt -->

`repairStage4ArtifactMechanically` is the fail-closed last-slot fallback for stage-4 documentation artifacts. Its signature is:

```ts
export function repairStage4ArtifactMechanically(
  artifact: string,
  errors: ReadonlyArray<ArtifactValidationError>,
  closedKeyList: ReadonlyArray<string>,
  context?: Readonly<Stage4ValidationContext>,
): MechanicalArtifactRepairResult | null
```

If the error array is empty, or any error carries a code outside `MECHANICAL_STAGE4_CODES`, the function returns `null`. That closed set is the single source of truth shared with the prompt-side repair contract:

```ts
export const MECHANICAL_STAGE4_CODES = [
  "unclosed_markdown",
  "missing_closed_key",
  "empty_section",
  "duplicate_anchor",
  "model_invented_manual",
] as const satisfies readonly ArtifactValidationCode[];
```

The R10.1 flow-placement codes (`anchor_in_disallowed_section`, `anchor_missing_in_required_section`, `anchor_missing_required_tier`) are not on this list — they require prompt-only repair, so any error set containing them aborts even when paired with a code the function does support. Each repair step is gated by a successful mutation (`escaped !== null && escaped !== content`) and capped at `MAX_INLINE_DELIMITER_REPAIRS = 100` for the unclosed-inline path; after every mutation the full stage-4 validator runs again and the function returns `null` unless the transformed artifact validates cleanly.

The repair ops themselves: `escapeFirstUnmatchedInlineDelimiter` rewrites the first stray backtick so `unclosedMarkdownDiagnostic` resolves; `removeLaterSectionAnchorOccurrences` keeps the earliest section-marker citation of a duplicated key and drops the later ones; `stripManualControlMarkers` removes model-invented `lw:manual` markers (the validator already verified their absence); `sectionAncestorAt` walks the section tree to find the section a marker belongs to.

## Upper-bound repair and frontmatter sync

<!-- lw:anchors packages/core/src/artifact-repair.ts#repairUpperBoundArtifactMechanically packages/core/src/artifact-repair.ts#MECHANICAL_UPPER_BOUND_CODES packages/core/src/artifact-repair.ts#syncFrontmatterAnchorsList packages/core/src/artifact-repair.ts#TOPIC_SECTION_HEADING_MAP -->

`repairUpperBoundArtifactMechanically` is the contract for flow/topic pages where the closed list caps what MAY be cited and frontmatter anchors and section-marker keys only need to equal each other. Its signature is:

```ts
export function repairUpperBoundArtifactMechanically(
  artifact: string,
  errors: ReadonlyArray<ArtifactValidationError>,
  closedKeyList: ReadonlyArray<string>,
  context: Readonly<Stage4ValidationContext>,
): MechanicalArtifactRepairResult | null
```

The codes it acts on are scoped tighter than the stage-4 list:

```ts
export const MECHANICAL_UPPER_BOUND_CODES = [
  "duplicate_anchor",
  "missing_closed_key",
] as const satisfies readonly ArtifactValidationCode[];
```

Unrecognized codes are skipped (the final full re-validation stays fail-closed). For `duplicate_anchor` (section) it keeps the earliest marker occurrence. For `missing_closed_key` (frontmatter) — the key is already cited in a section marker, so it gets added to the frontmatter list. For `missing_closed_key` (section) — the key is only in the frontmatter list with no section citing it, so it gets dropped from the frontmatter list. `syncFrontmatterAnchorsList` performs the YAML-list edits and `TOPIC_SECTION_HEADING_MAP` provides the canonical heading text used when a flow page needs a fallback section for a synthesized marker.

## Test fixtures and helpers

<!-- lw:anchors packages/core/src/anchor-ledger.test.ts#writeCode packages/core/src/anchor-ledger.test.ts#writeWiki packages/core/src/anchor-ledger.test.ts#nodeSqliteQuery packages/core/src/anchor-ledger.test.ts#nodeSqliteExec packages/core/src/anchor-ledger.test.ts#simulateLegacyCrlfDb packages/core/src/artifact-repair.test.ts#makeFlowPage packages/core/src/artifact-repair.test.ts#makePage packages/core/src/artifact-repair.test.ts#validateFlow -->

The ledger tests build a fresh tmpdir-backed repo per case via `beforeEach`/`afterEach`. `writeCode` writes an indexable source file and `writeWiki` writes a wiki page, both creating parent directories as needed. `nodeSqliteQuery` returns `Array<Record<string, unknown>>` from a raw SQL statement against `.livewiki/index.db` so test assertions can use `toContainEqual` against the actual persisted rows. `nodeSqliteExec` is its write-side counterpart for cases that need to mutate the DB directly.

`simulateLegacyCrlfDb` is a regression helper for the pre-item-12 CRLF era: it rewrites a target file's DB rows into the faithful pre-upgrade state — the file hash is the sha256 of raw CRLF bytes, symbol/anchor hashes are the raw CRLF node slices recomputed through the same extractor (the parser is already initialized because the indexer ran first), and the `eol_hashes_normalized` meta flag is deleted so the per-symbol realignment window reopens. Its signature is:

```ts
async function simulateLegacyCrlfDb(relPath: string, lfText: string): Promise<void>
```

On the repair side, `makePage` synthesizes a minimal compliant artifact for non-flow validator cases, while `makeFlowPage` produces a flow page with `Purpose`, `Ordered flow`, `Diagram` (a mermaid block matching `flowDiagramPlaceholder(...)`), `Invariants`, `Failure and recovery`, and `Related pages` sections. `validateFlow` wraps `validateStage4Artifact` with a `flow` page context so a single call exercises the upper-bound contract.

<!-- livewiki:navigate:start -->
## Navigate

- Flow: [CLI to persistence flow — entry through `livewiki batch` to the SQLite index](flows/cli-src-01-to-core-src-05.md)
- [Core Repair, Status, Sectioning, Symbols, and Risk Pipeline](core-src-11.md) — dependency and dependent
- [Core runtime config, schema, diagrams, diff preview, and export](core-src-05.md) — dependency and dependent
- [Core module identification, manifest I/O, and Markdown mask helpers](core-src-08.md) — dependency

> Coverage note: this module's source (7 files, ~268k chars) exceeded the prompt budget and was excerpted; this page documents the closed-list symbols.
<!-- livewiki:navigate:end -->
