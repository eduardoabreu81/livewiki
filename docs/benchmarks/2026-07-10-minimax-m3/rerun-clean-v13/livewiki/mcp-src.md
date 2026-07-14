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

## index.ts entry point
<!-- lw:anchors packages/mcp/src/index.ts#main packages/mcp/src/index.ts#parseArgs -->

The stdio entry point for `@livewiki/mcp`. It resolves the target repository from the `--repo` CLI flag (falling back to `process.cwd()`), creates the MCP server, and connects it to a `StdioServerTransport`. Process exit codes are `0` for clean shutdown and `1` for setup failures. The process installs `SIGINT` and `SIGTERM` handlers that close the server (which in turn closes the FTS5 index) before exiting.

`parseArgs` walks `argv` once, looking for `--repo` and consuming the following token as the repo root (resolved via `nodePath.resolve`). It always returns an object with a `repoRoot` string; unknown flags are ignored. `main` is an async function that takes no arguments, calls `parseArgs(process.argv.slice(2))`, awaits `createServer({ repoRoot })`, connects the resulting `McpServer` to stdio, and registers the signal handlers described above. Any rejected promise from `main()` is caught at module bottom and converted into a fatal stderr message plus `process.exit(1)`.

## search.ts FTS5 index
<!-- lw:anchors packages/mcp/src/search.ts#openAndIndex packages/mcp/src/search.ts#reindexAll packages/mcp/src/search.ts#collectMarkdownFiles packages/mcp/src/search.ts#walk packages/mcp/src/search.ts#indexPage packages/mcp/src/search.ts#removePage packages/mcp/src/search.ts#search packages/mcp/src/search.ts#close -->

`search.ts` owns the full-text index used by `livewiki_search`. The index lives in `.livewiki/search.db` (a dedicated file, not a virtual table inside `.livewiki/index.db`, to keep `core` free of FTS5 and to make the search index cheaply rebuildable). The schema is one FTS5 virtual table named `wiki_search` with two columns: `wiki_path UNINDEXED` and `content` (porter tokenizer).

`openAndIndex` resolves the repo root, ensures `.livewiki/` exists via `safeIo.mkdir`, opens `search.db` with WAL journaling, creates the FTS5 schema if missing, and triggers a full rebuild through `reindexAll` before returning a `SearchIndex` handle that wraps the `Database` instance.

`reindexAll` clears the FTS5 table, enumerates the `livewiki/` directory through `collectMarkdownFiles`, reads each `.md` file, and bulk-inserts the (relative path, content) tuples in a single transaction. Files that fail to read are skipped silently. `collectMarkdownFiles` is a thin wrapper around the recursive `walk` helper, which descends into directories, collects `.md` files, and tolerates a missing root directory (treated as an empty wiki).

`indexPage` is the incremental update path used by `write_doc`: because FTS5 has no native UPSERT, it wraps a `DELETE` + `INSERT` on `wiki_path` in a transaction. `removePage` deletes a single row by `wiki_path` and is idempotent. `search` runs an `MATCH` query with a `snippet(...)` projection (delimiters `<<` / `>>`, ellipsis `...`, 32 tokens of context), orders by FTS5 `rank`, and respects a caller-supplied `limit` (default 20, capped at 100 by the caller in `server.ts`). Syntax errors in the FTS5 expression are caught and converted to an empty result rather than thrown. `close` simply calls `idx.db.close()` and is the cleanup hook invoked from `server.close`.

## server.ts MCP tools
<!-- lw:anchors packages/mcp/src/server.ts#createServer -->

`createServer` is the single factory that wires up all six MCP tools defined by SPEC §"Fase 4": `livewiki_quickstart`, `livewiki_read`, `livewiki_search`, `livewiki_debt`, `livewiki_write_doc`, and `livewiki_resolve_debt`. It resolves the repo root (defaulting to `process.cwd()`), eagerly opens the FTS5 search index via `openAndIndex`, constructs an `McpServer` named `"livewiki"` with `tools: {}` capabilities, and returns the configured server without attaching a transport — that is the caller's responsibility (see `index.ts#main`, which uses `StdioServerTransport`).

Internal helpers `textResult` and `errorResult` shape MCP tool results into the standard `{ content: [{ type: "text", text }] }` envelope, with `errorResult` additionally setting `isError: true`. `livewiki_write_doc` is the security-critical tool: it writes through `safeIo.writeText` (which enforces the `livewiki/` allowlist and rejects symlink escapes with `PathOutsideAllowlistError`), then runs `runVerify(repoRoot)` unless the caller passes `skipVerify: true`. Any error-level verify issue whose `wikiPath` matches the written path causes an atomic rollback (`fs.unlink` on the resolved path) and an `errorResult` describing the first issue. Successful writes call `indexPage` to refresh the FTS5 index. `livewiki_resolve_debt` opens `.livewiki/index.db` via `openIndex`, runs an `UPDATE debt SET resolved_at = ? WHERE id = ? AND resolved_at IS NULL` statement per ID inside a transaction, and reports `resolved` / `notFound` arrays along with an optional `writeRef` audit hint. `server.close` is augmented to call `closeSearch(searchIdx)` before delegating to the original `close`.

## server.test.ts helpers
<!-- lw:anchors packages/mcp/src/server.test.ts#connect packages/mcp/src/server.test.ts#teardown packages/mcp/src/server.test.ts#extractText -->

The Fase 4 E2E suite spins up an MCP server and an MCP client over a linked `InMemoryTransport` pair, exercising the six tools through the real protocol. The shared `beforeEach` creates a temp repo with a populated `src/` tree and runs `runInit({ repoRoot, quiet: true })` so the wiki + index exist before each test; `afterEach` removes the temp tree recursively.

`connect` instantiates `createServer({ repoRoot })`, constructs a `Client` named `"test-agent"`, allocates an `InMemoryTransport.createLinkedPair()`, and awaits both `client.connect(clientT)` and `server.connect(serverT)` in parallel, returning a `{ client, server }` handle. `teardown` closes both ends (`client.close()` then `server.close()`); closing explicitly matters on Windows because better-sqlite3 holds a WAL file lock on `search.db` and `afterEach`'s recursive `rm` would otherwise fail with `EBUSY`. `extractText` normalizes the discriminated union returned by `client.callTool` by iterating `result.content`, keeping only entries with `type === "text"`, and concatenating their `text` strings — tests use it to assert on the textual payload regardless of how the MCP SDK shapes non-error returns.

## phase5-e2e.test.ts helpers
<!-- lw:anchors packages/mcp/src/phase5-e2e.test.ts#runCli packages/mcp/src/phase5-e2e.test.ts#connectMcp packages/mcp/src/phase5-e2e.test.ts#teardown packages/mcp/src/phase5-e2e.test.ts#runVerify -->

The Fase 5 suite validates the full hook → MCP → verify loop end-to-end. The strategy is mixed-mode: real CLI subprocesses for `init`, `index`, `status`, `verify`, and `verify --json` (so the actual binary is exercised, not a mock), and an in-process MCP server for `livewiki_write_doc` calls (matching the same `InMemoryTransport` pattern used by the Fase 4 tests). The CLI binary path is resolved relative to the test file as `packages/cli/dist/index.js`; the file throws at module load if the binary is absent (the suite assumes `pnpm -r build` has been run).

`runCli` spawns `process.execPath` with the resolved CLI path, forwards `args`, appends `--repo <cwd>`, captures `stdout` / `stderr` as strings, and resolves with `{ code, stdout, stderr }` on `close` (or rejects on `error`). `connectMcp` mirrors the Fase 4 helper but tags the client as `"phase5-e2e-agent"`. `teardown` closes the client first, then the server. `runVerify` invokes `runCli(["verify", "--json"], repoRoot)`, prefers a direct `JSON.parse(r.stdout)`, and falls back to extracting the first balanced `{...}` block from stdout before returning `{ ok, exitCode, issues, rawStdout }` — the `issues` array is the unit the assertions check, not just the exit code, per SPEC §"Fase 5". The suite also contains a second `describe` block ("Achado R") that verifies `livewiki init` manages a `.gitignore` block (`# livewiki:start` / `# livewiki:end`) containing `.livewiki/`, preserves user entries, and is idempotent across repeated `init` runs (including `init --batch`).