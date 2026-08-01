/**
 * batch-state — shape do `batch_tasks.checkpoint_json` e tipos auxiliares.
 *
 * SPEC §"Contabilidade de tokens (Fase 3)": cada task que chama LLM grava o
 * usage real no checkpoint. `livewiki batch status <run>` agrega tudo por
 * stage + por módulo + total. O reporte é o coração da comparação de
 * economia com OpenWiki e afins.
 *
 * O `checkpoint_json` é TEXT livre no DB (schema v4). Os tipos aqui vivem em
 * código TypeScript — single source of truth, validado em runtime pelo
 * orchestrator e pelos adapters do LLM.
 *
 * Convenção de usageHistory (correção da revisão do plano): SEMPRE uma lista,
 * desde o attempt 1. "usage atual" = último item. Reporte agrega. Evita
 * migração de shape no futuro quando retry entra em jogo.
 */

import type { LlmUsage } from "./llm/types.js";
import type { ArtifactValidationError } from "./prompts.js";
import type { MechanicalArtifactRepair } from "./artifact-repair.js";
import type { TopicCandidate } from "./topics.js";
import type { CommunityCrossCheckReport } from "./community.js";

/** Stages do pipeline batch. */
export type BatchStage = 1 | 2 | 3 | 4 | 5;

export type BatchTaskStatus = "pending" | "running" | "done" | "failed" | "skipped";

export type BatchRunStatus =
  | "running"
  | "completed"
  | "completed_with_failures"
  | "aborted";

/**
 * Estimativa de custo em USD por chamada LLM. Null quando o modelo não está
 * na tabela de pricing — nesse caso o reporte mostra tokens sem USD, nunca
 * inventa.
 */
export interface CostUsd {
  input: number;
  output: number;
  total: number;
  /** Data de referência da tabela de pricing usada (YYYY-MM-DD). */
  refDate: string;
}

/**
 * Uma tentativa (attempt) dentro do histórico de usage de uma task.
 * Cada retry empilha um novo item aqui — o reporte agrega a soma.
 *
 * When `usageKnown` is false (e.g. client timeout), `usage` is null and
 * aggregators must not treat the attempt as zero-token real usage. Wire/cost
 * may still exist at the provider; totals are incomplete.
 */
export interface UsageAttempt {
  attempt: number;
  /** Known usage from a completed response; null when unknown (timeout). */
  usage: LlmUsage | null;
  /** false ⇒ usage is null; do not invent 0/0 tokens. */
  usageKnown: boolean;
  costUsd: CostUsd | null;
  finishedAt: number;
  /** Normalized provider completion signal for this response, when known. */
  stopReason?: import("./llm/types.js").StopReason;
  /** Original provider value retained for diagnostics. */
  rawStopReason?: string;
}

/** Outcome category of one stage-4 attempt. Exactly one per attempt. */
export type DiagnosticOutcome =
  | "llm_error"
  | "incomplete_generation"
  | "truncated_by_token_limit"
  | "normalization_failed"
  | "artifact_validation_failed"
  | "verify_failed"
  | "write_verify_exception"
  | "success";

/** Bounded, content-safe summary of one structured error. */
export interface DiagnosticErrorSummary {
  /** ArtifactValidationCode, verify issue code, or llm error code. */
  code: string;
  location: "frontmatter" | "section" | "body" | "global";
  sectionSlug?: string;
  /** Truncated to DIAGNOSTIC_TEXT_CAP chars. */
  offending?: string;
  /** Truncated to DIAGNOSTIC_TEXT_CAP chars. */
  message: string;
}

/** One append-only diagnostic record per stage-4 LLM attempt. */
export interface DiagnosticAttempt {
  /**
   * GLOBAL attempt number — same counter as UsageAttempt.attempt.
   * Join key for the 1:1 invariant.
   */
  attempt: number;
  /** Normalized stop reason, when a provider response arrived. */
  stopReason?: import("./llm/types.js").StopReason;
  /** Raw provider value, when known. */
  rawStopReason?: string;
  outcome: DiagnosticOutcome;
  /** Prompt kind actually used on THIS attempt. */
  promptKind: "initial" | "repair";
  /** False when an incomplete retry did not consume a bounded slot; absent means consumed. */
  budgetConsumed?: boolean;
  /** Structured errors, capped at DIAGNOSTIC_MAX_ERRORS entries. Empty on success. */
  errors: DiagnosticErrorSummary[];
  /** Number of error entries dropped by the cap. 0 when none. */
  truncatedErrorCount: number;
  /** Char count of the candidate text. Absent when no candidate exists (llm_error). */
  candidateChars?: number;
  /** SHA-256 (hex) of the candidate text. Absent when no candidate exists. */
  candidateSha256?: string;
  /** Deterministic last-slot repairs applied after this LLM response. */
  mechanicalRepairs?: MechanicalArtifactRepair[];
  finishedAt: number;
}

export const DIAGNOSTIC_TEXT_CAP = 200;
export const DIAGNOSTIC_MAX_ERRORS = 50;

/**
 * Convert artifact errors into persistence-safe summaries without mutating
 * the caller's errors or retaining unbounded text.
 */
export function summarizeDiagnosticErrors(
  input: ReadonlyArray<ArtifactValidationError>,
): { errors: DiagnosticErrorSummary[]; truncatedErrorCount: number } {
  const errors = input.slice(0, DIAGNOSTIC_MAX_ERRORS).map((error) => ({
    code: error.code,
    location: error.location,
    ...(error.sectionSlug !== undefined ? { sectionSlug: error.sectionSlug } : {}),
    ...(error.offending !== undefined
      ? { offending: error.offending.slice(0, DIAGNOSTIC_TEXT_CAP) }
      : {}),
    message: error.message.slice(0, DIAGNOSTIC_TEXT_CAP),
  }));
  return {
    errors,
    truncatedErrorCount: Math.max(0, input.length - errors.length),
  };
}

/**
 * Checkpoint de uma task. Persistido como JSON em batch_tasks.checkpoint_json.
 *
 * Shape canônico:
 *   - stage: qual step do pipeline (1..4)
 *   - status: estado atual da task
 *   - attempt: número de vezes que essa task foi rodada (1 = primeira vez)
 *   - usageHistory: SEMPRE lista, mesmo na primeira tentativa. Vazio só se a
 *     task não chama LLM (ex.: etapa 1 varredura é só re-index, etapa 3
 *     priorização é puramente determinística).
 *   - error: preenchido quando status='failed' ou quando circuit breaker
 *     abortou por causa dessa task.
 *   - artifacts: paths/hashes do que a task produziu (página wiki, etc.)
 */
export interface TaskCheckpoint {
  stage: BatchStage;
  status: BatchTaskStatus;
  attempt: number;
  startedAt: number;
  finishedAt?: number;
  usageHistory: UsageAttempt[];
  diagnosticHistory?: DiagnosticAttempt[];
  error?: TaskError;
  artifacts?: TaskArtifacts;
  /** Accepted semantic plan persisted byte-for-byte for resume/--only. */
  topicPlan?: TopicCandidate[];
  /** Exact accepted planner response, retained for audit and deterministic reuse. */
  topicPlanRaw?: string;
  /**
   * Recovery tier (Component 2): this task completed under the relaxed
   * contract — the page carries `quality: degraded` in frontmatter plus the
   * reader notice. Additive; absent on strict completions and failures.
   */
  degraded?: boolean;
  /**
   * Roadmap item 9 (diagnostic-only): community-detection cross-check of
   * the stage-2 HEURISTIC partition against import-graph communities.
   * Additive; absent when `communityDetection` is off, when the
   * cross-check itself failed (diagnostics never abort a run), and in
   * checkpoints persisted before this field existed. Never affects task
   * or run status.
   */
  communityCrossCheck?: CommunityCrossCheckReport;
}

export interface TaskError {
  code: string;
  message: string;
  /** stage em que falhou (normalmente = task.stage, mas circuit breaker abort pode apontar pro último). */
  failedAt?: BatchStage;
}

export interface TaskArtifacts {
  /** Path da página wiki gerada (relativo ao repoRoot). */
  wikiPath?: string;
  /** SHA-256 do conteúdo final da página (pós-verify). */
  pageHash?: string;
  /** Stage 5: companion flow diagram path (relative to repoRoot). */
  diagramPath?: string;
  /** Stage 5: SHA-256 of the diagram source as written. */
  diagramHash?: string;
}

/** Item do reporte `byStage` (agregado por stage). */
export interface StageUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  /** Models distintos usados nesse stage (pra debugging de drift). */
  models: string[];
  /**
   * True if any attempt had unknown usage (e.g. llm_timeout). Known token
   * totals then under-report wire cost; prefer proxy/provider billing.
   */
  usageIncomplete?: boolean;
}

/** Item do reporte `byModule` (agregado por task stage=4 agrupado por módulo). */
export interface ModuleUsage extends StageUsage {
  module: string;
}

/** Item do reporte `tasks` (lista detalhada de cada task). */
export interface TaskReportItem {
  taskId: number;
  stage: BatchStage;
  target: string;
  status: BatchTaskStatus;
  attempts: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  /** True if this task had attempts with unknown usage. */
  usageIncomplete?: boolean;
  error?: TaskError;
  /**
   * Additive per-task diagnostic history (stage-4 only). Surfaced from
   * `batch_tasks.checkpoint_json.diagnosticHistory` when present.
   * Absent for older checkpoints that pre-date the field (backward
   * compat per CONTRACT I5).
   */
  diagnosticHistory?: DiagnosticAttempt[];
  /**
   * Roadmap item 9 (diagnostic-only): stage-2 community cross-check
   * report, surfaced from `batch_tasks.checkpoint_json.communityCrossCheck`
   * when present (same additive backward-compat pattern as
   * `diagnosticHistory`). Only ever set on the stage-2 task.
   */
  communityCrossCheck?: CommunityCrossCheckReport;
  /** Comando pronto pra retry: `livewiki batch --only <target> <runId>` */
  retryCommand: string;
}

/** Item do reporte `failures` (subset de tasks com status='failed'). */
export interface FailureReportItem {
  taskId: number;
  module: string;
  stage: BatchStage;
  error: TaskError;
  retryCommand: string;
}

/**
 * Snapshot agregado gravado em batch_runs.summary_json ao final do run.
 * Permite o reporte sem precisar re-processar todas as tasks.
 *
 * `modulesRefined` é a lista final de módulos que o stage 4 usou — pode
 * diferir da heurística se o refinamento LLM (opt-in) entrou em ação.
 * Guardado AQUI (e não no `checkpoint_json` de uma task) porque é uma
 * propriedade do RUN, não da task de stage 2 (achado J da rev2).
 */
export interface BatchRunSummary {
  totals: StageUsage;
  byStage: Record<string, StageUsage>;
  byModule: ModuleUsage[];
  tasksDone: number;
  tasksFailed: number;
  tasksPending: number;
  /** Lista final de módulos (pós-refinamento). Null se ainda não foi gravado. */
  modulesRefined: Array<{ id: string; paths: string[]; displayTitle?: string }> | null;
  /**
   * Recovery tier (Component 2): wiki paths of pages completed under the
   * relaxed contract (`quality: degraded`). Additive, mirroring the
   * `modulesRefined` precedent — absent on runs with no degraded pages and
   * in summaries persisted before this field existed.
   */
  degradedPages?: string[];
}

/** Módulo lightweight (sem symbolCount) pra serializar no summary_json. */
export interface RefinedModuleSnapshot {
  id: string;
  paths: string[];
}

/** Shape completo do `livewiki batch status --json`. */
export interface BatchStatusReport {
  run: {
    id: number;
    status: BatchRunStatus;
    startedAt: number;
    finishedAt: number | null;
    startedBy: string;
    /**
     * Summary agregado gravado em batch_runs.summary_json (módulos refinados +
     * totais por stage). Null se o run ainda está em andamento OU se o
     * summary_json foi corrompido por uma versão antiga do livewiki.
     */
    summary: BatchRunSummary | null;
  };
  totals: StageUsage;
  byStage: Record<string, StageUsage>;
  byModule: ModuleUsage[];
  tasks: TaskReportItem[];
  failures: FailureReportItem[];
  pricingRefDate: string;
}

/**
 * `pendingBatch` dentro do .manifest.json — habilita handoff cross-máquina
 * de batch interrompido. null quando não há batch em andamento.
 */
export interface PendingBatchRef {
  runId: number;
  stage: BatchStage;
  done: number;
  total: number;
}
