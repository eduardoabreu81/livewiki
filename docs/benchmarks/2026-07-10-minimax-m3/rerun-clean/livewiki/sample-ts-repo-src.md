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

## Overview
<!-- lw:anchors packages/core/test/fixtures/sample-ts-repo/src/auth.ts#AuthService -->

Source file `packages/core/test/fixtures/sample-ts-repo/src/auth.ts` is a fixture used by the livewiki indexer tests. It exposes one class (`AuthService`), two free functions (`makeAuth`, `deprecated_helper`), and one module-level constant (`VERSION`).

## AuthService
<!-- lw:anchors packages/core/test/fixtures/sample-ts-repo/src/auth.ts#AuthService packages/core/test/fixtures/sample-ts-repo/src/auth.ts#AuthService.validateToken packages/core/test/fixtures/sample-ts-repo/src/auth.ts#AuthService.refresh -->

`AuthService` is an exported class. It holds a private `token: string` field and provides two instance methods.

### validateToken
<!-- lw:anchors packages/core/test/fixtures/sample-ts-repo/src/auth.ts#AuthService.validateToken -->

Method `validateToken(token: string): boolean`. Returns `true` when the supplied token has positive length. Source performs a length-only check; no decoding or signature verification is implemented in this fixture.

### refresh
<!-- lw:anchors packages/core/test/fixtures/sample-ts-repo/src/auth.ts#AuthService.refresh -->

Method `refresh(): string`. Replaces the internal `token` with a value prefixed by `new-` followed by a `Math.random()` result, and returns the new token.

## Factory
<!-- lw:anchors packages/core/test/fixtures/sample-ts-repo/src/auth.ts#makeAuth -->

`makeAuth()` is an exported function returning a fresh `AuthService` instance. Construct the dependency from a single entry point rather than `new`-ing the class directly at call sites.

## Module exports
<!-- lw:anchors packages/core/test/fixtures/sample-ts-repo/src/auth.ts#deprecated_helper packages/core/test/fixtures/sample-ts-repo/src/auth.ts#VERSION -->

`deprecated_helper(x: number): number` is an exported free function that returns `x * 2`. The `TODO: true caller intent` is the only signal in the fixture name suggesting it should not be reused in production code; behavior is a plain doubling.

`VERSION` is an exported `const` of type `string` with the literal value `"1.0.0"`, suitable as a build-time stamp for the fixture package.