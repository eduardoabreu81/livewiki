---
title: Llm Tests
owner: generated
anchors:
  - packages/core/src/llm/adapters.test.ts#fakeFetch
---

# Llm Tests

`llm-tests` is classified as automated tests rather than product runtime code, so this page documents its symbols without presenting them as part of the shipped product.

## When to use this page

- You are debugging a failing test and need to see what this suite covers.
- You are adding a test for a behavior that this module's product code already handles.
- You are checking whether a code path has test coverage before changing it.

## How it fits

This module spans 2 files classified as automated tests. It exists so its symbols stay addressable from anchors and cross-references, without appearing in the primary product hubs.

## Reference

### fakeFetch
<!-- lw:anchors packages/core/src/llm/adapters.test.ts#fakeFetch -->

`function fakeFetch(response: { status?: number; body?: unknown; ok?: boolean }): typeof fetch {` is a function defined in `packages/core/src/llm/adapters.test.ts`, part of the automated tests surface of `llm-tests` — not part of the product's runtime behavior.

<!-- livewiki:navigate:start -->
## Navigate

- [LLM client and provider adapters](llm.md) — dependency
<!-- livewiki:navigate:end -->
