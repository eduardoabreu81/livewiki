---
title: llm
owner: generated
anchors:
  - packages/core/src/llm/adapters.test.ts#fakeFetch
  - packages/core/src/llm/anthropic.ts#AnthropicAdapter
  - packages/core/src/llm/anthropic.ts#AnthropicAdapter.constructor
  - packages/core/src/llm/anthropic.ts#AnthropicAdapter.generate
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
  - packages/core/src/llm/openai-compat.ts#resolveThinkingMode
---

## Public factory
<!-- lw:anchors packages/core/src/llm/index.ts#createLlmClient packages/core/src/llm/index.ts#MissingApiKeyError packages/core/src/llm/index.ts#MissingApiKeyError.constructor -->

`createLlmClient(repoRoot, config)` builds an `LlmClient` from a validated `LivewikiConfig`.

Resolution order:
1. Calls `validateConfigForBatch(repoRoot, config)` — fails with `MissingProviderConfigError` (from `config.ts`, not re-exported here) when `provider`/`preset` or `model` are absent. `timeoutMs` is validated here too.
2. `resolveProviderFromConfig(config)` returns an object with `adapter`, `envVar`, `baseUrl`, `thinkingDefault`, and `preferMaxCompletionTokens`. `baseUrl` falls back to `resolveBaseUrl(config)` when empty.
3. Reads `process.env[resolved.envVar]`. Missing key throws `MissingApiKeyError`.
4. Returns an `AnthropicAdapter` or `OpenAiCompatAdapter`, forwarding `timeoutMs` only when `config.timeoutMs !== undefined` so a configured `0` (disable abort) is preserved.

API keys are **only** read from the env var resolved above — never from `config.json`, `checkpoint_json`, logs, or error messages.

`MissingApiKeyError` carries the provider name and env var name. The message confirms keys must come from the env var, never from on-disk sources.

## Errors
<!-- lw:anchors packages/core/src/llm/index.ts#LlmRequestError packages/core/src/llm/index.ts#LlmRequestError.constructor packages/core/src/llm/base.ts#LlmTimeoutError packages/core/src/llm/base.ts#LlmTimeoutError.constructor packages/core/src/llm/base.ts#DEFAULT_LLM_TIMEOUT_MS -->

Two normalized error classes are thrown by adapters and `requestWithRetry`:

- `LlmRequestError(provider, status, errorBody)` — thrown on non-retryable HTTP statuses (anything except `429`/`5xx`) and after exhausting retries on retryable statuses. `errorBody` is truncated to 500 characters in the rendered message. The class never carries request headers, so the API key cannot leak through this path.
- `LlmTimeoutError(provider, timeoutMs)` — thrown when the per-attempt abort fires. The message states the client aborted and that the provider may still bill (usage is unknown). A `timeoutMs` of `0` produces a distinct message ("request aborted (timeout)") so callers can distinguish disabled timeouts from configured ones.

`DEFAULT_LLM_TIMEOUT_MS` is `300_000` (5 minutes) and is the fallback used by `requestWithRetry` when no explicit `timeoutMs` is configured.

## Shared HTTP layer
<!-- lw:anchors packages/core/src/llm/base.ts#requestWithRetry packages/core/src/llm/base.ts#withTimeoutMs packages/core/src/llm/base.ts#isRetryableStatus packages/core/src/llm/base.ts#sleep packages/core/src/llm/base.ts#readText -->

`requestWithRetry(provider, url, init, adapterConfig)` performs the HTTP call with retry semantics centralized in one place.

Behaviour:
- `fetchImpl` falls back to `globalThis.fetch`.
- `timeoutMs` falls back to `DEFAULT_LLM_TIMEOUT_MS`; `timeoutMs > 0` arms an `AbortController` timer.
- `maxRetries` defaults to `3`; only HTTP `429` and `5xx` are retried, via `isRetryableStatus`.
- `retryDelayMs` defaults to `1000` and applies exponential backoff: `retryDelayMs * 2^(attempt-1)`.
- A non-retryable response throws `LlmRequestError` after reading the body for diagnostics.
- An `AbortError` from the timer is rethrown as `LlmTimeoutError` — **no automatic retry** when the client aborts, because the provider's generation state is unknown.
- Network errors (non-`AbortError`, non-`LlmRequestError`) keep the existing retry path.
- After the final attempt, `requestWithRetry` throws `LlmRequestError(provider, 0, "Failed after N attempts (last status: X | last error: network | unknown)")`.

Helpers:
- `withTimeoutMs(timeoutMs)` returns `{ timeoutMs }` when the value is not `undefined`, otherwise an empty record. This preserves `0` (disable) through spread-init patterns that would otherwise treat it as falsy.
- `isRetryableStatus(status)` returns `true` for `429` or any `5xx`.
- `sleep(ms)` resolves after the timer fires.
- `readText(res)` returns `res.text()`.

## Anthropic adapter
<!-- lw:anchors packages/core/src/llm/anthropic.ts#AnthropicAdapter packages/core/src/llm/anthropic.ts#AnthropicAdapter.constructor packages/core/src/llm/anthropic.ts#AnthropicAdapter.generate -->

`AnthropicAdapter` implements `LlmClient` against the Anthropic Messages API.

Endpoint: `POST {baseUrl}/v1/messages` (trailing slash stripped from `baseUrl`).

Headers: `x-api-key`, `anthropic-version: 2023-06-01`, `content-type: application/json`.

Request body: `{ model, system, messages: [{ role: "user", content: user }], max_tokens }` plus optional `temperature`. `max_tokens` defaults to `4096` when `req.maxTokens` is absent.

Response handling: reads `content[0]`; returns an empty string when no text block is present. Usage is normalized: `input_tokens` → `inputTokens`, `output_tokens` → `outputTokens`.

Constructor options: `{ apiKey, baseUrl, model, fetchImpl?, timeoutMs?, maxRetries? }`. The adapter stores an `AdapterConfig` built with `withTimeoutMs(opts.timeoutMs)` so `0` is preserved. The `provider` field is hard-coded to `"anthropic"` and the `model` field is exposed publicly.

## OpenAI-compatible adapter
<!-- lw:anchors packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter.constructor packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter.generate packages/core/src/llm/openai-compat.ts#resolveThinkingMode -->

`OpenAiCompatAdapter` implements `LlmClient` against the OpenAI Chat Completions API surface used by OpenRouter, LiteLLM, Ollama cloud, and MiniMax chat.

URL construction: if `baseUrl` already ends in `/v1` (or `/v1/`), append `/chat/completions`; otherwise append `/v1/chat/completions`. Trailing slash on `baseUrl` is stripped. This avoids `https://proxy.example.com/v1/v1/chat/completions` when a proxy is fronting a partial path.

Token field selection: with `preferMaxCompletionTokens: true` (default `false`) and/or `req.preferMaxCompletionTokens: true`, the body uses `max_completion_tokens`; otherwise it uses `max_tokens`. Default value is `4096` when neither is provided.

Thinking mode: resolved via `resolveThinkingMode(req.thinking, this.thinkingDefault, this.model)`. A `"disabled"` result sets `thinking: { type: "disabled" }`; `"adaptive"` sets `thinking: { type: "adaptive" }`; otherwise the field is omitted. The MiniMax-M3 model heuristic forces `"disabled"` unless the request opts in (preventing the chat endpoint's default-on thinking from inflating batch tokens).

Headers: `authorization: Bearer <apiKey>`, `content-type: application/json`.

Response handling: reads `choices[0].message.content` (empty string when absent). Usage is normalized: `prompt_tokens` → `inputTokens`, `completion_tokens` → `outputTokens`, defaulting to `0` when the API omits the field. The response `model` is propagated into `usage.model`.

Constructor options include `thinkingDefault` (default `"omit"`) and `preferMaxCompletionTokens` (default `false`); both flow through to `AdapterConfig` along with `timeoutMs` and `maxRetries`.

## Tests
<!-- lw:anchors packages/core/src/llm/adapters.test.ts#fakeFetch -->

`fakeFetch({ status?, body?, ok? })` returns a `vi.fn` implementing `typeof fetch`. Defaults: `status = 200`, `ok` derived from the status when not provided, `body` JSON-stringified or `"{}"` when undefined, with a JSON content-type header. Used by suite tests that want a single stub for any status. Suite coverage (in `adapters.test.ts`) verifies:

- Anthropic: request shape, header set, usage normalization.
- Anthropic: non-retryable `4xx` (e.g. 401) throws `LlmRequestError` and performs exactly one fetch.
- OpenAI-compat: header set, `baseUrl` not double-prefixed with `/v1`, `max_tokens` vs `max_completion_tokens` selection, MiniMax-M3 `thinking` forcing, plain `gpt-4o` omission, usage normalization.
- `requestWithRetry` policy: default timeout when omitted, `timeoutMs: 0` does not arm an abort, single-call timeout resolution vs configured timeout (fake clock), `AbortError` produces exactly one call regardless of `maxRetries`, retry exhaustion on 429 and 503, successful retry after 429, end-to-end timeout prevents a second generation.