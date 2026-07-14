# Quickstart

Use this wiki to choose a task, inspect the repository architecture, query focused pages from an agent, and keep documentation debt under control.

## Choose a path

- Start with [Tasks](tasks.md) when you know what you want to accomplish.
- Open the [Architecture overview](architecture/overview.md) when you need the repository map and module relationships.

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

- **90 files** indexed
- **504 symbols** extracted
- **24 modules** identified
