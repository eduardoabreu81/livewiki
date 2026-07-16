/**
 * overview.md must only link to artifacts that actually exist on disk
 * `generateClassDiagram` writes no file
 * when a module has zero classes — the overview's per-module link must
 * mirror that, the same way it already does for the module page link.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as nodePath from "node:path";
import * as nodeOs from "node:os";
import * as nodeFs from "node:fs/promises";
import { runInit } from "./init.js";
import { run as runVerify } from "./verify.js";
import { computeSnapshotHash, readManifest } from "./manifest.js";

describe("overview.md — class-diagram link only when the file exists", () => {
  let repoRoot: string;

  beforeEach(async () => {
    repoRoot = await nodeFs.mkdtemp(
      nodePath.join(nodeOs.tmpdir(), "livewiki-init-overview-"),
    );
  });

  afterEach(async () => {
    await nodeFs.rm(repoRoot, { recursive: true, force: true });
  });

  it("module with zero classes: overview has no [class diagram] link for it, and no dangling .mmd link", async () => {
    await nodeFs.mkdir(nodePath.join(repoRoot, "funcsonly"), { recursive: true });
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "funcsonly/util.ts"),
      "export function helper() { return 1; }\n",
      "utf8",
    );

    await runInit({ repoRoot, quiet: true });

    const overview = await nodeFs.readFile(
      nodePath.join(repoRoot, "livewiki/architecture/overview.md"),
      "utf8",
    );
    expect(overview).not.toContain("funcsonly.classes.mmd");

    const diagramPath = nodePath.join(
      repoRoot,
      "livewiki/diagrams/funcsonly.classes.mmd",
    );
    await expect(nodeFs.stat(diagramPath)).rejects.toThrow();
  });

  it("module with a class: overview links a .classes.mmd file that actually exists", async () => {
    await nodeFs.mkdir(nodePath.join(repoRoot, "withclass"), { recursive: true });
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "withclass/thing.ts"),
      "export class Thing {\n  run() { return 1; }\n}\n",
      "utf8",
    );

    await runInit({ repoRoot, quiet: true });

    const overview = await nodeFs.readFile(
      nodePath.join(repoRoot, "livewiki/architecture/overview.md"),
      "utf8",
    );
    expect(overview).toContain("withclass.classes.mmd");

    const diagramPath = nodePath.join(
      repoRoot,
      "livewiki/diagrams/withclass.classes.mmd",
    );
    await expect(nodeFs.stat(diagramPath)).resolves.toBeDefined();
  });
});

describe("deterministic navigation hubs", () => {
  let repoRoot: string;

  beforeEach(async () => {
    repoRoot = await nodeFs.mkdtemp(
      nodePath.join(nodeOs.tmpdir(), "livewiki-init-quickstart-"),
    );
  });

  afterEach(async () => {
    await nodeFs.rm(repoRoot, { recursive: true, force: true });
  });

  it("generates the exact bounded Quickstart route plus Tasks and verifies cleanly without a provider", async () => {
    await nodeFs.mkdir(nodePath.join(repoRoot, "src"), { recursive: true });
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "src/hello.ts"),
      "export function hello() { return 1; }\n",
      "utf8",
    );
    await runInit({ repoRoot, quiet: true });
    const quickstart = await nodeFs.readFile(
      nodePath.join(repoRoot, "livewiki/quickstart.md"),
      "utf8",
    );
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
    expect(quickstart).not.toMatch(/Important symbols|Top entry points|Key concepts/);
    expect(quickstart.split("\n").filter((line) => line.trim() !== "").length).toBeLessThanOrEqual(100);
    expect(quickstart.trim().split(/\s+/).length).toBeLessThanOrEqual(700);
    await expect(nodeFs.stat(nodePath.join(repoRoot, "livewiki/tasks.md"))).resolves.toBeDefined();
    const manifest = await readManifest(repoRoot);
    expect(manifest?.snapshotHash).toBe(await computeSnapshotHash(repoRoot));
    expect((await runVerify(repoRoot)).issues).toEqual([]);
    const firstNavigation = await Promise.all([
      "livewiki/quickstart.md",
      "livewiki/tasks.md",
      "livewiki/architecture/overview.md",
    ].map((path) => nodeFs.readFile(nodePath.join(repoRoot, path), "utf8")));
    await runInit({ repoRoot, quiet: true });
    const secondNavigation = await Promise.all([
      "livewiki/quickstart.md",
      "livewiki/tasks.md",
      "livewiki/architecture/overview.md",
    ].map((path) => nodeFs.readFile(nodePath.join(repoRoot, path), "utf8")));
    expect(secondNavigation).toEqual(firstNavigation);
  });

  it("contains no symbol dump and keeps product and fixture task groups separate", async () => {
    await nodeFs.mkdir(
      nodePath.join(repoRoot, "aaafixture/test/fixtures/big"),
      { recursive: true },
    );
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "aaafixture/test/fixtures/big/noise.ts"),
      "export function fixtureNoiseFn() { return 1; }\nexport class FixtureNoiseClass {}\n",
      "utf8",
    );
    await nodeFs.mkdir(nodePath.join(repoRoot, "zsrc"), { recursive: true });
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "zsrc/real.ts"),
      "export function realProductFn() { return 1; }\n",
      "utf8",
    );

    await runInit({ repoRoot, quiet: true });

    const quickstart = await nodeFs.readFile(
      nodePath.join(repoRoot, "livewiki/quickstart.md"),
      "utf8",
    );
    const tasks = await nodeFs.readFile(
      nodePath.join(repoRoot, "livewiki/tasks.md"),
      "utf8",
    );
    expect(quickstart).not.toContain("fixtureNoiseFn");
    expect(quickstart).not.toContain("FixtureNoiseClass");
    expect(quickstart).not.toContain("realProductFn");
    expect(tasks.indexOf("## Product tasks")).toBeLessThan(tasks.indexOf("## Fixture tasks"));
    expect(tasks).toContain("Page unavailable:");
  });

  it("honors path-role overrides in Tasks and overview grouping", async () => {
    await nodeFs.mkdir(nodePath.join(repoRoot, ".livewiki"), { recursive: true });
    await nodeFs.writeFile(
      nodePath.join(repoRoot, ".livewiki/config.json"),
      JSON.stringify({ pathRoles: { fixturePatterns: [] } }),
      "utf8",
    );
    await nodeFs.mkdir(nodePath.join(repoRoot, "test/fixtures/example"), {
      recursive: true,
    });
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "test/fixtures/example/value.ts"),
      "export function configuredAsProduct() { return 1; }\n",
      "utf8",
    );

    await runInit({ repoRoot, quiet: true });

    const tasks = await nodeFs.readFile(nodePath.join(repoRoot, "livewiki/tasks.md"), "utf8");
    const overview = await nodeFs.readFile(
      nodePath.join(repoRoot, "livewiki/architecture/overview.md"),
      "utf8",
    );
    expect(tasks).toContain("## Product tasks");
    expect(tasks).not.toContain("## Fixture tasks");
    expect(overview).toContain("## Product modules");
    expect(overview).not.toContain("## Test fixtures");
  });
});

describe("planning inventory — active files with zero extracted symbols", () => {
  // Regression: an active indexed file (e.g. a re-export-only barrel)
  // must remain in the plan, the deterministic structure diagram, the
  // repository facts, and the exact-partition check. Before the fix, the
  // planning inventory was derived from active symbols only — such a
  // file would silently disappear from the plan, the quickstart
  // file-count, the structure diagram, and the deterministic overview.
  let repoRoot: string;

  beforeEach(async () => {
    repoRoot = await nodeFs.mkdtemp(
      nodePath.join(nodeOs.tmpdir(), "livewiki-init-barrel-"),
    );
  });

  afterEach(async () => {
    await nodeFs.rm(repoRoot, { recursive: true, force: true });
  });

  it("keeps an active re-export-only file in the plan, structure, and exact partition", async () => {
    await nodeFs.mkdir(nodePath.join(repoRoot, "src"), { recursive: true });
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "src/counters.ts"),
      "export function countWords(input: string): number { return input.length; }\n",
      "utf8",
    );
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "src/format.ts"),
      "export function formatReport(value: number): string { return String(value); }\n",
      "utf8",
    );
    // `src/index.ts` is active in the index (it is real TypeScript) but
    // contains ONLY re-exports — the indexer extracts zero symbols from
    // it. Before the fix it was dropped from the planning inventory.
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "src/index.ts"),
      'export { countWords } from "./counters.js";\n' +
        'export { formatReport } from "./format.js";\n',
      "utf8",
    );

    const result = await runInit({ repoRoot, plan: true, quiet: true });

    // 1. --plan output includes all three active files, including the barrel.
    expect(result.plan?.totalFiles).toBe(3);
    const planPaths = result.plan?.modules.flatMap((m) => m.paths) ?? [];
    expect(new Set(planPaths)).toEqual(
      new Set(["src/counters.ts", "src/format.ts", "src/index.ts"]),
    );
    // The barrel participates in the exact-partition check and reports 0
    // symbols; the module still groups by directory.
    const srcModule = result.plan?.modules.find((m) => m.id === "src");
    expect(srcModule).toBeDefined();
    expect(srcModule!.symbolCount).toBe(2);

    // 2. A normal `init` run must keep the same inventory in the
    //    deterministic structure diagram and in the repository facts.
    await runInit({ repoRoot, quiet: true });

    const structure = await nodeFs.readFile(
      nodePath.join(repoRoot, "livewiki/architecture/structure.mmd"),
      "utf8",
    );
    expect(structure).toContain("src/index.ts");

    const quickstart = await nodeFs.readFile(
      nodePath.join(repoRoot, "livewiki/quickstart.md"),
      "utf8",
    );
    expect(quickstart).toContain("3 files");

    const overview = await nodeFs.readFile(
      nodePath.join(repoRoot, "livewiki/architecture/overview.md"),
      "utf8",
    );
    expect(overview).toContain("3 files");
    expect(overview).toContain("src/index.ts");

    // 3. The plan, structure diagram, and overview all list the same three
    //    paths exactly once — proving the exact-partition contract still
    //    holds when zero-symbol files are present.
    expect(overview).toMatch(/\*\*\d+\*\* symbols across \*\*3\*\* files/);
    expect(overview.match(/src\/index\.ts/g)?.length).toBe(1);
  });
});
