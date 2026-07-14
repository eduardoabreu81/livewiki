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

Thin HTTP client layer for LLM providers. Uses native Node 20+ `fetch`, no SDK
dependencies, and exposes a normalized `LlmClient` interface for the batch
runtime. Two adapter implementations are shipped: one for the Anthropic Messages
API and one for the OpenAI Chat Completions–compatible shape (covering
OpenRouter, LiteLLM, Ollama, and the MiniMax-M3 chat endpoint).

API keys are read from environment variables only — never from
`config.json`, checkpoints, logs, or error messages.

## Test helpers

<!-- lw:anchors packages/core/src/llm/adapters.test.ts#fakeFetch -->

`fakeFetch(response)` builds a `vi.fn` that mimics `fetch` and returns a `Response`
with the supplied `status`, `body`, and `ok` values. The body is JSON-stringified
when provided, and defaults to `"{}"` with status 200. The function returns the
fake cast as `typeof fetch` so it can be passed directly to an adapter's
`fetchImpl` slot.

## Anthropic adapter

<!-- lw:anchors packages/core/src/llm/anthropic.ts#AnthropicAdapter packages/core/src/llm/anthropic.ts#AnthropicAdapter.constructor packages/core/src/llm/anthropic.ts#AnthropicAdapter.generate packages/core/src/llm/anthropic.ts#normalizeStopReason -->

`AnthropicAdapter` is an `LlmClient` bound to the Anthropic Messages endpoint.
It POSTs to `<baseUrl>/v1/messages` after stripping any trailing slash, sets
`x-api-key`, `anthropic-version: 2023-06-01`, and `content-type: application/json`,
and submits a body of shape `{ model, system, messages: [{role:"user", content}],
max_tokens, temperature? }`. Successful responses are mapped to a
`GenerateResult` whose `usage` carries `inputTokens`, `outputTokens`, and the
model echoed by the provider.

The constructor accepts an options bag with `apiKey`, `baseUrl`, `model`, an
optional `fetchImpl` override, and optional `timeoutMs` / `maxRetries` values
that are folded into a shared `AdapterConfig`. `timeoutMs: 0` is preserved
verbatim via `withTimeoutMs` so callers can disable the abort timer.

`generate(req)` calls `requestWithRetry`, parses the JSON body, and returns the
first text block plus usage. The raw `stop_reason` from the provider is attached
to the result as `rawStopReason` when present.

`normalizeStopReason(raw)` maps Anthropic's stop reasons to the shared `StopReason`
union: `"max_tokens"` → `"length"`, `"end_turn"` / `"stop_sequence"` →
`"complete"`, `null` / `undefined` → `"unknown"`, anything else (including
`"tool_use"`) → `"incomplete"`.

## Shared HTTP and retry layer

<!-- lw:anchors packages/core/src/llm/base.ts#DEFAULT_LLM_TIMEOUT_MS packages/core/src/llm/base.ts#LlmTimeoutError packages/core/src/llm/base.ts#LlmTimeoutError.constructor packages/core/src/llm/base.ts#isRetryableStatus packages/core/src/llm/base.ts#readText packages/core/src/llm/base.ts#requestWithRetry packages/core/src/llm/base.ts#sleep packages/core/src/llm/base.ts#withTimeoutMs -->

`DEFAULT_LLM_TIMEOUT_MS` is the per-attempt ceiling applied when `timeoutMs`
is left unset (300 000 ms, i.e. 5 minutes).

`LlmTimeoutError` is thrown when a client-side abort fires. Its constructor
records `provider` and `timeoutMs`, sets `name = "LlmTimeoutError"`, and
formats a message that distinguishes between an explicit positive timeout and a
`timeoutMs: 0` abort. A timeout never triggers an automatic retry — generation
state is unknown after abort and the provider may still bill the request.

`isRetryableStatus(status)` returns `true` only for `429` and the `5xx` band;
every other non-`ok` response is treated as terminal.

`withTimeoutMs(value)` is a spread helper that includes `timeoutMs` even when
the caller passes `0`. A truthy spread would drop the disable signal; this
helper returns `{ timeoutMs: 0 }` for `0`, `{ timeoutMs: n }` for positive
numbers, and `{}` for `undefined`.

`requestWithRetry(provider, url, init, adapterConfig)` is the core HTTP loop:
- Resolves `fetchImpl` (override or `globalThis.fetch`), `timeoutMs` (override or
  `DEFAULT_LLM_TIMEOUT_MS`), `maxRetries` (default 3), `retryDelayMs` (default
  1000, exponential backoff).
- Arms an `AbortController` only when `timeoutMs > 0`; with `timeoutMs: 0` no
  timer is set, leaving the caller (or the underlying server) in control.
- On `res.ok` returns the response immediately.
- On a non-retryable status, reads the body and throws `LlmRequestError`
  immediately — no retry.
- On a retryable status, drains the body, sleeps `retryDelayMs * 2^(attempt-1)`
  (when more attempts remain), and loops.
- An `AbortError` is wrapped into `LlmTimeoutError` and rethrown without
  further attempts.
- Network errors continue to retry under the existing backoff schedule.
- After exhausting `maxRetries`, throws `LlmRequestError(provider, 0, ...)`
  with the last observed status or network kind.

`sleep(ms)` resolves after the given delay and is used to back off between
retries.

`readText(res)` is a thin wrapper over `Response#text()` for callers that want
the shared error helper around diagnostics.

## Public surface and factory

<!-- lw:anchors packages/core/src/llm/index.ts#createLlmClient packages/core/src/llm/index.ts#MissingApiKeyError packages/core/src/llm/index.ts#MissingApiKeyError.constructor packages/core/src/llm/index.ts#LlmRequestError packages/core/src/llm/index.ts#LlmRequestError.constructor -->

`createLlmClient(repoRoot, config)` builds the right `LlmClient` for a resolved
`LivewikiConfig`. It first runs `validateConfigForBatch` to guarantee
provider/preset and model are present, then resolves the adapter choice,
default `baseUrl`, env-var name, `thinkingDefault`, and
`preferMaxCompletionTokens` via `resolveProviderFromConfig`. The API key is read
from `process.env[resolved.envVar]`; absence raises `MissingApiKeyError`.
`timeoutMs` from config is forwarded with an explicit undefined check so a
`0` (disable) value survives.

`MissingApiKeyError` records `provider` and `envVar`, and its message is
carefully scoped: it never references a key value or any other source (config,
checkpoint, logs) where keys might leak. The constructor sets `name` and
explains the env-var contract.

`LlmRequestError` carries `provider`, `status`, and `errorBody` (truncated to
500 characters in the thrown message). Its message includes the truncated body
but never the request headers, so API keys cannot leak through error logs.

## OpenAI-compatible adapter

<!-- lw:anchors packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter.constructor packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter.generate packages/core/src/llm/openai-compat.ts#normalizeFinishReason packages/core/src/llm/openai-compat.ts#resolveThinkingMode -->

`OpenAiCompatAdapter` is an `LlmClient` that targets OpenAI Chat Completions–
compatible providers. The URL the adapter posts to is detected from
`baseUrl`: if it already ends in `/v1`, only `/chat/completions` is appended,
avoiding duplicated version segments.

The constructor stores `apiKey`, `baseUrl`, `model`, and the AdapterConfig
derived from options. `thinkingDefault` defaults to `"omit"`, and
`preferMaxCompletionTokens` defaults to `false`. `timeoutMs: 0`, `fetchImpl`,
`maxRetries`, and `retryDelayMs` are each forwarded through explicit
undefined checks (and `withTimeoutMs` for the timer) so disable signals and
zero-delay retries are preserved.

`generate(req)` builds an OpenAI-style body: `model`, a `system` + `user`
message pair, optional `temperature`, and either `max_tokens` or
`max_completion_tokens` based on `preferMaxCompletionTokens`
(request-level override beats adapter-level). Thinking mode is resolved via
`resolveThinkingMode` and, depending on the result, attached as
`thinking: { type: "disabled" }` or `thinking: { type: "adaptive" }`. The
response's first choice is mapped to a `GenerateResult`; usage is read from
`prompt_tokens` / `completion_tokens`, defaulting to `0` if absent, and the
raw `finish_reason` is attached when present.

`normalizeFinishReason(raw)` maps OpenAI-style finish reasons to the
`StopReason` union: `"length"` → `"length"`, `"stop"` → `"complete"`,
`null` / `undefined` → `"unknown"`, anything else (including `"tool_calls"`)
→ `"incomplete"`.

`resolveThinkingMode(requestThinking, adapterDefault, model)` decides the
effective thinking field for a request. A non-`"omit"` request value always
wins. An `"omit"` request is honored as `"omit"`. Otherwise the adapter
default is used unless it is `"disabled"` / `"adaptive"`, in which case that
value is returned. The fallback heuristic is the model name: a `MiniMax-M3`
model disables thinking by default even when the adapter default is `"omit"`,
since the MiniMax-M3 chat endpoint otherwise enables thinking on omission.