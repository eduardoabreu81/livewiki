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
 * `livewiki init` (Phase 3 — real): creates livewiki/ + .livewiki/, indexes,
 * generates deterministic layout (quickstart + diagrams + manifest). No LLM.
 *
 * Flags:
 *   --batch: triggers full LLM pipeline (stages 1-4)
 *   --plan: shows module plan (heuristic, NO LLM, no writes)
 *   --no-refine: skips LLM refinement of stage 2 (only with --batch)
 */
export function registerInit(program: Command): void {
  program
    .command("init")
    .description(
      "initialize livewiki: creates livewiki/ + .livewiki/, indexes, generates layout (Phase 3). --batch triggers full LLM pipeline. --plan shows plan without writing",
    )
    .option("--batch", "run the full LLM documentation pipeline")
    .option("--plan", "show the module plan (no LLM, no writes)")
    .option("--no-refine", "skip LLM refinement of stage 2 (stage 2 stays heuristic-only)")
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
        // (O): propagate the batch exit code (statusToExitCode in core).
        // --json preserves exit 0 (structured output, batch CLI convention).
        // Without --batch: always 0 (base init is success).
        if (!json && result.batchExitCode !== undefined) {
          process.exitCode = result.batchExitCode;
        }
      } catch (err) {
        process.stderr.write(`livewiki init: error — ${(err as Error).message}\n`);
        // FIX L (rev2): use `process.exitCode` instead of `process.exit(1)`.
        // Abrupt `process.exit` can trigger libuv assert (STATUS_STACK_BUFFER_OVERRUN
        // = 0xC0000409, exit code -1073740791 on Windows) if Node has async
        // handles open (e.g.: in-flight fetch, SQLite WAL, watcher).
        // Setting `exitCode` lets the event loop drain before exit.
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