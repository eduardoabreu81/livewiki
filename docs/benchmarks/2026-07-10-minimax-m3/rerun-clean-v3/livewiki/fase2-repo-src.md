---
title: fase2-repo/src/auth.ts
owner: generated
anchors:
  - packages/core/test/fixtures/fase2-repo/src/auth.ts#Auth
  - packages/core/test/fixtures/fase2-repo/src/auth.ts#Auth.hash
  - packages/core/test/fixtures/fase2-repo/src/auth.ts#extra
  - packages/core/test/fixtures/fase2-repo/src/auth.ts#validate
---

## Auth class
<!-- lw:anchors packages/core/test/fixtures/fase2-repo/src/auth.ts#Auth packages/core/test/fixtures/fase2-repo/src/auth.ts#Auth.hash -->

`Auth` is the exported class declared in `packages/core/test/fixtures/fase2-repo/src/auth.ts`. It groups authentication-related helpers.

### hash
<!-- lw:anchors packages/core/test/fixtures/fase2-repo/src/auth.ts#Auth.hash -->

Method `hash(s: string): string` on `Auth`. Per the source excerpt, it returns the string `"h:" + s`. No additional behavior is documented in the excerpt.

## Top-level functions
<!-- lw:anchors packages/core/test/fixtures/fase2-repo/src/auth.ts#validate packages/core/test/fixtures/fase2-repo/src/auth.ts#extra -->

The module exports two top-level functions alongside the `Auth` class.

### validate
<!-- lw:anchors packages/core/test/fixtures/fase2-repo/src/auth.ts#validate -->

Signature: `validate(token: string): boolean`. According to the excerpt, it returns `token.length >= 0`. TODO: confirm intended semantics — this implementation accepts any string including the empty string.

### extra
<!-- lw:anchors packages/core/test/fixtures/fase2-repo/src/auth.ts#extra -->

Signature: `extra(): number`. The excerpt shows it returns the literal value `42`. No parameters, no side effects documented.