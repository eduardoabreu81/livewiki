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

# llm

Thin HTTP client layer for LLM providers. Uses native `fetch` (Node 20+), normalizes request/response shapes, and centralizes timeout/retry/error handling. Exposes an `LlmClient` interface consumed by `batch.ts`.

## Test helpers

<!-- lw:anchors packages/core/src/llm/adapters.test.ts#fakeFetch -->

`fakeFetch({ status, body, ok })` returns a `vi.fn` that resolves to a `Response` with the configured status and JSON body. Defaults: `status = 200`, `ok = status in 200..299`, body text `{}` when `body` is `undefined`. Used across `AnthropicAdapter`, `OpenAiCompatAdapter`, and `requestWithRetry` test suites.

## Public entry point

<!-- lw:anchors packages/core/src/llm/index.ts#createLlmClient -->

`createLlmClient(repoRoot, config)` validates config (delegates to `validateConfigForBatch`), resolves provider via preset or legacy `config.provider`, picks the right env var for the API key (e.g. `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `MiniMax_API_KEY`), and instantiates the matching adapter. Passes `timeoutMs` only when explicitly set in config so that `timeoutMs: 0` (disable) survives into the adapter.

Throw chain when configuration is incomplete:
- Missing provider/preset or model — `validateConfigForBatch` → `MissingProviderConfigError`.
- Missing API key in env — `MissingApiKeyError` (carries `provider` + `envVar` name; message never includes the key value).

## Anthropic adapter

<!-- lw:anchors packages/core/src/llm/anthropic.ts#AnthropicAdapter packages/core/src/llm/anthropic.ts#AnthropicAdapter.constructor packages/core/src/llm/anthropic.ts#AnthropicAdapter.generate -->

`AnthropicAdapter implements LlmClient`, reports `provider = "anthropic"`.

Constructor accepts `{ apiKey, baseUrl, model, fetchImpl?, timeoutMs?, maxRetries? }` and stores `apiKey` / `baseUrl` / `model` plus a normalized `AdapterConfig`. `timeoutMs` is preserved (including `0`) via `withTimeoutMs`.

`generate(req)` POSTs to `${baseUrl}/v1/messages` with headers `x-api-key`, `anthropic-version: 2023-06-01`, and `content-type: application/json`. Request body sets `model`, `system`, `messages: [{ role: "user", content: req.user }]`, `max_tokens` defaulting to `4096`, and `temperature` only when supplied. The Anthropic response is read as JSON; the first `content[].text` becomes the result `content`, and usage is renamed `input_tokens → inputTokens`, `output_tokens → outputTokens`.

## OpenAI-compatible adapter

<!-- lw:anchors packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter.constructor packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter.generate packages/core/src/llm/openai-compat.ts#resolveThinkingMode -->

`OpenAiCompatAdapter implements LlmClient`, reports `provider = "openai-compat"`. Covers OpenAI, OpenRouter, LiteLLM, MiniMax chat, Ollama cloud, and other OpenAI Chat Completions–compatible APIs.

Constructor accepts `{ apiKey, baseUrl, model, fetchImpl?, timeoutMs?, maxRetries?, retryDelayMs?, thinkingDefault?, preferMaxCompletionTokens? }`. Defaults: `thinkingDefault = "omit"`, `preferMaxCompletionTokens = false`.

`generate(req)` picks the URL by stripping a trailing slash and appending `/v1/chat/completions` only when `baseUrl` does **not** already end in `/v1` (so a `baseUrl` of `https://proxy.example.com/v1` is not duplicated). Token field choice respects `req.preferMaxCompletionTokens` falling back to the adapter default; it sets either `max_completion_tokens` or `max_tokens`, defaulting to `4096`. Headers: `authorization: Bearer <apiKey>` and `content-type: application/json`. Response is parsed; usage is renamed `prompt_tokens → inputTokens`, `completion_tokens → outputTokens`.

`resolveThinkingMode(requestThinking, adapterDefault, model)` returns the effective thinking mode:
- Explicit non-`omit` request → that value wins.
- Request `omit` (or absent) → falls through to `adapterDefault`; `"n/a"` is treated as `"omit"`.
- Heuristic: when no preset is in play and the model matches `/minimax-m3/i`, the default becomes `disabled` because the MiniMax-M3 chat API enables thinking when the field is omitted.

## Shared adapter foundation

<!-- lw:anchors packages/core/src/llm/base.ts#DEFAULT_LLM_TIMEOUT_MS packages/core/src/llm/base.ts#isRetryableStatus packages/core/src/llm/base.ts#requestWithRetry packages/core/src/llm/base.ts#sleep packages/core/src/llm/base.ts#readText packages/core/src/llm/base.ts#withTimeoutMs -->

`DEFAULT_LLM_TIMEOUT_MS = 300_000` (5 minutes) is the per-attempt timeout when `AdapterConfig.timeoutMs` is `undefined`.

`AdapterConfig` carries `apiKey`, `baseUrl`, `model`, optional `fetchImpl`, `timeoutMs`, `maxRetries` (default 3), and `retryDelayMs` (default 1000). `timeoutMs: 0` disables the abort timer entirely (intended for local providers).

`withTimeoutMs(timeoutMs)` is a spread helper that survives the `0` case (truthy spreads would drop it). Returns `{ timeoutMs }` when set, or `{}` when `undefined`.

`isRetryableStatus(status)` returns `true` only for `429` or `5xx`. Everything else (including `4xx` other than `429`) is treated as a hard failure.

`requestWithRetry(provider, url, init, adapterConfig)` runs up to `maxRetries` attempts:
- Resolves `fetchImpl` (`adapterConfig.fetchImpl ?? globalThis.fetch`), resolves `timeoutMs` from config or `DEFAULT_LLM_TIMEOUT_MS`, resolves `maxRetries` (default 3) and `retryDelayMs` (default 1000).
- Arms an `AbortController` only when `timeoutMs > 0`; otherwise no abort timer.
- `res.ok` → return.
- Non-retryable HTTP status → read body for diagnostics, throw `LlmRequestError` once (no retry).
- Retryable status or network error → record state, back off `retryDelayMs * 2^(attempt-1)` while `attempt < maxRetries`.
- `AbortError` (timer fired or caller aborted) → throw `LlmTimeoutError` immediately, **no retry** because provider state is unknown and billing may still occur.
- After exhausting retries, throws `LlmRequestError(provider, 0, "Failed after N attempts (last status: … | last error: network | unknown)")`.

`sleep(ms)` returns a promise that resolves after `setTimeout`. Used between retry attempts.

`readText(res)` is a thin `res.text()` wrapper exported for reuse.

## Error types

<!-- lw:anchors packages/core/src/llm/base.ts#LlmTimeoutError packages/core/src/llm/base.ts#LlmTimeoutError.constructor packages/core/src/llm/index.ts#LlmRequestError packages/core/src/llm/index.ts#LlmRequestError.constructor packages/core/src/llm/index.ts#MissingApiKeyError packages/core/src/llm/index.ts#MissingApiKeyError.constructor -->

`LlmTimeoutError` extends `Error`, carries `provider: LlmProvider` and `timeoutMs: number`. Message format: `timeoutMs > 0` → `"LLM <provider> request timed out after <timeoutMs>ms (client abort; provider may still bill; usage unknown)"`; `timeoutMs === 0` → `"LLM <provider> request aborted (timeout)"`. `name = "LlmTimeoutError"`. Thrown only from `requestWithRetry`; never triggers another attempt.

`MissingApiKeyError` extends `Error`, carries `provider: LlmProvider` and `envVar: string`. Message documents that the key must come from the env var and never from config/checkpoint/log files. Thrown from `createLlmClient` when `process.env[envVar]` is empty.

`LlmRequestError` extends `Error`, carries `status: number`, `provider: LlmProvider`, `errorBody: string`. Body truncated to 500 chars in the message; full body retained on the field. Thrown by `requestWithRetry` for non-retryable HTTP responses and for retry exhaustion.