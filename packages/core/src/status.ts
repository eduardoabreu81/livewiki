/**
 * status — relatório do índice.
 *
 * Fase 1: arquivos indexados, símbolos por kind, breakdown por linguagem,
 * top-N arquivos com mais símbolos. Dívida + undocumented entram na Fase 2.
 *
 * Modo human: texto multi-linha.
 * Modo JSON: objeto completo (estruturado pra agentes).
 */

import * as nodePath from "node:path";
import * as safeIo from "./safe-io.js";
import { openIndex, type FileRow, type SymbolRow } from "./db.js";

export interface StatusOptions {
  /** Quantos arquivos mostrar no top-N (default 10). */
  topN?: number;
}

export interface StatusReport {
  files: {
    total: number;
    byLang: Record<string, number>;
    top: Array<{ path: string; symbols: number; lang: string }>;
  };
  symbols: {
    total: number;
    byKind: Record<string, number>;
  };
  meta: {
    schemaVersion: number;
    lastIndexedAt: number | null;
  };
}

export async function run(
  repoRoot: string,
  opts: StatusOptions = {},
): Promise<StatusReport> {
  const absRoot = nodePath.resolve(repoRoot);
  const dbPathRel = ".livewiki/index.db";
  const dbPath = await safeIo.resolveAndValidate(absRoot, dbPathRel);
  const db = openIndex(dbPath);
  try {
    return collect(db, opts.topN ?? 10);
  } finally {
    db.close();
  }
}

function collect(db: import("better-sqlite3").Database, topN: number): StatusReport {
  const files = db.prepare("SELECT * FROM files").all() as FileRow[];
  const symbols = db.prepare(
    "SELECT * FROM symbols WHERE status = 'active'",
  ).all() as SymbolRow[];

  const byLang: Record<string, number> = {};
  for (const f of files) byLang[f.lang] = (byLang[f.lang] ?? 0) + 1;

  const byKind: Record<string, number> = {};
  for (const s of symbols) byKind[s.kind] = (byKind[s.kind] ?? 0) + 1;

  // Top-N arquivos por #símbolos ativos
  const symbolsByFile = new Map<number, number>();
  for (const s of symbols) {
    symbolsByFile.set(s.file_id, (symbolsByFile.get(s.file_id) ?? 0) + 1);
  }
  const fileById = new Map(files.map((f) => [f.id, f]));
  const top = [...symbolsByFile.entries()]
    .map(([fileId, count]) => {
      const f = fileById.get(fileId);
      return f ? { path: f.path, symbols: count, lang: f.lang } : null;
    })
    .filter((x): x is { path: string; symbols: number; lang: string } => x !== null)
    .sort((a, b) => b.symbols - a.symbols)
    .slice(0, topN);

  const versionRow = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as
    | { value: string }
    | undefined;
  const lastIndexRow = db.prepare("SELECT value FROM meta WHERE key = 'last_indexed_at'").get() as
    | { value: string }
    | undefined;

  return {
    files: {
      total: files.length,
      byLang,
      top,
    },
    symbols: {
      total: symbols.length,
      byKind,
    },
    meta: {
      schemaVersion: versionRow ? Number.parseInt(versionRow.value, 10) : 0,
      lastIndexedAt: lastIndexRow ? Number.parseInt(lastIndexRow.value, 10) : null,
    },
  };
}

/** Format human-readable (texto). */
export function formatHuman(report: StatusReport): string {
  const lines: string[] = [];
  lines.push("livewiki status");
  lines.push("==============");
  lines.push("");
  lines.push(`Arquivos indexados: ${report.files.total}`);
  if (Object.keys(report.files.byLang).length > 0) {
    for (const [lang, n] of Object.entries(report.files.byLang).sort()) {
      lines.push(`  ${lang.padEnd(12)} ${n}`);
    }
  }
  lines.push("");
  lines.push(`Símbolos extraídos (active): ${report.symbols.total}`);
  for (const [kind, n] of Object.entries(report.symbols.byKind).sort()) {
    lines.push(`  ${kind.padEnd(12)} ${n}`);
  }
  lines.push("");
  if (report.files.top.length > 0) {
    lines.push(`Top ${report.files.top.length} arquivos por # símbolos:`);
    for (const f of report.files.top) {
      lines.push(`  ${String(f.symbols).padStart(4)}  ${f.path}`);
    }
    lines.push("");
  }
  lines.push(
    `schema_version: ${report.meta.schemaVersion}  |  last_indexed_at: ${
      report.meta.lastIndexedAt ? new Date(report.meta.lastIndexedAt).toISOString() : "nunca"
    }`,
  );
  return lines.join("\n");
}