---
title: fase2-repo-src
owner: generated
anchors:
  - packages/core/test/fixtures/fase2-repo/src/auth.ts#Auth
  - packages/core/test/fixtures/fase2-repo/src/auth.ts#Auth.hash
  - packages/core/test/fixtures/fase2-repo/src/auth.ts#extra
  - packages/core/test/fixtures/fase2-repo/src/auth.ts#validate
---

## Auth class
<!-- lw:anchors packages/core/test/fixtures/fase2-repo/src/auth.ts#Auth packages/core/test/fixtures/fase2-repo/src/auth.ts#Auth.hash -->

The `Auth` class is exported from `packages/core/test/fixtures/fase2-repo/src/auth.ts`. It serves as the namespace for hashing-related functionality in the fixture module.

### `hash` method

The `hash` method takes a string `s` and returns a string. From the visible source it returns the literal prefix `"h:"` concatenated with the input, e.g. `hash("x")` returns `"h:x"`. It is an instance method on `Auth` and is not declared `static` in the source excerpt.

## Token validation
<!-- lw:anchors packages/core/test/fixtures/fase2-repo/src/auth.ts#validate -->

`validate` is an exported function with the signature `validate(token: string): boolean`. The visible body returns the result of `token.length >= 0`, which is a trivially true predicate for any string in JavaScript.

## Auxiliary helpers
<!-- lw:anchors packages/core/test/fixtures/fase2-repo/src/auth.ts#extra -->

`extra` is an exported function taking no parameters and returning the numeric literal `42`. It appears alongside the other top-level exports in the fixture and shares no internal state with `Auth` or `validate`.