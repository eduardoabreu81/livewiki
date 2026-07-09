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

export const CURRENT_SCHEMA_VERSION = 3;

export const SCHEMA_VERSION_KEY = "schema_version";

/**
 * Statements idempotentes — pode rodar em DB novo ou existente.
 *
 * Schema v3 (commit 6183214) adiciona:
 *   - debt.symbol_key — sobrevive ao anchor ser removida (resolve órfão)
 *   - idx_debt_open — índice parcial pra dedup de dívida aberta por (anchor_id, event)
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
  stage INTEGER NOT NULL,
  config_json TEXT NOT NULL,
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS batch_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES batch_runs(id) ON DELETE CASCADE,
  stage INTEGER NOT NULL,
  target TEXT NOT NULL,
  status TEXT NOT NULL,
  checkpoint_json TEXT,
  updated_at INTEGER NOT NULL
);

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
 * Migrações pendentes para uma versão alvo. Mapeadas por versão de destino.
 * Cada entry é o SQL pra aplicar quando o DB está em uma versão menor.
 */
export function migrationsFor(fromVersion: number, toVersion: number): string[] {
  const out: string[] = [];
  if (fromVersion < 3 && toVersion >= 3) out.push(MIGRATION_SQL_V3);
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
      // Aplica migrações pendentes antes de continuar.
      for (const sql of migrationsFor(stored, CURRENT_SCHEMA_VERSION)) {
        db.exec(sql);
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