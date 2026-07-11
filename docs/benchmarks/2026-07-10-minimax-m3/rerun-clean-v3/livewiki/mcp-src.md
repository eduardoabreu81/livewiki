---
title: "@livewiki/mcp — src reference"
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

# `@livewiki/mcp` — `src` reference

This module packages the Model Context Protocol (MCP) server for livewiki. It exposes the stdio entry point (`index.ts`), the six-tool server implementation (`server.ts`), the SQLite FTS5 search backend (`search.ts`), and the two test suites that validate end-to-end behaviour against the compiled CLI (`server.test.ts`, `phase5-e2e.test.ts`).

## CLI entry point (`packages/mcp/src/index.ts`)

The binary reads a single `--repo <path>` flag, creates the MCP server, and binds it to a `StdioServerTransport`. It registers `SIGINT` and `SIGTERM` handlers that close the server (which in turn closes the FTS5 index) before exiting `0`. Unhandled errors are written to stderr and the process exits `1`.

### Process lifecycle and signal handling
<!-- lw:anchors packages/mcp/src/index.ts#main packages/mcp/src/index.ts#parseArgs -->

- `parseArgs(argv)` — minimal argv parser. Defaults `repoRoot` to `process.cwd()`; resolves the value following `--repo` via `nodePath.resolve`. Returns `{ repoRoot: string }`.
- `main()` — async orchestrator. Calls `parseArgs(process.argv.slice(2))`, instantiates the server with `createServer({ repoRoot })`, attaches `StdioServerTransport`, and installs best-effort graceful shutdown. The wrapping `.catch` writes `[livewiki-mcp] fatal: …` to stderr and exits `1`.

## Server implementation (`packages/mcp/src/server.ts`)

`createServer` builds an `McpServer` named `livewiki` and registers the six tools specified by SPEC §"MCP tools" (Fase 4). It does **not** connect a transport — the caller (`index.ts` for stdio, the test suites via `InMemoryTransport`) is responsible for that. On `server.close()` it additionally closes the FTS5 search index.

### `createServer` and the six tools
<!-- lw:anchors packages/mcp/src/server.ts#createServer -->

- `createServer(opts?)` — resolves `repoRoot` (defaulting to `process.cwd()`), opens the FTS5 search index, and registers all six tools. Returns the configured `McpServer`.
- `livewiki_quickstart` — returns `livewiki/quickstart.md` text. Errors if the wiki is not initialized.
- `livewiki_read` — reads a page by relative path inside the `livewiki/` allowlist via `safeIo.readText`.
- `livewiki_search` — FTS5 query; returns JSON `{ query, hits: [{ wikiPath, snippet }] }` with optional `limit` (default 20, max 100).
- `livewiki_debt` — runs the core `status` reporter and returns its JSON.
- `livewiki_write_doc` — writes via `safeIo.writeText` (allowlist enforced; symlink-checked). When `skipVerify` is not set, runs `runVerify` on the repo and rolls back the file if any error-level issue touches the new path or the repo as a whole. On success, incrementally updates the FTS5 index via `indexPage`.
- `livewiki_resolve_debt` — opens `.livewiki/index.db`, marks rows in the `debt` table with `resolved_at = now` for each provided `debtId`, and reports `{ resolved, notFound, writeRef?, timestamp }`.

## Search backend (`packages/mcp/src/search.ts`)

A dedicated SQLite FTS5 index at `.livewiki/search.db` (separate from `.livewiki/index.db` to avoid a schema v5 migration on the core DB). The `wiki_search` virtual table has two columns: `wiki_path` (UNINDEXED) and `content`. The index is rebuilt fully on every `openAndIndex` call and updated incrementally through `indexPage` / `removePage` after successful writes.

### Index lifecycle
<!-- lw:anchors packages/mcp/src/search.ts#openAndIndex packages/mcp/src/search.ts#reindexAll packages/mcp/src/search.ts#close -->

- `openAndIndex(repoRoot)` — resolves `.livewiki/search.db` via `safeIo.resolveAndValidate`, ensures `.livewiki/` exists, opens the DB in WAL mode, creates the `wiki_search` FTS5 virtual table if missing, then triggers a full rebuild via `reindexAll`. Returns a `SearchIndex` handle.
- `reindexAll(db, absRoot)` — `DELETE FROM wiki_search`; collects every `*.md` under `livewiki/`, reads its content, and inserts (path, content) pairs inside a single transaction. Unreadable files are skipped.
- `close(idx)` — closes the underlying better-sqlite3 handle. The server's `close()` wrapper invokes this in addition to its own teardown.

### Page-level mutations and queries
<!-- lw:anchors packages/mcp/src/search.ts#indexPage packages/mcp/src/search.ts#removePage packages/mcp/src/search.ts#search -->

- `indexPage(idx, wikiPath, content)` — FTS5 has no native UPSERT; performs a `DELETE` + `INSERT` for the path inside one transaction.
- `removePage(idx, wikiPath)` — `DELETE FROM wiki_search WHERE wiki_path = ?`. Idempotent.
- `search(idx, query, opts?)` — runs `MATCH ?` with `ORDER BY rank LIMIT ?`, returning `snippet(..., 32)` markers around the first match. FTS5 syntax errors are caught and result in `[]`.

### File collection
<!-- lw:anchors packages/mcp/src/search.ts#collectMarkdownFiles packages/mcp/src/search.ts#walk -->

- `collectMarkdownFiles(dir)` — returns absolute paths of every `*.md` under `dir`. Missing directories yield `[]`.
- `walk(d)` — recursive helper used by `collectMarkdownFiles`. Reads entries with `withFileTypes: true`, descends into directories, and collects `*.md` files. A missing `readdir` is swallowed so an empty/missing `livewiki/` does not throw.

## Server test suite (`packages/mcp/src/server.test.ts`)

Phase 4 E2E: connects the livewiki server to a mock MCP `Client` over `InMemoryTransport`, then exercises `tools/list`, every `tools/call`, allowlist enforcement, verify-based rejection of broken anchors, and the `skipVerify` escape hatch. Each test closes the client and server in a `finally` block to release the WAL files before `afterEach` removes the temp repo (avoids `EBUSY` on Windows).

### Connection helpers
<!-- lw:anchors packages/mcp/src/server.test.ts#connect packages/mcp/src/server.test.ts#teardown packages/mcp/src/server.test.ts#extractText -->

- `connect()` — creates a `McpServer` via `createServer({ repoRoot })` and a `Client` named `test-agent`, links them with `InMemoryTransport.createLinkedPair()`, awaits both connects in parallel, and returns `{ client, server }`.
- `teardown(c)` — closes the client and server in sequence.
- `extractText(r)` — joins every `text`-typed content block from a `callTool` result into a single string, regardless of the discriminated union shape. Used to assert on `isError` and tool output text uniformly.

## Phase 5 E2E suite (`packages/mcp/src/phase5-e2e.test.ts`)

End-to-end "Phase 5" acceptance test: the agent edits source code, the hook (subprocess `livewiki index --quiet`) detects the change, the agent pays the debt via the real MCP `livewiki_write_doc` tool, and `livewiki verify` must exit `0` with **zero** issues of any severity. A second `describe` covers the reviewer finding that `livewiki init` must add `.livewiki/` to the repo's `.gitignore`, idempotently and without clobbering user entries.

### CLI subprocess and MCP wiring
<!-- lw:anchors packages/mcp/src/phase5-e2e.test.ts#runCli packages/mcp/src/phase5-e2e.test.ts#connectMcp packages/mcp/src/phase5-e2e.test.ts#teardown packages/mcp/src/phase5-e2e.test.ts#runVerify -->

- `runCli(args, cwd)` — spawns the compiled CLI (`packages/cli/dist/index.js`) with `process.execPath`, always passing `--repo <cwd>`, and returns `{ code, stdout, stderr }`. Used for `init`, `index`, `status`, and `verify` to exercise the real binary.
- `connectMcp(repoRoot)` — in-process MCP wiring: builds the server with `createServer({ repoRoot })`, builds a `Client` named `phase5-e2e-agent`, links them through `InMemoryTransport.createLinkedPair()`, and returns `{ client, server }`.
- `teardown(c)` — closes client and server.
- `runVerify(repoRoot)` — runs `livewiki verify --json` via `runCli`, parses the JSON (with a regex fallback that extracts the first `{…}` block), and returns `{ ok, exitCode, issues, rawStdout }`. The acceptance criterion asserts both `exitCode === 0` **and** `issues.length === 0`.