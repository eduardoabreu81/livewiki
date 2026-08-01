import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as nodePath from "node:path";
import * as nodeOs from "node:os";
import * as nodeFs from "node:fs/promises";
import { openIndex } from "./db.js";
import { resolveCalls, computeCrossModuleCallees, computeCallerCentrality } from "./call-resolution.js";

let dbPath: string;
let db: ReturnType<typeof openIndex>;

beforeEach(async () => {
  const dir = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "livewiki-call-resolution-"));
  dbPath = nodePath.join(dir, "index.db");
  db = openIndex(dbPath);
});

afterEach(async () => {
  db.close();
  await nodeFs.rm(nodePath.dirname(dbPath), { recursive: true, force: true });
});

function insertFile(path: string): number {
  const res = db
    .prepare(
      "INSERT INTO files (path, lang, content_hash, size, mtime, indexed_at) VALUES (?, 'typescript', 'h', 1, 1, 1)",
    )
    .run(path);
  return Number(res.lastInsertRowid);
}

function insertSymbol(fileId: number, key: string, name: string, kind: string): void {
  db.prepare(
    "INSERT INTO symbols (file_id, key, name, kind, signature, start_line, end_line, content_hash, status) " +
      "VALUES (?, ?, ?, ?, NULL, 1, 1, 'h', 'active')",
  ).run(fileId, key, name, kind);
}

function insertCall(
  fileId: number,
  callerKey: string,
  calleeName: string,
  confidence: "extracted" | "inferred" = "inferred",
): number {
  const res = db
    .prepare("INSERT INTO calls (file_id, caller_key, callee_name, line, confidence) VALUES (?, ?, ?, 1, ?)")
    .run(fileId, callerKey, calleeName, confidence);
  return Number(res.lastInsertRowid);
}

function insertResolvedCall(
  fileId: number,
  callerKey: string,
  resolvedCalleeKey: string,
  confidence: "extracted" | "inferred" = "extracted",
): void {
  db.prepare(
    "INSERT INTO calls (file_id, caller_key, callee_name, resolved_callee_key, line, confidence) VALUES (?, ?, ?, ?, 1, ?)",
  ).run(fileId, callerKey, resolvedCalleeKey.split("#")[1] ?? resolvedCalleeKey, resolvedCalleeKey, confidence);
}

function resolvedKeyOf(callId: number): string | null {
  const row = db.prepare("SELECT resolved_callee_key FROM calls WHERE id = ?").get(callId) as
    | { resolved_callee_key: string | null }
    | undefined;
  return row?.resolved_callee_key ?? null;
}

function confidenceOf(callId: number): string | null {
  const row = db.prepare("SELECT confidence FROM calls WHERE id = ?").get(callId) as
    | { confidence: string }
    | undefined;
  return row?.confidence ?? null;
}

describe("resolveCalls", () => {
  it("resolves a same-file unique function match", () => {
    const fileId = insertFile("a.ts");
    insertSymbol(fileId, "a.ts#helper", "helper", "function");
    const callId = insertCall(fileId, "a.ts#outer", "helper");

    const result = resolveCalls(db);
    expect(result.resolved).toBe(1);
    expect(resolvedKeyOf(callId)).toBe("a.ts#helper");
  });

  it("resolves a cross-file globally-unique function match", () => {
    const callerFile = insertFile("a.ts");
    const targetFile = insertFile("b.ts");
    insertSymbol(targetFile, "b.ts#helper", "helper", "function");
    const callId = insertCall(callerFile, "a.ts#outer", "helper");

    const result = resolveCalls(db);
    expect(result.resolved).toBe(1);
    expect(resolvedKeyOf(callId)).toBe("b.ts#helper");
  });

  it("leaves a call unresolved when the name is ambiguous across files", () => {
    const callerFile = insertFile("a.ts");
    const targetFile1 = insertFile("b.ts");
    const targetFile2 = insertFile("c.ts");
    insertSymbol(targetFile1, "b.ts#helper", "helper", "function");
    insertSymbol(targetFile2, "c.ts#helper", "helper", "function");
    const callId = insertCall(callerFile, "a.ts#outer", "helper");

    const result = resolveCalls(db);
    expect(result.resolved).toBe(0);
    expect(resolvedKeyOf(callId)).toBeNull();
  });

  it("prefers the same-file match over an ambiguous global one", () => {
    const fileId = insertFile("a.ts");
    const otherFile = insertFile("b.ts");
    insertSymbol(fileId, "a.ts#helper", "helper", "function");
    insertSymbol(otherFile, "b.ts#helper", "helper", "function");
    const callId = insertCall(fileId, "a.ts#outer", "helper");

    const result = resolveCalls(db);
    expect(result.resolved).toBe(1);
    expect(resolvedKeyOf(callId)).toBe("a.ts#helper");
  });

  it("does not resolve a bare call to a qualified method name (out of v1 scope)", () => {
    const fileId = insertFile("a.ts");
    insertSymbol(fileId, "a.ts#Foo.helper", "Foo.helper", "method");
    const callId = insertCall(fileId, "a.ts#outer", "helper");

    const result = resolveCalls(db);
    expect(result.resolved).toBe(0);
    expect(resolvedKeyOf(callId)).toBeNull();
  });

  it("ignores an inactive (soft-deleted) symbol as a candidate", () => {
    const fileId = insertFile("a.ts");
    db.prepare(
      "INSERT INTO symbols (file_id, key, name, kind, signature, start_line, end_line, content_hash, status) " +
        "VALUES (?, 'a.ts#helper', 'helper', 'function', NULL, 1, 1, 'h', 'deleted')",
    ).run(fileId);
    const callId = insertCall(fileId, "a.ts#outer", "helper");

    const result = resolveCalls(db);
    expect(result.resolved).toBe(0);
    expect(resolvedKeyOf(callId)).toBeNull();
  });

  it("retroactively resolves a previously-unresolved call once a matching symbol exists", () => {
    const callerFile = insertFile("a.ts");
    const callId = insertCall(callerFile, "a.ts#outer", "helper");
    expect(resolveCalls(db).resolved).toBe(0);
    expect(resolvedKeyOf(callId)).toBeNull();

    const targetFile = insertFile("b.ts");
    insertSymbol(targetFile, "b.ts#helper", "helper", "function");

    const result = resolveCalls(db);
    expect(result.resolved).toBe(1);
    expect(resolvedKeyOf(callId)).toBe("b.ts#helper");
  });

  it("does not re-examine a call that already has a resolved_callee_key", () => {
    const fileId = insertFile("a.ts");
    insertSymbol(fileId, "a.ts#helper", "helper", "function");
    const callId = insertCall(fileId, "a.ts#outer", "helper");
    resolveCalls(db);
    expect(resolvedKeyOf(callId)).toBe("a.ts#helper");

    // Even if the symbol disappears, a second pass leaves the (now stale)
    // resolution untouched — only a fresh insert (NULL again) gets re-tried.
    db.prepare("UPDATE symbols SET status = 'deleted' WHERE key = 'a.ts#helper'").run();
    const result = resolveCalls(db);
    expect(result.resolved).toBe(0);
    expect(resolvedKeyOf(callId)).toBe("a.ts#helper");
  });

  it("same-file resolution keeps the extracted extraction tag", () => {
    const fileId = insertFile("a.ts");
    insertSymbol(fileId, "a.ts#helper", "helper", "function");
    const callId = insertCall(fileId, "a.ts#outer", "helper", "extracted");

    const result = resolveCalls(db);
    expect(result.resolved).toBe(1);
    expect(resolvedKeyOf(callId)).toBe("a.ts#helper");
    expect(confidenceOf(callId)).toBe("extracted");
  });

  it("global-unique cross-file resolution keeps the extraction tag", () => {
    const callerFile = insertFile("a.ts");
    const targetFile = insertFile("b.ts");
    insertSymbol(targetFile, "b.ts#helper", "helper", "function");
    // A bare-identifier callee that is unique repo-wide is strong
    // cross-module evidence: resolution never changes the extraction tag.
    const callId = insertCall(callerFile, "a.ts#outer", "helper", "extracted");

    const result = resolveCalls(db);
    expect(result.resolved).toBe(1);
    expect(resolvedKeyOf(callId)).toBe("b.ts#helper");
    expect(confidenceOf(callId)).toBe("extracted");
  });
});

describe("computeCrossModuleCallees", () => {
  it("includes a callee whose caller lives in a different module", () => {
    const cliFile = insertFile("src/cli.ts");
    insertFile("src/db.ts");
    insertResolvedCall(cliFile, "src/cli.ts#run", "src/db.ts#open");

    const result = computeCrossModuleCallees(db, [
      { id: "cli", paths: ["src/cli.ts"] },
      { id: "db", paths: ["src/db.ts"] },
    ]);
    expect(result).toEqual(new Set(["src/db.ts#open"]));
  });

  it("excludes a same-module call", () => {
    const fileA = insertFile("src/a.ts");
    insertFile("src/b.ts");
    insertResolvedCall(fileA, "src/a.ts#outer", "src/a.ts#helper");

    const result = computeCrossModuleCallees(db, [
      { id: "mod", paths: ["src/a.ts", "src/b.ts"] },
    ]);
    expect(result).toEqual(new Set());
  });

  it("excludes an unresolved call (resolved_callee_key IS NULL)", () => {
    const cliFile = insertFile("src/cli.ts");
    insertFile("src/db.ts");
    insertCall(cliFile, "src/cli.ts#run", "open");

    const result = computeCrossModuleCallees(db, [
      { id: "cli", paths: ["src/cli.ts"] },
      { id: "db", paths: ["src/db.ts"] },
    ]);
    expect(result).toEqual(new Set());
  });

  it("excludes an inferred-confidence resolved call (member-access name guess)", () => {
    const cliFile = insertFile("src/cli.ts");
    insertFile("src/db.ts");
    insertResolvedCall(cliFile, "src/cli.ts#run", "src/db.ts#open", "inferred");

    const result = computeCrossModuleCallees(db, [
      { id: "cli", paths: ["src/cli.ts"] },
      { id: "db", paths: ["src/db.ts"] },
    ]);
    expect(result).toEqual(new Set());
  });

  it("excludes a call whose file is not part of any known module", () => {
    const cliFile = insertFile("src/cli.ts");
    insertResolvedCall(cliFile, "src/cli.ts#run", "src/untracked.ts#open");

    const result = computeCrossModuleCallees(db, [{ id: "cli", paths: ["src/cli.ts"] }]);
    expect(result).toEqual(new Set());
  });

  it("returns an empty set when there are no calls at all", () => {
    const result = computeCrossModuleCallees(db, [{ id: "cli", paths: ["src/cli.ts"] }]);
    expect(result).toEqual(new Set());
  });
});

describe("computeCallerCentrality", () => {
  it("counts distinct callers per resolved callee", () => {
    const cliFile = insertFile("src/cli.ts");
    const coreFile = insertFile("src/core.ts");
    insertFile("src/db.ts");
    insertResolvedCall(cliFile, "src/cli.ts#run", "src/db.ts#open");
    insertResolvedCall(coreFile, "src/core.ts#process", "src/db.ts#open");

    const result = computeCallerCentrality(db);
    expect(result.get("src/db.ts#open")).toBe(2);
  });

  it("counts a caller only once even if it calls the same callee on multiple lines", () => {
    const cliFile = insertFile("src/cli.ts");
    insertFile("src/db.ts");
    insertResolvedCall(cliFile, "src/cli.ts#run", "src/db.ts#open");
    insertResolvedCall(cliFile, "src/cli.ts#run", "src/db.ts#open");

    const result = computeCallerCentrality(db);
    expect(result.get("src/db.ts#open")).toBe(1);
  });

  it("excludes unresolved calls (resolved_callee_key IS NULL)", () => {
    const cliFile = insertFile("src/cli.ts");
    insertCall(cliFile, "src/cli.ts#run", "open");

    const result = computeCallerCentrality(db);
    expect(result.size).toBe(0);
  });

  it("excludes inferred-confidence callers (member-access noise cannot rank anchors)", () => {
    const cliFile = insertFile("src/cli.ts");
    const coreFile = insertFile("src/core.ts");
    insertFile("src/db.ts");
    insertResolvedCall(cliFile, "src/cli.ts#run", "src/db.ts#open", "extracted");
    insertResolvedCall(coreFile, "src/core.ts#process", "src/db.ts#open", "inferred");

    const result = computeCallerCentrality(db);
    expect(result.get("src/db.ts#open")).toBe(1);
  });

  it("returns an empty map when there are no calls at all", () => {
    expect(computeCallerCentrality(db)).toEqual(new Map());
  });

  it("a key absent from the map has implicit centrality zero (caller's responsibility to default)", () => {
    const cliFile = insertFile("src/cli.ts");
    insertFile("src/db.ts");
    insertResolvedCall(cliFile, "src/cli.ts#run", "src/db.ts#open");

    const result = computeCallerCentrality(db);
    expect(result.get("src/db.ts#neverCalled")).toBeUndefined();
    expect(result.get("src/db.ts#neverCalled") ?? 0).toBe(0);
  });
});
