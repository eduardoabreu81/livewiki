---
title: cli-src to llm
owner: generated
anchors:
  - packages/cli/src/cli.ts#createProgram
  - packages/cli/src/cli.ts#readVersion
  - packages/cli/src/cli.ts#resolveRepoRoot
  - packages/cli/src/cli.ts#run
  - packages/mcp/src/server.ts#createServer
  - packages/mcp/src/server.ts#isWatchDenied
  - packages/mcp/src/server.ts#startWatcher
  - packages/cli/src/output.ts#emitHuman
  - packages/cli/src/output.ts#emitJson
  - packages/cli/src/output.ts#emit
  - packages/cli/src/commands/baseline.ts#registerBaseline
  - packages/cli/src/commands/batch.ts#registerBatch
  - packages/cli/src/commands/config.ts#decideBareInvocation
  - packages/cli/src/commands/config.ts#isConfigured
  - packages/mcp/src/stdio.ts#startMcpStdioServer
  - packages/mcp/src/search.ts#close
  - packages/mcp/src/search.ts#collectMarkdownFiles
  - packages/mcp/src/search.ts#indexPage
  - packages/core/src/agent-bootstrap.ts#nextAgentBootstrapTask
  - packages/core/src/agent-bootstrap.ts#renewAgentBootstrapClaim
  - packages/core/src/agent-bootstrap.ts#submitAgentBootstrapTask
  - packages/core/src/db.ts#assertExistingIndexIsUsable
  - packages/core/src/llm/index.ts#createLlmClient
  - packages/core/src/llm/probe.ts#formatProbeFailure
  - packages/core/src/llm/probe.ts#probeProvider
updated: 2026-09-05
modules:
  - cli-src
  - commands
  - mcp-src
  - core-src
  - llm
---

# CLI source to LLM

This page explains the end-to-end behavior that takes a user's command-line invocation of `livewiki` from program construction through configuration checking and command registration, then through search indexing and MCP server exposure, finishing with a validated connection to a language-model provider.

## Purpose

<!-- lw:anchors packages/cli/src/cli.ts#createProgram packages/cli/src/cli.ts#readVersion packages/cli/src/cli.ts#resolveRepoRoot packages/cli/src/cli.ts#run packages/mcp/src/server.ts#createServer packages/mcp/src/server.ts#isWatchDenied packages/mcp/src/server.ts#startWatcher -->

A person runs the `livewiki` CLI because they want a living documentation layer over a source repository: one that indexes code symbols, serves wiki pages to coding agents through MCP, and — when it is time to generate or repair prose — talks to a language-model provider in a controlled, validated way. "MCP" (Model Context Protocol) is the JSON-RPC-style protocol coding agents use to discover and call tools on a local server; "LLM" here means the remote language-model service that livewiki calls to generate documentation content.

The flow begins in the CLI's program constructor.

```ts
export function createProgram(): Command {
```

`createProgram` takes no arguments and returns a Commander `Command` object: the shared root program that every subcommand (`init`, `index`, `config`, `baseline`, `batch`, `serve`, and the rest) later registers itself onto. Building one shared program is what allows the whole CLI surface to be described in one place and then extended incrementally by the command modules.

```ts
function readVersion(): string {
```

`readVersion` takes no arguments and returns a string. The visible source does not establish where that string is read from, so the safe claim is narrower: the program constructor consults a version reader and threads the resulting value into the program's metadata so that `--version`-style output has one source.

```ts
export function resolveRepoRoot(repoOpt: string | undefined): string {
```

`resolveRepoRoot` takes an optional repository-path string (the `--repo` value, which may be absent) and returns a string resolving the user's supplied path into an absolute repository root that is safe to operate in. This is the boundary decision that every later command, the MCP server, and the LLM client share — without a settled root, the system cannot know where the wiki, the index database, or the provider configuration live.

```ts
export async function run(argv: readonly string[]): Promise<void> {
```

`run` takes the raw process argument vector and returns a promise that settles once the CLI has dispatched and finished. It is the async entry that connects the assembled program to the user's actual invocation, so everything downstream — validation, reporting, and exit codes — is observable from this one surface.

The MCP side of the flow mirrors the same need for a single, shared construction point.

```ts
export async function createServer(opts: CreateServerOptions = {}): Promise<McpServer> {
```

`createServer` takes an optional options object (defaulting to empty) and returns a promise of an `McpServer` instance. This is the object that exposes livewiki's wiki-reading and search tools to coding agents, wrapping the same underlying search index and page-reading logic behind the MCP protocol.

```ts
function isWatchDenied(filename: string): boolean {
```

`isWatchDenied` takes a filename and returns a boolean saying whether file-change watching should intentionally ignore events touching that path (for example, paths inside transient working directories). This guard keeps the watcher's expensive reindex work from being triggered by its own churn or by paths that have no business being indexed.

```ts
export function startWatcher(
```

`startWatcher` takes a search index and begins observing the wiki directory for changes, so that page updates are reflected in what agents can search without the user re-running an indexing command. Where the CLI side is request-driven (the user runs a command), the watcher side is event-driven (the filesystem changes and the in-memory search index follows), which is why the two entry surfaces are documented as one flow: both lead to the same persisted index and, ultimately, the same validated LLM client.

## Ordered flow

<!-- lw:anchors packages/cli/src/commands/config.ts#decideBareInvocation packages/cli/src/commands/config.ts#isConfigured packages/cli/src/commands/baseline.ts#registerBaseline packages/cli/src/commands/batch.ts#registerBatch packages/cli/src/output.ts#emitHuman packages/cli/src/output.ts#emitJson packages/cli/src/output.ts#emit packages/mcp/src/stdio.ts#startMcpStdioServer packages/mcp/src/search.ts#collectMarkdownFiles packages/mcp/src/search.ts#indexPage packages/mcp/src/search.ts#close packages/core/src/agent-bootstrap.ts#nextAgentBootstrapTask packages/core/src/agent-bootstrap.ts#renewAgentBootstrapClaim packages/core/src/agent-bootstrap.ts#submitAgentBootstrapTask -->

1. The CLI gathers the invocation and configures the command layer. `decideBareInvocation` interprets a `config` invocation that has no sub-arguments — for instance, a bare `livewiki config` with no `set` or `get` — and turns that into the concrete action the user likely wants.

```ts
export function decideBareInvocation(
```

`decideBareInvocation` takes the configuration command context and produces the chosen configuration action. It is the piece of the flow that keeps an under-specified invocation from silently doing the wrong thing.

2. The CLI checks whether the repository already has a working provider configuration.

```ts
export async function isConfigured(repoRoot: string): Promise<boolean> {
```

`isConfigured` takes the resolved repository root and returns a promise of a boolean indicating whether that repository already has a usable configuration. This check determines whether later steps need to prompt or can proceed.

3. Each command registers itself onto the shared program. `registerBaseline` attaches the baseline-management subcommand, and `registerBatch` attaches the batch documentation subcommand.

```ts
export function registerBaseline(program: Command): void {
```

`registerBaseline` takes the shared Commander program and returns nothing; its effect is to make the baseline lifecycle commands available on the CLI.

```ts
export function registerBatch(program: Command): void {
```

`registerBatch` takes the shared Commander program and returns nothing; its effect is to make the batch documentation pipeline available. Both registration functions are thin adapters: they translate Commander options into calls on services in `@livewiki/core`, keeping report formatting out of the underlying operations.

4. Whatever command runs, its result is rendered through one output path so every command can emit either human prose or parseable JSON.

```ts
export function emitHuman(text: string): void {
```

`emitHuman` takes a plain-text string and returns nothing; it writes that text to the user in a human-readable shape.

```ts
export function emitJson(data: unknown): void {
```

`emitJson` takes any JSON-serializable value and returns nothing; it writes one JSON line (with a trailing newline) so line-oriented `JSON.parse` consumers can read every command's output safely.

```ts
export function emit(
```

`emit` takes a data payload and route it to the human or JSON renderer based on the user's selected mode. This is the point where the CLI's internal product flow stops and becomes output the user or a downstream script can act on.

5. When an agent needs a server rather than a printed report, both the standalone binary and `livewiki serve` converge on one stdio entry.

```ts
export async function startMcpStdioServer(opts: {
```

`startMcpStdioServer` takes a stdio-server options object (not fully visible in the supplied excerpt) and returns a promise that connects the created MCP server to a stdio transport. This is the handoff from "CLI command" to "long-lived process speaking MCP over stdin/stdout."

6. While the server runs, the search index is assembled from the wiki's Markdown files.

```ts
async function collectMarkdownFiles(dir: string): Promise<string[]> {
```

`collectMarkdownFiles` takes a directory path and returns a promise of the array of Markdown file paths underneath it. The directory walk is what determines which pages become searchable.

```ts
export function indexPage(idx: SearchIndex, wikiPath: string, content: string): void {
```

`indexPage` takes a search index, the wiki-relative path of a page, and that page's text content, and returns nothing; it inserts the page's identifier-split tokens into the FTS5 index so agent searches match both whole identifiers and their sub-words.

```ts
export function close(idx: SearchIndex): void {
```

`close` takes a search index and returns nothing; it releases the index for shutdown. Where the watcher keeps the index live, `close` is the matching terminal state for one lifecycle.

7. When the deterministic batch pipeline needs prose, it does not call a provider impromptu. It hands work to the agent-bootstrap queue, whose lease machinery coordinates exactly which agent writes which piece in which order.

```ts
export async function nextAgentBootstrapTask(repoRoot: string): Promise<AgentQueueResult> {
```

`nextAgentBootstrapTask` takes the repository root and returns a promise of the next queue result. The result is the task metadata the connected agent should act on next (or the signal that no task is available). Livewiki owns the ordering and the validation; the agent supplies the prose.

```ts
export async function renewAgentBootstrapClaim(
```

`renewAgentBootstrapClaim` takes the identity of an in-flight queue claim and extends its lease so a slow-but-alive agent is not mistaken for a dead one.

```ts
export async function submitAgentBootstrapTask(
```

`submitAgentBootstrapTask` takes an agent's completed task payload, validates it, and transactionally records the accepted artifact. The two callers around it — `nextAgentBootstrapTask` to hand out work, and `submitAgentBootstrapTask` to accept it back — are the two halves of the claim/lease discipline that prevents two agents pointed at the same repository from being handed the same task. Only after an artifact is accepted at this step does anything in the flow mean "documentation was produced."

8. The final step is constructing a working LLM client against the configured provider, which the `llm` module does after a probe has validated the endpoint. That handoff is described under [Failure and recovery](#failure-and-recovery) because the client factory and the probe are the flow's last, and most defensive, boundary before any paid generation.

## Diagram

```mermaid
%% livewiki/diagrams/flow-cli-src-to-llm.mmd
```

## Invariants

- The program constructor wires every command onto the same shared root before any dispatch, so the full command surface exists for validation and help before the user's first action runs.
- Repository-root resolution is one shared boundary. The command layer, the MCP server, and the LLM client all take a settled repository root, never an ambiguous relative path.
- One output path serves every command, so human text and machine JSON follow the same routing decision and cannot drift into separate formats per command.
- The file-change watcher is filtered by an explicit deny check, so the paths that must not trigger reindexing are excluded before any queueing work happens rather than after.
- The search index consumes only Markdown files collected by the directory walk, and every inserted page is addressed by a fixed wiki path so an indexed document can be reproduced from its path and content.
- The agent-bootstrap queue insists on claim and submission calls. A task changes state only when `submitAgentBootstrapTask` has accepted a submitted artifact after a valid claim; the visible lease machinery documents the bounded-attempt discipline rather than allowing an unbounded impression of "the model writes the page directly."
- The LLM client is created only from a repository root plus validated `LivewikiConfig`, which is the point where the flow's raw inputs stop and the provider adapter starts.

## Failure and recovery

<!-- lw:anchors packages/core/src/db.ts#assertExistingIndexIsUsable packages/core/src/llm/index.ts#createLlmClient packages/core/src/llm/probe.ts#formatProbeFailure packages/core/src/llm/probe.ts#probeProvider -->

The supplied excerpt does not show the bodies of most of the database-facing or provider-facing functions, so this section documents what the visible signatures establish and does not fill in branches the excerpt cannot prove.

```ts
function assertExistingIndexIsUsable(db: Database.Database, dbPath: string): void {
```

`assertExistingIndexIsUsable` takes an open SQLite `Database` handle and the filesystem path it was opened from, and returns nothing. Its name describes a fail-fast guard placed at the point where an already-existing `.livewiki` database is about to be trusted for further work, but the excerpt is truncated before the condition it checks. When the guard rejects the database, the caller is expected to recover by not proceeding with the unusable file rather than quietly continuing. No rollback or retry path is visible in the excerpt for this symbol, so none is claimed.

```ts
export function createLlmClient(repoRoot: string, config: LivewikiConfig): LlmClient {
```

`createLlmClient` takes the repository root and a `LivewikiConfig` and returns an `LlmClient`. That client — per the module page digest, not independently visible in the excerpt — is one of an Anthropic Messages adapter or an OpenAI-compatible adapter selected by the configuration. The excerpt does not expose what happens when the configuration names an unknown provider, so no throw or fallback is asserted here.

The probe functions are where failure handling becomes explicit in the visible contract. The connectivity probe runs before any paid generation, so the flow fails closed at the boundary between "configured" and "paid" rather than discovering a broken or silently-changed provider only after spending money.

```ts
export async function probeProvider(
```

`probeProvider` takes the repository and provider configuration (the excerpt truncates the parameter list) and returns a promise of a `ProviderProbeResult`. The result is the pass/fail evidence the rest of the flow consults.

```ts
export function formatProbeFailure(probe: ProviderProbeResult): string {
```

`formatProbeFailure` takes the probe result and returns a string rendering the failure in terms a user or agent can act on. This is the visible recovery path at the LLM boundary: when the probe does not pass, the flow does not fall through to the client's paid call, but instead formats a failure message for display. Because the excerpt does not show an automatic retry, one is not claimed — the documented path is probe, then fail closed with a formatted message, then stop.

The end-to-end behavior this flow explains therefore ends not with "content generated" but with "content generation made safe to attempt." The configured provider is only reached after the probe has established that the endpoint actually behaves, and every earlier stage — command registration, config checking, search indexing, and agent-bootstrap queue acceptance — exists to make that final paid step a deliberate, validated action rather than an incidental one.

## Related pages

- [cli-src](../cli-src/index.md)
- [commands](../commands/index.md)
- [mcp-src](../mcp-src/index.md)
- [core-src](../core-src/index.md)
- [llm](../llm/index.md)
- [How it works](index.md)

<!-- livewiki:topics:start -->
## Concept topics

- [CLI Commands and Core LLM Coordination](../topics/cli-commands-and-core-llm-coordination-2166f507.md)
<!-- livewiki:topics:end -->
