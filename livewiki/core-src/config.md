---
title: Repo-local LLM configuration management
owner: generated
anchors:
  - packages/core/src/config.ts#CONFIG_DEFAULTS
  - packages/core/src/config.ts#CONFIG_FILENAME
  - packages/core/src/config.ts#CONFIG_PATH
  - packages/core/src/config.ts#MAX_TIMEOUT_MS
  - packages/core/src/config.ts#MissingProviderConfigError
  - packages/core/src/config.ts#MissingProviderConfigError.constructor
  - packages/core/src/config.ts#applyDefaults
  - packages/core/src/config.ts#assertValidTimeoutMs
  - packages/core/src/config.ts#loadConfig
  - packages/core/src/config.ts#resolveBaseUrl
  - packages/core/src/config.ts#resolveExtraIgnores
  - packages/core/src/config.ts#resolveProviderFromConfig
  - packages/core/src/config.ts#saveConfig
  - packages/core/src/config.ts#validateConfigForBatch
  - packages/core/src/config.ts#validateConfigShape
---

# Repo-local LLM configuration management

This page describes how the livewiki repository loads, validates, and persists its repo-local LLM configuration.

## When to use this page

- Understand how `.livewiki/config.json` is read, validated, and written.
- Learn how provider, model, and preset settings are resolved before an LLM batch starts.
- Discover where runtime defaults are applied and how malformed configuration fails.

## How it fits

The `config.ts` module is the single source of truth for per-repository settings that control LLM batches, document generation, and related pipeline behavior. It lives in the core package alongside modules that perform safe file I/O (`safe-io.ts`), resolve provider presets (`presets.ts`), and define pricing and module/flow signal types. The module never stores API keys — those come from the environment or a global credential store — keeping the repo-local config safe to version. It is used by CLI commands like `livewiki init`, `livewiki batch`, and `livewiki config`, as well as by programmatic callers that need a loaded or validated configuration.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-config.mmd
```

## Loading and Saving Configuration

<!-- lw:anchors packages/core/src/config.ts#loadConfig packages/core/src/config.ts#saveConfig packages/core/src/config.ts#CONFIG_PATH packages/core/src/config.ts#CONFIG_FILENAME -->

The module's central responsibility is the read/write lifecycle of the repo-local configuration file. `loadConfig` and `saveConfig` handle the disk I/O, while `CONFIG_PATH` and `CONFIG_FILENAME` expose the canonical location for callers that need it.

`loadConfig(repoRoot)` returns a `Promise<LivewikiConfig>`. It takes a repository root path (as a string) and returns a promise that resolves to the parsed configuration object. `loadConfig` first checks whether `.livewiki/config.json` exists using `safeIo.exists`; if it does not exist, it returns an empty object `{}`, deliberately without defaults. If the file exists but is empty (after trimming whitespace), it also returns `{}`. Otherwise, it reads the raw text with `safeIo.readText`, parses it as JSON, and passes the parsed `unknown` value to `validateConfigShape`. If parsing or shape validation fails, it wraps the error in a new `Error` with the message `Failed to parse .livewiki/config.json: <original message>. Fix the file or delete it to start fresh.` — failing closed on malformed input rather than silently using defaults.

`saveConfig(repoRoot, config)` returns a `Promise<void>`. It takes a repository root path and a fully formed `LivewikiConfig`, and returns a promise that resolves once the write completes. The function serializes the config to JSON with two-space indentation and a trailing newline, then writes it through `safeIo.writeText`, which enforces the module's allowlist rules for file paths. This is the only sanctioned way to persist configuration; callers should never write the file directly.

`CONFIG_PATH` is a constant export that holds the relative path `.livewiki/config.json`, and `CONFIG_FILENAME` is derived from it via `nodePath.basename`, yielding `config.json`. These exports exist so other modules can reference the location without duplicating the string literal.

## Validation and Runtime Defaults

<!-- lw:anchors packages/core/src/config.ts#validateConfigShape packages/core/src/config.ts#applyDefaults packages/core/src/config.ts#CONFIG_DEFAULTS packages/core/src/config.ts#MAX_TIMEOUT_MS packages/core/src/config.ts#assertValidTimeoutMs -->

Before a config is used, it must pass through a two-stage validation: a shallow shape check during load, and a targeted batch-readiness check before an LLM run. `validateConfigShape` protects against unknown keys and wrong types, while `applyDefaults` fills in the runtime values that are not persisted to disk.

`validateConfigShape(parsed)` is an unexported function that takes an `unknown` value and returns a `LivewikiConfig`. It first rejects anything that is not a plain object (`null`, arrays, or primitives) with the error `config must be a JSON object`. For each recognized key, it performs a type-specific check and copies the value into a fresh output object. String fields like `provider`, `model`, `language`, and `baseUrl` are copied when they are strings. The `provider` field is further restricted to the two literal values `"anthropic"` or `"openai-compat"`; anything else throws. The `preset` field must pass `isKnownPreset` from `presets.ts`; otherwise it throws. Arrays for `languages` and `ignores` are filtered to keep only string elements. The `pricing` object is validated field-by-field: each model key must map to an object whose `input` and `output` are both numbers, and invalid entries are silently dropped rather than rejected. All numeric knobs enforce strict integer or range bounds — for example, `maxRepairAttempts` must be a non-negative integer, `flowMaxOverlap` must be a finite number between 0 and 1 inclusive, and `batchConcurrency` must be an integer from 1 to 16. Boolean flags must be actual booleans. The `pathRoles` and `flowSignals` objects are checked against their allowed key sets (`testPatterns`, `fixturePatterns`, `toolingPatterns`, `docsPatterns` for the former; `entryPatterns`, `persistencePatterns`, `persistenceImportPatterns` for the latter) and require each supplied array to contain only strings. Unknown keys in these sub-objects throw rather than being ignored.

`applyDefaults(config)` returns a new `LivewikiConfig` without mutating the input. It takes a `LivewikiConfig` and returns another `LivewikiConfig` that is the input merged over the complete runtime defaults. The function builds a fresh object starting from `CONFIG_DEFAULTS` — copying the `languages` array by spreading it so mutation of the default is impossible — then spreads the user-provided `config` on top. Because the spread comes last, any user value overrides the default for that key. This is how the module enforces the "no hard-coded default model" design: `provider`, `model`, and `preset` have no defaults in `CONFIG_DEFAULTS`, so they remain undefined unless the user sets them.

`CONFIG_DEFAULTS` is a `const` object with `as const` that acts as the single source of truth for runtime fallbacks. It sets `language: "en"`, the default `languages` list of `["ts", "tsx", "js", "jsx", "py"]`, per-provider `baseUrls`, and a long list of numeric and boolean knobs that govern stages 4 and 5 (for example, `maxRepairAttempts: 2`, `maxFlows: 4`, `stage4MaxOutputTokens: 32768`, `batchConcurrency: 1`). These defaults are intentionally not written into the config file on disk — they apply only at runtime via `applyDefaults`.

`MAX_TIMEOUT_MS` is a numeric constant set to `2_147_483_647`, which is the maximum safe value for Node's `setTimeout` (a signed 32-bit millisecond value). It defines the upper bound for the `timeoutMs` config field.

`assertValidTimeoutMs(v)` is a function that takes an `unknown` value and asserts (via a TypeScript assertion signature) that it is a number. It returns nothing; instead, it throws if the value is not an integer, is negative, or exceeds `MAX_TIMEOUT_MS`. On failure it throws `invalid timeoutMs: must be an integer 0..2147483647 (0 disables timeout; upper bound is Node setTimeout safe max), got <value>`. This is used both during shape validation for the `timeoutMs` field and by programmatic callers that skip `loadConfig` but still need the constraint enforced.

## Batch-Readiness and Provider Resolution

<!-- lw:anchors packages/core/src/config.ts#validateConfigForBatch packages/core/src/config.ts#MissingProviderConfigError packages/core/src/config.ts#MissingProviderConfigError.constructor packages/core/src/config.ts#resolveProviderFromConfig packages/core/src/config.ts#resolveBaseUrl packages/core/src/config.ts#resolveExtraIgnores -->

Once a config is loaded and defaults are applied, the module provides the checks and helpers that turn the raw config into an actionable provider setup for an LLM run. The key invariant is that livewiki never chooses a provider or model silently — it forces the user to be explicit.

`validateConfigForBatch(repoRoot, config)` returns `void`. It takes a repository root string and a `LivewikiConfig`, and throws a `MissingProviderConfigError` if either the provider or the model is absent. For the provider requirement, a `preset` reference counts as satisfying it (because the preset expands downstream to an adapter and base URL). If `provider` is absent and `preset` is absent, the field `"provider"` is pushed to the missing list; if `model` is absent, `"model"` is pushed. If the missing list is non-empty, it constructs and throws `MissingProviderConfigError(repoRoot, missing)`. Additionally, when `config.timeoutMs` is defined, it calls `assertValidTimeoutMs` on it, so programmatic callers that skip `loadConfig` still reject invalid timeout values.

`MissingProviderConfigError` is a class extending `Error`. Its constructor takes `repoRoot: string` and `missingFields: Array<"provider" | "model">` and returns nothing (it constructs the instance). The constructor builds a descriptive message telling the user which fields are missing, points to the repo path, and routes them to `livewiki config` for interactive setup or to set `preset` and `model` headlessly along with the appropriate credential environment variable (for example, `ANTHROPIC_API_KEY`). It sets the error name to `MissingProviderConfigError` and stores `repoRoot` as a public readonly property so callers can inspect which repository failed.

`resolveProviderFromConfig(config)` returns the resolved provider config object. It takes a `LivewikiConfig` and returns the same shape as `resolveProviderConfig` from `presets.ts`. The function constructs a new object containing only the fields that are explicitly set on the input — `preset`, `provider`, `baseUrl`, and `pricing` — and forwards it to `resolveProviderConfig`. By omitting undefined fields, it lets the preset table supply defaults while allowing any explicitly provided field to override them. Note that this helper deliberately does not validate for a missing `model`; that check belongs to `validateConfigForBatch`.

`resolveBaseUrl(config)` returns a string. It takes a `LivewikiConfig` and returns the final base URL to use. The priority is: an explicitly set `config.baseUrl` wins; otherwise, if `preset` is set, it returns the preset's `baseUrl` from `resolvePreset`; otherwise it falls back to the `CONFIG_DEFAULTS.baseUrls` entry for the provider. The final branch casts `config.provider` to `LlmProvider` on the assumption that the caller has already run `validateConfigForBatch` to guarantee the provider is present.

`resolveExtraIgnores(config)` returns a `readonly string[]`. It takes a `LivewikiConfig` and returns the user-configured `ignores` patterns, or an empty array if the field is absent. This list is the single source of truth for configured overrides; callers forward it to the repository walker via `extraIgnores`. The walker additionally applies its own built-in defaults (`.git`, `.livewiki`, `node_modules`, `dist`, `coverage`) and the repo's `.gitignore`. Crucially, resume paths (`livewiki batch resume`) and `--only` do not rescan the repo, so a configured ignore cannot re-enter via those entry points — it was already excluded when the original stage-1 indexer walked the repository.

## Tests

Covered by `packages/core/src/config.test.ts` (same-name test file on disk).
