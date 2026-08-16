---
title: Serving livewiki documentation to an LLM agent over MCP
owner: generated
anchors:
  - packages/mcp/src/server.ts#createServer
  - packages/mcp/src/server.ts#isWatchDenied
  - packages/mcp/src/server.ts#schedule
  - packages/mcp/src/server.ts#startWatcher
  - packages/mcp/src/server.ts#stop
  - packages/mcp/src/server.ts#syncBatch
  - packages/mcp/src/search.ts#close
  - packages/core/src/agent-bootstrap.ts#nextAgentBootstrapTask
  - packages/mcp/src/search.ts#collectMarkdownFiles
  - packages/core/src/agent-bootstrap.ts#submitAgentBootstrapTask
  - packages/mcp/src/search.ts#indexPage
  - packages/core/src/baseline-operations.ts#acceptBaseline
  - packages/mcp/src/search.ts#openAndIndex
  - packages/core/src/baseline-operations.ts#bootstrapBaseline
  - packages/mcp/src/search.ts#queryTerms
  - packages/core/src/baseline-operations.ts#migrateBaselineKey
  - packages/mcp/src/search.ts#reindexAll
  - packages/core/src/baseline-operations.ts#relocateBaselineEntry
  - packages/core/src/db.ts#CURRENT_SCHEMA_VERSION
  - packages/core/src/llm/index.ts#createLlmClient
  - packages/core/src/llm/base.ts#DEFAULT_LLM_TIMEOUT_MS
  - packages/core/src/llm/base.ts#isRetryableStatus
  - packages/core/src/llm/base.ts#LlmTimeoutError
  - packages/core/src/llm/base.ts#LlmTimeoutError.constructor
  - packages/core/src/llm/base.ts#parseRetryAfterMs
updated: 2026-08-16
modules:
  - mcp-src
  - core-src
  - llm
---

# Serving livewiki documentation to an LLM agent over MCP

This page explains the end-to-end flow by which livewiki exposes its wiki as an MCP server that an LLM agent reads through search, writes through the bootstrap queue, and validates against the core package's baseline and LLM-provider plumbing.

## Purpose

<!-- lw:anchors packages/mcp/src/server.ts#createServer packages/mcp/src/server.ts#isWatchDenied packages/mcp/src/server.ts#schedule packages/mcp/src/server.ts#startWatcher packages/mcp/src/server.ts#stop packages/mcp/src/server.ts#syncBatch -->

A person using livewiki wants an LLM-backed coding agent to answer questions about the repository's documentation and to submit documentation updates without leaving the agent's own tool loop. The MCP server is the doorway that makes this possible: it registers livewiki's six tools, keeps the search index fresh as files change, and routes every agent action through livewiki's contract checks. The agent does not touch the search database or the baseline directly; it only calls the tools the server exposes.

The entry point that assembles this doorway is `createServer`.

```ts
export async function createServer(opts: CreateServerOptions = {}): Promise<McpServer>
```

It takes optional server options and returns a promise of the assembled `McpServer`, the object that exposes livewiki's tool surface to the connected client.

The watch pipeline keeps that server's answers current with the repository. `startWatcher` opens that pipeline.

```ts
function startWatcher(repoRoot: string, searchIdx: SearchIndex): WatcherHandle
```

It takes the repository root to watch and the FTS5-backed search index to refresh, and returns a `WatcherHandle` that wraps the watcher's lifecycle. Not every change should reach the index, so `isWatchDenied` is the filter in front of that pipeline.

```ts
function isWatchDenied(filename: string): boolean
```

It takes a filename and returns true when that file is ineligible for watch-driven synchronization. Changes that pass the filter are not processed inline; `schedule` books the deferred work.

```ts
function schedule(): void
```

It takes no arguments and returns nothing, queuing the follow-up synchronization work without performing it immediately. That queued work lands in `syncBatch`, which flushes accumulated changes into the index as one bounded batch.

```ts
async function syncBatch(): Promise<void>
```

It takes no arguments and returns a promise that resolves when the batch has been applied. When the server no longer needs to track changes, `stop` tears the watcher down.

```ts
async function stop(): Promise<void>
```

It takes no arguments and returns a promise that resolves once the watcher has been stopped and released.

## Ordered flow

<!-- lw:anchors packages/mcp/src/search.ts#openAndIndex packages/mcp/src/search.ts#collectMarkdownFiles packages/mcp/src/search.ts#indexPage packages/mcp/src/search.ts#queryTerms packages/mcp/src/search.ts#close packages/mcp/src/search.ts#reindexAll packages/core/src/agent-bootstrap.ts#nextAgentBootstrapTask packages/core/src/agent-bootstrap.ts#submitAgentBootstrapTask packages/core/src/baseline-operations.ts#bootstrapBaseline packages/core/src/baseline-operations.ts#migrateBaselineKey packages/core/src/baseline-operations.ts#relocateBaselineEntry packages/core/src/baseline-operations.ts#acceptBaseline -->

1. The server process starts and builds its search surface by reading every Markdown page from the workspace. This step is owned by `openAndIndex`, which opens the SQLite-backed index and populates it with the repository's Markdown so the server's tools have content to answer from.

```ts
export async function openAndIndex(
```

It opens the search index and fills it from the on-disk Markdown pages. The first mechanical part of that population is `collectMarkdownFiles`, which walks the wiki directory and enumerates the pages that will become search results.

```ts
async function collectMarkdownFiles(dir: string): Promise<string[]>
```

It takes a directory path and returns a promise of the list of Markdown file paths found beneath it. Each collected page is converted into a search entry by `indexPage`.

```ts
export function indexPage(idx: SearchIndex, wikiPath: string, content: string): void
```

It takes the target search index, the wiki-relative path of the page, and its textual content, and writes an index entry for that page; changes are the effect, not a returned value. Once the store exists, `queryTerms` translates the agent's query into the smaller units the search engine can match.

```ts
function queryTerms(query: string): string[]
```

It takes the raw query string and returns the token list used for searching. When the index needs a complete refresh, `reindexAll` repopulates the search database from the workspace in one pass.

```ts
async function reindexAll(db: Database.Database, absRoot: string): Promise<void>
```

It takes the open database handle and the absolute repository root, and returns a promise that resolves when every Markdown file has been re-read and re-indexed. The search index handle eventually is released by `close`.

```ts
export function close(idx: SearchIndex): void
```

It takes the search index and returns nothing, finishing the process's ownership of that handle.

While the search surface is what the agent reads, the agent also participates as a writer through the deterministic bootstrap queue. `nextAgentBootstrapTask` fetches the next unit of documentation work the agent is allowed to attempt.

```ts
export async function nextAgentBootstrapTask(repoRoot: string): Promise<AgentQueueResult>
```

It takes the repository root and returns a promise of an `AgentQueueResult`, the metadata describing the next queued bootstrap item. The model acts on that metadata and hands its draft back through `submitAgentBootstrapTask`, the validation boundary before any write.

```ts
export async function submitAgentBootstrapTask(
```

It receives the agent's proposed artifact and decides whether it satisfies livewiki's contracts before a page is written. Behind that validation sits the baseline machinery. `bootstrapBaseline` establishes the initial durable snapshot a fresh clone loads before any documentation is accepted.

```ts
export async function bootstrapBaseline(
```

It creates the repository-portable baseline state that later acceptance checks compare against. When a documented symbol's key changes, `migrateBaselineKey` updates the baseline so the recorded key stays consistent with the new identity.

```ts
export async function migrateBaselineKey(
```

It adjusts a stored baseline key when a symbol's identity shifts. A related operation, `relocateBaselineEntry`, maps a baseline record to a new location when the documented file itself moves.

```ts
export async function relocateBaselineEntry(
```

It moves a baseline entry from one path to another so the history of what was documented survives a file rename. After the supplied content has been checked, `acceptBaseline` promotes the validated state as the repository's new authoritative snapshot.

```ts
export async function acceptBaseline(
```

It commits the reviewed baseline forward so later runs compare against the just-accepted documentation.

## Diagram

```mermaid
%% livewiki/diagrams/flow-mcp-src-to-llm.mmd
```

## Invariants

- The server exposes a fixed set of six tools; the agent interacts with the wiki only through those handlers, never by editing the search database directly.
- The search index is a separate SQLite FTS5 store derived from the Markdown pages; it can be rebuilt by re-reading the workspace.
- Watcher-driven updates are filtered before they are queued; files denied by the watch policy never enter the index through the watch path.
- The baseline is a durable, versioned snapshot: each submitted bootstrap artifact is validated against it before being written, and acceptance advances the snapshot only after validation succeeds.
- The bootstrap queue is ordered and bounded by livewiki rather than by the model; the agent supplies prose, while livewiki owns ordering, validation, transactional writes, and finalization.

## Failure and recovery

<!-- lw:anchors packages/core/src/db.ts#CURRENT_SCHEMA_VERSION packages/core/src/llm/index.ts#createLlmClient packages/core/src/llm/base.ts#DEFAULT_LLM_TIMEOUT_MS packages/core/src/llm/base.ts#isRetryableStatus packages/core/src/llm/base.ts#LlmTimeoutError packages/core/src/llm/base.ts#LlmTimeoutError.constructor packages/core/src/llm/base.ts#parseRetryAfterMs -->

The search and bootstrap paths stay clear of the LLM-provider network, so the failure mode worth documenting here belongs to the core package's outbound calls: what happens when livewiki itself has to ask a model provider and that provider is slow or refuses. The schema marker `CURRENT_SCHEMA_VERSION` anchors the shape of the on-disk state those operations manage.

```ts
export const CURRENT_SCHEMA_VERSION = 9;
```

It is the current database schema version (nine), used so a tool opening a newer store detects the drift instead of silently misreading it. On the provider side, `createLlmClient` is the factory that picks which adapter to use and leans on the retry behavior shared by all adapters.

```ts
export function createLlmClient(repoRoot: string, config: LivewikiConfig): LlmClient
```

It takes the repository root and the loaded configuration, and returns a configured `LlmClient` bound to whichever provider the configuration names. Its shared wrapper treats an unresponsive provider as a timeout: `DEFAULT_LLM_TIMEOUT_MS` is the ceiling the wrapper waits before giving up on one attempt.

```ts
export const DEFAULT_LLM_TIMEOUT_MS = 300_000;
```

It defines the default timeout as three hundred thousand milliseconds, five minutes, after which a call is considered to have hung. When that ceiling is crossed, the constructor of `LlmTimeoutError` captures both who was slow and for how long.

```ts
constructor(provider: LlmProvider, timeoutMs: number) {
```

It records the provider and the timeout duration in milliseconds that triggered the failure, so the error message can explain the stall. The error type itself is `LlmTimeoutError`, a distinct failure category so callers can treat hangs differently from provider rejections.

```ts
export class LlmTimeoutError extends Error {
```

It is an `Error` subclass specifically for model-provider timeouts. Rejections that are not hangs pass through the retry logic, and `isRetryableStatus` is the gate that decides whether a given HTTP status should trigger another attempt.

```ts
function isRetryableStatus(status: number): boolean {
```

It takes an HTTP status code and returns true only for statuses the wrapper considers worth retrying. For the ones it does retry, `parseRetryAfterMs` reads the response's suggested backoff so the next attempt does not immediately hammer the provider.

```ts
function parseRetryAfterMs(res: Response): number | null {
```

It takes the response object and returns the retry delay in milliseconds when the provider supplied one, or null when it did not. The supplied excerpt shows the retry/timeout wrapper's normal shape and its `LlmTimeoutError` failure category, but it does not show these symbols' bodies, so no claim is made here about exact retention or rollback behavior beyond what these signatures and declarations establish.

## Related pages

- [mcp-src](../mcp-src/index.md)
- [core-src](../core-src/index.md)
- [llm](../llm/index.md)
- [How it works](index.md)

<!-- livewiki:topics:start -->
## Concept topics

- [Testing](../topics/testing-f41eeea7.md)
<!-- livewiki:topics:end -->
