import { describe, expect, it } from "vitest";
import {
  validateTopicPlan,
  type TopicPlanProposal,
  type TopicPlanningInventory,
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
