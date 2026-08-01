import { describe, it, expect, beforeAll } from "vitest";
import { extractCalls } from "./symbols.js";
import { parseSource, initParser } from "./parser.js";

beforeAll(async () => {
  await initParser();
});

async function parse(ext: string, src: string) {
  return parseSource(ext, src);
}

describe("extractCalls — TypeScript/JavaScript", () => {
  it("attributes a plain function call to its enclosing function", async () => {
    const src = "function outer() { helper(); }";
    const tree = await parse(".ts", src);
    const calls = extractCalls(tree, "x.ts", src);
    expect(calls).toEqual([
      { caller_key: "x.ts#outer", callee_name: "helper", line: 1, confidence: "extracted" },
    ]);
  });

  it("attributes a member-expression call to its right-most property", async () => {
    const src = "function outer() { obj.helper(); }";
    const tree = await parse(".ts", src);
    const calls = extractCalls(tree, "x.ts", src);
    expect(calls).toEqual([
      { caller_key: "x.ts#outer", callee_name: "helper", line: 1, confidence: "inferred" },
    ]);
  });

  it("qualifies a call inside a method with Class.method", async () => {
    const src = `class Foo {
  bar() { helper(); }
}`;
    const tree = await parse(".ts", src);
    const calls = extractCalls(tree, "x.ts", src);
    expect(calls).toEqual([
      { caller_key: "x.ts#Foo.bar", callee_name: "helper", line: 2, confidence: "extracted" },
    ]);
  });

  it("captures new_expression as a call to the constructor name", async () => {
    const src = "function outer() { const x = new Thing(); }";
    const tree = await parse(".ts", src);
    const calls = extractCalls(tree, "x.ts", src);
    expect(calls).toEqual([
      { caller_key: "x.ts#outer", callee_name: "Thing", line: 1, confidence: "extracted" },
    ]);
  });

  it("captures multiple calls with correct line numbers", async () => {
    const src = `function outer() {
  first();
  second();
}`;
    const tree = await parse(".ts", src);
    const calls = extractCalls(tree, "x.ts", src);
    expect(calls).toEqual([
      { caller_key: "x.ts#outer", callee_name: "first", line: 2, confidence: "extracted" },
      { caller_key: "x.ts#outer", callee_name: "second", line: 3, confidence: "extracted" },
    ]);
  });

  it("captures a call made by a nested function inside its own caller, not the outer one", async () => {
    const src = `function outer() {
  function inner() { helper(); }
  inner();
}`;
    const tree = await parse(".ts", src);
    const calls = extractCalls(tree, "x.ts", src);
    expect(calls).toEqual([
      { caller_key: "x.ts#inner", callee_name: "helper", line: 2, confidence: "extracted" },
      { caller_key: "x.ts#outer", callee_name: "inner", line: 3, confidence: "extracted" },
    ]);
  });

  it("skips a call at module top level (no enclosing named symbol)", async () => {
    const src = "sideEffect();";
    const tree = await parse(".ts", src);
    const calls = extractCalls(tree, "x.ts", src);
    expect(calls).toEqual([]);
  });

  it("skips a computed member call it cannot confidently name", async () => {
    const src = 'function outer() { obj[key]("x"); }';
    const tree = await parse(".ts", src);
    const calls = extractCalls(tree, "x.ts", src);
    expect(calls).toEqual([]);
  });
});

describe("extractCalls — Python", () => {
  it("attributes a plain call to its enclosing function", async () => {
    const src = "def outer():\n    helper()\n";
    const tree = await parse(".py", src);
    const calls = extractCalls(tree, "x.py", src);
    expect(calls).toEqual([
      { caller_key: "x.py#outer", callee_name: "helper", line: 2, confidence: "extracted" },
    ]);
  });

  it("attributes an attribute-access call to its right-most attribute", async () => {
    const src = "def outer():\n    obj.helper()\n";
    const tree = await parse(".py", src);
    const calls = extractCalls(tree, "x.py", src);
    expect(calls).toEqual([
      { caller_key: "x.py#outer", callee_name: "helper", line: 2, confidence: "inferred" },
    ]);
  });

  it("qualifies a call inside a method with Class.method", async () => {
    const src = "class Foo:\n    def bar(self):\n        helper()\n";
    const tree = await parse(".py", src);
    const calls = extractCalls(tree, "x.py", src);
    expect(calls).toEqual([
      { caller_key: "x.py#Foo.bar", callee_name: "helper", line: 3, confidence: "extracted" },
    ]);
  });
});

describe("extractCalls — confidence tags per callee shape", () => {
  it("tags a bare function call as extracted", async () => {
    const src = "function outer() { helper(); }";
    const tree = await parse(".ts", src);
    expect(extractCalls(tree, "x.ts", src)[0]?.confidence).toBe("extracted");
  });

  it("tags a new X() constructor call as extracted", async () => {
    const src = "function outer() { return new Widget(); }";
    const tree = await parse(".ts", src);
    expect(extractCalls(tree, "x.ts", src)[0]?.confidence).toBe("extracted");
  });

  it("tags a member-expression call as inferred (receiver unknown)", async () => {
    const src = "function outer() { obj.method(); }";
    const tree = await parse(".ts", src);
    expect(extractCalls(tree, "x.ts", src)[0]?.confidence).toBe("inferred");
  });

  it("tags a Python self.attr() call as inferred (receiver unknown)", async () => {
    const src = "class Foo:\n    def bar(self):\n        self.baz()\n";
    const tree = await parse(".py", src);
    const calls = extractCalls(tree, "x.py", src);
    expect(calls).toEqual([
      { caller_key: "x.py#Foo.bar", callee_name: "baz", line: 3, confidence: "inferred" },
    ]);
  });

  it("tags each call in a mixed body independently", async () => {
    const src = "function outer() { helper(); obj.method(); new Thing(); }";
    const tree = await parse(".ts", src);
    const calls = extractCalls(tree, "x.ts", src);
    expect(calls.map((c) => [c.callee_name, c.confidence])).toEqual([
      ["helper", "extracted"],
      ["method", "inferred"],
      ["Thing", "extracted"],
    ]);
  });
});
