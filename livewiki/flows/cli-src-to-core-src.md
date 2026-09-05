---
title: From CLI Source to Core Source: How livewiki Commands Drive Core Operations
owner: generated
anchors:
  - packages/cli/src/cli.ts#createProgram
  - packages/cli/src/cli.ts#run
  - packages/core/src/baseline-operations.ts#removeBaselineEntry
  - packages/core/src/llm/index.ts#createLlmClient
  - packages/core/src/llm/probe.ts#probeProvider
  - packages/core/src/llm/base.ts#LlmTimeoutError
  - packages/cli/src/commands/baseline.ts#registerBaseline
  - packages/core/src/agent-bootstrap.ts#advancePhase
  - packages/core/src/baseline-operations.ts#acceptBaseline
  - packages/core/src/baseline-operations.ts#bootstrapBaseline
  - packages/core/src/baseline-operations.ts#migrateBaselineKey
  - packages/core/src/baseline-operations.ts#relocateBaselineEntry
updated: 2026-09-05
modules:
  - cli-src
  - commands
  - llm
  - core-src
---

# From CLI Source to Core Source: How livewiki Commands Drive Core Operations

This page explains how a user's livewiki command-line invocation flows from the CLI layer into the core, where indexing, baseline, LLM, and related operations actually execute.

## Purpose

<!-- lw:anchors packages/cli/src/cli.ts#createProgram packages/cli/src/cli.ts#run -->

A person wants to use livewiki from their terminal to generate, check, or update documentation for a software repository. This flow describes the bridge between the `cli-src` package (which owns the command-line entry point and the parsing of user input) and the `core-src` package (which owns the actual documentation work). When the user runs the livewiki binary, the entry point function `createProgram()` builds the full Commander program with all subcommands registered, and then `run()` takes the raw argument array from the process and dispatches to the matching subcommand handler.

The central assembly function is `createProgram()`, whose signature is:

```typescript
export function createProgram(): Command {
```

It takes no arguments and returns a Commander `Command` object that holds every registered subcommand. The orchestration entry point is `run()`, with this signature:

```typescript
export async function run(argv: readonly string[]): Promise<void> {
```

It accepts the raw command-line argument vector and returns a promise that resolves when the chosen command finishes, or rejects if the command fails. Between those two functions, the CLI resolves the repository root, translates Commander options into service calls, and routes every result through the output formatter. The deliverable of the whole flow is a completed documentation operation (an indexed symbol table, an updated baseline, a generated page) plus a human- or machine-readable report that the user sees in their terminal.

## Ordered flow

<!-- lw:anchors packages/core/src/llm/index.ts#createLlmClient packages/core/src/llm/probe.ts#probeProvider packages/core/src/llm/base.ts#LlmTimeoutError packages/cli/src/commands/baseline.ts#registerBaseline -->

1. **Process startup and program construction**: The packaged `livewiki` binary starts and calls `run()` with `process.argv`. Inside, `createProgram()` builds the Commander instance and registers each subcommand through the `register*` functions from the `commands/` package.
2. **Subcommand registration**: Each command file in `commands/` exports a registration function. For example, `registerBaseline(program)` attaches the baseline subcommand to the shared Commander program. Its signature is:

```typescript
export function registerBaseline(program: Command): void {
```

 It takes the shared Commander `Command` object and returns nothing, attaching the subcommand's options and action handler to it. `registerBatch(program)`, `registerConfig(program)`, and the other registration functions follow the same shape for their respective subcommands.

3. **Argument parsing and dispatch**: Commander parses the user's tokens and routes control to the action handler of the matched subcommand.
4. **Repository resolution**: Inside the action handler, the CLI resolves the absolute path of the target repository, either from a `--repo` option or by walking up from the current directory. This path is the base for every later file and database operation.
5. **Configuration handling (config subcommand only)**: If the user invoked `livewiki config` without a subcommand, `decideBareInvocation()` decides whether the run is a bare invocation so the CLI can prompt appropriately. `isConfigured(repoRoot)` checks that the repository carries a valid `.livewiki/config.json` before any LLM-dependent step.
6. **Provider connectivity probe**: Before a paid LLM run, the core's `probeProvider()` sends a small, bounded request to the configured endpoint to confirm it is reachable and returns the expected shape. This guards against providers that silently change behavior.
7. **LLM client fabrication**: When real LLM work begins, the core calls `createLlmClient(repoRoot, config)` to obtain the provider-specific adapter for the resolved configuration. Its signature is:

```typescript
export function createLlmClient(repoRoot: string, config: LivewikiConfig): LlmClient {
```

 It takes the absolute repository path and the validated configuration object, and returns an `LlmClient` that adapts livewiki's common request shape to either Anthropic's Messages API or an OpenAI-compatible Chat Completions API.

8. **Command execution in core**: The remaining work — indexing, baseline maintenance, page generation, batch orchestration — runs inside `@livewiki/core`, which performs the filesystem reads, SQLite updates, and LLM calls for the chosen operation.
9. **Output formatting**: Every command's result passes through the `emit` family. A shared dispatcher picks `emitHuman` for multi-line plain text when no `--json` flag was given, or `emitJson` for a single parseable JSON line when it was. No command writes directly to stdout outside this layer.

## Diagram

```mermaid
%% livewiki/diagrams/flow-cli-src-to-core-src.mmd
```

## Invariants

At each stage of the flow these properties must hold. After repository resolution, the resulting path must be an existing directory that livewiki is allowed to write into. Before any LLM-dependent operation, the repository must either carry a valid `.livewiki/config.json` or be in the configuration-setup path of the `config` command. Every command result must pass through exactly one output call: the presence of `--json` selects the JSON emitter, its absence the human emitter, and nothing bypasses that dispatcher. The LLM client must be constructed only after configuration validation and, where a probe runs, only after the probe succeeds — a failed probe halts the pipeline before any billable request. Baseline mutations must touch only paths inside the repository's `livewiki/` or `.livewiki/` directories, as enforced by the core's safe-io allowlist.

## Failure and recovery

<!-- lw:anchors packages/core/src/agent-bootstrap.ts#advancePhase packages/core/src/baseline-operations.ts#acceptBaseline packages/core/src/baseline-operations.ts#bootstrapBaseline packages/core/src/baseline-operations.ts#migrateBaselineKey packages/core/src/baseline-operations.ts#relocateBaselineEntry packages/core/src/baseline-operations.ts#removeBaselineEntry -->

The recovery paths visible in the source live largely inside the core operations rather than at the CLI handler level. When an LLM call exceeds its per-attempt timeout, the shared wrapper throws `LlmTimeoutError`, an error type that extends the standard `Error` class so callers can distinguish a timeout from other HTTP failures; the message it carries identifies the timed-out provider attempt. For explicit retryable HTTP statuses such as 429 or 5xx, the shared wrapper retries with exponential backoff, honoring the `Retry-After` header on 429/503 responses, so a transient provider hiccup may recover without user intervention. A persistent timeout or a failed probe surfaces as a hard error that the CLI reports through the output channel. The baseline operations — `bootstrapBaseline`, which creates the initial baseline from the current index snapshot; `acceptBaseline`, which promotes a proposed baseline to authoritative; `migrateBaselineKey`, which moves a symbol between baseline entries; `relocateBaselineEntry`, which moves an entry's documentation target; and `removeBaselineEntry`, which deletes a stale entry — each perform transactional writes so a failed mutation leaves the prior baseline intact rather than partially modified. The `advancePhase` function, which progresses the agent-bootstrap queue state, follows the same transactional pattern: a task's checkpoint is committed only after its page write and verification succeed, and a crash mid-task leaves the checkpoint in its prior state so the next run can retry from a consistent point. The supplied excerpt does not show explicit retry or rollback logic in the CLI command handlers themselves beyond what Commander provides for parse errors, so this description is limited to the normal path plus the provider-level retry behavior that is actually visible in the LLM layer and the transactional writes of the baseline and bootstrap operations.

## Related pages

- [How it works](index.md)
- [CLI Source](../cli-src/index.md)
- [Commands](../commands/index.md)
- [LLM Module](../llm/index.md)
- [Core Source](../core-src/index.md)

<!-- livewiki:topics:start -->
## Concept topics

- [CLI Commands and Core LLM Coordination](../topics/cli-commands-and-core-llm-coordination-2166f507.md)
<!-- livewiki:topics:end -->
