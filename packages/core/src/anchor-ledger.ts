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
 * Regra inviolável #6: páginas `owner: human` e blocos `lw:manual` JAMAIS
 * são modificados por escrita automatizada. Ledger **nunca escreve** na
 * wiki — só lê e escreve no DB.
 */

import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";
import * as safeIo from "./safe-io.js";
import { openIndex, type FileRow, type SymbolRow } from "./db.js";
import { extractAnchors, type Owner } from "./anchors.js";
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

  const existingAnchors = new Map<string, AnchorRow>(); // key: `${doc_page_id}|${section_slug ?? ""}`
  for (const row of db.prepare("SELECT * FROM anchors").all() as AnchorRow[]) {
    const k = `${row.doc_page_id}|${row.section_slug ?? ""}`;
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

  // 3. Para cada página: parse, upsert doc_pages + anchors, gerar debt
  const seenDocPages = new Set<string>();
  // Coletamos todos os (doc_page_id, section_slug, symbol_key, owner, in_manual_block)
  // atuais pra avaliar debt no final
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

    // Upsert manual blocks (regra #6: baseline byte-a-byte).
    // Política:
    //   - INSERT OR IGNORE (não sobrescreve o hash baseline)
    //   - Atualiza apenas o offset (se a página foi editada e o bloco mudou
    //     de posição) MAS mantém o content_hash armazenado como "expected"
    //
    // Resultado: verify compara o hash atual (recalculado pelo source) com
    // o hash armazenado. Se alguém (humano OU agente) alterou o bloco, o
    // hash divergiu e verify alerta. Se só a posição mudou, sem alerta.
    const insertMB = db.prepare(
      "INSERT OR IGNORE INTO manual_blocks (doc_page_id, start_offset, end_offset, content_hash, updated_at) " +
        "VALUES (?, ?, ?, ?, ?)",
    );
    const updateMBOffset = db.prepare(
      "UPDATE manual_blocks SET start_offset = ?, end_offset = ?, updated_at = ? WHERE id = ?",
    );
    for (const mb of extracted.manualBlocks) {
      const blockContent = source.slice(mb.start, mb.end);
      const currentHash = sha256(blockContent);
      const res = insertMB.run(docPageId, mb.start, mb.end, currentHash, Date.now());
      if (res.changes === 0) {
        // Já existe — atualiza APENAS o offset (se mudou). Hash baseline preservado.
        const existing = db
          .prepare(
            "SELECT id, start_offset, end_offset FROM manual_blocks " +
              "WHERE doc_page_id = ? AND start_offset = ? AND end_offset = ?",
          )
          .get(docPageId, mb.start, mb.end) as
          | { id: number; start_offset: number; end_offset: number }
          | undefined;
        if (existing) {
          // Posição idêntica, nada a fazer
          continue;
        }
        // Posição mudou (edição no source que deslocou o bloco): atualiza
        // offset mas mantém o content_hash original.
        const sameContent = db
          .prepare(
            "SELECT id FROM manual_blocks WHERE doc_page_id = ? AND content_hash = ?",
          )
          .get(docPageId, currentHash) as { id: number } | undefined;
        if (sameContent) {
          updateMBOffset.run(mb.start, mb.end, Date.now(), sameContent.id);
        }
        // Se hash E offset são diferentes: é uma alteração real. Não atualizamos
        // nada — verify vai detectar (stored hash != current hash).
      }
    }
  }

  // 4. Detecção de MOVED — antes do diff de changed/deleted
  //    Para cada symbol deletado, procura um symbol novo com mesmo content_hash
  //    em outro arquivo. Se achar: atualiza anchors, registra moved.
  const movedMap = new Map<string, string>(); // oldKey -> newKey
  detectMoves(deletedSymbols, existingSymbols, movedMap, result);

  // Atualiza anchors que apontam pra symbol_key moved
  if (movedMap.size > 0) {
    const updateAnchorKey = db.prepare(
      "UPDATE anchors SET symbol_key = ? WHERE symbol_key = ?",
    );
    for (const [oldKey, newKey] of movedMap) {
      updateAnchorKey.run(newKey, oldKey);
    }
    // Atualiza in-memory map também
    for (const ca of currentAnchors) {
      const moved = movedMap.get(ca.symbolKey);
      if (moved) ca.symbolKey = moved;
    }
  }

  // 5. Diff por anchor: changed / deleted / OK
  const seenAnchorIds = new Set<number>();
  for (const ca of currentAnchors) {
    const anchorKey = `${ca.docPageId}|${ca.sectionSlug ?? ""}`;
    const prev = existingAnchors.get(anchorKey);
    const sym = existingSymbols.get(ca.symbolKey);

    if (!sym) {
      // symbol sumiu do código (não está no índice)
      // Se for o resultado de um moved, sym exists com novo nome — mas ca.symbolKey já foi atualizado
      createDebt(db, prev?.id ?? null, "deleted", assigneeFor(ca.owner), null, ca.symbolKey);
      result.debtCreated++;
      result.debtByEvent.deleted++;
      continue;
    }

    // symbol existe — checa hash
    // upsertAnchor grava o hash atual na criação, então prev sempre tem hash
    // real (não '') a partir da primeira run.
    if (prev && prev.symbol_hash_at_doc !== sym.content_hash) {
      createDebt(db, prev.id, "changed", assigneeFor(ca.owner), null, ca.symbolKey);
      result.debtCreated++;
      result.debtByEvent.changed++;
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

  // 6. Debt de MOVED — para cada par detected, registra evento
  for (const [oldKey, newKey] of movedMap) {
    // Find doc_pages que apontavam pra oldKey (já atualizados, mas podemos pegar
    // o assignee original via in-memory). Para simplicidade: assignee = "agent"
    // (mudança de path é trabalho de reorganização, automatizável).
    createDebt(db, null, "moved", "agent", JSON.stringify({ from: oldKey, to: newKey }), newKey);
    result.debtCreated++;
    result.debtByEvent.moved++;
  }

  // 7. Doc_pages sumidos da wiki: marcar anchors como órfãos?
  //    Decisão: removemos os anchors (eles são derivado) e geramos debt deleted.
  for (const [prevPath, prevRow] of existingDocPages) {
    if (!seenDocPages.has(prevPath)) {
      // Página sumiu da wiki: limpa seus anchors
      db.prepare("DELETE FROM anchors WHERE doc_page_id = ?").run(prevRow.id);
      // Também não temos como saber assignee — usa human (revisão)
      db.prepare("DELETE FROM doc_pages WHERE id = ?").run(prevRow.id);
    }
  }

  // 8. Undocumented: symbols active sem anchor correspondente
  upsertUndocumented(db, existingSymbols, currentAnchors, result);

  // 9. Meta: timestamp do último ledger
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
  const key = `${docPageId}|${sectionSlug ?? ""}`;
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
  return Number(res.lastInsertRowid);
}

function createDebt(
  db: import("better-sqlite3").Database,
  anchorId: number | null,
  event: DebtEvent,
  assignee: Assignee,
  detail: string | null,
  symbolKey: string,
): void {
  db.prepare(
    "INSERT INTO debt (anchor_id, event, assignee, detail, detected_at) VALUES (?, ?, ?, ?, ?)",
  ).run(anchorId, event, assignee, detail, Date.now());
  // symbol_key aqui só pra log — não há coluna, fica em detail se relevante
  // (já incluído pelo caller se quiser)
  void symbolKey;
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

function assigneeFor(owner: Owner): Assignee {
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
      if (entry.name.startsWith(".")) continue; // .manifest.json fica pra Fase 3
      const abs = nodePath.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(abs);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        const rel = nodePath.relative(absRoot, abs).split(nodePath.sep).join("/");
        out.push({ relPath: rel });
      }
    }
  }
  return out;
}

// Re-export for tests
export { extractAnchors };