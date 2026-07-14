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
<!-- lw:anchors packages/core/test/fixtures/sample-ts-repo/src/auth.ts#AuthService -->

`AuthService` is the exported class declared in `packages/core/test/fixtures/sample-ts-repo/src/auth.ts`. It owns a private `token` field initialized to the empty string and exposes two instance methods that operate on that internal state. As written in the source, the class body is the unit of reuse that other code in the fixture imports.

## AuthService.validateToken
<!-- lw:anchors packages/core/test/fixtures/sample-ts-repo/src/auth.ts#AuthService.validateToken -->

`validateToken(token: string): boolean` is a method on `AuthService`. Its signature accepts a single `string` argument and returns a `boolean`. In the visible source the method body returns whether the supplied token's length is greater than zero; the implementation does not consult the instance `token` field.

## AuthService.refresh
<!-- lw:anchors packages/core/test/fixtures/sample-ts-repo/src/auth.ts#AuthService.refresh -->

`refresh(): string` is the second method on `AuthService`. It returns a `string` and, in the visible implementation, assigns a freshly generated value of the form `"new-" + Math.random()` to the instance `token` before returning that same value to the caller.

## makeAuth factory
<!-- lw:anchors packages/core/test/fixtures/sample-ts-repo/src/auth.ts#makeAuth -->

`export function makeAuth(): AuthService` is a top-level exported function in the same module. Its declared return type is `AuthService`; the visible body constructs and returns a new `AuthService` instance. The function takes no parameters.

## deprecated_helper
<!-- lw:anchors packages/core/test/fixtures/sample-ts-repo/src/auth.ts#deprecated_helper -->

`export function deprecated_helper(x: number): number` is another top-level exported function from this file. It accepts a single `number` argument and returns a `number`; the visible body multiplies the input by two and returns the result.

## VERSION constant
<!-- lw:anchors packages/core/test/fixtures/sample-ts-repo/src/auth.ts#VERSION -->

`export const VERSION = "1.0.0";` is the module-level exported string constant. It is a `const` binding with no type annotation, holding the literal value `"1.0.0"`, and is re-exported alongside the functions and the class for downstream consumers of the fixture.