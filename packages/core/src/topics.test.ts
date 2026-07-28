import { describe, expect, it } from "vitest";
import {
  validateTopicPlan,
  repairTopicPlanSourceBudgetMechanically,
  clusterModulesByImportGraph,
  selectTopicAnchors,
  proposeTopicPlanDeterministically,
  assignTopicKeySections,
  estimateTopicSourceChars,
  TOPIC_SOURCE_SPAN_SEPARATOR,
  type TopicPlanProposal,
  type TopicPlanningInventory,
  type TopicPlanValidationError,
  type TopicModuleCluster,
  type TopicModuleEvidence,
  type TopicCandidate,
} from "./topics.js";
import { renderRationaleEvidence, type RationaleEvidenceRow } from "./rationale-evidence.js";

const moduleOneAnchors = ["src/a.ts#a", "src/a.ts#b", "src/a.ts#c"];
const moduleTwoAnchors = ["src/b.ts#d", "src/b.ts#e", "src/b.ts#f"];

function inventory(): TopicPlanningInventory {
  const anchors = [...moduleOneAnchors, ...moduleTwoAnchors];
  return {
    modules: [
      {
        id: "module-a",
        title: "Module A",
        paths: ["src/a.ts"],
        role: "product",
        responsibility: "Handles the first half of the contract.",
        whenToUse: ["Change input behavior."],
        sections: ["Reference"],
        anchors: moduleOneAnchors,
        importNeighbors: ["module-b"],
        signals: ["entry/boundary"],
      },
      {
        id: "module-b",
        title: "Module B",
        paths: ["src/b.ts"],
        role: "product",
        responsibility: "Handles state and output.",
        whenToUse: ["Change output behavior."],
        sections: ["Reference"],
        anchors: moduleTwoAnchors,
        importNeighbors: ["module-a"],
        signals: ["persistence/state", "output"],
      },
    ],
    flows: [],
    anchorRoles: Object.fromEntries(anchors.map((key) => [key, "product"])),
    anchorSourceChars: Object.fromEntries(anchors.map((key) => [key, 100])),
  };
}

function proposal(overrides: Partial<TopicPlanProposal> = {}): TopicPlanProposal {
  return {
    title: "Request processing contract",
    intent: "Explain how input becomes persisted output and how failures surface.",
    modules: ["module-a", "module-b"],
    flows: [],
    groups: {
      contract: [moduleOneAnchors[0]!, moduleOneAnchors[1]!],
      state: [moduleOneAnchors[2]!],
      output: [moduleTwoAnchors[0]!, moduleTwoAnchors[1]!],
      failure: [moduleTwoAnchors[2]!],
    },
    ...overrides,
  };
}

const options = { maxTopics: 4, maxAnchors: 18, maxSourceChars: 40_000 };

describe("topic plan validation", () => {
  it("accepts closed product evidence and produces a stable candidate", () => {
    const raw = JSON.stringify({ topics: [proposal()] });
    const first = validateTopicPlan(raw, inventory(), options);
    const reordered = inventory();
    reordered.modules.reverse();
    const second = validateTopicPlan(raw, reordered, options);

    expect(first.ok).toBe(true);
    expect(first.errors).toEqual([]);
    expect(first.candidates).toHaveLength(1);
    expect(first.candidates[0]).toEqual(second.candidates[0]);
    expect(first.candidates[0]!.seedKeys).toEqual(
      [...moduleOneAnchors, ...moduleTwoAnchors].sort(),
    );
  });

  it("rejects references outside the closed inventory", () => {
    const invalid = proposal({ modules: ["module-a", "missing-module"] });
    const result = validateTopicPlan(JSON.stringify({ topics: [invalid] }), inventory(), options);

    expect(result.ok).toBe(false);
    expect(result.candidates).toEqual([]);
    expect(result.errors.map((error) => error.code)).toContain("topic_plan_unknown_reference");
  });

  it("rejects competing topics whose anchor evidence overlaps beyond the limit", () => {
    const competing = proposal({
      title: "Alternative request contract",
      intent: "Explain the same runtime path from a second reader perspective.",
    });
    const result = validateTopicPlan(
      JSON.stringify({ topics: [proposal(), competing] }),
      inventory(),
      options,
    );

    expect(result.ok).toBe(false);
    expect(result.candidates).toEqual([]);
    expect(result.errors.map((error) => error.code)).toContain("topic_plan_anchor_overlap");
  });
});

/**
 * Dedicated fixture for the mechanical source-budget repair: 5 cheap
 * product anchors (100 chars each) plus 2 expensive non-product anchors
 * (3000 chars each) — the repair should drop the expensive ones first and
 * leave every constraint (5-anchor floor, non-empty groups, product ratio)
 * satisfied.
 */
function budgetInventory(productChars = 100, nonProductChars = 3000): TopicPlanningInventory {
  // 6 product anchors + 2 non-product anchors keeps the initial product
  // ratio at exactly 6/8 = 0.75 (the accepted minimum) BEFORE any repair,
  // so the only failure the fixture trips is topic_plan_source_budget.
  const p = ["src/a.ts#p1", "src/a.ts#p2", "src/a.ts#p3", "src/b.ts#p4", "src/b.ts#p5", "src/b.ts#p6"];
  const f = ["src/a.ts#f1", "src/b.ts#f2"];
  return {
    modules: [
      {
        id: "module-a",
        title: "Module A",
        paths: ["src/a.ts"],
        role: "product",
        responsibility: "Handles input.",
        whenToUse: ["Change input behavior."],
        sections: ["Reference"],
        anchors: [p[0]!, p[1]!, p[2]!, f[0]!],
        importNeighbors: ["module-b"],
        signals: ["entry/boundary"],
      },
      {
        id: "module-b",
        title: "Module B",
        paths: ["src/b.ts"],
        role: "product",
        responsibility: "Handles output.",
        whenToUse: ["Change output behavior."],
        sections: ["Reference"],
        anchors: [p[3]!, p[4]!, p[5]!, f[1]!],
        importNeighbors: ["module-a"],
        signals: ["output"],
      },
    ],
    flows: [],
    anchorRoles: {
      ...Object.fromEntries(p.map((key) => [key, "product"])),
      ...Object.fromEntries(f.map((key) => [key, "fixture"])),
    },
    anchorSourceChars: {
      ...Object.fromEntries(p.map((key) => [key, productChars])),
      ...Object.fromEntries(f.map((key) => [key, nonProductChars])),
    },
  };
}

function budgetProposal(overrides: Partial<TopicPlanProposal> = {}): TopicPlanProposal {
  return {
    title: "Input to output contract",
    intent: "Explain how input becomes output across module A and B.",
    modules: ["module-a", "module-b"],
    flows: [],
    groups: {
      contract: ["src/a.ts#p1", "src/a.ts#f1"],
      state: ["src/a.ts#p2", "src/b.ts#f2"],
      output: ["src/a.ts#p3", "src/b.ts#p4"],
      failure: ["src/b.ts#p5", "src/b.ts#p6"],
    },
    ...overrides,
  };
}

describe("repairTopicPlanSourceBudgetMechanically", () => {
  // 610 = 6 product anchors x 100 chars + 5 span separators x 2 chars: the
  // estimate is now byte-exact against the generator (Fix A), which joins
  // evidence spans with "\n\n", so the post-repair floor costs 610, not 600.
  const budgetOpts = { maxTopics: 4, maxAnchors: 18, maxSourceChars: 610 };

  it("drops the costliest non-product anchors first and re-validates clean", () => {
    const inv = budgetInventory();
    const raw = JSON.stringify({ topics: [budgetProposal()] });
    const before = validateTopicPlan(raw, inv, budgetOpts);
    expect(before.ok).toBe(false);
    expect(before.errors.map((e) => e.code)).toEqual(["topic_plan_source_budget"]);

    const repaired = repairTopicPlanSourceBudgetMechanically(raw, before.errors, inv, budgetOpts);
    expect(repaired).not.toBeNull();
    expect(repaired!.result.ok).toBe(true);
    const groups = repaired!.result.candidates[0]!.groups;
    const allKeys = [...groups.contract, ...groups.state, ...groups.output, ...groups.failure];
    expect(allKeys).not.toContain("src/a.ts#f1");
    expect(allKeys).not.toContain("src/b.ts#f2");
    expect(allKeys.sort()).toEqual(
      ["src/a.ts#p1", "src/a.ts#p2", "src/a.ts#p3", "src/b.ts#p4", "src/b.ts#p5", "src/b.ts#p6"].sort(),
    );
  });

  it("returns null when even the floor/group-protected set cannot fit the budget", () => {
    // Product anchors are now expensive too (1000 each); after the 2
    // non-product anchors and one droppable product anchor are removed,
    // the 5-anchor floor and the non-empty-group rule block every
    // remaining candidate, leaving the plan still over budget.
    const inv = budgetInventory(1000, 3000);
    const tightOpts = { maxTopics: 4, maxAnchors: 18, maxSourceChars: 4000 };
    const raw = JSON.stringify({ topics: [budgetProposal()] });
    const before = validateTopicPlan(raw, inv, tightOpts);
    expect(before.ok).toBe(false);

    expect(
      repairTopicPlanSourceBudgetMechanically(raw, before.errors, inv, tightOpts),
    ).toBeNull();
  });

  it("returns null (fail-closed) when the accompanying error is a genuine, unfixed defect", () => {
    // Unlike the "already-moot" case below, this proposal's title really
    // is over budget in the raw content, so the mandatory final
    // re-validation still catches it after the mechanical anchor-drop.
    const inv = budgetInventory();
    const overLongTitle = "x".repeat(120);
    const raw = JSON.stringify({ topics: [budgetProposal({ title: overLongTitle })] });
    const before = validateTopicPlan(raw, inv, budgetOpts);
    expect(before.errors.map((e) => e.code).sort()).toEqual(
      ["topic_plan_source_budget", "topic_plan_text_budget"].sort(),
    );

    expect(
      repairTopicPlanSourceBudgetMechanically(raw, before.errors, inv, budgetOpts),
    ).toBeNull();
  });

  it("fixes the source budget even when an unrelated, already-resolved error rides along (v23 fix)", () => {
    // Priority-0 Phase 2 follow-up #2: the gate used to reject a repair the
    // moment ANY non-source-budget error appeared anywhere in the reported
    // list, even one that doesn't describe an actual remaining defect in
    // this content (e.g. a stale error from an earlier round, or one on a
    // proposal that validates fine on its own). The mandatory final
    // `validateTopicPlan` re-check is the real safety net, so a spurious
    // extra error entry must not block a fix this function CAN make.
    const inv = budgetInventory();
    const raw = JSON.stringify({ topics: [budgetProposal()] });
    const before = validateTopicPlan(raw, inv, budgetOpts);
    expect(before.errors.map((e) => e.code)).toEqual(["topic_plan_source_budget"]);

    const errorsWithSpuriousExtra: TopicPlanValidationError[] = [
      ...before.errors,
      { code: "topic_plan_text_budget", message: "stale error from a prior round", proposalIndex: 0 },
    ];
    const repaired = repairTopicPlanSourceBudgetMechanically(raw, errorsWithSpuriousExtra, inv, budgetOpts);
    expect(repaired).not.toBeNull();
    expect(repaired!.result.ok).toBe(true);
  });

  it("returns null for an empty errors list", () => {
    const inv = budgetInventory();
    const raw = JSON.stringify({ topics: [budgetProposal()] });
    expect(repairTopicPlanSourceBudgetMechanically(raw, [], inv, budgetOpts)).toBeNull();
  });

  it("returns null when maxSourceChars is not configured", () => {
    const inv = budgetInventory();
    const raw = JSON.stringify({ topics: [budgetProposal()] });
    const errors: TopicPlanValidationError[] = [
      { code: "topic_plan_source_budget", message: "too big", proposalIndex: 0 },
    ];
    expect(
      repairTopicPlanSourceBudgetMechanically(raw, errors, inv, { maxTopics: 4, maxAnchors: 18 }),
    ).toBeNull();
  });
});

/**
 * Fix A (2026-07-26): the planner estimate is byte-exact against what
 * `buildTopicDocContext` assembles — span lengths via the shared
 * `renderTopicSourceSpan`, the "\n\n" join between spans, and the bounded
 * rationale block. A candidate that previously passed the per-anchor sum
 * but overflows at generation time must now be rejected at plan time.
 */
describe("topic_plan_source_budget exact accounting (Fix A)", () => {
  it("counts the span-join overhead the generator adds between evidence spans", () => {
    const inv = inventory(); // 6 anchors at 100 chars each -> span sum 600
    const raw = JSON.stringify({ topics: [proposal()] });
    const separators = TOPIC_SOURCE_SPAN_SEPARATOR.length * 5; // 6 spans, 5 joins

    // The old per-anchor sum (600) fit under 605; the exact estimate
    // (600 + 10 join chars) must reject with topic_plan_source_budget.
    const overflow = validateTopicPlan(raw, inv, { ...options, maxSourceChars: 605 });
    expect(overflow.ok).toBe(false);
    expect(overflow.errors.map((e) => e.code)).toEqual(["topic_plan_source_budget"]);

    // The exact boundary (600 + separators) still fits.
    const fits = validateTopicPlan(raw, inv, { ...options, maxSourceChars: 600 + separators });
    expect(fits.ok).toBe(true);
    expect(fits.errors).toEqual([]);
  });

  it("rejects a candidate that only overflows once the rationale block is accounted", () => {
    const inv = inventory(); // source side: 6 spans = 600 + 10 join chars = 610
    const row: RationaleEvidenceRow = {
      path: "src/a.ts",
      symbol_key: "src/a.ts#a",
      kind: "why",
      text: "protects the upstream API from bursts",
      start_line: 1,
    };
    inv.anchorRationaleRows = { "src/a.ts": [row] };
    const rationaleChars = renderRationaleEvidence([row], 4000).length;
    const raw = JSON.stringify({ topics: [proposal()] });

    // 610 source + rationaleChars rationale: reject one char below the
    // exact total, accept at the exact total.
    const overflow = validateTopicPlan(raw, inv, {
      ...options,
      maxSourceChars: 610 + rationaleChars - 1,
      rationaleMaxChars: 4000,
    });
    expect(overflow.ok).toBe(false);
    expect(overflow.errors.map((e) => e.code)).toEqual(["topic_plan_source_budget"]);

    const fits = validateTopicPlan(raw, inv, {
      ...options,
      maxSourceChars: 610 + rationaleChars,
      rationaleMaxChars: 4000,
    });
    expect(fits.ok).toBe(true);

    // Rationale disabled (cap 0): the same candidate fits under 610 again,
    // matching buildTopicDocContext's rationaleMaxChars = 0 behavior.
    const disabled = validateTopicPlan(raw, inv, { ...options, maxSourceChars: 610, rationaleMaxChars: 0 });
    expect(disabled.ok).toBe(true);
  });

  it("deterministic planning yields zero topics when the rationale-inclusive floor exceeds the budget", () => {
    const modules = [
      mod({ id: "module-a", signals: ["entry/boundary"], anchors: ["src/a.ts#1", "src/a.ts#2"], importNeighbors: ["module-b"] }),
      mod({ id: "module-b", signals: ["persistence/state"], anchors: ["src/b.ts#1", "src/b.ts#2"], importNeighbors: ["module-a", "module-c"] }),
      mod({ id: "module-c", signals: ["output"], anchors: ["src/c.ts#1", "src/c.ts#2"], importNeighbors: ["module-b", "module-d"] }),
      mod({ id: "module-d", signals: ["validation/recovery"], anchors: ["src/d.ts#1", "src/d.ts#2"], importNeighbors: ["module-c"] }),
    ];
    const inv = clusterInventory(modules); // 8 anchors at 100 chars each
    const rationaleRow = (path: string): RationaleEvidenceRow => ({
      path,
      symbol_key: `${path}#1`,
      kind: "why",
      text: "rationale long enough to push the minimal selection over budget",
      start_line: 1,
    });

    // Control, no rationale: the minimal 5-anchor selection costs
    // 500 + 8 join chars = 508 and fits under 600.
    const control = proposeTopicPlanDeterministically(inv, new Map(), {
      maxTopics: 4,
      maxAnchors: 18,
      maxSourceChars: 600,
    });
    expect(control).toHaveLength(1);

    // Every viable selection spans all 4 files (one floor anchor per
    // group), so the rationale block adds 4 rendered lines and even the
    // 5-anchor floor overflows 600 — a deterministic no-op, zero topics.
    inv.anchorRationaleRows = {
      "src/a.ts": [rationaleRow("src/a.ts")],
      "src/b.ts": [rationaleRow("src/b.ts")],
      "src/c.ts": [rationaleRow("src/c.ts")],
      "src/d.ts": [rationaleRow("src/d.ts")],
    };
    const withRationale = proposeTopicPlanDeterministically(inv, new Map(), {
      maxTopics: 4,
      maxAnchors: 18,
      maxSourceChars: 600,
      rationaleMaxChars: 4000,
    });
    expect(withRationale).toEqual([]);
  });

  it("estimateTopicSourceChars matches its documented formula", () => {
    const inv = inventory();
    const keys = [...moduleOneAnchors, ...moduleTwoAnchors].sort();
    // No rationale configured: spans + separators only.
    expect(estimateTopicSourceChars(keys, inv, 0)).toBe(6 * 100 + TOPIC_SOURCE_SPAN_SEPARATOR.length * 5);
    // A key absent from the index contributes no span and no separator,
    // exactly like the generator skipping a symbol missing from the DB.
    const partial = estimateTopicSourceChars([keys[0]!, "src/ghost.ts#missing"], inv, 0);
    expect(partial).toBe(100);
    expect(estimateTopicSourceChars([], inv, 4000)).toBe(0);
  });
});

/** Minimal TopicModuleEvidence builder for the Workstream B tests below. */
function mod(overrides: Partial<TopicModuleEvidence> & { id: string }): TopicModuleEvidence {
  return {
    title: overrides.id,
    paths: [`src/${overrides.id}.ts`],
    role: "product",
    responsibility: null,
    whenToUse: [],
    sections: [],
    anchors: [],
    importNeighbors: [],
    signals: [],
    ...overrides,
  };
}

function clusterInventory(modules: TopicModuleEvidence[]): TopicPlanningInventory {
  const anchors = modules.flatMap((m) => m.anchors);
  return {
    modules,
    flows: [],
    anchorRoles: Object.fromEntries(anchors.map((key) => [key, "product"])),
    anchorSourceChars: Object.fromEntries(anchors.map((key) => [key, 100])),
  };
}

describe("clusterModulesByImportGraph", () => {
  it("groups connected product modules into one cluster and attaches a connected auxiliary module", () => {
    const modules = [
      mod({ id: "module-a", importNeighbors: ["module-b"] }),
      mod({ id: "module-b", importNeighbors: ["module-a"] }),
      mod({ id: "module-c", importNeighbors: [] }), // isolated product singleton, no merge target
      mod({ id: "aux-a", role: "docs", importNeighbors: ["module-a"] }),
      mod({ id: "aux-orphan", role: "docs", importNeighbors: [] }),
    ];
    const clusters = clusterModulesByImportGraph(clusterInventory(modules));
    expect(clusters).toEqual([
      { productModuleIds: ["module-a", "module-b"], auxiliaryModuleIds: ["aux-a"] },
    ]);
  });

  it("an auxiliary module connected to two clusters attaches to both", () => {
    const modules = [
      mod({ id: "a1", importNeighbors: ["a2"] }),
      mod({ id: "a2", importNeighbors: ["a1"] }),
      mod({ id: "b1", importNeighbors: ["b2"] }),
      mod({ id: "b2", importNeighbors: ["b1"] }),
      mod({ id: "shared-aux", role: "docs", importNeighbors: ["a1", "b1"] }),
    ];
    const clusters = clusterModulesByImportGraph(clusterInventory(modules));
    expect(clusters).toHaveLength(2);
    for (const cluster of clusters) {
      expect(cluster.auxiliaryModuleIds).toEqual(["shared-aux"]);
    }
  });

  it("merges a singleton product module into the neighboring cluster with the most shared adjacency", () => {
    const modules = [
      mod({ id: "module-a", importNeighbors: ["module-b", "module-x"] }),
      mod({ id: "module-b", importNeighbors: ["module-a"] }),
      // module-x is a singleton but shares a neighbor (module-a) with the
      // {module-a, module-b} cluster — it merges in rather than being dropped.
      mod({ id: "module-x", importNeighbors: ["module-a"] }),
    ];
    const clusters = clusterModulesByImportGraph(clusterInventory(modules));
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.productModuleIds.sort()).toEqual(["module-a", "module-b", "module-x"]);
  });

  it("caps a cluster at 6 modules (auxiliary first, then product) when it exceeds the budget", () => {
    const ids = ["m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8"];
    const modules = ids.map((id) =>
      mod({ id, importNeighbors: ids.filter((other) => other !== id) }),
    );
    const clusters = clusterModulesByImportGraph(clusterInventory(modules));
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.productModuleIds).toHaveLength(6);
    expect(clusters[0]!.productModuleIds).toEqual(["m1", "m2", "m3", "m4", "m5", "m6"]);
  });

  it("merges disconnected singletons into ONE overview cluster instead of dropping them (D2)", () => {
    const modules = [mod({ id: "solo-a" }), mod({ id: "solo-b" })];
    expect(clusterModulesByImportGraph(clusterInventory(modules))).toEqual([
      { productModuleIds: ["solo-a", "solo-b"], auxiliaryModuleIds: [], origin: "overview" },
    ]);
  });

  it("groups isolated singletons sharing one auxiliary module into a spoke cluster (D2)", () => {
    const modules = [
      mod({ id: "svc-a", importNeighbors: ["utils"] }),
      mod({ id: "svc-b", importNeighbors: ["utils"] }),
      mod({ id: "svc-c", importNeighbors: ["utils"] }),
      mod({ id: "utils", role: "tooling", importNeighbors: ["svc-a", "svc-b", "svc-c"] }),
    ];
    const clusters = clusterModulesByImportGraph(clusterInventory(modules));
    expect(clusters).toEqual([
      { productModuleIds: ["svc-a", "svc-b", "svc-c"], auxiliaryModuleIds: ["utils"], origin: "spoke" },
    ]);
  });

  it("groups singletons transitively through chained shared auxiliary neighbors (D2)", () => {
    const modules = [
      mod({ id: "svc-a", importNeighbors: ["aux-one"] }),
      mod({ id: "svc-b", importNeighbors: ["aux-one", "aux-two"] }),
      mod({ id: "svc-c", importNeighbors: ["aux-two"] }),
      mod({ id: "aux-one", role: "tooling", importNeighbors: ["svc-a", "svc-b"] }),
      mod({ id: "aux-two", role: "tooling", importNeighbors: ["svc-b", "svc-c"] }),
    ];
    const clusters = clusterModulesByImportGraph(clusterInventory(modules));
    expect(clusters).toEqual([
      { productModuleIds: ["svc-a", "svc-b", "svc-c"], auxiliaryModuleIds: ["aux-one", "aux-two"], origin: "spoke" },
    ]);
  });

  it("still drops a lone leftover singleton that shares nothing with any other (D2)", () => {
    const modules = [
      mod({ id: "module-a", importNeighbors: ["module-b"] }),
      mod({ id: "module-b", importNeighbors: ["module-a"] }),
      mod({ id: "module-c", importNeighbors: [] }),
    ];
    const clusters = clusterModulesByImportGraph(clusterInventory(modules));
    expect(clusters).toEqual([
      { productModuleIds: ["module-a", "module-b"], auxiliaryModuleIds: [] },
    ]);
  });
});

describe("selectTopicAnchors", () => {
  const cluster: TopicModuleCluster = {
    productModuleIds: ["module-a", "module-b", "module-c", "module-d"],
    auxiliaryModuleIds: [],
  };

  function fourGroupInventory(): TopicPlanningInventory {
    const modules = [
      mod({ id: "module-a", signals: ["entry/boundary"], anchors: ["src/a.ts#1", "src/a.ts#2"] }),
      mod({ id: "module-b", signals: ["persistence/state"], anchors: ["src/b.ts#1", "src/b.ts#2"] }),
      mod({ id: "module-c", signals: ["output"], anchors: ["src/c.ts#1", "src/c.ts#2"] }),
      mod({ id: "module-d", signals: ["validation/recovery"], anchors: ["src/d.ts#1", "src/d.ts#2"] }),
    ];
    return clusterInventory(modules);
  }

  it("buckets anchors by dominant module signal and ranks by centrality within each bucket", () => {
    const inv = fourGroupInventory();
    const centrality = new Map([
      ["src/a.ts#1", 1],
      ["src/a.ts#2", 9], // higher centrality — should be picked first within "contract"
    ]);
    const groups = selectTopicAnchors(cluster, inv, centrality, { maxAnchors: 8 });
    expect(groups).not.toBeNull();
    expect(groups!.contract[0]).toBe("src/a.ts#2");
    expect(groups!.state.sort()).toEqual(["src/b.ts#1", "src/b.ts#2"]);
    expect(groups!.output.sort()).toEqual(["src/c.ts#1", "src/c.ts#2"]);
    expect(groups!.failure.sort()).toEqual(["src/d.ts#1", "src/d.ts#2"]);
    const total = [...groups!.contract, ...groups!.state, ...groups!.output, ...groups!.failure];
    expect(total).toHaveLength(8);
  });

  it("respects maxAnchors as an upper bound on the total selected", () => {
    const inv = fourGroupInventory();
    const groups = selectTopicAnchors(cluster, inv, new Map(), { maxAnchors: 5 });
    expect(groups).not.toBeNull();
    const total = [...groups!.contract, ...groups!.state, ...groups!.output, ...groups!.failure];
    expect(total.length).toBeLessThanOrEqual(5);
    // Every group still got its mandatory floor of 1.
    expect(groups!.contract.length).toBeGreaterThanOrEqual(1);
    expect(groups!.state.length).toBeGreaterThanOrEqual(1);
    expect(groups!.output.length).toBeGreaterThanOrEqual(1);
    expect(groups!.failure.length).toBeGreaterThanOrEqual(1);
  });

  it("borrows from the unclassified pool when a module carries no recognized signal", () => {
    const modules = [
      mod({ id: "module-a", signals: ["entry/boundary"], anchors: ["src/a.ts#1", "src/a.ts#2"] }),
      mod({ id: "module-b", signals: ["persistence/state"], anchors: ["src/b.ts#1", "src/b.ts#2"] }),
      mod({ id: "module-c", signals: ["output"], anchors: ["src/c.ts#1", "src/c.ts#2"] }),
      // No module carries "validation/recovery" — the "failure" floor must
      // be borrowed from this module's unclassified anchors instead.
      mod({ id: "module-d", signals: [], anchors: ["src/d.ts#1"] }),
    ];
    const inv = clusterInventory(modules);
    const groups = selectTopicAnchors(cluster, inv, new Map(), { maxAnchors: 8 });
    expect(groups).not.toBeNull();
    expect(groups!.failure).toEqual(["src/d.ts#1"]);
  });

  it("returns null when a group's floor cannot be met at all (no signal, no unclassified fallback)", () => {
    // Only two modules, both mapping to the same group ("contract") via
    // entry/boundary — "state", "output", and "failure" have nothing to
    // borrow from and no dominant-signal match.
    const modules = [
      mod({ id: "module-a", signals: ["entry/boundary"], anchors: ["src/a.ts#1"] }),
      mod({ id: "module-b", signals: ["entry/boundary"], anchors: ["src/b.ts#1"] }),
    ];
    const smallCluster: TopicModuleCluster = {
      productModuleIds: ["module-a", "module-b"],
      auxiliaryModuleIds: [],
    };
    const inv = clusterInventory(modules);
    expect(selectTopicAnchors(smallCluster, inv, new Map(), { maxAnchors: 8 })).toBeNull();
  });

  it("protects the product-anchor ratio when filling beyond the floor", () => {
    // "zzzaux.ts#1" sorts alphabetically AFTER "src/a.ts#1" so the
    // (product) floor pick for "contract" is the product anchor, not the
    // auxiliary one — the auxiliary anchor is only a candidate for the
    // round-robin fill PAST the floor, which is what this test exercises.
    const modules = [
      mod({ id: "module-a", signals: ["entry/boundary"], anchors: ["src/a.ts#1", "zzzaux.ts#1"] }),
      mod({ id: "module-b", signals: ["persistence/state"], anchors: ["src/b.ts#1", "src/b.ts#2"] }),
      mod({ id: "module-c", signals: ["output"], anchors: ["src/c.ts#1"] }),
      mod({ id: "module-d", signals: ["validation/recovery"], anchors: ["src/d.ts#1"] }),
    ];
    const inv = clusterInventory(modules);
    inv.anchorRoles["zzzaux.ts#1"] = "fixture"; // non-product
    const groups = selectTopicAnchors(cluster, inv, new Map(), {
      maxAnchors: 8,
      minimumProductAnchorRatio: 0.9,
    });
    expect(groups).not.toBeNull();
    const total = [...groups!.contract, ...groups!.state, ...groups!.output, ...groups!.failure];
    // Adding the non-product anchor on top of the product floor picks
    // would drop the ratio below the configured 0.9 floor — it must be
    // skipped, even though budget (maxAnchors: 8) still has room.
    expect(total).not.toContain("zzzaux.ts#1");
    expect(total.length).toBeGreaterThanOrEqual(5);
  });
});

describe("proposeTopicPlanDeterministically", () => {
  const proposeOpts = { maxTopics: 4, maxAnchors: 18, maxSourceChars: 40_000 };

  it("proposes a valid, already-accepted candidate for a connected 4-module cluster", () => {
    const modules = [
      mod({
        id: "module-a",
        title: "Module A",
        importNeighbors: ["module-b"],
        signals: ["entry/boundary"],
        anchors: ["src/a.ts#1", "src/a.ts#2"],
      }),
      mod({
        id: "module-b",
        title: "Module B",
        importNeighbors: ["module-a", "module-c"],
        signals: ["persistence/state"],
        anchors: ["src/b.ts#1", "src/b.ts#2"],
      }),
      mod({
        id: "module-c",
        title: "Module C",
        importNeighbors: ["module-b", "module-d"],
        signals: ["output"],
        anchors: ["src/c.ts#1", "src/c.ts#2"],
      }),
      mod({
        id: "module-d",
        title: "Module D",
        importNeighbors: ["module-c"],
        signals: ["validation/recovery"],
        anchors: ["src/d.ts#1", "src/d.ts#2"],
      }),
    ];
    const inv = clusterInventory(modules);
    const candidates = proposeTopicPlanDeterministically(inv, new Map(), proposeOpts);
    expect(candidates).toHaveLength(1);
    // The candidate must be independently re-acceptable: it is exactly
    // what result.candidates from validateTopicPlan produced internally.
    const revalidated = validateTopicPlan(
      JSON.stringify({
        topics: [
          {
            title: candidates[0]!.title,
            intent: candidates[0]!.intent,
            modules: candidates[0]!.modules,
            flows: candidates[0]!.flows,
            groups: candidates[0]!.groups,
          },
        ],
      }),
      inv,
      proposeOpts,
    );
    expect(revalidated.ok).toBe(true);
  });

  it("returns an empty array when no cluster has selectable anchors", () => {
    const modules = [mod({ id: "solo-a" }), mod({ id: "solo-b" })];
    const inv = clusterInventory(modules);
    expect(proposeTopicPlanDeterministically(inv, new Map(), proposeOpts)).toEqual([]);
  });
});

describe("D2 — spoke-merge fallback and concern-grouped candidates", () => {
  const proposeOpts = { maxTopics: 4, maxAnchors: 18, maxSourceChars: 40_000 };

  function pairModules(prefix: string, signals: [string[], string[]]): TopicModuleEvidence[] {
    return [
      mod({
        id: `${prefix}1`,
        importNeighbors: [`${prefix}2`],
        signals: signals[0],
        anchors: [`src/${prefix}1.ts#1`, `src/${prefix}1.ts#2`, `src/${prefix}1.ts#3`],
      }),
      mod({
        id: `${prefix}2`,
        importNeighbors: [`${prefix}1`],
        signals: signals[1],
        anchors: [`src/${prefix}2.ts#1`, `src/${prefix}2.ts#2`, `src/${prefix}2.ts#3`],
      }),
    ];
  }

  // A deployment concern group that satisfies the 2-product-module floor:
  // `compose` (docker-compose.yml) and `deploy` (deploy/) both match the
  // deployment path patterns; `scripts` (tooling) joins as a directly-
  // connected auxiliary. `compose` is product-connected to `app`, so the
  // only fallback cluster it can join is the {app, compose} component —
  // which shares just one anchor with the concern group (no overlap drop).
  function deploymentModules(): TopicModuleEvidence[] {
    return [
      mod({
        id: "app",
        title: "App",
        importNeighbors: ["compose"],
        anchors: ["src/app.ts#1", "src/app.ts#2", "src/app.ts#3", "src/app.ts#4"],
      }),
      mod({
        id: "compose",
        title: "Compose",
        paths: ["docker-compose.yml"],
        importNeighbors: ["app"],
        anchors: ["docker-compose.yml#service"],
      }),
      mod({
        id: "deploy",
        title: "Deploy",
        paths: ["deploy/run.ts"],
        importNeighbors: ["scripts"],
        anchors: ["deploy/run.ts#deploy", "deploy/run.ts#pack", "deploy/run.ts#revert", "deploy/run.ts#verify"],
      }),
      mod({
        id: "scripts",
        role: "tooling",
        paths: ["scripts/build.ts"],
        importNeighbors: ["deploy"],
        anchors: ["scripts/build.ts#build"],
      }),
    ];
  }

  it("hub-and-spoke fixture yields a topic instead of dropping the singletons", () => {
    const modules = [
      mod({ id: "svc-a", title: "Svc A", importNeighbors: ["utils"], anchors: ["src/a.ts#1", "src/a.ts#2"] }),
      mod({ id: "svc-b", title: "Svc B", importNeighbors: ["utils"], anchors: ["src/b.ts#1", "src/b.ts#2"] }),
      mod({ id: "svc-c", title: "Svc C", importNeighbors: ["utils"], anchors: ["src/c.ts#1", "src/c.ts#2"] }),
      mod({ id: "utils", role: "tooling", importNeighbors: ["svc-a", "svc-b", "svc-c"], anchors: [] }),
    ];
    const inv = clusterInventory(modules);
    const candidates = proposeTopicPlanDeterministically(inv, new Map(), proposeOpts);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.modules).toEqual(["svc-a", "svc-b", "svc-c", "utils"]);
    expect(candidates[0]!.title).toBe("Svc A and Svc B");
  });

  it("names the merged remainder cluster 'Product overview'", () => {
    const modules = [
      mod({ id: "solo-a", title: "Alpha", anchors: ["src/a.ts#1", "src/a.ts#2", "src/a.ts#3"] }),
      mod({ id: "solo-b", title: "Beta", anchors: ["src/b.ts#1", "src/b.ts#2", "src/b.ts#3"] }),
    ];
    const inv = clusterInventory(modules);
    const candidates = proposeTopicPlanDeterministically(inv, new Map(), proposeOpts);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.title).toBe("Product overview");
    expect(candidates[0]!.modules).toEqual(["solo-a", "solo-b"]);
  });

  it("produces a deployment concern candidate from deployment-path modules", () => {
    const inv = clusterInventory(deploymentModules());
    inv.anchorRoles["scripts/build.ts#build"] = "tooling";
    const candidates = proposeTopicPlanDeterministically(inv, new Map(), proposeOpts);
    expect(candidates).toHaveLength(2); // the {app, compose} import cluster + the concern
    const deployment = candidates.find((c) => c.title === "Deployment");
    expect(deployment).toBeDefined();
    expect(deployment!.modules).toEqual(["compose", "deploy", "scripts"]);
    // The deterministic intent names the matched deployment surfaces, so a
    // refine pass or reader sees Docker/config files even though prose
    // files contribute no anchors (MPTP defect, 2026-07-27).
    expect(deployment!.intent).toContain("deployment");
    expect(deployment!.intent).toContain("docker-compose.yml");
    // D2 pin: the concern candidate is tagged so batch keeps it OUT of the
    // LLM refine pass; import-cluster candidates carry no tag.
    expect(deployment!.origin).toBe("concern");
    expect(candidates.find((c) => c.title === "App and Compose")!.origin).toBeUndefined();
  });

  it("produces a testing concern candidate from fixture modules plus their connected product modules", () => {
    const modules = [
      mod({
        id: "module-a",
        title: "Module A",
        importNeighbors: ["module-x", "fixtures-a"],
        anchors: ["src/a.ts#1", "src/a.ts#2", "src/a.ts#3", "src/a.ts#4", "src/a.ts#5"],
      }),
      mod({ id: "module-x", title: "Module X", importNeighbors: ["module-a"], anchors: ["src/x.ts#1", "src/x.ts#2", "src/x.ts#3"] }),
      mod({
        id: "module-b",
        title: "Module B",
        importNeighbors: ["module-y", "fixtures-b"],
        anchors: ["src/b.ts#1", "src/b.ts#2", "src/b.ts#3"],
      }),
      mod({ id: "module-y", title: "Module Y", importNeighbors: ["module-b"], anchors: ["src/y.ts#1", "src/y.ts#2", "src/y.ts#3"] }),
      mod({
        id: "fixtures-a",
        role: "fixture",
        paths: ["tests/fixtures/a.ts"],
        importNeighbors: ["module-a"],
        anchors: ["tests/fixtures/a.ts#1"],
      }),
      mod({
        id: "fixtures-b",
        role: "fixture",
        paths: ["tests/fixtures/b.ts"],
        importNeighbors: ["module-b"],
        anchors: ["tests/fixtures/b.ts#1"],
      }),
    ];
    const inv = clusterInventory(modules);
    inv.anchorRoles["tests/fixtures/a.ts#1"] = "fixture";
    inv.anchorRoles["tests/fixtures/b.ts#1"] = "fixture";
    const candidates = proposeTopicPlanDeterministically(inv, new Map(), proposeOpts);
    const testing = candidates.find((c) => c.title === "Testing");
    expect(testing).toBeDefined();
    expect(testing!.modules).toEqual(["fixtures-a", "fixtures-b", "module-a", "module-b"]);
  });

  it("produces no concern candidate when no module matches a concern group", () => {
    const inv = inventory(); // plain src/ product modules in one import cluster
    const candidates = proposeTopicPlanDeterministically(inv, new Map(), proposeOpts);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.title).not.toBe("Deployment");
    expect(candidates[0]!.title).not.toBe("Testing");
  });

  it("a concern group with zero anchors produces no candidate (never a stub)", () => {
    const modules = [
      mod({ id: "compose", paths: ["docker-compose.yml"], importNeighbors: [], anchors: [] }),
      mod({ id: "deploy", paths: ["deploy/run.ts"], importNeighbors: ["scripts"], anchors: [] }),
      mod({ id: "scripts", role: "tooling", paths: ["scripts/build.ts"], importNeighbors: ["deploy"], anchors: [] }),
    ];
    const inv = clusterInventory(modules);
    expect(proposeTopicPlanDeterministically(inv, new Map(), proposeOpts)).toEqual([]);
  });

  it("concernTopics: false suppresses concern candidates", () => {
    const inv = clusterInventory(deploymentModules());
    const candidates = proposeTopicPlanDeterministically(inv, new Map(), { ...proposeOpts, concernTopics: false });
    expect(candidates).toHaveLength(1); // only the {app, compose} import cluster
    expect(candidates.some((c) => c.title === "Deployment")).toBe(false);
  });

  it("caps the merged plan at maxTopics with import clusters before concern groups", () => {
    const inv = clusterInventory([
      ...pairModules("a", [["entry/boundary"], ["persistence/state"]]),
      ...pairModules("b", [["output"], ["validation/recovery"]]),
      ...deploymentModules(),
    ]);
    // Import clusters (sorted by first id: a1, app, b1) fill the cap first;
    // the deployment concern comes last.
    const capped = proposeTopicPlanDeterministically(inv, new Map(), { ...proposeOpts, maxTopics: 2 });
    expect(capped).toHaveLength(2);
    expect(capped.some((c) => c.title === "Deployment")).toBe(false);
    const full = proposeTopicPlanDeterministically(inv, new Map(), { ...proposeOpts, maxTopics: 4 });
    expect(full).toHaveLength(4);
    expect(full[3]!.title).toBe("Deployment");
  });

  it("is deterministic: the same inventory produces an identical plan twice", () => {
    const modules = [
      mod({ id: "svc-a", title: "Svc A", importNeighbors: ["utils"], anchors: ["src/a.ts#1", "src/a.ts#2"] }),
      mod({ id: "svc-b", title: "Svc B", importNeighbors: ["utils"], anchors: ["src/b.ts#1", "src/b.ts#2"] }),
      mod({ id: "svc-c", title: "Svc C", importNeighbors: ["utils"], anchors: ["src/c.ts#1", "src/c.ts#2"] }),
      mod({ id: "utils", role: "tooling", importNeighbors: ["svc-a", "svc-b", "svc-c"], anchors: [] }),
      ...deploymentModules(),
    ];
    const inv = clusterInventory(modules);
    const first = proposeTopicPlanDeterministically(inv, new Map(), { ...proposeOpts, maxTopics: 8 });
    const second = proposeTopicPlanDeterministically(inv, new Map(), { ...proposeOpts, maxTopics: 8 });
    expect(first.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

describe("assignTopicKeySections", () => {
  function candidate(groups: TopicCandidate["groups"]): TopicCandidate {
    const seedKeys = [...groups.contract, ...groups.state, ...groups.output, ...groups.failure];
    return {
      title: "Topic",
      intent: "Intent",
      modules: ["module-a"],
      flows: [],
      groups,
      planOrder: 0,
      evidenceHash: "abc123",
      slug: "topic-abc123",
      seedKeys,
    };
  }

  it("assigns each of the 4 groups' first key to its own required section, and routes leftovers to behavioral-contract", () => {
    const map = assignTopicKeySections(
      candidate({
        contract: ["a#1", "a#2"],
        state: ["b#1"],
        output: ["c#1"],
        failure: ["d#1"],
      }),
    );
    expect(map.get("a#1")).toBe("purpose");
    expect(map.get("a#2")).toBe("behavioral-contract");
    expect(map.get("b#1")).toBe("when-to-use-this-page");
    expect(map.get("c#1")).toBe("change-map");
    expect(map.get("d#1")).toBe("failure-and-recovery");
  });

  it("never assigns the same key to more than one section and covers every seed key", () => {
    const c = candidate({
      contract: ["a#1", "a#2", "a#3"],
      state: ["b#1", "b#2"],
      output: ["c#1", "c#2"],
      failure: ["d#1", "d#2", "d#3"],
    });
    const map = assignTopicKeySections(c);
    expect(map.size).toBe(c.seedKeys.length);
    for (const key of c.seedKeys) expect(map.has(key)).toBe(true);
    // Regression: reproduces the v29-v31 real E2E failure — a key assigned
    // to one section (e.g. "contract") must never ALSO be the key routed to
    // "change-map", which is exactly what caused the repeated
    // duplicate_anchor thrashing on "Change map" re-listing an already-used
    // key.
    const bySection = new Map<string, string[]>();
    for (const [key, section] of map) {
      bySection.set(section, [...(bySection.get(section) ?? []), key]);
    }
    // Every key appears in exactly one section's bucket.
    const seen = new Set<string>();
    for (const keys of bySection.values()) {
      for (const key of keys) {
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
  });

  it("guarantees behavioral-contract is non-empty when the candidate meets the 5-anchor floor", () => {
    // Minimal valid candidate per selectTopicAnchors's floor: 4 groups with
    // 1 key each would only total 4 (rejected upstream); the smallest
    // ACCEPTED shape has one group with 2 keys.
    const map = assignTopicKeySections(
      candidate({
        contract: ["a#1", "a#2"],
        state: ["b#1"],
        output: ["c#1"],
        failure: ["d#1"],
      }),
    );
    const behavioralContractKeys = [...map.entries()].filter(([, s]) => s === "behavioral-contract");
    expect(behavioralContractKeys.length).toBeGreaterThan(0);
  });
});
