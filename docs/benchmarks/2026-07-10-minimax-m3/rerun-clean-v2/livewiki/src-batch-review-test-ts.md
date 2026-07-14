---
title: src-batch-review-test-ts
owner: generated
anchors:
  - packages/core/src/batch-review.test.ts#MockLlm
  - packages/core/src/batch-review.test.ts#MockLlm.generate
---

## MockLlm

<!-- lw:anchors packages/core/src/batch-review.test.ts#MockLlm packages/core/src/batch-review.test.ts#MockLlm.generate -->

Programmable `LlmClient` used by the regression suite in `packages/core/src/batch-review.test.ts`. Each instance is scoped to a single test via `beforeEach` and tracks every call so assertions can verify LLM behaviour without network access.

Fields:

- `provider` — fixed to `"anthropic"`.
- `model` — fixed to `"claude-test-mock"`.
- `callCount` — number of `generate` invocations (used to assert zero-call or fixed-count paths).
- `responses` — optional pre-seeded responses indexed by `callCount - 1`; when the slot is empty, the mock synthesises a valid artifact from the prompt's closed key list.
- `costInputs` — every `GenerateResult.usage` pushed here, used by pricing tests to inspect per-call token accounting.

The synthesised artifact produced when `responses` is empty contains a valid frontmatter (`title`, `owner: generated`, anchors derived from the closed list) and a minimal body, so tests that only need "some valid page" do not have to pre-seed `responses`.

## MockLlm.generate

<!-- lw:anchors packages/core/src/batch-review.test.ts#MockLlm.generate -->

`async generate(req: GenerateRequest): Promise<GenerateResult>` — increments `callCount`, then returns either `responses[callCount - 1]` if pre-seeded, or a synthesised valid artifact. The synthesis step parses lines beginning with `- <key>` from `req.user` to recover the closed key list passed to the prompt, then emits a frontmatter block whose `anchors` mirror that list. Resulting `usage` is `{ inputTokens: 100, outputTokens: 50, model: this.model }` and is pushed onto `costInputs` before return.

This method is the single point through which every regression test exercises the LLM boundary; assertions on `callCount`, `costInputs`, and on-disk page contents derive from it.