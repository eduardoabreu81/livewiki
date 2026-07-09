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
 * Stage 4 — geração da página do módulo.
 *
 * Princípios:
 *   - System prompt em INGLÊS, define persona + regras (incluindo a da
 *     lista fechada de chaves).
 *   - User prompt passa módulo + chaves canônicas + tabela de símbolos +
 *     código (truncado pelo caller por orçamento).
 *   - ${language} aparece na instrução do system e na do user (instrução
 *     explícita pra escrever no idioma).
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
    `- Markdown + frontmatter with: title, owner: generated, anchors (list).`,
    `- Use ONLY the keys from the closed list below. Distribute them across sections. NEVER invent a key outside the list.`,
    `- If information is missing, write "TODO: <reason>" and continue — do not invent behaviour.`,
    `- Keep prose tight; this is reference documentation, not marketing.`,
    `- Sections end when there are no more keys to assign or the budget is exhausted.`,
    ``,
    `Constraints (livewiki invariants):`,
    `- Frontmatter anchors list MUST only contain keys from the closed list.`,
    `- Section markers `+"`<!-- lw:anchors key1 key2 -->`"+` distribute remaining keys across sections.`,
    `- The page must be syntactically valid Markdown (frontmatter between --- blocks).`,
  ].join("\n");

  const user = [
    `# Language: ${language}`,
    ``,
    `# Module: ${module.id}`,
    `# Paths (${module.paths.length}): ${module.paths.join(", ")}`,
    `# Symbol count: ${module.symbolCount}`,
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
    `# Output: complete Markdown page for livewiki/${module.id}.md`,
  ].join("\n");

  return { system, user };
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