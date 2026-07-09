import type { Command } from "commander";
import * as path from "node:path";
import { run as runIndexer, formatHuman as formatIndexHuman, type IndexResult } from "@livewiki/core/indexer";
import { run as runLedger, type LedgerResult } from "@livewiki/core/anchor-ledger";

interface IndexOptions {
  json?: boolean;
  repo?: string;
  ignore?: string[];
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
    .action(async (_options: IndexOptions, command: Command) => {
      const opts = command.optsWithGlobals<IndexOptions & { ledger?: boolean }>();
      const json = Boolean(opts.json);
      const repoRoot = path.resolve(process.cwd(), opts.repo ?? ".");
      try {
        const indexResult = await runIndexer(repoRoot, {
          ...(opts.ignore && opts.ignore.length > 0
            ? { extraIgnores: opts.ignore }
            : {}),
          quiet: json,
        });
        let ledgerResult: LedgerResult | null = null;
        // commander trata --no-ledger como `ledger: false`
        if (opts.ledger !== false) {
          ledgerResult = await runLedger(repoRoot, { quiet: json });
        }
        emit(json, indexResult, ledgerResult);
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
  indexResult: IndexResult,
  ledgerResult: LedgerResult | null,
): void {
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