/**
 * folder-page — the folder page unit (#29): deterministic skeleton + one
 * bounded LLM purpose paragraph.
 *
 * The folder page is the front door for browsing: one honest paragraph
 * answering "what is this directory for" plus the deterministic file
 * guide. The guide is NEVER model output — it renders from the planner's
 * real-units partition, so no file can be invented or omitted and no link
 * can point at a page that does not exist (the caller passes the set of
 * file pages actually written; failed generations degrade to a plain
 * name, never a dangling link).
 *
 * Product rule (maintainer 2026-08-08): no special machinery per file
 * type. Tests appear as dispositions in the guide: a 1:1 same-name
 * pairing is a fact ("Tests: `x.test.ts`"), a prefix-only match is
 * "likely" (never asserted), and an unmatched test is registered as an
 * orphan — the tool states the anomaly instead of hiding it.
 *
 * The deterministic skeleton strings are English (same convention as
 * `auxiliary-page.ts`); the LLM purpose paragraph is written in the
 * configured wiki language by the prompt.
 */

import type { FileUnit, FolderUnit } from "./page-units.js";
import { folderCoverageSignal } from "./page-units.js";
import type { PathRole } from "./modules.js";

/** Purpose paragraph bounds (understanding-style strict contract). */
export const FOLDER_PURPOSE_MIN_CHARS = 40;
export const FOLDER_PURPOSE_MAX_CHARS = 800;

export interface FolderPurposeError {
  code:
    | "folder_purpose_empty"
    | "folder_purpose_too_short"
    | "folder_purpose_too_long"
    | "folder_purpose_invalid_shape";
  message: string;
}

const FOLDER_ROLE_SENTENCE: Record<Exclude<PathRole, "product">, string> = {
  test: "This directory holds automated tests with no co-located product code.",
  fixture: "This directory holds test fixtures and supporting test data.",
  tooling: "This directory holds build tooling, scripts, or benchmarks.",
  docs: "This directory holds repository documentation.",
};

/**
 * Strict validation of the LLM purpose paragraph. The paragraph carries
 * no anchors, no links, and no structure — those are deterministic —
 * so the checks are deliberately small.
 */
export function validateFolderPurpose(raw: string): FolderPurposeError[] {
  const text = raw.trim();
  if (text.length === 0) {
    return [
      {
        code: "folder_purpose_empty",
        message: "the folder purpose is empty — write one paragraph stating what this directory is for",
      },
    ];
  }
  const errors: FolderPurposeError[] = [];
  if (text.length < FOLDER_PURPOSE_MIN_CHARS) {
    errors.push({
      code: "folder_purpose_too_short",
      message: `the folder purpose has ${text.length} characters; the minimum is ${FOLDER_PURPOSE_MIN_CHARS}`,
    });
  }
  if (text.length > FOLDER_PURPOSE_MAX_CHARS) {
    errors.push({
      code: "folder_purpose_too_long",
      message: `the folder purpose has ${text.length} characters; the maximum is ${FOLDER_PURPOSE_MAX_CHARS} — shorten ONLY the paragraph`,
    });
  }
  if (
    text.startsWith("---") ||
    /^#{1,6}\s/m.test(text) ||
    text.includes("```") ||
    /<!--/.test(text) ||
    /\[[^\]]*\]\([^)]*\)/.test(text) ||
    /(^|\s)(TODO|TBD)[:!\s]/m.test(text)
  ) {
    errors.push({
      code: "folder_purpose_invalid_shape",
      message:
        "the folder purpose must be plain prose: no frontmatter, headings, code fences, HTML comments, Markdown links, or TODO/TBD placeholders",
    });
  }
  return errors;
}

export interface RenderFolderPageOptions {
  readonly folder: FolderUnit;
  /** File units of this folder (page disposition entries). */
  readonly fileUnits: readonly FileUnit[];
  readonly symbolCountByPath: ReadonlyMap<string, number>;
  /**
   * Wiki page paths that actually exist on disk. A file entry whose page
   * is missing (failed generation) renders as a plain name — never a
   * dangling link.
   */
  readonly existingPagePaths: ReadonlySet<string>;
  /**
   * The LLM purpose paragraph (already validated). Empty for non-product
   * folders, which get a deterministic role sentence instead.
   */
  readonly purpose: string;
  /** Non-product folder role: deterministic purpose, zero tokens. */
  readonly role?: Exclude<PathRole, "product">;
}

/** Assemble the complete folder page Markdown. Pure/deterministic. */
export function renderFolderPage(opts: RenderFolderPageOptions): string {
  const { folder, fileUnits, symbolCountByPath, existingPagePaths } = opts;
  const title = folder.dirPath === "" ? "(repository root)" : folder.dirPath;
  const purpose =
    opts.purpose !== ""
      ? opts.purpose
      : opts.role !== undefined
        ? FOLDER_ROLE_SENTENCE[opts.role]
        : "";

  const fileUnitByPath = new Map(fileUnits.map((u) => [u.filePath, u]));
  const lines: string[] = [
    "---",
    `title: ${title}`,
    "owner: generated",
    "---",
    "",
    `# ${title}`,
    "",
  ];
  if (purpose !== "") lines.push(purpose, "");

  lines.push("## Files", "");
  const testLines: string[] = [];
  for (const entry of folder.entries) {
    const name = entry.filePath.split("/").pop()!;
    switch (entry.disposition) {
      case "page": {
        const unit = fileUnitByPath.get(entry.filePath);
        const symbols = symbolCountByPath.get(entry.filePath) ?? 0;
        const pageBase = entry.pagePath?.split("/").pop() ?? "";
        const linked =
          entry.pagePath !== undefined && existingPagePaths.has(entry.pagePath);
        const head = linked ? `[${name}](${pageBase})` : `\`${name}\``;
        const parts = [`${head} — ${symbols} symbol${symbols === 1 ? "" : "s"}`];
        if (!linked) parts.push("page unavailable (generation failed)");
        if (unit?.pairedTestPath !== undefined) {
          parts.push(`Tests: \`${unit.pairedTestPath.split("/").pop()!}\``);
        }
        lines.push(`- ${parts.join(" · ")}`);
        break;
      }
      case "inert":
        lines.push(
          `- \`${name}\` — no symbols extracted (barrel, configuration, or prose file)`,
        );
        break;
      case "test-paired":
        // accounted on the product file's line — no separate entry
        break;
      case "test-likely": {
        const likelyName = entry.likelyProductPath !== undefined
          ? `\`${entry.likelyProductPath.split("/").pop()!.replace(/\.[^.]+$/, "")}\``
          : "a product file";
        testLines.push(
          `- \`${name}\` — test file, likely covers ${likelyName} (name-prefix match, not verified)`,
        );
        break;
      }
      case "test-orphan":
        testLines.push(
          `- \`${name}\` — orphan: no product file in this repository matches this test`,
        );
        break;
    }
  }
  if (testLines.length > 0) {
    lines.push("", "### Test files without a same-name counterpart", "", ...testLines);
  }

  const signal = folderCoverageSignal(folder);
  if (signal.pages > 0) {
    const covered = signal.pages - signal.withoutSameNameTest;
    lines.push(
      "",
      `Same-name test coverage: ${covered} of ${signal.pages} documented file${signal.pages === 1 ? "" : "s"}.`,
    );
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/** Per-file opening cap inside the folder-purpose evidence block. */
const FOLDER_OPENING_CAP = 400;
/** Total cap for the openings section of the evidence block. */
const FOLDER_OPENINGS_TOTAL_CAP = 12_000;

/**
 * Deterministic evidence block for the folder-purpose prompt: the real
 * file inventory (never model-supplied) plus the openings of the folder's
 * accepted file pages. Pure: the caller reads the openings from disk.
 */
export function buildFolderPurposeContext(opts: {
  readonly folder: FolderUnit;
  readonly fileUnits: readonly FileUnit[];
  readonly symbolCountByPath: ReadonlyMap<string, number>;
  /** Opening digest per file page path (only for pages on disk). */
  readonly openingsByPagePath: ReadonlyMap<string, string>;
}): string {
  const { folder, fileUnits, symbolCountByPath, openingsByPagePath } = opts;
  const lines: string[] = [`Directory: ${folder.dirPath === "" ? "(repository root)" : folder.dirPath}`, "", "Files (deterministic inventory):"];
  for (const entry of folder.entries) {
    const symbols = symbolCountByPath.get(entry.filePath) ?? 0;
    lines.push(`- ${entry.filePath} — ${entry.disposition}, ${symbols} symbols`);
  }
  const openings: string[] = [];
  let total = 0;
  for (const unit of fileUnits) {
    const opening = openingsByPagePath.get(unit.pagePath);
    if (opening === undefined) continue;
    const clipped =
      opening.length > FOLDER_OPENING_CAP
        ? opening.slice(0, FOLDER_OPENING_CAP) + "…"
        : opening;
    const block = `### ${unit.filePath}\n${clipped}`;
    if (total + block.length > FOLDER_OPENINGS_TOTAL_CAP) break;
    openings.push(block);
    total += block.length;
  }
  if (openings.length > 0) {
    lines.push("", "Accepted file-page openings (already verify-gated):", "", ...openings);
  }
  return lines.join("\n");
}
