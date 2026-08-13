---
title: H2-section machinery for surgical repair
owner: generated
anchors:
  - packages/core/src/section-guard.ts#SURGICAL_REPAIR_ELIGIBLE_CODES
  - packages/core/src/section-guard.ts#slugifyHeading
  - packages/core/src/section-guard.ts#spliceSections
  - packages/core/src/section-guard.ts#splitH2Sections
  - packages/core/src/section-guard.ts#surgicalRepairTargetSections
---

# H2-section machinery for surgical repair

This page is responsible for the deterministic helpers that split a Markdown page into its H2 sections and merge a repaired copy back into the original, plus the eligibility rule that decides whether a set of validation errors may use the surgical (section-scoped) repair path at all.

## When to use this page

- **Decide** whether a given validation-error set is eligible for surgical repair by passing the errors to `surgicalRepairTargetSections` and checking for a non-null result.
- **Split** a page into its prefix (frontmatter + opening) and ordered H2 sections with `splitH2Sections` when you need to address sections individually.
- **Splice** a repaired page back into the original using `spliceSections` to replace only the targeted sections while guaranteeing every other byte is preserved.
- **Reuse** `slugifyHeading` anywhere a heading slug must match the slug the artifact validator (`artifact.ts`) attaches to a `sectionSlug`.

## How it fits

`packages/core/src/section-guard.ts` lives in the core package's repair tier. It is the deterministic counterpart to a model call: the orchestrator asks the model to fix a named set of H2 sections and return the rest of the page byte-for-byte identical, and this module is what splits the page before that call and what enforces the byte-identical guarantee after. It depends on `markdown-mask` for length-preserving masked scanning (so `##` inside fenced code blocks never fakes a boundary) and on the `ArtifactValidationError` type from `prompts` for the eligibility check. The eligibility result feeds back into the existing full-context repair path when it returns null, so behaviour for ineligible error sets is unchanged.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-section-guard.mmd
```

## Splitting a page into prefix and H2 sections

<!-- lw:anchors packages/core/src/section-guard.ts#slugifyHeading packages/core/src/section-guard.ts#splitH2Sections -->

The first job of this module is to turn a Markdown page into a prefix and an ordered list of H2 sections, with byte offsets that map 1:1 to the original text. That shape is what every downstream step — slicing a repaired page, comparing sections, splicing replacements — assumes.

The heading slug is produced by `slugifyHeading`:

```ts
export function slugifyHeading(text: string): string
```

It takes the raw heading text and returns a slug built by lowercasing, Unicode-normalizing and stripping diacritics, dropping non-word characters except spaces and hyphens, trimming, and collapsing whitespace into hyphens.

The page itself is split by `splitH2Sections`:

```ts
export function splitH2Sections(page: string): H2Split
```

It takes the full page string and returns the prefix (everything before the first H2, including frontmatter and the page opening) plus the H2 sections in document order.

Internally `splitH2Sections` runs the heading scan on a length-preserving masked view of the page (`maskCodeSpansPreservingLength` from `markdown-mask`), so a `##` line inside a fenced code block is invisible to the scanner, and every offset it records is an exact byte offset into `page` on both LF and CRLF input. Only level-2 headings create a section boundary; H3+ headings stay inside the H2 section that contains them, and each H2's `end` is the start of the next H2 or the end of the page. When the page has no H2 at all, the whole page is returned as the prefix with an empty `sections` array.

## Splicing a repaired page back into the original

<!-- lw:anchors packages/core/src/section-guard.ts#spliceSections -->

Once the model has returned a repaired page, the orchestrator must not blindly concatenate it onto the original: a section-scoped fix is only safe if every non-target byte is preserved. `spliceSections` is the anti-cascade guard that enforces that contract.

```ts
export function spliceSections(
  original: string,
  repaired: string,
  targetSections: readonly string[],
): string | null
```

It takes the original page, the repaired page, and the list of H2 slugs the model was asked to fix, and returns either the merged page (original with only the target sections replaced by their repaired counterparts) or `null` when the splice cannot be proven safe.

The safety checks, in order, are:

1. The empty-target short-circuit: if `targetSections` is empty the call returns `null` — there is nothing to splice and nothing to verify against.
2. Prefix equality: the prefix (frontmatter + opening) of `original` and `repaired` must match byte-for-byte; if it does not, the model rewrote more than it was asked to and `null` is returned.
3. Section count equality: `original` and `repaired` must expose the same number of H2 sections, otherwise a section was added or removed and `null` is returned.
4. Section sequence equality: the slug at every index must match, otherwise sections were renamed or reordered and `null` is returned.
5. Target uniqueness on both sides: each target slug must appear exactly once in `original` and exactly once in `repaired`; a missing or duplicated slug means the splice is ambiguous and `null` is returned.
6. Non-target cascade check: for every section whose slug is not in the target set, the byte slice from `original` must equal the byte slice from `repaired` at the same index. Any mismatch is treated as a cascade — a section the model was told to keep changed — and `null` is returned.

When all six checks pass, the function collects one replacement per target section and applies them in offset-descending order, so each replacement keeps earlier offsets valid while later offsets are rewritten. The returned string is `original` with only the target sections replaced; the prefix, every non-target section, and every byte outside the target ranges are unchanged.

## Deciding whether a set of errors may use the surgical path

<!-- lw:anchors packages/core/src/section-guard.ts#SURGICAL_REPAIR_ELIGIBLE_CODES packages/core/src/section-guard.ts#surgicalRepairTargetSections -->

The surgical path is narrower than the full repair path: it can only fix problems that live inside a single H2 section. The eligibility rule turns a set of validation errors into the deduplicated list of target section slugs that the orchestrator will pass to the model — or returns `null` to fall back to the existing full-context repair path, byte-identical to today.

The eligible error codes are encoded as a static set:

```ts
export const SURGICAL_REPAIR_ELIGIBLE_CODES: ReadonlySet<string> = new Set([
  "missing_page_opening",
  "todo_marker_present",
  "empty_section",
  "broken_internal_link",
  "anchor_missing_in_required_section",
])
```

It is a read-only set of the prose-level codes a section-scoped fix can address: missing-page-opening content, present TODO markers, empty sections, broken internal links, and missing anchors inside a required section. Any other code — structural, anchor-completeness, or unclassified — sends the attempt to the full-context path.

The rule itself is `surgicalRepairTargetSections`:

```ts
export function surgicalRepairTargetSections(
  errors: ReadonlyArray<ArtifactValidationError>,
): string[] | null
```

It takes the array of validation errors and returns either the deduplicated target slugs in first-seen order, or `null` when the error set is ineligible.

The check runs per error and bails out on the first failure:

1. If the error set is empty, the function returns `null` — there is nothing surgical to do.
2. Every error must carry a code that is in `SURGICAL_REPAIR_ELIGIBLE_CODES`; the first code outside the set returns `null`.
3. The error must resolve to a concrete section slug. The default source is `error.sectionSlug`. For the section-level `missing_page_opening` shape — identified by `code === "missing_page_opening"` and `location === "body"` — the slug is instead parsed from the message via `SECTION_LEVEL_OPENING_RE`, which matches either `page opening "X" must contain` or `topic section "X" must contain` and slugifies the captured name. If neither path yields a non-empty slug, the function returns `null`.
4. Surviving slugs are collected in first-seen order with duplicates dropped, and that array is returned.

When this function returns `null`, the caller takes the existing full-context repair path unchanged; when it returns an array, the orchestrator hands those slugs to the surgical prompt and the byte-identical guarantee comes from `spliceSections`.

## Tests

Covered by `packages/core/src/section-guard.test.ts` (same-name test file on disk).
