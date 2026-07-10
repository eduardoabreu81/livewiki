/**
 * status — relatório completo do estado da wiki + índice.
 *
 * Fase 1: arquivos indexados, símbolos por kind, breakdown por linguagem,
 *         top-N arquivos com mais símbolos.
 * Fase 2: dívida aberta (changed/moved/deleted) por assignee,
 *         undocumented symbols.
 *
 * Modo human: texto multi-linha.
 * Modo JSON: objeto completo (estruturado pra agentes).
 */

import * as nodePath from "node:path";
import * as safeIo from "./safe-io.js";
import { openIndex, type FileRow, type SymbolRow } from "./db.js";
import { snapshotMetrics, type UpdateMetricsSnapshot } from "./update-metrics.js";

export interface StatusOptions {
  /** Quantos arquivos mostrar no top-N (default 10). */
  topN?: number;
}

export interface DebtItem {
  id: number;
  event: "changed" | "moved" | "deleted";
  assignee: "agent" | "human";
  symbol_key: string | null;
  wiki_path: string | null;
  detail: string | null;
  detected_at: number;
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
  debt: {
    total: number;
    byEvent: { changed: number; moved: number; deleted: number };
    byAssignee: { agent: number; human: number };
    items: DebtItem[];
  };
  undocumented: {
    total: number;
    sample: Array<{ symbol_key: string }>;
  };
  /**
   * Contabilidade incremental (Fase 5 — SPEC §"Contabilidade de tokens"):
   * mostra quantos tokens foram emitidos em pacotes `update` e quantos
   * foram escritos de volta. Tese do produto: eficiência = write/package.
   * null se nunca houve update (estado inicial).
   */
  metrics: UpdateMetricsSnapshot | null;
  meta: {
    schemaVersion: number;
    lastIndexedAt: number | null;
    lastLedgerAt: number | null;
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
    const report = collect(db, opts.topN ?? 10);
    // Métricas incrementais (best-effort — falha aqui não quebra status)
    try {
      report.metrics = await snapshotMetrics(absRoot);
    } catch {
      report.metrics = null;
    }
    return report;
  } finally {
    db.close();
  }
}

interface DebtRow {
  id: number;
  anchor_id: number | null;
  event: string;
  assignee: string;
  detail: string | null;
  detected_at: number;
  symbol_key: string | null;
  wiki_path: string | null;
}

function collect(db: import("better-sqlite3").Database, topN: number): StatusReport {
  const files = db
    .prepare("SELECT * FROM files WHERE status = 'active'")
    .all() as FileRow[];
  const symbols = db.prepare(
    "SELECT * FROM symbols WHERE status = 'active'",
  ).all() as SymbolRow[];

  const byLang: Record<string, number> = {};
  for (const f of files) byLang[f.lang] = (byLang[f.lang] ?? 0) + 1;

  const byKind: Record<string, number> = {};
  for (const s of symbols) byKind[s.kind] = (byKind[s.kind] ?? 0) + 1;

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

  // Debt
  const debtRows = db
    .prepare(
      "SELECT d.id, d.anchor_id, d.event, d.assignee, d.detail, d.detected_at, " +
        "a.symbol_key, dp.wiki_path " +
        "FROM debt d LEFT JOIN anchors a ON a.id = d.anchor_id " +
        "LEFT JOIN doc_pages dp ON dp.id = a.doc_page_id " +
        "WHERE d.resolved_at IS NULL " +
        "ORDER BY d.detected_at ASC",
    )
    .all() as DebtRow[];

  const debtByEvent = { changed: 0, moved: 0, deleted: 0 };
  const debtByAssignee = { agent: 0, human: 0 };
  const debtItems: DebtItem[] = [];
  for (const r of debtRows) {
    const ev = r.event as "changed" | "moved" | "deleted";
    if (ev in debtByEvent) {
      debtByEvent[ev as keyof typeof debtByEvent]++;
    }
    const asg = r.assignee as "agent" | "human";
    if (asg in debtByAssignee) {
      debtByAssignee[asg as keyof typeof debtByAssignee]++;
    }
    debtItems.push({
      id: r.id,
      event: ev,
      assignee: asg,
      symbol_key: r.symbol_key,
      wiki_path: r.wiki_path,
      detail: r.detail,
      detected_at: r.detected_at,
    });
  }

  // Undocumented
  const undocRows = db
    .prepare("SELECT symbol_key FROM undocumented WHERE dismissed = 0")
    .all() as Array<{ symbol_key: string }>;

  const versionRow = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as
    | { value: string }
    | undefined;
  const lastIndexRow = db.prepare("SELECT value FROM meta WHERE key = 'last_indexed_at'").get() as
    | { value: string }
    | undefined;
  const lastLedgerRow = db.prepare("SELECT value FROM meta WHERE key = 'last_ledger_at'").get() as
    | { value: string }
    | undefined;

  return {
    files: { total: files.length, byLang, top },
    symbols: { total: symbols.length, byKind },
    debt: {
      total: debtRows.length,
      byEvent: debtByEvent,
      byAssignee: debtByAssignee,
      items: debtItems,
    },
    undocumented: {
      total: undocRows.length,
      sample: undocRows.slice(0, 20),
    },
    // metrics é setado por run() após collect (precisa repoRoot, não db)
    metrics: null,
    meta: {
      schemaVersion: versionRow ? Number.parseInt(versionRow.value, 10) : 0,
      lastIndexedAt: lastIndexRow ? Number.parseInt(lastIndexRow.value, 10) : null,
      lastLedgerAt: lastLedgerRow ? Number.parseInt(lastLedgerRow.value, 10) : null,
    },
  };
}

/** Format human-readable (text). */
export function formatHuman(report: StatusReport): string {
  const lines: string[] = [];
  lines.push("livewiki status");
  lines.push("==============");
  lines.push("");
  lines.push(`Indexed files: ${report.files.total}`);
  if (Object.keys(report.files.byLang).length > 0) {
    for (const [lang, n] of Object.entries(report.files.byLang).sort()) {
      lines.push(`  ${lang.padEnd(12)} ${n}`);
    }
  }
  lines.push("");
  lines.push(`Extracted symbols (active): ${report.symbols.total}`);
  for (const [kind, n] of Object.entries(report.symbols.byKind).sort()) {
    lines.push(`  ${kind.padEnd(12)} ${n}`);
  }
  lines.push("");
  if (report.files.top.length > 0) {
    lines.push(`Top ${report.files.top.length} files by # symbols:`);
    for (const f of report.files.top) {
      lines.push(`  ${String(f.symbols).padStart(4)}  ${f.path}`);
    }
    lines.push("");
  }
  lines.push(`Open debt: ${report.debt.total}`);
  lines.push(
    `  by event:   changed=${report.debt.byEvent.changed} ` +
      `moved=${report.debt.byEvent.moved} deleted=${report.debt.byEvent.deleted}`,
  );
  lines.push(
    `  by assignee: agent=${report.debt.byAssignee.agent} ` +
      `human=${report.debt.byAssignee.human}`,
  );
  for (const item of report.debt.items) {
    const target = item.symbol_key ?? item.wiki_path ?? "(?)";
    lines.push(`  [${item.event}] ${item.assignee.padEnd(5)} ${target}`);
    if (item.detail) lines.push(`         ${item.detail}`);
  }
  lines.push("");
  lines.push(`Undocumented: ${report.undocumented.total}`);
  for (const u of report.undocumented.sample) {
    lines.push(`  ${u.symbol_key}`);
  }
  lines.push("");
  lines.push(
    `schema_version: ${report.meta.schemaVersion}  |  ` +
      `last_indexed_at: ${
        report.meta.lastIndexedAt ? new Date(report.meta.lastIndexedAt).toISOString() : "never"
      }  |  last_ledger_at: ${
        report.meta.lastLedgerAt ? new Date(report.meta.lastLedgerAt).toISOString() : "never"
      }`,
  );
  return lines.join("\n");
}