---
title: SQLite Schema and Index Migration
owner: generated
anchors:
- packages/core/src/db.ts#CURRENT_SCHEMA_VERSION
- packages/core/src/db.ts#MIGRATION_SQL_V3
- packages/core/src/db.ts#SCHEMA_SQL
- packages/core/src/db.ts#SCHEMA_VERSION_KEY
- packages/core/src/db.ts#migrateV3ToV4
- packages/core/src/db.ts#migrateV4ToV5
- packages/core/src/db.ts#migrateV5ToV6
- packages/core/src/db.ts#migrateV6ToV7
- packages/core/src/db.ts#migrateV7ToV8
- packages/core/src/db.ts#migrateV8ToV9
- packages/core/src/db.ts#migrationsFor
- packages/core/src/db.ts#openIndex
- packages/core/src/db.ts#postV3Migrations
---

# SQLite Schema and Index Migration

This page details the SQLite database schema, its creation, and the versioned migration path that keeps an existing index compatible with new features.

## When to use this page

- Understand the tables and indexes that make up the livewiki index database and what each one stores.
- Learn how the database is opened, initialized, and upgraded from an older schema version.
- Modify or extend the schema by adding a new table, column, or index and the corresponding migration function.

## How it fits

`packages/core/src/db.ts` is the single owner of the SQLite index database (`<repoRoot>/.livewiki/index.db`). It declares the full schema as SQL, a set of versioned migration functions, and the routine that opens a database and applies the necessary migrations. This database is a derived cache: all data can be rebuilt by reindexing the repository, and the source of truth is the markdown in the repository. The module is consumed by indexers and other core components that need to read or write the index.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-db.mmd
```

## Schema Definition and Versioning

<!-- lw:anchors packages/core/src/db.ts#CURRENT_SCHEMA_VERSION packages/core/src/db.ts#SCHEMA_VERSION_KEY packages/core/src/db.ts#SCHEMA_SQL -->

The module's purpose is to define the durable, reproducible shape of the index. It does this by declaring the current schema version, the key used to track that version, and the SQL that creates the complete database from scratch.

`CURRENT_SCHEMA_VERSION` is a constant set to `10`, representing the latest schema revision the code understands. `SCHEMA_VERSION_KEY` is the string `"schema_version"`, used as the primary key in the `meta` table to store the database's current version. These two constants allow `openIndex` to detect when a database on disk is older than the code expects and to trigger the upgrade path.

`SCHEMA_SQL` is a large SQL string that creates every table and index with `IF NOT EXISTS` guards, making it idempotent — it runs safely on a brand-new database or an existing one. The schema covers the core indexing tables (`files`, `symbols`, `meta`), documentation work tracking (`anchors`, `debt`, `undocumented`), batch execution state (`batch_runs`, `batch_tasks`), generated documentation pages (`doc_pages`, `manual_blocks`), the symbol call graph (`calls`), and intent evidence (`rationales`). Each table is designed for a specific data lifecycle: `symbols` uses a partial unique index so that soft-deleted rows (status `'deleted'`) do not block re-inserting the same key; `debt` uses a partial index on unresolved rows to efficiently find open documentation work. `batch_tasks` carries `claim_id` and `lease_expires_at`, the per-execution claim the agent bootstrap queue uses to hand one task to exactly one executor. The schema is the canonical definition, and migration functions reuse the same statements where possible so a migrated database converges to the same shape as a fresh one.

One index is deliberately absent from `SCHEMA_SQL`: `idx_batch_tasks_claim` spans `lease_expires_at`, and `SCHEMA_SQL` runs *before* migrations, so on a pre-v10 database `CREATE INDEX` would reference a column that does not exist yet. `openIndex` creates that index after the migration step instead, where both the from-scratch and the migrated path already have the column.

## Legacy Migration SQL (v2 → v3)

<!-- lw:anchors packages/core/src/db.ts#MIGRATION_SQL_V3 -->

This section covers the first migration, which is expressed as a plain SQL string because it handles structural table changes that are difficult to express as idempotent JavaScript.

`MIGRATION_SQL_V3` upgrades a database from version 2 to version 3. It adds a `symbol_key` column to the `debt` table, which survives anchor removal and helps resolve orphaned debt rows. It also rebuilds the `symbols` table without the inline `UNIQUE` constraint on `key` (which the original schema declared as part of the table definition, not a separate index, so it cannot be dropped) and replaces it with a partial unique index that only applies to active rows. Finally, it recreates the `idx_debt_open` partial index that keys open documentation work by symbol, page, and event. The `INSERT INTO symbols_new ... SELECT FROM symbols` pattern preserves all existing rows during the table reconstruction.

## Post-V3 Migration Functions

### v3 → v4: Batch Run Audit

<!-- lw:anchors packages/core/src/db.ts#migrateV3ToV4 -->

This migration extends the `batch_runs` table with audit fields needed for the Phase 3 token accounting and resilient batch execution.

`export function migrateV3ToV4(db: Database.Database): void`
This function takes a database handle and returns nothing, adding columns to the `batch_runs` table to capture more information about each batch run.

The function checks the existing columns of `batch_runs` using `PRAGMA table_info` and only adds the missing ones (`finished_at`, `started_by`, `summary_json`) via `ALTER TABLE` because SQLite has no `ADD COLUMN IF NOT EXISTS`. It also creates the indexes on `batch_runs.status` and `batch_tasks(run_id, status)` with `IF NOT EXISTS` so that status queries on old runs remain fast. The `started_by` column records whether a CLI or an agent initiated the run, while `summary_json` stores an aggregate snapshot for reporting without reprocessing tasks.

### v4 → v5: Call Graph Table

<!-- lw:anchors packages/core/src/db.ts#migrateV4ToV5 -->

This migration introduces the `calls` table, which stores raw call sites between symbols to support blast-radius analysis.

`export function migrateV4ToV5(db: Database.Database): void`
This function takes a database handle and returns nothing, creating the `calls` table and its indexes if they do not already exist.

The function reuses the same `CREATE TABLE IF NOT EXISTS calls` and `CREATE INDEX IF NOT EXISTS` statements present in `SCHEMA_SQL` rather than duplicating them. An edge has no identity worth preserving across a re-parse, so call rows are recomputed wholesale when a file is reindexed. The `resolved_callee_key` column is populated later by a separate resolution pass and stays `NULL` for callees that could not be confidently mapped to a single symbol.

### v5 → v6: Rationale Evidence Table

<!-- lw:anchors packages/core/src/db.ts#migrateV5ToV6 -->

This migration adds the `rationales` table, which stores intent evidence extracted from tagged comments and docstrings.

`export function migrateV5ToV6(db: Database.Database): void`
This function takes a database handle and returns nothing, creating the `rationales` table and its indexes if they are not already present.

The function reuses the `CREATE TABLE IF NOT EXISTS rationales` and `CREATE INDEX IF NOT EXISTS` statements from `SCHEMA_SQL`, so a from-scratch database and a migrated one converge to the same structure. A `symbol_key` of `NULL` is allowed for file-level rationales that positional attribution could not attach to one symbol, and `content_hash` holds the SHA-256 of the normalized text for a future "rationale changed" signal.

### v6 → v7: Call Confidence Column

<!-- lw:anchors packages/core/src/db.ts#migrateV6ToV7 -->

This migration adds a `confidence` column to the `calls` table to tag each call edge as either extracted or inferred.

`export function migrateV6ToV7(db: Database.Database): void`
This function takes a database handle and returns nothing, adding a `confidence` column to `calls` if it is missing.

Because `SCHEMA_SQL` already includes the column, a fresh database must not re-add it; the function checks the actual columns of `calls` via `PRAGMA table_info` and only runs `ALTER TABLE calls ADD COLUMN confidence TEXT NOT NULL DEFAULT 'inferred'` when the column is absent. Existing rows keep the default `'inferred'`, which is conservative because a pre-v7 edge has no recorded extraction shape and is therefore treated as a name guess.

### v7 → v8: Durable Debt Page Reference

<!-- lw:anchors packages/core/src/db.ts#migrateV7ToV8 -->

This migration adds `debt.doc_page_id`, a durable page reference for debt rows, so that a debt item remains actionable even if its anchor row is later removed.

`export function migrateV7ToV8(db: Database.Database): void`
This function takes a database handle and returns nothing, adding a `doc_page_id` column to the `debt` table and backfilling it from existing anchor rows.

The function first checks whether `debt` already has the column, adding it via `ALTER TABLE` if not. It then runs an `UPDATE` that backfills `doc_page_id` from the `anchors` table for any debt rows that have an `anchor_id` but no `doc_page_id`, leaving rows with a dangling anchor reference untouched so that CLI and MCP debt surfaces do not show unactionable rows.

### v8 → v9: Deduplicate Open Debt

<!-- lw:anchors packages/core/src/db.ts#migrateV8ToV9 -->

This migration cleans up the `debt` table so that each open documentation work unit is keyed uniquely by symbol, page, and event.

`export function migrateV8ToV9(db: Database.Database): void`
This function takes a database handle and returns nothing, running a transaction that removes duplicate open debt rows and invalidates stale `'deleted'` rows.

The function drops the old `idx_debt_open` index, then deletes duplicate open rows that share the same `symbol_key`, `doc_page_id`, and `event` (keeping only the lowest `id`). It also deletes open `event = 'deleted'` rows whose symbol is now `'active'`, because those debt items are no longer valid. Finally, it recreates `idx_debt_open` with the current definition. The whole operation runs inside `db.transaction()` so that a failure leaves the database unchanged. Resolved rows are never touched because they are historical payment records.

## Selecting and Applying Migrations

<!-- lw:anchors packages/core/src/db.ts#migrationsFor packages/core/src/db.ts#postV3Migrations -->

This section covers the two functions that decide which migrations to run for a database at a given version. The first handles the single legacy SQL migration, while the second returns the ordered list of post-V3 JavaScript functions.

`export function migrationsFor(
  fromVersion: number,
  toVersion: number,
): Array<string | ((db: Database.Database) => void)>`
This function takes the current database version and the target version, and returns an array of migration steps (either SQL strings or functions) needed to move from the first to the second. It currently only pushes `MIGRATION_SQL_V3` when `fromVersion < 3` and `toVersion >= 3`, because that is the only migration that must be applied as raw SQL.

`export function postV3Migrations(
  fromVersion: number,
  toVersion: number,
): Array<(db: Database.Database) => void>`
This function takes the current database version and the target version, and returns an array of migration functions that must run after the legacy SQL migration. It pushes a migration function for each version boundary crossed, in order: `migrateV3ToV4`, `migrateV4ToV5`, `migrateV5ToV6`, `migrateV6ToV7`, `migrateV7ToV8`, `migrateV8ToV9`, and `migrateV9ToV10`. These functions are separated so that deterministic tests can control which migrations run, and because the caller executes SQL strings and JavaScript functions differently.

### v9 → v10: Claim and Lease Columns on `batch_tasks`

`migrateV9ToV10` adds `claim_id` and `lease_expires_at` to `batch_tasks`, guarding each `ALTER TABLE` behind `PRAGMA table_info` because SQLite has no `ADD COLUMN IF NOT EXISTS` and `SCHEMA_SQL` already carries both columns on a from-scratch database. It also creates `idx_batch_tasks_claim`.

Existing rows are deliberately left with `NULL` in both columns. A pre-v10 database holds no claim information, so any row it left in `'running'` reads as unclaimed and is immediately re-claimable — which is exactly the crash-recovery behavior that existed before the claim was introduced.

## Database Opening and Initialization

<!-- lw:anchors packages/core/src/db.ts#openIndex -->

This section explains the core routine that opens (or creates) the index database, applies any pending migrations, and records the schema version.

`export function openIndex(dbPath: string): Database.Database`
This function takes the filesystem path to the database file and returns an open, migrated, write-enabled SQLite database handle.

The function first derives the directory from `dbPath` and creates a `better-sqlite3` `Database` instance without recursive `mkdir`, so it fails closed if the `.livewiki/` directory disappears between setup and open. It then sets pragmatic pragmas: WAL journal mode for concurrent access, `foreign_keys = ON` for referential integrity, and `synchronous = NORMAL` for a good durability/performance trade-off.

Because `SCHEMA_SQL` references the v9 `idx_debt_open` index expression (which needs `symbol_key` and `doc_page_id` columns that pre-v8 databases lack), the function first checks whether a `debt` table exists and, if so, whether it is missing either column. In that case it creates a temporary legacy index on `(anchor_id, event)` using the same name, so that the subsequent `CREATE INDEX IF NOT EXISTS` in `SCHEMA_SQL` is safe until the migrations add the columns.

After running `SCHEMA_SQL`, the function reads the `schema_version` value from the `meta` table. If there is no version row, it inserts the current `CURRENT_SCHEMA_VERSION`.

The compatibility gate for a newer database runs **first**, immediately after the handle is opened and before `journal_mode`, the legacy-index bootstrap, `SCHEMA_SQL`, any migration or any version write. It runs only for a file that existed **before** this call — captured with `existsSync` before the handle, since once SQLite opens the path the distinction is gone — and delegates to `assertExistingIndexIsUsable`, which reads and never writes.

That helper defines "effectively empty" strictly: **zero user objects in `sqlite_master`** (SQLite's own `sqlite_*` entries excluded). Such a file carries no state whose provenance could be in question and is treated exactly like a brand-new one. The absence of `schema_version` is deliberately **not** used as that evidence, because a file can hold a fully populated `debt` or `batch_runs` table and still have lost its version row.

With objects present, two refusals follow. A missing `meta` table, or a `meta` without `schema_version`, is `missing_version`: which migrations the file has already been through cannot be determined, and stamping CURRENT there would declare work complete that never ran — `CREATE TABLE IF NOT EXISTS` adds missing tables but never adds missing COLUMNS to tables that already exist, so a v3-shaped `debt` would end up labelled v10 without `symbol_key` or `doc_page_id`. The index is derived data, so the message says to delete it and run `livewiki index`. A version **higher** than `CURRENT_SCHEMA_VERSION` is `newer_index`. Placement is the property, not just the check: rejecting after those steps still re-journalled the file and recreated dropped tables and indexes, which is the opposite of failing closed. The guard matters because every migration list is keyed on `fromVersion < X`: a database from a newer build selects zero migrations, so without the guard it fell through to the update below and rewrote `schema_version` *downwards* — relabelling, say, a v10 index as v9 while leaving the tables exactly as the newer build had left them. Migrations are never run in reverse, and a version lower than the one already recorded is never written.

Otherwise, when the stored version is lower, it applies the migrations from `migrationsFor(stored, CURRENT_SCHEMA_VERSION)` (running each entry either as `db.exec` on a string or by invoking it as a function), then every function from `postV3Migrations(stored, CURRENT_SCHEMA_VERSION)` in order, and finally updates the `meta` table to the current version.

After the migration step — and only there — it creates `idx_batch_tasks_claim`. That index spans `lease_expires_at`, a column a pre-v10 file does not have while `SCHEMA_SQL` is running; creating it last is what lets both the from-scratch path (column from `SCHEMA_SQL`) and the migrated path (column from `migrateV9ToV10`) converge on the same indexes. It then returns the ready-to-use database handle. The function deliberately does not validate the path because the caller has already passed it through safe-io.

`openIndex` is the **writer's** entry point: it creates the file, runs DDL, migrates, and stamps the version. Commands that only query must not do any of that, and use `openIndexReadOnly` instead.

`export function openIndexReadOnly(dbPath: string): Database.Database` opens an **existing** index for querying only. It creates nothing, runs no `SCHEMA_SQL`, applies no migration, creates no index, and never writes `schema_version`. It opens with `readonly: true`, applies only session-scoped pragmas (`busy_timeout`; notably **not** `journal_mode`, which rewrites the file header), then validates the recorded version and refuses with an instruction when it cannot serve the query honestly: `missing_database` (run `livewiki index`), `missing_version`, `older_index` (run `livewiki index` to migrate), or `newer_index` (update LiveWiki).

Two problems motivated the split. A pending migration turned every read into a write that waits on the write lock — measured as `SQLITE_BUSY` after the full busy timeout while another process held a transaction, where a plain read-only connection answered in about 2 ms. And a build whose `CURRENT_SCHEMA_VERSION` was lower than the database's would migrate, or relabel, an index belonging to a newer build. `readonly: true` is safe on a WAL database even when no `-wal`/`-shm` sidecars exist: SQLite materialises the shared memory it needs without modifying the database.

`SchemaAccessError` carries `kind`, `stored` and `current`, and its message names the corrective action rather than surfacing a raw SQLite error or a misleading "database is locked".

## Tests

Covered by `packages/core/src/db.test.ts` (same-name test file on disk).
