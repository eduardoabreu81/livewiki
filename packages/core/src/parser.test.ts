import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as nodePath from "node:path";
import * as nodeOs from "node:os";
import * as nodeFs from "node:fs/promises";
import { parseSource, initParser, listSupportedGrammars, grammarForExtension } from "./parser.js";

beforeEach(async () => {
  await initParser();
});

describe("parser", () => {
  it("listSupportedGrammars lista os .wasm disponíveis", () => {
    const grammars = listSupportedGrammars();
    expect(grammars.length).toBeGreaterThanOrEqual(5);
    expect(grammars).toContain("typescript");
    expect(grammars).toContain("tsx");
    expect(grammars).toContain("javascript");
    expect(grammars).toContain("python");
    expect(grammars).toContain("go");
  });

  it("grammarForExtension retorna o nome da gramática", () => {
    expect(grammarForExtension(".ts")).toBe("typescript");
    expect(grammarForExtension(".PY")).toBe("python"); // case insensitive
    expect(grammarForExtension(".go")).toBe("go");
    expect(grammarForExtension(".xyz")).toBeUndefined();
  });

  it("parseSource parseia TS e expõe AST", async () => {
    const tree = await parseSource(".ts", "const x: number = 42;");
    expect(tree.rootNode.type).toBe("program");
  });

  it("parseSource parseia Python e reconhece function_definition", async () => {
    const tree = await parseSource(".py", "def greet(name): return name");
    const fns = tree.rootNode.descendantsOfType("function_definition");
    expect(fns.length).toBe(1);
  });

  it("parseSource parseia Go e reconhece function_declaration + method_declaration", async () => {
    const tree = await parseSource(
      ".go",
      "package main\n\nfunc main() {}\n\nfunc (s *Server) Start() {}\n",
    );
    expect(tree.rootNode.type).toBe("source_file");
    expect(tree.rootNode.descendantsOfType("function_declaration").length).toBe(1);
    expect(tree.rootNode.descendantsOfType("method_declaration").length).toBe(1);
  });

  it("parseSource lança erro para extensão sem gramática", async () => {
    await expect(parseSource(".xyz", "...")).rejects.toThrow(/Sem gramática/);
  });
});