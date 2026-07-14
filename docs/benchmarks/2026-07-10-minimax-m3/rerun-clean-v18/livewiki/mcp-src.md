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

## CLI entry point

<!-- lw:anchors packages/mcp/src/index.ts#main packages/mcp/src/index.ts#parseArgs -->

The `index.ts` file is the stdio entry point for `@livewiki/mcp`. It reads the optional `--repo` flag from `process.argv`, instantiates the server, and wires it to a `StdioServerTransport`. The process stays alive while the MCP client is connected and exits with code `0` on `SIGINT`/`SIGTERM` (after best-effort `server.close()`) or code `1` if `main()` rejects.

`parseArgs` walks `argv` looking for `--repo <path>`; when found it resolves the next argument against the current working directory and returns `{ repoRoot }`. If the flag is absent, `repoRoot` defaults to `process.cwd()`. The function does not validate that the path exists — that is the caller's responsibility.

## Search index (FTS5)

<!-- lw:anchors packages/mcp/src/search.ts#close packages/mcp/src/search.ts#collectMarkdownFiles packages/mcp/src/search.ts#indexPage packages/mcp/src/search.ts#openAndIndex packages/mcp/src/search.ts#reindexAll packages/mcp/src/search.ts#removePage packages/mcp/src/search.ts#search packages/mcp/src/search.ts#walk -->

`search.ts` wraps a separate SQLite FTS5 database at `.livewiki/search.db` (WAL mode, schema `wiki_search(wiki_path UNINDEXED, content)`). The rationale documented in the file header is that `.livewiki/index.db` is on a careful migration track, and a rebuildable side index keeps `core` free of an FTS5 dependency.

`openAndIndex` resolves the repo root, validates `.livewiki/search.db` through `safeIo.resolveAndValidate`, ensures `.livewiki/` exists, opens the DB, and triggers a full reindex before returning the `{ db }` handle. `reindexAll` empties the table inside a transaction and re-inserts every page's `wiki_path` + `content`. `collectMarkdownFiles` recursively walks a directory using the nested `walk` helper, returning absolute paths of every `*.md` file (missing directories are silently treated as an empty wiki).

Per-page updates go through `indexPage` (a DELETE + INSERT in a transaction — FTS5 has no native UPSERT) and `removePage` (a single DELETE; idempotent if the row is absent). `search` runs a `MATCH` query with a configurable `limit` (default 20, capped at 100 by the server) and returns `SearchHit[]` with a `snippet(...)` projection bounded by 32 tokens. Invalid FTS5 expressions are caught and degrade to an empty result. `close` closes the underlying `Database` handle; the server wires this into its own `close()` override so a graceful shutdown releases the file.

## Server

<!-- lw:anchors packages/mcp/src/server.ts#createServer -->

`createServer` is the only public entry point of the MCP module. It resolves `repoRoot` (defaulting to `process.cwd()`), opens the search index via `openAndIndex`, then constructs an `McpServer` and registers the six tools defined in SPEC §"MCP tools": `livewiki_quickstart`, `livewiki_read`, `livewiki_search`, `livewiki_debt`, `livewiki_write_doc`, and `livewiki_resolve_debt`. The function does not connect a transport — `index.ts` does that with stdio.

All write paths funnel through `safeIo` (allowlist check plus symlink resolution); `livewiki_write_doc` additionally runs `verify` against the repo and rolls the file back when an error-level issue is reported against the just-written page. `skipVerify=true` opts out of that step for legitimate non-anchor pages (e.g. `quickstart`). On success the page is incrementally indexed via `indexPage`. The `server.close` method is overridden to also `closeSearch` before delegating to the SDK implementation.

## Server tests (Phase 4)

<!-- lw:anchors packages/mcp/src/server.test.ts#connect packages/mcp/src/server.test.ts#teardown packages/mcp/src/server.test.ts#extractText -->

`server.test.ts` exercises the MCP server end-to-end through `InMemoryTransport`. Each test calls `connect` to spin up an `McpServer` + `Client` pair, runs assertions against tool responses, and finishes with `teardown` so both sides close before `afterEach` removes the temp repo (necessary to release the FTS5 WAL files on Windows). The shared `extractText` helper flattens the discriminated `callTool` result into a single string by concatenating every `content[].text` block whose `type === "text"`.

The suite covers `tools/list` returning the expected six tool names, `livewiki_quickstart` and `livewiki_read` happy paths, the allowlist rejection of `src/auth/login.ts`, `livewiki_search` returning a `hits` array, the `livewiki_debt` JSON shape (`files`, `symbols`, `debt`, `undocumented`), `livewiki_write_doc` accepting valid content, rejecting out-of-allowlist paths, rejecting broken-anchor content with a "verify rejected" message, accepting `skipVerify=true`, `livewiki_resolve_debt` returning `{ resolved: [], notFound: [9999] }` for unknown IDs, and the presence of `.livewiki/search.db` on disk.

## Phase 5 E2E helpers

<!-- lw:anchors packages/mcp/src/phase5-e2e.test.ts#connectMcp packages/mcp/src/phase5-e2e.test.ts#runCli packages/mcp/src/phase5-e2e.test.ts#runVerify packages/mcp/src/phase5-e2e.test.ts#teardown -->

`phase5-e2e.test.ts` orchestrates the full hook → MCP → verify loop, mixing real subprocess calls to the compiled CLI with in-process MCP traffic. `runCli` spawns `process.execPath` against `packages/cli/dist/index.js`, always appending `--repo <cwd>`, and resolves with `{ code, stdout, stderr }`. It throws the test suite outright at import time if the CLI binary is missing, with a message instructing the developer to run `pnpm -r build`.

`connectMcp` mirrors the server test helper: it constructs an `McpServer` via `createServer`, builds a `Client` named `phase5-e2e-agent`, links an `InMemoryTransport` pair, and connects both sides. `teardown` closes the client first then the server (so the FTS5 handle is released before the test cleans the temp directory). `runVerify` shells out to `livewiki verify --json`, parses stdout, and falls back to extracting the first `{...}` block when the strict `JSON.parse` fails; the returned `VerifyOutput` carries `ok`, `exitCode`, `issues[]`, and the raw `stdout` so test assertions can include diagnostic context.