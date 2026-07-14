---
title: mcp-src
owner: generated
anchors:
  - packages/mcp/src/index.ts#main
  - packages/mcp/src/index.ts#parseArgs
  - packages/mcp/src/phase5-e2e.test.ts#connectMcp
  - packages/mcp/src/phase5-e2e.test.ts#runCli
  - packages/mcp/src/phase5-e2e.test.ts#runVerify
  - packages/mcp/src/phase5-e2e.test.ts#teardown
  - packages/mcp/src/search.ts#close
  - packages/mcp/src/search.ts#collectMarkdownFiles
  - packages/mcp/src/search.ts#indexPage
  - packages/mcp/src/search.ts#openAndIndex
  - packages/mcp/src/search.ts#reindexAll
  - packages/mcp/src/search.ts#removePage
  - packages/mcp/src/search.ts#search
  - packages/mcp/src/search.ts#walk
  - packages/mcp/src/server.test.ts#connect
  - packages/mcp/src/server.test.ts#extractText
  - packages/mcp/src/server.test.ts#teardown
  - packages/mcp/src/server.ts#createServer
---

## Entry point (index.ts)
<!-- lw:anchors packages/mcp/src/index.ts#main packages/mcp/src/index.ts#parseArgs -->

`parseArgs(argv)` walks the argument vector and returns `{ repoRoot }`. It defaults `repoRoot` to `process.cwd()` and, when it encounters `--repo <path>`, resolves `<path>` against the current working directory and advances past the consumed argument. The signature is exported as a closure-shaped helper that returns an object literal with a single field.

`main()` is the stdio entry point for `@livewiki/mcp`. It parses CLI args, calls `createServer({ repoRoot })`, attaches a `StdioServerTransport`, and connects. The process wires `SIGINT`/`SIGTERM` handlers that log to stderr, best-effort `server.close()` (which closes the FTS5 index), and exit cleanly. Any thrown error falls through to the top-level `.catch`, which writes a fatal line to stderr and exits with code 1.

## Phase 5 end-to-end helpers
<!-- lw:anchors packages/mcp/src/phase5-e2e.test.ts#runCli packages/mcp/src/phase5-e2e.test.ts#connectMcp packages/mcp/src/phase5-e2e.test.ts#teardown packages/mcp/src/phase5-e2e.test.ts#runVerify -->

The Phase 5 suite drives the compiled CLI (`packages/cli/dist/index.js`) as a real subprocess and the MCP server in-process via `InMemoryTransport`. It throws at module load if the CLI build artifact is missing.

`runCli(args, cwd)` spawns the livewiki CLI with `--repo <cwd>` appended, captures stdout/stderr into strings, and resolves to `{ code, stdout, stderr }`. It rejects on `child.on('error')`.

`connectMcp(repoRoot)` is the in-process MCP wiring: it builds the server with `createServer`, opens a linked `Client`/`McpServer` pair with `InMemoryTransport.createLinkedPair()`, and connects both sides in parallel via `Promise.all`. Returned `Connected` carries the client and server for later teardown.

`teardown(c)` is the symmetric cleanup for `connectMcp`: it `client.close()` then `server.close()`. Tests must run it in `finally` to avoid leaking the WAL files on Windows.

`runVerify(repoRoot)` shells out `verify --json`, parses stdout as JSON (with a regex fallback if non-JSON text appears), and returns `{ ok, exitCode, issues, rawStdout }` with sane defaults. The suite uses both `exitCode === 0` and `issues.length === 0` checks — the SPEC requires asserting the issue count, not just the exit code.

## FTS5 search index
<!-- lw:anchors packages/mcp/src/search.ts#openAndIndex packages/mcp/src/search.ts#reindexAll packages/mcp/src/search.ts#collectMarkdownFiles packages/mcp/src/search.ts#walk packages/mcp/src/search.ts#indexPage packages/mcp/src/search.ts#removePage packages/mcp/src/search.ts#search packages/mcp/src/search.ts#close -->

The `search.ts` module keeps a separate `.livewiki/search.db` (FTS5) rather than extending `index.db`. Rationale: avoid a schema-version migration; the search DB is fully rebuildable from `livewiki/`; and `core` stays free of an FTS5 dependency. The tokenizer is the FTS5 default (`porter`).

`openAndIndex(repoRoot)` resolves the DB path through `safeIo.resolveAndValidate`, ensures `.livewiki/` exists, opens the DB with WAL mode, runs the `CREATE VIRTUAL TABLE IF NOT EXISTS wiki_search USING fts5(wiki_path UNINDEXED, content)` DDL, then calls `reindexAll`. Returns `{ db }`.

`reindexAll(db, absRoot)` is idempotent: it `DELETE FROM wiki_search`, walks the wiki, reads each `.md` file (silently skipping unreadable files), and inserts all entries inside one transaction.

`collectMarkdownFiles(dir)` is a tiny recursive scanner that returns absolute paths of `*.md` files. It swallows `ENOENT` so an uninitialized wiki resolves to `[]`.

`walk(d)` is the inner recursive step of `collectMarkdownFiles`. It `readdir`s with `withFileTypes`, recurses into directories, and pushes file entries whose name ends in `.md`. A missing `d` is a no-op.

`indexPage(idx, wikiPath, content)` is the incremental update path for `write_doc`. FTS5 lacks native `UPSERT`, so the module wraps `DELETE` + `INSERT` in a single transaction keyed on `wiki_path`.

`removePage(idx, wikiPath)` is a single `DELETE FROM wiki_search WHERE wiki_path = ?`. Idempotent.

`search(idx, query, opts)` runs the FTS5 query with `MATCH`, ordering by `rank` and applying a `LIMIT` (default 20). Each row is mapped to `{ wikiPath, snippet }` using FTS5's `snippet(wiki_search, 1, '<<', '>>', '...', 32)`. FTS5 syntax errors are caught and return `[]` instead of throwing.

`close(idx)` calls `idx.db.close()`. The server overrides `server.close` to invoke this first so the FTS5 DB doesn't outlive the transport.

## Server-level tests (Phase 4)
<!-- lw:anchors packages/mcp/src/server.test.ts#connect packages/mcp/src/server.test.ts#teardown packages/mcp/src/server.test.ts#extractText -->

The Phase 4 test file pairs `McpServer` (livewiki) with a `Client` (mock agent) over `InMemoryTransport`. `beforeEach` provisions a temp repo with a couple of source files and runs programmatic `runInit`; `afterEach` recursively removes the tempdir.

`connect()` mirrors `phase5-e2e.test.ts#connectMcp`: it builds the server via `createServer({ repoRoot })`, instantiates a `Client`, links `InMemoryTransport` pair transports, and resolves once both sides are connected. The returned tuple is closed in every `finally` — the comment in the file calls out Windows file locking on `search.db-shm`/`search.db-wal` as the reason.

`teardown(c)` is the matching cleanup helper — close the client first, then the server.

`extractText(r)` walks an MCP `callTool` result, finds every `content` entry where `type === "text"`, and concatenates their `text` fields. Defensive against non-object inputs.

## Server factory
<!-- lw:anchors packages/mcp/src/server.ts#createServer -->

`createServer(opts?)` constructs the MCP server and registers the six tools (`livewiki_quickstart`, `livewiki_read`, `livewiki_search`, `livewiki_debt`, `livewiki_write_doc`, `livewiki_resolve_debt`). It defaults `repoRoot` to `process.cwd()`, opens the FTS5 index via `openAndIndex`, and builds an `McpServer` named `livewiki` with empty `tools` capability. The transport connection is left to the caller (the stdio entry point uses `StdioServerTransport`).

Tool behavior:

- `livewiki_quickstart` reads `livewiki/quickstart.md` through `safeIo.readText`.
- `livewiki_read(path)` reads any `safeIo.readText`-allowed path; errors are surfaced with the safe-io message (no path or content leakage).
- `livewiki_search(query, limit?)` calls the FTS5 helper and returns `{ query, hits }` as JSON.
- `livewiki_debt()` runs `status` and returns its JSON report.
- `livewiki_write_doc(path, content, skipVerify?)` first writes via `safeIo.writeText` (allowlist enforced); `PathOutsideAllowlistError` becomes an `McpError(InvalidParams)` and `InvalidRelativePathError` likewise. If `skipVerify !== true`, it re-runs `verify` and rolls back the file on error-level issues touching the written page. Finally, it calls `indexPage` to update FTS5 incrementally.
- `livewiki_resolve_debt(debtIds, writeRef?)` opens `.livewiki/index.db`, runs `UPDATE debt SET resolved_at = ? WHERE id = ? AND resolved_at IS NULL` inside a transaction, and returns `{ resolved, notFound, writeRef?, timestamp }`.

The original `server.close` is rebound to also call `closeSearch(searchIdx)` before delegating, so a clean shutdown releases the FTS5 DB. `SearchIndex` is re-exported for tests.