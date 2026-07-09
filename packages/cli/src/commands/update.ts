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
 * `livewiki update` — Fase 5 (coração do produto, modo incremental).
 *
 * Sem flags: emite o pacote de trabalho (debt + snippets + validAnchors +
 * tokens estimados) pra agente em sessão pagar a dívida. Com `--llm`,
 * delega ao batch (modo completo, não incremental — Fase 3).
 *
 * SPEC §"Comandos CLI" (Fase 5):
 *   "modo incremental: dado o diff desde lastDocumentedCommit, lista a
 *    dívida e (a) emite o pacote de trabalho para o agente em sessão
 *    documentar, ou (b) com --llm chama a API configurada para pagar a
 *    dívida."
 *
 * SPEC §"Contabilidade de tokens (Fase 3)":
 *   "Incremental: o `update` registra o tamanho (tokens estimados por
 *    tokenizer) do pacote de trabalho emitido ao agente e da doc escrita
 *    de volta. Métricas em tabela própria no .livewiki/, expostas via
 *    status --json."
 *
 * Exit codes (mesmo padrão de init/batch):
 *   0 = sucesso (pacote emitido, ou write registrado)
 *   1 = erro de uso ou estado (repo não inicializado)
 */
export function registerUpdate(program: Command): void {
  program
    .command("update")
    .description(
      "modo incremental (Fase 5): emite pacote de trabalho (debt + snippets + validAnchors + tokens). Com --llm chama API pra pagar dívida. Com --record-write <tokens> contabiliza doc escrita de volta",
    )
    .option("--llm", "pagar dívida via API configurada (delega ao batch)")
    .option(
      "--record-write <tokens>",
      "registra que N tokens foram escritos de volta (economia: write/package)",
    )
    .option(
      "--snippet-window <lines>",
      "janela de snippet por âncora (default 20)",
      "20",
    )
    .action(async (_options: UpdateOptions, command: Command) => {
      const opts = command.optsWithGlobals<UpdateOptions>();
      const json = Boolean(opts.json);
      const repoRoot = path.resolve(process.cwd(), resolveRepoRoot(opts.repo));

      try {
        // (1) --record-write: registra métrica e sai (não emite pacote)
        if (opts.recordWrite !== undefined) {
          const tokens = Number.parseInt(opts.recordWrite, 10);
          if (Number.isNaN(tokens) || tokens < 0) {
            process.stderr.write(
              `livewiki update: --record-write exige número inteiro positivo de tokens (recebido: ${opts.recordWrite})\n`,
            );
            process.exitCode = 1;
            return;
          }
          const { recordDocWrittenBack } = await import("@livewiki/core/update");
          // bytes não temos aqui (vem do CLI caller); estimamos 4 chars/token
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

        // (2) --llm: delega ao batch (modo completo, Fase 3)
        if (opts.llm) {
          process.stderr.write(
            "livewiki update --llm: delega ao batch orchestrator (modo completo, Fase 3). " +
              "Use `livewiki batch resume <runId>` se há run pendente, ou `livewiki init --batch` para começar.\n",
          );
          process.exitCode = 1;
          return;
        }

        // (3) Default: emite o pacote de trabalho
        const snippetWindow = Number.parseInt(opts.snippetWindow ?? "20", 10);
        const pkg = await loadWorkPackage(repoRoot, {
          ...(Number.isFinite(snippetWindow) && snippetWindow > 0
            ? { snippetWindow }
            : {}),
        });

        // Tese do produto em 1 linha: economia do update vs. reler repo
        // (estimado: ~50KB de source médio = ~12500 tokens).
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
        process.stderr.write(`livewiki update: erro — ${(err as Error).message}\n`);
        // FIX L (rev2): process.exitCode, não process.exit (libuv assert em
        // handles async abertos — fetch/WAL/watcher).
        process.exitCode = 1;
        return;
      }
    });
}

function formatHuman(pkg: Awaited<ReturnType<typeof loadWorkPackage>>): string {
  const lines: string[] = [];
  lines.push("livewiki update — work package:");
  if (!pkg.manifest) {
    lines.push("  (manifest ausente — rode `livewiki init` primeiro)");
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
  lines.push(`  debt: ${pkg.debt.length} item(ns)`);
  for (const d of pkg.debt.slice(0, 5)) {
    lines.push(
      `    [${d.event}] ${d.symbol_key ?? "?"} (assignee=${d.assignee}, wiki=${d.wiki_path ?? "—"})`,
    );
  }
  if (pkg.debt.length > 5) lines.push(`    ... +${pkg.debt.length - 5} mais`);
  lines.push(`  snippets: ${pkg.snippets.length} (janela por âncora)`);
  lines.push(`  validAnchors: ${pkg.validAnchors.length}`);
  lines.push("");
  lines.push(`Tokens estimados: ${pkg.tokensEstimated} (~${pkg.bytes} bytes)`);
  lines.push("Tese: pacote focado vs reler repo (~12500 tokens) = economia.");
  return lines.join("\n");
}

// Re-uso do runStatus pra export se necessário em outros commands
export { runStatus };