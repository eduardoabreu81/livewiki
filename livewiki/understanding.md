---
title: livewiki
owner: generated
kind: understanding
updated: 2026-08-12
---

# livewiki

livewiki is an agent-first living documentation tool that keeps a Markdown wiki inside a code repository. It is built for teams that want LLM-authored docs held honest by deterministic checks: symbol pages anchor to real code, staleness is measured from tree-sitter hashes without spending tokens, and a verify pass re-reads every page from disk to reject broken links. The product is consumed three ways — through the livewiki CLI for scaffolding and commands, through an MCP server that exposes the same tooling to LLM clients, and through shared engine code that every surface depends on.

## Where to look in the code

- packages/cli — the livewiki command-line package, bundling manifest, docs, TypeScript config, and Vitest test runner.
- packages/cli/src/commands — every livewiki subcommand registered on the root Commander program.
- packages/cli/templates — inert scaffolding files shipped by the CLI for bootstrapping new projects.
- packages/cli/templates/claude-code — the Claude Code settings.local.json scaffold the CLI drops into new projects.
- packages/cli/templates/github-actions — the docs-debt.yml GitHub Actions workflow the CLI ships as ready-made CI.
- packages/cli/skills/document-as-you-go — the SKILL.md defining the document-as-you-go workflow that prompts capturing decisions inline while coding.
- packages/mcp — the Model Context Protocol package that exposes livewiki's tooling over a standardized tool-calling interface.
- packages/mcp/src — the MCP server source root, an stdio server that serves LLM clients such as Claude Code.
- packages/core — the shared engine package: TypeScript sources, configuration, and test harness other packages depend on.
- packages/core/src/llm — the LlmClient interface, shared GenerateResult types, and the single fetch/retry/timeout wrapper every provider uses.