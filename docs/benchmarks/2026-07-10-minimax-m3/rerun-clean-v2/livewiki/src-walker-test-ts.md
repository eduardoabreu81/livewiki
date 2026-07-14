---
title: src-walker-test-ts
owner: generated
anchors:
  - packages/core/src/walker.test.ts#write
---

## write
<!-- lw:anchors packages/core/src/walker.test.ts#write -->

`write(rel: string, content = ""): Promise<void>` is a test helper that materialises a file inside the per-test temporary repository root.

### Behaviour

- Resolves `rel` against the module-scoped `repoRoot` (created by `beforeEach` via `nodeFs.mkdtemp` under `nodeOs.tmpdir()`).
- Calls `nodeFs.mkdir` with `recursive: true` on the parent directory so nested paths such as `src/sub/deep/file.ts` work without separate directory setup.
- Writes `content` (defaulting to the empty string) with `nodeFs.writeFile`.

### Usage in the suite

`write` is the sole fixture primitive used by the `walkRepo` and `EXTENSION_LANG` `describe` blocks. Each `it` case calls `write` one or more times to seed files (e.g. `write("src/foo.ts", "export const x = 1")`) before invoking `walkRepo(repoRoot)` and asserting on the returned record set.

### Cleanup

The companion `afterEach` hook removes `repoRoot` recursively with `force: true`, so files produced via `write` are torn down between tests.

TODO: edge cases (binary content, symlinks, permission errors) are not exercised by this helper.