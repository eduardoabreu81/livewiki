---
title: Artifact Normalization and Validation for Stage 4 Generated Pages
owner: generated
anchors:
  - packages/core/src/artifact.ts#DEGRADED_NOTICE_LEGACY_PREFIX
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
  - packages/core/src/artifact.ts#isDegradedArtifact
  - packages/core/src/artifact.ts#lastHeadingBefore
  - packages/core/src/artifact.ts#markDegradedArtifact
  - packages/core/src/artifact.ts#normalizeStage4Artifact
  - packages/core/src/artifact.ts#offendingHeading
  - packages/core/src/artifact.ts#openingSnippet
  - packages/core/src/artifact.ts#proseBlockFailure
  - packages/core/src/artifact.ts#slugifyHeading
  - packages/core/src/artifact.ts#validateExactTopicList
  - packages/core/src/artifact.ts#validateStage4Artifact
---

# Artifact Normalization and Validation for Stage 4 Generated Pages

This page documents the normalization and validation layer that converts raw LLM output into a conforming wiki artifact and enforces the stage-4 contract.

## When to use this page

- Understand how raw model output is cleaned into a valid Markdown artifact (reasoning block stripping, fence unwrapping).
- Learn what structural and content rules a generated page must satisfy before it is accepted into the repository.
- Trace the validation flow for module, flow, and topic page kinds, including the recovery tier for degraded artifacts.
- Inspect how the validator enforces closed-list key completeness, anchor placement, and the `lw:anchors` marker contract.

## How it fits

`artifact.ts` lives in `packages/core/src` and is the gatekeeper between the LLM generation stages and the repository. It depends on `frontmatter.ts` for parsing and `markdown-mask.ts` for offset-preserving code masking, and it defines the `ArtifactValidationError` contract consumed by the repair loop in the batch runner.

The module exports `normalizeStage4Artifact` and `validateStage4Artifact` as its two public entry points, alongside the degraded-artifact helpers (`isDegradedArtifact`, `markDegradedArtifact`, `buildDegradedNotice`) used by the relaxed completion round. Validation is strict by principle — it never repairs a bad artifact, only reports structured errors so a repair prompt can fix the output.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-artifact.mmd
```

## Artifact normalization pipeline
<!-- lw:anchors packages/core/src/artifact.ts#normalizeStage4Artifact packages/core/src/artifact.ts#err -->

`normalizeStage4Artifact` is the terminal gate of the artifact pipeline: it takes the raw provider output and decides, in a single pass, whether that output is a valid final artifact or a failure to be reported. Its role is not to beautify the content but to strip away provider scaffolding — reasoning blocks, wrapping fences, and encoding noise — and to reject anything that does not cleanly reduce to page content. Every early return in the function is a hard failure; only the final line produces a success path.

```ts
export function normalizeStage4Artifact(raw: string): NormalizeResult {
```

The function accepts the raw string as produced by the caller and returns a `NormalizeResult` object — either `{ ok: false, content: "", errors }` for a rejected artifact or `{ ok: true, content: s, errors: [] }` for an accepted one.

The function begins by creating an `errors` array and defensively normalizing the input: it strips a UTF-8 byte-order mark and converts CRLF line endings to `\n` (the caller is expected to have done this, but the function re-checks so downstream logic can rely on the shape of `s`). It then tests whether the trimmed string is empty, and if so returns a rejection with the `err("empty_after_normalize", ...)` code — an empty output is never a valid artifact.

The first substantive step is reasoning-block stripping. The function checks for a `<think>` opening tag anywhere in the string. If one exists, it attempts to match a complete `<think>...</think>` block anchored at position zero. If that match succeeds, the block is sliced off and any trailing whitespace plus the following newline is removed. If the opening tag exists but no complete block starts the string, the function distinguishes two failure modes: if no `</think>` close tag exists anywhere in the string, the output is an unclosed reasoning block (`err("unclosed_reasoning", ...)`); if a close tag does exist but the block is not cleanly delimited at the start, the output is treated as corrupted reasoning (`err("reasoning_only", ...)`). Both return immediate failures. After stripping, the function performs a second check: it runs a regex that detects reasoning tags against the string with code spans and fences masked (so that quoted reasoning inside legitimate code is not flagged), and rejects with `err("think_block_present", ...)` if any reasoning tag survives outside those protected regions — a provider thinking leak.

Step two re-checks emptiness: if stripping the reasoning block left nothing but whitespace, the output was reasoning-only and is rejected with `err("reasoning_only", ...)` using a different message than the corrupted-block case.

Step three attempts to unwrap a single outer `markdown` or `md` fence. The function trims the string and matches it against a regex; if the match yields a captured group, the captured content becomes the new artifact (with a trailing newline appended). Critically, the unwrap is greedy about language: it only removes `markdown`/`md` fences, never `ts`, `python`, or other languages — those are not the artifact. If the trimmed string starts with a fence but does not match the expected form (wrong info string or extra content), the function deliberately leaves the string as-is and lets the validator flag it later, on the theory that it is probably a snippet rather than the artifact itself.

Step four is a final emptiness re-check after unwrapping, returning the same `err("empty_after_normalize", ...)` code if the unwrap removed everything.

If all checks pass, the function returns `{ ok: true, content: s, errors: [] }` — the normalized string is the accepted artifact.

The `err` helper exists solely to construct the error objects that populate the `errors` array and the rejection returns:

```ts
function err(
  code: ArtifactValidationCode,
  message: string,
  location: ArtifactValidationError["location"],
  offending?: string,
  sectionSlug?: string,
): ArtifactValidationError {
```

It takes a validation code and message plus a location, and optionally an offending snippet and a section slug; it returns an `ArtifactValidationError` object that includes only the optional fields that were actually provided. The function is a small constructor that keeps the many call sites in `normalizeStage4Artifact` terse and consistent — every rejection path uses it, so all error shapes in the result are uniform.

## Degraded artifact marking and detection
<!-- lw:anchors packages/core/src/artifact.ts#DEGRADED_NOTICE_PREFIX packages/core/src/artifact.ts#DEGRADED_NOTICE_LEGACY_PREFIX packages/core/src/artifact.ts#buildDegradedNotice packages/core/src/artifact.ts#dropDegradedNoticeLines packages/core/src/artifact.ts#extractDegradedTitle packages/core/src/artifact.ts#isDegradedArtifact packages/core/src/artifact.ts#markDegradedArtifact -->

The section's mechanism starts with two exported constant prefixes — `DEGRADED_NOTICE_PREFIX` (rendered as `> **Draft page** —`) and `DEGRADED_NOTICE_LEGACY_PREFIX` (rendered as `> **Degraded page** —`). These consts serve two purposes: they define the exact text that flags a blockquote as a degraded artifact notice, and they enable reliable recognition of such notices during later parsing. Keeping both the current and legacy prefixes in one place means any code that scans for these markers shares a single source of truth.

`buildDegradedNotice(title: string): string` takes a page title and returns a complete notice string. The function interpolates the title into a fixed sentence explaining that the page was written automatically, checked against code, but may have rougher wording than other pages. The returned string always uses `DEGRADED_NOTICE_PREFIX` at the start, so the notice carries the current marker for future identification.

Two private helper functions support the marking pipeline. `dropDegradedNoticeLines(text: string): string` strips all blockquote lines whose trimmed content begins with either `DEGRADED_NOTICE_PREFIX` or `DEGRADED_NOTICE_LEGACY_PREFIX`. It does this by splitting the text on newlines, filtering out any line matching one of the prefixes, and re-joining the survivors. This ensures that when a page is re-marked, old notices do not accumulate — only the newest notice survives. `extractDegradedTitle(yamlBlock: string, body: string): string` determines what title to embed in the notice. It scans the body line by line for a Markdown H1 heading (a line starting with `# `), returning the heading text if found. If no H1 exists, it falls back to the `title` field inside the YAML front matter block, and if that too is missing, it returns the literal string `"This page"` as a generic fallback.

`isDegradedArtifact(content: string): boolean` answers the question "is this artifact already degraded?" by parsing the content's front matter and inspecting the `quality` key. It normalizes carriage returns to plain newlines before parsing, then checks whether `frontmatter["quality"]` equals `"degraded"`. The function is wrapped in a try/catch so that malformed content that fails to parse is treated as non-degraded rather than throwing.

The exported entry point `markDegradedArtifact(content: string): string` performs the full degradation pass on a single artifact. Its flow is:

1. **Validate the front-matter delimiter.** The function returns the content unchanged if it does not start with `---\n` or if it cannot find the closing `\n---` marker, since without a valid front matter block there is no place to record the degraded quality.
2. **Locate the front matter boundaries.** It finds the index of the closing delimiter and splits content into the YAML block (between `---\n` and the close), the front matter portion including delimiters, and the body that follows.
3. **Set the quality flag.** If the YAML already contains a `quality:` line, the original front matter is preserved as-is. Otherwise it inserts `quality: degraded` as a new line just before the closing `---`.
4. **Clean the body.** `dropDegradedNoticeLines` removes any previously inserted notice blockquote, and leading blank lines are stripped so the body starts cleanly.
5. **Assemble the result.** The function concatenates the updated front matter, a blank line, `buildDegradedNotice(extractDegradedTitle(...))` to generate a fresh notice using a sensible title, another blank line, and the cleaned body.

Because the marking step first removes existing notices, calling `markDegradedArtifact` repeatedly on the same content is idempotent — it never appends duplicate notices or stale legacy markers. Detection via `isDegradedArtifact` reads only the `quality` front-matter key, so it works independently of the notice text, and legacy pages that only carry the older `> **Degraded page** —` blockquote without a `quality` flag are caught by the notice stripping during re-marking even though they were not recognized as degraded by the current detection logic.

## Frontmatter validation and page-kind contracts
<!-- lw:anchors packages/core/src/artifact.ts#validateStage4Artifact packages/core/src/artifact.ts#validateExactTopicList -->

`validateStage4Artifact` is the entry point for the stage-4 validation pipeline. Its job is to confirm that a generated artifact is a well-formed page that satisfies both the generic page contract and the specific contract for its page kind (module, flow, or topic). It does this by building a list of `ArtifactValidationError` objects that collectively describe everything wrong with the artifact, so callers can report them to the model for repair.

```typescript
export function validateStage4Artifact(
  artifact: string,
  closedKeyList: ReadonlyArray<string>,
  context?: Readonly<Stage4ValidationContext>,
): ValidateResult
```

This function takes the raw artifact text, a list of keys that the page is allowed to cite, and an optional context object that may carry expectations about the page kind and its required content. It returns a `ValidateResult` — an object with an `ok` boolean and the collected `errors` array. Every branch of the function either pushes onto `errors` or returns early.

The function starts by separating the artifact into its frontmatter and body. It calls `parseFrontmatter(artifact)`, which produces either a parsed `Frontmatter` object and a body string, or throws. If parsing throws, the function records an `invalid_frontmatter` error and proceeds; if no frontmatter exists at all, it records `no_frontmatter`. The body — not the raw artifact — is what every downstream check scans.

Before any structural checks, the function applies a recovery step for the relaxed contract: if `context?.relaxed === true`, it strips lines carrying the `DEGRADED_NOTICE_PREFIX` prefix from the body. This is a deliberate offset-preserving step so that every later scan sees the page as if the notice were absent; strict validation never strips, because there the notice is ordinary content.

When frontmatter parsed successfully, the function validates its fields in a sequence of increasingly specific checks. First comes the `owner` line. The requirement is literal: the frontmatter must explicitly contain `owner: generated`. If `owner` is missing entirely, the function pushes a `missing_owner` error; if the value is present but is not the exact string `"generated"`, it pushes a `wrong_owner` error. There is no implicit fallback — the old behavior treated a missing key as `"generated"`, which allowed the model to forget the line.

The rest of the frontmatter checks are gated by `pageKind`, which defaults to `"module"` when the context omits it. For product module pages, the function enforces that the `title` field does not equal the module ID — matching titles would produce ambiguous headings, so it pushes a `title_equals_module_id` error when they collide.

For flow pages, the frontmatter must declare `modules:` as a non-empty string array. The function pushes `invalid_frontmatter` when the value is not an array or is empty. When the context also supplies `expectedFlowModules`, the array must match that set exactly — any difference, whether extra or missing, produces an `invalid_frontmatter` error naming both sides.

For topic pages, the frontmatter must satisfy a long list of exact-match contracts. `validateExactTopicList` is the helper that enforces the module and flow lists:

```typescript
function validateExactTopicList(
    field: "modules" | "flows",
    actualValue: Frontmatter[string] | undefined,
    expectedValue: readonly string[] | undefined,
    errors: ArtifactValidationError[],
): void
```

It takes a field name, the frontmatter value for that field, an optional expected list of IDs, and the shared `errors` array. When the frontmatter value is not an array, it pushes an `invalid_frontmatter` error for a malformed list. When an expected list is supplied and the value is an array, it pushes a `topic_frontmatter_mismatch` error if the two sets differ — the page must cite exactly the accepted plan's modules and flows, no substitutions.

Before that, the topic branch checks the scalar fields against the context's expectations: `kind` must equal `"topic"`, `title` must match `expectedTopicTitle`, `intent` must match `expectedTopicIntent`, and `order` must match `expectedTopicOrder` (compared as a string). Each failure produces a distinct `topic_frontmatter_mismatch` error naming the expected value.

After the field checks, the function validates the frontmatter's `anchors:` list. It extracts the keys with `getAnchors(fm)` and, when the closed key list is non-empty, requires at least one anchor — an empty list triggers `no_frontmatter`. A linear scan then catches duplicates within the list (`duplicate_anchor`) and any key not present in the module's closed key set (`anchor_outside_closed_list`).

Once frontmatter is settled, the function moves to the body. It constructs an offset-stable masked view of the body via `maskCodeSpansPreservingLength`, then scans that masked text for two patterns: section-anchor markers and Markdown headings. The heading scan collects every `#`-prefixed line with its text, slug, offset, and level; the function later filters these to just H2s when it needs to know section boundaries.

The function then verifies the opening of the page — the prose before the first anchored section. For flow pages it uses `checkRequiredFlowOpening`, for topic pages `checkRequiredTopicOpening`, and for module pages `checkRequiredPageOpening` over only the pre-marker region. Any failure is reported as `missing_page_opening`.

For module pages, when the context supplies `expectedModuleDiagram`, the function additionally requires a `## Diagram` H2 whose mermaid fence holds exactly the expected placeholder line, via `checkModuleDiagramPlaceholder`. This is a strict contract even in relaxed rounds.

Next, the function iterates over each section marker. For flow and topic pages, it first checks that each marker lives under an allowed ancestor H2 — flow markers belong only in "Purpose", "Ordered flow", and "Failure and recovery"; topic markers in five specific sections. A marker anywhere else, or before the first H2, produces `anchor_in_disallowed_section`. Allowed placements are recorded in `coveredFlowSections` or `coveredTopicSections` for later use.

For every marker, the function splits its whitespace-delimited keys and checks each one: duplicate keys within the same marker, duplicate keys across different markers (tracked in `sectionKeysSeen`), and keys outside the closed list each produce their own error codes. This is the section-level counterpart to the frontmatter anchor scan.

After all markers are processed, the function enforces flow and topic coverage requirements. For flow pages, every required section must carry at least one marker — relaxed rounds drop "Failure and recovery" from the requirement. When the context supplies `flowKeyGroups`, the function also enforces semantic-group coverage: for each of the entry, boundary, and sink groups, at least one of its closed-list keys must appear both in the frontmatter anchors list and in a section marker. `fmAnchors` was captured earlier, so the `fmKeySet` is already populated at this point.

The same pattern repeats for topic pages: required sections must carry markers (relaxed rounds require only "Purpose" and "Behavioral contract"), and each of the four evidence groups — contract, state, output, failure — must have at least one dual-cited key.

Two additional topic-specific checks follow. The first enforces a product-evidence ratio: when `topicProductKeys` is supplied, at least 75% of the page's frontmatter anchors must be product keys, otherwise `topic_insufficient_product_evidence` fires. The second validates the "Related pages" section: the function extracts every markdown link target from that section and compares it against the expected set — `index.md`, plus `../<module>/index.md` for each expected module and `../flows/<slug>.md` plus `../diagrams/flow-<slug>.mmd` for each expected flow. Link targets outside that set, or missing from it, trigger `topic_related_link_mismatch`.

For non-product module pages, the function enforces a compact structure: the page must contain exactly one `## Reference` implementation section and nothing else besides the required opening and standard H2s. Any extra H2, any subheading that is not an H3 under `## Reference`, or any Reference H3 without exactly one marker immediately after it produces `auxiliary_page_not_compact`. The prose after each marker is also constrained to a single paragraph of at most 500 characters with no list items.

Completeness is enforced as two independent requirements. For module pages, `fmReference` is the full closed key list and `sectionReference` is that same list, so every key must appear on both sides. For flow and topic pages, the closed list is an upper bound, so the reference sets are the keys cited on the opposite side — a key cited only in frontmatter is still missing from sections, and vice versa. Each missing key produces a `missing_closed_key` error with a side-specific message.

Finally, the function checks two structural properties of the body. First, every section marker must be followed by real prose before the next heading, marker, or end of body — `hasRealProse` filters out whitespace, placeholder lines, and other non-content; a marker with nothing after it triggers `empty_section`. Second, the body must be fully closed Markdown: `hasUnclosedMarkdown` detects any unclosed fenced code block or inline-code span, and when it fires, the function attaches an `unclosedMarkdownDiagnostic` identifying the exact construct and line so the model can locate and fix the opening delimiter instead of guessing. Once all checks complete, the function returns the accumulated `errors`.

## Additional indexed symbols

<!-- lw:anchors packages/core/src/artifact.ts#FLOW_DIAGRAM_SOURCE_MAX_CHARS packages/core/src/artifact.ts#boundedOffendingExcerpt packages/core/src/artifact.ts#checkModuleDiagramPlaceholder packages/core/src/artifact.ts#checkRequiredFlowOpening packages/core/src/artifact.ts#checkRequiredPageOpening packages/core/src/artifact.ts#checkRequiredTopicOpening packages/core/src/artifact.ts#countFlowDiagramElements packages/core/src/artifact.ts#countFlowchartElements packages/core/src/artifact.ts#countLines packages/core/src/artifact.ts#countSequenceElements packages/core/src/artifact.ts#countStateElements packages/core/src/artifact.ts#extractInlineFlowDiagram packages/core/src/artifact.ts#extractInlineModuleDiagram packages/core/src/artifact.ts#findExactOpeningH2 packages/core/src/artifact.ts#findFirstTodoPlaceholder packages/core/src/artifact.ts#findNextH2 packages/core/src/artifact.ts#findNextImplementationHeading packages/core/src/artifact.ts#findOpeningHeadingCandidate packages/core/src/artifact.ts#findOriginalLineEnd packages/core/src/artifact.ts#findOriginalLineStart packages/core/src/artifact.ts#firstPresentIndex packages/core/src/artifact.ts#flowDiagramPlaceholder packages/core/src/artifact.ts#flowSectionEnd packages/core/src/artifact.ts#flowSectionProseFailure packages/core/src/artifact.ts#hasRealProse packages/core/src/artifact.ts#lastHeadingBefore packages/core/src/artifact.ts#offendingHeading packages/core/src/artifact.ts#openingSnippet packages/core/src/artifact.ts#proseBlockFailure packages/core/src/artifact.ts#slugifyHeading -->

These anchors identify indexed symbols in this module that were not assigned to an earlier generated section.

## Tests

Covered by `packages/core/src/artifact.test.ts` (same-name test file on disk).
