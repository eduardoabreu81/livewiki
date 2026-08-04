---
title: LLM client and provider adapters
owner: generated
anchors:
  - packages/core/src/llm/anthropic.ts#AnthropicAdapter
  - packages/core/src/llm/anthropic.ts#AnthropicAdapter.constructor
  - packages/core/src/llm/anthropic.ts#AnthropicAdapter.generate
  - packages/core/src/llm/anthropic.ts#normalizeStopReason
  - packages/core/src/llm/base.ts#DEFAULT_LLM_TIMEOUT_MS
  - packages/core/src/llm/base.ts#LlmTimeoutError
  - packages/core/src/llm/base.ts#LlmTimeoutError.constructor
  - packages/core/src/llm/base.ts#isRetryableStatus
  - packages/core/src/llm/base.ts#parseRetryAfterMs
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

This module owns the thin HTTP client, the shared retry/timeout infrastructure, and the two provider adapters (Anthropic Messages and OpenAI Chat-Completions–compatible) that the batch pipeline calls.

## When to use this page

- **Configure** the LLM client for a batch run by inspecting `createLlmClient` and the factory's preset/provider resolution.
- **Diagnose** HTTP, timeout, or provider-error behavior by reading `requestWithRetry`, `LlmTimeoutError`, and `LlmRequestError`.
- **Extend** to a new provider by following the `LlmClient` interface implemented by `AnthropicAdapter` and `OpenAiCompatAdapter`.
- **Translate** provider-specific stop/finish and usage fields into the canonical shapes by comparing both adapters' `generate` methods and their normalizers.

## How it fits

The `packages/core/src/llm` directory sits under the core package and exposes a minimal, fetch-based LLM client. `createLlmClient` in `index.ts` validates the livewiki config, resolves the provider (preset overrides legacy `config.provider`), reads the API key from a single env var, and returns an `LlmClient` whose `generate` method is the only entry point the batch pipeline (`batch.ts`) needs. Both adapters delegate the actual HTTP work to `requestWithRetry` in `base.ts`, which centralizes per-attempt timeouts, exponential backoff for 429/5xx, `Retry-After` honoring, and normalized error wrapping. The two adapters diverge only in request shape, headers, and the field-level translation of provider JSON into the module's canonical `LlmUsage` and `StopReason` types.

## Diagram

```mermaid
%% livewiki/diagrams/llm.mmd
```

## Public surface and factory

<!-- lw:anchors packages/core/src/llm/index.ts#createLlmClient packages/core/src/llm/index.ts#MissingApiKeyError packages/core/src/llm/index.ts#MissingApiKeyError.constructor packages/core/src/llm/index.ts#LlmRequestError packages/core/src/llm/index.ts#LlmRequestError.constructor -->

The `LlmClient` interface is the only contract the rest of the core package depends on. `createLlmClient` is the entry point:

```ts
export function createLlmClient(repoRoot: string, config: LivewikiConfig): LlmClient
```

It first calls `validateConfigForBatch` so a missing provider or model fails before any HTTP call. It then resolves the adapter and base URL via `resolveProviderFromConfig` / `resolveBaseUrl`, reads the API key from the env var chosen by the preset or adapter, and throws `MissingApiKeyError` when the env var is unset. `timeoutMs` is forwarded only when explicitly set on the config, so `0` (disable) is preserved instead of being truthy-filtered out. The returned client is always an `AnthropicAdapter` or `OpenAiCompatAdapter`.

`MissingApiKeyError` carries the provider and env var name; its message never references the key value (there is none to leak). `LlmRequestError` carries `provider`, `status`, and a truncated `errorBody` (first 500 chars) so messages stay bounded; it never includes request or response headers, which is where the API key would otherwise appear.

## Shared HTTP infrastructure

<!-- lw:anchors packages/core/src/llm/base.ts#DEFAULT_LLM_TIMEOUT_MS packages/core/src/llm/base.ts#LlmTimeoutError packages/core/src/llm/base.ts#LlmTimeoutError.constructor packages/core/src/llm/base.ts#isRetryableStatus packages/core/src/llm/base.ts#parseRetryAfterMs packages/core/src/llm/base.ts#withTimeoutMs packages/core/src/llm/base.ts#requestWithRetry packages/core/src/llm/base.ts#sleep packages/core/src/llm/base.ts#readText -->

`base.ts` owns every network concern. `DEFAULT_LLM_TIMEOUT_MS` is the fallback `timeoutMs` when no override is configured. `LlmTimeoutError` is the dedicated client-side timeout signal; its message distinguishes the "timed out after Nms" case from the meaningless `timeoutMs === 0` path, and it explicitly states that the provider may still complete and bill.

Retry classification is two predicates:

- `isRetryableStatus` returns `true` only for HTTP `429` or any `5xx` (i.e. `status >= 500 && status < 600`).
- `parseRetryAfterMs` reads the `Retry-After` header, supports integer seconds, and falls back to HTTP-date parsing; non-numeric, unparseable headers return `null` so the caller falls back to pure exponential backoff. There is no cap on the parsed delay.

The transport entry point is:

```ts
export async function requestWithRetry(
  provider: LlmProvider,
  url: string,
  init: RequestInit,
  adapterConfig: AdapterConfig,
): Promise<Response>
```

On each attempt it arms an `AbortController` only when `timeoutMs > 0` (so `0` disables the timer), then calls the configured `fetchImpl` (defaulting to `globalThis.fetch`). Success returns immediately. Non-retryable HTTP statuses throw `LlmRequestError` once with the body attached for diagnostics. Retryable statuses sleep for `max(exponentialBackoff, retryAfterMs)` between attempts. The retry loop has a visible non-retry exception: an `AbortError` raised by the timeout is wrapped in `LlmTimeoutError` and `throw`n, so a timed-out generation is never retried — the provider's billing state is unknown. Network errors continue to retry under the existing exponential backoff. After exhausting attempts, the function throws `LlmRequestError` with `status: 0` and a `"Failed after N attempts (last status: ... | last error: network | unknown)"` body. The `LlmTimeoutError` and `LlmRequestError` catches inside the loop re-`throw` before the retry branch, so neither is ever retried.

`withTimeoutMs` is the spread helper that preserves `timeoutMs: 0` (a truthy filter would drop it). `sleep` is a `setTimeout`-based promise. `readText` is a thin async wrapper around `Response.text()` retained for adapters.

## Anthropic adapter

<!-- lw:anchors packages/core/src/llm/anthropic.ts#AnthropicAdapter packages/core/src/llm/anthropic.ts#AnthropicAdapter.constructor packages/core/src/llm/anthropic.ts#AnthropicAdapter.generate packages/core/src/llm/anthropic.ts#normalizeStopReason -->

```ts
export class AnthropicAdapter implements LlmClient {
  constructor(opts: { apiKey: string; baseUrl: string; model: string; fetchImpl?: typeof fetch; timeoutMs?: number; maxRetries?: number }) {
  async generate(req: GenerateRequest): Promise<GenerateResult> {
}
```

`AnthropicAdapter` exposes `provider: "anthropic"` (literal) and `model` as readonly fields. The constructor stores the API key and base URL, then builds an `AdapterConfig` that uses `withTimeoutMs` to forward `timeoutMs` even when it is `0`, and conditional spreads for `fetchImpl` and `maxRetries` so the config object stays minimal.

`generate` targets `POST <baseUrl without trailing slash>/v1/messages` with headers `x-api-key`, `anthropic-version: 2023-06-01`, and `content-type: application/json`. The body shape is `{ model, system, messages: [{ role: "user", content: req.user }], max_tokens: req.maxTokens ?? 4096, [temperature if defined] }`. On success it extracts the first content item's text when it is `type: "text"`, translates `usage.input_tokens` / `usage.output_tokens` to `inputTokens` / `outputTokens`, and reports the provider's `model` field (not the requested one) so cost reporting can see fallbacks or aliases. The raw `stop_reason` is preserved on the result when it is non-null.

`normalizeStopReason` maps Anthropic's vocabulary to the canonical `StopReason`:

- `"max_tokens"` → `"length"`
- `"end_turn"` or `"stop_sequence"` → `"complete"`
- `null` / `undefined` → `"unknown"`
- any other value → `"incomplete"`

## OpenAI-compatible adapter

<!-- lw:anchors packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter.constructor packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter.generate packages/core/src/llm/openai-compat.ts#normalizeFinishReason packages/core/src/llm/openai-compat.ts#resolveThinkingMode -->

```ts
export class OpenAiCompatAdapter implements LlmClient {
  constructor(opts: OpenAiCompatAdapterOpts) {
  async generate(req: GenerateRequest): Promise<GenerateResult> {
}
```

`OpenAiCompatAdapter` exposes `provider: "openai-compat"` (literal) and supports a wider set of per-call knobs via `OpenAiCompatAdapterOpts`: `fetchImpl`, `timeoutMs`, `maxRetries`, `retryDelayMs`, `thinkingDefault`, and `preferMaxCompletionTokens`. The constructor seeds `thinkingDefault` to `"omit"` and `preferMaxCompletionTokens` to `false`, then builds the same shape of `AdapterConfig` as the Anthropic adapter (using `withTimeoutMs` so `0` is preserved).

URL construction rules in `generate`:

- If the base URL already ends with `/v1` (or `/v1/`), the adapter appends `/chat/completions` directly.
- Otherwise it appends `/v1/chat/completions`.

The body is `{ model, messages: [{ role: "system", content: req.system }, { role: "user", content: req.user }], [temperature if defined] }`. Token cap is written as `max_completion_tokens` when `req.preferMaxCompletionTokens` or the adapter's own flag is set, otherwise as the legacy `max_tokens` field. The effective thinking mode is resolved via `resolveThinkingMode`; when the resolved value is `"disabled"` or `"adaptive"`, the body includes `thinking: { type: ... }`. Successful responses are translated with `usage.prompt_tokens`/`completion_tokens` → `inputTokens`/`outputTokens` (defaulting to `0` when absent), and `choices[0].message.content` → `content`. The raw `finish_reason` is preserved when non-null.

`normalizeFinishReason` maps the OpenAI-compatible vocabulary:

- `"length"` → `"length"`
- `"stop"` → `"complete"`
- `null` / `undefined` → `"unknown"`
- any other value → `"incomplete"`

`resolveThinkingMode(requestThinking, adapterDefault, model)` returns the request's value when it is `"disabled"` or `"adaptive"`, returns `"omit"` when the request explicitly sets `"omit"`, and otherwise applies the adapter default (treating `"n/a"` as `"omit"`). If the default is still `"omit"` and the model name matches `/minimax-m3/i` (or `/^minimax-m3$/i`), it returns `"disabled"` — the heuristic that prevents the MiniMax-M3 chat API from enabling thinking by default during the documentation batch. For every other model it returns `"omit"` and the provider's own default applies.

<!-- livewiki:navigate:start -->
## Navigate

- [core indexing, imports, flows, and frontmatter](core-src-04.md) — dependent
- ["Core Source 03: Config, Index, Export, Diagrams, Diff Preview"](core-src-03.md) — dependency
- [Batch orchestration, status reporting, and graph analysis core](core-src-02.md) — dependent
<!-- livewiki:navigate:end -->
