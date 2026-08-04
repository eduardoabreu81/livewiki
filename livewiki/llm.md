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

# LLM client and adapters

The `llm` module is a thin native `fetch`-based HTTP client that exposes a single normalized `LlmClient` interface over Anthropic Messages and OpenAI-compatible Chat Completions providers.

## When to use this page

- **Wire an LLM call into a batch stage** using `createLlmClient` and the `LlmClient.generate` shape.
- **Tune retry, timeout, or `Retry-After` behavior** by reading the `requestWithRetry` policy and its helpers.
- **Map a provider's raw usage and stop signals** to the canonical `LlmUsage` / `StopReason` types used by the rest of the pipeline.
- **Diagnose a thrown `LlmTimeoutError` or `LlmRequestError`** and understand the missing-API-key path.

## How it fits

The `llm` package sits under `packages/core/src/llm` and is consumed by `batch.ts` and any other stage that needs a chat completion. It deliberately avoids SDKs and agent frameworks: adapters are hand-written around native `fetch`, the public surface is the `LlmClient` interface plus a small error/timeout vocabulary, and provider selection is driven by the validated `LivewikiConfig` (preset or legacy `provider`) and the matching env var. Anthropic and OpenAI-compatible transports share a single HTTP/retry/timeout core (`base.ts`), and each adapter owns only request shaping, response parsing, and provider-specific stop-reason normalization. API keys are read only from env vars and are never copied into `config.json`, checkpoints, logs, or error messages.

## Shared HTTP core: retry, timeout, and Retry-After

<!-- lw:anchors packages/core/src/llm/base.ts#DEFAULT_LLM_TIMEOUT_MS packages/core/src/llm/base.ts#LlmTimeoutError packages/core/src/llm/base.ts#LlmTimeoutError.constructor packages/core/src/llm/base.ts#isRetryableStatus packages/core/src/llm/base.ts#parseRetryAfterMs packages/core/src/llm/base.ts#withTimeoutMs packages/core/src/llm/base.ts#requestWithRetry packages/core/src/llm/base.ts#sleep packages/core/src/llm/base.ts#readText -->

The shared core centralizes the per-attempt timeout, exponential-backoff retry on HTTP retryables, and `Retry-After` honoring.

```ts
export const DEFAULT_LLM_TIMEOUT_MS = 300_000;
```

`DEFAULT_LLM_TIMEOUT_MS` is the fallback applied by `requestWithRetry` when `AdapterConfig.timeoutMs` is omitted. It is also re-exported from `llm/index` and asserted directly in tests.

```ts
export class LlmTimeoutError extends Error {
  public readonly provider: LlmProvider;
  public readonly timeoutMs: number;
  constructor(provider: LlmProvider, timeoutMs: number) {
    super(
      timeoutMs > 0
        ? `LLM ${provider} request timed out after ${timeoutMs}ms (client abort; provider may still bill; usage unknown)`
        : `LLM ${provider} request aborted (timeout)`,
    );
    this.name = "LlmTimeoutError";
    this.provider = provider;
    this.timeoutMs = timeoutMs;
  }
}
```

`LlmTimeoutError` carries the provider name and the configured `timeoutMs`. The message distinguishes a positive timeout (provider may still complete and bill) from a `timeoutMs: 0` abort. The error is thrown exactly once — by `requestWithRetry` when an `AbortError` reaches it — and is not retried, because the generation state is unknown.

```ts
function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}
```

`isRetryableStatus` decides whether a non-2xx response triggers another attempt. Only `429` and 5xx (500–599 inclusive) are considered retryable; all other statuses become a single non-retryable `LlmRequestError`.

```ts
function parseRetryAfterMs(res: Response): number | null
```

`parseRetryAfterMs` reads the `Retry-After` header and returns a millisecond delay. Integer-seconds values are the standard form; HTTP-date values are handled defensively and clamped to `>= 0`. Unparseable values (including non-numeric strings) return `null` so the caller falls back to pure exponential backoff. There is no upper cap on the parsed delay.

```ts
export function withTimeoutMs(
  timeoutMs: number | undefined,
): { timeoutMs: number } | Record<string, never>
```

`withTimeoutMs` is a spread helper that preserves `timeoutMs: 0` (which a truthy spread would drop). `undefined` yields an empty object so the field is absent, and any defined number — including `0` — is included verbatim.

```ts
export async function requestWithRetry(
  provider: LlmProvider,
  url: string,
  init: RequestInit,
  adapterConfig: AdapterConfig,
): Promise<Response>
```

`requestWithRetry` runs up to `maxRetries` attempts (default 3) on `fetchImpl ?? globalThis.fetch`. It only attaches an `AbortController` when `timeoutMs > 0`; on abort it throws `LlmTimeoutError` without a second generation. On `429`/`503` it parses `Retry-After` and sleeps `max(exponentialBackoff, retryAfterMs ?? 0)` between attempts; on other retryable 5xx it uses pure exponential backoff (`retryDelayMs * 2^(attempt-1)`, default base 1000 ms). Non-retryable HTTP becomes a single `LlmRequestError`. If every attempt is exhausted on a retryable path, it throws `LlmRequestError(provider, 0, …)` annotated with the last status or last error kind.

```ts
function sleep(ms: number): Promise<void>
```

`sleep` resolves after `ms` milliseconds and is the only delay primitive used by `requestWithRetry` between attempts.

```ts
export async function readText(res: Response): Promise<string>
```

`readText` is a thin wrapper around `res.text()` used by adapters that want to log or inspect response bodies without re-importing the global.

## Anthropic Messages adapter

<!-- lw:anchors packages/core/src/llm/anthropic.ts#AnthropicAdapter packages/core/src/llm/anthropic.ts#AnthropicAdapter.constructor packages/core/src/llm/anthropic.ts#AnthropicAdapter.generate packages/core/src/llm/anthropic.ts#normalizeStopReason -->

The Anthropic adapter targets `POST <baseUrl>/v1/messages` with `x-api-key`, `anthropic-version: 2023-06-01`, and a JSON body of `{ model, system, messages: [{ role: "user", content }], max_tokens, temperature? }`.

```ts
export class AnthropicAdapter implements LlmClient {
  public readonly provider = "anthropic" as const;
  public readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly config: AdapterConfig;

  constructor(opts: { apiKey: string; baseUrl: string; model: string; fetchImpl?: typeof fetch; timeoutMs?: number; maxRetries?: number }) {
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl;
    this.model = opts.model;
    this.config = {
      apiKey: opts.apiKey,
      baseUrl: opts.baseUrl,
      model: opts.model,
      ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
      ...withTimeoutMs(opts.timeoutMs),
      ...(opts.maxRetries !== undefined ? { maxRetries: opts.maxRetries } : {}),
    };
  }
```

The constructor stores the `apiKey`, `baseUrl`, and `model` on the instance and assembles an `AdapterConfig` for the shared core. `fetchImpl`, `maxRetries`, and `timeoutMs` are each spread conditionally; `withTimeoutMs` ensures `timeoutMs: 0` is preserved rather than dropped by a truthy check.

```ts
async generate(req: GenerateRequest): Promise<GenerateResult>
```

`generate` builds the Anthropic Messages payload (defaulting `max_tokens` to `4096` and including `temperature` only when set), POSTs through `requestWithRetry`, then normalizes the response. It picks the first content block whose `type === "text"` for the textual answer, maps `usage.input_tokens` → `inputTokens` and `usage.output_tokens` → `outputTokens`, and records the provider-reported `model` (not the requested one) in usage. When `stop_reason` is non-null it is preserved as `rawStopReason` for checkpoints/diagnostics.

```ts
function normalizeStopReason(stopReason: string | null | undefined): StopReason
```

`normalizeStopReason` maps Anthropic's `stop_reason` to the canonical `StopReason`. `"max_tokens"` becomes `"length"` (truncated by the limit); `"end_turn"` and `"stop_sequence"` become `"complete"`; `null`/`undefined` become `"unknown"`; any other non-null value is treated as `"incomplete"` (for example `"tool_use"`).

## OpenAI-compatible Chat Completions adapter

<!-- lw:anchors packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter.constructor packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter.generate packages/core/src/llm/openai-compat.ts#normalizeFinishReason packages/core/src/llm/openai-compat.ts#resolveThinkingMode -->

The OpenAI-compatible adapter targets `POST <baseUrl>(/v1)/chat/completions` with `Authorization: Bearer <apiKey>`. The constructor accepts preset hints (`thinkingDefault`, `preferMaxCompletionTokens`) that the generator consults when shaping the body.

```ts
export class OpenAiCompatAdapter implements LlmClient {
  public readonly provider = "openai-compat" as const;
  public readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly config: AdapterConfig;
  private readonly thinkingDefault: ThinkingMode | "n/a";
  private readonly preferMaxCompletionTokens: boolean;

  constructor(opts: OpenAiCompatAdapterOpts) {
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl;
    this.model = opts.model;
    this.thinkingDefault = opts.thinkingDefault ?? "omit";
    this.preferMaxCompletionTokens = opts.preferMaxCompletionTokens ?? false;
    this.config = {
      apiKey: opts.apiKey,
      baseUrl: opts.baseUrl,
      model: opts.model,
      ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
      ...withTimeoutMs(opts.timeoutMs),
      ...(opts.maxRetries !== undefined ? { maxRetries: opts.maxRetries } : {}),
      ...(opts.retryDelayMs !== undefined
        ? { retryDelayMs: opts.retryDelayMs }
        : {}),
    };
  }
```

The constructor stores the connection fields and the preset hints, then assembles an `AdapterConfig` for the shared core. `thinkingDefault` defaults to `"omit"` (do not send the `thinking` field) and `preferMaxCompletionTokens` defaults to `false`. As with the Anthropic adapter, `withTimeoutMs` keeps `timeoutMs: 0` intact in the spread.

```ts
async generate(req: GenerateRequest): Promise<GenerateResult>
```

`generate` first normalizes `baseUrl`: a trailing slash is stripped, and if the base already ends in `/v1` (or `/v1/`) the request path is just `/chat/completions`; otherwise `/v1/chat/completions` is appended. It builds a body with `system` + `user` messages and `temperature` only when set. The token-cap field is `max_completion_tokens` when `req.preferMaxCompletionTokens ?? this.preferMaxCompletionTokens` is true, otherwise the legacy `max_tokens` (default value `4096`). The effective `thinking` mode is resolved via `resolveThinkingMode` and serialized as `thinking: { type: "disabled" }` or `thinking: { type: "adaptive" }`; `"omit"` sends no field. The response is mapped to the canonical shape with `prompt_tokens` → `inputTokens` and `completion_tokens` → `outputTokens`, `rawStopReason` retained when present, and `choices[0].message.content` as `content` (defaulting to `""` when absent).

```ts
function normalizeFinishReason(finishReason: string | null | undefined): StopReason
```

`normalizeFinishReason` maps OpenAI's `finish_reason`. `"length"` becomes `"length"`; `"stop"` becomes `"complete"`; `null`/`undefined` becomes `"unknown"`; any other non-null value is treated as `"incomplete"` (for example `"tool_calls"`).

```ts
export function resolveThinkingMode(
  requestThinking: ThinkingMode | undefined,
  adapterDefault: ThinkingMode | "n/a",
  model: string,
): ThinkingMode | "omit"
```

`resolveThinkingMode` picks the effective thinking mode. An explicit non-`"omit"` request value wins; an explicit `"omit"` returns `"omit"` (do not send the field). Otherwise the adapter default is used, treating `"n/a"` as `"omit"`. When the default is `"omit"` and the model name matches `/minimax-m3/i` (case-insensitive), the function returns `"disabled"` so MiniMax-M3 chat does not silently enable thinking for documentation batches. The returned value `"omit"` means the caller will not emit any `thinking` field in the request body.

## Public surface, factory, and errors

<!-- lw:anchors packages/core/src/llm/index.ts#createLlmClient packages/core/src/llm/index.ts#MissingApiKeyError packages/core/src/llm/index.ts#MissingApiKeyError.constructor packages/core/src/llm/index.ts#LlmRequestError packages/core/src/llm/index.ts#LlmRequestError.constructor -->

The module's public entry point is the `LlmClient` interface plus the factory and the typed errors.

```ts
export function createLlmClient(repoRoot: string, config: LivewikiConfig): LlmClient
```

`createLlmClient` is the canonical entry point used by `batch.ts`. It first calls `validateConfigForBatch(repoRoot, config)`, which enforces provider/preset/model presence and validates `timeoutMs`; invalid `timeoutMs` values cause the factory to throw before any client is constructed. It then resolves the provider via `resolveProviderFromConfig` (preset first, legacy `provider` second; absent values surface as `MissingProviderConfigError`) and uses `resolved.baseUrl || resolveBaseUrl(config)` for the base URL. The API key is read from `process.env[resolved.envVar]`; if missing, the factory throws `MissingApiKeyError`. When `config.timeoutMs` is defined it is forwarded verbatim (so `0` disables the abort timer); otherwise the field is omitted and the shared core applies `DEFAULT_LLM_TIMEOUT_MS`. The factory returns a configured `AnthropicAdapter` or `OpenAiCompatAdapter` depending on `resolved.adapter`, forwarding the preset's `thinkingDefault` and `preferMaxCompletionTokens` to the openai-compat path.

```ts
export class MissingApiKeyError extends Error {
  public readonly provider: LlmProvider;
  public readonly envVar: string;
  constructor(provider: LlmProvider, envVar: string) {
    super(
      `Missing API key for provider "${provider}". ` +
        `Set env var ${envVar} before running the batch. ` +
        `Keys never live in config.json, checkpoint_json, logs, or error messages.`,
    );
    this.name = "MissingApiKeyError";
    this.provider = provider;
    this.envVar = envVar;
  }
}
```

`MissingApiKeyError` is thrown only when the resolved env var is empty or unset. Its message names the provider and env var but never references any key value, preserving the rule that keys never appear in logs or error messages.

```ts
export class LlmRequestError extends Error {
  public readonly status: number;
  public readonly provider: LlmProvider;
  public readonly errorBody: string;
  constructor(provider: LlmProvider, status: number, errorBody: string) {
    const truncated = errorBody.length > 500 ? errorBody.slice(0, 500) + "..." : errorBody;
    super(`LLM ${provider} request failed (status ${status}): ${truncated}`);
    this.name = "LlmRequestError";
    this.status = status;
    this.provider = provider;
    this.errorBody = errorBody;
  }
}
```

`LlmRequestError` is thrown for non-retryable HTTP failures and after the retry budget is exhausted on a retryable path (in that case `status` is `0` and the message describes the last status or last error kind). The constructor truncates the provider body to the first 500 characters to keep error messages bounded; the full body remains on the instance as `errorBody`. Auth headers are never included.

## Test support

<!-- lw:anchors packages/core/src/llm/adapters.test.ts#fakeFetch -->

The adapter test file uses a small fake-fetch helper to keep the tests offline.

```ts
function fakeFetch(response: { status?: number; body?: unknown; ok?: boolean }): typeof fetch
```

`fakeFetch` returns a `vi.fn` that resolves with a `Response` whose `status` defaults to `200`, `ok` defaults to `status in [200,300)`, and body is the JSON-serialized `response.body` (or `"{}"` when undefined). It lets a single test drive multiple sequential responses by swapping the implementation returned from a closure, and is the building block for asserting both request shape (headers, URL, body) and response normalization (token field renaming, stop-reason mapping, retry behavior).

<!-- livewiki:navigate:start -->
## Navigate

- [Core batch pipeline and call-graph analytics](core-src-04.md) — dependent
- [Batch stage 5, status aggregation, and surgical repair fixtures](core-src-03.md) — dependency
- [Stage 4 artifact validator and auxiliary page assembly](core-src-02.md) — dependent
<!-- livewiki:navigate:end -->
