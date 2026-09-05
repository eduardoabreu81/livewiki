---
title: packages/mcp/src
owner: generated
---

# packages/mcp/src

This directory holds automated tests with no co-located product code.

## Files

- [index.ts](index-ts.md) — "@livewiki/mcp stdio entry point"
- [search.ts](search.md) — SQLite FTS5 full-text search index for wiki pages · Tests: `search.test.ts`
- [server.ts](server.md) — MCP Server Assembly and Working-Tree Watch · Tests: `server.test.ts`
- [stdio.ts](stdio.md) — startMcpStdioServer
- [version.ts](version.md) — Reading the livewiki MCP package version · Tests: `version.test.ts`
- [watch-queue.ts](watch-queue.md) — Watcher Sync Queue State Machine · Tests: `watch-queue.test.ts`

### Test files without a same-name counterpart

- `agent-bootstrap-e2e.test.ts` — no product file in this repository matches this test
- `bin-e2e.test.ts` — no product file in this repository matches this test
- `phase5-e2e.test.ts` — no product file in this repository matches this test
- `watcher-retry-e2e.test.ts` — no product file in this repository matches this test

4 of the 6 documented files in this folder have a test file named after them.

<!-- livewiki:navigate:start -->
## Navigate

- Flow: [cli-src to llm](../flows/cli-src-to-llm.md)
- Topic: [CLI Commands and Core LLM Coordination](../topics/cli-commands-and-core-llm-coordination-2166f507.md)
- [packages/cli/src/commands](../commands/index.md) — depends on this folder
- [packages/core/src](../core-src/index.md) — used here

> Coverage note: this folder's source (14 files, ~211k chars) is too large to read in full; this page documents its main entry points.
<!-- livewiki:navigate:end -->
