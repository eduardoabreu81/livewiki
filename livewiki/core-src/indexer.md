---
title: Indexer pipeline — walking, hashing, and persisting symbols
owner: generated
anchors:
  - packages/core/src/indexer.ts#BINARY_SNIFF_BYTES
  - packages/core/src/indexer.ts#MAX_FILE_BYTES
  - packages/core/src/indexer.ts#ensureLivewikiDir
  - packages/core/src/indexer.ts#formatHuman
  - packages/core/src/indexer.ts#grammarStateEqual
  - packages/core/src/indexer.ts#orchestrateIndex
  - packages/core/src/indexer.ts#run
---

# Indexer pipeline — walking, hashing, and persisting symbols

This page is responsible for the livewiki indexer: the module that walks a repository, reads each file, normalises line endings, hashes content, parses symbols with tree-sitter, and upserts the results into the SQLite ledger inside a single atomic transaction.

## When to use this page

- **Run an incremental index** of a repo to refresh symbols, calls, and rationales without re-parsing unchanged files.
- **Investigate skip reasons** — why a file was skipped as binary or oversized, and which thresholds control that.
- **Audit EOL migration behaviour** to understand how legacy CRLF-era hashes are silently migrated on the first post-upgrade run.
- **Inspect human-readable index output** when an integration calls `run` and needs to render a friendly summary.

## How it fits

The file `packages/core/src/indexer.ts` sits at the top of the core package's indexing layer. It depends on the safe-IO allowlist (`safe-io`), the repository walker (`walker`), the hash/EOL helpers (`hashes`), the tree-sitter parser pipeline (`parser`), the symbol/call/rationale extractors (`symbols`), the SQLite handle (`db`), and the call resolver (`call-resolution`). The exported entry point is `run`, which callers (CLI, hooks, tests) invoke to refresh the ledger; everything else in the file is helper machinery that supports that single function. On disk, the file lives next to its test counterpart under `packages/core/src/`.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-indexer.mmd
```

## Pipeline entry point and work-area bootstrap

`run` is the single exported entry point of `indexer.ts` — the funnel through which every caller (the CLI, post-commit hooks, and the test suite) refreshes the on-disk ledger for a repository. It takes a repository root, which may be absolute or relative (the function resolves it internally via `nodePath.resolve`), and an optional `IndexOptions` object that can carry extra ignore globs and a `quiet` flag. It returns an `IndexResult`, a small record summarising what happened during the run, so callers can either render the outcome themselves or hand it straight to `formatHuman`.

The reason `run` exists as a single funnel rather than as a bag of helpers is idempotence: the source-level comment states the contract in plain words ("rodar 2x sem mudanças no repo é barato"), and the implementation is structured to honour it. Inside `run`, after recording a monotonic start time, the function follows a fixed sequence:

1. Resolves the absolute repo root so every downstream path is anchored to the same place, regardless of how the caller spelled the input.
2. Bootstraps the work area by calling `ensureLivewikiDir`, which is responsible for making sure the `.livewiki/` cache directory exists before the walker and the database open. `.livewiki/` is the directory that holds the SQLite ledger; the wiki itself lives under `livewiki/` and is a separate concern (created later by `livewiki init`, Phase 3).
3. Resolves the database path through the safe-IO allowlist (`safeIo`) so the indexer cannot accidentally write outside the repository.
4. Walks the repository (via the `walker` dependency) to produce the list of files to consider.
5. Opens the SQLite handle, delegates to `orchestrateIndex`, and guarantees `db.close()` runs in a `finally` block so the handle is always released — even if orchestration throws.

```ts
export async function run(repoRoot: string, opts: IndexOptions = {}): Promise<IndexResult> {
```

`ensureLivewikiDir` is the work-area bootstrap step. It takes the resolved absolute repo root and a `quiet` flag, and returns `Promise<void>`. Its job is narrow: ensure that `.livewiki/` exists, swallow the "already exists" race that happens when two concurrent invocations both try to create the directory, and — only when `livewiki/` itself does not yet exist and the caller is *not* in quiet mode — print a one-line informational note pointing the human at `livewiki init` (Phase 3). The `quiet` flag exists so that hooks (post-commit, post-merge) can call `run` without spamming the terminal with a "wiki doesn't exist yet" message on every commit.

```ts
async function ensureLivewikiDir(absRoot: string, quiet: boolean): Promise<void> {
```

Together, `run` and `ensureLivewikiDir` form the entry surface: `run` owns the lifecycle and orchestration, `ensureLivewikiDir` owns the precondition that the cache directory exists before any I/O starts.

<!-- lw:anchors packages/core/src/indexer.ts#run packages/core/src/indexer.ts#ensureLivewikiDir -->

These anchors identify indexed symbols whose implementation is part of this module.

## File-level safety thresholds

The indexer carries two module-level constants that gate every per-file read inside `orchestrateIndex`. They are deliberately tiny and side-effect-free: just integers exported at the top of the file so tests and other modules can refer to them by name, and so changing the threshold is a one-line edit that the test suite can lock in.

```ts
export const MAX_FILE_BYTES = 1024 * 1024;
export const BINARY_SNIFF_BYTES = 8 * 1024;
```

`MAX_FILE_BYTES` is the upper size cap, set to 1 MiB (1024 × 1024 bytes). It is checked *before* the file is read into memory, via `stat.size`, so the indexer never accidentally allocates a multi-megabyte buffer for a giant generated file. Files that exceed it are skipped and counted in `result.filesSkippedTooLarge`; the reason this matters is that reading such a file would both waste RAM and slow the parse loop disproportionately. The check is one-sided: there is no minimum-size filter, so an empty file (0 bytes) is allowed through and indexed as a zero-symbol prose tier.

`BINARY_SNIFF_BYTES` is the binary-detection window, set to 8 KiB (8 × 1024 bytes). It controls how much of the leading prefix the indexer inspects for a NUL byte — the conventional "this is not text" sentinel. After the file is read as UTF-8, `rawContent.slice(0, BINARY_SNIFF_BYTES).includes("\0")` is the actual guard: any NUL byte inside that leading 8 KiB window marks the file as binary, the file is skipped before the parse, and the counter `filesSkippedBinary` is incremented. The check is also one-sided: it inspects a *prefix* only, not the whole file, so a binary blob whose first 8 KiB happen to be ASCII would not be caught — that is the deliberate trade-off between coverage and cost. The constant exists as a named export so the test suite can assert the threshold without hard-coding the number in two places.

Both constants are pure values with no behavioural branches: changing them changes the thresholds, nothing else. They are referenced from `orchestrateIndex`'s Phase A loop and are surfaced in the rendered summary via `formatHuman` whenever the corresponding skip counters are non-zero.

<!-- lw:anchors packages/core/src/indexer.ts#MAX_FILE_BYTES packages/core/src/indexer.ts#BINARY_SNIFF_BYTES -->

These anchors identify indexed symbols whose implementation is part of this module.

## Incremental hashing, EOL migration, and grammar-set drift detection

This section is the heart of the indexer: how `orchestrateIndex` decides what to re-parse, what to skip, and how it detects the three "silent staleness" shapes the tool exists to prevent.

```ts
async function orchestrateIndex(
  db: import("better-sqlite3").Database,
  repoRoot: string,
  walked: { path: string; lang: string }[],
  startedAt: number,
): Promise<IndexResult> {
```

`orchestrateIndex` takes the open SQLite handle, the resolved repo root, the list of walked file entries (path + detected language), and the monotonic start time recorded by `run`. It returns a populated `IndexResult` whose `durationMs` field is computed from `startedAt` so the caller can render the actual wall-clock cost of the run.

The pipeline runs in two phases. **Phase A** is the asynchronous outer loop: for each walked entry, `orchestrateIndex` calls `stat` to learn the size, applies the `MAX_FILE_BYTES` gate, reads the file as UTF-8, applies the NUL-byte binary sniff inside the `BINARY_SNIFF_BYTES` window, normalises line endings once via `normalizeEol` (the CRLF→LF flip is invisible to everything downstream — the hash, the tree-sitter parse, and the symbol/call/rationale extraction all consume the same normalised string), and finally computes `sha256(content)`. **Phase B** is a synchronous SQLite transaction that drains the collected `FilePlan` array in one shot; the split exists because `better-sqlite3` transactions cannot contain `await`, so all I/O and CPU-bound parsing must finish before the DB writes begin.

The hash comparison drives three branches per file:

- **Hash match, no grammar drift** — fast path. The file is counted as `filesUnchanged` and skipped entirely; no parse, no write.
- **Hash mismatch that matches the legacy raw-bytes hash** (or, on files containing zero `\r\n`, the legacy CRLF-expanded hash) — flagged `eolMigration`. The on-disk bytes are provably identical modulo line endings, so only the hash *algorithm* changed (the old ledger stored `sha256(rawContent)`, the new one stores `sha256(normalizeEol(rawContent))`). The file counts as unchanged but is re-parsed and its anchors are realigned in Phase B against the new normalised hash.
- **Hash mismatch that does not match either legacy shape** — normal `filesUpdated` path: parse, then upsert symbols, calls, and rationales.

`grammarStateEqual` is the helper that powers grammar-set drift detection. Before the file loop closes, `orchestrateIndex` reads the freshly built `grammarState()` (an `ext → grammar` map plus a `vendored .wasm` artefact-identity map) and compares it against the `meta.grammar_state` value persisted by the previous run, via `grammarStateEqual`. When the two states differ, three change shapes are covered: a *grammar added* case (files indexed before the new grammar landed hold zero symbols under a prose label while the tier is now anchored), a *grammar removed or remapped* case (`map[ext]` differs — remap leaves symbols parsed with the wrong grammar stale, removal requires dropping them), and a *grammar version bumped* case (the ext→grammar map is identical, only the `artifacts` map moves because the vendored `.wasm` identity changed).

```ts
function grammarStateEqual(a: GrammarState, b: GrammarState): boolean {
```

`grammarStateEqual` takes two `GrammarState` records — each carrying an extension-to-grammar map and a vendored-artefact identity map — and returns `true` only when both maps have the same number of keys and every key maps to the same value. The comparison is field-by-field and intentionally ignores key insertion order: the stored JSON is not guaranteed to round-trip keys in any particular order, so a sorted-membership test is the only honest way to detect "same set of grammars" without producing phantom drift on every run.

When drift is detected, files that previously held zero symbols get a *directed re-parse* under the new grammar so the upgrade is visible in `result.filesReprocessedGrammar` rather than silently stale. Pre-feature databases (no stored `grammar_state`) only get the zero-symbol re-parse — files that already have symbols stay as indexed, and precision for them starts with the *next* state change.

<!-- lw:anchors packages/core/src/indexer.ts#orchestrateIndex packages/core/src/indexer.ts#grammarStateEqual -->

These anchors identify indexed symbols whose implementation is part of this module.

## Parsing, plan collection, and transactional upsert

For every file that needs parsing, Phase A invokes `parseSource` only when `grammarForExtension(ext)` returns a grammar; otherwise the file is indexed as a zero-symbol prose tier (no warning). A successful parse yields `symbols`, `calls`, and `rationales`, with rationales suppressed for files that look generated (header sniff). Parse failures are surfaced as a non-fatal warning and the file proceeds with zero extracted data.

All parsed files are pushed into a `FilePlan` array that the Phase B transaction drains. The transaction itself does several things per file in a fixed order:

1. Mark previously active symbols as `deleted` (soft delete — preserves the content hash for moved-symbol detection).
2. Update or insert the `files` row with the new hash, size, mtime, and language label.
3. For each new symbol, insert the active row; for EOL migrations, realign `anchors.symbol_hash_at_doc` to the new hash in the same transaction so the ledger never sees the raw→normalised transition.
4. Wholesale-replace the file's `calls` and `rationales` (these have no move-tracking identity).
5. For files present in the previous DB but absent from the current walk, mark the file row and its active symbols as `deleted` and bump `filesDeleted` / `symbolsDeleted` accordingly.

The transaction also runs `resolveCalls`, writes `last_indexed_at`, closes the EOL legacy window by recording `eol_hashes_normalized`, and persists the current `grammar_state` so the next run can diff it. Because all of this happens inside one `db.transaction(...)` call, the index is atomic: readers never see a partial reindex.

The `legacyWindow` flag is the gate for per-symbol EOL realignment: it is open only on the first post-upgrade run (when `meta.eol_hashes_normalized` is absent) and closed by the transaction itself, so steady-state normalised operation pays zero extra hashing cost. While open, an updated file captures the old key→hash map; for each re-inserted symbol whose stored hash does not match the new one, the indexer re-cuts the slice from the normalised text and compares `sha256(expandEolToCrlf(slice))` against the old hash. A match means the code is identical modulo line endings and triggers the same in-transaction anchor realignment; a miss follows the normal `changed` debt path.

## Human-readable result rendering

After `orchestrateIndex` commits its transaction and returns the populated `IndexResult`, the caller hands that record to `formatHuman` whenever a human-friendly rendering is needed. The function is intentionally side-effect-free — it does no I/O, touches no globals, and never throws on a well-formed `IndexResult` — so it is safe to call from CLI, hooks, and tests alike.

```ts
export function formatHuman(result: IndexResult): string {
```

`formatHuman` takes the `IndexResult` produced by `run` and returns a multi-line string built line by line. The output always carries three baseline lines: the header `livewiki index: OK in <durationMs>ms`, a `files:` tally using the `+new ~updated =unchanged -removed` convention (so a developer can scan a single line and see whether the run was a no-op or a real change), and a `symbols:` tally distinguishing *added* from *marked deleted*. On top of those baselines, `formatHuman` emits two *conditional* lines: a `grammar upgrade:` line that appears only when `result.filesReprocessedGrammar > 0` (so the developer knows an unchanged file was deliberately re-parsed because the grammar set moved), and a `skipped:` line that appears only when either binary or oversized skips occurred (so a quiet run stays quiet, and a noisy run points the human at the right counter).

The reason this lives in its own exported function rather than inline in `run` is that the indexer is also called programmatically — by hooks, by tests, and by other tooling — where the caller wants the raw `IndexResult` and renders it itself. Exporting `formatHuman` lets every caller pick the rendering it needs without duplicating the formatting logic.

<!-- lw:anchors packages/core/src/indexer.ts#formatHuman -->

These anchors identify indexed symbols whose implementation is part of this module.

## Tests

Covered by `packages/core/src/indexer.test.ts` (same-name test file on disk).
