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

## update.ts — incremental package
<!-- lw:anchors packages/core/src/update.ts#CHARS_PER_TOKEN packages/core/src/update.ts#loadWorkPackage packages/core/src/update.ts#snippetForSymbol packages/core/src/update.ts#lookupSymbol packages/core/src/update.ts#recordDocWrittenBack -->

`CHARS_PER_TOKEN` is the default token heuristic: `4` chars per token, matching the common code/EN assumption documented in the module header.

`loadWorkPackage` assembles the `WorkPackage` consumed by the `livewiki update` skill: it reads the manifest via `readManifest`, pulls debt items from `status.run`, builds snippets per debt item, computes the sorted `validAnchors` set, serializes the package to JSON to estimate `tokensEstimated` and `bytes`, and records a `package_emitted` metric (idempotent write to `.livewiki/update_metrics.json`).

`snippetForSymbol` reads the file referenced by a debt item's `symbol_key` and slices a window of lines around the symbol. It first attempts a textual match on `function|class|def|const|export … <name>` declarations; on miss it falls back to `lookupSymbol` to read `start_line`/`end_line` from the index; on a second miss it falls back to the first `window` lines of the file so the agent still has minimal context.

`lookupSymbol` opens `.livewiki/index.db` (resolved and validated through `safe-io`) and returns `startLine`/`endLine` for the active row matching `symbolKey`, or `null`.

`recordDocWrittenBack` is the `kind: "write_received"` counter, written via `recordUpdateMetric`. It tracks the bytes and estimated tokens of the doc the agent (or human) wrote back, feeding the economy metric (`pacote grande → doc pequena = boa economia`).

## verify.test.ts — helpers
<!-- lw:anchors packages/core/src/verify.test.ts#writeCode packages/core/src/verify.test.ts#writeWiki -->

`writeCode` writes a file under `repoRoot/<rel>` after `mkdir -p` on its parent — used to drop source files (`src/foo.ts`) under a temporary repo root created by `mkdtemp` before each verify test.

`writeWiki` is the same `mkdir -p` + `writeFile` helper, used for markdown wiki pages under `livewiki/`. The two helpers share identical shape; their split keeps test intent readable (`writeCode` vs `writeWiki`).

## verify.ts — wiki validation
<!-- lw:anchors packages/core/src/verify.ts#run packages/core/src/verify.ts#collectWikiPages packages/core/src/verify.ts#collectWikiArtifactPaths packages/core/src/verify.ts#collectSectionSlugs packages/core/src/verify.ts#resolveWikiLink packages/core/src/verify.ts#isInsideWiki packages/core/src/verify.ts#formatHuman -->

`run` is the entry point. It opens the index DB, builds an `activeSymbols` map, loads stored manual-block baselines by `doc_pages`, walks the wiki from disk (Fix C: never trust `doc_pages` for "freshly written" detection), and per page checks: page/section anchors against active symbols, byte-level preservation of stored manual blocks (matched as multisets of hashes so duplicates are counted correctly), and internal links after `maskCodeSpans` strips code fences and inline code. Mermaid diagrams are validated separately. Pages in `doc_pages` that vanished from disk emit `missing_wiki_path`. The result's `ok` is `true` iff there are zero error-severity issues.

`collectWikiPages` does a stack-based recursive walk under `livewiki/`, skipping dotfiles and returning only `.md` files with forward-slash relative paths.

`collectWikiArtifactPaths` mirrors that walk but also includes `.mmd` diagrams in the existence set — extension-driven, so a future artifact type only needs one more suffix appended. This set is what link validation consults when deciding whether a target resolves.

`collectSectionSlugs` reads the page and collects the slugified titles of its headings (1–6 `#`) via `slugify`, used to validate `[text](page.md#section)` links.

`resolveWikiLink` normalizes a markdown link target against `fromRelPath`:
- (1) `livewiki/...` or `livewiki` → used as-is (absolute in the wiki namespace).
- (2) `/foo.md` → stripped to `foo.md` (absolute at repo root).
- (3) `./`, `../`, or bare names → `posix.normalize(posix.join(fromDir, cleaned))`.

It returns `null` for inputs it cannot interpret (e.g. empty after `./` stripping). It does not validate existence or namespace containment — those are downstream checks.

`isInsideWiki` is the namespace barrier: returns `true` iff the resolved path equals `livewiki` or starts with `livewiki/`. Anything else (e.g. `../../etc/passwd`) becomes a `broken_internal_link` warning rather than a hard error.

`formatHuman` renders a `VerifyResult` as plain text: a status line (`OK`/`FAILED` + page count), then error/warning counts, then per-issue `ERROR`/`WARN` lines `[code] detail`. It is also covered by direct unit tests for both the OK and mixed-severity shapes.

## walker.ts — repo traversal
<!-- lw:anchors packages/core/src/walker.ts#EXTENSION_LANG packages/core/src/walker.ts#buildIgnore packages/core/src/walker.ts#walkRepo -->

`EXTENSION_LANG` maps file extensions to language tags for the MVP: `.ts`→`typescript`, `.tsx`→`tsx`, `.js`/`.mjs`/`.cjs`→`javascript`, `.jsx`→`tsx`, `.py`→`python`. Files with extensions outside this map are skipped during the walk.

`buildIgnore` constructs the `ignore` filter in three layers: hard defaults (`.git/`, `node_modules/`, `.livewiki/`, `dist/`, `coverage/`) for defense in depth, then the repo's `.gitignore` if present (silent fallback otherwise), then any `opts.extraIgnores`. The `.livewiki/` default matters because that directory is generated by livewiki itself and would otherwise pollute index results.

`walkRepo` is a stack-based recursive walk over `repoRoot`. For each entry it computes the repo-relative `posix` path, asks the ignore filter, recurses into directories, and pushes `{ path, lang }` for files whose extension is in `EXTENSION_LANG`. Symlinks are ignored (header-documented). Output is sorted by path for stable diffs between runs; tests assert that ordering, the forward-slash shape on Windows, and the layered ignore behavior.

## walker.test.ts — helper
<!-- lw:anchors packages/core/src/walker.test.ts#write -->

`write` is the test fixture: `mkdir -p` on the parent of `repoRoot/<rel>` followed by `writeFile` with a default empty body. It is the single helper used to seed the temporary repo root in every `walkRepo` test case.