---
title: MCP Server Lifecycle and Tool Orchestration
owner: generated
anchors:
- packages/mcp/src/server.ts#createServer
- packages/mcp/src/server.ts#isWatchDenied
- packages/mcp/src/server.ts#schedule
- packages/mcp/src/server.ts#startWatcher
- packages/mcp/src/server.ts#stop
- packages/mcp/src/server.ts#syncBatch
---

# MCP Server Lifecycle and Tool Orchestration

This file implements the livewiki MCP (Model Context Protocol) server, exposing wiki tools over stdio and keeping the search index fresh via a filesystem watcher.

## When to use this page

- Understand how the eight MCP tools (quickstart, read, search, debt, impact, next_task, write_doc, resolve_debt) are constructed and registered.
- Learn the watcher pipeline that re-indexes the repository when the working tree changes, and how graceful shutdown is handled.
- Inspect the validation and rollback flow that guards `write_doc` against unsafe paths and broken anchors.

## How it fits

This module is the runtime face of livewiki: any MCP client talks to it through stdio, and every tool call eventually reaches `@livewiki/core` packages for indexing, verification, status, and baseline operations. It builds a `McpServer` from the SDK, wires in a local full-text search index (`./search.js`), and owns the server-close sequence so no OS file handles or in-flight syncs leak. The watcher is the only part that bypasses tool calls to keep derived state consistent, mirroring the same indexer → ledger → search rebuild used at startup.

---

## Diagram

```mermaid
%% livewiki/diagrams/mcp-src-server.mmd
```

## Tool Registration and Server Construction

<!-- lw:anchors packages/mcp/src/server.ts#createServer -->

`createServer` is the factory that produces the livewiki MCP server. It begins by resolving the repository root (defaulting to `process.cwd()`) and selecting the verifier to use — the production `verify` from `@livewiki/core`, or a test seam injected through `opts.verify`. It then opens the search index with `openAndIndex` and instantiates the `McpServer` SDK object with the server name `livewiki` and tools capability.

The rest of the function registers eight tools against that server. Each tool closure captures `repoRoot`, `searchIdx`, and `verify`, so the server carries all state it needs. For plain-text responses (quickstart, read, write_doc), it wraps the content with `hintedTextResult`, which appends a trailing JSON block containing `_hints` — suggested next tool calls drawn from the static `TOOL_HINTS` table. JSON responses (search, debt, impact, next_task, resolve_debt) embed the same hints as a top-level `_hints` field. Error responses never carry hints.

The critical `write_doc` tool implements the SPEC's safe-io rule: it first validates the path against the allowlist via `safeIo.writeText`, which rejects paths outside `livewiki/`. If the write succeeds, it runs the verifier (unless `skipVerify` is true), filters for error-level issues touching the written page, and on failure rolls back the file with `rollbackWrittenPage`. A successful write updates the FTS5 index incrementally and records a metric in the activity ledger. An optional `taskId` routes the write through `submitAgentBootstrapTask` instead, which validates against a full page contract and rejects `skipVerify`. The `resolve_debt` tool enforces mutual exclusivity between `symbols` and `all`, calls `acceptBaseline` into the durable baseline, re-runs the ledger, and records a `debt_resolved` metric.

## Filesystem Watcher Setup

<!-- lw:anchors packages/mcp/src/server.ts#startWatcher packages/mcp/src/server.ts#isWatchDenied -->

`startWatcher` sets up recursive `fs.watch` on the repository root so tool responses always reflect the current working tree without a restart. It returns a `WatcherHandle` whose `stop()` method is the only public surface; the watcher itself is internal. The function first attempts to canonicalize the root with `realpathSync.native` to resolve 8.3 short names on Windows CI, falling back to the lexical path if that fails. It then creates the watcher with `recursive: true`.

The watch callback receives an event type and a filename. That filename may be `null` on some platforms — in that case the callback treats it as "sync anyway." Otherwise it calls `isWatchDenied` to decide whether the event should be ignored entirely. `isWatchDenied` splits the filename on both backslash and forward slash to handle Windows and POSIX paths, checking each directory segment against a small denylist (`.git`, `.livewiki`, `node_modules`, `dist`) and the file extension against a set of binary/media/font extensions. Any deny returns `true` and suppresses the event; only non-denied changes reach the scheduler. A watcher error (for example EMFILE on Linux) logs one line and degrades to no-watcher startup semantics rather than crashing.

## Debounced Sync Scheduling

<!-- lw:anchors packages/mcp/src/server.ts#schedule packages/mcp/src/server.ts#syncBatch -->

The scheduler exists to coalesce bursts of filesystem events into a single rebuild batch. `schedule` is invoked by the watcher callback for every accepted event. If the server has been stopped, it returns immediately. It cancels any pending debounce timer and re-arms a new one for `WATCH_DEBOUNCE_MS` (1500ms). When the timer fires, it marks the debounce as cleared, and if a sync is already in flight, it re-schedules rather than starting a second concurrent run — overlapping indexer and ledger writes on the same database are pointless.

`syncBatch` is the actual work: it runs the incremental indexer (`runIndexer`, hash-incremental so unchanged files skip), then the anchor ledger (`runLedger`), then a full search rebuild via `reindexAllPages`. The search rebuild is the same idempotent pass used at startup, preferred over per-page diffing for correctness. Any error in the batch is caught and logged — a failed sync never kills the server; the next event retries naturally.

## Watcher and Sync Shutdown

<!-- lw:anchors packages/mcp/src/server.ts#stop -->

`stop` is the cleanup sequence that must release the OS watcher handle before anything else touches the databases. It first sets a `stopped` flag so `schedule` no longer arms timers, clears any pending debounce, and then closes the watcher. The close is not synchronous: `watcher.close()` only requests closure, and on Windows libuv can still deliver events to a dying handle, which previously caused an assertion in CI. So `stop` awaits the watcher's `close` event before proceeding. Finally, if a sync batch is in flight, it awaits that promise too, ensuring the indexer/ledger no longer holds `index.db` handles and the FTS5 reindex has finished before `closeSearch` and temp-dir cleanup run.

The `createServer` function wraps this into `server.close`, which it overrides to first call `watcherHandle.stop()`, then `closeSearch(searchIdx)`, and only then invoke the SDK's original close. This ordering prevents the Windows EBUSY failure where a test removes the temp directory immediately after the server closes.

## Tests

Covered by `packages/mcp/src/server.test.ts` (same-name test file on disk).
