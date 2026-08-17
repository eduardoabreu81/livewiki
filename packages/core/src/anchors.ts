/**
 * anchors — extracts anchors and manual blocks from a wiki markdown page.
 *
 * Recognized format (SPEC §"Doc page frontmatter"):
 *
 *   ---
 *   title: Auth — login and session
 *   owner: generated
 *   anchors:
 *     - src/auth/login.ts            # PAGE anchor
 *     - src/auth/login.ts#validateToken
 *   ---
 *
 *   ## Validation flow
 *   <!-- lw:anchors src/auth/login.ts#validateToken src/auth/session.ts#refresh -->
 *   The token is validated by `validateToken(...)`, which ...
 *
 *   ## Manual notes
 *   <!-- lw:manual -->
 *   Block the agent may NEVER rewrite (inviolable rule #6).
 *   <!-- /lw:manual -->
 *
 * Output: page anchors (frontmatter) + section anchors (markers) +
 * manual block ranges (for byte-by-byte verify).
 *
 * `inManualBlock` is derived: an anchor that falls inside a manualBlock is
 * flagged — verify uses it to distinguish "anchor invalid because the code changed"
 * from "anchor in a human-protected zone".
 */

import { parseFrontmatter, getAnchors, getOwner, type Frontmatter } from "./frontmatter.js";
import { maskCodeSpansPreservingLength } from "./markdown-mask.js";

export type Owner = "generated" | "human" | "mixed";

export interface SectionAnchor {
  /** Slug generated from the preceding heading (e.g. "fluxo-de-validacao"). */
  sectionSlug: string;
  /** Heading text (e.g. "Fluxo de validação"). */
  headingText: string;
  /** Symbols anchored by this section. */
  symbolKeys: string[];
  /** Byte offset of the <!-- lw:anchors ... --> in the source. */
  anchorMarkerOffset: number;
  /** Whether the anchor falls inside a <!-- lw:manual -->...<!-- /lw:manual --> block. */
  inManualBlock: boolean;
}

export interface ManualBlock {
  /** Byte offset of the <!-- lw:manual --> (inclusive). */
  start: number;
  /** Byte offset of the <!-- /lw:manual --> (exclusive). */
  end: number;
}

export interface ExtractedAnchors {
  /** Frontmatter anchors (cover the whole page). */
  pageAnchors: string[];
  /** Anchors from `<!-- lw:anchors ... -->` markers in sections. */
  sectionAnchors: SectionAnchor[];
  /** Ranges of the `<!-- lw:manual -->...<!-- /lw:manual -->` blocks. */
  manualBlocks: ManualBlock[];
  /** Parsed frontmatter (null if absent). */
  frontmatter: Frontmatter | null;
  /** Declared owner (default: generated). */
  owner: Owner;
  /** Markdown body (without the frontmatter). */
  body: string;
}

/** Start marker of a section anchor. */
const LW_ANCHORS_RE = /<!--\s*lw:anchors\s+([^\s>][^>]*?)\s*-->/g;
/** Start marker of a manual block. */
const LW_MANUAL_START_RE = /<!--\s*lw:manual\s*-->/g;
/** End marker of a manual block. */
const LW_MANUAL_END_RE = /<!--\s*\/lw:manual\s*-->/g;

export function extractAnchors(source: string): ExtractedAnchors {
  const fm = parseFrontmatter(source);
  const body = fm.body;
  const markerScanBody = maskCodeSpansPreservingLength(body);

  // Comprimento do frontmatter no source original (incluindo --- de fechamento
  // + newline) — usamos pra mapear offsets do body pro source original.
  const bodyStartInOriginal = fm.bodyOffset;

  const sectionAnchors: SectionAnchor[] = [];
  const manualBlocks: ManualBlock[] = [];

  // 1. Collects manual block ranges in the body
  //    Simple state: toggle on start/end. Doesn't support nesting (we don't need it).
  let cursor = 0;
  const events: Array<{ offset: number; kind: "start" | "end" }> = [];
  for (const m of body.matchAll(LW_MANUAL_START_RE)) {
    if (m.index === undefined) continue;
    events.push({ offset: m.index, kind: "start" });
  }
  for (const m of body.matchAll(LW_MANUAL_END_RE)) {
    if (m.index === undefined) continue;
    events.push({ offset: m.index, kind: "end" });
  }
  events.sort((a, b) => a.offset - b.offset);

  let openAt: number | null = null;
  for (const ev of events) {
    if (ev.kind === "start") {
      if (openAt !== null) {
        // nested start without end — silently ignored (we don't raise an error;
        // verify later flags it as "malformed manual block" if it's serious)
        continue;
      }
      openAt = ev.offset;
    } else {
      if (openAt === null) continue;
      manualBlocks.push({ start: openAt, end: ev.offset });
      openAt = null;
    }
  }

  // 2. Finds lw:anchors markers and associates them with the preceding heading
  let lastHeading: { text: string; slug: string; offset: number } | null = null;
  // Regex for markdown headings (## or ### — Phase 2 only needs the 2 levels)
  const headingRe = /^(#{1,6})\s+(.+?)\s*$/gm;

  // Walks the body in order, identifying interleaved headings and anchors.
  // For simplicity, scan twice: headings first, then anchors.
  const headingMatches: Array<{ text: string; slug: string; offset: number }> = [];
  for (const m of markerScanBody.matchAll(headingRe)) {
    if (m.index === undefined) continue;
    headingMatches.push({
      text: m[2] ?? "",
      slug: slugify(m[2] ?? ""),
      offset: m.index,
    });
  }

  for (const m of markerScanBody.matchAll(LW_ANCHORS_RE)) {
    if (m.index === undefined || m[1] === undefined) continue;
    const anchorOffset = m.index;
    const anchorEnd = m.index + m[0].length;

    // Preceding heading: the last heading with offset < anchorOffset
    let preceding: { text: string; slug: string; offset: number } | null = null;
    for (const h of headingMatches) {
      if (h.offset < anchorOffset) preceding = h;
      else break;
    }
    if (!preceding) {
      // anchor with no preceding heading — skipped (malformed page)
      continue;
    }

    const symbolKeys = m[1].trim().split(/\s+/).filter(Boolean);
    sectionAnchors.push({
      sectionSlug: preceding.slug,
      headingText: preceding.text,
      symbolKeys,
      anchorMarkerOffset: anchorOffset + bodyStartInOriginal,
      inManualBlock: isInsideAny(anchorOffset, anchorEnd, manualBlocks),
    });
  }

  return {
    pageAnchors: getAnchors(fm.frontmatter),
    sectionAnchors,
    manualBlocks: manualBlocks.map((b) => ({
      start: b.start + bodyStartInOriginal,
      end: b.end + bodyStartInOriginal,
    })),
    frontmatter: fm.frontmatter,
    owner: getOwner(fm.frontmatter),
    body,
  };
}

/**
 * Heading slug: lowercase, strips non-alphanumerics (keeps accents for PT),
 * hyphens between words. "Fluxo de validação" → "fluxo-de-validacao".
 */
export function slugify(heading: string): string {
  return heading
    .toLowerCase()
    .normalize("NFD") // separates diacritics
    .replace(/[\u0300-\u036f]/g, "") // strips diacritics
    .replace(/[^\w\s-]/g, "") // strips punctuation
    .trim()
    .replace(/\s+/g, "-");
}

function isInsideAny(start: number, end: number, blocks: ManualBlock[]): boolean {
  return blocks.some((b) => start >= b.start && end <= b.end);
}
