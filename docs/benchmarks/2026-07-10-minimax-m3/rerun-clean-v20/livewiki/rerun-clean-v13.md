---
title: Qualitative audit driver for the clean v13 rerun
owner: generated
anchors:
  - docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v13/_qualitative-audit.mjs#walk
  - docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v13/_qualitative-audit.mjs#maskManualAndCode
  - docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v13/_qualitative-audit.mjs#hasUnclosedInlineCode
  - docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v13/_qualitative-audit.mjs#scanModulePage
---

# Qualitative audit driver for the clean v13 rerun

This page is a static, post-hoc audit script that inspects the frozen clean v13 wiki artifact and reports whether the structural regressions observed in clean v7 are still present.

## When to use this page

- **Run** `node _qualitative-audit.mjs <artifactRoot>` after a rerun to write `metrics/qualitative-audit.json` and dump the same JSON to stdout.
- **Inspect** the `checks` block to see whether `modulePageStructure`, `noMissingMmdLinks`, `noBenchmarkHelpersInImportantSymbols`, `noDuplicateDiagramDeclarations`, `noTruncatedPageEndings`, and the quickstart/commands shape checks all passed.
- **Triage** failed pages by reading the per-page `failedPageChecks` entries (duplicates, empty sections, unclosed Markdown, visible sentinel text, unfinished prose flagged by a `\b(?:TODO|TBD)\b` scan) reported alongside the aggregate gate.
- **Skip** this script during normal page generation; it only reads the frozen output and never edits generated pages.

## How it fits

`_qualitative-audit.mjs` lives under `docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v13/` as a standalone Node script that depends on `node:fs` and `node:path` only. It resolves its input from the first CLI argument (defaulting to its own directory), reads a `livewiki/` tree plus a `metrics/` output directory, and is intentionally decoupled from the paid pipeline that produced the artifact. The page documents its four exported helpers in the order they appear in the source so the audit's data flow — directory walk → text masking → per-page structure scan → top-level gate assembly — is easy to follow.

## Directory walking

<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v13/_qualitative-audit.mjs#walk -->

`walk` recursively collects files beneath a directory, optionally filtered by suffix, and returns them sorted.

```js
function walk(dir, suffix) {
```

If `dir` does not exist, it returns an empty array instead of throwing. Each directory entry is recursed into, and files whose name ends with `suffix` (when a suffix is supplied) are accumulated into the result. The truncated excerpt does not establish behavior for symbolic links or other non-`isDirectory` entries beyond what `withFileTypes` exposes.

## Manual-block and code-fence masking

<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v13/_qualitative-audit.mjs#maskManualAndCode -->

`maskManualAndCode` rewrites `lw:manual` regions and fenced code blocks into spaces of equal length so downstream regex probes cannot see their content, and tracks whether a fenced block was left open.

```js
function maskManualAndCode(text) {
```

It first replaces every match of the form `<!--\s*lw:manual\s*-->[\s\S]*?<!--\s*\/lw:manual\s*-->` with a same-length run of spaces, then walks the masked text line by line to blank out anything between an opening fence (3+ backticks or tildes) and its matching close on a new line. A second pass handles backtick-delimited inline code: it locates an opening run of `` ` `` characters, scans for a closing run of identical width, and either replaces the whole span with spaces when paired or preserves the unmatched run when no closing run exists. The function returns `{ masked, unclosedFence }`; `unclosedFence` is `true` whenever the fence state at end-of-input is non-`null`, which is the trigger `hasUnclosedInlineCode` later keys off.

## Inline-code and fence completion check

<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v13/_qualitative-audit.mjs#hasUnclosedInlineCode -->

`hasUnclosedInlineCode` is a thin predicate layered on top of `maskManualAndCode` that flags pages whose visible Markdown still contains an unclosed fence or any stray backtick after manual blocks and code spans have been blanked out.

```js
function hasUnclosedInlineCode(text) {
```

It returns `true` either when `maskManualAndCode` reports `unclosedFence` or when a backtick character still matches the masked output. The call site in the truncated-page-endings loop uses this as the first reason (`unclosed_markdown`) before falling through to a body-emptiness check, so a positive result short-circuits that page without inspecting its body further. The excerpt does not show a `catch` around the underlying `maskManualAndCode` call, so behavior on malformed input relies on the regex passes themselves rather than on a wrapping fallback.

## Per-page structural audit

<!-- lw:anchors docs/benchmarks/2026-07-10-minimax-m3/rerun-clean-v13/_qualitative-audit.mjs#scanModulePage -->

`scanModulePage` reads a generated Markdown file and produces the per-page report that the top-level script aggregates into `failedPageChecks`.

```js
function scanModulePage(file) {
```

It first parses YAML frontmatter with `^---\r?\n([\s\S]*?)\r?\n---`, extracting each `anchors:` list entry as a key. It then collects every `<!--\s*lw:anchors\s+([^>]*?)\s*-->` marker, splits the body between each marker and the next marker or heading, runs `maskManualAndCode` over that slice, and records the marker as `emptySections` when no non-blank, non-standalone-comment lines remain. From those two lists it derives a sorted unique `fmSet` and `sectionSet`, compares them for `independentCoverageEqual`, and also returns the raw duplicates. The remaining fields reuse `hasUnclosedInlineCode` for `unclosedMarkdown`, scan the full text for a visible `[untrusted /lw:... control marker omitted]` sentinel, and run a `\b(?:TODO|TBD)\b` regex against the masked body to surface unfinished prose. The excerpt does not show a wrapping `try/catch`, so a malformed page would surface as an uncaught exception rather than as a graceful per-page failure entry.

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
<!-- livewiki:navigate:end -->
