import { describe, it, expect } from "vitest";
import { formatHuman } from "./status.js";
import type { StatusReport } from "./status.js";

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
});