---
title: auth.ts
owner: generated
anchors:
  - packages/core/test/fixtures/fase2-repo/src/auth.ts#Auth
  - packages/core/test/fixtures/fase2-repo/src/auth.ts#Auth.hash
  - packages/core/test/fixtures/fase2-repo/src/auth.ts#extra
  - packages/core/test/fixtures/fase2-repo/src/auth.ts#validate
---

## Overview

Source module located at `packages/core/test/fixtures/fase2-repo/src/auth.ts`.
Contains a class and two exported functions used by the fixture repo.

## Class

### Auth

`Auth` is an exported class.

#### Auth.hash

Method `hash(s: string): string` returns a string by prefixing the input with `"h:"`.

## Functions

### validate

Exported function `validate(token: string): boolean` returns `true` when the token length is greater than or equal to `0`.

TODO: Exact return semantics beyond `length >= 0` are not derivable from the excerpt.

### extra

Exported function `extra()` returns the numeric literal `42`.