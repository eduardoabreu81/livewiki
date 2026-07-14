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

Provider-agnostic HTTP adapters for LLM-backed batch runs. The module ships two concrete adapters (`AnthropicAdapter`, `OpenAiCompatAdapter`) wired to a shared transport in `base.ts`, plus a public factory and normalized error types in `index.ts`. Tests live in `adapters.test.ts`.

## Tests
<!-- lw:anchors packages/core/src/llm/adapters.test.ts#fakeFetch -->

`adapters.test.ts` exercises both adapters and the shared retry/timeout machinery. The module-scoped `fakeFetch` helper builds a `vi.fn` that resolves to a controlled `Response` so tests can drive status, body, and `ok` flags without a real network.

```ts
function fakeFetch(response: { status?: number; body?: unknown; ok?: boolean }): typeof fetch {
  return vi.fn(async () => {
    const status = response.status ?? 200;
    const ok = response.ok ?? (status >= 200 && status < 300);
    const bodyText = response.body !== undefined ? JSON.stringify(response.body) : "{}";
    return new Response(bodyText, {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}
```

Behaviour observable from tests: `fakeFetch` defaults to `status 200` and treats `200–299` as `ok`; when `body` is provided it is JSON-encoded with an `application/json` content-type. Tests using it include Anthropic/Anthropic-side normalization cases, the OpenAI-compat `baseUrl` that already ends in `/v1`, finish-reason normalization, and the 429-then-200 retry-then-success scenario.

## Anthropic adapter
<!-- lw:anchors packages/core/src/llm/anthropic.ts#AnthropicAdapter packages/core/src/llm/anthropic.ts#AnthropicAdapter.constructor packages/core/src/llm/anthropic.ts#AnthropicAdapter.generate packages/core/src/llm/anthropic.ts#normalizeStopReason -->

`AnthropicAdapter` implements `LlmClient` against the Anthropic Messages endpoint and is constructed with an options object. The constructor stores `apiKey`, `baseUrl`, `model`, and composes an internal `AdapterConfig` using `withTimeoutMs` so `timeoutMs: 0` (disable abort) is preserved across the spread.

```ts
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

`generate` POSTs to `${baseUrl}/v1/messages` with `x-api-key`, `anthropic-version: 2023-06-01`, and a body containing `model`, `system`, a single user message, and `max_tokens` (default `4096`, with optional `temperature`). It delegates the HTTP call to `requestWithRetry` and then translates the response: it pulls the first text block, maps `input_tokens`/`output_tokens` to `inputTokens`/`outputTokens`, and normalizes `stop_reason` via `normalizeStopReason`. When the raw `stop_reason` is non-null it is preserved under `rawStopReason`.

`normalizeStopReason` maps `max_tokens → length`, `end_turn`/`stop_sequence → complete`, `null/undefined → unknown`, and falls back to `incomplete` for any other non-null value, preserving unknown values safely rather than throwing.

```ts
function normalizeStopReason(stopReason: string | null | undefined): StopReason {
  if (stopReason === "max_tokens") return "length";
  if (stopReason === "end_turn" || stopReason === "stop_sequence") return "complete";
  if (stopReason == null) return "unknown";
  return "incomplete";
}
```

## Public surface and factory
<!-- lw:anchors packages/core/src/llm/index.ts#createLlmClient packages/core/src/llm/index.ts#LlmRequestError packages/core/src/llm/index.ts#LlmRequestError.constructor packages/core/src/llm/index.ts#MissingApiKeyError packages/core/src/llm/index.ts#MissingApiKeyError.constructor -->

`createLlmClient(repoRoot, config)` is the single entry point used by callers such as the batch runner. It runs `validateConfigForBatch` first, then resolves the provider/model via `resolveProviderFromConfig`, picks a `baseUrl`, reads the API key from the env var chosen by the preset (e.g. `MiniMax_API_KEY`) or legacy `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`, and throws `MissingApiKeyError` if that env var is absent. `timeoutMs` is forwarded via an explicit `undefined` check so a configured `0` (disable abort) is preserved.

```ts
export function createLlmClient(repoRoot: string, config: LivewikiConfig): LlmClient {
  validateConfigForBatch(repoRoot, config);
  const resolved = resolveProviderFromConfig(config);
  const model = config.model as string;
  const baseUrl = resolved.baseUrl || resolveBaseUrl(config);
  const apiKey = process.env[resolved.envVar];
  if (!apiKey) {
    throw new MissingApiKeyError(resolved.adapter, resolved.envVar);
  }
  const timeoutOpts =
    config.timeoutMs !== undefined ? { timeoutMs: config.timeoutMs } : {};
  if (resolved.adapter === "anthropic") {
    return new AnthropicAdapter({ apiKey, baseUrl, model, ...timeoutOpts });
  }
  return new OpenAiCompatAdapter({
    apiKey,
    baseUrl,
    model,
    thinkingDefault: resolved.thinkingDefault,
    preferMaxCompletionTokens: resolved.preferMaxCompletionTokens,
    ...timeoutOpts,
  });
}
```

`MissingApiKeyError` is constructed with the resolved `provider` (adapter name) and `envVar`; its message never mentions a key value and tells callers that keys never live in `config.json`, `checkpoint_json`, logs, or error messages. `LlmRequestError` carries `provider`, `status`, and `errorBody`; its message truncates the body at 500 chars so a giant provider payload cannot be dumped into logs.

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

`index.ts` re-exports `LlmTimeoutError` and `DEFAULT_LLM_TIMEOUT_MS` from `base.ts`, alongside the `GenerateRequest`, `GenerateResult`, `LlmUsage`, and `StopReason` types.

## Shared transport (base.ts)
<!-- lw:anchors packages/core/src/llm/base.ts#DEFAULT_LLM_TIMEOUT_MS packages/core/src/llm/base.ts#LlmTimeoutError packages/core/src/llm/base.ts#LlmTimeoutError.constructor packages/core/src/llm/base.ts#isRetryableStatus packages/core/src/llm/base.ts#withTimeoutMs packages/core/src/llm/base.ts#requestWithRetry packages/core/src/llm/base.ts#sleep packages/core/src/llm/base.ts#readText -->

`base.ts` centralizes the HTTP wrapper, retry policy, and timeout/abort policy so providers stay thin.

`DEFAULT_LLM_TIMEOUT_MS` is `300_000` (5 min); it is the fallback applied when an adapter's `timeoutMs` is `undefined`. Setting `timeoutMs: 0` disables the automatic abort entirely (used for local providers that may exceed 5 minutes), and `timeoutMs > 0` arms an `AbortController` per attempt.

`LlmTimeoutError` extends `Error`, captures `provider` and `timeoutMs`, and produces a message that is honest about partial state: "client abort; provider may still bill; usage unknown". This is the contract that forbids automatic retry on abort — generation state is unknown and a second attempt could double-bill.

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

`withTimeoutMs` is the spread helper that survives `0`: it returns `{ timeoutMs: 0 }` when called with `0`, `{}` when called with `undefined`, and `{ timeoutMs: n }` for `n > 0`. This is the workaround against dropping a falsy-but-meaningful value through a truthy spread.

```ts
export function withTimeoutMs(
  timeoutMs: number | undefined,
): { timeoutMs: number } | Record<string, never> {
  return timeoutMs !== undefined ? { timeoutMs } : {};
}
```

`requestWithRetry` is the only function that calls `fetch`. It runs up to `maxRetries` attempts (default `3`) for HTTP 429 and 5xx, with exponential backoff (`retryDelayMs * 2^(attempt-1)`, default base `1000`). Non-retryable HTTP statuses are wrapped once in `LlmRequestError`. An `AbortError` is converted to `LlmTimeoutError` and rethrown without retry — there is no second generation after a client-side abort. Network errors fall through to the normal retry path, which is documented as a known unknown-state risk. When all attempts are exhausted, the function throws `LlmRequestError(provider, 0, "Failed after N attempts (last status: S | last error: network | unknown)")`.

```ts
export async function requestWithRetry(
  provider: LlmProvider,
  url: string,
  init: RequestInit,
  adapterConfig: AdapterConfig,
): Promise<Response> {
  const fetchImpl = adapterConfig.fetchImpl ?? globalThis.fetch;
  const timeoutMs =
    adapterConfig.timeoutMs !== undefined ? adapterConfig.timeoutMs : DEFAULT_LLM_TIMEOUT_MS;
  const maxRetries = adapterConfig.maxRetries ?? 3;
  const retryDelayMs = adapterConfig.retryDelayMs ?? 1000;
  // ... loop: arm controller only when timeoutMs > 0, ok → return,
  // non-retryable → LlmRequestError, retryable → backoff and retry,
  // AbortError → LlmTimeoutError (no retry), exhausted → LlmRequestError
}
```

`isRetryableStatus` is the retry classifier: `true` for `429` and any `5xx`, `false` otherwise. `sleep(ms)` is a `setTimeout`-based `Promise<void>` used as the backoff primitive. `readText` is a thin pass-through to `res.text()` exposed for callers that want a normalized body-extraction step.

## OpenAI-compatible adapter
<!-- lw:anchors packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter.constructor packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter.generate packages/core/src/llm/openai-compat.ts#normalizeFinishReason packages/core/src/llm/openai-compat.ts#resolveThinkingMode -->

`OpenAiCompatAdapter` targets the OpenAI Chat Completions shape and covers OpenAI, OpenRouter, LiteLLM, MiniMax chat, Ollama cloud, and any other provider that accepts the same `/v1/chat/completions` endpoint and `Authorization: Bearer` header. The provider tag is the literal `"openai-compat"`.

The constructor stores `apiKey`, `baseUrl`, `model`, `thinkingDefault` (defaults to `"omit"`), and `preferMaxCompletionTokens` (defaults to `false`). It composes `AdapterConfig` with `withTimeoutMs` to preserve a configured `0`, exactly as `AnthropicAdapter` does.

```ts
async generate(req: GenerateRequest): Promise<GenerateResult> {
  const base = this.baseUrl.replace(/\/$/, "");
  const url =
    base.endsWith("/v1") || base.endsWith("/v1/")
      ? `${base}/chat/completions`
      : `${base}/v1/chat/completions`;
  // ...
}
```

The URL builder avoids duplicating `/v1`: a `baseUrl` ending in `/v1` (or `/v1/`) gets `/chat/completions` appended, otherwise `/v1/chat/completions` is appended. This is observable in the `baseUrl` test that uses `https://proxy.example.com/v1`.

`generate` builds a body with `model`, a `system` + `user` message pair, and optional `temperature`. Token cap is selected per request and adapter preference:

```ts
if (preferMaxCompletion) {
  body.max_completion_tokens = maxOut;
} else {
  body.max_tokens = maxOut;
}
```

`preferMaxCompletionTokens` is taken from `req.preferMaxCompletionTokens ?? this.preferMaxCompletionTokens`, then `resolveThinkingMode` decides whether to attach a `thinking` object. The Authorization header is `Bearer <apiKey>`. The HTTP layer is delegated to `requestWithRetry`, the same wrapper used by Anthropic. Response mapping: `choices[0].message.content` becomes `content`, `prompt_tokens`/`completion_tokens` become `inputTokens`/`outputTokens`, the response's `model` field is preserved in usage, and the raw `finish_reason` is preserved under `rawStopReason` when non-null.

`normalizeFinishReason` maps `length → length`, `stop → complete`, `null/undefined → unknown`, and falls through to `incomplete` for any other non-null value — same safe-preservation pattern as Anthropic's `normalizeStopReason`.

```ts
function normalizeFinishReason(finishReason: string | null | undefined): StopReason {
  if (finishReason === "length") return "length";
  if (finishReason === "stop") return "complete";
  if (finishReason == null) return "unknown";
  return "incomplete";
}
```

`resolveThinkingMode(requestThinking, adapterDefault, model)` decides the effective thinking strategy. The contract: an explicit non-`"omit"` request wins; `"omit"` from the request stays `"omit"`; the adapter default applies next (with `"n/a"` collapsed to `"omit"`); and if no default forced a mode, a regex heuristic against `minimax-m3` returns `"disabled"`. The doc-comments explain why: MiniMax-M3 chat enables thinking by default when the field is omitted, which is undesirable for a documentation batch.

```ts
export function resolveThinkingMode(
  requestThinking: ThinkingMode | undefined,
  adapterDefault: ThinkingMode | "n/a",
  model: string,
): ThinkingMode | "omit" {
  if (requestThinking && requestThinking !== "omit") return requestThinking;
  if (requestThinking === "omit") return "omit";
  const def = adapterDefault === "n/a" ? "omit" : adapterDefault;
  if (def === "disabled" || def === "adaptive") return def;
  if (/minimax-m3/i.test(model) || /^minimax-m3$/i.test(model)) {
    return "disabled";
  }
  return "omit";
}
```