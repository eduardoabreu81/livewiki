---
title: "@livewiki/mcp server, search index, and end-to-end tests"
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

# @livewiki/mcp server, search index, and end-to-end tests

The `@livewiki/mcp` package exposes the livewiki documentation tooling to MCP-compatible agents over stdio, backs full-text search with a SQLite FTS5 sidecar database, and ships the end-to-end tests that lock the Phase 4 and Phase 5 acceptance criteria.

## When to use this page

- **Wire the livewiki MCP server into a client** (Claude Code, MCP inspector) by pointing the launcher at `packages/mcp/src/index.ts` and understanding the `--repo` flag.
- **Trace how wiki pages get indexed and searched**, including the rebuild-on-startup strategy and the incremental update path used after `write_doc`.
- **Run the Phase 4 / Phase 5 E2E suites** and understand how the test helpers spin up the server via `InMemoryTransport` while exercising the real CLI binary for `init` / `index` / `status` / `verify`.

## How it fits

This module lives in `packages/mcp/` alongside the `@livewiki/core` package that supplies `safe-io`, `verify`, `status`, and `db`. The runtime pieces are `server.ts`, which builds an `McpServer` and registers the six tools described in SPEC §"MCP tools"; `search.ts`, which opens `.livewiki/search.db` (a separate FTS5 database from `.livewiki/index.db`) and reindexes the wiki on startup; and `index.ts`, which is the stdio entry point invoked by `npx @livewiki/mcp --repo <path>`.

The two test files exercise the server via `InMemoryTransport` (no real stdio) and drive the CLI as a subprocess so the real `livewiki` binary is on the hot path, not mocks. The Phase 4 suite asserts the six-tool surface, the `livewiki/` allowlist for `write_doc`, and the verify-then-rollback contract. The Phase 5 suite then walks the full hook → MCP → verify flow end-to-end, including the `init` `--gitignore` finding.

The excerpt below is truncated by token budget; it does not establish exhaustive behavior for every symbol — only what is visible in the supplied source.

## Stdio entry point

<!-- lw:anchors packages/mcp/src/index.ts#main packages/mcp/src/index.ts#parseArgs -->

The CLI parses a `--repo` argument and forwards it to `createServer`. Two signatures define the behavior:

```ts
function parseArgs(argv: readonly string[]): { repoRoot: string }
async function main(): Promise<void>
```

`parseArgs` walks `argv` once, looking for `--repo <value>`; when found it resolves the value to an absolute path via `nodePath.resolve` and defaults to `process.cwd()` if the flag is absent. `main` then calls `createServer({ repoRoot })`, attaches a `StdioServerTransport`, and registers `SIGINT` / `SIGTERM` handlers that call `server.close()` (best-effort, with the error swallowed) before `process.exit(0)`. The top-level `main().catch(...)` writes a fatal diagnostic to stderr and exits with code `1` on setup error — those are the two documented exit codes in the file header.

## MCP server construction

<!-- lw:anchors packages/mcp/src/server.ts#createServer -->

`createServer` is the single seam between the MCP SDK and `@livewiki/core`:

```ts
export async function createServer(opts: CreateServerOptions = {}): Promise<McpServer>
```

It resolves `repoRoot` (default `process.cwd()`), accepts an injectable `verify` function for tests, opens the FTS5 index, and registers the six tools (`livewiki_quickstart`, `livewiki_read`, `livewiki_search`, `livewiki_debt`, `livewiki_write_doc`, `livewiki_resolve_debt`). `createServer` does not start a transport — that is the caller's responsibility (`index.ts` uses `StdioServerTransport`).

The `write_doc` tool is the one with non-trivial failure handling. First, `safeIo.writeText` enforces the `livewiki/` allowlist: a path outside raises `PathOutsideAllowlistError`, which `createServer` re-raises as `McpError(InvalidParams, ...)`; the visible source shows the wrapped message names "regra #1 da SPEC". Second, unless `skipVerify` is set, `verify(repoRoot)` runs against the just-written page. If `verify` throws (any reason — the visible test code synthesizes a crash via `opts.verify`), the page is rolled back via `rollbackWrittenPage` (which calls `safeIo.resolveAndValidate` + `nodeFs.unlink`); if the rollback itself fails, the response includes the literal substring `"UNVERIFIED"` and the path so the caller can inspect the file. Third, if `verify` succeeds but reports `severity: "error"` issues touching the written path (or the empty-string sentinel path), the page is rolled back and the response carries the visible prefix `"verify rejected"`. On success, `indexPage(searchIdx, path, content)` runs to keep FTS5 in sync, and the response text contains the substring `"wrote "`.

The visible source therefore documents at least three failure paths for `write_doc` — allowlist rejection, verify-rejected rollback, and verifier-crash rollback — plus the `UNVERIFIED`-on-rollback-failure corner case. The excerpt does not establish behavior outside these branches.

## Search index

<!-- lw:anchors packages/mcp/src/search.ts#openAndIndex packages/mcp/src/search.ts#reindexAll packages/mcp/src/search.ts#collectMarkdownFiles packages/mcp/src/search.ts#walk packages/mcp/src/search.ts#indexPage packages/mcp/src/search.ts#removePage packages/mcp/src/search.ts#search packages/mcp/src/search.ts#close -->

The search sidecar uses `better-sqlite3` with the FTS5 virtual table `wiki_search(wiki_path UNINDEXED, content)`. The signatures are:

```ts
export async function openAndIndex(
  repoRoot: string,
): Promise<SearchIndex>
async function reindexAll(db: Database.Database, absRoot: string): Promise<void>
async function collectMarkdownFiles(dir: string): Promise<string[]>
async function walk(d: string): Promise<void>
export function indexPage(idx: SearchIndex, wikiPath: string, content: string): void
export function removePage(idx: SearchIndex, wikiPath: string): void
export function search(
  idx: SearchIndex,
  query: string,
  opts: SearchOptions = {},
): SearchHit[]
export function close(idx: SearchIndex): void
```

`openAndIndex` resolves the db path via `safeIo.resolveAndValidate` (the search module's header notes the caller has already passed through safe-io), enables WAL journal mode, ensures `.livewiki/` exists, creates the FTS5 table if missing, and calls `reindexAll`. `reindexAll` `DELETE`s every row, then walks the `livewiki/` directory collecting markdown files and inserts them inside a transaction. `collectMarkdownFiles` is a recursive walk implemented as an inner `walk` (the nested helper is also visible in the source). Per-file read errors are swallowed with a comment `// skip unreadable` — the excerpt does not establish behavior when an entire subtree is unreadable beyond `walk` returning without throwing.

`indexPage` runs `DELETE` + `INSERT` for `wikiPath` inside a transaction (FTS5 has no native UPSERT). `removePage` is a single `DELETE`. `search` uses the `snippet(wiki_search, 1, '<<', '>>', '...', 32)` form with the literal delimiters visible in the source, ordered by `rank`, capped at `opts.limit ?? 20`. The whole `prepare(...).all(...)` call is wrapped in `try/catch`; on FTS5 syntax errors the function returns `[]` rather than throwing.

The module documents a rebuild-on-startup strategy in its header comment ("rebuild completo em cada startup… Após startup, write_doc atualiza incrementally via indexPage"), and the visible source matches that contract.

## Phase 4 server test helpers

<!-- lw:anchors packages/mcp/src/server.test.ts#connect packages/mcp/src/server.test.ts#teardown packages/mcp/src/server.test.ts#extractText -->

The Phase 4 suite uses `InMemoryTransport` to avoid real stdio. The three helpers are:

```ts
async function connect(opts: Omit<CreateServerOptions, "repoRoot"> = {}): Promise<Connected>
async function teardown(c: Connected): Promise<void>
function extractText(r: unknown): string
```

`connect` calls `createServer({ repoRoot, ...opts })`, builds a `Client` named `test-agent`, links it to the server via `InMemoryTransport.createLinkedPair()`, and returns `{ client, server }`. `teardown` closes both, which the file header says is necessary on Windows to release FTS5 WAL handles before `nodeFs.rm` recurses. `extractText` walks `r.content` (typed as `unknown`) and concatenates entries where `type === "text"`, returning the empty string when the shape doesn't match — this is the helper used to assert on tool responses throughout the suite.

## Phase 5 end-to-end test helpers

<!-- lw:anchors packages/mcp/src/phase5-e2e.test.ts#runCli packages/mcp/src/phase5-e2e.test.ts#connectMcp packages/mcp/src/phase5-e2e.test.ts#runVerify packages/mcp/src/phase5-e2e.test.ts#teardown -->

The Phase 5 suite is the acceptance test for SPEC §"Fase 5" — the hook → MCP → verify flow. The four helpers are:

```ts
function runCli(args: readonly string[], cwd: string): Promise<SubprocessResult>
async function connectMcp(repoRoot: string): Promise<Connected>
async function teardown(c: Connected): Promise<void>
async function runVerify(repoRoot: string): Promise<VerifyOutput>
```

`runCli` spawns `process.execPath` against `packages/cli/dist/index.js` with `--repo <cwd>` appended (the file throws synchronously at import time if that binary is missing, telling the operator to run `pnpm -r build` first). `connectMcp` mirrors `server.test.ts`'s `connect` but uses the agent-style name `phase5-e2e-agent`. `teardown` closes client and server. `runVerify` wraps `runCli(["verify", "--json"], repoRoot)`, parses stdout with a `JSON.parse` + regex fallback for the `{...}` object, and returns a structured `VerifyOutput` (including the full `issues` array so the test can assert on issue counts, not only on the exit code — that matches the SPEC line "assertar contagem de issues, não só exit code" quoted in the file header).

The visible source therefore documents that `runCli` is the single seam used to drive the real CLI binary, while `connectMcp` keeps the MCP server in-process — the file header explicitly justifies this split ("subprocess: testa o binário REAL… in-process MCP: o MCP server é o que o agente usa").

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
- [Batch orchestration, config, index DB, and diagram generators](core-src-03.md) — dependency
- [Core prompt, I/O allowlist, symbol extraction, status and topic planning](core-src-08.md) — dependency
- [Update, verify, walker and metrics](core-src-09.md) — dependency
<!-- livewiki:navigate:end -->
