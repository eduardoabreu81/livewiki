---
title: mcp/src package — MCP server, FTS5 search index, and end-to-end tests
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

# mcp/src package — MCP server, FTS5 search index, and end-to-end tests

This package hosts the stdio MCP server for `@livewiki/mcp`, its SQLite FTS5 search index, and two Vitest suites that exercise the full hook → MCP → verify loop.

## When to use this page

- **Wire** the `livewiki` MCP server into an agent by invoking the stdio entry point with `--repo <path>`.
- **Debug** `livewiki_search` behaviour by inspecting the FTS5 rebuild, indexing, and query routines in `search.ts`.
- **Run or extend** the Phase 4 in-memory MCP tests (`server.test.ts`) or the Phase 5 end-to-end subprocess tests (`phase5-e2e.test.ts`).

## How it fits

The package lives under `packages/mcp/src/` inside the livewiki monorepo and is consumed by the Claude Code MCP configuration described in the `index.ts` header. `index.ts` parses a CLI `--repo` flag, calls `createServer` from `./server.ts`, and connects it to `StdioServerTransport`. The server itself wires the six SPEC tools (`livewiki_quickstart`, `livewiki_read`, `livewiki_search`, `livewiki_debt`, `livewiki_write_doc`, `livewiki_resolve_debt`) and delegates FTS5 work to `./search.ts`, which opens `.livewiki/search.db`, rebuilds the index from `livewiki/`, and exposes incremental `indexPage` / `removePage` hooks. Tests in this folder use `InMemoryTransport` to connect an `McpServer` with a `Client` (Phase 4) and shell out to the compiled CLI as subprocesses (Phase 5).

## CLI entry point and shutdown

<!-- lw:anchors packages/mcp/src/index.ts#parseArgs packages/mcp/src/index.ts#main -->

`parseArgs` has the signature:

```ts
function parseArgs(argv: readonly string[]): { repoRoot: string }
```

It scans `argv` for a `--repo <path>` pair and otherwise falls back to `process.cwd()`, resolving any provided path through `nodePath.resolve`.

`main` has the signature:

```ts
async function main(): Promise<void>
```

It parses argv, creates the server with the resolved `repoRoot`, attaches a `StdioServerTransport`, and installs `SIGINT` / `SIGTERM` handlers that call `server.close()` before exiting 0. If `createServer` or the transport throws, the top-level `main().catch(...)` writes the error to stderr and exits 1 — so a setup failure surfaces as a non-zero exit, not a silent hang.

## Server factory and tool registration

<!-- lw:anchors packages/mcp/src/server.ts#createServer -->

`createServer` has the signature:

```ts
export async function createServer(opts: CreateServerOptions = {}): Promise<McpServer>
```

It resolves `opts.repoRoot` (defaulting to `process.cwd()`), opens the FTS5 index via `openAndIndex`, and registers the six MCP tools. `livewiki_write_doc` first writes through `safeIo.writeText` (so paths outside the `livewiki/` allowlist raise `PathOutsideAllowlistError` or `InvalidRelativePathError` and are surfaced as `McpError` with `ErrorCode.InvalidParams`). It then runs the supplied `verify` (defaulting to `runVerify` from `@livewiki/core/verify`); if any error-level issue references the just-written path, or if `verify` itself throws, the tool rolls back the file via `rollbackWrittenPage`. When the rollback fails after a verifier crash, the error message explicitly tells the caller that disk may hold an `UNVERIFIED` page at the rejected path — a fail-closed path with a visible warning. On the success branch the tool calls `indexPage` to update FTS5 incrementally. `server.close` is overridden so that closing the `McpServer` also closes the search index via `closeSearch`.

## Search index lifecycle and queries

<!-- lw:anchors packages/mcp/src/search.ts#openAndIndex packages/mcp/src/search.ts#reindexAll packages/mcp/src/search.ts#collectMarkdownFiles packages/mcp/src/search.ts#walk packages/mcp/src/search.ts#indexPage packages/mcp/src/search.ts#removePage packages/mcp/src/search.ts#search packages/mcp/src/search.ts#close -->

`openAndIndex` (signature truncated in the symbol table: `export async function openAndIndex(`) ensures `.livewiki/` exists, opens `.livewiki/search.db` in WAL mode, creates the `wiki_search` FTS5 virtual table if absent, and triggers `reindexAll` before returning a `SearchIndex` handle. `reindexAll` clears the table, walks `livewiki/`, and inserts every markdown file in a single transaction — unreadable files are skipped via a `try/catch`. `collectMarkdownFiles` delegates the recursion to `walk`, which `readdir`s with `withFileTypes`, descends into directories, and collects files whose names end in `.md`; a missing wiki directory is treated as an empty result rather than an error. `indexPage` performs a transactional `DELETE` + `INSERT` (FTS5 has no native UPSERT), and `removePage` issues a plain `DELETE` for idempotent cleanup. `search` runs an FTS5 `MATCH` query ordered by `rank` with a default limit of 20, returning `{ wikiPath, snippet }` pairs; FTS5 syntax errors are caught and return `[]` instead of throwing. `close` simply closes the underlying `better-sqlite3` database handle.

## Phase 4 server tests

<!-- lw:anchors packages/mcp/src/server.test.ts#connect packages/mcp/src/server.test.ts#teardown packages/mcp/src/server.test.ts#extractText -->

`connect` has the signature:

```ts
async function connect(opts: Omit<CreateServerOptions, "repoRoot"> = {}): Promise<Connected>
```

It builds an `McpServer` via `createServer` against a shared `repoRoot`, pairs it with a `Client` over `InMemoryTransport.createLinkedPair()`, and returns both handles. `teardown` (signature `async function teardown(c: Connected): Promise<void>`) closes the client and the server — this order is critical on Windows because better-sqlite3 holds WAL files open until the server is closed. `extractText` (`function extractText(r: unknown): string`) flattens the discriminated `callTool` result by joining every `content` block whose `type === "text"`, providing a stable helper for assertions like `expect(text).toMatch(/wrote livewiki\/scratch\.md/)`. The suite asserts `tools/list` returns the six SPEC tools, `livewiki_read` rejects paths outside `livewiki/`, `livewiki_search` returns a JSON payload with an array of hits, `livewiki_debt` exposes `files` / `symbols` / `debt` / `undocumented`, `livewiki_write_doc` writes valid pages and rolls back broken anchors or verifier crashes, and `skipVerify: true` is accepted as a documented escape hatch.

## Phase 5 end-to-end tests

<!-- lw:anchors packages/mcp/src/phase5-e2e.test.ts#runCli packages/mcp/src/phase5-e2e.test.ts#connectMcp packages/mcp/src/phase5-e2e.test.ts#teardown packages/mcp/src/phase5-e2e.test.ts#runVerify -->

`runCli` has the signature:

```ts
function runCli(args: readonly string[], cwd: string): Promise<SubprocessResult>
```

It shells out to the compiled `packages/cli/dist/index.js` with `process.execPath`, appending `--repo <cwd>`, and captures `stdout`, `stderr`, and exit code into a `SubprocessResult`. The test throws early if the CLI binary is missing — `pnpm -r build` is a precondition. `connectMcp` (`async function connectMcp(repoRoot: string): Promise<Connected>`) and `teardown` (`async function teardown(c: Connected): Promise<void>`) reuse the same `InMemoryTransport` pattern as Phase 4, scoped per call so that `write_doc` sessions are isolated. `runVerify` (`async function runVerify(repoRoot: string): Promise<VerifyOutput>`) wraps `runCli(["verify", "--json"], repoRoot)`, parses the JSON, and falls back to extracting the first `{...}` block from stdout when the parse fails so the suite still gets a structured report. The scenarios assert the full hook → MCP → verify loop (debt opens on `livewiki index --quiet`, `livewiki_write_doc` resolves it, `verify` reports zero issues of every severity, and `manifest.updatedAt` advances after a re-init) and cover the broken-anchor rollback path plus the `.gitignore` reviewer finding that `init` must add `.livewiki/` inside a managed block while preserving user entries.

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
- ["Core pipeline: batch orchestration, config, db, and diagrams"](core-src-03.md) — dependency
- [core-src-08 — prompts, safe I/O, status, symbol extraction, and topic planning](core-src-08.md) — dependency
- [Update, verify, and walker core for livewiki](core-src-09.md) — dependency
<!-- livewiki:navigate:end -->
