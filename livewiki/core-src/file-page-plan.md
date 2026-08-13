---
title: file-page-plan
owner: generated
anchors:
  - packages/core/src/file-page-plan.ts#assembleFilePage
  - packages/core/src/file-page-plan.ts#deterministicFallbackPlan
  - packages/core/src/file-page-plan.ts#extractSectionSource
  - packages/core/src/file-page-plan.ts#parseFilePlan
---

# file-page-plan

This page documents the pure planning, slicing, and assembly functions that the livewiki pipeline uses when a single source file is too large to document in one model call.

## When to use this page

- **Validate** a model's proposed narrative plan against the closed list of canonical symbol keys before any section prose is generated.
- **Recover** from a plan-validation failure with a deterministic, source-order fallback plan so generation can continue.
- **Slice** the source file down to the contiguous lines that cover a planned section's symbols, with a character budget that honestly flags truncation.
- **Assemble** the final page by stitching the opening, the per-section prose, the `lw:anchors` markers, and the frontmatter together in plan order.

## How it fits

`file-page-plan` lives at `packages/core/src/file-page-plan.ts` inside the `core` package. It is the deterministic, side-effect-free core of the plan-then-write pipeline that handles oversized single-file pages: a file whose source exceeds `fileSplitSourceBytes` cannot be documented from the full source in one call, so the pipeline instead runs pass 0 (opening), pass 1 (plan), pass 2 (section prose), and a final assembly step. This module owns the parsing and validation of the pass-1 plan, the fallback plan when the model fails twice, the source slicing that pass 2 needs, and the final assembly into a single Markdown document. It performs no I/O and never talks to the model — it is the pure mechanics that the orchestrator layers around an LLM. The closing `#29` design principle says generation-level chunking is the machine's concern, and this file is exactly where that concern is implemented.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-file-page-plan.mmd
```

## Parsing and validating the model's plan

<!-- lw:anchors packages/core/src/file-page-plan.ts#parseFilePlan -->

The pipeline's pass 1 asks the model to produce a narrative arc: an ordered list of sections, each with a heading and a set of canonical symbol keys. That arc must be an exact partition of the closed list — every key belongs to exactly one section, no key is repeated, and no key outside the closed list is cited. `parseFilePlan` is the gatekeeper that enforces that contract.

```ts
export function parseFilePlan(
  raw: string,
  closedKeyList: readonly string[],
): FilePlanValidation
```

`parseFilePlan` takes the raw model output (a string) and the closed list of canonical keys, and returns a discriminated `FilePlanValidation` result describing either an accepted plan or the first reason it was rejected.

The function extracts a fenced ```` ```json ```` block when one is present, falling back to treating the entire `raw` string as JSON; a parse failure is the first hard reject. It then checks the outer shape (object with a `sections` array), iterates each section verifying that `heading` is a non-empty string and `keys` is a non-empty array of strings, and rejects any key that is not in the closed list or that has already appeared in an earlier section. If anything fails it returns `{ ok: false, error: "..." }` immediately — only a structurally complete plan reaches the final coverage check. After the loop it verifies that the union of cited keys exactly equals the closed list; any missing keys produce a rejection that names up to three of them so the error message is concrete. On success it returns `{ ok: true, sections }` with each section's heading trimmed and keys in the order they were declared. The visible error paths include "plan is not valid JSON", "plan must be an object with a sections array", "section N needs a non-empty heading and a non-empty keys array", "section N cites key ... which is not in the closed list", "key X appears in more than one section", "plan has zero sections", and "plan leaves N closed-list key(s) unassigned".

## Deterministic fallback when the plan keeps failing

<!-- lw:anchors packages/core/src/file-page-plan.ts#deterministicFallbackPlan -->

When `parseFilePlan` rejects the model's plan twice, the pipeline still needs a plan it can act on — abandoning the page is worse than producing a mechanical one. `deterministicFallbackPlan` is that safety net: a source-order chunking that the orchestrator can fall back on without any further model calls.

```ts
export function deterministicFallbackPlan(
  closedKeyList: readonly string[],
  maxKeysPerSection = 15,
): FileSectionPlan[]
```

`deterministicFallbackPlan` takes the closed list and an optional chunk size, and returns a list of `FileSectionPlan` entries where each section's keys are a consecutive slice of the closed list in source order.

The implementation walks the closed list in order, slicing it into runs of at most `maxKeysPerSection` (default 15) consecutive keys, and emits a section per run. The heading for each section is an honest ordinal — `"Part N (symbols A–B)"` — so the reader can see immediately that the sectioning is a generation artifact, not a fabricated conceptual grouping. The fallback is intentionally deterministic: given the same closed list and chunk size, it produces the same plan every time, which keeps the rest of the pipeline reproducible. The chunk-size parameter is the only knob — the caller can tune section breadth without changing the algorithm's character.

## Slicing the source for a planned section

<!-- lw:anchors packages/core/src/file-page-plan.ts#extractSectionSource -->

Pass 2 needs the **complete** source slice covering a section's symbols, not a fair truncation of the whole file. `extractSectionSource` builds that slice by merging the contiguous line ranges of a section's symbol spans and capping the result at a character budget, with a `truncated` flag the section prompt can surface honestly when evidence is partial.

```ts
export function extractSectionSource(
  sourceText: string,
  spans: readonly SymbolSpan[],
  maxChars: number,
): { text: string; truncated: boolean }
```

`extractSectionSource` takes the full file text, the symbol spans for one planned section, and a maximum character count, and returns the joined slice plus a flag that says whether the budget was hit.

The function rejects the empty-spans case up front with `{ text: "", truncated: false }`. For non-empty spans it splits the source into lines, normalizes each span's start and end to a `[min, max]` pair floored at 1, and sorts the ranges by start. Adjacent or overlapping ranges (where `r.start <= last.end + 1`) are merged into the previous range, so symbols that sit next to each other form one contiguous slice rather than a fragmented one. Each merged range is sliced out of the source, joined with `\n`, and accumulated. The budget is enforced as an **upper bound**: when the next slice would push `total` past `maxChars`, the function either appends a partial slice (only when `remaining > 200` characters are left, to avoid a near-empty tail) or stops, sets `truncated = true`, and breaks. The slices are joined with `\n// …\n` separators so a reader can see where merged ranges were stitched together. The returned `truncated` flag is the only signal the section prompt gets about partial evidence — it is set whenever the budget stopped accumulation, whether or not the final partial slice was appended.

## Assembling the final page

<!-- lw:anchors packages/core/src/file-page-plan.ts#assembleFilePage -->

The last step is purely mechanical: take the pass-0 opening, the pass-2 section prose, the validated plan, and the closed list, and stitch them into a single Markdown document with correct frontmatter, an `lw:anchors` marker per section, and sections in plan order. `assembleFilePage` is the function the orchestrator calls once every other piece is in hand.

```ts
export function assembleFilePage(opts: AssembleFilePageOptions): string
```

`assembleFilePage` takes an options object holding the opening, the section prose, the plan, the closed list, and an optional owner, and returns the complete page as a Markdown string.

The title is extracted from the opening's first `#`-prefixed line by a multiline regex, falling back to `"Untitled file"` when the opening has no H1. Frontmatter is built as YAML: `title`, `owner` (defaulting to `"generated"` when `opts.owner` is not supplied), and an `anchors` list that mirrors `closedKeyList` exactly when the list is non-empty. The orchestrator owns the frontmatter anchors list and the per-section `lw:anchors` markers — the model never writes either one. The opening block is inserted verbatim after the closing `---`. Each planned section is then rendered as a level-2 heading (`## {heading}`) followed by an `lw:anchors` marker line and the trimmed prose from `sectionProse[i]`; a missing prose entry defaults to an empty string. The function collapses runs of three or more newlines down to two (so the output never has blank-line gaps larger than a paragraph break) and ends the page with a single trailing newline.

## Tests

Covered by `packages/core/src/file-page-plan.test.ts` (same-name test file on disk).
