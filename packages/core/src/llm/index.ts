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
import { validateConfigForBatch, resolveBaseUrl, MissingProviderConfigError } from "../config.js";
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
 * Throw chain (todos MissingProviderConfigError):
 *   - config.provider ausente
 *   - config.model ausente
 *   - env var da API key ausente (varia por provider)
 */
export function createLlmClient(repoRoot: string, config: LivewikiConfig): LlmClient {
  validateConfigForBatch(repoRoot, config);
  // Após validateConfigForBatch, provider e model são garantidos string.
  const provider = config.provider as LlmProvider;
  const model = config.model as string;
  const baseUrl = resolveBaseUrl(config);

  if (provider === "anthropic") {
    const apiKey = process.env["ANTHROPIC_API_KEY"];
    if (!apiKey) {
      throw new MissingApiKeyError("anthropic", "ANTHROPIC_API_KEY");
    }
    return new AnthropicAdapter({ apiKey, baseUrl, model });
  }
  // openai-compat
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) {
    throw new MissingApiKeyError("openai-compat", "OPENAI_API_KEY");
  }
  return new OpenAiCompatAdapter({ apiKey, baseUrl, model });
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

export type { GenerateRequest, GenerateResult, LlmUsage } from "./types.js";