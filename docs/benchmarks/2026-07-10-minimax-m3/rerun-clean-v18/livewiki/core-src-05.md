---
title: core-src-05 — update, verify, walker
owner: generated
anchors:
  - packages/core/src/update.test.ts#setupWithAnchor
  - packages/core/src/update.test.ts#writeCode
  - packages/core/src/update.test.ts#writeWiki
  - packages/core/src/update.ts#CHARS_PER_TOKEN
  - packages/core/src/update.ts#loadWorkPackage
  - packages/core/src/update.ts#lookupSymbol
  - packages/core/src/update.ts#recordDocWrittenBack
  - packages/core/src/update.ts#snippetForSymbol
  - packages/core/src/verify.test.ts#writeCode
  - packages/core/src/verify.test.ts#writeWiki
  - packages/core/src/verify.ts#collectSectionSlugs
  - packages/core/src/verify.ts#collectWikiArtifactPaths
  - packages/core/src/verify.ts#collectWikiPages
  - packages/core/src/verify.ts#formatHuman
  - packages/core/src/verify.ts#isInsideWiki
  - packages/core/src/verify.ts#resolveWikiLink
  - packages/core/src/verify.ts#run
  - packages/core/src/walker.test.ts#write
  - packages/core/src/walker.ts#EXTENSION_LANG
  - packages/core/src/walker.ts#buildIgnore
  - packages/core/src/walker.ts#walkRepo
---

## update — incremental work package
<!-- lw:anchors packages/core/src/update.test.ts#setupWithAnchor packages/core/src/update.test.ts#writeCode packages/core/src/update.test.ts#writeWiki packages/core/src/update.ts#CHARS_PER_TOKEN packages/core/src/update.ts#loadWorkPackage packages/core/src/update.ts#recordDocWrittenBack -->

The `update` module emits a focused "work package" for the agent to pay documentation debt without re-reading the entire repository. The thesis: a small package (~800 tokens) replaces a full-repo re-read (~12.5k tokens).

`CHARS_PER_TOKEN` (export) is the default token estimation heuristic (`= 4`), reflecting the approximate ~4 chars/token ratio for code/English text. `loadWorkPackage` (export) returns a `WorkPackage` containing the manifest view (or `null` if the repo was never initialized), the open debt items, source snippets for each debt entry with a `symbol_key`, the subset of `validAnchors` (sorted, deduplicated active symbol keys limited to debt), and `tokensEstimated` / `bytes` accounting. It also records a `package_emitted` metric as a side effect. `recordDocWrittenBack` (export) registers a `write_received` metric once the agent (or human) finishes a doc update, feeding the `efficiencyRatio` accounting.

Test helpers in `update.test.ts` are minimal filesystem shims: `writeCode` writes a source file (creating parent dirs), `writeWiki` writes a wiki file (also creating parent dirs), and `setupWithAnchor` provisions a repo with a wiki page that already anchors `src/foo.ts#bar` — without that prior anchor, the ledger cannot detect change as debt.

## update — snippet resolution
<!-- lw:anchors packages/core/src/update.ts#snippetForSymbol packages/core/src/update.ts#lookupSymbol -->

`snippetForSymbol` (internal) reads the current source for the anchor's `filePath`, splits into lines, and tries a name-based regex sweep (`function name`, `class name`, `def name`, `const name`, plus their `export` variants) to locate the symbol's `symStart` / `symEnd`. If that sweep misses, it falls back to `lookupSymbol`, which queries the SQLite index for `start_line` / `end_line` of an `active` symbol with the matching `key`. If both strategies fail, it returns a minimal window anchored at line 0. The final snippet adds 3 lines of context before and after, prefixed with 1-indexed line numbers, and returns `null` only when the file itself cannot be read.

## verify — wiki integrity checker
<!-- lw:anchors packages/core/src/verify.ts#run packages/core/src/verify.ts#formatHuman packages/core/src/verify.ts#collectWikiPages packages/core/src/verify.ts#collectWikiArtifactPaths packages/core/src/verify.ts#collectSectionSlugs packages/core/src/verify.ts#isInsideWiki packages/core/src/verify.ts#resolveWikiLink packages/core/src/verify.test.ts#writeCode packages/core/src/verify.test.ts#writeWiki -->

`run` (export) walks the wiki from disk (never relying solely on `doc_pages` from the DB, so freshly-written pages are still validated per the anti-hallucination promise in Fix C). It opens the index to read the active symbol map and the baseline manual-blocks hashes, then for every wiki page it extracts anchors, validates each anchor's `key` against the active symbols (`broken_anchor` issue), and compares the multiset of manual-block hashes against the stored baseline using multiset matching so duplicate preserved blocks count correctly (`manual_block_altered` issue).

Internal link validation uses `resolveWikiLink` to normalize three link shapes against the current page's directory: an explicit `livewiki/...` path, a repo-root-absolute `/foo.md`, or a page-relative `./foo.md` / `../foo.md` / `foo.md`. The result is then checked with `isInsideWiki` (must stay under the `livewiki/` namespace; otherwise it's reported as a `broken_internal_link` warning — verify is read-only, so it never blocks) and against `existingArtifactPaths` (covers both `.md` pages and `.mmd` diagrams, so an overview link to a Mermaid class diagram is checked the same way as a page link). If a `#section` fragment is present, the page's section slug set is gathered with `collectSectionSlugs` and the fragment is validated against it. Links inside fenced code blocks and inline code spans are masked out before the link regex runs — they are syntax examples, not navigable references. `formatHuman` (export) renders a `VerifyResult` as a human-readable string.

`verify.test.ts` mirrors the same test plumbing pattern with its own local `writeCode` and `writeWiki` helpers writing into a `mkdtemp` root.

## walker — gitignore-aware repo traversal
<!-- lw:anchors packages/core/src/walker.ts#EXTENSION_LANG packages/core/src/walker.ts#buildIgnore packages/core/src/walker.ts#walkRepo packages/core/src/walker.test.ts#write -->

`walkRepo` (export) recursively enumerates files under `repoRoot` and returns `WalkResult[]` with relative paths (always forward-slash, cross-platform) and the inferred `lang`. The traversal is iterative (stack-based) to avoid blowing the call stack on deep repos, and uses `readdir({ withFileTypes: true })` so each directory is read in a single syscall. Symlinks and non-file/non-directory entries are intentionally skipped — the module header documents this as a deliberate scope decision.

`buildIgnore` (internal) constructs the ignore filter by combining a hard-coded default set (`.git/`, `node_modules/`, `.livewiki/`, `dist/`, `coverage/`) with the repo's `.gitignore` (read silently — missing file is fine) and any `opts.extraIgnores`. `EXTENSION_LANG` (export) is the static extension-to-language map covering `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, and `.py`; files whose extension is not in the map are skipped. The output is sorted by path so two runs against the same tree are byte-identical.

`walker.test.ts` uses a single `write` helper (no separate `writeCode` / `writeWiki` distinction, since walker tests don't care about file content) and verifies the default ignore set, `.gitignore` honoring, `extraIgnores` layering, stable ordering, forward-slash paths, and that extension-unknown files (`.txt`, `.json`, `.png`) are dropped.