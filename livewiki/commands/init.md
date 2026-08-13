---
title: "`livewiki init` command"
owner: generated
anchors:
  - packages/cli/src/commands/init.ts#formatHuman
  - packages/cli/src/commands/init.ts#registerInit
---

# `livewiki init` command

The `livewiki init` command is the CLI entry point that provisions a repository's livewiki directories, indexes the source tree, and (optionally) drives the full LLM documentation pipeline.

## When to use this page

- **Wire the `init` subcommand into a Commander program** and understand the option surface it accepts.
- **Format the human-readable output** of an `init` run, including skip notices and batch summaries.
- **Diagnose exit-code and skip-behaviour** decisions that differ between `--json`, `--batch`, and plan-only runs.

## How it fits

`packages/cli/src/commands/init.ts` is a thin CLI adapter that lives inside the `packages/cli/` wrapper. It registers the `init` subcommand on the top-level Commander `program` and delegates the actual work to `runInit` from `@livewiki/core/init`. The file also owns the human-readable formatter (`formatHuman`) that prints the result when the user did not request JSON output, and it normalises Commander's boolean flags (notably `--no-refine`) into the shape that `runInit` expects. Downstream, `runInit` decides which plan files, hub pages, and batch results come back; this file only shapes the call and the output.

## Diagram

```mermaid
%% livewiki/diagrams/commands-init.mmd
```

## Command registration

<!-- lw:anchors packages/cli/src/commands/init.ts#registerInit -->

`registerInit` is the single registration function exported by this file. It attaches the `init` subcommand to the supplied `program` and wires the flag parser that the rest of the file relies on.

```ts
export function registerInit(program: Command): void {
```

The function takes a Commander `program` and returns nothing; its job is to extend the program with the `init` subcommand plus its `--batch`, `--plan`, `--no-refine`, and `--concurrency` options. The action handler then resolves the user options, calls `runInit`, and emits either JSON or the human formatter.

The flag parser is intentionally narrow:

- `--batch` switches the run into the full LLM pipeline (stages 1–4) instead of the deterministic layout.
- `--plan` requests a heuristic module plan with no LLM calls and no file writes.
- `--no-refine` is declared as a Commander `--no-<flag>` option, which means the property on the parsed options is `refine` (default `true`). The handler therefore checks `opts.refine === false` to derive `noRefine`; the property `noRefine` is never set by Commander and reading it would silently disable the wrong branch.
- `--concurrency <n>` is captured as a string and forwarded as `batchConcurrency` only when explicitly provided; the core validates that it is an integer in `1..16`.

After the run completes, the handler builds a payload object containing the plan, the list of written files, the optional batch summary and exit code, and any skip notices (flows hub, auxiliary hub, topics hub, flow candidates, topic plan). It hands that payload plus the string from `formatHuman` to `emit`, which picks the JSON or human branch. The handler then propagates the batch exit code to `process.exitCode` only when `--json` is off and `batchExitCode` is defined; JSON mode keeps exit `0` to match batch CLI conventions, and a non-batch run always exits `0`.

The error path catches any thrown `runInit` failure, writes a single line to stderr, and sets `process.exitCode = 1` instead of calling `process.exit(1)`. Setting `exitCode` lets the event loop drain before the process exits, which avoids a libuv `STATUS_STACK_BUFFER_OVERRUN` (exit code `-1073740791` on Windows) that abrupt exits can trigger when Node still has async handles in flight (for example an in-flight fetch, a SQLite WAL, or a watcher). The handler then returns from the action rather than re-throwing.

## Human output formatting

<!-- lw:anchors packages/cli/src/commands/init.ts#formatHuman -->

`formatHuman` turns the result object returned by `runInit` into the multi-line string that the CLI prints when `--json` is not set. Its signature accepts every optional field the action handler may forward, including the type of `batchExitCode` as a literal `0 | 1 | 2` union.

```ts
function formatHuman(result: { plan?: InitPlanReport; filesWritten: string[]; batchSummary?: { runId: number; status: string; tasksDone: number; tasksFailed: number }; batchExitCode?: 0 | 1 | 2; skippedFlowsHub?: { path: string; owner: "human" | "mixed" | null }; skippedAuxiliaryHub?: { path: string; owner: "human" | "mixed" | null }; skippedTopicsHub?: { path: string; owner: "human" | "mixed" | null }; skippedFlowCandidates?: Array<{ slug: string; code: string; message: string }>; skippedTopicPlan?: { reason: string; retryCommand: string } }): string {
```

The function takes the result bundle from `runInit` and returns a single newline-joined string ready for stdout. It discriminates the two top-level shapes by branch, then appends the skip notices and the batch summary.

The function runs in two shapes:

- **Plan-only run** — when `result.plan` is present, the formatter prints `livewiki init --plan (no writes, no LLM):` followed by totals (modules, files, symbols, edges) and the prioritised module list, then returns immediately. No files-written or skip lines are emitted in this branch.
- **Real run** — when `result.plan` is absent, the formatter prints `livewiki init: OK`, the count of files written, and one indented line per path.

Skip notices are never silent:

- A preserved human/mixed flows hub, auxiliary hub, or topics hub prints a `preserved (owner: ...)` line that names the on-disk path that was not overwritten; the owner falls back to `"unknown"` when `null`.
- Each skipped flow candidate prints a `flow skipped: <slug> (<code>) — <message>` line so deterministically pre-LLM skip decisions are visible.
- An exhausted topic plan prints `topics skipped: <reason>` followed by an indented `retry: <retryCommand>` line; this is treated as optional/additive information, not a batch failure.

Finally, when `result.batchSummary` is present, the formatter appends a blank line, the run id and status, the `tasksDone` / `tasksFailed` counts, and — if `batchExitCode` is defined — the exit code line. The `batchExitCode` is what the registration handler may then propagate to `process.exitCode` for the non-JSON path.