import type { Command } from "commander";
import * as path from "node:path";
import { run as runStatus, formatHuman as formatStatusHuman } from "@livewiki/core/status";

interface StatusOptions {
  json?: boolean;
  repo?: string;
  top?: string;
}

/**
 * `livewiki status` — index report (Phase 1: files + symbols).
 * Debt + undocumented enter in Phase 2.
 */
export function registerStatus(program: Command): void {
  program
    .command("status")
    .description(
      "show open debt, undocumented symbols, pending batch (Phase 1/2)",
    )
    .option("--top <n>", "how many files to show in the top list (default 10)", "10")
    .action(async (_options: StatusOptions, command: Command) => {
      // commander 12 does not pass global options in the 1st action arg.
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
        process.stderr.write(`livewiki status: error — ${(err as Error).message}\n`);
        // Let Node drain pending stderr I/O before exiting.
        process.exitCode = 1;
      }
    });
}
