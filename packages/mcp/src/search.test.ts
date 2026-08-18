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
  isFtsQueryError,
  SearchIndexUnavailableError,
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

/**
 * The catch around the FTS5 query used to swallow every exception and answer
 * `[]`, so a closed handle, a corrupt file, or a missing table reported the
 * same thing as a healthy wiki with no matches. These tests pin the split
 * between "your query was malformed" and "the index is broken".
 *
 * The error shapes asserted here were measured against better-sqlite3 12.x,
 * not assumed: every FTS5 query fault arrives as SQLITE_ERROR, and so does
 * `no such table` — which is why the classifier is an allowlist over the
 * message rather than a check on the code alone.
 */
describe("search — SQLite failures are not empty results", () => {
  async function fixture(): Promise<SearchIndex> {
    await writePage(
      "livewiki/a.md",
      "---\ntitle: A\n---\n# A\n\nThe alpha token lives here with beta and gamma.\n",
    );
    idx = await openAndIndex(repoRoot);
    return idx;
  }

  it("a valid search is unchanged", async () => {
    const i = await fixture();
    const hits = search(i, "alpha");
    expect(hits.map((h) => h.wikiPath)).toEqual(["livewiki/a.md"]);
    expect(hits[0]?.snippet).toContain("alpha");
  });

  // Every one of these is a real FTS5 parse failure, not a hypothetical.
  it.each([
    ['unbalanced quote', '"'],
    ["bare operator", "AND"],
    ["trailing operator", "alpha OR"],
    ["unbalanced paren", "(alpha"],
    ["empty expression", ""],
    ["stray punctuation", "***"],
    ["unknown column filter", "nope:alpha"],
    ["malformed NEAR", "NEAR("],
    ["non-numeric NEAR arg", "NEAR(alpha beta, x)"],
    ["bare caret", "^"],
    ["leading minus", "-alpha"],
  ])("a malformed query (%s) still degrades to an empty result", async (_label, query) => {
    const i = await fixture();
    expect(search(i, query)).toEqual([]);
  });

  it("throws instead of returning [] when the database handle is closed", async () => {
    const i = await fixture();
    close(i);
    idx = null; // afterEach must not double-close

    expect(() => search(i, "alpha")).toThrow(SearchIndexUnavailableError);
    // The distinction that matters: NOT an empty array.
    let result: unknown = "not-called";
    try {
      result = search(i, "alpha");
    } catch (err) {
      result = err;
    }
    expect(result).not.toEqual([]);
    expect((result as Error).message).toMatch(/search index is unavailable/i);
  });

  it("throws when the FTS table is gone (index reshaped underneath us)", async () => {
    const i = await fixture();
    i.db.exec("DROP TABLE wiki_search");

    expect(() => search(i, "alpha")).toThrow(SearchIndexUnavailableError);
  });

  it("throws when our own column is missing, despite the message looking like a bad query", async () => {
    const i = await fixture();
    // "no such column: wiki_path" is byte-identical in shape to the message a
    // user query like `-alpha` produces. Only the name tells them apart.
    i.db.exec("DROP TABLE wiki_search");
    i.db.exec("CREATE VIRTUAL TABLE wiki_search USING fts5(other_col, content)");

    expect(() => search(i, "alpha")).toThrow(SearchIndexUnavailableError);
  });

  it("throws on a corrupt database file", async () => {
    const dir = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "livewiki-corrupt-"));
    const file = nodePath.join(dir, "corrupt.db");
    try {
      const seed = new Database(file);
      seed.exec("CREATE VIRTUAL TABLE wiki_search USING fts5(wiki_path, content)");
      seed.exec("CREATE VIRTUAL TABLE wiki_search_tokens USING fts5(wiki_path, content)");
      seed.prepare("INSERT INTO wiki_search (wiki_path, content) VALUES (?, ?)")
        .run("livewiki/a.md", "alpha");
      seed.close();

      const raw = await nodeFs.readFile(file);
      raw.fill(0x41, 0, 64); // shred the SQLite header
      await nodeFs.writeFile(file, raw);

      const broken = new Database(file);
      try {
        expect(() => search({ db: broken } as SearchIndex, "alpha"))
          .toThrow(SearchIndexUnavailableError);
      } finally {
        broken.close();
      }
    } finally {
      await nodeFs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("preserves the underlying error as the cause, so the real fault is reportable", async () => {
    const i = await fixture();
    i.db.exec("DROP TABLE wiki_search");

    try {
      search(i, "alpha");
      expect.unreachable("search should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(SearchIndexUnavailableError);
      expect((err as Error).message).toMatch(/no such table/i);
      expect((err as { cause?: unknown }).cause).toBeInstanceOf(Error);
    }
  });
});

describe("isFtsQueryError — classification is an allowlist", () => {
  function sqliteError(message: string, code = "SQLITE_ERROR"): Error {
    const err = new Error(message);
    (err as unknown as { code: string }).code = code;
    return err;
  }

  it.each([
    'fts5: syntax error near "AND"',
    "unterminated string",
    "unknown special query: bogus*",
    'expected integer, got "x"',
    "no such column: alpha",
  ])("treats %s as a query fault", (message) => {
    expect(isFtsQueryError(sqliteError(message))).toBe(true);
  });

  it.each([
    ["missing table", sqliteError("no such table: wiki_search")],
    ["our column missing", sqliteError("no such column: wiki_path")],
    ["our other column missing", sqliteError("no such column: content")],
    ["corrupt", sqliteError("database disk image is malformed", "SQLITE_CORRUPT")],
    ["not a database", sqliteError("file is not a database", "SQLITE_NOTADB")],
    ["closed handle (plain TypeError)", new TypeError("The database connection is not open")],
    ["disk I/O", sqliteError("disk I/O error", "SQLITE_IOERR")],
    ["unknown future shape", sqliteError("something nobody has seen yet")],
    ["not an Error at all", "a string" as unknown as Error],
  ])("treats %s as an index failure", (_label, err) => {
    expect(isFtsQueryError(err)).toBe(false);
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
