---
title: Stage-4 artifact normalization and validation
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

# Stage-4 artifact normalization and validation

This page is responsible for the normalization and validation layer that turns raw LLM output into a stage-4 Markdown artifact conforming to livewiki's closed-key contract.

## When to use this page

- **Normalize** raw model output before validation by stripping an opening `<think>…` block, unwrapping one outer `markdown`/`md` fence, and rejecting empty or reasoning-only responses via `normalizeStage4Artifact`.
- **Validate** a normalized artifact against the module's closed key list using `validateStage4Artifact`, supplying a `Stage4ValidationContext` to enable flow, topic, product, or auxiliary-page rules.
- **Diagnose** unclosed Markdown constructs and `TODO`/`TBD` placeholders by reading the structured `ArtifactValidationError` codes (`unclosed_markdown`, `todo_marker_present`) and their offset-stable offending excerpts.
- **Mark** an artifact as relaxed-tier using `markDegradedArtifact` and `buildDegradedNotice` so the validator tolerates a degraded-page banner on the final completion attempt.

## How it fits

This file sits in `packages/core/src/` as the gatekeeper between the model's raw completion and the orchestrator that writes pages into the repository. The pipeline calls `normalizeStage4Artifact` first to scrub reasoning blocks and outer code fences, then `validateStage4Artifact` to enforce the closed-key contract that links every page to its module's authoritative key list. Validation depends on `frontmatter.ts` for parsing and anchor extraction, on `markdown-mask.ts` for offset-stable code-span masking used by the unclosed-Markdown and placeholder checks, and on `prompts.ts`, `topics.ts`, and `modules.ts` for the typed error codes and module-role facts that drive presentation rules. When validation rejects an artifact, the structured errors flow back to a repair prompt rather than being silently fixed — the repository on disk remains the source of truth and the contract is never loosened to accommodate a bad model output.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-artifact.mmd
```

## Normalization: turning raw model output into a Markdown artifact
<!-- lw:anchors packages/core/src/artifact.ts#normalizeStage4Artifact -->

Normalization exists because model output is not safe to feed straight into downstream validators or renderers: it is routinely wrapped in private reasoning blocks, sometimes fenced as `markdown` (or `md`), and occasionally arrives byte-dirty with a stray BOM or Windows line endings. `normalizeStage4Artifact` is the single funnel that turns that messy string into a clean Markdown body, while reporting back exactly why it gave up when the output cannot be salvaged.

```ts
export function normalizeStage4Artifact(raw: string): NormalizeResult
```

`normalizeStage4Artifact` accepts a raw string of model output and returns a `NormalizeResult` — on success, a normalized `content` string with no errors; on failure, an empty `content` string paired with one or more typed errors describing what went wrong.

The flow has four stages, each guarded so that the function either progresses to the next stage or returns early with a structured error. **Stage 0 — defensive cleanup:** before any real logic, the function strips a leading UTF-8 BOM (the invisible `\uFEFF` byte some models emit) and rewrites `\r\n` to `\n`. This duplicates work the caller already does, but the duplication is intentional: callers may forget, and normalization must remain correct in isolation. **Stage 1 — strip a single leading `<think>…` block:** models frequently prefix their answer with private reasoning. The function looks for `<think>` at the very start of the string using `THINK_OPEN_RE`. If a complete block (`THINK_BLOCK_RE`) is found anchored to position 0, the entire block plus the whitespace line that follows it is removed. If `<think>` opens but no matching close exists anywhere in the string, the function returns an `unclosed_reasoning` error — the model clearly never finished thinking. If a close exists but is not the close of a clean leading block, the output is treated as corrupt and a `reasoning_only` error is returned rather than producing a half-stripped artifact. **Stage 2 — detect "reasoning only":** after stripping, if nothing is left, the model emitted reasoning but never produced a real answer. The function returns a `reasoning_only` error rather than handing an empty string to the validator. **Stage 3 — unwrap at most one outer `markdown` or `md` fence:** models sometimes wrap their entire answer in a fenced code block with language `markdown` or `md`. The function only unwraps that fence, and only when the whole trimmed content is exactly that one fence — captured by `OUTER_FENCE_RE`. Inner fences for `ts`, `tsv`, `python`, and so on are deliberately left alone; they are part of the artifact, not its packaging. If the content starts with some fence but it is not the expected `markdown`/`md` form (detected by `ANY_FENCE_RE`), the function leaves the string untouched and lets the later validator complain. A special case skips unwrapping when the content begins with `---`, which would otherwise be misread as a fence opener. **Stage 4 — final emptiness check and return:** after unwrapping, the function re-checks whether anything is left; an empty result produces an `empty_after_normalize` error, otherwise it returns `{ ok: true, content: s, errors: [] }`, handing the caller a clean, reasoning-free, fence-unwrapped Markdown body ready for validation and rendering. Across every stage, errors are emitted via the shared `err` helper that produces an `ArtifactValidationError` carrying a stable code, a human message, and a `global` location, so callers can pattern-match on the code without parsing prose.

## Degraded-page marking and the relaxed-tier notice
<!-- lw:anchors packages/core/src/artifact.ts#DEGRADED_NOTICE_PREFIX packages/core/src/artifact.ts#DEGRADED_NOTICE_LEGACY_PREFIX packages/core/src/artifact.ts#buildDegradedNotice packages/core/src/artifact.ts#dropDegradedNoticeLines packages/core/src/artifact.ts#extractDegradedTitle packages/core/src/artifact.ts#markDegradedArtifact -->

The file keeps two constants that name the banner it stamps onto low-confidence pages and the historical wording it has to keep stripping out of older artifacts. `DEGRADED_NOTICE_PREFIX` is the canonical header for a relaxed-tier page, the literal `> **Draft page** —` that introduces a single-line warning above the rendered body; `DEGRADED_NOTICE_LEGACY_PREFIX` is its predecessor, `> **Degraded page** —`, retained so existing artifacts written before the rename still get cleaned up.

```ts
export function buildDegradedNotice(title: string): string
```

`buildDegradedNotice` composes the actual sentence that follows the prefix: it interpolates the supplied page title into the template, producing a one-line note that tells the reader the page was auto-generated, checked against the code, and may be rougher than usual.

`dropDegradedNoticeLines` is the inverse operation used when re-marking a page that already carries an old banner.

```ts
function dropDegradedNoticeLines(text: string): string
```

It splits the text on newlines and drops any trimmed line whose start matches either the current or the legacy prefix, then rejoins the survivors — so the new notice can be inserted without stacking duplicate warnings on top of the existing one.

`extractDegradedTitle` decides what title to hand to the notice builder.

```ts
function extractDegradedTitle(yamlBlock: string, body: string): string
```

It first scans the body line-by-line for the first H1 (`# …`) and returns that heading; only if none exists does it fall back to a `title:` field inside the YAML frontmatter; if neither is present it returns the literal string `"This page"`, so the notice is never built with an empty slot.

`markDegradedArtifact` is the orchestrator a caller invokes once it has decided a page belongs on the relaxed tier.

```ts
export function markDegradedArtifact(content: string): string
```

It first guards on the artifact actually having YAML frontmatter — content that does not start with `---\n` is returned untouched — and then locates the closing `\n---`, slicing the frontmatter off as `yamlBlock` and the remainder as the would-be body. It tags the frontmatter with `quality: degraded` only if that key is not already present, so a re-mark keeps the original frontmatter otherwise intact. It then runs `dropDegradedNoticeLines` on the body to strip any prior warning line, trims leading blank lines, and reassembles the artifact as `frontmatter`, a blank line, the freshly built `buildDegradedNotice(extractDegradedTitle(yamlBlock, body))` banner, another blank line, and the cleaned body — producing a single-page artifact whose metadata says `quality: degraded`, whose top line carries the current banner, and whose body is free of any legacy or duplicate notice lines.

## Validation pipeline: orchestrating frontmatter, openings, anchors, and body integrity
<!-- lw:anchors packages/core/src/artifact.ts#validateStage4Artifact packages/core/src/artifact.ts#err packages/core/src/artifact.ts#slugifyHeading packages/core/src/artifact.ts#lastHeadingBefore packages/core/src/artifact.ts#firstPresentIndex packages/core/src/artifact.ts#findNextH2 packages/core/src/artifact.ts#findNextImplementationHeading packages/core/src/artifact.ts#findExactOpeningH2 packages/core/src/artifact.ts#findOpeningHeadingCandidate packages/core/src/artifact.ts#offendingHeading packages/core/src/artifact.ts#openingSnippet packages/core/src/artifact.ts#proseBlockFailure packages/core/src/artifact.ts#flowSectionEnd packages/core/src/artifact.ts#flowSectionProseFailure packages/core/src/artifact.ts#hasRealProse -->

```ts
export function validateStage4Artifact(
  artifact: string,
  closedKeyList: ReadonlyArray<string>,
  context?: Readonly<Stage4ValidationContext>,
): ValidateResult
```

`validateStage4Artifact` takes an artifact string, a closed list of keys, and optional page- and validation-specific context, and returns a `ValidateResult` containing the collected errors. The pipeline first rejects an empty normalized artifact, then parses frontmatter and removes degraded-notice lines only when relaxed validation is enabled. In relaxed mode, every downstream body scan therefore operates on a normalized body, while strict validation treats the notice as ordinary content. A separate parse error is preserved so malformed frontmatter can be distinguished from absent frontmatter.

Frontmatter errors are assembled through the common error constructor:

```ts
function err(
```

`err` takes the validation error code, human-readable message, location, and optional offending value or section slug, and returns a structured `ArtifactValidationError` that later drives the final result. If frontmatter exists, `validateStage4Artifact` requires an explicit `owner: generated` entry, distinct from the older implicit-owner behavior. Product-module pages also reject a title identical to the stable module ID. Flow pages must declare a non-empty `modules` list, and when expected modules are supplied, the actual set must match that candidate set exactly. Topic pages must declare `kind: topic`; when accepted metadata is available, the title, intent, and string form of order must match it, while the module and flow evidence lists are checked for exact agreement with the plan.

After frontmatter, `getAnchors(fm)` produces the frontmatter key list independently of section markers. If a nonempty closed list exists but this list is empty, the validator reports missing frontmatter anchors. It then scans the list in order, reporting keys repeated within frontmatter and keys outside the supplied closed set. Because this frontmatter coverage check is deliberately performed only when parsing succeeded, a missing or malformed frontmatter document receives the more specific `no_frontmatter` or `invalid_frontmatter` diagnostic rather than a flood of additional missing-key errors.

Section scans are offset-based and deliberately independent of frontmatter coverage. `maskCodeSpansPreservingLength(body)` protects Markdown code from the section-marker and heading searches, and `slugifyHeading` converts heading text to stable section identifiers:

```ts
function slugifyHeading(text: string): string
```

`slugifyHeading` takes heading text and returns its normalized slug. The heading matches collected from the masked body supply the offsets and slugs used to associate each anchor marker with its enclosing or preceding heading.

`lastHeadingBefore` takes the collected heading matches and a body offset, and returns the nearest preceding heading. It is used to determine the section slug attached to a marker, identify the ancestor H2 for flow and topic markers, and locate the headings that bound prose after a marker.

```ts
function lastHeadingBefore(
```

`firstPresentIndex` takes a variable number of candidate offsets and returns the first one that is actually present. This lets the opening logic compare candidate boundaries without assuming that every structural element exists.

```ts
function firstPresentIndex(...indices: number[]): number
```

The opening check is page-kind-specific. For ordinary pages, `validateStage4Artifact` finds the first section marker, obtains `lastHeadingBefore` for its preceding heading, and defines the opening region as either the end of that heading or the marker offset when no heading precedes it. `checkRequiredPageOpening` then checks the required opening blocks and cardinalities before the first anchored section. Flow and topic pages bypass that generic opening scan and use their own whole-body opening contracts. If an opening fails, `err` records the failure as a `missing_page_opening` error with the offending opening text or location.

`findNextH2` takes an array of body lines and a starting position, and returns the next H2 heading boundary. The visible code uses it to isolate the body of the topic's `Related pages` H2 by searching forward from the heading to the following H2.

```ts
function findNextH2(lines: ReadonlyArray<string>, start: number): number
```

`findNextImplementationHeading` takes body lines and a starting position, and returns the next heading considered to be an implementation heading. This gives the prose checks a forward boundary for an implementation section rather than treating arbitrary text as the end of the flow.

```ts
function findNextImplementationHeading(lines: ReadonlyArray<string>, start: number): number
```

`findExactOpeningH2` takes the body and searches for a precise opening H2 match. It is part of the heading-resolution mechanism that distinguishes a required opening section from merely similar headings.

```ts
function findExactOpeningH2(
```

`findOpeningHeadingCandidate` takes the body and searches for a candidate opening heading when the exact form is not found. Together, the exact and candidate searches support structural opening validation while allowing the validator to report the most useful offending heading.

```ts
function findOpeningHeadingCandidate(
```

`offendingHeading` takes the relevant heading information and returns the heading text or excerpt used as the offending value in a validation error.

```ts
function offendingHeading(
```

`openingSnippet` extracts a compact view of the opening material:

```ts
function openingSnippet(lines: ReadonlyArray<string>): string
```

For each section marker, the validator first identifies the preceding heading with `lastHeadingBefore` and records the corresponding slug. Flow markers are additionally associated with the nearest preceding H2 rather than merely the nearest H3–H6 descendant. A flow marker is accepted only when that ancestor section is one of `Purpose`, `Ordered flow`, or `Failure and recovery`; topic markers are limited to their corresponding allowed sections. Markers before the first H2 or in a disallowed section produce `anchor_in_disallowed_section` errors. The required-section coverage sets are then compared with the expected flow or topic section lists, with relaxed mode removing only the flow or topic sections that the relaxed contract makes optional. Section names are normalized to lowercase for comparison, while the original heading text and `slugifyHeading` result remain available for diagnostics.

The marker's whitespace-separated keys are checked independently in three directions: duplicates within one marker, repeated use of a key in another marker, and membership in the closed set. `duplicate_anchor` distinguishes both kinds of repetition, while `anchor_outside_closed_list` rejects unknown keys. The validator then checks semantic tier coverage for flows and topics. For each configured group, it ignores keys outside the closed set, requires at least one valid key, and requires that the selected key appear in both the frontmatter anchors and a section marker. This dual-citation rule prevents a key from being declared in only one location.

The required H2 structure is also used to validate page-specific layout. Topic pages are checked for a `Related pages` section, whose links are compared against the expected local targets; auxiliary module pages must keep a compact opening and use only `## Reference` as their implementation section. In that compact layout, H3 entries must sit directly under `## Reference`, contain exactly one anchor marker immediately after the heading, and have one short, non-list prose paragraph. Markers not satisfying that H3/one-key arrangement receive `auxiliary_page_not_compact`.

Completeness is intentionally two independent checks. For module pages, each closed-list key must appear in both frontmatter and at least one section marker. For flow and topic pages, the closed list is an upper bound, so every frontmatter key and every section key must still appear on the other side: frontmatter-only and section-only declarations are reported as `missing_closed_key`. This arrangement prevents a page from passing merely by listing every key in frontmatter or by placing empty markers throughout the body.

`proseBlockFailure` takes a prose block and determines whether it contains a failure that should make a section noncompliant.

```ts
function proseBlockFailure(
```

`flowSectionEnd` determines where a flow section stops:

```ts
function flowSectionEnd(lines: ReadonlyArray<string>, headingIndex: number): number
```

It takes the body lines and the index of a flow heading, and returns the boundary at which that flow section ends. `flowSectionProseFailure` applies the prose-block checks to that flow interval:

```ts
function flowSectionProseFailure(
```

It takes the flow section's relevant boundary information and returns a failure when the section does not contain the required real prose.

`hasRealProse` takes a text string and returns whether it contains substantive prose rather than whitespace, a marker-only fragment, or a placeholder such as `TODO` or `TBD`.

```ts
function hasRealProse(text: string): boolean
```

For every section marker, the validator collects marker offsets, heading offsets, and the body length into a sorted set of breakpoints. Starting immediately after the marker, it examines the text up to the next breakpoint and calls `hasRealProse`. If no real prose exists before the next heading, another marker, or the end of the page, it reports `empty_section` and includes the preceding heading slug. This ensures that an anchor is treated as documentation only when prose actually follows it.

Finally, the body is checked for unclosed Markdown constructs. `hasUnclosedMarkdown(body)` provides the boolean structural result, while `unclosedMarkdownDiagnostic(body)` supplies the precise construct type, the line number of its opening delimiter, and a capped excerpt. A fence must be closed by a run of the same fence character at least as long as the opening run; an inline-code span must be closed by exactly the same number of backticks. The resulting diagnostic names the exact delimiter rule and location, making truncation or malformed Markdown actionable rather than merely reporting that the page is unclosed.

## Page-kind opening contracts: module, flow, and topic
<!-- lw:anchors packages/core/src/artifact.ts#checkRequiredPageOpening packages/core/src/artifact.ts#checkRequiredFlowOpening packages/core/src/artifact.ts#checkRequiredTopicOpening packages/core/src/artifact.ts#checkModuleDiagramPlaceholder packages/core/src/artifact.ts#validateExactTopicList -->

Before any contract sections are checked, the page text has to be normalized so headings line up with indexes the helpers expect. Each entry point (`checkRequiredPageOpening`, `checkRequiredFlowOpening`, `checkRequiredTopicOpening`) starts by splitting the input into lines and trimming leading and trailing blank lines from both ends. The functions then locate the H1 by scanning for the first line that matches `/^#\s+\S/`, and they reject any page where that H1 is missing or appears after other content. Once the H1 is fixed at index 0, the rest of the opening is measured as offsets from `1`, which is the same anchor every section-bound helper (`findExactOpeningH2`, `findNextH2`, `findOpeningHeadingCandidate`) takes as its starting position.

The module-page contract is enforced by `checkRequiredPageOpening`. After locking the H1, it locates the `When to use this page` H2 and, if that heading is present, treats the lines between H1 and that heading as the responsibility block — `proseBlockFailure` is asked to require exactly one prose paragraph there. It then slices from after `When to use this page` up to the `How it fits` heading (or the next H2 if `How it fits` is missing) and inspects the task list: in strict mode it requires 2–4 non-empty Markdown bullets each matching `/^[-*+]\s+\S/`, while in `relaxed` mode it only requires that at least one task line of any kind exists. Finally it bounds the `How it fits` block at the next implementation heading via `findNextImplementationHeading` and asks `proseBlockFailure` for one-or-more prose paragraphs (relaxed mode also permits bullets), rejecting any block that contains a sub-heading or an `lw:` marker.

```ts
function checkRequiredPageOpening(text: string, relaxed = false): PageOpeningFailure | null
```

The flow-page contract layers the same structure on top of a different section set, and is enforced by `checkRequiredFlowOpening`. It splits both the masked and raw views in lockstep so it can later recover the raw contents of the `Diagram` block. After the H1 check, it requires exactly one prose responsibility paragraph between H1 and the `Purpose` H2, and then enforces a structural invariant unique to flow pages: the opening anchor section marker must appear after `Purpose`, never at or before it. The `Purpose` body itself is validated through `flowSectionProseFailure`. Next comes `Ordered flow`, which must contain at least one numbered list item matching `/^\d+[.)]\s+\S/`. The `Diagram` H2 must wrap a fenced ` ```mermaid ` block whose first non-blank line carries a `%% livewiki/diagrams/flow-<slug>.mmd` placeholder, and that placeholder must equal `expectedFlowDiagram` when one is supplied. From there, the cursor walks to `Invariants`, `Failure and recovery`, and `Related pages`; the first two are required only when `relaxed` is false, but their prose is checked whenever they appear, and `Related pages` is always required to contain at least one Markdown link matching `/\[[^\]]+\]\([^)]*\)/`.

```ts
function checkRequiredFlowOpening(
```

Topic pages use a more rigid section list and are checked by `checkRequiredTopicOpening`. After confirming the H1 and (when supplied) that its title equals `expectedTitle`, it validates the single reader-problem sentence that sits between H1 and the `Purpose` H2 using `proseBlockFailure`, passing `!relaxed` for the strict-prose flag so relaxed mode can accept bullets. It then walks a fixed ordered list of required H2 titles, advancing a cursor past each match. In strict mode the required set is `Purpose`, `When to use this page`, `Behavioral contract`, `Failure and recovery`, `Change map`, `Related pages`; in relaxed mode the set reduces to `Purpose`, `Behavioral contract`, `Related pages`. For each found section, the body is passed through `flowSectionProseFailure` with a per-title relaxation flag — `When to use this page`, `Change map`, and `Related pages` always accept bullets or links even in strict mode — so a section that is present must still carry grounded prose, bullets, or links.

```ts
function checkRequiredTopicOpening(masked: string, expectedTitle?: string, relaxed = false): PageOpeningFailure | null
```

Module pages additionally carry a diagram-placeholder obligation that lives outside the heading-walk logic. `checkModuleDiagramPlaceholder` scans the masked lines for a case-insensitive `## Diagram` heading, locates the next heading that ends the section, and re-reads the same slice from the raw text so the mermaid fence is preserved verbatim. It runs the regex `` ```mermaid[ \t]*\n([\s\S]*?)\n[ \t]*``` `` against that raw slice, fishes out the first line inside the fence that matches `/^%%\s*livewiki\/diagrams\/\S+\.mmd$/`, strips the leading `%%`, and compares the remainder to `expectedModuleDiagram`. Any of the three checks — missing `Diagram` heading, missing fenced mermaid block with the right placeholder comment, or a placeholder whose slug does not match — yields a `PageOpeningFailure` with a precise `offending` value.

```ts
function checkModuleDiagramPlaceholder(
```

Frontmatter-level contracts for topic pages sit in `validateExactTopicList`. It guards against `actualValue` being anything other than an array (emitting a `topic_frontmatter_mismatch` error that reports the offending string when one was supplied), returns immediately when `expectedValue` is `undefined`, and otherwise demands element-by-element equality between `actualValue` and `expectedValue`. A mismatch is recorded with both the actual and the accepted plan joined as comma-separated strings so callers can see exactly which entry diverged. Together, these five functions form the gate that every page must pass before its body sections are even inspected: the frontmatter list must match the accepted plan, the H1 must lead, and the kind-specific opening sections must appear in order with the prose, lists, and diagram placeholders the contract prescribes.

```ts
function validateExactTopicList(
```

## Body integrity: TODO bans, unclosed Markdown, and original-text diagnostics
<!-- lw:anchors packages/core/src/artifact.ts#findFirstTodoPlaceholder packages/core/src/artifact.ts#findOriginalLineStart packages/core/src/artifact.ts#findOriginalLineEnd packages/core/src/artifact.ts#countLines packages/core/src/artifact.ts#boundedOffendingExcerpt -->

The body-integrity stage of the artifact pipeline is responsible for spotting the model's own unfinished-work placeholders before they reach the user, and for producing tightly scoped diagnostic excerpts when something does slip through. It does this in two phases: a scanner that classifies candidate placeholder mentions, and a small family of line-aware helpers that locate the offending text in the original source so the error message can quote it back faithfully.

```ts
function findFirstTodoPlaceholder(text: string): TodoPlaceholderMatch | null
```

`findFirstTodoPlaceholder` takes the full artifact body and returns either the first banned placeholder it can defend, with its absolute byte offset and the matched token, or `null` when the text is clean. It walks every placeholder occurrence with a global case-insensitive regex, but the mere presence of those letters is not enough to flag — the rationale evidence pipeline deliberately feeds placeholder-tagged source comments to the prompt, so a blanket word ban would punish the model for echoing content it was given. Instead, each match is classified in a strict order that keeps pending-work directives blocked while allowing the validator's own terminology to be documented.

First, the function asks `findOriginalLineStart` and `findOriginalLineEnd` to pin down the line that hosts the candidate. Both helpers take the body plus an absolute byte offset and return, respectively, the index of the first byte on that line and the index of the trailing newline (or the end of the text). They clamp out-of-range or negative offsets defensively and then walk backwards or forwards one character at a time until they hit a `\n` boundary. With the line in hand, `findFirstTodoPlaceholder` slices it out and computes how far into the line the candidate sits — the offset-into-line is what lets the next gates reason about context without re-scanning the whole document.

```ts
function findOriginalLineStart(text: string, offset: number): number
function findOriginalLineEnd(text: string, offset: number): number
```

Directive forms are checked first. A colon immediately after the token — including after an optional closing quote — is always rejected, and the same rule applies to a colon after a slash-joined token pair. This ordering prevents quoted or paired syntax from disguising an instruction to complete documentation later.

Mention exemptions are deliberately narrow. A quoted token or slash-joined pair is ignored only when the same line contains explicit metalinguistic context such as placeholder, token, marker, rule, ban, forbidden, literal, or prose. This lets a page explain the validation rule itself, while ordinary claims that use a quoted unresolved status or describe a migration with the slash-paired tokens remain invalid. Outside that exemption, the blanket ban on the second token remains in force because rationale evidence never supplies it.

The final check handles standalone occurrences of the remaining token. The trimmed line is matched against a form that accepts a marker alone or preceded only by bullet glyphs (`-`, `*`, `+`, `>`), whitespace, and an optional numeric prefix like `1.` or `1)`, optionally followed by whitespace and a trailing dot. If the loop completes without a directive, a non-metalinguistic unresolved token, or a standalone marker, the function returns `null`, meaning the text passes the placeholder check.

The diagnostic end of this stage is intentionally minimal and lives in two further helpers. `countLines` tallies newline characters strictly before a given offset, which downstream code uses to translate an absolute byte index into a 1-based line number for error messages.

```ts
function countLines(text: string, offset: number): number
```

It is a direct loop that increments a counter every time it sees a `\n`, clamped to `text.length` so an out-of-range offset cannot read past the buffer.

The final helper produces the snippet shown to the user.

```ts
function boundedOffendingExcerpt(
```

`boundedOffendingExcerpt` takes the offending line, the start and end offsets of the banned token within that line, and a maximum character budget. When the line already fits the budget it is returned verbatim; otherwise the function reserves room for up to two ellipsis markers, splits the remaining budget in half, and centers a window on the match by subtracting that half from `matchStart`. It then clamps the window so it never starts before `0` or ends past `line.length`, sliding the opposite edge inward when one side had to be pulled in. The chosen slice is taken from the line, and leading or trailing ellipses are prepended or appended only when the window is actually off the edge of the line. A final defensive guard truncates the result if the combination of clamping and the marker widths happens to push the string over the budget — the offending token is always kept in the center of the window, so the worst case is a couple of trailing characters being lopped off, never the offending token itself.

## Flow and module diagram extraction
<!-- lw:anchors packages/core/src/artifact.ts#FLOW_DIAGRAM_SOURCE_MAX_CHARS packages/core/src/artifact.ts#flowDiagramPlaceholder packages/core/src/artifact.ts#extractInlineFlowDiagram packages/core/src/artifact.ts#extractInlineModuleDiagram packages/core/src/artifact.ts#countFlowDiagramElements packages/core/src/artifact.ts#countFlowchartElements packages/core/src/artifact.ts#countSequenceElements packages/core/src/artifact.ts#countStateElements -->

The flow and module diagram pipeline turns a Mermaid source block embedded in a page into a separate, addressable artifact whose content can be inspected, size-checked, and metricized without the renderer ever needing to reparse the surrounding prose.

The pipeline is bounded by a single safety constant:

```ts
export const FLOW_DIAGRAM_SOURCE_MAX_CHARS = 8000;
```

`FLOW_DIAGRAM_SOURCE_MAX_CHARS` is the cap that downstream callers apply to the extracted source before they commit to rendering it; everything above this budget is flagged as oversized and routed away from the heavy path.

When a diagram block needs to be swapped out of a page (for example, to defer it to a sidecar or to replace it with a link), the substitution marker is produced by `flowDiagramPlaceholder`:

```ts
export function flowDiagramPlaceholder(slug: string): string
```

`flowDiagramPlaceholder` takes a page slug and returns a single-line Mermaid comment that encodes the expected sidecar path under `livewiki/diagrams/`, so the original fence can be rewritten to a stable pointer that another tool can resolve later.

The extraction itself runs through `extractInlineFlowDiagram`:

```ts
export function extractInlineFlowDiagram(
```

`extractInlineFlowDiagram` takes the raw page text, the page slug, and an optional placeholder override, and returns an `InlineFlowDiagramExtraction | null` — either the diagram source together with the rewritten page text, or `null` when no extractable diagram exists. It starts by splitting `content` into `rawLines` and a parallel `maskedLines` array produced by `maskCodeSpansPreservingLength`, so that a `## Diagram` heading inside an inline-code span is not mistaken for the section header. It then scans `maskedLines` for the first H2 whose trimmed text equals `"diagram"` (case-insensitive), records its line index as `diagramIndex`, and walks forward until it sees any further ATX heading (`#{1,6}` followed by non-space) to establish `sectionEnd`. If no `## Diagram` section exists at all, the function returns `null` immediately.

Within those bounds it runs a CommonMark-style fenced-code state machine. Outside any fence it tests each `rawLines[i]` for a fence opener of three or more backticks or tildes; when it finds one, it records the fence character, the run length, and — only when the opener was backticks and the info string was exactly ```` ```mermaid ```` — it records the line as `fenceOpen`. While the fence is open it tests for a matching close whose run length is at least the opener's length; on a match, if a mermaid opener was previously recorded it captures `mermaidBody = rawLines.slice(fenceOpen + 1, i)`, then resets the state. The loop breaks the first time a real mermaid body is captured, so nested examples opened with a different fence character are automatically skipped.

After the scan, three early-exit conditions trim out non-substantive blocks: if no mermaid body was captured; if the joined body trims to the empty string; or if every non-empty body line matches `^%%\s*livewiki\/` (that is, the body is only placeholder comments). In each case the function returns `null` and leaves the page untouched. Otherwise it rewrites the page by splicing the `placeholder` string in at the opening fence line and rejoining `rawLines`, and it returns `{ pageContent, diagramSource, sourceTooLarge }`, where `sourceTooLarge` is `diagramSource.length > FLOW_DIAGRAM_SOURCE_MAX_CHARS`.

The module-diagram variant is a thin redirection:

```ts
export function extractInlineModuleDiagram(
```

`extractInlineModuleDiagram` takes the page text and slug and returns the same `InlineFlowDiagramExtraction | null` shape, but it reuses `extractInlineFlowDiagram` with a placeholder supplied by `moduleDiagramPlaceholder(slug)` instead of the default flow placeholder. Everything else — heading detection, fence walk, early exits, size check — is identical.

Once the source has been extracted, `countFlowDiagramElements` produces the cheap metrics used by callers that want to gauge complexity before rendering. It splits on newlines, trims, drops blank lines and `%%` comment lines, and inspects the first remaining line as the header. Depending on whether the header begins with `flowchart`/`graph`, `sequencediagram`, or `statediagram` (with optional `-v2`), it dispatches the body (every line after the header) to the matching specialised counter; any other header falls back to a coarse estimate of `nodes = lines.length` and `edges = lines.length`.

```ts
export function countFlowDiagramElements(source: string): FlowDiagramElementCount
```

`countFlowchartElements` takes the post-header lines of a flowchart and returns a `FlowDiagramElementCount`. It collects unique node identifiers in a `Set<string>` and tallies edges as it walks each line. Trailing semicolons are stripped, then any line matching the flowchart-skip regex is ignored. The line is scanned for edge operators; if none match, the whole line is treated as a single node declaration and fed through `addEndpoint`. Otherwise the number of operators is added to `edges`, and the line is split on those operators so each `&`-chained endpoint (`A & B --> C`) is registered separately. `addEndpoint` trims each piece and uses a leading-identifier regex to extract the source label, ignoring any label or shape suffix that follows.

```ts
function countFlowchartElements(body: string[]): FlowDiagramElementCount
```

`countSequenceElements` takes the post-header lines of a sequence diagram and returns a `FlowDiagramElementCount`. It first recognises `participant` and `actor` declarations and records the first non-space token as a node. Otherwise it skips lines matching the sequence-skip regex, and for lines matching the sequence-arrow regex it increments `edges`, splits the line at the arrow, strips any trailing `+`/`-` activation marker from both ends, and trims everything before the first `:` on the right side to obtain the source and target participant names. Both names are added to the node set, so every message contributes exactly one edge and registers its two endpoints.

```ts
function countSequenceElements(body: string[]): FlowDiagramElementCount
```

`countStateElements` takes the post-header lines of a state diagram and returns a `FlowDiagramElementCount`. Trailing semicolons are stripped, and lines beginning with `note`, `end`, or `direction` (case-insensitive) are ignored. Lines beginning with `state ` are parsed either as `state "Description" as X` (capturing `X` via the `as` alias), or as a plain `state X` declaration (capturing the first identifier), with composite forms like `state X {` left open. For any remaining line, the code splits on `-->`; if there is at least one transition, the number of transitions minus one is added to `edges`, and the left side of each transition (the part before any label) is registered as a state via `addState`. Lines that contain no `-->` and no recognised keyword are treated as `X : description` annotations, so only the identifier before the first colon is added and no edge is counted. `addState` keeps the special start/end marker `[*]` as its own entry and otherwise extracts the leading identifier with the same leading-identifier regex used in the flowchart counter.

```ts
function countStateElements(body: string[]): FlowDiagramElementCount
```

Together these pieces form a single pipeline: `extractInlineFlowDiagram` (or its `extractInlineModuleDiagram` alias) pulls the first real mermaid block out of the page's `## Diagram` section, rewrites the page around a `flowDiagramPlaceholder` reference, and reports whether the body exceeds `FLOW_DIAGRAM_SOURCE_MAX_CHARS`; `countFlowDiagramElements` then dispatches to `countFlowchartElements`, `countSequenceElements`, or `countStateElements` to convert the extracted source into a `{ nodes, edges }` summary without touching the renderer.

## Tests

Covered by `packages/core/src/artifact.test.ts` (same-name test file on disk).
