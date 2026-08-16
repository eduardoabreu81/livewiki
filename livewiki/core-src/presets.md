---
title: Provider Presets and Resolution
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

# Provider Presets and Resolution

This page documents the embedded preset table for known LLM providers and the functions that resolve provider configurations from user input, enabling the rest of livewiki to connect to different API endpoints without per-provider code.

## When to use this page

- Understand what provider presets exist and how they are defined.
- Learn how to resolve a preset by name and what error is thrown for unknown names.
- Discover how to merge preset defaults with user-supplied config overrides.
- Check whether a given string is a known preset name without triggering exceptions.

## How it fits

`presets.ts` lives in the core package alongside `config.ts` and `pricing.ts`. It provides the authoritative list of supported LLM providers — from hosted APIs (Anthropic, OpenAI, OpenRouter, DeepSeek, Kimi, MiniMax, Gemini, NVIDIA NIM) to fully local engines (Ollama, LM Studio) — each with its adapter type, base URL, environment variable name, and best-effort default pricing. The rest of the codebase calls the resolver functions here to turn a `preset` or legacy `provider` field from `config.json` into a concrete runtime configuration, so adapters and clients never need to know provider-specific details themselves. The file is pure data plus small, pure resolution logic; it never touches disk or environment variables directly.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-presets.mmd
```

## Preset Data Table

<!-- lw:anchors packages/core/src/presets.ts#PRESET_TABLE packages/core/src/presets.ts#AVAILABLE_PRESETS -->

This section covers the core data structures of the module — the embedded table of known providers and the ordered list of their names. These are the constants that everything else in the file (and most of the runtime configuration path) is built from.

`PRESET_TABLE` is a `Record<PresetName, ProviderPreset>` that maps each supported provider name to a full configuration object. Each entry carries:

- `adapter` — which `LlmClient` implementation to instantiate: `"anthropic"` or `"openai-compat"`. This maps one-to-one with the internal `LlmProvider` type.
- `baseUrl` — the API base URL without a `/v1` suffix (adapters resolve the path themselves).
- `envVar` — the name of the environment variable that holds the API key. **Never** the value itself; the key may be absent for local providers.
- `pricing` — a best-effort table of default prices (USD per 1M tokens) per model, overridable via `config.pricing`.
- `notes` — short operational text that surfaces in `--help` output or error messages, without secrets or billing URLs.
- Optional fields: `credentialOptional` (for unauthenticated local endpoints), `thinkingDefault` (whether to send an explicit reasoning policy for batch documentation), `preferMaxCompletionTokens` (prefer `max_completion_tokens` over `max_tokens`), and `defaultMaxOutputTokens` (the suggested stage-4 token cap).

The table covers ten providers. Hosted APIs such as Anthropic, OpenAI, OpenRouter, DeepSeek, and Gemini use their standard endpoints and environment variable names. MiniMax is notable: because it offers an Anthropic-compatible endpoint, its preset uses the `"anthropic"` adapter to take advantage of optimized prompt caching. Ollama and LM Studio are local and mark `credentialOptional: true` so the resolution path knows a key is not required.

`AVAILABLE_PRESETS` is a `readonly PresetName[]` listing every key of `PRESET_TABLE` in a fixed order. This list exists to provide consistent, human-readable output for error messages and `--help` text, ensuring users always see the exact set of accepted preset names.

## Preset Resolution

<!-- lw:anchors packages/core/src/presets.ts#resolvePreset packages/core/src/presets.ts#UnknownPresetError packages/core/src/presets.ts#UnknownPresetError.constructor packages/core/src/presets.ts#isKnownPreset -->

This section covers the functions that look up presets and validate names. Their role is to turn a user-supplied string into a concrete `ProviderPreset` object (or a clear failure), and to let config validation check names without side effects.

`resolvePreset(name: string): ProviderPreset` is the primary lookup. It reads `PRESET_TABLE` using the input string as a key; if the key exists, it returns the corresponding preset. If the key does not exist, it throws an error — described below — that lists the valid names. This function is intentionally strict: it fails loudly on unknown names rather than returning a partial object.

`UnknownPresetError` is a custom `Error` subclass used for exactly that failure mode. Its constructor takes the offending `name` and the `available` list of preset names:

```ts
constructor(name: string, available: readonly string[]) {
```

It builds a message that states the unknown name and joins the `available` list into a comma-separated suggestion, then sets `this.name` to `"UnknownPresetError"` and stores both inputs as public fields (`presetName` and `available`). The prose in the error also points the user to `.livewiki/config.json` or the `--provider` flag.

`isKnownPreset(name: string): name is PresetName` is a non-throwing check. It uses `Object.prototype.hasOwnProperty` on `PRESET_TABLE` to test whether the given string is a valid preset key. Because its return type is a type predicate (`name is PresetName`), callers that pass the result to code expecting a `PresetName` get improved TypeScript narrowing. It exists so config validation can report friendly errors instead of relying on `resolvePreset`'s throw path.

## Provider Config Merging

<!-- lw:anchors packages/core/src/presets.ts#resolveProviderConfig -->

This section covers the function that expands a preset (or a legacy provider field) together with user config overrides into the final runtime configuration object. It is the bridge between the static preset table and the dynamic configuration a user provides.

`resolveProviderConfig(args: { preset?: string; provider?: string; baseUrl?: string; pricing?: Record<string, ModelPrice> }): ResolvedProviderConfig` is a pure function — it does not read disk or environment variables. It takes an object with optional `preset`, `provider`, `baseUrl`, and `pricing` fields, and returns a `ResolvedProviderConfig` with all fields fully resolved. The resolution order is: preset first; then provider as a backward-compatibility fallback; then overrides from `baseUrl` and `pricing`.

The function has three paths. The first path triggers when `args.preset` is set: it calls `resolvePreset` to get the preset, uses it as the base, and then applies overrides — a `provider` field can override the preset's adapter (an escape hatch), `baseUrl` overrides the preset's base URL, and `pricing` merges over the preset's pricing per model (config wins). It also fills defaults for optional fields: `credentialOptional` defaults to `false`, `thinkingDefault` to `"omit"`, `preferMaxCompletionTokens` to `false`, and `defaultMaxOutputTokens` to `8192`.

The second path triggers when `args.preset` is absent but `args.provider` is set (backward compatibility). It only accepts `"anthropic"` or `"openai-compat"`; any other value throws `UnknownPresetError`. Without a preset, it returns defaults from `config.ts` — an empty base URL (the caller resolves it later), the appropriate environment variable name for the adapter, empty pricing, and a note that this is the legacy path. It also sets `preferMaxCompletionTokens` only for `openai-compat`.

The third path triggers when neither `preset` nor `provider` is set. It throws an `Error` stating that one of them is required, noting that `validateConfigForBatch` normally catches this condition earlier. This ensures the function never silently returns a meaningless configuration.

## Tests

Covered by `packages/core/src/presets.test.ts` (same-name test file on disk).
