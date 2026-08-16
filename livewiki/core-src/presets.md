---
title: Provider Presets and Configuration Resolution
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

# Provider Presets and Configuration Resolution

This page documents the embedded provider preset table and the functions that resolve a provider name into a fully-configured client setup.

## When to use this page

- Understand what data each known provider preset carries and how to add a new provider.
- Learn how `resolveProviderConfig` merges preset defaults with user overrides from `config.json`.
- See how unknown provider names are detected and reported through `UnknownPresetError`.
- Check how to validate a provider name without throwing an error using `isKnownPreset`.

## How it fits

This module is part of `packages/core` and serves as the data layer for provider configuration. It defines the `PresetAdapter` type (mapping 1:1 with the internal `LlmProvider`) and the `ProviderPreset` interface, which holds trivia such as `baseUrl`, `envVar`, `pricing`, and `thinkingDefault` — connection facts, never behavioral assumptions. The module exposes the `PRESET_TABLE` (a record keyed by `PresetName`) and `AVAILABLE_PRESETS` (an ordered list), along with functions that look up presets and expand them with config overrides. The wizard and batch preflight (in `llm/probe.ts`) handle live provider probing and reasoning-leak rejection; this file only supplies the static connection data.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-presets.mmd
```

## Preset Table Definition

<!-- lw:anchors packages/core/src/presets.ts#PRESET_TABLE packages/core/src/presets.ts#AVAILABLE_PRESETS -->

The preset table is the single source of truth for known providers. Each entry holds enough connection data to run without further configuration: the adapter to instantiate (`anthropic` or `openai-compat`), the `baseUrl` (without a `/v1` suffix), the environment variable name that carries the API key (never the key value), optional `credentialOptional` for unauthenticated local endpoints, best-effort pricing per model, short operational notes, a default thinking policy, and flags for token limits.

`PRESET_TABLE` is a `Record` keyed by the `PresetName` literal union, which includes cloud providers (anthropic, openai, openrouter, deepseek, kimi, minimax, gemini, nvidia) and local ones (ollama, lmstudio), plus newer entries like fireworks, novita, gmi, stepfun, huggingface, xai, and alibaba. Pricing is best-effort; where no reliable table exists, the `pricing` map is left empty, and `pricing.ts:lookupPricing` falls back to a tokens-only report. The `thinkingDefault` field pins provider behavior where omitting the field would otherwise let the API enable reasoning (for example, DeepSeek v4 defaults thinking ON when omitted, so the preset sets it to `disabled`; MiniMax also sets `disabled`).

`AVAILABLE_PRESETS` is an ordered read-only array of all preset names, used for error messages and `--help` output. Adding a provider means adding one entry to `PRESET_TABLE` and one name to `AVAILABLE_PRESETS` — no new code is required beyond those data changes.

## Preset Lookup

<!-- lw:anchors packages/core/src/presets.ts#resolvePreset packages/core/src/presets.ts#UnknownPresetError packages/core/src/presets.ts#UnknownPresetError.constructor -->

The lookup step turns a provider name string into a preset object. `resolvePreset` performs the lookup:

```ts
export function resolvePreset(name: string): ProviderPreset {
```

This function takes a provider name and returns the matching `ProviderPreset` object. It indexes `PRESET_TABLE` with the name and, if no entry exists, throws an `UnknownPresetError`.

`UnknownPresetError` is a dedicated error class that carries both the offending name and the full list of available presets:

```ts
constructor(name: string, available: readonly string[]) {
```

This constructor takes the unknown provider name and the list of valid presets, and produces an error whose message lists the available options and points the user to configure via `.livewiki/config.json` or the `--provider` flag. It also stores the `presetName` and `available` arrays as public read-only fields for programmatic handling (for example, in the config wizard).

## Validation Without Throwing

<!-- lw:anchors packages/core/src/presets.ts#isKnownPreset -->

Sometimes the code needs to check a name without risking an exception — for friendly config validation or to decide between error paths.

```ts
export function isKnownPreset(name: string): name is PresetName {
```

This function takes a string and returns a boolean that, when true, narrows the type to `PresetName` via a type predicate. It uses `Object.prototype.hasOwnProperty` to check whether the name is a direct key of `PRESET_TABLE`, returning `false` for names inherited from the prototype chain. This lets callers validate a config value and report a human-readable error instead of relying on a thrown `UnknownPresetError`.

## Configuration Resolution

<!-- lw:anchors packages/core/src/presets.ts#resolveProviderConfig -->

The resolution step merges preset defaults with user overrides from `config.json` into a single ready-to-use object.

```ts
export function resolveProviderConfig(args: {
  preset?: string;
  provider?: string;
  baseUrl?: string;
  pricing?: Record<string, ModelPrice>;
}): ResolvedProviderConfig {
```

This function takes an object that may carry a `preset` name, a legacy `provider` field, optional `baseUrl` and per-model `pricing` overrides, and returns a `ResolvedProviderConfig` whose fields are the final values the runtime will use. It is pure — it never touches disk or environment variables.

The function follows a three-path resolution order. The first path handles the case where `preset` is set: it resolves the preset, uses its adapter as the base unless an explicit `provider` override is given (escape hatch), applies the config `baseUrl` override if present, and merges config pricing over the preset pricing per model. The second path handles the legacy case where only `provider` is set (values `"anthropic"` or `"openai-compat"`); here it returns defaults from `CONFIG_DEFAULTS` rather than a preset, leaving `baseUrl` empty for the caller to resolve, and mapping the env var name from the adapter. If `provider` is set but is neither accepted adapter, it throws an `UnknownPresetError`. The final path covers the case where neither `preset` nor `provider` is present — it throws a generic error, which the caller (`validateConfigForBatch`) is expected to catch earlier with a more friendly message.

## Tests

Covered by `packages/core/src/presets.test.ts` (same-name test file on disk).
