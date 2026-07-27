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
 *
 * Stage 5 (Lot S3a, SPEC §"Semantic product-flow layer"): after the stage-4
 * loop and before the navigation hook, one gated task per detected flow
 * candidate (target "flow:<slug>"). Same machinery shape as stage 4 — bounded
 * repair slots, transactional write (page + companion diagram as one unit),
 * same circuit breaker and checkpoint semantics. The model emits the diagram
 * INLINE; the orchestrator extracts it, validates the placeholder-substituted
 * page, and writes both artifacts. Zero candidates is a valid outcome, not an
 * empty pipeline; maxFlows: 0 disables the stage entirely.
 */

import * as nodeFs from "node:fs/promises";
import * as nodePath from "node:path";
import * as safeIo from "./safe-io.js";
import { openIndex, type SymbolRow } from "./db.js";
import { run as runIndexer } from "./indexer.js";
import { run as runLedger } from "./anchor-ledger.js";
import { run as runVerify, type VerifyIssue, type VerifyResult } from "./verify.js";
import {
  identifyModulesHeuristic,
  resolveModuleEdges,
  prioritizeModules,
  makeUniqueDeterministicIds,
  splitOversizedModules,
  normalizeSplitLimits,
  assertExactPathPartition,
  refinePeerDirectoryFragmentationError,
  ExactPartitionError,
  assertUniqueModuleIds,
  DuplicateModuleIdError,
  applyRefinedDisplayTitles,
  classifyModuleRole,
  classifyPathRole,
  type Module,
} from "./modules.js";
import { collectImportsForFiles } from "./imports.js";
import { createLlmClient, LlmTimeoutError, type LlmClient } from "./llm/index.js";
import type { GenerateRequest, GenerateResult, StopReason } from "./llm/types.js";
import { loadConfig, applyDefaults, validateConfigForBatch, resolveExtraIgnores, CONFIG_DEFAULTS } from "./config.js";
import { calculateCostUsd, lookupPricing } from "./pricing.js";
import {
  buildStage2RefinePrompt,
  buildStage4Prompt,
  buildRepairPrompt,
  buildStage5Prompt,
  buildStage5RepairPrompt,
  buildTopicRefinePrompt,
  buildTopicPrompt,
  buildTopicRepairPrompt,
  buildSurgicalRepairPrompt,
  type FlowDiagramBudget,
  type Language,
  type ArtifactValidationError,
  type FlowKeyGroups,
} from "./prompts.js";
import {
  normalizeStage4Artifact,
  validateStage4Artifact,
  markDegradedArtifact,
} from "./artifact.js";
import {
  repairStage4ArtifactMechanically,
  repairUpperBoundArtifactMechanically,
  TOPIC_SECTION_HEADING_MAP,
  type MechanicalArtifactRepair,
} from "./artifact-repair.js";
import {
  collectUnclassified,
  formatUnrepairableMessage,
  isUnrepairableErrorSet,
} from "./repair-contract.js";
import {
  splitH2Sections,
  spliceSections,
  surgicalRepairTargetSections,
} from "./section-guard.js";
import { detectFlowCandidates, assignFlowKeySections, type FlowCandidate } from "./flows.js";
import {
  buildTopicPlanningInventory,
  validateTopicPlan,
  proposeTopicPlanDeterministically,
  assignTopicKeySections,
  renderTopicSourceSpan,
  TOPIC_SOURCE_SPAN_SEPARATOR,
  type TopicCandidate,
  type TopicPlanProposal,
  type TopicPlanValidationError,
} from "./topics.js";
import {
  renderRationaleEvidence,
  type RationaleEvidenceRow,
} from "./rationale-evidence.js";
import {
  loadEffectiveTsconfig,
  loadWorkspacePackages,
  resolveImportEdges,
} from "./import-resolution.js";
import { validateMermaidSyntax } from "./mermaid-validator.js";
import { computeSnapshotHash, writeManifestIfChanged, buildManifest } from "./manifest.js";
import { sha256 } from "./hashes.js";
import { regenerateArchitectureOverview, syncClassDiagrams, syncStaleFlowArtifacts, syncStaleTopicArtifacts } from "./init.js";
import { ensureTopicsIndexScaffold, extractModuleOpeningDigest, loadFlowPresentations, syncFlowsIndexHub } from "./navigation.js";
import { parseFrontmatter, getOwner } from "./frontmatter.js";
import { generateAuxiliaryModulePage } from "./auxiliary-page.js";
import { generateFlowDiagram, insertFlowDiagramSection } from "./flow-diagram.js";
import { computeCrossModuleCallees, computeCallerCentrality } from "./call-resolution.js";
import {
  computeDynamicOutputTokenBudget,
  MODULE_OUTPUT_BUDGET_OPTIONS,
  TOPIC_REFINE_OUTPUT_BUDGET_OPTIONS,
  type OutputBudgetSignals,
} from "./output-budget.js";
import type {
  BatchStage,
  BatchStatusReport,
  BatchRunSummary,
  DiagnosticAttempt,
  DiagnosticErrorSummary,
  DiagnosticOutcome,
  PendingBatchRef,
  StageUsage,
  TaskCheckpoint,
  UsageAttempt,
  ModuleUsage,
} from "./batch-state.js";
import {
  DIAGNOSTIC_MAX_ERRORS,
  DIAGNOSTIC_TEXT_CAP,
  summarizeDiagnosticErrors,
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
  /** Non-consuming retries for normalized incomplete responses (default 2). */
  maxIncompleteRetries?: number;
  /**
   * Recovery tier (Component 1): override of `surgicalRepair` (default =
   * config or true). When on, an eligible section-scoped repair error set
   * uses the surgical prompt + anti-cascade guard instead of the
   * full-context repair prompt.
   */
  surgicalRepair?: boolean;
  /**
   * Recovery tier (Component 2): override of `relaxedRound` (default =
   * config or true). When on, a strict loop that would mark
   * `repair_exhausted` gets ONE final attempt under the relaxed
   * presentation contract; success marks the task done with the page
   * flagged `quality: degraded`.
   */
  relaxedRound?: boolean;
  /**
   * D2: override of `concernTopics` (default = config or true). When on,
   * the deterministic topic planner may add at most one `deployment` and
   * one `testing` concern-grouped candidate after the import clusters.
   */
  concernTopics?: boolean;
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
  /**
   * Priority-0 fix: authoritative task counts across ALL stages (4 + 5
   * flows + 5 topics), taken directly from the same `cb.done`/`cb.fails`
   * counters `finalizeRun` persists. Previously callers approximated
   * "done" from `byModule.length` — a usage-tracking array that mixes
   * done+failed entries and, in `batch-status.ts`, was scoped to stage 4
   * only — which produced two different, both-wrong "done" counts for
   * the same run (e.g. 35 vs 32) depending on which surface printed it.
   */
  tasksDone: number;
  tasksFailed: number;
  /**
   * R10.1 C: the stage-5 flows hub was preserved because of ownership
   * (human/mixed or unparseable). Surfaced in the run result (human/JSON),
   * never persisted for status queries.
   */
  skippedFlowsHub?: { path: string; owner: "human" | "mixed" | null };
  /** R11-NAV: a protected auxiliary hub was preserved and not regenerated. */
  skippedAuxiliaryHub?: { path: string; owner: "human" | "mixed" | null };
  /** R11-A: a protected topic hub was preserved and not regenerated. */
  skippedTopicsHub?: { path: string; owner: "human" | "mixed" | null };
  /**
   * R10.1 K: flow candidates skipped deterministically BEFORE any LLM
   * call (K-a anchor capacity / K-b section-anchor coverage). No
   * batch_tasks row is ever created for them — the skip is recorded
   * here, surfaced in human/JSON output, never persisted.
   */
  skippedFlowCandidates?: Array<{ slug: string; code: string; message: string }>;
  /**
   * Priority-0 fix (v25 paid E2E): topics are an optional, additive semantic
   * layer on top of the required module/flow pages — unlike those, a
   * planner that exhausts every repair attempt without producing a plan
   * that satisfies every closed-list/budget constraint SIMULTANEOUSLY is a
   * content-quality ceiling for this run, not an operational failure. This
   * no longer marks the batch `completed_with_failures`; it is surfaced
   * here (human/JSON), retryable via `retryCommand`, and never silent. A
   * real infra error during planning (LLM timeout, etc.) still fails the
   * task normally — only the "exhausted, no valid plan" outcome is skipped.
   */
  skippedTopicPlan?: { reason: string; retryCommand: string };
  /**
   * Recovery tier (Component 2): wiki paths of pages completed under the
   * relaxed contract (`quality: degraded` frontmatter flag + reader
   * notice). Degraded tasks are DONE — they never flow through the failure
   * counters, so a degraded-only run stays `completed` (exit 0). Surfaced
   * here (human/JSON) and persisted in `batch_runs.summary_json`;
   * `livewiki status` recounts them fresh from disk.
   */
  degradedPages?: string[];
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

    // Single source of truth for configured `ignores` (relative gitignore
    // patterns). The batch NEVER exposes a programmatic override of the
    // configured ignores — a caller cannot bypass repository
    // configuration. The walker applies these in stage 1 (and the
    // `.gitignore` and built-in defaults).
    //
    // Resume (`mode === "resume"`) and `--only` do NOT rescan: they
    // operate on the existing run snapshot (SQLite index + checkpoints).
    // A configured ignored path cannot re-enter via resume; it was
    // already excluded when the original run's stage-1 indexer walked
    // the repo. `configuredExtraIgnores` is therefore only forwarded to
    // `runIndexer` on the `mode === "run"` path below.
    const configuredExtraIgnores = resolveExtraIgnores(config);

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
    const maxIncompleteRetries =
      opts.maxIncompleteRetries ?? resolvedConfig.maxIncompleteRetries ?? 2;
    if (
      typeof maxIncompleteRetries !== "number" ||
      !Number.isInteger(maxIncompleteRetries) ||
      maxIncompleteRetries < 0
    ) {
      throw new Error(
        `invalid maxIncompleteRetries: must be a non-negative integer, got ${JSON.stringify(maxIncompleteRetries)}`,
      );
    }
    // Recovery tier (Component 1): surgical repair toggle
    // (opts > config > default true).
    const surgicalRepair =
      opts.surgicalRepair ?? resolvedConfig.surgicalRepair ?? true;
    // Recovery tier (Component 2): relaxed completion round toggle
    // (opts > config > default true).
    const relaxedRound =
      opts.relaxedRound ?? resolvedConfig.relaxedRound ?? true;
    // D2: concern-grouped topic candidates toggle (opts > config > default true).
    const concernTopics =
      opts.concernTopics ?? resolvedConfig.concernTopics ?? true;
    const stage4MaxOutputTokens =
      opts.stage4MaxOutputTokens ??
      resolvedConfig.stage4MaxOutputTokens ??
      8192;
    const outputTokenStrategy: "dynamic" | "fixed" =
      resolvedConfig.outputTokenStrategy ?? "dynamic";
    const charBudget = opts.contextCharBudget ?? 60_000;
    // Etapa 2b: bounded rationale evidence block, carved inside charBudget.
    const rationaleMaxChars =
      resolvedConfig.rationaleMaxChars ?? CONFIG_DEFAULTS.rationaleMaxChars;
    const thinkingMode = opts.thinking ?? resolvedConfig.thinking;
    const { maxFiles: maxModuleFiles, maxSymbols: maxModuleSymbols } =
      normalizeSplitLimits(
        opts.maxModuleFiles ?? resolvedConfig.maxModuleFiles,
        opts.maxModuleSymbols ?? resolvedConfig.maxModuleSymbols,
      );

    // Create LLM client if not injected. Stage 4 (and --only) always need it.
    // --no-refine only skips stage-2 refinement; it must NOT skip client
    // creation or stage 4 runs without an LLM and fails every doc task.
    let llmClient = opts.llmClient;
    const needsLlm =
      opts.mode === "only" ||
      opts.mode === "run" ||
      opts.mode === "resume" ||
      !opts.noRefine;
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
        contextCharBudget: charBudget,
        maxRepairAttempts,
        maxIncompleteRetries,
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
      // Forward the configured `ignores` to the walker so a fresh
      // `livewiki batch` (without prior `init`) still respects
      // `.livewiki/config.json` `ignores`. Same semantics as
      // `livewiki index` and `livewiki init`.
      await runIndexer(absRoot, {
        ...(configuredExtraIgnores.length > 0
          ? { extraIgnores: configuredExtraIgnores }
          : {}),
        quiet: true,
      });
      await runLedger(absRoot, { quiet: true });
    }

    // Load active symbols + file paths (cache)
    const symbols = db
      .prepare("SELECT * FROM symbols WHERE status = 'active'")
      .all() as SymbolRow[];
    // Planning inventory contract (shared with init.ts:buildPlan): the
    // set of active indexed files (`files.status = 'active'`) is the
    // single source of truth. The indexer inserts an `active` files row
    // before any of its symbols, so every active symbol is guaranteed
    // to point at a file in this set. Re-export-only barrels and any
    // other active file with zero extracted symbols appear here with
    // symbolCount=0. Deleted file rows stay excluded.
    const activeFileRows = db
      .prepare("SELECT path FROM files WHERE status = 'active'")
      .all() as Array<{ path: string }>;
    const filePaths = [...new Set(activeFileRows.map((row) => row.path))].sort();
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
            usageKnown: true,
            costUsd: cost,
            finishedAt: Date.now(),
          });
          // FIX I + T0 exact partition: validate refined BEFORE accepting.
          // Inventory is the indexed filePaths (not a post-refine subset).
          // Rejects missing/duplicate/unknown paths, empty modules, peer
          // fragmentation. On any rejection: keep full heuristic, do not abort.
          const indexedInventory = new Set(
            filePaths.map((p) =>
              p.includes("\\") ? p.replace(/\\/g, "/") : p,
            ),
          );
          const validation = validateRefinedModules(
            result.content,
            indexedInventory,
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
      // T0 plan W gate:
      // 1) Unique IDs first (src → core-src / cli-src / …) so split prefixes are stable.
      // 2) Structural + dual-axis split (true subdirs, then ordinal chunks).
      // 3) Exact path partition vs original indexed filePaths (never a
      //    post-refine subset — incomplete refine is rejected earlier).
      // 4) Unique again for chunk ordinals / collisions.
      // Splitting BEFORE uniqueness made every packages/*/src leaf keep id "src"
      // and explode into src-<file> pages (bad A/B v2 run).
      modules = makeUniqueDeterministicIds(modules);
      modules = splitOversizedModules(modules, {
        maxFiles: maxModuleFiles,
        maxSymbols: maxModuleSymbols,
        symbolCountByPath,
      });
      assertExactPathPartition(modules, filePaths);
      modules = makeUniqueDeterministicIds(modules);
      assertUniqueModuleIds(modules);
    } catch (err) {
      const dupErr = err as DuplicateModuleIdError | ExactPartitionError;
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
    // Hoisted for stage 5: the flow detector re-derives external import
    // specifiers from the SAME per-file extraction stage 3 uses for edges.
    const importsByFile = await collectImportsForFiles(absRoot, filePaths);
    const knownFiles = new Set(filePaths);
    // R10.1 (J): ONE resolver produces the file-level import edges —
    // relative AND declared-workspace specifiers. The same resolved edges
    // feed the module-edge projection below and the flow detector's
    // per-occurrence external accounting in stage 5.
    const workspacePackages = await loadWorkspacePackages(absRoot);
    const resolvedImportEdges = resolveImportEdges({
      importsByFile,
      knownFiles,
      workspacePackages,
      tsconfig: await loadEffectiveTsconfig(absRoot, workspacePackages),
    });
    const edges = resolveModuleEdges(modules, importsByFile, knownFiles, resolvedImportEdges);
    let ordered = prioritizeModules(modules, edges, resolvedConfig.pathRoles);

    // Defense in depth: prioritization does not change IDs, but re-applying W ensures
    // that any new path that entered ordered (it shouldn't, but
    // for safety) still passes the filter.
    ordered = makeUniqueDeterministicIds(ordered);
    assertUniqueModuleIds(ordered);

    // === Stage 4: Coordinated documentation ===
    const cb = { consecutive: 0, fails: 0, done: 0 };
    // Stage-4-only done counter for the pendingBatch stage split
    // (cb.done counts stages 4 + 5 combined once stage 5 runs).
    let moduleTasksDone = 0;
    const failures: BatchRunResult["failures"] = [];
    // Recovery tier (Component 2): wiki paths of pages completed under the
    // relaxed contract this run. Surfaced in the result and persisted in
    // the run summary; degraded tasks count as done, never as failures.
    const degradedPages: string[] = [];
    // Recovery tier (Component 2): attach the run's degraded pages to a
    // result only when non-empty (additive field, same surfacing pattern
    // as skippedFlowCandidates).
    const withDegraded = (result: BatchRunResult): BatchRunResult => {
      if (degradedPages.length > 0) result.degradedPages = [...degradedPages];
      return result;
    };
    // Priority-0 fix (v-next paid E2E on MoneyPrinterTurbo-Plus): a flow
    // candidate spanning a module whose own stage-4 page failed to write
    // is a guaranteed, retry-proof verify failure (its "Related pages"
    // link points at a module page that was never written). Tracked here
    // so stage 5 can skip such candidates deterministically instead of
    // burning a full LLM repair budget on an unwinnable verify.
    const failedModuleIds = new Set<string>();
    const moduleUsage: BatchRunResult["byModule"] = [];
    const stage2UsageAcc: StageUsage = emptyUsage();
    let stageUsageTotals: StageUsage = emptyUsage();
    const byStageAcc: Record<string, StageUsage> = {};

    // Stage 5: `--only flow:<slug>` targets a flow task, not a module.
    const onlyFlowSlug =
      opts.onlyTarget !== undefined && opts.onlyTarget.startsWith("flow:")
        ? opts.onlyTarget.slice("flow:".length)
        : null;
    const onlyTopicIdentity =
      opts.onlyTarget !== undefined && opts.onlyTarget.startsWith("topic:")
        ? opts.onlyTarget.slice("topic:".length)
        : null;
    const tasksToRun = opts.onlyTarget
      ? onlyFlowSlug !== null || onlyTopicIdentity !== null
        ? []
        : ordered.filter((m) => m.id === opts.onlyTarget)
      : ordered;

    if (opts.onlyTarget && onlyFlowSlug === null && onlyTopicIdentity === null && tasksToRun.length === 0) {
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

    // Class diagrams are a deterministic projection of the complete final
    // module plan. Synchronize before stage 4 so obsolete files from an older
    // plan cannot survive and fail the repository-wide verify step.
    await syncClassDiagrams(absRoot, ordered, symbols);

    // Accumulate stage 2 usage (if it already ran) for final byStage
    if (stage2Task) {
      const cp2 = stage2Task.checkpoint_json ? safeJsonParse<TaskCheckpoint>(stage2Task.checkpoint_json) : null;
      if (cp2?.usageHistory) {
        let cost: number | null = 0;
        const models = new Set<string>();
        for (const a of cp2.usageHistory) {
          if (a.usageKnown === false || a.usage === null) {
            stage2UsageAcc.usageIncomplete = true;
            continue;
          }
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
      let diagnosticHistory: DiagnosticAttempt[] = [];
      let taskError: TaskCheckpoint["error"] | undefined;
      let artifacts: TaskCheckpoint["artifacts"] | undefined;
      // Recovery tier (Component 2): set when this task completed via the
      // relaxed completion round (checkpoint flag + degradedPages entry).
      let degraded = false;
      const prevCheckpoint = task.checkpoint_json ? safeJsonParse<TaskCheckpoint>(task.checkpoint_json) : null;
      if (prevCheckpoint?.usageHistory) {
        usageHistory = [...prevCheckpoint.usageHistory];
      }
      if (prevCheckpoint?.diagnosticHistory) {
        diagnosticHistory = [...prevCheckpoint.diagnosticHistory];
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
      } else if (classifyModuleRole(module, resolvedConfig.pathRoles) !== "product") {
        // Priority-0 fix: auxiliary modules (fixture/tooling/docs) never
        // call the LLM. Their page contract is fully mechanical (fixed H2
        // set, one H3 + one marker + one short paragraph per symbol), so the
        // orchestrator assembles it directly — zero cost, zero probabilistic
        // failure. `usageHistory` stays empty for this task, same convention
        // as a skipped `--no-refine` call: no attempt was made, so no entry
        // is recorded (never an invented 0/0 usage row).
        const auxiliaryRole = classifyModuleRole(module, resolvedConfig.pathRoles) as Exclude<
          ReturnType<typeof classifyModuleRole>,
          "product"
        >;
        const symbols = await getModuleSymbolRows(absRoot, module);
        const closedKeyList = symbols.map((s) => s.key).sort();
        const artifact = generateAuxiliaryModulePage({
          module,
          role: auxiliaryRole,
          symbols,
          closedKeyList,
        });
        const selfCheck = validateStage4Artifact(artifact, closedKeyList, {
          moduleId: module.id,
          moduleRole: auxiliaryRole,
        });
        if (selfCheck.ok) {
          const writeResult = await tryWriteAndVerify(absRoot, wikiPath, artifact, existing);
          if (writeResult.ok) {
            artifacts = writeResult.artifacts;
          } else if (writeResult.rollbackFailed) {
            taskError = {
              code: "rollback_failed",
              message:
                `rollback failed after verify rejection for ${wikiPath}: ${writeResult.rollbackFailed.reason}. ` +
                `This is a terminal state for the ENTIRE run — the disk may have an inconsistent page. ` +
                `Operator must inspect ${wikiPath} and re-run with --only after manual repair.`,
            };
            runAbortedByRollback = true;
          } else {
            taskError = {
              code: "auxiliary_page_verify_failed",
              message:
                `deterministic auxiliary page for "${module.id}" failed verify: ` +
                `${(writeResult.issues ?? []).map((i) => i.code).join(", ")}. Not model-repairable — ` +
                `this indicates a bug in the deterministic generator, not a retry-able condition.`,
              failedAt: 4,
            };
          }
        } else {
          taskError = {
            code: "auxiliary_page_validation_failed",
            message:
              `deterministic auxiliary page for "${module.id}" failed artifact validation: ` +
              `${selfCheck.errors.map((e) => e.code).join(", ")}. Not model-repairable — ` +
              `this indicates a bug in the deterministic generator, not a retry-able condition.`,
            failedAt: 4,
          };
        }
      } else {
        // Bounded slots: one initial slot plus maxRepairAttempts repair slots.
        // Normalized incomplete responses may retry fresh without consuming a
        // slot while their separate per-task budget remains.
        const totalConsumedSlots = 1 + maxRepairAttempts;
        let consumedSlots = 0;
        let incompleteRetriesUsed = 0;
        let attemptDone = false;
        let priorCandidate = "";
        let priorErrors: ArtifactValidationError[] = [];
        let lastErrorsForReporting: ArtifactValidationError[] = [];
        let nextPromptKind: "initial" | "repair" = "initial";
        // B1: capture the start of THIS loop's slice into
        // `diagnosticHistory` so the eventual `repair_exhausted`
        // message is built only from the new attempts in this loop
        // (not from the seeded history of prior runs/--only calls).
        const diagnosticSliceStart = diagnosticHistory.length;

        while (consumedSlots < totalConsumedSlots) {
          attempt++;
          const promptKind = nextPromptKind;
          // `attemptNumber` is the GLOBAL COUNTER (persisted via
          // `task.attempt`, incremented every attempt), so
          // usageHistory[].attempt is monotonic across multiple
          // --only / resume calls.
          //
          // Repair attempt index: the 1st repair is the 2nd LLM
          // call; `consumedSlots` advances per consumed slot, so
          // the 1st repair call sees consumedSlots=1. The budget is
          // `maxRepairAttempts`; the prompt derives final-attempt
          // from `attempt >= total` so callers cannot contradict
          // the numbers.
          const repairAttemptContext =
            promptKind === "repair"
              ? { attempt: consumedSlots, total: maxRepairAttempts }
              : undefined;
          const attemptResult = await attemptStage4Generation({
            attemptNumber: attempt,
            module,
            language,
            llmClient: llmClient!,
            charBudget,
            rationaleMaxChars,
            promptKind,
            priorCandidate,
            priorErrors,
            absRoot,
            // Pricing override preserved across repairs so the
            // user's `config.json` is honored for every call.
            pricing: resolvedConfig.pricing,
            outputTokenCeiling: stage4MaxOutputTokens,
            outputTokenStrategy,
            thinking: thinkingMode,
            pathRoleConfig: resolvedConfig.pathRoles,
            surgicalRepair,
            // A local fallback is allowed only after the model has consumed
            // the final configured repair slot. It never adds or replaces an
            // LLM call and still must pass the complete artifact validator.
            allowMechanicalFallback:
              promptKind === "repair" && consumedSlots === totalConsumedSlots - 1,
            ...(repairAttemptContext !== undefined
              ? { repairAttemptContext }
              : {}),
          });
          usageHistory.push(attemptResult.usageEntry);
          moduleUsageEntry = accumulateUsage(
            moduleUsageEntry,
            attemptResult.usageEntry,
            resolvedConfig.pricing,
          );
          stageUsageTotals = accumulateUsage(
            stageUsageTotals,
            attemptResult.usageEntry,
            resolvedConfig.pricing,
          );

          if (attemptResult.llmError) {
            consumedSlots++;
            diagnosticHistory.push(
              diagnosticAttempt({
                attemptResult,
                promptKind,
                outcome: "llm_error",
                errors: summarizeLlmDiagnosticError(attemptResult.llmError),
              }),
            );
            // Client timeout: terminal for this task — no repair, no second
            // generation (provider state unknown; may still bill).
            if (attemptResult.llmError.code === "llm_timeout") {
              taskError = {
                code: "llm_timeout",
                message: attemptResult.llmError.message,
                failedAt: 4,
              };
              attemptDone = true;
              break;
            }
            // Other LLM failures (network, 5xx, etc): record and allow
            // another attempt within the bounded loop when attempts remain.
            lastErrorsForReporting = [
              {
                code: "llm_error",
                message: attemptResult.llmError.message,
                location: "global",
              },
            ];
            priorCandidate = "";
            priorErrors = [];
            nextPromptKind = "initial";
            continue;
          }

          if (attemptResult.artifact === null) {
            const outcome = attemptResult.diagnosticOutcome!;
            const retryWithoutConsumingSlot =
              outcome === "incomplete_generation" &&
              incompleteRetriesUsed < maxIncompleteRetries;
            if (retryWithoutConsumingSlot) {
              incompleteRetriesUsed++;
            } else {
              consumedSlots++;
            }
            lastErrorsForReporting = attemptResult.validationErrors;
            diagnosticHistory.push(
              diagnosticAttempt({
                attemptResult,
                promptKind,
                outcome,
                errors: summarizeDiagnosticErrors(attemptResult.validationErrors),
                ...(retryWithoutConsumingSlot ? { budgetConsumed: false } : {}),
              }),
            );
            if (
              outcome === "incomplete_generation" ||
              outcome === "truncated_by_token_limit"
            ) {
              priorCandidate = "";
              priorErrors = [];
              nextPromptKind = "initial";
            } else {
              // Only the immediately previous completed-but-invalid candidate
              // may become the next repair input.
              const candidate = attemptResult.normalizedRaw;
              if (candidate.length > charBudget) {
                priorCandidate = "";
                priorErrors = [];
                nextPromptKind = "initial";
              } else if (isUnrepairableErrorSet("module", attemptResult.validationErrors)) {
                // Etapa 2a early abort: every error in the set is
                // unclassified for module pages — no supported repair
                // exists, so fail WITHOUT burning a paid repair call.
                taskError = {
                  code: "unrepairable",
                  message: formatUnrepairableMessage("module", module.id, attemptResult.validationErrors),
                  failedAt: 4,
                };
                attemptDone = true;
                break;
              } else {
                priorCandidate = candidate;
                priorErrors = attemptResult.validationErrors;
                nextPromptKind = "repair";
              }
            }
            continue;
          }

          // Valid artifact → try write + verify
          consumedSlots++;
          const writeResult = await tryWriteAndVerify(
            absRoot,
            wikiPath,
            attemptResult.artifact,
            existing,
          );
          if (writeResult.ok) {
            diagnosticHistory.push(
              diagnosticAttempt({
                attemptResult,
                promptKind,
                outcome: "success",
                errors: { errors: [], truncatedErrorCount: 0 },
              }),
            );
            // SUCCESS — task done. Does NOT increment cb.fails.
            attemptDone = true;
            artifacts = writeResult.artifacts;
            break;
          } else if (writeResult.rollbackFailed) {
            diagnosticHistory.push(
              diagnosticAttempt({
                attemptResult,
                promptKind,
                outcome: "verify_failed",
                errors: summarizeVerifyDiagnosticErrors(writeResult.issues ?? []),
              }),
            );
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
          } else if (writeResult.exception) {
            diagnosticHistory.push(
              diagnosticAttempt({
                attemptResult,
                promptKind,
                outcome: "write_verify_exception",
                errors: summarizeLlmDiagnosticError({
                  code: "write_verify_exception",
                  message: writeResult.exception.message,
                }),
              }),
            );
            // R10.1 item A: the write/verify step threw and the page was
            // already rolled back inside tryWriteAndVerify. Not model-
            // repairable (a failed write or a verifier crash recurs
            // deterministically), so the task fails WITHOUT burning repair
            // slots; the RUN continues (circuit breaker still applies).
            taskError = {
              code: "write_verify_exception",
              message:
                `write/verify step threw for ${wikiPath}: ${writeResult.exception.message}. ` +
                `The candidate was rolled back; no repair retry because the failure is not model-fixable.`,
              failedAt: 4,
            };
            attemptDone = true;
            break;
          } else {
            diagnosticHistory.push(
              diagnosticAttempt({
                attemptResult,
                promptKind,
                outcome: "verify_failed",
                errors: summarizeVerifyDiagnosticErrors(writeResult.issues ?? []),
              }),
            );
            // Verify failed → restore/remove the candidate (already done inside
            // tryWriteAndVerify). Prepare a repair only when the rejected
            // candidate fits the shared stage-4 character budget.
            const candidate = attemptResult.artifact;
            const repairErrors = verifyIssuesToValidationErrors(writeResult.issues ?? []);
            lastErrorsForReporting = repairErrors;
            if (candidate.length > charBudget) {
              priorCandidate = "";
              priorErrors = [];
              nextPromptKind = "initial";
            } else if (isUnrepairableErrorSet("module", repairErrors)) {
              // Etapa 2a early abort: e.g. a verify set that is only
              // `manual_block_altered` (rule #6 — human content is never
              // model-repaired). Fail WITHOUT burning a paid repair call.
              taskError = {
                code: "unrepairable",
                message: formatUnrepairableMessage("module", module.id, repairErrors),
                failedAt: 4,
              };
              attemptDone = true;
              break;
            } else {
              priorCandidate = candidate;
              priorErrors = repairErrors;
              nextPromptKind = "repair";
            }
            continue;
          }
        }

        // Recovery tier (Component 2): ONE relaxed completion attempt when
        // the strict loop exhausted on a contract-shaped failure (never on
        // infra failures — those set taskError above — and never on error
        // sets containing unclassified codes). Same attempt helper with
        // `promptKind: "initial"` under the relaxed validation contract;
        // success marks the task DONE with the page flagged degraded
        // (exit code untouched), failure keeps the original
        // repair_exhausted path below, byte-for-byte unchanged.
        if (!attemptDone && !taskError && relaxedRound && isRelaxedEligible("module", lastErrorsForReporting)) {
          attempt++;
          const relaxedResult = await attemptStage4Generation({
            attemptNumber: attempt,
            module,
            language,
            llmClient: llmClient!,
            charBudget,
            rationaleMaxChars,
            promptKind: "initial",
            priorCandidate: "",
            priorErrors: [],
            absRoot,
            pricing: resolvedConfig.pricing,
            outputTokenCeiling: stage4MaxOutputTokens,
            outputTokenStrategy,
            thinking: thinkingMode,
            pathRoleConfig: resolvedConfig.pathRoles,
            surgicalRepair: false,
            allowMechanicalFallback: false,
            relaxed: true,
          });
          relaxedResult.relaxedAttempt = true;
          usageHistory.push(relaxedResult.usageEntry);
          moduleUsageEntry = accumulateUsage(
            moduleUsageEntry,
            relaxedResult.usageEntry,
            resolvedConfig.pricing,
          );
          stageUsageTotals = accumulateUsage(
            stageUsageTotals,
            relaxedResult.usageEntry,
            resolvedConfig.pricing,
          );
          if (relaxedResult.llmError) {
            diagnosticHistory.push(
              diagnosticAttempt({
                attemptResult: relaxedResult,
                promptKind: "initial",
                outcome: "llm_error",
                errors: summarizeLlmDiagnosticError(relaxedResult.llmError),
              }),
            );
          } else if (relaxedResult.artifact === null) {
            diagnosticHistory.push(
              diagnosticAttempt({
                attemptResult: relaxedResult,
                promptKind: "initial",
                outcome: relaxedResult.diagnosticOutcome!,
                errors: summarizeDiagnosticErrors(relaxedResult.validationErrors),
              }),
            );
          } else {
            const writeResult = await tryWriteAndVerify(
              absRoot,
              wikiPath,
              relaxedResult.artifact,
              existing,
            );
            if (writeResult.ok) {
              diagnosticHistory.push(
                diagnosticAttempt({
                  attemptResult: relaxedResult,
                  promptKind: "initial",
                  outcome: "success",
                  errors: { errors: [], truncatedErrorCount: 0 },
                }),
              );
              attemptDone = true;
              artifacts = writeResult.artifacts;
              degraded = true;
            } else if (writeResult.rollbackFailed) {
              diagnosticHistory.push(
                diagnosticAttempt({
                  attemptResult: relaxedResult,
                  promptKind: "initial",
                  outcome: "verify_failed",
                  errors: summarizeVerifyDiagnosticErrors(writeResult.issues ?? []),
                }),
              );
              // Same terminal semantics as the strict path: disk may be
              // inconsistent — the whole run aborts.
              taskError = {
                code: "rollback_failed",
                message:
                  `rollback failed after verify rejection for ${wikiPath}: ${writeResult.rollbackFailed.reason}. ` +
                  `This is a terminal state for the ENTIRE run — the disk may have an inconsistent page. ` +
                  `Operator must inspect ${wikiPath} and re-run with --only after manual repair.`,
              };
              attemptDone = true;
              runAbortedByRollback = true;
            } else if (writeResult.exception) {
              diagnosticHistory.push(
                diagnosticAttempt({
                  attemptResult: relaxedResult,
                  promptKind: "initial",
                  outcome: "write_verify_exception",
                  errors: summarizeLlmDiagnosticError({
                    code: "write_verify_exception",
                    message: writeResult.exception.message,
                  }),
                }),
              );
              // Not model-fixable — same short-circuit as the strict path.
              taskError = {
                code: "write_verify_exception",
                message:
                  `write/verify step threw for ${wikiPath}: ${writeResult.exception.message}. ` +
                  `The candidate was rolled back; no repair retry because the failure is not model-fixable.`,
                failedAt: 4,
              };
              attemptDone = true;
            } else {
              diagnosticHistory.push(
                diagnosticAttempt({
                  attemptResult: relaxedResult,
                  promptKind: "initial",
                  outcome: "verify_failed",
                  errors: summarizeVerifyDiagnosticErrors(writeResult.issues ?? []),
                }),
              );
              // Verify NEVER relaxes — the original repair_exhausted path
              // below is unchanged.
            }
          }
        }

        if (!attemptDone && !taskError) {
          // B1 (Lot B): repair_exhausted is built from the
          // `diagnosticHistory` slice for THIS bounded loop, not from
          // the last attempt alone. We surface one compact ordered
          // line per attempt (`attempt N: <stopReason|-> -> <outcome>
          // [codes...]`) plus real totals (sum of errors.length +
          // truncatedErrorCount across this loop's attempts). This
          // replaces the v9 misreport that hid completed-but-invalid
          // attempts behind a misleading `Last diagnostic` line. The
          // `code` stays `"repair_exhausted"` and the `failedAt: 4`
          // retry-hint behavior is preserved (set when the last
          // reported error carried a sectionSlug).
          const thisLoopDiagnostics = diagnosticHistory.slice(diagnosticSliceStart);
          const attemptLines = thisLoopDiagnostics.map((d) => {
            const stopReason = d.stopReason ?? "-";
            const codes = d.errors.map((e) => e.code);
            return `attempt ${d.attempt}: ${stopReason} -> ${d.outcome}` +
              (codes.length > 0 ? ` [${codes.join(", ")}]` : "");
          });
          const totalErrors = thisLoopDiagnostics.reduce(
            (sum, d) => sum + d.errors.length + d.truncatedErrorCount,
            0,
          );
          taskError = {
            code: "repair_exhausted",
            message:
              `task "${module.id}" exhausted ${thisLoopDiagnostics.length} LLM call(s) without producing a verified artifact.\n` +
              `Attempts:\n${attemptLines.join("\n")}\n` +
              `Total errors recorded: ${totalErrors}.`,
            ...(lastErrorsForReporting[0]?.sectionSlug ? { failedAt: 4 } : {}),
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
          diagnosticHistory,
          error: taskError,
        };
        db.prepare(
          "UPDATE batch_tasks SET status = ?, checkpoint_json = ?, updated_at = ? WHERE id = ?",
        ).run("failed", JSON.stringify(failCheckpoint), Date.now(), task.id);

        cb.consecutive++;
        cb.fails++;
        failedModuleIds.add(module.id);
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
          diagnosticHistory,
          ...(artifacts ? { artifacts } : {}),
          ...(degraded ? { degraded: true } : {}),
        };
        db.prepare(
          "UPDATE batch_tasks SET status = ?, checkpoint_json = ?, updated_at = ? WHERE id = ?",
        ).run("done", JSON.stringify(okCheckpoint), Date.now(), task.id);

        cb.consecutive = 0;
        cb.done++;
        moduleTasksDone++;
        if (degraded) degradedPages.push(wikiPath);
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
          modulesRefined: modules.map((m) => ({
            id: m.id,
            paths: m.paths,
            ...(m.displayTitle ? { displayTitle: m.displayTitle } : {}),
          })),
          tasksDone: cb.done,
          tasksFailed: cb.fails,
          degradedPages,
        });
        return withDegraded(buildResult(runId, "aborted", stageUsageTotals, moduleUsage, failures, true, cb.done, cb.fails));
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
          modulesRefined: modules.map((m) => ({
            id: m.id,
            paths: m.paths,
            ...(m.displayTitle ? { displayTitle: m.displayTitle } : {}),
          })),
          tasksDone: cb.done,
          tasksFailed: cb.fails,
          degradedPages,
        });
        return withDegraded(buildResult(runId, "aborted", stageUsageTotals, moduleUsage, failures, false, cb.done, cb.fails));
      }
    }
    byStageAcc["4"] = stageUsageTotals;
    // === Stage 5: semantic product flows (SPEC §"Semantic product-flow layer") ===
    // One gated task per detected flow candidate, after stage 4 and before
    // the post-stage navigation hook. Same machinery shape as stage 4:
    // bounded repair slots, transactional write with rollback, the same
    // circuit breaker, and identical checkpoint semantics. Zero candidates
    // is a valid outcome (no stage-5 tasks, NOT an empty pipeline).
    const maxFlows = resolvedConfig.maxFlows ?? 0;
    let stage5UsageTotals: StageUsage = emptyUsage();
    let stage5TaskCount = 0;
    let stage5Done = 0;
    let stage5Fails = 0;
    let stage5Candidates: FlowCandidate[] = [];
    const stage5GateOpen =
      maxFlows > 0 &&
      !runAbortedByRollback &&
      (opts.mode !== "only" || onlyFlowSlug !== null);

    if (stage5GateOpen) {
      // Detection inputs: the active symbols already loaded for stage 4,
      // the final module plan + edges from stage 3, and external import
      // specifiers derived from the same per-file imports stage 3 used
      // for resolveModuleEdges (walker-style relative paths).
      const symbolsByFile = new Map<string, string[]>();
      for (const s of symbols) {
        const file = s.key.split("#")[0]!;
        const list = symbolsByFile.get(file);
        if (list) list.push(s.key);
        else symbolsByFile.set(file, [s.key]);
      }
      // Per-occurrence external accounting (R10.1 J): an occurrence
      // (file, specifier) with a resolved internal edge is excluded —
      // the same specifier may be internal in one file and external in
      // another. The detector also receives the edges for its own filter.
      const resolvedOccurrences = new Set(
        resolvedImportEdges.map((e) => `${e.fromFile}\0${e.source}`),
      );
      const externalImportsByFile = new Map<string, string[]>();
      for (const [file, fileImports] of importsByFile) {
        externalImportsByFile.set(
          file,
          fileImports
            .map((i) => i.source)
            .filter((source) => !resolvedOccurrences.has(`${file}\0${source}`)),
        );
      }
      // Priority-0 Phase 3: symbol keys with a call graph edge PROVING a
      // cross-module dependency, only used by detectFlowCandidates to
      // break ties within the T2 (crossing) seed-key group — additive,
      // never changes which flows are detected.
      const resolvedCrossModuleCallees = computeCrossModuleCallees(db, ordered);
      stage5Candidates = detectFlowCandidates({
        modules: ordered,
        edges,
        symbolsByFile,
        externalImportsByFile,
        resolvedEdges: resolvedImportEdges,
        ...(resolvedConfig.pathRoles !== undefined
          ? { pathRoleConfig: resolvedConfig.pathRoles }
          : {}),
        ...(resolvedConfig.flowSignals !== undefined
          ? { flowSignals: resolvedConfig.flowSignals }
          : {}),
        maxFlows,
        flowMaxAnchors: resolvedConfig.flowMaxAnchors ?? CONFIG_DEFAULTS.flowMaxAnchors,
        flowMaxOverlap: resolvedConfig.flowMaxOverlap ?? CONFIG_DEFAULTS.flowMaxOverlap,
        resolvedCrossModuleCallees,
      });
    }

    let stage5Targets: FlowCandidate[] = [];
    if (stage5GateOpen) {
      if (opts.mode === "only") {
        // --only flow:<slug>: recompute detection the same way and rerun
        // exactly one flow task; unknown slug = same behavior as modules.
        const found = stage5Candidates.find((c) => c.slug === onlyFlowSlug);
        if (!found) {
          throw new Error(`flow "${onlyFlowSlug}" not found in this run`);
        }
        stage5Targets = [found];
      } else {
        stage5Targets = stage5Candidates;
      }
    }

    const flowDiagramBudgets: FlowDiagramBudget = {
      maxNodes: resolvedConfig.flowMaxDiagramNodes ?? CONFIG_DEFAULTS.flowMaxDiagramNodes,
      maxEdges: resolvedConfig.flowMaxDiagramEdges ?? CONFIG_DEFAULTS.flowMaxDiagramEdges,
    };

    // R10.1 K: deterministic pre-LLM skips (K-a/K-b) never become
    // tasks — no batch_tasks row is created; the skip is recorded on
    // the run result (same "never silent, never persisted" contract
    // as the R10.1 C flows-hub skip).
    const skippedFlowCandidates: NonNullable<BatchRunResult["skippedFlowCandidates"]> = [];
    const stage5Runnable: FlowCandidate[] = [];
    for (const candidate of stage5Targets) {
      const failedParticipant = candidate.moduleIds.find((id) => failedModuleIds.has(id));
      if (candidate.skip !== undefined) {
        skippedFlowCandidates.push({
          slug: candidate.slug,
          code: candidate.skip.code,
          message: candidate.skip.message,
        });
      } else if (failedParticipant !== undefined) {
        // Priority-0 fix: this candidate spans a module whose stage-4 page
        // never got written — its "Related pages" link would cite a page
        // that does not exist, so every attempt fails `verify` identically
        // regardless of retries. Skip deterministically instead of
        // spending the full LLM repair budget on a guaranteed failure.
        skippedFlowCandidates.push({
          slug: candidate.slug,
          code: "participating_module_failed",
          message: `module "${failedParticipant}" failed stage-4 generation — its page was never written, so this flow's cross-references can never verify`,
        });
      } else {
        stage5Runnable.push(candidate);
      }
    }

    for (const candidate of stage5Runnable) {
      stage5TaskCount++;
      const flowTarget = `flow:${candidate.slug}`;
      let flowUsageEntry: StageUsage = emptyUsage();
      const task = getOrCreateTask(db, runId, 5, flowTarget);
      const startedAt = Date.now();
      let attempt = task.attempt;
      let usageHistory: UsageAttempt[] = [];
      let diagnosticHistory: DiagnosticAttempt[] = [];
      let taskError: TaskCheckpoint["error"] | undefined;
      let artifacts: TaskCheckpoint["artifacts"] | undefined;
      // Recovery tier (Component 2): set when this flow completed via the
      // relaxed completion round (checkpoint flag + degradedPages entry).
      let degraded = false;
      const prevCheckpoint = task.checkpoint_json ? safeJsonParse<TaskCheckpoint>(task.checkpoint_json) : null;
      if (prevCheckpoint?.usageHistory) {
        usageHistory = [...prevCheckpoint.usageHistory];
      }
      if (prevCheckpoint?.diagnosticHistory) {
        diagnosticHistory = [...prevCheckpoint.diagnosticHistory];
      }

      const flowPagePath = `livewiki/flows/${candidate.slug}.md`;
      const flowDiagramPath = `livewiki/diagrams/flow-${candidate.slug}.mmd`;

      // Pre-LLM ownership gate, identical to stage 4 (rule #6):
      // owner: human refuses the whole page; owner: mixed is allowed
      // (manual blocks preserved byte-for-byte); unparseable refuses.
      const existing = await safeIo.readText(absRoot, flowPagePath).catch(() => null);
      const preOwner = readOwnerFromFrontmatter(existing);
      if (preOwner === "human") {
        taskError = {
          code: "refused_human_page",
          message:
            `flow "${candidate.slug}" is on a page with owner: human — refuses to rewrite (rule #6). ` +
            `Operator must manually change owner to "generated" or "mixed" if a re-run is desired.`,
        };
      } else if (preOwner === "untrusted") {
        taskError = {
          code: "refused_human_page",
          message:
            `flow "${candidate.slug}" is on a page with a missing or invalid \`owner:\` line — refuses to rewrite (rule #6). ` +
            `Operator must manually set owner to "generated" or "mixed" if a re-run is desired.`,
        };
      } else if (preOwner === "unparseable") {
        taskError = {
          code: "refused_unparseable_page",
          message:
            `flow "${candidate.slug}" is on a page whose frontmatter did not parse (LF/CRLF/BOM-safe check). ` +
            `Refusing to rewrite untrusted content (rule #6 — operator must repair the page manually).`,
        };
      } else {
        // Bounded slots identical to stage 4: 1 + maxRepairAttempts
        // consuming slots + maxIncompleteRetries non-consuming retries.
        const totalConsumedSlots = 1 + maxRepairAttempts;
        let consumedSlots = 0;
        let incompleteRetriesUsed = 0;
        let attemptDone = false;
        let priorCandidate = "";
        let priorErrors: ArtifactValidationError[] = [];
        let lastErrorsForReporting: ArtifactValidationError[] = [];
        let nextPromptKind: "initial" | "repair" = "initial";
        const diagnosticSliceStart = diagnosticHistory.length;

        while (consumedSlots < totalConsumedSlots) {
          attempt++;
          const promptKind = nextPromptKind;
          const repairAttemptContext =
            promptKind === "repair"
              ? { attempt: consumedSlots, total: maxRepairAttempts }
              : undefined;
          const attemptResult = await attemptStage5Generation({
            attemptNumber: attempt,
            candidate,
            modules: ordered,
            language,
            llmClient: llmClient!,
            charBudget,
            promptKind,
            priorCandidate,
            priorErrors,
            absRoot,
            pricing: resolvedConfig.pricing,
            outputTokenCeiling: stage4MaxOutputTokens,
            outputTokenStrategy,
            thinking: thinkingMode,
            diagramBudgets: flowDiagramBudgets,
            surgicalRepair,
            ...(repairAttemptContext !== undefined
              ? { repairAttemptContext }
              : {}),
          });
          usageHistory.push(attemptResult.usageEntry);
          flowUsageEntry = accumulateUsage(
            flowUsageEntry,
            attemptResult.usageEntry,
            resolvedConfig.pricing,
          );
          stage5UsageTotals = accumulateUsage(
            stage5UsageTotals,
            attemptResult.usageEntry,
            resolvedConfig.pricing,
          );

          if (attemptResult.llmError) {
            consumedSlots++;
            diagnosticHistory.push(
              diagnosticAttempt({
                attemptResult,
                promptKind,
                outcome: "llm_error",
                errors: summarizeLlmDiagnosticError(attemptResult.llmError),
              }),
            );
            // Client timeout: terminal for this task — no repair, no second
            // generation (provider state unknown; may still bill).
            if (attemptResult.llmError.code === "llm_timeout") {
              taskError = {
                code: "llm_timeout",
                message: attemptResult.llmError.message,
                failedAt: 5,
              };
              attemptDone = true;
              break;
            }
            lastErrorsForReporting = [
              {
                code: "llm_error",
                message: attemptResult.llmError.message,
                location: "global",
              },
            ];
            priorCandidate = "";
            priorErrors = [];
            nextPromptKind = "initial";
            continue;
          }

          if (attemptResult.artifact === null) {
            const outcome = attemptResult.diagnosticOutcome!;
            const retryWithoutConsumingSlot =
              outcome === "incomplete_generation" &&
              incompleteRetriesUsed < maxIncompleteRetries;
            if (retryWithoutConsumingSlot) {
              incompleteRetriesUsed++;
            } else {
              consumedSlots++;
            }
            lastErrorsForReporting = attemptResult.validationErrors;
            diagnosticHistory.push(
              diagnosticAttempt({
                attemptResult,
                promptKind,
                outcome,
                errors: summarizeDiagnosticErrors(attemptResult.validationErrors),
                ...(retryWithoutConsumingSlot ? { budgetConsumed: false } : {}),
              }),
            );
            if (
              outcome === "incomplete_generation" ||
              outcome === "truncated_by_token_limit"
            ) {
              priorCandidate = "";
              priorErrors = [];
              nextPromptKind = "initial";
            } else {
              // Repair input is the MODEL-EMITTED form (inline diagram),
              // never the placeholder-substituted disk form.
              const candidateText = attemptResult.normalizedRaw;
              if (candidateText.length > charBudget) {
                priorCandidate = "";
                priorErrors = [];
                nextPromptKind = "initial";
              } else if (isUnrepairableErrorSet("flow", attemptResult.validationErrors)) {
                // Etapa 2a early abort: every error in the set is
                // unclassified for flow pages — no supported repair
                // exists, so fail WITHOUT burning a paid repair call.
                taskError = {
                  code: "unrepairable",
                  message: formatUnrepairableMessage("flow", flowTarget, attemptResult.validationErrors),
                  failedAt: 5,
                };
                attemptDone = true;
                break;
              } else {
                priorCandidate = candidateText;
                priorErrors = attemptResult.validationErrors;
                nextPromptKind = "repair";
              }
            }
            continue;
          }

          // Valid artifact → transactional write of BOTH artifacts.
          consumedSlots++;
          const writeResult = await tryWriteFlowAndVerify(
            absRoot,
            flowPagePath,
            flowDiagramPath,
            attemptResult.artifact,
            attemptResult.diagramSource!,
            existing,
          );
          if (writeResult.ok) {
            diagnosticHistory.push(
              diagnosticAttempt({
                attemptResult,
                promptKind,
                outcome: "success",
                errors: { errors: [], truncatedErrorCount: 0 },
              }),
            );
            attemptDone = true;
            artifacts = writeResult.artifacts;
            break;
          } else if (writeResult.rollbackFailed) {
            diagnosticHistory.push(
              diagnosticAttempt({
                attemptResult,
                promptKind,
                outcome: "verify_failed",
                errors: summarizeVerifyDiagnosticErrors(writeResult.issues ?? []),
              }),
            );
            // rollback_failed is TERMINAL for the ENTIRE run (same as
            // stage 4): disk may be inconsistent; do not continue.
            taskError = {
              code: "rollback_failed",
              message:
                `rollback failed after verify rejection for ${flowPagePath}: ${writeResult.rollbackFailed.reason}. ` +
                `This is a terminal state for the ENTIRE run — the disk may have an inconsistent page. ` +
                `Operator must inspect ${flowPagePath} and re-run with --only after manual repair.`,
            };
            attemptDone = true;
            runAbortedByRollback = true;
            break;
          } else if (writeResult.exception) {
            diagnosticHistory.push(
              diagnosticAttempt({
                attemptResult,
                promptKind,
                outcome: "write_verify_exception",
                errors: summarizeLlmDiagnosticError({
                  code: "write_verify_exception",
                  message: writeResult.exception.message,
                }),
              }),
            );
            // R10.1 item A: the write/verify step threw and BOTH artifacts
            // were already rolled back inside tryWriteFlowAndVerify. Not
            // model-repairable (a failed write or a verifier crash recurs
            // deterministically), so the task fails WITHOUT burning repair
            // slots; the RUN continues (circuit breaker still applies).
            taskError = {
              code: "write_verify_exception",
              message:
                `write/verify step threw for ${flowPagePath}: ${writeResult.exception.message}. ` +
                `The artifact pair was rolled back; no repair retry because the failure is not model-fixable.`,
              failedAt: 5,
            };
            attemptDone = true;
            break;
          } else {
            diagnosticHistory.push(
              diagnosticAttempt({
                attemptResult,
                promptKind,
                outcome: "verify_failed",
                errors: summarizeVerifyDiagnosticErrors(writeResult.issues ?? []),
              }),
            );
            // Verify failed → both artifacts already rolled back inside
            // tryWriteFlowAndVerify. Repair input is again the
            // model-emitted inline form.
            const repairErrors = verifyIssuesToValidationErrors(writeResult.issues ?? []);
            lastErrorsForReporting = repairErrors;
            if (attemptResult.normalizedRaw.length > charBudget) {
              priorCandidate = "";
              priorErrors = [];
              nextPromptKind = "initial";
            } else if (isUnrepairableErrorSet("flow", repairErrors)) {
              // Etapa 2a early abort: every verify issue is unclassified
              // for flow pages — fail WITHOUT burning a paid repair call.
              taskError = {
                code: "unrepairable",
                message: formatUnrepairableMessage("flow", flowTarget, repairErrors),
                failedAt: 5,
              };
              attemptDone = true;
              break;
            } else {
              priorCandidate = attemptResult.normalizedRaw;
              priorErrors = repairErrors;
              nextPromptKind = "repair";
            }
            continue;
          }
        }

        // Recovery tier (Component 2): ONE relaxed completion attempt when
        // the strict loop exhausted on a contract-shaped failure — same
        // contract as stage 4 (relaxed validation, degraded marking, task
        // DONE on success, original repair_exhausted path on failure).
        if (!attemptDone && !taskError && relaxedRound && isRelaxedEligible("flow", lastErrorsForReporting)) {
          attempt++;
          const relaxedResult = await attemptStage5Generation({
            attemptNumber: attempt,
            candidate,
            modules: ordered,
            language,
            llmClient: llmClient!,
            charBudget,
            promptKind: "initial",
            priorCandidate: "",
            priorErrors: [],
            absRoot,
            pricing: resolvedConfig.pricing,
            outputTokenCeiling: stage4MaxOutputTokens,
            outputTokenStrategy,
            thinking: thinkingMode,
            diagramBudgets: flowDiagramBudgets,
            surgicalRepair: false,
            relaxed: true,
          });
          relaxedResult.relaxedAttempt = true;
          usageHistory.push(relaxedResult.usageEntry);
          flowUsageEntry = accumulateUsage(
            flowUsageEntry,
            relaxedResult.usageEntry,
            resolvedConfig.pricing,
          );
          stage5UsageTotals = accumulateUsage(
            stage5UsageTotals,
            relaxedResult.usageEntry,
            resolvedConfig.pricing,
          );
          if (relaxedResult.llmError) {
            diagnosticHistory.push(
              diagnosticAttempt({
                attemptResult: relaxedResult,
                promptKind: "initial",
                outcome: "llm_error",
                errors: summarizeLlmDiagnosticError(relaxedResult.llmError),
              }),
            );
          } else if (relaxedResult.artifact === null) {
            diagnosticHistory.push(
              diagnosticAttempt({
                attemptResult: relaxedResult,
                promptKind: "initial",
                outcome: relaxedResult.diagnosticOutcome!,
                errors: summarizeDiagnosticErrors(relaxedResult.validationErrors),
              }),
            );
          } else {
            const writeResult = await tryWriteFlowAndVerify(
              absRoot,
              flowPagePath,
              flowDiagramPath,
              relaxedResult.artifact,
              relaxedResult.diagramSource!,
              existing,
            );
            if (writeResult.ok) {
              diagnosticHistory.push(
                diagnosticAttempt({
                  attemptResult: relaxedResult,
                  promptKind: "initial",
                  outcome: "success",
                  errors: { errors: [], truncatedErrorCount: 0 },
                }),
              );
              attemptDone = true;
              artifacts = writeResult.artifacts;
              degraded = true;
            } else if (writeResult.rollbackFailed) {
              diagnosticHistory.push(
                diagnosticAttempt({
                  attemptResult: relaxedResult,
                  promptKind: "initial",
                  outcome: "verify_failed",
                  errors: summarizeVerifyDiagnosticErrors(writeResult.issues ?? []),
                }),
              );
              taskError = {
                code: "rollback_failed",
                message:
                  `rollback failed after verify rejection for ${flowPagePath}: ${writeResult.rollbackFailed.reason}. ` +
                  `This is a terminal state for the ENTIRE run — the disk may have an inconsistent page. ` +
                  `Operator must inspect ${flowPagePath} and re-run with --only after manual repair.`,
              };
              attemptDone = true;
              runAbortedByRollback = true;
            } else if (writeResult.exception) {
              diagnosticHistory.push(
                diagnosticAttempt({
                  attemptResult: relaxedResult,
                  promptKind: "initial",
                  outcome: "write_verify_exception",
                  errors: summarizeLlmDiagnosticError({
                    code: "write_verify_exception",
                    message: writeResult.exception.message,
                  }),
                }),
              );
              taskError = {
                code: "write_verify_exception",
                message:
                  `write/verify step threw for ${flowPagePath}: ${writeResult.exception.message}. ` +
                  `The artifact pair was rolled back; no repair retry because the failure is not model-fixable.`,
                failedAt: 5,
              };
              attemptDone = true;
            } else {
              diagnosticHistory.push(
                diagnosticAttempt({
                  attemptResult: relaxedResult,
                  promptKind: "initial",
                  outcome: "verify_failed",
                  errors: summarizeVerifyDiagnosticErrors(writeResult.issues ?? []),
                }),
              );
              // Verify NEVER relaxes — repair_exhausted below, unchanged.
            }
          }
        }

        if (!attemptDone && !taskError) {
          // Same B1 reporting as stage 4: the repair_exhausted message is
          // built only from THIS loop's diagnostic slice.
          const thisLoopDiagnostics = diagnosticHistory.slice(diagnosticSliceStart);
          const attemptLines = thisLoopDiagnostics.map((d) => {
            const stopReason = d.stopReason ?? "-";
            const codes = d.errors.map((e) => e.code);
            return `attempt ${d.attempt}: ${stopReason} -> ${d.outcome}` +
              (codes.length > 0 ? ` [${codes.join(", ")}]` : "");
          });
          const totalErrors = thisLoopDiagnostics.reduce(
            (sum, d) => sum + d.errors.length + d.truncatedErrorCount,
            0,
          );
          taskError = {
            code: "repair_exhausted",
            message:
              `task "${flowTarget}" exhausted ${thisLoopDiagnostics.length} LLM call(s) without producing a verified artifact.\n` +
              `Attempts:\n${attemptLines.join("\n")}\n` +
              `Total errors recorded: ${totalErrors}.`,
            ...(lastErrorsForReporting[0]?.sectionSlug ? { failedAt: 5 } : {}),
          };
        }
      }

      // Persist checkpoint and update counters (identical to stage 4).
      if (taskError) {
        const failCheckpoint: TaskCheckpoint = {
          stage: 5,
          status: "failed",
          attempt,
          startedAt,
          finishedAt: Date.now(),
          usageHistory,
          diagnosticHistory,
          error: taskError,
        };
        db.prepare(
          "UPDATE batch_tasks SET status = ?, checkpoint_json = ?, updated_at = ? WHERE id = ?",
        ).run("failed", JSON.stringify(failCheckpoint), Date.now(), task.id);

        cb.consecutive++;
        cb.fails++;
        stage5Fails++;
        failures.push({
          taskId: task.id,
          module: flowTarget,
          error: taskError,
          retryCommand: `livewiki batch --only ${flowTarget} ${runId}`,
        });
      } else {
        const okCheckpoint: TaskCheckpoint = {
          stage: 5,
          status: "done",
          attempt,
          startedAt,
          finishedAt: Date.now(),
          usageHistory,
          diagnosticHistory,
          ...(artifacts ? { artifacts } : {}),
          ...(degraded ? { degraded: true } : {}),
        };
        db.prepare(
          "UPDATE batch_tasks SET status = ?, checkpoint_json = ?, updated_at = ? WHERE id = ?",
        ).run("done", JSON.stringify(okCheckpoint), Date.now(), task.id);

        cb.consecutive = 0;
        cb.done++;
        stage5Done++;
        if (degraded) degradedPages.push(flowPagePath);
      }

      // Circuit breaker: stage-5 tasks count exactly like stage-4 tasks.
      const totalAttempted = cb.done + cb.fails;
      if (
        cb.consecutive >= 3 ||
        (totalAttempted >= 3 && cb.fails / totalAttempted > 0.5)
      ) {
        byStageAcc["5"] = stage5UsageTotals;
        finalizeRun(db, runId, "aborted", {
          totals: aggregateTotals(stage2UsageAcc, aggregateTotals(stageUsageTotals, stage5UsageTotals)),
          byStage: byStageAcc,
          byModule: moduleUsage,
          modulesRefined: modules.map((m) => ({
            id: m.id,
            paths: m.paths,
            ...(m.displayTitle ? { displayTitle: m.displayTitle } : {}),
          })),
          tasksDone: cb.done,
          tasksFailed: cb.fails,
          degradedPages,
        });
        const abortedByBreaker = withDegraded(buildResult(runId, "aborted", aggregateTotals(stageUsageTotals, stage5UsageTotals), moduleUsage, failures, true, cb.done, cb.fails));
        if (skippedFlowCandidates.length > 0) abortedByBreaker.skippedFlowCandidates = skippedFlowCandidates;
        return abortedByBreaker;
      }
      moduleUsage.push({ module: flowTarget, ...flowUsageEntry });

      // rollback_failed aborts the ENTIRE run (same as stage 4). Flow
      // failures never undo stage-4 module work — the abort only stops
      // NEW work; already-written module pages stay on disk.
      if (runAbortedByRollback) {
        byStageAcc["5"] = stage5UsageTotals;
        finalizeRun(db, runId, "aborted", {
          totals: aggregateTotals(stage2UsageAcc, aggregateTotals(stageUsageTotals, stage5UsageTotals)),
          byStage: byStageAcc,
          byModule: moduleUsage,
          modulesRefined: modules.map((m) => ({
            id: m.id,
            paths: m.paths,
            ...(m.displayTitle ? { displayTitle: m.displayTitle } : {}),
          })),
          tasksDone: cb.done,
          tasksFailed: cb.fails,
          degradedPages,
        });
        const abortedByRollback = withDegraded(buildResult(runId, "aborted", aggregateTotals(stageUsageTotals, stage5UsageTotals), moduleUsage, failures, false, cb.done, cb.fails));
        if (skippedFlowCandidates.length > 0) abortedByRollback.skippedFlowCandidates = skippedFlowCandidates;
        return abortedByRollback;
      }
    }
    // === Stage 5b: semantic concept topics ===
    const maxTopics = resolvedConfig.maxTopics ?? CONFIG_DEFAULTS.maxTopics;
    const topicStageGateOpen =
      maxTopics > 0 &&
      !runAbortedByRollback &&
      (opts.mode !== "only" || onlyTopicIdentity !== null);
    let topicCandidates: TopicCandidate[] = [];
    let skippedTopicPlan: BatchRunResult["skippedTopicPlan"];
    if (opts.mode === "only" && onlyTopicIdentity !== null && maxTopics <= 0) {
      throw new Error("topic generation is disabled by maxTopics: 0");
    }
    if (topicStageGateOpen) {
      const topicStage = await runSemanticTopicStage({
        db,
        runId,
        absRoot,
        modules: ordered,
        edges,
        flowCandidates: stage5Candidates,
        pathRoleConfig: resolvedConfig.pathRoles,
        llmClient: llmClient!,
        language,
        pricing: resolvedConfig.pricing,
        thinking: thinkingMode,
        maxTopics,
        maxAnchors: resolvedConfig.topicMaxAnchors ?? CONFIG_DEFAULTS.topicMaxAnchors,
        sourceChars: resolvedConfig.topicMaxSourceChars ?? CONFIG_DEFAULTS.topicMaxSourceChars,
        rationaleMaxChars,
        outputTokens: resolvedConfig.topicMaxOutputTokens ?? CONFIG_DEFAULTS.topicMaxOutputTokens,
        outputTokenStrategy,
        maxRepairAttempts,
        surgicalRepair,
        relaxedRound,
        concernTopics,
        mode: opts.mode,
        onlyIdentity: onlyTopicIdentity,
        noRefine: opts.noRefine ?? false,
        ...(opts.mode !== "only"
          ? { allowedFlowSlugs: new Set(stage5Candidates.map((candidate) => candidate.slug)) }
          : {}),
        // Priority-0 fix: the topic stage gets its OWN circuit breaker,
        // starting from zero. Previously this inherited stage 4/5's
        // cumulative consecutive-failure count and done/fail totals, so an
        // unrelated module or flow failure earlier in the run could trip
        // (or silently push toward) the topic stage's abort threshold —
        // "falhas auxiliares e de flow bloqueando toda a camada de
        // tópicos" (R11-A E2E v21). Topics are an independent, additive
        // layer; their own failures should decide their own abort, not
        // failures from a different stage.
        initialConsecutiveFailures: 0,
        initialDone: 0,
        initialFails: 0,
      });
      topicCandidates = topicStage.candidates;
      stage5UsageTotals = aggregateTotals(stage5UsageTotals, topicStage.usage);
      stage5TaskCount += topicStage.taskCount;
      stage5Done += topicStage.done;
      stage5Fails += topicStage.fails;
      cb.done += topicStage.done;
      cb.fails += topicStage.fails;
      // `cb.consecutive` is not read again after this point (only
      // `cb.done`/`cb.fails` feed the final run status below), so
      // overwriting it here only affects reporting, never triggers a
      // second, cumulative abort check.
      cb.consecutive = topicStage.endingConsecutive;
      failures.push(...topicStage.failures);
      degradedPages.push(...topicStage.degradedPages);
      moduleUsage.push(...topicStage.usageByTask);
      runAbortedByRollback ||= topicStage.rollbackFailed;
      if (topicStage.skippedTopicPlan) skippedTopicPlan = topicStage.skippedTopicPlan;
      // The topic stage already made its own (now-isolated) abort decision
      // internally; do not re-derive one from cumulative cb totals here.
      const combinedCircuitBreaker = topicStage.circuitBreakerTriggered;

      if (combinedCircuitBreaker || topicStage.rollbackFailed) {
        byStageAcc["5"] = stage5UsageTotals;
        finalizeRun(db, runId, "aborted", {
          totals: aggregateTotals(stage2UsageAcc, aggregateTotals(stageUsageTotals, stage5UsageTotals)),
          byStage: byStageAcc,
          byModule: moduleUsage,
          modulesRefined: modules.map((module) => ({
            id: module.id,
            paths: module.paths,
            ...(module.displayTitle ? { displayTitle: module.displayTitle } : {}),
          })),
          tasksDone: cb.done,
          tasksFailed: cb.fails,
          degradedPages,
        });
        const aborted = withDegraded(buildResult(runId, "aborted", aggregateTotals(stageUsageTotals, stage5UsageTotals), moduleUsage, failures, combinedCircuitBreaker, cb.done, cb.fails));
        if (skippedFlowCandidates.length > 0) aborted.skippedFlowCandidates = skippedFlowCandidates;
        if (skippedTopicPlan) aborted.skippedTopicPlan = skippedTopicPlan;
        return aborted;
      }
    }

    if (stage5TaskCount > 0) byStageAcc["5"] = stage5UsageTotals;

    // Stale cleanup mirrors syncClassDiagrams: generated flow artifacts
    // whose candidate disappeared are removed; human/mixed pages are
    // preserved. Skipped when stage 5 is disabled (maxFlows 0) or the run
    // aborted before finishing stage 5.
    if (stage5GateOpen && !runAbortedByRollback) {
      await syncStaleFlowArtifacts(absRoot, stage5Candidates);
    }
    if (topicStageGateOpen && topicCandidates.length > 0 && !runAbortedByRollback) {
      await syncStaleTopicArtifacts(absRoot, topicCandidates);
    }

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
      totals: aggregateTotals(stage2UsageAcc, aggregateTotals(stageUsageTotals, stage5UsageTotals)),
      byStage: byStageAcc,
      byModule: moduleUsage,
      modulesRefined: modules.map((m) => ({
        id: m.id,
        paths: m.paths,
        ...(m.displayTitle ? { displayTitle: m.displayTitle } : {}),
      })),
      tasksDone: cb.done,
      tasksFailed: cb.fails,
      degradedPages,
    });

    // Manifest at the end (if not skipped)
    if (!opts.skipManifestWrite) {
      const snapshotHash = await computeSnapshotHash(absRoot);
      const pendingBatch: PendingBatchRef | null =
        cb.fails > 0 || cb.done === 0
          ? stage5Fails > 0
            ? { runId, stage: 5, done: stage5Done, total: stage5TaskCount }
            : { runId, stage: 4, done: moduleTasksDone, total: ordered.length }
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
    let skippedFlowsHub: BatchRunResult["skippedFlowsHub"];
    let skippedAuxiliaryHub: BatchRunResult["skippedAuxiliaryHub"];
    let skippedTopicsHub: BatchRunResult["skippedTopicsHub"];
    if (cb.done > 0) {
      const regeneration = await regenerateArchitectureOverview(
        absRoot,
        topicStageGateOpen
          ? { acceptedTopicSlugs: new Set(topicCandidates.map((candidate) => candidate.slug)) }
          : {},
      );
      // R10.1 C: a preserved human/mixed/unparseable flows hub is never a
      // silent skip — surface it in the run result (not persisted).
      if (regeneration.flowsHub.outcome === "skipped-owner") {
        skippedFlowsHub = {
          path: regeneration.flowsHub.path!,
          owner: regeneration.flowsHub.owner ?? null,
        };
      }
      if (regeneration.auxiliaryHub.outcome === "skipped-owner") {
        skippedAuxiliaryHub = {
          path: regeneration.auxiliaryHub.path!,
          owner: regeneration.auxiliaryHub.owner ?? null,
        };
      }
      if (regeneration.topicsHub.outcome === "skipped-owner") {
        skippedTopicsHub = {
          path: regeneration.topicsHub.path!,
          owner: regeneration.topicsHub.owner ?? null,
        };
      }
    }

    const finalResult = withDegraded(buildResult(
      runId,
      status,
      aggregateTotals(stageUsageTotals, stage5UsageTotals),
      moduleUsage,
      failures,
      false,
      cb.done,
      cb.fails,
    ));
    if (skippedFlowsHub) finalResult.skippedFlowsHub = skippedFlowsHub;
    if (skippedAuxiliaryHub) finalResult.skippedAuxiliaryHub = skippedAuxiliaryHub;
    if (skippedTopicsHub) finalResult.skippedTopicsHub = skippedTopicsHub;
    if (skippedFlowCandidates.length > 0) finalResult.skippedFlowCandidates = skippedFlowCandidates;
    if (skippedTopicPlan) finalResult.skippedTopicPlan = skippedTopicPlan;
    return finalResult;
  } finally {
    db.close();
  }
}

// === Helpers ===

interface TopicStageResult {
  usage: StageUsage;
  taskCount: number;
  done: number;
  fails: number;
  candidates: TopicCandidate[];
  failures: BatchRunResult["failures"];
  usageByTask: BatchRunResult["byModule"];
  rollbackFailed: boolean;
  circuitBreakerTriggered: boolean;
  endingConsecutive: number;
  skippedTopicPlan?: BatchRunResult["skippedTopicPlan"];
  /** Recovery tier (Component 2): topic pages completed under the relaxed contract. */
  degradedPages: string[];
}

async function runSemanticTopicStage(opts: {
  db: import("better-sqlite3").Database;
  runId: number;
  absRoot: string;
  modules: Module[];
  edges: ReadonlyArray<{ from: string; to: string }>;
  flowCandidates: ReadonlyArray<FlowCandidate>;
  pathRoleConfig: import("./modules.js").PathRoleConfig | undefined;
  llmClient: LlmClient;
  language: Language;
  pricing: import("./pricing.js").PricingOverride | undefined;
  thinking: "disabled" | "adaptive" | "omit" | undefined;
  maxTopics: number;
  maxAnchors: number;
  sourceChars: number;
  /** Cap (chars) for the topic rationale evidence block; accounted before the topicMaxSourceChars throw. */
  rationaleMaxChars: number;
  outputTokens: number;
  outputTokenStrategy: "dynamic" | "fixed";
  maxRepairAttempts: number;
  /** Recovery tier (Component 1): surgical repair toggle for topic repairs. */
  surgicalRepair: boolean;
  /** Recovery tier (Component 2): relaxed completion round toggle for topic exhaustion. */
  relaxedRound: boolean;
  /** D2: concern-grouped topic candidates (deployment/testing) toggle for the deterministic planner. */
  concernTopics: boolean;
  mode: "run" | "resume" | "only";
  onlyIdentity: string | null;
  allowedFlowSlugs?: ReadonlySet<string>;
  initialConsecutiveFailures: number;
  initialDone: number;
  initialFails: number;
  /** --no-refine: skip the optional LLM refine pass over the deterministic topic plan. */
  noRefine?: boolean;
}): Promise<TopicStageResult> {
  const result: TopicStageResult = {
    usage: emptyUsage(), taskCount: 0, done: 0, fails: 0, candidates: [],
    failures: [], usageByTask: [], rollbackFailed: false, circuitBreakerTriggered: false,
    endingConsecutive: opts.initialConsecutiveFailures,
    degradedPages: [],
  };
  const inventory = await buildTopicPlanningInventory({
    repoRoot: opts.absRoot,
    modules: opts.modules,
    edges: opts.edges,
    flowCandidates: opts.flowCandidates,
    ...(opts.pathRoleConfig !== undefined ? { pathRoleConfig: opts.pathRoleConfig } : {}),
    ...(opts.allowedFlowSlugs !== undefined ? { allowedFlowSlugs: opts.allowedFlowSlugs } : {}),
  });
  const activeAnchors = new Set([
    ...inventory.modules.flatMap((module) => module.anchors),
    ...inventory.flows.flatMap((flow) => flow.anchors),
  ]);
  // D2 follow-up: module id → source paths for the topic prose evidence
  // block (buildTopicDocContext excerpts the candidate modules' symbol-less
  // files so deployment/prose surfaces can be described honestly).
  const topicModulePaths = new Map<string, readonly string[]>(
    inventory.modules.map((module) => [module.id, module.paths]),
  );
  const hasCrossModuleBasis =
    inventory.modules.filter((module) => module.role === "product").length >= 2 ||
    inventory.flows.some((flow) => flow.modules.length >= 3);
  // Small or weakly indexed repositories are a deterministic no-op, not a
  // paid planner failure. Once planning starts, invalid/exhausted output still
  // remains a visible failed task with no fallback topics.
  const plannerTarget = "topic-plan";
  let plannerTask: { id: number; attempt: number; checkpoint_json: string | null };
  if (opts.mode === "only") {
    const existing = opts.db.prepare(
      "SELECT id, checkpoint_json FROM batch_tasks WHERE run_id = ? AND stage = 5 AND target = ?",
    ).get(opts.runId, plannerTarget) as { id: number; checkpoint_json: string | null } | undefined;
    if (!existing) throw new Error("topic plan is unavailable for --only; run or resume the batch first");
    const checkpoint = existing.checkpoint_json ? safeJsonParse<TaskCheckpoint>(existing.checkpoint_json) : null;
    plannerTask = { id: existing.id, attempt: checkpoint?.attempt ?? 0, checkpoint_json: existing.checkpoint_json };
  } else {
    const existing = opts.db.prepare(
      "SELECT id, checkpoint_json FROM batch_tasks WHERE run_id = ? AND stage = 5 AND target = ?",
    ).get(opts.runId, plannerTarget) as { id: number; checkpoint_json: string | null } | undefined;
    if (existing !== undefined) {
      const checkpoint = existing.checkpoint_json ? safeJsonParse<TaskCheckpoint>(existing.checkpoint_json) : null;
      plannerTask = { id: existing.id, attempt: checkpoint?.attempt ?? 0, checkpoint_json: existing.checkpoint_json };
    } else {
      if (!hasCrossModuleBasis || activeAnchors.size < 5) return result;
      plannerTask = getOrCreateTask(opts.db, opts.runId, 5, plannerTarget);
    }
  }
  const priorPlannerCheckpoint = plannerTask.checkpoint_json
    ? safeJsonParse<TaskCheckpoint>(plannerTask.checkpoint_json)
    : null;
  if (priorPlannerCheckpoint?.status === "done" && priorPlannerCheckpoint.topicPlan) {
    result.candidates = priorPlannerCheckpoint.topicPlan;
  } else {
    result.taskCount++;
    const startedAt = Date.now();
    let attempt = plannerTask.attempt;
    const usageHistory = [...(priorPlannerCheckpoint?.usageHistory ?? [])];
    const diagnosticHistory = [...(priorPlannerCheckpoint?.diagnosticHistory ?? [])];
    let taskUsage = emptyUsage();

    // Workstream B: the plan is proposed deterministically first (no LLM
    // call, no repair loop, no possible "exhausted" outcome) — see
    // `proposeTopicPlanDeterministically` in topics.ts. An optional,
    // narrowly-scoped LLM refine pass may reword/merge/drop proposals
    // afterward, mirroring stage 2's heuristic-first + optional-refine
    // pattern (`buildStage2RefinePrompt` above): any rejection, invalid
    // output, or infra failure degrades silently back to the already-valid
    // deterministic plan rather than failing or skipping the task.
    const planValidationOpts = {
      maxTopics: opts.maxTopics,
      maxAnchors: opts.maxAnchors,
      maxSourceChars: opts.sourceChars,
      concernTopics: opts.concernTopics,
      // Fix A (2026-07-26): the planner's source-budget estimate must
      // account the same rationale block the generator appends, or an
      // accepted candidate can overflow the hard topicMaxSourceChars throw.
      rationaleMaxChars: opts.rationaleMaxChars,
    };
    const centrality = computeCallerCentrality(opts.db);
    let candidates = proposeTopicPlanDeterministically(inventory, centrality, planValidationOpts);

    if (candidates.length > 0 && !opts.noRefine) {
      attempt++;
      try {
        const proposals: TopicPlanProposal[] = candidates.map((c) => ({
          title: c.title,
          intent: c.intent,
          modules: c.modules,
          flows: c.flows,
          groups: c.groups,
        }));
        const prompt = buildTopicRefinePrompt(proposals, opts.maxTopics, opts.language);
        const refineMaxTokens = resolveOutputTokenBudget(
          opts.outputTokenStrategy,
          opts.outputTokens,
          { anchorCount: candidates.flatMap((c) => c.seedKeys).length },
          TOPIC_REFINE_OUTPUT_BUDGET_OPTIONS,
        );
        const generated = await opts.llmClient.generate({
          system: prompt.system,
          user: prompt.user,
          maxTokens: refineMaxTokens,
          ...(opts.thinking ? { thinking: opts.thinking } : {}),
        });
        const usageEntry: UsageAttempt = {
          attempt,
          usage: generated.usage,
          usageKnown: true,
          costUsd: computeCostFromUsage(generated.usage, opts.pricing),
          finishedAt: Date.now(),
          ...(generated.stopReason !== undefined ? { stopReason: generated.stopReason } : {}),
          ...(generated.rawStopReason !== undefined ? { rawStopReason: generated.rawStopReason } : {}),
        };
        usageHistory.push(usageEntry);
        taskUsage = accumulateUsage(taskUsage, usageEntry, opts.pricing);
        result.usage = accumulateUsage(result.usage, usageEntry, opts.pricing);

        if (generated.stopReason === "length" || generated.stopReason === "incomplete") {
          const outcome = generated.stopReason === "length" ? "truncated_by_token_limit" : "incomplete_generation";
          diagnosticHistory.push(topicPlanDiagnostic(
            attempt, "initial", outcome, generated.content, [], generated.stopReason, generated.rawStopReason,
          ));
          // degrades silently — keep the already-valid deterministic plan.
        } else {
          const refined = validateTopicPlan(generated.content, inventory, planValidationOpts);
          if (refined.ok) {
            candidates = refined.candidates;
            diagnosticHistory.push(topicPlanDiagnostic(
              attempt, "initial", "success", generated.content, [], generated.stopReason, generated.rawStopReason,
            ));
          } else {
            diagnosticHistory.push(topicPlanDiagnostic(
              attempt, "initial", "artifact_validation_failed", generated.content, refined.errors,
              generated.stopReason, generated.rawStopReason,
            ));
            // degrades silently — keep the already-valid deterministic plan.
          }
        }
      } catch (error) {
        const usageEntry: UsageAttempt = { attempt, usage: null, usageKnown: false, costUsd: null, finishedAt: Date.now() };
        usageHistory.push(usageEntry);
        taskUsage = accumulateUsage(taskUsage, usageEntry, opts.pricing);
        result.usage = accumulateUsage(result.usage, usageEntry, opts.pricing);
        const message = error instanceof LlmTimeoutError ? error.message : (error as Error).message;
        diagnosticHistory.push(topicPlanDiagnostic(
          attempt, "initial", "llm_error", "", [{ code: "topic_plan_invalid_json", message }],
        ));
        // degrades silently — an LLM refine failure (even a timeout) is
        // never a planning failure; the deterministic plan is already valid.
      }
    }

    result.candidates = candidates;
    const checkpoint: TaskCheckpoint = {
      stage: 5, status: "done", attempt, startedAt, finishedAt: Date.now(),
      usageHistory, diagnosticHistory, topicPlan: candidates,
      topicPlanRaw: JSON.stringify({ topics: candidates }),
    };
    opts.db.prepare("UPDATE batch_tasks SET status = ?, checkpoint_json = ?, updated_at = ? WHERE id = ?")
      .run("done", JSON.stringify(checkpoint), Date.now(), plannerTask.id);
    result.done++;
    result.usageByTask.push({ module: plannerTarget, ...taskUsage });
  }

  const targets = opts.onlyIdentity === null
    ? result.candidates
    : result.candidates.filter((candidate) => candidate.evidenceHash === opts.onlyIdentity || candidate.slug === opts.onlyIdentity);
  if (opts.onlyIdentity !== null && targets.length === 0) throw new Error(`topic "${opts.onlyIdentity}" not found in the accepted plan`);
  await ensureTopicsIndexScaffold(opts.absRoot);

  let consecutive = result.done > 0 ? 0 : opts.initialConsecutiveFailures;
  result.endingConsecutive = consecutive;
  let cumulativeDone = opts.initialDone + result.done;
  let cumulativeFails = opts.initialFails + result.fails;
  for (const candidate of targets) {
    result.taskCount++;
    const target = `topic:${candidate.evidenceHash}`;
    const task = getOrCreateTask(opts.db, opts.runId, 5, target);
    const priorCheckpoint = task.checkpoint_json ? safeJsonParse<TaskCheckpoint>(task.checkpoint_json) : null;
    const startedAt = Date.now();
    let attempt = task.attempt;
    const usageHistory = [...(priorCheckpoint?.usageHistory ?? [])];
    const diagnosticHistory = [...(priorCheckpoint?.diagnosticHistory ?? [])];
    let taskUsage = emptyUsage();
    const wikiPath = `livewiki/topics/${candidate.slug}.md`;
    const existing = await safeIo.readText(opts.absRoot, wikiPath).catch(() => null);
    const owner = readOwnerFromFrontmatter(existing);
    let taskError: TaskCheckpoint["error"] | undefined;
    let artifacts: TaskCheckpoint["artifacts"] | undefined;
    // Recovery tier (Component 2): set when this topic completed via the
    // relaxed completion round (checkpoint flag + degradedPages entry).
    let degraded = false;
    if (owner === "human" || owner === "mixed" || owner === "untrusted" || owner === "unparseable") {
      taskError = { code: "refused_owned_topic", message: `topic page ${wikiPath} is not automation-owned; human/mixed/untrusted content is preserved`, failedAt: 5 };
    } else {
      let priorCandidate = "";
      let priorErrors: ArtifactValidationError[] = [];
      for (let slot = 0; slot < 1 + opts.maxRepairAttempts; slot++) {
        const promptKind = slot === 0 || priorCandidate === "" ? "initial" : "repair";
        if (promptKind === "repair" && isUnrepairableErrorSet("topic", priorErrors)) {
          // Etapa 2a early abort: every error in the set is unclassified
          // for topic pages — fail WITHOUT burning a paid repair call
          // (checked before `attempt++` so no ghost attempt number is
          // burned without an LLM call).
          taskError = {
            code: "unrepairable",
            message: formatUnrepairableMessage("topic", target, priorErrors),
            failedAt: 5,
          };
          break;
        }
        attempt++;
        // Etapa 3 E2E finding (2026-07-25): buildTopicDocContext can THROW
        // (the hard topicMaxSourceChars guard) before any LLM call. Without
        // this catch the exception escaped the task loop and killed the
        // whole run mid-stage (run row left "running"), violating the
        // failure policy (failed task → mark + reason, RUN continues).
        // The failure is not model-fixable, so the task fails WITHOUT
        // burning repair slots — mirrors the write_verify_exception
        // short-circuit (R10.1 item A); the circuit breaker still applies.
        let attemptResult: Stage4AttemptResult;
        try {
          attemptResult = await attemptTopicGeneration({
            attemptNumber: attempt,
            candidate,
            language: opts.language,
            llmClient: opts.llmClient,
            charBudget: opts.sourceChars,
            rationaleMaxChars: opts.rationaleMaxChars,
            promptKind,
            priorCandidate,
            priorErrors,
            absRoot: opts.absRoot,
            pricing: opts.pricing,
            outputTokenCeiling: opts.outputTokens,
            outputTokenStrategy: opts.outputTokenStrategy,
            surgicalRepair: opts.surgicalRepair,
            anchorSourceChars: candidate.seedKeys.reduce(
              (sum, key) => sum + (inventory.anchorSourceChars[key] ?? 0),
              0,
            ),
            modulePaths: topicModulePaths,
            ...(opts.thinking ? { thinking: opts.thinking } : {}),
            ...(opts.pathRoleConfig !== undefined ? { pathRoleConfig: opts.pathRoleConfig } : {}),
            ...(promptKind === "repair" ? { repairAttemptContext: { attempt: slot, total: opts.maxRepairAttempts } } : {}),
          });
        } catch (err) {
          taskError = {
            code: "context_build_exception",
            message:
              `topic context build threw for ${target}: ${(err as Error).message}. ` +
              `No repair retry because the failure is not model-fixable.`,
            failedAt: 5,
          };
          break;
        }
        usageHistory.push(attemptResult.usageEntry);
        taskUsage = accumulateUsage(taskUsage, attemptResult.usageEntry, opts.pricing);
        result.usage = accumulateUsage(result.usage, attemptResult.usageEntry, opts.pricing);
        priorCandidate = attemptResult.normalizedRaw || priorCandidate;
        priorErrors = attemptResult.validationErrors;
        diagnosticHistory.push(topicAttemptDiagnostic(attempt, promptKind, attemptResult));
        if (attemptResult.llmError) {
          priorErrors = [{ code: "llm_error", message: attemptResult.llmError.message, location: "global" }];
          priorCandidate = "";
          if (attemptResult.llmError.code === "llm_timeout") {
            taskError = { code: "llm_timeout", message: attemptResult.llmError.message, failedAt: 5 };
            break;
          }
          continue;
        }
        if (attemptResult.diagnosticOutcome === "incomplete_generation" || attemptResult.diagnosticOutcome === "truncated_by_token_limit") {
          priorCandidate = "";
          priorErrors = [];
          continue;
        }
        if (attemptResult.artifact === null) continue;
        const write = await tryWriteAndVerify(opts.absRoot, wikiPath, attemptResult.artifact, existing, true);
        if (write.rollbackFailed) {
          taskError = { code: "rollback_failed", message: write.rollbackFailed.reason, failedAt: 5 };
          result.rollbackFailed = true;
          break;
        }
        if (write.exception) {
          // Etapa 2a: align with stages 4/5 (R10.1 item A) — the
          // write/verify step threw and the candidate was already rolled
          // back inside tryWriteAndVerify. Not model-repairable, so the
          // task fails WITHOUT burning further repair slots.
          taskError = {
            code: "write_verify_exception",
            message:
              `write/verify step threw for ${wikiPath}: ${write.exception.message}. ` +
              `The candidate was rolled back; no repair retry because the failure is not model-fixable.`,
            failedAt: 5,
          };
          break;
        }
        if (write.issues) {
          priorErrors = verifyIssuesToValidationErrors(write.issues);
          continue;
        }
        artifacts = write.artifacts;
        break;
      }
      // Recovery tier (Component 2): ONE relaxed completion attempt when
      // the bounded loop exhausted on a contract-shaped failure — same
      // contract as stages 4/5 (relaxed validation, degraded marking, task
      // DONE on success, original repair_exhausted on failure).
      if (!artifacts && !taskError && opts.relaxedRound && isRelaxedEligible("topic", priorErrors)) {
        attempt++;
        let relaxedResult: Stage4AttemptResult | null = null;
        try {
          relaxedResult = await attemptTopicGeneration({
            attemptNumber: attempt,
            candidate,
            language: opts.language,
            llmClient: opts.llmClient,
            charBudget: opts.sourceChars,
            rationaleMaxChars: opts.rationaleMaxChars,
            promptKind: "initial",
            priorCandidate: "",
            priorErrors: [],
            absRoot: opts.absRoot,
            pricing: opts.pricing,
            outputTokenCeiling: opts.outputTokens,
            outputTokenStrategy: opts.outputTokenStrategy,
            surgicalRepair: false,
            anchorSourceChars: candidate.seedKeys.reduce(
              (sum, key) => sum + (inventory.anchorSourceChars[key] ?? 0),
              0,
            ),
            modulePaths: topicModulePaths,
            ...(opts.thinking ? { thinking: opts.thinking } : {}),
            ...(opts.pathRoleConfig !== undefined ? { pathRoleConfig: opts.pathRoleConfig } : {}),
            relaxed: true,
          });
        } catch (err) {
          // Same short-circuit as the strict loop: the context-build throw
          // is not model-fixable — the task fails without further calls.
          taskError = {
            code: "context_build_exception",
            message:
              `topic context build threw for ${target}: ${(err as Error).message}. ` +
              `No repair retry because the failure is not model-fixable.`,
            failedAt: 5,
          };
        }
        if (relaxedResult !== null) {
          relaxedResult.relaxedAttempt = true;
          usageHistory.push(relaxedResult.usageEntry);
          taskUsage = accumulateUsage(taskUsage, relaxedResult.usageEntry, opts.pricing);
          result.usage = accumulateUsage(result.usage, relaxedResult.usageEntry, opts.pricing);
          diagnosticHistory.push(topicAttemptDiagnostic(attempt, "initial", relaxedResult));
          if (relaxedResult.artifact !== null) {
            const write = await tryWriteAndVerify(opts.absRoot, wikiPath, relaxedResult.artifact, existing, true);
            if (write.rollbackFailed) {
              taskError = { code: "rollback_failed", message: write.rollbackFailed.reason, failedAt: 5 };
              result.rollbackFailed = true;
            } else if (write.exception) {
              taskError = {
                code: "write_verify_exception",
                message:
                  `write/verify step threw for ${wikiPath}: ${write.exception.message}. ` +
                  `The candidate was rolled back; no repair retry because the failure is not model-fixable.`,
                failedAt: 5,
              };
            } else if (!write.issues) {
              artifacts = write.artifacts;
              degraded = true;
            }
            // A verify rejection keeps the original repair_exhausted path
            // below — verify NEVER relaxes.
          }
        }
      }
      if (!artifacts && !taskError) {
        taskError = { code: "repair_exhausted", message: `task "${target}" exhausted its bounded generation/repair attempts`, failedAt: 5 };
      }
    }

    if (taskError) {
      const checkpoint: TaskCheckpoint = { stage: 5, status: "failed", attempt, startedAt, finishedAt: Date.now(), usageHistory, diagnosticHistory, error: taskError };
      opts.db.prepare("UPDATE batch_tasks SET status = ?, checkpoint_json = ?, updated_at = ? WHERE id = ?")
        .run("failed", JSON.stringify(checkpoint), Date.now(), task.id);
      result.fails++; cumulativeFails++; consecutive++;
      result.failures.push({ taskId: task.id, module: target, error: taskError, retryCommand: `livewiki batch --only ${target} ${opts.runId}` });
    } else {
      const checkpoint: TaskCheckpoint = { stage: 5, status: "done", attempt, startedAt, finishedAt: Date.now(), usageHistory, diagnosticHistory, ...(artifacts ? { artifacts } : {}), ...(degraded ? { degraded: true } : {}) };
      opts.db.prepare("UPDATE batch_tasks SET status = ?, checkpoint_json = ?, updated_at = ? WHERE id = ?")
        .run("done", JSON.stringify(checkpoint), Date.now(), task.id);
      result.done++; cumulativeDone++; consecutive = 0;
      if (degraded) result.degradedPages.push(wikiPath);
    }
    result.endingConsecutive = consecutive;
    result.usageByTask.push({ module: target, ...taskUsage });
    const attempted = cumulativeDone + cumulativeFails;
    if (result.rollbackFailed || consecutive >= 3 || (attempted >= 3 && cumulativeFails / attempted > 0.5)) {
      result.circuitBreakerTriggered = !result.rollbackFailed;
      break;
    }
  }
  return result;
}

function topicPlanDiagnostic(
  attempt: number,
  promptKind: "initial" | "repair",
  outcome: DiagnosticOutcome,
  candidate: string,
  errors: readonly TopicPlanValidationError[],
  stopReason?: StopReason,
  rawStopReason?: string,
): DiagnosticAttempt {
  const summaries: DiagnosticErrorSummary[] = errors.slice(0, DIAGNOSTIC_MAX_ERRORS).map((error) => ({
    code: error.code,
    location: "global",
    message: error.message.slice(0, DIAGNOSTIC_TEXT_CAP),
  }));
  return {
    attempt,
    ...(stopReason ? { stopReason } : {}),
    ...(rawStopReason ? { rawStopReason } : {}),
    outcome,
    promptKind,
    errors: summaries,
    truncatedErrorCount: Math.max(0, errors.length - summaries.length),
    ...(candidate ? { candidateChars: candidate.length, candidateSha256: sha256(candidate) } : {}),
    finishedAt: Date.now(),
  };
}

function topicAttemptDiagnostic(
  attempt: number,
  promptKind: "initial" | "repair",
  result: Stage4AttemptResult,
): DiagnosticAttemptWithSurgical {
  const summarized = summarizeDiagnosticErrors(result.validationErrors);
  return {
    attempt,
    ...(result.usageEntry.stopReason !== undefined
      ? { stopReason: result.usageEntry.stopReason }
      : {}),
    ...(result.usageEntry.rawStopReason !== undefined
      ? { rawStopReason: result.usageEntry.rawStopReason }
      : {}),
    outcome: result.diagnosticOutcome ?? "success",
    promptKind,
    errors: summarized.errors,
    truncatedErrorCount: summarized.truncatedErrorCount,
    ...(result.diagnosticCandidate !== null
      ? { candidateChars: result.diagnosticCandidate.length, candidateSha256: sha256(result.diagnosticCandidate) }
      : {}),
    ...(result.surgicalOutcome !== undefined
      ? { surgicalOutcome: result.surgicalOutcome }
      : {}),
    ...(result.relaxedAttempt === true ? { relaxed: true } : {}),
    finishedAt: Date.now(),
  };
}

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

/**
 * Resolves the actual `maxTokens` sent to the LLM: under `"fixed"`, the
 * configured ceiling is sent literally (pre-Priority-0-fix behavior,
 * preserved for users who already depend on the exact value); under
 * `"dynamic"` (the default), the ceiling becomes an upper bound for a
 * content-scaled budget (`computeDynamicOutputTokenBudget`,
 * output-budget.ts) — never a flat value applied to every page regardless
 * of how many anchors it must document.
 */
function resolveOutputTokenBudget(
  strategy: "dynamic" | "fixed",
  ceiling: number,
  signals: OutputBudgetSignals,
  preset: typeof MODULE_OUTPUT_BUDGET_OPTIONS,
): number {
  if (strategy === "fixed") return ceiling;
  return computeDynamicOutputTokenBudget(signals, { ...preset, ceiling });
}

function emptyUsage(): StageUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    costUsd: null,
    models: [],
    usageIncomplete: false,
  };
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
    usageIncomplete: Boolean(a.usageIncomplete || b.usageIncomplete),
  };
}

/**
 * Accumulate known usage only. Unknown attempts (timeout) set
 * usageIncomplete and do not invent zero tokens.
 */
function accumulateUsage(
  acc: StageUsage,
  entry: Pick<UsageAttempt, "usage" | "usageKnown" | "costUsd">,
  _pricingOverride: Parameters<typeof calculateCostUsd>[3],
): StageUsage {
  if (!entry.usageKnown || entry.usage === null) {
    return {
      ...acc,
      usageIncomplete: true,
      // Incomplete wire work: keep known cost sum but flag incompleteness.
      costUsd: acc.costUsd,
    };
  }
  const usage = entry.usage;
  const costTotal = entry.costUsd?.total ?? null;
  return {
    inputTokens: acc.inputTokens + usage.inputTokens,
    outputTokens: acc.outputTokens + usage.outputTokens,
    costUsd:
      acc.costUsd === null
        ? costTotal
        : costTotal === null
          ? acc.costUsd
          : acc.costUsd + costTotal,
    models: acc.models.includes(usage.model)
      ? acc.models
      : [...acc.models, usage.model],
    usageIncomplete: Boolean(acc.usageIncomplete),
  };
}

function getOrCreateTask(
  db: import("better-sqlite3").Database,
  runId: number,
  stage: BatchStage,
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
  stage: BatchStage,
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
 * Exact partition of the indexed inventory (100% — no 80% soft threshold):
 *   - malformed JSON / missing "modules" array field
 *   - `modules: []` (empty)
 *   - empty module / missing id / duplicate id
 *   - any unknown path (not in inventory)
 *   - any path assigned more than once
 *   - any inventory path missing from the refine
 *   - peer directory fragmentation (`refine_fragmented_peers`)
 *
 * Returns `{ accepted: true, modules }` or `{ accepted: false, errorCode,
 * errorMessage }`. The heuristic is kept in any rejection case (batch continues).
 */
function validateRefinedModules(
  content: string,
  indexedInventory: Set<string>,
): {
  accepted: boolean;
  modules?: Module[];
  errorCode?: string;
  errorMessage?: string;
} {
  // Normalize inventory keys for comparison.
  const inventory = new Set(
    [...indexedInventory].map((p) => p.replace(/\\/g, "/")),
  );

  // 1. Extract first JSON object (LLM may add prose)
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

  // 3. Validate shape + exact partition (no silent path filtering)
  const ids = new Set<string>();
  const pathToModule = new Map<string, string>();
  const cleanModules: Module[] = [];
  const displayTitleCandidates: Array<{ id: string; displayTitle?: unknown }> = [];
  for (const m of parsed.modules) {
    if (!m || typeof m !== "object") {
      return {
        accepted: false,
        errorCode: "refine_invalid_module",
        errorMessage: "module entry is not an object",
      };
    }
    const obj = m as { id?: unknown; paths?: unknown; displayTitle?: unknown };
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
    displayTitleCandidates.push({ id: obj.id, displayTitle: obj.displayTitle });
    if (!Array.isArray(obj.paths) || obj.paths.some((p) => typeof p !== "string")) {
      return {
        accepted: false,
        errorCode: "refine_invalid_module",
        errorMessage: `module "${obj.id}" has non-string paths`,
      };
    }
    if (obj.paths.length === 0) {
      return {
        accepted: false,
        errorCode: "refine_invalid_module",
        errorMessage: `module "${obj.id}" is empty (no paths); would produce an empty page`,
      };
    }

    const normalizedPaths: string[] = [];
    for (const raw of obj.paths) {
      const p = raw.replace(/\\/g, "/");
      if (!inventory.has(p)) {
        return {
          accepted: false,
          errorCode: "refine_unknown_path",
          errorMessage: `module "${obj.id}" references unknown path "${p}" not in indexed inventory; ignoring refinement`,
        };
      }
      const prev = pathToModule.get(p);
      if (prev !== undefined) {
        return {
          accepted: false,
          errorCode: "refine_duplicate_path",
          errorMessage: `path "${p}" assigned to modules "${prev}" and "${obj.id}"; ignoring refinement`,
        };
      }
      pathToModule.set(p, obj.id);
      normalizedPaths.push(p);
    }
    normalizedPaths.sort((a, b) => a.localeCompare(b));
    cleanModules.push({
      id: obj.id,
      paths: normalizedPaths,
      // symbolCount filled later from the index map in the split/prioritize path
      symbolCount: 0,
    });
  }

  // 4. Exact 100% coverage of indexed inventory (every path once)
  if (pathToModule.size !== inventory.size) {
    const missing: string[] = [];
    for (const f of inventory) {
      if (!pathToModule.has(f)) missing.push(f);
    }
    missing.sort((a, b) => a.localeCompare(b));
    const sample = missing.slice(0, 5).join(", ");
    return {
      accepted: false,
      errorCode: "refine_incomplete_partition",
      errorMessage:
        `refined modules cover ${pathToModule.size}/${inventory.size} indexed paths ` +
        `(need exact 100%); missing e.g. ${sample || "(none listed)"}; ignoring refinement`,
    };
  }

  // 5. Peer directory integrity (no filename-derived split in refine)
  const frag = refinePeerDirectoryFragmentationError(cleanModules);
  if (frag) {
    return {
      accepted: false,
      errorCode: "refine_fragmented_peers",
      errorMessage: frag,
    };
  }

  return {
    accepted: true,
    modules: applyRefinedDisplayTitles(cleanModules, displayTitleCandidates),
  };
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
 * Best-effort rollback of written artifacts (R10.1 item A). For each entry,
 * restores the snapshot when one existed, otherwise removes the newly
 * created file. With `guardedRemoval` (the exception path, where a failed
 * write may never have landed) a removal only runs when the path is still a
 * regular file — a pre-existing directory there is not ours to delete.
 * Returns the failure reasons; empty means fully rolled back.
 */
async function rollbackWrittenArtifacts(
  absRoot: string,
  entries: ReadonlyArray<{ path: string; snapshot: string | null }>,
  guardedRemoval: boolean,
): Promise<string[]> {
  const reasons: string[] = [];
  for (const { path, snapshot } of entries) {
    if (snapshot !== null) {
      try {
        await safeIo.writeText(absRoot, path, snapshot);
      } catch (e) {
        reasons.push(`failed to restore previous content of ${path}: ${(e as Error).message}`);
      }
      continue;
    }
    if (guardedRemoval) {
      const stat = await nodeFs.lstat(nodePath.join(absRoot, path)).catch(() => null);
      if (!stat?.isFile()) continue;
    }
    try {
      await safeIo.remove(absRoot, path);
    } catch (e) {
      reasons.push(`failed to remove new file ${path}: ${(e as Error).message}`);
    }
  }
  return reasons;
}

/**
 * Phase-5 plan (X): wiki page write transaction. Algorithm:
 *   1. If `existing !== null`, extract `<!-- lw:manual -->` blocks from it
 *      with approximate position by section and reinsert them into
 *      `newContent` in the same section (byte-for-byte; review finding #7b).
 *   2. Write `finalContent` via safe-io.
 *   3. Run `runVerify` on the repo. Steps 2+3 run inside ONE try/catch
 *      (R10.1 item A): ANY exception — the write failing, the verifier
 *      crashing — triggers the same best-effort rollback as a rejection;
 *      without this a verifier exception left the candidate on disk.
 *   4. If there's an error-level issue touching this page: rollback (remove if
 *      it was new, restore if it was a rewrite). Review finding #4: if the
 *      rollback fails, this is TERMINAL — we return `rollback_failed`
 *      and the orchestrator marks the task as final failure (does not retry
 *      and does not let the invalid candidate persist) — terminal BOTH when
 *      the rollback was triggered by an exception and when it was triggered
 *      by issues returned normally (R10.1 item A).
 *   5. Returns `{ ok, artifacts? | issues? | exception? | rollbackFailed? }`.
 */
interface WriteResult {
  ok: boolean;
  artifacts?: { wikiPath: string; pageHash: string };
  issues?: VerifyIssue[];
  /** The write/verify step threw; the page was rolled back. Terminal for the task. */
  exception?: { message: string };
  /** True se o verify rejeitou E o rollback subsequente falhou. Terminal. */
  rollbackFailed?: { reason: string };
}

async function tryWriteAndVerify(
  absRoot: string,
  wikiPath: string,
  newContent: string,
  existing: string | null,
  rejectAnySeverity = false,
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

  const snapshot = existing;

  // 2+3. Write via safe-io, then verify — ALL inside one try/catch
  //    (R10.1 item A): ANY exception (the write failing, the verifier
  //    crashing) rolls the page back best-effort, exactly like a rejection.
  let verifyResult: VerifyResult;
  try {
    await safeIo.writeText(absRoot, wikiPath, finalContent);
    verifyResult = await runVerify(absRoot);
  } catch (e) {
    const reasons = await rollbackWrittenArtifacts(
      absRoot,
      [{ path: wikiPath, snapshot }],
      true,
    );
    if (reasons.length > 0) {
      return { ok: false, rollbackFailed: { reason: reasons.join("; ") } };
    }
    return { ok: false, exception: { message: (e as Error).message } };
  }
  const broken = verifyResult.issues.filter(
    (i) => i.wikiPath === wikiPath && (rejectAnySeverity || i.severity === "error"),
  );

  if (broken.length > 0) {
    // 4. ROLLBACK MANDATORY. If the rollback fails, this is TERMINAL
    //    (review finding #4): invalid candidate MUST NEVER persist
    //    on disk and the orchestrator must signal the failure.
    const reasons = await rollbackWrittenArtifacts(
      absRoot,
      [{ path: wikiPath, snapshot }],
      false,
    );
    if (reasons.length > 0) {
      return {
        ok: false,
        issues: broken,
        rollbackFailed: { reason: reasons.join("; ") },
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
 *
 * Etapa 2a: the original verify issue code is PRESERVED (no longer
 * collapsed into `verify_failed`) so the closed repair contract can
 * classify each code — `broken_internal_link` gets an actionable
 * directive while `manual_block_altered` stays report-only (rule #6).
 */
function verifyIssuesToValidationErrors(
  issues: ReadonlyArray<VerifyIssue>,
): ArtifactValidationError[] {
  return issues.map((i) => {
    const location =
      i.code === "broken_anchor" ? "frontmatter" : "body";
    return {
      code: i.code,
      message: i.detail,
      location,
      ...(i.wikiPath ? { offending: i.wikiPath } : {}),
    };
  });
}

type DiagnosticErrors = {
  errors: DiagnosticErrorSummary[];
  truncatedErrorCount: number;
};

function summarizeLlmDiagnosticError(error: {
  code: string;
  message: string;
}): DiagnosticErrors {
  return {
    errors: [
      {
        code: error.code,
        location: "global",
        message: error.message.slice(0, DIAGNOSTIC_TEXT_CAP),
      },
    ],
    truncatedErrorCount: 0,
  };
}

function summarizeVerifyDiagnosticErrors(
  issues: ReadonlyArray<VerifyIssue>,
): DiagnosticErrors {
  const errors = issues.slice(0, DIAGNOSTIC_MAX_ERRORS).map((issue) => ({
    code: issue.code,
    location: issue.code === "broken_anchor" ? "frontmatter" as const : "body" as const,
    ...(issue.wikiPath
      ? { offending: issue.wikiPath.slice(0, DIAGNOSTIC_TEXT_CAP) }
      : {}),
    message: issue.detail.slice(0, DIAGNOSTIC_TEXT_CAP),
  }));
  return {
    errors,
    truncatedErrorCount: Math.max(0, issues.length - errors.length),
  };
}

function diagnosticAttempt(input: {
  attemptResult: Stage4AttemptResult;
  promptKind: "initial" | "repair";
  outcome: DiagnosticOutcome;
  errors: DiagnosticErrors;
  budgetConsumed?: boolean;
}): DiagnosticAttemptWithSurgical {
  const candidate = input.attemptResult.diagnosticCandidate;
  return {
    attempt: input.attemptResult.usageEntry.attempt,
    ...(input.attemptResult.usageEntry.stopReason !== undefined
      ? { stopReason: input.attemptResult.usageEntry.stopReason }
      : {}),
    ...(input.attemptResult.usageEntry.rawStopReason !== undefined
      ? { rawStopReason: input.attemptResult.usageEntry.rawStopReason }
      : {}),
    outcome: input.outcome,
    promptKind: input.promptKind,
    ...(input.budgetConsumed !== undefined
      ? { budgetConsumed: input.budgetConsumed }
      : {}),
    errors: input.errors.errors,
    truncatedErrorCount: input.errors.truncatedErrorCount,
    ...(candidate !== null
      ? { candidateChars: candidate.length, candidateSha256: sha256(candidate) }
      : {}),
    ...(input.attemptResult.mechanicalRepairs !== undefined
      ? { mechanicalRepairs: input.attemptResult.mechanicalRepairs }
      : {}),
    ...(input.attemptResult.surgicalOutcome !== undefined
      ? { surgicalOutcome: input.attemptResult.surgicalOutcome }
      : {}),
    ...(input.attemptResult.relaxedAttempt === true ? { relaxed: true } : {}),
    finishedAt: Date.now(),
  };
}

// === Recovery tier (Component 1): surgical repair preparation ===

/**
 * Cap (chars) for the surgical evidence slice: the symbols-table rows plus
 * the source spans of the keys cited in the affected sections. Deliberately
 * far below the stage-4 context budget — the surgical call is small.
 */
const SURGICAL_EVIDENCE_MAX_CHARS = 12_000;

interface SurgicalRepairPlan {
  /**
   * The failed page as the validator saw it (normalized prior candidate).
   * Used as the splice base AND embedded in the surgical prompt.
   */
  basePage: string;
  /** Target section slugs (deduplicated, first-seen order). */
  targetSections: string[];
  /** Symbols rows + source spans for the keys cited in the target sections. */
  evidenceSlice: string;
}

/**
 * Decides whether THIS repair attempt may use the surgical path and, if
 * so, pre-computes everything the attempt needs. Returns null (→ caller
 * uses the existing full-context repair prompt, unchanged) when:
 *
 *   - the error set is not eligible (`surgicalRepairTargetSections`);
 *   - the prior candidate does not normalize (cannot map validator
 *     sections onto it deterministically);
 *   - a target section is absent from the failed page (a missing section
 *     must be ADDED, which the section-replacement guard cannot do
 *     safely — the full prompt handles it).
 */
async function prepareSurgicalRepair(
  absRoot: string,
  priorCandidate: string,
  priorErrors: ReadonlyArray<ArtifactValidationError>,
  symbolsTable: string,
): Promise<SurgicalRepairPlan | null> {
  const targetSections = surgicalRepairTargetSections(priorErrors);
  if (targetSections === null) return null;
  const base = normalizeStage4Artifact(priorCandidate);
  if (!base.ok) return null;
  const split = splitH2Sections(base.content);
  const present = new Set(split.sections.map((s) => s.slug));
  if (!targetSections.every((slug) => present.has(slug))) return null;
  // Anchor keys cited inside the affected sections drive the evidence slice.
  const targetSet = new Set(targetSections);
  const citedKeys = new Set<string>();
  for (const section of split.sections) {
    if (!targetSet.has(section.slug)) continue;
    const text = base.content.slice(section.start, section.end);
    for (const m of text.matchAll(/<!--\s*lw:anchors\s+([^>]*?)\s*-->/g)) {
      for (const key of (m[1] ?? "").split(/\s+/)) {
        if (key !== "") citedKeys.add(key);
      }
    }
  }
  const evidenceSlice = await buildSurgicalEvidenceSlice(
    absRoot,
    symbolsTable,
    [...citedKeys].sort(),
  );
  return { basePage: base.content, targetSections, evidenceSlice };
}

/**
 * Evidence for the surgical prompt: the symbols-table rows of the cited
 * keys plus one bounded source span per cited key (same
 * `renderTopicSourceSpan` extraction the topic context uses), capped at
 * SURGICAL_EVIDENCE_MAX_CHARS total. Keys absent from the index contribute
 * nothing.
 */
async function buildSurgicalEvidenceSlice(
  absRoot: string,
  symbolsTable: string,
  citedKeys: readonly string[],
): Promise<string> {
  if (citedKeys.length === 0) return "";
  const keySet = new Set(citedKeys);
  const rows = symbolsTable.split("\n").filter((line) => {
    const m = /^- (\S+) \(/.exec(line);
    return m?.[1] !== undefined && keySet.has(m[1]);
  });
  const rowsBlock = rows.join("\n");
  const spanBudget = Math.max(
    0,
    SURGICAL_EVIDENCE_MAX_CHARS - rowsBlock.length - 2,
  );
  const db = openIndex(
    await safeIo.resolveAndValidate(absRoot, ".livewiki/index.db"),
  );
  try {
    const placeholders = citedKeys.map(() => "?").join(",");
    const symbols = db
      .prepare(
        `SELECT s.key, s.start_line AS startLine, s.end_line AS endLine, f.path
         FROM symbols s JOIN files f ON f.id = s.file_id
         WHERE s.status = 'active' AND s.key IN (${placeholders})`,
      )
      .all(...citedKeys) as Array<{
      key: string;
      startLine: number;
      endLine: number;
      path: string;
    }>;
    symbols.sort((a, b) => a.key.localeCompare(b.key));
    const spans: string[] = [];
    let budget = spanBudget;
    for (const symbol of symbols) {
      if (budget <= 0) break;
      const source = await nodeFs
        .readFile(nodePath.join(absRoot, symbol.path), "utf8")
        .catch(() => null);
      if (source === null) continue;
      const span = renderTopicSourceSpan(symbol, source.split("\n"));
      if (span.length > budget) {
        spans.push(
          span.slice(0, budget) + "\n// ... (truncated by budget)",
        );
        break;
      }
      spans.push(span);
      budget -= span.length + TOPIC_SOURCE_SPAN_SEPARATOR.length;
    }
    const spanBlock = spans.join(TOPIC_SOURCE_SPAN_SEPARATOR);
    if (rowsBlock === "") return spanBlock;
    if (spanBlock === "") return rowsBlock;
    return `${rowsBlock}\n\n${spanBlock}`;
  } finally {
    db.close();
  }
}

// === Stage 4 attempt abstraction ===

/**
 * Recovery tier (Component 1): additive outcome recorded on a diagnostic
 * entry for attempts that used the surgical repair path. Absent on
 * non-surgical attempts. Carried on the persisted checkpoint JSON via an
 * intersection type in `diagnosticAttempt`/`topicAttemptDiagnostic` — the
 * canonical `DiagnosticAttempt` interface (batch-state.ts) is unchanged.
 */
export type SurgicalOutcome = "surgical_ok" | "surgical_cascade_rejected";

type DiagnosticAttemptWithSurgical = DiagnosticAttempt & {
  surgicalOutcome?: SurgicalOutcome;
  /**
   * Recovery tier (Component 2): this attempt ran under the relaxed
   * contract (the final completion round after strict exhaustion).
   * Absent on strict attempts.
   */
  relaxed?: boolean;
};

/**
 * Recovery tier (Component 2): the relaxed completion round exists for
 * contract-shape failures, not infra failures. Eligible iff the last
 * reported error set is non-empty and contains NO unclassified code for
 * the page kind (report-only codes are never relaxed by design). Infra
 * failures — llm_timeout, write_verify_exception, context_build_exception,
 * rollback_failed, unrepairable, ownership refusals — set `taskError`
 * before the exhaustion point and never reach this check.
 */
function isRelaxedEligible(
  pageKind: "module" | "flow" | "topic",
  errors: ReadonlyArray<ArtifactValidationError>,
): boolean {
  return errors.length > 0 && collectUnclassified(pageKind, errors).length === 0;
}

/**
 * Result of ONE LLM attempt (initial or repair) inside the bounded
 * stage 4 loop.
 */
interface Stage4AttemptResult {
  /**
   * `usageHistory` entry to record. ALWAYS present:
   *   - real usage if the LLM returned a result
   *   - unknown/null usage if the LLM call threw (network, 5xx, etc)
   */
  usageEntry: UsageAttempt;
  /**
   * Raw LLM output (or empty string if the call failed). Used to
   * pass to the repair prompt when the artifact is invalid.
   */
  normalizedRaw: string;
  /** Candidate representation used only for content-safe size/hash diagnostics. */
  diagnosticCandidate: string | null;
  /** Outcome known before the transactional write, or null when write/verify is next. */
  diagnosticOutcome: DiagnosticOutcome | null;
  /**
   * NORMALIZED and VALIDATED artifact. Null if the artifact is invalid.
   * If valid, it is the content to write.
   */
  artifact: string | null;
  /** Artifact validation errors (empty if artifact !== null). */
  validationErrors: ArtifactValidationError[];
  /** If the LLM call failed, the error lives here. */
  llmError: { code: string; message: string } | null;
  /** Content-safe deterministic repairs applied after the final LLM repair. */
  mechanicalRepairs?: MechanicalArtifactRepair[];
  /** Set only on attempts that used the surgical repair path (recovery tier). */
  surgicalOutcome?: SurgicalOutcome;
  /** Set on the relaxed completion attempt (recovery tier, Component 2). */
  relaxedAttempt?: boolean;
}

interface AttemptOpts {
  attemptNumber: number;
  module: Module;
  language: Language;
  llmClient: LlmClient;
  charBudget: number;
  /** Cap (chars) for the rationale evidence block; carved inside charBudget. */
  rationaleMaxChars: number;
  promptKind: "initial" | "repair";
  priorCandidate: string;
  priorErrors: ArtifactValidationError[];
  absRoot: string;
  /**
   * Review finding #5: pricing override preserved in ALL calls
   * (incluindo repairs). Sem isso, repair cost seria calculado com a
   * embedded table, losing the user's override in `config.json`.
   */
  pricing: import("./pricing.js").PricingOverride | undefined;
  /** Ceiling for `maxTokens`; the actual value is computed once the closed key list is known. */
  outputTokenCeiling: number;
  outputTokenStrategy: "dynamic" | "fixed";
  thinking?: "disabled" | "adaptive" | "omit" | undefined;
  pathRoleConfig?: import("./modules.js").PathRoleConfig | undefined;
  /** True only for the final configured repair slot. */
  allowMechanicalFallback: boolean;
  /** Optional repair-attempt position; only set when `promptKind === "repair"`. */
  repairAttemptContext?: {
    attempt: number;
    total: number;
  };
  /** Recovery tier (Component 1): allow the surgical repair path. */
  surgicalRepair: boolean;
  /**
   * Recovery tier (Component 2): run under the relaxed validation contract
   * and mark the artifact degraded (frontmatter `quality: degraded` +
   * reader notice) BEFORE validation, so the validated artifact is exactly
   * what gets written. Used only with `promptKind: "initial"`.
   */
  relaxed?: boolean;
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
  const ctx = await buildModuleDocContext(opts.absRoot, opts.module, opts.charBudget, opts.rationaleMaxChars);
  const maxTokens = resolveOutputTokenBudget(
    opts.outputTokenStrategy,
    opts.outputTokenCeiling,
    { anchorCount: ctx.closedKeyList.length },
    MODULE_OUTPUT_BUDGET_OPTIONS,
  );

  // Build prompt
  let prompt: { system: string; user: string };
  // Recovery tier (Component 1): an eligible section-scoped error set swaps
  // the full-context repair prompt for the surgical one. The guard result
  // (surgicalPlan) is consumed after normalization, before validation.
  let surgicalPlan: SurgicalRepairPlan | null = null;
  if (opts.promptKind === "repair") {
    const attemptContext = opts.repairAttemptContext ?? { attempt: 1, total: 1 };
    if (opts.surgicalRepair) {
      surgicalPlan = await prepareSurgicalRepair(
        opts.absRoot,
        opts.priorCandidate,
        opts.priorErrors,
        ctx.symbolsTable,
      );
    }
    prompt = surgicalPlan !== null
      ? buildSurgicalRepairPrompt(
          "module",
          surgicalPlan.basePage,
          opts.priorErrors,
          surgicalPlan.evidenceSlice,
          opts.language,
        )
      : buildRepairPrompt(
          opts.module,
          ctx.closedKeyList,
          ctx.symbolsTable,
          ctx.truncatedSource,
          opts.priorCandidate,
          opts.priorErrors,
          opts.charBudget,
          opts.language,
          attemptContext,
          classifyModuleRole(opts.module, opts.pathRoleConfig),
          ctx.rationaleEvidence,
        );
  } else {
    prompt = buildStage4Prompt(
      opts.module,
      ctx.closedKeyList,
      ctx.symbolsTable,
      ctx.truncatedSource,
      opts.language,
      classifyModuleRole(opts.module, opts.pathRoleConfig),
      ctx.rationaleEvidence,
    );
  }

  // Call LLM
  let raw: string;
  let usage: { inputTokens: number; outputTokens: number; model: string };
  let stopReason: StopReason = "unknown";
  let rawStopReason: string | undefined;
  try {
    const result = await opts.llmClient.generate({
      system: prompt.system,
      user: prompt.user,
      maxTokens,
      ...(opts.thinking ? { thinking: opts.thinking } : {}),
    });
    raw = result.content;
    usage = result.usage;
    stopReason = result.stopReason ?? "unknown";
    rawStopReason = result.rawStopReason;
  } catch (err) {
    // Typed timeout: usage unknown (provider may still bill). No fake 0/0 model.
    if (err instanceof LlmTimeoutError) {
      return {
        usageEntry: {
          attempt: opts.attemptNumber,
          usage: null,
          usageKnown: false,
          costUsd: null,
          finishedAt: Date.now(),
        },
        normalizedRaw: "",
        diagnosticCandidate: null,
        diagnosticOutcome: "llm_error",
        artifact: null,
        validationErrors: [],
        llmError: {
          code: "llm_timeout",
          message: err.message,
        },
      };
    }
    const e = err as Error;
    // Any generate() throw without provider usage → usage unknown (request
    // may have been sent; provider may still bill). Not fake 0/0 models.
    return {
      usageEntry: {
        attempt: opts.attemptNumber,
        usage: null,
        usageKnown: false,
        costUsd: null,
        finishedAt: Date.now(),
      },
      normalizedRaw: "",
      diagnosticCandidate: null,
      diagnosticOutcome: "llm_error",
      artifact: null,
      validationErrors: [],
      llmError: {
        code: "llm_call_failed",
        message: e.message,
      },
    };
  }

  // Cost — review finding #5: uses the config's pricing override so that
  // repairs are also calculated in the user's table (not just the
  // tabela embutida).
  const cost = computeCostFromUsage(usage, opts.pricing);
  const usageEntry: UsageAttempt = {
    attempt: opts.attemptNumber,
    usage,
    usageKnown: true,
    costUsd: cost,
    finishedAt: Date.now(),
    stopReason,
    ...(rawStopReason !== undefined ? { rawStopReason } : {}),
  };

  // Provider-declared non-completions remain rejected artifacts, but the
  // caller uses a fresh initial prompt next. The partial text is retained only
  // long enough to compute content-safe diagnostics, never as repair input.
  if (stopReason === "length" || stopReason === "incomplete") {
    const code =
      stopReason === "length"
        ? "truncated_by_token_limit"
        : "incomplete_generation";
    const reasonDetail = rawStopReason ? ` (provider reason: ${rawStopReason})` : "";
    return {
      usageEntry,
      normalizedRaw: raw,
      diagnosticCandidate: raw,
      diagnosticOutcome: code,
      artifact: null,
      validationErrors: [
        {
          code,
          message:
            stopReason === "length"
              ? `provider stopped at the output-token limit${reasonDetail}`
              : `provider stopped before a normal text completion${reasonDetail}`,
          location: "global",
        },
      ],
      llmError: null,
    };
  }

  // Normalize
  const normalize = normalizeStage4Artifact(raw);
  if (!normalize.ok) {
    return {
      usageEntry,
      normalizedRaw: raw,
      diagnosticCandidate: raw,
      diagnosticOutcome: "normalization_failed",
      artifact: null,
      validationErrors: normalize.errors,
      llmError: null,
    };
  }

  // Recovery tier (Component 1): a surgical attempt's response passes the
  // anti-cascade guard BEFORE validation — the candidate that validation
  // (and, on success, the transactional write) sees is the failed page
  // with ONLY the target sections replaced. A null splice means the model
  // changed something outside the named sections: the attempt fails with
  // the ORIGINAL errors (the page is unchanged by definition) and the
  // diagnostic entry records the rejection.
  let candidateContent = normalize.content;
  let surgicalOutcome: SurgicalOutcome | undefined;
  if (surgicalPlan !== null) {
    const spliced = spliceSections(
      surgicalPlan.basePage,
      normalize.content,
      surgicalPlan.targetSections,
    );
    if (spliced === null) {
      return {
        usageEntry,
        // The cascade attempt contributes nothing usable: keep the
        // ORIGINAL failed page as the repair input for the next slot, so
        // the splice base cannot drift onto the rejected response.
        normalizedRaw: opts.priorCandidate,
        diagnosticCandidate: normalize.content,
        diagnosticOutcome: "artifact_validation_failed",
        artifact: null,
        validationErrors: opts.priorErrors,
        llmError: null,
        surgicalOutcome: "surgical_cascade_rejected",
      };
    }
    candidateContent = spliced;
    surgicalOutcome = "surgical_ok";
  }

  // Validate against closed key list
  // Recovery tier (Component 2): the relaxed writer marks the artifact
  // degraded BEFORE validation, so the artifact that validation (and
  // verify) sees is byte-for-byte the artifact written to disk.
  if (opts.relaxed === true) {
    candidateContent = markDegradedArtifact(candidateContent);
  }
  const validation = validateStage4Artifact(candidateContent, ctx.closedKeyList, {
    moduleId: opts.module.id,
    moduleRole: classifyModuleRole(opts.module, opts.pathRoleConfig),
    ...(opts.relaxed === true ? { relaxed: true } : {}),
  });
  if (!validation.ok) {
    if (opts.allowMechanicalFallback) {
      const mechanical = repairStage4ArtifactMechanically(
        candidateContent,
        validation.errors,
        ctx.closedKeyList,
        {
          moduleId: opts.module.id,
          moduleRole: classifyModuleRole(opts.module),
        },
      );
      if (mechanical !== null) {
        return {
          usageEntry,
          normalizedRaw: raw,
          diagnosticCandidate: mechanical.content,
          diagnosticOutcome: null,
          artifact: mechanical.content,
          validationErrors: [],
          llmError: null,
          mechanicalRepairs: mechanical.repairs,
          ...(surgicalOutcome !== undefined ? { surgicalOutcome } : {}),
        };
      }
    }
    return {
      usageEntry,
      normalizedRaw: raw,
      diagnosticCandidate: candidateContent,
      diagnosticOutcome: "artifact_validation_failed",
      artifact: null,
      validationErrors: validation.errors,
      llmError: null,
      ...(surgicalOutcome !== undefined ? { surgicalOutcome } : {}),
    };
  }

  return {
    usageEntry,
    normalizedRaw: raw,
    diagnosticCandidate: candidateContent,
    diagnosticOutcome: null,
    artifact: candidateContent,
    validationErrors: [],
    llmError: null,
    ...(surgicalOutcome !== undefined ? { surgicalOutcome } : {}),
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
  /**
   * Etapa 2b: rendered rationale evidence lines (unfenced, unneutralized —
   * the prompt builders apply neutralize + safe fence). Empty string when
   * there is nothing to show or `rationaleMaxChars` is 0.
   */
  rationaleEvidence: string;
}

interface ModuleSymbolRow {
  key: string;
  name: string;
  kind: string;
  signature: string | null;
}

/**
 * Raw `key, name, kind, signature` rows for one module's active symbols.
 * Shared by `buildModuleDocContext` (product LLM prompt context) and the
 * deterministic auxiliary-page path (no LLM, no source truncation needed).
 */
async function getModuleSymbolRows(
  absRoot: string,
  module: Module,
): Promise<ModuleSymbolRow[]> {
  const db = openIndex(
    await safeIo.resolveAndValidate(absRoot, ".livewiki/index.db"),
  );
  try {
    const fileIds = await getFileIdsForModule(absRoot, module);
    const stmt = db.prepare(
      `SELECT key, name, kind, signature FROM symbols
       WHERE status = 'active' AND file_id IN (${fileIds.map(() => "?").join(",") || "NULL"})`,
    );
    return (fileIds.length > 0 ? stmt.all(...fileIds) : []) as ModuleSymbolRow[];
  } finally {
    db.close();
  }
}

export async function buildModuleDocContext(
  absRoot: string,
  module: Module,
  charBudget: number,
  rationaleMaxChars = 0,
): Promise<ModuleDocContext> {
  const symbols = await getModuleSymbolRows(absRoot, module);
  const closedKeyList = symbols.map((s) => s.key).sort();
  const symbolsTable = symbols
    .map((s) => `- ${s.key} (${s.kind}): ${s.signature ?? ""}`)
    .join("\n");
  // Etapa 2b: bounded rationale evidence, carved INSIDE charBudget — the
  // source excerpt below gets what the rationale block did not consume.
  const rationaleEvidence = await getRationaleEvidenceForPaths(
    absRoot,
    module.paths,
    rationaleMaxChars,
  );
  const sourceBudget = Math.max(0, charBudget - rationaleEvidence.length);
  // Fair per-file truncation: sequential first-fit left later files (and
  // their closed-list keys) with zero source context, which strongly
  // correlates with invented anchors. Give every path a share of the
  // budget so stage-4 always sees a slice of each module file.
  const truncatedSource = await buildFairTruncatedSource(
    absRoot,
    module.paths,
    sourceBudget,
  );
  return { closedKeyList, symbolsTable, truncatedSource, rationaleEvidence };
}

/**
 * Etapa 2b: renders the indexed rationale rows for the given file paths as
 * bounded evidence lines via the shared `renderRationaleEvidence`
 * (rationale-evidence.ts), deterministically ordered by
 * (path, start_line, rowid) and capped at `maxChars` total. Returns "" when
 * maxChars <= 0 or no rows exist.
 */
async function getRationaleEvidenceForPaths(
  absRoot: string,
  paths: ReadonlyArray<string>,
  maxChars: number,
): Promise<string> {
  if (maxChars <= 0 || paths.length === 0) return "";
  const db = openIndex(
    await safeIo.resolveAndValidate(absRoot, ".livewiki/index.db"),
  );
  try {
    const placeholders = paths.map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT f.path, r.symbol_key, r.kind, r.text, r.start_line
         FROM rationales r JOIN files f ON f.id = r.file_id
         WHERE f.path IN (${placeholders})
         ORDER BY f.path, r.start_line, r.id`,
      )
      .all(...paths) as RationaleEvidenceRow[];
    return renderRationaleEvidence(rows, maxChars);
  } finally {
    db.close();
  }
}

/**
 * Build a source excerpt for stage-4 prompts with a fair share of
 * `charBudget` per module path. Each file is included (header + body
 * slice) so closed-list keys from late paths still have local context.
 * When the sum of full files fits the budget, returns full content.
 */
export async function buildFairTruncatedSource(
  absRoot: string,
  paths: ReadonlyArray<string>,
  charBudget: number,
): Promise<string> {
  if (paths.length === 0 || charBudget <= 0) return "";

  type FileSlice = { path: string; content: string };
  const files: FileSlice[] = [];
  for (const p of paths) {
    try {
      const c = await nodeFs.readFile(nodePath.join(absRoot, p), "utf8");
      files.push({ path: p, content: c });
    } catch {
      // skip unreadable paths
    }
  }
  if (files.length === 0) return "";

  const headerOf = (p: string) => `\n// === ${p} ===\n`;
  // Untruncated total (same layout as the old sequential builder).
  let full = "";
  for (const f of files) {
    full += `${headerOf(f.path)}${f.content}\n`;
  }
  if (full.length <= charBudget) return full;

  // Equal share per file (headers included in the share).
  const n = files.length;
  const share = Math.max(128, Math.floor(charBudget / n));
  let src = "";
  for (const f of files) {
    const header = headerOf(f.path);
    const bodyBudget = Math.max(0, share - header.length - 1);
    let body = f.content;
    if (body.length > bodyBudget) {
      body =
        body.slice(0, bodyBudget) +
        (bodyBudget > 0 ? "\n// ... (truncated by budget)\n" : "");
    }
    src += `${header}${body}\n`;
  }
  // Hard cap: rare when truncation markers push over budget.
  if (src.length > charBudget) {
    src = src.slice(0, charBudget) + "\n// ... (truncated by budget)\n";
  }
  return src;
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
    modulesRefined: Array<{ id: string; paths: string[]; displayTitle?: string }>;
    tasksDone: number;
    tasksFailed: number;
    /** Recovery tier (Component 2): persisted only when non-empty. */
    degradedPages?: string[];
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
    ...(opts.degradedPages !== undefined && opts.degradedPages.length > 0
      ? { degradedPages: [...opts.degradedPages] }
      : {}),
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
  tasksDone: number,
  tasksFailed: number,
): BatchRunResult {
  return {
    runId,
    status,
    totals,
    byModule,
    failures,
    circuitBreakerTriggered,
    tasksDone,
    tasksFailed,
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

// === Stage 5 attempt abstraction (SPEC §"Semantic product-flow layer") ===

/** Result of ONE stage-5 LLM attempt; adds the extracted diagram source. */
interface Stage5AttemptResult extends Stage4AttemptResult {
  /** Extracted, trimmed diagram source (non-null iff artifact !== null). */
  diagramSource: string | null;
}

interface Stage5AttemptOpts {
  attemptNumber: number;
  candidate: FlowCandidate;
  /** Final module plan (walk order + paths for the source excerpt). */
  modules: ReadonlyArray<Module>;
  language: Language;
  llmClient: LlmClient;
  charBudget: number;
  promptKind: "initial" | "repair";
  priorCandidate: string;
  priorErrors: ArtifactValidationError[];
  absRoot: string;
  /** Pricing override preserved across repairs (same as stage 4). */
  pricing: import("./pricing.js").PricingOverride | undefined;
  /** Ceiling for `maxTokens`; the actual value is computed once the closed key list is known. */
  outputTokenCeiling: number;
  outputTokenStrategy: "dynamic" | "fixed";
  thinking?: "disabled" | "adaptive" | "omit" | undefined;
  /** Node/edge budget for the diagram gate. */
  diagramBudgets: FlowDiagramBudget;
  /** Optional repair-attempt position; only set when `promptKind === "repair"`. */
  repairAttemptContext?: {
    attempt: number;
    total: number;
  };
  /** Recovery tier (Component 1): allow the surgical repair path. */
  surgicalRepair: boolean;
  /** Recovery tier (Component 2): relaxed contract + degraded marking (see AttemptOpts.relaxed). */
  relaxed?: boolean;
}

/**
 * ONE stage-5 LLM call: build the bounded flow context, generate PROSE
 * ONLY (the LLM never writes anything about `## Diagram`), and run the
 * stage-5 artifact pipeline —
 *
 *   normalize → generate the diagram deterministically
 *   (`generateFlowDiagram`, zero LLM calls) → insert the complete
 *   `## Diagram` section between `Ordered flow` and `Invariants`
 *   (`insertFlowDiagramSection`) → validate the complete page (flow
 *   pageKind).
 *
 * Priority-0 fix (2026-07-22): the old pipeline asked the LLM to write
 * Mermaid syntax freely and only had a mechanical repair for
 * oversized-but-valid flowcharts — genuinely malformed syntax
 * (`invalid_flow_diagram`) had NO deterministic recovery. The diagram is
 * now generated the same way the closed anchor list already is: the
 * graph decides, the LLM only writes prose. `validateMermaidSyntax` still
 * runs as defense in depth against a bug in the renderer itself — a
 * rejection there throws (an infra-level failure), never consumes an LLM
 * repair slot.
 *
 * The caller orchestrates the bounded loop; this function is "one turn of
 * the loop".
 */
async function attemptStage5Generation(
  opts: Stage5AttemptOpts,
): Promise<Stage5AttemptResult> {
  // Load context on each attempt (same contract as stage 4: the closed
  // list does not change between attempts of one run).
  const ctx = await buildFlowDocContext(
    opts.absRoot,
    opts.candidate,
    opts.modules,
    opts.charBudget,
  );
  const maxTokens = resolveOutputTokenBudget(
    opts.outputTokenStrategy,
    opts.outputTokenCeiling,
    { anchorCount: ctx.closedKeyList.length },
    MODULE_OUTPUT_BUDGET_OPTIONS,
  );

  // R10.1 K: the candidate's explicit semantic groups reach BOTH the
  // prompt (R10.1 D presentation) and the validator (D3 tier coverage).
  const flowKeyGroups: FlowKeyGroups = {
    entryKeys: opts.candidate.entryKeys,
    boundaryKeys: opts.candidate.boundaryKeys,
    sinkKeys: opts.candidate.sinkKeys,
  };
  // Workstream A: deterministic section homes for every closed-list key —
  // reaches the prompt (fixed table) and the mechanical repair (section
  // preference on dedup).
  const flowKeySectionMap = assignFlowKeySections(opts.candidate);

  let prompt: { system: string; user: string };
  // Recovery tier (Component 1): same surgical swap as stage 4. The splice
  // runs on the MODEL-EMITTED form (no deterministic `## Diagram` section
  // yet) — a target section that only exists post-insertion (e.g. Diagram)
  // is absent from the model form and therefore never becomes eligible.
  let surgicalPlan: SurgicalRepairPlan | null = null;
  if (opts.promptKind === "repair") {
    const attemptContext = opts.repairAttemptContext ?? { attempt: 1, total: 1 };
    if (opts.surgicalRepair) {
      surgicalPlan = await prepareSurgicalRepair(
        opts.absRoot,
        opts.priorCandidate,
        opts.priorErrors,
        ctx.symbolsTable,
      );
    }
    prompt = surgicalPlan !== null
      ? buildSurgicalRepairPrompt(
          "flow",
          surgicalPlan.basePage,
          opts.priorErrors,
          surgicalPlan.evidenceSlice,
          opts.language,
        )
      : buildStage5RepairPrompt(
          opts.candidate,
          ctx.closedKeyList,
          ctx.moduleOpenings,
          ctx.symbolsTable,
          ctx.truncatedSource,
          opts.priorCandidate,
          opts.priorErrors,
          opts.charBudget,
          opts.language,
          attemptContext,
          opts.diagramBudgets,
          flowKeyGroups,
          flowKeySectionMap,
        );
  } else {
    prompt = buildStage5Prompt(
      opts.candidate,
      ctx.closedKeyList,
      ctx.moduleOpenings,
      ctx.symbolsTable,
      ctx.truncatedSource,
      opts.language,
      opts.diagramBudgets,
      flowKeyGroups,
      flowKeySectionMap,
    );
  }

  // Call LLM (identical error accounting to stage 4).
  let raw: string;
  let usage: { inputTokens: number; outputTokens: number; model: string };
  let stopReason: StopReason = "unknown";
  let rawStopReason: string | undefined;
  try {
    const result = await opts.llmClient.generate({
      system: prompt.system,
      user: prompt.user,
      maxTokens,
      ...(opts.thinking ? { thinking: opts.thinking } : {}),
    });
    raw = result.content;
    usage = result.usage;
    stopReason = result.stopReason ?? "unknown";
    rawStopReason = result.rawStopReason;
  } catch (err) {
    // Typed timeout: usage unknown (provider may still bill). No fake 0/0 model.
    if (err instanceof LlmTimeoutError) {
      return {
        usageEntry: {
          attempt: opts.attemptNumber,
          usage: null,
          usageKnown: false,
          costUsd: null,
          finishedAt: Date.now(),
        },
        normalizedRaw: "",
        diagnosticCandidate: null,
        diagnosticOutcome: "llm_error",
        artifact: null,
        validationErrors: [],
        llmError: {
          code: "llm_timeout",
          message: err.message,
        },
        diagramSource: null,
      };
    }
    const e = err as Error;
    return {
      usageEntry: {
        attempt: opts.attemptNumber,
        usage: null,
        usageKnown: false,
        costUsd: null,
        finishedAt: Date.now(),
      },
      normalizedRaw: "",
      diagnosticCandidate: null,
      diagnosticOutcome: "llm_error",
      artifact: null,
      validationErrors: [],
      llmError: {
        code: "llm_call_failed",
        message: e.message,
      },
      diagramSource: null,
    };
  }

  const cost = computeCostFromUsage(usage, opts.pricing);
  const usageEntry: UsageAttempt = {
    attempt: opts.attemptNumber,
    usage,
    usageKnown: true,
    costUsd: cost,
    finishedAt: Date.now(),
    stopReason,
    ...(rawStopReason !== undefined ? { rawStopReason } : {}),
  };

  // Stop-reason gate (identical to stage 4).
  if (stopReason === "length" || stopReason === "incomplete") {
    const code =
      stopReason === "length"
        ? "truncated_by_token_limit"
        : "incomplete_generation";
    const reasonDetail = rawStopReason ? ` (provider reason: ${rawStopReason})` : "";
    return {
      usageEntry,
      normalizedRaw: raw,
      diagnosticCandidate: raw,
      diagnosticOutcome: code,
      artifact: null,
      validationErrors: [
        {
          code,
          message:
            stopReason === "length"
              ? `provider stopped at the output-token limit${reasonDetail}`
              : `provider stopped before a normal text completion${reasonDetail}`,
          location: "global",
        },
      ],
      llmError: null,
      diagramSource: null,
    };
  }

  // Normalize
  const normalize = normalizeStage4Artifact(raw);
  if (!normalize.ok) {
    return {
      usageEntry,
      normalizedRaw: raw,
      diagnosticCandidate: raw,
      diagnosticOutcome: "normalization_failed",
      artifact: null,
      validationErrors: normalize.errors,
      llmError: null,
      diagramSource: null,
    };
  }

  // Recovery tier (Component 1): anti-cascade guard on the model-emitted
  // form, BEFORE the deterministic diagram insertion and validation.
  let candidateContent = normalize.content;
  let surgicalOutcome: SurgicalOutcome | undefined;
  if (surgicalPlan !== null) {
    const spliced = spliceSections(
      surgicalPlan.basePage,
      normalize.content,
      surgicalPlan.targetSections,
    );
    if (spliced === null) {
      return {
        usageEntry,
        // Keep the ORIGINAL failed page as the next slot's repair input
        // (same anti-drift rule as stage 4).
        normalizedRaw: opts.priorCandidate,
        diagnosticCandidate: normalize.content,
        diagnosticOutcome: "artifact_validation_failed",
        artifact: null,
        validationErrors: opts.priorErrors,
        llmError: null,
        diagramSource: null,
        surgicalOutcome: "surgical_cascade_rejected",
      };
    }
    candidateContent = spliced;
    surgicalOutcome = "surgical_ok";
  }

  // Recovery tier (Component 2): the relaxed writer marks the artifact
  // degraded BEFORE the deterministic diagram insertion and validation.
  if (opts.relaxed === true) {
    candidateContent = markDegradedArtifact(candidateContent);
  }

  const invalid = (errors: ArtifactValidationError[]): Stage5AttemptResult => ({
    usageEntry,
    normalizedRaw: raw,
    diagnosticCandidate: candidateContent,
    diagnosticOutcome: "artifact_validation_failed",
    artifact: null,
    validationErrors: errors,
    llmError: null,
    diagramSource: null,
    ...(surgicalOutcome !== undefined ? { surgicalOutcome } : {}),
  });

  // (a) Generate the diagram deterministically — zero LLM involvement.
  //     The LLM never sees or writes anything about `## Diagram`; this
  //     replaces the old "extract what the LLM wrote" step entirely
  //     (Priority-0 fix: `invalid_flow_diagram` used to have no
  //     mechanical recovery for genuinely malformed LLM-written Mermaid).
  const diagramSource = generateFlowDiagram(opts.candidate, opts.modules, opts.diagramBudgets);

  // Defense in depth: a rejection here is a BUG IN generateFlowDiagram,
  // never a content-generation failure — it must not consume an LLM
  // repair slot or be surfaced as a normal validation error. Throwing
  // lets it propagate as an infra-level failure, same as an unexpected
  // LLM transport error would.
  const mermaidDiagnostic = await validateMermaidSyntax(diagramSource);
  if (mermaidDiagnostic !== null) {
    throw new Error(
      `generateFlowDiagram produced invalid Mermaid for flow "${opts.candidate.slug}" — ` +
        `this is a bug in flow-diagram.ts, not an LLM failure: ${mermaidDiagnostic}`,
    );
  }

  // (b) Insert the complete `## Diagram` section (heading + real fence)
  //     between `## Ordered flow` and `## Invariants` — the LLM's raw
  //     output never had this section at all. Under the relaxed contract
  //     `## Invariants` is optional, so the insertion may anchor on the
  //     Ordered flow section instead.
  const pageWithDiagram = insertFlowDiagramSection(candidateContent, opts.candidate.slug, {
    allowMissingInvariants: opts.relaxed === true,
  });
  if (pageWithDiagram === null) {
    return invalid([
      {
        code: "missing_page_opening",
        message:
          'could not locate the "Invariants" heading to insert the `## Diagram` section — ' +
          "the required flow opening (H1, Purpose, Ordered flow, Invariants, Failure and recovery, " +
          "Related pages) is missing or out of order",
        location: "body",
      },
    ]);
  }

  // (c) Validate the page with the real diagram already inserted.
  const validationContext = {
    pageKind: "flow" as const,
    expectedFlowDiagram: `livewiki/diagrams/flow-${opts.candidate.slug}.mmd`,
    expectedFlowModules: opts.candidate.moduleIds,
    moduleId: opts.candidate.slug,
    moduleRole: "product" as const,
    flowKeyGroups,
    ...(opts.relaxed === true ? { relaxed: true } : {}),
  };
  const validation = validateStage4Artifact(pageWithDiagram, ctx.closedKeyList, validationContext);
  let pageContent = pageWithDiagram;
  if (!validation.ok) {
    // Priority-0 Phase 2 follow-up: duplicate_anchor and missing_closed_key
    // are purely mechanical under the flow "upper bound" contract (see
    // repairUpperBoundArtifactMechanically) — try that BEFORE spending a
    // full LLM repair round-trip. Falls through to the LLM repair path for
    // any other error shape.
    const mechanical = repairUpperBoundArtifactMechanically(
      pageWithDiagram,
      validation.errors,
      ctx.closedKeyList,
      validationContext,
      flowKeySectionMap,
    );
    if (mechanical === null) {
      return invalid(validation.errors);
    }
    pageContent = mechanical.content;
  }

  return {
    usageEntry,
    normalizedRaw: raw,
    diagnosticCandidate: pageContent,
    diagnosticOutcome: null,
    artifact: pageContent,
    validationErrors: [],
    llmError: null,
    diagramSource,
    ...(surgicalOutcome !== undefined ? { surgicalOutcome } : {}),
  };
}

interface TopicAttemptOpts {
  attemptNumber: number;
  candidate: TopicCandidate;
  language: Language;
  llmClient: LlmClient;
  charBudget: number;
  /** Cap (chars) for the rationale evidence block; accounted before the hard charBudget throw. */
  rationaleMaxChars: number;
  promptKind: "initial" | "repair";
  priorCandidate: string;
  priorErrors: ArtifactValidationError[];
  absRoot: string;
  pricing: import("./pricing.js").PricingOverride | undefined;
  /** Ceiling for `maxTokens`; the actual value is computed from the candidate's seed keys. */
  outputTokenCeiling: number;
  outputTokenStrategy: "dynamic" | "fixed";
  /** Sum of `TopicPlanningInventory.anchorSourceChars` for this candidate's seed keys, when known. */
  anchorSourceChars?: number;
  thinking?: "disabled" | "adaptive" | "omit" | undefined;
  pathRoleConfig?: import("./modules.js").PathRoleConfig;
  repairAttemptContext?: { attempt: number; total: number };
  /** Recovery tier (Component 1): allow the surgical repair path. */
  surgicalRepair: boolean;
  /** Recovery tier (Component 2): relaxed contract + degraded marking (see AttemptOpts.relaxed). */
  relaxed?: boolean;
  /** D2 follow-up: module id → source paths, for the prose evidence block in buildTopicDocContext. */
  modulePaths?: ReadonlyMap<string, readonly string[]>;
}

async function attemptTopicGeneration(opts: TopicAttemptOpts): Promise<Stage4AttemptResult> {
  const ctx = await buildTopicDocContext(opts.absRoot, opts.candidate, opts.charBudget, opts.rationaleMaxChars, opts.modulePaths);
  const topicKeySectionMap = assignTopicKeySections(opts.candidate);
  const maxTokens = resolveOutputTokenBudget(
    opts.outputTokenStrategy,
    opts.outputTokenCeiling,
    {
      anchorCount: opts.candidate.seedKeys.length,
      ...(opts.anchorSourceChars !== undefined ? { anchorSourceChars: opts.anchorSourceChars } : {}),
    },
    MODULE_OUTPUT_BUDGET_OPTIONS,
  );
  // Recovery tier (Component 1): same surgical swap as stages 4/5.
  let surgicalPlan: SurgicalRepairPlan | null = null;
  if (opts.promptKind === "repair" && opts.surgicalRepair) {
    surgicalPlan = await prepareSurgicalRepair(
      opts.absRoot,
      opts.priorCandidate,
      opts.priorErrors,
      ctx.symbolsTable,
    );
  }
  const prompt = surgicalPlan !== null
    ? buildSurgicalRepairPrompt(
        "topic",
        surgicalPlan.basePage,
        opts.priorErrors,
        surgicalPlan.evidenceSlice,
        opts.language,
      )
    : opts.promptKind === "repair"
    ? buildTopicRepairPrompt(
        opts.candidate,
        ctx.moduleDigest,
        ctx.symbolsTable,
        ctx.truncatedSource,
        opts.priorCandidate,
        opts.priorErrors,
        opts.charBudget,
        opts.language,
        opts.repairAttemptContext ?? { attempt: 1, total: 1 },
        topicKeySectionMap,
        ctx.rationaleEvidence,
        ctx.proseEvidence,
      )
    : buildTopicPrompt(
        opts.candidate,
        ctx.moduleDigest,
        ctx.symbolsTable,
        ctx.truncatedSource,
        opts.language,
        topicKeySectionMap,
        ctx.rationaleEvidence,
        ctx.proseEvidence,
      );
  let result: GenerateResult;
  try {
    result = await opts.llmClient.generate({
      system: prompt.system,
      user: prompt.user,
      maxTokens,
      ...(opts.thinking ? { thinking: opts.thinking } : {}),
    });
  } catch (error) {
    return {
      usageEntry: { attempt: opts.attemptNumber, usage: null, usageKnown: false, costUsd: null, finishedAt: Date.now() },
      normalizedRaw: "",
      diagnosticCandidate: null,
      diagnosticOutcome: "llm_error",
      artifact: null,
      validationErrors: [],
      llmError: { code: error instanceof LlmTimeoutError ? "llm_timeout" : "llm_error", message: (error as Error).message },
    };
  }
  const usageEntry: UsageAttempt = {
    attempt: opts.attemptNumber,
    usage: result.usage,
    usageKnown: true,
    costUsd: computeCostFromUsage(result.usage, opts.pricing),
    finishedAt: Date.now(),
    ...(result.stopReason !== undefined ? { stopReason: result.stopReason } : {}),
    ...(result.rawStopReason !== undefined ? { rawStopReason: result.rawStopReason } : {}),
  };
  if (result.stopReason === "length" || result.stopReason === "incomplete") {
    const code = result.stopReason === "length" ? "truncated_by_token_limit" : "incomplete_generation";
    return {
      usageEntry,
      normalizedRaw: result.content,
      diagnosticCandidate: result.content,
      diagnosticOutcome: code,
      artifact: null,
      validationErrors: [{ code, message: `topic generation ended with stop reason ${result.rawStopReason ?? result.stopReason}`, location: "global" }],
      llmError: null,
    };
  }
  const normalized = normalizeStage4Artifact(result.content);
  if (!normalized.ok) {
    return {
      usageEntry,
      normalizedRaw: normalized.content,
      diagnosticCandidate: normalized.content || null,
      diagnosticOutcome: "normalization_failed",
      artifact: null,
      validationErrors: normalized.errors,
      llmError: null,
    };
  }
  // Recovery tier (Component 1): anti-cascade guard before validation.
  let candidateContent = normalized.content;
  let surgicalOutcome: SurgicalOutcome | undefined;
  if (surgicalPlan !== null) {
    const spliced = spliceSections(
      surgicalPlan.basePage,
      normalized.content,
      surgicalPlan.targetSections,
    );
    if (spliced === null) {
      return {
        usageEntry,
        // Keep the ORIGINAL failed page as the next slot's repair input
        // (same anti-drift rule as stage 4).
        normalizedRaw: opts.priorCandidate,
        diagnosticCandidate: normalized.content,
        diagnosticOutcome: "artifact_validation_failed",
        artifact: null,
        validationErrors: opts.priorErrors,
        llmError: null,
        surgicalOutcome: "surgical_cascade_rejected",
      };
    }
    candidateContent = spliced;
    surgicalOutcome = "surgical_ok";
  }
  // Recovery tier (Component 2): the relaxed writer marks the artifact
  // degraded BEFORE validation (same rule as stages 4/5).
  if (opts.relaxed === true) {
    candidateContent = markDegradedArtifact(candidateContent);
  }
  const validationContext = {
    pageKind: "topic" as const,
    moduleId: opts.candidate.slug,
    moduleRole: "product" as const,
    expectedTopicTitle: opts.candidate.title,
    expectedTopicOrder: opts.candidate.planOrder,
    expectedTopicIntent: opts.candidate.intent,
    expectedTopicModules: opts.candidate.modules,
    expectedTopicFlows: opts.candidate.flows,
    topicKeyGroups: opts.candidate.groups,
    topicProductKeys: opts.candidate.seedKeys.filter((key) =>
      classifyPathRole(key.split("#", 1)[0] ?? "", opts.pathRoleConfig) === "product"
    ),
    ...(opts.relaxed === true ? { relaxed: true } : {}),
  };
  const validation = validateStage4Artifact(candidateContent, opts.candidate.seedKeys, validationContext);
  let pageContent = candidateContent;
  if (!validation.ok) {
    // Same upper-bound contract as flow pages: duplicate_anchor and
    // missing_closed_key have an unambiguous mechanical fix. Try it before
    // spending a full LLM repair round-trip — v24 paid E2E showed a topic
    // page's final repair attempt left with a single duplicate_anchor
    // that this fallback resolves without another LLM call. `topicKeySectionMap`
    // (assignTopicKeySections) lets dedup prefer the assigned section's
    // occurrence, exactly like the flow path's flowKeySectionMap.
    const mechanical = repairUpperBoundArtifactMechanically(
      candidateContent,
      validation.errors,
      opts.candidate.seedKeys,
      validationContext,
      topicKeySectionMap,
      TOPIC_SECTION_HEADING_MAP,
    );
    if (mechanical === null) {
      return {
        usageEntry,
        normalizedRaw: normalized.content,
        diagnosticCandidate: candidateContent,
        diagnosticOutcome: "artifact_validation_failed",
        artifact: null,
        validationErrors: validation.errors,
        llmError: null,
        ...(surgicalOutcome !== undefined ? { surgicalOutcome } : {}),
      };
    }
    pageContent = mechanical.content;
  }
  return {
    usageEntry,
    normalizedRaw: normalized.content,
    diagnosticCandidate: pageContent,
    diagnosticOutcome: null,
    artifact: pageContent,
    validationErrors: [],
    llmError: null,
    ...(surgicalOutcome !== undefined ? { surgicalOutcome } : {}),
  };
}

interface TopicDocContext {
  symbolsTable: string;
  moduleDigest: string;
  truncatedSource: string;
  /** Etapa 2b: rendered rationale evidence lines (unfenced, unneutralized). */
  rationaleEvidence: string;
  /** D2 follow-up: rendered prose-file excerpts (unfenced, unneutralized); "" when no prose paths or no budget left. */
  proseEvidence: string;
}

/** Per-file cap for one prose evidence excerpt in a topic prompt (D2 follow-up). */
const TOPIC_PROSE_FILE_MAX_CHARS = 1_500;

export async function buildTopicDocContext(
  absRoot: string,
  candidate: TopicCandidate,
  charBudget: number,
  rationaleMaxChars = 0,
  modulePaths?: ReadonlyMap<string, readonly string[]>,
): Promise<TopicDocContext> {
  const db = openIndex(await safeIo.resolveAndValidate(absRoot, ".livewiki/index.db"));
  try {
    const placeholders = candidate.seedKeys.map(() => "?").join(",");
    const symbols = (candidate.seedKeys.length === 0 ? [] : db.prepare(
      `SELECT s.key, s.name, s.kind, s.signature, s.start_line AS startLine,
              s.end_line AS endLine, f.path
       FROM symbols s JOIN files f ON f.id = s.file_id
       WHERE s.status = 'active' AND s.key IN (${placeholders})`,
    ).all(...candidate.seedKeys)) as Array<{
      key: string; name: string; kind: string; signature: string | null;
      startLine: number; endLine: number; path: string;
    }>;
    symbols.sort((a, b) => a.key.localeCompare(b.key));
    const symbolsTable = symbols.map((symbol) => `- ${symbol.key} (${symbol.kind}): ${symbol.signature ?? ""}`).join("\n");
    const digest: string[] = [];
    for (const moduleId of candidate.modules) {
      const page = await safeIo.readText(absRoot, `livewiki/${moduleId}.md`).catch(() => null);
      digest.push(`### Module: ${moduleId}\n\n${page === null ? "Page unavailable" : extractModuleOpeningDigest(page)}`);
    }
    for (const flowSlug of candidate.flows) {
      const page = await safeIo.readText(absRoot, `livewiki/flows/${flowSlug}.md`).catch(() => null);
      digest.push(`### Flow: ${flowSlug}\n\n${page === null ? "Page unavailable" : extractModuleOpeningDigest(page)}`);
    }
    const sourceFiles = new Map<string, string[]>();
    const sourceSpans: string[] = [];
    for (const symbol of symbols) {
      let lines = sourceFiles.get(symbol.path);
      if (lines === undefined) {
        const source = await nodeFs.readFile(nodePath.join(absRoot, symbol.path), "utf8");
        lines = source.split("\n");
        sourceFiles.set(symbol.path, lines);
      }
      // Shared exact span math with the topic planner estimate
      // (renderTopicSourceSpan in topics.ts) — the two must never drift.
      sourceSpans.push(renderTopicSourceSpan(symbol, lines));
    }
    const truncatedSource = sourceSpans.join(TOPIC_SOURCE_SPAN_SEPARATOR);
    // Etapa 2b: rationale rows for the seed-key files, bounded by
    // rationaleMaxChars and accounted BEFORE the hard topicMaxSourceChars
    // throw, so the throw never fires on rationale alone.
    const rationalePaths = [...new Set(symbols.map((symbol) => symbol.path))].sort();
    const rationaleEvidence = rationaleMaxChars > 0 && rationalePaths.length > 0
      ? renderRationaleEvidence(
          db.prepare(
            `SELECT f.path, r.symbol_key, r.kind, r.text, r.start_line
             FROM rationales r JOIN files f ON f.id = r.file_id
             WHERE f.path IN (${rationalePaths.map(() => "?").join(",")})
             ORDER BY f.path, r.start_line, r.id`,
          ).all(...rationalePaths) as RationaleEvidenceRow[],
          rationaleMaxChars,
        )
      : "";
    if (rationaleEvidence.length + truncatedSource.length > charBudget) {
      throw new Error(`accepted topic evidence exceeds topicMaxSourceChars (${rationaleEvidence.length + truncatedSource.length} > ${charBudget})`);
    }
    // D2 follow-up (MPTP measurement run, 2026-07-27): prose-tier files
    // (Dockerfile, compose files, launchers, docs) have no symbol keys, so
    // the closed list can never reference them — without their content the
    // model could not describe deployment surfaces honestly (the
    // "deployment" topic came out about the CLI because cli.py owned every
    // closed key). Excerpt the candidate modules' prose files here, carved
    // from the budget LEFT OVER after anchors + rationale, so the hard
    // throw above stays unreachable and the planner estimate needs no
    // change. Prose = an indexed file with zero active symbols.
    let proseEvidence = "";
    if (modulePaths !== undefined) {
      const candidatePaths = [
        ...new Set(candidate.modules.flatMap((id) => modulePaths.get(id) ?? [])),
      ].sort();
      if (candidatePaths.length > 0) {
        const proseRows = db.prepare(
          `SELECT f.path FROM files f
           WHERE f.path IN (${candidatePaths.map(() => "?").join(",")})
             AND NOT EXISTS (SELECT 1 FROM symbols s WHERE s.file_id = f.id AND s.status = 'active')
           ORDER BY f.path`,
        ).all(...candidatePaths) as Array<{ path: string }>;
        let remaining = charBudget - (rationaleEvidence.length + truncatedSource.length);
        const blocks: string[] = [];
        for (const row of proseRows) {
          const header = `// === ${row.path} (prose file — no canonical keys; describe, never cite as an anchor) ===\n`;
          const budget = Math.min(TOPIC_PROSE_FILE_MAX_CHARS, remaining - header.length);
          if (budget <= 0) break;
          const source = await nodeFs.readFile(nodePath.join(absRoot, row.path), "utf8").catch(() => null);
          if (source === null || source.trim() === "") continue;
          const block = header + source.slice(0, budget);
          blocks.push(block);
          remaining -= block.length;
        }
        proseEvidence = blocks.join(TOPIC_SOURCE_SPAN_SEPARATOR);
      }
    }
    return {
      symbolsTable,
      moduleDigest: digest.join("\n\n"),
      truncatedSource,
      rationaleEvidence,
      proseEvidence,
    };
  } finally {
    db.close();
  }
}

interface FlowDocContext {
  closedKeyList: string[];
  symbolsTable: string;
  moduleOpenings: string;
  truncatedSource: string;
}

/**
 * Stage-5 context builder (mirrors buildModuleDocContext): the closed
 * seed key list (candidate.seedKeys), the seed symbols table, a bounded
 * digest of each participating module's accepted page (H1 +
 * responsibility paragraph + `How it fits` block, in walk order), and a
 * fair-share truncated source excerpt of the candidate modules' files —
 * never the whole repository.
 */
async function buildFlowDocContext(
  absRoot: string,
  candidate: FlowCandidate,
  modules: ReadonlyArray<Module>,
  charBudget: number,
): Promise<FlowDocContext> {
  const db = openIndex(
    await safeIo.resolveAndValidate(absRoot, ".livewiki/index.db"),
  );
  try {
    const closedKeyList = [...candidate.seedKeys].sort();
    const placeholders = closedKeyList.map(() => "?").join(",");
    const seedSymbols = (closedKeyList.length > 0
      ? db
          .prepare(
            `SELECT key, name, kind, signature FROM symbols
             WHERE status = 'active' AND key IN (${placeholders})`,
          )
          .all(...closedKeyList)
      : []) as Array<{
      key: string;
      name: string;
      kind: string;
      signature: string | null;
    }>;
    seedSymbols.sort((a, b) => a.key.localeCompare(b.key));
    const symbolsTable = seedSymbols
      .map((s) => `- ${s.key} (${s.kind}): ${s.signature ?? ""}`)
      .join("\n");

    // Participating module page digests, in walk order. An absent page is
    // reported honestly instead of inventing an opening.
    const openings: string[] = [];
    for (const moduleId of candidate.moduleIds) {
      const content = await safeIo
        .readText(absRoot, `livewiki/${moduleId}.md`)
        .catch(() => null);
      if (content === null) {
        openings.push(`### ${moduleId}\n\n- ${moduleId} (page unavailable)`);
        continue;
      }
      openings.push(`### ${moduleId}\n\n${extractModuleOpeningDigest(content)}`);
    }

    // Bounded source: candidate modules' files in walk order, deduped.
    const moduleById = new Map(modules.map((m) => [m.id, m]));
    const flowFiles: string[] = [];
    const seenFiles = new Set<string>();
    for (const moduleId of candidate.moduleIds) {
      for (const p of moduleById.get(moduleId)?.paths ?? []) {
        if (seenFiles.has(p)) continue;
        seenFiles.add(p);
        flowFiles.push(p);
      }
    }
    const truncatedSource = await buildFairTruncatedSource(absRoot, flowFiles, charBudget);

    return {
      closedKeyList,
      symbolsTable,
      moduleOpenings: openings.join("\n\n"),
      truncatedSource,
    };
  } finally {
    db.close();
  }
}

/**
 * Stage-5 write transaction: page + companion diagram as one unit.
 * Manual-block injection and `owner: mixed` restoration on the page work
 * exactly like `tryWriteAndVerify`. BOTH writes AND the repository-wide
 * verify run inside one try/catch (R10.1 item A): ANY exception (the
 * diagram write failing after the page landed, the verifier crashing)
 * rolls BOTH artifacts back best-effort. Verify rejects on ANY issue —
 * error OR warning — scoped to the two written paths (R10.1 item B; a
 * deliberate asymmetry with stage 4, which keeps the error-only filter),
 * and a rejection also rolls BOTH artifacts back (restore snapshots /
 * remove newly created). The flows hub is synced between the writes and
 * verify and rolled back with the pair: the page contract requires a
 * `[How it works](index.md)` link in `Related pages`
 * (prompts.ts FLOW_PAGE_PROMPT_RULES), so the hub must exist on disk
 * before verify or the R10.1 B gate flags broken_internal_link on every
 * fresh-repo flow task. A human/mixed/unparseable hub is preserved
 * (skipped-owner) and already satisfies the link by existing.
 * A rollback failure is terminal for the run (`rollback_failed`), whether
 * the rollback was triggered by an exception or by a verify rejection.
 */
interface FlowWriteResult {
  ok: boolean;
  artifacts?: {
    wikiPath: string;
    pageHash: string;
    diagramPath: string;
    diagramHash: string;
  };
  issues?: VerifyIssue[];
  /** The write/verify step threw; both artifacts were rolled back. Terminal for the task. */
  exception?: { message: string };
  /** True when verify rejected AND the subsequent rollback failed. Terminal. */
  rollbackFailed?: { reason: string };
}

async function tryWriteFlowAndVerify(
  absRoot: string,
  pagePath: string,
  diagramPath: string,
  pageContent: string,
  diagramSource: string,
  existingPage: string | null,
): Promise<FlowWriteResult> {
  // 1. Manual blocks in the original position + `owner: mixed` restore —
  //    byte-for-byte identical mechanism to tryWriteAndVerify (rule #6).
  let finalContent = pageContent;
  if (existingPage !== null) {
    const positioned = injectManualBlocksBySection(existingPage, pageContent);
    if (positioned !== null) {
      finalContent = positioned;
    }
    if (readOwnerFromFrontmatter(existingPage) === "mixed") {
      finalContent = forceOwnerInFrontmatter(finalContent, "mixed");
    }
  }

  const pageSnapshot = existingPage;
  const diagramSnapshot = await safeIo.readText(absRoot, diagramPath).catch(() => null);
  // The flows hub joins the transaction (docstring above): synced after the
  // pair lands, rolled back with it. Only a hub the sync actually rewrote
  // enters the rollback set — a skipped-owner hub was never touched.
  const hubPath = "livewiki/flows/index.md";
  const hubSnapshot = await safeIo.readText(absRoot, hubPath).catch(() => null);
  let hubWritten = false;

  // 2+3. Write both artifacts via safe-io (page first, diagram second),
  //    sync the flows hub, then verify — ALL inside one try/catch (R10.1
  //    item A): ANY exception (the diagram write failing after the page
  //    landed, the verifier crashing) rolls the artifacts back best-effort,
  //    exactly like a verify rejection.
  let verifyResult: VerifyResult;
  try {
    await safeIo.writeText(absRoot, pagePath, finalContent);
    await safeIo.writeText(
      absRoot,
      diagramPath,
      diagramSource.endsWith("\n") ? diagramSource : diagramSource + "\n",
    );
    hubWritten =
      (await syncFlowsIndexHub(absRoot, await loadFlowPresentations(absRoot))).outcome ===
      "written";
    verifyResult = await runVerify(absRoot);
  } catch (e) {
    const reasons = await rollbackWrittenArtifacts(
      absRoot,
      [
        { path: pagePath, snapshot: pageSnapshot },
        { path: diagramPath, snapshot: diagramSnapshot },
        ...(hubWritten ? [{ path: hubPath, snapshot: hubSnapshot }] : []),
      ],
      true,
    );
    if (reasons.length > 0) {
      return { ok: false, rollbackFailed: { reason: reasons.join("; ") } };
    }
    return { ok: false, exception: { message: (e as Error).message } };
  }

  // 3b. ANY issue — error OR warning — on EITHER written path rejects the
  //    pair (R10.1 item B; deliberate asymmetry with the error-only stage-4
  //    gate). Issues on other paths never block this gate.
  const broken = verifyResult.issues.filter(
    (i) => i.wikiPath === pagePath || i.wikiPath === diagramPath,
  );

  if (broken.length > 0) {
    // 4. ROLLBACK MANDATORY for BOTH artifacts (same rule as stage 4):
    //    an invalid candidate pair MUST NEVER persist on disk — and the
    //    hub synced with it goes back too.
    const reasons = await rollbackWrittenArtifacts(
      absRoot,
      [
        { path: pagePath, snapshot: pageSnapshot },
        { path: diagramPath, snapshot: diagramSnapshot },
        ...(hubWritten ? [{ path: hubPath, snapshot: hubSnapshot }] : []),
      ],
      false,
    );
    if (reasons.length > 0) {
      return {
        ok: false,
        issues: broken,
        rollbackFailed: { reason: reasons.join("; ") },
      };
    }
    return { ok: false, issues: broken };
  }

  return {
    ok: true,
    artifacts: {
      wikiPath: pagePath,
      pageHash: sha256(finalContent),
      diagramPath,
      diagramHash: sha256(diagramSource),
    },
  };
}
