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
 * Phase-5 plan (U): the system prompt NEVER includes copyable fake anchors
 * (e.g. "key1 key2"). Any syntax illustration uses neutral prose
 * ("a key from the list below") or expression placeholders
 * (e.g. "keyN"). The closed-list rule is reinforced in REJECTION CRITERIA.
 */
export function buildStage4Prompt(
  module: Module,
  closedKeyList: string[],
  symbolsTable: string,
  truncatedSource: string,
  language: Language = "en",
): PromptPair {
  const system = [
    `You are a technical documentation generator for the livewiki project.`,
    `You will receive a module's metadata, a CLOSED list of canonical symbol keys, a symbol table, and a code excerpt.`,
    ``,
    `Output rules (strict):`,
    `- Markdown + frontmatter with: title, owner: generated, anchors (list of closed keys).`,
    `- Use ONLY the keys from the closed list below. Distribute them across sections. NEVER invent a key outside the list.`,
    `- If information is missing, write "TODO: <reason>" and continue — do not invent behaviour.`,
    `- Keep prose tight; this is reference documentation, not marketing.`,
    `- Sections end when there are no more keys to assign or the budget is exhausted.`,
    ``,
    `Constraints (livewiki invariants):`,
    `- Frontmatter anchors list MUST only contain keys from the closed list.`,
    `- Distribute the remaining closed keys across sections using the section-marker comment (one marker per section, list the keys that section anchors).`,
    `- The page must be syntactically valid Markdown (frontmatter between --- blocks).`,
    ``,
    `REJECTION CRITERIA (the artifact validator will reject if any of these are violated):`,
    `- Frontmatter missing, malformed, missing the \`owner:\` line, or \`owner\` is not "generated".`,
    `- Any anchor key in the frontmatter or in a section marker is NOT in the closed list.`,
    `- Empty page or reasoning-only output.`,
    `- The page is not a real Markdown page (e.g. just a fenced code block with no body).`,
    `- The page contains a \`<!-- lw:manual -->\` block (reserved for human content — only the orchestrator can re-inject existing ones).`,
  ].join("\n");

  const user = [
    `# Language: ${language}`,
    ``,
    `# Module: ${module.id}`,
    `# Paths (${module.paths.length}): ${module.paths.join(", ")}`,
    `# Symbol count: ${module.symbolCount}`,
    ``,
    `# Closed list of canonical keys (USE ONLY THESE — every anchor in your output MUST come from this list):`,
    ...closedKeyList.map((k) => `- ${k}`),
    ``,
    closedKeyList.length > 0
      ? `# Section marker syntax (concrete example using keys from the closed list above):`
      : `# No canonical keys available for this module — emit no anchors and do not use <!-- lw:anchors -->.`,
    closedKeyList.length > 0
      ? `After a heading, drop one HTML comment listing the keys that section anchors. Pick 1+ keys from the list — never invent a key. Example with the actual keys:`
      : `If your generated page would be empty or a placeholder, do not write a page. The page-write is rejected if it has no anchors (no <a id="..."> or no <!-- lw:anchors -->).`,
    ``,
    "```",
    "## Validation flow",
    closedKeyList.length > 0
      ? `<!-- lw:anchors ${closedKeyList.slice(0, Math.min(2, closedKeyList.length)).join(" ")} -->`
      : `<!-- (no anchors — page should not exist) -->`,
    "",
    "Prose about that section.",
    "```",
    ``,
    `# Symbol table:`,
    symbolsTable,
    ``,
    `# Source code (truncated by token budget):`,
    "```",
    truncatedSource,
    "```",
    ``,
    `# FORBIDDEN: never emit a \`<!-- lw:manual -->...<!-- /lw:manual -->\` block. Manual blocks are sacred (rule #6) and are reserved for human content. If you write one, the artifact will be rejected.`,
    ``,
    `# Output: complete Markdown page for livewiki/${module.id}.md`,
  ].join("\n");

  return { system, user };
}

/**
 * Repair prompt — used when artifact validation OR post-write verify
 * fails after an LLM call. Receives the closed key list, structured
 * errors, and the prior candidate (truncated) for correction.
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
  language: Language = "en",
): PromptPair {
  const system = [
    `You are a technical documentation REPAIR assistant for the livewiki project.`,
    `Your previous attempt to document a module produced an artifact that the livewiki validator REJECTED.`,
    `You will receive the closed list of canonical keys, the prior candidate (possibly truncated), and a structured list of validation errors.`,
    ``,
    `Your job: produce a corrected Markdown page that fixes every error listed below.`,
    `Hard constraints (same as the initial generation):`,
    `- Frontmatter: title, owner: generated, anchors list.`,
    `- Every anchor key in the page MUST be in the closed list. NEVER invent a key.`,
    `- Valid Markdown (frontmatter between --- blocks).`,
    `- NEVER emit a \`<!-- lw:manual -->\` block in your output. Manual blocks are reserved for human content (rule #6); the orchestrator preserves them byte-for-byte from the previous version.`,
    ``,
    `Do NOT wrap your output in code fences. Do NOT include reasoning prose. Output the raw Markdown page only.`,
  ].join("\n");

  const errorLines = errors.map((e) => {
    const where = e.sectionSlug
      ? ` (section "${e.sectionSlug}")`
      : e.location === "frontmatter"
        ? " (frontmatter)"
        : ` (${e.location})`;
    return `- [${e.code}]${where}: ${e.message}` + (e.offending ? ` — offending: ${e.offending}` : "");
  });

  const user = [
    `# Language: ${language}`,
    ``,
    `# Module: ${module.id}`,
    `# Paths (${module.paths.length}): ${module.paths.join(", ")}`,
    ``,
    `# Closed list of canonical keys (USE ONLY THESE):`,
    ...closedKeyList.map((k) => `- ${k}`),
    ``,
    `# Symbol table:`,
    symbolsTable,
    ``,
    `# Source code (truncated by token budget):`,
    "```",
    truncatedSource,
    "```",
    ``,
    `# Structured errors from the validator (FIX ALL):`,
    ...errorLines,
    ``,
    `# Prior candidate (truncated to first 2000 chars — what the validator saw):`,
    "```",
    priorCandidate.slice(0, 2000),
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
  | "empty_body"                    // frontmatter ok, but body is empty/whitespace
  | "model_invented_manual"         // LLM wrote a <!-- lw:manual --> block (forbidden)
  // Phase-5 plan (X): codes used by the ORCHESTRATOR to feed the repair
  // prompt when the problem is NOT the artifact shape (LLM call failed or
  // verify rejected). The repair prompt treats all of them the same way.
  | "llm_error"                     // LLM call threw (network, 5xx, etc)
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