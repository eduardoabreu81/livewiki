---
title: Provider presets configuration
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

# Provider presets configuration

This page documents the built-in table of known LLM providers and the resolution logic that turns preset names plus user configuration into a final, runtime-ready provider description.

## When to use this page

- Understand what data each provider preset carries (adapter, endpoint, env var name, pricing, thinking policy) and how to add a new provider.
- Learn how `resolvePreset` maps a preset name to its full preset record and what happens when the name is unknown.
- See how `resolveProviderConfig` merges preset defaults with `config.json` overrides (preset, provider, baseUrl, pricing) into one final object.
- Discover how `isKnownPreset` allows non-throwing validation of preset names during configuration checks.

## How it fits

`presets.ts` lives in `packages/core/src` and provides the static, data-only layer of provider knowledge: it declares the `PRESET_TABLE` mapping each known provider name to its connection trivia and default pricing. It exposes helper functions (`resolvePreset`, `resolveProviderConfig`, `isKnownPreset`) that configuration validation and batch orchestration call to obtain a complete provider description. The file deliberately contains no behavior — it only carries "trivia of connection" (baseUrl, envVar, adapter, pricing) and never guesses about provider behavioral defaults; safety checks live in the LLM probe layer.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-presets.mmd
```

## Preset table data

<!-- lw:anchors packages/core/src/presets.ts#PRESET_TABLE packages/core/src/presets.ts#AVAILABLE_PRESETS -->

The reason `PRESET_TABLE` exists is that every provider needs a minimum set of facts — which adapter class to instantiate, the API base URL, the environment variable that holds the API key, and default per-model pricing — to run without further configuration. Adding a provider is meant to be pure data entry: append one record to this table and no new code is required.

`PRESET_TABLE` is an exported constant of type `Record<PresetName, ProviderPreset>` that maps each known provider name to its full description. Each entry specifies `adapter` (either `"anthropic"` for Anthropic-compatible endpoints or `"openai-compat"` for OpenAI-compatible endpoints), `baseUrl` (without a trailing `/v1`, resolved by the adapters), `envVar` (the environment variable name, never its value), optional `credentialOptional` for local endpoints without auth, `pricing` as a per-model table with USD per 1M tokens, `notes` for operational context in help/errors, and optional `thinkingDefault`, `preferMaxCompletionTokens`, and `defaultMaxOutputTokens` fields controlling reasoning and token caps.

For example, MiniMax uses the `"anthropic"` adapter because its endpoint is Anthropic-compatible, enabling the adapter's optimized prompt-caching path. Local providers like ollama and lmstudio set `credentialOptional: true` and price everything at `$0`. OpenRouter lists prefixed model names like `anthropic/claude-sonnet-4-5`. Pricing is best-effort with a reference date in `pricing.ts`; users can override it via `config.pricing`.

`AVAILABLE_PRESETS` is an exported readonly array listing the preset names in a fixed, human-friendly order. It exists to power error messages and `--help` output, so `UnknownPresetError` can tell the user exactly which presets exist.

## Error type

<!-- lw:anchors packages/core/src/presets.ts#UnknownPresetError packages/core/src/presets.ts#UnknownPresetError.constructor -->

The `UnknownPresetError` class exists so that callers can distinguish an invalid provider name from other configuration failures and render a useful message listing what is actually available.

`export class UnknownPresetError extends Error {`

This class extends the built-in `Error` and carries two public readonly fields: `presetName` (the offending name) and `available` (the list of known presets). It is thrown by `resolvePreset` and by the legacy provider path in `resolveProviderConfig`.

Its constructor builds a message that names the unknown preset and joins the available list, ending with a hint to configure via `.livewiki/config.json` or the `--provider` flag:

`constructor(name: string, available: readonly string[]) {`

The constructor takes the invalid preset name and the list of valid ones, calls `super(...)` with the formatted message, sets `this.name` to `"UnknownPresetError"`, and stores both parameters on the instance.

## Resolution

<!-- lw:anchors packages/core/src/presets.ts#resolvePreset packages/core/src/presets.ts#resolveProviderConfig packages/core/src/presets.ts#isKnownPreset -->

The resolution layer turns a preset name into either the full preset record or, in the config-merging path, a final object that already has user overrides applied. `isKnownPreset` exists as a non-throwing guard used by config validation to produce friendly errors before any resolution is attempted.

### resolvePreset

`export function resolvePreset(name: string): ProviderPreset {`

This function takes a preset name as a string and returns the corresponding `ProviderPreset` record. It indexes `PRESET_TABLE` by the name; if no record exists it throws `UnknownPresetError` carrying the given name and `AVAILABLE_PRESETS`; otherwise it returns the preset. Before returning it does not apply any overrides — that is the job of `resolveProviderConfig`.

### resolveProviderConfig

`export function resolveProviderConfig(args: { preset?: string; provider?: string; baseUrl?: string; pricing?: Record<string, ModelPrice>; }): ResolvedProviderConfig {`

This function takes an object that may hold a preset name, a legacy provider adapter name, an optional base URL override, and an optional pricing override map. It returns a single `ResolvedProviderConfig` whose every field is final — preset default already overridden by user config. It is pure: it touches neither disk nor environment variables.

Resolution follows three paths. If `args.preset` is set, it calls `resolvePreset` for the base, then lets `args.provider` override the preset's adapter (an escape hatch), `args.baseUrl` override the endpoint, and `args.pricing` merge over the preset's pricing per model; the rest (envVar, credentialOptional, notes, thinkingDefault, preferMaxCompletionTokens, defaultMaxOutputTokens) come from the preset with sensible defaults for absent fields.

If only `args.provider` is set (back-compat path), the function accepts only `"anthropic"` or `"openai-compat"`; anything else throws `UnknownPresetError` with the provider name and the available list. It returns a record with `presetName: null`, empty baseUrl (the caller resolves it later via `resolveBaseUrl`), an envVar name derived from the adapter, empty pricing unless overridden, and a note saying it is a legacy provider field. If `args.provider` is `"openai-compat"`, `preferMaxCompletionTokens` is set true.

If neither `preset` nor `provider` is set, the function throws a plain `Error` stating that one of them is required — with the comment that `validateConfigForBatch` normally catches this earlier.

Note that the back-compat path does not consult `PRESET_TABLE` for baseUrl or envVar; it relies on the caller to have valid defaults, and its `thinkingDefault` is `"omit"` regardless of provider, since no preset data is available.

### isKnownPreset

`export function isKnownPreset(name: string): name is PresetName {`

This function takes any string and returns a boolean indicating whether that string is a key in `PRESET_TABLE`. It uses `Object.prototype.hasOwnProperty.call` to avoid prototype-chain false positives. Because its return type is the type predicate `name is PresetName`, callers that pass a string get a narrowed `PresetName` value on the true branch — useful for config validation that wants to report a friendly error instead of letting `resolvePreset` throw.

## Tests

Covered by `packages/core/src/presets.test.ts` (same-name test file on disk).
