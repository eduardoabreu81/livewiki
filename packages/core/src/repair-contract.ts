/**
 * repair-contract — Etapa 2a: the closed repair contract.
 *
 * Single source of truth mapping every `ArtifactValidationCode` (including
 * the five `verify` issue codes) to exactly one of two dispositions, per
 * page kind:
 *
 *   - a SUPPORTED_FIX directive: the exact ACTION text the repair prompt
 *     renders for that code (ported verbatim from the three historical
 *     if-chains in `prompts.ts` where a directive already existed); or
 *   - an UNCLASSIFIED entry with a one-line reason: no supported repair
 *     exists — the code is report-only and is never repaired by guessing
 *     (e.g. `manual_block_altered`: human content, rule #6).
 *
 * Absence from both maps is a compile-time/runtime contract violation: the
 * exhaustiveness test (`repair-contract.test.ts`) asserts every code appears
 * in exactly one of the two maps for every page kind.
 *
 * The mechanical repair code sets (`MECHANICAL_STAGE4_CODES`,
 * `MECHANICAL_UPPER_BOUND_CODES`) are imported from `artifact-repair.ts` —
 * one list, no drift between the mechanical layer and the prompt layer.
 */

import type {
  ArtifactValidationCode,
  ArtifactValidationError,
} from "./prompts.js";
import {
  MECHANICAL_STAGE4_CODES,
  MECHANICAL_UPPER_BOUND_CODES,
} from "./artifact-repair.js";

export type PageKind = "module" | "flow" | "topic";

export const PAGE_KINDS = ["module", "flow", "topic"] as const satisfies readonly PageKind[];

export interface FixContext {
  /** Neutralized offending text, when the error carries one. */
  offending?: string;
  /** Error location ("frontmatter" | "section" | "body" | "global"). */
  location?: string;
  /** Section slug, when the error is section-scoped. */
  sectionSlug?: string;
  /** Neutralized validator message (untrusted but marker-safe). */
  detail?: string;
  /**
   * Topic-only: resolves a key's deterministic assigned-section label from
   * the caller's key-section map. Absent when the caller supplied no map.
   */
  assignedSectionLabel?: (key: string) => string | undefined;
}

/**
 * Renders the ACTION text for one error instance. Returns "" when the
 * directive does not apply to this exact instance (e.g. a directive that
 * names the offending key renders nothing when the error carries none) —
 * the caller then emits the bare error line, exactly as before.
 */
export type FixDirective = (ctx: FixContext) => string;

/**
 * Runtime mirror of the `ArtifactValidationCode` union. The `satisfies`
 * clause plus the `AssertExact` check below make a missing or extra entry a
 * COMPILE error; the exhaustiveness test then walks this list at runtime.
 */
export const ALL_ARTIFACT_VALIDATION_CODES = [
  "empty_after_normalize",
  "unclosed_reasoning",
  "reasoning_only",
  "no_frontmatter",
  "invalid_frontmatter",
  "missing_owner",
  "wrong_owner",
  "missing_page_opening",
  "title_equals_module_id",
  "anchor_outside_closed_list",
  "duplicate_anchor",
  "missing_closed_key",
  "empty_body",
  "empty_section",
  "unclosed_markdown",
  "todo_marker_present",
  "model_invented_manual",
  "invalid_flow_diagram",
  "flow_diagram_too_large",
  "anchor_in_disallowed_section",
  "anchor_missing_in_required_section",
  "anchor_missing_required_tier",
  "topic_too_long",
  "topic_code_fence",
  "topic_frontmatter_mismatch",
  "topic_related_link_mismatch",
  "topic_insufficient_product_evidence",
  "topic_source_link",
  "auxiliary_page_not_compact",
  "module_diagram_placeholder",
  "llm_error",
  "truncated_by_token_limit",
  "incomplete_generation",
  "verify_failed",
  // Etapa 2a: the five real verify issue codes (previously collapsed into
  // `verify_failed` by `verifyIssuesToValidationErrors`).
  "broken_anchor",
  "broken_internal_link",
  "invalid_mermaid_diagram",
  "manual_block_altered",
  "missing_wiki_path",
] as const satisfies readonly ArtifactValidationCode[];

type AssertExact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
// Compile-time exhaustiveness: the runtime list and the union must be the
// same set. A new union member without a list entry (or vice versa) fails
// the build here.
const _allCodesExact: AssertExact<
  (typeof ALL_ARTIFACT_VALIDATION_CODES)[number],
  ArtifactValidationCode
> = true;
void _allCodesExact;

// ---------------------------------------------------------------------------
// Shared directive texts (identical across the kinds that use them).
// ---------------------------------------------------------------------------

/** Module/flow variant: names the offending key; nothing without one. */
const REMOVE_OUTSIDE_LIST_ANCHOR: FixDirective = (ctx) => {
  if (ctx.offending === undefined) return "";
  if (ctx.offending === "…" || ctx.offending === "...") {
    return `The \`lw:anchors\` marker was abbreviated with "${ctx.offending}". REMOVE the ellipsis and rewrite that marker with every key for that section written in full, one by one, copied byte-for-byte from the closed list. NEVER substitute another key for the ellipsis or add an arbitrary key.`;
  }
  return `REMOVE this invalid anchor "${ctx.offending}" entirely. Do NOT replace it with another key.`;
};

const MODULE_DUPLICATE_ANCHOR: FixDirective = (ctx) => {
  if (ctx.offending === undefined) return "";
  let text: string;
  if (ctx.sectionSlug !== undefined) {
    text = `DELETE this exact key "${ctx.offending}" from the \`lw:anchors\` marker in section "${ctx.sectionSlug}". It already appears in its proper marker elsewhere; KEEP that proper occurrence and do not move or add this key anywhere else.`;
  } else if (ctx.location === "frontmatter") {
    text = `DELETE the extra list entry for this exact key "${ctx.offending}" from the frontmatter anchors list and keep EXACTLY ONE list entry.`;
  } else if (ctx.location === "section") {
    text = `DELETE the extra occurrence(s) of this exact key "${ctx.offending}" from the section markers and keep EXACTLY ONE.`;
  } else {
    text = `DELETE the extra occurrence(s) of this exact key "${ctx.offending}" from the duplicated location named by this error and keep EXACTLY ONE.`;
  }
  return text + ` If the page has an aggregate or summary \`lw:anchors\` marker duplicating per-section keys, DELETE that aggregate marker entirely.`;
};

const FLOW_DUPLICATE_ANCHOR: FixDirective = (ctx) => {
  if (ctx.offending === undefined) return "";
  if (ctx.sectionSlug !== undefined) {
    return `DELETE this exact key "${ctx.offending}" from the \`lw:anchors\` marker in section "${ctx.sectionSlug}". It already appears in its proper marker elsewhere; KEEP that proper occurrence and do not move or add this key anywhere else.`;
  }
  if (ctx.location === "frontmatter") {
    return `DELETE the extra list entry for this exact key "${ctx.offending}" from the frontmatter anchors list and keep EXACTLY ONE list entry.`;
  }
  return `DELETE the extra occurrence(s) of this exact key "${ctx.offending}" and keep EXACTLY ONE.`;
};

const EMPTY_SECTION_MODULE_FLOW: FixDirective = () =>
  `add real explanatory prose after this section's marker.`;

const UNCLOSED_MARKDOWN: FixDirective = () =>
  `close every fenced code block and inline-code span; do not end the page mid-token.`;

const REWRITE_COMPLETE_PAGE: FixDirective = () =>
  `rewrite the complete page concisely; include every required section and close all Markdown constructs.`;

const MODEL_INVENTED_MANUAL: FixDirective = () =>
  `DELETE the lw:manual block entirely; it is reserved for human content and must never be emitted.`;

const NO_FRONTMATTER: FixDirective = () =>
  `emit a complete valid frontmatter block between --- lines with title, owner: generated, and the anchors list, followed by the page body.`;

const INVALID_FRONTMATTER: FixDirective = () =>
  `fix the frontmatter so it parses and contains the required fields (title, owner: generated, anchors list); keep both --- delimiters.`;

const MISSING_OWNER: FixDirective = () =>
  `add the frontmatter line \`owner: generated\` exactly.`;

const WRONG_OWNER: FixDirective = () =>
  `set the frontmatter owner to exactly \`owner: generated\`.`;

const EMPTY_BODY: FixDirective = () =>
  `write the full page body after the frontmatter — the required opening and every required anchored section; an empty body is rejected.`;

const REASONING_WRAPPER: FixDirective = () =>
  `output the raw Markdown page only — no reasoning wrapper, no <think> block, no explanatory preamble; the first bytes must be the frontmatter --- delimiter.`;

const VERIFY_FAILED_GENERIC: FixDirective = () =>
  `fix the exact verify issue named in the error.`;

const INVALID_MERMAID: FixDirective = () =>
  `simplify the diagram syntax: use plain node-and-edge Mermaid lines, quote labels that contain special characters, and remove any construct the Mermaid parser rejects.`;

const AUXILIARY_COMPACT: FixDirective = () =>
  `use the compact auxiliary contract — one \`## Reference\` section with one H3 and one grounded sentence per anchored symbol.`;

const TITLE_EQUALS_MODULE_ID: FixDirective = () =>
  `replace the frontmatter title and H1 with a concise human responsibility title. Keep the stable module ID only for structural identity and the output path.`;

/** Roadmap item 22: the module `## Diagram` section is absent or its fence lacks the exact placeholder. */
const MODULE_DIAGRAM_PLACEHOLDER: FixDirective = (ctx) =>
  `SPECIFIC FAILURE: ${ctx.detail}. Write ONE \`## Diagram\` H2 section immediately after \`How it fits\` and before the implementation sections, containing exactly one \`\`\`mermaid fenced block with the real module-granularity diagram inside (files, classes, or components as nodes) — never a \`%% livewiki/...\` placeholder comment: the orchestrator extracts your diagram and substitutes the on-disk placeholder itself.`;

/** Roadmap item 22: the model-drawn module diagram broke the node/edge budget. */
const MODULE_DIAGRAM_TOO_LARGE: FixDirective = () =>
  `the companion diagram exceeds the configured node/edge budget. Simplify it: merge related nodes, drop secondary edges, and keep module granularity (files, classes, or components — never one node per symbol).`;

// ---------------------------------------------------------------------------
// SUPPORTED_FIXES — per-kind directive maps.
// ---------------------------------------------------------------------------

const MODULE_FIXES: Partial<Record<ArtifactValidationCode, FixDirective>> = {
  empty_after_normalize: REASONING_WRAPPER,
  unclosed_reasoning: REASONING_WRAPPER,
  reasoning_only: REASONING_WRAPPER,
  no_frontmatter: NO_FRONTMATTER,
  invalid_frontmatter: INVALID_FRONTMATTER,
  missing_owner: MISSING_OWNER,
  wrong_owner: WRONG_OWNER,
  missing_page_opening: (ctx) =>
    `SPECIFIC FAILURE: ${ctx.detail}. Replace the opening after frontmatter with the complete required H1, one responsibility sentence, \`When to use this page\` with two to four verb-led bullets, and one or more \`How it fits\` prose paragraphs, in that order and before the first implementation section. Put no \`lw:anchors\` marker in the opening.`,
  title_equals_module_id: TITLE_EQUALS_MODULE_ID,
  anchor_outside_closed_list: REMOVE_OUTSIDE_LIST_ANCHOR,
  duplicate_anchor: MODULE_DUPLICATE_ANCHOR,
  // Rendered grouped by location in the builder; this is the fallback for a
  // stray non-groupable instance.
  missing_closed_key: () =>
    `this exact closed-list key is missing from the named location. ADD it byte-for-byte to that location ONLY — never to both, never as a duplicate, and never as an aggregate summary marker.`,
  empty_body: EMPTY_BODY,
  empty_section: EMPTY_SECTION_MODULE_FLOW,
  unclosed_markdown: UNCLOSED_MARKDOWN,
  todo_marker_present: () =>
    `remove the TODO/TBD text; write a concrete sentence about what is visible instead. If the module recognizes the literal token, write it as inline code (\`TODO\` / \`TBD\`).`,
  model_invented_manual: MODEL_INVENTED_MANUAL,
  auxiliary_page_not_compact: AUXILIARY_COMPACT,
  // Roadmap item 22 (moduleDiagrams): the module diagram gate is LIVE for
  // module pages — the model draws the diagram, so prompt repair applies.
  module_diagram_placeholder: MODULE_DIAGRAM_PLACEHOLDER,
  invalid_flow_diagram: INVALID_MERMAID,
  flow_diagram_too_large: MODULE_DIAGRAM_TOO_LARGE,
  truncated_by_token_limit: REWRITE_COMPLETE_PAGE,
  incomplete_generation: REWRITE_COMPLETE_PAGE,
  verify_failed: VERIFY_FAILED_GENERIC,
  broken_anchor: () =>
    `the named anchor does not resolve to any indexed symbol. Point the citation at the exact closed-list key of the symbol the prose documents, or remove it — the frontmatter anchors list and the section markers must still cover the closed list exactly.`,
  broken_internal_link: () =>
    `correct the named internal link so its target resolves to an existing wiki page relative to this page's directory.`,
  invalid_mermaid_diagram: INVALID_MERMAID,
};

const FLOW_FIXES: Partial<Record<ArtifactValidationCode, FixDirective>> = {
  empty_after_normalize: REASONING_WRAPPER,
  unclosed_reasoning: REASONING_WRAPPER,
  reasoning_only: REASONING_WRAPPER,
  no_frontmatter: NO_FRONTMATTER,
  invalid_frontmatter: INVALID_FRONTMATTER,
  missing_owner: MISSING_OWNER,
  wrong_owner: WRONG_OWNER,
  missing_page_opening: (ctx) => {
    // Etapa 3 run #3 finding (2026-07-26): the flow opening validator also
    // emits this code for SECTION-level prose failures ("Purpose" /
    // "Failure and recovery" require prose paragraphs — bullets rejected;
    // "Invariants" accepts prose or bullets). The page-structure directive
    // alone gave the model no actionable fix: two identical failures, then
    // a third attempt that broke other sections (repair_exhausted).
    const sectionProse =
      /page opening "(Purpose|Invariants|Failure and recovery)" must contain/.exec(
        ctx.detail ?? "",
      );
    if (sectionProse !== null) {
      const section = sectionProse[1] as string;
      const form =
        section === "Invariants"
          ? "prose paragraphs or bullets"
          : "one or more prose paragraphs (full sentences — no bullet lists, no tables, no marker-only content)";
      return (
        `SPECIFIC FAILURE: ${ctx.detail}. This is a section-content failure, not a page-structure one — ` +
        `do NOT restructure the page. Directly under the \`${section}\` H2 heading, write ${form} ` +
        `describing that aspect of the flow, and keep the section's \`lw:anchors\` marker and every other section as-is.`
      );
    }
    return `SPECIFIC FAILURE: ${ctx.detail}. Replace the opening after frontmatter with the complete required flow opening: an H1, one responsibility sentence, then the H2 sections \`Purpose\`, \`Ordered flow\` (numbered list), \`Invariants\`, \`Failure and recovery\`, \`Related pages\` — in that order. Do NOT write a \`Diagram\` section — the orchestrator inserts it itself. Put no \`lw:anchors\` marker before \`Purpose\`.`;
  },
  title_equals_module_id: TITLE_EQUALS_MODULE_ID,
  anchor_outside_closed_list: REMOVE_OUTSIDE_LIST_ANCHOR,
  duplicate_anchor: FLOW_DUPLICATE_ANCHOR,
  // Rendered grouped by location in the builder; this is the fallback for a
  // stray non-groupable instance.
  missing_closed_key: () =>
    `make the two sides consistent for this key — ADD it byte-for-byte to the named location ONLY, or REMOVE it from the opposite location (dropping an unneeded citation is a valid fix — the closed list is an upper bound, not an assignment). Do not duplicate it or create an aggregate summary marker.`,
  empty_body: EMPTY_BODY,
  empty_section: EMPTY_SECTION_MODULE_FLOW,
  unclosed_markdown: UNCLOSED_MARKDOWN,
  todo_marker_present: () =>
    `remove the TODO/TBD text; write a concrete sentence about what is visible instead.`,
  model_invented_manual: MODEL_INVENTED_MANUAL,
  anchor_in_disallowed_section: () =>
    `relocate this marker — every \`lw:anchors\` marker must sit inside \`Purpose\`, \`Ordered flow\`, or \`Failure and recovery\` (an H3+ subsection of one of those sections counts); a marker anywhere else, or before the first H2, is rejected. MOVE its keys to the marker of the allowed section that documents them, or DROP the marker if those keys are already cited there — keeping every cited key exactly once in frontmatter and exactly once across the section markers.`,
  anchor_missing_in_required_section: () =>
    `the named section carries no \`lw:anchors\` marker. ADD one marker inside it citing a closed-list key that section documents and that is not already used in another section's marker (a key may not repeat across markers), and declare the same key in the frontmatter anchors list.`,
  anchor_missing_required_tier: () =>
    `the named semantic group has no cited key. PICK one key from the group keys listed in the error message and cite it in the section that documents it — once in that section's marker AND once in the frontmatter anchors list; if the key is already declared on one side, ADD it to the other side instead of duplicating it.`,
  truncated_by_token_limit: REWRITE_COMPLETE_PAGE,
  incomplete_generation: REWRITE_COMPLETE_PAGE,
  verify_failed: VERIFY_FAILED_GENERIC,
  broken_anchor: () =>
    `the named anchor does not resolve to any indexed symbol. Point the citation at the exact closed-list key of the symbol the prose documents, or drop the citation from both the frontmatter anchors list and the section marker — the two sides must stay consistent.`,
  broken_internal_link: () =>
    `every link target must resolve from this page's directory — the flows hub link in \`Related pages\` must be the bare \`index.md\` target (NEVER \`../index.md\`, \`./index.md\`, or any other path), while module pages keep the \`../<moduleId>/index.md\` form.`,
  invalid_mermaid_diagram: INVALID_MERMAID,
};

const TOPIC_FIXES: Partial<Record<ArtifactValidationCode, FixDirective>> = {
  empty_after_normalize: REASONING_WRAPPER,
  unclosed_reasoning: REASONING_WRAPPER,
  reasoning_only: REASONING_WRAPPER,
  no_frontmatter: NO_FRONTMATTER,
  invalid_frontmatter: INVALID_FRONTMATTER,
  missing_owner: MISSING_OWNER,
  wrong_owner: WRONG_OWNER,
  missing_page_opening: (ctx) =>
    `SPECIFIC FAILURE: ${ctx.detail}. Rewrite the opening to match the topic contract: an H1 equal to the accepted title, exactly one reader-problem sentence, then the H2 sections \`Purpose\`, \`When to use this page\`, \`Behavioral contract\`, \`Failure and recovery\`, \`Change map\`, \`Related pages\` — in that order. Put no \`lw:anchors\` marker before \`Purpose\`.`,
  anchor_outside_closed_list: () =>
    `REMOVE this invalid anchor entirely (frontmatter list and/or section marker). Do NOT substitute another key.`,
  duplicate_anchor: (ctx) => {
    const label =
      ctx.offending !== undefined ? ctx.assignedSectionLabel?.(ctx.offending) : undefined;
    return label !== undefined
      ? `DELETE this exact key from every section marker EXCEPT "${label}" — that is its one authoritative section per the Section assignment table. Keep exactly one occurrence, there.`
      : `DELETE the extra occurrence(s) of this exact key and keep EXACTLY ONE — one in frontmatter, one in a single section marker.`;
  },
  missing_closed_key: () =>
    `this key is cited on only one side. ADD it to the missing side (frontmatter anchors list OR a section marker) byte-for-byte, or REMOVE it from the side where it currently appears — do not duplicate it.`,
  empty_body: EMPTY_BODY,
  empty_section: () =>
    `add real explanatory prose after this section's marker before the next heading.`,
  unclosed_markdown: UNCLOSED_MARKDOWN,
  todo_marker_present: () =>
    `remove the TODO/TBD text; write a concrete sentence about what is visible instead.`,
  model_invented_manual: MODEL_INVENTED_MANUAL,
  anchor_in_disallowed_section: () =>
    `relocate this marker — topic pages allow \`lw:anchors\` markers only inside \`Purpose\`, \`When to use this page\`, \`Behavioral contract\`, \`Failure and recovery\`, or \`Change map\` (an H3+ subsection of one of those sections counts). MOVE its keys to the marker of the allowed section that documents them, or DROP the marker if those keys are already cited there — keeping every cited key exactly once in frontmatter and exactly once across the section markers.`,
  anchor_missing_in_required_section: () =>
    `this section carries no \`lw:anchors\` marker. ADD one marker inside it citing a closed-list key this section documents and that is not already used in another section's marker, and declare that same key once in the frontmatter anchors list.`,
  anchor_missing_required_tier: () =>
    `pick one key from the group named in the error message and cite it in the section that documents it — once in that section's marker AND once in the frontmatter anchors list.`,
  topic_too_long: () =>
    `cut prose until the page is at most 1,400 words; keep the contract, drop padding.`,
  topic_code_fence: () =>
    `remove the non-Mermaid fenced code block; name symbols and link to their module pages instead of copying implementations.`,
  topic_frontmatter_mismatch: () =>
    `set frontmatter \`intent\`/\`modules\`/\`flows\` to EXACTLY the accepted values given above — do not add, drop, or reorder entries.`,
  topic_related_link_mismatch: () =>
    `rewrite \`Related pages\` to link exactly the accepted modules/flows/diagrams/topics-hub paths given above — no more, no fewer.`,
  topic_insufficient_product_evidence: () =>
    `cite more non-test product symbols from the closed list (in the section that documents them) until at least 75% of cited keys are product symbols; drop a test-only citation if needed instead of adding an unrelated one.`,
  topic_source_link: (ctx) =>
    ctx.offending !== undefined
      ? `rewrite this citation "${ctx.offending}": a Markdown link to a source path does not resolve for readers. Name the symbol as inline code with its exact closed-list key (e.g. \`path#symbol\`), or link to the module page that documents it (\`../<moduleId>/index.md\`). Keep every lw:anchors marker and the frontmatter anchors list unchanged.`
      : "",
  auxiliary_page_not_compact: AUXILIARY_COMPACT,
  truncated_by_token_limit: REWRITE_COMPLETE_PAGE,
  incomplete_generation: REWRITE_COMPLETE_PAGE,
  verify_failed: VERIFY_FAILED_GENERIC,
  broken_anchor: () =>
    `the named anchor does not resolve to any indexed symbol. Point the citation at the exact closed-list key of the symbol the prose documents, or drop the citation from both the frontmatter anchors list and the section marker — the two sides must stay consistent.`,
  broken_internal_link: () =>
    `correct the named internal link so its target resolves from the topics directory: module links are exactly \`../<moduleId>/index.md\`, flow links are exactly \`../flows/<flowSlug>.md\`, flow diagrams are exactly \`../diagrams/flow-<flowSlug>.mmd\`, and the topics hub is the bare \`index.md\`.`,
  invalid_mermaid_diagram: INVALID_MERMAID,
};

export const SUPPORTED_FIXES: Record<
  PageKind,
  Partial<Record<ArtifactValidationCode, FixDirective>>
> = {
  module: MODULE_FIXES,
  flow: FLOW_FIXES,
  topic: TOPIC_FIXES,
};

// ---------------------------------------------------------------------------
// UNCLASSIFIED — per-kind report-only codes, with reasons.
// ---------------------------------------------------------------------------

const LLM_ERROR_REASON =
  `the LLM call itself failed; the orchestrator handles this out-of-band (fresh initial attempt or terminal task failure), never through artifact repair.`;
const MANUAL_BLOCK_ALTERED_REASON =
  `human-authored lw:manual content changed; human content is never model-repaired (rule #6) — report it to the operator.`;
const MISSING_WIKI_PATH_REASON =
  `a page recorded in the index is missing from disk; this is repository state, not page prose, so no prompt repair applies.`;
const DEAD_DIAGRAM_GATE_REASON =
  `legacy stage-5 flow diagram-gate code; the flow companion diagram is generated deterministically by the orchestrator, so the model cannot repair it. (Module pages are different: under config moduleDiagrams the model DOES draw the diagram, so the module kind classifies these codes as supported fixes.)`;
const FLOW_PLACEMENT_NOT_MODULE_REASON =
  `flow/topic anchor-placement code; the module validator never emits it.`;
const MODULE_DIAGRAM_NOT_FLOW_TOPIC_REASON =
  `module-page diagram contract code (roadmap item 22, config moduleDiagrams); the flow/topic validator never emits it.`;
const TOPIC_CONTRACT_NOT_MODULE_REASON =
  `topic-page contract code; the module validator never emits it.`;
const TOPIC_CONTRACT_NOT_FLOW_REASON =
  `topic-page contract code; the flow validator never emits it.`;
const AUXILIARY_NOT_FLOW_REASON =
  `non-product module-page compactness code; the flow validator never emits it.`;
const TITLE_RULE_NOT_TOPIC_REASON =
  `module-only presentation code (the topic accepted-title check is topic_frontmatter_mismatch); the topic validator never emits it.`;

export const UNCLASSIFIED: Record<
  PageKind,
  Readonly<Partial<Record<ArtifactValidationCode, string>>>
> = {
  module: {
    llm_error: LLM_ERROR_REASON,
    anchor_in_disallowed_section: FLOW_PLACEMENT_NOT_MODULE_REASON,
    anchor_missing_in_required_section: FLOW_PLACEMENT_NOT_MODULE_REASON,
    anchor_missing_required_tier: FLOW_PLACEMENT_NOT_MODULE_REASON,
    topic_too_long: TOPIC_CONTRACT_NOT_MODULE_REASON,
    topic_code_fence: TOPIC_CONTRACT_NOT_MODULE_REASON,
    topic_frontmatter_mismatch: TOPIC_CONTRACT_NOT_MODULE_REASON,
    topic_related_link_mismatch: TOPIC_CONTRACT_NOT_MODULE_REASON,
    topic_insufficient_product_evidence: TOPIC_CONTRACT_NOT_MODULE_REASON,
    topic_source_link: TOPIC_CONTRACT_NOT_MODULE_REASON,
    manual_block_altered: MANUAL_BLOCK_ALTERED_REASON,
    missing_wiki_path: MISSING_WIKI_PATH_REASON,
  },
  flow: {
    llm_error: LLM_ERROR_REASON,
    invalid_flow_diagram: DEAD_DIAGRAM_GATE_REASON,
    flow_diagram_too_large: DEAD_DIAGRAM_GATE_REASON,
    topic_too_long: TOPIC_CONTRACT_NOT_FLOW_REASON,
    topic_code_fence: TOPIC_CONTRACT_NOT_FLOW_REASON,
    topic_frontmatter_mismatch: TOPIC_CONTRACT_NOT_FLOW_REASON,
    topic_related_link_mismatch: TOPIC_CONTRACT_NOT_FLOW_REASON,
    topic_insufficient_product_evidence: TOPIC_CONTRACT_NOT_FLOW_REASON,
    topic_source_link: TOPIC_CONTRACT_NOT_FLOW_REASON,
    auxiliary_page_not_compact: AUXILIARY_NOT_FLOW_REASON,
    module_diagram_placeholder: MODULE_DIAGRAM_NOT_FLOW_TOPIC_REASON,
    manual_block_altered: MANUAL_BLOCK_ALTERED_REASON,
    missing_wiki_path: MISSING_WIKI_PATH_REASON,
  },
  topic: {
    llm_error: LLM_ERROR_REASON,
    invalid_flow_diagram: DEAD_DIAGRAM_GATE_REASON,
    flow_diagram_too_large: DEAD_DIAGRAM_GATE_REASON,
    title_equals_module_id: TITLE_RULE_NOT_TOPIC_REASON,
    module_diagram_placeholder: MODULE_DIAGRAM_NOT_FLOW_TOPIC_REASON,
    manual_block_altered: MANUAL_BLOCK_ALTERED_REASON,
    missing_wiki_path: MISSING_WIKI_PATH_REASON,
  },
};

// ---------------------------------------------------------------------------
// Rendering helpers used by the three repair-prompt builders and by the
// orchestrator's early-abort check.
// ---------------------------------------------------------------------------

/**
 * Renders the ACTION text for one error under the page kind's contract, or
 * "" when the code is unclassified or the directive does not apply to this
 * exact instance. `messageSafe`/`offendingSafe` MUST already be neutralized
 * by the caller (untrusted text).
 */
export function renderActionDirective(
  kind: PageKind,
  error: ArtifactValidationError,
  ctx: {
    messageSafe: string;
    offendingSafe?: string | undefined;
    assignedSectionLabel?: (key: string) => string | undefined;
  },
): string {
  const directive = SUPPORTED_FIXES[kind][error.code];
  if (directive === undefined) return "";
  return directive({
    ...(ctx.offendingSafe !== undefined ? { offending: ctx.offendingSafe } : {}),
    location: error.location,
    ...(error.sectionSlug !== undefined ? { sectionSlug: error.sectionSlug } : {}),
    detail: ctx.messageSafe,
    ...(ctx.assignedSectionLabel !== undefined
      ? { assignedSectionLabel: ctx.assignedSectionLabel }
      : {}),
  });
}

export interface UnclassifiedRepairError {
  code: ArtifactValidationCode;
  reason: string;
}

/**
 * The distinct unclassified codes present in an error set, first-seen order.
 * Codes absent from BOTH maps are a contract violation; they are tolerated
 * here (treated as unclassified with a generic reason) so a legacy
 * checkpoint code can never crash the loop.
 */
export function collectUnclassified(
  kind: PageKind,
  errors: readonly ArtifactValidationError[],
): UnclassifiedRepairError[] {
  const seen = new Set<ArtifactValidationCode>();
  const out: UnclassifiedRepairError[] = [];
  for (const error of errors) {
    if (seen.has(error.code)) continue;
    seen.add(error.code);
    if (SUPPORTED_FIXES[kind][error.code] !== undefined) continue;
    out.push({
      code: error.code,
      reason: UNCLASSIFIED[kind][error.code] ?? "no supported repair is enumerated for this code.",
    });
  }
  return out;
}

/**
 * Etapa 2a early abort: a non-empty error set where EVERY error is
 * unclassified for the page kind has no supported repair — the orchestrator
 * must not burn a paid repair call on it.
 */
export function isUnrepairableErrorSet(
  kind: PageKind,
  errors: readonly ArtifactValidationError[],
): boolean {
  return errors.length > 0 && collectUnclassified(kind, errors).length === new Set(errors.map((e) => e.code)).size;
}

/**
 * Report-only prompt block for a mixed error set: the unclassified codes the
 * model must NOT try to fix by guessing. Empty when every error has a
 * directive.
 */
export function renderReportOnlyBlock(
  kind: PageKind,
  errors: readonly ArtifactValidationError[],
): string[] {
  const entries = collectUnclassified(kind, errors);
  if (entries.length === 0) return [];
  return [
    `# Errors with NO supported repair (report-only — no supported repair exists for these; do NOT attempt to guess a fix; fix the actionable items above and leave these for human review):`,
    ...entries.map((entry) => `- [${entry.code}]: ${entry.reason}`),
  ];
}

/**
 * `unrepairable` task-failure message: names the target and lists every
 * unclassified code with its reason. Rendered by `batch status` (human and
 * JSON) as the failure error, distinct from `repair_exhausted`.
 */
export function formatUnrepairableMessage(
  kind: PageKind,
  target: string,
  errors: readonly ArtifactValidationError[],
): string {
  const entries = collectUnclassified(kind, errors);
  const lines = entries.map((entry) => `- [${entry.code}]: ${entry.reason}`);
  return (
    `task "${target}" failed without consuming repair budget: every reported error has no supported repair (unrepairable).\n` +
    `Unclassified errors:\n${lines.join("\n")}`
  );
}

// Re-exported so contract consumers (and the exhaustiveness test) can assert
// the mechanical sets against the directive maps without a second import.
export { MECHANICAL_STAGE4_CODES, MECHANICAL_UPPER_BOUND_CODES };
