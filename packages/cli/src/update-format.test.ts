/**
 * Human formatter for the `livewiki update` work package — backlog #2
 * (plan docs/plans/2026-07-28-change-impact-and-index-freshness.md, Item 2):
 * the output lists the top affected pages from the additive `impact` block
 * and says so when the impact is unavailable (not a git repository) or
 * truncated by a budget.
 */
import { describe, it, expect } from "vitest";
import { formatHuman } from "./commands/update.js";

type WorkPackage = Parameters<typeof formatHuman>[0];

function basePkg(impact: WorkPackage["impact"]): WorkPackage {
  return {
    manifest: null,
    debt: [],
    snippets: [],
    validAnchors: [],
    tokensEstimated: 100,
    bytes: 400,
    language: "en",
    impact,
  };
}

function baseImpact(): WorkPackage["impact"] {
  return {
    mode: "working-tree",
    notGitRepo: false,
    changedFiles: ["src/a.ts"],
    changedSymbols: [{ symbolKey: "src/a.ts#alpha", event: "changed" }],
    pages: [
      {
        wikiPath: "livewiki/a.md",
        items: [{ symbolKey: "src/a.ts#alpha", event: "changed" }],
      },
      {
        wikiPath: "livewiki/b.md",
        items: [{ symbolKey: "src/b.ts#beta", event: "changed" }],
      },
    ],
    importers: ["src/c.ts"],
    snippets: [],
    truncated: false,
    totals: { symbols: 1, pages: 2, importers: 1, snippetCandidates: 1 },
  };
}

describe("update human format — impact block (backlog #2)", () => {
  it("lists the top affected pages with counts", () => {
    const out = formatHuman(basePkg(baseImpact()));
    expect(out).toContain("impact: 1 changed symbol(s), 2 affected page(s), 1 importer(s)");
    expect(out).toContain("livewiki/a.md");
    expect(out).toContain("livewiki/b.md");
    expect(out).not.toContain("truncated");
  });

  it("caps the page list at 5 with a '+N more' line", () => {
    const impact = baseImpact();
    impact.pages = Array.from({ length: 7 }, (_, i) => ({
      wikiPath: `livewiki/page${i}.md`,
      items: [{ symbolKey: `src/f${i}.ts#fn${i}`, event: "changed" as const }],
    }));
    const out = formatHuman(basePkg(impact));
    expect(out).toContain("livewiki/page4.md");
    expect(out).not.toContain("livewiki/page5.md");
    expect(out).toContain("... +2 more");
  });

  it("marks a truncated impact (budget bound — never silent)", () => {
    const impact = { ...baseImpact(), truncated: true };
    const out = formatHuman(basePkg(impact));
    expect(out).toContain("(truncated — see JSON totals)");
  });

  it("says the impact is unavailable outside a git repository", () => {
    const impact = {
      ...baseImpact(),
      notGitRepo: true,
      changedFiles: [],
      changedSymbols: [],
      pages: [],
      importers: [],
      totals: { symbols: 0, pages: 0, importers: 0, snippetCandidates: 0 },
    };
    const out = formatHuman(basePkg(impact));
    expect(out).toContain("impact: unavailable (not a git repository)");
    expect(out).not.toContain("livewiki/a.md");
  });
});
