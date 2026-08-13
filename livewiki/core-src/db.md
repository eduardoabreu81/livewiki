---
title: SQLite schema and migrations for the livewiki index
owner: generated
anchors:
  - packages/core/src/db.ts#CURRENT_SCHEMA_VERSION
  - packages/core/src/db.ts#SCHEMA_VERSION_KEY
  - packages/core/src/db.ts#SCHEMA_SQL
  - packages/core/src/db.ts#MIGRATION_SQL_V3
  - packages/core/src/db.ts#migrateV3ToV4
  - packages/core/src/db.ts#migrateV4ToV5
  - packages/core/src/db.ts#migrateV5ToV6
  - packages/core/src/db.ts#migrateV6ToV7
  - packages/core/src/db.ts#migrateV7ToV8
  - packages/core/src/db.ts#migrationsFor
  - packages/core/src/db.ts#postV3Migrations
  - packages/core/src/db.ts#openIndex
---

# SQLite schema and migrations for the livewiki index

This page documents the module that owns the livewiki SQLite index: its schema, versioned migrations, and the entry point that opens or creates the database.

## When to use this page

- **Open or rebuild the index DB** when wiring up the indexer, by understanding what `openIndex` guarantees and what it does not validate.
- **Add a new table or column** to the index by following the schema + migration conventions already established (idempotent SQL in `SCHEMA_SQL`, JS function migration for column adds).
- **Trace how an existing DB upgrades** from an older schema_version to the current one, by reading the migration chain and dispatch logic.

## How it fits

The file `packages/core/src/db.ts` lives under `packages/core/src/`, the core package of livewiki. The DB itself is treated as a derived cache (rule #3 of the SPEC): the source of truth is the repository's markdown, and deleting `.livewiki/` forces a rebuild via `reindex`. The DB is stored at `<repoRoot>/.livewiki/index.db`; the path arrives at `openIndex` already validated by the safe-io helpers used in `indexer.ts`. Inside the package, this module is consumed by the indexer pipeline (file/symbol/call/rationale ingestion, batch bookkeeping) and by the read paths that issue `SELECT`s against the tables defined here. The schema covers Phase 1 tables (`files`, `symbols`, `meta`) up through Phase 3 additions (`calls`, `rationales`, batch run/task tables, debt ledger columns), so later phases get their tables created empty rather than waiting for a feature to land.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-db.mmd
```

## Schema constants and current version

<!-- lw:anchors packages/core/src/db.ts#CURRENT_SCHEMA_VERSION packages/core/src/db.ts#SCHEMA_VERSION_KEY packages/core/src/db.ts#SCHEMA_SQL -->

The module exposes the canonical "what version of the index am I targeting" constants and the idempotent SQL that creates every table the indexer relies on.

```ts
export const CURRENT_SCHEMA_VERSION = 8;
```

`CURRENT_SCHEMA_VERSION` is the integer version the rest of the file is written against; `openIndex` compares the stored `meta.schema_version` to this number and runs migrations when they differ.

```ts
export const SCHEMA_VERSION_KEY = "schema_version";
```

`SCHEMA_VERSION_KEY` is the row key in the `meta` table that records the stored version, so `openIndex` and `migrationsFor` agree on a single well-known string.

```ts
export const SCHEMA_SQL = `
...`;
```

`SCHEMA_SQL` is the idempotent CREATE-statement bundle for every table (`files`, `symbols`, `meta`, `anchors`, `debt`, `undocumented`, `batch_runs`, `batch_tasks`, `doc_pages`, `manual_blocks`, `calls`, `rationales`) plus their indexes; every statement uses `IF NOT EXISTS`, so it is safe to execute on a fresh DB and on an existing DB. Two design choices matter here: a partial unique index `idx_symbols_active_key ON symbols(key) WHERE status = 'active'` lets `symbols` rows with `status = 'deleted'` coexist with a reinserted active row of the same key, and `calls.confidence` defaults to `'inferred'` so pre-v7 edges stay conservative.

## Lightweight v2 → v3 migration

<!-- lw:anchors packages/core/src/db.ts#MIGRATION_SQL_V3 -->

One of the migrations is plain SQL, because the work is structural (column add + table rebuild) and SQLite handles it cleanly.

```ts
export const MIGRATION_SQL_V3 = `
...`;
```

`MIGRATION_SQL_V3` adds `debt.symbol_key` (so debt survives anchor removal), rebuilds the `symbols` table to drop the inline `UNIQUE(key)` in favor of a partial unique index that respects `status = 'deleted'`, and creates `idx_debt_open` for fast open-debt deduplication by `(anchor_id, event)`. It is included in `migrationsFor` because it is a self-contained SQL string that `db.exec` can run as-is.

## Post-v3 JS migrations

<!-- lw:anchors packages/core/src/db.ts#migrateV3ToV4 packages/core/src/db.ts#migrateV4ToV5 packages/core/src/db.ts#migrateV5ToV6 packages/core/src/db.ts#migrateV6ToV7 packages/core/src/db.ts#migrateV7ToV8 -->

From v4 onward, migrations are JS functions instead of SQL strings. The reason is idempotence: `SCHEMA_SQL` always runs the current shape, so a from-scratch DB already has the new columns — a SQL migration would fail re-running, but a JS function can check `PRAGMA table_info` and only `ALTER TABLE ADD COLUMN` when the column is missing (SQLite has no `ADD COLUMN IF NOT EXISTS`). Each function below is therefore safe to re-invoke on any DB whose version is at least its target.

### Adding run audit columns to `batch_runs`

```ts
export function migrateV3ToV4(db: Database.Database): void {
```
The function takes an open SQLite `Database` and returns nothing; it mutates the DB in place. `migrateV3ToV4` introspects `batch_runs` via `PRAGMA table_info`, adds `finished_at`, `started_by` (default `'cli'`), and `summary_json` only when missing, then ensures the supporting indexes (`idx_batch_runs_status`, `idx_batch_tasks_run_id`, `idx_batch_tasks_status`) exist. This is the audit/hand-off work described in Phase 3 of the SPEC: a `batch status <run>` query stays O(1) even with many historical runs.

### Adding the call-graph table

```ts
export function migrateV4ToV5(db: Database.Database): void {
```
The function takes an open SQLite `Database` and returns nothing. `migrateV4ToV5` creates the `calls` table plus its three indexes (`idx_calls_file_id`, `idx_calls_caller_key`, `idx_calls_resolved_callee_key`) using `IF NOT EXISTS`, so it is idempotent and converges on the same shape as `SCHEMA_SQL`.

### Adding the rationales (intent-evidence) table

```ts
export function migrateV5ToV6(db: Database.Database): void {
```
The function takes an open SQLite `Database` and returns nothing. `migrateV5ToV6` creates the `rationales` table for tagged-comment/docstring intent evidence and its `file_id`/`symbol_key` indexes, again with `IF NOT EXISTS` so the from-scratch and migrated shapes match.

### Tagging call edges with confidence

```ts
export function migrateV6ToV7(db: Database.Database): void {
```
The function takes an open SQLite `Database` and returns nothing. `migrateV6ToV7` checks `PRAGMA table_info(calls)` and adds `confidence TEXT NOT NULL DEFAULT 'inferred'` only if it is missing. The conservative default ensures pre-v7 edges — which have no recorded extraction shape — are treated as name guesses; a future resolution pass can only downgrade, not upgrade.

### Adding `debt.doc_page_id` and backfilling

```ts
export function migrateV7ToV8(db: Database.Database): void {
```
The function takes an open SQLite `Database` and returns nothing. `migrateV7ToV8` adds `debt.doc_page_id INTEGER` when missing, then runs an `UPDATE` that backfills the column from the matching `anchors.doc_page_id` for rows whose `anchor_id` still resolves. Like `debt.symbol_key`, this column is the durable page reference for a debt row: it survives anchor removal, so the LEFT JOIN in the debt report surfaces NULLs (unactionable rows) rather than dropping the debt silently.

## Migration dispatch

<!-- lw:anchors packages/core/src/db.ts#migrationsFor packages/core/src/db.ts#postV3Migrations -->

Two helpers split the migration list by execution shape: one returns SQL strings, the other returns JS functions. `openIndex` discriminates by `typeof migration === "function"` when iterating.

```ts
export function migrationsFor(
  fromVersion: number,
  toVersion: number,
): Array<string | ((db: Database.Database) => void)> {
```

`migrationsFor` takes a stored version and a target version (both numbers) and returns the list of pending migrations as either SQL strings or `(db) => void` functions; it currently emits `MIGRATION_SQL_V3` when `fromVersion < 3 && toVersion >= 3`, and otherwise returns an empty array.

```ts
export function postV3Migrations(
  fromVersion: number,
  toVersion: number,
): Array<(db: Database.Database) => void)> {
```

`postV3Migrations` takes the same version pair and returns only the post-v3 JS migration functions in order — `migrateV3ToV4` through `migrateV7ToV8` — guarded by the corresponding `fromVersion < N && toVersion >= N` bounds. Splitting the dispatch lets `migrationsFor` stay deterministic (used in tests) while letting `openIndex` call functions with the live `db` handle.

## Opening and upgrading the index

<!-- lw:anchors packages/core/src/db.ts#openIndex -->

`openIndex` is the entry point the indexer calls to obtain a usable `Database`. It does not validate the path — the caller (e.g. `indexer.ts`) is expected to have routed it through the safe-io helpers.

```ts
export function openIndex(dbPath: string): Database.Database {
```

The function takes the absolute path to `index.db` (a string) and returns an open `better-sqlite3` `Database`. It opens the file directly (it does not `mkdir` — the `.livewiki/` directory is created by the caller, so a missing directory fails closed), enables `journal_mode = WAL`, `foreign_keys = ON`, and `synchronous = NORMAL`, then runs `SCHEMA_SQL` to converge on the current shape. If `meta.schema_version` is absent it writes `CURRENT_SCHEMA_VERSION`; if a different version is stored it iterates `migrationsFor(stored, CURRENT_SCHEMA_VERSION)` (running strings via `db.exec` and functions with the live `db`), then iterates `postV3Migrations(stored, CURRENT_SCHEMA_VERSION)`, then updates the stored version. The result is a DB whose `meta.schema_version` matches `CURRENT_SCHEMA_VERSION` and whose tables/indexes match `SCHEMA_SQL`, regardless of whether the file was just created or carried over from a prior version.

## Tests

Covered by `packages/core/src/db.test.ts` (same-name test file on disk).
