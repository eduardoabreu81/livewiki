import { describe, expect, it } from "vitest";
import { planPageUnits } from "./page-units.js";
import {
  renderFolderPage,
  validateFolderPurpose,
  FOLDER_PURPOSE_MAX_CHARS,
} from "./folder-page.js";

function planFor(paths: Array<{ path: string; symbols?: number }>) {
  return planPageUnits({
    filePaths: paths.map((p) => p.path),
    symbolCountByPath: new Map(paths.map((p) => [p.path, p.symbols ?? 0])),
    sizeByPath: new Map(paths.map((p) => [p.path, 1000])),
  });
}

describe("validateFolderPurpose", () => {
  it("accepts a plain prose paragraph", () => {
    expect(
      validateFolderPurpose(
        "This directory holds the batch orchestrator: run state, checkpoints, and the stage-4 task loop.",
      ),
    ).toEqual([]);
  });

  it("rejects empty, short, long, and structured content", () => {
    expect(validateFolderPurpose("")[0]!.code).toBe("folder_purpose_empty");
    expect(validateFolderPurpose("too short")[0]!.code).toBe(
      "folder_purpose_too_short",
    );
    expect(
      validateFolderPurpose("x".repeat(FOLDER_PURPOSE_MAX_CHARS + 1))[0]!.code,
    ).toBe("folder_purpose_too_long");
    expect(validateFolderPurpose("## heading\nbut long enough to pass the minimum length check")[0]?.code).toBe(
      "folder_purpose_invalid_shape",
    );
    expect(
      validateFolderPurpose("see [batch](batch.md) for the orchestrator details of this folder"),
    ).toEqual([
      expect.objectContaining({ code: "folder_purpose_invalid_shape" }),
    ]);
  });
});

describe("renderFolderPage", () => {
  const files = [
    { path: "src/batch.ts", symbols: 55 },
    { path: "src/view.ts", symbols: 48 },
    { path: "src/index.ts" },
    { path: "src/batch.test.ts", symbols: 9 },
    { path: "src/batch-repair.test.ts", symbols: 4 },
    { path: "src/e2e.test.ts", symbols: 3 },
  ];

  it("renders the deterministic guide with pairing, likely, and orphan dispositions", () => {
    const plan = planFor(files);
    const folder = plan.folderUnits.find((f) => f.id === "src")!;
    const existing = new Set(plan.fileUnits.map((u) => u.pagePath));
    const page = renderFolderPage({
      folder,
      fileUnits: plan.fileUnits,
      symbolCountByPath: new Map(files.map((f) => [f.path, f.symbols ?? 0])),
      existingPagePaths: existing,
      purpose: "The orchestration core: batch runs, checkpoints, and the stage-4 loop.",
    });
    expect(page).toContain("# src");
    expect(page).toContain("owner: generated");
    expect(page).toContain("- [batch.ts](batch.md) — 55 symbols · Tests: `batch.test.ts`");
    expect(page).toContain("- [view.ts](view.md) — 48 symbols");
    expect(page).toContain("- `index.ts` — no symbols extracted");
    expect(page).toContain("`batch-repair.test.ts` — test file, likely covers `batch` (name-prefix match, not verified)");
    expect(page).toContain("`e2e.test.ts` — orphan: no product file in this repository matches this test");
    expect(page).toContain("Same-name test coverage: 1 of 2 documented files.");
  });

  it("never links a page that does not exist on disk", () => {
    const plan = planFor(files);
    const folder = plan.folderUnits.find((f) => f.id === "src")!;
    const page = renderFolderPage({
      folder,
      fileUnits: plan.fileUnits,
      symbolCountByPath: new Map(files.map((f) => [f.path, f.symbols ?? 0])),
      existingPagePaths: new Set(), // every generation failed
      purpose: "The orchestration core: batch runs, checkpoints, and the stage-4 loop.",
    });
    expect(page).not.toContain("](batch.md)");
    expect(page).toContain("`batch.ts` — 55 symbols · page unavailable (generation failed)");
  });

  it("uses the deterministic role sentence for non-product folders (zero tokens)", () => {
    const plan = planFor([{ path: "fixtures/sample.ts", symbols: 2 }]);
    const folder = plan.folderUnits.find((f) => f.id === "fixtures")!;
    const page = renderFolderPage({
      folder,
      fileUnits: plan.fileUnits,
      symbolCountByPath: new Map([["fixtures/sample.ts", 2]]),
      existingPagePaths: new Set(plan.fileUnits.map((u) => u.pagePath)),
      purpose: "",
      role: "fixture",
    });
    expect(page).toContain("test fixtures and supporting test data");
  });
});
