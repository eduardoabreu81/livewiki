---
title: auth
owner: generated
anchors:
  - packages/core/test/fixtures/sample-ts-repo/src/auth.ts#AuthService
  - packages/core/test/fixtures/sample-ts-repo/src/auth.ts#AuthService.refresh
  - packages/core/test/fixtures/sample-ts-repo/src/auth.ts#AuthService.validateToken
  - packages/core/test/fixtures/sample-ts-repo/src/auth.ts#VERSION
  - packages/core/test/fixtures/sample-ts-repo/src/auth.ts#deprecated_helper
  - packages/core/test/fixtures/sample-ts-repo/src/auth.ts#makeAuth
---

# auth

Sample TypeScript module used by indexer tests. Exercises class, exported functions, and an exported constant.

## Class: AuthService
<!-- lw:anchors packages/core/test/fixtures/sample-ts-repo/src/auth.ts#AuthService -->

Exported class. Holds a private `token` field of type `string` (default `""`). Instances are constructed with no arguments.

## Methods
<!-- lw:anchors packages/core/test/fixtures/sample-ts-repo/src/auth.ts#AuthService.validateToken packages/core/test/fixtures/sample-ts-repo/src/auth.ts#AuthService.refresh -->

- `validateToken(token: string): boolean` — returns `true` if the supplied token string has length greater than zero.
- `refresh(): string` — replaces the internal token with a new `"new-"`-prefixed random value and returns it.

## Factory
<!-- lw:anchors packages/core/test/fixtures/sample-ts-repo/src/auth.ts#makeAuth -->

`makeAuth(): AuthService` — exported factory that returns a fresh `AuthService` instance.

## Helpers
<!-- lw:anchors packages/core/test/fixtures/sample-ts-repo/src/auth.ts#deprecated_helper -->

`deprecated_helper(x: number): number` — exported helper that returns `x * 2`. Marked for removal.

## Constants
<!-- lw:anchors packages/core/test/fixtures/sample-ts-repo/src/auth.ts#VERSION -->

`VERSION` — exported `string` constant set to `"1.0.0"`.