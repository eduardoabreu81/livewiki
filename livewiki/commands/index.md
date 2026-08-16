---
title: packages/cli/src/commands
owner: generated
---

# packages/cli/src/commands

This directory holds every `livewiki` subcommand registered on the root Commander program in the `@livewiki/cli` package. Each file is a thin adapter that wires one CLI verb into the program and delegates the real work to sibling modules in `@livewiki/core`: `init` provisions a repo and drives the indexing and LLM pipeline, `install` configures host agents and the MCP entry, `pointer` maintains an opt-in pointer block in agent markdown files, and `serve` exposes the same MCP server over stdio. Operational verbs — `index-cmd`, `update`, `batch`, `status`, `verify` — coordinate the indexing and documentation-generation workflows, while `export` and `view` turn the curated wiki into deliverable artifacts or a browsable static site.

## Files

- [batch.ts](batch.md) — "livewiki batch command — run, resume, and inspect Phase 3 batches"
- [export.ts](export.md) — "Export command"
- [index-cmd.ts](index-cmd.md) — Indexing and ledger command
- [init.ts](init.md) — "`livewiki init` command"
- [install.ts](install.md) — livewiki install command
- [pointer.ts](pointer.md) — Pointer command (`livewiki pointer`)
- [serve.ts](serve.md) — livewiki serve command
- [status.ts](status.md) — livewiki status command
- [update.ts](update.md) — livewiki update command
- [verify.ts](verify.md) — livewiki verify command
- [view.ts](view.md) — View command

None of the 11 documented files in this folder has a test file named after it.

<!-- livewiki:navigate:start -->
## Navigate

- Flow: [From the livewiki CLI to the LLM pipeline](../flows/cli-src-to-llm.md)
- Topic: [Testing](../topics/testing-f41eeea7.md)
- [packages/core/src/llm](../llm/index.md) — used here
- [packages/mcp/src](../mcp-src/index.md) — used here
- [packages/core/src](../core-src/index.md) — used here

> Coverage note: this folder's source (13 files, ~99k chars) is too large to read in full; this page documents its main entry points.
<!-- livewiki:navigate:end -->
