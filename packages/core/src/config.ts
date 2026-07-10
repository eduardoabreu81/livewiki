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
   * Phase-5 plan (X): número de chamadas corretivas permitidas por task do
   * stage 4, após a chamada inicial. Default 2 → uma task pode fazer no
   * MÁXIMO 1 inicial + 2 reparos = 3 chamadas LLM.
   *
   * Deve ser um inteiro ≥ 0. Validado por `validateConfigShape` (rejeita
   * floats, NaN, strings, negativos).
   */
  maxRepairAttempts?: number;
}

/** Defaults aplicados em runtime, NÃO gravados no config. */
export const CONFIG_DEFAULTS = {
  language: "en",
  languages: ["ts", "tsx", "js", "jsx", "py"],
  /** Base URL default por provider — só usada se config.baseUrl ausente. */
  baseUrls: {
    anthropic: "https://api.anthropic.com",
    "openai-compat": "https://api.openai.com",
  } as Record<LlmProvider, string>,
  /**
   * Phase-5 plan (X): default de reparos por task. Plan exige 2.
   * Inteiro não-negativo. Sobrescrito por `config.maxRepairAttempts`
   * ou por `BatchOptions.maxRepairAttempts` (testes, override CLI).
   */
  maxRepairAttempts: 2,
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
  // Phase-5 plan (X): maxRepairAttempts — inteiro não-negativo. Floats,
  // NaN, strings e negativos são rejeitados (em vez de silenciosamente
  // cair pro default) pra que configs corrompidos não escondam bugs.
  if (obj["maxRepairAttempts"] !== undefined) {
    const v = obj["maxRepairAttempts"];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
      throw new Error(
        `invalid maxRepairAttempts: must be a non-negative integer, got ${JSON.stringify(v)}`,
      );
    }
    out.maxRepairAttempts = v;
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