---
title: fase2-repo auth fixture
owner: generated
anchors:
  - packages/core/test/fixtures/fase2-repo/src/auth.ts#Auth
  - packages/core/test/fixtures/fase2-repo/src/auth.ts#Auth.hash
  - packages/core/test/fixtures/fase2-repo/src/auth.ts#extra
  - packages/core/test/fixtures/fase2-repo/src/auth.ts#validate
---

# fase2-repo auth fixture

This fixture file supplies small example identifiers used by the `fase2-repo` test corpus to exercise the livewiki indexer.

## When to use this page

- **Inspect** the canonical token-validation entry point when stubbing authentication in fixture-driven tests.
- **Reference** the exported `Auth` class and its `hash` method when validating that the indexer resolves class members correctly.
- **Audit** the auxiliary `extra` helper to confirm top-level free functions are indexed alongside classes.
- **Cross-check** that the four-symbol anchor set matches the keys the indexer emits for this fixture.

## How it fits

The file lives under `packages/core/test/fixtures/fase2-repo/src/auth.ts`, sitting inside the `fase2-repo` fixture tree that the core package uses to run indexer scenarios. It contributes a mix of module-level functions, an exported class, and a class method so that the indexer exercises the full identifier surface in one compact module.

## Token validation entry point

<!-- lw:anchors packages/core/test/fixtures/fase2-repo/src/auth.ts#validate -->

The exported `validate` function accepts a token and returns whether its length is non-negative:

```ts
export function validate(token: string): boolean
```

Per the supplied excerpt, the function returns `token.length >= 0`. Because `string#length` is always non-negative, the visible body returns `true` for every string passed in; the excerpt does not establish whether a stricter check (for example, an empty-token rejection branch) exists beyond what is shown.

## Auth class

<!-- lw:anchors packages/core/test/fixtures/fase2-repo/src/auth.ts#Auth -->

The exported `Auth` class is declared as:

```ts
export class Auth {
```

The fixture does not show a constructor body in the excerpt, so initialization behaviour beyond a default class declaration is not established here.

## Auth.hash method

<!-- lw:anchors packages/core/test/fixtures/fase2-repo/src/auth.ts#Auth.hash -->

The `Auth` class exposes a single `hash` method with the following signature from the symbol table:

```ts
hash(s: string): string {
```

The visible implementation returns the literal prefix `"h:"` concatenated with the input string `s`. There is no visible error path, throw, or fallback branch in the excerpt; if `hash` is expected to handle non-string inputs or to fail closed, the supplied source does not establish that behaviour.

## Auxiliary helper

<!-- lw:anchors packages/core/test/fixtures/fase2-repo/src/auth.ts#extra -->

A module-level helper:

```ts
export function extra() { return 42; }
```

It takes no arguments and unconditionally returns the numeric literal `42`, giving the fixture a trivial free function that the indexer can record alongside the class members.

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
<!-- livewiki:navigate:end -->
