---
title: livewiki
owner: generated
kind: understanding
updated: 2026-08-04
---

# livewiki

livewiki is an agent-first living documentation tool that turns a source repository into a Markdown wiki anchored to real code symbols. It serves coding agents and engineering teams who need a navigable, verifiable map of a codebase, maintained through an LLM-written, deterministically-checked pipeline. Users invoke the livewiki CLI to index a tree, generate documentation, and verify every claim against tree-sitter symbol hashes, with MCP and CI integrations for ongoing maintenance.

## Key surfaces

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