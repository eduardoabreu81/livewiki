---
title: livewiki serve command
owner: generated
anchors:
  - packages/cli/src/commands/serve.ts#registerServe
---

# livewiki serve command

The `livewiki serve` command registers an MCP server on stdio inside the livewiki CLI, sharing the same runtime as the standalone `livewiki-mcp` binary.

## When to use this page

- **Add** a new CLI flag, option, or subcommand to the `serve` entry point.
- **Trace** how the CLI wires MCP stdio transport into a Commander subcommand.
- **Debug** shutdown behavior, signal handling, or stderr/stdout separation on the CLI side.
- **Compare** the CLI-driven server boot with the standalone `@livewiki/mcp/stdio` bin.

## How it fits

This module lives at `packages/cli/src/commands/serve.ts` and is one of several command registrars in the livewiki CLI package. It depends on the shared Commander `program` instance passed in by the CLI entry point, and on the `@livewiki/mcp/stdio` package for the actual server implementation. The CLI does not embed any MCP logic itself; it only resolves the working repository and then delegates to the shared stdio starter. Because both the CLI path and the standalone bin call the same `startMcpStdioServer`, behavior, protocol semantics, and shutdown expectations are defined in one place.

## Diagram

```mermaid
%% livewiki/diagrams/commands-serve.mmd
```

## Bootstrapping the `serve` subcommand

<!-- lw:anchors packages/cli/src/commands/serve.ts#registerServe -->

The file exposes a single registrar that attaches the `serve` subcommand to a Commander program. The signature is:

```ts
export function registerServe(program: Command): void {
```

`registerServe` takes the parent Commander `program` instance and returns nothing; it mutates `program` in place by adding the `serve` command. The rationale evidence describes this as the CLI path into the same MCP server the standalone `livewiki-mcp` bin runs, so the function exists to give the CLI a first-class subcommand without duplicating server logic.

The registrar calls `program.command("serve")` with a short description and then chains an `action` handler. The handler is `async` and receives the parsed options object plus the active `Command` instance, which is the standard Commander pattern for accessing globally-merged options.

Inside the action, the resolver reads the merged options via `command.optsWithGlobals<{ repo?: string }>()` and computes an absolute repository root by resolving `opts.repo` (defaulting to `"."`) against `process.cwd()`. This is the only path manipulation the command performs; it does not validate that the root exists, and the visible source does not contain an explicit check for that. The resolved `repoRoot` is then handed to `startMcpStdioServer` from `@livewiki/mcp/stdio`.

## Lifecycle, signals, and shutdown

The action is the place where the CLI diverges from a one-shot script: it installs signal handlers for `SIGINT` and `SIGTERM` and wires them to a local `shutdown` closure. When a signal arrives, the handler writes a diagnostic line to stderr and then calls `server.close()` as a fire-and-forget promise (its rejection is intentionally swallowed with a comment-marked best-effort catch). The visible source does not call `process.exit()`; it leaves `process.exitCode` untouched on the normal path so that Node can exit naturally once the event loop drains, matching the rationale evidence on CLI shutdown convention.

The `try`/`catch` surrounding the `startMcpStdioServer` call is the only visible failure branch. If the server fails to start, the handler writes a formatted error to stderr and sets `process.exitCode = 1`. The source does not show any other rollback or cleanup beyond the stderr message and the exit code assignment, and the normal path does not change `process.exitCode`, so a clean start leaves the process exit code at its default of `0`.

## Stdout and stderr separation

The rationale evidence makes the I/O contract explicit: `stdout` carries only the MCP protocol, while all diagnostics from this command — the shutdown notice and the startup error — go to `stderr`. The visible source honors that by routing every `process.stderr.write` call for human-facing messages, and it never writes to `stdout` from this file.