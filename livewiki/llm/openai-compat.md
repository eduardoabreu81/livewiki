---
title: OpenAI-compatible LLM adapter
owner: generated
anchors:
  - packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter
  - packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter.constructor
  - packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter.generate
  - packages/core/src/llm/openai-compat.ts#normalizeFinishReason
  - packages/core/src/llm/openai-compat.ts#resolveThinkingMode
---

# OpenAI-compatible LLM adapter

This page documents the module that lets the rest of the system talk to any HTTP service that speaks the OpenAI Chat Completions wire format (OpenAI itself, OpenRouter, LiteLLM, MiniMax chat, Ollama cloud, and similar).

## When to use this page

- **Wire a new OpenAI-shaped provider** into the LLM client interface by configuring `OpenAiCompatAdapter` with its `baseUrl` and `apiKey`.
- **Tune per-request generation behavior** such as output-token caps, temperature, or thinking-mode override via the `GenerateRequest` passed to `generate`.
- **Diagnose a misbehaving provider response** by checking how raw `finish_reason` strings are normalized into the project's `StopReason` vocabulary.
- **Decide whether thinking is sent at all** for a given request, especially for MiniMax-M3 chat where the API silently enables thinking when omitted.

## How it fits

`packages/core/src/llm/openai-compat.ts` lives inside the `packages/core/src/llm/` directory alongside the `LlmClient` interface (`./index.js`), the shared request/result types (`./types.js`), and the shared HTTP plumbing in `./base.js` (retry, timeout, fetch injection). It exists because many model servers already emulate OpenAI's `/v1/chat/completions` endpoint, so a single adapter covers a long tail of providers instead of one bespoke class per vendor. The adapter implements `LlmClient`, which is the seam the rest of the system uses to obtain a chat completion — callers hand it a `GenerateRequest` and receive a `GenerateResult` without caring which provider answered.

Internally, `OpenAiCompatAdapter.generate` is the orchestration entry point: it builds the URL, assembles the JSON body, decides whether to send `max_tokens` or `max_completion_tokens`, consults `resolveThinkingMode` to decide whether to attach a `thinking` block, hands the request to `requestWithRetry`, and finally maps the response back into the project's shape (using `normalizeFinishReason` to translate the provider's free-form `finish_reason` string into a small `StopReason` enum). The two helper functions at the bottom of the file are intentionally pure so the request-building logic and the response-parsing logic can each be reasoned about on their own.

## Diagram

```mermaid
%% livewiki/diagrams/llm-openai-compat.mmd
```

## Construction and configuration
<!-- lw:anchors packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter.constructor -->

The adapter is intentionally a thin shell: it stores the caller-supplied configuration and forwards it to the shared HTTP plumbing on every request. There is no connection setup here — providers are contacted lazily on the first `generate` call, which means an instance can be constructed even when the network is unavailable.

The constructor signature is:

```ts
constructor(opts: OpenAiCompatAdapterOpts) {
```

It accepts `opts` — an `OpenAiCompatAdapterOpts` record carrying the API key, base URL, model name, optional fetch override, optional timeout, retry/retry-delay settings, a thinking-mode default, and a flag choosing between the legacy `max_tokens` and the newer `max_completion_tokens` field. It stores `apiKey`, `baseUrl`, and `model` directly, normalizes `thinkingDefault` to `"omit"` when unset, defaults `preferMaxCompletionTokens` to `false`, and assembles an `AdapterConfig` passed straight through to `requestWithRetry` later. The spread on `withTimeoutMs(opts.timeoutMs)` preserves a literal `0` (which means "disable timeout") and is not collapsed by a truthiness check; `maxRetries` and `retryDelayMs` are only included when explicitly provided.

## Request assembly and execution
<!-- lw:anchors packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter.generate -->

`generate` is the only public method that crosses the network boundary. It owns the full "build request → send → translate response" pipeline and is the only place where provider-specific quirks get encoded.

The signature is:

```ts
async generate(req: GenerateRequest): Promise<GenerateResult> {
```

It takes a `GenerateRequest` (system prompt, user prompt, optional `maxTokens`, optional `temperature`, optional `thinking`, optional `preferMaxCompletionTokens`) and returns a `GenerateResult` containing the model's text, usage stats, normalized `stopReason`, and an optional `rawStopReason` echo.

The flow has several deliberate steps:

1. **URL composition.** It strips a trailing `/` from `baseUrl` and then appends `/chat/completions` — but only after deciding whether `/v1` is already present in the path, so both `https://api.openai.com/v1` and `https://litellm.example.com` style bases produce a correct endpoint.
2. **Body skeleton.** It always includes `model` plus a two-message chat (`system` then `user`), and conditionally adds `temperature` only when the caller supplied one, avoiding the `undefined` JSON artifact that some providers dislike.
3. **Token-cap field selection.** It picks `max_completion_tokens` when either the per-request or the adapter-level flag asks for it, otherwise the legacy `max_tokens`. The default output budget when the caller does not specify one is `4096`.
4. **Thinking-mode resolution.** It delegates to `resolveThinkingMode` (see below) and, only if the resolved mode is `disabled` or `adaptive`, attaches the matching `thinking: { type: ... }` object to the body. The `"omit"` case deliberately produces no `thinking` key at all — this matters because some providers enable thinking by default when the field is absent.
5. **Transport.** It calls `requestWithRetry(this.provider, url, requestInit, this.config)`, which handles timeouts (including `0` = disabled), retries, and any caller-provided `fetchImpl`. The bearer token and JSON content type are set here.
6. **Response translation.** It parses the JSON as an `OpenAiCompatResponse`, defaults the text content to `""` when missing, fills in zeroed token counts if `usage` is absent, maps `finish_reason` through `normalizeFinishReason`, and echoes the raw `finish_reason` string back as `rawStopReason` only when it is non-null — so consumers that want the original provider wording can still inspect it without paying the cost on every request.

The normal path described above is what callers see in steady state; the helper functions in the next sections govern the two decision points (thinking mode and stop-reason mapping) that the rest of the pipeline depends on.

## Thinking-mode resolution
<!-- lw:anchors packages/core/src/llm/openai-compat.ts#resolveThinkingMode -->

This helper exists because the OpenAI Chat Completions wire format does not define a uniform "thinking" field, and at least one important provider (MiniMax-M3 chat) treats the absence of the field as an implicit "on". To keep caller code provider-agnostic, the adapter centralizes the policy here.

The signature is:

```ts
export function resolveThinkingMode(
  requestThinking: ThinkingMode | undefined,
  adapterDefault: ThinkingMode | "n/a",
  model: string,
): ThinkingMode | "omit" {
```

It accepts the per-request thinking override (if any), the adapter-level default (where `"n/a"` is treated as "no policy"), and the model name; it returns the effective mode to encode in the request body, or the special `"omit"` sentinel meaning "do not emit a `thinking` key at all".

The decision order is: an explicit per-request mode (anything other than `"omit"`) wins; an explicit per-request `"omit"` is honored literally; otherwise the adapter default is consulted, with `"n/a"` collapsing to `"omit"`; if the resolved default is still neither `"disabled"` nor `"adaptive"`, the function falls back to a heuristic that returns `"disabled"` for any model whose name matches `minimax-m3` (case-insensitive, either as a substring or as the bare string) and `"omit"` for everything else. The visible source covers only these branches — it does not, for example, treat other model families specially.

## Finish-reason normalization
<!-- lw:anchors packages/core/src/llm/openai-compat.ts#normalizeFinishReason -->

Different OpenAI-compatible providers use slightly different strings for `finish_reason`, and downstream code wants a small, stable vocabulary. This helper is the single mapping point.

The signature is:

```ts
function normalizeFinishReason(finishReason: string | null | undefined): StopReason {
```

It takes the raw `finish_reason` value from the provider (which may be a string, `null`, or `undefined`) and returns one of the project's `StopReason` values.

The visible mapping is narrow on purpose: `"length"` becomes `"length"` (the model hit a token cap), `"stop"` becomes `"complete"` (the model produced a natural end-of-turn), a missing value (`null` or `undefined`) becomes `"unknown"`, and every other string — including provider-specific tokens not enumerated here — becomes `"incomplete"`. The function is pure and has no fallback path beyond these branches, so an unrecognized string is treated as an incomplete stop rather than as an error.