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

# llm

HTTP-thin LLM client surface for the livewiki core: provider adapters, the
shared retry/timeout transport, the public factory, and adapter tests. The
package uses native `fetch` (Node 20+) and ships two adapters — Anthropic
Messages and OpenAI Chat Completions–compatible — selected via a config
preset or legacy `provider` field.

## Test helpers
<!-- lw:anchors packages/core/src/llm/adapters.test.ts#fakeFetch -->

`fakeFetch` is the test-only fetch stub used by `adapters.test.ts`. It
returns a `vi.fn`-backed `typeof fetch` that resolves to a `Response` whose
status, body, and `ok` flag are controlled by the caller. The body, when
present, is JSON-stringified; a `content-type: application/json` header is
always attached.

## Public factory and errors
<!-- lw:anchors packages/core/src/llm/index.ts#createLlmClient packages/core/src/llm/index.ts#MissingApiKeyError packages/core/src/llm/index.ts#MissingApiKeyError.constructor packages/core/src/llm/index.ts#LlmRequestError packages/core/src/llm/index.ts#LlmRequestError.constructor -->

`createLlmClient(repoRoot, config)` is the entry point. It runs
`validateConfigForBatch` to guarantee `provider`/`preset` and `model` are
present, then resolves the adapter, base URL, and env var name through
`resolveProviderFromConfig` and `resolveBaseUrl`. The API key is read from
the resolved env var — never from `config.json`, checkpoint files, logs, or
error messages.

If the env var is missing the factory throws `MissingApiKeyError`, which
carries the provider name and env var name and explains that keys live only
in environment variables. When the provider returns an error response (or
the transport exhausts retries) the code path throws `LlmRequestError`,
which carries `provider`, `status`, and the (truncated to 500 chars)
`errorBody` — but never request headers.

## Anthropic adapter
<!-- lw:anchors packages/core/src/llm/anthropic.ts#AnthropicAdapter packages/core/src/llm/anthropic.ts#AnthropicAdapter.constructor packages/core/src/llm/anthropic.ts#AnthropicAdapter.generate packages/core/src/llm/anthropic.ts#normalizeStopReason -->

`AnthropicAdapter` implements `LlmClient` and targets `POST <baseUrl>/v1/messages`.
The constructor stores `apiKey`, `baseUrl`, `model`, and an optional
`fetchImpl`/`timeoutMs`/`maxRetries` into an internal `AdapterConfig`. It
uses `withTimeoutMs` so a configured `timeoutMs: 0` (disable) is preserved
instead of being dropped by a truthy spread.

`generate(req)` builds the request body with `model`, `system`, a single
`messages` entry, `max_tokens` defaulting to `4096`, and an optional
`temperature`. Headers are `x-api-key`, `anthropic-version: 2023-06-01`,
and `content-type: application/json`. After the retry transport returns a
response, the adapter reads `content[0].text`, maps
`usage.input_tokens`/`output_tokens` to `inputTokens`/`outputTokens`,
captures the echoed `model`, and delegates `stop_reason` to
`normalizeStopReason`.

`normalizeStopReason` maps Anthropic values: `max_tokens` → `length`,
`end_turn` / `stop_sequence` → `complete`, `tool_use` and other strings
→ `incomplete`, and `null`/`undefined` → `unknown`.

## OpenAI-compatible adapter
<!-- lw:anchors packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter.constructor packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter.generate packages/core/src/llm/openai-compat.ts#normalizeFinishReason packages/core/src/llm/openai-compat.ts#resolveThinkingMode -->

`OpenAiCompatAdapter` covers OpenAI, OpenRouter, LiteLLM, MiniMax chat,
and Ollama cloud — anything that speaks `POST /v1/chat/completions` (or
sits behind a `baseUrl` already ending in `/v1`). The constructor accepts
the standard adapter options plus `thinkingDefault` (`"omit"` | `"disabled"`
| `"adaptive"` | `"n/a"`) and `preferMaxCompletionTokens`; it preserves
`timeoutMs: 0` through `withTimeoutMs` like the Anthropic adapter.

`generate(req)` assembles a chat-completions body with system + user
messages, picks `max_completion_tokens` vs `max_tokens` based on
`preferMaxCompletionTokens`, and resolves thinking mode via
`resolveThinkingMode`. Headers are `authorization: Bearer <redacted> and
`content-type: application/json`. The response is normalized: `choices[0].message.content`
becomes `content`, `usage.prompt_tokens`/`completion_tokens` map to
`inputTokens`/`outputTokens`, and `choices[0].finish_reason` is normalized.

`normalizeFinishReason` maps `length` → `length`, `stop` → `complete`,
`tool_calls` and other strings → `incomplete`, and `null`/`undefined`
→ `unknown`. `resolveThinkingMode` honors an explicit request value when
it isn't `"omit"`, falls back to `adapterDefault` (`"n/a"` is treated as
`"omit"`), and applies the `MiniMax-M3` heuristic — if the model name
matches `minimax-m3`, thinking is forced to `"disabled"` for
documentation-batch safety unless the caller opts in.

## Shared HTTP transport
<!-- lw:anchors packages/core/src/llm/base.ts#DEFAULT_LLM_TIMEOUT_MS packages/core/src/llm/base.ts#LlmTimeoutError packages/core/src/llm/base.ts#LlmTimeoutError.constructor packages/core/src/llm/base.ts#isRetryableStatus packages/core/src/llm/base.ts#readText packages/core/src/llm/base.ts#requestWithRetry packages/core/src/llm/base.ts#sleep packages/core/src/llm/base.ts#withTimeoutMs -->

`base.ts` centralizes the fetch wrapper, retry policy, timeout handling,
and normalized error types. `DEFAULT_LLM_TIMEOUT_MS` is `300_000`
(5 minutes); this is the per-attempt budget applied when `timeoutMs` is
omitted. `LlmTimeoutError` is thrown when the client aborts — its
constructor records `provider` and `timeoutMs` and uses a message that
warns the provider may still complete and bill, so usage is unknown.

`isRetryableStatus` returns `true` for `429` and any `5xx` status. Non-
retryable HTTP statuses throw `LlmRequestError` once with the body for
diagnostics. `withTimeoutMs` is a small spread helper that includes
`{ timeoutMs }` only when defined, so `0` is preserved (a truthy spread
would drop it). `readText` is a thin pass-through to `Response.text()`,
and `sleep` resolves after `ms` via `setTimeout`.

`requestWithRetry` runs up to `maxRetries` (default `3`) attempts. For
each attempt it constructs an `AbortController` and arms a `setTimeout`
that calls `abort()` only when `timeoutMs > 0`. Successful responses
short-circuit; retryable HTTP statuses sleep for
`retryDelayMs * 2^(attempt - 1)` (default base `1000`) between tries. An
`AbortError` is converted to `LlmTimeoutError` and never retried —
generation state is unknown after an abort. Network errors keep the
existing retry behavior. After exhausting retries the function throws
`LlmRequestError` with `status: 0` and a detail string describing the
last observed status or error kind.