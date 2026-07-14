---
title: src-config-ts
owner: generated
anchors:
  - packages/core/src/config.ts#CONFIG_DEFAULTS
  - packages/core/src/config.ts#CONFIG_FILENAME
  - packages/core/src/config.ts#CONFIG_PATH
  - packages/core/src/config.ts#MissingProviderConfigError
  - packages/core/src/config.ts#MissingProviderConfigError.constructor
  - packages/core/src/config.ts#applyDefaults
  - packages/core/src/config.ts#loadConfig
  - packages/core/src/config.ts#resolveBaseUrl
  - packages/core/src/config.ts#resolveProviderFromConfig
  - packages/core/src/config.ts#saveConfig
  - packages/core/src/config.ts#validateConfigForBatch
  - packages/core/src/config.ts#validateConfigShape
---

## Overview

`packages/core/src/config.ts` loads and saves the per-repo `.livewiki/config.json`. It enforces the rule that **no model defaults are hardcoded** — the LLM batch will fail loud with `MissingProviderConfigError` if `provider` or `model` are absent, and API keys never appear in this file (they stay in `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` env vars).

## Defaults and paths

<!-- lw:anchors packages/core/src/config.ts#CONFIG_DEFAULTS packages/core/src/config.ts#CONFIG_PATH packages/core/src/config.ts#CONFIG_FILENAME -->

`CONFIG_DEFAULTS` is the runtime default table. It is **not** written to the file — only applied via `applyDefaults` when the config is consumed. Notable entries: `language: "en"`, `languages: ["ts","tsx","js","jsx","py"]`, `maxRepairAttempts: 2`, `stage4MaxOutputTokens: 8192`, `maxModuleFiles: 12`, `maxModuleSymbols: 80`, plus a `baseUrls` map per provider.

`CONFIG_PATH` re-exports the relative path (`.livewiki/config.json`) for callers; `CONFIG_FILENAME` is the basename derived from it.

## Loading and saving

<!-- lw:anchors packages/core/src/config.ts#loadConfig packages/core/src/config.ts#saveConfig -->

`loadConfig(repoRoot)` reads `.livewiki/config.json` if present, parses it, and runs it through `validateConfigShape`. Missing file returns `{}`; empty body returns `{}`; malformed JSON throws with the path and the underlying parser message. Fails closed.

`saveConfig(repoRoot, config)` serializes with 2-space indent + trailing newline via `safeIo.writeText` (allowlist-enforced).

## Default application and provider resolution

<!-- lw:anchors packages/core/src/config.ts#applyDefaults packages/core/src/config.ts#resolveProviderFromConfig packages/core/src/config.ts#resolveBaseUrl -->

`applyDefaults(config)` returns a new object (no mutation) with `CONFIG_DEFAULTS` spread underneath `...config`, so any field present in the file wins.

`resolveProviderFromConfig(config)` delegates to `resolveProviderConfig` from `presets.ts`, threading `preset` / `provider` / `baseUrl` / `pricing` through. It does **not** validate that `model` is set — that's `validateConfigForBatch`'s job.

`resolveBaseUrl(config)` returns `config.baseUrl` if present, otherwise the preset's baseUrl, otherwise `CONFIG_DEFAULTS.baseUrls[provider]` (the caller is responsible for ensuring `provider` is set).

## Batch validation

<!-- lw:anchors packages/core/src/config.ts#validateConfigForBatch packages/core/src/config.ts#MissingProviderConfigError packages/core/src/config.ts#MissingProviderConfigError.constructor -->

`validateConfigForBatch(repoRoot, config)` checks for `provider` and `model`; if either is missing it throws `MissingProviderConfigError`.

`MissingProviderConfigError extends Error`. The `constructor(repoRoot, missingFields)` builds a message naming the missing fields, pointing to `.livewiki/config.json`, and showing an example block (e.g. `provider: "anthropic"`, `model: "claude-sonnet-5"`) labeled as an example only — never as a silent fallback. The class also exposes the `repoRoot` as a readonly field and sets `this.name`.

## Shape validation

<!-- lw:anchors packages/core/src/config.ts#validateConfigShape -->

`validateConfigShape(parsed)` is a module-private shallow guard against malformed JSON objects. It rejects non-object roots, accepts only `"anthropic"` or `"openai-compat"` as `provider`, validates `preset` against the known preset table, and enforces strict integer constraints on `maxRepairAttempts`, `stage4MaxOutputTokens`, `maxModuleFiles`, `maxModuleSymbols`. It also constrains `thinking` to one of `"disabled" | "adaptive" | "omit"`. Unknown extra keys are silently dropped. This is intentionally distinct from `validateConfigForBatch` (which checks batch-readiness, not shape).