---
title: Livewiki Manifest Persistence and Coordination
owner: generated
anchors:
  - packages/core/src/manifest.ts#BASELINE_AUDIT_FILENAME
  - packages/core/src/manifest.ts#MANIFEST_REL_PATH
  - packages/core/src/manifest.ts#MANIFEST_VERSION
  - packages/core/src/manifest.ts#artifactReceiptsEqual
  - packages/core/src/manifest.ts#buildManifest
  - packages/core/src/manifest.ts#compareStrings
  - packages/core/src/manifest.ts#computeSnapshotHash
  - packages/core/src/manifest.ts#isConcurrentWrite
  - packages/core/src/manifest.ts#isHash
  - packages/core/src/manifest.ts#isRecord
  - packages/core/src/manifest.ts#listFiles
  - packages/core/src/manifest.ts#manifestsEqual
  - packages/core/src/manifest.ts#normalizeArtifactReceipts
  - packages/core/src/manifest.ts#parseManifest
  - packages/core/src/manifest.ts#pendingBatchEqual
  - packages/core/src/manifest.ts#readManifest
  - packages/core/src/manifest.ts#recordArtifactReceipt
  - packages/core/src/manifest.ts#refreshArtifactReceiptHashes
  - packages/core/src/manifest.ts#removeArtifactReceiptsForPaths
  - packages/core/src/manifest.ts#serializeManifest
  - packages/core/src/manifest.ts#upsertArtifactReceipt
  - packages/core/src/manifest.ts#writeManifestIfChanged
  - packages/core/src/manifest.ts#writeManifestState
  - packages/core/src/manifest.ts#yieldToConcurrentWriter
---

# Livewiki Manifest Persistence and Coordination

This page documents the mechanism that reads, writes, and keeps consistent the `.livewiki/.manifest.json` file that captures the state of a generated wiki across machines and runs.

## When to use this page

- Understand how the manifest file is structured and what each of its fields means.
- Learn how to read or compute the manifest’s snapshot hash without rewriting the file.
- Trace the flows that update operational fields or merge artifact receipts without losing data.
- Diagnose the concurrency handling that lets multiple processes write the manifest safely.

## How it fits

The livewiki project generates and maintains a rendered wiki inside a target repository. The manifest (`.livewiki/.manifest.json`) is the durable record that lets a later run on another machine understand the current state of that wiki. This module implements all the persistence for that record: reading it tolerantly, computing a snapshot hash of rendered output, writing it back only when content truly changed, and merging per-task artifact receipts under concurrent writers. The module lives in `packages/core/src/manifest.ts` and depends on `safe-io` for atomic, allowlisted file writes and on `hashes.js` for SHA-256 digest computation, while the manifest shape relates to batch state types declared elsewhere in the core package.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-manifest.mmd
```

## Reading and Hash Computation

<!-- lw:anchors packages/core/src/manifest.ts#MANIFEST_VERSION packages/core/src/manifest.ts#MANIFEST_REL_PATH packages/core/src/manifest.ts#BASELINE_AUDIT_FILENAME packages/core/src/manifest.ts#readManifest packages/core/src/manifest.ts#computeSnapshotHash packages/core/src/manifest.ts#listFiles -->

The manifest file is versioned so that a future reader can detect schema drift and still read older formats. The module declares three constants that appear throughout the file: `MANIFEST_VERSION` (currently 2, with version 1 still treated as readable), `MANIFEST_REL_PATH` (the repository-relative location `livewiki/.manifest.json`), and `BASELINE_AUDIT_FILENAME` (the name of the versioned audit companion file `.baseline.json`). These constants let the rest of the code refer to the same canonical strings and avoid typos across read, write, and filtering paths.

`readManifest` is the tolerant reader for the manifest. Its signature is:

```ts
export async function readManifest(repoRoot: string): Promise<LivewikiManifest | null>
```

It takes the repository root path and returns either a parsed manifest object or null when the file is absent or unparseable. The function first asks safe I/O whether the manifest exists, and if it does it reads the text and hands it to the internal parser. Worst case, such as a truncated file or transient I/O error, is swallowed by a catch clause that returns null — this is deliberate so that CI does not crash on a corrupt manifest; the writer can then rebuild it.

`computeSnapshotHash` produces the digest that lets the writer decide whether anything changed. The rest of the code compares snapshot hashes to avoid useless rewrites. The function walks the `livewiki/` directory recursively via `listFiles`, drops the manifest itself and the baseline audit file (plus their temporary write siblings), sorts the file list alphabetically so that the walk order is deterministic even though the underlying `nodeFs.readdir` does not guarantee order, and then reads every remaining file, appends `relpath\n<sha256(content)>\n` per file, and finally hashes the whole concatenation. That two-level hashing means that reordering files in the directory changes nothing by itself, only actual content changes alter the digest.

`listFiles` is the directory walker that `computeSnapshotHash` uses. It performs an explicit stack-based depth-first traversal, pushing subdirectories onto the stack and converting absolute paths back to forward-slash-separated relative ones. Any directory that cannot be read is skipped silently by a `continue`, so a single unreadable folder does not abort the whole hash computation.

## Writing and Equality

<!-- lw:anchors packages/core/src/manifest.ts#serializeManifest packages/core/src/manifest.ts#manifestsEqual packages/core/src/manifest.ts#pendingBatchEqual packages/core/src/manifest.ts#artifactReceiptsEqual packages/core/src/manifest.ts#writeManifestIfChanged -->

The writer’s job is to persist the manifest only when it has actually changed; unconditional rewrites would dirty the working tree on every CI run. Two helpers support that decision before any disk write happens.

`serializeManifest` converts an in-memory manifest to its JSON text form. Its signature is:

```ts
export function serializeManifest(manifest: LivewikiManifest): string
```

It takes a manifest object and returns a pretty-printed JSON string with two-space indentation followed by a trailing newline. That deterministic textual form is what the equality comparisons and atomic writer both operate on.

`manifestsEqual` decides whether two manifests represent the same logical content. It deliberately ignores the `updatedAt` timestamp, because that field changes on every build and would otherwise defeat the anti-loop check. The comparison covers the version number, the snapshot hash, the last documented commit, and the two nested structures. `pendingBatchEqual` compares progress fields field by field when both sides are non-null, treating two nulls as equal. `artifactReceiptsEqual` falls back to a direct JSON string comparison of the receipt arrays, since receipts are normalized and sorted before they are stored.

`writeManifestIfChanged` is the main entry point that ties reading and equality together before writing. It reads the current on-disk manifest, parses it, and if the current content already equals the proposed manifest (by the `manifestsEqual` rule) it returns false without touching the file. Otherwise it serializes the new manifest and asks safe I/O to perform an atomic write with compare-and-swap semantics, providing the previously read raw text as the expected value and a lock path so that concurrent writers can detect one another. It returns true only when an actual write was performed.

## State Maintenance Under Concurrency

<!-- lw:anchors packages/core/src/manifest.ts#writeManifestState packages/core/src/manifest.ts#recordArtifactReceipt packages/core/src/manifest.ts#removeArtifactReceiptsForPaths packages/core/src/manifest.ts#refreshArtifactReceiptHashes packages/core/src/manifest.ts#buildManifest packages/core/src/manifest.ts#isConcurrentWrite packages/core/src/manifest.ts#yieldToConcurrentWriter -->

Multiple long-running tasks in the batch pipeline may want to update the manifest at the same time — one task finishing its evidence while another advances progress. A naive write would overwrite the other’s receipt, so the module provides a family of read-modify-write operations that merge new state into what is already on disk.

`writeManifestState` updates the operational fields (commit, snapshot, progress) without dropping the durable artifact receipts. It loops up to a fixed number of attempts (32). Each attempt re-reads the current manifest, refuses to proceed if the file exists but cannot be parsed (throwing instead of persisting an empty receipt list over durable data), then builds its candidate with `buildManifest` and preserves the receipts it read. If the candidate is equal to the current content it returns false. Otherwise it tries an atomic compare-and-swap write. A conflict from a concurrent writer is caught, and unless this was the last attempt the function backs off via `yieldToConcurrentWriter` and retries with a fresh read.

`recordArtifactReceipt` is the merge point when a single contract-bound task completes and wants to persist its proof. Its behavior mirrors `writeManifestState`: it reads the current manifest, recomputes the snapshot hash (because the new artifact output usually changed rendered content), and merges the incoming receipt using the pure `upsertArtifactReceipt` helper. It also refuses to modify an unparseable manifest and uses the same bounded retry loop.

`removeArtifactReceiptsForPaths` retires receipts whose generated outputs were explicitly deleted. If the path set is empty it returns false immediately. Otherwise it reads the manifest, filters out every receipt that contains an artifact matching one of the retired paths, and, if nothing was removed, returns false without writing. The write path follows the same compare-and-swap retry discipline.

`refreshArtifactReceiptHashes` updates only the hash values of receipts whose output files were rewritten by trusted deterministic navigation. It recomputes the SHA-256 of each affected artifact’s content via safe I/O, leaves untouched receipts alone, and only writes when at least one hash actually changed.

`buildManifest` is the pure constructor that every mutating writer funnels through. Its signature is:

```ts
export function buildManifest(args: {
  lastDocumentedCommit: string | null;
  snapshotHash: string;
  pendingBatch: PendingBatchRef | null;
  artifactReceipts?: ArtifactReceipt[];
}): LivewikiManifest
```

It takes the semantic fields plus an optional receipt array and returns a fully-formed manifest with the current `MANIFEST_VERSION`, a fresh ISO `updatedAt`, and normalized receipts. If normalization rejects the receipts, the function throws so that no malformed state is ever persisted.

`isConcurrentWrite` classifies an error thrown by safe I/O as either a compare-and-swap conflict or a write-lock-busy condition. Both are expected outcomes of racing writers, so the caller can distinguish them from serious I/O faults. `yieldToConcurrentWriter` implements the bounded exponential backoff: it resolves a promise after a timeout that grows linearly with the attempt number, capped at 100 milliseconds.

## Receipt Normalization and Validation

<!-- lw:anchors packages/core/src/manifest.ts#upsertArtifactReceipt packages/core/src/manifest.ts#normalizeArtifactReceipts packages/core/src/manifest.ts#parseManifest packages/core/src/manifest.ts#isHash packages/core/src/manifest.ts#isRecord packages/core/src/manifest.ts#compareStrings -->

Artifact receipts are the deterministic proof records for contract-bound tasks, and the module treats them as untrusted input that must be validated before it is stored. Two public and three internal functions implement that discipline.

`upsertArtifactReceipt` merges a single new receipt into an existing list without losing any concurrent tasks’ receipts. Its signature is:

```ts
export function upsertArtifactReceipt(
  receipts: readonly ArtifactReceipt[],
  receipt: ArtifactReceipt,
): ArtifactReceipt[]
```

It takes the current receipt array and the new receipt, and returns a new normalized array. The function appends the new receipt to the existing ones and calls `normalizeArtifactReceipts` with the duplicate-replacement flag enabled; this means that if the task already has a receipt, the newer one replaces it rather than being rejected. A null return from the normalizer causes a throw so that invalid data cannot reach the disk.

`normalizeArtifactReceipts` is the single validator every path — parsing, merging, and constructing — uses. It accepts the raw value and an optional boolean that, when true, allows a later receipt to replace an earlier one for the same task ID; otherwise a duplicate task ID is an error. The function first requires an actual array. Each candidate must be a plain record (checked by `isRecord`), must have a non-empty string `taskId`, a 64-character lowercase hex `evidenceHash` (checked by `isHash`), a non-empty `contract` string, and a non-empty array of artifact outputs. Each output must be a record with a forward-slash-only path that starts with `livewiki/`, a hex hash, and no duplicated path. Every output is also subject to a path uniqueness check within the same receipt. After validation the function sorts outputs by path and receipts by task ID using `compareStrings`, producing a canonical order that makes later string equality reliable.

`parseManifest` is the tolerant deserializer that `readManifest` and the write paths use to turn raw text back into a structured manifest. The parser first runs `JSON.parse` inside a try block and returns null on any exception. It accepts only version 1 or the current `MANIFEST_VERSION` (2); anything else is null, which the callers interpret as corruption. The snapshot hash must be a string, and receipts must pass full `normalizeArtifactReceipts` validation; otherwise the manifest is rejected. The remaining fields are defaulted permissively — a missing `updatedAt` becomes an empty string and a missing `pendingBatch` becomes null — so that a slightly out-of-spec file can still be read.

The three small guards on which validation depends are `isHash`, which tests that a value is exactly 64 lowercase hex characters; `isRecord`, which narrows an unknown value to a non-null, non-array object (the normalizer uses it to ensure it never reads array-like inputs as records); and `compareStrings`, which provides a total ordering on strings (negative, zero, or positive) that the receipt and output sorters rely on for deterministic output.

## Tests

Covered by `packages/core/src/manifest.test.ts` (same-name test file on disk).
