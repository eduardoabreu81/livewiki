---
title: Durable Commit Boundary for Contract-Bound Documentation Tasks
owner: generated
anchors:
  - packages/core/src/documentation-commit.ts#canonicalJson
  - packages/core/src/documentation-commit.ts#commitDocumentationTask
  - packages/core/src/documentation-commit.ts#compareText
  - packages/core/src/documentation-commit.ts#contractVersion
  - packages/core/src/documentation-commit.ts#recoverDocumentationReceipt
  - packages/core/src/documentation-commit.ts#retireDocumentationArtifacts
  - packages/core/src/documentation-commit.ts#validateArtifactHashes
---

# Durable Commit Boundary for Contract-Bound Documentation Tasks

This page documents the durable commit boundary that persists one validated, contract-bound documentation task's outputs and receipts.

## When to use this page

- Trace how a documentation task's artifacts are validated, persisted, and recoverable after program interruption.
- Understand how receipts and baseline pages are retired when documentation artifacts are removed.
- Learn how receipt evidence is hashed and compared for exact, versioned recovery proofs.
- See how canonical JSON and text comparison provide stable, deterministic ordering for receipt and evidence processing.

## How it fits

This module lives in `packages/core/src/documentation-commit.ts` and implements the transaction-like boundary between generating documentation artifacts and durably recording them. It imports from `safe-io.js`, `baseline-operations.js`, `hashes.js`, and `manifest.js` to read/write files, advance baselines, hash content, and store receipt records. The module exports two primary entry points—`commitDocumentationTask` for normal commits and `recoverDocumentationReceipt` for reconstructing checkpoints—plus internal helpers that make both flows deterministic. Developers extending the core engine's persistence layer would modify these functions to change commit semantics, receipt formats, or recovery criteria.

This file defines the contract kinds and options interfaces that orchestrate validation, baseline updates, and receipt recording. It is not an entry point for the whole project but a dedicated commit stage that other core modules invoke after generating documentation assets. The module's internal helpers, such as `canonicalJson` and `compareText`, serve the commit and recovery flows by providing stable serialization and ordering, ensuring that hashes and path comparisons are reproducible across runs.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-documentation-commit.mmd
```

## Commit Flow

<!-- lw:anchors packages/core/src/documentation-commit.ts#commitDocumentationTask packages/core/src/documentation-commit.ts#validateArtifactHashes -->

This section explains the normal commit path, where a task's artifacts are validated, baselined, and receipted.

`commitDocumentationTask` is the public entry point that orchestrates a durable commit. It first checks that the task's `wikiPath` matches the declared `page` and that a `pageHash` exists, throwing an error if either fails; this ensures the task has a real page artifact before proceeding. It then calls `validateArtifactHashes` to re-read each artifact from disk and confirm its SHA-256 hash matches the declared one, throwing if any file changed between generation and commit to prevent committing stale or corrupted output.

After validation, the module advances the contract baseline via `advanceContractBaseline`, recording the page's symbol keys into the baseline state; this step makes the page's coverage durable against future runs. It computes an `evidenceHash` by applying `sha256` to `canonicalJson(options.evidence)`, producing a stable fingerprint of the task's proof data. For non-`file-page` tasks, it calls `recordArtifactReceipt` with the task id, evidence hash, contract version, and sorted artifact outputs; the `contractVersion` function maps the task kind to a versioned string such as `"flow-v1"` that future recovery checks will match. The function returns a result object with `baselineWritten`, `receiptWritten`, and `evidenceHash`, telling callers what was persisted and with what proof fingerprint.

`validateArtifactHashes` is an async helper that performs the mechanical check. It requires both `wikiPath` and `pageHash` to be present, throwing `"missing page artifact"` otherwise. It enforces that the diagram path and hash appear together—if only one is set it throws—and then reads each artifact from disk with `safeIo.readText`, comparing `sha256` of the file to the declared hash; any mismatch throws `"artifact changed before durable commit"` with the offending path. Finally it sorts the output records by path using `compareText`, giving the caller a deterministic artifact list for the receipt.

The one-liner signature for the exported commit function is:

```ts
export async function commitDocumentationTask(
  options: CommitDocumentationTaskOptions,
): Promise<CommitDocumentationTaskResult>
```

This takes a `CommitDocumentationTaskOptions` config and returns a result describing whether the baseline and receipt were written plus the evidence hash.

The internal validator's signature is:

```ts
async function validateArtifactHashes(
  repoRoot: string,
  artifacts: TaskArtifacts,
): Promise<ArtifactReceiptOutput[]>
```

This takes a repository root and task artifact descriptors, returning a sorted list of artifact paths and hashes for the receipt.

## Receipt Recovery

<!-- lw:anchors packages/core/src/documentation-commit.ts#recoverDocumentationReceipt packages/core/src/documentation-commit.ts#contractVersion -->

This section covers how a previously completed checkpoint is rebuilt from exact, versioned receipt proof without trusting any in-memory state.

`recoverDocumentationReceipt` reconstructs a completed checkpoint only when the persisted receipt exactly matches the caller's supplied evidence and version. It first reads the repository manifest with `readManifest` and searches its receipt list for an entry with the matching `taskId`. If no receipt exists, or the receipt's `contract` does not equal `contractVersion(options.kind)`, or the receipt's `evidenceHash` does not equal `sha256(canonicalJson(options.evidence))`, the function returns `null`—this fail-closed branch ensures that only a byte-exact, versioned proof reconstructs a task.

When the contract and evidence hash match, the function builds the expected artifact path list from `options.page` and, optionally, `options.diagram`, sorting paths with `compareText`. It compares the receipt's artifact count and each artifact path to those expected; any mismatch returns `null`. For every artifact in the receipt, it re-reads the file from disk with `safeIo.readText` and compares `sha256` of the content to the stored hash—if any file is missing or its hash differs, recovery fails and returns `null`. After confirming all files, it locates the page output and, if a diagram was requested, the diagram output; if either required artifact is absent it returns `null`. On success it returns a `TaskArtifacts` object with `wikiPath`, `pageHash`, and optionally `diagramPath` plus `diagramHash`, giving the caller a reconstructed artifact descriptor.

`contractVersion` is the pure mapping from a task kind to its versioned receipt string. It takes a kind that excludes `"file-page"` (since page tasks do not write receipts) and returns one of `"folder-page-v1"`, `"flow-v1"`, `"topic-v1"`, or `"understanding-v1"` via a switch. That string is what both `commitDocumentationTask` and `recoverDocumentationReceipt` compare against, so bumping the version for a future contract change invalidates old receipts automatically.

The exported recovery function's signature is:

```ts
export async function recoverDocumentationReceipt(
  options: RecoverDocumentationReceiptOptions,
): Promise<TaskArtifacts | null>
```

This takes a `RecoverDocumentationReceiptOptions` and returns a reconstructed `TaskArtifacts` or `null` if proof does not hold.

The internal version mapper's signature is:

```ts
function contractVersion(kind: Exclude<ContractTaskKind, "file-page">): string
```

This takes a non-`file-page` kind and returns the matching versioned contract string.

## Artifact Retirement

<!-- lw:anchors packages/core/src/documentation-commit.ts#retireDocumentationArtifacts -->

This section describes how stale or removed documentation artifacts are cleaned from both the baseline and the manifest.

`retireDocumentationArtifacts` removes documentation artifacts that no longer exist from two persistence layers. It takes a repository root and a list of removed paths, filters that list for entries ending in `".md"` (treating those as baseline pages), and calls `removeBaselinePages` so those pages stop being counted as covered. It then passes the full removed-path list to `removeArtifactReceiptsForPaths`, which deletes any receipt records tied to those artifact paths, ensuring the manifest no longer references files that are gone. This function is asynchronous and returns nothing, serving as the cleanup counterpart to commit—callers invoke it when a file is deleted from the wiki tree.

The exported retirement function's signature is:

```ts
export async function retireDocumentationArtifacts(
  repoRoot: string,
  removedPaths: readonly string[],
): Promise<void>
```

This takes a repository root and an immutable list of removed paths, then updates the baseline and manifest accordingly.

## Deterministic Helpers

<!-- lw:anchors packages/core/src/documentation-commit.ts#canonicalJson packages/core/src/documentation-commit.ts#compareText -->

This section covers the two pure helpers that give the commit and recovery flows deterministic ordering and serialization.

`canonicalJson` produces stable JSON for receipt evidence so that object key insertion order is irrelevant. When the input is `null` or a primitive, it returns `JSON.stringify` directly. For arrays it maps each element through `canonicalJson` and joins with commas inside brackets. For records it sorts the keys with `compareText`, then emits each key via `JSON.stringify` followed by the canonical value, joining all pairs with commas inside braces. This guarantees that two semantically equal objects with different key orders produce identical JSON strings, making evidence hashes comparable across runs.

`compareText` is a simple lexicographic string comparator used for deterministic ordering. It returns `-1` when `left` sorts before `right`, `1` when it sorts after, and `0` when equal, based on JavaScript's built-in `<` and `>` operators. Both the artifact path sorting in `validateArtifactHashes` and the key sorting in `canonicalJson` rely on it so the whole pipeline, from artifact list to evidence string, is completely reproducible—critical for hashing and receipt matching.

The exported canonical JSON function's signature is:

```ts
export function canonicalJson(value: unknown): string
```

This takes any JSON-compatible value and returns a stable string with sorted object keys.

The internal comparator's signature is:

```ts
function compareText(left: string, right: string): number
```

This takes two strings and returns their deterministic sort order as `-1`, `0`, or `1`.

## Tests

Covered by `packages/core/src/documentation-commit.test.ts` (same-name test file on disk).
