import { describe, expect, it } from "vitest";
import {
  assembleFilePage,
  deterministicFallbackPlan,
  extractSectionSource,
  parseFilePlan,
} from "./file-page-plan.js";

const CLOSED = ["a.ts#one", "a.ts#two", "a.ts#three", "a.ts#four"];

describe("parseFilePlan", () => {
  it("accepts a fenced JSON plan that partitions the closed list", () => {
    const raw = [
      "Here is the plan:",
      "```json",
      JSON.stringify({
        sections: [
          { heading: "Setup", keys: ["a.ts#one", "a.ts#two"] },
          { heading: "Teardown", keys: ["a.ts#three", "a.ts#four"] },
        ],
      }),
      "```",
    ].join("\n");
    const result = parseFilePlan(raw, CLOSED);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sections.map((s) => s.heading)).toEqual(["Setup", "Teardown"]);
    }
  });

  it("rejects keys outside the closed list, duplicates, and gaps", () => {
    expect(
      parseFilePlan(
        JSON.stringify({ sections: [{ heading: "X", keys: ["a.ts#one", "a.ts#invented"] }] }),
        CLOSED,
      ).ok,
    ).toBe(false);
    const dup = parseFilePlan(
      JSON.stringify({
        sections: [
          { heading: "A", keys: ["a.ts#one"] },
          { heading: "B", keys: ["a.ts#one", "a.ts#two", "a.ts#three", "a.ts#four"] },
        ],
      }),
      CLOSED,
    );
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error).toContain("more than one section");
    const gap = parseFilePlan(
      JSON.stringify({ sections: [{ heading: "A", keys: ["a.ts#one"] }] }),
      CLOSED,
    );
    expect(gap.ok).toBe(false);
    if (!gap.ok) expect(gap.error).toContain("unassigned");
  });

  it("rejects malformed JSON and empty sections", () => {
    expect(parseFilePlan("not json at all", CLOSED).ok).toBe(false);
    expect(parseFilePlan('{"sections": []}', CLOSED).ok).toBe(false);
  });
});

describe("deterministicFallbackPlan", () => {
  it("chunks the closed list in order", () => {
    const plan = deterministicFallbackPlan(CLOSED, 3);
    expect(plan.map((s) => s.keys)).toEqual([
      ["a.ts#one", "a.ts#two", "a.ts#three"],
      ["a.ts#four"],
    ]);
    expect(plan[0]!.heading).toContain("Part 1");
  });
});

describe("extractSectionSource", () => {
  const source = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join("\n");

  it("merges contiguous ranges and slices by line numbers", () => {
    const { text, truncated } = extractSectionSource(
      source,
      [
        { key: "a", start_line: 10, end_line: 12 },
        { key: "b", start_line: 12, end_line: 15 },
        { key: "c", start_line: 50, end_line: 51 },
      ],
      10_000,
    );
    expect(truncated).toBe(false);
    expect(text).toContain("line 10");
    expect(text).toContain("line 15");
    expect(text).toContain("// …");
    expect(text).toContain("line 50");
    expect(text).not.toContain("line 16");
  });

  it("flags truncation when the cap binds", () => {
    const { truncated } = extractSectionSource(
      source,
      [{ key: "a", start_line: 1, end_line: 100 }],
      500,
    );
    expect(truncated).toBe(true);
  });
});

describe("assembleFilePage", () => {
  it("owns frontmatter, markers, and section order deterministically", () => {
    const page = assembleFilePage({
      opening: "# Batch orchestrator\n\nRuns the batch.\n\n## When to use this page\n\n- X\n\n## How it fits\n\nY",
      plan: [
        { heading: "Flow", keys: ["a.ts#one", "a.ts#two"] },
        { heading: "Recovery", keys: ["a.ts#three"] },
      ],
      sectionProse: ["Prose about the flow.", "Prose about recovery."],
      closedKeyList: ["a.ts#one", "a.ts#two", "a.ts#three"],
    });
    expect(page).toContain("title: Batch orchestrator");
    expect(page).toContain("owner: generated");
    expect(page).toContain("  - a.ts#three");
    expect(page).toContain("## Flow\n<!-- lw:anchors a.ts#one a.ts#two -->");
    expect(page).toContain("## Recovery\n<!-- lw:anchors a.ts#three -->");
    expect(page.indexOf("## Flow")).toBeLessThan(page.indexOf("## Recovery"));
  });
});
