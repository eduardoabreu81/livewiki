---
title: Incremental Source Indexing Engine
owner: generated
anchors:
- packages/core/src/indexer.ts#BINARY_SNIFF_BYTES
- packages/core/src/indexer.ts#MAX_FILE_BYTES
- packages/core/src/indexer.ts#ensureLivewikiDir
- packages/core/src/indexer.ts#formatHuman
- packages/core/src/indexer.ts#grammarStateEqual
- packages/core/src/indexer.ts#orchestrateIndex
- packages/core/src/indexer.ts#reconcilePlan
- packages/core/src/indexer.ts#run
---

# Incremental Source Indexing Engine

This page documents the core indexing engine that walks a repository, parses source files, and persists extracted symbols, calls, and rationales to a SQLite database.

## When to use this page

- Understand how the `livewiki index` command turns a repository into a searchable symbol database.
- Debug concurrency issues when multiple processes (CLI, editor hooks, MCP server) index the same database simultaneously.
- Learn how the indexer handles incremental updates, EOL normalization, grammar-set changes, and binary/large file filtering.
- Trace the two-phase flow that keeps async file I/O outside the synchronous SQLite write transaction.

## How it fits

The indexer is the heart of livewiki's Phase 1: it converts raw repository files into structured rows in `index.db`. It sits between the file walker (`walker.js`) and the database layer (`db.js`), using the parser (`parser.js`), symbol extractor (`symbols.js`), and call resolver (`call-resolution.js`). Its results feed the later phases that build prose documentation and track symbol movement across versions. The module is invoked by CLI commands, editor hooks, and the MCP server's file watcher — all of which may run concurrently against the same database.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-indexer.mmd
```

## File filters and size caps

<!-- lw:anchors packages/core/src/indexer.ts#MAX_FILE_BYTES packages/core/src/indexer.ts#BINARY_SNIFF_BYTES -->

The indexer applies two safety filters before ever reading a file's full contents, both defined as exported constants so callers and tests can reference the exact limits.

```typescript
export const MAX_FILE_BYTES = 1024 * 1024;
```

`MAX_FILE_BYTES` caps the upper bound of file size: any file whose stat report exceeds 1 MiB is skipped entirely without a read, incrementing the `filesSkippedTooLarge` counter. The check happens on `stat` before any I/O, so oversized files never waste memory.

```typescript
export const BINARY_SNIFF_BYTES = 8 * 1024;
```

`BINARY_SNIFF_BYTES` defines the leading window for binary detection: after reading a file's text, the indexer checks whether that window contains a NUL byte (`\0`). If so, the file is treated as binary regardless of its extension and skipped, incrementing `filesSkippedBinary`. This is a one-sided check — only the first 8 KiB are inspected, so a file with its first NUL after that point still passes through as text.

## Orchestrating a full index run

<!-- lw:anchors packages/core/src/indexer.ts#run packages/core/src/indexer.ts#ensureLivewikiDir -->

`run` is the public entry point that ties together every stage of an indexing pass. A caller supplies a repository root and optional settings (extra ignore patterns, quiet mode) and receives a structured `IndexResult` describing what happened.

```typescript
export async function run(repoRoot: string, opts: IndexOptions = {}): Promise<IndexResult> {
```

`run` takes the repository path and an options object, and returns a promise of `IndexResult` with per-category counters.

The function starts by resolving `repoRoot` to an absolute path, then ensures the `.livewiki/` cache directory exists via `ensureLivewikiDir`. It resolves the database location through `safe-io` (which re-validates the path allowlist and symlink safety), then invokes `walkRepo` to enumerate files honoring `.gitignore` plus any extra ignores. Finally it opens the SQLite database and delegates to `orchestrateIndex` inside a `try/finally` that always closes the database handle — even when parsing fails, the connection is released.

```typescript
async function ensureLivewikiDir(absRoot: string, quiet: boolean): Promise<void> {
```

`ensureLivewikiDir` takes the absolute repository root and a quiet flag, and returns nothing — it ensures `.livewiki/` exists and optionally prints a note.

It first attempts an allowlisted `mkdir` on `.livewiki/`. If that fails, it checks whether the directory actually exists via a stat call; only when stat also fails does it re-throw an error. Next it checks whether the human-facing `livewiki/` directory (created by Phase 3) exists. If it does not and `quiet` is false, it emits a one-line note suggesting `livewiki init` — but the index proceeds anyway with exit code 0, and quiet mode (used by editor hooks) suppresses the note entirely.

## Reconciling plans against fresh database state

<!-- lw:anchors packages/core/src/indexer.ts#reconcilePlan -->

`reconcilePlan` is the pure decision function that protects the database from concurrent-writer races. It answers one question: given what a plan predicted during the async planning phase and what the `files` row actually says right now, what should the write phase do?

```typescript
export function reconcilePlan(
  plan: Pick<FilePlan, "hash" | "eolMigration" | "grammarReprocess" | "prevHash">,
  fresh: FileRow | undefined,
  ctx: { grammarReprocessStillPending: boolean },
): PlanDecision {
```

`reconcilePlan` takes a plan subset, the fresh file row (or `undefined`), and context about whether grammar reprocessing is still pending; it returns a `PlanDecision` of kind `insert`, `update`, or `converged`.

The function returns `insert` when no fresh row exists. It computes `grammarReprocess` as the plan's flag ANDed with `ctx.grammarReprocessStillPending` — if another writer already applied the current grammar state, the reprocess is no longer needed. When the fresh row is active, its hash matches the plan's hash, and no reprocess is pending, it returns `converged`: another writer already applied these exact bytes, so this run has nothing to do. Otherwise it returns `update` with the fresh row, carrying three re-qualified flags: `reactivated` (true when the fresh row is not active), `eolMigration` (plan's flag ANDed with the check that the fresh hash still equals the plan's previous hash), and the recomputed `grammarReprocess`. This re-qualification is what distinguishes "nobody touched this line" from "another writer got here first" — the two cases need different write decisions.

## The two-phase index pipeline

<!-- lw:anchors packages/core/src/indexer.ts#orchestrateIndex -->

`orchestrateIndex` implements the core pipeline: it reads the planning snapshot, runs async file I/O, then applies all writes inside one synchronous transaction. The two-phase shape exists because better-sqlite3 transactions cannot contain `await`, and holding the write lock across 0.5–15 seconds of file parsing would block every other writer.

```typescript
async function orchestrateIndex(
  db: import("better-sqlite3").Database,
  repoRoot: string,
  walked: { path: string; lang: string }[],
  startedAt: number,
): Promise<IndexResult> {
```

`orchestrateIndex` takes an open database, the repository root, the walked file list, and a start timestamp; it returns a promise of `IndexResult`.

Before Phase A, the function reads the planning snapshot: a map of path → file row from `SELECT * FROM files`. This snapshot is deliberately NOT authoritative for any write — its only jobs are letting Phase A skip unchanged files without parsing and bounding the delete sweep. It also reads `meta.grammar_state`, comparing the stored grammar state against the current one via `grammarStateEqual`. When the state changed, it pre-loads the set of file IDs that have active symbols (used to decide which zero-symbol files need directed re-parsing).

Phase A iterates the walked files with serial `await` calls (parallelism does not help on SSD I/O or single-core CPU). For each entry it stats the file; if that fails it warns and skips. It applies the size cap (comparing `stat.size` against the `MAX_FILE_BYTES` upper bound), reads the file as UTF-8, and rejects binary content whose leading window contains a NUL byte. It normalizes EOL characters once via `normalizeEol` — every downstream consumer (hash, parser, extractors) uses that single normalized string. It computes the SHA-256 hash, looks up the previous row, and decides among three non-parse paths: unchanged (hash matches, no grammar reprocess needed, row not reactivated), grammar reprocess (hash matches but the grammar set changed and the file is a candidate), or legacy EOL migration (stored hash matches raw bytes or a CRLF-expanded variant but not the normalized hash). For files that need parsing, it checks `grammarForExtension`; files with no grammar are indexed as zero-symbol (tier 2 of the coverage ladder). On grammar-mapped files it attempts `parseSource`, extracts symbols with byte ranges, calls, and — unless the file is likely generated — rationales. Parse failures warn but do not abort the run. Successful plans are pushed into the `plans` array.

Phase B opens a `BEGIN IMMEDIATE` transaction via `runWriteTransaction("index", writeAll)` — immediate, not deferred, so writers queue at the boundary instead of colliding mid-mutation. Inside the transaction the function re-reads `files` fresh (the decisive state, safe because the lock is held), reads the legacy-window flag `eol_hashes_normalized`, and re-reads `grammar_state` to compute `grammarReprocessStillPending`. It prepares all insert/update/delete statements once, then loops over plans. For each plan it calls `reconcilePlan` against the fresh row: `converged` increments the unchanged counter and skips; `insert` performs a file INSERT; `update` soft-deletes old active symbols (counting reactivation, EOL migration, grammar reprocess, or ordinary update on separate axes), then re-inserts today's symbols with per-symbol EOL realignment where the legacy window and matching CRLF-expanded hashes prove code identity. Calls and rationales are deleted and re-inserted wholesale per file — they have no identity worth preserving. A final sweep marks files absent from the walk as deleted, iterating the planning snapshot as the candidate set but reading each row's current state from `freshFiles` so a concurrent writer's new file is never swept. The transaction then runs `resolveCalls`, stamps `last_indexed_at`, closes the legacy window with `eol_hashes_normalized`, and records the current grammar state.

The function returns an assembled `IndexResult` with `filesScanned` from the walk length, all per-category counters accumulated during both phases, and `durationMs` measured from the start timestamp.

## Grammar state comparison and human-readable output

<!-- lw:anchors packages/core/src/indexer.ts#grammarStateEqual packages/core/src/indexer.ts#formatHuman -->

The grammar upgrade mechanism and the CLI summary output each have their own small helper.

```typescript
function grammarStateEqual(a: GrammarState, b: GrammarState): boolean {
```

`grammarStateEqual` takes two `GrammarState` objects and returns a boolean indicating whether their extension maps and artifact maps are structurally identical.

It compares the `.map` objects (extension → grammar) and `.artifacts` objects (grammar → wasm identity) by key count and per-key value. Field-by-field comparison is required because stored JSON key order is not guaranteed to match a fresh in-memory build. This function is what lets the indexer detect grammar additions, removals, remappings, and version bumps — each of which may require re-parsing previously indexed files.

```typescript
export function formatHuman(result: IndexResult): string {
```

`formatHuman` takes an `IndexResult` and returns a multi-line human-readable summary string.

It always prints an OK line with the duration and a files line (`+new`, `~updated`, `=unchanged`, `-removed`), followed by a symbols line. It conditionally appends lines for grammar-upgrade re-parses, reactivated files, and skipped binary/oversized files — each only when the relevant counter is nonzero, so a clean incremental run stays concise.

## Tests

Covered by `packages/core/src/indexer.test.ts` (same-name test file on disk).
Likely also exercised by `packages/core/src/indexer-reconcile.test.ts` (name-prefix match, not verified).
