---
title: src-safe-io-ts
owner: generated
anchors:
  - packages/core/src/safe-io.ts#ALLOWED_DIRS
  - packages/core/src/safe-io.ts#PathOutsideAllowlistError
  - packages/core/src/safe-io.ts#PathOutsideAllowlistError.constructor
  - packages/core/src/safe-io.ts#InvalidRelativePathError
  - packages/core/src/safe-io.ts#InvalidRelativePathError.constructor
  - packages/core/src/safe-io.ts#allowlistFor
  - packages/core/src/safe-io.ts#allowedAbs
  - packages/core/src/safe-io.ts#isInsideAllowlist
  - packages/core/src/safe-io.ts#validateDeclared
  - packages/core/src/safe-io.ts#findDeepestExisting
  - packages/core/src/safe-io.ts#resolveAndValidate
  - packages/core/src/safe-io.ts#writeText
  - packages/core/src/safe-io.ts#readText
  - packages/core/src/safe-io.ts#exists
  - packages/core/src/safe-io.ts#mkdir
  - packages/core/src/safe-io.ts#remove
---

# safe-io

The only module authorized to write to disk. Enforces an allowlist of directories (`livewiki/`, `.livewiki/`) inside the repo root. All I/O operations go through validation that also defends against symlink-based attacks.

## Allowlist configuration

<!-- lw:anchors packages/core/src/safe-io.ts#ALLOWED_DIRS packages/core/src/safe-io.ts#allowlistFor packages/core/src/safe-io.ts#allowedAbs -->

`ALLOWED_DIRS` is the tuple `["livewiki", ".livewiki"]` and the source of the `AllowedDir` type.

`allowlistFor(opts)` returns the effective allowlist for a call. When `opts.allowPointer` is `true`, it appends the two pointer filenames (`AGENTS.md`, `CLAUDE.md`) — otherwise it returns a copy of `ALLOWED_DIRS`.

`allowedAbs(repoRoot, dir)` resolves the absolute path of an allowed directory and asserts that it still lives under `repoRoot`. It throws a generic `Error` if the computed directory escapes the root (defense in depth; this should not happen given that `dir` is a controlled literal).

## Errors

<!-- lw:anchors packages/core/src/safe-io.ts#PathOutsideAllowlistError packages/core/src/safe-io.ts#PathOutsideAllowlistError.constructor packages/core/src/safe-io.ts#InvalidRelativePathError packages/core/src/safe-io.ts#InvalidRelativePathError.constructor -->

`PathOutsideAllowlistError` is thrown when a resolved path falls outside the allowlist. The constructor (`PathOutsideAllowlistError.constructor`) stores `repoRoot`, `attempted`, and `allowlist` on the instance for diagnostic and programmatic use.

`InvalidRelativePathError` is thrown for malformed relative paths. Its constructor records the offending `relPath` and a `reason` string.

## Path validation

<!-- lw:anchors packages/core/src/safe-io.ts#isInsideAllowlist packages/core/src/safe-io.ts#validateDeclared packages/core/src/safe-io.ts#findDeepestExisting packages/core/src/safe-io.ts#resolveAndValidate -->

`isInsideAllowlist(repoRoot, absPath, opts?)` decides whether an absolute path falls inside one of the allowed directories. It compares by prefix with a separator boundary so that `livewiki-evil` is not treated as inside `livewiki/`. When `allowPointer` is enabled, it also accepts exact matches for `AGENTS.md` and `CLAUDE.md` at the repo root. Pure — does not touch the disk.

`validateDeclared(repoRoot, relPath, opts)` performs the fast, symlink-unaware validation. It rejects absolute paths, paths containing a `..` segment after normalization, and any target that is not inside the allowlist. Returns the absolute target on success.

`findDeepestExisting(from, stopAt)` walks from `from` up toward `stopAt` until it finds an existing ancestor. Returns a tuple `[ancestor, suffix]` where `suffix` is the portion of `from` that did not yet exist. Synchronous because `existsSync` is the right primitive in the loop; `realpath` is only called once on the result.

`resolveAndValidate(repoRoot, relPath, opts?)` is the canonical entry point. Algorithm:

1. Validate the declared path (`validateDeclared`).
2. Find the deepest existing ancestor (`findDeepestExisting`).
3. `realpath` that ancestor.
4. Reconstruct the final absolute path as `realAncestor + suffix`.
5. Re-validate the final path against the allowlist.

Any failure throws `InvalidRelativePathError` or `PathOutsideAllowlistError`. The realpath step closes symlink attacks of the form `livewiki` → `/tmp`, `livewiki/sub` → `../src`, or `livewiki/leaf` → `/etc/x`.

## I/O operations

<!-- lw:anchors packages/core/src/safe-io.ts#writeText packages/core/src/safe-io.ts#readText packages/core/src/safe-io.ts#exists packages/core/src/safe-io.ts#mkdir packages/core/src/safe-io.ts#remove -->

All public I/O functions call `resolveAndValidate` before touching the disk.

`writeText(repoRoot, relPath, content, opts?)` validates the path, ensures the parent directory exists, then writes the content as UTF-8.

`readText(repoRoot, relPath, opts?)` validates the path and reads the file as UTF-8.

`exists(repoRoot, relPath, opts?)` validates the allowlist (intentional: even metadata reads can leak existence outside `livewiki/`) and reports `false` on I/O errors other than `PathOutsideAllowlistError`, which is re-thrown.

`mkdir(repoRoot, relPath, opts?)` validates the path and creates the directory recursively.

`remove(repoRoot, relPath, opts?)` validates the path and removes it recursively with `force: true`.

## Options

`SafeIoOptions.allowPointer` opts in to writing `AGENTS.md` / `CLAUDE.md` at the repo root. Default `false`. TODO: the actual `pointer.ts` module referenced for Phase 5 is not documented here.
