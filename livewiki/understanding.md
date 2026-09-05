---
title: livewiki
owner: generated
kind: understanding
updated: 2026-09-05
---

# livewiki

livewiki is a code-anchored documentation tool for developers, turning GitHub repositories into wiki sites via its command-line interface. It scaffolds wikis, installs templates, and indexes source code, then drives its core LLM client layer to generate documentation from language models. The CLI commands coordinate with core modules to produce documentation that knows when it has gone stale.

## Where to look in the code

- packages/cli: the command-line interface package where users interact with the tool.
- packages/cli/src/commands: one file per subcommand, registering onto the shared Commander program.
- packages/core: holds essential configuration and the core business logic foundation.
- packages/core/src/llm: the client layer that turns validated configuration into LLM content generation.
- packages/cli/skills/bootstrap-wiki: turns a plain GitHub repository into a wiki site.
- packages/cli/skills/document-as-you-go: turns writing activity into documentation practice.
- packages/cli/templates: scaffolding templates, including GitHub Actions workflow and Claude Code settings.
- packages/mcp: a scaffold for the Model Context Protocol server package.
- .github/workflows: continuous-integration configuration for the product.