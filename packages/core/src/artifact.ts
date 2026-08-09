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
 *        with the specific location that is short). Flow pages relax this
 *        to a consistency rule: the closed list is an upper bound, not an
 *        assignment (the page cites only the keys it uses); a key used on
 *        exactly one side is still `missing_closed_key`.
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
 *        `<!-- lw:manual -->` block (`todo_marker_present`). The ban
 *        covers only the model's own placeholder forms (directive
 *        `TODO:`/`TBD:`, standalone marker lines, any `TBD`) —
 *        legitimate prose about the source's TODO items passes.
 *      - Requires non-empty body after the frontmatter.
 *      - Rejects ANY `<!-- lw:manual -->` block in the body (rule #6:
 *        manual blocks are reserved for human content and the orchestrator
 *        reinserts them byte-for-byte from the previous version).
 *
 *   `context.pageKind === "flow"` (stage 5) shares every check above but
 *   replaces the module opening contract with the flow contract (Purpose,
 *   Ordered flow, Diagram, Invariants, Failure and recovery, Related pages)
 *   and requires `modules:` in the frontmatter.
 *
 *   Flow pages additionally bind each `lw:anchors` marker to its ancestor
 *   H2 (R10.1 item D): a marker whose nearest preceding H2 is not Purpose /
 *   Ordered flow / Failure and recovery is `anchor_in_disallowed_section`
 *   (H3–H6 descendants of an allowed H2 count as inside it), each of the
 *   three allowed sections must carry at least one marker
 *   (`anchor_missing_in_required_section`), and when the context supplies
 *   `flowKeyGroups` every non-empty entry/boundary/sink group must be
 *   covered by at least one dual-cited key (`anchor_missing_required_tier`).
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
import type {
  ArtifactValidationError,
  ArtifactValidationCode,
  FlowKeyGroups,
} from "./prompts.js";
import type { TopicKeyGroups } from "./topics.js";
import type { PathRole } from "./modules.js";
import {
  maskCodeSpansPreservingLength,
  hasUnclosedMarkdown,
  unclosedMarkdownDiagnostic,
} from "./markdown-mask.js";
import { moduleDiagramPlaceholder } from "./diagrams.js";

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

/** Page kind selecting the opening contract applied by the validator. */
export type ArtifactPageKind = "module" | "flow" | "topic";

/** Optional read-only facts for validation rules that depend on module identity. */
export interface Stage4ValidationContext {
  readonly moduleId: string;
  readonly moduleRole: PathRole;
  /**
   * Page kind — `"flow"` applies the stage-5 flow opening contract and the
   * `modules:` frontmatter requirement; omitted means `"module"` (stage-4
   * behavior, unchanged).
   */
  readonly pageKind?: ArtifactPageKind;
  /** Exact diagram placeholder required in the flow `## Diagram` section. */
  readonly expectedFlowDiagram?: string;
  /**
   * Roadmap item 22 (D2 hard contract): exact diagram placeholder required
   * in the module page's `## Diagram` section when `moduleDiagrams` is on
   * (e.g. `livewiki/diagrams/<slug>.mmd`). Module pages only; absent keeps
   * the pre-#22 contract. Like the flow placeholder, it NEVER relaxes
   * under the relaxed completion round.
   */
  readonly expectedModuleDiagram?: string;
  /** Exact participating module set required in flow frontmatter `modules:` (order-insensitive). */
  readonly expectedFlowModules?: readonly string[];
  /**
   * Optional semantic key groups of the flow candidate (R10.1 item D3).
   * Flow pages only: each non-empty group must be covered by ≥1 dual-cited
   * key; group keys outside the closed list are treated as absent.
   */
  readonly flowKeyGroups?: FlowKeyGroups;
  /** Accepted topic identity and closed evidence, persisted by topic-plan. */
  readonly expectedTopicTitle?: string;
  readonly expectedTopicOrder?: number;
  readonly expectedTopicIntent?: string;
  readonly expectedTopicModules?: readonly string[];
  readonly expectedTopicFlows?: readonly string[];
  readonly topicKeyGroups?: TopicKeyGroups;
  readonly topicProductKeys?: readonly string[];
  /**
   * Recovery tier (Component 2): relaxed presentation contract for the ONE
   * final completion attempt after the strict loop exhausted. Only
   * prose-vs-bullet shape and the required-section set relax — frontmatter
   * identity/exactness, anchors, closed-list completeness, the diagram
   * placeholder, marker placement, the TODO ban, `empty_section`, tier
   * coverage, and all of `verify.ts` NEVER relax.
   */
  readonly relaxed?: boolean;
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
 * Flow sections allowed to carry `lw:anchors` markers (R10.1 item D), in
 * contract order. Section membership is defined by the ancestor-H2
 * interval: a marker binds to the nearest preceding H2, H3–H6 headings
 * descending from an allowed H2 count as inside it, and the next H2
 * closes the interval.
 */
const FLOW_ANCHOR_SECTIONS = [
  { name: "Purpose", normalized: "purpose" },
  { name: "Ordered flow", normalized: "ordered flow" },
  { name: "Failure and recovery", normalized: "failure and recovery" },
] as const;
const FLOW_ANCHOR_SECTION_NORMALIZED: ReadonlySet<string> = new Set(
  FLOW_ANCHOR_SECTIONS.map((s) => s.normalized),
);
const TOPIC_ANCHOR_SECTIONS = [
  { name: "Purpose", normalized: "purpose" },
  { name: "When to use this page", normalized: "when to use this page" },
  { name: "Behavioral contract", normalized: "behavioral contract" },
  { name: "Failure and recovery", normalized: "failure and recovery" },
  { name: "Change map", normalized: "change map" },
] as const;
const TOPIC_ANCHOR_SECTION_NORMALIZED: ReadonlySet<string> = new Set(
  TOPIC_ANCHOR_SECTIONS.map((section) => section.normalized),
);

/**
 * Recovery tier (Component 2): stable prefix of the reader-visible notice
 * inserted as the FIRST body line of a page completed under the relaxed
 * contract. Defined once so the relaxed writer (batch.ts) and the relaxed
 * opening checks (which skip lines carrying EXACTLY this prefix —
 * deterministic, no prose guessing) can never drift apart. The full notice
 * is parametrized per page (`buildDegradedNotice`); the round-5 legacy
 * notice was this prefix followed by a fixed sentence, so prefix matching
 * also recognizes degraded pages written before the parametrization.
 */
export const DEGRADED_NOTICE_PREFIX = "> **Degraded page** —";

/**
 * Reader-visible degraded notice for ONE page, parametrized by the page
 * title (A/B round-5 re-eval fix (a): the previous verbatim constant formed
 * a duplicate-paragraph group across degraded pages).
 */
export function buildDegradedNotice(title: string): string {
  return `${DEGRADED_NOTICE_PREFIX} "${title}" was generated under the relaxed contract after strict attempts failed; anchors verified, presentation reduced.`;
}

/** Drop lines whose trimmed content carries the known degraded-notice prefix. */
function dropDegradedNoticeLines(text: string): string {
  return text
    .split("\n")
    .filter((line) => !line.trim().startsWith(DEGRADED_NOTICE_PREFIX))
    .join("\n");
}

/**
 * Title for the degraded notice: the page's first H1, else the frontmatter
 * `title:` value, else a neutral fallback. Pure line scan — deterministic,
 * no Markdown parsing.
 */
function extractDegradedTitle(yamlBlock: string, body: string): string {
  for (const line of body.split("\n")) {
    const h1 = /^#\s+(.+?)\s*$/.exec(line);
    if (h1 !== null) return h1[1]!;
  }
  const fmTitle = /^[ \t]*title:[ \t]*(.+?)\s*$/m.exec(yamlBlock);
  if (fmTitle !== null) return fmTitle[1]!;
  return "This page";
}

/**
 * Recovery tier (Component 2): mark an artifact as degraded — the
 * frontmatter gains the additive `quality: degraded` line (the validator
 * never rejects unknown keys) and the per-page degraded notice
 * (`buildDegradedNotice`) becomes the first body line. Applied by the
 * relaxed writer BEFORE validation, so the artifact that validation (and
 * verify) sees is byte-for-byte the artifact written to disk. Idempotent:
 * an already-marked page is returned unchanged apart from notice
 * deduplication. A page without a frontmatter block is returned unchanged —
 * validation rejects it as `no_frontmatter` regardless.
 */
export function markDegradedArtifact(content: string): string {
  if (!content.startsWith("---\n")) return content;
  const closeIdx = content.indexOf("\n---", 4);
  if (closeIdx === -1) return content;
  const fmEnd = closeIdx + "\n---".length;
  const yamlBlock = content.slice(4, closeIdx);
  const frontmatter = /^[ \t]*quality:/m.test(yamlBlock)
    ? content.slice(0, fmEnd)
    : `${content.slice(0, closeIdx)}\nquality: degraded\n---`;
  const body = dropDegradedNoticeLines(content.slice(fmEnd)).replace(/^\n+/, "");
  return `${frontmatter}\n\n${buildDegradedNotice(extractDegradedTitle(yamlBlock, body))}\n\n${body}`;
}

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
  const pageKind: ArtifactPageKind = context?.pageKind ?? "module";

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

  // Recovery tier (Component 2): the relaxed writer inserts the degraded notice
  // as the first body line before validation. The relaxed contract tolerates
  // lines with the DEGRADED_NOTICE_PREFIX prefix — strip them up front so every opening check sees
  // the page as if the notice were absent (offsets stay internally
  // consistent because every downstream scan derives from this `body`).
  // Strict validation never strips: there the notice is ordinary content.
  if (context?.relaxed === true) {
    body = dropDegradedNoticeLines(body);
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
    // Flow pages have no module identity, so the title rule is module-only.
    if (context?.moduleRole === "product" && pageKind === "module") {
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

    // Flow pages declare their participating modules in the frontmatter.
    if (pageKind === "flow") {
      const modulesValue = fm["modules"];
      if (!Array.isArray(modulesValue)) {
        errors.push(
          err(
            "invalid_frontmatter",
            "flow frontmatter must contain `modules:` as a non-empty string list of participating module IDs",
            "frontmatter",
            typeof modulesValue === "string" ? modulesValue : undefined,
          ),
        );
      } else if (modulesValue.length === 0) {
        errors.push(
          err(
            "invalid_frontmatter",
            "flow frontmatter `modules:` must list at least one participating module ID",
            "frontmatter",
          ),
        );
      } else if (context?.expectedFlowModules !== undefined) {
        const expected = new Set(context.expectedFlowModules);
        const actual = new Set(modulesValue);
        const equal =
          actual.size === expected.size && [...actual].every((m) => expected.has(m));
        if (!equal) {
          errors.push(
            err(
              "invalid_frontmatter",
              `flow frontmatter \`modules:\` (${modulesValue.join(", ")}) must equal the candidate module set (${context.expectedFlowModules.join(", ")})`,
              "frontmatter",
              modulesValue.join(", "),
            ),
          );
        }
      }
    }

    if (pageKind === "topic") {
      const kind = fm["kind"];
      const title = fm["title"];
      const intent = fm["intent"];
      const order = fm["order"];
      const modules = fm["modules"];
      const flows = fm["flows"];
      if (kind !== "topic") {
        errors.push(err("topic_frontmatter_mismatch", "topic frontmatter must declare `kind: topic`", "frontmatter", typeof kind === "string" ? kind : undefined));
      }
      if (context?.expectedTopicTitle !== undefined && title !== context.expectedTopicTitle) {
        errors.push(err("topic_frontmatter_mismatch", `topic title must equal the accepted plan title "${context.expectedTopicTitle}"`, "frontmatter", typeof title === "string" ? title : undefined));
      }
      if (context?.expectedTopicIntent !== undefined && intent !== context.expectedTopicIntent) {
        errors.push(err("topic_frontmatter_mismatch", `topic intent must equal the accepted plan intent "${context.expectedTopicIntent}"`, "frontmatter", typeof intent === "string" ? intent : undefined));
      }
      if (context?.expectedTopicOrder !== undefined && order !== String(context.expectedTopicOrder)) {
        errors.push(err("topic_frontmatter_mismatch", `topic order must equal the accepted plan order ${context.expectedTopicOrder}`, "frontmatter", typeof order === "string" ? order : undefined));
      }
      validateExactTopicList("modules", modules, context?.expectedTopicModules, errors);
      validateExactTopicList("flows", flows, context?.expectedTopicFlows ?? [], errors);
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
  const headingMatches: Array<{ text: string; slug: string; offset: number; level: number }> = [];
  for (const m of markerScanBody.matchAll(headingRe)) {
    if (m.index === undefined || m[2] === undefined) continue;
    headingMatches.push({
      text: m[2],
      slug: slugifyHeading(m[2]),
      offset: m.index,
      level: m[1]!.length,
    });
  }
  // R10.1 item D: flow marker placement binds to the ancestor H2 — the
  // nearest preceding H2; H3–H6 descendants never close the interval.
  const h2Matches = headingMatches.filter((h) => h.level === 2);
  // Collected once so it can drive BOTH the duplicate-key scan and the
  // per-section prose check below, without re-running the regex.
  const sectionMatches = [...markerScanBody.matchAll(sectionRe)].filter(
    (m) => m.index !== undefined && m[1] !== undefined,
  );

  // The human opening is structural, not editorially scored. Check only the
  // required block order and cardinalities before the first anchored section.
  // Flow pages use the stage-5 flow contract over the whole body instead —
  // their lw:anchors markers live inside the contract sections themselves.
  const firstSectionMarker = sectionMatches[0];
  const firstAnchoredHeading = firstSectionMarker
    ? lastHeadingBefore(headingMatches, firstSectionMarker.index!)
    : null;
  const openingEnd = firstAnchoredHeading?.offset ?? firstSectionMarker?.index ?? markerScanBody.length;
  const relaxed = context?.relaxed === true;
  const openingFailure =
    pageKind === "flow"
      ? checkRequiredFlowOpening(markerScanBody, body, context?.expectedFlowDiagram, relaxed)
      : pageKind === "topic"
        ? checkRequiredTopicOpening(markerScanBody, context?.expectedTopicTitle, relaxed)
        : checkRequiredPageOpening(markerScanBody.slice(0, openingEnd), relaxed);
  if (openingFailure !== null) {
    errors.push(
      err(
        "missing_page_opening",
        openingFailure.message,
        "body",
        openingFailure.offending,
      ),
    );
  }

  // Roadmap item 22 (D2 hard contract): when the caller supplies
  // `expectedModuleDiagram` (config `moduleDiagrams`), the module page must
  // carry a `## Diagram` H2 whose mermaid fence holds EXACTLY the expected
  // placeholder line. Strict under the relaxed round — the placeholder is
  // one of the contracts that NEVER relax.
  if (pageKind === "module" && context?.expectedModuleDiagram !== undefined) {
    const moduleDiagramFailure = checkModuleDiagramPlaceholder(
      markerScanBody,
      body,
      context.expectedModuleDiagram,
    );
    if (moduleDiagramFailure !== null) {
      errors.push(
        err(
          "module_diagram_placeholder",
          moduleDiagramFailure.message,
          "body",
          moduleDiagramFailure.offending,
        ),
      );
    }
  }

  /** Keys seen in section markers (for cross-section duplicate detection). */
  const sectionKeysSeen = new Set<string>();
  /** Required flow sections carrying ≥1 marker (R10.1 D2), by normalized H2 text. */
  const coveredFlowSections = new Set<string>();
  /** Required topic sections carrying ≥1 marker, by normalized H2 text. */
  const coveredTopicSections = new Set<string>();
  for (const m of sectionMatches) {
    const preceding = lastHeadingBefore(headingMatches, m.index!);
    const sectionSlug = preceding?.slug;
    // R10.1 item D1 — flow pages: the marker binds to its ancestor H2 (the
    // nearest preceding H2; H3–H6 descendants do not close the interval).
    // A marker outside the three anchor-carrying sections is rejected.
    if (pageKind === "flow") {
      const ancestorH2 = lastHeadingBefore(h2Matches, m.index!);
      const ancestorSection = ancestorH2?.text.trim().toLocaleLowerCase("en-US") ?? null;
      if (ancestorSection !== null && FLOW_ANCHOR_SECTION_NORMALIZED.has(ancestorSection)) {
        coveredFlowSections.add(ancestorSection);
      } else {
        errors.push(
          err(
            "anchor_in_disallowed_section",
            ancestorH2 === null
              ? `lw:anchors marker appears before the first H2 heading; flow pages allow anchor markers only inside "Purpose", "Ordered flow", and "Failure and recovery"`
              : `lw:anchors marker is inside section "${ancestorH2.text.trim()}"; flow pages allow anchor markers only inside "Purpose", "Ordered flow", and "Failure and recovery" (H3+ subsections of those sections count)`,
            "section",
            m[0]!,
            ancestorH2?.slug,
          ),
        );
      }
    }
    if (pageKind === "topic") {
      const ancestorH2 = lastHeadingBefore(h2Matches, m.index!);
      const ancestorSection = ancestorH2?.text.trim().toLocaleLowerCase("en-US") ?? null;
      if (ancestorSection !== null && TOPIC_ANCHOR_SECTION_NORMALIZED.has(ancestorSection)) {
        coveredTopicSections.add(ancestorSection);
      } else {
        errors.push(
          err(
            "anchor_in_disallowed_section",
            ancestorH2 === null
              ? "lw:anchors marker appears before the first H2; topic markers belong only in Purpose, When to use this page, Behavioral contract, Failure and recovery, or Change map"
              : `lw:anchors marker is inside topic section "${ancestorH2.text.trim()}"; allowed sections are Purpose, When to use this page, Behavioral contract, Failure and recovery, and Change map`,
            "section",
            m[0]!,
            ancestorH2?.slug,
          ),
        );
      }
    }
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

  // R10.1 item D2 — flow pages: each required section must carry ≥1 marker
  // anywhere in its ancestor-H2 interval (H3–H6 descendants count). Marker
  // presence in all three sections is mandatory for stage-5 artifacts;
  // module pages are not affected.
  if (pageKind === "flow") {
    // Relaxed contract: Failure and recovery is optional, so its marker
    // presence is not required either. Marker PLACEMENT (the allowed-
    // section rule above) and tier coverage stay strict.
    const requiredFlowMarkerSections = context?.relaxed === true
      ? FLOW_ANCHOR_SECTIONS.filter((section) => section.normalized !== "failure and recovery")
      : FLOW_ANCHOR_SECTIONS;
    for (const section of requiredFlowMarkerSections) {
      if (!coveredFlowSections.has(section.normalized)) {
        errors.push(
          err(
            "anchor_missing_in_required_section",
            `required flow section "${section.name}" carries no lw:anchors marker — each of "Purpose", "Ordered flow", and "Failure and recovery" must contain at least one marker (H3+ subsections count; a key may not repeat across markers, so each section needs its own key)`,
            "section",
            section.name,
            slugifyHeading(section.name),
          ),
        );
      }
    }

    // R10.1 item D3 — semantic-group coverage. Groups are subsets of the
    // closed list (keys outside it are treated as absent); a group is
    // covered only when ≥1 of its keys is dual-cited (frontmatter anchors
    // list AND one section marker). Absent or empty groups are never required.
    const groups = context?.flowKeyGroups;
    if (groups !== undefined) {
      const fmKeySet = new Set(fmAnchors);
      const tierGroups: Array<[string, readonly string[] | undefined]> = [
        ["entry", groups.entryKeys],
        ["boundary", groups.boundaryKeys],
        ["sink", groups.sinkKeys],
      ];
      for (const [label, keys] of tierGroups) {
        if (keys === undefined) continue;
        const valid = keys.filter((k) => closedSet.has(k));
        if (valid.length === 0) continue;
        const covered = valid.some((k) => fmKeySet.has(k) && sectionKeysSeen.has(k));
        if (!covered) {
          errors.push(
            err(
              "anchor_missing_required_tier",
              `the page cites no key from the "${label}" group — cite at least one of its closed-list keys (${valid.join(", ")}) in the section that documents it (frontmatter anchors list AND one section marker, the dual citation rule)`,
              "section",
              label,
            ),
          );
        }
      }
    }
  }

  if (pageKind === "topic") {
    // Relaxed contract: only the still-required sections (Purpose,
    // Behavioral contract) must carry markers.
    const requiredTopicMarkerSections = context?.relaxed === true
      ? TOPIC_ANCHOR_SECTIONS.filter(
          (section) => section.normalized === "purpose" || section.normalized === "behavioral contract",
        )
      : TOPIC_ANCHOR_SECTIONS;
    for (const section of requiredTopicMarkerSections) {
      if (!coveredTopicSections.has(section.normalized)) {
        errors.push(
          err(
            "anchor_missing_in_required_section",
            `required topic section "${section.name}" carries no lw:anchors marker`,
            "section",
            section.name,
            slugifyHeading(section.name),
          ),
        );
      }
    }
    const fmKeySet = new Set(fmAnchors);
    const groups = context?.topicKeyGroups;
    if (groups !== undefined) {
      for (const name of ["contract", "state", "output", "failure"] as const) {
        const valid = groups[name].filter((key) => closedSet.has(key));
        if (valid.length > 0 && !valid.some((key) => fmKeySet.has(key) && sectionKeysSeen.has(key))) {
          errors.push(
            err(
              "anchor_missing_required_tier",
              `the topic cites no key from the "${name}" evidence group (${valid.join(", ")})`,
              "section",
              name,
            ),
          );
        }
      }
    }
    if (fmAnchors.length > 0 && context?.topicProductKeys !== undefined) {
      const productKeys = new Set(context.topicProductKeys);
      const productCount = fmAnchors.filter((key) => productKeys.has(key)).length;
      if (productCount / fmAnchors.length < 0.75) {
        errors.push(err(
          "topic_insufficient_product_evidence",
          `topic cites ${productCount}/${fmAnchors.length} product anchors; at least 75% are required`,
          "frontmatter",
        ));
      }
    }
    const relatedHeading = h2Matches.find(
      (heading) => heading.text.trim().toLocaleLowerCase("en-US") === "related pages",
    );
    if (relatedHeading !== undefined) {
      const nextH2 = h2Matches.find((heading) => heading.offset > relatedHeading.offset);
      const relatedBody = body.slice(relatedHeading.offset, nextH2?.offset ?? body.length);
      const actualTargets = new Set(
        [...relatedBody.matchAll(/\[[^\]]+\]\(([^)\s]+)(?:\s+[^)]*)?\)/g)]
          .map((match) => match[1]!)
          .filter(Boolean),
      );
      const expectedTargets = new Set<string>(["index.md"]);
      for (const moduleId of context?.expectedTopicModules ?? []) {
        expectedTargets.add(`../${moduleId}/index.md`);
      }
      for (const flowSlug of context?.expectedTopicFlows ?? []) {
        expectedTargets.add(`../flows/${flowSlug}.md`);
        expectedTargets.add(`../diagrams/flow-${flowSlug}.mmd`);
      }
      const missing = [...expectedTargets].filter((target) => !actualTargets.has(target));
      const unexpected = [...actualTargets].filter((target) =>
        !/^(?:https?:|mailto:|#)/i.test(target) && !expectedTargets.has(target)
      );
      if (missing.length > 0 || unexpected.length > 0) {
        errors.push(err(
          "topic_related_link_mismatch",
          `topic Related pages links must match the accepted evidence; missing=[${missing.join(", ")}], unexpected=[${unexpected.join(", ")}]`,
          "section",
          [...actualTargets].join(", "),
          relatedHeading.slug,
        ));
      }
    }
  }

  if (pageKind === "module" && context !== undefined && context.moduleRole !== "product") {
    const h2Titles = h2Matches.map((heading) => heading.text.trim().toLocaleLowerCase("en-US"));
    const allowed = new Set(["when to use this page", "how it fits", "reference"]);
    const unexpected = h2Matches.find((heading) => !allowed.has(heading.text.trim().toLocaleLowerCase("en-US")));
    if (!h2Titles.includes("reference") || unexpected !== undefined) {
      errors.push(err(
        "auxiliary_page_not_compact",
        "auxiliary pages must keep the required opening and use one `## Reference` implementation section only",
        "body",
        unexpected?.text ?? "Reference (absent)",
      ));
    }
    const auxiliarySubheadings = headingMatches.filter((heading) => heading.level >= 3);
    for (const heading of auxiliarySubheadings) {
      const ancestorH2 = lastHeadingBefore(h2Matches, heading.offset);
      if (heading.level !== 3 || ancestorH2?.text.trim().toLocaleLowerCase("en-US") !== "reference") {
        errors.push(err(
          "auxiliary_page_not_compact",
          "auxiliary implementation subheadings must be H3 entries inside `## Reference`",
          "section",
          heading.text,
          heading.slug,
        ));
      }
    }
    const referenceH3s = auxiliarySubheadings.filter((heading) =>
      heading.level === 3 &&
      lastHeadingBefore(h2Matches, heading.offset)?.text.trim().toLocaleLowerCase("en-US") === "reference"
    );
    for (const heading of referenceH3s) {
      const nextHeading = headingMatches.find((candidate) => candidate.offset > heading.offset);
      const end = nextHeading?.offset ?? body.length;
      const markers = sectionMatches.filter((marker) => marker.index! > heading.offset && marker.index! < end);
      if (markers.length !== 1) {
        errors.push(err(
          "auxiliary_page_not_compact",
          `auxiliary symbol section "${heading.text.trim()}" must contain exactly one lw:anchors marker`,
          "section",
          heading.text,
          heading.slug,
        ));
        continue;
      }
      const marker = markers[0]!;
      const headingLineEnd = markerScanBody.indexOf("\n", heading.offset);
      const between = markerScanBody.slice(headingLineEnd < 0 ? heading.offset + heading.text.length : headingLineEnd + 1, marker.index!).trim();
      if (between !== "") {
        errors.push(err(
          "auxiliary_page_not_compact",
          "the auxiliary symbol marker must appear immediately after its H3 heading",
          "section",
          between,
          heading.slug,
        ));
      }
      const markerEnd = marker.index! + marker[0]!.length;
      const prose = body.slice(markerEnd, end).trim();
      const paragraphs = prose.split(/\n\s*\n/).filter((paragraph) => paragraph.trim() !== "");
      if (paragraphs.length !== 1 || prose.length > 500 || /^\s*[-*+]\s+/m.test(prose)) {
        errors.push(err(
          "auxiliary_page_not_compact",
          "each auxiliary symbol entry must contain one short prose paragraph (500 characters maximum, no list)",
          "section",
          prose.slice(0, 200),
          heading.slug,
        ));
      }
    }
    for (const marker of sectionMatches) {
      const preceding = [...headingMatches].reverse().find((heading) => heading.offset < marker.index!) ?? null;
      const ancestorH2 = lastHeadingBefore(h2Matches, marker.index!);
      const keys = marker[1]!.trim().split(/\s+/).filter(Boolean);
      if (preceding?.level !== 3 || ancestorH2?.text.trim().toLocaleLowerCase("en-US") !== "reference" || keys.length !== 1) {
        errors.push(err(
          "auxiliary_page_not_compact",
          "each auxiliary symbol must have one H3 inside `## Reference`, followed by one marker containing exactly that symbol key",
          "section",
          marker[0]!,
          preceding?.slug,
        ));
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
    // Flow pages: the closed list is an upper bound, not an assignment —
    // the page cites only the keys it needs ("may use fewer, never more"),
    // but both sides must stay consistent: a key used on exactly one side
    // (frontmatter XOR section markers) is still missing_closed_key.
    const usesUpperBound = context?.pageKind === "flow" || context?.pageKind === "topic";
    const fmReference: readonly string[] = usesUpperBound ? [...sectionKeysSeen] : closedKeyList;
    const sectionReference: readonly string[] = usesUpperBound ? fmAnchors : closedKeyList;
    if (fm !== null) {
      const fmKeySet = new Set(fmAnchors);
      for (const k of fmReference) {
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
    for (const k of sectionReference) {
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
            m[0]!,
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
  //
  // The structured error now carries an actionable diagnostic: which
  // construct was left open (fence vs inline-code span), a 1-based line
  // number of the opening delimiter, and an `offending` excerpt capped
  // at 200 chars. R3 evidence (rerun-clean-v20) showed the LLM keeping
  // the same unclosed construct through every repair attempt because
  // the previous generic message gave the model no way to locate the
  // opening. The boolean `hasUnclosedMarkdown` API is preserved for
  // every other caller; the additional diagnostic is attached via the
  // `offending` field.
  if (hasUnclosedMarkdown(body)) {
    const diag = unclosedMarkdownDiagnostic(body);
    if (diag !== null) {
      const construct = diag.kind === "fence" ? "fenced code block" : "inline-code span";
      // The validator message names the EXACT delimiter length and
      // the precise closing rule for the construct:
      //
      //   - fence (CommonMark): the closing fence run must be of the
      //     SAME character (backticks or tildes) and at least as
      //     long as the opening run — "at least K characters".
      //   - inline-code (CommonMark): the closing backtick run must
      //     be EXACTLY the same length as the opening run — "exactly
      //     K backticks". K+1 leaves the span open.
      //
      // R4 follow-up: the previous directive said "at least K" for
      // both, which is correct for fences but wrong for inline-code.
      // `maskInlineCode` only accepts an exact-length match, so a
      // repair model following "at least" would emit K+1 and leave
      // the Markdown unclosed.
      //
      // The character class (backtick vs tilde) is visible in the
      // bounded excerpt; only the length is carried in the message
      // text itself, since the excerpt can only show a visible
      // representative portion when the run is longer than the
      // diagnostic cap.
      const directive =
        diag.kind === "fence"
          ? `close it with the same delimiter character and a run of at least ${diag.delimiterLength} characters`
          : `close it with exactly ${diag.delimiterLength} backticks`;
      errors.push(
        err(
          "unclosed_markdown",
          `the page ends with an unclosed ${construct} opened at line ${diag.lineNumber} (delimiter length ${diag.delimiterLength}) — ${directive} and audit every other open construct before the end of the page`,
          "body",
          diag.offending,
        ),
      );
    } else {
      // Defensive: the boolean said unclosed but the diagnostic scan
      // found no opening line. Fall back to the previous generic
      // message so we never silently swallow the failure.
      errors.push(
        err(
          "unclosed_markdown",
          "the page ends with an unclosed fenced code block or inline-code span (cut mid-token)",
          "body",
        ),
      );
    }
  }

  // 4e. "TODO"/"TBD" placeholders are banned from prose, except
  // when they appear inside a fenced/inline code example (quoting someone
  // else's TODO comment is not the same as writing your own placeholder)
  // or inside a `<!-- lw:manual -->` block (human content this validator
  // does not otherwise police). `model_invented_manual` below already
  // rejects the artifact outright if the LLM wrote its OWN manual block,
  // so this exclusion mostly matters for reused/shared masking helpers —
  // it is still correct to apply it here defensively.
  //
  // The structured error carries the logical line from the ORIGINAL
  // body. Manual blocks are blanked to spaces of equal length and the
  // code-span mask is the LENGTH-PRESERVING variant so the offset of
  // the first TODO/TBD match in the masked text is byte-for-byte equal
  // to its offset in the original body — including on CRLF input, where
  // the non-preserving `maskCodeSpans` would drop the carriage returns
  // and shift the offset (defect that produced wrong line numbers in
  // R3). The 1-based line number is counted against the original body
  // and the offending excerpt is bounded to TODO_OFFENDING_CAP (==
  // DIAGNOSTIC_TEXT_CAP in batch-state.ts) so a runaway 40k-char line
  // cannot inflate the repair prompt; the excerpt visibly indicates
  // truncation.
  {
    const withoutManual = body.replace(
      MANUAL_BLOCK_RE,
      (m) => " ".repeat(m.length),
    );
    const withoutCode = maskCodeSpansPreservingLength(withoutManual);
    const firstHit = findFirstTodoPlaceholder(withoutCode);
    if (firstHit !== null) {
      const firstOffset = firstHit.index;
      let offendingLine: string | undefined;
      let lineNumber: number | undefined;
      if (firstOffset >= 0) {
        const origLineEnd = findOriginalLineEnd(body, firstOffset);
        const origLineStart = findOriginalLineStart(body, firstOffset);
        const fullLine = body.slice(origLineStart, origLineEnd);
        offendingLine = boundedOffendingExcerpt(
          fullLine,
          firstOffset - origLineStart,
          firstOffset - origLineStart + firstHit.text.length,
          TODO_OFFENDING_CAP,
        );
        lineNumber = countLines(body, origLineStart) + 1;
      }
      errors.push(
        err(
          "todo_marker_present",
          offendingLine !== undefined && lineNumber !== undefined
            ? `the page body contains a "TODO"/"TBD" placeholder outside code at line ${lineNumber} — write concrete content about what is visible instead`
            : `the page body contains a "TODO"/"TBD" placeholder outside code — write concrete content about what is visible instead`,
          "body",
          offendingLine,
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

  if (pageKind === "topic") {
    const prose = maskCodeSpansPreservingLength(body)
      .replace(/<!--[^]*?-->/g, " ")
      .replace(/^#{1,6}\s+.*$/gm, " ")
      .replace(/^\s*[-*+]\s+/gm, " ");
    const wordCount = prose.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.length ?? 0;
    if (wordCount > 1_400) {
      errors.push(err("topic_too_long", `topic contains ${wordCount} prose words; hard maximum is 1400`, "body", String(wordCount)));
    }
    const topicFences = [...body.matchAll(/^(`{3,}|~{3,})([^\n]*)$/gm)];
    for (let index = 0; index < topicFences.length; index += 2) {
      const fence = topicFences[index]!;
      const info = fence[2]!.trim().split(/\s+/, 1)[0]!.toLowerCase();
      if (info !== "mermaid") {
        errors.push(err("topic_code_fence", "topic pages may not contain non-Mermaid fenced code blocks", "body", fence[0]));
      }
    }
    // D2 follow-up (MPTP measurement run, 2026-07-27): 18 citations written
    // as Markdown links to SOURCE paths (`[sym](app/services/bgm.py#sym)`)
    // passed both this validator and verify (verify only checks .md/.mmd
    // link targets), yet they do not resolve for readers — from
    // livewiki/topics/ the relative source path does not exist. Topic prose
    // names source symbols as inline-code closed-list keys; Markdown links
    // are for wiki artifacts only. Code spans/fences are masked first so an
    // inline-code key (the RECOMMENDED form) is never flagged.
    const maskedForLinks = maskCodeSpansPreservingLength(body);
    for (const match of maskedForLinks.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+[^)]*)?\)/g)) {
      const target = match[1]!;
      if (/^(?:https?:|mailto:|#)/i.test(target)) continue;
      const targetPath = target.split("#", 1)[0]!;
      if (targetPath === "" || /\.(?:md|mmd)$/i.test(targetPath)) continue;
      errors.push(err(
        "topic_source_link",
        `link target "${target}" points at a source path outside the wiki and does not resolve for readers; name the symbol as inline code with its exact closed-list key, or link to its module page (../<moduleId>/index.md)`,
        "body",
        target,
      ));
    }
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

interface PageOpeningFailure {
  readonly message: string;
  readonly offending: string;
}

function validateExactTopicList(
  field: "modules" | "flows",
  actualValue: Frontmatter[string] | undefined,
  expectedValue: readonly string[] | undefined,
  errors: ArtifactValidationError[],
): void {
  if (!Array.isArray(actualValue)) {
    errors.push(err("topic_frontmatter_mismatch", `topic frontmatter must contain \`${field}:\` as a string list`, "frontmatter", typeof actualValue === "string" ? actualValue : undefined));
    return;
  }
  if (expectedValue === undefined) return;
  const exact = actualValue.length === expectedValue.length &&
    actualValue.every((value, index) => value === expectedValue[index]);
  if (!exact) {
    errors.push(err("topic_frontmatter_mismatch", `topic frontmatter \`${field}:\` (${actualValue.join(", ")}) must equal the accepted plan (${expectedValue.join(", ")})`, "frontmatter", actualValue.join(", ")));
  }
}

/** Structural-only check for the required page opening, in contract order. */
function checkRequiredPageOpening(text: string, relaxed = false): PageOpeningFailure | null {
  const lines = text.split("\n");
  while (lines.length > 0 && lines[0]!.trim() === "") lines.shift();
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === "") lines.pop();

  const h1Index = lines.findIndex((line) => /^#\s+\S/.test(line.trim()));
  if (h1Index < 0) {
    return {
      message: "required page opening H1 is missing",
      offending: "(absent)",
    };
  }
  if (h1Index > 0) {
    return {
      message: "required page opening H1 appears after other content",
      offending: lines[h1Index]!.trim(),
    };
  }

  const whenIndex = findExactOpeningH2(lines, "When to use this page", 1);
  const whenCandidateIndex = findOpeningHeadingCandidate(lines, "When to use this page", 1);
  const firstH2AfterH1 = findNextH2(lines, 1);
  const responsibilityEnd = firstPresentIndex(whenIndex, whenCandidateIndex, firstH2AfterH1, lines.length);
  const responsibilityFailure = proseBlockFailure(lines.slice(1, responsibilityEnd), true, false);
  if (responsibilityFailure !== null) {
    return {
      message: responsibilityFailure === "(absent)"
        ? "page opening responsibility paragraph is missing"
        : "page opening responsibility block must be exactly one prose paragraph",
      offending: responsibilityFailure,
    };
  }

  if (whenIndex < 0) {
    return {
      message: 'required page opening H2 "When to use this page" is missing or malformed',
      offending: offendingHeading(lines, whenCandidateIndex, firstH2AfterH1),
    };
  }

  const howIndex = findExactOpeningH2(lines, "How it fits", whenIndex + 1);
  const howCandidateIndex = findOpeningHeadingCandidate(lines, "How it fits", whenIndex + 1);
  const firstH2AfterWhen = findNextH2(lines, whenIndex + 1);
  const taskEnd = firstPresentIndex(howIndex, howCandidateIndex, firstH2AfterWhen, lines.length);
  const taskLines = lines
    .slice(whenIndex + 1, taskEnd)
    .map((line) => line.trim())
    .filter(Boolean);
  const malformedTaskLine = taskLines.find((line) => !/^[-*+]\s+\S/.test(line));
  // Relaxed contract: bullets or prose, any count — only presence remains.
  if (relaxed) {
    if (taskLines.length === 0) {
      return {
        message: 'page opening "When to use this page" must contain at least one task line (relaxed contract: bullets or prose, any count)',
        offending: "(absent)",
      };
    }
  } else if (taskLines.length < 2 || taskLines.length > 4 || malformedTaskLine !== undefined) {
    return {
      message: 'page opening "When to use this page" task list must contain only 2 to 4 non-empty Markdown bullets',
      offending: malformedTaskLine ?? openingSnippet(taskLines),
    };
  }

  if (howIndex < 0) {
    return {
      message: 'required page opening H2 "How it fits" is missing or malformed',
      offending: offendingHeading(lines, howCandidateIndex, firstH2AfterWhen),
    };
  }

  // Bound the How-it-fits prose block at the next implementation
  // heading. Stage-4 explicitly permits both H2 and H3 implementation
  // sections, including on zero-key pages, so either level ends the
  // opening rather than becoming a forbidden heading inside its prose.
  const howBlockEnd = findNextImplementationHeading(lines, howIndex + 1);
  const howBlockLines =
    howBlockEnd < 0 ? lines.slice(howIndex + 1) : lines.slice(howIndex + 1, howBlockEnd);
  // Relaxed contract: How-it-fits accepts bullets.
  const howFailure = proseBlockFailure(howBlockLines, false, true, relaxed);
  if (howFailure !== null) {
    return {
      message: relaxed
        ? 'page opening "How it fits" must contain one or more prose paragraphs or bullets without headings or lw: markers'
        : 'page opening "How it fits" must contain one or more prose paragraphs without headings, bullets, or lw: markers',
      offending: howFailure,
    };
  }

  return null;
}

/**
 * Structural-only check for the stage-5 flow-page contract, in contract
 * order. Reports only the first failing element, same style as the module
 * opening check. `masked` is the length-preserving code-span mask of `raw`
 * (offsets and line indices are interchangeable): structure is scanned on the
 * masked view so fenced/inline code cannot fake headings, markers, lists, or
 * links, while the `## Diagram` mermaid fence is inspected on the raw text.
 *
 * Contract order: H1, one responsibility paragraph, Purpose, Ordered flow,
 * Diagram, Invariants, Failure and recovery, Related pages. lw:anchors
 * markers may live inside Purpose / Ordered flow / Failure and recovery, so
 * they neither satisfy nor violate section content requirements; the dual
 * closed-key completeness rule governs their placement.
 */
function checkRequiredTopicOpening(masked: string, expectedTitle?: string, relaxed = false): PageOpeningFailure | null {
  const lines = masked.split("\n");
  while (lines.length > 0 && lines[0]!.trim() === "") lines.shift();
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === "") lines.pop();
  if (!/^#\s+\S/.test(lines[0]?.trim() ?? "")) {
    return { message: "required topic H1 is missing or appears after other content", offending: lines[0]?.trim() || "(absent)" };
  }
  if (expectedTitle !== undefined && lines[0]!.trim().slice(2).trim() !== expectedTitle) {
    return { message: `topic H1 must match the accepted title "${expectedTitle}"`, offending: lines[0]!.trim() };
  }

  // Relaxed contract: the required-section set reduces to Purpose,
  // Behavioral contract, and Related pages; the other contract sections
  // may be present (unchecked) or absent.
  const required: readonly string[] = relaxed
    ? ["Purpose", "Behavioral contract", "Related pages"]
    : [
        "Purpose",
        "When to use this page",
        "Behavioral contract",
        "Failure and recovery",
        "Change map",
        "Related pages",
      ];
  const purposeIndex = findExactOpeningH2(lines, "Purpose", 1);
  const firstH2 = findNextH2(lines, 1);
  const problemEnd = firstPresentIndex(purposeIndex, firstH2, lines.length);
  // Relaxed contract: the reader-problem block accepts bullets and is no
  // longer limited to a single paragraph.
  const problemFailure = proseBlockFailure(lines.slice(1, problemEnd), !relaxed, false, relaxed);
  if (problemFailure !== null) {
    return {
      message: relaxed
        ? "topic opening must contain a reader-problem block between H1 and Purpose (relaxed contract: prose or bullets)"
        : "topic opening must contain exactly one reader-problem sentence between H1 and Purpose",
      offending: problemFailure,
    };
  }

  let cursor = 1;
  for (const title of required) {
    const index = findExactOpeningH2(lines, title, cursor);
    if (index < 0) {
      return {
        message: `required topic H2 "${title}" is missing, malformed, or out of order`,
        offending: offendingHeading(lines, findOpeningHeadingCandidate(lines, title, cursor), findNextH2(lines, cursor)),
      };
    }
    const sectionFailure = flowSectionProseFailure(
      lines.slice(index + 1, flowSectionEnd(lines, index)),
      relaxed || title === "When to use this page" || title === "Change map" || title === "Related pages",
    );
    if (sectionFailure !== null) {
      return { message: `topic section "${title}" must contain grounded prose, bullets, or links`, offending: sectionFailure };
    }
    cursor = index + 1;
  }
  return null;
}

/**
 * Roadmap item 22 (D1/D2): locate the module page's `## Diagram` H2
 * (case-insensitive, fence-safe via the masked view) and require its mermaid
 * fence to hold the exact `%% <expectedModuleDiagram>` placeholder line.
 * Same placeholder discipline as the flow opening check
 * (checkRequiredFlowOpening), but the module Diagram section is NOT part of
 * the page opening — it sits after `How it fits`, before the implementation
 * sections.
 */
function checkModuleDiagramPlaceholder(
  masked: string,
  raw: string,
  expectedModuleDiagram: string,
): PageOpeningFailure | null {
  const maskedLines = masked.split("\n");
  const rawLines = raw.split("\n");
  let diagramIndex = -1;
  for (let i = 0; i < maskedLines.length; i++) {
    const line = maskedLines[i]!.trim();
    if (
      /^##\s+\S/.test(line) &&
      line.slice(3).trim().toLocaleLowerCase("en-US") === "diagram"
    ) {
      diagramIndex = i;
      break;
    }
  }
  if (diagramIndex < 0) {
    return {
      message: 'module page must contain a "Diagram" H2 section with a fenced mermaid block (config moduleDiagrams)',
      offending: "(absent)",
    };
  }
  let sectionEnd = maskedLines.length;
  for (let i = diagramIndex + 1; i < maskedLines.length; i++) {
    if (/^#{1,6}\s+\S/.test(maskedLines[i]!.trim())) {
      sectionEnd = i;
      break;
    }
  }
  const diagramRaw = rawLines.slice(diagramIndex + 1, sectionEnd).join("\n");
  const mermaidFence = /```mermaid[ \t]*\n([\s\S]*?)\n[ \t]*```/.exec(diagramRaw);
  const placeholderLine = mermaidFence?.[1]
    ?.split("\n")
    .map((line) => line.trim())
    .find((line) => /^%%\s*livewiki\/diagrams\/\S+\.mmd$/.test(line));
  if (placeholderLine === undefined) {
    return {
      message: 'module "Diagram" section must contain a fenced mermaid code block holding a %% livewiki/diagrams/<slug>.mmd placeholder line',
      offending: "(absent)",
    };
  }
  const actual = placeholderLine.replace(/^%%\s*/, "").trim();
  if (actual !== expectedModuleDiagram) {
    return {
      message: `module "Diagram" placeholder must be exactly "%% ${expectedModuleDiagram}"`,
      offending: placeholderLine,
    };
  }
  return null;
}

function checkRequiredFlowOpening(
  masked: string,
  raw: string,
  expectedFlowDiagram?: string,
  relaxed = false,
): PageOpeningFailure | null {
  const maskedLines = masked.split("\n");
  const rawLines = raw.split("\n");
  let start = 0;
  let end = maskedLines.length;
  while (start < end && maskedLines[start]!.trim() === "") start++;
  while (end > start && maskedLines[end - 1]!.trim() === "") end--;
  const lines = maskedLines.slice(start, end);
  const rawSlice = rawLines.slice(start, end);

  const h1Index = lines.findIndex((line) => /^#\s+\S/.test(line.trim()));
  if (h1Index < 0) {
    return {
      message: "required page opening H1 is missing",
      offending: "(absent)",
    };
  }
  if (h1Index > 0) {
    return {
      message: "required page opening H1 appears after other content",
      offending: lines[h1Index]!.trim(),
    };
  }

  const purposeIndex = findExactOpeningH2(lines, "Purpose", 1);
  const purposeCandidateIndex = findOpeningHeadingCandidate(lines, "Purpose", 1);
  const firstH2AfterH1 = findNextH2(lines, 1);
  const responsibilityEnd = firstPresentIndex(purposeIndex, purposeCandidateIndex, firstH2AfterH1, lines.length);
  const responsibilityFailure = proseBlockFailure(lines.slice(1, responsibilityEnd), true, false);
  if (responsibilityFailure !== null) {
    return {
      message: responsibilityFailure === "(absent)"
        ? "page opening responsibility paragraph is missing"
        : "page opening responsibility block must be exactly one prose paragraph",
      offending: responsibilityFailure,
    };
  }

  if (purposeIndex < 0) {
    return {
      message: 'required page opening H2 "Purpose" is missing or malformed',
      offending: offendingHeading(lines, purposeCandidateIndex, firstH2AfterH1),
    };
  }

  // Contract ordering: the opening (H1, responsibility paragraph, Purpose)
  // must appear before the first lw:anchors section marker, same rule as
  // module pages — markers live inside the contract sections, never before
  // the Purpose heading.
  const firstMarkerLine = lines.findIndex((line) => /<!--\s*lw:anchors\s/.test(line));
  if (firstMarkerLine >= 0 && firstMarkerLine <= purposeIndex) {
    return {
      message: 'page opening (H1, responsibility paragraph, "Purpose") must appear before the first lw:anchors section marker',
      offending: lines[firstMarkerLine]!.trim(),
    };
  }

  // Relaxed contract: Purpose accepts bullets.
  const purposeFailure = flowSectionProseFailure(
    lines.slice(purposeIndex + 1, flowSectionEnd(lines, purposeIndex)),
    relaxed,
  );
  if (purposeFailure !== null) {
    return {
      message: 'page opening "Purpose" must contain one or more prose paragraphs',
      offending: purposeFailure,
    };
  }

  const orderedIndex = findExactOpeningH2(lines, "Ordered flow", purposeIndex + 1);
  if (orderedIndex < 0) {
    return {
      message: 'required page opening H2 "Ordered flow" is missing or malformed',
      offending: offendingHeading(
        lines,
        findOpeningHeadingCandidate(lines, "Ordered flow", purposeIndex + 1),
        findNextH2(lines, purposeIndex + 1),
      ),
    };
  }
  const orderedContent = lines
    .slice(orderedIndex + 1, flowSectionEnd(lines, orderedIndex))
    .map((line) => line.trim())
    .filter(Boolean);
  if (!orderedContent.some((line) => /^\d+[.)]\s+\S/.test(line))) {
    return {
      message: 'page opening "Ordered flow" must contain a numbered Markdown list with at least one item',
      offending: openingSnippet(orderedContent),
    };
  }

  const diagramIndex = findExactOpeningH2(lines, "Diagram", orderedIndex + 1);
  if (diagramIndex < 0) {
    return {
      message: 'required page opening H2 "Diagram" is missing or malformed',
      offending: offendingHeading(
        lines,
        findOpeningHeadingCandidate(lines, "Diagram", orderedIndex + 1),
        findNextH2(lines, orderedIndex + 1),
      ),
    };
  }
  const diagramRaw = rawSlice
    .slice(diagramIndex + 1, flowSectionEnd(lines, diagramIndex))
    .join("\n");
  const mermaidFence = /```mermaid[ \t]*\n([\s\S]*?)\n[ \t]*```/.exec(diagramRaw);
  const placeholderLine = mermaidFence?.[1]
    ?.split("\n")
    .map((line) => line.trim())
    .find((line) => /^%%\s*livewiki\/diagrams\/flow-\S+\.mmd$/.test(line));
  if (placeholderLine === undefined) {
    return {
      message: 'page opening "Diagram" must contain a fenced mermaid code block holding a %% livewiki/diagrams/flow-<slug>.mmd placeholder line',
      offending: "(absent)",
    };
  }
  if (expectedFlowDiagram !== undefined) {
    const actual = placeholderLine.replace(/^%%\s*/, "").trim();
    if (actual !== expectedFlowDiagram) {
      return {
        message: `page opening "Diagram" placeholder must be exactly "%% ${expectedFlowDiagram}"`,
        offending: placeholderLine,
      };
    }
  }

  // Relaxed contract: the required-section set reduces to Purpose, Ordered
  // flow, Diagram, and Related pages. Invariants and Failure and recovery
  // are content-checked when present but are no longer required.
  let sectionCursor = diagramIndex + 1;
  const invariantsIndex = findExactOpeningH2(lines, "Invariants", sectionCursor);
  if (invariantsIndex < 0) {
    if (!relaxed) {
      return {
        message: 'required page opening H2 "Invariants" is missing or malformed',
        offending: offendingHeading(
          lines,
          findOpeningHeadingCandidate(lines, "Invariants", sectionCursor),
          findNextH2(lines, sectionCursor),
        ),
      };
    }
  } else {
    const invariantsFailure = flowSectionProseFailure(
      lines.slice(invariantsIndex + 1, flowSectionEnd(lines, invariantsIndex)),
      true,
    );
    if (invariantsFailure !== null) {
      return {
        message: 'page opening "Invariants" must contain prose or bullets',
        offending: invariantsFailure,
      };
    }
    sectionCursor = invariantsIndex + 1;
  }

  const failureIndex = findExactOpeningH2(lines, "Failure and recovery", sectionCursor);
  if (failureIndex < 0) {
    if (!relaxed) {
      return {
        message: 'required page opening H2 "Failure and recovery" is missing or malformed',
        offending: offendingHeading(
          lines,
          findOpeningHeadingCandidate(lines, "Failure and recovery", sectionCursor),
          findNextH2(lines, sectionCursor),
        ),
      };
    }
  } else {
    // Relaxed contract: Failure and recovery accepts bullets.
    const failureFailure = flowSectionProseFailure(
      lines.slice(failureIndex + 1, flowSectionEnd(lines, failureIndex)),
      relaxed,
    );
    if (failureFailure !== null) {
      return {
        message: relaxed
          ? 'page opening "Failure and recovery" must contain prose or bullets'
          : 'page opening "Failure and recovery" must contain one or more prose paragraphs',
        offending: failureFailure,
      };
    }
    sectionCursor = failureIndex + 1;
  }

  const relatedIndex = findExactOpeningH2(lines, "Related pages", sectionCursor);
  if (relatedIndex < 0) {
    return {
      message: 'required page opening H2 "Related pages" is missing or malformed',
      offending: offendingHeading(
        lines,
        findOpeningHeadingCandidate(lines, "Related pages", failureIndex + 1),
        findNextH2(lines, failureIndex + 1),
      ),
    };
  }
  const relatedContent = lines
    .slice(relatedIndex + 1, flowSectionEnd(lines, relatedIndex))
    .map((line) => line.trim())
    .filter(Boolean);
  if (!relatedContent.some((line) => /\[[^\]]+\]\([^)]*\)/.test(line))) {
    return {
      message: 'page opening "Related pages" must contain at least one Markdown link',
      offending: openingSnippet(relatedContent),
    };
  }

  return null;
}

/** End line index (exclusive) of a flow contract section: the next heading of any level. */
function flowSectionEnd(lines: ReadonlyArray<string>, headingIndex: number): number {
  const next = lines.findIndex(
    (line, index) => index > headingIndex && /^#{1,6}\s+\S/.test(line.trim()),
  );
  return next < 0 ? lines.length : next;
}

/**
 * Content check for flow contract sections. lw:anchors markers are anchor
 * carriers, not prose — they neither satisfy nor violate the requirement.
 * Returns the offending line, "(absent)" when there is no content, or null.
 */
function flowSectionProseFailure(
  lines: ReadonlyArray<string>,
  allowBullets: boolean,
): string | null {
  const content = lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^<!--\s*lw:anchors\s/.test(line));
  if (content.length === 0) return "(absent)";
  const forbidden = content.find((line) =>
    /^#{1,6}\s/.test(line)
      || (!allowBullets && /^[-*+]\s/.test(line))
      || /^<!--\s*\/?lw:/.test(line));
  return forbidden ?? null;
}

function findExactOpeningH2(
  lines: ReadonlyArray<string>,
  heading: string,
  start: number,
): number {
  const expected = heading.toLocaleLowerCase("en-US");
  return lines.findIndex((line, index) =>
    index >= start
      && /^##\s+\S/.test(line.trim())
      && line.trim().slice(3).trim().toLocaleLowerCase("en-US") === expected,
  );
}

function findOpeningHeadingCandidate(
  lines: ReadonlyArray<string>,
  heading: string,
  start: number,
): number {
  const expected = heading.toLocaleLowerCase("en-US");
  return lines.findIndex((line, index) => {
    if (index < start) return false;
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line.trim());
    return match?.[2]?.toLocaleLowerCase("en-US") === expected;
  });
}

function findNextH2(lines: ReadonlyArray<string>, start: number): number {
  return lines.findIndex((line, index) => index >= start && /^##\s+\S/.test(line.trim()));
}

interface TodoPlaceholderMatch {
  readonly index: number;
  readonly text: string;
}

/**
 * Find the first actual TODO/TBD placeholder in prose.
 *
 * A slash-joined category reference such as "TODO/TBD prose" describes
 * the validation rule itself; it does not leave documentation work pending.
 * Keep that narrow exemption separate from real directives such as
 * "TODO: document this" or "Behavior is TBD", which remain invalid.
 */
function findFirstTodoPlaceholder(text: string): TodoPlaceholderMatch | null {
  const tokenRe = /\b(?:TODO|TBD)\b/gi;
  // Etapa 3 run #4 finding (2026-07-26): banning the bare WORD also flagged
  // legitimate prose about the source's own TODO items — and since Etapa 2b
  // the rationale evidence deliberately feeds TODO-tagged comments to the
  // prompt, because documenting pending work is content, not a placeholder.
  // The ban now covers only the MODEL's own unfinished-work placeholders:
  //   - directive form: "TODO:" / "TBD:" (colon right after the token);
  //   - standalone form: a line/bullet that IS just the marker.
  // Prose mentions ("tracks remaining work in TODO comments") pass, and
  // "TBD" is always banned (never produced by rationale evidence).
  const standaloneRe = /^[-*+>\s]*(?:\d+[.)]\s*)?(?:TODO|TBD)[\s.]*$/i;
  const categoryRe = /\bTODO\b\s*\/\s*\bTBD\b(?=\s+prose\b)/gi;

  for (const match of text.matchAll(tokenRe)) {
    const index = match.index!;
    const lineStart = findOriginalLineStart(text, index);
    const lineEnd = findOriginalLineEnd(text, index);
    const line = text.slice(lineStart, lineEnd);
    const offsetInLine = index - lineStart;
    // A slash-joined "TODO/TBD prose" pair is a reference to the validation
    // category itself, not a placeholder — exempt both tokens of the pair.
    const isCategoryReference = [...line.matchAll(categoryRe)].some((category) => {
      const start = category.index!;
      const end = start + category[0].length;
      return offsetInLine >= start && offsetInLine < end;
    });
    if (isCategoryReference) continue;
    // "TBD" is always the model's own dodge (rationale evidence feeds
    // TODO/FIXME-tagged source comments, never TBD) — keep the blanket ban.
    if (match[0].toUpperCase() === "TBD") {
      return { index, text: match[0] };
    }
    const afterToken = line.slice(offsetInLine + match[0].length);
    const isDirective = afterToken.trimStart().startsWith(":");
    if (isDirective || standaloneRe.test(line.trim())) {
      return { index, text: match[0] };
    }
  }

  return null;
}

function findNextImplementationHeading(lines: ReadonlyArray<string>, start: number): number {
  return lines.findIndex((line, index) => index >= start && /^#{2,3}\s+\S/.test(line.trim()));
}

function firstPresentIndex(...indices: number[]): number {
  return Math.min(...indices.filter((index) => index >= 0));
}

function offendingHeading(
  lines: ReadonlyArray<string>,
  candidateIndex: number,
  fallbackIndex: number,
): string {
  const index = candidateIndex >= 0 ? candidateIndex : fallbackIndex;
  return index >= 0 ? lines[index]!.trim() : "(absent)";
}

function openingSnippet(lines: ReadonlyArray<string>): string {
  return lines.length === 0 ? "(absent)" : lines.slice(0, 5).join("\n");
}

function proseBlockFailure(
  lines: ReadonlyArray<string>,
  requireSingleParagraph: boolean,
  rejectClosingLwMarker: boolean,
  // Relaxed contract (recovery tier, Component 2): bullets are accepted
  // where the strict contract demanded prose.
  allowBullets = false,
): string | null {
  const nonblank = lines.map((line) => line.trim()).filter(Boolean);
  if (nonblank.length === 0) return "(absent)";

  const forbidden = nonblank.find((line) =>
    /^#{1,6}\s|^<!--\s*lw:/.test(line)
      || (!allowBullets && /^[-*+]\s/.test(line))
      || (rejectClosingLwMarker && /^<!--\s*\/lw:/.test(line)),
  );
  if (forbidden !== undefined) return forbidden;

  let paragraphCount = 0;
  let inParagraph = false;
  for (const line of lines) {
    if (line.trim() === "") {
      inParagraph = false;
    } else if (!inParagraph) {
      paragraphCount += 1;
      if (requireSingleParagraph && paragraphCount > 1) return line.trim();
      inParagraph = true;
    }
  }
  return null;
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

/**
 * Return the offset of the start of the line that contains
 * `offset` in `text`. If `offset` is past the end of `text`, returns
 * the offset of the start of the last line.
 */
function findOriginalLineStart(text: string, offset: number): number {
  if (offset < 0) return 0;
  const clamped = Math.min(offset, text.length);
  let i = clamped;
  while (i > 0 && text[i - 1] !== "\n") i--;
  return i;
}

/**
 * Return the offset just past the end of the line that contains
 * `offset` in `text` (the position of the trailing newline, or the
 * end of the text if the line is unterminated).
 */
function findOriginalLineEnd(text: string, offset: number): number {
  if (offset < 0) return 0;
  const clamped = Math.min(offset, text.length);
  let i = clamped;
  while (i < text.length && text[i] !== "\n") i++;
  return i;
}

/**
 * Count the number of `\n` characters strictly before `offset` in
 * `text`. Used to translate a character offset into a 1-based line
 * number (the caller adds 1).
 */
function countLines(text: string, offset: number): number {
  let n = 0;
  const end = Math.min(offset, text.length);
  for (let i = 0; i < end; i++) {
    if (text[i] === "\n") n++;
  }
  return n;
}

/**
 * Cap for a TODO/TBD offending-line excerpt. Must equal
 * DIAGNOSTIC_TEXT_CAP in batch-state.ts so the same value also bounds
 * the repair-prompt surface; declared locally to keep this module
 * free of any new dependency on batch-state (which would re-introduce
 * a layering path for the sake of one number).
 */
const TODO_OFFENDING_CAP = 200;

/**
 * Center a window of length ≤ `cap` around the first TODO/TBD match
 * in `line`, prefixing/suffixing with "… " when the line was
 * truncated. The match itself is preserved; the cap is inclusive of
 * the markers. Short lines are returned unchanged.
 */
function boundedOffendingExcerpt(
  line: string,
  matchStart: number,
  matchEnd: number,
  cap: number,
): string {
  if (line.length <= cap) return line;
  // Reserve room for at most two "… " markers (2 chars each).
  const innerCap = cap - 4;
  const half = Math.floor(innerCap / 2);
  let start = matchStart - half;
  let end = start + innerCap;
  if (start < 0) {
    end = Math.min(line.length, end - start);
    start = 0;
  }
  if (end > line.length) {
    start = Math.max(0, start - (end - line.length));
    end = line.length;
  }
  let excerpt = line.slice(start, end);
  if (start > 0) excerpt = "… " + excerpt;
  if (end < line.length) excerpt = excerpt + " …";
  // Defensive: if clamping or markers pushed us over `cap`, truncate
  // (the TODO/TBD token is in the window center, so it survives).
  if (excerpt.length > cap) excerpt = excerpt.slice(0, cap);
  return excerpt;
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

// === Stage 5: inline flow-diagram extraction and budget counters ===

/**
 * Hard cap on the extracted inline flow-diagram source (chars). Beyond it
 * the diagram is rejected with `flow_diagram_too_large` — a diagram this
 * big cannot be a focused flow (several focused flows over one
 * mega-diagram, SPEC §"Semantic product-flow layer").
 */
export const FLOW_DIAGRAM_SOURCE_MAX_CHARS = 8000;

/** Exact placeholder line the on-disk flow page carries inside its `## Diagram` mermaid fence. */
export function flowDiagramPlaceholder(slug: string): string {
  return `%% livewiki/diagrams/flow-${slug}.mmd`;
}

export interface InlineFlowDiagramExtraction {
  /** Page with the extracted fence body replaced by the exact placeholder line. */
  pageContent: string;
  /** Trimmed source of the inline mermaid block in the `## Diagram` section. */
  diagramSource: string;
  /** True when `diagramSource.length > FLOW_DIAGRAM_SOURCE_MAX_CHARS`. */
  sourceTooLarge: boolean;
}

/**
 * Extracts the stage-5 inline companion diagram from a normalized flow
 * page. The stage-5 LLM emits ONE Markdown page with the companion
 * diagram INLINE as a real ```mermaid fence inside the `## Diagram`
 * section; the orchestrator then (a) extracts the fence content here,
 * (b) validates the page with the fence body substituted by the exact
 * placeholder line, and (c) writes both artifacts (page with placeholder,
 * diagram source as its own `.mmd` file). The placeholder exists only on
 * disk — repair prompts always see the model-emitted inline form.
 *
 * Returns null when the `## Diagram` section contains no real mermaid
 * fence (absent, unclosed, or nested inside another code block) or when
 * the fence body is only a placeholder comment (`%% livewiki/...` — the
 * model-emitted form must be the diagram itself, never the on-disk
 * placeholder). An over-long source does NOT return null: it comes back
 * flagged via `sourceTooLarge` so the caller rejects it with
 * `flow_diagram_too_large` instead of the generic missing-diagram error.
 *
 * Code-span/fence aware: the section bounds are computed on the
 * length-preserving masked view (a fence cannot fake the `## Diagram`
 * heading or hide the section end), and the fence scan itself runs a
 * CommonMark fence state machine over the raw section lines, so an
 * example ```mermaid fence nested inside a `~~~` (or longer-run) block
 * is ignored.
 */
export function extractInlineFlowDiagram(
  content: string,
  slug: string,
  placeholder: string = flowDiagramPlaceholder(slug),
): InlineFlowDiagramExtraction | null {
  const rawLines = content.split("\n");
  const maskedLines = maskCodeSpansPreservingLength(content).split("\n");

  // Section bounds of the FIRST `## Diagram` H2 (case-insensitive — the
  // same matching rule as the flow opening validator).
  let diagramIndex = -1;
  for (let i = 0; i < maskedLines.length; i++) {
    const line = maskedLines[i]!.trim();
    if (
      /^##\s+\S/.test(line) &&
      line.slice(3).trim().toLocaleLowerCase("en-US") === "diagram"
    ) {
      diagramIndex = i;
      break;
    }
  }
  if (diagramIndex < 0) return null;
  let sectionEnd = rawLines.length;
  for (let i = diagramIndex + 1; i < maskedLines.length; i++) {
    if (/^#{1,6}\s+\S/.test(maskedLines[i]!.trim())) {
      sectionEnd = i;
      break;
    }
  }

  // First real ```mermaid fence inside the section (CommonMark state
  // machine: an inner fence candidate is content while another fence is
  // open, so examples nested in `~~~` blocks are skipped).
  let inFence = false;
  let fenceChar = "";
  let fenceLen = 0;
  let fenceOpen = -1;
  let mermaidBody: string[] | null = null;
  for (let i = diagramIndex + 1; i < sectionEnd; i++) {
    const line = rawLines[i]!;
    if (!inFence) {
      const open = /^[ \t]{0,3}(`{3,}|~{3,})/.exec(line);
      if (open?.[1]) {
        inFence = true;
        fenceChar = open[1][0]!;
        fenceLen = open[1].length;
        if (fenceChar === "`" && /^[ \t]{0,3}`{3,}mermaid[ \t]*$/.test(line)) {
          fenceOpen = i;
        }
      }
      continue;
    }
    const closeRe = new RegExp(`^[ \\t]{0,3}[${fenceChar}]{${fenceLen},}[ \\t]*$`);
    if (closeRe.test(line)) {
      if (fenceOpen >= 0) {
        mermaidBody = rawLines.slice(fenceOpen + 1, i);
      }
      inFence = false;
      if (mermaidBody !== null) break;
    }
  }
  if (mermaidBody === null) return null;

  const diagramSource = mermaidBody.join("\n").trim();
  if (diagramSource.length === 0) return null;
  const placeholderOnly = mermaidBody
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .every((line) => /^%%\s*livewiki\//.test(line));
  if (placeholderOnly) return null;

  const pageContent = [
    ...rawLines.slice(0, fenceOpen + 1),
    placeholder,
    ...rawLines.slice(fenceOpen + 1 + mermaidBody.length),
  ].join("\n");

  return {
    pageContent,
    diagramSource,
    sourceTooLarge: diagramSource.length > FLOW_DIAGRAM_SOURCE_MAX_CHARS,
  };
}

/**
 * Roadmap item 22 (D1): module-page variant of the stage-5 inline-diagram
 * extraction. Identical machinery; only the substituted placeholder differs
 * (`moduleDiagramPlaceholder(slug)` — `livewiki/diagrams/<slug>.mmd`, the
 * model-drawn module diagram, distinct from the deterministic
 * `<slug>.classes.mmd` class diagram and the flow `flow-<slug>.mmd`). The
 * placeholder exists only on disk — repair prompts always see the
 * model-emitted inline form.
 */
export function extractInlineModuleDiagram(
  content: string,
  slug: string,
): InlineFlowDiagramExtraction | null {
  return extractInlineFlowDiagram(content, slug, moduleDiagramPlaceholder(slug));
}

export interface FlowDiagramElementCount {
  nodes: number;
  edges: number;
}

/**
 * Best-effort deterministic node/edge counters for the stage-5 diagram
 * budget (`flow_diagram_too_large`). NOT a full Mermaid grammar — a
 * conservative, layout-independent approximation:
 *
 *   - flowchart/graph: unique node identifiers found at statement
 *     endpoints; one edge per link operator (`-->`, `---`, `-.->`,
 *     `==>`, `--o`, `--x`, `<-->`, ...). `subgraph`/`end`/styling
 *     directives are not nodes. Labels do not create nodes.
 *   - sequenceDiagram: unique participant/actor names (declared via
 *     `participant`/`actor` or used as message endpoints); one edge per
 *     message arrow. Frame directives (loop/alt/note/...) are skipped.
 *   - stateDiagram(-v2): unique state identifiers from transitions and
 *     `state` declarations (including `[*]` once); one edge per `-->`.
 *   - anything else: the non-empty, non-comment line count reported as
 *     BOTH nodes and edges (fail-closed on unknown diagram kinds).
 */
export function countFlowDiagramElements(source: string): FlowDiagramElementCount {
  const lines = source
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("%%"));
  if (lines.length === 0) return { nodes: 0, edges: 0 };
  const header = lines[0]!.toLocaleLowerCase("en-US");
  const body = lines.slice(1);
  if (/^(?:flowchart|graph)\b/.test(header)) return countFlowchartElements(body);
  if (/^sequencediagram\b/.test(header)) return countSequenceElements(body);
  if (/^statediagram(?:-v2)?\b/.test(header)) return countStateElements(body);
  return { nodes: lines.length, edges: lines.length };
}

/**
 * Link operators, longest first so `<-->` is not counted as two. No
 * capture groups: `String.split` with this regex yields pure text
 * segments between operators.
 */
const FLOWCHART_EDGE_RE = /<-->|-->|<--|-\.->|-\.-|==>|===|o--o|x--x|--o|o--|--x|x--|---/g;
const FLOWCHART_SKIP_RE =
  /^(?:subgraph\b|end\b|classdef\b|class\b|style\b|linkstyle\b|click\b|direction\b)/i;

function countFlowchartElements(body: string[]): FlowDiagramElementCount {
  const nodes = new Set<string>();
  let edges = 0;
  const addEndpoint = (segment: string): void => {
    // `A & B --> C` chains: each `&` part is an endpoint.
    for (const part of segment.split("&")) {
      const id = /^[A-Za-z0-9_]+/.exec(part.trim());
      if (id) nodes.add(id[0]);
    }
  };
  for (const raw of body) {
    const line = raw.replace(/;+\s*$/, "").trim();
    if (line.length === 0 || FLOWCHART_SKIP_RE.test(line)) continue;
    const operators = line.match(FLOWCHART_EDGE_RE) ?? [];
    if (operators.length === 0) {
      // Node-only statement (`A[Standalone]`).
      addEndpoint(line);
      continue;
    }
    edges += operators.length;
    for (const segment of line.split(FLOWCHART_EDGE_RE)) addEndpoint(segment);
  }
  return { nodes: nodes.size, edges };
}

const SEQUENCE_ARROW_RE = /<<->>|<<-->>|-->>|->>|-->|->|--\)|-\)|--x|-x/;
const SEQUENCE_SKIP_RE =
  /^(?:note\b|loop\b|alt\b|else\b|opt\b|par\b|and\b|critical\b|break\b|rect\b|box\b|end\b|autonumber\b|activate\b|deactivate\b|create\b|destroy\b)/i;

function countSequenceElements(body: string[]): FlowDiagramElementCount {
  const nodes = new Set<string>();
  let edges = 0;
  for (const line of body) {
    const declaration = /^(?:participant|actor)\s+(\S+)/i.exec(line);
    if (declaration?.[1]) {
      nodes.add(declaration[1]);
      continue;
    }
    if (SEQUENCE_SKIP_RE.test(line)) continue;
    if (SEQUENCE_ARROW_RE.test(line)) {
      edges++;
      const [left, right] = line.split(SEQUENCE_ARROW_RE);
      const leftName = left?.trim().replace(/[+-]$/, "").trim();
      const rightName = right?.split(":")[0]?.trim().replace(/[+-]$/, "").trim();
      if (leftName) nodes.add(leftName);
      if (rightName) nodes.add(rightName);
    }
  }
  return { nodes: nodes.size, edges };
}

function countStateElements(body: string[]): FlowDiagramElementCount {
  const nodes = new Set<string>();
  let edges = 0;
  const addState = (token: string): void => {
    const cleaned = token.trim();
    if (cleaned.length === 0) return;
    if (cleaned === "[*]") {
      nodes.add("[*]");
      return;
    }
    const id = /^[A-Za-z0-9_]+/.exec(cleaned);
    if (id) nodes.add(id[0]);
  };
  for (const raw of body) {
    const line = raw.replace(/;+\s*$/, "").trim();
    if (line.length === 0 || /^(?:note\b|end\b|direction\b)/i.test(line)) continue;
    if (/^state\s+/i.test(line)) {
      // `state "Description" as X` or `state X` (composite `state X {`).
      const asAlias = /\bas\s+([A-Za-z0-9_]+)\s*\{?\s*$/.exec(line);
      if (asAlias?.[1]) {
        nodes.add(asAlias[1]);
        continue;
      }
      const word = /^state\s+([A-Za-z0-9_]+)/i.exec(line);
      if (word?.[1]) nodes.add(word[1]);
      continue;
    }
    const transitionParts = line.split("-->");
    if (transitionParts.length > 1) {
      edges += transitionParts.length - 1;
      // Transition labels (`A --> B : label`) are not nodes.
      for (const part of transitionParts) addState(part.split(":")[0]!);
      continue;
    }
    // `X : description` state annotation — X is a node, no edge.
    addState(line.split(":")[0]!);
  }
  return { nodes: nodes.size, edges };
}
