---
title: livewiki/llm
owner: generated
anchors:
  - packages/core/src/llm/adapters.test.ts#fakeFetch
  - packages/core/src/llm/anthropic.ts#AnthropicAdapter
  - packages/core/src/llm/anthropic.ts#AnthropicAdapter.constructor
  - packages/core/src/llm/anthropic.ts#AnthropicAdapter.generate
  - packages/core/src/llm/base.ts#isRetryableStatus
  - packages/core/src/llm/base.ts#readText
  - packages/core/src/llm/base.ts#requestWithRetry
  - packages/core/src/llm/base.ts#sleep
  - packages/core/src/llm/index.ts#createLlmClient
  - packages/core/src/llm/index.ts#LlmRequestError
  - packages/core/src/llm/index.ts#LlmRequestError.constructor
  - packages/core/src/llm/index.ts#MissingApiKeyError
  - packages/core/src/llm/index.ts#MissingApiKeyError.constructor
  - packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter
  - packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter.constructor
  - packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter.generate
  - packages/core/src/llm/openai-compat.ts#resolveThinkingMode
---

# llm

Thin HTTP client for LLM providers. Uses Node 20+ native `fetch` — no SDK, no agent framework. Supports Anthropic and an OpenAI-compatible path that covers OpenRouter, LiteLLM, Ollama cloud, etc.

API keys are read from environment variables only (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or the preset-specific env var). They never appear in `config.json`, checkpoint files, logs, or error messages.

## Test helpers
<!-- lw:anchors packages/core/src/llm/adapters.test.ts#fakeFetch -->

`fakeFetch` is the test helper that produces a controllable fetch implementation. It accepts a partial `{ status, body, ok }` descriptor, defaults `status` to `200`, derives `ok` from the status code (200–299) when not given, and returns a `vi.fn` that resolves to a `Response` with `content-type: application/json`. Tests use it to assert request shape, header propagation, and usage normalization without hitting a real provider.

## Anthropic adapter
<!-- lw:anchors packages/core/src/llm/anthropic.ts#AnthropicAdapter packages/core/src/llm/anthropic.ts#AnthropicAdapter.constructor packages/core/src/llm/anthropic.ts#AnthropicAdapter.generate -->

`AnthropicAdapter` implements `LlmClient` for the Anthropic Messages API.

The constructor stores `apiKey`, `baseUrl`, `model`, and a derived `AdapterConfig`. Optional overrides: `fetchImpl` (used by tests), `timeoutMs`, `maxRetries`.

`generate(req)` POSTs to `${baseUrl}/v1/messages` with headers `x-api-key`, `anthropic-version: 2023-06-01`, `content-type: application/json`. Body fields: `model`, `system`, `messages: [{ role: "user", content: req.user }]`, `max_tokens` (default `4096`), and optional `temperature`. The response is normalized: `content` is the first text block (empty string if absent), `usage.input_tokens → inputTokens`, `usage.output_tokens → outputTokens`, plus `usage.model` from the response.

Non-retryable 4xx (e.g. `401`) throws `LlmRequestError` after a single attempt. Retryable status handling is delegated to `requestWithRetry` in `base.ts`.

## Base HTTP utilities
<!-- lw:anchors packages/core/src/llm/base.ts#isRetryableStatus packages/core/src/llm/base.ts#requestWithRetry packages/core/src/llm/base.ts#sleep packages/core/src/llm/base.ts#readText -->

`isRetryableStatus(status)` returns `true` for `429` or any `5xx`. All other statuses are non-retryable.

`requestWithRetry` wraps a single fetch with per-attempt timeout (`AbortController`, default `60_000` ms), exponential backoff between attempts (base `1_000` ms, `2^(attempt-1)` multiplier), and `maxRetries` attempts (default `3`). The request body itself is **not** consumed or persisted between attempts — only the last status and a coarse `network` / `timeout` category are tracked. Retryable failures (`429`, `5xx`) drain the response body to avoid socket leaks, then back off. Non-retryable HTTP errors (`4xx` other than `429`) read the body once and throw `LlmRequestError(provider, status, body)` immediately. After exhausting retries, the final `LlmRequestError` carries status `0` and a `detail` string (`"last status: …"`, `"last error: network|timeout"`, or `"unknown"`) — it never leaks response headers or raw bodies across the retry loop.

`sleep(ms)` resolves after `ms` milliseconds via `setTimeout`.

`readText(res)` returns `res.text()`; a convenience export for adapters that want a uniform body-reader.

`AdapterConfig` (the shared options interface) is also defined here, with `fetchImpl`, `timeoutMs`, `maxRetries`, `retryDelayMs` all optional and defaulted by `requestWithRetry`.

## Factory and error types
<!-- lw:anchors packages/core/src/llm/index.ts#createLlmClient packages/core/src/llm/index.ts#MissingApiKeyError packages/core/src/llm/index.ts#MissingApiKeyError.constructor packages/core/src/llm/index.ts#LlmRequestError packages/core/src/llm/index.ts#LlmRequestError.constructor -->

`createLlmClient(repoRoot, config)` is the single entry point used by the batch runner. It runs `validateConfigForBatch` first (to ensure `provider`/`preset` and `model` are present — otherwise `MissingProviderConfigError` is raised by the config layer), then `resolveProviderFromConfig` to derive the adapter name, base URL, and env var (either from a preset or from the legacy `provider` field). The API key is read from `process.env[resolved.envVar]`; absence throws `MissingApiKeyError`. The function returns an `AnthropicAdapter` for the `"anthropic"` adapter, or an `OpenAiCompatAdapter` for everything else, passing through preset-derived defaults for `thinkingDefault` and `preferMaxCompletionTokens`.

`MissingApiKeyError extends Error` — its `constructor(provider, envVar)` sets the message to a guidance string that names the env var but never references any key value, plus `name`, `provider`, and `envVar` fields.

`LlmRequestError extends Error` — its `constructor(provider, status, errorBody)` truncates the body to `500` characters (append `"…"`) before composing the message, sets `name = "LlmRequestError"`, and exposes `status`, `provider`, `errorBody`. Carries the response body for non-retryable failures only (the one-shot path inside `requestWithRetry`); the retry-exhausted path emits status `0` with a `detail` string and no body. Coverage for key leak prevention lives in `key-leak.test.ts`.

## OpenAI-compatible adapter
<!-- lw:anchors packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter.constructor packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter.generate packages/core/src/llm/openai-compat.ts#resolveThinkingMode -->

`OpenAiCompatAdapter implements LlmClient` for any Chat Completions–style endpoint. Options (`OpenAiCompatAdapterOpts`): `apiKey`, `baseUrl`, `model`, optional `fetchImpl`, `timeoutMs`, `maxRetries`, `thinkingDefault` (default `"omit"`), `preferMaxCompletionTokens` (default `false`). Reads `/v1/chat/completions` so that callers whose `baseUrl` already ends in `/v1` (e.g. `https://proxy.example.com/v1`) are not double-suffixed.

The constructor initializes fields and builds an `AdapterConfig` for `requestWithRetry`.

`generate(req)` builds the request body with `model`, `messages: [{ system, user }, { user }]`, optional `temperature`, and either `max_completion_tokens` or `max_tokens` for `maxOut` (default `4096`) based on the per-request override or `preferMaxCompletionTokens`. Thinking is resolved via `resolveThinkingMode`: when effective mode is `"disabled"` it sends `thinking: { type: "disabled" }`; when `"adaptive"`, `thinking: { type: "adaptive" }`; when `"omit"` the field is absent. Headers are `authorization: Bearer <apiKey>` and `content-type: application/json`. The response is normalized: `content` from the first choice, `usage.prompt_tokens → inputTokens`, `usage.completion_tokens → outputTokens`, plus `usage.model`.

`resolveThinkingMode(requestThinking, adapterDefault, model)` selects the effective thinking mode. An explicit per-request non-`"omit"` value wins. Otherwise `adapterDefault` is honored when it is `"disabled"` or `"adaptive"`. As a final heuristic, model names matching `/minimax-m3/i` map to `"disabled"` to avoid enabling hidden thinking on minimax chat; everything else resolves to `"omit"`.