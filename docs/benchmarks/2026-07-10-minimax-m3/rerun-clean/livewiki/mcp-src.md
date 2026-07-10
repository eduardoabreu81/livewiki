---
title: "@livewiki/mcp"
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
updated: 2026-07-09
---

# `@livewiki/mcp` — stdio MCP server (Fase 4)

The MCP package is the agent-facing surface of livewiki. It exposes the 6
tools defined in SPEC §"MCP tools" over a stdio transport, plus the E2E
test suites that gate Phase 4 and Phase 5.

- `index.ts` — process entry point. Parses `--repo`, creates the server,
  wires it to `StdioServerTransport`, and handles `SIGINT`/`SIGTERM`.
- `server.ts` — the `McpServer` itself. Registers the 6 tools, runs them
  against the repo, and enforces the allowlist + verify invariants on
  `write_doc`.
- `search.ts` — SQLite FTS5 backing store for `livewiki_search`. Lives in
  a separate `.livewiki/search.db` so the FTS5 schema is isolated from
  the ledger `.livewiki/index.db`.
- `server.test.ts` — Fase 4 E2E: handshake, all 6 tools, allowlist
  rejection, broken-anchor rejection, FTS5 schema presence.
- `phase5-e2e.test.ts` — Fase 5 E2E: full hook → MCP write_doc → verify
  loop, plus the reviewer finding (R) that `livewiki init` manages the
  `.gitignore` block for `.livewiki/`.

## CLI entry point — `packages/mcp/src/index.ts`

The process binary. Reads `--repo` (default `cwd`), instantiates the
server, attaches stdio, and registers graceful shutdown.

### `parseArgs` — `packages/mcp/src/index.ts#parseArgs`
<!-- lw:anchors packages/mcp/src/index.ts#parseArgs -->

```ts
function parseArgs(argv: readonly string[]): { repoRoot: string }
```

Walks `argv` looking for `--repo <path>`. Resolves the value with
`path.resolve` so downstream code can trust it as absolute. Anything not
recognized is silently ignored (the function is intentionally minimal —
`--help`, `--version`, etc. are not the MCP server's job).

### `main` — `packages/mcp/src/index.ts#main`
<!-- lw:anchors packages/mcp/src/index.ts#main -->

```ts
async function main(): Promise<void>
```

1. `parseArgs(process.argv.slice(2))` → `{ repoRoot }`.
2. `createServer({ repoRoot })` → `McpServer`.
3. `new StdioServerTransport()` and `server.connect(transport)`.
4. Registers `SIGINT` / `SIGTERM` handlers that call `server.close()`
   (which in turn closes the FTS5 index — see `close` below) and then
   `process.exit(0)`.

A top-level `.catch` writes the error message to stderr and exits with
code `1`. Clean shutdown is exit `0`; setup errors (invalid repo, etc.)
exit `1`.

Typical wiring (Claude Code):

```json
{
  "mcpServers": {
    "livewiki": {
      "command": "npx",
      "args": ["-y", "@livewiki/mcp", "--repo", "/path/to/repo"]
    }
  }
}
```

## MCP server — `packages/mcp/src/server.ts`

The actual `McpServer` instance. Owns the FTS5 index for its lifetime
and registers all 6 tools.

### `createServer` — `packages/mcp/src/server.ts#createServer`
<!-- lw:anchors packages/mcp/src/server.ts#createServer -->

```ts
export async function createServer(
  opts: CreateServerOptions = {},
): Promise<McpServer>
```

`CreateServerOptions.repoRoot` defaults to `process.cwd()` and is
resolved to an absolute path up front.

**Lifecycle**

1. `openAndIndex(repoRoot)` — opens (or creates) `.livewiki/search.db`
   and reindexes the entire wiki into the FTS5 virtual table. Returns
   a `SearchIndex` handle.
2. Constructs the `McpServer` with name `livewiki`, version `0.0.0`,
   and `capabilities.tools = {}`.
3. Registers 6 tools (see below).
4. Monkey-patches `server.close` so it also `closeSearch(searchIdx)`
   — that way `main`'s `SIGINT` handler closes both the MCP session
   and the SQLite DB.

**The 6 tools**

| Tool                   | Behavior                                                                                  |
| ---------------------- | ----------------------------------------------------------------------------------------- |
| `livewiki_quickstart`  | Returns the contents of `livewiki/quickstart.md` (low-token entry point).                 |
| `livewiki_read`        | Reads any path inside the `livewiki/` allowlist via `safeIo.readText`.                    |
| `livewiki_search`      | Runs an FTS5 `MATCH` query with `snippet(...)` highlighting, default limit 20, max 100.   |
| `livewiki_debt`        | Equivalent to `livewiki status --json` — calls `runStatus(repoRoot)`.                     |
| `livewiki_write_doc`   | **Critical.** Allowlist-check + verify-checked write. See below.                          |
| `livewiki_resolve_debt`| `UPDATE debt SET resolved_at = ? WHERE id = ? AND resolved_at IS NULL` (transactional).    |

**`write_doc` invariants (SPEC regra #1)**

1. `safeIo.writeText(repoRoot, path, content)` — the safe-io layer
   enforces the `livewiki/` allowlist and rejects symlink escapes with
   `PathOutsideAllowlistError` / `InvalidRelativePathError`. The server
   translates those into `McpError(ErrorCode.InvalidParams, …)`.
2. **Verify gate** (skippable via `skipVerify: true`): runs
   `runVerify(repoRoot)` and checks for error-level issues touching
   the just-written path. If any are found, the file is `unlink`-ed
   (best-effort rollback) and a structured `errorResult` is returned.
3. If verify crashes (DB corruption, etc.), the write is **not**
   blocked — the warning is surfaced in the result text instead, so a
   transient verify failure can't strand the agent.
4. On success, `indexPage(searchIdx, path, content)` updates the FTS5
   index incrementally (DELETE + INSERT in a transaction).

**Error model**

- Allowlist violations → thrown `McpError(InvalidParams)` (the client
  SDK surfaces this to the agent as a tool error).
- Verify rejections → returned `isError: true` with a human-readable
  `error: …` text.
- All other write failures → returned `isError: true` with the safe
  error message (no path-abs leaking — safe-io guarantees this).

## Search index — `packages/mcp/src/search.ts`

A thin wrapper over `better-sqlite3` + FTS5. The store is intentionally
separate from the ledger (`.livewiki/index.db`):

- The ledger is at schema v4 with careful migrations; adding an FTS5
  virtual table would force schema v5.
- `search.db` is fully rebuildable from `livewiki/` (the source of
  truth), so corruption just means "next startup reindexes."
- Keeps `@livewiki/core` free of the FTS5 dependency — only the MCP
  server needs it.

The `SearchIndex` type is just `{ db: Database.Database }`. The
tokenizer is the FTS5 default (`porter`) — fine for EN/PT without
extra normalization.

### `openAndIndex` — `packages/mcp/src/search.ts#openAndIndex`
<!-- lw:anchors packages/mcp/src/search.ts#openAndIndex -->

```ts
export async function openAndIndex(
  repoRoot: string,
): Promise<SearchIndex>
```

1. `safeIo.resolveAndValidate(absRoot, ".livewiki/search.db")` — the
   file must resolve under the repo root (safe-io check).
2. `safeIo.mkdir(absRoot, ".livewiki")` — ensures the parent dir.
3. Opens the DB, sets `journal_mode = WAL`.
4. `CREATE VIRTUAL TABLE IF NOT EXISTS wiki_search USING fts5(wiki_path UNINDEXED, content)`.
5. Calls `reindexAll(db, absRoot)` to (re)build rows for every page.
6. Returns `{ db }`.

Called by `createServer` on every startup. A 1000-page repo reindexes
in <1s.

### `reindexAll` — `packages/mcp/src/search.ts#reindexAll`
<!-- lw:anchors packages/mcp/src/search.ts#reindexAll -->

```ts
async function reindexAll(
  db: Database.Database,
  absRoot: string,
): Promise<void>
```

- `DELETE FROM wiki_search` (full clear — idempotent against orphans).
- `collectMarkdownFiles(wikiDir)` → list of absolute `.md` paths.
- For each file, reads it (best-effort — unreadable files are skipped
  silently) and builds an `{ path, content }` entry where `path` is
  repo-relative with forward slashes.
- Wraps the `INSERT`s in a single `db.transaction(...)` for throughput.

### `collectMarkdownFiles` — `packages/mcp/src/search.ts#collectMarkdownFiles`
<!-- lw:anchors packages/mcp/src/search.ts#collectMarkdownFiles -->

```ts
async function collectMarkdownFiles(dir: string): Promise<string[]>
```

Public-ish entry, but the actual recursion is delegated to `walk`.

### `walk` — `packages/mcp/src/search.ts#walk`
<!-- lw:anchors packages/mcp/src/search.ts#walk -->

```ts
async function walk(d: string): Promise<void>
```

Recursively descends `d`. For each entry:

- Directory → `await walk(p)`.
- File with `.md` suffix → push absolute path into the accumulator.

If `readdir` throws (e.g. the wiki dir doesn't exist yet), returns
silently — an empty wiki is a valid initial state, not an error.

### `indexPage` — `packages/mcp/src/search.ts#indexPage`
<!-- lw:anchors packages/mcp/src/search.ts#indexPage -->

```ts
export function indexPage(
  idx: SearchIndex,
  wikiPath: string,
  content: string,
): void
```

FTS5 has no native UPSERT, so this runs `DELETE WHERE wiki_path = ?`
followed by `INSERT` inside a single transaction. Called by
`createServer`'s `write_doc` handler on the success path.

### `removePage` — `packages/mcp/src/search.ts#removePage`
<!-- lw:anchors packages/mcp/src/search.ts#removePage -->

```ts
export function removePage(idx: SearchIndex, wikiPath: string): void
```

`DELETE FROM wiki_search WHERE wiki_path = ?`. Idempotent — deleting a
non-existent row is a no-op.

### `search` — `packages/mcp/src/search.ts#search`
<!-- lw:anchors packages/mcp/src/search.ts#search -->

```ts
export function search(
  idx: SearchIndex,
  query: string,
  opts: SearchOptions = {},
): SearchHit[]
```

`SearchHit = { wikiPath: string; snippet: string }`. `SearchOptions.limit`
defaults to 20.

The query is passed verbatim to FTS5 `MATCH` (so it supports `term*`
prefix, `AND`/`OR`, and `"exact phrase"` syntax). Snippets are produced
by `snippet(wiki_search, 1, '<<', '>>', '...', 32)` — 32 tokens of
context, `<<…>>` around the matched term.

FTS5 throws on malformed queries. The wrapper catches and returns `[]`
rather than letting the error bubble up to the MCP tool — a bad query
is a user error, not a server crash.

### `close` — `packages/mcp/src/search.ts#close`
<!-- lw:anchors packages/mcp/src/search.ts#close -->

```ts
export function close(idx: SearchIndex): void
```

`idx.db.close()`. Called by `createServer`'s augmented `server.close`,
which `main`'s `SIGINT`/`SIGTERM` handlers invoke during graceful
shutdown. Closing the DB is what releases the WAL files so Windows
`afterEach` cleanup (`nodeFs.rm`) doesn't hit `EBUSY` — see the file
header in `server.test.ts`.

## Phase 4 server tests — `packages/mcp/src/server.test.ts`

Vitest E2E suite for the MCP server. Uses `InMemoryTransport` (no real
stdio) and tears down the connection inside every `finally` so the
FTS5 DB is closed before the test's tmpdir is removed.

### `connect` — `packages/mcp/src/server.test.ts#connect`
<!-- lw:anchors packages/mcp/src/server.test.ts#connect -->

```ts
async function connect(): Promise<Connected>
```

1. `createServer({ repoRoot })` (