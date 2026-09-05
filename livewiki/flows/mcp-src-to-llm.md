---
title: from source indexing to LLM-driven documentation
owner: generated
anchors:
  - packages/mcp/src/server.ts#createServer
  - packages/mcp/src/server.ts#isWatchDenied
  - packages/mcp/src/server.ts#startWatcher
  - packages/mcp/src/search.ts#close
  - packages/core/src/agent-bootstrap.ts#nextAgentBootstrapTask
  - packages/mcp/src/search.ts#collectMarkdownFiles
  - packages/core/src/agent-bootstrap.ts#renewAgentBootstrapClaim
  - packages/mcp/src/search.ts#indexPage
  - packages/core/src/agent-bootstrap.ts#submitAgentBootstrapTask
  - packages/mcp/src/search.ts#isFtsQueryError
  - packages/core/src/baseline-operations.ts#acceptBaseline
  - packages/mcp/src/search.ts#openAndIndex
  - packages/core/src/baseline-operations.ts#bootstrapBaseline
  - packages/mcp/src/search.ts#queryTerms
  - packages/core/src/baseline-operations.ts#migrateBaselineKey
  - packages/mcp/src/search.ts#reindexAll
  - packages/core/src/baseline-operations.ts#relocateBaselineEntry
  - packages/core/src/db.ts#assertExistingIndexIsUsable
  - packages/core/src/llm/index.ts#createLlmClient
  - packages/core/src/llm/probe.ts#formatProbeFailure
  - packages/core/src/llm/probe.ts#probeProvider
  - packages/core/src/llm/base.ts#DEFAULT_LLM_TIMEOUT_MS
  - packages/core/src/llm/base.ts#isRetryableStatus
  - packages/core/src/llm/base.ts#LlmTimeoutError
  - packages/core/src/llm/base.ts#LlmTimeoutError.constructor
updated: 2026-09-05
modules:
  - mcp-src
  - core-src
  - llm
quality: degraded
---

> **Draft page** — "Source to LLM: how the MCP server indexes a wiki and hands deterministic task metadata to the LLM layer" was written automatically and checked against the code, but its wording may be rougher than the other pages.

# Source to LLM: how the MCP server indexes a wiki and hands deterministic task metadata to the LLM layer

This page explains the end-to-end path that begins when the MCP (Model Context Protocol) server is created and ends when the LLM layer is asked to produce or refine documentation for an indexed repository.

## Purpose

<!-- lw:anchors packages/mcp/src/server.ts#createServer packages/mcp/src/server.ts#isWatchDenied packages/mcp/src/server.ts#startWatcher -->

A person working in a repository first wants their coding agent to be able to produce and maintain the livewiki documentation for that repository. The agent does not read the whole codebase; instead it talks to the livewiki MCP server, which exposes tools that index the source, search the wiki, and — critically — hand the agent deterministic task metadata (which files to document, in what order) without leaking provider configuration, model names, API keys, or the need to drive an external agent process. That division is what the flow described here preserves: the MCP server owns ordering and validation, the LLM layer owns the actual content generation from a configured provider.

The flow starts when `createServer` builds the MCP server that the agent connects to over stdin. `createServer` is the entry point that wires all six tools (quickstart, read, search, write, debt, verify) into the MCP tool registry. From there the server exposes the search and indexing surface that keeps the wiki queryable and fresh. `startWatcher` runs a filesystem watcher that reindexes when source files change, and `isWatchDenied` is the predicate that filters which filesystem events may trigger that reindexing. These three symbols together define the entry boundary: without a server there is no tool surface, and without the watcher the index drifts away from the working tree. The flow's purpose is therefore to put an agent in front of an always-current searchable inventory of the repository, and to make that inventory available to the LLM layer that turns it into documentation.

## Ordered flow

<!-- lw:anchors packages/mcp/src/search.ts#close packages/core/src/agent-bootstrap.ts#nextAgentBootstrapTask packages/core/src/agent-bootstrap.ts#renewAgentBootstrapClaim packages/mcp/src/search.ts#collectMarkdownFiles packages/mcp/src/search.ts#indexPage packages/mcp/src/search.ts#isFtsQueryError packages/core/src/baseline-operations.ts#bootstrapBaseline packages/mcp/src/search.ts#openAndIndex packages/mcp/src/search.ts#queryTerms packages/core/src/baseline-operations.ts#migrateBaselineKey packages/mcp/src/search.ts#reindexAll packages/core/src/baseline-operations.ts#relocateBaselineEntry packages/core/src/agent-bootstrap.ts#submitAgentBootstrapTask packages/core/src/baseline-operations.ts#acceptBaseline -->

1. **Server creation and tool registration.** `createServer` instantiates the MCP server and exposes the six tools to the connected agent. The agent then calls the search or write tools, which are the only way the agent can interact with the wiki content.

2. **Index opening and (re)indexing.** When a search or write tool first needs the index, `openAndIndex` opens the SQLite database at the repository's `.livewiki/search.db` path and, if needed, populates it. `openAndIndex` calls `reindexAll` to rebuild the full-text index from every Markdown file under the wiki root. `collectMarkdownFiles` walks that directory and returns the list of candidate `.md` paths for `reindexAll` to process.

3. **Per-file ingestion.** `indexPage` takes one wiki page (its path and raw Markdown content), tokenizes it, and writes the rows into the two-table FTS5 (SQLite full-text search) schema — one table for the page, one for the identifier-split tokens. If the page content changes later, `indexPage` replaces the prior rows so the index never carries stale fragments.

4. **Queueing work for an agent.** With the index fresh, the flow moves to the deterministic batch plan that tells the agent what to document. The agent-bootstrap queue owns this. `nextAgentBootstrapTask` pops the next task for the repository, `renewAgentBootstrapClaim` extends the calling agent's lease on a task it has already claimed (so a slow agent is not dispossessed), and `submitAgentBootstrapTask` records the agent's finished artifact back onto the queue for validation. Each of these functions takes the repository root and returns or records an `AgentQueueResult`-shaped task.

5. **Baseline lifecycle around the queue.** The baseline is the versioned snapshot (`livewiki/.baseline.json`) of what symbol version each page documents; it is what makes a clean clone validate the same evidence without the SQLite projection. The queue work is bracketed by baseline operations: `bootstrapBaseline` creates the initial baseline for a repository, `migrateBaselineKey` rewrites a symbol key inside the baseline when a symbol is renamed, and `relocateBaselineEntry` moves a baseline page entry when the page itself moves. `acceptBaseline` is the commit point that promotes a written page's symbol versions into the accepted baseline. The ordering invariant is that baseline transitions happen around agent-submitted tasks, never interleaved with them.

6. **Querying the index.** When the agent asks `livewiki_search`, `queryTerms` splits the raw query string into its identifier-aware terms (camelCase, PascalCase, acronym runs, snake_case, kebab) and runs the FTS5 MATCH against the two-table schema. `isFtsQueryError` is the predicate used to detect a malformed FTS query so the tool can return a helpful error instead of a raw SQLite failure.

7. **Closing the index.** When the server shuts down, `close` releases the open SQLite database handle so the process can exit cleanly and no file lock is left behind.

## Diagram

```mermaid
%% livewiki/diagrams/flow-mcp-src-to-llm.mmd
```

## Invariants

At the entry boundary, the MCP server must expose exactly the six documented tools, and the watcher must only trigger reindexing for paths that `isWatchDenied` does not filter. The search index is a separate `.livewiki/search.db` database — never a virtual table inside the main `.livewiki/index.db` — so a schema bump in one cannot corrupt the other. Within the index, each wiki page has exactly one row in the page table, and its token rows reference that row; reindexing a page atomically replaces both. The agent-bootstrap queue must never hand the same task to two agents: claims are exclusive and renewed by lease. Baseline operations are ordered around queue submissions and must not run concurrently with them; the baseline stays the single repository authority for symbol versions even when the SQLite projection is absent. The LLM layer never receives the agent's provider configuration or credentials — the MCP server only forwards deterministic task metadata and the agent's own supplied Markdown artifact.

## Failure and recovery

<!-- lw:anchors packages/core/src/db.ts#assertExistingIndexIsUsable packages/core/src/llm/index.ts#createLlmClient packages/core/src/llm/probe.ts#probeProvider packages/core/src/llm/probe.ts#formatProbeFailure packages/core/src/llm/base.ts#DEFAULT_LLM_TIMEOUT_MS packages/core/src/llm/base.ts#isRetryableStatus packages/core/src/llm/base.ts#LlmTimeoutError packages/core/src/llm/base.ts#LlmTimeoutError.constructor -->

When the search database at a path already exists but may have been created by a newer or older build, `assertExistingIndexIsUsable(db: Database.Database, dbPath: string): void` is the fail-closed gate `openAndIndex` runs before trusting that file; it takes the open database and its path and validates that the schema is one this build can read, throwing rather than silently reading a mismatched schema. On a malformed FTS query, `isFtsQueryError` lets the search tool return a user-facing diagnostic instead of surfacing a raw SQLite error. In the agent-bootstrap queue, a claim that is not renewed before its lease expires is re-offerable to another agent — that is the recovery path for a crashed or hung agent. The baseline operations are transactional at the commit point, so a crashed `acceptBaseline` leaves the previous accepted baseline intact rather than a half-promoted one.

On the LLM side, the failure modes are provider-specific and are handled before any paid run. `createLlmClient(repoRoot: string, config: LivewikiConfig): LlmClient` is the factory that takes the repository root and validated configuration and returns a client — either an Anthropic Messages adapter or an OpenAI-compatible adapter — and the two adapters share a common fetch/retry/timeout wrapper in `base.ts`. Before the first real generation, `probeProvider` runs a connectivity probe against the endpoint so a provider that silently changed behavior is caught before it bills a run; `formatProbeFailure` turns the probe's result into a readable message for the user. The shared wrapper defines `DEFAULT_LLM_TIMEOUT_MS` (300,000 ms) as the default ceiling for a single provider call, and `isRetryableStatus` decides which HTTP status codes warrant a retry rather than an immediate failure. When a call exceeds the timeout, the wrapper throws `LlmTimeoutError`, whose constructor records which provider and how long it waited, so the caller can attribute the failure precisely. The visible evidence does not show a retry loop that eventually gives up with a different error type, nor a fallback that switches providers mid-run; the recovery story is that timeouts surface as `LlmTimeoutError`, non-retryable statuses fail fast, and retryable statuses are retried within the shared wrapper before any error reaches the caller.

## Related pages

- [mcp-src](../mcp-src/index.md)
- [core-src](../core-src/index.md)
- [llm](../llm/index.md)
- [How it works](index.md)