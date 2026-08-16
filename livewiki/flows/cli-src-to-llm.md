---
title: Source Repository to LLM Pipeline
owner: generated
anchors:
  - packages/cli/src/cli.ts#createProgram
  - packages/cli/src/cli.ts#readVersion
  - packages/cli/src/cli.ts#resolveRepoRoot
  - packages/mcp/src/server.ts#createServer
  - packages/mcp/src/server.ts#isWatchDenied
  - packages/mcp/src/server.ts#schedule
  - packages/mcp/src/server.ts#startWatcher
  - packages/mcp/src/server.ts#stop
  - packages/mcp/src/server.ts#syncBatch
  - packages/cli/src/output.ts#emitHuman
  - packages/cli/src/commands/baseline.ts#registerBaseline
  - packages/mcp/src/stdio.ts#startMcpStdioServer
  - packages/core/src/agent-bootstrap.ts#nextAgentBootstrapTask
  - packages/cli/src/output.ts#emitJson
  - packages/cli/src/commands/batch.ts#registerBatch
  - packages/mcp/src/search.ts#close
  - packages/core/src/agent-bootstrap.ts#submitAgentBootstrapTask
  - packages/cli/src/output.ts#emit
  - packages/cli/src/commands/config.ts#registerConfig
  - packages/mcp/src/search.ts#collectMarkdownFiles
  - packages/core/src/baseline-operations.ts#acceptBaseline
  - packages/core/src/db.ts#CURRENT_SCHEMA_VERSION
  - packages/core/src/llm/index.ts#createLlmClient
  - packages/core/src/llm/base.ts#DEFAULT_LLM_TIMEOUT_MS
  - packages/cli/src/cli.ts#run
updated: 2026-08-16
modules:
  - cli-src
  - commands
  - mcp-src
  - core-src
  - llm
---

# Turning a Repository into Documented Knowledge: The CLI-to-LLM Pipeline

This page explains the end-to-end journey that starts when a user runs a `livewiki` command and culminates in curated, validated documentation in the wiki, with LLM calls made through a single uniform client interface.

## Purpose

<!-- lw:anchors packages/cli/src/cli.ts#createProgram packages/cli/src/cli.ts#readVersion packages/cli/src/cli.ts#resolveRepoRoot packages/mcp/src/server.ts#createServer packages/cli/src/cli.ts#run packages/mcp/src/server.ts#isWatchDenied packages/mcp/src/server.ts#schedule packages/mcp/src/server.ts#startWatcher packages/mcp/src/server.ts#stop packages/mcp/src/server.ts#syncBatch -->

A person's goal here is simple: they have a repository of source code and they want a living wiki that documents its modules, symbols, and cross-module flows, maintained as the code changes. The flow starts when the user invokes the `livewiki` CLI binary, and it produces either (a) a one-shot documentation update on disk, or (b) a long-running Model Context Protocol (MCP) server that serves documentation queries to an LLM client like Claude Code. No matter which path, the terminal destination is the LLM seam: a single `LlmClient` interface through which every external model call flows.

The CLI's front door is a Commander program assembled by `createProgram`. Because the package must work from any working directory, it computes its own version string via `readVersion` and resolves where the target repository lives via `resolveRepoRoot`. The async entry `run` parses the raw argument vector and dispatches to a registered subcommand. From there the flow branches: operational commands like `batch`, `baseline`, and `config` write documentation or configuration directly; the `serve` command instead hands control to the MCP server constructed by `createServer`.

The MCP server lives in the `@livewiki/mcp` package. It exposes the wiki to external agents over stdio and keeps its full-text search index fresh. `createServer` wires the tool surface; `startWatcher` watches the repository for changes; `isWatchDenied` filters out files that should not trigger a rebuild; `schedule` coalesces bursts of file events; `syncBatch` applies pending index updates; and `stop` tears the watcher down cleanly when the server exits.

## Ordered flow

<!-- lw:anchors packages/cli/src/commands/baseline.ts#registerBaseline packages/cli/src/commands/batch.ts#registerBatch packages/cli/src/commands/config.ts#registerConfig packages/cli/src/output.ts#emit packages/cli/src/output.ts#emitHuman packages/cli/src/output.ts#emitJson packages/mcp/src/stdio.ts#startMcpStdioServer packages/mcp/src/search.ts#close packages/mcp/src/search.ts#collectMarkdownFiles packages/core/src/agent-bootstrap.ts#nextAgentBootstrapTask packages/core/src/agent-bootstrap.ts#submitAgentBootstrapTask packages/core/src/baseline-operations.ts#acceptBaseline -->

1. The user runs `livewiki <subcommand>` from the terminal. `createProgram` builds a Commander `Command` object and registers every verb — `init`, `index`, `batch`, `baseline`, `config`, `serve`, `status`, `verify`, and others — each through a dedicated register function such as `registerBaseline`, `registerBatch`, or `registerConfig`.

2. `run(argv)` receives the raw argument vector. It resolves the repository root via `resolveRepoRoot`, which either uses the `--repo` flag or falls back to the current working directory, and then invokes whichever subcommand the user named.

3. For operational commands, the subcommand delegates to the corresponding module in `@livewiki/core`. For instance, the batch command walks the repository, indexes symbols into SQLite, partitions the code into modules, and — where the plan requires an LLM — calls `createLlmClient` to obtain a provider adapter.

4. Every output the CLI produces — whether a human-readable progress report, a JSON status object, or a file write — passes through the `emit` family. `emitHuman(text)` formats plain multiline text for terminal users, while `emitJson(data)` serializes a single JSON line with a trailing newline so downstream tooling can `JSON.parse` line-by-line. Both converge on `emit`, the single output gate.

5. When the user runs `livewiki serve` (or launches the standalone `livewiki-mcp` binary), both go through `startMcpStdioServer`. That entry constructs the MCP server and binds it to standard input/output. The server then serves tools such as `livewiki_quickstart`, `livewiki_read`, and `livewiki_search` to the connected agent.

6. The search tool reads from a dedicated SQLite database at `.livewiki/search.db`. On startup (or when the index is stale), the server calls `collectMarkdownFiles(dir)` to walk the wiki directory and gather every `.md` path that should be searchable, then populates the FTS5 tables.

7. Behind the search index sits a file watcher. `startWatcher` registers filesystem listeners; `isWatchDenied` rejects files that live outside `livewiki/` or `.livewiki/` or that otherwise should not trigger a reindex; `schedule` debounces rapid successive events into a single pending work item; and `syncBatch` drains that queue by reindexing the changed files.

8. For documentation tasks that involve external agents writing prose, the MCP server exposes a bootstrap queue. `nextAgentBootstrapTask(repoRoot)` returns the next deterministic task in the queue — ordering and metadata live in the server, not in the agent. The agent writes Markdown and calls back through `submitAgentBootstrapTask`, which validates the submission, records checkpoints, and commits the page transactionally.

9. When an agent (or the CLI's `baseline` command) declares a page complete and acceptable, `acceptBaseline` advances the baseline contract. A page that is accepted becomes the authoritative documented state for its symbols.

10. On graceful shutdown (the CLI exits or the MCP client disconnects), the server calls `stop`, which stops the watcher and closes the search index via `close`, then `collectMarkdownFiles`'s work product is persisted to disk for the next session.

## Diagram

```mermaid
%% livewiki/diagrams/flow-cli-src-to-llm.mmd
```

## Invariants

Each stage of the flow maintains a specific contract. At the CLI stage, the Commander program must register exactly the documented set of subcommands — no command may be silently dropped. `resolveRepoRoot` must always return an absolute path that points inside the user's intended repository; a missing `--repo` flag must not cause the tool to traverse into an unrelated directory.

At the output stage, every CLI command that writes results must route through the `emit` family. JSON output is always exactly one line with a trailing newline; human output is plain multiline text. No output may bypass this gate, because downstream tooling and tests rely on both shapes.

At the MCP stage, the server's tool surface must remain exactly the documented set — six tools in the core contract, later extended — and every tool must respond over stdio without the server dying. The search index and the file watcher must stay consistent: any file that `collectMarkdownFiles` would gather must be present in the index, and any change that passes `isWatchDenied` must eventually reach `syncBatch`.

At the bootstrap stage, the server owns all ordering and validation. The agent supplies only Markdown; it never decides task ordering or whether an artifact is acceptable. `acceptBaseline` is the only path by which a page becomes authoritative.

## Failure and recovery

<!-- lw:anchors packages/core/src/db.ts#CURRENT_SCHEMA_VERSION packages/core/src/llm/index.ts#createLlmClient packages/core/src/llm/base.ts#DEFAULT_LLM_TIMEOUT_MS -->

The flow has an explicit schema-version guard at its persistence layer. The SQLite index is versioned by the constant `CURRENT_SCHEMA_VERSION`, currently `9`. When the CLI or MCP server opens an existing database whose recorded schema version differs from `CURRENT_SCHEMA_VERSION`, the code runs a migration path (`migrateV8ToV9` and similar) rather than blindly reading a mismatched schema. If a migration is not available for the gap, the database is treated as foreign and the flow refuses to proceed rather than risk corrupting the index.

On the LLM side, `createLlmClient` is the fail-closed gate to external providers.

```ts
export function createLlmClient(repoRoot: string, config: LivewikiConfig): LlmClient {
```

This function takes the resolved repository root and the loaded `.livewiki/config.json`, and returns an `LlmClient` instance. It validates the provider configuration against the built-in preset table; if the provider is unknown or the credentials are missing, it throws rather than falling back to a silently different model. The visible evidence here is the validation gate — there is no automatic fallback to a default provider when configuration is invalid.

Every actual network call to the chosen provider runs through the shared wrapper in `base.ts`, which applies a fixed timeout via `DEFAULT_LLM_TIMEOUT_MS` (currently `300_000` milliseconds, i.e., five minutes). The wrapper performs the fetch, applies retry logic on transient failures, and enforces that timeout. A call that exceeds the timeout is aborted and reported as a failure to the caller; the batch orchestrator then decides whether the task is retryable within its bounded attempt count or must be marked degraded. The key point is that these are the normal, visible recovery paths in the source: schema migration for the database, and validated configuration plus timeout/retry handling for LLM calls. No mechanism beyond those is described in the examined source.

## Related pages

- [cli-src](../cli-src/index.md)
- [commands](../commands/index.md)
- [mcp-src](../mcp-src/index.md)
- [core-src](../core-src/index.md)
- [llm](../llm/index.md)
- [How it works](index.md)

<!-- livewiki:topics:start -->
## Concept topics

- [Testing](../topics/testing-f41eeea7.md)
<!-- livewiki:topics:end -->
