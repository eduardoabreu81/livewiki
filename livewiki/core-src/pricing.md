---
title: pricing — token-cost lookup and USD formatting
owner: generated
anchors:
  - packages/core/src/pricing.ts#PRICING_REFERENCE_DATE
  - packages/core/src/pricing.ts#PRICING_TABLE
  - packages/core/src/pricing.ts#lookupPricing
  - packages/core/src/pricing.ts#calculateCostUsd
  - packages/core/src/pricing.ts#formatCost
---

# pricing — token-cost lookup and USD formatting

This page is responsible for converting measured token usage into a USD cost figure, using a built-in price table plus a per-model user override.

## When to use this page

- **Resolve** the USD-per-token rate for a model when reporting a `livewiki batch <run>`.
- **Override** the built-in price for a specific model via `.livewiki/config.json` when the vendor changes its published price.
- **Render** the calculated cost as a human-readable string for the report, or render an explicit "(no price for model X)" string when the model is unknown.
- **Read** `PRICING_REFERENCE_DATE` to communicate how stale the built-in table is in any cost line you emit.

## How it fits

`packages/core/src/pricing.ts` lives in the core package alongside the other domain primitives the CLI reuses. It is consumed by the batch reporting layer: that layer measures real input/output tokens from each provider call and asks this module to translate them into USD. The module is intentionally short — it owns the policy "economia é tese central do produto — então é medida, não estimada" from the spec, so it deliberately fails open to "tokens only, no USD" rather than fabricate a number when the model is unknown. Nothing here touches the network; all prices come from a compile-time constant or from a config file the caller has already loaded.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-pricing.mmd
```

## Resolving a model's price

<!-- lw:anchors packages/core/src/pricing.ts#lookupPricing packages/core/src/pricing.ts#PRICING_TABLE packages/core/src/pricing.ts#PRICING_REFERENCE_DATE -->

The first responsibility is the lookup itself: given a model identifier, return either a concrete price pair stamped with the reference date, or an explicit "tokens only" signal so the caller can render the absence of data instead of inventing a number.

The function that implements this is `lookupPricing`, with the following signature copied verbatim from the symbol table:

```ts
export function lookupPricing(model: string, override?: PricingOverride): PricingLookup
```

`lookupPricing` takes a model name plus an optional per-model override map and returns a `PricingLookup` — either `{ tokensOnly: false, inputUsd, outputUsd, refDate }` when a price is known, or `{ tokensOnly: true }` when the model is not priced anywhere.

Resolution order is three-tiered. First, `lookupPricing` consults `override?.[model]` — the user's `.livewiki/config.json` always wins because vendors change their public price before this package's release can catch up. Second, it falls back to `PRICING_TABLE[model]`, the built-in `Record<string, ModelPrice>` covering the popular MVP models across Anthropic Claude 4.5+ and the OpenAI-compatible providers (OpenRouter, LiteLLM, Ollama cloud, etc.). Third, when both lookups miss, it returns `{ tokensOnly: true }` so the report shows raw tokens without a fabricated USD figure. The `refDate` it stamps on the success branch is `PRICING_REFERENCE_DATE`, a `const` string exported alongside the table so every consumer can advertise how fresh the embedded prices are.

At the 2026-08-13 reference date, the built-in USD-per-million-token entries are Claude Opus 4.5 at $5 input / $25 output, Claude Sonnet 5 at its $2 / $10 introductory rate through 2026-08-31, Claude Haiku 4.5 at $1 / $5, GPT-4o at $2.50 / $10, and GPT-4o mini at $0.15 / $0.60. The date is part of the output contract precisely because these defaults are a release snapshot, not a live billing feed.

## Computing the cost of a single call

<!-- lw:anchors packages/core/src/pricing.ts#calculateCostUsd -->

Once a price pair is known, the next step is to apply it to the measured token counts. This is the responsibility of `calculateCostUsd`:

```ts
export function calculateCostUsd(
  inputTokens: number,
  outputTokens: number,
  model: string,
  override?: PricingOverride,
): { input: number; output: number; total: number; refDate: string } | null
```

`calculateCostUsd` takes input and output token counts, a model name, and the same optional override map, and returns either a broken-out USD cost with a reference date or `null` when the model has no price anywhere.

Internally it delegates to `lookupPricing` to reuse the override-then-table resolution and the "tokens only" fail path; on the tokens-only branch it short-circuits to `null` rather than producing a misleading zero. On the success branch it multiplies each token count by the matching per-million USD rate and divides by `1_000_000`, then sums the two halves into a `total`. The returned object exposes `input`, `output`, `total`, and the `refDate` carried through from the lookup, so callers can display either the aggregate or a per-direction breakdown.

## Rendering the cost in a report

<!-- lw:anchors packages/core/src/pricing.ts#formatCost -->

The final responsibility is presenting the cost in a way that is honest about missing data. That is `formatCost`:

```ts
export function formatCost(cost: { total: number } | null, model: string): string
```

`formatCost` takes either a cost object (only `total` is consulted) or `null`, plus the model name, and returns the string the report prints.

When the cost is `null` — i.e. `calculateCostUsd` could not resolve a price — the function returns the literal string `(no price for model X)`, making the absence of data visible to the user instead of hiding it behind a `$0.0000`. When a cost object is provided, it returns `` `$${cost.total.toFixed(4)}` ``: a dollar sign followed by the total rounded to four decimal places. The narrow input type `{ total: number } | null` deliberately rejects the full per-direction shape returned by `calculateCostUsd`; callers that have the richer object only need to forward the `total` field.

## Tests

Covered by `packages/core/src/pricing.test.ts` (same-name test file on disk).
