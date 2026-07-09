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
  /** --no-refine: pula refinamento LLM da etapa 2 */
  noRefine?: boolean;
}

/**
 * `livewiki batch <run>` — Fase 3. Subcomandos:
 *
 *   batch status [<runId>]    (default) — reporte do run
 *   batch resume <runId>      — continua tasks pending/failed
 *   batch --only <target> <runId> — re-roda 1 task
 *   batch list                — lista runs
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
      "rodar/retomar/inspecionar batch de documentação completa (Fase 3). Use 'livewiki batch --help' para subcomandos",
    )
    .option("--only <target>", "re-roda 1 task (módulo ou task-id)")
    .option("--no-refine", "pular refinamento LLM da etapa 2")
    .action(async (_options: BatchOptions, command: Command) => {
      const opts = command.optsWithGlobals<BatchOptions & { args?: string[] }>();
      const json = Boolean(opts.json);
      const repoRoot = resolveRepoRoot(opts.repo);
      const absRoot = path.resolve(process.cwd(), repoRoot);
      const args = command.args ?? [];

      try {
        // Sem args: status do último run
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
            ...(opts.noRefine ? { noRefine: true } : {}),
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

        // batch <runId> — alias pra status
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
        process.stderr.write(`livewiki batch: erro — ${(err as Error).message}\n`);
        // FIX L (rev2): ver init.ts. `process.exit(1)` abrupto pode crashar
        // o libuv no Windows se algum handle async ficou aberto.
        process.exitCode = 1;
        return;
      }
    });
}

function formatStatusHuman(report: Awaited<ReturnType<typeof buildStatusReport>>): string {
  // token-first (ad87319): tokens são a métrica primária, USD é secundário e
  // omitido sem drama quando não há pricing. Cada linha de stage/module
  // começa com tokens; USD aparece como linha separada marcada "estimado".
  const lines: string[] = [];
  lines.push(`livewiki batch — run #${report.run.id} (${report.run.status})`);
  lines.push(`  started: ${new Date(report.run.startedAt).toISOString()} (by ${report.run.startedBy})`);
  if (report.run.finishedAt) {
    lines.push(`  finished: ${new Date(report.run.finishedAt).toISOString()}`);
  }
  lines.push("");
  lines.push("Tokens (métrica primária):");
  const t = report.totals;
  lines.push(
    `  Total:        ${t.inputTokens.toLocaleString()} input + ${t.outputTokens.toLocaleString()} output` +
      (t.models.length > 0 ? `  (${t.models.join(", ")})` : ""),
  );
  for (const [stage, u] of Object.entries(report.byStage)) {
    lines.push(
      `  Stage ${stage}:      ${u.inputTokens.toLocaleString()} input + ${u.outputTokens.toLocaleString()} output`,
    );
  }
  // USD como linha secundária, sempre marcada "estimado" — omitida sem drama
  // se o modelo não tem pricing.
  const hasAnyUsd = t.costUsd !== null
    || Object.values(report.byStage).some((u) => u.costUsd !== null);
  if (hasAnyUsd) {
    lines.push("");
    lines.push(`USD (estimado, tabela de ${report.pricingRefDate}):`);
    const totalStr = t.costUsd !== null ? `$${t.costUsd.toFixed(4)}` : "(sem preço)";
    lines.push(`  Total:        ${totalStr}`);
    for (const [stage, u] of Object.entries(report.byStage)) {
      const c = u.costUsd !== null ? `$${u.costUsd.toFixed(4)}` : "(sem preço)";
      lines.push(`  Stage ${stage}:      ${c}`);
    }
  } else {
    lines.push("");
    lines.push(`USD: omitido (nenhum modelo com pricing na tabela de ${report.pricingRefDate})`);
  }
  if (report.byModule.length > 0) {
    lines.push("");
    lines.push("Por módulo (tokens):");
    for (const m of report.byModule) {
      const usd = m.costUsd !== null ? `  ~$${m.costUsd.toFixed(4)}` : "";
      lines.push(
        `  ${m.module.padEnd(20)} ${m.inputTokens.toLocaleString()} + ${m.outputTokens.toLocaleString()}${usd}`,
      );
    }
  }
  if (report.failures.length > 0) {
    lines.push("");
    lines.push(`Falhas (${report.failures.length}):`);
    for (const f of report.failures) {
      lines.push(`  [${f.error.code}] ${f.module}: ${f.error.message}`);
      lines.push(`    retry: ${f.retryCommand}`);
    }
  }
  return lines.join("\n");
}

function formatResultHuman(result: Awaited<ReturnType<typeof runBatch>>): string {
  // token-first (ad87319): totals tokens primeiro, USD estimado em linha
  // secundária quando há pricing.
  const lines: string[] = [];
  lines.push(`livewiki batch — run #${result.runId} (${result.status})`);
  const t = result.totals;
  lines.push(
    `  tokens: ${t.inputTokens.toLocaleString()} input + ${t.outputTokens.toLocaleString()} output` +
      (t.models.length > 0 ? `  (${t.models.join(", ")})` : ""),
  );
  if (t.costUsd !== null) {
    lines.push(`  USD (estimado): $${t.costUsd.toFixed(4)}`);
  } else if (t.inputTokens + t.outputTokens > 0) {
    lines.push(`  USD: omitido (modelo sem pricing)`);
  }
  lines.push(`  tasks done: ${result.byModule.length}`);
  lines.push(`  failures: ${result.failures.length}`);
  if (result.circuitBreakerTriggered) {
    lines.push(`  circuit breaker: TRIGGERED`);
  }
  if (result.failures.length > 0) {
    lines.push("");
    lines.push("Falhas:");
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
  if (json) return; // --json sempre exit 0 (output estruturado)
  if (status === "completed") process.exit(0);
  if (status === "completed_with_failures") process.exit(1);
  if (status === "aborted") process.exit(2);
}