# Quickstart

## What this repository is

livewiki is an agent-first living documentation tool that keeps a Markdown wiki inside a code repository. It is built for teams that want LLM-authored docs held honest by deterministic checks: symbol pages anchor to real code, staleness is measured from tree-sitter hashes without spending tokens, and a verify pass re-reads every page from disk to reject broken links. The product is consumed three ways — through the livewiki CLI for scaffolding and commands, through an MCP server that exposes the same tooling to LLM clients, and through shared engine code that every surface depends on.

*(Synthesized from the verified wiki pages — see `livewiki/understanding.md`.)*

The repository README also states: livewiki keeps technical documentation next to the code it describes. It builds a Markdown wiki, detects what changed, and checks that references to code and other pages still resolve. An LLM writes the prose; livewiki plans the work, tracks documentation debt, preserves human edits, and validates the result.

*(Purpose excerpt from the repository README: `README.md` — one evidence input, not the authority.)*

**Entry points and surfaces**

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

**Fastest local path:** see the "Quick start" section of `README.md`.

## What you'll find in this wiki

- **[packages/core/src/llm](llm/index.md)** — The `packages/core/src/llm/` directory is the engine's seam to external large-language-model providers: it defines the `LlmClient` interface and shared `GenerateResult` types, supplies a single fetch/retry/timeout wrapper used by every…
- **[packages/cli/src/commands](commands/index.md)** — This directory holds every `livewiki` subcommand registered on the root Commander program in the `@livewiki/cli` package.
- **[packages/mcp/src](mcp-src/index.md)** — This directory is the source root of the `@livewiki/mcp` package, the Model Context Protocol (MCP) server that exposes livewiki's documentation tooling to LLM clients such as Claude Code over stdio.
- **[packages/cli/templates/claude-code](claude-code/index.md)** — This directory holds a Claude Code template shipped by the CLI: a single `settings.local.json` scaffold that consumers receive when scaffolding a Claude Code–style project from the CLI.
- **[packages/cli](cli/index.md)** — The `packages/cli` directory hosts the command-line interface package for the project, bundling its manifest (`package.json`), documentation (`README.md`), TypeScript configuration (`tsconfig.json`), and Vitest test runner setup…
- **[packages/core](core/index.md)** — The `packages/core` directory is the package that holds the shared engine of the livewiki project: the TypeScript sources, configuration, and test harness that other packages depend on.

Use this wiki to choose a task, inspect the repository architecture, query focused pages from an agent, and keep the documentation up to date as the code changes.

## Understand the product

- [Testing](topics/testing-f41eeea7.md)
- Browse the complete [Concept topics](topics/index.md) index.

## Work by intent

- **Change product behavior:** start with [Tasks](tasks.md).
- **Follow end-to-end behavior:**
  - [From the livewiki CLI to the LLM pipeline](flows/cli-src-to-llm.md)
  - [MCP source search to LLM agent documentation](flows/mcp-src-to-llm.md)
  - Browse the complete [How it works](flows/index.md) index.
- **Inspect implementation relationships:** open the [Architecture overview](architecture/overview.md).
- **Maintain tests, fixtures, tooling, benchmarks, or repository documentation:** open the [Auxiliary areas](auxiliary/index.md) inventory.

## Document a repo

1. Run `livewiki init` to index the repository and create deterministic navigation.
2. Run `livewiki init --batch` when you also want the generated folder and file pages.
3. Run `livewiki verify` before relying on or publishing the wiki.

## Query the wiki from an agent

1. Read `livewiki_quickstart` for orientation.
2. Use `livewiki_search` to find relevant pages.
3. Use `livewiki_read` to inspect the selected page in full.

## Keep the documentation up to date (for agents)

1. Inspect open debt with `livewiki_debt` or `livewiki status --json`.
2. Update a page with `livewiki_write_doc`, or edit it directly while preserving its ownership rules.
3. Run `livewiki verify`, then close resolved items with `livewiki_resolve_debt`.

## Repository facts

- **240 files** documented
- **31 folders** covered
- **1443 code symbols** indexed
