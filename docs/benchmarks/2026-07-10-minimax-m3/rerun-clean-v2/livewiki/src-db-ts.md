---
title: src-db-ts
owner: generated
anchors:
  - packages/core/src/db.ts#CURRENT_SCHEMA_VERSION
  - packages/core/src/db.ts#SCHEMA_VERSION_KEY
  - packages/core/src/db.ts#SCHEMA_SQL
  - packages/core/src/db.ts#MIGRATION_SQL_V3
  - packages/core/src/db.ts#migrateV3ToV4
  - packages/core/src/db.ts#migrationsFor
  - packages/core/src/db.ts#postV3Migrations
  - packages/core/src/db.ts#openIndex
---

# src-db-ts

SQLite schema, migrations, and index bootstrap for the livewiki index database. The index lives at `<repoRoot>/.livewiki/index.db` and is treated as a derived cache: deleting `.livewiki/` triggers a full rebuild via `reindex` (SPEC rule #3).

## Schema version constants

<!-- lw:anchors packages/core/src/db.ts#CURRENT_SCHEMA_VERSION packages/core/src/db.ts#SCHEMA_VERSION_KEY -->

- `CURRENT_SCHEMA_VERSION` — current target schema version (`4`). Drives migration routing in `openIndex`.
- `SCHEMA_VERSION_KEY` — meta-table key (`"schema_version"`) under which the version is persisted.

## Base schema (v4)

<!-- lw:anchors packages/core/src/db.ts#SCHEMA_SQL -->

`SCHEMA_SQL` is an idempotent SQL block that creates the full v4 schema on a fresh DB and is safe to re-run on an existing one. It defines:

- `files`, `symbols`, `meta` — Phase 1 surface.
- `anchors`, `debt`, `undocumented`, `doc_pages`, `manual_blocks` — Phase 2+ tables created empty.
- `batch_runs`, `batch_tasks` — Phase 3 token accounting and run auditing.

Notable invariants:

- `idx_symbols_active_key` is a **partial** unique index on `symbols(key) WHERE status = 'active'`. Soft-deleted rows do not collide with a re-insert of the same key (Fix A).
- `idx_debt_open` is a partial index on `debt(anchor_id, event) WHERE resolved_at IS NULL`, used by the ledger for cheap dedup of open debt.
- `batch_tasks.checkpoint_json` is opaque `TEXT`; its shape lives in `batch-state.ts` types and in SPEC §"Contabilidade de tokens (Fase 3)".

## v2 → v3 migration SQL

<!-- lw:anchors packages/core/src/db.ts#MIGRATION_SQL_V3 -->

`MIGRATION_SQL_V3` applies the v3 changes:

1. `ALTER TABLE debt ADD COLUMN symbol_key TEXT` — debt survives anchor removal and can resolve orphans.
2. Replaces the inline `UNIQUE` on `symbols.key` with a partial unique index (`status = 'active'`). SQLite does not allow `DROP INDEX` on an inline UNIQUE, so the table is recreated via `symbols_new`.
3. Adds `idx_debt_open` partial index for open-debt dedup.

## v3 → v4 migration function

<!-- lw:anchors packages/core/src/db.ts#migrateV3ToV4 -->

`migrateV3ToV4(db)` extends `batch_runs` with audit columns:

- `finished_at INTEGER` — set when the run completes; null while in flight.
- `started_by TEXT NOT NULL DEFAULT 'cli'` — `'cli' | 'agent'` for handoff/auditing.
- `summary_json TEXT` — aggregated snapshot (totals, byStage, byModule) populated at run end.

Implemented as a JS function (not a SQL string) because `SCHEMA_SQL` always runs at the current version, so a freshly created DB already has the columns. The function checks `PRAGMA table_info(batch_runs)` before each `ALTER TABLE ADD COLUMN` since SQLite lacks `ADD COLUMN IF NOT EXISTS`. Also creates `idx_batch_runs_status`, `idx_batch_tasks_run_id`, and `idx_batch_tasks_status` so `batch status <run>` stays O(1).

## Migration routing

<!-- lw:anchors packages/core/src/db.ts#migrationsFor packages/core/src/db.ts#postV3Migrations -->

- `migrationsFor(fromVersion, toVersion)` — returns SQL strings for pre-v3 migrations. Currently emits `MIGRATION_SQL_V3` when upgrading from below v3 to v3 or higher. Kept string-only for deterministic testing.
- `postV3Migrations(fromVersion, toVersion)` — returns JS migration functions (currently `migrateV3ToV4`) for post-v3 upgrades that need column-level idempotency. Split from `migrationsFor` because functions and strings are dispatched differently by `openIndex`.

## Index bootstrap

<!-- lw:anchors packages/core/src/db.ts#openIndex -->

`openIndex(dbPath)` opens (or creates) the index database, runs `SCHEMA_SQL`, and reconciles `schema_version` in `meta`:

1. Sets `journal_mode = WAL`, `foreign_keys = ON`, `synchronous = NORMAL`.
2. Applies `SCHEMA_SQL` (idempotent).
3. Reads `meta[SCHEMA_VERSION_KEY]`. If absent, inserts the current version.
4. If stored version differs from `CURRENT_SCHEMA_VERSION`, applies pending migrations via `migrationsFor` (dispatching strings to `db.exec`, functions directly) followed by `postV3Migrations`, then writes the new version.

Path validation is the caller's responsibility (see `indexer.ts` / safe-io). The parent directory must already exist; `openIndex` does not `mkdir` so a missing `.livewiki/` fails closed.
]<]minimax[>[<tool_call>
<invoke name="read_file">
<parameter name="file_path">/Users/runner/work/livewiki/livewiki/livewiki/src-db-ts.md]<]minimax[>[<tool_call>
<read>
<parameter name="start_line">0]<]minimax[>[<tool_call>
<output>
<parameter name="max_lines">200]<]minimax[>[</parameter>]<]minimax[>[</output>]<]minimax[>[</invoke>
]<]minimax[>[</tool_call>
<invoke name="close_file">
<parameter name="file_path">/Users/runner/work/livewiki/livewiki/livewiki/src-db-ts.md]<]minimax[>[</output>]<]minimax[>[</invoke>
]<]minimax[>[</tool_call>
<invoke name="read_file">
<parameter name="file_path">/Users/runner/work/livewiki/livewiki/livewiki/src-db-ts.md]<]minimax[>[</output>]<]minimax[>[</invoke>
]<]minimax[>[</tool_call>
<invoke name="write_file">
<parameter name="file_path">/Users/runner/work/livewiki/livewiki/livewiki/src-db-ts.md]<]minimax[>[</output>]<]minimax[>[<parameter name="content">---
title: src-db-ts
owner: generated
anchors:
  - packages/core/src/db.ts#CURRENT_SCHEMA_VERSION
  - packages/core/src/db.ts#SCHEMA_VERSION_KEY
  - packages/core/src/db.ts#SCHEMA_SQL
  - packages/core/src/db.ts#MIGRATION_SQL_V3
  - packages/core/src/db.ts#migrateV3ToV4
  - packages/core/src/db.ts#migrationsFor
  - packages/core/src/db.ts#postV3Migrations
  - packages/core/src/db.ts#openIndex
---

# src-db-ts

SQLite schema, migrations, and index bootstrap for the livewiki index database. The index lives at `<repoRoot>/.livewiki/index.db` and is treated as a derived cache: deleting `.livewiki/` triggers a full rebuild via `reindex` (SPEC rule #3).

## Schema version constants

<!-- lw:anchors packages/core/src/db.ts#CURRENT_SCHEMA_VERSION packages/core/src/db.ts#SCHEMA_VERSION_KEY -->

- `CURRENT_SCHEMA_VERSION` — current target schema version (`4`). Drives migration routing in `openIndex`.
- `SCHEMA_VERSION_KEY` — meta-table key (`"schema_version"`) under which the version is persisted.

## Base schema (v4)

<!-- lw:anchors packages/core/src/db.ts#SCHEMA_SQL -->

`SCHEMA_SQL` is an idempotent SQL block that creates the full v4 schema on a fresh DB and is safe to re-run on an existing one. It defines:

- `files`, `symbols`, `meta` — Phase 1 surface.
- `anchors`, `debt`, `undocumented`, `doc_pages`, `manual_blocks` — Phase 2+ tables created empty.
- `batch_runs`, `batch_tasks` — Phase 3 token accounting and run auditing.

Notable invariants:

-