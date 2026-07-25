import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatHuman } from "./status.js";
import type { StatusReport } from "./status.js";
import { run as runStatus } from "./status.js";
import { run as runIndexer } from "./indexer.js";
import { run as runLedger } from "./anchor-ledger.js";

describe("status.formatHuman", () => {
  it("formats empty report", () => {
    const report: StatusReport = {
      files: { total: 0, byLang: {}, tiers: {}, top: [] },
      symbols: { total: 0, byKind: {} },
      debt: {
        total: 0,
        byEvent: { changed: 0, moved: 0, deleted: 0 },
        byAssignee: { agent: 0, human: 0 },
        items: [],
      },
      undocumented: { total: 0, sample: [] },
      metrics: null,
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
      undocumented: { total: 5, sample: [{ symbol_key: "src/x.ts#y" }] },
      metrics: {
        packagesEmitted: 5,
        totalPackageTokens: 4000,
        writesReceived: 5,
        totalWriteTokens: 2000,
        efficiencyRatio: 0.5,
        lastPackage: null,
        lastWrite: null,
      },
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
        total: 0,
        byEvent: { changed: 0, moved: 0, deleted: 0 },
        byAssignee: { agent: 0, human: 0 },
        items: [],
      },
      undocumented: { total: 0, sample: [] },
      metrics: null,
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
        total: 0,
        byEvent: { changed: 0, moved: 0, deleted: 0 },
        byAssignee: { agent: 0, human: 0 },
        items: [],
      },
      undocumented: { total: 0, sample: [] },
      metrics: null,
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
      undocumented: { total: 0, sample: [] },
      metrics: null,
      meta: { schemaVersion: 1, lastIndexedAt: null, lastLedgerAt: null },
    };
    const out = formatHuman(report);
    expect(out).toContain("[changed] agent src/b.ts#beta [risk 50]");
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