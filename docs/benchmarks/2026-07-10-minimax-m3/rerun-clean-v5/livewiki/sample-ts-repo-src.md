---
title: sample-ts-repo-src
owner: generated
anchors:
  - packages/core/test/fixtures/sample-ts-repo/src/auth.ts#AuthService
  - packages/core/test/fixtures/sample-ts-repo/src/auth.ts#AuthService.refresh
  - packages/core/test/fixtures/sample-ts-repo/src/auth.ts#AuthService.validateToken
  - packages/core/test/fixtures/sample-ts-repo/src/auth.ts#makeAuth
  - packages/core/test/fixtures/sample-ts-repo/src/auth.ts#deprecated_helper
  - packages/core/test/fixtures/sample-ts-repo/src/auth.ts#VERSION
---

## AuthService
<!-- lw:anchors packages/core/test/fixtures/sample-ts-repo/src/auth.ts#AuthService -->

`AuthService` is an exported class that holds a private `token` string field. It exposes two methods, `validateToken` and `refresh`.

### validateToken
<!-- lw:anchors packages/core/test/fixtures/sample-ts-repo/src/auth.ts#AuthService.validateToken -->

`validateToken(token: string): boolean` returns `true` when the supplied token has a non-zero length.

### refresh
<!-- lw:anchors packages/core/test/fixtures/sample-ts-repo/src/auth.ts#AuthService.refresh -->

`refresh(): string` assigns a freshly generated value of the form `"new-" + Math.random()` to the internal token and returns it.

## Factory helper
<!-- lw:anchors packages/core/test/fixtures/sample-ts-repo/src/auth.ts#makeAuth -->

`makeAuth()` is an exported factory function returning a new `AuthService` instance.

## Legacy helper
<!-- lw:anchors packages/core/test/fixtures/sample-ts-repo/src/auth.ts#deprecated_helper -->

`deprecated_helper(x: number): number` is an exported function that doubles its numeric argument. TODO: confirm intended replacement once available.

## Module constant
<!-- lw:anchors packages/core/test/fixtures/sample-ts-repo/src/auth.ts#VERSION -->

`VERSION` is an exported string constant pinned to `"1.0.0"`.