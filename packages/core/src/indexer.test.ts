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
    expect(report.meta.schemaVersion).toBe(8);
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

// === Etapa 2b: rationale persistence ===

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
