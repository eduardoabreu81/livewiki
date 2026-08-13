/**
 * pricing — tabela de preços embutida + lookup com override do config.
 *
 * SPEC §"Contabilidade de tokens (Fase 3)": "Economia é tese central do
 * produto — então é medida, não estimada". O reporte `livewiki batch <run>`
 * mostra custo estimado em USD POR USO REAL DA API (não estimativa), usando
 * a tabela abaixo como fallback.
 *
 * Política:
 *   - Tabela EMBUTIDA no core (best-effort, com data de referência) — funciona
 *     out-of-the-box para os modelos populares.
 *   - Usuário pode SOBRESCREVER por modelo via `.livewiki/config.json`:
 *       "pricing": { "claude-opus-4-5": { "input": 12, "output": 60 } }
 *     Útil quando o preço muda antes da tabela ser atualizada.
 *   - Modelo não encontrado → reporte mostra tokens sem USD, NUNCA inventa.
 *
 * IMPORTANTE: estes preços são best-effort. Devem ser revisados a cada release.
 * A constante `PRICING_REFERENCE_DATE` indica quando foram compilados pela
 * última vez. Todo reporte de custo carrega essa data — usuário sabe se está
 * olhando preço fresco ou stale.
 */

/** Data em que a tabela embutida foi compilada. Atualizar a cada release. */
export const PRICING_REFERENCE_DATE = "2026-08-13";

/** USD por 1M tokens. Source: páginas públicas de pricing dos providers. */
export interface ModelPrice {
  input: number;
  output: number;
}

export type PricingTable = Record<string, ModelPrice>;

/**
 * Tabela embutida. Cobre os modelos populares do MVP (Anthropic Claude 4.5+
 * + OpenAI-compat mais usados). Se o provider/modelo do usuário não está aqui,
 * ele pode adicionar via `.livewiki/config.json` ou aceitar reporte sem USD.
 *
 * Mantida curta de propósito — preços mudam, tabela stale é pior do que
 * reporte transparente. Usuário que precisa de precisão usa o override.
 */
export const PRICING_TABLE: PricingTable = {
  // Anthropic Claude family. Sonnet 5 uses introductory pricing through
  // 2026-08-31; the reference date above makes that temporary rate explicit.
  "claude-opus-4-5": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-haiku-4-5": { input: 1, output: 5 },

  // OpenAI-compat (pra OpenRouter, LiteLLM, Ollama cloud, etc.)
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
};

/** Override shape em `.livewiki/config.json`. */
export interface PricingOverride {
  [model: string]: ModelPrice;
}

/**
 * Resultado do lookup. Quando o modelo não tem preço, retorna `tokensOnly: true`
 * — o reporte mostra tokens sem inventar USD.
 */
export type PricingLookup =
  | { tokensOnly: false; inputUsd: number; outputUsd: number; refDate: string }
  | { tokensOnly: true };

/**
 * Procura o preço de um modelo. Ordem de prioridade:
 *   1. Override do config (do usuário — sempre vence)
 *   2. Tabela embutida
 *   3. tokensOnly (modelo desconhecido — reporte sem USD)
 */
export function lookupPricing(model: string, override?: PricingOverride): PricingLookup {
  const fromOverride = override?.[model];
  const fromTable = PRICING_TABLE[model];
  const price = fromOverride ?? fromTable;
  if (!price) {
    return { tokensOnly: true };
  }
  return {
    tokensOnly: false,
    inputUsd: price.input,
    outputUsd: price.output,
    refDate: PRICING_REFERENCE_DATE,
  };
}

/**
 * Calcula o custo em USD de UMA chamada LLM. Retorna null se o modelo não
 * tem preço (reporte sem USD é melhor que número inventado).
 */
export function calculateCostUsd(
  inputTokens: number,
  outputTokens: number,
  model: string,
  override?: PricingOverride,
): { input: number; output: number; total: number; refDate: string } | null {
  const lookup = lookupPricing(model, override);
  if (lookup.tokensOnly) return null;
  // price é por 1M tokens; divide por 1e6
  const input = (inputTokens * lookup.inputUsd) / 1_000_000;
  const output = (outputTokens * lookup.outputUsd) / 1_000_000;
  return {
    input,
    output,
    total: input + output,
    refDate: lookup.refDate,
  };
}

/**
 * Formats cost for the human report. If cost is null, returns the string
 * "(no price for model X)" to make the absence of data explicit.
 */
export function formatCost(cost: { total: number } | null, model: string): string {
  if (cost === null) return `(no price for model ${model})`;
  return `$${cost.total.toFixed(4)}`;
}
