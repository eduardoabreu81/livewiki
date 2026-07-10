# Indexing and anchor-ledger workflow

> The deterministic core of livewiki. The indexer parses code into symbols and hashes them. The anchor-ledger walks the wiki, diffs anchor state against the symbol index, and emits **debt** events without spending an LLM token.

This is the workflow that powers both the **heart of the product** (incremental update in Phase 5) and the **first stage of batch** (full documentation in Phase 3).

## End-to-end flow

```
            ┌──────────────────┐
            │ walker.ts        │  respect .gitignore + defaults
            └─────────┬────────┘
                      │ file paths + lang
                      ▼
            ┌──────────────────┐
            │ parser.ts        │  web-tree-sitter (WASM, cached)
            └─────────┬────────┘
                      │ trees
                      ▼
            ┌──────────────────┐
            │ symbols.ts       │  AST → SymbolRecord[]
            └─────────┬────────┘
                      │ symbols + sha256 of slice
                      ▼
            ┌──────────────────┐
            │ db.ts (v4)       │  soft-delete + upsert in one TX
            └─────────┬────────┘
                      │ symbols table updated
                      ▼
            ┌──────────────────┐
            │ anchor-ledger.ts │  read wiki, diff anchors → debt
            └─────────┬────────┘
                      │ debt: changed | moved | deleted
                      ▼
            ┌──────────────────┐
            │ markdown rewrite │  via safe-io (NEVER for human/ manual)
            └──────────────────┘
```

Source: `packages/core/src/indexer.ts` orchestrates the first half; `packages/core/src/anchor-ledger.ts` orchestrates the second. The CLI chains them via `livewiki index` (`packages/cli/src/commands/index-cmd.ts`).

## Step 1 — `livewiki index` (entry)

- Auto-creates `.livewiki/` if missing (silent — it is a derived cache). If `livewiki/` is also missing, emits an informational note suggesting `livewiki init`; exit 0.
- Resolves `.livewiki/index.db` via `safe-io.resolveAndValidate` (symlink-safe).
- Walks the repo with `walker.ts`, parses with `parser.ts`, extracts symbols with `symbols.ts`, and upserts into the SQLite index in one transaction.
- Output: `IndexResult { filesScanned, filesAdded, filesUpdated, filesDeleted, filesUnchanged, symbolsAdded, symbolsDeleted, durationMs }`.

### `walker.ts`

- Always ignores (defense in depth): `node_modules/`, `.git/`, `.livewiki/`, `dist/`, `coverage/`.
- Extension → language: `.ts` → typescript, `.tsx`/`.jsx` → tsx, `.js`/`.mjs`/`.cjs` → javascript, `.py` → python.
- Uses the `ignore` npm lib for `.gitignore` semantics — same parser git uses.
- Symlinks are not followed (would loop or error — a signal of misconfiguration).
- Output: relative paths with forward slashes (cross-platform).

### `parser.ts`

- Lazy `Parser.init()` — called once at startup of any tool that parses; subsequent calls reuse the same promise.
- WASM grammars live in `packages/core/grammars/` and are resolved relative to that package's `package.json` (works in both `src/` and `dist/`).
- `languageCache` avoids re-loading the same `Language` object.

### `symbols.ts`

- TS / TSX / JS: `function_declaration`, `generator_function_declaration`, `class_declaration`, `method_definition` (parent = class), named `arrow_function`, `export_statement`.
- Python: `function_definition`, `class_definition`, `decorated_definition`.
- Anonymous functions are skipped — symbol keys must be referencable; the SPEC is explicit about this.
- Key format: `relative/path.ext#Name` for top-level; `relative/path.ext#Class.method` for methods.
- Each symbol carries a `content_hash` (`sha256` of the source slice between `start_byte` and `end_byte`) so changes inside an otherwise-unchanged file still surface.

### `db.ts`

- `CURRENT_SCHEMA_VERSION = 4`. Idempotent `SCHEMA_SQL` runs every `CREATE TABLE IF NOT EXISTS`; v3-or-older DBs are upgraded via `postV3Migrations()`.
- **Soft-delete on update** is the keystone: when a file changes, the old `symbols` rows are marked `status='deleted'` (their `content_hash` is preserved) instead of being hard-deleted. Without this, `moved` detection can't match a disappeared symbol against a freshly-appearing one.
- After the anchor-ledger pass, `deleted` rows whose key has an active replacement are purged; the table doesn't grow one dead row per symbol per edit.

## Step 2 — `runLedger` (anchor-ledger)

`packages/core/src/anchor-ledger.ts` (chained automatically by `livewiki index` unless `--no-ledger`):

1. Walk every `*.md` in `livewiki/`; parse frontmatter (`anchors:` list) and `<!-- lw:anchors … -->` markers.
2. Upsert into `anchors`. `in_manual_block` is derived: any anchor whose marker falls inside an `<!-- lw:manual --> … <!-- /lw:manual -->` block is flagged.
3. Diff each anchor against the current `symbols` table:
   - **changed** — symbol exists, `content_hash` differs from `symbol_hash_at_doc`.
   - **moved** — symbol disappeared from file A and appeared in file B with the same `content_hash` (primary) or the same `name + signature` (fallback). Update the anchor in the markdown (frontmatter + markers).
   - **deleted** — symbol no longer exists anywhere.
4. Assignee: `agent` for `owner: generated`/`mixed` pages (the generated portion can be rewritten); `human` for anchors inside `lw:manual` blocks or on `owner: human` pages (debt is generated, but **no markdown rewrite**).
5. Update `debt.symbol_key` (schema v3) so the debt survives anchor removal.
6. Update `undocumented` (new symbols with no anchor → `symbol_key` set, `dismissed=false`).

### `moved` detection rules

- **Prerequisite:** symbols that disappear from an updated file are soft-deleted first, preserving their old `content_hash`. Without that, there's nothing to match against.
- **Supersession is not moved.** Same `key`, different `content_hash` in the same file = re-index of the same symbol. No event.
- **Rewrite happens in markdown first, then DB.** Rule #3 — disk is the truth. Updating only the DB would lose the change on rebuild.
- **Manual block exception.** An anchor inside `<!-- lw:manual -->…<!-- /lw:manual -->` (or on a page where `owner: human`) is **not rewritten** — debt is emitted with `assignee=human` so `status --json` surfaces it for human review.
- **Dedup.** The partial index `idx_debt_open ON debt(anchor_id, event) WHERE resolved_at IS NULL` prevents re-flagging on every `index` run. Without it, the ledger becomes noise.

### Where to find more

- `anchor-ledger.test.ts` — exhaustive coverage of changed/moved/deleted/manual-block scenarios.
- `cli-e2e.test.ts` — runs the **real CLI binary** against a tmp repo so the soft-delete path is exercised end-to-end (Finding A of the Phase 2 review: unit tests alone bypass this because `runLedger` direct doesn't apply the soft-delete).
- `verify.ts` — fresh-from-disk verification; an anchor in a never-indexed page must still be caught.

## Performance budget (SPEC §Phase 1)

- 50k LOC first run: < 30s
- 50k LOC incremental: < 2s

Implementation notes (`indexer.ts` header docstring):

- All work in one SQLite transaction (atomic commit).
- `readFile` is sequential (I/O-bound on SSD; parallelism doesn't help).
- tree-sitter parsing is sequential (CPU-bound; one core at a time).

## CLI

```bash
livewiki index [--repo <path>] [--json] [--quiet] [--ignore <pattern>] [--no-ledger]
```

- `--quiet` suppresses human output without producing JSON. Hooks use this.
- `--no-ledger` skips the anchor-ledger pass (pure code reindex).
- Exit code: 0 on success, 1 on error.

## Status (read)

`livewiki status [--json] [--top N]` returns:

```jsonc
{
  "files":    { "total": N, "byLang": {...}, "top": [...] },
  "symbols":  { "total": N, "byKind": {...} },
  "debt":     { "total": N, "byEvent": {...}, "byAssignee": {...}, "items": [...] },
  "undocumented": { "total": N, "sample": [...] },
  "metrics":  { ... } | null,   // from update_metrics.json (Phase 5)
  "meta":     { ... }
}
```

Source: `packages/core/src/status.ts`. This is also the payload returned by the MCP `livewiki_debt` tool.

## Where to go next

- [Batch pipeline](batch-pipeline.md) — what indexer + ledger enable at scale.
- [Incremental update](incremental-update.md) — the work-package and the hooks that drive it.
- [Data model](../architecture/data-model.md) — anchor/debt/manual_blocks schema.