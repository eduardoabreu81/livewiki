---
title: Batch Command — Status, Resume, and Run Management
owner: generated
anchors:
- packages/cli/src/commands/batch.ts#USAGE_INCOMPLETE_NOTE
- packages/cli/src/commands/batch.ts#appendStage4Diagnostics
- packages/cli/src/commands/batch.ts#formatDiagnosticLine
- packages/cli/src/commands/batch.ts#formatListHuman
- packages/cli/src/commands/batch.ts#formatResultHuman
- packages/cli/src/commands/batch.ts#formatStatusHuman
- packages/cli/src/commands/batch.ts#registerBatch
- packages/cli/src/commands/batch.ts#setExitCode
---

# Batch Command — Status, Resume, and Run Management

This page explains how the `livewiki batch` CLI command is registered and how its human-readable outputs and exit codes are produced.

## When to use this page

- Learn how to invoke `livewiki batch` and its subcommands (`status`, `resume`, `list`, `--only`) from the command line.
- Understand the mapping between batch run statuses and process exit codes.
- Review how tokens, USD, task counts, failures, and degraded pages are rendered in human-readable output.

## How it fits

`packages/cli/src/commands/batch.ts` is the CLI-facing layer for the Phase 3 batch machinery. It wires user input to core functions from `@livewiki/core/batch` and `@livewiki/core/batch-status`, converts results into either JSON or human-readable text, and sets the process exit code. The file lives under `packages/cli/src/commands/`, alongside other command registrars, and shares helpers like `emit` and `resolveRepoRoot` from the surrounding CLI infrastructure.

## Diagram

```mermaid
%% livewiki/diagrams/commands-batch.mmd
```

## Command Registration and Dispatch

<!-- lw:anchors packages/cli/src/commands/batch.ts#registerBatch -->

The `registerBatch` function is the entry point that binds the `batch` command to the Commander program. It exists to translate user intent into calls to the core batch engine, then present the outcome consistently.

```ts
export function registerBatch(program: Command): void {
```

It takes the Commander `Command` object and attaches a `batch` subcommand with options (`--only`, `--no-refine`, `--concurrency`) and an action handler. The handler reads global options like `--json` and `--repo`, resolves the repository root, and then dispatches based on the positional arguments.

The dispatch logic is ordered so that `--only` takes precedence over the default status path. With no arguments and no `--only`, it builds a status report for the last run. With `list`, it lists runs. With `status [runId]`, it reports a specific run. With `resume <runId>`, it resumes pending or failed tasks. With `--only <target>`, it re-runs a single task from the last run. Finally, a bare integer argument is treated as an alias for `status` with that run ID.

Each branch produces a result or report, passes it to `emit` with the JSON flag and a human formatter, and then calls `setExitCode` to reflect the run's status. Errors are caught and printed to stderr, and the exit code is set to 1 without an abrupt `process.exit`, which avoids libuv crashes on Windows.

## Human-Readable Status Output

<!-- lw:anchors packages/cli/src/commands/batch.ts#formatStatusHuman packages/cli/src/commands/batch.ts#USAGE_INCOMPLETE_NOTE -->

The `formatStatusHuman` function renders a full run report as a human-readable block. It exists because status reports contain rich data—tokens, costs, counts, and failures—that needs a readable, structured presentation.

```ts
export function formatStatusHuman(report: Awaited<ReturnType<typeof buildStatusReport>>): string {
```

It takes the report object and returns a formatted string. The output is token-first: input and output token counts are the primary metric, and USD is shown as a secondary "estimated" line only when pricing exists. It displays the run ID, status, start and finish times, and authoritative task counts from the summary. Degraded pages are surfaced as a count, not a failure.

The function then iterates over per-stage and per-module token data, and finally lists failures with their codes, messages, and retry commands. For stage-4 failures, it calls `appendStage4Diagnostics` to include per-attempt detail.

The shared constant `USAGE_INCOMPLETE_NOTE`, when usage data is incomplete, is emitted in both status and result output.

```ts
export const USAGE_INCOMPLETE_NOTE =
  "Note: totals are incomplete — some attempts have unknown usage. Prefer proxy/provider billing for wire cost.";
```

It is a constant string that informs the user that the displayed totals are not final, directing them to billing sources for exact wire cost.

## Human-Readable Result and List Output

<!-- lw:anchors packages/cli/src/commands/batch.ts#formatResultHuman packages/cli/src/commands/batch.ts#formatListHuman -->

The `formatResultHuman` and `formatListHuman` functions convert the results of a batch execution or a run listing into readable lines. They exist so that non-tech users can quickly see what happened and what remains.

```ts
export function formatResultHuman(result: Awaited<ReturnType<typeof runBatch>>): string {
```

It takes a batch execution result and returns a string. The output starts with the run ID and status, then token counts and an estimated USD line when available. It reports task done/failure counts, degraded pages, circuit-breaker status, and any skipped or preserved hubs. Stale page removals and skipped topic plans are also surfaced. Failures are listed with codes, messages, and retry commands.

```ts
function formatListHuman(runs: Awaited<ReturnType<typeof listRuns>>): string {
```

It takes an array of run summaries and returns a string. If there are no runs, it prints `(none)`. Otherwise, it lists each run's ID, status, start, and finish time (or `(running)`).

## Exit Code Mapping

<!-- lw:anchors packages/cli/src/commands/batch.ts#setExitCode -->

The `setExitCode` function translates a batch run's status into the process exit code that shell scripts can rely on. It exists to make the CLI composable in automation.

```ts
function setExitCode(repoRoot: string, status: string, json: boolean): void {
```

It takes the repository root (currently unused), the status string, and a JSON flag. When `json` is true, it returns immediately, leaving the exit code at 0. Otherwise, it maps `completed` to 0, `completed_with_failures` to 1, and `aborted` to 2. Setting `process.exitCode` instead of calling `process.exit` lets Node drain pending async I/O.

## Stage-4 Diagnostic Formatting

<!-- lw:anchors packages/cli/src/commands/batch.ts#appendStage4Diagnostics packages/cli/src/commands/batch.ts#formatDiagnosticLine -->

These two functions handle the per-attempt diagnostics for failed stage-4 tasks. They exist to give users a compact, actionable timeline of why an LLM refinement attempt failed.

```ts
function appendStage4Diagnostics(
  lines: string[],
  report: Awaited<ReturnType<typeof buildStatusReport>>,
  failureTaskId: number,
): void {
```

It takes an array of output lines, the full status report, and a failing task ID. It finds the task in the report, and if its `diagnosticHistory` exists and is non-empty, it appends an `attempts:` block with one indented line per attempt, each formatted by `formatDiagnosticLine`. If the history is absent (pre-dating diagnostics) or empty (task never reached the LLM), it returns silently.

```ts
function formatDiagnosticLine(d: {
  attempt: number;
  stopReason?: string;
  outcome: string;
  errors: Array<{ code: string }>;
}): string {
```

It takes a diagnostic entry and returns a single line. The line shows the attempt number, the stop reason (or `-` when absent), the outcome, and a deduplicated, first-seen-order list of error codes when present. This mirrors the format persisted in checkpoint error messages, so log output is consistent across surfaces.