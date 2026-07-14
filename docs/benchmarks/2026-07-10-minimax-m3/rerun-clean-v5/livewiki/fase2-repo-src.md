---
title: packages/core/test/fixtures/fase2-repo/src/auth.ts
owner: generated
anchors:
  - packages/core/test/fixtures/fase2-repo/src/auth.ts#validate
  - packages/core/test/fixtures/fase2-repo/src/auth.ts#Auth
  - packages/core/test/fixtures/fase2-repo/src/auth.ts#Auth.hash
  - packages/core/test/fixtures/fase2-repo/src/auth.ts#extra
---

## Overview

This module is part of the `fase2-repo` fixture and exposes auth-related helpers plus one utility.

## Functions
<!-- lw:anchors packages/core/test/fixtures/fase2-repo/src/auth.ts#validate packages/core/test/fixtures/fase2-repo/src/auth.ts#extra -->

- `validate(token: string): boolean` — returns `true` when the token's length is non-negative (a trivial guard). Signature: `(token: string): boolean`.
- `extra(): 42` — returns the constant `42`. Signature: `(): number`.

## `Auth` class
<!-- lw:anchors packages/core/test/fixtures/fase2-repo/src/auth.ts#Auth packages/core/test/fixtures/fase2-repo/src/auth.ts#Auth.hash -->

The `Auth` class groups a single instance method, `hash`, which prefixes its input with the marker `"h:"`.

- `Auth.hash(s: string): string` — returns the string `"h:" + s`. Signature: `(s: string): string`.

TODO: Constructor parameters and module-level imports are not visible in the supplied source excerpt.
TODO: No re-exports, type aliases, or constants are present in this file beyond the symbols listed above.