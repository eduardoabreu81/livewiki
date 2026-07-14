---
title: src-manifest-test-ts
owner: generated
anchors:
  - packages/core/src/manifest.test.ts#writeLivewikiFile
---

# `packages/core/src/manifest.test.ts`

Vitest suite for `manifest.ts`. Uses `tmpdir` + per-test fixture isolation (`beforeEach` mkdtemp, `afterEach` rm recursive). All filesystem writes route through `writeLivewikiFile`.

## Test helper
<!-- lw:anchors packages/core/src/manifest.test.ts#writeLivewikiFile -->

`writeLivewikiFile(relPath: string, content: string): Promise<void>`

Resolves `relPath` against the per-test `repoRoot`, creates intermediate directories (`mkdir { recursive: true }`), then writes `content` to disk. Centralizes fixture creation so every test gets the same path-joining + parent-dir semantics without boilerplate.

Used to seed `livewiki/*.md` source pages, to materialize `MANIFEST_REL_PATH` (`.manifest.json`) for read/write tests, and to overwrite pages between phases of the idempotency assertions.