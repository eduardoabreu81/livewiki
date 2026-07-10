---
title: llm
owner: generated
anchors:
  - packages/core/src/llm/adapters.test.ts#fakeFetch
  - packages/core/src/llm/anthropic.ts#AnthropicAdapter
  - packages/core/src/llm/anthropic.ts#AnthropicAdapter.constructor
  - packages/core/src/llm/anthropic.ts#AnthropicAdapter.generate
  - packages/core/src/llm/base.ts#isRetryableStatus
  - packages/core/src/llm/base.ts#readText
  - packages/core/src/llm/base.ts#requestWithRetry
  - packages/core/src/llm/base.ts#sleep
  - packages/core/src/llm/index.ts#LlmRequestError
  - packages/core/src/llm/index.ts#LlmRequestError.constructor
  - packages/core/src/llm/index.ts#MissingApiKeyError
  - packages/core/src/llm/index.ts#MissingApiKeyError.constructor
  - packages/core/src/llm/index.ts#createLlmClient
  - packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter
  - packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter.constructor
  - packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter.generate
---

# llm

Thin HTTP client for LLM providers used by the batch pipeline. Built on native `fetch` (Node 20+), no SDK, no agent framework. Two adapters are shipped:

- **Anthropic** — POST `/v1/messages` with `x-api-key` + `anthropic-version` headers.
- **OpenAI-compatible** — POST `/v1/chat/completions` with `Authorization: Bearer`. Covers OpenAI, OpenRouter, LiteLLM, Ollama cloud, etc.

Both adapters share an HTTP base layer that handles timeout, retry with exponential backoff on `429`/`5xx`, and error normalization. The factory `createLlmClient` picks the right adapter from validated config and reads the API key exclusively from an environment variable (never config, logs, or error messages).

Source layout (`packages/core/src/llm/`):

- `index.ts` — public surface: `LlmClient` interface, `createLlmClient` factory, error classes.
- `base.ts` — shared HTTP utilities: `requestWithRetry`, `isRetryableStatus`, `sleep`, `readText`, `AdapterConfig`.
- `anthropic.ts` — `AnthropicAdapter`.
- `openai-compat.ts` — `OpenAiCompatAdapter`.
- `adapters.test.ts` — vitest tests covering both adapters and the retry policy.

## Public API (`packages/core/src/llm/index.ts`)

### packages/core/src/llm/index.ts#createLlmClient

```ts
export function createLlmClient(repoRoot: string, config: LivewikiConfig): LlmClient
```

Factory that returns the adapter matching the validated config.

Resolution order:

1. `config.preset` → expands to `{ adapter, baseUrl, envVar, pricing }`.
2. `config.provider` (legacy) → maps to adapter, default `baseUrl`, default `envVar`.
3. Neither set → `validateConfigForBatch` throws `MissingProviderConfigError`.

After validation, reads the API key from the resolved `envVar`. If the env var is absent, throws [`MissingApiKeyError`](#packagescorellsrcopenai-compattopenAICompatAdapter). The model and base URL come from config (or preset defaults).

### packages/core/src/llm/index.ts#MissingApiKeyError

```ts
export class MissingApiKeyError extends Error {
  public readonly provider: LlmProvider;
  public readonly envVar: string;
}
```

Thrown when the API key env var is missing. Message names the provider and env var to set, and explicitly states that keys never live in `config.json`, `checkpoint_json`, logs, or error messages.

### packages/core/src/llm/index.ts#MissingApiKeyError.constructor

```ts
constructor(provider: LlmProvider, envVar: string)
```

Stores `provider` and `envVar` as readonly fields and sets `this.name = "MissingApiKeyError"`.

### packages/core/src/llm/index.ts#LlmRequestError

```ts
export class LlmRequestError extends Error {
  public readonly status: number;
  public readonly provider: LlmProvider;
  public readonly errorBody: string;
}
```

Thrown by `requestWithRetry` when a request fails (either non-retryable status, or all retries exhausted). Carries `status`, `provider`, and the raw `errorBody` from the provider. The constructor truncates the body to 500 chars before composing the message, so error logs never dump a huge JSON payload. **Headers (which contain the API key) are never included** — covered by `key-leak.test.ts`.

### packages/core/src/llm/index.ts#LlmRequestError.constructor

```ts
constructor(provider: LlmProvider, status: number, errorBody: string)
```

Builds a message of the form `LLM <provider> request failed (status <status>): <truncated>`, sets `this.name = "LlmRequestError"`, and stores `status`, `provider`, `errorBody` (untruncated) as readonly fields.

## Anthropic adapter (`packages/core/src/llm/anthropic.ts`)

### packages/core/src/llm/anthropic.ts#AnthropicAdapter

```ts
export class AnthropicAdapter implements LlmClient
```

Implements [`LlmClient`](#packagescorellsrcopenai-compattopenAICompatAdapter). `provider` is the literal `"anthropic"`. Holds `apiKey`, `baseUrl`, `model`, and an internal `AdapterConfig` built from constructor opts.

**Endpoint:** `POST <baseUrl>/v1/messages`

**Headers:**

| Header | Value |
| --- | --- |
| `x-api-key` | API key |
| `anthropic-version` | `2023-06-01` |
| `content-type` | `application/json` |

**Request body:**

```json
{
  "model": "<model>",
  "system": "<system>",
  "messages": [{ "role": "user", "content": "<user>" }],
  "max_tokens": 4096,
  "temperature": <optional>
}
```

**Response (success):**

```json
{
  "content": [{ "type": "text", "text": "<text>" }],
  "model": "<model>",
  "usage": { "input_tokens": <n>, "output_tokens": <n> }
}
```

Normalization: `input_tokens → inputTokens`, `output_tokens → outputTokens`.

### packages/core/src/llm/anthropic.ts#AnthropicAdapter.constructor

```ts
constructor(opts: {
  apiKey: string;
  baseUrl: string;
  model: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
})
```

Stores all fields and assembles the internal `AdapterConfig`. Optional fields (`fetchImpl`, `timeoutMs`, `maxRetries`) are only forwarded when present, keeping `AdapterConfig` free of `undefined` noise.

### packages/core/src/llm/anthropic.ts#AnthropicAdapter.generate

```ts
async generate(req: GenerateRequest): Promise<GenerateResult>
```

1. Computes `url = <baseUrl without trailing slash>/v1/messages`.
2. Builds the request body with `model`, `system`, `messages: [{ role: "user", content: req.user }]`, `max_tokens` (defaults to `4096`), and optional `temperature`.
3. Calls `requestWithRetry` with the Anthropic headers.
4. Parses the JSON response, extracts the first `content` block of `type === "text"`, and returns `{ content, usage: { inputTokens, outputTokens, model } }`.

If `content` is empty or missing, `content` defaults to `""`. Failure paths throw [`LlmRequestError`](#packagescorellsrcopenai-compattopenAICompatAdapter).

## OpenAI-compatible adapter (`packages/core/src/llm/openai-compat.ts`)

### packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter

```ts
export class OpenAiCompatAdapter implements LlmClient
```

Implements [`LlmClient`](#packagescorellsrcopenai-compattopenAICompatAdapter). `provider` is the literal `"openai-compat"`. Covers OpenAI, OpenRouter, LiteLLM, Ollama cloud, and any other provider that accepts the OpenAI Chat Completions shape.

**Endpoint:** `POST <baseUrl>/v1/chat/completions`. If `baseUrl` already ends in `/v1` or `/v1/`, the suffix is not duplicated.

**Headers:**

| Header | Value |
| --- | --- |
| `authorization` | `Bearer <API key>` |
| `content-type` | `application/json` |

**Request body:**

```json
{
  "model": "<model>",
  "messages": [
    { "role": "system", "content": "<system>" },
    { "role": "user", "content": "<user>" }
  ],
  "max_tokens": 4096,
  "temperature": <optional>
}
```

**Response (success):**

```json
{
  "choices": [{ "message": { "role": "assistant", "content": "<text>" } }],
  "model": "<model>",
  "usage": { "prompt_tokens": <n>, "completion_tokens": <n> }
}
```

Normalization: `prompt_tokens → inputTokens`, `completion_tokens → outputTokens`.

### packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter.constructor

```ts
constructor(opts: {
  apiKey: string;
  baseUrl: string;
  model: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
})
```

Same shape as [`AnthropicAdapter.constructor`](#packagescorellsrcopenai-compattopenAICompatAdapterconstructor). Stores `apiKey`, `baseUrl`, `model`, and builds the internal `AdapterConfig`.

### packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter.generate

```ts
async generate(req: GenerateRequest): Promise<GenerateResult>
```

1. Strips trailing slash from `baseUrl`. If the result already ends in `/v1`, appends `/chat/completions`; otherwise appends `/v1/chat/completions`.
2. Builds the OpenAI-shaped body with `system` and `user` messages, `max_tokens` defaulting to `4096`, and optional `temperature`.
3. Calls `requestWithRetry` with the `Authorization: Bearer` header.
4. Parses the JSON response, reads `choices[0].message.content` (falling back to `""` if absent), and returns `{ content, usage: { inputTokens, outputTokens, model } }`. Missing `usage` fields default to `0`.

Failure paths throw [`LlmRequestError`](#packagescorellsrcopenai-compattopenAICompatAdapter).

## HTTP base layer (`packages/core/src/llm/base.ts`)

Shared by both adapters. No provider-specific knowledge — only HTTP and retry policy.

### packages/core/src/llm/base.ts#requestWithRetry

```ts
export async function requestWithRetry(
  provider: LlmProvider,
  url: string,
  init: RequestInit,
  adapterConfig: AdapterConfig,
): Promise<Response>
```

Executes `fetchImpl(url, init)` (default `globalThis.fetch`) with the following guarantees:

- **Timeout per attempt**: `AbortController` with `setTimeout(timeoutMs)`. Default `60_000` ms. `AbortError` is classified as `timeout` for the final message.
- **Retry policy**: up to `maxRetries` attempts (default `3`). Retries on `429` and any `5xx` (per [`isRetryableStatus`](#packagescorellsrcopenai-compattopenAICompatAdapter)). Non-retryable statuses (`4xx` other than `429`) throw `LlmRequestError` immediately with the provider's body attached.
- **Backoff**: `retryDelayMs * 2^(attempt-1)` between attempts. Default base `1000` ms.
- **Socket hygiene**: response body is consumed even on retryable failures to avoid leaking sockets.
- **Error message hygiene**: only `status` (or `network`/`timeout` category) is carried into the final error. The provider's error body is attached **only** on the non-retryable path; the retryable exhaustion path uses a synthetic message of the form `Failed after N attempts (last status: <code>)` or `Failed after N attempts (last error: <kind>)`.
- **No header leakage**: headers (including the API key) are never propagated into the thrown error.

### packages/core/src/llm/base.ts#isRetryableStatus

```ts
function isRetryableStatus(status: number): boolean
```

Returns `true` for `status === 429` and any status in `[500, 600)`. All other statuses are treated as terminal.

### packages/core/src/llm/base.ts#sleep

```ts
function sleep(ms: number): Promise<void>
```

`setTimeout`-based promise sleep, used by `requestWithRetry` for backoff delays. Not exported.

### packages/core/src/llm/base.ts#readText

```ts
export async function readText(res: Response): Promise<string>
```

Thin wrapper over `Response.text()` exposed for adapters that need to read raw bodies. Currently a direct delegate; reserved as a stable surface for future normalization.

## Tests (`packages/core/src/llm/adapters.test.ts`)

Vitest suite covering both adapters and the retry policy. Uses `vi.fn`-backed `fetch` stubs to assert URL, method, headers, and body shape.

### packages/core/src/llm/adapters.test.ts#fakeFetch

```ts
function fakeFetch(response: { status?: number; body?: unknown; ok?: boolean }): typeof fetch
```

Test helper that returns a `vi.fn` acting as `fetch`. It synthesizes a `Response`:

- `status` defaults to `200`.
- `ok` defaults to `status >= 200 && status < 300`, overridable via the `ok` field.
- `body` defaults to `"{}"` if `undefined`, otherwise `JSON.stringify(body)`.
- Always sets `content-type: application/json`.

Used by the `prompt_tokens → inputTokens` and `completion_tokens → outputTokens` normalization tests to keep the test code focused on assertions.

**Covered scenarios:**

- `AnthropicAdapter`: POSTs `/v1/messages` with `x-api-key` + `anthropic-version`; normalizes `input_tokens`/`output_tokens`; non-retryable `4xx` throws `LlmRequestError` after exactly one call (no retry).
- `OpenAiCompatAdapter`: POSTs `/v1/chat/completions` with `Authorization: Bearer`; respects a `baseUrl` that already ends in `/v1` (no duplicate suffix); normalizes `prompt_tokens`/`completion_tokens`.
- `requestWithRetry`: retries exactly 3 times on `429` then throws `LlmRequestError`; retries exactly 2 times on `500` then throws. Both use `retryDelayMs: 0` so the suite stays fast.

## Notes

- API keys are read **only** from environment variables named by the preset (e.g. `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) — never from `config.json`, `checkpoint.json`, logs, or error messages.
