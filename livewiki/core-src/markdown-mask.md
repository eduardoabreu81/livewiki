---
title: markdown-mask
owner: generated
anchors:
  - packages/core/src/markdown-mask.ts#boundedExcerpt
  - packages/core/src/markdown-mask.ts#consumeFenceLine
  - packages/core/src/markdown-mask.ts#createFenceState
  - packages/core/src/markdown-mask.ts#hasUnclosedFence
  - packages/core/src/markdown-mask.ts#hasUnclosedMarkdown
  - packages/core/src/markdown-mask.ts#maskCodeSpans
  - packages/core/src/markdown-mask.ts#maskCodeSpansPreservingLength
  - packages/core/src/markdown-mask.ts#maskFencedCodeBlocks
  - packages/core/src/markdown-mask.ts#maskFencedCodeBlocksPreservingLength
  - packages/core/src/markdown-mask.ts#maskInlineCode
  - packages/core/src/markdown-mask.ts#unclosedMarkdownDiagnostic
---

# markdown-mask

This page documents the deterministic helpers in `packages/core/src/markdown-mask.ts` that locate and neutralize Markdown code constructs (fenced blocks and inline code spans) so the rest of the core pipeline can treat them as inert display text.

## When to use this page

- **Blank out code surfaces** before scanning a document for navigable links or anchor markers, so backtick runs inside code never get misread as structural syntax.
- **Detect a truncated document** by asking whether any fenced block or inline code span was left open, giving a deterministic signal that a token-limit cut happened mid-construct.
- **Produce an actionable diagnostic** that points a repair prompt at the exact opening delimiter (line number, capped excerpt, and run length) when a document was cut mid-stream.
- **Share one masking implementation** across the verify, artifact, and anchor subsystems so they cannot drift apart in how they treat code surfaces.

## How it fits

`packages/core/src/markdown-mask.ts` lives in the `core` package and is consumed by `verify.ts` (mask code before scanning for navigable links), `artifact.ts` (marker validation, placeholder filler, and truncation), and `anchors.ts` (marker extraction for verify and the ledger). The module exposes both masking helpers (which rewrite code surfaces into blank text) and inspection helpers (which answer yes/no questions about whether the document is well-formed). It was carved out of `verify.ts` so all structural scans converge on a single implementation; Markdown code is treated as display text rather than a structural link or marker surface, so the rest of the pipeline can run regex passes against the masked view without false positives from inside code.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-markdown-mask.mmd
```

## Combined masking entry points

<!-- lw:anchors packages/core/src/markdown-mask.ts#maskCodeSpans packages/core/src/markdown-mask.ts#maskCodeSpansPreservingLength -->

The two public "combined" helpers are the front door most callers use: they mask both fenced blocks and inline code spans in a single call. Their only difference is whether the output preserves byte-for-byte alignment with the input.

```ts
export function maskCodeSpans(text: string): string
```

`maskCodeSpans` takes one string of arbitrary Markdown source and returns a new string with fenced blocks blanked first, then inline code spans blanked inside what remains. Because `maskFencedCodeBlocks` rewrites the opening fence, content, and closing fence as empty strings, the trailing `maskInlineCode` pass only sees the document's prose, so backtick runs inside code never reach the inline-code scanner.

```ts
export function maskCodeSpansPreservingLength(text: string): string
```

`maskCodeSpansPreservingLength` takes the same input and returns the same length string in which characters inside code become spaces instead of being deleted, and every line terminator is preserved. Every index in the masked view therefore maps to the same index in the original, which is what `unclosedMarkdownDiagnostic` relies on to translate a surviving backtick back to its real source position. On the normal path, no character is dropped and no terminator is altered; if a fenced block never closes, the state machine leaves every subsequent line claimed, and those lines become spaces too, which is the visible "the rest of the page got masked as a side effect" behaviour.

## Fenced-block state machine

<!-- lw:anchors packages/core/src/markdown-mask.ts#createFenceState packages/core/src/markdown-mask.ts#consumeFenceLine packages/core/src/markdown-mask.ts#maskFencedCodeBlocks packages/core/src/markdown-mask.ts#maskFencedCodeBlocksPreservingLength -->

Fenced blocks are tracked by a tiny state machine rather than a stack of open delimiters, because CommonMark fences nest only with the same character and at least the same run length, so a single "am I inside a fence, and if so which one" record is enough.

```ts
function createFenceState(): FenceState
```

`createFenceState` takes no arguments and returns a fresh `{ inFence, fenceChar, fenceLen }` record. It is the only way the rest of the file obtains a state object, so every scan starts from the same `inFence: false` baseline.

```ts
function consumeFenceLine(line: string, state: FenceState): boolean
```

`consumeFenceLine` takes a single line of text and the shared state record, advances the state for that line, and returns `true` when the entire line belongs to a fenced block, including the opening and closing fence lines themselves. The opening regex `^[ \t]{0,3}(`{3,}|~{3,})` permits up to three leading spaces or tabs of indentation, and the closing regex reuses the same character class and the same run length so fences can only be closed by an equal-or-longer run of the same character.

```ts
export function maskFencedCodeBlocks(text: string): string
```

`maskFencedCodeBlocks` takes one Markdown document string and returns a new string with the body (opening line, content, and closing line) of every fenced block blanked. It splits on `\r?\n` so CRLF inputs do not leave a stray `\r` that would prevent the closing-regex `$` from matching and accidentally keep the fence open through the rest of the document, then emits a blank string for every line `consumeFenceLine` claims and the original line otherwise.

```ts
function maskFencedCodeBlocksPreservingLength(text: string): string
```

`maskFencedCodeBlocksPreservingLength` takes the same input and walks the same state machine character-by-character, replacing claimed lines with spaces of the same length and reattaching the original `\r\n` or `\n` terminators so every offset survives. This private helper is the length-preserving primitive that the combined entry point delegates to, not a separate public function.

## Inline code-span masking

<!-- lw:anchors packages/core/src/markdown-mask.ts#maskInlineCode -->

```ts
export function maskInlineCode(text: string): string
```

`maskInlineCode` takes one string and returns a string in which every matched inline code span has been blanked. It follows the CommonMark rule that the closing delimiter must have exactly the same number of backticks as the opening one, which permits constructions such as `` `code with ` inside` &#96;&#96;. The scanner is left-to-right: when it sees a backtick run of length `runLen`, it searches forward for the next run of exactly the same length. If a match exists, every character from the opener through the closer is replaced with spaces and scanning continues past the closer; if no match exists, the entire unmatched run is appended verbatim and scanning continues past it. The "leave unmatched runs literal" branch is deliberate: `hasUnclosedMarkdown` reuses the masked output to detect a truncated document by checking for surviving backticks, so unmatched runs must survive the mask. Visible evidence in the source is limited to matched pairs and unmatched runs; any other CommonMark corner (such as a run that re-opens before closing) is whatever the loop's left-to-right scan actually produces.

## Well-formedness checks

<!-- lw:anchors packages/core/src/markdown-mask.ts#hasUnclosedFence packages/core/src/markdown-mask.ts#hasUnclosedMarkdown -->

These are the public yes/no questions callers ask when they want to know whether a document was cut mid-construct.

```ts
export function hasUnclosedFence(text: string): boolean
```

`hasUnclosedFence` takes one document string and returns `true` when a fenced code block was opened but never closed. Internally it runs the fence state machine to the end of the document and returns `state.inFence`. On the normal path it walks every line and never throws; if the document contains a fence that never closes, the state ends with `inFence: true` and that boolean is what the caller sees.

```ts
export function hasUnclosedMarkdown(text: string): boolean
```

`hasUnclosedMarkdown` takes one document string and returns `true` when the document has either an unclosed fenced code block or an inline code span with no matching close. It first delegates to `hasUnclosedFence`; if no fence is open, it runs the full `maskCodeSpans` and returns `true` if any backtick survives in the output. A well-formed document has zero backticks surviving `maskInlineCode` (every one was consumed as part of a matched pair) and zero fences left open, so this is a deterministic structural check rather than a size or length heuristic; it stays correct on any input shape that the CommonMark scanner handled. The function only signals "something is open"; it does not say which construct or where, which is the gap the next section's diagnostic closes.

## Truncation diagnostic

<!-- lw:anchors packages/core/src/markdown-mask.ts#unclosedMarkdownDiagnostic packages/core/src/markdown-mask.ts#boundedExcerpt -->

When `hasUnclosedMarkdown` returns `true`, the validator needs more than "something is open": it needs to point the repair prompt at the exact opening delimiter and tell the model how long the closing run must be. The CommonMark rules differ between the two constructs (fences close with at least the opening run length; inline code spans close with exactly the opening run length), so the diagnostic carries the kind alongside the line number and the delimiter length.

```ts
export function unclosedMarkdownDiagnostic(
  text: string,
  excerptCap: number = DEFAULT_UNCLOSED_EXCERPT_CAP,
): UnclosedMarkdownDiagnostic | null
```

`unclosedMarkdownDiagnostic` takes one document string and an optional excerpt cap (defaulting to 200), and returns either a structured `UnclosedMarkdownDiagnostic` or `null` when the body is well-formed. The strategy is to scan fences first, remembering the 1-based line number of the opening delimiter and returning a `kind: "fence"` diagnostic when the state machine ends still inside a fence. If no fence is open, the function runs the length-preserving code-span mask and finds the first surviving backtick (the first unmatched inline-code run, which the length-preserving mask leaves at its original offset), translates that offset back to a 1-based line number and a 0-based in-line offset, and returns the diagnostic with `kind: "inline-code"`. The `UnclosedMarkdownDiagnostic` record carries `kind`, `lineNumber`, a capped `offending` excerpt, and the exact `delimiterLength` of the opening run.

```ts
function boundedExcerpt(
  line: string,
  cap: number,
  delimOffset: number = 0,
  delimLen: number = 0,
): string
```

`boundedExcerpt` takes the offending line, the cap, the 0-based column of the delimiter's first character, and the delimiter length, and returns a window of `line` of length at most `cap` that contains the full delimiter. When the line is short enough to fit under the cap, it is returned unchanged. Otherwise the window is sized to leave room for two `… ` truncation markers (up to 4 chars), the delimiter is placed at the center of the window, and any leftover space is split between the sides. A defensive fallback re-slices the window if the centered computation accidentally dropped the delimiter run, so the excerpt always contains the exact delimiter characters the prompt needs to mirror. The cap is the upper bound only; the function never enforces a lower bound on excerpt length.

## Additional indexed symbols

<!-- lw:anchors packages/core/src/markdown-mask.ts#maskInlineCode -->

These anchors identify indexed symbols in this module that were not assigned to an earlier generated section.

## Tests

Covered by `packages/core/src/markdown-mask.test.ts` (same-name test file on disk).
