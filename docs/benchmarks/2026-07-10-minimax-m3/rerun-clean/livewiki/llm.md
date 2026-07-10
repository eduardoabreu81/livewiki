---
title: llm
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
---

# llm

Thin HTTP client for LLM providers used by the batch pipeline. Implements only two providers out of the box — Anthropic's Messages API and an OpenAI-compatible Chat Completions endpoint — behind a single `LlmClient` interface. No agent frameworks, no SDK dependencies: Node 20+'s global `fetch` and shared base retry/timeout logic.

## Public API

<!-- lw:anchors packages/core/src/llm/index.ts#createLlmClient packages/core/src/llm/index.ts#LlmRequestError packages/core/src/llm/index.ts#LlmRequestError.constructor packages/core/src/llm/index.ts#MissingApiKeyError packages/core/src/llm/index.ts#MissingApiKeyError.constructor -->

`createLlmClient(repoRoot, config)` is the only entry point used by the rest of the codebase. It runs `validateConfigForBatch` first, resolves the adapter/base URL/env var through `resolveProviderFromConfig`, then reads the API key from the named environment variable and instantiates the matching adapter. Provider resolution order: `config.preset` (preferred) → `config.provider` (legacy). If neither is set, the upstream validator throws `MissingProviderConfigError`. If the env var is unset, `createLlmClient` throws `MissingApiKeyError`.

Two error classes are exported alongside the factory:

- `MissingApiKeyError` — thrown when the configured env var (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or whatever the preset specifies) is absent. The message names the provider and env var but never references the value.
- `LlmRequestError` — thrown for HTTP and network failures. Carries `provider`, `status`, and `errorBody`. The body is truncated to 500 characters when included in the rendered message. Critically, request headers (which carry the API key) are never attached to this error.

## HTTP base utilities

<!-- lw:anchors packages/core/src/llm/base.ts#isRetryableStatus packages/core/src/llm/base.ts#readText packages/core/src/llm/base.ts#requestWithRetry packages/core/src/llm/base.ts#sleep -->

The `base.ts` module factors out everything provider-agnostic: timeout, retry, error wrapping.

- `requestWithRetry(provider, url, init, adapterConfig)` — runs the call up to `maxRetries` (default 3) times. Each attempt is bounded by `timeoutMs` (default 60_000) via an `AbortController`. Retryable statuses are `429` and `5xx` per `isRetryableStatus`; anything else throws `LlmRequestError` immediately with the response body. Between retries, the delay is `retryDelayMs * 2^(attempt-1)` (1000ms → 2000ms → 4000ms with defaults). Network and timeout failures are classified but the raw body is never propagated to the final error message — the surface only shows the last status, the last error category (`network` / `timeout`), or `unknown`.
- `isRetryableStatus(status)` — returns `true` for `429` and the 500–599 range.
- `sleep(ms)` — thin `setTimeout`-based wait used by the backoff loop.
- `readText(res)` — re-export-friendly helper that returns `res.text()`. (Currently consumed only inside this module.)
- `AdapterConfig` — the typed shape that both adapters pass into `requestWithRetry`. Always carries `apiKey`, `baseUrl`, `model`; optional fields default at the call site rather than the constructor.

## Anthropic adapter

<!-- lw:anchors packages/core/src/llm/anthropic.ts#AnthropicAdapter packages/core/src/llm/anthropic.ts#AnthropicAdapter.constructor packages/core/src/llm/anthropic.ts#AnthropicAdapter.generate -->

`AnthropicAdapter` targets Anthropic's Messages API. The constructor stashes credentials and a normalized `AdapterConfig`; it accepts an optional `fetchImpl` override (tests rely on it), plus optional `timeoutMs` and `maxRetries`. `generate` POSTs to `<baseUrl>/v1/messages` with headers `x-api-key`, `anthropic-version: 2023-06-01`, and `content-type: application/json`. The body includes `system`, a single user message, and `max_tokens` (default 4096, with optional `temperature`). Successful responses are normalized: `input_tokens` → `inputTokens`, `output_tokens` → `outputTokens`, the real `model` is reported in `usage.model`.

`provider` is the literal `"anthropic"` and surfaces in `LlmRequestError` messages and call-site logging.

## OpenAI-compatible adapter

<!-- lw:anchors packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter.constructor packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter.generate -->

`OpenAiCompatAdapter` wraps any endpoint speaking the OpenAI Chat Completions schema — OpenAI itself, OpenRouter, LiteLLM, Ollama cloud, etc. Constructor signature mirrors `AnthropicAdapter`. `generate` resolves the URL specially: if `baseUrl` already terminates in `/v1` (or `/v1/`), it appends `/chat/completions`; otherwise it appends `/v1/chat/completions`. Headers are `authorization: Bearer <key>` plus JSON content type. The body uses two messages (`system` then `user`) and `max_tokens` / `temperature` identical to the Anthropic path. Response normalization maps `prompt_tokens` → `inputTokens` and `completion_tokens` → `outputTokens`; missing usage fields default to `0` and the assistant content falls back to `""` if the `choices` array is empty.

`provider` is `"openai-compat"`.

## Test helpers

<!-- lw:anchors packages/core/src/llm/adapters.test.ts#fakeFetch -->

`fakeFetch(response)` is a vi.fn factory used to stand in for `globalThis.fetch` in the adapter and `requestWithRetry` test suites. It accepts a partial response descriptor (`status`, `body`, `ok`); defaults are `status 200`, `ok` derived from the status range, and `body "{}"`. The returned function resolves to a `Response` with JSON content-type so the adapter's `res.json()` path can be exercised without a network. Every test in `adapters.test.ts` either uses `fakeFetch` directly or builds an inline `vi.fn` returning a `Response` for cases that need to assert specific call shapes (URL, headers, body).