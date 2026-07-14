---
title: auth.ts
owner: generated
anchors:
  - packages/core/test/fixtures/sample-ts-repo/src/auth.ts#AuthService
  - packages/core/test/fixtures/sample-ts-repo/src/auth.ts#AuthService.refresh
  - packages/core/test/fixtures/sample-ts-repo/src/auth.ts#AuthService.validateToken
  - packages/core/test/fixtures/sample-ts-repo/src/auth.ts#VERSION
  - packages/core/test/fixtures/sample-ts-repo/src/auth.ts#deprecated_helper
  - packages/core/test/fixtures/sample-ts-repo/src/auth.ts#makeAuth
---

## AuthService class
<!-- lw:anchors packages/core/test/fixtures/sample-ts-repo/src/auth.ts#AuthService packages/core/test/fixtures/sample-ts-repo/src/auth.ts#AuthService.validateToken packages/core/test/fixtures/sample-ts-repo/src/auth.ts#AuthService.refresh -->

`AuthService` is the exported class in this module. It declares a `private token` field initialised to the empty string and exposes two instance methods:

- `validateToken(token: string): boolean` — returns whether the supplied `token` has positive length.
- `refresh(): string` — assigns a freshly generated `"new-" + Math.random()` value to the instance token and returns it.

## Module exports
<!-- lw:anchors packages/core/test/fixtures/sample-ts-repo/src/auth.ts#makeAuth packages/core/test/fixtures/sample-ts-repo/src/auth.ts#deprecated_helper packages/core/test/fixtures/sample-ts-repo/src/auth.ts#VERSION -->

The remaining symbols are exported at module scope:

- `makeAuth(): AuthService` — factory that returns a new `AuthService` instance.
- `deprecated_helper(x: number): number` — returns `x * 2`; the name signals that the function is retained but slated for removal.
- `VERSION` — a `const` string literal of value `"1.0.0"`, intended as the module's version stamp.