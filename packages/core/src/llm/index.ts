/**
 * llm/index — interface pública do LLM client + factory.
 *
 * SPEC §"Stack": "cliente HTTP fino próprio, providers: Anthropic +
 * OpenAI-compatível (base URL configurável cobre OpenRouter/LiteLLM/Ollama).
 * Sem framework de agentes."
 *
 * **Sem SDK**: usa fetch nativo do Node 20+. Mantém deps mínimas e permite
 * controle total do shape normalizado do usage.
 *
 * **Sem modelo default**: `createLlmClient` chama `validateConfigForBatch`
 * (delegando pro config.ts). Se provider ou model ausentes, lança
 * MissingProviderConfigError com mensagem clara.
 *
 * **API key SÓ via env var**: `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`.
 * NUNCA lida de config.json, checkpoint_json, logs ou mensagens de erro.
 */

import type { LivewikiConfig, LlmProvider } from "../config.js";
import {
  validateConfigForBatch,
  resolveBaseUrl,
  resolveProviderFromConfig,
  MissingProviderConfigError,
} from "../config.js";
import type { GenerateRequest, GenerateResult } from "./types.js";
import { AnthropicAdapter } from "./anthropic.js";
import { OpenAiCompatAdapter } from "./openai-compat.js";

/** Interface pública do client. Só o que `batch.ts` (e outros) precisam. */
export interface LlmClient {
  readonly provider: LlmProvider;
  readonly model: string;
  generate(req: GenerateRequest): Promise<GenerateResult>;
}

/**
 * Cria o LLM client a partir do config validado + env var da API key.
 *
 * Resolução do provider:
 *   1. config.preset (Fase 5 step 5) → expande em adapter/baseUrl/envVar/pricing
 *   2. config.provider (Fase 3 legacy) → adapter + baseUrl default + envVar default
 *   3. Sem nenhum → MissingProviderConfigError (validateConfigForBatch)
 *
 * Env var name:
 *   - preset set: vem do preset (ex.: "minimax" → "MiniMax_API_KEY")
 *   - provider set, sem preset: ANTHROPIC_API_KEY / OPENAI_API_KEY
 *
 * Throw chain:
 *   - config.provider/preset ausente (validateConfigForBatch)
 *   - config.model ausente (validateConfigForBatch)
 *   - env var da API key ausente (resolveProviderFromConfig + MissingApiKeyError)
 */
export function createLlmClient(repoRoot: string, config: LivewikiConfig): LlmClient {
  // Validates provider/model and timeoutMs (even when not from loadConfig).
  validateConfigForBatch(repoRoot, config);
  // Após validateConfigForBatch, provider/preset e model são garantidos string.
  const resolved = resolveProviderFromConfig(config);
  const model = config.model as string;
  // baseUrl: prefer config explícita, senão preset baseUrl, senão default por provider
  const baseUrl = resolved.baseUrl || resolveBaseUrl(config);

  // Lê a key da env var certa (vem do preset OU do adapter legacy)
  const apiKey = process.env[resolved.envVar];
  if (!apiKey) {
    throw new MissingApiKeyError(resolved.adapter, resolved.envVar);
  }

  // Client/provider timeout from config (default applied in requestWithRetry).
  // Use explicit undefined checks so timeoutMs: 0 (disable) is preserved.
  const timeoutOpts =
    config.timeoutMs !== undefined ? { timeoutMs: config.timeoutMs } : {};

  if (resolved.adapter === "anthropic") {
    return new AnthropicAdapter({ apiKey, baseUrl, model, ...timeoutOpts });
  }
  // openai-compat — pass preset defaults for thinking / token field name
  return new OpenAiCompatAdapter({
    apiKey,
    baseUrl,
    model,
    thinkingDefault: resolved.thinkingDefault,
    preferMaxCompletionTokens: resolved.preferMaxCompletionTokens,
    ...timeoutOpts,
  });
}

/**
 * Erro lançado quando env var da API key está ausente.
 * Mensagem NUNCA menciona o valor (não tem como vazar o que não está lá).
 */
export class MissingApiKeyError extends Error {
  public readonly provider: LlmProvider;
  public readonly envVar: string;
  constructor(provider: LlmProvider, envVar: string) {
    super(
      `Missing API key for provider "${provider}". ` +
        `Set env var ${envVar} before running the batch. ` +
        `Keys never live in config.json, checkpoint_json, logs, or error messages.`,
    );
    this.name = "MissingApiKeyError";
    this.provider = provider;
    this.envVar = envVar;
  }
}

/**
 * Erro de chamada LLM — quando o provider retorna erro ou a request falha.
 * A mensagem carrega o `errorBody` do provider (limitado), mas NUNCA os
 * headers (que contêm a key). Coberto por key-leak.test.ts.
 */
export class LlmRequestError extends Error {
  public readonly status: number;
  public readonly provider: LlmProvider;
  public readonly errorBody: string;
  constructor(provider: LlmProvider, status: number, errorBody: string) {
    // Trunca body pra não despejar JSON gigante em mensagens
    const truncated = errorBody.length > 500 ? errorBody.slice(0, 500) + "..." : errorBody;
    super(`LLM ${provider} request failed (status ${status}): ${truncated}`);
    this.name = "LlmRequestError";
    this.status = status;
    this.provider = provider;
    this.errorBody = errorBody;
  }
}

export { LlmTimeoutError, DEFAULT_LLM_TIMEOUT_MS } from "./base.js";

export type { GenerateRequest, GenerateResult, LlmUsage, StopReason } from "./types.js";