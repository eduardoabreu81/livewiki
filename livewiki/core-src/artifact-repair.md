---
title: Mechanical Repair of Stage-4 and Topic Artifacts
owner: generated
anchors:
- packages/core/src/artifact-repair.ts#MECHANICAL_STAGE4_CODES
- packages/core/src/artifact-repair.ts#MECHANICAL_UPPER_BOUND_CODES
- packages/core/src/artifact-repair.ts#TOPIC_SECTION_HEADING_MAP
- packages/core/src/artifact-repair.ts#escapeFirstUnmatchedInlineDelimiter
- packages/core/src/artifact-repair.ts#normalizeTopicFrontmatterLists
- packages/core/src/artifact-repair.ts#removeLaterSectionAnchorOccurrences
- packages/core/src/artifact-repair.ts#repairStage4ArtifactMechanically
- packages/core/src/artifact-repair.ts#repairUpperBoundArtifactMechanically
- packages/core/src/artifact-repair.ts#sectionAncestorAt
- packages/core/src/artifact-repair.ts#stripManualControlMarkers
- packages/core/src/artifact-repair.ts#syncFrontmatterAnchorsList
- packages/core/src/artifact-repair.ts#syncTopicRelatedLinks
---

# Mechanical Repair Pipeline for Generated Markdown Artifacts

This module applies deterministic, fail-closed fixes for well-defined defects in generated Markdown artifacts without inventing content.

## When to use this page

- Understand how stage-4 artifacts (module pages) are repaired when validation reports specific, mechanical errors.
- Learn how upper-bound artifacts (flow/topic pages) are repaired under a contract where citation keys only need to match between frontmatter and sections.
- Debug why a repair returned `null` or which repair action was applied.
- Extend the repair system with new salvage strategies for topic pages.

## How it fits

This module is part of the livewiki artifact generation pipeline, operating after the LLM produces a Markdown page and before final validation. It imports validators (`validateStage4Artifact`, `Stage4ValidationContext`) from `./artifact.js`, utilities for masking code spans (`maskCodeSpansPreservingLength`, `unclosedMarkdownDiagnostic`) from `./markdown-mask.js`, and shared types from `./prompts.js` and `./flows.js`. The repair functions are designed as last-slot fallbacks for defects that the LLM repair path fails to resolve; they only handle defects with unambiguous, content-safe fixes.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-artifact-repair.mmd
```

## Stage-4 Mechanical Repair (Module Pages)

<!-- lw:anchors packages/core/src/artifact-repair.ts#MECHANICAL_STAGE4_CODES packages/core/src/artifact-repair.ts#repairStage4ArtifactMechanically -->

The stage-4 repairer handles module pages where every symbol in the closed list must be cited. `MECHANICAL_STAGE4_CODES` defines the closed set of validation codes this repairer is allowed to act on—`unclosed_markdown`, `missing_closed_key`, `empty_section`, `duplicate_anchor`, and `model_invented_manual`. It is a single source of truth shared with the repair contract so the prompt directive map and this code can never drift apart.

`export function repairStage4ArtifactMechanically(` is the main entry point. It accepts the artifact text, an array of validation errors, the closed key list, and an optional validation context; it returns a `MechanicalArtifactRepairResult` containing the repaired content and a list of applied repairs, or `null` if the repair is not possible. The function iterates over each error, and immediately returns `null` if any error code is outside the closed mechanical set, or if an error appears with an unexpected shape—this is the fail-closed gate that ensures only fully understood defects are touched.

For each accepted error, the function buckets the defect: `unclosed_markdown` sets a flag, `missing_closed_key` in a section with an offending key in the closed set is collected, `empty_section` markers matching the `lw:anchors` pattern are gathered, `duplicate_anchor` errors mentioning multiple section-marker occurrences are collected, and `model_invented_manual` errors with the specific offending whitespace are flagged. After classification, the function applies repairs in order. If unclosed inline delimiters exist, it repeatedly calls `unclosedMarkdownDiagnostic` and `escapeFirstUnmatchedInlineDelimiter`, aborting if the diagnostic is not inline-code or if the repair limit of 100 iterations is exceeded. For missing section keys, it appends an "Additional indexed symbols" section. For empty sections, it inserts placeholder prose after each marker. For duplicate anchors, it calls `removeLaterSectionAnchorOccurrences`. For invented manual markers, it calls `stripManualControlMarkers`. Finally, if no repairs were applied it returns `null`; otherwise it re-validates the transformed content with `validateStage4Artifact` and returns the result only if validation succeeds.

## Upper-Bound Mechanical Repair (Flow and Topic Pages)

<!-- lw:anchors packages/core/src/artifact-repair.ts#MECHANICAL_UPPER_BOUND_CODES packages/core/src/artifact-repair.ts#repairUpperBoundArtifactMechanically -->

The upper-bound repairer handles flow and topic pages, where the closed list defines the maximum set of keys that MAY be cited, but frontmatter and section markers only need to equal each other. `MECHANICAL_UPPER_BOUND_CODES` is the closed set of codes this repairer acts on—`duplicate_anchor` and `missing_closed_key`—and unrecognized codes are skipped rather than treated as failures, relying on the final mandatory full validation to catch unresolved issues.

`export function repairUpperBoundArtifactMechanically(` is the entry point for this path. It takes the artifact, errors, closed key list, validation context, and optionally a `keySectionMap` (mapping keys to assigned sections) and a `headingMap` (H2 heading vocabulary); it returns the same result type as the stage-4 repairer or `null`. The function skips errors with codes outside `MECHANICAL_UPPER_BOUND_CODES`, then collects duplicate section keys, keys to add to the frontmatter anchors list (`missing_closed_key` with location `frontmatter`), and keys to remove from that list (`missing_closed_key` with location `section`).

After collecting, it deduplicates duplicate keys via `removeLaterSectionAnchorOccurrences`. For topic pages, it first runs `normalizeTopicFrontmatterLists` to convert malformed scalar frontmatter list fields; if the anchors field was converted, the frontmatter sync is skipped because the conversion already resolved those keys. Unless anchors were normalized, it calls `syncFrontmatterAnchorsList`. For topic pages, it then calls `syncTopicRelatedLinks`. If no repairs were applied, it returns `null`; otherwise it re-validates the full content with `validateStage4Artifact` and returns the result only if that succeeds.

## Topic-Specific Salvage Operations

<!-- lw:anchors packages/core/src/artifact-repair.ts#normalizeTopicFrontmatterLists packages/core/src/artifact-repair.ts#syncTopicRelatedLinks packages/core/src/artifact-repair.ts#syncFrontmatterAnchorsList -->

These three functions provide deterministic repairs for defects observed in topic pages during paid evaluation runs, where the model wrote frontmatter fields incorrectly or omitted expected links. They each derive every expected value from the validation context or the artifact's own structure, never from error-message text.

`normalizeTopicFrontmatterLists` rewrites comma-joined scalar frontmatter fields (`modules: a, b, c`) into YAML block lists. It first splits the artifact on line boundaries and finds the closing `---` delimiter; if there is no frontmatter, it returns the content unchanged. For the `anchors` field, it masks code spans in the body, extracts all keys cited by section markers, and only converts when the scalar's items are distinct, closed-list members with no empty or whitespace-containing entries, and exactly match the set of section-cited keys. For `modules` and `flows`, it only converts when the items, in order, equal `context.expectedTopicModules` or `context.expectedTopicFlows` exactly. Any ambiguity returns `null`, and already-parseable flow-style lists (`[a, b]`) are left untouched.

`syncFrontmatterAnchorsList` adds or removes keys from the top-level `anchors:` YAML block list while preserving all other bytes. It only works on plain block-list form: it requires the artifact to start with a `---` delimiter, locates the `anchors:` line, and collects list items until the next top-level key. It fails closed with `null` when the shape is unexpected, when a requested removal names a key not present, or when the frontmatter delimiters are missing. Removed items are dropped entirely; added keys are appended with the detected indentation prefix.

`function syncTopicRelatedLinks(` appends missing accepted-evidence links to the `## Related pages` section. It builds the expected target list from the validation context: `index.md` labeled "Topics hub", `../<moduleId>/index.md` per accepted module, and both `../flows/<slug>.md` and `../diagrams/flow-<slug>.mmd` per accepted flow. It masks code spans, finds the Related pages section by its H2 heading, and extracts all actual local and external link targets. External links (http, https, mailto, anchors) are preserved; an unexpected local link aborts the whole repair with `null`. If all expected targets exist, it returns the content unchanged; otherwise it appends bullet links for each missing target, preserving the artifact's line-ending style.

## Anchor Deduplication and Section Ancestry

<!-- lw:anchors packages/core/src/artifact-repair.ts#removeLaterSectionAnchorOccurrences packages/core/src/artifact-repair.ts#sectionAncestorAt packages/core/src/artifact-repair.ts#TOPIC_SECTION_HEADING_MAP -->

Duplicated section markers are a common defect where a key appears in more than one `lw:anchors` marker. `removeLaterSectionAnchorOccurrences` matches the validator's order-preserving duplicate rule: the first real section-marker occurrence is canonical and later occurrences are removed, while marker-shaped examples inside Markdown code remain untouched. The function takes the text, the list of duplicate keys, and optional `keySectionMap` (keys mapped to their assigned sections) and `headingMap` (heading vocabulary); it returns the deduplicated text or `null` when dedup is impossible.

The function first masks code spans, finds all marker matches, and counts occurrences of each target key, returning `null` if any duplicate key does not appear at least twice. It then precomputes each marker's parsed key list and its ancestor section via `sectionAncestorAt`. For each duplicate key, the keeper is the first occurrence in its assigned section (when `keySectionMap` is supplied) or the first occurrence overall. When a `keySectionMap` is present, a coverage-preserving pass iterates over required sections (any section in the `headingMap` vocabulary); if a required section's markers would all be stripped, it attempts to reassign one duplicate key to an occurrence in that section, but only when the key's current keeper retains another surviving key. If no safe move is found, the function returns `null`, preserving a fail-closed stance for genuinely unfixable dedup scenarios. Finally, it reconstructs the text, dropping later occurrences of duplicate keys while keeping the first occurrence in document order.

`function sectionAncestorAt(` determines which required section contains a given character offset by scanning the masked text for H2 headings at or before that offset. It maps each heading title through the provided `headingMap`; an H2 outside the vocabulary resets the ancestor to `null`, while H3+ subsections do not reset it, matching the validator's allowance of H3+ subsections within required sections.

`export const TOPIC_SECTION_HEADING_MAP: Readonly<Record<string, string>> = {` maps a topic page's H2 heading text to its `TopicRequiredSection` identifier. It includes five sections: `purpose`, `when to use this page`, `behavioral contract`, `failure and recovery`, and `change map`. This map is used by `sectionAncestorAt` and the dedup coverage logic for topic pages; flow pages use an internal map with three sections (`purpose`, `ordered flow`, `failure and recovery`).

## Inline and Manual-Marker Cleanup

<!-- lw:anchors packages/core/src/artifact-repair.ts#escapeFirstUnmatchedInlineDelimiter packages/core/src/artifact-repair.ts#stripManualControlMarkers -->

Unclosed Markdown inline-code spans and model-invented manual control comments are two distinct content-safe defects that prevent validation. `function escapeFirstUnmatchedInlineDelimiter(text: string): string | null {` preserves the rendered literal backtick while preventing the raw delimiter from being interpreted as an open inline-code span. It masks existing code spans in the text, finds the first raw backtick in the masked result, and measures the length of the backtick run. It then replaces that run with the HTML entity `&#96;` repeated the same number of times. If no raw backtick exists, it returns `null`.

`function stripManualControlMarkers(text: string): string | null {` removes only model-written manual control comments, never their content. It matches the comment sequence whose body names the token `lw:manual` (and its closing form) with a regular expression. If the text contains no non-closing manual marker, it returns `null`. Otherwise, it removes each matching comment by slicing the text from the end backward, returning the cleaned artifact. This is necessary because stage-4 validation forbids the copyable comment sequence even inside code examples, so every occurrence must be stripped for the repaired artifact to validate.

## Tests

Covered by `packages/core/src/artifact-repair.test.ts` (same-name test file on disk).
