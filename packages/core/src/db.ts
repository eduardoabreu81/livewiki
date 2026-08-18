/**
 * db — SQLite schema + index setup.
 *
 * SPEC §"SQLite schema" lists the Phase 2+ tables. In Phase 1 we only need
 * `files`, `symbols` and `meta`. The other tables are created empty in their
 * respective phases — schema_version avoids drift if the database is opened by
 * an old version.
 *
 * SPEC rule #3: the database is derived. Everything here is cache; the truth is
 * in the repo's markdown. Deleted `.livewiki/`? `reindex` rebuilds it.
 *
 * Location: `<repoRoot>/.livewiki/index.db` (path validated via safe-io).
 */

import Database from "better-sqlite3";
import * as nodePath from "node:path";

export const CURRENT_SCHEMA_VERSION = 10;

export const SCHEMA_VERSION_KEY = "schema_version";

/**
 * Idempotent statements — can run on a new or existing DB.
 *
 * Schema v3 (commit 6183214) adds:
 *   - debt.symbol_key — survives the anchor being removed (resolves the orphan)
 *   - idx_debt_open — partial index for open documentation work
 *
 * Schema v4 (Phase 3 — token accounting + resilient batch):
 *   - batch_runs.started_by, finished_at, summary_json — full run audit
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL UNIQUE,
  lang TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  size INTEGER NOT NULL,
  mtime INTEGER NOT NULL,
  indexed_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS symbols (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id INTEGER NOT NULL REFERENCES files(id),
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  signature TEXT,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
);

-- UNIQUE only on active symbols (Fix A — soft-delete in update preserves the
-- old content_hash; without the partial index, the new INSERT would violate the
-- UNIQUE because the old row (same key, status='deleted') still exists).
CREATE UNIQUE INDEX IF NOT EXISTS idx_symbols_active_key
  ON symbols(key) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_symbols_file_id ON symbols(file_id);
CREATE INDEX IF NOT EXISTS idx_symbols_status ON symbols(status);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS anchors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_page_id INTEGER,
  section_slug TEXT,
  symbol_key TEXT NOT NULL,
  symbol_hash_at_doc TEXT NOT NULL,
  in_manual_block INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS debt (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  anchor_id INTEGER,
  event TEXT NOT NULL,
  assignee TEXT NOT NULL,
  symbol_key TEXT,
  detail TEXT,
  detected_at INTEGER NOT NULL,
  resolved_at INTEGER,
  doc_page_id INTEGER
);

-- One open documentation work unit per symbol, page, and event. The COALESCE
-- expression gives legacy/null page references a stable comparison key.
CREATE INDEX IF NOT EXISTS idx_debt_open
  ON debt(symbol_key, COALESCE(doc_page_id, -1), event) WHERE resolved_at IS NULL;

CREATE TABLE IF NOT EXISTS undocumented (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol_key TEXT NOT NULL UNIQUE,
  detected_at INTEGER NOT NULL,
  dismissed INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS batch_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  started_by TEXT NOT NULL DEFAULT 'cli',
  stage INTEGER NOT NULL,
  config_json TEXT NOT NULL,
  status TEXT NOT NULL,
  summary_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_batch_runs_status ON batch_runs(status);

CREATE TABLE IF NOT EXISTS batch_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES batch_runs(id) ON DELETE CASCADE,
  stage INTEGER NOT NULL,
  target TEXT NOT NULL,
  status TEXT NOT NULL,
  checkpoint_json TEXT,
  updated_at INTEGER NOT NULL,
  -- Opaque per-execution claim token. NULL means unclaimed: a row that a
  -- previous version left 'running', or one whose lease was never taken.
  claim_id TEXT,
  -- Epoch ms after which the claim is void and the task may be re-claimed.
  lease_expires_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_batch_tasks_run_id ON batch_tasks(run_id);
CREATE INDEX IF NOT EXISTS idx_batch_tasks_status ON batch_tasks(run_id, status);
-- NOTE: idx_batch_tasks_claim is deliberately NOT here. SCHEMA_SQL runs before
-- migrations, and on a pre-v10 database batch_tasks exists without
-- lease_expires_at — CREATE INDEX would fail on a column that does not exist
-- yet. openIndex creates it after migrations, where both paths have the column.

CREATE TABLE IF NOT EXISTS doc_pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wiki_path TEXT NOT NULL UNIQUE,
  owner TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS manual_blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_page_id INTEGER NOT NULL REFERENCES doc_pages(id) ON DELETE CASCADE,
  start_offset INTEGER NOT NULL,
  end_offset INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_manual_blocks_doc_page_id ON manual_blocks(doc_page_id);

-- Schema v5 (Phase 3 — symbol call graph / blast radius): raw call sites
-- extracted per file, deterministically. Recomputed wholesale for a file
-- whenever it's reindexed (no soft-delete/move-tracking needed like
-- symbols — an edge has no identity worth preserving across a re-parse).
-- \`resolved_callee_key\` is filled by a separate resolution pass and stays
-- NULL for callees the resolver couldn't confidently match to one symbol
-- (dynamic dispatch, external/unindexed code, ambiguous name) — a raw,
-- unresolved row is still kept for the callee_name-only searches.
-- Schema v7 (roadmap item 8): \`confidence\` tags each edge as 'extracted'
-- (bare-identifier/constructor callee) or 'inferred' (member/attribute
-- access — receiver unknown). Resolution can only downgrade, never upgrade.
CREATE TABLE IF NOT EXISTS calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id INTEGER NOT NULL REFERENCES files(id),
  caller_key TEXT NOT NULL,
  callee_name TEXT NOT NULL,
  resolved_callee_key TEXT,
  line INTEGER NOT NULL,
  confidence TEXT NOT NULL DEFAULT 'inferred'
);

CREATE INDEX IF NOT EXISTS idx_calls_file_id ON calls(file_id);
CREATE INDEX IF NOT EXISTS idx_calls_caller_key ON calls(caller_key);
CREATE INDEX IF NOT EXISTS idx_calls_resolved_callee_key ON calls(resolved_callee_key);

-- Schema v6 (Etapa 2b — intent evidence): bounded rationale rows extracted
-- per file from tagged comments (WHY:/NOTE:/HACK:/TODO:/FIXME:) and
-- docstrings. Recomputed wholesale for a file whenever it's reindexed (no
-- soft-delete, same policy as calls). \`symbol_key\` is NULL for file-level
-- rationales that positional attribution could not attach to one symbol.
-- \`content_hash\` is the sha256 of the normalized text — it enables a future
-- "rationale changed" debt signal (not implemented yet).
CREATE TABLE IF NOT EXISTS rationales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id INTEGER NOT NULL REFERENCES files(id),
  symbol_key TEXT,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  start_line INTEGER NOT NULL,
  content_hash TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rationales_file_id ON rationales(file_id);
CREATE INDEX IF NOT EXISTS idx_rationales_symbol_key ON rationales(symbol_key);
`;

/**
 * Light migrations (v2 → v3): adds the `symbol_key` column in `debt`, the
 * partial open-debt index, and replaces the inline UNIQUE on symbols.key with
 * a partial unique index (which respects status='deleted').
 *
 * SQLite does not allow `DROP INDEX` on an inline UNIQUE index (it is part of
 * the table schema). We recreate the `symbols` table without the inline UNIQUE
 * and add the partial index.
 */
export const MIGRATION_SQL_V3 = `
ALTER TABLE debt ADD COLUMN symbol_key TEXT;

CREATE TABLE symbols_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id INTEGER NOT NULL REFERENCES files(id),
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  signature TEXT,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
);
INSERT INTO symbols_new (id, file_id, key, name, kind, signature, start_line, end_line, content_hash, status)
  SELECT id, file_id, key, name, kind, signature, start_line, end_line, content_hash, status FROM symbols;
DROP TABLE symbols;
ALTER TABLE symbols_new RENAME TO symbols;

CREATE UNIQUE INDEX IF NOT EXISTS idx_symbols_active_key
  ON symbols(key) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_symbols_file_id ON symbols(file_id);
CREATE INDEX IF NOT EXISTS idx_symbols_status ON symbols(status);

CREATE INDEX IF NOT EXISTS idx_debt_open
  ON debt(symbol_key, COALESCE(doc_page_id, -1), event) WHERE resolved_at IS NULL;
`;

/**
 * Migration v3 → v4 (Phase 3): extends batch_runs with the run audit.
 *   - finished_at: end timestamp (null while in progress)
 *   - started_by: 'cli' | 'agent' — who fired the run (audit/handoff)
 *   - summary_json: aggregated snapshot (totals, byStage, byModule) — populated
 *     at the end of the run to serve the report without re-processing tasks.
 *   - Indexes on batch_runs.status and batch_tasks(run_id, status) — `batch
 *     status <run>` becomes O(1) even with many old runs.
 *
 * batch_tasks.checkpoint_json is free TEXT — the shape lives in `batch-state.ts`
 * (TypeScript types) and in SPEC §"Token accounting (Phase 3)".
 *
 * Why a JS function and not a SQL string: SCHEMA_SQL always runs with the
 * CURRENT version (v4), which means a DB recreated from scratch already has the
 * new columns. The migration must be idempotent in that case — hence checking
 * PRAGMA table_info before ALTER TABLE ADD COLUMN (SQLite has no
 * `ADD COLUMN IF NOT EXISTS`).
 */
export function migrateV3ToV4(db: Database.Database): void {
  const cols = db.prepare("PRAGMA table_info(batch_runs)").all() as Array<{ name: string }>;
  const colNames = new Set(cols.map((c) => c.name));
  if (!colNames.has("finished_at")) {
    db.exec("ALTER TABLE batch_runs ADD COLUMN finished_at INTEGER");
  }
  if (!colNames.has("started_by")) {
    db.exec("ALTER TABLE batch_runs ADD COLUMN started_by TEXT NOT NULL DEFAULT 'cli'");
  }
  if (!colNames.has("summary_json")) {
    db.exec("ALTER TABLE batch_runs ADD COLUMN summary_json TEXT");
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_batch_runs_status ON batch_runs(status);
    CREATE INDEX IF NOT EXISTS idx_batch_tasks_run_id ON batch_tasks(run_id);
    CREATE INDEX IF NOT EXISTS idx_batch_tasks_status ON batch_tasks(run_id, status);
  `);
}

/**
 * Migration v4 → v5 (Phase 3): adds the `calls` table (call graph per symbol).
 * `CREATE TABLE`/`CREATE INDEX ... IF NOT EXISTS` are already idempotent — it
 * reuses the same statements as SCHEMA_SQL instead of duplicating, so a
 * from-scratch DB and a migrated DB converge to the same shape.
 */
export function migrateV4ToV5(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_id INTEGER NOT NULL REFERENCES files(id),
      caller_key TEXT NOT NULL,
      callee_name TEXT NOT NULL,
      resolved_callee_key TEXT,
      line INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_calls_file_id ON calls(file_id);
    CREATE INDEX IF NOT EXISTS idx_calls_caller_key ON calls(caller_key);
    CREATE INDEX IF NOT EXISTS idx_calls_resolved_callee_key ON calls(resolved_callee_key);
  `);
}

/**
 * Migration v5 → v6 (Etapa 2b): adds the `rationales` table (intent evidence
 * from tagged comments/docstrings). `CREATE TABLE`/`CREATE INDEX ... IF NOT
 * EXISTS` are already idempotent — reuses the same statements as SCHEMA_SQL
 * instead of duplicating, so a from-scratch DB and a migrated DB converge to
 * the same shape.
 */
export function migrateV5ToV6(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS rationales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_id INTEGER NOT NULL REFERENCES files(id),
      symbol_key TEXT,
      kind TEXT NOT NULL,
      text TEXT NOT NULL,
      start_line INTEGER NOT NULL,
      content_hash TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_rationales_file_id ON rationales(file_id);
    CREATE INDEX IF NOT EXISTS idx_rationales_symbol_key ON rationales(symbol_key);
  `);
}

/**
 * Migration v6 → v7 (roadmap item 8): adds `calls.confidence`
 * ('extracted' | 'inferred') — Graphify-style edge confidence tags.
 * JS function (not a SQL string) for idempotence: SCHEMA_SQL already
 * carries the column, so a from-scratch DB must not re-ADD it — check
 * PRAGMA table_info first (SQLite has no `ADD COLUMN IF NOT EXISTS`).
 * Existing rows keep the DEFAULT 'inferred' (conservative: a pre-v7 edge
 * has no recorded extraction shape, so it is treated as a name guess).
 */
export function migrateV6ToV7(db: Database.Database): void {
  const cols = db.prepare("PRAGMA table_info(calls)").all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "confidence")) {
    db.exec("ALTER TABLE calls ADD COLUMN confidence TEXT NOT NULL DEFAULT 'inferred'");
  }
}

/**
 * v8: debt.doc_page_id — the durable page reference for a debt row. Like
 * debt.symbol_key (Fix E), it survives anchor removal: the LEFT JOIN to
 * anchors/doc_pages in status's debt report returns NULLs for debts whose
 * anchor row is gone (page deleted or anchor edited out), leaving CLI and
 * MCP debt surfaces with unactionable rows (external review 2026-08-03).
 */
export function migrateV7ToV8(db: Database.Database): void {
  const cols = db.prepare("PRAGMA table_info(debt)").all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "doc_page_id")) {
    db.exec("ALTER TABLE debt ADD COLUMN doc_page_id INTEGER");
  }
  // Backfill from the anchor rows that still exist.
  db.exec(
    "UPDATE debt SET doc_page_id = (SELECT a.doc_page_id FROM anchors a WHERE a.id = debt.anchor_id) " +
      "WHERE doc_page_id IS NULL AND anchor_id IS NOT NULL",
  );
}

/**
 * v9: debt is a documentation work unit keyed by symbol, page, and event.
 * Removes duplicate open rows left by legitimate page + section anchors and
 * invalidates open `deleted` rows whose symbol is active again. Resolved rows
 * are historical payment records and remain byte-for-byte untouched.
 */
export function migrateV8ToV9(db: Database.Database): void {
  db.transaction(() => {
    db.exec("DROP INDEX IF EXISTS idx_debt_open");
    db.exec(`
      DELETE FROM debt
      WHERE resolved_at IS NULL
        AND id NOT IN (
          SELECT MIN(id)
          FROM debt
          WHERE resolved_at IS NULL
          GROUP BY symbol_key, COALESCE(doc_page_id, -1), event
        );

      DELETE FROM debt
      WHERE event = 'deleted'
        AND resolved_at IS NULL
        AND EXISTS (
          SELECT 1
          FROM symbols
          WHERE symbols.key = debt.symbol_key
            AND symbols.status = 'active'
        );

      CREATE INDEX idx_debt_open
        ON debt(symbol_key, COALESCE(doc_page_id, -1), event)
        WHERE resolved_at IS NULL;
    `);
  })();
}

/**
 * v10: batch_tasks.claim_id + batch_tasks.lease_expires_at — the agent
 * bootstrap queue hands one task to one executor at a time. Idempotent via
 * PRAGMA table_info because SCHEMA_SQL already carries both columns on a
 * from-scratch DB (SQLite has no `ADD COLUMN IF NOT EXISTS`).
 *
 * Existing rows are deliberately left with NULL in both columns. A pre-v10
 * database has no claim information, so any row it left in 'running' is
 * treated as unclaimed and is immediately re-claimable — which is exactly the
 * crash-recovery semantics that existed before this migration.
 */
export function migrateV9ToV10(db: Database.Database): void {
  const cols = db.prepare("PRAGMA table_info(batch_tasks)").all() as Array<{ name: string }>;
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("claim_id")) {
    db.exec("ALTER TABLE batch_tasks ADD COLUMN claim_id TEXT");
  }
  if (!names.has("lease_expires_at")) {
    db.exec("ALTER TABLE batch_tasks ADD COLUMN lease_expires_at INTEGER");
  }
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_batch_tasks_claim " +
      "ON batch_tasks(run_id, status, lease_expires_at)",
  );
}

/**
 * Pending migrations for a target version. Mapped by destination version. Each
 * entry is the SQL (string) OR the function (db) => void to apply when the DB is
 * at a lower version.
 */
export function migrationsFor(
  fromVersion: number,
  toVersion: number,
): Array<string | ((db: Database.Database) => void)> {
  const out: Array<string | ((db: Database.Database) => void)> = [];
  if (fromVersion < 3 && toVersion >= 3) out.push(MIGRATION_SQL_V3);
  return out;
}

/**
 * Post-v3 migrations that must be JS functions (column idempotence). Separated
 * from migrationsFor() because we execute functions and strings differently —
 * and migrationsFor() must be deterministic in tests.
 */
export function postV3Migrations(
  fromVersion: number,
  toVersion: number,
): Array<(db: Database.Database) => void> {
  const out: Array<(db: Database.Database) => void> = [];
  if (fromVersion < 4 && toVersion >= 4) out.push(migrateV3ToV4);
  if (fromVersion < 5 && toVersion >= 5) out.push(migrateV4ToV5);
  if (fromVersion < 6 && toVersion >= 6) out.push(migrateV5ToV6);
  if (fromVersion < 7 && toVersion >= 7) out.push(migrateV6ToV7);
  if (fromVersion < 8 && toVersion >= 8) out.push(migrateV7ToV8);
  if (fromVersion < 9 && toVersion >= 9) out.push(migrateV8ToV9);
  if (fromVersion < 10 && toVersion >= 10) out.push(migrateV9ToV10);
  return out;
}

/**
 * Opens (or creates) the index database at `dbPath`. Runs idempotent migrations
 * and writes `schema_version` in `meta`.
 *
 * Does not validate the path — the caller (indexer.ts) already went through
 * safe-io.
 */
export function openIndex(dbPath: string): Database.Database {
  const dir = nodePath.dirname(dbPath);
  // The .livewiki/ directory was already created by the caller. Do not use
  // recursive mkdir here so it fails closed if it vanishes between the setup and
  // the open.
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("synchronous = NORMAL");

  // SCHEMA_SQL carries the v9 index expression, which references columns that
  // pre-v8 databases do not have yet. A temporary legacy index with the same
  // name lets CREATE INDEX IF NOT EXISTS remain safe until migrations add the
  // columns; migrateV8ToV9 then replaces it with the current definition.
  const legacyDebt = db.prepare(
    "SELECT 1 AS hit FROM sqlite_master WHERE type = 'table' AND name = 'debt'",
  ).get() as { hit: number } | undefined;
  if (legacyDebt) {
    const debtColumns = db.prepare("PRAGMA table_info(debt)").all() as Array<{ name: string }>;
    const names = new Set(debtColumns.map((column) => column.name));
    if (!names.has("symbol_key") || !names.has("doc_page_id")) {
      db.exec(
        "CREATE INDEX IF NOT EXISTS idx_debt_open " +
          "ON debt(anchor_id, event) WHERE resolved_at IS NULL",
      );
    }
  }
  db.exec(SCHEMA_SQL);

  const versionRow = db
    .prepare("SELECT value FROM meta WHERE key = ?")
    .get(SCHEMA_VERSION_KEY) as { value: string } | undefined;

  if (!versionRow) {
    db.prepare(
      "INSERT INTO meta (key, value) VALUES (?, ?)",
    ).run(SCHEMA_VERSION_KEY, String(CURRENT_SCHEMA_VERSION));
  } else {
    const stored = Number.parseInt(versionRow.value, 10);
    if (stored !== CURRENT_SCHEMA_VERSION) {
      // Applies pending migrations before continuing. `migrationsFor()` accepts
      // `string | ((db) => void)` — we discriminate by type because db.exec only
      // accepts a string (and functions must receive `db` directly, see
      // postV3Migrations()).
      for (const migration of migrationsFor(stored, CURRENT_SCHEMA_VERSION)) {
        if (typeof migration === "function") {
          migration(db);
        } else {
          db.exec(migration);
        }
      }
      // Post-v3 migrations (JS functions for column idempotence).
      for (const fn of postV3Migrations(stored, CURRENT_SCHEMA_VERSION)) {
        fn(db);
      }
      db.prepare(
        "UPDATE meta SET value = ? WHERE key = ?",
      ).run(String(CURRENT_SCHEMA_VERSION), SCHEMA_VERSION_KEY);
    }
  }

  // Claim index, created only here: it spans lease_expires_at, which a
  // from-scratch DB gets from SCHEMA_SQL above and a migrated DB gets from
  // migrateV9ToV10 — neither of which has run by the time SCHEMA_SQL executes
  // on a pre-v10 file.
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_batch_tasks_claim " +
      "ON batch_tasks(run_id, status, lease_expires_at)",
  );

  return db;
}

export type FileRow = {
  id: number;
  path: string;
  lang: string;
  content_hash: string;
  size: number;
  mtime: number;
  indexed_at: number;
  /**
   * Soft-delete marker. A row leaves the walk (removed, renamed, newly
   * ignored) as 'deleted' and keeps its history for move detection; it
   * returns to 'active' when the file reappears. Consumers filter on this,
   * so readers of a `SELECT *` row MUST honor it — omitting it here is what
   * let the indexer treat status as write-only.
   */
  status: "active" | "deleted";
};

export type SymbolRow = {
  id: number;
  file_id: number;
  key: string;
  name: string;
  kind: string;
  signature: string | null;
  start_line: number;
  end_line: number;
  content_hash: string;
  status: string;
};

export type CallRow = {
  id: number;
  file_id: number;
  caller_key: string;
  callee_name: string;
  resolved_callee_key: string | null;
  line: number;
  confidence: string;
};

export type RationaleRow = {
  id: number;
  file_id: number;
  symbol_key: string | null;
  kind: string;
  text: string;
  start_line: number;
  content_hash: string;
};
