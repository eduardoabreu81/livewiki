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

  it("'names' não duplica o próprio módulo 'from' quando o alvo é um dotted_name absoluto", async () => {
    // Priority-0 fix: `module_name`'s own node type ("dotted_name") for an
    // absolute "from" target used to also match the loop that collects
    // imported names, so "from app.services import bgm" produced
    // names: ["app.services", "bgm"] instead of just ["bgm"].
    const imps = await collectImports(
      "src/foo.py",
      `from app.services import bgm as bgm_service, llm`,
    );
    expect(imps).toHaveLength(1);
    expect(imps[0]?.source).toBe("app.services");
    expect(imps[0]?.names).toEqual(["bgm as bgm_service", "llm"]);
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

describe("imports.collectImports (Go)", () => {
  it("extrai import simples", async () => {
    const imps = await collectImports(
      "main.go",
      `package main\n\nimport "fmt"\n\nfunc main() { fmt.Println() }\n`,
    );
    expect(imps).toEqual([{ source: "fmt", kind: "go-import" }]);
  });

  it("extrai import agrupado, com alias e blank import", async () => {
    const imps = await collectImports(
      "cmd/main.go",
      `package main

import (
	"fmt"

	"example.com/mod/server"
	alias "example.com/mod/other"
	_ "example.com/mod/sideeffect"
)
`,
    );
    expect(imps.map((i) => i.source)).toEqual([
      "fmt",
      "example.com/mod/server",
      "example.com/mod/other",
      "example.com/mod/sideeffect",
    ]);
    expect(imps.every((i) => i.kind === "go-import")).toBe(true);
  });

  it("strip aspas/backticks do path", async () => {
    const imps = await collectImports(
      "main.go",
      "package main\n\nimport `fmt`\n",
    );
    expect(imps[0]?.source).toBe("fmt");
    expect(imps[0]?.source).not.toMatch(/["`]/);
  });
});

describe("imports.collectImports (Rust, roadmap item 20)", () => {
  it("extrai use simples e com path scoped", async () => {
    const imps = await collectImports(
      "src/main.rs",
      "use std::fmt;\nuse crate::server::Server;\n\nfn main() {}\n",
    );
    expect(imps).toEqual([
      { source: "std::fmt", kind: "rust-use" },
      { source: "crate::server::Server", kind: "rust-use" },
    ]);
  });

  it("extrai use com chaves registrando o prefixo compartilhado", async () => {
    const imps = await collectImports(
      "src/main.rs",
      "use std::collections::{HashMap, BTreeMap};\n",
    );
    expect(imps).toEqual([{ source: "std::collections", kind: "rust-use" }]);
  });

  it("extrai use com alias registrando o path original", async () => {
    const imps = await collectImports(
      "src/main.rs",
      "use crate::server::Server as Srv;\n",
    );
    expect(imps).toEqual([{ source: "crate::server::Server", kind: "rust-use" }]);
  });

  it("extrai use wildcard sem o sufixo ::*", async () => {
    const imps = await collectImports("src/main.rs", "use super::models::*;\n");
    expect(imps).toEqual([{ source: "super::models", kind: "rust-use" }]);
  });

  it("extrai pub use da mesma forma", async () => {
    const imps = await collectImports(
      "src/lib.rs",
      "pub use crate::server::Server;\n",
    );
    expect(imps).toEqual([{ source: "crate::server::Server", kind: "rust-use" }]);
  });

  it("extrai mod foo; como rust-mod e ignora mod inline com corpo", async () => {
    const imps = await collectImports(
      "src/main.rs",
      "mod server;\nmod inline {\n    pub fn x() {}\n}\n",
    );
    expect(imps).toEqual([{ source: "server", kind: "rust-mod" }]);
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