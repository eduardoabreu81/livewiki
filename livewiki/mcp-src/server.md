---
title: LiveWiki MCP Server Implementation
owner: generated
anchors:
  - packages/mcp/src/server.ts#createServer
  - packages/mcp/src/server.ts#isWatchDenied
  - packages/mcp/src/server.ts#schedule
  - packages/mcp/src/server.ts#startWatcher
  - packages/mcp/src/server.ts#stop
  - packages/mcp/src/server.ts#syncBatch
---

# LiveWiki MCP Server Implementation

This page documents the Model Context Protocol (MCP) server that exposes livewiki's tools over stdio, including the tool registry, verification flow, and the watcher that keeps search fresh.

## When to use this page

- Understand how the server wires its 8 tools and manages error reporting.
- Learn how the allowlist and verify steps gate write operations.
- See how the recursive file watcher keeps the search index current.
- Trace how the server cleans up on shutdown, including Windows-safe handle handling.

## How it fits

The server is the MCP front-end for livewiki, living in `packages/mcp/src/server.ts`. It imports core modules for safe-io, status, verify, the indexer, the anchor ledger, and the search index, then exposes this functionality through MCP tool definitions. The server registers tools that read pages, search with SQLite FTS5, list debt, compute blast radius, drive agent bootstrap tasks, write docs, and resolve debt — every write goes through `core/safe-io` per SPEC rule #1. The server also runs a recursive `fs.watch` on the repo root so tool responses reflect re-indexed state without a restart.

## Diagram

```mermaid
%% livewiki/diagrams/mcp-src-server.mmd
```

## Watcher filter and debounce

<!-- lw:anchors packages/mcp/src/server.ts#isWatchDenied packages/mcp/src/server.ts#schedule packages/mcp/src/server.ts#syncBatch -->

The watcher exists so the MCP server's search results stay current without a restart. It watches the entire repo root recursively, but not every file event should trigger a re-index — `.git`, `.livewiki`, `node_modules`, and `dist` directory segments are all derived or bulky and must never retrigger the sync loop; binary/media/font extensions never carry symbols or prose. The filter is one-sided: it denies paths containing those segments or having those extensions, and lets everything else flow into the debounce.

`isWatchDenied(filename: string): boolean` takes a filename as it appears in a watch event and returns `true` when the event should be skipped. It splits the filename on both backslashes and forward slashes (since Windows emits one form and POSIX the other) and checks each segment against a denylist; it then checks the lowercased extension against a second set. The check is a simple deny — a path is denied if it matches any denied segment or any denied extension, otherwise it is allowed.

`syncBatch(): Promise<void>` runs the actual re-index pipeline: it awaits `runIndexer` with `{ quiet: true }`, then `runLedger` with `{ quiet: true }`, then `reindexAllPages` against the search index. This is the same sub-second, idempotent pass the startup rebuild uses; unchanged files skip by design because the indexer is hash-incremental. The function catches all errors and logs a single line, so a failed sync never kills the server — the next event simply retries.

`schedule(): void` is the debounce controller. It returns immediately if `stopped` is true, clears any pending timeout, and arms a new one for 1500 ms. When the timeout fires, it re-arms the schedule if a sync is already in flight (serializing syncs so overlapping indexer/ledger runs never touch the same DB), otherwise it starts `syncBatch()` and tracks the promise in `inFlight`.

## Watcher lifecycle and control

<!-- lw:anchors packages/mcp/src/server.ts#startWatcher packages/mcp/src/server.ts#stop -->

The watcher's purpose is to keep the index, ledger, and search in sync with the working tree for the server's entire lifetime. It must start without requiring a particular platform's recursive-watch support, and it must stop cleanly because a lingering sync could hold database handles past `close()` — the EBUSY lesson on Windows.

`startWatcher(repoRoot: string, searchIdx: SearchIndex): WatcherHandle` takes a repository root string and a `SearchIndex` and returns a handle with a `stop()` method. It creates the `FSWatcher` and wires event and error listeners. On each event it filters via `isWatchDenied` (a `null` filename means "sync anyway") and calls `schedule()`. Watch creation goes through `realpathSync.native` first because on Windows the temp root may arrive in 8.3 form while events use long names; any failure keeps the lexical path and the inability to watch degrades to no watcher with a single log line.

`stop(): Promise<void>` is the clean shutdown path. It sets `stopped = true`, clears any pending debounce, then awaits the OS-level watcher close via the `"close"` event (not just `close()`), and finally awaits `inFlight` so any running sync settles before the caller proceeds. This order matters: stopping the watcher first prevents new events from arming a debounce, awaiting the OS close prevents late events on a dying handle, and awaiting the in-flight sync prevents DB handle contention.

## Server construction and tool registry

<!-- lw:anchors packages/mcp/src/server.ts#createServer -->

`createServer(opts: CreateServerOptions = {}): Promise<McpServer>` takes an options object with an optional `repoRoot` (defaulting to `process.cwd()`) and an optional `verify` seam for tests, and returns a configured `McpServer` instance. It resolves the repo root, picks the verify implementation, opens and indexes the search index, then constructs the MCP server. It registers all 8 tools in order.

The tools break into read-only and write paths. Read-only tools — `livewiki_quickstart`, `livewiki_read`, `livewiki_search`, `livewiki_debt`, `livewiki_impact`, `livewiki_next_task` — run inside try/catch blocks that convert errors into MCP error results without leaking absolute paths or repo contents. Each successful response also carries a `_hints` block (either as a JSON field or appended text block) so arbitrary MCP clients discover the livewiki loop on their own.

The write tool `livewiki_write_doc` is the critical one. When no `taskId` is given, it performs a four-step flow: `safeIo.writeText` enforces the allowlist (paths must stay inside `livewiki/`), then `verify` runs on the repo and filters error-level issues touching this page, then it updates the FTS index incrementally via `indexPage`, and finally it records a `write_received` metric. If verify finds issues, `rollbackWrittenPage` unlinks the just-written file and the tool reports rejection with the first error's code and detail. If verify itself crashes, rollback still runs; if rollback fails, the tool reports that the disk may hold an unverified page.

When a `taskId` is present from `livewiki_next_task`, the flow changes: `skipVerify` is forbidden, the content goes through `submitAgentBootstrapTask` which validates against that task's full page contract, and on success the server reindexes all pages so companion deterministic-hub changes are visible in search.

The function also installs a custom `close` on the server. The override stops the watcher first (awaiting any in-flight sync), closes the search index, then delegates to the original `close`. This ordering prevents the same EBUSY failures that plagued Windows CI when tests removed temp directories immediately after a close.

## Tests

Covered by `packages/mcp/src/server.test.ts` (same-name test file on disk).
