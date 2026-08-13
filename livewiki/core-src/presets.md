---
title: Provider presets and config expansion
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

# Provider presets and config expansion

This page documents the module responsible for the built-in catalogue of known LLM providers (the "presets") and the helper that merges a preset with user overrides into a final runtime configuration.

## When to use this page

- **Add a new built-in provider** by appending an entry to the preset table with no other code changes.
- **Look up the adapter, base URL, env var, or default pricing** for a known provider such as Anthropic, OpenAI, OpenRouter, DeepSeek, Kimi, MiniMax, Gemini, NVIDIA NIM, Ollama, or LM Studio.
- **Resolve a preset name plus config overrides** into a single `ResolvedProviderConfig` ready for the runtime.
- **Diagnose `UnknownPresetError`** thrown when a config references a provider name that does not exist in the table.

## How it fits

`packages/core/src/presets.ts` lives in `packages/core/src/` next to `config.ts` and `pricing.ts`. It is a pure data-and-helpers module: it does no I/O, reads no env vars, and never writes the resolved values back to disk. `config.ts` loads `.livewiki/config.json` and then calls `resolveProviderConfig` here to expand a `preset` reference plus any per-field overrides into the final `ResolvedProviderConfig` that the rest of the pipeline (pricing lookup, LLM client construction) consumes. Because the env-var field is a *name* and never a value, this module is the single place that knows which env var each provider expects — and that indirection is what keeps API keys out of checkpoints, logs, and error messages.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-presets.mmd
```

## Preset data table

<!-- lw:anchors packages/core/src/presets.ts#PRESET_TABLE packages/core/src/presets.ts#AVAILABLE_PRESETS -->

The preset table is the single source of truth for every built-in provider the tool can run against. Each entry carries just enough information to make an outbound request without further configuration: which LLM client adapter to instantiate, the API base URL, the name of the env var that holds the API key, a best-effort default pricing table per model, and short operational notes that surface in `--help` and error messages. Optional fields capture provider-specific defaults — the default thinking/reasoning policy, whether to prefer `max_completion_tokens` over `max_tokens`, and a suggested max output token count for stage-4 batch documentation.

```ts
export const PRESET_TABLE: Record<PresetName, ProviderPreset> = {
```

This `Record<PresetName, ProviderPreset>` shape, paired with the literal-union `PresetName` type, gives IDE autocomplete for every supported provider name. Each entry is intentionally additive: adding a new provider means adding one more property here, with no new code path.

```ts
export const AVAILABLE_PRESETS: readonly PresetName[] = [
  "anthropic",
  "openai",
  "openrouter",
  "deepseek",
  "kimi",
  "minimax",
  "gemini",
  "nvidia",
  "ollama",
  "lmstudio",
];
```

`AVAILABLE_PRESETS` is a parallel ordered list of the same keys, used purely for human-facing messages — error strings, `--help` output, and the `available` field on `UnknownPresetError`. Keeping it as a separate array means the order in help text stays stable even if `Object.keys(PRESET_TABLE)` ever returned keys in a different order, and it lets the error message list supported names without re-iterating the table.

Two contract points worth flagging for new entries: `envVar` is the *name* of the environment variable, never its value (so this file is safe to import from anywhere without leaking credentials); and default prices are best-effort, anchored to `PRICING_REFERENCE_DATE` in `pricing.ts`, and may be overridden per model via `config.pricing.<model>`.

For the 2026-08-13 release snapshot, the Anthropic preset names Claude Opus 4.5, Sonnet 5, and Haiku 4.5, while the OpenAI preset prices GPT-4o at $2.50 input / $10 output and GPT-4o mini at $0.15 / $0.60 per million tokens. Sonnet 5's $2 / $10 entry is explicitly the introductory rate ending 2026-08-31; callers that need later billing accuracy should override it until the next table review.

## Preset lookup and type narrowing

<!-- lw:anchors packages/core/src/presets.ts#isKnownPreset packages/core/src/presets.ts#resolvePreset packages/core/src/presets.ts#UnknownPresetError packages/core/src/presets.ts#UnknownPresetError.constructor -->

Lookup is split into a non-throwing predicate and a throwing resolver, so call sites can choose between "report a friendly error" and "fail fast".

```ts
export function isKnownPreset(name: string): name is PresetName {
  return Object.prototype.hasOwnProperty.call(PRESET_TABLE, name);
}
```

`isKnownPreset` is a TypeScript type predicate: when it returns `true`, the input `string` is narrowed to the `PresetName` literal union in the surrounding code. Config validation paths use this to check membership without raising — they can produce their own error messages tailored to the validation context.

```ts
export function resolvePreset(name: string): ProviderPreset {
  const preset = PRESET_TABLE[name as PresetName];
  if (!preset) {
    throw new UnknownPresetError(name, AVAILABLE_PRESETS);
  }
  return preset;
}
```

`resolvePreset` performs the same membership check via a `Record` lookup and throws `UnknownPresetError` when the key is missing. The `name as PresetName` cast is safe in the success branch because `PRESET_TABLE` is fully keyed by `PresetName`; the `if (!preset)` guard catches any string that does not map to a real entry. Because `resolvePreset` is the canonical place where unknown names are converted into exceptions, downstream code can trust that a returned `ProviderPreset` is always well-formed.

```ts
constructor(name: string, available: readonly string[]) {
  super(
    `Unknown provider preset "${name}". Available: ${available.join(", ")}. ` +
      `Configure via .livewiki/config.json or pass --provider.`,
  );
  this.name = "UnknownPresetError";
  this.presetName = name;
  this.available = available;
}
```

`UnknownPresetError` extends `Error` and carries two structured fields on top of the message: `presetName`, the offending input, and `available`, the list of valid names. The constructor builds a single-line message that names the bad input, lists every supported preset, and points the user at `.livewiki/config.json` or the `--provider` flag. Callers that need machine-readable detail (for example, to render a config-validation report) can read `presetName` and `available` directly; the visible evidence here covers the normal throw path and the structured fields, while the catch side lives in `config.ts` and is not visible in this file.

## Merging preset with config overrides

<!-- lw:anchors packages/core/src/presets.ts#resolveProviderConfig -->

`resolveProviderConfig` is the only function in this file that combines data from two sources. It accepts an `args` object with optional `preset`, `provider`, `baseUrl`, and `pricing` fields and returns a fully populated `ResolvedProviderConfig`.

```ts
export function resolveProviderConfig(args: {
  preset?: string;
  provider?: string;
  baseUrl?: string;
  pricing?: Record<string, ModelPrice>;
}): ResolvedProviderConfig {
```

This signature takes an `args` object describing the preset name, a back-compat adapter hint, an optional base URL override, and an optional per-model pricing override map, and it returns a single `ResolvedProviderConfig` whose fields are the final values the runtime will use.

The merge runs in two distinct paths. **Path 1 — `args.preset` is set**: the preset is resolved via `resolvePreset` to act as the base. The `provider` field, if present, overrides the adapter as an explicit escape hatch; `baseUrl`, when supplied, overrides the preset's `baseUrl`; and `pricing` is merged into the preset's pricing by spreading the preset first and the override second (`{ ...p.pricing, ...(args.pricing ?? {}) }`), so user-supplied prices win on a per-model basis. The preset's optional fields fall back to safe defaults if absent: `thinkingDefault` becomes `"omit"`, `preferMaxCompletionTokens` becomes `false`, and `defaultMaxOutputTokens` becomes `8192`. The preset's `envVar` and `notes` are always taken from the preset and never overridden by config.

**Path 2 — back-compat, only `args.provider` is set**: if `provider` is neither `"anthropic"` nor `"openai-compat"`, the function throws `UnknownPresetError`; otherwise it returns a config with `presetName: null`, an empty `baseUrl` (the caller resolves it via `resolveBaseUrl`), an env var inferred from the adapter (`"ANTHROPIC_API_KEY"` or `"OPENAI_API_KEY"`), an empty pricing table unless the caller supplied one, and a `"no preset"` note. This path exists only so older configs that used the `provider` field directly keep working alongside the newer `preset` field.

If neither `preset` nor `provider` is present, the function throws a plain `Error` stating that `resolveProviderConfig` requires at least one of them, with a comment pointing at `validateConfigForBatch` as the upstream gate that should have caught the empty case.

## Tests

Covered by `packages/core/src/presets.test.ts` (same-name test file on disk).
