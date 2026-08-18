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

/**
 * A ledger file that exists but cannot be interpreted. `raw` holds the bytes
 * when they could be read — null means even the read failed, in which case
 * nothing can be preserved and nothing may be overwritten.
 */
interface LedgerCorruption {
  raw: string | null;
  reason: string;
}

interface MetricsRead {
  file: UpdateMetricsFile;
  /** Null when the file was absent (legitimately no history) or valid. */
  corruption: LedgerCorruption | null;
}

/**
 * Reads the ledger, distinguishing "absent" from "unreadable".
 *
 * Absent is not an error: no file means no history. An unparseable file IS
 * an error, and is reported as such instead of being flattened into an empty
 * ledger — that flattening is what let the next write erase the history.
 */
async function readMetrics(repoRoot: string): Promise<MetricsRead> {
  const absPath = await metricsPath(repoRoot);
  const empty: UpdateMetricsFile = { version: 1, entries: [] };

  let raw: string;
  try {
    raw = await nodeFs.readFile(absPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { file: empty, corruption: null };
    }
    // Present but unreadable: we hold no bytes, so we can neither preserve
    // nor safely replace it.
    return {
      file: empty,
      corruption: { raw: null, reason: `could not be read (${(err as Error).message})` },
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { file: empty, corruption: { raw, reason: `is not valid JSON (${(err as Error).message})` } };
  }
  const candidate = parsed as UpdateMetricsFile;
  if (candidate === null || typeof candidate !== "object" || candidate.version !== 1) {
    return { file: empty, corruption: { raw, reason: "does not declare version 1" } };
  }
  if (!Array.isArray(candidate.entries)) {
    return { file: empty, corruption: { raw, reason: "has no `entries` array" } };
  }
  return { file: candidate, corruption: null };
}

/** Repo-relative path of the backup that preserved a corrupt ledger. */
function backupRelPath(suffix: string): string {
  return `${METRICS_REL_PATH}${suffix}.bak`;
}

/** Bounded search for a free backup name; see `preserveCorruptLedger`. */
const MAX_BACKUP_ATTEMPTS = 100;

/**
 * Copies the unreadable ledger aside before anything replaces it, and says so.
 *
 * Naming policy: `.bak` first, and when that is taken a timestamped
 * `.<epoch-ms>.bak`, then `.<epoch-ms>-<n>.bak`. Each candidate is created
 * with the `wx` flag, so an existing backup is never overwritten — not by this
 * call and not by a concurrent one. An earlier corruption is itself evidence
 * and outranks a newer one.
 *
 * Throws when no backup could be written. The caller MUST treat that as
 * "do not write", because replacing the original is only safe once a copy of
 * it exists.
 */
async function preserveCorruptLedger(
  repoRoot: string,
  corruption: LedgerCorruption,
): Promise<string> {
  if (corruption.raw === null) {
    throw new Error(
      `${METRICS_REL_PATH} ${corruption.reason}; refusing to replace a file whose contents could not be preserved`,
    );
  }
  for (let attempt = 0; attempt < MAX_BACKUP_ATTEMPTS; attempt++) {
    const relPath =
      attempt === 0
        ? backupRelPath("")
        : attempt === 1
          ? backupRelPath(`.${Date.now()}`)
          : backupRelPath(`.${Date.now()}-${attempt}`);
    const abs = await safeIo.resolveAndValidate(repoRoot, relPath);
    try {
      // `wx` fails when the path exists — the guarantee that no prior backup
      // is destroyed.
      const handle = await nodeFs.open(abs, "wx");
      try {
        await handle.writeFile(corruption.raw, "utf8");
      } finally {
        await handle.close();
      }
      // eslint-disable-next-line no-console
      console.warn(
        `[livewiki] update-metrics: ${METRICS_REL_PATH} ${corruption.reason}.\n` +
          `[livewiki] update-metrics: previous contents preserved at ${relPath}.\n` +
          `[livewiki] update-metrics: starting a new ledger; earlier metrics are NOT recovered.`,
      );
      return relPath;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw err;
    }
  }
  throw new Error(
    `${METRICS_REL_PATH} could not be preserved: ${MAX_BACKUP_ATTEMPTS} backup names already taken`,
  );
}

/** Warns that a corrupt ledger was read, on paths that never write. */
function warnCorruptOnRead(corruption: LedgerCorruption): void {
  // eslint-disable-next-line no-console
  console.warn(
    `[livewiki] update-metrics: ${METRICS_REL_PATH} ${corruption.reason}; ` +
      `reporting no history. The file is left untouched until the next write, which preserves it as a .bak.`,
  );
}

/** Persists the file atomically — a torn ledger is the failure being fixed. */
async function writeMetrics(repoRoot: string, file: UpdateMetricsFile): Promise<void> {
  await safeIo.writeTextAtomic(
    repoRoot,
    METRICS_REL_PATH,
    JSON.stringify(file, null, 2) + "\n",
  );
}

/**
 * Appends a metric. Fire-and-forget function — the caller does not need to
 * wait, and an error here must NOT break the main `update` flow.
 *
 * A corrupt ledger is copied to a `.bak` BEFORE the replacement is written. If
 * that copy cannot be made, nothing is written at all: losing one metric is
 * recoverable, losing the history is not.
 */
export async function recordUpdateMetric(
  repoRoot: string,
  metric: UpdateMetric,
): Promise<void> {
  try {
    const { file, corruption } = await readMetrics(repoRoot);
    if (corruption !== null) {
      // Throws when the original could not be preserved — the catch below
      // then leaves the file exactly as it was. Never invents entries from
      // the unreadable content.
      await preserveCorruptLedger(repoRoot, corruption);
    }
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
  const { file, corruption } = await readMetrics(repoRoot);
  // Read-only path: no backup is taken here (nothing is being replaced), but
  // the zeros below must not be mistaken for a repository that never ran.
  if (corruption !== null) warnCorruptOnRead(corruption);
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
    const { file, corruption } = await readMetrics(repoRoot);
    if (corruption !== null) warnCorruptOnRead(corruption);
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