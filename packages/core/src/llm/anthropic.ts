/**
 * anthropic — adapter pra API Messages da Anthropic.
 *
 * Endpoint: POST <baseUrl>/v1/messages
 * Headers:
 *   x-api-key: <API key>
 *   anthropic-version: 2023-06-01
 *   content-type: application/json
 *
 * Request body:
 *   {
 *     model, system, messages: [{ role: "user", content: <user> }],
 *     max_tokens: <max_tokens>
 *   }
 *
 * Response (sucesso):
 *   {
 *     content: [{ type: "text", text: "<resposta>" }],
 *     model: "<modelo real>",
 *     usage: { input_tokens, output_tokens }
 *   }
 *
 * Normalização: input_tokens → inputTokens, output_tokens → outputTokens.
 */

import type { LlmClient } from "./index.js";
import type { GenerateRequest, GenerateResult } from "./types.js";
import { type AdapterConfig, requestWithRetry, withTimeoutMs } from "./base.js";

export class AnthropicAdapter implements LlmClient {
  public readonly provider = "anthropic" as const;
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
      ...withTimeoutMs(opts.timeoutMs),
      ...(opts.maxRetries !== undefined ? { maxRetries: opts.maxRetries } : {}),
    };
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const url = `${this.baseUrl.replace(/\/$/, "")}/v1/messages`;
    const body = {
      model: this.model,
      system: req.system,
      messages: [{ role: "user", content: req.user }],
      max_tokens: req.maxTokens ?? 4096,
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    };
    const res = await requestWithRetry(
      this.provider,
      url,
      {
        method: "POST",
        headers: {
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      },
      this.config,
    );
    const raw = (await res.json()) as AnthropicResponse;
    const firstContent = raw.content?.[0];
    const text =
      firstContent && firstContent.type === "text" && typeof firstContent.text === "string"
        ? firstContent.text
        : "";
    return {
      content: text,
      usage: {
        inputTokens: raw.usage.input_tokens,
        outputTokens: raw.usage.output_tokens,
        model: raw.model,
      },
    };
  }
}

interface AnthropicResponse {
  content: Array<{ type: string; text?: string }>;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
}