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
    expect(calls).toEqual([{ caller_key: "x.ts#outer", callee_name: "helper", line: 1 }]);
  });

  it("attributes a member-expression call to its right-most property", async () => {
    const src = "function outer() { obj.helper(); }";
    const tree = await parse(".ts", src);
    const calls = extractCalls(tree, "x.ts", src);
    expect(calls).toEqual([{ caller_key: "x.ts#outer", callee_name: "helper", line: 1 }]);
  });

  it("qualifies a call inside a method with Class.method", async () => {
    const src = `class Foo {
  bar() { helper(); }
}`;
    const tree = await parse(".ts", src);
    const calls = extractCalls(tree, "x.ts", src);
    expect(calls).toEqual([{ caller_key: "x.ts#Foo.bar", callee_name: "helper", line: 2 }]);
  });

  it("captures new_expression as a call to the constructor name", async () => {
    const src = "function outer() { const x = new Thing(); }";
    const tree = await parse(".ts", src);
    const calls = extractCalls(tree, "x.ts", src);
    expect(calls).toEqual([{ caller_key: "x.ts#outer", callee_name: "Thing", line: 1 }]);
  });

  it("captures multiple calls with correct line numbers", async () => {
    const src = `function outer() {
  first();
  second();
}`;
    const tree = await parse(".ts", src);
    const calls = extractCalls(tree, "x.ts", src);
    expect(calls).toEqual([
      { caller_key: "x.ts#outer", callee_name: "first", line: 2 },
      { caller_key: "x.ts#outer", callee_name: "second", line: 3 },
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
      { caller_key: "x.ts#inner", callee_name: "helper", line: 2 },
      { caller_key: "x.ts#outer", callee_name: "inner", line: 3 },
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
    expect(calls).toEqual([{ caller_key: "x.py#outer", callee_name: "helper", line: 2 }]);
  });

  it("attributes an attribute-access call to its right-most attribute", async () => {
    const src = "def outer():\n    obj.helper()\n";
    const tree = await parse(".py", src);
    const calls = extractCalls(tree, "x.py", src);
    expect(calls).toEqual([{ caller_key: "x.py#outer", callee_name: "helper", line: 2 }]);
  });

  it("qualifies a call inside a method with Class.method", async () => {
    const src = "class Foo:\n    def bar(self):\n        helper()\n";
    const tree = await parse(".py", src);
    const calls = extractCalls(tree, "x.py", src);
    expect(calls).toEqual([{ caller_key: "x.py#Foo.bar", callee_name: "helper", line: 3 }]);
  });
});
