import type { Command } from "commander";
import { makeStubAction } from "./stub.js";

/**
 * `livewiki index` — (re)indexa: varre arquivos, extrai símbolos, atualiza
 * hashes, gera eventos de dívida. Idempotente.
 * SPEC §"Comandos CLI" / Fase 1.
 */
export function registerIndex(program: Command): void {
  program
    .command("index")
    .description(
      "(re)indexar repo: extrai símbolos, atualiza hashes, detecta dívida (Fase 1)",
    )
    .action(makeStubAction({ name: "index", phase: 1, planned: "tree-sitter + SQLite schema + respeito a .gitignore" }));
}