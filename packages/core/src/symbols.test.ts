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
  it("symbol content_hash is the same for LF and CRLF (normalized source)", async () => {
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
  it("extracts top-level function_declaration", async () => {
    const tree = await parse(".ts", "function foo() { return 1; }");
    const symbols = extractSymbols(tree, "x.ts", "function foo() { return 1; }");
    expect(symbols.map((s) => s.name)).toEqual(["foo"]);
    expect(symbols[0]?.kind).toBe("function");
    expect(symbols[0]?.key).toBe("x.ts#foo");
    expect(symbols[0]?.start_line).toBe(1);
  });

  it("extracts class + methods with qualification", async () => {
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

  it("does NOT extract a class declared inside the body of a top-level function", async () => {
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

  it("does NOT extract a class declared inside the body of a method", async () => {
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

  it("extracts generator_function_declaration", async () => {
    const src = "function* gen() { yield 1; }";
    const tree = await parse(".ts", src);
    const symbols = extractSymbols(tree, "x.ts", src);
    expect(symbols.map((s) => s.name)).toEqual(["gen"]);
    expect(symbols[0]?.kind).toBe("function");
  });

  it("extracts export class WITHOUT duplicating (kind=class, not export)", async () => {
    const src = "export class Foo {}";
    const tree = await parse(".ts", src);
    const symbols = extractSymbols(tree, "x.ts", src);
    const fooSymbols = symbols.filter((s) => s.name === "Foo");
    expect(fooSymbols.length).toBe(1);
    expect(fooSymbols[0]?.kind).toBe("class");
  });

  it("extracts export function WITHOUT duplicating (kind=function, not export)", async () => {
    const src = "export function bar() {}";
    const tree = await parse(".ts", src);
    const symbols = extractSymbols(tree, "x.ts", src);
    const barSymbols = symbols.filter((s) => s.name === "bar");
    expect(barSymbols.length).toBe(1);
    expect(barSymbols[0]?.kind).toBe("function");
  });

  it("extracts export const as kind=export", async () => {
    const src = "export const VERSION = '1.0';";
    const tree = await parse(".ts", src);
    const symbols = extractSymbols(tree, "x.ts", src);
    const v = symbols.find((s) => s.name === "VERSION");
    expect(v?.kind).toBe("export");
  });

  it("signature captures the first line of the node", async () => {
    const src = "function multiLine(\n  a: number,\n  b: string,\n): boolean { return true; }";
    const tree = await parse(".ts", src);
    const symbols = extractSymbols(tree, "x.ts", src);
    expect(symbols[0]?.signature).toContain("function multiLine");
  });

  it("content_hash reflects the node slice (changes if the body changes)", async () => {
    const src1 = "function foo() { return 1; }";
    const src2 = "function foo() { return 999; }"; // different body
    const tree1 = await parse(".ts", src1);
    const tree2 = await parse(".ts", src2);
    const s1 = extractSymbols(tree1, "x.ts", src1);
    const s2 = extractSymbols(tree2, "x.ts", src2);
    // Same name but different slice → different hash
    expect(s1[0]?.content_hash).not.toBe(s2[0]?.content_hash);

    // Different names → different slice → different hash
    const src3 = "function bar() { return 1; }";
    const tree3 = await parse(".ts", src3);
    const s3 = extractSymbols(tree3, "x.ts", src3);
    expect(s1[0]?.content_hash).not.toBe(s3[0]?.content_hash);
  });

  it("content_hash is deterministic (same input → same hash)", async () => {
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
  it("extracts function_definition", async () => {
    const src = "def greet(name):\n    return name";
    const tree = await parse(".py", src);
    const symbols = extractSymbols(tree, "x.py", src);
    expect(symbols.map((s) => s.name)).toEqual(["greet"]);
    expect(symbols[0]?.kind).toBe("function");
  });

  it("extracts class + qualified methods", async () => {
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

  it("extracts decorated_definition (Python decorator)", async () => {
    const src = "@property\ndef name(self):\n    return self._name";
    const tree = await parse(".py", src);
    const symbols = extractSymbols(tree, "x.py", src);
    expect(symbols.map((s) => s.name)).toContain("name");
  });

  it("does NOT extract a class declared inside the body of a top-level function", async () => {
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

  it("does NOT extract a class declared inside the body of a class method", async () => {
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

  it("still extracts a top-level class normally, even with a top-level function before it", async () => {
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
  it("extracts top-level function_declaration", async () => {
    const src = "package main\n\nfunc greet(name string) string {\n\treturn name\n}\n";
    const tree = await parse(".go", src);
    const symbols = extractSymbols(tree, "x.go", src);
    expect(symbols.map((s) => s.name)).toEqual(["greet"]);
    expect(symbols[0]?.kind).toBe("function");
    expect(symbols[0]?.key).toBe("x.go#greet");
    expect(symbols[0]?.start_line).toBe(3);
  });

  it("extracts struct as kind=class", async () => {
    const src = "package server\n\ntype Server struct {\n\tPort int\n}\n";
    const tree = await parse(".go", src);
    const symbols = extractSymbols(tree, "x.go", src);
    expect(symbols.map((s) => s.name)).toEqual(["Server"]);
    expect(symbols[0]?.kind).toBe("class");
    expect(symbols[0]?.key).toBe("x.go#Server");
  });

  it("extracts interface as kind=interface", async () => {
    const src = "package server\n\ntype Runner interface {\n\tStart() error\n}\n";
    const tree = await parse(".go", src);
    const symbols = extractSymbols(tree, "x.go", src);
    expect(symbols.map((s) => s.name)).toEqual(["Runner"]);
    expect(symbols[0]?.kind).toBe("interface");
  });

  it("extracts grouped type declaration (type ( ... )) with one symbol per spec", async () => {
    const src = "package server\n\ntype (\n\tServer struct {\n\t\tPort int\n\t}\n\tRunner interface {\n\t\tStart() error\n\t}\n)\n";
    const tree = await parse(".go", src);
    const symbols = extractSymbols(tree, "x.go", src);
    expect(symbols.map((s) => [s.name, s.kind])).toEqual([
      ["Server", "class"],
      ["Runner", "interface"],
    ]);
  });

  it("ignores type alias to a non-struct/interface type", async () => {
    const src = "package server\n\ntype Port = int\n";
    const tree = await parse(".go", src);
    const symbols = extractSymbols(tree, "x.go", src);
    expect(symbols).toEqual([]);
  });

  it("extracts method with value receiver qualified as Type.method", async () => {
    const src = "package server\n\nfunc (s Server) Start() error {\n\treturn nil\n}\n";
    const tree = await parse(".go", src);
    const symbols = extractSymbols(tree, "x.go", src);
    expect(symbols.map((s) => s.name)).toEqual(["Server.Start"]);
    expect(symbols[0]?.kind).toBe("method");
    expect(symbols[0]?.key).toBe("x.go#Server.Start");
  });

  it("extracts method with pointer receiver — *T collapses to the same key T.method", async () => {
    const src = "package server\n\nfunc (s *Server) Addr() string {\n\treturn \"\"\n}\n";
    const tree = await parse(".go", src);
    const symbols = extractSymbols(tree, "x.go", src);
    expect(symbols.map((s) => s.name)).toEqual(["Server.Addr"]);
    expect(symbols[0]?.kind).toBe("method");
  });

  it("value and pointer receivers of the same method do NOT duplicate the key", async () => {
    // Go forbids both, but the extractor must be robust on invalid input.
    const src = "package server\n\nfunc (s Server) Start() error {\n\treturn nil\n}\n\nfunc (s *Server) Start() error {\n\treturn nil\n}\n";
    const tree = await parse(".go", src);
    const symbols = extractSymbols(tree, "x.go", src);
    expect(symbols.filter((s) => s.key === "x.go#Server.Start")).toHaveLength(1);
  });

  it("does NOT extract a local type declaration inside a function", async () => {
    const src = "package main\n\nfunc run() {\n\ttype local struct {\n\t\tx int\n\t}\n\t_ = local{}\n}\n";
    const tree = await parse(".go", src);
    const symbols = extractSymbols(tree, "x.go", src);
    expect(symbols.map((s) => s.name)).toEqual(["run"]);
  });
});

describe("symbols — Rust (roadmap item 20)", () => {
  it("extracts top-level function_item", async () => {
    const src = "fn greet(name: &str) -> &str {\n    name\n}\n";
    const tree = await parse(".rs", src);
    const symbols = extractSymbols(tree, "x.rs", src);
    expect(symbols.map((s) => s.name)).toEqual(["greet"]);
    expect(symbols[0]?.kind).toBe("function");
    expect(symbols[0]?.key).toBe("x.rs#greet");
    expect(symbols[0]?.start_line).toBe(1);
  });

  it("extracts struct as kind=class", async () => {
    const src = "pub struct Server {\n    port: u16,\n}\n";
    const tree = await parse(".rs", src);
    const symbols = extractSymbols(tree, "x.rs", src);
    expect(symbols.map((s) => s.name)).toEqual(["Server"]);
    expect(symbols[0]?.kind).toBe("class");
    expect(symbols[0]?.key).toBe("x.rs#Server");
  });

  it("extracts enum as kind=class", async () => {
    const src = "pub enum Mode {\n    Fast,\n    Slow,\n}\n";
    const tree = await parse(".rs", src);
    const symbols = extractSymbols(tree, "x.rs", src);
    expect(symbols.map((s) => s.name)).toEqual(["Mode"]);
    expect(symbols[0]?.kind).toBe("class");
  });

  it("extracts trait as kind=interface and does NOT extract its signatures", async () => {
    const src = "pub trait Runner {\n    fn start(&self) -> Result<(), String>;\n    fn stop(&self) {}\n}\n";
    const tree = await parse(".rs", src);
    const symbols = extractSymbols(tree, "x.rs", src);
    expect(symbols.map((s) => s.name)).toEqual(["Runner"]);
    expect(symbols[0]?.kind).toBe("interface");
    expect(symbols[0]?.key).toBe("x.rs#Runner");
  });

  it("extracts impl block methods qualified as Type.method", async () => {
    const src = "struct Server;\n\nimpl Server {\n    pub fn new() -> Self {\n        Server\n    }\n\n    fn addr(&self) -> String {\n        String::new()\n    }\n}\n";
    const tree = await parse(".rs", src);
    const symbols = extractSymbols(tree, "x.rs", src);
    expect(symbols.map((s) => [s.name, s.kind])).toEqual([
      ["Server", "class"],
      ["Server.new", "method"],
      ["Server.addr", "method"],
    ]);
    expect(symbols[1]?.key).toBe("x.rs#Server.new");
  });

  it("impl Trait for T qualifies the members under T (decision: they are callable on T)", async () => {
    const src = "struct Server;\n\ntrait Runner {\n    fn start(&self);\n}\n\nimpl Runner for Server {\n    fn start(&self) {}\n}\n";
    const tree = await parse(".rs", src);
    const symbols = extractSymbols(tree, "x.rs", src);
    const start = symbols.filter((s) => s.key === "x.rs#Server.start");
    expect(start).toHaveLength(1);
    expect(start[0]?.kind).toBe("method");
  });

  it("impl of a generic type uses the base type (impl<T> Vec<T> → Vec.push)", async () => {
    const src = "struct Vec<T> {\n    items: std::vec::Vec<T>,\n}\n\nimpl<T> Vec<T> {\n    fn push(&mut self, v: T) {\n        self.items.push(v);\n    }\n}\n";
    const tree = await parse(".rs", src);
    const symbols = extractSymbols(tree, "x.rs", src);
    expect(symbols.map((s) => s.name)).toEqual(["Vec", "Vec.push"]);
  });

  it("impl of a path type (impl a::B) uses the rightmost name", async () => {
    const src = "impl a::B {\n    fn m(&self) {}\n}\n";
    const tree = await parse(".rs", src);
    const symbols = extractSymbols(tree, "x.rs", src);
    expect(symbols.map((s) => s.name)).toEqual(["B.m"]);
  });

  it("does NOT extract local struct/trait/enum/impl inside a function", async () => {
    const src = "fn run() {\n    struct Local {\n        x: u32,\n    }\n    let _ = Local { x: 1 };\n}\n";
    const tree = await parse(".rs", src);
    const symbols = extractSymbols(tree, "x.rs", src);
    expect(symbols.map((s) => s.name)).toEqual(["run"]);
  });

  it("extracts nested fn with a simple key (same policy as TS)", async () => {
    const src = "fn outer() {\n    fn inner() {}\n    inner();\n}\n";
    const tree = await parse(".rs", src);
    const symbols = extractSymbols(tree, "x.rs", src);
    expect(symbols.map((s) => s.name)).toEqual(["outer", "inner"]);
  });
});

describe("symbols — Java (roadmap item 21)", () => {
  it("extracts class_declaration as kind=class", async () => {
    const src = "public class Server {\n    private int port;\n}\n";
    const tree = await parse(".java", src);
    const symbols = extractSymbols(tree, "x.java", src);
    expect(symbols.map((s) => s.name)).toEqual(["Server"]);
    expect(symbols[0]?.kind).toBe("class");
    expect(symbols[0]?.key).toBe("x.java#Server");
  });

  it("extracts methods and constructor qualified as Type.name / Type.Type", async () => {
    const src =
      "class Server {\n" +
      "    Server(int port) {}\n" +
      "    public void start() {}\n" +
      "    String addr() { return \":\" + 1; }\n" +
      "}\n";
    const tree = await parse(".java", src);
    const symbols = extractSymbols(tree, "x.java", src);
    expect(symbols.map((s) => [s.name, s.kind])).toEqual([
      ["Server", "class"],
      ["Server.Server", "method"],
      ["Server.start", "method"],
      ["Server.addr", "method"],
    ]);
    expect(symbols[1]?.key).toBe("x.java#Server.Server");
  });

  it("extracts interface_declaration as kind=interface and extracts its signatures (delta vs Go/Rust)", async () => {
    const src =
      "interface Handler {\n" +
      "    void handle(String item);\n" +
      "    default void close() {}\n" +
      "}\n";
    const tree = await parse(".java", src);
    const symbols = extractSymbols(tree, "x.java", src);
    expect(symbols.map((s) => [s.name, s.kind])).toEqual([
      ["Handler", "interface"],
      ["Handler.handle", "method"],
      ["Handler.close", "method"],
    ]);
    expect(symbols[0]?.key).toBe("x.java#Handler");
  });

  it("extracts enum_declaration as kind=class (mirrors the Rust decision)", async () => {
    const src = "enum Mode {\n    FAST,\n    SLOW\n}\n";
    const tree = await parse(".java", src);
    const symbols = extractSymbols(tree, "x.java", src);
    expect(symbols.map((s) => s.name)).toEqual(["Mode"]);
    expect(symbols[0]?.kind).toBe("class");
  });

  it("extracts record_declaration as kind=class and qualified members", async () => {
    const src =
      "record Item(String name, int qty) {\n" +
      "    public String describe() { return name; }\n" +
      "}\n";
    const tree = await parse(".java", src);
    const symbols = extractSymbols(tree, "x.java", src);
    expect(symbols.map((s) => [s.name, s.kind])).toEqual([
      ["Item", "class"],
      ["Item.describe", "method"],
    ]);
  });

  it("nested type uses the INNERMOST type as the qualifier", async () => {
    const src =
      "class Outer {\n" +
      "    void outerMethod() {}\n" +
      "    static class Inner {\n" +
      "        void innerMethod() {}\n" +
      "    }\n" +
      "}\n";
    const tree = await parse(".java", src);
    const symbols = extractSymbols(tree, "x.java", src);
    expect(symbols.map((s) => [s.name, s.kind])).toEqual([
      ["Outer", "class"],
      ["Outer.outerMethod", "method"],
      ["Inner", "class"],
      ["Inner.innerMethod", "method"],
    ]);
  });

  it("enum with a method body qualifies the members under the enum", async () => {
    const src =
      "enum Mode {\n" +
      "    FAST,\n" +
      "    SLOW;\n" +
      "    public String label() { return name(); }\n" +
      "}\n";
    const tree = await parse(".java", src);
    const symbols = extractSymbols(tree, "x.java", src);
    expect(symbols.map((s) => s.name)).toEqual(["Mode", "Mode.label"]);
  });

  it("does NOT extract a local class inside a method", async () => {
    const src =
      "class Server {\n" +
      "    void run() {\n" +
      "        class Local {\n" +
      "            void work() {}\n" +
      "        }\n" +
      "    }\n" +
      "}\n";
    const tree = await parse(".java", src);
    const symbols = extractSymbols(tree, "x.java", src);
    expect(symbols.map((s) => s.name)).toEqual(["Server", "Server.run"]);
  });

  it("collision guard: TS interface/enum are NOT extracted (the case is Java-only)", async () => {
    const src = "interface Handler {\n    handle(): void;\n}\n\nenum Mode {\n    Fast,\n    Slow,\n}\n";
    const tree = await parse(".ts", src);
    const symbols = extractSymbols(tree, "x.ts", src);
    expect(symbols).toEqual([]);
  });
});

// === Step 2b: rationale extraction (intent evidence) ===

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

describe("extractRationales — Rust (roadmap item 20)", () => {
  it("captures a /// doc comment as docstring with positional attribution", async () => {
    const src = `/// Server accepts inbound requests and dispatches them to handlers.
pub struct Server {
    port: u16,
}
`;
    const tree = await parse(".rs", src);
    const rationales = extractRationales(tree, "x.rs", src);
    expect(rationales).toHaveLength(1);
    expect(rationales[0]?.kind).toBe("docstring");
    expect(rationales[0]?.symbol_key).toBe("x.rs#Server");
    expect(rationales[0]?.text).toBe(
      "Server accepts inbound requests and dispatches them to handlers.",
    );
  });

  it("captures a //! inner doc comment as file-level docstring", async () => {
    const src = `//! Binary entry point for the fixture service.

fn main() {}
`;
    const tree = await parse(".rs", src);
    const rationales = extractRationales(tree, "x.rs", src);
    expect(rationales).toHaveLength(1);
    expect(rationales[0]?.kind).toBe("docstring");
    expect(rationales[0]?.symbol_key).toBeNull();
  });

  it("rejects a /// doc comment shorter than 20 normalized chars", async () => {
    const src = `/// Short.
fn f() {}
`;
    const tree = await parse(".rs", src);
    expect(extractRationales(tree, "x.rs", src)).toEqual([]);
  });

  it("does NOT treat //// as a doc comment (plain comment by convention)", async () => {
    const src = `//// A long divider-style comment that would pass the length floor.
fn f() {}
`;
    const tree = await parse(".rs", src);
    expect(extractRationales(tree, "x.rs", src)).toEqual([]);
  });

  it("captures a tagged // comment inside a method body (line_comment nodes)", async () => {
    const src = `struct Server;

impl Server {
    pub fn handle(&self) {
        // HACK: the dispatch ignores backpressure until the queue lands
        self.dispatch();
    }
}
`;
    const tree = await parse(".rs", src);
    const rationales = extractRationales(tree, "x.rs", src);
    expect(rationales).toHaveLength(1);
    expect(rationales[0]?.kind).toBe("hack");
    expect(rationales[0]?.symbol_key).toBe("x.rs#Server.handle");
  });

  it("captures a /** block doc comment (shared with the TS branch)", async () => {
    const src = `/** Computes the retry backoff for the next attempt. */
fn backoff() {}
`;
    const tree = await parse(".rs", src);
    const rationales = extractRationales(tree, "x.rs", src);
    expect(rationales).toHaveLength(1);
    expect(rationales[0]?.kind).toBe("docstring");
    expect(rationales[0]?.symbol_key).toBe("x.rs#backoff");
  });
});

describe("extractRationales — Java (roadmap item 21)", () => {
  it("captures Javadoc above a class as docstring with positional attribution", async () => {
    const src = `/**
 * Server accepts inbound items and dispatches them to the handler.
 */
public class Server {
    private int port;
}
`;
    const tree = await parse(".java", src);
    const rationales = extractRationales(tree, "x.java", src);
    expect(rationales).toHaveLength(1);
    expect(rationales[0]?.kind).toBe("docstring");
    expect(rationales[0]?.symbol_key).toBe("x.java#Server");
    expect(rationales[0]?.text).toBe(
      "Server accepts inbound items and dispatches them to the handler.",
    );
  });

  it("Javadoc above a method attributes to the enclosing class (rule 1: inside the class range — the pinned cross-language contract, same as TS)", async () => {
    const src = `class Server {
    /**
     * Creates a server bound to the given port.
     */
    Server(int port) {}
}
`;
    const tree = await parse(".java", src);
    const rationales = extractRationales(tree, "x.java", src);
    expect(rationales).toHaveLength(1);
    expect(rationales[0]?.kind).toBe("docstring");
    expect(rationales[0]?.symbol_key).toBe("x.java#Server");
  });

  it("rejects Javadoc shorter than 20 normalized chars", async () => {
    const src = `/** Short. */
class A {}
`;
    const tree = await parse(".java", src);
    expect(extractRationales(tree, "x.java", src)).toEqual([]);
  });

  it("captures a tagged // comment inside a method body (line_comment nodes)", async () => {
    const src = `class Server {
    void handle() {
        // HACK: the dispatch ignores backpressure until the queue lands
        dispatch();
    }
}
`;
    const tree = await parse(".java", src);
    const rationales = extractRationales(tree, "x.java", src);
    expect(rationales).toHaveLength(1);
    expect(rationales[0]?.kind).toBe("hack");
    expect(rationales[0]?.symbol_key).toBe("x.java#Server.handle");
  });

  it("captures a tagged /* block comment */ (block_comment nodes)", async () => {
    const src = `class Server {
    void spin() {
        /* TODO: replace the busy wait with a proper condition variable */
        wait();
    }
}
`;
    const tree = await parse(".java", src);
    const rationales = extractRationales(tree, "x.java", src);
    expect(rationales).toHaveLength(1);
    expect(rationales[0]?.kind).toBe("todo");
    expect(rationales[0]?.symbol_key).toBe("x.java#Server.spin");
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
