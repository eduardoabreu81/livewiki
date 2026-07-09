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

/** Request canônica — única forma que adapters aceitam. */
export interface GenerateRequest {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
}

/** Response canônica — única forma que adapters retornam. */
export interface GenerateResult {
  content: string;
  usage: LlmUsage;
}