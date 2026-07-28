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
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as nodePath from "node:path";
import * as nodeOs from "node:os";
import * as nodeFs from "node:fs/promises";
import { buildSite, ViewError, THEME_STORAGE_KEY, type BuildSiteResult } from "./view.js";

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
      expect(content, css).toContain(".mermaid svg { max-width: none !important; height: auto; }");
    }
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
