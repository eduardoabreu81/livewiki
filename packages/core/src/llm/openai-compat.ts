/**
 * openai-compat — adapter for OpenAI Chat Completions–compatible APIs.
 *
 * Covers: OpenAI, OpenRouter, LiteLLM, MiniMax chat, Ollama cloud, etc.
 *
 * MiniMax-M3 chat: when thinking is omitted, the API enables thinking by
 * default. For documentation batch we send `thinking: { type: "disabled" }`
 * unless the caller opts into adaptive thinking.
 */

import type { LlmClient } from "./index.js";
import type { GenerateRequest, GenerateResult, StopReason, ThinkingMode } from "./types.js";
import { type AdapterConfig, requestWithRetry, withTimeoutMs } from "./base.js";

export interface OpenAiCompatAdapterOpts {
  apiKey: string;
  baseUrl: string;
  model: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  /** Default thinking when request does not set it. */
  thinkingDefault?: ThinkingMode | "n/a";
  preferMaxCompletionTokens?: boolean;
}

export class OpenAiCompatAdapter implements LlmClient {
  public readonly provider = "openai-compat" as const;
  public readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly config: AdapterConfig;
  private readonly thinkingDefault: ThinkingMode | "n/a";
  private readonly preferMaxCompletionTokens: boolean;

  constructor(opts: OpenAiCompatAdapterOpts) {
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl;
    this.model = opts.model;
    this.thinkingDefault = opts.thinkingDefault ?? "omit";
    this.preferMaxCompletionTokens = opts.preferMaxCompletionTokens ?? false;
    this.config = {
      apiKey: opts.apiKey,
      baseUrl: opts.baseUrl,
      model: opts.model,
      ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
      // Preserve timeoutMs: 0 (disable); never use truthy spread.
      ...withTimeoutMs(opts.timeoutMs),
      ...(opts.maxRetries !== undefined ? { maxRetries: opts.maxRetries } : {}),
      ...(opts.retryDelayMs !== undefined
        ? { retryDelayMs: opts.retryDelayMs }
        : {}),
    };
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const base = this.baseUrl.replace(/\/$/, "");
    const url =
      base.endsWith("/v1") || base.endsWith("/v1/")
        ? `${base}/chat/completions`
        : `${base}/v1/chat/completions`;

    const maxOut = req.maxTokens ?? 4096;
    const body: Record<string, unknown> = {
      model: this.model,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.user },
      ],
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    };

    const preferMaxCompletion =
      req.preferMaxCompletionTokens ?? this.preferMaxCompletionTokens;
    if (preferMaxCompletion) {
      body.max_completion_tokens = maxOut;
    } else {
      body.max_tokens = maxOut;
    }

    const thinking = resolveThinkingMode(
      req.thinking,
      this.thinkingDefault,
      this.model,
    );
    if (thinking === "disabled") {
      body.thinking = { type: "disabled" };
    } else if (thinking === "adaptive") {
      body.thinking = { type: "adaptive" };
    }

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
        ...(raw.usage?.completion_tokens_details?.reasoning_tokens !== undefined
          ? { reasoningTokens: raw.usage.completion_tokens_details.reasoning_tokens }
          : {}),
      },
      stopReason: normalizeFinishReason(raw.choices?.[0]?.finish_reason),
      ...(raw.choices?.[0]?.finish_reason != null
        ? { rawStopReason: raw.choices[0].finish_reason }
        : {}),
    };
  }
}

/** OpenAI-compat `finish_reason` → normalized `StopReason`. */
function normalizeFinishReason(finishReason: string | null | undefined): StopReason {
  if (finishReason === "length") return "length";
  if (finishReason === "stop") return "complete";
  if (finishReason == null) return "unknown";
  return "incomplete";
}

/**
 * Resolve effective thinking mode.
 * MiniMax-M3 chat: omit ⇒ API enables thinking; we force disabled by default
 * when the model name looks like MiniMax-M3 unless the request opts in.
 */
export function resolveThinkingMode(
  requestThinking: ThinkingMode | undefined,
  adapterDefault: ThinkingMode | "n/a",
  model: string,
): ThinkingMode | "omit" {
  if (requestThinking && requestThinking !== "omit") return requestThinking;
  if (requestThinking === "omit") return "omit";

  const def = adapterDefault === "n/a" ? "omit" : adapterDefault;
  if (def === "disabled" || def === "adaptive") return def;

  // Heuristic for openai-compat without minimax preset (bench uses this path).
  if (/minimax-m3/i.test(model) || /^minimax-m3$/i.test(model)) {
    return "disabled";
  }
  return "omit";
}

interface OpenAiCompatResponse {
  choices: Array<{ message: { role: string; content: string }; finish_reason?: string | null }>;
  model: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    completion_tokens_details?: { reasoning_tokens?: number };
  };
}
