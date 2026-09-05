---
title: Baseline Management Commands
owner: generated
anchors:
- packages/cli/src/commands/baseline.ts#formatStatus
- packages/cli/src/commands/baseline.ts#handle
- packages/cli/src/commands/baseline.ts#registerBaseline
---

# Baseline Management Commands

This page documents the CLI implementation for baseline lifecycle operations, covering subcommand registration, error-safe execution, and human-readable reporting.

## When to use this page

- Understand how the `livewiki baseline` command family is structured and registered.
- Trace how each baseline operation (status, bootstrap, accept, move, remove, relocate) invokes the shared execution and error handling path.
- Learn how human-readable and JSON-formatted output is produced and distinguished.
- Identify the role of the status formatter in rendering repository-portable baseline health.

## How it fits

A "baseline" in livewiki is an explicit, versioned record of evidence that a symbol's documented content matches its current code version. This module is the command-line user interface for baseline lifecycle operations; it sits on top of core functions exported from `@livewiki/core/baseline-operations` and `@livewiki/core/status`. The CLI reads global options (like repository root and JSON output preference), invokes the corresponding core operation function, and formats the result for display or machine consumption. This file lives in the `packages/cli/src/commands/` directory alongside other command definition pages.

## Diagram

```mermaid
%% livewiki/diagrams/commands-baseline.mmd
```

## Command Registration

<!-- lw:anchors packages/cli/src/commands/baseline.ts#registerBaseline -->

`registerBaseline(program: Command): void` is the exported entry point that takes a `commander` `Command` instance and attaches the entire `baseline` command family to it. It creates a `baseline` subcommand with the description "bootstrap, review, and explicitly advance versioned documentation evidence", then defines each of the six subcommands: `status`, `bootstrap`, `accept`, `move`, `remove`, and `relocate`. For each subcommand, it declares the relevant options via chained `.option()` calls (with `.requiredOption()` for mandatory inputs), and wires an action handler. The action handlers read their options — merging them with global options via `command.optsWithGlobals<GlobalOptions>()` — and call `handle`, passing the operation name, whether JSON output is requested, and an asynchronous work function that talks to a core operation module. This structure keeps commander-specific wiring at this level while delegating all real work to the core functions.

## Shared Execution and Error Handling

<!-- lw:anchors packages/cli/src/commands/baseline.ts#handle -->

`async function handle<T>(operation: string, json: boolean, work: () => Promise<{ result: T; human: string }>): Promise<void>` is the shared execution wrapper used by every baseline subcommand. It takes the operation name (for error messages), a boolean telling whether JSON output is requested, and a work function that returns both structured result data and a human-readable string. `handle` runs the work function inside a `try`/`catch` block: on success it calls the output mechanism `emit`, passing the JSON flag, an object with an `ok: true` marker merged with the result data, and the human-readable string. On failure, it extracts the error message, and either emits a JSON failure object (with `ok: false` and the error text) when JSON mode is on, or writes a prefixed error line to standard error; in both failure paths it sets `process.exitCode = 1` to signal to the shell that the command failed. This centralizes the contract that every baseline operation reports results through the same emit/error channels.

## Human-Readable Status Formatting

<!-- lw:anchors packages/cli/src/commands/baseline.ts#formatStatus -->

`function formatStatus(value: { state: string; issues: Array<{ code: string; detail: string }>; repository: { total: number; unbaselined: { total: number }; inferred: { total: number }; removedAnchors: { total: number } } | null }): string` takes a structured status report — the baseline state, an optional repository debt summary, and a list of issue objects — and converts it into a single human-oriented multi-line string. It starts with a line naming the current baseline state; when repository information is present it appends indented lines for total debt, unbaselined entries, inferred entries, and removed anchors; finally it walks the issue array, appending each issue's code and its detail. The function builds the array of text lines one by one and joins them with newlines at the end, giving the CLI a compact, print-ready rendering of baseline health that the `status` subcommand invokes only on the non-JSON path.