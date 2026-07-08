import type { Command } from "commander";
import * as path from "node:path";
import { run as runStatus, formatHuman as formatStatusHuman } from "@livewiki/core/status";

interface StatusOptions {
  json?: boolean;
  repo?: string;
  top?: string;
}

/**
 * `livewiki status` — relatório do índice (Fase 1: arquivos + símbolos).
 * Dívida + undocumented entram na Fase 2.
 */
export function registerStatus(program: Command): void {
  program
    .command("status")
    .description(
      "mostrar dívida aberta, símbolos novos sem doc, batch pendente (Fase 1/2)",
    )
    .option("--top <n>", "quantos arquivos mostrar no top (default 10)", "10")
    .action(async (_options: StatusOptions, command: Command) => {
      // commander 12 não passa opções globais no 1º arg do action.
      const opts = command.optsWithGlobals<StatusOptions>();
      const json = Boolean(opts.json);
      const repoRoot = path.resolve(process.cwd(), opts.repo ?? ".");
      const topN = opts.top ? Number.parseInt(opts.top, 10) : 10;
      try {
        const report = await runStatus(repoRoot, { topN });
        if (json) {
          process.stdout.write(JSON.stringify({ ok: true, ...report }) + "\n");
        } else {
          process.stdout.write(formatStatusHuman(report) + "\n");
        }
      } catch (err) {
        process.stderr.write(`livewiki status: erro — ${(err as Error).message}\n`);
        process.exit(1);
      }
    });
}