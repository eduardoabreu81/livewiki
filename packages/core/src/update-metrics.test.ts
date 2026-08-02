/**
 * update-metrics — activity ledger (roadmap item 14).
 *
 * Covers: new event kinds round-trip, snapshot totals, the recent-window
 * ordering, and backward compatibility with a v1 file containing only the
 * two original kinds.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as nodeFs from "node:fs/promises";
import * as nodeOs from "node:os";
import * as nodePath from "node:path";
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
