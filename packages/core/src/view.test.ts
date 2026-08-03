/**
 * Phase 7 — unit tests for the deterministic static-site builder
 * (`view.ts`). Fixture wiki on a tmp repo; covers every behavior named in
 * the plan (docs/plans/2026-07-26-phase7-viewer.md) plus the six
 * presentation fixes from the maintainer's browser review:
 *   - site builds: index.html + per-page .html exist;
 *   - internal links rewritten to .html and resolvable within the site
 *     (section fragments land on real heading ids);
 *   - livewiki control markers stripped, `lw:manual` CONTENT kept;
 *   - mermaid asset vendored from node_modules (offline by construction);
 *   - `.mmd` sources render as mermaid code-block pages;
 *   - `%% livewiki/<path>.mmd` placeholders embed the diagram INLINE;
 *   - search index contains every wiki artifact;
 *   - template switch = identical content fragments, different CSS;
 *   - dot-prefixed pages render;
 *   - sidebar mirrors the canonical tasks.md grouping;
 *   - active page marked (class + aria-current) in the sidebar;
 *   - brand/title carry the repository name + " — livewiki docs";
 *   - light/dark palettes via CSS custom properties + persisted toggle;
 *   - multi-item groups collapsible (<details>), open when active;
 *   - diagrams render at natural size with horizontal scroll;
 *   - default output under `.livewiki/site/` (safe-io allowlist);
 *   - missing wiki / invalid --out → ViewError.
 *   - roadmap item 17: version stamp from one bounded git log; source
 *     deep-links (frontmatter `anchors:` Sources line + lw:anchors marker
 *     replacement) when a GitHub remote is known;
 *   - roadmap item 18: `--ref` builds from `git ls-tree`/`git show`
 *     (read-only), badges off, invalid ref → ViewError("invalid_ref").
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import * as nodePath from "node:path";
import * as nodeOs from "node:os";
import * as nodeFs from "node:fs/promises";
import {
  buildSite,
  ViewError,
  THEME_STORAGE_KEY,
  parseWikiStamp,
  normalizeGitHubRemote,
  filterWikiArtifactPaths,
  type BuildSiteResult,
} from "./view.js";
import { recordUpdateMetric } from "./update-metrics.js";
import type { SpawnImpl } from "./risk.js";

let repoRoot: string;

beforeEach(async () => {
  repoRoot = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "livewiki-view-"));
});

afterEach(async () => {
  await nodeFs.rm(repoRoot, { recursive: true, force: true });
});

async function writeWiki(rel: string, content: string): Promise<void> {
  const abs = nodePath.join(repoRoot, rel);
  await nodeFs.mkdir(nodePath.dirname(abs), { recursive: true });
  await nodeFs.writeFile(abs, content, "utf8");
}

async function writeFixtureWiki(): Promise<void> {
  await writeWiki(
    "livewiki/quickstart.md",
    [
      "---",
      "title: Quickstart",
      "owner: generated",
      "---",
      "",
      "# Quickstart",
      "",
      "Start with [Auth](auth.md) or the [CLI flow](flows/cli-auth.md).",
      "",
      "<!-- livewiki:navigate:start -->",
      "## Navigate",
      "",
      "- [Tasks](tasks.md)",
      "<!-- livewiki:navigate:end -->",
      "",
    ].join("\n"),
  );
  await writeWiki(
    "livewiki/auth.md",
    [
      "---",
      "title: Authentication",
      "owner: mixed",
      "anchors:",
      "  - src/auth/login.ts",
      "---",
      "",
      "# Authentication",
      "",
      "Handles login. See [the flow](flows/cli-auth.md#happy-path) and [Billing](billing.md).",
      "",
      "## Token validation",
      "<!-- lw:anchors src/auth/login.ts#validateToken -->",
      "Text about validation.",
      "",
      "<!-- lw:manual -->",
      "HUMAN NOTES: local certificates required.",
      "<!-- /lw:manual -->",
      "",
      "```mermaid",
      "graph TD",
      "  A --> B",
      "```",
      "",
    ].join("\n"),
  );
  await writeWiki(
    "livewiki/billing.md",
    ["---", "title: Billing", "---", "", "# Billing", "", "Charges users.", ""].join("\n"),
  );
  await writeWiki(
    "livewiki/tasks.md",
    [
      "---",
      "title: Tasks",
      "owner: generated",
      "---",
      "",
      "# Tasks",
      "",
      "## Implementation reference",
      "",
      "### Source",
      "",
      "- [Authentication](auth.md)",
      "- [Billing](billing.md)",
      "",
    ].join("\n"),
  );
  await writeWiki(
    "livewiki/flows/cli-auth.md",
    [
      "---",
      "title: CLI auth flow",
      "---",
      "",
      "# CLI auth flow",
      "",
      "## Happy path",
      "",
      "It works.",
      "",
      "## Diagram",
      "",
      "```mermaid",
      "%% livewiki/diagrams/flow-cli-auth.mmd",
      "```",
      "",
    ].join("\n"),
  );
  await writeWiki("livewiki/flows/index.md", "# Flows\n\n- [CLI auth flow](cli-auth.md)\n");
  await writeWiki("livewiki/topics/observability.md", "# Observability\n\nSignals.\n");
  await writeWiki("livewiki/auxiliary/index.md", "# Auxiliary modules\n\n- [Tooling](tooling.md)\n");
  await writeWiki("livewiki/auxiliary/tooling.md", "# Tooling\n\nScripts.\n");
  await writeWiki(
    "livewiki/architecture/overview.md",
    "# Architecture overview\n\nSee [structure](structure.mmd) and the [auth diagram](../diagrams/flow-cli-auth.mmd).\n",
  );
  await writeWiki("livewiki/architecture/structure.mmd", "graph TD\n  A --> B\n");
  await writeWiki("livewiki/diagrams/flow-cli-auth.mmd", "sequenceDiagram\n  CLI->>Core: run\n");
  await writeWiki("livewiki/.github.md", "# GitHub config\n\nCI and workflows.\n");
}

async function readSite(outDir: string, rel: string): Promise<string | null> {
  try {
    return await nodeFs.readFile(nodePath.join(outDir, rel), "utf8");
  } catch {
    return null;
  }
}

async function siteFileExists(outDir: string, rel: string): Promise<boolean> {
  return (await readSite(outDir, rel)) !== null;
}

/** Extract the template-independent content fragment of a page shell. */
function extractMain(html: string): string {
  const m = html.match(/<main class="content">([\s\S]*?)<\/main>/);
  if (!m) throw new Error("no <main> fragment in shell");
  return m[1]!;
}

function parseSearchIndex(js: string): Array<Record<string, unknown>> {
  const m = js.match(/^window\.SEARCH_INDEX = ([\s\S]*);\s*$/);
  if (!m) throw new Error("search-index.js does not match the window.SEARCH_INDEX contract");
  return JSON.parse(m[1]!) as Array<Record<string, unknown>>;
}

describe("view.buildSite", () => {
  it("builds the full site: index.html, one .html per artifact, all assets", async () => {
    await writeFixtureWiki();
    const outDir = nodePath.join(repoRoot, "site-out");
    const result = await buildSite({ repoRoot, outDir });

    expect(result.ok).toBe(true);
    expect(result.template).toBe("agent");
    const expectedPages = [
      "index.html", // quickstart.md
      "pages/auth.html",
      "pages/billing.html",
      "pages/tasks.html",
      "pages/flows/cli-auth.html",
      "pages/flows/index.html",
      "pages/topics/observability.html",
      "pages/auxiliary/index.html",
      "pages/auxiliary/tooling.html",
      "pages/architecture/overview.html",
      "pages/architecture/structure.html", // .mmd
      "pages/diagrams/flow-cli-auth.html", // .mmd
      "pages/.github.html", // dot-prefixed page
    ];
    expect(result.pagesWritten).toBe(expectedPages.length);
    for (const rel of expectedPages) {
      expect(await siteFileExists(outDir, rel), `missing ${rel}`).toBe(true);
    }
    for (const asset of [
      "assets/view-agent.css",
      "assets/view-docs.css",
      "assets/view-app.js",
      "assets/search-index.js",
      "assets/mermaid.min.js",
    ]) {
      expect(await siteFileExists(outDir, asset), `missing ${asset}`).toBe(true);
    }
  });

  it("rewrites internal links to .html and every .html href resolves inside the site", async () => {
    await writeFixtureWiki();
    const outDir = nodePath.join(repoRoot, "site-out");
    const result = await buildSite({ repoRoot, outDir });

    const htmlFiles = result.filesWritten.filter((f) => f.endsWith(".html"));
    for (const rel of htmlFiles) {
      const html = (await readSite(outDir, rel))!;
      for (const m of html.matchAll(/href="([^"]+\.html)(#[^"]*)?"/g)) {
        const target = nodePath.posix.normalize(
          nodePath.posix.join(nodePath.posix.dirname(rel), m[1]!),
        );
        expect(
          await siteFileExists(outDir, target),
          `${rel}: href ${m[1]} does not resolve inside the site`,
        ).toBe(true);
      }
    }

    // Section fragments land on real heading ids (verify's slugify).
    const auth = (await readSite(outDir, "pages/auth.html"))!;
    expect(auth).toContain('href="flows/cli-auth.html#happy-path"');
    const flow = (await readSite(outDir, "pages/flows/cli-auth.html"))!;
    expect(flow).toContain('id="happy-path"');
    // .mmd links point at the mermaid code-block page.
    const overview = (await readSite(outDir, "pages/architecture/overview.html"))!;
    expect(overview).toContain('href="structure.html"');
    expect(overview).toContain('href="../diagrams/flow-cli-auth.html"');
  });

  it("strips livewiki control markers but keeps lw:manual CONTENT", async () => {
    await writeFixtureWiki();
    const outDir = nodePath.join(repoRoot, "site-out");
    await buildSite({ repoRoot, outDir });

    const auth = (await readSite(outDir, "pages/auth.html"))!;
    expect(auth).not.toContain("lw:anchors");
    expect(auth).not.toContain("lw:manual");
    expect(auth).not.toContain("livewiki:");
    expect(auth).not.toContain("owner: mixed");
    expect(auth).toContain("HUMAN NOTES: local certificates required.");

    const quickstart = (await readSite(outDir, "index.html"))!;
    expect(quickstart).not.toContain("livewiki:navigate");
    // The Navigate SECTION content stays; only the markers go.
    expect(quickstart).toContain("Navigate");
    expect(quickstart).toContain('href="pages/tasks.html"');
  });

  it("vendors the mermaid asset and renders .mmd sources as mermaid code-block pages", async () => {
    await writeFixtureWiki();
    const outDir = nodePath.join(repoRoot, "site-out");
    await buildSite({ repoRoot, outDir });

    const mermaid = (await readSite(outDir, "assets/mermaid.min.js"))!;
    expect(mermaid.length).toBeGreaterThan(50_000);

    const diagram = (await readSite(outDir, "pages/diagrams/flow-cli-auth.html"))!;
    expect(diagram).toContain('class="language-mermaid"');
    expect(diagram).toContain("sequenceDiagram");

    // No CDN anywhere: scripts are local assets.
    const auth = (await readSite(outDir, "pages/auth.html"))!;
    expect(auth).not.toMatch(/src="https?:/);
    expect(auth).not.toMatch(/href="https?:/);
    expect(auth).toContain('src="../assets/mermaid.min.js"');
  });

  it("embeds %% livewiki/<path>.mmd placeholders INLINE with a source note", async () => {
    await writeFixtureWiki();
    const outDir = nodePath.join(repoRoot, "site-out");
    await buildSite({ repoRoot, outDir });

    const flow = (await readSite(outDir, "pages/flows/cli-auth.html"))!;
    // The diagram source is embedded as a mermaid block — not a
    // link-only "View diagram" presentation, not the raw placeholder.
    expect(flow).toContain('class="language-mermaid"');
    expect(flow).toContain("sequenceDiagram");
    expect(flow).toContain("CLI-&gt;&gt;Core: run");
    expect(flow).toContain("Source:");
    expect(flow).toContain("livewiki/diagrams/flow-cli-auth.mmd");
    expect(flow).not.toContain("%% livewiki/");
  });

  it("search index contains every wiki artifact with title/group/url/headings/text", async () => {
    await writeFixtureWiki();
    const outDir = nodePath.join(repoRoot, "site-out");
    const result = await buildSite({ repoRoot, outDir });

    const index = parseSearchIndex((await readSite(outDir, "assets/search-index.js"))!);
    expect(index.length).toBe(result.pagesWritten);

    const urls = index.map((e) => e["url"]).sort();
    const expected = result.filesWritten.filter((f) => f.endsWith(".html")).sort();
    expect(urls).toEqual(expected);

    const auth = index.find((e) => e["url"] === "pages/auth.html")!;
    expect(auth["title"]).toBe("Authentication");
    expect(auth["group"]).toBe("Implementation reference");
    expect(auth["headings"]).toContain("Token validation");
    expect(String(auth["text"])).toContain("Handles login");
  });

  it("template switch re-emits shell/CSS with identical content fragments", async () => {
    await writeFixtureWiki();
    const outAgent = nodePath.join(repoRoot, "site-agent");
    const outDocs = nodePath.join(repoRoot, "site-docs");
    await buildSite({ repoRoot, outDir: outAgent, template: "agent" });
    await buildSite({ repoRoot, outDir: outDocs, template: "docs" });

    for (const rel of ["index.html", "pages/auth.html", "pages/flows/cli-auth.html"]) {
      const agentHtml = (await readSite(outAgent, rel))!;
      const docsHtml = (await readSite(outDocs, rel))!;
      expect(extractMain(docsHtml), `${rel} content diverges between templates`).toBe(
        extractMain(agentHtml),
      );
      expect(agentHtml).toContain("assets/view-agent.css");
      expect(agentHtml).toContain('class="template-agent"');
      expect(docsHtml).toContain("assets/view-docs.css");
      expect(docsHtml).toContain('class="template-docs"');
    }
    // The two theme stylesheets are data and genuinely differ.
    expect((await readSite(outAgent, "assets/view-agent.css"))!).not.toBe(
      (await readSite(outAgent, "assets/view-docs.css"))!,
    );
  });

  it("marks the current page's sidebar link active (class + aria-current), others not", async () => {
    await writeFixtureWiki();
    const outDir = nodePath.join(repoRoot, "site-out");
    await buildSite({ repoRoot, outDir });

    const auth = (await readSite(outDir, "pages/auth.html"))!;
    expect(auth).toContain('<a class="active" aria-current="page" href="auth.html">');
    // Exactly one active item per page.
    expect(auth.match(/aria-current="page"/g)!.length).toBe(1);

    const index = (await readSite(outDir, "index.html"))!;
    expect(index).toContain('<a class="active" aria-current="page" href="index.html">');
    expect(index.match(/aria-current="page"/g)!.length).toBe(1);

    // The runtime JS re-asserts the marking from location.pathname and
    // scrolls the active item into view.
    const appJs = (await readSite(outDir, "assets/view-app.js"))!;
    expect(appJs).toContain("location.pathname");
    expect(appJs).toContain('scrollIntoView({ block: "nearest" })');
  });

  it("brands the site with the repository name + ' — livewiki docs'", async () => {
    await writeFixtureWiki();
    const outDir = nodePath.join(repoRoot, "site-out");
    await buildSite({ repoRoot, outDir });
    const repoName = nodePath.basename(repoRoot);
    const siteTitle = `${repoName} — livewiki docs`;

    const index = (await readSite(outDir, "index.html"))!;
    expect(index).toContain(`<title>Quickstart — ${siteTitle}</title>`);
    // The home page carries the site title as the chrome H1…
    expect(index).toContain(`<h1 class="brand"><a class="brand-link" href="index.html">${siteTitle}</a></h1>`);

    const auth = (await readSite(outDir, "pages/auth.html"))!;
    expect(auth).toContain(`<title>Authentication — ${siteTitle}</title>`);
    // …other pages keep it as a plain brand header (content owns the H1).
    expect(auth).toContain(`<div class="brand"><a class="brand-link" href="../index.html">${siteTitle}</a></div>`);
  });

  it("ships light/dark palettes as CSS custom properties with a persisted toggle", async () => {
    await writeFixtureWiki();
    const outDir = nodePath.join(repoRoot, "site-out");
    await buildSite({ repoRoot, outDir });

    for (const css of ["assets/view-agent.css", "assets/view-docs.css"]) {
      const content = (await readSite(outDir, css))!;
      expect(content, css).toContain(':root[data-theme="light"]');
      expect(content, css).toContain(':root[data-theme="dark"]');
      expect(content, css).toContain("--lw-bg:");
      expect(content, css).toContain("background: var(--lw-bg);");
    }

    const index = (await readSite(outDir, "index.html"))!;
    expect(index).toContain('id="theme-toggle"');
    // Default follows prefers-color-scheme; the choice persists.
    expect(index).toContain("prefers-color-scheme");
    expect(index).toContain(THEME_STORAGE_KEY);
    const appJs = (await readSite(outDir, "assets/view-app.js"))!;
    expect(appJs).toContain("localStorage.setItem");
    expect(appJs).toContain("data-theme");
  });

  it("renders multi-item groups as <details>, open only when containing the active page", async () => {
    await writeFixtureWiki();
    const outDir = nodePath.join(repoRoot, "site-out");
    await buildSite({ repoRoot, outDir });

    // On the home page no multi-item group contains the active page:
    // every <details> starts collapsed.
    const index = (await readSite(outDir, "index.html"))!;
    expect(index).toContain('<details class="nav-group"><summary><h2>Implementation reference</h2></summary>');
    expect(index).not.toContain("<details open");
    expect(index).not.toContain('class="nav-group" open');
    // Single-item groups are always open and NOT collapsible.
    expect(index).toContain('<div class="nav-group nav-group-static"><h2>Flows</h2><ul>');

    // On auth.html the Implementation reference group contains the active
    // page and starts open; other multi-item groups stay collapsed.
    const auth = (await readSite(outDir, "pages/auth.html"))!;
    expect(auth).toContain('<details class="nav-group" open><summary><h2>Implementation reference</h2></summary>');
    expect(auth).toContain('<details class="nav-group"><summary><h2>Diagrams</h2></summary>');
  });

  it("mirrors the canonical tasks.md grouping in the sidebar", async () => {
    await writeFixtureWiki();
    const outDir = nodePath.join(repoRoot, "site-out");
    await buildSite({ repoRoot, outDir });

    const html = (await readSite(outDir, "index.html"))!;
    expect(html).toContain("Implementation reference");
    expect(html).toContain('class="nav-subgroup"');
    expect(html).toContain("<span>Source</span>");
    // Concept topics / Flows / Auxiliary / Diagrams groups present.
    expect(html).toContain("Concept topics");
    expect(html).toContain("Flows");
    expect(html).toContain("Auxiliary");
    expect(html).toContain("Diagrams");
  });

  it("diagrams render at natural size with horizontal scroll (no shrink-to-fit)", async () => {
    await writeFixtureWiki();
    const outDir = nodePath.join(repoRoot, "site-out");
    await buildSite({ repoRoot, outDir });

    for (const css of ["assets/view-agent.css", "assets/view-docs.css"]) {
      const content = (await readSite(outDir, css))!;
      expect(content, css).toContain(".mermaid { overflow-x: auto; }");
      expect(content, css).toContain(".mermaid svg { max-width: none !important; }");
      // A CSS width/height rule on the svg would override the natural
      // pixel attributes mermaid emits under useMaxWidth:false.
      expect(content, css).not.toContain(".mermaid svg { width:");
    }
    // Natural sizing itself comes from the mermaid config: useMaxWidth
    // false makes mermaid stamp pixel dimensions instead of width="100%".
    const appJs = (await readSite(outDir, "assets/view-app.js"))!;
    expect(appJs).toContain("useMaxWidth: false");
    // maxTextSize raised: the 50k default aborts RENDERING (parse passes)
    // on legit large structure graphs.
    expect(appJs).toContain("maxTextSize: 1000000");
  });

  it("a mermaid parse error degrades to the plain code block (no error bomb)", async () => {
    await writeFixtureWiki();
    const outDir = nodePath.join(repoRoot, "site-out");
    await buildSite({ repoRoot, outDir });

    // Mermaid renders parse errors AS an svg marked
    // aria-roledescription="error" — the restore check must treat that as
    // unrendered, not as success.
    const appJs = (await readSite(outDir, "assets/view-app.js"))!;
    expect(appJs).toContain('aria-roledescription") !== "error"');
    expect(appJs).toContain("hasRenderedDiagram");
  });

  it("template typography: distinctive system font stacks + ≥1.25 type scale, no webfonts", async () => {
    await writeFixtureWiki();
    const outDir = nodePath.join(repoRoot, "site-out");
    await buildSite({ repoRoot, outDir });

    const agent = (await readSite(outDir, "assets/view-agent.css"))!;
    const docs = (await readSite(outDir, "assets/view-docs.css"))!;

    // Offline-safe: system stacks only — no webfont/CDN anywhere.
    for (const [name, css] of [["agent", agent], ["docs", docs]] as const) {
      expect(css, name).not.toContain("@import");
      expect(css, name).not.toMatch(/url\(/);
      expect(css, name).not.toContain("Roboto");
      expect(css, name).not.toContain("Inter");
    }

    // Font personality per template, defined as CSS variables.
    expect(agent).toContain('--lw-font-body: "Segoe UI", system-ui, -apple-system, sans-serif;');
    expect(agent).toContain('--lw-font-accent: "Cascadia Code", "JetBrains Mono", Consolas, monospace;');
    expect(agent).toContain('--lw-font-mono: "Cascadia Code", "JetBrains Mono", Consolas, monospace;');
    expect(docs).toContain('--lw-font-body: "Segoe UI", system-ui, -apple-system, sans-serif;');
    expect(docs).toContain('--lw-font-display: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;');

    // One shared type scale; the named steps keep a ratio ≥ 1.25.
    for (const [name, css] of [["agent", agent], ["docs", docs]] as const) {
      const step = (stepName: string): number => {
        const m = css.match(new RegExp(`--lw-text-${stepName}: ([0-9.]+)px;`));
        expect(m, `${name}: --lw-text-${stepName} defined`).not.toBeNull();
        return Number(m![1]);
      };
      const sm = step("sm");
      const base = step("base");
      const h2 = step("h2");
      const h1 = step("h1");
      expect(base / sm, `${name}: base/sm`).toBeGreaterThanOrEqual(1.25);
      expect(h2 / base, `${name}: h2/base`).toBeGreaterThanOrEqual(1.25);
      expect(h1 / h2, `${name}: h1/h2`).toBeGreaterThanOrEqual(1.25);
      // And the scale is actually applied to the content headings.
      expect(css, name).toContain(".content h1 { font-size: var(--lw-text-h1); }");
      expect(css, name).toContain(".content h2 { font-size: var(--lw-text-h2); }");
    }
  });

  it("blockquote uses a soft background tint — no thick side border", async () => {
    await writeFixtureWiki();
    const outDir = nodePath.join(repoRoot, "site-out");
    await buildSite({ repoRoot, outDir });

    for (const css of ["assets/view-agent.css", "assets/view-docs.css"]) {
      const content = (await readSite(outDir, css))!;
      expect(content, css).not.toContain("border-left: 3px");
      const rule = content.match(/\.content blockquote \{([^}]*)\}/s);
      expect(rule, `${css}: blockquote rule`).not.toBeNull();
      expect(rule![1]).toContain("background: var(--lw-code-bg);");
      expect(rule![1]).not.toContain("border-left");
    }
  });

  it("default output goes to .livewiki/site/ through the safe-io allowlist", async () => {
    await writeFixtureWiki();
    const result: BuildSiteResult = await buildSite({ repoRoot });
    expect(result.outDir).toBe(nodePath.join(nodePath.resolve(repoRoot), ".livewiki", "site"));
    expect(
      await siteFileExists(nodePath.join(repoRoot, ".livewiki", "site"), "index.html"),
    ).toBe(true);
  });

  it("rebuilds the site on every run (stale files disappear)", async () => {
    await writeFixtureWiki();
    const outDir = nodePath.join(repoRoot, "site-out");
    await buildSite({ repoRoot, outDir });
    await nodeFs.writeFile(nodePath.join(outDir, "stale.html"), "stale", "utf8");
    await buildSite({ repoRoot, outDir });
    expect(await siteFileExists(outDir, "stale.html")).toBe(false);
  });

  it("missing wiki → ViewError missing_wiki with a clear message", async () => {
    await expect(buildSite({ repoRoot, outDir: nodePath.join(repoRoot, "out") })).rejects.toThrow(
      /no livewiki\/ wiki found/,
    );
    await expect(
      buildSite({ repoRoot, outDir: nodePath.join(repoRoot, "out") }),
    ).rejects.toMatchObject({ code: "missing_wiki" });
  });

  it("rejects an --out directory inside livewiki/", async () => {
    await writeFixtureWiki();
    await expect(
      buildSite({ repoRoot, outDir: nodePath.join(repoRoot, "livewiki", "site-out") }),
    ).rejects.toMatchObject({ code: "invalid_out_dir" });
    // And one that would wipe the repository itself.
    await expect(buildSite({ repoRoot, outDir: repoRoot })).rejects.toMatchObject({
      code: "invalid_out_dir",
    });
  });

  it("rejects an unknown template", async () => {
    await writeFixtureWiki();
    await expect(
      buildSite({
        repoRoot,
        outDir: nodePath.join(repoRoot, "out"),
        template: "fancy" as never,
      }),
    ).rejects.toMatchObject({ code: "invalid_template" });
  });

  it("throws ViewError (a named Error subclass) on failure", async () => {
    await expect(buildSite({ repoRoot, outDir: nodePath.join(repoRoot, "out") })).rejects.toBeInstanceOf(
      ViewError,
    );
  });
});

// ── Freshness badges (git history) ─────────────────────────────────────────

/** Fake spawn: emits the given stdout then closes with the given code. */
function fakeSpawnOk(output: string, code = 0): SpawnImpl {
  return (() => {
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter };
    child.stdout = new EventEmitter();
    process.nextTick(() => {
      if (output.length > 0) child.stdout.emit("data", Buffer.from(output));
      child.emit("close", code);
    });
    return child;
  }) as unknown as SpawnImpl;
}

/** Fake spawn: emits an `error` (git missing / cannot spawn). */
function fakeSpawnError(): SpawnImpl {
  return (() => {
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter };
    child.stdout = new EventEmitter();
    process.nextTick(() => {
      child.emit("error", new Error("spawn git ENOENT"));
    });
    return child;
  }) as unknown as SpawnImpl;
}

const DAY_SECONDS = 86_400;
/** Fake "newest commit" epoch — the repo-relative now the badges compare against. */
const LOG_NOW = 1_800_000_000;

function gitLogOutput(commits: Array<[number, string[]]>): string {
  return commits.map(([epoch, paths]) => `COMMIT:${epoch}\n\n${paths.join("\n")}\n`).join("\n");
}

describe("view.buildSite freshness badges", () => {
  it("badges new/updated pages in the sidebar and the page header from git history", async () => {
    await writeFixtureWiki();
    const outDir = nodePath.join(repoRoot, "site-out");
    const log = gitLogOutput([
      [LOG_NOW - 1 * DAY_SECONDS, ["livewiki/billing.md"]],
      [LOG_NOW - 2 * DAY_SECONDS, ["livewiki/auth.md"]],
      [LOG_NOW - 10 * DAY_SECONDS, ["livewiki/auth.md"]],
      [LOG_NOW - 30 * DAY_SECONDS, ["livewiki/quickstart.md"]],
    ]);
    await buildSite({ repoRoot, outDir, spawnImpl: fakeSpawnOk(log) });

    const auth = (await readSite(outDir, "pages/auth.html"))!;
    // billing was born inside the 7-day window → new; auth is older but
    // changed inside the window → updated.
    expect(auth).toContain('<span class="lw-badge lw-badge-new">new</span>');
    expect(auth).toContain('<span class="lw-badge lw-badge-updated">updated</span>');
    // The active page's badge is repeated in the page header, before the H1.
    expect(auth).toMatch(
      /<main class="content">\s*<div class="page-badges"><span class="lw-badge lw-badge-updated">updated<\/span><\/div>\s*<h1/,
    );

    const index = (await readSite(outDir, "index.html"))!;
    // quickstart is old → no badge on its own link and no page header.
    expect(index).toContain('<a class="active" aria-current="page" href="index.html">Quickstart</a>');
    expect(index).not.toContain("page-badges");
    // But the sidebar still carries the other pages' badges.
    expect(index).toContain('>Billing<span class="lw-badge lw-badge-new">new</span></a>');
  });

  it("no badges when git is unavailable (spawn error / non-zero exit)", async () => {
    await writeFixtureWiki();
    for (const [name, impl] of [
      ["error", fakeSpawnError()],
      ["exit128", fakeSpawnOk("fatal: not a git repository\n", 128)],
    ] as const) {
      const outDir = nodePath.join(repoRoot, `site-${name}`);
      await buildSite({ repoRoot, outDir, spawnImpl: impl });
      const html = (await readSite(outDir, "index.html"))!;
      expect(html, name).not.toContain("lw-badge");
    }
  });

  it("badgeDays: 0 disables badges entirely (and a sync-throwing spawn breaks nothing)", async () => {
    await writeFixtureWiki();
    const outDir = nodePath.join(repoRoot, "site-out");
    const spawnThatThrows = (() => {
      throw new Error("must not be called");
    }) as unknown as SpawnImpl;
    await buildSite({ repoRoot, outDir, badgeDays: 0, spawnImpl: spawnThatThrows });
    const html = (await readSite(outDir, "index.html"))!;
    expect(html).not.toContain("lw-badge");
    // Every git probe tolerates a sync-throwing spawn: no stamp either.
    expect(html).not.toContain("site-stamp");
  });

  it("a shorter window reclassifies updated→no-badge; a wider one keeps it", async () => {
    await writeFixtureWiki();
    // The window is anchored at the NEWEST commit in the log (billing's),
    // so auth's 5-day-old change falls inside 7 days but outside 3.
    const log = gitLogOutput([
      [LOG_NOW, ["livewiki/billing.md"]],
      [LOG_NOW - 5 * DAY_SECONDS, ["livewiki/auth.md"]],
      [LOG_NOW - 30 * DAY_SECONDS, ["livewiki/auth.md"]],
    ]);
    const wide = nodePath.join(repoRoot, "site-wide");
    await buildSite({ repoRoot, outDir: wide, badgeDays: 7, spawnImpl: fakeSpawnOk(log) });
    expect((await readSite(wide, "pages/auth.html"))!).toContain("lw-badge-updated");

    const narrow = nodePath.join(repoRoot, "site-narrow");
    await buildSite({ repoRoot, outDir: narrow, badgeDays: 3, spawnImpl: fakeSpawnOk(log) });
    const narrowAuth = (await readSite(narrow, "pages/auth.html"))!;
    // auth itself is outside the 3-day window: no own badge in the sidebar
    // and no page header (billing's "new" pill still shows in the sidebar).
    expect(narrowAuth).not.toContain("page-badges");
    expect(narrowAuth).not.toContain("lw-badge-updated");
  });

  it("same git state rebuilds byte-identical pages", async () => {
    await writeFixtureWiki();
    const log = gitLogOutput([
      [LOG_NOW - DAY_SECONDS, ["livewiki/billing.md"]],
      [LOG_NOW - 2 * DAY_SECONDS, ["livewiki/auth.md"]],
      [LOG_NOW - 10 * DAY_SECONDS, ["livewiki/auth.md"]],
    ]);
    const outA = nodePath.join(repoRoot, "site-a");
    const outB = nodePath.join(repoRoot, "site-b");
    await buildSite({ repoRoot, outDir: outA, spawnImpl: fakeSpawnOk(log) });
    await buildSite({ repoRoot, outDir: outB, spawnImpl: fakeSpawnOk(log) });
    for (const rel of ["index.html", "pages/auth.html", "pages/billing.html"]) {
      expect(await readSite(outA, rel), rel).toBe(await readSite(outB, rel));
    }
  });
});

// ── OG/social meta ──────────────────────────────────────────────────────────

describe("view.buildSite OG/social meta", () => {
  it("emits static OG/twitter meta in every page head (no og:url, no og:image)", async () => {
    await writeFixtureWiki();
    const outDir = nodePath.join(repoRoot, "site-out");
    await buildSite({ repoRoot, outDir });
    const siteTitle = `${nodePath.basename(repoRoot)} — livewiki docs`;

    const index = (await readSite(outDir, "index.html"))!;
    expect(index).toContain(`<meta property="og:title" content="Quickstart — ${siteTitle}">`);
    expect(index).toContain('<meta property="og:type" content="website">');
    expect(index).toContain(`<meta property="og:site_name" content="${siteTitle}">`);
    expect(index).toContain('<meta name="twitter:card" content="summary">');
    // The description reuses the search excerpt (markdown stripped).
    expect(index).toMatch(/<meta name="description" content="[^"]*Start with Auth or the CLI flow/);
    expect(index).toMatch(/<meta property="og:description" content="[^"]*Start with Auth or the CLI flow/);
    // Deliberately absent: unknown at build time / offline posture.
    expect(index).not.toContain("og:url");
    expect(index).not.toContain("og:image");
  });

  it("escapes ampersands, quotes and angle brackets in titles and excerpts", async () => {
    await writeWiki("livewiki/quickstart.md", "# Home\n\nOverview.\n");
    await writeWiki(
      "livewiki/tricky.md",
      '# Auth & "Login" <flow>\n\nTom & Jerry <3 "docs".\n',
    );
    const outDir = nodePath.join(repoRoot, "site-out");
    await buildSite({ repoRoot, outDir });
    const html = (await readSite(outDir, "pages/tricky.html"))!;
    expect(html).toContain(
      '<meta property="og:title" content="Auth &amp; &quot;Login&quot; &lt;flow&gt; — ',
    );
    expect(html).toContain('Tom &amp; Jerry &lt;3 &quot;docs&quot;.');
    expect(html).not.toContain('content="Auth & "');
  });

  it("trims the meta description to ~200 chars", async () => {
    await writeWiki("livewiki/quickstart.md", "# Home\n\nShort.\n");
    await writeWiki("livewiki/long.md", `# Long\n\n${"lorem ipsum dolor sit amet ".repeat(40)}\n`);
    const outDir = nodePath.join(repoRoot, "site-out");
    await buildSite({ repoRoot, outDir });
    const html = (await readSite(outDir, "pages/long.html"))!;
    const m = html.match(/<meta name="description" content="([^"]*)">/);
    expect(m).not.toBeNull();
    expect(m![1]!.length).toBeLessThanOrEqual(200);
  });
});

// ── Activity dashboard (roadmap item 15) ────────────────────────────────────

describe("view.buildSite Activity dashboard", () => {
  it("emits activity.html + Activity sidebar group + search entry from the ledger", async () => {
    await writeWiki("livewiki/quickstart.md", "# Home\n\nOverview.\n");
    await nodeFs.mkdir(nodePath.join(repoRoot, ".livewiki"), { recursive: true });
    await recordUpdateMetric(repoRoot, {
      kind: "package_emitted",
      timestamp: Date.UTC(2026, 0, 5, 10, 0, 0),
      tokensEstimated: 800,
      bytes: 0,
      debtCount: 3,
    });
    await recordUpdateMetric(repoRoot, {
      kind: "batch_run",
      timestamp: Date.UTC(2026, 0, 6, 10, 0, 0),
      runId: 1,
      status: "completed",
      inputTokens: 10_000,
      outputTokens: 2_000,
      costUsd: 1.5,
      durationMs: 1000,
      tasksDone: 5,
      tasksFailed: 0,
    });
    const outDir = nodePath.join(repoRoot, "site-out");
    const result = await buildSite({ repoRoot, outDir });

    expect(result.filesWritten).toContain("activity.html");
    const activity = (await readSite(outDir, "activity.html"))!;
    expect(activity).toContain("<h1>Activity</h1>");
    expect(activity).toContain("Tokens per week");
    expect(activity).toContain("12,000"); // batch in+out grouped
    expect(activity).toContain("$1.50");
    // The sidebar marks the synthetic page active (class + aria-current).
    expect(activity).toContain('href="activity.html"');
    expect(activity).toContain('aria-current="page"');
    // The home page sidebar links to the Activity group.
    const index = (await readSite(outDir, "index.html"))!;
    expect(index).toContain("<h2>Activity</h2>");
    expect(index).toContain('href="activity.html"');
    // Offline search index carries the synthetic page.
    const search = (await readSite(outDir, "assets/search-index.js"))!;
    expect(search).toContain('"url": "activity.html"');
    expect(search).toContain('"group": "Activity"');
  });

  it("omits the Activity page entirely when the ledger is missing or empty", async () => {
    await writeWiki("livewiki/quickstart.md", "# Home\n\nOverview.\n");
    const outDir = nodePath.join(repoRoot, "site-out");
    const result = await buildSite({ repoRoot, outDir });

    expect(result.filesWritten).not.toContain("activity.html");
    const index = (await readSite(outDir, "index.html"))!;
    expect(index).not.toContain("activity.html");
    expect(index).not.toContain("<h2>Activity</h2>");
    const search = (await readSite(outDir, "assets/search-index.js"))!;
    expect(search).not.toContain("activity.html");
  });
});

// ── Version stamp + source deep-links (roadmap item 17) ────────────────────

const STAMP_SHA = "a".repeat(40);
const STAMP_LOG = `${STAMP_SHA}\n2026-08-01T12:34:56+00:00\n`;

interface FakeGitRoute {
  match: (args: string[]) => boolean;
  stdout?: string;
  stderr?: string;
  code?: number;
  error?: boolean;
}

/**
 * Routing fake spawn: dispatches on the git args. Unmatched routes (or
 * `error: true`) emit a spawn `error`. Calls are recorded in `calls`.
 */
function fakeGitRouter(routes: FakeGitRoute[], calls?: string[][]): SpawnImpl {
  return ((_cmd: string, args: string[]) => {
    calls?.push(args);
    const route = routes.find((r) => r.match(args));
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    process.nextTick(() => {
      if (route === undefined || route.error === true) {
        child.emit("error", new Error("spawn git ENOENT"));
        return;
      }
      if (route.stdout) child.stdout.emit("data", Buffer.from(route.stdout));
      if (route.stderr) child.stderr.emit("data", Buffer.from(route.stderr));
      child.emit("close", route.code ?? 0);
    });
    return child;
  }) as unknown as SpawnImpl;
}

const isBadgeLog = (args: string[]): boolean => args.includes("--no-merges");
const isStampLog = (args: string[]): boolean => args.includes("-1") && args.includes("log");
const isRemoteProbe = (args: string[]): boolean => args.includes("remote");

/** Standard routes: no badges, stamp present, GitHub remote (https form). */
function stampRoutes(remoteUrl = "https://github.com/acme/widgets.git\n"): FakeGitRoute[] {
  return [
    { match: isBadgeLog, stdout: "" },
    { match: isStampLog, stdout: STAMP_LOG },
    { match: isRemoteProbe, stdout: remoteUrl },
  ];
}

async function writeDeepLinkWiki(): Promise<void> {
  await writeWiki("livewiki/quickstart.md", "# Quickstart\n\nStart here.\n");
  await writeWiki(
    "livewiki/auth.md",
    [
      "---",
      "title: Authentication",
      "anchors:",
      "  - src/auth/session.ts#createSession",
      "  - src/auth/login.ts#validateToken",
      "  - src/auth/login.ts#login",
      "---",
      "",
      "# Authentication",
      "",
      "Handles login.",
      "",
      "## Token validation",
      "<!-- lw:anchors src/auth/login.ts#validateToken -->",
      "Text about validation.",
      "",
    ].join("\n"),
  );
}

describe("view.buildSite version stamp (roadmap item 17)", () => {
  it("renders 'Updated on <date> · Commit <short-sha>' under the brand from one git log call", async () => {
    await writeDeepLinkWiki();
    const outDir = nodePath.join(repoRoot, "site-out");
    await buildSite({ repoRoot, outDir, spawnImpl: fakeGitRouter(stampRoutes()) });

    const index = (await readSite(outDir, "index.html"))!;
    expect(index).toContain(
      `<div class="site-stamp">Updated on 2026-08-01 · Commit ${STAMP_SHA.slice(0, 7)}</div>`,
    );
    const auth = (await readSite(outDir, "pages/auth.html"))!;
    expect(auth).toContain("Updated on 2026-08-01");
  });

  it("no stamp when the git log probe fails (spawn error / non-zero exit / garbage)", async () => {
    await writeDeepLinkWiki();
    for (const [name, impl] of [
      ["error", fakeSpawnError()],
      ["exit128", fakeSpawnOk("fatal: not a git repository\n", 128)],
      ["garbage", fakeSpawnOk("COMMIT:1800000000\n\nlivewiki/auth.md\n")],
    ] as const) {
      const outDir = nodePath.join(repoRoot, `site-${name}`);
      await buildSite({ repoRoot, outDir, spawnImpl: impl });
      const html = (await readSite(outDir, "index.html"))!;
      expect(html, name).not.toContain("site-stamp");
    }
  });
});

describe("view.buildSite source deep-links (roadmap item 17)", () => {
  it("renders a deduped sorted Sources line after the H1 with GitHub blob URLs (https remote)", async () => {
    await writeDeepLinkWiki();
    const outDir = nodePath.join(repoRoot, "site-out");
    await buildSite({ repoRoot, outDir, spawnImpl: fakeGitRouter(stampRoutes()) });

    const auth = (await readSite(outDir, "pages/auth.html"))!;
    const blob = `https://github.com/acme/widgets/blob/${STAMP_SHA}`;
    // Unique file paths (symbol suffix dropped), sorted, right after the H1.
    expect(auth).toContain(
      `</h1>\n<p class="lw-sources">Sources: ` +
        `<a href="${blob}/src/auth/login.ts"><code>src/auth/login.ts</code></a> · ` +
        `<a href="${blob}/src/auth/session.ts"><code>src/auth/session.ts</code></a></p>`,
    );
    // The lw:anchors marker becomes a source link instead of being stripped.
    expect(auth).toContain(
      `<p class="lw-source-ref"><a href="${blob}/src/auth/login.ts">source: src/auth/login.ts</a></p>`,
    );
    expect(auth).not.toContain("lw:anchors");
    // The quickstart has no frontmatter anchors → no Sources line there.
    const index = (await readSite(outDir, "index.html"))!;
    expect(index).not.toContain("lw-sources");
  });

  it("normalizes the git@ remote form (and .git-less https) to the same blob base", async () => {
    await writeDeepLinkWiki();
    for (const [name, remote] of [
      ["ssh", "git@github.com:acme/widgets.git\n"],
      ["https-no-suffix", "https://github.com/acme/widgets\n"],
    ] as const) {
      const outDir = nodePath.join(repoRoot, `site-${name}`);
      await buildSite({ repoRoot, outDir, spawnImpl: fakeGitRouter(stampRoutes(remote)) });
      const auth = (await readSite(outDir, "pages/auth.html"))!;
      expect(auth, name).toContain(
        `https://github.com/acme/widgets/blob/${STAMP_SHA}/src/auth/login.ts`,
      );
    }
  });

  it("no deep links without a GitHub remote (stamp still rendered, markers stripped as before)", async () => {
    await writeDeepLinkWiki();
    for (const [name, remote] of [
      ["non-github", "https://gitlab.com/acme/widgets.git\n"],
      ["no-remote", ""],
    ] as const) {
      const outDir = nodePath.join(repoRoot, `site-${name}`);
      await buildSite({ repoRoot, outDir, spawnImpl: fakeGitRouter(stampRoutes(remote)) });
      const auth = (await readSite(outDir, "pages/auth.html"))!;
      expect(auth, name).not.toContain("lw-sources");
      expect(auth, name).not.toContain("lw-source-ref");
      expect(auth, name).not.toContain("github.com");
      expect(auth, name).not.toContain("lw:anchors");
      expect(auth, name).toContain("site-stamp");
    }
  });

  it("pure helpers: parseWikiStamp and normalizeGitHubRemote", async () => {
    expect(parseWikiStamp(STAMP_LOG)).toEqual({ sha: STAMP_SHA, date: "2026-08-01" });
    expect(parseWikiStamp("")).toBeNull();
    expect(parseWikiStamp("not-a-sha\n2026-08-01T00:00:00Z\n")).toBeNull();
    expect(parseWikiStamp(`${STAMP_SHA}\nnot-a-date\n`)).toBeNull();

    expect(normalizeGitHubRemote("https://github.com/o/r.git")).toBe("https://github.com/o/r");
    expect(normalizeGitHubRemote("https://github.com/o/r")).toBe("https://github.com/o/r");
    expect(normalizeGitHubRemote("git@github.com:o/r.git")).toBe("https://github.com/o/r");
    expect(normalizeGitHubRemote("git@github.com:o/r")).toBe("https://github.com/o/r");
    expect(normalizeGitHubRemote("https://gitlab.com/o/r.git")).toBeNull();
    expect(normalizeGitHubRemote("")).toBeNull();
  });
});

// ── `view --ref` (roadmap item 18) ──────────────────────────────────────────

describe("view.buildSite --ref", () => {
  const REF = "v0.1";
  const REF_SHA = "b".repeat(40);
  const REF_FILES: Record<string, string> = {
    "livewiki/quickstart.md": "# Quickstart\n\nRef version quickstart.\n",
    "livewiki/auth.md": [
      "---",
      "title: Authentication",
      "anchors:",
      "  - src/auth/login.ts",
      "---",
      "",
      "# Authentication",
      "",
      "REF CONTENT handles login.",
      "",
    ].join("\n"),
    "livewiki/diagrams/flow.mmd": "graph TD\n  R --> S\n",
  };

  function refRoutes(calls?: string[][]): SpawnImpl {
    return fakeGitRouter(
      [
        {
          match: (args) => args.includes("ls-tree"),
          // The dot-directory entry must be filtered out like the disk walker.
          stdout:
            "livewiki/quickstart.md\nlivewiki/auth.md\nlivewiki/diagrams/flow.mmd\n" +
            "livewiki/.hidden/secret.md\nlivewiki/notes.txt\n",
        },
        { match: isStampLog, stdout: `${REF_SHA}\n2026-07-01T00:00:00+00:00\n` },
        { match: isRemoteProbe, stdout: "git@github.com:acme/widgets.git\n" },
        { match: isBadgeLog, stdout: "" },
      ],
      calls,
    );
  }

  /** Same routes, but serving per-path content for `git show <ref>:<path>`. */
  function refSpawn(calls?: string[][]): SpawnImpl {
    return ((cmd: string, args: string[]) => {
      if (args[0] === "show") {
        const path = String(args[1]).slice(REF.length + 1);
        const content = REF_FILES[path];
        return fakeGitRouter([
          content === undefined
            ? { match: () => true, code: 128, stderr: `fatal: path '${path}' does not exist in '${REF}'\n` }
            : { match: () => true, stdout: content },
        ])(cmd, args);
      }
      return refRoutes(calls)(cmd, args);
    }) as unknown as SpawnImpl;
  }

  it("builds the site from the ref (ls-tree + git show), never from the working tree", async () => {
    // The working tree carries a DIFFERENT wiki — the ref content must win.
    await writeWiki("livewiki/quickstart.md", "# Quickstart\n\nDISK CONTENT.\n");
    await writeWiki("livewiki/auth.md", "# Authentication\n\nDISK CONTENT handles login.\n");
    const calls: string[][] = [];
    const outDir = nodePath.join(repoRoot, "site-ref");
    const result = await buildSite({ repoRoot, outDir, ref: REF, spawnImpl: refSpawn(calls) });

    expect(result.pagesWritten).toBe(3); // .hidden/ dir and notes.txt filtered
    const index = (await readSite(outDir, "index.html"))!;
    expect(index).toContain("Ref version quickstart.");
    expect(index).not.toContain("DISK CONTENT");
    const auth = (await readSite(outDir, "pages/auth.html"))!;
    expect(auth).toContain("REF CONTENT handles login.");
    // Exactly one ls-tree enumeration; every artifact came through git show.
    expect(calls.filter((a) => a.includes("ls-tree")).length).toBe(1);
  });

  it("badges are OFF in ref mode; the stamp and deep links use the ref's commit", async () => {
    const calls: string[][] = [];
    const outDir = nodePath.join(repoRoot, "site-ref");
    await buildSite({ repoRoot, outDir, ref: REF, spawnImpl: refSpawn(calls) });

    // The working-tree badge probe is never spawned in ref mode.
    expect(calls.some((a) => a.includes("--no-merges"))).toBe(false);
    const auth = (await readSite(outDir, "pages/auth.html"))!;
    expect(auth).not.toContain("lw-badge");
    expect(auth).toContain(`Updated on 2026-07-01 · Commit ${REF_SHA.slice(0, 7)}`);
    expect(auth).toContain(`https://github.com/acme/widgets/blob/${REF_SHA}/src/auth/login.ts`);
  });

  it("an unresolvable ref throws ViewError invalid_ref with the git detail", async () => {
    const outDir = nodePath.join(repoRoot, "site-ref");
    const failing = fakeGitRouter([
      { match: (args) => args.includes("ls-tree"), code: 128, stderr: "fatal: Not a valid object name: 'bogus'\n" },
    ]);
    await expect(buildSite({ repoRoot, outDir, ref: "bogus", spawnImpl: failing })).rejects.toMatchObject({
      code: "invalid_ref",
    });
    await expect(buildSite({ repoRoot, outDir, ref: "bogus", spawnImpl: failing })).rejects.toThrow(
      /bogus/,
    );
    // Flag-like refs are rejected before any spawn.
    await expect(buildSite({ repoRoot, outDir, ref: "--help", spawnImpl: failing })).rejects.toMatchObject({
      code: "invalid_ref",
    });
  });

  it("filterWikiArtifactPaths mirrors the disk walker rules", async () => {
    expect(
      filterWikiArtifactPaths([
        "livewiki/quickstart.md",
        "livewiki/.github.md",
        "livewiki/.hidden/secret.md",
        "livewiki/notes.txt",
        "src/index.ts",
        "livewiki/diagrams/flow.mmd",
      ]),
    ).toEqual([
      "livewiki/quickstart.md",
      "livewiki/.github.md",
      "livewiki/diagrams/flow.mmd",
    ]);
  });
});
