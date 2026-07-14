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

## Update — work package construction

<!-- lw:anchors packages/core/src/update.ts#CHARS_PER_TOKEN packages/core/src/update.ts#loadWorkPackage packages/core/src/update.ts#snippetForSymbol packages/core/src/update.ts#lookupSymbol packages/core/src/update.ts#recordDocWrittenBack -->

`update.ts` is the incremental engine of `livewiki`. It assembles a `WorkPackage` for an in-session agent: manifest snapshot, open debt items, source snippets around each debt symbol, and the subset of active symbol keys the agent is allowed to anchor on. It never invokes an LLM.

`CHARS_PER_TOKEN` is the constant `4`, used as the chars-per-token heuristic for the package size estimate. The estimate is computed from the JSON length of the serialized `WorkPackage` and is stored on the `tokensEstimated` and `bytes` fields.

`loadWorkPackage(repoRoot, opts?)` resolves the repo root, reads the manifest (via `readManifest`), gathers debt from `runStatus(absRoot).debt.items`, then iterates up to `opts.maxSnippets ?? 50` debt items with a defined `symbol_key` and `wiki_path`, calling `snippetForSymbol` for each. Valid anchor keys are the deduped, sorted set of debt symbol keys. The package is stringified once to fill `tokensEstimated` and `bytes`, then `recordUpdateMetric(absRoot, { kind: "package_emitted", ... })` is invoked as a side effect (idempotent write to `.livewiki/update_metrics.json`).

`snippetForSymbol(absRoot, symbolKey, window)` splits the symbol key into `filePath#symName`, reads the file (returns `null` on read failure), and locates the symbol by a name-based regex scan over lines. If the scan misses, it falls back to `lookupSymbol` for indexed `startLine`/`endLine`; if both miss, it uses the first `window` lines of the file as minimal context. The returned window is `±3` lines around the symbol, prefixed with 1-indexed line numbers.

`lookupSymbol(absRoot, symbolKey)` resolves the safe DB path via `safeIo.resolveAndValidate`, opens the index with `openIndex`, and runs `SELECT start_line, end_line FROM symbols WHERE key = ? AND status = 'active'`. Returns `{ startLine, endLine }` or `null`. The DB handle is always closed in `finally`.

`recordDocWrittenBack(repoRoot, payload)` is the symmetric helper for agent output accounting. It writes a `kind: "write_received"` metric (with `wikiPath`, `bytes`, `tokensEstimated`) via `recordUpdateMetric`. The difference between `package_emitted` and `write_received` measures whether a large package produced a small doc (good economy) or a large one.

## Verify test fixtures

<!-- lw:anchors packages/core/src/verify.test.ts#writeCode packages/core/src/verify.test.ts#writeWiki -->

`writeCode(rel, content)` creates a temp repo in `beforeEach` (via `mkdtemp` under `TMPDIR`) and writes a source file at the given repo-relative path, creating intermediate directories. It is the fixture used to populate source for the indexer/ledger in the verify tests.

`writeWiki(rel, content)` is the parallel fixture for wiki pages. It writes under `livewiki/` paths and is used to set up frontmatter-anchored Markdown, broken-link scenarios, manual blocks, and `.mmd` diagrams. Both fixtures are torn down by `afterEach`'s recursive `rm` of `repoRoot`.

## Verify — orchestration

<!-- lw:anchors packages/core/src/verify.ts#run packages/core/src/verify.ts#formatHuman -->

`run(repoRoot)` opens the index DB, builds an active-symbol map and a `manualBlocksByPath` map keyed by wiki path, then walks the wiki from disk (not from `doc_pages`) so newly written pages are caught without re-indexing. For each `.md` page it extracts anchors, then emits `broken_anchor` (error) for any anchor whose key is not in the active-symbol map — including anchors on never-indexed pages, per the anti-hallucination guarantee. It then compares the multiset of stored manual-block hashes against the hashes of the current `extracted.manualBlocks` slices; any unmatched stored block raises `manual_block_altered` (error). Internal links are scanned after `maskCodeSpans` removes inline-code and fenced-block regions; each link is resolved via `resolveWikiLink`, then `isInsideWiki` decides whether it escaped the namespace. `.mmd` diagrams are then validated by `validateMermaidSyntax`. Finally, `doc_pages` that no longer exist on disk produce `missing_wiki_path` (warning). The function returns `{ ok: errors.length === 0, pagesChecked, issues }` and always closes the DB in `finally`.

`formatHuman(result)` is the CLI-facing formatter. It prints `OK`/`FAILED`, the pages-checked count, then errors-then-warnings with `[code]` prefixes. Tests pin the exact substrings `OK`, `3 pages`, `no issues`, `FAILED`, `1 errors`, `1 warnings`, `ERROR`, and `WARN`.

## Verify — disk walkers and link safety

<!-- lw:anchors packages/core/src/verify.ts#collectWikiPages packages/core/src/verify.ts#collectWikiArtifactPaths packages/core/src/verify.ts#collectSectionSlugs packages/core/src/verify.ts#resolveWikiLink packages/core/src/verify.ts#isInsideWiki -->

`collectWikiPages(absRoot)` is an iterative DFS over `livewiki/`. It skips dotfiles, recurses into directories, and emits a `{ relPath }` for every `.md` file with forward-slash relative paths. Read failures are swallowed per-directory.

`collectWikiArtifactPaths(absRoot)` mirrors the same walk but emits a `Set<string>` of paths for both `.md` and `.mmd` files. The set is the existence check for link resolution — extensions, not directory layout, decide what is a checkable target.

`collectSectionSlugs(absRoot, relPath)` reads the page and applies the heading regex `/^(#{1,6})\s+(.+?)\s*$/gm`, slugifying each captured heading via `slugify` into a `Set<string>`. The set drives section-anchor validation for `[text](page.md#section)` links.

`resolveWikiLink(fromRelPath, linkRaw)` strips a leading `./`, then handles three forms: a `livewiki/`-prefixed absolute path, a `/foo.md` repo-rooted absolute path, and a relative path joined with `nodePath.posix.dirname(fromRelPath)` and normalized via `nodePath.posix.normalize`. Returns `null` for empty input; never validates existence.

`isInsideWiki(wikiPath)` is the namespace fence: returns `true` only for `wikiPath === "livewiki"` or paths starting with `livewiki/`. It runs after `resolveWikiLink` so a malicious `../../etc/passwd` resolves to something outside the namespace and is reported as a `broken_internal_link` warning rather than silently accepted.

## Walker — filesystem traversal

<!-- lw:anchors packages/core/src/walker.ts#EXTENSION_LANG packages/core/src/walker.ts#buildIgnore packages/core/src/walker.ts#walkRepo -->

`EXTENSION_LANG` is the extension-to-language map for the MVP: `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.py`. Any file without one of these extensions is skipped during the walk.

`buildIgnore(repoRoot, opts)` constructs an `ignore()` instance seeded with the depth-in-defense defaults `.git/`, `node_modules/`, `.livewiki/`, `dist/`, `coverage/`, then layered with the repo's `.gitignore` (silently skipped if absent), then with `opts.extraIgnores`. The returned filter is what `walkRepo` consults on each entry.

`walkRepo(repoRoot, opts?)` is a stack-based DFS that skips dotfile-ignored entries by `ig.ignores(relPosix)`. Directories are pushed to the stack; files with a recognized extension are pushed to `out` as `{ path, lang }`. Permission or vanishing-directory errors on `readdir` log a warning and skip the directory. Symlinks are not followed. The result is sorted by `path` for deterministic diffs across runs. Paths use forward slashes regardless of platform.

## Walker test fixtures

<!-- lw:anchors packages/core/src/walker.test.ts#write -->

`write(rel, content = "")` is the walker test's per-case fixture. It `mkdir -p`s the parent and writes the file at the given repo-relative path under a `mkdtemp`-created root. Tests cover: TS/Python extension recognition, default ignores (`node_modules/`, `.git/`, `dist/`, `coverage/`), `.gitignore` respect, `extraIgnores` layering over `.gitignore`, forward-slash paths, stable sort order, unknown-extension skipping, and walk correctness in a fresh repo with no `.gitignore`.