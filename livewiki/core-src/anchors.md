---
title: Anchor and manual-block extractor
owner: generated
anchors:
  - packages/core/src/anchors.ts#extractAnchors
  - packages/core/src/anchors.ts#isInsideAny
  - packages/core/src/anchors.ts#slugify
---

# Anchor and manual-block extractor

This page documents the module that extracts structural metadata from a wiki page's Markdown source: page-level anchors from frontmatter, per-section anchors from in-body markers, and the byte ranges of human-protected manual blocks.

## When to use this page

- **Scan a wiki page** when you need the list of symbols the page claims to document and the heading each symbol belongs to.
- **Verify anchor drift** when generated documentation must be checked against the on-disk code, including the distinction between "code moved" and "anchor lives in a human-protected region".
- **Locate manual blocks** when a downstream verifier needs byte-precise ranges of `...` regions to skip during rewriting.
- **Slugify headings** when a downstream pipeline needs a stable, URL-friendly identifier from a heading string.

## How it fits

This module lives in `packages/core/src/anchors.ts`, sitting between the frontmatter parser (`./frontmatter.js`) and the Markdown masking helper (`./markdown-mask.js`). It is invoked by the doc-generation orchestrator whenever a wiki page is read or regenerated, and its output feeds the byte-level `verify` step that distinguishes genuine anchor drift from anchors that fall inside human-owned content. It does not write files and does not touch the symbol table; it only inspects a Markdown string and returns structured ranges and key lists.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-anchors.mmd
```

## Parsing the page surface

<!-- lw:anchors packages/core/src/anchors.ts#extractAnchors -->

The first responsibility is to split a Markdown page into the parts the rest of the pipeline cares about: frontmatter (parsed into a typed object), the Markdown body after the closing `---`, and the byte offset where the body begins in the original source. That body offset matters because later ranges and marker offsets are reported in original-source coordinates, so any downstream verifier can compare them against the file on disk without first re-aligning indices.

`extractAnchors` is the single entry point:

```ts
export function extractAnchors(source: string): ExtractedAnchors
```

It takes the full Markdown source of one wiki page and returns an `ExtractedAnchors` record carrying `pageAnchors`, `sectionAnchors`, `manualBlocks`, the parsed `frontmatter`, the declared `owner`, and the `body` string.

Internally the function calls `parseFrontmatter(source)` to get `{ frontmatter, body, bodyOffset }`, then hands `body` to `maskCodeSpansPreservingLength` before scanning for headings and markers. Masking code spans and code fences before scanning is the mechanism that prevents a heading-looking line inside a fenced example from being mistaken for a real heading.

The returned `owner` falls back to `"generated"` when the frontmatter does not declare one (the type is `Owner = "generated" | "human" | "mixed"`), which is why generated pages are the default and human-owned content remains a deliberate opt-in.

## Collecting manual-block ranges

<!-- lw:anchors packages/core/src/anchors.ts#isInsideAny -->

Before any anchors are extracted, the function walks the body for `` and `` markers and folds them into a sorted list of `{ start, end }` ranges. The collection logic is a flat toggle: a start without a matching end is silently ignored (no thrown error here), and nested starts without an intervening end are skipped, so a malformed page does not abort generation. Each range is later shifted by `bodyStartInOriginal` so its offsets are valid against the original source, not the body slice.

`isInsideAny` is the lookup helper used to flag any anchor whose marker lies inside one of these ranges:

```ts
function isInsideAny(start: number, end: number, blocks: ManualBlock[]): boolean
```

It takes the start and end byte offsets of an anchor marker and the already-collected manual-block ranges, and returns `true` when at least one range fully contains both endpoints (`start >= b.start && end <= b.end`). That containment check runs against the pre-shift (body-relative) offsets, because the caller passes the body-relative marker offsets it just computed. The result feeds the `inManualBlock` boolean on each `SectionAnchor`, which is what lets `verify` later attribute a "missing anchor" finding to either code drift or a human-protected region.

## Resolving section anchors

<!-- lw:anchors packages/core/src/anchors.ts#slugify -->

The final stage walks the masked body for `<!-- lw:anchors ... -->` markers and binds each one to the heading that immediately precedes it in document order. To do that without entangling the two scans, the function first collects every Markdown heading (levels 1–6, though the rationale evidence flags that only `##` and `###` are used in practice) along with its slug and body offset, then iterates the anchor markers and, for each, picks the heading whose offset is the largest value still strictly less than the marker's offset. An anchor with no preceding heading is dropped silently rather than raising — the rationale comment in the source frames this as a "malformed page" path that the caller is expected to handle.

Each surviving marker becomes a `SectionAnchor` with `sectionSlug`, `headingText`, `symbolKeys` (the whitespace-split, filtered list of keys in the marker), `anchorMarkerOffset` shifted into original-source coordinates, and the `inManualBlock` flag computed through `isInsideAny`. The page-level anchor list is taken straight from the frontmatter via `getAnchors(fm.frontmatter)` and is reported alongside the section list, so a verifier sees both the page-wide claims and the section-scoped claims in one return value.

Heading slugs are produced by `slugify`:

```ts
export function slugify(heading: string): string
```

It takes a raw heading string and returns a lowercase, hyphen-separated slug. The visible pipeline is: lowercase → Unicode NFD normalization → stripping combining diacritics (`\u0300-\u036f`) → removing remaining non-word, non-space, non-hyphen punctuation → trimming → collapsing whitespace runs to single hyphens. The rationale comment notes that this preserves accented letters common in Portuguese ("Fluxo de validação" becomes "fluxo-de-validacao"), which is why the character class is `[^\w\s-]` rather than the ASCII-only `[a-z0-9\s-]`. No other input shape is handled beyond single-string headings; multi-line or already-slugified inputs are not validated, and the function does not clamp length or otherwise bound its output.

## Tests

Covered by `packages/core/src/anchors.test.ts` (same-name test file on disk).
