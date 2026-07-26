/**
 * Unit tests for stage-4 module context builders (fair source truncation).
 * Not a benchmark proof — product regression only.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as nodePath from "node:path";
import * as nodeOs from "node:os";
import * as nodeFs from "node:fs/promises";
import { buildFairTruncatedSource, buildModuleDocContext, buildTopicDocContext } from "./batch.js";
import { run as runIndexer } from "./indexer.js";
import type { Module } from "./modules.js";
import {
  estimateTopicSourceChars,
  measureTopicAnchorEvidence,
  type TopicCandidate,
  type TopicPlanningInventory,
} from "./topics.js";

describe("buildFairTruncatedSource", () => {
  let root: string;

  beforeEach(async () => {
    root = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "livewiki-fair-src-"));
  });

  afterEach(async () => {
    await nodeFs.rm(root, { recursive: true, force: true });
  });

  it("includes a slice of every path when sequential full content exceeds budget", async () => {
    // Early file is huge; late file would be starved by first-fit truncation.
    const big = "A".repeat(40_000);
    const late = "export function lateSym() { return 1; }\n";
    await nodeFs.writeFile(nodePath.join(root, "early.ts"), big, "utf8");
    await nodeFs.writeFile(nodePath.join(root, "late.ts"), late, "utf8");

    const out = await buildFairTruncatedSource(root, ["early.ts", "late.ts"], 8_000);

    expect(out).toContain("// === early.ts ===");
    expect(out).toContain("// === late.ts ===");
    // Late file body must appear (not only the header).
    expect(out).toContain("lateSym");
    // Early file is truncated, not fully embedded.
    expect(out).toContain("// ... (truncated by budget)");
    expect(out.length).toBeLessThanOrEqual(8_000 + 80);
  });

  it("returns full content when everything fits the budget", async () => {
    await nodeFs.writeFile(nodePath.join(root, "a.ts"), "export const a = 1;\n", "utf8");
    await nodeFs.writeFile(nodePath.join(root, "b.ts"), "export const b = 2;\n", "utf8");
    const out = await buildFairTruncatedSource(root, ["a.ts", "b.ts"], 60_000);
    expect(out).toContain("export const a = 1;");
    expect(out).toContain("export const b = 2;");
    expect(out).not.toContain("// ... (truncated by budget)");
  });
});

// === Etapa 2b: rationale evidence in doc contexts ===

describe("rationale evidence in doc contexts (Etapa 2b)", () => {
  let root: string;

  beforeEach(async () => {
    root = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), "livewiki-rationale-ctx-"));
    await nodeFs.mkdir(nodePath.join(root, "src"), { recursive: true });
  });

  afterEach(async () => {
    await nodeFs.rm(root, { recursive: true, force: true });
  });

  it("stage-4 module context carries the rationale block carved inside the char budget", async () => {
    await nodeFs.writeFile(
      nodePath.join(root, "src", "intent.ts"),
      `// WHY: the retry budget protects the upstream API from bursts
export function retry() { return 1; }
`,
      "utf8",
    );
    await runIndexer(root, { quiet: true });

    const module: Module = { id: "intent", paths: ["src/intent.ts"], symbolCount: 1 };
    const ctx = await buildModuleDocContext(root, module, 60_000, 4_000);

    expect(ctx.rationaleEvidence).toContain("[why]");
    expect(ctx.rationaleEvidence).toContain("src/intent.ts#retry");
    expect(ctx.rationaleEvidence).toContain("WHY: the retry budget protects the upstream API");
    // Carved inside the budget: block + source never exceed charBudget.
    expect(ctx.rationaleEvidence.length + ctx.truncatedSource.length).toBeLessThanOrEqual(60_000);
    expect(ctx.truncatedSource).toContain("export function retry()");
  });

  it("caps the rationale block at rationaleMaxChars", async () => {
    await nodeFs.writeFile(
      nodePath.join(root, "src", "intent.ts"),
      `// WHY: first intent line of this block
// NOTE: second intent line of this block
export function f() { return 1; }
`,
      "utf8",
    );
    await runIndexer(root, { quiet: true });

    const module: Module = { id: "intent", paths: ["src/intent.ts"], symbolCount: 1 };
    const full = await buildModuleDocContext(root, module, 60_000, 4_000);
    expect(full.rationaleEvidence).toContain("first intent line");
    expect(full.rationaleEvidence).toContain("second intent line");

    // The first rendered line fits the cap, the second does not.
    const firstLineLength = full.rationaleEvidence.split("\n")[0]!.length;
    const capped = await buildModuleDocContext(root, module, 60_000, firstLineLength + 5);
    expect(capped.rationaleEvidence.length).toBeLessThanOrEqual(firstLineLength + 5);
    expect(capped.rationaleEvidence).toContain("first intent line");
    expect(capped.rationaleEvidence).not.toContain("second intent line");

    // Zero disables the block entirely.
    const disabled = await buildModuleDocContext(root, module, 60_000, 0);
    expect(disabled.rationaleEvidence).toBe("");
  });

  it("topic context accounts rationale before the hard topicMaxSourceChars throw", async () => {
    await nodeFs.writeFile(
      nodePath.join(root, "src", "t.ts"),
      `/** Function docstring explaining why this helper exists at all. */
export function helper() { return 1; }
`,
      "utf8",
    );
    await runIndexer(root, { quiet: true });

    const candidate: TopicCandidate = {
      title: "Helpers",
      intent: "Explain the helper utilities",
      modules: [],
      flows: [],
      groups: { contract: ["src/t.ts#helper"], state: [], output: [], failure: [] },
      planOrder: 1,
      evidenceHash: "abc123",
      slug: "helpers",
      seedKeys: ["src/t.ts#helper"],
    };

    // Baseline: no rationale — the source alone fits this exact budget.
    const without = await buildTopicDocContext(root, candidate, 1_000_000, 0);
    expect(without.rationaleEvidence).toBe("");
    const exactSourceBudget = without.truncatedSource.length;
    await expect(
      buildTopicDocContext(root, candidate, exactSourceBudget, 0),
    ).resolves.toBeTruthy();

    // Same budget, rationale enabled: the combined size trips the throw,
    // proving rationale is accounted BEFORE the check.
    const withRationale = await buildTopicDocContext(root, candidate, 1_000_000, 4_000);
    expect(withRationale.rationaleEvidence).toContain("Function docstring explaining why this helper exists");
    await expect(
      buildTopicDocContext(root, candidate, exactSourceBudget, 4_000),
    ).rejects.toThrow(/accepted topic evidence exceeds topicMaxSourceChars/);

    // A budget that fits both does not throw.
    const combinedBudget = exactSourceBudget + withRationale.rationaleEvidence.length;
    await expect(
      buildTopicDocContext(root, candidate, combinedBudget, 4_000),
    ).resolves.toBeTruthy();
  });

  it("planner estimate equals the generator context byte-for-byte (Fix A)", async () => {
    await nodeFs.writeFile(
      nodePath.join(root, "src", "a.ts"),
      `// WHY: alpha exists to protect the upstream API from bursts
export function alpha() { return 1; }
export function beta() { return 2; }
`,
      "utf8",
    );
    await nodeFs.writeFile(
      nodePath.join(root, "src", "b.ts"),
      `/** Gamma docstring explaining why this helper exists at all here. */
export function gamma() { return 3; }
`,
      "utf8",
    );
    await runIndexer(root, { quiet: true });

    const keys = ["src/a.ts#alpha", "src/a.ts#beta", "src/b.ts#gamma"];
    const evidence = await measureTopicAnchorEvidence(root, keys);
    // Sanity: every requested anchor was actually measured from the index,
    // so the comparison below is not vacuous.
    expect(Object.keys(evidence.anchorSourceChars).sort()).toEqual([...keys].sort());
    expect(Object.keys(evidence.anchorRationaleRows).sort()).toEqual(["src/a.ts", "src/b.ts"]);
    const inventory: TopicPlanningInventory = {
      modules: [],
      flows: [],
      anchorRoles: {},
      anchorSourceChars: evidence.anchorSourceChars,
      anchorRationaleRows: evidence.anchorRationaleRows,
    };
    const candidate: TopicCandidate = {
      title: "Helpers",
      intent: "Explain the helper utilities",
      modules: [],
      flows: [],
      groups: {
        contract: ["src/a.ts#alpha"],
        state: ["src/a.ts#beta"],
        output: ["src/b.ts#gamma"],
        failure: [],
      },
      planOrder: 1,
      evidenceHash: "abc123",
      slug: "helpers",
      seedKeys: keys,
    };

    // The estimate must equal rationaleEvidence + truncatedSource for any
    // rationale cap: disabled, truncating, and full.
    for (const rationaleCap of [0, 60, 4_000]) {
      const estimate = estimateTopicSourceChars(keys, inventory, rationaleCap);
      const ctx = await buildTopicDocContext(root, candidate, 1_000_000, rationaleCap);
      expect(estimate).toBe(ctx.rationaleEvidence.length + ctx.truncatedSource.length);
    }
    // The rationale block is genuinely non-empty in this fixture.
    const full = await buildTopicDocContext(root, candidate, 1_000_000, 4_000);
    expect(full.rationaleEvidence.length).toBeGreaterThan(0);
    expect(estimateTopicSourceChars(keys, inventory, 4_000)).toBeGreaterThan(
      estimateTopicSourceChars(keys, inventory, 0),
    );
  });
});
