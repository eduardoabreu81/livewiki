import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as nodePath from "node:path";
import * as nodeOs from "node:os";
import * as nodeFs from "node:fs/promises";
import { run as runIndexer } from "./indexer.js";
import { run as runStatus } from "./status.js";

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
    expect(report.meta.schemaVersion).toBe(5);
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
        .prepare("SELECT caller_key, callee_name, line FROM calls WHERE caller_key = ?")
        .all("src/calls-demo.ts#outer") as Array<{ caller_key: string; callee_name: string; line: number }>;
      expect(rows).toEqual([{ caller_key: "src/calls-demo.ts#outer", callee_name: "helper", line: 1 }]);
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
      nodePath.join(repoRoot, "main.go"),
      "package main\n\nfunc main() {}\n",
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
        .prepare("SELECT id, lang FROM files WHERE path = 'main.go' AND status = 'active'")
        .get() as { id: number; lang: string } | undefined;
      expect(row?.lang).toBe("go");
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
    await nodeFs.writeFile(nodePath.join(repoRoot, "main.go"), "package main\n");
    await runIndexer(repoRoot, { quiet: true });
    const r2 = await runIndexer(repoRoot, { quiet: true });
    expect(r2.filesAdded).toBe(0);
    expect(r2.filesUpdated).toBe(0);
    expect(r2.filesUnchanged).toBe(3); // auth.ts + calc.py + main.go
  });

  it("status classifies each language by coverage tier", async () => {
    await nodeFs.writeFile(nodePath.join(repoRoot, "main.go"), "package main\n");
    await runIndexer(repoRoot, { quiet: true });
    const report = await runStatus(repoRoot);
    expect(report.files.tiers.typescript).toBe("anchored");
    expect(report.files.tiers.python).toBe("anchored");
    expect(report.files.tiers.go).toBe("prose");
  });
});
