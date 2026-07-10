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

## AuthService class
<!-- lw:anchors packages/core/test/fixtures/sample-ts-repo/src/auth.ts#AuthService packages/core/test/fixtures/sample-ts-repo/src/auth.ts#AuthService.validateToken packages/core/test/fixtures/sample-ts-repo/src/auth.ts#AuthService.refresh -->

Exported class `AuthService` declared at the top of `packages/core/test/fixtures/sample-ts-repo/src/auth.ts`. Holds a private `token: string` field.

### Methods

- `validateToken(token: string): boolean` — returns `true` when `token.length > 0`.
- `refresh(): string` — assigns `this.token = "new-" + Math.random()` and returns `this.token`.

## Module exports
<!-- lw:anchors packages/core/test/fixtures/sample-ts-repo/src/auth.ts#makeAuth packages/core/test/fixtures/sample-ts-repo/src/auth.ts#deprecated_helper packages/core/test/fixtures/sample-ts-repo/src/auth.ts#VERSION -->

Top-level exports from `packages/core/test/fixtures/sample-ts-repo/src/auth.ts`:

- `makeAuth(): AuthService` — factory function returning `new AuthService()`.
- `deprecated_helper(x: number): number` — returns `x * 2`.
- `VERSION` — exported `const` string with value `"1.0.0"`.