/**
 * presets — tabela embutida de providers conhecidos (DADOS, não código).
 *
 * SPEC §"Stack" (Fase 5):
 *   "**Presets de provider** (dados, não código): tabela embutida de
 *    providers conhecidos — anthropic, openai, openrouter, deepseek,
 *    kimi, minimax, gemini, nvidia (NIM), ollama e lmstudio (local) —
 *    com baseUrl, adapter, nome da env var e pricing default preenchidos.
 *    `config.json` referencia o preset e pode sobrescrever qualquer campo.
 *    **Regra de adapter**: quando o provider oferece endpoint
 *    Anthropic-compatível (ex.: MiniMax), o preset usa o adapter
 *    Anthropic — leitura de cache otimizada (prompt caching)."
 *
 * Cada preset carrega o SUFICIENTE pra rodar sem mais config:
 *   - adapter: qual `LlmClient` instanciar (anthropic | openai-compat)
 *   - baseUrl: URL base do endpoint
 *   - envVar: nome da env var que carrega a API key
 *   - pricing: tabela de preços default por modelo (best-effort)
 *
 * IMPORTANTE:
 *   - Preços são BEST-EFFORT. Data no `PRICING_REFERENCE_DATE` em pricing.ts.
 *     Usuário pode sobrescrever via `config.pricing.<model>`.
 *   - envVar NUNCA é gravada em config.json / checkpoint / logs / erros
 *     (regra da Fase 3 — `key-leak.test.ts` cobre).
 *   - Adicionar preset = adicionar entry em PRESET_TABLE. Sem código novo.
 *   - Presets carregam TRIVIA DE CONEXÃO (baseUrl, envVar, adapter, pricing)
 *     — nunca suposição comportamental. Defaults de provider mudam sem aviso
 *     (DeepSeek v4 ligou thinking na omissão, 2026-08-16): a segurança mora
 *     no probe (`llm/probe.ts`, wizard + preflight de batch) e na rejeição
 *     `think_block_present`, não em dados de preset.
 *
 * Tabela:
 *   - anthropic: API oficial Anthropic Messages
 *   - openai:    API oficial OpenAI Chat Completions (openai-compat adapter)
 *   - openrouter: agregador (openai-compat)
 *   - deepseek:  OpenAI-compat endpoint
 *   - kimi:      Moonshot Kimi (openai-compat)
 *   - minimax:   MiniMax — Anthropic-compat endpoint → usa adapter anthropic
 *               (prompt caching do adapter aproveita leitura de cache do M2/M3)
 *   - gemini:    Google Gemini via API key (openai-compat endpoint alternativo)
 *   - nvidia:    NVIDIA NIM (openai-compat)
 *   - ollama:    local, sem auth (openai-compat). baseUrl localhost:11434.
 *   - lmstudio:  local, sem auth (openai-compat). baseUrl localhost:1234.
 */

import type { LlmProvider } from "./config.js";
import type { PricingTable, ModelPrice } from "./pricing.js";

/** Adapter usado pelo preset. Mapeia 1:1 com `LlmProvider` interno. */
export type PresetAdapter = LlmProvider;

/** Entrada na tabela de presets. Tudo derivado daqui, sem código novo por preset. */
export interface ProviderPreset {
  /** Nome legível (chave em PRESET_TABLE). */
  readonly name: string;
  /** Adapter LLM que vai ser instanciado (anthropic | openai-compat). */
  readonly adapter: PresetAdapter;
  /** URL base da API. Sem /v1 (adapters resolvem path). */
  readonly baseUrl: string;
  /** Nome da env var que carrega a API key (NÃO o valor). */
  readonly envVar: string;
  /** Whether the adapter may run without a credential (for unauthenticated endpoints). */
  readonly credentialOptional?: boolean;
  /** Pricing default por modelo (USD/1M tokens). Best-effort. */
  readonly pricing: PricingTable;
  /**
   * Notas operacionais curtas. Aparece em `--help` / errors. NÃO inclui
   * a key, NÃO inclui URL de billing — só contexto operacional.
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

/** Tipo da chave da tabela. Literal union pra autocomplete em IDE. */
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
  | "lmstudio";

/** Erro lançado quando nome do preset é desconhecido. */
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
 * TABELA DE PRESETS — adicionar provider = adicionar entry aqui.
 *
 * Preços são best-effort (PRICING_REFERENCE_DATE em pricing.ts). Onde não
 * temos preço confiável, omitimos — `pricing.ts:lookupPricing` devolve
 * `tokensOnly` nesse caso (reporte sem USD, conforme regra do produto).
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
      // OpenRouter repassa preços dos providers — tabela abaixo é a média
      // dos modelos mais populares. Override via config.pricing pra precisão.
      "anthropic/claude-sonnet-4-5": { input: 3, output: 15 },
      "openai/gpt-4o": { input: 5, output: 15 },
      "google/gemini-2.0-flash": { input: 0.1, output: 0.4 },
    },
    notes: "Agregador (openai-compat). Modelos prefixados (ex.: anthropic/claude-sonnet-4-5).",
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
      // Moonshot/Kimi cobra por 1M tokens em CNY; abaixo é aprox. USD.
      "moonshot-v1-8k": { input: 1.5, output: 1.5 },
      "moonshot-v1-32k": { input: 3, output: 3 },
      "moonshot-v1-128k": { input: 6, output: 6 },
    },
    notes: "Moonshot Kimi (openai-compat). Variantes por janela de contexto.",
    thinkingDefault: "omit",
    preferMaxCompletionTokens: false,
    defaultMaxOutputTokens: 8192,
  },
  minimax: {
    name: "minimax",
    adapter: "anthropic", // SPEC: "quando oferece endpoint Anthropic-compatível, usa adapter Anthropic — leitura de cache otimizada"
    baseUrl: "https://api.minimax.chat",
    envVar: "MiniMax_API_KEY",
    pricing: {
      // MiniMax M2.7 / M3 — preços conforme publicado em julho/2026.
      // Caches de leitura têm desconto; o adapter anthropic trata automaticamente
      // (cache_control nos headers de request).
      "MiniMax-M2": { input: 0.3, output: 0.6 },
      "MiniMax-M2.7": { input: 0.4, output: 0.8 },
      "MiniMax-M3": { input: 0.5, output: 1.0 },
      "speech-2.8": { input: 0, output: 0 }, // speech — pricing separado
      "image-01": { input: 0, output: 0 }, // imagem — pricing por imagem
      "music-2.6": { input: 0, output: 0 }, // música — pricing por faixa
      "hailuo-2.3": { input: 0, output: 0 }, // vídeo — pricing por segundo
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
      // Gemini tem pricing por caractere também; abaixo é por 1M tokens.
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
      // NVIDIA NIM hospeda vários modelos open-source. Abaixo, os mais comuns.
      "meta/llama-3.1-70b-instruct": { input: 0.59, output: 0.79 },
      "meta/llama-3.1-8b-instruct": { input: 0.05, output: 0.08 },
      "nvidia/nemotron-4-340b-instruct": { input: 4.2, output: 4.2 },
    },
    notes: "NVIDIA NIM (openai-compat). Modelos Meta Llama, NVIDIA Nemotron etc.",
    thinkingDefault: "omit",
    preferMaxCompletionTokens: false,
    defaultMaxOutputTokens: 8192,
  },
  ollama: {
    name: "ollama",
    adapter: "openai-compat",
    baseUrl: "http://localhost:11434",
    envVar: "OLLAMA_API_KEY", // Opcional — Ollama local ignora a key
    credentialOptional: true,
    pricing: {
      // Ollama local não cobra por token (roda na máquina do usuário).
      // Reportamos preço zero explícito (não "sem preço") pra deixar claro
      // que é custo $0 por design.
      "llama3.3": { input: 0, output: 0 },
      "qwen2.5-coder:32b": { input: 0, output: 0 },
    },
    notes: "Ollama local (openai-compat). Sem custo de API. Roda em localhost:11434.",
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
};

/** Lista ordenada dos presets disponíveis (pra mensagens de erro / --help). */
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
];

/**
 * Resolve um preset por nome. Lança UnknownPresetError se nome não existe.
 */
export function resolvePreset(name: string): ProviderPreset {
  const preset = PRESET_TABLE[name as PresetName];
  if (!preset) {
    throw new UnknownPresetError(name, AVAILABLE_PRESETS);
  }
  return preset;
}

/**
 * Resultado da expansão: preset + overrides do config já aplicados.
 * Cada campo é o FINAL que vai ser usado (preset default → config override).
 */
export interface ResolvedProviderConfig {
  presetName: string | null;
  adapter: PresetAdapter;
  baseUrl: string;
  envVar: string;
  credentialOptional: boolean;
  /** Pricing merged: config.pricing sobrescreve preset.pricing por modelo. */
  pricing: PricingTable;
  /** Notas do preset (info, não usado em runtime). */
  notes: string;
  thinkingDefault: "disabled" | "adaptive" | "omit" | "n/a";
  preferMaxCompletionTokens: boolean;
  defaultMaxOutputTokens: number;
}

/**
 * Expande preset + overrides do config num objeto final pronto pra uso.
 * Pura — não toca em disco nem em env.
 *
 * Ordem de resolução:
 *   1. Se `preset` set: resolve preset, usa como base
 *   2. Se só `provider` set (back-compat): resolve preset pelo adapter,
 *      mas sem baseUrl/envVar/notes (legacy path)
 *   3. Override: config.baseUrl, config.pricing, config.provider sobrescrevem
 *
 * Edge case: `provider` set mas sem `preset` E provider não é adapter conhecido
 * → erro em validateConfigForBatch (não aqui).
 */
export function resolveProviderConfig(args: {
  preset?: string;
  provider?: string;
  baseUrl?: string;
  pricing?: Record<string, ModelPrice>;
}): ResolvedProviderConfig {
  // Caminho 1: preset set
  if (args.preset) {
    const p = resolvePreset(args.preset);
    // provider do config sobrescreve o adapter do preset (escape hatch)
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
  // Caminho 2: back-compat — só provider set
  if (args.provider) {
    if (args.provider !== "anthropic" && args.provider !== "openai-compat") {
      throw new UnknownPresetError(args.provider, AVAILABLE_PRESETS);
    }
    // Sem preset: usa defaults do CONFIG_DEFAULTS (config.ts)
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
  // Nenhum: caller vai falhar em validateConfigForBatch
  throw new Error(
    "resolveProviderConfig requires preset or provider (validateConfigForBatch catches this earlier)",
  );
}

/**
 * Verifica se um nome é um preset conhecido (sem lançar).
 * Útil pra validação de config que reporta erro amigável.
 */
export function isKnownPreset(name: string): name is PresetName {
  return Object.prototype.hasOwnProperty.call(PRESET_TABLE, name);
}
