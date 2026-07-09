import type { Command } from "commander";
import * as path from "node:path";
import { run as runIndexer, formatHuman as formatIndexHuman, type IndexResult } from "@livewiki/core/indexer";
import { run as runLedger, type LedgerResult } from "@livewiki/core/anchor-ledger";

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
 * `livewiki index` — (re)indexa o repo + sincroniza âncoras. Idempotente. Incremental.
 *
 * SPEC §"Comandos CLI" (commit 300ad58): `.livewiki/` ausente é auto-criado
 * **sem aviso**. Se a wiki `livewiki/` também não existe, emite nota informativa
 * (sugerindo `init`, Fase 3). Nunca exige `init` antes.
 *
 * Fase 2 encadeia o anchor-ledger depois do indexer — assim `livewiki index`
 * (re)detecta changed/moved/deleted junto com o reindex.
 */
export function registerIndex(program: Command): void {
  program
    .command("index")
    .description(
      "(re)indexar repo: extrai símbolos, atualiza hashes, gera dívida de âncoras (Fase 1+2)",
    )
    .option("--ignore <pattern>", "padrão adicional a ignorar (pode repetir)", collectIgnore, [])
    .option("--no-ledger", "pular ledger (só indexar código)")
    .option(
      "--quiet",
      "suprime output humano sem produzir JSON (usado pelos hooks — Fase 5)",
    )
    .action(async (_options: IndexOptions, command: Command) => {
      const opts = command.optsWithGlobals<IndexOptions & { ledger?: boolean }>();
      const json = Boolean(opts.json);
      const quiet = Boolean(opts.quiet);
      const repoRoot = path.resolve(process.cwd(), opts.repo ?? ".");
      try {
        const indexResult = await runIndexer(repoRoot, {
          ...(opts.ignore && opts.ignore.length > 0
            ? { extraIgnores: opts.ignore }
            : {}),
          // quiet = JSON ou --quiet (qualquer um suprime output humano)
          quiet: json || quiet,
        });
        let ledgerResult: LedgerResult | null = null;
        // commander trata --no-ledger como `ledger: false`
        if (opts.ledger !== false) {
          ledgerResult = await runLedger(repoRoot, { quiet: json || quiet });
        }
        emit(json, quiet, indexResult, ledgerResult);
      } catch (err) {
        process.stderr.write(`livewiki index: erro — ${(err as Error).message}\n`);
        process.exit(1);
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
  // Quiet: nada no stdout. O hook só quer detecção de dívida (via `status --json`
  // em chamada separada), não output. Stderr ainda carrega erros.
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
  lines.push(`  páginas: ${r.pagesProcessed} processadas, ${r.pagesSkipped} puladas`);
  lines.push(`  âncoras: ${r.anchorsUpserted} upsert`);
  lines.push(
    `  dívida: +${r.debtByEvent.changed} changed +${r.debtByEvent.moved} moved +${r.debtByEvent.deleted} deleted`,
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