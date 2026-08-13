---
title: Output token budget computation
owner: generated
anchors:
  - packages/core/src/output-budget.ts#MODULE_OUTPUT_BUDGET_OPTIONS
  - packages/core/src/output-budget.ts#TOPIC_REFINE_OUTPUT_BUDGET_OPTIONS
  - packages/core/src/output-budget.ts#computeDynamicOutputTokenBudget
---

# Output token budget computation

This page documents the module that computes a deterministic, content-scaled LLM output-token budget for livewiki documentation pages.

## When to use this page

- **Choose** the right preset (`MODULE_OUTPUT_BUDGET_OPTIONS` vs `TOPIC_REFINE_OUTPUT_BUDGET_OPTIONS`) for the page kind you are about to generate.
- **Call** `computeDynamicOutputTokenBudget` to convert anchor counts and source-material size into a `maxTokens` value passed to the LLM provider.
- **Tune** the `OutputBudgetOptions` constants when adjusting how aggressively large modules are scaled versus small ones.
- **Debug** truncation failures such as `truncated_by_token_limit` by reading the formula and clamp semantics before changing provider-side limits.

## How it fits

This module lives under `packages/core/src/output-budget.ts`, inside the `core` package of the livewiki repository. It is consumed by the documentation-generation pipeline when assembling the `max_tokens` request parameter for the model that writes each page. The budget is computed from the actual page content (number of cited anchors and, when available, the total size of their source excerpts) rather than being a single flat value applied to every page. That change was driven by a paid end-to-end run against `MoneyPrinterTurbo-Plus` where a large module failed three attempts in a row against the previous flat default, while smaller modules never approached it — a fixed ceiling silently starved the large pages. Two named presets cover the common call sites: one for full documentation pages and one for the compact topic-plan refine pass.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-output-budget.mmd
```

## Presets

<!-- lw:anchors packages/core/src/output-budget.ts#MODULE_OUTPUT_BUDGET_OPTIONS packages/core/src/output-budget.ts#TOPIC_REFINE_OUTPUT_BUDGET_OPTIONS -->

Two named presets exist so call sites do not have to repeat the four-option shape of `OutputBudgetOptions`. Both are exported `OutputBudgetOptions` records that share the same `floor` and `ceiling` clamps; they differ in the per-anchor slope and the fixed base, which models how much skeleton text versus per-anchor prose each page kind actually contains.

`MODULE_OUTPUT_BUDGET_OPTIONS` is the preset for module pages, flow pages, and individual topic-page prose — pages that ship frontmatter, an H1, fixed sections, and a prose paragraph plus marker close per cited anchor.

```ts
export const MODULE_OUTPUT_BUDGET_OPTIONS: OutputBudgetOptions = {
  base: 2048,
  perAnchor: 300,
  floor: 4096,
  ceiling: 32_768,
};
```

`TOPIC_REFINE_OUTPUT_BUDGET_OPTIONS` is the preset for the topic-plan LLM refine pass — a compact structured payload, not final prose, so the per-anchor slope is far lower and the base is smaller.

```ts
export const TOPIC_REFINE_OUTPUT_BUDGET_OPTIONS: OutputBudgetOptions = {
  base: 1024,
  perAnchor: 40,
  floor: 4096,
  ceiling: 32_768,
};
```

Both presets inherit the shared `floor` of `4096` (no page returns less than this, regardless of how few anchors it cites) and the shared `ceiling` of `32768` (no page returns more than this, regardless of how large it grows), which bounds the worst-case token exposure for any single request.

## Budget computation

<!-- lw:anchors packages/core/src/output-budget.ts#computeDynamicOutputTokenBudget -->

`computeDynamicOutputTokenBudget` turns the two signal values (`anchorCount`, and optionally `anchorSourceChars`) plus a preset (`opts`) into a final integer token budget. The shape exists so the same math can serve both presets without duplicating the clamp and rounding logic at every call site.

```ts
export function computeDynamicOutputTokenBudget(
  signals: OutputBudgetSignals,
  opts: OutputBudgetOptions,
): number
```

The function takes an `OutputBudgetSignals` (the number of closed-list anchors the page must cite, and optionally the sum of their source-material character counts) and an `OutputBudgetOptions` (the preset), and returns the integer `maxTokens` value the caller should pass to the LLM provider.

The computation runs in four steps. First, the anchor count is normalized with `Math.max(0, signals.anchorCount)` so a missing or negative value contributes nothing to the per-anchor term. Second, the raw budget is assembled as `opts.base + opts.perAnchor * anchorCount`, which models the fixed page skeleton plus a per-anchor cost for the prose paragraph and marker close. Third, when `signals.anchorSourceChars` is supplied and positive, an additive term `Math.ceil(signals.anchorSourceChars / 40)` is added — roughly one output token per 40 characters of anchor source material, since the page summarizes rather than copies. Fourth, the raw value is rounded up to the nearest 256 (the token granularity most providers already treat `max_tokens` at) and then clamped to `[opts.floor, opts.ceiling]`, with the clamp implemented as `Math.min(opts.ceiling, Math.max(opts.floor, rounded))`. The visible source does not contain a `throw`, fallback, or early-return branch — every path through the function returns the computed integer.

The constants `base`, `perAnchor`, `floor`, and `ceiling` are documented in the file's leading comment as a first-pass engineering estimate, not calibrated against measured token usage — a planned calibration against real `usageHistory` and `closedKeyList.length` correlations from past runs is described as a future TODO once enough paid end-to-end data exists.

## Tests

Covered by `packages/core/src/output-budget.test.ts` (same-name test file on disk).
