---
title: LLM client and provider adapters
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

# LLM client and provider adapters

This module exposes the thin HTTP LLM client that livewiki uses to call Anthropic and OpenAI-compatible providers, plus the shared retry/timeout helpers it depends on.

## When to use this page

- **Wire up** an LLM provider from `LivewikiConfig` using `createLlmClient` and read API keys from the documented env vars.
- **Diagnose** retry, timeout, or auth failures by matching against `LlmRequestError`, `LlmTimeoutError`, and `MissingApiKeyError`.
- **Extend** provider support by implementing the `LlmClient` interface and reusing `requestWithRetry` for consistent retry and timeout semantics.
- **Tune** per-attempt timeouts and retry counts via `AdapterConfig` (`timeoutMs`, `maxRetries`, `retryDelayMs`) without rebuilding adapters.

## How it fits

The `llm/` folder sits at `packages/core/src/llm/` and supplies a single `LlmClient` surface to higher-level callers such as the batch runner. `index.ts` defines the public interface, error types, and the `createLlmClient` factory that resolves provider config and reads the API key from process env. `base.ts` contains the shared HTTP adapter with timeout, retry, and abort semantics that both provider adapters reuse. `anthropic.ts` and `openai-compat.ts` translate each provider's native request/response into the canonical `GenerateRequest` / `GenerateResult` shape, while `types.ts` holds the normalized `LlmUsage`, `StopReason`, and `ThinkingMode` types. The accompanying `*.test.ts` files exercise adapter wiring and the retry/timeout matrix. The excerpt does not establish exhaustive behavior beyond what these files show.

## Public client and factory

<!-- lw:anchors packages/core/src/llm/index.ts#createLlmClient packages/core/src/llm/index.ts#MissingApiKeyError packages/core/src/llm/index.ts#MissingApiKeyError.constructor packages/core/src/llm/index.ts#LlmRequestError packages/core/src/llm/index.ts#LlmRequestError.constructor -->

The module exports the `LlmClient` interface (provider tag, model, `generate`) and a factory that validates config and instantiates the right adapter.

`createLlmClient` has the signature:

```ts
export function createLlmClient(repoRoot: string, config: LivewikiConfig): LlmClient
```

It runs `validateConfigForBatch` (so missing `provider`/`preset`/`model` or an invalid `timeoutMs` throw early) and then `resolveProviderFromConfig` to obtain the adapter name, env var, and any preset defaults. The base URL falls back from explicit `config.baseUrl` to preset, then to provider default via `resolveBaseUrl`. The API key is read from `process.env[resolved.envVar]`; if missing, `MissingApiKeyError` is thrown and the message never references any key value. `timeoutMs` is forwarded explicitly so that `0` (disable) is preserved instead of being dropped by a truthy spread.

`MissingApiKeyError` carries `provider` and `envVar`; `LlmRequestError` carries `provider`, `status`, and a truncated `errorBody` (capped at 500 chars to avoid dumping giant payloads). Both names are assigned in their constructors so they survive serialization across `Error` boundaries.

## Anthropic adapter

<!-- lw:anchors packages/core/src/llm/anthropic.ts#AnthropicAdapter packages/core/src/llm/anthropic.ts#AnthropicAdapter.constructor packages/core/src/llm/anthropic.ts#AnthropicAdapter.generate packages/core/src/llm/anthropic.ts#normalizeStopReason -->

`AnthropicAdapter` implements `LlmClient` with `provider = "anthropic"`. Its constructor signature is:

```ts
constructor(opts: { apiKey: string; baseUrl: string; model: string; fetchImpl?: typeof fetch; timeoutMs?: number; maxRetries?: number })
```

The constructor stores credentials and assembles an `AdapterConfig`, using `withTimeoutMs` so a `timeoutMs: 0` value survives into the shared retry helper. `generate` posts to `${baseUrl}/v1/messages` with `x-api-key`, `anthropic-version: 2023-06-01`, and a JSON body containing `model`, `system`, a single user message, and `max_tokens` (default 4096). The response is parsed for the first text block; `input_tokens` / `output_tokens` are renamed to `inputTokens` / `outputTokens`, and `stop_reason` is normalized via `normalizeStopReason` (`max_tokens → length`, `end_turn` / `stop_sequence → complete`, `tool_use` and other strings fall through to `incomplete`, `null` / `undefined → unknown`). The original `stop_reason` is preserved as `rawStopReason` when present.

```ts
async generate(req: GenerateRequest): Promise<GenerateResult>
```

`generate` delegates the HTTP attempt to `requestWithRetry`, so retries, timeouts, and error normalization are inherited.

## OpenAI-compatible adapter

<!-- lw:anchors packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter.constructor packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter.generate packages/core/src/llm/openai-compat.ts#normalizeFinishReason packages/core/src/llm/openai-compat.ts#resolveThinkingMode -->

`OpenAiCompatAdapter` implements `LlmClient` with `provider = "openai-compat"` and is the broader-compatibility path that covers OpenAI, OpenRouter, LiteLLM, MiniMax chat, and Ollama cloud. Its constructor signature is:

```ts
constructor(opts: OpenAiCompatAdapterOpts)
```

where `OpenAiCompatAdapterOpts` adds `thinkingDefault`, `preferMaxCompletionTokens`, and `retryDelayMs` on top of the base adapter fields. The constructor stores `thinkingDefault` (default `"omit"`) and `preferMaxCompletionTokens` (default `false`) and builds the shared `AdapterConfig` via `withTimeoutMs` so `0` survives.

`generate` builds the URL by trimming a trailing slash and avoiding a duplicate `/v1` if `baseUrl` already ends in `/v1` or `/v1/`. It chooses between `max_tokens` and `max_completion_tokens` based on per-request `preferMaxCompletionTokens` falling back to the adapter default, then resolves the effective thinking mode with `resolveThinkingMode`. The request goes out as `POST` with `Authorization: Bearer <apiKey>`. The response is parsed for `choices[0].message.content`, with `prompt_tokens` / `completion_tokens` mapped to `inputTokens` / `outputTokens` and `finish_reason` normalized via `normalizeFinishReason`.

```ts
async generate(req: GenerateRequest): Promise<GenerateResult>
```

`normalizeFinishReason` maps `length → length`, `stop → complete`, `null` / `undefined → unknown`, and anything else to `incomplete`. `resolveThinkingMode` first honors an explicit non-`omit` request mode, then the adapter default (`"n/a"` becomes `"omit"`), and finally a model-name heuristic that forces `"disabled"` for names matching `MiniMax-M3` so the adapter counters MiniMax chat's default-on thinking behavior.

## Shared HTTP adapter, retry, and timeout

<!-- lw:anchors packages/core/src/llm/base.ts#DEFAULT_LLM_TIMEOUT_MS packages/core/src/llm/base.ts#LlmTimeoutError packages/core/src/llm/base.ts#LlmTimeoutError.constructor packages/core/src/llm/base.ts#isRetryableStatus packages/core/src/llm/base.ts#withTimeoutMs packages/core/src/llm/base.ts#requestWithRetry packages/core/src/llm/base.ts#sleep packages/core/src/llm/base.ts#readText -->

`base.ts` centralizes the HTTP attempt so both providers share identical retry, abort, and error behavior.

`DEFAULT_LLM_TIMEOUT_MS` is `300_000` (5 minutes) and is used whenever `AdapterConfig.timeoutMs` is `undefined`. `LlmTimeoutError` is thrown when an `AbortError` propagates out of the fetch attempt and carries `provider` plus the `timeoutMs` that was in effect (including `0`). Its constructor emits a message that does not name the API key.

`withTimeoutMs` is a spread helper:

```ts
export function withTimeoutMs(
  timeoutMs: number | undefined,
): { timeoutMs: number } | Record<string, never>
```

It returns `{ timeoutMs }` when defined and an empty object otherwise, so adapters can pass through an explicit `0` (disable) instead of having it dropped by a truthy check.

`requestWithRetry` runs the request up to `maxRetries` times (default 3) with exponential backoff via `retryDelayMs * 2^(attempt - 1)` between retries. It arms an `AbortController` only when `timeoutMs > 0`. The signature is:

```ts
export async function requestWithRetry(
  provider: LlmProvider,
  url: string,
  init: RequestInit,
  adapterConfig: AdapterConfig,
): Promise<Response>
```

Successful responses return immediately. Non-retryable HTTP statuses (anything `isRetryableStatus` rejects) raise `LlmRequestError` once with the response body for diagnostics; `isRetryableStatus` returns true only for `429` or `5xx`. A thrown `LlmRequestError` or `LlmTimeoutError` propagates without retry, and an `AbortError` is converted to `LlmTimeoutError` and never retried (generation state is unknown and the provider may still bill). Network errors keep the retry path because their pre-send timing is uncertain. After exhausting retries the helper throws an `LlmRequestError` whose body reports either the last status or the last network error kind.

`sleep(ms)` is a `setTimeout`-backed promise used purely for the backoff delays, and `readText` returns `Response.text()` for callers that want the raw body.

## Test fixtures

<!-- lw:anchors packages/core/src/llm/adapters.test.ts#fakeFetch -->

`adapters.test.ts` provides a single reusable fake fetch:

```ts
function fakeFetch(response: { status?: number; body?: unknown; ok?: boolean }): typeof fetch
```

It returns a `vi.fn` that resolves to a `Response` with `status` defaulting to `200`, `ok` defaulting to the standard 2xx range, and a JSON-serialized body (defaulting to `{}`). The other tests in the file exercise `AnthropicAdapter` and `OpenAiCompatAdapter` request shape, usage normalization, stop/finish reason mapping, and the `requestWithRetry` retry/timeout matrix end-to-end. The companion `create-client-timeout.test.ts` (declared in the module path list) verifies that `createLlmClient` forwards `timeoutMs` into both adapters and that `timeoutMs: 0` never auto-aborts.

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
- [Batch orchestration, config, index DB, and diagram generators](core-src-03.md) — dependency and dependent
- [core-src-05 — import resolution, indexing and init pipelines](core-src-05.md) — dependent
- [core-src-01 artifact and ledger pipeline](core-src-01.md) — dependent
<!-- livewiki:navigate:end -->
