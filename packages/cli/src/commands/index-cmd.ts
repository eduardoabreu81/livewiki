import type { Command } from "commander";
import * as path from "node:path";
import { run as runIndexer, formatHuman as formatIndexHuman, type IndexResult } from "@livewiki/core/indexer";
import { run as runLedger, type LedgerResult } from "@livewiki/core/anchor-ledger";
import { loadConfig, resolveExtraIgnores } from "@livewiki/core/config";

interface IndexOptions {
  json?: boolean;
  repo?: string;
  ignore?: string[];
  /**
   * `--quiet`: suprime output humano sem produzir JSON. Usado pelos hooks
   * (Fase 5) e pelo post-commit template — detecta dívida sem spammar o
   * terminal. Diferente de `--json`, que produz saída estruturada.
   */
  quiet?: boolean;
}

/**
 * `livewiki index` — (re)indexes the repo + syncs anchors. Idempotent. Incremental.
 *
 * SPEC §"CLI commands" (commit 300ad58): missing `.livewiki/` is auto-created
 * **without warning**. If `livewiki/` is also missing, emits an info note
 * (suggesting `init`, Phase 3). Never requires `init` first.
 *
 * Phase 2 chains the anchor-ledger after the indexer — so `livewiki index`
 * (re)detects changed/moved/deleted along with the reindex.
 */
export function registerIndex(program: Command): void {
  program
    .command("index")
    .description(
      "(re)index repo: extracts symbols, updates hashes, generates anchor debt (Phase 1+2)",
    )
    .option("--ignore <pattern>", "additional pattern to ignore (repeatable)", collectIgnore, [])
    .option("--no-ledger", "skip ledger (index code only)")
    .option(
      "--quiet",
      "suppress human output without producing JSON (used by hooks — Phase 5)",
    )
    .action(async (_options: IndexOptions, command: Command) => {
      const opts = command.optsWithGlobals<IndexOptions & { ledger?: boolean }>();
      const json = Boolean(opts.json);
      const quiet = Boolean(opts.quiet);
      const repoRoot = path.resolve(process.cwd(), opts.repo ?? ".");
      try {
        // Merge `.livewiki/config.json` `ignores` with the CLI `--ignore`
        // flag so every entry point shares the same semantics. The CLI
        // flag is additive: the user can still narrow the walk on a
        // per-invocation basis, but the configured value is always honored.
        // `loadConfig` throws on malformed JSON — that is intentional
        // (T0 fail-closed: do not silently ignore a corrupt config).
        const config = await loadConfig(repoRoot);
        const configIgnores = resolveExtraIgnores(config);
        const cliIgnores = opts.ignore ?? [];
        const extraIgnores = [...configIgnores, ...cliIgnores];
        const indexResult = await runIndexer(repoRoot, {
          ...(extraIgnores.length > 0 ? { extraIgnores } : {}),
          // quiet = JSON or --quiet (either suppresses human output)
          quiet: json || quiet,
        });
        let ledgerResult: LedgerResult | null = null;
        // commander treats --no-ledger as `ledger: false`
        if (opts.ledger !== false) {
          ledgerResult = await runLedger(repoRoot, { quiet: json || quiet });
        }
        emit(json, quiet, indexResult, ledgerResult);
      } catch (err) {
        process.stderr.write(`livewiki index: error — ${(err as Error).message}\n`);
        // Let Node drain pending stderr I/O before exiting.
        process.exitCode = 1;
      }
    });
}

function collectIgnore(value: string, previous: string[]): string[] {
  return previous.concat(value);
}

function emit(
  json: boolean,
  quiet: boolean,
  indexResult: IndexResult,
  ledgerResult: LedgerResult | null,
): void {
  // Quiet: nothing on stdout. The hook only wants debt detection (via
  // `status --json` in a separate call), not output. Stderr still carries errors.
  if (quiet && !json) return;
  if (json) {
    process.stdout.write(
      JSON.stringify({ ok: true, index: indexResult, ledger: ledgerResult }) + "\n",
    );
  } else {
    process.stdout.write(formatIndexHuman(indexResult) + "\n");
    if (ledgerResult) {
      process.stdout.write(formatLedgerHuman(ledgerResult) + "\n");
    }
  }
}

function formatLedgerHuman(r: LedgerResult): string {
  const lines: string[] = [];
  lines.push(`livewiki ledger: OK`);
  lines.push(`  pages: ${r.pagesProcessed} processed, ${r.pagesSkipped} skipped`);
  lines.push(`  anchors: ${r.anchorsUpserted} upsert`);
  lines.push(
    `  debt: +${r.debtByEvent.changed} changed +${r.debtByEvent.moved} moved +${r.debtByEvent.deleted} deleted`,
  );
  lines.push(`  undocumented: ${r.undocumentedSymbols}`);
  if (r.movedPairs.length > 0) {
    lines.push("  moved pairs:");
    for (const m of r.movedPairs) {
      lines.push(`    ${m.from} → ${m.to}`);
    }
  }
  return lines.join("\n");
}
