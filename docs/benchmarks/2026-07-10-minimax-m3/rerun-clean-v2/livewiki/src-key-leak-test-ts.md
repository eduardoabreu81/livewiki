---
title: src-key-leak.test.ts
owner: generated
anchors:
  - packages/core/src/key-leak.test.ts#assertCanaryNotPresent
---

# src-key-leak.test.ts

Regression suite ensuring the livewiki core never leaks API key material into any user-observable surface (error messages, persisted JSON, console logs).

The suite injects a recognisable canary value (`KEY-LEAK-CANARY-DONOTUSE-7f3a`) into every code path that touches credentials and asserts the canary is absent from outputs. A failure of any test in this file means a sensitive string has reached a sink and the change must not be committed.

## Canary guard helper

<!-- lw:anchors packages/core/src/key-leak.test.ts#assertCanaryNotPresent -->

`assertCanaryNotPresent(value: string, context: string): void` — single-purpose guard used by every test in the file. Throws an `Error` whose message embeds the offending context and a 500-char slice of the leaking value if `value.includes(CANARY_KEY)`. All other assertions in this file delegate the no-leak check to this helper, so its behaviour is the contract for "no key leak detected".

The helper is intentionally cheap and synchronous: it does no allocation beyond the throw-path and performs a single substring check.

## Test surfaces covered

The suite exercises the following sinks:

- `MissingApiKeyError.message` — must reference only the env-var name, not the value.
- `MissingProviderConfigError.message` and `.stack` — provider/model strings only.
- `LlmRequestError.message` / `.stack` from `AnthropicAdapter` when a provider returns a 500 body containing the canary.
- `config.json` on disk (after `saveConfig`) and the JSON form returned by `loadConfig`.
- `checkpoint_json` serialisation with a populated `usageHistory` array.
- `batch_run.summary_json` aggregation (`totals`, `byStage`, `byModule`).
- `console.log` / `console.warn` / `console.error` output captured via `vi.spyOn` across every scenario above.

A positive check is also performed: `AnthropicAdapter` must place the key in the `x-api-key` request header (that is the correct destination), while still keeping it out of every other observable.

## Running

```
pnpm vitest run packages/core/src/key-leak.test.ts
```

The test uses a per-test `mkdtemp` directory under the OS temp dir and restores `process.env.ANTHROPIC_API_KEY` / `OPENAI_API_KEY` in `finally` blocks, so it is safe to run alongside the rest of the suite.