---
title: Sample fixture AuthService module
owner: generated
anchors:
  - packages/core/test/fixtures/sample-ts-repo/src/auth.ts#AuthService
  - packages/core/test/fixtures/sample-ts-repo/src/auth.ts#AuthService.refresh
  - packages/core/test/fixtures/sample-ts-repo/src/auth.ts#AuthService.validateToken
  - packages/core/test/fixtures/sample-ts-repo/src/auth.ts#VERSION
  - packages/core/test/fixtures/sample-ts-repo/src/auth.ts#deprecated_helper
  - packages/core/test/fixtures/sample-ts-repo/src/auth.ts#makeAuth
---

# Sample fixture AuthService module

This page documents a single TypeScript fixture file used by the livewiki indexer's symbol-extraction tests.

## When to use this page

- **Verify** that the indexer recognises an `export class` with a private field and two methods.
- **Verify** that free-standing `export function`, `export function` (legacy/deprecated name), and `export const` exports each surface as distinct symbol kinds.
- **Compare** extracted signatures against the canonical keys listed above when debugging extraction regressions.

## How it fits

The file lives at `packages/core/test/fixtures/sample-ts-repo/src/auth.ts` inside the livewiki repository. It is one of several sample inputs the indexer fixtures feed into the symbol table builder; it is not part of any product runtime path. Its purpose is to exercise the extractor across `class`, `method`, `function`, and `const` export shapes.

## AuthService class

<!-- lw:anchors packages/core/test/fixtures/sample-ts-repo/src/auth.ts#AuthService packages/core/test/fixtures/sample-ts-repo/src/auth.ts#AuthService.validateToken packages/core/test/fixtures/sample-ts-repo/src/auth.ts#AuthService.refresh -->

The class is declared with a private string field used as token state and exposes two instance methods.

```ts
export class AuthService {
  private token: string = "";
  validateToken(token: string): boolean { /* … */ }
  refresh(): string { /* … */ }
}
```

Method signatures, copied byte-for-byte from the symbol table:

- `validateToken(token: string): boolean {`
- `refresh(): string {`

`validateToken` returns true when the supplied token has positive length; the visible excerpt does not establish exhaustive behaviour beyond that single boolean expression, so additional inputs (for example empty string handling beyond the `length > 0` check) are out of scope here. `refresh` overwrites the private `token` field with a freshly generated string and returns it; the excerpt does not show error handling or allocation failures, and the prose is limited to the normal path that is visible in the supplied source.

## Factory function

<!-- lw:anchors packages/core/test/fixtures/sample-ts-repo/src/auth.ts#makeAuth -->

```ts
export function makeAuth(): AuthService {
```

`makeAuth` constructs and returns a new `AuthService` instance, serving as the public factory for consumers that want an auth handle without invoking `new` directly. The exported signature above is the only behaviour visible in the supplied source.

## Legacy numeric helper

<!-- lw:anchors packages/core/test/fixtures/sample-ts-repo/src/auth.ts#deprecated_helper -->

```ts
export function deprecated_helper(x: number): number {
```

`deprecated_helper` is an exported function whose visible implementation returns `x * 2`. The name flags it as legacy; the excerpt does not show any `@deprecated` JSDoc tag or a runtime notice, and the prose is limited to what the supplied source makes visible.

## Module version constant

<!-- lw:anchors packages/core/test/fixtures/sample-ts-repo/src/auth.ts#VERSION -->

```ts
export const VERSION = "1.0.0";
```

`VERSION` is a frozen-in-source string constant exported alongside the class and helpers. Because it is a primitive literal export rather than a function, behavioural claims here are limited to its declared type and value as shown above.

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
<!-- livewiki:navigate:end -->
