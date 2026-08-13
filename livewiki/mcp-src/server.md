---
title: "MCP server: livewiki tool surface and live index watcher"
owner: generated
anchors:
  - packages/mcp/src/server.ts#createServer
  - packages/mcp/src/server.ts#isWatchDenied
  - packages/mcp/src/server.ts#schedule
  - packages/mcp/src/server.ts#startWatcher
  - packages/mcp/src/server.ts#stop
  - packages/mcp/src/server.ts#syncBatch
---

# MCP server: livewiki tool surface and live index watcher

This page documents the Model Context Protocol (MCP) server that exposes livewiki's documentation tooling to LLM clients over stdio, plus the in-process watcher that keeps the search index fresh while the server runs.

## When to use this page

- **Boot the MCP server** in an agent runtime by calling `createServer` (in `packages/mcp/src/server.ts`) and connecting it to a `StdioServerTransport`; the caller owns transport wiring.
- **Investigate index freshness behavior** when tool responses seem to lag behind working-tree changes — read `startWatcher`, `schedule`, and `syncBatch` to understand the debounce and incremental re-index pipeline.
- **Audit watcher scope** by reviewing `isWatchDenied` to confirm which directories and file extensions are filtered before they ever reach the debounce.
- **Tear down the server safely** by following the order encoded in `createServer`'s close override, which stops the watcher and awaits an in-flight sync before closing the search index.

## How it fits

The file lives at `packages/mcp/src/server.ts` inside the `@livewiki/mcp` package and is the single seam between livewiki's core subsystems (`@livewiki/core/safe-io`, `core/status`, `core/verify`, `core/db`, `core/blast-radius`, `core/change-impact`, `core/update-metrics`, `core/update`, `core/indexer`, `core/anchor-ledger`) and any MCP-speaking client. It registers seven tools — `livewiki_quickstart`, `livewiki_read`, `livewiki_search`, `livewiki_debt`, `livewiki_impact`, `livewiki_write_doc`, and `livewiki_resolve_debt` — and decorates every successful response with a `_hints` block so clients can discover the rest of the loop on their own.

On boot, `createServer` opens (and rebuilds) the SQLite-backed `SearchIndex`, registers the tools against a freshly constructed `McpServer`, then attaches a recursive `fs.watch` on the repo root via `startWatcher`. The watcher feeds a 1.5 s debounce (`schedule`), which in turn runs the incremental indexer, the anchor ledger, and a full search.db rebuild (`syncBatch`); on platforms where recursive watching fails, the watcher silently degrades to startup-rebuild semantics. When the server's `close()` is invoked, the override tears the watcher down first (`stop`), awaits any in-flight sync, then closes the search index so a subsequent temp-dir cleanup is EBUSY-safe on Windows.

## Diagram

```mermaid
%% livewiki/diagrams/mcp-src-server.mmd
```

## Server bootstrap and tool registration

<!-- lw:anchors packages/mcp/src/server.ts#createServer -->

The server is constructed by `createServer`, which resolves the repo root, opens the search index, instantiates an `McpServer` with `tools` capability, and registers each tool with its Zod-validated input schema.

```ts
export async function createServer(opts: CreateServerOptions = {}): Promise<McpServer>
```

`createServer` returns an `McpServer` ready to attach to any transport — it takes a `CreateServerOptions` record (optional `repoRoot`, optional `verify` test seam) and returns the fully configured MCP server instance.

Inside `createServer`, the wiring is deliberately explicit: a `textResult` helper formats plain-text MCP results; `hintedTextResult` appends a trailing `_hints` JSON block for tools whose success payload is text (`livewiki_quickstart`, `livewiki_read`, `livewiki_write_doc`); `errorResult` packages caught errors with `isError: true`; and `rollbackWrittenPage` exists so a failed verify can undo a partial write. Each tool handler follows the same shape — validate inputs via Zod, call into the relevant core module, then wrap the response with hints.

The seven registered tools span the whole loop:

- `livewiki_quickstart` reads `livewiki/quickstart.md` via `safeIo.readText` and is the low-token entry point.
- `livewiki_read` reads an arbitrary page by relative path under the `livewiki/` allowlist.
- `livewiki_search` calls `doSearch` on the in-memory FTS5 index with an optional cap (visible bounds: `min(1)`, `max(100)`, default `20`).
- `livewiki_debt` runs `runStatus(repoRoot)` and forwards the JSON report.
- `livewiki_impact` branches on the empty-symbolKey sentinel: a non-empty key runs `computeBlastRadius` against the SQLite DB, an empty key runs `computeChangeImpact` for the repo-wide change-impact package; bounds are `maxDepth` (`min(1)`, `max(20)`, default `5`) and `maxNodes` (`min(1)`, `max(2000)`, default `200`).
- `livewiki_write_doc` is the only mutating tool — it goes through the three-stage guard described in the next section.
- `livewiki_resolve_debt` opens the SQLite DB, runs a transactional `UPDATE debt SET resolved_at = ? WHERE id = ? AND resolved_at IS NULL`, partitions IDs into `resolved` vs `notFound`, and records an activity metric.

After the tools are registered, `createServer` calls `startWatcher(repoRoot, searchIdx)` and overrides `server.close` to stop the watcher before closing the search index, then returns the server.

## Write guard: allowlist, verify, rollback, and indexing

The `livewiki_write_doc` handler enforces SPEC rule #1 (writes go through `core/safe-io`) in three stages, and each visible failure path is documented because the source explicitly branches on each error class:

1. **Allowlist + path validation** — `safeIo.writeText(repoRoot, path, content)` calls `resolveAndValidate` internally; on `PathOutsideAllowlistError` the handler throws an `McpError(InvalidParams, ...)` explaining the allowlist; on `InvalidRelativePathError` it throws `McpError(InvalidParams, err.message)`. Any other thrown error becomes an `errorResult`. This means paths outside `livewiki/` are rejected *before* a single byte reaches disk — the check is one-sided: only relative paths inside the allowlist are accepted.
2. **Verify** — unless `skipVerify === true`, the handler runs `verify(repoRoot)` (the production verifier, or the `opts.verify` test seam) and filters `verifyResult.issues` down to those whose `severity === "error"` and whose `wikiPath` matches the page being written (or is empty, repo-wide). If any matching issue exists, `rollbackWrittenPage(path)` deletes the just-written file and the handler returns an `errorResult` describing the first failing issue (`code` + `detail`). If `verify` itself throws, the handler attempts the same rollback and, if the rollback also fails, surfaces a louder `errorResult` warning that the disk may hold an unverified page at that path. The normal path (no issues, no throw) continues to step 3.
3. **Incremental index + activity ledger** — on success, `indexPage(searchIdx, path, content)` updates the FTS5 index in place; `recordUpdateMetric` is then awaited with a `write_received` payload carrying byte length and a token estimate derived from `CHARS_PER_TOKEN`. The handler finally returns `hintedTextResult("livewiki_write_doc", "wrote <path> (verified)")`.

The `resolve_debt` handler mirrors the failure discipline: any thrown error becomes an `errorResult`, and the SQLite `UPDATE` is wrapped in `db.transaction(...)` so the resolved/notFound partition is atomic.

## Watcher denylist: what never reaches the debounce

<!-- lw:anchors packages/mcp/src/server.ts#isWatchDenied -->

```ts
function isWatchDenied(filename: string): boolean
```

`isWatchDenied` takes an absolute or relative filename string and returns `true` when the file should be ignored by the watcher; it returns `false` otherwise (the only path actually forwarded to `schedule`).

The denylist is intentionally small and split into two `ReadonlySet`s so the policy is auditable at a glance:

- `WATCH_DENIED_SEGMENTS` — directory *segments* matched by walking the path's `/` and `\\` components (Windows emits backslashes, POSIX emits forward slashes — the split regex handles both). The segments are `.git`, `.livewiki` (the derived cache — its writes must never retrigger the sync loop), `node_modules`, and `dist`.
- `WATCH_DENIED_EXTENSIONS` — file extensions (compared case-insensitively via `nodePath.extname(filename).toLowerCase()`) covering common binary, media, archive, and font types: `.png .jpg .jpeg .gif .webp .ico .svg .pdf .zip .gz .tar .mp3 .mp4 .mov .avi .woff .woff2 .ttf .eot`.

The implementation short-circuits on the first matching segment so the function stays cheap on large trees. Anything not matched flows into the debounce; the indexer applies its own (richer) walk denylist, so a noisy-but-harmless event costs at most one hash-incremental no-op sync. Containment here is intentionally one-sided: `isWatchDenied` is the *watcher's* pre-filter, not a general path policy — `livewiki_write_doc`'s allowlist lives in `core/safe-io` and is independent.

## Debounce and incremental re-index pipeline

<!-- lw:anchors packages/mcp/src/server.ts#schedule packages/mcp/src/server.ts#syncBatch -->

```ts
function schedule(): void
async function syncBatch(): Promise<void>
```

`schedule` is the debounce primitive: it takes no parameters and returns nothing; it arms (or re-arms) a `setTimeout` for `WATCH_DEBOUNCE_MS` (1500 ms) and is invoked from the watcher's event callback. The implementation is:

- If the watcher has already been stopped, `schedule` returns immediately — no work is queued.
- If a debounce timer is already armed, it is cleared first so only the most recent batch of events survives.
- When the timer fires, the function nulls `debounce` and checks `inFlight`. If a sync is already running, `schedule` re-arms the debounce (`schedule()`) and lets the in-flight one settle — overlapping indexer/ledger runs against the same DB are intentionally avoided.
- Otherwise it sets `inFlight = syncBatch().finally(() => { inFlight = null; })` so subsequent events can detect the in-flight state.

`syncBatch` is the actual pipeline. It takes no parameters and returns a `Promise<void>` that resolves when the batch is fully re-indexed (or rejects — but rejections are caught inside the function and logged via `console.error`, so callers always observe a settled promise). The pipeline runs three stages in sequence: `runIndexer(repoRoot, { quiet: true })` for the hash-incremental source index, `runLedger(repoRoot, { quiet: true })` for the anchor ledger, and `reindexAllPages(searchIdx, repoRoot)` for the full FTS5 rebuild. The same three-stage sequence is the one the startup rebuild uses, which is why the search response shape stays stable across warm and cold starts. A failed sync is logged with a single `[livewiki] watcher sync failed: ...` line and does **not** kill the server — the next event retries.

The visible exception path in `syncBatch` is the outer `try/catch`: any error from `runIndexer`, `runLedger`, or `reindexAllPages` is caught, formatted via `err instanceof Error ? err.message : String(err)`, and printed to `stderr`; the `inFlight` reset in the calling `schedule` still runs because `finally` fires regardless.

## Watcher lifecycle: start, fail-open, and safe close

<!-- lw:anchors packages/mcp/src/server.ts#startWatcher packages/mcp/src/server.ts#stop -->

```ts
function startWatcher(repoRoot: string, searchIdx: SearchIndex): WatcherHandle
```

`startWatcher` takes the resolved repo root and an already-open `SearchIndex`, and returns a `WatcherHandle` whose `stop()` method tears the watcher down. It returns a handle, not a server — wiring into `McpServer.close` happens in `createServer`.

The startup path:

1. Canonicalize `repoRoot` via `realpathSync.native(repoRoot)` to defeat Windows 8.3 aliases (e.g. `RUNNER~1`) that would otherwise mismatch the long names the OS reports in watch events. If canonicalization fails, `watchRoot` falls back to the lexical path — a fail-open choice that pairs with the watch-error degradation below.
2. Call `watch(watchRoot, { recursive: true }, (_eventType, filename) => { ... })`. The callback treats a `null` `filename` (some platforms deliver it) as "sync anyway" — it skips the denylist and calls `schedule`. A non-null filename is filtered through `isWatchDenied` before being allowed to reach the debounce.
3. Attach `watcher.on("error", err => ...)` which logs a single `[livewiki] fs.watch failed (...)` line, then calls `void stop()` so the handle can no longer fire and the server keeps serving with startup-rebuild semantics.
4. Wrap the whole `watch(...)` setup in a `try/catch` that catches platforms where recursive `fs.watch` is unavailable (e.g. some Linux configurations). The catch logs `[livewiki] fs.watch unavailable (...)`, sets `watcher = null`, and returns the handle anyway — the handle's `stop()` becomes a no-op against `null`.

```ts
async function stop(): Promise<void>
```

`stop` is the teardown method returned on the `WatcherHandle`. It takes no parameters and returns a `Promise<void>` that resolves only after every piece of watcher state is released. The implementation is a sequence of guarded cleanup steps:

- Flip `stopped = true` so any pending or future `schedule` calls become no-ops.
- Clear and null the `debounce` timer if one is armed, so the timer cannot fire after stop.
- If `watcher` is non-null, snapshot it, null the closure slot, then call `w.close()` *and* `await` the `close` event. The explicit `w.once("close", () => resolve())` wrapper exists because `watcher.close()` only *requests* the OS handle close — on Windows libuv can still deliver events to a dying handle, which is the failure mode the comment block in the source calls out explicitly.
- Finally, `await inFlight` if a sync is still running, so the caller (the overridden `server.close`) only proceeds once the last indexer/ledger/search.db pass has settled.

The interaction with `createServer`'s overridden `close` is what makes the cleanup safe on Windows: the override calls `await watcherHandle.stop()` *first*, then `closeSearch(searchIdx)`, then `origClose()`. That ordering guarantees that no in-flight indexer holds `.livewiki/index.db` handles and no FTS5 reindex touches a closed `search.db` past the moment the test harness `rm -rf`s the temp directory.

## Tests

Covered by `packages/mcp/src/server.test.ts` (same-name test file on disk).
