import type { Command } from "commander";
import * as path from "node:path";
import { startMcpStdioServer } from "@livewiki/mcp/stdio";

/**
 * `livewiki serve` — starts the MCP server on stdio (Phase 4).
 *
 * Same server as the standalone `livewiki-mcp` bin — both go through
 * `@livewiki/mcp/stdio` (`startMcpStdioServer`), so the CLI path follows
 * the CLI shutdown convention: `process.exitCode`, never
 * `process.exit()` (lets Node drain the event loop; FIX L rev2).
 *
 * stdout carries ONLY the MCP protocol. Diagnostics go to stderr.
 */
export function registerServe(program: Command): void {
  program
    .command("serve")
    .description("start the MCP server on stdio (Phase 4)")
    .action(async (_options: Record<string, unknown>, command: Command) => {
      const opts = command.optsWithGlobals<{ repo?: string }>();
      const repoRoot = path.resolve(process.cwd(), opts.repo ?? ".");
      try {
        const server = await startMcpStdioServer({ repoRoot });
        const shutdown = (signal: NodeJS.Signals): void => {
          process.stderr.write(
            `livewiki serve: received ${signal}, shutting down...\n`,
          );
          void server.close().catch(() => {
            /* best-effort */
          });
          // process.exitCode stays 0; Node exits when the loop drains.
        };
        process.on("SIGINT", () => shutdown("SIGINT"));
        process.on("SIGTERM", () => shutdown("SIGTERM"));
      } catch (err) {
        process.stderr.write(`livewiki serve: error — ${(err as Error).message}\n`);
        process.exitCode = 1;
      }
    });
}
