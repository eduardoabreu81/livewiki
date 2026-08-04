---
title: Viewer build pipeline and Activity dashboard
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
  - packages/core/src/view.ts#DEFAULT_BADGE_DAYS
  - packages/core/src/view.ts#DEFAULT_SITE_REL
  - packages/core/src/view.ts#DEFAULT_TEMPLATE
  - packages/core/src/view.ts#THEME_STORAGE_KEY
  - packages/core/src/view.ts#VIEW_TEMPLATES
  - packages/core/src/view.ts#ViewError
  - packages/core/src/view.ts#ViewError.constructor
  - packages/core/src/view.ts#applyFreshnessBadges
  - packages/core/src/view.ts#badgeSpan
  - packages/core/src/view.ts#buildSearchIndexJs
  - packages/core/src/view.ts#buildSidebar
  - packages/core/src/view.ts#buildSite
  - packages/core/src/view.ts#classifyGroup
  - packages/core/src/view.ts#collectFreshnessLog
  - packages/core/src/view.ts#collectHeadings
  - packages/core/src/view.ts#createDiskWikiSource
  - packages/core/src/view.ts#createGitRefWikiSource
  - packages/core/src/view.ts#createMarkdownRenderer
  - packages/core/src/view.ts#deriveTitle
  - packages/core/src/view.ts#escapeHtml
  - packages/core/src/view.ts#filterWikiArtifactPaths
  - packages/core/src/view.ts#firstStderrLine
  - packages/core/src/view.ts#heading
  - packages/core/src/view.ts#inlineMermaidPlaceholders
  - packages/core/src/view.ts#insertAfterFirstH1
  - packages/core/src/view.ts#listArtifacts
  - packages/core/src/view.ts#normalizeGitHubRemote
  - packages/core/src/view.ts#normalizeRefOption
  - packages/core/src/view.ts#outRelFor
  - packages/core/src/view.ts#parseGitFreshnessLog
  - packages/core/src/view.ts#parseTasksGrouping
  - packages/core/src/view.ts#parseWikiStamp
  - packages/core/src/view.ts#plainTextExcerpt
  - packages/core/src/view.ts#probeGitHubRemoteBase
  - packages/core/src/view.ts#probeWikiStamp
  - packages/core/src/view.ts#read
  - packages/core/src/view.ts#readMermaidAsset
  - packages/core/src/view.ts#relativeHref
  - packages/core/src/view.ts#renderPage
  - packages/core/src/view.ts#renderShell
  - packages/core/src/view.ts#resolveOutDir
  - packages/core/src/view.ts#rewriteLinks
  - packages/core/src/view.ts#rootPrefixFor
  - packages/core/src/view.ts#runGitCaptured
  - packages/core/src/view.ts#runGitLog
  - packages/core/src/view.ts#sourceRefHtml
  - packages/core/src/view.ts#stripControlMarkers
  - packages/core/src/view.ts#uniqueAnchorFilePaths
  - packages/core/src/walker.ts#DENIED_BASENAMES
  - packages/core/src/walker.ts#DENIED_EXTENSIONS
  - packages/core/src/walker.ts#EXTENSION_LANG
  - packages/core/src/walker.ts#buildIgnore
  - packages/core/src/walker.ts#isMinified
  - packages/core/src/walker.ts#walkRepo
---

# Viewer build pipeline and Activity dashboard

The Phase 7 viewer transforms the canonical `livewiki/` wiki into a self-contained static site and adds a synthetic Activity dashboard rendered from the local metrics ledger.

## When to use this page
- **Build** a static site from the working-tree wiki using `buildSite`.
- **Render** a historical site from a git ref (`--ref`) without touching the working tree.
- **Inspect** how the Activity dashboard aggregates the `update_metrics.json` ledger and emits deterministic inline SVG.
- **Audit** the repo walker used by tier-1/tier-2 indexing — its denylists, `.gitignore` composition, and extension-to-language mapping.

## How it fits
This module groups three sibling files under `packages/core/src/`: `walker.ts` (the indexable-file walker used by the symbol indexer), `view.ts` (the Phase 7 static-site builder), and `view-activity.ts` (the pure Activity dashboard renderer). `view.ts` imports `view-activity.ts` and is the only consumer of its `buildActivityModel` / `renderActivityPage` exports; `view-activity.ts` never imports back into `view.ts`. The walker is independent of both viewer files and is consumed by the indexing pipeline that feeds the wiki the viewer renders. Git data flows in through injectable `SpawnImpl` boundaries so every probe (`runGitCaptured`, `runGitLog`, `probeWikiStamp`, `probeGitHubRemoteBase`) is testable without a real `.git`.

## Diagram
```mermaid
%% livewiki/diagrams/core-src-11.mmd
```

## Public surface and templates
<!-- lw:anchors packages/core/src/view.ts#VIEW_TEMPLATES packages/core/src/view.ts#DEFAULT_TEMPLATE packages/core/src/view.ts#DEFAULT_SITE_REL packages/core/src/view.ts#DEFAULT_BADGE_DAYS packages/core/src/view.ts#THEME_STORAGE_KEY packages/core/src/view.ts#ViewError packages/core/src/view.ts#ViewError.constructor -->

The viewer exposes the two supported shells, the default shell/site path, the freshness-badge window, and the persisted-theme key as named exports so the CLI and runtime stay in sync.

```ts
export const VIEW_TEMPLATES = ["agent", "docs"] as const;
export const DEFAULT_TEMPLATE: ViewTemplate = "agent";
export const DEFAULT_SITE_REL = ".livewiki/site";
export const DEFAULT_BADGE_DAYS = 7;
export const THEME_STORAGE_KEY = "livewiki-theme";
```

`ViewError` carries a `code` discriminated by the `ViewErrorCode` union. The constructor body assigns the provided `code` to the readonly `code` field and delegates to the `Error` superconstructor with the message; the `name` property is set to `"ViewError"` so `instanceof` plus `name` distinguish it from generic `Error` throws.

```ts
constructor(code: ViewErrorCode, message: string) {
```

The `invalid_out_dir` branch rejects `--out` paths that are inside `livewiki/`, that contain `livewiki/`, or that equal a filesystem root — the visible check uses `path.relative` in both directions and only fails on a non-`..`-prefixed result, so the rejection is shape-dependent (a path equal to the repo root or to a filesystem root is caught separately).

## Build entry point and output resolution
<!-- lw:anchors packages/core/src/view.ts#buildSite packages/core/src/view.ts#resolveOutDir packages/core/src/view.ts#listArtifacts packages/core/src/view.ts#read packages/core/src/view.ts#createDiskWikiSource packages/core/src/view.ts#createGitRefWikiSource packages/core/src/view.ts#normalizeRefOption packages/core/src/view.ts#filterWikiArtifactPaths packages/core/src/view.ts#runGitCaptured packages/core/src/view.ts#firstStderrLine packages/core/src/view.ts#probeWikiStamp packages/core/src/view.ts#parseWikiStamp packages/core/src/view.ts#probeGitHubRemoteBase packages/core/src/view.ts#normalizeGitHubRemote packages/core/src/view.ts#parseTasksGrouping packages/core/src/view.ts#applyFreshnessBadges packages/core/src/view.ts#collectFreshnessLog packages/core/src/view.ts#runGitLog packages/core/src/view.ts#parseGitFreshnessLog packages/core/src/view.ts#readMermaidAsset packages/core/src/view.ts#renderShell packages/core/src/view.ts#buildSidebar packages/core/src/view.ts#badgeSpan packages/core/src/view.ts#buildSearchIndexJs packages/core/src/view.ts#relativeHref packages/core/src/view.ts#rootPrefixFor packages/core/src/view.ts#escapeHtml packages/core/src/view.ts#rewriteLinks packages/core/src/view.ts#inlineMermaidPlaceholders packages/core/src/view.ts#createMarkdownRenderer packages/core/src/view.ts#heading packages/core/src/view.ts#stripControlMarkers packages/core/src/view.ts#outRelFor packages/core/src/view.ts#classifyGroup packages/core/src/view.ts#deriveTitle packages/core/src/view.ts#renderPage packages/core/src/view.ts#collectHeadings packages/core/src/view.ts#plainTextExcerpt packages/core/src/view.ts#uniqueAnchorFilePaths packages/core/src/view.ts#sourceRefHtml packages/core/src/view.ts#insertAfterFirstH1 -->

`buildSite` orchestrates the whole pipeline: resolve output, choose a wiki source (disk or git ref via `normalizeRefOption`), enumerate artifacts, probe the version stamp and GitHub remote for deep links, read tasks grouping, read every `.mmd` source so pages can sort before the diagrams they reference, render each page, optionally apply freshness badges, append the synthetic Activity page when the ledger is non-empty, wipe and recreate the output directory, then write one HTML document per page plus the four shared assets.

```ts
export async function buildSite(opts: BuildSiteOptions): Promise<BuildSiteResult> {
```

`resolveOutDir` validates the `--out` option: undefined returns the safe-io default; an explicit path is rejected when it sits inside `livewiki/`, when `livewiki/` sits inside it, or when it equals a filesystem root. Git failures degrade silently into `null` for the stamp and remote — `buildSite` only emits deep links when both are present, preserving the offline posture. The `--ref` branch rejects empty or flag-like values via `normalizeRefOption` and surfaces unresolvable refs as a `ViewError` with `code === "invalid_ref"` rather than degrading. `WikiSource.listArtifacts()` returns the canonical artifact set unsorted; `WikiSource.read(wikiPath)` returns the artifact body — `createDiskWikiSource` backs them with `collectWikiArtifactPaths` and `safeIo.readText`, while `createGitRefWikiSource` backs them with `runGitCaptured` over `git ls-tree -r --name-only <ref> -- livewiki/` (filtered through `filterWikiArtifactPaths`) and `git show <ref>:<wikiPath>`. `firstStderrLine` extracts the first non-empty line from a `GitCaptured` result. `probeWikiStamp` runs a single bounded `git log -1 --format=%H%n%cI -- livewiki/` and parses it through `parseWikiStamp`. `probeGitHubRemoteBase` runs `git remote get-url origin` and parses it through `normalizeGitHubRemote`. `parseTasksGrouping` reads the canonical `livewiki/tasks.md` back to learn the implementation-reference grouping rather than re-deriving clusters. `applyFreshnessBadges` consumes the `FreshnessLog` produced by `collectFreshnessLog` (which itself wraps `runGitLog` over the bounded `FRESHNESS_LOG_MAX_COMMITS` window and parses the output with `parseGitFreshnessLog`) and stamps each page with `new` / `updated` against `DEFAULT_BADGE_DAYS`. `readMermaidAsset` vendors `node_modules/mermaid/dist/mermaid.min.js` for the offline posture — failure surfaces as `ViewError("missing_mermaid_asset", …)`. `renderShell` wraps each page fragment in the template chrome; `buildSidebar` produces the navigation from the full page set with the active item marked; `badgeSpan` renders the per-page freshness pill; `buildSearchIndexJs` emits the offline `window.SEARCH_INDEX = [...]` blob. `relativeHref` and `rootPrefixFor` compute the link paths between sibling pages and the site root. `escapeHtml` is the shared HTML escaper reused by every fragment. `rewriteLinks` rewrites internal `.md` / `.mmd` references to `.html` with the same relative resolution as verify, and `inlineMermaidPlaceholders` resolves `%% livewiki/<path>.mmd` placeholders into inline Mermaid blocks using the pre-read `mmdSources` map. `createMarkdownRenderer` builds the `Marked` instance; the `heading` override is what strips livewiki control markers from headings; `stripControlMarkers` removes livewiki nav markers and `<!-- livewiki:... -->` tags from the rest of the body. `outRelFor` converts a wiki path into its `pages/...` output path; `classifyGroup` assigns the sidebar group from the wiki path; `deriveTitle` falls back from frontmatter to the first H1 to the file stem. `renderPage` orchestrates a single page (Markdown → HTML, link rewriting, mermaid inlining, deep-link annotation) and is what `buildSite` calls once per wiki artifact. `collectHeadings` extracts the heading list for the search index; `plainTextExcerpt` builds the OG/search snippet. `uniqueAnchorFilePaths` dedupes anchor paths before they reach `sourceRefHtml`, which then renders the per-page `Sources:` deep-link line. `insertAfterFirstH1` injects the deep-link line below the page title.

## Repo walker
<!-- lw:anchors packages/core/src/walker.ts#EXTENSION_LANG packages/core/src/walker.ts#DENIED_EXTENSIONS packages/core/src/walker.ts#DENIED_BASENAMES packages/core/src/walker.ts#isMinified packages/core/src/walker.ts#buildIgnore packages/core/src/walker.ts#walkRepo -->

The walker is a denylist-based scanner: every text file under the repo root is visited; archives, binaries, media, fonts, source maps, minified bundles, denylisted lockfiles, and extensionless files are skipped before the language name is computed.

```ts
export async function walkRepo(
  repoRoot: string,
  opts: WalkOptions = {},
): Promise<WalkResult[]>
```

`EXTENSION_LANG` maps grammar-supported extensions to their tree-sitter language name; any other recognized extension resolves to its lowercase extension with the leading dot stripped (tier-2 prose). `DENIED_EXTENSIONS` covers archives, binaries, media, fonts, and `.map`; `DENIED_BASENAMES` covers lockfiles compared case-insensitively by full filename; `isMinified` flags `*.min.js` and `*.min.css`. `buildIgnore` composes `.gitignore` content (if readable) with the always-on defaults `.git/`, `node_modules/`, `.livewiki/`, `livewiki/`, `dist/`, `coverage/` and any `opts.extraIgnores`, then `walkRepo` walks a directory stack — a missing or unreadable directory is logged and skipped, never thrown.

## Activity model aggregation
<!-- lw:anchors packages/core/src/view-activity.ts#buildActivityModel packages/core/src/view-activity.ts#utcWeekStart packages/core/src/view-activity.ts#utcDay packages/core/src/view-activity.ts#formatUtc packages/core/src/view-activity.ts#formatActivityEvent packages/core/src/view-activity.ts#formatDuration packages/core/src/view-activity.ts#round1 packages/core/src/view-activity.ts#formatInt packages/core/src/view-activity.ts#formatCompact packages/core/src/view-activity.ts#formatUsd packages/core/src/view-activity.ts#escapeHtml -->

The Activity model is a pure function of the ledger — no `Date.now()`, no I/O, no timezone dependence — so the same ledger rebuilds byte-identical HTML on any host.

```ts
export function buildActivityModel(entries: UpdateMetric[]): ActivityModel | null {
```

An empty ledger returns `null` and the caller omits the Activity page entirely (graceful degrade). Across `package_emitted`, `write_received`, `debt_resolved`, and `batch_run` entries, the aggregator computes totals (with `batchCostUsd` summing only over runs that carry pricing and `efficiencyRatio` returning `null` when no packages exist), bucketed `weeklyTokens` (last 12 non-empty UTC weeks, oldest first), the open-debt and cumulative-resolved series, the top-10 pages by writes (ties broken by token count, then path), the last 10 entries as the recent feed, and a `timeToDocument` measurement that pairs the most recent debt-carrying package timestamp with the next write or resolution — `null` when no pair exists. Week buckets and time labels go through `utcWeekStart`, `utcDay`, and `formatUtc`, which all derive from `Date.UTC(...)` and ISO slicing to stay host-independent. `formatActivityEvent` renders the one-line event text for each `UpdateMetric` kind. `formatDuration` formats milliseconds as a human-readable duration, `round1` rounds a number to one decimal place, `formatInt` formats an integer with thousands separators, `formatCompact` formats a number in a compact form for axis labels, `formatUsd` formats a USD amount, and `escapeHtml` is the shared escaper used inside the SVG/HTML fragments.

## Activity page rendering
<!-- lw:anchors packages/core/src/view-activity.ts#renderActivityPage packages/core/src/view-activity.ts#legend packages/core/src/view-activity.ts#renderWeeklyBarChart packages/core/src/view-activity.ts#renderBurndownChart packages/core/src/view-activity.ts#axisFrame packages/core/src/view-activity.ts#svgWrap -->

`renderActivityPage` emits the dashboard as an HTML fragment: a Totals card grid, a Tokens-per-week grouped bar chart, a Debt-burndown dual-series line chart, a Writes-per-page table, and a Recent-activity table — each section heading is captured for the offline search index, and a single excerpt string feeds search snippets and OG meta.

```ts
export function renderActivityPage(model: ActivityModel): ActivityPageFragment {
```

Charts are inline SVG built at build time — `legend` writes the color-keyed swatches, `renderWeeklyBarChart` paints two bars per week (session vs. batch) against an axis frame, `renderBurndownChart` draws the open-debt step line plus the cumulative-resolved line on the same axes, `axisFrame` provides the 0 / half / max tick labels and a faint mid gridline, and `svgWrap` wraps everything in a `viewBox` SVG with `role="img"` and the XHTML namespace. Each chart is gated on non-empty data: the weekly bars skip when the week list is empty or `weekMax` is zero, the burndown skips when both series are empty, and the tables skip when their rows would be empty.

<!-- livewiki:navigate:start -->
## Navigate

- [core indexing, imports, flows, and frontmatter](core-src-04.md) — dependency and dependent
- [Safe I/O, section guarding, status reporting, and symbol extraction](core-src-09.md) — dependency and dependent
- [Stage 4 artifact normalization, validation, and auxiliary page assembly](core-src-01.md) — dependency

> Coverage note: this module's source (3 files, ~94k chars) exceeded the prompt budget and was excerpted; this page documents the closed-list symbols.
<!-- livewiki:navigate:end -->
