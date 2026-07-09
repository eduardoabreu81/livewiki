/**
 * indexer — orquestra: walk → read → hash → parse → extract → upsert.
 *
 * SPEC §"Fase 1 — Indexador":
 *   - extrai símbolos (funções, classes, métodos, exports)
 *   - calcula hashes
 *   - persiste no SQLite schema
 *   - respeita `.gitignore`
 *
 * Incremental: arquivos com mesmo `content_hash` que já estão no DB são pulados
 * (read + hash só). Arquivos novos são parseados. Arquivos sumidos do disco
 * são marcados com `status='deleted'` nos symbols.
 *
 * Performance:
 *   - alvo SPEC: 50k LOC < 30s primeiro run, < 2s incremental
 *   - tudo dentro de uma transaction SQLite (commit atômico)
 *   - readFile em série (I/O bound; paralelizar não ajuda em SSD)
 *   - tree-sitter parse em série (CPU bound; paralelizar não ajuda em 1 core)
 *
 * Auto-init: se `.livewiki/` não existe, cria silenciosamente (SPEC §"index",
 * commit 300ad58). Se `livewiki/` também não existe, emite nota informativa
 * sugerindo `livewiki init` (Fase 3) — exit 0.
 */

import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";
import * as safeIo from "./safe-io.js";
import { walkRepo } from "./walker.js";
import { sha256 } from "./hashes.js";
import { initParser, parseSource, listSupportedGrammars } from "./parser.js";
import { extractSymbols, type SymbolRecord } from "./symbols.js";
import { openIndex, type FileRow, type SymbolRow } from "./db.js";

export interface IndexOptions {
  /** Patterns extras a ignorar (além de .gitignore + defaults). */
  extraIgnores?: readonly string[];
  /** Quando true, suprime notas informativas (modo JSON). */
  quiet?: boolean;
}

export interface IndexResult {
  filesScanned: number;
  filesAdded: number;
  filesUpdated: number;
  filesDeleted: number;
  filesUnchanged: number;
  symbolsAdded: number;
  symbolsDeleted: number;
  durationMs: number;
}

/**
 * Roda o index incremental. Idempotente: rodar 2x sem mudanças no repo é
 * barato (só walk + 1 hash por arquivo).
 */
export async function run(repoRoot: string, opts: IndexOptions = {}): Promise<IndexResult> {
  const startedAt = Date.now();
  const absRoot = nodePath.resolve(repoRoot);

  // 1. Garante `.livewiki/` existe (sem aviso se `livewiki/` também existir).
  //    Se nem `livewiki/` existe, emite nota informativa (não erro).
  await ensureLivewikiDir(absRoot);

  // 2. Resolve dbPath via safe-io (revalida allowlist + symlinks).
  const dbPathRel = ".livewiki/index.db";
  const dbPath = await safeIo.resolveAndValidate(absRoot, dbPathRel);

  // 3. Walk
  const walked = await walkRepo(absRoot, {
    ...(opts.extraIgnores ? { extraIgnores: opts.extraIgnores } : {}),
  });

  // 4. Open DB e orquestra
  const db = openIndex(dbPath);
  try {
    return await orchestrateIndex(db, absRoot, walked, startedAt);
  } finally {
    db.close();
  }
}

async function ensureLivewikiDir(absRoot: string): Promise<void> {
  // Cria `.livewiki/` (allowlist — safe-io). É cache derivado.
  try {
    await safeIo.mkdir(absRoot, ".livewiki");
  } catch {
    // Se falhou por motivo diferente de "já existe", re-lança.
    if (!(await nodeFs.stat(nodePath.join(absRoot, ".livewiki")).catch(() => null))) {
      throw new Error("failed to create .livewiki/");
    }
  }

  // Nota informativa se a wiki também não existe (Fase 3 vai criá-la).
  const livewikiExists = await nodeFs
    .stat(nodePath.join(absRoot, "livewiki"))
    .then(() => true)
    .catch(() => false);
  if (!livewikiExists) {
    // eslint-disable-next-line no-console
    console.log(
      "[livewiki] nota: wiki livewiki/ ainda não existe — indexou mesmo assim. " +
        "Rode `livewiki init` (Fase 3) para gerar quickstart e layout completo.",
    );
  }
}

async function orchestrateIndex(
  db: import("better-sqlite3").Database,
  repoRoot: string,
  walked: { path: string; lang: string }[],
  startedAt: number,
): Promise<IndexResult> {
  await initParser();

  // Carrega mapa path → file row atual pra comparar
  const existingFiles = new Map<string, FileRow>();
  for (const row of db.prepare("SELECT * FROM files").all() as FileRow[]) {
    existingFiles.set(row.path, row);
  }

  // ── Fase A: I/O async (read + parse) FORA da transaction.
  // better-sqlite3 transactions são síncronas e não podem conter await.
  interface FilePlan {
    entry: { path: string; lang: string };
    content: string;
    size: number;
    mtime: number;
    hash: string;
    symbols: SymbolRecord[];
  }
  const plans: FilePlan[] = [];

  let filesUnchanged = 0;
  for (const entry of walked) {
    const absPath = nodePath.join(repoRoot, entry.path);
    let stat;
    let content: string;
    try {
      stat = await nodeFs.stat(absPath);
      content = await nodeFs.readFile(absPath, "utf8");
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[livewiki] skip ${entry.path}: ${(err as Error).message}`);
      continue;
    }

    const hash = sha256(content);
    const prev = existingFiles.get(entry.path);
    if (prev && prev.content_hash === hash) {
      filesUnchanged++;
      continue;
    }

    let symbols: SymbolRecord[] = [];
    const ext = nodePath.extname(entry.path);
    try {
      const tree = await parseSource(ext, content);
      symbols = extractSymbols(tree, entry.path, content);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[livewiki] parse falhou em ${entry.path}: ${(err as Error).message}`);
    }

    plans.push({
      entry,
      content,
      size: stat.size,
      mtime: stat.mtimeMs,
      hash,
      symbols,
    });
  }

  // ── Fase B: writes SÍNCRONOS dentro de UMA transaction (atomicidade + speed).
  const seenPaths = new Set(walked.map((w) => w.path));
  const result = {
    filesAdded: 0,
    filesUpdated: 0,
    filesUnchanged,
    filesDeleted: 0,
    symbolsAdded: 0,
    symbolsDeleted: 0,
  };

  const writeAll = db.transaction(() => {
    const insertFile = db.prepare(
      "INSERT INTO files (path, lang, content_hash, size, mtime, indexed_at) VALUES (?, ?, ?, ?, ?, ?)",
    );
    const updateFile = db.prepare(
      "UPDATE files SET lang = ?, content_hash = ?, size = ?, mtime = ?, indexed_at = ?, status = 'active' WHERE id = ?",
    );
    // Reativar arquivo que estava deleted: limpa symbols antigos e reinsere.
    const reactivateFile = db.prepare(
      "UPDATE files SET status = 'active', content_hash = ?, size = ?, mtime = ?, indexed_at = ? WHERE id = ?",
    );
    // SOFT-DELETE em vez de hard delete (Fix A — achado da revisão Fase 2):
    // símbolos que somem de um arquivo ATUALIZADO precisam manter a row com
    // content_hash antigo, para que o ledger possa detectar `moved` quando
    // esse hash aparecer em outro arquivo.
    const markSymbolsActiveDeleted = db.prepare(
      "UPDATE symbols SET status = 'deleted' WHERE file_id = ? AND status = 'active'",
    );
    const insertSymbol = db.prepare(
      "INSERT INTO symbols (file_id, key, name, kind, signature, start_line, end_line, content_hash, status) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')",
    );
    const markSymbolDeleted = db.prepare(
      "UPDATE symbols SET status = 'deleted' WHERE file_id = ? AND status = 'active'",
    );
    const markFileDeleted = db.prepare(
      "UPDATE files SET status = 'deleted' WHERE id = ?",
    );

    for (const plan of plans) {
      const prev = existingFiles.get(plan.entry.path);
      let fileId: number;
      if (prev) {
        // Marca os antigos como deleted (mantém content_hash no DB) antes de
        // inserir os novos. O ledger lê os deletados pra detectar moved.
        markSymbolsActiveDeleted.run(prev.id);
        updateFile.run(
          plan.entry.lang,
          plan.hash,
          plan.size,
          plan.mtime,
          Date.now(),
          prev.id,
        );
        fileId = prev.id;
        result.filesUpdated++;
      } else {
        const res = insertFile.run(
          plan.entry.path,
          plan.entry.lang,
          plan.hash,
          plan.size,
          plan.mtime,
          Date.now(),
        );
        fileId = Number(res.lastInsertRowid);
        result.filesAdded++;
      }
      for (const sym of plan.symbols) {
        insertSymbol.run(
          fileId,
          sym.key,
          sym.name,
          sym.kind,
          sym.signature,
          sym.start_line,
          sym.end_line,
          sym.content_hash,
        );
        result.symbolsAdded++;
      }
    }

    // Arquivos que existiam no DB mas não no walk → marca como deleted (file + symbols)
// SEM deletar a file row. Isso preserva histórico para detecção de moved na
// Fase 2 (precisamos dos symbols deletados com content_hash para matching).
    for (const [prevPath, prevRow] of existingFiles) {
      if (!seenPaths.has(prevPath)) {
        // Conta ANTES do UPDATE (senão o WHERE filtra o que acabou de mudar).
        const oldSyms = db
          .prepare("SELECT id FROM symbols WHERE file_id = ? AND status = 'active'")
          .all(prevRow.id) as { id: number }[];
        markSymbolDeleted.run(prevRow.id);
        result.symbolsDeleted += oldSyms.length;
        markFileDeleted.run(prevRow.id);
        result.filesDeleted++;
      }
    }

    db.prepare(
      "INSERT OR REPLACE INTO meta (key, value) VALUES ('last_indexed_at', ?)",
    ).run(String(Date.now()));
  });

  writeAll();

  return {
    filesScanned: walked.length,
    filesAdded: result.filesAdded,
    filesUpdated: result.filesUpdated,
    filesDeleted: result.filesDeleted,
    filesUnchanged: result.filesUnchanged,
    symbolsAdded: result.symbolsAdded,
    symbolsDeleted: result.symbolsDeleted,
    durationMs: Date.now() - startedAt,
  };
}

/** Usado em erros pra dar dica de suporte. */
export { listSupportedGrammars };

export function formatHuman(result: IndexResult): string {
  const lines: string[] = [];
  lines.push(`livewiki index: OK em ${result.durationMs}ms`);
  lines.push(
    `  arquivos: ${result.filesScanned} varridos  ` +
      `+${result.filesAdded} novos  ~${result.filesUpdated} atualizados  ` +
      `=${result.filesUnchanged} inalterados  -${result.filesDeleted} removidos`,
  );
  lines.push(
    `  símbolos: +${result.symbolsAdded} extraídos  -${result.symbolsDeleted} marcados deleted`,
  );
  return lines.join("\n");
}