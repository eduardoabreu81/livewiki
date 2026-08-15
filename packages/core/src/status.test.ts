import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatHuman } from "./status.js";
import type { StatusReport } from "./status.js";
import { run as runStatus } from "./status.js";
import { run as runIndexer } from "./indexer.js";
import { run as runLedger } from "./anchor-ledger.js";
import { openIndex } from "./db.js";

describe("status.formatHuman", () => {
  it("formats empty report", () => {
    const report: StatusReport = {
      files: { total: 0, byLang: {}, tiers: {}, top: [] },
      symbols: { total: 0, byKind: {} },
      debt: {
        baseline: "unavailable",
        total: 0,
        byEvent: { changed: 0, moved: 0, deleted: 0 },
        byAssignee: { agent: 0, human: 0 },
        items: [],
      },
      undocumented: { total: 0, sample: [], byRole: {} },
      metrics: null,
      degraded: { total: 0, pages: [] },
      meta: { schemaVersion: 1, lastIndexedAt: null, lastLedgerAt: null },
    };
    const out = formatHuman(report);
    expect(out).toContain("livewiki status");
    expect(out).toContain("Indexed files: 0");
    expect(out).toContain("Extracted symbols (active): 0");
    expect(out).toContain("Open debt: 0");
    expect(out).toContain("Undocumented: 0");
    expect(out).toContain("last_indexed_at: never");
  });

  it("formats populated report", () => {
    const report: StatusReport = {
      files: {
        total: 100,
        byLang: { typescript: 70, python: 30 },
        tiers: { typescript: "anchored", python: "anchored" },
        top: [
          { path: "src/big.ts", symbols: 42, lang: "typescript" },
          { path: "lib/util.py", symbols: 5, lang: "python" },
        ],
      },
      symbols: {
        total: 200,
        byKind: { function: 100, class: 30, method: 50, export: 20 },
      },
      debt: {
        baseline: "available",
        total: 3,
        byEvent: { changed: 2, moved: 1, deleted: 0 },
        byAssignee: { agent: 2, human: 1 },
        items: [
          {
            id: 1,
            event: "changed",
            assignee: "agent",
            symbol_key: "src/foo.ts#bar",
            wiki_path: "livewiki/foo.md",
            detail: null,
            detected_at: 1700000000000,
          },
          {
            id: 2,
            event: "moved",
            assignee: "agent",
            symbol_key: "src/new.ts#bar",
            wiki_path: null,
            detail: '{"from":"src/foo.ts#bar","to":"src/new.ts#bar"}',
            detected_at: 1700000000001,
          },
        ],
      },
      undocumented: {
        total: 5,
        sample: [{ symbol_key: "src/x.ts#y" }],
        byRole: { product: { total: 5, sample: [{ symbol_key: "src/x.ts#y" }] } },
      },
      metrics: {
        packagesEmitted: 5,
        totalPackageTokens: 4000,
        writesReceived: 5,
        totalWriteTokens: 2000,
        efficiencyRatio: 0.5,
        lastPackage: null,
        lastWrite: null,
        debtResolvedTotal: 0,
        batchRuns: 0,
        batchInputTokens: 0,
        batchOutputTokens: 0,
        recent: [],
      },
      degraded: { total: 0, pages: [] },
      meta: {
        schemaVersion: 2,
        lastIndexedAt: 1700000000000,
        lastLedgerAt: 1700000000001,
      },
    };
    const out = formatHuman(report);
    expect(out).toContain("Indexed files: 100");
    expect(out).toContain("typescript");
    expect(out).toContain("python");
    expect(out).toContain("Extracted symbols (active): 200");
    expect(out).toContain("function");
    expect(out).toContain("class");
    expect(out).toContain("Top 2 files");
    expect(out).toContain("42");
    expect(out).toContain("src/big.ts");
    expect(out).toContain("Open debt: 3");
    expect(out).toContain("changed=2");
    expect(out).toContain("[changed] agent src/foo.ts#bar");
    expect(out).toContain("[moved] agent");
    expect(out).toContain("Undocumented: 5");
    // ISO 8601 format (toISOString() → "YYYY-MM-DDTHH:MM:SS.sssZ")
    expect(out).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    // Empty ledger: no Activity block at all (roadmap item 14).
    expect(out).not.toContain("Activity:");
  });

  it("renders the Activity block with totals and recent events (roadmap item 14)", () => {
    const report: StatusReport = {
      files: { total: 0, byLang: {}, tiers: {}, top: [] },
      symbols: { total: 0, byKind: {} },
      debt: {
        baseline: "unavailable",
        total: 0,
        byEvent: { changed: 0, moved: 0, deleted: 0 },
        byAssignee: { agent: 0, human: 0 },
        items: [],
      },
      undocumented: { total: 0, sample: [], byRole: {} },
      metrics: {
        packagesEmitted: 2,
        totalPackageTokens: 800,
        writesReceived: 1,
        totalWriteTokens: 120,
        efficiencyRatio: 0.15,
        lastPackage: null,
        lastWrite: null,
        debtResolvedTotal: 3,
        batchRuns: 1,
        batchInputTokens: 1000,
        batchOutputTokens: 250,
        recent: [
          {
            kind: "package_emitted",
            timestamp: 1700000000000,
            tokensEstimated: 500,
            bytes: 2000,
            debtCount: 2,
          },
          {
            kind: "write_received",
            timestamp: 1700000060000,
            wikiPath: "livewiki/foo.md",
            bytes: 480,
            tokensEstimated: 120,
          },
          {
            kind: "debt_resolved",
            timestamp: 1700000120000,
            count: 3,
            source: "mcp",
          },
          {
            kind: "batch_run",
            timestamp: 1700000180000,
            runId: 7,
            status: "completed",
            inputTokens: 1000,
            outputTokens: 250,
            costUsd: null,
            durationMs: 1234,
            tasksDone: 4,
            tasksFailed: 0,
          },
        ],
      },
      degraded: { total: 0, pages: [] },
      meta: { schemaVersion: 1, lastIndexedAt: null, lastLedgerAt: null },
    };
    const out = formatHuman(report);
    expect(out).toContain("Activity:");
    expect(out).toContain(
      "2 packages (800 tokens), 1 writes (120 tokens), 3 debt resolved, " +
        "1 batch runs (1000 in / 250 out)",
    );
    expect(out).toContain("package_emitted ~500 tokens, 2 debt items");
    expect(out).toContain("write_received livewiki/foo.md (~120 tokens)");
    expect(out).toContain("debt_resolved 3 item(s) via mcp");
    expect(out).toContain("batch_run #7 completed, 1000 in / 250 out, 1s");
    // Events render as `YYYY-MM-DD HH:mm kind detail` in local time.
    expect(out).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2} batch_run #7/);
  });

  it("top-N respected (even with more files in the array)", () => {
    const report: StatusReport = {
      files: {
        total: 50,
        byLang: { typescript: 50 },
        tiers: { typescript: "anchored" },
        top: [
          { path: "a.ts", symbols: 10, lang: "typescript" },
          { path: "b.ts", symbols: 5, lang: "typescript" },
        ],
      },
      symbols: { total: 15, byKind: { function: 15 } },
      debt: {
        baseline: "unavailable",
        total: 0,
        byEvent: { changed: 0, moved: 0, deleted: 0 },
        byAssignee: { agent: 0, human: 0 },
        items: [],
      },
      undocumented: { total: 0, sample: [], byRole: {} },
      metrics: null,
      degraded: { total: 0, pages: [] },
      meta: { schemaVersion: 1, lastIndexedAt: null, lastLedgerAt: null },
    };
    const out = formatHuman(report);
    expect(out).toContain("Top 2 files");
    expect(out).not.toContain("Top 50");
  });

  it("renders the coverage tier of each language (SPEC coverage ladder)", () => {
    const report: StatusReport = {
      files: {
        total: 15,
        byLang: { go: 12, typescript: 3 },
        tiers: { go: "prose", typescript: "anchored" },
        top: [],
      },
      symbols: { total: 4, byKind: { function: 4 } },
      debt: {
        baseline: "unavailable",
        total: 0,
        byEvent: { changed: 0, moved: 0, deleted: 0 },
        byAssignee: { agent: 0, human: 0 },
        items: [],
      },
      undocumented: { total: 0, sample: [], byRole: {} },
      metrics: null,
      degraded: { total: 0, pages: [] },
      meta: { schemaVersion: 1, lastIndexedAt: null, lastLedgerAt: null },
    };
    const out = formatHuman(report);
    expect(out).toMatch(/go\s+\(prose\)\s+12/);
    expect(out).toMatch(/typescript\s+\(anchored\)\s+3/);
  });

  it("prints the [risk N] marker after a debt item when risk is present", () => {
    const report: StatusReport = {
      files: { total: 0, byLang: {}, tiers: {}, top: [] },
      symbols: { total: 0, byKind: {} },
      debt: {
        baseline: "available",
        total: 1,
        byEvent: { changed: 1, moved: 0, deleted: 0 },
        byAssignee: { agent: 1, human: 0 },
        items: [
          {
            id: 1,
            event: "changed",
            assignee: "agent",
            symbol_key: "src/b.ts#beta",
            wiki_path: "livewiki/b.md",
            detail: null,
            detected_at: 1700000000000,
            risk: { score: 50, factors: { event: 10, testGap: 40, fanIn: 0, churn: 0 } },
          },
        ],
      },
      undocumented: { total: 0, sample: [], byRole: {} },
      metrics: null,
      degraded: { total: 0, pages: [] },
      meta: { schemaVersion: 1, lastIndexedAt: null, lastLedgerAt: null },
    };
    const out = formatHuman(report);
    expect(out).toContain("[changed] agent src/b.ts#beta [risk 50]");
  });
});

describe("status debt baseline", () => {
  let repoRoot: string;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), "livewiki-status-baseline-"));
    await mkdir(join(repoRoot, ".livewiki"), { recursive: true });
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  function deleteLedgerRuns(): void {
    const db = openIndex(join(repoRoot, ".livewiki", "index.db"));
    try {
      db.prepare("DELETE FROM meta WHERE key = 'ledger_runs'").run();
    } finally {
      db.close();
    }
  }

  it("reports unavailable after the first ledger run and preserves existing debt fields", async () => {
    await runLedger(repoRoot, { quiet: true });

    const report = await runStatus(repoRoot);
    expect(report.debt.baseline).toBe("unavailable");
    expect(report.debt).toMatchObject({
      total: 0,
      byEvent: { changed: 0, moved: 0, deleted: 0 },
      byAssignee: { agent: 0, human: 0 },
      items: [],
    });
  });

  it("reports available after the second ledger run", async () => {
    await runLedger(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    expect((await runStatus(repoRoot)).debt.baseline).toBe("available");
  });

  it("treats a pre-existing database without ledger_runs as mature and keeps it mature", async () => {
    await runLedger(repoRoot, { quiet: true });
    deleteLedgerRuns();

    expect((await runStatus(repoRoot)).debt.baseline).toBe("available");

    await runLedger(repoRoot, { quiet: true });
    expect((await runStatus(repoRoot)).debt.baseline).toBe("available");
  });

  it("reports unavailable when neither ledger_runs nor last_ledger_at exists", async () => {
    expect((await runStatus(repoRoot)).debt.baseline).toBe("unavailable");
  });
});

describe("status undocumented symbols by path role", () => {
  let repoRoot: string;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), "livewiki-status-undocumented-role-"));
    await mkdir(join(repoRoot, ".livewiki"), { recursive: true });
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  async function writeRepoFile(rel: string, content: string): Promise<void> {
    const abs = join(repoRoot, rel);
    await mkdir(join(abs, ".."), { recursive: true });
    await writeFile(abs, content);
  }

  it("preserves the raw inventory while separating product and test symbols", async () => {
    await writeRepoFile("src/app.ts", "export function productEntry() { return 1; }\n");
    await writeRepoFile("src/app.test.ts", "export function testHelper() { return 1; }\n");

    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });
    const report = await runStatus(repoRoot);

    expect(report.undocumented.total).toBe(2);
    expect(report.undocumented.sample.map((item) => item.symbol_key).sort()).toEqual([
      "src/app.test.ts#testHelper",
      "src/app.ts#productEntry",
    ]);
    expect(report.undocumented.byRole).toEqual({
      product: { total: 1, sample: [{ symbol_key: "src/app.ts#productEntry" }] },
      test: { total: 1, sample: [{ symbol_key: "src/app.test.ts#testHelper" }] },
    });
    expect(
      Object.values(report.undocumented.byRole).reduce((sum, role) => sum + role.total, 0),
    ).toBe(report.undocumented.total);
    expect(report.undocumented.byRole.fixture).toBeUndefined();
  });

  it("uses the canonical non-JavaScript test layout classification", async () => {
    await writeRepoFile(
      "src/test/java/com/example/Helper.java",
      "package com.example;\npublic class Helper {}\n",
    );

    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });
    const report = await runStatus(repoRoot);

    expect(report.undocumented.byRole.test).toEqual({
      total: 1,
      sample: [{ symbol_key: "src/test/java/com/example/Helper.java#Helper" }],
    });
    expect(report.undocumented.byRole.product).toBeUndefined();
  });

  it("respects user-defined pathRoles patterns", async () => {
    await writeRepoFile("src/checks/helper.ts", "export function customCheck() { return 1; }\n");
    await writeFile(
      join(repoRoot, ".livewiki", "config.json"),
      JSON.stringify({ pathRoles: { testPatterns: ["src/checks/**"] } }) + "\n",
    );

    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });
    const report = await runStatus(repoRoot);

    expect(report.undocumented.byRole.test).toEqual({
      total: 1,
      sample: [{ symbol_key: "src/checks/helper.ts#customCheck" }],
    });
    expect(report.undocumented.byRole.product).toBeUndefined();
  });
});

/**
 * Etapa 2c integration: risk-weighted debt ordering end to end. Temp repo
 * with `src/a.ts` (imported by `src/a.test.ts` — covered) and `src/b.ts`
 * (uncovered); `changed` debt on both must rank the uncovered item first.
 * The temp dir is not a git repo, so the churn factor degrades to 0.
 */
describe("status risk ranking (Etapa 2c) — integration", () => {
  let repoRoot: string;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), "livewiki-status-risk-"));
    await mkdir(join(repoRoot, ".livewiki"), { recursive: true });
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  async function writeRepoFile(rel: string, content: string): Promise<void> {
    const abs = join(repoRoot, rel);
    await mkdir(join(abs, ".."), { recursive: true });
    await writeFile(abs, content);
  }

  /**
   * Arrange pattern from update.test.ts: write source → indexer → ledger →
   * wiki page with frontmatter anchors → indexer → ledger, then modify the
   * sources so the ledger raises `changed` debt on both files.
   */
  async function setupChangedDebtOnBoth(): Promise<void> {
    await writeRepoFile("src/a.ts", "export function alpha() { return 1; }");
    await writeRepoFile("src/b.ts", "export function beta() { return 1; }");
    await writeRepoFile(
      "src/a.test.ts",
      'import { alpha } from "./a";\nexport const probe = alpha();\n',
    );
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });
    await writeRepoFile(
      "livewiki/a.md",
      `---\ntitle: a\nowner: generated\nanchors:\n  - src/a.ts#alpha\n---\n\n# a\n\nDocumentation.\n`,
    );
    await writeRepoFile(
      "livewiki/b.md",
      `---\ntitle: b\nowner: generated\nanchors:\n  - src/b.ts#beta\n---\n\n# b\n\nDocumentation.\n`,
    );
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });
    await writeRepoFile("src/a.ts", "export function alpha() { return 2; }");
    await writeRepoFile("src/b.ts", "export function beta() { return 2; }");
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });
  }

  it("ranks the uncovered file first and attaches the additive risk field", async () => {
    await setupChangedDebtOnBoth();
    const report = await runStatus(repoRoot);
    expect(report.debt.items.length).toBe(2);

    const [first, second] = report.debt.items;
    expect(first?.symbol_key).toBe("src/b.ts#beta");
    expect(first?.risk).toBeDefined();
    expect(first?.risk?.factors).toEqual({ event: 10, testGap: 40, fanIn: 0, churn: 0 });
    expect(first?.risk?.score).toBe(50);

    expect(second?.symbol_key).toBe("src/a.ts#alpha");
    expect(second?.risk?.factors).toEqual({ event: 10, testGap: 0, fanIn: 5, churn: 0 });
    expect(second?.risk?.score).toBe(15);

    const human = formatHuman(report);
    expect(human).toContain("[risk 50]");
    expect(human).toContain("[risk 15]");
  });

  it("riskAnalysis: false keeps chronological order and omits the risk field", async () => {
    await setupChangedDebtOnBoth();
    await writeFile(
      join(repoRoot, ".livewiki/config.json"),
      JSON.stringify({ riskAnalysis: false }) + "\n",
    );
    const report = await runStatus(repoRoot);
    expect(report.debt.items.length).toBe(2);
    for (const item of report.debt.items) {
      expect(item.risk).toBeUndefined();
    }
    // Chronological (detected_at ASC) order preserved.
    for (let i = 1; i < report.debt.items.length; i++) {
      expect(report.debt.items[i]!.detected_at).toBeGreaterThanOrEqual(
        report.debt.items[i - 1]!.detected_at,
      );
    }
    expect(formatHuman(report)).not.toContain("[risk ");
  });
});

/**
 * Recovery tier (Component 2): `status` recovers degraded pages fresh from
 * disk — the frontmatter `quality: degraded` flag is the single source of
 * truth (no schema change). Dot-prefixed PAGES are legit artifacts and
 * must be counted; hidden directories are never descended.
 */
describe("status degraded pages (recovery tier, Component 2)", () => {
  let repoRoot: string;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), "livewiki-status-degraded-"));
    await mkdir(join(repoRoot, ".livewiki"), { recursive: true });
    await mkdir(join(repoRoot, "src"), { recursive: true });
    await writeFile(join(repoRoot, "src/a.ts"), "export function alpha() { return 1; }\n");
    await runIndexer(repoRoot, { quiet: true });
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  async function writeWikiPage(rel: string, frontmatter: string): Promise<void> {
    const abs = join(repoRoot, rel);
    await mkdir(join(abs, ".."), { recursive: true });
    await writeFile(abs, `---\n${frontmatter}\n---\n\n# Page\n\nBody.\n`);
  }

  it("counts pages flagged quality: degraded, including dot-prefixed and nested pages", async () => {
    await writeWikiPage("livewiki/ok.md", "title: ok\nowner: generated");
    await writeWikiPage("livewiki/degraded-page.md", "title: d\nowner: generated\nquality: degraded");
    await writeWikiPage("livewiki/.hidden.md", "title: h\nowner: generated\nquality: degraded");
    await writeWikiPage("livewiki/flows/flow-x.md", "title: f\nowner: generated\nquality: degraded");

    const report = await runStatus(repoRoot);
    expect(report.degraded.total).toBe(3);
    expect(report.degraded.pages).toEqual([
      "livewiki/.hidden.md",
      "livewiki/degraded-page.md",
      "livewiki/flows/flow-x.md",
    ]);

    const human = formatHuman(report);
    expect(human).toContain("Degraded pages (relaxed contract): 3");
    expect(human).toContain("livewiki/flows/flow-x.md");
  });

  it("reports zero and prints no line when no page is degraded", async () => {
    await writeWikiPage("livewiki/ok.md", "title: ok\nowner: generated");

    const report = await runStatus(repoRoot);
    expect(report.degraded).toEqual({ total: 0, pages: [] });
    expect(formatHuman(report)).not.toContain("Degraded pages");
  });
});

/**
 * Backlog #3 (plan 2026-07-28, item 3.1): index freshness in status.
 * `meta.snapshotAgeMs` + `meta.stale`, computed by stat-ing the indexed
 * files only (no repo walk). The human output prints the stale line only
 * when the snapshot is actually stale.
 */
describe("status index freshness (backlog #3)", () => {
  let repoRoot: string;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), "livewiki-status-fresh-"));
    await mkdir(join(repoRoot, ".livewiki"), { recursive: true });
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  it("fresh snapshot: stale false, snapshotAgeMs present, no human line", async () => {
    await mkdir(join(repoRoot, "src"), { recursive: true });
    await writeFile(join(repoRoot, "src/a.ts"), "export function alpha() { return 1; }\n");
    await runIndexer(repoRoot, { quiet: true });

    const report = await runStatus(repoRoot);
    expect(report.meta.stale).toBe(false);
    expect(report.meta.staleChangedFiles).toBe(0);
    expect(typeof report.meta.snapshotAgeMs).toBe("number");
    expect(report.meta.snapshotAgeMs).toBeGreaterThanOrEqual(0);
    expect(formatHuman(report)).not.toContain("index is stale");
  });

  it("touched file: stale true with count, human line printed", async () => {
    await mkdir(join(repoRoot, "src"), { recursive: true });
    const abs = join(repoRoot, "src/a.ts");
    await writeFile(abs, "export function alpha() { return 1; }\n");
    await runIndexer(repoRoot, { quiet: true });

    // Deterministic touch: bump the on-disk mtime past last_indexed_at
    // regardless of filesystem mtime granularity.
    const future = new Date(Date.now() + 10_000);
    await utimes(abs, future, future);

    const report = await runStatus(repoRoot);
    expect(report.meta.stale).toBe(true);
    expect(report.meta.staleChangedFiles).toBe(1);
    const human = formatHuman(report);
    expect(human).toMatch(/index is stale \(snapshot \S+; 1 changed files detected\)/);
  });

  it("missing file: stale true, human line printed", async () => {
    await mkdir(join(repoRoot, "src"), { recursive: true });
    const abs = join(repoRoot, "src/a.ts");
    await writeFile(abs, "export function alpha() { return 1; }\n");
    await runIndexer(repoRoot, { quiet: true });
    await rm(abs);

    const report = await runStatus(repoRoot);
    expect(report.meta.stale).toBe(true);
    expect(report.meta.staleChangedFiles).toBe(1);
    expect(formatHuman(report)).toContain("index is stale");
  });

  it("re-index after the touch clears the stale flag", async () => {
    await mkdir(join(repoRoot, "src"), { recursive: true });
    const abs = join(repoRoot, "src/a.ts");
    await writeFile(abs, "export function alpha() { return 1; }\n");
    await runIndexer(repoRoot, { quiet: true });
    const future = new Date(Date.now() + 10_000);
    await utimes(abs, future, future);
    expect((await runStatus(repoRoot)).meta.stale).toBe(true);

    // Content changed → the indexer refreshes the row and the snapshot is
    // fresh again (last_indexed_at > on-disk mtime).
    await writeFile(abs, "export function alpha() { return 2; }\n");
    await runIndexer(repoRoot, { quiet: true });
    expect((await runStatus(repoRoot)).meta.stale).toBe(false);
  });

  it("never indexed: snapshotAgeMs null, stale false", async () => {
    await mkdir(join(repoRoot, "src"), { recursive: true });
    await writeFile(join(repoRoot, "src/a.ts"), "export function alpha() { return 1; }\n");

    const report = await runStatus(repoRoot);
    expect(report.meta.lastIndexedAt).toBeNull();
    expect(report.meta.snapshotAgeMs).toBeNull();
    expect(report.meta.stale).toBe(false);
    expect(formatHuman(report)).not.toContain("index is stale");
  });
});

/**
 * Debt identity durability (schema v8, external review 2026-08-03): the
 * status debt report must keep symbol_key and wiki_path actionable AFTER
 * the anchor row is gone — via the durable debt.symbol_key and
 * debt.doc_page_id columns, not only the live anchors join.
 */
describe("status debt identity durability (schema v8)", () => {
  let repoRoot: string;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), "livewiki-status-durable-"));
    await mkdir(join(repoRoot, ".livewiki"), { recursive: true });
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  async function writeRepoFile(rel: string, content: string): Promise<void> {
    const abs = join(repoRoot, rel);
    await mkdir(join(abs, ".."), { recursive: true });
    await writeFile(abs, content);
  }

  const ANCHORED_PAGE = `---\ntitle: a\nowner: generated\nanchors:\n  - src/a.ts#alpha\n---\n\n# a\n\nDocumentation.\n`;

  async function setupDeletedDebt(): Promise<void> {
    await writeRepoFile("src/a.ts", "export function alpha() { return 1; }\n");
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });
    await writeRepoFile("livewiki/a.md", ANCHORED_PAGE);
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });
    // Symbol disappears from the code → `deleted` debt (anchor row exists).
    await writeRepoFile("src/a.ts", "export function other() { return 2; }\n");
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });
  }

  it("page alive, anchor edited out: symbol_key AND wiki_path stay actionable", async () => {
    await setupDeletedDebt();
    // The anchor is edited out of the page (page stays) — the ledger drops
    // the anchor row; only the durable debt columns keep the identity.
    await writeRepoFile(
      "livewiki/a.md",
      `---\ntitle: a\nowner: generated\n---\n\n# a\n\nDocumentation.\n`,
    );
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const report = await runStatus(repoRoot);
    const row = report.debt.items.find((i) => i.event === "deleted");
    expect(row).toBeDefined();
    expect(row!.symbol_key).toBe("src/a.ts#alpha");
    expect(row!.wiki_path).toBe("livewiki/a.md");
  });

  it("page deleted: symbol_key survives (durable column), wiki_path is null", async () => {
    await setupDeletedDebt();
    // The whole page goes away — there is genuinely no page to pay, so a
    // null wiki_path is CORRECT; the symbol identity must still survive.
    await rm(join(repoRoot, "livewiki", "a.md"));
    await runIndexer(repoRoot, { quiet: true });
    await runLedger(repoRoot, { quiet: true });

    const report = await runStatus(repoRoot);
    const row = report.debt.items.find((i) => i.event === "deleted");
    expect(row).toBeDefined();
    expect(row!.symbol_key).toBe("src/a.ts#alpha");
    expect(row!.wiki_path).toBeNull();
  });
});
