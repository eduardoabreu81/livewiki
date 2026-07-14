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

## index.ts — stdio entry point
<!-- lw:anchors packages/mcp/src/index.ts#main packages/mcp/src/index.ts#parseArgs -->

The `index.ts` file is the stdio entry point of the `@livewiki/mcp` package. It reads `--repo` from the CLI (defaulting to `cwd`), creates the server via `createServer`, and connects it to a `StdioServerTransport`. The process stays alive while the MCP client is connected and registers `SIGINT`/`SIGTERM` handlers that call `server.close()` (which closes the FTS5 index) before exiting with code `0`. A top-level `.catch` writes a fatal message to stderr and exits with code `1` if `main` rejects.

`parseArgs(argv)` walks `argv` looking for a `--repo` flag followed by a value, resolving it to an absolute path via `nodePath.resolve`. Anything else in `argv` is ignored. The return shape is `{ repoRoot: string }`, with `repoRoot` defaulting to `process.cwd()` when `--repo` is absent.

`main()` resolves the repo root via `parseArgs(process.argv.slice(2))`, builds the server, wires up the stdio transport, awaits `server.connect(transport)`, and installs the shutdown handler pair.

## search.ts — FTS5 indexing and querying
<!-- lw:anchors packages/mcp/src/search.ts#openAndIndex packages/mcp/src/search.ts#reindexAll packages/mcp/src/search.ts#collectMarkdownFiles packages/mcp/src/search.ts#walk packages/mcp/src/search.ts#indexPage packages/mcp/src/search.ts#removePage packages/mcp/src/search.ts#search packages/mcp/src/search.ts#close -->

`search.ts` owns the SQLite FTS5 back-end used by the MCP `livewiki_search` tool. The DB lives at `.livewiki/search.db` (separate from `.livewiki/index.db`) so the core schema stays at v4 and so the search index is reconstructible from the wiki on disk. The tokenizer is `porter` (FTS5 default); the design comment notes this may need revisiting for non-English/non-PT corpora.

`openAndIndex(repoRoot)` resolves and validates `.livewiki/search.db` through `@livewiki/core/safe-io`, ensures `.livewiki/` exists, opens `better-sqlite3` with `journal_mode = WAL`, creates the `wiki_search` FTS5 virtual table `(wiki_path UNINDEXED, content)` if missing, and delegates to `reindexAll` before returning `{ db }`.

`reindexAll(db, absRoot)` clears `wiki_search`, walks `livewiki/` for markdown, reads each file (skipping unreadable ones), and bulk-inserts the entries inside a transaction. `collectMarkdownFiles(dir)` returns the absolute paths; `walk(d)` is its inner recursive helper that yields directories and `.md` files via `nodeFs.readdir(d, { withFileTypes: true })` and silently returns on `readdir` failure (wiki may be empty). `wikiPath` is stored relative to `absRoot` with forward slashes.

`indexPage(idx, wikiPath, content)` upserts a single page — FTS5 has no native upsert, so it runs `DELETE` then `INSERT` inside a transaction. `removePage(idx, wikiPath)` is a single `DELETE` and is idempotent. `search(idx, query, opts)` builds the FTS5 query `SELECT wiki_path, snippet(wiki_search, 1, '<<', '>>', '...', 32) … ORDER BY rank LIMIT ?` with a default limit of `20` (capped via `opts.limit`); syntax errors from a malformed query are caught and return `[]`. `close(idx)` simply calls `idx.db.close()` and is wired into `server.close()` by `server.ts`.

## server.ts — MCP tool definitions
<!-- lw:anchors packages/mcp/src/server.ts#createServer -->

`createServer(opts)` constructs and configures the `McpServer` (name `livewiki`, capabilities `tools`). It resolves `opts.repoRoot` (default `process.cwd()`), opens the FTS5 index via `openAndIndex`, then registers six tools per the SPEC: `livewiki_quickstart`, `livewiki_read`, `livewiki_search`, `livewiki_debt`, `livewiki_write_doc`, `livewiki_resolve_debt`. It does not connect a transport — that is the caller's job (`index.ts` uses `StdioServerTransport`).

Errors are surfaced either as `{ isError: true, content: [{ type: "text", text }] }` for soft failures, or thrown as `McpError` with `InvalidParams`/`InvalidRequest`/`InternalError` codes for protocol-level rejections (e.g. a path outside the livewiki allowlist). `createServer` also patches `server.close` so it closes the search index before delegating to the original.

`livewiki_write_doc` is the critical write path: it routes through `safeIo.writeText`, mapping `PathOutsideAllowlistError` and `InvalidRelativePathError` to `McpError(InvalidParams, …)`. On success it runs `runVerify(repoRoot)`; if any `error`-level issue touches the freshly written path, the file is unlinked (best-effort rollback) and an `errorResult` reports the first issue code and detail. When `skipVerify` is `true`, verify is bypassed — the doc comment warns this is only legitimate for non-anchor pages like `quickstart.md`. On accept, `indexPage` updates the FTS5 index incrementally. `livewiki_resolve_debt` opens `.livewiki/index.db`, runs an `UPDATE debt SET resolved_at = ? WHERE id = ? AND resolved_at IS NULL` per id inside a transaction, and returns `{ resolved, notFound, writeRef?, timestamp }`.

## server.test.ts — Phase 4 MCP E2E
<!-- lw:anchors packages/mcp/src/server.test.ts#connect packages/mcp/src/server.test.ts#teardown packages/mcp/src/server.test.ts#extractText -->

`server.test.ts` runs an in-process E2E suite against the MCP server using `InMemoryTransport` (no real stdio). Each test calls `connect()` to obtain a `Connected = { client, server }` pair and always tears it down in `finally` so the FTS5 WAL files (`.livewiki/search.db-shm`/`.livewiki/search.db-wal`) are released before `afterEach` runs `nodeFs.rm` — this avoids `EBUSY` on Windows.

`connect()` instantiates `createServer({ repoRoot })`, builds an MCP `Client`, links an `InMemoryTransport` pair, and awaits `Promise.all([client.connect(clientT), server.connect(serverT)])`. `teardown(c)` calls `client.close()` then `server.close()` in that order.

`extractText(r)` is a defensive helper that accepts the discriminated `callTool` return, walks `r.content`, and concatenates any block whose `type === "text"`. It returns `""` for non-objects, missing `content`, or arrays without text blocks — letting assertions like `expect(text).toMatch(/…/)` degrade gracefully when the SDK envelopes the result differently.

The suite asserts: `tools/list` returns exactly the six SPEC-named tools; `livewiki_quickstart`/`livewiki_read` return markdown matching `/Quickstart|Guia/`; `livewiki_read` and `livewiki_write_doc` reject paths outside `livewiki/` (rule #1 of the SPEC); `livewiki_write_doc` accepts valid content, rejects pages whose frontmatter anchors reference missing symbols (with rollback so the file is not left on disk), and accepts with `skipVerify: true`; `livewiki_search` returns `{ hits: [...] }` JSON; `livewiki_debt` reports `files`/`symbols`/`debt`/`undocumented`; `livewiki_resolve_debt` returns `{ resolved: [], notFound: [9999] }` when given an unknown id; and `.livewiki/search.db` is created.

## phase5-e2e.test.ts — Phase 5 E2E
<!-- lw:anchors packages/mcp/src/phase5-e2e.test.ts#runCli packages/mcp/src/phase5-e2e.test.ts#connectMcp packages/mcp/src/phase5-e2e.test.ts#teardown packages/mcp/src/phase5-e2e.test.ts#runVerify -->

`phase5-e2e.test.ts` drives a full hook → MCP → verify cycle against the compiled CLI at `packages/cli/dist/index.js`. It uses subprocesses for `livewiki init | index | status | verify` (exercising the real binary the hook will call) but in-process MCP via `InMemoryTransport` for the write path (mirroring the production agent client). The test throws at module load if the CLI dist is missing, requiring `pnpm -r build` first.

`runCli(args, cwd)` spawns `process.execPath` with `[cliBin, ...args, "--repo", cwd]`, pipes stdout/stderr, and resolves with `{ code, stdout, stderr }`. It is the single entry point used by every CLI assertion in this file.

`connectMcp(repoRoot)` is the MCP-side twin of `connect` from `server.test.ts`: it builds an `McpServer` via `createServer`, a `Client({ name: "phase5-e2e-agent", … })`, links a `InMemoryTransport.createLinkedPair()`, and awaits both connects in parallel. `teardown(c)` closes client then server so the FTS5 WAL is released before the tmpdir is removed.

`runVerify(repoRoot)` calls `runCli(["verify", "--json"], repoRoot)`, parses stdout as JSON (with a fallback `r.stdout.match(/\{[\s\S]*\}/)` extractor), and returns `{ ok, exitCode, issues, rawStdout }` so tests can assert both `exitCode === 0` AND `issues.length === 0` — the SPEC explicitly requires counting issues rather than trusting exit code alone.

The two top-level suites are: the Phase 5 happy path (edit → `livewiki init` → MCP write an anchored page → `index` → modify source → `index --quiet` → `status --json` confirms debt on `src/auth.ts#validate` → MCP rewrites the page → `verify` returns zero issues → `init` again to refresh the manifest snapshot hash → `status` shows debt dropped), and the rollback test (good page written, then a page with `src/auth.ts#ghostSymbol` anchor is rejected with `isError === true` and either no file is left on disk or the file is the previous good version). The second suite covers the reviewer's R finding: `livewiki init` must add `.livewiki/` to `.gitignore` inside a `# livewiki:start` / `# livewiki:end` block, idempotently, preserving user entries, deduplicating when `.livewiki/` is already present, and running even when `--batch` is passed.