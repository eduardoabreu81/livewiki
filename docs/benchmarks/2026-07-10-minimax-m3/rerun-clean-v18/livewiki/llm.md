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

`fakeFetch` builds a `fetch`-shaped mock that returns a `Response` with a controlled status, body and `ok` flag. Tests in `adapters.test.ts` use it instead of hand-rolling a `vi.fn()` for every case — pass `{ status, body }` and you get a JSON response with `content-type: application/json`.

## Anthropic adapter
<!-- lw:anchors packages/core/src/llm/anthropic.ts#AnthropicAdapter packages/core/src/llm/anthropic.ts#AnthropicAdapter.constructor packages/core/src/llm/anthropic.ts#AnthropicAdapter.generate packages/core/src/llm/anthropic.ts#normalizeStopReason -->

`AnthropicAdapter` implements the shared `LlmClient` interface against Anthropic's Messages API. The constructor stores `apiKey`, `baseUrl`, `model` and builds an internal `AdapterConfig` (using `withTimeoutMs` so a configured `timeoutMs: 0` is preserved, and conditionally adding `fetchImpl` / `maxRetries` only when set). `provider` is the literal `"anthropic"`.

`generate(req)` POSTs to `<baseUrl>/v1/messages` with headers `x-api-key`, `anthropic-version: 2023-06-01` and `content-type: application/json`. The body sends `model`, `system`, a single `messages: [{ role: "user", content: req.user }]` entry, `max_tokens` (default 4096, or `req.maxTokens`) and an optional `temperature`. The HTTP call goes through `requestWithRetry`. The first `text` content block is returned; usage is remapped from `input_tokens` / `output_tokens` to `inputTokens` / `outputTokens`. `rawStopReason` is only echoed when the upstream `stop_reason` is non-null.

`normalizeStopReason` maps Anthropic's `stop_reason` to the shared `StopReason`: `max_tokens` → `length`, `end_turn` / `stop_sequence` → `complete`, `null` / `undefined` → `unknown`, anything else → `incomplete`.

## Shared HTTP base
<!-- lw:anchors packages/core/src/llm/base.ts#DEFAULT_LLM_TIMEOUT_MS packages/core/src/llm/base.ts#LlmTimeoutError packages/core/src/llm/base.ts#LlmTimeoutError.constructor packages/core/src/llm/base.ts#isRetryableStatus packages/core/src/llm/base.ts#withTimeoutMs packages/core/src/llm/base.ts#requestWithRetry packages/core/src/llm/base.ts#sleep packages/core/src/llm/base.ts#readText -->

`DEFAULT_LLM_TIMEOUT_MS` is `300_000` (5 minutes) and is applied whenever `AdapterConfig.timeoutMs` is `undefined`.

`LlmTimeoutError` extends `Error` and carries the `provider` and the `timeoutMs` that was in effect. Its message differs for `timeoutMs > 0` (announces the wall-clock limit and warns that the provider may still bill) versus `= 0` (plain "aborted"). `name` is `"LlmTimeoutError"`. The constructor signature takes `(provider: LlmProvider, timeoutMs: number)`.

`isRetryableStatus(status)` returns `true` only for `429` and the `5xx` band — 4xx other than 429 fails fast. `withTimeoutMs(timeoutMs)` is a tiny spread helper that returns `{ timeoutMs }` for any defined value (including `0`) and `{}` otherwise, so callers don't lose a deliberate `0`-disable with a truthy guard. `sleep(ms)` is the internal backoff primitive. `readText(res)` is a thin async wrapper around `res.text()` for callers that want a uniform import surface.

`requestWithRetry(provider, url, init, adapterConfig)` runs up to `adapterConfig.maxRetries ?? 3` attempts. Per attempt it builds an `AbortController` and only arms the timer when `timeoutMs > 0`; the timer is cleared in a `finally` so a successful response does not leak. On a successful response (`res.ok`) it returns immediately. On a non-retryable status it reads the body once and throws `LlmRequestError`. On a retryable status (`429` / `5xx`) it records `lastStatus`, drains the body, and backs off `retryDelayMs * 2^(attempt-1)` before the next try. Any `AbortError` is converted to `LlmTimeoutError` and re-thrown without retrying — generation state is unknown and the provider may already be billing. Plain network errors are still retried (with the same backoff) and recorded as `lastErrorKind = "network"`. After exhausting attempts, it throws `LlmRequestError` with `status: 0` and a `last status` / `last error` / `unknown` detail.

## Public factory and error types
<!-- lw:anchors packages/core/src/llm/index.ts#createLlmClient packages/core/src/llm/index.ts#MissingApiKeyError packages/core/src/llm/index.ts#MissingApiKeyError.constructor packages/core/src/llm/index.ts#LlmRequestError packages/core/src/llm/index.ts#LlmRequestError.constructor -->

`createLlmClient(repoRoot, config)` validates the config via `validateConfigForBatch`, resolves adapter / baseUrl / env var via `resolveProviderFromConfig`, falls back to `resolveBaseUrl` for `baseUrl`, then reads `process.env[resolved.envVar]` — throwing `MissingApiKeyError` if absent. `timeoutMs` is forwarded with an explicit `undefined` check so a configured `0` (disable) survives. For `anthropic` it instantiates `AnthropicAdapter`; for `openai-compat` it instantiates `OpenAiCompatAdapter` with `thinkingDefault` and `preferMaxCompletionTokens` taken from the resolved preset.

`MissingApiKeyError` extends `Error` and stores `provider` and `envVar`. The message names the provider and env var but never the key value, since the only thing it could leak is the name it already had to print.

`LlmRequestError` extends `Error` and stores `status`, `provider` and the raw `errorBody` (untruncated). The `Error.message` truncates `errorBody` at 500 chars with `...` to keep giant provider payloads out of logs; the full body remains on the `errorBody` property. Headers are never included — `key-leak.test.ts` covers that. The constructor signature is `(provider: LlmProvider, status: number, errorBody: string)`.

## OpenAI-compatible adapter
<!-- lw:anchors packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter.constructor packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter.generate packages/core/src/llm/openai-compat.ts#normalizeFinishReason packages/core/src/llm/openai-compat.ts#resolveThinkingMode -->

`OpenAiCompatAdapter` implements `LlmClient` for the OpenAI Chat Completions shape and is also the integration path for OpenRouter, LiteLLM, MiniMax chat and Ollama cloud. `provider` is the literal `"openai-compat"`. Constructor options extend `OpenAiCompatAdapterOpts` (`apiKey`, `baseUrl`, `model`, optional `fetchImpl` / `timeoutMs` / `maxRetries` / `retryDelayMs` / `thinkingDefault` / `preferMaxCompletionTokens`); defaults are `thinkingDefault: "omit"` and `preferMaxCompletionTokens: false`. The constructor spreads each optional through a guard helper so deliberate `0`s are never dropped.

`generate(req)` chooses the URL by trimming a trailing `/` and then appending `/chat/completions` — it adds `/v1` only when the trimmed base does not already end in `/v1` (or `/v1/`). The body always sets `model`, a two-message `system` + `user` array, an optional `temperature`, and exactly one of `max_tokens` / `max_completion_tokens` based on `req.preferMaxCompletionTokens ?? this.preferMaxCompletionTokens`. When `resolveThinkingMode(...)` returns `"disabled"` it adds `thinking: { type: "disabled" }`; for `"adaptive"` it adds `thinking: { type: "adaptive" }`; `"omit"` produces no `thinking` key. The HTTP call goes through `requestWithRetry`. The response maps `choices[0].message.content` to `content`, normalizes `usage.prompt_tokens` / `usage.completion_tokens` to `inputTokens` / `outputTokens` (defaulting to `0` when `usage` is absent), and echoes `rawStopReason` only when `finish_reason` is non-null.

`normalizeFinishReason(finishReason)` maps `"length"` → `"length"`, `"stop"` → `"complete"`, `null` / `undefined` → `"unknown"`, anything else → `"incomplete"`.

`resolveThinkingMode(requestThinking, adapterDefault, model)` returns the effective mode for one request. It first honors a non-`"omit"` request value, then propagates an explicit `"omit"`, then the adapter default (with `"n/a"` treated as `"omit"`), and only as a last resort applies the `MiniMax-M3` heuristic (the model's name matches `/MiniMax-M3/i`, including the bare model) which returns `"disabled"`. Anything else falls through to `"omit"`.