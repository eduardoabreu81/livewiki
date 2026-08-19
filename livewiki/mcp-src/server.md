---
title: LiveWiki MCP Server Implementation
owner: generated
anchors:
  - packages/mcp/src/server.ts#createServer
  - packages/mcp/src/server.ts#isWatchDenied
  - packages/mcp/src/server.ts#startWatcher
  - packages/mcp/src/watch-queue.ts#createSyncQueue
  - packages/mcp/src/watch-queue.ts#isWriteContention
---

# LiveWiki MCP Server Implementation

This page documents the Model Context Protocol (MCP) server that exposes livewiki's tools over stdio, including the tool registry, verification flow, and the watcher that keeps search fresh.

## When to use this page

- Understand how the server wires its 9 tools and manages error reporting.
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

<!-- lw:anchors packages/mcp/src/server.ts#isWatchDenied packages/mcp/src/watch-queue.ts#createSyncQueue packages/mcp/src/watch-queue.ts#isWriteContention -->

The watcher exists so the MCP server's search results stay current without a restart. It watches the entire repo root recursively, but not every file event should trigger a re-index — `.git`, `.livewiki`, `node_modules`, and `dist` directory segments are all derived or bulky and must never retrigger the sync loop; binary/media/font extensions never carry symbols or prose. The filter is one-sided: it denies paths containing those segments or having those extensions, and lets everything else flow into the queue.

`isWatchDenied(filename: string): boolean` takes a filename as it appears in a watch event and returns `true` when the event should be skipped. It splits the filename on both backslashes and forward slashes (since Windows emits one form and POSIX the other) and checks each segment against a denylist; it then checks the lowercased extension against a second set. The check is a simple deny — a path is denied if it matches any denied segment or any denied extension, otherwise it is allowed.

Everything after the filter lives in `packages/mcp/src/watch-queue.ts`, split out so the part that can lose work is testable without a filesystem and without real timers. `createSyncQueue({ run, … }): SyncQueue` returns the pending-work state machine: `notify()` for "an event arrived", `stop()` for shutdown, and `snapshot()` exposing `pending` / `running` / `attempt` / `armedMs` for assertions.

**What "the batch" is.** The sync is a whole-repo incremental pass — `runIndexer` walks the repo and skips unchanged files by hash — so pending work is not a list of paths to replay. It is one bit meaning "the index may be behind the working tree". That makes merging free and total: a run occurring after events A and B covers both. What must never happen is that bit being cleared by anything other than a run that actually **succeeded**.

That is exactly what the old code did. It logged one line on failure and dropped the batch, with a comment saying the next event would retry. For every batch but one that was true; for the **last** event of a sequence there is no next event, so a failed sync left the index behind the working tree silently until someone happened to touch another file (P1, 2026-08-19).

**Invariants.** At most one `run()` in flight — never a second queue. At most one timer armed: the debounce and the retry are the same timer, never two racing. `pending` is cleared only when a run starts and restored if that run fails, and events arriving mid-run set it again so they are merged into the next run instead of being swallowed by the one already going. After `stop()` no timer stays armed and no run is ever started.

**Retry policy.** A failed run always keeps its work pending; what differs is the scheduling.

- **Write contention** (`isWriteContention`, matching `WriteContentionError`'s `INDEX_WRITE_CONTENTION` code rather than `instanceof`, so it survives crossing a module boundary) retries with **no attempt limit**. Contention is transient by definition — it means another writer holds the lock, so someone *is* making progress — and giving up would leave the index behind with nothing scheduled to fix it, which is the bug being removed. The capped backoff is what keeps it from being a hot loop.
- **Anything else** is a real error about the repo or the index, and repeating it forever is a hot loop. It retries `WATCH_PERMANENT_ATTEMPTS` (5) times, reporting the error every time, then stops scheduling itself with an explicit give-up line. The work still stays pending: the next filesystem event, or the next server start, picks it up. It is never silently dropped.

Backoff is `WATCH_RETRY_BASE_MS * 2^(failures-1)` capped at `WATCH_RETRY_MAX_MS` — 1s, 2s, 4s, 8s, 16s, then 30s. No jitter: there is one queue per server, so there is no herd to spread out, and a predictable delay is what makes the policy assertable in a test.

While backing off, an incoming event does **not** shorten the wait. The armed retry already covers it (the sync is whole-repo), and letting events reset the timer would turn a steady stream of edits into precisely the hot loop the backoff exists to prevent.

## Watcher lifecycle and control

<!-- lw:anchors packages/mcp/src/server.ts#startWatcher -->

The watcher's purpose is to keep the index, ledger, and search in sync with the working tree for the server's entire lifetime. It must start without requiring a particular platform's recursive-watch support, and it must stop cleanly because a lingering sync could hold database handles past `close()` — the EBUSY lesson on Windows.

`startWatcher(repoRoot, searchIdx, opts?): WatcherHandle` takes a repository root string and a `SearchIndex` and returns a handle with a `stop()` method. It is now only the `fs.watch` plumbing: it builds the sync (`runIndexer` → `runLedger` → `reindexAllPages`, all `{ quiet: true }`), hands it to `createSyncQueue`, and turns OS events into `queue.notify()`. On each event it filters via `isWatchDenied` (a `null` filename means "sync anyway"). Watch creation goes through `realpathSync.native` first because on Windows the temp root may arrive in 8.3 form while events use long names; any failure keeps the lexical path and the inability to watch degrades to no watcher with a single log line. The optional third argument is a test seam — it substitutes the sync and the queue's timers so tests drive time by hand instead of waiting on real ones.

Its `stop()` is the clean shutdown path, and the order is load-bearing. It stops the **queue first**, which disarms any pending debounce *or retry* so no sync can start while the watch handle is being torn down. Then it awaits the OS-level watcher close via the `"close"` event (not just `close()`), which prevents late events being delivered to a dying handle. Only then does it await the queue's promise, so whatever sync was already running settles after the OS handle is released rather than while it is still held. A pending retry can therefore never fire after shutdown, and its timer is `unref`'d besides, so it can never be the reason a process stays alive.

## Server construction and tool registry

<!-- lw:anchors packages/mcp/src/server.ts#createServer -->

`createServer(opts: CreateServerOptions = {}): Promise<McpServer>` takes an options object with an optional `repoRoot` (defaulting to `process.cwd()`) and an optional `verify` seam for tests, and returns a configured `McpServer` instance. It resolves the repo root, picks the verify implementation, opens and indexes the search index, then constructs the MCP server. It registers all 9 tools in order.

The tools break into read-only and write paths. Read-only tools — `livewiki_quickstart`, `livewiki_read`, `livewiki_search`, `livewiki_debt`, `livewiki_impact`, `livewiki_next_task`, `livewiki_renew_task_claim` — run inside try/catch blocks that convert errors into MCP error results without leaking absolute paths or repo contents. Each successful response also carries a `_hints` block (either as a JSON field or appended text block) so arbitrary MCP clients discover the livewiki loop on their own.

The write tool `livewiki_write_doc` is the critical one. When no `taskId` is given, it performs a four-step flow: `safeIo.writeText` enforces the allowlist (paths must stay inside `livewiki/`), then `verify` runs on the repo and filters error-level issues touching this page, then it updates the FTS index incrementally via `indexPage`, and finally it records a `write_received` metric. If verify finds issues, `rollbackWrittenPage` unlinks the just-written file and the tool reports rejection with the first error's code and detail. If verify itself crashes, rollback still runs; if rollback fails, the tool reports that the disk may hold an unverified page.

When a `taskId` is present from `livewiki_next_task`, the flow changes: `skipVerify` is forbidden, `claimId` becomes mandatory (a `taskId` without it is rejected as `InvalidParams`), the content goes through `submitAgentBootstrapTask` which validates the claim before anything else and then checks the task's full page contract, and on success the server reindexes all pages so companion deterministic-hub changes are visible in search. A submission whose claim was replaced or whose lease lapsed comes back as `stale_claim` with nothing written.

The `livewiki_resolve_debt` path also inspects the ledger outcome: when the reconciliation aborts because the wiki snapshot was unstable, it returns an error carrying `ledgerApplied: false` instead of reporting the debt as resolved — the baseline was accepted on disk, but the debt tables were not reconciled. The `livewiki_impact` tool opens the index through `openIndexReadOnly`: a blast-radius query never creates, migrates or relabels the index, and an index that is missing or on a different schema fails with an actionable message instead of a raw SQLite error.

A `livewiki_next_task` call can also come back with `status: "busy"` — every unfinished task is leased to another executor. The server treats that as "still running": it does not rebuild the search index, which it reserves for a genuinely finished run.

`livewiki_renew_task_claim` is the explicit lease extension for a task that outlives its claim. It takes the `taskId` and `claimId` handed out by `livewiki_next_task` and returns the new `leaseExpiresAt`, or a `stale_claim` error when the lease already expired or another execution re-claimed the task. There is no heartbeat and no background timer — an executor that needs more time asks for it.

The function also installs a custom `close` on the server. The override stops the watcher first (awaiting any in-flight sync), closes the search index, then delegates to the original `close`. This ordering prevents the same EBUSY failures that plagued Windows CI when tests removed temp directories immediately after a close.

## Tests

Covered by `packages/mcp/src/server.test.ts` (same-name test file on disk).
