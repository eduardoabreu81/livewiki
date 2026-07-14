---
title: llm
owner: generated
anchors:
  - packages/core/src/llm/adapters.test.ts#fakeFetch
  - packages/core/src/llm/anthropic.ts#AnthropicAdapter
  - packages/core/src/llm/anthropic.ts#AnthropicAdapter.constructor
  - packages/core/src/llm/anthropic.ts#AnthropicAdapter.generate
  - packages/core/src/llm/anthropic.ts#normalizeStopReason
  - packages/core/src/llm/base.ts#DEFAULT_LLM_TIMEOUT_MS
  - packages/core/src/llm/base.ts#LlmTimeoutError
  - packages/core/src/llm/base.ts#LlmTimeoutError.constructor
  - packages/core/src/llm/base.ts#isRetryableStatus
  - packages/core/src/llm/base.ts#readText
  - packages/core/src/llm/base.ts#requestWithRetry
  - packages/core/src/llm/base.ts#sleep
  - packages/core/src/llm/base.ts#withTimeoutMs
  - packages/core/src/llm/index.ts#LlmRequestError
  - packages/core/src/llm/index.ts#LlmRequestError.constructor
  - packages/core/src/llm/index.ts#MissingApiKeyError
  - packages/core/src/llm/index.ts#MissingApiKeyError.constructor
  - packages/core/src/llm/index.ts#createLlmClient
  - packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter
  - packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter.constructor
  - packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter.generate
  - packages/core/src/llm/openai-compat.ts#normalizeFinishReason
  - packages/core/src/llm/openai-compat.ts#resolveThinkingMode
---

## Test helpers
<!-- lw:anchors packages/core/src/llm/adapters.test.ts#fakeFetch -->

`fakeFetch` returns a fetch-like function that resolves with a controlled `Response`. The signature accepts an object with `status`, `body`, and `ok` fields; missing values default to status 200, ok derived from 2xx, and an empty JSON object body. It is used across the adapter test suites to drive request/response assertions without hitting the network.

## Shared HTTP layer
<!-- lw:anchors packages/core/src/llm/base.ts#DEFAULT_LLM_TIMEOUT_MS packages/core/src/llm/base.ts#LlmTimeoutError packages/core/src/llm/base.ts#LlmTimeoutError.constructor packages/core/src/llm/base.ts#isRetryableStatus packages/core/src/llm/base.ts#withTimeoutMs packages/core/src/llm/base.ts#requestWithRetry packages/core/src/llm/base.ts#sleep packages/core/src/llm/base.ts#readText -->

`DEFAULT_LLM_TIMEOUT_MS` is the constant `300_000` (5 minutes) applied when a configuration does not specify `timeoutMs`.

`LlmTimeoutError` extends `Error` and is thrown when a client-side abort fires before the provider responds. Its constructor takes `provider: LlmProvider` and `timeoutMs: number`, and stores both on the instance. The message clarifies that the provider may still bill and that usage is unknown.

`isRetryableStatus` returns `true` only for HTTP 429 or any 5xx status; every other status is treated as a terminal failure that should not trigger another attempt.

`withTimeoutMs` is a spread helper that returns `{ timeoutMs }` when the argument is defined (including `0`) and an empty object otherwise, so callers can preserve the "disable" semantics without truthy checks dropping zero.

`requestWithRetry` runs an HTTP request with up to `maxRetries` attempts. It only retries HTTP 429/5xx via `isRetryableStatus` and a non-`AbortError` network failure; on a non-retryable status it throws `LlmRequestError` immediately. When `timeoutMs > 0`, an `AbortController` is armed and an `AbortError` is translated into `LlmTimeoutError` without a second generation attempt. On exhaustion the function throws `LlmRequestError` with a diagnostic `errorBody` describing the last status or network error kind.

`sleep` returns a promise that resolves after `ms` milliseconds and is used between retries for exponential backoff (`retryDelayMs * 2^(attempt-1)`).

`readText` is a thin wrapper around `Response.text()` for reading provider error bodies.

## Anthropic adapter
<!-- lw:anchors packages/core/src/llm/anthropic.ts#AnthropicAdapter packages/core/src/llm/anthropic.ts#AnthropicAdapter.constructor packages/core/src/llm/anthropic.ts#AnthropicAdapter.generate packages/core/src/llm/anthropic.ts#normalizeStopReason -->

`AnthropicAdapter` implements `LlmClient` with `provider: "anthropic"`. Its constructor takes `{ apiKey, baseUrl, model, fetchImpl?, timeoutMs?, maxRetries? }`, storing the public `model` and the fields needed to build requests, and assembling an internal `AdapterConfig` (using `withTimeoutMs` so `timeoutMs: 0` is preserved).

`AnthropicAdapter.generate` POSTs to `<baseUrl>/v1/messages` with headers `x-api-key`, `anthropic-version: 2023-06-01`, and `content-type: application/json`. The request body contains `model`, `system`, `messages: [{ role: "user", content: user }]`, and `max_tokens` (default 4096). The first text block of the response is returned as `content`, and `usage.input_tokens` / `usage.output_tokens` are remapped to `inputTokens` / `outputTokens`.

`normalizeStopReason` maps Anthropic `stop_reason` strings to the canonical `StopReason`: `"max_tokens"` → `"length"`, `"end_turn"` and `"stop_sequence"` → `"complete"`, `null`/`undefined` → `"unknown"`, and any other value (including `"tool_use"`) → `"incomplete"`.

## OpenAI-compatible adapter
<!-- lw:anchors packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter.constructor packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter.generate packages/core/src/llm/openai-compat.ts#normalizeFinishReason packages/core/src/llm/openai-compat.ts#resolveThinkingMode -->

`OpenAiCompatAdapter` implements `LlmClient` with `provider: "openai-compat"` and an options bag `OpenAiCompatAdapterOpts` that extends the basic adapter fields with `thinkingDefault` and `preferMaxCompletionTokens`. The constructor stores `model` publicly, captures `thinkingDefault` (default `"omit"`) and `preferMaxCompletionTokens` (default `false`), and assembles an `AdapterConfig` that also preserves `timeoutMs: 0` via `withTimeoutMs`.

`OpenAiCompatAdapter.generate` resolves the chat-completions URL, appending `/v1/chat/completions` only when the base URL does not already end in `/v1`. The body always carries `model`, a `[system, user]` message pair, and either `max_completion_tokens` or `max_tokens` (chosen by `preferMaxCompletionTokens`, defaulting to `max_tokens`). `resolveThinkingMode` decides whether to emit `thinking: { type: "disabled" | "adaptive" }`; when omitted, the field is not sent. The response's first message `content` becomes `content`, `prompt_tokens` / `completion_tokens` are remapped to `inputTokens` / `outputTokens`, and the first `finish_reason` is normalized.

`normalizeFinishReason` maps `"length"` → `"length"`, `"stop"` → `"complete"`, `null`/`undefined` → `"unknown"`, and any other value (including `"tool_calls"`) → `"incomplete"`.

`resolveThinkingMode` returns the request's explicit thinking mode (when not `"omit"`), then the adapter default, with a fallback heuristic: when the model name matches `minimax-m3`, the function returns `"disabled"` because the provider would otherwise enable thinking by default.

## Public LLM surface
<!-- lw:anchors packages/core/src/llm/index.ts#createLlmClient packages/core/src/llm/index.ts#MissingApiKeyError packages/core/src/llm/index.ts#MissingApiKeyError.constructor packages/core/src/llm/index.ts#LlmRequestError packages/core/src/llm/index.ts#LlmRequestError.constructor -->

`createLlmClient` validates the config via `validateConfigForBatch`, resolves the provider (preset first, then legacy `provider`), picks `baseUrl` from the resolution or config defaults, reads the API key from the resolved env var, and instantiates either `AnthropicAdapter` or `OpenAiCompatAdapter` (the latter receiving `thinkingDefault` and `preferMaxCompletionTokens`). `timeoutMs` is forwarded with explicit `undefined` checks so a configured `0` disables the abort timer.

`MissingApiKeyError` extends `Error`. Its constructor stores `provider` and `envVar` and produces a message stating that keys must come from the named environment variable and never from config, checkpoints, logs, or error output.

`LlmRequestError` extends `Error`. Its constructor stores `status`, `provider`, and `errorBody` (truncated to 500 characters in the displayed message) and produces a `LLM <provider> request failed (status <status>): <body>` string. It is the terminal failure produced both by a non-retryable HTTP response and by exhausted retries.