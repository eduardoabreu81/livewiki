/**
 * understanding — the repository understanding layer (roadmap item 23).
 *
 * Batch stage 5 gains ONE bounded task (`understanding:<evidenceHash>`) that
 * synthesizes what the repository IS — what it is, for whom, key surfaces —
 * from a CLOSED evidence inventory: the accepted module pages' opening
 * digests, the flow pages, the topic pages, the deterministic entry-point
 * surfaces, and the README purpose excerpt when one exists. The README is
 * ONE evidence input, never the authority: a missing or bad README cannot
 * poison the orientation, because the synthesis draws on verify-gated wiki
 * pages first.
 *
 * Persistence form (design decision, option (a) of the item-23 brief): the
 * synthesis lives as a small generated page at `livewiki/understanding.md`.
 * The quickstart is regenerated deterministically on every init/batch end,
 * so the synthesis must live somewhere regenerable — a real wiki page keeps
 * rule #3 cleanest (the wiki is the truth; `generateQuickstart` reads it
 * back from disk exactly like it reads module pages for the reader digest).
 *
 * The artifact carries NO anchors: it synthesizes purpose, it does not
 * document symbols. Validation is therefore a dedicated strict contract
 * (below), not a new `ArtifactPageKind` — the anchor-centric validator in
 * artifact.ts and the closed repair contract (Etapa 2a, whose
 * exhaustiveness test pins `ArtifactValidationCode`) stay untouched.
 */

import * as safeIo from "./safe-io.js";
import { parseFrontmatter } from "./frontmatter.js";
import { sha256 } from "./hashes.js";
import {
  loadFlowPresentations,
  loadModuleDigests,
  loadModulePresentations,
  loadTopicPresentations,
} from "./navigation.js";
import { extractRepoOrientation, PURPOSE_MAX_CHARS } from "./orientation.js";
import type { Module, PathRoleConfig } from "./modules.js";

/** Wiki path of the synthesis page (inside the rule-#1 allowlist). */
export const UNDERSTANDING_REL_PATH = "livewiki/understanding.md";

/** `--only` target that reruns the understanding task of the current evidence. */
export const UNDERSTANDING_ONLY_TARGET = "understanding";

/** batch_tasks target prefix; the full target is `understanding:<evidenceHash>`. */
export const UNDERSTANDING_TASK_PREFIX = "understanding:";

/** Purpose paragraph bounds (the max mirrors orientation's PURPOSE_MAX_CHARS). */
export const UNDERSTANDING_PURPOSE_MIN_CHARS = 40;
export const UNDERSTANDING_PURPOSE_MAX_CHARS = PURPOSE_MAX_CHARS;

/** Key-surfaces list bounds. */
export const UNDERSTANDING_MAX_SURFACES = 10;
export const UNDERSTANDING_SURFACE_MAX_CHARS = 160;

/** Hard cap for the rendered evidence block embedded in the prompt. */
export const UNDERSTANDING_EVIDENCE_MAX_CHARS = 20_000;

/** Fixed output-token ceiling — the artifact is tiny and anchor-free. */
export const UNDERSTANDING_MAX_OUTPUT_TOKENS = 2_048;

/** Cap for the module digest list in the evidence inventory. */
const UNDERSTANDING_MODULE_DIGEST_CAP = 24;

// ── Evidence inventory ──────────────────────────────────────────────────────

export interface UnderstandingEvidenceModule {
  id: string;
  title: string;
  responsibility: string | null;
}

export interface UnderstandingEvidenceFlow {
  slug: string;
  title: string | null;
  modules: string[];
}

export interface UnderstandingEvidenceTopic {
  slug: string;
  title: string;
  intent: string | null;
}

export interface UnderstandingEvidence {
  /** Accepted product module pages (prioritization order, capped). */
  modules: UnderstandingEvidenceModule[];
  /** Accepted flow pages (slug order). */
  flows: UnderstandingEvidenceFlow[];
  /** Accepted topic pages (slug order). */
  topics: UnderstandingEvidenceTopic[];
  /** Deterministic entry-point hints from the repo root (orientation). */
  surfaces: string[];
  /** README purpose excerpt when present — one evidence input, never the authority. */
  readmePurpose: string | null;
  readmePath: string | null;
  /**
   * Product name from the README's first H1 (orientation), when present —
   * the deterministic product-name pin: without it the model infers the
   * name from directory/wiki paths and can call the product "livewiki"
   * (the name-wobble observed 2026-08-11/12).
   */
  readmeTitle: string | null;
}

/**
 * True when the inventory carries enough verified evidence to synthesize
 * from: at least one accepted wiki page (module/flow/topic) or a README
 * purpose excerpt. An empty inventory is a deterministic no-op (no task,
 * no LLM call), mirroring the topics' small-repo guard.
 */
export function hasUnderstandingBasis(evidence: UnderstandingEvidence): boolean {
  return (
    evidence.modules.length > 0 ||
    evidence.flows.length > 0 ||
    evidence.topics.length > 0 ||
    evidence.readmePurpose !== null
  );
}

/**
 * Builds the closed evidence inventory from the index plan and the wiki on
 * disk. Deterministic: same index + same wiki ⇒ byte-identical evidence.
 */
export async function buildUnderstandingEvidence(opts: {
  repoRoot: string;
  /** Final module plan (walk order). */
  modules: Module[];
  /** Prioritized module plan. */
  ordered: Module[];
  pathRoleConfig?: PathRoleConfig | undefined;
}): Promise<UnderstandingEvidence> {
  const { repoRoot, modules, ordered, pathRoleConfig } = opts;
  const presentations = await loadModulePresentations(repoRoot, modules);
  const digests = await loadModuleDigests(
    repoRoot,
    ordered,
    presentations,
    pathRoleConfig,
    UNDERSTANDING_MODULE_DIGEST_CAP,
  );
  const flowPresentations = await loadFlowPresentations(repoRoot);
  const topicPresentations = await loadTopicPresentations(repoRoot);
  const orientation = await extractRepoOrientation(repoRoot);
  return {
    modules: digests.map((digest) => ({
      id: digest.id,
      title: digest.title,
      responsibility: digest.responsibility,
    })),
    flows: [...flowPresentations.values()].map((flow) => ({
      slug: flow.slug,
      title: flow.title,
      modules: flow.modules,
    })),
    topics: [...topicPresentations.values()].map((topic) => ({
      slug: topic.slug,
      title: topic.title,
      intent: topic.intent,
    })),
    surfaces: orientation.surfaces,
    readmePurpose: orientation.purpose,
    readmePath: orientation.readmePath,
    readmeTitle: orientation.readmeTitle,
  };
}

/**
 * Stable identity of the evidence inventory. The batch task target embeds
 * this hash (`understanding:<hash>`): unchanged evidence on a resume finds
 * the done task and makes ZERO LLM calls; changed evidence yields a new
 * task and one regeneration — the same cheap-idempotence pattern as the
 * topics' `topic:<evidenceHash>` tasks.
 */
export function computeUnderstandingEvidenceHash(evidence: UnderstandingEvidence): string {
  return sha256(
    JSON.stringify({
      modules: evidence.modules,
      flows: evidence.flows,
      topics: evidence.topics,
      surfaces: evidence.surfaces,
      readmePurpose: evidence.readmePurpose,
      readmePath: evidence.readmePath,
      readmeTitle: evidence.readmeTitle,
    }),
  );
}

/**
 * Renders the evidence inventory for the generation prompt, bounded to
 * `maxChars` (truncation is marked explicitly). The prompt builder wraps
 * the result in a safe fence and neutralizes control markers — this
 * function only renders the raw, deterministically-ordered text.
 */
export function renderUnderstandingEvidence(
  evidence: UnderstandingEvidence,
  maxChars: number = UNDERSTANDING_EVIDENCE_MAX_CHARS,
): string {
  const lines: string[] = [];
  lines.push("## Accepted module pages (product modules, prioritization order)");
  if (evidence.modules.length === 0) {
    lines.push("(none)");
  } else {
    for (const module of evidence.modules) {
      lines.push(
        module.responsibility !== null
          ? `- ${module.title} [${module.id}] — ${module.responsibility}`
          : `- ${module.title} [${module.id}]`,
      );
    }
  }
  lines.push("", "## Accepted flow pages");
  if (evidence.flows.length === 0) {
    lines.push("(none)");
  } else {
    for (const flow of evidence.flows) {
      lines.push(
        `- ${flow.title ?? flow.slug} [flows/${flow.slug}.md]` +
          (flow.modules.length > 0 ? ` — modules: ${flow.modules.join(", ")}` : ""),
      );
    }
  }
  lines.push("", "## Accepted topic pages");
  if (evidence.topics.length === 0) {
    lines.push("(none)");
  } else {
    for (const topic of evidence.topics) {
      lines.push(
        topic.intent !== null
          ? `- ${topic.title} — ${topic.intent}`
          : `- ${topic.title}`,
      );
    }
  }
  lines.push("", "## Entry points and surfaces detected at the repository root");
  if (evidence.surfaces.length === 0) {
    lines.push("(none)");
  } else {
    for (const surface of evidence.surfaces) lines.push(`- ${surface}`);
  }
  lines.push("", "## README purpose excerpt (human-written evidence; may be stale — never the authority)");
  lines.push(evidence.readmePurpose ?? "(no README purpose found)");
  lines.push("", "## Product name (from the README's own title — authoritative for naming)");
  lines.push(evidence.readmeTitle ?? "(no README title found)");
  let rendered = lines.join("\n");
  if (rendered.length > maxChars) {
    rendered = rendered.slice(0, maxChars) + "\n(evidence truncated to the character budget)";
  }
  return rendered;
}

// ── Artifact validation (dedicated strict contract — no anchors) ───────────

export type UnderstandingValidationCode =
  | "no_frontmatter" // no --- ... --- at the top
  | "invalid_frontmatter" // frontmatter present but did not parse
  | "missing_owner" // frontmatter `owner:` line is absent
  | "wrong_owner" // owner is set but is not "generated"
  | "anchors_forbidden" // an `anchors` frontmatter key or an lw:anchors marker
  | "model_invented_manual" // an lw:manual block (reserved for humans, rule #6)
  | "missing_h1" // no H1 in the body
  | "multiple_h1" // more than one H1 in the body
  | "missing_purpose" // no paragraph between the H1 and the next heading/EOF
  | "purpose_not_single_paragraph" // extra paragraph(s) after the purpose
  | "purpose_too_short" // purpose below the minimum
  | "purpose_too_long" // purpose above the maximum
  | "unexpected_section" // an H2 other than "Where to look in the code"
  | "unexpected_content" // content after the surfaces list / outside the contract
  | "empty_surfaces_section" // "## Where to look in the code" with no bullets
  | "surfaces_not_a_list" // non-bullet content inside the surfaces section
  | "too_many_surfaces" // more bullets than the cap
  | "surface_too_long" // one bullet above the per-item cap
  | "code_span_forbidden" // backtick inline code or fenced block (no symbol claims)
  | "link_forbidden" // a Markdown link or image (nothing to resolve here)
  | "todo_marker_present"; // literal TODO/TBD-style placeholder

export interface UnderstandingValidationError {
  code: UnderstandingValidationCode;
  message: string;
  location: "frontmatter" | "body" | "global";
  offending?: string;
}

// #30 follow-up: the section heading is plain language — "Key surfaces" is
// insider jargon a lay reader cannot parse. Pages are sticky, so pre-rename
// pages keep the old heading forever: the STRICT validator requires the new
// heading (new generations), while the tolerant reader accepts both.
const SURFACES_HEADING_RE = /^##\s+where to look in the code\s*$/i;
const LEGACY_SURFACES_HEADING_RE = /^##\s+key surfaces\s*$/i;
const H1_RE = /^#\s+\S/;
const H2_RE = /^##\s+\S/;
const ANY_HEADING_RE = /^#{1,6}\s/;
const BULLET_RE = /^-\s+\S/;
const MARKDOWN_LINK_RE = /!?\[[^\]]*\]\([^)]+\)/;
const TODO_PLACEHOLDER_RE = /\b(TODO|TBD|FIXME|XXX|PLACEHOLDER)\b/;
const LW_ANCHORS_RE = /<!--\s*lw:anchors[\s\S]*?-->/;
const LW_MANUAL_RE = /<!--\s*lw:manual\s*-->/;

/**
 * Validates one normalized understanding artifact against the strict
 * contract: frontmatter (`owner: generated`, no `anchors`), H1, exactly one
 * purpose paragraph, and at most one `## Where to look in the code` bullet
 * section. No
 * anchors, no code spans, no Markdown links, no placeholders — the page
 * synthesizes PURPOSE, it does not document symbols. Returns the list of
 * errors; an empty list means valid.
 */
export function validateUnderstandingArtifact(content: string): UnderstandingValidationError[] {
  const errors: UnderstandingValidationError[] = [];
  const push = (
    code: UnderstandingValidationCode,
    message: string,
    location: UnderstandingValidationError["location"],
    offending?: string,
  ): void => {
    errors.push({ code, message, location, ...(offending !== undefined ? { offending } : {}) });
  };

  if (!content.startsWith("---\n")) {
    push("no_frontmatter", "the page does not start with a frontmatter block", "global");
    return errors;
  }
  let body: string;
  let frontmatter: Record<string, unknown> | null;
  try {
    const parsed = parseFrontmatter(content);
    frontmatter = parsed.frontmatter;
    body = parsed.body;
  } catch {
    push("invalid_frontmatter", "the frontmatter block did not parse", "frontmatter");
    return errors;
  }
  if (frontmatter === null) {
    push("invalid_frontmatter", "the frontmatter block did not parse", "frontmatter");
    return errors;
  }
  if (!("owner" in frontmatter)) {
    push("missing_owner", "the frontmatter `owner:` line is absent", "frontmatter");
  } else if (frontmatter["owner"] !== "generated") {
    push(
      "wrong_owner",
      `the frontmatter owner must be "generated", got ${JSON.stringify(frontmatter["owner"])}`,
      "frontmatter",
    );
  }
  if ("anchors" in frontmatter) {
    push(
      "anchors_forbidden",
      "the understanding page synthesizes purpose and carries no anchors — remove the `anchors` frontmatter key",
      "frontmatter",
    );
  }
  if (LW_ANCHORS_RE.test(body)) {
    push(
      "anchors_forbidden",
      "the understanding page synthesizes purpose and carries no anchors — remove the lw:anchors marker",
      "body",
    );
  }
  if (LW_MANUAL_RE.test(body)) {
    push(
      "model_invented_manual",
      "the page contains a <!-- lw:manual --> block; these are reserved for human content (rule #6)",
      "body",
    );
  }

  // Whole-body lexical bans (the contract allows neither code nor links,
  // so there is nothing to mask).
  const backtick = body.indexOf("`");
  if (backtick >= 0 || /^~~~/m.test(body)) {
    push(
      "code_span_forbidden",
      "the page must not use inline code or fenced code blocks — it synthesizes purpose in plain prose and never claims symbols",
      "body",
      body.split("\n").find((line) => line.includes("`") || line.trimStart().startsWith("~~~")),
    );
  }
  const linkMatch = MARKDOWN_LINK_RE.exec(body);
  if (linkMatch !== null) {
    push(
      "link_forbidden",
      "the page must not use Markdown links or images — it is consumed by the quickstart and the README export, which own the routing",
      "body",
      linkMatch[0],
    );
  }
  const todoMatch = TODO_PLACEHOLDER_RE.exec(body);
  if (todoMatch !== null) {
    push(
      "todo_marker_present",
      `the page body contains a "${todoMatch[1]}" placeholder — write concrete content about what the evidence shows instead`,
      "body",
      todoMatch[0],
    );
  }

  // Structure: H1 → one purpose paragraph → optional "## Where to look in
  // the code".
  const lines = body.split("\n");
  const h1Indexes: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (H1_RE.test(lines[i]!.trim())) h1Indexes.push(i);
  }
  if (h1Indexes.length === 0) {
    push("missing_h1", "the page has no H1 title", "body");
    return errors;
  }
  if (h1Indexes.length > 1) {
    push("multiple_h1", "the page has more than one H1 title", "body");
  }
  const h1Index = h1Indexes[0]!;

  // Purpose: the paragraph block immediately after the H1.
  let cursor = h1Index + 1;
  const purposeLines: string[] = [];
  while (cursor < lines.length) {
    const trimmed = lines[cursor]!.trim();
    if (ANY_HEADING_RE.test(trimmed)) break;
    if (trimmed === "") {
      if (purposeLines.length > 0) {
        cursor++;
        break;
      }
      cursor++;
      continue;
    }
    purposeLines.push(trimmed);
    cursor++;
  }
  const purpose = purposeLines.join(" ").replace(/\s+/g, " ").trim();
  if (purpose === "") {
    push("missing_purpose", "no purpose paragraph follows the H1", "body");
  } else {
    if (purpose.length < UNDERSTANDING_PURPOSE_MIN_CHARS) {
      push(
        "purpose_too_short",
        `the purpose paragraph is ${purpose.length} characters (minimum ${UNDERSTANDING_PURPOSE_MIN_CHARS})`,
        "body",
      );
    }
    if (purpose.length > UNDERSTANDING_PURPOSE_MAX_CHARS) {
      push(
        "purpose_too_long",
        `the purpose paragraph is ${purpose.length} characters (maximum ${UNDERSTANDING_PURPOSE_MAX_CHARS})`,
        "body",
      );
    }
  }
  // After the purpose: optional `## Where to look in the code`, then EOF.
  // Anything else (extra paragraphs, other sections) violates the contract.
  let sawSurfaces = false;
  let surfaceCount = 0;
  while (cursor < lines.length) {
    const trimmed = lines[cursor]!.trim();
    if (trimmed === "") {
      cursor++;
      continue;
    }
    if (H2_RE.test(trimmed)) {
      if (!SURFACES_HEADING_RE.test(trimmed) || sawSurfaces) {
        push(
          "unexpected_section",
          `only one "Where to look in the code" H2 section is allowed, got "${trimmed.replace(/^##\s+/, "")}"`,
          "body",
          trimmed,
        );
      } else {
        sawSurfaces = true;
      }
      cursor++;
      continue;
    }
    if (ANY_HEADING_RE.test(trimmed)) {
      push("unexpected_section", `only the "Where to look in the code" H2 section is allowed, got "${trimmed}"`, "body", trimmed);
      cursor++;
      continue;
    }
    if (!sawSurfaces) {
      if (BULLET_RE.test(trimmed)) {
        push(
          "unexpected_content",
          "a bullet list appears outside the Where to look in the code section",
          "body",
          trimmed.length > 80 ? `${trimmed.slice(0, 80)}…` : trimmed,
        );
      } else if (purpose !== "" && purposeLines.length > 0) {
        push(
          "purpose_not_single_paragraph",
          "the purpose must be exactly one paragraph — extra content between the purpose and Where to look in the code is not allowed",
          "body",
          trimmed.length > 80 ? `${trimmed.slice(0, 80)}…` : trimmed,
        );
      } else {
        push("unexpected_content", "content outside the H1/purpose/Where to look in the code contract", "body", trimmed);
      }
      cursor++;
      continue;
    }
    if (!BULLET_RE.test(trimmed)) {
      push(
        "surfaces_not_a_list",
        "the Where to look in the code section must be a flat Markdown bullet list (`- item`)",
        "body",
        trimmed.length > 80 ? `${trimmed.slice(0, 80)}…` : trimmed,
      );
      cursor++;
      continue;
    }
    surfaceCount++;
    const itemText = trimmed.replace(/^-\s+/, "");
    if (itemText.length > UNDERSTANDING_SURFACE_MAX_CHARS) {
      push(
        "surface_too_long",
        `a Where to look in the code bullet is ${itemText.length} characters (maximum ${UNDERSTANDING_SURFACE_MAX_CHARS})`,
        "body",
        itemText.slice(0, 80),
      );
    }
    cursor++;
  }
  if (sawSurfaces && surfaceCount === 0) {
    push("empty_surfaces_section", "the Where to look in the code section has no bullets", "body");
  }
  if (surfaceCount > UNDERSTANDING_MAX_SURFACES) {
    push(
      "too_many_surfaces",
      `the Where to look in the code section has ${surfaceCount} bullets (maximum ${UNDERSTANDING_MAX_SURFACES})`,
      "body",
    );
  }
  return errors;
}

// ── Deterministic length fallback (2026-08-12) ─────────────────────────────

/**
 * Clips `text` at the LAST boundary that fits `max`: sentence punctuation
 * first-class, but also clause separators (" — ", "; ", ", ") because the
 * surfaces bullets are noun phrases without terminators. Returns null when
 * no boundary keeps at least `min` characters (fail-closed: the caller
 * keeps the repair_exhausted failure). Never rewrites — only deletes
 * trailing clauses.
 */
function clipAtClauseBoundary(text: string, max: number, min: number): string | null {
  if (text.length <= max) return text;
  let clipEnd = -1;
  for (const match of text.matchAll(/[.!?。！？]+["'”’)]?(?=\s|$)|[—;,](?=\s)/g)) {
    const end = match.index! + match[0].length;
    if (end > max) break;
    clipEnd = end;
  }
  if (clipEnd < min) return null;
  return text.slice(0, clipEnd).replace(/[\s—;,]+$/u, "").trimEnd();
}

/**
 * Deterministic last resort for an understanding candidate whose remaining
 * failures are ONLY mechanically fixable (purpose_too_long /
 * surface_too_long / code_span_forbidden — the caller checks that). Same
 * failure class as the folder purpose (2026-08-12): models cannot count
 * characters, bounded repairs oscillate at the cap boundary, and MiniMax-M3
 * keeps wrapping file names in inline code despite the ban. The salvage
 * only DELETES: inline-code backticks are unwrapped (the prose text is
 * kept), the purpose is clipped at a sentence boundary, and each oversized
 * bullet at a clause boundary — then the WHOLE contract is re-validated;
 * any residual violation returns null and the task keeps its
 * repair_exhausted failure. Fenced code blocks are refused (not
 * unwrappable prose).
 */
export function salvageUnderstandingCandidate(raw: string): string | null {
  const normalized = raw.replace(/\r\n/g, "\n");
  const fm = /^---\n[\s\S]*?\n---/.exec(normalized)?.[0];
  if (fm === undefined) return null;
  const bodyLines = normalized.slice(fm.length).split("\n");
  // Inline code spans are unwrapped, never rewritten: `text` → text.
  // A fenced block is not prose — refuse the candidate.
  if (/^~~~|^```/m.test(bodyLines.join("\n"))) return null;
  const lines = bodyLines.map((line) => line.replace(/`([^`]*)`/g, "$1"));
  const h1Index = lines.findIndex((line) => H1_RE.test(line.trim()));
  if (h1Index < 0) return null;
  const h1Text = lines[h1Index]!.trim();

  // Purpose: the paragraph block immediately after the H1 (validator rules).
  let cursor = h1Index + 1;
  const purposeLines: string[] = [];
  while (cursor < lines.length) {
    const trimmed = lines[cursor]!.trim();
    if (ANY_HEADING_RE.test(trimmed)) break;
    if (trimmed === "") {
      if (purposeLines.length > 0) {
        cursor++;
        break;
      }
      cursor++;
      continue;
    }
    purposeLines.push(trimmed);
    cursor++;
  }
  const purpose = purposeLines.join(" ").replace(/\s+/g, " ").trim();
  if (purpose === "") return null;
  const clippedPurpose = clipAtClauseBoundary(
    purpose,
    UNDERSTANDING_PURPOSE_MAX_CHARS,
    UNDERSTANDING_PURPOSE_MIN_CHARS,
  );
  if (clippedPurpose === null) return null;

  // Optional surfaces section: heading verbatim, bullets clause-clipped.
  let headingText: string | null = null;
  const bullets: string[] = [];
  for (; cursor < lines.length; cursor++) {
    const trimmed = lines[cursor]!.trim();
    if (trimmed === "") continue;
    if (H2_RE.test(trimmed)) {
      headingText = trimmed;
      continue;
    }
    if (BULLET_RE.test(trimmed)) {
      const item = trimmed.replace(/^-\s+/, "");
      const clipped = clipAtClauseBoundary(item, UNDERSTANDING_SURFACE_MAX_CHARS, 40);
      if (clipped === null) return null;
      bullets.push(clipped);
      continue;
    }
    // Non-bullet content is not a length failure — refuse to rebuild.
    return null;
  }

  const page =
    `${fm}\n\n${h1Text}\n\n${clippedPurpose}\n` +
    (headingText !== null ? `\n${headingText}\n\n${bullets.map((b) => `- ${b}`).join("\n")}\n` : "");
  return validateUnderstandingArtifact(page).length === 0 ? page : null;
}

// ── Tolerant reader (quickstart orientation + README export) ───────────────

export interface UnderstandingSynthesis {
  title: string;
  purpose: string;
  surfaces: string[];
}

/**
 * Tolerant reader for the synthesis page: the H1 title, the first
 * paragraph after it (the purpose), and the surfaces-section bullets.
 * Accepts both the current "Where to look in the code" heading and the
 * pre-#30 "Key surfaces" heading — pages are sticky, so old pages keep the
 * old heading forever.
 * Returns null when the shape is not recognizable — the callers then fall
 * back to the pre-existing orientation chain. Used for pages that already
 * passed validation OR were human-edited (any owner is accepted: a human
 * understanding page is legitimate human evidence, like the README).
 */
export function parseUnderstandingPage(content: string): UnderstandingSynthesis | null {
  let body = content;
  try {
    body = parseFrontmatter(content).body;
  } catch {
    // Unparseable frontmatter: read the raw content tolerantly.
  }
  const lines = body.split("\n");
  const h1Index = lines.findIndex((line) => H1_RE.test(line.trim()));
  if (h1Index < 0) return null;
  const title = lines[h1Index]!.trim().replace(/^#\s+/, "");
  const purposeLines: string[] = [];
  for (let i = h1Index + 1; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();
    if (ANY_HEADING_RE.test(trimmed)) break;
    if (trimmed === "") {
      if (purposeLines.length > 0) break;
      continue;
    }
    purposeLines.push(trimmed);
  }
  const purpose = purposeLines.join(" ").replace(/\s+/g, " ").trim();
  if (purpose === "") return null;
  const surfaces: string[] = [];
  const surfacesIndex = lines.findIndex(
    (line) => SURFACES_HEADING_RE.test(line.trim()) || LEGACY_SURFACES_HEADING_RE.test(line.trim()),
  );
  if (surfacesIndex >= 0) {
    for (let i = surfacesIndex + 1; i < lines.length; i++) {
      const trimmed = lines[i]!.trim();
      if (ANY_HEADING_RE.test(trimmed)) break;
      if (BULLET_RE.test(trimmed)) surfaces.push(trimmed.replace(/^-\s+/, ""));
    }
  }
  return { title, purpose, surfaces };
}

/**
 * Loads the synthesis page from disk. Null when the page is absent,
 * unreadable, or not recognizable — never throws, so the quickstart
 * regeneration degrades to the pre-existing orientation fallback chain
 * byte-for-byte.
 */
export async function loadUnderstandingSynthesis(
  repoRoot: string,
): Promise<UnderstandingSynthesis | null> {
  try {
    if (!(await safeIo.exists(repoRoot, UNDERSTANDING_REL_PATH))) return null;
    const content = await safeIo.readText(repoRoot, UNDERSTANDING_REL_PATH);
    return parseUnderstandingPage(content);
  } catch {
    return null;
  }
}
