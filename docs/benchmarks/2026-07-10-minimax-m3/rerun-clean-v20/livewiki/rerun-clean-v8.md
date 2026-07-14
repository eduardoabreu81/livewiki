---
title: Static qualitative audit for the clean v8 artifact
owner: generated
anchors:
  - docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v8/_qualitative-audit.mjs#hasUnclosedInlineCode
  - docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v8/_qualitative-audit.mjs#maskManualAndCode
  - docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v8/_qualitative-audit.mjs#scanModulePage
  - docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v8/_qualitative-audit.mjs#walk
---

# Static qualitative audit for the clean v8 artifact

This page is the reference for the standalone Node script that scans the frozen livewiki artifact and emits a `qualitative-audit.json` report.

## When to use this page

- **Run** the audit with `node _qualitative-audit.mjs <artifactRoot>` to produce a metrics report over a previously generated livewiki tree.
- **Inspect** how the script enumerates module pages, masks manual/code regions, and detects unclosed Markdown before deciding whether a regression from clean v7 is still present.
- **Diagnose** why a page check fails by reading what `scanModulePage` records for frontmatter coverage, empty sections, visible sentinels, or `TODO`/`TBD` prose.
- **Compare** diagram declarations and `commands.md` claims against the source so you can spot drift between the documentation and the implementation.

## How it fits

This module lives under `docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v8/` alongside the clean v8 benchmark. It is a benchmark/audit tool, not a product entry point: it consumes the frozen `livewiki/` and `metrics/` directories under the artifact root and writes `qualitative-audit.json` next to them. It intentionally has no dependency on the paid pipeline and never edits generated pages.

The script's top-level orchestration reads like a small pipeline: `walk` collects files, `scanModulePage` evaluates each Markdown page, and several follow-up blocks inspect `overview.md`, `quickstart.md`, `commands.md`, and every `.mmd` diagram. Their findings are folded into a single `checks` object whose `overallGate` field is `"PASS"` only when every check is `true`.

## File enumeration

<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v8/_qualitative-audit.mjs#walk -->

The helper that backs every later list is:

```js
function walk(dir, suffix) {
```

`walk(dir, suffix)` returns a sorted array of absolute paths under `dir`. If `dir` does not exist on disk it returns an empty array without throwing. Otherwise it iterates `fs.readdirSync(dir, { withFileTypes: true })` and recurses into directories; for files it pushes the path only when `suffix` is empty or `entry.name.endsWith(suffix)`. The result is sorted before being returned, which is what later steps rely on for stable diffing.

The top of the script calls `walk(wikiRoot, ".md")` to enumerate every Markdown file and `walk(wikiRoot, ".mmd")` later on to inspect Mermaid diagrams. Two layout pages — `quickstart.md` and `architecture/overview.md` — are then excluded from `modulePages`, so the per-page structural checks only run against the rest of the tree.

## Markdown masking and unclosed-inline detection

<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v8/_qualitative-audit.mjs#maskManualAndCode docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v8/_qualitative-audit.mjs#hasUnclosedInlineCode -->

Two functions cooperate to strip content that should be invisible to the structural checks:

```js
function maskManualAndCode(text) {
```

and

```js
function hasUnclosedInlineCode(text) {
```

`maskManualAndCode(text)` does three things, in order. First it replaces every manual block region (the content between an opening and closing manual marker comment) with spaces of equal length so offsets and column counts survive the transformation. Second it walks line-by-line to track fenced code blocks opened with three or more backticks or tildes: anything between an opening fence and its matching closer is collapsed to empty lines, and the script reports `unclosedFence: true` if the end of the text is reached while a fence is still open. Third it scans the surviving text for inline code spans, matching a run of backticks with a later run of the same width; an inline span that has no matching closer is replaced by spaces of equal length and the leftover trailing run is preserved.

The return shape is `{ masked, unclosedFence }`. `unclosedFence` only becomes `true` when the fence-tracking pass reaches the end of the document with a fence still active; inline spans are intentionally not part of that flag, which is why a separate detector exists.

`hasUnclosedInlineCode(text)` reuses `maskManualAndCode` and returns `true` either when `unclosedFence` is set or when a backtick still appears anywhere in `masked`. Because fences were already collapsed to empty lines in the masked output, any surviving backtick must belong to an unmatched inline run, so a non-empty masked result is itself the signal.

## Per-page structural checks

<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v8/_qualitative-audit.mjs#scanModulePage -->

The function that ties the per-page analysis together is:

```js
function scanModulePage(file) {
```

`scanModulePage(file)` reads the file as UTF-8 and produces a structured record. It parses the leading `---` YAML frontmatter and pulls every `- <key>` line under an `anchors:` block into `fmKeys`. It then collects the contents of every `lw:anchors` HTML comment into `sectionKeys`. For each marker it also computes the visible prose that follows up to the next marker or the next Markdown heading, strips empty/comment-only lines after masking, and records the marker offset in `emptySections` if nothing visible remains.

The returned object is the union of these signals:

- `file` — the path relative to `wikiRoot`, with `path.sep` normalized to `/`.
- `frontmatterCount` / `sectionCount` — the deduplicated, sorted key sets.
- `independentCoverageEqual` — whether the JSON forms of the two sorted sets match exactly.
- `frontmatterDuplicates` / `sectionDuplicates` — keys that appeared more than once in their respective locations.
- `emptySections` — marker offsets whose visible prose was empty after masking.
- `unclosedMarkdown` — `hasUnclosedInlineCode(text)`.
- `visibleSentinel` — whether the source text still shows the `[untrusted ... control marker omitted]` string.
- `todoOrTbdProse` — a `TODO` or `TBD` token appearing in the *masked* output, so manual blocks and code spans do not trigger a false positive.

Pages are considered failing when any of those fields is non-empty or `independentCoverageEqual` is `false`, and that set of failing pages is what drives the top-level `modulePageStructure` gate.

## Aggregate report

The remaining top-level code stitches the per-page results together with several cross-file checks: missing `.mmd` references inside `architecture/overview.md`, the presence of a `## Important symbols` heading and the absence of a `## Key concepts` heading in `quickstart.md`, the appearance of benchmark-helper or test-fixture paths inside `quickstart.md`'s Important symbols section, duplicate `class:` / `node:` declarations across every `.mmd` file, contradictions between `commands.md` and `process.exit(...)` usage, and truncated page endings (empty body or unclosed Markdown).

All of those signals are folded into the `checks` object. `overallGate` is `"PASS"` only when every entry in `checks` is `true`; otherwise it is `"FAIL"`. The full payload, including the per-page records and the raw arrays for each cross-file check, is written to `metrics/qualitative-audit.json` and echoed to stdout.

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
<!-- livewiki:navigate:end -->
