/**
 * update-metrics — contabilidade incremental (SPEC §"Contabilidade de tokens
 * (Fase 3)", parte de `update`).
 *
 * Decisão de design: arquivo JSON em `.livewiki/update_metrics.json` em vez
 * de tabela SQLite. Razões:
 *   1. Não mexe em schema v4 — contabilidade é incremental, não precisa
 *      do poder do SQL (queries são "último valor" e "soma por tipo").
 *   2. Reconstruível: deletou .livewiki/? a próxima `update` recomeça do
 *      zero (regra #3 da SPEC: o banco é derivado; tudo importante vive
 *      em markdown/manifest versionados — métricas podem se perder).
 *   3. Append-only é mais simples que gerenciar migrations.
 *
 * Shape de cada entry:
 *   { kind, timestamp, ... }
 *
 *   - kind: "package_emitted" — emitido pelo loadWorkPackage (SPEC §tese)
 *   - kind: "write_received"  — emitido quando o agente/HUMANO devolve
 *     doc escrita (skill document-as-you-go ou CLI pós-edição manual)
 *
 * A tese do produto ("800 tokens em vez de reler o repo") mora aqui:
 * a razão `packageEmittedTokens / writeReceivedTokens` mostra quantas
 * linhas de código o agente processou para cada linha de doc gerada.
 */

import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";
import * as safeIo from "./safe-io.js";

const METRICS_REL_PATH = ".livewiki/update_metrics.json";

/**
 * Discriminated union — facilita a query "último pacote emitido" e a
 * agregação "total escrito de volta".
 */
export type UpdateMetric =
  | {
      kind: "package_emitted";
      timestamp: number;
      tokensEstimated: number;
      bytes: number;
      debtCount: number;
    }
  | {
      kind: "write_received";
      timestamp: number;
      wikiPath: string;
      bytes: number;
      tokensEstimated: number;
    };

export interface UpdateMetricsFile {
  /** Versão do schema (pra upgrades futuros). */
  version: 1;
  /** Append-only — entries mais novas no fim. */
  entries: UpdateMetric[];
}

/** Path absoluto do arquivo de métricas dentro do repo. */
async function metricsPath(repoRoot: string): Promise<string> {
  return await safeIo.resolveAndValidate(repoRoot, METRICS_REL_PATH);
}

/** Lê o arquivo de métricas (ou cria vazio se não existir). */
async function readMetrics(repoRoot: string): Promise<UpdateMetricsFile> {
  const absPath = await metricsPath(repoRoot);
  try {
    const raw = await nodeFs.readFile(absPath, "utf8");
    const parsed = JSON.parse(raw) as UpdateMetricsFile;
    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) {
      // Corrompido — recomeça do zero (regra #3: tudo importante está versionado).
      return { version: 1, entries: [] };
    }
    return parsed;
  } catch {
    return { version: 1, entries: [] };
  }
}

/** Persiste o arquivo. Idempotente no sentido de "último estado coerente". */
async function writeMetrics(repoRoot: string, file: UpdateMetricsFile): Promise<void> {
  await safeIo.writeText(repoRoot, METRICS_REL_PATH, JSON.stringify(file, null, 2) + "\n");
}

/**
 * Append de uma métrica. Função fire-and-forget — quem chama não precisa
 * esperar, e um erro aqui NÃO deve quebrar o fluxo principal de `update`.
 */
export async function recordUpdateMetric(
  repoRoot: string,
  metric: UpdateMetric,
): Promise<void> {
  try {
    const file = await readMetrics(repoRoot);
    file.entries.push(metric);
    await writeMetrics(repoRoot, file);
  } catch {
    // best-effort: contabilidade nunca bloqueia a operação principal
  }
}

/**
 * Snapshot agregado das métricas — usado pelo `status --json` pra expor
 * a tese do produto. Pode ser computado em tempo real (poucos entries).
 */
export interface UpdateMetricsSnapshot {
  /** Total de pacotes emitidos até agora. */
  packagesEmitted: number;
  /** Soma de tokens estimados de TODOS os pacotes emitidos. */
  totalPackageTokens: number;
  /** Total de writes recebidos (agente ou humano) até agora. */
  writesReceived: number;
  /** Soma de tokens estimados de TODOS os writes recebidos. */
  totalWriteTokens: number;
  /** Razão write/package — quão "econômica" foi a doc (proxy). */
  /** < 1.0 = agente escreveu menos do que leu (bom); > 1.0 = escreveu mais. */
  efficiencyRatio: number | null;
  /** Última métrica de cada kind (debug). */
  lastPackage: UpdateMetric | null;
  lastWrite: UpdateMetric | null;
}

export async function snapshotMetrics(repoRoot: string): Promise<UpdateMetricsSnapshot> {
  const file = await readMetrics(repoRoot);
  let packagesEmitted = 0;
  let totalPackageTokens = 0;
  let lastPackage: UpdateMetric | null = null;
  let writesReceived = 0;
  let totalWriteTokens = 0;
  let lastWrite: UpdateMetric | null = null;

  for (const e of file.entries) {
    if (e.kind === "package_emitted") {
      packagesEmitted++;
      totalPackageTokens += e.tokensEstimated;
      lastPackage = e;
    } else {
      writesReceived++;
      totalWriteTokens += e.tokensEstimated;
      lastWrite = e;
    }
  }

  const efficiencyRatio =
    totalPackageTokens > 0 ? totalWriteTokens / totalPackageTokens : null;

  return {
    packagesEmitted,
    totalPackageTokens,
    writesReceived,
    totalWriteTokens,
    efficiencyRatio,
    lastPackage,
    lastWrite,
  };
}

/**
 * Helper exposto pra tests: limpa as métricas (útil em setup).
 * NUNCA chamar em código de produção — destrutivo.
 */
export async function clearMetricsForTests(repoRoot: string): Promise<void> {
  const absRoot = nodePath.resolve(repoRoot);
  await safeIo.mkdir(absRoot, ".livewiki");
  await writeMetrics(absRoot, { version: 1, entries: [] });
}