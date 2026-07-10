---
title: "@livewiki/mcp — the MCP server exposing the wiki to agents"
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

# @livewiki/mcp

`@livewiki/mcp` is the Phase 4 deliverable: an MCP (Model Context
Protocol) server that exposes the wiki maintained by
[`@livewiki/core`](core.md) to any MCP client — Claude Code, Cursor,
Codex, or any other agent harness that speaks MCP. It is the primary way
an agent pays documentation debt day-to-day (the `document-as-you-go`
skill shipped in [`@livewiki/cli`](cli.md) is built entirely around these
tools).

## Server setup and the 6 tools

<!-- lw:anchors packages/mcp/src/server.ts#createServer -->

`createServer(opts)` builds and configures an `McpServer` (from
`@modelcontextprotocol/sdk`) bound to one `repoRoot`, but does **not**
connect a transport itself — that's the caller's job (`index.ts` uses
stdio; tests use `InMemoryTransport`). On creation, it opens the FTS5
search index (`openAndIndex`, see below) and registers six tools:

| Tool | Purpose |
|---|---|
| `livewiki_quickstart` | Returns `livewiki/quickstart.md` — the low-token entry point for an agent navigating the wiki. |
| `livewiki_read` | Reads one wiki page by relative path. |
| `livewiki_search` | Full-text search over all wiki pages (SQLite FTS5). |
| `livewiki_debt` | Open documentation debt + undocumented symbols — equivalent to `livewiki status --json`. |
| `livewiki_write_doc` | Writes/updates a wiki page — allowlist-checked and `verify`-gated. |
| `livewiki_resolve_debt` | Marks debt rows as resolved by ID. |

Every tool's read path calls straight into `@livewiki/core` (`safeIo`,
`runStatus`, `runVerify`, `openIndex`) — there is no parallel
implementation here; this package is a protocol adapter, not a second
copy of the logic. Errors are reported as MCP tool results
(`isError: true` with a text message) rather than thrown where the SDK
allows it, except for the two cases in `write_doc` that use `McpError`
with `ErrorCode.InvalidParams` — a path outside the `livewiki/` allowlist,
or a malformed relative path — because those represent malformed tool
input, not a runtime failure.

## `livewiki_write_doc`: the two-phase write gate

The most safety-critical tool. It writes in two phases:

1. **`safeIo.writeText(repoRoot, path, content)`** — same allowlist gate
   used everywhere else in the codebase (see
   [core.md](core.md#rule-1-safe-io-the-write-allowlist)). A path
   outside `livewiki/` throws `PathOutsideAllowlistError`, translated
   into an `McpError(InvalidParams)` that names the SPEC rule being
   enforced.
2. **`runVerify(repoRoot)`** — unless the caller passed `skipVerify:
   true` (a documented escape hatch, meant only for non-anchor pages like
   `quickstart.md`), the freshly-written page is checked against the
   anti-hallucination `verify` pass (see
   [core.md](core.md#anchors-debt-and-verify)). If `verify` reports any
   `error`-severity issue touching the page just written, the tool
   **rolls back** — deletes the file it just wrote (best-effort) — and
   returns an error result describing the first issue, instead of
   leaving a broken page on disk. If `verify` itself crashes (not a
   validation failure — e.g. a corrupted DB), the write is **not**
   rolled back; the tool reports the crash as a warning in its success
   text instead, since a crashed validator shouldn't block a legitimate
   write.

On a successful write, the FTS5 search index is updated incrementally
(`indexPage`) — no full reindex needed. Note that `write_doc` does
**not** re-run the anchor ledger; `livewiki index` (CLI) is still
responsible for turning newly-anchored symbols into resolved debt and
zeroing out `undocumented` counts. An agent that just wrote pages via
`write_doc` should still run (or have someone run) `livewiki index`
before treating the wiki as fully in sync.

## `livewiki_resolve_debt`

Takes an array of `debt` row IDs (as returned by `livewiki_debt`) and
sets `resolved_at` on each, opening its own connection to
`.livewiki/index.db` via `core`'s `openIndex`. Unmatched IDs (already
resolved, or nonexistent) are reported separately in `notFound` rather
than causing the whole call to fail. An optional `writeRef` is recorded
alongside for audit-trail purposes only.

## FTS5 full-text search

<!-- lw:anchors packages/mcp/src/search.ts#openAndIndex packages/mcp/src/search.ts#reindexAll packages/mcp/src/search.ts#collectMarkdownFiles packages/mcp/src/search.ts#indexPage packages/mcp/src/search.ts#removePage packages/mcp/src/search.ts#search packages/mcp/src/search.ts#walk packages/mcp/src/search.ts#close -->

`search.ts` backs `livewiki_search` with a **separate** SQLite database,
`.livewiki/search.db` — deliberately not a virtual table bolted onto
`.livewiki/index.db`. Three reasons, documented in the source: (1)
`index.db` is already on a carefully-migrated schema v4 — adding FTS5
there would mean a schema v5 migration for a feature only the MCP server
needs; (2) `search.db` is fully reconstructible from the wiki (the
source of truth) — if it gets corrupted, the next `openAndIndex` just
rebuilds it; (3) it keeps `@livewiki/core` free of an FTS5 dependency
that only this package needs.

`openAndIndex(repoRoot)` opens (or creates) `search.db` in WAL mode,
ensures the `wiki_search` FTS5 virtual table exists, and calls
`reindexAll` — a full rebuild on every server startup: it clears the
table and re-walks every `.md` file under `livewiki/`
(`collectMarkdownFiles`/`walk`), inserting each page's raw content. This
is fast even for large wikis (documented as <1s for ~1000 pages) and
fully idempotent. After startup, `indexPage`/`removePage` keep the index
incrementally in sync as `write_doc` writes pages — no rebuild needed
per write (FTS5 has no native upsert, so `indexPage` does a
delete-then-insert inside one transaction). `search(idx, query, opts)`
runs the actual FTS5 `MATCH` query (supports `AND`/`OR`, prefix
`term*`, exact phrases), returning up to `opts.limit` (default 20) hits
with a `snippet()`-generated excerpt around the match; a malformed FTS5
query is caught and returns an empty array rather than throwing.
`close(idx)` closes the underlying database — the caller (`createServer`'s
augmented `server.close`) is responsible for calling this on shutdown, and
on Windows this **must** happen before any recursive directory delete in
tests, or the WAL side-files (`search.db-shm`/`search.db-wal`) cause an
`EBUSY`.

## stdio entry point

<!-- lw:anchors packages/mcp/src/index.ts#parseArgs packages/mcp/src/index.ts#main -->

`index.ts` is the actual executable (`npx @livewiki/mcp --repo <path>`).
`parseArgs` extracts `--repo` from `process.argv` (defaulting to
`process.cwd()`); `main()` builds the server (`createServer`), connects
it to a `StdioServerTransport`, and installs `SIGINT`/`SIGTERM` handlers
that call `server.close()` (closing the FTS5 index cleanly) before
exiting. A typical Claude Code MCP configuration:

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

Exit codes: 0 on clean shutdown, 1 on setup error (e.g. an invalid repo
path causing `createServer` to throw before the transport connects).

## Testing

<!-- lw:anchors packages/mcp/src/server.test.ts#connect packages/mcp/src/server.test.ts#extractText packages/mcp/src/server.test.ts#teardown packages/mcp/src/phase5-e2e.test.ts#connectMcp packages/mcp/src/phase5-e2e.test.ts#runCli packages/mcp/src/phase5-e2e.test.ts#runVerify packages/mcp/src/phase5-e2e.test.ts#teardown -->

Both E2E suites connect a real `McpServer` to a real `Client` via the
SDK's `InMemoryTransport` — no stdio subprocess needed, which keeps the
tests fast and non-flaky while still exercising the real MCP protocol
handshake and JSON-RPC tool-call plumbing.

- **`server.test.ts`** is the Phase 4 acceptance suite (12 scenarios):
  handshake, `tools/list` returning all 6 tools, a successful call to
  each tool, `write_doc` rejecting a path outside `livewiki/`, `write_doc`
  rejecting content with a broken anchor, and reads/search/debt/resolve
  round-tripping correctly. `connect` sets up the client/server pair per
  test, `extractText` pulls the text payload out of an MCP tool result,
  `teardown` closes both ends (Windows WAL-safety, as above).
- **`phase5-e2e.test.ts`** is the Phase 5 acceptance suite (7 scenarios):
  the full loop — new repo → `livewiki init` (CLI subprocess) → edit a
  symbol's body → `livewiki index --quiet` (CLI subprocess, simulating
  the git hook) detects the change as debt → `livewiki status --json`
  confirms `debt.items > 0` → the agent pays debt via MCP `write_doc`
  (in-process, `InMemoryTransport`) → `livewiki verify` (CLI subprocess)
  exits 0 with **zero** issues of any severity → `livewiki/.manifest.json`'s
  `updatedAt` changed. CLI steps deliberately run as real subprocesses
  against the built `dist/index.js` (this is what a git hook or an agent
  actually invokes in production); the MCP step runs in-process because
  that's how a real MCP client talks to this server. `connectMcp`/`runCli`/
  `runVerify` are the two invocation helpers (subprocess vs. in-process);
  `teardown` cleans up both.

## See also

- [core.md](core.md) — the `@livewiki/core` package this server wraps;
  see especially the safe-io allowlist and verify sections referenced
  above.
- [cli.md](cli.md) — the CLI, whose `document-as-you-go` skill and hook
  templates are the other half of the Phase 5 debt-paying flow this
  server supports.
