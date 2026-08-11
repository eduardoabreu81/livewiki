/**
 * view-activity — roadmap item 15: Activity dashboard model + rendering.
 *
 * Covers: empty ledger → null (page omitted), totals per kind, UTC week
 * bucketing (+ 12-week cap), burndown series, detection→payment pairing,
 * top-pages ordering, and render determinism/escaping (same model ⇒
 * byte-identical HTML on any host — all timestamps are UTC).
 *
 * Fixed reference points: 2026-01-01 is a Thursday, so 2026-01-05 and
 * 2026-01-12 are UTC Mondays (week-bucket anchors).
 */

import { describe, it, expect } from "vitest";
import { buildActivityModel, renderActivityPage } from "./view-activity.js";
import type { UpdateMetric } from "./update-metrics.js";

const MON = Date.UTC(2026, 0, 5, 10, 0, 0); // Monday 2026-01-05 10:00 UTC
const WED = Date.UTC(2026, 0, 7, 12, 0, 0); // Wednesday, same week
const MON2 = Date.UTC(2026, 0, 12, 9, 0, 0); // Monday 2026-01-12 (next week)
const HOUR = 3_600_000;

function pkg(ts: number, tokensEstimated: number, debtCount: number): UpdateMetric {
  return { kind: "package_emitted", timestamp: ts, tokensEstimated, bytes: 0, debtCount };
}
function write(ts: number, wikiPath: string, tokensEstimated: number): UpdateMetric {
  return { kind: "write_received", timestamp: ts, wikiPath, bytes: 0, tokensEstimated };
}
function resolved(ts: number, count: number): UpdateMetric {
  return { kind: "debt_resolved", timestamp: ts, count, source: "mcp" };
}
function batch(
  ts: number,
  inputTokens: number,
  outputTokens: number,
  costUsd: number | null,
): UpdateMetric {
  return {
    kind: "batch_run",
    timestamp: ts,
    runId: 1,
    status: "completed",
    inputTokens,
    outputTokens,
    costUsd,
    durationMs: 1000,
    tasksDone: 5,
    tasksFailed: 0,
  };
}

describe("view-activity — buildActivityModel", () => {
  it("returns null for an empty ledger (the page is omitted)", () => {
    expect(buildActivityModel([])).toBeNull();
  });

  it("aggregates totals per kind; USD only when pricing exists", () => {
    const model = buildActivityModel([
      pkg(MON, 800, 3),
      write(WED, "livewiki/auth.md", 200),
      resolved(WED, 2),
      batch(MON2, 10_000, 2_000, 1.5),
      batch(MON2 + HOUR, 5_000, 500, null),
    ])!;
    expect(model.totals).toEqual({
      batchRuns: 2,
      batchInputTokens: 15_000,
      batchOutputTokens: 2_500,
      batchCostUsd: 1.5,
      batchDurationMs: 2000,
      sessionTokensEstimated: 1000,
      debtResolvedTotal: 2,
      efficiencyRatio: 0.3, // 200/800, rounded to 1 decimal
    });
  });

  it("keeps batchCostUsd null when no run carries pricing", () => {
    const model = buildActivityModel([batch(MON, 100, 10, null)])!;
    expect(model.totals.batchCostUsd).toBeNull();
  });

  it("buckets tokens into UTC weeks (Monday-anchored), oldest first", () => {
    const model = buildActivityModel([
      pkg(MON, 100, 0),
      write(WED, "livewiki/a.md", 50), // same week as MON
      batch(MON2, 700, 300, null),
    ])!;
    expect(model.weeklyTokens).toEqual([
      { weekStart: "2026-01-05", sessionTokens: 150, batchTokens: 0 },
      { weekStart: "2026-01-12", sessionTokens: 0, batchTokens: 1000 },
    ]);
  });

  it("keeps only the last 12 non-empty weeks", () => {
    const entries: UpdateMetric[] = [];
    for (let i = 0; i < 15; i++) {
      entries.push(pkg(MON + i * 7 * 24 * HOUR, i + 1, 0));
    }
    const model = buildActivityModel(entries)!;
    expect(model.weeklyTokens).toHaveLength(12);
    // Oldest kept week = week index 3 (15 - 12).
    expect(model.weeklyTokens[0]!.sessionTokens).toBe(4);
    expect(model.weeklyTokens[11]!.sessionTokens).toBe(15);
  });

  it("builds the burndown series from debtCount observations + running resolved", () => {
    const model = buildActivityModel([
      pkg(MON, 100, 5),
      resolved(MON + HOUR, 2),
      resolved(MON + 2 * HOUR, 1),
      pkg(WED, 100, 2),
    ])!;
    expect(model.openDebtSeries).toEqual([
      { t: MON, value: 5 },
      { t: WED, value: 2 },
    ]);
    expect(model.cumulativeResolvedSeries).toEqual([
      { t: MON + HOUR, value: 2 },
      { t: MON + 2 * HOUR, value: 3 },
    ]);
  });

  it("pairs payments with the last debt-carrying package (median/max hours)", () => {
    const model = buildActivityModel([
      pkg(MON, 100, 4),
      resolved(MON + 2 * HOUR, 1),
      write(MON + 6 * HOUR, "livewiki/a.md", 50),
    ])!;
    expect(model.timeToDocument).toEqual({ samples: 2, medianHours: 4, maxHours: 6 });
  });

  it("ignores packages without debt and payments before any package", () => {
    const model = buildActivityModel([
      resolved(MON, 1), // no package yet — not a sample
      pkg(MON + HOUR, 100, 0), // debtCount 0 — not a detection
      write(MON + 2 * HOUR, "livewiki/a.md", 50),
    ])!;
    expect(model.timeToDocument).toBeNull();
  });

  it("ranks top pages by writes, then tokens, then path; caps at 10", () => {
    const entries: UpdateMetric[] = [];
    for (let i = 0; i < 12; i++) {
      const path = `livewiki/p${String(i).padStart(2, "0")}.md`;
      entries.push(write(MON, path, 10));
      if (i < 3) entries.push(write(MON + HOUR, path, 10)); // p00..p02 get 2 writes
    }
    const model = buildActivityModel(entries)!;
    expect(model.topPages).toHaveLength(10);
    expect(model.topPages[0]).toEqual({
      wikiPath: "livewiki/p00.md",
      writes: 2,
      tokensEstimated: 20,
    });
    expect(model.topPages[2]!.writes).toBe(2);
    expect(model.topPages[3]!.writes).toBe(1);
  });

  it("exposes the last 10 entries as recent (oldest first)", () => {
    const entries: UpdateMetric[] = [];
    for (let i = 0; i < 12; i++) entries.push(resolved(MON + i * HOUR, 1));
    const model = buildActivityModel(entries)!;
    expect(model.recent).toHaveLength(10);
    expect(model.recent[9]!.timestamp).toBe(MON + 11 * HOUR);
  });
});

describe("view-activity — renderActivityPage", () => {
  const ENTRIES: UpdateMetric[] = [
    pkg(MON, 800, 3),
    write(WED, "livewiki/auth.md", 200),
    resolved(WED, 2),
    batch(MON2, 10_000, 2_000, 1.5),
  ];

  it("is byte-identical for the same model (deterministic render)", () => {
    const model = buildActivityModel(ENTRIES)!;
    const a = renderActivityPage(model);
    const b = renderActivityPage(buildActivityModel(ENTRIES)!);
    expect(a.contentHtml).toBe(b.contentHtml);
    expect(a.excerpt).toBe(b.excerpt);
    expect(a.headings).toEqual(b.headings);
  });

  it("renders every section with UTC timestamps and grouped numbers", () => {
    const { contentHtml, headings, excerpt } = renderActivityPage(
      buildActivityModel(ENTRIES)!,
    );
    expect(contentHtml).toContain("<h1>Activity</h1>");
    expect(headings).toEqual([
      "Totals",
      "Tokens per week",
      "Outdated pages over time",
      "Writes per page",
      "Recent activity",
    ]);
    expect(contentHtml).toContain("12,000"); // batch total grouped
    expect(contentHtml).toContain("$1.50"); // USD secondary estimate
    expect(contentHtml).toContain("time spent in full runs"); // durationMs surfaced
    expect(contentHtml).toContain("2026-01-05 10:00"); // UTC, no local TZ
    expect(contentHtml).toContain("typical time from spotting an outdated page to fixing it");
    expect(contentHtml).toContain('class="activity-chart"'); // inline SVG charts
    expect(contentHtml).not.toContain("<script"); // zero JS
    expect(excerpt).toContain("12,000 tokens used by full runs");
  });

  it("omits the USD card when no run carries pricing", () => {
    const { contentHtml } = renderActivityPage(
      buildActivityModel([batch(MON, 100, 10, null)])!,
    );
    expect(contentHtml).not.toContain("batch cost");
  });

  it("escapes page paths in tables (wiki content is not markup)", () => {
    const { contentHtml } = renderActivityPage(
      buildActivityModel([write(MON, 'livewiki/<script>alert(1)</script>.md', 10)])!,
    );
    expect(contentHtml).not.toContain("<script>alert");
    expect(contentHtml).toContain("&lt;script&gt;");
  });

  it("renders a single-point burndown without crashing (padded time span)", () => {
    const { contentHtml } = renderActivityPage(buildActivityModel([pkg(MON, 100, 7)])!);
    expect(contentHtml).toContain("Outdated pages over time");
    expect(contentHtml).toContain('class="activity-chart"');
  });

  it("skips the weekly chart when all buckets are zero-token", () => {
    const { contentHtml, headings } = renderActivityPage(
      buildActivityModel([resolved(MON, 1)])!,
    );
    expect(headings).not.toContain("Tokens per week");
    expect(contentHtml).toContain("Recent activity");
  });
});
