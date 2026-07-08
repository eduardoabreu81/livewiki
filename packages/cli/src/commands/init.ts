import type { Command } from "commander";
import { makeStubAction } from "./stub.js";

/**
 * `livewiki init` — cria `livewiki/` + `.livewiki/`, indexa, gera quickstart.md
 * e structure.mmd mínimos (sem LLM). Com --batch dispara o pipeline completo.
 * SPEC §"Comandos CLI" / Fase 3.
 */
export function registerInit(program: Command): void {
  program
    .command("init")
    .description(
      "inicializa livewiki no repo: cria livewiki/ + .livewiki/, indexa, gera quickstart. --batch dispara documentação completa (Fase 3)",
    )
    .option("--batch", "rodar pipeline completo de documentação (Fase 3)")
    .action(makeStubAction({ name: "init", phase: 3, planned: "criar layout + indexar + quickstart; --batch roda pipeline de 4 etapas" }));
}