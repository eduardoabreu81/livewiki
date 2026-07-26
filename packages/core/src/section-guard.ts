/**
 * section-guard — deterministic H2-section machinery for the surgical
 * repair path (recovery tier, Component 1).
 *
 * A surgical repair call asks the model to fix ONLY a named set of H2
 * sections and return the rest of the page byte-for-byte identical. This
 * module provides the two pure helpers the orchestrator needs around that
 * call:
 *
 *   - `splitH2Sections(page)` — splits a Markdown page into its prefix
 *     (frontmatter + opening, everything before the first H2) and its H2
 *     sections, using the same heading-scan idiom as the artifact
 *     validator (`artifact.ts`): headings are located on the
 *     length-preserving masked view (`maskCodeSpansPreservingLength`), so
 *     a `##` line inside a fenced code block can never fake a section
 *     boundary, and every offset maps byte-for-byte to the original text
 *     (CRLF included).
 *   - `spliceSections(original, repaired, targetSections)` — the
 *     anti-cascade guard. Returns `original` with ONLY the target sections
 *     replaced by their `repaired` counterparts, or null when `repaired`
 *     does not preserve the non-target surface byte-for-byte (prefix
 *     changed, a non-target section changed, sections added/removed/
 *     reordered, or a target section absent on either side).
 *
 * It also owns `surgicalRepairTargetSections`, the eligibility rule that
 * decides whether a validation-error set may use the surgical prompt at
 * all: every error must carry a prose-level code AND a resolvable section
 * (its `sectionSlug`, or — for the section-level `missing_page_opening`
 * shape — the section named in the message, see FLOW_FIXES in
 * `repair-contract.ts`). Anything else falls back to the existing
 * full-context repair path, unchanged.
 */

import { maskCodeSpansPreservingLength } from "./markdown-mask.js";
import type { ArtifactValidationError } from "./prompts.js";

/** One H2 section of a page: slug, raw heading text, and [start, end) offsets. */
export interface H2Section {
  /** Slugified heading text (same slug rule the artifact validator uses). */
  readonly slug: string;
  /** Raw heading text without the leading `##`. */
  readonly heading: string;
  /** Offset of the heading line start in the original page. */
  readonly start: number;
  /** Offset where the section ends: the next H2's start, or end of page. */
  readonly end: number;
}

export interface H2Split {
  /** Everything before the first H2 (frontmatter + page opening). */
  readonly prefix: string;
  /** H2 sections in document order. H3+ headings stay inside their parent H2. */
  readonly sections: H2Section[];
}

/**
 * Slugify a heading the same way the artifact validator does. This MUST
 * stay in sync with the private `slugifyHeading` in `artifact.ts` — the
 * `sectionSlug` carried by validation errors is produced by that copy.
 */
export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

/** Heading scan idiom shared with `artifact.ts` (level + text per line). */
const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/gm;

/**
 * Split `page` into its prefix and H2 sections. A section runs from its H2
 * heading line up to (not including) the next H2 heading — H3+ subsections
 * stay inside their parent H2. Offsets come from the length-preserving
 * masked view, so they are exact byte offsets into `page` on both LF and
 * CRLF input, and fenced code containing `##` lines is invisible to the
 * scan.
 */
export function splitH2Sections(page: string): H2Split {
  const masked = maskCodeSpansPreservingLength(page);
  const headings: Array<{ level: number; text: string; offset: number }> = [];
  for (const m of masked.matchAll(HEADING_RE)) {
    headings.push({
      level: m[1]!.length,
      text: m[2]!,
      offset: m.index!,
    });
  }
  const firstH2 = headings.findIndex((h) => h.level === 2);
  if (firstH2 === -1) return { prefix: page, sections: [] };
  const sections: H2Section[] = [];
  for (let i = firstH2; i < headings.length; i++) {
    const h = headings[i]!;
    if (h.level !== 2) continue;
    // The next H2 closes this section; deeper levels stay inside.
    let end = page.length;
    for (let j = i + 1; j < headings.length; j++) {
      if (headings[j]!.level === 2) {
        end = headings[j]!.offset;
        break;
      }
    }
    sections.push({
      slug: slugifyHeading(h.text),
      heading: h.text,
      start: h.offset,
      end,
    });
  }
  return { prefix: page.slice(0, headings[firstH2]!.offset), sections };
}

/**
 * Anti-cascade guard for surgical repair. Returns `original` with ONLY the
 * `targetSections` (by slug) replaced by their counterparts from
 * `repaired`, or null when the splice is not provably safe:
 *
 *   - the prefix (frontmatter + opening) differs;
 *   - the section sequence differs (a section was added, removed,
 *     reordered, or renamed);
 *   - a non-target section differs byte-for-byte (the model cascaded);
 *   - a target slug is absent or ambiguous (duplicate slug) on either side.
 *
 * The replacement uses the offset-descending splice idiom from
 * `artifact-repair.ts`, so earlier offsets stay valid while later ones are
 * rewritten.
 */
export function spliceSections(
  original: string,
  repaired: string,
  targetSections: readonly string[],
): string | null {
  if (targetSections.length === 0) return null;
  const o = splitH2Sections(original);
  const r = splitH2Sections(repaired);
  if (o.prefix !== r.prefix) return null;
  if (o.sections.length !== r.sections.length) return null;
  for (let i = 0; i < o.sections.length; i++) {
    if (o.sections[i]!.slug !== r.sections[i]!.slug) return null;
  }
  const targets = [...new Set(targetSections)];
  for (const slug of targets) {
    if (o.sections.filter((s) => s.slug === slug).length !== 1) return null;
    if (r.sections.filter((s) => s.slug === slug).length !== 1) return null;
  }
  const targetSet = new Set(targets);
  const replacements: Array<{ start: number; end: number; text: string }> = [];
  for (let i = 0; i < o.sections.length; i++) {
    const oSection = o.sections[i]!;
    const rSection = r.sections[i]!;
    const oText = original.slice(oSection.start, oSection.end);
    if (targetSet.has(oSection.slug)) {
      replacements.push({
        start: oSection.start,
        end: oSection.end,
        text: repaired.slice(rSection.start, rSection.end),
      });
    } else if (oText !== repaired.slice(rSection.start, rSection.end)) {
      // Cascade: a section the model was told to keep changed.
      return null;
    }
  }
  let merged = original;
  for (const rep of [...replacements].sort((a, b) => b.start - a.start)) {
    merged = merged.slice(0, rep.start) + rep.text + merged.slice(rep.end);
  }
  return merged;
}

/**
 * Prose-level codes a surgical (section-scoped) repair call can fix. Any
 * other code in the error set — structural, anchor-completeness, or
 * unclassified — sends the attempt to the existing full-context repair
 * path.
 */
export const SURGICAL_REPAIR_ELIGIBLE_CODES: ReadonlySet<string> = new Set([
  "missing_page_opening",
  "todo_marker_present",
  "empty_section",
  "broken_internal_link",
  "anchor_missing_in_required_section",
]);

/**
 * Section-level `missing_page_opening` messages name the failing H2 in
 * quotes. Two shapes exist in the validators:
 *
 *   - module/flow: `page opening "Purpose" must contain one or more prose
 *     paragraphs` (also the module "When to use this page"/"How it fits"
 *     opening-content failures);
 *   - topic: `topic section "Change map" must contain grounded prose,
 *     bullets, or links`.
 *
 * Page-structure messages (`required page opening H1 is missing`) match
 * neither and stay ineligible.
 */
const SECTION_LEVEL_OPENING_RE = /(?:page opening|topic section) "([^"]+)" must contain/;

/**
 * Eligibility rule for the surgical repair path. Returns the deduplicated
 * target section slugs (first-seen order) when EVERY error in the set:
 *
 *   1. carries a code in `SURGICAL_REPAIR_ELIGIBLE_CODES`, AND
 *   2. resolves to a concrete section — its `sectionSlug`, or, for a
 *      section-level `missing_page_opening` (location "body"), the section
 *      named in the message.
 *
 * Returns null otherwise (including an empty error set): the caller takes
 * the existing full-context repair path, byte-identical to today.
 */
export function surgicalRepairTargetSections(
  errors: ReadonlyArray<ArtifactValidationError>,
): string[] | null {
  if (errors.length === 0) return null;
  const targets: string[] = [];
  for (const error of errors) {
    if (!SURGICAL_REPAIR_ELIGIBLE_CODES.has(error.code)) return null;
    let slug = error.sectionSlug;
    if (
      slug === undefined &&
      error.code === "missing_page_opening" &&
      error.location === "body"
    ) {
      const named = SECTION_LEVEL_OPENING_RE.exec(error.message);
      if (named?.[1] !== undefined) slug = slugifyHeading(named[1]);
    }
    if (slug === undefined || slug === "") return null;
    if (!targets.includes(slug)) targets.push(slug);
  }
  return targets;
}
