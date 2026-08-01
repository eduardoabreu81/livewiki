/**
 * batch-status — agrega batch_runs + batch_tasks em BatchStatusReport.
 *
 * SPEC §"Comandos CLI" + §"Contabilidade de tokens (Fase 3)":
 * `livewiki batch <run>` reporta por módulo e acumulado, com custo estimado.
 * Reporte granularidade: stage 2 (refine) + stage 4 (doc) + total.
 *
 * Saída: BatchStatusReport (definido em batch-state.ts).
 */

import * as nodePath from "node:path";
import * as safeIo from "./safe-io.js";
import { openIndex } from "./db.js";
import { PRICING_REFERENCE_DATE } from "./pricing.js";
import type {
  BatchRunSummary,
  BatchStatusReport,
  FailureReportItem,
  StageUsage,
  TaskCheckpoint,
  TaskReportItem,
} from "./batch-state.js";

interface TaskRow {
  id: number;
  run_id: number;
  stage: number;
  target: string;
  status: string;
  checkpoint_json: string | null;
}

interface RunRow {
  id: number;
  started_at: number;
  finished_at: number | null;
  started_by: string;
  status: string;
  summary_json: string | null;
}

/**
 * Gera o BatchStatusReport pra um run específico. Lê batch_runs + batch_tasks.
 *
 * Se `runId` for null, usa o último run (run mais recente).
 */
export async function buildStatusReport(
  repoRoot: string,
  runId: number | null = null,
): Promise<BatchStatusReport> {
  const absRoot = nodePath.resolve(repoRoot);
  const dbPath = await safeIo.resolveAndValidate(absRoot, ".livewiki/index.db");
  const db = openIndex(dbPath);

  try {
    // 1. Resolve run
    let run: RunRow | undefined;
    if (runId !== null) {
      run = db
        .prepare("SELECT * FROM batch_runs WHERE id = ?")
        .get(runId) as RunRow | undefined;
    } else {
      run = db
        .prepare("SELECT * FROM batch_runs ORDER BY id DESC LIMIT 1")
        .get() as RunRow | undefined;
    }
    if (!run) {
      throw new Error(runId !== null ? `run ${runId} not found` : "no batch runs found");
    }

    // 2. Carrega tasks
    const taskRows = db
      .prepare("SELECT * FROM batch_tasks WHERE run_id = ? ORDER BY id")
      .all(run.id) as TaskRow[];

    // 3. Agrega usage
    const totals: StageUsage = emptyStageUsage();
    const byStage: Record<string, StageUsage> = {};
    const byModuleMap = new Map<string, StageUsage>();
    const taskReports: TaskReportItem[] = [];
    const failures: FailureReportItem[] = [];

    for (const t of taskRows) {
      const cp = t.checkpoint_json ? safeJsonParse<TaskCheckpoint>(t.checkpoint_json) : null;
      const stageUsage = aggregateUsageFromCheckpoint(cp);
      // Total (known usage only; incomplete flag propagates)
      totals.inputTokens += stageUsage.inputTokens;
      totals.outputTokens += stageUsage.outputTokens;
      totals.costUsd =
        totals.costUsd === null || stageUsage.costUsd === null
          ? (totals.costUsd ?? stageUsage.costUsd)
          : totals.costUsd + stageUsage.costUsd;
      if (stageUsage.usageIncomplete) totals.usageIncomplete = true;
      // By stage
      const stageKey = String(t.stage);
      const prev = byStage[stageKey] ?? emptyStageUsage();
      byStage[stageKey] = mergeStageUsage(prev, stageUsage);
      // By module (só stage 4) — a token/cost breakdown, NOT a done count:
      // it includes failed stage-4 tasks that had any usage, and omits
      // stage 5 (flows/topics) entirely. Use `report.run.summary.tasksDone`
      // /`tasksFailed` for the authoritative all-stages task count.
      if (t.stage === 4) {
        const prevMod = byModuleMap.get(t.target) ?? emptyStageUsage();
        byModuleMap.set(t.target, mergeStageUsage(prevMod, stageUsage));
      }
      // Task report
      taskReports.push({
        taskId: t.id,
        stage: t.stage as 1 | 2 | 3 | 4,
        target: t.target,
        status: t.status as TaskReportItem["status"],
        attempts: cp?.attempt ?? 0,
        inputTokens: stageUsage.inputTokens,
        outputTokens: stageUsage.outputTokens,
        costUsd: stageUsage.costUsd,
        ...(stageUsage.usageIncomplete ? { usageIncomplete: true } : {}),
        ...(cp?.error ? { error: cp.error } : {}),
        // B2 (Lot B): surface the per-task diagnostic history as an
        // ADDITIVE field. Only included when the checkpoint has it
        // (CONTRACT I5: backward compat — older checkpoints serialize
        // without the field, and the status output is byte-stable in
        // that case). The CLI human formatters use this to print the
        // compact per-attempt sequence for failed stage-4 tasks.
        ...(cp?.diagnosticHistory !== undefined
          ? { diagnosticHistory: cp.diagnosticHistory }
          : {}),
        // Roadmap item 9: surface the stage-2 community cross-check
        // (diagnostic-only) additively, same pattern as diagnosticHistory.
        ...(cp?.communityCrossCheck !== undefined
          ? { communityCrossCheck: cp.communityCrossCheck }
          : {}),
        retryCommand: `livewiki batch --only ${t.target} ${run.id}`,
      });
      if (t.status === "failed") {
        failures.push({
          taskId: t.id,
          module: t.target,
          stage: t.stage as 1 | 2 | 3 | 4,
          error: cp?.error ?? { code: "unknown", message: "no error detail" },
          retryCommand: `livewiki batch --only ${t.target} ${run.id}`,
        });
      }
    }

    const byModule = [...byModuleMap.entries()].map(([module, usage]) => ({
      module,
      ...usage,
    }));

    return {
      run: {
        id: run.id,
        status: run.status as BatchStatusReport["run"]["status"],
        startedAt: run.started_at,
        finishedAt: run.finished_at,
        startedBy: run.started_by,
        // FIX J (rev2): expõe summary_json (com modulesRefined) no reporte.
        // Tolerante a null/JSON inválido — report nunca quebra por causa disso.
        summary: parseRunSummary(run.summary_json),
      },
      totals,
      byStage,
      byModule,
      tasks: taskReports,
      failures,
      pricingRefDate: PRICING_REFERENCE_DATE,
    };
  } finally {
    db.close();
  }
}

/**
 * Lista todos os runs (summário).
 */
export async function listRuns(repoRoot: string): Promise<Array<{
  id: number;
  startedAt: number;
  finishedAt: number | null;
  status: string;
  startedBy: string;
}>> {
  const absRoot = nodePath.resolve(repoRoot);
  const dbPath = await safeIo.resolveAndValidate(absRoot, ".livewiki/index.db");
  const db = openIndex(dbPath);
  try {
    const rows = db
      .prepare(
        "SELECT id, started_at, finished_at, status, started_by FROM batch_runs ORDER BY id DESC",
      )
      .all() as Array<{
      id: number;
      started_at: number;
      finished_at: number | null;
      status: string;
      started_by: string;
    }>;
    return rows.map((r) => ({
      id: r.id,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      status: r.status,
      startedBy: r.started_by,
    }));
  } finally {
    db.close();
  }
}

function emptyStageUsage(): StageUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    costUsd: null,
    models: [],
    usageIncomplete: false,
  };
}

function aggregateUsageFromCheckpoint(cp: TaskCheckpoint | null): StageUsage {
  if (!cp) return emptyStageUsage();
  let input = 0;
  let output = 0;
  /** null until first known attempt; null cost on that attempt stays null. */
  let cost: number | null = null;
  let sawKnownAttempt = false;
  let sawPricedAttempt = false;
  let usageIncomplete = false;
  const models = new Set<string>();
  for (const attempt of cp.usageHistory) {
    // Legacy: omit usageKnown but present usage object → known.
    // Malformed: missing usage → unknown (do not crash status).
    const known =
      attempt.usage != null &&
      typeof attempt.usage === "object" &&
      (attempt.usageKnown !== false);
    if (!known) {
      usageIncomplete = true;
      continue;
    }
    sawKnownAttempt = true;
    input += attempt.usage!.inputTokens;
    output += attempt.usage!.outputTokens;
    models.add(attempt.usage!.model);
    if (attempt.costUsd !== null && attempt.costUsd !== undefined) {
      if (!sawPricedAttempt) {
        cost = attempt.costUsd.total;
        sawPricedAttempt = true;
      } else if (cost !== null) {
        cost += attempt.costUsd.total;
      }
    } else {
      // Known usage without price → overall cost unknown (existing policy).
      cost = null;
      sawPricedAttempt = true;
    }
  }
  // No known attempts at all (timeout-only, empty history): costUsd must be
  // null, never a synthetic 0.
  if (!sawKnownAttempt) {
    return {
      inputTokens: 0,
      outputTokens: 0,
      costUsd: null,
      models: [],
      usageIncomplete: usageIncomplete || (cp.usageHistory?.length ?? 0) > 0,
    };
  }
  return {
    inputTokens: input,
    outputTokens: output,
    costUsd: cost,
    models: [...models],
    usageIncomplete,
  };
}

function mergeStageUsage(a: StageUsage, b: StageUsage): StageUsage {
  const costUsd =
    a.costUsd === null || b.costUsd === null
      ? (a.costUsd ?? b.costUsd)
      : a.costUsd + b.costUsd;
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    costUsd,
    models: [...new Set([...a.models, ...b.models])],
    usageIncomplete: Boolean(a.usageIncomplete || b.usageIncomplete),
  };
}

function safeJsonParse<T>(s: string): T | null {
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

/**
 * Parse tolerante do `summary_json` de um run. Retorna null se ausente ou
 * corrompido — o reporte NUNCA quebra por causa disso (achado J da rev2).
 */
function parseRunSummary(raw: string | null): BatchRunSummary | null {
  if (!raw) return null;
  return safeJsonParse<BatchRunSummary>(raw);
}

export type { BatchStatusReport, BatchRunSummary };