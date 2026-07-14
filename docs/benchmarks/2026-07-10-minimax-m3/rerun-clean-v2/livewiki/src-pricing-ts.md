---
title: src/pricing.ts
owner: generated
anchors:
  - packages/core/src/pricing.ts#PRICING_REFERENCE_DATE
  - packages/core/src/pricing.ts#PRICING_TABLE
  - packages/core/src/pricing.ts#lookupPricing
  - packages/core/src/pricing.ts#calculateCostUsd
  - packages/core/src/pricing.ts#formatCost
---

# pricing

Built-in pricing table plus lookup with config override. Per SPEC §"Contabilidade de tokens (Fase 3)", cost is **measured, not estimated**: `livewiki batch <run>` reports USD based on real API usage, falling back to the embedded table when no override is supplied.

Policy:

- **Embedded table** in core (best-effort, with a reference date) — works out-of-the-box for popular models.
- **User override** per model via `.livewiki/config.json`:
  ```json
  "pricing": { "claude-opus-4-5": { "input": 12, "output": 60 } }
  ```
  Useful when provider prices change before the table is refreshed.
- **Unknown model** → report shows tokens only, never invents a USD figure.

> Prices are best-effort and must be reviewed at every release. `PRICING_REFERENCE_DATE` indicates when the table was last compiled and is carried on every cost line so users know whether they are looking at fresh or stale numbers.

## Reference date

<!-- lw:anchors packages/core/src/pricing.ts#PRICING_REFERENCE_DATE -->

`PRICING_REFERENCE_DATE` is the ISO date the embedded table was compiled. Update it whenever the table is refreshed. Every `PricingLookup` result carries this value so downstream reports can surface staleness.

## Pricing table

<!-- lw:anchors packages/core/src/pricing.ts#PRICING_TABLE -->

`PRICING_TABLE` maps `model` → `ModelPrice` (`{ input: number; output: number }`) expressed in **USD per 1M tokens**. The MVP table covers the Anthropic Claude 4.5+ family and the most common OpenAI-compat models (OpenRouter, LiteLLM, Ollama cloud, etc.). The table is intentionally short: a stale price is worse than a transparent token-only report. Users needing precision supply a `PricingOverride` from `.livewiki/config.json`.

| Model | input ($/1M) | output ($/1M) |
| --- | --- | --- |
| `claude-opus-4-5` | 15 | 75 |
| `claude-sonnet-5` | 3 | 15 |
| `claude-haiku-4` | 0.8 | 4 |
| `gpt-4o` | 5 | 15 |
| `gpt-4o-mini` | 0.15 | 0.6 |

Sources: public provider pricing pages. TODO: link the exact source URLs per model.

## Lookup

<!-- lw:anchors packages/core/src/pricing.ts#lookupPricing -->

`lookupPricing(model, override?)` returns a `PricingLookup`:

- `{ tokensOnly: false, inputUsd, outputUsd, refDate }` when a price is known.
- `{ tokensOnly: true }` when the model is unknown — the report should show tokens only and skip USD.

Resolution order:

1. `override?.[model]` — user config wins.
2. `PRICING_TABLE[model]` — built-in fallback.
3. `{ tokensOnly: true }` — never invent a price.

## Cost calculation

<!-- lw:anchors packages/core/src/pricing.ts#calculateCostUsd -->

`calculateCostUsd(inputTokens, outputTokens, model, override?)` returns `{ input, output, total, refDate } | null`. Internally it delegates to `lookupPricing`; if the lookup is `tokensOnly`, the function returns `null` so callers can render an explicit "(no price for model X)" instead of a fabricated number. Costs are computed as `(tokens * pricePer1M) / 1_000_000`.

## Cost formatting

<!-- lw:anchors packages/core/src/pricing.ts#formatCost -->

`formatCost(cost, model)` renders the human-facing cost string for reports:

- `cost === null` → `` `(no price for model ${model})` `` (explicit absence, never silent).
- otherwise → `` `$${cost.total.toFixed(4)}` ``.

TODO: confirm whether the formatting should respect locale or currency overrides before shipping.