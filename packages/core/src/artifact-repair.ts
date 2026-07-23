import {
  validateStage4Artifact,
  type Stage4ValidationContext,
} from "./artifact.js";
import {
  maskCodeSpansPreservingLength,
  unclosedMarkdownDiagnostic,
} from "./markdown-mask.js";
import type { ArtifactValidationError } from "./prompts.js";
import type { FlowRequiredSection } from "./flows.js";

export type MechanicalArtifactRepair =
  | "escape_unmatched_inline_delimiter"
  | "append_missing_section_anchors"
  | "fill_empty_anchored_section"
  | "remove_duplicate_section_anchors"
  | "strip_invented_manual_markers"
  | "sync_upper_bound_frontmatter_anchors";

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
 * Mechanical fallback for flow/topic pages ("upper bound" contract: the
 * closed list caps what MAY be cited, but frontmatter anchors and section-
 * marker keys only need to equal EACH OTHER, not the full closed list).
 * Under that contract every `duplicate_anchor`/`missing_closed_key` this
 * function accepts has an unambiguous mechanical fix — no content
 * invention required, unlike the module-page `missing_closed_key` (section)
 * case, which requires a whole new documented section:
 *
 *   - `duplicate_anchor` (section): keep the first section-marker
 *     occurrence, drop the later ones (same routine as stage 4).
 *   - `missing_closed_key` (frontmatter): the key is already cited in a
 *     section marker — add it to the frontmatter anchors list.
 *   - `missing_closed_key` (section): the key is only in the frontmatter
 *     list with no section citing it — drop it from the frontmatter list
 *     (the repair prompt already tells the model this is a valid fix for
 *     an upper-bound contract; the observed failure was the model
 *     forgetting to apply its own guidance across repair rounds).
 *
 * Priority-0 Phase 2 follow-up (2026-07-21 improvement pass): the v22 paid
 * E2E showed a flow page cascade through 3 repair rounds — an initial
 * `duplicate_anchor` batch, then the model's OWN repair attempt introducing
 * `missing_closed_key` errors it never resolved. Applying this fallback
 * immediately (not just on the final repair slot) removes that whole class
 * of round-trip before it can cascade.
 *
 * Priority-0 Phase 2 follow-up #2 (2026-07-21, v23 paid E2E): a co-occurring
 * error this function doesn't recognize (e.g. `missing_page_opening`) used
 * to abort the whole repair, even when every OTHER error was a plain
 * `duplicate_anchor`/`missing_closed_key`. Unrecognized errors are now
 * skipped rather than treated as fail-closed triggers — the mandatory final
 * `validateStage4Artifact` re-check below is the actual safety net, so a
 * genuinely unresolved unrelated error still yields `null` exactly as
 * before. This also covers the real-world case where duplicated section
 * markers inflate a page enough to push the required opening out of
 * position: deduping can incidentally fix `missing_page_opening` too.
 *
 * Workstream A (deterministic flow-section assignment) and its topic
 * counterpart (`assignTopicKeySections` in topics.ts): when the caller
 * supplies `keySectionMap`, deduping a key with more than one
 * section-marker occurrence PREFERS the occurrence sitting in that key's
 * assigned section over "keep first" — the closed list no longer has to
 * guess which duplicate is the correct one. `headingMap` selects which
 * page's H2 vocabulary to resolve ancestry against (flow's 3 sections by
 * default; pass `TOPIC_SECTION_HEADING_MAP` for a topic page). If no
 * occurrence sits in the assigned section (or the map is omitted), this
 * falls back to the original "keep first occurrence" behavior exactly as
 * before — never a regression for existing callers.
 */
export function repairUpperBoundArtifactMechanically(
  artifact: string,
  errors: ReadonlyArray<ArtifactValidationError>,
  closedKeyList: ReadonlyArray<string>,
  context: Readonly<Stage4ValidationContext>,
  keySectionMap?: ReadonlyMap<string, string>,
  headingMap: Readonly<Record<string, string>> = FLOW_SECTION_HEADING_MAP,
): MechanicalArtifactRepairResult | null {
  if (errors.length === 0) return null;
  const closedSet = new Set(closedKeyList);

  const duplicateSectionKeys: string[] = [];
  const addToFrontmatter: string[] = [];
  const removeFromFrontmatter: string[] = [];

  for (const error of errors) {
    if (
      error.code === "duplicate_anchor" &&
      error.location === "section" &&
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
      error.code === "missing_closed_key" &&
      error.offending !== undefined &&
      closedSet.has(error.offending)
    ) {
      if (error.location === "frontmatter" && !addToFrontmatter.includes(error.offending)) {
        addToFrontmatter.push(error.offending);
        continue;
      }
      if (error.location === "section" && !removeFromFrontmatter.includes(error.offending)) {
        removeFromFrontmatter.push(error.offending);
        continue;
      }
    }
    // Any other error code is left for the caller's LLM repair path — the
    // mandatory full re-validation below still fails closed if it's never
    // actually resolved by the mechanical fixes applied here.
  }

  let content = artifact;
  const repairs: MechanicalArtifactRepair[] = [];

  if (duplicateSectionKeys.length > 0) {
    const deduplicated = removeLaterSectionAnchorOccurrences(
      content,
      duplicateSectionKeys,
      keySectionMap,
      headingMap,
    );
    if (deduplicated === null || deduplicated === content) return null;
    content = deduplicated;
    repairs.push("remove_duplicate_section_anchors");
  }

  if (addToFrontmatter.length > 0 || removeFromFrontmatter.length > 0) {
    const synced = syncFrontmatterAnchorsList(content, addToFrontmatter, removeFromFrontmatter);
    if (synced === null || synced === content) return null;
    content = synced;
    repairs.push("sync_upper_bound_frontmatter_anchors");
  }

  if (repairs.length === 0) return null;
  const validation = validateStage4Artifact(content, closedKeyList, context);
  if (!validation.ok) return null;
  return { content, repairs };
}

/**
 * Adds/removes entries in the top-level frontmatter `anchors:` YAML list,
 * preserving every other byte (indentation style, line endings, comments
 * on unrelated lines). Fails closed (returns null) rather than guess when
 * the frontmatter shape is not the plain block-list form every stage-4/5
 * artifact writes, or when a requested removal names a key that is not
 * actually present as a list item.
 */
function syncFrontmatterAnchorsList(
  artifact: string,
  keysToAdd: readonly string[],
  keysToRemove: readonly string[],
): string | null {
  if (!artifact.startsWith("---\n") && !artifact.startsWith("---\r\n")) return null;
  const parts = artifact.split(/(\r?\n)/);
  const isAnchorsLine = (line: string): boolean => /^anchors:/.test(line);
  const isClosingDelimiter = (line: string): boolean => /^---[ \t]*$/.test(line);
  const isTopLevelKey = (line: string): boolean => /^[A-Za-z_][\w-]*[ \t]*:/.test(line);

  let closingIdx = -1;
  for (let i = 2; i < parts.length; i += 2) {
    if (isClosingDelimiter(parts[i] as string)) {
      closingIdx = i;
      break;
    }
  }
  if (closingIdx === -1) return null;

  let anchorsIdx = -1;
  for (let i = 2; i < closingIdx; i += 2) {
    if (isAnchorsLine(parts[i] as string)) {
      anchorsIdx = i;
      break;
    }
  }
  if (anchorsIdx === -1) return null;

  let endIdx = closingIdx;
  for (let i = anchorsIdx + 2; i < closingIdx; i += 2) {
    if (isTopLevelKey(parts[i] as string)) {
      endIdx = i;
      break;
    }
  }

  const itemRe = /^([ \t]*-[ \t]+)(\S.*?)[ \t]*$/;
  const removeSet = new Set(keysToRemove);
  let indentPrefix = "  - ";
  let removedAny = false;

  const before = parts.slice(0, anchorsIdx + 2);
  const listBody: string[] = [];
  for (let i = anchorsIdx + 2; i < endIdx; i += 2) {
    const line = parts[i] as string;
    const sep = parts[i + 1] as string;
    const m = itemRe.exec(line);
    if (m) {
      indentPrefix = m[1] as string;
      if (removeSet.has(m[2] as string)) {
        removedAny = true;
        continue;
      }
    }
    listBody.push(line, sep);
  }
  if (keysToRemove.length > 0 && !removedAny) return null;

  const lineSep = (parts[anchorsIdx + 1] as string) ?? "\n";
  for (const key of keysToAdd) {
    listBody.push(`${indentPrefix}${key}`, lineSep);
  }

  const after = parts.slice(endIdx);
  return [...before, ...listBody, ...after].join("");
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

/** Maps a flow page's H2 section heading text to its FlowRequiredSection, if any. */
const FLOW_SECTION_HEADING_MAP: Readonly<Record<string, FlowRequiredSection>> = {
  purpose: "purpose",
  "ordered flow": "ordered-flow",
  "failure and recovery": "failure-and-recovery",
};

/** Maps a topic page's H2 section heading text to its TopicRequiredSection, if any. */
export const TOPIC_SECTION_HEADING_MAP: Readonly<Record<string, string>> = {
  purpose: "purpose",
  "when to use this page": "when-to-use-this-page",
  "behavioral contract": "behavioral-contract",
  "failure and recovery": "failure-and-recovery",
  "change map": "change-map",
};

/**
 * Which required section (if any) contains `index`, based on the last H2
 * heading (`## ...`) at or before it and the supplied heading vocabulary
 * (flow's 3 sections or a topic's 5). An H2 outside that vocabulary resets
 * the ancestor to null (H3+ subsections do NOT reset it — only a
 * sibling/next H2 does, matching the validator's own "H3+ subsection of
 * those sections is allowed" rule).
 */
function sectionAncestorAt(
  masked: string,
  index: number,
  headingMap: Readonly<Record<string, string>>,
): string | null {
  const headingRe = /^##[ \t]+(.+?)[ \t]*$/gm;
  let current: string | null = null;
  for (const m of masked.matchAll(headingRe)) {
    if (m.index === undefined || m.index > index) break;
    const title = m[1]!.trim().toLowerCase();
    current = headingMap[title] ?? null;
  }
  return current;
}

/**
 * Match the validator's order-preserving duplicate rule: the first real
 * section-marker occurrence is canonical and every later occurrence is
 * removed. Marker-shaped examples inside Markdown code remain untouched.
 *
 * When `keySectionMap` is supplied (Workstream A / its topic counterpart),
 * the occurrence kept for a given key is the FIRST one whose ancestor H2
 * section (resolved against `headingMap`) matches that key's assigned
 * section, rather than unconditionally the first occurrence in the
 * document. If no occurrence sits in the assigned section (or the map is
 * omitted), the original "keep first" behavior applies unchanged.
 */
function removeLaterSectionAnchorOccurrences(
  text: string,
  duplicateKeys: ReadonlyArray<string>,
  keySectionMap?: ReadonlyMap<string, string>,
  headingMap: Readonly<Record<string, string>> = FLOW_SECTION_HEADING_MAP,
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

  // Decide, per duplicate key, which match-array index is the keeper: the
  // first occurrence in its assigned section if one exists, else the
  // first occurrence overall (identical to the pre-existing behavior).
  const keeperIndexByKey = new Map<string, number>();
  for (const key of duplicateKeys) {
    const assignedSection = keySectionMap?.get(key);
    let firstOverall = -1;
    let firstInSection = -1;
    for (const [i, match] of matches.entries()) {
      const keys = match[1]!.trim().split(/\s+/).filter(Boolean);
      if (!keys.includes(key)) continue;
      if (firstOverall === -1) firstOverall = i;
      if (
        firstInSection === -1 &&
        assignedSection !== undefined &&
        sectionAncestorAt(masked, match.index!, headingMap) === assignedSection
      ) {
        firstInSection = i;
      }
    }
    keeperIndexByKey.set(key, firstInSection !== -1 ? firstInSection : firstOverall);
  }

  const seen = new Set<string>();
  const replacements: Array<{ start: number; end: number; value: string }> = [];
  for (const [i, match] of matches.entries()) {
    const keys = match[1]!.trim().split(/\s+/).filter(Boolean);
    const kept: string[] = [];
    let changed = false;
    for (const key of keys) {
      if (targetKeys.has(key)) {
        if (seen.has(key) || i !== keeperIndexByKey.get(key)) {
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
