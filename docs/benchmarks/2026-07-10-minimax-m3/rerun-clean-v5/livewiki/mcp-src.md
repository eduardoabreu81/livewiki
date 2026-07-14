---
title: mcp-src
owner: generated
anchors:
  - packages/mcp/src/index.ts#main
  - packages/mcp/src/index.ts#parseArgs
  - packages/mcp/src/server.ts#createServer
  - packages/mcp/src/search.ts#openAndIndex
  - packages/mcp/src/search.ts#search
  - packages/mcp/src/search.ts#indexPage
  - packages/mcp/src/search.ts#removePage
  - packages/mcp/src/search.ts#close
  - packages/mcp/src/search.ts#reindexAll
  - packages/mcp/src/search.ts#collectMarkdownFiles
  - packages/mcp/src/search.ts#walk
  - packages/mcp/src/phase5-e2e.test.ts#runCli
  - packages/mcp/src/phase5-e2e.test.ts#connectMcp
  - packages/mcp/src/phase5-e2e.test.ts#teardown
  - packages/mcp/src/phase5-e2e.test.ts#runVerify
  - packages/mcp/src/server.test.ts#connect
  - packages/mcp/src/server.test.ts#teardown
  - packages/mcp/src/server.test.ts#extractText
---

# mcp-src

The `mcp-src` module packages the `livewiki` MCP server (Phase 4) and its end-to-end tests (Phase 5). It exposes six MCP tools (`livewiki_quickstart`, `livewiki_read`, `livewiki_search`, `livewiki_debt`, `livewiki_write_doc`, `livewiki_resolve_debt`) over stdio, with a side-channel to a SQLite FTS5 index for full-text search.

## Entry point (stdio)

<!-- lw:anchors packages/mcp/src/index.ts#main packages/mcp/src/index.ts#parseArgs -->

`index.ts` is the stdio entry point. `parseArgs` reads `--repo <path>` from `argv`, defaulting to `process.cwd()`. `main` resolves the repo root, calls `createServer`, connects it to a `StdioServerTransport`, and registers `SIGINT`/`SIGTERM` handlers that close the server (which closes the FTS5 index) before exiting 0. A top-level catch writes the fatal error to stderr and exits 1.

```ts
function parseArgs(argv: readonly string[]): { repoRoot: string }
async function main(): Promise<void>
```

## MCP server factory

<!-- lw:anchors packages/mcp/src/server.ts#createServer -->

`createServer(opts)` builds a configured `McpServer` named `livewiki`. It does not connect a transport — callers (`index.ts` and tests) attach transports themselves. The function:

- Resolves `opts.repoRoot` (defaults to `cwd`) and opens the FTS5 index via `openAndIndex`.
- Registers the six tools with Zod-validated input schemas.
- For `livewiki_write_doc`: enforces the `livewiki/` allowlist via `safeIo.writeText`, then runs `verify` and rolls back the file if any error-level issue touches the just-written path. On success it calls `indexPage` to update the FTS5 index incrementally. `skipVerify: true` bypasses the verify step (documented escape hatch).
- For `livewiki_resolve_debt`: opens `.livewiki/index.db`, sets `resolved_at` on the supplied IDs, and returns `{ resolved, notFound, writeRef?, timestamp }`.
- Wraps `server.close` to also `closeSearch(searchIdx)` for clean shutdown (Windows-friendly, releases the WAL).

Errors are reported through the MCP `ErrorCode` enum (`InvalidParams` for allowlist violations, etc.) so the calling client gets structured errors instead of stack traces.

```ts
export async function createServer(opts: CreateServerOptions = {}): Promise<McpServer>
```

## FTS5 search index

<!-- lw:anchors packages/mcp/src/search.ts#openAndIndex packages/mcp/src/search.ts#reindexAll packages/mcp/src/search.ts#collectMarkdownFiles packages/mcp/src/search.ts#walk packages/mcp/src/search.ts#indexPage packages/mcp/src/search.ts#removePage packages/mcp/src/search.ts#search packages/mcp/src/search.ts#close -->

`search.ts` owns the `.livewiki/search.db` index (separate from `.livewiki/index.db` so the FTS5 schema upgrade is isolated from `core` migrations). Tokenizer is the default FTS5 `porter`.

- `openAndIndex(repoRoot)` — resolves `.livewiki/search.db` through `safe-io.resolveAndValidate`, ensures `.livewiki/` exists, opens the DB with `journal_mode = WAL`, creates the `wiki_search(wiki_path UNINDEXED, content)` virtual table if absent, and triggers a full reindex.
- `reindexAll(db, absRoot)` — clears `wiki_search`, walks `livewiki/` for `.md` files, reads each (skipping unreadable), and bulk-inserts in a single transaction. Idempotent.
- `collectMarkdownFiles(dir)` — recursive directory walker; `walk(d)` is the inner per-directory DFS that pushes `*.md` files into `out`. Missing directory is treated as "empty wiki".
- `indexPage(idx, wikiPath, content)` — incremental upsert: `DELETE` + `INSERT` for the path inside a transaction.
- `removePage(idx, wikiPath)` — `DELETE WHERE wiki_path = ?`. Idempotent.
- `search(idx, query, opts?)` — runs `MATCH` ordered by `rank`, returns hits with `snippet(wiki_search, 1, '<<', '>>', '...', 32)`. Catches FTS5 syntax errors and returns `[]` so a malformed query doesn't crash the tool. Default `limit` is 20.
- `close(idx)` — closes the underlying `better-sqlite3` Database. Mandatory on shutdown to release WAL files on Windows.

```ts
export async function openAndIndex(repoRoot: string): Promise<SearchIndex>
async function reindexAll(db: Database.Database, absRoot: string): Promise<void>
async function collectMarkdownFiles(dir: string): Promise<string[]>
async function walk(d: string): Promise<void>
export function indexPage(idx: SearchIndex, wikiPath: string, content: string): void
export function removePage(idx: SearchIndex, wikiPath: string): void
export function search(idx: SearchIndex, query: string, opts?: SearchOptions): SearchHit[]
export function close(idx: SearchIndex): void
```

## Phase 5 E2E helpers

<!-- lw:anchors packages/mcp/src/phase5-e2e.test.ts#runCli packages/mcp/src/phase5-e2e.test.ts#connectMcp packages/mcp/src/phase5-e2e.test.ts#teardown packages/mcp/src/phase5-e2e.test.ts#runVerify -->

`phase5-e2e.test.ts` exercises the full Phase 5 acceptance criterion: edit → hook detects → agent pays via MCP `livewiki_write_doc` → `livewiki verify` exits 0 with zero issues (errors AND warnings), and the manifest updates. It deliberately uses subprocess for the CLI (to test the real binary the hook calls) and `InMemoryTransport` for MCP (the same transport used by Phase 4 tests).

- `runCli(args, cwd)` — spawns `node <cliBin> ...args --repo <cwd>`, captures `{ code, stdout, stderr }`.
- `connectMcp(repoRoot)` — `await createServer({ repoRoot })`, build a `Client`, link them via `InMemoryTransport.createLinkedPair()`, return `{ client, server }`.
- `teardown({ client, server })` — `await client.close()` then `await server.close()` (releases the FTS5 WAL before the tempdir is removed — critical on Windows).
- `runVerify(repoRoot)` — invokes `runCli(['verify', '--json'], repoRoot)`, parses stdout (with a regex fallback for stray human output), and returns `{ ok, exitCode, issues, rawStdout }`. Tests assert on `issues.length === 0`, not just the exit code, per the SPEC requirement.

Additional Phase 5 test block: `livewiki init` must add `.livewiki/` to `.gitignore` inside a `# livewiki:start` / `# livewiki:end` managed block, preserving user entries and running idempotently across re-inits.

```ts
function runCli(args: readonly string[], cwd: string): Promise<SubprocessResult>
async function connectMcp(repoRoot: string): Promise<Connected>
async function teardown(c: Connected): Promise<void>
async function runVerify(repoRoot: string): Promise<VerifyOutput>
```

## Phase 4 server tests

<!-- lw:anchors packages/mcp/src/server.test.ts#connect packages/mcp/src/server.test.ts#teardown packages/mcp/src/server.test.ts#extractText -->

`server.test.ts` drives the MCP server with `InMemoryTransport` against a tempdir repo. It validates handshake (`initialize`), `tools/list` returning exactly the six SPEC tools, and per-tool happy/sad paths:

- `livewiki_quickstart` / `livewiki_read` return markdown.
- `livewiki_read` with a path outside `livewiki/` returns `isError: true` (regex matches `/allowlist|outside|livewiki/i`).
- `livewiki_search` returns a JSON `{ hits: [...] }` shape.
- `livewiki_debt` returns the status JSON with `files / symbols / debt / undocumented`.
- `livewiki_write_doc` writes valid content, rejects paths outside `livewiki/`, rejects pages with broken anchors (rollback confirmed via `fs.access` rejection), and accepts `skipVerify: true` as a documented escape.
- `livewiki_resolve_debt` returns `{ resolved: [], notFound: [9999] }` for unknown IDs.
- `.livewiki/search.db` exists after connect.

Helpers:

- `connect()` — builds server + linked client pair; returns both so teardown can release the DB before `afterEach` removes the tempdir.
- `teardown({ client, server })` — symmetric close (Windows file-locking safety).
- `extractText(r)` — joins the `{ type: 'text', text }` blocks of an MCP `CallToolResult` into a single string for assertion.

```ts
async function connect(): Promise<Connected>
async function teardown(c: Connected): Promise<void>
function extractText(r: unknown): string
```

TODO: Phase 4 tests assert exact `tools/list` ordering; if `createServer` adds a seventh tool, this list must be updated.