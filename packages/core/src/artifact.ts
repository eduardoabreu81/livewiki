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
 *      - Requires `anchors:` in the frontmatter.
 *      - Requires every key in `anchors:` to be in the closed list.
 *      - Requires every key in the markers `<!-- lw:anchors ... -->`
 *        to be in the closed list.
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

    // 3. Frontmatter anchors
    const fmAnchors = getAnchors(fm);
    if (fmAnchors.length === 0) {
      errors.push(
        err(
          "no_frontmatter",
          "frontmatter `anchors:` is missing or empty — every page must declare its closed keys",
          "frontmatter",
        ),
      );
    }
    for (const k of fmAnchors) {
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
  const sectionRe = /<!--\s*lw:anchors\s+([^\s>][^>]*?)\s*-->/g;
  // simple tracking of the previous heading for section slug
  const headingRe = /^(#{1,6})\s+(.+?)\s*$/gm;
  const headingMatches: Array<{ text: string; slug: string; offset: number }> = [];
  for (const m of body.matchAll(headingRe)) {
    if (m.index === undefined || m[2] === undefined) continue;
    headingMatches.push({
      text: m[2],
      slug: slugifyHeading(m[2]),
      offset: m.index,
    });
  }
  for (const m of body.matchAll(sectionRe)) {
    if (m.index === undefined || m[1] === undefined) continue;
    const preceding = lastHeadingBefore(headingMatches, m.index);
    const sectionSlug = preceding?.slug;
    const raw = m[1].trim();
    const keys = raw.split(/\s+/).filter(Boolean);
    for (const k of keys) {
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
