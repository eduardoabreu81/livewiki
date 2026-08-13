---
title: MCP server source entry to LLM client sink
owner: generated
anchors:
  - packages/mcp/src/server.ts#createServer
  - packages/mcp/src/server.ts#isWatchDenied
  - packages/mcp/src/server.ts#schedule
  - packages/mcp/src/server.ts#startWatcher
  - packages/mcp/src/server.ts#stop
  - packages/mcp/src/server.ts#syncBatch
  - packages/mcp/src/search.ts#close
  - packages/mcp/src/search.ts#collectMarkdownFiles
  - packages/mcp/src/search.ts#indexPage
  - packages/mcp/src/search.ts#openAndIndex
  - packages/mcp/src/search.ts#queryTerms
  - packages/mcp/src/search.ts#reindexAll
  - packages/core/src/batch.ts#resumeBatch
  - packages/core/src/batch.ts#runOnly
  - packages/core/src/blast-radius.ts#computeBlastRadius
  - packages/core/src/change-impact.ts#computeChangeImpact
  - packages/core/src/config.ts#loadConfig
  - packages/core/src/config.ts#resolveBaseUrl
  - packages/core/src/db.ts#CURRENT_SCHEMA_VERSION
  - packages/core/src/llm/base.ts#DEFAULT_LLM_TIMEOUT_MS
  - packages/core/src/llm/base.ts#isRetryableStatus
  - packages/core/src/llm/base.ts#LlmTimeoutError
  - packages/core/src/llm/base.ts#LlmTimeoutError.constructor
  - packages/core/src/llm/base.ts#parseRetryAfterMs
  - packages/core/src/llm/index.ts#createLlmClient
updated: 2026-08-12
modules:
  - mcp-src
  - core-src
  - llm
---

# MCP server source entry to LLM client sink

This page explains how an MCP tool call originating in the livewiki server reaches an external large-language-model provider through the configured client.

## Purpose
<!-- lw:anchors packages/mcp/src/server.ts#createServer packages/mcp/src/server.ts#isWatchDenied packages/mcp/src/server.ts#schedule packages/mcp/src/server.ts#startWatcher packages/mcp/src/server.ts#stop packages/mcp/src/server.ts#syncBatch -->

A coding agent (such as Claude Code) connected to livewiki over stdio wants to ask the livewiki MCP server to do work that ultimately needs an LLM — for example paying down documentation debt or fetching change-impact context — and the server needs to translate that request into a call to the configured provider (Anthropic or any OpenAI-compatible service). The flow starts when a `tools/call` arrives at the MCP server in `@livewiki/mcp` and ends when the server hands back a structured reply derived from an `LlmClient` produced by `@livewiki/core`. The same flow also covers the steady-state maintenance path: the server schedules background syncs and watchers that keep the on-disk index and SQLite search DB fresh while requests are in flight, so the LLM-side work always runs against current evidence.

The entry surface is the `createServer` factory in `packages/mcp/src/server.ts`, which assembles the tool registry, opens the SQLite-backed full-text search layer, and wires the file-system watcher that detects changes the agent will later ask about:

```ts
export async function createServer(opts: CreateServerOptions = {}): Promise<McpServer>
```

`createServer` takes optional startup options (such as the repo root and pre-opened handles) and returns a fully wired `McpServer` ready to attach to the stdio transport. From there, lifecycle is owned by sibling helpers: `startWatcher` attaches a filesystem watcher with its own debounced scheduler so background re-indexing does not race with active calls, `schedule` is the internal throttler that batches change events, `syncBatch` performs one full re-sync of the search index, `isWatchDenied` decides whether a given path is allowed to trigger re-indexing, and `stop` tears the server down cleanly on disconnect or shutdown.

## Ordered flow
<!-- lw:anchors packages/mcp/src/search.ts#close packages/core/src/batch.ts#resumeBatch packages/mcp/src/search.ts#collectMarkdownFiles packages/core/src/batch.ts#runOnly packages/mcp/src/search.ts#indexPage packages/core/src/blast-radius.ts#computeBlastRadius packages/mcp/src/search.ts#openAndIndex packages/core/src/change-impact.ts#computeChangeImpact packages/mcp/src/search.ts#queryTerms packages/core/src/config.ts#loadConfig packages/mcp/src/search.ts#reindexAll packages/core/src/config.ts#resolveBaseUrl -->

1. The MCP stdio entry (`packages/mcp/src/index.ts`) reads `--repo` from the CLI (defaulting to the current working directory), calls `createServer`, and connects the returned `McpServer` to a stdio transport. The process stays alive while the agent keeps the transport open.
2. Inside `createServer`, the tool surface is registered (six `livewiki_*` tools per the SPEC). The search layer is opened by `openAndIndex`, which returns a `SearchIndex` plus a `Database` handle. Background work — the file watcher and its scheduler — is attached so changes are observed without blocking request handling.
3. `openAndIndex` performs the deterministic cold-start: it walks the wiki, calls `collectMarkdownFiles` to enumerate `.md` files, and uses `indexPage` to feed each page into the SQLite FTS5 store:

```ts
export async function openAndIndex(
export function indexPage(idx: SearchIndex, wikiPath: string, content: string): void
async function collectMarkdownFiles(dir: string): Promise<string[]>
```

`collectMarkdownFiles` takes a directory path and returns the list of markdown file paths inside it; `indexPage` takes an already-open search index, a wiki-relative path, and the page content, and inserts the page into the index synchronously. `openAndIndex` orchestrates those two — it discovers the files and indexes each one.
4. A tool call arrives. If it is `livewiki_search`, the server calls `queryTerms` against the open FTS5 index:

```ts
function queryTerms(query: string): string[]
```

`queryTerms` takes a free-form search string and returns the list of normalized search terms the FTS5 query is built from. The server wraps that into a structured response without leaving the MCP package.
5. If the tool call needs LLM-backed reasoning (debt payment, change-impact summaries, or batch documentation), the request crosses into `@livewiki/core`. The server first resolves the repository configuration by calling `loadConfig`:

```ts
export async function loadConfig(repoRoot: string): Promise<LivewikiConfig>
```

`loadConfig` takes the repository root path and returns the parsed `LivewikiConfig` from `.livewiki/config.json`, with defaults applied and missing-provider conditions surfaced as `MissingProviderConfigError`. From there the base URL is derived with `resolveBaseUrl`:

```ts
export function resolveBaseUrl(config: LivewikiConfig): string
```

`resolveBaseUrl` takes a `LivewikiConfig` and returns the upstream HTTP base URL the LLM client will hit, including any provider-specific path.
6. The core package instantiates the right adapter through the LLM factory (`createLlmClient` in `packages/core/src/llm/index.ts`), which routes to either `anthropic.ts` or `openai-compat.ts` based on the preset/config. The batch orchestrator's two resumable entry points are `runOnly` and `resumeBatch`:

```ts
export async function runOnly(opts: BatchOptions): Promise<BatchRunResult>
export async function resumeBatch(opts: BatchOptions): Promise<BatchRunResult>
```

`runOnly` takes `BatchOptions` for a fresh run and returns the run result; `resumeBatch` takes the same options (typically pointing at an existing checkpoint) and returns the result of continuing from where the previous run left off. Both are documented at the same point because they share the same downstream path once a task is in flight.
7. For documentation tasks that need structural reasoning, `runOnly` / `resumeBatch` may compose blast-radius and change-impact evidence into the prompt. `computeBlastRadius` walks the `calls` table backward from a symbol to find its transitive callers and cross-references them with `anchors` and `doc_pages`:

```ts
export function computeBlastRadius(
export async function computeChangeImpact(
```

`computeBlastRadius` returns the set of wiki pages documenting code that depends on the changed symbol; `computeChangeImpact` returns the bounded change-impact package used to brief the LLM on what shifted since the last documented commit.
8. The wrapped HTTP call leaves the core package through the uniform `LlmClient` interface, hits the provider, and returns a `GenerateResult` that the batch orchestrator persists into the stage checkpoint. The MCP tool handler formats that result as the MCP reply and writes it back to the transport.
9. While all of this happens, `startWatcher` and its `schedule` helper keep re-indexing in the background. When the scheduler decides a full re-sync is needed, it calls `syncBatch`, which in turn calls `reindexAll`:

```ts
export async function reindexAll(db: Database.Database, absRoot: string): Promise<void>
```

`reindexAll` takes an open SQLite database handle and an absolute repo root, then re-indexes every markdown page in the wiki from scratch.
10. On disconnect or `SIGINT` / `SIGTERM`, `stop` runs and tears the server down; it also calls `close` on the search index:

```ts
export async function stop(): Promise<void>
export function close(idx: SearchIndex): void
```

`close` takes the open `SearchIndex` and releases its underlying resources. The MCP connection is then closed cleanly and the process exits.

## Diagram

```mermaid
%% livewiki/diagrams/flow-mcp-src-to-llm.mmd
```

## Invariants

- The MCP server never calls an LLM provider directly; every provider interaction goes through a `LlmClient` produced by `createLlmClient` in `packages/core/src/llm/index.ts`. This keeps a single retry/timeout surface and a single point of credential handling.
- The search layer is a separate SQLite database (`.livewiki/search.db`) rather than a virtual table inside `.livewiki/index.db`. The two databases share a schema-version convention (the index side is guarded by `CURRENT_SCHEMA_VERSION = 8` in `packages/core/src/db.ts`), so a fresh open re-creates only the search store if it is missing.
- A wiki page is the unit of search ingestion: `indexPage` is called once per page with `(wikiPath, content)` and never twice for the same path inside one `reindexAll` cycle. `collectMarkdownFiles` is the only path discovery source the search layer trusts.
- `startWatcher` always passes paths through `isWatchDenied` before scheduling work, so denylisted paths (build output, `.livewiki/`, `node_modules/`) cannot trigger spurious re-indexes. The `schedule` helper coalesces events from the watcher so only one `syncBatch` runs per debounce window.
- `loadConfig` is the single source of truth for provider selection. `resolveBaseUrl` is a pure function of `LivewikiConfig` — the same config always yields the same URL — and the LLM factory trusts the value verbatim.
- `runOnly` and `resumeBatch` share the same downstream contract: both return `BatchRunResult` and both must be able to resume from a partial checkpoint. Callers should not assume `runOnly` produces an empty starting state; both honor an existing checkpoint if one is referenced in `BatchOptions`.
- The MCP package owns the search index lifecycle: `openAndIndex` opens, `reindexAll` rebuilds, `close` releases. The LLM package never opens the search database itself.

## Failure and recovery
<!-- lw:anchors packages/core/src/db.ts#CURRENT_SCHEMA_VERSION packages/core/src/llm/index.ts#createLlmClient packages/core/src/llm/base.ts#DEFAULT_LLM_TIMEOUT_MS packages/core/src/llm/base.ts#isRetryableStatus packages/core/src/llm/base.ts#LlmTimeoutError packages/core/src/llm/base.ts#LlmTimeoutError.constructor packages/core/src/llm/base.ts#parseRetryAfterMs -->

The visible recovery surface lives entirely in the LLM adapter layer (`packages/core/src/llm/base.ts`) and in the factory that selects it (`packages/core/src/llm/index.ts`). There is no retry/rollback path visible in the MCP server source for tool calls themselves — when an `LlmClient` throws, the MCP tool handler propagates that error to the caller as an MCP error result.

The LLM adapter wraps every upstream HTTP call with a single `fetch`/retry/timeout helper. The timeout budget is centralized in one constant:

```ts
export const DEFAULT_LLM_TIMEOUT_MS = 300_000;
```

`DEFAULT_LLM_TIMEOUT_MS` is the default per-call timeout in milliseconds applied to provider requests. When the timeout fires, the helper raises a typed error instead of letting the request hang:

```ts
export class LlmTimeoutError extends Error
constructor(provider: LlmProvider, timeoutMs: number)
```

`LlmTimeoutError` is the dedicated error type for timeout failures; its constructor takes the provider identifier and the timeout that elapsed, so callers and logs can tell which provider timed out and after how long.

Retry decisions for transient HTTP failures are made by:

```ts
function isRetryableStatus(status: number): boolean
```

`isRetryableStatus` takes an HTTP status code and returns whether the adapter will retry the request. The companion helper honors `Retry-After` headers:

```ts
function parseRetryAfterMs(res: Response): number | null
```

`parseRetryAfterMs` takes an HTTP `Response` and returns the delay in milliseconds suggested by the `Retry-After` header, or `null` when no usable header is present. Together with `DEFAULT_LLM_TIMEOUT_MS`, these three primitives — status classification, header parsing, and a typed timeout — are the only recovery mechanisms the visible source shows for the LLM call.

On the factory side, `createLlmClient` validates the resolved `LivewikiConfig` (provider, base URL, credentials) before instantiating an adapter, and throws `MissingProviderConfigError` (from `packages/core/src/config.ts`) when required fields are absent; that is the fail-closed guarantee on configuration, not on the HTTP call itself.

On the persistence side, the only recovery-relevant invariant visible in the source is the schema-version gate. The search-side index is built on top of the main SQLite store whose compatibility floor is pinned by:

```ts
export const CURRENT_SCHEMA_VERSION = 8;
```

`CURRENT_SCHEMA_VERSION` is the schema version the indexer expects to find; an older or unrecognized value causes `openIndex` (and therefore `openAndIndex`) to refuse the database rather than silently migrate. This is the only fail-closed check visible in the source for "the on-disk store is unusable." The supplied source shows no other retry, rollback, or fallback path for the MCP → core → LLM chain.

## Related pages

- [How it works](index.md)
- [mcp-src module](../mcp-src/index.md)
- [core-src module](../core-src/index.md)
- [llm module](../llm/index.md)

<!-- livewiki:topics:start -->
## Concept topics

- [Testing](../topics/testing-f41eeea7.md)
<!-- livewiki:topics:end -->
