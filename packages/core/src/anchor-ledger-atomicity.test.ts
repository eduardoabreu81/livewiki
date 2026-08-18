/**
 * Atomicity of one ledger run.
 *
 * `orchestrate` used to interleave filesystem reads, Markdown writes and
 * SQLite mutations with no enclosing transaction, so every statement committed
 * on its own. A crash mid-run left doc_pages, anchors, debt and undocumented
 * describing different snapshots, and — worst of all — a crash anywhere in the
 * long window after a move rewrote the Markdown destroyed the `moved` debt
 * permanently, because no later run could redetect a move the file no longer
 * showed.
 *
 * These tests assert on the LOGICAL STATE OF THE TABLES before and after an
 * injected failure, not on the return value: a run that reports failure while
 * leaving half its writes behind is exactly the bug being fixed.
 *
 * Mutation-checked: with the `db.transaction(...)` in `applyLedger` removed,
 * the fault-injection cases below go red.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as nodePath from "node:path";
import * as nodeOs from "node:os";
import * as nodeFsSync from "node:fs";
import Database from "better-sqlite3";

// Mid-run filesystem mutations are injected by hooking the SECOND directory
// listing of a run: `collectWikiPages` is called once by planLedger and again
// by revalidateLedgerPlan, so this lands exactly between the two phases.
const injected = vi.hoisted(() => ({
  onSecondListing: null as null | (() => void),
  listingCount: 0,
  /** Suffix of a path whose READ must fail (simulates EACCES/EIO). */
  failReadOf: null as string | null,
  /** Suffix of a path whose WRITE must fail (simulates a failed rewrite). */
  failWriteOf: null as string | null,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const denied = (code: string, op: string, p: string): NodeJS.ErrnoException => {
    const err = new Error(`${code}: injected ${op} failure, ${p}`) as NodeJS.ErrnoException;
    err.code = code;
    return err;
  };
  return {
    ...actual,
    default: actual,
    readdir: async (...args: Parameters<typeof actual.readdir>) => {
      const dir = String(args[0]);
      if (injected.onSecondListing && dir.replace(/\\/g, "/").endsWith("/livewiki")) {
        injected.listingCount++;
        if (injected.listingCount === 2) {
          const hook = injected.onSecondListing;
          injected.onSecondListing = null;
          hook();
        }
      }
      return (actual.readdir as (...a: unknown[]) => unknown)(...args) as never;
    },
    readFile: async (...args: Parameters<typeof actual.readFile>) => {
      const p = String(args[0]).replace(/\\/g, "/");
      if (injected.failReadOf && p.endsWith(injected.failReadOf)) {
        throw denied("EACCES", "read", p);
      }
      return (actual.readFile as (...a: unknown[]) => unknown)(...args) as never;
    },
    writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
      const p = String(args[0]).replace(/\\/g, "/");
      if (injected.failWriteOf && p.endsWith(injected.failWriteOf)) {
        throw denied("EACCES", "write", p);
      }
      return (actual.writeFile as (...a: unknown[]) => unknown)(...args) as never;
    },
  };
});

const nodeFs = await import("node:fs/promises");
const { run: runIndexer } = await import("./indexer.js");
const { run: runLedger } = await import("./anchor-ledger.js");

let repoRoot: string;

beforeEach(async () => {
  repoRoot = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "lw-ledger-atomic-"));
  injected.onSecondListing = null;
  injected.listingCount = 0;
});

afterEach(async () => {
  restorePrepare();
  injected.onSecondListing = null;
  await nodeFs.rm(repoRoot, { recursive: true, force: true }).catch(() => undefined);
});

async function write(rel: string, content: string): Promise<void> {
  const abs = nodePath.join(repoRoot, rel);
  await nodeFs.mkdir(nodePath.dirname(abs), { recursive: true });
  await nodeFs.writeFile(abs, content, "utf8");
}

function page(title: string, anchors: string[]): string {
  return [
    "---",
    `title: ${title}`,
    "owner: generated",
    "anchors:",
    ...anchors.map((a) => `  - ${a}`),
    "---",
    "",
    `# ${title}`,
    "",
    "## Implementation",
    `<!-- lw:anchors ${anchors.join(" ")} -->`,
    "",
    "Prose.",
    "",
  ].join("\n");
}

// ── Fault injection ─────────────────────────────────────────────────────────

const MUTATING = /^\s*(INSERT|UPDATE|DELETE)/i;
let originalPrepare: typeof Database.prototype.prepare | null = null;

/**
 * Throws from the Nth mutating statement of the next ledger run. Patching the
 * prototype is what lets the failure land INSIDE the transaction without the
 * production code knowing anything about tests.
 */
function failAtWrite(n: number, matching?: RegExp): void {
  if (originalPrepare === null) originalPrepare = Database.prototype.prepare;
  const orig = originalPrepare;
  let count = 0;
  Database.prototype.prepare = function patched(this: Database.Database, sql: string, ...rest: unknown[]) {
    const stmt = (orig as (...a: unknown[]) => Database.Statement).call(this, sql, ...rest);
    if (!MUTATING.test(sql)) return stmt;
    if (matching && !matching.test(sql)) return stmt;
    const origRun = stmt.run.bind(stmt);
    (stmt as { run: unknown }).run = (...args: unknown[]) => {
      count++;
      if (count === n) throw new Error(`injected failure at write #${n}`);
      return (origRun as (...a: unknown[]) => unknown)(...args);
    };
    return stmt;
  } as typeof Database.prototype.prepare;
}

function restorePrepare(): void {
  if (originalPrepare !== null) {
    Database.prototype.prepare = originalPrepare;
    originalPrepare = null;
  }
}

// ── Logical table snapshot ──────────────────────────────────────────────────

interface TableSnapshot {
  doc_pages: unknown[];
  anchors: unknown[];
  debt: unknown[];
  undocumented: unknown[];
  manual_blocks: unknown[];
  symbols: unknown[];
  ledgerRuns: string | null;
  lastLedgerAt: string | null;
}

/** Every table the transaction owns, in a stable order, values included. */
function snapshot(): TableSnapshot {
  const db = new Database(nodePath.join(repoRoot, ".livewiki", "index.db"), { readonly: true });
  try {
    const all = (sql: string): unknown[] => db.prepare(sql).all() as unknown[];
    const meta = (key: string): string | null =>
      ((db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined)
        ?.value ?? null);
    return {
      doc_pages: all("SELECT * FROM doc_pages ORDER BY id"),
      anchors: all("SELECT * FROM anchors ORDER BY id"),
      debt: all("SELECT * FROM debt ORDER BY id"),
      undocumented: all("SELECT * FROM undocumented ORDER BY symbol_key"),
      manual_blocks: all("SELECT * FROM manual_blocks ORDER BY id"),
      symbols: all("SELECT id, key, status, content_hash FROM symbols ORDER BY id"),
      ledgerRuns: meta("ledger_runs"),
      lastLedgerAt: meta("last_ledger_at"),
    };
  } finally {
    db.close();
  }
}

/** Two source files, two pages, indexed and ledgered once. */
async function seedTwoPages(): Promise<void> {
  await write("src/a.ts", "export function alpha(): number {\n  return 1;\n}\n");
  await write("src/b.ts", "export function beta(): number {\n  return 2;\n}\n");
  await write("livewiki/a.md", page("A", ["src/a.ts#alpha"]));
  await write("livewiki/b.md", page("B", ["src/b.ts#beta"]));
  await runIndexer(repoRoot, { quiet: true });
  await runLedger(repoRoot, { quiet: true });
}

/** Makes there be real ledger work pending: alpha's body changes. */
async function makePendingWork(): Promise<void> {
  await write("src/a.ts", "export function alpha(): number {\n  return 999;\n}\n");
  await runIndexer(repoRoot, { quiet: true });
}

describe("anchor-ledger — the run is all-or-nothing", () => {
  // One case per stage of the pipeline the briefing named. The write indices
  // are resolved by matching the statement, so they stay meaningful if the
  // number of writes around them shifts.
  it.each([
    ["after doc_pages upsert", /UPDATE doc_pages/],
    ["after anchors upsert", /UPDATE anchors SET symbol_key/],
    ["during anchor hash update", /UPDATE anchors SET symbol_hash_at_doc/],
    ["during debt", /debt/i],
    ["between DELETE and INSERT of undocumented", /undocumented/i],
    ["before ledger_runs / last_ledger_at", /INTO meta/i],
  ])("rolls back everything when a write fails %s", async (_label, matching) => {
    await seedTwoPages();
    await makePendingWork();
    const before = snapshot();

    failAtWrite(1, matching);
    const result = await runLedger(repoRoot, { quiet: true }).catch((err: Error) => err);
    restorePrepare();

    // The tables are byte-for-byte what they were, timestamps included.
    expect(snapshot()).toEqual(before);
    // Nothing may claim success.
    if (!(result instanceof Error)) {
      expect(result.status).not.toBe("applied");
    }

    // And a later clean run converges.
    const recovered = await runLedger(repoRoot, { quiet: true });
    expect(recovered.status).toBe("applied");
    const after = snapshot();
    expect(after.doc_pages).toHaveLength(2);
    expect(after.anchors.length).toBeGreaterThan(0);
  });

  it("does not half-apply when the second page fails after the first was persisted", async () => {
    await seedTwoPages();
    await makePendingWork();
    const before = snapshot();

    // The 2nd doc_pages upsert is page two: page one is already written.
    failAtWrite(2, /UPDATE doc_pages/);
    await runLedger(repoRoot, { quiet: true }).catch(() => undefined);
    restorePrepare();

    expect(snapshot()).toEqual(before);

    const recovered = await runLedger(repoRoot, { quiet: true });
    expect(recovered.status).toBe("applied");
  });

  it("never advances ledger_runs for a run that did not commit", async () => {
    await seedTwoPages();
    const before = snapshot();

    failAtWrite(1, /INTO meta/i);
    await runLedger(repoRoot, { quiet: true }).catch(() => undefined);
    restorePrepare();

    expect(snapshot().ledgerRuns).toBe(before.ledgerRuns);
    expect(snapshot().lastLedgerAt).toBe(before.lastLedgerAt);
  });
});

describe("anchor-ledger — an unstable snapshot applies nothing", () => {
  it("aborts when a page disappears between plan and revalidate", async () => {
    await seedTwoPages();
    await makePendingWork();
    const before = snapshot();

    injected.onSecondListing = () => {
      nodeFsSync.rmSync(nodePath.join(repoRoot, "livewiki", "b.md"));
    };
    const result = await runLedger(repoRoot, { quiet: true });

    expect(result.status).toBe("aborted");
    expect(result.reason).toMatch(/disappeared/i);
    expect(snapshot()).toEqual(before);
  });

  it("aborts when a page is modified between plan and revalidate", async () => {
    await seedTwoPages();
    await makePendingWork();
    const before = snapshot();

    injected.onSecondListing = () => {
      const abs = nodePath.join(repoRoot, "livewiki", "b.md");
      nodeFsSync.writeFileSync(abs, page("B", []) + "\nmodified mid-run\n", "utf8");
      // Force a distinct mtime even on coarse-grained clocks.
      const future = new Date(Date.now() + 5000);
      nodeFsSync.utimesSync(abs, future, future);
    };
    const result = await runLedger(repoRoot, { quiet: true });

    expect(result.status).toBe("aborted");
    expect(result.reason).toMatch(/changed/i);
    expect(snapshot()).toEqual(before);
  });

  it("aborts when a new page appears between plan and revalidate", async () => {
    await seedTwoPages();
    await makePendingWork();
    const before = snapshot();

    injected.onSecondListing = () => {
      nodeFsSync.writeFileSync(
        nodePath.join(repoRoot, "livewiki", "c.md"),
        page("C", []),
        "utf8",
      );
    };
    const result = await runLedger(repoRoot, { quiet: true });

    expect(result.status).toBe("aborted");
    expect(result.reason).toMatch(/appeared/i);
    expect(snapshot()).toEqual(before);
  });
});

describe("anchor-ledger — malformed frontmatter invalidates the plan", () => {
  // The strictness is parseFrontmatter's, already in the product. What changed
  // is the consequence: one bad page no longer lets the rest of the wiki be
  // reconciled around it.
  it.each([
    ["no closing delimiter", "---\ntitle: B\nanchors:\n  - src/b.ts#beta\n\n# B\n"],
    ["invalid line", "---\ntitle: B\nthis is not yaml\n---\n\n# B\n"],
    ["list item without key", "---\n  - orphan\ntitle: B\n---\n\n# B\n"],
  ])("applies nothing when a page has %s", async (_label, broken) => {
    await seedTwoPages();
    await makePendingWork();
    const before = snapshot();
    expect(before.anchors.length).toBeGreaterThanOrEqual(4);

    await write("livewiki/b.md", broken);
    const result = await runLedger(repoRoot, { quiet: true });

    expect(result.status).toBe("aborted");
    expect(result.reason).toMatch(/could not be parsed/i);
    // No anchor, doc_page, debt or undocumented row was reconciled — including
    // for the pages that parsed perfectly well.
    expect(snapshot()).toEqual(before);
  });

  it("applies nothing when an enumerated page cannot be read", async () => {
    await seedTwoPages();
    await makePendingWork();
    const before = snapshot();

    // The page is listed but unreadable — the EACCES case. It must NOT be
    // mistaken for a deletion, and it must not let the other page reconcile.
    injected.failReadOf = "livewiki/b.md";
    let result;
    try {
      result = await runLedger(repoRoot, { quiet: true });
    } finally {
      injected.failReadOf = null;
    }

    expect(result.status).toBe("aborted");
    expect(result.reason).toMatch(/could not be read/i);
    expect(snapshot()).toEqual(before);
    // b.md is still on disk and still has its rows: no false deletion.
    expect(nodeFsSync.existsSync(nodePath.join(repoRoot, "livewiki", "b.md"))).toBe(true);
    expect(snapshot().doc_pages).toHaveLength(2);
  });
});

describe("anchor-ledger — legacy move commits before it rewrites", () => {
  /** alpha relocates to a brand-new file, byte-identical => detected as moved. */
  async function stageMove(): Promise<void> {
    await write("src/a.ts", "");
    await write("src/c.ts", "export function alpha(): number {\n  return 1;\n}\n");
    await runIndexer(repoRoot, { quiet: true });
  }

  function anchorsOf(): string[] {
    const db = new Database(nodePath.join(repoRoot, ".livewiki", "index.db"), { readonly: true });
    try {
      return (db.prepare("SELECT symbol_key FROM anchors ORDER BY id").all() as Array<{ symbol_key: string }>)
        .map((r) => r.symbol_key);
    } finally {
      db.close();
    }
  }
  function movedDebt(): number {
    const db = new Database(nodePath.join(repoRoot, ".livewiki", "index.db"), { readonly: true });
    try {
      return (db.prepare("SELECT COUNT(*) AS n FROM debt WHERE event='moved' AND resolved_at IS NULL")
        .get() as { n: number }).n;
    } finally {
      db.close();
    }
  }

  it("reports applied_with_pending_rewrites, keeps the commit, and converges next run", async () => {
    await seedTwoPages();
    await stageMove();

    // Make the post-commit rewrite fail on its WRITE. A failed read is
    // deliberately tolerated by rewriteSymbolKeyInPage (the page may have been
    // deleted meanwhile), so only the write proves the reporting path.
    const mdPath = nodePath.join(repoRoot, "livewiki", "a.md");
    injected.failWriteOf = "livewiki/a.md";
    let result;
    try {
      result = await runLedger(repoRoot, { quiet: true });
    } finally {
      injected.failWriteOf = null;
    }

    // 1. The failure is reported explicitly, not swallowed.
    expect(result.status).toBe("applied_with_pending_rewrites");
    expect(result.reason).toMatch(/rewrite/i);

    // 2. The DB already committed: anchors moved and the moved debt is durable.
    expect(anchorsOf().some((k) => k === "src/c.ts#alpha")).toBe(true);
    expect(movedDebt()).toBeGreaterThan(0);

    // 2b. The Markdown is genuinely behind: it still names the old key.
    expect(nodeFsSync.readFileSync(mdPath, "utf8")).toContain("src/a.ts#alpha");

    // 3. Next run, with writes working again: converges to applied and repairs
    //    the file, without duplicating the debt.
    const recovered = await runLedger(repoRoot, { quiet: true });
    expect(recovered.status).toBe("applied");
    expect(nodeFsSync.readFileSync(mdPath, "utf8")).toContain("src/c.ts#alpha");
    // The debt was preserved, not duplicated.
    expect(movedDebt()).toBeGreaterThan(0);
  });

  it("rewrites both pages when two moves land, and stays stable", async () => {
    await write("src/a.ts", "export function alpha(): number {\n  return 1;\n}\n");
    await write("src/b.ts", "export function beta(): number {\n  return 2;\n}\n");
    await write("livewiki/a.md", page("A", ["src/a.ts#alpha"]));
    await write("livewiki/b.md", page("B", ["src/b.ts#beta"]));
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    await write("src/a.ts", "");
    await write("src/b.ts", "");
    await write("src/c.ts", "export function alpha(): number {\n  return 1;\n}\n");
    await write("src/d.ts", "export function beta(): number {\n  return 2;\n}\n");
    await runIndexer(repoRoot, { quiet: true });

    const first = await runLedger(repoRoot, { quiet: true });
    expect(first.status).toBe("applied");
    expect(nodeFsSync.readFileSync(nodePath.join(repoRoot, "livewiki/a.md"), "utf8"))
      .toContain("src/c.ts#alpha");
    expect(nodeFsSync.readFileSync(nodePath.join(repoRoot, "livewiki/b.md"), "utf8"))
      .toContain("src/d.ts#beta");

    const before = snapshot();
    const second = await runLedger(repoRoot, { quiet: true });
    expect(second.status).toBe("applied");
    // Stable: no new debt, no churn beyond the run counter/timestamp.
    expect(snapshot().debt).toEqual(before.debt);
    expect(snapshot().anchors).toEqual(before.anchors);
  });
});

describe("anchor-ledger — portable-baseline mode writes no Markdown", () => {
  it("leaves every page byte-identical while a move is pending", async () => {
    await seedTwoPages();
    // Seed a baseline so the run is detection-only for documentation identity.
    const db = new Database(nodePath.join(repoRoot, ".livewiki", "index.db"), { readonly: true });
    const rows = db.prepare(
      "SELECT dp.wiki_path AS wikiPath, a.symbol_key AS symbolKey, s.content_hash AS hash " +
        "FROM anchors a JOIN doc_pages dp ON dp.id = a.doc_page_id " +
        "JOIN symbols s ON s.key = a.symbol_key AND s.status = 'active'",
    ).all() as Array<{ wikiPath: string; symbolKey: string; hash: string }>;
    db.close();
    const seen = new Set<string>();
    const entries = rows.filter((r) => {
      const k = `${r.wikiPath}\0${r.symbolKey}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).map((r) => ({ ...r, extraction: "ts-v1", provenance: "accepted" }));
    await write("livewiki/.baseline.json", JSON.stringify({ schemaVersion: 1, entries }, null, 2) + "\n");

    await write("src/a.ts", "");
    await write("src/c.ts", "export function alpha(): number {\n  return 1;\n}\n");
    await runIndexer(repoRoot, { quiet: true });

    const mdBefore = nodeFsSync.readFileSync(nodePath.join(repoRoot, "livewiki/a.md"), "utf8");
    const result = await runLedger(repoRoot, { quiet: true });
    const mdAfter = nodeFsSync.readFileSync(nodePath.join(repoRoot, "livewiki/a.md"), "utf8");

    expect(result.status).toBe("applied");
    expect(mdAfter).toBe(mdBefore);
    expect(result.movedPairs.every((p) => p.from !== "src/a.ts#alpha")).toBe(true);
  });
});
