---
title: Anthropic Messages API adapter
owner: generated
anchors:
  - packages/core/src/llm/anthropic.ts#AnthropicAdapter
  - packages/core/src/llm/anthropic.ts#AnthropicAdapter.constructor
  - packages/core/src/llm/anthropic.ts#AnthropicAdapter.generate
  - packages/core/src/llm/anthropic.ts#normalizeStopReason
---

# Anthropic Messages API adapter

This page documents the `AnthropicAdapter`, the `livewiki` core package's concrete `LlmClient` implementation that talks to Anthropic's `POST /v1/messages` HTTP endpoint and shapes its responses into the engine's internal `GenerateResult`.

## When to use this page

- **Wire up Anthropic as an LLM provider** by instantiating `AnthropicAdapter` with an API key, base URL, and model name and passing it where the core expects an `LlmClient`.
- **Send a generation request** through `AnthropicAdapter.generate` and understand how the raw Anthropic response is mapped to a `GenerateResult`.
- **Interpret stop reasons** by reading `normalizeStopReason`, which translates Anthropic-specific strings into the engine's normalized `StopReason` vocabulary.
- **Configure transport behavior** (custom `fetch`, per-request timeout, retry count) through the constructor's options object.

## How it fits

The `AnthropicAdapter` lives in `packages/core/src/llm/anthropic.ts`, one of several provider adapters under `packages/core/src/llm/`. It implements the `LlmClient` interface defined in `./index.js`, which is the contract every provider-specific adapter in this directory must satisfy. Its `generate` method delegates the actual HTTP call, timeout handling, and retry loop to `requestWithRetry` and `withTimeoutMs` from `./base.js`, and it returns values shaped by `GenerateRequest`, `GenerateResult`, and `StopReason` from `./types.js`. The adapter is therefore a thin translation layer: provider-specific URL, headers, request body, and response field names on the outside; the engine's shared `GenerateResult` shape on the inside.

## Diagram

```mermaid
%% livewiki/diagrams/llm-anthropic.mmd
```

## Construction and configuration

<!-- lw:anchors packages/core/src/llm/anthropic.ts#AnthropicAdapter packages/core/src/llm/anthropic.ts#AnthropicAdapter.constructor -->

The `AnthropicAdapter` is the entry point for anyone wiring Anthropic into the core. It is exported as a class that satisfies the shared `LlmClient` contract and exposes a couple of read-only fields: `provider`, always the literal `"anthropic"`, and `model`, the model identifier configured at construction time. The constructor is where all transport-level decisions get baked in — it does not perform any network call, it only stores the inputs needed to build one.

```ts
constructor(opts: { apiKey: string; baseUrl: string; model: string; fetchImpl?: typeof fetch; timeoutMs?: number; maxRetries?: number }) {
```

The constructor accepts an `opts` object that carries the Anthropic API key, a `baseUrl`, the target `model`, and three optional knobs. It returns a configured `AnthropicAdapter` ready to be used as an `LlmClient`.

The constructor copies `apiKey`, `baseUrl`, and `model` onto the instance, then assembles an internal `AdapterConfig` object that the HTTP layer can consume. The optional fields are folded in only when supplied: `fetchImpl` is propagated as-is (so a custom fetch implementation can be injected for testing), `timeoutMs` is normalized via `withTimeoutMs`, and `maxRetries` is included only when it is not `undefined`. Optional fields that are `undefined` are deliberately omitted from the spread so the `AdapterConfig` keeps a clean shape for the retry helper.

## Request execution and response mapping

<!-- lw:anchors packages/core/src/llm/anthropic.ts#AnthropicAdapter.generate -->

`generate` is the method that actually talks to Anthropic. It takes a `GenerateRequest`, builds the provider-specific HTTP request, hands it to the shared retry helper, and reshapes Anthropic's JSON response into a `GenerateResult` that the rest of the engine can consume uniformly.

```ts
async generate(req: GenerateRequest): Promise<GenerateResult> {
```

`generate` accepts a `GenerateRequest` describing the system prompt, user prompt, optional `temperature`, and optional `maxTokens`, and returns a `Promise<GenerateResult>` containing the assistant text, usage metadata, and normalized stop reason.

The flow has three observable stages. First, it derives the URL by stripping any trailing slash from `baseUrl` and appending `/v1/messages`, and it builds a request body that maps the engine's `req.system` and `req.user` into Anthropic's `system` and `messages: [{ role: "user", content }]` shape. The body always sets `max_tokens`, defaulting to `4096` when `req.maxTokens` is not provided; `temperature` is only included when `req.temperature` is not `undefined`.

Second, it calls `requestWithRetry` from `./base.js` with `POST`, the appropriate headers (`x-api-key`, the pinned `anthropic-version: 2023-06-01`, and `content-type: application/json`), and the JSON-stringified body. The retry helper, using `this.config`, owns timeout enforcement and retry semantics; the adapter itself does not implement those behaviors.

Third, it parses the JSON response into an `AnthropicResponse`. To extract the assistant text, it inspects `raw.content[0]`: if the first content block exists, has `type === "text"`, and carries a string `text` field, that text is used; otherwise the text is the empty string. The returned `GenerateResult` contains the text, a `usage` object that renames `input_tokens` to `inputTokens` and `output_tokens` to `outputTokens` (and keeps the real model name from `raw.model`), and a normalized stop reason. When `raw.stop_reason` is non-null, the raw value is also attached as `rawStopReason`; when it is `null`, that field is omitted.

## Stop reason normalization

<!-- lw:anchors packages/core/src/llm/anthropic.ts#normalizeStopReason -->

`generate` does not decide stop semantics on its own — it delegates that decision to `normalizeStopReason`. This keeps the provider-specific vocabulary contained in one place and lets the rest of the engine reason about a small, stable set of `StopReason` values.

```ts
function normalizeStopReason(stopReason: string | null | undefined): StopReason {
```

`normalizeStopReason` takes a string, `null`, or `undefined` value as emitted by Anthropic's `stop_reason` field, and returns the engine's `StopReason` union member that best matches it.

The mapping is straightforward and total: `"max_tokens"` becomes `"length"`; `"end_turn"` and `"stop_sequence"` both become `"complete"`; a `null` or `undefined` input becomes `"unknown"`; and any other string falls through to `"incomplete"`. This is the normal-path behavior visible in the source — there is no throw, fallback log, or alternate branch in the excerpt for this function.