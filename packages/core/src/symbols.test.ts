import { describe, it, expect, beforeAll } from "vitest";
import { extractSymbols } from "./symbols.js";
import { parseSource, initParser } from "./parser.js";

beforeAll(async () => {
  await initParser();
});

async function parse(ext: string, src: string) {
  return parseSource(ext, src);
}

describe("symbols — TypeScript", () => {
  it("extrai function_declaration top-level", async () => {
    const tree = await parse(".ts", "function foo() { return 1; }");
    const symbols = extractSymbols(tree, "x.ts", "function foo() { return 1; }");
    expect(symbols.map((s) => s.name)).toEqual(["foo"]);
    expect(symbols[0]?.kind).toBe("function");
    expect(symbols[0]?.key).toBe("x.ts#foo");
    expect(symbols[0]?.start_line).toBe(1);
  });

  it("extrai class + methods com qualificação", async () => {
    const src = `class Foo {
  bar() { return 1; }
  baz() { return 2; }
}`;
    const tree = await parse(".ts", src);
    const symbols = extractSymbols(tree, "x.ts", src);
    const names = symbols.map((s) => s.name);
    expect(names).toContain("Foo");
    expect(names).toContain("Foo.bar");
    expect(names).toContain("Foo.baz");
    expect(symbols.find((s) => s.name === "Foo")?.kind).toBe("class");
    expect(symbols.find((s) => s.name === "Foo.bar")?.kind).toBe("method");
  });

  it("extrai generator_function_declaration", async () => {
    const src = "function* gen() { yield 1; }";
    const tree = await parse(".ts", src);
    const symbols = extractSymbols(tree, "x.ts", src);
    expect(symbols.map((s) => s.name)).toEqual(["gen"]);
    expect(symbols[0]?.kind).toBe("function");
  });

  it("extrai export class SEM duplicar (kind=class, não export)", async () => {
    const src = "export class Foo {}";
    const tree = await parse(".ts", src);
    const symbols = extractSymbols(tree, "x.ts", src);
    const fooSymbols = symbols.filter((s) => s.name === "Foo");
    expect(fooSymbols.length).toBe(1);
    expect(fooSymbols[0]?.kind).toBe("class");
  });

  it("extrai export function SEM duplicar (kind=function, não export)", async () => {
    const src = "export function bar() {}";
    const tree = await parse(".ts", src);
    const symbols = extractSymbols(tree, "x.ts", src);
    const barSymbols = symbols.filter((s) => s.name === "bar");
    expect(barSymbols.length).toBe(1);
    expect(barSymbols[0]?.kind).toBe("function");
  });

  it("extrai export const como kind=export", async () => {
    const src = "export const VERSION = '1.0';";
    const tree = await parse(".ts", src);
    const symbols = extractSymbols(tree, "x.ts", src);
    const v = symbols.find((s) => s.name === "VERSION");
    expect(v?.kind).toBe("export");
  });

  it("signature captura primeira linha do nó", async () => {
    const src = "function multiLine(\n  a: number,\n  b: string,\n): boolean { return true; }";
    const tree = await parse(".ts", src);
    const symbols = extractSymbols(tree, "x.ts", src);
    expect(symbols[0]?.signature).toContain("function multiLine");
  });

  it("content_hash reflete o slice do nó (muda se o corpo muda)", async () => {
    const src1 = "function foo() { return 1; }";
    const src2 = "function foo() { return 999; }"; // corpo diferente
    const tree1 = await parse(".ts", src1);
    const tree2 = await parse(".ts", src2);
    const s1 = extractSymbols(tree1, "x.ts", src1);
    const s2 = extractSymbols(tree2, "x.ts", src2);
    // Mesmo nome mas slice diferente → hash diferente
    expect(s1[0]?.content_hash).not.toBe(s2[0]?.content_hash);

    // Nomes diferentes → slice diferente → hash diferente
    const src3 = "function bar() { return 1; }";
    const tree3 = await parse(".ts", src3);
    const s3 = extractSymbols(tree3, "x.ts", src3);
    expect(s1[0]?.content_hash).not.toBe(s3[0]?.content_hash);
  });

  it("content_hash é determinístico (mesmo input → mesmo hash)", async () => {
    const src = "function foo() { return 1; }";
    const tree1 = await parse(".ts", src);
    const tree2 = await parse(".ts", src);
    const s1 = extractSymbols(tree1, "x.ts", src);
    const s2 = extractSymbols(tree2, "x.ts", src);
    expect(s1[0]?.content_hash).toBe(s2[0]?.content_hash);
  });

  it("coalesces same-named object methods while preserving qualified class methods", async () => {
    const src = `class First {
  generate() { return "class-first"; }
}
class Second {
  generate() { return "class-second"; }
}
const firstStub = {
  generate() { return "object-first"; },
};
const secondStub = {
  generate() { return "object-second"; },
};`;
    const tree = await parse(".ts", src);

    const symbols = extractSymbols(tree, "x.ts", src);

    expect(symbols.map((symbol) => symbol.key)).toEqual([
      "x.ts#First",
      "x.ts#First.generate",
      "x.ts#Second",
      "x.ts#Second.generate",
      "x.ts#generate",
    ]);
    expect(new Set(symbols.map((symbol) => symbol.key)).size).toBe(symbols.length);
    expect(symbols.find((symbol) => symbol.key === "x.ts#generate")).toMatchObject({
      kind: "method",
      start_line: 8,
    });
    expect(symbols.find((symbol) => symbol.key === "x.ts#generate")?.signature).toContain(
      "object-first",
    );
    expect(extractSymbols(tree, "x.ts", src)).toEqual(symbols);
  });

  it("keeps the lowest start byte when a function and method share a key and line", async () => {
    const src =
      'const stub = { generate() { return "method-first"; } }; function generate() { return "function-second"; }';
    const tree = await parse(".ts", src);

    const symbols = extractSymbols(tree, "x.ts", src);

    expect(symbols).toHaveLength(1);
    expect(symbols[0]).toMatchObject({ key: "x.ts#generate", kind: "method", start_line: 1 });
    expect(symbols[0]?.signature).toContain("method-first");
  });
});

describe("symbols — Python", () => {
  it("extrai function_definition", async () => {
    const src = "def greet(name):\n    return name";
    const tree = await parse(".py", src);
    const symbols = extractSymbols(tree, "x.py", src);
    expect(symbols.map((s) => s.name)).toEqual(["greet"]);
    expect(symbols[0]?.kind).toBe("function");
  });

  it("extrai class + methods qualificados", async () => {
    const src = `class Calculator:
    def add(self, a, b):
        return a + b
    def sub(self, a, b):
        return a - b`;
    const tree = await parse(".py", src);
    const symbols = extractSymbols(tree, "x.py", src);
    const names = symbols.map((s) => s.name);
    expect(names).toContain("Calculator");
    expect(names).toContain("Calculator.add");
    expect(names).toContain("Calculator.sub");
  });

  it("extrai decorated_definition (decorator Python)", async () => {
    const src = "@property\ndef name(self):\n    return self._name";
    const tree = await parse(".py", src);
    const symbols = extractSymbols(tree, "x.py", src);
    expect(symbols.map((s) => s.name)).toContain("name");
  });
});
