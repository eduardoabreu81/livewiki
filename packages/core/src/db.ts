/**
 * db — SQLite schema + setup do índice.
 *
 * SPEC §"Schema do SQLite" lista as tabelas da Fase 2+. Na Fase 1 só precisamos
 * de `files`, `symbols` e `meta`. As outras tabelas são criadas vazias nas suas
 * respectivas fases — schema_version evita drift se o banco for aberto por
 * uma versão antiga.
 *
 * Regra #3 da SPEC: o banco é derivado. Tudo aqui é cache; a verdade está no
 * markdown do repo. Deletou `.livewiki/`? `reindex` reconstrói.
 *
 * Localização: `<repoRoot>/.livewiki/index.db` (caminho validado via safe-io).
 */

import Database from "better-sqlite3";
import * as nodePath from "node:path";

export const CURRENT_SCHEMA_VERSION = 7;

export const SCHEMA_VERSION_KEY = "schema_version";

/**
 * Statements idempotentes — pode rodar em DB novo ou existente.
 *
 * Schema v3 (commit 6183214) adiciona:
 *   - debt.symbol_key — sobrevive ao anchor ser removida (resolve órfão)
 *   - idx_debt_open — índice parcial pra dedup de dívida aberta por (anchor_id, event)
 *
 * Schema v4 (Fase 3 — contabilidade de tokens + batch resiliente):
 *   - batch_runs.started_by, finished_at, summary_json — auditoria completa do run
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

-- UNIQUE só em symbols ativos (Fix A — soft-delete em update preserva o
-- content_hash antigo; sem partial index, INSERT do novo violaria UNIQUE
-- porque o row antigo (mesmo key, status='deleted') ainda existe).
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
  resolved_at INTEGER
);

-- Dedup de dívida aberta por (anchor_id, event). Partial index WHERE
-- resolved_at IS NULL é leve (só linhas abertas) e cobre a query de checagem
-- usada pelo ledger em todo anchor.
CREATE INDEX IF NOT EXISTS idx_debt_open
  ON debt(anchor_id, event) WHERE resolved_at IS NULL;

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
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_batch_tasks_run_id ON batch_tasks(run_id);
CREATE INDEX IF NOT EXISTS idx_batch_tasks_status ON batch_tasks(run_id, status);

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
 * Migrações leves (v2 → v3): adiciona coluna `symbol_key` em `debt`, índice
 * parcial de dívida aberta, e substitui o UNIQUE inline em symbols.key por
 * um partial unique index (que respeita status='deleted').
 *
 * SQLite não permite `DROP INDEX` em índice UNIQUE inline (é parte do
 * schema da tabela). Recriamos a tabela `symbols` sem o UNIQUE inline e
 * adicionamos o índice parcial.
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
  ON debt(anchor_id, event) WHERE resolved_at IS NULL;
`;

/**
 * Migração v3 → v4 (Fase 3): estende batch_runs com auditoria do run.
 *   - finished_at: timestamp do término (null enquanto em andamento)
 *   - started_by: 'cli' | 'agent' — quem disparou o run (auditoria/handoff)
 *   - summary_json: snapshot agregado (totals, byStage, byModule) — populado
 *     ao final do run pra servir o reporte sem precisar re-processar tasks.
 *   - Índices em batch_runs.status e batch_tasks(run_id, status) — `batch
 *     status <run>` fica O(1) mesmo com muitos runs antigos.
 *
 * batch_tasks.checkpoint_json é TEXT livre — o shape vive em `batch-state.ts`
 * (TypeScript types) e em SPEC §"Contabilidade de tokens (Fase 3)".
 *
 * Por que função JS e não string SQL: o SCHEMA_SQL sempre roda com a versão
 * ATUAL (v4), o que significa que um DB recriado do zero já tem as colunas
 * novas. A migration precisa ser idempotente nesse caso — daí checar
 * PRAGMA table_info antes de ALTER TABLE ADD COLUMN (SQLite não tem
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
 * Migração v4 → v5 (Phase 3): adiciona a tabela `calls` (grafo de chamadas
 * por símbolo). `CREATE TABLE`/`CREATE INDEX ... IF NOT EXISTS` já são
 * idempotentes — reaproveita o mesmo trecho do SCHEMA_SQL em vez de duplicar,
 * então um DB recriado do zero e um DB migrado convergem pro mesmo shape.
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
 * Migrações pendentes para uma versão alvo. Mapeadas por versão de destino.
 * Cada entry é o SQL (string) OU a função (db) => void pra aplicar quando o
 * DB está em uma versão menor.
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
 * Migrações pós-v3 que precisam ser funções JS (idempotência em colunas).
 * Separadas de migrationsFor() porque executamos funções e strings de forma
 * diferente — e migrationsFor() precisa ser determinístico em testes.
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
  return out;
}

/**
 * Abre (ou cria) o banco de índice em `dbPath`. Roda migrations idempotentes
 * e grava `schema_version` em `meta`.
 *
 * Não valida path — caller (indexer.ts) já passou pelo safe-io.
 */
export function openIndex(dbPath: string): Database.Database {
  const dir = nodePath.dirname(dbPath);
  // O diretório .livewiki/ já foi criado pelo caller. Não usar mkdir recursivo
  // aqui pra falhar fechado se ele sumir entre o setup e a abertura.
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("synchronous = NORMAL");
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
      // Aplica migrações pendentes antes de continuar. `migrationsFor()` aceita
      // `string | ((db) => void)` — discriminamos por tipo porque db.exec só
      // aceita string (e funções precisam receber `db` direto, ver
      // postV3Migrations()).
      for (const migration of migrationsFor(stored, CURRENT_SCHEMA_VERSION)) {
        if (typeof migration === "function") {
          migration(db);
        } else {
          db.exec(migration);
        }
      }
      // Migrações pós-v3 (funções JS pra idempotência em colunas).
      for (const fn of postV3Migrations(stored, CURRENT_SCHEMA_VERSION)) {
        fn(db);
      }
      db.prepare(
        "UPDATE meta SET value = ? WHERE key = ?",
      ).run(String(CURRENT_SCHEMA_VERSION), SCHEMA_VERSION_KEY);
    }
  }

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