---
title: packages/core/src/llm
owner: generated
---

# packages/core/src/llm

The `llm` directory implements livewiki's LLM client layer: code that turns a validated repository configuration into a working interface for generating content from a language model. Its public surface, `index.ts`, exposes a factory returning an `LlmClient` — either an Anthropic Messages adapter or an OpenAI-compatible adapter — plus the error types callers handle. `base.ts` supplies a shared fetch, retry, and timeout wrapper underpinning every provider client, while `anthropic.ts` and `openai-compat.ts` translate a common `GenerateRequest` into each provider's HTTP protocol and normalize responses into a shared `GenerateResult`. Finally, `probe.ts` runs a connectivity probe validating an endpoint before any paid run, guarding against providers that silently change behavior.

## Files

- [anthropic.ts](anthropic.md) — Anthropic Messages API adapter
- [base.ts](base.md) — Shared HTTP adapter for LLM provider requests
- [index.ts](index-ts.md) — LLM Client Factory and Error Types
- [openai-compat.ts](openai-compat.md) — OpenAI-Compatible Chat API Adapter
- [probe.ts](probe.md) — Provider Connectivity and Reasoning-Leak Probe · Tests: `probe.test.ts`
- `types.ts` — not documented (re-export, configuration, or plain-text file)

### Test files without a same-name counterpart

- `adapters.test.ts` — no product file in this repository matches this test
- `create-client-timeout.test.ts` — no product file in this repository matches this test
- `credential-resolution.test.ts` — no product file in this repository matches this test

1 of the 5 documented files in this folder have a test file named after them.

<!-- livewiki:navigate:start -->
## Navigate

- Flow: [From CLI Source to Core Source: How livewiki Commands Drive Core Operations](../flows/cli-src-to-core-src.md)
- Topic: [CLI Commands and Core LLM Coordination](../topics/cli-commands-and-core-llm-coordination-2166f507.md)
- [packages/cli/src/commands](../commands/index.md) — depends on this folder
- [packages/core/src](../core-src/index.md) — used both ways

> Coverage note: this folder's source (10 files, ~66k chars) is too large to read in full; this page documents its main entry points.
<!-- livewiki:navigate:end -->
