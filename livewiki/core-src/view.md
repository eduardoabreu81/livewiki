---
title: Building the Offline Wiki Viewer
owner: generated
anchors:
  - packages/core/src/view.ts#VIEW_TEMPLATES
  - packages/core/src/view.ts#DEFAULT_TEMPLATE
  - packages/core/src/view.ts#DEFAULT_SITE_REL
  - packages/core/src/view.ts#DEFAULT_BADGE_DAYS
  - packages/core/src/view.ts#THEME_STORAGE_KEY
  - packages/core/src/view.ts#ViewError
  - packages/core/src/view.ts#ViewError.constructor
  - packages/core/src/view.ts#buildSite
  - packages/core/src/view.ts#resolveOutDir
  - packages/core/src/view.ts#createDiskWikiSource
  - packages/core/src/view.ts#createGitRefWikiSource
  - packages/core/src/view.ts#listArtifacts
  - packages/core/src/view.ts#read
  - packages/core/src/view.ts#normalizeRefOption
  - packages/core/src/view.ts#filterWikiArtifactPaths
  - packages/core/src/view.ts#firstStderrLine
  - packages/core/src/view.ts#runGitCaptured
  - packages/core/src/view.ts#parseWikiStamp
  - packages/core/src/view.ts#probeWikiStamp
  - packages/core/src/view.ts#normalizeGitHubRemote
  - packages/core/src/view.ts#probeGitHubRemoteBase
  - packages/core/src/view.ts#createMarkdownRenderer
  - packages/core/src/view.ts#heading
  - packages/core/src/view.ts#renderPage
  - packages/core/src/view.ts#outRelFor
  - packages/core/src/view.ts#classifyGroup
  - packages/core/src/view.ts#deriveTitle
  - packages/core/src/view.ts#diagramTitleAndCaption
  - packages/core/src/view.ts#stripControlMarkers
  - packages/core/src/view.ts#uniqueAnchorFilePaths
  - packages/core/src/view.ts#sourceRefHtml
  - packages/core/src/view.ts#insertAfterFirstH1
  - packages/core/src/view.ts#rewriteLinks
  - packages/core/src/view.ts#inlineMermaidPlaceholders
  - packages/core/src/view.ts#collectHeadings
  - packages/core/src/view.ts#plainTextExcerpt
  - packages/core/src/view.ts#escapeHtml
  - packages/core/src/view.ts#parseTasksGrouping
  - packages/core/src/view.ts#parseGitFreshnessLog
  - packages/core/src/view.ts#applyFreshnessBadges
  - packages/core/src/view.ts#collectFreshnessLog
  - packages/core/src/view.ts#runGitLog
  - packages/core/src/view.ts#renderShell
  - packages/core/src/view.ts#buildSidebar
  - packages/core/src/view.ts#badgeSpan
  - packages/core/src/view.ts#buildSearchIndexJs
  - packages/core/src/view.ts#renderViewAppJs
  - packages/core/src/view.ts#readMermaidAsset
  - packages/core/src/view.ts#rootPrefixFor
  - packages/core/src/view.ts#relativeHref
---

# Building the Offline Wiki Viewer

`packages/core/src/view.ts` turns a canonical Livewiki workspace into a deterministic, offline-capable static documentation site assembled from the same Markdown and Mermaid artifacts the rest of the toolchain verifies.

## When to use this page

- **Generate** a static viewer from either the working tree or a read-only historical Git ref.
- **Pick** a template (`agent` or `docs`), a safe output directory, and an optional freshness-badge window.
- **Configure** the wiki language for chrome strings or rely on git to stamp the build and surface GitHub source links.
- **Trace** how the public entry point threads artifact collection, page rendering, badges, sidebar, and the vendored Mermaid runtime into one emitted site.

## How it fits

The `view` module is the site-generation stage of the Livewiki toolchain. It reads the canonical Markdown (`.md`) and Mermaid (`.mmd`) artifacts under `livewiki/`, reusing path collection, link resolution, frontmatter parsing, anchor generation, and Markdown masking from the core verification and parsing modules. Its artifacts can be served as static files from the local filesystem (`file://`) with no server, because every runtime asset — including the Mermaid distribution — is vendored into the output directory at build time.

The module sits alongside the verification pipeline: it depends on `verify.ts` for canonical path collection and wiki-link resolution, on `frontmatter.ts` for parsing page metadata, on `anchors.ts` for the slug used in heading IDs, on `markdown-mask.ts` for code-span masking, on `risk.ts` for the swappable `SpawnImpl`, on `safe-io.ts` for sandboxed writes under the default site path, and on `view-chrome.ts` and `view-activity.ts` for localized chrome strings and the synthetic Activity dashboard. The CLI command layer is the immediate caller of `buildSite`.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-view.mmd
```

## Public entry point and error surface
<!-- lw:anchors packages/core/src/view.ts#VIEW_TEMPLATES packages/core/src/view.ts#DEFAULT_TEMPLATE packages/core/src/view.ts#DEFAULT_SITE_REL packages/core/src/view.ts#DEFAULT_BADGE_DAYS packages/core/src/view.ts#THEME_STORAGE_KEY packages/core/src/view.ts#ViewError packages/core/src/view.ts#ViewError.constructor packages/core/src/view.ts#buildSite packages/core/src/view.ts#resolveOutDir -->

This section covers the user-facing surface of the view module: the constants callers can rely on, the error type they must catch, and the two top-level functions that turn a repository into a static HTML site.

### Constants a caller can rely on

The module publishes a small set of frozen defaults so callers and tests do not have to hardcode the same literals everywhere. `VIEW_TEMPLATES` declares the closed set of supported output themes:

```ts
export const VIEW_TEMPLATES = ["agent", "docs"] as const;
```

— a readonly tuple that doubles as a runtime allow-list and as the source of truth for error messages. `DEFAULT_TEMPLATE` is `"agent"`, used when the caller does not pick a theme. `DEFAULT_SITE_REL` is the in-repo directory `.livewiki/site` where a generated site lands by default, kept inside the repo on purpose so the site travels with the wiki. `DEFAULT_BADGE_DAYS` is `7`, the freshness threshold used when the caller does not override it; a non-positive value disables badges. Finally, `THEME_STORAGE_KEY` is the localStorage key the viewer uses to remember the visitor's chosen theme across reloads; it is exported so the runtime HTML and any companion tooling agree on the same key.

### `ViewError`: the module's failure contract

Every user-recoverable failure from this module is thrown as a `ViewError`, a thin subclass of the built-in `Error`:

```ts
constructor(code: ViewErrorCode, message: string) {
```

The constructor takes a machine-readable `ViewErrorCode` tag and a human-readable message, sets `name` to `"ViewError"` so it is recognizable in logs and JSON serializers, and stores `code` as a readonly property so callers can branch on it without parsing the message string. The discriminator codes used in this section are `"invalid_template"`, `"missing_wiki"`, and `"invalid_out_dir"`. Catching `ViewError` (rather than bare `Error`) is therefore the supported way for a caller to distinguish a configuration problem from an unrelated crash.

### `buildSite`: the pipeline entry point

```ts
export async function buildSite(opts: BuildSiteOptions): Promise<BuildSiteResult>
```

`buildSite(opts)` takes a `BuildSiteOptions` object describing the repository root, the optional template, language, ref, output directory, badge threshold, and a swappable `spawnImpl`, and returns a `Promise<BuildSiteResult>` describing what was produced.

The function follows a fixed pipeline:

1. **Resolve the repo root.** `nodePath.resolve(opts.repoRoot)` is computed once into `absRoot` and reused everywhere, so every subsequent path is absolute and there is no ambiguity between relative and absolute inputs.
2. **Validate the template.** `opts.template ?? DEFAULT_TEMPLATE` selects the user's choice or falls back to `"agent"`. The result is checked against `VIEW_TEMPLATES`; an unknown value throws a `ViewError` of code `"invalid_template"` whose message lists the allowed templates.
3. **Resolve the output directory.** `resolveOutDir(absRoot, opts.outDir)` (described below) returns a `ResolvedOutDir`. The default mode goes through `safeIo` so writes are constrained to the well-known `DEFAULT_SITE_REL` path inside the repo; an explicit `--out` opts out of `safeIo` and uses raw filesystem operations.
4. **Pick a `spawnImpl`.** `opts.spawnImpl ?? spawn` lets tests substitute a fake while production callers get the real one.
5. **Pick a wiki source.** `normalizeRefOption(opts.ref)` decides between a historical git-ref source and the working tree. In ref mode a `GitRefWikiSource` is created with `createGitRefWikiSource`; otherwise the working tree is used, provided `livewiki/` exists as a directory under `absRoot` — if it does not, a `ViewError` of code `"missing_wiki"` tells the caller to run `livewiki init`. The working-tree source is created with `createDiskWikiSource(absRoot)`.
6. **Validate that there is something to render.** `source.listArtifacts()` is awaited and sorted, then checked for at least one `.md` page; otherwise another `"missing_wiki"` `ViewError` is thrown, with a message that distinguishes ref mode (`no Markdown pages found under livewiki/ at ref "<ref>"`) from working-tree mode (`— run \`livewiki init\` first`).
7. **Establish site identity and viewer chrome.** The repository name is taken as `nodePath.basename(absRoot)` — deterministic, no git probing — and `resolveViewerChrome(opts.language)` returns localized strings for sidebar/search/toggle/stamp/diagram captions that follow the sticky wiki language rather than only `<html lang>`.
8. **Probe version stamp and remote.** `probeWikiStamp(absRoot, ref, spawnImpl)` returns the newest commit touching `livewiki/` (at the ref in ref mode), or `null` on any failure; `probeGitHubRemoteBase(absRoot, spawnImpl)` returns the remote URL base or `null`. `deepLinks` is built only when both succeed, giving `{ blobBase }` for source deep-links — offline posture otherwise.
9. **Read implementation-reference grouping.** When `livewiki/tasks.md` is among the artifacts, its text is read back and fed to `parseTasksGrouping`, so clusters are not re-derived.
10. **Pre-read `.mmd` diagrams.** Every `.mmd` source is read up front into a `Map<wikiPath, sourceText>`, because `.md` pages may embed `%% livewiki/<path>.mmd` placeholders and the referencing page can sort before the diagram it references.
11. **Render pages.** `createMarkdownRenderer()` returns the shared renderer, then for each wiki path the page text is read (or pulled from the pre-read map for `.mmd` files) and `renderPage(...)` produces a `PageRecord`.
12. **Apply freshness badges.** Only in working-tree mode (ref is `null`), `applyFreshnessBadges` decorates pages with badges derived from git history against `opts.badgeDays ?? DEFAULT_BADGE_DAYS`; in ref mode badges are skipped because they would compare a historical wiki against a working-tree log.
13. **Append the synthetic Activity dashboard.** `listUpdateMetrics` reads the local metrics ledger; `buildActivityModel` derives the model (or returns `null` when the ledger is missing or empty); if non-null, `renderActivityPage` produces a fragment that is pushed as a final `PageRecord` titled with `chrome.activityTitle` and grouped under `"Activity"` — never written as a wiki page, just derived.
14. **Wipe and recreate the output directory.** Either `safeIo.remove` + `safeIo.mkdir` under the safe path, or `nodeFs.rm({ recursive: true, force: true })` + `nodeFs.mkdir({ recursive: true })` for an explicit `--out`. This guarantees a fresh site every run.
15. **Write the site.** A local `write(rel, content)` helper routes through `safeIo` or raw `nodeFs` according to `out.viaSafeIo` and records every written path in `filesWritten`. Each page becomes a full HTML document via `renderShell` (chrome inlined so `file://` navigation needs no fetches), and the static assets — `assets/view-agent.css`, `assets/view-docs.css`, `assets/view-app.js`, `assets/search-index.js`, and `assets/mermaid.min.js` — are emitted alongside.
16. **Return the result.** `filesWritten` is sorted, then `buildSite` resolves with `{ ok: true, outDir, template, pagesWritten, filesWritten }`.

### `resolveOutDir`: validating `--out`

```ts
function resolveOutDir(absRoot: string, outDirOpt: string | undefined): ResolvedOutDir
```

`resolveOutDir(absRoot, outDirOpt)` takes the absolute repo root and the optional user-supplied `--out` string and returns a `ResolvedOutDir` describing where to write and whether to go through `safeIo`. When `outDirOpt` is `undefined`, the default `{ abs: <absRoot>/.livewiki/site, viaSafeIo: true }` is returned — writes stay inside the well-known safe path.

When the caller passes a directory, the function rejects three dangerous configurations, each as a `ViewError` of code `"invalid_out_dir"`:

- the resolved `abs` lies **inside** the `livewiki/` source tree (computed via `nodePath.relative(livewikiAbs, abs)` — empty string or no `..` prefix means inside);
- the resolved `abs` **contains** `livewiki/`, which would let the subsequent wipe-and-recreate step destroy the wiki itself;
- the resolved `abs` is a filesystem root (`abs === nodePath.parse(abs).root`), which is never a sensible target.

If all three checks pass, `resolveOutDir` returns `{ abs, viaSafeIo: false }` so `buildSite` performs the writes with raw `nodeFs` calls. This split is what makes the default safe (sandboxed to `.livewiki/site`) while still permitting an explicit, validated override.

## Wiki sources: working tree and read-only git refs
<!-- lw:anchors packages/core/src/view.ts#createDiskWikiSource packages/core/src/view.ts#createGitRefWikiSource packages/core/src/view.ts#listArtifacts packages/core/src/view.ts#read packages/core/src/view.ts#normalizeRefOption packages/core/src/view.ts#filterWikiArtifactPaths packages/core/src/view.ts#firstStderrLine packages/core/src/view.ts#runGitCaptured -->

A wiki view can be satisfied from two very different backends, and this file models them as one interface (`WikiSource`) with two constructors. Both backends expose the same two operations: `listArtifacts()` to enumerate every `.md` / `.mmd` file under `livewiki/`, and `read(wikiPath)` to fetch the contents of a single artifact. The difference is whether the bytes come from the working tree on disk or from a pinned, read-only git reference.

### Disk backend

The working-tree backend is the simpler of the two. `createDiskWikiSource(absRoot: string): WikiSource` takes an absolute root directory and returns a `WikiSource` whose methods are thin adapters over local I/O. Its `listArtifacts(): Promise<string[]>` calls `collectWikiArtifactPaths(absRoot)` and spreads the result into a fresh array; its `read(wikiPath: string): Promise<string>` delegates straight to `safeIo.readText(absRoot, wikiPath)`. There is no ref validation, no subprocess, and no caching layer here — this backend is meant for "the current state of the repo, right now."

### Ref-option normalization

Before the git-ref backend constructor is ever called, the caller is expected to have already normalized the ref string. `normalizeRefOption(ref: string | undefined): string | null` returns `null` when no ref was supplied (signaling "use the working tree"), trims whitespace otherwise, and rejects two malformed inputs: the empty string, and anything whose first character is `-`. The dash guard exists because `git` accepts options like `--upload-pack=…`, so an attacker-controlled ref beginning with `-` could inject flags into a later `git ls-tree` or `git show` invocation. The visible source throws a `ViewError` of code `"invalid_ref"` for both malformed shapes; any other non-empty string is returned verbatim, since valid commit SHAs and tag names are passed through to git unmodified.

### Artifact filter

```ts
export function filterWikiArtifactPaths(paths: string[]): string[]
```

Artifact enumeration for the ref backend runs `git ls-tree -r --name-only <ref> -- livewiki/` via `runGitCaptured`, then pipes the output through `filterWikiArtifactPaths`. The raw newline-separated stdout is split on `\r?\n`, each line is trimmed, empty lines are dropped, and the resulting string array is handed to `filterWikiArtifactPaths`. That filter applies the file's notion of "what counts as a wiki artifact": the path must start with `livewiki/`, must end in `.md` or `.mmd`, and every directory segment between `livewiki/` and the filename must not begin with `.` (so dotfile subdirectories like `.drafts/` are skipped). The same filter is what makes the disk-backed and git-backed artifact sets consistent.

### Git-ref backend

The git-ref backend is a read-only view of an arbitrary commit or tag. `createGitRefWikiSource(absRoot: string, ref: string, spawnImpl: SpawnImpl): WikiSource` accepts the repository root, the ref name, and a pluggable spawn function (so tests can substitute a fake `git`). `listArtifacts()` returns `Promise<string[]>` and `read(wikiPath: string): Promise<string>` returns `Promise<string>`, just like the disk backend.

`listArtifacts` runs `git ls-tree -r --name-only <ref> -- livewiki/`. A null result from `runGitCaptured` (git not spawned) or a non-zero exit throws a `ViewError` of code `"invalid_ref"`; its message carries `firstStderrLine(result)` when stderr has a non-blank line, falling back to `"not a git repository or git unavailable"`.

`read(wikiPath)` runs `git show <ref>:<wikiPath>`. The same null-or-nonzero short-circuit throws another `"invalid_ref"` `ViewError`, this time keyed to the specific `wikiPath`; the message carries `firstStderrLine(result)` or the fallback `"git show failed"`. On success the captured stdout is returned verbatim. The shared subprocess plumbing that both methods rely on is `runGitCaptured`.

### Stderr extraction

`firstStderrLine(result: GitCaptured | null): string | null` earns its keep in both ref-backend methods. It takes the captured result (which may itself be `null` if the child process never spawned) and pulls the first non-blank line out of `stderr`, trimming it; if `result` is `null`, or `stderr` is empty/whitespace, it returns `null`. The two `WikiSource` methods attach that line — or a generic fallback — to a `ViewError` of code `"invalid_ref"`, so a missing ref, a non-repo root, or git being unavailable all surface as the same kind of error to the caller.

### Shared subprocess plumbing

The shared subprocess plumbing lives in `runGitCaptured(absRoot: string, args: string[], spawnImpl: SpawnImpl): Promise<GitCaptured | null>`. It wraps `spawnImpl("git", args, { cwd: absRoot, shell: false })` in a promise that always settles exactly once. `shell: false` is deliberate: it prevents the OS shell from interpreting the ref or the path, which is what makes the `normalizeRefOption` dash-guard meaningful. If `spawnImpl` itself throws synchronously — for example, because the `git` binary is missing — the promise resolves to `null` instead of rejecting, so callers can treat "no git" identically to "git exited non-zero." The function accumulates `stdout` and `stderr` chunks as strings, listens for `error` (resolves to `null`) and `close` (resolves to `{ code, stdout, stderr }`), and uses a `settled` flag so that an `error` arriving after `close`, or vice versa, cannot resolve the promise twice. The result is a uniform `GitCaptured | null` shape that `firstStderrLine` and both ref-backend methods can pattern-match on without ever having to know how `git` was actually invoked.

## Git-aware chrome: version stamp and GitHub deep links
<!-- lw:anchors packages/core/src/view.ts#parseWikiStamp packages/core/src/view.ts#probeWikiStamp packages/core/src/view.ts#normalizeGitHubRemote packages/core/src/view.ts#probeGitHubRemoteBase -->

The chrome surrounding a generated wiki page is git-aware in two directions: a *version stamp* that records which commit and date the documentation reflects, and a *GitHub remote base* that lets the UI build deep links back into the source repository. Together they let a viewer answer "is this still current?" and "where in the code does this come from?" without re-running anything expensive on the client.

### Parsing the stamp

`parseWikiStamp` is the parser that turns the raw text emitted by `git log` into a structured `WikiStamp`:

```ts
export function parseWikiStamp(text: string): WikiStamp | null
```

It takes a block of text (a git log record) and returns either a `{ sha, date }` object or `null` if the text doesn't look like a stamp. It splits the input into trimmed non-empty lines, expects the first line to be a 40-character hex SHA, and the second to begin with an ISO-8601 date prefix (`YYYY-MM-DDT`). On a structural mismatch it bails out with `null`; on success it keeps the full SHA and slices the ISO timestamp down to its `YYYY-MM-DD` date portion. The function is pure; no git invocation.

### Probing the stamp

`probeWikiStamp` is the side that actually *fetches* that stamp from the repository:

```ts
async function probeWikiStamp(
  absRoot: string,
  ref: string | null,
  spawnImpl: SpawnImpl,
): Promise<WikiStamp | null>
```

It takes the absolute repo root, an optional ref (branch, tag, or SHA — `null` means "whatever HEAD points at"), and a `SpawnImpl` for running git, and returns a `WikiStamp` or `null` when git refused to answer. It builds a `git log -1 --format=%H%n%cI` invocation, optionally pinning the ref before the `--` path separator, and narrows the walk to the `livewiki/` subtree. A null `runGitCaptured` result, a non-zero exit, or a `parseWikiStamp` miss all resolve to `null` — there is no throw path on this function. The stdout is handed straight to `parseWikiStamp`, so the same parser is reused both for freshly captured output and for any cached text surfaced later.

### Normalizing the remote URL

```ts
export function normalizeGitHubRemote(url: string): string | null
```

`normalizeGitHubRemote` is the URL-shaped counterpart to `parseWikiStamp`. It takes whatever `git remote get-url origin` produced — an HTTPS URL, an SSH URL, possibly with a trailing `.git`, possibly with whitespace — and returns a canonical `https://github.com/<owner>/<repo>` string, or `null` if the remote isn't a GitHub one. It handles the two real-world shapes (`https://…` and `git@github.com:…`) with two regexes, strips an optional `.git`, normalizes a trailing slash, and rewrites SSH into HTTPS so downstream link builders never need to branch on transport.

### Probing the remote base

```ts
async function probeGitHubRemoteBase(absRoot: string, spawnImpl: SpawnImpl): Promise<string | null>
```

`probeGitHubRemoteBase` glues those two together: it asks git for the `origin` URL of the repo rooted at `absRoot`, again using the injected `SpawnImpl`, and if git cooperates it runs the result through `normalizeGitHubRemote`. It returns the canonical GitHub base URL or `null` if the remote isn't a GitHub one or git failed. A non-null return value is the single fact the rest of the chrome layer needs to fabricate file-, commit-, and blame-scoped links without re-parsing remotes at every render.

## Page rendering pipeline
<!-- lw:anchors packages/core/src/view.ts#createMarkdownRenderer packages/core/src/view.ts#heading packages/core/src/view.ts#renderPage packages/core/src/view.ts#outRelFor packages/core/src/view.ts#classifyGroup packages/core/src/view.ts#deriveTitle packages/core/src/view.ts#diagramTitleAndCaption packages/core/src/view.ts#stripControlMarkers packages/core/src/view.ts#uniqueAnchorFilePaths packages/core/src/view.ts#sourceRefHtml packages/core/src/view.ts#insertAfterFirstH1 packages/core/src/view.ts#rewriteLinks packages/core/src/view.ts#inlineMermaidPlaceholders packages/core/src/view.ts#collectHeadings packages/core/src/view.ts#plainTextExcerpt packages/core/src/view.ts#escapeHtml -->

A page enters `renderPage` and leaves it as a populated `PageRecord` — the HTML for the viewer, the title shown in the nav, the heading list, and the search excerpt are all produced here.

```ts
async function renderPage(
  md: Marked,
  wikiPath: string,
  source: string,
  artifactPaths: Set<string>,
  tasksGrouping: TasksGrouping,
  mmdSources: Map<string, string>,
  deepLinks: DeepLinks | null,
  chrome: ViewerChrome,
): Promise<PageRecord>
```

### Markdown renderer and heading IDs

```ts
function createMarkdownRenderer(): Marked
```

`createMarkdownRenderer()` returns a configured Marked instance. The one customisation is the heading renderer:

```ts
heading({ tokens, depth }): string
```

which parses the inline tokens to HTML, strips tags to recover the plain heading text, and emits `<hN id="<slug>">…</hN>` where the slug uses `slugify` from `anchors.ts` — so any `page.html#section` links that `rewriteLinks` rewrites actually land on the heading they claim to.

### Routing a path to an output and a group

Two route decisions computed up front from the `wikiPath`:

```ts
function outRelFor(wikiPath: string): string
```

```ts
function classifyGroup(wikiPath: string): SiteGroup
```

`outRelFor(wikiPath)` returns the on-disk relative output path: the quickstart page becomes `index.html`, and every other `.md`/`.mmd` file under `livewiki/` becomes `pages/<basename>.html`. `classifyGroup(wikiPath)` returns which top-level site group it belongs to — `Quickstart` for the quickstart page, `Diagrams` for `.mmd` files, `Concept topics` / `Flows` / `Auxiliary areas` for their respective folders, `Implementation reference` for unit pages (including `livewiki/<folder>/<file>.md` files and the un-foldered implementation pages), and `Indexes & overviews` for hub-style pages such as `architecture/`, `tasks.md`, and folder indexes.

### Diagram short-circuit

When the path ends in `.mmd`, `renderPage` takes the diagram short-circuit. Instead of running the page through Marked, it asks for a human title and caption and emits a small HTML fragment directly:

```ts
function diagramTitleAndCaption(wikiPath: string, chrome: ViewerChrome): { title: string; caption: string }
```

`diagramTitleAndCaption(wikiPath, chrome)` handles the two named diagrams (`structure` and `modules`) by reading dedicated chrome fields, derives titles for `*.classes` and `flow-*` files via a humanizer and chrome templates, and falls back to a humanized basename with a generic caption for anything else. The resulting HTML is `<h1>title</h1><p>caption</p><pre><code class="language-mermaid">…escaped source…</code></pre>`, with the title and caption both `escapeHtml`-cleaned.

### Title derivation

For Markdown pages the pipeline parses frontmatter defensively, then asks `deriveTitle` for the page title:

```ts
function deriveTitle(fm: Frontmatter | null, body: string, wikiPath: string): string
```

`deriveTitle(fm, body, wikiPath)` returns the page title — preferring a non-empty `frontmatter.title`, then the first level-1 heading in the body (with code spans masked via `maskCodeSpans` so a heading like `# foo \`bar\`` yields `foo bar`), then the filename without its `.md`/`.mmd` extension.

### Three body transforms

The body is then run through three transforms in sequence, from innermost to outermost: control-marker stripping, link rewriting, and Mermaid inlining. The outermost call is `inlineMermaidPlaceholders`, the middle is `rewriteLinks`, and the innermost is `stripControlMarkers`:

```ts
function stripControlMarkers(
  body: string,
  anchorMarkerReplacement?: (anchorKeys: string[]) => string,
): string
```

`stripControlMarkers(body, anchorMarkerReplacement?)` takes the raw body and an optional replacement factory for `lw:anchors` markers, and returns the body with `lw:*` HTML comments removed. Each `<!-- livewiki:... -->`, `lw:anchors`, and `lw:manual` / `\/lw:manual` marker is deleted (code spans are masked first so the regex can't match inside fenced or inline code); when the caller supplies `anchorMarkerReplacement`, `lw:anchors` markers are replaced by whatever HTML the factory returns from the marker keys. `renderPage` plugs `sourceRefHtml` in here so each anchor marker becomes a `<p class="lw-source-ref">` line.

```ts
function rewriteLinks(body: string, fromWikiPath: string, artifactPaths: Set<string>): string
```

`rewriteLinks(body, fromWikiPath, artifactPaths)` takes the body, the path of the page doing the linking, and the set of known artifact paths, and returns the body with inter-page Markdown links rewritten to relative HTML paths. It scans `[text](path.md#section)` patterns (with code spans masked via `maskCodeSpansPreservingLength`), resolves each target against `fromWikiPath` via `resolveWikiLink`, checks that the resolved target is inside the wiki (`isInsideWiki`) and present in `artifactPaths`, and rewrites the URL to `relativeHref(outRelFor(fromWikiPath), outRelFor(resolved))` plus the optional `#section`. Links that do not resolve to a known wiki artifact are left untouched (verify owns the broken-link report). The original link text is preserved verbatim from the unmasked body so inline code inside link text isn't blanked out.

```ts
function inlineMermaidPlaceholders(body: string, mmdSources: Map<string, string>): string
```

`inlineMermaidPlaceholders(body, mmdSources)` takes the body and a map from `livewiki/<name>.mmd` paths to diagram source strings, and returns the body with placeholder Mermaid blocks replaced by the real diagram source. A block whose only content is `%% livewiki/<name>.mmd` is substituted from `mmdSources` (trimmed of trailing whitespace); any other Mermaid block, or a placeholder referencing a missing `.mmd`, is left untouched.

### Sources line and deep links

The Marked output is then augmented with the per-page `Sources:` line when deep links are available. `renderPage` collects the unique anchor paths via `uniqueAnchorFilePaths(getAnchors(fm))` and only injects the line when the list is non-empty.

```ts
function uniqueAnchorFilePaths(anchorKeys: string[]): string[]
```

`uniqueAnchorFilePaths(anchorKeys)` takes the raw anchor keys from a `lw:anchors` marker or frontmatter anchors and returns the de-duplicated, alphabetically sorted list of file paths. Each key has any `#section` suffix stripped, empty results are dropped, and the remainder is collected into a `Set` before being sorted with `localeCompare`.

The HTML fragment for that sources line, and the per-marker version used inside `stripControlMarkers`, is produced by `sourceRefHtml`:

```ts
function sourceRefHtml(anchorKeys: string[], blobBase: string): string
```

`sourceRefHtml(anchorKeys, blobBase)` returns the inline `<p class="lw-source-ref">…</p>` fragment — an empty string if there are no paths, otherwise one `source: <path>` link per unique path separated by ` · `. Both code paths HTML-escape the blob-base, the path, and the label.

```ts
function insertAfterFirstH1(html: string, fragment: string): string
```

`insertAfterFirstH1(html, fragment)` takes the rendered HTML and a fragment, and returns the HTML with the fragment inserted immediately after the first `</h1>` (or prepended to the HTML if there is no `</h1>` to anchor against). `renderPage` uses it to land the deep-link sources line right under the page heading.

### Headings, excerpts, and HTML escaping

`renderPage` assembles the final `PageRecord` by reading headings and an excerpt from the original body (not the rendered HTML):

```ts
function collectHeadings(body: string): string[]
```

`collectHeadings(body)` returns the list of heading texts — `#`-prefixed lines stripped of the prefix and trailing whitespace, with code spans masked first so a heading like `# foo \`bar\`` yields `foo bar`. These drive the search-index `headings` field.

```ts
function plainTextExcerpt(body: string, cap: number): string
```

`plainTextExcerpt(body, cap)` returns a search/snippet excerpt: code spans are masked, HTML comments are removed, heading lines are stripped (the H1 is already represented by the page title), Markdown link syntax is collapsed to the visible text, remaining punctuation is dropped, and whitespace is normalised — then truncated to `cap` characters. The diagram short-circuit uses a different excerpt shape: `"${title} — ${caption}"`, capped to `SEARCH_EXCERPT_CAP`.

One helper underpins all of this and is reused through the file:

```ts
function escapeHtml(text: string): string
```

`escapeHtml(text)` takes a string and returns the same string with `&`, `<`, `>`, and `"` replaced by their HTML entities. It is what lets `renderPage`, `sourceRefHtml`, and `diagramTitleAndCaption` safely interpolate user-visible strings (titles, captions, paths, blob URLs) into the HTML they build.

## Tasks.md grouping for the Implementation reference sidebar
<!-- lw:anchors packages/core/src/view.ts#parseTasksGrouping -->

The function `parseTasksGrouping` is the bridge between a project's `tasks.md` and the sidebar grouping logic that the Implementation Reference view consumes. It takes the raw text of `tasks.md` (or `null` if the file is missing) and returns a `TasksGrouping`: a per-page map that records which sidebar slot each page belongs to, plus an ordered list of subgroup names that the sidebar renders in sequence.

```ts
function parseTasksGrouping(tasksSource: string | null): TasksGrouping
```

When `tasksSource` is `null`, the function short-circuits and returns empty containers, so callers can treat "no file" identically to "file with no recognized content".

For a non-null source, the function lifts any YAML frontmatter via `parseFrontmatter` so that headings and bullets are counted from the markdown body alone; a failure during that parse is treated as "nothing in the file should contribute to the sidebar" and the function returns the empty grouping rather than throwing.

The line-by-line pass then walks the body. A pair of state variables drives the recognition of the relevant region: `inSection` tracks whether the scanner is currently inside an `## Implementation Reference` heading (compared case-insensitively and trimmed), and `currentSubgroup` holds the most recent `###` heading seen inside that region. An integer `index` increments with every accepted page so the sidebar can render items in document order regardless of subgroup.

For each line, the function first checks whether the line is an `H2` heading. If it matches, `inSection` is updated only when the trimmed heading text equals `"implementation reference"` (case-insensitive), and `currentSubgroup` is reset to `null` so any subgroup from a previous block does not leak into the next. While inside the section, an `H3` heading has two interpretations: if its text starts with a markdown link of the form `[label](relative/path.md)`, the linked page is recorded directly in `byPage` with `subgroup: null` (a stand-alone implementation entry); otherwise, when the heading text is non-empty and is not a link, the heading is treated as the name of a subgroup — `currentSubgroup` is set and, if not already present, appended to `order`. A bullet line of the form `- [label](relative/path.md)` records that page in `byPage` with `subgroup` set to `currentSubgroup` at that moment (or `null`), and increments `index`.

The returned `byPage` map and `order` array feed the sidebar: `byPage` is consulted per-page for subgroup and `tasksIndex`, and `order` is iterated to render subgroups in the sequence the author wrote them in `tasks.md`.

## Freshness badges from a single bounded git log
<!-- lw:anchors packages/core/src/view.ts#parseGitFreshnessLog packages/core/src/view.ts#applyFreshnessBadges packages/core/src/view.ts#collectFreshnessLog packages/core/src/view.ts#runGitLog -->

Freshness badges are stamped onto page records by replaying a single bounded slice of the repository's git history and folding it into a freshness window. The pipeline is intentionally narrow: one git invocation produces a flat text stream, one parser turns that stream into a per-page epoch map, and one applier walks the page list and assigns `"new"` or `"updated"` based on where each page falls inside the window handed in by the caller.

### Git log fetch

The raw signal comes from `runGitLog`:

```ts
async function runGitLog(absRoot: string, spawnImpl: SpawnImpl): Promise<string | null>
```

It takes the absolute repository root together with the spawn implementation used throughout the package, and returns the raw `git log` stdout as a string, or `null` if the process failed or exited non-zero. Internally it delegates to the shared `runGitCaptured` helper and asks git for a bounded, merge-free history scoped to the wiki tree, prefixed with `-c core.quotepath=false` so non-ASCII paths are not C-quoted. Two other flags are load-bearing: `--name-only` plus `--format=COMMIT:%ct` yield a two-record stream (`COMMIT:<epoch>` then the repo-relative paths the commit touched), and `--max-count=${FRESHNESS_LOG_MAX_COMMITS}` keeps the cost bounded even on busy repositories.

### Parsing the log

```ts
export function parseGitFreshnessLog(text: string): FreshnessLog
```

The text stream is then handed to `parseGitFreshnessLog`. It walks the text line by line. A `COMMIT:<seconds>` line opens a new "commit window": it captures the Unix epoch seconds and updates the running `maxEpoch` whenever a newer commit is seen. Subsequent non-empty lines are treated as repo-relative paths touched by that commit — because the file is already restricted to the `livewiki` subtree and git emits posix paths under `core.quotepath=false`, those lines key directly to the wiki page records (e.g. `livewiki/auth.md`). The map remembers only the first and last epoch for each page: the first time a page appears under a commit, the parser stores `{ firstEpoch, lastEpoch }`; on later appearances it overwrites `firstEpoch` but never moves `lastEpoch`, which is the most recent commit that touched the page. After the stream is exhausted, `maxEpoch` and the populated map are returned together.

### Collection wrapper

```ts
async function collectFreshnessLog(absRoot: string, spawnImpl: SpawnImpl): Promise<FreshnessLog | null>
```

The outermost wrapper awaits `runGitLog` to get the raw text, and if that result is non-null it runs it through `parseGitFreshnessLog` to produce the structured `FreshnessLog`. A null return from `runGitLog` propagates as a null here.

### Applying badges

```ts
async function applyFreshnessBadges(
  pages: PageRecord[],
  absRoot: string,
  badgeDays: number,
  spawnImpl: SpawnImpl,
): Promise<void>
```

The badges themselves are applied by `applyFreshnessBadges`. It takes the page records produced earlier, the absolute repository root, the freshness window in days, and the spawn implementation, and mutates the `badge` field on each page in place. The function first short-circuits when `!(badgeDays > 0)`, so a configured window of zero, a negative number, or a `NaN` value means no badges are computed and no git log is fetched. It then awaits `collectFreshnessLog`; if the log is missing or `maxEpoch` is zero — i.e. there were no commits at all — the function returns without touching any page. With a real log in hand it converts the window from days to seconds via `badgeDays * 86_400` and computes `windowStart` as `log.maxEpoch - badgeDays * 86_400`. For each page it looks up the page's `wikiPath` in the freshness map; pages absent from the log are skipped. A page whose `firstEpoch` sits inside the window is stamped `"new"`. Otherwise a page whose `lastEpoch` sits inside the window is stamped `"updated"`. Pages older than the window remain untouched, so the badge state itself implicitly encodes "stale".

ANY git failure — missing git, not a repo, non-zero exit, spawn throw — yields no badges, never an error: the viewer must work on any checked-out wiki.

## Shell composition, sidebar, and search index
<!-- lw:anchors packages/core/src/view.ts#renderShell packages/core/src/view.ts#buildSidebar packages/core/src/view.ts#badgeSpan packages/core/src/view.ts#buildSearchIndexJs packages/core/src/view.ts#renderViewAppJs packages/core/src/view.ts#rootPrefixFor packages/core/src/view.ts#relativeHref -->

This section assembles the static parts of every wiki page — the HTML shell, the sidebar tree, the offline search index, and the small client script that wires the interactive pieces together — and computes the relative-path prefixes that let the same assets resolve correctly no matter how deeply a page is nested.

### Relative paths

`rootPrefixFor` translates a page's output-relative path into the string of `../` segments needed to climb back to the build root. If the page lives at the top level (`outRel` has no slashes) the depth is zero and it returns the empty string; a page one directory deep yields `"../"`, and so on. Every asset reference in the shell is prefixed with this string so the same template works for the home page and for pages buried several directories down.

`relativeHref(fromOutRel, toOutRel)` does the same kind of reasoning between two output paths. It takes the directory of the source page and asks POSIX `path.relative` for the path to the target; if the two pages share a directory the relative result is empty and the function falls back to just the basename. That makes sidebar links work when the current page and the target happen to live next to each other (the result is a bare filename instead of `./foo.html`).

### Sidebar composition

`buildSidebar(pages, currentOutRel, chrome)` turns the flat list of `PageRecord`s into the navigation HTML. It first buckets pages by their `SiteGroup`, then walks the canonical `GROUP_ORDER` so the rendered order is stable regardless of how the input was produced. For the `Implementation reference` group it splits members into the unsorted "flat" pages and named subgroups, sorting the flat set by `tasksIndex` then title and ordering subgroups by the smallest `tasksIndex` of any member so subgroups appear in the order they were first authored. All other groups are sorted by title (with `wikiPath` as a tie-breaker). For each group, an inline `linkFor` produces one `<li>` per page: `relativeHref` resolves the href, the active page gets `class="active"` and `aria-current="page"`, and `badgeSpan` appends a "new" or "updated" pill when the page carries one. Groups with a single member render as a static, always-open `<div class="nav-group nav-group-static">`; groups with multiple members render as a `<details>` that is `open` when the active page lives inside it and collapsed otherwise.

### Badge pill

```ts
function badgeSpan(page: PageRecord, chrome: ViewerChrome): string
```

`badgeSpan` is the small helper behind those pills. Given a page that may or may not declare a `badge`, it returns the empty string for pages with none; otherwise it picks the localized label (`chrome.badgeNew` for `"new"`, `chrome.badgeUpdated` otherwise) and wraps it in `<span class="lw-badge lw-badge-…">` so CSS can color new and updated pills differently.

### Search index

```ts
function buildSearchIndexJs(pages: PageRecord[], chrome: ViewerChrome): string
```

`buildSearchIndexJs` is what makes the sidebar search box actually do something offline. It maps every page to a compact record — title, localized group name, output URL, headings, and excerpt text — and serializes the array as `window.SEARCH_INDEX = …;`. The client script reads that global later; keeping the data flat and pre-stringified is what allows the wiki to be served from `file://` with no server round-trip.

### Client script

```ts
function renderViewAppJs(chrome: ViewerChrome): string
```

`renderViewAppJs` is the second half of the offline story: a self-contained script the shell loads last. It bakes the localized UI strings into a table the runtime uses (search placeholder, ARIA labels, theme toggle text, "new"/"updated" badge labels, group labels). It wires four initializers: theme-toggle handling (read/modify localStorage, update `aria-pressed` and the button label); sidebar active-link re-assertion (compare `window.location.pathname` against each link, decode URI escapes, mark the match active and force its enclosing `<details>` open with `scrollIntoView`); search input handling (score each page against title/headings/excerpt, split into "title hits" and "everything else" so title matches always outrank body matches, cap at fifty, otherwise show a localized "no results" message); and Mermaid initialization (collect `pre > code.language-mermaid`, replace each with `<div class="mermaid">`, call `mermaid.initialize` with `useMaxWidth: false` and `maxTextSize: 1000000`, then `mermaid.run`; on error swap the original code block back in. When Mermaid is missing entirely, all diagram blocks are restored immediately).

### Shell assembly

```ts
function renderShell(opts: {
  template: ViewTemplate;
  page: PageRecord;
  sidebarHtml: string;
  rootPrefix: string;
  repoName: string;
  stamp: { date: string; shortSha: string } | null;
  language: string;
  chrome: ViewerChrome;
}): string
```

`renderShell` ties all of the above into a single page. Its signature takes the template name, the current `page`, the prebuilt `sidebarHtml`, the `rootPrefix` produced by `rootPrefixFor`, the repo name, an optional build stamp, the BCP-47 language, and the localized `chrome`.

It computes a `siteTitle` that special-cases a repo literally named `livewiki` (to avoid the "livewiki — livewiki docs" branding) and joins it with the page title for the `<title>` and `og:title`. The meta description reuses the page excerpt truncated to `META_DESCRIPTION_CAP`; no `og:url` or `og:image` is emitted because the build has neither the future URL nor any image assets to point at. The brand header is wrapped in an `<h1 class="brand">` on the home page (so the chrome owns the H1 there) and in a plain `<div class="brand">` on every other page (so the page's own content can be the H1). When `page.badge` is set, `badgeSpan` contributes a `<div class="page-badges">`; when `stamp` is non-null, a `<div class="site-stamp">` is rendered with the short SHA as a developer tooltip and the date as the visible text via `chrome.stampText`/`chrome.stampTooltip`; both slots are simply omitted when their data is missing.

The body lays out a two-pane shell: a `<nav class="sidebar">` holding the brand, optional stamp, the search input and theme toggle (labels and ARIA strings all drawn from `chrome`), the prebuilt `sidebarHtml` inside `#sidebar-groups`, and a hidden `<ul id="search-results">` that the search initializer will populate; and a `<main class="content">` containing the page badge (if any) followed by the page's rendered HTML. Just before `</body>`, an inline bootstrap script reads localStorage under `THEME_STORAGE_KEY`, falls back to `prefers-color-scheme`, and sets `data-theme` on `<html>` before first paint; another inline script sets `window.LIVEWIKI_ROOT` so the client script can rebuild absolute-ish URLs without knowing where the page lives. The three external scripts — `mermaid.min.js`, `search-index.js` (produced by `buildSearchIndexJs`), and `view-app.js` (produced by `renderViewAppJs`) — are loaded with the same `rootPrefix` so they resolve from any depth.

## Vendored assets: offline Mermaid runtime
<!-- lw:anchors packages/core/src/view.ts#readMermaidAsset -->

The view layer needs a way to produce Mermaid diagrams without depending on a network round-trip to a CDN, so the file bundles the Mermaid runtime as a vendored asset and reads it straight off disk. That responsibility lives in `readMermaidAsset`.

```ts
async function readMermaidAsset(): Promise<string>
```

— an asynchronous, no-argument function whose caller receives a single string of JavaScript source.

Internally it executes in four ordered steps.

First, it builds a CommonJS `require` scoped to the current module's URL via `createRequire(import.meta.url)`. The `view.ts` module is itself an ES module, but the resolution call that follows is `require.resolve("mermaid/package.json")`, which is a CommonJS-style lookup against `node_modules`. Using a locally-scoped `require` keeps the resolution rooted at this file rather than leaking global resolution behavior.

Second, the resolution itself is wrapped in `try`/`catch`. If the `mermaid` package is missing — for example because dependencies have not been installed yet — the lookup throws, and the function immediately re-throws a `ViewError` with code `"missing_mermaid_asset"` and the message `"cannot resolve the `mermaid` dependency — run \`pnpm install\` first"`. Converting a low-level module-resolution failure into a typed `ViewError` is what makes the failure mode diagnosable for callers that branch on the error code.

Third, once `pkgJsonPath` is known, the function computes the on-disk path to the vendored bundle. It takes the directory of the package's `package.json` with `nodePath.dirname`, then joins `"dist"` and the fixed filename `"mermaid.min.js"`. The result is the absolute filesystem path of the minified Mermaid distribution that ships inside the installed package.

Fourth, it reads that path with `nodeFs.readFile(dist, "utf8")` and `await`s the result. Because the read is wrapped in its own `try`/`catch`, a present-but-broken install (package metadata resolved, but the `dist/mermaid.min.js` file missing or unreadable) produces a second, more specific `ViewError`. That error uses the same `"missing_mermaid_asset"` code so callers can treat both failure shapes uniformly, while the message — `mermaid asset not found at ${dist} — run \`pnpm install\` first` — interpolates the exact path so a developer can see what was looked for.

On the success path, the function returns the file contents as a UTF-8 string, which the surrounding view code then injects as the runtime that powers offline diagram rendering.

## Tests

Covered by `packages/core/src/view.test.ts` (same-name test file on disk).
