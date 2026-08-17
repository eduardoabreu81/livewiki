import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  moduleSlug,
  generateStructure,
  generateModulesGraph,
  generateClassDiagram,
  STRUCTURE_MAX_EDGES,
} from "./diagrams.js";
import type { SymbolRow } from "./db.js";
import type { Module } from "./modules.js";

describe("diagrams.moduleSlug", () => {
  it("lowercase + alphanumeric + hyphen", () => {
    expect(moduleSlug("Auth Service")).toBe("auth-service");
  });

  it("removes diacritics (accents)", () => {
    expect(moduleSlug("autenticação")).toBe("autenticacao");
  });

  it("collapses multiple separators", () => {
    expect(moduleSlug("foo___bar")).toBe("foo-bar");
  });

  it("trims hyphens at the ends", () => {
    expect(moduleSlug("---foo---")).toBe("foo");
  });
});

describe("diagrams.generateStructure", () => {
  it("generates graph LR with parent→child edges", () => {
    const out = generateStructure(["src/auth/login.ts", "src/utils/x.ts"]);
    expect(out).toContain("graph LR");
    expect(out).toContain("-->");
  });

  it("handles empty list", () => {
    const out = generateStructure([]);
    expect(out.trim()).toBe("graph LR");
  });

  it("labels do not contain raw quotes (Mermaid would break)", () => {
    // Quotes inside the label must be escaped (or Mermaid breaks).
    const out = generateStructure(['src/has"quote.ts']);
    // It must have escaped the quotes — search for the problematic pattern
    expect(out).not.toContain('["src/has"quote.ts"]'); // raw quotes would break
  });

  it("emits each shared directory edge only once", () => {
    const out = generateStructure([
      "docs/benchmarks/a.ts",
      "docs/benchmarks/b.ts",
      "docs/benchmarks/nested/c.ts",
    ]);
    expect(out.split("\n").filter((line) => line.trim() === "docs --> docs_benchmarks"))
      .toHaveLength(1);
  });

  it("collapses to per-directory (N files) nodes over the Mermaid edge budget", () => {
    // 10 dirs × 60 files = 600 file edges — over STRUCTURE_MAX_EDGES (450).
    // Mermaid's parser rejects >500 edges (secure maxEdges config), so the
    // exact graph would fail livewiki's own verify on a medium repo.
    const files: string[] = [];
    for (let d = 0; d < 10; d++) {
      for (let f = 0; f < 60; f++) files.push(`pkg/mod${d}/file${f}.ts`);
    }
    const out = generateStructure(files);
    const edgeCount = out.split("\n").filter((line) => line.includes("-->")).length;
    expect(edgeCount).toBeLessThanOrEqual(STRUCTURE_MAX_EDGES);
    expect(out).toContain("pkg/mod0/… (60 files)");
    expect(out).not.toContain("file0.ts");
    // Directory chain is preserved: pkg --> pkg_mod0.
    expect(out).toContain("pkg --> pkg_mod0");
  });

  it("stays exact (per-file nodes) under the budget", () => {
    const files = Array.from({ length: 30 }, (_, i) => `src/f${i}.ts`);
    const out = generateStructure(files);
    expect(out).toContain('src_f0_ts["src/f0.ts"]');
    expect(out).not.toContain("files)");
  });
});

describe("diagrams.generateModulesGraph", () => {
  it("generates graph LR with from→to edges", () => {
    const out = generateModulesGraph([
      { from: "auth", to: "session" },
      { from: "auth", to: "utils" },
    ]);
    expect(out).toContain("graph LR");
    expect(out).toContain("auth --> session");
    expect(out).toContain("auth --> utils");
  });

  it("handles empty list (shows 'no edges' marker)", () => {
    const out = generateModulesGraph([]);
    expect(out).toContain("No cross-folder imports detected");
  });

  it("declares a node once when it has multiple outgoing edges", () => {
    const out = generateModulesGraph([
      { from: "auth", to: "session" },
      { from: "auth", to: "utils" },
      { from: "auth", to: "db" },
    ]);
    const declLines = out
      .split("\n")
      .filter((l) => /^\s*auth\["auth"\]\s*$/.test(l));
    expect(declLines.length).toBe(1);
  });

  it("declares a node once when it appears as both an edge source and target", () => {
    const out = generateModulesGraph([
      { from: "auth", to: "session" },
      { from: "session", to: "db" },
    ]);
    const sessionDecls = out
      .split("\n")
      .filter((l) => /^\s*session\["session"\]\s*$/.test(l));
    expect(sessionDecls.length).toBe(1);
  });

  it("emits duplicate dependency edges only once", () => {
    const out = generateModulesGraph([
      { from: "auth", to: "session" },
      { from: "auth", to: "session" },
    ]);
    expect(out.split("\n").filter((line) => line.trim() === "auth --> session"))
      .toHaveLength(1);
  });
});

describe("diagrams.generateClassDiagram", () => {
  it("returns empty string when the module has no classes", () => {
    const module: Module = { id: "auth", paths: ["src/auth/foo.ts"], symbolCount: 1 };
    const symbols: SymbolRow[] = [
      {
        id: 1,
        file_id: 1,
        key: "src/auth/foo.ts#bar",
        name: "bar",
        kind: "function",
        signature: null,
        start_line: 1,
        end_line: 1,
        content_hash: "h",
        status: "active",
      },
    ];
    expect(generateClassDiagram(module, symbols)).toBe("");
  });

  it("generates classDiagram with class + methods", () => {
    const module: Module = { id: "auth", paths: ["src/auth/foo.ts"], symbolCount: 2 };
    const symbols: SymbolRow[] = [
      {
        id: 1,
        file_id: 1,
        key: "src/auth/foo.ts#AuthService",
        name: "AuthService",
        kind: "class",
        signature: null,
        start_line: 1,
        end_line: 10,
        content_hash: "h",
        status: "active",
      },
      {
        id: 2,
        file_id: 1,
        key: "src/auth/foo.ts#AuthService.login",
        name: "login",
        kind: "method",
        signature: "+login()",
        start_line: 2,
        end_line: 5,
        content_hash: "h",
        status: "active",
      },
    ];
    const out = generateClassDiagram(module, symbols);
    expect(out).toContain("classDiagram");
    expect(out).toContain('class class_1["AuthService"]');
    expect(out).toContain("+login()");
  });

  it("class diagrams emit `direction TB`; the other deterministic graphs do not", () => {
    const module: Module = { id: "auth", paths: ["src/auth/foo.ts"], symbolCount: 1 };
    const symbols: SymbolRow[] = [
      {
        id: 1,
        file_id: 1,
        key: "src/auth/foo.ts#AuthService",
        name: "AuthService",
        kind: "class",
        signature: null,
        start_line: 1,
        end_line: 10,
        content_hash: "h",
        status: "active",
      },
    ];
    const classDiagram = generateClassDiagram(module, symbols);
    // Sparse inventories (few/zero edges) render as a tiny horizontal row
    // without an explicit direction.
    expect(classDiagram).toContain("classDiagram\n  direction TB\n");

    // Flow-style graphs keep their own direction — no `direction TB`.
    expect(generateStructure(["src/auth/foo.ts", "src/auth/bar.ts"])).not.toContain("direction TB");
    expect(generateModulesGraph([{ from: "auth", to: "session" }])).not.toContain("direction TB");
  });

  it("edge-less class diagrams chain classes with themeCSS-hidden links (vertical stacking)", () => {
    const module: Module = { id: "auth", paths: ["src/auth/foo.ts"], symbolCount: 3 };
    const classSymbol = (id: number, name: string): SymbolRow => ({
      id,
      file_id: 1,
      key: `src/auth/foo.ts#${name}`,
      name,
      kind: "class",
      signature: null,
      start_line: 1,
      end_line: 10,
      content_hash: "h",
      status: "active",
    });
    const out = generateClassDiagram(module, [
      classSymbol(1, "Alpha"),
      classSymbol(2, "Beta"),
      classSymbol(3, "Gamma"),
    ]);

    // Mermaid ignores `direction TB` with zero edges (probed on 11.16:
    // 524x142 horizontal viewBox). The chain forces vertical stacking;
    // the themeCSS directive hides the connectors (probed: 124x628
    // viewBox, stroke transparent, under strict AND loose securityLevel).
    // `~~~` is a flowchart-only idiom and linkStyle is ignored by the
    // class renderer — themeCSS is the only mechanism that works.
    expect(out).toContain("direction TB");
    expect(out).toContain("class_1 -- class_2");
    expect(out).toContain("class_2 -- class_3");
    expect(out).toContain('.relation { stroke: transparent !important; }');
    // The init directive must precede the diagram type line.
    expect(out.indexOf("%%{init:")).toBeLessThan(out.indexOf("classDiagram"));
    // The chain links come after the class declarations.
    expect(out.indexOf("class_1 -- class_2")).toBeGreaterThan(out.indexOf('class class_3["Gamma"]'));
  });

  it("a single-class diagram gets no chain and no directive", () => {
    const module: Module = { id: "auth", paths: ["src/auth/foo.ts"], symbolCount: 1 };
    const symbols: SymbolRow[] = [
      {
        id: 1,
        file_id: 1,
        key: "src/auth/foo.ts#AuthService",
        name: "AuthService",
        kind: "class",
        signature: null,
        start_line: 1,
        end_line: 10,
        content_hash: "h",
        status: "active",
      },
    ];
    const out = generateClassDiagram(module, symbols);
    expect(out).toContain("direction TB");
    expect(out).not.toContain("%%{init:");
    expect(out).not.toContain("-- class_");
    expect(out).not.toContain("~~~");
  });

  it("ignores classes from other modules", () => {
    const module: Module = { id: "auth", paths: ["src/auth/foo.ts"], symbolCount: 1 };
    const symbols: SymbolRow[] = [
      {
        id: 1,
        file_id: 99,
        key: "src/other/foo.ts#OtherClass",
        name: "OtherClass",
        kind: "class",
        signature: null,
        start_line: 1,
        end_line: 1,
        content_hash: "h",
        status: "active",
      },
    ];
    expect(generateClassDiagram(module, symbols)).toBe("");
  });

  it("keeps same-named classes in different files distinct without mixing methods", () => {
    const module: Module = {
      id: "core",
      paths: ["src/a.ts", "src/b.ts"],
      symbolCount: 4,
    };
    const symbols: SymbolRow[] = [
      {
        id: 1, file_id: 1, key: "src/a.ts#MockLlm", name: "MockLlm", kind: "class",
        signature: null, start_line: 1, end_line: 5, content_hash: "h", status: "active",
      },
      {
        id: 2, file_id: 1, key: "src/a.ts#MockLlm.fromA", name: "fromA", kind: "method",
        signature: "+fromA()", start_line: 2, end_line: 3, content_hash: "h", status: "active",
      },
      {
        id: 3, file_id: 2, key: "src/b.ts#MockLlm", name: "MockLlm", kind: "class",
        signature: null, start_line: 1, end_line: 5, content_hash: "h", status: "active",
      },
      {
        id: 4, file_id: 2, key: "src/b.ts#MockLlm.fromB", name: "fromB", kind: "method",
        signature: "+fromB()", start_line: 2, end_line: 3, content_hash: "h", status: "active",
      },
    ];
    const out = generateClassDiagram(module, symbols);
    const blocks = out
      .split(/(?=  class class_\d+\["MockLlm"\] \{)/)
      .filter((block) => /^  class class_\d+\["MockLlm"\] \{/.test(block));
    expect(blocks.length).toBe(2);
    // Each block has exactly ONE method — not both merged into each.
    for (const block of blocks) {
      const hasA = block.includes("+fromA()");
      const hasB = block.includes("+fromB()");
      expect(hasA !== hasB).toBe(true); // exclusive-or: never both, never neither
    }
  });
});

/**
 * Real Mermaid syntax validation, not delimiter counting.
 * `mermaid` + `jsdom` are devDependencies ONLY — used here to confirm the
 * deterministic generators produce grammatically valid Mermaid. NOT wired
 * into `verify` at runtime (no new dependency shipped to end users).
 */
describe("diagrams — generated output is valid Mermaid (real parser, devDependency-only)", () => {
  let mermaidParse: (text: string) => Promise<unknown>;

  beforeAll(async () => {
    const { JSDOM } = await import("jsdom");
    const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
    (globalThis as Record<string, unknown>).window = dom.window;
    (globalThis as Record<string, unknown>).document = dom.window.document;
    const mermaid = (await import("mermaid")).default;
    mermaid.initialize({ startOnLoad: false });
    mermaidParse = (text: string) => mermaid.parse(text);
  });

  afterAll(() => {
    delete (globalThis as Record<string, unknown>).window;
    delete (globalThis as Record<string, unknown>).document;
  });

  it("generateStructure output parses as a valid flowchart", async () => {
    const out = generateStructure(["src/auth/login.ts", "src/utils/x.ts"]);
    await expect(mermaidParse(out)).resolves.toBeTruthy();
  });

  it("generateModulesGraph output parses as a valid flowchart", async () => {
    const out = generateModulesGraph([
      { from: "auth", to: "session" },
      { from: "auth", to: "utils" },
    ]);
    await expect(mermaidParse(out)).resolves.toBeTruthy();
  });

  it("generateClassDiagram output parses as a valid classDiagram", async () => {
    const module: Module = { id: "auth", paths: ["src/auth/foo.ts"], symbolCount: 2 };
    const symbols: SymbolRow[] = [
      {
        id: 1, file_id: 1, key: "src/auth/foo.ts#AuthService", name: "AuthService", kind: "class",
        signature: null, start_line: 1, end_line: 10, content_hash: "h", status: "active",
      },
      {
        id: 2, file_id: 1, key: "src/auth/foo.ts#AuthService.login", name: "login", kind: "method",
        signature: "+login()", start_line: 2, end_line: 5, content_hash: "h", status: "active",
      },
    ];
    const out = generateClassDiagram(module, symbols);
    await expect(mermaidParse(out)).resolves.toBeTruthy();
  });

  it("edge-less multi-class output (themeCSS directive + chain) parses as valid Mermaid", async () => {
    const module: Module = { id: "auth", paths: ["src/auth/foo.ts"], symbolCount: 2 };
    const symbols: SymbolRow[] = [
      {
        id: 1, file_id: 1, key: "src/auth/foo.ts#Alpha", name: "Alpha", kind: "class",
        signature: null, start_line: 1, end_line: 10, content_hash: "h", status: "active",
      },
      {
        id: 2, file_id: 1, key: "src/auth/foo.ts#Beta", name: "Beta", kind: "class",
        signature: null, start_line: 11, end_line: 20, content_hash: "h", status: "active",
      },
    ];
    const out = generateClassDiagram(module, symbols);
    expect(out).toContain("%%{init:"); // sanity: this test covers the chained shape
    await expect(mermaidParse(out)).resolves.toBeTruthy();
  });

  it("a hand-crafted malformed diagram (unclosed brace) is rejected by the real parser", async () => {
    const malformed = "classDiagram\n  class Foo {\n    +bar()\n";
    await expect(mermaidParse(malformed)).rejects.toThrow();
  });
});
