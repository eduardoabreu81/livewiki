---
title: src-batch-repair-test-ts
owner: generated
anchors:
  - packages/core/src/batch-repair.test.ts#ProgrammableMockLlm
  - packages/core/src/batch-repair.test.ts#ProgrammableMockLlm.generate
  - packages/core/src/batch-repair.test.ts#makeValidPage
---

# src-batch-repair-test-ts

Test module covering Phase-5 plan (X): bounded corrective repair, transactional write, and defensive gates. Verifies criteria #6–#8 and #10 around the `runBatch` orchestration path.

## ProgrammableMockLlm
<!-- lw:anchors packages/core/src/batch-repair.test.ts#ProgrammableMockLlm -->

A controllable `LlmClient` used by the test suite to deterministically drive `runBatch` through initial and repair attempts.

- `provider`: literal `"anthropic"`.
- `model`: `"claude-test-mock"`.
- `responses: string[]` — queue of page strings; consumed by index, falling back to the last entry.
- `throwOn: Set<number>` — call indices at which `generate` throws a simulated LLM failure.
- `callCount` — incremented on every invocation.
- `callLog` — captures `{ system, user }` per call so tests can inspect the repair prompt shape.
- `autoPageFromPrompt` — when true, the mock parses the closed key list out of the user prompt and synthesizes a valid page via `makeValidPage`.

Implements `LlmClient`; the only required surface is `generate`.

## ProgrammableMockLlm.generate
<!-- lw:anchors packages/core/src/batch-repair.test.ts#ProgrammableMockLlm.generate -->

```ts
async generate(req: import("./llm/types.js").GenerateRequest): Promise<GenerateResult>
```

Per-call behaviour:

1. Push `{ system: req.system, user: req.user }` onto `callLog`.
2. Resolve `idx = callCount`, then increment `callCount`.
3. If `throwOn.has(idx)`, throw `Error("simulated LLM failure at call <idx>")`.
4. Scan `req.user` line by line for `^- (\S+)$`; collect matches as `closedKeys`.
5. Pick response content:
   - If `autoPageFromPrompt` and `closedKeys.length > 0`, return `makeValidPage(closedKeys)`.
   - Otherwise, return `responses[idx] ?? responses[responses.length - 1] ?? ""`.
6. Return `{ content, usage: { inputTokens: 100, outputTokens: 50, model: this.model } }`.

Used to simulate both the initial generation call and bounded repair attempts without hitting a real provider.

## makeValidPage
<!-- lw:anchors packages/core/src/batch-repair.test.ts#makeValidPage -->

```ts
function makeValidPage(closedKeyList: string[]): string
```

Builds a minimal, validator-acceptable page from a closed key list. Output shape:

- Frontmatter block with `title: test`, `owner: generated`, and an `anchors:` list containing every entry of `closedKeyList`.
- A heading `# test`.
- A single `<!-- lw:anchors <firstKey> -->` marker using the first key in the list (fallback `src/x.ts#placeholder` when the list is empty).
- A short `Body.` paragraph.

The returned string joins all parts with `\n`, producing a deterministic fixture that passes the closed-list and frontmatter validation gates.