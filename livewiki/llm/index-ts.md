---
title: LLM client factory and error types
owner: generated
anchors:
  - packages/core/src/llm/index.ts#LlmRequestError
  - packages/core/src/llm/index.ts#LlmRequestError.constructor
  - packages/core/src/llm/index.ts#MissingApiKeyError
  - packages/core/src/llm/index.ts#MissingApiKeyError.constructor
  - packages/core/src/llm/index.ts#createLlmClient
---

# LLM client factory and error types

This module owns the public surface for talking to large-language-model providers: it validates configuration, resolves which provider to call, reads the API key from the environment, and instantiates the right HTTP adapter, plus the two error types that callers handle when something goes wrong.

## When to use this page

- **Build an `LlmClient`** for a batch run by calling `createLlmClient` once the `LivewikiConfig` is loaded.
- **Diagnose a missing API key** by catching `MissingApiKeyError` and surfacing the expected env var name.
- **Handle an upstream provider failure** by catching `LlmRequestError` and inspecting its `status` and `errorBody`.
- **Re-export shared types** like `GenerateRequest`, `GenerateResult`, `LlmUsage`, `StopReason`, and `LlmTimeoutError` for downstream modules.

## How it fits

`packages/core/src/llm/index.ts` is the entry seam between the batch runner (`batch.ts`) and the provider-specific HTTP adapters. The batch layer hands it a validated `LivewikiConfig` and receives back an `LlmClient` whose single `generate(req)` method is the only thing the batch code ever needs to know about. Configuration concerns — provider/model/timeout validation, preset expansion, and base-URL defaults — are delegated to `config.ts`; transport concerns — request signing, retries, timeout enforcement — live in the adapters (`AnthropicAdapter`, `OpenAiCompatAdapter`) and the shared `base.ts` that they extend. This module re-exports types and the timeout error from those siblings so that callers only need a single import path.

The file also defines two domain-specific error classes. They are the only error types `createLlmClient` and the adapters throw that callers are expected to distinguish; missing-config failures surface as `MissingProviderConfigError` from `config.ts`, and upstream HTTP failures surface as `LlmRequestError`.

## Diagram

```mermaid
%% livewiki/diagrams/llm-index-ts.mmd
```

## Provider resolution and client construction

<!-- lw:anchors packages/core/src/llm/index.ts#createLlmClient -->

The factory is the one place where configuration becomes a usable client, so the steps inside it have to happen in a strict order: validate first, resolve the provider record second, read the API key third, and only then pick an adapter. Skipping validation would let a malformed `LivewikiConfig` produce a client that misbehaves at request time; reading the key before validation would risk leaking the env-var name in a less helpful error message.

The signature below is the only thing callers ever need to invoke this code:

```ts
export function createLlmClient(repoRoot: string, config: LivewikiConfig): LlmClient
```

It takes the repository root (so config validation can resolve relative paths) and a `LivewikiConfig`, and returns an `LlmClient` whose `provider`, `model`, and `generate` method are the public contract.

Concretely, `createLlmClient` runs four steps:

1. **Validate the config.** It calls `validateConfigForBatch(repoRoot, config)` from `config.ts`. That call is what enforces provider/model presence and `timeoutMs` shape, and is the source of `MissingProviderConfigError` when those are missing — `createLlmClient` does not reimplement those checks.
2. **Resolve the provider record.** `resolveProviderFromConfig(config)` collapses either a preset (Phase 5 form, e.g. `"minimax"`) or a legacy `config.provider` into a single record carrying `adapter`, `baseUrl`, `envVar`, `thinkingDefault`, and `preferMaxCompletionTokens`. The `model` field is read straight off `config.model`, since validation already confirmed it is a string. A `baseUrl` is then picked with `resolved.baseUrl || resolveBaseUrl(config)` so an explicit config URL wins over a preset URL, which wins over the adapter default.
3. **Read the API key from the environment.** `process.env[resolved.envVar]` is the only place the key is ever looked up. When the variable is unset, the factory throws `MissingApiKeyError` rather than returning a half-built client, so callers cannot accidentally make requests without authentication. Timeout options are then assembled with an explicit `undefined` check so that `timeoutMs: 0` (the documented "disable" sentinel) is preserved instead of being collapsed to a default.
4. **Instantiate the adapter.** The `resolved.adapter` value picks between `AnthropicAdapter` and `OpenAiCompatAdapter`. The OpenAI-compatible branch additionally forwards `thinkingDefault` and `preferMaxCompletionTokens` from the preset, because those knobs are meaningless for the Anthropic wire format but matter for OpenAI-compatible providers that mimic OpenRouter/LiteLLM/Ollama behavior.

The visible throw chain therefore is: missing provider/model/timeout → `MissingProviderConfigError` (from `validateConfigForBatch`); missing API key → `MissingApiKeyError` (from this file); upstream failure → `LlmRequestError` (from the adapters, surfaced through `generate`).

## Missing API key error

<!-- lw:anchors packages/core/src/llm/index.ts#MissingApiKeyError packages/core/src/llm/index.ts#MissingApiKeyError.constructor -->

This error exists so that a missing credential is reported with the exact env var name the caller has to set, without ever echoing the credential itself (which, by construction, is absent). `createLlmClient` is the only direct thrower in this file; the adapters do not throw it.

```ts
export class MissingApiKeyError extends Error {
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

The constructor takes the resolved `provider` name and the `envVar` string that `resolveProviderFromConfig` decided on, and produces an `Error` whose message names both. The `provider` and `envVar` are stored as readonly fields so programmatic callers can branch on them without re-parsing the message. Because the value of the key is never read in the missing path, the error message cannot leak it — there is nothing to leak.

## LLM request error

<!-- lw:anchors packages/core/src/llm/index.ts#LlmRequestError packages/core/src/llm/index.ts#LlmRequestError.constructor -->

When the provider actually responds with a failure status, or a transport-level error surfaces, the adapters raise `LlmRequestError`. The class is defined here so that batch code and any other consumer can `instanceof`-check against a single, stable type from the public entry point.

```ts
export class LlmRequestError extends Error {
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

The constructor takes the `provider` name, the HTTP `status` code, and the raw `errorBody` string returned (or assembled) by the adapter. Three things are worth noting from the visible source. First, the message truncates `errorBody` to 500 characters and appends `"..."`, so a huge provider payload does not blow up logs and stack traces — the visible check is a one-sided upper cap, not a guarantee about minimum body size. Second, `this.errorBody = errorBody` stores the **untruncated** body on the instance, so programmatic consumers (test assertions, structured logging) still see the full payload; only the human-facing `message` is clipped. Third, response headers are deliberately never put on the error, because headers are where API keys live — this is the invariant that the `key-leak.test.ts` companion (handled outside this page) exists to enforce.
