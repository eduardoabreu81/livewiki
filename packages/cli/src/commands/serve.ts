import type { Command } from "commander";
import { makeStubAction } from "./stub.js";

/**
 * `livewiki serve` — sobe o MCP server (stdio).
 * SPEC §"Comandos CLI" / Fase 4.
 */
export function registerServe(program: Command): void {
  program
    .command("serve")
    .description("subir MCP server em stdio (Fase 4)")
    .action(makeStubAction({ name: "serve", phase: 4, planned: "MCP server stdio com 6 tools (livewiki_quickstart/read/search/debt/write_doc/resolve_debt)" }));
}