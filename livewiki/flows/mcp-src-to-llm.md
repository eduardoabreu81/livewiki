---
title: MCP source search to LLM agent documentation
owner: generated
anchors:
  - packages/mcp/src/server.ts#createServer
  - packages/mcp/src/search.ts#indexPage
  - packages/core/src/llm/base.ts#LlmTimeoutError
updated: 2026-08-16
modules:
  - mcp-src
  - core-src
  - llm
---

# MCP source search to LLM agent documentation

This page explains how the livewiki MCP server exposes the repository's documentation tooling over standard I/O, keeps its full-text search index fresh on file changes, and lets a coding agent drive deterministic documentation tasks through the core package's LLM provider seam.

## Purpose

<!-- lw:anchors packages/mcp/src/server.ts#createServer -->

A developer using a coding agent with livewiki wants the agent to be able to read, search, and update the project's documentation on demand through normal agent tool calls, without exposing the repository's internal bookkeeping or trusting the agent with arbitrary writes. The MCP source package (`packages/mcp/src`) is the entry point that makes this possible: it assembles a Model Context Protocol (MCP) server exposing six tools over standard I/O, and it keeps the full-text search layer backed by a separate `.livewiki/search.db` on disk. The server then hands validated agent work to the core package, whose LLM provider seam turns that work into durable documentation.

`createServer` is the factory that builds the server instance.

```ts
export async function createServer(opts: CreateServerOptions = {}): Promise<McpServer> {
```

It takes an optional options object and resolves to a fully wired `McpServer`, which is the object the outer stdio entry point connects to an MCP transport so an LLM client such as Claude Code can call its tools. Among them are the agent-queue tools, where a task is handed out under an exclusive claim and its lease can be renewed explicitly. When every unfinished task is already leased, the queue answers `busy` instead of advancing, and the server skips its search rebuild because the run has not finished.

## Ordered flow

<!-- lw:anchors packages/mcp/src/search.ts#indexPage -->

The end-to-end flow begins with livewiki's full-text search foundation, then uses it to serve agent tool calls, and finally hands validated agent work back to the core package's deterministic documentation machinery.

1. **Build the initial search index.** The search layer walks the repository's Markdown output and populates the separate `.livewiki/search.db` SQLite FTS5 index so search results are available before the first agent query.
2. **Start the MCP server and attach its watcher.** `createServer` builds the server, and the watcher begins observing the repository so later file changes can be picked up. This is the point where the server is connected to a standard I/O transport, allowing an LLM client to invoke its tools.
3. **Serve search queries.** When an agent calls the full-text search tool, the search layer converts the user's query into searchable terms for the FTS5 engine.
4. **Keep the search index and page source in sync.** When files change, the watcher schedules a synchronization run, and the changed Markdown files are collected for reindexing.
5. **Index an individual page.** For each collected page, `indexPage` writes its content into the search index.

```ts
export function indexPage(idx: SearchIndex, wikiPath: string, content: string): void {
```

It takes the search index, the wiki-relative page path, and the page's Markdown content, and returns nothing; its effect is a new or updated FTS5 row for that page.

6. **Turn agent-provided Markdown into ordered documentation work.** Once the agent can read and search the wiki, the documentation machinery in `packages/core/src/agent-bootstrap.ts` takes its submitted Markdown and runs it through livewiki's own queue: the agent supplies Markdown, while livewiki owns ordering, bounded attempts, validation, and transactional writes.
7. **Apply baseline lifecycle operations when a task advances documentation.** As work lands, the baseline machinery records the repository's documentation authority, so subsequent validation has a stable recorded state to compare against.

## Diagram

```mermaid
%% livewiki/diagrams/flow-mcp-src-to-llm.mmd
```

## Invariants

Each stage of this flow must hold specific conditions for the handoff to the next stage to be sound.

- **Search freshness at server start.** Before the server can answer a search tool call, the initial reindexing must have populated `.livewiki/search.db` with every collected Markdown page; the database is the only source a search query consults, so an empty or partial index silently under-serves the agent.
- **Watch exclusion is applied before scheduling.** Changed filenames are checked before they are counted as pending reindexing work; only files that survive that guard may flow through the scheduling and batching path.
- **Batched, not ad-hoc, reindexing.** Watcher events signal pending work; actual index mutation converges through the batched synchronization run, rather than each event mutating the database independently while an earlier batch is still running.
- **One page, one index row.** `indexPage` records each page under its wiki-relative path, so a page's search row is consistently addressable and replaceable across reindexing runs.
- **Baseline state precedes validation.** For agent bootstrap work, the baseline must be bootstrapped before migration, relocation, or acceptance can meaningfully run: each later operation assumes a baseline record already exists to update.
- **Queue ownership stays with livewiki.** The coding agent supplies Markdown, but ordering, bounded attempts, validation, and transactional writes are owned by the core package; the agent does not get to choose or skip queue steps.

## Failure and recovery

<!-- lw:anchors packages/core/src/llm/base.ts#LlmTimeoutError -->

The most visible recovery machinery in the cited source lives on the LLM provider side, where a slow or failing provider must not hang or silently corrupt documentation runs.

`LlmTimeoutError` is the dedicated error type raised when a provider call exceeds its time budget.

```ts
export class LlmTimeoutError extends Error {
```

It extends the standard `Error` so a timeout can be caught specifically and distinguished from a provider-returned failure, giving callers a clean branch to handle a hung request without mistaking it for a refusal or a bad payload.

The supplied source excerpt is truncated at the file-heading level: for most of the symbols in this flow it shows signatures and contract prose but not the full function bodies. Consequently, the concrete retry counts, rollback edges, or fail-open versus fail-closed branching inside the synchronization, reindexing, or baseline operations are not visible in this excerpt; the prose above covers only the recovery paths that the quoted signatures and package-level contracts establish. No additional rollback behavior is asserted beyond what these visible pieces show.

## Related pages

- [mcp-src](../mcp-src/index.md)
- [core-src](../core-src/index.md)
- [llm](../llm/index.md)
- [How it works](index.md)

<!-- livewiki:topics:start -->
## Concept topics

- [Testing](../topics/testing-f41eeea7.md)
<!-- livewiki:topics:end -->
