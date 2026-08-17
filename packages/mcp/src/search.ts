/**
 * search — full-text indexing and search via SQLite FTS5.
 *
 * SPEC §"MCP tools" (Phase 4): livewiki_search uses SQLite FTS5 for full-text
 * search over the wiki.
 *
 * Design decision: a separate `.livewiki/search.db` database instead of a virtual
 * table in `.livewiki/index.db`. Reasons:
 *   1. `.livewiki/index.db` is already at schema v4 with careful migrations.
 *      Adding an FTS5 virtual table would be schema v5 + a migration function.
 *   2. search.db is rebuildable from the wiki (source of truth) — if it
 *      corrupts, `livewiki_search` reindexes and carries on.
 *   3. Keeps `core` free of an FTS5 dependency — only the MCP server needs it.
 *
 * Tokenizer: FTS5 default (unicode61 — no `tokenize=` option is set, so
 * tokens are matched whole, without stemming). The tokenizer treats
 * `resolveDebt` / `ValidationError` / `resolve_debt` as ONE opaque token,
 * so the index uses TWO tables:
 *   - `wiki_search`: the original page text (default-tokenizer semantics
 *     unchanged; snippets always come from here, so readers see the real
 *     text);
 *   - `wiki_search_tokens`: the same text run through `splitIdentifiers`
 *     (camelCase/PascalCase split at lower→upper boundaries and acronym
 *     runs, snake_case split on `_`), keeping the original token alongside
 *     its parts — match-only, never displayed.
 * `search()` queries both (raw query on `wiki_search`, split query on
 * `wiki_search_tokens`) and merges: original-table hits first, then unique
 * extras from the tokens table, deduped by wiki_path. search.db is rebuilt
 * on startup, so the second table needs no migration — old files upgrade
 * in place via CREATE IF NOT EXISTS + full reindex.
 *
 * Indexing strategy: full rebuild on every startup (fast —
 * a 1000-page repo indexes in <1s). Idempotent. After startup,
 * write_doc updates incrementally via indexPage.
 */

import Database from "better-sqlite3";
import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";
import * as safeIo from "@livewiki/core/safe-io";

const SEARCH_DB_REL = ".livewiki/search.db";

/** Identifier runs: start with a letter, then letters/digits/underscore. */
const IDENTIFIER_RE = /[A-Za-z][A-Za-z0-9_]*/g;

export interface SearchHit {
  wikiPath: string;
  /** Relevant excerpt of the content (snippet around the match) */
  snippet: string;
}

export interface SearchOptions {
  /** Result limit (default 20) */
  limit?: number;
}

export interface SearchIndex {
  db: Database.Database;
}

/**
 * Splits identifier runs into their component words, keeping the ORIGINAL
 * token alongside its parts so both the compound and the individual words
 * match. Pure function — same input, same output.
 *
 * Rules:
 *   - camelCase/PascalCase: split at lower→upper boundaries and at acronym
 *     runs (`resolveDebt` → `resolveDebt resolve Debt`;
 *     `HTTPServerError` → `HTTPServerError HTTP Server Error`);
 *   - snake_case: split on `_` (`resolve_debt` → `resolve_debt resolve debt`);
 *   - kebab-case: no-op (FTS5 already splits on `-`);
 *   - only identifier runs `[A-Za-z][A-Za-z0-9_]*` are touched — plain
 *     words and prose pass through unchanged.
 */
export function splitIdentifiers(text: string): string {
  return text.replace(IDENTIFIER_RE, (token) => {
    const parts: string[] = [];
    for (const segment of token.split("_")) {
      if (segment.length === 0) continue; // leading/trailing/double `_`
      const split = segment
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2") // lower→upper boundary
        .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2"); // acronym-run boundary
      parts.push(...split.split(" "));
    }
    // Single-part tokens are plain words — prose passes through untouched.
    if (parts.length <= 1) return token;
    return `${token} ${parts.join(" ")}`;
  });
}

/**
 * Opens (or creates) the FTS5 index at `.livewiki/search.db` and reindexes all
 * wiki pages. Returns a handle with the db open.
 *
 * Does NOT validate the path — the caller (server.ts) already went through safe-io.
 */
export async function openAndIndex(
  repoRoot: string,
): Promise<SearchIndex> {
  const absRoot = nodePath.resolve(repoRoot);
  const dbPath = await safeIo.resolveAndValidate(absRoot, SEARCH_DB_REL);
  // Ensures .livewiki/ exists
  await safeIo.mkdir(absRoot, ".livewiki");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS wiki_search USING fts5(
      wiki_path UNINDEXED,
      content
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS wiki_search_tokens USING fts5(
      wiki_path UNINDEXED,
      content
    );
  `);
  await reindexAll(db, absRoot);
  return { db };
}

/**
 * Reindexes all markdown pages from `livewiki/` into the FTS5 index.
 * Idempotent — clears the index first to avoid orphan pages.
 *
 * Dual insert: original text into `wiki_search`, split form into
 * `wiki_search_tokens` (same transaction).
 */
async function reindexAll(db: Database.Database, absRoot: string): Promise<void> {
  db.exec("DELETE FROM wiki_search");
  db.exec("DELETE FROM wiki_search_tokens");
  const wikiDir = nodePath.join(absRoot, "livewiki");
  const pages = await collectMarkdownFiles(wikiDir);
  const insert = db.prepare(
    "INSERT INTO wiki_search (wiki_path, content) VALUES (?, ?)",
  );
  const insertTokens = db.prepare(
    "INSERT INTO wiki_search_tokens (wiki_path, content) VALUES (?, ?)",
  );
  const tx = db.transaction((entries: Array<{ path: string; content: string }>) => {
    for (const e of entries) {
      insert.run(e.path, e.content);
      insertTokens.run(e.path, splitIdentifiers(e.content));
    }
  });
  const entries: Array<{ path: string; content: string }> = [];
  for (const absPath of pages) {
    const relPath = nodePath.relative(absRoot, absPath).replace(/\\/g, "/");
    try {
      const content = await nodeFs.readFile(absPath, "utf8");
      entries.push({ path: relPath, content });
    } catch {
      // skip unreadable
    }
  }
  tx(entries);
}

async function collectMarkdownFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(d: string): Promise<void> {
    let entries;
    try {
      entries = await nodeFs.readdir(d, { withFileTypes: true });
    } catch {
      return; // dir doesn't exist — empty wiki
    }
    for (const e of entries) {
      const p = nodePath.join(d, e.name);
      if (e.isDirectory()) {
        await walk(p);
      } else if (e.isFile() && e.name.endsWith(".md")) {
        out.push(p);
      }
    }
  }
  await walk(dir);
  return out;
}

/**
 * Full rebuild of the FTS5 index from the wiki on disk — the same
 * idempotent, sub-second pass the startup rebuild uses. Exposed for the
 * server watcher (backlog #3): after each debounced sync batch the search
 * index is rebuilt wholesale instead of tracking per-page diffs.
 */
export async function reindexAllPages(idx: SearchIndex, repoRoot: string): Promise<void> {
  await reindexAll(idx.db, nodePath.resolve(repoRoot));
}

/**
 * Indexes (or updates) a single page. Called by write_doc.
 *
 * Both tables are updated in a single transaction: original text into
 * `wiki_search`, split form into `wiki_search_tokens`.
 */
export function indexPage(idx: SearchIndex, wikiPath: string, content: string): void {
  // FTS5 has no native UPSERT — uses DELETE + INSERT in a transaction.
  const tx = idx.db.transaction(() => {
    idx.db.prepare("DELETE FROM wiki_search WHERE wiki_path = ?").run(wikiPath);
    idx.db.prepare("DELETE FROM wiki_search_tokens WHERE wiki_path = ?").run(wikiPath);
    idx.db.prepare("INSERT INTO wiki_search (wiki_path, content) VALUES (?, ?)").run(
      wikiPath,
      content,
    );
    idx.db
      .prepare("INSERT INTO wiki_search_tokens (wiki_path, content) VALUES (?, ?)")
      .run(wikiPath, splitIdentifiers(content));
  });
  tx();
}

/**
 * Removes a page from the index. Idempotent.
 */
export function removePage(idx: SearchIndex, wikiPath: string): void {
  idx.db.prepare("DELETE FROM wiki_search WHERE wiki_path = ?").run(wikiPath);
  idx.db.prepare("DELETE FROM wiki_search_tokens WHERE wiki_path = ?").run(wikiPath);
}

/** Extracts the individual searchable words of a query (identifiers split). */
function queryTerms(query: string): string[] {
  const terms: string[] = [];
  for (const m of query.matchAll(IDENTIFIER_RE)) {
    for (const piece of splitIdentifiers(m[0]).split(" ")) {
      terms.push(piece.toLowerCase());
    }
  }
  return terms;
}

/**
 * Builds a snippet around the first occurrence of any query term in the
 * ORIGINAL page content (same `<<`/`>>` markers as the FTS5 snippet). Used
 * for hits that only matched the split tokens table, where the raw FTS5
 * snippet cannot highlight the compound identifier.
 */
function snippetAround(content: string, terms: string[]): string {
  const lower = content.toLowerCase();
  let pos = -1;
  let termLen = 0;
  for (const t of terms) {
    const i = lower.indexOf(t);
    if (i >= 0 && (pos < 0 || i < pos)) {
      pos = i;
      termLen = t.length;
    }
  }
  if (pos < 0) {
    const head = content.slice(0, 160).trimEnd();
    return content.length > 160 ? `${head}...` : head;
  }
  const start = Math.max(0, pos - 80);
  const end = Math.min(content.length, pos + termLen + 80);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < content.length ? "..." : "";
  return `${prefix}${content.slice(start, pos)}<<${content.slice(pos, pos + termLen)}>>${content.slice(pos + termLen, end)}${suffix}`;
}

/**
 * Full-text search. The query is an FTS5 expression (supports the `term*` prefix, AND/OR,
 * `"exact phrase"` phrases). Default limit 20.
 *
 * Two-table merge: hits from `wiki_search` (raw query, porter semantics
 * unchanged) come first, ordered by rank; then unique extras from
 * `wiki_search_tokens` (query run through `splitIdentifiers`), also by
 * rank, deduped by wiki_path, up to the limit. Snippets ALWAYS come from
 * `wiki_search` (original text) — the split content is match-only.
 *
 * Returns an array of hits with a snippet (excerpt around the first match).
 */
export function search(
  idx: SearchIndex,
  query: string,
  opts: SearchOptions = {},
): SearchHit[] {
  const limit = opts.limit ?? 20;
  // Sanitizes the query: FTS5 syntax errors break the query. Catches and returns [].
  // Covers both the raw and the split query.
  try {
    const rows = idx.db
      .prepare(
        `SELECT wiki_path, snippet(wiki_search, 1, '<<', '>>', '...', 32) as snip
         FROM wiki_search
         WHERE wiki_search MATCH ?
         ORDER BY rank
         LIMIT ?`,
      )
      .all(query, limit) as Array<{ wiki_path: string; snip: string }>;
    const hits = rows.map((r) => ({ wikiPath: r.wiki_path, snippet: r.snip }));
    if (hits.length >= limit) return hits;
    const seen = new Set(hits.map((h) => h.wikiPath));
    const extraRows = idx.db
      .prepare(
        `SELECT wiki_path
         FROM wiki_search_tokens
         WHERE wiki_search_tokens MATCH ?
         ORDER BY rank
         LIMIT ?`,
      )
      .all(splitIdentifiers(query), limit) as Array<{ wiki_path: string }>;
    const terms = queryTerms(query);
    for (const row of extraRows) {
      if (hits.length >= limit) break;
      if (seen.has(row.wiki_path)) continue;
      seen.add(row.wiki_path);
      const original = idx.db
        .prepare("SELECT content FROM wiki_search WHERE wiki_path = ?")
        .get(row.wiki_path) as { content: string } | undefined;
      hits.push({
        wikiPath: row.wiki_path,
        snippet: snippetAround(original?.content ?? "", terms),
      });
    }
    return hits;
  } catch {
    return [];
  }
}

/**
 * Closes the index. The caller is responsible for calling this on shutdown.
 */
export function close(idx: SearchIndex): void {
  idx.db.close();
}
