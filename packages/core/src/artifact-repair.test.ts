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
import { repairStage4ArtifactMechanically } from "./artifact-repair.js";
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
