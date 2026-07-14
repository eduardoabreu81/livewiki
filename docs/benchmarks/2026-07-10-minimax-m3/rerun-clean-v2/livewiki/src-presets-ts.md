---
title: src-presets-ts
owner: generated
anchors:
  - packages/core/src/presets.ts#AVAILABLE_PRESETS
  - packages/core/src/presets.ts#PRESET_TABLE
  - packages/core/src/presets.ts#UnknownPresetError
  - packages/core/src/presets.ts#UnknownPresetError.constructor
  - packages/core/src/presets.ts#isKnownPreset
  - packages/core/src/presets.ts#resolvePreset
  - packages/core/src/presets.ts#resolveProviderConfig
---

# src-presets-ts

Embedded provider preset table for `packages/core/src/presets.ts`. Each preset carries enough data to run without extra config: adapter, base URL, env var name, and default pricing. Adding a new provider is a data-only change — add an entry to `PRESET_TABLE`.

## Preset table
<!-- lw:anchors packages/core/src/presets.ts#PRESET_TABLE -->

`PRESET_TABLE` is a `Record<PresetName, ProviderPreset>` covering ten providers: `anthropic`, `openai`, `openrouter`, `deepseek`, `kimi`, `minimax`, `gemini`, `nvidia`, `ollama`, and `lmstudio`. Adapter selection rule: when a provider exposes an Anthropic-compatible endpoint (e.g. `minimax`), the preset uses the `anthropic` adapter so prompt caching reads are optimised.

Per-preset fields:
- `adapter` — which `LlmClient` to instantiate (`anthropic` | `openai-compat`).
- `baseUrl` — API base URL, without `/v1` (adapters resolve the path).
- `envVar` — env var name carrying the API key (never the value; the name is the only thing stored).
- `pricing` — best-effort USD per 1M tokens; user can override via `config.pricing.<model>`. Local providers (`ollama`, `lmstudio`) carry explicit zero pricing.
- `notes` — short operational notes; surfaced in `--help` and error messages. Never contains the key or a billing URL.
- `thinkingDefault` — default reasoning policy (`disabled` | `adaptive` | `omit` | `n/a`). `minimax` ships with `disabled`; `omit` is the common default.
- `preferMaxCompletionTokens` — when true, request uses `max_completion_tokens` instead of `max_tokens`.
- `defaultMaxOutputTokens` — suggested stage-4 max output tokens (defaults to `8192`).

## Available presets list
<!-- lw:anchors packages/core/src/presets.ts#AVAILABLE_PRESETS -->

`AVAILABLE_PRESETS` is the ordered, readonly `PresetName[]` used for error messages and `--help` output: `anthropic`, `openai`, `openrouter`, `deepseek`, `kimi`, `minimax`, `gemini`, `nvidia`, `ollama`, `lmstudio`. The order is stable and intended for display.

## UnknownPresetError
<!-- lw:anchors packages/core/src/presets.ts#UnknownPresetError packages/core/src/presets.ts#UnknownPresetError.constructor -->

`UnknownPresetError extends Error`. Thrown when a preset name (or legacy provider) is not recognised.

Constructor signature: `(name: string, available: readonly string[])`. It captures the rejected `name`, the list of `available` presets, and produces a message of the form:

```
Unknown provider preset "<name>". Available: a, b, c, ... Configure via .livewiki/config.json or pass --provider.
```

The class also exposes public readonly fields `presetName: string` and `available: readonly string[]` for programmatic handling.

## isKnownPreset
<!-- lw:anchors packages/core/src/presets.ts#isKnownPreset -->

`isKnownPreset(name: string): name is PresetName` — non-throwing check against `PRESET_TABLE`. Returns a type guard so callers can narrow `string` to `PresetName` without a separate lookup. Useful for config validation that wants to report a friendly error.

## resolvePreset
<!-- lw:anchors packages/core/src/presets.ts#resolvePreset -->

`resolvePreset(name: string): ProviderPreset` — looks up `PRESET_TABLE[name as PresetName]`. If the entry is missing, throws `UnknownPresetError` with `name` and `AVAILABLE_PRESETS`. Returns the full `ProviderPreset` on success.

## resolveProviderConfig
<!-- lw:anchors packages/core/src/presets.ts#resolveProviderConfig -->

`resolveProviderConfig(args)` merges preset defaults with user overrides into a final `ResolvedProviderConfig`. Pure: no disk, no env access.

Args shape:
- `preset?: string` — preset name (preferred path).
- `provider?: string` — legacy adapter field (`anthropic` | `openai-compat`).
- `baseUrl?: string` — overrides preset base URL.
- `pricing?: Record<string, ModelPrice>` — per-model pricing overrides.

Resolution order:
1. **Preset path** — when `args.preset` is set: resolve the preset, then apply overrides. `args.provider` (if present) overrides the preset's adapter as an escape hatch. `pricing` is merged per-model (`config.pricing` wins over `preset.pricing`). `thinkingDefault`, `preferMaxCompletionTokens`, and `defaultMaxOutputTokens` fall back to `omit`, `false`, and `8192` respectively when the preset omits them.
2. **Legacy provider path** — when only `provider` is set: must be `anthropic` or `openai-compat`, otherwise `UnknownPresetError` is thrown with `AVAILABLE_PRESETS`. Returns `presetName: null`, no preset-derived `baseUrl`/`envVar`/`notes`; `envVar` defaults to `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`. `preferMaxCompletionTokens` defaults to `true` for `openai-compat`.
3. **Neither** — throws `Error("resolveProviderConfig requires preset or provider (validateConfigForBatch catches this earlier)")`. The caller (`validateConfigForBatch`) is expected to catch this case earlier with a clearer message.

The returned `ResolvedProviderConfig` always carries the final values (`presetName`, `adapter`, `baseUrl`, `envVar`, merged `pricing`, `notes`, `thinkingDefault`, `preferMaxCompletionTokens`, `defaultMaxOutputTokens`) ready for runtime use.

## Operational invariants

- `envVar` is the variable name only; the key value is never persisted to `config.json`, checkpoints, logs, or errors. Coverage: `key-leak.test.ts`.
- Pricing is best-effort, referenced against `PRICING_REFERENCE_DATE` in `pricing.ts`. Unknown prices surface as `tokensOnly` reports (no USD) per product rule.
- Adding a preset = adding an entry to `PRESET_TABLE`. No new code paths required.
- TODO: pricing reference date — exact value lives in `pricing.ts` and is not exposed in this module.