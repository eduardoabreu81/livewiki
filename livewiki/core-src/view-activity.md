---
title: Activity dashboard aggregation and rendering
owner: generated
anchors:
  - packages/core/src/view-activity.ts#axisFrame
  - packages/core/src/view-activity.ts#buildActivityModel
  - packages/core/src/view-activity.ts#escapeHtml
  - packages/core/src/view-activity.ts#formatActivityEvent
  - packages/core/src/view-activity.ts#formatCompact
  - packages/core/src/view-activity.ts#formatDuration
  - packages/core/src/view-activity.ts#formatInt
  - packages/core/src/view-activity.ts#formatUsd
  - packages/core/src/view-activity.ts#formatUtc
  - packages/core/src/view-activity.ts#legend
  - packages/core/src/view-activity.ts#renderActivityPage
  - packages/core/src/view-activity.ts#renderBurndownChart
  - packages/core/src/view-activity.ts#renderWeeklyBarChart
  - packages/core/src/view-activity.ts#round1
  - packages/core/src/view-activity.ts#svgWrap
  - packages/core/src/view-activity.ts#utcDay
  - packages/core/src/view-activity.ts#utcWeekStart
---

# Activity dashboard aggregation and rendering

This module turns the local activity ledger into a deterministic dashboard model and renders it as an HTML fragment with inline SVG charts.

## When to use this page

- **Read** this page to understand how the Activity dashboard is computed and rendered from the local `.livewiki/update_metrics.json` ledger.
- **Extend** the dashboard by locating the aggregation, rendering, chart, and display-helper responsibilities.
- **Debug** determinism issues involving UTC time, stable formatting, or generated HTML.
- **Confirm** the dependency direction between the viewer and the Activity module.

## How it fits

`packages/core/src/view-activity.ts` belongs to the `packages/core/src/` viewer layer. The viewer imports this module to build and display a synthetic Activity page; this module does not import the viewer or read the ledger itself.

The module receives `UpdateMetric` entries and produces the data needed by the viewer: `buildActivityModel` creates an `ActivityModel`, and `renderActivityPage` converts that model into `ActivityPageFragment`. The renderer and chart builders are pure functions, so the same input data produces the same generated output.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-view-activity.mmd
```

## Aggregation

<!-- lw:anchors packages/core/src/view-activity.ts#buildActivityModel packages/core/src/view-activity.ts#formatActivityEvent packages/core/src/view-activity.ts#utcWeekStart packages/core/src/view-activity.ts#utcDay packages/core/src/view-activity.ts#round1 -->

The aggregation step exists so the dashboard can consume a stable typed summary instead of repeatedly interpreting raw ledger entries. It reduces the ledger in one pass, classifies each event, accumulates totals and series, and trims bounded result sets.

`buildActivityModel` first returns `null` for an empty ledger, allowing the caller to omit the page. For non-empty input, it:

1. Sums package and write tokens, batch input/output tokens, batch duration, priced costs, and resolved-debt counts.
2. Groups activity by UTC week using `utcWeekStart`; it keeps the last 12 non-empty weeks, oldest first.
3. Records observed open-debt values and a running resolved-debt total.
4. Ranks pages by writes, then estimated tokens, then path, and keeps the top 10.
5. Measures detection-to-payment gaps when a later write or resolution follows a debt-carrying package; the reported interval is not a code-change timestamp.
6. Returns the last 10 ledger entries, ordered by their source order.

`formatActivityEvent` also belongs to this flow because it turns each raw event into human-readable display text rather than exposing the ledger enum names directly. `utcDay` supplies the first and last day labels used by the burndown chart. `round1` normalizes calculated hours, chart coordinates, and compact values.

The visible code has one early return for an empty ledger. Other event kinds are handled by the corresponding branches; `buildActivityModel` does not claim fallback behavior for unhandled event kinds.

```ts
export function buildActivityModel(entries: UpdateMetric[]): ActivityModel | null
```

`buildActivityModel` takes an array of `UpdateMetric` ledger entries and returns an `ActivityModel` summary, or `null` when the ledger is empty.

```ts
function formatActivityEvent(e: UpdateMetric): string
```

`formatActivityEvent` takes one ledger entry and returns a single human-readable sentence describing the event.

```ts
function utcWeekStart(ts: number): string
```

`utcWeekStart` takes an epoch-millisecond timestamp and returns the UTC Monday of the containing week as `YYYY-MM-DD`.

```ts
function utcDay(ts: number): string
```

`utcDay` takes an epoch-millisecond timestamp and returns the `MM-DD` portion of its UTC date.

```ts
function round1(n: number): number
```

`round1` takes a number and returns the same value rounded to one decimal place.

## Rendering

<!-- lw:anchors packages/core/src/view-activity.ts#renderActivityPage packages/core/src/view-activity.ts#legend packages/core/src/view-activity.ts#escapeHtml packages/core/src/view-activity.ts#formatUtc -->

The rendering step exists to turn the model into HTML that the viewer can embed, while also producing headings and a plain-text excerpt for search and metadata. It emits an Activity heading, a data-source note, conditional summary sections, tables, and inline charts.

`renderActivityPage` builds an `ActivityPageFragment` in this order:

1. Starts the content with the Activity heading and explains that the dashboard is derived from local activity data and displayed in UTC.
2. Adds total cards, including batch tokens, optional cost, optional duration, session tokens, resolved items, and the optional detection-to-payment statistic.
3. Adds the weekly-token chart only when at least one week has a value above zero.
4. Adds the outdated-pages chart when either the open-debt or cumulative-resolved series exists.
5. Adds the top-pages table and the recent-activity table when their model arrays are non-empty.
6. Escapes dynamic labels and page paths, formats timestamps and events, and constructs the excerpt from the same totals used by the page.

The local `legend` function serializes color-token and label pairs into the Activity legend. Dynamic strings are passed through `escapeHtml`; the source shows no fallback path for escaping or rendering failures. `formatUtc` produces the `YYYY-MM-DD HH:mm` UTC string used for each row in the recent-activity table.

```ts
export function renderActivityPage(model: ActivityModel): ActivityPageFragment
```

`renderActivityPage` takes a fully built `ActivityModel` and returns an `ActivityPageFragment` containing the HTML content, a list of section headings, and a plain-text excerpt.

```ts
function legend(items: Array<[string, string]>): string
```

`legend` takes an array of pairs — a color token and its label — and returns the rendered legend HTML.

```ts
function escapeHtml(text: string): string
```

`escapeHtml` takes a string and returns it with the four characters `&`, `<`, `>`, and `"` replaced by their HTML entity equivalents.

```ts
function formatUtc(ts: number): string
```

`formatUtc` takes an epoch-millisecond timestamp and returns a UTC `YYYY-MM-DD HH:mm` string formatted with zero-padded fields.

## Charts

<!-- lw:anchors packages/core/src/view-activity.ts#renderWeeklyBarChart packages/core/src/view-activity.ts#renderBurndownChart packages/core/src/view-activity.ts#axisFrame packages/core/src/view-activity.ts#svgWrap -->

The chart step exists to present weekly and historical activity without runtime JavaScript, a chart library, or network resources. Each renderer uses a fixed SVG coordinate system and emits markup directly at build time.

`renderWeeklyBarChart` calculates the maximum weekly session or batch value, reserves axis margins, and draws two bars per week: editor-session tokens and batch tokens. It computes bar width from the available group width and clamps the bar width to a minimum of 2 pixels; it does not impose an upper bound. `axisFrame` supplies the left axis, baseline, midpoint gridline, and 0, half-max, and max labels. `svgWrap` encloses the fragments in a fixed `640 × 240` viewBox.

`renderBurndownChart` combines the open and resolved series to establish the time and value ranges. It sets the vertical maximum to at least 1 and the time span to at least one hour, providing a usable scale when all values are zero or only one timestamp is present. The open-debt observations form a step path, while resolved observations form a straight line path. The first and last timestamps are formatted as `MM-DD` by `utcDay`.

```ts
function renderWeeklyBarChart(weeks: ActivityWeek[], max: number): string
```

`renderWeeklyBarChart` takes an array of weekly buckets and the maximum value used for the y-axis, and returns the SVG markup for the grouped bar chart.

```ts
function renderBurndownChart(
  open: ActivitySeriesPoint[],
  resolved: ActivitySeriesPoint[],
): string
```

`renderBurndownChart` takes the open-debt observations and the cumulative-resolved series, and returns the SVG markup for the burndown chart.

```ts
function axisFrame(max: number): string
```

`axisFrame` takes the maximum value used for the y-axis and returns the SVG fragments for the left axis, baseline, midpoint gridline, and the three tick labels.

```ts
function svgWrap(parts: string[]): string
```

`svgWrap` takes an array of SVG fragment strings and returns them wrapped in the fixed `640 × 240` `activity-chart` SVG element.

## Display helpers

<!-- lw:anchors packages/core/src/view-activity.ts#formatDuration packages/core/src/view-activity.ts#formatCompact packages/core/src/view-activity.ts#formatInt packages/core/src/view-activity.ts#formatUsd -->

The display-helper step exists so generated values remain readable and stable across machines. It handles compact values, durations, integers, and currency without locale-sensitive formatting.

`formatDuration` converts milliseconds into `45s`, `30m`, or `1h12m` forms. It floors to whole minutes for the minute and hour branches, rounds sub-minute values to seconds, and omits zero minutes from the hour-only form.

`formatCompact` selects `M` for values at or above one million, `k` for values at or above one thousand, and a rounded integer below one thousand. It applies `round1` to scaled values.

`formatInt` inserts thousands separators into a rounded integer using a manual regex rather than `toLocaleString`, keeping the output stable across hosts. `formatUsd` formats a number as a US dollar amount with two decimal places and a thousands separator on the integer portion.

```ts
function formatDuration(ms: number): string
```

`formatDuration` takes a duration in milliseconds and returns a human-readable duration string in seconds, minutes, or hours-and-minutes form.

```ts
function formatCompact(n: number): string
```

`formatCompact` takes a numeric value and returns a compact axis label using `k` or `M` suffixes.

```ts
function formatInt(n: number): string
```

`formatInt` takes a number and returns the same value rounded to an integer with a thousands separator.

```ts
function formatUsd(n: number): string
```

`formatUsd` takes a number and returns a US dollar amount with two decimal places and a thousands separator.

## Tests

Covered by `packages/core/src/view-activity.test.ts` (same-name test file on disk).
