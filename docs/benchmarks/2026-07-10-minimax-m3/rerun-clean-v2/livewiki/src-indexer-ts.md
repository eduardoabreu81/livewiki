---
title: src-indexer-ts
owner: generated
anchors:
  - packages/core/src/indexer.ts#ensureLivewikiDir
  - packages/core/src/indexer.ts#formatHuman
  - packages/core/src/indexer.ts#orchestrateIndex
  - packages/core/src/indexer.ts#run
---

# Indexer (`packages/core/src/indexer.ts`)

Orchestrates the indexing pipeline: **walk → read → hash → parse → extract → upsert**.

Implements Phase 1 of the SPEC. The module:

- Extracts symbols (functions, classes, methods, exports).
- Computes content hashes.
- Persists results into the SQLite schema.
- Honours `.gitignore` plus caller-provided extra ignore patterns.

## Incremental behaviour

- Files whose `content_hash` matches the row already in the DB are **skipped** (read + hash only).
- New files are parsed and inserted.
- Files that disappeared from disk have their symbols marked `status='deleted'` (soft delete — see `orchestrateIndex`).

## Performance targets (from SPEC)

- First run: 50k LOC < 30s.
- Incremental run: < 2s.
- A single SQLite transaction commits all writes atomically.
- `readFile` runs in series (I/O-bound; parallelism does not help on SSD).
- tree-sitter parsing runs in series (CPU-bound; parallelism does not help on a single core).

## Auto-init note

If `.livewiki/` does not exist, it is created silently. If `livewiki/` (the user-facing wiki) is also missing, an informational note is printed suggesting `livewiki init`. The process still exits 0 in that case. In `quiet` mode (e.g. hook invocations) the note is suppressed.

---

## Public API: `run`

<!-- lw:anchors packages/core/src/indexer.ts#run -->

```ts
export async function run(
  repoRoot: string,
  opts: IndexOptions = {},
): Promise<IndexResult>
```

Entry point. Resolves `repoRoot`, ensures `.livewiki/`, validates the DB path through `safe-io`, walks the repo, opens the index DB, and delegates to `orchestrateIndex`. Closes the DB in a `finally` block.

Idempotent: running it twice without repository changes is cheap (one walk + one hash per file).

### `IndexOptions`

| Field | Type | Purpose |
| --- | --- | --- |
| `extraIgnores` | `readonly string[]` | Extra patterns ignored in addition to `.gitignore` and built-in defaults. |
| `quiet` | `boolean` | Suppresses informational notes (intended for JSON / hook mode). |

### `IndexResult`

```ts
export interface IndexResult {
  filesScanned: number;
  filesAdded: number;
  filesUpdated: number;
  filesDeleted: number;
  filesUnchanged: number;
  symbolsAdded: number;
  symbolsDeleted: number;
  durationMs: number;
}
```

---

## `ensureLivewikiDir`

<!-- lw:anchors packages/core/src/indexer.ts#ensureLivewikiDir -->

```ts
async function ensureLivewikiDir(
  absRoot: string,
  quiet: boolean,
): Promise<void>
```

Internal helper called by `run`.

Steps:

1. Creates `.livewiki/` via `safeIo.mkdir` (allowlisted path). If creation fails for any reason other than "already exists", the error is re-thrown as `failed to create .livewiki/`.
2. Stat-checks for the user-facing `livewiki/` directory. If it is missing **and** `quiet` is `false`, prints a single console note suggesting `livewiki init`. Suppressed entirely when `quiet` is `true`.

---

## `orchestrateIndex`

<!-- lw:anchors packages/core/src/indexer.ts#orchestrateIndex -->

```ts
async function orchestrateIndex(
  db: import("better-sqlite3").Database,
  repoRoot: string,
  walked: { path: string; lang: string }[],
  startedAt: number,
): Promise<IndexResult>
```

Internal core. Splits work into two phases to keep `better-sqlite3`'s synchronous transaction free of `await`:

### Phase A — async I/O (outside the transaction)

For each walked entry:

- `stat` + `readFile` the file. Failures log a warning and skip.
- Compute `sha256(content)`.
- If the existing DB row has the same `content_hash`, increment `filesUnchanged` and continue (no parse).
- Otherwise parse with `parseSource` (tree-sitter), extract symbols with `extractSymbols`, and push a `FilePlan` containing the entry, content, size, `mtimeMs`, hash, and symbols.

### Phase B — synchronous writes (inside one transaction)

The transaction `writeAll`:

- For each `FilePlan`:
  - If a previous row exists: `markSymbolsActiveDeleted` on prior symbols (preserves `content_hash` so the ledger can later detect `moved`), then `updateFile` with `status='active'`.
  - If no previous row: `insertFile`, increment `filesAdded`.
  - Insert each symbol with `status='active'`; increment `symbolsAdded`.
- For each `existingFiles` entry whose path is not in the current walk:
  - Count active symbols **before** updating (so the `WHERE` clause still matches).
  - `markSymbolDeleted` and `markFileDeleted` (soft delete). Increment `filesDeleted` and `symbolsDeleted` accordingly.
- Writes `last_indexed_at` into the `meta` table.

Soft-delete rationale (per source comments): the ledger in Phase 2 needs deleted symbol rows with their original `content_hash` to detect `moved` symbols when the same hash reappears under a different file path.

---

## `formatHuman`

<!-- lw:anchors packages/core/src/indexer.ts#formatHuman -->

```ts
export function formatHuman(result: IndexResult): string
```

Renders an `IndexResult` as a short human-readable summary:

```
livewiki index: OK in <durationMs>ms
  files: <scanned> scanned  +<added> new  ~<updated> updated  =<unchanged> unchanged  -<deleted> removed
  symbols: +<symbolsAdded> extracted  -<symbolsDeleted> marked deleted
```

Used in error/help output to give the user a quick status line.

---

## Re-exports

```ts
export { listSupportedGrammars };
```

Re-exported from `./parser.js` so callers can introspect which languages the indexer currently understands. Documented in source as "used in errors to give a support hint".