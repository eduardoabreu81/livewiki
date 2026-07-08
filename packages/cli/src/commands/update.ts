import type { Command } from "commander";
import { makeStubAction } from "./stub.js";

/**
 * `livewiki update` — modo incremental: dado o diff desde lastDocumentedCommit,
 * lista a dívida e (a) emite pacote de trabalho para o agente em sessão
 * documentar, ou (b) com --llm chama API configurada para pagar a dívida.
 * SPEC §"Comandos CLI" / Fase 5.
 */
export function registerUpdate(program: Command): void {
  program
    .command("update")
    .description(
      "pagar dívida incremental: emite trabalho para agente em sessão, ou usa LLM com --llm (Fase 5)",
    )
    .option("--llm", "chamar API configurada para pagar a dívida automaticamente")
    .action(makeStubAction({ name: "update", phase: 5, planned: "diff vs lastDocumentedCommit → debt items → doc" }));
}