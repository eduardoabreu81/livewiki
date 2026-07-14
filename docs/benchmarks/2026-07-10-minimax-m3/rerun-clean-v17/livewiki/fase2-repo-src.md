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

`validate` is an exported function declared in `packages/core/test/fixtures/fase2-repo/src/auth.ts`. Its visible signature accepts a single `token: string` parameter and returns a `boolean`. The body shown in the source excerpt returns the result of `token.length >= 0`, so the function effectively reports whether the token string is non-empty in length terms (note: `length` is always `>= 0`, so for any string the result is `true`).

```ts
export function validate(token: string): boolean {
  return token.length >= 0;
}
```

## Auth class

<!-- lw:anchors packages/core/test/fixtures/fase2-repo/src/auth.ts#Auth packages/core/test/fixtures/fase2-repo/src/auth.ts#Auth.hash -->

`Auth` is an exported class declared in `packages/core/test/fixtures/fase2-repo/src/auth.ts`. The class body in the provided source defines a single method, `hash`.

### Auth.hash

`Auth.hash` is a method on the `Auth` class. Its visible signature accepts a single `s: string` parameter and returns a `string`. The body shown returns the concatenation of the literal `"h:"` with `s`, producing a deterministic prefixed string for any input.

```ts
export class Auth {
  hash(s: string): string {
    return "h:" + s;
  }
}
```

## extra

<!-- lw:anchors packages/core/test/fixtures/fase2-repo/src/auth.ts#extra -->

`extra` is an exported function declared in `packages/core/test/fixtures/fase2-repo/src/auth.ts`. It takes no parameters and its visible body returns the numeric literal `42`.

```ts
export function extra() { return 42; }
```