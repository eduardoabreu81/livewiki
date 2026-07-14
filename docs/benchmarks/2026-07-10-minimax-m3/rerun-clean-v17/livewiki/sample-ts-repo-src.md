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

`AuthService` is an exported class declared in `packages/core/test/fixtures/sample-ts-repo/src/auth.ts`. The class holds a private `token: string` field (initialised to the empty string) and exposes two instance methods: `validateToken` and `refresh`. The class body as visible in the source ends with the closing brace of `refresh` and the class declaration's closing brace.

## AuthService methods
<!-- lw:anchors packages/core/test/fixtures/sample-ts-repo/src/auth.ts#AuthService.validateToken packages/core/test/fixtures/sample-ts-repo/src/auth.ts#AuthService.refresh -->

- `validateToken(token: string): boolean` — accepts a token string and returns a boolean. The visible body is `return token.length > 0;`, so it returns `true` for any non-empty string and `false` for an empty string.
- `refresh(): string` — has no parameters and returns a string. The visible body assigns `this.token = "new-" + Math.random();` and then returns `this.token`, producing a fresh pseudo-random token string each call.

## Module-level functions
<!-- lw:anchors packages/core/test/fixtures/sample-ts-repo/src/auth.ts#makeAuth packages/core/test/fixtures/sample-ts-repo/src/auth.ts#deprecated_helper -->

- `makeAuth(): AuthService` — exported function that constructs and returns a new `AuthService` instance via `return new AuthService();`. It takes no arguments.
- `deprecated_helper(x: number): number` — exported function whose visible body is `return x * 2;`. Despite the name suggesting it is deprecated, the source contains no deprecation annotation; the function simply doubles its numeric argument.

## Module constants
<!-- lw:anchors packages/core/test/fixtures/sample-ts-repo/src/auth.ts#VERSION -->

`VERSION` is an exported `const` bound to the string literal `"1.0.0"`. It is declared with `export const VERSION = "1.0.0";` at module scope and is not exported through any additional wrapper.