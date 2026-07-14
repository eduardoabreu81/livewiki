---
title: packages/core/src/safe-io.test.ts
owner: generated
anchors:
  - packages/core/src/safe-io.test.ts#detectSymlinkSupport
---

# packages/core/src/safe-io.test.ts

This module is the test suite for `safe-io.ts`. It exercises the allowlist-based
path validator (`ALLOWED_DIRS`, `isInsideAllowlist`, `resolveAndValidate`) and
the I/O helpers (`writeText`, `readText`, `exists`, `mkdir`, `remove`), with a
dedicated block of tests covering symlink-attack defenses on hosts that allow
symlink creation.

The file uses `vitest` and creates a fresh temporary `repoRoot` per test via
`beforeEach` / `afterEach`. Symlink-specific tests are gated on a runtime probe
so they are skipped cleanly on platforms (notably Windows without Developer
Mode / admin rights) that cannot create symlinks.

## Symlink capability probe

<!-- lw:anchors packages/core/src/safe-io.test.ts#detectSymlinkSupport -->

`detectSymlinkSupport` is an async function that returns `Promise<boolean>`. It
runs once at module load (via top-level `await`) and its result is bound to the
constant `canSymlink`, which is then consumed by `it.runIf(canSymlink)(...)`
calls throughout the suite.

The probe performs a small, self-contained operation in `os.tmpdir()`:

1. Writes a temporary file `livewiki-symlink-target-<pid>`.
2. Creates a symlink `livewiki-symlink-probe-<pid>` pointing at that target.
3. Removes both the symlink and the target file.
4. Returns `true` if every step succeeds.

If any step throws (for example on Windows where creating symlinks requires
Developer Mode or admin privileges), the `try`/`catch` swallows the error and
the function returns `false`. The suite then logs a skip notice via
`console.warn` so the absence of symlink coverage is visible in test output.

Because the probe writes only inside `os.tmpdir()` and cleans up after itself,
it does not depend on the per-test `repoRoot` and is safe to run at module
load before any `beforeEach` hooks fire. The `pid` suffix avoids collisions
between parallel Vitest workers reusing the same `os.tmpdir()`.