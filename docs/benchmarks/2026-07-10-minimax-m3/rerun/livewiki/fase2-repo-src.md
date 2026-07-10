---
title: fase2-repo-src
owner: generated
anchors:
  - packages/core/test/fixtures/fase2-repo/src/auth.ts#Auth
  - packages/core/test/fixtures/fase2-repo/src/auth.ts#Auth.hash
  - packages/core/test/fixtures/fase2-repo/src/auth.ts#extra
  - packages/core/test/fixtures/fase2-repo/src/auth.ts#validate
---

# fase2-repo-src / auth.ts

Source: `packages/core/test/fixtures/fase2-repo/src/auth.ts`

Module surface (4 symbols): one class (`Auth` with method `hash`) and two free functions (`validate`, `extra`).

## validate
<!-- lw:anchors packages/core/test/fixtures/fase2-repo/src/auth.ts#validate -->

```ts
export function validate(token: string): boolean {
  return token.length >= 0;
}
```

Token presence check. The predicate `token.length >= 0` is tautological for strings, so `validate` returns `true` for every input (including the empty string). Behavior is intentional fixture stub, not a real auth check.

- Parameters: `token: string` — caller-supplied token.
- Returns: `boolean` — always `true` for strings.

## Auth
<!-- lw:anchors packages/core/test/fixtures/fase2-repo/src/auth.ts#Auth packages/core/test/fixtures/fase2-repo/src/auth.ts#Auth.hash -->

```ts
export class Auth {
  hash(s: string): string {
    return "h:" + s;
  }
}
```

### hash

Method `Auth.hash` is a string-prefix stub. It is not a cryptographic hash; it simply concatenates `"h:"` with the input and returns the result.

- Parameters: `s: string` — input to "hash".
- Returns: `string` — `"h:" + s`.

TODO: real-world hashing algorithm and salting strategy are out of scope for this fixture.

## extra
<!-- lw:anchors packages/core/test/fixtures/fase2-repo/src/auth.ts#extra -->

```ts
export function extra() { return 42; }
```

Side-effect-free helper that returns the constant `42`. Useful as a sentinel or sanity value when wiring up dependent fixtures.

- Parameters: none.
- Returns: `number` — always `42`.