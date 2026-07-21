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
