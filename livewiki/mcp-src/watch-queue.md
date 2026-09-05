---
title: Watcher Sync Queue State Machine
owner: generated
anchors:
- packages/mcp/src/watch-queue.ts#WATCH_DEBOUNCE_MS
- packages/mcp/src/watch-queue.ts#WATCH_PERMANENT_ATTEMPTS
- packages/mcp/src/watch-queue.ts#WATCH_RETRY_BASE_MS
- packages/mcp/src/watch-queue.ts#WATCH_RETRY_MAX_MS
- packages/mcp/src/watch-queue.ts#createSyncQueue
- packages/mcp/src/watch-queue.ts#isWriteContention
---

# Watcher Sync Queue State Machine

This module provides the pending-work state machine that schedules whole-repository index syncs triggered by filesystem watcher events.

## When to use this page

- Understand how the watcher debounces filesystem events before running an indexer sync.
- Learn how the queue retries failed syncs with exponential backoff without dropping work.
- Trace how write contention and permanent failures are handled differently.
- See how observers can inspect the queue's state for diagnostics or testing.

## How it fits

This file lives in `packages/mcp/src/` and is used by the MCP (Model Context Protocol) server's file watcher. A watcher that monitors the repository for changes needs to trigger incremental index rebuilds, but must coalesce rapid bursts of filesystem events and recover from transient sync failures. The module was extracted from the watcher's startup logic specifically to isolate the failure-handling policy from the filesystem eventing layer, making that policy testable without a filesystem or real timers. Its immediate partners are the watcher startup code that owns the queue instance and the module that runs the actual full-repository incremental index pass.

## Diagram

```mermaid
%% livewiki/diagrams/mcp-src-watch-queue.mmd
```

## Timer configuration constants

<!-- lw:anchors packages/mcp/src/watch-queue.ts#WATCH_DEBOUNCE_MS packages/mcp/src/watch-queue.ts#WATCH_RETRY_BASE_MS packages/mcp/src/watch-queue.ts#WATCH_RETRY_MAX_MS packages/mcp/src/watch-queue.ts#WATCH_PERMANENT_ATTEMPTS -->

These four exported constants define the timing and retry policy for the queue and are used as the defaults when `createSyncQueue` is called without explicit values. They exist so the policy is visible and tunable at a single location rather than buried inside the queue implementation.

`WATCH_DEBOUNCE_MS` is set to 1,500 and represents the window that coalesces a burst of filesystem events into a single sync run. When the watcher fires, the queue waits this long to see if more events arrive before actually running the sync.

`WATCH_RETRY_BASE_MS` is 1,000 and is the first delay after a sync fails. Each consecutive failure doubles this delay, so the second retry waits 2 seconds, the third 4 seconds, and so on.

`WATCH_RETRY_MAX_MS` is 30,000 and serves as the upper ceiling for that exponential backoff. Once the computed delay reaches this value it stops growing, keeping a long outage from spacing retries too far apart.

`WATCH_PERMANENT_ATTEMPTS` is 5 and governs how many times a non-contention failure retries before the queue stops scheduling itself. A write-contention failure, which means another process is actively making progress on the index, is exempt from this limit and retries indefinitely under the capped backoff.

## Contention detection

<!-- lw:anchors packages/mcp/src/watch-queue.ts#isWriteContention -->

The queue needs a way to tell two very different kinds of failure apart. A write-contention error means another writer holds the index lock and is making progress — this is transient by definition and should retry forever. Any other error is about the repository or index itself and repeating it forever would create a hot loop.

```ts
export function isWriteContention(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === "INDEX_WRITE_CONTENTION";
}
```

This function accepts an unknown error value and returns a boolean indicating whether it carries the stable code `INDEX_WRITE_CONTENTION`. It matches on the error's `code` property rather than using `instanceof`, because the error may have crossed a module boundary where the constructor identity no longer holds. The `err` parameter is first cast to a nullable object shape, so a `null` or non-object input safely returns `false` rather than throwing.

## Queue construction

<!-- lw:anchors packages/mcp/src/watch-queue.ts#createSyncQueue -->

The `createSyncQueue` function is the factory that assembles the entire state machine. It exists to encapsulate the invariants the watcher depends on: at most one sync run in flight, at most one armed timer, and the "work pending" bit being cleared only by a run that actually succeeded.

```ts
export function createSyncQueue(options: SyncQueueOptions): SyncQueue {
```

This function takes a `SyncQueueOptions` object containing the sync `run` function plus optional overrides for timing, retry policy, contention detection, logging, and timers, and it returns a `SyncQueue` with methods for signaling events, stopping, snapshotting state, and awaiting settlement.

The construction begins by destructuring the options with sensible defaults drawn from the module constants. The `run` option is the whole-repo incremental sync that must resolve on success and reject on failure. Custom `isContention` detection defaults to the exported `isWriteContention`, logging defaults to `console.error`, and timers default to a real implementation that also calls `.unref()` on the timeout handle so a pending retry never keeps the process alive by itself.

The factory closes over private mutable state: a `pending` flag meaning the index may be behind the working tree, a `running` flag meaning a run is in flight, a `stopped` flag for the shut-down state, consecutive `attempt` count, the single armed timer handle, the delay of that timer, and the currently in-flight promise. The state machine's behavior is entirely driven by this closure plus the user-supplied `run`.

### Work notification and debounce

When a filesystem event arrives, the watcher calls `notify()`. This sets the `pending` flag to true — the one bit that means work is outstanding. If the queue is already backing off from a failure, the method returns without re-arming the timer, because the retry already scheduled will cover this event too and letting events shorten a backoff wait would turn a stream of edits into the hot loop the backoff exists to prevent. Otherwise it arms the timer for the debounce window of `WATCH_DEBOUNCE_MS`.

### Timer arming and firing

The internal `arm` function clears any existing timer before setting a new one, guaranteeing the single-timer invariant. It records the delay it armed with and delegates to the injected timer API. The `disarm` function clears the timer and resets the armed delay to `null`, used during shutdown.

When the timer fires, `fire` clears the timer handle and armed delay, then checks whether the queue has been stopped or whether a run is already in flight. If a run is already going, it re-arms the debounce timer to catch up after that run completes rather than starting a second overlapping run. If no work is pending, it returns without doing anything.

### Running the sync and merging events

When the timer fires with work pending and nothing running, `fire` clears the `pending` flag *before* starting the run. This ordering matters: events arriving during the run set the flag again, and that re-set value is merged into the next run. The code sets `running` to true and stores the run promise in `inFlight`.

On success the attempt counter resets to zero. If events arrived while the run was going, the flag will be true and the queue arms the debounce timer for another pass. On failure, the flag is restored to `true` — a failed run can never be what clears it — the attempt counter increments, and `scheduleAfterFailure` decides the next move. The `finally` block clears the running flag and the in-flight promise reference.

### Retry policy after failure

The `scheduleAfterFailure` function embodies the module's core fix: never silently drop work. If the error is write contention, the queue logs the contention with the current attempt number and arms the timer with a backoff delay, with no limit on how many times this path can repeat. For any other failure, the queue counts it against `permanentAttempts`. While the attempt number is below the limit it logs the failure with the error message and retry delay and arms the timer. Once the limit is reached, it logs that automatic retry is being abandoned — explicitly noting that the work stays pending and the next file change or server restart will pick it up — and resets the attempt counter to zero so a later event re-enters the normal debounce path rather than starting at the far end of the backoff curve.

The `backoffFor` helper computes the delay as the base multiplied by two raised to the count of prior failures, capped at `retryMaxMs` via `Math.min`. It deliberately uses no jitter because this queue has one instance per server, so there is no thundering herd to spread out, and a deterministic delay makes the policy assertable in tests.

### Observable state and shutdown

The returned queue object exposes four methods. `notify` signals an event as described above. `stop` marks the queue stopped, disarms any pending timer, optionally awaits the in-flight run, and refuses further work. `snapshot` returns the observable `SyncQueueState` — a plain object with the flags `pending`, `running`, and `stopped`, the consecutive `attempt` count, and the currently armed delay `armedMs` or `null`. `settled` resolves when no run is in flight and never rejects, useful for callers that need to know the queue has quieted down.

The stop path also enforces the invariant that after `stop()` no timer stays armed and no new run is ever started, because every entry point checks the `stopped` flag first and the timer is disarmed before awaiting any in-flight work.

## Tests

Covered by `packages/mcp/src/watch-queue.test.ts` (same-name test file on disk).
