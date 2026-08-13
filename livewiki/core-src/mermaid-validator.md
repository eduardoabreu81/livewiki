---
title: Mermaid syntax validator
owner: generated
anchors:
  - packages/core/src/mermaid-validator.ts#validateMermaidSyntax
  - packages/core/src/mermaid-validator.ts#parseWithTemporaryDom
  - packages/core/src/mermaid-validator.ts#restoreGlobal
---

# Mermaid syntax validator

This page documents the small Node-side helper that asks Mermaid's real parser whether a Mermaid diagram string is well-formed, while carefully managing the browser globals that Mermaid expects.

## When to use this page

- **Verify** that an arbitrary Mermaid source string compiles without syntax errors before the runtime tries to render it.
- **Diagnose** a broken diagram by reading the concise error message this module returns from Mermaid's parser.
- **Reason about** the temporary `window`/`document` swap and the call-serialization pattern when changing or testing the validator.
- **Trace** how the validator fits next to other components that emit Mermaid, by reviewing the diagram below.

## How it fits

`packages/core/src/mermaid-validator.ts` lives in the `packages/core` source tree and is the only place in the codebase that drives Mermaid's parser from a Node process. Mermaid's parser is browser-oriented: it touches `window` and `document` even when it is only asked to parse, not to render. Because this package runs under Node, the file has to fabricate those globals, hand them to Mermaid for the duration of one parse, and then put the original globals back. Other modules in the package can therefore hand a candidate Mermaid string to `validateMermaidSyntax` and trust the answer to be "valid" (`null`) or "this is the parser's complaint" (a short string). The file also serializes concurrent calls because the globals it swaps are process-wide: two simultaneous parses would race on the same `window`/`document` slot.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-mermaid-validator.mmd
```

## Serializing concurrent calls

<!-- lw:anchors packages/core/src/mermaid-validator.ts#validateMermaidSyntax -->

The file declares `validationQueue`, a module-scoped promise that starts as `Promise.resolve()` and is rewritten on every call. The exported `validateMermaidSyntax` function chains its work onto that queue both for the success and the rejection branch, so a thrown parse never breaks the chain for later callers, and replaces the queue with a follow-up that swallows the result. The net effect is that two callers racing into the validator end up running their parses one after the other, which is required because the swap this module performs touches `globalThis.window` and `globalThis.document` — process-wide slots that would otherwise interleave between concurrent parses.

```ts
export function validateMermaidSyntax(source: string): Promise<string | null>
```

`validateMermaidSyntax` takes a Mermaid `source` string and returns a `Promise` that resolves to `null` when the diagram parses cleanly or to a concise diagnostic string (the parser's `Error.message`, or its string form) when it does not. It performs no parsing itself; it just schedules one.

## Parsing with a temporary DOM

<!-- lw:anchors packages/core/src/mermaid-validator.ts#parseWithTemporaryDom -->

This is the only function in the file that actually talks to Mermaid. The rationale evidence explains why: Mermaid expects a browser-like `window` and `document` even when only its parser is used, so the function installs a JSDOM-backed pair of globals for the duration of one parse and restores them afterwards. A single shared JSDOM instance (`parserDom`) is constructed at module load so the parse reuses one DOM rather than rebuilding one each call.

```ts
async function parseWithTemporaryDom(source: string): Promise<string | null>
```

`parseWithTemporaryDom` takes a Mermaid `source` string and returns `null` when parsing succeeds or a short error message when it throws. It performs the temporary DOM swap, lazy-loads Mermaid on first use, runs `mermaid.parse`, and restores the previous globals in a `finally` so an exception during parsing still returns the host to its original state. The lazy import is also where `mermaid.initialize({ startOnLoad: false })` is called once, telling Mermaid not to scan the (fictional) DOM on its own — the validator only ever invokes `parse` explicitly.

```ts
await mermaidInstance.parse(source);
```

If `mermaid.parse` throws, the function returns `error instanceof Error ? error.message : String(error)` — a concise diagnostic suitable for surfacing to a user. If it resolves, the function returns `null`. The visible source contains no other branches: there is no retry, no normalization, and no fallback parser.

## Restoring the original globals

<!-- lw:anchors packages/core/src/mermaid-validator.ts#restoreGlobal -->

The `parseWithTemporaryDom` function records, before swapping, three facts about each global it is about to overwrite: whether the key already existed on `globalThis`, and what the previous value was. Those facts are captured up front so the `finally` block can faithfully restore them — including the case where `window` or `document` was not defined at all on the host.

```ts
function restoreGlobal(
  globals: Record<string, unknown>,
  key: string,
  existed: boolean,
  previous: unknown,
): void
```

`restoreGlobal` takes the globals object, the key being restored (`"window"` or `"document"`), the `existed` flag captured before the swap, and the `previous` value. It puts the previous value back when the key originally existed, or `delete`s the key when it did not, so the host's global shape is byte-for-byte identical to what it was before the parse. This is the only branch in the function — it does not, for example, assign `undefined` in the not-existed case.
