---
title: OpenAI-Compatible Chat API Adapter
owner: generated
anchors:
- packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter
- packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter.constructor
- packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter.generate
- packages/core/src/llm/openai-compat.ts#normalizeFinishReason
- packages/core/src/llm/openai-compat.ts#normalizeUsage
- packages/core/src/llm/openai-compat.ts#resolveThinkingMode
---

# OpenAI-Compatible Chat API Adapter

This module adapts any OpenAI Chat Completions-compatible HTTP API into the livewiki LLM client interface.

## When to use this page

- Understand how livewiki communicates with providers like OpenAI, OpenRouter, LiteLLM, MiniMax chat, or Ollama cloud through a single HTTP adapter.
- Learn how the adapter maps livewiki generation requests to the wire format of an OpenAI-compatible chat completions endpoint.
- See how provider-specific quirks, such as MiniMax-M3 thinking defaults, are normalized into livewiki's own result types.
- Inspect how raw provider responses are interpreted into standardized usage and stop-reason values.

## How it fits

`OpenAiCompatAdapter` is one concrete implementation of the `LlmClient` interface, which lives alongside other LLM adapters in `packages/core/src/llm/`. Its job is to translate a livewiki `GenerateRequest` into an HTTP POST against an OpenAI Chat Completions-compatible endpoint, then translate the provider's JSON response back into a livewiki `GenerateResult`. The adapter lives in the same directory as the shared HTTP helpers it uses, `./base.ts` and the shared type definitions in `./types.js` (which are imported via `./index.js`). Livewiki's LLM layer treats this adapter as a drop-in for any provider that speaks the OpenAI wire protocol.

## Diagram

```mermaid
%% livewiki/diagrams/llm-openai-compat.mmd
```

## Construction

<!-- lw:anchors packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter.constructor -->

The constructor for `OpenAiCompatAdapter` exists to capture the provider connection details and tuning parameters for a single HTTP client instance. These values are fixed once at construction time and are reused for every `generate` call, so the caller must supply all connection and retry configuration up front. It is an exported class that implements `LlmClient`, whose interface contract lives in the module's `index.js` file alongside the adapter itself. It assembles a small config object containing the fields needed by the shared retry helper, defaulting optional fields sensibly: the adapterDefault thinking mode becomes `"omit"` when not supplied, and the preference for the longer `max_completion_tokens` parameter becomes `false` when not supplied.

```ts
constructor(opts: OpenAiCompatAdapterOpts) {
```

On construction, the adapter validates nothing itself but simply stores the API key, base URL, and model name as private fields. It builds an internal `AdapterConfig` by packaging the original options, conditionally adding only the fields that caller actually provided: a custom `fetchImpl`, a timeout in milliseconds (preserving the `0` value which disables the timeout), a retry count, and a retry delay. The timeout wiring deliberately uses a helper rather than a truthy spread so a caller's `timeoutMs: 0` is honored as "no timeout" rather than being dropped as falsy.

## Generation Flow

<!-- lw:anchors packages/core/src/llm/openai-compat.ts#OpenAiCompatAdapter.generate packages/core/src/llm/openai-compat.ts#resolveThinkingMode -->

The `generate` method is the adapter's moment of truth: it turns a logical request from livewiki into physical HTTP traffic against the provider, and then back again into a normalized result. This method handles the complete request/response cycle in a single call: it constructs URLs, builds payloads, resolves the thinking mode, transmits with retry logic, and finally interprets the response through the normalization helpers. It is an async method that takes a livewiki `GenerateRequest` and returns a livewiki `GenerateResult`.

```ts
async generate(req: GenerateRequest): Promise<GenerateResult> {
```

The generation path proceeds through five clear stages.

First, URL construction: the adapter strips the trailing slash from the configured base URL and checks whether that base already ends in `/v1`. If it does not, it appends `/v1/chat/completions`; if it does, it appends only `/chat/completions`. This handles providers where the given base URL is either a bare domain or a fully-qualified versioned API root.

Second, payload assembly: the adapter always includes the model name and a two-message conversation comprising a system and a user message; a temperature is added only when the caller explicitly set one. The max token limit defaults to 4096 unless a request specifies otherwise. The adapter then picks which token field to send based on a request-level flag that falls back to the constructor-level preference: when that preference is true, it sends `max_completion_tokens`; otherwise it sends the broader-compatible `max_tokens`.

Third, thinking resolution: the adapter delegates to `resolveThinkingMode` with the request's explicit thinking preference, the constructor's default thinking mode, and the model name. The standalone `resolveThinkingMode` function is where the MiniMax-M3-specific logic lives: when a request does not specify a thinking mode, and the model name matches the pattern `minimax-m3` (case-insensitive whole-string or substring), the adapter forces thinking to be disabled rather than letting the API default to enabled. Other models with no explicit preference receive `"omit"`, which attaches no thinking field at all to the request body.

The `resolveThinkingMode` function's signature indicates the inputs and output:

```ts
export function resolveThinkingMode(
  requestThinking: ThinkingMode | undefined,
  adapterDefault: ThinkingMode | "n/a",
  model: string,
): ThinkingMode | "omit" {
```

This function internally prioritizes an explicit request-level preference of `"adaptive"` or `"disabled"` — such as when a caller opts into adaptive thinking despite the MiniMax heuristic — then falls back to the adapter default, and finally to the model-name heuristic. It checks the request against the model name to special-case MiniMax-M3 deployments that would otherwise enable thinking silently.

Fourth, transmission: the adapter POSTs the JSON body to the constructed endpoint using the shared `requestWithRetry` helper, passing a bearer-token authorization header and a JSON content type. This helper abstracts retry-on-failure policy and error classification, keeping retry logic out of this adapter's own flow.

Fifth, response interpretation: the adapter reads the provider's JSON response and extracts the first choice's content text (falling back to an empty string when no choice exists). It then runs the response through the `normalizeUsage` and `normalizeFinishReason` helpers described below to produce the structured fields of the `GenerateResult`, and finally returns that result object with the content, usage block, and stop reason. When the raw finish reason is present in the response, the adapter forwards it under the `rawStopReason` key untouched, preserving provider-specific detail for downstream diagnostics.

## Output Normalization

<!-- lw:anchors packages/core/src/llm/openai-compat.ts#normalizeUsage packages/core/src/llm/openai-compat.ts#normalizeFinishReason -->

These two module-private functions exist to translate the provider's raw, OpenAI-flavored response fields into the provider-agnostic types that the rest of livewiki consumes. Without them, every downstream consumer would have to know the exact spelling and meaning of each provider's JSON fields. Their existence ensures the adapter's public contract returns livewiki's own types, regardless of which OpenAI-compatible API answered the request.

`normalizeUsage` receives the provider's full response body and returns a standardized usage summary, or null when the body does not carry usable usage. It is a module-private helper function:

```ts
function normalizeUsage(raw: OpenAiCompatResponse): LlmUsage | null {
```

The function checks that the `usage` block exists and that both `prompt_tokens` and `completion_tokens` are finite numbers. If any of those checks fail — for instance when a proxy omits usage entirely — it returns `null`, and the caller represents that as an unknown provision rather than fabricating zeros. This choice is deliberate: synthesized zeros would mask cost reporting by looking identical to a free call. When the usage block is valid, the function builds an `LlmUsage` that counts input and output tokens and records the model name; if the provider reports reasoning tokens separately, those are preserved too.

`normalizeFinishReason` takes the raw `finish_reason` string from the first choice and maps it to a canonical `StopReason`, returning one of four finite states. It reports a `"complete"` case when the provider explicitly says generation stopped, `"length"` when the output hit the token budget, `"incomplete"` for any other provider-specific reason (such as content filtering or cancellation), and `"unknown"` when the provider sent no reason at all. This coarse taxonomy keeps downstream code stable even as providers add new finish reasons the adapter does not yet document.