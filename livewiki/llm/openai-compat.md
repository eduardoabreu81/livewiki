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

This page documents the adapter that lets livewiki talk to any OpenAI Chat Completions–compatible API.

## When to use this page

- Understand how livewiki sends prompts to OpenAI, OpenRouter, LiteLLM, MiniMax, or Ollama cloud.
- Learn how the adapter decides between `max_tokens` and `max_completion_tokens` for a request.
- See how thinking mode (disabled, adaptive, or omitted) is resolved per request and per model.
- Trace how raw `finish_reason` values from these APIs become livewiki's normalized stop reasons.

## How it fits

`OpenAiCompatAdapter` is one of the `LlmClient` implementations in `packages/core/src/llm/`. It translates livewiki's internal `GenerateRequest` into an HTTP POST to a provider's `/chat/completions` endpoint, then converts the provider's JSON response back into a `GenerateResult`. The adapter shares retry and timeout machinery with other LLM clients via `requestWithRetry` and `withTimeoutMs` from `./base.js`.

The file also exports `resolveThinkingMode`, a helper that other parts of the codebase can reuse to decide the effective thinking behavior before calling the adapter.

## Diagram

```mermaid
%% livewiki/diagrams/llm-openai-compat.mmd
```

## Constructor and configuration

<!-- lw:anchors packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter.constructor -->

The constructor takes an options object and stores everything the adapter needs for later requests. It copies the API key, base URL, and model name into private fields, then computes a default thinking mode: if the caller did not provide `thinkingDefault`, it falls back to `"omit"`. It also records whether the adapter should prefer `max_completion_tokens` over the older `max_tokens` field.

It then builds an internal `AdapterConfig` that carries the same API key, base URL, and model, plus optional `fetchImpl`, timeout, retry count, and retry delay. The timeout handling uses `withTimeoutMs` so that a timeout of `0` disables the timeout entirely instead of being treated as an instant failure.

## Request flow

<!-- lw:anchors packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter.generate -->

The `generate` method orchestrates the whole request lifecycle. It first normalizes the base URL by stripping any trailing slash, then appends `/chat/completions` if the base already ends with `/v1`, or `/v1/chat/completions` otherwise. This lets the same adapter work with providers that include the version prefix in their base URL and those that do not.

Next it builds the request body. The system and user messages come straight from the `GenerateRequest`, and the temperature is included only when the caller set it. The maximum output token count defaults to 4096, and the adapter picks `max_completion_tokens` or `max_tokens` based on whether the request (or the adapter's default) prefers the newer field.

It then calls `resolveThinkingMode` to decide whether to send a `thinking` block in the body. If the resolved mode is `"disabled"`, it sends `{ type: "disabled" }`; if it is `"adaptive"`, it sends `{ type: "adaptive" }`. When the mode resolves to `"omit"`, no thinking field is sent at all.

The request is dispatched through `requestWithRetry` with the provider name, the constructed URL, headers carrying the bearer token, and the stored `AdapterConfig`. After the response arrives, the method extracts the first choice's message content and the usage counters. It reports input tokens from `prompt_tokens`, output tokens from `completion_tokens`, the model name from the response, and reasoning tokens when the provider supplies them. Finally, it normalizes the raw `finish_reason` via `normalizeFinishReason` and preserves the raw value in `rawStopReason` when present.

## Thinking mode resolution

<!-- lw:anchors packages/core/src/llm/openai-compat.ts#resolveThinkingMode -->

The `resolveThinkingMode` function decides the effective thinking behavior for a request. It runs before the adapter builds the request body, and its result determines whether a `thinking` block is included.

The function first checks the request's own thinking field. If the caller explicitly set a mode other than `"omit"`, that mode wins immediately. If the caller explicitly set `"omit"`, the function returns `"omit"` — the thinking field is simply left out. Only when the request did not specify a mode does the function consult the adapter default and the model name.

For the fallback path, it converts `"n/a"` into `"omit"` and otherwise uses the adapter's configured default. If that default is `"disabled"` or `"adaptive"`, it is returned as-is. Otherwise, the function applies a heuristic for MiniMax-M3 chat models: when the model name matches `minimax-m3` (case-insensitive), it returns `"disabled"` to prevent the API from enabling thinking by default. Any other unrecognized model gets `"omit"`.

## Stop reason normalization

<!-- lw:anchors packages/core/src/llm/openai-compat.ts#normalizeFinishReason -->

The `normalizeFinishReason` function maps a raw OpenAI-compatible `finish_reason` string into livewiki's internal `StopReason` type. Different providers use slightly different values, and this function keeps the rest of the codebase insulated from those differences.

The mapping is exact: `"length"` becomes `"length"`, `"stop"` becomes `"complete"`, and a null or undefined value becomes `"unknown"`. Any other string — for example `"content_filter"` or `"tool_calls"` — is treated as `"incomplete"`, meaning the model stopped before finishing its answer.