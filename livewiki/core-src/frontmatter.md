---
title: Frontmatter parser
owner: generated
anchors:
  - packages/core/src/frontmatter.ts#FrontmatterParseError
  - packages/core/src/frontmatter.ts#FrontmatterParseError.constructor
  - packages/core/src/frontmatter.ts#getAnchors
  - packages/core/src/frontmatter.ts#getOwner
  - packages/core/src/frontmatter.ts#parseFrontmatter
  - packages/core/src/frontmatter.ts#parseYamlBlock
  - packages/core/src/frontmatter.ts#stripComment
---

# Frontmatter parser

This page documents the module that parses the YAML-style frontmatter block at the top of every livewiki page and exposes typed accessors for its key fields.

## When to use this page

- **Read** this page when you need to understand how a livewiki page's metadata block (title, owner, anchors, modules, etc.) is turned into structured data.
- **Reach for `parseFrontmatter`** when a tool receives raw Markdown source and must split it into the metadata map and the body content.
- **Reach for `getAnchors` / `getOwner`** when downstream code needs a specific frontmatter field with safe defaults for pages that have no frontmatter.
- **Trace an error** to its source when a malformed page produces a `FrontmatterParseError`.

## How it fits

This module lives in `packages/core/src/frontmatter.ts`, the low-level layer that every page-consuming tool in livewiki shares. Pages are plain Markdown files that begin with a fenced `--- ... ---` block; that block carries metadata the renderer needs (such as the page title and the list of symbol anchors the page documents). `parseFrontmatter` is the entry function that splits a raw source string into a typed metadata map and the body string, while `getAnchors` and `getOwner` are tiny helpers used by callers that only care about one field at a time. The parser deliberately implements a small YAML subset (top-level keys, string values, block lists, and single-level inline lists) rather than depending on a full YAML library, because the project's metadata needs are narrow and well-defined, and a hand-rolled parser gives precise error messages tied to source line numbers.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-frontmatter.mmd
```

## Opening the block and splitting body

<!-- lw:anchors packages/core/src/frontmatter.ts#parseFrontmatter -->

The first responsibility of the file is to decide whether a source string even has a frontmatter block, and if so, to slice the block off from the body and hand the YAML text to the next stage. `parseFrontmatter` is the entry point and produces a `ParseResult` with three fields: the metadata map (or `null` when no frontmatter exists), the body string after the closing fence, and the byte offset where the body starts in the original source.

```ts
export function parseFrontmatter(source: string): ParseResult
```

Takes the full Markdown source and returns the parsed result: `{ frontmatter, body, bodyOffset }`.

```ts
export interface ParseResult {
  /** Mapa de campos. Ausente se a página não tem frontmatter. */
  frontmatter: Frontmatter | null;
  /** Conteúdo após o `---` de fechamento (markdown body). */
  body: string;
  /** Byte offset onde o body começa no source original. */
  bodyOffset: number;
}
```

The function first normalizes line endings (`\r\n` → `\n`) so every other step can rely on `\n`. It then checks whether the source starts with `---\n`; if not, it returns `frontmatter: null` with the body equal to the entire source — this is the documented "no frontmatter" path and is **not** an error, because livewiki pages are allowed to ship without metadata. When a block is present, the function searches for the closing `\n---` line. If the close marker is missing, it throws a `FrontmatterParseError` referencing line `1`. On success, it slices out the YAML text, strips exactly one leading newline that follows the closing fence, and computes `bodyOffset` as the byte position of the body start in the normalized source.

## Parsing the YAML subset

<!-- lw:anchors packages/core/src/frontmatter.ts#parseYamlBlock packages/core/src/frontmatter.ts#stripComment -->

Once `parseFrontmatter` has extracted the YAML text between the two `---` markers, the second responsibility is turning that text into the `Frontmatter` map the rest of the system consumes. `parseYamlBlock` is the internal worker that walks the lines, recognizes three line shapes — empty lines, comments, list items, and `key: value` pairs — and builds the resulting object.

```ts
function parseYamlBlock(yaml: string): Frontmatter
```

Takes the YAML text between the opening and closing fences and returns a `Frontmatter` record mapping each top-level key to either a string or a string array.

The loop tracks two pieces of state as it walks the lines: `currentListKey` (the key currently accumulating a block list) and `currentList` (the array being filled). Each non-blank, non-comment line is matched first against a block-list pattern of the form `"  - value"`; a match pushes the trimmed value into the active list. If a list item appears before any key has opened a list, the function throws a `FrontmatterParseError` referencing the offending line. Lines that are not list items are matched against a key-value pattern that allows keys composed of letters, digits, underscores, and dashes; a non-matching line throws with the line content in the message.

When a key is followed by an empty value, the parser enters "list-building mode" and stores an empty array under that key, ready for subsequent list items. When a key is followed by a value, the parser calls `stripComment` to remove any trailing `# ...` comment, trims, and then either stores it as a string or — if the value starts with `[` and ends with `]` — interprets it as an inline flow-style list. Inline lists are split on commas, trimmed, and filtered to drop empty entries; the implementation deliberately does not support nested structures or quoted strings, matching the subset philosophy stated at the top of the file.

Comment handling is delegated to `stripComment`, a small helper that finds the first `#` preceded by either the start of the string or whitespace and truncates the string there. Because strings in this subset cannot contain an unescaped `#`, the helper is intentionally simple; richer quoting is listed as a known limitation in the file's docstring.

```ts
function stripComment(s: string): string
```

Takes a single line fragment and returns the same string with any trailing YAML comment (the first `#` at the start of the string or after whitespace, and everything after it) removed.

## Surfacing parse errors with line context

<!-- lw:anchors packages/core/src/frontmatter.ts#FrontmatterParseError packages/core/src/frontmatter.ts#FrontmatterParseError.constructor -->

The third responsibility is making failures actionable: when a page's frontmatter is malformed, callers need to know which line broke and why. `FrontmatterParseError` is the dedicated error class the parser throws, distinct from a generic `Error` so callers can branch on it specifically.

```ts
export class FrontmatterParseError extends Error {
  public readonly line: number;
  constructor(message: string, line: number) {
    super(`Frontmatter parse error (line ${line}): ${message}`);
    this.name = "FrontmatterParseError";
    this.line = line;
  }
}
```

Takes a human-readable message and a 1-based source line number, builds a wrapped message of the form `Frontmatter parse error (line N): <message>`, sets the error's `.name` so `instanceof` and stack traces identify it precisely, and exposes `.line` as a readonly public field for programmatic inspection. The line numbers used at the call sites in `parseFrontmatter` and `parseYamlBlock` come from a per-line counter that increments before each match attempt, so the value reported to the user points at the line that caused the failure rather than the line preceding it.

## Reading specific fields with safe defaults

<!-- lw:anchors packages/core/src/frontmatter.ts#getAnchors packages/core/src/frontmatter.ts#getOwner -->

The fourth responsibility is giving downstream code a stable, narrow surface for the two frontmatter fields the rest of livewiki queries most often: the `anchors` list and the `owner` tag. Both helpers accept the already-parsed `Frontmatter | null` so callers do not need to null-check the map themselves.

```ts
export function getAnchors(fm: Frontmatter | null): string[]
```

Takes a parsed frontmatter map (or `null` when the page had no frontmatter at all) and returns its `anchors` field as a string array, returning `[]` when the field is missing or has been stored as a string instead of a list.

```ts
export function getOwner(fm: Frontmatter | null): "generated" | "human" | "mixed"
```

Takes a parsed frontmatter map (or `null`) and returns its `owner` field as one of three literal values, defaulting to `"generated"` when the field is absent or carries any other string.

`getAnchors` short-circuits to `[]` whenever the input is `null` or when the `anchors` key is not an array — this matches the parser's behavior of either storing a block list or an inline list as an array, so a missing or wrong-shaped value is treated the same as no anchors at all. `getOwner` validates the value against the three known literal owners (`"generated"`, `"human"`, `"mixed"`) and falls back to `"generated"` for any other string or for `null`; this means a typo such as `"genereated"` silently becomes `"generated"` rather than throwing, which the callers rely on for forward compatibility with pages generated before stricter validation existed.

## Tests

Covered by `packages/core/src/frontmatter.test.ts` (same-name test file on disk).
