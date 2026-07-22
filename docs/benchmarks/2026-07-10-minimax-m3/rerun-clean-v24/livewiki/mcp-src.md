---
title: MCP server and search indexing module
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

# MCP server and search indexing module

This module exposes the livewiki functionality as MCP tools over stdio and provides the FTS5-backed full-text search that powers one of those tools.

## When to use this page

- **Configure** an MCP client (for example Claude Code) to launch `@livewiki/mcp` against a target repository.
- **Debug** how `livewiki_write_doc` enforces the `livewiki/` allowlist and the post-write verify step.
- **Trace** FTS5 indexing behaviour: initial rebuild, incremental `indexPage`, and `removePage` on shutdown.
- **Read** the Phase 4 server tests and Phase 5 end-to-end hook → MCP → verify harness before modifying them.

## How it fits

The module lives under `packages/mcp/src/` and consists of three production files plus two test files. `server.ts` builds the `McpServer` and registers the six MCP tools defined by the spec (`livewiki_quickstart`, `livewiki_read`, `livewiki_search`, `livewiki_debt`, `livewiki_write_doc`, `livewiki_resolve_debt`). `search.ts` owns a separate SQLite database at `.livewiki/search.db` containing an FTS5 virtual table, and is opened at server creation time. `index.ts` is the thin stdio entry point that parses `--repo`, calls `createServer`, attaches a `StdioServerTransport`, and registers `SIGINT`/`SIGTERM` handlers. The two test files exercise the server through `InMemoryTransport` (Phase 4) and orchestrate the full edit → hook → MCP write_doc → verify → manifest flow (Phase 5).

## Stdio entry point
<!-- lw:anchors packages/mcp/src/index.ts#main packages/mcp/src/index.ts#parseArgs -->

The entry point reads `--repo <path>` from `argv` (defaulting to `process.cwd()`), creates the server, connects it to stdio, and installs best-effort shutdown handlers.

```ts
function parseArgs(argv: readonly string[]): { repoRoot: string } {
```

`parseArgs` scans `argv` for a `--repo` flag followed by a value and resolves the value against the current working directory. It returns `{ repoRoot }`; unknown flags are ignored. If `--repo` is the last argument with no following value, the default `process.cwd()` is kept (the `argv[i + 1] !== undefined` guard).

```ts
async function main(): Promise<void> {
```

`main` calls `parseArgs(process.argv.slice(2))`, awaits `createServer({ repoRoot })`, constructs a `StdioServerTransport`, and awaits `server.connect(transport)`. It then registers `SIGINT` and `SIGTERM` listeners that log a `[livewiki-mcp] received <signal>` line to stderr, attempt `server.close()` inside a `try/catch` (errors are swallowed as best-effort), and exit `0`. Any failure from the top-level `main().catch(...)` writes `[livewiki-mcp] fatal: <message>` to stderr and exits `1`. The visible source does not establish exhaustive shutdown ordering for child resources beyond the server's own `close()`.

## Server construction
<!-- lw:anchors packages/mcp/src/server.ts#createServer -->

`createServer` wires up the six MCP tools, the FTS5 index, and a server-level `close()` override that also closes the search handle.

```ts
export async function createServer(opts: CreateServerOptions = {}): Promise<McpServer> {
```

`createServer` resolves `repoRoot` from `opts.repoRoot ?? process.cwd()`, picks `opts.verify ?? runVerify` as the verifier (the option exists as a test seam so tests can inject a crashing verifier), and awaits `openAndIndex(repoRoot)` to obtain the `SearchIndex`. The returned `McpServer` has `name: "livewiki"`, `version: "0.0.0"`, and `capabilities.tools = {}`.

The function defines local helpers `textResult` and `errorResult` for shaping tool responses, plus `rollbackWrittenPage` which calls `safeIo.resolveAndValidate(repoRoot, path)` and `nodeFs.unlink`, returning `false` on any thrown error. After all six `server.tool(...)` registrations, it wraps `server.close` so the override also calls `closeSearch(searchIdx)` before delegating to the original `close`. The function never connects a transport — that responsibility belongs to `main`.

The six registered tools each follow a `try/catch` shape that converts thrown errors into `errorResult` strings:

- `livewiki_quickstart` reads `livewiki/quickstart.md` via `safeIo.readText`.
- `livewiki_read` takes a `path` string and reads it through `safeIo.readText`.
- `livewiki_search` accepts `query` and optional `limit` (1–100, default 20) and serialises `doSearch(searchIdx, query, { limit })` as JSON.
- `livewiki_debt` returns the output of `runStatus(repoRoot)` serialised as JSON.
- `livewiki_write_doc` takes `path`, `content`, and optional `skipVerify`. It first attempts `safeIo.writeText(repoRoot, path, content)`; `safeIo.PathOutsideAllowlistError` is rethrown as an `McpError(InvalidParams, …)` and `safeIo.InvalidRelativePathError` likewise. When `skipVerify` is not `true`, it runs `verify(repoRoot)` and, if any `severity === "error"` issue has a `wikiPath` matching the written path (or `""`), calls `rollbackWrittenPage(path)` and returns `errorResult` describing the first issue. If the verifier throws, the helper attempts rollback; when rollback fails the response text mentions an `UNVERIFIED` page at the path; otherwise the response text states the page was `NOT kept`. On success, `indexPage(searchIdx, path, content)` updates the FTS5 index incrementally.
- `livewiki_resolve_debt` opens `.livewiki/index.db` via `openIndex`, runs a transaction that sets `resolved_at` on rows whose `id` is in `debtIds` and whose `resolved_at IS NULL`, and reports `resolved` vs `notFound` arrays.

## FTS5 search index
<!-- lw:anchors packages/mcp/src/search.ts#openAndIndex packages/mcp/src/search.ts#reindexAll packages/mcp/src/search.ts#collectMarkdownFiles packages/mcp/src/search.ts#walk packages/mcp/src/search.ts#indexPage packages/mcp/src/search.ts#removePage packages/mcp/src/search.ts#search packages/mcp/src/search.ts#close -->

The search module owns a separate database at `.livewiki/search.db` and uses the default FTS5 tokenizer (porter). It performs a full rebuild on each server startup; subsequent writes go through `indexPage`/`removePage`.

```ts
export async function openAndIndex(
```

`openAndIndex(repoRoot)` resolves an absolute root, validates `.livewiki/search.db` through `safeIo.resolveAndValidate`, ensures `.livewiki/` exists via `safeIo.mkdir(absRoot, ".livewiki")`, opens the database, sets `journal_mode = WAL`, and runs `CREATE VIRTUAL TABLE IF NOT EXISTS wiki_search USING fts5(wiki_path UNINDEXED, content)`. It then awaits `reindexAll(db, absRoot)` and returns `{ db }`.

```ts
async function reindexAll(db: Database.Database, absRoot: string): Promise<void> {
```

`reindexAll` runs `DELETE FROM wiki_search`, walks the `livewiki/` directory through `collectMarkdownFiles`, reads each `.md` file (read errors are silently skipped per entry), and inserts every successfully read page in a single transaction using the prepared `INSERT INTO wiki_search (wiki_path, content) VALUES (?, ?)`. Page paths are stored as forward-slash paths relative to `absRoot`.

```ts
async function collectMarkdownFiles(dir: string): Promise<string[]> {
```

`collectMarkdownFiles` delegates the recursive walk to an inner `walk(d)` function.

```ts
async function walk(d: string): Promise<void> {
```

`walk` reads the directory with `withFileTypes`, returns silently if `readdir` throws (treating that as "wiki empty / not yet created"), recurses into subdirectories, and pushes any `*.md` regular file into a shared `out` array. The closure shares `out` with `collectMarkdownFiles`, so no other state is passed in.

```ts
export function indexPage(idx: SearchIndex, wikiPath: string, content: string): void {
```

`indexPage` performs a manual upsert because FTS5 lacks native UPSERT: it runs a transaction that first `DELETE`s any row with the given `wiki_path`, then `INSERT`s the new row. Both statements are prepared on the call.

```ts
export function removePage(idx: SearchIndex, wikiPath: string): void {
```

`removePage` is a thin wrapper around `DELETE FROM wiki_search WHERE wiki_path = ?`. The visible source does not establish how callers decide when to invoke it (the MCP `remove` flow is not present in the supplied excerpt).

```ts
export function search(
```

`search(idx, query, opts)` defaults `limit` to `20`, runs `SELECT wiki_path, snippet(wiki_search, 1, '<<', '>>', '...', 32) FROM wiki_search WHERE wiki_search MATCH ? ORDER BY rank LIMIT ?`, and maps the rows to `{ wikiPath, snippet }`. Any thrown error from a malformed FTS5 query is caught and the function returns `[]` (the visible catch swallows all errors without distinction).

```ts
export function close(idx: SearchIndex): void {
```

`close` calls `idx.db.close()`. It is invoked from `createServer`'s wrapped `server.close`, so index shutdown piggybacks on server shutdown.

## Phase 4 server test harness
<!-- lw:anchors packages/mcp/src/server.test.ts#connect packages/mcp/src/server.test.ts#teardown packages/mcp/src/server.test.ts#extractText -->

The server test file uses `InMemoryTransport` to pair an `McpServer` (livewiki) with a `Client` (mock agent) without spawning a stdio subprocess, and shares a `Connected` handle plus small helpers across all `it` blocks.

```ts
async function connect(opts: Omit<CreateServerOptions, "repoRoot"> = {}): Promise<Connected> {
```

`connect` awaits `createServer({ repoRoot, ...opts })`, constructs a `Client({ name: "test-agent", version: "0.0.0" }, { capabilities: {} })`, creates a linked `InMemoryTransport` pair, and awaits `Promise.all([client.connect(clientT), server.connect(serverT)])` before returning `{ client, server }`. The comment in the file explicitly notes this is required so the FTS5 DB is closed before the recursive `nodeFs.rm` in `afterEach` (Windows file locking on `search.db-shm`/`search.db-wal`).

```ts
async function teardown(c: Connected): Promise<void> {
```

`teardown` awaits `c.client.close()` followed by `c.server.close()`.

```ts
function extractText(r: unknown): string {
```

`extractText` narrows `r` to an object with a `content` array, walks each entry, and concatenates the `text` fields of entries whose `type === "text"`. Non-text entries are dropped; non-object or missing `content` inputs return `""`.

## Phase 5 end-to-end harness
<!-- lw:anchors packages/mcp/src/phase5-e2e.test.ts#runCli packages/mcp/src/phase5-e2e.test.ts#connectMcp packages/mcp/src/phase5-e2e.test.ts#teardown packages/mcp/src/phase5-e2e.test.ts#runVerify -->

The Phase 5 file orchestrates the full hook → MCP → verify flow. Subprocess calls hit the real compiled CLI (`packages/cli/dist/index.js`) while the MCP server is driven in-process via the same `InMemoryTransport` pattern.

```ts
function runCli(args: readonly string[], cwd: string): Promise<SubprocessResult> {
```

`runCli` spawns `process.execPath` with `[cliBin, ...args, "--repo", cwd]`, captures `stdout`/`stderr` into strings, and resolves with `{ code, stdout, stderr }` on `close`. It rejects on `error`. The module throws at import time if `cliBin` does not exist, with a message asking the caller to run `pnpm -r build`.

```ts
async function connectMcp(repoRoot: string): Promise<Connected> {
```

`connectMcp` is the Phase 5 equivalent of `server.test.ts#connect`: it awaits `createServer({ repoRoot })`, builds a `Client({ name: "phase5-e2e-agent", version: "0.0.0" }, { capabilities: {} })`, links the transports, and returns `{ client, server }`.

```ts
async function teardown(c: Connected): Promise<void> {
```

`teardown` closes the client first, then the server. The Phase 5 file defines its own local `Connected` interface (separate from the one in `server.test.ts`).

```ts
async function runVerify(repoRoot: string): Promise<VerifyOutput> {
```

`runVerify` shells out to `livewiki verify --json` via `runCli`, parses `stdout` as JSON, and falls back to a regex `match(/\{[\s\S]*\}/)` if `JSON.parse` throws. It returns `{ ok: parsed.ok ?? false, exitCode: r.code ?? -1, issues: parsed.issues ?? [], rawStdout }`. `VerifyOutput.issues` are typed as `Array<{ severity: "error" | "warning"; kind: string; detail: string; wikiPath?: string }>`.
