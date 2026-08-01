/**
 * anchor-ledger — sincroniza âncoras da wiki com o índice de código e gera
 * dívida (changed/moved/deleted).
 *
 * SPEC §"Fase 2 — Âncoras e dívida" + §"Schema do SQLite":
 *   - Lê cada página `.md` em `livewiki/`, extrai frontmatter + section anchors.
 *   - Upsert em `anchors` (UNIQUE por doc_page + section_slug).
 *   - Diff vs estado anterior: gera rows em `debt` (changed/moved/deleted).
 *   - Detecção de `moved` por content_hash (primário) ou nome+signature (fallback).
 *   - Atribui `assignee` baseado no `owner` da página (agent pra generated,
 *     human pra human). Página mixed vai pra agent (parte gerada vence).
 *
 * Regra inviolável #3 (rev. achados F+G): quando um símbolo é detectado como
 * `moved`, a rewrite da âncora acontece NO MARKDOWN (frontmatter e marcadores
 * `<!-- lw:anchors ... -->`) via safe-io — não basta atualizar o DB, porque
 * o markdown é fonte da verdade. Exceção (regra #6): âncora dentro de bloco
 * `<!-- lw:manual -->` ou em página `owner: human` NÃO é reescrita — só gera
 * dívida com assignee=human.
 *
 * Regra inviolável #6: páginas `owner: human` e blocos `lw:manual` JAMAIS
 * são modificados por escrita automatizada de rewrite de anchor.
 *
 * Conservative twin policy for `moved` (roadmap item 13): a disappeared
 * symbol is accepted as `moved` ONLY when its name is truly gone from the
 * active index — i.e. no ACTIVE symbol with the same name AND same kind
 * survives anywhere else (the match candidate itself excepted). A "twin"
 * is same SHORT name + same kind, in any active file — so `Class.render`
 * in two classes are twins of each other (the qualified key differs but
 * the method name survives), while a function and a class sharing a name
 * are NOT twins (different kinds). When a twin survives, the disappearance
 * is classified by the normal rules (`changed` if the file was updated,
 * `deleted` if the file is gone) and anchors keep pointing at their
 * original file: rewriting them to the twin would re-anchor the page to an
 * implementation its prose does not describe, and `verify` cannot catch
 * that (the anchor exists). Consequences, by design:
 *   - exact rotation (A's body moves to B while B's moves to A) is NOT a
 *     move — both names survive as active symbols;
 *   - file deletion where the ONLY copy relocates to a new file IS a
 *     legitimate moved (no twin survives);
 *   - two identical surviving copies make the target ambiguous, so that
 *     disappearance is also not a move.
 */

import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";
import * as safeIo from "./safe-io.js";
import { openIndex, type FileRow, type SymbolRow } from "./db.js";
import { extractAnchors, type Owner } from "./anchors.js";
import { maskCodeSpansPreservingLength } from "./markdown-mask.js";
import { sha256 } from "./hashes.js";

export type DebtEvent = "changed" | "moved" | "deleted";
export type Assignee = "agent" | "human";

export interface LedgerOptions {
  /** Quando true, suprime notas informativas (modo JSON). */
  quiet?: boolean;
}

export interface LedgerResult {
  pagesProcessed: number;
  pagesSkipped: number;
  anchorsUpserted: number;
  debtCreated: number;
  debtByEvent: { changed: number; moved: number; deleted: number };
  undocumentedSymbols: number;
  /** Para telemetria/debug. */
  movedPairs: Array<{ from: string; to: string }>;
}

export class AnchorParseError extends Error {
  constructor(wikiPath: string, cause: Error) {
    super(`Falha ao parsear âncoras em ${wikiPath}: ${cause.message}`);
    this.name = "AnchorParseError";
  }
}

export async function run(
  repoRoot: string,
  opts: LedgerOptions = {},
): Promise<LedgerResult> {
  const absRoot = nodePath.resolve(repoRoot);

  // Garante `.livewiki/` existe (cache derivado — auto-init).
  await safeIo.mkdir(absRoot, ".livewiki");
  const dbPath = await safeIo.resolveAndValidate(absRoot, ".livewiki/index.db");
  const db = openIndex(dbPath);
  try {
    return await orchestrate(db, absRoot, opts);
  } finally {
    db.close();
  }
}

async function orchestrate(
  db: import("better-sqlite3").Database,
  absRoot: string,
  opts: LedgerOptions,
): Promise<LedgerResult> {
  const result: LedgerResult = {
    pagesProcessed: 0,
    pagesSkipped: 0,
    anchorsUpserted: 0,
    debtCreated: 0,
    debtByEvent: { changed: 0, moved: 0, deleted: 0 },
    undocumentedSymbols: 0,
    movedPairs: [],
  };

  // 1. Coleta wiki pages (.md em livewiki/)
  const wikiPages = await collectWikiPages(absRoot);

  // 2. Carrega estado atual do DB
  const existingDocPages = new Map<string, { id: number; content_hash: string; owner: string }>();
  for (const row of db.prepare("SELECT * FROM doc_pages").all() as DocPageRow[]) {
    existingDocPages.set(row.wiki_path, {
      id: row.id,
      content_hash: row.content_hash,
      owner: row.owner,
    });
  }

  // Anchor identity is `(doc_page_id, section_slug, symbol_key)`. The page
  // slot (section_slug=null) can hold multiple symbols (one per `anchors:`
  // list entry in the frontmatter), so the map MUST include `symbol_key`
  // in the key — otherwise the last-loaded row overwrites the others and
  // the diff loop matches every frontmatter anchor to whichever symbol the
  // last-loaded row happened to point at, creating spurious "changed" debt.
  const existingAnchors = new Map<string, AnchorRow>(); // key: `${doc_page_id}|${section_slug ?? ""}|${symbol_key}`
  for (const row of db.prepare("SELECT * FROM anchors").all() as AnchorRow[]) {
    const k = `${row.doc_page_id}|${row.section_slug ?? ""}|${row.symbol_key}`;
    existingAnchors.set(k, row);
  }

  const existingSymbols = new Map<string, SymbolRow>(); // key: symbol_key
  for (const row of db.prepare("SELECT * FROM symbols WHERE status = 'active'").all() as SymbolRow[]) {
    existingSymbols.set(row.key, row);
  }

  // Symbols deletados (status='deleted'): usados pra detectar moved
  const deletedSymbols = new Map<string, SymbolRow>();
  for (const row of db.prepare("SELECT * FROM symbols WHERE status = 'deleted'").all() as SymbolRow[]) {
    deletedSymbols.set(row.key, row);
  }

  // 3. Parse each page, upsert doc_pages + anchors + manual blocks.
  //    `processedDocPageIds` records every page that was successfully
  //    read and parsed; only those pages participate in identity
  //    reconciliation further below. Pages skipped because of a read
  //    or parse failure keep their persisted anchors untouched (the
  //    next successful run reconciles them). Pages absent from disk
  //    are handled by the deleted-page path further down.
  const seenDocPages = new Set<string>();
  const processedDocPageIds = new Set<number>();
  const currentAnchors: Array<{
    docPageId: number;
    sectionSlug: string | null;
    symbolKey: string;
    owner: Owner;
    inManualBlock: boolean;
  }> = [];

  for (const page of wikiPages) {
    seenDocPages.add(page.relPath);
    let source: string;
    try {
      source = await safeIo.readText(absRoot, page.relPath);
    } catch (err) {
      result.pagesSkipped++;
      if (!opts.quiet) {
        // eslint-disable-next-line no-console
        console.warn(`[livewiki] ledger: skip ${page.relPath}: ${(err as Error).message}`);
      }
      continue;
    }

    let extracted;
    try {
      extracted = extractAnchors(source);
    } catch (err) {
      result.pagesSkipped++;
      if (!opts.quiet) {
        // eslint-disable-next-line no-console
        console.warn(
          `[livewiki] ledger: skip ${page.relPath} (parse error): ${(err as Error).message}`,
        );
      }
      continue;
    }
    result.pagesProcessed++;

    // Upsert doc_page
    const docPageId = upsertDocPage(
      db,
      page.relPath,
      extracted.owner,
      hashContent(source),
      existingDocPages,
    );
    processedDocPageIds.add(docPageId);

    // Upsert page anchors (section_slug = null)
    for (const symbolKey of extracted.pageAnchors) {
      const initialHash = existingSymbols.get(symbolKey)?.content_hash ?? "";
      upsertAnchor(
        db,
        docPageId,
        null,
        symbolKey,
        extracted.owner,
        false,
        existingAnchors,
        initialHash,
      );
      currentAnchors.push({
        docPageId,
        sectionSlug: null,
        symbolKey,
        owner: extracted.owner,
        inManualBlock: false,
      });
      result.anchorsUpserted++;
    }

    // Upsert section anchors
    for (const sa of extracted.sectionAnchors) {
      for (const symbolKey of sa.symbolKeys) {
        const initialHash = existingSymbols.get(symbolKey)?.content_hash ?? "";
        upsertAnchor(
          db,
          docPageId,
          sa.sectionSlug,
          symbolKey,
          extracted.owner,
          sa.inManualBlock,
          existingAnchors,
          initialHash,
        );
        currentAnchors.push({
          docPageId,
          sectionSlug: sa.sectionSlug,
          symbolKey,
          owner: extracted.owner,
          inManualBlock: sa.inManualBlock,
        });
        result.anchorsUpserted++;
      }
    }

    // Reconcile manual blocks (rule #6: baseline byte-a-byte).
    // Strategy: one-to-one reconciliation per doc_page_id.
    //   1. Load every existing row for this page and drop exact
    //      duplicate historical rows (same doc_page_id, start,
    //      end, content_hash) keeping the smallest id. Without
    //      this, every ledger run would accumulate duplicate
    //      rows — the manual_blocks table has no UNIQUE
    //      constraint, and verify treats stored rows as a
    //      multiset.
    //   2. For each current block, match against an unused
    //      existing row:
    //        a. exact start/end → preserve the stored baseline
    //           hash (it represents the user-approved baseline,
    //           even if the freshly recomputed hash differs);
    //        b. same content_hash but different start/end → the
    //           block moved within the page; update offsets only,
    //           baseline hash preserved.
    //   3. If no existing row matches, insert a fresh baseline
    //      with the current content_hash.
    //   4. Unmatched existing rows are left in place so that a
    //      removed or altered block remains detectable by verify
    //      (the current block list no longer covers them, and
    //      verify compares stored-current multisets).
    reconcileManualBlocks(
      db,
      docPageId,
      extracted.manualBlocks.map((mb) => ({
        start: mb.start,
        end: mb.end,
        contentHash: sha256(source.slice(mb.start, mb.end)),
      })),
    );
  }

  // 4. Detect MOVED at the symbol level. For each deleted symbol, look
  //    up an active symbol with the same content_hash in a different
  //    file. On match, record the (oldKey, newKey) pair.
  const movedMap = new Map<string, string>(); // oldKey -> newKey
  detectMoves(deletedSymbols, existingSymbols, movedMap, result);

  // 4a. Build the pre-move set of expected identities per page from
  //     currentAnchors (still using the original symbol keys parsed
  //     from disk). The move handling below filters its candidate
  //     anchors against this set so stale rows that the user removed
  //     from the Markdown never participate in move rewrite, update,
  //     or moved-debt creation.
  const preMoveExpectedByPageId = new Map<number, Set<string>>();
  for (const ca of currentAnchors) {
    let set = preMoveExpectedByPageId.get(ca.docPageId);
    if (!set) {
      set = new Set();
      preMoveExpectedByPageId.set(ca.docPageId, set);
    }
    set.add(`${ca.sectionSlug ?? ""}|${ca.symbolKey}`);
  }

  // 4b. Move handling. For each (oldKey, newKey) detected:
  //     - fetch the affected anchors from the DB;
  //     - drop rows whose (pageId, sectionSlug, oldKey) is not in the
  //       pre-move expected set (stale rows that the user removed from
  //       the Markdown — reconciliation removes them next);
  //     - for each surviving anchor, check for an existing newKey row
  //       in the same (pageId, sectionSlug) slot. If a newKey row
  //       already exists, keep it and DELETE the oldKey row; otherwise
  //       UPDATE the oldKey row to newKey;
  //     - the canonical newKey row's id is the anchor id used for
  //       moved-debt dedup, so repeated runs do not create duplicate
  //       moved debt on the same logical anchor.
  // Manual-block and human-owned pages skip the markdown rewrite
  // (rule #6) but still update the DB row and the in-memory map, and
  // still create moved debt with assignee=human.
  interface MovedAnchorInfo {
    anchorId: number;
    docPageId: number;
    wikiPath: string;
    inManualBlock: boolean;
    owner: Owner;
    sectionSlug: string | null;
  }
  const anchorsByOldKey = new Map<string, MovedAnchorInfo[]>();
  if (movedMap.size > 0) {
    const fetchAnchorsForKey = db.prepare(
      "SELECT a.id, a.doc_page_id, a.in_manual_block, a.section_slug, dp.wiki_path, dp.owner " +
        "FROM anchors a JOIN doc_pages dp ON dp.id = a.doc_page_id " +
        "WHERE a.symbol_key = ?",
    );
    for (const oldKey of movedMap.keys()) {
      const rows = fetchAnchorsForKey.all(oldKey) as Array<{
        id: number;
        doc_page_id: number;
        in_manual_block: number;
        section_slug: string | null;
        wiki_path: string;
        owner: string;
      }>;
      anchorsByOldKey.set(
        oldKey,
        rows.map((r) => ({
          anchorId: r.id,
          docPageId: r.doc_page_id,
          wikiPath: r.wiki_path,
          inManualBlock: r.in_manual_block === 1,
          owner: r.owner as Owner,
          sectionSlug: r.section_slug,
        })),
      );
    }
  }

  // canonicalAnchorIdByNewIdentity: the anchor id of the row that
  // represents the (pageId, sectionSlug, newKey) identity after move
  // handling. The full new identity (including newKey) is part of the
  // key so two distinct moves that land in the same frontmatter slot
  // do not collapse onto a single canonical id. Used by the
  // moved-debt creation step so dedup works across runs even when
  // the actual DB row id changes.
  const canonicalAnchorIdByNewIdentity = new Map<string, number>();
  if (movedMap.size > 0) {
    const updateAnchorMoved = db.prepare(
      "UPDATE anchors SET symbol_key = ?, symbol_hash_at_doc = ? WHERE id = ?",
    );
    const updateAnchorHash = db.prepare(
      "UPDATE anchors SET symbol_hash_at_doc = ? WHERE id = ?",
    );
    const deleteAnchorRow = db.prepare("DELETE FROM anchors WHERE id = ?");
    for (const [oldKey, newKey] of movedMap) {
      const newHash = existingSymbols.get(newKey)?.content_hash ?? "";
      const anchors = anchorsByOldKey.get(oldKey) ?? [];
      for (const info of anchors) {
        const sectionPart = info.sectionSlug ?? "";
        const oldIdentityKey = `${info.docPageId}|${sectionPart}|${oldKey}`;
        const newIdentityKey = `${info.docPageId}|${sectionPart}|${newKey}`;
        // Step 1: pre-move filter. If the oldKey identity is not in
        // the current Markdown, this row is stale and must not
        // participate in rewrite, DB update, collision handling, or
        // debt processing. Reconciliation removes the row from disk
        // next. This check MUST happen first: a stale generated row
        // that triggered a page-wide oldKey -> newKey rewrite would
        // otherwise silently overwrite any surviving manual-block
        // occurrence of oldKey (rule #6).
        const preMoveExpected = preMoveExpectedByPageId.get(info.docPageId);
        if (!preMoveExpected || !preMoveExpected.has(`${sectionPart}|${oldKey}`)) {
          continue;
        }
        // Step 2: Markdown rewrite. Only for non-manual, non-human
        // anchors (rule #6). The rewrite is now manual-range aware
        // and frontmatter-scoped, so it preserves human content even
        // when the same oldKey appears in generated locations on the
        // same page. It runs before any SQLite mutation so the
        // Markdown remains the recoverable source of truth if a
        // later DB operation fails.
        if (!info.inManualBlock && info.owner !== "human") {
          await rewriteSymbolKeyInPage(absRoot, info.wikiPath, oldKey, newKey);
        }
        // Step 3: collision check via the in-memory map (consistent
        // NULL handling — `sectionPart` is the empty string for the
        // page slot, matching how the map is keyed). A separate SQL
        // lookup for NULL is fragile.
        const existingNewKey = existingAnchors.get(newIdentityKey);
        if (existingNewKey) {
          // The newKey row is the canonical identity for this
          // anchor. DELETE the obsolete oldKey row, keep the
          // existing newKey row, and persist newHash on it so the
          // stored symbol_hash_at_doc matches the new symbol's
          // content_hash. Without this SQL update the canonical row
          // would keep a stale hash; relying on the diff loop to
          // re-write the same value masks the bug end-to-end.
          deleteAnchorRow.run(info.anchorId);
          updateAnchorHash.run(newHash, existingNewKey.id);
          existingAnchors.set(newIdentityKey, {
            ...existingNewKey,
            symbol_hash_at_doc: newHash,
          });
          existingAnchors.delete(oldIdentityKey);
          canonicalAnchorIdByNewIdentity.set(newIdentityKey, existingNewKey.id);
        } else {
          // No collision: update the oldKey row to newKey. Preserve
          // the row's id; remap its in-memory identity.
          updateAnchorMoved.run(newKey, newHash, info.anchorId);
          const row = existingAnchors.get(oldIdentityKey);
          existingAnchors.delete(oldIdentityKey);
          if (row) {
            existingAnchors.set(newIdentityKey, {
              ...row,
              symbol_key: newKey,
              symbol_hash_at_doc: newHash,
            });
          }
          canonicalAnchorIdByNewIdentity.set(newIdentityKey, info.anchorId);
        }
      }
    }
    // Remap ca.symbolKey for every ca that referred to an oldKey.
    for (const ca of currentAnchors) {
      const moved = movedMap.get(ca.symbolKey);
      if (moved) ca.symbolKey = moved;
    }
  }

  // 4c. Reconciliation by stable identity. For every page that was
  //     successfully read and parsed in the page loop, derive its
  //     expected `(section_slug, symbol_key)` set from the current
  //     Markdown (post-move remap), and DELETE every persisted row at
  //     that page whose identity is not in the expected set. Pages that
  //     were skipped during the page loop are not reconciled; their
  //     persisted anchors stay until a successful run.
  //
  //     The expected set is built from the same currentAnchors array
  //     the diff loop and undocumented calculation iterate over, so
  //     there is no separate filtered array — every currentAnchors
  //     entry is, by construction, in the expected set.
  //
  //     Removing an anchor deliberately never creates changed, deleted,
  //     or moved debt. The debt.symbol_key column in `debt` is the
  //     durable reference and survives anchor removal (anchor_id
  //     becomes a dangling reference by design).
  const expectedByPageId = new Map<number, Set<string>>();
  for (const ca of currentAnchors) {
    let set = expectedByPageId.get(ca.docPageId);
    if (!set) {
      set = new Set();
      expectedByPageId.set(ca.docPageId, set);
    }
    set.add(`${ca.sectionSlug ?? ""}|${ca.symbolKey}`);
  }
  if (processedDocPageIds.size > 0) {
    const selectPageAnchors = db.prepare(
      "SELECT id, section_slug, symbol_key FROM anchors WHERE doc_page_id = ?",
    );
    const deleteAnchorRow = db.prepare("DELETE FROM anchors WHERE id = ?");
    for (const docPageId of processedDocPageIds) {
      const expected = expectedByPageId.get(docPageId) ?? new Set<string>();
      const persisted = selectPageAnchors.all(docPageId) as Array<{
        id: number;
        section_slug: string | null;
        symbol_key: string;
      }>;
      for (const row of persisted) {
        const key = `${row.section_slug ?? ""}|${row.symbol_key}`;
        if (!expected.has(key)) {
          deleteAnchorRow.run(row.id);
          const mapKey = `${docPageId}|${row.section_slug ?? ""}|${row.symbol_key}`;
          existingAnchors.delete(mapKey);
        }
      }
    }
  }

  // 5. Diff per anchor: changed / deleted / OK.
  //
  //    For every ca in currentAnchors, look up the corresponding
  //    persisted row by (doc_page_id, section_slug, symbol_key). If
  //    the symbol is missing from the index, record deleted debt. If
  //    the symbol's content_hash differs from the stored hash, record
  //    changed debt (deduped by anchor id). Otherwise update the stored
  //    hash.
  const seenAnchorIds = new Set<number>();
  for (const ca of currentAnchors) {
    // Key MUST include symbol_key (see comment on `existingAnchors`).
    const anchorKey = `${ca.docPageId}|${ca.sectionSlug ?? ""}|${ca.symbolKey}`;
    const prev = existingAnchors.get(anchorKey);
    const sym = existingSymbols.get(ca.symbolKey);

    const assignee = assigneeFor(ca.owner, ca.inManualBlock);

    if (!sym) {
      // symbol sumiu do código (não está no índice)
      // Se for o resultado de um moved, sym exists com novo nome — mas ca.symbolKey já foi atualizado
      const anchorId = prev?.id ?? null;
      if (anchorId !== null && hasOpenDebt(db, anchorId, "deleted")) {
        // dedup — não recriar dívida já aberta
      } else {
        createDebt(db, anchorId, "deleted", assignee, null, ca.symbolKey);
        result.debtCreated++;
        result.debtByEvent.deleted++;
      }
      continue;
    }

    // symbol existe — checa hash
    if (prev && prev.symbol_hash_at_doc !== sym.content_hash) {
      if (!hasOpenDebt(db, prev.id, "changed")) {
        createDebt(db, prev.id, "changed", assignee, null, ca.symbolKey);
        result.debtCreated++;
        result.debtByEvent.changed++;
      }
    }
    // atualiza hash pra próxima run
    if (prev) {
      db.prepare("UPDATE anchors SET symbol_hash_at_doc = ? WHERE id = ?").run(
        sym.content_hash,
        prev.id,
      );
      seenAnchorIds.add(prev.id);
    }
  }

  // 6. Move debt. For each (oldKey, newKey) pair, look up the
  //    canonical newKey row's id (post collision handling) using the
  //    full new identity (pageId, sectionSlug, newKey). The original
  //    anchorsByOldKey is also filtered against the pre-move expected
  //    set, mirroring the move handling step: stale rows that the
  //    user removed from the Markdown never produce moved debt.
  //
  //    Manual-block and human-owned anchors create moved debt with
  //    assignee=human; everything else uses the page's owner.
  for (const [oldKey, newKey] of movedMap) {
    const anchors = anchorsByOldKey.get(oldKey) ?? [];
    for (const info of anchors) {
      const sectionPart = info.sectionSlug ?? "";
      const preMoveExpected = preMoveExpectedByPageId.get(info.docPageId);
      if (!preMoveExpected || !preMoveExpected.has(`${sectionPart}|${oldKey}`)) {
        continue;
      }
      const newIdentityKey = `${info.docPageId}|${sectionPart}|${newKey}`;
      const canonicalId = canonicalAnchorIdByNewIdentity.get(newIdentityKey);
      if (canonicalId === undefined) continue;
      if (hasOpenDebt(db, canonicalId, "moved")) continue;
      const assignee = assigneeFor(info.owner, info.inManualBlock);
      const detail = JSON.stringify({ from: oldKey, to: newKey });
      createDebt(db, canonicalId, "moved", assignee, detail, newKey);
      result.debtCreated++;
      result.debtByEvent.moved++;
    }
  }

  // 7. Pages removed from the wiki: drop the doc_page row and every
  //    anchor row that referenced it. The page-deletion path is
  //    separate from identity reconciliation: it operates on pages
  //    that never reached the page loop.
  for (const [prevPath, prevRow] of existingDocPages) {
    if (!seenDocPages.has(prevPath)) {
      db.prepare("DELETE FROM anchors WHERE doc_page_id = ?").run(prevRow.id);
      db.prepare("DELETE FROM doc_pages WHERE id = ?").run(prevRow.id);
    }
  }

  // 8. Undocumented: every active symbol that has no current Markdown
  //    anchor. After move handling, currentAnchors already holds the
  //    remapped keys; reconciliation removed stale rows; the diff loop
  //    already ran against the in-memory map. The set of
  //    `currentAnchors[i].symbolKey` is exactly the set of documented
  //    symbols.
  upsertUndocumented(db, existingSymbols, currentAnchors, result);

  // 9. Expunge dead symbol rows that have an active replacement
  //    (supersession noise from file edits). Truly deleted symbols
  //    (no replacement) stay — they are useful for audit and for
  //    future move history.
  db.exec(
    "DELETE FROM symbols " +
      "WHERE status = 'deleted' " +
      "AND key IN (SELECT key FROM symbols WHERE status = 'active')",
  );

  // 10. Meta: last ledger timestamp.
  db.prepare(
    "INSERT OR REPLACE INTO meta (key, value) VALUES ('last_ledger_at', ?)",
  ).run(String(Date.now()));

  return result;
}

function hashContent(content: string): string {
  return sha256(content);
}

function upsertDocPage(
  db: import("better-sqlite3").Database,
  wikiPath: string,
  owner: Owner,
  contentHash: string,
  existing: Map<string, { id: number; content_hash: string; owner: string }>,
): number {
  const prev = existing.get(wikiPath);
  if (prev) {
    db.prepare("UPDATE doc_pages SET owner = ?, content_hash = ?, updated_at = ? WHERE id = ?").run(
      owner,
      contentHash,
      Date.now(),
      prev.id,
    );
    return prev.id;
  }
  const res = db
    .prepare(
      "INSERT INTO doc_pages (wiki_path, owner, content_hash, updated_at) VALUES (?, ?, ?, ?)",
    )
    .run(wikiPath, owner, contentHash, Date.now());
  return Number(res.lastInsertRowid);
}

export interface AnchorRow {
  id: number;
  doc_page_id: number;
  section_slug: string | null;
  symbol_key: string;
  symbol_hash_at_doc: string;
  in_manual_block: number;
  created_at: number;
}

interface DocPageRow {
  id: number;
  wiki_path: string;
  owner: string;
  content_hash: string;
  updated_at: number;
}

function upsertAnchor(
  db: import("better-sqlite3").Database,
  docPageId: number,
  sectionSlug: string | null,
  symbolKey: string,
  owner: Owner,
  inManualBlock: boolean,
  existing: Map<string, AnchorRow>,
  initialHash: string,
): number {
  // Key MUST include symbol_key (see comment on `existingAnchors`).
  const key = `${docPageId}|${sectionSlug ?? ""}|${symbolKey}`;
  const prev = existing.get(key);
  if (prev) {
    // Atualiza: in_manual_block pode ter mudado se usuário editou o manual block
    db.prepare(
      "UPDATE anchors SET symbol_key = ?, in_manual_block = ? WHERE id = ?",
    ).run(symbolKey, inManualBlock ? 1 : 0, prev.id);
    existing.set(key, { ...prev, symbol_key: symbolKey, in_manual_block: inManualBlock ? 1 : 0 });
    return prev.id;
  }
  // Inserir novo: já grava symbol_hash_at_doc com o hash atual do symbol.
  // Isso evita o bug de "primeira run cria anchor com hash='' → segunda run
  // não detecta mudança porque o guard !== '' é false".
  const res = db
    .prepare(
      "INSERT INTO anchors (doc_page_id, section_slug, symbol_key, symbol_hash_at_doc, in_manual_block, created_at) " +
        "VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(docPageId, sectionSlug, symbolKey, initialHash, inManualBlock ? 1 : 0, Date.now());
  const newId = Number(res.lastInsertRowid);
  // Remap contract (item 9): update the in-memory structure immediately
  // so a duplicate occurrence of the same identity in the same pass
  // cannot insert another row. The freshly-inserted row must be findable
  // by the same key without re-reading the DB.
  existing.set(key, {
    id: newId,
    doc_page_id: docPageId,
    section_slug: sectionSlug,
    symbol_key: symbolKey,
    symbol_hash_at_doc: initialHash,
    in_manual_block: inManualBlock ? 1 : 0,
    created_at: Date.now(),
  });
  return newId;
}

function createDebt(
  db: import("better-sqlite3").Database,
  anchorId: number | null,
  event: DebtEvent,
  assignee: Assignee,
  detail: string | null,
  symbolKey: string,
): void {
  // Fix E (achado revisão Fase 2): symbol_key gravado em coluna própria.
  // Sobrevive ao anchor ser removida, evitando dívida órfã sem referência.
  db.prepare(
    "INSERT INTO debt (anchor_id, event, assignee, symbol_key, detail, detected_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(anchorId, event, assignee, symbolKey, detail, Date.now());
}

/**
 * Fix B (achado revisão Fase 2): dedup de dívida.
 * Retorna true se já existe dívida ABERTA (resolved_at IS NULL) para a
 * (anchor_id, event). Usado para evitar que cada `index` re-flagre os mesmos
 * itens. O índice parcial `idx_debt_open` torna essa query O(1).
 */
function hasOpenDebt(
  db: import("better-sqlite3").Database,
  anchorId: number,
  event: DebtEvent,
): boolean {
  const row = db
    .prepare(
      "SELECT 1 AS hit FROM debt WHERE anchor_id = ? AND event = ? " +
        "AND resolved_at IS NULL LIMIT 1",
    )
    .get(anchorId, event) as { hit: number } | undefined;
  return row !== undefined;
}

function detectMoves(
  deletedSymbols: Map<string, SymbolRow>,
  activeSymbols: Map<string, SymbolRow>,
  movedMap: Map<string, string>,
  result: LedgerResult,
): void {
  // Index por content_hash pra match rápido
  const activeByHash = new Map<string, SymbolRow>();
  for (const sym of activeSymbols.values()) {
    activeByHash.set(sym.content_hash, sym);
  }

  // Roadmap item 13 (conservative twin policy): count active symbols per
  // (name, kind) so a move is accepted only when the disappeared symbol's
  // name is truly gone from the active index. See the module docblock for
  // the twin definition and the rotation/file-deletion edge cases.
  const activeCountByNameKind = new Map<string, number>();
  for (const sym of activeSymbols.values()) {
    const k = `${sym.name}|${sym.kind}`;
    activeCountByNameKind.set(k, (activeCountByNameKind.get(k) ?? 0) + 1);
  }

  for (const [oldKey, deadSym] of deletedSymbols) {
    // 1. Match exato por content_hash
    let match = activeByHash.get(deadSym.content_hash);
    // 2. Fallback: nome + signature iguais em arquivo diferente
    if (!match) {
      for (const candidate of activeSymbols.values()) {
        if (
          candidate.file_id !== deadSym.file_id &&
          candidate.name === deadSym.name &&
          candidate.signature === deadSym.signature
        ) {
          match = candidate;
          break;
        }
      }
    }
    if (match && !movedMap.has(oldKey)) {
      // Fix F (achado revisão Fase 2): pular pares oldKey === newKey — é
      // supersessão de re-index (símbolo inalterado num arquivo editado: foi
      // soft-deletado e re-inserido com mesma key + mesmo content_hash),
      // não movimento real. Sem esse guard, todo edit gerava dívida moved
      // espúria com from == to.
      if (match.key === oldKey) continue;
      // Item 13: a surviving same-name same-kind active symbol (other than
      // the match itself) means the name is NOT gone from the index — the
      // disappearance is an edit or a deletion, never a move.
      const nameKindCount = activeCountByNameKind.get(`${deadSym.name}|${deadSym.kind}`) ?? 0;
      const matchIsSameNameKind =
        match.name === deadSym.name && match.kind === deadSym.kind ? 1 : 0;
      if (nameKindCount - matchIsSameNameKind > 0) continue;
      movedMap.set(oldKey, match.key);
      result.movedPairs.push({ from: oldKey, to: match.key });
    }
  }
}

function upsertUndocumented(
  db: import("better-sqlite3").Database,
  activeSymbols: Map<string, SymbolRow>,
  anchors: Array<{ symbolKey: string }>,
  result: LedgerResult,
): void {
  const anchorKeys = new Set(anchors.map((a) => a.symbolKey));
  // Limpa tabela pra refletir estado atual (não-histórico na Fase 2)
  db.prepare("DELETE FROM undocumented").run();

  const insert = db.prepare(
    "INSERT OR IGNORE INTO undocumented (symbol_key, detected_at, dismissed) VALUES (?, ?, 0)",
  );
  let count = 0;
  for (const sym of activeSymbols.values()) {
    if (!anchorKeys.has(sym.key)) {
      insert.run(sym.key, Date.now());
      count++;
    }
  }
  result.undocumentedSymbols = count;
}

/**
 * Fix D (achado revisão Fase 2): assignee é derivado do owner E do bloco
 * manual. Anchor dentro de `<!-- lw:manual -->...<!-- /lw:manual -->` SEMPRE
 * vai pra humano — a regra #6 diz que LLMs não tocam nesses blocos. Mesmo
 * em página `generated` ou `mixed`, a porção dentro de manual block
 * precisa de revisão humana.
 */
function assigneeFor(owner: Owner, inManualBlock: boolean): Assignee {
  if (inManualBlock) return "human";
  return owner === "human" ? "human" : "agent";
}

async function collectWikiPages(absRoot: string): Promise<{ relPath: string }[]> {
  const out: { relPath: string }[] = [];
  const stack = [nodePath.join(absRoot, "livewiki")];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = await nodeFs.readdir(dir, { withFileTypes: true });
    } catch {
      // Sem livewiki/ — ainda assim, ledger roda e gera debt de páginas ausentes
      continue;
    }
    for (const entry of entries) {
      const abs = nodePath.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Never descend hidden dirs. Dot-prefixed PAGES are legit: tier-2
        // modules from hidden source dirs (e.g. .github/) produce pages
        // like livewiki/.github.md (Etapa 3 E2E). .manifest.json stays out
        // via the .md extension check.
        if (entry.name.startsWith(".")) continue;
        stack.push(abs);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        const rel = nodePath.relative(absRoot, abs).split(nodePath.sep).join("/");
        out.push({ relPath: rel });
      }
    }
  }
  return out;
}

/**
 * Fix G (achado revisão Fase 2): rewrites a specific symbol_key in the
 * wiki markdown. Updates both the frontmatter `anchors:` list and the
 * `<!-- lw:anchors ... -->` markers in the body.
 *
 * Restrictions (rule #6):
 *   - The path must be in the allowlist (livewiki/ + .livewiki/) —
 *     safe-io guarantees that. An I/O error here aborts the ledger
 *     (the DB has not been touched yet, so state stays consistent).
 *   - If the page disappeared from disk between the index and this
 *     rewrite, returns silently — nothing to rewrite. The anchor row
 *     is already removed in step 7 (page removed from the wiki).
 *   - The frontmatter rewrite is restricted to the block between the
 *     `---` delimiters, and the list of entries lives only under the
 *     top-level `anchors:` key — it ends at the next top-level field
 *     or at the closing `---`. Ordinary body bullets and other
 *     frontmatter lists are NOT rewritten.
 *   - Markers inside `<!-- lw:manual -->...<!-- /lw:manual -->` blocks
 *     are NOT rewritten (rule #6: human content is byte-preserved).
 *   - Markers inside code spans (fenced or inline) are also NOT
 *     rewritten — the rewrite surface must match the parser's
 *     structural surface (`maskCodeSpansPreservingLength`).
 *
 * Idempotent: running twice with the same args is a no-op (oldKey
 * is no longer present after the first pass).
 *
 * Implementation note: the frontmatter and the body are edited in
 * independent slices of the original source, with offsets derived
 * only from the pre-edit source. This avoids offset drift when
 * oldKey and newKey have different lengths, and when the frontmatter
 * rewrite changes the segment size.
 *
 * @returns true if the file was modified, false otherwise.
 */
async function rewriteSymbolKeyInPage(
  absRoot: string,
  wikiPath: string,
  oldKey: string,
  newKey: string,
): Promise<boolean> {
  const source = await safeIo.readText(absRoot, wikiPath).catch(() => null);
  if (source === null) return false; // page disappeared — nothing to do

  // Resolve the frontmatter boundary in the original source's coord
  // system (CRLF/LF preserving). The opening delimiter must be a
  // real delimiter line — not just any source starting with `---` —
  // and the closing delimiter may carry trailing spaces/tabs.
  const fmEnd = findFrontmatterEnd(source);

  // 1. Frontmatter segment: operate on its own string. Stop at the
  //    next top-level field or the closing `---` line. The list
  //    under `anchors:` is the only thing we touch.
  const fmOriginal = source.slice(0, fmEnd);
  const fmRewritten = rewriteFrontmatterAnchorsList(fmOriginal, oldKey, newKey);

  // 2. Body segment: operate on its own string. Manual-block ranges
  //    are derived from the body slice directly (body-local
  //    offsets), so a `<!-- lw:manual -->` literal inside a
  //    frontmatter value or comment cannot accidentally protect
  //    body markers.
  const bodyOriginal = source.slice(fmEnd);
  const manualRanges = extractManualBlockRangesFromBody(bodyOriginal);
  const bodyRewritten = rewriteBodyMarkers(
    bodyOriginal,
    oldKey,
    newKey,
    manualRanges,
  );

  const updated = fmRewritten + bodyRewritten;
  if (updated === source) return false;
  await safeIo.writeText(absRoot, wikiPath, updated);
  return true;
}

/**
 * Find the byte offset where the closing `---` line of the
 * frontmatter ends (i.e. the offset where the body starts). Returns
 * 0 if the source has no real frontmatter. CRLF/LF aware — line
 * terminators are preserved exactly as written.
 *
 * A delimiter is a real delimiter line: removing only spaces/tabs
 * from the line yields exactly `---`. Both the opening and closing
 * delimiters may carry trailing spaces/tabs. The opening delimiter
 * is required to be a real delimiter line as well — a source that
 * merely starts with three hyphens followed by non-newline content
 * is NOT considered to have a frontmatter.
 */
function findFrontmatterEnd(source: string): number {
  // Opening line must be a real delimiter line (not just any source
  // starting with three hyphens). Find its terminator; if the line is
  // not a real delimiter, there is no frontmatter here.
  if (!isDelimiterLineAt(source, 0)) return 0;
  let i = nextLineStart(source, 0);
  if (i === -1) return source.length;
  // Scan lines until we find a real closing delimiter line.
  while (i < source.length) {
    if (isDelimiterLineAt(source, i)) {
      // Return the offset immediately after the closing line's
      // original terminator (or EOF).
      return endOfLine(source, i);
    }
    const next = nextLineStart(source, i);
    if (next === -1) return source.length;
    i = next;
  }
  return source.length;
}

/**
 * True when the line starting at `offset` in `source` is a real
 * delimiter line: its first three characters are `---` and the
 * remainder of the line (after stripping spaces/tabs) is empty.
 * The line ends with a line terminator or EOF. The line terminator
 * is NOT consumed.
 */
function isDelimiterLineAt(source: string, offset: number): boolean {
  if (
    source[offset] !== "-" ||
    source[offset + 1] !== "-" ||
    source[offset + 2] !== "-"
  ) {
    return false;
  }
  let j = offset + 3;
  while (j < source.length && (source[j] === " " || source[j] === "\t")) j++;
  // End of file, or end of line.
  return (
    j === source.length || source[j] === "\n" || source[j] === "\r"
  );
}

/**
 * Return the offset immediately after the line terminator that
 * ends the line starting at `lineStart`. For LF, returns lineStart
 * + lineLen + 1. For CRLF, returns lineStart + lineLen + 2. For
 * a line that runs to EOF without a terminator, returns
 * source.length.
 */
function endOfLine(source: string, lineStart: number): number {
  let j = lineStart;
  while (j < source.length && source[j] !== "\n" && source[j] !== "\r") j++;
  if (j === source.length) return j;
  if (source[j] === "\r" && source[j + 1] === "\n") return j + 2;
  return j + 1;
}

/**
 * Return the offset of the start of the line after the line that
 * starts at `lineStart`. Returns -1 if the line runs to EOF without
 * a terminator.
 */
function nextLineStart(source: string, lineStart: number): number {
  let j = lineStart;
  while (j < source.length && source[j] !== "\n" && source[j] !== "\r") j++;
  if (j === source.length) return -1;
  if (source[j] === "\r" && source[j + 1] === "\n") return j + 2;
  return j + 1;
}

/**
 * Walk the manual block markers in the body slice and return their
 * byte ranges. Offsets are in the body's coord system (CRLF/LF
 * preserving) so they line up with the body string. Deriving these
 * ranges from the body slice (rather than the whole source) ensures
 * a `<!-- lw:manual -->` literal sitting inside a frontmatter
 * value or comment cannot accidentally protect body markers.
 */
function extractManualBlockRangesFromBody(
  body: string,
): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  const startRe = /<!--\s*lw:manual\s*-->/g;
  const endRe = /<!--\s*\/lw:manual\s*-->/g;
  const events: Array<{ offset: number; length: number; kind: "start" | "end" }> = [];
  for (const m of body.matchAll(startRe)) {
    if (m.index !== undefined) {
      events.push({ offset: m.index, length: m[0].length, kind: "start" });
    }
  }
  for (const m of body.matchAll(endRe)) {
    if (m.index !== undefined) {
      events.push({ offset: m.index, length: m[0].length, kind: "end" });
    }
  }
  events.sort((a, b) => a.offset - b.offset);
  let openAt: number | null = null;
  for (const ev of events) {
    if (ev.kind === "start") {
      if (openAt === null) openAt = ev.offset;
    } else {
      if (openAt !== null) {
        ranges.push({ start: openAt, end: ev.offset + ev.length });
        openAt = null;
      }
    }
  }
  return ranges;
}

/**
 * Replace list entries belonging to the top-level `anchors:` field
 * in the frontmatter segment. Operates on a string slice that is
 * independent of the body, so any length change in the frontmatter
 * cannot invalidate body offsets.
 *
 * The list is bounded by the line that starts with `anchors:` and
 * ends at the next top-level field (line at indent 0 with `name:`)
 * or the closing `---` line — whichever comes first. The `anchors:`
 * field may carry an optional trailing YAML comment (e.g.
 * `anchors: # canonical symbol keys`); the comment is preserved
 * byte-for-byte and only the list entry is rewritten. List entries
 * under a different top-level field are left alone.
 */
function rewriteFrontmatterAnchorsList(
  fmSegment: string,
  oldKey: string,
  newKey: string,
): string {
  if (!fmSegment.startsWith("---")) return fmSegment;
  // Split into lines preserving terminators. The split captures the
  // terminator so we can re-join without altering the bytes.
  const parts = fmSegment.split(/(\r?\n)/);
  // parts alternates: [line, sep, line, sep, ...]
  const isAnchorsLine = (line: string): boolean =>
    /^[ \t]*anchors:/.test(line);
  const isClosingDelimiter = (line: string): boolean =>
    /^[ \t]*---[ \t]*$/.test(line);
  const isTopLevelKey = (line: string): boolean =>
    /^[A-Za-z_][\w-]*[ \t]*:/.test(line) && !line.startsWith(" ") && !line.startsWith("\t");

  // Find the `anchors:` line.
  let anchorsIdx = -1;
  for (let i = 0; i < parts.length; i += 2) {
    if (isAnchorsLine(parts[i] as string)) {
      anchorsIdx = i;
      break;
    }
  }
  if (anchorsIdx === -1) return fmSegment;

  // Find the end of the list body: next top-level key or the closing
  // `---` line. The list body starts at `anchorsIdx + 2` (the line
  // after the `anchors:` key).
  let endIdx = parts.length;
  for (let i = anchorsIdx + 2; i < parts.length; i += 2) {
    const line = parts[i] as string;
    if (isClosingDelimiter(line) || isTopLevelKey(line)) {
      endIdx = i;
      break;
    }
  }

  // Apply the replacement to the lines in the list body.
  const escapedOld = escapeRegex(oldKey);
  const itemRe = new RegExp(
    `^([ \t]*-[ \t]+)${escapedOld}([ \t]*#[^\\r\\n]*)?$`,
  );
  for (let i = anchorsIdx + 2; i < endIdx; i += 2) {
    const line = parts[i] as string;
    const m = itemRe.exec(line);
    if (m) {
      const prefix = m[1] as string;
      const comment = m[2] ?? "";
      parts[i] = `${prefix}${newKey}${comment}`;
    }
  }

  return parts.join("");
}

/**
 * Replace `<!-- lw:anchors -->` markers in the body slice, skipping
 * any marker that sits inside a manual block or inside a code span
 * (fenced or inline). Edits are applied from highest offset to
 * lowest so earlier offsets stay valid even when oldKey and newKey
 * have different lengths. Manual ranges are body-local offsets
 * derived from the body slice itself.
 */
function rewriteBodyMarkers(
  body: string,
  oldKey: string,
  newKey: string,
  manualRangesInBody: ReadonlyArray<{ start: number; end: number }>,
): string {
  const inManual = (offsetInBody: number): boolean =>
    manualRangesInBody.some(
      (b) => offsetInBody >= b.start && offsetInBody < b.end,
    );
  // Length-preserving code mask: every code span (fenced or inline)
  // is blanked to spaces, so offsets in the masked view map 1:1 to
  // the original body. Markers inside code are not matched because
  // the spaces don't satisfy `<!--`.
  const masked = maskCodeSpansPreservingLength(body);

  const edits: Array<{ offset: number; oldText: string; newText: string }> = [];
  const markerRe = /<!--\s*lw:anchors\s+([^\s>][^>]*?)\s*-->/g;
  let m: RegExpExecArray | null;
  while ((m = markerRe.exec(masked)) !== null) {
    if (inManual(m.index)) continue;
    const group = m[1] as string;
    const keys = group.trim().split(/\s+/);
    let changed = false;
    const replaced = keys.map((k) => {
      if (k === oldKey) {
        changed = true;
        return newKey;
      }
      return k;
    });
    if (!changed) continue;
    edits.push({
      offset: m.index,
      oldText: m[0],
      newText: `<!-- lw:anchors ${replaced.join(" ")} -->`,
    });
  }

  if (edits.length === 0) return body;
  edits.sort((a, b) => b.offset - a.offset);
  let out = body;
  for (const e of edits) {
    out = out.slice(0, e.offset) + e.newText + out.slice(e.offset + e.oldText.length);
  }
  return out;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * One-to-one reconciliation of `manual_blocks` rows for a single
 * `doc_page_id`. The table has no UNIQUE constraint, so we manage
 * deduplication and matching explicitly here.
 *
 * Steps:
 *   1. Load all existing rows for this page and collapse exact
 *      duplicates (`doc_page_id`, `start_offset`, `end_offset`,
 *      `content_hash`), keeping the smallest `id` and deleting the
 *      rest. This cleans up historical duplicates accumulated by
 *      prior ledger runs.
 *   2. For each current block, try to match an UNUSED existing row:
 *        a. same `start_offset` and `end_offset` (exact position
 *           match) → preserve the stored baseline `content_hash`.
 *           The stored hash is the user-approved baseline; even
 *           if the freshly computed hash differs, the row stays
 *           authoritative and verify can flag the divergence.
 *        b. same `content_hash` but different offsets (the block
 *           moved within the page) → update `start_offset` and
 *           `end_offset` only, baseline hash preserved.
 *   3. If no existing row matches, insert a fresh baseline row
 *      with the current `content_hash`.
 *   4. Unmatched existing rows are left untouched. Verify treats
 *      stored rows as a multiset; leaving the orphan in place is
 *      what makes a removed or altered block detectable on the
 *      next verify run.
 *
 * No schema migration, no UNIQUE index. Local to
 * `manual_blocks` persistence in this file.
 */
function reconcileManualBlocks(
  db: import("better-sqlite3").Database,
  docPageId: number,
  currentBlocks: ReadonlyArray<{
    start: number;
    end: number;
    contentHash: string;
  }>,
): void {
  // 1. Collapse exact duplicate historical rows for this page.
  // Keep the smallest id; delete the rest. Duplicates are rows
  // with identical (doc_page_id, start_offset, end_offset,
  // content_hash).
  const existingAll = db
    .prepare(
      "SELECT id, start_offset, end_offset, content_hash FROM manual_blocks " +
        "WHERE doc_page_id = ? ORDER BY id",
    )
    .all(docPageId) as Array<{
    id: number;
    start_offset: number;
    end_offset: number;
    content_hash: string;
  }>;

  // Group by (start_offset, end_offset, content_hash); keep the
  // smallest id in each group, delete the rest.
  const seen = new Map<string, number>(); // key -> kept id
  const dupIds: number[] = [];
  for (const row of existingAll) {
    const key = `${row.start_offset}|${row.end_offset}|${row.content_hash}`;
    const kept = seen.get(key);
    if (kept === undefined) {
      seen.set(key, row.id);
    } else {
      dupIds.push(row.id);
    }
  }
  if (dupIds.length > 0) {
    const delDup = db.prepare("DELETE FROM manual_blocks WHERE id = ?");
    const delMany = db.transaction((ids: number[]) => {
      for (const id of ids) delDup.run(id);
    });
    delMany(dupIds);
  }

  // Re-read after dedup so the working set has no duplicates.
  const existing = db
    .prepare(
      "SELECT id, start_offset, end_offset, content_hash FROM manual_blocks " +
        "WHERE doc_page_id = ?",
    )
    .all(docPageId) as Array<{
    id: number;
    start_offset: number;
    end_offset: number;
    content_hash: string;
  }>;
  const used = new Set<number>();

  const updateMB = db.prepare(
    "UPDATE manual_blocks SET start_offset = ?, end_offset = ?, updated_at = ? WHERE id = ?",
  );
  const insertMB = db.prepare(
    "INSERT INTO manual_blocks (doc_page_id, start_offset, end_offset, content_hash, updated_at) " +
      "VALUES (?, ?, ?, ?, ?)",
  );

  const now = Date.now();

  for (const cur of currentBlocks) {
    // 2a. exact start/end match (preserves the stored baseline hash).
    let match: { id: number } | undefined;
    for (const ex of existing) {
      if (used.has(ex.id)) continue;
      if (ex.start_offset === cur.start && ex.end_offset === cur.end) {
        match = ex;
        break;
      }
    }
    // 2b. same content_hash, different offsets (block moved).
    if (!match) {
      for (const ex of existing) {
        if (used.has(ex.id)) continue;
        if (ex.content_hash === cur.contentHash) {
          match = ex;
          break;
        }
      }
      if (match) {
        updateMB.run(cur.start, cur.end, now, match.id);
      }
    }
    if (match) {
      used.add(match.id);
      continue;
    }
    // 3. No existing row matches — insert a fresh baseline.
    insertMB.run(docPageId, cur.start, cur.end, cur.contentHash, now);
  }
  // 4. Unmatched existing rows are intentionally left in place.
}

// Re-export for tests
export { extractAnchors };