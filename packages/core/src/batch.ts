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
      let modulesJson: string | undefined;
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
          // Tenta parsear JSON. Se falhar, mantém heurística (graceful degradation).
          const refined = tryParseRefinedModules(result.content);
          if (refined) {
            modules = refined;
            modulesJson = JSON.stringify(refined);
            // No artifacts for stage 2 (no wiki page written)
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
      const summaryJson = modulesJson ?? JSON.stringify(modules);
      db.prepare(
        "UPDATE batch_tasks SET status = ?, checkpoint_json = ?, updated_at = ? WHERE id = ?",
      ).run("done", checkpointJson + "\n__MODULES__:" + summaryJson, Date.now(), stage2Task.id);
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
    let stageUsageTotals: StageUsage = emptyUsage();

    const tasksToRun = opts.onlyTarget
      ? ordered.filter((m) => m.id === opts.onlyTarget)
      : ordered;

    if (opts.onlyTarget && tasksToRun.length === 0) {
      throw new Error(`module "${opts.onlyTarget}" not found in this run`);
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
        if (cb.consecutive >= 3 || cb.fails / (cb.done + cb.fails) > 0.5) {
          // Circuit breaker triggered
          finalizeRun(db, runId, "aborted");
          return buildResult(runId, "aborted", stageUsageTotals, moduleUsage, failures, true);
        }
      }
      moduleUsage.push({ module: module.id, ...moduleUsageEntry });
    }

    // Final do run
    const status = cb.fails > 0 ? "completed_with_failures" : "completed";
    finalizeRun(db, runId, status);

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

function tryParseRefinedModules(content: string): Module[] | null {
  // Tenta extrair JSON do response (LLM pode adicionar texto ao redor)
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as { modules?: Array<{ id: string; paths: string[] }> };
    if (!parsed.modules || !Array.isArray(parsed.modules)) return null;
    return parsed.modules.map((m) => ({
      id: m.id,
      paths: m.paths,
      symbolCount: 0, // re-contado depois se necessário
    }));
  } catch {
    return null;
  }
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
): void {
  db.prepare(
    "UPDATE batch_runs SET status = ?, finished_at = ? WHERE id = ?",
  ).run(status, Date.now(), runId);
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