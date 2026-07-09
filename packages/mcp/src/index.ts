/**
 * @livewiki/mcp — entry point stdio (Fase 4).
 *
 * Lê --repo da CLI (default cwd), cria o server e conecta no
 * StdioServerTransport. O processo fica vivo enquanto o client MCP
 * estiver conectado.
 *
 * Uso típico (Claude Code):
 *   {
 *     "mcpServers": {
 *       "livewiki": {
 *         "command": "npx",
 *         "args": ["-y", "@livewiki/mcp", "--repo", "/path/to/repo"]
 *       }
 *     }
 *   }
 *
 * Exit:
 *   - 0: shutdown limpo
 *   - 1: erro de setup (repo inválido, etc)
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as nodePath from "node:path";
import { createServer } from "./server.js";

function parseArgs(argv: readonly string[]): { repoRoot: string } {
  let repoRoot = process.cwd();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--repo" && argv[i + 1] !== undefined) {
      repoRoot = nodePath.resolve(argv[i + 1]!);
      i++;
    }
  }
  return { repoRoot };
}

async function main(): Promise<void> {
  const { repoRoot } = parseArgs(process.argv.slice(2));
  const server = await createServer({ repoRoot });
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Graceful shutdown — fecha o server (que fecha o índice FTS5).
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    process.stderr.write(`[livewiki-mcp] received ${signal}, shutting down...\n`);
    try {
      await server.close();
    } catch {
      // best-effort
    }
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  process.stderr.write(
    `[livewiki-mcp] fatal: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});