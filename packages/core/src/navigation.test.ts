import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as nodeFs from "node:fs/promises";
import * as nodeOs from "node:os";
import * as nodePath from "node:path";
import * as safeIo from "./safe-io.js";
import { generateModulesGraph, moduleSlug } from "./diagrams.js";
import type { Module } from "./modules.js";
import {
  buildDisplayTitleFallbacks,
  generateAuxiliaryIndex,
  generateFlowsIndex,
  generateQuickstart,
  generateTasksPage,
  loadFlowPresentations,
  loadModulePresentations,
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
    expect(mixed).toContain("[Quickstart](quickstart.md)");
    expect(mixed).toContain("[Tasks](tasks.md)");
    expect(mixed).toContain("[Architecture](architecture/overview.md)");
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
