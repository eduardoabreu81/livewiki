/**
 * view-activity — roadmap item 15: Activity dashboard data for the Phase 7
 * viewer.
 *
 * Pure and deterministic: every aggregation and every byte of HTML/SVG is a
 * function of the `update_metrics.json` ledger entries alone. No I/O, no
 * `Date.now()`, no timezone dependence — all timestamps and week buckets
 * are computed in UTC so the same ledger rebuilds byte-identical HTML on
 * any machine (same discipline as the git-log freshness badges).
 *
 * The Activity page is a SYNTHETIC site page built from derived local data
 * (`.livewiki/update_metrics.json`), never a wiki page — the wiki is the
 * versioned truth (rule #3); the dashboard is rebuilt on every `view` run
 * like `search-index.js`. Charts are inline SVG emitted at build time: no
 * chart library, no runtime JS, no CDN (offline-by-construction posture).
 *
 * Dependency direction: `view.ts` imports this module; this module never
 * imports `view.ts`.
 */

import type { UpdateMetric } from "./update-metrics.js";

// ── Model ───────────────────────────────────────────────────────────────────

export interface ActivityTotals {
  batchRuns: number;
  batchInputTokens: number;
  batchOutputTokens: number;
  /** Sum of `costUsd` across batch runs, or null when no run has pricing. */
  batchCostUsd: number | null;
  /** Sum of `durationMs` across batch runs (wall-clock LLM time). */
  batchDurationMs: number;
  /** Estimated in-session tokens: packages read + writes received. */
  sessionTokensEstimated: number;
  debtResolvedTotal: number;
  /** write/package token ratio; null without packages. */
  efficiencyRatio: number | null;
}

export interface ActivityWeek {
  /** UTC Monday of the bucket, `YYYY-MM-DD`. */
  weekStart: string;
  sessionTokens: number;
  batchTokens: number;
}

export interface ActivitySeriesPoint {
  /** Epoch ms. */
  t: number;
  value: number;
}

export interface ActivityPageRow {
  wikiPath: string;
  writes: number;
  tokensEstimated: number;
}

export interface ActivityTimeToDocument {
  samples: number;
  medianHours: number;
  maxHours: number;
}

export interface ActivityModel {
  totals: ActivityTotals;
  /**
   * Median/max hours from debt DETECTION (a `package_emitted` carrying
   * `debtCount > 0`) to PAYMENT (the next `debt_resolved` /
   * `write_received`). The ledger has no code-change timestamp, so this is
   * honestly detection→payment, not change→payment. Null without pairs.
   */
  timeToDocument: ActivityTimeToDocument | null;
  /** Last 12 non-empty UTC weeks, oldest first. */
  weeklyTokens: ActivityWeek[];
  /** Open-debt observations from `package_emitted.debtCount`. */
  openDebtSeries: ActivitySeriesPoint[];
  /** Running total of `debt_resolved.count` over time. */
  cumulativeResolvedSeries: ActivitySeriesPoint[];
  /** Top 10 pages by `write_received` count. */
  topPages: ActivityPageRow[];
  /** Last 10 ledger entries, oldest first (newest last). */
  recent: UpdateMetric[];
}

const MAX_WEEKS = 12;
const MAX_TOP_PAGES = 10;
const MAX_RECENT = 10;

/**
 * Aggregate the full ledger into the dashboard model. Returns null when the
 * ledger is empty — the caller then omits the Activity page entirely
 * (graceful degrade, same posture as the freshness badges).
 */
export function buildActivityModel(entries: UpdateMetric[]): ActivityModel | null {
  if (entries.length === 0) return null;

  let batchRuns = 0;
  let batchInputTokens = 0;
  let batchOutputTokens = 0;
  let batchCostUsd: number | null = null;
  let batchDurationMs = 0;
  let packageTokens = 0;
  let writeTokens = 0;
  let debtResolvedTotal = 0;

  const weeks = new Map<string, { session: number; batch: number }>();
  const openDebtSeries: ActivitySeriesPoint[] = [];
  const cumulativeResolvedSeries: ActivitySeriesPoint[] = [];
  const pageWrites = new Map<string, { writes: number; tokens: number }>();
  const gapsMs: number[] = [];

  let resolvedSoFar = 0;
  // Append-only ledger ⇒ entries are chronological; track the most recent
  // debt-carrying package for the detection→payment pairing.
  let lastDebtPackageTs: number | null = null;

  const weekBucket = (ts: number): { session: number; batch: number } => {
    const key = utcWeekStart(ts);
    const bucket = weeks.get(key) ?? { session: 0, batch: 0 };
    weeks.set(key, bucket);
    return bucket;
  };

  for (const e of entries) {
    if (e.kind === "package_emitted") {
      packageTokens += e.tokensEstimated;
      weekBucket(e.timestamp).session += e.tokensEstimated;
      openDebtSeries.push({ t: e.timestamp, value: e.debtCount });
      if (e.debtCount > 0) lastDebtPackageTs = e.timestamp;
    } else if (e.kind === "write_received") {
      writeTokens += e.tokensEstimated;
      weekBucket(e.timestamp).session += e.tokensEstimated;
      const row = pageWrites.get(e.wikiPath) ?? { writes: 0, tokens: 0 };
      row.writes += 1;
      row.tokens += e.tokensEstimated;
      pageWrites.set(e.wikiPath, row);
      if (lastDebtPackageTs !== null && e.timestamp >= lastDebtPackageTs) {
        gapsMs.push(e.timestamp - lastDebtPackageTs);
      }
    } else if (e.kind === "debt_resolved") {
      debtResolvedTotal += e.count;
      resolvedSoFar += e.count;
      cumulativeResolvedSeries.push({ t: e.timestamp, value: resolvedSoFar });
      if (lastDebtPackageTs !== null && e.timestamp >= lastDebtPackageTs) {
        gapsMs.push(e.timestamp - lastDebtPackageTs);
      }
    } else if (e.kind === "batch_run") {
      batchRuns += 1;
      batchInputTokens += e.inputTokens;
      batchOutputTokens += e.outputTokens;
      batchDurationMs += e.durationMs;
      weekBucket(e.timestamp).batch += e.inputTokens + e.outputTokens;
      if (e.costUsd !== null) batchCostUsd = (batchCostUsd ?? 0) + e.costUsd;
    }
  }

  const weeklyTokens: ActivityWeek[] = [...weeks.entries()]
    .map(([weekStart, b]) => ({ weekStart, sessionTokens: b.session, batchTokens: b.batch }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
    .slice(-MAX_WEEKS);

  const topPages: ActivityPageRow[] = [...pageWrites.entries()]
    .map(([wikiPath, r]) => ({ wikiPath, writes: r.writes, tokensEstimated: r.tokens }))
    .sort(
      (a, b) =>
        b.writes - a.writes ||
        b.tokensEstimated - a.tokensEstimated ||
        a.wikiPath.localeCompare(b.wikiPath),
    )
    .slice(0, MAX_TOP_PAGES);

  let timeToDocument: ActivityTimeToDocument | null = null;
  if (gapsMs.length > 0) {
    const hours = gapsMs.map((ms) => ms / 3_600_000).sort((a, b) => a - b);
    const mid = Math.floor(hours.length / 2);
    const median =
      hours.length % 2 === 1 ? hours[mid]! : (hours[mid - 1]! + hours[mid]!) / 2;
    timeToDocument = {
      samples: hours.length,
      medianHours: round1(median),
      maxHours: round1(hours[hours.length - 1]!),
    };
  }

  return {
    totals: {
      batchRuns,
      batchInputTokens,
      batchOutputTokens,
      batchCostUsd,
      batchDurationMs,
      sessionTokensEstimated: packageTokens + writeTokens,
      debtResolvedTotal,
      efficiencyRatio: packageTokens > 0 ? round1(writeTokens / packageTokens) : null,
    },
    timeToDocument,
    weeklyTokens,
    openDebtSeries,
    cumulativeResolvedSeries,
    topPages,
    recent: entries.slice(-MAX_RECENT),
  };
}

// ── Rendering ───────────────────────────────────────────────────────────────

export interface ActivityPageFragment {
  contentHtml: string;
  /** Section headings, for the offline search index. */
  headings: string[];
  /** Plain-text excerpt, for search snippets and OG meta. */
  excerpt: string;
}

/**
 * Render the dashboard as an HTML fragment (charts are inline SVG; styling
 * hooks are the `.activity-*` classes in LAYOUT_CSS plus the per-palette
 * `--lw-chart-a`/`--lw-chart-b` variables). Deterministic: same model ⇒
 * byte-identical output.
 */
export function renderActivityPage(model: ActivityModel): ActivityPageFragment {
  const parts: string[] = [];
  const headings: string[] = [];
  const section = (title: string): void => {
    headings.push(title);
    parts.push(`<h2>${escapeHtml(title)}</h2>\n`);
  };

  parts.push(`<h1>Activity</h1>\n`);
  parts.push(
    `<p>Documentation activity of this repository, built at site-build time from ` +
      `<code>.livewiki/update_metrics.json</code> (local derived data, never versioned). ` +
      `Times are UTC.</p>\n`,
  );

  // ── Totals ──
  section("Totals");
  const t = model.totals;
  const cards: Array<[string, string]> = [];
  const batchTotal = t.batchInputTokens + t.batchOutputTokens;
  cards.push([
    formatInt(batchTotal),
    `batch tokens (${formatInt(t.batchInputTokens)} in / ${formatInt(t.batchOutputTokens)} out)`,
  ]);
  if (t.batchCostUsd !== null) {
    cards.push([formatUsd(t.batchCostUsd), "batch cost (estimated, dated pricing table)"]);
  }
  if (t.batchRuns > 0) {
    cards.push([formatDuration(t.batchDurationMs), `batch wall time (${t.batchRuns} runs)`]);
  }
  cards.push([formatInt(t.sessionTokensEstimated), "in-session tokens (estimated)"]);
  cards.push([formatInt(t.debtResolvedTotal), "debt items resolved"]);
  cards.push([formatInt(t.batchRuns), "batch runs"]);
  if (t.efficiencyRatio !== null) {
    cards.push([String(t.efficiencyRatio), "write/package token ratio"]);
  }
  if (model.timeToDocument !== null) {
    const ttd = model.timeToDocument;
    cards.push([
      `${ttd.medianHours}h`,
      `median detection→payment (${ttd.samples} samples; max ${ttd.maxHours}h)`,
    ]);
  }
  parts.push(
    `<div class="activity-cards">\n` +
      cards
        .map(
          ([value, label]) =>
            `<div class="activity-card"><span class="activity-value">${escapeHtml(value)}</span>` +
            `<span class="activity-label">${escapeHtml(label)}</span></div>`,
        )
        .join("\n") +
      `\n</div>\n`,
  );

  // ── Tokens per week ──
  const weekMax = Math.max(
    0,
    ...model.weeklyTokens.map((w) => Math.max(w.sessionTokens, w.batchTokens)),
  );
  if (model.weeklyTokens.length > 0 && weekMax > 0) {
    section("Tokens per week");
    parts.push(
      legend([
        ["var(--lw-chart-a, var(--lw-link))", "in-session (estimated)"],
        ["var(--lw-chart-b, var(--lw-muted))", "batch (provider-billed)"],
      ]),
    );
    parts.push(renderWeeklyBarChart(model.weeklyTokens, weekMax));
  }

  // ── Debt burndown ──
  if (model.openDebtSeries.length > 0 || model.cumulativeResolvedSeries.length > 0) {
    section("Debt burndown");
    const series: Array<[string, string]> = [];
    if (model.openDebtSeries.length > 0) {
      series.push(["var(--lw-chart-a, var(--lw-link))", "open debt (observed at package time)"]);
    }
    if (model.cumulativeResolvedSeries.length > 0) {
      series.push(["var(--lw-chart-b, var(--lw-muted))", "cumulative resolved"]);
    }
    parts.push(legend(series));
    parts.push(renderBurndownChart(model.openDebtSeries, model.cumulativeResolvedSeries));
  }

  // ── Writes per page ──
  if (model.topPages.length > 0) {
    section("Writes per page");
    parts.push(
      `<table>\n<thead><tr><th>Page</th><th>Writes</th><th>Tokens (est.)</th></tr></thead>\n<tbody>\n` +
        model.topPages
          .map(
            (p) =>
              `<tr><td><code>${escapeHtml(p.wikiPath)}</code></td>` +
              `<td>${p.writes}</td><td>${formatInt(p.tokensEstimated)}</td></tr>`,
          )
          .join("\n") +
        `\n</tbody>\n</table>\n`,
    );
  }

  // ── Recent activity ──
  if (model.recent.length > 0) {
    section("Recent activity");
    parts.push(
      `<table>\n<thead><tr><th>Time (UTC)</th><th>Event</th></tr></thead>\n<tbody>\n` +
        [...model.recent]
          .reverse()
          .map(
            (e) =>
              `<tr><td>${formatUtc(e.timestamp)}</td>` +
              `<td>${escapeHtml(formatActivityEvent(e))}</td></tr>`,
          )
          .join("\n") +
        `\n</tbody>\n</table>\n`,
    );
  }

  const ttdSentence =
    model.timeToDocument !== null
      ? ` Median detection-to-payment ${model.timeToDocument.medianHours} hours.`
      : "";
  const excerpt =
    `Documentation activity: ${formatInt(batchTotal)} batch tokens, ` +
    `${formatInt(t.sessionTokensEstimated)} in-session tokens (estimated), ` +
    `${t.debtResolvedTotal} debt items resolved across ${t.batchRuns} batch runs.` +
    ttdSentence;

  return { contentHtml: parts.join(""), headings, excerpt };
}

// ── SVG charts (build-time, inline, zero JS) ────────────────────────────────

const CHART_W = 640;
const CHART_H = 240;
const AXIS_LEFT = 48;
const AXIS_BOTTOM = 28;
const AXIS_TOP = 8;

function legend(items: Array<[string, string]>): string {
  return (
    `<p class="activity-legend">` +
    items
      .map(
        ([color, label]) =>
          `<span><span class="activity-swatch" style="background:${color}"></span>${escapeHtml(label)}</span>`,
      )
      .join(" ") +
    `</p>\n`
  );
}

function renderWeeklyBarChart(weeks: ActivityWeek[], max: number): string {
  const plotW = CHART_W - AXIS_LEFT;
  const plotH = CHART_H - AXIS_BOTTOM - AXIS_TOP;
  const groupW = plotW / weeks.length;
  const barW = Math.max(2, Math.floor((groupW * 0.8) / 2));
  const y = (v: number): number => AXIS_TOP + plotH - (v / max) * plotH;

  const parts: string[] = [];
  parts.push(axisFrame(max));
  weeks.forEach((w, i) => {
    const x0 = AXIS_LEFT + i * groupW + (groupW - barW * 2) / 2;
    parts.push(
      `<rect x="${round1(x0)}" y="${round1(y(w.sessionTokens))}" width="${barW}" ` +
        `height="${round1(AXIS_TOP + plotH - y(w.sessionTokens))}" fill="var(--lw-chart-a, var(--lw-link))"/>`,
    );
    parts.push(
      `<rect x="${round1(x0 + barW)}" y="${round1(y(w.batchTokens))}" width="${barW}" ` +
        `height="${round1(AXIS_TOP + plotH - y(w.batchTokens))}" fill="var(--lw-chart-b, var(--lw-muted))"/>`,
    );
    parts.push(
      `<text x="${round1(AXIS_LEFT + i * groupW + groupW / 2)}" y="${CHART_H - 8}" ` +
        `text-anchor="middle" font-size="10" fill="var(--lw-muted)">${w.weekStart.slice(5)}</text>`,
    );
  });
  return svgWrap(parts);
}

function renderBurndownChart(
  open: ActivitySeriesPoint[],
  resolved: ActivitySeriesPoint[],
): string {
  const all = [...open, ...resolved];
  const tMin = Math.min(...all.map((p) => p.t));
  const tMax = Math.max(...all.map((p) => p.t));
  const vMax = Math.max(1, ...all.map((p) => p.value));
  const span = Math.max(tMax - tMin, 3_600_000); // pad a single point to ±30min
  const plotW = CHART_W - AXIS_LEFT;
  const plotH = CHART_H - AXIS_BOTTOM - AXIS_TOP;
  const x = (t: number): number => AXIS_LEFT + ((t - tMin) / span) * plotW;
  const y = (v: number): number => AXIS_TOP + plotH - (v / vMax) * plotH;

  const parts: string[] = [];
  parts.push(axisFrame(vMax));
  // Step line for open-debt observations (value holds until the next one).
  if (open.length > 0) {
    let d = `M ${round1(x(open[0]!.t))} ${round1(y(open[0]!.value))}`;
    for (let i = 1; i < open.length; i++) {
      d += ` H ${round1(x(open[i]!.t))} V ${round1(y(open[i]!.value))}`;
    }
    parts.push(
      `<path d="${d}" fill="none" stroke="var(--lw-chart-a, var(--lw-link))" stroke-width="2"/>`,
    );
  }
  if (resolved.length > 0) {
    let d = `M ${round1(x(resolved[0]!.t))} ${round1(y(resolved[0]!.value))}`;
    for (let i = 1; i < resolved.length; i++) {
      d += ` L ${round1(x(resolved[i]!.t))} ${round1(y(resolved[i]!.value))}`;
    }
    parts.push(
      `<path d="${d}" fill="none" stroke="var(--lw-chart-b, var(--lw-muted))" stroke-width="2"/>`,
    );
  }
  // X extent labels: first/last day (MM-DD).
  parts.push(
    `<text x="${AXIS_LEFT}" y="${CHART_H - 8}" font-size="10" fill="var(--lw-muted)">${utcDay(tMin)}</text>`,
  );
  parts.push(
    `<text x="${CHART_W}" y="${CHART_H - 8}" text-anchor="end" font-size="10" fill="var(--lw-muted)">${utcDay(tMax)}</text>`,
  );
  return svgWrap(parts);
}

/** Y axis: 0 / half / max tick labels + faint mid gridline. */
function axisFrame(max: number): string {
  const plotH = CHART_H - AXIS_BOTTOM - AXIS_TOP;
  const midY = AXIS_TOP + plotH / 2;
  const baseY = AXIS_TOP + plotH;
  return (
    `<line x1="${AXIS_LEFT}" y1="${AXIS_TOP}" x2="${AXIS_LEFT}" y2="${baseY}" stroke="var(--lw-border-strong)"/>` +
    `<line x1="${AXIS_LEFT}" y1="${baseY}" x2="${CHART_W}" y2="${baseY}" stroke="var(--lw-border-strong)"/>` +
    `<line x1="${AXIS_LEFT}" y1="${round1(midY)}" x2="${CHART_W}" y2="${round1(midY)}" stroke="var(--lw-border)"/>` +
    `<text x="${AXIS_LEFT - 6}" y="${baseY + 4}" text-anchor="end" font-size="10" fill="var(--lw-muted)">0</text>` +
    `<text x="${AXIS_LEFT - 6}" y="${round1(midY + 4)}" text-anchor="end" font-size="10" fill="var(--lw-muted)">${formatCompact(max / 2)}</text>` +
    `<text x="${AXIS_LEFT - 6}" y="${AXIS_TOP + 8}" text-anchor="end" font-size="10" fill="var(--lw-muted)">${formatCompact(max)}</text>`
  );
}

function svgWrap(parts: string[]): string {
  return (
    `<svg class="activity-chart" viewBox="0 0 ${CHART_W} ${CHART_H}" width="${CHART_W}" ` +
    `height="${CHART_H}" role="img" xmlns="http://www.w3.org/2000/svg">` +
    parts.join("") +
    `</svg>\n`
  );
}

// ── Small deterministic helpers ─────────────────────────────────────────────

/** UTC Monday (`YYYY-MM-DD`) of the week containing `ts`. */
function utcWeekStart(ts: number): string {
  const d = new Date(ts);
  const daysSinceMonday = (d.getUTCDay() + 6) % 7;
  const monday = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - daysSinceMonday),
  );
  return monday.toISOString().slice(0, 10);
}

function utcDay(ts: number): string {
  return new Date(ts).toISOString().slice(5, 10);
}

/** Local-time-free `YYYY-MM-DD HH:mm` (UTC) — byte-identical on any host. */
function formatUtc(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
  );
}

/** Same one-line event text as the `status` Activity block. */
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

/** Wall-clock duration: `45s`, `30m`, `1h12m` (deterministic, no locale). */
function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes < 1) return `${Math.round(ms / 1000)}s`;
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours}h` : `${hours}h${String(minutes).padStart(2, "0")}m`;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Thousands-separated integer (manual — no ICU/`toLocaleString` variance). */
function formatInt(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Compact axis label: 1.2k / 3.4M (deterministic, no locale). */
function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${round1(n / 1_000_000)}M`;
  if (n >= 1_000) return `${round1(n / 1_000)}k`;
  return String(Math.round(n));
}

function formatUsd(n: number): string {
  const fixed = n.toFixed(2);
  const [intPart, decPart] = fixed.split(".");
  const grouped = intPart!.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `$${grouped}.${decPart}`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
