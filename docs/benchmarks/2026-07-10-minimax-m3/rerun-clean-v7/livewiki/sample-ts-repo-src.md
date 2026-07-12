---
title: sample-ts-repo-src
owner: generated
anchors:
  - packages/core/test/fixtures/sample-ts-repo/src/auth.ts#AuthService
  - packages/core/test/fixtures/sample-ts-repo/src/auth.ts#AuthService.validateToken
  - packages/core/test/fixtures/sample-ts-repo/src/auth.ts#AuthService.refresh
  - packages/core/test/fixtures/sample-ts-repo/src/auth.ts#makeAuth
  - packages/core/test/fixtures/sample-ts-repo/src/auth.ts#deprecated_helper
  - packages/core/test/fixtures/sample-ts-repo/src/auth.ts#VERSION
---

# sample-ts-repo-src

Source module `packages/core/test/fixtures/sample-ts-repo/src/auth.ts` — a TypeScript fixture exercising the symbol kinds the indexer must recognize.

## AuthService class
<!-- lw:anchors packages/core/test/fixtures/sample-ts-repo/src/auth.ts#AuthService packages/core/test/fixtures/sample-ts-repo/src/auth.ts#AuthService.validateToken packages/core/test/fixtures/sample-ts-repo/src/auth.ts#AuthService.refresh -->

`AuthService` is an exported class with one private field, `token`, initialized to an empty string.

### `validateToken(token)`
Returns `true` when the supplied token has positive length.

### `refresh()`
Replaces the internal token with a freshly-generated value prefixed `new-` and returns it.

## Module helpers
<!-- lw:anchors packages/core/test/fixtures/sample-ts-repo/src/auth.ts#makeAuth packages/core/test/fixtures/sample-ts-repo/src/auth.ts#deprecated_helper packages/core/test/fixtures/sample-ts-repo/src/auth.ts#VERSION -->

### `makeAuth()`
Factory that constructs and returns a new `AuthService` instance.

### `deprecated_helper(x)`
Doubles its numeric argument. The name signals that this export is kept only for legacy callers.

### `VERSION`
String constant, currently `"1.0.0"`.