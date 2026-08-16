---
title: packages/mcp/src
owner: generated
---

# packages/mcp/src

This directory is the source root of the `@livewiki/mcp` package, the Model Context Protocol (MCP) server that exposes livewiki's documentation tooling to LLM clients such as Claude Code over stdio. It assembles the server's tool surface (`server.ts`) and its full-text search layer (`search.ts`, backed by a separate `.livewiki/search.db`), wires both to standard I/O via the `startMcpStdioServer` entry (`stdio.ts`), and re-exports that entry as the package's `index.ts` script. Co-located `*.test.ts` files exercise the search index, server wiring, and an end-to-end phase-5 scenario, keeping the server's behavior pinned to a verifiable contract.

## Files

- [index.ts](index-ts.md) — "@livewiki/mcp stdio entry point"
- [search.ts](search.md) — Full-text search index over the wiki · Tests: `search.test.ts`
- [server.ts](server.md) — "MCP server: livewiki tool surface and live index watcher" · Tests: `server.test.ts`
- [stdio.ts](stdio.md) — startMcpStdioServer

### Test files without a same-name counterpart

- `phase5-e2e.test.ts` — no product file in this repository matches this test

2 of the 4 documented files in this folder have a test file named after them.

<!-- livewiki:navigate:start -->
## Navigate

- Flow: [Source Repository to LLM Pipeline](../flows/cli-src-to-llm.md)
- Topic: [Testing](../topics/testing-f41eeea7.md)
- [packages/cli/src/commands](../commands/index.md) — depends on this folder
- [packages/core/src](../core-src/index.md) — used here

> Coverage note: this folder's source (8 files, ~136k chars) is too large to read in full; this page documents its main entry points.
<!-- livewiki:navigate:end -->
