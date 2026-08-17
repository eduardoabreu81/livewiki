/**
 * hashes — sha256 of content.
 *
 * Used in two places:
 *   - content_hash of files (change detection for the incremental index)
 *   - content_hash of symbols (source slice; detects a change inside a
 *     file that did not change the total hash — Phase 2 detects per-symbol debt)
 *
 * Always hex (lowercase, 64 chars). No salt — it is a content fingerprint,
 * not authentication. Different purposes (files vs symbols) are distinguished by
 * the field name, not by the algorithm.
 *
 * EOL-insensitivity (roadmap item 12): every content_hash in the index is
 * computed over `normalizeEol` text (CRLF → LF), and the indexer feeds that
 * same normalized string to tree-sitter, so symbol byte ranges and hashes
 * are consistent. Databases written before this change store legacy
 * raw-bytes hashes; the indexer migrates them silently (see indexer.ts),
 * including the flipped-EOL case where the DB was indexed under one EOL
 * convention and the files on disk are now under the other
 * (`expandEolToCrlf`).
 */

import * as nodeCrypto from "node:crypto";

export function sha256(content: string | Uint8Array): string {
  return nodeCrypto.createHash("sha256").update(content).digest("hex");
}

/**
 * EOL normalization for content hashing (roadmap item 12): CRLF (`\r\n`)
 * becomes LF (`\n`). Applied ONCE to source text before it reaches the
 * parser and every content_hash computation, so a silent `core.autocrlf`
 * checkout conversion never changes a file's fingerprint (phantom-debt
 * fix). Lone `\r` (classic Mac) is deliberately left alone — it is not
 * produced by git and treating it as a line break would change the
 * semantics of string literals that contain a raw carriage return.
 */
export function normalizeEol(content: string): string {
  return content.replace(/\r\n/g, "\n");
}

/**
 * Inverse of `normalizeEol` for legacy-hash detection (roadmap item 12
 * follow-up): expands LF → CRLF. Only safe on LF-only input — the caller
 * MUST guarantee the text contains no `\r\n`, otherwise existing CRLF
 * sequences would be double-expanded (`\r\n` → `\r\r\n`). Used solely to
 * recompute the legacy raw-bytes hash of a corpus that was indexed under
 * the CRLF convention while the files on disk are now LF (or vice-versa);
 * never used for hashing content that reaches the index.
 *
 * Round-trip ambiguity is bounded: `normalizeEol` only collapses `\r\n`
 * and preserves lone `\r`, and this expansion is only attempted when the
 * input has zero `\r\n`, so `expandEolToCrlf(normalizeEol(x))` can only
 * differ from `x` when `x` mixes both conventions — those mixed-EOL
 * legacy files intentionally fall through to the normal updated path.
 */
export function expandEolToCrlf(content: string): string {
  return content.replace(/\n/g, "\r\n");
}

/**
 * Hash of a symbol's source slice (start_byte..end_byte). Used by the
 * indexer to detect a local change in a symbol without re-parsing everything.
 */
export function sha256Slice(source: string, startByte: number, endByte: number): string {
  return sha256(source.slice(startByte, endByte));
}