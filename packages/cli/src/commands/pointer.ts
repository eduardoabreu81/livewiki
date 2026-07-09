import type { Command } from "commander";
import * as nodePath from "node:path";
import * as nodeFs from "node:fs/promises";
import {
  insertPointer,
  removePointer,
  readPointerStatus,
  POINTER_FILES,
  buildPointerBlock,
  type PointerFile,
} from "@livewiki/core/pointer";
import { emit } from "../output.js";
import { resolveRepoRoot } from "../cli.js";

interface PointerOptions {
  json?: boolean;
  repo?: string;
  /** `--write-pointer`: opt-in explícito — pula confirmação interativa. */
  writePointer?: boolean;
  /** `--remove`: remove o bloco em vez de inserir. */
  remove?: boolean;
  /** `--file <name>`: força AGENTS.md ou CLAUDE.md (default: auto). */
  file?: string;
  /** `--yes`: pula confirmação interativa (alias do --write-pointer). */
  yes?: boolean;
  /**
   * `--block <texto>`: conteúdo customizado do bloco. Default: buildPointerBlock().
   * Útil pra projetos com instruções específicas no pointer.
   */
  block?: string;
}

/**
 * `livewiki pointer` — opt-in pointer em AGENTS.md / CLAUDE.md (Fase 5).
 *
 * SPEC §"Regras invioláveis" #2:
 *   "Pointer em AGENTS.md/CLAUDE.md: só com flag explícita
 *    (`--write-pointer`) ou confirmação interativa. Nunca automático."
 *
 * Comportamento:
 *   - sem flags: mostra o status atual (read-only)
 *   - --write-pointer: escreve o bloco (opt-in explícito, sem prompt)
 *   - sem flag, mas TTY detectado: prompt interativo y/N
 *   - --remove: remove o bloco
 *
 * **NUNCA automático** — sem flag E sem TTY (ex.: agent via subprocess sem
 * flag) → instrui o usuário a usar --write-pointer. Sem escrita silenciosa.
 *
 * Saída:
 *   - --json: status estruturado (parseável por agente)
 *   - human: instruções claras + diff do bloco
 */
export function registerPointer(program: Command): void {
  program
    .command("pointer")
    .description(
      "gerencia o pointer livewiki em AGENTS.md/CLAUDE.md (opt-in, Fase 5). " +
        "Sem flags mostra status; --write-pointer escreve; --remove remove. " +
        "Regra inviolável #2: nunca automático — sempre exige flag ou confirmação.",
    )
    .option(
      "--write-pointer",
      "escreve o bloco (opt-in explícito — pula confirmação)",
    )
    .option("--remove", "remove o bloco do arquivo alvo")
    .option(
      "--file <name>",
      `arquivo alvo: AGENTS.md ou CLAUDE.md (default: auto-detect). Valores: ${POINTER_FILES.join(", ")}`,
    )
    .option(
      "--yes",
      "alias de --write-pointer — pula confirmação interativa",
    )
    .option(
      "--block <text>",
      "conteúdo customizado do bloco (default: buildPointerBlock() — 1 parágrafo)",
    )
    .action(async (_options: PointerOptions, command: Command) => {
      const opts = command.optsWithGlobals<PointerOptions>();
      const json = Boolean(opts.json);
      const repoRoot = nodePath.resolve(process.cwd(), resolveRepoRoot(opts.repo));

      // Validação de --file (se passado)
      let fileOpt: PointerFile | undefined;
      if (opts.file) {
        if (!POINTER_FILES.includes(opts.file as PointerFile)) {
          process.stderr.write(
            `livewiki pointer: --file deve ser um de ${POINTER_FILES.join(", ")} (recebido: ${opts.file})\n`,
          );
          process.exitCode = 1;
          return;
        }
        fileOpt = opts.file as PointerFile;
      }

      try {
        // Modo: --remove
        if (opts.remove) {
          // --remove sem flag explícita E não TTY: pede confirmação
          // (a remoção é destrutiva — mais cuidado)
          if (!opts.writePointer && !opts.yes && process.stdin.isTTY) {
            const confirmed = await promptYesNo(
              `livewiki pointer: REMOVER o bloco de ${fileOpt ?? "AGENTS.md/CLAUDE.md"}? [y/N] `,
            );
            if (!confirmed) {
              emit(json, { ok: false, cancelled: true }, "cancelled");
              return;
            }
          } else if (!opts.writePointer && !opts.yes) {
            // Sem TTY e sem flag: falha fechado (regra #2: nunca automático)
            process.stderr.write(
              "livewiki pointer --remove: requer --write-pointer (ou --yes) em modo não-interativo.\n",
            );
            process.exitCode = 1;
            return;
          }
          const result = await removePointer(repoRoot, {
            ...(fileOpt ? { file: fileOpt } : {}),
          });
          emit(
            json,
            { ok: true, ...result, operation: "remove" },
            formatPointerResult(result, "removed"),
          );
          return;
        }

        // Modo: --write-pointer (ou --yes)
        const wantsWrite = Boolean(opts.writePointer || opts.yes);

        if (!wantsWrite && process.stdin.isTTY) {
          // TTY: prompt interativo
          const status = await readPointerStatus(repoRoot, {
            ...(fileOpt ? { file: fileOpt } : {}),
          });
          if (status.present) {
            emit(
              json,
              { ok: true, present: true, file: status.file, inner: status.inner },
              formatStatusHuman(status),
            );
            return;
          }
          const confirmed = await promptYesNo(
            `livewiki pointer: ADICIONAR bloco a ${fileOpt ?? "AGENTS.md/CLAUDE.md"}?\n\n` +
              `Bloco a ser adicionado:\n\n${buildPointerBlock()}\n\n[y/N] `,
          );
          if (!confirmed) {
            emit(json, { ok: false, cancelled: true }, "cancelled");
            return;
          }
        } else if (!wantsWrite) {
          // Sem TTY, sem flag: falha fechado
          process.stderr.write(
            "livewiki pointer: requer --write-pointer (ou --yes) em modo não-interativo.\n" +
              "Sem confirmação explícita, o livewiki NUNCA escreve fora de livewiki/ — exceto AGENTS.md/CLAUDE.md com opt-in consciente.\n",
          );
          process.exitCode = 1;
          return;
        }

        // Executar escrita
        const block = opts.block;
        const result = await insertPointer(repoRoot, {
          ...(fileOpt ? { file: fileOpt } : {}),
          ...(block !== undefined ? { block } : {}),
        });
        emit(
          json,
          { ok: true, ...result, operation: "write" },
          formatPointerResult(result, "wrote"),
        );
      } catch (err) {
        process.stderr.write(`livewiki pointer: erro — ${(err as Error).message}\n`);
        process.exitCode = 1;
        return;
      }
    });
}

async function promptYesNo(question: string): Promise<boolean> {
  process.stdout.write(question);
  // Lê 1 linha do stdin
  return new Promise((resolve) => {
    let input = "";
    const onData = (chunk: Buffer | string) => {
      input += chunk.toString();
      if (input.includes("\n")) {
        process.stdin.off("data", onData);
        process.stdin.off("end", onEnd);
        process.stdin.pause();
        const answer = input.trim().toLowerCase();
        resolve(answer === "y" || answer === "yes");
      }
    };
    const onEnd = () => {
      process.stdin.off("data", onData);
      const answer = input.trim().toLowerCase();
      resolve(answer === "y" || answer === "yes");
    };
    process.stdin.on("data", onData);
    process.stdin.on("end", onEnd);
    process.stdin.resume();
  });
}

function formatPointerResult(
  result: { file: PointerFile; action: string; bytesWritten: number },
  verb: "wrote" | "removed",
): string {
  const verbPast =
    verb === "wrote"
      ? result.action === "inserted"
        ? "wrote"
        : result.action === "replaced"
          ? "updated"
          : "unchanged"
      : "removed";
  const lines: string[] = [];
  lines.push(`livewiki pointer: ${verbPast} ${result.file}`);
  if (result.bytesWritten !== 0) {
    lines.push(`  (${result.bytesWritten >= 0 ? "+" : ""}${result.bytesWritten} bytes)`);
  }
  return lines.join("\n");
}

function formatStatusHuman(status: { present: boolean; file: PointerFile | null; inner?: string }): string {
  if (!status.present) {
    return "livewiki pointer: not present (run with --write-pointer to add)";
  }
  return `livewiki pointer: present in ${status.file}\n  ---\n${status.inner}\n  ---`;
}

// Re-export interno pra testes — sem expor pro userspace
export const _internal = { nodeFs };