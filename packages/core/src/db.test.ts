import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as nodePath from "node:path";
import * as nodeOs from "node:os";
import * as nodeFs from "node:fs/promises";
import { openIndex, CURRENT_SCHEMA_VERSION, SCHEMA_VERSION_KEY } from "./db.js";

let dbPath: string;

beforeEach(async () => {
  const dir = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "livewiki-db-"));
  dbPath = nodePath.join(dir, "index.db");
});

afterEach(async () => {
  await nodeFs.rm(nodePath.dirname(dbPath), { recursive: true, force: true });
});

describe("db.openIndex", () => {
  it("cria o banco e seta schema_version na primeira abertura", () => {
    const db = openIndex(dbPath);
    try {
      const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(SCHEMA_VERSION_KEY) as
        | { value: string }
        | undefined;
      expect(row?.value).toBe(String(CURRENT_SCHEMA_VERSION));
    } finally {
      db.close();
    }
  });

  it("cria todas as tabelas esperadas", () => {
    const db = openIndex(dbPath);
    try {
      const tables = (db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      ).all() as { name: string }[]).map((r) => r.name);

      expect(tables).toContain("files");
      expect(tables).toContain("symbols");
      expect(tables).toContain("meta");
      // Tabelas de Fase 2/3 já criadas vazias (schema_version atual)
      expect(tables).toContain("anchors");
      expect(tables).toContain("debt");
      expect(tables).toContain("undocumented");
      expect(tables).toContain("batch_runs");
      expect(tables).toContain("batch_tasks");
      expect(tables).toContain("doc_pages");
      expect(tables).toContain("calls");
      expect(tables).toContain("rationales");
    } finally {
      db.close();
    }
  });

  it("idempotente: rodar 2x não duplica tabelas", () => {
    openIndex(dbPath).close();
    const db = openIndex(dbPath);
    try {
      const tables = (db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      ).all() as { name: string }[]).map((r) => r.name);
      // unique
      const unique = new Set(tables);
      expect(unique.size).toBe(tables.length);
    } finally {
      db.close();
    }
  });

  it("journal_mode = WAL e foreign_keys = ON", () => {
    const db = openIndex(dbPath);
    try {
      const jm = db.pragma("journal_mode", { simple: true });
      expect(jm).toBe("wal");
      const fk = db.pragma("foreign_keys", { simple: true });
      expect(fk).toBe(1);
    } finally {
      db.close();
    }
  });

  it("WAL gera arquivos -wal e -shm ao lado do .db", () => {
    const db = openIndex(dbPath);
    try {
      // Forçar write pra materializar o WAL
      db.prepare("INSERT INTO meta (key, value) VALUES ('probe', '1')").run();
      db.pragma("wal_checkpoint(PASSIVE)");
    } finally {
      db.close();
    }
  });

  it("atualiza schema_version se CURRENT_SCHEMA_VERSION mudou (migration leve)", () => {
    // Simula DB com schema v2 (sem a coluna symbol_key em debt, sem partial
    // unique index em symbols, sem idx_debt_open). openIndex deve aplicar
    // a migração v2→v3.
    const Database = require("better-sqlite3");
    const legacyDb = new Database(dbPath);
    legacyDb.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO meta VALUES ('schema_version', '2');
      CREATE TABLE debt (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        anchor_id INTEGER,
        event TEXT NOT NULL,
        assignee TEXT NOT NULL,
        detail TEXT,
        detected_at INTEGER NOT NULL,
        resolved_at INTEGER
      );
      CREATE TABLE symbols (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_id INTEGER NOT NULL,
        key TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        signature TEXT,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active'
      );
    `);
    legacyDb.close();

    const db = openIndex(dbPath);
    try {
      // schema_version atualizado
      const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(SCHEMA_VERSION_KEY) as
        | { value: string }
        | undefined;
      expect(row?.value).toBe(String(CURRENT_SCHEMA_VERSION));

      // Migração v3 aplicada: debt.symbol_key existe
      const debtCols = db.prepare("PRAGMA table_info(debt)").all() as Array<{ name: string }>;
      expect(debtCols.some((c) => c.name === "symbol_key")).toBe(true);

      // idx_debt_open existe
      const indexes = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_debt_open'")
        .all() as Array<{ name: string }>;
      expect(indexes.length).toBe(1);

      // idx_symbols_active_key existe
      const symIdx = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_symbols_active_key'")
        .all() as Array<{ name: string }>;
      expect(symIdx.length).toBe(1);
    } finally {
      db.close();
    }
  });

  it("migra v3 → v4: batch_runs ganha finished_at, started_by, summary_json + índices", () => {
    // Simula DB com schema v3 — batch_runs SEM as colunas novas.
    const Database = require("better-sqlite3");
    const legacyDb = new Database(dbPath);
    legacyDb.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO meta VALUES ('schema_version', '3');
      CREATE TABLE batch_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at INTEGER NOT NULL,
        stage INTEGER NOT NULL,
        config_json TEXT NOT NULL,
        status TEXT NOT NULL
      );
    `);
    legacyDb.close();

    const db = openIndex(dbPath);
    try {
      // schema_version atualizado pra v4
      const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(SCHEMA_VERSION_KEY) as
        | { value: string }
        | undefined;
      expect(row?.value).toBe(String(CURRENT_SCHEMA_VERSION));

      // Colunas novas em batch_runs
      const cols = db.prepare("PRAGMA table_info(batch_runs)").all() as Array<{ name: string }>;
      const colNames = cols.map((c) => c.name);
      expect(colNames).toContain("finished_at");
      expect(colNames).toContain("started_by");
      expect(colNames).toContain("summary_json");

      // Índices novos
      const idx = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_batch_%' ORDER BY name")
        .all() as Array<{ name: string }>;
      const idxNames = idx.map((i) => i.name);
      expect(idxNames).toContain("idx_batch_runs_status");
      expect(idxNames).toContain("idx_batch_tasks_run_id");
      expect(idxNames).toContain("idx_batch_tasks_status");
    } finally {
      db.close();
    }
  });

  it("migra v4 → v5: cria a tabela calls + índices", () => {
    // Simula DB com schema v4 — sem a tabela calls.
    const Database = require("better-sqlite3");
    const legacyDb = new Database(dbPath);
    legacyDb.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO meta VALUES ('schema_version', '4');
      CREATE TABLE files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL UNIQUE,
        lang TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        size INTEGER NOT NULL,
        mtime INTEGER NOT NULL,
        indexed_at INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'active'
      );
    `);
    legacyDb.close();

    const db = openIndex(dbPath);
    try {
      const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(SCHEMA_VERSION_KEY) as
        | { value: string }
        | undefined;
      expect(row?.value).toBe(String(CURRENT_SCHEMA_VERSION));

      const tables = (db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      ).all() as { name: string }[]).map((r) => r.name);
      expect(tables).toContain("calls");

      const idx = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_calls_%' ORDER BY name")
        .all() as Array<{ name: string }>;
      const idxNames = idx.map((i) => i.name);
      expect(idxNames).toContain("idx_calls_file_id");
      expect(idxNames).toContain("idx_calls_caller_key");
      expect(idxNames).toContain("idx_calls_resolved_callee_key");
    } finally {
      db.close();
    }
  });

  it("migrates v5 → v6: creates the rationales table + indices", () => {
    // Simulates a v5 DB — everything except the rationales table.
    const Database = require("better-sqlite3");
    const legacyDb = new Database(dbPath);
    legacyDb.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO meta VALUES ('schema_version', '5');
      CREATE TABLE files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL UNIQUE,
        lang TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        size INTEGER NOT NULL,
        mtime INTEGER NOT NULL,
        indexed_at INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'active'
      );
    `);
    legacyDb.close();

    const db = openIndex(dbPath);
    try {
      const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(SCHEMA_VERSION_KEY) as
        | { value: string }
        | undefined;
      expect(row?.value).toBe(String(CURRENT_SCHEMA_VERSION));

      const tables = (db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      ).all() as { name: string }[]).map((r) => r.name);
      expect(tables).toContain("rationales");

      const cols = (db.prepare("PRAGMA table_info(rationales)").all() as Array<{ name: string }>)
        .map((c) => c.name);
      expect(cols).toEqual(["id", "file_id", "symbol_key", "kind", "text", "start_line", "content_hash"]);

      const idx = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_rationales_%' ORDER BY name")
        .all() as Array<{ name: string }>;
      const idxNames = idx.map((i) => i.name);
      expect(idxNames).toContain("idx_rationales_file_id");
      expect(idxNames).toContain("idx_rationales_symbol_key");

      // symbol_key is nullable (file-level rationales).
      db.prepare(
        "INSERT INTO files (path, lang, content_hash, size, mtime, indexed_at) VALUES ('a.ts', 'ts', 'h', 1, 1, 1)",
      ).run();
      db.prepare(
        "INSERT INTO rationales (file_id, symbol_key, kind, text, start_line, content_hash) VALUES (1, NULL, 'todo', 'TODO: x', 1, 'h')",
      ).run();
      const inserted = db.prepare("SELECT symbol_key FROM rationales WHERE file_id = 1").get() as
        | { symbol_key: string | null }
        | undefined;
      expect(inserted?.symbol_key).toBeNull();
    } finally {
      db.close();
    }
  });

  it("v5 → v6 migration is idempotent: reopening a migrated v6 DB does not fail", () => {
    openIndex(dbPath).close();
    const db = openIndex(dbPath);
    try {
      const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(SCHEMA_VERSION_KEY) as
        | { value: string }
        | undefined;
      expect(row?.value).toBe(String(CURRENT_SCHEMA_VERSION));
      const tables = (db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      ).all() as { name: string }[]).map((r) => r.name);
      const unique = new Set(tables);
      expect(unique.size).toBe(tables.length);
    } finally {
      db.close();
    }
  });

  it("migrates v6 → v7: calls gains confidence, old rows default to 'inferred'", () => {
    // Simulates a v6 DB — calls WITHOUT the confidence column, plus one
    // pre-v7 edge row that must keep the conservative default.
    const Database = require("better-sqlite3");
    const legacyDb = new Database(dbPath);
    legacyDb.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO meta VALUES ('schema_version', '6');
      CREATE TABLE files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL UNIQUE,
        lang TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        size INTEGER NOT NULL,
        mtime INTEGER NOT NULL,
        indexed_at INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'active'
      );
      CREATE TABLE calls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_id INTEGER NOT NULL REFERENCES files(id),
        caller_key TEXT NOT NULL,
        callee_name TEXT NOT NULL,
        resolved_callee_key TEXT,
        line INTEGER NOT NULL
      );
      INSERT INTO files (path, lang, content_hash, size, mtime, indexed_at) VALUES ('a.ts', 'ts', 'h', 1, 1, 1);
      INSERT INTO calls (file_id, caller_key, callee_name, line) VALUES (1, 'a.ts#outer', 'helper', 1);
    `);
    legacyDb.close();

    const db = openIndex(dbPath);
    try {
      const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(SCHEMA_VERSION_KEY) as
        | { value: string }
        | undefined;
      expect(row?.value).toBe(String(CURRENT_SCHEMA_VERSION));

      const cols = (db.prepare("PRAGMA table_info(calls)").all() as Array<{ name: string }>)
        .map((c) => c.name);
      expect(cols).toContain("confidence");

      // Pre-v7 rows have no recorded extraction shape → conservative default.
      const edge = db.prepare("SELECT confidence FROM calls WHERE caller_key = 'a.ts#outer'").get() as
        | { confidence: string }
        | undefined;
      expect(edge?.confidence).toBe("inferred");
    } finally {
      db.close();
    }
  });

  it("v6 → v7 migration is idempotent: reopening a migrated v7 DB does not fail", () => {
    openIndex(dbPath).close();
    const db = openIndex(dbPath);
    try {
      const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(SCHEMA_VERSION_KEY) as
        | { value: string }
        | undefined;
      expect(row?.value).toBe(String(CURRENT_SCHEMA_VERSION));
      const cols = (db.prepare("PRAGMA table_info(calls)").all() as Array<{ name: string }>)
        .map((c) => c.name);
      // Exactly one confidence column (no duplicate ADD COLUMN).
      expect(cols.filter((c) => c === "confidence")).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it("fresh schema (from scratch) already carries calls.confidence", () => {
    const db = openIndex(dbPath);
    try {
      const cols = (db.prepare("PRAGMA table_info(calls)").all() as Array<{ name: string }>)
        .map((c) => c.name);
      expect(cols).toEqual([
        "id",
        "file_id",
        "caller_key",
        "callee_name",
        "resolved_callee_key",
        "line",
        "confidence",
      ]);
    } finally {
      db.close();
    }
  });

  it("migra v7 → v8: debt ganha doc_page_id, com backfill a partir dos anchors", () => {
    // Simula DB v7: debt SEM doc_page_id, mas com um anchor ligando a debt
    // a uma doc_page. O backfill deve preencher a referência durável.
    const Database = require("better-sqlite3");
    const legacyDb = new Database(dbPath);
    legacyDb.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO meta VALUES ('schema_version', '7');
      CREATE TABLE doc_pages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        wiki_path TEXT NOT NULL UNIQUE,
        owner TEXT NOT NULL,
        title TEXT
      );
      INSERT INTO doc_pages (wiki_path, owner, title) VALUES ('livewiki/a.md', 'generated', 'a');
      CREATE TABLE anchors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        doc_page_id INTEGER NOT NULL,
        section_slug TEXT,
        symbol_key TEXT NOT NULL,
        symbol_hash_at_doc TEXT NOT NULL
      );
      INSERT INTO anchors (doc_page_id, symbol_key, symbol_hash_at_doc) VALUES (1, 'src/a.ts#alpha', 'h');
      CREATE TABLE debt (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        anchor_id INTEGER,
        event TEXT NOT NULL,
        assignee TEXT NOT NULL,
        symbol_key TEXT,
        detail TEXT,
        detected_at INTEGER NOT NULL,
        resolved_at INTEGER
      );
      INSERT INTO debt (anchor_id, event, assignee, symbol_key, detected_at)
        VALUES (1, 'deleted', 'agent', 'src/a.ts#alpha', 1);
      INSERT INTO debt (anchor_id, event, assignee, symbol_key, detected_at)
        VALUES (NULL, 'deleted', 'agent', 'src/b.ts#beta', 1);
    `);
    legacyDb.close();

    const db = openIndex(dbPath);
    try {
      const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(SCHEMA_VERSION_KEY) as
        | { value: string }
        | undefined;
      expect(row?.value).toBe(String(CURRENT_SCHEMA_VERSION));
      const cols = (db.prepare("PRAGMA table_info(debt)").all() as Array<{ name: string }>)
        .map((c) => c.name);
      expect(cols.filter((c) => c === "doc_page_id")).toHaveLength(1);
      const rows = db
        .prepare("SELECT id, doc_page_id FROM debt ORDER BY id")
        .all() as Array<{ id: number; doc_page_id: number | null }>;
      expect(rows[0]!.doc_page_id).toBe(1); // backfilled from the anchor
      expect(rows[1]!.doc_page_id).toBeNull(); // no anchor — stays null
    } finally {
      db.close();
    }
  });
});