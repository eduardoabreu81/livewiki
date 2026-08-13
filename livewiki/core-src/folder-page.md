---
title: Folder page unit (deterministic skeleton + bounded LLM purpose paragraph)
owner: generated
anchors:
  - packages/core/src/folder-page.ts#FOLDER_PURPOSE_MAX_CHARS
  - packages/core/src/folder-page.ts#FOLDER_PURPOSE_MIN_CHARS
  - packages/core/src/folder-page.ts#buildFolderPurposeContext
  - packages/core/src/folder-page.ts#extractPageTitle
  - packages/core/src/folder-page.ts#plainTestCoverageLine
  - packages/core/src/folder-page.ts#renderFolderPage
  - packages/core/src/folder-page.ts#truncateFolderPurpose
  - packages/core/src/folder-page.ts#validateFolderPurpose
---

# Folder page unit (deterministic skeleton + bounded LLM purpose paragraph)

This page documents `packages/core/src/folder-page.ts`, the unit that assembles the wiki's folder-level landing page.

## When to use this page

- **Validate or constrain** a model-written folder-purpose paragraph against the upper and lower character bounds and the "plain prose, no structure" rule.
- **Render the deterministic folder page** Markdown (frontmatter, H1, purpose paragraph, file guide, and test-coverage sentence) from a `FolderUnit` plus its accepted file pages.
- **Build the evidence block** that feeds the folder-purpose prompt — the file inventory plus the openings of accepted file pages, both already capped.
- **Extract a human-meaningful title** for an inert Markdown file from its frontmatter `title:` or top-of-document H1, so the file guide leads with intent rather than filename noise.

## How it fits

`folder-page.ts` is one building block of the livewiki `@livewiki/core` package, alongside `auxiliary-page.ts` (a sibling renderer), `page-units.ts` (the planner's `FolderUnit` / `FileUnit` shapes and the coverage signal), and `frontmatter.ts` (the tolerant YAML parser reused for prose-file titles). The folder page is the front door for browsing a repository: it shows one paragraph stating what a directory is for, followed by a deterministic guide over the planner's partition of the directory's real units. Nothing in the guide is model output — every line is derived from data the planner already accepted — so no file can be invented or omitted and no link can point at a page that does not exist. A failed generation degrades to a plain name, never a dangling link. The LLM's only contribution is the bounded purpose paragraph, which the file validates, optionally clips, and then drops into a fully deterministic skeleton.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-folder-page.mmd
```

## Purpose-paragraph bounds

<!-- lw:anchors packages/core/src/folder-page.ts#FOLDER_PURPOSE_MIN_CHARS packages/core/src/folder-page.ts#FOLDER_PURPOSE_MAX_CHARS -->

The folder page is the only place where the LLM writes prose, so the file declares the contract explicitly as two integer constants the rest of the module imports. Every check against length — both validation and the deterministic repair — references these symbols directly, so a single edit moves the cap everywhere at once.

```ts
export const FOLDER_PURPOSE_MIN_CHARS = 40;
export const FOLDER_PURPOSE_MAX_CHARS = 800;
```

`FOLDER_PURPOSE_MIN_CHARS` is the lower bound (40 characters): below it the paragraph is too thin to actually describe a directory. `FOLDER_PURPOSE_MAX_CHARS` is the upper bound (800 characters): above it the paragraph no longer fits the "one honest paragraph" rule that motivates the unit.

## Purpose-paragraph validation and last-resort repair

<!-- lw:anchors packages/core/src/folder-page.ts#validateFolderPurpose packages/core/src/folder-page.ts#truncateFolderPurpose -->

The folder-purpose paragraph is the only piece of model output that survives into a wiki page, so it has a tight gate and a deterministic fallback. `validateFolderPurpose` is the gate; `truncateFolderPurpose` is the deterministic last resort applied only when the gate's *only* complaint is the upper-length failure.

```ts
export function validateFolderPurpose(raw: string): FolderPurposeError[];
export function truncateFolderPurpose(raw: string): string | null;
```

`validateFolderPurpose` takes the raw paragraph string and returns zero or more `FolderPurposeError` records; each carries a machine code and a human message, and the caller decides whether to retry. `truncateFolderPurpose` takes the raw paragraph and returns the clipped string, or `null` when no honest clip point exists.

`validateFolderPurpose` runs four checks in order: empty input becomes `folder_purpose_empty`; below `FOLDER_PURPOSE_MIN_CHARS` becomes `folder_purpose_too_short`; above `FOLDER_PURPOSE_MAX_CHARS` becomes `folder_purpose_too_long`; and a single structural check (`folder_purpose_invalid_shape`) rejects frontmatter fences, Markdown headings on any line, code fences, HTML comments, Markdown link syntax, and `TODO`/`TBD` markers. The rationale comments make the trade-off explicit: the paragraph carries no anchors, no links, and no structure — those are deterministic — so the structural checks are deliberately small.

`truncateFolderPurpose` first trims and collapses whitespace; if the result already fits, it returns it as-is. Otherwise it walks sentence boundaries (`[.!?]` plus the CJK equivalents, optionally followed by a closing quote or bracket, followed by whitespace or end-of-string) and remembers the last boundary whose end-position is still at or below the cap. If that remembered position is at least `FOLDER_PURPOSE_MIN_CHARS`, the function returns the slice up to it; otherwise it returns `null`. The visible fail-open branch matters: a single sentence longer than the cap has no honest clip point, and the function signals the caller (`null`) instead of inventing one. The function never rewrites prose — it only deletes trailing sentences — which preserves the front-loaded identity statement that models produce.

## Title extraction for inert Markdown files

<!-- lw:anchors packages/core/src/folder-page.ts#extractPageTitle -->

The guide line for each entry has to lead with what the file *is for*, not the raw filename. For accepted wiki pages the caller supplies titles via `titlesByPagePath`; for inert Markdown files (READMEs, notes) the guide pulls a title from the file itself using `extractPageTitle`.

```ts
export function extractPageTitle(content: string): string | null;
```

`extractPageTitle` takes the raw file content and returns the harvested title string, or `null` when the file declares nothing usable.

The extraction first delegates to `parseFrontmatter` from `frontmatter.ts`; if that throws, the body falls back to the raw content. When the frontmatter has a non-empty string `title:`, that value is returned (trimmed). Otherwise the function scans the body line by line, skipping blank lines and HTML-style lines (such as badges or wrapper `<div>`s), and returns the first line that matches `^#\s+(.+)$` — provided the captured heading is not empty. If neither path produces a value, the function returns `null`, and the renderer falls back to the plain "not documented" line. The visible behavior is intentionally narrow: only an H1 in true title position qualifies, so a README whose first heading is a setup note thirty lines down is treated as "no title" rather than as that note.

## Folder page rendering

<!-- lw:anchors packages/core/src/folder-page.ts#renderFolderPage -->

`renderFolderPage` is the file's central mechanism: a pure, deterministic function that turns a `FolderUnit` and its accepted file pages into the complete folder-page Markdown. It owns the frontmatter, the H1, the purpose paragraph slot, the file guide, and the trailing plain-language test-coverage sentence.

```ts
export function renderFolderPage(opts: RenderFolderPageOptions): string;
```

`renderFolderPage` takes a `RenderFolderPageOptions` record and returns the assembled Markdown string — fully deterministic, with no model involvement in the structural output.

The flow runs as follows. First the function picks a title — `"(repository root)"` for the empty directory, otherwise the directory path itself. Next it selects the purpose: the validated LLM paragraph when present, otherwise the deterministic role sentence from `FOLDER_ROLE_SENTENCE` when a non-product `role` was supplied, otherwise an empty string. The skeleton then emits the YAML frontmatter, an H1, and the chosen purpose paragraph.

The file guide walks each entry in `folder.entries` (the planner's real-units partition) and switches on `entry.disposition`. For a `"page"` entry the renderer joins a `FileUnit` lookup against `existingPagePaths` to decide whether the wiki page was actually written: a present page renders as a Markdown link to the page's basename, a missing page renders as an inline-code plain name with the honest `page not written yet` annotation. The line leads with the page's accepted title when `titlesByPagePath` supplies one; otherwise it falls back to the bare link, deliberately avoiding the machine metric ("N symbols") where meaning belongs. A paired test path, when present, is appended as ``Tests: `<basename>` `` in the same line. For an `"inert"` entry the renderer prefers a prose title harvested by `extractPageTitle` (via `proseTitlesByFilePath`) and otherwise emits the plain "not documented" fallback. A `"test-paired"` entry contributes nothing — it is already accounted on its product file's line. `"test-likely"` and `"test-orphan"` entries are deferred into a separate `testLines` collection, which the renderer appends as a `### Test files without a same-name counterpart` subsection.

After the guide, when the planner's coverage signal reports at least one page, the renderer appends the plain-language coverage sentence from `plainTestCoverageLine`. The function then collapses runs of three or more blank lines down to two and trims trailing whitespace before appending a single newline — keeping the output diff-stable across runs.

## Plain-language test coverage

<!-- lw:anchors packages/core/src/folder-page.ts#plainTestCoverageLine -->

The folder page ends with a single sentence about same-name test coverage, written in plain language a lay reader can parse. The four shapes — a single documented file, none covered, all covered, partial coverage — each get their own wording.

```ts
export function plainTestCoverageLine(covered: number, pages: number): string;
```

`plainTestCoverageLine` takes the count of documented files that have a same-name test (`covered`) and the total documented files (`pages`), and returns one sentence describing the state.

The branching is exhaustive: a single documented file yields either "This file has a test file named after it." or "This file has no test file named after it." depending on `covered`. With multiple files and `covered === 0` it reports "None of the N documented files in this folder has a test file named after it."; with `covered === pages` it reports "Every documented file in this folder has a test file named after it."; the partial case reads "K of the N documented files in this folder have a test file named after them." The function is exported specifically so tests can lock in those exact strings — the comment in the source is explicit that the three plural shapes are tested, never the singular form.

## Folder-purpose evidence block

<!-- lw:anchors packages/core/src/folder-page.ts#buildFolderPurposeContext -->

The folder-purpose prompt needs honest evidence about the directory: a deterministic file inventory plus the openings of the folder's accepted file pages. `buildFolderPurposeContext` assembles that block, fully deterministically, so the LLM never has to guess what is in the folder.

```ts
export function buildFolderPurposeContext(opts: {
  readonly folder: FolderUnit;
  readonly fileUnits: readonly FileUnit[];
  readonly symbolCountByPath: ReadonlyMap<string, number>;
  readonly openingsByPagePath: ReadonlyMap<string, string>;
}): string;
```

`buildFolderPurposeContext` takes the folder, its file units, the per-path symbol count map, and a precomputed opening digest for each accepted file page; it returns a single Markdown string the caller drops into the prompt.

The function first emits a `Directory:` line (using `"(repository root)"` for the root) and a deterministic `Files (deterministic inventory):` block: each entry in `folder.entries` becomes `- <path> — <disposition>, <symbols> symbols`, with the symbol count defaulted to `0` when the map has no entry. The opening section then walks `fileUnits` in their given order, skipping any unit whose `pagePath` is missing from `openingsByPagePath`. Each present opening is clipped to `FOLDER_OPENING_CAP` characters (with a trailing `…`) and prepended with a `### <filePath>` header; the block is appended only when adding it would not push the running total past `FOLDER_OPENINGS_TOTAL_CAP`, after which the loop stops. If at least one block survived, the section is appended under the heading `Accepted file-page openings (already verify-gated):`. The result is a bounded, deterministic digest: the LLM sees the real inventory plus the openings of the already-verified pages, and the prompt never has to fabricate what is in the folder.

## Tests

Covered by `packages/core/src/folder-page.test.ts` (same-name test file on disk).
