#!/usr/bin/env node
/**
 * @livewiki/mcp — stdio entry point (Phase 4).
 *
 * Reads --repo from CLI (default cwd), creates the server and connects it
 * to the StdioServerTransport. The process stays alive while the MCP client
 * is connected.
 *
 * Typical usage (Claude Code):
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
 *   - 0: clean shutdown
 *   - 1: setup error (invalid repo, etc)
 */

import * as nodePath from "node:path";
import { startMcpStdioServer } from "./stdio.js";

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
  const server = await startMcpStdioServer({ repoRoot });

  // Graceful shutdown — closes the server (which closes the FTS5 index).
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