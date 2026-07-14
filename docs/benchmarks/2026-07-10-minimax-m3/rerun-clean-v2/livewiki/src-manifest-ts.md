---
title: src-manifest-ts
owner: generated
anchors:
  - packages/core/src/manifest.ts#MANIFEST_REL_PATH
  - packages/core/src/manifest.ts#MANIFEST_VERSION
  - packages/core/src/manifest.ts#buildManifest
  - packages/core/src/manifest.ts#computeSnapshotHash
  - packages/core/src/manifest.ts#listFiles
  - packages/core/src/manifest.ts#manifestsEqual
  - packages/core/src/manifest.ts#pendingBatchEqual
  - packages/core/src/manifest.ts#readManifest
  - packages/core/src/manifest.ts#writeManifestIfChanged
---

## Constants
<!-- lw:anchors packages/core/src/manifest.ts#MANIFEST_REL_PATH packages/core/src/manifest.ts#MANIFEST_VERSION -->

The manifest file is versioned and lives at a fixed relative path inside the target repo, enabling cross-machine handoff.

- `MANIFEST_VERSION = 1` — current schema version of the manifest.
- `MANIFEST_REL_PATH = "livewiki/.manifest.json"` — path relative to the repo root where the manifest is written.

The manifest is written via `safe-io` (the `livewiki/` directory is on the allowlist). It is only rewritten when content changes, keeping `git diff` clean in CI.

## Reading the manifest
<!-- lw:anchors packages/core/src/manifest.ts#readManifest -->

`readManifest(repoRoot)` reads the manifest from disk and returns the parsed object, or `null` if the file does not exist or is corrupted. Corruption is tolerated and surfaces as `null` rather than an exception (CI-friendly behavior).

Validation requires `version` to be a `number` and `snapshotHash` to be a `string`; any other shape resolves to `null`.

## Snapshot hash
<!-- lw:anchors packages/core/src/manifest.ts#computeSnapshotHash packages/core/src/manifest.ts#listFiles -->

`computeSnapshotHash(repoRoot)` computes a SHA-256 over the contents of `livewiki/`, **excluding** the manifest itself. This follows the OpenWiki convention and prevents write loops in CI.

Algorithm:
1. Recursively list every file under `livewiki/`.
2. Filter out the manifest file itself.
3. Sort the list alphabetically (deterministic ordering, since `node:fs.readdir` order is not guaranteed).
4. For each file, emit `relpath\n<sha256(content)>\n`.
5. Return `sha256` of the concatenated buffer.

`listFiles(dir)` is the internal helper that performs the recursive walk using an explicit stack, returning POSIX-style relative paths. Directory entries are pushed onto the stack; files are recorded.

## Building a manifest
<!-- lw:anchors packages/core/src/manifest.ts#buildManifest -->

`buildManifest(args)` constructs a new `LivewikiManifest` from the current state:

- `version` — set from `MANIFEST_VERSION`.
- `lastDocumentedCommit` — SHA of the last documented commit, passed in.
- `snapshotHash` — result of `computeSnapshotHash`.
- `updatedAt` — ISO 8601 timestamp captured at construction time.
- `pendingBatch` — `PendingBatchRef | null`, enabling cross-machine handoff of an interrupted batch (another machine reads the manifest, sees the pending run, and resumes with `batch resume`).

## Writing the manifest
<!-- lw:anchors packages/core/src/manifest.ts#writeManifestIfChanged -->

`writeManifestIfChanged(repoRoot, manifest)` writes the manifest to disk via `safe-io`. It only rewrites when content actually changed (comparing `snapshotHash`, `pendingBatch`, and `updatedAt`), making the operation idempotent.

Returns `true` if a write occurred, `false` if the on-disk manifest already matched (anti-loop for CI).

## Equality helpers
<!-- lw:anchors packages/core/src/manifest.ts#manifestsEqual packages/core/src/manifest.ts#pendingBatchEqual -->

`manifestsEqual(a, b)` compares two manifests for content equality. `updatedAt` is intentionally **excluded** from the comparison — otherwise every call would produce a new timestamp and force a rewrite on every commit, breaking the CI anti-loop.

The compared fields are:

- `version`
- `snapshotHash`
- `lastDocumentedCommit`
- `pendingBatch` (delegated to `pendingBatchEqual`)

`pendingBatchEqual(a, b)` compares two `PendingBatchRef | null` values field-by-field: `runId`, `stage`, `done`, `total`. Two `null` values are equal; one `null` and one non-`null` are not.