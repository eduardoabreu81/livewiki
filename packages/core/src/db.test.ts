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
});