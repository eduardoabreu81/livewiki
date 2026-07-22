---
title: "@livewiki/mcp server entry, search index, and tests"
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

# @livewiki/mcp server entry, search index, and tests

This page documents the stdio MCP server package: how it boots, how it indexes and searches wiki pages, and how the integration tests drive it.

## When to use this page

- **Wire** the `@livewiki/mcp` binary into an MCP-aware client (Claude Code, etc.) and verify the stdio handshake, CLI flag parsing, and graceful shutdown.
- **Trace** the FTS5-backed search path from `openAndIndex` through `reindexAll`, `indexPage`, `search`, and `close` when tuning or debugging full-text behavior.
- **Run** the Phase 4 (`server.test.ts`) and Phase 5 (`phase5-e2e.test.ts`) end-to-end suites and understand how `connect`/`teardown`/`runCli`/`runVerify`/`connectMcp`/`extractText` set up and tear down the harness.
- **Audit** the `livewiki_write_doc` allowlist + verify semantics (including rollback paths) by reading how `createServer` wires safe-io, the optional `verify` test seam, and `indexPage` together.

## How it fits

The `packages/mcp` workspace exposes the `@livewiki/mcp` package, which is the runtime that agents connect to in production. `packages/mcp/src/index.ts` is the stdio entry point: it parses `--repo`, instantiates the MCP server via `createServer`, attaches a `StdioServerTransport`, and installs signal handlers that close the server before exit. `packages/mcp/src/server.ts` defines the six tools (`livewiki_quickstart`, `livewiki_read`, `livewiki_search`, `livewiki_debt`, `livewiki_write_doc`, `livewiki_resolve_debt`) and reuses `core/safe-io`, `core/status`, `core/verify`, and `core/db`. `packages/mcp/src/search.ts` owns the separate `.livewiki/search.db` SQLite FTS5 store that backs `livewiki_search` and is updated incrementally by `livewiki_write_doc`. The two test files (`server.test.ts` for Phase 4, `phase5-e2e.test.ts` for Phase 5) drive the same code paths through `InMemoryTransport` and the compiled CLI binary to validate the round-trip from a code edit through the hook, the MCP write, and `livewiki verify`.

## stdio entry point and CLI flag parsing

<!-- lw:anchors packages/mcp/src/index.ts#main packages/mcp/src/index.ts#parseArgs -->

`packages/mcp/src/index.ts` boots the server when invoked as a subprocess. The full signatures visible in the source are:

```ts
function parseArgs(argv: readonly string[]): { repoRoot: string } {
async function main(): Promise<void> {
```

`parseArgs` walks the supplied argv, defaulting `repoRoot` to `process.cwd()` and only honoring `--repo <path>` when the value token is defined; the value is resolved with `nodePath.resolve`. Anything other than `--repo` is ignored. `main` calls `parseArgs(process.argv.slice(2))`, then `await createServer({ repoRoot })`, then `new StdioServerTransport()`, and finally `await server.connect(transport)`. It registers `SIGINT` and `SIGTERM` handlers that write a notice to `process.stderr`, best-effort `await server.close()` inside a swallowed `catch`, and then `process.exit(0)`. The trailing `main().catch` writes a `[livewiki-mcp] fatal:` line and exits with code 1 on any setup error — note that the visible code path does not attempt cleanup of partially opened resources in that catch.

## MCP server factory and tool wiring

<!-- lw:anchors packages/mcp/src/server.ts#createServer -->

The single exported factory in `packages/mcp/src/server.ts` is:

```ts
export async function createServer(opts: CreateServerOptions = {}): Promise<McpServer> {
```

`createServer` resolves `repoRoot` (default `process.cwd()`), uses `opts.verify ?? runVerify` so tests can inject a crashing verifier, and opens the FTS5 index via `openAndIndex(repoRoot)`. It constructs an `McpServer` named `livewiki` with `capabilities: { tools: {} }` and registers each tool. The module-level `CreateServerOptions` exposes `repoRoot` and the test seam `verify?: typeof runVerify`.

`createServer` returns the configured `McpServer` but does **not** connect a transport — that is the caller's responsibility (the stdio entry in `index.ts` does it). On close, `createServer` overrides `server.close` so it first closes the search index and then delegates to the original close, ensuring FTS5 resources are released even when transport-level shutdown is initiated by the runtime.

### `livewiki_write_doc` flow and rollback semantics

`livewiki_write_doc` is the only mutating tool and is where the safe-io + verify contract is enforced:

1. `safeIo.writeText(repoRoot, path, content)` — `PathOutsideAllowlistError` is rethrown as `McpError(InvalidParams, …)` with a message naming the rejected path and referencing regra #1 da SPEC; `InvalidRelativePathError` is also surfaced as `InvalidParams`; other safe-io failures fall through to `errorResult`.
2. Unless `skipVerify` is set, `verify(repoRoot)` runs against the freshly written content. The handler filters `verifyResult.issues` for `severity === "error"` whose `wikiPath` matches the just-written path (or is the empty global page), and if any are found it calls `rollbackWrittenPage` (an internal helper that `safeIo.resolveAndValidate`s then `unlink`s) and returns `errorResult` with the count, first issue code, and detail.
3. If `verify` itself throws, the handler re-runs `rollbackWrittenPage`. A successful rollback yields `errorResult("verify crashed: …. The page was NOT kept.")`. A failed rollback yields a louder message that explicitly says `UNVERIFIED`, includes the original crash message, the path, and an `inspect` hint — the file may be on disk and must be examined.
4. On success (or `skipVerify: true`), `indexPage(searchIdx, path, content)` runs synchronously inside the same `McpServer` invocation so the next `livewiki_search` reflects the new content.

`skipVerify: true` is treated as a documented escape hatch for pages that legitimately do not anchor symbols (the suite uses it for `livewiki/skip.md`); the visible code does not gate it behind any additional authorization.

### Other tools

`livewiki_quickstart` and `livewiki_read` both go through `safeIo.readText`; `livewiki_read` accepts a `path` string (Zod-validated, min length 1) and surfaces safe-io errors as `errorResult`. `livewiki_search` requires `query: string` and optional `limit: number` (1..100), calls `doSearch(searchIdx, query, { limit })`, and serializes `{ query, hits }`. `livewiki_debt` is a thin wrapper over `runStatus(repoRoot)` and serializes the report verbatim. `livewiki_resolve_debt` opens `.livewiki/index.db` via `openIndex`, runs an `UPDATE debt SET resolved_at = ? WHERE id = ? AND resolved_at IS NULL` inside a transaction, and returns `{ resolved, notFound, writeRef?, timestamp }`.

## Search index lifecycle

<!-- lw:anchors packages/mcp/src/search.ts#openAndIndex packages/mcp/src/search.ts#reindexAll packages/mcp/src/search.ts#collectMarkdownFiles packages/mcp/src/search.ts#walk packages/mcp/src/search.ts#indexPage packages/mcp/src/search.ts#removePage packages/mcp/src/search.ts#search packages/mcp/src/search.ts#close -->

`packages/mcp/src/search.ts` owns the standalone `.livewiki/search.db` SQLite store used by `livewiki_search`. The schema is `CREATE VIRTUAL TABLE IF NOT EXISTS wiki_search USING fts5(wiki_path UNINDEXED, content)` and the file lives at `.livewiki/search.db` relative to the repo root. The signatures visible in the source are:

```ts
export async function openAndIndex(
async function reindexAll(db: Database.Database, absRoot: string): Promise<void> {
async function collectMarkdownFiles(dir: string): Promise<string[]> {
async function walk(d: string): Promise<void> {
export function indexPage(idx: SearchIndex, wikiPath: string, content: string): void {
export function removePage(idx: SearchIndex, wikiPath: string): void {
export function search(
export function close(idx: SearchIndex): void {
```

`openAndIndex` resolves `repoRoot` to an absolute path, validates `.livewiki/search.db` through `safeIo.resolveAndValidate`, ensures `.livewiki/` exists via `safeIo.mkdir`, opens the database with `journal_mode = WAL`, creates the FTS5 virtual table if missing, and finally calls `reindexAll`. The returned `SearchIndex` is just `{ db }`.

`reindexAll` first runs `DELETE FROM wiki_search` to make the rebuild idempotent, then walks `livewiki/` via `collectMarkdownFiles`, reads each markdown file, and inserts `{ wiki_path, content }` rows inside a single transaction. Per-file `readFile` failures are swallowed and the file is skipped.

`collectMarkdownFiles` is recursive: the inner `walk` uses `nodeFs.readdir(d, { withFileTypes: true })`, descends into directories, and collects files whose name ends with `.md`. If the wiki directory cannot be read (e.g., it does not exist), `walk` returns silently and `collectMarkdownFiles` yields an empty array — so a fresh repo with no wiki simply produces no search rows.

`indexPage` performs a `DELETE` + `INSERT` inside a `db.transaction(...)` because FTS5 has no native UPSERT. `removePage` runs `DELETE FROM wiki_search WHERE wiki_path = ?` and is idempotent. `search` runs `SELECT wiki_path, snippet(wiki_search, 1, '<<', '>>', '...', 32) … MATCH ? ORDER BY rank LIMIT ?`; the `limit` defaults to 20. Any FTS5 syntax error from a malformed query is caught and the function returns `[]` instead of throwing. `close` is `idx.db.close()` and is wired into the augmented `server.close` so the index is released during shutdown. The file excerpt does not establish exhaustive behavior for every error path in `search` (only the `try`/`catch` returning `[]` is visible), but that branch is the documented fail-open handling.

## Phase 4 test harness

<!-- lw:anchors packages/mcp/src/server.test.ts#connect packages/mcp/src/server.test.ts#teardown packages/mcp/src/server.test.ts#extractText -->

The Phase 4 suite uses `InMemoryTransport` so it does not depend on real stdio. The visible signatures are:

```ts
async function connect(opts: Omit<CreateServerOptions, "repoRoot"> = {}): Promise<Connected>
async function teardown(c: Connected): Promise<void>
function extractText(r: unknown): string
```

`connect` calls `createServer({ repoRoot, ...opts })`, creates a `Client({ name: "test-agent", version: "0.0.0" })`, links an `InMemoryTransport` pair, and awaits both `client.connect(clientT)` and `server.connect(serverT)` in parallel. Every test wraps the body in `try { … } finally { await teardown(c) }` — this is the Windows-safe pattern because better-sqlite3 holds WAL files open and a recursive `rm` after the test would otherwise `EBUSY`. `teardown` awaits `c.client.close()` and then `c.server.close()`, releasing the search DB handle.

`extractText` normalizes the discriminated union returned by `callTool`: it inspects `r.content` (an array), keeps only entries with `type === "text"` and a string `text`, and joins them with `\n`. The helper silently returns `""` for non-object inputs or missing content arrays. The suite uses `extractText` to assert both on human-readable messages (e.g., `/Quickstart|Guia/`, `/wrote livewiki\/scratch\.md/`, `/verify rejected/`) and on `JSON.parse`-able payloads from `livewiki_search`, `livewiki_debt`, and `livewiki_resolve_debt`.

The suite seeds each test with two source files (`src/auth/login.ts`, `src/utils/helper.ts`), calls `runInit({ repoRoot, quiet: true })` programmatically, and removes the temp dir in `afterEach`. The `search_db é criado em .livewiki/search.db (FTS5 schema)` test verifies that `createServer` actually creates the FTS5 file in `.livewiki/`.

## Phase 5 end-to-end harness

<!-- lw:anchors packages/mcp/src/phase5-e2e.test.ts#runCli packages/mcp/src/phase5-e2e.test.ts#connectMcp packages/mcp/src/phase5-e2e.test.ts#runVerify packages/mcp/src/phase5-e2e.test.ts#teardown -->

The Phase 5 suite mixes the compiled CLI (subprocess) with the MCP server (in-process) to test the full hook → MCP write → verify → manifest round-trip. The visible signatures are:

```ts
function runCli(args: readonly string[], cwd: string): Promise<SubprocessResult>
async function connectMcp(repoRoot: string): Promise<Connected>
async function runVerify(repoRoot: string): Promise<VerifyOutput>
async function teardown(c: Connected): Promise<void>
```

`runCli` resolves the compiled CLI at `packages/cli/dist/index.js` (the file is checked at module load; missing binary throws). It `spawn`s `process.execPath` with `[cliBin, ...args, "--repo", cwd]`, captures stdout/stderr, and resolves with `{ code, stdout, stderr }` on `close`. Every subprocess invocation always passes `--repo cwd` last.

`connectMcp` is the in-process MCP analogue of `connect` from the Phase 4 file: it calls `createServer({ repoRoot })`, builds a `Client({ name: "phase5-e2e-agent", version: "0.0.0" })`, links `InMemoryTransport.createLinkedPair()`, and awaits both connect calls. `teardown` awaits `client.close()` then `server.close()`. Both `connectMcp`/`teardown` calls in the main test use the same `finally { await teardown(mcp) }` discipline to release the FTS5 handle before `nodeFs.rm` cleans up the temp repo.

`runVerify` runs `runCli(["verify", "--json"], repoRoot)` and parses the JSON. It first tries `JSON.parse(r.stdout)` directly, and on failure falls back to extracting the first `{...}` block via `match(/\{[\s\S]*\}/)` — so it tolerates a stray human-readable prefix. It returns `{ ok, exitCode, issues, rawStdout }`. The Phase 5 acceptance criteria are encoded as three assertions: `exitCode === 0`, `issues.length === 0`, and `ok === true`. Note that `runVerify` cannot establish that the underlying verify would fail closed in every case — the harness relies on the fact that the CLI returns a JSON document on its success path; if the CLI ever prints only human text, `parsed.ok ?? false` will surface as `false` and the test would fail with a clear message.

The same file contains a second `describe` block that exercises `livewiki init` `.gitignore` behavior (Achado R) by checking that `.livewiki/` is added inside a managed block, user entries are preserved, the operation is idempotent, and `init --batch` does not regress the gitignore contract.

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
- [Batch orchestration, config, index schema, and deterministic diagrams](core-src-03.md) — dependency
- [Core source — prompts, safe I/O, status, symbols, topics](core-src-08.md) — dependency
- [Core incremental update, verify, and repo walker](core-src-09.md) — dependency
<!-- livewiki:navigate:end -->
