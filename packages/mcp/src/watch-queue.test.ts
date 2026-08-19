/**
 * Watcher pending-work regressions (P1, 2026-08-19).
 *
 * The bug: a failed sync logged one line and dropped its batch, relying on
 * "the next event" to retry. For the LAST event of a sequence there is no
 * next event, so the index stayed behind the working tree silently.
 *
 * Time is injected, never slept on. `ManualTimers` records the armed delay
 * and fires it on demand, so every assertion about the backoff policy is
 * about the delay the queue CHOSE, not about wall-clock luck.
 */

import { describe, it, expect } from "vitest";
import {
  createSyncQueue,
  isWriteContention,
  WATCH_DEBOUNCE_MS,
  WATCH_RETRY_BASE_MS,
  WATCH_RETRY_MAX_MS,
  WATCH_PERMANENT_ATTEMPTS,
  type TimerApi,
} from "./watch-queue.js";

/** A TimerApi whose clock only moves when the test says so. */
class ManualTimers implements TimerApi {
  private next = 1;
  private readonly armed = new Map<number, { fn: () => void; ms: number }>();

  set(fn: () => void, ms: number): unknown {
    const id = this.next++;
    this.armed.set(id, { fn, ms });
    return id;
  }

  clear(handle: unknown): void {
    this.armed.delete(handle as number);
  }

  /** Delay of the single armed timer, or null. Asserts the one-timer invariant. */
  armedDelay(): number | null {
    const entries = [...this.armed.values()];
    expect(entries.length).toBeLessThanOrEqual(1);
    return entries[0]?.ms ?? null;
  }

  /** Fires the armed timer. Throws if nothing is armed — a silent no-op here
   *  would let a "queue forgot to reschedule" bug pass as success. */
  fire(): void {
    const entries = [...this.armed.entries()];
    if (entries.length === 0) throw new Error("no timer armed: the queue scheduled nothing");
    const [id, entry] = entries[0]!;
    this.armed.delete(id);
    entry.fn();
  }

  count(): number {
    return this.armed.size;
  }
}

function contentionError(): Error {
  return Object.assign(new Error("another process is writing to the index"), {
    code: "INDEX_WRITE_CONTENTION",
  });
}

/** A run() whose outcome the test controls, recording concurrency as it goes. */
function trackedRun() {
  const calls: Array<{ resolve: () => void; reject: (err: unknown) => void }> = [];
  let active = 0;
  let maxActive = 0;
  let started = 0;
  const run = (): Promise<void> => {
    started++;
    active++;
    maxActive = Math.max(maxActive, active);
    return new Promise<void>((resolve, reject) => {
      calls.push({
        resolve: () => {
          active--;
          resolve();
        },
        reject: (err) => {
          active--;
          reject(err);
        },
      });
    });
  };
  return {
    run,
    get started() {
      return started;
    },
    get maxActive() {
      return maxActive;
    },
    /** Settles the oldest un-settled run. */
    finish: (err?: unknown) => {
      const call = calls.shift();
      if (!call) throw new Error("no run in flight");
      if (err === undefined) call.resolve();
      else call.reject(err);
    },
  };
}

describe("watcher sync queue", () => {
  it("CENTRAL: retries a contention failure with no further filesystem event", async () => {
    // event A → sync starts → sync fails on contention → NOTHING else happens
    // → the queue retries by itself → the work lands.
    const timers = new ManualTimers();
    const tracked = trackedRun();
    const queue = createSyncQueue({ run: tracked.run, timers, log: () => {} });

    queue.notify(); // event A
    expect(timers.armedDelay()).toBe(WATCH_DEBOUNCE_MS);

    timers.fire(); // debounce elapses, the sync starts
    expect(queue.snapshot()).toMatchObject({ running: true, pending: false });

    tracked.finish(contentionError());
    await queue.settled();

    // The batch was NOT dropped, and a retry is armed without any new event.
    expect(queue.snapshot()).toMatchObject({ pending: true, running: false, attempt: 1 });
    expect(timers.armedDelay()).toBe(WATCH_RETRY_BASE_MS);

    timers.fire(); // the retry the queue scheduled for itself
    expect(tracked.started).toBe(2);
    tracked.finish(); // this one succeeds
    await queue.settled();

    expect(queue.snapshot()).toMatchObject({ pending: false, running: false, attempt: 0 });
    expect(timers.armedDelay()).toBeNull(); // nothing left armed
    await queue.stop();
  });

  it("A. an event arriving during a pending retry is merged into the next run", async () => {
    const timers = new ManualTimers();
    const tracked = trackedRun();
    const queue = createSyncQueue({ run: tracked.run, timers, log: () => {} });

    queue.notify(); // A
    timers.fire();
    tracked.finish(contentionError()); // A's sync failed
    await queue.settled();
    expect(queue.snapshot().pending).toBe(true);

    queue.notify(); // B arrives while the retry is pending

    // B does not get its own timer, and does not reset the backoff: the armed
    // retry already covers both, because the sync is whole-repo.
    expect(timers.count()).toBe(1);
    expect(timers.armedDelay()).toBe(WATCH_RETRY_BASE_MS);

    timers.fire();
    expect(tracked.started).toBe(2); // ONE run covering A+B, not one each
    tracked.finish();
    await queue.settled();

    expect(queue.snapshot()).toMatchObject({ pending: false, attempt: 0 });
    await queue.stop();
  });

  it("A2. an event arriving mid-run is not swallowed by the run already going", async () => {
    // The run cleared `pending` when it started; an event during it must set
    // it again, or that event is lost the moment the run succeeds.
    const timers = new ManualTimers();
    const tracked = trackedRun();
    const queue = createSyncQueue({ run: tracked.run, timers, log: () => {} });

    queue.notify();
    timers.fire();
    expect(queue.snapshot()).toMatchObject({ running: true, pending: false });

    queue.notify(); // arrives mid-run
    expect(queue.snapshot().pending).toBe(true);

    tracked.finish(); // the run succeeds
    await queue.settled();

    // A follow-up run is armed for the event the successful run may have missed.
    expect(timers.armedDelay()).toBe(WATCH_DEBOUNCE_MS);
    timers.fire();
    expect(tracked.started).toBe(2);
    tracked.finish();
    await queue.settled();
    await queue.stop();
  });

  it("B. consecutive contention failures back off deterministically and eventually converge", async () => {
    const timers = new ManualTimers();
    const tracked = trackedRun();
    const queue = createSyncQueue({ run: tracked.run, timers, log: () => {} });

    queue.notify();
    timers.fire();

    const delays: Array<number | null> = [];
    for (let i = 0; i < 8; i++) {
      tracked.finish(contentionError());
      await queue.settled();
      // Never dropped, no matter how many times it fails.
      expect(queue.snapshot().pending).toBe(true);
      delays.push(timers.armedDelay());
      timers.fire();
    }

    // 1s, 2s, 4s, 8s, 16s, then capped at 30s — exponential, capped, no jitter.
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000]);
    expect(WATCH_RETRY_MAX_MS).toBe(30_000);

    // Contention keeps retrying (it means someone else IS making progress),
    // so the ninth attempt is still going and finally succeeds.
    tracked.finish();
    await queue.settled();
    expect(queue.snapshot()).toMatchObject({ pending: false, attempt: 0 });
    expect(timers.armedDelay()).toBeNull();

    // One run at a time throughout.
    expect(tracked.maxActive).toBe(1);
    expect(tracked.started).toBe(9);
    await queue.stop();
  });

  it("C. a permanent error stays observable, stops looping, and keeps the work pending", async () => {
    const timers = new ManualTimers();
    const tracked = trackedRun();
    const logged: string[] = [];
    const queue = createSyncQueue({
      run: tracked.run,
      timers,
      log: (m) => logged.push(m),
    });

    queue.notify();
    timers.fire();

    const boom = new Error("ENOSPC: no space left on device");
    for (let i = 0; i < WATCH_PERMANENT_ATTEMPTS; i++) {
      tracked.finish(boom);
      await queue.settled();
      expect(queue.snapshot().pending).toBe(true);
      if (i < WATCH_PERMANENT_ATTEMPTS - 1) {
        expect(timers.armedDelay()).not.toBeNull(); // still retrying
        timers.fire();
      }
    }

    // Bounded: after the limit the queue stops scheduling itself. No hot loop.
    expect(timers.count()).toBe(0);
    expect(tracked.started).toBe(WATCH_PERMANENT_ATTEMPTS);

    // Never silently dropped — the work is still pending and the error was
    // reported every single time, ending with an explicit give-up line.
    expect(queue.snapshot().pending).toBe(true);
    expect(logged.filter((m) => m.includes("ENOSPC")).length).toBe(WATCH_PERMANENT_ATTEMPTS);
    expect(logged.at(-1)).toMatch(/giving up on automatic retry/);
    expect(logged.at(-1)).toMatch(/stays pending/);

    // A later filesystem event re-enters the normal path and can still fix it.
    queue.notify();
    expect(timers.armedDelay()).toBe(WATCH_DEBOUNCE_MS);
    timers.fire();
    expect(tracked.started).toBe(WATCH_PERMANENT_ATTEMPTS + 1);
    tracked.finish();
    await queue.settled();
    expect(queue.snapshot()).toMatchObject({ pending: false, attempt: 0 });
    await queue.stop();
  });

  it("D. stop() disarms a pending retry and starts no further sync", async () => {
    const timers = new ManualTimers();
    const tracked = trackedRun();
    const queue = createSyncQueue({ run: tracked.run, timers, log: () => {} });

    queue.notify();
    timers.fire();
    tracked.finish(contentionError());
    await queue.settled();
    expect(timers.count()).toBe(1); // a retry is armed

    await queue.stop();

    expect(timers.count()).toBe(0); // and stop() disarmed it
    expect(queue.snapshot().stopped).toBe(true);

    // Post-stop events are refused outright.
    queue.notify();
    expect(timers.count()).toBe(0);
    expect(tracked.started).toBe(1);
  });

  it("D2. stop() awaits an in-flight sync and never leaves one running", async () => {
    const timers = new ManualTimers();
    const tracked = trackedRun();
    const queue = createSyncQueue({ run: tracked.run, timers, log: () => {} });

    queue.notify();
    timers.fire();
    expect(queue.snapshot().running).toBe(true);

    let stopResolved = false;
    const stopping = queue.stop().then(() => (stopResolved = true));
    await Promise.resolve();
    expect(stopResolved).toBe(false); // still waiting on the run

    tracked.finish();
    await stopping;
    expect(stopResolved).toBe(true);
    expect(queue.snapshot().running).toBe(false);
    expect(timers.count()).toBe(0);
  });

  it("never runs two syncs at once, even under a burst of events", async () => {
    const timers = new ManualTimers();
    const tracked = trackedRun();
    const queue = createSyncQueue({ run: tracked.run, timers, log: () => {} });

    queue.notify();
    timers.fire(); // run #1 starts

    // A burst arrives mid-run and its debounce elapses while #1 is still going.
    for (let i = 0; i < 5; i++) queue.notify();
    expect(timers.count()).toBe(1);
    timers.fire();

    // The timer found a run in flight, so it re-armed instead of starting one.
    expect(tracked.started).toBe(1);
    expect(timers.armedDelay()).toBe(WATCH_DEBOUNCE_MS);

    tracked.finish();
    await queue.settled();
    timers.fire();
    expect(tracked.started).toBe(2);
    expect(tracked.maxActive).toBe(1);
    tracked.finish();
    await queue.settled();
    await queue.stop();
  });

  it("recognises WriteContentionError by its code, across module boundaries", () => {
    expect(isWriteContention(contentionError())).toBe(true);
    expect(isWriteContention(new Error("database is locked"))).toBe(false);
    expect(isWriteContention(Object.assign(new Error("x"), { code: "SQLITE_BUSY" }))).toBe(false);
    expect(isWriteContention(null)).toBe(false);
    expect(isWriteContention(undefined)).toBe(false);
  });
});
