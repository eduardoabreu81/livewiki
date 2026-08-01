import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as nodePath from "node:path";
import * as nodeOs from "node:os";
import * as nodeFs from "node:fs/promises";
import { openIndex } from "./db.js";
import { computeBlastRadius } from "./blast-radius.js";

let dbPath: string;
let db: ReturnType<typeof openIndex>;

beforeEach(async () => {
  const dir = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "livewiki-blast-radius-"));
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

/** caller_key --calls--> resolved_callee_key (already-resolved edge). */
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

function insertPage(wikiPath: string): number {
  const res = db
    .prepare("INSERT INTO doc_pages (wiki_path, owner, content_hash, updated_at) VALUES (?, 'generated', 'h', 1)")
    .run(wikiPath);
  return Number(res.lastInsertRowid);
}

function insertAnchor(docPageId: number, symbolKey: string): void {
  db.prepare(
    "INSERT INTO anchors (doc_page_id, section_slug, symbol_key, symbol_hash_at_doc, in_manual_block, created_at) " +
      "VALUES (?, 'reference', ?, 'h', 0, 1)",
  ).run(docPageId, symbolKey);
}

describe("computeBlastRadius", () => {
  it("finds a direct caller and no transitive callers", () => {
    const fileId = insertFile("a.ts");
    insertResolvedCall(fileId, "a.ts#outer", "a.ts#target");

    const result = computeBlastRadius(db, "a.ts#target");
    expect(result.directCallers).toEqual(["a.ts#outer"]);
    expect(result.transitiveCallers).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it("walks transitive callers across a chain", () => {
    const fileId = insertFile("a.ts");
    insertResolvedCall(fileId, "a.ts#level1", "a.ts#target");
    insertResolvedCall(fileId, "a.ts#level2", "a.ts#level1");
    insertResolvedCall(fileId, "a.ts#level3", "a.ts#level2");

    const result = computeBlastRadius(db, "a.ts#target");
    expect(result.directCallers).toEqual(["a.ts#level1"]);
    expect(result.transitiveCallers).toEqual(["a.ts#level2", "a.ts#level3"]);
    expect(result.truncated).toBe(false);
  });

  it("does not walk an unresolved call edge", () => {
    const fileId = insertFile("a.ts");
    db.prepare(
      "INSERT INTO calls (file_id, caller_key, callee_name, line) VALUES (?, 'a.ts#outer', 'target', 1)",
    ).run(fileId);

    const result = computeBlastRadius(db, "a.ts#target");
    expect(result.directCallers).toEqual([]);
  });

  it("de-duplicates a caller reached through two different paths", () => {
    const fileId = insertFile("a.ts");
    insertResolvedCall(fileId, "a.ts#left", "a.ts#target");
    insertResolvedCall(fileId, "a.ts#right", "a.ts#target");
    insertResolvedCall(fileId, "a.ts#top", "a.ts#left");
    insertResolvedCall(fileId, "a.ts#top", "a.ts#right");

    const result = computeBlastRadius(db, "a.ts#target");
    expect(result.directCallers.sort()).toEqual(["a.ts#left", "a.ts#right"]);
    expect(result.transitiveCallers).toEqual(["a.ts#top"]);
  });

  it("stops at maxDepth and reports truncated", () => {
    const fileId = insertFile("a.ts");
    insertResolvedCall(fileId, "a.ts#l1", "a.ts#target");
    insertResolvedCall(fileId, "a.ts#l2", "a.ts#l1");
    insertResolvedCall(fileId, "a.ts#l3", "a.ts#l2");

    const result = computeBlastRadius(db, "a.ts#target", { maxDepth: 1 });
    expect(result.directCallers).toEqual(["a.ts#l1"]);
    expect(result.transitiveCallers).toEqual([]);
    expect(result.truncated).toBe(true);
  });

  it("stops at maxNodes and reports truncated", () => {
    const fileId = insertFile("a.ts");
    for (let i = 0; i < 10; i++) {
      insertResolvedCall(fileId, `a.ts#caller${i}`, "a.ts#target");
    }

    const result = computeBlastRadius(db, "a.ts#target", { maxNodes: 3 });
    expect(result.directCallers.length).toBeLessThanOrEqual(4);
    expect(result.truncated).toBe(true);
  });

  it("reports no truncation when the graph is fully exhausted before any bound", () => {
    const fileId = insertFile("a.ts");
    insertResolvedCall(fileId, "a.ts#only", "a.ts#target");

    const result = computeBlastRadius(db, "a.ts#target", { maxDepth: 10, maxNodes: 100 });
    expect(result.truncated).toBe(false);
  });

  it("finds pages that cite the target symbol or any of its callers", () => {
    const fileId = insertFile("a.ts");
    insertResolvedCall(fileId, "a.ts#outer", "a.ts#target");
    const page1 = insertPage("livewiki/module-a.md");
    const page2 = insertPage("livewiki/module-b.md");
    insertAnchor(page1, "a.ts#target");
    insertAnchor(page2, "a.ts#outer");
    insertAnchor(page2, "a.ts#unrelated");

    const result = computeBlastRadius(db, "a.ts#target");
    const byPath = new Map(result.affectedPages.map((p) => [p.wikiPath, p.citedSymbolKeys]));
    expect(byPath.get("livewiki/module-a.md")).toEqual(["a.ts#target"]);
    expect(byPath.get("livewiki/module-b.md")).toEqual(["a.ts#outer"]);
  });

  it("returns no affected pages when nothing cites the symbol or its callers", () => {
    const fileId = insertFile("a.ts");
    insertResolvedCall(fileId, "a.ts#outer", "a.ts#target");

    const result = computeBlastRadius(db, "a.ts#target");
    expect(result.affectedPages).toEqual([]);
  });

  it("exposes each caller's edge confidence additively (extracted vs inferred)", () => {
    const fileId = insertFile("a.ts");
    insertResolvedCall(fileId, "a.ts#direct", "a.ts#target", "extracted");
    insertResolvedCall(fileId, "a.ts#guessed", "a.ts#target", "inferred");
    insertResolvedCall(fileId, "a.ts#top", "a.ts#direct", "inferred");

    const result = computeBlastRadius(db, "a.ts#target");
    expect(result.callerConfidence).toEqual({
      "a.ts#direct": "extracted",
      "a.ts#guessed": "inferred",
      "a.ts#top": "inferred",
    });
  });

  it("reports 'extracted' when a caller has both edge kinds into the same callee", () => {
    const fileId = insertFile("a.ts");
    insertResolvedCall(fileId, "a.ts#outer", "a.ts#target", "inferred");
    insertResolvedCall(fileId, "a.ts#outer", "a.ts#target", "extracted");

    const result = computeBlastRadius(db, "a.ts#target");
    expect(result.directCallers).toEqual(["a.ts#outer"]);
    expect(result.callerConfidence["a.ts#outer"]).toBe("extracted");
  });
});
