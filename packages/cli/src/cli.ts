import { Command } from "commander";
import * as nodePath from "node:path";
import * as nodeFs from "node:fs";
import { registerInit } from "./commands/init.js";
import { registerIndex } from "./commands/index-cmd.js";
import { registerStatus } from "./commands/status.js";
import { registerUpdate } from "./commands/update.js";
import { registerVerify } from "./commands/verify.js";
import { registerServe } from "./commands/serve.js";
import { registerBatch } from "./commands/batch.js";
import { registerExport } from "./commands/export.js";
import { registerView } from "./commands/view.js";
import { registerPointer } from "./commands/pointer.js";

/**
 * Versão lida do package.json do @livewiki/cli. Síncrona — o arquivo é estático
 * no momento do build e o caller (`run`) já é uma função async.
 * Caminho: src/cli.ts → ../../package.json. Em build: dist/cli.js → mesmo path.
 */
function readVersion(): string {
  const here = new URL(import.meta.url);
  const pkgUrl = new URL("../../package.json", here);
  try {
    const raw = nodeFs.readFileSync(pkgUrl, "utf8");
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export function createProgram(): Command {
  const program = new Command();
  program
    .name("livewiki")
    .description(
      "Documentação viva de repositórios, ancorada no código e verificável. " +
        "Veja VISION.md e SPEC.md para o que cada comando faz e em que fase entra.",
    )
    .version(readVersion());

  // ── Flags globais ────────────────────────────────────────────────────────
  // --json: saída parseável (todos os comandos) — regra da SPEC.
  // --repo: diretório do repo-alvo (default: cwd).
  program
    .option("--json", "emitir saída em JSON (parseável por agentes)")
    .option("--repo <path>", "caminho do repo-alvo", ".");

  // ── Subcomandos (todos stubs da Fase 0; implementados em fases posteriores) ──
  // Spec §"Comandos CLI" lista 9 comandos. Todos registrados aqui desde o scaffold
  // para que `--help` já mostre a superfície completa.
  registerInit(program);
  registerIndex(program);
  registerStatus(program);
  registerUpdate(program);
  registerVerify(program);
  registerServe(program);
  registerBatch(program);
  registerExport(program);
  registerView(program);
  registerPointer(program);

  return program;
}

export async function run(argv: readonly string[]): Promise<void> {
  const program = createProgram();
  await program.parseAsync(argv as string[]);
}

/**
 * Resolve repoRoot a partir de --repo (relativo a cwd). Usado pelos comandos
 * para construir o CommandContext.
 */
export function resolveRepoRoot(repoOpt: string | undefined): string {
  return nodePath.resolve(process.cwd(), repoOpt ?? ".");
}