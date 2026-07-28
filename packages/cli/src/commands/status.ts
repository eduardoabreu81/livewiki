import type { Command } from "commander";
import * as path from "node:path";
import { run as runStatus, formatHuman as formatStatusHuman } from "@livewiki/core/status";
import {
  previewWorkingTreeDebt,
  formatDiffPreviewHuman,
} from "@livewiki/core/diff-preview";

interface StatusOptions {
  json?: boolean;
  repo?: string;
  top?: string;
  diff?: boolean;
}

/**
 * `livewiki status` — index report (Phase 1: files + symbols).
 * Debt + undocumented enter in Phase 2.
 * `--diff` (ROADMAP backlog #5): read-only pre-commit preview of the wiki
 * anchors the uncommitted working-tree diff would invalidate. Exit 0 always,
 * except the not-a-git-repo degrade (exit 1, never a stack trace).
 */
export function registerStatus(program: Command): void {
  program
    .command("status")
    .description(
      "show open debt, undocumented symbols, pending batch (Phase 1/2)",
    )
    .option("--top <n>", "how many files to show in the top list (default 10)", "10")
    .option(
      "--diff",
      "preview anchors the uncommitted working-tree diff would invalidate (read-only)",
    )
    .action(async (_options: StatusOptions, command: Command) => {
      // commander 12 does not pass global options in the 1st action arg.
      const opts = command.optsWithGlobals<StatusOptions>();
      const json = Boolean(opts.json);
      const repoRoot = path.resolve(process.cwd(), opts.repo ?? ".");
      const topN = opts.top ? Number.parseInt(opts.top, 10) : 10;
      try {
        if (opts.diff) {
          const preview = await previewWorkingTreeDebt(repoRoot);
          if (preview.notGitRepo) {
            if (json) {
              process.stdout.write(
                JSON.stringify({ ok: false, error: "not_a_git_repo", diffPreview: preview }) + "\n",
              );
            } else {
              process.stderr.write(formatDiffPreviewHuman(preview) + "\n");
            }
            process.exitCode = 1;
            return;
          }
          if (json) {
            process.stdout.write(JSON.stringify({ ok: true, diffPreview: preview }) + "\n");
          } else {
            process.stdout.write(formatDiffPreviewHuman(preview) + "\n");
          }
          return;
        }
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
