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
import { regenerateArchitectureOverview, runInit } from "./init.js";
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
    await nodeFs.mkdir(nodePath.join(repoRoot, "livewiki/diagrams"), { recursive: true });
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "withclass/thing.ts"),
      "export class Thing {\n  run() { return 1; }\n}\n",
      "utf8",
    );
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "livewiki/diagrams/stale.classes.mmd"),
      "classDiagram\n  class Stale\n",
      "utf8",
    );
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "livewiki/diagrams/custom.mmd"),
      "graph TD\n  A --> B\n",
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
    await expect(
      nodeFs.stat(nodePath.join(repoRoot, "livewiki/diagrams/stale.classes.mmd")),
    ).rejects.toThrow();
    await expect(
      nodeFs.stat(nodePath.join(repoRoot, "livewiki/diagrams/custom.mmd")),
    ).resolves.toBeDefined();
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
      "Work by intent",
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

  it("contains no symbol dump and routes every auxiliary module through one inventory", async () => {
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
    expect(tasks.indexOf("## Implementation reference")).toBeLessThan(
      tasks.indexOf("## Auxiliary work"),
    );
    expect(tasks.match(/\[Auxiliary modules\]\(auxiliary\/index\.md\)/g)).toHaveLength(1);
    expect(tasks).not.toContain("aaafixture");
    expect(tasks).toContain("Page unavailable:");
    const auxiliary = await nodeFs.readFile(
      nodePath.join(repoRoot, "livewiki/auxiliary/index.md"),
      "utf8",
    );
    expect(auxiliary).toContain("## Test fixtures");
    expect(auxiliary).toContain("page unavailable");
    const overview = await nodeFs.readFile(
      nodePath.join(repoRoot, "livewiki/architecture/overview.md"),
      "utf8",
    );
    expect(overview).toContain("## Auxiliary modules");
    expect(overview.match(/\[Auxiliary modules\]\(\.\.\/auxiliary\/index\.md\)/g)).toHaveLength(1);
    expect(overview).not.toContain("## Test fixtures");
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
    expect(tasks).toContain("## Implementation reference");
    expect(tasks).not.toContain("## Auxiliary work");
    expect(overview).toContain("## Product modules");
    expect(overview).not.toContain("## Auxiliary modules");
    await expect(
      nodeFs.stat(nodePath.join(repoRoot, "livewiki/auxiliary/index.md")),
    ).rejects.toThrow();
  });

  it("reports and preserves a protected auxiliary hub while keeping the primary route valid", async () => {
    await nodeFs.mkdir(nodePath.join(repoRoot, "test/fixtures/example"), { recursive: true });
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "test/fixtures/example/value.ts"),
      "export function fixtureValue() { return 1; }\n",
      "utf8",
    );
    await nodeFs.mkdir(nodePath.join(repoRoot, "livewiki/auxiliary"), { recursive: true });
    const humanHub = "---\ntitle: My auxiliary guide\nowner: human\n---\n# My auxiliary guide\n";
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "livewiki/auxiliary/index.md"),
      humanHub,
      "utf8",
    );

    const result = await runInit({ repoRoot, quiet: true });
    expect(result.skippedAuxiliaryHub).toEqual({
      path: "livewiki/auxiliary/index.md",
      owner: "human",
    });
    expect(result.filesWritten).not.toContain("livewiki/auxiliary/index.md");
    expect(
      await nodeFs.readFile(nodePath.join(repoRoot, "livewiki/auxiliary/index.md"), "utf8"),
    ).toBe(humanHub);
    const quickstart = await nodeFs.readFile(
      nodePath.join(repoRoot, "livewiki/quickstart.md"),
      "utf8",
    );
    const tasks = await nodeFs.readFile(nodePath.join(repoRoot, "livewiki/tasks.md"), "utf8");
    expect(quickstart).toContain("[Auxiliary modules](auxiliary/index.md)");
    expect(tasks.match(/\[Auxiliary modules\]\(auxiliary\/index\.md\)/g)).toHaveLength(1);
  });
});

describe("flows hub and gated links (Lot S4)", () => {
  let repoRoot: string;

  beforeEach(async () => {
    repoRoot = await nodeFs.mkdtemp(
      nodePath.join(nodeOs.tmpdir(), "livewiki-init-flows-"),
    );
  });

  afterEach(async () => {
    await nodeFs.rm(repoRoot, { recursive: true, force: true });
  });

  it("plain init on a repo with flow pages writes the hub and gates quickstart/overview/navigate links", async () => {
    await nodeFs.mkdir(nodePath.join(repoRoot, "src/auth"), { recursive: true });
    await nodeFs.mkdir(nodePath.join(repoRoot, "src/utils"), { recursive: true });
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "src/auth/login.ts"),
      "export function login() { return 1; }\n",
      "utf8",
    );
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "src/utils/helper.ts"),
      "export function help() { return 1; }\n",
      "utf8",
    );
    // As a previous batch (stage 4 + 5) would have left them.
    await nodeFs.mkdir(nodePath.join(repoRoot, "livewiki/flows"), { recursive: true });
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "livewiki/auth.md"),
      [
        "---",
        "title: User authentication",
        "owner: generated",
        "---",
        "# User authentication",
        "",
        "Authenticates users and issues sessions.",
        "",
      ].join("\n"),
      "utf8",
    );
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "livewiki/flows/auth-to-utils.md"),
      [
        "---",
        "title: Auth to utils",
        "owner: generated",
        "modules:",
        "  - auth",
        "---",
        "# Auth to utils",
        "",
        "How an auth call reaches the utils sink.",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = await runInit({ repoRoot, quiet: true });
    expect(result.filesWritten).toContain("livewiki/flows/index.md");

    const hub = await nodeFs.readFile(
      nodePath.join(repoRoot, "livewiki/flows/index.md"),
      "utf8",
    );
    expect(hub).toContain("title: How it works");
    expect(hub).toContain("### [Auth to utils](auth-to-utils.md)");
    expect(hub).not.toContain("How an auth call reaches the utils sink.");

    const quickstart = await nodeFs.readFile(
      nodePath.join(repoRoot, "livewiki/quickstart.md"),
      "utf8",
    );
    expect(quickstart).toContain("[How it works](flows/index.md)");

    const overview = await nodeFs.readFile(
      nodePath.join(repoRoot, "livewiki/architecture/overview.md"),
      "utf8",
    );
    expect(overview).toContain("## Flows");
    expect(overview).toContain("[How it works](../flows/index.md)");

    // The participating module's Navigate block gains the flow link.
    const authPage = await nodeFs.readFile(
      nodePath.join(repoRoot, "livewiki/auth.md"),
      "utf8",
    );
    expect(authPage).toContain("- Flow: [Auth to utils](flows/auth-to-utils.md)");

    // tasks.md shows only the linked display title of the existing product
    // page — no copied responsibility sentence (duplicate-prose audit).
    const tasks = await nodeFs.readFile(nodePath.join(repoRoot, "livewiki/tasks.md"), "utf8");
    expect(tasks).toContain("### [User authentication](auth.md)");
    expect(tasks).not.toContain("Authenticates users and issues sessions.");

    expect((await runVerify(repoRoot)).issues).toEqual([]);

    // Re-init is byte-identical across the whole navigation surface.
    const paths = [
      "livewiki/quickstart.md",
      "livewiki/tasks.md",
      "livewiki/architecture/overview.md",
      "livewiki/flows/index.md",
      "livewiki/auth.md",
    ];
    const before = await Promise.all(
      paths.map((path) => nodeFs.readFile(nodePath.join(repoRoot, path), "utf8")),
    );
    await runInit({ repoRoot, quiet: true });
    const after = await Promise.all(
      paths.map((path) => nodeFs.readFile(nodePath.join(repoRoot, path), "utf8")),
    );
    expect(after).toEqual(before);
  });

  it("plain init without flow pages omits every flows link and writes no hub", async () => {
    await nodeFs.mkdir(nodePath.join(repoRoot, "src"), { recursive: true });
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "src/a.ts"),
      "export function a() { return 1; }\n",
      "utf8",
    );

    const result = await runInit({ repoRoot, quiet: true });
    expect(result.filesWritten).not.toContain("livewiki/flows/index.md");
    const quickstart = await nodeFs.readFile(
      nodePath.join(repoRoot, "livewiki/quickstart.md"),
      "utf8",
    );
    expect(quickstart).not.toContain("flows/index.md");
    const overview = await nodeFs.readFile(
      nodePath.join(repoRoot, "livewiki/architecture/overview.md"),
      "utf8",
    );
    expect(overview).not.toContain("## Flows");
    await expect(
      nodeFs.stat(nodePath.join(repoRoot, "livewiki/flows/index.md")),
    ).rejects.toThrow();
    expect((await runVerify(repoRoot)).issues).toEqual([]);
  });

  it("regenerateArchitectureOverview removes a generated hub when flows disappear and preserves a human hub", async () => {
    await nodeFs.mkdir(nodePath.join(repoRoot, "src"), { recursive: true });
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "src/a.ts"),
      "export function a() { return 1; }\n",
      "utf8",
    );
    await nodeFs.mkdir(nodePath.join(repoRoot, "livewiki/flows"), { recursive: true });
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "livewiki/flows/alpha.md"),
      [
        "---",
        "title: Alpha",
        "owner: generated",
        "---",
        "# Alpha",
        "",
        "Explains alpha.",
        "",
      ].join("\n"),
      "utf8",
    );
    await runInit({ repoRoot, quiet: true });
    const hubPath = nodePath.join(repoRoot, "livewiki/flows/index.md");
    await expect(nodeFs.stat(hubPath)).resolves.toBeDefined();
    let quickstart = await nodeFs.readFile(
      nodePath.join(repoRoot, "livewiki/quickstart.md"),
      "utf8",
    );
    expect(quickstart).toContain("[How it works](flows/index.md)");

    // The flow page disappears: the post-batch navigation pass removes the
    // generated hub and un-gates the quickstart/overview links.
    await nodeFs.rm(nodePath.join(repoRoot, "livewiki/flows/alpha.md"));
    await regenerateArchitectureOverview(repoRoot);
    await expect(nodeFs.stat(hubPath)).rejects.toThrow();
    quickstart = await nodeFs.readFile(
      nodePath.join(repoRoot, "livewiki/quickstart.md"),
      "utf8",
    );
    expect(quickstart).not.toContain("flows/index.md");
    const overview = await nodeFs.readFile(
      nodePath.join(repoRoot, "livewiki/architecture/overview.md"),
      "utf8",
    );
    expect(overview).not.toContain("## Flows");

    // A human-owned hub is never removed by the pass.
    const humanHub = "---\ntitle: My flows\nowner: human\n---\n# My flows\n";
    await nodeFs.writeFile(hubPath, humanHub, "utf8");
    await regenerateArchitectureOverview(repoRoot);
    expect(await nodeFs.readFile(hubPath, "utf8")).toBe(humanHub);
    // The only verify delta is the honest ledger debt for the deleted flow
    // page (missing_wiki_path); no link or anchor issue is introduced.
    const issues = (await runVerify(repoRoot)).issues;
    expect(issues.filter((issue) => issue.code !== "missing_wiki_path")).toEqual([]);
  });

  it("runInit reports a skipped human flows hub (path + owner) and never rewrites it (R10.1 C)", async () => {
    await nodeFs.mkdir(nodePath.join(repoRoot, "src"), { recursive: true });
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "src/a.ts"),
      "export function a() { return 1; }\n",
      "utf8",
    );
    // One flow page arms the hub write path; the hub itself is human-owned.
    await nodeFs.mkdir(nodePath.join(repoRoot, "livewiki/flows"), { recursive: true });
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "livewiki/flows/alpha.md"),
      "---\ntitle: Alpha flow\nowner: generated\n---\n# Alpha flow\n",
      "utf8",
    );
    const humanHub = "---\ntitle: My flows\nowner: human\n---\n# My flows\n";
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "livewiki/flows/index.md"),
      humanHub,
      "utf8",
    );

    const result = await runInit({ repoRoot, quiet: true });

    // The skip is surfaced in the result — never silent — and the hub is
    // byte-for-byte intact and never listed as written.
    expect(result.skippedFlowsHub).toEqual({
      path: "livewiki/flows/index.md",
      owner: "human",
    });
    expect(result.filesWritten).not.toContain("livewiki/flows/index.md");
    expect(
      await nodeFs.readFile(nodePath.join(repoRoot, "livewiki/flows/index.md"), "utf8"),
    ).toBe(humanHub);

    // A generated hub is rewritten as today (no skip reported).
    await nodeFs.writeFile(
      nodePath.join(repoRoot, "livewiki/flows/index.md"),
      "---\ntitle: Old\nowner: generated\n---\n# Old\n",
      "utf8",
    );
    const regenerated = await runInit({ repoRoot, quiet: true });
    expect(regenerated.skippedFlowsHub).toBeUndefined();
    expect(regenerated.filesWritten).toContain("livewiki/flows/index.md");
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
