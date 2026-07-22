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

This page documents the thin HTTP client that batch code uses to talk to Anthropic and to OpenAI-compatible chat APIs.

## When to use this page

- **Configure** an LLM provider by setting the right env var and calling `createLlmClient` with a validated `LivewikiConfig`.
- **Read** the timeout and retry rules (`DEFAULT_LLM_TIMEOUT_MS`, `withTimeoutMs`, `requestWithRetry`) when adding a new caller or debugging a stuck run.
- **Map** provider-specific usage and stop reasons to the normalized `GenerateResult` shape via `AnthropicAdapter` / `OpenAiCompatAdapter`.
- **Diagnose** thrown errors (`MissingApiKeyError`, `LlmRequestError`, `LlmTimeoutError`) by reading their fields instead of guessing from the message string.

## How it fits

The `packages/core/src/llm` module sits in front of HTTP and behind the batch orchestrator. `index.ts` exposes the `LlmClient` interface, the `createLlmClient` factory, and the two public error classes; `base.ts` holds the shared retry/timeout plumbing and the `AdapterConfig` shape; `anthropic.ts` and `openai-compat.ts` are the provider adapters; `types.ts` defines the normalized request/response shapes shared with the rest of `core`. The tests under `adapters.test.ts` and `create-client-timeout.test.ts` exercise the adapters and the factory without hitting the network.

## Shared HTTP plumbing
<!-- lw:anchors packages/core/src/llm/base.ts#DEFAULT_LLM_TIMEOUT_MS packages/core/src/llm/base.ts#isRetryableStatus packages/core/src/llm/base.ts#withTimeoutMs packages/core/src/llm/base.ts#sleep packages/core/src/llm/base.ts#readText packages/core/src/llm/base.ts#requestWithRetry -->

`base.ts` is the single place where the timeout/retry policy lives, so adapters stay small and consistent.

- `DEFAULT_LLM_TIMEOUT_MS` is the per-attempt timeout used when `AdapterConfig.timeoutMs` is `undefined`:

```ts
export const DEFAULT_LLM_TIMEOUT_MS = 300_000;
```

- `withTimeoutMs` is a spread helper that preserves `timeoutMs: 0` (used to disable the automatic abort) instead of dropping it through a truthy check. `withTimeoutMs(0)` returns `{ timeoutMs: 0 }`; `withTimeoutMs(undefined)` returns `{}`.

- `isRetryableStatus` only marks HTTP `429` and 5xx as retryable; non-retryable statuses throw `LlmRequestError` immediately without a second attempt.

- `sleep` is a tiny `setTimeout`-based delay used between retries. Its signature is `function sleep(ms: number): Promise<void>` and it is not exported.

- `readText` simply forwards to `Response.text()`; it is exported so callers can read bodies without pulling in the rest of the adapter plumbing.

`requestWithRetry` ties these together:

```ts
export async function requestWithRetry(
  provider: LlmProvider,
  url: string,
  init: RequestInit,
  adapterConfig: AdapterConfig,
): Promise<Response>
```

The normal path is: build an `AbortController`, arm the timer only when `timeoutMs > 0`, call `fetchImpl(url, { ...init, signal })`, return on `res.ok`, throw `LlmRequestError` on a non-retryable status, or back off and retry on `429`/`5xx`. When the retry budget is exhausted it throws `LlmRequestError` with `status: 0` and a message that references either the last status or the last network error. The excerpt shows two important exception branches: a thrown `LlmTimeoutError` or `LlmRequestError` rethrows immediately without another attempt, and an `Error` with `name === "AbortError"` is converted into `LlmTimeoutError` — a timeout never triggers a retry, because the provider may already have billed an unknown generation.

## Timeout error type
<!-- lw:anchors packages/core/src/llm/base.ts#LlmTimeoutError packages/core/src/llm/base.ts#LlmTimeoutError.constructor -->

`LlmTimeoutError` is the error type raised when the client abort timer fires. Its constructor is:

```ts
constructor(provider: LlmProvider, timeoutMs: number)
```

The constructor builds a message that names the provider and the timeout, and explicitly notes that the provider may still bill and that usage is unknown. `provider` and `timeoutMs` are stored as readonly fields on the instance. Because `requestWithRetry` converts `AbortError` into `LlmTimeoutError` without retrying, callers can rely on this type to mean "exactly one HTTP attempt was started and aborted".

## Anthropic adapter
<!-- lw:anchors packages/core/src/llm/anthropic.ts#AnthropicAdapter packages/core/src/llm/anthropic.ts#AnthropicAdapter.constructor packages/core/src/llm/anthropic.ts#AnthropicAdapter.generate packages/core/src/llm/anthropic.ts#normalizeStopReason -->

`AnthropicAdapter` is the implementation of `LlmClient` for Anthropic's `/v1/messages` endpoint.

```ts
export class AnthropicAdapter implements LlmClient
```

```ts
constructor(opts: { apiKey: string; baseUrl: string; model: string; fetchImpl?: typeof fetch; timeoutMs?: number; maxRetries?: number })
```

The constructor stores `apiKey`, `baseUrl`, and `model` and builds an `AdapterConfig`. It uses `withTimeoutMs(opts.timeoutMs)` so `timeoutMs: 0` is preserved, and only spreads `maxRetries` when explicitly provided.

```ts
async generate(req: GenerateRequest): Promise<GenerateResult>
```

`generate` POSTs to `${baseUrl}/v1/messages` (after trimming a trailing `/`) with headers `x-api-key`, `anthropic-version: 2023-06-01`, and `content-type: application/json`. The request body sets `model`, `system`, `messages: [{ role: "user", content: req.user }]`, and `max_tokens: req.maxTokens ?? 4096`; `temperature` is only included when `req.temperature !== undefined`. The HTTP call goes through `requestWithRetry`; on success the adapter reads the first `content` entry whose `type === "text"`, normalizes `usage.input_tokens`/`output_tokens` to `inputTokens`/`outputTokens`, and maps `stop_reason` via `normalizeStopReason`. The raw `stop_reason` is attached as `rawStopReason` only when it is non-null.

```ts
function normalizeStopReason(stopReason: string | null | undefined): StopReason
```

`normalizeStopReason` maps `"max_tokens"` → `"length"`, `"end_turn"`/`"stop_sequence"` → `"complete"`, `null`/`undefined` → `"unknown"`, and any other non-null string → `"incomplete"`. So a `tool_use` reason comes back as `"incomplete"`, and an unknown future reason falls into the same bucket rather than throwing.

## OpenAI-compatible adapter
<!-- lw:anchors packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter.constructor packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter.generate packages/core/src/llm/openai-compat.ts#normalizeFinishReason packages/core/src/llm/openai-compat.ts#resolveThinkingMode -->

`OpenAiCompatAdapter` covers OpenAI, OpenRouter, LiteLLM, MiniMax chat, and Ollama cloud through one chat-completions shape.

```ts
export class OpenAiCompatAdapter implements LlmClient
```

```ts
constructor(opts: OpenAiCompatAdapterOpts)
```

The constructor stores `apiKey`, `baseUrl`, `model`, plus `thinkingDefault` (defaulting to `"omit"`) and `preferMaxCompletionTokens` (defaulting to `false`). It builds `AdapterConfig` the same way `AnthropicAdapter` does — `withTimeoutMs(opts.timeoutMs)` so `0` survives, and conditional spreads for `fetchImpl`, `maxRetries`, and `retryDelayMs`.

```ts
async generate(req: GenerateRequest): Promise<GenerateResult>
```

`generate` builds the URL so that a `baseUrl` already ending in `/v1` does not get a second `/v1` appended; otherwise it appends `/v1/chat/completions`. The body always includes `model` and a two-message `[system, user]` array; `temperature` is included only when provided. `preferMaxCompletionTokens` (request value or adapter default) chooses between `max_completion_tokens` and `max_tokens`. Thinking mode is resolved through `resolveThinkingMode`, and when it returns `"disabled"` or `"adaptive"` it is emitted as `thinking: { type: ... }`; `"omit"` leaves the field off. HTTP goes through `requestWithRetry`, then the adapter reads `choices[0].message.content`, normalizes `prompt_tokens`/`completion_tokens` to `inputTokens`/`outputTokens`, and maps `finish_reason` via `normalizeFinishReason`.

```ts
function normalizeFinishReason(finishReason: string | null | undefined): StopReason
```

`normalizeFinishReason` maps `"length"` → `"length"`, `"stop"` → `"complete"`, `null`/`undefined` → `"unknown"`, and anything else → `"incomplete"`.

```ts
export function resolveThinkingMode(
  requestThinking: ThinkingMode | undefined,
  adapterDefault: ThinkingMode | "n/a",
  model: string,
): ThinkingMode | "omit"
```

`resolveThinkingMode` decides whether the adapter sends a `thinking` field. An explicit non-`"omit"` request value wins; an explicit `"omit"` returns `"omit"`; otherwise the adapter default is used unless it is `"n/a"`, in which case the heuristic kicks in. The heuristic forces `"disabled"` for any model whose name matches `/minimax-m3/i` (so MiniMax-M3 chat, which would otherwise turn thinking on by default, is suppressed). Anything else returns `"omit"`.

## Public factory and errors
<!-- lw:anchors packages/core/src/llm/index.ts#createLlmClient packages/core/src/llm/index.ts#MissingApiKeyError packages/core/src/llm/index.ts#MissingApiKeyError.constructor packages/core/src/llm/index.ts#LlmRequestError packages/core/src/llm/index.ts#LlmRequestError.constructor -->

`index.ts` is what the rest of the codebase imports. It owns `LlmClient`, `createLlmClient`, and the two error classes that callers are expected to recognize.

```ts
export function createLlmClient(repoRoot: string, config: LivewikiConfig): LlmClient
```

`createLlmClient` calls `validateConfigForBatch` (which is responsible for surfacing missing `provider`/`preset`/`model` and for validating `timeoutMs` — the test in `create-client-timeout.test.ts` checks negative and overflow values are rejected), then resolves the provider through `resolveProviderFromConfig`, picks a `baseUrl`, and reads the API key from `process.env[resolved.envVar]`. Missing key behavior is a thrown `MissingApiKeyError`. `timeoutMs` from config is forwarded only when explicitly set, so `0` (disable) is preserved; for `openai-compat` the preset's `thinkingDefault` and `preferMaxCompletionTokens` are also passed in. The factory dispatches on `resolved.adapter`: `"anthropic"` builds `AnthropicAdapter`, otherwise it builds `OpenAiCompatAdapter`.

```ts
export class MissingApiKeyError extends Error
```

```ts
constructor(provider: LlmProvider, envVar: string)
```

The message names the provider and the required env var, and explicitly says keys never live in `config.json`, `checkpoint_json`, logs, or error messages — so the value of a missing key cannot leak through the error string. `provider` and `envVar` are stored as readonly fields.

```ts
export class LlmRequestError extends Error
```

```ts
constructor(provider: LlmProvider, status: number, errorBody: string)
```

The constructor truncates `errorBody` to 500 characters before composing the message, so an oversized provider payload does not end up verbatim in a thrown string. `status`, `provider`, and the (untruncated) `errorBody` are stored as readonly fields for diagnostics. The class never includes request headers, which keeps API keys out of the error path; the test in `key-leak.test.ts` (referenced from the module comment) covers that guarantee.

## Test helpers
<!-- lw:anchors packages/core/src/llm/adapters.test.ts#fakeFetch -->

`fakeFetch` is the in-process `fetch` stub that the adapter test suites share. Its signature is:

```ts
function fakeFetch(response: { status?: number; body?: unknown; ok?: boolean }): typeof fetch
```

It returns a `vi.fn` that resolves to a `Response` whose `status` defaults to `200` and whose `ok` defaults to `status >= 200 && status < 300`. When `body` is provided it is JSON-stringified; otherwise the response body is `"{}"`. The headers always include `content-type: application/json`, and the return value is cast through `unknown` to `typeof fetch` so adapters accept it as their injected `fetchImpl`.

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
- [Batch orchestration, config, index schema, and deterministic diagrams](core-src-03.md) — dependency and dependent
- [core — init, indexer, import resolution, and imports pipeline](core-src-05.md) — dependent
- [Batch pipeline tests, state types, and status aggregation](core-src-02.md) — dependent
<!-- livewiki:navigate:end -->
