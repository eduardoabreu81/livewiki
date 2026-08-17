/**
 * status — comprehensive report on the state of the wiki + index.
 *
 * Phase 1: indexed files, symbols by kind, breakdown by language,
 *          top-N files with the most symbols.
 * Phase 2: open debt (changed/moved/deleted) by assignee,
 *          undocumented symbols.
 *
 * Human mode: multi-line text.
 * JSON mode: complete object (structured for agents).
 */

import * as nodePath from "node:path";
import * as nodeFs from "node:fs/promises";
import * as safeIo from "./safe-io.js";
import { openIndex, type FileRow, type SymbolRow } from "./db.js";
import { parseFrontmatter } from "./frontmatter.js";
import { snapshotMetrics, type UpdateMetricsSnapshot, type UpdateMetric } from "./update-metrics.js";
import { EXTENSION_LANG } from "./walker.js";
import { applyDefaults, loadConfig, CONFIG_DEFAULTS, type LivewikiConfig } from "./config.js";
import { collectImportsForFiles } from "./imports.js";
import {
  collectGitChurn,
  compareByRisk,
  computeTestCoverageAndFanIn,
  derivePathFromSymbolKey,
  scoreDebtItem,
  type RiskScore,
} from "./risk.js";
import { loadGoModulePath, loadRustCrateName } from "./import-resolution.js";
import { classifyPathRole, type PathRole } from "./modules.js";
import {
  collectBaselineDocumentationInventory,
  evaluateBaseline,
  readBaseline,
  type BaselineIssue,
} from "./baseline.js";

/** Coverage tier of a language (SPEC §"Coverage ladder"). */
export type LangTier = "anchored" | "prose";
export type DebtBaseline = "available" | "unavailable" | "incompatible";

/**
 * Languages whose files have a tree-sitter grammar (tier 1): the values of
 * the walker's EXTENSION_LANG, which is the walker-side projection of the
 * parser's extension→grammar map. Kept import-light on purpose — status must
 * not pull web-tree-sitter into every CLI subprocess just to label tiers.
 */
function anchoredLangs(): ReadonlySet<string> {
  return new Set(Object.values(EXTENSION_LANG));
}

export interface StatusOptions {
  /** How many files to show in the top-N (default 10). */
  topN?: number;
}

export interface DebtItem {
  id: number;
  event: "changed" | "moved" | "deleted";
  assignee: "agent" | "human";
  symbol_key: string | null;
  wiki_path: string | null;
  detail: string | null;
  detected_at: number;
  /**
   * Additive risk metadata (Etapa 2c). Present when risk analysis ran
   * (open debt exists and `riskAnalysis` is not disabled). Consumers
   * reading only the fields above keep working.
   */
  risk?: RiskScore;
}

export interface RepositoryDebtItem {
  event: "changed" | "moved" | "deleted";
  assignee: "agent" | "human";
  symbol_key: string;
  wiki_path: string;
  detail: string | null;
}

export interface BaselineGapItem {
  symbol_key: string;
  wiki_path: string;
  assignee?: "agent" | "human";
}

export interface StatusReport {
  files: {
    total: number;
    byLang: Record<string, number>;
    /**
     * Coverage tier per language (SPEC §"Coverage ladder"): "anchored" when a
     * tree-sitter grammar exists for it, "prose" otherwise. Additive — JSON
     * consumers that only read `byLang` keep working.
     */
    tiers: Record<string, LangTier>;
    top: Array<{ path: string; symbols: number; lang: string }>;
  };
  symbols: {
    total: number;
    byKind: Record<string, number>;
  };
  debt: {
    baseline: DebtBaseline;
    baselineIssues?: BaselineIssue[];
    /** Repository-portable authority. Null means no measurable baseline. */
    repository?: {
      total: number;
      byEvent: { changed: number; moved: number; deleted: number };
      clean: number;
      items: RepositoryDebtItem[];
      unbaselined: { total: number; items: BaselineGapItem[] };
      inferred: { total: number; items: BaselineGapItem[] };
      removedAnchors: { total: number; items: BaselineGapItem[] };
    } | null;
    /** Local SQLite projection retained for backward-compatible debt IDs. */
    total: number;
    byEvent: { changed: number; moved: number; deleted: number };
    byAssignee: { agent: number; human: number };
    items: DebtItem[];
  };
  undocumented: {
    total: number;
    sample: Array<{ symbol_key: string }>;
    /**
     * Additive presentation split by the canonical file-path role. The raw
     * inventory above remains unchanged for existing consumers; empty roles
     * are omitted instead of being emitted as zero-valued placeholders.
     */
    byRole: Partial<
      Record<PathRole, { total: number; sample: Array<{ symbol_key: string }> }>
    >;
  };
  /**
   * Incremental accounting (Phase 5 — SPEC §"Token accounting"):
   * shows how many tokens were emitted in `update` packages and how many
   * were written back. Product thesis: efficiency = write/package.
   * null if there was never an update (initial state).
   */
  metrics: UpdateMetricsSnapshot | null;
  /**
   * Recovery tier (Component 2): pages flagged `quality: degraded` in
   * frontmatter, recounted fresh from disk on every call (verify-style
   * walk — no schema change, never stale). The frontmatter flag is the
   * single source of truth.
   */
  degraded: {
    total: number;
    pages: string[];
  };
  meta: {
    schemaVersion: number;
    lastIndexedAt: number | null;
    lastLedgerAt: number | null;
    /**
     * Index freshness (backlog #3, plan 2026-07-28 item 3.1). Additive and
     * optional — consumers and report literals built before these fields
     * keep working.
     *
     * `snapshotAgeMs`: now − `lastIndexedAt`; null when never indexed.
     * `stale`: any indexed file changed on disk or went missing since the
     * snapshot (see `applyFreshness` for the exact rule).
     * `staleChangedFiles`: how many indexed files triggered `stale`.
     */
    snapshotAgeMs?: number | null;
    stale?: boolean;
    staleChangedFiles?: number;
  };
}

export async function run(
  repoRoot: string,
  opts: StatusOptions = {},
): Promise<StatusReport> {
  const absRoot = nodePath.resolve(repoRoot);
  const dbPathRel = ".livewiki/index.db";
  const dbPath = await safeIo.resolveAndValidate(absRoot, dbPathRel);
  const db = openIndex(dbPath);
  try {
    let config: LivewikiConfig;
    try {
      config = applyDefaults(await loadConfig(absRoot));
    } catch {
      config = applyDefaults({});
    }
    const report = collect(db, opts.topN ?? 10, config);
    await applyVersionedBaseline(db, absRoot, report);
    // Backlog #3: index freshness, bounded by the index itself (stat the
    // indexed files only — never a repo walk).
    await applyFreshness(db, absRoot, report);
    // Etapa 2c: risk-weighted debt ordering (presentation order + additive
    // metadata only). Runs only when open debt exists; recomputes imports
    // on demand, so status on a clean repo never parses files.
    if (report.debt.items.length > 0) {
      await applyRiskRanking(db, absRoot, report, config);
    }
    // Incremental metrics (best-effort — failure here does not break status)
    try {
      report.metrics = await snapshotMetrics(absRoot);
    } catch {
      report.metrics = null;
    }
    // Recovery tier (Component 2): degraded pages, fresh from disk.
    report.degraded = await collectDegradedPages(absRoot);
    return report;
  } finally {
    db.close();
  }
}

interface DebtRow {
  id: number;
  anchor_id: number | null;
  event: string;
  assignee: string;
  detail: string | null;
  detected_at: number;
  symbol_key: string | null;
  wiki_path: string | null;
}

function collect(
  db: import("better-sqlite3").Database,
  topN: number,
  config: LivewikiConfig,
): StatusReport {
  const files = db
    .prepare("SELECT * FROM files WHERE status = 'active'")
    .all() as FileRow[];
  const symbols = db.prepare(
    "SELECT * FROM symbols WHERE status = 'active'",
  ).all() as SymbolRow[];

  const byLang: Record<string, number> = {};
  for (const f of files) byLang[f.lang] = (byLang[f.lang] ?? 0) + 1;

  const anchored = anchoredLangs();
  const tiers: Record<string, LangTier> = {};
  for (const lang of Object.keys(byLang)) {
    tiers[lang] = anchored.has(lang) ? "anchored" : "prose";
  }

  const byKind: Record<string, number> = {};
  for (const s of symbols) byKind[s.kind] = (byKind[s.kind] ?? 0) + 1;

  const symbolsByFile = new Map<number, number>();
  for (const s of symbols) {
    symbolsByFile.set(s.file_id, (symbolsByFile.get(s.file_id) ?? 0) + 1);
  }
  const fileById = new Map(files.map((f) => [f.id, f]));
  const top = [...symbolsByFile.entries()]
    .map(([fileId, count]) => {
      const f = fileById.get(fileId);
      return f ? { path: f.path, symbols: count, lang: f.lang } : null;
    })
    .filter((x): x is { path: string; symbols: number; lang: string } => x !== null)
    .sort((a, b) => b.symbols - a.symbols)
    .slice(0, topN);

  // Debt. Identity comes from the DURABLE debt columns first-classed with
  // the live anchor joins: symbol_key/wiki_path must survive anchor
  // removal (page deleted or anchor edited out) — the LEFT JOINs alone
  // return NULL there, which left CLI and MCP debt rows unactionable
  // (external review 2026-08-03: 24 of 52 open items had null identity).
  const debtRows = db
    .prepare(
      "SELECT d.id, d.anchor_id, d.event, d.assignee, d.detail, d.detected_at, " +
        "COALESCE(a.symbol_key, d.symbol_key) AS symbol_key, " +
        "COALESCE(dp.wiki_path, dp2.wiki_path) AS wiki_path " +
        "FROM debt d LEFT JOIN anchors a ON a.id = d.anchor_id " +
        "LEFT JOIN doc_pages dp ON dp.id = a.doc_page_id " +
        "LEFT JOIN doc_pages dp2 ON dp2.id = d.doc_page_id " +
        "WHERE d.resolved_at IS NULL " +
        "ORDER BY d.detected_at ASC",
    )
    .all() as DebtRow[];

  const debtByEvent = { changed: 0, moved: 0, deleted: 0 };
  const debtByAssignee = { agent: 0, human: 0 };
  const debtItems: DebtItem[] = [];
  for (const r of debtRows) {
    const ev = r.event as "changed" | "moved" | "deleted";
    if (ev in debtByEvent) {
      debtByEvent[ev as keyof typeof debtByEvent]++;
    }
    const asg = r.assignee as "agent" | "human";
    if (asg in debtByAssignee) {
      debtByAssignee[asg as keyof typeof debtByAssignee]++;
    }
    debtItems.push({
      id: r.id,
      event: ev,
      assignee: asg,
      symbol_key: r.symbol_key,
      wiki_path: r.wiki_path,
      detail: r.detail,
      detected_at: r.detected_at,
    });
  }

  // Undocumented
  const undocRows = db
    .prepare("SELECT symbol_key FROM undocumented WHERE dismissed = 0")
    .all() as Array<{ symbol_key: string }>;
  const undocumentedByRole: StatusReport["undocumented"]["byRole"] = {};
  const symbolPathByKey = new Map(
    symbols.flatMap((symbol) => {
      const file = fileById.get(symbol.file_id);
      return file ? [[symbol.key, file.path] as const] : [];
    }),
  );
  for (const row of undocRows) {
    const path = symbolPathByKey.get(row.symbol_key);
    // The ledger rebuilds this inventory from active symbols, so every row has a path here.
    if (path === undefined) continue;
    const role = classifyPathRole(path, config.pathRoles);
    const summary = undocumentedByRole[role] ?? { total: 0, sample: [] };
    summary.total++;
    if (summary.sample.length < 20) summary.sample.push({ symbol_key: row.symbol_key });
    undocumentedByRole[role] = summary;
  }

  const versionRow = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as
    | { value: string }
    | undefined;
  const lastIndexRow = db.prepare("SELECT value FROM meta WHERE key = 'last_indexed_at'").get() as
    | { value: string }
    | undefined;
  const lastLedgerRow = db.prepare("SELECT value FROM meta WHERE key = 'last_ledger_at'").get() as
    | { value: string }
    | undefined;
  return {
    files: { total: files.length, byLang, tiers, top },
    symbols: { total: symbols.length, byKind },
    debt: {
      baseline: "unavailable",
      baselineIssues: [],
      repository: null,
      total: debtRows.length,
      byEvent: debtByEvent,
      byAssignee: debtByAssignee,
      items: debtItems,
    },
    undocumented: {
      total: undocRows.length,
      sample: undocRows.slice(0, 20),
      byRole: undocumentedByRole,
    },
    // metrics is set by run() after collect (requires repoRoot, not db)
    metrics: null,
    // degraded is set by run() after collect (disk walk, not db)
    degraded: { total: 0, pages: [] },
    meta: {
      schemaVersion: versionRow ? Number.parseInt(versionRow.value, 10) : 0,
      lastIndexedAt: lastIndexRow ? Number.parseInt(lastIndexRow.value, 10) : null,
      lastLedgerAt: lastLedgerRow ? Number.parseInt(lastLedgerRow.value, 10) : null,
    },
  };
}

async function applyVersionedBaseline(
  db: import("better-sqlite3").Database,
  absRoot: string,
  report: StatusReport,
): Promise<void> {
  const loaded = await readBaseline(absRoot);
  report.debt.baseline = loaded.state;
  if (loaded.state === "unavailable") return;
  if (loaded.state === "incompatible") {
    report.debt.baselineIssues = loaded.issues;
    return;
  }

  const symbols = db.prepare(
    "SELECT key, name, content_hash FROM symbols WHERE status = 'active'",
  ).all() as Array<{ key: string; name: string; content_hash: string }>;
  const inventory = await collectBaselineDocumentationInventory(absRoot);
  const health = evaluateBaseline(loaded.baseline, symbols, inventory);
  const movesByOldIdentity = new Set(
    health.moves.map((move) => `${move.wikiPath}\0${move.oldKey}`),
  );
  // An entry whose anchor is gone is surfaced exactly once, as a
  // removed-anchor finding — never also as a changed/deleted item.
  const removedIdentities = new Set(
    health.removedAnchors.map((entry) => `${entry.wikiPath}\0${entry.symbolKey}`),
  );
  const items: RepositoryDebtItem[] = [];
  for (const entry of health.entries) {
    if (entry.provenance !== "accepted") continue;
    if (removedIdentities.has(`${entry.wikiPath}\0${entry.symbolKey}`)) continue;
    if (entry.state === "changed") {
      items.push({
        event: "changed",
        assignee: entry.assignee,
        symbol_key: entry.symbolKey,
        wiki_path: entry.wikiPath,
        detail: null,
      });
    } else if (entry.state === "deleted" &&
               !movesByOldIdentity.has(`${entry.wikiPath}\0${entry.symbolKey}`)) {
      items.push({
        event: "deleted",
        assignee: entry.assignee,
        symbol_key: entry.symbolKey,
        wiki_path: entry.wikiPath,
        detail: null,
      });
    }
  }
  for (const move of health.moves) {
    items.push({
      event: "moved",
      assignee: move.assignee,
      symbol_key: move.newKey,
      wiki_path: move.wikiPath,
      detail: JSON.stringify({ from: move.oldKey, to: move.newKey }),
    });
  }
  items.sort((left, right) =>
    compareText(left.wiki_path, right.wiki_path) ||
    compareText(left.symbol_key, right.symbol_key) ||
    compareText(left.event, right.event));

  report.debt.repository = {
    total: items.length,
    byEvent: {
      changed: items.filter((item) => item.event === "changed").length,
      moved: items.filter((item) => item.event === "moved").length,
      deleted: items.filter((item) => item.event === "deleted").length,
    },
    clean: health.counts.clean,
    items,
    unbaselined: {
      total: health.unbaselined.length,
      items: health.unbaselined.map((item) => ({
        symbol_key: item.symbolKey,
        wiki_path: item.wikiPath,
        assignee: item.assignee,
      })),
    },
    inferred: {
      total: health.counts.inferred,
      items: health.entries
        .filter((entry) => entry.state === "inferred")
        .map((entry) => ({ symbol_key: entry.symbolKey, wiki_path: entry.wikiPath })),
    },
    removedAnchors: {
      total: health.removedAnchors.length,
      items: health.removedAnchors.map((entry) => ({
        symbol_key: entry.symbolKey,
        wiki_path: entry.wikiPath,
      })),
    },
  };
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Etapa 2c (docs/plans/2026-07-25-etapa-2c-risk-prioritization.md): ranks
 * open debt by the deterministic risk score (test gap + fan-in + git churn)
 * and attaches the additive `risk` field to each item. Debt identity/dedup
 * is untouched — this is presentation order plus metadata. Config is loaded
 * defensively: a repo without `.livewiki/config.json` (or with an
 * unreadable one) gets the defaults, never an error. Git churn degrades to
 * null when git or a repo is unavailable (churn factor 0).
 */
async function applyRiskRanking(
  db: import("better-sqlite3").Database,
  absRoot: string,
  report: StatusReport,
  config: LivewikiConfig,
): Promise<void> {
  if (config.riskAnalysis === false) return;

  const files = db
    .prepare("SELECT * FROM files WHERE status = 'active'")
    .all() as FileRow[];
  const anchored = anchoredLangs();
  const tierByPath = new Map<string, LangTier>();
  const allPaths: string[] = [];
  const anchoredPaths: string[] = [];
  for (const f of files) {
    const tier: LangTier = anchored.has(f.lang) ? "anchored" : "prose";
    tierByPath.set(f.path, tier);
    allPaths.push(f.path);
    if (tier === "anchored") anchoredPaths.push(f.path);
  }

  // Imports are never persisted: recompute on demand, like batch stage 3.
  // Prose-tier files have no grammar — parsing them would yield no edges,
  // so only anchored files are read.
  const importsByFile = await collectImportsForFiles(absRoot, anchoredPaths);
  const { coveredByTest, fanIn } = computeTestCoverageAndFanIn({
    importsByFile,
    knownFiles: new Set(allPaths),
    goModulePath: await loadGoModulePath(absRoot),
    rustCrateName: await loadRustCrateName(absRoot),
  });

  const churnWindow = config.riskChurnCommits ?? CONFIG_DEFAULTS.riskChurnCommits;
  const churn = churnWindow > 0 ? await collectGitChurn(absRoot, churnWindow) : null;

  for (const item of report.debt.items) {
    const path = derivePathFromSymbolKey(item.symbol_key);
    const tier = path === null ? null : (tierByPath.get(path) ?? null);
    item.risk = scoreDebtItem({
      event: item.event,
      tier,
      coveredByTest: path !== null && coveredByTest.has(path),
      fanIn: path === null ? 0 : (fanIn.get(path) ?? 0),
      churnCount: churn === null || path === null ? null : (churn.get(path) ?? 0),
    });
  }
  report.debt.items.sort(compareByRisk);
}

/**
 * Backlog #3 (docs/plans/2026-07-28-change-impact-and-index-freshness.md,
 * item 3.1): index freshness computed WITHOUT a repo walk — stat the
 * indexed files only, which is bounded by the index itself.
 *
 * Stale rule: the snapshot is stale when any active indexed file is
 * (a) missing on disk, or (b) newer on disk than `last_indexed_at` (i.e.
 * touched after the snapshot was taken). Rule (b) compares against
 * `last_indexed_at` rather than the per-row indexed mtime on purpose: the
 * indexer skips hash-unchanged files without refreshing their row mtime,
 * so a touch-then-reindex cycle would otherwise stay "stale" forever.
 * Files created but never indexed are out of reach of this check by
 * design (detecting them requires a full walk; the MCP watcher covers
 * them via fs events). A repo that was never indexed has no snapshot to
 * be stale: `snapshotAgeMs` is null and `stale` is false.
 */
async function applyFreshness(
  db: import("better-sqlite3").Database,
  absRoot: string,
  report: StatusReport,
): Promise<void> {
  const lastIndexedAt = report.meta.lastIndexedAt;
  report.meta.snapshotAgeMs =
    lastIndexedAt === null ? null : Math.max(0, Date.now() - lastIndexedAt);
  if (lastIndexedAt === null) {
    report.meta.stale = false;
    report.meta.staleChangedFiles = 0;
    return;
  }
  const rows = db
    .prepare("SELECT path FROM files WHERE status = 'active'")
    .all() as Array<{ path: string }>;
  let changed = 0;
  for (const row of rows) {
    const stat = await nodeFs.stat(nodePath.join(absRoot, row.path)).catch(() => null);
    if (stat === null || stat.mtimeMs > lastIndexedAt) changed++;
  }
  report.meta.stale = changed > 0;
  report.meta.staleChangedFiles = changed;
}

/** Compact age for the human stale line: "12s", "5m", "3h", "4d". */
function formatSnapshotAge(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

/** Local-time `YYYY-MM-DD HH:mm` for the Activity block (zero-padded). */
function formatLocalTimestamp(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/** One-line rendering of a ledger entry for the Activity block. */
function formatActivityEvent(e: UpdateMetric): string {
  switch (e.kind) {
    case "package_emitted":
      return `package_emitted ~${e.tokensEstimated} tokens, ${e.debtCount} debt items`;
    case "write_received":
      return `write_received ${e.wikiPath} (~${e.tokensEstimated} tokens)`;
    case "debt_resolved":
      return `debt_resolved ${e.count} item(s) via ${e.source}`;
    case "batch_run":
      return (
        `batch_run #${e.runId} ${e.status}, ` +
        `${e.inputTokens} in / ${e.outputTokens} out, ${formatDuration(e.durationMs)}`
      );
  }
}

/** Wall-clock duration for the Activity block: `45s`, `30m`, `1h12m`. */
function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes < 1) return `${Math.round(ms / 1000)}s`;
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours}h` : `${hours}h${String(minutes).padStart(2, "0")}m`;
}

/**
 * Recovery tier (Component 2): walk the `livewiki/` tree fresh from disk
 * and collect Markdown pages whose frontmatter declares `quality: degraded`.
 * Same walk discipline as verify.ts: hidden DIRECTORIES are never
 * descended, but dot-prefixed PAGES are legit artifacts (tier-2 pages from
 * hidden source dirs, e.g. `livewiki/.github.md`). An unreadable file or
 * unparseable frontmatter is simply not degraded — status never fails
 * because of one.
 */
async function collectDegradedPages(
  absRoot: string,
): Promise<{ total: number; pages: string[] }> {
  const pages: string[] = [];
  const stack = [nodePath.join(absRoot, "livewiki")];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = await nodeFs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const abs = nodePath.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".")) continue;
        stack.push(abs);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        const source = await nodeFs.readFile(abs, "utf8").catch(() => null);
        if (source === null) continue;
        try {
          const { frontmatter } = parseFrontmatter(source);
          if (frontmatter?.["quality"] === "degraded") {
            pages.push(nodePath.relative(absRoot, abs).split(nodePath.sep).join("/"));
          }
        } catch {
          // Unparseable frontmatter — not a degraded page.
        }
      }
    }
  }
  pages.sort();
  return { total: pages.length, pages };
}

/** Format human-readable (text). */
export function formatHuman(report: StatusReport): string {
  const lines: string[] = [];
  lines.push("livewiki status");
  lines.push("==============");
  lines.push("");
  lines.push(`Indexed files: ${report.files.total}`);
  if (Object.keys(report.files.byLang).length > 0) {
    for (const [lang, n] of Object.entries(report.files.byLang).sort()) {
      const tier = report.files.tiers[lang] ?? "prose";
      lines.push(`  ${lang.padEnd(12)} ${`(${tier})`.padEnd(10)} ${n}`);
    }
  }
  lines.push("");
  lines.push(`Extracted symbols (active): ${report.symbols.total}`);
  for (const [kind, n] of Object.entries(report.symbols.byKind).sort()) {
    lines.push(`  ${kind.padEnd(12)} ${n}`);
  }
  lines.push("");
  if (report.files.top.length > 0) {
    lines.push(`Top ${report.files.top.length} files by # symbols:`);
    for (const f of report.files.top) {
      lines.push(`  ${String(f.symbols).padStart(4)}  ${f.path}`);
    }
    lines.push("");
  }
  lines.push(`Documentation baseline: ${report.debt.baseline}`);
  if ((report.debt.baselineIssues ?? []).length > 0) {
    for (const issue of report.debt.baselineIssues ?? []) {
      lines.push(`  [${issue.code}] ${issue.detail}`);
    }
  }
  if (report.debt.repository) {
    lines.push(`Repository debt: ${report.debt.repository.total}`);
    lines.push(
      `  by event:   changed=${report.debt.repository.byEvent.changed} ` +
        `moved=${report.debt.repository.byEvent.moved} ` +
        `deleted=${report.debt.repository.byEvent.deleted}`,
    );
    lines.push(
      `  coverage gaps: unbaselined=${report.debt.repository.unbaselined.total} ` +
        `inferred=${report.debt.repository.inferred.total} ` +
        `removed-anchors=${report.debt.repository.removedAnchors.total}`,
    );
  }
  lines.push(`Local projected debt: ${report.debt.total}`);
  lines.push(
    `  by event:   changed=${report.debt.byEvent.changed} ` +
      `moved=${report.debt.byEvent.moved} deleted=${report.debt.byEvent.deleted}`,
  );
  lines.push(
    `  by assignee: agent=${report.debt.byAssignee.agent} ` +
      `human=${report.debt.byAssignee.human}`,
  );
  for (const item of report.debt.items) {
    const target = item.symbol_key ?? item.wiki_path ?? "(?)";
    const riskMarker = item.risk ? ` [risk ${item.risk.score}]` : "";
    lines.push(`  [${item.event}] ${item.assignee.padEnd(5)} ${target}${riskMarker}`);
    if (item.detail) lines.push(`         ${item.detail}`);
  }
  lines.push("");
  lines.push(`Undocumented: ${report.undocumented.total}`);
  for (const u of report.undocumented.sample) {
    lines.push(`  ${u.symbol_key}`);
  }
  lines.push("");
  if (report.degraded.total > 0) {
    lines.push(`Degraded pages (relaxed contract): ${report.degraded.total}`);
    for (const page of report.degraded.pages) {
      lines.push(`  ${page}`);
    }
    lines.push("");
  }
  // Roadmap item 14: activity ledger summary. Quiet when the ledger is
  // empty (no block at all) — JSON consumers read report.metrics instead.
  if (report.metrics !== null && report.metrics.recent.length > 0) {
    const m = report.metrics;
    lines.push("Activity:");
    lines.push(
      `  ${m.packagesEmitted} packages (${m.totalPackageTokens} tokens), ` +
        `${m.writesReceived} writes (${m.totalWriteTokens} tokens), ` +
        `${m.debtResolvedTotal} debt resolved, ` +
        `${m.batchRuns} batch runs (${m.batchInputTokens} in / ${m.batchOutputTokens} out)`,
    );
    for (const e of m.recent.slice(-5)) {
      lines.push(`  ${formatLocalTimestamp(e.timestamp)} ${formatActivityEvent(e)}`);
    }
    lines.push("");
  }
  if (report.meta.stale === true) {
    lines.push(
      `index is stale (snapshot ${formatSnapshotAge(report.meta.snapshotAgeMs ?? 0)}; ` +
        `${report.meta.staleChangedFiles ?? 0} changed files detected)`,
    );
    lines.push("");
  }
  lines.push(
    `schema_version: ${report.meta.schemaVersion}  |  ` +
      `last_indexed_at: ${
        report.meta.lastIndexedAt ? new Date(report.meta.lastIndexedAt).toISOString() : "never"
      }  |  last_ledger_at: ${
        report.meta.lastLedgerAt ? new Date(report.meta.lastLedgerAt).toISOString() : "never"
      }`,
  );
  return lines.join("\n");
}
