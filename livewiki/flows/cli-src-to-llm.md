---
title: Turning a CLI command into an LLM call
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
  - packages/cli/src/commands/config.ts#decideBareInvocation
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

# From CLI entry point to LLM client

This page explains the end-to-end path from a user invoking the `livewiki` command-line tool to the moment an external large-language-model provider receives a validated request.

## Purpose

<!-- lw:anchors packages/cli/src/cli.ts#createProgram packages/cli/src/cli.ts#readVersion packages/cli/src/cli.ts#resolveRepoRoot packages/mcp/src/server.ts#createServer packages/mcp/src/server.ts#isWatchDenied packages/mcp/src/server.ts#schedule packages/mcp/src/server.ts#startWatcher packages/mcp/src/server.ts#stop packages/mcp/src/server.ts#syncBatch -->

A developer runs `livewiki` because they want their repository documented automatically: symbols indexed, pages generated, and the result validated against the code. The journey begins at the command line, where a thin shell assembles every subcommand, and ends far deeper in the engine, where a uniform client seam decides which provider to call.

The CLI surface is intentionally narrow. The root program is built once, and the work is delegated to handlers in the `commands` module. The same engine is also reachable through a second route: an MCP server that exposes the documentation tooling to LLM clients such as Claude Code over standard I/O. Both routes converge on the core package, whose own LLM layer (`packages/core/src/llm`) is the single seam to external large-language-model providers.

```ts
export function createProgram(): Command {
```

`createProgram` takes no arguments and returns a Commander `Command` object — the root program to which every livewiki subcommand is later registered.

```ts
function readVersion(): string {
```

`readVersion` takes no arguments and returns a string; it locates the package version so the CLI can report which build is running.

```ts
export function resolveRepoRoot(repoOpt: string | undefined): string {
```

`resolveRepoRoot` takes an optional repo path (`repoOpt`) and returns a string; when the option is absent, it falls back to the effective current working directory.

```ts
export async function createServer(opts: CreateServerOptions = {}): Promise<McpServer> {
```

`createServer` accepts optional options and returns a promise for a configured `McpServer` — the in-memory server object that the stdio transport will later attach to. It registers the queue tools the agent path needs: `livewiki_next_task` to claim work, `livewiki_write_doc` to submit it under that claim, and `livewiki_renew_task_claim` to extend a lease that is about to lapse. The `livewiki_resolve_debt` path also inspects the ledger outcome: when the reconciliation aborts because the wiki snapshot was unstable, it returns an error carrying `ledgerApplied: false` instead of reporting the debt as resolved — the baseline was accepted on disk, but the debt tables were not reconciled. Only a finished run triggers the full search rebuild; a `busy` answer leaves the index alone because the run is still going.

```ts
function isWatchDenied(filename: string): boolean {
```

`isWatchDenied` takes a filename and returns a boolean; it decides whether a changed file is disallowed from the watcher's consideration.

```ts
function schedule(): void {
```

`schedule` takes no arguments and returns nothing; it arranges the next batch of watcher work to run.

```ts
function startWatcher(repoRoot: string, searchIdx: SearchIndex): WatcherHandle {
```

`startWatcher` takes a repository root and a search index and returns a `WatcherHandle` — the object the caller uses to stop watching later.

```ts
async function stop(): Promise<void> {
```

`stop` takes no arguments and returns a void promise; it tears down the running watcher.

```ts
async function syncBatch(): Promise<void> {
```

`syncBatch` takes no arguments and returns a void promise; it applies a batch of queued file changes to the search index.

A developer reaching for `livewiki` in the first place needs a repo root, a known command set, and a version string they can trust. Those facts are established here, in the CLI and MCP entry layers, before any LLM traffic is possible.

## Ordered flow

<!-- lw:anchors packages/cli/src/output.ts#emitHuman packages/cli/src/commands/baseline.ts#registerBaseline packages/mcp/src/stdio.ts#startMcpStdioServer packages/core/src/agent-bootstrap.ts#nextAgentBootstrapTask packages/cli/src/output.ts#emitJson packages/cli/src/commands/batch.ts#registerBatch packages/mcp/src/search.ts#close packages/core/src/agent-bootstrap.ts#submitAgentBootstrapTask packages/cli/src/output.ts#emit packages/cli/src/commands/config.ts#decideBareInvocation packages/mcp/src/search.ts#collectMarkdownFiles packages/core/src/baseline-operations.ts#acceptBaseline -->

The ordered flow is the literal sequence a request follows from the user's keystroke to a provider call.

1. The user invokes `livewiki` with some arguments. The root entry point in `packages/cli/src/index.ts` parses `argv` and hands it to the runner:

   ```ts
   export async function run(argv: readonly string[]): Promise<void> {
   ```

   `run` takes the raw, read-only command-line arguments and returns a void promise; it is the single gate through which every CLI invocation passes.

2. Before a subcommand executes, the CLI decides how to interpret a bare `livewiki` call. An invocation with no verb is not an error and not a silent no-op — it resolves to a defined default behavior:

   ```ts
   export function decideBareInvocation(
   ```

   `decideBareInvocation` is the boundary between "no subcommand supplied" and "a real command is about to run."

3. Every command reports through one output funnel. The human and JSON formatters share the same dispatcher:

   ```ts
   export function emitHuman(text: string): void {
   ```

   `emitHuman` takes a text string and returns nothing; it writes human-readable output to the terminal.

   ```ts
   export function emitJson(data: unknown): void {
   ```

   `emitJson` takes data of any kind and returns nothing; it serializes the data to a single JSON line so programs can parse output line by line.

   ```ts
   export function emit(
   ```

   `emit` is the CLI-wide output dispatcher; it renders whatever a command produced and sends it to the terminal in the format the user selected (`--json` or plain text).

4. Some verbs attach lifecycle handlers to the root program:

   ```ts
   export function registerBaseline(program: Command): void {
   ```

   `registerBaseline` takes a Commander `Command` and returns nothing; it wires the baseline command into the program.

   ```ts
   export function registerBatch(program: Command): void {
   ```

   `registerBatch` takes a Commander `Command` and returns nothing; it wires the batch command into the program.

5. When the command is `serve`, the CLI and the standalone MCP binary share one stdio entry point:

   ```ts
   export async function startMcpStdioServer(opts: {
   ```

   `startMcpStdioServer` takes bootstrap options and returns a promise; it creates the server and attaches it to the standard input/output transport the MCP client speaks.

6. The MCP search layer keeps its full-text index current with the repository:

   ```ts
   async function collectMarkdownFiles(dir: string): Promise<string[]> {
   ```

   `collectMarkdownFiles` takes a directory path and returns a promise for a list of Markdown file paths found under it.

   ```ts
   export function close(idx: SearchIndex): void {
   ```

   `close` takes a search index and returns nothing; it releases the resources held by that index.

7. The core package's agent bootstrap queue lets a coding agent supply Markdown while livewiki owns ordering, validation, and writes:

   ```ts
   export async function nextAgentBootstrapTask(repoRoot: string): Promise<AgentQueueResult> {
   ```

   `nextAgentBootstrapTask` takes a repository root and returns a promise for an `AgentQueueResult`; it atomically claims the next task the agent should work on, returning it with a `claimId` and a `leaseExpiresAt`. A task whose lease is still alive belongs to another executor and is never handed out again. When every unfinished task is leased, it returns `status: "busy"` rather than advancing: an empty candidate set means "nothing I can claim", never "this phase is done", so the run cannot move on — or finish — while work is still in flight.

   ```ts
   export async function submitAgentBootstrapTask(
   ```

   `submitAgentBootstrapTask` accepts the task result supplied by the agent along with the `claimId` it was given; it is the write path where the validated artifact is persisted. The claim is checked before any filesystem work, so a late executor whose claim was replaced or whose lease lapsed gets `stale_claim` and changes nothing.

   ```ts
   export async function acceptBaseline(
   ```

   `acceptBaseline` accepts the baseline operations needed to advance the documentation contract.

Once the agent and batch work converges on the core package, the next step toward the LLM happens in the core package's LLM layer, which resolves a provider and instantiates the adapter that will eventually send the request out.

## Diagram

```mermaid
%% livewiki/diagrams/flow-cli-src-to-llm.mmd
```

## Invariants

What must hold at each stage so the flow stays coherent:

- **One repository root per invocation.** `resolveRepoRoot` returns a single string, and every later step — indexing, walking, writing — derives its paths from that same root. The supplied source does not show a path that introduces a second root for one run.
- **The command set is closed at registration time.** `createProgram` builds one root `Command`, and each verb is registered by an explicit adapter such as `registerBaseline` or `registerBatch`; a caller cannot reach core work except through a registered subcommand or the MCP server.
- **All CLI output passes through the `emit` funnel.** The `output.ts` module is documented as the sole formatter for human and JSON output; the same module also exposes `emitHuman` and `emitJson`, and the supplied source shows commands importing it rather than writing to stdout directly.
- **The MCP server is side-effect free on import.** The `stdio.ts` module may be imported without starting a server or touching process signals; the running state exists only after `startMcpStdioServer` is called.
- **The watcher and search path are explicit.** `startWatcher` returns a handle, `stop` tears the watcher down, `schedule` arranges work, and `syncBatch` applies queued changes; the supplied source keeps these operations as named steps rather than implicit background behavior.

These invariants keep the flow predictable: one root, one program, one output path, one explicit MCP start, and one authoritative schema number.

## Failure and recovery

<!-- lw:anchors packages/core/src/db.ts#CURRENT_SCHEMA_VERSION packages/core/src/llm/index.ts#createLlmClient packages/core/src/llm/probe.ts#formatProbeFailure -->

The LLM boundary is where failures become visible to the user. The source shows two named recovery surfaces: provider construction and probe formatting.

```ts
export function createLlmClient(repoRoot: string, config: LivewikiConfig): LlmClient {
```

`createLlmClient` takes a repository root and a `LivewikiConfig` and returns a fully resolved `LlmClient`. The source shown does not include its body, so this page cannot assert what happens when the config names an unknown provider or supplies invalid credentials; the normal path is that the returned client hides the provider-specific adapter behind one interface from the rest of the engine.

```ts
export function formatProbeFailure(probe: ProviderProbeResult): string {
```

`formatProbeFailure` takes a probe result and returns a string. A probe is the check that runs before real generation; when the provider is unreachable or misconfigured, this function produces a human-readable message. The source in the excerpt does not include the message body, so any specific retry or rollback behavior beyond producing that string is not visible here.

The schema constant also carries a failure-adjacent role:

```ts
export const CURRENT_SCHEMA_VERSION = 10;
```

`CURRENT_SCHEMA_VERSION` is a numeric export; a value of `10` signals which SQLite layout the current core package expects. Migrations use it to detect drift between the code's expected layout and the database file on disk. The recovery behavior for a detected mismatch lives in the migration machinery, which is outside the supplied source.

The supplier of the source is explicit: no other failure path is documented in this page, because the excerpt contains no `throw`, `catch`, fallback, or rollback branch for the named symbols.

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
