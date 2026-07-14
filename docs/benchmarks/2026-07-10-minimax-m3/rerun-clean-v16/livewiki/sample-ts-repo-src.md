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

`AuthService` is an exported class that maintains a private `token: string` field, initialised to an empty string. The class exposes the two instance methods documented below; its primary purpose is to hold per-instance token state and to be constructable from the `makeAuth` factory.

## AuthService.validateToken
<!-- lw:anchors packages/core/test/fixtures/sample-ts-repo/src/auth.ts#AuthService.validateToken -->

`validateToken(token: string): boolean` returns a boolean computed from the supplied token. The visible implementation returns `token.length > 0`, so any non-empty string yields `true` and an empty string yields `false`. The method does not consult the instance `token` field — only the argument.

## AuthService.refresh
<!-- lw:anchors packages/core/test/fixtures/sample-ts-repo/src/auth.ts#AuthService.refresh -->

`refresh(): string` replaces the instance `token` with a freshly generated string (`"new-" + Math.random()`) and returns the new value to the caller. The method mutates instance state and is the only writer of the private `token` field.

## makeAuth
<!-- lw:anchors packages/core/test/fixtures/sample-ts-repo/src/auth.ts#makeAuth -->

`makeAuth(): AuthService` is an exported factory function that returns a freshly constructed `AuthService` instance. It takes no arguments and is the canonical entry point for callers that want a ready-to-use service without directly invoking the class constructor.

## deprecated_helper
<!-- lw:anchors packages/core/test/fixtures/sample-ts-repo/src/auth.ts#deprecated_helper -->

`deprecated_helper(x: number): number` is an exported function that returns the doubled value of its numeric argument (`x * 2`). The name signals it is retained for compatibility; new callers should prefer the typed service constructed via `makeAuth`.

## VERSION
<!-- lw:anchors packages/core/test/fixtures/sample-ts-repo/src/auth.ts#VERSION -->

`VERSION` is an exported `const` string literal (`"1.0.0"`) representing the module's pinned version. It is a value-level export, not a function, and is intended for consumers that need to report or log the auth module's release.