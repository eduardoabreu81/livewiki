/**
 * Schema-version access rules for readers and writers.
 *
 * Two defects motivated this. First, `openIndex` gated its migration branch on
 * `stored !== CURRENT`, so a database from a NEWER build entered it, selected
 * zero migrations (every entry is `fromVersion < X`) and still rewrote
 * `schema_version` downwards — silently relabelling an index without touching
 * the tables it actually had. Second, commands that only query went through
 * the same writer path, so a pending migration turned a read into a write that
 * waits on the write lock: measured as SQLITE_BUSY after the full busy timeout
 * while a writer held a transaction, where a plain read-only connection
 * answered in 2ms.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as nodePath from "node:path";
import * as nodeOs from "node:os";
import * as nodeFs from "node:fs/promises";
import * as nodeFsSync from "node:fs";
import Database from "better-sqlite3";
import {
  openIndex,
  openIndexReadOnly,
  SchemaAccessError,
  CURRENT_SCHEMA_VERSION,
} from "./db.js";

let root: string;
let dbPath: string;

beforeEach(async () => {
  root = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "lw-schema-"));
  dbPath = nodePath.join(root, ".livewiki", "index.db");
  await nodeFs.mkdir(nodePath.dirname(dbPath), { recursive: true });
});

afterEach(async () => {
  await nodeFs.rm(root, { recursive: true, force: true }).catch(() => undefined);
});

/** Creates a healthy database at the current schema version. */
function seedCurrent(): void {
  openIndex(dbPath).close();
}

function storedVersion(): string | null {
  const db = new Database(dbPath, { readonly: true });
  try {
    // `meta` itself may not exist in the adversarial fixtures.
    const hasMeta = db
      .prepare("SELECT 1 AS hit FROM sqlite_master WHERE type='table' AND name='meta'")
      .get() as { hit: number } | undefined;
    if (hasMeta === undefined) return null;
    const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  } finally {
    db.close();
  }
}

function setStoredVersion(v: string): void {
  const db = new Database(dbPath);
  try {
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)").run(v);
  } finally {
    db.close();
  }
}

/** Full logical fingerprint of the file, to prove nothing was mutated. */
function fingerprint(): string {
  const db = new Database(dbPath, { readonly: true });
  try {
    // Adversarial fixtures may not have a `meta` table at all.
    const hasMeta = db
      .prepare("SELECT 1 AS hit FROM sqlite_master WHERE type='table' AND name='meta'")
      .get() as { hit: number } | undefined;
    const meta = hasMeta
      ? db.prepare("SELECT key, value FROM meta ORDER BY key").all()
      : null;
    const schema = db
      .prepare("SELECT type, name, sql FROM sqlite_master ORDER BY type, name")
      .all();
    return JSON.stringify({ meta, schema });
  } finally {
    db.close();
  }
}

describe("openIndex — writer access rules", () => {
  it("opens normally when stored === current", () => {
    seedCurrent();
    const before = fingerprint();
    const db = openIndex(dbPath);
    db.close();
    expect(storedVersion()).toBe(String(CURRENT_SCHEMA_VERSION));
    expect(fingerprint()).toBe(before);
  });

  it("migrates when stored < current", () => {
    seedCurrent();
    setStoredVersion("9");
    const db = openIndex(dbPath);
    db.close();
    expect(storedVersion()).toBe(String(CURRENT_SCHEMA_VERSION));
  });

  it("creates the database when it does not exist", () => {
    expect(nodeFsSync.existsSync(dbPath)).toBe(false);
    const db = openIndex(dbPath);
    db.close();
    expect(nodeFsSync.existsSync(dbPath)).toBe(true);
    expect(storedVersion()).toBe(String(CURRENT_SCHEMA_VERSION));
  });

  it("FAILS CLOSED when stored > current, and leaves the version untouched", () => {
    seedCurrent();
    setStoredVersion("99");
    const before = fingerprint();

    expect(() => openIndex(dbPath)).toThrow(SchemaAccessError);
    try {
      openIndex(dbPath);
    } catch (err) {
      expect((err as SchemaAccessError).kind).toBe("newer_index");
      expect((err as Error).message).toMatch(/newer LiveWiki/i);
      expect((err as Error).message).toMatch(/update LiveWiki/i);
    }

    // The whole point: no downgrade, no schema churn.
    expect(storedVersion()).toBe("99");
    expect(fingerprint()).toBe(before);
  });

  // The exact shape observed in the session: a build whose CURRENT is lower
  // than the database it opens. Simulated by recording a version above this
  // build's CURRENT, which is the same comparison from the DB's point of view.
  it("a build older than the index never downgrades it", () => {
    seedCurrent();
    const newer = String(CURRENT_SCHEMA_VERSION + 1);
    setStoredVersion(newer);

    expect(() => openIndex(dbPath)).toThrow(/newer than the v/i);
    expect(storedVersion()).toBe(newer);
  });
});

describe("openIndex — a newer index is rejected before ANY persistent write", () => {
  /**
   * Adversarial by construction: the database is left in a state where every
   * initialisation step openIndex normally performs would be observable.
   * Rejecting late still mutates the file, so this cannot pass by coincidence.
   */
  function seedFutureIndex(): { journalBefore: unknown; fingerprint: string } {
    seedCurrent();
    const db = new Database(dbPath);
    try {
      // 1. a version from the future
      db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version','99')").run();
      // 2. a journal mode openIndex would switch to WAL
      db.pragma("journal_mode = DELETE");
      // 3. objects the current bootstrap would recreate
      db.exec("DROP INDEX IF EXISTS idx_batch_tasks_claim");
      db.exec("DROP INDEX IF EXISTS idx_batch_tasks_status");
      db.exec("DROP TABLE IF EXISTS undocumented");
    } finally {
      db.close();
    }
    const journalBefore = (() => {
      const d = new Database(dbPath, { readonly: true });
      try { return d.pragma("journal_mode", { simple: true }); } finally { d.close(); }
    })();
    return { journalBefore, fingerprint: fingerprint() };
  }

  it("leaves schema_version, sqlite_master and journal_mode byte-identical", () => {
    const { journalBefore, fingerprint: before } = seedFutureIndex();
    expect(journalBefore).toBe("delete");
    expect(before).not.toContain("idx_batch_tasks_claim");
    expect(before).not.toContain("undocumented");

    expect(() => openIndex(dbPath)).toThrow(SchemaAccessError);

    // Nothing may have been created, migrated, stamped or re-journalled.
    expect(storedVersion()).toBe("99");
    expect(fingerprint()).toBe(before);
    const journalAfter = (() => {
      const d = new Database(dbPath, { readonly: true });
      try { return d.pragma("journal_mode", { simple: true }); } finally { d.close(); }
    })();
    expect(journalAfter).toBe(journalBefore);
  });

  it("does not recreate a dropped index or table it would normally bootstrap", () => {
    seedFutureIndex();
    expect(() => openIndex(dbPath)).toThrow(/newer/i);

    const db = new Database(dbPath, { readonly: true });
    try {
      const names = (db.prepare("SELECT name FROM sqlite_master").all() as Array<{ name: string }>)
        .map((r) => r.name);
      expect(names).not.toContain("idx_batch_tasks_claim");
      expect(names).not.toContain("undocumented");
    } finally {
      db.close();
    }
  });

  it("still creates a brand-new index from scratch", () => {
    // The guard must not cost the create path.
    expect(nodeFsSync.existsSync(dbPath)).toBe(false);
    const db = openIndex(dbPath);
    try {
      const names = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>)
        .map((r) => r.name);
      expect(names).toContain("files");
      expect(names).toContain("undocumented");
    } finally {
      db.close();
    }
    expect(storedVersion()).toBe(String(CURRENT_SCHEMA_VERSION));
  });
});

describe("openIndex — an existing index with no recorded version is refused", () => {
  /**
   * `CREATE TABLE IF NOT EXISTS` adds missing TABLES but never adds missing
   * COLUMNS to tables that already exist. Stamping CURRENT on a file whose
   * shape predates the migrations therefore declares work complete that never
   * ran — a `debt` table without `symbol_key` labelled v10.
   *
   * The one previous protection was accidental: a v3 shape happened to trip
   * `CREATE INDEX ... ON calls(resolved_callee_key)`, producing "no such
   * column" rather than a decision.
   */
  function seedRaw(sql: string): string {
    const db = new Database(dbPath);
    try { db.exec(sql); } finally { db.close(); }
    return fingerprint();
  }

  function journalMode(): unknown {
    const d = new Database(dbPath, { readonly: true });
    try { return d.pragma("journal_mode", { simple: true }); } finally { d.close(); }
  }

  const OLD_DEBT = `
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE debt (
      id INTEGER PRIMARY KEY AUTOINCREMENT, anchor_id INTEGER, event TEXT NOT NULL,
      assignee TEXT NOT NULL, detail TEXT, detected_at INTEGER NOT NULL, resolved_at INTEGER);
  `;
  const OLD_BATCH_RUNS = `
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE batch_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, started_at INTEGER NOT NULL,
      stage INTEGER NOT NULL, config_json TEXT NOT NULL, status TEXT NOT NULL);
  `;
  const V3_SHAPE = `
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE batch_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, started_at INTEGER NOT NULL,
      stage INTEGER NOT NULL, config_json TEXT NOT NULL, status TEXT NOT NULL);
    CREATE TABLE debt (
      id INTEGER PRIMARY KEY AUTOINCREMENT, anchor_id INTEGER, event TEXT NOT NULL,
      assignee TEXT NOT NULL, detail TEXT, detected_at INTEGER NOT NULL, resolved_at INTEGER);
    CREATE TABLE calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT, file_id INTEGER NOT NULL,
      caller_key TEXT NOT NULL, callee_name TEXT NOT NULL, line INTEGER NOT NULL);
  `;
  /** Domain tables with no `meta` at all — provenance equally unknown. */
  const NO_META = `
    CREATE TABLE debt (
      id INTEGER PRIMARY KEY AUTOINCREMENT, anchor_id INTEGER, event TEXT NOT NULL,
      assignee TEXT NOT NULL, detail TEXT, detected_at INTEGER NOT NULL, resolved_at INTEGER);
  `;

  it.each([
    ["old `debt` shape", OLD_DEBT],
    ["old `batch_runs` shape", OLD_BATCH_RUNS],
    ["full v3 shape (previously an accidental 'no such column')", V3_SHAPE],
    ["domain tables with no meta table", NO_META],
  ])("refuses %s with missing_version and mutates nothing", (_label, sql) => {
    const before = seedRaw(sql);
    const journalBefore = journalMode();

    try {
      openIndex(dbPath);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(SchemaAccessError);
      expect((err as SchemaAccessError).kind).toBe("missing_version");
      // Explicit, not an incidental SQLite error.
      expect((err as Error).message).not.toMatch(/no such column/i);
      expect((err as Error).message).toMatch(/no schema version/i);
      expect((err as Error).message).toMatch(/livewiki index/i);
    }

    expect(fingerprint()).toBe(before);
    expect(journalMode()).toBe(journalBefore);
    expect(storedVersion()).toBeNull();
  });

  it("refuses a CURRENT database whose version row was deleted, without restamping", () => {
    seedCurrent();
    const db = new Database(dbPath);
    db.prepare("DELETE FROM meta WHERE key = 'schema_version'").run();
    db.close();
    const before = fingerprint();

    try {
      openIndex(dbPath);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as SchemaAccessError).kind).toBe("missing_version");
    }

    expect(storedVersion()).toBeNull();
    expect(fingerprint()).toBe(before);
  });

  it("treats an existing but object-free SQLite file as new", () => {
    // Strict definition of "effectively empty": zero user objects. Such a file
    // carries no state whose provenance could be in question.
    new Database(dbPath).close();
    expect(nodeFsSync.existsSync(dbPath)).toBe(true);

    const db = openIndex(dbPath);
    try {
      const names = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>)
        .map((r) => r.name);
      expect(names).toContain("files");
    } finally {
      db.close();
    }
    expect(storedVersion()).toBe(String(CURRENT_SCHEMA_VERSION));
  });

  it("still creates a brand-new file normally", () => {
    expect(nodeFsSync.existsSync(dbPath)).toBe(false);
    openIndex(dbPath).close();
    expect(storedVersion()).toBe(String(CURRENT_SCHEMA_VERSION));
  });
});

describe("openIndexReadOnly — reader access rules", () => {
  it("opens a current database and answers queries", () => {
    seedCurrent();
    const db = openIndexReadOnly(dbPath);
    try {
      const n = (db.prepare("SELECT COUNT(*) AS n FROM meta").get() as { n: number }).n;
      expect(n).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });

  it("rejects writes even if a caller attempts one", () => {
    seedCurrent();
    const db = openIndexReadOnly(dbPath);
    try {
      expect(() =>
        db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('x','1')").run(),
      ).toThrow(/readonly/i);
    } finally {
      db.close();
    }
  });

  it("reads while another connection holds a write transaction", () => {
    seedCurrent();
    const writer = new Database(dbPath);
    writer.exec("BEGIN IMMEDIATE");
    writer.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('held','1')").run();
    try {
      const db = openIndexReadOnly(dbPath);
      try {
        const n = (db.prepare("SELECT COUNT(*) AS n FROM meta").get() as { n: number }).n;
        expect(n).toBeGreaterThan(0);
      } finally {
        db.close();
      }
    } finally {
      writer.exec("ROLLBACK");
      writer.close();
    }
  });

  it("fails on an older schema WITHOUT migrating it", () => {
    seedCurrent();
    setStoredVersion("9");
    const before = fingerprint();

    try {
      openIndexReadOnly(dbPath);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(SchemaAccessError);
      expect((err as SchemaAccessError).kind).toBe("older_index");
      expect((err as Error).message).toMatch(/run `livewiki index`/i);
    }

    expect(storedVersion()).toBe("9");
    expect(fingerprint()).toBe(before);
  });

  it("fails on a newer schema WITHOUT modifying it", () => {
    seedCurrent();
    setStoredVersion("99");
    const before = fingerprint();

    try {
      openIndexReadOnly(dbPath);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as SchemaAccessError).kind).toBe("newer_index");
      expect((err as Error).message).toMatch(/update LiveWiki/i);
    }

    expect(storedVersion()).toBe("99");
    expect(fingerprint()).toBe(before);
  });

  it("never creates the database when it is missing", () => {
    expect(nodeFsSync.existsSync(dbPath)).toBe(false);

    try {
      openIndexReadOnly(dbPath);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as SchemaAccessError).kind).toBe("missing_database");
      expect((err as Error).message).toMatch(/livewiki index/i);
    }

    // Not even an empty file, and no -wal/-shm siblings.
    expect(nodeFsSync.existsSync(dbPath)).toBe(false);
    expect(nodeFsSync.existsSync(`${dbPath}-wal`)).toBe(false);
    expect(nodeFsSync.existsSync(`${dbPath}-shm`)).toBe(false);
  });

  it("fails when the version row is absent, without stamping one", () => {
    seedCurrent();
    const db = new Database(dbPath);
    db.prepare("DELETE FROM meta WHERE key = 'schema_version'").run();
    db.close();

    try {
      openIndexReadOnly(dbPath);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as SchemaAccessError).kind).toBe("missing_version");
    }
    expect(storedVersion()).toBeNull();
  });

  it("runs no DDL: the schema is byte-identical after opening", () => {
    seedCurrent();
    // Drop an index openIndex would recreate. A reader must NOT restore it.
    const w = new Database(dbPath);
    w.exec("DROP INDEX IF EXISTS idx_batch_tasks_claim");
    w.close();
    const before = fingerprint();
    expect(before).not.toContain("idx_batch_tasks_claim");

    const db = openIndexReadOnly(dbPath);
    db.close();

    expect(fingerprint()).toBe(before);
    expect(fingerprint()).not.toContain("idx_batch_tasks_claim");
  });

  it("leaves journal_mode alone", () => {
    seedCurrent();
    const before = (() => {
      const d = new Database(dbPath, { readonly: true });
      try { return d.pragma("journal_mode", { simple: true }); } finally { d.close(); }
    })();
    const db = openIndexReadOnly(dbPath);
    db.close();
    const after = (() => {
      const d = new Database(dbPath, { readonly: true });
      try { return d.pragma("journal_mode", { simple: true }); } finally { d.close(); }
    })();
    expect(after).toBe(before);
  });
});
