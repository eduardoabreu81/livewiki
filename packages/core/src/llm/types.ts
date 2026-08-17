/**
 * llm/types — types shared by the LLM client and the adapters.
 *
 * Step 3 of the Phase 3 plan will populate the adapters. Here, only the canonical shape
 * used by batch-state.ts and the other modules that depend on normalized usage.
 */

/**
 * Normalized usage — the only format the rest of the code accepts.
 * Adapters translate from the provider's raw format:
 *   - Anthropic: { input_tokens, output_tokens } → { inputTokens, outputTokens }
 *   - OpenAI-compat: { prompt_tokens, completion_tokens } → { inputTokens, outputTokens }
 *
 * `model` is what the provider returned (not what we asked for) — it can diverge
 * on fallbacks or aliases, and the report needs the real value for cost
 * computation.
 */
export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  model: string;
  /**
   * Reasoning/thinking tokens when the provider reports them (openai-compat
   * `completion_tokens_details.reasoning_tokens`). Already INCLUDED in
   * `outputTokens` — diagnostic only, used by the connectivity probe to
   * detect a thinking leak. Never used for accounting.
   */
  reasoningTokens?: number;
}

/**
 * Thinking / reasoning control for providers that support it.
 * - `disabled` — request no thinking (e.g. MiniMax-M3 chat `thinking.type=disabled`)
 * - `adaptive` — allow provider thinking
 * - `omit` — do not send the field (provider default)
 */
export type ThinkingMode = "disabled" | "adaptive" | "omit";

/** Canonical request — the only shape adapters accept. */
export interface GenerateRequest {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  /** When set, openai-compat may map this to provider-specific fields. */
  thinking?: ThinkingMode;
  /**
   * Prefer `max_completion_tokens` over legacy `max_tokens` (MiniMax/OpenAI
   * newer APIs). Default false for broad compatibility.
   */
  preferMaxCompletionTokens?: boolean;
}

/**
 * Normalized stop/finish signal — same normalization pattern as `LlmUsage`.
 * Adapters translate the provider-specific field:
 *   - OpenAI-compat: `choices[0].finish_reason` (`"length"` = cut by max_tokens)
 *   - Anthropic: `stop_reason` (`"max_tokens"` = cut by max_tokens)
 *
 * `"length"` means the response was truncated by the token limit.
 * `"incomplete"` covers a known non-completion such as tool use, content
 * filtering, or refusal. `"unknown"` preserves backward compatibility for
 * providers and test doubles that do not expose a reason.
 *
 * Optional so existing integrations that do not expose the field remain
 * compatible; callers treat `undefined` as `"unknown"`, never as proof of
 * completion.
 */
export type StopReason = "complete" | "length" | "incomplete" | "unknown";

/** Canonical response — the only shape adapters return. */
export interface GenerateResult {
  content: string;
  usage: LlmUsage;
  stopReason?: StopReason;
  /** Provider value retained for checkpoints and diagnostics. */
  rawStopReason?: string;
}
