# Quickstart

## What this repository is

livewiki is a code-anchored documentation tool for developers, turning GitHub repositories into wiki sites via its command-line interface. It scaffolds wikis, installs templates, and indexes source code, then drives its core LLM client layer to generate documentation from language models. The CLI commands coordinate with core modules to produce documentation that knows when it has gone stale.

*(Synthesized from the verified wiki pages — see `livewiki/understanding.md`.)*

The repository README also states: **Code-anchored documentation that knows when it is stale.**

*(Purpose excerpt from the repository README: `README.md` — one evidence input, not the authority.)*

**Entry points and surfaces**

- packages/cli: the command-line interface package where users interact with the tool.
- packages/cli/src/commands: one file per subcommand, registering onto the shared Commander program.
- packages/core: holds essential configuration and the core business logic foundation.
- packages/core/src/llm: the client layer that turns validated configuration into LLM content generation.
- packages/cli/skills/bootstrap-wiki: turns a plain GitHub repository into a wiki site.
- packages/cli/skills/document-as-you-go: turns writing activity into documentation practice.
- packages/cli/templates: scaffolding templates, including GitHub Actions workflow and Claude Code settings.
- packages/mcp: a scaffold for the Model Context Protocol server package.
- .github/workflows: continuous-integration configuration for the product.

**Fastest local path:** see the "Quick start" section of `README.md`.

## What you'll find in this wiki

- **[packages/core/src/llm](llm/index.md)** — The `llm` directory implements livewiki's LLM client layer: code that turns a validated repository configuration into a working interface for generating content from a language model.
- **[packages/cli/src/commands](commands/index.md)** — This directory contains the command-layer implementations of the livewiki CLI: each file registers one subcommand onto the shared Commander program in the `@livewiki/cli` package.
- **[packages/cli/skills/bootstrap-wiki](bootstrap-wiki/index.md)** — `bootstrap-wiki` is a command skill for the livewiki CLI that turns a plain GitHub repository into a livewiki wiki site.
- **[packages/cli/templates/claude-code](claude-code/index.md)** — This directory holds the template for a local Claude Code settings file (`settings.local.json`) that is meant to be copied into a user’s project when scaffolding.
- **[packages/cli](cli/index.md)** — This directory is the command-line interface (CLI) package for the livewiki project.
- **[packages/core](core/index.md)** — `packages/core` is the foundation of the livewiki monorepo, providing the essential configuration and documentation for the package that holds the core business logic.

Use this wiki to choose a task, inspect the repository architecture, query focused pages from an agent, and keep the documentation up to date as the code changes.

## Understand the product

- [CLI Commands and Core LLM Coordination](topics/cli-commands-and-core-llm-coordination-2166f507.md)
- Browse the complete [Concept topics](topics/index.md) index.

## Work by intent

- **Change product behavior:** start with [Tasks](tasks.md).
- **Follow end-to-end behavior:**
  - [From CLI Source to Core Source: How livewiki Commands Drive Core Operations](flows/cli-src-to-core-src.md)
  - [cli-src to llm](flows/cli-src-to-llm.md)
  - [from source indexing to LLM-driven documentation](flows/mcp-src-to-llm.md)
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

- **262 files** documented
- **33 folders** covered
- **1572 code symbols** indexed
