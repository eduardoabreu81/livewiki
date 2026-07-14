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

## MCP stdio entry point

<!-- lw:anchors packages/mcp/src/index.ts#main packages/mcp/src/index.ts#parseArgs -->

The `packages/mcp/src/index.ts` module is the stdio entry point for `@livewiki/mcp` (Phase 4). It parses CLI arguments, creates an `McpServer`, and connects it to a `StdioServerTransport`. Typical usage is via the Claude Code MCP server config (`command: npx`, `args: ["-y", "@livewiki/mcp", "--repo", "/path/to/repo"]`). Exit codes: `0` for clean shutdown, `1` for setup error (invalid repo, etc.).

`parseArgs(argv)` walks `argv` looking for `--repo <path>` and resolves it against the filesystem; if absent, it falls back to `process.cwd()`. It returns `{ repoRoot }`.

`main()` calls `parseArgs(process.argv.slice(2))`, awaits `createServer({ repoRoot })`, connects the server to a new `StdioServerTransport`, and installs `SIGINT`/`SIGTERM` handlers that call `server.close()` and `process.exit(0)`. A top-level `.catch` writes a fatal message to stderr and exits with code `1`.

## Search index (FTS5)

<!-- lw:anchors packages/mcp/src/search.ts#openAndIndex packages/mcp/src/search.ts#reindexAll packages/mcp/src/search.ts#collectMarkdownFiles packages/mcp/src/search.ts#walk packages/mcp/src/search.ts#indexPage packages/mcp/src/search.ts#removePage packages/mcp/src/search.ts#search packages/mcp/src/search.ts#close -->

`packages/mcp/src/search.ts` implements full-text indexing and search over the wiki using SQLite FTS5. Design notes:

- A separate `.livewiki/search.db` is used (not a virtual table inside `.livewiki/index.db`) to avoid bumping the index DB schema and to keep `core` independent of FTS5. `search.db` is rebuildable from the wiki.
- Tokenizer is the FTS5 default (`porter`) — suitable for English/Portuguese without extra normalization.
- Startup strategy is full rebuild (idempotent, fast for ~1000-page repos); `write_doc` updates incrementally via `indexPage`.

`openAndIndex(repoRoot)` resolves the absolute root, validates `.livewiki/search.db` through `@livewiki/core/safe-io`, ensures `.livewiki/` exists, opens the DB with WAL, creates the `wiki_search(wiki_path UNINDEXED, content)` virtual table if missing, then calls `reindexAll`.

`reindexAll(db, absRoot)` deletes all rows, walks the `livewiki/` tree via `collectMarkdownFiles`, reads each `.md` file (skipping unreadable entries), and inserts them in a single transaction.

`collectMarkdownFiles(dir)` returns absolute paths to every `.md` file under `dir`. It defines an inner `walk(d)` that recurses through directories and appends file entries whose name ends in `.md`; missing directories yield an empty result.

`indexPage(idx, wikiPath, content)` performs a DELETE + INSERT inside a transaction (FTS5 has no native UPSERT) to add or refresh one page.

`removePage(idx, wikiPath)` deletes the row for a single wiki path. Idempotent.

`search(idx, query, opts)` runs `MATCH ?` against `wiki_search`, ordered by rank, with `snippet(..., 1, '<<', '>>', '...', 32)` for highlight markers. Limit defaults to 20 (max 100 via caller). FTS5 syntax errors are caught and return `[]` rather than throwing.

`close(idx)` closes the underlying `Database.Database` handle. The MCP server wraps this into `server.close` so search index lifecycle follows server lifecycle.

## MCP server core

<!-- lw:anchors packages/mcp/src/server.ts#createServer -->

`packages/mcp/src/server.ts` implements the `McpServer` and its six tools (per SPEC §"MCP tools"):

- `livewiki_quickstart` — returns `livewiki/quickstart.md`.
- `livewiki_read` — reads a wiki page by relative path inside `livewiki/`.
- `livewiki_search` — FTS5 full-text search with optional `limit`.
- `livewiki_debt` — equivalent to `livewiki status --json`.
- `livewiki_write_doc` — validates allowlist, runs `verify`, then commits (with rollback on failure).
- `livewiki_resolve_debt` — marks debt rows as paid by id.

`createServer(opts)` resolves `opts.repoRoot ?? process.cwd()`, opens the search index via `openAndIndex`, constructs the `McpServer` (`name: "livewiki"`, `capabilities.tools`), then registers each tool.

`livewiki_quickstart` reads `livewiki/quickstart.md` via `safeIo.readText`. Errors return `errorResult(...)`.

`livewiki_read` accepts `{ path: string }` (zod-validated, non-empty). It reads via `safeIo.readText`; errors are surfaced without leaking absolute paths or repo content.

`livewiki_search` accepts `{ query, limit? }`. It calls `doSearch(searchIdx, query, { limit })` and returns JSON `{ query, hits }`. The internal `SearchOptions.limit` defaults to 20.

`livewiki_debt` runs `runStatus(repoRoot)` (from `@livewiki/core/status`) and stringifies the report.

`livewiki_write_doc` is the critical write path:

1. Allowlist: `safeIo.writeText(repoRoot, path, content)`. `PathOutsideAllowlistError` → `McpError(InvalidParams, ...)`. `InvalidRelativePathError` → `McpError(InvalidParams, ...)`. Other errors → `errorResult`.
2. Verify (unless `skipVerify === true`): runs `runVerify(repoRoot)`; any `severity === "error"` issue whose `wikiPath` matches the written path (or is empty) triggers rollback via `nodeFs.unlink` on the resolved path and returns `errorResult("verify rejected …")`. If `verify` itself crashes (not a validation error), the write still succeeds with a warning message ("wrote … (verify step crashed …)").
3. On success, `indexPage(searchIdx, path, content)` updates the FTS5 index incrementally.

`livewiki_resolve_debt` accepts `{ debtIds: number[], writeRef?: string }`. It opens `.livewiki/index.db` via `openIndex`, runs `UPDATE debt SET resolved_at = ? WHERE id = ? AND resolved_at IS NULL` per id inside a transaction, and reports `{ resolved, notFound, writeRef?, timestamp }`. The DB is closed in `finally`.

Cleanup: `createServer` patches `server.close` to also call `closeSearch(searchIdx)` before delegating to the original close, ensuring search index teardown on shutdown. The `SearchIndex` type is re-exported for tests.

## Server tests (Phase 4 InMemoryTransport)

<!-- lw:anchors packages/mcp/src/server.test.ts#connect packages/mcp/src/server.test.ts#teardown packages/mcp/src/server.test.ts#extractText -->

`packages/mcp/src/server.test.ts` is the Phase 4 E2E suite. Setup creates a temp repo, makes `.livewiki/`, `src/auth/`, `src/utils/`, writes two source files, and calls `runInit({ repoRoot, quiet: true })`. Teardown removes the temp dir recursively.

`connect()` builds the server via `createServer({ repoRoot })`, instantiates an MCP `Client` (`name: "test-agent"`), creates a linked `InMemoryTransport` pair, and connects both ends in parallel. Returns `{ client, server }` so each test can close them in `finally` (necessary on Windows to release FTS5 WAL file locks before `afterEach` removes the repo).

`teardown(c)` closes `client` then `server`.

`extractText(r)` normalizes the MCP `callTool` result: it iterates `r.content` (when present and an array), keeps blocks whose `type === "text"`, and concatenates their `text` fields. Returns `""` for non-object or missing `content`.

Suite highlights (asserted through `connect`/`teardown`/`extractText`):

- `tools/list` returns the canonical 6 names sorted.
- `livewiki_quickstart` text matches `/Quickstart|Guia/`.
- `livewiki_read` succeeds for `livewiki/quickstart.md`.
- `livewiki_read` rejects paths outside `livewiki/` (`src/auth/login.ts`) with `isError: true` and an allowlist/outside/livewiki message.
- `livewiki_search` returns `{ hits: [] | [...] }` JSON.
- `livewiki_debt` returns `{ files, symbols, debt, undocumented }`.
- `livewiki_write_doc` writes a valid scratch page, rejects paths outside `livewiki/`, rejects content with broken anchors (`verify rejected`), and accepts with `skipVerify: true`.
- `livewiki_resolve_debt` with no open debt returns `{ resolved: [], notFound: [9999] }`.
- `search_db` exists at `.livewiki/search.db` after server creation.

## Phase 5 E2E (hook → MCP → verify)

<!-- lw:anchors packages/mcp/src/phase5-e2e.test.ts#runCli packages/mcp/src/phase5-e2e.test.ts#connectMcp packages/mcp/src/phase5-e2e.test.ts#teardown packages/mcp/src/phase5-e2e.test.ts#runVerify -->

`packages/mcp/src/phase5-e2e.test.ts` is the Phase 5 acceptance suite: an agent edits source, a hook detects the change, the agent pays the debt via `livewiki_write_doc`, and `livewiki verify` reports zero issues. It uses real subprocess CLI calls for `init`/`index`/`verify`/`status` and an in-process MCP connection (`InMemoryTransport`) for `write_doc`. The test assumes `pnpm -r build` has produced `packages/cli/dist/index.js`.

`runCli(args, cwd)` spawns `process.execPath` with `[cliBin, ...args, "--repo", cwd]`, captures stdout/stderr via `'data'` listeners, and resolves to `{ code, stdout, stderr }`. Used for `init`, `index`, `index --quiet`, `status --json`, and `verify --json`.

`connectMcp(repoRoot)` builds the server with `createServer({ repoRoot })`, creates an MCP `Client` (`name: "phase5-e2e-agent"`), links it to the server via `InMemoryTransport.createLinkedPair()`, and returns `{ client, server }`. Returned objects are closed in `finally` blocks to release the FTS5 WAL on Windows.

`teardown(c)` closes `client` then `server`.

`runVerify(repoRoot)` calls `runCli(["verify", "--json"], repoRoot)` and parses the stdout as JSON into `{ ok, exitCode, issues, rawStdout }`. If `JSON.parse` fails, it falls back to extracting the first `{...}` block via regex. `issues` defaults to `[]`.

Suite coverage:

- Full flow: `init` → write initial anchored page → `index` (capture manifest `updatedAt`) → modify source body of `validate` → `index --quiet` (quiet mode = empty stdout) → `status --json` asserts `debt.total >= 1` and that an item with `symbol_key === "src/auth.ts#validate"` exists with `event: "changed"` and `wiki_path: "livewiki/auth.md"` → `write_doc` with updated page → `verify` asserts `exitCode === 0`, `issues.length === 0`, `ok === true` → re-`init` asserts `manifest.updatedAt` and `manifest.snapshotHash` changed → final `status --json` asserts `debt.total` decreased.
- Rejection + rollback: `write_doc` with an anchor pointing at a non-existent symbol returns `isError: true`; the on-disk file either does not exist or does not contain the broken anchor.
- Achado R (`.gitignore`): `init` creates `.gitignore` with `.livewiki/` inside `# livewiki:start` / `# livewiki:end` blocks; preserves pre-existing user entries (append, not overwrite); is idempotent (no duplicate `.livewiki/` entry, second `init` produces byte-identical file); respects a pre-existing user-level `.livewiki/` entry (no duplication); `init --batch` must perform the gitignore work before any batch step.

> TODO: link to livewiki SPEC §"Fase 4" and §"Fase 5" referenced in this module — referenced but not included in the provided sources.