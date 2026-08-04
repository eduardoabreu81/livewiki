# Quickstart

## What this repository is

livewiki is an agent-first living documentation tool: a Markdown wiki that lives inside your repository, is written by an LLM, and is kept honest by deterministic machinery that never calls a model — every page anchors to real code symbols, staleness is computed from tree-sitter hashes with zero tokens, and `verify` rejects any claim that does not resolve to the code.

*(Purpose excerpt from the repository README: `README.md`.)*

**Fastest local path:** see the "Quick start" section of `README.md`.

## What you'll find in this wiki

- **[Core batch pipeline and call-graph analytics](core-src-04.md)** — This page documents the batch documentation pipeline and the supporting call-graph analytics that feed it.
- **[Core source module 09 — orientation, parser, pointer, output budget, navigation](core-src-09.md)** — This page documents the symbols exported from the `packages/core/src` modules collected under the `core-src-09` slice — repository orientation evidence, the tree-sitter parser wrapper, the `AGENTS.md`/`CLAUDE.md` pointer writer, the…
- **[Anchor ledger and artifact repair](core-src-01.md)** — This module reconciles wiki anchor metadata against the code index and mechanically repairs stage-4 documentation artifacts emitted by the model.
- **[core prompts, presets, pricing, and README export](core-src-10.md)** — This module assembles the LLM prompt templates, provider presets, pricing table, and the deterministic README exporter that drive the batch documentation pipeline.
- **[Batch stage 5, status aggregation, and surgical repair fixtures](core-src-03.md)** — This module owns the test fixtures, mock LLM stubs, and aggregation helpers that exercise stage-5 (semantic flows / topics), the `batch status` report, and the surgical section-scoped repair path in `packages/core/src`.
- **[Core runtime config, schema, diagrams, diff preview, and export](core-src-05.md)** — This module groups the livewiki core runtime surfaces that operate below the LLM: per-repo config loading, the SQLite index schema and migrations, deterministic Mermaid generators, a read-only working-tree debt preview, and the…

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

- **206 files** indexed
- **1221 symbols** extracted
- **50 modules** identified
