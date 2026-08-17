/**
 * pricing — built-in price table + lookup with config override.
 *
 * SPEC §"Token accounting (Phase 3)": "Savings are the product's central
 * thesis — so they are measured, not estimated". The `livewiki batch <run>`
 * report shows estimated cost in USD FROM REAL API USAGE (not an estimate),
 * using the table below as fallback.
 *
 * Policy:
 *   - Table BUILT INTO the core (best-effort, with a reference date) — works
 *     out-of-the-box for the popular models.
 *   - The user can OVERRIDE per model via `.livewiki/config.json`:
 *       "pricing": { "claude-opus-4-5": { "input": 12, "output": 60 } }
 *     Useful when the price changes before the table is updated.
 *   - Model not found → report shows tokens without USD, NEVER invents one.
 *
 * IMPORTANT: these prices are best-effort. They must be reviewed each release.
 * The `PRICING_REFERENCE_DATE` constant indicates when they were compiled for
 * the last time. Every cost report carries that date — the user knows whether
 * they are looking at a fresh or stale price.
 */

/** Date on which the built-in table was compiled. Update each release. */
export const PRICING_REFERENCE_DATE = "2026-08-13";

/** USD per 1M tokens. Source: the providers' public pricing pages. */
export interface ModelPrice {
  input: number;
  output: number;
}

export type PricingTable = Record<string, ModelPrice>;

/**
 * Built-in table. Covers the MVP's popular models (Anthropic Claude 4.5+
 * + the most used OpenAI-compat). If the user's provider/model is not here,
 * they can add it via `.livewiki/config.json` or accept a report without USD.
 *
 * Kept short on purpose — prices change, and a stale table is worse than a
 * transparent report. A user who needs precision uses the override.
 */
export const PRICING_TABLE: PricingTable = {
  // Anthropic Claude family. Sonnet 5 uses introductory pricing through
  // 2026-08-31; the reference date above makes that temporary rate explicit.
  "claude-opus-4-5": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-haiku-4-5": { input: 1, output: 5 },

  // OpenAI-compat (for OpenRouter, LiteLLM, Ollama cloud, etc.)
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
};

/** Override shape in `.livewiki/config.json`. */
export interface PricingOverride {
  [model: string]: ModelPrice;
}

/**
 * Lookup result. When the model has no price, returns `tokensOnly: true`
 * — the report shows tokens without inventing USD.
 */
export type PricingLookup =
  | { tokensOnly: false; inputUsd: number; outputUsd: number; refDate: string }
  | { tokensOnly: true };

/**
 * Looks up a model's price. Priority order:
 *   1. Config override (the user's — always wins)
 *   2. Built-in table
 *   3. tokensOnly (unknown model — report without USD)
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
 * Calculates the USD cost of ONE LLM call. Returns null if the model has no
 * price (a report without USD is better than an invented number).
 */
export function calculateCostUsd(
  inputTokens: number,
  outputTokens: number,
  model: string,
  override?: PricingOverride,
): { input: number; output: number; total: number; refDate: string } | null {
  const lookup = lookupPricing(model, override);
  if (lookup.tokensOnly) return null;
  // price is per 1M tokens; divide by 1e6
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
