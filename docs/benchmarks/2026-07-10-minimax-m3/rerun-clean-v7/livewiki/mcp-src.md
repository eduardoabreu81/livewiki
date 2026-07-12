---
title: "@livewiki/mcp — server, search, and E2E tests"
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

# `@livewiki/mcp` — server, search, and E2E tests

The `@livewiki/mcp` package exposes the livewiki MCP server over stdio and
ships with end-to-end tests covering the Phase 4 tool surface and the Phase 5
hook → MCP → verify flow.

## Process entry point (`index.ts`)

<!-- lw:anchors packages/mcp/src/index.ts#main packages/mcp/src/index.ts#parseArgs -->

The entry point parses CLI args, builds the MCP server, and connects it to a
`StdioServerTransport`. Exit codes: `0` clean shutdown, `1` setup error.

- **`parseArgs(argv)`** — scans `argv` for `--repo <path>`, resolving the
  value via `nodePath.resolve`. Defaults to `process.cwd()` when the flag is
  absent.
- **`main()`** — resolves the repo root, creates the server, connects the
  stdio transport, and installs `SIGINT`/`SIGTERM` handlers that call
  `server.close()` (best-effort, swallowing exceptions) before
  `process.exit(0)`. Unhandled rejections from `main()` are logged to stderr
  and exit with code `1`.

## MCP server (`server.ts`)

<!-- lw:anchors packages/mcp/src/server.ts#createServer -->

- **`createServer(opts?)`** — constructs and configures an `McpServer` with
  six tools (see SPEC §"MCP tools"). `opts.repoRoot` defaults to
  `process.cwd()`. The function opens the FTS5 search index via
  `openAndIndex`, registers each tool, and wraps `server.close` to also
  `closeSearch(searchIdx)` on shutdown. The transport is **not** connected
  by `createServer` — the caller (`index.ts`) owns that.

Tools registered: `livewiki_quickstart`, `livewiki_read`, `livewiki_search`,
`livewiki_debt`, `livewiki_write_doc`, `livewiki_resolve_debt`.

### `write_doc` validation

`write_doc` enforces two gates before persisting:

1. **Allowlist** — `safeIo.writeText` resolves and validates the path. Paths
   outside `livewiki/` raise `PathOutsideAllowlistError` (mapped to
   `McpError` `InvalidParams`). `InvalidRelativePathError` is also mapped to
   `InvalidParams`.
2. **Verify** — when `skipVerify !== true`, `runVerify(repoRoot)` runs on
   the freshly written file. Any `severity === "error"` issue matching the
   page triggers a best-effort `unlink` rollback and returns
   `isError: true` with the first issue's code and detail. A *crash* in
   verify (as opposed to a validation rejection) is reported as a warning
   and the page is kept.

On success, the page is incrementally indexed via `indexPage(searchIdx, ...)`.

## Search index (`search.ts`)

<!-- lw:anchors packages/mcp/src/search.ts#openAndIndex packages/mcp/src/search.ts#reindexAll packages/mcp/src/search.ts#collectMarkdownFiles packages/mcp/src/search.ts#walk packages/mcp/src/search.ts#indexPage packages/mcp/src/search.ts#removePage packages/mcp/src/search.ts#search packages/mcp/src/search.ts#close -->

The FTS5 index lives at `.livewiki/search.db`, intentionally separate from
`.livewiki/index.db` (which uses a schema-v4 layout with its own migrations).
Tokenizer: FTS5 default `porter`. Strategy: full rebuild at startup,
incremental updates via `indexPage`/`removePage` afterwards.

- **`openAndIndex(repoRoot)`** — resolves and validates
  `.livewiki/search.db` via `safeIo.resolveAndValidate`, ensures
  `.livewiki/` exists, opens the DB with WAL journaling, creates the
  `wiki_search` virtual table if absent, and triggers a full reindex.
- **`reindexAll(db, absRoot)`** — `DELETE FROM wiki_search`, then reads
  every `.md` under `livewiki/` and inserts `(wiki_path, content)` rows in
  a single transaction. Unreadable files are skipped silently.
- **`collectMarkdownFiles(dir)`** — recursive walker; returns absolute
  paths. Missing directories are treated as empty wikis.
- **`walk(d)`** — internal recursive helper used by
  `collectMarkdownFiles`. Recurses into directories and collects files
  ending in `.md`.
- **`indexPage(idx, wikiPath, content)`** — `DELETE` + `INSERT` for the
  given path, wrapped in a transaction. FTS5 has no native UPSERT.
- **`removePage(idx, wikiPath)`** — `DELETE` by `wiki_path`. Idempotent.
- **`search(idx, query, opts?)`** — runs `wiki_search MATCH ?` with
  `snippet(..., '<<', '>>', '...', 32)` and `ORDER BY rank LIMIT ?`
  (default 20, hard cap 100 at the tool layer). FTS5 syntax errors are
  caught and surface as an empty result rather than a throw.
- **`close(idx)`** — closes the underlying `better-sqlite3` handle. The
  server's wrapped `close` invokes this.

## MCP server E2E tests (`server.test.ts`)

<!-- lw:anchors packages/mcp/src/server.test.ts#connect packages/mcp/src/server.test.ts#teardown packages/mcp/src/server.test.ts#extractText -->

Phase 4 suite connects a real `McpServer` (livewiki) to a real `Client` over
`InMemoryTransport` and exercises every tool. Tests run inside
`beforeEach`/`afterEach` that create a temp repo, run programmatic init,
and recursively remove the temp dir on teardown.

- **`connect()`** — builds a `createServer({ repoRoot })` and a `Client`,
  links them via `InMemoryTransport.createLinkedPair()`, awaits both
  `client.connect(clientT)` and `server.connect(serverT)`. Returns the
  pair for explicit teardown (avoids EBUSY on Windows when WAL files are
  still open).
- **`teardown(c)`** — `await client.close()` then `await server.close()`.
  Always called from the test's `finally` block.
- **`extractText(r)`** — flattens an MCP tool result's `content[]` array,
  joining every `{ type: "text", text }` block into a single string.
  Tolerant of `null`/non-object inputs (returns `""`).

Covered behaviors include `tools/list` returning the six tools,
`livewiki_read` rejecting paths outside `livewiki/`, `write_doc`
allowlist + verify gating (including rollback on `broken_anchor`), the
`skipVerify` escape hatch, `resolve_debt` reporting `notFound` IDs, and
confirmation that `.livewiki/search.db` is materialized on the server.

## Phase 5 end-to-end tests (`phase5-e2e.test.ts`)

<!-- lw:anchors packages/mcp/src/phase5-e2e.test.ts#runCli packages/mcp/src/phase5-e2e.test.ts#connectMcp packages/mcp/src/phase5-e2e.test.ts#teardown packages/mcp/src/phase5-e2e.test.ts#runVerify -->

Phase 5 exercises the production-shaped flow: a real subprocess runs the
compiled CLI (`packages/cli/dist/index.js`) for `init`/`index`/`status`/
`verify`, while MCP interactions use the same `InMemoryTransport` client
the agents use in production. `pnpm -r build` must have run — the test
throws if the CLI binary is missing.

- **`runCli(args, cwd)`** — `spawn(process.execPath, [cliBin, ...args,
  "--repo", cwd])`, pipes stdout/stderr into buffers, resolves with
  `{ code, stdout, stderr }`. Throws on spawn error.
- **`connectMcp(repoRoot)`** — wraps `createServer` plus a `Client` named
  `"phase5-e2e-agent"` via a linked `InMemoryTransport` pair.
- **`teardown(c)`** — `await client.close()` then `await server.close()`.
- **`runVerify(repoRoot)`** — invokes `livewiki verify --json`, parses
  the stdout JSON, and falls back to extracting the last `{...}` block if
  parsing fails. Returns `{ ok, exitCode, issues, rawStdout }`. The
  assertions in the suite enforce **both** exit code `0` **and** zero
  issues (per SPEC §Fase 5).

Scenarios: the full hook→MCP→verify loop with `manifest.updatedAt` and
`snapshotHash` diffs; rejection + rollback on a `broken_anchor`; and the
`.gitignore` finding (R) — `init` creates a managed
`# livewiki:start`/`# livewiki:end` block containing `.livewiki/`,
preserves user entries, is idempotent across runs, and runs under both
`init` and `init --batch`.