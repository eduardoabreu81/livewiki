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
 *   - Retry adds new usage to the checkpoint (usageHistory, attempt++).
 *
 * Manifest (fix #3):
 *   - manifest.ts grava .livewiki/.manifest.json com snapshotHash.
 *   - pendingBatch inside the manifest allows cross-machine handoff.
 *
 * Phase-5 plan (U, V, W, X): stage 4 accepts a normalized artifact, not
 * the raw transcript. Structural failures trigger a bounded sequence
 * of repair prompts. Module IDs are globally unique before the
 * first write. The write is transactional (snapshot → write → verify
 * → restore/remove on failure).
 */

import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";
import * as safeIo from "./safe-io.js";
import { openIndex, type SymbolRow } from "./db.js";
import { run as runIndexer } from "./indexer.js";
import { run as runLedger } from "./anchor-ledger.js";
import { run as runVerify, type VerifyIssue } from "./verify.js";
import {
  identifyModulesHeuristic,
  resolveModuleEdges,
  prioritizeModules,
  makeUniqueDeterministicIds,
  splitOversizedModules,
  assertUniqueModuleIds,
  DuplicateModuleIdError,
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
  buildRepairPrompt,
  type Language,
  type ArtifactValidationError,
} from "./prompts.js";
import {
  normalizeStage4Artifact,
  validateStage4Artifact,
} from "./artifact.js";
import { computeSnapshotHash, writeManifestIfChanged, buildManifest } from "./manifest.js";
import { sha256 } from "./hashes.js";
import { regenerateArchitectureOverview } from "./init.js";
import { parseFrontmatter, getOwner } from "./frontmatter.js";
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
  /** Injected for tests. If absent, loads from config + env var. */
  llmClient?: LlmClient;
  /** Language of the doc (default: config.language || "en") */
  language?: Language;
  /** --no-refine: skip the LLM refinement of stage 2 */
  noRefine?: boolean;
  /** --only <target>: re-run 1 task (target = module.id or runId) */
  onlyTarget?: string;
  /** Character limit of the code per module in the prompt (default 60_000). */
  contextCharBudget?: number;
  /** Skip manifest write at the end (for tests) */
  skipManifestWrite?: boolean;
  /**
   * Phase-5 plan (X): override of `maxRepairAttempts` (default = config
   * or `CONFIG_DEFAULTS.maxRepairAttempts` = 2). Non-negative integer.
   * `0` disables repair (one single call per task).
   */
  maxRepairAttempts?: number;
  /** Stage-4 max output tokens (default from config / 8192). */
  stage4MaxOutputTokens?: number;
  /** Override thinking mode for openai-compat (MiniMax-M3 etc.). */
  thinking?: "disabled" | "adaptive" | "omit";
  /** Module split thresholds (0 = disable that axis). */
  maxModuleFiles?: number;
  maxModuleSymbols?: number;
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
 * Re-runs 1 specific task (--only). Increments attempt, accumulates usage.
 * Guardrails (rule #6): preserves lw:manual byte-for-byte, refuses owner: human.
 */
export async function runOnly(opts: BatchOptions): Promise<BatchRunResult> {
  if (!opts.onlyTarget) {
    throw new Error("onlyTarget is required for runOnly");
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

    // Phase-5 plan (X): resolve maxRepairAttempts (opts > config > default 2).
    // In opts.maxRepairAttempts=0 → no repair.
    const maxRepairAttempts =
      opts.maxRepairAttempts ?? resolvedConfig.maxRepairAttempts ?? 2;
    if (
      typeof maxRepairAttempts !== "number" ||
      !Number.isInteger(maxRepairAttempts) ||
      maxRepairAttempts < 0
    ) {
      throw new Error(
        `invalid maxRepairAttempts: must be a non-negative integer, got ${JSON.stringify(maxRepairAttempts)}`,
      );
    }
    const stage4MaxOutputTokens =
      opts.stage4MaxOutputTokens ??
      resolvedConfig.stage4MaxOutputTokens ??
      8192;
    const thinkingMode = opts.thinking ?? resolvedConfig.thinking;
    const maxModuleFiles =
      opts.maxModuleFiles ?? resolvedConfig.maxModuleFiles ?? 12;
    const maxModuleSymbols =
      opts.maxModuleSymbols ?? resolvedConfig.maxModuleSymbols ?? 80;

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
        maxRepairAttempts,
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

    // === Stage 1: Scan ===
    if (opts.mode === "run") {
      await runIndexer(absRoot, { quiet: true });
      await runLedger(absRoot, { quiet: true });
    }

    // Load active symbols + file paths (cache)
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
          // FIX I (rev2): validate refined BEFORE accepting. Rejects:
          //   - malformed JSON / missing "modules" array
          //   - modules: [] (empty) — heuristic always has ≥1 module
          //   - modules that do NOT cover the heuristic files
          //     (declared paths pointing outside the repo, or coverage
          //     < 100% of heuristic files = LLM invented modules)
          // In any rejection case, keep the heuristic and mark
          // error in the checkpoint (with specific code) for traceability.
          const heuristicFiles = new Set(modules.flatMap((m) => m.paths));
          const validation = validateRefinedModules(
            result.content,
            heuristicFiles,
          );
          if (validation.accepted) {
            modules = validation.modules!;
          } else {
            // Keep heuristic. Mark error in the checkpoint (not a task
            // failure — it is degradation, status stays 'done').
            error = {
              code: validation.errorCode ?? "refine_rejected",
              message: validation.errorMessage ?? "refined modules rejected",
            };
          }
        } catch (err) {
          // LLM refinement failure: continue with heuristic (NOT a task failure)
          error = {
            code: "refine_failed_degraded",
            message: (err as Error).message,
          };
        }
      }

      // Persist task (always 'done' — degradation is not a failure)
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
      // FIX J (rev2): refined modules are NEVER concatenated into checkpoint_json —
      // that corrupted the JSON and the status report lost stage 2 usage.
      // They live in batch_runs.summary_json (own field), populated at the end
      // of the run via `finalizeRunSummary` below.
      db.prepare(
        "UPDATE batch_tasks SET status = ?, checkpoint_json = ?, updated_at = ? WHERE id = ?",
      ).run("done", checkpointJson, Date.now(), stage2Task.id);
    }

    // === Phase-5 plan (W) — global uniqueness gate ===
    // Must run BEFORE edges / prioritization / diagrams / quickstart /
    // overview / creation of stage 4 tasks. The module identity is
    // the same thing in all these places: planner, dependency graph,
    // regeneratedArchitectureOverview, batch_tasks.target, and the name of the
    // `livewiki/<id>.md` file. If the assertion fails, we mark the run
    // as `aborted` (terminal status) — never `running` — before
    // re-throwing.
    try {
      // Split oversized modules (structural) so stage-4 pages can complete.
      modules = splitOversizedModules(modules, {
        maxFiles: maxModuleFiles === 0 ? Number.MAX_SAFE_INTEGER : maxModuleFiles,
        maxSymbols:
          maxModuleSymbols === 0 ? Number.MAX_SAFE_INTEGER : maxModuleSymbols,
        symbolCountByPath,
      });
      modules = makeUniqueDeterministicIds(modules);
      assertUniqueModuleIds(modules);
    } catch (err) {
      const dupErr = err as DuplicateModuleIdError;
      // REVIEW finding #3: status MUST NOT stay as 'running'. Mark
      // terminal and re-throw so the caller knows.
      try {
        db.prepare(
          "UPDATE batch_runs SET status = ?, finished_at = ?, summary_json = ? WHERE id = ?",
        ).run(
          "aborted",
          Date.now(),
          JSON.stringify({
            totals: emptyUsage(),
            byStage: {},
            byModule: [],
            tasksDone: 0,
            tasksFailed: 0,
            tasksPending: 0,
            modulesRefined: null,
            abortedReason: dupErr.message,
          }),
          runId,
        );
      } catch {
        // best-effort; the re-throw below carries the message
      }
      throw err;
    }

    // === Stage 3: Prioritization (with IDs already unique and stable) ===
    const edges = resolveModuleEdges(
      modules,
      await collectAllImports(absRoot, filePaths),
      new Set(filePaths),
    );
    let ordered = prioritizeModules(modules, edges);

    // Defense in depth: prioritization does not change IDs, but re-applying W ensures
    // that any new path that entered ordered (it shouldn't, but
    // for safety) still passes the filter.
    ordered = makeUniqueDeterministicIds(ordered);
    assertUniqueModuleIds(ordered);

    // === Stage 4: Coordinated documentation ===
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

    // H (rev2): explicit guard. If there are modules to document and `tasksToRun`
    // is empty, this is a pipeline failure — it cannot finish as "completed"
    // with exit 0. Catches cases like: heuristic found modules, refinement
    // returned empty [], or the --only filter did not match.
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
        // Reset the checkpoint for re-run (but preserve usageHistory if any)
        db.prepare(
          "UPDATE batch_tasks SET status = 'pending', updated_at = ? WHERE id = ?",
        ).run(Date.now(), task.id);
      }
    }

    // Accumulate stage 2 usage (if it already ran) for final byStage
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

    // Reviewer revision (finding #4): if ANY task had rollback_failed,
    // the entire RUN aborts (terminal status = "aborted"). We do not continue
    // for the other modules — disk may be inconsistent.
    let runAbortedByRollback = false;

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

      const wikiPath = `livewiki/${module.id}.md`;

      // Review finding #1 + reviewer revision: pre-LLM check —
      // ONLY `owner: human` refuses the whole page (rule #6:
      // human is untouchable). `owner: mixed` is allowed (manual blocks
      // preserved byte-for-byte; only the generated part is rewritten).
      // `null` (new page) proceeds normally. `untrusted` and
      // `unparseable` refuse for safety.
      const existing = await safeIo.readText(absRoot, wikiPath).catch(() => null);
      const preOwner = readOwnerFromFrontmatter(existing);
      if (preOwner === "human") {
        taskError = {
          code: "refused_human_page",
          message:
            `module "${module.id}" is on a page with owner: human — refuses to rewrite (rule #6). ` +
            `Operator must manually change owner to "generated" or "mixed" if a re-run is desired.`,
        };
      } else if (preOwner === "untrusted") {
        taskError = {
          code: "refused_human_page",
          message:
            `module "${module.id}" is on a page with a missing or invalid \`owner:\` line — refuses to rewrite (rule #6). ` +
            `Operator must manually set owner to "generated" or "mixed" if a re-run is desired.`,
        };
      } else if (preOwner === "unparseable") {
        taskError = {
          code: "refused_unparseable_page",
          message:
            `module "${module.id}" is on a page whose frontmatter did not parse (LF/CRLF/BOM-safe check). ` +
            `Refusing to rewrite untrusted content (rule #6 — operator must repair the page manually).`,
        };
      } else {
        // Loop bounded: 1 initial + maxRepairAttempts repairs.
        const totalAttempts = 1 + maxRepairAttempts;
        let attemptDone = false;
        let priorCandidate = "";
        let priorErrors: ArtifactValidationError[] = [];

        for (let i = 0; i < totalAttempts; i++) {
          attempt++;
          // Reviewer revision (finding #5): the `attemptNumber` passed
          // to the LLM call is the GLOBAL COUNTER (started from `task.attempt`
          // persisted and incremented at every attempt). NEVER `i + 1`
          // (which would reset on every run/--only execution). With that,
          // usageHistory[].attempt is monotonic: 1, 2, 3, 4, ... across
          // multiple --only/resume calls.
          const attemptResult = await attemptStage4Generation({
            attemptNumber: attempt,
            module,
            language,
            llmClient: llmClient!,
            charBudget: opts.contextCharBudget ?? 60_000,
            // isRepair = attempt > 1 inside this bounded loop
            isRepair: i > 0,
            priorCandidate,
            priorErrors,
            absRoot,
            // Review finding #5: pricing override preserved in repairs.
            pricing: resolvedConfig.pricing,
            maxTokens: stage4MaxOutputTokens,
            thinking: thinkingMode,
          });
          usageHistory.push(attemptResult.usageEntry);
          moduleUsageEntry = accumulateUsage(
            moduleUsageEntry,
            attemptResult.usageEntry.usage,
            attemptResult.usageEntry.costUsd,
            resolvedConfig.pricing,
          );
          stageUsageTotals = accumulateUsage(
            stageUsageTotals,
            attemptResult.usageEntry.usage,
            attemptResult.usageEntry.costUsd,
            resolvedConfig.pricing,
          );

          if (attemptResult.llmError) {
            // LLM call failed (network, 5xx, etc). We record zero-usage,
            // and if there are still attempts, the next attempt makes the call
            // again from scratch (no prior candidate). Otherwise,
            // task fails.
            priorCandidate = "";
            priorErrors = [
              {
                code: "llm_error",
                message: attemptResult.llmError.message,
                location: "global",
              },
            ];
            continue;
          }

          if (attemptResult.artifact === null) {
            // Invalid artifact (validation rejected it). Next attempt uses
            // repair prompt with the structured errors and the candidate.
            priorCandidate = attemptResult.normalizedRaw;
            priorErrors = attemptResult.validationErrors;
            continue;
          }

          // Valid artifact → try write + verify
          const writeResult = await tryWriteAndVerify(
            absRoot,
            wikiPath,
            attemptResult.artifact,
            existing,
          );
          if (writeResult.ok) {
            // SUCCESS — task done. Does NOT increment cb.fails.
            attemptDone = true;
            artifacts = writeResult.artifacts;
            break;
          } else if (writeResult.rollbackFailed) {
            // Review finding #4 + reviewer revision: rollback failure is
            // TERMINAL not just for the task, but for the ENTIRE RUN. Disk
            // may be inconsistent; continuing to other modules
            // only amplifies the problem. Mark the task as final failure and
            // sets runAbortedByRollback to abort the loop.
            taskError = {
              code: "rollback_failed",
              message:
                `rollback failed after verify rejection for ${wikiPath}: ${writeResult.rollbackFailed.reason}. ` +
                `This is a terminal state for the ENTIRE run — the disk may have an inconsistent page. ` +
                `Operator must inspect ${wikiPath} and re-run with --only after manual repair.`,
            };
            attemptDone = true; // break out of this task's repair loop
            runAbortedByRollback = true; // signals: exits the modules loop too
            break;
          } else {
            // Verify failed → restore/remove the candidate (already done inside
            // tryWriteAndVerify). Prepare the next attempt for repair.
            // The "prior candidate" for repair is what was rejected.
            priorCandidate = attemptResult.artifact;
            priorErrors = verifyIssuesToValidationErrors(writeResult.issues ?? []);
            continue;
          }
        }

        if (!attemptDone) {
          // Review finding #10: repair_exhausted PRESERVES the last
          // structured diagnostic (validation errors or verify issues)
          // so the operator knows exactly what failed. Without this,
          // the report only said "exhausted N calls" and the user had to
          // look at raw logs.
          const lastError = priorErrors[0];
          const lastDetail = lastError
            ? `[${lastError.code}] ${lastError.message}` +
              (lastError.offending ? ` (offending: ${lastError.offending})` : "")
            : "no validation/verify error was recorded (LLM call may have failed every attempt)";
          taskError = {
            code: "repair_exhausted",
            message:
              `task "${module.id}" exhausted ${totalAttempts} LLM call(s) without producing a verified artifact. ` +
              `Last diagnostic: ${lastDetail}. ` +
              `Total errors recorded: ${priorErrors.length}.`,
            ...(lastError?.sectionSlug ? { failedAt: 4 } : {}),
          };
        }
      }

      // Persist checkpoint and update counters
      if (taskError) {
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
      } else {
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
      }

      // Circuit breaker check: 3 CONSECUTIVE failures, OR >50% with at least
      // 3 tasks already attempted.
      const totalAttempted = cb.done + cb.fails;
      if (
        cb.consecutive >= 3 ||
        (totalAttempted >= 3 && cb.fails / totalAttempted > 0.5)
      ) {
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
      moduleUsage.push({ module: module.id, ...moduleUsageEntry });

      // Reviewer revision (finding #4): rollback_failed aborts the RUN
      // INTEIRO. Do not process the next modules — they will NEVER call
      // LLM and NEVER write. Exit the loop here and finalize as "aborted".
      if (runAbortedByRollback) {
        byStageAcc["4"] = stageUsageTotals;
        finalizeRun(db, runId, "aborted", {
          totals: aggregateTotals(stage2UsageAcc, stageUsageTotals),
          byStage: byStageAcc,
          byModule: moduleUsage,
          modulesRefined: modules.map((m) => ({ id: m.id, paths: m.paths })),
          tasksDone: cb.done,
          tasksFailed: cb.fails,
        });
        return buildResult(runId, "aborted", stageUsageTotals, moduleUsage, failures, false);
      }
    }
    byStageAcc["4"] = stageUsageTotals;

    // H (rev2): if ordered > 0 but cb.done === 0, this is a pipeline failure
    // (we finished nothing). Status becomes "completed_with_failures" (exit 1),
    // never "completed" (exit 0). Same logic as `cb.fails > 0` but for the
    // case of zero tasks completed for another reason.
    let status: BatchRunResult["status"];
    if (ordered.length > 0 && cb.done === 0) {
      status = "completed_with_failures";
      // Ensures that at least 1 failure appears in the report (otherwise the user
      // does not know what happened).
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

    // Manifest at the end (if not skipped)
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

    // (P) Phase 5: regenerates `architecture/overview.md` with links to pages
    // of newly-created modules. Without this, the overview generated by init has
    // missing pages (init ran before batch) → verify reports
    // broken_internal_link warnings (and `(Q)` fails).
    if (cb.done > 0) {
      await regenerateArchitectureOverview(absRoot);
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
 * Error thrown when the pipeline finishes with 0 tasks despite the heuristic
 * having found modules. H (rev2): can NEVER finish as "completed" with
 * exit 0 in this case — it hides orchestrator bugs.
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
 * Validates the JSON returned by the LLM in stage 2 (module refinement).
 *
 * FIX I (rev2): the old version accepted `{"modules": []}` as success and
 * replaced heuristic modules with nothing. Now rejects:
 *   - malformed JSON / missing "modules" array field
 *   - `modules: []` (empty) — heuristic ALWAYS produces ≥1 module if there are files
 *   - modules whose summed `paths` do not cover ≥80% of heuristic files
 *     (LLM invented modules or omitted paths) — covers the case where
 *     coverage is partial but still useful (≥80%); below that is hallucination
 *   - duplicate or empty `id`
 *
 * Returns `{ accepted: true, modules }` or `{ accepted: false, errorCode,
 * errorMessage }`. The heuristic is kept in any rejection case.
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

  // 2. modules: [] → reject
  if (parsed.modules.length === 0) {
    return {
      accepted: false,
      errorCode: "refine_rejected_empty",
      errorMessage:
        "refined modules array is empty — would erase heuristic modules; ignoring refinement",
    };
  }

  // 3. Validate shape of each module
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
    // Reviewer revision (finding #6): module with ALL paths
    // invented by the LLM (none matches `heuristicFiles`) is hallucination
    // pure — there is no real code to document. Reject early instead of
    // producing an empty page in stage 4.
    if (paths.length === 0) {
      return {
        accepted: false,
        errorCode: "refine_invalid_module",
        errorMessage: `module "${obj.id}" has no paths present in heuristic files; would produce an empty page`,
      };
    }
    for (const p of paths) refinedFiles.add(p);
    cleanModules.push({ id: obj.id, paths: obj.paths, symbolCount: 0 });
  }

  // 4. Coverage: ≥80% of heuristic files must appear in the refined
  // paths. Otherwise the LLM invented modules and lost files.
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

/**
 * Review finding #1 + reviewer revision: reads the owner declared in the
 * frontmatter of an existing page. Detects LF, CRLF and BOM before the
 * `---` opening. Used to refuse the re-generation BEFORE calling the LLM
 * (rule #6).
 *
 * Returns:
 *   - `null`: file does not exist (true new page) → skip the check
 *   - `"generated"`: valid frontmatter with `owner: generated` → may regenerate
 *   - `"mixed"`: valid frontmatter with `owner: mixed` → may regenerate
 *     (revision: manual blocks are preserved byte-for-byte by
 *     `tryWriteAndVerify`; the LLM rewrites only the generated part)
 *   - `"human"`: valid frontmatter with `owner: human` → REFUSES to regenerate
 *     (rule #6: human is untouchable, the LLM cannot overwrite)
 *   - `"untrusted"`: frontmatter present but no valid `owner`
 *     (missing or non-string value) → REFUSES to regenerate
 *   - `"unparseable"`: frontmatter present but failed to parse → REFUSES
 *     (operator must repair the page manually)
 */
type PreOwnerCheck = "generated" | "mixed" | "human" | "untrusted" | "unparseable" | null;

function readOwnerFromFrontmatter(content: string | null): PreOwnerCheck {
  if (content === null) return null;
  // Strip BOM if present (0xFEFF).
  let s = content;
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  // Frontmatter opening: accepts LF or CRLF after `---`. Defense
  // against generators that save with different line endings (Windows,
  // git autocrlf, etc).
  if (!s.startsWith("---\n") && !s.startsWith("---\r\n")) return null;
  // Normalize CRLF → LF for the parser.
  s = s.replace(/\r\n/g, "\n");
  try {
    const parsed = parseFrontmatter(s);
    const fm = parsed.frontmatter;
    if (fm === null) return "unparseable";
    if (!("owner" in fm)) return "untrusted";
    const ownerVal = fm["owner"];
    if (typeof ownerVal !== "string") return "untrusted";
    // Reviewer revision: `owner: mixed` is allowed. Manual blocks
    // are preserved byte-for-byte; only the generated part is rewritten.
    if (ownerVal === "generated" || ownerVal === "mixed") return ownerVal;
    if (ownerVal === "human") return "human";
    return "untrusted";
  } catch {
    return "unparseable";
  }
}

/**
 * Reviewer revision (P0-2): rewrites the `owner:` line in the leading
 * frontmatter of `content` to the given literal value. Defensive: if
 * the content has no leading `---` block, no `owner:` line, or the
 * frontmatter is unparseable, returns the content unchanged. Handles
 * LF and CRLF line endings, and the `owner:` line in any indentation
 * / surrounding whitespace.
 */
function forceOwnerInFrontmatter(content: string, owner: "generated" | "mixed"): string {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) return content;
  // Find the closing `---` of the frontmatter.
  const eolLen = content.startsWith("---\r\n") ? 2 : 1;
  const after = eolLen + 3; // length of "---" + eol
  const closeIdx = content.indexOf("\n---", after);
  if (closeIdx < 0) return content;
  const fmBlock = content.slice(0, closeIdx);
  const rest = content.slice(closeIdx);
  // Replace existing `owner: ...` line (with any value) within the block.
  const ownerLineRe = /^(\s*)owner:\s*.*$/m;
  if (ownerLineRe.test(fmBlock)) {
    return fmBlock.replace(ownerLineRe, `$1owner: ${owner}`) + rest;
  }
  // No `owner:` line — inject one right after the opening `---`.
  return `---${content.slice(3, after).slice(0, -eolLen)}\nowner: ${owner}${content.slice(after)}`;
}

/**
 * Phase-5 plan (X) + reviewer revision: extracts blocks
 * `<!-- lw:manual -->...<!-- /lw:manual -->` GROUPED BY SECTION
 * (preceding heading), IN ORDER OF OCCURRENCE. The blocks
 * are untouchable (rule #6) and must be preserved on any rewrite
 * in the SAME logical position (same section, SAME ORDER).
 *
 * Supports MULTIPLE blocks in the same section (reviewer revision): the
 * Map is `sectionSlug → list<blockContent>` instead of `→ single`. The
 * blocks are reinserted in the order they appeared in `existing`.
 *
 * Implementation: pair start/end by order; for each block,
 * finds the previous heading; the block is associated with the slug's list
 * of that heading (append at the end of the list). If there is no heading
 * before, the block is associated with `null` (it will be reinserted at the end
 * of the page).
 */
function extractManualBlocksBySection(content: string): Map<string | null, string[]> {
  const startRe = /<!--\s*lw:manual\s*-->/g;
  const endRe = /<!--\s*\/lw:manual\s*-->/g;
  type Hit = { offset: number; kind: "start" | "end"; markerLen: number };
  const hits: Hit[] = [];
  for (const m of content.matchAll(startRe)) {
    if (m.index !== undefined) {
      hits.push({ offset: m.index, kind: "start", markerLen: m[0].length });
    }
  }
  for (const m of content.matchAll(endRe)) {
    if (m.index !== undefined) {
      hits.push({ offset: m.index, kind: "end", markerLen: m[0].length });
    }
  }
  hits.sort((a, b) => a.offset - b.offset);

  // Headings e seus offsets
  const headingMatches: Array<{ slug: string; offset: number }> = [];
  const headingRe = /^(#{1,6})\s+(.+?)\s*$/gm;
  for (const m of content.matchAll(headingRe)) {
    if (m.index === undefined || m[2] === undefined) continue;
    headingMatches.push({
      slug: slugifyHeadingText(m[2]),
      offset: m.index,
    });
  }

  const result = new Map<string | null, string[]>();
  let openStart: Hit | null = null;
  for (const h of hits) {
    if (h.kind === "start") {
      if (openStart === null) openStart = h;
    } else if (openStart !== null) {
      const startOff = openStart.offset;
      const endEnd = h.offset + h.markerLen;
      // Find the heading immediately preceding the start
      let sectionSlug: string | null = null;
      for (const heading of headingMatches) {
        if (heading.offset <= startOff) sectionSlug = heading.slug;
        else break;
      }
      const blockContent = content.slice(startOff, endEnd);
      const list = result.get(sectionSlug);
      if (list) {
        list.push(blockContent);
      } else {
        result.set(sectionSlug, [blockContent]);
      }
      openStart = null;
    }
  }
  return result;
}

/**
 * Heading slug consistent with `anchors.ts:slugify`. Kept local
 * here to avoid a cyclic dependency (batch.ts already imports from
 * anchors; keeping the helper local simplifies the reasoning and is easy
 * to audit).
 */
function slugifyHeadingText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

/**
 * Review finding #7b + reviewer revision: injects ALL manual
 * blocks (from `existing`) into `newContent` IN THE SAME LOGICAL POSITION
 * (same section by slug) and IN THE SAME ORDER they appear in
 * the original. Preserves the block bytes (rule #6). Supports multiple
 * blocks per section.
 *
 * Sections in `newContent` are delimited by the next heading of the
 * SAME level or higher. Blocks from a section with no match in
 * new go to the end of the page (none are lost).
 *
 * Returns `newContent` with the blocks injected, or `null` if there is no
 * manual block in `existing` (caller skips the step).
 */
function injectManualBlocksBySection(existing: string, newContent: string): string | null {
  const blocksBySection = extractManualBlocksBySection(existing);
  if (blocksBySection.size === 0) return null;

  // Find headings in `newContent` with their offsets and levels.
  const newHeadingRe = /^(#{1,6})\s+(.+?)\s*$/gm;
  const newHeadings: Array<{ slug: string; offset: number; level: number }> = [];
  for (const m of newContent.matchAll(newHeadingRe)) {
    if (m.index === undefined || m[2] === undefined || m[1] === undefined) continue;
    newHeadings.push({
      slug: slugifyHeadingText(m[2]),
      offset: m.index,
      level: m[1].length,
    });
  }

  function sectionRangeOf(headingOffset: number): { endOffset: number } {
    const heading = newHeadings.find((h) => h.offset === headingOffset);
    if (!heading) return { endOffset: newContent.length };
    for (const h of newHeadings) {
      if (h.offset > headingOffset && h.level <= heading.level) {
        return { endOffset: h.offset };
      }
    }
    return { endOffset: newContent.length };
  }

  // Collect insertions: (offset, text). Sort DESCENDING so later inserts
  // do not invalidate earlier offsets.
  const insertions: Array<{ offset: number; text: string }> = [];
  for (const [sectionSlug, blocks] of blocksBySection.entries()) {
    if (sectionSlug === null) {
      // Blocks with no preceding heading: go to the end of the new page.
      insertions.push({
        offset: newContent.length,
        text: "\n\n" + blocks.join("\n\n") + "\n",
      });
      continue;
    }
    const targetHeading = newHeadings.find((h) => h.slug === sectionSlug);
    if (!targetHeading) {
      // Section does not exist in new: they go to the end (not lost).
      insertions.push({
        offset: newContent.length,
        text: "\n\n" + blocks.join("\n\n") + "\n",
      });
      continue;
    }
    // Insert at the end of the section (before the next heading of same/higher
    // level). Blocks are joined with a blank line between them to keep
    // the original visual separation.
    const { endOffset } = sectionRangeOf(targetHeading.offset);
    insertions.push({
      offset: endOffset,
      text: "\n" + blocks.join("\n\n") + "\n",
    });
  }
  insertions.sort((a, b) => b.offset - a.offset);

  let result = newContent;
  for (const ins of insertions) {
    result = result.slice(0, ins.offset) + ins.text + result.slice(ins.offset);
  }
  return result;
}

/**
 * Phase-5 plan (X): wiki page write transaction. Algorithm:
 *   1. If `existing !== null`, extract `<!-- lw:manual -->` blocks from it
 *      with approximate position by section and reinsert them into
 *      `newContent` in the same section (byte-for-byte; review finding #7b).
 *   2. Write `finalContent` via safe-io.
 *   3. Run `runVerify` on the repo.
 *   4. If there's an error-level issue touching this page: rollback (remove if
 *      it was new, restore if it was a rewrite). Review finding #4: if the
 *      rollback fails, this is TERMINAL — we return `rollback_failed`
 *      and the orchestrator marks the task as final failure (does not retry
 *      and does not let the invalid candidate persist).
 *   5. Returns `{ ok, artifacts? | issues? | rollbackFailed? }`.
 */
interface WriteResult {
  ok: boolean;
  artifacts?: { wikiPath: string; pageHash: string };
  issues?: VerifyIssue[];
  /** True se o verify rejeitou E o rollback subsequente falhou. Terminal. */
  rollbackFailed?: { reason: string };
}

async function tryWriteAndVerify(
  absRoot: string,
  wikiPath: string,
  newContent: string,
  existing: string | null,
): Promise<WriteResult> {
  // 1. Preserves manual blocks IN THE ORIGINAL POSITION (review finding #7b).
  //    Strategy: extract blocks grouped by section (heading slug
  //    preceding heading); for each section in `newContent` that matches
  //    a section in `existing` that had a block, inject the block
  //    at the end of the section (before the next heading). Sections from existing
  //    that do not match in new go to the end of the page (not lost).
  let finalContent = newContent;
  if (existing !== null) {
    const positioned = injectManualBlocksBySection(existing, newContent);
    if (positioned !== null) {
      finalContent = positioned;
    }
  }

  // 1b. Reviewer revision (P0-2): if the existing page was `owner: mixed`,
  // force the final frontmatter back to `owner: mixed` BEFORE the
  // write. The LLM always emits `owner: generated` (validator rule),
  // but when the human had already declared the page as `mixed` (mix
  // of auto-generated + manual blocks) we need to preserve that
  // declaration. Without this, the page would be re-classified as
  // pure `generated` and the next re-run would treat it differently.
  if (existing !== null) {
    const existingOwner = readOwnerFromFrontmatter(existing);
    if (existingOwner === "mixed") {
      finalContent = forceOwnerInFrontmatter(finalContent, "mixed");
    }
  }

  const isNew = existing === null;
  const snapshot = existing;

  // 2. Escreve via safe-io
  await safeIo.writeText(absRoot, wikiPath, finalContent);

  // 3. Verify
  const verifyResult = await runVerify(absRoot);
  const broken = verifyResult.issues.filter(
    (i) => i.wikiPath === wikiPath && i.severity === "error",
  );

  if (broken.length > 0) {
    // 4. ROLLBACK MANDATORY. If the rollback fails, this is TERMINAL
    //    (review finding #4): invalid candidate MUST NEVER persist
    //    on disk and the orchestrator must signal the failure.
    let rollbackError: string | null = null;
    if (isNew) {
      try {
        await safeIo.remove(absRoot, wikiPath);
      } catch (e) {
        rollbackError = `failed to remove new file ${wikiPath}: ${(e as Error).message}`;
      }
    } else if (snapshot !== null) {
      try {
        await safeIo.writeText(absRoot, wikiPath, snapshot);
      } catch (e) {
        rollbackError = `failed to restore previous content of ${wikiPath}: ${(e as Error).message}`;
      }
    }
    if (rollbackError !== null) {
      return {
        ok: false,
        issues: broken,
        rollbackFailed: { reason: rollbackError },
      };
    }
    return { ok: false, issues: broken };
  }

  const pageHash = sha256(finalContent);
  return { ok: true, artifacts: { wikiPath, pageHash } };
}

/**
 * Phase-5 plan (X): converts verify issues (with wikiPath, code, detail)
 * into ArtifactValidationError to feed the repair prompt. Keeps the
 * location "frontmatter" for `broken_anchor` and "body" for others.
 */
function verifyIssuesToValidationErrors(
  issues: ReadonlyArray<VerifyIssue>,
): ArtifactValidationError[] {
  return issues.map((i) => {
    const location =
      i.code === "broken_anchor" ? "frontmatter" : "body";
    return {
      code: "verify_failed",
      message: i.detail,
      location,
      ...(i.wikiPath ? { offending: i.wikiPath } : {}),
    };
  });
}

// === Stage 4 attempt abstraction ===

/**
 * Result of ONE LLM attempt (initial or repair) inside the bounded
 * stage 4 loop.
 */
interface Stage4AttemptResult {
  /**
   * `usageHistory` entry to record. ALWAYS present:
   *   - real usage if the LLM returned a result
   *   - zero-usage if the LLM call threw (network, 5xx, etc)
   */
  usageEntry: UsageAttempt;
  /**
   * Raw LLM output (or empty string if the call failed). Used to
   * pass to the repair prompt when the artifact is invalid.
   */
  normalizedRaw: string;
  /**
   * NORMALIZED and VALIDATED artifact. Null if the artifact is invalid.
   * If valid, it is the content to write.
   */
  artifact: string | null;
  /** Artifact validation errors (empty if artifact !== null). */
  validationErrors: ArtifactValidationError[];
  /** If the LLM call failed, the error lives here. */
  llmError: { code: string; message: string } | null;
}

interface AttemptOpts {
  attemptNumber: number;
  module: Module;
  language: Language;
  llmClient: LlmClient;
  charBudget: number;
  isRepair: boolean;
  priorCandidate: string;
  priorErrors: ArtifactValidationError[];
  absRoot: string;
  /**
   * Review finding #5: pricing override preserved in ALL calls
   * (incluindo repairs). Sem isso, repair cost seria calculado com a
   * embedded table, losing the user's override in `config.json`.
   */
  pricing: import("./pricing.js").PricingOverride | undefined;
  maxTokens: number;
  thinking?: "disabled" | "adaptive" | "omit" | undefined;
}

/**
 * Phase-5 plan (X): ONE LLM call. Loads context (symbols, source)
 * from the DB / filesystem, builds the prompt (initial or repair), calls the LLM,
 * registra usage real e normaliza/valida o artifact.
 *
 * The caller orchestrates the bounded loop; this function is "one turn of the loop".
 */
async function attemptStage4Generation(
  opts: AttemptOpts,
): Promise<Stage4AttemptResult> {
  // Load context (symbols + source) on each attempt. Repair prompts
  // need the same context (the closed list does not change between attempts —
  // unless the index changes, which would be out of batch scope).
  const ctx = await buildModuleDocContext(opts.absRoot, opts.module, opts.charBudget);

  // Build prompt
  let prompt: { system: string; user: string };
  if (opts.isRepair) {
    prompt = buildRepairPrompt(
      opts.module,
      ctx.closedKeyList,
      ctx.symbolsTable,
      ctx.truncatedSource,
      opts.priorCandidate,
      opts.priorErrors,
      opts.language,
    );
  } else {
    prompt = buildStage4Prompt(
      opts.module,
      ctx.closedKeyList,
      ctx.symbolsTable,
      ctx.truncatedSource,
      opts.language,
    );
  }

  // Call LLM
  let raw: string;
  let usage: { inputTokens: number; outputTokens: number; model: string };
  try {
    const result = await opts.llmClient.generate({
      system: prompt.system,
      user: prompt.user,
      maxTokens: opts.maxTokens,
      ...(opts.thinking ? { thinking: opts.thinking } : {}),
    });
    raw = result.content;
    usage = result.usage;
  } catch (err) {
    const e = err as Error;
    return {
      usageEntry: {
        attempt: opts.attemptNumber,
        usage: { inputTokens: 0, outputTokens: 0, model: "(no usage)" },
        costUsd: null,
        finishedAt: Date.now(),
      },
      normalizedRaw: "",
      artifact: null,
      validationErrors: [],
      llmError: { code: "llm_call_failed", message: e.message },
    };
  }

  // Cost — review finding #5: uses the config's pricing override so that
  // repairs are also calculated in the user's table (not just the
  // tabela embutida).
  const cost = computeCostFromUsage(usage, opts.pricing);

  // Normalize
  const normalize = normalizeStage4Artifact(raw);
  if (!normalize.ok) {
    return {
      usageEntry: {
        attempt: opts.attemptNumber,
        usage,
        costUsd: cost,
        finishedAt: Date.now(),
      },
      normalizedRaw: raw,
      artifact: null,
      validationErrors: normalize.errors,
      llmError: null,
    };
  }

  // Validate against closed key list
  const validation = validateStage4Artifact(normalize.content, ctx.closedKeyList);
  if (!validation.ok) {
    return {
      usageEntry: {
        attempt: opts.attemptNumber,
        usage,
        costUsd: cost,
        finishedAt: Date.now(),
      },
      normalizedRaw: raw,
      artifact: null,
      validationErrors: validation.errors,
      llmError: null,
    };
  }

  return {
    usageEntry: {
      attempt: opts.attemptNumber,
      usage,
      costUsd: cost,
      finishedAt: Date.now(),
    },
    normalizedRaw: raw,
    artifact: normalize.content,
    validationErrors: [],
    llmError: null,
  };
}

/**
 * Helper: computa o cost (USD) de um usage. Aplica o `override` do config
 * from the user when present, falling back to the embedded table if the model
 * not there. Review finding #5 — preserves the override in repairs.
 */
function computeCostFromUsage(
  usage: { inputTokens: number; outputTokens: number; model: string },
  override: import("./pricing.js").PricingOverride | undefined,
): ReturnType<typeof calculateCostUsd> {
  // Tries the override first; if the model has no price there, falls back to the table.
  if (override && usage.model in override) {
    return calculateCostUsd(usage.inputTokens, usage.outputTokens, usage.model, override);
  }
  const pricing = lookupPricing(usage.model);
  if (pricing === null) return null;
  return calculateCostUsd(usage.inputTokens, usage.outputTokens, usage.model, override);
}

interface ModuleDocContext {
  closedKeyList: string[];
  symbolsTable: string;
  truncatedSource: string;
}

async function buildModuleDocContext(
  absRoot: string,
  module: Module,
  charBudget: number,
): Promise<ModuleDocContext> {
  const db = openIndex(
    await safeIo.resolveAndValidate(absRoot, ".livewiki/index.db"),
  );
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
    const closedKeyList = symbols.map((s) => s.key).sort();
    const symbolsTable = symbols
      .map((s) => `- ${s.key} (${s.kind}): ${s.signature ?? ""}`)
      .join("\n");
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
    return { closedKeyList, symbolsTable, truncatedSource: src };
  } finally {
    db.close();
  }
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
  // FIX J (rev2): summary_json lives in batch_runs.summary_json — it is a
  // property of the RUN, not of a task. Here we load the refined modules
  // + the run aggregate (totals/byStage/byModule).
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
 * code that `batch status/resume/--only` already propagate — before fix (O),
 * init --batch always returned 0 even on completed_with_failures/aborted,
 * hiding systemic orchestrator failure behind an exit success.
 *
 * Use with `process.exitCode = statusToExitCode(status)` (not `process.exit`)
 * to preserve FIX L (rev2): let the event loop drain before exiting.
 */
export function statusToExitCode(
  status: BatchRunResult["status"],
): 0 | 1 | 2 {
  if (status === "completed") return 0;
  if (status === "completed_with_failures") return 1;
  return 2; // aborted
}
