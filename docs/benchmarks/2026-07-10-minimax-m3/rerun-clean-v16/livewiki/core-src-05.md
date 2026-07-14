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

## Update — work package emission
<!-- lw:anchors packages/core/src/update.ts#CHARS_PER_TOKEN packages/core/src/update.ts#loadWorkPackage packages/core/src/update.ts#snippetForSymbol packages/core/src/update.ts#lookupSymbol packages/core/src/update.ts#recordDocWrittenBack -->

`packages/core/src/update.ts` implements the incremental mode of `livewiki update`. Given a diff since `lastDocumentedCommit`, it loads the manifest, the open debt, source snippets around each affected symbol, and the list of valid anchor keys — then assembles a focused `WorkPackage` for the in-session agent (or `--llm`) to consume.

`CHARS_PER_TOKEN` is the heuristic used to estimate token size: `Math.ceil(json.length / CHARS_PER_TOKEN)`, with `CHARS_PER_TOKEN = 4` (the standard GPT-tokenizer approximation for English/code).

`loadWorkPackage(repoRoot, opts)` resolves the repo root, reads the manifest, runs the status pipeline for debt items, builds `DebtSnippet`s via `snippetForSymbol`, derives `validAnchors` from the unique symbol_keys in the debt slice, estimates tokens/bytes, and records an idempotent `package_emitted` metric. The snippet window defaults to `SNIPPET_WINDOW = 20` lines and is capped by `opts.maxSnippets` (default 50).

`snippetForSymbol(absRoot, symbolKey, window)` parses `symbolKey` into `filePath#symName`, reads the file, and locates the symbol via a name-based regex sweep (covering `function`, `class`, `def`, `const`, and the `export` variants). If that fails, `lookupSymbol` queries `symbols` (filtered to `status = 'active'`) for exact `start_line`/`end_line`. The returned `DebtSnippet` adds a 3-line context margin on each side.

`lookupSymbol(absRoot, symbolKey)` opens the index DB through `safeIo.resolveAndValidate` and reads the active row for the given key, returning `{ startLine, endLine }` or `null`.

`recordDocWrittenBack(repoRoot, payload)` records a `write_received` metric (separate from `package_emitted`) with `wikiPath`, `bytes`, and `tokensEstimated`. This is the output side of the token-economy metric surfaced via `status --json`. The file also re-exports `UpdateMetric` for CLI consumers.

## Verify — wiki validation
<!-- lw:anchors packages/core/src/verify.ts#run packages/core/src/verify.ts#collectWikiPages packages/core/src/verify.ts#collectWikiArtifactPaths packages/core/src/verify.ts#collectSectionSlugs packages/core/src/verify.ts#resolveWikiLink packages/core/src/verify.ts#isInsideWiki packages/core/src/verify.ts#formatHuman -->

`packages/core/src/verify.ts` checks the wiki against the symbol index. The wiki is always re-read from disk (Fix C) so anchors in never-indexed pages are still validated — this is the anti-hallucination promise for LLM-written docs.

`run(repoRoot)` opens the index DB, builds an active-symbol map from `symbols WHERE status = 'active'`, materialises `doc_pages` and per-path `manual_blocks`, walks the wiki from disk, and for each page extracts page/section anchors and checks them against the active-symbol map. Anchors that reference a missing symbol produce a `broken_anchor` error. Stored manual blocks are matched against the current multiset of hashes (offsets are not identities — multiset matching keeps duplicates correct). Internal `[text](path.md|#section)` links are validated after `maskCodeSpans` removes inline-code and fenced-block content; the link regex accepts `.md` and `.mmd` targets. Mermaid `.mmd` artifacts found under `livewiki/` are parsed by `validateMermaidSyntax` and produce `invalid_mermaid_diagram` errors. `doc_pages` rows that no longer exist on disk produce `missing_wiki_path` warnings. `ok` is true when zero errors remain (warnings don't fail).

`collectWikiPages(absRoot)` is a stack-based walk of `livewiki/` that returns `{ relPath }` entries for `.md` files, skipping dot-prefixed names. The returned paths use forward slashes via `split(nodePath.sep).join("/")`.

`collectWikiArtifactPaths(absRoot)` is the same stack-based walk but accepts both `.md` and `.mmd` files, returning a `Set<string>` of forward-slashed paths. This is the extension-driven allowlist used to validate links to non-page artifacts (diagrams).

`collectSectionSlugs(absRoot, relPath)` reads the page source, applies a `#`–`######` heading regex, and returns the `slugify`'d headings as a `Set<string>` — used to validate `#section` link fragments.

`resolveWikiLink(fromRelPath, linkRaw)` resolves a markdown link to a repo-root-relative path in three forms: (1) `livewiki/...` is used as-is; (2) `/foo.md` strips leading slashes; (3) `./foo.md`, `../foo.md`, or bare `foo.md` are joined to `posix.dirname(fromRelPath)` and `posix.normalize`'d. Returns `null` for empty or non-wiki links.

`isInsideWiki(wikiPath)` is the post-resolution safety check: returns `true` only for paths equal to `livewiki` or prefixed by `livewiki/`. Used to catch `..`-escapes before existence checks.

`formatHuman(result)` renders a `VerifyResult` as a CLI-friendly block: a header line (`OK` or `FAILED` with page count), a summary of `N errors, M warnings` when issues exist, and `ERROR`/`WARN` prefixed lines per issue including `wikiPath`, `[code]`, and `detail`.

## Verify tests — filesystem fixtures
<!-- lw:anchors packages/core/src/verify.test.ts#writeCode packages/core/src/verify.test.ts#writeWiki -->

`packages/core/src/verify.test.ts` sets up a per-test `repoRoot` via `mkdtemp` (Windows TMPDIR fallback included) and tears it down in `afterEach`. The two helpers are identical in shape and only differ in intent:

`writeCode(rel, content)` ensures the parent directory exists, then writes `content` to `repoRoot/rel`. Used for source files (`src/foo.ts`, etc.) before invoking `runIndexer` and `runLedger`.

`writeWiki(rel, content)` does the same for wiki fixtures (`livewiki/foo.md`, `livewiki/diagrams/*.mmd`, etc.). The tests cover broken anchors (symbol missing, file missing), valid anchors, escape attempts via `../../etc/secrets.md`, manual-block preservation (byte-identical stored blocks, missing duplicates, altered blocks), internal-link resolution including `..`-relative paths from `livewiki/architecture/overview.md`, inline-code and fenced-block masking (single, double backtick, CRLF fences, three-backtick and tilde fences), `.mmd` link targets, and `invalid_mermaid_diagram` detection. The `formatHuman` describe covers the `OK` and mixed-severity rendering paths.

## Walker — repo traversal
<!-- lw:anchors packages/core/src/walker.ts#EXTENSION_LANG packages/core/src/walker.ts#buildIgnore packages/core/src/walker.ts#walkRepo -->

`packages/core/src/walker.ts` walks the repository respecting `.gitignore`. Always-ignored defaults (defence in depth, applied even with no `.gitignore`) are `.git/`, `node_modules/`, `.livewiki/`, `dist/`, and `coverage/`. Symlinks are not followed (intentional — they would loop or error and signal odd repo configuration).

`EXTENSION_LANG` is the extension → language map for the MVP: `.ts` → `typescript`, `.tsx` → `tsx`, `.js`/`.mjs`/`.cjs` → `javascript`, `.jsx` → `tsx`, `.py` → `python`. Unknown extensions are skipped, not treated as an error.

`buildIgnore(repoRoot, opts)` constructs the `ignore` instance: seeds the defaults, attempts to read `.gitignore` from the repo root (fail-silent if absent), and appends `opts.extraIgnores` if provided.

`walkRepo(repoRoot, opts)` is the stack-based traversal: each `readdir({ withFileTypes: true })` populates the stack with subdirectories and pushes `WalkResult` entries for files whose extension maps to a known `lang`. All paths emitted are repo-root-relative and use forward slashes (POSIX form even on Windows) so ignore-pattern matching and downstream cross-platform diffs stay stable. The result is sorted by path for deterministic ordering across runs.

## Walker tests — filesystem fixtures
<!-- lw:anchors packages/core/src/walker.test.ts#write -->

`packages/core/src/walker.test.ts` sets up a fresh `repoRoot` via `mkdtemp` in `os.tmpdir()` and tears it down with `rm({ recursive, force })`.

`write(rel, content = "")` is the single fixture helper used by every test in the file: it joins `rel` to `repoRoot`, creates the parent directory tree with `mkdir({ recursive: true })`, and writes the file (default empty). The tests assert that `EXTENSION_LANG` covers the documented extensions, that `walkRepo` returns only indexable files with the right `lang`, that `node_modules/`, `.git/`, `dist/`, and `coverage/` are skipped by default, that `.gitignore` rules are honoured, that `extraIgnores` composes without re-introducing skipped paths, that emitted paths use forward slashes (no backslashes), that ordering is stable (sorted by path), that unknown extensions are skipped, and that the walker functions correctly when no `.gitignore` exists.