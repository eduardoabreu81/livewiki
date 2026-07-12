---
title: core-src-04
owner: generated
anchors:
  - packages/core/src/safe-io.ts#ALLOWED_DIRS
  - packages/core/src/safe-io.ts#InvalidRelativePathError
  - packages/core/src/safe-io.ts#InvalidRelativePathError.constructor
  - packages/core/src/safe-io.ts#PathOutsideAllowlistError
  - packages/core/src/safe-io.ts#PathOutsideAllowlistError.constructor
  - packages/core/src/safe-io.ts#allowedAbs
  - packages/core/src/safe-io.ts#allowlistFor
  - packages/core/src/safe-io.ts#exists
  - packages/core/src/safe-io.ts#findDeepestExisting
  - packages/core/src/safe-io.ts#isInsideAllowlist
  - packages/core/src/safe-io.ts#mkdir
  - packages/core/src/safe-io.ts#readText
  - packages/core/src/safe-io.ts#remove
  - packages/core/src/safe-io.ts#resolveAndValidate
  - packages/core/src/safe-io.ts#validateDeclared
  - packages/core/src/safe-io.ts#writeText
  - packages/core/src/update.ts#CHARS_PER_TOKEN
  - packages/core/src/update.ts#loadWorkPackage
  - packages/core/src/update.ts#lookupSymbol
  - packages/core/src/update.ts#recordDocWrittenBack
  - packages/core/src/update.ts#snippetForSymbol
---

# core-src-04

## Safe I/O allowlist and path validation
<!-- lw:anchors packages/core/src/safe-io.ts#ALLOWED_DIRS packages/core/src/safe-io.ts#InvalidRelativePathError packages/core/src/safe-io.ts#InvalidRelativePathError.constructor packages/core/src/safe-io.ts#PathOutsideAllowlistError packages/core/src/safe-io.ts#PathOutsideAllowlistError.constructor packages/core/src/safe-io.ts#allowlistFor packages/core/src/safe-io.ts#allowedAbs packages/core/src/safe-io.ts#exists packages/core/src/safe-io.ts#findDeepestExisting packages/core/src/safe-io.ts#isInsideAllowlist packages/core/src/safe-io.ts#mkdir packages/core/src/safe-io.ts#readText packages/core/src/safe-io.ts#remove packages/core/src/safe-io.ts#resolveAndValidate packages/core/src/safe-io.ts#validateDeclared packages/core/src/safe-io.ts#writeText -->

The `safe-io` module is the only authorizer for disk writes. Every write must pass through it; no exceptions, not even in tests.

`ALLOWED_DIRS` is the const tuple `["livewiki", ".livewiki"]` and forms the basis of the allowlist. `PathOutsideAllowlistError` is thrown when a target path is outside the allowlist; the `PathOutsideAllowlistError.constructor` records `repoRoot`, `attempted`, and the `allowlist`. `InvalidRelativePathError` flags malformed relative inputs (absolute paths, `..` segments); the `InvalidRelativePathError.constructor` receives the path and a `reason`.

`allowlistFor` returns the effective allowlist for the given `SafeIoOptions`. When `allowPointer` is true, `AGENTS.md` and `CLAUDE.md` at the repo root are appended. `allowedAbs` resolves a permitted directory to an absolute path inside `repoRoot`, throwing if it would escape. `isInsideAllowlist` performs a pure (no-disk) prefix-by-separator check so that `livewiki-evil` is not matched as inside `livewiki/`.

`validateDeclared` rejects absolute paths and `..` segments before computing the target. `findDeepestExisting` walks up from the target to the deepest existing ancestor so callers can `realpath` it. `resolveAndValidate` performs the full declared-then-revalidate dance against symlinks by re-checking the allowlist after `realpath`.

`writeText`, `readText`, `mkdir`, `exists`, and `remove` are the file-system operations gated by `safe-io`; each routes its path through `resolveAndValidate` so symlink-escape attacks (`livewiki` → `/tmp`, `livewiki/sub` → `../src`, `livewiki/leaf` → `/etc/x`) are rejected.

## Status report
<!-- lw:anchors packages/core/src/status.ts#run packages/core/src/status.ts#collect packages/core/src/status.ts#formatHuman -->

`run` opens the index DB, calls `collect` to assemble file counts, symbol kinds, top-N files, open debt items, and undocumented samples, then attaches an incremental metrics snapshot. `collect` runs SQL aggregations against `files`, `symbols`, `debt`, `anchors`, `doc_pages`, and `undocumented`. `formatHuman` renders the report as multi-line text for terminal output.

## Symbol extraction
<!-- lw:anchors packages/core/src/symbols.ts#extractSymbols packages/core/src/symbols.ts#walkNode packages/core/src/symbols.ts#makeRecord packages/core/src/symbols.ts#signatureFor packages/core/src/symbols.test.ts#parse -->

`extractSymbols` walks a tree-sitter tree via `walkNode` and emits `SymbolRecord`s. `walkNode` dispatches on node type: `function_declaration` and `generator_function_declaration` emit `kind=function`, `class_declaration`/`class` emit `kind=class` and recurse into methods with `parentClassName` set, `method_definition` qualifies as `Parent.name` with `kind=method`, and `export_statement` collapses to the underlying declaration (one entry, not duplicated) — except `export const`, which emits `kind=export`. `makeRecord` builds a `SymbolRecord` with a slice-based `content_hash` via `sha256Slice`. `signatureFor` returns the first line of the node as a header signature, or `null` if the source is unavailable.

`symbols.test.ts#parse` is the test helper that forwards an extension and source to `parseSource`, used across the TypeScript and Python symbol cases.

## Update workflow and token accounting
<!-- lw:anchors packages/core/src/update.ts#CHARS_PER_TOKEN packages/core/src/update.ts#loadWorkPackage packages/core/src/update.ts#lookupSymbol packages/core/src/update.ts#recordDocWrittenBack packages/core/src/update.ts#snippetForSymbol packages/core/src/update-metrics.ts#clearMetricsForTests packages/core/src/update-metrics.ts#metricsPath packages/core/src/update-metrics.ts#readMetrics packages/core/src/update-metrics.ts#recordUpdateMetric packages/core/src/update-metrics.ts#snapshotMetrics packages/core/src/update-metrics.ts#writeMetrics packages/core/src/update.test.ts#setupWithAnchor packages/core/src/update.test.ts#writeCode packages/core/src/update.test.ts#writeWiki -->

`CHARS_PER_TOKEN` is the constant `4`, the heuristic used to estimate package size from character count. `loadWorkPackage` reads the manifest, queries open debt through `status.run`, builds snippets for each debt symbol, computes `validAnchors`, and records a `package_emitted` metric. `snippetForSymbol` loads the current source and returns a bounded window (default ±20 lines) around `start_line`. `lookupSymbol` resolves a `symbol_key` against the active symbol set. `recordDocWrittenBack` appends a `write_received` metric to the running ledger.

`update-metrics` keeps an append-only JSON ledger at `.livewiki/update_metrics.json`. `metricsPath` returns its absolute path through `safeIo.resolveAndValidate`. `readMetrics` parses the file or returns an empty `{ version: 1, entries: [] }` on corruption; `writeMetrics` persists it. `recordUpdateMetric` is fire-and-forget: errors never block the caller. `snapshotMetrics` aggregates `packagesEmitted`, `totalPackageTokens`, `writesReceived`, `totalWriteTokens`, the `efficiencyRatio = writes/packages`, and `lastPackage` / `lastWrite` entries. `clearMetricsForTests` resets the ledger for clean test setups.

`update.test.ts#writeCode` and `update.test.ts#writeWiki` are per-test helpers that create parent directories and write files under the temporary repo. `setupWithAnchor` lays down `src/foo.ts`, indexes, runs the ledger, writes `livewiki/foo.md` with an anchor to `src/foo.ts#bar`, and re-indexes so the ledger can detect subsequent changes.

## Wiki verification and link masking
<!-- lw:anchors packages/core/src/verify.ts#run packages/core/src/verify.ts#maskCodeForLinkScan packages/core/src/verify.ts#maskFencedCodeBlocks packages/core/src/verify.ts#maskInlineCode packages/core/src/verify.ts#collectWikiPages packages/core/src/verify.ts#collectSectionSlugs packages/core/src/verify.ts#resolveWikiLink packages/core/src/verify.ts#isInsideWiki packages/core/src/verify.ts#formatHuman packages/core/src/verify.test.ts#writeCode packages/core/src/verify.test.ts#writeWiki -->

`run` validates every page freshly read from disk (Fix C): anchors must resolve to active symbols, internal links must point inside the `livewiki/` namespace, and manual blocks must match their stored hash (rule #6). `maskCodeForLinkScan` is the high-level masker used before link scanning; `maskFencedCodeBlocks` collapses fenced code blocks and `maskInlineCode` collapses inline code so links inside code are not scanned. `collectWikiPages` walks the `livewiki/` tree from disk. `collectSectionSlugs` parses headings into slug set used for `[text](page.md#section)` resolution. `resolveWikiLink` resolves a relative link target from a given source page; `isInsideWiki` ensures the resolved target stays inside the wiki namespace. `formatHuman` renders issues for terminal output.

`verify.test.ts#writeCode` and `verify.test.ts#writeWiki` mirror the helpers in `update.test.ts`, creating files in the temp repo for each scenario (broken anchors, valid anchors, escape attempts, manual-block tamper detection).

## Repo walking and ignore rules
<!-- lw:anchors packages/core/src/walker.ts#EXTENSION_LANG packages/core/src/walker.ts#buildIgnore packages/core/src/walker.ts#walkRepo packages/core/src/walker.test.ts#write -->

`EXTENSION_LANG` maps recognized extensions to their language name (`.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.py`). `buildIgnore` composes the `ignore` filter: defaults (`.git/`, `node_modules/`, `.livewiki/`, `dist/`, `coverage/`) plus the repo's `.gitignore` (read from disk; missing is fine) plus any `extraIgnores`. `walkRepo` performs a stack-based recursive traversal that ignores symlinks and other non-`isFile`/`isDirectory` entries, emits `{ path, lang }` records sorted by relative POSIX path so runs are stable across platforms.

`walker.test.ts#write` is the test helper used to lay down files under a fresh `mkdtemp` repo for each scenario: default ignore behavior, `.gitignore` respect, `extraIgnores` override, forward-slash relative paths, stable ordering, and extension filtering.