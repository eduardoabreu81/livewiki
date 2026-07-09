import { describe, it, expect } from "vitest";
import { collectImports, extractImportsFromTree } from "./imports.js";
import { initParser, parseSource } from "./parser.js";

describe("imports.collectImports (TS)", () => {
  it("extrai import relativo", async () => {
    const imps = await collectImports(
      "src/foo.ts",
      `import { bar } from "./bar";\nexport const x = 1;`,
    );
    const sources = imps.map((i) => i.source);
    expect(sources).toContain("./bar");
  });

  it("extrai export from (re-export)", async () => {
    const imps = await collectImports(
      "src/foo.ts",
      `export { bar } from "./bar";`,
    );
    const sources = imps.map((i) => i.source);
    expect(sources).toContain("./bar");
    expect(imps[0]?.kind).toBe("ts-export");
  });

  it("extrai import absoluto (não-relativo)", async () => {
    const imps = await collectImports(
      "src/foo.ts",
      `import express from "express";\nimport { join } from "node:path";`,
    );
    const sources = imps.map((i) => i.source);
    expect(sources).toContain("express");
    expect(sources).toContain("node:path");
  });

  it("strip aspas do source", async () => {
    const imps = await collectImports(
      "src/foo.ts",
      `import x from "./bar";`,
    );
    expect(imps[0]?.source).toBe("./bar");
    expect(imps[0]?.source).not.toMatch(/['"]/);
  });

  it("múltiplos imports no mesmo arquivo", async () => {
    const imps = await collectImports(
      "src/foo.ts",
      `import a from "./a";\nimport b from "./b";\nimport c from "../c";`,
    );
    expect(imps).toHaveLength(3);
    expect(imps.map((i) => i.source).sort()).toEqual(["../c", "./a", "./b"]);
  });
});

describe("imports.collectImports (Python)", () => {
  it("extrai 'from X import Y'", async () => {
    const imps = await collectImports(
      "src/foo.py",
      `from os import path\nfrom .local import helper`,
    );
    const sources = imps.map((i) => i.source);
    expect(sources).toContain("os");
    expect(sources).toContain(".local");
  });

  it("extrai 'import X' (sem from)", async () => {
    const imps = await collectImports(
      "src/foo.py",
      `import os\nimport sys.path`,
    );
    const sources = imps.map((i) => i.source);
    expect(sources).toContain("os");
    expect(sources).toContain("sys.path");
  });
});

describe("imports.collectImports (edge cases)", () => {
  it("arquivo não-parseável retorna [] (graceful)", async () => {
    const imps = await collectImports("src/foo.ts", "this is not { valid ts");
    expect(imps).toEqual([]);
  });

  it("arquivo sem imports retorna []", async () => {
    const imps = await collectImports("src/foo.ts", "const x = 1;");
    expect(imps).toEqual([]);
  });
});