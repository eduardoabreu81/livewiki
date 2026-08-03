import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as nodeFs from "node:fs/promises";
import * as nodeOs from "node:os";
import * as nodePath from "node:path";
import * as safeIo from "./safe-io.js";
import { generateModulesGraph, moduleSlug } from "./diagrams.js";
import type { Module } from "./modules.js";
import {
  buildDisplayTitleFallbacks,
  buildModuleCoverageNote,
  generateAuxiliaryIndex,
  generateFlowsIndex,
  generateQuickstart,
  generateTasksPage,
  loadFlowPresentations,
  loadModuleDigests,
  loadModulePresentations,
  moduleSourceExceedsBudget,
  selectRelatedModules,
  syncAuxiliaryIndexHub,
  syncFlowsIndexHub,
  updateModuleNavigateBlocks,
} from "./navigation.js";

const modules: Module[] = [
  { id: "core-src-01", paths: ["packages/core/src/a.ts"], symbolCount: 2 },
  { id: "core-src-02", paths: ["packages/core/src/b.ts"], symbolCount: 3 },
  { id: "cli-src", paths: ["packages/cli/src/main.ts"], symbolCount: 1 },
  { id: "fixtures", paths: ["test/fixtures/sample.ts"], symbolCount: 1 },
];

describe("deterministic navigation", () => {
  let repoRoot: string;

  beforeEach(async () => {
    repoRoot = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "livewiki-navigation-"));
    await nodeFs.mkdir(nodePath.join(repoRoot, "livewiki"), { recursive: true });
  });

  afterEach(async () => {
    await nodeFs.rm(repoRoot, { recursive: true, force: true });
  });

  it("derives readable split titles without changing stable identities and is input-order independent", () => {
    const before = structuredClone(modules);
    const forward = buildDisplayTitleFallbacks(modules);
    const reversed = buildDisplayTitleFallbacks([...modules].reverse());

    expect(forward).toEqual(reversed);
    expect(forward.get("core-src-01")).toBe("Core source — part 1 of 2");
    expect(forward.get("core-src-02")).toBe("Core source — part 2 of 2");
    for (const module of modules) expect(forward.get(module.id)).not.toBe(module.id);
    expect(modules).toEqual(before);
    expect(modules.map((module) => module.id)).toEqual([
      "core-src-01",
      "core-src-02",
      "cli-src",
      "fixtures",
    ]);
    expect(moduleSlug(modules[0]!.id)).toBe("core-src-01");
    expect(generateModulesGraph([{ from: modules[0]!.id, to: modules[2]!.id }]))
      .toContain("core_src_01 --> cli_src");
  });

  it("emits the exact Quickstart route order within the size cap and without implementation-shaped lists", () => {
    const quickstart = generateQuickstart({
      totalFiles: 8,
      totalSymbols: 21,
      moduleCount: 4,
      flowPresentations: new Map(),
      hasAuxiliary: false,
    });
    const headings = [...quickstart.matchAll(/^## (.+)$/gm)].map((match) => match[1]);
    expect(headings).toEqual([
      "Work by intent",
      "Document a repo",
      "Query the wiki from an agent",
      "Pay documentation debt",
      "Repository facts",
    ]);
    expect(quickstart).toContain("[Tasks](tasks.md)");
    expect(quickstart).toContain("[Architecture overview](architecture/overview.md)");
    expect(quickstart).not.toContain("flows/index.md");
    expect(quickstart).not.toContain("auxiliary/index.md");
    expect(quickstart).not.toMatch(/Top entry points|Important symbols|Phase \d|pnpm add|npm install/);
    expect(quickstart.split("\n").filter((line) => line.trim() !== "").length).toBeLessThanOrEqual(100);
    expect(quickstart.trim().split(/\s+/).length).toBeLessThanOrEqual(700);
  });

  it("links existing flows directly and gates the flow and auxiliary hubs without breaking the route order", () => {
    const flowPresentations = new Map([
      ["b-flow", { slug: "b-flow", title: "Beta flow", modules: [] }],
      ["a-flow", { slug: "a-flow", title: "Alpha flow", modules: [] }],
    ]);
    const withFlows = generateQuickstart({
      totalFiles: 8,
      totalSymbols: 21,
      moduleCount: 4,
      flowPresentations,
      hasAuxiliary: true,
    });
    expect(withFlows).toContain("[Alpha flow](flows/a-flow.md)");
    expect(withFlows).toContain("[Beta flow](flows/b-flow.md)");
    expect(withFlows.indexOf("Alpha flow")).toBeLessThan(withFlows.indexOf("Beta flow"));
    expect(withFlows).toContain("[How it works](flows/index.md)");
    expect(withFlows).toContain("[Auxiliary modules](auxiliary/index.md)");
    expect([...withFlows.matchAll(/^## (.+)$/gm)].map((match) => match[1])).toEqual([
      "Work by intent",
      "Document a repo",
      "Query the wiki from an agent",
      "Pay documentation debt",
      "Repository facts",
    ]);
    expect(withFlows.split("\n").filter((line) => line.trim() !== "").length).toBeLessThanOrEqual(100);
    expect(withFlows.trim().split(/\s+/).length).toBeLessThanOrEqual(700);
  });

  it("places the product-orientation block first and keeps tool-meta sections after the product sections", () => {
    const quickstart = generateQuickstart({
      totalFiles: 8,
      totalSymbols: 21,
      moduleCount: 4,
      flowPresentations: new Map(),
      hasAuxiliary: false,
      orientation: {
        purpose: "MoneyPrinterTurbo-Plus turns a short topic brief into a fully rendered short video.",
        surfaces: ["Python entry point: `main.py`", "Container build file: `Dockerfile`"],
        readmePath: "README.md",
        fastPathSection: "Quick Start",
      },
    });
    const headings = [...quickstart.matchAll(/^## (.+)$/gm)].map((match) => match[1]);
    expect(headings).toEqual([
      "What this repository is",
      "Work by intent",
      "Document a repo",
      "Query the wiki from an agent",
      "Pay documentation debt",
      "Repository facts",
    ]);
    // The block is the FIRST section after the H1.
    expect(quickstart.indexOf("## What this repository is")).toBeLessThan(
      quickstart.indexOf("## Work by intent"),
    );
    expect(quickstart).toContain(
      "MoneyPrinterTurbo-Plus turns a short topic brief into a fully rendered short video.",
    );
    expect(quickstart).toContain("*(Purpose excerpt from the repository README: `README.md`.)*");
    expect(quickstart).toContain("- Python entry point: `main.py`");
    expect(quickstart).toContain("- Container build file: `Dockerfile`");
    expect(quickstart).toContain('**Fastest local path:** see the "Quick Start" section of `README.md`.');
    // Tool-meta sections stay after every product section.
    expect(quickstart.indexOf("## Document a repo")).toBeGreaterThan(quickstart.indexOf("## Work by intent"));
    expect(quickstart.split("\n").filter((line) => line.trim() !== "").length).toBeLessThanOrEqual(100);
    expect(quickstart.trim().split(/\s+/).length).toBeLessThanOrEqual(700);
  });

  it("degrades the orientation block to surfaces only when no README exists", () => {
    const quickstart = generateQuickstart({
      totalFiles: 8,
      totalSymbols: 21,
      moduleCount: 4,
      flowPresentations: new Map(),
      hasAuxiliary: false,
      orientation: {
        purpose: null,
        surfaces: ["Go module definition: `go.mod`"],
        readmePath: null,
        fastPathSection: null,
      },
    });
    expect(quickstart).toContain("## What this repository is");
    expect(quickstart).toContain("- Go module definition: `go.mod`");
    expect(quickstart).not.toContain("Purpose excerpt");
    expect(quickstart).not.toContain("Fastest local path");
  });

  it("omits the orientation block entirely without orientation evidence", () => {
    const quickstart = generateQuickstart({
      totalFiles: 8,
      totalSymbols: 21,
      moduleCount: 4,
      flowPresentations: new Map(),
      hasAuxiliary: false,
      orientation: { purpose: null, surfaces: [], readmePath: null, fastPathSection: null },
    });
    expect(quickstart).not.toContain("What this repository is");
    expect(quickstart).not.toContain("What you'll find in this wiki");
    expect([...quickstart.matchAll(/^## (.+)$/gm)].map((match) => match[1])).toEqual([
      "Work by intent",
      "Document a repo",
      "Query the wiki from an agent",
      "Pay documentation debt",
      "Repository facts",
    ]);
  });

  it("renders the reader digest after the orientation block with responsibility sentences and module links", () => {
    const quickstart = generateQuickstart({
      totalFiles: 8,
      totalSymbols: 21,
      moduleCount: 4,
      flowPresentations: new Map(),
      hasAuxiliary: false,
      orientation: {
        purpose: "A pipeline that renders short videos from topic briefs.",
        surfaces: [],
        readmePath: "README.md",
        fastPathSection: null,
      },
      moduleDigests: [
        { id: "api", title: "API handlers", responsibility: "Serves the HTTP endpoints of the product." },
        { id: "engine", title: "Render engine", responsibility: null },
      ],
    });
    const headings = [...quickstart.matchAll(/^## (.+)$/gm)].map((match) => match[1]);
    expect(headings).toEqual([
      "What this repository is",
      "What you'll find in this wiki",
      "Work by intent",
      "Document a repo",
      "Query the wiki from an agent",
      "Pay documentation debt",
      "Repository facts",
    ]);
    expect(quickstart).toContain(
      "- **[API handlers](api.md)** — Serves the HTTP endpoints of the product.",
    );
    // A module without a parseable opening contributes a title-link only.
    expect(quickstart).toContain("- **[Render engine](engine.md)**\n");
    expect(quickstart).not.toContain("Render engine](engine.md)** —");
    // With a README purpose, the fallback synthesis is not used.
    expect(quickstart).toContain("A pipeline that renders short videos from topic briefs.");
    expect(quickstart).not.toContain("Synthesized from the generated module pages");
    expect(quickstart.split("\n").filter((line) => line.trim() !== "").length).toBeLessThanOrEqual(100);
    expect(quickstart.trim().split(/\s+/).length).toBeLessThanOrEqual(700);
  });

  it("caps the reader digest at six modules", () => {
    const moduleDigests = Array.from({ length: 8 }, (_, index) => ({
      id: `mod-${index}`,
      title: `Module ${index}`,
      responsibility: `Responsibility ${index}.`,
    }));
    const quickstart = generateQuickstart({
      totalFiles: 8,
      totalSymbols: 21,
      moduleCount: 8,
      flowPresentations: new Map(),
      hasAuxiliary: false,
      moduleDigests,
    });
    expect(quickstart).toContain("## What you'll find in this wiki");
    expect(quickstart).toContain("[Module 5](mod-5.md)");
    expect(quickstart).not.toContain("[Module 6](mod-6.md)");
    expect(quickstart).not.toContain("[Module 7](mod-7.md)");
  });

  it("synthesizes the purpose from module digests when the README yields none, with provenance", () => {
    const quickstart = generateQuickstart({
      totalFiles: 8,
      totalSymbols: 21,
      moduleCount: 4,
      flowPresentations: new Map(),
      hasAuxiliary: false,
      orientation: { purpose: null, surfaces: [], readmePath: null, fastPathSection: null },
      moduleDigests: [
        { id: "api", title: "API handlers", responsibility: "serves HTTP endpoints" },
        { id: "engine", title: "Render engine", responsibility: "renders the final video" },
        { id: "cli", title: "Command line", responsibility: "drives the pipeline" },
        { id: "extra", title: "Extra tooling", responsibility: "unused fourth entry" },
      ],
    });
    expect(quickstart).toContain("## What this repository is");
    expect(quickstart).toContain(
      "This repository is organized around API handlers (serves HTTP endpoints), Render engine (renders the final video), and Command line (drives the pipeline).",
    );
    expect(quickstart).toContain("*(Synthesized from the generated module pages.)*");
    expect(quickstart).not.toContain("Purpose excerpt");
    // The synthesis uses at most three modules (the fourth still appears as
    // a reader-digest bullet, capped separately at six).
    expect(quickstart).not.toContain("Extra tooling (unused fourth entry)");
  });

  it("synthesizes a two-module purpose with 'and' and degrades honestly with no responsibilities", () => {
    const two = generateQuickstart({
      totalFiles: 8,
      totalSymbols: 21,
      moduleCount: 2,
      flowPresentations: new Map(),
      hasAuxiliary: false,
      orientation: null,
      moduleDigests: [
        { id: "a", title: "Alpha", responsibility: "does alpha work" },
        { id: "b", title: "Beta", responsibility: "does beta work" },
      ],
    });
    expect(two).toContain(
      "This repository is organized around Alpha (does alpha work) and Beta (does beta work).",
    );

    // No README and no usable responsibility: no purpose is invented, the
    // orientation block collapses and only the reader digest remains.
    const none = generateQuickstart({
      totalFiles: 8,
      totalSymbols: 21,
      moduleCount: 2,
      flowPresentations: new Map(),
      hasAuxiliary: false,
      orientation: null,
      moduleDigests: [
        { id: "a", title: "Alpha", responsibility: null },
        { id: "b", title: "Beta", responsibility: null },
      ],
    });
    expect(none).not.toContain("What this repository is");
    expect(none).toContain("## What you'll find in this wiki");
    expect(none).toContain("- **[Alpha](a.md)**\n");
  });

  it("loads module digests from accepted pages in prioritization order, skipping absent page files", async () => {
    await safeIo.writeText(repoRoot, "livewiki/core-src-01.md", [
      "---",
      "title: Authentication flow",
      "owner: generated",
      "---",
      "# Authentication flow",
      "",
      "Handles credential checks and session issuance for every request.",
      "",
      "## How it fits",
      "",
      "Sits between the router and the session store.",
    ].join("\n"));
    // core-src-02 exists on disk but has no opening paragraph → title-only.
    await safeIo.writeText(repoRoot, "livewiki/core-src-02.md", [
      "---",
      "title: Billing",
      "owner: generated",
      "---",
      "## Details",
      "",
      "No H1 and no opening paragraph here.",
    ].join("\n"));
    // cli-src has no page file at all → skipped entirely (never a broken link).
    const ordered: Module[] = [modules[2]!, modules[0]!, modules[1]!];
    const presentations = await loadModulePresentations(repoRoot, modules);
    const digests = await loadModuleDigests(repoRoot, ordered, presentations);
    expect(digests).toEqual([
      {
        id: "core-src-01",
        title: "Authentication flow",
        responsibility: "Handles credential checks and session issuance for every request.",
      },
      { id: "core-src-02", title: "Billing", responsibility: null },
    ]);
  });

  it("assembles role-separated Tasks: compact title-and-link entries for every role, honest unavailable pages", async () => {
    const cue = "- Configure authentication before enabling protected routes.";
    await safeIo.writeText(repoRoot, "livewiki/core-src-01.md", [
      "---",
      "title: Authentication flow",
      "owner: generated",
      "---",
      "# Authentication flow",
      "",
      "Handles credential checks and session issuance.",
      "",
      "## When to use this page",
      "",
      cue,
      "",
      "## Implementation",
      "",
    ].join("\n"));
    // Second product page: its opening prose is section-only content.
    await safeIo.writeText(repoRoot, "livewiki/cli-src.md", [
      "---",
      "title: CLI entry",
      "owner: generated",
      "---",
      "# CLI entry",
      "",
      "## Details",
      "",
      "Prose under a section is not part of the opening.",
      "",
    ].join("\n"));
    await safeIo.writeText(repoRoot, "livewiki/fixtures.md", [
      "---",
      "title: Sample fixtures",
      "owner: generated",
      "---",
      "# Sample fixtures",
      "",
      "Provides canned inputs for tests.",
      "",
    ].join("\n"));
    const presentations = await loadModulePresentations(repoRoot, modules);
    const flowPresentations = new Map([
      ["batch-flow", { slug: "batch-flow", title: "Batch execution", modules: ["cli-src"] }],
    ]);
    const tasks = generateTasksPage({ modules, ordered: modules, presentations, flowPresentations });
    const reorderedTasks = generateTasksPage({
      modules: [...modules].reverse(),
      ordered: modules,
      presentations,
      flowPresentations,
    });

    expect(reorderedTasks).toBe(tasks);
    expect(tasks).toContain("owner: generated");
    expect(tasks).not.toMatch(/anchors:|lw:anchors/);
    // Product page: linked display title and nothing more — never the
    // responsibility sentence, the `When to use this page` bullets, or any
    // other module-page prose.
    expect(tasks).toContain("### [Authentication flow](core-src-01.md)");
    expect(tasks).not.toContain("Handles credential checks and session issuance.");
    expect(tasks).not.toContain(cue);
    expect(tasks).not.toContain("When to use this page");
    // Second product page: same compact shape, no copied prose either.
    expect(tasks).toContain("### [CLI entry](cli-src.md)");
    expect(tasks).not.toContain("Prose under a section is not part of the opening.");
    expect(tasks).toContain("## End-to-end behavior");
    expect(tasks).toContain("### [Batch execution](flows/batch-flow.md)");
    // Auxiliary modules are represented by exactly one inventory route.
    expect(tasks).toContain("## Auxiliary work");
    expect(tasks.match(/\[Auxiliary modules\]\(auxiliary\/index\.md\)/g)).toHaveLength(1);
    expect(tasks).not.toContain("fixtures.md");
    expect(tasks).not.toContain("Sample fixtures");
    expect(tasks).not.toContain("Provides canned inputs for tests.");
    // Unavailable page: plain heading + honest note, no link.
    expect(tasks).toContain("Page unavailable: `livewiki/core-src-02.md`");
    expect(tasks).not.toContain("](core-src-02.md)");
    expect(tasks.indexOf("## End-to-end behavior")).toBeLessThan(
      tasks.indexOf("## Implementation reference"),
    );
    expect(tasks.indexOf("## Implementation reference")).toBeLessThan(
      tasks.indexOf("## Auxiliary work"),
    );
    // R10.1 E: no `Module ID:` line anywhere — stable identity is the link
    // target for existing pages (asserted above) and the unavailable path
    // for missing ones; the module id lives in the architecture overview.
    expect(tasks).not.toContain("Module ID:");
  });

  it("builds one stable auxiliary inventory with existence-gated links and no product entries", () => {
    const presentations = new Map([
      ["core-src-01", { moduleId: "core-src-01", displayTitle: "Authentication flow", pageExists: true, owner: "generated" as const }],
      ["core-src-02", { moduleId: "core-src-02", displayTitle: "Session storage", pageExists: true, owner: "generated" as const }],
      ["cli-src", { moduleId: "cli-src", displayTitle: "CLI entry", pageExists: true, owner: "generated" as const }],
      ["fixtures", { moduleId: "fixtures", displayTitle: "Sample fixtures", pageExists: false, owner: null }],
    ]);
    const hub = generateAuxiliaryIndex({ modules, ordered: modules, presentations });
    const reordered = generateAuxiliaryIndex({
      modules: [...modules].reverse(),
      ordered: modules,
      presentations,
    });

    expect(reordered).toBe(hub);
    expect(hub).toContain("title: Auxiliary modules");
    expect(hub).toContain("owner: generated");
    expect(hub).toContain("## Test fixtures");
    expect(hub).toContain("- Sample fixtures — page unavailable");
    expect(hub).not.toContain("fixtures.md)");
    expect(hub).not.toContain("Authentication flow");
    expect(hub).not.toContain("CLI entry");
  });

  it("syncs the auxiliary hub and preserves human, mixed, or unparseable content", async () => {
    const presentations = new Map([
      ["core-src-01", { moduleId: "core-src-01", displayTitle: "Core A", pageExists: true, owner: "generated" as const }],
      ["core-src-02", { moduleId: "core-src-02", displayTitle: "Core B", pageExists: true, owner: "generated" as const }],
      ["cli-src", { moduleId: "cli-src", displayTitle: "CLI", pageExists: true, owner: "generated" as const }],
      ["fixtures", { moduleId: "fixtures", displayTitle: "Sample fixtures", pageExists: true, owner: "generated" as const }],
    ]);
    const args = { repoRoot, modules, ordered: modules, presentations };
    const hubPath = "livewiki/auxiliary/index.md";
    const productOnly = modules.filter((module) => module.id !== "fixtures");

    expect((await syncAuxiliaryIndexHub(args)).outcome).toBe("written");
    expect(await safeIo.readText(repoRoot, hubPath)).toContain("[Sample fixtures](../fixtures.md)");

    for (const [owner, source] of [
      ["human", "---\ntitle: Mine\nowner: human\n---\n# Mine\n"],
      ["mixed", "---\ntitle: Mine\nowner: mixed\n---\n# Mine\n"],
      [null, "# Hand-written auxiliary index\n"],
    ] as const) {
      await safeIo.writeText(repoRoot, hubPath, source);
      expect(await syncAuxiliaryIndexHub(args)).toEqual({
        outcome: "skipped-owner",
        path: hubPath,
        owner,
      });
      expect(await safeIo.readText(repoRoot, hubPath)).toBe(source);
      expect(await syncAuxiliaryIndexHub({
        repoRoot,
        modules: productOnly,
        ordered: productOnly,
        presentations,
      })).toEqual({
        outcome: "skipped-owner",
        path: hubPath,
        owner,
      });
      expect(await safeIo.readText(repoRoot, hubPath)).toBe(source);
    }

    await safeIo.writeText(repoRoot, hubPath, "---\ntitle: Generated\nowner: generated\n---\n# Generated\n");
    expect((await syncAuxiliaryIndexHub({
      repoRoot,
      modules: productOnly,
      ordered: productOnly,
      presentations,
    })).outcome).toBe("removed");
    await expect(nodeFs.stat(nodePath.join(repoRoot, hubPath))).rejects.toThrow();
  });

  it("selects both edge directions with product preference, a combined cap, and reorder stability", () => {
    const edges = [
      { from: "core-src-01", to: "core-src-02" },
      { from: "cli-src", to: "core-src-01" },
      { from: "fixtures", to: "core-src-01" },
      { from: "core-src-01", to: "fixtures" },
    ];
    const args = {
      moduleId: "core-src-01",
      modules,
      edges,
      ordered: [modules[1]!, modules[2]!, modules[0]!, modules[3]!],
      limit: 3,
    };
    const forward = selectRelatedModules(args);
    const shuffled = selectRelatedModules({
      ...args,
      modules: [...modules].reverse(),
      edges: [...edges].reverse(),
    });
    expect(forward).toEqual(shuffled);
    expect(forward).toEqual([
      { moduleId: "core-src-02", direction: "dependency" },
      { moduleId: "cli-src", direction: "dependent" },
      { moduleId: "fixtures", direction: "both" },
    ]);
  });

  it("adds one-link hub routes only to generated/mixed pages and preserves manual blocks byte-for-byte", async () => {
    const manual = "<!-- lw:manual -->\nKeep  two spaces.\n<!-- /lw:manual -->";
    await safeIo.writeText(repoRoot, "livewiki/core-src-01.md", `---\ntitle: Core A\nowner: mixed\n---\n# Core A\n\n${manual}\n`);
    await safeIo.writeText(repoRoot, "livewiki/core-src-02.md", "---\ntitle: Core B\nowner: generated\n---\n# Core B\n");
    const human = "---\ntitle: CLI\nowner: human\n---\n# Human CLI\n";
    await safeIo.writeText(repoRoot, "livewiki/cli-src.md", human);
    const presentations = await loadModulePresentations(repoRoot, modules);
    const opts = {
      repoRoot,
      modules,
      ordered: modules,
      edges: [
        { from: "core-src-01", to: "core-src-02" },
        { from: "cli-src", to: "core-src-01" },
        { from: "fixtures", to: "core-src-01" },
      ],
      presentations,
    };

    const changed = await updateModuleNavigateBlocks(opts);
    const mixed = await safeIo.readText(repoRoot, "livewiki/core-src-01.md");
    expect(changed).toEqual(["livewiki/core-src-01.md", "livewiki/core-src-02.md"]);
    expect(mixed).toContain(manual);
    // C1: page-specific links only — the universal hub triple lives in the
    // quickstart and must NOT be repeated on every module page.
    expect(mixed).not.toContain("[Quickstart](quickstart.md)");
    expect(mixed).not.toContain("[Tasks](tasks.md)");
    expect(mixed).not.toContain("[Architecture](architecture/overview.md)");
    expect(mixed).not.toContain("Flow:");
    expect(mixed).toContain("[Core B](core-src-02.md) — dependency");
    expect(mixed).toContain("[CLI](cli-src.md) — dependent");
    expect(mixed).not.toContain("fixtures.md");
    expect(await safeIo.readText(repoRoot, "livewiki/cli-src.md")).toBe(human);

    expect(await updateModuleNavigateBlocks(opts)).toEqual([]);
    expect((await safeIo.readText(repoRoot, "livewiki/core-src-01.md")).match(/## Navigate/g)).toHaveLength(1);
  });

  it("links at most one flow page (lowest slug) in the Navigate block of participating modules only", async () => {
    await safeIo.writeText(repoRoot, "livewiki/core-src-01.md", "---\ntitle: Core A\nowner: generated\n---\n# Core A\n");
    await safeIo.writeText(repoRoot, "livewiki/core-src-02.md", "---\ntitle: Core B\nowner: generated\n---\n# Core B\n");
    await safeIo.writeText(repoRoot, "livewiki/flows/b-flow.md", [
      "---",
      "title: Beta flow",
      "owner: generated",
      "modules:",
      "  - core-src-01",
      "---",
      "# Beta flow",
      "",
      "Explains the beta end-to-end flow.",
      "",
    ].join("\n"));
    await safeIo.writeText(repoRoot, "livewiki/flows/a-flow.md", [
      "---",
      "title: Alpha flow",
      "owner: generated",
      "modules:",
      "  - core-src-01",
      "---",
      "# Alpha flow",
      "",
      "Explains the alpha end-to-end flow.",
      "",
    ].join("\n"));
    const presentations = await loadModulePresentations(repoRoot, modules);
    const opts = {
      repoRoot,
      modules,
      ordered: modules,
      edges: [] as Array<{ from: string; to: string }>,
      presentations,
    };

    const changed = await updateModuleNavigateBlocks(opts);
    expect(changed).toEqual(["livewiki/core-src-01.md", "livewiki/core-src-02.md"]);
    const participant = await safeIo.readText(repoRoot, "livewiki/core-src-01.md");
    expect(participant).toContain("- Flow: [Alpha flow](flows/a-flow.md)");
    expect(participant).not.toContain("Beta flow");
    const nonParticipant = await safeIo.readText(repoRoot, "livewiki/core-src-02.md");
    expect(nonParticipant).not.toContain("Flow:");

    // The flow link is derived deterministically: a second pass changes nothing.
    expect(await updateModuleNavigateBlocks(opts)).toEqual([]);
  });

  it("keeps Flow, Topic, and dependency lines without the universal hub triple", async () => {
    await safeIo.writeText(repoRoot, "livewiki/core-src-01.md", "---\ntitle: Core A\nowner: generated\n---\n# Core A\n");
    await safeIo.writeText(repoRoot, "livewiki/core-src-02.md", "---\ntitle: Core B\nowner: generated\n---\n# Core B\n");
    await safeIo.writeText(repoRoot, "livewiki/flows/a-flow.md", [
      "---",
      "title: Alpha flow",
      "owner: generated",
      "modules:",
      "  - core-src-01",
      "---",
      "# Alpha flow",
      "",
    ].join("\n"));
    await safeIo.writeText(repoRoot, "livewiki/topics/billing.md", [
      "---",
      "title: Billing concept",
      "owner: generated",
      "kind: topic",
      "intent: billing",
      "order: 1",
      "modules:",
      "  - core-src-01",
      "flows: []",
      "---",
      "# Billing concept",
      "",
    ].join("\n"));
    const presentations = await loadModulePresentations(repoRoot, modules);
    const changed = await updateModuleNavigateBlocks({
      repoRoot,
      modules,
      ordered: modules,
      edges: [{ from: "core-src-01", to: "core-src-02" }],
      presentations,
    });
    expect(changed).toEqual(["livewiki/core-src-01.md", "livewiki/core-src-02.md"]);
    const page = await safeIo.readText(repoRoot, "livewiki/core-src-01.md");
    expect(page).toContain("- Flow: [Alpha flow](flows/a-flow.md)");
    expect(page).toContain("- Topic: [Billing concept](topics/billing.md)");
    expect(page).toContain("[Core B](core-src-02.md) — dependency");
    expect(page).not.toContain("[Quickstart](quickstart.md)");
    expect(page).not.toContain("[Tasks](tasks.md)");
    expect(page).not.toContain("[Architecture](architecture/overview.md)");
  });

  it("groups the tasks Implementation reference by common directory with singleton folding and title-link-only entries", () => {
    const groupModules: Module[] = [
      { id: "api-01", paths: ["app/api/routes.ts"], symbolCount: 1 },
      { id: "api-02", paths: ["app/api/schema.ts"], symbolCount: 1 },
      { id: "services-01", paths: ["app/services/bgm.py"], symbolCount: 1 },
      { id: "services-02", paths: ["app/services/video.py"], symbolCount: 1 },
      { id: "webui", paths: ["webui/src/main.ts"], symbolCount: 1 },
    ];
    const presentations = new Map(
      groupModules.map((module) => [
        module.id,
        { moduleId: module.id, displayTitle: `Title ${module.id}`, pageExists: true, owner: "generated" as const },
      ]),
    );
    const tasks = generateTasksPage({
      modules: groupModules,
      ordered: groupModules,
      presentations,
      flowPresentations: new Map(),
    });
    const reordered = generateTasksPage({
      modules: [...groupModules].reverse(),
      ordered: groupModules,
      presentations,
      flowPresentations: new Map(),
    });
    expect(reordered).toBe(tasks);

    // One H3 per directory cluster, prioritization order of first member.
    expect(tasks.indexOf("### App API")).toBeGreaterThan(-1);
    expect(tasks.indexOf("### App services")).toBeGreaterThan(tasks.indexOf("### App API"));
    // The webui singleton shares no directory prefix with any cluster: it
    // folds into the trailing catch-all bucket instead of fragmenting.
    expect(tasks.indexOf("### Other modules")).toBeGreaterThan(tasks.indexOf("### App services"));
    // Entries stay title-link-only bullets (R10 dedup — no copied sentences).
    expect(tasks).toContain("- [Title api-01](api-01.md)");
    expect(tasks).toContain("- [Title services-02](services-02.md)");
    expect(tasks).toContain("- [Title webui](webui.md)");
    expect(tasks.indexOf("- [Title api-01](api-01.md)")).toBeLessThan(tasks.indexOf("- [Title api-02](api-02.md)"));
    expect(tasks).not.toContain("### [Title");
  });

  it("folds a singleton into the prefixed sibling cluster and keeps one flat list when one cluster remains", () => {
    const groupModules: Module[] = [
      { id: "api-01", paths: ["app/api/routes.ts"], symbolCount: 1 },
      { id: "api-02", paths: ["app/api/schema.ts"], symbolCount: 1 },
      { id: "worker", paths: ["app/worker/jobs.py"], symbolCount: 1 },
    ];
    const presentations = new Map(
      groupModules.map((module) => [
        module.id,
        { moduleId: module.id, displayTitle: `Title ${module.id}`, pageExists: true, owner: "generated" as const },
      ]),
    );
    const tasks = generateTasksPage({
      modules: groupModules,
      ordered: groupModules,
      presentations,
      flowPresentations: new Map(),
    });
    // Only one multi-member cluster exists, so the prefixed singleton folds
    // into it and the single effective cluster renders flat (no umbrella H3).
    expect(tasks).not.toContain("### App API");
    expect(tasks).not.toContain("### Other modules");
    expect(tasks).toContain("### [Title api-01](api-01.md)");
    expect(tasks).toContain("### [Title worker](worker.md)");
  });

  it("appends the parametrized coverage note exactly when the module source exceeds the budget", async () => {
    const bigModules: Module[] = [
      { id: "big", paths: ["src/big.ts"], symbolCount: 1 },
      { id: "small", paths: ["src/small.ts"], symbolCount: 1 },
    ];
    await nodeFs.mkdir(nodePath.join(repoRoot, "src"), { recursive: true });
    await nodeFs.writeFile(nodePath.join(repoRoot, "src/big.ts"), "x".repeat(2048));
    await nodeFs.writeFile(nodePath.join(repoRoot, "src/small.ts"), "export const s = 1;\n");
    await safeIo.writeText(repoRoot, "livewiki/big.md", "---\ntitle: Big\nowner: generated\n---\n# Big\n");
    await safeIo.writeText(repoRoot, "livewiki/small.md", "---\ntitle: Small\nowner: generated\n---\n# Small\n");
    const presentations = await loadModulePresentations(repoRoot, bigModules);
    const opts = {
      repoRoot,
      modules: bigModules,
      ordered: bigModules,
      edges: [] as Array<{ from: string; to: string }>,
      presentations,
      charBudget: 1024,
    };

    expect(await moduleSourceExceedsBudget(repoRoot, bigModules[0]!, 1024)).toBe(true);
    expect(await moduleSourceExceedsBudget(repoRoot, bigModules[1]!, 1024)).toBe(false);
    // A missing file contributes nothing instead of failing the check.
    expect(await moduleSourceExceedsBudget(repoRoot, { id: "ghost", paths: ["src/ghost.ts"], symbolCount: 0 }, 1)).toBe(false);

    const changed = await updateModuleNavigateBlocks(opts);
    expect(changed).toEqual(["livewiki/big.md", "livewiki/small.md"]);
    const big = await safeIo.readText(repoRoot, "livewiki/big.md");
    // The note carries the module's own inventory: 1 file (singular), ~2k chars.
    const expectedNote = buildModuleCoverageNote(1, 2048);
    expect(expectedNote).toContain("(1 file, ~2k chars)");
    expect(big).toContain(expectedNote);
    expect(big.match(/Coverage note/g)).toHaveLength(1);
    expect(big.indexOf("## Navigate")).toBeLessThan(big.indexOf(expectedNote));
    expect(big.indexOf(expectedNote)).toBeLessThan(big.indexOf("<!-- livewiki:navigate:end -->"));
    const small = await safeIo.readText(repoRoot, "livewiki/small.md");
    expect(small).not.toContain("Coverage note");

    // Idempotent: the note is part of the regenerated deterministic block.
    expect(await updateModuleNavigateBlocks(opts)).toEqual([]);
    // A larger budget removes the note on the next regen.
    await updateModuleNavigateBlocks({ ...opts, charBudget: 1_000_000 });
    expect(await safeIo.readText(repoRoot, "livewiki/big.md")).not.toContain("Coverage note");
  });

  it("parametrizes the coverage note so no two over-budget modules share the same text", async () => {
    // (a) Unit: different file counts and sizes produce different note texts,
    // with singular/plural handled and sizes rounded to whole k.
    expect(buildModuleCoverageNote(1, 2048)).not.toBe(buildModuleCoverageNote(3, 61_250));
    expect(buildModuleCoverageNote(3, 61_250)).toContain("(3 files, ~61k chars)");
    expect(buildModuleCoverageNote(1, 61_250)).toContain("(1 file, ~61k chars)");

    // (b) The exact property the duplicate-paragraph audit measures: a
    // multi-module run yields NO two pages with an identical coverage-note
    // line.
    const overModules: Module[] = [
      { id: "mod-a", paths: ["src/a.ts"], symbolCount: 1 },
      { id: "mod-b", paths: ["src/b1.ts", "src/b2.ts"], symbolCount: 2 },
      { id: "mod-c", paths: ["src/c.ts"], symbolCount: 1 },
    ];
    await nodeFs.mkdir(nodePath.join(repoRoot, "src"), { recursive: true });
    await nodeFs.writeFile(nodePath.join(repoRoot, "src/a.ts"), "x".repeat(1900));
    await nodeFs.writeFile(nodePath.join(repoRoot, "src/b1.ts"), "x".repeat(1200));
    await nodeFs.writeFile(nodePath.join(repoRoot, "src/b2.ts"), "x".repeat(1300));
    await nodeFs.writeFile(nodePath.join(repoRoot, "src/c.ts"), "x".repeat(2600));
    for (const module of overModules) {
      await safeIo.writeText(repoRoot, `livewiki/${module.id}.md`, `---\ntitle: ${module.id}\nowner: generated\n---\n# ${module.id}\n`);
    }
    const presentations = await loadModulePresentations(repoRoot, overModules);
    const changed = await updateModuleNavigateBlocks({
      repoRoot,
      modules: overModules,
      ordered: overModules,
      edges: [],
      presentations,
      charBudget: 1024,
    });
    expect(changed).toHaveLength(3);
    const notes: string[] = [];
    for (const module of overModules) {
      const page = await safeIo.readText(repoRoot, `livewiki/${module.id}.md`);
      const note = page.split("\n").find((line) => line.includes("Coverage note"));
      expect(note, `${module.id} must carry a coverage note`).toBeDefined();
      notes.push(note!);
    }
    expect(new Set(notes).size).toBe(notes.length);
    // Sizes picked so the rounded ~k values differ: 1900 → ~2k, 2500 → ~3k
    // (rounds half-up), 2600 → ~3k; a and c share the file count but differ
    // in size, a and b share neither.
    expect(notes[0]).toContain("(1 file, ~2k chars)");
    expect(notes[1]).toContain("(2 files, ~3k chars)");
    expect(notes[2]).toContain("(1 file, ~3k chars)");
    expect(notes[0]).not.toBe(notes[2] as string);
  });

  it("loads flow presentations sorted by slug and degrades honestly on missing/unparseable frontmatter", async () => {
    await safeIo.writeText(repoRoot, "livewiki/flows/b-flow.md", [
      "---",
      "title: Beta flow",
      "owner: generated",
      "modules:",
      "  - core-src-02",
      "  - core-src-01",
      "---",
      "# Beta flow",
      "",
      "Explains the beta end-to-end flow across two modules.",
      "",
      "## Purpose",
      "",
      "Section prose is not the opening sentence.",
      "",
    ].join("\n"));
    await safeIo.writeText(repoRoot, "livewiki/flows/a-flow.md", [
      "---",
      "title: Alpha flow",
      "owner: generated",
      "---",
      "# Alpha flow",
      "",
      "## Purpose",
      "",
      "No opening prose before the first H2.",
      "",
    ].join("\n"));
    // Unparseable frontmatter (no closing ---): everything degrades to null.
    await safeIo.writeText(repoRoot, "livewiki/flows/z-broken.md", "---\ntitle: Broken\n# never closed\n");
    // The hub itself is never a flow page.
    await safeIo.writeText(repoRoot, "livewiki/flows/index.md", "# stale hub\n");

    const presentations = await loadFlowPresentations(repoRoot);
    expect([...presentations.keys()]).toEqual(["a-flow", "b-flow", "z-broken"]);

    const beta = presentations.get("b-flow")!;
    expect(beta.title).toBe("Beta flow");
    expect(beta.modules).toEqual(["core-src-02", "core-src-01"]);

    const alpha = presentations.get("a-flow")!;
    expect(alpha.title).toBe("Alpha flow");
    expect(alpha.modules).toEqual([]);

    const broken = presentations.get("z-broken")!;
    expect(broken.title).toBeNull();
    expect(broken.modules).toEqual([]);
  });

  it("renders the deterministic How-it-works hub without anchors or lw: markers", () => {
    const presentations = new Map([
      ["b-flow", { slug: "b-flow", title: "Beta flow", modules: ["core-src-01"] }],
      ["a-flow", { slug: "a-flow", title: null, modules: [] }],
    ]);
    const hub = generateFlowsIndex({ presentations });
    expect(hub).toContain("title: How it works");
    expect(hub).toContain("owner: generated");
    expect(hub).not.toMatch(/anchors:|lw:/);
    // Slug order, title-or-slug fallback, no copied purpose sentence.
    expect(hub.indexOf("(a-flow.md)")).toBeLessThan(hub.indexOf("(b-flow.md)"));
    expect(hub).toContain("### [a-flow](a-flow.md)");
    expect(hub).toContain("### [Beta flow](b-flow.md)");
    expect(hub).not.toContain("Explains beta.");
  });

  it("syncs the flows hub: writes when flows exist, removes only a generated hub when they disappear", async () => {
    // No flows and no hub: nothing to do.
    expect((await syncFlowsIndexHub(repoRoot, new Map())).outcome).toBe("none");

    await safeIo.writeText(repoRoot, "livewiki/flows/a-flow.md", [
      "---",
      "title: Alpha flow",
      "owner: generated",
      "---",
      "# Alpha flow",
      "",
      "Explains the alpha end-to-end flow.",
      "",
    ].join("\n"));
    const presentations = await loadFlowPresentations(repoRoot);
    expect((await syncFlowsIndexHub(repoRoot, presentations)).outcome).toBe("written");
    const hub = await safeIo.readText(repoRoot, "livewiki/flows/index.md");
    expect(hub).toContain("### [Alpha flow](a-flow.md)");
    expect(hub).not.toContain("Explains the alpha end-to-end flow.");

    // Flows disappear: the generated hub is removed.
    await nodeFs.rm(nodePath.join(repoRoot, "livewiki/flows/a-flow.md"));
    expect((await syncFlowsIndexHub(repoRoot, new Map())).outcome).toBe("removed");
    await expect(nodeFs.stat(nodePath.join(repoRoot, "livewiki/flows/index.md"))).rejects.toThrow();

    // A human-owned hub is never removed, even with zero flow pages.
    const humanHub = "---\ntitle: My flows\nowner: human\n---\n# My flows\n";
    await safeIo.writeText(repoRoot, "livewiki/flows/index.md", humanHub);
    expect((await syncFlowsIndexHub(repoRoot, new Map())).outcome).toBe("none");
    expect(await safeIo.readText(repoRoot, "livewiki/flows/index.md")).toBe(humanHub);
  });

  it("syncs the flows hub: a human, mixed, or unparseable hub is skipped and reported, never rewritten (R10.1 C)", async () => {
    // One flow page arms the write path.
    await safeIo.writeText(repoRoot, "livewiki/flows/a-flow.md", [
      "---",
      "title: Alpha flow",
      "owner: generated",
      "---",
      "# Alpha flow",
      "",
      "Explains the alpha end-to-end flow.",
      "",
    ].join("\n"));
    const presentations = await loadFlowPresentations(repoRoot);
    expect(presentations.size).toBe(1);
    const hubPath = "livewiki/flows/index.md";

    // (a) human hub → untouched byte-for-byte, skipped-owner with path+owner.
    const humanHub = "---\ntitle: My flows\nowner: human\n---\n# My flows\n";
    await safeIo.writeText(repoRoot, hubPath, humanHub);
    expect(await syncFlowsIndexHub(repoRoot, presentations)).toEqual({
      outcome: "skipped-owner",
      path: hubPath,
      owner: "human",
    });
    expect(await safeIo.readText(repoRoot, hubPath)).toBe(humanHub);

    // (b) mixed hub → same conservative skip (hub-specific exception: the
    // flat list has no anchored sections for manual-block reinsertion).
    const mixedHub = "---\ntitle: My flows\nowner: mixed\n---\n# My flows\n";
    await safeIo.writeText(repoRoot, hubPath, mixedHub);
    expect(await syncFlowsIndexHub(repoRoot, presentations)).toEqual({
      outcome: "skipped-owner",
      path: hubPath,
      owner: "mixed",
    });
    expect(await safeIo.readText(repoRoot, hubPath)).toBe(mixedHub);

    // (c) unparseable hub (no frontmatter) with content → same, owner null.
    const rawHub = "# My flows\n\nHand-written index.\n";
    await safeIo.writeText(repoRoot, hubPath, rawHub);
    expect(await syncFlowsIndexHub(repoRoot, presentations)).toEqual({
      outcome: "skipped-owner",
      path: hubPath,
      owner: null,
    });
    expect(await safeIo.readText(repoRoot, hubPath)).toBe(rawHub);

    // (d) generated hub → rewritten as today.
    await safeIo.writeText(repoRoot, hubPath, "---\ntitle: Old\nowner: generated\n---\n# Old\n");
    expect((await syncFlowsIndexHub(repoRoot, presentations)).outcome).toBe("written");
    expect(await safeIo.readText(repoRoot, hubPath)).toContain("### [Alpha flow](a-flow.md)");
  });
});

// ── Item 23: repository understanding synthesis in the quickstart ──────────

describe("generateQuickstart — understanding synthesis priority (item 23)", () => {
  const baseOpts = {
    totalFiles: 8,
    totalSymbols: 21,
    moduleCount: 4,
    flowPresentations: new Map(),
    hasAuxiliary: false,
  };
  const synthesis = {
    title: "Flow Repo",
    purpose: "Flow Repo is a small command line application that parses invocations and persists records for its users.",
    surfaces: ["Command line interface entry point", "Persistence layer in the core module"],
  };

  it("prefers the synthesis over the README purpose, which becomes marked evidence", () => {
    const quickstart = generateQuickstart({
      ...baseOpts,
      orientation: {
        purpose: "Flow Repo is a small CLI that turns invocations into stored records.",
        surfaces: ["Python entry point: `main.py`"],
        readmePath: "README.md",
        fastPathSection: "Quick Start",
      },
      understanding: synthesis,
    });
    const headings = [...quickstart.matchAll(/^## (.+)$/gm)].map((match) => match[1]);
    expect(headings[0]).toBe("What this repository is");
    // The synthesis leads the block, with its own provenance line.
    expect(quickstart).toContain(synthesis.purpose);
    expect(quickstart).toContain("*(Synthesized from the verified wiki pages — see `livewiki/understanding.md`.)*");
    // The README purpose is quoted as evidence, never the authority.
    expect(quickstart).toContain(
      "The repository README also states: Flow Repo is a small CLI that turns invocations into stored records.",
    );
    expect(quickstart).toContain("*(Purpose excerpt from the repository README: `README.md` — one evidence input, not the authority.)*");
    // The synthesis surfaces win over the deterministic orientation surfaces.
    expect(quickstart).toContain("- Command line interface entry point");
    expect(quickstart).not.toContain("- Python entry point: `main.py`");
    // The deterministic fast-path pointer is preserved.
    expect(quickstart).toContain('**Fastest local path:** see the "Quick Start" section of `README.md`.');
    // The synthesis purpose leads the section (before the README evidence).
    expect(quickstart.indexOf(synthesis.purpose)).toBeLessThan(
      quickstart.indexOf("The repository README also states"),
    );
  });

  it("a bad README does not poison the orientation when the synthesis exists", () => {
    const junk = "A porcaria of random scripts glued together with badges and no clear purpose whatsoever.";
    const quickstart = generateQuickstart({
      ...baseOpts,
      orientation: {
        purpose: junk,
        surfaces: [],
        readmePath: "README.md",
        fastPathSection: null,
      },
      understanding: synthesis,
    });
    const section = quickstart.slice(
      quickstart.indexOf("## What this repository is"),
      quickstart.indexOf("## Work by intent"),
    );
    // The FIRST paragraph of the block is the synthesis, not the junk.
    const firstParagraph = section.split("\n\n")[1]!;
    expect(firstParagraph).toBe(synthesis.purpose);
    // The junk survives only as provenance-marked evidence.
    expect(section).toContain(`The repository README also states: ${junk}`);
    expect(section).toContain("one evidence input, not the authority");
  });

  it("renders the synthesis without a README and falls back to orientation surfaces", () => {
    const quickstart = generateQuickstart({
      ...baseOpts,
      orientation: {
        purpose: null,
        surfaces: ["Go module definition: `go.mod`"],
        readmePath: null,
        fastPathSection: null,
      },
      understanding: { title: "Flow Repo", purpose: synthesis.purpose, surfaces: [] },
    });
    expect(quickstart).toContain(synthesis.purpose);
    expect(quickstart).toContain("*(Synthesized from the verified wiki pages — see `livewiki/understanding.md`.)*");
    expect(quickstart).not.toContain("The repository README also states");
    expect(quickstart).toContain("- Go module definition: `go.mod`");
  });

  it("is byte-exact with the pre-synthesis chain when no synthesis exists", () => {
    const orientation = {
      purpose: "MoneyPrinterTurbo-Plus turns a short topic brief into a fully rendered short video.",
      surfaces: ["Python entry point: `main.py`"],
      readmePath: "README.md",
      fastPathSection: "Quick Start",
    };
    const digests = [
      { id: "core", title: "Core pipeline", responsibility: "Renders the video end to end." },
    ];
    const omitted = generateQuickstart({ ...baseOpts, orientation, moduleDigests: digests });
    const explicitNull = generateQuickstart({
      ...baseOpts,
      orientation,
      moduleDigests: digests,
      understanding: null,
    });
    expect(explicitNull).toBe(omitted);
    // The README-purpose branch is untouched (same provenance line as before).
    expect(omitted).toContain("*(Purpose excerpt from the repository README: `README.md`.)*");
    expect(omitted).not.toContain("one evidence input");
    // Same for the no-README digest-synthesis branch.
    const noReadme = generateQuickstart({
      ...baseOpts,
      orientation: { purpose: null, surfaces: [], readmePath: null, fastPathSection: null },
      moduleDigests: digests,
      understanding: null,
    });
    expect(noReadme).toContain("*(Synthesized from the generated module pages.)*");
    expect(noReadme).not.toContain("Synthesized from the verified wiki pages");
  });
});
