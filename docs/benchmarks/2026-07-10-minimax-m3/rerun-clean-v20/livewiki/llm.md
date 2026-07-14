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

The `llm` module ships the LLM client used by the batch runner: a thin HTTP wrapper over `fetch` plus concrete adapters for Anthropic and OpenAI-compatible providers, with timeout, retry and normalized usage shape.

## When to use this page

- **Wire up** a new batch run by calling `createLlmClient(repoRoot, config)` from `packages/core/src/llm/index.ts` and using the returned `LlmClient.generate` entry point.
- **Add or debug a provider** by reading how `AnthropicAdapter` and `OpenAiCompatAdapter` translate provider-specific request/response shapes into the normalized `GenerateResult`.
- **Diagnose batch failures** by mapping thrown errors to `LlmRequestError`, `LlmTimeoutError`, or `MissingApiKeyError` and consulting `requestWithRetry` retry/abort rules.
- **Tune timeout or retry** behavior by inspecting `DEFAULT_LLM_TIMEOUT_MS`, `withTimeoutMs`, and the `isRetryableStatus` policy in `base.ts`.

## How it fits

The `llm` module lives under `packages/core/src/llm/` and consists of five sibling files: `index.ts` (public surface and factory), `base.ts` (shared HTTP/retry/timeout plumbing and errors), `anthropic.ts` (Anthropic Messages adapter), `openai-compat.ts` (OpenAI-compatible adapter used for OpenAI, OpenRouter, LiteLLM, MiniMax, Ollama cloud, etc.), and `adapters.test.ts` (vitest specs). It re-exports the `GenerateRequest`/`GenerateResult` types from `./types.js` and the `LivewikiConfig`/`LlmProvider` types from `../config.js`. The factory validates config, resolves provider/env-var/baseUrl, reads the API key from the matched env var, and instantiates the matching adapter with timeout options preserved exactly (including `0`). Adapters then delegate the actual HTTP call to `requestWithRetry` in `base.ts`, which owns timeout/retry/error normalization. Tests use `fakeFetch` to intercept requests without touching the network.

## Test fixture: controlled `fetch` stub
<!-- lw:anchors packages/core/src/llm/adapters.test.ts#fakeFetch -->

The test file defines a small helper that returns a function with the shape of `fetch`, configured for a particular status/body/`ok` triple:

```ts
function fakeFetch(response: { status?: number; body?: unknown; ok?: boolean }): typeof fetch
```

Behavior visible in the source:

- If `response.status` is omitted, status defaults to `200`; if `response.ok` is omitted, it is derived as `status >= 200 && status < 300`.
- The body is JSON-stringified when provided, otherwise the helper serializes `"{}"`, and the resulting `Response` always carries `content-type: application/json`.
- The returned function is typed as `typeof fetch` so it can be passed as `fetchImpl` to adapter constructors without casts at the call site (the cast to `unknown as typeof fetch` happens inside `fakeFetch`).

This is the seam the rest of the test suites inject to inspect request URLs, headers, and bodies without contacting any provider.

## Shared HTTP/retry/timeout core
<!-- lw:anchors packages/core/src/llm/base.ts#DEFAULT_LLM_TIMEOUT_MS packages/core/src/llm/base.ts#LlmTimeoutError packages/core/src/llm/base.ts#LlmTimeoutError.constructor packages/core/src/llm/base.ts#isRetryableStatus packages/core/src/llm/base.ts#withTimeoutMs packages/core/src/llm/base.ts#requestWithRetry packages/core/src/llm/base.ts#sleep packages/core/src/llm/base.ts#readText -->

`base.ts` owns everything both adapters share: the default timeout constant, the timeout/abort errors, the retry-aware HTTP helper, and the response/body utility.

```ts
export const DEFAULT_LLM_TIMEOUT_MS = 300_000;
```

When `adapterConfig.timeoutMs` is `undefined`, `requestWithRetry` substitutes `DEFAULT_LLM_TIMEOUT_MS` (5 minutes) before each attempt; a configured `timeoutMs: 0` is honored and disables the abort timer for that attempt.

```ts
export class LlmTimeoutError extends Error {
  constructor(provider: LlmProvider, timeoutMs: number)
}
```

`LlmTimeoutError` records the provider and the configured timeout. The constructor message branches on `timeoutMs > 0` to either report the millisecond budget or simply state the request was aborted. The class is thrown exactly when a fetch attempt rejects with an `Error` whose `name` is `"AbortError"`, so an aborted generation is *not* automatically retried (it cannot be safely assumed the provider did not partially bill).

```ts
function isRetryableStatus(status: number): boolean
```

The retryable-HTTP predicate returns `true` only for `429` or for statuses in the `[500, 600)` range; other 4xx responses are surfaced as `LlmRequestError` from the first attempt, as enforced by the test that asserts a 401 produces a single fetch call.

```ts
export function withTimeoutMs(
  timeoutMs: number | undefined,
): { timeoutMs: number } | Record<string, never>
```

`withTimeoutMs` exists because plain truthy spreads drop `0`, and "disable the automatic abort" is a documented configuration the adapters must preserve verbatim. It returns `{ timeoutMs }` when the argument is defined and `{}` otherwise, so adapter constructors can spread the result into their internal config without losing the explicit `0`.

```ts
export async function requestWithRetry(
  provider: LlmProvider,
  url: string,
  init: RequestInit,
  adapterConfig: AdapterConfig,
): Promise<Response>
```

`requestWithRetry` loops up to `adapterConfig.maxRetries ?? 3` times. On each iteration:

- It builds a fresh `AbortController` and only attaches a `setTimeout` when `timeoutMs > 0`; the timer is cleared in the `finally` block.
- A `Response` whose `ok` is true is returned immediately. A response whose status is not retryable is converted into a `LlmRequestError` with the body captured for diagnostics, and re-thrown.
- `lastStatus` is recorded on retryable responses and the body is drained with `await res.text().catch(() => "")` before sleeping for `retryDelayMs * Math.pow(2, attempt - 1)`.
- A thrown `LlmRequestError` or `LlmTimeoutError` is re-thrown immediately. An `AbortError` becomes a fresh `LlmTimeoutError` (no retry). Other thrown errors are treated as network errors, recorded in `lastErrorKind`, and retried up to the limit.
- When the loop exits without success, the helper throws a `LlmRequestError` whose body describes the attempt count plus the last observed status or `"network"`.

This single helper is what enforces the timeout-vs-retry asymmetry cited in the test "AbortError makes only one call even with `maxRetries: 3`".

```ts
function sleep(ms: number): Promise<void>
```

`sleep` resolves after `ms` milliseconds via `setTimeout`; it is only used inside `requestWithRetry` for exponential backoff between attempts on retryable statuses or network errors.

```ts
export async function readText(res: Response): Promise<string>
```

`readText` is a thin pass-through to `Response.text()`; the excerpt does not show callers consuming it, so this documents only its public signature.

## Anthropic Messages adapter
<!-- lw:anchors packages/core/src/llm/anthropic.ts#AnthropicAdapter packages/core/src/llm/anthropic.ts#AnthropicAdapter.constructor packages/core/src/llm/anthropic.ts#AnthropicAdapter.generate packages/core/src/llm/anthropic.ts#normalizeStopReason -->

```ts
export class AnthropicAdapter implements LlmClient {
  constructor(opts: { apiKey: string; baseUrl: string; model: string; fetchImpl?: typeof fetch; timeoutMs?: number; maxRetries?: number })
  async generate(req: GenerateRequest): Promise<GenerateResult>
}
```

The class exposes `provider = "anthropic"` (literal) plus the configured `model`, and stores `apiKey`, `baseUrl`, and an `AdapterConfig` snapshot (`apiKey`, `baseUrl`, `model`, optional `fetchImpl`, the result of `withTimeoutMs(opts.timeoutMs)`, and an optional `maxRetries`). The constructor uses the same `withTimeoutMs` spread discipline as `OpenAiCompatAdapter` so an explicit `timeoutMs: 0` disables the per-attempt abort.

`generate` builds the URL `${baseUrl.replace(/\/$/, "")}/v1/messages`, then assembles a body with `model`, `system`, a single `{ role: "user", content: req.user }` message, `max_tokens` defaulting to `4096`, and an optional `temperature` when defined on the request. The headers are exactly `x-api-key`, `anthropic-version: "2023-06-01"`, and `content-type: application/json`. The actual HTTP call goes through `requestWithRetry` with `this.provider` and `this.config`, so timeout/retry semantics match the shared helper. The response is parsed as `AnthropicResponse` and reduced into `GenerateResult`:

- `content` is the `text` of the first `content` array entry when its `type === "text"`; otherwise it is the empty string.
- `usage` maps `input_tokens` → `inputTokens`, `output_tokens` → `outputTokens`, plus the provider's `model`.
- `stopReason` is computed via `normalizeStopReason`.
- A non-null `raw.stop_reason` is preserved as `rawStopReason`.

```ts
function normalizeStopReason(stopReason: string | null | undefined): StopReason
```

Maps Anthropic `stop_reason` values:

- `"max_tokens"` → `"length"`.
- `"end_turn"` or `"stop_sequence"` → `"complete"`.
- `null` or `undefined` → `"unknown"`.
- Anything else (including `"tool_use"`, but also any unanticipated provider string) falls through to `"incomplete"`. This preserves the raw value in `rawStopReason` rather than losing the original signal.

## OpenAI-compatible adapter
<!-- lw:anchors packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter.constructor packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter.generate packages/core/src/llm/openai-compat.ts#normalizeFinishReason packages/core/src/llm/openai-compat.ts#resolveThinkingMode -->

```ts
export class OpenAiCompatAdapter implements LlmClient {
  constructor(opts: OpenAiCompatAdapterOpts)
  async generate(req: GenerateRequest): Promise<GenerateResult>
}
```

The adapter exposes `provider = "openai-compat"` (literal) and the configured `model`, plus private `apiKey`, `baseUrl`, and `config: AdapterConfig`. Its extra configuration beyond the Anthropic adapter is `thinkingDefault: ThinkingMode | "n/a"` (default `"omit"`) and `preferMaxCompletionTokens: boolean` (default `false`). As with `AnthropicAdapter`, the constructor uses `withTimeoutMs` to preserve an explicit `timeoutMs: 0`, and spreads `fetchImpl`, `maxRetries`, and `retryDelayMs` only when defined so disable-style values round-trip safely.

```ts
function normalizeFinishReason(finishReason: string | null | undefined): StopReason
```

Maps OpenAI-style `finish_reason` values:

- `"length"` → `"length"`.
- `"stop"` → `"complete"`.
- `null` or `undefined` → `"unknown"`.
- Anything else (for example `"tool_calls"`, or any future provider string) → `"incomplete"`, while the raw value stays on the result as `rawStopReason`.

```ts
export function resolveThinkingMode(
  requestThinking: ThinkingMode | undefined,
  adapterDefault: ThinkingMode | "n/a",
  model: string,
): ThinkingMode | "omit"
```

Resolves the effective thinking mode for an outgoing Chat Completions body. Precedence visible in the source:

1. If `requestThinking` is a non-`"omit"` value (`"disabled"` or `"adaptive"`), it wins.
2. If `requestThinking === "omit"`, the adapter returns `"omit"` (the API is allowed to behave with its own default).
3. Otherwise the adapter default is consulted. `"n/a"` is treated as `"omit"`. `"disabled"`/`"adaptive"` are returned as-is. `"omit"` falls through to the heuristic.
4. The heuristic enables `"disabled"` for any model whose name matches the `minimax-m3` regex (case-insensitive), which is the documented behavior used to suppress the default-on thinking in MiniMax chat. For all other models it returns `"omit"`.

`generate` builds the URL by stripping a trailing `/` from `baseUrl`, then choosing between `${base}/chat/completions` (when the base already ends in `/v1` or `/v1/`) and `${base}/v1/chat/completions` so callers can pass either an OpenAI-style base or a generic base that owns its own versioning. The body uses `[system, user]` messages, an optional `temperature`, and picks the right token-budget field per request:

- `preferMaxCompletion` is `req.preferMaxCompletionTokens ?? this.preferMaxCompletionTokens`. When true, the body sets `max_completion_tokens`; otherwise it sets `max_tokens`. The test "sends `thinking.disabled` and `max_completion_tokens` for MiniMax-M3 defaults" pins `max_completion_tokens` to `8000` and asserts `max_tokens` is absent in that path.
- `resolveThinkingMode` decides whether to attach `body.thinking`. `"disabled"` becomes `{ type: "disabled" }`; `"adaptive"` becomes `{ type: "adaptive" }`; `"omit"` skips the field entirely.

The HTTP call delegates to `requestWithRetry` (same timeout/retry contract as the Anthropic adapter) with `Authorization: Bearer <redacted> and `content-type: application/json`. The parsed response is reduced to `GenerateResult`:

- `content` defaults to `""` when the first choice has no `message.content`.
- `usage` maps `prompt_tokens` → `inputTokens`, `completion_tokens` → `outputTokens`, plus the provider's `model`. Missing usage fields default to `0` via the `?? 0` chain.
- `stopReason` comes from `normalizeFinishReason` on `choices[0].finish_reason`, and the raw `finish_reason` is preserved on the result when non-null.

## Public surface and errors
<!-- lw:anchors packages/core/src/llm/index.ts#createLlmClient packages/core/src/llm/index.ts#MissingApiKeyError packages/core/src/llm/index.ts#MissingApiKeyError.constructor packages/core/src/llm/index.ts#LlmRequestError packages/core/src/llm/index.ts#LlmRequestError.constructor -->

```ts
export function createLlmClient(repoRoot: string, config: LivewikiConfig): LlmClient
```

The factory is the single integration point for the batch runner. It runs `validateConfigForBatch(repoRoot, config)` first, so missing `provider`/`preset` or `model` surface as `MissingProviderConfigError` before any network code runs. It then resolves the active provider via `resolveProviderFromConfig(config)`, which is responsible for combining legacy `config.provider` and the newer `config.preset` (presets may override `adapter`, `baseUrl`, `envVar`, `thinkingDefault`, and `preferMaxCompletionTokens`). `baseUrl` prefers an explicit setting, falling back to the preset's `baseUrl`, then `resolveBaseUrl(config)`. The API key is read strictly from `process.env[resolved.envVar]`; if it is missing or empty, the helper throws `MissingApiKeyError`. Finally the factory chooses the concrete adapter:

- `resolved.adapter === "anthropic"` → `new AnthropicAdapter({ apiKey, baseUrl, model, ...timeoutOpts })`.
- Otherwise (the documented path covers `"openai-compat"`) → `new OpenAiCompatAdapter({ apiKey, baseUrl, model, thinkingDefault: resolved.thinkingDefault, preferMaxCompletionTokens: resolved.preferMaxCompletionTokens, ...timeoutOpts })`.

`timeoutOpts` is `{ timeoutMs: config.timeoutMs }` only when `config.timeoutMs !== undefined`, so a configured `timeoutMs: 0` (disable) is forwarded intact.

```ts
export class MissingApiKeyError extends Error {
  constructor(provider: LlmProvider, envVar: string)
}
```

`MissingApiKeyError` records the provider and the env var name. Its message names both but never the key value, reflecting the rule that keys must never appear in logs, checkpoints, config, or error messages.

```ts
export class LlmRequestError extends Error {
  constructor(provider: LlmProvider, status: number, errorBody: string)
}
```

`LlmRequestError` carries the provider, the HTTP status (or `0` when the loop exhausted on network errors), and the captured provider body. The message truncates `errorBody` to 500 characters and appends `"..."` if it was longer, so a runaway provider body cannot blow up a stack trace or log file. This is the error class that surfaces from non-retryable HTTP responses and from the exhausted-retry path of `requestWithRetry`.

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
- [Core pipeline orchestration, config, schema, and helpers](core-src-02.md) — dependency and dependent
- [anchor ledger, artifact validation, and batch status](core-src-01.md) — dependent
<!-- livewiki:navigate:end -->
