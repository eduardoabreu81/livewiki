---
title: packages/cli/src/commands
owner: generated
---

# packages/cli/src/commands

This directory contains the command-layer implementations of the livewiki CLI: each file registers one subcommand onto the shared Commander program in the `@livewiki/cli` package. Together these commands let users provision repositories (`init`), configure the LLM provider (`config`), maintain symbol documentation (`index-cmd`, `baseline`, `status`, `update`, `verify`), export wikis as artifacts or static sites (`export`, `view`), integrate coding agents through MCP servers and pointer files (`serve`, `install`, `pointer`), and run documentation batches (`batch`). Each command acts as a thin adapter that translates Commander options into service calls from `@livewiki/core`, separating report formatting from the underlying index and ledger operations.

## Files

- [baseline.ts](baseline.md) — Baseline Management Commands
- [batch.ts](batch.md) — Batch command registration and human-readable reporting
- [config.ts](config.md) — Interactive configuration and credential management for the LiveWiki CLI
- [export.ts](export.md) — "Export command"
- [index-cmd.ts](index-cmd.md) — Indexing and ledger command
- [init.ts](init.md) — "`livewiki init` command"
- [install.ts](install.md) — LiveWiki Install Command Orchestration
- [pointer.ts](pointer.md) — Pointer command (`livewiki pointer`)
- [serve.ts](serve.md) — livewiki serve command
- [status.ts](status.md) — livewiki status command
- [update.ts](update.md) — livewiki update command
- [verify.ts](verify.md) — livewiki verify command
- [view.ts](view.md) — View command

None of the 13 documented files in this folder has a test file named after it.

<!-- livewiki:navigate:start -->
## Navigate

- Flow: [From CLI Source to Core Source: How livewiki Commands Drive Core Operations](../flows/cli-src-to-core-src.md)
- Topic: [CLI Commands and Core LLM Coordination](../topics/cli-commands-and-core-llm-coordination-2166f507.md)
- [packages/core/src/llm](../llm/index.md) — used here
- [packages/core/src](../core-src/index.md) — used here
- [packages/cli/src](../cli-src/index.md) — used both ways

> Coverage note: this folder's source (13 files, ~101k chars) is too large to read in full; this page documents its main entry points.
<!-- livewiki:navigate:end -->
