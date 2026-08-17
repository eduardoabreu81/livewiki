/**
 * presets — built-in table of known providers (DATA, not code).
 *
 * SPEC §"Stack" (Phase 5):
 *   "**Provider presets** (data, not code): built-in table of
 *    known providers — anthropic, openai, openrouter, deepseek,
 *    kimi, minimax, gemini, nvidia (NIM), ollama and lmstudio (local) —
 *    with baseUrl, adapter, env var name and default pricing filled in.
 *    `config.json` references the preset and can override any field.
 *    **Adapter rule**: when the provider offers an Anthropic-compatible
 *    endpoint (e.g. MiniMax), the preset uses the Anthropic adapter —
 *    optimized cache reads (prompt caching)."
 *
 * Each preset carries ENOUGH to run with no further config:
 *   - adapter: which `LlmClient` to instantiate (anthropic | openai-compat)
 *   - baseUrl: base URL of the endpoint
 *   - envVar: name of the env var that carries the API key
 *   - pricing: default pricing table per model (best-effort)
 *
 * IMPORTANT:
 *   - Prices are BEST-EFFORT. Date in `PRICING_REFERENCE_DATE` in pricing.ts.
 *     The user can override via `config.pricing.<model>`.
 *   - envVar is NEVER written into config.json / checkpoint / logs / errors
 *     (Phase 3 rule — `key-leak.test.ts` covers it).
 *   - Adding a preset = adding an entry in PRESET_TABLE. No new code.
 *   - Presets carry CONNECTION TRIVIA (baseUrl, envVar, adapter, pricing)
 *     — never a behavioral assumption. Provider defaults change without notice
 *     (DeepSeek v4 turned thinking on when omitted, 2026-08-16): the safety lives
 *     in the probe (`llm/probe.ts`, wizard + batch preflight) and in the
 *     `think_block_present` rejection, not in preset data.
 *
 * Table:
 *   - anthropic: official Anthropic Messages API
 *   - openai:    official OpenAI Chat Completions API (openai-compat adapter)
 *   - openrouter: aggregator (openai-compat)
 *   - deepseek:  OpenAI-compat endpoint
 *   - kimi:      Moonshot Kimi (openai-compat)
 *   - minimax:   MiniMax — Anthropic-compat endpoint → uses the anthropic adapter
 *               (the adapter's prompt caching leverages the M2/M3 cache reads)
 *   - gemini:    Google Gemini via API key (alternative openai-compat endpoint)
 *   - nvidia:    NVIDIA NIM (openai-compat)
 *   - ollama:    local, no auth (openai-compat). baseUrl localhost:11434.
 *   - lmstudio:  local, no auth (openai-compat). baseUrl localhost:1234.
 */

import type { LlmProvider } from "./config.js";
import type { PricingTable, ModelPrice } from "./pricing.js";

/** Adapter used by the preset. Maps 1:1 to the internal `LlmProvider`. */
export type PresetAdapter = LlmProvider;

/** Entry in the preset table. Everything derives from here, no new code per preset. */
export interface ProviderPreset {
  /** Human-readable name (key in PRESET_TABLE). */
  readonly name: string;
  /** LLM adapter that will be instantiated (anthropic | openai-compat). */
  readonly adapter: PresetAdapter;
  /** Base API URL. Without /v1 (adapters resolve the path). */
  readonly baseUrl: string;
  /** Name of the env var that carries the API key (NOT the value). */
  readonly envVar: string;
  /** Whether the adapter may run without a credential (for unauthenticated endpoints). */
  readonly credentialOptional?: boolean;
  /** Default pricing per model (USD/1M tokens). Best-effort. */
  readonly pricing: PricingTable;
  /**
   * Short operational notes. Shows up in `--help` / errors. Does NOT include
   * the key, does NOT include a billing URL — only operational context.
   */
  readonly notes: string;
  /**
   * Default thinking/reasoning policy for batch documentation.
   * Where the API allows turning thinking off, we disable by default
   * (more reliable structured Markdown, lower cost).
   * - disabled: send explicit off (MiniMax-M3 chat)
   * - adaptive: allow thinking
   * - omit: do not send the field (Anthropic Messages, most OpenAI chat models)
   * - n/a: provider cannot disable (e.g. some reasoner-only models) — treat as omit
   */
  readonly thinkingDefault?: "disabled" | "adaptive" | "omit" | "n/a";
  /** Prefer max_completion_tokens over max_tokens when true. */
  readonly preferMaxCompletionTokens?: boolean;
  /** Suggested stage-4 max output tokens for this provider family. */
  readonly defaultMaxOutputTokens?: number;
}

/** Type of the table key. Literal union for IDE autocomplete. */
export type PresetName =
  | "anthropic"
  | "openai"
  | "openrouter"
  | "deepseek"
  | "kimi"
  | "minimax"
  | "gemini"
  | "nvidia"
  | "ollama"
  | "lmstudio"
  | "fireworks"
  | "novita"
  | "gmi"
  | "stepfun"
  | "huggingface"
  | "xai"
  | "alibaba";

/** Error thrown when the preset name is unknown. */
export class UnknownPresetError extends Error {
  public readonly presetName: string;
  public readonly available: readonly string[];
  constructor(name: string, available: readonly string[]) {
    super(
      `Unknown provider preset "${name}". Available: ${available.join(", ")}. ` +
        `Configure via .livewiki/config.json or pass --provider.`,
    );
    this.name = "UnknownPresetError";
    this.presetName = name;
    this.available = available;
  }
}

/**
 * PRESET TABLE — adding a provider = adding an entry here.
 *
 * Prices are best-effort (PRICING_REFERENCE_DATE in pricing.ts). Where we do
 * not have a reliable price, we omit it — `pricing.ts:lookupPricing` returns
 * `tokensOnly` in that case (report without USD, per the product rule).
 */
export const PRESET_TABLE: Record<PresetName, ProviderPreset> = {
  anthropic: {
    name: "anthropic",
    adapter: "anthropic",
    baseUrl: "https://api.anthropic.com",
    envVar: "ANTHROPIC_API_KEY",
    pricing: {
      "claude-opus-4-5": { input: 5, output: 25 },
      "claude-sonnet-5": { input: 2, output: 10 },
      "claude-haiku-4-5": { input: 1, output: 5 },
    },
    notes: "API oficial Anthropic Messages. Models: claude-opus-4-5, claude-sonnet-5, claude-haiku-4-5.",
    thinkingDefault: "omit",
    preferMaxCompletionTokens: false,
    defaultMaxOutputTokens: 8192,
  },
  openai: {
    name: "openai",
    adapter: "openai-compat",
    baseUrl: "https://api.openai.com",
    envVar: "OPENAI_API_KEY",
    pricing: {
      "gpt-4o": { input: 2.5, output: 10 },
      "gpt-4o-mini": { input: 0.15, output: 0.6 },
    },
    notes: "API oficial OpenAI Chat Completions.",
    thinkingDefault: "omit",
    preferMaxCompletionTokens: true,
    defaultMaxOutputTokens: 8192,
  },
  openrouter: {
    name: "openrouter",
    adapter: "openai-compat",
    baseUrl: "https://openrouter.ai/api",
    envVar: "OPENROUTER_API_KEY",
    pricing: {
      // OpenRouter passes through provider prices — the table below is the average
      // of the most popular models. Override via config.pricing for accuracy.
      "anthropic/claude-sonnet-4-5": { input: 3, output: 15 },
      "openai/gpt-4o": { input: 5, output: 15 },
      "google/gemini-2.0-flash": { input: 0.1, output: 0.4 },
    },
    notes: "Aggregator (openai-compat). Prefixed models (e.g. anthropic/claude-sonnet-4-5).",
    thinkingDefault: "omit",
    preferMaxCompletionTokens: true,
    defaultMaxOutputTokens: 8192,
  },
  deepseek: {
    name: "deepseek",
    adapter: "openai-compat",
    baseUrl: "https://api.deepseek.com",
    envVar: "DEEPSEEK_API_KEY",
    pricing: {
      // v4 peak rates (off-peak is half); the API echoes the served model id.
      "deepseek-v4-flash": { input: 0.44, output: 1.32 },
      "deepseek-v4-pro": { input: 1.32, output: 3.96 },
      "deepseek-chat": { input: 0.27, output: 1.1 },
      "deepseek-reasoner": { input: 0.55, output: 2.19 },
    },
    notes: "DeepSeek API (openai-compat). v4 models default thinking ON when the field is omitted — the preset pins disabled; reasoning would burn the output budget (dogfood incident 2026-08-16).",
    thinkingDefault: "disabled",
    preferMaxCompletionTokens: false,
    defaultMaxOutputTokens: 8192,
  },
  kimi: {
    name: "kimi",
    adapter: "openai-compat",
    baseUrl: "https://api.moonshot.cn",
    envVar: "MOONSHOT_API_KEY",
    pricing: {
      // Moonshot/Kimi charges per 1M tokens in CNY; below is approx. USD.
      "moonshot-v1-8k": { input: 1.5, output: 1.5 },
      "moonshot-v1-32k": { input: 3, output: 3 },
      "moonshot-v1-128k": { input: 6, output: 6 },
    },
    notes: "Moonshot Kimi (openai-compat). Variants by context window.",
    thinkingDefault: "omit",
    preferMaxCompletionTokens: false,
    defaultMaxOutputTokens: 8192,
  },
  minimax: {
    name: "minimax",
    adapter: "anthropic", // SPEC: "when it offers an Anthropic-compatible endpoint, uses the Anthropic adapter — optimized cache reads"
    baseUrl: "https://api.minimax.chat",
    envVar: "MiniMax_API_KEY",
    pricing: {
      // MiniMax M2.7 / M3 — prices as published in July/2026.
      // Read caches have a discount; the anthropic adapter handles it automatically
      // (cache_control in the request headers).
      "MiniMax-M2": { input: 0.3, output: 0.6 },
      "MiniMax-M2.7": { input: 0.4, output: 0.8 },
      "MiniMax-M3": { input: 0.5, output: 1.0 },
      "speech-2.8": { input: 0, output: 0 }, // speech — separate pricing
      "image-01": { input: 0, output: 0 }, // image — pricing per image
      "music-2.6": { input: 0, output: 0 }, // music — pricing per track
      "hailuo-2.3": { input: 0, output: 0 }, // video — pricing per second
    },
    notes: "MiniMax Anthropic-compat (caching). OpenAI-compat chat: thinking disabled via model heuristic.",
    thinkingDefault: "disabled",
    preferMaxCompletionTokens: true,
    defaultMaxOutputTokens: 8192,
  },
  gemini: {
    name: "gemini",
    adapter: "openai-compat",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    envVar: "GEMINI_API_KEY",
    pricing: {
      // Gemini also has per-character pricing; below is per 1M tokens.
      "gemini-2.0-flash": { input: 0.1, output: 0.4 },
      "gemini-2.5-pro": { input: 1.25, output: 10 },
      "gemini-2.5-flash": { input: 0.3, output: 2.5 },
    },
    notes: "Google Gemini via openai-compat endpoint (v1beta).",
    thinkingDefault: "omit",
    preferMaxCompletionTokens: false,
    defaultMaxOutputTokens: 8192,
  },
  nvidia: {
    name: "nvidia",
    adapter: "openai-compat",
    baseUrl: "https://integrate.api.nvidia.com",
    envVar: "NVIDIA_API_KEY",
    pricing: {
      // NVIDIA NIM hosts several open-source models. Below, the most common.
      "meta/llama-3.1-70b-instruct": { input: 0.59, output: 0.79 },
      "meta/llama-3.1-8b-instruct": { input: 0.05, output: 0.08 },
      "nvidia/nemotron-4-340b-instruct": { input: 4.2, output: 4.2 },
    },
    notes: "NVIDIA NIM (openai-compat). Meta Llama models, NVIDIA Nemotron etc.",
    thinkingDefault: "omit",
    preferMaxCompletionTokens: false,
    defaultMaxOutputTokens: 8192,
  },
  ollama: {
    name: "ollama",
    adapter: "openai-compat",
    baseUrl: "http://localhost:11434",
    envVar: "OLLAMA_API_KEY", // Optional — local Ollama ignores the key
    credentialOptional: true,
    pricing: {
      // Local Ollama does not charge per token (runs on the user's machine).
      // We report an explicit zero price (not "no price") to make clear that
      // it is $0 cost by design.
      "llama3.3": { input: 0, output: 0 },
      "qwen2.5-coder:32b": { input: 0, output: 0 },
    },
    notes: "Ollama local (openai-compat). No API cost. Runs on localhost:11434.",
    thinkingDefault: "omit",
    preferMaxCompletionTokens: false,
    defaultMaxOutputTokens: 8192,
  },
  lmstudio: {
    name: "lmstudio",
    adapter: "openai-compat",
    baseUrl: "http://localhost:1234",
    envVar: "LMSTUDIO_API_KEY", // Opcional — LMStudio local ignora a key
    credentialOptional: true,
    pricing: {
      "local-model": { input: 0, output: 0 },
    },
    notes: "LM Studio local (openai-compat). Sem custo de API. Roda em localhost:1234.",
    thinkingDefault: "omit",
    preferMaxCompletionTokens: false,
    defaultMaxOutputTokens: 8192,
  },
  // 2026-08-16: entries below use base URLs / env var names cross-checked
  // against the hermes-agent provider documentation (MIT-licensed,
  // github.com/NousResearch/hermes-agent). Pricing left empty where we have
  // no verified table — USD is omitted, tokens stay the primary metric.
  // thinkingDefault stays "omit": the config wizard probe and the batch
  // preflight catch reasoning leaks live, so unknown provider defaults fail
  // loud instead of silently burning budget.
  fireworks: {
    name: "fireworks",
    adapter: "openai-compat",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    envVar: "FIREWORKS_API_KEY",
    pricing: {},
    notes: "Fireworks AI (openai-compat). Model ids use the slash form: accounts/fireworks/models/<name>.",
    thinkingDefault: "omit",
    preferMaxCompletionTokens: false,
    defaultMaxOutputTokens: 8192,
  },
  novita: {
    name: "novita",
    adapter: "openai-compat",
    baseUrl: "https://api.novita.ai/openai/v1",
    envVar: "NOVITA_API_KEY",
    pricing: {},
    notes: "NovitaAI (openai-compat). 200+ models; ids like moonshotai/kimi-k2.5.",
    thinkingDefault: "omit",
    preferMaxCompletionTokens: false,
    defaultMaxOutputTokens: 8192,
  },
  gmi: {
    name: "gmi",
    adapter: "openai-compat",
    baseUrl: "https://api.gmi-serving.com/v1",
    envVar: "GMI_API_KEY",
    pricing: {},
    notes: "GMI Cloud (openai-compat). Use the exact model id from their /v1/models endpoint.",
    thinkingDefault: "omit",
    preferMaxCompletionTokens: false,
    defaultMaxOutputTokens: 8192,
  },
  stepfun: {
    name: "stepfun",
    adapter: "openai-compat",
    baseUrl: "https://api.stepfun.com/v1",
    envVar: "STEPFUN_API_KEY",
    pricing: {},
    notes: "StepFun (openai-compat). Step-series models, e.g. step-3.5-flash.",
    thinkingDefault: "omit",
    preferMaxCompletionTokens: false,
    defaultMaxOutputTokens: 8192,
  },
  huggingface: {
    name: "huggingface",
    adapter: "openai-compat",
    baseUrl: "https://router.huggingface.co/v1",
    envVar: "HF_TOKEN",
    pricing: {},
    notes: "Hugging Face Inference Providers (openai-compat router). Routes to Groq/Together/etc.; suffix :fastest/:cheapest/:provider supported.",
    thinkingDefault: "omit",
    preferMaxCompletionTokens: false,
    defaultMaxOutputTokens: 8192,
  },
  xai: {
    name: "xai",
    adapter: "openai-compat",
    baseUrl: "https://api.x.ai/v1",
    envVar: "XAI_API_KEY",
    pricing: {},
    notes: "xAI Grok (openai-compat chat completions). Grok 4 reasons by default server-side — the wizard probe verifies what the account returns.",
    thinkingDefault: "omit",
    preferMaxCompletionTokens: false,
    defaultMaxOutputTokens: 8192,
  },
  alibaba: {
    name: "alibaba",
    adapter: "openai-compat",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    envVar: "DASHSCOPE_API_KEY",
    pricing: {},
    notes: "Alibaba Qwen Cloud / DashScope (openai-compat). The Coding Plan SKU uses a different endpoint — override baseUrl for it.",
    thinkingDefault: "omit",
    preferMaxCompletionTokens: false,
    defaultMaxOutputTokens: 8192,
  },
};

/** Ordered list of available presets (for error messages / --help). */
export const AVAILABLE_PRESETS: readonly PresetName[] = [
  "anthropic",
  "openai",
  "openrouter",
  "deepseek",
  "kimi",
  "minimax",
  "gemini",
  "nvidia",
  "ollama",
  "lmstudio",
  "fireworks",
  "novita",
  "gmi",
  "stepfun",
  "huggingface",
  "xai",
  "alibaba",
];

/**
 * Resolves a preset by name. Throws UnknownPresetError if the name does not exist.
 */
export function resolvePreset(name: string): ProviderPreset {
  const preset = PRESET_TABLE[name as PresetName];
  if (!preset) {
    throw new UnknownPresetError(name, AVAILABLE_PRESETS);
  }
  return preset;
}

/**
 * Expansion result: preset + config overrides already applied.
 * Each field is the FINAL one that will be used (preset default → config override).
 */
export interface ResolvedProviderConfig {
  presetName: string | null;
  adapter: PresetAdapter;
  baseUrl: string;
  envVar: string;
  credentialOptional: boolean;
  /** Merged pricing: config.pricing overrides preset.pricing per model. */
  pricing: PricingTable;
  /** Preset notes (info, not used at runtime). */
  notes: string;
  thinkingDefault: "disabled" | "adaptive" | "omit" | "n/a";
  preferMaxCompletionTokens: boolean;
  defaultMaxOutputTokens: number;
}

/**
 * Expands preset + config overrides into a final object ready to use.
 * Pure — does not touch disk or env.
 *
 * Resolution order:
 *   1. If `preset` is set: resolves the preset, uses it as the base
 *   2. If only `provider` is set (back-compat): resolves the preset by adapter,
 *      but without baseUrl/envVar/notes (legacy path)
 *   3. Override: config.baseUrl, config.pricing, config.provider override
 *
 * Edge case: `provider` set but no `preset` AND provider is not a known adapter
 * → error in validateConfigForBatch (not here).
 */
export function resolveProviderConfig(args: {
  preset?: string;
  provider?: string;
  baseUrl?: string;
  pricing?: Record<string, ModelPrice>;
}): ResolvedProviderConfig {
  // Path 1: preset set
  if (args.preset) {
    const p = resolvePreset(args.preset);
    // config provider overrides the preset adapter (escape hatch)
    const adapter = (args.provider as PresetAdapter) ?? p.adapter;
    return {
      presetName: p.name,
      adapter,
      baseUrl: args.baseUrl ?? p.baseUrl,
      envVar: p.envVar,
      credentialOptional: p.credentialOptional ?? false,
      pricing: { ...p.pricing, ...(args.pricing ?? {}) },
      notes: p.notes,
      thinkingDefault: p.thinkingDefault ?? "omit",
      preferMaxCompletionTokens: p.preferMaxCompletionTokens ?? false,
      defaultMaxOutputTokens: p.defaultMaxOutputTokens ?? 8192,
    };
  }
  // Path 2: back-compat — only provider set
  if (args.provider) {
    if (args.provider !== "anthropic" && args.provider !== "openai-compat") {
      throw new UnknownPresetError(args.provider, AVAILABLE_PRESETS);
    }
    // No preset: uses the CONFIG_DEFAULTS defaults (config.ts)
    return {
      presetName: null,
      adapter: args.provider,
      baseUrl: args.baseUrl ?? "", // caller resolve via resolveBaseUrl
      envVar: args.provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY",
      credentialOptional: false,
      pricing: args.pricing ?? {},
      notes: "(no preset — using legacy provider field)",
      // openai-compat without preset: MiniMax model names still get thinking disabled in the adapter.
      thinkingDefault: "omit",
      preferMaxCompletionTokens: args.provider === "openai-compat",
      defaultMaxOutputTokens: 8192,
    };
  }
  // None: caller will fail in validateConfigForBatch
  throw new Error(
    "resolveProviderConfig requires preset or provider (validateConfigForBatch catches this earlier)",
  );
}

/**
 * Checks whether a name is a known preset (without throwing).
 * Useful for config validation that reports a friendly error.
 */
export function isKnownPreset(name: string): name is PresetName {
  return Object.prototype.hasOwnProperty.call(PRESET_TABLE, name);
}
