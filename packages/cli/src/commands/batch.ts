import type { Command } from "commander";
import { makeStubAction } from "./stub.js";

/**
 * `livewiki batch <run>` — continua/inspeciona um run de documentação completa.
 * Resume por task (cada task fica `pending` até ser completada).
 * SPEC §"Comandos CLI" / Fase 3.
 */
export function registerBatch(program: Command): void {
  program
    .command("batch <run>")
    .description(
      "continuar ou inspecionar um run de documentação completa. Resume por task (Fase 3)",
    )
    .action(makeStubAction({ name: "batch", phase: 3, planned: "pipeline 4 etapas com checkpoints: varredura → módulos → priorização → doc" }));
}