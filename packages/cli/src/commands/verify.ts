import type { Command } from "commander";
import { makeStubAction } from "./stub.js";

/**
 * `livewiki verify` — valida a wiki: âncoras apontam para símbolos existentes?
 * assinaturas citadas batem? links internos ok? Sai com código ≠ 0 se falhar
 * (CI-friendly).
 * SPEC §"Comandos CLI" / Fase 2.
 */
export function registerVerify(program: Command): void {
  program
    .command("verify")
    .description(
      "validar wiki: âncoras + assinaturas + links. Exit ≠ 0 se falhar (Fase 2, CI-friendly)",
    )
    .action(makeStubAction({ name: "verify", phase: 2, planned: "verificar âncoras vs símbolos + assinaturas + links internos" }));
}