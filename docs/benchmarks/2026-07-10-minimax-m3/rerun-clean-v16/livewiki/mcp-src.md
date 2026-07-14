---
title: "@livewiki/mcp source reference"
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

## CLI entry (`packages/mcp/src/index.ts`)
<!-- lw:anchors packages/mcp/src/index.ts#main packages/mcp/src/index.ts#parseArgs -->

`parseArgs(argv)` walks the argument vector looking for `--repo <path>`, resolving the value to an absolute path via `node:path`. When no `--repo` flag is supplied, it falls back to `process.cwd()` and returns `{ repoRoot }`.

`main()` resolves the repo root via `parseArgs(process.argv.slice(2))`, constructs the MCP server through `createServer({ repoRoot })`, and binds it to a `StdioServerTransport`. It then registers `SIGINT` and `SIGTERM` handlers that call `server.close()` (which closes the FTS5 index) before exiting with code `0`. Top-level rejections are funneled to `process.stderr` and exit `1`.

## Search index (`packages/mcp/src/search.ts`)
<!-- lw:anchors packages/mcp/src/search.ts#openAndIndex packages/mcp/src/search.ts#reindexAll packages/mcp/src/search.ts#collectMarkdownFiles packages/mcp/src/search.ts#walk packages/mcp/src/search.ts#indexPage packages/mcp/src/search.ts#removePage packages/mcp/src/search.ts#search packages/mcp/src/search.ts#close -->

The search module owns the FTS5-backed index that lives at `.livewiki/search.db`. Keeping search in its own database (rather than embedding the virtual table in `.livewiki/index.db`) avoids a schema migration on the core DB and lets `search.db` be rebuilt from the wiki at any time.

`openAndIndex(repoRoot)` resolves `.livewiki/search.db` through `@livewiki/core/safe-io`, ensures `.livewiki/` exists, opens the SQLite handle in WAL mode, creates the `wiki_search` virtual table if absent, and triggers a full rebuild via `reindexAll`.

`reindexAll(db, absRoot)` clears the table, walks `livewiki/` for markdown files, reads each one (skipping unreadable entries), and inserts `(wiki_path, content)` rows inside a single transaction.

`collectMarkdownFiles(dir)` is a small recursive file walker. The inner helper `walk(d)` reads the directory with `withFileTypes`, recurses into subdirectories, and pushes paths ending in `.md` into the accumulator. Missing directories produce an empty list (a wiki that has not been initialized yet is not an error here).

`indexPage(idx, wikiPath, content)` performs a transactional `DELETE` + `INSERT` because FTS5 has no native UPSERT. `removePage(idx, wikiPath)` issues a single `DELETE` and is idempotent. `search(idx, query, opts)` runs the FTS5 `MATCH` with `snippet(wiki_search, 1, '<<', '>>', '...', 32)` to highlight the first match, orders by `rank`, and applies a configurable limit (default `20`, clamped at the caller). Syntax errors in the query are swallowed and the function returns `[]` rather than throwing. `close(idx)` closes the underlying `Database.Database`.

## MCP server (`packages/mcp/src/server.ts`)
<!-- lw:anchors packages/mcp/src/server.ts#createServer -->

`createServer(opts)` resolves `repoRoot` (defaulting to `process.cwd()`), opens the search index, and instantiates an `McpServer` named `livewiki` with the six SPEC-defined tools. The transport is intentionally left to the caller; `index.ts` plugs in `StdioServerTransport` while tests use `InMemoryTransport`.

Each tool is registered with a Zod schema and an async handler:

- `livewiki_quickstart` reads `livewiki/quickstart.md` via `safeIo.readText` and surfaces errors as `errorResult`.
- `livewiki_read` reads any in-allowlist wiki path with the same error shape; paths outside `livewiki/` produce a result whose message mentions the allowlist.
- `livewiki_search` delegates to `doSearch(searchIdx, query, { limit? })` and returns `{ query, hits }` as JSON.
- `livewiki_debt` runs `@livewiki/core/status` and serializes the report.
- `livewiki_write_doc` is the safety-critical path: it calls `safeIo.writeText` (which raises `PathOutsideAllowlistError` / `InvalidRelativePathError`, both mapped to `McpError(ErrorCode.InvalidParams)`), runs `runVerify` on the repo unless `skipVerify` is true, and on any error-level issue touching the new page performs a best-effort `unlink` rollback before returning an error. Successful writes are then incrementally reflected in the FTS5 index via `indexPage`.
- `livewiki_resolve_debt` opens `.livewiki/index.db`, runs a transactional `UPDATE debt SET resolved_at = ? WHERE id = ? AND resolved_at IS NULL`, and reports `{ resolved, notFound, writeRef?, timestamp }`.

The server's `close` is augmented to also call `closeSearch(searchIdx)` so the SQLite handle is released even when the caller forgets.

## Server tests (`packages/mcp/src/server.test.ts`)
<!-- lw:anchors packages/mcp/src/server.test.ts#connect packages/mcp/src/server.test.ts#teardown packages/mcp/src/server.test.ts#extractText -->

`connect()` builds a fresh `McpServer` for the per-test `repoRoot`, pairs an MCP `Client` with it through `InMemoryTransport.createLinkedPair()`, and returns both handles so each test can release the FTS5 file locks before `afterEach` recurses through the temp directory (Windows `EBUSY` is the failure mode this avoids).

`teardown(c)` simply awaits `client.close()` followed by `server.close()`. Because the production server's augmented `close` calls `closeSearch`, the SQLite handle is freed in the right order.

`extractText(r)` narrows the discriminated `callTool` result: it confirms `r` is an object with an array `content`, iterates blocks, and concatenates the `text` fields of any block whose `type === "text"`. Non-text blocks and unexpected shapes collapse to `""`, which keeps the assertions focused on textual content rather than the MCP envelope.

The test suite exercises `tools/list`, every tool call with valid input, the allowlist rejection on `livewiki_read` and `livewiki_write_doc`, the broken-anchor rollback on `write_doc`, the `skipVerify` escape hatch, the `notFound` path on `livewiki_resolve_debt`, and the on-disk presence of `.livewiki/search.db`.

## End-to-end Phase 5 harness (`packages/mcp/src/phase5-e2e.test.ts`)
<!-- lw:anchors packages/mcp/src/phase5-e2e.test.ts#runCli packages/mcp/src/phase5-e2e.test.ts#connectMcp packages/mcp/src/phase5-e2e.test.ts#teardown packages/mcp/src/phase5-e2e.test.ts#runVerify -->

The Phase 5 E2E suite drives the real compiled CLI as a subprocess for `init`, `index`, `status`, and `verify`, and drives the MCP server in-process through `InMemoryTransport` for `livewiki_write_doc`. That split is deliberate: subprocess runs exercise the binary the hook and the agent will actually invoke in production, while in-process MCP avoids the flakiness of stdio subprocesses.

`runCli(args, cwd)` spawns `process.execPath` against `packages/cli/dist/index.js` (resolved from the test file's location), forwarding `--repo <cwd>` and capturing stdout, stderr, and the exit code.

`connectMcp(repoRoot)` is the in-process counterpart of `server.test.ts#connect`: it builds the server through `createServer`, instantiates a `Client` named `phase5-e2e-agent`, and links the two via `InMemoryTransport.createLinkedPair()`.

`teardown(c)` closes the client first, then the server, mirroring the order used by the Phase 4 tests so the SQLite handle is released before the temp directory is removed.

`runVerify(repoRoot)` shells out to `livewiki verify --json` via `runCli` and returns `{ ok, exitCode, issues, rawStdout }`. The JSON is parsed directly when possible; otherwise it falls back to a `\{[\s\S]*\}` regex sweep so trailing log lines do not break the assertion path. Per SPEC §Phase 5, the suite asserts the issue count itself (zero errors AND zero warnings) rather than relying solely on the exit code.

The two main scenarios are: the full hook → MCP → verify loop with manifest snapshot comparison, and the broken-anchor write that must roll back without leaving the offending page on disk. A secondary `describe` block verifies that `livewiki init` manages `.gitignore` idempotently — preserving user entries, never duplicating `.livewiki/`, and doing the work even when `--batch` is requested.