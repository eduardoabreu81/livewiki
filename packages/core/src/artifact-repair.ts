import {
  validateStage4Artifact,
  type Stage4ValidationContext,
} from "./artifact.js";
import {
  maskCodeSpansPreservingLength,
  unclosedMarkdownDiagnostic,
} from "./markdown-mask.js";
import type { ArtifactValidationError } from "./prompts.js";

export type MechanicalArtifactRepair =
  | "escape_unmatched_inline_delimiter"
  | "append_missing_section_anchors"
  | "fill_empty_anchored_section"
  | "remove_duplicate_section_anchors"
  | "strip_invented_manual_markers";

export interface MechanicalArtifactRepairResult {
  content: string;
  repairs: MechanicalArtifactRepair[];
}

const MAX_INLINE_DELIMITER_REPAIRS = 100;

/**
 * Last-slot fallback for content-safe stage-4 defects observed in paid reruns.
 * The function is deliberately fail-closed: every reported error must be one
 * of the supported shapes, and the complete artifact validator must accept the
 * transformed result before it can be returned.
 */
export function repairStage4ArtifactMechanically(
  artifact: string,
  errors: ReadonlyArray<ArtifactValidationError>,
  closedKeyList: ReadonlyArray<string>,
  context?: Readonly<Stage4ValidationContext>,
): MechanicalArtifactRepairResult | null {
  if (errors.length === 0) return null;

  const missingSectionKeys: string[] = [];
  const emptySectionMarkers: string[] = [];
  const duplicateSectionKeys: string[] = [];
  let hasUnclosedInlineError = false;
  let hasInventedManualError = false;
  const closedSet = new Set(closedKeyList);

  for (const error of errors) {
    if (error.code === "unclosed_markdown") {
      hasUnclosedInlineError = true;
      continue;
    }
    if (
      error.code === "missing_closed_key" &&
      error.location === "section" &&
      error.offending !== undefined &&
      closedSet.has(error.offending)
    ) {
      if (!missingSectionKeys.includes(error.offending)) {
        missingSectionKeys.push(error.offending);
      }
      continue;
    }
    if (
      error.code === "empty_section" &&
      error.location === "section" &&
      error.offending !== undefined &&
      /^<!--\s*lw:anchors\s+([^\s>][^>]*?)\s*-->$/.test(error.offending)
    ) {
      if (!emptySectionMarkers.includes(error.offending)) {
        emptySectionMarkers.push(error.offending);
      }
      continue;
    }
    if (
      error.code === "duplicate_anchor" &&
      error.location === "section" &&
      error.sectionSlug !== undefined &&
      error.offending !== undefined &&
      closedSet.has(error.offending) &&
      error.message.includes("appears in more than one section marker")
    ) {
      if (!duplicateSectionKeys.includes(error.offending)) {
        duplicateSectionKeys.push(error.offending);
      }
      continue;
    }
    if (
      error.code === "model_invented_manual" &&
      error.location === "body" &&
      error.offending === "<!-- lw:manual -->"
    ) {
      hasInventedManualError = true;
      continue;
    }
    return null;
  }

  let content = artifact;
  const repairs: MechanicalArtifactRepair[] = [];

  if (hasUnclosedInlineError) {
    let repairCount = 0;
    for (;;) {
      const diagnostic = unclosedMarkdownDiagnostic(content);
      if (diagnostic === null) break;
      if (diagnostic.kind !== "inline-code") return null;
      if (repairCount >= MAX_INLINE_DELIMITER_REPAIRS) return null;

      const escaped = escapeFirstUnmatchedInlineDelimiter(content);
      if (escaped === null || escaped === content) return null;
      content = escaped;
      repairCount++;
    }
    if (repairCount === 0) return null;
    repairs.push("escape_unmatched_inline_delimiter");
  }

  if (missingSectionKeys.length > 0) {
    const separator = content.endsWith("\n\n")
      ? ""
      : content.endsWith("\n")
        ? "\n"
        : "\n\n";
    content += [
      separator + "## Additional indexed symbols",
      "",
      `<!-- lw:anchors ${missingSectionKeys.join(" ")} -->`,
      "",
      "These anchors identify indexed symbols in this module that were not assigned to an earlier generated section.",
      "",
    ].join("\n");
    repairs.push("append_missing_section_anchors");
  }

  if (emptySectionMarkers.length > 0) {
    const masked = maskCodeSpansPreservingLength(content);
    const insertions: number[] = [];
    for (const marker of emptySectionMarkers) {
      const markerStart = masked.indexOf(marker);
      if (markerStart < 0) return null;
      insertions.push(markerStart + marker.length);
    }
    insertions.sort((a, b) => b - a);
    for (const insertion of insertions) {
      content =
        content.slice(0, insertion) +
        "\n\nThese anchors identify indexed symbols whose implementation is part of this module." +
        content.slice(insertion);
    }
    repairs.push("fill_empty_anchored_section");
  }

  if (duplicateSectionKeys.length > 0) {
    const deduplicated = removeLaterSectionAnchorOccurrences(content, duplicateSectionKeys);
    if (deduplicated === null || deduplicated === content) return null;
    content = deduplicated;
    repairs.push("remove_duplicate_section_anchors");
  }

  if (hasInventedManualError) {
    const stripped = stripManualControlMarkers(content);
    if (stripped === null || stripped === content) return null;
    content = stripped;
    repairs.push("strip_invented_manual_markers");
  }

  if (repairs.length === 0) return null;
  const validation = validateStage4Artifact(content, closedKeyList, context);
  if (!validation.ok) return null;
  return { content, repairs };
}

/**
 * Remove only model-written manual control comments, never their content.
 * Stage 4 forbids the copyable comment sequence even inside code examples,
 * so every occurrence must be stripped for the repaired artifact to validate.
 */
function stripManualControlMarkers(text: string): string | null {
  const markerRe = /<!--\s*\/?lw:manual\s*-->/g;
  const matches = [...text.matchAll(markerRe)];
  if (!matches.some((match) => !/^<!--\s*\/lw:manual\s*-->$/.test(match[0]))) {
    return null;
  }

  let result = text;
  for (const match of matches.sort((a, b) => b.index! - a.index!)) {
    result = result.slice(0, match.index!) + result.slice(match.index! + match[0].length);
  }
  return result;
}

/**
 * Match the validator's order-preserving duplicate rule: the first real
 * section-marker occurrence is canonical and every later occurrence is
 * removed. Marker-shaped examples inside Markdown code remain untouched.
 */
function removeLaterSectionAnchorOccurrences(
  text: string,
  duplicateKeys: ReadonlyArray<string>,
): string | null {
  const targetKeys = new Set(duplicateKeys);
  const masked = maskCodeSpansPreservingLength(text);
  const markerRe = /<!--\s*lw:anchors\s+([^\s>][^>]*?)\s*-->/g;
  const matches = [...masked.matchAll(markerRe)];
  const occurrenceCounts = new Map<string, number>();

  for (const match of matches) {
    const keys = match[1]!.trim().split(/\s+/).filter(Boolean);
    for (const key of keys) {
      if (targetKeys.has(key)) {
        occurrenceCounts.set(key, (occurrenceCounts.get(key) ?? 0) + 1);
      }
    }
  }
  if (duplicateKeys.some((key) => (occurrenceCounts.get(key) ?? 0) < 2)) {
    return null;
  }

  const seen = new Set<string>();
  const replacements: Array<{ start: number; end: number; value: string }> = [];
  for (const match of matches) {
    const keys = match[1]!.trim().split(/\s+/).filter(Boolean);
    const kept: string[] = [];
    let changed = false;
    for (const key of keys) {
      if (targetKeys.has(key)) {
        if (seen.has(key)) {
          changed = true;
          continue;
        }
        seen.add(key);
      }
      kept.push(key);
    }
    if (changed) {
      const start = match.index!;
      replacements.push({
        start,
        end: start + match[0].length,
        value: kept.length > 0 ? `<!-- lw:anchors ${kept.join(" ")} -->` : "",
      });
    }
  }

  let result = text;
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
    result =
      result.slice(0, replacement.start) +
      replacement.value +
      result.slice(replacement.end);
  }
  return result;
}

/**
 * Preserve the rendered literal delimiter while preventing an unmatched raw
 * backtick run from being interpreted as an open inline-code span.
 */
function escapeFirstUnmatchedInlineDelimiter(text: string): string | null {
  const masked = maskCodeSpansPreservingLength(text);
  const start = masked.indexOf("`");
  if (start < 0) return null;

  let runLength = 1;
  while (start + runLength < text.length && text[start + runLength] === "`") {
    runLength++;
  }
  return (
    text.slice(0, start) +
    "&#96;".repeat(runLength) +
    text.slice(start + runLength)
  );
}
