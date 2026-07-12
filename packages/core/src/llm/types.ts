/**
 * llm/types — tipos compartilhados pelo LLM client e adapters.
 *
 * Step 3 do plano da Fase 3 vai popular os adapters. Aqui só o shape canônico
 * usado por batch-state.ts e demais módulos que dependem de usage normalizado.
 */

/**
 * Usage normalizado — único formato que o resto do código aceita.
 * Adapters traduzem do formato bruto do provider:
 *   - Anthropic: { input_tokens, output_tokens } → { inputTokens, outputTokens }
 *   - OpenAI-compat: { prompt_tokens, completion_tokens } → { inputTokens, outputTokens }
 *
 * `model` é o que o provider devolveu (não o que pedimos) — pode divergir
 * em fallbacks ou aliases, e o reporte precisa do valor real pra cálculo de
 * custo.
 */
export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  model: string;
}

/**
 * Thinking / reasoning control for providers that support it.
 * - `disabled` — request no thinking (e.g. MiniMax-M3 chat `thinking.type=disabled`)
 * - `adaptive` — allow provider thinking
 * - `omit` — do not send the field (provider default)
 */
export type ThinkingMode = "disabled" | "adaptive" | "omit";

/** Request canônica — única forma que adapters aceitam. */
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

/** Response canônica — única forma que adapters retornam. */
export interface GenerateResult {
  content: string;
  usage: LlmUsage;
  stopReason?: StopReason;
  /** Provider value retained for checkpoints and diagnostics. */
  rawStopReason?: string;
}
