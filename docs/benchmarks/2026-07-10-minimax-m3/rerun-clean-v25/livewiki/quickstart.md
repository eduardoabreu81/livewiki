# Quickstart

Use this wiki to choose a task, inspect the repository architecture, query focused pages from an agent, and keep documentation debt under control.

## Work by intent

- **Change product behavior:** start with [Tasks](tasks.md).
- **Follow end-to-end behavior:**
  - [cli-src → core-src-04 — export marker contract for stage-5 flows](flows/cli-src-to-core-src-04.md)
  - [CLI startup through core import resolution — entry to first sink](flows/cli-src-to-core-src-05.md)
  - [CLI invocation through cross-module documentation pipeline](flows/cli-src-to-core-src-06.md)
  - [cli-src to core-src-07 — Command invocation through navigation hub emission](flows/cli-src-to-core-src-07.md)
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

- **162 files** indexed
- **754 symbols** extracted
- **37 modules** identified
