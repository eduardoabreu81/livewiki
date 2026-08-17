import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as nodePath from "node:path";
import * as nodeOs from "node:os";
import * as nodeFs from "node:fs/promises";
import { parseSource, initParser, listSupportedGrammars, grammarForExtension } from "./parser.js";

beforeEach(async () => {
  await initParser();
});

describe("parser", () => {
  it("listSupportedGrammars lists the available .wasm files", () => {
    const grammars = listSupportedGrammars();
    expect(grammars.length).toBeGreaterThanOrEqual(6);
    expect(grammars).toContain("typescript");
    expect(grammars).toContain("tsx");
    expect(grammars).toContain("javascript");
    expect(grammars).toContain("python");
    expect(grammars).toContain("go");
    expect(grammars).toContain("rust");
    expect(grammars).toContain("java");
  });

  it("grammarForExtension returns the grammar name", () => {
    expect(grammarForExtension(".ts")).toBe("typescript");
    expect(grammarForExtension(".PY")).toBe("python"); // case insensitive
    expect(grammarForExtension(".go")).toBe("go");
    expect(grammarForExtension(".rs")).toBe("rust");
    expect(grammarForExtension(".java")).toBe("java");
    expect(grammarForExtension(".xyz")).toBeUndefined();
  });

  it("parseSource parses TS and exposes the AST", async () => {
    const tree = await parseSource(".ts", "const x: number = 42;");
    expect(tree.rootNode.type).toBe("program");
  });

  it("parseSource parses Python and recognizes function_definition", async () => {
    const tree = await parseSource(".py", "def greet(name): return name");
    const fns = tree.rootNode.descendantsOfType("function_definition");
    expect(fns.length).toBe(1);
  });

  it("parseSource parses Go and recognizes function_declaration + method_declaration", async () => {
    const tree = await parseSource(
      ".go",
      "package main\n\nfunc main() {}\n\nfunc (s *Server) Start() {}\n",
    );
    expect(tree.rootNode.type).toBe("source_file");
    expect(tree.rootNode.descendantsOfType("function_declaration").length).toBe(1);
    expect(tree.rootNode.descendantsOfType("method_declaration").length).toBe(1);
  });

  it("parseSource parses Rust and recognizes function_item + impl_item + trait_item", async () => {
    const tree = await parseSource(
      ".rs",
      "fn main() {}\n\nstruct Server;\n\nimpl Server {\n    fn start(&self) {}\n}\n\ntrait Runner {\n    fn run(&self);\n}\n",
    );
    expect(tree.rootNode.type).toBe("source_file");
    expect(tree.rootNode.descendantsOfType("function_item").length).toBe(2);
    expect(tree.rootNode.descendantsOfType("impl_item").length).toBe(1);
    expect(tree.rootNode.descendantsOfType("trait_item").length).toBe(1);
  });

  it("parseSource parses Java and recognizes class/interface/method/constructor declarations", async () => {
    const tree = await parseSource(
      ".java",
      "interface Handler {\n    void handle();\n}\n\nclass Server implements Handler {\n    Server(int port) {}\n    public void handle() {}\n    void start() {}\n}\n",
    );
    expect(tree.rootNode.type).toBe("program");
    expect(tree.rootNode.descendantsOfType("class_declaration").length).toBe(1);
    expect(tree.rootNode.descendantsOfType("interface_declaration").length).toBe(1);
    expect(tree.rootNode.descendantsOfType("method_declaration").length).toBe(3);
    expect(tree.rootNode.descendantsOfType("constructor_declaration").length).toBe(1);
  });

  it("parseSource throws error for extension without grammar", async () => {
    await expect(parseSource(".xyz", "...")).rejects.toThrow(/No tree-sitter grammar/);
  });
});