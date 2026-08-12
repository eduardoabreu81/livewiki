/**
 * `livewiki serve` E2E — spawns the REAL CLI binary
 * (packages/cli/dist/index.js serve --repo <tmp>) and speaks MCP over
 * stdio with the official SDK client, asserting:
 *
 *   1. The initialize handshake succeeds.
 *   2. Exactly the 7 documented tools are listed.
 *   3. stdout carries ONLY the MCP protocol (any diagnostic on stderr).
 *   4. Closing the client terminates the child process (no orphan).
 *      The exit CODE is deliberately NOT asserted: the SDK transport
 *      SIGTERMs the child after stdin ends, and Windows TerminateProcess
 *      reports 1 — the cross-platform contract is "the server does not
 *      outlive its client", not a specific code.
 *
 * Why E2E: `serve` was the last stub command; only a real stdio
 * handshake proves the CLI wiring (and not just the in-process server
 * factory, already covered by packages/mcp tests).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import * as nodePath from "node:path";
import * as nodeOs from "node:os";
import * as nodeFs from "node:fs/promises";

// Spawns the real CLI + MCP handshake; keep aligned with the other CLI
// subprocess suites (vitest.config.ts sets 30s globally — ceiling, not delay).
vi.setConfig({ testTimeout: 30_000 });

const EXPECTED_TOOLS = [
  "livewiki_quickstart",
  "livewiki_read",
  "livewiki_search",
  "livewiki_debt",
  "livewiki_write_doc",
  "livewiki_resolve_debt",
  "livewiki_impact",
];

let repoRoot: string;

beforeEach(async () => {
  repoRoot = await nodeFs.mkdtemp(
    nodePath.join(nodeOs.tmpdir(), "livewiki-serve-e2e-"),
  );
  // Minimal wiki page so search/read have something real to index.
  await nodeFs.mkdir(nodePath.join(repoRoot, "livewiki"), { recursive: true });
  await nodeFs.writeFile(
    nodePath.join(repoRoot, "livewiki", "quickstart.md"),
    "# quickstart\n\nserve e2e fixture\n",
    "utf8",
  );
});

afterEach(async () => {
  await nodeFs.rm(repoRoot, { recursive: true, force: true });
});

function cliBin(): string {
  return nodePath.resolve(process.cwd(), "dist/index.js");
}

describe("livewiki serve (MCP over stdio, real binary)", () => {
  it("handshakes, lists the 7 tools, and shuts down cleanly", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [cliBin(), "serve", "--repo", repoRoot],
      stderr: "pipe",
    });
    const client = new Client({ name: "serve-e2e", version: "0.0.0" });

    let stderrText = "";
    transport.stderr?.on("data", (chunk: Buffer) => {
      stderrText += chunk.toString("utf8");
    });

    // try/finally: a failed assertion mid-test must not leave the child
    // process (and its search.db WAL handles) orphaned — close always runs.
    try {
      await client.connect(transport);
      // Captured NOW — the transport clears its process handle on close().
      const pid = transport.pid;
      expect(pid).not.toBeNull();

      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name).sort();
      expect(names).toEqual([...EXPECTED_TOOLS].sort());

      // A real call through the CLI path, not just the handshake.
      const qs = await client.callTool({ name: "livewiki_quickstart", arguments: {} });
      expect(qs.isError).not.toBe(true);

      await client.close();

      // No orphan: the child must be gone shortly after the client closes
      // (the SDK transport ends stdin, then SIGTERMs; cross-platform exit
      // CODES differ — Windows TerminateProcess reports 1 — so the contract
      // asserted here is "does not outlive the client", not a specific code).
      let alive = true;
      for (let i = 0; i < 40 && alive; i++) {
        try {
          process.kill(pid!, 0); // probe only — no signal delivered
          await new Promise((r) => setTimeout(r, 250));
        } catch {
          alive = false; // ESRCH — process is gone
        }
      }
      expect(alive).toBe(false);

      // No stub-era debris and no PT-BR stub message on stderr.
      expect(stderrText).not.toContain("stub");
    } finally {
      await client.close().catch(() => {
        /* already closed — best-effort */
      });
    }
  });
});
