---
title: Repo orientation extraction
owner: generated
anchors:
  - packages/core/src/orientation.ts#PURPOSE_MAX_CHARS
  - packages/core/src/orientation.ts#clipSentence
  - packages/core/src/orientation.ts#detectSurfaces
  - packages/core/src/orientation.ts#extractPurpose
  - packages/core/src/orientation.ts#extractReadmeTitle
  - packages/core/src/orientation.ts#extractRepoOrientation
  - packages/core/src/orientation.ts#findFastPathSection
  - packages/core/src/orientation.ts#findPrimaryReadme
  - packages/core/src/orientation.ts#isBadgeOrLinkOnlyLine
  - packages/core/src/orientation.ts#isListLeadIn
  - packages/core/src/orientation.ts#isMeaningfulProse
  - packages/core/src/orientation.ts#readBounded
  - packages/core/src/orientation.ts#readdirNames
  - packages/core/src/orientation.ts#stripHtmlTags
---

# Repo orientation extraction

This page documents how `packages/core/src/orientation.ts` derives a small bundle of product-orientation facts about a repository from its root directory.

## When to use this page

- **Pull orientation facts** for a repository root before synthesising quickstart material.
- **Trace why a README paragraph was accepted or rejected** as a product-purpose statement.
- **Tune the heuristics** that decide what counts as meaningful prose, a heading, or a fast-path section.

## How it fits

`packages/core/src/orientation.ts` lives in the `core` package of the livewiki monorepo. It is the deterministic, no-LLM half of the product-orientation plan: given a repository root, it inspects the primary README and a handful of well-known root files, then returns a `RepoOrientation` value describing the product's purpose, name, surfaces, and quickstart section. Every step is a pure read; missing or unreadable files degrade to `null` or empty results rather than throwing, so callers can rely on the shape of the returned object regardless of repository layout. Higher-level code in livewiki consumes this evidence to seed the quickstart that must precede the livewiki workflow itself.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-orientation.mmd
```

## Locating the primary README

<!-- lw:anchors packages/core/src/orientation.ts#findPrimaryReadme packages/core/src/orientation.ts#readdirNames packages/core/src/orientation.ts#readBounded -->

Before any prose analysis can happen, the file has to choose *which* README to read. The selection order is fixed: `README.md`, then `README.en.md`, then any other `README*.{md,markdown}` at the root, sorted case-insensitively.

```ts
async function findPrimaryReadme(root: string): Promise<string | null>
```

`findPrimaryReadme` takes a resolved repository root and returns the matching filename (preserving original case) or `null` if none is present. It enumerates entries via `readdirNames`.

```ts
async function readdirNames(root: string): Promise<string[]>
```

`readdirNames` lists only file-type entries in the directory; directories are filtered out. A failed read (missing path, permission denied) resolves to an empty array via the `catch` block, so the caller sees an empty `names` list instead of an exception — that propagates to `findPrimaryReadme` returning `null`, which is how "no README" is signalled.

Once the path is chosen, the file is loaded with a size cap.

```ts
async function readBounded(absFile: string): Promise<string | null>
```

`readBounded` returns up to `README_MAX_BYTES` (256 KiB) of UTF-8 text. When the file is at or below that bound it is read in full; when it exceeds the bound, only the first `README_MAX_BYTES` bytes are loaded through an explicit `open`/`read`/`close` sequence. The READMEs live near the top of a repo, so the cap is a memory guard, not a feature; any filesystem error resolves to `null` and the rest of the orientation pipeline receives an empty source string's worth of "not present" data.

## Reading the README's purpose paragraph

<!-- lw:anchors packages/core/src/orientation.ts#extractPurpose packages/core/src/orientation.ts#stripHtmlTags packages/core/src/orientation.ts#isMeaningfulProse packages/core/src/orientation.ts#isListLeadIn packages/core/src/orientation.ts#isBadgeOrLinkOnlyLine packages/core/src/orientation.ts#PURPOSE_MAX_CHARS packages/core/src/orientation.ts#clipSentence -->

The purpose field on `RepoOrientation` is the first paragraph of the README that looks like a real human sentence and ends on a period rather than a colon. The scan is line-based, tracks fenced code regions and HTML multi-line tags, and rejects everything that is structurally not prose.

```ts
export function extractPurpose(markdown: string): string | null
```

`extractPurpose` walks the lines of the markdown source, accumulating text into a `paragraph` buffer until a blank line or another structural boundary triggers `flush`. The candidate paragraph is checked in three ways before being accepted:

1. `isMeaningfulProse` rejects anything below `PURPOSE_MIN_CHARS` (40) characters or without at least one letter from a Latin / CJK / Hangana / Kana class — a guard against whitespace-only fragments and Unicode tricks.
2. `isListLeadIn` rejects paragraphs ending in `:` (Latin full-width or ASCII), since those introduce lists rather than describe the product.
3. `clipSentence` trims the result down to a readable excerpt.

While scanning, the following are skipped without contributing to the buffer: fenced code blocks (```` ``` ```` or `~~~`), multi-line HTML tag openers that never close on the same line, markdown headings, HTML headings matched by `HTML_HEADING_RE` (`<h1>`–`<h6>`), thematic breaks (`---`, `***`, `___`), and list items. Badge, image, and link-only lines (language switchers, "shields.io" strips) are detected by `isBadgeOrLinkOnlyLine` and treated as structural rather than prose. Container-style HTML blocks such as `<div>` and `<p>` are *traversed* — `stripHtmlTags` removes the markup while keeping the inner text, which lets READMEs that put their product sentence inside a centred header div still match.

```ts
function stripHtmlTags(text: string): string
```

`stripHtmlTags` simply drops every `<...>` substring, returning only the surviving text. It is intentionally minimal; it does not decode entities or resolve nested attributes.

```ts
function isMeaningfulProse(text: string): boolean
```

`isMeaningfulProse` strips markdown link syntax (`[text](href)`), removes emphasis and code characters, trims, and verifies two properties: length is at least `PURPOSE_MIN_CHARS`, and the surviving string contains a letter from a recognised script. Both must hold.

```ts
function isListLeadIn(text: string): boolean
```

`isListLeadIn` performs the same markdown-link flattening, drops emphasis characters, trims, and asks whether the resulting string ends with `:` or `：` (the CJK colon). The colon is the only structural cue here; the function does not look at the *content* of the paragraph.

```ts
function isBadgeOrLinkOnlyLine(line: string): boolean
```

`isBadgeOrLinkOnlyLine` removes linked badges (`[![alt](img)](href)`), plain images / links, HTML tags, and a wide set of separators (`|`, `·`, `•`, `-`, `–`, `—`, `/`, `\`, `,`, `;`, plus whitespace). If nothing remains, the line is structurally a badge bar and is skipped.

```ts
export const PURPOSE_MAX_CHARS = 600;
```

`PURPOSE_MAX_CHARS` is the upper bound applied by `clipSentence`. It is exported so downstream code can use the same cap without re-declaring the constant.

```ts
export function clipSentence(text: string, maxChars: number = PURPOSE_MAX_CHARS): string
```

`clipSentence` only shortens text that exceeds the cap. It looks for the last sentence terminator (`.!?。！？`, optionally followed by a closing quote or bracket, then whitespace or end-of-string) at or before `maxChars`. When such a terminator exists at least `PURPOSE_MIN_CHARS` characters in, the text is cut there. Otherwise it falls back to the last whitespace boundary past the same floor, appending `…`; if no such boundary exists it cuts hard at `maxChars` and still appends `…`.

## Reading the README's title

<!-- lw:anchors packages/core/src/orientation.ts#extractReadmeTitle -->

A separate function answers the question "what is the product called" from the README's first heading, distinct from the purpose prose.

```ts
export function extractReadmeTitle(markdown: string): string | null
```

`extractReadmeTitle` scans lines, ignoring anything inside a fenced code block (so a `# comment` inside a shell example is never mistaken for the title). It accepts either a markdown `# heading` line or a single-line `<h1>...</h1>` HTML heading. The inner text is then `stripHtmlTags`'d, markdown image/link syntax is reduced to its visible label, whitespace is collapsed, and edge decorations — non-letter, non-digit characters at the start or end — are trimmed via a Unicode property-class regex. The cleaned title is returned, capped at 80 characters. When no usable H1 exists, the result is `null`. The function does not throw on malformed HTML; the regex simply does not match and the scan continues.

## Detecting entry-point surfaces

<!-- lw:anchors packages/core/src/orientation.ts#detectSurfaces -->

`RepoOrientation.surfaces` is a list of human-readable one-line hints about how someone runs the project locally, derived purely from well-known root files.

```ts
async function detectSurfaces(root: string): Promise<string[]>
```

`detectSurfaces` calls `readdirNames` for the root, lowercases every name, and emits hints in this fixed order:

- `main.py` present → "Python entry point: `main.py`".
- `manage.py` present → "Django management entry point: `manage.py`".
- `package.json` present and parseable → either a `bin` hint (when `bin` is a non-empty string or non-empty object) or, failing that, a `main` hint. A read failure or JSON parse error is caught silently and yields no Node surface hint, mirroring the "missing data degrades to empty" contract used elsewhere in this file.
- Any `Dockerfile*` (matched by `/^dockerfile($|[.-])/i`, sorted case-insensitively) → a single "Container build file: \`<name>\`" hint for the first one in sorted order.
- `pyproject.toml`, `go.mod`, `Cargo.toml` → corresponding language metadata hints.

The function never throws; if the root is unreadable it returns an empty array, and an unreadable or malformed `package.json` simply contributes no Node surface.

## Finding the fast-path section

<!-- lw:anchors packages/core/src/orientation.ts#findFastPathSection -->

The final orientation field is the heading text of the section that documents the fastest local path through the project.

```ts
export function findFastPathSection(markdown: string): string | null
```

`findFastPathSection` walks every line and, for each line that matches `^#{1,6}\s+(.+?)\s*#*\s*$` (a markdown ATX heading at any level), returns the heading text if it matches the `FAST_PATH_HEADING_RE` pattern (`quick ?start`, `getting started`, `installation`, `setup`, `run locally`, `local development`, or `usage`, case-insensitive). The function is intentionally simple: the *first* matching heading wins, regardless of level, and the scan does not fence-skip — a `# Quickstart` inside a code block can theoretically match. The contract is best-effort; the caller treats the result as a hint, not a guarantee.

## Top-level orchestration

<!-- lw:anchors packages/core/src/orientation.ts#extractRepoOrientation -->

All of the above is wired together by the single exported entry point.

```ts
export async function extractRepoOrientation(absRoot: string): Promise<RepoOrientation>
```

`extractRepoOrientation` resolves `absRoot` to an absolute path, then calls `findPrimaryReadme` to pick a README. When one exists, `readBounded` loads up to `README_MAX_BYTES` of it; the resulting source string is fed in parallel to `extractPurpose`, `extractReadmeTitle`, and `findFastPathSection`. The `surfaces` field is computed independently via `detectSurfaces` on the same root. The four results are bundled into a `RepoOrientation` object: `purpose`, `readmeTitle`, and `fastPathSection` are `null` whenever the README was missing, unreadable, or simply did not contain the corresponding signal, while `surfaces` is the empty array in the missing-root case. The function never throws on absent or unreadable inputs; every failure path is reduced to a `null`/empty field by the helpers above.

## Tests

Covered by `packages/core/src/orientation.test.ts` (same-name test file on disk).
