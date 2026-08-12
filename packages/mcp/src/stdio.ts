/**
 * @livewiki/mcp — reusable stdio server entry (side-effect free).
 *
 * Both the `livewiki-mcp` bin (index.ts) and the CLI's `livewiki serve`
 * command go through this module. Importing it NEVER starts a server,
 * touches process signals, or calls process.exit — the caller owns the
 * process lifecycle (the bin may process.exit; the CLI sets
 * process.exitCode, per the libuv-safe shutdown convention).
 *
 * stdout carries ONLY the MCP protocol (StdioServerTransport); any
 * diagnostic goes to stderr.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createServer } from "./server.js";

/**
 * Creates the MCP server for `repoRoot` and connects it to stdio.
 * Resolves once the transport is connected; the process stays alive
 * while the MCP client is connected. Caller is responsible for closing
 * the returned server (which closes the FTS5 index) on shutdown.
 */
export async function startMcpStdioServer(opts: {
  repoRoot: string;
}): Promise<McpServer> {
  const server = await createServer({ repoRoot: opts.repoRoot });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  return server;
}
