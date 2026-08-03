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

describe("extractCalls — Go (roadmap item 19)", () => {
  it("attributes a plain call to its enclosing function", async () => {
    const src = "package main\n\nfunc outer() {\n\thelper()\n}\n";
    const tree = await parse(".go", src);
    const calls = extractCalls(tree, "x.go", src);
    expect(calls).toEqual([
      { caller_key: "x.go#outer", callee_name: "helper", line: 4, confidence: "extracted" },
    ]);
  });

  it("tags a selector call pkg.Func() as inferred (right-most field)", async () => {
    const src = "package main\n\nimport \"fmt\"\n\nfunc outer() {\n\tfmt.Println(\"hi\")\n}\n";
    const tree = await parse(".go", src);
    const calls = extractCalls(tree, "x.go", src);
    expect(calls).toEqual([
      { caller_key: "x.go#outer", callee_name: "Println", line: 6, confidence: "inferred" },
    ]);
  });

  it("tags a receiver method call x.Method() as inferred", async () => {
    const src = "package server\n\nfunc run(s *Server) {\n\ts.Start()\n}\n";
    const tree = await parse(".go", src);
    const calls = extractCalls(tree, "x.go", src);
    expect(calls).toEqual([
      { caller_key: "x.go#run", callee_name: "Start", line: 4, confidence: "inferred" },
    ]);
  });

  it("qualifies a call inside a method with ReceiverType.method", async () => {
    const src = "package server\n\nfunc (s *Server) Start() error {\n\tlisten(s.Port)\n\treturn nil\n}\n";
    const tree = await parse(".go", src);
    const calls = extractCalls(tree, "x.go", src);
    expect(calls).toEqual([
      { caller_key: "x.go#Server.Start", callee_name: "listen", line: 4, confidence: "extracted" },
    ]);
  });

  it("value receiver qualifies the same as pointer receiver", async () => {
    const src = "package server\n\nfunc (s Server) Start() error {\n\tlisten(s.Port)\n\treturn nil\n}\n";
    const tree = await parse(".go", src);
    const calls = extractCalls(tree, "x.go", src);
    expect(calls[0]?.caller_key).toBe("x.go#Server.Start");
  });

  it("skips a call at package top level (no enclosing named symbol)", async () => {
    const src = "package main\n\nvar x = compute()\n";
    const tree = await parse(".go", src);
    const calls = extractCalls(tree, "x.go", src);
    expect(calls).toEqual([]);
  });
});

describe("extractCalls — Rust (roadmap item 20)", () => {
  it("attributes a bare call to its enclosing function (extracted)", async () => {
    const src = "fn outer() {\n    helper();\n}\n";
    const tree = await parse(".rs", src);
    const calls = extractCalls(tree, "x.rs", src);
    expect(calls).toEqual([
      { caller_key: "x.rs#outer", callee_name: "helper", line: 2, confidence: "extracted" },
    ]);
  });

  it("tags a receiver method call x.m() as inferred (field_expression)", async () => {
    const src = "fn run(s: &Server) {\n    s.start();\n}\n";
    const tree = await parse(".rs", src);
    const calls = extractCalls(tree, "x.rs", src);
    expect(calls).toEqual([
      { caller_key: "x.rs#run", callee_name: "start", line: 2, confidence: "inferred" },
    ]);
  });

  it("tags a path call Type::assoc() / a::b::f() as inferred (scoped_identifier)", async () => {
    const src = "fn run() {\n    let s = Server::new(8080);\n    crate::a::b::work();\n}\n";
    const tree = await parse(".rs", src);
    const calls = extractCalls(tree, "x.rs", src);
    expect(calls).toEqual([
      { caller_key: "x.rs#run", callee_name: "new", line: 2, confidence: "inferred" },
      { caller_key: "x.rs#run", callee_name: "work", line: 3, confidence: "inferred" },
    ]);
  });

  it("tags a bare generic call foo::<T>() as extracted (generic_function)", async () => {
    const src = "fn run() {\n    parse::<u32>();\n}\n";
    const tree = await parse(".rs", src);
    const calls = extractCalls(tree, "x.rs", src);
    expect(calls).toEqual([
      { caller_key: "x.rs#run", callee_name: "parse", line: 2, confidence: "extracted" },
    ]);
  });

  it("qualifies a call inside an impl method with Type.method", async () => {
    const src = "struct Server;\n\nimpl Server {\n    fn start(&self) {\n        listen(self.port);\n    }\n}\n";
    const tree = await parse(".rs", src);
    const calls = extractCalls(tree, "x.rs", src);
    expect(calls).toEqual([
      { caller_key: "x.rs#Server.start", callee_name: "listen", line: 5, confidence: "extracted" },
    ]);
  });

  it("impl Trait for T also qualifies members under T", async () => {
    const src = "struct Server;\n\ntrait Runner {\n    fn start(&self);\n}\n\nimpl Runner for Server {\n    fn start(&self) {\n        listen();\n    }\n}\n";
    const tree = await parse(".rs", src);
    const calls = extractCalls(tree, "x.rs", src);
    expect(calls).toEqual([
      { caller_key: "x.rs#Server.start", callee_name: "listen", line: 9, confidence: "extracted" },
    ]);
  });

  it("skips macro invocations (format!/println! are not call_expression)", async () => {
    const src = "fn run() {\n    println!(\"{}\", 1);\n}\n";
    const tree = await parse(".rs", src);
    const calls = extractCalls(tree, "x.rs", src);
    expect(calls).toEqual([]);
  });

  it("skips a call at module top level (no enclosing named symbol)", async () => {
    const src = "static X: u32 = compute();\n";
    const tree = await parse(".rs", src);
    const calls = extractCalls(tree, "x.rs", src);
    expect(calls).toEqual([]);
  });
});

describe("extractCalls — Java (roadmap item 21)", () => {
  it("attributes a bare method_invocation to its enclosing method (extracted)", async () => {
    const src = "class A {\n    void outer() {\n        helper();\n    }\n}\n";
    const tree = await parse(".java", src);
    const calls = extractCalls(tree, "x.java", src);
    expect(calls).toEqual([
      { caller_key: "x.java#A.outer", callee_name: "helper", line: 3, confidence: "extracted" },
    ]);
  });

  it("tags a receiver call x.m() / this.m() as inferred (object field present)", async () => {
    const src = "class A {\n    void run(Server s) {\n        s.start();\n        this.help();\n    }\n    private void help() {}\n}\n";
    const tree = await parse(".java", src);
    const calls = extractCalls(tree, "x.java", src);
    expect(calls).toEqual([
      { caller_key: "x.java#A.run", callee_name: "start", line: 3, confidence: "inferred" },
      { caller_key: "x.java#A.run", callee_name: "help", line: 4, confidence: "inferred" },
    ]);
  });

  it("tags a static/scoped call Type.m() / a.b.m() as inferred", async () => {
    const src = "class A {\n    void run() {\n        Server.create();\n        some.path.work();\n    }\n}\n";
    const tree = await parse(".java", src);
    const calls = extractCalls(tree, "x.java", src);
    expect(calls).toEqual([
      { caller_key: "x.java#A.run", callee_name: "create", line: 3, confidence: "inferred" },
      { caller_key: "x.java#A.run", callee_name: "work", line: 4, confidence: "inferred" },
    ]);
  });

  it("tags new X() as extracted, including scoped and generic types", async () => {
    const src =
      "class A {\n" +
      "    void run() {\n" +
      "        Server s = new Server(8080);\n" +
      "        Object l = new java.util.ArrayList<String>();\n" +
      "    }\n" +
      "}\n";
    const tree = await parse(".java", src);
    const calls = extractCalls(tree, "x.java", src);
    expect(calls).toEqual([
      { caller_key: "x.java#A.run", callee_name: "Server", line: 3, confidence: "extracted" },
      { caller_key: "x.java#A.run", callee_name: "ArrayList", line: 4, confidence: "extracted" },
    ]);
  });

  it("attributes a call inside a constructor with caller key Type.Type", async () => {
    const src = "class Server {\n    Server(int port) {\n        listen(port);\n    }\n    private void listen(int port) {}\n}\n";
    const tree = await parse(".java", src);
    const calls = extractCalls(tree, "x.java", src);
    expect(calls).toEqual([
      { caller_key: "x.java#Server.Server", callee_name: "listen", line: 3, confidence: "extracted" },
    ]);
  });

  it("attributes a call inside an interface default method with Interface.method", async () => {
    const src = "interface Handler {\n    default void close() {\n        release();\n    }\n    void release();\n}\n";
    const tree = await parse(".java", src);
    const calls = extractCalls(tree, "x.java", src);
    expect(calls).toEqual([
      { caller_key: "x.java#Handler.close", callee_name: "release", line: 3, confidence: "extracted" },
    ]);
  });

  it("attributes a call inside a nested class method with the innermost type", async () => {
    const src = "class Outer {\n    static class Inner {\n        void work() {\n            go();\n        }\n    }\n}\n";
    const tree = await parse(".java", src);
    const calls = extractCalls(tree, "x.java", src);
    expect(calls).toEqual([
      { caller_key: "x.java#Inner.work", callee_name: "go", line: 4, confidence: "extracted" },
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
