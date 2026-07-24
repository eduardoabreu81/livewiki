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
import { initParser, parseSource, listSupportedGrammars, grammarForExtension } from "./parser.js";
import { extractSymbols, extractCalls, extractRationales, isLikelyGenerated, type SymbolRecord, type CallRecord, type RationaleRecord } from "./symbols.js";
import { openIndex, type FileRow, type SymbolRow } from "./db.js";
import { resolveCalls } from "./call-resolution.js";

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
  /** Skipped: NUL byte in the first 8 KiB (binary safety net — SPEC Phase 1). */
  filesSkippedBinary: number;
  /** Skipped: larger than 1 MiB (size cap — SPEC Phase 1). */
  filesSkippedTooLarge: number;
  symbolsAdded: number;
  symbolsDeleted: number;
  durationMs: number;
}

/** Files larger than this are skipped (SPEC Phase 1 size cap). */
export const MAX_FILE_BYTES = 1024 * 1024;
/** A NUL byte in this leading window marks the file as binary. */
export const BINARY_SNIFF_BYTES = 8 * 1024;

/**
 * Roda o index incremental. Idempotente: rodar 2x sem mudanças no repo é
 * barato (só walk + 1 hash por arquivo).
 */
export async function run(repoRoot: string, opts: IndexOptions = {}): Promise<IndexResult> {
  const startedAt = Date.now();
  const absRoot = nodePath.resolve(repoRoot);

  // 1. Garante `.livewiki/` existe (sem aviso se `livewiki/` também existir).
  //    Se nem `livewiki/` existe, emite nota informativa (não erro) — mas só
  //    se NÃO estiver em quiet (hooks da Fase 5 não devem spammar o terminal).
  await ensureLivewikiDir(absRoot, Boolean(opts.quiet));

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

async function ensureLivewikiDir(absRoot: string, quiet: boolean): Promise<void> {
  // Cria `.livewiki/` (allowlist — safe-io). É cache derivado.
  try {
    await safeIo.mkdir(absRoot, ".livewiki");
  } catch {
    // Se falhou por motivo diferente de "já existe", re-lança.
    if (!(await nodeFs.stat(nodePath.join(absRoot, ".livewiki")).catch(() => null))) {
      throw new Error("failed to create .livewiki/");
    }
  }

  // Info note if the wiki also doesn't exist (Phase 3 will create it).
  // In quiet mode (hooks), suppress — the terminal stays clean.
  const livewikiExists = await nodeFs
    .stat(nodePath.join(absRoot, "livewiki"))
    .then(() => true)
    .catch(() => false);
  if (!livewikiExists && !quiet) {
    // eslint-disable-next-line no-console
    console.log(
      "[livewiki] note: wiki livewiki/ does not exist yet — indexed anyway. " +
        "Run `livewiki init` (Phase 3) to generate quickstart and full layout.",
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
    calls: CallRecord[];
    rationales: RationaleRecord[];
  }
  const plans: FilePlan[] = [];

  let filesUnchanged = 0;
  let filesSkippedBinary = 0;
  let filesSkippedTooLarge = 0;
  for (const entry of walked) {
    const absPath = nodePath.join(repoRoot, entry.path);
    let stat;
    try {
      stat = await nodeFs.stat(absPath);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[livewiki] skip ${entry.path}: ${(err as Error).message}`);
      continue;
    }
    // Size cap first: never read a huge file into memory.
    if (stat.size > MAX_FILE_BYTES) {
      filesSkippedTooLarge++;
      continue;
    }
    let content: string;
    try {
      content = await nodeFs.readFile(absPath, "utf8");
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[livewiki] skip ${entry.path}: ${(err as Error).message}`);
      continue;
    }
    // Binary safety net: a NUL byte in the leading window means this is not
    // text, whatever the extension says.
    if (content.slice(0, BINARY_SNIFF_BYTES).includes("\0")) {
      filesSkippedBinary++;
      continue;
    }

    const hash = sha256(content);
    const prev = existingFiles.get(entry.path);
    if (prev && prev.content_hash === hash) {
      filesUnchanged++;
      continue;
    }

    let symbols: SymbolRecord[] = [];
    let calls: CallRecord[] = [];
    let rationales: RationaleRecord[] = [];
    const ext = nodePath.extname(entry.path);
    // Tier 2 (SPEC §"Coverage ladder"): without a grammar there is no parse
    // attempt at all — the file is indexed with zero symbols, no warning.
    // Parse FAILURES on grammar-mapped files keep the warning behavior.
    if (grammarForExtension(ext) !== undefined) {
      try {
        const tree = await parseSource(ext, content);
        symbols = extractSymbols(tree, entry.path, content);
        calls = extractCalls(tree, entry.path, content);
        // Etapa 2b: generated files (header sniff) yield zero rationale
        // rows — migration/protobuf revision comments are noise.
        if (!isLikelyGenerated(content)) {
          rationales = extractRationales(tree, entry.path, content);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[livewiki] parse falhou em ${entry.path}: ${(err as Error).message}`);
      }
    }

    plans.push({
      entry,
      content,
      size: stat.size,
      mtime: stat.mtimeMs,
      hash,
      symbols,
      calls,
      rationales,
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
    // Calls have no move-tracking need (unlike symbols) — a changed or
    // removed file's call edges are simply recomputed wholesale.
    const deleteCallsForFile = db.prepare("DELETE FROM calls WHERE file_id = ?");
    const insertCall = db.prepare(
      "INSERT INTO calls (file_id, caller_key, callee_name, line) VALUES (?, ?, ?, ?)",
    );
    // Rationales mirror calls exactly (Etapa 2b): recomputed wholesale per
    // file, no soft-delete — a rationale row has no identity worth
    // preserving across a re-parse.
    const deleteRationalesForFile = db.prepare("DELETE FROM rationales WHERE file_id = ?");
    const insertRationale = db.prepare(
      "INSERT INTO rationales (file_id, symbol_key, kind, text, start_line, content_hash) VALUES (?, ?, ?, ?, ?, ?)",
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
      deleteCallsForFile.run(fileId);
      for (const call of plan.calls) {
        insertCall.run(fileId, call.caller_key, call.callee_name, call.line);
      }
      deleteRationalesForFile.run(fileId);
      for (const rationale of plan.rationales) {
        insertRationale.run(
          fileId,
          rationale.symbol_key,
          rationale.kind,
          rationale.text,
          rationale.start_line,
          rationale.content_hash,
        );
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
        deleteCallsForFile.run(prevRow.id);
        deleteRationalesForFile.run(prevRow.id);
        result.filesDeleted++;
      }
    }

    // Runs inside the same transaction as the symbol/call writes above so a
    // reindex is atomic: readers never see calls with a stale/missing
    // resolution for symbols that were just added or removed.
    resolveCalls(db);

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
    filesSkippedBinary,
    filesSkippedTooLarge,
    symbolsAdded: result.symbolsAdded,
    symbolsDeleted: result.symbolsDeleted,
    durationMs: Date.now() - startedAt,
  };
}

/** Usado em erros pra dar dica de suporte. */
export { listSupportedGrammars };

export function formatHuman(result: IndexResult): string {
  const lines: string[] = [];
  lines.push(`livewiki index: OK in ${result.durationMs}ms`);
  lines.push(
    `  files: ${result.filesScanned} scanned  ` +
      `+${result.filesAdded} new  ~${result.filesUpdated} updated  ` +
      `=${result.filesUnchanged} unchanged  -${result.filesDeleted} removed`,
  );
  lines.push(
    `  symbols: +${result.symbolsAdded} extracted  -${result.symbolsDeleted} marked deleted`,
  );
  if (result.filesSkippedBinary > 0 || result.filesSkippedTooLarge > 0) {
    lines.push(
      `  skipped: ${result.filesSkippedBinary} binary (NUL byte)  ` +
        `${result.filesSkippedTooLarge} too large (>1 MiB)`,
    );
  }
  return lines.join("\n");
}