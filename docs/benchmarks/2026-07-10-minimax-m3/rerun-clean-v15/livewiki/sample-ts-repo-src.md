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

`AuthService` is an exported class that holds an internal token state (a private `token` string) and exposes token lifecycle methods. Two instance methods are defined on it: `validateToken` and `refresh`.

`validateToken(token)` accepts a `token: string` and returns a `boolean`. The method's body returns `token.length > 0`, so any non-empty input string passes validation.

`refresh()` returns a `string`. It assigns a freshly generated value of the form `"new-" + Math.random()` to the private `token` field and then returns that same value, giving callers the new token.

## Module exports
<!-- lw:anchors packages/core/test/fixtures/sample-ts-repo/src/auth.ts#makeAuth packages/core/test/fixtures/sample-ts-repo/src/auth.ts#deprecated_helper packages/core/test/fixtures/sample-ts-repo/src/auth.ts#VERSION -->

`makeAuth` is an exported function with the signature `makeAuth(): AuthService`. It returns a freshly constructed `AuthService` instance and is the conventional factory entry point for consumers.

`deprecated_helper` is an exported function declared as `deprecated_helper(x: number): number`. Its body returns `x * 2`, doubling its numeric input. The name signals that callers should migrate away from it.

`VERSION` is an exported `const` of type string literal, with the value `"1.0.0"`. It is the module-level version marker exposed to importers.
