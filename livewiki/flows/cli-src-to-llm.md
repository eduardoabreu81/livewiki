---
title: From the livewiki CLI to the LLM pipeline
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
  - packages/cli/src/cli.ts#run
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
  - packages/core/src/llm/probe.ts#formatProbeFailure
updated: 2026-08-16
modules:
  - cli-src
  - commands
  - mcp-src
  - core-src
  - llm
---

# From the livewiki CLI to the LLM pipeline

This flow explains how a repository owner goes from running the `livewiki` command or its MCP server, through command registration, output selection, and server life-cycle management, to the point where generated documentation reaches an external large-language model provider.

## Purpose
<!-- lw:anchors packages/cli/src/cli.ts#createProgram packages/cli/src/cli.ts#readVersion packages/cli/src/cli.ts#resolveRepoRoot packages/mcp/src/server.ts#createServer packages/cli/src/cli.ts#run packages/mcp/src/server.ts#isWatchDenied packages/mcp/src/server.ts#schedule packages/mcp/src/server.ts#startWatcher packages/mcp/src/server.ts#stop packages/mcp/src/server.ts#syncBatch -->

A person working on a repository wants livewiki to document their code and expose that documentation to coding agents. The flow starts when that person runs the `livewiki` command-line binary or an MCP client connects to livewiki's server, and it ends once the CLI has registered its commands, selected a repository root, rendered output in the user's preferred format, and either launched or shut down the MCP server. Along the way, the command layer determines which repository directory the run targets, the MCP layer decides which file changes trigger watch activity, and the server coordinates incremental sync work.

The entry point is the Commander program built by `createProgram`:

```ts
export function createProgram(): Command {
```

It takes no arguments and returns a Commander `Command` object onto which all subcommand adapters are registered. The CLI then reads its own package version via `readVersion`:

```ts
function readVersion(): string {
```

It takes no arguments and returns the package version string used in help and version output. Before any command delegates to core work, `resolveRepoRoot` settles which directory is the repository root:

```ts
export function resolveRepoRoot(repoOpt: string | undefined): string {
```

It takes an optional `--repo` override and returns the resolved repository root string. Finally, `run` drives the whole command invocation:

```ts
export async function run(argv: readonly string[]): Promise<void> {
```

It takes the parsed argument vector and resolves to nothing once the CLI has executed and exited.

On the server side, `createServer` assembles the MCP tool surface:

```ts
export async function createServer(opts: CreateServerOptions = {}): Promise<McpServer> {
```

It takes optional server-creation options and resolves to a fully wired MCP server instance whose tools are available to LLM clients. The server also decides which file changes are ignored by `isWatchDenied`:

```ts
function isWatchDenied(filename: string): boolean {
```

It takes a candidate filename and returns true when that name must not trigger watch-driven work. Watch scheduling is delegated to `schedule`:

```ts
function schedule(): void {
```

It takes no arguments and returns nothing; it registers the periodic or deferred batch work that `syncBatch` later performs:

```ts
async function syncBatch(): Promise<void> {
```

It takes no arguments and resolves once the accumulated file changes have been synchronized into the search and documentation pipeline. The watcher itself is created by `startWatcher`:

```ts
function startWatcher(repoRoot: string, searchIdx: SearchIndex): WatcherHandle {
```

It takes a repository root and a search index, and returns a handle that owns the watch subscriptions for that repository. When the server must shut down, `stop` tears the process down cooperatively:

```ts
async function stop(): Promise<void> {
```

It takes no arguments and resolves after the server's listeners, watcher, and scheduled work have been released.

## Ordered flow
<!-- lw:anchors packages/cli/src/output.ts#emitHuman packages/cli/src/commands/baseline.ts#registerBaseline packages/mcp/src/stdio.ts#startMcpStdioServer packages/core/src/agent-bootstrap.ts#nextAgentBootstrapTask packages/cli/src/output.ts#emitJson packages/cli/src/commands/batch.ts#registerBatch packages/mcp/src/search.ts#close packages/core/src/agent-bootstrap.ts#submitAgentBootstrapTask packages/cli/src/output.ts#emit packages/cli/src/commands/config.ts#registerConfig packages/mcp/src/search.ts#collectMarkdownFiles packages/core/src/baseline-operations.ts#acceptBaseline -->

1. The CLI runs `createProgram`, and command adapters such as `registerConfig`, `registerBatch`, and `registerBaseline` attach their subcommands to the root Commander program. `registerConfig` is the config verb adapter:

   ```ts
   export function registerConfig(program: Command): void {
   ```

   It takes the root Commander program and returns nothing; it wires the `config` word into the program and delegates real behavior to core configuration helpers. `registerBatch` does the analogous job for the batch pipeline:

   ```ts
   export function registerBatch(program: Command): void {
   ```

   It takes the root program, returns nothing, and connects the batch subcommand to the core batch runner. `registerBaseline` registers the baseline verb:

   ```ts
   export function registerBaseline(program: Command): void {
   ```

   It takes the root program and returns nothing; it exposes baseline lifecycle operations, including `acceptBaseline`, to the command line.

2. `resolveRepoRoot` and `run` select the repository to document and begin executing the chosen command.

3. All command output funnels through the output layer. `emit` is the dispatcher:

   ```ts
   export function emit(
   ```

   It chooses between the human and JSON renderers based on the command's options. The human renderer writes plain text to standard output:

   ```ts
   export function emitHuman(text: string): void {
   ```

   It takes a preformatted string and writes it directly to stdout. The machine-readable renderer writes one line of JSON:

   ```ts
   export function emitJson(data: unknown): void {
   ```

   It takes an arbitrary value and serializes it as a single line of JSON so line-oriented parsers can consume it safely.

4. `registerBatch` and its core batch runner invoke document generation, and the generated output is routed back through `emit`.

5. On the agent-facing side, `startMcpStdioServer` exposes the MCP server over standard input and output:

   ```ts
   export async function startMcpStdioServer(opts: {
   ```

   It takes the stdio serving options and resolves once the MCP server is attached to the stdio transport. The CLI `serve` command and the standalone `livewiki-mcp` binary both go through this shared seam.

6. The bootstrap queue is driven by `nextAgentBootstrapTask`:

   ```ts
   export async function nextAgentBootstrapTask(repoRoot: string): Promise<AgentQueueResult> {
   ```

   It takes a repository root and resolves to the next deterministic agent-bootstrap task waiting in the queue. When the agent returns a completed task, `submitAgentBootstrapTask` receives it:

   ```ts
   export async function submitAgentBootstrapTask(
   ```

   It accepts the agent's submission and persists it transactionally before advancing the queue.

7. The search layer walks Markdown documentation through `collectMarkdownFiles`:

   ```ts
   async function collectMarkdownFiles(dir: string): Promise<string[]> {
   ```

   It takes a directory and resolves to the list of Markdown file paths it discovered. When search resources are no longer needed, `close` releases the index:

   ```ts
   export function close(idx: SearchIndex): void {
   ```

   It takes the search index and returns nothing; it closes the index so subsequent reads fail instead of operating on a stale handle.

8. Baseline acceptance completes the flow's output side when the user approves a generated baseline:

   ```ts
   export async function acceptBaseline(
   ```

   It promotes a validated baseline entry into the repository-portable baseline used for subsequent documentation verification.

## Diagram

```mermaid
%% livewiki/diagrams/flow-cli-src-to-llm.mmd
```

## Invariants

At each stage, the flow must hold these invariants:

- `createProgram` exposes one root Commander program onto which every subcommand is registered, so the CLI never has more than one program owner.
- `run` resolves a concrete repository root before any core operation starts; the `--repo` override, when present, is resolved by `resolveRepoRoot` rather than inferred implicitly.
- Every command's output passes through `emit`, `emitHuman`, or `emitJson` — never through ad-hoc prints, so the human/JSON duality stays consistent.
- The MCP server's watch path observes only changes that pass `isWatchDenied`; denied filenames never enqueue sync work.
- The search result `close` is called before the server process ends so the SQLite-backed search database is not abandoned mid-transaction.
- The agent bootstrap queue advances only via `nextAgentBootstrapTask` and `submitAgentBootstrapTask`; the queue owns ordering and bounded attempts, not the calling agent.
- Baseline acceptance via `acceptBaseline` must happen against a validated entry before it can become repository authority.

## Failure and recovery
<!-- lw:anchors packages/core/src/db.ts#CURRENT_SCHEMA_VERSION packages/core/src/llm/index.ts#createLlmClient packages/core/src/llm/probe.ts#formatProbeFailure -->

The supplied source does not show a retry, rollback, or recovery path for the CLI-to-LLM flow. The detection signals identify the schema version, the LLM client factory, and the probe-failure formatter as the flow's sink and failure-facing surfaces, but the bounded excerpt does not display their branching behavior. The schema version is a constant value used to detect drift between a persisted index and the code that reads it:

```ts
export const CURRENT_SCHEMA_VERSION = 9;
```

It is a numeric export declaring the schema version this build expects; the supplied source does not show migration or mismatch handling. The LLM seam's public factory is `createLlmClient`:

```ts
export function createLlmClient(repoRoot: string, config: LivewikiConfig): LlmClient {
```

It takes the repository root and the resolved livewiki configuration, and returns the concrete `LlmClient` adapter the rest of the core package will call. The probe failure path is surfaced by `formatProbeFailure`:

```ts
export function formatProbeFailure(probe: ProviderProbeResult): string {
```

It takes a provider probe result and returns a human-readable description of why the probe failed. Because the excerpt does not show the function bodies for these symbols, the page refrains from describing rollback behavior beyond what is visible: the symbols exist as the LLM seam's construction and diagnostics surface, and any retry logic they exercise lives outside the supplied excerpt.

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
