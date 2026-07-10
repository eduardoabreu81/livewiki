---
title: fase2-repo-src
owner: generated
anchors:
  - packages/core/test/fixtures/fase2-repo/src/auth.ts#Auth
  - packages/core/test/fixtures/fase2-repo/src/auth.ts#Auth.hash
  - packages/core/test/fixtures/fase2-repo/src/auth.ts#extra
  - packages/core/test/fixtures/fase2-repo/src/auth.ts#validate
---

# fase2-repo-src

Module path: `packages/core/test/fixtures/fase2-repo/src/auth.ts`

## Overview
<!-- lw:anchors packages/core/test/fixtures/fase2-repo/src/auth.ts#Auth packages/core/test/fixtures/fase2-repo/src/auth.ts#validate packages/core/test/fixtures/fase2-repo/src/auth.ts#extra -->

The `auth.ts` module exposes the `Auth` class together with two top-level helper functions: `validate` and `extra`.

## Auth class
<!-- lw:anchors packages/core/test/fixtures/fase2-repo/src/auth.ts#Auth packages/core/test/fixtures/fase2-repo/src/auth.ts#Auth.hash -->

`Auth` is an exported class. It defines a single instance method:

- `hash(s: string): string` — Returns the value `"h:" + s`, prefixing the input with the literal `h:`.

## Functions
<!-- lw:anchors packages/core/test/fixtures/fase2-repo/src/auth.ts#validate packages/core/test/fixtures/fase2-repo/src/auth.ts#extra -->

- `validate(token: string): boolean` — Returns `token.length >= 0`, which is always `true` for any string token (including the empty string).
- `extra()` — Returns the constant `42`.
