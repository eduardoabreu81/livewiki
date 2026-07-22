---
title: LLM client and adapters
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

# LLM client and adapters

This page documents the HTTP LLM client and provider adapters that batch generation depends on.

## When to use this page

- **Construct** an `LlmClient` for a batch run via `createLlmClient` and read its provider/model.
- **Configure** timeout, retry, and abort behavior using `withTimeoutMs`, `DEFAULT_LLM_TIMEOUT_MS`, and the per-attempt abort timer in `requestWithRetry`.
- **Diagnose** failures by mapping HTTP and abort signals to `LlmRequestError` and `LlmTimeoutError`.
- **Translate** provider-specific usage and stop fields into the normalized `LlmUsage` / `StopReason` shapes used by the rest of the codebase.

## How it fits

The `packages/core/src/llm/` module sits between batch orchestration and external model APIs. `index.ts` exposes the public `LlmClient` interface and the `createLlmClient` factory, which validates the config, resolves the API key from the environment, and instantiates either `AnthropicAdapter` or `OpenAiCompatAdapter`. Both adapters delegate the actual HTTP call to `requestWithRetry` in `base.ts`, which centralizes timeout, retry, and error normalization. `types.ts` defines the canonical `GenerateRequest` / `GenerateResult` shapes that batch consumers rely on; both adapters translate provider-specific fields into those shapes before returning. Test files (`adapters.test.ts`, `create-client-timeout.test.ts`) cover adapter wire formats and end-to-end timeout/retry behavior with controlled `fetch` doubles.

## Public factory and error types

<!-- lw:anchors packages/core/src/llm/index.ts#createLlmClient packages/core/src/llm/index.ts#MissingApiKeyError packages/core/src/llm/index.ts#MissingApiKeyError.constructor packages/core/src/llm/index.ts#LlmRequestError packages/core/src/llm/index.ts#LlmRequestError.constructor -->

`createLlmClient(repoRoot: string, config: LivewikiConfig): LlmClient` validates the batch configuration, resolves the adapter via `resolveProviderFromConfig`, reads the API key from `process.env[resolved.envVar]`, and constructs an `AnthropicAdapter` or `OpenAiCompatAdapter`. A missing API key throws `MissingApiKeyError(provider, envVar)`; the constructor message explicitly states that keys never live in `config.json`, `checkpoint_json`, logs, or error messages. Provider or model absence is rejected by `validateConfigForBatch` before the key is read.

`MissingApiKeyError` and `LlmRequestError` both extend `Error` and are constructed with provider context. `LlmRequestError(provider, status, errorBody)` truncates `errorBody` to 500 characters before including it in the message; the status field carries the HTTP status (or `0` when retry budget is exhausted). Neither error class includes request headers, so API keys cannot leak through the message.

## Anthropic adapter

<!-- lw:anchors packages/core/src/llm/anthropic.ts#AnthropicAdapter packages/core/src/llm/anthropic.ts#AnthropicAdapter.constructor packages/core/src/llm/anthropic.ts#AnthropicAdapter.generate packages/core/src/llm/anthropic.ts#normalizeStopReason -->

```ts
constructor(opts: { apiKey: string; baseUrl: string; model: string; fetchImpl?: typeof fetch; timeoutMs?: number; maxRetries?: number })
async generate(req: GenerateRequest): Promise<GenerateResult>
```

The constructor stores `apiKey`, `baseUrl`, and `model`, then assembles an internal `AdapterConfig`. `fetchImpl` is only spread when provided, `timeoutMs` is spread via `withTimeoutMs` (preserving `0`), and `maxRetries` is only spread when explicitly defined.

`generate` POSTs to `<baseUrl>/v1/messages` (trailing slash stripped) with headers `x-api-key`, `anthropic-version: 2023-06-01`, and `content-type: application/json`. The request body sets `model`, `system`, a single `messages: [{ role: "user", content: req.user }]`, `max_tokens` defaulting to `4096`, and an optional `temperature`. On success it normalizes `input_tokens` / `output_tokens` into `LlmUsage`, extracts the first text content block (falling back to `""` when absent or non-text), and maps `stop_reason` via `normalizeStopReason`. The raw provider `stop_reason` is preserved as `rawStopReason` when not `null`.

`normalizeStopReason(stopReason: string | null | undefined): StopReason` returns `"length"` for `"max_tokens"`, `"complete"` for `"end_turn"` or `"stop_sequence"`, `"unknown"` for `null` / `undefined`, and `"incomplete"` for any other string (including `"tool_use"`).

## OpenAI-compatible adapter

<!-- lw:anchors packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter.constructor packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter.generate packages/core/src/llm/openai-compat.ts#normalizeFinishReason packages/core/src/llm/openai-compat.ts#resolveThinkingMode -->

```ts
constructor(opts: OpenAiCompatAdapterOpts)
async generate(req: GenerateRequest): Promise<GenerateResult>
```

`OpenAiCompatAdapterOpts` accepts `apiKey`, `baseUrl`, `model`, optional `fetchImpl` / `timeoutMs` / `maxRetries` / `retryDelayMs`, plus `thinkingDefault` (defaults to `"omit"`) and `preferMaxCompletionTokens` (defaults to `false`). The constructor stores these and builds the same `AdapterConfig` shape as the Anthropic adapter, using `withTimeoutMs` so `timeoutMs: 0` is preserved.

`generate` builds `<baseUrl>/chat/completions`, avoiding duplicating `/v1` if `baseUrl` already ends with it. It always sends `system` and `user` messages, an optional `temperature`, and either `max_completion_tokens` (when `preferMaxCompletionTokens` is true) or `max_tokens`. When `resolveThinkingMode` returns `"disabled"` or `"adaptive"`, the adapter sends the corresponding `thinking: { type }` block. The success path extracts `choices[0].message.content`, maps `prompt_tokens` / `completion_tokens` into `LlmUsage`, and normalizes `finish_reason`.

`normalizeFinishReason(finishReason: string | null | undefined): StopReason` returns `"length"` for `"length"`, `"complete"` for `"stop"`, `"unknown"` for `null` / `undefined`, and `"incomplete"` for any other string (including `"tool_calls"`).

`resolveThinkingMode(requestThinking, adapterDefault, model)` first honors a non-`"omit"` request value, then falls back to the adapter default (`"n/a"` is treated as `"omit"`), and finally applies a model-name heuristic: if the model matches `/minimax-m3/i` and no default disabled/adaptive mode was set, it forces `"disabled"`. Anything else returns `"omit"`.

## HTTP base: timeout, retry, and shared helpers

<!-- lw:anchors packages/core/src/llm/base.ts#DEFAULT_LLM_TIMEOUT_MS packages/core/src/llm/base.ts#LlmTimeoutError packages/core/src/llm/base.ts#LlmTimeoutError.constructor packages/core/src/llm/base.ts#isRetryableStatus packages/core/src/llm/base.ts#requestWithRetry packages/core/src/llm/base.ts#sleep packages/core/src/llm/base.ts#readText packages/core/src/llm/base.ts#withTimeoutMs -->

```ts
export const DEFAULT_LLM_TIMEOUT_MS = 300_000;
export function withTimeoutMs(timeoutMs: number | undefined): { timeoutMs: number } | Record<string, never>
function isRetryableStatus(status: number): boolean
export async function requestWithRetry(provider: LlmProvider, url: string, init: RequestInit, adapterConfig: AdapterConfig): Promise<Response>
function sleep(ms: number): Promise<void>
export async function readText(res: Response): Promise<string>
```

`DEFAULT_LLM_TIMEOUT_MS` is `300_000` (5 minutes). `withTimeoutMs` returns `{ timeoutMs }` when defined (including `0`) and `{}` otherwise, so adapters can spread the result without dropping the explicit zero value.

`isRetryableStatus(status)` returns `true` for `429` and any 5xx status; all other statuses are treated as terminal. `sleep(ms)` is a `setTimeout`-based promise used between retries.

`requestWithRetry` resolves the effective `fetchImpl`, `timeoutMs`, `maxRetries` (default `3`), and `retryDelayMs` (default `1000`). Each attempt arms an `AbortController` only when `timeoutMs > 0`; an `AbortError` is converted to `LlmTimeoutError` and re-thrown without further retries, because the provider may already have started a generation. Non-retryable HTTP responses (`!isRetryableStatus(res.status)`) throw `LlmRequestError` immediately. Retryable responses and network errors back off via `retryDelayMs * 2^(attempt-1)` and continue up to `maxRetries`. When the loop exits without success, `requestWithRetry` throws `LlmRequestError(provider, 0, "Failed after N attempts (last status: ... | last error: network | unknown)")`.

`LlmTimeoutError(provider, timeoutMs)` constructs a message distinguishing a positive timeout (with the millisecond value and a note that the provider may still bill) from a `0` / aborted case. The class exposes `provider` and `timeoutMs` as readonly fields and sets `name = "LlmTimeoutError"`.

`readText(res)` is a thin wrapper over `res.text()` exposed for adapters that need raw body access for diagnostics.

## Test fixtures

<!-- lw:anchors packages/core/src/llm/adapters.test.ts#fakeFetch -->

```ts
function fakeFetch(response: { status?: number; body?: unknown; ok?: boolean }): typeof fetch
```

`fakeFetch` returns a `vi.fn`-based fetch double that resolves to a `Response` with the given `status` (default `200`), `body` JSON-encoded when provided (default `"{}"`), and an `ok` value derived from the status range unless explicitly overridden. It is the shared fixture used across adapter tests to inject controlled provider responses.

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
- ["Core pipeline: batch orchestration, config, db, and diagrams"](core-src-03.md) — dependency and dependent
- [core-src-05 responsibilities](core-src-05.md) — dependent
- [Batch orchestrator status, diagnostics, and stage-5 helpers](core-src-02.md) — dependent
<!-- livewiki:navigate:end -->
