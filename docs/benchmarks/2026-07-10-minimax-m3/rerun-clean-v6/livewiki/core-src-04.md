---
title: core-src-04
owner: generated
anchors:
  - packages/core/src/safe-io.ts#writeText
  - packages/core/src/safe-io.ts#readText
  - packages/core/src/safe-io.ts#exists
  - packages/core/src/safe-io.ts#mkdir
  - packages/core/src/safe-io.ts#remove
  - packages/core/src/safe-io.ts#resolveAndValidate
  - packages/core/src/symbols.ts#extractSymbols
  - packages/core/src/symbols.ts#walkNode
  - packages/core/src/symbols.ts#makeRecord
  - packages/core/src/symbols.ts#signatureFor
  - packages/core/src/walker.ts#walkRepo
  - packages/core/src/walker.ts#buildIgnore
  - packages/core/src/walker.ts#EXTENSION_LANG
  - packages/core/src/status.ts#run
  - packages/core/src/status.ts#collect
  - packages/core/src/status.ts#formatHuman
  - packages/core/src/verify.ts#run
  - packages/core/src/verify.ts#collectWikiPages
  - packages/core/src/verify.ts#collectSectionSlugs
  - packages/core/src/verify.ts#resolveWikiLink
  - packages/core/src/verify.ts#isInsideWiki
  - packages/core/src/verify.ts#formatHuman
  - packages/core/src/update.ts#loadWorkPackage
  - packages/core/src/update.ts#snippetForSymbol
  - packages/core/src/update.ts#lookupSymbol
  - packages/core/src/update.ts#recordDocWrittenBack
  - packages/core/src/update.ts#CHARS_PER_TOKEN
  - packages/core/src/update-metrics.ts#metricsPath
  - packages/core/src/update-metrics.ts#readMetrics
  - packages/core/src/update-metrics.ts#writeMetrics
  - packages/core/src/update-metrics.ts#recordUpdateMetric
  - packages/core/src/update-metrics.ts#snapshotMetrics
  - packages/core/src/update-metrics.ts#clearMetricsForTests
  - packages/core/src/safe-io.ts#ALLOWED_DIRS
  - packages/core/src/safe-io.ts#InvalidRelativePathError
  - packages/core/src/safe-io.ts#InvalidRelativePathError.constructor
  - packages/core/src/safe-io.ts#PathOutsideAllowlistError
  - packages/core/src/safe-io.ts#PathOutsideAllowlistError.constructor
  - packages/core/src/safe-io.ts#allowedAbs
  - packages/core/src/safe-io.ts#allowlistFor
  - packages/core/src/safe-io.ts#findDeepestExisting
  - packages/core/src/safe-io.ts#isInsideAllowlist
  - packages/core/src/safe-io.ts#validateDeclared
  - packages/core/src/symbols.test.ts#parse
  - packages/core/src/update.test.ts#setupWithAnchor
  - packages/core/src/update.test.ts#writeCode
  - packages/core/src/update.test.ts#writeWiki
  - packages/core/src/verify.test.ts#writeCode
  - packages/core/src/verify.test.ts#writeWiki
  - packages/core/src/walker.test.ts#write
---

## safe-io — single I/O gateway
<!-- lw:anchors packages/core/src/safe-io.ts#ALLOWED_DIRS packages/core/src/safe-io.ts#allowlistFor packages/core/src/safe-io.ts#allowedAbs packages/core/src/safe-io.ts#isInsideAllowlist packages/core/src/safe-io.ts#validateDeclared packages/core/src/safe-io.ts#PathOutsideAllowlistError packages/core/src/safe-io.ts#PathOutsideAllowlistError.constructor packages/core/src/safe-io.ts#InvalidRelativePathError packages/core/src/safe-io.ts#InvalidRelativePathError.constructor packages/core/src/safe-io.ts#findDeepestExisting packages/core/src/safe-io.ts#resolveAndValidate packages/core/src/safe-io.ts#writeText packages/core/src/safe-io.ts#readText packages/core/src/safe-io.ts#exists packages/core/src/safe-io.ts#mkdir packages/core/src/safe-io.ts#remove -->

The `safe-io` module is the only module authorized to write to disk per the spec's inviolable rule #1. All writes pass through this module and are validated against the allowlist (`livewiki/` and `.livewiki/` inside the repoRoot). Paths outside this list are rejected — no exceptions, including in tests.

The allowlist of allowed directories is the constant `ALLOWED_DIRS` (`["livewiki", ".livewiki"]` as const). The `allowlistFor` helper builds the effective allowlist for a given `SafeIoOptions` — when `allowPointer` is set, it additionally permits `AGENTS.md` and `CLAUDE.md` at the repo root (a Phase 5 opt-in). The helper `allowedAbs` resolves an `AllowedDir` literal to its absolute path under `repoRoot`, defending in depth by checking the directory does not escape `repoRoot`.

`isInsideAllowlist(repoRoot, absPath, opts)` is the pure decision primitive: it returns `true` iff an absolute path falls inside one of the allowed directories (compared by prefix + separator, not substring, so `livewiki-evil` is not accepted as inside `livewiki/`). When `allowPointer` is set, root-level `AGENTS.md` and `CLAUDE.md` are also accepted by exact filename match.

`validateDeclared` performs the first-line defense before symlink resolution: it rejects absolute paths, paths containing a `..` segment, and paths whose declared target falls outside the allowlist. On failure it throws `InvalidRelativePathError` (with a `reason` such as `"must be relative to repoRoot"` or `"contains '..' segment"`) or `PathOutsideAllowlistError`. The `PathOutsideAllowlistError.constructor` records `repoRoot`, the `attempted` path, and the active `allowlist` for diagnostics. `InvalidRelativePathError.constructor` carries the offending `relPath` and a `reason`.

Symlink defense is layered: after `validateDeclared` succeeds, `findDeepestExisting` walks up the target to its deepest existing ancestor, `realpath`s that ancestor, reconstitutes the final path, and `resolveAndValidate` RE-VALIDATES the allowlist. This closes the three attack shapes (root symlink, intermediate symlink, leaf symlink).

The public I/O surface is `writeText`, `readText`, `exists`, `mkdir`, and `remove`. `resolveAndValidate` returns the validated absolute path for a given relative path. Errors thrown by any of these include a stack trace and a structured message identifying the path, the repo root, and the active allowlist.

## Symbol extraction
<!-- lw:anchors packages/core/src/symbols.ts#extractSymbols packages/core/src/symbols.ts#walkNode packages/core/src/symbols.ts#makeRecord packages/core/src/symbols.ts#signatureFor packages/core/src/symbols.test.ts#parse -->

`extractSymbols(tree, relPath, source)` walks a tree-sitter AST and emits `SymbolRecord` entries. Records carry a `key` (the canonical anchor key `path#Name` or `path#Class.method`), a short `name`, a `kind` (`"function" | "class" | "method" | "export"`), a `signature` (first line of the node, when available), `start_line`/`end_line`, and a `content_hash` of the node slice.

The recursive `walkNode` dispatches on tree-sitter node types:
- `function_declaration` / `generator_function_declaration` → `kind: "function"`
- `class_declaration` (TS) / `class` (TS variant) / `class_definition` (Python) → `kind: "class"`, then descends into `method_definition` children with `parentClassName` set
- `method_definition` → `kind: "method"`, qualified as `Parent.name` when the parent is a class
- `export_statement` → de-duplicated: for `export function` and `export class` it emits a single `function`/`class` entry (no extra `export` duplicate); for `export const foo = ...` it emits the identifier as `kind: "export"`

`makeRecord` builds a `SymbolRecord` by computing the byte slice of the node from `source` and hashing it. `signatureFor` returns the first line of the node (useful for header-style anchor summaries); it returns `null` when the node lacks source.

The helper `parse` in `symbols.test.ts` is a thin wrapper that calls `parseSource` from the parser module — used across the symbols test suite to bootstrap tree-sitter in `beforeAll`.

## Repository walker
<!-- lw:anchors packages/core/src/walker.ts#walkRepo packages/core/src/walker.ts#buildIgnore packages/core/src/walker.ts#EXTENSION_LANG packages/core/src/walker.test.ts#write -->

`walkRepo(repoRoot, opts)` enumerates indexable source files. It is stack-based (not recursive) to avoid call-stack overflows on deep repositories and uses `readdir({ withFileTypes: true })` per directory.

`buildIgnore(repoRoot, opts)` composes the ignore filter from three layers:
1. Defaults (defense in depth): `.git/`, `node_modules/`, `.livewiki/`, `dist/`, `coverage/`
2. The repo's `.gitignore` (if present; missing-file is a silent no-op)
3. Any `opts.extraIgnores` patterns

`EXTRA_IGNORES` override `.gitignore` semantics. Symlinks and non-file/non-directory entries are skipped (the spec does not require symlink traversal).

`EXTENSION_LANG` is the extension → language map for the MVP: `.ts` → `typescript`, `.tsx` → `tsx`, `.js` and `.mjs`/`.cjs` → `javascript`, `.jsx` → `tsx`, `.py` → `python`. Files with unknown extensions are skipped. Output paths are relative to `repoRoot` with forward slashes and sorted alphabetically for stable diffs between runs.

The test helper `write` (in `walker.test.ts`) creates a file under a temporary `repoRoot` (set up in `beforeEach` and torn down in `afterEach`).

## Status report
<!-- lw:anchors packages/core/src/status.ts#run packages/core/src/status.ts#collect packages/core/src/status.ts#formatHuman -->

`status.run(repoRoot, opts)` produces a `StatusReport`: file counts (total + by language + top-N by symbol count), symbol counts (total + by kind), open debt (by event `changed`/`moved`/`deleted` and by assignee `agent`/`human`, plus the `DebtItem[]` list), undocumented symbols (count + sample), an optional `metrics` snapshot (best-effort — failure leaves it `null`), and `meta` (`schemaVersion`, `lastIndexedAt`, `lastLedgerAt`).

Internally `run` opens the SQLite index at `.livewiki/index.db` (resolved via `safe-io`), invokes `collect(db, topN)`, and attaches `snapshotMetrics(repoRoot)` for the incremental accounting.

`collect` issues prepared statements against `files` (active), `symbols` (active), `debt` (open rows joined with `anchors` and `doc_pages` for symbol_key/wiki_path), and `undocumented` (not dismissed). Debt items are mapped to typed `DebtItem` records, with `event` and `assignee` validated against the enum shape.

`formatHuman(report)` renders the report as multi-line text for terminal use; the JSON shape (returned directly by `run`) is the agent-facing structured view.

## Verify
<!-- lw:anchors packages/core/src/verify.ts#run packages/core/src/verify.ts#collectWikiPages packages/core/src/verify.ts#collectSectionSlugs packages/core/src/verify.ts#resolveWikiLink packages/core/src/verify.ts#isInsideWiki packages/core/src/verify.ts#formatHuman packages/core/src/verify.test.ts#writeCode packages/core/src/verify.test.ts#writeWiki -->

`verify.run(repoRoot)` validates the wiki against the code index. It checks:
- `broken_anchor` (severity `error`): every anchor extracted from the wiki must reference an active `SymbolRow` key
- `broken_internal_link` (severity `warning`): `[text](page.md)` and `[text](page.md#section)` links must resolve to an existing page or section inside the wiki
- `manual_block_altered` (severity `error`): byte-for-byte preservation of manual blocks vs. the baseline `content_hash` in `manual_blocks`
- `missing_wiki_path` (severity `error`): `doc_pages` rows whose file no longer exists on disk

The wiki walk is always from disk (Fix C of the spec) so that pages written by an LLM but not yet re-indexed are still validated. The index is opened only to look up active symbols and manual-block baselines.

`collectWikiPages(absRoot)` returns the set of wiki page relative paths. `collectSectionSlugs(absRoot, relPath)` extracts the section slugs from a page's headings. `resolveWikiLink(fromRelPath, linkRaw)` normalizes a wiki link from a source page into its target relative path (POSIX-style, so `..` is resolved correctly), and `isInsideWiki(wikiPath)` checks that the resolved target is within the `livewiki/` namespace. `formatHuman(result)` renders the verification result for terminal use. Exit code is non-zero when any error-severity issue is present.

Test helpers `writeCode` and `writeWiki` in `verify.test.ts` create files under a temporary `repoRoot` (set up per test, torn down in `afterEach`).

## Update — incremental work package
<!-- lw:anchors packages/core/src/update.ts#loadWorkPackage packages/core/src/update.ts#snippetForSymbol packages/core/src/update.ts#lookupSymbol packages/core/src/update.ts#recordDocWrittenBack packages/core/src/update.ts#CHARS_PER_TOKEN packages/core/src/update.test.ts#setupWithAnchor packages/core/src/update.test.ts#writeCode packages/core/src/update.test.ts#writeWiki -->

`update` is the Phase 5 incremental mode. `loadWorkPackage(repoRoot, opts)` assembles a focused `WorkPackage` for the agent in session, sized for ~800 tokens (vs. ~12.5k to re-read the repo). The package includes: a `manifest` view (or `null` if the repo was never initialized), open `debt` items (delegated to `status.run`), per-item `snippets` of the current source, `validAnchors` (the subset of `symbol_key` values the agent may anchor to), `tokensEstimated` (`chars / CHARS_PER_TOKEN`, where `CHARS_PER_TOKEN = 4`), and `bytes` (serialized size). Side effect: records a `package_emitted` metric.

`snippetForSymbol(repoRoot, symbolKey, window)` reads the file at the symbol's path and slices a window of `window` lines (default `SNIPPET_WINDOW = 20`) around the symbol's `start_line`. It returns a `DebtSnippet` (or `null` if the file is missing).

`lookupSymbol` resolves a `symbol_key` to a record from the index. The exact return shape is TODO: not visible in the truncated source.

`recordDocWrittenBack(repoRoot, ...)` records a `write_received` metric when the agent (or a human via CLI) returns a written doc page; it feeds the `efficiencyRatio` exposed by `status --json`.

`WorkPackageOptions` accepts `language` (reserved for future human messages), `snippetWindow` (override of the line window), and `maxSnippets` (defense cap on the snippet count when debt is large).

Test setup helper `setupWithAnchor` writes a `src/foo.ts` source file with `export function bar`, runs the indexer and anchor-ledger, and writes a `livewiki/foo.md` page anchored to `src/foo.ts#bar`. Without an existing anchor, the ledger would not detect changes (debt = anchor changed). Helpers `writeCode` and `writeWiki` create files under the per-test temp `repoRoot`.

## Update metrics — token accounting
<!-- lw:anchors packages/core/src/update-metrics.ts#metricsPath packages/core/src/update-metrics.ts#readMetrics packages/core/src/update-metrics.ts#writeMetrics packages/core/src/update-metrics.ts#recordUpdateMetric packages/core/src/update-metrics.ts#snapshotMetrics packages/core/src/update-metrics.ts#clearMetricsForTests -->

`update-metrics` is the incremental accounting layer (Phase 3). It persists a JSON file at `.livewiki/update_metrics.json` rather than a SQLite table because: (1) it does not need v4 schema migrations, (2) it is reconstructible — deleting `.livewiki/` is allowed by rule #3, and metrics loss is acceptable, (3) append-only is simpler than migrations.

The file shape is `{ version: 1, entries: UpdateMetric[] }`. `UpdateMetric` is a discriminated union: `{ kind: "package_emitted", timestamp, tokensEstimated, bytes, debtCount }` (recorded by `loadWorkPackage`) or `{ kind: "write_received", timestamp, wikiPath, bytes, tokensEstimated }` (recorded when a doc is written back by the agent or a human). The product thesis ("800 tokens in instead of re-reading the repo") lives here: the ratio `writeReceivedTokens / packageEmittedTokens` shows how many doc lines per code lines the agent produced.

`metricsPath(repoRoot)` returns the validated absolute path (via `safe-io.resolveAndValidate`). `readMetrics(repoRoot)` loads and parses the file, returning `{ version: 1, entries: [] }` on any parse failure or missing file. `writeMetrics(repoRoot, file)` persists pretty-printed JSON with a trailing newline. `recordUpdateMetric(repoRoot, metric)` appends an entry best-effort: any error is swallowed so accounting never blocks the main flow. `snapshotMetrics(repoRoot)` produces a `UpdateMetricsSnapshot` with totals and the `efficiencyRatio` (`null` when no package has been emitted yet). `clearMetricsForTests(repoRoot)` is a test-only reset.

Behavior details not visible in the truncated source (e.g. whether `recordUpdateMetric` deduplicates identical consecutive entries) are TODO.