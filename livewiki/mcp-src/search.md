---
title: Full-text search index over the wiki
owner: generated
anchors:
  - packages/mcp/src/search.ts#close
  - packages/mcp/src/search.ts#collectMarkdownFiles
  - packages/mcp/src/search.ts#indexPage
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

# Full-text search index over the wiki

This page is the searchable index that powers `livewiki_search` over every Markdown page under `livewiki/`.

## When to use this page

- **Open the FTS5 index on startup.** Use `openAndIndex` when the MCP server boots so `.livewiki/search.db` exists and is fully populated before any `search` call lands.
- **Run a full-text query.** Use `search` with an FTS5 expression (`term*`, `"exact phrase"`, AND/OR) when a tool caller wants pages matching a query, optionally capped with `SearchOptions.limit`.
- **Keep the index in sync with writes.** Use `indexPage` after a successful page write and `removePage` after a successful delete so the index mirrors on-disk state.
- **Force a wholesale rebuild.** Use `reindexAllPages` after debounced sync batches (or any time the index might be stale) instead of tracking per-page diffs.

## How it fits

`packages/mcp/src/search.ts` is the full-text indexing layer of the `livewiki` MCP server (`packages/mcp`). It is deliberately decoupled from the main `index.db`: the FTS5 search lives in its own `.livewiki/search.db` so the existing v4 schema stays untouched, the core package has no FTS5 dependency, and the search index can always be rebuilt from the wiki (the source of truth) if it ever corrupts. The module exposes a small `SearchIndex` handle wrapping a `better-sqlite3` `Database`; the server holds it, calls `indexPage` / `removePage` on each write/delete, and asks `search` for ranked hits when a `livewiki_search` tool call comes in.

The file's shape is: open the DB and seed the schema → rebuild from disk → keep it in sync via per-page updates → answer queries by fanning out across two FTS5 tables.

## Diagram

```mermaid
%% livewiki/diagrams/mcp-src-search.mmd
```

## Index lifecycle: open, rebuild, close

<!-- lw:anchors packages/mcp/src/search.ts#openAndIndex packages/mcp/src/search.ts#close -->

`openAndIndex` is the entry point that the MCP server calls once at startup. It resolves the repo root, asks `safe-io` for the validated path of `.livewiki/search.db` (the caller has already passed path validation), creates the file if missing, enables WAL journal mode, declares the two FTS5 virtual tables, and then triggers the first full rebuild before returning the handle. Because the second table is created with `IF NOT EXISTS` and the whole content is reindexed on every startup, no schema migration is needed for old databases.

```ts
export async function openAndIndex(
  repoRoot: string,
): Promise<SearchIndex>
```

`openAndIndex(repoRoot)` resolves the repo root, opens `.livewiki/search.db`, creates the FTS5 tables if missing, and returns a `SearchIndex` handle once the first rebuild is complete.

The lifecycle ends with `close`, which simply closes the underlying SQLite handle and must be called on shutdown so the WAL file is checkpointed cleanly.

```ts
export function close(idx: SearchIndex): void {
```

`close(idx)` closes the SQLite database backing the index; the caller is responsible for invoking it on server shutdown.

## Identifier splitting: making `resolveDebt` searchable

<!-- lw:anchors packages/mcp/src/search.ts#splitIdentifiers packages/mcp/src/search.ts#queryTerms -->

FTS5's default `unicode61` tokenizer treats `resolveDebt`, `ValidationError`, and `resolve_debt` as opaque single tokens, so a literal search for `debt` would miss `resolveDebt`. `splitIdentifiers` fixes that by rewriting identifier runs into the original token plus its parts, so both forms index.

```ts
export function splitIdentifiers(text: string): string {
```

`splitIdentifiers(text)` scans `text` for identifier runs (a letter followed by letters/digits/underscore), splits each run into parts — camelCase/PascalCase at lower→upper boundaries and at acronym runs like `HTTPServerError → HTTP Server Error`, snake_case on `_`, kebab-case is a no-op because FTS5 already splits on `-` — and returns the original token followed by the parts joined with spaces. Single-part runs (plain words) pass through untouched so prose is preserved.

`queryTerms(query)` uses `splitIdentifiers` on the user's query to compute the lowercase pieces it later feeds to `snippetAround`.

```ts
function queryTerms(query: string): string[] {
```

`queryTerms(query)` extracts the individual searchable words of `query` by running every identifier run through `splitIdentifiers` and lowercasing each piece, returning them as an array of strings.

## Disk walk: discovering markdown pages

<!-- lw:anchors packages/mcp/src/search.ts#collectMarkdownFiles packages/mcp/src/search.ts#walk -->

Before FTS5 can be populated, the module needs the list of pages on disk. `collectMarkdownFiles` is the recursive directory walker that produces that list.

```ts
async function collectMarkdownFiles(dir: string): Promise<string[]> {
```

`collectMarkdownFiles(dir)` recursively descends from `dir` and returns the absolute paths of every `*.md` file under it.

```ts
async function walk(d: string): Promise<void> {
```

`walk(d)` is the per-directory step that `collectMarkdownFiles` uses internally: it `readdir`s `d` with directory entries, recurses into subdirectories, and appends files whose name ends in `.md`. If `readdir` itself throws (for example the `livewiki/` directory does not yet exist on a fresh repo), `walk` returns silently and the caller treats that as an empty wiki rather than failing the rebuild.

## Bulk rebuild: reindexAll and its public wrapper

<!-- lw:anchors packages/mcp/src/search.ts#reindexAll packages/mcp/src/search.ts#reindexAllPages -->

Once the DB is open, the actual bulk indexing happens in `reindexAll`. It clears both FTS5 tables first so that pages removed since the last run do not linger as orphans, then walks the wiki, reads each file, and inserts each page into both tables inside a single transaction — the original content into `wiki_search`, and the content run through `splitIdentifiers` into `wiki_search_tokens`.

```ts
async function reindexAll(db: Database.Database, absRoot: string): Promise<void> {
```

`reindexAll(db, absRoot)` clears both FTS5 tables, walks the `livewiki/` tree under `absRoot`, reads every markdown page (skipping any that fail to read), and inserts each one into both `wiki_search` (original text) and `wiki_search_tokens` (split text) inside a single transaction so the two tables stay consistent. The whole pass is idempotent and the file-level comment notes a 1000-page repo reindexes in under a second.

`reindexAllPages` is the exported wrapper that the server's sync watcher uses to trigger the same idempotent pass on demand — after each debounced sync batch it re-resolves `repoRoot` and calls `reindexAll(idx.db, absRoot)` instead of tracking per-page diffs.

```ts
export async function reindexAllPages(idx: SearchIndex, repoRoot: string): Promise<void> {
```

`reindexAllPages(idx, repoRoot)` re-runs the startup rebuild against an existing `SearchIndex`, exposing the bulk rebuild to the sync watcher without forcing it to re-open the database.

## Incremental updates: indexPage and removePage

<!-- lw:anchors packages/mcp/src/search.ts#indexPage packages/mcp/src/search.ts#removePage -->

After startup the index is kept in lockstep with writes via per-page updates. `indexPage` upserts a single page by deleting any existing rows for its `wiki_path` in both tables and inserting the fresh content (original + split) inside one transaction — FTS5 has no native UPSERT, so delete-then-insert is the standard pattern.

```ts
export function indexPage(idx: SearchIndex, wikiPath: string, content: string): void {
```

`indexPage(idx, wikiPath, content)` replaces the index entries for `wikiPath` with the new `content` in both FTS5 tables atomically.

```ts
export function removePage(idx: SearchIndex, wikiPath: string): void {
```

`removePage(idx, wikiPath)` deletes the row for `wikiPath` from both `wiki_search` and `wiki_search_tokens`. It is idempotent — deleting a path that is not present simply runs both DELETEs against zero rows.

## Querying: search and snippetAround

<!-- lw:anchors packages/mcp/src/search.ts#search packages/mcp/src/search.ts#snippetAround -->

`search` is the public query entry point. It fans out across the two FTS5 tables and merges the results: the raw FTS5 expression runs against `wiki_search` (so porter stemming semantics and exact-phrase queries behave exactly as FTS5 defines them), and the split expression runs against `wiki_search_tokens` (so identifiers broken into parts can still match). Hits from the original table come first, ranked; any unique-by-`wiki_path` extras from the tokens table are appended up to the limit.

```ts
export function search(
  idx: SearchIndex,
  query: string,
  opts: SearchOptions = {},
): SearchHit[]
```

`search(idx, query, opts)` returns up to `opts.limit` (default 20) `SearchHit` objects with the matched page's `wikiPath` and a highlighted `snippet`. Hits from `wiki_search` use FTS5's built-in `snippet(...)` with `<<`/`>>` markers. Hits that only matched `wiki_search_tokens` fall through to `snippetAround`, which highlights the first occurrence of any query term inside the original page content so the reader still sees real text. The whole FTS5 call is wrapped in a try/catch: if the query has invalid FTS5 syntax (for example an unterminated phrase), `search` returns `[]` instead of throwing — fail-open for the caller rather than a crashed tool.

```ts
function snippetAround(content: string, terms: string[]): string {
```

`snippetAround(content, terms)` slices a 160-character window around the first match of any lowercase `term` in `content` (case-insensitive) and wraps the matched span in `<<`/`>>` markers; if no term is found, it returns the first 160 characters trimmed with a trailing `...`.

## Tests

Covered by `packages/mcp/src/search.test.ts` (same-name test file on disk).
