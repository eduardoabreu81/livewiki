import type { Command } from "commander";
import * as path from "node:path";
import { runInit, type InitPlanReport } from "@livewiki/core/init";
import { emit } from "../output.js";
import { resolveRepoRoot } from "../cli.js";

interface InitOptions {
  json?: boolean;
  repo?: string;
  batch?: boolean;
  plan?: boolean;
  noRefine?: boolean;
}

/**
 * `livewiki init` (Fase 3 — real): cria livewiki/ + .livewiki/, indexa, gera
 * layout determinístico (quickstart + diagramas + manifest). Sem LLM.
 *
 * Flags:
 *   --batch: dispara pipeline LLM completo (etapas 1-4)
 *   --plan: mostra plano de módulos (heurística, SEM LLM, sem escrita)
 *   --no-refine: pula refinamento LLM da etapa 2 (só com --batch)
 */
export function registerInit(program: Command): void {
  program
    .command("init")
    .description(
      "inicializa livewiki: cria livewiki/ + .livewiki/, indexa, gera layout (Fase 3). --batch dispara pipeline LLM. --plan mostra plano sem escrever",
    )
    .option("--batch", "rodar pipeline LLM completo de documentação")
    .option("--plan", "mostrar plano de módulos (sem LLM, sem escrita)")
    .option("--no-refine", "pular refinamento LLM da etapa 2 (etapa 2 fica só com heurística)")
.action(async (_options: InitOptions, command: Command) => {
      const opts = command.optsWithGlobals<InitOptions>();
      const json = Boolean(opts.json);
      const repoRoot = resolveRepoRoot(opts.repo);
      try {
        const result = await runInit({
          repoRoot: path.resolve(process.cwd(), repoRoot),
          ...(opts.batch !== undefined ? { batch: opts.batch } : {}),
          ...(opts.plan !== undefined ? { plan: opts.plan } : {}),
          ...(opts.noRefine !== undefined ? { noRefine: opts.noRefine } : {}),
          quiet: json,
        });
        emit(
          json,
          {
            ok: true,
            plan: result.plan,
            filesWritten: result.filesWritten,
            batchSummary: result.batchSummary,
            batchExitCode: result.batchExitCode,
          },
          formatHuman(result),
        );
        // (O): propagar exit code do batch (statusToExitCode no core).
        // --json preserva exit 0 (output estruturado, convenção do batch CLI).
        // Sem --batch: sempre 0 (init base é sucesso).
        if (!json && result.batchExitCode !== undefined) {
          process.exitCode = result.batchExitCode;
        }
      } catch (err) {
        process.stderr.write(`livewiki init: erro — ${(err as Error).message}\n`);
        // FIX L (rev2): usar `process.exitCode` em vez de `process.exit(1)`.
        // O `process.exit` abrupto pode dar libuv assert (STATUS_STACK_BUFFER_OVERRUN
        // = 0xC0000409, exit code -1073740791 no Windows) se o Node tiver
        // handles async abertos (ex.: fetch em vôo, WAL do SQLite, watcher).
        // Setar `exitCode` deixa o event loop drenar antes de sair.
        process.exitCode = 1;
        return;
      }
    });
  }

function formatHuman(result: { plan?: InitPlanReport; filesWritten: string[]; batchSummary?: { runId: number; status: string; tasksDone: number; tasksFailed: number }; batchExitCode?: 0 | 1 | 2 }): string {
  const lines: string[] = [];
  if (result.plan) {
    lines.push(`livewiki init --plan (no writes, no LLM):`);
    lines.push(`  modules: ${result.plan.modules.length}`);
    lines.push(`  files: ${result.plan.totalFiles}`);
    lines.push(`  symbols: ${result.plan.totalSymbols}`);
    lines.push(`  edges: ${result.plan.edges.length}`);
    lines.push("");
    lines.push(`  Ordered (prioritized):`);
    for (const m of result.plan.ordered) {
      lines.push(`    - ${m.id} (${m.paths.length} files, ${m.symbolCount} symbols)`);
    }
    return lines.join("\n");
  }
  lines.push(`livewiki init: OK`);
  lines.push(`  files written: ${result.filesWritten.length}`);
  for (const f of result.filesWritten) {
    lines.push(`    ${f}`);
  }
  if (result.batchSummary) {
    lines.push("");
    lines.push(`  batch run #${result.batchSummary.runId}: ${result.batchSummary.status}`);
    lines.push(`    tasks: ${result.batchSummary.tasksDone} done, ${result.batchSummary.tasksFailed} failed`);
    if (result.batchExitCode !== undefined) {
      lines.push(`    exit code: ${result.batchExitCode}`);
    }
  }
  return lines.join("\n");
}