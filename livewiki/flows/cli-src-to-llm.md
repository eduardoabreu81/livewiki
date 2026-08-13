---
title: From CLI command to LLM provider — the request path livewiki walks
owner: generated
anchors:
  - packages/cli/src/cli.ts#createProgram
  - packages/cli/src/cli.ts#readVersion
  - packages/cli/src/cli.ts#resolveRepoRoot
  - packages/cli/src/cli.ts#run
  - packages/cli/src/commands/batch.ts#registerBatch
  - packages/cli/src/commands/export.ts#registerExport
  - packages/cli/src/commands/index-cmd.ts#registerIndex
  - packages/cli/src/output.ts#emit
  - packages/cli/src/output.ts#emitHuman
  - packages/cli/src/output.ts#emitJson
  - packages/core/src/batch-status.ts#buildStatusReport
  - packages/core/src/batch-status.ts#listRuns
  - packages/core/src/batch.ts#resumeBatch
  - packages/core/src/db.ts#CURRENT_SCHEMA_VERSION
  - packages/core/src/llm/base.ts#DEFAULT_LLM_TIMEOUT_MS
  - packages/core/src/llm/index.ts#createLlmClient
  - packages/mcp/src/search.ts#close
  - packages/mcp/src/search.ts#collectMarkdownFiles
  - packages/mcp/src/server.ts#createServer
  - packages/mcp/src/server.ts#isWatchDenied
  - packages/mcp/src/server.ts#schedule
  - packages/mcp/src/server.ts#startWatcher
  - packages/mcp/src/server.ts#stop
  - packages/mcp/src/server.ts#syncBatch
  - packages/mcp/src/stdio.ts#startMcpStdioServer
updated: 2026-08-12
modules:
  - cli-src
  - commands
  - mcp-src
  - core-src
  - llm
---

# From CLI command to LLM provider — the request path livewiki walks

A user types `livewiki …` (or an MCP-aware agent speaks to `livewiki serve`) and the request ends up exercising livewiki's LLM provider adapter; this page explains that end-to-end path, from argv parsing through the shared timeout wrapper around every provider call.

## Purpose
<!-- lw:anchors packages/cli/src/cli.ts#createProgram packages/cli/src/cli.ts#readVersion packages/cli/src/cli.ts#resolveRepoRoot packages/cli/src/cli.ts#run packages/mcp/src/server.ts#createServer packages/mcp/src/server.ts#isWatchDenied packages/mcp/src/server.ts#schedule packages/mcp/src/server.ts#startWatcher packages/mcp/src/server.ts#stop packages/mcp/src/server.ts#syncBatch -->

Livewiki is a wiki generator for a target repository. A developer wants to point it at a codebase and have it index the sources, generate documentation pages, and (when asked) call a large-language-model provider to write the prose. There are two ways to drive that pipeline: the `livewiki` command-line program (registered through Commander, with verbs like `index`, `batch`, `status`, `export`, `serve`) and the Model Context Protocol server the same codebase ships for agents such as Claude Code. Both entry points must converge on the same engine in `@livewiki/core`, and that engine must, in turn, reach the LLM through the uniform seam in `packages/core/src/llm/`.

The CLI scaffold begins in `packages/cli/src/cli.ts`, where `createProgram` assembles the root Commander program and wires each subcommand from `packages/cli/src/commands/`. The signature is:

```ts
export function createProgram(): Command {
```

That is, it takes no arguments and returns a configured `Command` ready to accept argv. The version string the program prints comes from `readVersion`, defined alongside it:

```ts
function readVersion(): string {
```

So `readVersion` takes nothing and returns the version text that `--version` and the help banner show. Once a verb has been selected, `run` is what actually dispatches it; it owns the top-level process lifecycle:

```ts
export async function run(argv: readonly string[]): Promise<void> {
```

`run` is the async entry point: it takes the argv list and resolves to `void` once the chosen subcommand completes (or fails). Before any verb touches the filesystem, every command asks `resolveRepoRoot` to canonicalize the repo it should operate on (the explicit `--repo` option, or the current working directory as a default):

```ts
export function resolveRepoRoot(repoOpt: string | undefined): string {
```

`resolveRepoRoot` takes the user-supplied `--repo` value (or `undefined`) and returns the absolute path that the rest of the pipeline will treat as the repository root.

The other entry surface is `@livewiki/mcp`. `packages/mcp/src/server.ts` exposes `createServer`, which assembles the MCP server object that tools like `livewiki_search`, `livewiki_read`, and `livewiki_write_doc` are attached to:

```ts
export async function createServer(opts: CreateServerOptions = {}): Promise<McpServer> {
```

So `createServer` takes an optional options bag and returns a promise that resolves to a fully wired MCP server. Once running, the server needs to notice when the repository changes so its search index and debt views stay current. That is the job of `startWatcher` (which actually attaches the filesystem watcher) and `schedule` (which debounces and re-runs the sync after a quiet period):

```ts
function startWatcher(repoRoot: string, searchIdx: SearchIndex): WatcherHandle {
```

```ts
function schedule(): void {
```

`startWatcher` takes the repo root and the search index and returns a handle that can later be torn down; `schedule` takes nothing and returns `void` — it just notes that a sync is pending and resets the debounce timer. The deny-list for filenames the watcher must ignore (build artifacts, editor scratch files, generated caches) lives in `isWatchDenied`, which decides whether a single changed filename should trigger a re-sync:

```ts
function isWatchDenied(filename: string): boolean {
```

`isWatchDenied` takes a filename and returns `true` when that change should be ignored. The actual re-indexing pass is `syncBatch`, which the schedule timer eventually invokes:

```ts
async function syncBatch(): Promise<void> {
```

`syncBatch` takes nothing and returns a promise that resolves once the incremental re-index is finished. When the MCP server is shutting down (agent disconnects, `livewiki serve` receives SIGINT, etc.), `stop` is the orderly teardown that detaches the watcher and closes the search index:

```ts
async function stop(): Promise<void> {
```

`stop` takes nothing and returns a promise that resolves once cleanup has completed.

## Ordered flow
<!-- lw:anchors packages/cli/src/output.ts#emitHuman packages/cli/src/commands/batch.ts#registerBatch packages/mcp/src/stdio.ts#startMcpStdioServer packages/core/src/batch-status.ts#buildStatusReport packages/cli/src/output.ts#emitJson packages/cli/src/commands/export.ts#registerExport packages/mcp/src/search.ts#close packages/core/src/batch-status.ts#listRuns packages/cli/src/output.ts#emit packages/cli/src/commands/index-cmd.ts#registerIndex packages/mcp/src/search.ts#collectMarkdownFiles packages/core/src/batch.ts#resumeBatch -->

1. The user invokes `livewiki <verb> --repo <path> [--json] …`. The Node entry script in `packages/cli/src/index.ts` hands the argv to `run` (in `packages/cli/src/cli.ts`), which calls `createProgram` to obtain the configured Commander `Command`. `createProgram` calls `readVersion` to stamp the help banner, then registers every subcommand by invoking the matching `register*` function from `packages/cli/src/commands/`.
2. `registerIndex` (in `packages/cli/src/commands/index-cmd.ts`) attaches the `livewiki index` verb. It uses `resolveRepoRoot` to canonicalize the repo, then delegates to `@livewiki/core/indexer`'s `run`, which walks the repo, parses files, and writes the SQLite index. Its human formatter ends up reaching `emitHuman` in `packages/cli/src/output.ts` to print a readable summary:

   ```ts
   export function emitHuman(text: string): void {
   ```

   `emitHuman` takes a multi-line text block and writes it to stdout.
3. `registerBatch` (in `packages/cli/src/commands/batch.ts`) attaches the `livewiki batch` verb — the resumable pipeline that walks the repo, builds module pages, and, when configured, calls the LLM to author prose. It also exposes `livewiki batch status`, which delegates to `buildStatusReport` in `packages/core/src/batch-status.ts` to aggregate checkpoint JSON into a report:

   ```ts
   export async function buildStatusReport(
   ```

   `buildStatusReport` takes the inputs needed to read a run's checkpoints and returns an aggregated status payload that the CLI can render. When the user asks for `livewiki batch list`, the same module's `listRuns` enumerates every run recorded in the database:

   ```ts
   export async function listRuns(repoRoot: string): Promise<Array<{
   ```

   `listRuns` takes the repo root and returns the array of known runs. The batch verb can also `resume` an interrupted run; that path goes through `resumeBatch` in `packages/core/src/batch.ts`:

   ```ts
   export async function resumeBatch(opts: BatchOptions): Promise<BatchRunResult> {
   ```

   `resumeBatch` takes the resume options (run id, repo root, etc.) and returns the final `BatchRunResult` once the pipeline has caught up to the last checkpoint.
4. `registerExport` (in `packages/cli/src/commands/export.ts`) attaches the `livewiki export` verb, which turns the curated `livewiki/` wiki into deliverable artifacts under `.livewiki/export/<target>/`. The verb shares the same output channel as the rest of the CLI: every command funnels its result through `emit` in `packages/cli/src/output.ts`, which routes to either `emitHuman` or `emitJson` based on the `--json` flag:

   ```ts
   export function emit(
   ```

   ```ts
   export function emitJson(data: unknown): void {
   ```

   `emit` takes the structured command result plus a flag set and chooses the writer; `emitJson` takes any JSON-serializable value and writes it as a single newline-terminated line (so downstream tools can parse it line-by-line). When the export command has nothing to do because the wiki is empty, the human branch returns gracefully through `emitHuman` rather than emitting a stack trace.
5. When the user types `livewiki serve` (or invokes the `livewiki-mcp` bin), the `serve` command in `packages/cli/src/commands/serve.ts` forwards to `startMcpStdioServer` in `packages/mcp/src/stdio.ts`:

   ```ts
   export async function startMcpStdioServer(opts: {
   ```

   `startMcpStdioServer` takes the stdio-server options (repo root, transport, signal handling) and returns once the server has stopped. Inside, it calls `createServer` from `packages/mcp/src/server.ts` and then attaches the SDK's `StdioServerTransport`. The freshly created server holds a `SearchIndex` over `.livewiki/search.db`; that index is fed by `collectMarkdownFiles` in `packages/mcp/src/search.ts`:

   ```ts
   async function collectMarkdownFiles(dir: string): Promise<string[]> {
   ```

   `collectMarkdownFiles` takes a directory and returns the markdown file paths inside it that should be indexed. When the MCP server shuts down — typically when the connected agent process exits — the index handle is released by `close` in the same module:

   ```ts
   export function close(idx: SearchIndex): void {
   ```

   `close` takes a search index and tears it down.
6. Whether the request arrived through `livewiki batch` (CLI) or `livewiki_write_doc` (MCP), the engine in `@livewiki/core` ends up at the LLM seam: every provider call goes through `createLlmClient` in `packages/core/src/llm/index.ts`. That factory validates the configured provider, reads API credentials from the environment only, and returns a concrete `LlmClient` (Anthropic, an OpenAI-compatible HTTP endpoint, etc.). The shared fetch/retry/timeout wrapper that every adapter inherits from lives in `packages/core/src/llm/base.ts`, parameterized by `DEFAULT_LLM_TIMEOUT_MS`.
7. Output from any verb — JSON or human — is shaped by `output.ts` so callers see consistent formatting whether they piped the result into `jq` or read it in a terminal.

## Diagram

```mermaid
%% livewiki/diagrams/flow-cli-src-to-llm.mmd
```

## Invariants

- Every verb the CLI exposes is registered through a `register*` function in `packages/cli/src/commands/`; removing one without updating the smoke test in `packages/cli/src/cli.test.ts` fails CI. The CLI therefore has a single, exhaustive wiring table between user input and engine call.
- Every command funnels its structured result through `emit` (in `packages/cli/src/output.ts`) so `--json` and human output never diverge on the data they describe — only on the rendering.
- `resolveRepoRoot` is the boundary at which relative paths become absolute; downstream code in `@livewiki/core` is allowed to assume an absolute repo root.
- The MCP server and the CLI share exactly one engine entry: the `livewiki serve` command is a thin wrapper around `startMcpStdioServer`, which is the same entry the `livewiki-mcp` bin uses. Any new MCP tool therefore reaches the same core code path as the equivalent CLI verb.
- The search index that backs `livewiki_search` lives in its own SQLite file (`.livewiki/search.db`), separate from the code index. The watcher must release that index through `close` on shutdown; leaked handles will keep the database locked.
- Every LLM adapter constructed by `createLlmClient` inherits the same fetch/retry/timeout wrapper, so request behavior — including the per-request upper bound — is uniform across providers.
- The CLI never embeds provider API keys; it reads them from the environment at the moment `createLlmClient` resolves a provider. The `key-leak` test in `packages/core/src/key-leak.test.ts` is the regression net that enforces this.

## Failure and recovery
<!-- lw:anchors packages/core/src/db.ts#CURRENT_SCHEMA_VERSION packages/core/src/llm/index.ts#createLlmClient packages/core/src/llm/base.ts#DEFAULT_LLM_TIMEOUT_MS -->

The flow has three deliberate recovery points, all visible in the cited source.

When the engine opens the SQLite index, it stamps the schema with `CURRENT_SCHEMA_VERSION` declared in `packages/core/src/db.ts`:

```ts
export const CURRENT_SCHEMA_VERSION = 8;
```

That constant is the only place the schema number lives; if a checkpoint file or pre-existing `.livewiki/index.db` was written by an older livewiki, the open path fails closed rather than silently re-running migrations against an unexpected shape. The supplied excerpt does not show the specific branch that handles a version mismatch, so beyond the constant's existence and its role as the schema source-of-truth, the exact recovery branch is not documented here.

The LLM seam handles provider failures in one place: every adapter is wrapped by the shared helper in `packages/core/src/llm/base.ts`, which is parameterized by `DEFAULT_LLM_TIMEOUT_MS`:

```ts
export const DEFAULT_LLM_TIMEOUT_MS = 300_000;
```

That constant is the upper bound (5 minutes) applied to every provider request; it is the per-call ceiling, not a window for retry aggregation. The wrapper applies retry on top of the same timeout — see `packages/core/src/llm/base.ts` for the exact retry policy. Because the wrapper is shared, any provider-specific failure mode (network error, HTTP 429, HTTP 5xx) is funnelled through the same retry logic before the call surfaces to the caller.

The provider itself is selected by `createLlmClient` in `packages/core/src/llm/index.ts`:

```ts
export function createLlmClient(repoRoot: string, config: LivewikiConfig): LlmClient {
```

`createLlmClient` takes the repo root and the parsed `LivewikiConfig` and returns the configured `LlmClient` (or throws if the configured provider is unknown or the required credentials are missing). The factory does not swallow errors: a missing API key, an unknown preset, or a malformed base URL surfaces to the calling verb, which `emit`s a structured failure through the CLI output layer. The supplied excerpt does not show the specific throw branches inside `createLlmClient`, so the prose above is limited to the visible surface: factory takes config, returns a client or fails the call.

The batch pipeline is itself resumable: when an `livewiki batch` run is interrupted, the same checkpoint table that `buildStatusReport` reads lets the next invocation start from the last completed task rather than redoing paid LLM work. The CLI exposes that resume as a separate verb option that funnels into `resumeBatch`.

Beyond these three points, the supplied source does not show additional recovery branches specific to this flow, so the prose above is scoped to the visible evidence.

## Related pages
[cli-src](../cli-src/index.md)
[commands](../commands/index.md)
[mcp-src](../mcp-src/index.md)
[core-src](../core-src/index.md)
[llm](../llm/index.md)
[How it works](index.md)

<!-- livewiki:topics:start -->
## Concept topics

- [Testing](../topics/testing-f41eeea7.md)
<!-- livewiki:topics:end -->
