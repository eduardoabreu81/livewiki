---
title: fase2-repo-src
owner: generated
anchors:
  - packages/core/test/fixtures/fase2-repo/src/auth.ts#Auth
  - packages/core/test/fixtures/fase2-repo/src/auth.ts#Auth.hash
  - packages/core/test/fixtures/fase2-repo/src/auth.ts#extra
  - packages/core/test/fixtures/fase2-repo/src/auth.ts#validate
---

## `validate`
<!-- lw:anchors packages/core/test/fixtures/fase2-repo/src/auth.ts#validate -->

The module exports a `validate` function that accepts a `token: string` and returns a `boolean`. Its current implementation returns `token.length >= 0`, which is always `true` for any string and therefore acts as a trivial token-shape check rather than a real authentication validator.

```ts
export function validate(token: string): boolean {
  return token.length >= 0;
}
```

## `Auth`
<!-- lw:anchors packages/core/test/fixtures/fase2-repo/src/auth.ts#Auth packages/core/test/fixtures/fase2-repo/src/auth.ts#Auth.hash -->

`Auth` is an exported class. It declares a single instance method `hash` that takes a `string` `s` and returns a `string`. The body prefixes the input with `"h:"`, producing a deterministic, non-cryptographic digest-style string.

```ts
export class Auth {
  hash(s: string): string {
    return "h:" + s;
  }
}
```

## `extra`
<!-- lw:anchors packages/core/test/fixtures/fase2-repo/src/auth.ts#extra -->

`extra` is an exported function with no parameters. It returns the numeric literal `42`. It sits alongside `validate` and `Auth` as a small utility export from the same module.

```ts
export function extra() { return 42; }
```