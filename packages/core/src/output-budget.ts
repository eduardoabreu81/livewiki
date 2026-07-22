/**
 * output-budget — deterministic, content-scaled LLM output-token budgets.
 *
 * Priority-0 fix (2026-07-22, paid E2E against MoneyPrinterTurbo-Plus): a
 * large module ("test-services-02") failed 3/3 attempts with
 * `truncated_by_token_limit` against the flat `stage4MaxOutputTokens`
 * default (8192), while smaller modules never came close to that ceiling.
 * A single fixed budget applied to every module/flow/topic regardless of
 * how many anchors it must document silently starves the large ones. This
 * module computes a budget from the actual content size instead.
 *
 * The formula and its constants (`base`/`perAnchor`/floor/ceiling below)
 * are a first-pass engineering estimate, not calibrated against measured
 * token usage — a TODO for calibrating them against real
 * `usageHistory`/`closedKeyList.length` correlations from past runs once
 * enough paid E2E data exists.
 */

export interface OutputBudgetSignals {
  /** Number of closed-list anchors the page must cite (each needs prose + a marker). */
  anchorCount: number;
  /**
   * Sum of `TopicPlanningInventory.anchorSourceChars` for the cited
   * anchors, when available (topics only) — a proxy for how much source
   * material backs the page, additive to the per-anchor term.
   */
  anchorSourceChars?: number;
}

export interface OutputBudgetOptions {
  /** Fixed cost of the page skeleton (frontmatter, H1, fixed sections, minimal prose). */
  base: number;
  /** Tokens per anchor (prose paragraph + marker close). */
  perAnchor: number;
  /** Never return less than this, regardless of signals. */
  floor: number;
  /** Never return more than this, regardless of signals. */
  ceiling: number;
}

/** Preset for module pages, flow pages, and individual topic-page prose. */
export const MODULE_OUTPUT_BUDGET_OPTIONS: OutputBudgetOptions = {
  base: 2048,
  perAnchor: 300,
  floor: 4096,
  ceiling: 32_768,
};

/** Preset for the topic-plan LLM refine pass — a compact structured payload, not final prose. */
export const TOPIC_REFINE_OUTPUT_BUDGET_OPTIONS: OutputBudgetOptions = {
  base: 1024,
  perAnchor: 40,
  floor: 4096,
  ceiling: 32_768,
};

const TOKEN_ROUNDING_STEP = 256;

/** Chars of anchor source material approximated as one output token (the page summarizes, not copies). */
const SOURCE_CHARS_PER_OUTPUT_TOKEN = 40;

/**
 * Computes a content-scaled `maxTokens` budget: `base + perAnchor *
 * anchorCount`, plus `ceil(anchorSourceChars / 40)` when supplied,
 * rounded up to the nearest 256 (the token granularity most providers
 * already treat `max_tokens` at), then clamped to `[floor, ceiling]`.
 */
export function computeDynamicOutputTokenBudget(
  signals: OutputBudgetSignals,
  opts: OutputBudgetOptions,
): number {
  const anchorCount = Math.max(0, signals.anchorCount);
  let raw = opts.base + opts.perAnchor * anchorCount;
  if (signals.anchorSourceChars !== undefined && signals.anchorSourceChars > 0) {
    raw += Math.ceil(signals.anchorSourceChars / SOURCE_CHARS_PER_OUTPUT_TOKEN);
  }
  const rounded = Math.ceil(raw / TOKEN_ROUNDING_STEP) * TOKEN_ROUNDING_STEP;
  return Math.min(opts.ceiling, Math.max(opts.floor, rounded));
}
