---
title: core-src-04
owner: generated
anchors:
  - packages/core/src/safe-io.ts#ALLOWED_DIRS
  - packages/core/src/safe-io.ts#InvalidRelativePathError
  - packages/core/src/safe-io.ts#InvalidRelativePathError.constructor
  - packages/core/src/safe-io.ts#PathOutsideAllowlistError
  - packages/core/src/safe-io.ts#PathOutsideAllowlistError.constructor
  - packages/core/src/safe-io.ts#allowlistFor
  - packages/core/src/safe-io.ts#allowedAbs
  - packages/core/src/safe-io.ts#exists
  - packages/core/src/safe-io.ts#findDeepestExisting
  - packages/core/src/safe-io.ts#isInsideAllowlist
  - packages/core/src/safe-io.ts#mkdir
  - packages/core/src/safe-io.ts#readText
  - packages/core/src/safe-io.ts#remove
  - packages/core/src/safe-io.ts#resolveAndValidate
  - packages/core/src/safe-io.ts#validateDeclared
  - packages/core/src/safe-io.ts#writeText
---

# core-src-04

This module bundles the safe disk I/O surface, the wiki status reporter, the
symbol extractor, the workspace walker, the verification pass, and the
incremental `update` package machinery. It enforces the "only `livewiki/` and
`.livewiki/` are writable" rule and powers the focused, debt-driven work
package that the agent consumes.

## Allowlist and disk safety
<!-- lw:anchors packages/core/src/safe-io.ts#ALLOWED_DIRS packages/core/src/safe-io.ts#allowlistFor packages/core/src/safe-io.ts#allowedAbs packages/core/src/safe-io.ts#isInsideAllowlist -->

`ALLOWED_DIRS` is the literal tuple `["livewiki", ".livewiki"]`. Every disk
operation in the codebase must funnel through `safe-io` so this tuple is the
single source of truth for writable roots. `allowedAbs(repoRoot, dir)`
computes the absolute path of each allowlisted directory and asserts that it
still resolves inside `repoRoot`. `allowlistFor(opts)` returns the base tuple
and, when `allowPointer` is true, also exposes `AGENTS.md` / `CLAUDE.md` at
the repo root. `isInsideAllowlist(repoRoot, absPath, opts)` is the pure
prefix check used twice per write — once on the declared path, once after
realpath resolution.

## Path validation errors
<!-- lw:anchors packages/core/src/safe-io.ts#PathOutsideAllowlistError packages/core/src/safe-io.ts#PathOutsideAllowlistError.constructor packages/core/src/safe-io.ts#InvalidRelativePathError packages/core/src/safe-io.ts#InvalidRelativePathError.constructor -->

`PathOutsideAllowlistError` is raised when a path resolves outside the
allowlist after symlink re-validation. Its constructor stores `repoRoot`,
`attempted`, and `allowlist` for diagnostics. `InvalidRelativePathError` is
raised for malformed relative paths (absolute input, `..` segments). Both
errors are the only signals the module emits on rejected writes — there are
no silent fallbacks.

## Path resolution and symlink defense
<!-- lw:anchors packages/core/src/safe-io.ts#validateDeclared packages/core/src/safe-io.ts#findDeepestExisting packages/core/src/safe-io.ts#resolveAndValidate -->

`validateDeclared` rejects absolute paths and `..` segments before doing a
fast allowlist check on the literal path. `findDeepestExisting` walks from the
target back toward `repoRoot` and returns the deepest existing ancestor plus
the non-existent suffix. `resolveAndValidate` composes both: it validates the
declared path, locates the deepest existing ancestor, realpaths that
ancestor, reconstructs the final path, and re-runs the allowlist check on
the resolved result. This closes symlink-escape attacks like
`livewiki → /tmp` or `livewiki/leaf → /etc/x`.

## Disk operations
<!-- lw:anchors packages/core/src/safe-io.ts#writeText packages/core/src/safe-io.ts#readText packages/core/src/safe-io.ts#exists packages/core/src/safe-io.ts#mkdir packages/core/src/safe-io.ts#remove -->

All five operations delegate to `resolveAndValidate` before touching disk,
so the symlink defense applies uniformly. `writeText` creates parent
directories recursively. `readText` returns UTF-8 text. `exists` still
validates the allowlist — learning whether a file lives outside
`livewiki/` is itself considered information leakage. `mkdir` and `remove`
use `mkdir({ recursive: true })` and `rm({ recursive: true, force: true })`
respectively.

## Wiki status reporter
<!-- lw:anchors packages/core/src/status.ts#run packages/core/src/status.ts#collect packages/core/src/status.ts#formatHuman -->

`run(repoRoot, opts)` opens `.livewiki/index.db`, calls `collect` for the
file/symbol/debt/undocumented breakdown, then attaches a best-effort metrics
snapshot (null if metrics reading fails). `collect` aggregates `files` by
language, `symbols` by kind, top-N files by symbol count, open `debt` rows
joined with anchors and doc pages, and a 20-sample slice of undocumented
symbols. `formatHuman` renders the report as multi-line text suitable for the
CLI; both `files` and `symbols` blocks are sorted alphabetically.

## Symbol extraction
<!-- lw:anchors packages/core/src/symbols.ts#extractSymbols packages/core/src/symbols.ts#walkNode packages/core/src/symbols.ts#makeRecord packages/core/src/symbols.ts#signatureFor -->

`extractSymbols(tree, relPath, source)` walks the tree-sitter AST and emits
`SymbolRecord`s with keys shaped as `relPath#Name` (or
`relPath#Class.method` for methods). `walkNode` handles the TS/JS variants
(`function_declaration`, `generator_function_declaration`,
`class_declaration`, `method_definition`, `export_statement`) and the Python
variants (`function_definition`, `class_definition`,
`decorated_definition`). Export statements emit a single record with the
underlying kind (no duplicate `export` row) except for `export const`,
which surfaces the identifier as `kind: "export"`. `makeRecord` produces the
record with 1-indexed line numbers and a `sha256Slice` content hash.
`signatureFor` returns the first non-empty line of the node (capped at 200
chars) for use as an anchor snippet.

## Symbol tests
<!-- lw:anchors packages/core/src/symbols.test.ts#parse -->

`parse(ext, src)` is the test-local wrapper around `parseSource`, used to
drive the `describe("symbols — TypeScript")` and
`describe("symbols — Python")` suites. It exists purely to keep test setup
ergonomic.

## Update accounting
<!-- lw:anchors packages/core/src/update-metrics.ts#metricsPath packages/core/src/update-metrics.ts#readMetrics packages/core/src/update-metrics.ts#writeMetrics packages/core/src/update-metrics.ts#recordUpdateMetric packages/core/src/update-metrics.ts#snapshotMetrics packages/core/src/update-metrics.ts#clearMetricsForTests -->

Metrics live in `.livewiki/update_metrics.json` (a JSON file, not a SQLite
table — they are append-only, reconstructible, and never block the main
flow). `metricsPath` validates and resolves the file path. `readMetrics`
returns an empty `{ version: 1, entries: [] }` on missing or corrupted
files. `writeMetrics` persists the file via `safeIo.writeText`.
`recordUpdateMetric` is fire-and-forget — failures are swallowed so
accounting never blocks `update`. `snapshotMetrics` produces the aggregated
view: package counts, write counts, total tokens on each side, and the
`efficiencyRatio = totalWriteTokens / totalPackageTokens` (null when no
package was ever emitted). `clearMetricsForTests` resets the file; it is
explicitly labeled destructive and must not be used in production code.

## Workspace walker
<!-- lw:anchors packages/core/src/walker.ts#EXTENSION_LANG packages/core/src/walker.ts#buildIgnore packages/core/src/walker.ts#walkRepo -->

`EXTENSION_LANG` is the extension-to-language table that the indexer uses to
tag files. `buildIgnore(repoRoot, opts)` constructs the `ignore` matcher from
`.gitignore` plus livewiki-specific exclusions. `walkRepo` is the public
entry point that yields indexed file rows. The walker is the producer of
every `relPath` that later becomes part of a `SymbolRecord` key.

## Update package (incremental mode)
<!-- lw:anchors packages/core/src/update.ts#CHARS_PER_TOKEN packages/core/src/update.ts#loadWorkPackage packages/core/src/update.ts#snippetForSymbol packages/core/src/update.ts#lookupSymbol packages/core/src/update.ts#recordDocWrittenBack -->

`CHARS_PER_TOKEN = 4` is the heuristic used to estimate package size for
accounting. `loadWorkPackage(repoRoot, opts)` is the heart of the focused
work package: it reads the manifest, queries the open debt via `status`,
builds bounded snippets (default window 20 lines, default `maxSnippets` 50)
for each debt item that has a `symbol_key`, computes `validAnchors` as the
sorted unique set of debt symbol keys, serializes the package, and records a
`package_emitted` metric. `snippetForSymbol` first tries a name-based line
search, then falls back to `lookupSymbol` against the SQLite index, and
finally to a top-of-file snippet. `lookupSymbol` returns `{ startLine,
endLine }` from the `symbols` table for the active row matching the key.
`recordDocWrittenBack` records a `write_received` metric so the efficiency
ratio can be updated.

## Update tests
<!-- lw:anchors packages/core/src/update.test.ts#writeCode packages/core/src/update.test.ts#writeWiki packages/core/src/update.test.ts#setupWithAnchor -->

`writeCode` and `writeWiki` are file helpers that write under the per-test
temp `repoRoot`, creating parent directories as needed. `setupWithAnchor`
performs the canonical Phase-5 fixture: it writes `src/foo.ts` with
`export function bar`, runs the indexer and anchor-ledger, drops a
`livewiki/foo.md` page that anchors `src/foo.ts#bar`, and re-runs both
pipelines. Without an anchor, the ledger cannot detect a `changed` event.

## Verification
<!-- lw:anchors packages/core/src/verify.ts#run packages/core/src/verify.ts#collectWikiPages packages/core/src/verify.ts#collectSectionSlugs packages/core/src/verify.ts#resolveWikiLink packages/core/src/verify.ts#isInsideWiki packages/core/src/verify.ts#formatHuman -->

`run(repoRoot)` is the entry point that walks the wiki and checks links.
`collectWikiPages(absRoot)` enumerates wiki pages. `collectSectionSlugs`
extracts the slug set from each page so internal links can be resolved.
`resolveWikiLink(fromRelPath, linkRaw)` resolves a link relative to the page
that contains it. `isInsideWiki(wikiPath)` guards against link targets that
escape the wiki tree. `formatHuman` renders a human-readable report of
verification results.

## Verification tests
<!-- lw:anchors packages/core/src/verify.test.ts#writeCode packages/core/src/verify.test.ts#writeWiki -->

`writeCode` and `writeWiki` mirror the helpers in `update.test.ts`: they
write into the per-test repo and create parent directories on demand.

## Walker tests
<!-- lw:anchors packages/core/src/walker.test.ts#write -->

`write(rel, content = "")` is the test-local helper that drops a file at a
relative path inside the temporary repo fixture.