---
title: "@livewiki/mcp"
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

# @livewiki/mcp

Reference documentation for the `@livewiki/mcp` package: the MCP stdio entry point, server construction, the SQLite FTS5 search subsystem, and the two end-to-end test suites (Phase 4 server tests and Phase 5 agent flow tests).

## CLI entry point (`index.ts`)
<!-- lw:anchors packages/mcp/src/index.ts#main packages/mcp/src/index.ts#parseArgs -->

Stdio entry point for Phase 4. Reads `--repo` from the CLI (default `cwd`), creates the server, and connects it to `StdioServerTransport`. The process stays alive while the MCP client is connected.

**Exit codes:** `0` clean shutdown, `1` setup error (e.g. invalid repo).

**`parseArgs(argv)`** scans `argv` for `--repo <path>` and resolves the value to an absolute path via `nodePath.resolve`. Falls back to `process.cwd()` when `--repo` is absent or has no following argument. Returns `{ repoRoot: string }`.

**`main()`** calls `parseArgs(process.argv.slice(2))`, builds the server with `createServer({ repoRoot })`, attaches a `StdioServerTransport`, and registers `SIGINT`/`SIGTERM` handlers that call `server.close()` (which closes the FTS5 index) before `process.exit(0)`. Unhandled rejections from `main()` write to stderr and exit with code `1`.

## MCP server (`server.ts`)
<!-- lw:anchors packages/mcp/src/server.ts#createServer -->

`createServer(opts?)` constructs and configures an `McpServer` exposing the six tools defined by the SPEC (Phase 4). It does **not** connect a transport — the caller (`index.ts` for stdio, tests for `InMemoryTransport`) is responsible for `server.connect(...)`.

The function resolves `repoRoot` to an absolute path, opens the FTS5 search index via `openAndIndex(repoRoot)`, and registers the tools below. All file reads and writes go through `@livewiki/core/safe-io`; all errors surface as `McpError` with standard MCP `ErrorCode`s (`InvalidParams`, `InvalidRequest`, `InternalError`).

**Tools (high-level):**

- `livewiki_quickstart` — returns `livewiki/quickstart.md` (low-token entry point).
- `livewiki_read` — reads a wiki page by relative path. Rejects paths outside the `livewiki/` allowlist.
- `livewiki_search` — FTS5 full-text search, supports AND/OR, prefix `term*`, exact `"phrase"`, `limit` (default 20, max 100).
- `livewiki_debt` — `livewiki status --json` payload (files / symbols / debt / undocumented).
- `livewiki_write_doc` — writes/updates a page. Validates the path against the allowlist **and** runs `verify` on the result; rolls back the file on verify failure. `skipVerify: true` opts out (escape hatch for non-anchor pages).
- `livewiki_resolve_debt` — marks debt rows as paid by ID, returns `{ resolved, notFound, writeRef?, timestamp }`.

`server.close` is augmented to also call `closeSearch(searchIdx)` so the FTS5 database is released on shutdown.

## Search index (`search.ts`)
<!-- lw:anchors packages/mcp/src/search.ts#openAndIndex packages/mcp/src/search.ts#reindexAll packages/mcp/src/search.ts#collectMarkdownFiles packages/mcp/src/search.ts#walk packages/mcp/src/search.ts#indexPage packages/mcp/src/search.ts#removePage packages/mcp/src/search.ts#search packages/mcp/src/search.ts#close -->

FTS5-based full-text search over the wiki. The database lives at `.livewiki/search.db` (separate from `.livewiki/index.db` so the core schema is not forced to migrate) and is rebuilt in full on every `openAndIndex` call.

**`openAndIndex(repoRoot)`** resolves the DB path through `safeIo.resolveAndValidate`, ensures `.livewiki/` exists, opens the DB with `journal_mode = WAL`, creates the `wiki_search` FTS5 virtual table (`wiki_path UNINDEXED, content`) if missing, then calls `reindexAll`.

**`reindexAll(db, absRoot)`** truncates the table, collects every `.md` file under `livewiki/`, and bulk-inserts `(wiki_path, content)` rows inside a transaction. Unreadable files are silently skipped.

**`collectMarkdownFiles(dir)`** — recursive markdown collector. The inner `walk(d)` helper reads `dir` with `withFileTypes`, recurses into directories, and collects files ending in `.md`. A missing directory yields an empty list (empty wiki is a valid state).

**`indexPage(idx, wikiPath, content)`** — incremental upsert. FTS5 has no native UPSERT, so it runs `DELETE … WHERE wiki_path = ?` followed by `INSERT …` inside a transaction. Called by `write_doc` on every successful write.

**`removePage(idx, wikiPath)`** — deletes a single row by `wiki_path`. Idempotent (no error when the row is absent).

**`search(idx, query, opts?)`** — runs `WHERE wiki_search MATCH ? ORDER BY rank LIMIT ?`, returns `{ wikiPath, snippet }` with a 32-token snippet delimited by `<<…>>`. FTS5 syntax errors are caught and surfaced as an empty hit list rather than a thrown error.

**`close(idx)`** — closes the underlying `Database` connection. The `server.ts` `createServer` augments `McpServer.close` to invoke this on shutdown.

## Server tests (`server.test.ts`)
<!-- lw:anchors packages/mcp/src/server.test.ts#connect packages/mcp/src/server.test.ts#teardown packages/mcp/src/server.test.ts#extractText -->

Phase 4 E2E tests that drive the MCP server through `InMemoryTransport` (no real stdio). `beforeEach` builds a fresh temp repo with two source files, then runs `runInit({ repoRoot, quiet: true })` programmatically. `afterEach` recursively `rm`s the temp dir — `teardown` must run first to release the FTS5 WAL on Windows (EBUSY otherwise).

**`connect()`** — returns `{ client, server }` linked via `InMemoryTransport.createLinkedPair()`. Always paired with `teardown` in a `finally` block.

**`teardown(c)`** — `await client.close()` then `await server.close()` (the latter invokes the augmented close that also closes the search DB).

**`extractText(r)`** — tolerates the discriminated `callTool` return shape: walks `r.content` and concatenates blocks where `type === "text"` and `text` is a string. Returns `""` for non-object or empty inputs.

Test coverage asserts: `tools/list` returns the six SPEC tools, `quickstart`/`read` return content, `read`/`write_doc` reject paths outside `livewiki/`, `write_doc` accepts valid content and updates the on-disk file, `write_doc` rolls back on `verify` rejection of broken anchors, `write_doc` honors `skipVerify: true`, `resolve_debt` returns `{ resolved: [], notFound: [9999] }` for unknown IDs, and `.livewiki/search.db` exists after connect.

## Phase 5 E2E (`phase5-e2e.test.ts`)
<!-- lw:anchors packages/mcp/src/phase5-e2e.test.ts#runCli packages/mcp/src/phase5-e2e.test.ts#connectMcp packages/mcp/src/phase5-e2e.test.ts#runVerify packages/mcp/src/phase5-e2e.test.ts#teardown -->

End-to-end "agent pays debt" flow per SPEC §Fase 5: hook detects → agent pays via MCP → `verify` clean (exit 0 **and** zero issues of any severity) → manifest updated. Uses the compiled CLI binary (`packages/cli/dist/index.js`) via subprocess for `init`/`index`/`status`/`verify`, and `InMemoryTransport` for MCP (so it exercises the same client MCP the agent uses in production, without stdio flakiness).

**`runCli(args, cwd)`** — `spawn(process.execPath, [cliBin, ...args, "--repo", cwd])` with `stdio: ["ignore", "pipe", "pipe"]`, returning `{ code, stdout, stderr }`.

**`connectMcp(repoRoot)`** — wraps `createServer({ repoRoot })` and an MCP `Client` linked via `InMemoryTransport.createLinkedPair()`. Returns `{ client, server }`; both must be closed via `teardown` to release the FTS5 WAL.

**`teardown(c)`** — `await client.close()` then `await server.close()`.

**`runVerify(repoRoot)`** — runs `livewiki verify --json` via `runCli`, parses stdout as JSON (with a regex fallback that extracts the first `{…}` block), and returns `{ ok, exitCode, issues, rawStdout }`. Used to assert both `exitCode === 0` **and** `issues.length === 0`, per the SPEC criterion.

The "happy path" test walks `init` → initial `livewiki_write_doc` of an anchored page → `index` (to record the pre-edit hash) → mutate the source body of `src/auth.ts#validate` → `index --quiet` (hook) → `status --json` asserts a `changed` debt item for `src/auth.ts#validate` → second `livewiki_write_doc` with updated content → `runVerify` asserts `exitCode === 0` and `issues.length === 0` → re-`init` to refresh the manifest snapshot → `status` asserts debt did not increase.

A second test asserts that `livewiki_write_doc` rejects a page whose anchor points to a non-existent symbol and rolls back (the file is either absent or still the previous good content — no `ghostSymbol` substring).

The "Achado R" `describe` block covers `livewiki init` adding `.livewiki/` to the repo's `.gitignore` inside a managed block delimited by `# livewiki:start` / `# livewiki:end`: it creates the file when missing, appends without overwriting pre-existing user entries, is idempotent across re-runs, does not duplicate a user-authored `.livewiki/` entry, and runs the gitignore work even under `init --batch`.