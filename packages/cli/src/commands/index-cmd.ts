import type { Command } from "commander";
import * as path from "node:path";
import { run as runIndexer, formatHuman as formatIndexHuman, type IndexResult } from "@livewiki/core/indexer";

interface IndexOptions {
  json?: boolean;
  repo?: string;
  ignore?: string[];
}

/**
 * `livewiki index` — (re)indexa o repo. Idempotente. Incremental.
 *
 * SPEC §"Comandos CLI" (commit 300ad58): `.livewiki/` ausente é auto-criado
 * **sem aviso**. Se a wiki `livewiki/` também não existe, emite nota informativa
 * (sugerindo `init`, Fase 3). Nunca exige `init` antes.
 */
export function registerIndex(program: Command): void {
  program
    .command("index")
    .description(
      "(re)indexar repo: extrai símbolos, atualiza hashes, detecta dívida (Fase 1)",
    )
    .option("--ignore <pattern>", "padrão adicional a ignorar (pode repetir)", collectIgnore, [])
    .action(async (_options: IndexOptions, command: Command) => {
      // commander 12 não passa opções globais no 1º arg do action — usa
      // optsWithGlobals() no command para ler --json e --repo.
      const opts = command.optsWithGlobals<IndexOptions>();
      const json = Boolean(opts.json);
      const repoRoot = path.resolve(process.cwd(), opts.repo ?? ".");
      try {
        const result = await runIndexer(repoRoot, {
          ...(opts.ignore && opts.ignore.length > 0
            ? { extraIgnores: opts.ignore }
            : {}),
          quiet: json,
        });
        emit(json, result);
      } catch (err) {
        process.stderr.write(`livewiki index: erro — ${(err as Error).message}\n`);
        process.exit(1);
      }
    });
}

function collectIgnore(value: string, previous: string[]): string[] {
  return previous.concat(value);
}

function emit(json: boolean, result: IndexResult): void {
  if (json) {
    process.stdout.write(JSON.stringify({ ok: true, ...result }) + "\n");
  } else {
    process.stdout.write(formatIndexHuman(result) + "\n");
  }
}