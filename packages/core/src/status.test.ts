import { describe, it, expect } from "vitest";
import { formatHuman } from "./status.js";
import type { StatusReport } from "./status.js";

describe("status.formatHuman", () => {
  it("formata relatório vazio", () => {
    const report: StatusReport = {
      files: { total: 0, byLang: {}, top: [] },
      symbols: { total: 0, byKind: {} },
      meta: { schemaVersion: 1, lastIndexedAt: null },
    };
    const out = formatHuman(report);
    expect(out).toContain("livewiki status");
    expect(out).toContain("Arquivos indexados: 0");
    expect(out).toContain("Símbolos extraídos (active): 0");
    expect(out).toContain("last_indexed_at: nunca");
  });

  it("formata relatório populado", () => {
    const report: StatusReport = {
      files: {
        total: 100,
        byLang: { typescript: 70, python: 30 },
        top: [
          { path: "src/big.ts", symbols: 42, lang: "typescript" },
          { path: "lib/util.py", symbols: 5, lang: "python" },
        ],
      },
      symbols: {
        total: 200,
        byKind: { function: 100, class: 30, method: 50, export: 20 },
      },
      meta: { schemaVersion: 1, lastIndexedAt: 1700000000000 },
    };
    const out = formatHuman(report);
    expect(out).toContain("Arquivos indexados: 100");
    expect(out).toContain("typescript");
    expect(out).toContain("python");
    expect(out).toContain("Símbolos extraídos (active): 200");
    expect(out).toContain("function");
    expect(out).toContain("class");
    expect(out).toContain("Top 2 arquivos");
    expect(out).toContain("42");
    expect(out).toContain("src/big.ts");
    // Formato ISO 8601 (toISOString() → "YYYY-MM-DDTHH:MM:SS.sssZ")
    expect(out).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("top-N respeitado (mesmo com mais arquivos no array)", () => {
    const report: StatusReport = {
      files: {
        total: 50,
        byLang: { typescript: 50 },
        top: [
          { path: "a.ts", symbols: 10, lang: "typescript" },
          { path: "b.ts", symbols: 5, lang: "typescript" },
        ],
      },
      symbols: { total: 15, byKind: { function: 15 } },
      meta: { schemaVersion: 1, lastIndexedAt: null },
    };
    const out = formatHuman(report);
    expect(out).toContain("Top 2 arquivos");
    expect(out).not.toContain("Top 50");
  });
});