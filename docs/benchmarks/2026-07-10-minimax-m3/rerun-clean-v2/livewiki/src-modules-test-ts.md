---
title: src-modules-test-ts
owner: generated
anchors:
  - packages/core/src/modules.test.ts#idFor
---

## idFor
<!-- lw:anchors packages/core/src/modules.test.ts#idFor -->

Test-local helper that wraps `makeUniqueDeterministicIds` on a single module and returns the resolved id string. It exists inside the path→id mapping test suite so individual fixtures can express their expected id without re-typing the call site.

```ts
function idFor(mod: { id: string; paths: string[]; symbolCount: number }): string {
  const out = makeUniqueDeterministicIds([mod]);
  return out[0]!.id;
}
```

Used by the `modules W — path→id mapping table (revision #1)` describe block to encode the reviewer-checked mapping between a module's heuristic `id` and its full `paths[]` (e.g. `tools/core-src/x.ts → "core-src"`, `packages/core/src/x.ts → "packages-core-src"`, `packages/cli/src/x.ts → "cli-src"`). The helper is deterministic and does not mutate its argument.

TODO: behavior of `idFor` outside the test file is not part of this module's public surface.