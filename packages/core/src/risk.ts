/**
 * risk — deterministic risk-weighted debt prioritization (Etapa 2c).
 *
 * Plan: docs/plans/2026-07-25-etapa-2c-risk-prioritization.md (option A,
 * compute-on-the-fly; no schema bump, imports are never persisted).
 *
 * Open debt in `livewiki status` (and, through the same array, in
 * `livewiki update`'s work package) is ranked by a transparent score that
 * combines three signals — all computed without any LLM call:
 *
 *   1. test gap — a file that no test file imports (resolved import edge)
 *      carries more risk when its docs go stale. Test files are classified
 *      by the shared `isTestPath` (flows.ts).
 *   2. fan-in — how many distinct files import the file (file-level edges
 *      via the shared `resolveImportEdges`, import-resolution.ts).
 *   3. git churn — how often the file changed in recent history (one
 *      `git log` spawn; graceful degradation when git is absent or the
 *      directory is not a repo).
 *
 * Ranking never removes obligations — it only orders (mirrors the
 * `prioritizeModules` idiom). Debt identity/dedup is untouched; the JSON
 * change is purely additive (`DebtItem.risk`).
 */

import { spawn } from "node:child_process";
import { isTestPath } from "./flows.js";
import { resolveImportEdges } from "./import-resolution.js";
import type { ExtractedImport } from "./imports.js";
import { normalizeRepoPath } from "./modules.js";

export interface RiskFactors {
  event: number;
  testGap: number;
  fanIn: number;
  churn: number;
}

export interface RiskScore {
  score: number;
  factors: RiskFactors;
}

/**
 * Rubric weights (single source of truth; mirrored in SPEC §"CLI commands").
 * Missing data ⇒ factor 0. Score = sum of factors.
 */
const EVENT_POINTS = { changed: 10, deleted: 10, moved: 5 } as const;
const TEST_GAP_ANCHORED_UNCOVERED = 40;
const TEST_GAP_PROSE = 10;
/** Bands evaluated top-down: [minImporters, maxImporters, points]. */
const FAN_IN_BANDS: ReadonlyArray<readonly [number, number, number]> = [
  [11, Number.POSITIVE_INFINITY, 20],
  [6, 10, 15],
  [3, 5, 10],
  [1, 2, 5],
];
/** Bands evaluated top-down: [minCommits, maxCommits, points]. */
const CHURN_BANDS: ReadonlyArray<readonly [number, number, number]> = [
  [10, Number.POSITIVE_INFINITY, 15],
  [4, 9, 10],
  [1, 3, 5],
];

function bandPoints(bands: ReadonlyArray<readonly [number, number, number]>, value: number): number {
  for (const [min, max, points] of bands) {
    if (value >= min && value <= max) return points;
  }
  return 0;
}

/**
 * Derives the source file path of a debt item from its `symbol_key`
 * (`${relPath}#${name}`, symbols.ts). Returns null when the key is absent
 * or carries no path segment — the item still gets event points, with all
 * file-derived factors at 0.
 */
export function derivePathFromSymbolKey(key: string | null): string | null {
  if (key === null) return null;
  const idx = key.indexOf("#");
  if (idx <= 0) return null;
  return key.slice(0, idx);
}

/**
 * Resolves the per-file import edges (relative specifiers only — workspace
 * packages empty, same strictness as the module graph without a workspace
 * map; relative edges, which carry the signal, resolve identically) and
 * projects them into the two risk signals:
 *
 *   - coveredByTest: files imported by at least one test file (isTestPath).
 *   - fanIn: count of DISTINCT importer files per imported file.
 */
export function computeTestCoverageAndFanIn(opts: {
  importsByFile: Map<string, ExtractedImport[]>;
  knownFiles: ReadonlySet<string>;
}): { coveredByTest: Set<string>; fanIn: Map<string, number> } {
  const edges = resolveImportEdges({
    importsByFile: opts.importsByFile,
    knownFiles: opts.knownFiles,
    workspacePackages: [],
  });
  const coveredByTest = new Set<string>();
  const importersByFile = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (isTestPath(edge.fromFile)) coveredByTest.add(edge.toFile);
    let importers = importersByFile.get(edge.toFile);
    if (!importers) {
      importers = new Set();
      importersByFile.set(edge.toFile, importers);
    }
    importers.add(edge.fromFile);
  }
  const fanIn = new Map<string, number>();
  for (const [toFile, importers] of importersByFile) {
    fanIn.set(toFile, importers.size);
  }
  return { coveredByTest, fanIn };
}

/**
 * Scores one debt item with the rubric above. `tier` is null when the
 * source path is not derivable or the file is no longer indexed (all
 * file-derived factors 0). Prose-tier files always get fan-in 0 (no imports
 * extractable) and a flat test-gap factor (import coverage is not possible).
 */
export function scoreDebtItem(opts: {
  event: "changed" | "moved" | "deleted";
  tier: "anchored" | "prose" | null;
  coveredByTest: boolean;
  fanIn: number;
  churnCount: number | null;
}): RiskScore {
  const event = EVENT_POINTS[opts.event];
  let testGap = 0;
  if (opts.tier === "anchored") {
    testGap = opts.coveredByTest ? 0 : TEST_GAP_ANCHORED_UNCOVERED;
  } else if (opts.tier === "prose") {
    testGap = TEST_GAP_PROSE;
  }
  const fanIn = opts.tier === "anchored" ? bandPoints(FAN_IN_BANDS, opts.fanIn) : 0;
  const churn = opts.churnCount === null ? 0 : bandPoints(CHURN_BANDS, opts.churnCount);
  const factors: RiskFactors = { event, testGap, fanIn, churn };
  return {
    score: factors.event + factors.testGap + factors.fanIn + factors.churn,
    factors,
  };
}

/**
 * Sort comparator: score desc, then detected_at asc, then id asc — stable
 * and deterministic (same input twice ⇒ identical order). Items without a
 * risk score sort as 0.
 */
export function compareByRisk(
  a: { id: number; detected_at: number; risk?: RiskScore },
  b: { id: number; detected_at: number; risk?: RiskScore },
): number {
  const scoreA = a.risk?.score ?? 0;
  const scoreB = b.risk?.score ?? 0;
  if (scoreA !== scoreB) return scoreB - scoreA;
  if (a.detected_at !== b.detected_at) return a.detected_at - b.detected_at;
  return a.id - b.id;
}

/**
 * Parses `git log --no-merges --max-count=N --name-only --format=` output
 * into a per-file commit count. Pure: blank-line tolerant, paths are
 * normalized to repo-relative posix (git already emits forward slashes).
 */
export function parseGitChurnOutput(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "") continue;
    const path = normalizeRepoPath(line);
    counts.set(path, (counts.get(path) ?? 0) + 1);
  }
  return counts;
}

/** Injectable spawn signature (tests substitute a fake; production uses node:child_process.spawn). */
export type SpawnImpl = typeof spawn;

/**
 * Collects per-file churn from recent git history. Runs
 * `git -c core.quotepath=false log --no-merges --max-count=<N> --name-only
 * --format=` with `shell: false` (SPEC §"Stack" subprocess allowance). ANY
 * failure — git missing, not a repo, non-zero exit, spawn throw — returns
 * null, never throws. `maxCommits <= 0` disables the spawn entirely
 * (returns null).
 */
export async function collectGitChurn(
  absRoot: string,
  maxCommits: number,
  spawnImpl: SpawnImpl = spawn,
): Promise<Map<string, number> | null> {
  if (!Number.isInteger(maxCommits) || maxCommits <= 0) return null;
  const text = await runGitLog(absRoot, maxCommits, spawnImpl);
  return text === null ? null : parseGitChurnOutput(text);
}

function runGitLog(
  absRoot: string,
  maxCommits: number,
  spawnImpl: SpawnImpl,
): Promise<string | null> {
  return new Promise((resolve) => {
    let child: ReturnType<SpawnImpl>;
    try {
      child = spawnImpl(
        "git",
        // core.quotepath=false: without it, git C-quotes paths containing
        // non-ASCII bytes ("caf\303\251.ts"), which would never match the
        // indexed file paths and silently zero the churn factor for them.
        ["-c", "core.quotepath=false", "log", "--no-merges", `--max-count=${maxCommits}`, "--name-only", "--format="],
        { cwd: absRoot, shell: false },
      );
    } catch {
      resolve(null);
      return;
    }
    let settled = false;
    const done = (value: string | null): void => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    let out = "";
    child.stdout?.on("data", (chunk: unknown) => {
      out += String(chunk);
    });
    child.on("error", () => done(null));
    child.on("close", (code: number | null) => done(code === 0 ? out : null));
  });
}
