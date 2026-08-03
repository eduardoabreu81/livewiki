import { describe, it, expect, beforeAll } from "vitest";
import { extractSymbols, extractRationales, isLikelyGenerated } from "./symbols.js";
import { sha256, normalizeEol } from "./hashes.js";
import { parseSource, initParser } from "./parser.js";

beforeAll(async () => {
  await initParser();
});

async function parse(ext: string, src: string) {
  return parseSource(ext, src);
}

describe("symbols — EOL-insensitive hashing (roadmap item 12)", () => {
  it("content_hash do símbolo é igual para LF e CRLF (source normalizado)", async () => {
    // Mirrors the indexer contract: the file text is normalizeEol'd ONCE
    // before parse + extraction, so both line-ending variants yield the
    // same symbol keys, byte ranges, and content hashes.
    const lf = "export function foo() {\n  return 1;\n}\n";
    const crlf = lf.replace(/\n/g, "\r\n");
    const fromLf = extractSymbols(await parse(".ts", lf), "x.ts", lf);
    const fromCrlf = extractSymbols(
      await parse(".ts", normalizeEol(crlf)),
      "x.ts",
      normalizeEol(crlf),
    );
    expect(fromCrlf.map((s) => s.key)).toEqual(fromLf.map((s) => s.key));
    expect(fromCrlf.map((s) => s.content_hash)).toEqual(
      fromLf.map((s) => s.content_hash),
    );
  });
});

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

  it("NÃO extrai uma classe declarada dentro do corpo de uma função top-level", async () => {
    const src = `function makeFake() {
  class FakeThing {
    run() { return 1; }
  }
  return new FakeThing();
}`;
    const tree = await parse(".ts", src);
    const symbols = extractSymbols(tree, "x.ts", src);
    const names = symbols.map((s) => s.name);
    expect(names).toEqual(["makeFake"]);
    expect(names).not.toContain("FakeThing");
    expect(names).not.toContain("FakeThing.run");
  });

  it("NÃO extrai uma classe declarada dentro do corpo de um método", async () => {
    const src = `class TestSuite {
  testOllama() {
    class FakeClient {
      call() { return 1; }
    }
    return new FakeClient();
  }
}`;
    const tree = await parse(".ts", src);
    const symbols = extractSymbols(tree, "x.ts", src);
    const names = symbols.map((s) => s.name);
    expect(names).toEqual(["TestSuite", "TestSuite.testOllama"]);
    expect(names).not.toContain("FakeClient");
    expect(names).not.toContain("FakeClient.call");
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

  it("NÃO extrai uma classe declarada dentro do corpo de uma função top-level", async () => {
    const src = `def test_thing():
    class FakeCompletions:
        def create(self):
            return 1
    return FakeCompletions()`;
    const tree = await parse(".py", src);
    const symbols = extractSymbols(tree, "x.py", src);
    const names = symbols.map((s) => s.name);
    expect(names).toEqual(["test_thing"]);
    expect(names).not.toContain("FakeCompletions");
    expect(names).not.toContain("FakeCompletions.create");
  });

  it("NÃO extrai uma classe declarada dentro do corpo de um método de classe", async () => {
    const src = `class TestLLMProvider:
    def test_ollama(self):
        class FakeCompletions:
            def create(self):
                return 1
        return FakeCompletions()
    def test_qwen(self):
        class FakeCompletions:
            def create(self):
                return 2
        return FakeCompletions()`;
    const tree = await parse(".py", src);
    const symbols = extractSymbols(tree, "x.py", src);
    const names = symbols.map((s) => s.name);
    expect(names).toEqual(["TestLLMProvider", "TestLLMProvider.test_ollama", "TestLLMProvider.test_qwen"]);
    expect(names).not.toContain("FakeCompletions");
    expect(names).not.toContain("FakeCompletions.create");
  });

  it("ainda extrai uma classe top-level normalmente, mesmo com uma função top-level antes dela", async () => {
    const src = `def helper():
    return 1

class RealModel:
    def run(self):
        return 2`;
    const tree = await parse(".py", src);
    const symbols = extractSymbols(tree, "x.py", src);
    const names = symbols.map((s) => s.name);
    expect(names).toEqual(["helper", "RealModel", "RealModel.run"]);
  });
});

describe("symbols — Go (roadmap item 19)", () => {
  it("extrai function_declaration top-level", async () => {
    const src = "package main\n\nfunc greet(name string) string {\n\treturn name\n}\n";
    const tree = await parse(".go", src);
    const symbols = extractSymbols(tree, "x.go", src);
    expect(symbols.map((s) => s.name)).toEqual(["greet"]);
    expect(symbols[0]?.kind).toBe("function");
    expect(symbols[0]?.key).toBe("x.go#greet");
    expect(symbols[0]?.start_line).toBe(3);
  });

  it("extrai struct como kind=class", async () => {
    const src = "package server\n\ntype Server struct {\n\tPort int\n}\n";
    const tree = await parse(".go", src);
    const symbols = extractSymbols(tree, "x.go", src);
    expect(symbols.map((s) => s.name)).toEqual(["Server"]);
    expect(symbols[0]?.kind).toBe("class");
    expect(symbols[0]?.key).toBe("x.go#Server");
  });

  it("extrai interface como kind=interface", async () => {
    const src = "package server\n\ntype Runner interface {\n\tStart() error\n}\n";
    const tree = await parse(".go", src);
    const symbols = extractSymbols(tree, "x.go", src);
    expect(symbols.map((s) => s.name)).toEqual(["Runner"]);
    expect(symbols[0]?.kind).toBe("interface");
  });

  it("extrai type declaration agrupada (type ( ... )) com um símbolo por spec", async () => {
    const src = "package server\n\ntype (\n\tServer struct {\n\t\tPort int\n\t}\n\tRunner interface {\n\t\tStart() error\n\t}\n)\n";
    const tree = await parse(".go", src);
    const symbols = extractSymbols(tree, "x.go", src);
    expect(symbols.map((s) => [s.name, s.kind])).toEqual([
      ["Server", "class"],
      ["Runner", "interface"],
    ]);
  });

  it("ignora type alias para tipo não-struct/interface", async () => {
    const src = "package server\n\ntype Port = int\n";
    const tree = await parse(".go", src);
    const symbols = extractSymbols(tree, "x.go", src);
    expect(symbols).toEqual([]);
  });

  it("extrai método com receiver por valor qualificado Type.method", async () => {
    const src = "package server\n\nfunc (s Server) Start() error {\n\treturn nil\n}\n";
    const tree = await parse(".go", src);
    const symbols = extractSymbols(tree, "x.go", src);
    expect(symbols.map((s) => s.name)).toEqual(["Server.Start"]);
    expect(symbols[0]?.kind).toBe("method");
    expect(symbols[0]?.key).toBe("x.go#Server.Start");
  });

  it("extrai método com receiver ponteiro — *T colapsa para a mesma chave T.method", async () => {
    const src = "package server\n\nfunc (s *Server) Addr() string {\n\treturn \"\"\n}\n";
    const tree = await parse(".go", src);
    const symbols = extractSymbols(tree, "x.go", src);
    expect(symbols.map((s) => s.name)).toEqual(["Server.Addr"]);
    expect(symbols[0]?.kind).toBe("method");
  });

  it("receiver por valor e por ponteiro do mesmo método NÃO duplicam a chave", async () => {
    // Go forbids both, but the extractor must be robust on invalid input.
    const src = "package server\n\nfunc (s Server) Start() error {\n\treturn nil\n}\n\nfunc (s *Server) Start() error {\n\treturn nil\n}\n";
    const tree = await parse(".go", src);
    const symbols = extractSymbols(tree, "x.go", src);
    expect(symbols.filter((s) => s.key === "x.go#Server.Start")).toHaveLength(1);
  });

  it("NÃO extrai type declaration local dentro de função", async () => {
    const src = "package main\n\nfunc run() {\n\ttype local struct {\n\t\tx int\n\t}\n\t_ = local{}\n}\n";
    const tree = await parse(".go", src);
    const symbols = extractSymbols(tree, "x.go", src);
    expect(symbols.map((s) => s.name)).toEqual(["run"]);
  });
});

// === Etapa 2b: rationale extraction (intent evidence) ===

describe("extractRationales — tagged comments", () => {
  it("captures all five tags, case-insensitive, with kind = lowercased tag", async () => {
    const src = `// WHY: retries are bounded to avoid hammering the upstream API
// note: lower case tag prefix also counts as a tagged comment
// HACK: temporary workaround for an upstream parsing bug
// TODO: replace this with a streaming parser eventually
// FIXME: off-by-one when the last chunk is empty
export function f() { return 1; }
`;
    const tree = await parse(".ts", src);
    const rationales = extractRationales(tree, "x.ts", src);
    expect(rationales.map((r) => r.kind)).toEqual(["why", "note", "hack", "todo", "fixme"]);
    // The contiguous block ends immediately above the declaration.
    for (const r of rationales) {
      expect(r.symbol_key).toBe("x.ts#f");
    }
  });

  it("matches the tag prefix case-insensitively", async () => {
    const src = `// wHy: mixed case tag still counts as intent evidence
export function f() { return 1; }
`;
    const tree = await parse(".ts", src);
    const rationales = extractRationales(tree, "x.ts", src);
    expect(rationales).toHaveLength(1);
    expect(rationales[0]?.kind).toBe("why");
  });

  it("ignores untagged comments", async () => {
    const src = `// just a regular explanatory comment, no tag at all
export function f() { return 1; }
`;
    const tree = await parse(".ts", src);
    expect(extractRationales(tree, "x.ts", src)).toEqual([]);
  });

  it("stores content_hash as the sha256 of the normalized text", async () => {
    const src = `// TODO: normalize the whitespace   and    markers
export function f() { return 1; }
`;
    const tree = await parse(".ts", src);
    const rationales = extractRationales(tree, "x.ts", src);
    expect(rationales).toHaveLength(1);
    expect(rationales[0]?.text).toBe("TODO: normalize the whitespace and markers");
    expect(rationales[0]?.content_hash).toBe(sha256("TODO: normalize the whitespace and markers"));
  });
});

describe("extractRationales — docstrings", () => {
  it("rejects docstrings shorter than 20 normalized chars", async () => {
    const src = `/** Short. */
export function f() { return 1; }
`;
    const tree = await parse(".ts", src);
    expect(extractRationales(tree, "x.ts", src)).toEqual([]);
  });

  it("captures a /** docstring but not a plain /* block comment", async () => {
    const src = `/**
 * Computes the retry backoff for the next attempt.
 */
export function f() { return 1; }

/* A plain block comment that is long enough but is not a docstring. */
export function g() { return 2; }
`;
    const tree = await parse(".ts", src);
    const rationales = extractRationales(tree, "x.ts", src);
    expect(rationales).toHaveLength(1);
    expect(rationales[0]?.kind).toBe("docstring");
    expect(rationales[0]?.symbol_key).toBe("x.ts#f");
    expect(rationales[0]?.text).toBe("Computes the retry backoff for the next attempt.");
  });

  it("captures Python module, class, and function docstrings with positional attribution", async () => {
    const src = `"""Module docstring explaining the intent of this whole file."""

CONST = 1

class Worker:
    """Class docstring describing the worker role in the pipeline."""

    def run(self):
        """Function docstring describing why run loops until drained."""
        return 1
`;
    const tree = await parse(".py", src);
    const rationales = extractRationales(tree, "x.py", src);
    expect(rationales).toHaveLength(3);
    const byText = new Map(rationales.map((r) => [r.text, r]));
    expect(byText.get("Module docstring explaining the intent of this whole file.")?.symbol_key).toBeNull();
    expect(byText.get("Class docstring describing the worker role in the pipeline.")?.symbol_key).toBe("x.py#Worker");
    expect(byText.get("Function docstring describing why run loops until drained.")?.symbol_key).toBe("x.py#Worker.run");
    expect(rationales.every((r) => r.kind === "docstring")).toBe(true);
  });

  it("captures a Python tagged comment inside a function body", async () => {
    const src = `def drain():
    # TODO: handle the empty queue case explicitly here
    return 1
`;
    const tree = await parse(".py", src);
    const rationales = extractRationales(tree, "x.py", src);
    expect(rationales).toHaveLength(1);
    expect(rationales[0]?.kind).toBe("todo");
    expect(rationales[0]?.symbol_key).toBe("x.py#drain");
  });
});

describe("extractRationales — attribution rule", () => {
  it("attaches a comment inside a symbol's line range to that symbol", async () => {
    const src = `export function f() {
  // WHY: we clamp the value to avoid overflow downstream
  return 1;
}
`;
    const tree = await parse(".ts", src);
    const rationales = extractRationales(tree, "x.ts", src);
    expect(rationales).toHaveLength(1);
    expect(rationales[0]?.symbol_key).toBe("x.ts#f");
  });

  it("attaches a comment inside a method to the method, not the class", async () => {
    const src = `class Foo {
  bar() {
    // HACK: the innermost container wins over the outer class
    return 1;
  }
}
`;
    const tree = await parse(".ts", src);
    const rationales = extractRationales(tree, "x.ts", src);
    expect(rationales).toHaveLength(1);
    expect(rationales[0]?.symbol_key).toBe("x.ts#Foo.bar");
  });

  it("attaches a contiguous comment block ending immediately above the declaration", async () => {
    const src = `// WHY: first line of the leading block
// NOTE: second line, still no blank line between block and declaration
export function f() { return 1; }
`;
    const tree = await parse(".ts", src);
    const rationales = extractRationales(tree, "x.ts", src);
    expect(rationales).toHaveLength(2);
    expect(rationales.every((r) => r.symbol_key === "x.ts#f")).toBe(true);
  });

  it("leaves a comment file-level when a blank line separates it from the declaration", async () => {
    const src = `// WHY: separated from the declaration by a blank line below

export function f() { return 1; }
`;
    const tree = await parse(".ts", src);
    const rationales = extractRationales(tree, "x.ts", src);
    expect(rationales).toHaveLength(1);
    expect(rationales[0]?.symbol_key).toBeNull();
  });

  it("leaves a trailing file-level comment unattached", async () => {
    const src = `export function f() { return 1; }

// WHY: explains the file as a whole, not one symbol
`;
    const tree = await parse(".ts", src);
    const rationales = extractRationales(tree, "x.ts", src);
    expect(rationales).toHaveLength(1);
    expect(rationales[0]?.symbol_key).toBeNull();
  });
});

describe("isLikelyGenerated", () => {
  it("detects generated-code header markers in the first 8 lines", () => {
    expect(isLikelyGenerated("// Code generated by protoc. DO NOT EDIT.\npackage foo;\n")).toBe(true);
    expect(isLikelyGenerated("/**\n * @generated by tool\n */\nexport const x = 1;\n")).toBe(true);
    expect(isLikelyGenerated("# AUTO-GENERATED FILE\nx = 1\n")).toBe(true);
    expect(isLikelyGenerated("// This file is auto-generated — do not hand edit\nexport const x = 1;\n")).toBe(true);
  });

  it("does not flag a normal source file", () => {
    expect(isLikelyGenerated("// WHY: hand-written intent comment\nexport function f() { return 1; }\n")).toBe(false);
  });

  it("only sniffs the first 8 lines", () => {
    const lines = Array.from({ length: 9 }, (_, i) => `// filler line ${i + 1}`);
    lines.push("// DO NOT EDIT — but too deep to count");
    expect(isLikelyGenerated(lines.join("\n") + "\n")).toBe(false);
  });
});
