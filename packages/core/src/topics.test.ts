import { describe, expect, it } from "vitest";
import {
  validateTopicPlan,
  repairTopicPlanSourceBudgetMechanically,
  type TopicPlanProposal,
  type TopicPlanningInventory,
  type TopicPlanValidationError,
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

  it("returns null (fail-closed) when a non-source-budget error is also present", () => {
    const inv = budgetInventory();
    const raw = JSON.stringify({ topics: [budgetProposal()] });
    const errors: TopicPlanValidationError[] = [
      { code: "topic_plan_source_budget", message: "too big", proposalIndex: 0 },
      { code: "topic_plan_text_budget", message: "title too long", proposalIndex: 0 },
    ];
    expect(
      repairTopicPlanSourceBudgetMechanically(raw, errors, inv, budgetOpts),
    ).toBeNull();
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
