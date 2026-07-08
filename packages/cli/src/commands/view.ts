import type { Command } from "commander";
import { makeStubAction } from "./stub.js";

/**
 * `livewiki view` — gera site estático autocontido em `.livewiki/site/` e abre
 * no browser. --template <agent|docs>, --out <dir> para publicar.
 * SPEC §"Comandos CLI" / Fase 7.
 */
export function registerView(program: Command): void {
  program
    .command("view")
    .description(
      "gerar site estático autocontido (HTML+CSS+JS) com busca client-side e Mermaid (Fase 7)",
    )
    .option("--template <name>", "template visual: 'agent' (denso, técnico) ou 'docs' (limpo)", "agent")
    .option("--out <dir>", "diretório de saída para publicar (default: .livewiki/site/)")
    .action(makeStubAction({ name: "view", phase: 7, planned: "site estático com busca client-side + Mermaid + templates como dados" }));
}