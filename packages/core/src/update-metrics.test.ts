/**
 * update-metrics — activity ledger (roadmap item 14).
 *
 * Covers: new event kinds round-trip, snapshot totals, the recent-window
 * ordering, and backward compatibility with a v1 file containing only the
 * two original kinds.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as nodeFs from "node:fs/promises";
import * as nodeOs from "node:os";
import * as nodePath from "node:path";

// Backup creation must be made to fail without touching the filesystem's real
// permissions, which behave differently on Windows. Only `open` on a `.bak`
// path is intercepted, and only while the flag is set.
const injected = vi.hoisted(() => ({ failBackupOpen: false }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    default: actual,
    open: async (path: Parameters<typeof actual.open>[0], ...rest: unknown[]) => {
      if (injected.failBackupOpen && String(path).endsWith(".bak")) {
        const err = new Error("EACCES: permission denied") as NodeJS.ErrnoException;
        err.code = "EACCES";
        throw err;
      }
      return (actual.open as (...args: unknown[]) => unknown)(path, ...rest);
    },
  };
});
import {
  recordUpdateMetric,
  snapshotMetrics,
  listUpdateMetrics,
  clearMetricsForTests,
  type UpdateMetricsFile,
} from "./update-metrics.js";

let repoRoot: string;

beforeEach(async () => {
  repoRoot = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "livewiki-metrics-"));
  await nodeFs.mkdir(nodePath.join(repoRoot, ".livewiki"), { recursive: true });
});

afterEach(async () => {
  await nodeFs.rm(repoRoot, { recursive: true, force: true });
});

async function readLedger(): Promise<UpdateMetricsFile> {
  const raw = await nodeFs.readFile(
    nodePath.join(repoRoot, ".livewiki", "update_metrics.json"),
    "utf8",
  );
  return JSON.parse(raw) as UpdateMetricsFile;
}

/**
 * A ledger that could not be parsed used to read as an empty one, so the next
 * append rewrote the file and the entire history vanished with no trace and
 * no message. These tests pin the rule that replaced it: an unreadable file is
 * copied aside before anything overwrites it, and if it cannot be copied,
 * nothing is written at all.
 */
describe("update-metrics — a corrupt ledger is never silently discarded", () => {
  const LEDGER = nodePath.join(".livewiki", "update_metrics.json");

  function ledgerAbs(): string {
    return nodePath.join(repoRoot, LEDGER);
  }

  async function writeRawLedger(content: string): Promise<void> {
    await nodeFs.writeFile(ledgerAbs(), content, "utf8");
  }

  async function listLivewikiFiles(): Promise<string[]> {
    return (await nodeFs.readdir(nodePath.join(repoRoot, ".livewiki"))).sort();
  }

  const SAMPLE = {
    kind: "write_received",
    timestamp: 1,
    wikiPath: "livewiki/a.md",
    bytes: 10,
    tokensEstimated: 3,
  } as const;

  it("an absent file still means 'no history' and writes a fresh ledger", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await recordUpdateMetric(repoRoot, SAMPLE);

      expect((await readLedger()).entries).toEqual([SAMPLE]);
      // Absent is legitimate: no warning, no backup.
      expect(warn).not.toHaveBeenCalled();
      expect(await listLivewikiFiles()).toEqual(["update_metrics.json"]);
    } finally {
      warn.mockRestore();
    }
  });

  it("a valid file keeps its history and appends normally", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await recordUpdateMetric(repoRoot, SAMPLE);
      await recordUpdateMetric(repoRoot, { ...SAMPLE, timestamp: 2 });

      expect((await readLedger()).entries.map((e) => e.timestamp)).toEqual([1, 2]);
      expect(warn).not.toHaveBeenCalled();
      expect(await listLivewikiFiles()).toEqual(["update_metrics.json"]);
    } finally {
      warn.mockRestore();
    }
  });

  it("invalid JSON is preserved as .bak BEFORE the new ledger is written", async () => {
    const corrupt = '{"version": 1, "entries": [ THIS IS NOT JSON';
    await writeRawLedger(corrupt);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await recordUpdateMetric(repoRoot, SAMPLE);

      const backup = await nodeFs.readFile(`${ledgerAbs()}.bak`, "utf8");
      expect(backup).toBe(corrupt);
    } finally {
      warn.mockRestore();
    }
  });

  it("the new ledger holds only the new metric — nothing invented from the corrupt bytes", async () => {
    await writeRawLedger('{"version": 1, "entries": [ {"kind":"ghost"} ');
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await recordUpdateMetric(repoRoot, SAMPLE);

      const ledger = await readLedger();
      expect(ledger.version).toBe(1);
      expect(ledger.entries).toEqual([SAMPLE]);
    } finally {
      warn.mockRestore();
    }
  });

  it.each([
    ["wrong version", '{"version": 99, "entries": []}'],
    ["entries not an array", '{"version": 1, "entries": {}}'],
    ["a bare JSON array", "[]"],
    ["a JSON scalar", '"nope"'],
    ["empty file", ""],
  ])("treats %s as corrupt rather than empty", async (_label, content) => {
    await writeRawLedger(content);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await recordUpdateMetric(repoRoot, SAMPLE);

      expect(await nodeFs.readFile(`${ledgerAbs()}.bak`, "utf8")).toBe(content);
      expect((await readLedger()).entries).toEqual([SAMPLE]);
    } finally {
      warn.mockRestore();
    }
  });

  it("never destroys an existing .bak — the older evidence wins the name", async () => {
    const firstCorrupt = "first corruption";
    await nodeFs.writeFile(`${ledgerAbs()}.bak`, firstCorrupt, "utf8");
    const secondCorrupt = "second corruption {";
    await writeRawLedger(secondCorrupt);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await recordUpdateMetric(repoRoot, SAMPLE);

      // The original .bak is untouched...
      expect(await nodeFs.readFile(`${ledgerAbs()}.bak`, "utf8")).toBe(firstCorrupt);
      // ...and the new corruption got its own timestamped name.
      const extras = (await listLivewikiFiles()).filter(
        (n) => n.endsWith(".bak") && n !== "update_metrics.json.bak",
      );
      expect(extras).toHaveLength(1);
      expect(
        await nodeFs.readFile(nodePath.join(repoRoot, ".livewiki", extras[0]!), "utf8"),
      ).toBe(secondCorrupt);
    } finally {
      warn.mockRestore();
    }
  });

  it("does NOT overwrite the original when the backup cannot be created", async () => {
    const corrupt = "corrupt but precious {";
    await writeRawLedger(corrupt);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    injected.failBackupOpen = true;
    try {
      await recordUpdateMetric(repoRoot, SAMPLE);

      // The whole point: the unreadable original survives untouched.
      expect(await nodeFs.readFile(ledgerAbs(), "utf8")).toBe(corrupt);
      // And no partial backup was left behind either.
      expect(await listLivewikiFiles()).toEqual(["update_metrics.json"]);
    } finally {
      injected.failBackupOpen = false;
      warn.mockRestore();
    }
  });

  it("keeps the backup as recoverable evidence when the final write fails", async () => {
    const corrupt = "corrupt payload {";
    await writeRawLedger(corrupt);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const safeIo = await import("./safe-io.js");
    const writeSpy = vi.spyOn(safeIo, "writeTextAtomic").mockRejectedValue(
      new Error("disk full"),
    );
    try {
      await recordUpdateMetric(repoRoot, SAMPLE);

      // The new ledger never landed, but the history is not gone: it is in
      // the backup, and the original is still on disk too.
      expect(await nodeFs.readFile(`${ledgerAbs()}.bak`, "utf8")).toBe(corrupt);
      expect(await nodeFs.readFile(ledgerAbs(), "utf8")).toBe(corrupt);
    } finally {
      writeSpy.mockRestore();
      warn.mockRestore();
    }
  });

  it("warns with the file, the backup location, and the fresh-ledger consequence", async () => {
    await writeRawLedger("{ broken");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await recordUpdateMetric(repoRoot, SAMPLE);

      expect(warn).toHaveBeenCalled();
      const message = warn.mock.calls.map((c) => String(c[0])).join("\n");
      expect(message).toContain(".livewiki/update_metrics.json");
      expect(message).toContain(".bak");
      expect(message).toMatch(/new ledger/i);
      expect(message).toMatch(/not recovered/i);
    } finally {
      warn.mockRestore();
    }
  });

  it("read-only paths report no history but say so out loud", async () => {
    await writeRawLedger("{ broken");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const snap = await snapshotMetrics(repoRoot);
      expect(snap.packagesEmitted).toBe(0);
      expect(await listUpdateMetrics(repoRoot)).toEqual([]);

      expect(warn).toHaveBeenCalledTimes(2);
      expect(String(warn.mock.calls[0]?.[0])).toContain("update_metrics.json");
      // A read must not take a backup or mutate anything.
      expect(await nodeFs.readFile(ledgerAbs(), "utf8")).toBe("{ broken");
      expect(await listLivewikiFiles()).toEqual(["update_metrics.json"]);
    } finally {
      warn.mockRestore();
    }
  });
});

describe("update-metrics — activity ledger (roadmap item 14)", () => {
  it("new kinds round-trip through the ledger", async () => {
    await recordUpdateMetric(repoRoot, {
      kind: "debt_resolved",
      timestamp: 1000,
      count: 3,
      source: "mcp",
    });
    await recordUpdateMetric(repoRoot, {
      kind: "batch_run",
      timestamp: 2000,
      runId: 7,
      status: "completed",
      inputTokens: 1000,
      outputTokens: 250,
      costUsd: null,
      durationMs: 1234,
      tasksDone: 4,
      tasksFailed: 0,
    });

    const file = await readLedger();
    expect(file.version).toBe(1);
    expect(file.entries).toEqual([
      { kind: "debt_resolved", timestamp: 1000, count: 3, source: "mcp" },
      {
        kind: "batch_run",
        timestamp: 2000,
        runId: 7,
        status: "completed",
        inputTokens: 1000,
        outputTokens: 250,
        costUsd: null,
        durationMs: 1234,
        tasksDone: 4,
        tasksFailed: 0,
      },
    ]);
  });

  it("snapshot aggregates every kind (totals are additive per kind)", async () => {
    await recordUpdateMetric(repoRoot, {
      kind: "package_emitted",
      timestamp: 1,
      tokensEstimated: 400,
      bytes: 1600,
      debtCount: 2,
    });
    await recordUpdateMetric(repoRoot, {
      kind: "write_received",
      timestamp: 2,
      wikiPath: "livewiki/a.md",
      bytes: 400,
      tokensEstimated: 100,
    });
    await recordUpdateMetric(repoRoot, {
      kind: "debt_resolved",
      timestamp: 3,
      count: 2,
      source: "mcp",
    });
    await recordUpdateMetric(repoRoot, {
      kind: "debt_resolved",
      timestamp: 4,
      count: 3,
      source: "cli",
    });
    await recordUpdateMetric(repoRoot, {
      kind: "batch_run",
      timestamp: 5,
      runId: 1,
      status: "completed",
      inputTokens: 1000,
      outputTokens: 200,
      costUsd: 0.01,
      durationMs: 500,
      tasksDone: 2,
      tasksFailed: 0,
    });
    await recordUpdateMetric(repoRoot, {
      kind: "batch_run",
      timestamp: 6,
      runId: 2,
      status: "aborted",
      inputTokens: 3000,
      outputTokens: 600,
      costUsd: null,
      durationMs: 900,
      tasksDone: 1,
      tasksFailed: 3,
    });

    const snap = await snapshotMetrics(repoRoot);
    expect(snap.packagesEmitted).toBe(1);
    expect(snap.totalPackageTokens).toBe(400);
    expect(snap.writesReceived).toBe(1);
    expect(snap.totalWriteTokens).toBe(100);
    expect(snap.efficiencyRatio).toBeCloseTo(0.25);
    expect(snap.debtResolvedTotal).toBe(5);
    expect(snap.batchRuns).toBe(2);
    expect(snap.batchInputTokens).toBe(4000);
    expect(snap.batchOutputTokens).toBe(800);
  });

  it("recent window keeps the last 10 entries, newest last", async () => {
    for (let i = 1; i <= 12; i++) {
      await recordUpdateMetric(repoRoot, {
        kind: "debt_resolved",
        timestamp: i,
        count: 1,
        source: "mcp",
      });
    }
    const snap = await snapshotMetrics(repoRoot);
    expect(snap.recent).toHaveLength(10);
    // Oldest first, newest last — entries 3..12 survive.
    expect(snap.recent.map((e) => e.timestamp)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(snap.debtResolvedTotal).toBe(12);
  });

  it("backward compat: a v1 file with only the original kinds still parses", async () => {
    // Hand-written legacy ledger — exactly what a pre-item-14 repo holds.
    const legacy: UpdateMetricsFile = {
      version: 1,
      entries: [
        {
          kind: "package_emitted",
          timestamp: 100,
          tokensEstimated: 800,
          bytes: 3200,
          debtCount: 4,
        },
        {
          kind: "write_received",
          timestamp: 200,
          wikiPath: "livewiki/legacy.md",
          bytes: 200,
          tokensEstimated: 50,
        },
      ],
    };
    await nodeFs.writeFile(
      nodePath.join(repoRoot, ".livewiki", "update_metrics.json"),
      JSON.stringify(legacy, null, 2) + "\n",
      "utf8",
    );

    const snap = await snapshotMetrics(repoRoot);
    expect(snap.packagesEmitted).toBe(1);
    expect(snap.totalPackageTokens).toBe(800);
    expect(snap.writesReceived).toBe(1);
    expect(snap.totalWriteTokens).toBe(50);
    expect(snap.efficiencyRatio).toBeCloseTo(50 / 800);
    expect(snap.lastPackage?.kind).toBe("package_emitted");
    expect(snap.lastWrite?.kind).toBe("write_received");
    // New fields are additive: zero on a legacy ledger.
    expect(snap.debtResolvedTotal).toBe(0);
    expect(snap.batchRuns).toBe(0);
    expect(snap.batchInputTokens).toBe(0);
    expect(snap.batchOutputTokens).toBe(0);
    expect(snap.recent).toHaveLength(2);
  });

  it("empty ledger: zeros, null ratio, empty recent", async () => {
    await clearMetricsForTests(repoRoot);
    const snap = await snapshotMetrics(repoRoot);
    expect(snap.packagesEmitted).toBe(0);
    expect(snap.writesReceived).toBe(0);
    expect(snap.efficiencyRatio).toBeNull();
    expect(snap.debtResolvedTotal).toBe(0);
    expect(snap.batchRuns).toBe(0);
    expect(snap.recent).toEqual([]);
  });

  it("listUpdateMetrics returns the FULL history in ledger order (roadmap item 15)", async () => {
    for (let i = 1; i <= 12; i++) {
      await recordUpdateMetric(repoRoot, {
        kind: "debt_resolved",
        timestamp: i,
        count: 1,
        source: "cli",
      });
    }
    const entries = await listUpdateMetrics(repoRoot);
    expect(entries).toHaveLength(12);
    expect(entries.map((e) => e.timestamp)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("listUpdateMetrics degrades to [] without a ledger (never throws)", async () => {
    // Fresh tmp repo: no .livewiki/update_metrics.json at all.
    await nodeFs.rm(nodePath.join(repoRoot, ".livewiki"), { recursive: true, force: true });
    await expect(listUpdateMetrics(repoRoot)).resolves.toEqual([]);
  });
});
