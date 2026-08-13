---
title: Livewiki manifest read/write pipeline
owner: generated
anchors:
  - packages/core/src/manifest.ts#MANIFEST_REL_PATH
  - packages/core/src/manifest.ts#MANIFEST_VERSION
  - packages/core/src/manifest.ts#readManifest
  - packages/core/src/manifest.ts#computeSnapshotHash
  - packages/core/src/manifest.ts#listFiles
  - packages/core/src/manifest.ts#writeManifestIfChanged
  - packages/core/src/manifest.ts#manifestsEqual
  - packages/core/src/manifest.ts#pendingBatchEqual
  - packages/core/src/manifest.ts#buildManifest
---

# Livewiki manifest read/write pipeline

This page documents the single file that owns the on-disk manifest (`livewiki/.manifest.json`) used by the livewiki batch pipeline to hand off state across machines and runs.

## When to use this page

- **Read** `readManifest` / `computeSnapshotHash` behavior when you need to understand how a CI job detects "nothing changed" and skips rewriting.
- **Trace** the manifest's contents with `buildManifest` when adding a new field or changing the schema version (`MANIFEST_VERSION`).
- **Debug** cross-machine batch handoff failures by inspecting how `pendingBatch` flows through `writeManifestIfChanged` and `pendingBatchEqual`.
- **Audit** the determinism guarantees of the snapshot hash by following `listFiles` and the sort/filter steps in `computeSnapshotHash`.

## How it fits

`packages/core/src/manifest.ts` is the manifest module of livewiki's core package. It is the only place that knows the on-disk location of the manifest (`MANIFEST_REL_PATH`) and the shape of the JSON document (`LivewikiManifest`). Callers from the batch pipeline ask it to read the current manifest, build a new one from the latest snapshot hash and pending batch state, and write it back — but only if the document would actually change.

The module sits next to `safe-io.js` (used here as the allowlisted writer for everything under `livewiki/`), `hashes.js` (the `sha256` primitive used to fingerprint file contents), and the `PendingBatchRef` type re-exported from `batch-state.js`. The manifest is what makes the rest of the system resumable across machines: a second machine reading the repo sees the in-flight batch in `pendingBatch` and resumes with `batch resume` instead of starting over.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-manifest.mmd
```

## Constants and types

<!-- lw:anchors packages/core/src/manifest.ts#MANIFEST_REL_PATH packages/core/src/manifest.ts#MANIFEST_VERSION -->

The two exported constants pin the schema and the location so every reader and writer agrees on what they are looking at.

```ts
export const MANIFEST_VERSION = 1;
export const MANIFEST_REL_PATH = "livewiki/.manifest.json";
```

`MANIFEST_VERSION` is the integer written into the manifest's `version` field — bumping it is how a schema migration is signaled to old readers. `MANIFEST_REL_PATH` is the repo-relative path the rest of the module uses everywhere it talks to `safe-io`; centralizing it here keeps the file path from being repeated (and drifted) across the codebase. The exported `LivewikiManifest` interface, declared alongside these constants, is the shape that `version`, `lastDocumentedCommit`, `snapshotHash`, `updatedAt`, and `pendingBatch` always take when the module is finished with them.

## Reading the manifest

<!-- lw:anchors packages/core/src/manifest.ts#readManifest -->

`readManifest` is the safe entry point for "what does the manifest currently say?" It is intentionally tolerant: a missing file, a malformed JSON document, or a document that lacks the two fields the rest of the module depends on all collapse to `null` rather than a thrown error.

```ts
export async function readManifest(repoRoot: string): Promise<LivewikiManifest | null>
```

Given an absolute `repoRoot` for the target repository, it returns the parsed `LivewikiManifest` if one is present and well-formed, otherwise `null`. Internally it first asks `safe-io.exists` whether `livewiki/.manifest.json` is on disk; if `safe-io.exists` rejects, that rejection is swallowed and treated as "not present" so the rest of the pipeline never blocks on a permission quirk. When the file is present, `safe-io.readText` fetches its contents and `JSON.parse` deserializes them. The function then validates two invariants — `version` must be a `number` and `snapshotHash` must be a `string` — and returns `null` if either is missing; the surrounding `try`/`catch` turns any other parse or read failure into the same `null` outcome. Because of this design, callers can treat "no manifest" and "broken manifest" identically and proceed without a try block of their own.

## Fingerprinting the livewiki tree

<!-- lw:anchors packages/core/src/manifest.ts#computeSnapshotHash packages/core/src/manifest.ts#listFiles -->

`computeSnapshotHash` answers "has the documented content of `livewiki/` actually changed since the last manifest?" The hash it returns is what later allows `writeManifestIfChanged` to skip rewriting when nothing has moved.

```ts
export async function computeSnapshotHash(repoRoot: string): Promise<string>
```

It returns a deterministic hex `sha256` digest covering every file under `repoRoot/livewiki/`, with the manifest itself excluded from the input so that writing the manifest cannot change its own hash. The algorithm walks the tree with `listFiles`, drops any entry whose filename ends with the manifest's basename, then sorts the remaining relative paths so the digest is stable regardless of the order `node:fs` happens to return them in. For each surviving path it reads the file as UTF-8, hashes the content with `sha256`, and concatenates a record of the form `relpath\n<sha256(content)>\n`. The concatenation of all those records is itself hashed with `sha256` to produce the final digest. If a directory walk fails (for example, a permission error on a subdirectory), `listFiles` swallows that and keeps going, so a single unreadable subfolder does not block the whole hash.

```ts
async function listFiles(dir: string): Promise<string[]>
```

`listFiles` is the recursive walker that backs `computeSnapshotHash`. Given a directory, it returns an array of every file inside it as paths relative to that directory, using forward slashes regardless of the host OS. It uses an explicit stack rather than recursion so deep trees cannot blow the call stack; the stack is initialized with `dir` and drained by popping one entry per loop iteration. Each popped directory is read with `node:fs.readdir({ withFileTypes: true })`; if that read throws, the loop simply moves on to the next stack entry, which is what gives `computeSnapshotHash` its partial-failure tolerance. Directories are pushed back onto the stack; regular files have their absolute path converted to a forward-slashed relative path via `nodePath.relative` and pushed onto the output array. The output order is whatever the traversal happened to produce, which is why `computeSnapshotHash` re-sorts it before hashing.

## Equality checks

<!-- lw:anchors packages/core/src/manifest.ts#manifestsEqual packages/core/src/manifest.ts#pendingBatchEqual -->

Two small predicates decide whether a freshly built manifest differs from the one already on disk. They exist specifically to avoid the "rewrite every run" anti-pattern that would otherwise spam `git diff` in CI.

```ts
function manifestsEqual(a: LivewikiManifest, b: LivewikiManifest): boolean
```

`manifestsEqual` compares two manifests field-by-field on everything that represents *content*: `version`, `snapshotHash`, `lastDocumentedCommit`, and `pendingBatch`. It deliberately ignores `updatedAt`, because that field is a write-time timestamp that would always differ between two successive runs — comparing it would defeat the "skip the write if nothing changed" optimization and force every CI run to commit a one-line manifest change. The `pendingBatch` comparison is delegated to `pendingBatchEqual` so the same definition of "equal pending batch" is shared with anywhere else that needs it.

```ts
function pendingBatchEqual(a: PendingBatchRef | null, b: PendingBatchRef | null): boolean
```

`pendingBatchEqual` reports equality for `PendingBatchRef` values, where `null` means "no batch in flight". Both `null` is equal; one `null` and one non-`null` is not; otherwise all four fields (`runId`, `stage`, `done`, `total`) must match exactly. Callers that only care about "did the batch pointer change?" can therefore reuse this without re-implementing the field list.

## Writing the manifest idempotently

<!-- lw:anchors packages/core/src/manifest.ts#writeManifestIfChanged -->

`writeManifestIfChanged` is the only path that should ever cause the manifest file to appear or change on disk. It is designed to be safe to call on every pipeline run without producing noisy diffs.

```ts
export async function writeManifestIfChanged(
  repoRoot: string,
  manifest: LivewikiManifest,
): Promise<boolean>
```

Given a repository root and a freshly built `LivewikiManifest`, it returns `true` if it actually wrote the file and `false` if the on-disk copy was already equivalent. The flow is: read whatever is on disk via `readManifest`; if a current manifest exists and `manifestsEqual` says it matches the candidate, return `false` immediately and do not touch the filesystem. Otherwise serialize the candidate as pretty-printed JSON (`JSON.stringify(manifest, null, 2)`) with a trailing newline, hand it to `safe-io.writeText` so the write is allowlisted to the `livewiki/` directory, and return `true`. Because the equality check ignores `updatedAt`, a candidate that differs only in its timestamp is treated as equal and the file is left alone — that is the mechanism that keeps CI's `git diff` clean across runs that did not actually document anything new.

## Building a fresh manifest

<!-- lw:anchors packages/core/src/manifest.ts#buildManifest -->

`buildManifest` is the constructor the rest of the pipeline calls when it has finished a documentation pass and wants to record the new state. It is a thin assembler, but centralizing it ensures every manifest that hits disk goes through the same field-stamping logic.

```ts
export function buildManifest(args: {
  lastDocumentedCommit: string | null;
  snapshotHash: string;
  pendingBatch: PendingBatchRef | null;
}): LivewikiManifest
```

It takes the three pieces of state that genuinely belong to a run — the last documented commit SHA (or `null` if none), the snapshot hash from `computeSnapshotHash`, and any in-flight batch reference (or `null`) — and returns a `LivewikiManifest` ready to hand to `writeManifestIfChanged`. The returned object always carries `version: MANIFEST_VERSION` so the schema constant flows into every manifest without each call site re-stating it, and `updatedAt` is stamped at construction time via `new Date().toISOString()` so the timestamp reflects the moment the manifest was assembled rather than the moment it was serialized to disk.

## Tests

Covered by `packages/core/src/manifest.test.ts` (same-name test file on disk).
