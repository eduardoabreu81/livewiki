/**
 * config — load/save do `.livewiki/config.json` (config local do repo).
 *
 * SPEC §"Layout gerado no repo-alvo" (commit b272907): `.livewiki/config.json`
 * guarda provider, linguagens, ignores, language e (Fase 3) pricing override.
 *
 * **Sem modelo default hardcoded** (commit 3894f6e — API key só via env var;
 * sem modelo default). Se `provider` ou `model` estiverem ausentes quando o
 * batch LLM rodar, `validateConfigForBatch()` lança `MissingProviderConfigError`
 * com mensagem clara apontando pro `.livewiki/config.json`.
 *
 * **API key NUNCA mora aqui** — fica em `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`
 * (env var). Esta config pode versionar sem expor credencial. Coberto por
 * `key-leak.test.ts` no step 3.
 */

import * as nodePath from "node:path";
import * as safeIo from "./safe-io.js";
import type { PricingOverride } from "./pricing.js";
import type { FlowSignalConfig, PathRoleConfig } from "./modules.js";
import { isKnownPreset, resolvePreset, resolveProviderConfig, type PresetName } from "./presets.js";

/** Provideres suportados pelo client LLM (Fase 3). */
export type LlmProvider = "anthropic" | "openai-compat";

/**
 * Schema do `.livewiki/config.json`. Todos os campos são opcionais —
 * defaults são aplicados na hora de usar. `language` é o ÚNICO com default
 * explícito (`"en"`); os outros são deliberadamente indefinidos pra forçar
 * o usuário a escolher (sem fallback silencioso).
 *
 * Fase 5 step 5 adicionou `preset` — nome do preset da tabela embutida
 * (anthropic, openai, openrouter, ...). Se set, expande em provider +
 * baseUrl + envVar + pricing (cada um pode ser sobrescrito).
 */
export interface LivewikiConfig {
  /**
   * Provider LLM (legacy, Fase 3). Sem default. Equivalente a setar
   * `preset: "anthropic"` (adapter=anthropic, defaults) ou `preset: "openai"`
   * (adapter=openai-compat). Mantido pra back-compat.
   */
  provider?: LlmProvider;
  /**
   * Modelo dentro do provider. Sem default — idem.
   */
  model?: string;
  /**
   * Preset de provider (Fase 5 step 5). Nome da tabela embutida
   * (`anthropic`, `openai`, `openrouter`, `deepseek`, `kimi`, `minimax`,
   * `gemini`, `nvidia`, `ollama`, `lmstudio`). Se set, sobrescreve
   * `provider` (adapter derivado do preset). Qualquer campo
   * (`baseUrl`, `pricing`) pode ser sobrescrito individualmente.
   *
   * Ver `packages/core/src/presets.ts` pra tabela.
   */
  preset?: PresetName;
  /** Idioma da doc gerada (1 por repo). Default "en". Não afeta chaves/âncoras/diagramas. */
  language?: string;
  /** Base URL customizada (OpenRouter, LiteLLM, Ollama cloud). Opcional. */
  baseUrl?: string;
  /** Override de pricing por modelo (USD/1M tokens). Opcional. */
  pricing?: PricingOverride;
  /** Linguagens aceitas no walker. Default ["ts","tsx","js","jsx","py"]. */
  languages?: string[];
  /** Patterns extra pra ignorar (além de .gitignore). Default []. */
  ignores?: string[];
  /**
   * Phase-5 plan (X): number of corrective calls allowed per stage-4 task
   * after the initial call. Default 2 → a task may make at most
   * 1 initial + 2 repairs = 3 LLM calls.
   *
   * Must be an integer ≥ 0. Validated by `validateConfigShape` (rejects
   * floats, NaN, strings, negatives).
   */
  maxRepairAttempts?: number;
  /**
   * Provider-incomplete calls that may retry fresh without consuming a
   * stage-4 bounded slot. Default 2; 0 disables non-consuming retries.
   * Must be an integer >= 0.
   */
  maxIncompleteRetries?: number;
  /**
   * Max output tokens for stage-4/stage-5 (and repair) generation.
   * When `outputTokenStrategy` is "dynamic" (the default), this is a
   * CEILING for the content-scaled budget computed by
   * `computeDynamicOutputTokenBudget` (output-budget.ts) — not the value
   * sent on every call. When "fixed", this value IS sent literally, same
   * as before this option existed. Default 8192 (as a ceiling). Override
   * per repo or via BatchOptions.
   */
  stage4MaxOutputTokens?: number;
  /**
   * Controls whether `stage4MaxOutputTokens`/`topicMaxOutputTokens` are a
   * content-scaled dynamic budget (ceiling only) or the literal value sent
   * on every call. Default "dynamic" — a flat budget silently starves
   * large modules/flows/topics while never being hit by small ones.
   */
  outputTokenStrategy?: "dynamic" | "fixed";
  /**
   * Split modules with more than this many files before stage 4.
   * Default 12. Set 0 to disable file-count splitting.
   */
  maxModuleFiles?: number;
  /**
   * Split modules with more than this many symbols before stage 4.
   * Default 80. Set 0 to disable symbol-count splitting.
   */
  maxModuleSymbols?: number;
  /**
   * #29: source-bytes threshold above which a file page is generated
   * plan-then-write (plan pass + per-section passes, assembled
   * deterministically — the split never reaches disk). Default 60,000
   * (aligned with the stage-4 context char budget). Set 0 to disable.
   */
  fileSplitSourceBytes?: number;
  /**
   * Thinking control for openai-compat providers that support it.
   * - disabled: send thinking off (MiniMax-M3)
   * - adaptive: allow thinking
   * - omit: do not send the field
   * Default: derived from preset / MiniMax model heuristic.
   */
  thinking?: "disabled" | "adaptive" | "omit";
  /**
   * Per-attempt LLM HTTP timeout in milliseconds (client/provider level).
   * - omitted → 300_000 (5 min) at the adapter
   * - 0 → disable client abort (local providers may use 900_000)
   * - integer in 0..MAX_TIMEOUT_MS (2_147_483_647, Node setTimeout safe max)
   * Timeouts do not auto-retry; usage for timed-out attempts is unknown.
   */
  timeoutMs?: number;
  /**
   * Optional gitignore-style path-role patterns. Roles affect navigation,
   * prioritization, and compact-vs-product presentation depth; they never
   * remove files, modules, or symbols from the exact documentation inventory. A supplied category replaces its
   * built-in patterns; an empty array disables that category.
   */
  pathRoles?: PathRoleConfig;
  /**
   * Stage-5 flow synthesis cap (SPEC §"Semantic product-flow layer").
   * Default 4; 0 disables flow synthesis. Must be an integer >= 0.
   */
  maxFlows?: number;
  /**
   * Closed-list cap for a flow candidate's seed key set. Default 25.
   * Must be an integer >= 1.
   */
  flowMaxAnchors?: number;
  /**
   * Seed-key overlap cap between accepted flow candidates (A/B round-5
   * re-eval fix (b)): intersection over the smaller set, same formula as
   * the topic plan's pair-overlap rule. Default 0.75; 1 disables the cap.
   * Must be a number 0..1.
   */
  flowMaxOverlap?: number;
  /**
   * Per-diagram node budget for flow companion diagrams. Default 12.
   * Must be an integer >= 1.
   */
  flowMaxDiagramNodes?: number;
  /**
   * Per-diagram edge budget for flow companion diagrams. Default 20.
   * Must be an integer >= 1.
   */
  flowMaxDiagramEdges?: number;
  /**
   * Optional gitignore-style flow-signal patterns. Same per-category
   * replacement semantics as pathRoles: a supplied category replaces its
   * built-in patterns; an empty array disables that category.
   */
  flowSignals?: FlowSignalConfig;
  /** Maximum semantic topic pages planned in stage 5. Default 4; 0 disables topics. */
  maxTopics?: number;
  /** Closed-list anchor cap for one topic. Default 18; valid range 5..32. */
  topicMaxAnchors?: number;
  /** Maximum source-evidence characters supplied to one topic task. Default 40,000. */
  topicMaxSourceChars?: number;
  /**
   * Maximum output tokens for topic generation and repair. Same
   * ceiling-vs-literal semantics as `stage4MaxOutputTokens` under
   * `outputTokenStrategy`. Default 4,096 (as a ceiling).
   */
  topicMaxOutputTokens?: number;
  /**
   * Maximum characters of the rationale evidence block injected into
   * stage-4 and topic prompts (Etapa 2b). Carved inside the existing
   * stage-4 char budget. Default 4,000; 0 disables the block.
   */
  rationaleMaxChars?: number;
  /**
   * Risk-weighted debt prioritization in `status`/`update` (Etapa 2c).
   * Default true; set false to keep the chronological ordering and omit
   * the additive `risk` field from debt items.
   */
  riskAnalysis?: boolean;
  /**
   * Git history window (commits) for the churn risk factor (Etapa 2c).
   * Default 500; 0 disables the `git log` spawn entirely (churn factor 0).
   * Must be an integer 0..10000.
   */
  riskChurnCommits?: number;
  /**
   * Surgical section-scoped repair calls (recovery tier, Component 1).
   * Default true; when a repair error set is section-scoped and eligible,
   * the repair attempt uses a small focused prompt plus the deterministic
   * anti-cascade guard instead of the full-context repair prompt. Set
   * false to always use the full-context repair path.
   */
  surgicalRepair?: boolean;
  /**
   * Relaxed completion round (recovery tier, Component 2). Default true;
   * when the strict loop would mark `repair_exhausted`, ONE final attempt
   * runs under a relaxed presentation contract (prose/bullet shape and
   * required-section sets relax; anchors, closed-list exactness,
   * frontmatter identity, the diagram placeholder, marker placement, the
   * TODO ban, `empty_section`, tier coverage, and verify NEVER relax).
   * Success marks the task done with the page flagged `quality: degraded`;
   * failure keeps the original `repair_exhausted`. Set false to disable.
   */
  relaxedRound?: boolean;
  /**
   * CodeWiki-grade module pages (roadmap item 22, D1/D2 hard contract):
   * stage-4 module pages must carry ONE model-drawn `## Diagram` section
   * whose inline mermaid block the orchestrator extracts to
   * `livewiki/diagrams/<slug>.mmd`, leaving the exact
   * `%% livewiki/diagrams/<slug>.mmd` placeholder in the page (the flow
   * dual-artifact pattern; node/edge budgets are `moduleMaxDiagramNodes` /
   * `moduleMaxDiagramEdges`). Default true (maintainer decision after the #22
   * A/B passed); set false for the byte-identical pre-#22 module page
   * contract.
   */
  moduleDiagrams?: boolean;
  /**
   * Per-diagram node budget for module pages (`moduleDiagrams`). Default 24.
   * Must be an integer >= 1. Own budget since 2026-08-04 — reusing the flow
   * budget (12 nodes) made the largest modules (near the 80-symbol cap)
   * systematically fail `flow_diagram_too_large`: the model drew 13–15
   * nodes because that is what the module actually has.
   */
  moduleMaxDiagramNodes?: number;
  /**
   * Per-diagram edge budget for module pages (`moduleDiagrams`). Default 32.
   * Must be an integer >= 1.
   */
  moduleMaxDiagramEdges?: number;
  /**
   * CodeWiki-grade module pages (roadmap item 22, D2 soft contract):
   * stage-4 prompt guidance to group a module with >= 8 symbols under
   * concept-named H2 sections with H3 symbol subsections instead of a flat
   * symbol list. Guidance only — no hard validation. Default true.
   */
  deepHierarchy?: boolean;
  /**
   * Concern-grouped topic candidates (D2): at most one extra `deployment`
   * and one `testing` topic candidate per run, built deterministically
   * from the same closed inventory and validated by the same topic
   * machinery. Default true; set false to plan only import-graph cluster
   * topics.
   */
  concernTopics?: boolean;
  /**
   * Repository understanding synthesis (roadmap item 23): ONE bounded
   * stage-5 task after topics that writes `livewiki/understanding.md` from
   * the closed evidence inventory (accepted module/flow/topic pages, entry
   * points, README purpose when present). Default true; set false to skip
   * the synthesis (the quickstart keeps the deterministic orientation
   * fallback chain).
   */
  understandingSynthesis?: boolean;
  /**
   * Community-detection cross-check of the stage-2 heuristic module
   * partition (roadmap item 9). Default true; diagnostic-only — the
   * report is persisted in the stage-2 task checkpoint and NEVER changes
   * run status or exit code (the heuristic partition always wins). Set
   * false to skip the cross-check.
   */
  communityDetection?: boolean;
  /**
   * Stage-4 module-task worker pool size (roadmap item 7). Default 1
   * (current sequential behavior, byte-for-byte). Values > 1 run that
   * many workers pulling stage-4 module tasks from the prioritized
   * queue; stage 5 (flows/topics) stays SEQUENTIAL — its loops share
   * hub files inside transactions, a documented out-of-scope hazard.
   * Must be an integer 1..16.
   */
  batchConcurrency?: number;
}

/** Max safe timeout for Node `setTimeout` (signed 32-bit ms). */
export const MAX_TIMEOUT_MS = 2_147_483_647;

/**
 * Validate timeoutMs for config load and programmatic createLlmClient paths.
 * Accepts only integers in [0, MAX_TIMEOUT_MS].
 */
export function assertValidTimeoutMs(v: unknown): asserts v is number {
  if (
    typeof v !== "number" ||
    !Number.isInteger(v) ||
    v < 0 ||
    v > MAX_TIMEOUT_MS
  ) {
    throw new Error(
      `invalid timeoutMs: must be an integer 0..${MAX_TIMEOUT_MS} ` +
        `(0 disables timeout; upper bound is Node setTimeout safe max), ` +
        `got ${JSON.stringify(v)}`,
    );
  }
}

/** Defaults applied at runtime, NOT written into the config file. */
export const CONFIG_DEFAULTS = {
  language: "en",
  languages: ["ts", "tsx", "js", "jsx", "py"],
  /** Default base URL per provider — only used if config.baseUrl is absent. */
  baseUrls: {
    anthropic: "https://api.anthropic.com",
    "openai-compat": "https://api.openai.com",
  } as Record<LlmProvider, string>,
  /**
   * Phase-5 plan (X): default repairs per task. Plan requires 2.
   * Non-negative integer. Overridden by `config.maxRepairAttempts`
   * or by `BatchOptions.maxRepairAttempts` (tests, CLI override).
   */
  maxRepairAttempts: 2,
  /** Default non-consuming retries for normalized incomplete responses. */
  maxIncompleteRetries: 2,
  /**
   * Stage-4/5 completion budget CEILING (tokens) under the dynamic
   * strategy — the actual per-page value is computed by
   * `computeDynamicOutputTokenBudget` and rarely reaches this ceiling
   * for small pages. Set generously (matches the accepted 256..32768
   * validation range) so the ceiling itself is never the bottleneck; the
   * formula, not this constant, controls typical spend. Under the
   * "fixed" strategy this value IS sent literally on every call.
   */
  stage4MaxOutputTokens: 32_768,
  /** Dynamic (content-scaled) vs fixed (literal) output-token budgets. */
  outputTokenStrategy: "dynamic" as "dynamic" | "fixed",
  /** Structural split thresholds for oversized modules. */
  maxModuleFiles: 12,
  maxModuleSymbols: 80,
  /** #29: plan-then-write threshold for oversized single-file pages. */
  fileSplitSourceBytes: 60_000,
  /**
   * Default LLM HTTP timeout (ms). Applied when config omits timeoutMs.
   * Local providers may set 900_000; 0 disables the abort timer.
   */
  timeoutMs: 300_000,
  /** Stage-5 flow candidate cap; 0 disables flow synthesis. */
  maxFlows: 4,
  /** Closed-list cap for a flow candidate's seed key set. */
  flowMaxAnchors: 25,
  /** Seed-key overlap cap between accepted flow candidates; 1 disables. */
  flowMaxOverlap: 0.75,
  /** Flow companion diagram budgets (nodes / edges). */
  flowMaxDiagramNodes: 12,
  flowMaxDiagramEdges: 20,
  /** Module-page diagram budgets (nodes / edges) — own budget since
   *  2026-08-04, sized for modules near the symbol cap. */
  moduleMaxDiagramNodes: 24,
  moduleMaxDiagramEdges: 32,
  /** Semantic topic synthesis budgets. */
  maxTopics: 4,
  topicMaxAnchors: 18,
  topicMaxSourceChars: 40_000,
  /** Same ceiling-under-dynamic-strategy semantics as `stage4MaxOutputTokens`. */
  topicMaxOutputTokens: 32_768,
  /** Bounded rationale evidence block in stage-4/topic prompts (Etapa 2b). */
  rationaleMaxChars: 4_000,
  /** Risk-weighted debt ordering in status/update (Etapa 2c). */
  riskAnalysis: true,
  /** Git churn window for the risk score; 0 disables the git spawn. */
  riskChurnCommits: 500,
  /** Surgical section-scoped repair calls (recovery tier, Component 1). */
  surgicalRepair: true,
  /** Relaxed completion round after strict exhaustion (recovery tier, Component 2). */
  relaxedRound: true,
  /** CodeWiki-grade module page format (roadmap item 22); both default off. */
  moduleDiagrams: true,
  deepHierarchy: true,
  /** Concern-grouped topic candidates (D2: deployment/testing). */
  concernTopics: true,
  /** Stage-5c repository understanding synthesis (roadmap item 23). */
  understandingSynthesis: true,
  /** Community-detection cross-check of the stage-2 partition (diagnostic-only). */
  communityDetection: true,
  /** Stage-4 module-task worker pool size; 1 keeps sequential behavior. */
  batchConcurrency: 1,
} as const;

/**
 * Erro lançado quando o batch é disparado sem provider/modelo configurado.
 * Mensagem aponta pro `.livewiki/config.json` E cita um modelo popular só
 * como EXEMPLO (não como fallback silencioso — `livewiki` NUNCA escolhe
 * modelo sem o usuário declarar explicitamente).
 */
export class MissingProviderConfigError extends Error {
  public readonly repoRoot: string;
  constructor(repoRoot: string, missingFields: Array<"provider" | "model">) {
    const example =
      `Configure in .livewiki/config.json:\n` +
      `  {\n` +
      `    "provider": "anthropic",   // or "openai-compat"\n` +
      `    "model": "claude-sonnet-5", // example only — pick what you want\n` +
      `  }\n` +
      `API key stays in env: ANTHROPIC_API_KEY or OPENAI_API_KEY.`;
    super(
      `Cannot run LLM batch: missing ${missingFields.join(" and ")} in config. ` +
        `Repo: ${repoRoot}. ${example}`,
    );
    this.name = "MissingProviderConfigError";
    this.repoRoot = repoRoot;
  }
}

const CONFIG_REL_PATH = ".livewiki/config.json";

/**
 * Carrega `.livewiki/config.json`. Se não existir, retorna config VAZIO
 * (sem defaults — exceto language="en" no caller, via applyDefaults).
 *
 * Falha fechado em JSON malformado.
 */
export async function loadConfig(repoRoot: string): Promise<LivewikiConfig> {
  const exists = await safeIo.exists(repoRoot, CONFIG_REL_PATH).catch(() => false);
  if (!exists) return {};
  const raw = await safeIo.readText(repoRoot, CONFIG_REL_PATH);
  if (raw.trim() === "") return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return validateConfigShape(parsed);
  } catch (err) {
    throw new Error(
      `Failed to parse ${CONFIG_REL_PATH}: ${(err as Error).message}. ` +
        `Fix the file or delete it to start fresh.`,
    );
  }
}

/**
 * Helper: dado o config carregado, retorna a config PROVIDER final
 * (preset expandido, overrides aplicados). Usado pelo LLM client factory.
 *
 * NÃO valida "model ausente" — isso fica em validateConfigForBatch.
 */
export function resolveProviderFromConfig(
  config: LivewikiConfig,
): ReturnType<typeof resolveProviderConfig> {
  return resolveProviderConfig({
    ...(config.preset !== undefined ? { preset: config.preset } : {}),
    ...(config.provider !== undefined ? { provider: config.provider } : {}),
    ...(config.baseUrl !== undefined ? { baseUrl: config.baseUrl } : {}),
    ...(config.pricing !== undefined ? { pricing: config.pricing } : {}),
  });
}

/** Grava config no disco via safe-io (allowlist). */
export async function saveConfig(
  repoRoot: string,
  config: LivewikiConfig,
): Promise<void> {
  const json = JSON.stringify(config, null, 2) + "\n";
  await safeIo.writeText(repoRoot, CONFIG_REL_PATH, json);
}

/** Aplica defaults em runtime. Não muta o objeto original. */
export function applyDefaults(config: LivewikiConfig): LivewikiConfig {
  return {
    language: CONFIG_DEFAULTS.language,
    languages: [...CONFIG_DEFAULTS.languages],
    maxRepairAttempts: CONFIG_DEFAULTS.maxRepairAttempts,
    maxIncompleteRetries: CONFIG_DEFAULTS.maxIncompleteRetries,
    stage4MaxOutputTokens: CONFIG_DEFAULTS.stage4MaxOutputTokens,
    outputTokenStrategy: CONFIG_DEFAULTS.outputTokenStrategy,
    maxModuleFiles: CONFIG_DEFAULTS.maxModuleFiles,
    maxModuleSymbols: CONFIG_DEFAULTS.maxModuleSymbols,
    fileSplitSourceBytes: CONFIG_DEFAULTS.fileSplitSourceBytes,
    timeoutMs: CONFIG_DEFAULTS.timeoutMs,
    maxFlows: CONFIG_DEFAULTS.maxFlows,
    flowMaxAnchors: CONFIG_DEFAULTS.flowMaxAnchors,
    flowMaxOverlap: CONFIG_DEFAULTS.flowMaxOverlap,
    flowMaxDiagramNodes: CONFIG_DEFAULTS.flowMaxDiagramNodes,
    flowMaxDiagramEdges: CONFIG_DEFAULTS.flowMaxDiagramEdges,
    moduleMaxDiagramNodes: CONFIG_DEFAULTS.moduleMaxDiagramNodes,
    moduleMaxDiagramEdges: CONFIG_DEFAULTS.moduleMaxDiagramEdges,
    maxTopics: CONFIG_DEFAULTS.maxTopics,
    topicMaxAnchors: CONFIG_DEFAULTS.topicMaxAnchors,
    topicMaxSourceChars: CONFIG_DEFAULTS.topicMaxSourceChars,
    topicMaxOutputTokens: CONFIG_DEFAULTS.topicMaxOutputTokens,
    rationaleMaxChars: CONFIG_DEFAULTS.rationaleMaxChars,
    riskAnalysis: CONFIG_DEFAULTS.riskAnalysis,
    riskChurnCommits: CONFIG_DEFAULTS.riskChurnCommits,
    surgicalRepair: CONFIG_DEFAULTS.surgicalRepair,
    relaxedRound: CONFIG_DEFAULTS.relaxedRound,
    moduleDiagrams: CONFIG_DEFAULTS.moduleDiagrams,
    deepHierarchy: CONFIG_DEFAULTS.deepHierarchy,
    concernTopics: CONFIG_DEFAULTS.concernTopics,
    understandingSynthesis: CONFIG_DEFAULTS.understandingSynthesis,
    communityDetection: CONFIG_DEFAULTS.communityDetection,
    batchConcurrency: CONFIG_DEFAULTS.batchConcurrency,
    ...config,
  };
}

/**
 * Single source of truth for the configured `ignores` patterns (relative
 * gitignore-style patterns, forward slashes). Returns an empty array when
 * the config is missing the field. Callers forward this list to the walker
 * via `extraIgnores` so the same semantics apply across the entry points
 * that actually rescan the repo:
 *
 *   - `livewiki index`            (CLI command)
 *   - `livewiki init`             (base + `--plan`, no LLM)
 *   - `livewiki init --batch`     (init base, then `runBatch` stage 1)
 *   - `livewiki batch`            (new run — stage 1 rescan)
 *
 * The walker also applies its own built-in defaults (`.git`, `.livewiki`,
 * `node_modules`, `dist`, `coverage`) and the repo's `.gitignore`. This
 * helper exposes ONLY the configured user-level overrides.
 *
 * Resume (`livewiki batch resume <runId>`) and `--only` do NOT rescan:
 * they operate on the existing run snapshot (SQLite index + checkpoints).
 * A configured ignored path cannot re-enter via resume; it was already
 * excluded when the original run's stage-1 indexer walked the repo.
 */
export function resolveExtraIgnores(config: LivewikiConfig): readonly string[] {
  return config.ignores ?? [];
}

/**
 * Valida que config tem provider + model ANTES de criar LLM client. Lança
 * `MissingProviderConfigError` se faltar algum.
 *
 * NÃO escolhe default — força o usuário a ser explícito.
 */
export function validateConfigForBatch(repoRoot: string, config: LivewikiConfig): void {
  const missing: Array<"provider" | "model"> = [];
  // A preset reference satisfies the provider requirement: it expands to
  // adapter/baseUrl/envVar downstream (SPEC §"Stack": config.json references
  // the preset by name and may override any field).
  if (!config.provider && !config.preset) missing.push("provider");
  if (!config.model) missing.push("model");
  if (missing.length > 0) {
    throw new MissingProviderConfigError(repoRoot, missing);
  }
  // Programmatic callers may skip loadConfig — still reject invalid timeoutMs.
  if (config.timeoutMs !== undefined) {
    assertValidTimeoutMs(config.timeoutMs);
  }
}

/** Resolve a base URL final (config sobrescreve default por provider). */
export function resolveBaseUrl(config: LivewikiConfig): string {
  if (config.baseUrl) return config.baseUrl;
  // Se preset set: usa a baseUrl do preset
  if (config.preset) {
    return resolvePreset(config.preset).baseUrl;
  }
  // Só acessível se provider estiver set; caller garante isso via validateConfigForBatch
  const provider = config.provider as LlmProvider;
  return CONFIG_DEFAULTS.baseUrls[provider];
}

/**
 * Validação rasa do shape — protege contra chaves desconhecidas e tipos errados.
 * Não substitui validação de "config completa pra batch" (que é validateConfigForBatch).
 */
function validateConfigShape(parsed: unknown): LivewikiConfig {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("config must be a JSON object");
  }
  const obj = parsed as Record<string, unknown>;
  const out: LivewikiConfig = {};
  if (typeof obj["provider"] === "string") {
    const p = obj["provider"];
    if (p === "anthropic" || p === "openai-compat") {
      out.provider = p;
    } else {
      throw new Error(
        `invalid provider "${p}" — supported: "anthropic", "openai-compat" ` +
          `(or use "preset" with one of the 10 known providers)`,
      );
    }
  }
  if (typeof obj["preset"] === "string") {
    const p = obj["preset"];
    if (isKnownPreset(p)) {
      out.preset = p;
    } else {
      throw new Error(
        `invalid preset "${p}" — supported: see PRESET_TABLE in packages/core/src/presets.ts`,
      );
    }
  }
  if (typeof obj["model"] === "string") out.model = obj["model"];
  if (typeof obj["language"] === "string") out.language = obj["language"];
  if (typeof obj["baseUrl"] === "string") out.baseUrl = obj["baseUrl"];
  if (Array.isArray(obj["languages"])) {
    out.languages = obj["languages"].filter((x): x is string => typeof x === "string");
  }
  if (Array.isArray(obj["ignores"])) {
    out.ignores = obj["ignores"].filter((x): x is string => typeof x === "string");
  }
  if (obj["pricing"] !== undefined && typeof obj["pricing"] === "object" && obj["pricing"] !== null) {
    const p = obj["pricing"] as Record<string, unknown>;
    const outPricing: PricingOverride = {};
    for (const [model, value] of Object.entries(p)) {
      if (
        value !== null &&
        typeof value === "object" &&
        typeof (value as ModelPrice).input === "number" &&
        typeof (value as ModelPrice).output === "number"
      ) {
        outPricing[model] = value as ModelPrice;
      }
    }
    out.pricing = outPricing;
  }
  // Phase-5 plan (X): maxRepairAttempts — non-negative integer. Floats,
  // NaN, strings, and negatives are rejected (instead of silently falling
  // back to the default) so corrupted configs cannot hide bugs.
  if (obj["maxRepairAttempts"] !== undefined) {
    const v = obj["maxRepairAttempts"];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
      throw new Error(
        `invalid maxRepairAttempts: must be a non-negative integer, got ${JSON.stringify(v)}`,
      );
    }
    out.maxRepairAttempts = v;
  }
  if (obj["maxIncompleteRetries"] !== undefined) {
    const v = obj["maxIncompleteRetries"];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
      throw new Error(
        `invalid maxIncompleteRetries: must be a non-negative integer, got ${JSON.stringify(v)}`,
      );
    }
    out.maxIncompleteRetries = v;
  }
  if (obj["stage4MaxOutputTokens"] !== undefined) {
    const v = obj["stage4MaxOutputTokens"];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 256 || v > 32_768) {
      throw new Error(
        `invalid stage4MaxOutputTokens: must be an integer 256..32768, got ${JSON.stringify(v)}`,
      );
    }
    out.stage4MaxOutputTokens = v;
  }
  if (obj["outputTokenStrategy"] !== undefined) {
    const v = obj["outputTokenStrategy"];
    if (v !== "dynamic" && v !== "fixed") {
      throw new Error(
        `invalid outputTokenStrategy: must be "dynamic" | "fixed", got ${JSON.stringify(v)}`,
      );
    }
    out.outputTokenStrategy = v;
  }
  if (obj["maxModuleFiles"] !== undefined) {
    const v = obj["maxModuleFiles"];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
      throw new Error(
        `invalid maxModuleFiles: must be a non-negative integer, got ${JSON.stringify(v)}`,
      );
    }
    out.maxModuleFiles = v;
  }
  if (obj["maxModuleSymbols"] !== undefined) {
    const v = obj["maxModuleSymbols"];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
      throw new Error(
        `invalid maxModuleSymbols: must be a non-negative integer, got ${JSON.stringify(v)}`,
      );
    }
    out.maxModuleSymbols = v;
  }
  if (obj["fileSplitSourceBytes"] !== undefined) {
    const v = obj["fileSplitSourceBytes"];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
      throw new Error(
        `invalid fileSplitSourceBytes: must be a non-negative integer, got ${JSON.stringify(v)}`,
      );
    }
    out.fileSplitSourceBytes = v;
  }
  if (obj["thinking"] !== undefined) {
    const v = obj["thinking"];
    if (v !== "disabled" && v !== "adaptive" && v !== "omit") {
      throw new Error(
        `invalid thinking: must be "disabled" | "adaptive" | "omit", got ${JSON.stringify(v)}`,
      );
    }
    out.thinking = v;
  }
  if (obj["timeoutMs"] !== undefined) {
    assertValidTimeoutMs(obj["timeoutMs"]);
    out.timeoutMs = obj["timeoutMs"] as number;
  }
  // Stage-5 flow knobs (SPEC §"Semantic product-flow layer"): strict integer
  // ranges, rejected instead of silently falling back to the defaults.
  if (obj["maxFlows"] !== undefined) {
    const v = obj["maxFlows"];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
      throw new Error(
        `invalid maxFlows: must be a non-negative integer, got ${JSON.stringify(v)}`,
      );
    }
    out.maxFlows = v;
  }
  if (obj["flowMaxAnchors"] !== undefined) {
    const v = obj["flowMaxAnchors"];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1) {
      throw new Error(
        `invalid flowMaxAnchors: must be an integer >= 1, got ${JSON.stringify(v)}`,
      );
    }
    out.flowMaxAnchors = v;
  }
  if (obj["flowMaxOverlap"] !== undefined) {
    const v = obj["flowMaxOverlap"];
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) {
      throw new Error(
        `invalid flowMaxOverlap: must be a number 0..1 (1 disables the overlap cap), got ${JSON.stringify(v)}`,
      );
    }
    out.flowMaxOverlap = v;
  }
  if (obj["maxTopics"] !== undefined) {
    const v = obj["maxTopics"];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 8) {
      throw new Error(`invalid maxTopics: must be an integer 0..8, got ${JSON.stringify(v)}`);
    }
    out.maxTopics = v;
  }
  if (obj["topicMaxAnchors"] !== undefined) {
    const v = obj["topicMaxAnchors"];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 5 || v > 32) {
      throw new Error(`invalid topicMaxAnchors: must be an integer 5..32, got ${JSON.stringify(v)}`);
    }
    out.topicMaxAnchors = v;
  }
  if (obj["topicMaxSourceChars"] !== undefined) {
    const v = obj["topicMaxSourceChars"];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 200_000) {
      throw new Error(`invalid topicMaxSourceChars: must be an integer 1..200000, got ${JSON.stringify(v)}`);
    }
    out.topicMaxSourceChars = v;
  }
  if (obj["topicMaxOutputTokens"] !== undefined) {
    const v = obj["topicMaxOutputTokens"];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 256 || v > 32_768) {
      throw new Error(`invalid topicMaxOutputTokens: must be an integer 256..32768, got ${JSON.stringify(v)}`);
    }
    out.topicMaxOutputTokens = v;
  }
  if (obj["rationaleMaxChars"] !== undefined) {
    const v = obj["rationaleMaxChars"];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 200_000) {
      throw new Error(`invalid rationaleMaxChars: must be an integer 0..200000 (0 disables the rationale block), got ${JSON.stringify(v)}`);
    }
    out.rationaleMaxChars = v;
  }
  // Etapa 2c risk-prioritization knobs: strict types, rejected instead of
  // silently falling back to the defaults.
  if (obj["riskAnalysis"] !== undefined) {
    const v = obj["riskAnalysis"];
    if (typeof v !== "boolean") {
      throw new Error(`invalid riskAnalysis: must be a boolean, got ${JSON.stringify(v)}`);
    }
    out.riskAnalysis = v;
  }
  if (obj["riskChurnCommits"] !== undefined) {
    const v = obj["riskChurnCommits"];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 10_000) {
      throw new Error(`invalid riskChurnCommits: must be an integer 0..10000 (0 disables the git churn spawn), got ${JSON.stringify(v)}`);
    }
    out.riskChurnCommits = v;
  }
  if (obj["surgicalRepair"] !== undefined) {
    const v = obj["surgicalRepair"];
    if (typeof v !== "boolean") {
      throw new Error(`invalid surgicalRepair: must be a boolean, got ${JSON.stringify(v)}`);
    }
    out.surgicalRepair = v;
  }
  if (obj["relaxedRound"] !== undefined) {
    const v = obj["relaxedRound"];
    if (typeof v !== "boolean") {
      throw new Error(`invalid relaxedRound: must be a boolean, got ${JSON.stringify(v)}`);
    }
    out.relaxedRound = v;
  }
  if (obj["moduleDiagrams"] !== undefined) {
    const v = obj["moduleDiagrams"];
    if (typeof v !== "boolean") {
      throw new Error(`invalid moduleDiagrams: must be a boolean, got ${JSON.stringify(v)}`);
    }
    out.moduleDiagrams = v;
  }
  if (obj["deepHierarchy"] !== undefined) {
    const v = obj["deepHierarchy"];
    if (typeof v !== "boolean") {
      throw new Error(`invalid deepHierarchy: must be a boolean, got ${JSON.stringify(v)}`);
    }
    out.deepHierarchy = v;
  }
  if (obj["concernTopics"] !== undefined) {
    const v = obj["concernTopics"];
    if (typeof v !== "boolean") {
      throw new Error(`invalid concernTopics: must be a boolean, got ${JSON.stringify(v)}`);
    }
    out.concernTopics = v;
  }
  if (obj["understandingSynthesis"] !== undefined) {
    const v = obj["understandingSynthesis"];
    if (typeof v !== "boolean") {
      throw new Error(`invalid understandingSynthesis: must be a boolean, got ${JSON.stringify(v)}`);
    }
    out.understandingSynthesis = v;
  }
  if (obj["communityDetection"] !== undefined) {
    const v = obj["communityDetection"];
    if (typeof v !== "boolean") {
      throw new Error(`invalid communityDetection: must be a boolean, got ${JSON.stringify(v)}`);
    }
    out.communityDetection = v;
  }
  if (obj["batchConcurrency"] !== undefined) {
    const v = obj["batchConcurrency"];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 16) {
      throw new Error(`invalid batchConcurrency: must be an integer between 1 and 16, got ${JSON.stringify(v)}`);
    }
    out.batchConcurrency = v;
  }
  if (obj["flowMaxDiagramNodes"] !== undefined) {
    const v = obj["flowMaxDiagramNodes"];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1) {
      throw new Error(
        `invalid flowMaxDiagramNodes: must be an integer >= 1, got ${JSON.stringify(v)}`,
      );
    }
    out.flowMaxDiagramNodes = v;
  }
  if (obj["flowMaxDiagramEdges"] !== undefined) {
    const v = obj["flowMaxDiagramEdges"];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1) {
      throw new Error(
        `invalid flowMaxDiagramEdges: must be an integer >= 1, got ${JSON.stringify(v)}`,
      );
    }
    out.flowMaxDiagramEdges = v;
  }
  if (obj["moduleMaxDiagramNodes"] !== undefined) {
    const v = obj["moduleMaxDiagramNodes"];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1) {
      throw new Error(
        `invalid moduleMaxDiagramNodes: must be an integer >= 1, got ${JSON.stringify(v)}`,
      );
    }
    out.moduleMaxDiagramNodes = v;
  }
  if (obj["moduleMaxDiagramEdges"] !== undefined) {
    const v = obj["moduleMaxDiagramEdges"];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1) {
      throw new Error(
        `invalid moduleMaxDiagramEdges: must be an integer >= 1, got ${JSON.stringify(v)}`,
      );
    }
    out.moduleMaxDiagramEdges = v;
  }
  if (obj["pathRoles"] !== undefined) {
    const value = obj["pathRoles"];
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("invalid pathRoles: must be an object");
    }
    const roleObject = value as Record<string, unknown>;
    const allowed = new Set(["testPatterns", "fixturePatterns", "toolingPatterns", "docsPatterns"]);
    for (const key of Object.keys(roleObject)) {
      if (!allowed.has(key)) {
        throw new Error(`invalid pathRoles key "${key}"`);
      }
    }
    const pathRoles: PathRoleConfig = {};
    for (const key of allowed) {
      const patterns = roleObject[key];
      if (patterns === undefined) continue;
      if (!Array.isArray(patterns) || patterns.some((item) => typeof item !== "string")) {
        throw new Error(`invalid pathRoles.${key}: must be an array of strings`);
      }
      pathRoles[key as keyof PathRoleConfig] = patterns as string[];
    }
    out.pathRoles = pathRoles;
  }
  if (obj["flowSignals"] !== undefined) {
    const value = obj["flowSignals"];
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("invalid flowSignals: must be an object");
    }
    const signalObject = value as Record<string, unknown>;
    const allowed = new Set(["entryPatterns", "persistencePatterns", "persistenceImportPatterns"]);
    for (const key of Object.keys(signalObject)) {
      if (!allowed.has(key)) {
        throw new Error(`invalid flowSignals key "${key}"`);
      }
    }
    const flowSignals: FlowSignalConfig = {};
    for (const key of allowed) {
      const patterns = signalObject[key];
      if (patterns === undefined) continue;
      if (!Array.isArray(patterns) || patterns.some((item) => typeof item !== "string")) {
        throw new Error(`invalid flowSignals.${key}: must be an array of strings`);
      }
      flowSignals[key as keyof FlowSignalConfig] = patterns as string[];
    }
    out.flowSignals = flowSignals;
  }
  return out;
}

interface ModelPrice {
  input: number;
  output: number;
}

// Re-export for callers that want the path
export const CONFIG_PATH = CONFIG_REL_PATH;
export const CONFIG_FILENAME = nodePath.basename(CONFIG_REL_PATH);
