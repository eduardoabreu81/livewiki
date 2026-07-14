---
title: sample-ts-repo-src
owner: generated
anchors:
  - packages/core/test/fixtures/sample-ts-repo/src/auth.ts#AuthService
  - packages/core/test/fixtures/sample-ts-repo/src/auth.ts#AuthService.refresh
  - packages/core/test/fixtures/sample-ts-repo/src/auth.ts#AuthService.validateToken
  - packages/core/test/fixtures/sample-ts-repo/src/auth.ts#VERSION
  - packages/core/test/fixtures/sample-ts-repo/src/auth.ts#deprecated_helper
  - packages/core/test/fixtures/sample-ts-repo/src/auth.ts#makeAuth
---

# sample-ts-repo-src

Source module at `packages/core/test/fixtures/sample-ts-repo/src/auth.ts`. It exports one class with two methods, two free functions, and one constant.

## AuthService class
<!-- lw:anchors packages/core/test/fixtures/sample-ts-repo/src/auth.ts#AuthService packages/core/test/fixtures/sample-ts-repo/src/auth.ts#AuthService.validateToken packages/core/test/fixtures/sample-ts-repo/src/auth.ts#AuthService.refresh -->

`AuthService` is the exported class in this module. The visible declaration is:

```ts
export class AuthService {
  private token: string = "";
  validateToken(token: string): boolean { ... }
  refresh(): string { ... }
}
```

It carries a private `token` field (defaulted to the empty string) and exposes two methods:

- `validateToken(token: string): boolean` — returns a boolean derived from the input token.
- `refresh(): string` — returns a string token.

### AuthService.validateToken

Signature: `validateToken(token: string): boolean`. The method body operates on `token` and returns a boolean; no other parameters, overloads, or generics are visible in the excerpt.

### AuthService.refresh

Signature: `refresh(): string`. The method body reassigns the private `token` field to a string constructed from the literal prefix `"new-"` and `Math.random()`, and returns that value.

## Module-level helpers
<!-- lw:anchors packages/core/test/fixtures/sample-ts-repo/src/auth.ts#makeAuth packages/core/test/fixtures/sample-ts-repo/src/auth.ts#deprecated_helper -->

The module also exports two free functions:

### makeAuth

Signature: `export function makeAuth(): AuthService`. A zero-argument factory that returns a `AuthService` instance, providing the conventional way for callers to obtain a service without `new`-ing the class directly.

### deprecated_helper

Signature: `export function deprecated_helper(x: number): number`. Accepts a single numeric argument `x` and returns a number; the name suggests legacy usage, but no deprecation attribute or JSDoc tag is visible in the excerpt.

## Constants
<!-- lw:anchors packages/core/test/fixtures/sample-ts-repo/src/auth.ts#VERSION -->

The module exports a single string constant alongside the class and the two functions.

### VERSION

Declaration: `export const VERSION = "1.0.0";`. A string constant exported alongside the functions and the class, useful as a build-time or runtime version stamp for the module.