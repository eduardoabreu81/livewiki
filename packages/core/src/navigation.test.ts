import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as nodeFs from "node:fs/promises";
import * as nodeOs from "node:os";
import * as nodePath from "node:path";
import * as safeIo from "./safe-io.js";
import { generateModulesGraph, moduleSlug } from "./diagrams.js";
import type { Module } from "./modules.js";
import {
  buildDisplayTitleFallbacks,
  generateQuickstart,
  generateTasksPage,
  loadModulePresentations,
  selectRelatedModules,
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
    const quickstart = generateQuickstart({ totalFiles: 8, totalSymbols: 21, moduleCount: 4 });
    const headings = [...quickstart.matchAll(/^## (.+)$/gm)].map((match) => match[1]);
    expect(headings).toEqual([
      "Choose a path",
      "Document a repo",
      "Query the wiki from an agent",
      "Pay documentation debt",
      "Repository facts",
    ]);
    expect(quickstart).toContain("[Tasks](tasks.md)");
    expect(quickstart).toContain("[Architecture overview](architecture/overview.md)");
    expect(quickstart).not.toMatch(/Top entry points|Important symbols|Phase \d|pnpm add|npm install/);
    expect(quickstart.split("\n").filter((line) => line.trim() !== "").length).toBeLessThanOrEqual(100);
    expect(quickstart.trim().split(/\s+/).length).toBeLessThanOrEqual(700);
  });

  it("assembles role-separated Tasks, reuses accepted cue bullets verbatim, and labels unavailable pages", async () => {
    const cue = "- Configure authentication before enabling protected routes.";
    await safeIo.writeText(repoRoot, "livewiki/core-src-01.md", [
      "---",
      "title: Authentication flow",
      "owner: generated",
      "---",
      "# Authentication flow",
      "",
      "## When to use this page",
      "",
      cue,
      "",
      "## Implementation",
      "",
    ].join("\n"));
    const presentations = await loadModulePresentations(repoRoot, modules);
    const tasks = generateTasksPage({ modules, ordered: modules, presentations });
    const reorderedTasks = generateTasksPage({
      modules: [...modules].reverse(),
      ordered: modules,
      presentations,
    });

    expect(reorderedTasks).toBe(tasks);
    expect(tasks).toContain("owner: generated");
    expect(tasks).not.toMatch(/anchors:|lw:anchors/);
    expect(tasks).toContain("### [Authentication flow](core-src-01.md)");
    expect(tasks).toContain(cue);
    expect(tasks).toContain("Page unavailable: `livewiki/core-src-02.md`");
    expect(tasks).not.toContain("](core-src-02.md)");
    expect(tasks.indexOf("## Product tasks")).toBeLessThan(tasks.indexOf("## Fixture tasks"));
    for (const module of modules) {
      expect(tasks.split(`Module ID: \`${module.id}\``)).toHaveLength(2);
    }
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
    expect(mixed).toContain("[Core B](core-src-02.md) — dependency");
    expect(mixed).toContain("[CLI](cli-src.md) — dependent");
    expect(mixed).not.toContain("fixtures.md");
    expect(await safeIo.readText(repoRoot, "livewiki/cli-src.md")).toBe(human);

    expect(await updateModuleNavigateBlocks(opts)).toEqual([]);
    expect((await safeIo.readText(repoRoot, "livewiki/core-src-01.md")).match(/## Navigate/g)).toHaveLength(1);
  });
});
