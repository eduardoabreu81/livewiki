---
title: "@livewiki/mcp stdio server and search index"
owner: generated
anchors:
  - packages/mcp/src/index.ts#main
  - packages/mcp/src/index.ts#parseArgs
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
  - packages/mcp/src/server.ts#createServer
  - packages/mcp/src/server.ts#isWatchDenied
  - packages/mcp/src/server.ts#schedule
  - packages/mcp/src/server.ts#startWatcher
  - packages/mcp/src/server.ts#stop
  - packages/mcp/src/server.ts#syncBatch
---

# @livewiki/mcp stdio server and search index

The `@livewiki/mcp` package boots a stdio MCP server and a paired SQLite FTS5 search index for the livewiki tools.

## When to use this page

- **Run** the package via `npx -y @livewiki/mcp --repo <path>` to attach the livewiki tools to an MCP client.
- **Configure** the file watcher denylist or debounce window when tuning index freshness under heavy working-tree churn.
- **Debug** search behaviour by understanding the dual-table (`wiki_search` + `wiki_search_tokens`) merge in `search()`.
- **Trace** tool call shapes (`livewiki_search`, `livewiki_write_doc`, `livewiki_impact`, ...) when adding a new tool or changing one.

## How it fits

This module owns the MCP integration boundary of livewiki. `packages/mcp/src/index.ts` is the process entry point: it parses the `--repo` argument, constructs a server via `createServer`, connects it over `StdioServerTransport`, and wires SIGINT/SIGTERM to a graceful shutdown that closes the server (which in turn closes the FTS5 index). `packages/mcp/src/server.ts` configures the `McpServer`, registers the tools (`livewiki_quickstart`, `livewiki_read`, `livewiki_search`, `livewiki_debt`, `livewiki_impact`, `livewiki_write_doc`, `livewiki_resolve_debt`), attaches the static `_hints` presentation layer, and starts a recursive `fs.watch` for index freshness. `packages/mcp/src/search.ts` owns the `.livewiki/search.db` FTS5 lifecycle: it opens the DB, rebuilds it on startup, exposes incremental `indexPage`/`removePage` for writes, and merges two-table query results for the `livewiki_search` tool. The module depends on `@livewiki/core` for safe-io, the indexer, the ledger, the blast-radius walker, and the change-impact calculator; the watcher fans events into those pipelines on a debounced cadence.

## Diagram

```mermaid
%% livewiki/diagrams/mcp-src.mmd
```

## CLI entry point

<!-- lw:anchors packages/mcp/src/index.ts#main packages/mcp/src/index.ts#parseArgs -->

The CLI entry point parses a single `--repo <path>` flag (defaulting to `process.cwd()`), constructs the MCP server, and attaches it to a `StdioServerTransport`. The signatures below are the authoritative shapes from the source.

```ts
function parseArgs(argv: readonly string[]): { repoRoot: string }
async function main(): Promise<void>
```

`parseArgs` walks `argv` looking for `--repo` and resolves the next argument with `nodePath.resolve`; any other flag or position is ignored. `main` awaits `createServer({ repoRoot })`, connects the transport, and registers SIGINT/SIGTERM handlers that call `server.close()` inside a `try/catch` (best-effort) before `process.exit(0)`. The unhandled-rejection tail at the bottom of `index.ts` writes a `[livewiki-mcp] fatal:` line to stderr and exits with code 1. Because `server.close()` is augmented to also stop the watcher and close the FTS5 index, the shutdown path covers those resources without extra wiring here.

## Search index lifecycle

<!-- lw:anchors packages/mcp/src/search.ts#openAndIndex packages/mcp/src/search.ts#reindexAll packages/mcp/src/search.ts#reindexAllPages packages/mcp/src/search.ts#close packages/mcp/src/search.ts#indexPage packages/mcp/src/search.ts#removePage packages/mcp/src/search.ts#collectMarkdownFiles packages/mcp/src/search.ts#walk -->

This cluster owns `.livewiki/search.db`. `openAndIndex` resolves and validates the DB path through `safeIo.resolveAndValidate`, ensures `.livewiki/` exists via `safeIo.mkdir`, opens `better-sqlite3`, sets `journal_mode = WAL`, and creates the two virtual tables (`wiki_search`, `wiki_search_tokens`) with `CREATE VIRTUAL TABLE IF NOT EXISTS` before kicking off a full rebuild. The signatures from the symbol table:

```ts
export async function openAndIndex(
  repoRoot: string,
): Promise<SearchIndex>
async function reindexAll(db: Database.Database, absRoot: string): Promise<void>
export async function reindexAllPages(idx: SearchIndex, repoRoot: string): Promise<void>
export function indexPage(idx: SearchIndex, wikiPath: string, content: string): void
export function removePage(idx: SearchIndex, wikiPath: string): void
export function close(idx: SearchIndex): void
async function collectMarkdownFiles(dir: string): Promise<string[]>
```

`reindexAll` clears both FTS tables, calls `collectMarkdownFiles` over `livewiki/`, reads every markdown file (skipping on `readFile` errors), and writes one transactional batch — original text into `wiki_search`, the same text run through `splitIdentifiers` into `wiki_search_tokens`. `reindexAllPages` is the public wrapper the server watcher calls after every debounced sync batch. `indexPage` performs an FTS5 UPSERT emulation: `DELETE` both rows for `wiki_path`, then `INSERT` the fresh content and its split form, all inside a transaction. `removePage` simply deletes from both tables. `close` closes the underlying `better-sqlite3` handle and is the function the server's shutdown path calls. `collectMarkdownFiles` uses an inner `walk(d)` recursive helper: it reads the directory with `withFileTypes`, recurses on directories, and pushes `.md` files; the `try/catch` around `readdir` silently returns when the wiki directory does not exist.

## Search and query shaping

<!-- lw:anchors packages/mcp/src/search.ts#search packages/mcp/src/search.ts#snippetAround packages/mcp/src/search.ts#splitIdentifiers packages/mcp/src/search.ts#queryTerms -->

This cluster turns a user query into hits with snippets. The signatures from the symbol table:

```ts
export function search(
  idx: SearchIndex,
  query: string,
  opts: SearchOptions = {},
): SearchHit[]
function snippetAround(content: string, terms: string[]): string
export function splitIdentifiers(text: string): string
function queryTerms(query: string): string[]
```

`search` runs the raw query against `wiki_search` ordered by `rank`, then — only if the limit has not been reached — runs `splitIdentifiers(query)` against `wiki_search_tokens`, dedupes by `wikiPath`, and synthesises a snippet via `snippetAround` from the original `wiki_search` row (so readers always see real text, never the split form). The whole merge is wrapped in `try/catch`; an FTS5 syntax error returns `[]` instead of propagating. `snippetAround` finds the earliest `terms` match in the lowercased content, slices ±80 characters around it, and emits `<<term>>` markers with leading/trailing `...` when the slice is bounded; if no term matches, it returns the first 160 characters (trimmed, with `...` when truncated). `splitIdentifiers` is a pure helper: it rewrites every `[A-Za-z][A-Za-z0-9_]*` run, splits snake_case on `_`, then splits camelCase/PascalCase at lower→upper boundaries and acronym runs (`HTTPServerError` → `HTTP Server Error`), and emits `original split-parts` joined with spaces; single-part tokens are returned untouched. `queryTerms` extracts the same identifier runs from the query and produces the lowercased split parts used to drive `snippetAround`.

## Watcher and incremental sync

<!-- lw:anchors packages/mcp/src/server.ts#startWatcher packages/mcp/src/server.ts#schedule packages/mcp/src/server.ts#syncBatch packages/mcp/src/server.ts#stop packages/mcp/src/server.ts#isWatchDenied -->

This cluster keeps the indexer, ledger, and search index in step with working-tree edits while the server is alive. `startWatcher` returns a `WatcherHandle` whose `stop()` releases the OS handle and awaits any in-flight sync. The signatures from the symbol table:

```ts
function startWatcher(repoRoot: string, searchIdx: SearchIndex): WatcherHandle
function schedule(): void
async function syncBatch(): Promise<void>
async function stop(): Promise<void>
function isWatchDenied(filename: string): boolean
```

`schedule` resets a `WATCH_DEBOUNCE_MS` (1500ms) timer; when it fires it serialises against any running sync by re-arming. `syncBatch` runs `runIndexer` (`quiet: true`), then `runLedger` (`quiet: true`), then `reindexAllPages`; its whole body is wrapped in `try/catch` so a failed sync logs `[livewiki] watcher sync failed: ...` to `console.error` and the server stays up — the next event retries. `stop` flips a `stopped` flag, clears the debounce, awaits the underlying `FSWatcher`'s `'close'` event (so a libuv win fs-event assert cannot fire from the dying handle), and finally awaits any in-flight `syncBatch`. `isWatchDenied` checks `WATCH_DENIED_SEGMENTS` (`.git`, `.livewiki`, `node_modules`, `dist`) against every path segment — split on both `/` and `\` for Windows — and also rejects `WATCH_DENIED_EXTENSIONS` (images, archives, media, fonts). Watch creation failure (unsupported recursive watch, EMFILE, etc.) is logged once and degrades to no-watcher / startup-rebuild semantics; runtime errors on the watcher route through the same fallback via `void stop()`.

## Server composition

<!-- lw:anchors packages/mcp/src/server.ts#createServer -->

`createServer` is the single construction seam; the entry point and tests both call it. The signature from the symbol table:

```ts
export async function createServer(opts: CreateServerOptions = {}): Promise<McpServer>
```

It resolves `repoRoot` (defaulting to `process.cwd()`), resolves `verify` (defaulting to the `core/verify` runner), opens the FTS5 index via `openAndIndex`, constructs the `McpServer` with name `livewiki` and version `0.0.0`, registers the seven tools with the static `TOOL_HINTS` table for workflow-adjacency suggestions, and starts the watcher. The `server.close` override stops the watcher first and awaits any in-flight sync before calling `closeSearch(searchIdx)` and delegating to the original `close`, which is what guarantees the EBUSY-safe teardown on Windows when a test removes the temp directory right after shutdown. Inside `livewiki_write_doc` the call to `safeIo.writeText` is the allowlist gate (paths outside `livewiki/` raise `PathOutsideAllowlistError` → `McpError(InvalidParams)`); a subsequent `verify` pass that reports an `error`-severity issue touching the written path triggers `rollbackWrittenPage` (best-effort `fs.unlink`) so the disk never holds an unverified page. `livewiki_search` clamps `limit` to the `[1, 100]` range at the schema layer (`z.number().int().min(1).max(100)`); the `livewiki_impact` tool reuses the same schema-level guards for `maxDepth` (`[1, 20]`) and `maxNodes` (`[1, 2000]`).

<!-- livewiki:navigate:start -->
## Navigate

- [core indexing, imports, flows, and frontmatter](core-src-04.md) — dependency
- [Safe I/O, section guarding, status reporting, and symbol extraction](core-src-09.md) — dependency
- [Stage 4 artifact normalization, validation, and auxiliary page assembly](core-src-01.md) — dependency
<!-- livewiki:navigate:end -->
