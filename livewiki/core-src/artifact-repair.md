---
title: Mechanical artifact repair
owner: generated
anchors:
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

# Mechanical artifact repair

This module provides deterministic, content-safe fallbacks that the artifact pipeline can apply to a generated Markdown page before falling back to the expensive LLM repair loop.

## When to use this page

- **Audit** the closed set of validation codes each mechanical repairer is allowed to act on, and the shared constants that drive the fail-closed gate.
- **Trace** how a stage-4 module page is rewritten for unclosed inline delimiters, missing/empty/duplicate section anchors, and invented manual control markers.
- **Trace** how a flow or topic page (upper-bound contract) is rewritten for duplicate section anchors and frontmatter/section anchor-list drift.
- **Reason** about the keeper-selection rules that decide which duplicate section-marker occurrence survives, including the required-section coverage safety net.

## How it fits

`packages/core/src/artifact-repair.ts` sits inside `packages/core/src/` next to the artifact validator (`./artifact.js`) and the Markdown masking utility (`./markdown-mask.js`). It exposes two top-level repairers — `repairStage4ArtifactMechanically` for module pages and `repairUpperBoundArtifactMechanically` for flow/topic pages — and a small set of internal helpers that perform the actual byte-level rewrites. Each repairer accepts a list of `ArtifactValidationError`s produced by the validator plus the closed key list that the page must cite, and returns a transformed artifact plus a list of repair kinds applied. Both repairers re-run the full stage-4 validator before returning anything; if the rewritten artifact still fails validation, the repairer returns `null` and the caller is expected to fall back to the LLM repair path. The module is the last resort before that LLM path, so it is intentionally fail-closed: any unrecognized error code, any unrecoverable shape, or any failed re-validation yields `null` rather than a plausibly-fixed artifact.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-artifact-repair.mmd
```

## Closed-code sets for the two repairers

<!-- lw:anchors packages/core/src/artifact-repair.ts#MECHANICAL_STAGE4_CODES packages/core/src/artifact-repair.ts#MECHANICAL_UPPER_BOUND_CODES -->

The two repairers only act on a hard-coded set of validation codes. Keeping the sets as exported constants lets the prompt-side directive map (`repair-contract.ts`) and the repairer share a single source of truth, so they cannot drift apart.

`MECHANICAL_STAGE4_CODES` is the closed set the stage-4 module repairer is allowed to touch — `unclosed_markdown`, `missing_closed_key`, `empty_section`, `duplicate_anchor`, and `model_invented_manual`. Any other error code in the input list causes the repairer to return `null` immediately, because the corresponding fix would require content invention rather than a mechanical rewrite.

`MECHANICAL_UPPER_BOUND_CODES` is the closed set the upper-bound (flow/topic) repairer classifies directly — `duplicate_anchor` and `missing_closed_key`. Topic pages also have two context-derived salvages for malformed list syntax and Related-pages drift. Unknown codes are intentionally left untouched rather than treated as immediate aborts because the final `validateStage4Artifact` re-check is the safety net: any unrelated residual error still makes the repairer return `null`.

## The topic section heading vocabulary

<!-- lw:anchors packages/core/src/artifact-repair.ts#TOPIC_SECTION_HEADING_MAP -->

`TOPIC_SECTION_HEADING_MAP` maps the five recognized topic-page H2 heading strings to their canonical slug used by the required-section machinery in `topics.ts`. The companion `FLOW_SECTION_HEADING_MAP` handles the three flow-page sections. The map is passed into `removeLaterSectionAnchorOccurrences` and `sectionAncestorAt` so the same dedup helper can resolve which required section a given marker falls under, regardless of which page type it is operating on.

## Stage-4 module repair pipeline

<!-- lw:anchors packages/core/src/artifact-repair.ts#repairStage4ArtifactMechanically -->

`repairStage4ArtifactMechanically` is the last-slot fallback for content-safe stage-4 defects observed in paid reruns. It walks the input errors once to bucket them by code, refuses anything outside `MECHANICAL_STAGE4_CODES`, then applies the corresponding fixes in a fixed order before re-validating the result. The shape of the exported function is:

```ts
export function repairStage4ArtifactMechanically(
  artifact: string,
  errors: ReadonlyArray<ArtifactValidationError>,
  closedKeyList: ReadonlyArray<string>,
  context?: Readonly<Stage4ValidationContext>,
): MechanicalArtifactRepairResult | null
```

It takes the raw artifact text, the validator's error list, the closed key list the page must cite, and an optional stage-4 validation context; it returns the rewritten artifact plus the list of repair kinds applied, or `null` if any step fails.

The pipeline runs in this order:

1. **Unclosed inline delimiter repair.** When at least one `unclosed_markdown` error is reported, the repairer repeatedly runs `escapeFirstUnmatchedInlineDelimiter` until the masked diagnostic returns `null`, capped at `MAX_INLINE_DELIMITER_REPAIRS` (100) iterations. If the first diagnostic is not an inline-code shape, the loop aborts with `null`.
2. **Missing section anchors.** For each `missing_closed_key` (section) error whose offending key is in the closed set, the repairer appends an "Additional indexed symbols" section with a single anchor marker that lists the missing keys.
3. **Empty anchored sections.** For each `empty_section` error whose offending text is a well-formed `lw:anchors` marker, the repairer re-uses the masked content to compute insertion offsets in reverse order, then splices a short explanation paragraph after each marker.
4. **Duplicate section anchors.** A single `removeLaterSectionAnchorOccurrences` pass drops the later occurrences of every key reported by `duplicate_anchor` errors.
5. **Invented manual markers.** `stripManualControlMarkers` removes any model-written manual control comments anywhere in the text.

After all of the above, the repairer returns `null` if no repairs were actually applied, and otherwise re-runs `validateStage4Artifact` against the rewritten content. If the validator still reports any error, the repairer returns `null`; the explicit fail-closed outcome is part of the contract, not a bug.

## Unclosed inline delimiter escape

<!-- lw:anchors packages/core/src/artifact-repair.ts#escapeFirstUnmatchedInlineDelimiter -->

`escapeFirstUnmatchedInlineDelimiter` finds the first raw backtick in a masked copy of the text and replaces it with the HTML entity `&#96;`, preserving the original backtick run length. The replacement is applied to the original text (not the masked copy), so the rendered output still contains a literal backtick while the source no longer opens an inline-code span. The helper returns `null` if no backtick is present, which the caller treats as "no further repair needed."

## Invented manual-marker strip

<!-- lw:anchors packages/core/src/artifact-repair.ts#stripManualControlMarkers -->

`stripManualControlMarkers` removes only model-written manual control comments — the opening `lw:manual` HTML comment and its matching `lw:manual` closer — while leaving the surrounding content untouched. The helper matches every occurrence of either form, then returns `null` if none of the matches are the opening form (so a stray closing comment with no opener is not a meaningful repair). When at least one opener is present, the comments are stripped in reverse order so the remaining byte offsets stay valid.

## Required-section ancestry lookup

<!-- lw:anchors packages/core/src/artifact-repair.ts#sectionAncestorAt -->

`sectionAncestorAt` walks every H2 heading (in the masked source) up to a given byte offset and returns the slug of the last one that appears in the supplied heading vocabulary. An H2 whose text is not in the vocabulary resets the ancestor to `null`; H3+ subsections do not reset it, matching the validator's own rule that H3+ subsections of a required section are allowed. The helper is consumed by `removeLaterSectionAnchorOccurrences` to decide which required section a given marker falls under.

## Duplicate section-marker removal

<!-- lw:anchors packages/core/src/artifact-repair.ts#removeLaterSectionAnchorOccurrences -->

`removeLaterSectionAnchorOccurrences` implements the validator's order-preserving duplicate rule: the first section-marker occurrence is canonical and every later occurrence is removed. Marker-shaped examples inside Markdown code spans remain untouched because the helper scans the masked source rather than the raw text.

When no `keySectionMap` is supplied, the behavior is the original "keep first occurrence" rule byte-for-byte; the stage-4 module path therefore sees no behavior change. When a map is supplied (Workstream A for flow pages, the topic counterpart for topic pages), the kept occurrence for a given key is the first one whose ancestor H2 section matches the key's assigned section. If no occurrence sits in the assigned section, the helper falls back to the first occurrence overall.

The helper also enforces a coverage safety net: any required section (a section whose heading appears in the heading vocabulary) must retain at least one surviving marker after dedup. If honoring the assigned-section preference would strip a required section's last marker, the helper performs a "safe move" — reassigning one duplicate key to an occurrence in that section, provided the key's original keeper marker still retains another surviving key so the move cannot strip a second required section. A chain of moves that cannot honor every required section is left fail-closed and the function returns `null`, the same outcome the caller-side re-validation would produce.

The replacement set is built by walking the markers in order, collecting the keys that survive (either because they are not duplicate targets, or because this is the kept occurrence), and emitting a replacement of the original marker text with the rebuilt marker. Replacements are applied in reverse offset order so each rewrite does not invalidate the offsets of the remaining ones.

## Upper-bound (flow/topic) repair pipeline

<!-- lw:anchors packages/core/src/artifact-repair.ts#repairUpperBoundArtifactMechanically -->

`repairUpperBoundArtifactMechanically` is the mechanical fallback for pages whose contract is an upper bound on what may be cited — flow pages and topic pages. The closed list caps what may be cited, but frontmatter anchors and section-marker keys only need to equal each other, not the full closed list. Duplicate or one-sided anchor citations have unambiguous mechanical fixes, while topic-only repairs may normalize list syntax and restore the deterministic Related-pages set from the validation context without inventing content.

```ts
export function repairUpperBoundArtifactMechanically(
  artifact: string,
  errors: ReadonlyArray<ArtifactValidationError>,
  closedKeyList: ReadonlyArray<string>,
  context: Readonly<Stage4ValidationContext>,
  keySectionMap?: ReadonlyMap<string, string>,
  headingMap: Readonly<Record<string, string>> = FLOW_SECTION_HEADING_MAP,
): MechanicalArtifactRepairResult | null
```

The function walks the error list once, ignoring codes outside `MECHANICAL_UPPER_BOUND_CODES` (they are left for the caller's LLM repair path; the final re-validation is the safety net). Recognized errors are bucketed into three lists: `duplicateSectionKeys`, `addToFrontmatter` (frontmatter keys that need to be added because they are already cited in a section marker), and `removeFromFrontmatter` (frontmatter keys that need to be removed because they are only in the frontmatter list with no section citing them).

The pipeline runs in this order:

1. **Duplicate section anchors.** When `duplicateSectionKeys` is non-empty, `removeLaterSectionAnchorOccurrences` is invoked with the supplied `keySectionMap` and `headingMap` (or `FLOW_SECTION_HEADING_MAP` by default). If the helper returns `null` or the unchanged text, the repairer returns `null`.
2. **Topic list normalization.** For topic pages, comma-joined scalar `modules`, `flows`, and `anchors` values may be rewritten as YAML block lists. Module and flow items must equal the accepted context values in order. Anchor items must be distinct closed-list keys whose set exactly equals the section-marker keys; empty, whitespace-bearing, duplicated, unknown, or ambiguous items abort the repair.
3. **Frontmatter anchor-list sync.** When either bucket of frontmatter changes is non-empty, `syncFrontmatterAnchorsList` is invoked. If the topic salvage already normalized `anchors`, the stale pre-normalization buckets are skipped because the parseable list has resolved them.
4. **Topic Related-pages sync.** The topic hub, accepted module pages, accepted flow pages, and companion flow diagrams are derived from the validation context and appended when absent. External links are preserved, but any unexpected local link aborts the repair rather than being silently removed.
5. **Re-validation.** As with the stage-4 repairer, the whole rewritten artifact is re-validated; any residual validator failure causes the function to return `null`.

The helper leaves unsupported locations and codes untouched rather than treating them as immediate triggers, so a routine mechanical pass can still run. This does not weaken the contract: a co-occurring `missing_page_opening`, renamed section, wrong accepted order, or any other unresolved defect is caught by the mandatory full re-validation.

## Frontmatter anchor-list sync

<!-- lw:anchors packages/core/src/artifact-repair.ts#syncFrontmatterAnchorsList -->

`syncFrontmatterAnchorsList` edits the top-level `anchors:` YAML list in the frontmatter block, preserving every other byte (indentation style, line endings, comments on unrelated lines). The function is exported only inside the module and is consumed by the upper-bound repairer.

The helper walks the line-and-separator split of the artifact, locating the opening `---` delimiter, the closing `---` delimiter, the `anchors:` line, and the next top-level key (or the closing delimiter) that ends the list. It then matches each body line against `^([ \t]*-[ \t]+)(\S.*?)[ \t]*$` to identify list items, drops any whose key is in the keysToRemove set, and appends the keysToAdd keys using the same indentation prefix observed on the first kept item. If the keysToRemove list is non-empty but no removal actually happened, the function returns `null` rather than guessing the frontmatter shape.

The helper bails with `null` when the artifact does not start with a `---` delimiter, when the closing delimiter is missing, when the `anchors:` key is absent, or when the list body is not the plain block-list form every stage-4/5 artifact writes. The intent is to refuse any ambiguous frontmatter rather than emit a plausibly-correct edit.

## Tests

Covered by `packages/core/src/artifact-repair.test.ts` (same-name test file on disk).
