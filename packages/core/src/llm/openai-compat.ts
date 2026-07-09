/**
 * openai-compat — adapter pra APIs compatíveis com OpenAI Chat Completions.
 *
 * Cobre: OpenAI, OpenRouter, LiteLLM, Ollama cloud, etc. — qualquer provedor
 * que aceite POST <baseUrl>/v1/chat/completions no formato OpenAI.
 *
 * Endpoint: POST <baseUrl>/v1/chat/completions
 *   - Se config.baseUrl já termina com /v1, usa direto; senão adiciona.
 * Headers:
 *   Authorization: Bearer <API key>
 *   content-type: application/json
 *
 * Request body:
 *   {
 *     model, messages: [{ role: "system", content }, { role: "user", content }],
 *     max_tokens, temperature?
 *   }
 *
 * Response (sucesso):
 *   {
 *     choices: [{ message: { role: "assistant", content: "<texto>" } }],
 *     model: "<modelo>",
 *     usage: { prompt_tokens, completion_tokens }
 *   }
 *
 * Normalização: prompt_tokens → inputTokens, completion_tokens → outputTokens.
 */

import type { LlmClient } from "./index.js";
import type { GenerateRequest, GenerateResult } from "./types.js";
import { type AdapterConfig, requestWithRetry } from "./base.js";

export class OpenAiCompatAdapter implements LlmClient {
  public readonly provider = "openai-compat" as const;
  public readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly config: AdapterConfig;

  constructor(opts: { apiKey: string; baseUrl: string; model: string; fetchImpl?: typeof fetch; timeoutMs?: number; maxRetries?: number }) {
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl;
    this.model = opts.model;
    this.config = {
      apiKey: opts.apiKey,
      baseUrl: opts.baseUrl,
      model: opts.model,
      ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
      ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
      ...(opts.maxRetries ? { maxRetries: opts.maxRetries } : {}),
    };
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    // Resolve URL: se baseUrl termina em /v1 ou /v1/, usa direto. Senão anexa /v1/chat/completions.
    const base = this.baseUrl.replace(/\/$/, "");
    const url = base.endsWith("/v1") || base.endsWith("/v1/")
      ? `${base}/chat/completions`
      : `${base}/v1/chat/completions`;

    const body = {
      model: this.model,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.user },
      ],
      max_tokens: req.maxTokens ?? 4096,
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    };
    const res = await requestWithRetry(
      this.provider,
      url,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      },
      this.config,
    );
    const raw = (await res.json()) as OpenAiCompatResponse;
    const text = raw.choices?.[0]?.message?.content ?? "";
    return {
      content: text,
      usage: {
        inputTokens: raw.usage?.prompt_tokens ?? 0,
        outputTokens: raw.usage?.completion_tokens ?? 0,
        model: raw.model,
      },
    };
  }
}

interface OpenAiCompatResponse {
  choices: Array<{ message: { role: string; content: string } }>;
  model: string;
  usage?: { prompt_tokens: number; completion_tokens: number };
}