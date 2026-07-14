---
title: packages/core/src/batch.test.ts
owner: generated
anchors:
  - packages/core/src/batch.test.ts#MockLlm
  - packages/core/src/batch.test.ts#MockLlm.generate
---

# packages/core/src/batch.test.ts

Test module covering the end-to-end batch orchestrator with a mock LLM client. Provides fixture utilities (mock LLM, temp repo) and exercises `runBatch` / `runOnly` for pipeline correctness, refine toggling, and checkpoint persistence.

## MockLlm

<!-- lw:anchors packages/core/src/batch.test.ts#MockLlm -->

`MockLlm` is a test double implementing the `LlmClient` interface used by the batch pipeline. It returns deterministic Markdown containing a frontmatter block and an anchor marker, avoiding real provider calls.

### Properties

- `provider`: literal `"anthropic"`, typed `as const`.
- `model`: string identifier (`"claude-test-mock"`) reported back through usage metrics.
- `callCount`: monotonically incremented on every `generate` invocation, used by tests to assert the number of LLM calls produced by a given pipeline configuration.

### Behavior

`generate` parses two facts out of the inbound `user` prompt:

- `moduleId` — extracted via the regex `# Module: <id>`, falling back to `"unknown"` when absent.
- `firstKey` — extracted via the regex `^- (.+?#[\w.]+)$` (first canonical key line), falling back to `${moduleId}.ts#placeholder`.

It then returns a Markdown body whose frontmatter sets `title`, `owner: generated`, and `anchors: [firstKey]`, followed by a single `## Details` section whose section marker embeds the resolved anchor key.

### Returned shape

`generate` returns a `GenerateResult` whose `content` is the Markdown string above and whose `usage` reports fixed token counts (`inputTokens: 100`, `outputTokens: 50`) plus the mock model name.

## MockLlm.generate

<!-- lw:anchors packages/core/src/batch.test.ts#MockLlm.generate -->

`async generate(req: import("./llm/types.js").GenerateRequest): Promise<GenerateResult>`

Side effects on entry:

- Increments `this.callCount`.

Inputs read from `req.user`:

- `# Module: <id>` line → `moduleId`.
- First `- <anchor>` line → `firstKey`.

Output:

- `content`: a Markdown document with valid frontmatter (`title`, `owner: generated`, `anchors`) and a section marker carrying `firstKey`.
- `usage`: `{ inputTokens: 100, outputTokens: 50, model: this.model }`.

The method is pure with respect to filesystem state — it does not read or write any disk resources. Its only observable effect is the `callCount` mutation, which the tests rely on to verify pipeline call budgets (e.g. stage-4-only vs. stage-2 + stage-4).

## Test fixture scaffolding (informational)

The module also defines:

- A `beforeEach` that creates a fresh temp directory via `nodeFs.mkdtemp` (prefix `"livewiki-batch-"`), lays down a minimal `src/auth/login.ts` containing a single `login()` export, and instantiates `mockLlm`.
- An `afterEach` that recursively removes the temp `repoRoot`.

These are not part of the symbol table, but they define the repository shape the mock generates documentation for.

## Test coverage (informational)

Two `describe` blocks exercise the public batch entry points:

- `batch.runBatch — orquestrador end-to-end com mock LLM` — verifies `status === "completed"`, that `livewiki/auth.md` is written with `title: auth`, that the manifest is written with `"version": 1`, that the default `--no-refine` path issues exactly one LLM call (stage 4 only), that enabling refine produces two calls (stage 2 + stage 4), and that stage-4 checkpoints carry a populated `usageHistory` reflecting the mock model and positive token counts.
- `batch.runOnly — re-roda 1 task` — runs the batch once, then re-runs a single target module via `runOnly`, and asserts that the resulting checkpoint has `attempt === 2` and a `usageHistory` of length 2 (original + retry).

The `TODO` tests above are the only documented entry points; any additional assertions beyond these would need to be re-derived from the source.