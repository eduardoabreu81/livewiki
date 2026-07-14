---
title: Benchmark harness helpers for clean v18 rerun
owner: generated
anchors:
  - docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v18/_acceptance-analysis.mjs#maskStructuralCode
  - docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v18/_acceptance-analysis.mjs#plannedSymbolsFromOverview
  - docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v18/_acceptance-analysis.mjs#readJson
  - docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v18/_acceptance-analysis.mjs#scanPage
  - docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v18/_acceptance-analysis.mjs#walk
  - docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v18/_qualitative-audit.mjs#hasUnclosedInlineCode
  - docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v18/_qualitative-audit.mjs#maskManualAndCode
  - docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v18/_qualitative-audit.mjs#maskStructuralCode
  - docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v18/_qualitative-audit.mjs#scanModulePage
  - docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v18/_qualitative-audit.mjs#walk
---

# Benchmark harness helpers for clean v18 rerun

This page documents the offline Node.js scripts that re-score a frozen `clean v18` artifact against the stage-4 product validator semantics.

## When to use this page

- **Run** `_acceptance-analysis.mjs` after a rerun to compute the corrected acceptance JSON (`overallGate: PASS|FAIL`) for a clean-v18 artifact.
- **Run** `_qualitative-audit.mjs` to flag concrete regressions (unclosed Markdown, empty sections, helper leakage into `quickstart.md`, diagram declaration collisions, `commands.md` `process.exit` contradictions, truncated page bodies).
- **Cross-check** the resulting `metrics/*.json` files against the product validator to decide whether to promote a rerun.

## How it fits

Both scripts live under `docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v18/` and operate strictly on a previously generated artifact directory: `<artifactRoot>/livewiki` for the Markdown pages and `<artifactRoot>/metrics` for inputs (`batch-status.json`, `verify.json`, `token-proxy-*.json`) and outputs. They never invoke the paid pipeline and never edit generated pages; they only read frozen output and emit JSON reports plus a short console summary. The acceptance script mirrors the stage-4 validator's key-completeness rule (frontmatter list and the union of section markers must each equal the closed key list exactly, once), while the qualitative audit re-uses the same code-masking logic to detect physical regressions the validator does not check for. The remainder of this page documents the individual helpers grouped by file.

## Acceptance script: filesystem and JSON I/O

<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v18/_acceptance-analysis.mjs#readJson docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v18/_acceptance-analysis.mjs#walk -->

`readJson(p)` is `function readJson(p) {`. It `JSON.parse`s the file at `p` and on any thrown error — parse failure or read failure — returns `null` instead of propagating. Callers therefore use truthiness rather than `try` blocks to detect missing or malformed JSON, which means a missing file and a malformed file are indistinguishable in the report.

`walk(d, a = [])` is `function walk(d, a = []) {`. It recurses through `d`, pushing every entry whose name ends with `.md` into the accumulator `a`. If `d` does not exist, it short-circuits and returns `a` unchanged. The script uses this to enumerate the module pages under `<artifactRoot>/livewiki` while explicitly skipping anything under an `architecture/` subdirectory and the `quickstart.md` file before calling `scanPage` on each remaining path. Because `walk` mutates and returns the same array reference, callers must not assume a fresh array when they pass an initial `a`.

## Acceptance script: masking and per-page scanning

<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v18/_acceptance-analysis.mjs#maskStructuralCode docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v18/_acceptance-analysis.mjs#scanPage -->

`maskStructuralCode(text)` is `function maskStructuralCode(text) {`. It replaces every character that lives inside a fenced code block (```` ``` ```` or `~~~`, with a leading indent of up to three spaces and a run length remembered on open) or inside a balanced inline code span with a literal space, while leaving the surrounding prose intact. The closing fence must match the opening character and be at least as long; the inline-span match requires an opening backtick run to be closed by a run of identical length. If no closing inline run exists, the opening run is preserved verbatim rather than silently dropped. The script uses this masked view to locate `lw:anchors` markers and headings without being fooled by example markers that appear inside fenced blocks.

`scanPage(filePath)` is `function scanPage(filePath) {`. It reads the page, runs `maskStructuralCode` over it, then extracts the YAML frontmatter's `anchors:` list and every `lw:anchors` marker in document order. It returns a `{ declared, realDups }` pair where `declared` is the union set of frontmatter keys and section-marker keys and `realDups` lists three error kinds: `frontmatter_duplicate` (same key listed twice inside the frontmatter), `same_marker_duplicate` (same key listed twice inside a single marker — only one offense is reported per marker), and `cross_section_duplicate` (the same key appearing under more than one marker). Per the validator semantics the script aligns with, a key that appears once in frontmatter and once under a marker is intentional and not flagged.

## Acceptance script: planned symbol count and gate logic

<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v18/_acceptance-analysis.mjs#plannedSymbolsFromOverview -->

`plannedSymbolsFromOverview(overviewText, plannedIds)` is `function plannedSymbolsFromOverview(overviewText, plannedIds) {`. It returns the total number of symbols the artifact was supposed to declare, preferring the overview header phrase `indexed and **N** symbols` and then falling back to `**N** symbols extracted`. If neither header is present it sums the per-module `**N** symbols` lines that follow each planned `<a id="..."></a>` anchor; if none of those are matched it returns `null` and the script leaves `fullSymbolCoverage` null so the gate is not applied. Coverage is then computed as exact equality between the declared anchor count and `plannedSymbols`, because an excess is treated as drift evidence rather than as a passing signal.

## Qualitative audit: filesystem walker and code masking

<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v18/_qualitative-audit.mjs#walk docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v18/_qualitative-audit.mjs#maskStructuralCode docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v18/_qualitative-audit.mjs#maskManualAndCode -->

`walk(dir, suffix)` is `function walk(dir, suffix) {`. It recurses through `dir` and, when `suffix` is set, keeps only files whose name ends with it; the returned array is sorted. An absent `dir` yields an empty array. The audit calls this twice — once with `".md"` to enumerate module pages and once with `".mmd"` to enumerate diagrams — and filters the markdown list against a fixed set of layout pages (`quickstart.md`, `architecture/overview.md`) before running the structural checks.

`maskStructuralCode(text)` is `function maskStructuralCode(text) {`. This is the same length-preserving fence-and-inline mask as in the acceptance script: fenced blocks are blanked by line, then balanced inline backtick runs are replaced by spaces, with unmatched opening runs preserved verbatim. The audit uses it to scan marker positions and heading positions without false positives from markers embedded in code examples.

`maskManualAndCode(text)` is `function maskManualAndCode(text) {`. It first replaces every `lw:manual` region with spaces of equal length, then blanks every line that lives inside a fenced code block, and finally runs the same inline-backtick balancing pass. It returns `{ masked, unclosedFence }`, where `unclosedFence` is `true` when a fence was opened but never closed before end of text. The audit uses the returned `masked` view whenever it needs to scan prose while excluding both manual blocks and code.

## Qualitative audit: per-page scanner and unclosed-code probe

<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v18/_qualitative-audit.mjs#hasUnclosedInlineCode docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v18/_qualitative-audit.mjs#scanModulePage -->

`hasUnclosedInlineCode(text)` is `function hasUnclosedInlineCode(text) {`. It calls `maskManualAndCode(text)` and returns `true` if either `unclosedFence` is set or any backtick survives in the masked output. In effect, this reports whether the page, after manual blocks and fences are ignored, still contains a backtick that would indicate an unclosed inline code span. The audit uses this both as a per-page check and to classify `truncatedEndings` entries with the reason `unclosed_markdown`.

`scanModulePage(file)` is `function scanModulePage(file) {`. It reads the file and returns a per-page record containing: relative path, frontmatter unique-key count, section unique-key count, an `independentCoverageEqual` boolean that compares the sorted unique frontmatter set against the sorted unique section set, lists of frontmatter and section duplicates, indices of `lw:anchors` markers whose visible body between the marker and the next marker or heading is empty after manual blocks and fences are masked out, an `unclosedMarkdown` flag from `hasUnclosedInlineCode`, a `visibleSentinel` flag for the literal prose pattern describing a control-marker omission, and a `todoOrTbdProse` flag for any `TODO`/`TBD` token surviving outside manual blocks and code. The audit then drops any page that fails any of these checks into `failedPageChecks` and fails the `modulePageStructure` gate if that list is non-empty.

## Qualitative audit: aggregate checks

The aggregate gate combines seven booleans computed from the helpers above: `modulePageStructure` (every module page passes `scanModulePage`), `noMissingMmdLinks` (every `.mmd` link in `architecture/overview.md` resolves on disk), `quickstartUsesImportantSymbolsHeading` (`quickstart.md` defines an `Important symbols` H2 and does not define a `Key concepts` H2), `noBenchmarkHelpersInImportantSymbols` (no line in that section mentions benchmark paths, `acceptance-analysis`, `token-proxy`, `.test.ts`, `test/fixtures`, `fase2-repo`, or `sample-ts-repo`), `noDuplicateDiagramDeclarations` (no `.mmd` file declares the same `class:*` or `node:*` twice), `commandsMatchesProcessExitCodeImplementation` (no line in `commands.md` both claims `process.exit(...)` is called and lacks a denial/contrast clause within 80 characters before or 40 after), and `noTruncatedPageEndings` (no module page is classified as `unclosed_markdown` or `empty_body` by the truncation sweep). `overallGate` is `"PASS"` only when all seven are `true`; otherwise `"FAIL"`.

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
<!-- livewiki:navigate:end -->
