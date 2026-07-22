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

This page documents the thin HTTP client, factory, and provider adapters used to talk to LLM providers from the core package.

## When to use this page

- **Configure** provider credentials and timeouts via `createLlmClient` and the shared base helpers.
- **Diagnose** request failures by reading `LlmRequestError`, `LlmTimeoutError`, and the retry policy in `requestWithRetry`.
- **Extend** provider support by mirroring the `AnthropicAdapter` or `OpenAiCompatAdapter` shape against the shared `AdapterConfig`.
- **Normalize** usage and stop reasons into the canonical `GenerateResult` returned to the rest of the codebase.

## How it fits

The `llm` directory under `packages/core/src` provides the only LLM entry point used by batch orchestration. `createLlmClient` validates configuration through `config.ts`, reads the provider API key from the environment (never from config files or logs), and returns an `LlmClient` implemented by `AnthropicAdapter` or `OpenAiCompatAdapter`. Both adapters delegate the actual HTTP work — including timeouts, retries, and error normalization — to `base.ts`, so provider-specific code stays focused on request shape and response parsing. Shared types live in `types.ts` and are re-exported from `index.ts`.

## Shared HTTP layer and retry policy
<!-- lw:anchors packages/core/src/llm/base.ts#DEFAULT_LLM_TIMEOUT_MS packages/core/src/llm/base.ts#LlmTimeoutError packages/core/src/llm/base.ts#LlmTimeoutError.constructor packages/core/src/llm/base.ts#isRetryableStatus packages/core/src/llm/base.ts#requestWithRetry packages/core/src/llm/base.ts#sleep packages/core/src/llm/base.ts#withTimeoutMs packages/core/src/llm/base.ts#readText -->

The shared base layer centralizes timeouts, retry, and error shaping so adapters do not duplicate that logic.

`DEFAULT_LLM_TIMEOUT_MS` is the default per-attempt timeout when an adapter config omits `timeoutMs`:

```ts
export const DEFAULT_LLM_TIMEOUT_MS = 300_000;
```

`LlmTimeoutError` is raised when a client-side abort fires. It records the provider and the configured timeout so callers can distinguish a timeout from a provider-side rejection:

```ts
constructor(provider: LlmProvider, timeoutMs: number) {
```

Timeouts are deliberately **not retried** by `requestWithRetry`: once an abort fires, the generation state on the provider side is unknown and the provider may still bill. The constructor message reflects this when `timeoutMs > 0`; for `timeoutMs === 0` it reports an aborted request without the timing detail.

`requestWithRetry` runs the loop and routes errors:

```ts
export async function requestWithRetry(
```

- It arms an `AbortController` only when `timeoutMs > 0`, so `timeoutMs: 0` is honored as "disable automatic abort" (used for local providers with very long generations).
- A successful response returns immediately.
- A non-retryable HTTP status throws `LlmRequestError` once, including the response body for diagnostics.
- HTTP `429` or any `5xx` (filtered through `isRetryableStatus`) is retried up to `maxRetries`, with exponential backoff seeded by `retryDelayMs`.
- An `AbortError` is converted into `LlmTimeoutError` and propagated without a second attempt.
- Network errors keep the existing retry behavior; if the loop exits without success, a final `LlmRequestError` carries the last observed status or a "last error: network" note.

`withTimeoutMs` exists so adapters can spread `timeoutMs: 0` without losing it to a truthy check:

```ts
export function withTimeoutMs(
  timeoutMs: number | undefined,
): { timeoutMs: number } | Record<string, never>
```

Supporting helpers in this layer include `sleep` (delay used between retry attempts), `readText` (typed wrapper around `Response.text`), and the unexported `isRetryableStatus` predicate used inside `requestWithRetry`.

## Anthropic provider adapter
<!-- lw:anchors packages/core/src/llm/anthropic.ts#AnthropicAdapter packages/core/src/llm/anthropic.ts#AnthropicAdapter.constructor packages/core/src/llm/anthropic.ts#AnthropicAdapter.generate packages/core/src/llm/anthropic.ts#normalizeStopReason -->

`AnthropicAdapter` implements `LlmClient` for the Anthropic Messages API and normalizes its responses into the canonical `GenerateResult` shape.

```ts
constructor(opts: { apiKey: string; baseUrl: string; model: string; fetchImpl?: typeof fetch; timeoutMs?: number; maxRetries?: number }) {
```

The constructor stores the API key, base URL, and model, and assembles an `AdapterConfig` using `withTimeoutMs` so `timeoutMs: 0` survives the spread. Optional `fetchImpl` and `maxRetries` are only included when provided.

```ts
async generate(req: GenerateRequest): Promise<GenerateResult> {
```

`generate` posts to `${baseUrl}/v1/messages` with headers `x-api-key`, `anthropic-version: 2023-06-01`, and `content-type: application/json`. The body includes `model`, `system`, a single user message containing `req.user`, and `max_tokens` (default `4096`); `temperature` is added only when supplied. After the response is parsed, usage is mapped from `input_tokens` / `output_tokens` to `inputTokens` / `outputTokens`, and the Anthropic stop reason is normalized through `normalizeStopReason`.

`normalizeStopReason` maps Anthropic stop reasons onto the canonical union:

```ts
function normalizeStopReason(stopReason: string | null | undefined): StopReason {
```

- `"max_tokens"` → `"length"`
- `"end_turn"` or `"stop_sequence"` → `"complete"`
- `null` or `undefined` → `"unknown"`
- Any other non-null value → `"incomplete"`

The original Anthropic `stop_reason` is preserved on the result as `rawStopReason` when it is not null.

## OpenAI-compatible provider adapter
<!-- lw:anchors packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter.constructor packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter.generate packages/core/src/llm/openai-compat.ts#normalizeFinishReason packages/core/src/llm/openai-compat.ts#resolveThinkingMode -->

`OpenAiCompatAdapter` targets OpenAI Chat Completions and any compatible endpoint (OpenRouter, LiteLLM, MiniMax chat, Ollama cloud, etc.).

```ts
constructor(opts: OpenAiCompatAdapterOpts) {
```

The constructor records the API key, base URL, model, the `thinkingDefault` (default `"omit"`), and `preferMaxCompletionTokens` (default `false`). The `AdapterConfig` is built with the same `withTimeoutMs` discipline used by `AnthropicAdapter`, plus optional `maxRetries` and `retryDelayMs` fields.

```ts
async generate(req: GenerateRequest): Promise<GenerateResult> {
```

`generate` chooses the request URL based on whether the configured `baseUrl` already ends with `/v1`; it appends `/chat/completions` directly, otherwise it inserts `/v1/chat/completions`. The body always sends a `system` and `user` message pair, optionally adds `temperature`, and picks one of `max_tokens` or `max_completion_tokens` for the output cap based on `req.preferMaxCompletionTokens ?? this.preferMaxCompletionTokens`. Headers carry `authorization: Bearer <apiKey>` and `content-type: application/json`. Usage is normalized from `prompt_tokens` / `completion_tokens`, and the response finish reason is normalized through `normalizeFinishReason`.

`normalizeFinishReason` mirrors the Anthropic helper but for OpenAI-style fields:

```ts
function normalizeFinishReason(finishReason: string | null | undefined): StopReason {
```

- `"length"` → `"length"`
- `"stop"` → `"complete"`
- `null` or `undefined` → `"unknown"`
- Any other value → `"incomplete"`

`resolveThinkingMode` decides whether to attach `thinking` to the request body:

```ts
export function resolveThinkingMode(
  requestThinking: ThinkingMode | undefined,
  adapterDefault: ThinkingMode | "n/a",
  model: string,
): ThinkingMode | "omit"
```

It honors an explicit `requestThinking` (including `"omit"`), falls back to the adapter default, and as a last resort applies a `MiniMax-M3` heuristic that forces `thinking: { type: "disabled" }` so batch runs against MiniMax chat do not silently enable reasoning by default.

## Factory and public errors
<!-- lw:anchors packages/core/src/llm/index.ts#createLlmClient packages/core/src/llm/index.ts#MissingApiKeyError packages/core/src/llm/index.ts#MissingApiKeyError.constructor packages/core/src/llm/index.ts#LlmRequestError packages/core/src/llm/index.ts#LlmRequestError.constructor -->

`createLlmClient` is the public entry point that callers such as `batch.ts` use to obtain an `LlmClient`:

```ts
export function createLlmClient(repoRoot: string, config: LivewikiConfig): LlmClient
```

The factory first calls `validateConfigForBatch` (which rejects invalid `timeoutMs` values such as negatives or values above `2_147_483_647`). It then resolves the provider through `resolveProviderFromConfig`, picks a `baseUrl` from the config or the provider default, and reads the API key from the env var named by the resolved configuration (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY` for legacy providers, or the preset-specific env var). The `timeoutMs` from config is forwarded to the adapter only when it is explicitly defined, so `0` keeps its "disable abort" meaning. The chosen adapter is instantiated with `thinkingDefault` and `preferMaxCompletionTokens` for the OpenAI-compatible path.

`MissingApiKeyError` is thrown when the required env var is not set:

```ts
constructor(provider: LlmProvider, envVar: string) {
```

Its message names the provider and the env var to set, and explicitly states that keys never live in `config.json`, checkpoint JSON, logs, or error messages — so the absence of a key never leaks a value (there is none to leak).

`LlmRequestError` is thrown for HTTP failures and exhausted retries:

```ts
constructor(provider: LlmProvider, status: number, errorBody: string) {
```

The constructor truncates `errorBody` to 500 characters before formatting the message, and never includes request headers (which carry the API key). The final `LlmRequestError` raised by `requestWithRetry` uses `status: 0` when no HTTP response was ever observed, encoding the retry exhaustion in the body instead.

## Test utilities
<!-- lw:anchors packages/core/src/llm/adapters.test.ts#fakeFetch -->

`fakeFetch` is the test-only fetch replacement used across the adapter and timeout suites:

```ts
function fakeFetch(response: { status?: number; body?: unknown; ok?: boolean }): typeof fetch {
```

It returns a `vi.fn` that resolves with a `Response` whose status defaults to `200`, whose `ok` is inferred from the status when not supplied, and whose body is the JSON serialization of the provided `body` (default `"{}"`). The helper exists so adapter tests can assert on request shape without standing up a real HTTP server.

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
- [Batch orchestration, configuration, index, and diagram generation](core-src-03.md) — dependency and dependent
- [livewiki core index, init, and import-resolution internals](core-src-05.md) — dependent
- [Batch test fixtures, state types, and status aggregation](core-src-02.md) — dependent
<!-- livewiki:navigate:end -->
