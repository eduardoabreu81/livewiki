---
title: llm
owner: generated
anchors:
  - packages/core/src/llm/adapters.test.ts#fakeFetch
  - packages/core/src/llm/base.ts#DEFAULT_LLM_TIMEOUT_MS
  - packages/core/src/llm/base.ts#isRetryableStatus
  - packages/core/src/llm/base.ts#withTimeoutMs
  - packages/core/src/llm/base.ts#sleep
  - packages/core/src/llm/base.ts#readText
  - packages/core/src/llm/base.ts#requestWithRetry
  - packages/core/src/llm/base.ts#LlmTimeoutError
  - packages/core/src/llm/base.ts#LlmTimeoutError.constructor
  - packages/core/src/llm/index.ts#createLlmClient
  - packages/core/src/llm/index.ts#MissingApiKeyError
  - packages/core/src/llm/index.ts#MissingApiKeyError.constructor
  - packages/core/src/llm/index.ts#LlmRequestError
  - packages/core/src/llm/index.ts#LlmRequestError.constructor
  - packages/core/src/llm/anthropic.ts#AnthropicAdapter
  - packages/core/src/llm/anthropic.ts#AnthropicAdapter.constructor
  - packages/core/src/llm/anthropic.ts#AnthropicAdapter.generate
  - packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter
  - packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter.constructor
  - packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter.generate
  - packages/core/src/llm/openai-compat.ts#resolveThinkingMode
---

## Shared HTTP layer and timeout/retry policy

<!-- lw:anchors packages/core/src/llm/base.ts#DEFAULT_LLM_TIMEOUT_MS packages/core/src/llm/base.ts#withTimeoutMs packages/core/src/llm/base.ts#isRetryableStatus packages/core/src/llm/base.ts#sleep packages/core/src/llm/base.ts#readText packages/core/src/llm/base.ts#requestWithRetry packages/core/src/llm/base.ts#LlmTimeoutError packages/core/src/llm/base.ts#LlmTimeoutError.constructor -->

`packages/core/src/llm/base.ts` centralizes the HTTP behavior shared by every provider adapter: a fetch wrapper, an explicit retry policy for HTTP-retryable statuses, normalized error classes, and the timeout helpers.

`DEFAULT_LLM_TIMEOUT_MS` is the default per-attempt timeout applied when a config omits `timeoutMs` (5 minutes, `300_000` ms).

`withTimeoutMs` is a spread helper designed to preserve `timeoutMs: 0` (disable) — a truthy check would drop it, so it conditionally returns `{ timeoutMs }` only when defined. Callers use it inside adapter option spreads.

`isRetryableStatus` returns true for HTTP `429` and any `5xx` status. Other failure modes (network errors, aborts) are handled separately.

`sleep` resolves after `ms` milliseconds using `setTimeout`. Used to back off between retries.

`readText` returns `res.text()`. Convenience wrapper for consistent response consumption in tests and helpers.

`requestWithRetry` performs the request loop:

- Resolves `fetchImpl`, `timeoutMs` (defaulting to `DEFAULT_LLM_TIMEOUT_MS`), `maxRetries` (default `3`), and `retryDelayMs` (default `1000`).
- Arms an `AbortController` only when `timeoutMs > 0` (`timeoutMs = 0` disables the timer entirely).
- On success returns the `Response` immediately.
- On non-retryable HTTP status, throws `LlmRequestError` with the body (truncated upstream) and does not retry.
- On `429` / `5xx`, records `lastStatus` and waits `retryDelayMs * 2^(attempt-1)` between attempts.
- On `AbortError` translates to `LlmTimeoutError` and does **not** retry (generation state is unknown; the provider may still complete and bill).
- On plain network errors, retries with the same exponential backoff.
- After exhausting attempts throws `LlmRequestError(provider, 0, …)` with the last recorded status or `network` tag.

`LlmTimeoutError` extends `Error` and reports the `provider` and the configured `timeoutMs`. The message differs when `timeoutMs > 0` (concrete timeout message) versus `0` (aborted without a timer).

`LlmTimeoutError.constructor` sets `name = "LlmTimeoutError"` and assigns `provider` / `timeoutMs`. The message is built so it never leaks the API key or any header value.

## Client factory, errors, and the public surface

<!-- lw:anchors packages/core/src/llm/index.ts#createLlmClient packages/core/src/llm/index.ts#MissingApiKeyError packages/core/src/llm/index.ts#MissingApiKeyError.constructor packages/core/src/llm/index.ts#LlmRequestError packages/core/src/llm/index.ts#LlmRequestError.constructor packages/core/src/llm/anthropic.ts#AnthropicAdapter packages/core/src/llm/anthropic.ts#AnthropicAdapter.constructor packages/core/src/llm/anthropic.ts#AnthropicAdapter.generate packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter.constructor packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter.generate packages/core/src/llm/openai-compat.ts#resolveThinkingMode packages/core/src/llm/adapters.test.ts#fakeFetch -->

`packages/core/src/llm/index.ts` exposes the `LlmClient` interface plus the factory and error classes. It re-exports `LlmTimeoutError` and `DEFAULT_LLM_TIMEOUT_MS` from `base.ts`.

`createLlmClient` builds the right adapter from a validated `LivewikiConfig`:

1. Calls `validateConfigForBatch` to guarantee provider / preset and `model` are set.
2. Resolves the provider metadata via `resolveProviderFromConfig` (preset first, then legacy provider, with `MissingProviderConfigError` if neither is set).
3. Picks `baseUrl` from the resolved value or falls back to `resolveBaseUrl`.
4. Reads the API key **only** from `process.env[resolved.envVar]`. Missing key → `MissingApiKeyError`.
5. Builds per-attempt `timeoutMs` opts while preserving `timeoutMs: 0` (explicit `undefined` check).
6. Constructs `AnthropicAdapter` or `OpenAiCompatAdapter`, forwarding preset-derived `thinkingDefault` / `preferMaxCompletionTokens` to the OpenAI-compat adapter.

`MissingApiKeyError` extends `Error`. Its message names the provider and the env var to set, and explicitly states that keys never live in `config.json`, checkpoint files, logs, or error messages.

`MissingApiKeyError.constructor` sets `name`, `provider`, and `envVar` — never includes the (absent) key value.

`LlmRequestError` extends `Error` and reports the provider, HTTP status, and a truncated error body. Bodies longer than 500 characters are sliced to keep error messages bounded.

`LlmRequestError.constructor` truncates `errorBody` (500 char cap + `…`), assigns `status`, `provider`, `errorBody`, and sets `name = "LlmRequestError"`. Used both by `requestWithRetry` (per-call failures and exhausted attempts) and surfaced by the adapters.

### AnthropicAdapter

`AnthropicAdapter` implements `LlmClient` for the Anthropic Messages API.

`AnthropicAdapter.constructor` stores `apiKey`, `baseUrl`, `model`, and builds an `AdapterConfig` using `withTimeoutMs` to preserve `timeoutMs: 0`. Optional `maxRetries` is only set when explicitly passed.

`AnthropicAdapter.generate` POSTs to `<baseUrl>/v1/messages` with headers `x-api-key`, `anthropic-version: 2023-06-01`, and `content-type: application/json`. The body wraps system + user into Anthropic's `messages` shape with `max_tokens` (default `4096`). The response is normalized: snake-case `input_tokens` / `output_tokens` become camel-case `inputTokens` / `outputTokens`, and the first text block is returned as `content`.

### OpenAiCompatAdapter

`OpenAiCompatAdapter` implements `LlmClient` for any OpenAI Chat Completions–compatible endpoint (OpenAI, OpenRouter, LiteLLM, MiniMax chat, Ollama cloud, etc.).

`OpenAiCompatAdapter.constructor` stores `apiKey`, `baseUrl`, `model`, `thinkingDefault` (default `"omit"`), `preferMaxCompletionTokens` (default `false`), and an `AdapterConfig` that preserves `timeoutMs: 0` via `withTimeoutMs`.

`OpenAiCompatAdapter.generate` resolves the URL by detecting whether `baseUrl` already ends with `/v1`; either way it targets `<base>/chat/completions`. It picks `max_completion_tokens` vs `max_tokens` based on `preferMaxCompletionTokens`, sends `system` + `user` as a two-message array, and attaches a `thinking` payload only when the resolved mode is `disabled` or `adaptive`. Usage is normalized: `prompt_tokens` / `completion_tokens` become `inputTokens` / `outputTokens` (with `0` defaults if absent).

`resolveThinkingMode` decides the effective thinking mode:

- A non-`"omit"` request value wins.
- Explicit `"omit"` from the request returns `"omit"`.
- An `adapterDefault` of `"disabled"` / `"adaptive"` is used as-is.
- A model-name heuristic matches `minimax-m3` (case-insensitive) and forces `"disabled"`.
- Otherwise returns `"omit"`.

### Test helper

`fakeFetch` (in `packages/core/src/llm/adapters.test.ts`) returns a `vi.fn`-backed function that builds a `Response` with the given `status`, `body` (JSON-stringified), and a JSON content-type header. `ok` defaults to whether the status is `2xx`. Used to keep adapter tests deterministic without touching `globalThis.fetch`.