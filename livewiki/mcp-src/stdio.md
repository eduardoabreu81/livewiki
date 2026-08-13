---
title: startMcpStdioServer
owner: generated
anchors:
  - packages/mcp/src/stdio.ts#startMcpStdioServer
---

# startMcpStdioServer

This page documents the `@livewiki/mcp` stdio server entry point, the single function responsible for creating an MCP server bound to a repository root and wiring it to standard I/O.

## When to use this page

- **Wire** the MCP server to standard input/output from a CLI command or a dedicated binary.
- **Understand** why importing `packages/mcp/src/stdio.ts` does not start a process or touch `process.exit`.
- **Trace** the lifecycle contract between this module and the two callers (`livewiki-mcp` bin and `livewiki serve`).
- **Diagnose** why stdout must remain reserved for the MCP protocol while diagnostics belong on stderr.

## How it fits

This file lives in the `@livewiki/mcp` package, which exposes the Model Context Protocol (MCP) surface for livewiki. The package is consumed from two distinct entry points: the standalone `livewiki-mcp` binary (defined by `index.ts`) and the in-repo `livewiki serve` subcommand inside the livewiki CLI. Both routes funnel into `startMcpStdioServer` so that protocol wiring, transport selection, and lifecycle ownership stay in one place. The module is intentionally side-effect free on import: no transport is created, no signal handlers are installed, and the process is never terminated here. The caller decides whether to call `process.exit` outright (the binary) or to set `process.exitCode` and let libuv drain (the CLI's libuv-safe shutdown convention). Because `StdioServerTransport` writes directly to stdout, any incidental logging from this module would corrupt the protocol stream — diagnostics therefore go to stderr.

## Diagram

```mermaid
%% livewiki/diagrams/mcp-src-stdio.mmd
```

## Building and connecting the stdio MCP server

<!-- lw:anchors packages/mcp/src/stdio.ts#startMcpStdioServer -->

The single export, `startMcpStdioServer`, is the only behavior this file contributes. Its signature from the symbol table is:

```ts
export async function startMcpStdioServer(opts: {
  repoRoot: string;
}): Promise<McpServer>
```

It accepts a `repoRoot` string naming the repository the MCP server should expose, and returns a `Promise<McpServer>` that resolves to the connected MCP server instance.

The function performs three steps in order:

1. **Construct the MCP server.** It calls `createServer({ repoRoot: opts.repoRoot })` from the sibling `./server.js` module, awaiting the result. `createServer` is the place that actually knows how to scan `repoRoot`, build the full-text search (FTS5) index, and register the MCP tools and resources the protocol will advertise.
2. **Attach a stdio transport.** It instantiates a fresh `StdioServerTransport` from `@modelcontextprotocol/sdk/server/stdio.js`. This transport reads MCP requests from standard input and writes MCP responses to standard output; nothing else in this codebase writes to stdout.
3. **Connect and return.** It awaits `server.connect(transport)`. The returned promise resolves once the transport handshake is complete, which is the point at which the caller knows the server is ready to serve MCP traffic. The process continues running as long as the MCP client keeps its end of the connection open.

The function does **not** install signal handlers, does **not** call `process.exit` or set `process.exitCode`, and does **not** start any timers. Shutdown — and therefore closing the FTS5 index opened during step 1 — is the caller's responsibility, exercised by closing the returned `McpServer`. The bin may then `process.exit`; the CLI sets `process.exitCode` and lets libuv drain. This split keeps `stdio.ts` a pure, reusable wiring layer that two very different host processes can drive safely.