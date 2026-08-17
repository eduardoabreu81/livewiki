/**
 * update-metrics — incremental accounting (SPEC §"Token accounting
 * (Phase 3)", part of `update`).
 *
 * Design decision: a JSON file at `.livewiki/update_metrics.json` instead
 * of a SQLite table. Reasons:
 *   1. Does not touch schema v4 — accounting is incremental, it does not
 *      need SQL's power (queries are "last value" and "sum by type").
 *   2. Rebuildable: deleted .livewiki/? the next `update` starts over from
 *      scratch (SPEC rule #3: the DB is derived; everything important lives
 *      in versioned markdown/manifest — metrics may be lost).
 *   3. Append-only is simpler than managing migrations.
 *
 * Shape of each entry:
 *   { kind, timestamp, ... }
 *
 *   - kind: "package_emitted" — emitted by loadWorkPackage (SPEC §thesis)
 *   - kind: "write_received"  — emitted when the agent/HUMAN returns the
 *     written doc (document-as-you-go skill or CLI after a manual edit)
 *   - kind: "debt_resolved"   — debt paid via MCP/CLI (roadmap item 14)
 *   - kind: "batch_run"       — one batch run's token totals, mirrored from
 *     finalizeRun (roadmap item 14: in-session cost accounting)
 *
 * Backward compat: v1 files containing only the two original kinds keep
 * parsing — the new kinds are additive to the union and to the snapshot.
 *
 * The product thesis ("800 tokens instead of re-reading the repo") lives here:
 * the `packageEmittedTokens / writeReceivedTokens` ratio shows how many
 * lines of code the agent processed for each line of generated doc.
 */

import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";
import * as safeIo from "./safe-io.js";

const METRICS_REL_PATH = ".livewiki/update_metrics.json";

/**
 * Discriminated union — makes the "last package emitted" query and the
 * "total written back" aggregation easy.
 */
export type UpdateMetric =
  | {
      kind: "package_emitted";
      timestamp: number;
      tokensEstimated: number;
      bytes: number;
      debtCount: number;
    }
  | {
      kind: "write_received";
      timestamp: number;
      wikiPath: string;
      bytes: number;
      tokensEstimated: number;
    }
  | {
      kind: "debt_resolved";
      timestamp: number;
      /** How many debt rows were resolved in this call. */
      count: number;
      /** Which surface resolved them. */
      source: "mcp" | "cli";
    }
  | {
      kind: "batch_run";
      timestamp: number;
      runId: number;
      status: "completed" | "completed_with_failures" | "aborted";
      inputTokens: number;
      outputTokens: number;
      costUsd: number | null;
      durationMs: number;
      tasksDone: number;
      tasksFailed: number;
    };

export interface UpdateMetricsFile {
  /** Schema version (for future upgrades). */
  version: 1;
  /** Append-only — newest entries at the end. */
  entries: UpdateMetric[];
}

/** Absolute path of the metrics file inside the repo. */
async function metricsPath(repoRoot: string): Promise<string> {
  return await safeIo.resolveAndValidate(repoRoot, METRICS_REL_PATH);
}

/** Reads the metrics file (or creates an empty one if it does not exist). */
async function readMetrics(repoRoot: string): Promise<UpdateMetricsFile> {
  const absPath = await metricsPath(repoRoot);
  try {
    const raw = await nodeFs.readFile(absPath, "utf8");
    const parsed = JSON.parse(raw) as UpdateMetricsFile;
    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) {
      // Corrupted — start over from scratch (rule #3: everything important is versioned).
      return { version: 1, entries: [] };
    }
    return parsed;
  } catch {
    return { version: 1, entries: [] };
  }
}

/** Persists the file. Idempotent in the sense of "last coherent state". */
async function writeMetrics(repoRoot: string, file: UpdateMetricsFile): Promise<void> {
  await safeIo.writeText(repoRoot, METRICS_REL_PATH, JSON.stringify(file, null, 2) + "\n");
}

/**
 * Appends a metric. Fire-and-forget function — the caller does not need to
 * wait, and an error here must NOT break the main `update` flow.
 */
export async function recordUpdateMetric(
  repoRoot: string,
  metric: UpdateMetric,
): Promise<void> {
  try {
    const file = await readMetrics(repoRoot);
    file.entries.push(metric);
    await writeMetrics(repoRoot, file);
  } catch {
    // best-effort: accounting never blocks the main operation
  }
}

/**
 * Aggregated snapshot of the metrics — used by `status --json` to expose
 * the product thesis. Can be computed in real time (few entries).
 */
export interface UpdateMetricsSnapshot {
  /** Total packages emitted so far. */
  packagesEmitted: number;
  /** Sum of estimated tokens of ALL emitted packages. */
  totalPackageTokens: number;
  /** Total writes received (agent or human) so far. */
  writesReceived: number;
  /** Sum of estimated tokens of ALL received writes. */
  totalWriteTokens: number;
  /** write/package ratio — how "economical" the doc was (proxy). */
  /** < 1.0 = the agent wrote less than it read (good); > 1.0 = wrote more. */
  efficiencyRatio: number | null;
  /** Last metric of each kind (debug). */
  lastPackage: UpdateMetric | null;
  lastWrite: UpdateMetric | null;
  /** Sum of `count` across all `debt_resolved` entries (roadmap item 14). */
  debtResolvedTotal: number;
  /** Number of `batch_run` entries (roadmap item 14). */
  batchRuns: number;
  /** Sum of input/output tokens across all `batch_run` entries. */
  batchInputTokens: number;
  batchOutputTokens: number;
  /** Last 10 ledger entries, oldest first (newest last). */
  recent: UpdateMetric[];
}

export async function snapshotMetrics(repoRoot: string): Promise<UpdateMetricsSnapshot> {
  const file = await readMetrics(repoRoot);
  let packagesEmitted = 0;
  let totalPackageTokens = 0;
  let lastPackage: UpdateMetric | null = null;
  let writesReceived = 0;
  let totalWriteTokens = 0;
  let lastWrite: UpdateMetric | null = null;
  let debtResolvedTotal = 0;
  let batchRuns = 0;
  let batchInputTokens = 0;
  let batchOutputTokens = 0;

  for (const e of file.entries) {
    if (e.kind === "package_emitted") {
      packagesEmitted++;
      totalPackageTokens += e.tokensEstimated;
      lastPackage = e;
    } else if (e.kind === "write_received") {
      writesReceived++;
      totalWriteTokens += e.tokensEstimated;
      lastWrite = e;
    } else if (e.kind === "debt_resolved") {
      debtResolvedTotal += e.count;
    } else if (e.kind === "batch_run") {
      batchRuns++;
      batchInputTokens += e.inputTokens;
      batchOutputTokens += e.outputTokens;
    }
  }

  const efficiencyRatio =
    totalPackageTokens > 0 ? totalWriteTokens / totalPackageTokens : null;

  return {
    packagesEmitted,
    totalPackageTokens,
    writesReceived,
    totalWriteTokens,
    efficiencyRatio,
    lastPackage,
    lastWrite,
    debtResolvedTotal,
    batchRuns,
    batchInputTokens,
    batchOutputTokens,
    recent: file.entries.slice(-10),
  };
}

/**
 * Full ledger history, oldest first. Used by the Phase 7 viewer's Activity
 * page (roadmap item 15), which needs every entry — `snapshotMetrics`
 * exposes aggregates plus only the last 10 (`recent`).
 */
export async function listUpdateMetrics(repoRoot: string): Promise<UpdateMetric[]> {
  try {
    const file = await readMetrics(repoRoot);
    return file.entries;
  } catch {
    // best-effort: accounting never blocks the caller (same posture as
    // recordUpdateMetric — a path/realpath failure means "no history").
    return [];
  }
}

/**
 * Helper exposed for tests: clears the metrics (useful in setup).
 * NEVER call it in production code — destructive.
 */
export async function clearMetricsForTests(repoRoot: string): Promise<void> {
  const absRoot = nodePath.resolve(repoRoot);
  await safeIo.mkdir(absRoot, ".livewiki");
  await writeMetrics(absRoot, { version: 1, entries: [] });
}