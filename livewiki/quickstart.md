# Quickstart

## What this repository is

livewiki is an agent-first living documentation tool that turns a source repository into a Markdown wiki anchored to real code symbols. It serves coding agents and engineering teams who need a navigable, verifiable map of a codebase, maintained through an LLM-written, deterministically-checked pipeline. Users invoke the livewiki CLI to index a tree, generate documentation, and verify every claim against tree-sitter symbol hashes, with MCP and CI integrations for ongoing maintenance.

*(Synthesized from the verified wiki pages — see `livewiki/understanding.md`.)*

The repository README also states: livewiki is an agent-first living documentation tool: a Markdown wiki that lives inside your repository, is written by an LLM, and is kept honest by deterministic machinery that never calls a model — every page anchors to real code symbols, staleness is computed from tree-sitter hashes with zero tokens, and `verify` rejects any claim that does not resolve to the code.

*(Purpose excerpt from the repository README: `README.md` — one evidence input, not the authority.)*

**Entry points and surfaces**

- livewiki CLI command-line interface that parses argv, resolves the target repository, and routes subcommands to the core pipeline
- core batch documentation engine that orchestrates indexing, artifact normalization, validation, topic planning, and update work-packages
- deterministic indexer and SQLite-backed code index that hashes symbols and computes staleness with zero LLM tokens
- LLM client with Anthropic and OpenAI-compatible adapters for the generation stages of the pipeline
- repository-understanding synthesis and prompt template layer shared across generation stages
- Phase 7 static viewer that renders the wiki as a self-contained site with a synthetic Activity dashboard
- livewiki MCP stdio server paired with a SQLite FTS5 search index for MCP-compatible clients
- CLI command registry that wires Commander subcommands to core operations and output formatting
- Init and install commands backed by an on-disk manifest snapshot for first-run setup
- Opt-in hook and CI templates for git, Claude Code, and GitHub Actions docs-debt detection

**Fastest local path:** see the "Quick start" section of `README.md`.

## What you'll find in this wiki

- **[core indexing, imports, flows, and frontmatter](core-src-04.md)** — This page documents the `@livewiki/core` source files that drive the stage 5–adjacent pipeline: import extraction, import resolution, flow candidate detection, frontmatter parsing, content hashing, the indexer orchestration, and the…
- **[Safe I/O, section guarding, status reporting, and symbol extraction](core-src-09.md)** — This page documents the responsibilities of four cooperating modules in `packages/core/src`: `safe-io.ts`, `section-guard.ts`, `status.ts`, and `symbols.ts`.
- **[Stage 4 artifact normalization, validation, and auxiliary page assembly](core-src-01.md)** — This page documents the stage 4 artifact pipeline that normalizes and validates generated Markdown, the anchor ledger that reconciles those pages against the code index, the mechanical repairer for deterministic fixes, and the auxiliary…
- **[core topics, understanding, update metrics, update, and verify](core-src-10.md)** — This page documents the five source files in `packages/core/src/` that together implement stage-5 semantic topic planning, the repository-understanding synthesis, the incremental `update` work-package flow, its append-only metrics ledger,…
- **[Init, install, manifest, markdown-mask, and mermaid-validator support](core-src-05.md)** — This page documents the core support layer that backs the `livewiki init` and `livewiki install` commands, the on-disk `livewiki/.manifest.json` snapshot, and the Markdown and Mermaid validation helpers shared across the verification…
- **["Core Source 03: Config, Index, Export, Diagrams, Diff Preview"](core-src-03.md)** — This page documents the deterministic, non-LLM subsystems that back livewiki's source repo support: the per-repo JSON config, the SQLite schema and migrations that hold the index, the diagram generators that produce Mermaid from facts, the…

Use this wiki to choose a task, inspect the repository architecture, query focused pages from an agent, and keep documentation debt under control.

## Work by intent

- **Change product behavior:** start with [Tasks](tasks.md).
- **Follow end-to-end behavior:**
  - [CLI command surface to core pipeline wiring](flows/cli-src-to-core-src-02.md)
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
- **1225 symbols** extracted
- **51 modules** identified
