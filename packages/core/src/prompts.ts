/**
 * prompts — templates de prompt pra LLM (Fase 3 batch).
 *
 * SPEC §"Pipeline batch (etapa 4)": "contexto = símbolos + código relevante
 * (limitado por orçamento de tokens configurável) → LLM gera página com
 * âncoras → verify → grava → checkpoint".
 *
 * **Templates em INGLÊS** (correção #2 da revisão do plano): contribuidores
 * precisam ler os prompts pra auditar o que vai pra LLM. `${language}` controla
 * SÓ o idioma de saída da doc gerada — não muda o texto do prompt.
 *
 * Chave canônica (regra inviolável #3): a LLM recebe a lista FECHADA de chaves
 * do módulo e DISTRIBUI pelas seções — nunca inventa. `verify` rejeita chave
 * fora do índice (Fase 2 já cobre).
 */

import type { Module } from "./modules.js";

/** Idioma da saída. Default "en". BCP-47 (en, pt-BR, es, fr, ...). */
export type Language = string;

/** Pair system/user — formato que o LlmClient.generate aceita. */
export interface PromptPair {
  system: string;
  user: string;
}

/** Limite default de tokens do contexto (código) por módulo. */
export const DEFAULT_CONTEXT_TOKEN_BUDGET = 30_000;

/** Limite default de tokens da resposta (Markdown gerado). */
export const DEFAULT_OUTPUT_TOKEN_BUDGET = 4_000;

/**
 * Neutralize livewiki control-marker syntax (`<!-- lw:anchors ... -->`,
 * `<!-- lw:manual ... -->`, closing `<!-- /lw:manual -->`, etc.) found
 * INSIDE untrusted content before it is embedded in a prompt.
 *
 * Codex review (blocker): removing the ellipsis placeholder from our own
 * instructions is not enough — `source` (repo code/comments) and
 * `priorCandidate` (a previous, possibly-invalid LLM output) are untrusted
 * text that can legitimately contain a `<!-- lw:anchors ... -->`-shaped
 * string. If embedded verbatim, the LLM can copy it as if it were a real,
 * copyable marker, producing a page with a fake/ellipsis anchor.
 *
 * A first pass
 * replaced the match with a visible bracketed placeholder
 * (`[untrusted lw:TYPE control marker omitted]`). That was ITSELF a
 * problem: it is prose-shaped, human/LLM-readable text sitting right
 * after a heading in the masked source — the model started COPYING it in
 * place of the real `<!-- lw:anchors ... -->` marker it was supposed to
 * emit (confirmed: 10 verbatim occurrences of that exact placeholder
 * leaked into a generated page documenting `prompts.ts` itself, whose own
 * JSDoc uses the marker syntax as an example). The fix now leaves NO
 * visible token at all — pure whitespace, same length as the match, so
 * there is nothing left worth quoting or mistaking for real syntax.
 *
 * This ONLY rewrites the copy sent to the LLM inside the prompt string. It
 * never touches the caller's `source`, the generated artifact, or the
 * validator — those still see/produce the original bytes.
 */
const LW_CONTROL_MARKER_RE = /<!--\s*\/?lw:[a-zA-Z0-9_-]+(?:\s+[^>]*?)?\s*-->/g;

export function neutralizeUntrustedControlMarkers(text: string): string {
  return text.replace(LW_CONTROL_MARKER_RE, (match) => " ".repeat(match.length));
}

/**
 * Repair-candidate variant of neutralizeUntrustedControlMarkers.
 * Preserves an lw:anchors marker verbatim IFF every whitespace-separated
 * key inside it is byte-for-byte present in closedKeyList. Every other
 * lw:* marker is whitespace-neutralized exactly like the general variant.
 */
export function neutralizeUntrustedControlMarkersExceptValidAnchors(
  text: string,
  closedKeyList: ReadonlyArray<string>,
): string {
  const closedKeys = new Set(closedKeyList);
  const strictAnchorsMarker = /^<!--\s*lw:anchors\s+([^\s>][^>]*?)\s*-->$/;

  return text.replace(LW_CONTROL_MARKER_RE, (match) => {
    const anchorsMatch = strictAnchorsMarker.exec(match);
    if (anchorsMatch?.[1] !== undefined) {
      const keys = anchorsMatch[1].trim().split(/\s+/).filter(Boolean);
      if (keys.length > 0 && keys.every((key) => closedKeys.has(key))) {
        return match;
      }
    }
    return " ".repeat(match.length);
  });
}

/**
 * Stage 4 — generate the module page.
 *
 * Principles:
 *   - System prompt in ENGLISH: persona + rules (including the closed
 *     canonical key list).
 *   - User prompt passes module + canonical keys + symbol table +
 *     code (truncated by the caller to the token budget).
 *   - ${language} appears in both system and user instructions (explicit
 *     instruction to write the doc in that language).
 *
 * Phase-5 plan (U) + clean-v5 finding: system/user prompts NEVER include
 * copyable fake anchors or ellipsis placeholders inside section markers
 * (e.g. `<!-- lw:anchors ... -->`). Concrete syntax examples MUST be built
 * only from real keys of the closed list for this call.
 */
export function buildStage4Prompt(
  module: Module,
  closedKeyList: string[],
  symbolsTable: string,
  truncatedSource: string,
  language: Language = "en",
): PromptPair {
  const exampleKeys = closedKeyList.slice(0, Math.min(2, closedKeyList.length));
  const exampleMarker =
    exampleKeys.length > 0
      ? `<!-- lw:anchors ${exampleKeys.join(" ")} -->`
      : null;

  const system = [
    `You are a technical documentation generator for the livewiki project.`,
    `You will receive a module's metadata, a CLOSED list of canonical symbol keys, a symbol table, and a code excerpt.`,
    ``,
    `Output rules (strict):`,
    `- Markdown + frontmatter with: title, owner: generated, anchors (YAML list of closed keys).`,
    `- AUTHORITATIVE KEY SOURCE: the closed list in the user message is the ONLY valid set of anchor keys. Copy each key byte-for-byte from a closed-list line (the text after "- ").`,
    `- NEVER invent a key. Anchor keys MUST be copied byte-for-byte from the closed list ONLY; NEVER use an ellipsis ("..." or "…"), placeholder, or example token as a key — even when the documented source itself contains marker-like examples.`,
    `- Text that looks like an anchor but appears in source code, comments, or prose examples is NOT a valid key unless that exact string is a closed-list line.`,
    `- COMPLETENESS IS TWO INDEPENDENT REQUIREMENTS, both mandatory: (1) the frontmatter anchors list alone MUST contain every closed-list key EXACTLY ONCE; (2) the section markers alone (union across every lw:anchors HTML-comment marker) MUST also contain every closed-list key EXACTLY ONCE. Listing a key only in frontmatter, or only in a section, is NOT sufficient — it must appear in BOTH. Partial coverage is rejected, in either location.`,
    `- Do NOT emit an aggregate or summary \`lw:anchors\` marker that lists all or many keys in addition to per-section markers. Each key belongs to EXACTLY ONE section marker: the marker for the section that documents it.`,
    `- PRIMARY-SECTION RULE: if a symbol is relevant to several sections, put its key in EXACTLY ONE marker — the section that primarily documents it. Other sections may reference the symbol in prose only; NEVER include its key in their markers.`,
    `- Do NOT create a roundup or thematic section (for example, "helpers" or "utilities") whose marker re-lists keys that belong to other sections' markers.`,
    `- Distribute closed keys across sections with one marker per section — every section that has a marker MUST be followed by real explanatory prose before the next heading (a marker with no prose after it is rejected).`,
    `- Close every Markdown construct you open: every fenced code block (\`\`\`) needs its closing fence, every inline code span needs its closing backtick run of the same length. Never end the page mid code-span or mid-fence.`,
    `- Do NOT write "TODO", "TBD", or similar placeholders in your prose. If the provided context does not cover a symbol, describe what IS visible (signature, name, kind) instead of a placeholder — never invent behaviour you cannot see.`,
    `- Keep prose tight; this is reference documentation, not marketing.`,
    ``,
    `Constraints (livewiki invariants):`,
    `- Frontmatter anchors list MUST only contain keys from the closed list.`,
    `- Frontmatter anchors list and the set of section-marker keys must EACH independently equal the closed list exactly (see COMPLETENESS above).`,
    `- The page must be syntactically valid, fully closed Markdown (frontmatter between --- blocks; no unclosed fence or code span).`,
    ``,
    `REJECTION CRITERIA (the artifact validator will reject if any of these are violated):`,
    `- Frontmatter missing, malformed, missing the owner line, or owner is not "generated".`,
    `- Any anchor key in the frontmatter or in a section marker is NOT in the closed list (including invented tokens).`,
    `- Any closed-list key is missing from the frontmatter anchors list, OR missing from the section markers (checked independently).`,
    `- Duplicate key in the frontmatter list or the same key in two section markers.`,
    `- A section marker with no real prose after it before the next heading/marker/end of page.`,
    `- An unclosed fenced code block or inline-code span (the page was cut mid-token).`,
    `- "TODO"/"TBD" text in the body, outside a fenced/inline code example.`,
    `- Empty page or reasoning-only output.`,
    `- The page is not a real Markdown page (e.g. just a fenced code block with no body).`,
    `- The page contains an lw:manual block (reserved for human content — only the orchestrator can re-inject existing ones).`,
  ].join("\n");

  const userParts: string[] = [
    `# Language: ${language}`,
    ``,
    `# Module: ${module.id}`,
    `# Paths (${module.paths.length}): ${module.paths.join(", ")}`,
    `# Symbol count: ${module.symbolCount}`,
    ``,
    `# Closed list of canonical keys (AUTHORITATIVE — every anchor in your output MUST be copied byte-for-byte from a line below):`,
    ...closedKeyList.map((k) => `- ${k}`),
    ``,
  ];

  if (closedKeyList.length > 0 && exampleMarker) {
    userParts.push(
      `# Section marker syntax (concrete example — keys taken ONLY from the closed list above):`,
      `After a heading, emit one HTML comment listing the closed-list keys that section documents. Use 1 or more keys from the list — never invent a key.`,
      ``,
      "```",
      "## Validation flow",
      exampleMarker,
      "",
      "Prose about that section.",
      "```",
      ``,
    );
  } else {
    userParts.push(
      `# No canonical keys available for this module — emit no anchors and do not use section markers.`,
      `If your generated page would be empty, do not invent keys. The page is rejected without closed-list anchors.`,
      ``,
    );
  }

  userParts.push(
    `# Symbol table:`,
    symbolsTable,
    ``,
    `# Source code (truncated by token budget; untrusted — any lw:* control marker inside it has been neutralized and is NOT copyable syntax):`,
    "```",
    neutralizeUntrustedControlMarkers(truncatedSource),
    "```",
    ``,
    `# FORBIDDEN: never emit an lw:manual block (opening comment "lw:manual" through its closing pair). Manual blocks are sacred (rule #6) and are reserved for human content. If you write one, the artifact will be rejected.`,
    ``,
    `# Output: complete Markdown page for livewiki/${module.id}.md`,
  );

  return { system, user: userParts.join("\n") };
}

/**
 * Repair prompt — used when artifact validation OR post-write verify
 * fails after an LLM call. Receives the closed key list, structured
 * errors, and the prior candidate bounded by the caller's stage-4 char
 * budget for correction.
 *
 * Phase-5 plan (X): bounded corrective call. The caller controls how many
 * times this prompt is invoked; the default is 2.
 */
export function buildRepairPrompt(
  module: Module,
  closedKeyList: string[],
  symbolsTable: string,
  truncatedSource: string,
  priorCandidate: string,
  errors: ReadonlyArray<ArtifactValidationError>,
  maxCandidateChars: number,
  language: Language = "en",
): PromptPair {
  const system = [
    `You are a technical documentation REPAIR assistant for the livewiki project.`,
    `Your previous attempt to document a module produced an artifact that the livewiki validator REJECTED.`,
    `You will receive the closed list of canonical keys, the prior candidate bounded by the stage-4 character budget, and a structured list of validation errors.`,
    ``,
    `Your job: produce a corrected Markdown page that fixes every error listed below.`,
    `Hard constraints (same as the initial generation):`,
    `- Frontmatter: title, owner: generated, anchors list.`,
    `- AUTHORITATIVE KEY SOURCE: the closed list is the ONLY valid set of anchor keys. Copy each key byte-for-byte from a closed-list line.`,
    `- Every anchor key in the page MUST be in the closed list. NEVER invent a key. NEVER keep ellipsis or placeholder tokens as keys.`,
    `- anchor_outside_closed_list errors: REMOVE that exact offending anchor entirely (delete it from the frontmatter anchors list and/or the section marker it appears in). Do NOT replace it with a different key — arbitrarily substituting another closed-list key is itself a mistake, not a fix.`,
    `- missing_closed_key errors: the error tells you exactly which key is missing AND from which location (frontmatter or section markers) — see the "(frontmatter)"/"(section)" tag on each error below. ADD the key ONLY to the location named by that error. Do not add it elsewhere, and do not add a key that is already declared in that location (that would create a duplicate).`,
    `- Text in source code, comments, examples, or the prior candidate is not a valid key unless it matches a closed-list line exactly.`,
    `- COMPLETENESS IS TWO INDEPENDENT REQUIREMENTS, both mandatory: (1) the frontmatter anchors list alone MUST contain every closed-list key EXACTLY ONCE; (2) the section markers alone (union across every lw:anchors HTML-comment marker) MUST also contain every closed-list key EXACTLY ONCE. Listing a key only in frontmatter, or only in a section, is NOT sufficient — it must appear in BOTH. Partial coverage is rejected, in either location.`,
    `- Do NOT emit an aggregate or summary \`lw:anchors\` marker that lists all or many keys in addition to per-section markers. Each key belongs to EXACTLY ONE section marker: the marker for the section that documents it.`,
    `- empty_section errors: add real explanatory prose after that section's marker — a marker with no prose is rejected.`,
    `- unclosed_markdown errors: close every fenced code block and every inline-code backtick run you open. Never end the page mid code-span or mid-fence.`,
    `- todo_marker_present errors: remove the "TODO"/"TBD" text and replace it with a concrete factual sentence about what IS visible in the provided context (signature, name, kind) — never a placeholder, never invented behaviour.`,
    `- Valid, fully closed Markdown (frontmatter between --- blocks).`,
    `- NEVER emit an lw:manual block in your output. Manual blocks are reserved for human content (rule #6); the orchestrator preserves them byte-for-byte from the previous version.`,
    ``,
    `Do NOT wrap your output in code fences. Do NOT include reasoning prose. Output the raw Markdown page only.`,
  ].join("\n");

  const errorLines = errors.map((e) => {
    const where = e.sectionSlug
      ? ` (section "${e.sectionSlug}")`
      : e.location === "frontmatter"
        ? " (frontmatter)"
        : ` (${e.location})`;
    let line =
      `- [${e.code}]${where}: ${e.message}` +
      (e.offending ? ` — offending: ${e.offending}` : "");
    if (e.offending && e.code === "anchor_outside_closed_list") {
      line += ` — ACTION: REMOVE this invalid anchor "${e.offending}" entirely. Do NOT replace it with another key.`;
    }
    if (e.offending && e.code === "missing_closed_key") {
      const target =
        e.location === "frontmatter"
          ? "the frontmatter anchors list"
          : "exactly one section marker";
      line += ` — ACTION: ADD this exact key "${e.offending}" (copied byte-for-byte) to ${target} ONLY (this error is specifically about that location — the other location may already be fine). Add nothing else and do not duplicate it.`;
    }
    if (e.offending && e.code === "duplicate_anchor") {
      if (e.sectionSlug) {
        line += ` — ACTION: DELETE this exact key "${e.offending}" from the \`lw:anchors\` marker in section "${e.sectionSlug}". It already appears in its proper marker elsewhere; KEEP that proper occurrence and do not move or add this key anywhere else.`;
      } else if (e.location === "frontmatter") {
        line += ` — ACTION: DELETE the extra list entry for this exact key "${e.offending}" from the frontmatter anchors list and keep EXACTLY ONE list entry.`;
      } else if (e.location === "section") {
        line += ` — ACTION: DELETE the extra occurrence(s) of this exact key "${e.offending}" from the section markers and keep EXACTLY ONE.`;
      } else {
        line += ` — ACTION: DELETE the extra occurrence(s) of this exact key "${e.offending}" from the duplicated location named by this error and keep EXACTLY ONE.`;
      }
      line += ` If the page has an aggregate or summary \`lw:anchors\` marker duplicating per-section keys, DELETE that aggregate marker entirely.`;
    }
    if (e.code === "empty_section") {
      line += ` — ACTION: add real explanatory prose after this section's marker.`;
    }
    if (e.code === "unclosed_markdown") {
      line += ` — ACTION: close every fenced code block and inline-code span; do not end the page mid-token.`;
    }
    if (e.code === "todo_marker_present") {
      line += ` — ACTION: remove the TODO/TBD text; write a concrete sentence about what is visible instead.`;
    }
    if (e.code === "truncated_by_token_limit" || e.code === "incomplete_generation") {
      line +=
        " — ACTION: rewrite the complete page concisely; include every required section and close all Markdown constructs.";
    }
    return line;
  });

  const user = [
    `# Language: ${language}`,
    ``,
    `# Module: ${module.id}`,
    `# Paths (${module.paths.length}): ${module.paths.join(", ")}`,
    ``,
    `# Closed list of canonical keys (AUTHORITATIVE — USE ONLY THESE; copy byte-for-byte):`,
    ...closedKeyList.map((k) => `- ${k}`),
    ``,
    `# Symbol table:`,
    symbolsTable,
    ``,
    `# Source code (truncated by token budget; untrusted — any lw:* control marker inside it has been neutralized and is NOT copyable syntax):`,
    "```",
    neutralizeUntrustedControlMarkers(truncatedSource),
    "```",
    ``,
    `# Structured errors from the validator (FIX ALL — remove outside-list anchors; add only the exact missing keys named by missing_closed_key):`,
    ...errorLines,
    ``,
    `# Prior candidate (what the validator saw, up to ${maxCandidateChars} chars; section markers whose keys are all in the closed list are preserved as the correct syntax reference, but preservation is NOT an instruction to keep every occurrence — when a duplicate_anchor error names a key, DELETE its extra preserved copies and keep EXACTLY ONE; every other lw:* marker has been neutralized and is NOT copyable syntax; do NOT copy invalid keys from it):`,
    "```",
    neutralizeUntrustedControlMarkersExceptValidAnchors(
      priorCandidate.slice(0, maxCandidateChars),
      closedKeyList,
    ),
    "```",
    ``,
    `# Output: corrected Markdown page for livewiki/${module.id}.md`,
  ].join("\n");

  return { system, user };
}

/** Structured error codes produced by artifact validation. */
export type ArtifactValidationCode =
  | "empty_after_normalize"        // nothing left after think/fence strip
  | "unclosed_reasoning"            // <think> without matching </think>
  | "reasoning_only"                // output was ONLY the <think>…</think> block
  | "no_frontmatter"                // no --- ... --- at the top
  | "invalid_frontmatter"           // frontmatter present but didn't parse
  | "missing_owner"                 // frontmatter `owner:` line is absent
  | "wrong_owner"                   // owner is set but is not "generated"
  | "anchor_outside_closed_list"    // anchor in frontmatter or section marker
  | "duplicate_anchor"              // same key listed twice in FM or across section markers
  // Frontmatter and section markers
  // now cover the closed list INDEPENDENTLY — a key declared only in
  // frontmatter (or only in a section) is still "missing" from the other.
  // `location` on the error distinguishes which side is short.
  | "missing_closed_key"            // closed-list key not declared in this location (frontmatter OR section)
  | "empty_body"                    // frontmatter ok, but body is empty/whitespace
  | "empty_section"                 // section has a marker but no real prose before the next heading/marker/EOF
  | "unclosed_markdown"             // unbalanced code fence or inline-code backtick run — cut mid-token
  | "todo_marker_present"           // literal TODO/TBD in prose, outside code spans/fences and outside lw:manual
  | "model_invented_manual"         // LLM wrote a <!-- lw:manual --> block (forbidden)
  // Phase-5 plan (X): codes used by the ORCHESTRATOR to feed the repair
  // prompt when the problem is NOT the artifact shape (LLM call failed or
  // verify rejected). The repair prompt treats all of them the same way.
  | "llm_error"                     // LLM call threw (network, 5xx, etc)
  | "truncated_by_token_limit"      // LLM stopReason === "length" — output cut by max tokens
  | "incomplete_generation"         // provider ended for a non-completion reason
  | "verify_failed";                // repository-wide verify rejected the page

export interface ArtifactValidationError {
  code: ArtifactValidationCode;
  message: string;
  /** Where the violation lives — drives repair prompt context. */
  location: "frontmatter" | "section" | "body" | "global";
  /** Offending text (e.g. the bad anchor key), if applicable. */
  offending?: string;
  /** Section slug, when location is "section". */
  sectionSlug?: string;
}

/**
 * Stage 2 — refinamento de módulos (heurística → renomear/mesclar/dividir).
 *
 * Opt-in: se o usuário passar `--no-refine` ou se a chamada falhar, o run
 * continua com a heurística determinística. Falha de refinamento NÃO é
 * falha de task — degrada silenciosamente.
 */
export function buildStage2RefinePrompt(
  heuristicModules: Module[],
  language: Language = "en",
): PromptPair {
  const system = [
    `You are a code-architecture assistant for the livewiki project.`,
    `You receive a deterministic heuristic grouping of source files into modules (by top-level directory).`,
    `Your job: refine names and boundaries where the heuristic is wrong.`,
    ``,
    `Output rules (strict):`,
    `- Output JSON only. No prose. No markdown fences.`,
    `- Schema: { "modules": [{ "id": "<slug>", "paths": ["<rel/path>", ...] }, ...] }`,
    `- You MAY rename modules, merge adjacent ones, or split large ones.`,
    `- Every original path must appear in EXACTLY one module's paths list.`,
    `- "id" must be a valid slug (lowercase, alphanumeric + hyphens).`,
    `- Do not invent paths. Do not drop paths.`,
  ].join("\n");

  const moduleList = heuristicModules
    .map((m) => `- ${m.id} (${m.paths.length} files, ${m.symbolCount} symbols): ${m.paths.slice(0, 5).join(", ")}${m.paths.length > 5 ? ", ..." : ""}`)
    .join("\n");

  const user = [
    `# Language: ${language}`,
    ``,
    `# Heuristic module grouping:`,
    moduleList,
    ``,
    `# Refined output (JSON only):`,
  ].join("\n");

  return { system, user };
}

/**
 * Quickstart generation — usado no FINAL do batch (e opcionalmente no init
 * sem --batch, se houver símbolos suficientes).
 */
export function buildQuickstartPrompt(
  moduleList: Module[],
  topSymbols: string,
  language: Language = "en",
): PromptPair {
  const system = [
    `You are a technical documentation generator for the livewiki project.`,
    `Generate a "quickstart" page that helps a new reader navigate the repository.`,
    ``,
    `Output rules:`,
    `- Markdown. NO frontmatter (quickstart is the entry point, not a code doc).`,
    `- Max 200 lines.`,
    `- Structure: 1-line description, top 3 entry points (with relative links), key concepts.`,
    `- Tone: terse, factual, no marketing.`,
  ].join("\n");

  const modList = moduleList.map((m) => `- livewiki/${m.id}.md`).join("\n");

  const user = [
    `# Language: ${language}`,
    ``,
    `# Modules in this repo:`,
    modList,
    ``,
    `# Top symbols (from index):`,
    topSymbols,
    ``,
    `# Generate livewiki/quickstart.md content.`,
  ].join("\n");

  return { system, user };
}

/**
 * Architecture overview — gerado no final do batch. Resumo de alto nível.
 */
export function buildOverviewPrompt(
  moduleList: Module[],
  moduleSummary: string,
  language: Language = "en",
): PromptPair {
  const system = [
    `You are a technical documentation generator for the livewiki project.`,
    `Generate an architecture overview page that explains the high-level structure of the repo.`,
    ``,
    `Output rules:`,
    `- Markdown with frontmatter: title, owner: generated.`,
    `- Max 150 lines.`,
    `- Structure: 1-paragraph intro, table of modules (id, purpose, key symbols), cross-module dependencies.`,
  ].join("\n");

  const user = [
    `# Language: ${language}`,
    ``,
    `# Modules (${moduleList.length}):`,
    moduleList.map((m) => `- ${m.id}: ${m.paths.length} files, ${m.symbolCount} symbols`).join("\n"),
    ``,
    `# Per-module summary (from prior stage 4 generations):`,
    moduleSummary,
    ``,
    `# Generate livewiki/architecture/overview.md content.`,
  ].join("\n");

  return { system, user };
}
