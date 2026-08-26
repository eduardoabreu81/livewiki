/**
 * Watcher retry, end to end (P1, 2026-08-19).
 *
 * `watch-queue.test.ts` proves the state machine with injected time. This file
 * proves the two things that only a real run can: that `fs.watch` events reach
 * that queue, and that a REAL MCP server process recovers a sync it lost to
 * write contention **with no further filesystem event** — the exact scenario
 * the old drop-the-batch behaviour left permanently behind.
 *
 * No sleeps are used for synchronisation: every wait is a condition poll with
 * a deadline, so a fast machine finishes fast and a slow one still passes.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import * as nodePath from "node:path";
import * as nodeOs from "node:os";
import * as nodeFs from "node:fs/promises";
import { openIndex, openIndexReadOnly, WRITE_LOCK_TIMEOUT_MS } from "@livewiki/core/db";
import { run as runIndexer } from "@livewiki/core/indexer";
import { startWatcher } from "./server.js";
import type { SearchIndex } from "./search.js";
import type { TimerApi } from "./watch-queue.js";

// The contention proof has to outlast one full write-lock wait
// (WRITE_LOCK_TIMEOUT_MS) plus server boot, the debounce, a whole-repo pass,
// and a retry. Only the 30s lock wait is fixed; everything around it scales
// with how slow the machine is. Measured wall time for this file: 33s on
// ubuntu, 46s on macOS, >61s on the Windows runner — so the budget has to be
// a multiple of the fixed part, not a small margin over it.
vi.setConfig({ testTimeout: WRITE_LOCK_TIMEOUT_MS * 8 });

let repoRoot: string;
let server: ChildProcess | null = null;

beforeEach(async () => {
  repoRoot = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "livewiki-watch-retry-"));
  await nodeFs.mkdir(nodePath.join(repoRoot, "src"), { recursive: true });
});

afterEach(async () => {
  if (server && server.exitCode === null) {
    server.kill();
    await new Promise((resolve) => server?.once("close", resolve));
  }
  server = null;
  await nodeFs.rm(repoRoot, { recursive: true, force: true });
});

/**
 * Polls `predicate` until it holds or the deadline passes. Never a bare sleep.
 *
 * `diagnose` is appended to the timeout message. A bare "timed out" here is
 * ambiguous in CI between "the machine was slow" and "the watcher never
 * started" (fs.watch degrades to no-watcher with a log line on some
 * platforms), and telling those apart from a log after the fact is the
 * difference between a one-line fix and a re-run.
 */
async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  label: string,
  timeoutMs: number,
  diagnose?: () => string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > deadline) {
      const extra = diagnose?.() ?? "";
      throw new Error(
        `timed out waiting for: ${label} (after ${timeoutMs}ms)` +
          (extra ? `\n--- diagnostics ---\n${extra}` : ""),
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function writeModule(rel: string, seed: number): Promise<void> {
  await nodeFs.writeFile(
    nodePath.join(repoRoot, rel),
    `export function fn${seed}(a: number): number {\n  return a + ${seed};\n}\n`,
    "utf8",
  );
}

function indexedPaths(): string[] {
  const db = openIndexReadOnly(nodePath.join(repoRoot, ".livewiki", "index.db"));
  try {
    return (
      db.prepare("SELECT path FROM files WHERE status = 'active' ORDER BY path").all() as Array<{
        path: string;
      }>
    ).map((r) => r.path);
  } finally {
    db.close();
  }
}

function dbHealth(): {
  integrity: string;
  foreignKeyViolations: number;
  duplicatePaths: number;
  orphans: number;
} {
  const db = openIndexReadOnly(nodePath.join(repoRoot, ".livewiki", "index.db"));
  try {
    const count = (sql: string): number => (db.prepare(sql).get() as { c: number }).c;
    return {
      integrity: JSON.stringify(db.pragma("integrity_check")),
      foreignKeyViolations: (db.prepare("PRAGMA foreign_key_check").all() as unknown[]).length,
      duplicatePaths: count(
        "SELECT COUNT(*) c FROM (SELECT path FROM files GROUP BY path HAVING COUNT(*) > 1)",
      ),
      orphans:
        count("SELECT COUNT(*) c FROM symbols s LEFT JOIN files f ON f.id=s.file_id WHERE f.id IS NULL") +
        count("SELECT COUNT(*) c FROM calls c LEFT JOIN files f ON f.id=c.file_id WHERE f.id IS NULL") +
        count(
          "SELECT COUNT(*) c FROM rationales r LEFT JOIN files f ON f.id=r.file_id WHERE f.id IS NULL",
        ),
    };
  } finally {
    db.close();
  }
}

describe("startWatcher wiring", () => {
  it("turns a real filesystem event into queued work, and stop() disarms the retry", async () => {
    // Time is injected so the assertions are about what the watcher SCHEDULED,
    // not about how long a machine took. Only the fs event itself is real.
    const armed: Array<{ id: number; ms: number; fn: () => void }> = [];
    let nextId = 1;
    const timers: TimerApi = {
      set: (fn, ms) => {
        const id = nextId++;
        armed.push({ id, ms, fn });
        return id;
      },
      clear: (handle) => {
        const i = armed.findIndex((t) => t.id === handle);
        if (i >= 0) armed.splice(i, 1);
      },
    };

    let syncCalls = 0;
    const contention = Object.assign(new Error("another process is writing to the index"), {
      code: "INDEX_WRITE_CONTENTION",
    });

    const handle = startWatcher(repoRoot, null as unknown as SearchIndex, {
      sync: async () => {
        syncCalls++;
        throw contention;
      },
      queue: { timers, log: () => {} },
    });

    try {
      await writeModule("src/watched.ts", 1);
      // fs.watch is asynchronous and platform-dependent — wait for the effect
      // (a timer got armed), not for a fixed duration.
      await waitFor(() => armed.length === 1, "watcher to arm a debounce", 15_000);
      expect(armed[0]!.ms).toBe(1_500);

      armed.shift()!.fn(); // debounce elapses → sync runs → contention
      await waitFor(() => syncCalls === 1, "sync to run", 5_000);
      await waitFor(() => armed.length === 1, "watcher to arm a retry", 5_000);
      expect(armed[0]!.ms).toBe(1_000); // first backoff step, self-scheduled
    } finally {
      await handle.stop();
    }

    // Shutdown leaves nothing armed and nothing running.
    expect(armed.length).toBe(0);
    expect(syncCalls).toBe(1);
  });
});

/**
 * Previously skipped on the Windows CI runner, where the spawned server's
 * stderr stayed empty for the whole budget and neither a sync nor contention
 * was ever reported. That was read as a Windows subprocess-harness quirk. It
 * was not: the same symptom appeared on ubuntu-latest the moment its image
 * moved to 20260823.283, on code that had not changed.
 *
 * Probes on the failing runner settled it — a spawned child there captures
 * stderr and receives recursive fs.watch events, and the real server both
 * syncs an uncontended write and reports contention on a held lock. What the
 * test got wrong was WHEN it wrote: it treated `search.db` as "the server is
 * watching", and a write landing before `startWatcher` runs is simply lost.
 * Step 2b now waits for a warm-up write to reach the index, so the scenario
 * cannot start against a server that is not watching yet — and the skip is
 * gone, because Windows was never a platform defect either.
 */
describe(
  "MCP server watcher recovers a contended sync with no further event",
  () => {
  it("retries by itself after the write lock is released", async () => {
    // 1. A repo with an index the server can open.
    await writeModule("src/base.ts", 0);
    await runIndexer(repoRoot, { quiet: true });
    expect(indexedPaths()).toContain("src/base.ts");

    // 2. The REAL server process, exactly as it runs in production.
    const serverEntry = nodePath.resolve(process.cwd(), "dist/index.js");
    server = spawn(process.execPath, [serverEntry, "--repo", repoRoot], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    server.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
    server.stdout?.on("data", () => {});

    // Boot is done once the startup rebuild has produced the search index.
    await waitFor(
      async () =>
        await nodeFs
          .stat(nodePath.join(repoRoot, ".livewiki", "search.db"))
          .then(() => true)
          .catch(() => false),
      "server startup rebuild",
      WRITE_LOCK_TIMEOUT_MS * 2,
      () => `server stderr:
${stderr || "(empty)"}`,
    );

    // 2b. Wait until the watcher is provably ARMED, not merely until the
    //     startup rebuild finished. `search.db` appears in `openAndIndex`,
    //     which createServer awaits ~480 lines before it reaches
    //     `startWatcher` — so search.db is a proxy that leads the thing this
    //     test depends on. A single write landing in that window is dropped,
    //     and step 4 deliberately produces no second event, so the whole run
    //     then waits on something that can never happen and the diagnosis
    //     reads as an empty stderr. That is what made this test fail on the
    //     Windows runner and, from ubuntu image 20260823.283, on Linux too.
    //
    //     A throwaway write turns the wait into an observable effect: the file
    //     only reaches the index if a live watcher put it there.
    //
    //     It has to be RE-touched, not written once. A single warm-up can land
    //     in that same gap and be lost exactly like the real one, which is the
    //     bug this step exists to prevent — measured: written once, the test
    //     passed alone on macOS and failed alone on ubuntu, and the two
    //     swapped when the suite ran single-threaded. Retouching removes the
    //     dependence on when the write happens to land.
    //
    //     One touch per debounce window plus margin: writing faster than the
    //     watcher's 1.5s debounce would restart it forever and no sync would
    //     ever run.
    {
      const armedBy = Date.now() + WRITE_LOCK_TIMEOUT_MS * 3;
      let touches = 0;
      let armed = false;
      const warmupIndexed = (): boolean => {
        try {
          return indexedPaths().includes("src/warmup.ts");
        } catch {
          return false; // index momentarily locked by the watcher's own sync
        }
      };
      while (Date.now() < armedBy && !armed) {
        await writeModule("src/warmup.ts", ++touches);
        const settleBy = Date.now() + 4_000;
        while (Date.now() < settleBy && !armed) {
          await new Promise((resolve) => setTimeout(resolve, 200));
          armed = warmupIndexed();
        }
      }
      if (!armed) {
        throw new Error(
          `watcher never armed: ${touches} warm-up write(s) over ` +
            `${WRITE_LOCK_TIMEOUT_MS * 3}ms never reached the index.\n` +
            "Repeated writes rule out a lost single event, so this is the " +
            "watcher not running at all — a product problem.\n" +
            `server stderr:\n${stderr || "(empty)"}`,
        );
      }
    }

    // 3. Hold the write lock so the watcher's sync cannot get it.
    const holder = openIndex(nodePath.join(repoRoot, ".livewiki", "index.db"));
    let released = false;
    try {
      holder.exec("BEGIN IMMEDIATE");
      holder.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('lock_probe', '1')").run();

      // 4. ONE filesystem change. This is the only event in the whole test.
      await writeModule("src/appears-after-retry.ts", 7);

      // 5. Let the watcher reach contention. It debounces 1.5s, then waits the
      //    full busy timeout at BEGIN IMMEDIATE before giving up on this try.
      await waitFor(
        () => /watcher sync hit write contention/.test(stderr),
        "watcher to report write contention",
        WRITE_LOCK_TIMEOUT_MS * 4,
        () =>
          `server stderr:
${stderr || "(empty)"}
` +
          "(empty stderr here means the watcher never ran — check whether fs.watch " +
          "degraded to no-watcher on this platform, rather than assuming slowness)",
      );
      // The message must say the work survived, not that a batch was dropped.
      expect(stderr).toMatch(/work stays pending, retrying in \d+ms/);
      expect(indexedPaths()).not.toContain("src/appears-after-retry.ts");

      // 6. Release the lock — and touch NOTHING else. No new event will occur.
      holder.exec("COMMIT");
      released = true;
    } finally {
      if (!released) {
        try {
          holder.exec("ROLLBACK");
        } catch {
          /* already rolled back */
        }
      }
      holder.close();
    }

    // 7. THE POINT: the retry the watcher scheduled for itself is the only
    //    thing that can index this file now. Nothing else will wake it.
    await waitFor(
      () => indexedPaths().includes("src/appears-after-retry.ts"),
      "watcher retry to index the file with no further event",
      WRITE_LOCK_TIMEOUT_MS * 4,
      () => `server stderr:
${stderr || "(empty)"}`,
    );

    // 8. And it converged cleanly.
    const health = dbHealth();
    expect(health.integrity).toContain("ok");
    expect(health.foreignKeyViolations).toBe(0);
    expect(health.duplicatePaths).toBe(0);
    expect(health.orphans).toBe(0);

    // 9. Stop the server, then a manual run must be a fixpoint.
    server.kill();
    await new Promise((resolve) => server?.once("close", resolve));
    server = null;

    const settle = await runIndexer(repoRoot, { quiet: true });
    expect(settle.filesAdded).toBe(0);
    expect(settle.filesUpdated).toBe(0);
    expect(settle.filesDeleted).toBe(0);
  });
  },
);
