/**
 * search — identifier-aware FTS5 (two-table design).
 *
 * Covers:
 *   - splitIdentifiers split rules (camelCase, PascalCase, acronym runs,
 *     snake_case, kebab no-op, prose untouched, original token preserved);
 *   - end-to-end acceptance (backlog item 1): a page containing
 *     `resolveDebt` is returned for query `resolve debt`; a page containing
 *     `ValidationError` is returned for `validation`;
 *   - snippets always show the ORIGINAL text;
 *   - merge semantics: original-table hits first, extras deduped by
 *     wiki_path, limit preserved;
 *   - old search.db files upgrade in place (second table is IF NOT EXISTS).
 *
 * Windows file locking: close the index before the recursive rm in
 * afterEach (WAL files would otherwise EBUSY).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as nodePath from "node:path";
import * as nodeFs from "node:fs/promises";
import * as nodeOs from "node:os";
import Database from "better-sqlite3";
import {
  splitIdentifiers,
  openAndIndex,
  indexPage,
  removePage,
  search,
  close,
  type SearchIndex,
} from "./search.js";

let repoRoot: string;
let idx: SearchIndex | null = null;

beforeEach(async () => {
  repoRoot = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "livewiki-search-"));
});

afterEach(async () => {
  if (idx) {
    close(idx);
    idx = null;
  }
  await nodeFs.rm(repoRoot, { recursive: true, force: true });
});

async function writePage(relPath: string, content: string): Promise<void> {
  const abs = nodePath.join(repoRoot, relPath);
  await nodeFs.mkdir(nodePath.dirname(abs), { recursive: true });
  await nodeFs.writeFile(abs, content);
}

describe("splitIdentifiers", () => {
  it("splits camelCase at lower→upper boundaries, keeping the original", () => {
    expect(splitIdentifiers("resolveDebt")).toBe("resolveDebt resolve Debt");
  });

  it("splits PascalCase", () => {
    expect(splitIdentifiers("ValidationError")).toBe("ValidationError Validation Error");
  });

  it("splits acronym runs before a capitalized word", () => {
    expect(splitIdentifiers("HTTPServerError")).toBe("HTTPServerError HTTP Server Error");
  });

  it("splits snake_case on underscores", () => {
    expect(splitIdentifiers("resolve_debt")).toBe("resolve_debt resolve debt");
  });

  it("leaves kebab-case untouched (FTS5 already splits hyphens)", () => {
    expect(splitIdentifiers("some-thing")).toBe("some-thing");
  });

  it("leaves plain words untouched", () => {
    expect(splitIdentifiers("validation")).toBe("validation");
  });

  it("leaves prose untouched", () => {
    const prose = "The quick brown fox jumps over 13 lazy dogs.";
    expect(splitIdentifiers(prose)).toBe(prose);
  });

  it("keeps the original token alongside its parts inside prose", () => {
    expect(splitIdentifiers("Call resolveDebt carefully.")).toBe(
      "Call resolveDebt resolve Debt carefully.",
    );
  });

  it("handles mixed snake + camel identifiers", () => {
    expect(splitIdentifiers("validate_configForBatch")).toBe(
      "validate_configForBatch validate config For Batch",
    );
  });
});

describe("search — identifier-aware two-table FTS5", () => {
  async function indexFixture(): Promise<SearchIndex> {
    await writePage(
      "livewiki/debts.md",
      "---\ntitle: Debts\n---\n# Debts\n\nThe resolveDebt function closes an open debt by id.\n",
    );
    await writePage(
      "livewiki/anchors.md",
      "---\ntitle: Anchors\n---\n# Anchors\n\nA ValidationError is raised when an anchor fails verification.\n",
    );
    await writePage(
      "livewiki/flow.md",
      "---\ntitle: Flow\n---\n# Flow\n\nThe runner keeps running until the queue is empty.\n",
    );
    idx = await openAndIndex(repoRoot);
    return idx;
  }

  it("finds a page containing `resolveDebt` for query `resolve debt`", async () => {
    const i = await indexFixture();
    const hits = search(i, "resolve debt");
    expect(hits.map((h) => h.wikiPath)).toContain("livewiki/debts.md");
  });

  it("finds a page containing `ValidationError` for query `validation`", async () => {
    const i = await indexFixture();
    const hits = search(i, "validation");
    expect(hits.map((h) => h.wikiPath)).toContain("livewiki/anchors.md");
  });

  it("snippet shows the ORIGINAL text (compound identifier), not the split form", async () => {
    const i = await indexFixture();
    const hits = search(i, "resolve debt");
    const hit = hits.find((h) => h.wikiPath === "livewiki/debts.md");
    expect(hit).toBeDefined();
    expect(hit!.snippet).toContain("resolveDebt");
    expect(hit!.snippet).toContain("<<");
  });

  it("compound query still matches via the preserved original token", async () => {
    const i = await indexFixture();
    const hits = search(i, "resolveDebt");
    expect(hits.map((h) => h.wikiPath)).toContain("livewiki/debts.md");
  });

  it("raw-table matching on original text is unchanged", async () => {
    const i = await indexFixture();
    // Plain prose word matched by the raw query on wiki_search, exactly as
    // before the two-table change.
    const hits = search(i, "queue");
    expect(hits.map((h) => h.wikiPath)).toContain("livewiki/flow.md");
    expect(hits[0]?.snippet).toContain("queue");
  });

  it("dedupes by wiki_path when a page matches BOTH tables", async () => {
    await writePage(
      "livewiki/both.md",
      "# Both\n\nThe validation step raises a ValidationError on bad input.\n",
    );
    idx = await openAndIndex(repoRoot);
    const hits = search(idx, "validation");
    const paths = hits.map((h) => h.wikiPath);
    expect(paths.filter((p) => p === "livewiki/both.md")).toHaveLength(1);
    // Original-table hit comes first, so the FTS5 snippet is used.
    expect(hits[0]?.wikiPath).toBe("livewiki/both.md");
  });

  it("preserves the limit across the merged result set", async () => {
    const i = await indexFixture();
    const hits = search(i, "validation", { limit: 1 });
    expect(hits).toHaveLength(1);
  });

  it("returns [] on FTS5 syntax errors (covers both queries)", async () => {
    const i = await indexFixture();
    expect(search(i, '"unclosed phrase')).toEqual([]);
  });

  it("keeps FTS5 phrase syntax working", async () => {
    const i = await indexFixture();
    const hits = search(i, '"open debt"');
    expect(hits.map((h) => h.wikiPath)).toContain("livewiki/debts.md");
  });

  it("indexPage updates both tables (incremental write_doc path)", async () => {
    const i = await indexFixture();
    indexPage(i, "livewiki/new.md", "# New\n\nThe parseConfigFile helper reads config.\n");
    const hits = search(i, "config file");
    expect(hits.map((h) => h.wikiPath)).toContain("livewiki/new.md");
  });

  it("removePage removes the page from both tables", async () => {
    const i = await indexFixture();
    removePage(i, "livewiki/debts.md");
    expect(search(i, "resolve debt").map((h) => h.wikiPath)).not.toContain(
      "livewiki/debts.md",
    );
    expect(search(i, "resolveDebt").map((h) => h.wikiPath)).not.toContain(
      "livewiki/debts.md",
    );
  });

  it("upgrades an old search.db in place (second table is IF NOT EXISTS)", async () => {
    // Simulate a pre-two-table search.db: only wiki_search exists.
    await nodeFs.mkdir(nodePath.join(repoRoot, ".livewiki"), { recursive: true });
    const legacy = new Database(nodePath.join(repoRoot, ".livewiki/search.db"));
    legacy.exec(
      "CREATE VIRTUAL TABLE wiki_search USING fts5(wiki_path UNINDEXED, content)",
    );
    legacy.close();
    await writePage("livewiki/legacy.md", "# Legacy\n\nThe openDebtLedger call.\n");
    idx = await openAndIndex(repoRoot);
    const hits = search(idx, "debt ledger");
    expect(hits.map((h) => h.wikiPath)).toContain("livewiki/legacy.md");
  });
});
