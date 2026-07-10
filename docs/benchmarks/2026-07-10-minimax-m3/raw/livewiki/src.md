<think>
The user wants me to generate a Markdown documentation page for the `src` module, specifically for the file `packages/core/test/fixtures/fase2-repo/src/auth.ts`. I need to:

1. Use ONLY the 4 keys from the closed list
2. Distribute them across sections using `<!-- lw:anchors key1 key2 -->` markers
3. Include frontmatter with title, owner, and anchors list
4. Keep prose tight, reference-style
5. Use "TODO: <reason>" for missing info
6. Output syntactically valid Markdown

Let me plan the structure:

Frontmatter:
- title: src
- owner: generated
- anchors: list of all 4 keys

Then I'll organize sections. Let me think about logical groupings:

- Overview / module description (no keys here, just intro)
- The `Auth` class with its `hash` method
- The `validate` function
- The `extra` function

Section markers distribute keys:
- Section 1 (overview): could include nothing, or maybe an intro
- Section 2 (Auth class): `Auth` and `Auth.hash`
- Section 3 (validate function): `validate`
- Section 4 (extra function): `extra`

Or I could combine them differently. Let me structure it logically:

```markdown
---
title: src
owner: generated
anchors:
  - packages/core/test/fixtures/fase2-repo/src/auth.ts#Auth
  - packages/core/test/fixtures/fase2-repo/src/auth.ts#Auth.hash
  - packages/core/test/fixtures/fase2-repo/src/auth.ts#extra
  - packages/core/test/fixtures/fase2-repo/src/auth.ts#validate
---

# src

Brief overview of the module.

<!-- lw:anchors packages/core/test/fixtures/fase2-repo/src/auth.ts#Auth packages/core/test/fixtures/fase2-repo/src/auth.ts#Auth.hash -->

## Auth

`Auth` is an exported class...

### hash

The `hash` method...

<!-- lw:anchors packages/core/test/fixtures/fase2-repo/src/auth.ts#validate -->

## validate

The `validate` function...

<!-- lw:anchors packages/core/test/fixtures/fase2-repo/src/auth.ts#extra -->

## extra

The `extra` function...
```

Wait, the rule says "Section markers `<!-- lw:anchors key1 key2 -->` distribute remaining keys across sections." So each section marker distributes the keys that belong to that section. Let me make sure all 4 keys are distributed exactly once across the markers.

Let me finalize:

Section 1: Auth class + hash method
Section 2: validate function
Section 3: extra function

Or I could do:
Section 1: Auth + hash
Section 2: validate
Section 3: extra

That works. Let me write tight, reference-style prose.I should include signatures from the symbol table.

Let me write the output:
</think>

```markdown
---
title: src
owner: generated
anchors:
  - packages/core/test/fixtures/fase2-repo/src/auth.ts#Auth
  - packages/core/test/fixtures/fase2-repo/src/auth.ts#Auth.hash
  - packages/core/test/fixtures/fase2-repo/src/auth.ts#extra
  - packages/core/test/fixtures/fase2-repo/src/auth.ts#validate
---

# src

Module path: `packages/core/test/fixtures/fase2-repo/src/auth.ts`

Source file exposing an authentication helper class and two standalone exported functions.

<!-- lw:anchors packages/core/test/fixtures/fase2-repo/src/auth.ts#Auth packages/core/test/fixtures/fase2-repo/src/auth.ts#Auth.hash -->

## Auth

`Auth` is an exported class.

### hash

Method signature: `hash(s: string): string`

Concatenates `"h:"` with the input string `s` and returns the result. Implementation detail; behaviour is not specified beyond the source.

<!-- lw:anchors packages/core/test/fixtures/fase2-repo/src/auth.ts#validate -->

## validate

Function signature: `validate(token: string): boolean`

Returns `true` when `token.length >= 0`. As written, this is always `true` for valid string inputs; intended semantics TODO: confirm expected validation behaviour.

<!-- lw:anchors packages/core/test/fixtures/fase2-repo/src/auth.ts#extra -->

## extra

Function signature: `extra(): number`

Returns the literal value `42`. Intended purpose TODO: document rationale or remove.
```