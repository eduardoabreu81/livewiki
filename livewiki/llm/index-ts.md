---
title: LLM Client Factory and Error Types
owner: generated
anchors:
  - packages/core/src/llm/index.ts#LlmRequestError
  - packages/core/src/llm/index.ts#LlmRequestError.constructor
  - packages/core/src/llm/index.ts#MissingApiKeyError
  - packages/core/src/llm/index.ts#MissingApiKeyError.constructor
  - packages/core/src/llm/index.ts#createLlmClient
---

# LLM Client Factory and Error Types

This page explains how the LLM client is constructed and what error types it exposes.

## When to use this page

- Understand how `createLlmClient` turns a validated config into a concrete provider adapter.
- Learn the credential resolution rules that decide which API key is used, and when a `MissingApiKeyError` is thrown.
- Inspect the two LLM-specific error classes (`MissingApiKeyError` and `LlmRequestError`) to see what information they carry and what they deliberately omit.
- Extend or debug the LLM client factory without reading the provider adapter implementations.

## How it fits

`packages/core/src/llm/index.ts` is the public surface of the LLM subsystem. It exposes a thin factory that takes a validated repo config and returns an `LlmClient` — either an `AnthropicAdapter` or an `OpenAiCompatAdapter` (the latter also covering OpenRouter/LiteLLM/Ollama via a configurable base URL). It also defines the two error types that callers of the client may observe. The module imports validation helpers from `../config.js`, a credential resolver from `../credentials.js`, provider adapters from sibling files, and re-exports `LlmTimeoutError` and the LLM types from `./base.js` and `./types.js`. It does not itself perform HTTP requests — that responsibility lives in the adapters.

## Diagram

```mermaid
%% livewiki/diagrams/llm-index-ts.mmd
```

## Factory flow

<!-- lw:anchors packages/core/src/llm/index.ts#createLlmClient -->

`createLlmClient(repoRoot: string, config: LivewikiConfig): LlmClient` is the core factory of this module. It takes a repository root and a validated `LivewikiConfig`, and returns a ready-to-use `LlmClient`. Its job is to bridge configuration and credentials into a concrete HTTP-based provider adapter, without leaking secrets or assuming a default model.

The factory begins by calling `validateConfigForBatch(repoRoot, config)` from `../config.js`. This step is not optional: it ensures that a provider or preset and a model are present, and that `timeoutMs` is sane, even when the config was not loaded through the normal `loadConfig` path. If provider or model are missing, `validateConfigForBatch` throws `MissingProviderConfigError`.

Next, the factory resolves the provider shape through `resolveProviderFromConfig(config)`. This handles three cases, in priority order: a `config.preset` (newer configuration) expands into an adapter name, a default base URL, an environment-variable name, and pricing metadata; a legacy `config.provider` supplies an adapter with default base URL and environment-variable name; and if neither exists, the earlier validation already aborted. The resolved object also carries the exact environment-variable name that holds the credential.

The model name is taken directly from `config.model`, and the base URL is chosen with a precedence that favors an explicit config value, then the preset's base URL, then a provider default. The factory then resolves credentials via `resolveCredentialSync(resolved.envVar).value`, which checks the process environment before the global credential store; keys are never read from `config.json`, `checkpoint_json`, logs, or error messages. If that resolution returns nothing and the provider does not mark the credential as optional, the factory throws `MissingApiKeyError`; for optional credentials it substitutes the locally scoped sentinel value `"livewiki-local"`.

Timeout handling is deliberate about preserving `timeoutMs: 0` as a disabled-timeout signal. The factory constructs a `timeoutOpts` object only when `config.timeoutMs` is explicitly defined, then spreads it into the adapter options, letting the underlying request logic apply its own default when absent.

Finally, the factory branches on the resolved adapter name. For `"anthropic"` it returns `new AnthropicAdapter({ apiKey, baseUrl, model, ...timeoutOpts })`; otherwise it returns `new OpenAiCompatAdapter` with the same base options plus preset-derived fields `thinkingDefault` and `preferMaxCompletionTokens`, which control thinking-mode behavior and the preferred token-field name for OpenAI-compatible endpoints. In both branches the caller receives an object whose `generate` method will make the actual HTTP call.

## Credential-missing error

<!-- lw:anchors packages/core/src/llm/index.ts#MissingApiKeyError packages/core/src/llm/index.ts#MissingApiKeyError.constructor -->

`MissingApiKeyError` is the error raised when a remote provider credential is unavailable at client-construction time. Its constructor `constructor(provider: LlmProvider, envVar: string)` takes the provider name and the environment-variable slot that should hold the key, and returns an error whose message names only that slot — never a credential value.

The constructor builds its message with the provider and env-var name, sets `this.name` to `"MissingApiKeyError"`, and stores both inputs as public readonly fields so callers can inspect them programmatically. The message text explicitly instructs the user to run `livewiki config` or set the environment variable, and reminds them that keys never live in config files, logs, or error messages. This class is intentionally minimal because it exists only to make the missing-key condition diagnosable without ever exposing the secret.

## Request-failure error

<!-- lw:anchors packages/core/src/llm/index.ts#LlmRequestError packages/core/src/llm/index.ts#LlmRequestError.constructor -->

`LlmRequestError` is the error raised when a provider returns an error or an HTTP request fails. Its constructor `constructor(provider: LlmProvider, status: number, errorBody: string)` takes the provider name, the HTTP status code, and the raw error body from the provider, and returns an error that carries the body but never the request headers.

The constructor truncates the error body to 500 characters (appending an ellipsis) so that a large JSON response does not flood the error message. It then formats a message of the form `LLM <provider> request failed (status <status>): <truncated body>`, sets `this.name` to `"LlmRequestError"`, and exposes `status`, `provider`, and the full untruncated `errorBody` as public readonly fields. The deliberate exclusion of headers is a security invariant: headers can contain the API key, so they must never appear in any error message or logged output.