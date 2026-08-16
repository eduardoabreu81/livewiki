---
title: Batch command registration and human-readable reporting
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

# Batch CLI command: registration and human-readable reporting

This page documents how the `livewiki batch` command is registered with the Commander CLI framework and how it formats batch run reports for human consumption.

## When to use this page

- Understand how the `livewiki batch` command dispatches its subcommands (`status`, `resume`, `list`, and `--only`).
- Learn how token, USD, failure, and recovery-tier information is formatted into the human-readable output for batch status and result reports.
- See how exit codes are derived from run status for non-JSON output.
- Trace how failed stage-4 tasks surface their per-attempt diagnostic history in status reports.

## How it fits

This file lives in the CLI package (`packages/cli/src/commands/`), which is the user-facing command layer of livewiki. It depends on core batch logic imported from `@livewiki/core/batch` (specifically `runBatch`, `resumeBatch`, `runOnly`) and `@livewiki/core/batch-status` (`buildStatusReport`, `listRuns`). The file's role is to wire a Commander subcommand to those core functions and to translate their structured results into either JSON (via the shared `emit` helper) or human-readable text. It also sets the process exit code based on run status, except when JSON output is requested, in which case the exit code is always 0.

The mechanics in this file are purely about CLI orchestration and presentation: it validates user input, calls the core functions, formats the returned data, and signals the outcome through the exit code.

## Diagram

```mermaid
%% livewiki/diagrams/commands-batch.mmd
```

## Subcommand dispatch

<!-- lw:anchors packages/cli/src/commands/batch.ts#registerBatch -->

The `registerBatch` function is the single entry point that registers the `batch` command on the provided Commander `program`. It takes a `Command` instance and returns `void`.

```ts
export function registerBatch(program: Command): void {
```

The function receives the Commander program and registers a `batch` command on it. It declares three options: `--only <target>` to re-run a single task, `--no-refine` to skip LLM refinement (Commander maps this to `refine === false`), and `--concurrency <n>` to set the stage-4 worker pool size (an integer 1..16). The action handler then resolves the repository root, parses the positional arguments, and dispatches based on the first argument.

The dispatch order is deliberate, and the `--only` flag takes precedence over the default status behavior — a historical bug where `batch --only <target>` without a positional runId silently printed status instead of re-running the task is explicitly guarded against. The flow proceeds as follows:

1. **No arguments and no `--only`**: calls `buildStatusReport` on the resolved repository root, emits the report, and sets the exit code.
2. **`list`**: calls `listRuns`, emits the result, and returns (no exit code is set in this branch).
3. **`status`**: parses the optional run ID; if provided but not a valid number, it throws an error. Calls `buildStatusReport`, emits, and sets the exit code.
4. **`resume`**: requires a run ID; if missing or not a number, it throws an error. Calls `resumeBatch` with the resolved options (`noRefine` when the user passed `--no-refine`, and `concurrency` when provided), emits, and sets the exit code.
5. **`--only`**: calls `runOnly` with the target; the runId is accepted for symmetry but ignored (core always resumes the last run). Emits and sets the exit code.
6. **A numeric run ID**: aliases `status` with that run ID.
7. **Anything else**: throws an error listing the valid subcommands.

The whole dispatch runs inside a `try` block; on error it writes a message to stderr and sets `process.exitCode = 1` instead of calling `process.exit(1)` directly, because abrupt exits can crash libuv on Windows if any async handle is still open.

## Status report formatting

<!-- lw:anchors packages/cli/src/commands/batch.ts#formatStatusHuman packages/cli/src/commands/batch.ts#USAGE_INCOMPLETE_NOTE packages/cli/src/commands/batch.ts#appendStage4Diagnostics packages/cli/src/commands/batch.ts#formatDiagnosticLine -->

The `formatStatusHuman` function converts a status report returned by `buildStatusReport` into a human-readable string. It takes a status report object and returns a string.

```ts
export function formatStatusHuman(report: Awaited<ReturnType<typeof buildStatusReport>>): string {
```

The formatter uses a token-first presentation strategy: tokens are the primary metric, USD is secondary and omitted when no pricing exists. It builds a list of lines covering the run ID and status, start/finish timestamps, task counts, token totals per stage, optional USD estimates, per-module token usage, and any failures.

Key behaviors:

- **Authoritative task counts**: uses `report.run.summary.tasksDone` and `.tasksFailed` (the same counts persisted by `finalizeRun`), rather than `byModule.length`, which is a stage-4-only usage-tracking array that previously disagreed with the end-of-run totals.
- **Accounting unavailable**: when the run's summary marks accounting as `"unavailable"`, it prints a message that the connected agent wrote the pages and MCP does not report model usage, skipping all token/USD lines.
- **Degraded pages**: pages completed under the relaxed contract are surfaced as a count, never silently omitted.
- **USD as secondary**: printed as an "estimated" line only when at least one model has pricing, otherwise explicitly noted as omitted.
- **Failures**: each failure shows its error code, module, message, and retry command. For failed stage-4 tasks, it additionally calls `appendStage4Diagnostics` to show the per-attempt sequence.
- **Incomplete usage**: when `t.usageIncomplete` is set, the shared `USAGE_INCOMPLETE_NOTE` constant is appended. This constant is a string describing that totals are incomplete and proxy/provider billing should be preferred for wire cost.

The `appendStage4Diagnostics` function is responsible for the per-attempt diagnostic sequence for a failed stage-4 task. It takes a mutable lines array, the full status report, and a task ID, and returns `void`.

```ts
function appendStage4Diagnostics(
  lines: string[],
  report: Awaited<ReturnType<typeof buildStatusReport>>,
  failureTaskId: number,
): void {
```

It finds the task in the report by ID; if the task is missing or has no `diagnosticHistory`, it returns silently (this covers checkpoints that pre-date diagnostics, per CONTRACT I5, and tasks that never reached the LLM). Otherwise it pushes an `attempts:` header and one indented line per attempt, each produced by `formatDiagnosticLine`.

The `formatDiagnosticLine` function formats a single diagnostic entry into one compact line. It takes an object with `attempt`, `stopReason`, `outcome`, and `errors` fields, and returns a string.

```ts
function formatDiagnosticLine(d: {
  attempt: number;
  stopReason?: string;
  outcome: string;
  errors: Array<{ code: string }>;
}): string {
```

The line has the shape `attempt <n>: <stopReason> -> <outcome> [<codes>]`. The `stopReason` falls back to `"-"` when not provided (e.g. for `llm_error` outcomes); error codes are deduplicated and preserve first-seen order so the user can match them against the validator enumeration. For outcomes of `truncated_by_token_limit`, it appends a note pointing at the `"thinking": "disabled"` config option — a prior dogfood incident showed provider-side reasoning silently consuming the whole output budget and surfacing as repeated truncations.

## Run result formatting

<!-- lw:anchors packages/cli/src/commands/batch.ts#formatResultHuman -->

The `formatResultHuman` function converts a batch run result (returned by `runBatch` or `resumeBatch`) into human-readable text. It takes a result object and returns a string.

```ts
export function formatResultHuman(result: Awaited<ReturnType<typeof runBatch>>): string {
```

Like the status formatter, it is token-first: it prints the run ID and status, input/output token totals, and model names. The `USAGE_INCOMPLETE_NOTE` constant is appended when the totals are incomplete. USD appears as an estimated line when a price exists, as an "unknown/incomplete" line when usage is incomplete, or as an "omitted" line when the model has no pricing — unless the run used zero tokens and usage is complete, in which case it is skipped entirely.

It then reports authoritative per-task counters (`tasksDone` and failures count, not `byModule.length`), followed by several never-silent categories:

- **Degraded pages** completed under the relaxed contract.
- **Circuit breaker** state (triggered or not).
- **Preserved hubs** (`skippedFlowsHub`, `skippedAuxiliaryHub`, `skippedTopicsHub`) with owner and path, per R10.1 C.
- **Deterministic pre-LLM flow skips** (`skippedFlowCandidates`) with slug, code, and message, per R10.1 K.
- **Stale pages removed** by repartition cleanup (#24).
- **Exhausted topic plan** (`skippedTopicPlan`) with reason and retry command — always additive, never treated as a batch failure.

Failures are listed at the end, each with error code, module, message, and retry command.

## Run list formatting

<!-- lw:anchors packages/cli/src/commands/batch.ts#formatListHuman -->

The `formatListHuman` function converts a list of batch runs (from `listRuns`) into a human-readable table. It takes a list of run objects and returns a string.

```ts
function formatListHuman(runs: Awaited<ReturnType<typeof listRuns>>): string {
```

For each run it prints the ID, status (padded to a fixed width), and start/finish timestamps; runs that are still active show `(running)` as the finish timestamp. An empty list produces `(none)`.

## Exit code derivation

<!-- lw:anchors packages/cli/src/commands/batch.ts#setExitCode -->

The `setExitCode` function maps a run status string to the process exit code. It takes the repository root (used only for context), the run status, and a JSON flag, returning `void`.

```ts
function setExitCode(repoRoot: string, status: string, json: boolean): void {
```

When the JSON flag is set, it returns early and leaves the exit code at 0 — structured output is always considered a success at the process level. Otherwise, it maps the status directly: `"completed"` sets exit code 0, `"completed_with_failures"` sets 1, and `"aborted"` sets 2 (reflecting the circuit breaker). Any other status leaves the exit code unchanged. The `repoRoot` parameter is accepted for call-site symmetry but is not used inside the function; all call sites invoke this as their final action-handler statement so Node can drain pending I/O before the process exits.