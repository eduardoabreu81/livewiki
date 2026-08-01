/**
 * hashes — sha256 de conteúdo.
 *
 * Usado em dois lugares:
 *   - content_hash de files (detecção de mudança para index incremental)
 *   - content_hash de symbols (slice do source; detecta mudança dentro de um
 *     arquivo que não alterou o hash total — Fase 2 detecta dívida por símbolo)
 *
 * Sempre hex (lowercase, 64 chars). Sem salt — é fingerprint de conteúdo,
 * não autenticação. Diferentes purposes (files vs symbols) se distinguem pelo
 * nome do campo, não pelo algoritmo.
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
 * Hash do source slice de um símbolo (start_byte..end_byte). Usado pelo
 * indexador para detectar mudança local em um símbolo sem re-parsear tudo.
 */
export function sha256Slice(source: string, startByte: number, endByte: number): string {
  return sha256(source.slice(startByte, endByte));
}