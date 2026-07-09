import type { Command } from "commander";
import * as path from "node:path";
import { run as runVerify, formatHuman as formatVerifyHuman, type VerifyResult } from "@livewiki/core/verify";

interface VerifyOptions {
  json?: boolean;
  repo?: string;
}

/**
 * `livewiki verify` — valida wiki contra índice: âncoras quebradas, manual
 * blocks alterados, links internos.
 *
 * SPEC §"Comandos CLI": "Sai com código ≠ 0 se falhar (CI-friendly)".
 */
export function registerVerify(program: Command): void {
  program
    .command("verify")
    .description(
      "validar wiki: âncoras + manual blocks + links internos. Exit ≠ 0 se falhar (Fase 2, CI-friendly)",
    )
    .action(async (_options: VerifyOptions, command: Command) => {
      const opts = command.optsWithGlobals<VerifyOptions>();
      const json = Boolean(opts.json);
      const repoRoot = path.resolve(process.cwd(), opts.repo ?? ".");
      let result: VerifyResult;
      try {
        result = await runVerify(repoRoot);
      } catch (err) {
        process.stderr.write(`livewiki verify: erro — ${(err as Error).message}\n`);
        process.exit(1);
        return;
      }
      if (json) {
        process.stdout.write(JSON.stringify(result) + "\n");
      } else {
        process.stdout.write(formatVerifyHuman(result) + "\n");
      }
      // CI-friendly: exit code != 0 se houver errors
      if (!result.ok) process.exit(1);
    });
}