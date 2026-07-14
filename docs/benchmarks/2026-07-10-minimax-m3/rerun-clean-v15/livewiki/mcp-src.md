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

## stdio entry point (packages/mcp/src/index.ts)
<!-- lw:anchors packages/mcp/src/index.ts#main packages/mcp/src/index.ts#parseArgs -->

The `@livewiki/mcp` package boots through a stdio entry point. `parseArgs` walks the argument vector and picks up `--repo <path>`, defaulting the repo root to `process.cwd()` and resolving whatever value is supplied against the current working directory. `main` then calls `parseArgs` on `process.argv.slice(2)`, builds an `McpServer` via `createServer({ repoRoot })`, attaches a `StdioServerTransport`, and awaits `server.connect(transport)` so the process stays alive while the MCP client is connected. It also wires `SIGINT` and `SIGTERM` to a best-effort `server.close()` followed by `process.exit(0)`; any unhandled rejection in the startup sequence is logged to stderr and exits with code 1.

## FTS5 search index (packages/mcp/src/search.ts)
<!-- lw:anchors packages/mcp/src/search.ts#openAndIndex packages/mcp/src/search.ts#reindexAll packages/mcp/src/search.ts#collectMarkdownFiles packages/mcp/src/search.ts#walk packages/mcp/src/search.ts#indexPage packages/mcp/src/search.ts#removePage packages/mcp/src/search.ts#search packages/mcp/src/search.ts#close -->

`openAndIndex` opens (or creates) the FTS5-backed database at `.livewiki/search.db`, enables WAL, ensures the `wiki_search` virtual table exists with columns `wiki_path` and `content`, and triggers a full reindex of every markdown page under the repo. `reindexAll` empties the table and reloads it inside a single transaction, while `collectMarkdownFiles` (with the inner `walk` helper) recursively enumerates `.md` files under `livewiki/`, returning absolute paths. `indexPage` and `removePage` apply incremental single-page updates and removals, both expressed as `DELETE` + (for `indexPage`) `INSERT` wrapped in a transaction since FTS5 has no native upsert. `search` runs a `MATCH` query against the table, ordering by `rank` and applying the `snippet(...)` function to surface a 32-token window around the first match, defaulting `limit` to 20 and returning an empty array on any FTS5 syntax error. `close` simply closes the underlying `better-sqlite3` handle.

## MCP server factory (packages/mcp/src/server.ts)
<!-- lw:anchors packages/mcp/src/server.ts#createServer -->

`createServer` is the only server-side entry point: it resolves the repo root, opens the FTS5 index, and returns an `McpServer` named `livewiki` with the six tools described in the SPEC (`livewiki_quickstart`, `livewiki_read`, `livewiki_search`, `livewiki_debt`, `livewiki_write_doc`, `livewiki_resolve_debt`). It does not attach a transport — the caller (e.g. `index.ts` with stdio) does. `write_doc` enforces the allowlist via `safe-io`: paths outside `livewiki/` surface as `McpError(InvalidParams)`, and the page is only persisted after `verify` runs without error-level issues touching it (with a best-effort rollback on rejection). `resolve_debt` opens `.livewiki/index.db`, sets `resolved_at` for each supplied ID inside a transaction, and reports which IDs were resolved versus not found. The factory augments `server.close` so the FTS5 index is also closed on shutdown.

## Phase 4 server tests (packages/mcp/src/server.test.ts)
<!-- lw:anchors packages/mcp/src/server.test.ts#connect packages/mcp/src/server.test.ts#teardown packages/mcp/src/server.test.ts#extractText -->

These tests use an `InMemoryTransport` to exercise the real `McpServer` against a `Client` mock. `connect` returns a `Connected` bundle holding both ends of the linked transport pair; every test wraps its body in `try/finally` and calls `teardown` so the FTS5 WAL files are released before the per-test `mkdtemp` directory is removed (important on Windows where `nodeFs.rm` can hit `EBUSY` on a still-open DB). `extractText` is a small helper that flattens the discriminated `callTool` result into a single string by joining the `type: "text"` blocks, which the assertions then regex-match or `JSON.parse` against.

## Phase 5 end-to-end test (packages/mcp/src/phase5-e2e.test.ts)
<!-- lw:anchors packages/mcp/src/phase5-e2e.test.ts#runCli packages/mcp/src/phase5-e2e.test.ts#connectMcp packages/mcp/src/phase5-e2e.test.ts#teardown packages/mcp/src/phase5-e2e.test.ts#runVerify -->

The Phase 5 test exercises the full hook → MCP → verify loop. `runCli` spawns the compiled `packages/cli/dist/index.js` as a subprocess with `--repo <cwd>`, capturing `code`, `stdout`, and `stderr` (this is what guarantees the test calls the real binary the production hook invokes). `connectMcp` builds a server in-process and wires it to a `Client` via `InMemoryTransport.createLinkedPair`, mirroring the same MCP client production agents use without the stdio flakiness; `teardown` closes both ends. `runVerify` runs `livewiki verify --json` through `runCli` and parses the JSON output (with a regex fallback for older human-mode emissions), surfacing `ok`, `exitCode`, and the full `issues` array — because the SPEC criterion is issue *count*, not just exit code. The two `describe` blocks cover the payment-via-MCP flow (edit → debt detected → `write_doc` → verify returns zero issues → manifest `updatedAt` advances) and the reviewer finding that `livewiki init` must add `.livewiki/` to the repo `.gitignore` inside a managed block, idempotently and without clobbering user entries.