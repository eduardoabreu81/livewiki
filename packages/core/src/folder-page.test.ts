import { describe, expect, it } from "vitest";
import { planPageUnits } from "./page-units.js";
import {
  extractPageTitle,
  plainTestCoverageLine,
  renderFolderPage,
  truncateFolderPurpose,
  validateFolderPurpose,
  FOLDER_PURPOSE_MAX_CHARS,
  FOLDER_PURPOSE_MIN_CHARS,
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

describe("truncateFolderPurpose (2026-08-12 deterministic length fallback)", () => {
  const sentence = (n: number) =>
    `Sentence ${n} describes one responsibility of this directory in plain words.`;

  it("returns the text unchanged when it already fits the cap", () => {
    const text = "This directory holds the batch orchestrator and its checkpoints.";
    expect(truncateFolderPurpose(text)).toBe(text);
  });

  it("clips at the LAST sentence boundary that fits under the cap", () => {
    const sentences = Array.from({ length: 12 }, (_, i) => sentence(i + 1));
    const text = sentences.join(" ");
    expect(text.length).toBeGreaterThan(FOLDER_PURPOSE_MAX_CHARS);
    const clipped = truncateFolderPurpose(text);
    expect(clipped).not.toBeNull();
    expect(clipped!.length).toBeLessThanOrEqual(FOLDER_PURPOSE_MAX_CHARS);
    expect(clipped!.length).toBeGreaterThanOrEqual(FOLDER_PURPOSE_MIN_CHARS);
    expect(clipped!.endsWith(".")).toBe(true);
    expect(text.startsWith(clipped!)).toBe(true);
    // One more full sentence would NOT have fit.
    const next = clipped!.length + 1 + sentence(1).length;
    expect(next).toBeGreaterThan(FOLDER_PURPOSE_MAX_CHARS);
    expect(validateFolderPurpose(clipped!)).toEqual([]);
  });

  it("normalizes newlines before measuring", () => {
    const long = `${sentence(1)}\n\n${Array.from({ length: 12 }, (_, i) => sentence(i + 2)).join(" ")}`;
    const clipped = truncateFolderPurpose(long);
    expect(clipped).not.toBeNull();
    expect(clipped).not.toContain("\n");
    expect(clipped!.length).toBeLessThanOrEqual(FOLDER_PURPOSE_MAX_CHARS);
  });

  it("returns null when no honest clip point exists (one oversized sentence)", () => {
    expect(truncateFolderPurpose("x".repeat(FOLDER_PURPOSE_MAX_CHARS + 50))).toBeNull();
  });

  it("returns null when the only boundary lands below the minimum", () => {
    const text = `Hi. ${"y".repeat(FOLDER_PURPOSE_MAX_CHARS)}`;
    expect(truncateFolderPurpose(text)).toBeNull();
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
    expect(page).toContain("- [batch.ts](batch.md) · Tests: `batch.test.ts`");
    expect(page).toContain("- [view.ts](view.md)");
    expect(page).toContain("- `index.ts` — not documented (re-export, configuration, or plain-text file)");
    expect(page).toContain("`batch-repair.test.ts` — test file, probably covers `batch` (guessed from the file name)");
    expect(page).toContain("`e2e.test.ts` — no product file in this repository matches this test");
    expect(page).toContain(
      "1 of the 2 documented files in this folder have a test file named after them.",
    );
  });

  it("leads each guide line with the accepted page's title when available (#30)", () => {
    const plan = planFor(files);
    const folder = plan.folderUnits.find((f) => f.id === "src")!;
    const existing = new Set(plan.fileUnits.map((u) => u.pagePath));
    const titlesByPagePath = new Map<string, string>([
      ["livewiki/src/batch.md", "Batch orchestration and task queue"],
      // view.md intentionally has no title → bare-link fallback.
    ]);
    const page = renderFolderPage({
      folder,
      fileUnits: plan.fileUnits,
      symbolCountByPath: new Map(files.map((f) => [f.path, f.symbols ?? 0])),
      existingPagePaths: existing,
      titlesByPagePath,
      purpose: "The orchestration core: batch runs, checkpoints, and the stage-4 loop.",
    });
    expect(page).toContain(
      "- [batch.ts](batch.md) — Batch orchestration and task queue · Tests: `batch.test.ts`",
    );
    expect(page).not.toContain("symbols");
    expect(page).toContain("- [view.ts](view.md)\n");
  });

  it("ignores titles for pages that are not on disk (never upgrades a failed generation)", () => {
    const plan = planFor(files);
    const folder = plan.folderUnits.find((f) => f.id === "src")!;
    const page = renderFolderPage({
      folder,
      fileUnits: plan.fileUnits,
      symbolCountByPath: new Map(files.map((f) => [f.path, f.symbols ?? 0])),
      existingPagePaths: new Set(),
      titlesByPagePath: new Map([["livewiki/src/batch.md", "Stale title"]]),
      purpose: "The orchestration core: batch runs, checkpoints, and the stage-4 loop.",
    });
    expect(page).not.toContain("Stale title");
    expect(page).toContain("`batch.ts` · page not written yet");
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
    expect(page).toContain("`batch.ts` · page not written yet");
  });

  it("shows an inert prose file's own title instead of the raw filename (#30 follow-up)", () => {
    const plan = planFor([
      { path: "docs/guide.md" },
      { path: "docs/notes.txt" },
    ]);
    const folder = plan.folderUnits.find((f) => f.id === "docs")!;
    const withTitle = renderFolderPage({
      folder,
      fileUnits: plan.fileUnits,
      symbolCountByPath: new Map(),
      existingPagePaths: new Set(),
      proseTitlesByFilePath: new Map([["docs/guide.md", "How to install and run the product"]]),
      purpose: "",
      role: "docs",
    });
    expect(withTitle).toContain("- `guide.md` — How to install and run the product");
    expect(withTitle).not.toContain("`guide.md` — not documented");
    // Non-harvested inert files keep the plain fallback.
    expect(withTitle).toContain("- `notes.txt` — not documented (re-export, configuration, or plain-text file)");
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

describe("plainTestCoverageLine (#30 plain language)", () => {
  it("reads as a sentence for none / partial / all / single-file shapes", () => {
    expect(plainTestCoverageLine(0, 3)).toBe(
      "None of the 3 documented files in this folder has a test file named after it.",
    );
    expect(plainTestCoverageLine(1, 2)).toBe(
      "1 of the 2 documented files in this folder have a test file named after them.",
    );
    expect(plainTestCoverageLine(4, 4)).toBe(
      "Every documented file in this folder has a test file named after it.",
    );
    expect(plainTestCoverageLine(1, 1)).toBe(
      "This file has a test file named after it.",
    );
    expect(plainTestCoverageLine(0, 1)).toBe(
      "This file has no test file named after it.",
    );
  });
});

describe("extractPageTitle", () => {
  it("prefers the frontmatter title and falls back to the first H1", () => {
    expect(
      extractPageTitle("---\ntitle: File path containment\nowner: generated\n---\n# Other\n"),
    ).toBe("File path containment");
    expect(extractPageTitle("# Just a heading\n\nprose\n")).toBe("Just a heading");
    expect(extractPageTitle("---\nowner: generated\n---\nno heading\n")).toBeNull();
  });

  it("accepts an H1 behind an HTML preamble (badges, aligned divs) but never a mid-document section (#30 measurement)", () => {
    // Real-world README shape (MPTP): HTML title block, then prose. The
    // first Markdown H1 is a setup note deep in the file — NOT the
    // document's title; the honest answer is null (caller's fallback).
    const htmlTitled = [
      '<div align="center">',
      '<h1 align="center">Some Product</h1>',
      "</div>",
      "",
      "Prose about the product follows the HTML block.",
      "",
      "# Windows setup notes",
      "",
      "Details.",
    ].join("\n");
    expect(extractPageTitle(htmlTitled)).toBeNull();
    // A Markdown H1 directly after an HTML badge block IS title-position.
    expect(
      extractPageTitle('<div align="center"><img src="badge.svg"></div>\n\n# Real Title\n\nprose\n'),
    ).toBe("Real Title");
    // Prose first, H1 later: the H1 is a section, not the title.
    expect(extractPageTitle("Opening prose.\n\n# Later section\n")).toBeNull();
    // Wiki pages without a frontmatter title still resolve their own H1.
    expect(extractPageTitle("---\nowner: generated\n---\n\n# Page Heading\n\ntext\n")).toBe("Page Heading");
  });
});
