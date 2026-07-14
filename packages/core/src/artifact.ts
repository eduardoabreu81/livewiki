/**
 * artifact — normalization and validation of the stage 4 Markdown artifact.
 *
 * Phase-5 plan (V): stage 4 accepts an artifact, not the raw transcript of the
 * model. This layer:
 *
 *   1. `normalizeStage4Artifact(raw)`:
 *      - Removes ONE complete `<think>...</think>` block at the START of the output.
 *      - Detects an UNCLOSED reasoning block (`<think>` without `</think>`): invalid.
 *      - Detects "reasoning only" (output ends inside a `<think>`
 *        or only has whitespace after `</think>`): invalid.
 *      - Unwraps ONE outer ` ```markdown ` or ` ```md ` fence (with
 *        optional info string).
 *
 *   2. `validateStage4Artifact(artifact, closedKeyList)`:
 *      - Requires valid frontmatter between `---` at the top.
 *      - Requires the `owner:` line EXPLICITLY present AND with value
 *        `"generated"` (no implicit fallback — review finding #9).
 *      - Requires `anchors:` in the frontmatter when the closed list is
 *        non-empty.
 *      - Requires every key in `anchors:` to be in the closed list.
 *      - Requires every key in the markers `<!-- lw:anchors ... -->`
 *        to be in the closed list.
 *      - Completeness is two
 *        INDEPENDENT requirements, not a union — the frontmatter anchors
 *        list ALONE must contain every closed-list key, AND the section
 *        markers ALONE must also contain every closed-list key. A page
 *        with every key only in frontmatter (zero real section markers)
 *        used to pass; it no longer does (`missing_closed_key`, tagged
 *        with the specific location that is short).
 *      - No duplicate keys in the frontmatter list; no key listed in more
 *        than one section marker (`duplicate_anchor`). The same key may
 *        appear once in frontmatter and once in a single section marker.
 *      - Every section with an anchor marker must be followed by
 *        real prose (not blank, not TODO/TBD-only) before the next
 *        heading/marker/end of page (`empty_section`) — presence of an
 *        anchor is not the same thing as the section being documented.
 *      - The body must be fully closed Markdown — every fenced
 *        code block and inline-code span opened must be closed
 *        (`unclosed_markdown`) — the objective, non-size-based signal of
 *        a response truncated mid-token.
 *      - "TODO"/"TBD" placeholders are banned from the body,
 *        except inside a fenced/inline code example or an
 *        `<!-- lw:manual -->` block (`todo_marker_present`).
 *      - Requires non-empty body after the frontmatter.
 *      - Rejects ANY `<!-- lw:manual -->` block in the body (rule #6:
 *        manual blocks are reserved for human content and the orchestrator
 *        reinserts them byte-for-byte from the previous version).
 *
 * Returns a list of `ArtifactValidationError` (structured codes).
 * If empty → valid artifact.
 *
 * Principle: do NOT try to "fix" a bad artifact. If invalid, return
 * the errors to a repair prompt. This matches the acceptance criterion
 * "no think-only response can be accepted" and keeps the repository
 * repo (Phase 2) as the source of truth — we do not loosen the contract.
 */

import { parseFrontmatter, getAnchors, type Frontmatter } from "./frontmatter.js";
import type { ArtifactValidationError, ArtifactValidationCode } from "./prompts.js";
import type { PathRole } from "./modules.js";
import {
  maskCodeSpans,
  maskCodeSpansPreservingLength,
  hasUnclosedMarkdown,
} from "./markdown-mask.js";

export interface NormalizeResult {
  ok: boolean;
  /** Normalized content (empty if rejected). */
  content: string;
  /** Structured errors found during normalization. */
  errors: ArtifactValidationError[];
}

export interface ValidateResult {
  ok: boolean;
  errors: ArtifactValidationError[];
}

/** Optional read-only facts for validation rules that depend on module identity. */
export interface Stage4ValidationContext {
  readonly moduleId: string;
  readonly moduleRole: PathRole;
}

/** Regex for a complete reasoning block: from `<think>` to `</think>`. */
const THINK_BLOCK_RE = /^<think>[\s\S]*?<\/think>/;
/** Regex to detect an open `<think>` at the start. */
const THINK_OPEN_RE = /^<think>/;
/** Regex to detect the LAST `</think>` in any position. */
const THINK_CLOSE_RE = /<\/think>/g;
/** Regex for an outer ` ```markdown ` or ` ```md ` fence (with optional info string). */
const OUTER_FENCE_RE = /^```(?:markdown|md)\s*\n([\s\S]*?)\n```\s*$/;
/** Regex for any opening fence. */
const ANY_FENCE_RE = /^(```)/;
/** Matches a complete `<!-- lw:manual --> ... <!-- /lw:manual -->` block. */
const MANUAL_BLOCK_RE = /<!--\s*lw:manual\s*-->[\s\S]*?<!--\s*\/lw:manual\s*-->/g;

/**
 * Normalizes the raw LLM output into a Markdown artifact.
 * - Strips a complete `<think>…</think>` block at the START.
 * - Rejects unclosed reasoning block or thinking-only.
 * - Unwraps one outer `markdown`/`md` fence.
 * - NEVER tries to "rescue" Markdown embedded inside an incomplete
 *   reasoning block (principle V of the plan).
 */
export function normalizeStage4Artifact(raw: string): NormalizeResult {
  const errors: ArtifactValidationError[] = [];
  // Strips BOM and normalizes line endings (caller also does this, but defensive).
  let s = raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");

  if (s.trim().length === 0) {
    return {
      ok: false,
      content: "",
      errors: [err("empty_after_normalize", "output is empty or whitespace-only", "global")],
    };
  }

  // 1. Strip ONE complete <think>…</think> block at the START.
  const hasOpen = THINK_OPEN_RE.test(s);
  if (hasOpen) {
    const blockMatch = s.match(THINK_BLOCK_RE);
    if (blockMatch && blockMatch.index === 0) {
      // Strip the block + what follows (whitespace).
      s = s.slice(blockMatch[0].length).replace(/^\s*\n/, "");
    } else {
      // `<think>` at the start WITHOUT a matching `</think>` → unclosed reasoning.
      // Checks if a `</think>` exists anywhere — if so, it is just
      // a broken block (does not start with think), not an unclosed one.
      const allCloses = [...s.matchAll(THINK_CLOSE_RE)];
      if (allCloses.length === 0) {
        return {
          ok: false,
          content: "",
          errors: [err("unclosed_reasoning", "<think> without matching </think> — output is incomplete", "global")],
        };
      }
      // A `</think>` exists but it is not a complete block at the start. This is
      // ambiguous: the output is corrupted. We treat it as reasoning-only /
      // malformed.
      return {
        ok: false,
        content: "",
        errors: [err("reasoning_only", "<think>…</think> block is not cleanly delimited at the start of the output", "global")],
      };
    }
  }

  // 2. Detect "reasoning only" — after strip, content is empty.
  if (s.trim().length === 0) {
    return {
      ok: false,
      content: "",
      errors: [err("reasoning_only", "output contained only a reasoning block; no Markdown body", "global")],
    };
  }

  // 3. Unwrap ONE outer `markdown`/`md` fence. Do NOT unwrap `ts`,
  // `tsv`, `python`, etc — those are not the artifact.
  // Only unwrap if the entire content (after trim) is a single fence
  // markdown/md. Otherwise, leave the artifact as-is (it may contain
  // multiple legitimate internal fences).
  const trimmed = s.trim();
  const outerMatch = trimmed.match(OUTER_FENCE_RE);
  if (outerMatch && outerMatch[1] !== undefined) {
    s = outerMatch[1] + "\n";
  } else if (ANY_FENCE_RE.test(trimmed) && !/^---/.test(trimmed)) {
    // Starts with a fence but it is not the expected form (no `markdown`/`md`
    // info string, or has more content than the fence). It is not "the
    // artifact" — probably a snippet. Validation flags it later.
    // We keep it as-is and let the validator complain.
  }

  // 4. Re-check for emptiness.
  if (s.trim().length === 0) {
    return {
      ok: false,
      content: "",
      errors: [err("empty_after_normalize", "artifact is empty after normalization", "global")],
    };
  }

  return { ok: errors.length === 0, content: s, errors };
}

/**
 * Validates the artifact (already normalized) against the module's CLOSED
 * key list. Returns the list of errors. Empty list = valid.
 */
export function validateStage4Artifact(
  artifact: string,
  closedKeyList: ReadonlyArray<string>,
  context?: Readonly<Stage4ValidationContext>,
): ValidateResult {
  const errors: ArtifactValidationError[] = [];
  const closedSet = new Set(closedKeyList);

  if (artifact.trim().length === 0) {
    errors.push(err("empty_after_normalize", "artifact is empty", "global"));
    return { ok: false, errors };
  }

  // 1. Frontmatter
  let fm: Frontmatter | null = null;
  let body = artifact;
  let frontmatterParseError: string | null = null;
  /** Populated inside the `fm !== null` branch below; used for the
   * independent frontmatter-coverage check further down. */
  let fmAnchors: string[] = [];
  try {
    const parsed = parseFrontmatter(artifact);
    fm = parsed.frontmatter;
    body = parsed.body;
  } catch (e) {
    frontmatterParseError = (e as Error).message;
  }

  if (frontmatterParseError) {
    errors.push(err("invalid_frontmatter", `frontmatter present but did not parse: ${frontmatterParseError}`, "frontmatter"));
  } else if (fm === null) {
    errors.push(err("no_frontmatter", "artifact does not start with --- frontmatter", "frontmatter"));
  } else {
    // 2. Owner — review finding #9: the `owner:` line must be
    // EXPLICITLY present in the frontmatter with the literal value
    // "generated". No implicit fallback (the old `getOwner` assumed
    // "generated" if the key was missing — this allowed the LLM
    // forget the line). Now `missing` and `wrong` are distinct errors.
    if (!("owner" in fm)) {
      errors.push(
        err(
          "missing_owner",
          'frontmatter is missing the `owner:` line; stage-4 must declare `owner: generated` explicitly',
          "frontmatter",
        ),
      );
    } else {
      const ownerVal = fm["owner"];
      if (typeof ownerVal !== "string" || ownerVal !== "generated") {
        errors.push(
          err(
            "wrong_owner",
            `owner is "${String(ownerVal)}"; stage-4 must write exactly "owner: generated"`,
            "frontmatter",
            typeof ownerVal === "string" ? ownerVal : undefined,
          ),
        );
      }
    }

    // Presentation validation is intentionally context-gated. Existing callers
    // that cannot provide module identity retain the pre-Lot-N behavior.
    if (context?.moduleRole === "product") {
      const title = fm["title"];
      if (typeof title === "string" && title === context.moduleId) {
        errors.push(
          err(
            "title_equals_module_id",
            `product page title "${title}" exactly equals its stable module ID; use a human responsibility title`,
            "frontmatter",
            title,
          ),
        );
      }
    }

    // 3. Frontmatter anchors
    fmAnchors = getAnchors(fm);
    if (closedKeyList.length > 0 && fmAnchors.length === 0) {
      errors.push(
        err(
          "no_frontmatter",
          "frontmatter `anchors:` is missing or empty — every page must declare its closed keys",
          "frontmatter",
        ),
      );
    }
    // Duplicates within the frontmatter list (order-preserving scan).
    const fmSeen = new Set<string>();
    for (const k of fmAnchors) {
      if (fmSeen.has(k)) {
        errors.push(
          err(
            "duplicate_anchor",
            `anchor "${k}" is listed more than once in frontmatter anchors`,
            "frontmatter",
            k,
          ),
        );
      } else {
        fmSeen.add(k);
      }
      if (!closedSet.has(k)) {
        errors.push(
          err(
            "anchor_outside_closed_list",
            `anchor "${k}" is not in the module's closed key list`,
            "frontmatter",
            k,
          ),
        );
      }
    }
  }

  // 4. Section anchors: <!-- lw:anchors ... -->
  //    We do not use extractAnchors to avoid coupling — own regex.
  //    Markdown code is display text: scan markers and their associated
  //    headings through an offset-stable masked view of the body.
  const markerScanBody = maskCodeSpansPreservingLength(body);
  const sectionRe = /<!--\s*lw:anchors\s+([^\s>][^>]*?)\s*-->/g;
  // simple tracking of the previous heading for section slug
  const headingRe = /^(#{1,6})\s+(.+?)\s*$/gm;
  const headingMatches: Array<{ text: string; slug: string; offset: number }> = [];
  for (const m of markerScanBody.matchAll(headingRe)) {
    if (m.index === undefined || m[2] === undefined) continue;
    headingMatches.push({
      text: m[2],
      slug: slugifyHeading(m[2]),
      offset: m.index,
    });
  }
  // Collected once so it can drive BOTH the duplicate-key scan and the
  // per-section prose check below, without re-running the regex.
  const sectionMatches = [...markerScanBody.matchAll(sectionRe)].filter(
    (m) => m.index !== undefined && m[1] !== undefined,
  );

  // The human opening is structural, not editorially scored. Check only the
  // required block order and cardinalities before the first anchored section.
  const firstSectionMarker = sectionMatches[0];
  const firstAnchoredHeading = firstSectionMarker
    ? lastHeadingBefore(headingMatches, firstSectionMarker.index!)
    : null;
  const openingEnd = firstAnchoredHeading?.offset ?? firstSectionMarker?.index ?? markerScanBody.length;
  if (!hasRequiredPageOpening(markerScanBody.slice(0, openingEnd))) {
    errors.push(
      err(
        "missing_page_opening",
        "required page opening is missing or out of order before the first anchored implementation section",
        "body",
        "H1 → responsibility sentence → When to use this page (2-4 bullets) → How it fits paragraph",
      ),
    );
  }

  /** Keys seen in section markers (for cross-section duplicate detection). */
  const sectionKeysSeen = new Set<string>();
  for (const m of sectionMatches) {
    const preceding = lastHeadingBefore(headingMatches, m.index!);
    const sectionSlug = preceding?.slug;
    const raw = m[1]!.trim();
    const keys = raw.split(/\s+/).filter(Boolean);
    const inMarker = new Set<string>();
    for (const k of keys) {
      if (inMarker.has(k)) {
        errors.push(
          err(
            "duplicate_anchor",
            `section anchor "${k}" is listed more than once in the same marker`,
            "section",
            k,
            sectionSlug,
          ),
        );
      } else {
        inMarker.add(k);
      }
      if (sectionKeysSeen.has(k)) {
        errors.push(
          err(
            "duplicate_anchor",
            `section anchor "${k}" appears in more than one section marker`,
            "section",
            k,
            sectionSlug,
          ),
        );
      } else {
        sectionKeysSeen.add(k);
      }
      if (!closedSet.has(k)) {
        errors.push(
          err(
            "anchor_outside_closed_list",
            `section anchor "${k}" is not in the module's closed key list`,
            "section",
            k,
            sectionSlug,
          ),
        );
      }
    }
  }

  // 4b. Completeness is two
  // INDEPENDENT requirements, not a union. Before this, a page with every
  // key ONLY in frontmatter (zero real section markers) passed — the
  // exact shape of the `tools.md` truncation and the `core-src-03.md`
  // sentinel-leak findings. Frontmatter coverage is only checked when
  // frontmatter itself parsed (fm !== null) — an entirely missing/broken
  // frontmatter is already reported by `no_frontmatter`/`invalid_frontmatter`
  // above, and re-emitting one `missing_closed_key` per key on top of that
  // would just be noise for a problem already named.
  if (closedKeyList.length > 0) {
    if (fm !== null) {
      const fmKeySet = new Set(fmAnchors);
      for (const k of closedKeyList) {
        if (!fmKeySet.has(k)) {
          errors.push(
            err(
              "missing_closed_key",
              `closed-list key "${k}" is not declared in the frontmatter anchors list`,
              "frontmatter",
              k,
            ),
          );
        }
      }
    }
    for (const k of closedKeyList) {
      if (!sectionKeysSeen.has(k)) {
        errors.push(
          err(
            "missing_closed_key",
            `closed-list key "${k}" is not declared in any section marker`,
            "section",
            k,
          ),
        );
      }
    }
  }

  // 4c. Every section that has an anchor marker must be followed
  // by real prose before the next heading/marker/end of body. A marker
  // with nothing (or only a TODO/TBD line) after it means the closed-list
  // key was "declared" but never actually documented — presence of an
  // anchor is not the same thing as complete documentation.
  {
    const breakpoints = [
      ...new Set([
        ...sectionMatches.map((m) => m.index!),
        ...headingMatches.map((h) => h.offset),
        body.length,
      ]),
    ].sort((a, b) => a - b);
    for (const m of sectionMatches) {
      const markerStart = m.index!;
      const markerEnd = markerStart + m[0]!.length;
      const nextBreak = breakpoints.find((bp) => bp > markerStart) ?? body.length;
      const windowText = body.slice(markerEnd, nextBreak);
      if (!hasRealProse(windowText)) {
        const preceding = lastHeadingBefore(headingMatches, markerStart);
        errors.push(
          err(
            "empty_section",
            `section marker at offset ${markerStart} has no real prose before the next heading/marker/end of page`,
            "section",
            undefined,
            preceding?.slug,
          ),
        );
      }
    }
  }

  // 4d. The page must be fully closed Markdown — every fenced
  // code block and every inline-code span opened must be closed. This is
  // the objective, deterministic signal of truncation-mid-token (the
  // `tools.md` finding): a well-formed document has zero backticks
  // surviving the mask and zero fences left open. Not a size/length
  // heuristic — a structural balance check.
  if (hasUnclosedMarkdown(body)) {
    errors.push(
      err(
        "unclosed_markdown",
        "the page ends with an unclosed fenced code block or inline-code span (cut mid-token)",
        "body",
      ),
    );
  }

  // 4e. "TODO"/"TBD" placeholders are banned from prose, except
  // when they appear inside a fenced/inline code example (quoting someone
  // else's TODO comment is not the same as writing your own placeholder)
  // or inside a `<!-- lw:manual -->` block (human content this validator
  // does not otherwise police). `model_invented_manual` below already
  // rejects the artifact outright if the LLM wrote its OWN manual block,
  // so this exclusion mostly matters for reused/shared masking helpers —
  // it is still correct to apply it here defensively.
  {
    const withoutManual = body.replace(
      MANUAL_BLOCK_RE,
      (m) => " ".repeat(m.length),
    );
    const withoutCode = maskCodeSpans(withoutManual);
    if (/\b(TODO|TBD)\b/i.test(withoutCode)) {
      errors.push(
        err(
          "todo_marker_present",
          `the page body contains a "TODO"/"TBD" placeholder outside code — write concrete content about what is visible instead`,
          "body",
        ),
      );
    }
  }

  // 5. Review finding #7a: the LLM MUST NOT invent `<!-- lw:manual -->` blocks.
  // Manual blocks are human content (rule #6) and the orchestrator is the only
  // party responsible for reinserting them byte-for-byte from the previous version
  // of the page. If the LLM output brings one, the artifact is rejected so that
  // the repair prompt fixes it.
  if (/<!--\s*lw:manual\s*-->/.test(body)) {
    errors.push(
      err(
        "model_invented_manual",
        "artifact contains a <!-- lw:manual --> block; these are reserved for human content (rule #6) and the orchestrator is the only one allowed to re-inject them from the previous version of the page",
        "body",
        "<!-- lw:manual -->",
      ),
    );
  }

  // 6. Non-empty body
  if (body.trim().length === 0) {
    errors.push(err("empty_body", "frontmatter is present but the body is empty", "body"));
  }

  return { ok: errors.length === 0, errors };
}

/**
 * True if `text` has at least one line that is neither blank nor a
 * TODO/TBD placeholder. Used to detect a section marker followed by
 * nothing (or nothing but a placeholder) — presence of an anchor marker
 * is not the same thing as the section being actually documented.
 */
function hasRealProse(text: string): boolean {
  return text
    .split("\n")
    .map((l) => l.trim())
    .some((l) => l.length > 0 && !/^(TODO|TBD)\b/i.test(l));
}

/** Structural-only recognizer for the required page opening. */
function hasRequiredPageOpening(text: string): boolean {
  const lines = text.replace(/^\s*\n/, "").split("\n");
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === "") lines.pop();
  if (lines.length === 0 || !/^#\s+\S/.test(lines[0]!.trim())) return false;

  const whenIndex = lines.findIndex((line, index) =>
    index > 0 && /^##\s+When to use this page\s*$/.test(line.trim()),
  );
  if (whenIndex < 0) return false;

  const responsibility = lines.slice(1, whenIndex);
  if (!isSingleProseParagraph(responsibility)) return false;

  const howIndex = lines.findIndex((line, index) =>
    index > whenIndex && /^##\s+How it fits\s*$/.test(line.trim()),
  );
  if (howIndex < 0) return false;

  const taskLines = lines
    .slice(whenIndex + 1, howIndex)
    .map((line) => line.trim())
    .filter(Boolean);
  if (taskLines.length < 2 || taskLines.length > 4) return false;
  if (!taskLines.every((line) => /^[-*+]\s+\p{L}/u.test(line))) return false;

  return isSingleProseParagraph(lines.slice(howIndex + 1));
}

function isSingleProseParagraph(lines: ReadonlyArray<string>): boolean {
  const nonblank = lines.map((line) => line.trim()).filter(Boolean);
  if (nonblank.length === 0) return false;
  if (nonblank.some((line) => /^#{1,6}\s|^[-*+]\s|^<!--\s*lw:/.test(line))) return false;

  let paragraphCount = 0;
  let inParagraph = false;
  for (const line of lines) {
    if (line.trim() === "") {
      inParagraph = false;
    } else if (!inParagraph) {
      paragraphCount += 1;
      inParagraph = true;
    }
  }
  return paragraphCount === 1;
}

function err(
  code: ArtifactValidationCode,
  message: string,
  location: ArtifactValidationError["location"],
  offending?: string,
  sectionSlug?: string,
): ArtifactValidationError {
  return {
    code,
    message,
    location,
    ...(offending !== undefined ? { offending } : {}),
    ...(sectionSlug !== undefined ? { sectionSlug } : {}),
  };
}

function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function lastHeadingBefore(
  headings: ReadonlyArray<{ text: string; slug: string; offset: number }>,
  offset: number,
): { text: string; slug: string; offset: number } | null {
  let last: { text: string; slug: string; offset: number } | null = null;
  for (const h of headings) {
    if (h.offset < offset) last = h;
    else break;
  }
  return last;
}
