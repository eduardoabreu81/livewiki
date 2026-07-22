import type { Command } from "commander";
import * as path from "node:path";
import { runBatch, resumeBatch, runOnly } from "@livewiki/core/batch";
import { buildStatusReport, listRuns } from "@livewiki/core/batch-status";
import { emit } from "../output.js";
import { resolveRepoRoot } from "../cli.js";

interface BatchOptions {
  json?: boolean;
  repo?: string;
  /** --only <target>: re-roda 1 task */
  only?: string;
  /**
   * Commander maps `--no-refine` → `refine === false` (not `noRefine`).
   * Default is true when the negated option is declared.
   */
  refine?: boolean;
}

/**
 * `livewiki batch <run>` — Phase 3. Subcommands:
 *
 *   batch status [<runId>]    (default) — run report
 *   batch resume <runId>      — continue pending/failed tasks
 *   batch --only <target> <runId> — re-run 1 task
 *   batch list                — list runs
 *
 * Exit codes:
 *   0 = completed (success)
 *   1 = completed_with_failures
 *   2 = aborted (circuit breaker)
 */
export function registerBatch(program: Command): void {
  program
    .command("batch")
    .description(
      "run/resume/inspect a full-documentation batch (Phase 3). Use `livewiki batch --help` for subcommands",
    )
    .option("--only <target>", "re-run 1 task (module or task-id)")
    .option("--no-refine", "skip LLM refinement of stage 2")
    .action(async (_options: BatchOptions, command: Command) => {
      const opts = command.optsWithGlobals<BatchOptions & { args?: string[] }>();
      const json = Boolean(opts.json);
      const repoRoot = resolveRepoRoot(opts.repo);
      const absRoot = path.resolve(process.cwd(), repoRoot);
      const args = command.args ?? [];

      try {
        // No args: status of the last run
        if (args.length === 0) {
          const report = await buildStatusReport(absRoot);
          emit(json, report, formatStatusHuman(report));
          return setExitCode(absRoot, report.run.status, json);
        }

        const sub = args[0];

        // batch list
        if (sub === "list") {
          const runs = await listRuns(absRoot);
          emit(json, { ok: true, runs }, formatListHuman(runs));
          return;
        }

        // batch status [runId]
        if (sub === "status") {
          const runId = args[1] !== undefined ? parseInt(args[1], 10) : null;
          if (runId !== null && Number.isNaN(runId)) {
            throw new Error(`invalid runId: ${args[1]}`);
          }
          const report = await buildStatusReport(absRoot, runId);
          emit(json, report, formatStatusHuman(report));
          return setExitCode(absRoot, report.run.status, json);
        }

        // batch resume <runId>
        if (sub === "resume") {
          const runId = args[1] !== undefined ? parseInt(args[1], 10) : undefined;
          if (runId === undefined || Number.isNaN(runId)) {
            throw new Error("usage: livewiki batch resume <runId>");
          }
          const result = await resumeBatch({
            repoRoot: absRoot,
            // Commander `--no-refine` → opts.refine === false
            ...(opts.refine === false ? { noRefine: true } : {}),
          });
          emit(json, result, formatResultHuman(result));
          return setExitCode(absRoot, result.status, json);
        }

        // batch --only <target> <runId>
        if (opts.only) {
          const runIdStr = args[0];
          if (runIdStr === undefined || Number.isNaN(parseInt(runIdStr, 10))) {
            throw new Error("usage: livewiki batch --only <target> <runId>");
          }
          const result = await runOnly({
            repoRoot: absRoot,
            onlyTarget: opts.only,
          });
          emit(json, result, formatResultHuman(result));
          return setExitCode(absRoot, result.status, json);
        }

        // batch <runId> — alias for status
        if (sub === undefined) {
          throw new Error("missing subcommand");
        }
        const runId = parseInt(sub, 10);
        if (Number.isNaN(runId)) {
          throw new Error(
            `unknown subcommand: ${sub}\n` +
              `Usage: livewiki batch [status [<runId>] | resume <runId> | --only <target> <runId> | list]`,
          );
        }
        const report = await buildStatusReport(absRoot, runId);
        emit(json, report, formatStatusHuman(report));
        return setExitCode(absRoot, report.run.status, json);
      } catch (err) {
        process.stderr.write(`livewiki batch: error — ${(err as Error).message}\n`);
        // FIX L (rev2): see init.ts. Abrupt `process.exit(1)` can crash
        // libuv on Windows if any async handle is still open.
        process.exitCode = 1;
        return;
      }
    });
}

/** Shared incomplete-usage note (status + result human output). */
export const USAGE_INCOMPLETE_NOTE =
  "Note: totals are incomplete — some attempts have unknown usage. Prefer proxy/provider billing for wire cost.";

/**
 * B2 (Lot B): one compact ordered line per diagnostic entry. Mirrors
 * the format used inside `repair_exhausted` in core/batch.ts so the
 * human output is consistent with what gets persisted in the
 * checkpoint error message.
 *
 * `stopReason` falls back to "-" when the LLM did not provide one
 * (e.g. `llm_error` outcomes). Codes are deduplicated but preserve
 * first-seen order so the user can match against the validator
 * enumeration.
 */
function formatDiagnosticLine(d: {
  attempt: number;
  stopReason?: string;
  outcome: string;
  errors: Array<{ code: string }>;
}): string {
  const stopReason = d.stopReason ?? "-";
  const seen = new Set<string>();
  const codes: string[] = [];
  for (const e of d.errors) {
    if (seen.has(e.code)) continue;
    seen.add(e.code);
    codes.push(e.code);
  }
  return `attempt ${d.attempt}: ${stopReason} -> ${d.outcome}` +
    (codes.length > 0 ? ` [${codes.join(", ")}]` : "");
}

/**
 * B2 (Lot B): for failed stage-4 tasks, print the compact per-attempt
 * sequence derived from `diagnosticHistory`. Falls back silently when
 * the checkpoint pre-dates diagnostics (CONTRACT I5) or when the task
 * never reached the LLM (e.g. `refused_human_page`).
 */
function appendStage4Diagnostics(
  lines: string[],
  report: Awaited<ReturnType<typeof buildStatusReport>>,
  failureTaskId: number,
): void {
  const task = report.tasks.find((t) => t.taskId === failureTaskId);
  if (!task?.diagnosticHistory || task.diagnosticHistory.length === 0) return;
  lines.push(`    attempts:`);
  for (const d of task.diagnosticHistory) {
    lines.push(`      ${formatDiagnosticLine(d)}`);
  }
}

export function formatStatusHuman(report: Awaited<ReturnType<typeof buildStatusReport>>): string {
  // Token-first (ad87319): tokens are the primary metric, USD is secondary
  // and omitted without drama when no pricing exists. Each stage/module line
  // starts with tokens; USD appears as a separate "estimated" line.
  const lines: string[] = [];
  lines.push(`livewiki batch — run #${report.run.id} (${report.run.status})`);
  lines.push(`  started: ${new Date(report.run.startedAt).toISOString()} (by ${report.run.startedBy})`);
  if (report.run.finishedAt) {
    lines.push(`  finished: ${new Date(report.run.finishedAt).toISOString()}`);
  }
  // Priority-0 fix: authoritative task counts (all stages: 4 + 5 flows +
  // 5 topics), from the same persisted `cb.done`/`cb.fails` `finalizeRun`
  // wrote — not `byModule.length` (a usage-tracking array that, further
  // below, is scoped to stage 4 only and previously disagreed with
  // `livewiki batch`'s own end-of-run "tasks done" line for the same run).
  if (report.run.summary) {
    lines.push(
      `  tasks: ${report.run.summary.tasksDone} done, ${report.run.summary.tasksFailed} failed`,
    );
  }
  lines.push("");
  lines.push("Tokens (primary metric):");
  const t = report.totals;
  lines.push(
    `  Total:        ${t.inputTokens.toLocaleString()} input + ${t.outputTokens.toLocaleString()} output` +
      (t.models.length > 0 ? `  (${t.models.join(", ")})` : ""),
  );
  if (t.usageIncomplete) {
    lines.push(`  ${USAGE_INCOMPLETE_NOTE}`);
  }
  for (const [stage, u] of Object.entries(report.byStage)) {
    lines.push(
      `  Stage ${stage}:      ${u.inputTokens.toLocaleString()} input + ${u.outputTokens.toLocaleString()} output`,
    );
  }
  // USD as a secondary line, always marked "estimated" — omitted without drama
  // when the model has no pricing.
  const hasAnyUsd = t.costUsd !== null
    || Object.values(report.byStage).some((u) => u.costUsd !== null);
  if (hasAnyUsd) {
    lines.push("");
    lines.push(`USD (estimated, table as of ${report.pricingRefDate}):`);
    const totalStr = t.costUsd !== null ? `$${t.costUsd.toFixed(4)}` : "(no price)";
    lines.push(`  Total:        ${totalStr}`);
    for (const [stage, u] of Object.entries(report.byStage)) {
      const c = u.costUsd !== null ? `$${u.costUsd.toFixed(4)}` : "(no price)";
      lines.push(`  Stage ${stage}:      ${c}`);
    }
  } else {
    lines.push("");
    lines.push(`USD: omitted (no model with pricing in table as of ${report.pricingRefDate})`);
  }
  if (report.byModule.length > 0) {
    lines.push("");
    lines.push("Per module (tokens):");
    for (const m of report.byModule) {
      const usd = m.costUsd !== null ? `  ~$${m.costUsd.toFixed(4)}` : "";
      lines.push(
        `  ${m.module.padEnd(20)} ${m.inputTokens.toLocaleString()} + ${m.outputTokens.toLocaleString()}${usd}`,
      );
    }
  }
  if (report.failures.length > 0) {
    lines.push("");
    lines.push(`Failures (${report.failures.length}):`);
    for (const f of report.failures) {
      lines.push(`  [${f.error.code}] ${f.module}: ${f.error.message}`);
      // B2: per-task diagnostic sequence for failed stage-4 tasks.
      if (f.stage === 4) {
        appendStage4Diagnostics(lines, report, f.taskId);
      }
      lines.push(`    retry: ${f.retryCommand}`);
    }
  }
  return lines.join("\n");
}

export function formatResultHuman(result: Awaited<ReturnType<typeof runBatch>>): string {
  // Token-first (ad87319): totals tokens first, USD estimated in a
  // secondary line when pricing exists.
  const lines: string[] = [];
  lines.push(`livewiki batch — run #${result.runId} (${result.status})`);
  const t = result.totals;
  lines.push(
    `  tokens: ${t.inputTokens.toLocaleString()} input + ${t.outputTokens.toLocaleString()} output` +
      (t.models.length > 0 ? `  (${t.models.join(", ")})` : ""),
  );
  if (t.usageIncomplete) {
    lines.push(`  ${USAGE_INCOMPLETE_NOTE}`);
  }
  if (t.costUsd !== null) {
    lines.push(`  USD (estimated): $${t.costUsd.toFixed(4)}`);
  } else if (t.inputTokens + t.outputTokens > 0 || t.usageIncomplete) {
    lines.push(
      t.usageIncomplete
        ? `  USD: unknown/incomplete (observed totals only)`
        : `  USD: omitted (model without pricing)`,
    );
  }
  // Priority-0 fix: `byModule.length` mixed done+failed entries across
  // stages 4/5 and disagreed with `batch status`'s stage-4-only count for
  // the same run. `tasksDone`/`tasksFailed` are the authoritative
  // per-task counters, consistent everywhere they're reported.
  lines.push(`  tasks done: ${result.tasksDone}`);
  lines.push(`  failures: ${result.failures.length}`);
  if (result.circuitBreakerTriggered) {
    lines.push(`  circuit breaker: TRIGGERED`);
  }
  // R10.1 C: a preserved human/mixed/unparseable flows hub is never silent.
  if (result.skippedFlowsHub) {
    lines.push(
      `  flows hub: preserved (owner: ${result.skippedFlowsHub.owner ?? "unknown"}) — ${result.skippedFlowsHub.path} not overwritten`,
    );
  }
  if (result.skippedAuxiliaryHub) {
    lines.push(
      `  auxiliary hub: preserved (owner: ${result.skippedAuxiliaryHub.owner ?? "unknown"}) — ${result.skippedAuxiliaryHub.path} not overwritten`,
    );
  }
  if (result.skippedTopicsHub) {
    lines.push(
      `  topics hub: preserved (owner: ${result.skippedTopicsHub.owner ?? "unknown"}) — ${result.skippedTopicsHub.path} not overwritten`,
    );
  }
  // R10.1 K: deterministic pre-LLM flow skips are never silent either.
  for (const s of result.skippedFlowCandidates ?? []) {
    lines.push(`  flow skipped: ${s.slug} (${s.code}) — ${s.message}`);
  }
  // Priority-0 fix (v25 paid E2E): an exhausted topic plan is optional/
  // additive, not a batch failure — never silent either.
  if (result.skippedTopicPlan) {
    lines.push(`  topics skipped: ${result.skippedTopicPlan.reason}`);
    lines.push(`    retry: ${result.skippedTopicPlan.retryCommand}`);
  }
  if (result.failures.length > 0) {
    lines.push("");
    lines.push("Failures:");
    for (const f of result.failures) {
      lines.push(`  [${f.error.code}] ${f.module}: ${f.error.message}`);
      lines.push(`    retry: ${f.retryCommand}`);
    }
  }
  return lines.join("\n");
}

function formatListHuman(runs: Awaited<ReturnType<typeof listRuns>>): string {
  const lines: string[] = [];
  lines.push(`Batch runs:`);
  if (runs.length === 0) {
    lines.push("  (none)");
    return lines.join("\n");
  }
  for (const r of runs) {
    const finished = r.finishedAt !== null ? new Date(r.finishedAt).toISOString() : "(running)";
    lines.push(`  #${r.id}  ${r.status.padEnd(25)}  started ${new Date(r.startedAt).toISOString()}  finished ${finished}`);
  }
  return lines.join("\n");
}

function setExitCode(repoRoot: string, status: string, json: boolean): void {
  if (json) return; // --json always exit 0 (structured output)
  // Let Node drain pending I/O before exiting. All call sites invoke this
  // as their final action-handler statement.
  if (status === "completed") process.exitCode = 0;
  if (status === "completed_with_failures") process.exitCode = 1;
  if (status === "aborted") process.exitCode = 2;
}
