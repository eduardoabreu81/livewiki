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

# sample-ts-repo-src

Sample TypeScript source fixture used by the livewiki indexer tests. Provides a minimal exported class, helper functions, and a constant to exercise symbol extraction across node kinds.

## Class: AuthService
<!-- lw:anchors packages/core/test/fixtures/sample-ts-repo/src/auth.ts#AuthService packages/core/test/fixtures/sample-ts-repo/src/auth.ts#AuthService.refresh packages/core/test/fixtures/sample-ts-repo/src/auth.ts#AuthService.validateToken -->

`AuthService` is the central type of this module. It holds a private `token` field and exposes two methods used by the indexer fixture.

### `validateToken(token: string): boolean`

Performs a non-empty check on the supplied token and returns the boolean result.

### `refresh(): string`

Mutates the internal `token` with a generated `"new-"` prefixed value and returns it.

## Factory function
<!-- lw:anchors packages/core/test/fixtures/sample-ts-repo/src/auth.ts#makeAuth -->

`makeAuth` constructs and returns a fresh `AuthService` instance. This is the canonical way to obtain an `AuthService` from outside the module.

## Utility helpers and constants
<!-- lw:anchors packages/core/test/fixtures/sample-ts-repo/src/auth.ts#deprecated_helper packages/core/test/fixtures/sample-ts-repo/src/auth.ts#VERSION -->

The module also exports a small utility function and a version constant.

- `deprecated_helper(x: number): number` returns `x * 2`. Marked as deprecated in intent; callers should migrate to a supported helper. TODO: confirm the deprecation marker and replacement target.
- `VERSION` is the exported string constant `"1.0.0"` tracking the fixture's semantic version.

## File metadata

- Module path: `packages/core/test/fixtures/sample-ts-repo/src/auth.ts`
- Exported symbols: 6