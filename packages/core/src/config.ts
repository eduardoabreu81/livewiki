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
import type { PathRoleConfig } from "./modules.js";
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
   * Max output tokens for stage-4 (and repair) generation.
   * Default 8192. Override per repo or via BatchOptions.
   */
  stage4MaxOutputTokens?: number;
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
   * Optional gitignore-style path-role patterns. Roles affect navigation and
   * prioritization only; they never remove files, modules, or symbols from
   * the exact documentation inventory. A supplied category replaces its
   * built-in patterns; an empty array disables that category.
   */
  pathRoles?: PathRoleConfig;
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
  /** Stage-4 completion budget (tokens). Raised from 4k after MiniMax bench. */
  stage4MaxOutputTokens: 8192,
  /** Structural split thresholds for oversized modules. */
  maxModuleFiles: 12,
  maxModuleSymbols: 80,
  /**
   * Default LLM HTTP timeout (ms). Applied when config omits timeoutMs.
   * Local providers may set 900_000; 0 disables the abort timer.
   */
  timeoutMs: 300_000,
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
    stage4MaxOutputTokens: CONFIG_DEFAULTS.stage4MaxOutputTokens,
    maxModuleFiles: CONFIG_DEFAULTS.maxModuleFiles,
    maxModuleSymbols: CONFIG_DEFAULTS.maxModuleSymbols,
    timeoutMs: CONFIG_DEFAULTS.timeoutMs,
    ...config,
  };
}

/**
 * Valida que config tem provider + model ANTES de criar LLM client. Lança
 * `MissingProviderConfigError` se faltar algum.
 *
 * NÃO escolhe default — força o usuário a ser explícito.
 */
export function validateConfigForBatch(repoRoot: string, config: LivewikiConfig): void {
  const missing: Array<"provider" | "model"> = [];
  if (!config.provider) missing.push("provider");
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
  if (obj["stage4MaxOutputTokens"] !== undefined) {
    const v = obj["stage4MaxOutputTokens"];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 256) {
      throw new Error(
        `invalid stage4MaxOutputTokens: must be an integer >= 256, got ${JSON.stringify(v)}`,
      );
    }
    out.stage4MaxOutputTokens = v;
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
  if (obj["pathRoles"] !== undefined) {
    const value = obj["pathRoles"];
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("invalid pathRoles: must be an object");
    }
    const roleObject = value as Record<string, unknown>;
    const allowed = new Set(["fixturePatterns", "toolingPatterns", "docsPatterns"]);
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
  return out;
}

interface ModelPrice {
  input: number;
  output: number;
}

// Re-export for callers that want the path
export const CONFIG_PATH = CONFIG_REL_PATH;
export const CONFIG_FILENAME = nodePath.basename(CONFIG_REL_PATH);
