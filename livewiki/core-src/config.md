---
title: livewiki core config — repository-scoped `.livewiki/config.json` lifecycle
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

# livewiki core config — repository-scoped `.livewiki/config.json` lifecycle

This page documents the module that loads, validates, defaults, and persists the per-repository configuration file used by every livewiki stage.

## When to use this page

- **Load or persist `.livewiki/config.json`** when you need to read a repository's livewiki configuration from disk or write a new one back.
- **Validate a config object** before handing it to the batch pipeline, or shape-check raw JSON before trusting it as a `LivewikiConfig`.
- **Resolve provider, base URL, or extra ignore patterns** from a loaded config so downstream stages receive consistent inputs.

## How it fits

`packages/core/src/config.ts` lives in the `packages/core` workspace of `livewiki`, alongside the LLM client factory, the preset table, the safe I/O allowlist, and the pricing helpers it imports. It owns the canonical file path `.livewiki/config.json` and is the single source of truth for what a valid livewiki config looks like. CLI commands (`init`, `index`, `batch`, and `init --batch`), the batch orchestrator, and any programmatic callers all funnel through `loadConfig` → `applyDefaults` → `validateConfigForBatch` before they touch the LLM client, the walker, or the stage pipeline. The module deliberately keeps API keys out of scope — credentials stay in `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` environment variables so this file can be committed without leaking secrets.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-config.mmd
```

## Path constants and defaults

The module fixes the on-disk location and the runtime default values so every caller resolves the same file and applies the same defaults.

<!-- lw:anchors packages/core/src/config.ts#CONFIG_PATH packages/core/src/config.ts#CONFIG_FILENAME packages/core/src/config.ts#CONFIG_DEFAULTS packages/core/src/config.ts#MAX_TIMEOUT_MS -->

The relative path is held in the module-private `CONFIG_REL_PATH` (`.livewiki/config.json`). `CONFIG_PATH` re-exports that string so external callers can refer to the canonical location without copying the literal, and `CONFIG_FILENAME` derives the bare file name through `nodePath.basename(CONFIG_REL_PATH)` so path joins in downstream tooling stay portable. The safe-I/O allowlist routes any read or write through its allowlisted `.livewiki` scope.

```ts
export const CONFIG_PATH = CONFIG_REL_PATH;
export const CONFIG_FILENAME = nodePath.basename(CONFIG_REL_PATH);
```

The first line exposes the path string (here the literal `.livewiki/config.json`); the second returns just the file portion so other modules can compose paths without re-parsing.

Runtime defaults live in a single frozen-style object so `applyDefaults` can spread them deterministically:

```ts
export const CONFIG_DEFAULTS = {
  language: "en",
  languages: ["ts", "tsx", "js", "jsx", "py"],
  baseUrls: { anthropic: "https://api.anthropic.com", "openai-compat": "https://api.openai.com" },
  maxRepairAttempts: 2,
  maxIncompleteRetries: 2,
  stage4MaxOutputTokens: 32_768,
  outputTokenStrategy: "dynamic",
  // ...split thresholds, flow/topic/diagram budgets, repair & risk knobs, etc.
  batchConcurrency: 1,
} as const;
```

This object returns a frozen-typed map from default keys to their resolved values, including `language: "en"` as the only field with an explicit user-facing default. The split thresholds (`maxModuleFiles: 12`, `maxModuleSymbols: 80`, `fileSplitSourceBytes: 60_000`) drive stage-4 module decomposition; the flow/topic/diagram budgets (`maxFlows`, `maxTopics`, `flowMaxDiagramNodes`, `moduleMaxDiagramNodes`, …) cap stage-5 synthesis; the boolean recovery-tier knobs (`surgicalRepair`, `relaxedRound`) and risk knobs (`riskAnalysis`, `riskChurnCommits`) tune behavior in `status` / `update` / repair. Defaults are applied at use time, never written into the on-disk file, which preserves the principle that an absent field means "user did not set this".

The timeout ceiling is exported separately because the safe upper bound is a Node-platform constant rather than a project decision:

```ts
export const MAX_TIMEOUT_MS = 2_147_483_647;
```

This constant returns the maximum millisecond value that Node's `setTimeout` accepts safely (the signed 32-bit maximum), used both as the upper bound for `timeoutMs` and as the message text in the validator's error.

## Timeout validation

Programmatic callers may bypass `loadConfig` and supply a config object directly, so the timeout check is exported as a reusable assertion.

<!-- lw:anchors packages/core/src/config.ts#assertValidTimeoutMs -->

```ts
export function assertValidTimeoutMs(v: unknown): asserts v is number {
```

This function takes an unknown value and returns nothing on success, narrowing `v` to `number` for TypeScript callers; on failure it throws an `Error`. The implementation rejects anything that is not a `number`, is not an integer (`Number.isInteger`), or lies outside `[0, MAX_TIMEOUT_MS]`. The visible check enforces **both** the lower bound (`v < 0`) and the upper bound (`v > MAX_TIMEOUT_MS`), so the constant functions as a true two-sided range — `0` disables the client abort and the upper bound is the Node safe maximum.

The error message explicitly distinguishes `0` (disable timeout) from positive integers so users can tell at a glance which boundary they crossed. Floats, `NaN`, strings, and negatives all fall into the same rejection branch.

## Loading and saving the on-disk config

Two thin wrappers around the safe-I/O helpers translate JSON text to and from the typed `LivewikiConfig` shape.

<!-- lw:anchors packages/core/src/config.ts#loadConfig packages/core/src/config.ts#saveConfig -->

```ts
export async function loadConfig(repoRoot: string): Promise<LivewikiConfig> {
```

This function takes a repository root directory and returns a promise that resolves to a validated `LivewikiConfig`. The flow is: probe the file with `safeIo.exists` (the `.catch(() => false)` swallow handles a probe failure as "not present"); return `{}` when absent or empty; otherwise `safeIo.readText` the file, `JSON.parse` it, and hand the parsed value to `validateConfigShape`. The visible failure branch throws a wrapped `Error` whose message includes the relative path and the underlying parser message — corrupted JSON fails closed rather than silently returning defaults. The empty-file fast path means a zero-byte file is treated identically to a missing one.

```ts
export async function saveConfig(
  repoRoot: string,
  config: LivewikiConfig,
): Promise<void> {
```

This function takes the repository root and a `LivewikiConfig`, then returns a promise that resolves once the file is written; it has no return value. It serializes the config with `JSON.stringify(config, null, 2)` plus a trailing newline (consistent diff formatting) and writes through `safeIo.writeText` so the write is restricted to the allowlisted `.livewiki` scope. There is no separate validation step inside `saveConfig` — the shape check happens upstream — so callers are expected to have already passed `validateConfigShape` and, where relevant, `validateConfigForBatch`.

## Shape validation

A deep, opt-in validator turns arbitrary JSON into a `LivewikiConfig`, rejecting values that cannot be coerced rather than silently substituting defaults.

<!-- lw:anchors packages/core/src/config.ts#validateConfigShape -->

```ts
function validateConfigShape(parsed: unknown): LivewikiConfig {
```

This function takes an unknown parsed value and returns a coerced `LivewikiConfig`; the function is module-private so external callers reach it transitively through `loadConfig`. The flow has three layers:

1. **Container check.** A `null`, non-object, or array value throws immediately with `"config must be a JSON object"` — there is no attempt to coerce an array into a single-key object.
2. **Enum and literal validation.** `provider` must be the string `"anthropic"` or `"openai-compat"`; anything else throws listing both legacy values and the modern preset alternative. `preset` must pass `isKnownPreset(p)` from `presets.ts`; otherwise the error points at `PRESET_TABLE` in that file. `outputTokenStrategy` is restricted to `"dynamic" | "fixed"`; `thinking` to `"disabled" | "adaptive" | "omit"`. These three branches throw on any value not in the literal union — they do not fall back to a default.
3. **Range and type validation for numeric fields.** Each integer field has an explicit inclusive range that is enforced on **both** sides:
   - `stage4MaxOutputTokens` and `topicMaxOutputTokens`: integer in `256..32_768`.
   - `maxTopics`: integer in `0..8`.
   - `topicMaxAnchors`: integer in `5..32`.
   - `topicMaxSourceChars` and `rationaleMaxChars`: integer in `1..200_000` and `0..200_000` respectively.
   - `riskChurnCommits`: integer in `0..10_000` (`0` disables the git spawn).
   - `flowMaxOverlap`: finite number in `0..1` (`1` disables the cap).
   - `batchConcurrency`: integer in `1..16`.
   - All other integer counters (`maxRepairAttempts`, `maxIncompleteRetries`, `maxModuleFiles`, `maxModuleSymbols`, `fileSplitSourceBytes`, `maxFlows`, `flowMaxAnchors`, diagram node/edge caps): non-negative integer (or `>= 1` where `0` would be meaningless).

   Booleans (`riskAnalysis`, `surgicalRepair`, `relaxedRound`, `moduleDiagrams`, `deepHierarchy`, `concernTopics`, `understandingSynthesis`, `communityDetection`) reject any non-boolean value. Strings, arrays of strings (`languages`, `ignores`), and the nested `pricing` map are filtered for shape and copied through. `timeoutMs` is funneled through `assertValidTimeoutMs`. The visible behavior is: any value outside the range throws with a message that includes the bad value via `JSON.stringify` — there is no silent fallback to `CONFIG_DEFAULTS` for corrupted fields.

`pathRoles` and `flowSignals` accept only the documented category keys (`testPatterns`/`fixturePatterns`/`toolingPatterns`/`docsPatterns` and `entryPatterns`/`persistencePatterns`/`persistenceImportPatterns` respectively), each category must be an array of strings, and supplying a category fully replaces the built-in patterns (an empty array disables it). Unknown keys throw with the literal offending key.

## Applying defaults

Once a config is loaded and shape-validated, missing fields are filled in from `CONFIG_DEFAULTS` to produce the runtime view the rest of the pipeline consumes.

<!-- lw:anchors packages/core/src/config.ts#applyDefaults packages/core/src/config.ts#resolveExtraIgnores packages/core/src/config.ts#resolveBaseUrl packages/core/src/config.ts#resolveProviderFromConfig -->

```ts
export function applyDefaults(config: LivewikiConfig): LivewikiConfig {
```

This function takes a `LivewikiConfig` and returns a fresh `LivewikiConfig` with defaults applied; it does not mutate the input. The implementation is a plain object literal that lists every default key first, then spreads `...config`, so a user-supplied field always wins. Arrays like `languages` are explicitly cloned (`[...CONFIG_DEFAULTS.languages]`) so later mutations by callers cannot leak back into the defaults table.

```ts
export function resolveExtraIgnores(config: LivewikiConfig): readonly string[] {
```

This function takes a `LivewikiConfig` and returns a read-only view of the user-level `ignores` array (an empty array when the field is absent). The returned list is the configured user-level overrides only — the walker layers its own built-in defaults (`.git`, `.livewiki`, `node_modules`, `dist`, `coverage`) and the repository's `.gitignore` on top of this. The docstring explicitly lists which entry points actually rescan (`init`, `index`, `init --batch`, `batch`) and which do not (`batch resume`, `--only`), so an ignored path cannot re-enter the run via resume.

```ts
export function resolveBaseUrl(config: LivewikiConfig): string {
```

This function takes a `LivewikiConfig` and returns the effective base URL string. The resolution order is: explicit `config.baseUrl` wins first; otherwise, if a `preset` is set, the preset table's `baseUrl` is used (via `resolvePreset`); only as a last resort does it fall through to `CONFIG_DEFAULTS.baseUrls[provider]`. The third branch is reachable only when the caller has already established that `provider` is set — `validateConfigForBatch` is the gate that guarantees this — and the implementation uses a type assertion (`config.provider as LlmProvider`) at that point.

```ts
export function resolveProviderFromConfig(
  config: LivewikiConfig,
): ReturnType<typeof resolveProviderConfig> {
```

This function takes a `LivewikiConfig` and returns the resolved provider config object (the `ReturnType` of `resolveProviderConfig` from `presets.ts`). It performs a conditional spread of `preset`, `provider`, `baseUrl`, and `pricing` (each only included when defined) and forwards the merged view to `resolveProviderConfig`, which expands a preset into the full provider tuple and applies any field-level overrides. The function deliberately does not validate "model missing" — that responsibility belongs to `validateConfigForBatch`.

## Batch-time validation

The single gate the orchestrator calls before it is allowed to build an LLM client.

<!-- lw:anchors packages/core/src/config.ts#validateConfigForBatch packages/core/src/config.ts#MissingProviderConfigError packages/core/src/config.ts#MissingProviderConfigError.constructor -->

```ts
export function validateConfigForBatch(repoRoot: string, config: LivewikiConfig): void {
```

This function takes the repository root and a config, and returns nothing; on failure it throws `MissingProviderConfigError`. The flow is:

1. Build the `missing` list. A preset reference satisfies the provider requirement — `!config.provider && !config.preset` is the only condition that pushes `"provider"`. `!config.model` independently pushes `"model"`. This is the one path where the visible source deliberately treats `preset` as equivalent to `provider`.
2. If anything is missing, throw `MissingProviderConfigError(repoRoot, missing)` and stop — there is no silent model substitution.
3. Otherwise, if `config.timeoutMs` is defined, route it through `assertValidTimeoutMs`. Programmatic callers that skip `loadConfig` still get the same two-sided `[0, MAX_TIMEOUT_MS]` enforcement.

```ts
export class MissingProviderConfigError extends Error {
  public readonly repoRoot: string;
  constructor(repoRoot: string, missingFields: Array<"provider" | "model">) {
```

The constructor takes the repo root and the list of missing literal fields (`"provider"` and/or `"model"`), then returns an initialized `MissingProviderConfigError` instance. The class extends the built-in `Error`; the constructor builds an example block (`{ "provider": "anthropic", "model": "claude-sonnet-5" }`, with a comment that the model is an example only and the user must pick what they want) and prepends it to the message. `this.name` is set to `"MissingProviderConfigError"` so it survives `JSON.stringify(err)` / stack-trace formatting, and `this.repoRoot` is exposed as a public field so callers can branch on the failing repository without re-parsing the message. The model name in the example is **explicitly framed as an example, not a default** — `livewiki` will never substitute a model on the user's behalf.

## Tests

Covered by `packages/core/src/config.test.ts` (same-name test file on disk).
