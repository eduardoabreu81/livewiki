---
title: livewiki MCP server source module
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

# livewiki MCP server source module

This page documents the source of the `@livewiki/mcp` package: the stdio entry point, the SQLite FTS5 search layer, the MCP server factory, and the two end-to-end Vitest suites that exercise the server.

## When to use this page

- **Wire up an MCP client** (Claude Code, MCP inspector, custom agent) by copying the `npx @livewiki/mcp --repo <path>` invocation pattern and matching the exit-code contract documented for `main`.
- **Debug search behavior** by tracing a query through `openAndIndex`, `reindexAll`, and `search`, including the FTS5 syntax-error fallback.
- **Audit the write_doc safety guarantees** (allowlist enforcement, verify-before-commit, rollback on crash) by reading the `livewiki_write_doc` handler inside `createServer`.
- **Run or extend the Phase 4 / Phase 5 e2e suites** to verify MCP transport behavior or the hook→MCP→verify end-to-end flow.

## How it fits

`packages/mcp/src/` is the runtime surface that any MCP-speaking agent uses against a livewiki-initialized repo. It depends on `@livewiki/core` for `safe-io`, `verify`, `status`, `init`, and the SQLite index opened via `openIndex`; it depends on `@modelcontextprotocol/sdk` for `McpServer`, `StdioServerTransport`, `Client`, and `InMemoryTransport`. The package has five TypeScript files: `index.ts` boots the stdio transport, `server.ts` registers the six MCP tools and wraps every write through allowlist + verify + rollback, `search.ts` owns the separate `.livewiki/search.db` FTS5 database, and the two `*.test.ts` files exercise the server in-process via `InMemoryTransport` and end-to-end against the compiled CLI binary.

The `server.ts#createServer` factory is the integration point: `index.ts` calls it to attach `StdioServerTransport`, and both test files call it directly to wire an `InMemoryTransport` pair. `search.ts` is opened transitively through `createServer` via `openAndIndex`, and is closed when `server.close()` is invoked. The two suites share no helpers directly with each other, but each declares its own `connect`/`connectMcp` and `teardown` helpers because the test file scoping is per-test-file.

## stdio entry point (index.ts)
<!-- lw:anchors packages/mcp/src/index.ts#main packages/mcp/src/index.ts#parseArgs -->

The package is launched as a long-lived stdio process. The file-level JSDoc specifies that exit code `0` means clean shutdown and exit code `1` means a setup error (for example an invalid repo path). A fatal error from `main` is caught at module scope and written to stderr before `process.exit(1)`.

```ts
function parseArgs(argv: readonly string[]): { repoRoot: string } {
```

`parseArgs` walks the argv slice looking for `--repo <path>`; when it finds it, it resolves the value with `nodePath.resolve` and stores it. Any other argument is ignored, so an unrecognised flag is silently skipped. If `--repo` is absent, `repoRoot` defaults to `process.cwd()`. The excerpt does not establish exhaustive behavior for malformed `--repo` values beyond the `argv[i + 1] !== undefined` guard that prevents reading past the end.

```ts
async function main(): Promise<void> {
```

`main` resolves the repo root via `parseArgs`, awaits `createServer({ repoRoot })`, then connects a `StdioServerTransport` to the resulting server. It registers `SIGINT` and `SIGTERM` handlers that write a shutdown notice to stderr, attempt `server.close()` inside a try/catch (best-effort — the catch swallows errors so the process can still exit `0`), and then `process.exit(0)`. Because `await server.connect(transport)` does not return until the transport closes, the process stays alive while the MCP client remains connected and exits via the signal handler or the transport closing.

## MCP server factory (server.ts)
<!-- lw:anchors packages/mcp/src/server.ts#createServer -->

```ts
export async function createServer(opts: CreateServerOptions = {}): Promise<McpServer> {
```

`createServer` resolves `opts.repoRoot` against `process.cwd()` when not supplied, picks `opts.verify` if provided otherwise falls back to the imported `runVerify`, and opens the search index via `openAndIndex`. It then constructs an `McpServer` named `livewiki` with `capabilities.tools = {}` and registers six tools via `server.tool(...)`. The factory does not connect any transport — transport binding is the caller's job.

Two internal helpers stay local to the closure: `textResult(text)` wraps a plain string into MCP's `{ content: [{ type: 'text', text }] }` shape, and `errorResult(message)` returns the same shape with `isError: true` and an `error: ` prefix. A third helper, `rollbackWrittenPage(path)`, attempts to `unlink` the just-written file through `safeIo.resolveAndValidate` and returns `true` only if the unlink succeeded — the caller uses that boolean to decide whether to report the page as `UNVERIFIED` on disk.

The six tools registered by `createServer` are:

- `livewiki_quickstart` — returns `livewiki/quickstart.md` via `safeIo.readText`. On read failure (the wiki isn't initialized), it returns an `errorResult` carrying the error message; the excerpt does not show it re-throwing as `McpError`.
- `livewiki_read` — reads any path through `safeIo.readText`. Errors are surfaced via `errorResult` without re-throwing, so the message comes from `safeIo` and is deliberately scrubbed of absolute paths and repo contents.
- `livewiki_search` — delegates to `doSearch(searchIdx, query, { limit })` and returns `JSON.stringify({ query, hits }, null, 2)`. If `limit` is `undefined` it is omitted from the options object; otherwise it is passed through. The tool returns `errorResult` on thrown errors; the underlying `search` in `search.ts` also swallows FTS5 syntax errors itself, so this branch is for unexpected throws.
- `livewiki_debt` — runs `runStatus(repoRoot)` and JSON-stringifies the report with indentation. Errors are returned via `errorResult`.
- `livewiki_write_doc` — the only mutating tool. Its handler is the document's safety contract: see "Write safety in createServer" below.
- `livewiki_resolve_debt` — opens `.livewiki/index.db` via `openIndex`, runs a single transaction that issues `UPDATE debt SET resolved_at = ? WHERE id = ? AND resolved_at IS NULL` for each requested ID, and returns `{ resolved, notFound, writeRef?, timestamp }`. IDs that matched no open row land in `notFound`. The DB is closed in a `finally` block.

After all six tools are registered, `createServer` overrides `server.close` so it first calls `closeSearch(searchIdx)` and then delegates to the original close. That override is the only mechanism that lets the FTS5 db be closed cleanly from `index.ts`'s signal handlers without forcing callers to know about the search layer.

### Write safety in createServer

`livewiki_write_doc` is structured as three sequential steps inside one tool handler:

1. **Allowlist write.** It calls `safeIo.writeText(repoRoot, path, content)`. A `PathOutsideAllowlistError` is re-thrown as `McpError(InvalidParams, …)` so MCP clients see a structured error code; an `InvalidRelativePathError` is also re-thrown as `InvalidParams`. Any other thrown error is downgraded to `errorResult`. Because the write goes through `safe-io`, `path` is validated against the allowlist and symlinks are checked before any bytes hit disk.
2. **Verify unless skipped.** When `skipVerify !== true`, it awaits `verify(repoRoot)` and inspects `verifyResult.issues`. If any error-level issue references the just-written `path` (or has an empty `wikiPath`), the page is rolled back via `rollbackWrittenPage` and `errorResult` reports the count plus the first issue's `code`/`detail`. If `verify` itself throws, the message is captured into `crashMessage`; the file is rolled back, and the handler returns an `errorResult` with `crashMessage`. When rollback itself fails (the unlink threw), the response explicitly says the disk may hold an UNVERIFIED page at that path and tells the caller to inspect it before continuing. The excerpt does not establish behavior for other thrown errors from the rollback path beyond the boolean return.
3. **Index then confirm.** On the happy path, the handler calls `indexPage(searchIdx, path, content)` to upsert into the FTS5 table, then returns `textResult(\`wrote ${path} (verified)\`)`. When `skipVerify: true` is passed, steps 2 is skipped entirely (the JSDoc notes this is intended for legitimate non-anchor pages such as `quickstart.md`); step 3 still runs, so the index stays consistent.

## SQLite FTS5 search layer (search.ts)
<!-- lw:anchors packages/mcp/src/search.ts#openAndIndex packages/mcp/src/search.ts#reindexAll packages/mcp/src/search.ts#collectMarkdownFiles packages/mcp/src/search.ts#walk packages/mcp/src/search.ts#indexPage packages/mcp/src/search.ts#removePage packages/mcp/src/search.ts#search packages/mcp/src/search.ts#close -->

The file's header JSDoc explains the architectural choice: `.livewiki/search.db` is kept separate from `.livewiki/index.db` so the FTS5 schema doesn't bump `core` to v5, the search DB is rebuildable from the wiki as source of truth, and `core` stays free of an FTS5 dependency. The tokenizer is `porter` (FTS5's default).

```ts
export async function openAndIndex(
```

`openAndIndex` resolves `repoRoot`, resolves and validates the search-db path via `safeIo.resolveAndValidate(absRoot, SEARCH_DB_REL)`, ensures `.livewiki/` exists with `safeIo.mkdir`, opens a `better-sqlite3` `Database` with `journal_mode = WAL`, creates a virtual table `wiki_search(wiki_path UNINDEXED, content)` if missing, calls `reindexAll`, and returns `{ db }` as the `SearchIndex` handle. Its JSDoc states it does not validate the path because the caller (`createServer`) has already routed through `safe-io`.

```ts
async function reindexAll(db: Database.Database, absRoot: string): Promise<void> {
```

`reindexAll` is destructive but idempotent: it `DELETE FROM wiki_search`, walks `livewiki/`, reads every `.md` file, stores `{ path, content }` tuples (with the `path` converted to forward-slash relative form), and commits them in a single transaction via a prepared `INSERT`. Files that fail to read are skipped via a `try`/`catch` around `nodeFs.readFile`; the excerpt does not show what happens to those skipped entries other than that they are absent from the batch.

```ts
async function collectMarkdownFiles(dir: string): Promise<string[]>
```

`collectMarkdownFiles` is a wrapper that returns absolute paths to every `*.md` file under `dir`. It declares a nested recursive helper, `walk`, which reads `dir` with `withFileTypes: true`. If `readdir` throws (the wiki directory does not exist), `walk` returns immediately and the outer function returns an empty array — that branch is how an empty wiki yields zero search hits rather than an error.

```ts
async function walk(d: string): Promise<void>
```

`walk` is the nested helper used only by `collectMarkdownFiles`. For each directory entry it recurses when `e.isDirectory()` and pushes the path when `e.isFile() && e.name.endsWith('.md')`. Symlinks and other entry types are silently ignored. The function is not exported.

```ts
export function indexPage(idx: SearchIndex, wikiPath: string, content: string): void
```

`indexPage` performs the FTS5 equivalent of upsert (FTS5 has no native UPSERT): a transaction that `DELETE`s the existing row for `wiki_path` and then `INSERT`s the new one. The two statements run inside `idx.db.transaction(...)` so a reader can never observe a missing row mid-update.

```ts
export function removePage(idx: SearchIndex, wikiPath: string): void
```

`removePage` runs a single `DELETE FROM wiki_search WHERE wiki_path = ?` and is documented as idempotent — a no-op when the row doesn't exist.

```ts
export function search(
```

`search` builds the query with `idx.db.prepare` selecting `wiki_path` and `snippet(wiki_search, 1, '<<', '>>', '...', 32)`, ordered by `rank` and limited. It runs `.all(query, limit)` with `limit = opts.limit ?? 20` and maps rows to `{ wikiPath, snippet }`. The entire query is wrapped in a `try`/`catch` that returns `[]` on any thrown error; the comment explains this is because FTS5 syntax errors (e.g. an unmatched quote) would otherwise bubble out as an exception. The excerpt does not show what happens on a successful but empty result — based on the `prepare().all(...)` shape, it is `[]`.

```ts
export function close(idx: SearchIndex): void
```

`close` simply calls `idx.db.close()`. The function is wired into `server.close` by `createServer`, and called directly from `index.ts`'s signal handlers via `server.close()`.

## Phase 4 server tests (server.test.ts)
<!-- lw:anchors packages/mcp/src/server.test.ts#connect packages/mcp/src/server.test.ts#teardown packages/mcp/src/server.test.ts#extractText -->

The file's header explains it is the Phase 4 acceptance suite: it spins up `createServer` against a temporary repo with two source files (`src/auth/login.ts`, `src/utils/helper.ts`) and an initialised wiki (via the programmatic `runInit` from `@livewiki/core/init`), then connects a real `Client` to the `McpServer` over `InMemoryTransport`. The header notes a Windows EBUSY hazard: `better-sqlite3` opens WAL shadow files, so each test must close both client and server in a `finally` before `afterEach` recursively `rm`s the temp dir.

```ts
async function connect(opts: Omit<CreateServerOptions, "repoRoot"> = {}): Promise<Connected>
```

`connect` awaits `createServer({ repoRoot, ...opts })`, constructs a `Client` named `test-agent`, builds a linked pair via `InMemoryTransport.createLinkedPair()`, and connects both ends in parallel with `Promise.all`. Returning `{ client, server }` gives the caller the handles needed to call `teardown(c)`.

```ts
async function teardown(c: Connected): Promise<void>
```

`teardown` closes the client first, then the server. The order is documented as deliberate on Windows so the FTS5 WAL handles are released before the temp dir is removed.

```ts
function extractText(r: unknown): string
```

`extractText` is a defensive helper for parsing MCP `callTool` results. It returns `""` for non-objects or for results whose `content` isn't an array; otherwise it joins every block where `type === 'text'` and `text` is a string, separated by newlines. It tolerates the SDK's discriminated union by walking the array rather than narrowing on a specific shape.

The describe block exercises the full Phase 4 acceptance criteria: `tools/list` returns the six expected tool names in sorted order; `livewiki_quickstart` and `livewiki_read` both return content matching `/Quickstart|Guia/`; `livewiki_read` rejects `src/auth/login.ts` with an error matching `/allowlist|outside|livewiki/i`; `livewiki_search` for `modules` returns a `hits` array; `livewiki_debt` returns an object with `files`, `symbols`, `debt`, and `undocumented` keys; `livewiki_write_doc` with a valid unanchored page produces a `wrote livewiki/scratch.md` message and writes the file to disk; the same tool rejects `src/evil.ts` and never creates the file; a page with `src/auth/login.ts#symbolQueNaoExiste` as its anchor is rejected with `verify rejected` and the file is rolled back; when the injected `verify` throws, the response is `isError: true`, includes the crash message, contains `not kept` (or `UNVERIFIED` plus `inspect` if rollback itself failed), and a follow-up search for a sentinel string returns zero hits — proving the page never made it into the FTS5 index; `skipVerify: true` accepts the same content; `livewiki_resolve_debt({ debtIds: [9999] })` returns `{ resolved: [], notFound: [9999] }`; and `.livewiki/search.db` exists on disk after `createServer` runs.

## Phase 5 end-to-end tests (phase5-e2e.test.ts)
<!-- lw:anchors packages/mcp/src/phase5-e2e.test.ts#runCli packages/mcp/src/phase5-e2e.test.ts#connectMcp packages/mcp/src/phase5-e2e.test.ts#teardown packages/mcp/src/phase5-e2e.test.ts#runVerify -->

This suite is the acceptance test for SPEC §"Fase 5": a fresh repo with one source file (`src/auth.ts`) goes through `livewiki init`, a baseline `livewiki index`, an in-process MCP `livewiki_write_doc` that creates a properly anchored `livewiki/auth.md`, a code edit that changes the body of `validate`, a hook-style `livewiki index --quiet`, a `livewiki status --json` that must report an open `changed` debt for `src/auth.ts#validate`, a second MCP `write_doc` paying the debt, and finally `livewiki verify --json` which must assert on issue count (zero) and exit code (`0`), not on exit code alone. A second `livewiki init` is then expected to bump `manifest.updatedAt` and `manifest.snapshotHash`. The header notes the design split: subprocesses test the real CLI binary (what the hook and agent will call in production), while the MCP leg stays in-process via `InMemoryTransport` to avoid stdio flakiness.

The file resolves `cliBin` to `packages/cli/dist/index.js` at module scope and `throw`s on import if that file is missing — the suite assumes `pnpm -r build` was run.

```ts
function runCli(args: readonly string[], cwd: string): Promise<SubprocessResult> {
```

`runCli` spawns `process.execPath` (the current Node binary) with `[cliBin, ...args, "--repo", cwd]`, ignoring stdin and piping stdout/stderr into string accumulators. It resolves with `{ code, stdout, stderr }` on `close` and rejects on `error`. The captured `SubprocessResult` is what the rest of the suite pattern-matches against.

```ts
async function connectMcp(repoRoot: string): Promise<Connected>
```

`connectMcp` is the in-process counterpart to `connect` from `server.test.ts`: it awaits `createServer({ repoRoot })`, constructs a `Client` named `phase5-e2e-agent`, links a transport pair, and connects both ends in parallel. The returned `Connected` carries both `client` and `server` handles.

```ts
async function teardown(c: Connected): Promise<void>
```

`teardown` closes the client first and then the server, matching the order documented in `server.test.ts` so the FTS5 WAL handles are released before the temp directory is removed by `afterEach`.

```ts
async function runVerify(repoRoot: string): Promise<VerifyOutput>
```

`runVerify` shells out to `livewiki verify --json` via `runCli`, then parses the stdout. If `JSON.parse` throws, it falls back to extracting the first `{…}` block via a regex before parsing. The result is normalised into a `VerifyOutput` shape with `ok` defaulting to `parsed.ok ?? false`, `exitCode` defaulting to `r.code ?? -1`, `issues` defaulting to `parsed.issues ?? []`, and `rawStdout` preserved. The fallback exists because the comment notes that human-mode `verify` can emit text before the JSON, but with `--json` only JSON is expected.

The two `it` blocks in the main describe cover the full Phase 5 happy path and a `write_doc` rejection-with-rollback case. A separate `describe` block titled "E2E Fase 5 — Achado R" documents a reviewer finding that `livewiki init` must add `.livewiki/` to the target repo's `.gitignore` inside a managed `# livewiki:start` … `# livewiki:end` block, idempotently, without clobbering user entries, and even when `init --batch` is used (with a conditional assertion that tolerates `init --batch` aborting due to missing LLM config while still verifying the `.gitignore` was created). The excerpt establishes the helper contracts above but does not, on its own, cover the full body of the `Achado R` tests beyond what is quoted.

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
- [Batch orchestration, configuration, index, and diagram generation](core-src-03.md) — dependency
- [Stage-5 planning, prompt templates, and safe disk I/O core](core-src-08.md) — dependency
- ["core-src-09 — walker, update package, metrics, and verify pipeline"](core-src-09.md) — dependency
<!-- livewiki:navigate:end -->
