/**
 * watch-queue — the watcher's pending-work state machine.
 *
 * Split out of `startWatcher` so the part that can lose work is testable
 * without a filesystem, without real timers, and without sleeps.
 *
 * WHAT THIS FIXES (P1, 2026-08-19). The watcher used to run a debounced sync
 * per batch of filesystem events and, on failure, log one line and drop the
 * batch:
 *
 *     catch (err) { console.error("watcher sync failed: …"); }
 *
 * The comment said "the next event retries", and for every batch but one that
 * was true. For the LAST event of a sequence there is no next event: the sync
 * failed, nothing was scheduled, and the index stayed behind the working tree
 * silently until someone happened to touch another file. A failed sync is
 * exactly when a retry is needed, and exactly when this design had none.
 *
 * WHAT "THE BATCH" IS. The sync is a whole-repo incremental pass — `runIndexer`
 * walks the repo and skips unchanged files by hash. So pending work is not a
 * list of paths to replay; it is one bit meaning "the index may be behind the
 * working tree". That makes merging free and total: a run that happens after
 * events A and B covers both, and a run that covers A also covers anything
 * that arrived while it was being scheduled. What must never happen is that
 * bit being cleared by anything other than a run that actually SUCCEEDED —
 * which is precisely what the old code did by dropping the batch.
 *
 * INVARIANTS
 *   - At most one `run()` in flight. Never a second queue.
 *   - At most one timer armed. The debounce and the retry are the same timer,
 *     never two racing each other.
 *   - `pending` is cleared only when a run starts, and restored if that run
 *     fails. Events arriving mid-run re-set it, so they are merged into the
 *     next run instead of being swallowed by the one already going.
 *   - After `stop()`, no timer stays armed and no run is ever started.
 */

/** Debounce window for watcher-triggered syncs (backlog #3 design). */
export const WATCH_DEBOUNCE_MS = 1_500;
/** First retry delay after a failed sync; doubles per consecutive failure. */
export const WATCH_RETRY_BASE_MS = 1_000;
/** Ceiling for the retry backoff. */
export const WATCH_RETRY_MAX_MS = 30_000;
/**
 * How many times a NON-contention failure is retried before the queue stops
 * scheduling itself. Contention is not subject to this limit — see the policy
 * note on `scheduleAfterFailure`.
 */
export const WATCH_PERMANENT_ATTEMPTS = 5;

/** Injection seam for tests: real timers by default. */
export interface TimerApi {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

const REAL_TIMERS: TimerApi = {
  set: (fn, ms) => {
    const handle = setTimeout(fn, ms);
    // A pending retry must never be the reason a process stays alive.
    (handle as unknown as { unref?: () => void }).unref?.();
    return handle;
  },
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface SyncQueueOptions {
  /** The whole-repo sync. Must resolve on success and reject on failure. */
  run: () => Promise<void>;
  debounceMs?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
  permanentAttempts?: number;
  /** Defaults to recognising `WriteContentionError` by its stable code. */
  isContention?: (err: unknown) => boolean;
  log?: (message: string) => void;
  timers?: TimerApi;
}

/** Observable state — the queue's contract, and what the tests assert on. */
export interface SyncQueueState {
  /** Work is known to be outstanding (events seen, or a run failed). */
  pending: boolean;
  /** A run is in flight right now. */
  running: boolean;
  /** Consecutive failures since the last success. 0 while healthy. */
  attempt: number;
  /** Delay of the currently armed timer, or null when nothing is armed. */
  armedMs: number | null;
  /** True once `stop()` has been called. */
  stopped: boolean;
}

export interface SyncQueue {
  /** A filesystem event arrived. */
  notify(): void;
  /** Clears any timer, awaits the in-flight run, and accepts no more work. */
  stop(): Promise<void>;
  /** Snapshot of the state machine. */
  snapshot(): SyncQueueState;
  /** Resolves when no run is in flight. Never rejects. */
  settled(): Promise<void>;
}

/**
 * `WriteContentionError` carries this code. Matched by code rather than by
 * `instanceof` so the check survives the error crossing a module boundary.
 */
export function isWriteContention(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === "INDEX_WRITE_CONTENTION";
}

export function createSyncQueue(options: SyncQueueOptions): SyncQueue {
  const {
    run,
    debounceMs = WATCH_DEBOUNCE_MS,
    retryBaseMs = WATCH_RETRY_BASE_MS,
    retryMaxMs = WATCH_RETRY_MAX_MS,
    permanentAttempts = WATCH_PERMANENT_ATTEMPTS,
    isContention = isWriteContention,
    // eslint-disable-next-line no-console
    log = (message: string) => console.error(message),
    timers = REAL_TIMERS,
  } = options;

  let pending = false;
  let running = false;
  let stopped = false;
  let attempt = 0;
  let timer: unknown = null;
  let armedMs: number | null = null;
  let inFlight: Promise<void> | null = null;

  function arm(ms: number): void {
    if (stopped) return;
    if (timer !== null) timers.clear(timer);
    armedMs = ms;
    timer = timers.set(fire, ms);
  }

  function disarm(): void {
    if (timer !== null) timers.clear(timer);
    timer = null;
    armedMs = null;
  }

  /**
   * Deterministic exponential backoff, capped. No jitter: this queue has one
   * instance per server, so there is no thundering herd to spread out, and a
   * predictable delay is what makes the policy assertable in a test.
   */
  function backoffFor(failures: number): number {
    const grown = retryBaseMs * 2 ** (failures - 1);
    return Math.min(grown, retryMaxMs);
  }

  function scheduleAfterFailure(err: unknown): void {
    // Contention is transient by definition — it means another writer holds
    // the lock, i.e. someone IS making progress. Giving up would leave the
    // index behind with nothing scheduled to fix it, which is the bug this
    // module exists to remove. So contention retries without an attempt
    // limit; the capped backoff is what keeps it from being a hot loop.
    if (isContention(err)) {
      const delay = backoffFor(attempt);
      log(
        `[livewiki] watcher sync hit write contention (attempt ${attempt}); ` +
          `work stays pending, retrying in ${delay}ms`,
      );
      arm(delay);
      return;
    }

    // Anything else is a real error about the repo or the index, and repeating
    // it forever is the hot loop we must not build. Retry a bounded number of
    // times — transient IO does exist — then stop scheduling and say so. The
    // work stays PENDING either way: the next filesystem event, or the next
    // server start, picks it up. It is never silently dropped.
    const message = err instanceof Error ? err.message : String(err);
    if (attempt < permanentAttempts) {
      const delay = backoffFor(attempt);
      log(
        `[livewiki] watcher sync failed (attempt ${attempt}/${permanentAttempts}): ${message}; ` +
          `work stays pending, retrying in ${delay}ms`,
      );
      arm(delay);
      return;
    }
    log(
      `[livewiki] watcher sync failed ${attempt} times, last error: ${message}; ` +
        "giving up on automatic retry — the work stays pending and the next " +
        "file change or server restart will retry it",
    );
    // Back to a clean slate so a later event re-enters the normal debounce
    // path rather than starting at the far end of the backoff curve.
    attempt = 0;
  }

  function fire(): void {
    timer = null;
    armedMs = null;
    if (stopped) return;
    // A run may have been started by an earlier timer; never overlap.
    if (running) {
      arm(debounceMs);
      return;
    }
    if (!pending) return;

    // Cleared BEFORE the run so events arriving mid-run set it again and are
    // merged into the next run. Restored on failure, so a failed run can
    // never be the thing that clears it.
    pending = false;
    running = true;
    inFlight = run()
      .then(() => {
        attempt = 0;
        // Events that arrived while this run was going.
        if (pending) arm(debounceMs);
      })
      .catch((err: unknown) => {
        pending = true;
        attempt++;
        scheduleAfterFailure(err);
      })
      .finally(() => {
        running = false;
        inFlight = null;
      });
  }

  return {
    notify(): void {
      if (stopped) return;
      pending = true;
      // While backing off, an event does NOT shorten the wait. The retry
      // already scheduled will cover this event too (the sync is whole-repo),
      // and letting events reset the timer would turn a steady stream of
      // edits into the hot loop the backoff exists to prevent.
      if (attempt > 0) return;
      arm(debounceMs);
    },

    async stop(): Promise<void> {
      stopped = true;
      disarm();
      if (inFlight) await inFlight;
    },

    snapshot(): SyncQueueState {
      return { pending, running, attempt, armedMs, stopped };
    },

    async settled(): Promise<void> {
      if (inFlight) await inFlight;
    },
  };
}
