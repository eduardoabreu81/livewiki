---
title: Repository-Local Configuration Loading and Validation
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

# Repository-Local Configuration Loading and Validation

This page documents how livewiki reads, validates, and applies the repo-local configuration stored in `.livewiki/config.json`.

## When to use this page

- Understand where livewiki stores per-repository settings and why API keys never live in the config file.
- Trace the flow from loading raw JSON to producing a fully-defaulted, validated configuration for LLM batch runs.
- Learn how provider/model requirements are enforced before any generated call, and how presets expand into concrete provider settings.
- Find the validation rules and range checks applied to every config field, including timeout, repair, and diagram budget knobs.

## How it fits

The config module is the single source of truth for repository-local behavioral settings. It reads and writes `.livewiki/config.json` through the safe-io allowlist, validates the file's shape against a strict schema, and provides the runtime defaults that the rest of the core packages consume — from the LLM client factory to the stage-4/5 generation loops. Because it lives in `packages/core`, it is imported by CLI commands and batch orchestration alike, and it deliberately stays free of any credential material so the file is safe to commit.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-config.mmd
```

## Loading and Saving Configuration

The file's primary job is to persist and load the per-repo config as a single JSON object. `safeIo` guards every disk interaction, and the module never touches the environment or credential store.

<!-- lw:anchors packages/core/src/config.ts#loadConfig packages/core/src/config.ts#saveConfig packages/core/src/config.ts#CONFIG_PATH packages/core/src/config.ts#CONFIG_FILENAME -->

The load path is designed to be forgiving about a missing file but strict about a present-but-broken one: since defaults fill every gap at runtime, an empty config is a perfectly valid starting point, whereas malformed JSON would silently hide a user's intended settings. That is why the read step fails closed on a parse error, instructing the user to fix or delete the file, and the write step always round-trips through the same safe-io allowlist so the file cannot drift outside the repo.

### Reading configuration

`loadConfig` first checks whether `CONFIG_REL_PATH` exists inside the given repo root; if the file is absent or blank, it returns an empty object so that defaults apply later. Otherwise it reads the text and passes it to `validateConfigShape`, which either returns a typed config or throws a failure-closed error that includes the parse message and instructs the user to fix or delete the file.

```ts
export async function loadConfig(repoRoot: string): Promise<LivewikiConfig> {
```

This function takes the repo root and returns a parsed `LivewikiConfig`; on missing or blank files it returns an empty object, and on malformed JSON it throws an `Error` that names the file and suggests fixing or deleting it.

### Writing configuration

`saveConfig` serializes a `LivewikiConfig` with two-space indentation and writes it to the same `CONFIG_REL_PATH` via safe-io, so the write respects the project's path allowlist and never escapes the repo.

```ts
export async function saveConfig(
  repoRoot: string,
  config: LivewikiConfig,
): Promise<void>
```

This function takes the repo root and the config object, then writes the JSON to disk; it returns nothing on success.

### Path and filename exports

The module re-exports the relative path and its basename for callers that need the on-disk location without hardcoding it.

```ts
export const CONFIG_PATH = CONFIG_REL_PATH;
export const CONFIG_FILENAME = nodePath.basename(CONFIG_REL_PATH);
```

`CONFIG_PATH` is the full relative path `.livewiki/config.json`, and `CONFIG_FILENAME` is just the basename `config.json`; both are exported for callers that need the on-disk location without hardcoding it.

## Defaults and Runtime Merging

This section covers the constants and helper functions that give every config field a non-optional value at runtime, without ever writing those defaults back into the file.

<!-- lw:anchors packages/core/src/config.ts#CONFIG_DEFAULTS packages/core/src/config.ts#MAX_TIMEOUT_MS packages/core/src/config.ts#assertValidTimeoutMs packages/core/src/config.ts#applyDefaults -->

The reason defaults live outside the file is separation of concerns: the config file should capture only what the user deliberately changed, while the defaults table stays in code where it can carry explanatory comments and evolve with the product. Because defaults are applied at runtime rather than at write time, a config written today still picks up tomorrow's improved defaults the moment the code is upgraded — the file is a delta, not a snapshot.

### The defaults table

`CONFIG_DEFAULTS` is a frozen constant holding the canonical runtime values for every optional field. The file-level contract is explicit: `language` defaults to `"en"`, but provider and model stay deliberately undefined so the user must choose them — there is no silent fallback that would mask a misconfiguration. The table also carries provider base URLs, stage-4/5 token ceilings, structural split thresholds, repair counts, flow/topic budgets, and the boolean feature switches introduced by later phases.

### The timeout upper bound and its validator

```ts
export const MAX_TIMEOUT_MS = 2_147_483_647;
```

```ts
export function assertValidTimeoutMs(v: unknown): asserts v is number {
```

The constant `MAX_TIMEOUT_MS` is the Node `setTimeout` safe maximum (a signed 32-bit millisecond value). The function `assertValidTimeoutMs` takes an unknown value and, when it returns, narrows that value to a number; it throws an `Error` unless the value is an integer in the inclusive range `0..MAX_TIMEOUT_MS`, where `0` means "disable the abort timer". Both `validateConfigShape` and `validateConfigForBatch` call this validator on any explicit `timeoutMs`, so programmatic callers that skip the load path still get the same check.

### Applying defaults without mutation

```ts
export function applyDefaults(config: LivewikiConfig): LivewikiConfig {
```

This function takes a possibly-partial `LivewikiConfig` and returns a new object with every default from `CONFIG_DEFAULTS` spread underneath the caller's own fields. It never mutates its input, and it copies the `languages` array rather than aliasing the shared default array, so later mutations cannot leak across configs.

## Resolving Provider Settings

These helpers translate the raw config into the concrete provider, base URL, and ignore patterns that the execution pipeline actually uses.

<!-- lw:anchors packages/core/src/config.ts#resolveProviderFromConfig packages/core/src/config.ts#resolveBaseUrl packages/core/src/config.ts#resolveExtraIgnores -->

The separation between "what the user wrote" and "what the pipeline needs" is the point of this layer. Configuration is written in terms of presets and optional overrides, but the LLM client factory needs a single, fully-expanded provider descriptor. Moving that expansion into dedicated resolver functions keeps the config shape stable while letting presets evolve independently, and it centralizes the fallback logic so every caller gets identical semantics.

### Expanding a preset or legacy provider

```ts
export function resolveProviderFromConfig(
  config: LivewikiConfig,
): ReturnType<typeof resolveProviderConfig> {
```

This function takes the loaded config and returns the fully-resolved provider settings produced by `resolveProviderConfig` from `presets.ts`. It forwards only the fields that are actually present — `preset`, `provider`, `baseUrl`, and `pricing` — so a preset name expands to its adapter, environment variable, and pricing while any explicit field can still override the preset's built-in value.

### Choosing the final base URL

```ts
export function resolveBaseUrl(config: LivewikiConfig): string {
```

This function returns the effective API base URL for the provider. If the config sets `baseUrl`, that value wins; otherwise a configured `preset` provides its own `baseUrl`; otherwise the function falls back to the legacy `provider`-keyed default from `CONFIG_DEFAULTS.baseUrls`. The final branch assumes the caller has already validated the provider via `validateConfigForBatch`.

### Surfacing user-level ignore patterns

```ts
export function resolveExtraIgnores(config: LivewikiConfig): readonly string[] {
```

This helper returns the configured `ignores` array, or an empty array when the field is absent. It deliberately returns only the user-level overrides — the walker separately applies its own built-in exclusions (`.git`, `.livewiki`, `node_modules`, `dist`, `coverage`) and the repo's `.gitignore`. Because resume and `--only` paths reuse the existing run snapshot rather than rescanning, they never re-evaluate these patterns, which the docstring documents explicitly.

## Validation Flow

This section walks through the two validation layers, one for the file's shape and one for batch-readiness, plus the error type that links them.

<!-- lw:anchors packages/core/src/config.ts#validateConfigShape packages/core/src/config.ts#validateConfigForBatch packages/core/src/config.ts#MissingProviderConfigError packages/core/src/config.ts#MissingProviderConfigError.constructor -->

Validation happens in two deliberately separate passes because they answer different questions at different times. The shape pass runs the moment the file is read and asks "is this file structurally sound?"; the batch pass runs right before a batch starts and asks "is this config sufficient to talk to an LLM?". Keeping them apart means a repo can be initialized and edited without a provider configured, yet still fail loudly the instant a batch is actually attempted — the failure is deferred to the moment the missing setting would matter, not earlier.

### Shape validation of the parsed JSON

```ts
function validateConfigShape(parsed: unknown): LivewikiConfig {
```

This internal function takes the raw `JSON.parse` result and returns a typed `LivewikiConfig` with only the fields that passed every per-field check. It rejects a non-object input outright, then validates each known key: `provider` must be one of the two legacy values, `preset` must be a known preset name, `languages` and `ignores` array elements must be strings, and `pricing` entries must be objects with numeric `input` and `output`. Numeric knobs are range-checked — for example `maxRepairAttempts` and `maxIncompleteRetries` must be non-negative integers, `stage4MaxOutputTokens` and `topicMaxOutputTokens` must be integers in `256..32768`, `topicMaxAnchors` in `5..32`, `batchConcurrency` in `1..16`, and `flowMaxOverlap` in `0..1` (where `1` disables the cap). Boolean switches reject non-boolean values, and the two gitignore-style object fields (`pathRoles` and `flowSignals`) reject unknown keys and non-string-array categories. Unknown top-level keys are simply ignored rather than rejected.

### Batch-readiness validation

```ts
export function validateConfigForBatch(repoRoot: string, config: LivewikiConfig): void {
```

This function ensures the config is sufficient to start an LLM batch. It collects which of `provider` or `model` are missing — a `preset` satisfies the provider requirement because it expands downstream — and, if any are absent, throws `MissingProviderConfigError` with a message that routes the user to `livewiki config`. It also re-checks an explicit `timeoutMs` via `assertValidTimeoutMs`, since programmatic callers may construct configs without going through `loadConfig`.

### The missing-provider error

```ts
export class MissingProviderConfigError extends Error {
```

```ts
constructor(repoRoot: string, missingFields: Array<"provider" | "model">) {
```

This error type carries the repo root and the list of missing fields, building a message that names the repo, lists what is absent, and gives both interactive (`livewiki config`) and headless (set `preset` and `model`, then the credential env var) remediation paths. Its `name` is set to the class name, and the `repoRoot` is exposed as a public readonly field so callers can inspect it programmatically.

## Configuration Lifecycle Summary

The file's story is a single pipeline: `loadConfig` reads the raw JSON, `validateConfigShape` filters and range-checks each field, `applyDefaults` fills every remaining gap from `CONFIG_DEFAULTS`, and `validateConfigForBatch` enforces the provider/model contract before any generation begins. `resolveProviderFromConfig` and `resolveBaseUrl` then turn the validated config into the concrete adapter settings, while `resolveExtraIgnores` feeds the walker its user-level exclusions. `saveConfig` closes the loop by persisting a modified config back to the same path. Throughout, the module refuses to invent a model or provider, keeps API keys out of the file, and fails closed on malformed JSON or out-of-range values so that corrupted configs cannot hide bugs behind silent fallbacks.

## Tests

Covered by `packages/core/src/config.test.ts` (same-name test file on disk).
