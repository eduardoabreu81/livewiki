---
title: Content hashing utilities
owner: generated
anchors:
  - packages/core/src/hashes.ts#expandEolToCrlf
  - packages/core/src/hashes.ts#normalizeEol
  - packages/core/src/hashes.ts#sha256
  - packages/core/src/hashes.ts#sha256Slice
---

# Content hashing utilities

This page documents the small hashing helper module that the indexer relies on to fingerprint file content and per-symbol source slices.

## When to use this page

- **Compute a file-level content hash** with `sha256` when you need a stable fingerprint for change detection across incremental index runs.
- **Normalize line endings before hashing** with `normalizeEol` so that a silent `core.autocrlf` checkout conversion never alters a fingerprint.
- **Hash a single symbol's source range** with `sha256Slice` to detect local edits inside a file whose total hash is unchanged.
- **Recompute a legacy raw-bytes hash** with `expandEolToCrlf` when migrating an old index whose files have since switched EOL convention.

## How it fits

This module lives in `packages/core/src/hashes.ts` and is a pure-function utility file with no internal state and no callers inside its own file. Downstream, the **indexer** (`indexer.ts`) is the primary consumer: it feeds every file's source text through `normalizeEol` before hashing it and before handing it to the tree-sitter parser, and it uses `sha256Slice` to fingerprint individual symbols so that a change confined to one symbol can be detected without re-parsing the whole file. The `expandEolToCrlf` helper sits in the same migration path and is used only when reconciling a database that was written under the old raw-bytes hashing scheme against files on disk that are now under the opposite EOL convention. Because the helpers are stateless and dependency-free (apart from `node:crypto`), they are safe to call from any indexer phase.

## Diagram

```mermaid
%% livewiki/diagrams/core-src-hashes.mmd
```

## Core hashing primitives

<!-- lw:anchors packages/core/src/hashes.ts#sha256 packages/core/src/hashes.ts#sha256Slice -->

The module exposes two SHA-256 helpers. Both produce a lowercase 64-character hex digest and use Node's built-in `node:crypto`; they carry no salt because they are content fingerprints, not authentication tokens.

`sha256` is the workhorse used to fingerprint an entire file's normalized source. Its signature is:

```ts
export function sha256(content: string | Uint8Array): string
```

It takes either a string or a raw byte buffer and returns the hex-encoded SHA-256 digest. The indexer calls it once per file after EOL normalization to populate the `content_hash` field used for incremental change detection.

`sha256Slice` is the symbol-level companion. Its signature is:

```ts
export function sha256Slice(source: string, startByte: number, endByte: number): string
```

It takes the full source string plus the half-open byte range `[startByte, endByte)` and returns the digest of that slice only. Internally it just calls `sha256(source.slice(startByte, endByte))`, so a small edit inside one symbol produces a different symbol hash without disturbing sibling symbols in the same file. This is what lets the indexer attribute debt to a specific symbol rather than to the file as a whole.

## EOL normalization for stable fingerprints

<!-- lw:anchors packages/core/src/hashes.ts#normalizeEol -->

Line endings are the single biggest source of phantom index churn on Windows checkouts, so the indexer collapses them to a single convention before anything else touches the text.

`normalizeEol` has the signature:

```ts
export function normalizeEol(content: string): string
```

It takes the raw source text and returns it with every CRLF sequence (`\r\n`) rewritten to LF (`\n`). Lone `\r` characters — the classic Mac convention — are deliberately left untouched: git does not produce them, and rewriting them would silently change the meaning of string literals that contain a raw carriage return. The function is applied exactly once, before the text is handed to tree-sitter and before any `sha256` call, so the parser's byte ranges and the hashes are computed over the same string. This is the fix for the "phantom debt" symptom where a silent `core.autocrlf` toggle changed every file's fingerprint without changing any actual content.

## Legacy-hash migration helper

<!-- lw:anchors packages/core/src/hashes.ts#expandEolToCrlf -->

Older versions of the index hashed raw bytes, so any database written before the EOL-normalization change stores hashes against the file's original line endings. When the on-disk files have since switched conventions, the indexer needs a way to recompute the legacy hash from the normalized text in order to recognize the file as already-known.

`expandEolToCrlf` is the inverse of `normalizeEol` and has the signature:

```ts
export function expandEolToCrlf(content: string): string
```

It takes a string that the caller has guaranteed is LF-only and returns it with every `\n` expanded to `\r\n`. The caller-side precondition is strict: if the input already contains a `\r\n`, this function will double-expand it to `\r\r\n`, which is why it is never used on text that is heading into the index — it is only invoked on the migration path when a corpus was originally indexed under CRLF and now lives on disk as LF, or vice-versa. The docstring pins down a useful safety property: because `normalizeEol` only collapses `\r\n` and preserves lone `\r`, and because `expandEolToCrlf` is only run on input known to contain zero `\r\n`, the round trip `expandEolToCrlf(normalizeEol(x))` can only diverge from `x` when `x` genuinely mixes both conventions — and those genuinely mixed-EOL files intentionally fall through to the normal updated-code path rather than being silently treated as unchanged.

## Tests

Covered by `packages/core/src/hashes.test.ts` (same-name test file on disk).
