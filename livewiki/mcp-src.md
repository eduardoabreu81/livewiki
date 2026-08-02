---
title: "@livewiki/mcp — MCP server, stdio entry, and FTS5 search index"
owner: generated
anchors:
  - packages/mcp/src/index.ts#main
  - packages/mcp/src/index.ts#parseArgs
  - packages/mcp/src/phase5-e2e.test.ts#connectMcp
  - packages/mcp/src/phase5-e2e.test.ts#runCli
  - packages/mcp/src/phase5-e2e.test.ts#runVerify
  - packages/mcp/src/phase5-e2e.test.ts#teardown
  - packages/mcp/src/search.test.ts#indexFixture
  - packages/mcp/src/search.test.ts#writePage
  - packages/mcp/src/search.ts#close
  - packages/mcp/src/search.ts#collectMarkdownFiles
  - packages/mcp/src/search.ts#indexPage
  - packages/mcp/src/search.ts#openAndIndex
  - packages/mcp/src/search.ts#queryTerms
  - packages/mcp/src/search.ts#reindexAll
  - packages/mcp/src/search.ts#reindexAllPages
  - packages/mcp/src/search.ts#removePage
  - packages/mcp/src/search.ts#search
  - packages/mcp/src/search.ts#snippetAround
  - packages/mcp/src/search.ts#splitIdentifiers
  - packages/mcp/src/search.ts#walk
  - packages/mcp/src/server.test.ts#assertWellFormedHints
  - packages/mcp/src/server.test.ts#connect
  - packages/mcp/src/server.test.ts#extractHints
  - packages/mcp/src/server.test.ts#extractText
  - packages/mcp/src/server.test.ts#git
  - packages/mcp/src/server.test.ts#hintTools
  - packages/mcp/src/server.test.ts#pollSnapshot
  - packages/mcp/src/server.test.ts#pollUntil
  - packages/mcp/src/server.test.ts#teardown
  - packages/mcp/src/server.ts#createServer
  - packages/mcp/src/server.ts#isWatchDenied
  - packages/mcp/src/server.ts#schedule
  - packages/mcp/src/server.ts#startWatcher
  - packages/mcp/src/server.ts#stop
  - packages/mcp/src/server.ts#syncBatch
---

# @livewiki/mcp — MCP server, stdio entry, and FTS5 search index

This page documents the `@livewiki/mcp` package, which hosts the MCP server the agent loop talks to.

## When to use this page

- **Configure** the livewiki MCP server for an MCP client (Claude Code or similar) by pointing it at this package's stdio entry with a `--repo` argument.
- **Trace** how an MCP tool call flows from `createServer` → safe-io write → verify → FTS5 search/refresh when you are debugging a tool response.
- **Add** a new MCP tool: copy the registration shape from `server.ts` and the safe-io/verify guardrails used by `livewiki_write_doc`.
- **Extend** the FTS5 two-table design (split identifiers, original snippets, dedup by `wiki_path`) using the helpers in `search.ts`.

## How it fits

`@livewiki/mcp` is one of the consumer packages in this monorepo. `index.ts` is the stdio entry: it parses `--repo`, calls `createServer`, and wires the resulting `McpServer` to a `StdioServerTransport`; SIGINT/SIGTERM trigger a graceful shutdown that closes the server (which in turn closes the FTS5 index). `server.ts` is where the MCP tools, the workflow-adjacency hints table, and the recursive `fs.watch`-driven index freshener live; write paths go through `@livewiki/core/safe-io` and `@livewiki/core/verify`, and the search side reads through `search.ts`. `search.ts` keeps an isolated `.livewiki/search.db` (separate from the v4 `index.db`) holding two FTS5 virtual tables — `wiki_search` (original text, snippet source) and `wiki_search_tokens` (split identifiers, match-only). The two `*.test.ts` files exercise the search and server paths via `better-sqlite3` and the SDK's `InMemoryTransport`; `phase5-e2e.test.ts` is the end-to-end hook → MCP → verify chain. Repository context: this module is consumed by the CLI (`packages/cli`), which shells out to it, and by agents that link it directly as an MCP server.

## CLI argument parsing and stdio bootstrap

<!-- lw:anchors packages/mcp/src/index.ts#main packages/mcp/src/index.ts#parseArgs -->

The entry point `main` parses argv, calls `createServer({ repoRoot })`, and connects over `StdioServerTransport`; SIGINT/SIGTERM call `server.close()` before exiting 0, and unhandled errors log to stderr and exit 1.

```ts
function parseArgs(argv: readonly string[]): { repoRoot: string } {
```

`parseArgs` only honours the `--repo <path>` flag; the path is resolved with `nodePath.resolve` against the current process cwd. The fallback `repoRoot` when `--repo` is absent is `process.cwd()`. The visible loop stops at the first occurrence and consumes the next token unconditionally — `argv[i + 1] !== undefined` is the only check guarding that the value exists.

```ts
async function main(): Promise<void> {
```

`main` calls `server.close()` inside a `try/catch` that swallows errors (best-effort) before `process.exit(0)`. The outer `main().catch(...)` writes the error message to stderr and exits with code 1.

## FTS5 search index — tokenization, indexing, querying

<!-- lw:anchors packages/mcp/src/search.ts#splitIdentifiers packages/mcp/src/search.ts#openAndIndex packages/mcp/src/search.ts#reindexAll packages/mcp/src/search.ts#collectMarkdownFiles packages/mcp/src/search.ts#walk packages/mcp/src/search.ts#reindexAllPages packages/mcp/src/search.ts#indexPage packages/mcp/src/search.ts#removePage packages/mcp/src/search.ts#queryTerms packages/mcp/src/search.ts#snippetAround packages/mcp/src/search.ts#search packages/mcp/src/search.ts#close -->

```ts
export function splitIdentifiers(text: string): string {
```

`splitIdentifiers` matches identifier runs `IDENTIFIER_RE = /[A-Za-z][A-Za-z0-9_]*/g` and, for tokens that contain `_` or a camel/Pascal/acronym boundary, appends the parts alongside the original token (`resolveDebt` → `resolveDebt resolve Debt`, `HTTPServerError` → `HTTPServerError HTTP Server Error`, `resolve_debt` → `resolve_debt resolve debt`). Single-part tokens are returned unchanged, which is how plain words and prose pass through untouched; kebab-case is left alone because FTS5 already splits on `-`. The visible regexes split at lower→upper boundaries and at acronym runs (`[A-Z]+[A-Z][a-z]`). It is a pure function.

```ts
export async function openAndIndex(
```

`openAndIndex` resolves `.livewiki/search.db` via `safeIo.resolveAndValidate` (the caller in `server.ts` is responsible for safe-io, not this function — see the function's docstring), creates `.livewiki/` if missing, opens the DB with WAL, creates both FTS5 virtual tables (`wiki_search`, `wiki_search_tokens`) `IF NOT EXISTS`, then calls `reindexAll`.

```ts
async function reindexAll(db: Database.Database, absRoot: string): Promise<void> {
```

`reindexAll` deletes both tables, collects markdown pages under `livewiki/`, reads each file (skipping on read errors), and inserts each into both tables inside a single transaction — original text into `wiki_search`, the `splitIdentifiers`-transformed text into `wiki_search_tokens`.

```ts
async function collectMarkdownFiles(dir: string): Promise<string[]> {
```

`collectMarkdownFiles` walks the tree via the inner `walk` helper, returning only `*.md` files. A missing directory is silently treated as an empty wiki (the visible `readdir` `try/catch` returns early).

```ts
async function walk(d: string): Promise<void> {
```

`walk` recurses into subdirectories and collects only files ending in `.md`. Errors reading the directory are swallowed — this is how a not-yet-initialized wiki degrades to zero pages rather than throwing.

```ts
export async function reindexAllPages(idx: SearchIndex, repoRoot: string): Promise<void> {
```

`reindexAllPages` is the public entry for a full rebuild from the wiki on disk; it just calls `reindexAll` with `path.resolve(repoRoot)`. The server watcher uses it after each debounced sync batch instead of tracking per-page diffs.

```ts
export function indexPage(idx: SearchIndex, wikiPath: string, content: string): void {
```

`indexPage` performs a DELETE on both tables for `wikiPath` followed by INSERT into both, all in a single transaction. FTS5 has no native UPSERT, so this is the per-page write path used by `livewiki_write_doc`. The original token goes into `wiki_search`; the split form goes into `wiki_search_tokens`.

```ts
export function removePage(idx: SearchIndex, wikiPath: string): void {
```

`removePage` deletes from both tables by `wiki_path`. It is idempotent: deleting a non-existent row is a no-op.

```ts
function queryTerms(query: string): string[] {
```

`queryTerms` extracts identifier runs from the query, runs each through `splitIdentifiers`, lower-cases the resulting pieces, and returns them. This is how the snippet fallback (`snippetAround`) finds the first match for highlighting on tokens-table-only hits.

```ts
function snippetAround(content: string, terms: string[]): string {
```

`snippetAround` is the fallback snippet generator for hits that only matched the split tokens table — where the raw FTS5 `snippet()` cannot highlight compound identifiers. It finds the earliest case-insensitive occurrence of any term, returns a window of ~160 characters around it (`<<`/`>>` markers are NOT inserted here; those markers come from the FTS5 snippet path). When no term matches, it returns the first 160 characters of the content.

```ts
export function search(
```

`search` queries both tables — raw query on `wiki_search`, `splitIdentifiers`-transformed query on `wiki_search_tokens` — and merges: original-table hits first, then unique extras from the tokens table deduped by `wiki_path`. The limit is preserved across the merge. The visible snippet source for original-table hits is the FTS5 `snippet()` function on `wiki_search`; for tokens-table-only hits, `snippetAround` is used. Both tables use the FTS5 default tokenizer (unicode61, no stemming) — the visible design note flags that without a `tokenize=` option, tokens are matched whole. An FTS5 syntax error in either query returns `[]` rather than throwing.

```ts
export function close(idx: SearchIndex): void {
```

`close` closes the underlying `better-sqlite3` database handle. The test setup closes the index before `nodeFs.rm` in `afterEach` because WAL files (`search.db-shm`, `search.db-wal`) would otherwise hit EBUSY on Windows.

## MCP server lifecycle, tools, and the recursive watcher

<!-- lw:anchors packages/mcp/src/server.ts#createServer packages/mcp/src/server.ts#isWatchDenied packages/mcp/src/server.ts#startWatcher packages/mcp/src/server.ts#schedule packages/mcp/src/server.ts#syncBatch packages/mcp/src/server.ts#stop -->

```ts
export async function createServer(opts: CreateServerOptions = {}): Promise<McpServer> {
```

`createServer` registers seven tools (`livewiki_quickstart`, `livewiki_read`, `livewiki_search`, `livewiki_debt`, `livewiki_write_doc`, `livewiki_resolve_debt`, `livewiki_impact`), each augmented with workflow-adjacency `_hints` on success (errors carry no hints). `livewiki_write_doc` validates the path against the safe-io allowlist (`livewiki/`, `.livewiki/`) and runs `verify` on the new content before accepting; paths outside the allowlist return `McpError` with `InvalidParams`. The `verify` option is a test seam — production uses `core/verify`. The returned server owns a watcher handle; `server.close()` (called by the stdio entry on SIGINT/SIGTERM) is responsible for stopping the watcher before the index is closed.

```ts
function isWatchDenied(filename: string): boolean {
```

`isWatchDenied` is the watcher denylist gate: any path segment matching `.git`, `.livewiki`, `node_modules`, or `dist` is dropped (splits handle both `/` and `\` separators, so Windows backslash paths are covered). Otherwise, the file extension is checked against a denylist of binary/media/font types (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.ico`, `.svg`, `.pdf`, `.zip`, `.gz`, `.tar`, `.mp3`, `.mp4`, `.mov`, `.avi`, `.woff`, `.woff2`, `.ttf`, `.eot`). Both checks are containment-only — the visible implementation never accepts a path based on a positive test; it only rejects.

```ts
function startWatcher(repoRoot: string, searchIdx: SearchIndex): WatcherHandle {
```

`startWatcher` installs a recursive `fs.watch` on the repo root with a 1.5 s debounce. Each event is filtered through `isWatchDenied`. Watch-creation failures and runtime watcher errors are caught and logged as a single `console.error` line — the server continues with startup-rebuild semantics rather than crashing. The returned `WatcherHandle.stop()` releases the OS handle and awaits any in-flight sync, which is what makes the subsequent `search.db` close + temp-dir removal EBUSY-safe on Windows.

```ts
function schedule(): void {
```

`schedule` is the debouncer. After 1.5 s of quiet it triggers one `syncBatch`. If a sync is already in-flight when the timer fires, `schedule` re-arms itself (serializing overlapping indexer/ledger runs is pointless on the same DB). A `stopped` flag short-circuits re-arming after `stop()`.

```ts
async function syncBatch(): Promise<void> {
```

`syncBatch` is the debounced payload: incremental `runIndexer` (hash-incremental — unchanged files skip by design), then `runLedger`, then a full `reindexAllPages` on the search index. A failed sync logs the message to stderr and lets the next batch retry — the server is never killed by a bad sync.

```ts
async function stop(): Promise<void> {
```

`stop` clears the pending debounce timer, closes the watcher, and awaits the in-flight sync. It is the EBUSY-safe teardown path.

## Search test fixtures and helpers

<!-- lw:anchors packages/mcp/src/search.test.ts#writePage packages/mcp/src/search.test.ts#indexFixture -->

```ts
async function writePage(relPath: string, content: string): Promise<void> {
```

`writePage` is the test-side helper that creates parent directories and writes a page under the temp `repoRoot`. It is used by the acceptance fixtures in `search.test.ts` to build `livewiki/*.md` pages before `openAndIndex` runs.

```ts
async function indexFixture(): Promise<SearchIndex> {
```

`indexFixture` writes three seed pages (`livewiki/debts.md`, `livewiki/anchors.md`, `livewiki/flow.md`), calls `openAndIndex(repoRoot)`, and returns the `SearchIndex`. The acceptance tests rely on its specific contents — `debts.md` carries `resolveDebt`, `anchors.md` carries `ValidationError`, `flow.md` carries `queue`.

## MCP server test helpers

<!-- lw:anchors packages/mcp/src/server.test.ts#connect packages/mcp/src/server.test.ts#teardown packages/mcp/src/server.test.ts#git packages/mcp/src/server.test.ts#extractText packages/mcp/src/server.test.ts#extractHints packages/mcp/src/server.test.ts#hintTools packages/mcp/src/server.test.ts#assertWellFormedHints packages/mcp/src/server.test.ts#pollSnapshot packages/mcp/src/server.test.ts#pollUntil -->

```ts
async function connect(opts: Omit<CreateServerOptions, "repoRoot"> = {}): Promise<Connected> {
```

`connect` is the in-process MCP test wiring: it creates the server with the temp `repoRoot`, builds a `Client`, links `InMemoryTransport` for both sides, and `Promise.all`s the two connects. The `repoRoot` is fixed by the surrounding `beforeEach` — `opts` only overrides the rest of `CreateServerOptions`.

```ts
async function teardown(c: Connected): Promise<void> {
```

`teardown` closes both the client and the server. The docstring is explicit: this must run before `afterEach`'s `nodeFs.rm` so the FTS5 WAL handles are released (Windows EBUSY).

```ts
function git(args: string[]): void {
```

`git` is a thin `spawnSync` helper. It runs in `repoRoot`, asserts exit status 0, and sets `GIT_CONFIG_NOSYSTEM=1`. Used by the `livewiki_impact` repo-wide package test to build a real git baseline.

```ts
function extractText(r: unknown): string {
```

`extractText` extracts the textual payload from an MCP tool response. Used to assert against the content of `livewiki_quickstart`, `livewiki_read`, etc.

```ts
function extractHints(r: unknown): HintEntry[] {
```

`extractHints` extracts the workflow-adjacency `_hints` array from an MCP tool response. JSON responses carry it as a top-level field; plain-text responses carry it as a trailing `{"_hints": [...]}` block — this helper normalizes both.

```ts
function hintTools(r: unknown): string[] {
```

`hintTools` returns the list of tool names referenced by the hints in a response. Used to assert that, e.g., a `livewiki_search` success hints at `livewiki_read` and `livewiki_debt`.

```ts
function assertWellFormedHints(r: unknown): void {
```

`assertWellFormedHints` validates the structure of the `_hints` payload — each hint must have a string `tool` and a string `when`.

```ts
async function pollSnapshot(
```

`pollSnapshot` is the polling helper used by tests that wait for the watcher to converge: it captures a snapshot of the search/db state at successive ticks.

```ts
async function pollUntil(cond: () => Promise<boolean>, timeoutMs = 8000): Promise<void> {
```

`pollUntil` polls a condition function until it returns `true` or the timeout expires (default 8 s). Used to wait for watcher-driven reindex to settle in the freshness tests.

## Phase 5 end-to-end helpers

<!-- lw:anchors packages/mcp/src/phase5-e2e.test.ts#runCli packages/mcp/src/phase5-e2e.test.ts#connectMcp packages/mcp/src/phase5-e2e.test.ts#teardown packages/mcp/src/phase5-e2e.test.ts#runVerify -->

```ts
function runCli(args: readonly string[], cwd: string): Promise<SubprocessResult> {
```

`runCli` spawns the compiled `packages/cli/dist/index.js` as a subprocess with `stdio: ["ignore", "pipe", "pipe"]` and collects stdout, stderr, and exit code. The fixture throws early if `cliBin` does not exist (the test assumes `pnpm -r build` ran). The subprocess path exercises the real binary — what the hook and the agent will call in production — for `init`, `index`, `status`, and `verify`.

```ts
async function connectMcp(repoRoot: string): Promise<Connected> {
```

`connectMcp` is the in-process MCP wiring for the Phase 5 acceptance scenario: same `createServer` + `InMemoryTransport` pattern as `server.test.ts`, but named for the agent client (`"phase5-e2e-agent"`). Used to pay the open debt via `livewiki_write_doc` after the hook has detected the change.

```ts
async function teardown(c: Connected): Promise<void> {
```

`teardown` closes both sides of the MCP connection. Same Windows-EBUSY rationale as the server test: must run before the temp repo is removed.

```ts
async function runVerify(repoRoot: string): Promise<VerifyOutput> {
```

`runVerify` shells out to `livewiki verify --json` via `runCli` and parses the JSON. A direct `JSON.parse` failure falls back to extracting the first `{...}` block. The returned object carries `ok`, `exitCode`, `issues`, and the raw stdout — the test asserts on the issues array, not just the exit code (SPEC §Fase 5 acceptance criterion).

<!-- livewiki:navigate:start -->
## Navigate

- [Core Repair, Status, Sectioning, Symbols, and Risk Pipeline](core-src-11.md) — dependency
- [Core runtime config, schema, diagrams, diff preview, and export](core-src-05.md) — dependency
- [Livewiki core src 07](core-src-07.md) — dependency

> Coverage note: this module's source (6 files, ~99k chars) exceeded the prompt budget and was excerpted; this page documents the closed-list symbols.
<!-- livewiki:navigate:end -->
