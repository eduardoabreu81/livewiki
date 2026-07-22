---
title: livewiki LLM client
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

# livewiki LLM client

Owns the thin HTTP client and provider adapters that call LLM providers, normalize usage and stop reasons, and apply retry/timeout policy for the documentation batch pipeline.

## When to use this page

- **Configure** an LLM provider for a documentation batch by selecting `provider`, `model`, `baseUrl`, and `timeoutMs` and ensuring the matching API key env var is set before invoking `createLlmClient`.
- **Diagnose** adapter behavior when a request fails, including which status codes retry (`429`, `5xx`), which do not (other `4xx`), and why an abort is surfaced as `LlmTimeoutError` rather than retried.
- **Extend** the client with another OpenAI-compatible endpoint by reusing `OpenAiCompatAdapter`, `normalizeFinishReason`, and `resolveThinkingMode` instead of duplicating the request shape.
- **Audit** the request envelope (URL, headers, body fields, `thinking`, `max_tokens`/`max_completion_tokens`) sent to Anthropic or OpenAI-compatible providers.

## How it fits

The `llm` package under `packages/core/src/llm/` provides the only LLM-facing surface used by the rest of `livewiki`. It depends on `../config.ts` for `LlmProvider`, `LivewikiConfig`, preset resolution, and `validateConfigForBatch`. Higher-level orchestration (e.g. `batch.ts`) consumes the normalized `GenerateResult` shape and treats the returned `LlmUsage` and `StopReason` as canonical.

`base.ts` centralizes the shared HTTP concerns: timeout, retry, and normalized errors. Both adapter classes (`AnthropicAdapter` in `anthropic.ts` and `OpenAiCompatAdapter` in `openai-compat.ts`) implement the `LlmClient` interface declared in `index.ts`, which also re-exports `LlmRequestError`, `MissingApiKeyError`, and the canonical type contracts from `types.ts`. Tests in `adapters.test.ts` and `create-client-timeout.test.ts` exercise the request shape and the retry/timeout policy against injected `fetchImpl` doubles, so the adapters remain network-free in unit tests.

## Shared HTTP layer (base.ts)

<!-- lw:anchors packages/core/src/llm/base.ts#DEFAULT_LLM_TIMEOUT_MS packages/core/src/llm/base.ts#LlmTimeoutError packages/core/src/llm/base.ts#LlmTimeoutError.constructor packages/core/src/llm/base.ts#isRetryableStatus packages/core/src/llm/base.ts#withTimeoutMs packages/core/src/llm/base.ts#requestWithRetry packages/core/src/llm/base.ts#sleep packages/core/src/llm/base.ts#readText -->

The default per-attempt timeout when `timeoutMs` is omitted is five minutes:

```ts
export const DEFAULT_LLM_TIMEOUT_MS = 300_000;
```

`LlmTimeoutError` represents the abort path and must not trigger automatic retries. Its constructor signature is:

```ts
constructor(provider: LlmProvider, timeoutMs: number)
```

It stores `provider` and `timeoutMs` on the instance; the message notes that the provider may still complete and bill. The class name is set to `LlmTimeoutError` so `instanceof` and `err.name` checks both succeed. The excerpt does not establish exhaustive behavior — for instance, callers may still see an `AbortError` re-thrown from `fetch` if the request never started; the loop in `requestWithRetry` translates that name into `LlmTimeoutError` exactly once (see below).

Retryability is decided by:

```ts
function isRetryableStatus(status: number): boolean
```

which returns `true` only for `429` or `5xx`. Any other non-OK status throws `LlmRequestError` immediately and the request is not retried. The four-oh-one test case in `adapters.test.ts` confirms a single call even with `maxRetries: 3`.

`withTimeoutMs` exists so that `timeoutMs: 0` (disable) survives spread:

```ts
export function withTimeoutMs(
  timeoutMs: number | undefined,
): { timeoutMs: number } | Record<string, never>
```

Both adapter constructors use it to pass through an explicit `0` rather than the truthy-gated default.

`requestWithRetry` is the central HTTP loop:

```ts
export async function requestWithRetry(
  provider: LlmProvider,
  url: string,
  init: RequestInit,
  adapterConfig: AdapterConfig,
): Promise<Response>
```

It arms an `AbortController` only when `timeoutMs > 0`. On `ok` response it returns immediately. On non-retryable status it throws `LlmRequestError` (carrying the truncated body) without retrying. On retryable status or transient network error it sleeps `retryDelayMs * 2^(attempt-1)` and retries until `maxRetries` is exhausted. On `AbortError` it throws `LlmTimeoutError` once and does not start a second generation. `sleep(ms)` is a thin `setTimeout` wrapper. `readText(res)` delegates to `res.text()` for callers that want the raw body; it does not swallow errors.

The visible source confirms a fail-open caveat for unhandled `fetch` errors: anything that is not `LlmRequestError`, `LlmTimeoutError`, or `AbortError` is treated as a transient network failure and retried up to `maxRetries` times, even though the generation state may already be ambiguous.

## Public surface and factory (index.ts)

<!-- lw:anchors packages/core/src/llm/index.ts#createLlmClient packages/core/src/llm/index.ts#MissingApiKeyError packages/core/src/llm/index.ts#MissingApiKeyError.constructor packages/core/src/llm/index.ts#LlmRequestError packages/core/src/llm/index.ts#LlmRequestError.constructor -->

The exported client interface is intentionally small — only `provider`, `model`, and `generate`. The factory:

```ts
export function createLlmClient(repoRoot: string, config: LivewikiConfig): LlmClient
```

runs `validateConfigForBatch` (which rejects negative or out-of-range `timeoutMs`), then resolves the adapter name, base URL, env var, and preset-derived defaults through `resolveProviderFromConfig`. If the env var is empty it throws:

```ts
constructor(provider: LlmProvider, envVar: string)
```

on `MissingApiKeyError` whose message never contains the key value (there is no key to leak). For Anthropic the factory returns a new `AnthropicAdapter`; for `openai-compat` it returns an `OpenAiCompatAdapter` and forwards `thinkingDefault` and `preferMaxCompletionTokens` from the resolved preset.

HTTP-side failures surface as:

```ts
constructor(provider: LlmProvider, status: number, errorBody: string)
```

on `LlmRequestError`. The constructor truncates `errorBody` to 500 characters and never includes request headers, which is why the message cannot leak the API key. `status: 0` is used internally by `requestWithRetry` to signal "exhausted retries" alongside a textual detail (`"last status: …"`, `"last error: network"`, or `"unknown"`).

## Anthropic adapter

<!-- lw:anchors packages/core/src/llm/anthropic.ts#AnthropicAdapter packages/core/src/llm/anthropic.ts#AnthropicAdapter.constructor packages/core/src/llm/anthropic.ts#AnthropicAdapter.generate packages/core/src/llm/anthropic.ts#normalizeStopReason -->

```ts
export class AnthropicAdapter implements LlmClient
```

constructs with:

```ts
constructor(opts: { apiKey: string; baseUrl: string; model: string; fetchImpl?: typeof fetch; timeoutMs?: number; maxRetries?: number })
```

The constructor stores credentials, base URL, and model on the instance and folds the optional values into an internal `AdapterConfig`, preserving `timeoutMs: 0` via `withTimeoutMs`. `fetchImpl` is only added when present so the global `fetch` is used by default.

`generate` is declared as:

```ts
async generate(req: GenerateRequest): Promise<GenerateResult>
```

It POSTs to `<baseUrl>/v1/messages` with headers `x-api-key`, `anthropic-version: 2023-06-01`, and `content-type: application/json`. The body always contains `model`, `system`, `messages: [{ role: "user", content: req.user }]`, and `max_tokens` (default 4096); `temperature` is included only when set. The response's first `content` block is read when its `type === "text"`; otherwise the adapter returns an empty string. Usage is mapped from `input_tokens` / `output_tokens` to `inputTokens` / `outputTokens`, and the provider's `model` field is preserved (not the requested one) for downstream cost reporting.

The adapter's stop-reason mapping:

```ts
function normalizeStopReason(stopReason: string | null | undefined): StopReason
```

treats `"max_tokens"` as `"length"`, `"end_turn"` and `"stop_sequence"` as `"complete"`, `null`/`undefined` as `"unknown"`, and any other string as `"incomplete"`. The original raw value is preserved on the result as `rawStopReason` only when non-null.

## OpenAI-compatible adapter

<!-- lw:anchors packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter.constructor packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter.generate packages/core/src/llm/openai-compat.ts#normalizeFinishReason packages/core/src/llm/openai-compat.ts#resolveThinkingMode -->

```ts
export class OpenAiCompatAdapter implements LlmClient
```

constructs with:

```ts
constructor(opts: OpenAiCompatAdapterOpts)
```

where `OpenAiCompatAdapterOpts` also accepts `retryDelayMs`, `thinkingDefault`, and `preferMaxCompletionTokens`. The constructor uses `withTimeoutMs(opts.timeoutMs)` and explicit `undefined` checks for `fetchImpl`, `maxRetries`, and `retryDelayMs` so that `0` and explicit omissions are preserved.

`generate` is declared as:

```ts
async generate(req: GenerateRequest): Promise<GenerateResult>
```

It computes the chat-completions URL by stripping trailing slashes from `baseUrl` and appending `/chat/completions` if the URL already ends in `/v1`, otherwise inserting `/v1/chat/completions`. The request body always has `model`, a `messages` array (system + user), and `max_tokens` *or* `max_completion_tokens` (never both) depending on `req.preferMaxCompletionTokens ?? this.preferMaxCompletionTokens`. `temperature` is included only when set.

Thinking is resolved by:

```ts
export function resolveThinkingMode(
  requestThinking: ThinkingMode | undefined,
  adapterDefault: ThinkingMode | "n/a",
  model: string,
): ThinkingMode | "omit"
```

The request's explicit non-`"omit"` value wins; `"omit"` is preserved as-is; otherwise the adapter default is used (`"n/a"` falls back to `"omit"`); otherwise a `minimax-m3` case-insensitive model match forces `"disabled"` so MiniMax chat does not silently engage thinking. When the resolved mode is `"disabled"` or `"adaptive"` the body carries `thinking: { type: <mode> }`; when `"omit"` the field is not sent.

The response is read from `choices[0].message.content` (defaulting to `""` if absent) and usage from `usage.prompt_tokens` / `usage.completion_tokens`, defaulting each to `0` when missing. Stop reason normalization:

```ts
function normalizeFinishReason(finishReason: string | null | undefined): StopReason
```

maps `"length"` → `"length"`, `"stop"` → `"complete"`, `null`/`undefined` → `"unknown"`, and any other string → `"incomplete"`. The raw provider value is preserved on the result as `rawStopReason` only when non-null.

## Adapter test fixtures

<!-- lw:anchors packages/core/src/llm/adapters.test.ts#fakeFetch -->

The shared fixture used by adapter tests is:

```ts
function fakeFetch(response: { status?: number; body?: unknown; ok?: boolean }): typeof fetch
```

It returns a `vi.fn` that resolves a `Response` whose status defaults to `200`, whose `ok` defaults to a 2xx check, and whose body defaults to the JSON-encoded `body` argument or `"{}"`. The fixture always sets `content-type: application/json` on the constructed response, which is why adapter tests can decode the body with `res.json()` and assert on usage fields. It is only used for `OpenAiCompatAdapter` cases in the excerpt; the Anthropic tests build `vi.fn` directly because they need to inspect `init.headers` and `init.body`.