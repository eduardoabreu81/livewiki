---
title: Qualitative audit runner for rerun-clean-v19
owner: generated
anchors:
  - docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v19/_qualitative-audit.mjs#hasUnclosedInlineCode
  - docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v19/_qualitative-audit.mjs#maskManualAndCode
  - docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v19/_qualitative-audit.mjs#maskStructuralCode
  - docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v19/_qualitative-audit.mjs#scanModulePage
  - docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v19/_qualitative-audit.mjs#walk
---

# Qualitative audit runner for rerun-clean-v19

This audit node statically inspects the frozen clean v19 livewiki artifact for the specific regressions found in clean v7 and emits a `qualitative-audit-corrected.json` report plus a JSON dump on stdout.

## When to use this page
- **Reproduce** the qualitative gate by running `node _qualitative-audit.mjs <artifactRoot>` against the frozen artifact directory.
- **Diagnose** a failing `modulePageStructure`, `noTruncatedPageEndings`, or `commandsMatchesProcessExitCodeImplementation` check by mapping the failing page to the relevant masker.
- **Audit** which Markdown files the script classifies as module pages versus the `quickstart.md` / `architecture/overview.md` layout exemptions.
- **Extend** the audit by adding a new probe inside `scanModulePage` while keeping the output schema stable.

## How it fits

The audit lives under `docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v19/_qualitative-audit.mjs`. It is intentionally independent of the paid pipeline: it reads the frozen artifact under `<artifactRoot>/livewiki` and writes only to `<artifactRoot>/metrics/qualitative-audit-corrected.json`. The script walks the wiki tree, partitions files into module pages and layout pages, runs per-page structural checks plus diagram, quickstart, and commands-page cross-checks, and aggregates the results into a single gate object whose `overallGate` is `PASS` only when every named check is true.

## Directory discovery

<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v19/_qualitative-audit.mjs#walk -->

The `walk` function returns the sorted list of files under `dir` whose names end with `suffix`:

```js
function walk(dir, suffix) {
```

`walk` returns an empty array when `dir` does not exist, recurses into subdirectories, and otherwise appends each regular entry whose `entry.name` ends with `suffix`. The two later `walk(wikiRoot, ".md")` and `walk(wikiRoot, ".mmd")` calls drive both the Markdown page audit and the duplicate-declaration scan. Because the function never filters out hidden files or non-regular entries beyond the `isDirectory` branch, the caller relies on the directory contents already being a sane tree.

The module-page partition subtracts `quickstart.md` and `architecture/overview.md` from the Markdown list, so every other `.md` file is treated as a module page and fed to `scanModulePage`.

## Markdown code masking

<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v19/_qualitative-audit.mjs#maskStructuralCode docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v19/_qualitative-audit.mjs#maskManualAndCode docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v19/_qualitative-audit.mjs#hasUnclosedInlineCode -->

Two length-preserving maskers prepare the file text so that structural regexes do not false-match inside code regions:

```js
function maskStructuralCode(text) {
```

`maskStructuralCode` tracks a 3-backtick-fence state and replaces the contents of any opened-but-not-closed fence — and every matched inline `` ` `` run whose opening width equals a later run — with spaces of equal length. The remaining non-code text is returned untouched. The fence scanner recognizes both `` ``` `` and `~~~` openers and only closes on a line whose leading run is at least as long as the opener and contains no other characters besides optional surrounding whitespace.

```js
function maskManualAndCode(text) {
```

`maskManualAndCode` first substitutes every `<!-- lw:manual … -->` … `<!-- /lw:manual -->` range with spaces of the same length so reserved human content cannot leak into structural scans, then drops fenced code blocks to empty lines, then performs the same inline `` ` `` pairing pass as `maskStructuralCode`. It returns `{ masked, unclosedFence }`; the latter flag is `true` when a code fence was opened but never matched its closing line.

```js
function hasUnclosedInlineCode(text) {
```

`hasUnclosedInlineCode` returns `true` when `maskManualAndCode` reports an `unclosedFence` OR when any backtick remains in the masked string (meaning an inline `` ` `` run had no matching closing run). `scanModulePage` uses this for `unclosedMarkdown`, and the page-ending loop uses it as an early exit to flag files whose body ends with an unclosed code span or fence.

## Per-page structural audit

<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v19/_qualitative-audit.mjs#scanModulePage -->

```js
function scanModulePage(file) {
```

`scanModulePage` reads the file, runs `maskStructuralCode` to obtain the code-blind view, and returns a diagnostic record with the following fields:

- `frontmatterCount` and `sectionCount`: sizes of the deduplicated, sorted `anchors` list parsed from the YAML frontmatter (`anchors:` followed by `  - <key>` lines) and the union of keys from every `<!-- lw:anchors … -->` marker in the body, each parsed only inside its own scope.
- `independentCoverageEqual`: `true` iff the JSON serialization of those two sorted sets is identical — i.e. the frontmatter `anchors:` list and the body `lw:anchors` markers each contain every closed-list key exactly once, with no extras.
- `frontmatterDuplicates` and `sectionDuplicates`: each lists any key appearing more than once in its own list (after `.indexOf !== index` filtering, then deduped via `new Set`).
- `emptySections`: a list of marker offsets whose trailing body — until the next marker or heading, whichever comes first — contains only whitespace lines or single-line HTML comments, per the visible-line test that trims and filters empty lines and `<!-- … -->` only-lines.
- `unclosedMarkdown`: forwarded from `hasUnclosedInlineCode(text)`.
- `visibleSentinel`: `true` when the document contains the literal text matching `\[untrusted\s+\/?lw:[^\]]+control marker omitted\]`, which is a leak of the orchestrator's neutralization note into the rendered page.
- `todoOrTbdProse`: `true` when `\b(?:TODO|TBD)\b` appears in the `maskManualAndCode`-masked text, so occurrences inside code fences or reserved manual blocks do not count.

A page ends up in `failedPageChecks` when **any** of those flags is non-empty/`false`, and the `modulePageStructure` gate fails unless every module page passes. The excerpt does not show what happens when the YAML `anchors` line is followed by an inline `[a, b]` array instead of `  - ` lines — that branch is handled by the regex's `match` returning `null` and contributes `fmSet = []`.

## Cross-page checks

The post-`scanModulePage` loop runs several additional gates against specific well-known paths in the wiki root:

- `missingMmdLinks`: from `architecture/overview.md`, every `[…](<path>.mmd)` link whose resolved target does not exist; `noMissingMmdLinks` passes only when the list is empty.
- `quickstartUsesImportantSymbolsHeading`: requires `^## Important symbols$` to be present and `^## Key concepts$` absent in `quickstart.md`. `noBenchmarkHelpersInImportantSymbols` then filters the body of the `Important symbols` section through a regex matching `docs/benchmarks`, `acceptance-analysis`, `token-proxy`, `.test.ts`, `test/fixtures`, `fase2-repo`, or `sample-ts-repo`; any hit is a failure.
- `noDuplicateDiagramDeclarations`: for every `.mmd` file under the wiki root, collect `class:<id>` from lines matching `^\s*class <id>\s|\[|\{` and `node:<id>` from lines matching `^\s<id>\[…\]$`, then surface any value that appears more than once in that file.
- `commandsMatchesProcessExitCodeImplementation`: in `commands.md`, every non-empty line that matches `claimsProcessExit` and does not match `deniesOrContrastsProcessExit` is collected as a contradiction; the gate passes only when the list is empty. The denial/contrast regex allows phrases such as "never calls `process.exit`" or "rather than … using `process.exit`" to suppress a line.
- `noTruncatedPageEndings`: every module page that either trips `hasUnclosedInlineCode` (logged with `reason: "unclosed_markdown"` and skipped for further checks) **or** has no non-blank lines after the frontmatter (logged with `reason: "empty_body"`) is a failure.

## Output

The script composes `output = { overallGate, checks, modulePagesChecked, failedPageChecks, missingMmdLinks, quickstartUsesImportantSymbols, quickstartUsesKeyConcepts, benchmarkHelpersInImportantSymbols, duplicateDiagramDeclarations, commandsContradiction, truncatedEndings }`. `overallGate` is `PASS` iff every entry in `checks` is truthy. Both `metrics/qualitative-audit-corrected.json` and stdout receive `JSON.stringify(output, null, 2) + "\n"`.

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
<!-- livewiki:navigate:end -->
