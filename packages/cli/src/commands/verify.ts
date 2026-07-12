import type { Command } from "commander";
import * as path from "node:path";
import { run as runVerify, formatHuman as formatVerifyHuman, type VerifyResult } from "@livewiki/core/verify";

interface VerifyOptions {
  json?: boolean;
  repo?: string;
}

/**
 * `livewiki verify` — validates wiki against index: broken anchors, altered
 * manual blocks, internal links.
 *
 * SPEC §"CLI commands": "Exits with non-zero on failure (CI-friendly)".
 */
export function registerVerify(program: Command): void {
  program
    .command("verify")
    .description(
      "validate wiki: anchors + manual blocks + internal links. Exit ≠ 0 on failure (Phase 2, CI-friendly)",
    )
    .action(async (_options: VerifyOptions, command: Command) => {
      const opts = command.optsWithGlobals<VerifyOptions>();
      const json = Boolean(opts.json);
      const repoRoot = path.resolve(process.cwd(), opts.repo ?? ".");
      let result: VerifyResult;
      try {
        result = await runVerify(repoRoot);
      } catch (err) {
        process.stderr.write(`livewiki verify: error — ${(err as Error).message}\n`);
        // An abrupt exit after writing stderr can crash libuv on Windows
        // while I/O is pending. Let Node drain the event loop naturally.
        process.exitCode = 1;
        return;
      }
      if (json) {
        process.stdout.write(JSON.stringify(result) + "\n");
      } else {
        process.stdout.write(formatVerifyHuman(result) + "\n");
      }
      // CI-friendly: exit code != 0 if there are errors
      if (!result.ok) process.exitCode = 1;
    });
}
