import { describe, it, expect } from "vitest";
import { collectImports, extractImportsFromTree } from "./imports.js";
import { initParser, parseSource } from "./parser.js";

describe("imports.collectImports (TS)", () => {
  it("extracts a relative import", async () => {
    const imps = await collectImports(
      "src/foo.ts",
      `import { bar } from "./bar";\nexport const x = 1;`,
    );
    const sources = imps.map((i) => i.source);
    expect(sources).toContain("./bar");
  });

  it("extracts export from (re-export)", async () => {
    const imps = await collectImports(
      "src/foo.ts",
      `export { bar } from "./bar";`,
    );
    const sources = imps.map((i) => i.source);
    expect(sources).toContain("./bar");
    expect(imps[0]?.kind).toBe("ts-export");
  });

  it("extracts an absolute (non-relative) import", async () => {
    const imps = await collectImports(
      "src/foo.ts",
      `import express from "express";\nimport { join } from "node:path";`,
    );
    const sources = imps.map((i) => i.source);
    expect(sources).toContain("express");
    expect(sources).toContain("node:path");
  });

  it("strips quotes from the source", async () => {
    const imps = await collectImports(
      "src/foo.ts",
      `import x from "./bar";`,
    );
    expect(imps[0]?.source).toBe("./bar");
    expect(imps[0]?.source).not.toMatch(/['"]/);
  });

  it("multiple imports in the same file", async () => {
    const imps = await collectImports(
      "src/foo.ts",
      `import a from "./a";\nimport b from "./b";\nimport c from "../c";`,
    );
    expect(imps).toHaveLength(3);
    expect(imps.map((i) => i.source).sort()).toEqual(["../c", "./a", "./b"]);
  });
});

describe("imports.collectImports (Python)", () => {
  it("extracts 'from X import Y'", async () => {
    const imps = await collectImports(
      "src/foo.py",
      `from os import path\nfrom .local import helper`,
    );
    const sources = imps.map((i) => i.source);
    expect(sources).toContain("os");
    expect(sources).toContain(".local");
  });

  it("'names' does not duplicate the 'from' module itself when the target is an absolute dotted_name", async () => {
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

  it("extracts 'import X' (without from)", async () => {
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
  it("extracts a simple import", async () => {
    const imps = await collectImports(
      "main.go",
      `package main\n\nimport "fmt"\n\nfunc main() { fmt.Println() }\n`,
    );
    expect(imps).toEqual([{ source: "fmt", kind: "go-import" }]);
  });

  it("extracts grouped import, with alias and blank import", async () => {
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

  it("strips quotes/backticks from the path", async () => {
    const imps = await collectImports(
      "main.go",
      "package main\n\nimport `fmt`\n",
    );
    expect(imps[0]?.source).toBe("fmt");
    expect(imps[0]?.source).not.toMatch(/["`]/);
  });
});

describe("imports.collectImports (Rust, roadmap item 20)", () => {
  it("extracts simple use and use with a scoped path", async () => {
    const imps = await collectImports(
      "src/main.rs",
      "use std::fmt;\nuse crate::server::Server;\n\nfn main() {}\n",
    );
    expect(imps).toEqual([
      { source: "std::fmt", kind: "rust-use" },
      { source: "crate::server::Server", kind: "rust-use" },
    ]);
  });

  it("extracts use with braces recording the shared prefix", async () => {
    const imps = await collectImports(
      "src/main.rs",
      "use std::collections::{HashMap, BTreeMap};\n",
    );
    expect(imps).toEqual([{ source: "std::collections", kind: "rust-use" }]);
  });

  it("extracts use with alias recording the original path", async () => {
    const imps = await collectImports(
      "src/main.rs",
      "use crate::server::Server as Srv;\n",
    );
    expect(imps).toEqual([{ source: "crate::server::Server", kind: "rust-use" }]);
  });

  it("extracts wildcard use without the ::* suffix", async () => {
    const imps = await collectImports("src/main.rs", "use super::models::*;\n");
    expect(imps).toEqual([{ source: "super::models", kind: "rust-use" }]);
  });

  it("extracts pub use in the same way", async () => {
    const imps = await collectImports(
      "src/lib.rs",
      "pub use crate::server::Server;\n",
    );
    expect(imps).toEqual([{ source: "crate::server::Server", kind: "rust-use" }]);
  });

  it("extracts mod foo; as rust-mod and ignores an inline mod with a body", async () => {
    const imps = await collectImports(
      "src/main.rs",
      "mod server;\nmod inline {\n    pub fn x() {}\n}\n",
    );
    expect(imps).toEqual([{ source: "server", kind: "rust-mod" }]);
  });
});

describe("imports.collectImports (Java, roadmap item 21)", () => {
  it("extracts a simple import with the full path", async () => {
    const imps = await collectImports(
      "src/main/java/com/fixture/Main.java",
      "package com.fixture;\n\nimport com.fixture.server.Server;\n\nclass Main {}\n",
    );
    expect(imps).toEqual([{ source: "com.fixture.server.Server", kind: "java-import" }]);
  });

  it("extracts a static import keeping the member in the path", async () => {
    const imps = await collectImports(
      "src/main/java/com/fixture/Main.java",
      "import static com.fixture.server.Server.create;\n",
    );
    expect(imps).toEqual([{ source: "com.fixture.server.Server.create", kind: "java-import" }]);
  });

  it("extracts a wildcard import without the .* suffix", async () => {
    const imps = await collectImports(
      "src/main/java/com/fixture/Main.java",
      "import com.fixture.model.*;\n",
    );
    expect(imps).toEqual([{ source: "com.fixture.model", kind: "java-import" }]);
  });

  it("extracts several imports in order (java.* is recorded; resolution decides)", async () => {
    const imps = await collectImports(
      "src/main/java/com/fixture/Main.java",
      "import java.util.List;\nimport com.fixture.model.Item;\n",
    );
    expect(imps).toEqual([
      { source: "java.util.List", kind: "java-import" },
      { source: "com.fixture.model.Item", kind: "java-import" },
    ]);
  });
});

describe("imports.collectImports (edge cases)", () => {
  it("an unparseable file returns [] (graceful)", async () => {
    const imps = await collectImports("src/foo.ts", "this is not { valid ts");
    expect(imps).toEqual([]);
  });

  it("a file without imports returns []", async () => {
    const imps = await collectImports("src/foo.ts", "const x = 1;");
    expect(imps).toEqual([]);
  });
});