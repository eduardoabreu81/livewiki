import type { Command } from "commander";
import { makeStubAction } from "./stub.js";

/**
 * `livewiki serve` — starts the MCP server (stdio).
 * SPEC §"CLI commands" / Phase 4.
 */
export function registerServe(program: Command): void {
  program
    .command("serve")
    .description("start the MCP server on stdio (Phase 4)")
    .action(makeStubAction({ name: "serve", phase: 4, planned: "MCP server stdio with 6 tools (livewiki_quickstart/read/search/debt/write_doc/resolve_debt)" }));
}