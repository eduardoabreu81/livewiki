---
title: Static site builder, walker, and Activity dashboard
owner: generated
anchors:
  - packages/core/src/view-activity.ts#axisFrame
  - packages/core/src/view-activity.ts#buildActivityModel
  - packages/core/src/view-activity.ts#escapeHtml
  - packages/core/src/view-activity.ts#formatActivityEvent
  - packages/core/src/view-activity.ts#formatCompact
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
  - packages/core/src/view.test.ts#extractMain
  - packages/core/src/view.test.ts#fakeSpawnError
  - packages/core/src/view.test.ts#fakeSpawnOk
  - packages/core/src/view.test.ts#gitLogOutput
  - packages/core/src/view.test.ts#parseSearchIndex
  - packages/core/src/view.test.ts#readSite
  - packages/core/src/view.test.ts#siteFileExists
  - packages/core/src/view.test.ts#writeFixtureWiki
  - packages/core/src/view.test.ts#writeWiki
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
  - packages/core/src/view.ts#createMarkdownRenderer
  - packages/core/src/view.ts#deriveTitle
  - packages/core/src/view.ts#escapeHtml
  - packages/core/src/view.ts#heading
  - packages/core/src/view.ts#inlineMermaidPlaceholders
  - packages/core/src/view.ts#outRelFor
  - packages/core/src/view.ts#parseGitFreshnessLog
  - packages/core/src/view.ts#parseTasksGrouping
  - packages/core/src/view.ts#plainTextExcerpt
  - packages/core/src/view.ts#readMermaidAsset
  - packages/core/src/view.ts#relativeHref
  - packages/core/src/view.ts#renderPage
  - packages/core/src/view.ts#renderShell
  - packages/core/src/view.ts#resolveOutDir
  - packages/core/src/view.ts#rewriteLinks
  - packages/core/src/view.ts#rootPrefixFor
  - packages/core/src/view.ts#runGitLog
  - packages/core/src/view.ts#stripControlMarkers
  - packages/core/src/walker.test.ts#write
  - packages/core/src/walker.ts#DENIED_BASENAMES
  - packages/core/src/walker.ts#DENIED_EXTENSIONS
  - packages/core/src/walker.ts#EXTENSION_LANG
  - packages/core/src/walker.ts#buildIgnore
  - packages/core/src/walker.ts#isMinified
  - packages/core/src/walker.ts#walkRepo
---

# Static site builder, walker, and Activity dashboard

This module turns the canonical `livewiki/` wiki on disk into a self-contained static site, walks the repository for indexing, and synthesizes a deterministic Activity dashboard from the local metrics ledger.

## When to use this page

- **Build** the Phase 7 viewer (`buildSite`) and understand how Markdown, mermaid, sidebar, search index, and freshness badges fit together.
- **Walk** a repository (`walkRepo`) for indexable files while honoring `.gitignore`, default denylists, and `extraIgnores`.
- **Render** the Activity dashboard (`buildActivityModel` + `renderActivityPage`) from `.livewiki/update_metrics.json` as inline SVG, and inspect its UTC-bucketed aggregations and formatters.
- **Diagnose** test fixtures, fake spawns, and shell-extraction helpers used to cover the builder end-to-end.

## How it fits

The five files under `packages/core/src/` belong to the `core` package and split cleanly along responsibility lines: `walker.ts` enumerates files in the host repository and is consumed by the indexer (`verify`-adjacent code); `view.ts` is the Phase 7 static-site builder that reads the canonical `livewiki/` tree, renders Markdown to HTML at build time, vendors Mermaid locally, and emits a search index — it pulls in `view-activity.ts` to append a synthetic Activity page derived from the local update-metrics ledger. The two `*.test.ts` files sit alongside their production counterparts: `view.test.ts` mounts a fixture wiki on a tmp repo and substitutes a fake `spawn` to drive the git-log freshness probe, while `walker.test.ts` exercises the walker against tmp directories, default denylists, `.gitignore`, and extra ignore patterns. There is no I/O or `Date.now()` inside `view-activity.ts`; it is a pure function of the ledger entries and emits byte-identical HTML for the same input.

## Activity model aggregation

`buildActivityModel` is the dashboard's aggregation entry point. It walks the append-only ledger, accumulates batch/session token totals, partitions open-debt and cumulative-resolved observations into time series, and computes the detection-to-payment gap (only when at least one paired observation exists). The model it returns is the single source of truth that `renderActivityPage` later serializes into HTML; every numeric cell on the dashboard comes from a field computed here.

```ts
export function buildActivityModel(entries: UpdateMetric[]): ActivityModel | null
```

The function returns `null` when `entries.length === 0`, and the caller in `view.ts` uses that signal to omit the Activity page entirely. Weekly buckets use `utcWeekStart` and are trimmed to the last 12 non-empty weeks; top pages are trimmed to 10 by write count then token count then wiki path; the "recent" list is the last 10 ledger entries oldest-first (the slice is chronological because the ledger is append-only). The detection-to-payment median and max are computed in hours from `gapsMs`; if the ledger contains no `package_emitted` with `debtCount > 0`, `timeToDocument` stays `null` rather than being reported as zero. `efficiencyRatio` is the write/package token ratio and is also `null` when no packages were emitted.

`buildActivityModel` derives four time series. `openDebtSeries` records the `debtCount` carried by each `package_emitted` event (the model treats debt as a property of the package, not of the writer). `cumulativeResolvedSeries` is a running sum of `debt_resolved.count` ordered by event time. `weeklyTokens` partitions both session tokens (from `package_emitted` and `write_received`) and batch tokens (from `batch_run`) into UTC-Monday buckets. `pageWrites` is keyed by `wikiPath` and powers the top-pages table. `batchCostUsd` is summed only from entries that report a non-null cost, so a single zero-cost batch does not collapse the totals to `null`. The detection-to-payment gap (`gapsMs`) is computed by pairing each `write_received` or `debt_resolved` with the most recent `package_emitted` whose `debtCount > 0` and whose timestamp is no greater than the writer's timestamp; events older than `lastDebtPackageTs` are intentionally skipped.

<!-- lw:anchors packages/core/src/view-activity.ts#buildActivityModel packages/core/src/view-activity.ts#utcWeekStart packages/core/src/view-activity.ts#round1 packages/core/src/view-activity.ts#utcDay -->

These anchors identify indexed symbols whose implementation is part of this module.

## Activity page rendering and formatters

`renderActivityPage` turns the model into an HTML fragment. It emits the `<h1>Activity</h1>` header, a UTC disclaimer paragraph, a Totals card row, optional Tokens-per-week and Debt-burndown inline-SVG charts, a top-pages table, and a recent-activity table. The function is deterministic — same model in, byte-identical HTML out — and styling is hooked through `.activity-*` classes plus the per-palette `--lw-chart-a` / `--lw-chart-b` CSS variables.

```ts
export function renderActivityPage(model: ActivityModel): ActivityPageFragment
```

The chart primitives are pure SVG builders. `renderWeeklyBarChart` renders two stacked-style series against a shared max; `renderBurndownChart` draws the open-debt and cumulative-resolved series; `axisFrame` paints the Y-axis labels and a faint mid gridline; `svgWrap` joins parts into the outer `<svg>` element; `legend` emits the per-series color key. All bucketing and time formatting is UTC: `utcDay` gives the `YYYY-MM-DD` bucket key, `utcWeekStart` gives the UTC Monday of the containing week, and `formatUtc` produces a host-independent `YYYY-MM-DD HH:mm` string. Numeric helpers include `round1` (single decimal), `formatInt` (thousands separators), `formatCompact` (compact magnitude), `formatUsd` (USD with two decimals), `formatActivityEvent` (one-line event text), and the local `escapeHtml` used inside fragments. Charts are emitted only when the model has at least one weekly bucket or one series point; otherwise the corresponding `<section>` is omitted entirely rather than rendered as an empty `<svg>`. The Totals row always renders, with each card falling back to `—` when its numerator is `null`, and the top-pages and recent-activity tables render empty bodies (no `<tr>`) when their respective inputs are empty. The page fragment is designed so that the same HTML can be inlined into either template's `<main class="content">` slot.

<!-- lw:anchors packages/core/src/view-activity.ts#renderActivityPage packages/core/src/view-activity.ts#renderWeeklyBarChart packages/core/src/view-activity.ts#renderBurndownChart packages/core/src/view-activity.ts#axisFrame packages/core/src/view-activity.ts#svgWrap packages/core/src/view-activity.ts#legend packages/core/src/view-activity.ts#formatUtc packages/core/src/view-activity.ts#formatActivityEvent packages/core/src/view-activity.ts#formatInt packages/core/src/view-activity.ts#formatCompact packages/core/src/view-activity.ts#formatUsd packages/core/src/view-activity.ts#escapeHtml -->

These anchors identify indexed symbols whose implementation is part of this module.

## Build site entry point and configuration

`buildSite` is the only public entry point of the viewer and coordinates the whole pipeline: validate the template, resolve the output directory, confirm a `livewiki/` directory with at least one `.md` page exists, read back the canonical `tasks.md` grouping, load `.mmd` sources, render every artifact, apply git-history freshness badges, append the Activity page when a non-empty ledger exists, wipe and recreate the output directory, then write each page, the assets, the search index, and the Mermaid bundle.

```ts
export async function buildSite(opts: BuildSiteOptions): Promise<BuildSiteResult>
```

Template selection uses `VIEW_TEMPLATES` and `DEFAULT_TEMPLATE`. The default site root is `DEFAULT_SITE_REL` (`.livewiki/site`), and `resolveOutDir` enforces the safe-io allowlist — a custom `--out` is rejected when it lives inside `livewiki/`, contains `livewiki/`, equals the repo root, or equals a filesystem root; the violation surfaces as a `ViewError` with code `invalid_out_dir`. `DEFAULT_BADGE_DAYS` is the new/updated window in days; `0` disables badges. `THEME_STORAGE_KEY` is the `localStorage` key the inline bootstrap and `view-app.js` use to persist light/dark.

The result object reports per-page counts, the resolved out directory, and a `freshness` flag that mirrors whether git history was usable; it does not surface partial-write errors. Failures during a single `renderPage` propagate immediately and abort the run before the output directory is wiped, so a broken page never silently disappears. The Activity page is gated on `buildActivityModel` returning a non-null model; when the ledger is empty or absent, the page is omitted and the build still succeeds.

<!-- lw:anchors packages/core/src/view.ts#buildSite packages/core/src/view.ts#VIEW_TEMPLATES packages/core/src/view.ts#DEFAULT_TEMPLATE packages/core/src/view.ts#DEFAULT_SITE_REL packages/core/src/view.ts#DEFAULT_BADGE_DAYS packages/core/src/view.ts#THEME_STORAGE_KEY packages/core/src/view.ts#resolveOutDir packages/core/src/view.ts#ViewError packages/core/src/view.ts#ViewError.constructor -->

These anchors identify indexed symbols whose implementation is part of this module.

## Markdown rendering and link rewriting

`createMarkdownRenderer` returns a `Marked` instance configured for GFM with a custom `heading` renderer that emits `<h2 id="…">…</h2>` (the slug is produced by the shared `slugify` helper, so heading ids are predictable across pages). `renderPage` reads a single artifact, parses frontmatter, strips control markers, embeds `%% livewiki/<path>.mmd` placeholders, rewrites internal links to `.html`, derives the title, classifies the sidebar group, captures headings and an excerpt, and returns a `PageRecord`. `rewriteLinks` reuses `resolveWikiLink` so link semantics match `verify` exactly — relative `.md` and `.mmd` targets are normalized, then verified against the known artifact set; targets that do not resolve inside the site are filtered. `outRelFor` maps a wiki path to its site-relative output (for example `livewiki/flows/cli.md` → `pages/flows/cli.html`), and `classifyGroup` assigns the `SiteGroup` from the path prefix.

```ts
function outRelFor(wikiPath: string): string
```

`stripControlMarkers` removes frontmatter, `<!-- livewiki:... -->` nav markers, and the bare control-marker paragraphs while preserving any `lw:manual` block CONTENT — rule #6. `inlineMermaidPlaceholders` scans fenced mermaid blocks for `%% livewiki/<path>.mmd` placeholders, looks the source up in the preloaded `mmdSources` map, and replaces the fence body with the inline diagram source plus a `Source: <path>` note. `deriveTitle` returns the frontmatter `title` when present, otherwise the first `#`-level heading or a path-derived fallback. `collectHeadings` returns every `^#…$` Markdown heading, `plainTextExcerpt` produces a search/OG excerpt capped at `SEARCH_EXCERPT_CAP` / `META_DESCRIPTION_CAP`, and the local `escapeHtml` ensures attribute and text safety in HTML fragments.

The custom `heading` renderer only intercepts ATX headings (`#`, `##`, …); Setext-style underlines pass through Marked's default renderer so their ids remain stable. `rewriteLinks` rewrites both inline `[text](path.md)` links and reference-style `[text][id]` link definitions, and leaves absolute URLs (`http://`, `https://`, `mailto:`) untouched. Link rewriting runs after mermaid inlining so `%% livewiki/<path>.mmd` placeholders are not misread as link targets. `stripControlMarkers` runs before rendering so the resulting HTML contains neither frontmatter delimiters nor `lw:*` HTML comments; only the page title survives via `deriveTitle`.

<!-- lw:anchors packages/core/src/view.ts#createMarkdownRenderer packages/core/src/view.ts#heading packages/core/src/view.ts#renderPage packages/core/src/view.ts#outRelFor packages/core/src/view.ts#classifyGroup packages/core/src/view.ts#stripControlMarkers packages/core/src/view.ts#rewriteLinks packages/core/src/view.ts#inlineMermaidPlaceholders packages/core/src/view.ts#deriveTitle packages/core/src/view.ts#collectHeadings packages/core/src/view.ts#plainTextExcerpt packages/core/src/view.ts#escapeHtml -->

These anchors identify indexed symbols whose implementation is part of this module.

## Freshness badges from git history

Freshness badges ("new" / "updated") come from a single bounded `git log` over `livewiki/`. The pipeline never reads the wall clock: epoch comparisons are against the newest commit in the log, so the same git state rebuilds byte-identical pages. Any failure to read git history — including missing `git`, no commits, or spawn errors — silently disables badges; it never propagates as a build error.

```ts
export function parseGitFreshnessLog(text: string): FreshnessLog
```

`runGitLog` shells out to `git log` (substituted in tests via `opts.spawnImpl`) and returns `null` on any spawn or exit-code failure; the caller treats `null` as "no badges". `collectFreshnessLog` wraps `runGitLog` with the upper bound `FRESHNESS_LOG_MAX_COMMITS` and parses the result with `parseGitFreshnessLog`. `applyFreshnessBadges` walks the `PageRecord` list, looks each wiki path up in the parsed log, and tags it `new` / `updated` only when its timestamp falls inside the `badgeDays` window; `badgeSpan` then renders the inline span. When `badgeDays` is `0` or git data is unavailable, the badge is omitted entirely and `pages` retain no `badge` field.

`parseGitFreshnessLog` parses the `git log` output into a `FreshnessLog` that maps `wikiPath → newestCommitMs` plus a global `newestMs`. `applyFreshnessBadges` then classifies each page relative to `newestMs`: a page whose newest commit is within the window and that was created after `newestMs - badgeDays * DAY_MS` is `new`; a page whose newest commit falls inside the window but predates the `new` cutoff is `updated`. Pages with no commit in the log (or whose path never appears under `livewiki/`) get no badge at all. Because the cutoff is derived from the log itself, not from `Date.now()`, a deterministic git history produces deterministic badges across rebuilds.

<!-- lw:anchors packages/core/src/view.ts#applyFreshnessBadges packages/core/src/view.ts#collectFreshnessLog packages/core/src/view.ts#runGitLog packages/core/src/view.ts#parseGitFreshnessLog packages/core/src/view.ts#badgeSpan -->

These anchors identify indexed symbols whose implementation is part of this module.

## Sidebar grouping, tasks grouping, and shell assembly

The sidebar mirrors the canonical structure defined in `tasks.md` rather than re-deriving clusters from filesystem layout. `parseTasksGrouping` walks the `Implementation reference` section of `tasks.md` and produces an ordered `TasksGrouping` keyed by subgroup heading, with a `tasksIndex` per page that `renderPage` copies onto the `PageRecord` to drive stable ordering. `GROUP_ORDER` is the fixed display order — Quickstart, Concept topics, Flows, Implementation reference, Auxiliary, Diagrams, Wiki indexes, Activity — and pages are sorted by group then by `tasksIndex` then by wiki path.

```ts
function buildSidebar(pages: PageRecord[], currentOutRel: string): string
function renderShell(opts: {
  // …
}): string
```

`buildSidebar` emits one `<details>` per multi-item group, marks the current page with `aria-current="page"` and an active class, and opens the group containing the active page. `relativeHref` and `rootPrefixFor` together compute the correct relative href from any page to any other page (including the Mermaid asset and the search index). `renderShell` wraps the page-specific `<main class="content">` fragment with the template chrome — `<head>` including static OG/social meta tags (no `og:url`, no `og:image`, by design), the persisted-theme bootstrap, the sidebar, and the asset links. `buildSearchIndexJs` emits the literal `window.SEARCH_INDEX = [...]` JavaScript that the offline search uses — it is fetched by no one and works under `file://`. `readMermaidAsset` loads `mermaid.min.js` from `node_modules/mermaid/dist`; a missing asset raises `ViewError` with code `missing_mermaid_asset`.

`parseTasksGrouping` is robust to a missing or empty `tasks.md`: it returns an empty grouping rather than throwing, and pages without a `tasksIndex` fall back to alphabetical-by-wiki-path ordering within their group. The sidebar is rendered once per page (in `renderShell`) using the `currentOutRel` passed in, so every page sees itself as active. `relativeHref` walks the path segments of `fromOutRel` and `toOutRel`, counting the directory distance, and emits either an absolute path (when `toOutRel` lives at the site root) or a `./` / `../` relative path otherwise. `renderShell` is the only place that touches `view-app.js`, the Mermaid asset, and the search index — page rendering never links them directly. The search index is emitted at the site root as `search-index.js`, so the sidebar's relative link is computed against the deepest page's depth.

<!-- lw:anchors packages/core/src/view.ts#parseTasksGrouping packages/core/src/view.ts#buildSidebar packages/core/src/view.ts#renderShell packages/core/src/view.ts#relativeHref packages/core/src/view.ts#rootPrefixFor packages/core/src/view.ts#buildSearchIndexJs packages/core/src/view.ts#readMermaidAsset -->

These anchors identify indexed symbols whose implementation is part of this module.

## Repository walker

`walkRepo` enumerates indexable files under a repository root while honoring `.gitignore`, the default denylists, and any caller-supplied `extraIgnores`. File selection is denylist-based: every text file is walked; only archives, binaries, media/fonts, source maps, minified bundles, known lockfiles, and extensionless files are skipped.

```ts
export async function walkRepo(
  repoRoot: string,
  opts: WalkOptions = {},
): Promise<WalkResult[]>
```

The implementation is stack-based (no recursion depth limit), reads each directory once with `readdir({ withFileTypes: true })`, converts paths to POSIX-style relative form, and lets `ignore` decide whether to descend. `EXTENSION_LANG` maps grammar-mapped extensions to their language name (tier 1: TypeScript, TSX, JavaScript, JSX, Python); everything else with an extension gets `lang = extension without the dot, lowercased` (tier 2 prose, indexed with zero symbols). `DENIED_EXTENSIONS` is the per-extension denylist; `DENIED_BASENAMES` is the case-insensitive lockfile denylist; `isMinified` skips `.min.js` and `.min.css`. `buildIgnore` composes the ignore filter: a fixed set of defaults (`.git/`, `node_modules/`, `.livewiki/`, `livewiki/`, `dist/`, `coverage/`), the repo's `.gitignore` if present (silently ignored when absent), and any `extraIgnores`. The output is sorted by path for stable diffs across runs.

`walkRepo` does NOT follow symlinks — they fall through the `isFile` / `isDirectory` checks and are skipped silently. If a directory read fails (permission denied, removed during traversal), the warning is logged to `console.warn` and traversal continues.

Per-file results carry a stable `relativePath` (POSIX-separated, no leading `./`), an `absolutePath` for callers that need to stat or read the file, an optional `size` in bytes when available, and a `lang` field chosen by `EXTENSION_LANG` or the tier-2 fallback. The walker is intentionally read-only: it never modifies the repository and never resolves the working directory itself, so `repoRoot` must be absolute. Because the ignore filter is built from `.gitignore` + defaults + `extraIgnores`, callers that need a fully empty traversal can pass `{ extraIgnores: ["*"] }`; the fixed defaults are still applied on top, but the catch-all covers the rest.

<!-- lw:anchors packages/core/src/walker.ts#walkRepo packages/core/src/walker.ts#EXTENSION_LANG packages/core/src/walker.ts#DENIED_EXTENSIONS packages/core/src/walker.ts#DENIED_BASENAMES packages/core/src/walker.ts#isMinified packages/core/src/walker.ts#buildIgnore -->

These anchors identify indexed symbols whose implementation is part of this module.

## Test helpers and fixtures

The two `*.test.ts` files are fixtures-and-helpers modules: their top-level functions are not part of any product API but are how the test suites mount an isolated filesystem and substitute process behavior.

`walker.test.ts` provides a single helper:

```ts
async function write(rel: string, content = ""): Promise<void>
```

It creates parent directories and writes a file under the per-test tmp repo (`mkdtemp` in `beforeEach`, `rm -rf` in `afterEach`). It is the only helper exercised across the 16 walker test cases that cover `EXTENSION_LANG`, default ignores, `.gitignore` respect, `extraIgnores` precedence, POSIX path separators, stable ordering, tier-2 extensions, grammar-less extensions, denylisted extensions and lockfiles, minified-bundle skipping, the `livewiki/` exclusion, and extensionless-file skipping.

`view.test.ts` provides a richer harness. `writeWiki` writes a file under the per-test tmp repo; `writeFixtureWiki` seeds the canonical fixture wiki (quickstart, auth, billing, tasks, the CLI auth flow with a mermaid fence containing a `%% livewiki/<path>.mmd` placeholder, a flows index, observability and auxiliary pages, an architecture overview that links to `.mmd` diagrams, the `.mmd` sources themselves, and a dot-prefixed `.github.md`). `readSite` and `siteFileExists` are the read-side counterparts used to assert what the builder wrote. `extractMain` returns the template-independent `<main class="content">…</main>` fragment, which is how the tests assert that templates differ only in chrome/CSS while sharing content fragments. `parseSearchIndex` parses the emitted `window.SEARCH_INDEX = [...]` JavaScript back into JSON. `fakeSpawnOk` and `fakeSpawnError` are `SpawnImpl` doubles that drive the git-log freshness probe; `gitLogOutput` constructs a synthetic `git log` payload from commit tuples `(timestampMs, paths[])`, used together with `fakeSpawnOk` to seed deterministic freshness data.

`writeFixtureWiki` is the single source of truth for the test corpus — every `view.test.ts` case that runs `buildSite` seeds the repo with it. `extractMain` strips both `<head>` and the sidebar `<details>` blocks, so two template variants that only differ in chrome produce equal extracted fragments. `parseSearchIndex` tolerates either a leading `/* ... */` block-comment banner or whitespace before the array literal, so the builder can change its preamble without breaking the parser. `fakeSpawnOk` accepts an optional exit code (default `0`) and returns the payload verbatim, while `fakeSpawnError` returns an `Error`-bearing result with an empty stdout; together they let a single test cover both the "git available" and "git unavailable" code paths in `applyFreshnessBadges`. `gitLogOutput` formats timestamps as `<unixSeconds> <path1>\n<path2>` lines and joins commits with a NUL separator, exactly matching the format `runGitLog` parses.

<!-- lw:anchors packages/core/src/walker.test.ts#write packages/core/src/view.test.ts#writeWiki packages/core/src/view.test.ts#writeFixtureWiki packages/core/src/view.test.ts#readSite packages/core/src/view.test.ts#siteFileExists packages/core/src/view.test.ts#extractMain packages/core/src/view.test.ts#parseSearchIndex packages/core/src/view.test.ts#fakeSpawnOk packages/core/src/view.test.ts#fakeSpawnError packages/core/src/view.test.ts#gitLogOutput -->

These anchors identify indexed symbols whose implementation is part of this module.

<!-- livewiki:navigate:start -->
## Navigate

- [Core Repair, Status, Sectioning, Symbols, and Risk Pipeline](core-src-11.md) — dependency
- [Core module identification, manifest I/O, and Markdown mask helpers](core-src-08.md) — dependency
- [core-src-06 stage-5 internals (flows, diagrams, frontmatter, gitignore, hashes, import resolution)](core-src-06.md) — dependency

> Coverage note: this module's source (4 files, ~144k chars) exceeded the prompt budget and was excerpted; this page documents the closed-list symbols.
<!-- livewiki:navigate:end -->
