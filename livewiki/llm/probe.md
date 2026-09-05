---
title: Provider Connectivity and Reasoning-Leak Probe
owner: generated
anchors:
- packages/core/src/llm/probe.ts#formatProbeFailure
- packages/core/src/llm/probe.ts#probeProvider
---

# Provider Connectivity and Reasoning-Leak Probe

This page documents the bounded connectivity and thinking-leak probe that validates an LLM endpoint before any paid run.

## When to use this page

- Understand how `probeProvider` verifies that a configured LLM endpoint answers with usable content.
- Learn how the probe detects reasoning leakage that could silently burn output budgets.
- See how `formatProbeFailure` turns a failed probe into a one-line human remediation message.
- Trace the probe's role in setup-time and run-time verification workflows.

## How it fits

The `llm/probe` module lives in `packages/core/src/llm/` alongside the LLM client factory it imports (`createLlmClient` from `./index.js`). It guards against a documented dogfood incident where a provider changed its defaults without notice and enabled reasoning which consumed the entire output budget. The probe sends a minimal request matching what the resolved configuration would send, costs only a handful of tokens, and answers two questions before any paid run: does the endpoint answer with usable content, and does reasoning leak anyway? `livewiki config` invokes it during setup-time verification, and the batch preflight uses it at run time before starting work. The probe never writes anything and never logs or returns credential material.

## Diagram

```mermaid
%% livewiki/diagrams/llm-probe.mmd
```

## Probe Execution

<!-- lw:anchors packages/core/src/llm/probe.ts#probeProvider -->

`probeProvider` exists to answer whether an LLM endpoint works and whether it leaks reasoning, before the system spends real money on a paid run. The function operates in two distinct phases: first it creates a client, then it sends a minimal request and analyzes the response.

The function signature is:

```ts
export async function probeProvider(
  repoRoot: string,
  config: LivewikiConfig,
): Promise<ProviderProbeResult>
```

This function takes a repository root path and a `LivewikiConfig` object, then returns a `ProviderProbeResult` describing the probe outcome. The `ProviderProbeResult` interface exposes five fields: `ok` (the endpoint answered with non-empty content), `thinkingLeak` (reasoning appeared in the response), `modelEcho` (the model id the provider echoed, which may differ from the configured alias), `reasoningTokens` (how many reasoning tokens were reported, or 0), and `error` (a failure detail when the probe could not complete).

The function first defines a local `failed` helper that takes an unknown error and returns a `ProviderProbeResult` with `ok` set to `false`, `thinkingLeak` set to `false`, `modelEcho` set to `null`, `reasoningTokens` set to 0, and `error` set to a string form of the error. If the error is an `Error` instance, it uses the error's message; otherwise it strings the error value directly.

Execution begins with client creation. The function calls `createLlmClient(repoRoot, config)` inside a try/catch block. If client creation throws — for example, because the configuration references an invalid model or a malformed base URL — the `failed` helper catches that error and returns immediately, so the probe reports the configuration problem without ever attempting a network call.

When the client is created successfully, the function enters a second try/catch block around the actual generation call. It invokes `client.generate` with a system prompt of `PROBE_SYSTEM` (the constant string "You are a connectivity probe. Reply with exactly: OK"), a user prompt of `PROBE_USER` (the constant string "Reply with exactly: OK"), and a `maxTokens` bound of `PROBE_MAX_TOKENS` (the constant 32). That low token cap keeps the probe cheap while still verifying the endpoint responds.

The response analysis derives reasoning tokens from `result.usage?.reasoningTokens`, defaulting to 0 when the provider reports no usage object or no reasoning field — the probe never invents numbers. It separately checks for an inline `<think` block by testing `result.content` against the regular expression `/<?think[\s>]/`, which matches an opening `<think` tag followed by whitespace or a closing angle bracket. The function then returns a result whose `ok` field is true only when the trimmed content is non-empty, whose `thinkingLeak` is true when either reasoning tokens exceed zero or the inline `<think` pattern matches, whose `modelEcho` comes from `result.usage?.model` (or `null` when unavailable), whose `reasoningTokens` is the computed numeric value, and whose `error` is `null` for a successful probe.

If the `generate` call itself throws — a timeout, a network refusal, or a provider-side error — the catch block routes that error through the same `failed` helper, returning a failure result with no reasoning assertions. This two-stage error handling means a configuration failure and a runtime request failure produce the same `ProviderProbeResult` shape, which keeps the caller's handling uniform.

## Failure Formatting

<!-- lw:anchors packages/core/src/llm/probe.ts#formatProbeFailure -->

`formatProbeFailure` exists to convert a failed probe result into a single line of actionable remediation text that a human can read and act on. Its purpose is to name configuration slots only, never credentials, so that the message can appear in logs and terminal output without leaking sensitive material.

The function signature is:

```ts
export function formatProbeFailure(probe: ProviderProbeResult): string {
```

This function takes a `ProviderProbeResult` value and returns a string containing the remediation guidance.

The function branches on the `thinkingLeak` field first. When `thinkingLeak` is `true`, the returned message explains that the provider returned reasoning (citing the actual `reasoningTokens` count or noting an inline `<think>` block), reminds the reader that reasoning burns the output budget and truncates pages, and instructs them to set `"thinking": "disabled"` in `.livewiki/config.json` or choose a model without default reasoning.

When `thinkingLeak` is `false`, the function falls back to the connectivity failure path. It reports that the provider did not answer a minimal request, citing either the `error` detail when present or the literal fallback text `"empty response"` when the error field is `null` (which would happen if the endpoint answered but with empty content). The message then directs the user to check the preset, model, and baseUrl configuration slots along with the credential, again avoiding any credential values in the output.

## Tests

Covered by `packages/core/src/llm/probe.test.ts` (same-name test file on disk).
