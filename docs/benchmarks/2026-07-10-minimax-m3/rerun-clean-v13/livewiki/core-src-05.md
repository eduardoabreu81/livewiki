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

The `update` module is the heart of the incremental mode (Phase 5). It builds a focused "work package" the in-session agent consumes to pay documentation debt: manifest snapshot, open debt items, source snippets around each affected symbol, the set of valid anchor keys, and a token estimate. The estimate uses a fixed divisor of `CHARS_PER_TOKEN = 4` (a common heuristic for code/English tokenizers) applied to the JSON-serialized package. A side effect of `loadWorkPackage` is to record a `package_emitted` metric into `.livewiki/update_metrics.json` (idempotent write). Snippet extraction is bounded: a default `SNIPPET_WINDOW` of 20 lines, capped by `opts.maxSnippets` (default 50) to defend against large debt batches.

`snippetForSymbol` reads the source file, then tries a name-based match against common declaration forms (`function`, `class`, `def`, `const`, `export ...`). On miss it falls back to `lookupSymbol`, which queries the SQLite index for the active row keyed by the symbol key and returns the exact 1-indexed `start_line`/`end_line`. If neither resolves, the snippet is anchored at the top of the file so the agent has at least minimal context. The returned `DebtSnippet` adds three lines of context before and after the symbol range.

`recordDocWrittenBack` is the inverse side of the accounting: it logs a `write_received` metric (with `wikiPath`, `bytes`, `tokensEstimated`) so the CLI/skill can report the economy between the emitted package and the doc the agent produced. The `UpdateMetric` type is re-exported for CLI convenience.

## Verify — collectors and link resolution
<!-- lw:anchors packages/core/src/verify.ts#collectWikiPages packages/core/src/verify.ts#collectWikiArtifactPaths packages/core/src/verify.ts#collectSectionSlugs packages/core/src/verify.ts#resolveWikiLink packages/core/src/verify.ts#isInsideWiki -->

`verify.ts` is the wiki-vs-index linter. The collectors are small, stack-based, dotfile-skipping directory walks rooted at `<repoRoot>/livewiki`. `collectWikiPages` enumerates `*.md` files and returns their repo-relative paths with forward slashes. `collectWikiArtifactPaths` widens that to include `*.mmd` diagrams so a class-diagram link can be validated the same way as a page link (extension-driven, not path-driven — a future artifact type only needs one more suffix here). `collectSectionSlugs` reads a page and extracts the slugified heading set used to validate `#section` fragments in links; it delegates the slugification to `slugify` from `./anchors.js`.

`resolveWikiLink` handles the three legal link shapes: (1) `livewiki/foo.md` (absolute in namespace, used as-is), (2) `/foo.md` (absolute from repo root, leading slashes stripped), and (3) `foo.md` / `./foo.md` / `../foo.md` (relative to the directory of the source page, normalized with `path.posix` so `..` resolves correctly). It returns `null` for empty input but never validates existence. `isInsideWiki` is the post-resolution security barrier: it accepts only paths that equal `livewiki` or start with `livewiki/`, so a `../../etc/passwd` style link that resolves outside the namespace is reported (not silently accepted).

## Verify — entry point and human formatter
<!-- lw:anchors packages/core/src/verify.ts#run packages/core/src/verify.ts#formatHuman -->

`run` walks the wiki from disk on every invocation (Fix C: an anchor in a never-indexed page must still be caught — that is the anti-hallucination promise). It opens the SQLite index, builds a `key → SymbolRow` map of active symbols, and loads stored manual-block rows by `doc_page` path. For each discovered page it extracts anchors, then checks every anchor key against the active-symbol set; misses are reported as `broken_anchor`. Stored manual blocks are matched against current hashes via multiset comparison so duplicate preserved blocks are counted correctly and a missing/altered one is detected regardless of offset drift. Links are scanned against a `maskCodeSpans` copy of the source so fenced code blocks and inline backticks (including the 2-backtick delimiter) are not navigated. The link regex accepts `.md` and `.mmd` targets. After resolution, a link that escapes `livewiki/` becomes a `warning` (verify is read-only — it does not block writes). A link to a non-existent artifact is also a `warning`; a `linkSection` that does not match a heading slug becomes a `warning` too. Every `.mmd` discovered is fed through `validateMermaidSyntax`; a rejection becomes an `error` (`invalid_mermaid_diagram`). Finally, `doc_pages` from the DB that are missing on disk become `missing_wiki_path` warnings. `ok` is true iff no `error`-severity issues exist.

`formatHuman` renders a `VerifyResult` as a multi-line string: an `OK`/`FAILED` header with the page count, a summary line of error/warning totals (or `no issues.`), and per-issue `ERROR` / `WARN` rows showing the wiki path, the issue code, and the detail string. The function is exported so CLI and tests can both consume the same rendering.

## Verify — test helpers
<!-- lw:anchors packages/core/src/verify.test.ts#writeCode packages/core/src/verify.test.ts#writeWiki -->

The test suite spins up a fresh `mkdtemp` repoRoot per case and tears it down in `afterEach`. The two helpers, `writeCode` and `writeWiki`, both `mkdir -p` the parent directory and `writeFile` the content at the given relative path; they differ only in name (one represents a code artifact, the other a wiki artifact) so call sites stay readable. They are used to lay out source files for the indexer/ledger and to write wiki pages with anchors, code-span examples, fenced diagrams, and CRLF content for the regression tests that cover code masking, `..` link resolution, and `.mmd` validation.

## Walker — file enumeration
<!-- lw:anchors packages/core/src/walker.ts#EXTENSION_LANG packages/core/src/walker.ts#buildIgnore packages/core/src/walker.ts#walkRepo packages/core/src/walker.test.ts#write -->

The walker is the Phase 1 file enumeration step. `EXTENSION_LANG` is the extension-to-language map for the MVP: `.ts`/`.tsx`/`.js`/`.jsx`/`.mjs`/`.cjs`/`.py` map to `typescript`/`tsx`/`javascript`/`tsx`/`javascript`/`javascript`/`python`. Unknown extensions are skipped.

`buildIgnore` constructs the ignore filter used by the walk. It always layers a hard-coded set of defaults (`.git/`, `node_modules/`, `.livewiki/`, `dist/`, `coverage/`) as defense-in-depth, then attempts to read `<repoRoot>/.gitignore` and add its content (silently ignoring the read failure when no `.gitignore` exists), then appends `opts.extraIgnores` if provided. The returned `ig` is the same kind of predicate the `ignore` npm package exposes.

`walkRepo` is a stack-based recursive walk (no recursion, no callstack blow-up on deep repos). For each directory it `readdir({ withFileTypes: true })` and ignores anything filtered by the `ig` instance. For files it looks up the extension in `EXTENSION_LANG` and, on a hit, pushes a `WalkResult` with the path normalized to forward slashes and the resolved language. Symlinks and entries that are neither file nor directory are silently ignored (documented in the module header). Read errors on a directory are warned and skipped. The final result is sorted by path for stable, diff-friendly output.

The walker test helper, `write`, mirrors the verify suite: it `mkdir -p`s the parent and writes the content (defaulting to an empty string) at the given relative path under the per-test `repoRoot`. It underpins the assertions that the default ignore set covers `node_modules/`, `.git/`, `dist/`, `coverage/`; that a real `.gitignore` is respected; that `extraIgnores` is additive; that results use forward slashes; that ordering is stable; and that files with unrecognized extensions are skipped.