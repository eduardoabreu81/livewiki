import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  moduleSlug,
  generateStructure,
  generateModulesGraph,
  generateClassDiagram,
} from "./diagrams.js";
import type { SymbolRow } from "./db.js";
import type { Module } from "./modules.js";

describe("diagrams.moduleSlug", () => {
  it("lowercase + alfanum + hífen", () => {
    expect(moduleSlug("Auth Service")).toBe("auth-service");
  });

  it("remove diacríticos (acentos)", () => {
    expect(moduleSlug("autenticação")).toBe("autenticacao");
  });

  it("colapsa múltiplos separadores", () => {
    expect(moduleSlug("foo___bar")).toBe("foo-bar");
  });

  it("trim de hífens nas pontas", () => {
    expect(moduleSlug("---foo---")).toBe("foo");
  });
});

describe("diagrams.generateStructure", () => {
  it("gera graph TD com edges parent→child", () => {
    const out = generateStructure(["src/auth/login.ts", "src/utils/x.ts"]);
    expect(out).toContain("graph TD");
    expect(out).toContain("-->");
  });

  it("lida com lista vazia", () => {
    const out = generateStructure([]);
    expect(out.trim()).toBe("graph TD");
  });

  it("labels não contêm aspas cruas (Mermaid quebraria)", () => {
    // Aspas dentro do label devem ser escapadas (ou o Mermaid quebra).
    const out = generateStructure(['src/has"quote.ts']);
    // Deve ter escapado as aspas — busca pelo padrão problemático
    expect(out).not.toContain('["src/has"quote.ts"]'); // aspas raw quebrariam
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
});

describe("diagrams.generateModulesGraph", () => {
  it("gera graph LR com edges from→to", () => {
    const out = generateModulesGraph([
      { from: "auth", to: "session" },
      { from: "auth", to: "utils" },
    ]);
    expect(out).toContain("graph LR");
    expect(out).toContain("auth --> session");
    expect(out).toContain("auth --> utils");
  });

  it("lida com lista vazia (mostra 'no edges' marker)", () => {
    const out = generateModulesGraph([]);
    expect(out).toContain("No module edges");
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
  it("retorna string vazia quando módulo não tem classes", () => {
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

  it("gera classDiagram com classe + métodos", () => {
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

  it("ignora classes de outros módulos", () => {
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

  it("a hand-crafted malformed diagram (unclosed brace) is rejected by the real parser", async () => {
    const malformed = "classDiagram\n  class Foo {\n    +bar()\n";
    await expect(mermaidParse(malformed)).rejects.toThrow();
  });
});
