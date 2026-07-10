---
title: mcp-src
owner: generated
anchors:
  - packages/mcp/src/index.ts#main
  - packages/mcp/src/index.ts#parseArgs
  - packages/mcp/src/server.ts#createServer
  - packages/mcp/src/search.ts#openAndIndex
  - packages/mcp/src/search.ts#reindexAll
  - packages/mcp/src/search.ts#collectMarkdownFiles
  - packages/mcp/src/search.ts#walk
  - packages/mcp/src/search.ts#indexPage
  - packages/mcp/src/search.ts#removePage
  - packages/mcp/src/search.ts#search
  - packages/mcp/src/search.ts#close
  - packages/mcp/src/server.test.ts#connect
  - packages/mcp/src/server.test.ts#teardown
  - packages/mcp/src/server.test.ts#extractText
  - packages/mcp/src/phase5-e2e.test.ts#runCli
  - packages/mcp/src/phase5-e2e.test.ts#connectMcp
  - packages/mcp/src/phase5-e2e.test.ts#teardown
  - packages/mcp/src/phase5-e2e.test.ts#runVerify
---

# mcp-src

The `@livewiki/mcp` package: stdio entry point, the MCP server itself (6 tools, Fase 4), a SQLite FTS5-backed search index, and two Vitest suites (server integration via `InMemoryTransport`, plus the Fase 5 end-to-end hook→MCP→verify flow that drives a real CLI subprocess).

## CLI entry point (`packages/mcp/src/index.ts`)

<!-- lw:anchors packages/mcp/src/index.ts#main packages/mcp/src/index.ts#parseArgs -->

Stdio entry point. Reads `--repo <path>` (default `process.cwd()`), creates the server, connects `StdioServerTransport`, installs `SIGINT`/`SIGTERM` handlers that call `server.close()` (which closes the FTS5 index) and `process.exit(0)`. Top-level `.catch` writes a fatal line to stderr and exits `1` on setup error. Designed to be launched from an MCP client (Claude Code) via `npx -y @livewiki/mcp --repo <repo>`.

`parseArgs` is a minimal `argv` walker that scans for a `--repo <value>` pair and resolves the value with `nodePath.resolve`; defaults to `process.cwd()` when absent.

## MCP server (`packages/mcp/src/server.ts`)

<!-- lw:anchors packages/mcp/src/server.ts#createServer -->

`createServer` resolves `opts.repoRoot` (default `cwd`), opens the search index via `openAndIndex`, then constructs an `McpServer` named `livewiki`. It registers exactly the six tools defined by SPEC §"MCP tools": `livewiki_quickstart`, `livewiki_read`, `livewiki_search`, `livewiki_debt`, `livewiki_write_doc`, `livewiki_resolve_debt`. Transport is **not** connected here — the caller picks one (index.ts picks stdio).

Two helpers wrap results: `textResult` (text content block) and `errorResult` (text plus `isError: true`). The six tool handlers follow a consistent pattern:

- `livewiki_quickstart` / `livewiki_read` — read via `safeIo.readText`; path outside the `livewiki/` allowlist surfaces as an `errorResult` (or `InvalidParams` `McpError` for `write_doc`).
- `livewiki_search` — delegates to `doSearch(searchIdx, query, { limit? })` and returns `{ query, hits }` JSON.
- `livewiki_debt` — delegates to `runStatus(repoRoot)` (equivalent to `livewiki status --json`).
- `livewiki_write_doc` — writes via `safeIo.writeText` (path allowlist enforced), then runs `runVerify(repoRoot)` unless `skipVerify === true`; if `verify` reports any error-level issue touching the written page, the file is `unlink`-rolled back and an `errorResult` is returned with the first issue code/detail. On success, the page is incrementally indexed via `indexPage`.
- `livewiki_resolve_debt` — opens `.livewiki/index.db` with `openIndex`, runs an `UPDATE debt SET resolved_at = ? WHERE id = ? AND resolved_at IS NULL` per id in a transaction, and returns `{ resolved, notFound, writeRef?, timestamp }`.

`server.close` is augmented to also `closeSearch(searchIdx)` before delegating to the original close, ensuring the FTS5 handle is released on shutdown.

## Search index (`packages/mcp/src/search.ts`)

<!-- lw:anchors packages/mcp/src/search.ts#openAndIndex packages/mcp/src/search.ts#reindexAll packages/mcp/src/search.ts#collectMarkdownFiles packages/mcp/src/search.ts#walk packages/mcp/src/search.ts#indexPage packages/mcp/src/search.ts#removePage packages/mcp/src/search.ts#search packages/mcp/src/search.ts#close -->

A dedicated `.livewiki/search.db` (WAL mode) hosts a `wiki_search` FTS5 virtual table over `(wiki_path UNINDEXED, content)` with the default `porter` tokenizer. Design rationale (in-file): keeping search isolated from `.livewiki/index.db` avoids a schema migration; `search.db` is reconstructible from the wiki; `core` stays FTS5-free.

Lifecycle:

- `openAndIndex` resolves and validates `SEARCH_DB_REL` via `safeIo.resolveAndValidate`, ensures `.livewiki/` exists, opens better-sqlite3 with `journal_mode = WAL`, creates the FTS5 table if missing, and immediately calls `reindexAll`.
- `reindexAll` `DELETE FROM wiki_search`, walks the `livewiki/` tree via `collectMarkdownFiles`, reads each `.md` file, and inserts `(relPath, content)` pairs in a single transaction.
- `collectMarkdownFiles` returns absolute paths and uses the recursive `walk` helper which `readdir`s with `withFileTypes`, recursing into directories and pushing files ending in `.md` (silently returns on `ENOENT` — empty wiki is valid).
- `indexPage` is the incremental write path used by `write_doc`: `DELETE` then `INSERT` for the same `wiki_path` inside a transaction (FTS5 has no native UPSERT).
- `removePage` is `DELETE WHERE wiki_path = ?`; idempotent.
- `search` issues `SELECT wiki_path, snippet(wiki_search, 1, '<<', '>>', '...', 32) ... WHERE wiki_search MATCH ? ORDER BY rank LIMIT ?`. FTS5 syntax errors are swallowed and return `[]`. Default `limit = 20`.
- `close` closes the underlying better-sqlite3 handle; caller responsibility.

## Phase 4 server tests (`packages/mcp/src/server.test.ts`)

<!-- lw:anchors packages/mcp/src/server.test.ts#connect packages/mcp/src/server.test.ts#teardown packages/mcp/src/server.test.ts#extractText -->

Vitest suite that boots a `createServer({ repoRoot })` and an MCP `Client` over `InMemoryTransport.createLinkedPair()`, exercising each of the six tools and the FTS5 side-effects. Every test runs inside `try { ... } finally { await teardown(c) }` — required on Windows because better-sqlite3 holds WAL files open and `nodeFs.rm` would otherwise fail with `EBUSY`.

Helpers:

- `connect` — returns `{ client, server }` after connecting both ends of the linked transport pair.
- `teardown` — `client.close()` then `server.close()` (the latter also closes the FTS5 handle via the augmented close).
- `extractText` — joins all `content[].text` blocks from an MCP `callTool` result, tolerating the discriminated result envelope.

Coverage asserts: `tools/list` returns exactly the six SPEC names (sorted), `livewiki_quickstart`/`livewiki_read` return content, `livewiki_read` rejects paths outside `livewiki/`, `livewiki_search` returns a JSON `{ hits: [...] }` payload, `livewiki_debt` returns the status report shape, `livewiki_write_doc` writes valid pages and incrementally updates FTS5, rejects paths outside `livewiki/` (no file on disk), rejects content with broken anchors (`verify` rollback), and accepts with `skipVerify: true`. `livewiki_resolve_debt` with a bogus ID returns `{ resolved: [], notFound: [9999] }`. A final test asserts `.livewiki/search.db` exists after connect.

## Phase 5 end-to-end tests (`packages/mcp/src/phase5-e2e.test.ts`)

<!-- lw:anchors packages/mcp/src/phase5-e2e.test.ts#runCli packages/mcp/src/phase5-e2e.test.ts#connectMcp packages/mcp/src/phase5-e2e.test.ts#teardown packages/mcp/src/phase5-e2e.test.ts#runVerify -->

Full repo round-trip: `livewiki init` → agent edits a source symbol → `livewiki index --quiet` (the hook) detects drift → `livewiki status --json` shows debt → agent pays via `livewiki_write_doc` over MCP → `livewiki verify --json` returns exit 0 with **zero issues** (errors and warnings) → `livewiki init` updates `manifest.updatedAt` and `manifest.snapshotHash`. Subprocesses run the **real** compiled CLI at `packages/cli/dist/index.js` (the test throws a clear error if `pnpm -r build` was not run); MCP uses `InMemoryTransport` to avoid stdio flakiness.

Helpers:

- `runCli` — spawns `process.execPath [cliBin, ...args, "--repo", cwd]` with piped stdio; resolves to `{ code, stdout, stderr }`.
- `connectMcp` — `createServer({ repoRoot })` paired with a `Client` over `InMemoryTransport.createLinkedPair()`; returns `{ client, server }`.
- `teardown` — `client.close()` then `server.close()`.
- `runVerify` — invokes `runCli(["verify","--json"], repoRoot)` and parses stdout, falling back to a JSON-substring regex if the raw stdout isn't pure JSON. Returns `{ ok, exitCode, issues, rawStdout }` where `issues` carry `severity`, `kind`, `detail`, optional `wikiPath`.

Additional behaviour asserted by this file: `write_doc` rejecting an anchor that names a non-existent symbol rolls back the file; and the reviewer finding **(R)** — `livewiki init` must add `.livewiki/` to the repo's `.gitignore` inside a managed `# livewiki:start`/`# livewiki:end` block, preserving user entries, idempotent on re-run, and respecting a pre-existing user-added `.livewiki/` entry without duplicating it (the `--batch` variant is also exercised, though a missing LLM config is tolerated).
