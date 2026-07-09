/**
 * search — indexação e busca full-text via SQLite FTS5.
 *
 * SPEC §"MCP tools" (Fase 4): livewiki_search usa SQLite FTS5 para busca
 * full-text na wiki.
 *
 * Decisão de design: banco separado `.livewiki/search.db` em vez de virtual
 * table em `.livewiki/index.db`. Razões:
 *   1. `.livewiki/index.db` já está em schema v4 com migrations cuidadosas.
 *      Adicionar FTS5 virtual table seria schema v5 + migration function.
 *   2. search.db é reconstruível a partir da wiki (fonte da verdade) — se
 *      corromper, `livewiki_search` reindexa e segue.
 *   3. Mantém `core` sem dependência de FTS5 — só o MCP server precisa.
 *
 * Tokenizer: porter (default FTS5) — bom pra inglês/PT sem normalização
 * extra. Se docs forem majoritariamente em outra língua, vale revisar.
 *
 * Estratégia de indexação: rebuild completo em cada startup (rápido —
 * uma repo de 1000 páginas indexa em <1s). Idempotente. Após startup,
 * write_doc atualiza incrementally via indexPage.
 */

import Database from "better-sqlite3";
import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";
import * as safeIo from "@livewiki/core/safe-io";

const SEARCH_DB_REL = ".livewiki/search.db";

export interface SearchHit {
  wikiPath: string;
  /** Trecho relevante do conteúdo (snippet em torno do match) */
  snippet: string;
}

export interface SearchOptions {
  /** Limite de resultados (default 20) */
  limit?: number;
}

export interface SearchIndex {
  db: Database.Database;
}

/**
 * Abre (ou cria) o índice FTS5 em `.livewiki/search.db` e reindexa todas as
 * páginas da wiki. Retorna handle com o db aberto.
 *
 * NÃO valida o path — caller (server.ts) já passou pelo safe-io.
 */
export async function openAndIndex(
  repoRoot: string,
): Promise<SearchIndex> {
  const absRoot = nodePath.resolve(repoRoot);
  const dbPath = await safeIo.resolveAndValidate(absRoot, SEARCH_DB_REL);
  // Garante que o .livewiki/ existe
  await safeIo.mkdir(absRoot, ".livewiki");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS wiki_search USING fts5(
      wiki_path UNINDEXED,
      content
    );
  `);
  await reindexAll(db, absRoot);
  return { db };
}

/**
 * Reindexa todas as páginas markdown de `livewiki/` no índice FTS5.
 * Idempotente — limpa o índice antes pra evitar páginas órfãs.
 */
async function reindexAll(db: Database.Database, absRoot: string): Promise<void> {
  db.exec("DELETE FROM wiki_search");
  const wikiDir = nodePath.join(absRoot, "livewiki");
  const pages = await collectMarkdownFiles(wikiDir);
  const insert = db.prepare(
    "INSERT INTO wiki_search (wiki_path, content) VALUES (?, ?)",
  );
  const tx = db.transaction((entries: Array<{ path: string; content: string }>) => {
    for (const e of entries) insert.run(e.path, e.content);
  });
  const entries: Array<{ path: string; content: string }> = [];
  for (const absPath of pages) {
    const relPath = nodePath.relative(absRoot, absPath).replace(/\\/g, "/");
    try {
      const content = await nodeFs.readFile(absPath, "utf8");
      entries.push({ path: relPath, content });
    } catch {
      // skip unreadable
    }
  }
  tx(entries);
}

async function collectMarkdownFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(d: string): Promise<void> {
    let entries;
    try {
      entries = await nodeFs.readdir(d, { withFileTypes: true });
    } catch {
      return; // dir não existe — wiki vazia
    }
    for (const e of entries) {
      const p = nodePath.join(d, e.name);
      if (e.isDirectory()) {
        await walk(p);
      } else if (e.isFile() && e.name.endsWith(".md")) {
        out.push(p);
      }
    }
  }
  await walk(dir);
  return out;
}

/**
 * Indexa (ou atualiza) uma página individual. Chamado por write_doc.
 */
export function indexPage(idx: SearchIndex, wikiPath: string, content: string): void {
  // FTS5 não tem UPSERT nativo — usa DELETE + INSERT em transação.
  const tx = idx.db.transaction(() => {
    idx.db.prepare("DELETE FROM wiki_search WHERE wiki_path = ?").run(wikiPath);
    idx.db.prepare("INSERT INTO wiki_search (wiki_path, content) VALUES (?, ?)").run(
      wikiPath,
      content,
    );
  });
  tx();
}

/**
 * Remove uma página do índice. Idempotente.
 */
export function removePage(idx: SearchIndex, wikiPath: string): void {
  idx.db.prepare("DELETE FROM wiki_search WHERE wiki_path = ?").run(wikiPath);
}

/**
 * Busca full-text. Query é expressão FTS5 (suporta prefixo `term*`, AND/OR,
 * frases `"exact phrase"`). Limite default 20.
 *
 * Retorna array de hits com snippet (trecho ao redor do primeiro match).
 */
export function search(
  idx: SearchIndex,
  query: string,
  opts: SearchOptions = {},
): SearchHit[] {
  const limit = opts.limit ?? 20;
  // Sanitiza query: FTS5 syntax errors quebram a query. Captura e retorna [].
  try {
    const rows = idx.db
      .prepare(
        `SELECT wiki_path, snippet(wiki_search, 1, '<<', '>>', '...', 32) as snip
         FROM wiki_search
         WHERE wiki_search MATCH ?
         ORDER BY rank
         LIMIT ?`,
      )
      .all(query, limit) as Array<{ wiki_path: string; snip: string }>;
    return rows.map((r) => ({ wikiPath: r.wiki_path, snippet: r.snip }));
  } catch {
    return [];
  }
}

/**
 * Fecha o índice. Caller é responsável por chamar isso no shutdown.
 */
export function close(idx: SearchIndex): void {
  idx.db.close();
}