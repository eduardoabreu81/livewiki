import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as nodePath from "node:path";
import * as nodeOs from "node:os";
import * as nodeFs from "node:fs/promises";
import { run as runIndexer } from "./indexer.js";
import { run as runStatus } from "./status.js";
import { sha256 } from "./hashes.js";

let repoRoot: string;
let sampleRepo: string;

interface ActiveSymbolRow {
  key: string;
  kind: string;
  signature: string | null;
  start_line: number;
}

async function activeSymbolsForKey(key: string): Promise<ActiveSymbolRow[]> {
  const Database = (await import("better-sqlite3")).default;
  const db = new Database(nodePath.join(repoRoot, ".livewiki", "index.db"), { readonly: true });
  try {
    return db
      .prepare(
        "SELECT key, kind, signature, start_line FROM symbols WHERE key = ? AND status = 'active'",
      )
      .all(key) as ActiveSymbolRow[];
  } finally {
    db.close();
  }
}

beforeEach(async () => {
  // Resolve do CWD do test runner (packages/core/) — robusto.
  sampleRepo = nodePath.resolve(process.cwd(), "test/fixtures/sample-ts-repo");
  repoRoot = await nodeFs.mkdtemp(
    nodePath.join(nodeOs.tmpdir(), "livewiki-indexer-"),
  );
  // Copia só os arquivos esperados (sem .livewiki da fixture contaminada).
  // node:fs.cp com recursive traria .livewiki junto se existir na fixture.
  await nodeFs.mkdir(nodePath.join(repoRoot, "src"), { recursive: true });
  await nodeFs.mkdir(nodePath.join(repoRoot, "lib"), { recursive: true });
  await nodeFs.copyFile(
    nodePath.join(sampleRepo, "src", "auth.ts"),
    nodePath.join(repoRoot, "src", "auth.ts"),
  );
  await nodeFs.copyFile(
    nodePath.join(sampleRepo, "lib", "calc.py"),
    nodePath.join(repoRoot, "lib", "calc.py"),
  );
  await nodeFs.writeFile(nodePath.join(repoRoot, ".gitignore"), "node_modules/\n");
});

afterEach(async () => {
  await nodeFs.rm(repoRoot, { recursive: true, force: true });
});

describe("indexer end-to-end", () => {
  it("primeiro run: cria .livewiki/ + indexa 2 arquivos + extrai 6 symbols", async () => {
    const result = await runIndexer(repoRoot, { quiet: true });
    expect(result.filesScanned).toBe(2);
    expect(result.filesAdded).toBe(2);
    expect(result.filesUpdated).toBe(0);
    expect(result.filesUnchanged).toBe(0);
    expect(result.symbolsAdded).toBe(6);

    // .livewiki/index.db deve existir
    const dbPath = nodePath.join(repoRoot, ".livewiki", "index.db");
    expect(await nodeFs.stat(dbPath)).toBeTruthy();
  });

  it("segundo run sem mudanças: tudo inalterado (idempotente)", async () => {
    await runIndexer(repoRoot, { quiet: true });
    const r2 = await runIndexer(repoRoot, { quiet: true });
    expect(r2.filesScanned).toBe(2);
    expect(r2.filesAdded).toBe(0);
    expect(r2.filesUpdated).toBe(0);
    expect(r2.filesUnchanged).toBe(2);
    expect(r2.symbolsAdded).toBe(0);
  });

  it("arquivo modificado: marca como updated e re-extrai símbolos", async () => {
    await runIndexer(repoRoot, { quiet: true });
    const authPath = nodePath.join(repoRoot, "src", "auth.ts");
    const before = await nodeFs.readFile(authPath, "utf8");
    await nodeFs.writeFile(authPath, before + "\nexport function newOne() { return 99; }\n");

    const r = await runIndexer(repoRoot, { quiet: true });
    expect(r.filesUpdated).toBe(1);
    expect(r.filesUnchanged).toBe(1);
    expect(r.symbolsAdded).toBe(7); // 6 antigos + 1 nova função
  });

  it("arquivo deletado: marca como removido e symbols como deleted", async () => {
    await runIndexer(repoRoot, { quiet: true });
    await nodeFs.rm(nodePath.join(repoRoot, "src", "auth.ts"));

    const r = await runIndexer(repoRoot, { quiet: true });
    expect(r.filesDeleted).toBe(1);
    expect(r.symbolsDeleted).toBe(6); // 6 símbolos do auth.ts marcados deleted
  });

  it("auto-cria .livewiki/ sem aviso", async () => {
    // Garante que .livewiki não existe antes
    await nodeFs.rm(nodePath.join(repoRoot, ".livewiki"), { recursive: true, force: true });

    const result = await runIndexer(repoRoot, { quiet: true });
    expect(result.filesAdded).toBe(2);
    expect(
      await nodeFs.stat(nodePath.join(repoRoot, ".livewiki", "index.db")),
    ).toBeTruthy();
  });

  it("status reflete o que foi indexado", async () => {
    await runIndexer(repoRoot, { quiet: true });
    const report = await runStatus(repoRoot);
    expect(report.files.total).toBe(2);
    expect(report.files.byLang.typescript).toBe(1);
    expect(report.files.byLang.python).toBe(1);
    expect(report.symbols.total).toBe(6);
    expect(report.symbols.byKind.class).toBe(1);
    expect(report.symbols.byKind.method).toBe(2);
    expect(report.symbols.byKind.function).toBe(2);
    expect(report.symbols.byKind.export).toBe(1);
    expect(report.meta.schemaVersion).toBe(9);
  });

  it("indexes duplicate method names and persists one active row per key", async () => {
    const src = `const first = {
  shared() { return "first"; },
};
const second = {
  shared() { return "second"; },
};`;
    await nodeFs.writeFile(nodePath.join(repoRoot, "src", "collisions.ts"), src);

    await expect(runIndexer(repoRoot, { quiet: true })).resolves.toBeTruthy();

    const rows = await activeSymbolsForKey("src/collisions.ts#shared");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "method", start_line: 2 });
    expect(rows[0]?.signature).toContain("first");
  });

  it("indexes the two-stub generate-method trigger without a key collision", async () => {
    const src = `const firstClient = {
  async generate() { return { content: "first" }; },
};
const secondClient = {
  async generate() { return { content: "second" }; },
};`;
    await nodeFs.writeFile(nodePath.join(repoRoot, "src", "stub-clients.ts"), src);

    await expect(runIndexer(repoRoot, { quiet: true })).resolves.toBeTruthy();

    const rows = await activeSymbolsForKey("src/stub-clients.ts#generate");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "method", start_line: 2 });
    expect(rows[0]?.signature).toContain("first");
  });

  it("persists call edges and replaces them wholesale on reindex (Phase 3)", async () => {
    const callsPath = nodePath.join(repoRoot, "src", "calls-demo.ts");
    await nodeFs.writeFile(
      callsPath,
      "function outer() { helper(); }\nfunction helper() { return 1; }\n",
    );
    await runIndexer(repoRoot, { quiet: true });

    const Database = (await import("better-sqlite3")).default;
    const db = new Database(nodePath.join(repoRoot, ".livewiki", "index.db"), { readonly: true });
    try {
      const rows = db
        .prepare("SELECT caller_key, callee_name, line, confidence FROM calls WHERE caller_key = ?")
        .all("src/calls-demo.ts#outer") as Array<{
        caller_key: string;
        callee_name: string;
        line: number;
        confidence: string;
      }>;
      expect(rows).toEqual([
        { caller_key: "src/calls-demo.ts#outer", callee_name: "helper", line: 1, confidence: "extracted" },
      ]);
    } finally {
      db.close();
    }

    // Reindex after removing the call — the old edge must not survive as
    // a stale row (calls have no soft-delete/move-tracking, unlike symbols).
    await nodeFs.writeFile(callsPath, "function outer() { return 0; }\n");
    await runIndexer(repoRoot, { quiet: true });

    const db2 = new Database(nodePath.join(repoRoot, ".livewiki", "index.db"), { readonly: true });
    try {
      const rows = db2
        .prepare("SELECT caller_key FROM calls WHERE caller_key = ?")
        .all("src/calls-demo.ts#outer") as Array<{ caller_key: string }>;
      expect(rows).toEqual([]);
    } finally {
      db2.close();
    }
  });

  it("removes call edges when their file disappears from the walk", async () => {
    const callsPath = nodePath.join(repoRoot, "src", "calls-gone.ts");
    await nodeFs.writeFile(callsPath, "function outer() { helper(); }\n");
    await runIndexer(repoRoot, { quiet: true });
    await nodeFs.rm(callsPath);
    await runIndexer(repoRoot, { quiet: true });

    const Database = (await import("better-sqlite3")).default;
    const db = new Database(nodePath.join(repoRoot, ".livewiki", "index.db"), { readonly: true });
    try {
      const rows = db
        .prepare("SELECT caller_key FROM calls WHERE caller_key = ?")
        .all("src/calls-gone.ts#outer") as Array<{ caller_key: string }>;
      expect(rows).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("indexes a grammar-less file with 0 symbols and no parse warning (tier 2)", async () => {
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "main.rb"),
      "def main\nend\n",
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let result;
    try {
      result = await runIndexer(repoRoot, { quiet: true });
      expect(warn, "no parse warning for grammar-less files").not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
    expect(result.filesScanned).toBe(3);
    expect(result.filesAdded).toBe(3);

    const Database = (await import("better-sqlite3")).default;
    const db = new Database(nodePath.join(repoRoot, ".livewiki", "index.db"), { readonly: true });
    try {
      const row = db
        .prepare("SELECT id, lang FROM files WHERE path = 'main.rb' AND status = 'active'")
        .get() as { id: number; lang: string } | undefined;
      expect(row?.lang).toBe("rb");
      const syms = db
        .prepare("SELECT COUNT(*) AS n FROM symbols WHERE file_id = ?")
        .get(row!.id) as { n: number };
      expect(syms.n).toBe(0);
    } finally {
      db.close();
    }
  });

  it("skips a file with a NUL byte in the first 8 KiB (binary safety net)", async () => {
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "blob.txt"),
      Buffer.from([0x41, 0x00, 0x42, 0x43]),
    );
    const result = await runIndexer(repoRoot, { quiet: true });
    expect(result.filesSkippedBinary).toBe(1);
    expect(result.filesSkippedTooLarge).toBe(0);

    const Database = (await import("better-sqlite3")).default;
    const db = new Database(nodePath.join(repoRoot, ".livewiki", "index.db"), { readonly: true });
    try {
      const row = db
        .prepare("SELECT id FROM files WHERE path = 'blob.txt'")
        .get() as { id: number } | undefined;
      expect(row, "binary file must not be indexed").toBeUndefined();
    } finally {
      db.close();
    }
  });

  it("skips a file larger than 1 MiB (size cap)", async () => {
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "big.log"),
      "x".repeat(1024 * 1024 + 1),
    );
    const result = await runIndexer(repoRoot, { quiet: true });
    expect(result.filesSkippedTooLarge).toBe(1);
    expect(result.filesSkippedBinary).toBe(0);

    const Database = (await import("better-sqlite3")).default;
    const db = new Database(nodePath.join(repoRoot, ".livewiki", "index.db"), { readonly: true });
    try {
      const row = db
        .prepare("SELECT id FROM files WHERE path = 'big.log'")
        .get() as { id: number } | undefined;
      expect(row, "oversized file must not be indexed").toBeUndefined();
    } finally {
      db.close();
    }
  });

  it("incremental run treats prose files as unchanged by hash", async () => {
    await nodeFs.writeFile(nodePath.join(repoRoot, "main.rb"), "def main\nend\n");
    await runIndexer(repoRoot, { quiet: true });
    const r2 = await runIndexer(repoRoot, { quiet: true });
    expect(r2.filesAdded).toBe(0);
    expect(r2.filesUpdated).toBe(0);
    expect(r2.filesUnchanged).toBe(3); // auth.ts + calc.py + main.rb
  });

  it("status classifies each language by coverage tier", async () => {
    await nodeFs.writeFile(nodePath.join(repoRoot, "main.rb"), "def main\nend\n");
    await runIndexer(repoRoot, { quiet: true });
    const report = await runStatus(repoRoot);
    expect(report.files.tiers.typescript).toBe("anchored");
    expect(report.files.tiers.python).toBe("anchored");
    expect(report.files.tiers.rb).toBe("prose");
  });
});

// === Roadmap item 19: Go tier-1 anchored indexing ===

describe("indexer — Go fixture repo (roadmap item 19)", () => {
  let goRoot: string;

  beforeEach(async () => {
    const fixture = nodePath.resolve(process.cwd(), "test/fixtures/sample-go-repo");
    goRoot = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "livewiki-indexer-go-"));
    await nodeFs.cp(fixture, goRoot, { recursive: true });
  });

  afterEach(async () => {
    await nodeFs.rm(goRoot, { recursive: true, force: true });
  });

  it("indexes .go files with symbols (tier 1, not prose-zero)", async () => {
    const result = await runIndexer(goRoot, { quiet: true });
    // go.mod has no .go symbols; cmd/main.go + server/server.go carry them.
    expect(result.filesAdded).toBe(3);
    expect(result.symbolsAdded).toBeGreaterThan(0);

    const report = await runStatus(goRoot);
    expect(report.files.tiers.go).toBe("anchored");
    expect(report.files.byLang.go).toBe(2);
    expect(report.symbols.byKind.function).toBe(3); // main, NewServer, listen
    expect(report.symbols.byKind.class).toBe(1); // Server struct
    expect(report.symbols.byKind.interface).toBe(1); // Runner
    expect(report.symbols.byKind.method).toBe(2); // Server.Addr, Server.Start
  });

  it("method keys are qualified by receiver type (pointer stripped)", async () => {
    await runIndexer(goRoot, { quiet: true });
    const addr = await activeSymbolsForKeyIn(goRoot, "server/server.go#Server.Addr");
    expect(addr).toHaveLength(1);
    expect(addr[0]).toMatchObject({ kind: "method" });
    const start = await activeSymbolsForKeyIn(goRoot, "server/server.go#Server.Start");
    expect(start).toHaveLength(1);
  });

  it("extracts calls with confidence tags and WHY/HACK rationale comments", async () => {
    await runIndexer(goRoot, { quiet: true });

    const Database = (await import("better-sqlite3")).default;
    const db = new Database(nodePath.join(goRoot, ".livewiki", "index.db"), { readonly: true });
    try {
      const calls = db
        .prepare(
          `SELECT c.caller_key, c.callee_name, c.confidence FROM calls c
           JOIN files f ON f.id = c.file_id WHERE f.path = 'cmd/main.go'
           ORDER BY c.line, c.callee_name`,
        )
        .all() as Array<{ caller_key: string; callee_name: string; confidence: string }>;
      // server.NewServer / fmt.Println / srv.Addr / srv.Start are selector
      // calls → inferred; nothing bare in main.go.
      expect(calls).toContainEqual({
        caller_key: "cmd/main.go#main", callee_name: "NewServer", confidence: "inferred",
      });
      expect(calls).toContainEqual({
        caller_key: "cmd/main.go#main", callee_name: "Println", confidence: "inferred",
      });
      expect(calls).toContainEqual({
        caller_key: "cmd/main.go#main", callee_name: "Start", confidence: "inferred",
      });

      // server/server.go: the bare `listen(...)` call inside Server.Start is
      // extracted; fmt.Sprintf inside Addr is inferred.
      const serverCalls = db
        .prepare(
          `SELECT c.caller_key, c.callee_name, c.confidence FROM calls c
           JOIN files f ON f.id = c.file_id WHERE f.path = 'server/server.go'
           ORDER BY c.line, c.callee_name`,
        )
        .all() as Array<{ caller_key: string; callee_name: string; confidence: string }>;
      expect(serverCalls).toContainEqual({
        caller_key: "server/server.go#Server.Start", callee_name: "listen", confidence: "extracted",
      });
      expect(serverCalls).toContainEqual({
        caller_key: "server/server.go#Server.Addr", callee_name: "Sprintf", confidence: "inferred",
      });
    } finally {
      db.close();
    }

    const rationales = await (async () => {
      const db2 = new (await import("better-sqlite3")).default(
        nodePath.join(goRoot, ".livewiki", "index.db"), { readonly: true },
      );
      try {
        return db2
          .prepare(
            `SELECT r.symbol_key, r.kind FROM rationales r
             JOIN files f ON f.id = r.file_id WHERE f.lang = 'go'
             ORDER BY f.path, r.start_line`,
          )
          .all() as Array<{ symbol_key: string | null; kind: string }>;
      } finally {
        db2.close();
      }
    })();
    expect(rationales).toContainEqual({ symbol_key: "cmd/main.go#main", kind: "why" });
    expect(rationales).toContainEqual({ symbol_key: "server/server.go#Server.Start", kind: "hack" });
  });
});

// === Roadmap item 20: Rust tier-1 anchored indexing ===

describe("indexer — Rust fixture repo (roadmap item 20)", () => {
  let rustRoot: string;

  beforeEach(async () => {
    const fixture = nodePath.resolve(process.cwd(), "test/fixtures/sample-rust-repo");
    rustRoot = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "livewiki-indexer-rust-"));
    await nodeFs.cp(fixture, rustRoot, { recursive: true });
  });

  afterEach(async () => {
    await nodeFs.rm(rustRoot, { recursive: true, force: true });
  });

  it("indexes .rs files with symbols (tier 1, not prose-zero)", async () => {
    const result = await runIndexer(rustRoot, { quiet: true });
    // Cargo.toml has no .rs symbols; src/{main,models,server}.rs carry them.
    expect(result.filesAdded).toBe(4);
    expect(result.symbolsAdded).toBeGreaterThan(0);

    const report = await runStatus(rustRoot);
    expect(report.files.tiers.rust).toBe("anchored");
    expect(report.files.byLang.rust).toBe(3);
    expect(report.symbols.byKind.function).toBe(4); // main, log_startup, dispatch, dispatch_ref
    expect(report.symbols.byKind.class).toBe(3); // Server, Mode, Request
    expect(report.symbols.byKind.interface).toBe(1); // Handler
    expect(report.symbols.byKind.method).toBe(5); // Request.new, Server.{new,addr,handle,process}
  });

  it("method keys are qualified by impl type (inherent AND trait impls)", async () => {
    await runIndexer(rustRoot, { quiet: true });
    const addr = await activeSymbolsForKeyIn(rustRoot, "src/server.rs#Server.addr");
    expect(addr).toHaveLength(1);
    expect(addr[0]).toMatchObject({ kind: "method" });
    const process = await activeSymbolsForKeyIn(rustRoot, "src/server.rs#Server.process");
    expect(process).toHaveLength(1);
    expect(process[0]).toMatchObject({ kind: "method" });
  });

  it("extracts calls with confidence tags and doc/tagged rationale comments", async () => {
    await runIndexer(rustRoot, { quiet: true });

    const Database = (await import("better-sqlite3")).default;
    const db = new Database(nodePath.join(rustRoot, ".livewiki", "index.db"), { readonly: true });
    try {
      const calls = db
        .prepare(
          `SELECT c.caller_key, c.callee_name, c.confidence FROM calls c
           JOIN files f ON f.id = c.file_id WHERE f.path = 'src/main.rs'
           ORDER BY c.line, c.callee_name`,
        )
        .all() as Array<{ caller_key: string; callee_name: string; confidence: string }>;
      // log_startup() is bare → extracted; Server::new / Request::new are
      // scoped paths → inferred; server.addr()/server.handle() are field
      // accesses → inferred; println! is a macro → no row.
      expect(calls).toContainEqual({
        caller_key: "src/main.rs#main", callee_name: "log_startup", confidence: "extracted",
      });
      expect(calls).toContainEqual({
        caller_key: "src/main.rs#main", callee_name: "new", confidence: "inferred",
      });
      expect(calls).toContainEqual({
        caller_key: "src/main.rs#main", callee_name: "addr", confidence: "inferred",
      });
      expect(calls).toContainEqual({
        caller_key: "src/main.rs#main", callee_name: "handle", confidence: "inferred",
      });
      expect(calls.find((c) => c.callee_name === "println")).toBeUndefined();

      // src/server.rs: the bare dispatch/dispatch_ref calls inside the impl
      // methods are extracted and qualified by the impl type — including the
      // `impl Handler for Server` member.
      const serverCalls = db
        .prepare(
          `SELECT c.caller_key, c.callee_name, c.confidence FROM calls c
           JOIN files f ON f.id = c.file_id WHERE f.path = 'src/server.rs'
           ORDER BY c.line, c.callee_name`,
        )
        .all() as Array<{ caller_key: string; callee_name: string; confidence: string }>;
      expect(serverCalls).toContainEqual({
        caller_key: "src/server.rs#Server.handle", callee_name: "dispatch", confidence: "extracted",
      });
      expect(serverCalls).toContainEqual({
        caller_key: "src/server.rs#Server.process", callee_name: "dispatch_ref", confidence: "extracted",
      });
    } finally {
      db.close();
    }

    const rationales = await (async () => {
      const db2 = new (await import("better-sqlite3")).default(
        nodePath.join(rustRoot, ".livewiki", "index.db"), { readonly: true },
      );
      try {
        return db2
          .prepare(
            `SELECT r.symbol_key, r.kind FROM rationales r
             JOIN files f ON f.id = r.file_id WHERE f.lang = 'rust'
             ORDER BY f.path, r.start_line`,
          )
          .all() as Array<{ symbol_key: string | null; kind: string }>;
      } finally {
        db2.close();
      }
    })();
    // //! inner doc at the top of main.rs → file-level docstring.
    expect(rationales).toContainEqual({ symbol_key: null, kind: "docstring" });
    // WHY tagged comment above fn main.
    expect(rationales).toContainEqual({ symbol_key: "src/main.rs#main", kind: "why" });
    // /// doc comments above the struct and an impl method.
    expect(rationales).toContainEqual({ symbol_key: "src/server.rs#Server", kind: "docstring" });
    expect(rationales).toContainEqual({ symbol_key: "src/server.rs#Server.new", kind: "docstring" });
    // HACK tagged comment inside Server.handle's body.
    expect(rationales).toContainEqual({ symbol_key: "src/server.rs#Server.handle", kind: "hack" });
  });
});

describe("indexer — Java fixture repo (roadmap item 21)", () => {
  let javaRoot: string;

  beforeEach(async () => {
    const fixture = nodePath.resolve(process.cwd(), "test/fixtures/sample-java-repo");
    javaRoot = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "livewiki-indexer-java-"));
    await nodeFs.cp(fixture, javaRoot, { recursive: true });
  });

  afterEach(async () => {
    await nodeFs.rm(javaRoot, { recursive: true, force: true });
  });

  it("indexes .java files with symbols (tier 1, not prose-zero)", async () => {
    const result = await runIndexer(javaRoot, { quiet: true });
    expect(result.filesAdded).toBe(5);
    expect(result.symbolsAdded).toBeGreaterThan(0);

    const report = await runStatus(javaRoot);
    expect(report.files.tiers.java).toBe("anchored");
    expect(report.files.byLang.java).toBe(5);
    expect(report.symbols.byKind.class).toBe(4); // Main, Server, Mode (enum), Item (record)
    expect(report.symbols.byKind.interface).toBe(1); // Handler
    // Main.{main,logStartup}; Server.{Server,start,addr,handle,dispatch,listen,process};
    // Handler.handle; Item.describe
    expect(report.symbols.byKind.method).toBe(11);
  });

  it("method/constructor keys are qualified by the enclosing type", async () => {
    await runIndexer(javaRoot, { quiet: true });
    const ctor = await activeSymbolsForKeyIn(
      javaRoot,
      "src/main/java/com/fixture/server/Server.java#Server.Server",
    );
    expect(ctor).toHaveLength(1);
    expect(ctor[0]).toMatchObject({ kind: "method" });
    const addr = await activeSymbolsForKeyIn(
      javaRoot,
      "src/main/java/com/fixture/server/Server.java#Server.addr",
    );
    expect(addr).toHaveLength(1);
    const ifaceMethod = await activeSymbolsForKeyIn(
      javaRoot,
      "src/main/java/com/fixture/server/Handler.java#Handler.handle",
    );
    expect(ifaceMethod).toHaveLength(1);
    expect(ifaceMethod[0]).toMatchObject({ kind: "method" });
    const recordMethod = await activeSymbolsForKeyIn(
      javaRoot,
      "src/main/java/com/fixture/model/Item.java#Item.describe",
    );
    expect(recordMethod).toHaveLength(1);
  });

  it("extracts calls with confidence tags and Javadoc/tagged rationale comments", async () => {
    await runIndexer(javaRoot, { quiet: true });

    const Database = (await import("better-sqlite3")).default;
    const db = new Database(nodePath.join(javaRoot, ".livewiki", "index.db"), { readonly: true });
    try {
      const calls = db
        .prepare(
          `SELECT c.caller_key, c.callee_name, c.confidence FROM calls c
           JOIN files f ON f.id = c.file_id WHERE f.path LIKE '%/Main.java'
           ORDER BY c.line, c.callee_name`,
        )
        .all() as Array<{ caller_key: string; callee_name: string; confidence: string }>;
      // logStartup() is bare → extracted; new Server()/new Item() →
      // extracted; server.start()/server.handle()/server.addr() and
      // List.of()/System.out.println() have receivers → inferred.
      expect(calls).toContainEqual({
        caller_key: "src/main/java/com/fixture/Main.java#Main.main",
        callee_name: "logStartup", confidence: "extracted",
      });
      expect(calls).toContainEqual({
        caller_key: "src/main/java/com/fixture/Main.java#Main.main",
        callee_name: "Server", confidence: "extracted",
      });
      expect(calls).toContainEqual({
        caller_key: "src/main/java/com/fixture/Main.java#Main.main",
        callee_name: "Item", confidence: "extracted",
      });
      expect(calls).toContainEqual({
        caller_key: "src/main/java/com/fixture/Main.java#Main.main",
        callee_name: "start", confidence: "inferred",
      });
      expect(calls).toContainEqual({
        caller_key: "src/main/java/com/fixture/Main.java#Main.main",
        callee_name: "of", confidence: "inferred",
      });

      // Server.java: bare calls inside methods are extracted and qualified
      // by the enclosing class.
      const serverCalls = db
        .prepare(
          `SELECT c.caller_key, c.callee_name, c.confidence FROM calls c
           JOIN files f ON f.id = c.file_id WHERE f.path LIKE '%/Server.java'
           ORDER BY c.line, c.callee_name`,
        )
        .all() as Array<{ caller_key: string; callee_name: string; confidence: string }>;
      expect(serverCalls).toContainEqual({
        caller_key: "src/main/java/com/fixture/server/Server.java#Server.handle",
        callee_name: "dispatch", confidence: "extracted",
      });
      expect(serverCalls).toContainEqual({
        caller_key: "src/main/java/com/fixture/server/Server.java#Server.start",
        callee_name: "listen", confidence: "extracted",
      });
    } finally {
      db.close();
    }

    const db2 = new Database(nodePath.join(javaRoot, ".livewiki", "index.db"), { readonly: true });
    try {
      const rationales = db2
        .prepare(
          `SELECT r.symbol_key, r.kind FROM rationales r
           JOIN files f ON f.id = r.file_id WHERE f.lang = 'java'
           ORDER BY f.path, r.start_line`,
        )
        .all() as Array<{ symbol_key: string | null; kind: string }>;
      // Javadoc above the class (rule 2: block ends immediately above).
      expect(rationales).toContainEqual({
        symbol_key: "src/main/java/com/fixture/server/Server.java#Server", kind: "docstring",
      });
      expect(rationales).toContainEqual({
        symbol_key: "src/main/java/com/fixture/model/Item.java#Item", kind: "docstring",
      });
      // WHY comment above main() sits inside the class body → rule 1
      // attributes it to the enclosing class (pinned cross-language
      // contract, same as a TS method-leading comment).
      expect(rationales).toContainEqual({
        symbol_key: "src/main/java/com/fixture/Main.java#Main", kind: "why",
      });
      // HACK tagged comment inside Server.handle's body.
      expect(rationales).toContainEqual({
        symbol_key: "src/main/java/com/fixture/server/Server.java#Server.handle", kind: "hack",
      });
    } finally {
      db2.close();
    }
  });
});

async function activeSymbolsForKeyIn(root: string, key: string): Promise<ActiveSymbolRow[]> {
  const Database = (await import("better-sqlite3")).default;
  const db = new Database(nodePath.join(root, ".livewiki", "index.db"), { readonly: true });
  try {
    return db
      .prepare(
        "SELECT key, kind, signature, start_line FROM symbols WHERE key = ? AND status = 'active'",
      )
      .all(key) as ActiveSymbolRow[];
  } finally {
    db.close();
  }
}


interface RationaleQueryRow {
  symbol_key: string | null;
  kind: string;
  text: string;
  start_line: number;
}

async function rationalesForFile(path: string): Promise<RationaleQueryRow[]> {
  const Database = (await import("better-sqlite3")).default;
  const db = new Database(nodePath.join(repoRoot, ".livewiki", "index.db"), { readonly: true });
  try {
    return db
      .prepare(
        `SELECT r.symbol_key, r.kind, r.text, r.start_line
         FROM rationales r JOIN files f ON f.id = r.file_id
         WHERE f.path = ? ORDER BY r.start_line, r.id`,
      )
      .all(path) as RationaleQueryRow[];
  } finally {
    db.close();
  }
}

describe("indexer — rationales (Etapa 2b)", () => {
  it("stores tagged comments and docstrings with positional symbol keys", async () => {
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "src", "intent.ts"),
      `// WHY: the retry budget protects the upstream API from bursts
export function retry() {
  // HACK: setTimeout drift accumulates on some platforms
  return 1;
}

// NOTE: file-level observation, separated by a blank line
`,
    );
    await runIndexer(repoRoot, { quiet: true });

    const rows = await rationalesForFile("src/intent.ts");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      symbol_key: "src/intent.ts#retry",
      kind: "why",
      start_line: 1,
    });
    expect(rows[1]).toMatchObject({
      symbol_key: "src/intent.ts#retry",
      kind: "hack",
      start_line: 3,
    });
    expect(rows[2]).toMatchObject({ symbol_key: null, kind: "note", start_line: 7 });
  });

  it("re-index replaces rationale rows instead of duplicating them", async () => {
    const file = nodePath.join(repoRoot, "src", "intent.ts");
    await nodeFs.writeFile(
      file,
      `// TODO: first version of the intent comment
export function f() { return 1; }
`,
    );
    await runIndexer(repoRoot, { quiet: true });
    expect(await rationalesForFile("src/intent.ts")).toHaveLength(1);

    await nodeFs.writeFile(
      file,
      `// TODO: rewritten intent comment replacing the first one
// FIXME: and a second tagged line joins the block
export function f() { return 1; }
`,
    );
    await runIndexer(repoRoot, { quiet: true });
    const rows = await rationalesForFile("src/intent.ts");
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.kind)).toEqual(["todo", "fixme"]);
    expect(rows.some((r) => r.text.includes("first version"))).toBe(false);
  });

  it("deletes rationale rows when the file is removed", async () => {
    const file = nodePath.join(repoRoot, "src", "intent.ts");
    await nodeFs.writeFile(
      file,
      `// WHY: doomed file with an intent comment
export function f() { return 1; }
`,
    );
    await runIndexer(repoRoot, { quiet: true });
    expect(await rationalesForFile("src/intent.ts")).toHaveLength(1);

    await nodeFs.rm(file);
    await runIndexer(repoRoot, { quiet: true });
    expect(await rationalesForFile("src/intent.ts")).toHaveLength(0);
  });

  it("skips rationale extraction for generated files (header sniff)", async () => {
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "src", "generated.ts"),
      `// Code generated by fixturegen. DO NOT EDIT.
// WHY: this comment must NOT be captured — the file is generated
export function generated() { return 1; }
`,
    );
    await runIndexer(repoRoot, { quiet: true });

    // The file IS indexed (symbols extracted), but rationale rows are zero.
    const symbols = await activeSymbolsForKey("src/generated.ts#generated");
    expect(symbols).toHaveLength(1);
    expect(await rationalesForFile("src/generated.ts")).toHaveLength(0);
  });
});

// === Roadmap item 12: EOL-insensitive hashing + legacy silent migration ===

describe("indexer — EOL-insensitive hashing (roadmap item 12)", () => {
  it("CRLF→LF flip: file counts as unchanged, zero symbols re-added", async () => {
    const crlf = "export function flip() {\r\n  return 1;\r\n}\r\n";
    const filePath = nodePath.join(repoRoot, "src", "flip.ts");
    await nodeFs.writeFile(filePath, crlf);
    await runIndexer(repoRoot, { quiet: true });

    // git core.autocrlf checkout conversion: same content, LF endings.
    await nodeFs.writeFile(filePath, crlf.replace(/\r\n/g, "\n"));
    const r = await runIndexer(repoRoot, { quiet: true });
    expect(r.filesUpdated).toBe(0);
    expect(r.filesAdded).toBe(0);
    expect(r.filesUnchanged).toBe(3); // auth.ts + calc.py + flip.ts
    expect(r.symbolsAdded).toBe(0);
  });

  it("legacy raw-bytes hash migrates silently (unchanged, not updated)", async () => {
    // Simulates a database written before item 12: content_hash is the
    // sha256 of the RAW bytes (with CRLF), not of the normalized text.
    const crlf = "export function legacy() {\r\n  return 1;\r\n}\r\n";
    await nodeFs.writeFile(nodePath.join(repoRoot, "src", "legacy.ts"), crlf);
    await runIndexer(repoRoot, { quiet: true });

    const dbPath = nodePath.join(repoRoot, ".livewiki", "index.db");
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(dbPath);
    try {
      db.prepare("UPDATE files SET content_hash = ? WHERE path = 'src/legacy.ts'").run(
        sha256(crlf), // legacy raw-bytes hash
      );
    } finally {
      db.close();
    }

    // Bytes on disk unchanged: the legacy hash still matches the raw read,
    // so this is a silent migration — not a content change.
    const r = await runIndexer(repoRoot, { quiet: true });
    expect(r.filesUpdated).toBe(0);
    expect(r.filesAdded).toBe(0);
    expect(r.filesUnchanged).toBe(3);
    expect(r.symbolsAdded).toBe(0);

    // The stored hash is now the normalized one.
    const db2 = new Database(dbPath, { readonly: true });
    try {
      const row = db2
        .prepare("SELECT content_hash FROM files WHERE path = 'src/legacy.ts'")
        .get() as { content_hash: string };
      expect(row.content_hash).toBe(sha256(crlf.replace(/\r\n/g, "\n")));
    } finally {
      db2.close();
    }
  });

  it("real content change is NOT mistaken for an EOL migration", async () => {
    const crlf = "export function real() {\r\n  return 1;\r\n}\r\n";
    const filePath = nodePath.join(repoRoot, "src", "real.ts");
    await nodeFs.writeFile(filePath, crlf);
    await runIndexer(repoRoot, { quiet: true });

    // Real edit AND an EOL flip at once: must follow the normal update path.
    await nodeFs.writeFile(
      filePath,
      "export function real() {\n  return 2;\n}\n",
    );
    const r = await runIndexer(repoRoot, { quiet: true });
    expect(r.filesUpdated).toBe(1);
  });

  it("legacy-CRLF DB + LF files on disk: silent flipped-EOL migration", async () => {
    // Simulates a pre-item-12 database indexed when the file was CRLF on
    // disk (stored hash = raw CRLF bytes); the file is now LF.
    const lf = "export function flipped() {\n  return 1;\n}\n";
    await nodeFs.writeFile(nodePath.join(repoRoot, "src", "flipped.ts"), lf);
    await runIndexer(repoRoot, { quiet: true });

    const dbPath = nodePath.join(repoRoot, ".livewiki", "index.db");
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(dbPath);
    try {
      db.prepare("UPDATE files SET content_hash = ? WHERE path = 'src/flipped.ts'").run(
        sha256(lf.replace(/\n/g, "\r\n")), // legacy raw-CRLF hash
      );
    } finally {
      db.close();
    }

    // Neither the normalized hash nor the raw-bytes hash matches stored,
    // but the CRLF-expanded variant does: provably EOL-only-changed.
    const r = await runIndexer(repoRoot, { quiet: true });
    expect(r.filesUpdated).toBe(0);
    expect(r.filesAdded).toBe(0);
    expect(r.filesUnchanged).toBe(3);
    expect(r.symbolsAdded).toBe(0);

    const db2 = new Database(dbPath, { readonly: true });
    try {
      const row = db2
        .prepare("SELECT content_hash FROM files WHERE path = 'src/flipped.ts'")
        .get() as { content_hash: string };
      expect(row.content_hash).toBe(sha256(lf));
    } finally {
      db2.close();
    }
  });

  it("legacy-LF DB + CRLF files on disk: absorbed by the unchanged fast path", async () => {
    // Post-upgrade hashes on LF content are byte-identical to legacy raw
    // hashes (normalizeEol is a no-op on LF-only text), so a current-code
    // index of the LF file already IS a faithful legacy-LF database — no
    // DB rewrite needed. Legacy symbol hashes were likewise computed on LF
    // text == normalized text, so no realignment is required either.
    const lf = "export function fliplf() {\n  return 1;\n}\n";
    const filePath = nodePath.join(repoRoot, "src", "fliplf.ts");
    await nodeFs.writeFile(filePath, lf);
    await runIndexer(repoRoot, { quiet: true });

    await nodeFs.writeFile(filePath, lf.replace(/\n/g, "\r\n"));
    const r = await runIndexer(repoRoot, { quiet: true });
    expect(r.filesUpdated).toBe(0);
    expect(r.filesAdded).toBe(0);
    expect(r.filesUnchanged).toBe(3);
    expect(r.symbolsAdded).toBe(0);
  });

  it("legacy-CRLF DB + LF files + a real edit: normal updated path", async () => {
    const lf = "export function realflip() {\n  return 1;\n}\n";
    const filePath = nodePath.join(repoRoot, "src", "realflip.ts");
    await nodeFs.writeFile(filePath, lf);
    await runIndexer(repoRoot, { quiet: true });

    const Database = (await import("better-sqlite3")).default;
    const db = new Database(nodePath.join(repoRoot, ".livewiki", "index.db"));
    try {
      db.prepare("UPDATE files SET content_hash = ? WHERE path = 'src/realflip.ts'").run(
        sha256(lf.replace(/\n/g, "\r\n")), // legacy raw-CRLF hash
      );
    } finally {
      db.close();
    }

    // Real content change in the now-LF file: the CRLF-expanded variant of
    // the CHANGED bytes cannot match the stored hash of the ORIGINAL bytes.
    await nodeFs.writeFile(
      filePath,
      "export function realflip() {\n  return 2;\n}\n",
    );
    const r = await runIndexer(repoRoot, { quiet: true });
    expect(r.filesUpdated).toBe(1);
  });
});

describe("indexer — grammar-set state (P1 + follow-up, external re-review 2026-08-03/04)", () => {
  // The unchanged fast path compares content hashes only: a file whose
  // grammar coverage changed AFTER indexing kept a silently stale result.
  // `meta.grammar_state` (ext→grammar map + per-grammar .wasm identity)
  // drives directed one-run re-parses for all three change shapes.
  let p1Root: string;

  beforeEach(async () => {
    // Never index inside the fixture itself — smoke on a COPY.
    const fixture = nodePath.resolve(process.cwd(), "test/fixtures/sample-rust-repo");
    p1Root = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "livewiki-indexer-p1-"));
    await nodeFs.cp(fixture, p1Root, { recursive: true });
  });

  afterEach(async () => {
    await nodeFs.rm(p1Root, { recursive: true, force: true });
  });

  const dbPath = () => nodePath.join(p1Root, ".livewiki", "index.db");

  /** Rewrites the DB into the exact pre-grammar (pre-feature) shape: prose
   *  label, zero symbols/calls/rationales, NO stored grammar state.
   *  Content hashes untouched (the files genuinely never changed). */
  async function simulatePreGrammarIndex(): Promise<void> {
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(dbPath());
    try {
      db.exec(`
        DELETE FROM symbols;
        DELETE FROM calls;
        DELETE FROM rationales;
        UPDATE files SET lang = 'rs' WHERE path LIKE '%.rs';
        DELETE FROM meta WHERE key = 'grammar_state';
      `);
    } finally {
      db.close();
    }
  }

  /** Rewrites `meta.grammar_state` via `mutate`, keeping valid JSON. */
  async function mutateStoredGrammarState(
    mutate: (state: { map: Record<string, string>; artifacts: Record<string, string> }) => void,
  ): Promise<void> {
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(dbPath());
    try {
      const row = db
        .prepare("SELECT value FROM meta WHERE key = 'grammar_state'")
        .get() as { value: string };
      const state = JSON.parse(row.value) as { map: Record<string, string>; artifacts: Record<string, string> };
      mutate(state);
      db.prepare("UPDATE meta SET value = ? WHERE key = 'grammar_state'").run(JSON.stringify(state));
    } finally {
      db.close();
    }
  }

  it("grammar ADDED: re-parses unchanged zero-symbol files from a legacy DB", async () => {
    const first = await runIndexer(p1Root, { quiet: true });
    expect(first.filesAdded).toBe(4);
    expect(first.filesReprocessedGrammar).toBe(0);

    await simulatePreGrammarIndex();

    const second = await runIndexer(p1Root, { quiet: true });
    expect(second.filesAdded).toBe(0);
    expect(second.filesUpdated).toBe(0);
    expect(second.filesReprocessedGrammar).toBe(3); // the three .rs files
    expect(second.symbolsAdded).toBeGreaterThan(0);

    // Tier label tells the truth again: rust is anchored with symbols.
    const report = await runStatus(p1Root);
    expect(report.files.tiers.rust).toBe("anchored");
    expect(report.files.byLang.rust).toBe(3);
    expect(report.symbols.byKind.function).toBe(4);
    expect(report.symbols.byKind.class).toBe(3);
  });

  it("is a one-run migration: steady state reprocesses nothing", async () => {
    await runIndexer(p1Root, { quiet: true });
    await simulatePreGrammarIndex();
    await runIndexer(p1Root, { quiet: true });

    const third = await runIndexer(p1Root, { quiet: true });
    expect(third.filesAdded).toBe(0);
    expect(third.filesUpdated).toBe(0);
    expect(third.filesReprocessedGrammar).toBe(0);
    expect(third.symbolsAdded).toBe(0);
  });

  it("unrelated state drift does not touch already-parsed files", async () => {
    await runIndexer(p1Root, { quiet: true });
    // An unrelated grammar landed (`.rb` appears in the stored map diff):
    // rust files keep the same ext→grammar entry and the same artifact
    // hash, so nothing about them is stale.
    await mutateStoredGrammarState((state) => {
      delete state.map[".java"];
      delete state.artifacts.java;
    });

    const second = await runIndexer(p1Root, { quiet: true });
    expect(second.filesAdded).toBe(0);
    expect(second.filesUpdated).toBe(0);
    expect(second.filesReprocessedGrammar).toBe(0);
    expect(second.symbolsAdded).toBe(0);
  });

  it("grammar VERSION BUMP: re-parses files WITH symbols, identical hashes stay silent", async () => {
    await runIndexer(p1Root, { quiet: true });
    // A tree-sitter upgrade leaves the ext→grammar map untouched; only the
    // .wasm identity moves. Simulate by corrupting the stored rust hash.
    await mutateStoredGrammarState((state) => {
      state.artifacts.rust = "0".repeat(64);
    });

    const second = await runIndexer(p1Root, { quiet: true });
    expect(second.filesAdded).toBe(0);
    expect(second.filesUpdated).toBe(0);
    expect(second.filesReprocessedGrammar).toBe(3);
    // Same grammar here ⇒ identical slices ⇒ identical hashes: nothing is
    // "added" and no phantom debt appears.
    expect(second.symbolsAdded).toBe(0);
    expect(second.symbolsDeleted).toBe(0);

    const report = await runStatus(p1Root);
    expect(report.debt.total).toBe(0);
  });

  it("grammar REMAP: an extension moving grammars re-parses even with symbols", async () => {
    await runIndexer(p1Root, { quiet: true });
    // `.rs` was previously parsed by a DIFFERENT grammar.
    await mutateStoredGrammarState((state) => {
      state.map[".rs"] = "python";
    });

    const second = await runIndexer(p1Root, { quiet: true });
    expect(second.filesAdded).toBe(0);
    expect(second.filesUpdated).toBe(0);
    expect(second.filesReprocessedGrammar).toBe(3);
    expect(second.symbolsAdded).toBe(0);
  });

  it("writes the current grammar state into meta", async () => {
    await runIndexer(p1Root, { quiet: true });
    const { grammarState } = await import("./parser.js");
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(dbPath(), { readonly: true });
    try {
      const row = db
        .prepare("SELECT value FROM meta WHERE key = 'grammar_state'")
        .get() as { value: string };
      expect(JSON.parse(row.value)).toEqual(grammarState());
    } finally {
      db.close();
    }
  });
});
