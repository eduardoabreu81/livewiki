---
title: SQLite FTS5 full-text search index for wiki pages
owner: generated
anchors:
- packages/mcp/src/search.ts#SearchIndexUnavailableError
- packages/mcp/src/search.ts#SearchIndexUnavailableError.constructor
- packages/mcp/src/search.ts#close
- packages/mcp/src/search.ts#collectMarkdownFiles
- packages/mcp/src/search.ts#indexPage
- packages/mcp/src/search.ts#isFtsQueryError
- packages/mcp/src/search.ts#openAndIndex
- packages/mcp/src/search.ts#queryTerms
- packages/mcp/src/search.ts#reindexAll
- packages/mcp/src/search.ts#reindexAllPages
- packages/mcp/src/search.ts#removePage
- packages/mcp/src/search.ts#search
- packages/mcp/src/search.ts#snippetAround
- packages/mcp/src/search.ts#splitIdentifiers
- packages/mcp/src/search.ts#walk
---

# SQLite FTS5 full-text search index for wiki pages

This page documents how the livewiki search module builds and queries a full-text index over wiki content using SQLite FTS5.

## When to use this page

- Understand how `livewiki_search` indexes wiki pages and answers full-text queries.
- Learn why the index uses two FTS5 tables and how identifier splitting makes compound names searchable.
- Trace how malformed queries versus broken-index failures are distinguished and reported.
- See how the index is opened, rebuilt, incrementally updated, and closed over its lifecycle.

## How it fits

The `packages/mcp/src/search.ts` module implements the search capability exposed through the livewiki MCP (Model Context Protocol) server. It owns a separate `.livewiki/search.db` database rather than adding a virtual table to the main `.livewiki/index.db`, keeping core free of an FTS5 dependency and letting the search index be rebuilt wholesale from the wiki as source of truth. The module exposes open/index, incremental update, remove, rebuild, and query functions that the MCP server calls during startup, on page writes, and in response to search requests.

The module uses two FTS5 tables sharing identical schema: `wiki_search` stores original page text, while `wiki_search_tokens` stores the same text transformed by identifier splitting. Searches query both tables and merge results, so both whole compounds and their component words produce matches. Snippets always come from the original-text table so readers see real content.

## Diagram

```mermaid
%% livewiki/diagrams/mcp-src-search.mmd
```

## Index lifecycle and database setup

<!-- lw:anchors packages/mcp/src/search.ts#openAndIndex packages/mcp/src/search.ts#close packages/mcp/src/search.ts#reindexAll -->

`openAndIndex` starts the search subsystem by resolving the repository root to an absolute path, validating the `.livewiki/search.db` location through safe-io, and ensuring the `.livewiki` directory exists. It then opens a better-sqlite3 connection, enables WAL journaling, and creates both FTS5 virtual tables with `CREATE VIRTUAL TABLE IF NOT EXISTS`, so old databases upgrade in place because a full reindex immediately follows.

```
export async function openAndIndex(
  repoRoot: string,
): Promise<SearchIndex> {
```

The function takes a repository root path and returns an open index handle containing the database connection. After table creation it calls `reindexAll` to populate both tables from every wiki page, producing a fresh index on every startup.

`reindexAll` accepts an open database and absolute repository root, performing an idempotent full rebuild: it first deletes all rows from both FTS5 tables to avoid orphan pages, then discovers markdown files under the `livewiki` directory via `collectMarkdownFiles`, reads each file's content as UTF-8, and writes dual inserts — original text into `wiki_search`, split form into `wiki_search_tokens` — inside a single transaction. Unreadable files are skipped silently, preserving whatever the index already has from earlier runs.

The dual-insert transaction guarantees both tables stay consistent for every page; because the module rebuilds on startup, this code path is the primary ingestion mechanism. The transaction wraps prepared insert statements so the hundreds of page inserts commit atomically rather than row by row.

`close` releases the underlying database connection when the MCP server shuts down:

```
export function close(idx: SearchIndex): void {
```

It takes the index handle and closes its database, after which no further operations on that handle are valid.

## Markdown file discovery

<!-- lw:anchors packages/mcp/src/search.ts#collectMarkdownFiles packages/mcp/src/search.ts#walk -->

The file-discovery stage finds every `.md` file beneath the wiki directory so the index can be populated. `collectMarkdownFiles` is the outward-facing asynchronous function that accepts a directory path and returns a promise of an array of absolute markdown file paths.

```
async function collectMarkdownFiles(dir: string): Promise<string[]> {
```

It maintains an output array and delegates traversal to the inner `walk` helper. `walk` reads the directory entries with their types; if the directory does not exist, the readdir rejection is caught and the walk returns quietly, treating a missing wiki as an empty collection. For each entry, directories recurse into `walk` while regular files whose names end in `.md` are pushed onto the output list. Symlinked directories are not followed because the code checks only the declared `isDirectory` type bit, and hidden files and non-markdown content are ignored by the extension filter.

## Identifier splitting

<!-- lw:anchors packages/mcp/src/search.ts#splitIdentifiers -->

The default FTS5 unicode61 tokenizer treats `resolveDebt`, `ValidationError`, and `resolve_debt` each as one opaque token, so a search for `debt` would never match wiki text containing `resolveDebt` unless the index also stores split forms. `splitIdentifiers` solves that by expanding identifier runs into their component words while keeping the original.

```
export function splitIdentifiers(text: string): string {
```

The function takes arbitrary text and returns the same text with each identifier run rewritten as the original token followed by its split parts. It works by matching identifier runs against `IDENTIFIER_RE`, then for each token splits on underscores, drops empty segments from leading, trailing, or doubled underscores, and applies two regex replacements: lower-or-digit to upper boundaries split camelCase words, and acronym-run boundaries split runs like `HTTPServerError` into `HTTP Server Error`. Parts are joined with spaces; a token yielding only one part is a plain word and passes through unchanged, so ordinary prose is never altered. The function is pure — identical input always yields identical output — which matters because it runs both at index time and again at query time.

## Rebuild and incremental page operations

<!-- lw:anchors packages/mcp/src/search.ts#reindexAllPages packages/mcp/src/search.ts#indexPage packages/mcp/src/search.ts#removePage -->

`reindexAllPages` exposes the full-rebuild path to the server watcher so that after each debounced sync batch the search index is rebuilt wholesale instead of tracking per-page diffs:

```
export async function reindexAllPages(idx: SearchIndex, repoRoot: string): Promise<void> {
```

It takes the index handle and repository root, resolves the root to an absolute path, and delegates to the same internal `reindexAll` used at startup, preserving the idempotent, sub-second behavior for a 1000-page wiki.

`indexPage` is the incremental update path called by `write_doc` when a single page changes:

```
export function indexPage(idx: SearchIndex, wikiPath: string, content: string): void {
```

The function takes the index handle, the wiki-relative page path, and the new page content. Because FTS5 has no native UPSERT, it wraps DELETE-then-INSERT in a single transaction: first it removes any existing rows for that `wiki_path` from both tables so stale content cannot linger, then it inserts original text into `wiki_search` and split text into `wiki_search_tokens`. Running the four statements in one transaction means a crash mid-update cannot leave the two tables disagreeing about a page.

`removePage` deletes a page from the index when the wiki page disappears:

```
export function removePage(idx: SearchIndex, wikiPath: string): void {
```

It takes the index handle and wiki-relative path, issuing delete statements against both FTS5 tables. The operation is idempotent — deleting a path that is not present is a no-op — and needs no transaction because the two deletes are independent and each is atomic on its own.

## Query term extraction and snippet building

<!-- lw:anchors packages/mcp/src/search.ts#queryTerms packages/mcp/src/search.ts#snippetAround -->

`queryTerms` and `snippetAround` support the search path when a hit comes from the split-tokens table rather than the original table.

`queryTerms` extracts the individual searchable words from a user query:

```
function queryTerms(query: string): string[] {
```

It takes the raw query string and returns an array of lowercase terms. The function matches each identifier run in the query, runs that token through `splitIdentifiers`, splits the expansion on spaces, and lowercases every piece. This yields the same vocabulary the split index stores, so it can locate matches inside original content.

`snippetAround` builds a relevant excerpt when the raw FTS5 snippet cannot highlight a compound identifier:

```
function snippetAround(content: string, terms: string[]): string {
```

It takes the original page content and the query terms array, returning a snippet string with `<<` and `>>` markers around the first occurrence of any term, mirroring FTS5's own snippet format. The function lowercases the content for case-insensitive term location, scans for the earliest occurrence among all terms, and when no term appears returns the first 160 characters trimmed and ellipsized only if truncation occurred. When a term is found it takes up to 80 characters on each side of the match, prepends or appends `...` when clipping at the content edges, and wraps the matched span in the marker pair so callers can highlight it. The bounds clamp on both sides — the start never goes below zero and the end never exceeds the content length.

## Search execution and error classification

<!-- lw:anchors packages/mcp/src/search.ts#search packages/mcp/src/search.ts#isFtsQueryError packages/mcp/src/search.ts#SearchIndexUnavailableError packages/mcp/src/search.ts#SearchIndexUnavailableError.constructor -->

The search path ties together both tables, snippet construction, and error classification. `search` is the public query entry point:

```
export function search(
  idx: SearchIndex,
  query: string,
  opts: SearchOptions = {},
): SearchHit[] {
```

The function takes the index handle, an FTS5 expression supporting prefix terms, AND/OR operators, and quoted phrases, plus optional result-limit settings, and returns an array of hits each carrying a wiki path and a snippet. It first queries `wiki_search` with the raw query, asking FTS5 for the built-in snippet with `<<`/`>>` markers ordered by rank up to the limit. Those hits form the head of the result set, always shown first because they exhibit the original-tokenizer semantics.

Only when the original-table hits come up short does the function consult `wiki_search_tokens`, querying with `splitIdentifiers(query)` so compound query terms can match their split index forms. It tracks seen wiki paths to deduplicate against the original-table results, and for each new path fetches the original content from `wiki_search` and builds the snippet via `snippetAround`, because the split table is match-only and never displayed. Both tables sort by FTS5 rank, and the merged list stops once it reaches the limit, defaulting to 20 when no option is supplied.

Error handling distinguishes user error from infrastructure failure. A malformed FTS5 expression is user input with no matches, so it returns an empty array rather than surfacing an exception. The catch block delegates to `isFtsQueryError` to make that call:

```
export function isFtsQueryError(err: unknown): boolean {
```

The function takes an unknown thrown value and returns true only when the error is caused by the query text itself. It requires an `Error` instance whose `code` property is exactly `SQLITE_ERROR` — a closed database handle throws a plain TypeError instead, which fails this check. It then matches the message against an allowlist of FTS5 syntax error shapes: `fts5: syntax error`, `unterminated string`, `unknown special query`, and `expected integer, got`. The allowlist is deliberate: anything unrecognized propagates as an index failure, so a new SQLite error shape can never silently become an empty result set. The ambiguous `no such column: X` message is resolved by checking whether the named column belongs to this module's own SQL names; if the user named an unknown column it is a query error, but if one of our columns is missing the index has drifted and must be treated as broken.

Every other SQLite error — closed handle, corrupt file, missing table — throws `SearchIndexUnavailableError`, which declares that the index itself is unusable:

```
export class SearchIndexUnavailableError extends Error {
```

The class extends the built-in `Error` type. Its constructor takes an unknown cause, extracts a message when the cause is itself an `Error` or stringifies it otherwise, prefixes it with `search index is unavailable: `, sets the error name to `SearchIndexUnavailableError`, and attaches the original cause. This ensures the caller never mistakes a broken index for a healthy wiki with no matching pages.

## Tests

Covered by `packages/mcp/src/search.test.ts` (same-name test file on disk).
