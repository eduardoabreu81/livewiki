---
title: src/symbols.test.ts
owner: generated
anchors:
  - packages/core/src/symbols.test.ts#parse
---

# `symbols.test.ts`

Test suite for the TypeScript and Python branches of `extractSymbols`. Uses `vitest`. Calls into a local helper `parse` which wraps `parseSource` after a one-time `initParser()` in `beforeAll`.

## parse

<!-- lw:anchors packages/core/src/symbols.test.ts#parse -->

```ts
async function parse(ext: string, src: string) {
  return parseSource(ext, src);
}
```

The helper forwards `(ext, src)` to `parseSource` from `./parser.js`. `ext` selects the language grammar (`.ts`, `.py`), and `src` is the source text that gets turned into a tree-sitter tree. Every `it(...)` block in both `describe` groups routes through this helper rather than calling `parseSource` directly.

What the suite asserts via `parse` + `extractSymbols`:

- **TypeScript top-level functions** — `function foo() {...}` produces exactly `["foo"]` with `kind: "function"`, key `x.ts#foo`, `start_line: 1`.
- **Generators** — `function* gen() { yield 1; }` extracts as kind `function`, not a separate generator kind.
- **Classes + method qualification** — `class Foo { bar() {...}; baz() {...} }` yields `Foo`, `Foo.bar`, `Foo.baz`; the class symbol has `kind: "class"`, the methods `kind: "method"`.
- **Exports do not duplicate** — `export class Foo {}` and `export function bar() {}` each produce exactly one symbol with the base kind (`class`, `function`), not a synthetic "export" kind.
- **Exported const keeps the export kind** — `export const VERSION = '1.0';` produces a symbol with `kind: "export"`.
- **Signature capture** — `signature` contains the first line of the node (e.g. `function multiLine`); the rest of a multi-line signature is trimmed.
- **`content_hash` reactivity** — changing the function body changes the node slice, which changes the hash; a same-name body change does not collide with a different-name body.
- **`content_hash` determinism** — identical inputs over two `parse` invocations yield byte-identical hashes.
- **Python — `function_definition`** — `def greet(name): ...` extracts with `kind: "function"`.
- **Python — class + methods** — `class Calculator` with `add` / `sub` extracts as `Calculator`, `Calculator.add`, `Calculator.sub` (qualified).
- **Python — `@property` (decorated_definition)** — `@property\ndef name(self): ...` still extracts `name`; decorators don't suppress the underlying definition.

## Source excerpt

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { extractSymbols } from "./symbols.js";
import { parseSource, initParser } from "./parser.js";

beforeAll(async () => {
  await initParser();
});

async function parse(ext: string, src: string) {
  return parseSource(ext, src);
}

describe("symbols — TypeScript", () => { /* function, class+methods, generator,
  export class/function no-dup, export const, signature, content_hash reactivity & determinism */ });

describe("symbols — Python", () => { /* function_definition, class+methods qualified, decorated_definition */ });
```

## Related modules

- `./parser.js` — exposes `initParser()` and `parseSource(ext, src)`; consumed by `parse`.
- `./symbols.js` — exposes `extractSymbols(tree, filename, src)`; the actual production logic under test.
- `vitest` — test runner driving `describe` / `it` / `expect`.