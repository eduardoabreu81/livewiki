import { describe, it, expect } from "vitest";
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
    expect(out).toContain("class AuthService");
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
});