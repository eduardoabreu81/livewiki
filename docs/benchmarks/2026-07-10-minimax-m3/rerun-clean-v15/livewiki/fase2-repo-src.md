---
title: fase2-repo-src
owner: generated
anchors:
  - packages/core/test/fixtures/fase2-repo/src/auth.ts#Auth
  - packages/core/test/fixtures/fase2-repo/src/auth.ts#Auth.hash
  - packages/core/test/fixtures/fase2-repo/src/auth.ts#extra
  - packages/core/test/fixtures/fase2-repo/src/auth.ts#validate
---

## validate
<!-- lw:anchors packages/core/test/fixtures/fase2-repo/src/auth.ts#validate -->

`validate` is an exported function declared as `validate(token: string): boolean`. The visible source returns a boolean derived from `token.length`, indicating a length-based token acceptance check.

## Auth class
<!-- lw:anchors packages/core/test/fixtures/fase2-repo/src/auth.ts#Auth packages/core/test/fixtures/fase2-repo/src/auth.ts#Auth.hash -->

`Auth` is an exported class. Its single visible instance method is `hash`, declared as `hash(s: string): string`. The implementation returns the string concatenation `"h:" + s`, producing a deterministic prefixed-hash string from the input. The class is exported and exposes `hash` as its only documented member in this module.

## extra
<!-- lw:anchors packages/core/test/fixtures/fase2-repo/src/auth.ts#extra -->

`extra` is an exported function with no declared parameters and no declared return type; the body returns the numeric literal `42`. It is the trailing export of the module.