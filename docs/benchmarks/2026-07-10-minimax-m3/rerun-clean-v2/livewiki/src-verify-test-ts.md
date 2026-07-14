---
title: src/verify.test.ts
owner: generated
anchors:
  - packages/core/src/verify.test.ts#writeCode
  - packages/core/src/verify.test.ts#writeWiki
---

# src/verify.test.ts

Test suite for the verify pipeline. Uses an ephemeral `mkdtemp` repo root per test (cleaned up in `afterEach`) and runs `runIndexer` → `runLedger` → `runVerify` against seeded code/wiki fixtures.

## File-system helpers
<!-- lw:anchors packages/core/src/verify.test.ts#writeCode packages/core/src/verify.test.ts#writeWiki -->

Both helpers resolve a `rel` path against the per-test `repoRoot`, create the parent directory recursively, and write `content` as UTF-8. They are local convenience wrappers — there is no logic difference between writing a source file and a wiki page; the distinction is purely about where in the synthetic tree the file lands (e.g. `src/foo.ts` vs `livewiki/foo.md`). Note that the `TMPDIR` fallback in `beforeEach` uses a hard-coded Windows path; on non-Windows hosts the OS-provided `TMPDIR` is preferred.

- `writeCode(rel, content)` — seeds a TypeScript source file under the temp repo.
- `writeWiki(rel, content)` — seeds a generated wiki Markdown page under `livewiki/`.

Both return `Promise<void>` and silently rely on `nodeFs.mkdir({ recursive: true })`, so callers do not need to pre-create nested directories.

## Test coverage scope (informational)

The helpers above are the only documented symbols in this module. The surrounding test bodies exercise the verify pipeline's issue codes (`broken_anchor`, `broken_internal_link`, `manual_block_altered`) and `formatHuman` formatting, but those behaviours belong to `verify.ts` rather than this file.
<!-- lw:anchors packages/core/src/verify.test.ts#writeCode packages/core/src/verify.test.ts#writeWiki -->

### Out-of-scope expectations

- TODO: behaviour of `writeCode` / `writeWiki` on permission errors (e.g. read-only FS) — not asserted by any test in this file.
- TODO: interaction between `writeCode` and the indexer when `content` contains syntax errors — the suite only writes well-formed fragments.