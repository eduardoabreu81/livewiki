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

## Test helper
<!-- lw:anchors packages/core/src/llm/adapters.test.ts#fakeFetch -->

`fakeFetch` returns a `vi.fn`-backed `fetch` implementation that resolves to a synthetic `Response` built from `{ status?, body?, ok? }`. It serializes `body` to JSON and sets `content-type: application/json`, and is used across the adapter specs to exercise both `AnthropicAdapter` and `OpenAiCompatAdapter` without a network.

## Anthropic adapter
<!-- lw:anchors packages/core/src/llm/anthropic.ts#AnthropicAdapter packages/core/src/llm/anthropic.ts#AnthropicAdapter.constructor packages/core/src/llm/anthropic.ts#AnthropicAdapter.generate packages/core/src/llm/anthropic.ts#normalizeStopReason -->

`AnthropicAdapter` is an `LlmClient` implementation that targets the Anthropic Messages endpoint at `POST <baseUrl>/v1/messages`. The constructor accepts an opts bag (`apiKey`, `baseUrl`, `model`, plus optional `fetchImpl`, `timeoutMs`, `maxRetries`) and stores a normalized `AdapterConfig`. It uses `withTimeoutMs` so that an explicit `timeoutMs: 0` survives the spread into the config.

`generate` builds a body containing `model`, `system`, a single `user` message, `max_tokens` (default `4096`), and an optional `temperature`. It sets headers `x-api-key`, `anthropic-version: 2023-06-01`, and `content-type: application/json`, then delegates to `requestWithRetry`. The response is normalized: `usage.input_tokens` → `inputTokens`, `usage.output_tokens` → `outputTokens`, and `stop_reason` is mapped through `normalizeStopReason`. When `stop_reason` is non-null, the original value is also preserved as `rawStopReason`.

`normalizeStopReason` maps Anthropic stop reasons to the shared `StopReason` union: `"max_tokens"` → `"length"`, `"end_turn"` or `"stop_sequence"` → `"complete"`, `null`/`undefined` → `"unknown"`, and any other non-null value → `"incomplete"`.

## Shared HTTP plumbing
<!-- lw:anchors packages/core/src/llm/base.ts#DEFAULT_LLM_TIMEOUT_MS packages/core/src/llm/base.ts#requestWithRetry packages/core/src/llm/base.ts#withTimeoutMs packages/core/src/llm/base.ts#isRetryableStatus packages/core/src/llm/base.ts#sleep packages/core/src/llm/base.ts#readText packages/core/src/llm/base.ts#LlmTimeoutError packages/core/src/llm/base.ts#LlmTimeoutError.constructor -->

`DEFAULT_LLM_TIMEOUT_MS` is `300_000` (5 minutes), used by `requestWithRetry` whenever the adapter config does not specify a per-attempt timeout.

`requestWithRetry` is the shared retry/timeout driver for all adapters. It iterates up to `maxRetries` (default `3`), arms an `AbortController` only when `timeoutMs > 0`, and runs the configured `fetchImpl` (falling back to `globalThis.fetch`). Successful responses are returned as-is. Non-retryable HTTP statuses immediately throw `LlmRequestError` with the response body for diagnostics. Retryable statuses (`429` and `5xx`, per `isRetryableStatus`) and network errors schedule an exponential backoff using `retryDelayMs` (default `1000`) until `maxRetries` is exhausted, at which point a synthetic `LlmRequestError` is raised carrying the last status or "network" error kind. An `AbortError` is converted into `LlmTimeoutError` and is **not** retried — generation state is unknown and the provider may still bill.

`withTimeoutMs` is the spread helper that preserves a user-provided `timeoutMs` even when the value is `0`, returning `{ timeoutMs }` only when defined.

`isRetryableStatus` is the local predicate: `status === 429 || (status >= 500 && status < 600)`.

`sleep` is a thin `setTimeout`-based promise helper used for retry backoff. `readText` is a one-line `res.text()` re-export.

`LlmTimeoutError` extends `Error` and carries `provider` and `timeoutMs`. The constructor formats a message distinguishing a positive timeout ("request timed out after Nms; client abort; provider may still bill; usage unknown") from a zero/aborted case ("request aborted (timeout)"). It is intentionally **not** a retry trigger inside `requestWithRetry`.

## Public LLM surface
<!-- lw:anchors packages/core/src/llm/index.ts#createLlmClient packages/core/src/llm/index.ts#MissingApiKeyError packages/core/src/llm/index.ts#MissingApiKeyError.constructor packages/core/src/llm/index.ts#LlmRequestError packages/core/src/llm/index.ts#LlmRequestError.constructor -->

`createLlmClient` is the factory that builds an `LlmClient` from a `LivewikiConfig`. It calls `validateConfigForBatch` to enforce provider/model presence, then `resolveProviderFromConfig` to derive the adapter, base URL, and env var name (preset wins over legacy `config.provider`). The API key is read from `process.env[resolved.envVar]` — never from config files, checkpoints, logs, or error bodies — and a missing key throws `MissingApiKeyError`. `timeoutMs` from the config is forwarded only when defined (so `0` still disables the abort). For `anthropic` it constructs `AnthropicAdapter`; for the OpenAI-compatible path it constructs `OpenAiCompatAdapter` and forwards `thinkingDefault` and `preferMaxCompletionTokens` from the resolved preset.

`MissingApiKeyError` extends `Error` with `provider` and `envVar` fields. Its message explicitly states that keys never live in `config.json`, checkpoint JSON, logs, or error messages, so the absence cannot leak a value.

`LlmRequestError` extends `Error` with `provider`, `status`, and `errorBody`. The constructor truncates `errorBody` at 500 characters before composing the message and explicitly never includes request headers (which would carry the API key).

## OpenAI-compatible adapter
<!-- lw:anchors packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter.constructor packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter.generate packages/core/src/llm/openai-compat.ts#normalizeFinishReason packages/core/src/llm/openai-compat.ts#resolveThinkingMode -->

`OpenAiCompatAdapter` targets the OpenAI Chat Completions shape at `POST <baseUrl>[/v1]/chat/completions`. The constructor stores `apiKey`, `baseUrl`, `model`, the thinking default (`"omit"` when unspecified), `preferMaxCompletionTokens` (default `false`), and builds an `AdapterConfig` that again uses `withTimeoutMs` to keep a `0` value intact.

`generate` computes the URL by stripping a trailing slash and reusing a present `/v1` suffix, building a body with `model`, a `system` + `user` message pair, and an optional `temperature`. It picks `max_completion_tokens` when the per-request or adapter-level `preferMaxCompletionTokens` is set, otherwise `max_tokens`. The effective thinking mode comes from `resolveThinkingMode`; `"disabled"` and `"adaptive"` produce the matching `thinking: { type: ... }` block, otherwise the field is omitted. Headers carry `authorization: Bearer <redacted> and `content-type: application/json`. The response is normalized the same way as the Anthropic adapter: `prompt_tokens` → `inputTokens`, `completion_tokens` → `outputTokens`, `finish_reason` mapped through `normalizeFinishReason`, and the raw finish reason preserved as `rawStopReason` when non-null.

`normalizeFinishReason` maps `"length"` → `"length"`, `"stop"` → `"complete"`, `null`/`undefined` → `"unknown"`, and any other non-null value → `"incomplete"`.

`resolveThinkingMode` selects the effective thinking strategy: an explicit request value (other than `"omit"`) wins; an explicit `"omit"` is honored; otherwise the adapter default applies. For `"n/a"` adapters a model-name heuristic forces `"disabled"` for `minimax-m3`/`MiniMax-M3` (MiniMax chat enables thinking by default otherwise), and `"omit"` is returned for any other model.