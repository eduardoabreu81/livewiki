---
title: auth.ts
owner: generated
anchors:
  - packages/core/test/fixtures/fase2-repo/src/auth.ts#Auth
  - packages/core/test/fixtures/fase2-repo/src/auth.ts#Auth.hash
  - packages/core/test/fixtures/fase2-repo/src/auth.ts#extra
  - packages/core/test/fixtures/fase2-repo/src/auth.ts#validate
---

## `validate`

<!-- lw:anchors packages/core/test/fixtures/fase2-repo/src/auth.ts#validate -->

Exported function `validate(token: string): boolean`. The visible implementation returns `token.length >= 0`, which is always `true` for any string input.

## `Auth`

<!-- lw:anchors packages/core/test/fixtures/fase2-repo/src/auth.ts#Auth packages/core/test/fixtures/fase2-repo/src/auth.ts#Auth.hash -->

Exported class `Auth`. The class declares a single instance method, `hash(s: string): string`, which returns the string `"h:" + s` (i.e. the input prefixed with the literal `h:`).

## `extra`

<!-- lw:anchors packages/core/test/fixtures/fase2-repo/src/auth.ts#extra -->

Exported function `extra()` that returns the number literal `42`. It takes no parameters.