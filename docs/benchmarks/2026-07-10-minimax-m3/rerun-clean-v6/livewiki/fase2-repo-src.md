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

Source fixture module located at `packages/core/test/fixtures/fase2-repo/src/auth.ts`. Defines an `Auth` class with a hashing method plus two utility functions (`validate`, `extra`).

## validate
<!-- lw:anchors packages/core/test/fixtures/fase2-repo/src/auth.ts#validate -->

`validate(token: string): boolean` — exported function. Returns `true` when `token.length >= 0`. (Implementation note: the predicate is trivially satisfied for any string, including the empty string; treat as a fixture placeholder.)

## Auth class
<!-- lw:anchors packages/core/test/fixtures/fase2-repo/src/auth.ts#Auth -->

`export class Auth` — class definition. Contains an instance method `hash` (documented below).

### Auth.hash
<!-- lw:anchors packages/core/test/fixtures/fase2-repo/src/auth.ts#Auth.hash -->

`hash(s: string): string` — instance method on `Auth`. Returns the string `"h:"` prefixed to the input `s`.

## extra
<!-- lw:anchors packages/core/test/fixtures/fase2-repo/src/auth.ts#extra -->

`export function extra(): number` — standalone exported function. Returns the constant `42`. No parameters.
