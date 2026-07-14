---
title: MCP server module
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

# MCP server module

This module implements the `@livewiki/mcp` Model Context Protocol server, the agent-facing entry point that exposes wiki read/write tools, full-text search, and documentation debt tracking over stdio.

## When to use this page

- **Run** the MCP server in production with `npx -y @livewiki/mcp --repo <path>`.
- **Connect** an MCP client (Claude Code or test harness) to the stdio transport and call the 6 `livewiki_*` tools.
- **Debug** the wiki allowlist, `verify`-then-write semantics, or FTS5 indexing for `livewiki_search` / `livewiki_write_doc`.
- **Extend** the server with additional tools or alternative transports while keeping `core/safe-io` as the file-write boundary.

## How it fits

`packages/mcp/src/` sits in the monorepo between `@livewiki/core` (the source of truth for init/verify/status/safe-io) and external MCP clients. `server.ts` builds an `McpServer` that delegates filesystem work to `core/safe-io` and database access to `core/db` / `core/status`, and uses the local `search.ts` module for FTS5 indexing. `index.ts` wires that server to the stdio transport and installs graceful shutdown handlers; `server.test.ts` exercises the tool surface in-process via `InMemoryTransport`, while `phase5-e2e.test.ts` orchestrates a full hook → MCP → verify round-trip using the compiled CLI for the subprocess steps.

## CLI entry: parseArgs and main

<!-- lw:anchors packages/mcp/src/index.ts#main packages/mcp/src/index.ts#parseArgs -->

`parseArgs` scans `argv` for a `--repo <path>` flag (resolved via `nodePath.resolve`) and falls back to `process.cwd()` when the flag is absent or has no following value:

```ts
function parseArgs(argv: readonly string[]): { repoRoot: string } {
  let repoRoot = process.cwd();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--repo" && argv[i + 1] !== undefined) {
      repoRoot = nodePath.resolve(argv[i + 1]!);
      i++;
    }
  }
  return { repoRoot };
}
```

`main` consumes that result, instantiates the server with `createServer({ repoRoot })`, connects it to a `StdioServerTransport`, and registers `SIGINT`/`SIGTERM` handlers that call `server.close()` (which in turn closes the FTS5 index) before exiting 0:

```ts
async function main(): Promise<void> {
  const { repoRoot } = parseArgs(process.argv.slice(2));
  const server = await createServer({ repoRoot });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // ... shutdown handler best-effort closes server on signal ...
}
```

Any thrown error from `main` is caught one level up and produces exit code 1 with a `[livewiki-mcp] fatal: ...` message on stderr; the shutdown handler is explicitly best-effort (`catch {}`) so a failing `server.close()` cannot prevent `process.exit(0)`. The excerpt does not establish behavior for malformed `--repo` values beyond what `nodePath.resolve` accepts.

## FTS5 search index: openAndIndex, reindexAll, collectMarkdownFiles, walk

<!-- lw:anchors packages/mcp/src/search.ts#openAndIndex packages/mcp/src/search.ts#reindexAll packages/mcp/src/search.ts#collectMarkdownFiles packages/mcp/src/search.ts#walk -->

`openAndIndex` resolves the search-db path through `safeIo.resolveAndValidate` (caller-side path validation), ensures `.livewiki/` exists, opens a better-sqlite3 connection in WAL mode, and creates the `wiki_search` virtual table if it isn't there yet before delegating the bulk reindex to `reindexAll`:

```ts
export async function openAndIndex(
  repoRoot: string,
): Promise<SearchIndex> { /* ... */ }
```

`reindexAll` clears the table and inserts each markdown page's relative path and content in a single transaction; unreadable files are silently skipped (`catch {}`), so a partial filesystem failure does not abort startup:

```ts
async function reindexAll(db: Database.Database, absRoot: string): Promise<void> { /* ... */ }
```

`collectMarkdownFiles` recursively walks a directory by delegating to the nested `walk` helper, which `readdir`s with `withFileTypes: true`, recurses into directories, and collects any file whose name ends in `.md`; if the top-level directory does not exist (empty wiki), `walk` returns early via a swallowed `readdir` error so the caller simply gets `[]`:

```ts
async function collectMarkdownFiles(dir: string): Promise<string[]> { /* ... */ }
async function walk(d: string): Promise<void> { /* ... */ }
```

The excerpt does not establish what happens if a markdown file becomes unreadable between the `readdir` and `readFile` calls — that case falls through the per-file `catch` in `reindexAll` and the page simply won't be indexed.

## Incremental index updates and search: indexPage, removePage, search, close

<!-- lw:anchors packages/mcp/src/search.ts#indexPage packages/mcp/src/search.ts#removePage packages/mcp/src/search.ts#search packages/mcp/src/search.ts#close -->

Per-page updates from `livewiki_write_doc` go through `indexPage`, which emulates FTS5 upsert by running `DELETE` + `INSERT` inside a transaction so a crash mid-write can't leave the row in an inconsistent state:

```ts
export function indexPage(idx: SearchIndex, wikiPath: string, content: string): void { /* ... */ }
```

`removePage` is the delete counterpart; it issues a plain `DELETE FROM wiki_search WHERE wiki_path = ?` and is documented as idempotent so callers need not worry about double removals:

```ts
export function removePage(idx: SearchIndex, wikiPath: string): void { /* ... */ }
```

`search` runs an FTS5 `MATCH` query ordered by rank, wraps results with the `snippet(..., '<<', '>>', '...', 32)` snippet helper, and maps each row into `{ wikiPath, snippet }`. A failed query (malformed FTS5 expression) is caught and reported as an empty result set rather than propagated — a fail-open choice for query syntax errors specifically:

```ts
export function search(idx: SearchIndex, query: string, opts: SearchOptions = {}): SearchHit[] { /* ... */ }
```

`close` simply closes the underlying better-sqlite3 handle and is called by `createServer`'s monkey-patched `server.close` so the FTS5 database and its WAL/SHM siblings are released on shutdown:

```ts
export function close(idx: SearchIndex): void { /* ... */ }
```

The excerpt does not establish exhaustive behavior for malformed FTS5 queries beyond the documented empty-array fallback.

## MCP server factory: createServer

<!-- lw:anchors packages/mcp/src/server.ts#createServer -->

`createServer` constructs the `McpServer` (name `livewiki`, version `0.0.0`), opens the FTS5 index through `openAndIndex`, and registers the six tool handlers; it does not connect a transport — that is the caller's responsibility (stdio in `index.ts`, `InMemoryTransport` in the tests):

```ts
export async function createServer(opts: CreateServerOptions = {}): Promise<McpServer> { /* ... */ }
```

The `verify` option is a test seam for forcing verifier failures; production wires `core/verify.run` so every `livewiki_write_doc` writes are run through the same verify pipeline as the CLI. The factory's internal helpers are:

- `textResult` / `errorResult` — wrap a string into the MCP `content` array, with `errorResult` additionally setting `isError: true`.
- `rollbackWrittenPage` — best-effort `unlink` of the just-written page via `safeIo.resolveAndValidate`; returns `false` if the unlink fails so the caller can detect a post-verify "UNVERIFIED on disk" situation.

The shutdown behavior matters for the test suite: `createServer` rebinds `server.close` to first `closeSearch(searchIdx)` and then delegate to the original, ensuring the FTS5 handle is released before the MCP layer disconnects (the source comment specifically calls out Windows file locking around `search.db-shm`).

The factory implements the write path as follows, with each branch documented in `server.test.ts`:

1. **Allowlist** — `safeIo.writeText` validates the path; `PathOutsideAllowlistError` throws `McpError(InvalidParams, ...)`, `InvalidRelativePathError` throws `McpError(InvalidParams, ...)`, and any other safe-io error becomes an `errorResult`.
2. **Verify (unless `skipVerify === true`)** — runs `verify(repoRoot)`; if there is any error-severity issue for `wikiPath === path` (or empty), the file is rolled back via `rollbackWrittenPage` and an `errorResult` such as `verify rejected the page ... Page NOT written.` is returned. If `verify` itself throws, the page is rolled back; on rollback failure the factory returns an `errorResult` that includes the literal token `UNVERIFIED` and instructs the caller to inspect the path on disk.
3. **Index** — on the success path, `indexPage(searchIdx, path, content)` updates the FTS5 row and the tool returns `wrote <path> (verified)` (or, with `skipVerify`, just `wrote <path>`).

`livewiki_resolve_debt` opens `.livewiki/index.db` via `safeIo.resolveAndValidate`, runs a single transaction that updates `debt.resolved_at` for each requested ID, and partitions the input into `{ resolved, notFound, writeRef?, timestamp }`; the DB is closed in a `finally` so a throw inside the transaction still releases the handle.

`livewiki_debt` is a thin wrapper over `core/status.run(repoRoot)`, serialized as JSON. The excerpt does not establish how `livewiki_read` distinguishes a "path not found" from a "path outside allowlist" error — both fall through to `errorResult(err.message)`, where the safe-io error message is reused but does not leak absolute paths or repo contents.

## Server tests: connect, teardown, extractText

<!-- lw:anchors packages/mcp/src/server.test.ts#connect packages/mcp/src/server.test.ts#teardown packages/mcp/src/server.test.ts#extractText -->

The server test file uses `InMemoryTransport` to drive a real `McpServer` against a real `Client` over a linked-pair transport so tool handlers run end-to-end without spawning a subprocess. The per-test lifecycle is a `connect` + `try { ... } finally { teardown(c) }` pattern; this is mandatory, not optional:

```ts
async function connect(opts: Omit<CreateServerOptions, "repoRoot"> = {}): Promise<Connected> { /* ... */ }
async function teardown(c: Connected): Promise<void> { /* ... */ }
```

The `teardown` helper closes both client and server so the FTS5 database and its WAL/SHM sidecars are released before the `afterEach` recursive `nodeFs.rm` — otherwise Windows file locking can leave `.livewiki/` behind with `EBUSY`. The `connect` helper seeds `src/auth/login.ts` and `src/utils/helper.ts` via `runInit({ repoRoot, quiet: true })` from `@livewiki/core/init`, so each test gets a fully indexed repo without going through the CLI subprocess.

`extractText` is a discriminated-result helper for the MCP `callTool` payload: it walks `result.content`, filters to entries with `type === "text"`, and joins their `text` strings with `\n`. It returns `""` for any input that isn't an object with an array `content` field, which the tests rely on for both happy paths (`livewiki_quickstart`, `livewiki_read`) and error paths (`livewiki_read` reject, `livewiki_write_doc` verify rejection):

```ts
function extractText(r: unknown): string { /* ... */ }
```

The tests assert the documented failure modes of `livewiki_write_doc`:

- **Allowlist** — `livewiki_write_doc` with `path: "src/evil.ts"` returns either `isError: true` or throws `McpError`; the assertion additionally re-runs with `"src/evil2.ts"` to cover the throw path, and verifies the file never reaches disk via `nodeFs.access(...).rejects.toThrow()`.
- **Broken anchor** — content with `anchors: [src/auth/login.ts#symbolQueNaoExiste]` returns `isError: true` containing `verify rejected`, and the destination file is asserted not to exist.
- **Verify crash with successful rollback** — when the injected `verify` throws and the rollback succeeds, the response carries the crash message and the literal substring `"not kept"`; a subsequent `livewiki_search` for the page's sentinel text returns `{ hits: [] }`, proving the FTS5 index was not updated.
- **Verify crash with failed rollback** — when the injected `verify` unlinks the file and then throws, the response contains `"UNVERIFIED"` and the original path string, plus a case-insensitive `inspect` directive, so callers know the disk state is suspect.
- **Skip-verify escape** — `skipVerify: true` bypasses the verify step and accepts a non-anchor page.

The excerpt does not establish behavior for repos whose `livewiki/` allowlist exists but is empty at test time — those tests are not visible here.

## Phase-5 end-to-end test: connectMcp, runCli, runVerify, teardown

<!-- lw:anchors packages/mcp/src/phase5-e2e.test.ts#connectMcp packages/mcp/src/phase5-e2e.test.ts#runCli packages/mcp/src/phase5-e2e.test.ts#runVerify packages/mcp/src/phase5-e2e.test.ts#teardown -->

The Phase-5 test exercises the full hook → MCP → verify round trip and therefore mixes two execution models: subprocess for the CLI steps (so the real `packages/cli/dist/index.js` binary is hit), and in-process for the MCP server (so the same `InMemoryTransport` pair used in Fase-4 tests is reused here). The helpers split accordingly:

```ts
function runCli(args: readonly string[], cwd: string): Promise<SubprocessResult> { /* ... */ }
async function connectMcp(repoRoot: string): Promise<Connected> { /* ... */ }
async function teardown(c: Connected): Promise<void> { /* ... */ }
async function runVerify(repoRoot: string): Promise<VerifyOutput> { /* ... */ }
```

`runCli` spawns `process.execPath` with `[cliBin, ...args, "--repo", cwd]`, captures `stdout`/`stderr` via stream listeners, and resolves with `{ code, stdout, stderr }` on `close` (or rejects on `error`). The test file hard-checks that the compiled CLI exists at `packages/cli/dist/index.js` at module-load time and throws an explicit `pnpm -r build` reminder if missing, so the e2e test cannot run against a stale build silently.

`runVerify` calls `runCli(["verify", "--json"], repoRoot)` and then attempts to `JSON.parse` the captured stdout; if the parse fails it falls back to extracting the first `{...}` block via regex and parsing that instead. The return shape is structured for the acceptance criteria: `ok` (from `parsed.ok ?? false`), `exitCode` (from `r.code ?? -1`), and `issues` (the full `severity / kind / detail / wikiPath` array — the test comments make it explicit that the spec requires asserting issue counts, not just `exitCode`).

`connectMcp` resolves the MCP client/server pair against a freshly created `repoRoot`, and `teardown` closes both ends before the per-test `afterEach` `nodeFs.rm` runs — the same lifecycle discipline as `server.test.ts`, again because of Windows FTS5 file locking.

The full-flux test ("fluxo completo") sequences `init → write_doc (initial) → index → edit source → hook index --quiet → status → write_doc (paid) → verify → init (manifest refresh) → status (debt ≤ before)`, asserts `verify.issues.length === 0` AND `verify.ok === true` (not just exit code), and checks that `manifest.updatedAt` and `manifest.snapshotHash` both differ from the pre-edit snapshot — capturing the "disco é a verdade" rule from the spec.

The rejection-and-rollback test ("write_doc rejeita página com anchor quebrada E rollback restaura estado anterior") writes a good page, then a page with a `src/auth.ts#ghostSymbol` anchor, and asserts that `isError === true`; afterwards it accepts either no file on disk OR the previous good content containing the literal `ghostSymbol` substring is absent, covering both atomic-write and rollback-to-prior semantics. The excerpt does not establish which exact rollback policy the server implements, so the test is scoped to either being correct.

A separate `describe` block covers the reviewer finding (R): `livewiki init` must add `.livewiki/` to the target repo's `.gitignore`. The helper signature remains the same (`runCli`), and the assertions cover: (1) `.gitignore` is created with the managed `# livewiki:start` / `# livewiki:end` block when absent, (2) user entries (`node_modules/`, `dist/`, `*.log`) are preserved on append, (3) re-running `init` is idempotent (the literal `.livewiki/` line count is exactly 1), (4) a user-added `.livewiki/` outside the managed block is not duplicated, and (5) `init --batch` still creates the gitignore handling (this case is gated by an `if (giExists)` so a missing-LLM-config `init --batch` is allowed to log a code `!= 0` without failing the test).

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
<!-- livewiki:navigate:end -->
