import { describe, expect, it } from "vitest";
import {
  validateTopicPlan,
  repairTopicPlanSourceBudgetMechanically,
  clusterModulesByImportGraph,
  selectTopicAnchors,
  proposeTopicPlanDeterministically,
  type TopicPlanProposal,
  type TopicPlanningInventory,
  type TopicPlanValidationError,
  type TopicModuleCluster,
  type TopicModuleEvidence,
} from "./topics.js";

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
  const budgetOpts = { maxTopics: 4, maxAnchors: 18, maxSourceChars: 600 };

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

  it("returns no clusters when every product module is a disconnected singleton", () => {
    const modules = [mod({ id: "solo-a" }), mod({ id: "solo-b" })];
    expect(clusterModulesByImportGraph(clusterInventory(modules))).toEqual([]);
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

  it("returns an empty array when no cluster can be formed", () => {
    const modules = [mod({ id: "solo-a" }), mod({ id: "solo-b" })];
    const inv = clusterInventory(modules);
    expect(proposeTopicPlanDeterministically(inv, new Map(), proposeOpts)).toEqual([]);
  });
});
