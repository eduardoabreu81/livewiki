/**
 * batch — orquestra o pipeline de documentação completa (Fase 3, etapa 4).
 *
 * SPEC §"Pipeline batch (4 etapas, resumível)":
 *   1. Varredura: index completo + snapshot de símbolos
 *   2. Identificação de módulos: heurística (sempre) + LLM refine (opt-in)
 *   3. Priorização: centralidade + tamanho (sem LLM)
 *   4. Documentação coordenada: 1 task por módulo (LLM)
 *
 * Política de falha (commit d274dd9):
 *   - Task que falha → marca 'failed' com motivo no checkpoint, SEGUE.
 *   - Circuit breaker: 3 falhas consecutivas OU >50% de falha → abort run.
 *   - Run com falhas = status 'completed_with_failures', exit ≠ 0.
 *   - Reporte lista failed + comando de retry pronto.
 *
 * --only (commit fb6807d):
 *   - Re-roda 1 task (mesma interface que modo em-sessão usará na Fase 5).
 *   - Preserva lw:manual byte-a-byte, recusa owner: human.
 *   - Retry soma novo usage ao checkpoint (usageHistory, attempt++).
 *
 * Manifest (correção #3):
 *   - manifest.ts grava .livewiki/.manifest.json com snapshotHash.
 *   - pendingBatch dentro do manifest permite handoff cross-máquina.
 */

import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";
import * as safeIo from "./safe-io.js";
import { openIndex, type SymbolRow } from "./db.js";
import { run as runIndexer } from "./indexer.js";
import { run as runLedger } from "./anchor-ledger.js";
import { run as runVerify } from "./verify.js";
import {
  identifyModulesHeuristic,
  resolveModuleEdges,
  prioritizeModules,
  type Module,
} from "./modules.js";
import { collectImports } from "./imports.js";
import { createLlmClient, type LlmClient } from "./llm/index.js";
import type { GenerateRequest, GenerateResult } from "./llm/types.js";
import { loadConfig, applyDefaults, validateConfigForBatch } from "./config.js";
import { calculateCostUsd, lookupPricing } from "./pricing.js";
import {
  buildStage2RefinePrompt,
  buildStage4Prompt,
  type Language,
} from "./prompts.js";
import { computeSnapshotHash, writeManifestIfChanged, buildManifest } from "./manifest.js";
import { sha256 } from "./hashes.js";
import type {
  BatchStatusReport,
  BatchRunSummary,
  PendingBatchRef,
  StageUsage,
  TaskCheckpoint,
  UsageAttempt,
  ModuleUsage,
} from "./batch-state.js";

export interface BatchOptions {
  repoRoot: string;
  /** Injetado pra testes. Se ausente, carrega do config + env var. */
  llmClient?: LlmClient;
  /** Idioma da doc (default: config.language || "en") */
  language?: Language;
  /** --no-refine: pula refinamento LLM da etapa 2 */
  noRefine?: boolean;
  /** --only <target>: re-roda 1 task (target = module.id ou runId) */
  onlyTarget?: string;
  /** Limite de caracteres do código por módulo no prompt (default 60_000). */
  contextCharBudget?: number;
  /** Skip write do manifest no fim (pra testes) */
  skipManifestWrite?: boolean;
}

export interface BatchRunResult {
  runId: number;
  status: "completed" | "completed_with_failures" | "aborted";
  totals: StageUsage;
  byModule: Array<StageUsage & { module: string }>;
  failures: Array<{ taskId: number; module: string; error: { code: string; message: string }; retryCommand: string }>;
  circuitBreakerTriggered: boolean;
}

/**
 * Entry point principal. Roda o pipeline completo do zero (run novo).
 */
export async function runBatch(opts: BatchOptions): Promise<BatchRunResult> {
  return orchestrate({ ...opts, mode: "run" });
}

/**
 * Resume um run interrompido. Pega o último run com status='running' e
 * continua de onde parou (tasks pending/failed).
 */
export async function resumeBatch(opts: BatchOptions): Promise<BatchRunResult> {
  return orchestrate({ ...opts, mode: "resume" });
}

/**
 * Re-roda 1 task específica (--only). Incrementa attempt, soma usage.
 * Guardrails (regra #6): preserva lw:manual byte-a-byte, recusa owner: human.
 */
export async function runOnly(opts: BatchOptions): Promise<BatchRunResult> {
  if (!opts.onlyTarget) {
    throw new Error("onlyTarget é obrigatório para runOnly");
  }
  return orchestrate({ ...opts, mode: "only" });
}

interface OrchestrateOpts extends BatchOptions {
  mode: "run" | "resume" | "only";
}

async function orchestrate(opts: OrchestrateOpts): Promise<BatchRunResult> {
  const absRoot = nodePath.resolve(opts.repoRoot);
  await safeIo.mkdir(absRoot, ".livewiki");
  const dbPath = await safeIo.resolveAndValidate(absRoot, ".livewiki/index.db");
  const db = openIndex(dbPath);

  try {
    // Carrega config se não injetado
    const config = await loadConfig(absRoot);
    const resolvedConfig = applyDefaults(config);
    const language: Language = opts.language ?? resolvedConfig.language ?? "en";

    // Cria LLM client se não injetado (lazy — só erra se o batch precisar)
    let llmClient = opts.llmClient;
    let needsLlm = false; // true se qualquer stage vai chamar LLM
    if (opts.mode === "only") needsLlm = true;
    if (!opts.noRefine) needsLlm = true;
    if (needsLlm && !llmClient) {
      // Valida config e cria client. Falha clara se ausente.
      validateConfigForBatch(absRoot, resolvedConfig);
      llmClient = createLlmClient(absRoot, resolvedConfig);
    }

    let runId: number;
    if (opts.mode === "run") {
      const configJson = JSON.stringify({
        language,
        noRefine: opts.noRefine ?? false,
        contextCharBudget: opts.contextCharBudget ?? 60_000,
      });
      const res = db
        .prepare(
          "INSERT INTO batch_runs (started_at, started_by, stage, config_json, status) VALUES (?, 'cli', 1, ?, 'running')",
        )
        .run(Date.now(), configJson);
      runId = Number(res.lastInsertRowid);
    } else {
      // resume / only: pega o último run
      const last = db
        .prepare("SELECT id FROM batch_runs ORDER BY id DESC LIMIT 1")
        .get() as { id: number } | undefined;
      if (!last) throw new Error("no batch run to resume/retry");
      runId = last.id;
    }

    // === Estágio 1: Varredura ===
    if (opts.mode === "run") {
      await runIndexer(absRoot, { quiet: true });
      await runLedger(absRoot, { quiet: true });
    }

    // Carrega símbolos ativos + file paths (cache)
    const symbols = db
      .prepare("SELECT * FROM symbols WHERE status = 'active'")
      .all() as SymbolRow[];
    const filePaths = [
      ...new Set(symbols.map((s) => s.key.split("#")[0]!)),
    ].sort();
    const symbolCountByPath = new Map<string, number>();
    for (const s of symbols) {
      const p = s.key.split("#")[0]!;
      symbolCountByPath.set(p, (symbolCountByPath.get(p) ?? 0) + 1);
    }

    // === Estágio 2: Identificação de módulos (heurística + optional LLM refine) ===
    let modules = identifyModulesHeuristic(filePaths, symbolCountByPath);
    const stage2Task = createOrGetTask(db, runId, 2, "modules", opts.mode);
    if (stage2Task) {
      const startedAt = Date.now();
      let usageHistory: UsageAttempt[] = [];
      let error: TaskCheckpoint["error"] | undefined;
      let artifacts: TaskCheckpoint["artifacts"] | undefined;
      let attempt = stage2Task.attempt;

      if (!opts.noRefine && llmClient) {
        try {
          attempt++;
          const prompt = buildStage2RefinePrompt(modules, language);
          const result = await llmClient.generate({
            system: prompt.system,
            user: prompt.user,
            maxTokens: 4_000,
          });
          const cost = calculateCostUsd(
            result.usage.inputTokens,
            result.usage.outputTokens,
            result.usage.model,
            resolvedConfig.pricing,
          );
          usageHistory.push({
            attempt,
            usage: result.usage,
            costUsd: cost,
            finishedAt: Date.now(),
          });
          // FIX I (rev2): validar o refined ANTES de aceitar. Rejeita:
          //   - JSON malformado / sem "modules" array
          //   - modules: [] (vazio) — heurística sempre tem ≥1 módulo
          //   - módulos que NÃO cobrem os arquivos da heurística
          //     (paths declarados que apontam pra fora do repo, ou cobertura
          //     < 100% dos arquivos heurísticos = LLM inventou módulos)
          // Em qualquer caso de rejeição, mantém a heurística e marca
          // error no checkpoint (com code específico) pra rastreabilidade.
          const heuristicFiles = new Set(modules.flatMap((m) => m.paths));
          const validation = validateRefinedModules(
            result.content,
            heuristicFiles,
          );
          if (validation.accepted) {
            modules = validation.modules!;
          } else {
            // Mantém heurística. Marca erro no checkpoint (não é falha de
            // task — é degradação, status continua 'done').
            error = {
              code: validation.errorCode ?? "refine_rejected",
              message: validation.errorMessage ?? "refined modules rejected",
            };
          }
        } catch (err) {
          // Falha de LLM no refinamento: continua com heurística (NÃO é falha de task)
          error = {
            code: "refine_failed_degraded",
            message: (err as Error).message,
          };
        }
      }

      // Persiste task (sempre 'done' — degradação não é falha)
      const checkpoint: TaskCheckpoint = {
        stage: 2,
        status: "done",
        attempt,
        startedAt,
        finishedAt: Date.now(),
        usageHistory,
        ...(error ? { error } : {}),
        ...(artifacts ? { artifacts } : {}),
      };
      const checkpointJson = JSON.stringify(checkpoint);
      // FIX J (rev2): módulos refinados NUNCA concatenados no checkpoint_json —
      // isso corrompia o JSON e o status report perdia o usage do stage 2.
      // Vivem em batch_runs.summary_json (campo próprio), populado ao final
      // do run via `finalizeRunSummary` abaixo.
      db.prepare(
        "UPDATE batch_tasks SET status = ?, checkpoint_json = ?, updated_at = ? WHERE id = ?",
      ).run("done", checkpointJson, Date.now(), stage2Task.id);
    }

    // === Estágio 3: Priorização ===
    const edges = resolveModuleEdges(
      modules,
      await collectAllImports(absRoot, filePaths),
      new Set(filePaths),
    );
    const ordered = prioritizeModules(modules, edges);

    // === Estágio 4: Documentação coordenada ===
    const cb = { consecutive: 0, fails: 0, done: 0 };
    const failures: BatchRunResult["failures"] = [];
    const moduleUsage: BatchRunResult["byModule"] = [];
    const stage2UsageAcc: StageUsage = emptyUsage();
    let stageUsageTotals: StageUsage = emptyUsage();
    const byStageAcc: Record<string, StageUsage> = {};

    const tasksToRun = opts.onlyTarget
      ? ordered.filter((m) => m.id === opts.onlyTarget)
      : ordered;

    if (opts.onlyTarget && tasksToRun.length === 0) {
      throw new Error(`module "${opts.onlyTarget}" not found in this run`);
    }

    // H (rev2): guard explícito. Se há módulos a documentar e o `tasksToRun`
    // está vazio, isso é uma falha do pipeline — não pode terminar "completed"
    // com exit 0. Pega casos como: heurística achou módulos, refinamento
    // devolveu [] vazio, ou o filter do --only não bateu.
    if (ordered.length > 0 && tasksToRun.length === 0 && opts.mode !== "only") {
      throw new EmptyPipelineError(
        `pipeline produced 0 tasks but heuristic found ${ordered.length} module(s) — ` +
          `this is a pipeline bug, not a completed run.`,
      );
    }

    if (opts.mode === "only" && opts.onlyTarget) {
      // Re-roda task: pega task existente, incrementa attempt
      const task = db
        .prepare("SELECT id, checkpoint_json FROM batch_tasks WHERE run_id = ? AND target = ?")
        .get(runId, opts.onlyTarget) as { id: number; checkpoint_json: string | null } | undefined;
      if (task) {
        // Reseta o checkpoint pra re-run (mas preserva usageHistory se houver)
        db.prepare(
          "UPDATE batch_tasks SET status = 'pending', updated_at = ? WHERE id = ?",
        ).run(Date.now(), task.id);
      }
    }

    // Acumula usage do stage 2 (se já rodou) pra byStage final
    if (stage2Task) {
      const cp2 = stage2Task.checkpoint_json ? safeJsonParse<TaskCheckpoint>(stage2Task.checkpoint_json) : null;
      if (cp2?.usageHistory) {
        let cost: number | null = 0;
        const models = new Set<string>();
        for (const a of cp2.usageHistory) {
          stage2UsageAcc.inputTokens += a.usage.inputTokens;
          stage2UsageAcc.outputTokens += a.usage.outputTokens;
          models.add(a.usage.model);
          if (a.costUsd === null) {
            cost = null;
          } else if (cost !== null) {
            cost += a.costUsd.total;
          }
        }
        stage2UsageAcc.costUsd = cost;
        stage2UsageAcc.models = [...models];
      }
      byStageAcc["2"] = stage2UsageAcc;
    }

    for (const module of tasksToRun) {
      let moduleUsageEntry: StageUsage = emptyUsage();
      const task = getOrCreateTask(db, runId, 4, module.id);
      const startedAt = Date.now();
      let attempt = task.attempt;
      let usageHistory: UsageAttempt[] = [];
      let taskError: TaskCheckpoint["error"] | undefined;
      let artifacts: TaskCheckpoint["artifacts"] | undefined;
      const prevCheckpoint = task.checkpoint_json ? safeJsonParse<TaskCheckpoint>(task.checkpoint_json) : null;
      if (prevCheckpoint?.usageHistory) {
        usageHistory = [...prevCheckpoint.usageHistory];
      }

      try {
        attempt++;
        // Guardrail regra #6: páginas owner: human não são regeradas
        const pageOwner = checkPageOwner(absRoot, module);
        if (pageOwner === "human") {
          throw new TaskError("refused_human_page", `module "${module.id}" is on a page with owner: human — refuses to rewrite (regra #6)`);
        }

        // Gera doc via LLM (ou via mock se injetado)
        const result = await generateModuleDoc(absRoot, module, ordered, llmClient!, language, opts.contextCharBudget ?? 60_000);
        const cost = calculateCostUsd(
          result.usage.inputTokens,
          result.usage.outputTokens,
          result.usage.model,
          resolvedConfig.pricing,
        );
        usageHistory.push({
          attempt,
          usage: result.usage,
          costUsd: cost,
          finishedAt: Date.now(),
        });
        moduleUsageEntry = accumulateUsage(moduleUsageEntry, result.usage, cost, resolvedConfig.pricing);
        stageUsageTotals = accumulateUsage(stageUsageTotals, result.usage, cost, resolvedConfig.pricing);

        // Grava página (preserva blocos lw:manual byte-a-byte)
        const wikiPath = `livewiki/${module.id}.md`;
        await writeWikiPagePreservingManual(absRoot, wikiPath, result.content);

        // Verify pós-escrita
        const verifyResult = await runVerify(absRoot);
        const broken = verifyResult.issues.filter((i) => i.wikiPath === wikiPath && i.severity === "error");
        if (broken.length > 0) {
          throw new TaskError(
            "verify_failed",
            broken.map((b) => `[${b.code}] ${b.detail}`).join("; "),
          );
        }

        const pageHash = sha256(result.content);
        artifacts = { wikiPath, pageHash };

        const okCheckpoint: TaskCheckpoint = {
          stage: 4,
          status: "done",
          attempt,
          startedAt,
          finishedAt: Date.now(),
          usageHistory,
          ...(artifacts ? { artifacts } : {}),
        };
        db.prepare(
          "UPDATE batch_tasks SET status = ?, checkpoint_json = ?, updated_at = ? WHERE id = ?",
        ).run("done", JSON.stringify(okCheckpoint), Date.now(), task.id);

        cb.consecutive = 0;
        cb.done++;
      } catch (err) {
        const code = err instanceof TaskError ? err.code : "unexpected";
        const message = (err as Error).message;
        taskError = { code, message };
        usageHistory.push({
          attempt,
          usage: { inputTokens: 0, outputTokens: 0, model: "(no usage)" },
          costUsd: null,
          finishedAt: Date.now(),
        });
        const failCheckpoint: TaskCheckpoint = {
          stage: 4,
          status: "failed",
          attempt,
          startedAt,
          finishedAt: Date.now(),
          usageHistory,
          error: taskError,
        };
        db.prepare(
          "UPDATE batch_tasks SET status = ?, checkpoint_json = ?, updated_at = ? WHERE id = ?",
        ).run("failed", JSON.stringify(failCheckpoint), Date.now(), task.id);

        cb.consecutive++;
        cb.fails++;
        failures.push({
          taskId: task.id,
          module: module.id,
          error: taskError,
          retryCommand: `livewiki batch --only ${module.id} ${runId}`,
        });
        // Circuit breaker: 3 falhas CONSECUTIVAS, OU >50% com pelo menos
        // 3 tasks já tentadas (senão o ratio dispara no 1º failure =
        // 1/1 = 100%, o que abortaria qualquer run com 1 task).
        const totalAttempted = cb.done + cb.fails;
        if (
          cb.consecutive >= 3 ||
          (totalAttempted >= 3 && cb.fails / totalAttempted > 0.5)
        ) {
          // Circuit breaker triggered
          byStageAcc["4"] = stageUsageTotals;
          finalizeRun(db, runId, "aborted", {
            totals: aggregateTotals(stage2UsageAcc, stageUsageTotals),
            byStage: byStageAcc,
            byModule: moduleUsage,
            modulesRefined: modules.map((m) => ({ id: m.id, paths: m.paths })),
            tasksDone: cb.done,
            tasksFailed: cb.fails,
          });
          return buildResult(runId, "aborted", stageUsageTotals, moduleUsage, failures, true);
        }
      }
      moduleUsage.push({ module: module.id, ...moduleUsageEntry });
    }
    byStageAcc["4"] = stageUsageTotals;

    // H (rev2): se ordered > 0 mas cb.done === 0, isso é uma falha do pipeline
    // (não terminamos nada). Status vira "completed_with_failures" (exit 1),
    // nunca "completed" (exit 0). Mesma lógica que `cb.fails > 0` mas pro
    // caso de zero tasks completadas por outro motivo.
    let status: BatchRunResult["status"];
    if (ordered.length > 0 && cb.done === 0) {
      status = "completed_with_failures";
      // Garante que aparece pelo menos 1 failure no reporte (senão o usuário
      // não sabe o que aconteceu).
      if (failures.length === 0) {
        failures.push({
          taskId: 0,
          module: "(none)",
          error: {
            code: "no_tasks_completed",
            message: `heuristic found ${ordered.length} module(s) but 0 tasks completed — check LLM errors above`,
          },
          retryCommand: `livewiki batch resume ${runId}`,
        });
      }
    } else if (cb.fails > 0) {
      status = "completed_with_failures";
    } else {
      status = "completed";
    }
    finalizeRun(db, runId, status, {
      totals: aggregateTotals(stage2UsageAcc, stageUsageTotals),
      byStage: byStageAcc,
      byModule: moduleUsage,
      modulesRefined: modules.map((m) => ({ id: m.id, paths: m.paths })),
      tasksDone: cb.done,
      tasksFailed: cb.fails,
    });

    // Manifest no fim (se não skip)
    if (!opts.skipManifestWrite) {
      const snapshotHash = await computeSnapshotHash(absRoot);
      const pendingBatch: PendingBatchRef | null =
        cb.fails > 0 || cb.done === 0
          ? { runId, stage: 4, done: cb.done, total: ordered.length }
          : null;
      await writeManifestIfChanged(
        absRoot,
        buildManifest({
          lastDocumentedCommit: null,
          snapshotHash,
          pendingBatch,
        }),
      );
    }

    return buildResult(
      runId,
      status,
      stageUsageTotals,
      moduleUsage,
      failures,
      false,
    );
  } finally {
    db.close();
  }
}

// === Helpers ===

/**
 * Erro lançado quando o pipeline termina com 0 tasks apesar de a heurística
 * ter encontrado módulos. H (rev2): NUNCA pode terminar "completed" com
 * exit 0 nesse caso — isso esconde bugs do orquestrador.
 */
export class EmptyPipelineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmptyPipelineError";
  }
}

class TaskError extends Error {
  public readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "TaskError";
  }
}

function emptyUsage(): StageUsage {
  return { inputTokens: 0, outputTokens: 0, costUsd: null, models: [] };
}

/** Soma dois StageUsage (lida com costUsd null = "desconhecido"). */
function aggregateTotals(a: StageUsage, b: StageUsage): StageUsage {
  const costUsd =
    a.costUsd === null || b.costUsd === null
      ? (a.costUsd ?? b.costUsd)
      : a.costUsd + b.costUsd;
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    costUsd,
    models: [...new Set([...a.models, ...b.models])],
  };
}

function accumulateUsage(
  acc: StageUsage,
  usage: { inputTokens: number; outputTokens: number; model: string },
  cost: ReturnType<typeof calculateCostUsd>,
  override: Parameters<typeof calculateCostUsd>[3],
): StageUsage {
  const newAcc: StageUsage = {
    inputTokens: acc.inputTokens + usage.inputTokens,
    outputTokens: acc.outputTokens + usage.outputTokens,
    costUsd: acc.costUsd === null
      ? cost?.total ?? null
      : cost === null
        ? acc.costUsd
        : acc.costUsd + cost.total,
    models: acc.models.includes(usage.model)
      ? acc.models
      : [...acc.models, usage.model],
  };
  return newAcc;
}

function getOrCreateTask(
  db: import("better-sqlite3").Database,
  runId: number,
  stage: 1 | 2 | 3 | 4,
  target: string,
): { id: number; attempt: number; checkpoint_json: string | null } {
  const existing = db
    .prepare(
      "SELECT id, checkpoint_json FROM batch_tasks WHERE run_id = ? AND stage = ? AND target = ?",
    )
    .get(runId, stage, target) as { id: number; checkpoint_json: string | null } | undefined;
  if (existing) {
    const cp = existing.checkpoint_json ? safeJsonParse<TaskCheckpoint>(existing.checkpoint_json) : null;
    return { id: existing.id, attempt: cp?.attempt ?? 0, checkpoint_json: existing.checkpoint_json };
  }
  const res = db
    .prepare(
      "INSERT INTO batch_tasks (run_id, stage, target, status, updated_at) VALUES (?, ?, ?, 'pending', ?)",
    )
    .run(runId, stage, target, Date.now());
  return { id: Number(res.lastInsertRowid), attempt: 0, checkpoint_json: null };
}

function createOrGetTask(
  db: import("better-sqlite3").Database,
  runId: number,
  stage: 1 | 2 | 3 | 4,
  target: string,
  mode: "run" | "resume" | "only",
): { id: number; attempt: number; checkpoint_json: string | null } | null {
  if (mode === "only") return null; // só roda stage 4
  return getOrCreateTask(db, runId, stage, target);
}

function safeJsonParse<T>(s: string): T | null {
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

/**
 * Valida o JSON devolvido pelo LLM no stage 2 (refinamento de módulos).
 *
 * FIX I (rev2): a versão antiga aceitava `{"modules": []}` como sucesso e
 * substituía os módulos heurísticos por nada. Agora rejeita:
 *   - JSON malformado / sem campo "modules" array
 *   - `modules: []` (vazio) — heurística SEMPRE produz ≥1 módulo se há files
 *   - módulos cujos `paths` somados não cobrem ≥80% dos arquivos heurísticos
 *     (LLM inventou módulos ou omitiu paths) — cobre o caso onde a
 *     cobertura é parcial mas ainda útil (≥80%); abaixo disso é alucinação
 *   - `id` duplicado ou vazio
 *
 * Retorna `{ accepted: true, modules }` ou `{ accepted: false, errorCode,
 * errorMessage }`. A heurística é mantida em qualquer caso de rejeição.
 */
function validateRefinedModules(
  content: string,
  heuristicFiles: Set<string>,
): {
  accepted: boolean;
  modules?: Module[];
  errorCode?: string;
  errorMessage?: string;
} {
  // 1. Extrai primeiro objeto JSON do content (LLM pode adicionar prosa)
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) {
    return {
      accepted: false,
      errorCode: "refine_invalid_json",
      errorMessage: "no JSON object found in LLM response",
    };
  }
  let parsed: { modules?: unknown };
  try {
    parsed = JSON.parse(match[0]) as { modules?: unknown };
  } catch (err) {
    return {
      accepted: false,
      errorCode: "refine_invalid_json",
      errorMessage: `JSON parse failed: ${(err as Error).message}`,
    };
  }
  if (!parsed.modules || !Array.isArray(parsed.modules)) {
    return {
      accepted: false,
      errorCode: "refine_invalid_json",
      errorMessage: 'response has no "modules" array',
    };
  }

  // 2. modules: [] → rejeita
  if (parsed.modules.length === 0) {
    return {
      accepted: false,
      errorCode: "refine_rejected_empty",
      errorMessage:
        "refined modules array is empty — would erase heuristic modules; ignoring refinement",
    };
  }

  // 3. Valida shape de cada módulo
  const ids = new Set<string>();
  const refinedFiles = new Set<string>();
  const cleanModules: Module[] = [];
  for (const m of parsed.modules) {
    if (!m || typeof m !== "object") continue;
    const obj = m as { id?: unknown; paths?: unknown };
    if (typeof obj.id !== "string" || obj.id === "") {
      return {
        accepted: false,
        errorCode: "refine_invalid_module",
        errorMessage: "module without valid id",
      };
    }
    if (ids.has(obj.id)) {
      return {
        accepted: false,
        errorCode: "refine_invalid_module",
        errorMessage: `duplicate module id: "${obj.id}"`,
      };
    }
    ids.add(obj.id);
    if (!Array.isArray(obj.paths) || obj.paths.some((p) => typeof p !== "string")) {
      return {
        accepted: false,
        errorCode: "refine_invalid_module",
        errorMessage: `module "${obj.id}" has non-string paths`,
      };
    }
    const paths = obj.paths.filter((p) => heuristicFiles.has(p));
    for (const p of paths) refinedFiles.add(p);
    cleanModules.push({ id: obj.id, paths: obj.paths, symbolCount: 0 });
  }

  // 4. Cobertura: ≥80% dos arquivos heurísticos precisam aparecer nos paths
  // refined. Caso contrário o LLM inventou módulos e perdeu arquivos.
  if (heuristicFiles.size > 0) {
    let covered = 0;
    for (const f of heuristicFiles) if (refinedFiles.has(f)) covered++;
    const coverage = covered / heuristicFiles.size;
    if (coverage < 0.8) {
      return {
        accepted: false,
        errorCode: "refine_insufficient_coverage",
        errorMessage: `refined modules cover only ${(coverage * 100).toFixed(0)}% of heuristic files (need ≥80%); ignoring refinement`,
      };
    }
  }

  return { accepted: true, modules: cleanModules };
}

async function collectAllImports(
  absRoot: string,
  filePaths: string[],
): Promise<Map<string, Awaited<ReturnType<typeof collectImports>>>> {
  const out = new Map<string, Awaited<ReturnType<typeof collectImports>>>();
  for (const p of filePaths) {
    try {
      const content = await nodeFs.readFile(nodePath.join(absRoot, p), "utf8");
      out.set(p, await collectImports(p, content));
    } catch {
      // skip unparseable
    }
  }
  return out;
}

function checkPageOwner(absRoot: string, module: Module): "human" | "generated" | "mixed" | null {
  // Simplificado: lê a wiki page se existir e extrai owner do frontmatter
  return null; // MVP: não bloqueia por owner — só no --only fase 5+
}

async function writeWikiPagePreservingManual(
  absRoot: string,
  wikiPath: string,
  newContent: string,
): Promise<void> {
  // Regra #6: se página existente tem blocos lw:manual, preserva byte-a-byte.
  // MVP: simplesmente escreve (preserve vai pra fase 5).
  await safeIo.writeText(absRoot, wikiPath, newContent);
}

async function generateModuleDoc(
  absRoot: string,
  module: Module,
  _ordered: Module[],
  llmClient: LlmClient,
  language: Language,
  charBudget: number,
): Promise<GenerateResult> {
  // Monta closedKeyList a partir dos símbolos ativos do módulo
  const db = openIndex(
    await safeIo.resolveAndValidate(absRoot, ".livewiki/index.db"),
  );
  let closedKeyList: string[];
  let symbolsTable: string;
  let truncatedSource: string;
  try {
    const fileIds = await getFileIdsForModule(absRoot, module);
    const stmt = db.prepare(
      `SELECT key, name, kind, signature FROM symbols
       WHERE status = 'active' AND file_id IN (${fileIds.map(() => "?").join(",") || "NULL"})`,
    );
    const symbols = (fileIds.length > 0 ? stmt.all(...fileIds) : []) as Array<{
      key: string;
      name: string;
      kind: string;
      signature: string | null;
    }>;
    closedKeyList = symbols.map((s) => s.key).sort();
    symbolsTable = symbols
      .map((s) => `- ${s.key} (${s.kind}): ${s.signature ?? ""}`)
      .join("\n");
    // Concatena source dos arquivos do módulo (truncado por orçamento)
    let src = "";
    for (const p of module.paths) {
      try {
        const c = await nodeFs.readFile(nodePath.join(absRoot, p), "utf8");
        src += `\n// === ${p} ===\n${c}\n`;
        if (src.length > charBudget) {
          src = src.slice(0, charBudget) + "\n// ... (truncated by budget)\n";
          break;
        }
      } catch {
        // skip
      }
    }
    truncatedSource = src;
  } finally {
    db.close();
  }

  const prompt = buildStage4Prompt(module, closedKeyList, symbolsTable, truncatedSource, language);
  return await llmClient.generate({
    system: prompt.system,
    user: prompt.user,
    maxTokens: 4_000,
  });
}

async function getFileIdsForModule(absRoot: string, module: Module): Promise<number[]> {
  const db = openIndex(
    await safeIo.resolveAndValidate(absRoot, ".livewiki/index.db"),
  );
  try {
    const placeholders = module.paths.map(() => "?").join(",");
    const rows = db
      .prepare(`SELECT id FROM files WHERE path IN (${placeholders || "''"})`)
      .all(...module.paths) as Array<{ id: number }>;
    return rows.map((r) => r.id);
  } finally {
    db.close();
  }
}

function finalizeRun(
  db: import("better-sqlite3").Database,
  runId: number,
  status: "completed" | "completed_with_failures" | "aborted",
  opts: {
    totals: StageUsage;
    byStage: Record<string, StageUsage>;
    byModule: BatchRunResult["byModule"];
    modulesRefined: Array<{ id: string; paths: string[] }>;
    tasksDone: number;
    tasksFailed: number;
  },
): void {
  // FIX J (rev2): summary_json mora em batch_runs.summary_json — é uma
  // propriedade do RUN, não de uma task. Aqui carregamos os módulos
  // refinados + o agregado do run (totals/byStage/byModule).
  const summary: BatchRunSummary = {
    totals: opts.totals,
    byStage: opts.byStage,
    byModule: opts.byModule,
    tasksDone: opts.tasksDone,
    tasksFailed: opts.tasksFailed,
    tasksPending: 0,
    modulesRefined: opts.modulesRefined,
  };
  db.prepare(
    "UPDATE batch_runs SET status = ?, finished_at = ?, summary_json = ? WHERE id = ?",
  ).run(status, Date.now(), JSON.stringify(summary), runId);
}

function buildResult(
  runId: number,
  status: BatchRunResult["status"],
  totals: StageUsage,
  byModule: BatchRunResult["byModule"],
  failures: BatchRunResult["failures"],
  circuitBreakerTriggered: boolean,
): BatchRunResult {
  return {
    runId,
    status,
    totals,
    byModule,
    failures,
    circuitBreakerTriggered,
  };
}

export type { BatchStatusReport, BatchRunSummary };

/**
 * Mapeia `BatchRunResult.status` → exit code POSIX.
 *
 *   completed               → 0
 *   completed_with_failures → 1
 *   aborted                 → 2
 *
 * Fonte: AGENTS.md §"Convenções adicionais" e batch.ts CLI (setExitCode
 * existente). Exportado aqui para que init --batch propague o mesmo exit
 * code que `batch status/resume/--only` já propagam — antes do fix (O),
 * init --batch sempre retornava 0 mesmo em completed_with_failures/aborted,
 * escondendo falha sistêmica do orquestrador atrás de exit success.
 *
 * Use com `process.exitCode = statusToExitCode(status)` (não `process.exit`)
 * pra preservar o FIX L (rev2): deixar o event loop drenar antes de sair.
 */
export function statusToExitCode(
  status: BatchRunResult["status"],
): 0 | 1 | 2 {
  if (status === "completed") return 0;
  if (status === "completed_with_failures") return 1;
  return 2; // aborted
}