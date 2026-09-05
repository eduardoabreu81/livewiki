---
title: MCP server construction and watcher lifecycle
owner: generated
anchors:
  - packages/mcp/src/server.ts#createServer
  - packages/mcp/src/server.ts#isWatchDenied
  - packages/mcp/src/server.ts#startWatcher
---

# MCP server construction and watcher lifecycle

This page documents how the livewiki MCP server wires its Model Context Protocol tools, search index, and working-tree watcher into one process lifecycle.

## When to use this page

- **Wire the livewiki tools into a new client or transport** — understand what `createServer` registers and what its caller must still provide.
- **Debug index freshness** — trace how filesystem events become index rebuilds and why some paths never trigger them.
- **Inspect or extend the watcher's shutdown ordering** — see why the watcher stops before the search index closes.
- **Understand the tool registration surface** — review the responsibilities the server exposes without opening the transport.

## How it fits

This module is the MCP server construction layer for the livewiki project. It assembles the `McpServer` instance, registers the documented tools, and attaches the working-tree watcher that keeps the search index and anchor ledger current. It consumes the core packages through their stable interfaces, and delegates tool behavior to those packages rather than reimplementing wiki writes, verification, search, or debt resolution locally. A caller that wants an actual connection must still instantiate a transport after `createServer` returns.

## Diagram

```mermaid
%% livewiki/diagrams/mcp-src-server.mmd
```

## Watcher filtering

<!-- lw:anchors packages/mcp/src/server.ts#isWatchDenied -->

The watcher sees events for every file in a repository, but only a small subset can affect documentation state. Filtering noisy paths before they enter the debounce keeps each filesystem burst from triggering pointless sync work. The same directory and extension sets are used for every event, so calls from different parts of the filesystem are judged consistently.

```ts
function isWatchDenied(filename: string): boolean {
```

`isWatchDenied` takes a filename reported by the filesystem watcher and returns `true` when that event should be ignored. It performs two checks. First, the function splits the filename on both `/` and `\`, so it accepts forward-slash paths from POSIX systems and backslash paths from Windows without special casing either. If any segment of that split equals one of the denied directory names — `.git`, `.livewiki`, `node_modules`, or `dist` — the function returns `true`. The `.livewiki` segment is important because it contains the project's derived cache; watcher-triggered indexer or ledger writes must never retrigger another sync. After the segment check, the function uses `nodePath.extname` to extract the extension from the original filename string, lowercases it, and tests membership in the denied-extension set, which covers common binary, media, archive, font, and image formats. A filename whose extension is in that set is also ignored. The source shows the lower bound of the input is an absolute or relative string the watcher supplies; there is no transformation to normalize the path before the segment split beyond accepting either separator style.

## Watcher startup and shutdown

<!-- lw:anchors packages/mcp/src/server.ts#startWatcher -->

Freshness without a restart requires a path from operating-system events to index rebuilds. `startWatcher` owns that wiring: it opens the OS watcher, translates change events into queue notifications, and returns a handle whose `stop` method releases the OS resources and drains pending sync work.

```ts
export function startWatcher(
  repoRoot: string,
  searchIdx: SearchIndex,
  opts: { sync?: () => Promise<void>; queue?: Partial<SyncQueueOptions> } = {},
): WatcherHandle {
```

`startWatcher` takes the repository root to watch, the search index that must be rebuilt after changes, and an optional configuration object that lets tests substitute the sync function or adjust queue timing options; it returns a `WatcherHandle` with a `stop` method. The default sync, used when no override is provided, runs `runIndexer` with quiet output, then `runLedger` with quiet output, and finally `reindexAllPages` against the supplied search index. That order means the on-disk index database and anchor ledger are updated before the in-memory search index is rebuilt from the fresh state.

The function creates the sync queue through `createSyncQueue` and passes the assembled sync as its `run` callback. That queue owns debounce and retry state, so this file only needs `queue.notify()` when an OS event is relevant. Before opening the watcher, the function attempts to canonicalize the repository root with `realpathSync.native(repoRoot)`. This resolves Windows 8.3 short-name aliases and normalizes casing so the path used to create the watcher matches the paths the operating system reports for events. If the canonicalization attempt throws, the outer `catch` keeps the original lexical `repoRoot`; this is an explicit fallback path, not a failure of startup.

The watched root is opened with `watch(watchRoot, { recursive: true })`. On each event, the callback checks whether the reported filename is non-null and whether `isWatchDenied` rejects it; a null filename is treated as a request to sync anyway. Passing events call `queue.notify()` to arm the debounce and eventual sync. Two failure paths exist. A watch-creation failure — such as a platform or filesystem that does not support recursive watchers — is caught, sets `watcher` to `null`, and logs one message before returning a handle whose `stop` has no watcher to release. Runtime errors arrive through the watcher's `error` event, where the handler logs one message and calls `stop()`. In both cases the server continues with startup-rebuild semantics and no watcher-backed sync loop.

The returned `stop` method must honor ordering constraints. It calls `queue.stop()` first and keeps the returned promise; the queue stops any pending debounce or retry so no new sync can start during teardown. If a watcher exists, the method awaits the OS-level close event before continuing, because `watcher.close()` only requests closure and Windows can still deliver events to a dying handle. Only after the OS handle has closed does the method await the queue's stopped promise, ensuring any in-flight sync is awaited only once the handle is released. This ordering prevents a later `search.db` close or temporary-directory removal from racing an active index handle, which matters on Windows.

## Server assembly

<!-- lw:anchors packages/mcp/src/server.ts#createServer -->

Everything else in the module hangs off the server instance this function builds. `createServer` opens the search index, configures the protocol server's identity and capabilities, registers every documented tool, attaches the watcher, and augments the close path so all owned resources are released in a safe order.

```ts
export async function createServer(opts: CreateServerOptions = {}): Promise<McpServer> {
```

`createServer` takes optional settings for the repository root and a verifier override and returns a promise that resolves to a configured `McpServer`. If `opts.repoRoot` is omitted, the process working directory is used; either way the path is passed through `nodePath.resolve` so later comparisons use an absolute form. The verifier defaults to the real `runVerify` from core, while `opts.verify` exists only as a test seam.

The function opens the search index before constructing the server, then creates an `McpServer` named `livewiki` with a version read from the package and a capability declaration limited to tools. Three small helper closures shape every tool response: `textResult` wraps text in the MCP content shape, `hintedTextResult` appends a workflow-adjacency hint block to plain-text successes, and `errorResult` produces an explicit error content shape. The hint table is static data keyed by tool name, so the suggestion block is additive and never alters the first text chunk.

Tool registration is a sequence of `server.tool` calls, one per exposed capability, each with a schema built from `zod` and a handler that delegates to a core package. Reads go through `readWikiDocument` with the repository root and the caller's path; searches call `doSearch` on the open index; debt status delegates to `runStatus`; impact delegates to `computeBlastRadius` for a specific symbol or `computeChangeImpact` when the caller passes an empty symbol key. Agent-bootstrap tasks, lease renewal, and submission delegate to the core agent-bootstrap module, with a full search rebuild after a completed or failed-completed bootstrap run and after a successful queue write. Writes take the longer path: document writes delegate to `writeWikiDocument`, which owns path canonicalization, allowlist enforcement, verification, and rollback; a successful write then updates the search index incrementally and records an activity-ledger metric. The write handler has visible rejection branches, including throws for a bootstrap task combined with `skipVerify`, a task without `claimId`, or a path reported as outside the `livewiki/` allowlist.

After the tools are registered, the function starts the watcher over the same repository root and search index. It then replaces `server.close` with an augmented version that stops the watcher first, awaits any in-flight sync, closes the search index, and finally calls the original close. This ordering is the same Windows-handle discipline used inside `watcherHandle.stop`: the index and ledger can hold file handles, so they must be done before the search index closes and the caller can remove temporary directories. The function returns the configured server without connecting any transport; the caller remains responsible for that step.

## Tests

Covered by `packages/mcp/src/server.test.ts` (same-name test file on disk).
