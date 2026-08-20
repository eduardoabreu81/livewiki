/**
 * Concurrent-writer E2E — real `livewiki index` PROCESSES racing over one
 * `index.db` (P1, investigated 2026-08-19).
 *
 * The regression these guard: the indexer read `SELECT * FROM files` before
 * its async read+parse phase and decided INSERT-vs-UPDATE from that snapshot
 * after it. Another process committing inside that 0.5s–15s window made the
 * second writer INSERT a path that already existed:
 *
 *     UNIQUE constraint failed: files.path   (exit 1)
 *
 * Reproduced 100% of the time — with N concurrent processes, exactly one won
 * and N-1 died. So these tests spawn real processes rather than calling
 * `run()` in-thread: the bug lives between OS processes sharing a file, and
 * an in-process test cannot express it.
 *
 * They deliberately do NOT depend on hitting a millisecond-wide window. The
 * writers are launched together (or with a stagger far smaller than one full
 * run), so overlap is structural. And the assertions hold on BOTH sides of
 * the race — whether a writer's planning snapshot saw the new file or not,
 * the outcome must be: every process exits 0, exactly one process reports
 * having added it, and the final database is byte-for-byte the logical state
 * a single writer would have produced. Only the regression can fail them.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import * as nodePath from "node:path";
import * as nodeOs from "node:os";
import * as nodeFs from "node:fs/promises";
import { openIndex, openIndexReadOnly } from "@livewiki/core/db";

// Each test spawns several real CLI processes, each walking and parsing a
// synthetic repo. Timeout is a ceiling, not a delay.
vi.setConfig({ testTimeout: 120_000 });

let repos: string[] = [];

beforeEach(() => {
  repos = [];
});

afterEach(async () => {
  for (const dir of repos) {
    await nodeFs.rm(dir, { recursive: true, force: true });
  }
});

function cliBin(): string {
  return nodePath.resolve(process.cwd(), "dist/index.js");
}

async function makeRepo(moduleCount: number): Promise<string> {
  const root = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "livewiki-conc-"));
  repos.push(root);
  await nodeFs.mkdir(nodePath.join(root, "src"), { recursive: true });
  for (let i = 0; i < moduleCount; i++) {
    await writeModule(root, `src/mod${String(i).padStart(4, "0")}.ts`, i, 0);
  }
  return root;
}

/** A module with enough symbols and call edges to exercise every write path. */
async function writeModule(root: string, rel: string, seed: number, revision: number): Promise<void> {
  const body = Array.from(
    { length: 8 },
    (_, j) =>
      `export function fn${seed}_${j}(a: number, b: number): number {\n` +
      `  // computes the ${j}th term\n` +
      `  const x = a + b + ${j} + ${revision};\n` +
      `  return helper${seed}(x);\n}`,
  ).join("\n\n");
  await nodeFs.writeFile(
    nodePath.join(root, rel),
    `export function helper${seed}(v: number): number { return v * ${revision + 2}; }\n\n${body}\n`,
    "utf8",
  );
}

/**
 * A module heavy enough that parsing it costs real time. Used only where a
 * test needs Phase A to last long enough for two writers to overlap by a
 * margin measured in seconds rather than milliseconds.
 */
async function writeHeavyModule(root: string, rel: string, seed: number): Promise<void> {
  const body = Array.from(
    { length: 40 },
    (_, j) =>
      `export function big${seed}_${j}(a: number, b: number): number {\n` +
      `  // term ${j}\n` +
      `  const x = a + b + ${j};\n` +
      `  return helper${seed}(x);\n}`,
  ).join("\n\n");
  await nodeFs.writeFile(
    nodePath.join(root, rel),
    `export function helper${seed}(v: number): number { return v * 2; }\n\n${body}\n`,
    "utf8",
  );
}

interface IndexRun {
  status: number;
  stderr: string;
  index: {
    filesScanned: number;
    filesAdded: number;
    filesUpdated: number;
    filesUnchanged: number;
    filesDeleted: number;
  } | null;
}

function parseRun(status: number, stdout: string, stderr: string): IndexRun {
  let index: IndexRun["index"] = null;
  try {
    index = (JSON.parse(stdout) as { index: IndexRun["index"] }).index;
  } catch {
    index = null;
  }
  return { status, stderr, index };
}

/** One `livewiki index`, run to completion. */
function indexOnce(repoRoot: string): IndexRun {
  const r = spawnSync(process.execPath, [cliBin(), "--json", "--repo", repoRoot, "index"], {
    encoding: "utf8",
  });
  return parseRun(r.status ?? -1, r.stdout ?? "", r.stderr ?? "");
}

/**
 * `count` real `livewiki index` processes over the same repo.
 *
 * `staggerMs` offsets each launch. It is used to place a writer's planning
 * snapshot BEFORE another writer's commit while its own write lands AFTER it
 * — the interleaving that produced the bug. It has to stay well under one
 * full run, which is why those tests use a repo big enough that a run takes
 * roughly a second.
 */
async function indexConcurrent(repoRoot: string, count: number, staggerMs = 0): Promise<IndexRun[]> {
  const jobs: Promise<IndexRun>[] = [];
  for (let i = 0; i < count; i++) {
    if (staggerMs > 0 && i > 0) {
      await new Promise((resolve) => setTimeout(resolve, staggerMs));
    }
    jobs.push(
      new Promise<IndexRun>((resolve) => {
        const child = spawn(process.execPath, [cliBin(), "--json", "--repo", repoRoot, "index"], {
          stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
        child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
        child.on("close", (code) => resolve(parseRun(code ?? -1, stdout, stderr)));
      }),
    );
  }
  return Promise.all(jobs);
}

/**
 * The database's logical content: everything a consumer can observe, with
 * row ids and wall-clock stamps removed so two independently built databases
 * are directly comparable. This is what "identical to a single-writer run"
 * is asserted against.
 */
function logicalSnapshot(repoRoot: string): {
  files: string[];
  symbols: string[];
  calls: string[];
  rationales: string[];
  schemaVersion: string | undefined;
  integrity: string;
  foreignKeyViolations: number;
  duplicatePaths: number;
  orphanSymbols: number;
  orphanCalls: number;
  orphanRationales: number;
} {
  const db = openIndexReadOnly(nodePath.join(repoRoot, ".livewiki", "index.db"));
  try {
    const rows = (sql: string): string[] =>
      (db.prepare(sql).all() as Record<string, unknown>[]).map((r) => JSON.stringify(r));
    const count = (sql: string): number => (db.prepare(sql).get() as { c: number }).c;
    return {
      files: rows(
        "SELECT path, lang, content_hash, size, status FROM files ORDER BY path",
      ),
      symbols: rows(
        "SELECT f.path, s.key, s.name, s.kind, s.signature, s.start_line, s.end_line, s.content_hash, s.status " +
          "FROM symbols s JOIN files f ON f.id = s.file_id ORDER BY f.path, s.key, s.start_line, s.status",
      ),
      calls: rows(
        "SELECT f.path, c.caller_key, c.callee_name, c.resolved_callee_key, c.line, c.confidence " +
          "FROM calls c JOIN files f ON f.id = c.file_id ORDER BY f.path, c.caller_key, c.callee_name, c.line",
      ),
      rationales: rows(
        "SELECT f.path, r.symbol_key, r.kind, r.text, r.start_line, r.content_hash " +
          "FROM rationales r JOIN files f ON f.id = r.file_id ORDER BY f.path, r.start_line, r.kind",
      ),
      schemaVersion: (
        db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as
          | { value: string }
          | undefined
      )?.value,
      integrity: JSON.stringify(db.pragma("integrity_check")),
      foreignKeyViolations: (db.prepare("PRAGMA foreign_key_check").all() as unknown[]).length,
      duplicatePaths: count(
        "SELECT COUNT(*) c FROM (SELECT path FROM files GROUP BY path HAVING COUNT(*) > 1)",
      ),
      orphanSymbols: count(
        "SELECT COUNT(*) c FROM symbols s LEFT JOIN files f ON f.id = s.file_id WHERE f.id IS NULL",
      ),
      orphanCalls: count(
        "SELECT COUNT(*) c FROM calls c LEFT JOIN files f ON f.id = c.file_id WHERE f.id IS NULL",
      ),
      orphanRationales: count(
        "SELECT COUNT(*) c FROM rationales r LEFT JOIN files f ON f.id = r.file_id WHERE f.id IS NULL",
      ),
    };
  } finally {
    db.close();
  }
}

/** Fails with the offending stderr rather than a bare exit code. */
function expectAllSucceeded(runs: IndexRun[]): void {
  const failed = runs.filter((r) => r.status !== 0);
  expect(failed.map((r) => r.stderr.trim())).toEqual([]);
  // Named explicitly so a future regression is identified, not just counted.
  for (const run of runs) {
    expect(run.stderr).not.toMatch(/UNIQUE constraint failed/);
    expect(run.stderr).not.toMatch(/database is locked/);
    expect(run.stderr).not.toMatch(/SQLITE_BUSY/);
  }
}

function healthy(snapshot: ReturnType<typeof logicalSnapshot>): void {
  expect(snapshot.schemaVersion).toBe("10");
  expect(snapshot.integrity).toContain("ok");
  expect(snapshot.foreignKeyViolations).toBe(0);
  expect(snapshot.duplicatePaths).toBe(0);
  expect(snapshot.orphanSymbols).toBe(0);
  expect(snapshot.orphanCalls).toBe(0);
  expect(snapshot.orphanRationales).toBe(0);
}

describe("concurrent `livewiki index` writers", () => {
  it("A. 2 writers over one new file: both exit 0 and land the single-writer state", async () => {
    // Twin repos with identical content: one indexed by a single writer, one
    // raced. Their logical state must be indistinguishable.
    const raced = await makeRepo(20);
    const control = await makeRepo(20);
    indexOnce(raced);
    indexOnce(control);

    await writeModule(raced, "src/added.ts", 999, 1);
    await writeModule(control, "src/added.ts", 999, 1);

    const runs = await indexConcurrent(raced, 2);
    expectAllSucceeded(runs);
    indexOnce(control);

    // Exactly one process performed the insert. The other reported the file
    // as unchanged — it IS indexed, just not by that run's writes.
    const added = runs.reduce((sum, r) => sum + (r.index?.filesAdded ?? 0), 0);
    expect(added).toBe(1);

    healthy(logicalSnapshot(raced));
    expect(logicalSnapshot(raced)).toEqual(logicalSnapshot(control));
  });

  it("B. 3 writers: all exit 0, no duplicate paths, integrity ok", async () => {
    const repo = await makeRepo(20);
    indexOnce(repo);
    await writeModule(repo, "src/added.ts", 998, 1);

    const runs = await indexConcurrent(repo, 3);
    expectAllSucceeded(runs);
    expect(runs.reduce((sum, r) => sum + (r.index?.filesAdded ?? 0), 0)).toBe(1);
    healthy(logicalSnapshot(repo));
  });

  it("C. 5 writers: terminal state identical to a single writer's", async () => {
    const raced = await makeRepo(20);
    const control = await makeRepo(20);
    indexOnce(raced);
    indexOnce(control);

    for (let i = 0; i < 3; i++) {
      await writeModule(raced, `src/new${i}.ts`, 900 + i, 1);
      await writeModule(control, `src/new${i}.ts`, 900 + i, 1);
    }

    const runs = await indexConcurrent(raced, 5);
    expectAllSucceeded(runs);
    indexOnce(control);

    expect(runs.reduce((sum, r) => sum + (r.index?.filesAdded ?? 0), 0)).toBe(3);
    healthy(logicalSnapshot(raced));
    expect(logicalSnapshot(raced)).toEqual(logicalSnapshot(control));
  });

  it("D. mixed plan (modified + new + removed): no partial state, next run is a fixpoint", async () => {
    const raced = await makeRepo(24);
    const control = await makeRepo(24);
    indexOnce(raced);
    indexOnce(control);

    // Modified files sort before the new ones, so the write transaction runs
    // UPDATEs and symbol inserts BEFORE reaching the INSERT that used to
    // collide — the shape that proves a loser rolls back whole.
    for (const root of [raced, control]) {
      for (let i = 0; i < 6; i++) {
        await writeModule(root, `src/mod${String(i).padStart(4, "0")}.ts`, i, 7);
      }
      for (let i = 0; i < 3; i++) {
        await writeModule(root, `src/zz_new${i}.ts`, 800 + i, 1);
      }
      await nodeFs.rm(nodePath.join(root, "src", "mod0019.ts"));
    }

    const runs = await indexConcurrent(raced, 4);
    expectAllSucceeded(runs);
    indexOnce(control);

    // Each unit of real work is claimed exactly once across the racing runs.
    expect(runs.reduce((sum, r) => sum + (r.index?.filesAdded ?? 0), 0)).toBe(3);
    expect(runs.reduce((sum, r) => sum + (r.index?.filesUpdated ?? 0), 0)).toBe(6);
    expect(runs.reduce((sum, r) => sum + (r.index?.filesDeleted ?? 0), 0)).toBe(1);

    const afterRace = logicalSnapshot(raced);
    healthy(afterRace);
    expect(afterRace).toEqual(logicalSnapshot(control));

    // Fixpoint: a run over the settled database changes nothing.
    const settle = indexOnce(raced);
    expect(settle.status).toBe(0);
    expect(settle.index?.filesAdded).toBe(0);
    expect(settle.index?.filesUpdated).toBe(0);
    expect(settle.index?.filesDeleted).toBe(0);
    expect(logicalSnapshot(raced)).toEqual(afterRace);
  });

  it("E1. a writer starting after another finished sees the work already applied", async () => {
    const repo = await makeRepo(20);
    indexOnce(repo);
    await writeModule(repo, "src/added.ts", 997, 1);

    const first = indexOnce(repo);
    expect(first.status).toBe(0);
    expect(first.index?.filesAdded).toBe(1);

    const second = indexOnce(repo);
    expect(second.status).toBe(0);
    expect(second.index?.filesAdded).toBe(0);
    expect(second.index?.filesUpdated).toBe(0);
    expect(second.index?.filesUnchanged).toBe(second.index?.filesScanned);
  });

  it("E2. a writer whose snapshot predates another's commit converges instead of inserting", async () => {
    // The interleaving that produced the bug, arranged rather than hoped for.
    //
    // Sizing matters here, and only unparsed work is free: an already-indexed
    // file costs a hash, a NEW file costs a full tree-sitter parse. So the
    // window is bought with new files, not repo size — 80 of them put Phase A
    // comfortably above a second. The second writer starts a small fraction of
    // that in, so its planning snapshot is taken long before the first writer
    // commits, while its own write phase begins long after. Both margins are
    // multiples of the stagger, not milliseconds.
    const NEW_FILES = 100;
    const repo = await makeRepo(10);
    indexOnce(repo);
    for (let i = 0; i < NEW_FILES; i++) {
      await writeHeavyModule(repo, `src/late${String(i).padStart(3, "0")}.ts`, 500 + i);
    }

    // Measured on this corpus: Phase A takes ~1.9s. With a 500ms stagger the
    // late writer's snapshot precedes the early writer's commit by ~1.4s, and
    // its own write follows that commit by ~500ms. Both margins are seconds
    // of slack, so a slow machine shifts the numbers without changing the
    // ordering the test is about.
    const runs = await indexConcurrent(repo, 2, 500);
    expectAllSucceeded(runs);

    // The late writer planned INSERTs and had to discover, under the write
    // lock, that the rows were already there at exactly its own content
    // hashes. Every file is claimed by exactly one run; nothing is rewritten.
    expect(runs.reduce((sum, r) => sum + (r.index?.filesAdded ?? 0), 0)).toBe(NEW_FILES);
    expect(runs.every((r) => (r.index?.filesUpdated ?? 0) === 0)).toBe(true);
    healthy(logicalSnapshot(repo));
  });

  it("F. a writer waits for a held lock rather than failing on it", async () => {
    // The wait policy, exercised against a lock that is genuinely held: the
    // test process takes the write lock and keeps it for two seconds while a
    // real `livewiki index` runs. The driver's implicit default would have
    // covered this, but only by accident — the run must queue and succeed
    // because openIndex sets a stated busy_timeout, and it must still be
    // holding out well past the moment a no-wait writer would have died.
    const HOLD_MS = 2_000;
    const repo = await makeRepo(15);
    indexOnce(repo);
    await writeModule(repo, "src/queued.ts", 995, 1);

    const holder = openIndex(nodePath.join(repo, ".livewiki", "index.db"));
    let runs: IndexRun[];
    const started = Date.now();
    try {
      holder.exec("BEGIN IMMEDIATE");
      holder.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('lock_probe', '1')").run();
      const pending = indexConcurrent(repo, 1);
      await new Promise((resolve) => setTimeout(resolve, HOLD_MS));
      holder.exec("COMMIT");
      runs = await pending;
    } finally {
      holder.close();
    }

    expectAllSucceeded(runs);
    expect(Date.now() - started).toBeGreaterThanOrEqual(HOLD_MS);
    expect(runs[0]?.index?.filesAdded).toBe(1);
    healthy(logicalSnapshot(repo));
  });

  it("G. three writers against a held lock: contention is never a raw \"database is locked\"", async () => {
    // The 0.3.1 hole, end to end. openIndex sets journal mode, runs SCHEMA_SQL,
    // migrates, stamps the version and creates the claim index — all outside
    // runWriteTransaction, so contention there used to reach the user as a bare
    // SQLite string with nothing to act on. The Windows CI failure of
    // 2026-08-20 was exactly that, in `B. 3 writers`.
    //
    // Three real processes are launched while the test process holds the write
    // lock, so all three meet contention rather than hoping to collide with
    // each other. Whatever the outcome, no stderr may carry the raw text.
    const HOLD_MS = 2_000;
    const repo = await makeRepo(15);
    indexOnce(repo);
    await writeModule(repo, "src/contended.ts", 994, 1);

    const holder = openIndex(nodePath.join(repo, ".livewiki", "index.db"));
    let runs: IndexRun[];
    try {
      holder.exec("BEGIN IMMEDIATE");
      holder.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('lock_probe', '1')").run();
      const pending = indexConcurrent(repo, 3);
      await new Promise((resolve) => setTimeout(resolve, HOLD_MS));
      holder.exec("COMMIT");
      runs = await pending;
    } finally {
      holder.close();
    }

    // The specific regression: the bare SQLite text must never be what a user
    // is handed, whether the run succeeded or failed.
    for (const run of runs) {
      expect(run.stderr, "raw SQLite contention text reached the user").not.toMatch(
        /database is locked/i,
      );
    }
    // And ordinary contention still converges: everyone queued and finished.
    expectAllSucceeded(runs);
    expect(runs.reduce((sum, r) => sum + (r.index?.filesAdded ?? 0), 0)).toBe(1);
    healthy(logicalSnapshot(repo));
  });
});
