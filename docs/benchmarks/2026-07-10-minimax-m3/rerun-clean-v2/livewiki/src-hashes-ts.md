---
title: src/hashes.ts
owner: generated
anchors:
  - packages/core/src/hashes.ts#sha256
  - packages/core/src/hashes.ts#sha256Slice
---

# src/hashes.ts

SHA-256 helpers used by the indexer for content fingerprints.

The module exposes two functions. Output is always lowercase hex (64 chars) with no salt; this is a content fingerprint, not authentication. Different consumers (file content hash vs. symbol content hash) are distinguished by the field name in which the digest is stored, not by the algorithm.

## sha256

<!-- lw:anchors packages/core/src/hashes.ts#sha256 -->

```ts
export function sha256(content: string | Uint8Array): string
```

Computes the SHA-256 digest of the given content and returns it as a lowercase hex string. Accepts either a string or a `Uint8Array`.

Used for the `content_hash` of files to drive incremental index change detection.

## sha256Slice

<!-- lw:anchors packages/core/src/hashes.ts#sha256Slice -->

```ts
export function sha256Slice(source: string, startByte: number, endByte: number): string
```

Computes the SHA-256 digest of a byte slice `[startByte, endByte)` of `source`. Thin wrapper over `sha256` applied to `source.slice(startByte, endByte)`.

Used by the indexer as the `content_hash` of symbols, allowing it to detect local edits inside a file without re-parsing the whole document (Phase 2 symbol-level debt detection).