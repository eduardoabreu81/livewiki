---
title: sample-ts-repo-src
owner: generated
anchors:
  - packages/core/test/fixtures/sample-ts-repo/src/auth.ts#AuthService
  - packages/core/test/fixtures/sample-ts-repo/src/auth.ts#VERSION
  - packages/core/test/fixtures/sample-ts-repo/src/auth.ts#deprecated_helper
  - packages/core/test/fixtures/sample-ts-repo/src/auth.ts#makeAuth
---

## AuthService
<!-- lw:anchors packages/core/test/fixtures/sample-ts-repo/src/auth.ts#AuthService packages/core/test/fixtures/sample-ts-repo/src/auth.ts#AuthService.validateToken packages/core/test/fixtures/sample-ts-repo/src/auth.ts#AuthService.refresh -->

`AuthService` is an exported class that holds a private `token` string and exposes token-related operations.

### Methods
- `validateToken(token: string): boolean` — returns `true` when the supplied token's length is greater than zero.
- `refresh(): string` — replaces the internal token with a value prefixed `"new-"` plus `Math.random()`, and returns the new token.

## Factory and module exports
<!-- lw:anchors packages/core/test/fixtures/sample-ts-repo/src/auth.ts#makeAuth packages/core/test/fixtures/sample-ts-repo/src/auth.ts#deprecated_helper packages/core/test/fixtures/sample-ts-repo/src/auth.ts#VERSION -->

- `makeAuth(): AuthService` — factory function that constructs and returns a new `AuthService` instance.
- `deprecated_helper(x: number): number` — exported helper returning `x * 2`. TODO: exact rationale for deprecation not documented in source.
- `VERSION` — exported constant `const` with value `"1.0.0"`.