---
title: livewiki llm module reference
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
  - packages/core/src/llm/index.ts#LlmRequestError
  - packages/core/src/llm/index.ts#LlmRequestError.constructor
  - packages/core/src/llm/index.ts#MissingApiKeyError
  - packages/core/src/llm/index.ts#MissingApiKeyError.constructor
  - packages/core/src/llm/index.ts#createLlmClient
  - packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter
  - packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter.constructor
  - packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter.generate
  - packages/core/src/llm/openai-compat.ts#resolveThinkingMode
---

# llm module

Thin HTTP client for LLM providers. Implemented in `@livewiki/core/llm`. No SDK, no agent framework — uses native `fetch` from Node 20+.

Providers:
- `anthropic` — Anthropic Messages API
- `openai-compat` — OpenAI Chat Completions–compatible APIs (OpenAI, OpenRouter, LiteLLM, MiniMax chat, Ollama cloud)

## Public errors and factory

<!-- lw:anchors packages/core/src/llm/index.ts#createLlmClient packages/core/src/llm/index.ts#MissingApiKeyError packages/core/src/llm/index.ts#MissingApiKeyError.constructor packages/core/src/llm/index.ts#LlmRequestError packages/core/src/llm/index.ts#LlmRequestError.constructor -->

### `createLlmClient(repoRoot, config)`
Constructs an `LlmClient` from a validated `LivewikiConfig`. Resolves provider via `config.preset` (preferred) or `config.provider` (legacy). Reads the API key from the env var returned by `resolveProviderFromConfig` — never from `config.json`, checkpoint state, logs, or error messages. Throws:
- `MissingProviderConfigError` (from `validateConfigForBatch`) when provider/preset or model is missing.
- `MissingApiKeyError` when the env var for the resolved provider is unset.

### `MissingApiKeyError`
Thrown when the API key env var is absent. Message names the provider and env var but never the key value. Exposes `provider` and `envVar`.

### `LlmRequestError`
Thrown when a non-retryable HTTP error occurs, or when retries are exhausted on retryable errors. Carries `provider`, `status`, and a truncated `errorBody` (≤ 500 chars). Message format: `LLM <provider> request failed (status <status>): <truncated-body>`. The HTTP request headers (containing the key) are **never** included in the error.

## HTTP adapter base

<!-- lw:anchors packages/core/src/llm/base.ts#isRetryableStatus packages/core/src/llm/base.ts#requestWithRetry packages/core/src/llm/base.ts#sleep packages/core/src/llm/base.ts#readText -->

Shared HTTP utilities used by both provider adapters.

### `isRetryableStatus(status)`
Returns `true` for `429` and any status in `500..599`. All other statuses are non-retryable and propagate immediately.

### `requestWithRetry(provider, url, init, adapterConfig)`
Performs a `fetch` with:
- per-attempt timeout via `AbortController` (default 60 000 ms)
- exponential backoff between attempts (default: 3 retries, 1 000 ms base delay)
- retry only when `isRetryableStatus(res.status)` returns `true`, or on `AbortError` / network errors

Non-retryable HTTP responses are turned into `LlmRequestError` with the body attached immediately (single-shot path). On retryable exhaustion, a `LlmRequestError` is thrown with `status: 0` and a detail message of the form `last status: <n>` or `last error: <network|timeout>`. Raw provider error bodies from retryable attempts are **not** retained to avoid socket leaks and to keep sensitive data out of error messages.

### `sleep(ms)`
`Promise<void>` resolving after `ms` milliseconds. Internal to retry backoff.

### `readText(res)`
Await `res.text()`. Convenience export for adapters.

## Anthropic adapter

<!-- lw:anchors packages/core/src/llm/anthropic.ts#AnthropicAdapter packages/core/src/llm/anthropic.ts#AnthropicAdapter.constructor packages/core/src/llm/anthropic.ts#AnthropicAdapter.generate -->

### `AnthropicAdapter`
Implements `LlmClient`. Endpoint: `POST <baseUrl>/v1/messages`. Provider name: `"anthropic"`.

Request headers:
- `x-api-key: <apiKey>`
- `anthropic-version: 2023-06-01`
- `content-type: application/json`

Request body: `{ model, system, messages: [{ role: "user", content }], max_tokens, temperature? }`. `max_tokens` defaults to `4096`.

Response parsing normalizes `usage.input_tokens → inputTokens` and `usage.output_tokens → outputTokens`. `content` is taken from the first `type: "text"` block; missing text becomes `""`.

Tests assert:
- 4xx (non-429) is a single-shot `LlmRequestError` (no retries).
- 429 and 5xx are retried by `requestWithRetry`.

### `AnthropicAdapter.constructor(opts)`
Options: `apiKey`, `baseUrl`, `model`, `fetchImpl?`, `timeoutMs?`, `maxRetries?`. `fetchImpl`, `timeoutMs`, `maxRetries` are only forwarded to the retry config when provided.

### `AnthropicAdapter.generate(req)`
Issues the Anthropic Messages request through `requestWithRetry` and returns `{ content, usage: { inputTokens, outputTokens, model } }`.

## OpenAI-compat adapter

<!-- lw:anchors packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter.constructor packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter.generate packages/core/src/llm/openai-compat.ts#resolveThinkingMode -->

### `OpenAiCompatAdapter`
Implements `LlmClient`. Endpoint: `POST <baseUrl>/v1/chat/completions` (or `<baseUrl>/chat/completions` if `baseUrl` already ends in `/v1`). Provider name: `"openai-compat"`.

Request headers:
- `authorization: Bearer <apiKey>`
- `content-type: application/json`

Request body (chat completions shape):
```json
{
  "model": "<model>",
  "messages": [
    { "role": "system", "content": "<system>" },
    { "role": "user", "content": "<user>" }
  ],
  "temperature": <optional>,
  "max_completion_tokens": <n> | "max_tokens": <n>,
  "thinking": { "type": "disabled" } | { "type": "adaptive" }
}
```

`preferMaxCompletionTokens` (request-level override or adapter default) selects `max_completion_tokens` vs legacy `max_tokens`. Defaults to `4096` when `req.maxTokens` is unset.

Thinking payload is computed via `resolveThinkingMode`.

Response parsing normalizes `usage.prompt_tokens → inputTokens` and `usage.completion_tokens → outputTokens`. `content` is taken from `choices[0].message.content`; missing fields fall back to `""` / `0`.

### `OpenAiCompatAdapter.constructor(opts)`
Options: `apiKey`, `baseUrl`, `model`, `fetchImpl?`, `timeoutMs?`, `maxRetries?`, `thinkingDefault?` (`"disabled" | "adaptive" | "omit" | "n/a"`, default `"omit"`), `preferMaxCompletionTokens?` (default `false`).

### `OpenAiCompatAdapter.generate(req)`
Builds the chat-completions body, runs `requestWithRetry`, decodes JSON, and returns `{ content, usage }`.

### `resolveThinkingMode(requestThinking, adapterDefault, model)`
Effective mode resolution:
1. If `requestThinking` is `"disabled"` or `"adaptive"`, return it.
2. If `requestThinking === "omit"`, return `"omit"`.
3. Else use `adapterDefault`. If `"disabled"` or `"adaptive"`, return it. `"n/a"` falls back to `"omit"`.
4. Heuristic: if `model` matches `/minimax-m3/i` exactly, return `"disabled"`. Otherwise `"omit"`.

This means `MiniMax-M3` chat defaults to `thinking: { type: "disabled" }` even when the caller does not set a thinking mode, matching the documentation-batch expectation that thinking is disabled for deterministic output.

## Test helper

<!-- lw:anchors packages/core/src/llm/adapters.test.ts#fakeFetch -->

### `fakeFetch(response)`
Test utility returning a `vi.fn`-backed `typeof fetch`. Accepts `{ status?, body?, ok? }` and produces a `Response` with `Content-Type: application/json` and `body` serialized via `JSON.stringify` (or `"{}"` when undefined). `ok` defaults to `200..299` unless overridden.

Used across both `AnthropicAdapter` and `OpenAiCompatAdapter` describe blocks plus the `requestWithRetry` 429/500 retry tests.
