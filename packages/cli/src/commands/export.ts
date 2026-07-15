import type { Command } from "commander";
import * as path from "node:path";
import {
  exportWiki,
  ExportError,
  validateTarget,
  type ExportTarget,
  type ExportResult,
  type ExportIssue,
} from "@livewiki/core/export";
import { resolveRepoRoot } from "../cli.js";

interface ExportCliOptions {
  json?: boolean;
  repo?: string;
  force?: boolean;
  push?: string;
}

/**
 * `livewiki export <target>` — Phase 6 Lot 6A (local deterministic
 * transformation). Writes a flattened snapshot of `livewiki/` to
 * `.livewiki/export/<target>/`. Targets: `generic`, `github-wiki`,
 * `gitlab-wiki`.
 *
 * Git publication (--push) is reserved for Lot 6B and rejected with
 * exit 1 before any write.
 *
 * Exit codes:
 *   0 — success (every source page exported, no preflight failures).
 *   1 — invalid target, preflight failure, write failure, or
 *       `--push` (rejected in this lot). JSON mode uses the same
 *       exit codes; no batch-style 0/1/2 mapping.
 *
 * Uses `process.exitCode`, never `process.exit` (FIX L rev2). The
 * action handler wraps `exportWiki` in a try/catch and converts any
 * thrown `ExportError` (e.g. invalid target) or unexpected error into
 * a structured `ExportResult` so the JSON contract is always honored.
 */
export function registerExport(program: Command): void {
  program
    .command("export <target>")
    .description(
      "export the wiki to a flattened destination under .livewiki/export/<target>/ (Phase 6 Lot 6A). --force overwrites destination files that lack the livewiki marker.",
    )
    .option(
      "--force",
      "overwrite destination files that lack a matching livewiki marker (default: refuse)",
    )
    .option(
      "--push <remote>",
      "(Lot 6B) git remote to publish to. Not available in Lot 6A; rejected with exit 1.",
    )
    .action(async (target: string, _options: ExportCliOptions, command: Command) => {
      const opts = command.optsWithGlobals<ExportCliOptions>();
      const json = Boolean(opts.json);
      const repoRoot = resolveRepoRoot(opts.repo);
      const absRoot = path.resolve(process.cwd(), repoRoot);

      // Validate the target up front. validateTarget throws
      // ExportError on an unknown target; we convert that to a
      // structured ExportResult so the JSON contract is always
      // honored and the global fatal handler never sees it.
      let validatedTarget: ExportTarget;
      try {
        validatedTarget = validateTarget(target);
      } catch (err) {
        const result: ExportResult = exportErrorToResult(
          absRoot,
          target as ExportTarget,
          err,
        );
        emit(json, result);
        return;
      }

      // Run the export. Wrap in try/catch to keep the global fatal
      // handler from receiving an unexpected throw.
      let result: ExportResult;
      try {
        result = await exportWiki({
          repoRoot: absRoot,
          target: validatedTarget,
          ...(opts.force ? { force: true } : {}),
          ...(opts.push !== undefined ? { push: opts.push } : {}),
        });
      } catch (err) {
        result = exportErrorToResult(absRoot, validatedTarget, err);
      }

      emit(json, result);
    });
}

/**
 * Convert an `ExportError` (or any other unexpected error) into a
 * structured `ExportResult` so the CLI can emit a stable JSON payload
 * with `ok: false` and a structured issue list. The action handler
 * relies on this to keep `ExportError` from escaping to the global
 * fatal-error handler.
 *
 * The detail extraction uses `err instanceof Error ? err.message :
 * String(err)`. A thrown `null` or primitive would crash a catch
 * handler that accesses `.message` directly.
 */
function exportErrorToResult(
  absRoot: string,
  target: ExportTarget,
  err: unknown,
): ExportResult {
  if (err instanceof ExportError) {
    return {
      ok: false,
      target,
      outDir: path.join(absRoot, ".livewiki", "export", target),
      pagesWritten: 0,
      pagesRemoved: 0,
      issues: err.issues,
    };
  }
  const detail = err instanceof Error ? err.message : String(err);
  const issue: ExportIssue = {
    code: "write_failed",
    severity: "error",
    path: "(export)",
    detail,
  };
  return {
    ok: false,
    target,
    outDir: path.join(absRoot, ".livewiki", "export", target),
    pagesWritten: 0,
    pagesRemoved: 0,
    issues: [issue],
  };
}

/** Emit the result as either JSON or human output. Sets `process.exitCode`. */
function emit(json: boolean, result: ExportResult): void {
  const exitCode = result.ok ? 0 : 1;
  // Always set the exit code BEFORE emitting. JSON failures exit 1 too
  // (per the prompt: JSON failures also exit 1).
  process.exitCode = exitCode;

  if (json) {
    process.stdout.write(JSON.stringify({ ok: result.ok, export: result }) + "\n");
    return;
  }

  // Human output: a one-line summary, then the issue list when non-empty.
  const lines: string[] = [];
  lines.push(
    `livewiki export ${result.target}: ${result.pagesWritten} written, ${result.pagesRemoved} removed, ${result.issues.length} issue(s)`,
  );
  if (result.issues.length > 0) {
    lines.push("");
    for (const issue of result.issues) {
      lines.push(`  [${issue.severity}] ${issue.code} ${issue.path}: ${issue.detail}`);
    }
  }
  process.stdout.write(lines.join("\n") + "\n");
}
