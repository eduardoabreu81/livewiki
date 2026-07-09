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

/** Stages do pipeline batch. */
export type BatchStage = 1 | 2 | 3 | 4;

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
 */
export interface UsageAttempt {
  attempt: number;
  usage: LlmUsage;
  costUsd: CostUsd | null;
  finishedAt: number;
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
  error?: TaskError;
  artifacts?: TaskArtifacts;
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
}

/** Item do reporte `byStage` (agregado por stage). */
export interface StageUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  /** Models distintos usados nesse stage (pra debugging de drift). */
  models: string[];
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
  error?: TaskError;
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
 */
export interface BatchRunSummary {
  totals: StageUsage;
  byStage: Record<string, StageUsage>;
  byModule: ModuleUsage[];
  tasksDone: number;
  tasksFailed: number;
  tasksPending: number;
}

/** Shape completo do `livewiki batch status --json`. */
export interface BatchStatusReport {
  run: {
    id: number;
    status: BatchRunStatus;
    startedAt: number;
    finishedAt: number | null;
    startedBy: string;
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