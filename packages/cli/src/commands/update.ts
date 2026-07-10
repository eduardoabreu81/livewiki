import type { Command } from "commander";
import * as path from "node:path";
import { loadWorkPackage } from "@livewiki/core/update";
import { run as runStatus } from "@livewiki/core/status";
import { emit } from "../output.js";
import { resolveRepoRoot } from "../cli.js";

interface UpdateOptions {
  json?: boolean;
  repo?: string;
  /**
   * `--record-write <tokens>`: registra doc escrita de volta (chamado pelo
   * agente/HUMANO depois de editar a wiki). Token estimate do que escreveu.
   * Hoje via flag; num skill automatizado, o próprio skill chamaria.
   */
  recordWrite?: string;
  /** `--llm`: chama API configurada pra pagar dívida (delegado pro batch.ts) */
  llm?: boolean;
  /** Janela do snippet em linhas (default 20). */
  snippetWindow?: string;
}

/**
 * `livewiki update` — Phase 5 (heart of the product, incremental mode).
 *
 * Without flags: emits the work package (debt + snippets + validAnchors +
 * estimated tokens) for the in-session agent to pay the debt. With `--llm`,
 * delegates to batch (full mode, not incremental — Phase 3).
 *
 * SPEC §"CLI commands" (Phase 5):
 *   "incremental mode: given the diff since lastDocumentedCommit, list the
 *    debt and (a) emit the work package for the in-session agent to document,
 *    or (b) with --llm call the configured API to pay the debt."
 *
 * SPEC §"Token accounting (Phase 3)":
 *   "Incremental: `update` records the size (tokens estimated via tokenizer)
 *    of the work package emitted to the agent and of the doc written back.
 *    Metrics in their own table in `.livewiki/`, exposed via `status --json`."
 *
 * Exit codes (same pattern as init/batch):
 *   0 = success (package emitted, or write recorded)
 *   1 = usage or state error (repo not initialized)
 */
export function registerUpdate(program: Command): void {
  program
    .command("update")
    .description(
      "incremental mode (Phase 5): emits a work package (debt + snippets + validAnchors + tokens). With --llm calls the API to pay debt. With --record-write <tokens> accounts for doc written back",
    )
    .option("--llm", "pay debt via the configured API (delegates to batch)")
    .option(
      "--record-write <tokens>",
      "record that N tokens were written back (economy: write/package)",
    )
    .option(
      "--snippet-window <lines>",
      "snippet window per anchor (default 20)",
      "20",
    )
    .action(async (_options: UpdateOptions, command: Command) => {
      const opts = command.optsWithGlobals<UpdateOptions>();
      const json = Boolean(opts.json);
      const repoRoot = path.resolve(process.cwd(), resolveRepoRoot(opts.repo));

      try {
        // (1) --record-write: records metric and exits (does not emit a package)
        if (opts.recordWrite !== undefined) {
          const tokens = Number.parseInt(opts.recordWrite, 10);
          if (Number.isNaN(tokens) || tokens < 0) {
            process.stderr.write(
              `livewiki update: --record-write requires a non-negative integer (received: ${opts.recordWrite})\n`,
            );
            process.exitCode = 1;
            return;
          }
          const { recordDocWrittenBack } = await import("@livewiki/core/update");
          // bytes not available here (come from CLI caller); estimate 4 chars/token
          const bytes = tokens * 4;
          await recordDocWrittenBack(repoRoot, {
            wikiPath: "(manual)",
            bytes,
            tokensEstimated: tokens,
          });
          emit(
            json,
            { ok: true, recorded: { tokens, bytes } },
            `recorded ${tokens} tokens written back (est. ${bytes} bytes)`,
          );
          return;
        }

        // (2) --llm: delegate to batch (full mode, Phase 3)
        if (opts.llm) {
          process.stderr.write(
            "livewiki update --llm: delegates to the batch orchestrator (full mode, Phase 3). " +
              "Use `livewiki batch resume <runId>` if there's a pending run, or `livewiki init --batch` to start one.\n",
          );
          process.exitCode = 1;
          return;
        }

        // (3) Default: emit the work package
        const snippetWindow = Number.parseInt(opts.snippetWindow ?? "20", 10);
        const pkg = await loadWorkPackage(repoRoot, {
          ...(Number.isFinite(snippetWindow) && snippetWindow > 0
            ? { snippetWindow }
            : {}),
        });

        // Product thesis in 1 line: update economy vs. re-reading the repo
        // (estimated: ~50KB of medium source = ~12500 tokens).
        const estimatedFullReadTokens = 12500;
        const economy = Math.max(
          0,
          1 - pkg.tokensEstimated / estimatedFullReadTokens,
        );
        const summary = {
          ok: true,
          package: pkg,
          economy: {
            estimatedFullReadTokens,
            packageTokens: pkg.tokensEstimated,
            savedRatio: Number(economy.toFixed(3)),
          },
        };

        emit(json, summary, formatHuman(pkg));
      } catch (err) {
        process.stderr.write(`livewiki update: error — ${(err as Error).message}\n`);
        // FIX L (rev2): process.exitCode, not process.exit (libuv assert on
        // open async handles — fetch/WAL/watcher).
        process.exitCode = 1;
        return;
      }
    });
}

function formatHuman(pkg: Awaited<ReturnType<typeof loadWorkPackage>>): string {
  const lines: string[] = [];
  lines.push("livewiki update — work package:");
  if (!pkg.manifest) {
    lines.push("  (manifest missing — run `livewiki init` first)");
  } else {
    lines.push(
      `  lastDocumentedCommit: ${pkg.manifest.lastDocumentedCommit ?? "(none)"}`,
    );
    if (pkg.manifest.pendingBatch) {
      const pb = pkg.manifest.pendingBatch as {
        runId: number;
        done: number;
        total: number;
      };
      lines.push(`  pendingBatch: run #${pb.runId} (${pb.done}/${pb.total})`);
    }
  }
  lines.push(`  debt: ${pkg.debt.length} item(s)`);
  for (const d of pkg.debt.slice(0, 5)) {
    lines.push(
      `    [${d.event}] ${d.symbol_key ?? "?"} (assignee=${d.assignee}, wiki=${d.wiki_path ?? "—"})`,
    );
  }
  if (pkg.debt.length > 5) lines.push(`    ... +${pkg.debt.length - 5} more`);
  lines.push(`  snippets: ${pkg.snippets.length} (window per anchor)`);
  lines.push(`  validAnchors: ${pkg.validAnchors.length}`);
  lines.push("");
  lines.push(`Estimated tokens: ${pkg.tokensEstimated} (~${pkg.bytes} bytes)`);
  lines.push("Thesis: focused package vs re-reading repo (~12500 tokens) = economy.");
  return lines.join("\n");
}

// Re-use runStatus so other commands can import it
export { runStatus };