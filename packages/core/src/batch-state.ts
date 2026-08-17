/**
 * batch-state — shape of `batch_tasks.checkpoint_json` and helper types.
 *
 * SPEC §"Token accounting (Phase 3)": every task that calls the LLM records
 * the real usage in the checkpoint. `livewiki batch status <run>` aggregates
 * everything by stage + by module + total. The report is the heart of the
 * savings comparison against OpenWiki and the like.
 *
 * `checkpoint_json` is free TEXT in the DB (schema v4). The types here live
 * in TypeScript code — single source of truth, validated at runtime by the
 * orchestrator and by the LLM adapters.
 *
 * usageHistory convention (fix from the plan review): ALWAYS a list, from
 * attempt 1 on. "current usage" = last item. The report aggregates. Avoids
 * a shape migration in the future when retry comes into play.
 */

import type { LlmUsage } from "./llm/types.js";
import type { ArtifactValidationError } from "./prompts.js";
import type { MechanicalArtifactRepair } from "./artifact-repair.js";
import type { TopicCandidate } from "./topics.js";
import type { CommunityCrossCheckReport } from "./community.js";

/** Stages of the batch pipeline. */
export type BatchStage = 1 | 2 | 3 | 4 | 5;

export type BatchTaskStatus = "pending" | "running" | "done" | "failed" | "skipped";

export type BatchRunStatus =
  | "running"
  | "completed"
  | "completed_with_failures"
  | "aborted";

/**
 * Cost estimate in USD per LLM call. Null when the model is not in the
 * pricing table — in that case the report shows tokens without USD, it never
 * invents them.
 */
export interface CostUsd {
  input: number;
  output: number;
  total: number;
  /** Reference date of the pricing table used (YYYY-MM-DD). */
  refDate: string;
}

/**
 * One attempt within a task's usage history.
 * Each retry stacks a new item here — the report aggregates the sum.
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
 * Checkpoint of a task. Persisted as JSON in batch_tasks.checkpoint_json.
 *
 * Canonical shape:
 *   - stage: which pipeline step (1..4)
 *   - status: current state of the task
 *   - attempt: how many times this task was run (1 = first time)
 *   - usageHistory: ALWAYS a list, even on the first attempt. Empty only if
 *     the task does not call the LLM (e.g. step 1 scan is just a re-index,
 *     step 3 prioritization is purely deterministic).
 *   - error: filled in when status='failed' or when the circuit breaker
 *     aborted because of this task.
 *   - artifacts: paths/hashes of what the task produced (wiki page, etc.)
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
  /**
   * MCP bootstrap queue metadata. Additive and absent from API-backed runs.
   * The queue is generic by task kind; the persisted descriptor is enough
   * to re-offer an abandoned task after the MCP server restarts.
   */
  agentTask?: import("./agent-bootstrap.js").PersistedAgentTask;
}

export interface TaskError {
  code: string;
  message: string;
  /** stage where it failed (normally = task.stage, but a circuit breaker abort may point at the last one). */
  failedAt?: BatchStage;
}

export interface TaskArtifacts {
  /** Path of the generated wiki page (relative to repoRoot). */
  wikiPath?: string;
  /** SHA-256 of the page's final content (post-verify). */
  pageHash?: string;
  /** Stage 5: companion flow diagram path (relative to repoRoot). */
  diagramPath?: string;
  /** Stage 5: SHA-256 of the diagram source as written. */
  diagramHash?: string;
}

/** `byStage` report item (aggregated by stage). */
export interface StageUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  /** Distinct models used in this stage (for drift debugging). */
  models: string[];
  /**
   * True if any attempt had unknown usage (e.g. llm_timeout). Known token
   * totals then under-report wire cost; prefer proxy/provider billing.
   */
  usageIncomplete?: boolean;
}

/** `byModule` report item (stage=4 tasks aggregated by module). */
export interface ModuleUsage extends StageUsage {
  module: string;
}

/** `tasks` report item (detailed list of every task). */
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
  /** Ready-to-use retry command: `livewiki batch --only <target> <runId>` */
  retryCommand: string;
}

/** `failures` report item (subset of tasks with status='failed'). */
export interface FailureReportItem {
  taskId: number;
  module: string;
  stage: BatchStage;
  error: TaskError;
  retryCommand: string;
}

/**
 * Aggregated snapshot written to batch_runs.summary_json at the end of the run.
 * Enables the report without having to re-process every task.
 *
 * `modulesRefined` is the final list of modules stage 4 used — it may differ
 * from the heuristic one if the (opt-in) LLM refinement kicked in.
 * Kept HERE (and not in a task's `checkpoint_json`) because it is a
 * property of the RUN, not of the stage-2 task (finding J from rev2).
 */
export interface BatchRunSummary {
  totals: StageUsage;
  byStage: Record<string, StageUsage>;
  byModule: ModuleUsage[];
  tasksDone: number;
  tasksFailed: number;
  tasksPending: number;
  /** Final list of modules (post-refinement). Null if not written yet. */
  modulesRefined: Array<{ id: string; paths: string[]; displayTitle?: string }> | null;
  /**
   * Recovery tier (Component 2): wiki paths of pages completed under the
   * relaxed contract (`quality: degraded`). Additive, mirroring the
   * `modulesRefined` precedent — absent on runs with no degraded pages and
   * in summaries persisted before this field existed.
   */
  degradedPages?: string[];
  /** Execution surface for additive status/report compatibility. */
  executor?: "api" | "agent";
  /** Agent sessions do not expose token usage; never report fabricated zero. */
  accounting?: "available" | "unavailable";
  /** The MCP bootstrap deliberately keeps the deterministic topic plan. */
  topicRefine?: "not-run";
}

/** Lightweight module (without symbolCount) for serializing into summary_json. */
export interface RefinedModuleSnapshot {
  id: string;
  paths: string[];
}

/** Complete shape of `livewiki batch status --json`. */
export interface BatchStatusReport {
  run: {
    id: number;
    status: BatchRunStatus;
    startedAt: number;
    finishedAt: number | null;
    startedBy: string;
    /**
     * Aggregated summary written to batch_runs.summary_json (refined modules +
     * totals per stage). Null if the run is still in progress OR if the
     * summary_json was corrupted by an old version of livewiki.
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
 * `pendingBatch` inside .manifest.json — enables cross-machine handoff of an
 * interrupted batch. null when there is no batch in progress.
 */
export interface PendingBatchRef {
  runId: number;
  stage: BatchStage;
  done: number;
  total: number;
}
