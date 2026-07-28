# Phase 7 — local viewer (`livewiki view`)

Date: 2026-07-26
Base: `main` @ `2cca5a4` (pushed; tree clean)
Contract: SPEC §"CLI commands" (`view`: `.livewiki/site/`, `--template
<agent|docs>`, `--out <dir>`, opens browser) + SPEC:1062 acceptance
("opens a navigable site in the browser with search working offline;
switching `--template` changes the look without regenerating content") +
ROADMAP ("self-contained static site, client-side search, rendered
Mermaid, no executable template code").

## Design decisions (verified)

- **Markdown → HTML at BUILD time**, not runtime. Content is canonical
  (`livewiki/**/*.md|.mmd` on disk); the viewer pre-renders each page to an
  HTML fragment. Runtime JS is only search + Mermaid + theme.
- **New dependency: `marked`** (small, zero-dep, ~40 kB) for the build-time
  MD→HTML conversion. Hand-rolling a renderer is a trap (our pages use
  tables, fences, blockquotes, nested lists). This is the one new
  dependency of the lot.
- **Offline by construction** (SPEC: search must work offline, incl.
  `file://`): the search index is emitted as a JS file
  (`window.SEARCH_INDEX = {...}`), never fetched; `mermaid.min.js` is
  **vendored from `node_modules/mermaid/dist`** (already a core
  dependency, `^11.16.0`) into the site assets — no CDN, no npm install at
  view time. Mermaid failure degrades to the plain code block.
- **Templates are data, not code**: two theme shells (`agent` dense
  technical, `docs` clean) = CSS + chrome only, sharing the same rendered
  content fragments. `--template` re-emits the shell/CSS selection without
  re-rendering content (SPEC criterion). No executable template code
  anywhere.
- **Navigation mirrors the canonical structure**: sidebar groups from the
  same inventory the exporter already enumerates (quickstart first, then
  Concept topics, Flows, Implementation reference (grouped like tasks.md),
  Auxiliary, Diagrams) — no second information architecture.
- **Output**: `.livewiki/site/` (derived cache — allowlist already covers
  `.livewiki/`) or `--out <dir>` (must sit outside `livewiki/`; validated).
  `.livewiki/site/` is disposable: rebuilt on every run, never committed
  (already ignored as part of `.livewiki/`).
- **Open browser**: cross-platform spawn (`start`/`open`/`xdg-open`,
  `shell: false`), new `--no-open` flag (tests, headless). Prints the
  path either way.

## Deliverables

1. **`packages/core/src/view.ts`** — `buildSite({ repoRoot, outDir, template })`:
   - enumerate canonical pages (same walker rules as export: `.md`/`.mmd`,
     dot-files included, `livewiki/` only);
   - per page: strip livewiki frontmatter marker lines, rewrite internal
     links `*.md` → `*.html` (same relative resolution as verify), render
     MD → HTML fragment with `marked` (GFM);
   - `.mmd` sources render as a Mermaid code block page;
   - emit `search-index.js` (`window.SEARCH_INDEX`: title, group, rel
     path, headings, plain-text excerpt per page);
   - emit assets: `view-agent.css`, `view-docs.css`, `view-app.js`
     (search + mermaid init), vendored `mermaid.min.js`;
   - emit `index.html` (shell for the chosen template) + one `.html` per
     page sharing the same chrome (sidebar from the inventory groups).
2. **`packages/cli/src/commands/view.ts`** — thin wrapper: `--template`
   (agent|docs), `--out`, `--no-open`; exit codes (0 ok, 1 failure);
   opens the browser unless `--no-open`.
3. **Tests** (`packages/core/src/view.test.ts` + CLI E2E):
   - fixture wiki → site builds: index.html + per-page .html exist, links
     rewritten to .html and resolve within the site, frontmatter markers
     stripped, mermaid asset vendored, search index contains every page;
   - template switch: identical content fragments, different CSS reference;
   - dot-prefixed pages render; missing wiki → clear error (exit 1);
   - CLI E2E with `--no-open --out <tmp>`: exit 0, files present.
4. **Docs**: SPEC Phase 7 section (design above + the `marked` dependency
   note + offline-by-construction), AGENTS.md live-state + where-to-touch.

## Non-goals

No server (`livewiki serve` stays MCP-only), no editing in the viewer,
no remote publish (export/git-host path covers that), no Mermaid SSR
(runtime render with code-block fallback), no new validation codes.

## Validation gate

`pnpm -r build && pnpm -r test` green; then a manual smoke on the run #11
MPTP corpus (`livewiki view --out C:/tmp/... --no-open`, inspect the HTML
in browser) — free, local; report screenshots/paths to the maintainer.
