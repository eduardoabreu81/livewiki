---
title: "@livewiki/mcp stdio entry point"
owner: generated
anchors:
  - packages/mcp/src/index.ts#main
  - packages/mcp/src/index.ts#parseArgs
---

# @livewiki/mcp stdio entry point

This page documents the stdio entry point of the `@livewiki/mcp` package, the script that an MCP client launches and keeps alive for the duration of a session.

## When to use this page

- **Configure** the `@livewiki/mcp` server from an MCP client (for example Claude Code) by pointing it at this entry point with the right CLI flags.
- **Diagnose** startup or shutdown behavior of the MCP server — what happens when it starts, when it exits, and which signals it reacts to.
- **Extend** the CLI surface by adding new flags that `parseArgs` should recognize alongside `--repo`.
- **Trace** the runtime path from process argv through argument parsing to the stdio server handshake.

## How it fits

`@livewiki/mcp` is the Model Context Protocol (MCP) server for livewiki: a Node process that an MCP client (Claude Code, or any other stdio-speaking MCP client) launches and talks to over standard input/output. This file — `packages/mcp/src/index.ts` — is the package's entry point. It does not implement MCP methods itself; instead it parses the CLI arguments the client passes (most importantly `--repo`, the livewiki repository the server should operate on), then delegates to `startMcpStdioServer` from `./stdio.js`, which constructs the server and binds it to `StdioServerTransport`. The process is then expected to stay alive while the MCP client is connected, and to shut down cleanly when the client disconnects or the user terminates it.

Within the monorepo, this file sits at the top of the `@livewiki/mcp` package and is the only piece the package's `bin` configuration needs to point at. Its two responsibilities are narrow and mechanical: read `--repo` (defaulting to the current working directory), and forward the resolved value to the stdio server factory; then wire up signal handlers so the process exits with code `0` on `SIGINT`/`SIGTERM` and code `1` on a fatal startup error.

## Diagram

```mermaid
%% livewiki/diagrams/mcp-src-index-ts.mmd
```

## Argument parsing

<!-- lw:anchors packages/mcp/src/index.ts#parseArgs -->

The MCP client launches the server with command-line arguments, so the first responsibility of this file is to extract the one flag the entry point cares about — the repository root the server should index and serve.

```ts
function parseArgs(argv: readonly string[]): { repoRoot: string }
```

`parseArgs` walks `argv` (the slice of `process.argv` after the node executable and script path) looking for a `--repo` flag whose next token is present, resolves that token to an absolute path, and returns it as `repoRoot`. If `--repo` is absent — or if it appears without a following value — `repoRoot` stays at its initial value of `process.cwd()`. Note that the loop only advances the index past the consumed value after a successful `--repo <value>` pair, and it does not report an error if the flag is malformed in other ways (for example `--repo` as the final token): in that case the flag is silently ignored and the default stands.

The shape is intentionally minimal: a single typed object with one field. Callers like `main` destructure `repoRoot` and forward it to the server factory; nothing else in the file consumes the CLI surface.

## Server startup and signal handling

<!-- lw:anchors packages/mcp/src/index.ts#main -->

With the repository root in hand, the entry point's `main` function hands off to the stdio server and then stays alive by listening for shutdown signals. The MCP server itself lives in `./stdio.js`; this file is only the thin lifecycle wrapper around it.

```ts
async function main(): Promise<void>
```

`main` calls `parseArgs(process.argv.slice(2))` to obtain the resolved `repoRoot`, awaits `startMcpStdioServer({ repoRoot })` from `./stdio.js`, and from that point the server keeps the process running. Once the server is up, `main` registers two signal handlers — one for `SIGINT` and one for `SIGTERM` — that each invoke a local `shutdown` helper. `shutdown` writes a one-line notice to stderr, awaits `server.close()` inside a `try`/`catch` that swallows any error (a best-effort close — the full-text index the server manages is closed through this call when it is reached), and then calls `process.exit(0)`.

Outside `main`, the file wires up an unguarded `.catch` on the `main()` promise. If `startMcpStdioServer` rejects — for example because `--repo` points at an invalid repository or another setup error is thrown — the catch handler writes `[livewiki-mcp] fatal: <message>` to stderr and exits with code `1`. The successful path is therefore: argv parsing, server creation, signal-driven clean shutdown on `0`; the visible failure path is: any rejection from startup, surfaced as `1`.