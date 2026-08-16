---
title: packages/core/src/llm
owner: generated
---

# packages/core/src/llm

The `packages/core/src/llm/` directory is the engine's seam to external large-language-model providers: it defines the `LlmClient` interface and shared `GenerateResult` types, supplies a single fetch/retry/timeout wrapper used by every adapter (`base.ts`), and ships concrete provider implementations for Anthropic (`anthropic.ts`) and any OpenAI-compatible HTTP service such as OpenRouter, LiteLLM, or local backends (`openai-compat.ts`). `index.ts` is the public entry that validates configuration, resolves the provider, and instantiates the right adapter, so the rest of the core package talks to LLMs through one uniform surface.

## Files

- [anthropic.ts](anthropic.md) — Anthropic Messages API adapter
- [base.ts](base.md) — Shared HTTP adapter for LLM provider requests
- [index.ts](index-ts.md) — LLM client factory and error types
- [openai-compat.ts](openai-compat.md) — OpenAI-compatible LLM adapter
- `types.ts` — not documented (re-export, configuration, or plain-text file)

### Test files without a same-name counterpart

- `adapters.test.ts` — no product file in this repository matches this test
- `create-client-timeout.test.ts` — no product file in this repository matches this test

None of the 4 documented files in this folder has a test file named after it.

<!-- livewiki:navigate:start -->
## Navigate

- Flow: [Turning a CLI command into an LLM call](../flows/cli-src-to-llm.md)
- Topic: [Testing](../topics/testing-f41eeea7.md)
- [packages/cli/src/commands](../commands/index.md) — depends on this folder
- [packages/core/src](../core-src/index.md) — used both ways

> Coverage note: this folder's source (10 files, ~64k chars) is too large to read in full; this page documents its main entry points.
<!-- livewiki:navigate:end -->
