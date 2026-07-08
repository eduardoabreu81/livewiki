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
 */

import * as nodeCrypto from "node:crypto";

export function sha256(content: string | Uint8Array): string {
  return nodeCrypto.createHash("sha256").update(content).digest("hex");
}

/**
 * Hash do source slice de um símbolo (start_byte..end_byte). Usado pelo
 * indexador para detectar mudança local em um símbolo sem re-parsear tudo.
 */
export function sha256Slice(source: string, startByte: number, endByte: number): string {
  return sha256(source.slice(startByte, endByte));
}