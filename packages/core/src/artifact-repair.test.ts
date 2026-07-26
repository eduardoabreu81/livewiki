/**
 * artifact-repair.test.ts — mechanical repair fail-closed guarantees.
 *
 * R10.1 item D: the three flow-placement codes
 * (anchor_in_disallowed_section, anchor_missing_in_required_section,
 * anchor_missing_required_tier) are repairable BY PROMPT only — the
 * mechanical last-slot fallback must stay fail-closed and return null,
 * alone or in combination with codes it does support.
 */

import { describe, it, expect } from "vitest";
import { repairStage4ArtifactMechanically, repairUpperBoundArtifactMechanically } from "./artifact-repair.js";
import { validateStage4Artifact, flowDiagramPlaceholder } from "./artifact.js";
import type { ArtifactValidationError, ArtifactValidationCode } from "./prompts.js";
import type { FlowKeySectionMap } from "./flows.js";

const NEW_FLOW_CODES: ArtifactValidationCode[] = [
  "anchor_in_disallowed_section",
  "anchor_missing_in_required_section",
  "anchor_missing_required_tier",
];

const ARTIFACT = "---\ntitle: x\nowner: generated\n---\n\n# x\n\nBody.\n";

describe("artifact-repair — fail-closed on the R10.1 D flow-placement codes", () => {
  it.each(NEW_FLOW_CODES)("returns null for %s", (code) => {
    const errors: ArtifactValidationError[] = [
      { code, message: "flow placement violation", location: "section", offending: "x" },
    ];
    expect(repairStage4ArtifactMechanically(ARTIFACT, errors, ["src/a.ts#a"])).toBeNull();
  });

  it("returns null even when a supported code accompanies the new codes", () => {
    const errors: ArtifactValidationError[] = [
      {
        code: "missing_closed_key",
        message: "closed-list key missing from section markers",
        location: "section",
        offending: "src/a.ts#a",
      },
      {
        code: "anchor_missing_required_tier",
        message: 'the page cites no key from the "entry" group',
        location: "section",
        offending: "entry",
      },
    ];
    expect(repairStage4ArtifactMechanically(ARTIFACT, errors, ["src/a.ts#a"])).toBeNull();
  });
});

/** Minimal compliant flow page, same shape as `batch-stage5.test.ts`'s `makeFlowPage`. */
function makeFlowPage(anchors: string[], modules: string[]): string {
  const [firstKey, secondKey, ...restKeys] = anchors;
  return [
    "---",
    "title: Example flow",
    "owner: generated",
    "anchors:",
    ...anchors.map((k) => `  - ${k}`),
    "modules:",
    ...modules.map((m) => `  - ${m}`),
    "updated: 2026-07-21",
    "---",
    "",
    "# Example flow",
    "",
    "This page explains an example flow end to end.",
    "",
    "## Purpose",
    "",
    ...(firstKey ? [`<!-- lw:anchors ${firstKey} -->`, ""] : []),
    "The flow begins here and produces a stored result.",
    "",
    "## Ordered flow",
    "",
    ...(secondKey ? [`<!-- lw:anchors ${secondKey} -->`, ""] : []),
    "1. Step one runs first.",
    "2. Step two persists the result.",
    "",
    "## Diagram",
    "",
    "```mermaid",
    flowDiagramPlaceholder("example-flow"),
    "```",
    "",
    "## Invariants",
    "",
    "- Every step preserves the input payload.",
    "",
    "## Failure and recovery",
    "",
    ...(restKeys.length > 0 ? [`<!-- lw:anchors ${restKeys.join(" ")} -->`, ""] : []),
    "No retry or rollback path is shown; the flow fails open.",
    "",
    "## Related pages",
    "",
    ...modules.map((m) => `- [${m} module](../${m}.md)`),
    "",
  ].join("\n");
}

function validateFlow(content: string, closedKeyList: string[]) {
  return validateStage4Artifact(content, closedKeyList, {
    pageKind: "flow",
    moduleId: "example-flow",
    moduleRole: "product",
    expectedFlowModules: ["a-mod", "b-mod"],
    expectedFlowDiagram: flowDiagramPlaceholder("example-flow").replace(/^%%\s*/, ""),
  });
}

describe("repairUpperBoundArtifactMechanically — flow pages (upper-bound contract)", () => {
  const anchors = ["src/a.ts#a", "src/b.ts#b", "src/c.ts#c"];
  const modules = ["a-mod", "b-mod"];

  it("dedups a key cited in two section markers", () => {
    const valid = makeFlowPage(anchors, modules);
    // Duplicate the first key into the Failure-and-recovery marker too.
    const broken = valid.replace(
      `<!-- lw:anchors ${anchors[2]} -->`,
      `<!-- lw:anchors ${anchors[2]} ${anchors[0]} -->`,
    );
    const before = validateFlow(broken, anchors);
    expect(before.ok).toBe(false);
    expect(before.errors.some((e) => e.code === "duplicate_anchor")).toBe(true);

    const repaired = repairUpperBoundArtifactMechanically(broken, before.errors, anchors, {
      pageKind: "flow",
      moduleId: "example-flow",
      moduleRole: "product",
      expectedFlowModules: modules,
      expectedFlowDiagram: flowDiagramPlaceholder("example-flow").replace(/^%%\s*/, ""),
    });
    expect(repaired).not.toBeNull();
    expect(repaired!.repairs).toEqual(["remove_duplicate_section_anchors"]);
    expect(validateFlow(repaired!.content, anchors).ok).toBe(true);
  });

  it("adds a section-cited key missing from the frontmatter anchors list", () => {
    const valid = makeFlowPage(anchors, modules);
    const broken = valid.replace(`  - ${anchors[2]}\n`, "");
    const before = validateFlow(broken, anchors);
    expect(before.ok).toBe(false);
    expect(
      before.errors.some((e) => e.code === "missing_closed_key" && e.location === "frontmatter"),
    ).toBe(true);

    const repaired = repairUpperBoundArtifactMechanically(broken, before.errors, anchors, {
      pageKind: "flow",
      moduleId: "example-flow",
      moduleRole: "product",
      expectedFlowModules: modules,
      expectedFlowDiagram: flowDiagramPlaceholder("example-flow").replace(/^%%\s*/, ""),
    });
    expect(repaired).not.toBeNull();
    expect(repaired!.repairs).toEqual(["sync_upper_bound_frontmatter_anchors"]);
    expect(validateFlow(repaired!.content, anchors).ok).toBe(true);
  });

  it("drops a frontmatter-only key that no section marker cites", () => {
    // "Failure and recovery" needs >= 1 marker key of its own, so this
    // fixture carries 2 rest-keys and drops only one of them from the
    // marker (leaving the section's required marker in place) — isolates
    // missing_closed_key from the unrelated anchor_missing_in_required_section.
    const fourAnchors = [...anchors, "src/d.ts#d"];
    const valid = makeFlowPage(fourAnchors, modules);
    const broken = valid.replace(
      `<!-- lw:anchors ${anchors[2]} src/d.ts#d -->`,
      `<!-- lw:anchors ${anchors[2]} -->`,
    );
    const before = validateFlow(broken, fourAnchors);
    expect(before.ok).toBe(false);
    expect(
      before.errors.some((e) => e.code === "missing_closed_key" && e.location === "section"),
    ).toBe(true);

    const repaired = repairUpperBoundArtifactMechanically(broken, before.errors, fourAnchors, {
      pageKind: "flow",
      moduleId: "example-flow",
      moduleRole: "product",
      expectedFlowModules: modules,
      expectedFlowDiagram: flowDiagramPlaceholder("example-flow").replace(/^%%\s*/, ""),
    });
    expect(repaired).not.toBeNull();
    expect(repaired!.repairs).toEqual(["sync_upper_bound_frontmatter_anchors"]);
    const after = validateFlow(repaired!.content, fourAnchors);
    expect(after.ok).toBe(true);
    expect(repaired!.content).not.toContain("  - src/d.ts#d");
  });

  it("handles a duplicate plus a frontmatter-missing key together", () => {
    const valid = makeFlowPage(anchors, modules);
    let broken = valid.replace(
      `<!-- lw:anchors ${anchors[2]} -->`,
      `<!-- lw:anchors ${anchors[2]} ${anchors[0]} -->`,
    );
    broken = broken.replace(`  - ${anchors[1]}\n`, "");
    const before = validateFlow(broken, anchors);
    expect(before.ok).toBe(false);

    const repaired = repairUpperBoundArtifactMechanically(broken, before.errors, anchors, {
      pageKind: "flow",
      moduleId: "example-flow",
      moduleRole: "product",
      expectedFlowModules: modules,
      expectedFlowDiagram: flowDiagramPlaceholder("example-flow").replace(/^%%\s*/, ""),
    });
    expect(repaired).not.toBeNull();
    expect(repaired!.repairs.sort()).toEqual(
      ["remove_duplicate_section_anchors", "sync_upper_bound_frontmatter_anchors"].sort(),
    );
    expect(validateFlow(repaired!.content, anchors).ok).toBe(true);
  });

  it("still fixes the duplicate when an unrelated, already-moot error code rides along (v23 fix)", () => {
    // Priority-0 Phase 2 follow-up #2: a co-occurring error this function
    // doesn't recognize (e.g. missing_page_opening, reported because the
    // model's duplicated section content pushed the required opening out
    // of position) used to abort the whole mechanical repair. It should
    // no longer block a fix the function CAN make — the mandatory final
    // re-validation is what decides success, not the presence of an extra
    // unrecognized error report in the list handed in.
    const valid = makeFlowPage(anchors, modules);
    const broken = valid.replace(
      `<!-- lw:anchors ${anchors[2]} -->`,
      `<!-- lw:anchors ${anchors[2]} ${anchors[0]} -->`,
    );
    const before = validateFlow(broken, anchors);
    expect(before.ok).toBe(false);

    const errorsWithUnrelatedNoise: ArtifactValidationError[] = [
      ...before.errors,
      {
        code: "missing_page_opening",
        message: "required page opening H1 appears after other content",
        location: "body",
        offending: "# Example flow",
      },
    ];
    const repaired = repairUpperBoundArtifactMechanically(broken, errorsWithUnrelatedNoise, anchors, {
      pageKind: "flow",
      moduleId: "example-flow",
      moduleRole: "product",
      expectedFlowModules: modules,
      expectedFlowDiagram: flowDiagramPlaceholder("example-flow").replace(/^%%\s*/, ""),
    });
    expect(repaired).not.toBeNull();
    expect(repaired!.repairs).toEqual(["remove_duplicate_section_anchors"]);
    expect(validateFlow(repaired!.content, anchors).ok).toBe(true);
  });

  it("returns null (fail-closed) for a code it does not support", () => {
    const valid = makeFlowPage(anchors, modules);
    const errors: ArtifactValidationError[] = [
      {
        code: "anchor_missing_required_tier",
        message: 'the page cites no key from the "entry" group',
        location: "section",
        offending: "entry",
      },
    ];
    expect(
      repairUpperBoundArtifactMechanically(valid, errors, anchors, {
        pageKind: "flow",
        moduleId: "example-flow",
        moduleRole: "product",
        expectedFlowModules: modules,
      }),
    ).toBeNull();
  });

  it("returns null for an empty errors list", () => {
    expect(
      repairUpperBoundArtifactMechanically(makeFlowPage(anchors, modules), [], anchors, {
        pageKind: "flow",
        moduleId: "example-flow",
        moduleRole: "product",
        expectedFlowModules: modules,
      }),
    ).toBeNull();
  });
});

describe("repairUpperBoundArtifactMechanically — flowKeySectionMap section preference (Workstream A)", () => {
  const modules = ["a-mod", "b-mod"];
  const k0 = "src/a.ts#a";
  const k1 = "src/b.ts#b";
  const k2 = "src/c.ts#c";
  const kDup = "src/d.ts#d";
  const anchors = [k0, k1, k2, kDup];

  /**
   * Purpose cites k0 + kDup; Ordered flow cites k1; Failure and recovery
   * cites k2 + kDup (the duplicate). Every section keeps >= 1 key even
   * after dedup, regardless of which occurrence is kept.
   */
  function makePage(): string {
    return [
      "---",
      "title: Example flow",
      "owner: generated",
      "anchors:",
      ...anchors.map((k) => `  - ${k}`),
      "modules:",
      ...modules.map((m) => `  - ${m}`),
      "updated: 2026-07-21",
      "---",
      "",
      "# Example flow",
      "",
      "This page explains an example flow end to end.",
      "",
      "## Purpose",
      "",
      `<!-- lw:anchors ${k0} ${kDup} -->`,
      "",
      "The flow begins here and produces a stored result.",
      "",
      "## Ordered flow",
      "",
      `<!-- lw:anchors ${k1} -->`,
      "",
      "1. Step one runs first.",
      "2. Step two persists the result.",
      "",
      "## Diagram",
      "",
      "```mermaid",
      flowDiagramPlaceholder("example-flow"),
      "```",
      "",
      "## Invariants",
      "",
      "- Every step preserves the input payload.",
      "",
      "## Failure and recovery",
      "",
      `<!-- lw:anchors ${k2} ${kDup} -->`,
      "",
      "No retry or rollback path is shown; the flow fails open.",
      "",
      "## Related pages",
      "",
      ...modules.map((m) => `- [${m} module](../${m}.md)`),
      "",
    ].join("\n");
  }

  const context = {
    pageKind: "flow" as const,
    moduleId: "example-flow",
    moduleRole: "product" as const,
    expectedFlowModules: modules,
    expectedFlowDiagram: flowDiagramPlaceholder("example-flow").replace(/^%%\s*/, ""),
  };

  it("without a section map, keeps the first occurrence (Purpose) — pre-existing behavior", () => {
    const broken = makePage();
    const before = validateStage4Artifact(broken, anchors, context);
    expect(before.ok).toBe(false);

    const repaired = repairUpperBoundArtifactMechanically(broken, before.errors, anchors, context);
    expect(repaired).not.toBeNull();
    expect(repaired!.content).toContain(`<!-- lw:anchors ${k0} ${kDup} -->`);
    expect(repaired!.content).toContain(`<!-- lw:anchors ${k2} -->`);
    expect(validateStage4Artifact(repaired!.content, anchors, context).ok).toBe(true);
  });

  it("with a section map assigning kDup to failure-and-recovery, keeps that occurrence instead of the first", () => {
    const broken = makePage();
    const before = validateStage4Artifact(broken, anchors, context);
    expect(before.ok).toBe(false);

    const sectionMap: FlowKeySectionMap = new Map([
      [k0, "purpose"],
      [k1, "ordered-flow"],
      [k2, "failure-and-recovery"],
      [kDup, "failure-and-recovery"],
    ]);
    const repaired = repairUpperBoundArtifactMechanically(
      broken,
      before.errors,
      anchors,
      context,
      sectionMap,
    );
    expect(repaired).not.toBeNull();
    expect(repaired!.content).toContain(`<!-- lw:anchors ${k0} -->`);
    expect(repaired!.content).toContain(`<!-- lw:anchors ${k2} ${kDup} -->`);
    expect(validateStage4Artifact(repaired!.content, anchors, context).ok).toBe(true);
  });

  it("falls back to keep-first when no occurrence sits in the assigned section", () => {
    const broken = makePage();
    const before = validateStage4Artifact(broken, anchors, context);
    expect(before.ok).toBe(false);

    // kDup is assigned to "ordered-flow", but no occurrence of kDup is
    // actually inside that section (it only appears in Purpose and
    // Failure-and-recovery) — the function must not invent a match and
    // should fall back to "keep first" (Purpose).
    const sectionMap: FlowKeySectionMap = new Map([
      [k0, "purpose"],
      [k1, "ordered-flow"],
      [k2, "failure-and-recovery"],
      [kDup, "ordered-flow"],
    ]);
    const repaired = repairUpperBoundArtifactMechanically(
      broken,
      before.errors,
      anchors,
      context,
      sectionMap,
    );
    expect(repaired).not.toBeNull();
    expect(repaired!.content).toContain(`<!-- lw:anchors ${k0} ${kDup} -->`);
    expect(repaired!.content).toContain(`<!-- lw:anchors ${k2} -->`);
    expect(validateStage4Artifact(repaired!.content, anchors, context).ok).toBe(true);
  });
});

describe("repairUpperBoundArtifactMechanically — required-section coverage preservation (2026-07-26 defect fix)", () => {
  // Paid-E2E defect (MoneyPrinterTurbo-Plus, MiniMax-M3, two runs): the
  // keySectionMap-preferred keeper of a duplicated key stripped the LAST
  // marker of "Ordered flow", so the mandatory re-validation failed with
  // anchor_missing_in_required_section and the mechanical repair returned
  // null on every attempt (repair_exhausted). Coverage must outrank the
  // assigned-section preference.
  const modules = ["a-mod", "b-mod"];
  const k0 = "src/a.ts#a";
  const k1 = "src/b.ts#b";
  const k2 = "src/c.ts#c";
  const kDup = "src/d.ts#d";

  const context = {
    pageKind: "flow" as const,
    moduleId: "example-flow",
    moduleRole: "product" as const,
    expectedFlowModules: modules,
    expectedFlowDiagram: flowDiagramPlaceholder("example-flow").replace(/^%%\s*/, ""),
  };

  function makePage(purposeKeys: string[], orderedKeys: string[], failureKeys: string[]): string {
    const allKeys = [...new Set([...purposeKeys, ...orderedKeys, ...failureKeys])];
    return [
      "---",
      "title: Example flow",
      "owner: generated",
      "anchors:",
      ...allKeys.map((k) => `  - ${k}`),
      "modules:",
      ...modules.map((m) => `  - ${m}`),
      "updated: 2026-07-26",
      "---",
      "",
      "# Example flow",
      "",
      "This page explains an example flow end to end.",
      "",
      "## Purpose",
      "",
      `<!-- lw:anchors ${purposeKeys.join(" ")} -->`,
      "",
      "The flow begins here and produces a stored result.",
      "",
      "## Ordered flow",
      "",
      `<!-- lw:anchors ${orderedKeys.join(" ")} -->`,
      "",
      "1. Step one runs first.",
      "2. Step two persists the result.",
      "",
      "## Diagram",
      "",
      "```mermaid",
      flowDiagramPlaceholder("example-flow"),
      "```",
      "",
      "## Invariants",
      "",
      "- Every step preserves the input payload.",
      "",
      "## Failure and recovery",
      "",
      `<!-- lw:anchors ${failureKeys.join(" ")} -->`,
      "",
      "No retry or rollback path is shown; the flow fails open.",
      "",
      "## Related pages",
      "",
      ...modules.map((m) => `- [${m} module](../${m}.md)`),
      "",
    ].join("\n");
  }

  it("(a) keeps a required section's last marker when the keySectionMap preference would strip it", () => {
    // "Ordered flow" carries ONLY kDup; kDup is duplicated in Purpose and
    // the map assigns kDup to "purpose". The preference alone would strip
    // Ordered flow's last marker — coverage must win instead.
    const anchors = [k0, k2, kDup];
    const broken = makePage([k0, kDup], [kDup], [k2]);
    const before = validateStage4Artifact(broken, anchors, context);
    expect(before.ok).toBe(false);
    expect(before.errors.some((e) => e.code === "duplicate_anchor" && e.offending === kDup)).toBe(true);

    const sectionMap: FlowKeySectionMap = new Map([
      [k0, "purpose"],
      [kDup, "purpose"],
      [k2, "failure-and-recovery"],
    ]);
    const repaired = repairUpperBoundArtifactMechanically(
      broken,
      before.errors,
      anchors,
      context,
      sectionMap,
    );
    expect(repaired).not.toBeNull();
    expect(repaired!.repairs).toEqual(["remove_duplicate_section_anchors"]);
    // Coverage preserved: kDup stays in "Ordered flow" (its only marker),
    // and is removed from the map-preferred Purpose occurrence instead.
    expect(repaired!.content).toContain(`<!-- lw:anchors ${k0} -->`);
    expect(repaired!.content).toContain(`<!-- lw:anchors ${kDup} -->`);
    const after = validateStage4Artifact(repaired!.content, anchors, context);
    expect(after.ok).toBe(true);
    expect(
      after.errors.some((e) => e.code === "anchor_missing_in_required_section"),
    ).toBe(false);
  });

  it("(b) keeps the keySectionMap preference when it does not conflict with coverage", () => {
    // Both duplicated sections retain another key after dedup, so the map
    // preference (kDup -> ordered-flow) applies unchanged — no regression.
    const anchors = [k0, k1, k2, kDup];
    const broken = makePage([k0, kDup], [k1, kDup], [k2]);
    const before = validateStage4Artifact(broken, anchors, context);
    expect(before.ok).toBe(false);

    const sectionMap: FlowKeySectionMap = new Map([
      [k0, "purpose"],
      [k1, "ordered-flow"],
      [kDup, "ordered-flow"],
      [k2, "failure-and-recovery"],
    ]);
    const repaired = repairUpperBoundArtifactMechanically(
      broken,
      before.errors,
      anchors,
      context,
      sectionMap,
    );
    expect(repaired).not.toBeNull();
    expect(repaired!.content).toContain(`<!-- lw:anchors ${k0} -->`);
    expect(repaired!.content).toContain(`<!-- lw:anchors ${k1} ${kDup} -->`);
    expect(validateStage4Artifact(repaired!.content, anchors, context).ok).toBe(true);
  });

  it("(c) returns null when two required sections share a single duplicated key (genuinely unfixable)", () => {
    // Purpose and Ordered flow each carry ONLY kDup. Dedup must strip one
    // of them no matter which occurrence is kept — no coverage-preserving
    // repair exists, so the function stays fail-closed.
    const anchors = [k2, kDup];
    const broken = makePage([kDup], [kDup], [k2]);
    const before = validateStage4Artifact(broken, anchors, context);
    expect(before.ok).toBe(false);
    expect(before.errors.some((e) => e.code === "duplicate_anchor" && e.offending === kDup)).toBe(true);

    const sectionMap: FlowKeySectionMap = new Map([
      [kDup, "purpose"],
      [k2, "failure-and-recovery"],
    ]);
    const repaired = repairUpperBoundArtifactMechanically(
      broken,
      before.errors,
      anchors,
      context,
      sectionMap,
    );
    expect(repaired).toBeNull();
  });
});
