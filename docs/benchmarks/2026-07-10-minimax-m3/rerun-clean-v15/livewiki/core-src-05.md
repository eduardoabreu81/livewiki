---
title: core-src-05
owner: generated
anchors:
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

## Update work package
<!-- lw:anchors packages/core/src/update.ts#CHARS_PER_TOKEN packages/core/src/update.ts#loadWorkPackage packages/core/src/update.ts#snippetForSymbol packages/core/src/update.ts#lookupSymbol packages/core/src/update.ts#recordDocWrittenBack -->

`CHARS_PER_TOKEN` is the exported `4` used to convert the serialized `WorkPackage` size into an estimated token count. `loadWorkPackage(repoRoot, opts)` builds the package delivered to a session agent (or `--llm`): it reads the manifest, runs status to pull `debt.items`, generates snippets for the first `maxSnippets` (default 50) debt items that have a `symbol_key` plus a `wiki_path`, dedupes/sorts the `validAnchors`, serializes to JSON, fills `tokensEstimated` and `bytes`, and finally records a `package_emitted` metric via `recordUpdateMetric` before returning. `snippetForSymbol` reads the file, scans lines for common declaration forms (`function`, `class`, `def`, `const`, plus the `export` variants) to bracket the symbol, and falls back to the SQLite index when the name scan misses; both branches add three lines of context on each side. `lookupSymbol` opens `.livewiki/index.db` and selects `start_line`/`end_line` from `symbols` for an `active` row matching the key. `recordDocWrittenBack(repoRoot, payload)` records the `write_received` counterpart metric (the doc-bytes/tokens actually produced) — distinct from `package_emitted` so the differential tracks whether the package is being compressed into small edits or ballooned back.

## Verify entry and human formatter
<!-- lw:anchors packages/core/src/verify.ts#run packages/core/src/verify.ts#formatHuman -->

`run(repoRoot)` ensures `.livewiki/` exists, opens the index, and reads `activeSymbols` plus per-path `manualBlocksByPath` from `doc_pages`/`manual_blocks`. It walks wiki pages from disk (so freshly written pages with no DB row still surface broken anchors — Fix C), masks code spans to ignore non-navigable links, then for each page: compares page/section anchors against `activeSymbols` (missing key → `broken_anchor` error), diffs the multiset of current manual-block hashes against the stored baseline (any unmatched stored block → `manual_block_altered` error), and validates `[text](file.md|#section)` links — resolving with `path.posix`, rejecting paths that escape the `livewiki/` namespace, and confirming the target artifact plus optional section slug. It also validates every `.mmd` diagram under `livewiki/` via `validateMermaidSyntax`, and reports `missing_wiki_path` for any DB-tracked wiki path absent from disk. The result is `{ ok, pagesChecked, issues }` with `ok` reflecting only error severities. `formatHuman(result)` renders the summary line, the `errors/warnings` count, then per-issue `ERROR`/`WARN` rows of `wikiPath`, code, and detail.

## Verify helpers
<!-- lw:anchors packages/core/src/verify.ts#collectSectionSlugs packages/core/src/verify.ts#collectWikiArtifactPaths packages/core/src/verify.ts#collectWikiPages packages/core/src/verify.ts#isInsideWiki packages/core/src/verify.ts#resolveWikiLink -->

`collectWikiPages` and `collectWikiArtifactPaths` are stack-based directory walks rooted at `livewiki/`, both skipping dot-entries; the former collects `.md` pages with POSIX-style `relPath`, the latter collects `.md` plus `.mmd` artifacts into a `Set` so link targets can be checked extension-agnostically. `collectSectionSlugs` reads the page and applies `slugify` to the text of every `^#{1,6}` heading, returning a `Set` of valid slugs. `resolveWikiLink(fromRelPath, linkRaw)` strips a leading `./`, returns the path unchanged when it already sits in the `livewiki/` namespace, drops a leading `/` for repo-absolute references, and otherwise normalizes `path.posix.join(fromDir, cleaned)` to handle `..` segments. `isInsideWiki(wikiPath)` is the namespace guard: `wikiPath === "livewiki"` or starts with `livewiki/`, used to flag (not block) `../../etc/...`-style escapes as `broken_internal_link` warnings.

## Verify test fixtures
<!-- lw:anchors packages/core/src/verify.test.ts#writeCode packages/core/src/verify.test.ts#writeWiki -->

`writeCode(rel, content)` and `writeWiki(rel, content)` are the two per-test filesystem helpers used by the verify suite; each joins `repoRoot` with `rel`, creates the parent directory recursively, and writes the bytes. They are how each scenario assembles a fresh tmp repo (created in `beforeEach` under `process.env.TMPDIR`/fallback) before invoking the indexer, anchor ledger, and `runVerify`.

## Walker test fixture
<!-- lw:anchors packages/core/src/walker.test.ts#write -->

`write(rel, content = "")` is the per-test helper in `walker.test.ts`; it joins `repoRoot` with `rel`, ensures the parent directory exists with `mkdir({ recursive: true })`, and writes the given content (or empty string). It is the only filesystem primitive the walker tests use to lay out `.ts`/`.py`/`.gitignore`/`.git/HEAD` fixtures inside a per-test tmpdir.

## Walker core
<!-- lw:anchors packages/core/src/walker.ts#EXTENSION_LANG packages/core/src/walker.ts#buildIgnore packages/core/src/walker.ts#walkRepo -->

`EXTENSION_LANG` is the exported extension→lang map (`.ts`→`typescript`, `.tsx`→`tsx`, `.js`/`.mjs`/`.cjs`→`javascript`, `.jsx`→`tsx`, `.py`→`python`). `buildIgnore(repoRoot, opts)` constructs the `ignore` filter: it seeds the always-on defaults `.git/`, `node_modules/`, `.livewiki/`, `dist/`, `coverage/`, then layers the on-disk `.gitignore` if present (read fails silently when absent), then layers `opts.extraIgnores`. `walkRepo(repoRoot, opts)` is a stack-based traversal that pops directories, calls `readdir({ withFileTypes: true })`, converts each entry to a POSIX-style `relPosix` for `ig.ignores`, recurses into directories, and emits `WalkResult { path, lang }` for files whose lowercased extension maps to a known `lang` (unknown extensions are skipped). The list is sorted by `path` before return so output is stable across runs.