# Quickstart

## What this repository is

This repository is organized around Core Repair, Status, Sectioning, Symbols, and Risk Pipeline (This module page describes the livewiki core's mid-stack pipeline: safe filesystem I/O, symbol and rationale extraction from source, deterministic debt risk scoring, surgical H2-section repair, the closed repair contract, and the status…), Core runtime config, schema, diagrams, diff preview, and export (This module groups the livewiki core runtime surfaces that operate below the LLM: per-repo config loading, the SQLite index schema and migrations, deterministic Mermaid generators, a read-only working-tree debt preview, and the…), and Core module identification, manifest I/O, and Markdown mask helpers (This page documents the core package's responsibilities for batch-stage 2 module identification and partitioning, the cross-machine manifest ledger under `livewiki/`, the deterministic Markdown code mask used by structural scans, and the…).

*(Synthesized from the generated module pages.)*

## What you'll find in this wiki

- **[Core Repair, Status, Sectioning, Symbols, and Risk Pipeline](core-src-11.md)** — This module page describes the livewiki core's mid-stack pipeline: safe filesystem I/O, symbol and rationale extraction from source, deterministic debt risk scoring, surgical H2-section repair, the closed repair contract, and the status…
- **[Core runtime config, schema, diagrams, diff preview, and export](core-src-05.md)** — This module groups the livewiki core runtime surfaces that operate below the LLM: per-repo config loading, the SQLite index schema and migrations, deterministic Mermaid generators, a read-only working-tree debt preview, and the…
- **[Core module identification, manifest I/O, and Markdown mask helpers](core-src-08.md)** — This page documents the core package's responsibilities for batch-stage 2 module identification and partitioning, the cross-machine manifest ledger under `livewiki/`, the deterministic Markdown code mask used by structural scans, and the…
- **[core-src-06 stage-5 internals (flows, diagrams, frontmatter, gitignore, hashes, import resolution)](core-src-06.md)** — This page documents the stage-5 cross-module flow machinery, the deterministic Mermaid flowchart renderer, the frontmatter parser, the `.gitignore` managed-block writer, the EOL-insensitive hash helpers, and the unified import resolver for…
- **[core prompts, presets, pricing, and README export](core-src-10.md)** — This module assembles the LLM prompt templates, provider presets, pricing table, and the deterministic README exporter that drive the batch documentation pipeline.
- **[Livewiki core src 07](core-src-07.md)** — This page documents the livewiki core source slice covering imports parsing, the indexer entry point, the `init` command pipeline, the `install` agent registry and merge adapters, and the regression helpers used by the…

Use this wiki to choose a task, inspect the repository architecture, query focused pages from an agent, and keep documentation debt under control.

## Work by intent

- **Change product behavior:** start with [Tasks](tasks.md).
- **Follow end-to-end behavior:**
  - [CLI to persistence flow — entry through `livewiki batch` to the SQLite index](flows/cli-src-01-to-core-src-05.md)
  - Browse the complete [How it works](flows/index.md) index.
- **Inspect implementation relationships:** open the [Architecture overview](architecture/overview.md).
- **Maintain tests, fixtures, tooling, benchmarks, or repository documentation:** open the [Auxiliary modules](auxiliary/index.md) inventory.

## Document a repo

1. Run `livewiki init` to index the repository and create deterministic navigation.
2. Run `livewiki init --batch` when you also want generated module pages.
3. Run `livewiki verify` before relying on or publishing the wiki.

## Query the wiki from an agent

1. Read `livewiki_quickstart` for orientation.
2. Use `livewiki_search` to find relevant pages.
3. Use `livewiki_read` to inspect the selected page in full.

## Pay documentation debt

1. Inspect open debt with `livewiki_debt` or `livewiki status --json`.
2. Update a page with `livewiki_write_doc`, or edit it directly while preserving its ownership rules.
3. Run `livewiki verify`, then close resolved items with `livewiki_resolve_debt`.

## Repository facts

- **219 files** indexed
- **1079 symbols** extracted
- **47 modules** identified
