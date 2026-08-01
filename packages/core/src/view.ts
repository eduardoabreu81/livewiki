/**
 * view — Phase 7: build a self-contained static site from the canonical
 * `livewiki/` wiki on disk.
 *
 * Contract (docs/plans/2026-07-26-phase7-viewer.md; SPEC §"CLI commands"):
 *
 *   - Markdown → HTML at BUILD time via `marked` (GFM). Runtime JS is only
 *     search + Mermaid + theme + sidebar state — no executable template
 *     code anywhere.
 *   - Offline by construction: the search index is emitted as
 *     `assets/search-index.js` (`window.SEARCH_INDEX = [...]`, never
 *     fetched — `file://` must work), and `mermaid.min.js` is vendored
 *     from `node_modules/mermaid/dist` (already a core dependency). No
 *     CDN links anywhere. A Mermaid failure degrades to the plain code
 *     block.
 *   - Templates are DATA: `agent` (dense technical) and `docs` (clean)
 *     are CSS + chrome only, sharing byte-identical rendered content
 *     fragments. `--template` re-emits the shell/CSS selection without
 *     re-rendering content. Light/dark mode is ORTHOGONAL to the
 *     template: CSS custom properties per palette, a toggle button in
 *     the chrome, the choice persisted in localStorage, default =
 *     prefers-color-scheme.
 *   - The sidebar mirrors the canonical structure: quickstart first, then
 *     Concept topics, Flows, Implementation reference (grouped like
 *     tasks.md — the grouping is read back from the canonical
 *     `livewiki/tasks.md`, not re-derived), Auxiliary, Diagrams.
 *     Multi-item groups are collapsible (<details>/<summary>); the group
 *     containing the active page starts open. The current page's link is
 *     marked active (class + aria-current) and scrolled into view on
 *     load, so the sidebar never jumps away from what you are reading.
 *   - Internal links `*.md`/`*.mmd` are rewritten to `*.html` with the
 *     same relative resolution as verify's `resolveWikiLink` (reused,
 *     not re-implemented). livewiki control markers (frontmatter,
 *     `<!-- livewiki:... -->` nav markers, `<!-- lw:anchors ... -->`) are
 *     stripped from the rendered output; `lw:manual` block CONTENT is
 *     kept (rule #6: human content is never dropped). `%% livewiki/<path>.mmd`
 *     placeholders are resolved and the diagram source is embedded
 *     INLINE as a mermaid block (with a small source note).
 *   - Output: `.livewiki/site/` by default (safe-io allowlist — the site
 *     is derived cache, rebuilt on every run) or `--out <dir>` (validated:
 *     must NOT be inside `livewiki/`, must not contain `livewiki/`, never
 *     the repo or a filesystem root).
 *   - Freshness badges ("new"/"updated") in the sidebar and page header
 *     come from ONE bounded `git log` over livewiki/ (offline, no LLM);
 *     epochs are compared against the newest commit in the log (never
 *     Date.now()), so the same git state rebuilds byte-identical pages.
 *     No git / any spawn failure ⇒ no badges, never an error.
 *   - Every page head carries static OG/social meta tags (description
 *     from the search excerpt, og:title/type/site_name, twitter:card) —
 *     no og:url (unknown at build time), no og:image (offline posture).
 */

import * as nodeFs from "node:fs/promises";
import * as nodeFsSync from "node:fs";
import * as nodePath from "node:path";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { Marked } from "marked";
import * as safeIo from "./safe-io.js";
import { collectWikiArtifactPaths, resolveWikiLink, isInsideWiki } from "./verify.js";
import { parseFrontmatter, type Frontmatter } from "./frontmatter.js";
import { slugify } from "./anchors.js";
import { maskCodeSpans, maskCodeSpansPreservingLength } from "./markdown-mask.js";
import type { SpawnImpl } from "./risk.js";

export const VIEW_TEMPLATES = ["agent", "docs"] as const;
export type ViewTemplate = (typeof VIEW_TEMPLATES)[number];

export const DEFAULT_TEMPLATE: ViewTemplate = "agent";
export const DEFAULT_SITE_REL = ".livewiki/site";

export type ViewErrorCode =
  | "missing_wiki"        // no livewiki/ directory or no .md pages in it
  | "invalid_template"    // --template outside VIEW_TEMPLATES
  | "invalid_out_dir"     // --out inside/containing livewiki/, repo root, fs root
  | "missing_mermaid_asset"; // node_modules/mermaid/dist/mermaid.min.js not found

export class ViewError extends Error {
  public readonly code: ViewErrorCode;
  constructor(code: ViewErrorCode, message: string) {
    super(message);
    this.name = "ViewError";
    this.code = code;
  }
}

export interface BuildSiteOptions {
  repoRoot: string;
  /** Custom output directory. Resolved against the process cwd. Default: `.livewiki/site/`. */
  outDir?: string;
  /** Theme shell. Default: `agent`. */
  template?: ViewTemplate;
  /** Days window for the git-history new/updated badges. Default 7; 0 disables badges. */
  badgeDays?: number;
  /** Injectable spawn for the git-log freshness probe (tests substitute a fake). */
  spawnImpl?: SpawnImpl;
}

export interface BuildSiteResult {
  ok: true;
  /** Absolute output directory. */
  outDir: string;
  template: ViewTemplate;
  pagesWritten: number;
  /** Every file written, relative to outDir (posix separators), sorted. */
  filesWritten: string[];
}

interface PageRecord {
  /** Canonical wiki path, e.g. `livewiki/flows/cli.md`. */
  wikiPath: string;
  /** Output path relative to the site root, e.g. `pages/flows/cli.html`. */
  outRel: string;
  title: string;
  group: SiteGroup;
  /** Implementation-reference subgroup heading from tasks.md, or null. */
  subgroup: string | null;
  /** Appearance order inside tasks.md (tie-break); MAX_SAFE_INTEGER when absent. */
  tasksIndex: number;
  /** Rendered HTML fragment (template-independent). */
  contentHtml: string;
  headings: string[];
  excerpt: string;
  /** Freshness badge from git history (absent without git data or when disabled). */
  badge?: "new" | "updated";
}

type SiteGroup =
  | "Quickstart"
  | "Concept topics"
  | "Flows"
  | "Implementation reference"
  | "Auxiliary"
  | "Diagrams"
  | "Wiki indexes";

const GROUP_ORDER: readonly SiteGroup[] = [
  "Quickstart",
  "Concept topics",
  "Flows",
  "Implementation reference",
  "Auxiliary",
  "Diagrams",
  "Wiki indexes",
];

const SEARCH_EXCERPT_CAP = 400;
/** Meta description / og:description cap (~one social-card snippet). */
const META_DESCRIPTION_CAP = 200;
/** Default new/updated badge window, in days (0 disables badges). */
export const DEFAULT_BADGE_DAYS = 7;
/** Bound for the git-log freshness probe. */
const FRESHNESS_LOG_MAX_COMMITS = 200;

/** localStorage key for the light/dark choice (read by the inline bootstrap + view-app.js). */
export const THEME_STORAGE_KEY = "livewiki-theme";

// ── Public entry point ──────────────────────────────────────────────────────

export async function buildSite(opts: BuildSiteOptions): Promise<BuildSiteResult> {
  const absRoot = nodePath.resolve(opts.repoRoot);
  const template = opts.template ?? DEFAULT_TEMPLATE;
  if (!VIEW_TEMPLATES.includes(template)) {
    throw new ViewError(
      "invalid_template",
      `unknown template "${String(opts.template)}" — expected one of: ${VIEW_TEMPLATES.join(", ")}`,
    );
  }

  const out = resolveOutDir(absRoot, opts.outDir);

  const livewikiAbs = nodePath.join(absRoot, "livewiki");
  if (!nodeFsSync.existsSync(livewikiAbs) || !nodeFsSync.statSync(livewikiAbs).isDirectory()) {
    throw new ViewError(
      "missing_wiki",
      `no livewiki/ wiki found at ${livewikiAbs} — run \`livewiki init\` first`,
    );
  }

  // Same canonical artifact set verify checks (dot-directories skipped,
  // dot-prefixed pages included, `.md` + `.mmd`).
  const artifactPaths = await collectWikiArtifactPaths(absRoot);
  const wikiPaths = [...artifactPaths].sort((a, b) => a.localeCompare(b));
  if (!wikiPaths.some((p) => p.endsWith(".md"))) {
    throw new ViewError(
      "missing_wiki",
      `no Markdown pages found under ${livewikiAbs} — run \`livewiki init\` first`,
    );
  }

  // Site identity: the repository name is the repoRoot basename
  // (deterministic — no git/config probing).
  const repoName = nodePath.basename(absRoot);

  // Implementation-reference grouping: read the canonical tasks.md back
  // instead of re-deriving clusters (no second information architecture).
  const tasksSource = artifactPaths.has("livewiki/tasks.md")
    ? await safeIo.readText(absRoot, "livewiki/tasks.md").catch(() => null)
    : null;
  const tasksGrouping = parseTasksGrouping(tasksSource);

  // `.mmd` sources are needed twice: as pages of their own AND inline into
  // pages that embed a `%% livewiki/<path>.mmd` placeholder. Read them ALL
  // first — a page can sort before the diagram it references
  // (architecture/overview.md < architecture/structure.mmd).
  const mmdSources = new Map<string, string>();
  for (const wikiPath of wikiPaths) {
    if (wikiPath.endsWith(".mmd")) {
      mmdSources.set(wikiPath, await safeIo.readText(absRoot, wikiPath));
    }
  }
  const md = createMarkdownRenderer();
  const pages: PageRecord[] = [];
  for (const wikiPath of wikiPaths) {
    const source = wikiPath.endsWith(".mmd")
      ? mmdSources.get(wikiPath)!
      : await safeIo.readText(absRoot, wikiPath);
    pages.push(await renderPage(md, wikiPath, source, artifactPaths, tasksGrouping, mmdSources));
  }

  // Freshness badges from git history (deterministic: epochs are compared
  // against the newest commit in the log, never Date.now()).
  await applyFreshnessBadges(
    pages,
    absRoot,
    opts.badgeDays ?? DEFAULT_BADGE_DAYS,
    opts.spawnImpl ?? spawn,
  );

  // Rebuilt on every run: wipe the previous site before writing.
  if (out.viaSafeIo) {
    await safeIo.remove(absRoot, DEFAULT_SITE_REL);
    await safeIo.mkdir(absRoot, DEFAULT_SITE_REL);
  } else {
    await nodeFs.rm(out.abs, { recursive: true, force: true });
    await nodeFs.mkdir(out.abs, { recursive: true });
  }

  const filesWritten: string[] = [];
  const write = async (rel: string, content: string): Promise<void> => {
    if (out.viaSafeIo) {
      await safeIo.writeText(absRoot, `${DEFAULT_SITE_REL}/${rel}`, content);
    } else {
      const abs = nodePath.join(out.abs, rel);
      await nodeFs.mkdir(nodePath.dirname(abs), { recursive: true });
      await nodeFs.writeFile(abs, content, "utf8");
    }
    filesWritten.push(rel);
  };

  // One full HTML document per page (chrome inline — `file://` navigation
  // needs no fetch). Content fragments are template-independent; only the
  // CSS reference and the body class change between themes.
  for (const page of pages) {
    const shell = renderShell({
      template,
      page,
      sidebarHtml: buildSidebar(pages, page.outRel),
      rootPrefix: rootPrefixFor(page.outRel),
      repoName,
    });
    await write(page.outRel, shell);
  }

  await write("assets/view-agent.css", AGENT_CSS);
  await write("assets/view-docs.css", DOCS_CSS);
  await write("assets/view-app.js", VIEW_APP_JS);
  await write("assets/search-index.js", buildSearchIndexJs(pages));
  await write("assets/mermaid.min.js", await readMermaidAsset());

  filesWritten.sort((a, b) => a.localeCompare(b));
  return {
    ok: true,
    outDir: out.abs,
    template,
    pagesWritten: pages.length,
    filesWritten,
  };
}

// ── Output directory ────────────────────────────────────────────────────────

interface ResolvedOutDir {
  abs: string;
  /** True when the default `.livewiki/site/` is used (safe-io allowlist). */
  viaSafeIo: boolean;
}

function resolveOutDir(absRoot: string, outDirOpt: string | undefined): ResolvedOutDir {
  if (outDirOpt === undefined) {
    return { abs: nodePath.join(absRoot, DEFAULT_SITE_REL), viaSafeIo: true };
  }
  const abs = nodePath.resolve(outDirOpt);
  const livewikiAbs = nodePath.join(absRoot, "livewiki");

  const relToLivewiki = nodePath.relative(livewikiAbs, abs);
  if (relToLivewiki === "" || (!relToLivewiki.startsWith("..") && !nodePath.isAbsolute(relToLivewiki))) {
    throw new ViewError(
      "invalid_out_dir",
      `--out directory must not be inside livewiki/: ${abs}`,
    );
  }
  const livewikiFromOut = nodePath.relative(abs, livewikiAbs);
  if (!livewikiFromOut.startsWith("..") && !nodePath.isAbsolute(livewikiFromOut)) {
    // The site is rebuilt (wiped) on every run — an output directory that
    // CONTAINS livewiki/ would destroy the wiki itself.
    throw new ViewError(
      "invalid_out_dir",
      `--out directory must not contain the repository wiki: ${abs}`,
    );
  }
  if (abs === nodePath.parse(abs).root) {
    throw new ViewError("invalid_out_dir", `--out must not be a filesystem root: ${abs}`);
  }
  return { abs, viaSafeIo: false };
}

// ── Page rendering ──────────────────────────────────────────────────────────

function createMarkdownRenderer(): Marked {
  const md = new Marked({ gfm: true });
  md.use({
    renderer: {
      // Emit heading ids matching verify's section slugs (same slugify), so
      // rewritten `page.html#section` links actually land somewhere.
      heading({ tokens, depth }): string {
        const inline = this.parser.parseInline(tokens);
        const plain = inline.replace(/<[^>]+>/g, "");
        return `<h${depth} id="${slugify(plain)}">${inline}</h${depth}>\n`;
      },
    },
  });
  return md;
}

async function renderPage(
  md: Marked,
  wikiPath: string,
  source: string,
  artifactPaths: Set<string>,
  tasksGrouping: TasksGrouping,
  mmdSources: Map<string, string>,
): Promise<PageRecord> {
  const outRel = outRelFor(wikiPath);
  const group = classifyGroup(wikiPath);

  if (wikiPath.endsWith(".mmd")) {
    // `.mmd` sources render as a page with a Mermaid code block.
    const title = deriveTitle(null, "", wikiPath);
    return {
      wikiPath,
      outRel,
      title,
      group,
      subgroup: null,
      tasksIndex: Number.MAX_SAFE_INTEGER,
      contentHtml:
        `<h1>${escapeHtml(title)}</h1>\n` +
        `<pre><code class="language-mermaid">${escapeHtml(source)}</code></pre>\n`,
      headings: [],
      excerpt: source.replace(/\s+/g, " ").trim().slice(0, SEARCH_EXCERPT_CAP),
    };
  }

  let fm: Frontmatter | null = null;
  let body = source;
  try {
    const parsed = parseFrontmatter(source);
    fm = parsed.frontmatter;
    body = parsed.body;
  } catch {
    // Malformed frontmatter — render the raw source as-is (verify owns the
    // frontmatter error surface; the viewer stays a reader).
    body = source;
  }

  const title = deriveTitle(fm, body, wikiPath);
  const cleaned = inlineMermaidPlaceholders(
    rewriteLinks(stripControlMarkers(body), wikiPath, artifactPaths),
    mmdSources,
  );
  const contentHtml = await md.parse(cleaned);
  const grouping = tasksGrouping.byPage.get(wikiPath);

  return {
    wikiPath,
    outRel,
    title,
    group,
    subgroup: group === "Implementation reference" ? (grouping?.subgroup ?? null) : null,
    tasksIndex: grouping?.index ?? Number.MAX_SAFE_INTEGER,
    contentHtml,
    headings: collectHeadings(body),
    excerpt: plainTextExcerpt(body, SEARCH_EXCERPT_CAP),
  };
}

/** `livewiki/quickstart.md` becomes the site home page; every other artifact lives under `pages/`. */
function outRelFor(wikiPath: string): string {
  if (wikiPath === "livewiki/quickstart.md") return "index.html";
  const withoutPrefix = wikiPath.startsWith("livewiki/") ? wikiPath.slice("livewiki/".length) : wikiPath;
  const base = withoutPrefix.replace(/\.(md|mmd)$/, "");
  return `pages/${base}.html`;
}

function classifyGroup(wikiPath: string): SiteGroup {
  if (wikiPath === "livewiki/quickstart.md") return "Quickstart";
  if (wikiPath.endsWith(".mmd")) return "Diagrams";
  const rel = wikiPath.startsWith("livewiki/") ? wikiPath.slice("livewiki/".length) : wikiPath;
  const name = rel.split("/").pop() ?? rel;
  if (rel.startsWith("topics/") && name !== "index.md") return "Concept topics";
  if (rel.startsWith("flows/") && name !== "index.md") return "Flows";
  if (rel.startsWith("auxiliary/") && name !== "index.md") return "Auxiliary";
  if (!rel.includes("/") && rel !== "tasks.md") return "Implementation reference";
  // tasks.md, the flows/topics/auxiliary hubs, architecture/*.md and any
  // other index-style page.
  return "Wiki indexes";
}

function deriveTitle(fm: Frontmatter | null, body: string, wikiPath: string): string {
  const fmTitle = fm?.["title"];
  if (typeof fmTitle === "string" && fmTitle.trim().length > 0) return fmTitle.trim();
  const h1 = maskCodeSpans(body).match(/^#\s+(.+?)\s*$/m);
  if (h1?.[1]) return h1[1];
  const name = wikiPath.split("/").pop() ?? wikiPath;
  return name.replace(/\.(md|mmd)$/, "");
}

/**
 * Strip livewiki control markers from the body WITHOUT touching fenced
 * code or inline code spans (a page may legitimately document the marker
 * syntax itself). Markers stripped:
 *   - `<!-- livewiki:... -->` (navigate/topics/generated markers)
 *   - `<!-- lw:anchors ... -->`
 *   - `<!-- lw:manual -->` / `<!-- /lw:manual -->` — the CONTENT between
 *     them is kept (rule #6).
 * Frontmatter is removed earlier by `parseFrontmatter`.
 */
function stripControlMarkers(body: string): string {
  const masked = maskCodeSpansPreservingLength(body);
  const re = /<!--\s*(?:livewiki:[^>]*?|lw:anchors\s+[^>]*?|lw:manual|\/lw:manual)\s*-->/g;
  let out = "";
  let last = 0;
  for (const m of masked.matchAll(re)) {
    if (m.index === undefined) continue;
    out += body.slice(last, m.index);
    last = m.index + m[0].length;
  }
  return out + body.slice(last);
}

/**
 * Rewrite internal links `*.md`/`*.mmd` → `*.html` using the exact same
 * relative resolution as verify (`resolveWikiLink` + `isInsideWiki`).
 * Links that do not resolve to an existing wiki artifact are left
 * untouched (verify owns the broken-link report). Links inside code are
 * not navigable — the scan runs on the length-preserving code mask.
 */
function rewriteLinks(body: string, fromWikiPath: string, artifactPaths: Set<string>): string {
  const masked = maskCodeSpansPreservingLength(body);
  const linkRe = /\[([^\]]*)\]\(([^)#]+\.(?:md|mmd))(#([^)]+))?\)/g;
  let out = "";
  let last = 0;
  for (const m of masked.matchAll(linkRe)) {
    if (m.index === undefined) continue;
    const original = body.slice(m.index, m.index + m[0].length);
    const linkPathRaw = m[2];
    const linkSection = m[4];
    let replacement = original;
    if (linkPathRaw) {
      const resolved = resolveWikiLink(fromWikiPath, linkPathRaw);
      if (resolved !== null && isInsideWiki(resolved) && artifactPaths.has(resolved)) {
        const href = relativeHref(outRelFor(fromWikiPath), outRelFor(resolved)) +
          (linkSection ? `#${linkSection}` : "");
        // Preserve the original link TEXT (the masked scan may have
        // blanked code spans inside it).
        const textMatch = original.match(/^\[([^\]]*)\]/);
        replacement = `[${textMatch?.[1] ?? ""}](${href})`;
      }
    }
    out += body.slice(last, m.index) + replacement;
    last = m.index + m[0].length;
  }
  return out + body.slice(last);
}

/**
 * Resolve `%% livewiki/<path>.mmd` placeholders — a fenced ```mermaid
 * block whose body is ONLY the placeholder line (the stage-5 flow-page
 * contract and the architecture overview use it) — and embed the diagram
 * source INLINE, keeping a small source note above the block. Applies
 * anywhere such a placeholder appears. A placeholder referencing a
 * missing `.mmd` is left untouched (verify owns that error surface).
 */
function inlineMermaidPlaceholders(body: string, mmdSources: Map<string, string>): string {
  const re = /```mermaid\s*\r?\n([\s\S]*?)\r?\n```/g;
  return body.replace(re, (match, inner: string) => {
    const placeholder = inner.trim().match(/^%%\s*livewiki\/(.+?\.mmd)\s*$/);
    if (!placeholder) return match;
    const mmdRel = `livewiki/${placeholder[1]}`;
    const source = mmdSources.get(mmdRel);
    if (source === undefined) return match;
    return (
      `_Source: \`${mmdRel}\`_\n\n` +
      `\`\`\`mermaid\n${source.replace(/\s+$/, "")}\n\`\`\``
    );
  });
}

// ── tasks.md grouping (Implementation reference) ────────────────────────────

interface TasksGrouping {
  /** wikiPath → subgroup heading (null = flat entry) + appearance order. */
  byPage: Map<string, { subgroup: string | null; index: number }>;
  /** Subgroup headings in canonical order. */
  order: string[];
}

/**
 * Read the `## Implementation reference` section of the canonical
 * tasks.md back: `### Heading` lines open a subgroup, `- [T](page.md)`
 * bullets join the current subgroup, and `### [T](page.md)` lines are
 * flat entries (the single-cluster contract). Both forms are emitted by
 * `generateTasksPage`/`groupTasksModules` in navigation.ts — the viewer
 * mirrors them instead of re-deriving clusters.
 */
function parseTasksGrouping(tasksSource: string | null): TasksGrouping {
  const byPage = new Map<string, { subgroup: string | null; index: number }>();
  const order: string[] = [];
  if (tasksSource === null) return { byPage, order };

  let body = tasksSource;
  try {
    body = parseFrontmatter(tasksSource).body;
  } catch {
    return { byPage, order };
  }

  let inSection = false;
  let currentSubgroup: string | null = null;
  let index = 0;
  for (const line of body.split(/\r?\n/)) {
    const h2 = line.match(/^##\s+(.+?)\s*$/);
    if (h2) {
      inSection = (h2[1] ?? "").trim().toLowerCase() === "implementation reference";
      currentSubgroup = null;
      continue;
    }
    if (!inSection) continue;
    const h3 = line.match(/^###\s+(.+?)\s*$/);
    if (h3) {
      const heading = (h3[1] ?? "").trim();
      const linked = heading.match(/^\[([^\]]*)\]\(([^)#]+\.md)\)/);
      if (linked?.[2]) {
        byPage.set(`livewiki/${linked[2]}`, { subgroup: null, index: index++ });
      } else if (heading.length > 0) {
        currentSubgroup = heading;
        if (!order.includes(heading)) order.push(heading);
      }
      continue;
    }
    const bullet = line.match(/^-\s+\[([^\]]*)\]\(([^)#]+\.md)\)/);
    if (bullet?.[2]) {
      byPage.set(`livewiki/${bullet[2]}`, { subgroup: currentSubgroup, index: index++ });
    }
  }
  return { byPage, order };
}

// ── Freshness badges (git history) ─────────────────────────────────────────

interface PageFreshness {
  /** Oldest commit epoch seen for the page (when it was born). */
  firstEpoch: number;
  /** Newest commit epoch seen for the page. */
  lastEpoch: number;
}

interface FreshnessLog {
  byPage: Map<string, PageFreshness>;
  /** Newest commit epoch in the log — the repo-relative "now". */
  maxEpoch: number;
}

/**
 * Parses `git log --no-merges --format=COMMIT:%ct --name-only` output into
 * per-page commit epochs. Pure: git walks newest → oldest, so the first
 * sighting of a path is its LATEST commit and the last its earliest.
 * Blank-line tolerant; paths outside livewiki/ are ignored by the caller's
 * page lookup, not here.
 */
export function parseGitFreshnessLog(text: string): FreshnessLog {
  const byPage = new Map<string, PageFreshness>();
  let maxEpoch = 0;
  let currentEpoch: number | null = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "") continue;
    const commit = line.match(/^COMMIT:(\d+)$/);
    if (commit) {
      currentEpoch = Number(commit[1]);
      if (currentEpoch > maxEpoch) maxEpoch = currentEpoch;
      continue;
    }
    if (currentEpoch === null) continue;
    // Git already emits repo-relative posix paths — they key the wiki
    // pages directly (`livewiki/auth.md`).
    const existing = byPage.get(line);
    if (existing === undefined) {
      byPage.set(line, { firstEpoch: currentEpoch, lastEpoch: currentEpoch });
    } else {
      existing.firstEpoch = currentEpoch;
    }
  }
  return { byPage, maxEpoch };
}

/**
 * Classifies pages as new/updated from ONE bounded git log over livewiki/
 * (the newest commit epoch in the log is the reference "now" — same git
 * state ⇒ byte-identical site). A page is "new" when its earliest seen
 * commit falls inside the window (born recently), "updated" when it is
 * older but its latest commit does. ANY git failure — missing git, not a
 * repo, non-zero exit, spawn throw — yields no badges, never an error:
 * the viewer must work on any checked-out wiki. `badgeDays <= 0` (or a
 * non-positive/NaN value) disables badges and skips the spawn entirely.
 */
async function applyFreshnessBadges(
  pages: PageRecord[],
  absRoot: string,
  badgeDays: number,
  spawnImpl: SpawnImpl,
): Promise<void> {
  if (!(badgeDays > 0)) return;
  const log = await collectFreshnessLog(absRoot, spawnImpl);
  if (log === null || log.maxEpoch === 0) return;
  const windowStart = log.maxEpoch - badgeDays * 86_400;
  for (const page of pages) {
    const fresh = log.byPage.get(page.wikiPath);
    if (fresh === undefined) continue;
    if (fresh.firstEpoch >= windowStart) page.badge = "new";
    else if (fresh.lastEpoch >= windowStart) page.badge = "updated";
  }
}

/** One bounded git spawn; returns null on ANY failure, never throws. */
async function collectFreshnessLog(absRoot: string, spawnImpl: SpawnImpl): Promise<FreshnessLog | null> {
  const text = await runGitLog(absRoot, spawnImpl);
  return text === null ? null : parseGitFreshnessLog(text);
}

function runGitLog(absRoot: string, spawnImpl: SpawnImpl): Promise<string | null> {
  return new Promise((resolve) => {
    let child: ReturnType<SpawnImpl>;
    try {
      child = spawnImpl(
        "git",
        // core.quotepath=false: without it, git C-quotes paths containing
        // non-ASCII bytes, which would never match the wiki page keys.
        [
          "-c", "core.quotepath=false",
          "log", "--no-merges",
          "--format=COMMIT:%ct",
          "--name-only",
          `--max-count=${FRESHNESS_LOG_MAX_COMMITS}`,
          "--", "livewiki",
        ],
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

// ── Shell, sidebar, search index ────────────────────────────────────────────

function renderShell(opts: {
  template: ViewTemplate;
  page: PageRecord;
  sidebarHtml: string;
  rootPrefix: string;
  repoName: string;
}): string {
  const { template, page, sidebarHtml, rootPrefix, repoName } = opts;
  const siteTitle = `${repoName} — livewiki docs`;
  const pageTitle = `${page.title} — ${siteTitle}`;
  // Static social/OG meta: no og:url (unknown at build time), no og:image
  // (no assets; offline posture). The description reuses the search excerpt.
  const description = page.excerpt.slice(0, META_DESCRIPTION_CAP);
  const brandLink = `<a class="brand-link" href="${rootPrefix}index.html">${escapeHtml(siteTitle)}</a>`;
  // The home page carries the site title as the chrome H1; other pages
  // keep it as a plain brand header (their content owns the H1).
  const brand = page.outRel === "index.html"
    ? `<h1 class="brand">${brandLink}</h1>`
    : `<div class="brand">${brandLink}</div>`;
  const headerBadge = page.badge === undefined ? "" : `<div class="page-badges">${badgeSpan(page)}</div>\n`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(pageTitle)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta property="og:title" content="${escapeHtml(pageTitle)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${escapeHtml(siteTitle)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta name="twitter:card" content="summary">
<script>(function(){var t=null;try{t=window.localStorage.getItem("${THEME_STORAGE_KEY}")}catch(e){}if(t!=="light"&&t!=="dark"){t=window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.setAttribute("data-theme",t)})();</script>
<link rel="stylesheet" href="${rootPrefix}assets/view-${template}.css">
</head>
<body class="template-${template}">
<div class="layout">
<nav class="sidebar">
<div class="sidebar-header">
${brand}
<div class="sidebar-tools">
<input id="search-input" type="search" placeholder="Search…" aria-label="Search the wiki">
<button id="theme-toggle" type="button" aria-label="Toggle light/dark mode" aria-pressed="false">Theme</button>
</div>
</div>
<div id="sidebar-groups">
${sidebarHtml}
</div>
<ul id="search-results" hidden></ul>
</nav>
<main class="content">
${headerBadge}${page.contentHtml}
</main>
</div>
<script>window.LIVEWIKI_ROOT = ${JSON.stringify(rootPrefix)};</script>
<script src="${rootPrefix}assets/mermaid.min.js"></script>
<script src="${rootPrefix}assets/search-index.js"></script>
<script src="${rootPrefix}assets/view-app.js"></script>
</body>
</html>
`;
}

function buildSidebar(pages: PageRecord[], currentOutRel: string): string {
  const byGroup = new Map<SiteGroup, PageRecord[]>();
  for (const page of pages) {
    const members = byGroup.get(page.group) ?? [];
    members.push(page);
    byGroup.set(page.group, members);
  }

  const linkFor = (page: PageRecord): string => {
    const href = relativeHref(currentOutRel, page.outRel);
    const active = page.outRel === currentOutRel;
    const attrs = active ? ` class="active" aria-current="page"` : "";
    return `<li><a${attrs} href="${href}">${escapeHtml(page.title)}${badgeSpan(page)}</a></li>`;
  };
  const byTitle = (a: PageRecord, b: PageRecord): number =>
    a.title.localeCompare(b.title) || a.wikiPath.localeCompare(b.wikiPath);

  const sections: string[] = [];
  for (const group of GROUP_ORDER) {
    const members = byGroup.get(group);
    if (!members || members.length === 0) continue;
    const items: string[] = [];
    if (group === "Implementation reference") {
      const flat = members
        .filter((p) => p.subgroup === null)
        .sort((a, b) => a.tasksIndex - b.tasksIndex || byTitle(a, b));
      for (const page of flat) items.push(linkFor(page));
      const subgroupNames = [...new Set(members.map((p) => p.subgroup).filter((s): s is string => s !== null))]
        .sort((a, b) => {
          const firstIndex = (name: string): number =>
            Math.min(...members.filter((p) => p.subgroup === name).map((p) => p.tasksIndex));
          return firstIndex(a) - firstIndex(b);
        });
      for (const name of subgroupNames) {
        const sub = members
          .filter((p) => p.subgroup === name)
          .sort((a, b) => a.tasksIndex - b.tasksIndex || byTitle(a, b));
        items.push(
          `<li class="nav-subgroup"><span>${escapeHtml(name)}</span><ul>` +
            sub.map(linkFor).join("") +
            `</ul></li>`,
        );
      }
    } else {
      for (const page of [...members].sort(byTitle)) items.push(linkFor(page));
    }
    const heading = `<h2>${escapeHtml(group)}</h2>`;
    const list = `<ul>${items.join("")}</ul>`;
    if (members.length === 1) {
      // Single-item groups are always open and not collapsible.
      sections.push(`<div class="nav-group nav-group-static">${heading}${list}</div>`);
    } else {
      // Collapsible groups: open when they contain the active page,
      // collapsed otherwise (view-app.js re-asserts this at runtime).
      const containsActive = members.some((p) => p.outRel === currentOutRel);
      sections.push(
        `<details class="nav-group"${containsActive ? " open" : ""}><summary>${heading}</summary>${list}</details>`,
      );
    }
  }
  return sections.join("\n");
}

/** Sidebar/header freshness pill markup (empty when the page has no badge). */
function badgeSpan(page: PageRecord): string {
  if (page.badge === undefined) return "";
  return `<span class="lw-badge lw-badge-${page.badge}">${page.badge}</span>`;
}

function buildSearchIndexJs(pages: PageRecord[]): string {  const entries = pages.map((page) => ({
    title: page.title,
    group: page.group,
    url: page.outRel,
    headings: page.headings,
    text: page.excerpt,
  }));
  return `window.SEARCH_INDEX = ${JSON.stringify(entries, null, 1)};\n`;
}

// ── Assets ──────────────────────────────────────────────────────────────────

/**
 * Vendor `mermaid.min.js` from the already-installed `mermaid` core
 * dependency — no CDN, no npm install at view time.
 */
async function readMermaidAsset(): Promise<string> {
  const require = createRequire(import.meta.url);
  let pkgJsonPath: string;
  try {
    pkgJsonPath = require.resolve("mermaid/package.json");
  } catch {
    throw new ViewError(
      "missing_mermaid_asset",
      "cannot resolve the `mermaid` dependency — run `pnpm install` first",
    );
  }
  const dist = nodePath.join(nodePath.dirname(pkgJsonPath), "dist", "mermaid.min.js");
  try {
    return await nodeFs.readFile(dist, "utf8");
  } catch {
    throw new ViewError(
      "missing_mermaid_asset",
      `mermaid asset not found at ${dist} — run \`pnpm install\` first`,
    );
  }
}

// ── Small utilities ─────────────────────────────────────────────────────────

function relativeHref(fromOutRel: string, toOutRel: string): string {
  const fromDir = nodePath.posix.dirname(fromOutRel);
  const rel = nodePath.posix.relative(fromDir, toOutRel);
  return rel === "" ? nodePath.posix.basename(toOutRel) : rel;
}

function rootPrefixFor(outRel: string): string {
  const depth = outRel.split("/").length - 1;
  return "../".repeat(depth);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function collectHeadings(body: string): string[] {
  const out: string[] = [];
  for (const m of maskCodeSpans(body).matchAll(/^(#{1,6})\s+(.+?)\s*$/gm)) {
    if (m[2]) out.push(m[2]);
  }
  return out;
}

function plainTextExcerpt(body: string, cap: number): string {
  const text = maskCodeSpans(body)
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/\[([^\]]*)\]\(([^)]*)\)/g, "$1")
    .replace(/[#>*_`|-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, cap);
}

// ── Static assets (data only — no executable template code) ────────────────

/**
 * Shared layout: structure + every color read through CSS custom
 * properties (`--lw-*`). Each template stylesheet defines both palettes
 * (`:root[data-theme="light"]` / `:root[data-theme="dark"]`); the inline
 * bootstrap in the shell picks one from localStorage or
 * prefers-color-scheme before first paint.
 */
const LAYOUT_CSS = `
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }

/* Shared type scale — the named steps (small → base → H2 → H1) keep a
   ratio ≥ 1.25 (12.5 → 16 → 22 → 28). H3/H4 are intermediate steps.
   Both templates use the same scale; they differ in font personality
   (--lw-font-* below) and spacing. */
:root {
  --lw-text-sm: 12.5px;
  --lw-text-base: 16px;
  --lw-text-h4: 18px;
  --lw-text-h3: 20px;
  --lw-text-h2: 22px;
  --lw-text-h1: 28px;
}

body {
  font-family: var(--lw-font-body);
  font-size: var(--lw-text-base);
  background: var(--lw-bg);
  color: var(--lw-fg);
}
.layout { display: flex; min-height: 100vh; }
.sidebar {
  width: 280px; flex: 0 0 280px; padding: 1rem; overflow-y: auto;
  height: 100vh; position: sticky; top: 0;
  background: var(--lw-sidebar-bg);
  border-right: 1px solid var(--lw-border);
}
.sidebar-header { margin-bottom: 1rem; }
.brand {
  margin: 0 0 0.5rem; font-family: var(--lw-font-display);
  font-size: var(--lw-text-h3); font-weight: 700; line-height: 1.3;
}
.brand-link { color: var(--lw-heading); text-decoration: none; }
.sidebar-tools { display: flex; gap: 0.4rem; }
#search-input {
  flex: 1 1 auto; min-width: 0; padding: 0.35rem 0.5rem;
  background: var(--lw-bg); color: var(--lw-fg);
  border: 1px solid var(--lw-border-strong); border-radius: 4px;
}
#theme-toggle {
  flex: 0 0 auto; padding: 0.35rem 0.55rem; cursor: pointer;
  background: var(--lw-bg); color: var(--lw-fg);
  border: 1px solid var(--lw-border-strong); border-radius: 4px;
}
.nav-group h2 {
  display: inline; font-family: var(--lw-font-accent);
  font-size: var(--lw-text-sm); text-transform: uppercase;
  letter-spacing: 0.05em; color: var(--lw-muted);
}
.nav-group-static > h2 { display: block; margin: 1rem 0 0.25rem; }
.nav-group > summary { margin: 1rem 0 0.25rem; cursor: pointer; }
.nav-group > summary::marker { color: var(--lw-muted); }
.nav-group ul { list-style: none; margin: 0; padding: 0; }
.nav-group li { margin: 0; }
.nav-group a {
  display: block; text-decoration: none; padding: 0.15rem 0.4rem;
  border-radius: 4px; color: var(--lw-sidebar-fg);
}
.nav-group a:hover { background: var(--lw-hover-bg); color: var(--lw-heading); }
.nav-group a.active, .nav-group a[aria-current="page"] {
  background: var(--lw-active-bg); color: var(--lw-active-fg); font-weight: 600;
}
.nav-subgroup > span {
  display: block; font-weight: 600; padding: 0.35rem 0.4rem 0.1rem;
  color: var(--lw-muted);
}
.nav-subgroup ul { list-style: none; margin: 0; padding-left: 0.75rem; }
#search-results { list-style: none; margin: 0; padding: 0; }
#search-results a { color: var(--lw-link); text-decoration: none; }
.result-group { font-size: var(--lw-text-sm); opacity: 0.65; margin-left: 0.35rem; }
.no-results { padding: 0.4rem; opacity: 0.7; }
.content { flex: 1 1 auto; min-width: 0; padding: 1.5rem 2rem; }
.content a { color: var(--lw-link); }
.content h1, .content h2, .content h3, .content h4 {
  font-family: var(--lw-font-display); color: var(--lw-heading);
}
.content h1 { font-size: var(--lw-text-h1); }
.content h2 { font-size: var(--lw-text-h2); }
.content h3 { font-size: var(--lw-text-h3); }
.content h4 { font-size: var(--lw-text-h4); }
.content img { max-width: 100%; }
.content pre {
  overflow-x: auto; padding: 0.75rem; border-radius: 6px;
  background: var(--lw-code-bg); border: 1px solid var(--lw-border);
}
.content code { font-family: var(--lw-font-mono); }
.content :not(pre) > code {
  background: var(--lw-code-bg); padding: 0.12em 0.32em; border-radius: 3px;
}
.content table { border-collapse: collapse; }
.content th, .content td { padding: 0.3rem 0.6rem; border: 1px solid var(--lw-border-strong); }
/* Soft background tint instead of a thick side border. */
.content blockquote {
  margin: 0.6em 0; padding: 0.4em 0.9em;
  background: var(--lw-code-bg); border-radius: 4px; color: var(--lw-muted);
}
.content hr { border: none; border-top: 1px solid var(--lw-border); }
/* Diagrams render at natural readable size; the container scrolls
   horizontally instead of shrinking a wide chart into illegibility.
   max-width: none needs !important to beat Mermaid's own inline
   max-width style on the svg. */
.mermaid { overflow-x: auto; }
.mermaid svg { max-width: none !important; height: auto; }
/* Freshness pill (git-history new/updated badge): a subtle outline chip
   driven by the palette variables — works in both templates/palettes. */
.lw-badge {
  display: inline-block; margin-left: 0.4em; padding: 0 0.45em;
  font-family: var(--lw-font-accent); font-size: var(--lw-text-sm);
  line-height: 1.6; border-radius: 999px; vertical-align: middle;
  border: 1px solid var(--lw-border-strong); color: var(--lw-muted);
}
.lw-badge-new {
  color: var(--lw-active-fg); border-color: var(--lw-active-fg);
  background: var(--lw-active-bg);
}
.page-badges { margin: 0 0 0.5rem; }
.page-badges .lw-badge { margin-left: 0; }
`;

const AGENT_CSS = `${LAYOUT_CSS}
/* agent — dense technical theme: neutral sans body with monospace
   accents for code and nav labels. System stacks only (offline-safe —
   no webfont/CDN). Both palettes as data; [data-theme] is set by the
   inline bootstrap (localStorage, else prefers-color-scheme). */
:root {
  --lw-font-body: "Segoe UI", system-ui, -apple-system, sans-serif;
  --lw-font-display: "Segoe UI", system-ui, -apple-system, sans-serif;
  --lw-font-accent: "Cascadia Code", "JetBrains Mono", Consolas, monospace;
  --lw-font-mono: "Cascadia Code", "JetBrains Mono", Consolas, monospace;
}
body { line-height: 1.45; }
.content h1, .content h2, .content h3, .content h4 { margin: 1em 0 0.4em; }
.content p, .content li { margin: 0.3em 0; }

:root[data-theme="dark"] {
  --lw-bg: #0f1419; --lw-fg: #c9d1d9; --lw-heading: #e6edf3;
  --lw-sidebar-bg: #11181f; --lw-sidebar-fg: #9da7b3;
  --lw-border: #21262d; --lw-border-strong: #30363d;
  --lw-muted: #7d8590; --lw-link: #58a6ff;
  --lw-hover-bg: #1c232c; --lw-active-bg: #1f6feb33; --lw-active-fg: #58a6ff;
  --lw-code-bg: #161b22;
}
:root[data-theme="light"] {
  --lw-bg: #ffffff; --lw-fg: #1f2328; --lw-heading: #1f2328;
  --lw-sidebar-bg: #f6f8fa; --lw-sidebar-fg: #3a414a;
  --lw-border: #d1d9e0; --lw-border-strong: #c3ccd6;
  --lw-muted: #59636e; --lw-link: #0969da;
  --lw-hover-bg: #e9ecf0; --lw-active-bg: #ddf4ff; --lw-active-fg: #0969da;
  --lw-code-bg: #f6f8fa;
}
`;

const DOCS_CSS = `${LAYOUT_CSS}
/* docs — clean reading theme: serif display stack for headings/brand
   with a readable sans body. System stacks only (offline-safe — no
   webfont/CDN). Both palettes as data; [data-theme] is set by the
   inline bootstrap (localStorage, else prefers-color-scheme). */
:root {
  --lw-font-body: "Segoe UI", system-ui, -apple-system, sans-serif;
  --lw-font-display: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
  --lw-font-accent: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
  --lw-font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
body { line-height: 1.65; }
.content { max-width: 860px; }
.content h1, .content h2, .content h3, .content h4 { margin: 1.4em 0 0.5em; }

:root[data-theme="light"] {
  --lw-bg: #ffffff; --lw-fg: #1f2328; --lw-heading: #1f2328;
  --lw-sidebar-bg: #f6f8fa; --lw-sidebar-fg: #3a414a;
  --lw-border: #d1d9e0; --lw-border-strong: #c3ccd6;
  --lw-muted: #59636e; --lw-link: #0969da;
  --lw-hover-bg: #e9ecf0; --lw-active-bg: #ddf4ff; --lw-active-fg: #0969da;
  --lw-code-bg: #f6f8fa;
}
:root[data-theme="dark"] {
  --lw-bg: #0f1419; --lw-fg: #c9d1d9; --lw-heading: #e6edf3;
  --lw-sidebar-bg: #11181f; --lw-sidebar-fg: #9da7b3;
  --lw-border: #21262d; --lw-border-strong: #30363d;
  --lw-muted: #7d8590; --lw-link: #58a6ff;
  --lw-hover-bg: #1c232c; --lw-active-bg: #1f6feb33; --lw-active-fg: #58a6ff;
  --lw-code-bg: #161b22;
}
`;

/**
 * Runtime JS: offline search (over `window.SEARCH_INDEX`, never fetched),
 * Mermaid rendering with plain-code-block degradation, light/dark toggle
 * (persisted in localStorage), and sidebar state (active item marked from
 * location + scrolled into view). ES2019, no dependencies beyond the
 * vendored mermaid.
 */
const VIEW_APP_JS = `(function () {
  "use strict";

  var ROOT = typeof window.LIVEWIKI_ROOT === "string" ? window.LIVEWIKI_ROOT : "";
  var THEME_KEY = "${THEME_STORAGE_KEY}";

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ── Light/dark toggle ────────────────────────────────────────────────
  // Orthogonal to the agent/docs template. The initial theme was already
  // applied by the inline bootstrap (localStorage, else
  // prefers-color-scheme); here we only wire the button and persist
  // explicit choices.
  function initTheme() {
    var button = document.getElementById("theme-toggle");
    if (!button) return;
    function current() {
      return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
    }
    function sync() {
      var theme = current();
      button.setAttribute("aria-pressed", theme === "dark" ? "true" : "false");
      button.textContent = theme === "dark" ? "Light" : "Dark";
    }
    button.addEventListener("click", function () {
      var next = current() === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      try { window.localStorage.setItem(THEME_KEY, next); } catch (e) {}
      sync();
    });
    sync();
  }

  // ── Sidebar state ────────────────────────────────────────────────────
  // Mark the current page's link active (from location.pathname vs link
  // hrefs — build-time marking is the SSR baseline, this re-asserts it),
  // make sure its collapsible group is open, and scroll it into view so
  // the sidebar never jumps away from what you are reading.
  function initSidebarState() {
    var groups = document.getElementById("sidebar-groups");
    if (!groups) return;
    var here = normalizePath(window.location.pathname);
    var links = groups.querySelectorAll("a[href]");
    var active = null;
    for (var i = 0; i < links.length; i++) {
      var link = links[i];
      var target;
      try {
        target = normalizePath(new URL(link.getAttribute("href"), window.location.href).pathname);
      } catch (e) { continue; }
      if (target === here) {
        link.classList.add("active");
        link.setAttribute("aria-current", "page");
        active = link;
      }
    }
    if (active) {
      var details = active.closest("details");
      if (details) details.open = true;
      active.scrollIntoView({ block: "nearest" });
    }
  }

  function normalizePath(pathname) {
    // file:// on Windows yields "/C:/..." on both sides of the
    // comparison, so the forms match; decodeURI covers spaces/Unicode.
    try { return decodeURI(pathname).replace(/\\\\/g, "/"); } catch (e) { return pathname; }
  }

  // ── Mermaid ──────────────────────────────────────────────────────────
  // Convert fenced mermaid code blocks to rendered diagrams. Any failure
  // (asset missing, parse error) restores the plain code block.
  function initMermaid() {
    var codes = document.querySelectorAll("pre > code.language-mermaid");
    if (!codes.length) return;
    var entries = [];
    for (var i = 0; i < codes.length; i++) {
      var code = codes[i];
      var pre = code.parentNode;
      if (!pre || !pre.parentNode) continue;
      var div = document.createElement("div");
      div.className = "mermaid";
      var source = code.textContent || "";
      div.textContent = source;
      pre.parentNode.replaceChild(div, pre);
      entries.push({ div: div, source: source });
    }
    if (!entries.length) return;

    function restore(entry) {
      if (!entry.div.parentNode) return;
      var pre = document.createElement("pre");
      var code = document.createElement("code");
      code.className = "language-mermaid";
      code.textContent = entry.source;
      pre.appendChild(code);
      entry.div.parentNode.replaceChild(pre, entry.div);
    }
    function restoreUnrendered() {
      for (var j = 0; j < entries.length; j++) {
        if (!entries[j].div.querySelector("svg")) restore(entries[j]);
      }
    }

    if (typeof mermaid === "undefined") {
      entries.forEach(restore);
      return;
    }
    try {
      mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
      Promise.resolve(mermaid.run({ nodes: entries.map(function (e) { return e.div; }) }))
        .then(restoreUnrendered)
        .catch(restoreUnrendered);
    } catch (err) {
      entries.forEach(restore);
    }
  }

  // ── Offline search ───────────────────────────────────────────────────
  function initSearch() {
    var input = document.getElementById("search-input");
    var results = document.getElementById("search-results");
    var groups = document.getElementById("sidebar-groups");
    if (!input || !results || !groups) return;
    var index = Array.isArray(window.SEARCH_INDEX) ? window.SEARCH_INDEX : [];

    input.addEventListener("input", function () {
      var query = input.value.trim().toLowerCase();
      if (!query) {
        results.hidden = true;
        results.innerHTML = "";
        groups.hidden = false;
        return;
      }
      var titleMatches = [];
      var otherMatches = [];
      for (var i = 0; i < index.length; i++) {
        var entry = index[i];
        var inTitle = entry.title.toLowerCase().indexOf(query) >= 0;
        var inHeadings = (entry.headings || []).join(" ").toLowerCase().indexOf(query) >= 0;
        var inText = (entry.text || "").toLowerCase().indexOf(query) >= 0;
        if (inTitle) titleMatches.push(entry);
        else if (inHeadings || inText) otherMatches.push(entry);
      }
      var matches = titleMatches.concat(otherMatches).slice(0, 50);
      results.innerHTML = matches.length
        ? matches.map(function (entry) {
            return '<li><a href="' + ROOT + entry.url + '">' + escapeHtml(entry.title) +
              '</a><span class="result-group">' + escapeHtml(entry.group) + "</span></li>";
          }).join("")
        : '<li class="no-results">No matches</li>';
      results.hidden = false;
      groups.hidden = true;
    });
  }

  function init() {
    initTheme();
    initSidebarState();
    initSearch();
    initMermaid();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
`;
