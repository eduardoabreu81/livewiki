import type { Command } from "commander";
import { makeStubAction } from "./stub.js";

/**
 * `livewiki status` — mostra dívida aberta, símbolos novos sem doc, batch
 * pendente. --json para consumo por agente.
 * SPEC §"Comandos CLI" / Fase 1 (status básico) + Fase 2 (completo).
 */
export function registerStatus(program: Command): void {
  program
    .command("status")
    .description(
      "mostrar dívida aberta, símbolos novos sem doc, batch pendente (Fase 1/2)",
    )
    .action(makeStubAction({ name: "status", phase: 1, planned: "listar dívida por página/seção + undocumented + pendingBatch" }));
}