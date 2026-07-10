<think>
Let me analyze the input carefully:

1. Module: llm
2. Language: en
3. 16 symbols across 5 files
4. Closed list of 16 canonical keys to distribute

Let me organize the keys into logical sections:

**Section: Overview** - none directly, but I can introduce
**Section: Public API (index.ts)** - 
- createLlmClient
- MissingApiKeyError + constructor
- LlmRequestError + constructor
**Section: Anthropic Adapter** -
- AnthropicAdapter
- AnthropicAdapter.constructor
- AnthropicAdapter.generate
**Section: OpenAI-Compat Adapter** -
- OpenAiCompatAdapter
- OpenAiCompatAdapter.constructor
- OpenAiCompatAdapter.generate
**Section: Base HTTP utilities** -
- requestWithRetry
- isRetryableStatus
- sleep
- readText
**Section: Tests** -
- fakeFetch

Let me create the markdown page now.

Frontmatter anchors list should contain ALL keys from the closed list (since I need to use all of them as section markers, and the anchors list should reflect section anchors).

Wait, looking more carefully - the frontmatter `anchors` list should be the section anchors. The section markers distribute keys. So I should think about this:

- Frontmatter anchors: list of section IDs (or maybe key IDs?)
- Section markers: `<!-- lw:anchors key1 key2 -->` distributes remaining keys

Actually re-reading the instructions: "Frontmatter anchors list MUST only contain keys from the closed list." - so the anchors list contains the same keys as the closed list.

But I also need to distribute keys across sections using the section markers. So I think the anchors list in frontmatter = all keys, and the section markers distribute them into sections.

Let me do this:

Anchors (frontmatter) - all 16 keys
Section markers - distribute across sections

Section 1: Public API and errors (index.ts)
- createLlmClient
- MissingApiKeyError
- MissingApiKeyError.constructor
- LlmRequestError
- LlmRequestError.constructor

Section 2: Anthropic Adapter
- AnthropicAdapter
- AnthropicAdapter.constructor
- AnthropicAdapter.generate

Section 3: OpenAI-Compat Adapter
- OpenAiCompatAdapter
- OpenAiCompatAdapter.constructor
- OpenAiCompatAdapter.generate

Section 4: Base HTTP utilities
- requestWithRetry
- isRetryableStatus
- sleep
- readText

Section 5: Test helpers
- fakeFetch

That covers all 16. Let me write the markdown now.

I should be careful with prose - tight, reference-style. Use TODOs where info is missing but I have plenty from the source code.

Let me write it out:
</think>

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

Thin HTTP client for LLM providers used by `batch.ts` and friends. Built directly on `globalThis.fetch` (Node 20+); no SDK, no agent framework. Two provider adapters are shipped: Anthropic Messages and an OpenAI-compatible Chat Completions adapter that also covers OpenRouter, LiteLLM, and Ollama-style endpoints via `baseUrl`.

Design invariants enforced in code:

- API keys are read **only** from environment variables (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY`, or the env var name returned by a preset). They never enter `config.json`, checkpoints, logs, or error messages.
- The raw `errorBody` from a provider is **not** retained across retries, and is truncated to 500 chars when surfaced in `LlmRequestError`. Outgoing request headers (which carry the key) are never reflected in the error.
- `requestWithRetry` retries on `429` and any `5xx` only. Other `4xx` responses throw immediately (no retry).

## Public API and errors

`packages/core/src/llm/index.ts` exposes the `LlmClient` interface (re-exported via `base.ts`), the `createLlmClient` factory, and two error types.

<!-- lw:anchors packages/core/src/llm/index.ts#createLlmClient packages/core/src/llm/index.ts#MissingApiKeyError packages/core/src/llm/index.ts#MissingApiKeyError.constructor packages/core/src/llm/index.ts#LlmRequestError packages/core/src/llm/index.ts#LlmRequestError.constructor -->

### `createLlmClient(repoRoot, config)`

Factory that returns a concrete `LlmClient`. Resolution order:

1. `validateConfigForBatch(repoRoot, config)` — throws `MissingProviderConfigError` if `provider`/`preset` or `model` is missing.
2. `resolveProviderFromConfig(config)` — expands preset (if set) into `adapter`/`baseUrl`/`envVar`; otherwise maps legacy `provider` to defaults.
3. `baseUrl` — prefers an explicit `config.baseUrl`, then the preset's `baseUrl`, then `resolveBaseUrl(config)`.
4. `apiKey` — read from `process.env[resolved.envVar]`. Missing key throws `MissingApiKeyError`.
5. Constructs `AnthropicAdapter` when `resolved.adapter === "anthropic"`, otherwise `OpenAiCompatAdapter`.

Throws:
- `MissingProviderConfigError` (from `validateConfigForBatch`) when provider/preset or model is absent.
- `MissingApiKeyError` when the resolved env var is unset.

### `MissingApiKeyError`

Thrown by `createLlmClient` when the provider's API key env var is unset.

#### `new MissingApiKeyError(provider, envVar)`

- `provider: LlmProvider` — recorded on the instance.
- `envVar: string` — name of the env var the caller should set.
- Message states the provider, the env var to set, and the rule that keys never live in `config.json`, `checkpoint_json`, logs, or error messages. The message never references a key value (there is none to leak).

### `LlmRequestError`

Thrown by `requestWithRetry` on non-retryable HTTP failures, network errors after exhausting retries, or timeouts after exhausting retries.

#### `new LlmRequestError(provider, status, errorBody)`

- `provider: LlmProvider` — recorded on the instance.
- `status: number` — HTTP status; `0` when the failure is not an HTTP status (e.g. network/timeout after retry exhaustion).
- `errorBody: string` — truncated to 500 chars (with `"..."` suffix) before being interpolated into the message. The raw value is also exposed via the public `errorBody` field for callers that need to inspect it.
- Message format: `LLM <provider> request failed (status <status>): <truncated>`.

## Anthropic adapter

`packages/core/src/llm/anthropic.ts` adapts the Anthropic Messages API.

<!-- lw:anchors packages/core/src/llm/anthropic.ts#AnthropicAdapter packages/core/src/llm/anthropic.ts#AnthropicAdapter.constructor packages/core/src/llm/anthropic.ts#AnthropicAdapter.generate -->

Endpoint: `POST <baseUrl>/v1/messages` (trailing slash stripped from `baseUrl`).

Request headers:
- `x-api-key: <apiKey>`
- `anthropic-version: 2023-06-01`
- `content-type: application/json`

Request body shape:
- `model` — adapter's configured model.
- `system` — from `GenerateRequest.system`.
- `messages: [{ role: "user", content: <user> }]` — single user message from `GenerateRequest.user`.
- `max_tokens` — `req.maxTokens ?? 4096`.
- `temperature` — included only when `req.temperature !== undefined`.

Expected success response shape:
- `content: [{ type: "text", text: "<text>" }, ...]` — first element is used.
- `model: <string>` — echoed as `usage.model`.
- `usage: { input_tokens, output_tokens }` — normalized to `inputTokens` / `outputTokens`.

### `class AnthropicAdapter implements LlmClient`

- `readonly provider: "anthropic"`
- `readonly model: string` — from constructor options.

#### `new AnthropicAdapter(opts)`

`opts`:
- `apiKey: string`
- `baseUrl: string`
- `model: string`
- `fetchImpl?: typeof fetch` — included in the internal `AdapterConfig` only when provided.
- `timeoutMs?: number` — included only when provided.
- `maxRetries?: number` — included only when provided.

Stores `apiKey`, `baseUrl`, `model`, and builds the `AdapterConfig` passed to `requestWithRetry`.

#### `async generate(req): Promise<GenerateResult>`

1. Builds URL by stripping trailing `/` from `baseUrl` and appending `/v1/messages`.
2. Builds body per the shape above.
3. Calls `requestWithRetry` with `provider = "anthropic"`, the headers above, and the JSON body.
4. Parses the JSON response into the local `AnthropicResponse` interface.
5. Extracts `text` from `content[0]` when `type === "text"`; otherwise returns `""`.
6. Returns `{ content: text, usage: { inputTokens, outputTokens, model } }`.

## OpenAI-compatible adapter

`packages/core/src/llm/openai-compat.ts` adapts any endpoint that speaks OpenAI Chat Completions (OpenAI, OpenRouter, LiteLLM, Ollama, etc.).

<!-- lw:anchors packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter.constructor packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter.generate -->

URL resolution:
- Strip trailing `/` from `baseUrl`.
- If the stripped base ends in `/v1`, the final URL is `${base}/chat/completions` (no duplicate `/v1`).
- Otherwise, the final URL is `${base}/v1/chat/completions`.

Request headers:
- `authorization: Bearer <apiKey>`
- `content-type: application/json`

Request body shape:
- `model` — adapter's configured model.
- `messages: [{ role: "system", content: <system> }, { role: "user", content: <user> }]`.
- `max_tokens` — `req.maxTokens ?? 4096`.
- `temperature` — included only when `req.temperature !== undefined`.

Expected success response shape:
- `choices: [{ message: { role: "assistant", content: "<text>" } }, ...]` — first choice's `message.content` is used; missing path returns `""`.
- `model: <string>` — echoed as `usage.model`.
- `usage: { prompt_tokens, completion_tokens }` (optional) — normalized to `inputTokens` / `outputTokens`. Missing `usage` fields fall back to `0`.

### `class OpenAiCompatAdapter implements LlmClient`

- `readonly provider: "openai-compat"`
- `readonly model: string` — from constructor options.

#### `new OpenAiCompatAdapter(opts)`

Same `opts` shape as `AnthropicAdapter` (`apiKey`, `baseUrl`, `model`, optional `fetchImpl`, `timeoutMs`, `maxRetries`). Optional fields are folded into the internal `AdapterConfig` only when present.

#### `async generate(req): Promise<GenerateResult>`

1. Resolves URL per the rules above.
2. Builds body per the shape above (system + user messages inline).
3. Calls `requestWithRetry` with `provider = "openai-compat"`, the bearer-auth headers, and the JSON body.
4. Parses JSON into the local `OpenAiCompatResponse` interface.
5. Extracts `text` from `choices[0]?.message?.content ?? ""`.
6. Returns `{ content: text, usage: { inputTokens, outputTokens, model } }`, defaulting token counts to `0` when `usage` is absent.

## Base HTTP utilities

`packages/core/src/llm/base.ts` is provider-agnostic. It centralizes the fetch wrapper with timeout, exponential-backoff retry on retryable statuses, and error normalization.

<!-- lw:anchors packages/core/src/llm/base.ts#requestWithRetry packages/core/src/llm/base.ts#isRetryableStatus packages/core/src/llm/base.ts#sleep packages/core/src/llm/base.ts#readText -->

### `async requestWithRetry(provider, url, init, adapterConfig)`

- `provider: LlmProvider` — used to populate the thrown `LlmRequestError`.
- `url: string` — fully qualified request URL.
- `init: RequestInit` — request init (method, headers, body). The adapter supplies `x-api-key` / `authorization`; this helper does not inspect them.
- `adapterConfig: AdapterConfig` — fields read:
  - `fetchImpl` — defaults to `globalThis.fetch`.
  - `timeoutMs` — per-attempt timeout; default `60_000` ms, enforced via `AbortController` + `setTimeout`.
  - `maxRetries` — default `3`.
  - `retryDelayMs` — base delay for exponential backoff; default `1000` ms. Actual delay before attempt `n` is `retryDelayMs * 2^(n-1)`.

Behavior:
- On `res.ok`, returns `Response` immediately.
- On non-retryable status (anything `isRetryableStatus` returns `false` for, e.g. `4xx` other than `429`), reads the body once, then throws `LlmRequestError(provider, status, body)`. **No retry.**
- On retryable status, records `lastStatus`, consumes and discards the body (to avoid socket leaks), and sleeps before the next attempt.
- On thrown errors:
  - `LlmRequestError` is rethrown unchanged.
  - `AbortError` is classified as `timeout`.
  - Other errors are classified as `network`.
  - Sleep before the next attempt.
- `clearTimeout` always runs in `finally`.
- After `maxRetries` attempts, throws `LlmRequestError(provider, 0, "Failed after <N> attempts (last status: <s> | last error: <kind> | unknown)")`. The body returned by the provider is **never** propagated on this final path.

### `isRetryableStatus(status)`

Returns `true` when `status === 429` or `status` is in `[500, 600)`. All other statuses (including other `4xx`) return `false`.

### `sleep(ms)`

Promise that resolves after `ms` via `setTimeout`. Used between retry attempts.

### `async readText(res)`

Thin wrapper over `res.text()` for adapters that need to read the body as text. Currently exported but not used internally by the two adapters (they `await res.json()`).

## Test helpers

`packages/core/src/llm/adapters.test.ts` exercises both adapters and `requestWithRetry`. It uses a `fakeFetch` helper and inline `vi.fn(...)` implementations for assertions on call shape.

<!-- lw:anchors packages/core/src/llm/adapters.test.ts#fakeFetch -->

### `fakeFetch(response)`

Returns a `vi.fn`-based `fetch`-compatible function that resolves to a `Response` constructed from the supplied descriptor:
- `response.status` — defaults to `200`.
- `response.ok` — defaults to `status >= 200 && status < 300` when omitted.
- `response.body` — JSON-stringified into the response body; defaults to `"{}"`.
- The response always carries `content-type: application/json`.

Tests assert the following invariants:

- `AnthropicAdapter.generate` `POST`s to `<baseUrl>/v1/messages` with `x-api-key`, `anthropic-version: 2023-06-01`, and a body shaped `{ model, system, messages: [{ role: "user", content }] }`. Token counts are normalized from `input_tokens` / `output_tokens` to `inputTokens` / `outputTokens`.
- `AnthropicAdapter.generate` on a non-`429` `4xx` makes exactly **one** call (no retry) and rejects with `LlmRequestError`.
- `OpenAiCompatAdapter.generate` `POST`s to `<baseUrl>/v1/chat/completions` with `authorization: Bearer <apiKey>`. When `baseUrl` already ends in `/v1`, the path is not duplicated. Token counts are normalized from `prompt_tokens` / `completion_tokens` to `inputTokens` / `outputTokens`.
- `requestWithRetry` retries `3` times on `429` and `2` times on `500` (with `retryDelayMs: 0`), each case ultimately rejecting with `LlmRequestError`.