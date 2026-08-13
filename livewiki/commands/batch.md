---
title: "livewiki batch command — run, resume, and inspect Phase 3 batches"
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

# livewiki batch command

This page documents the `livewiki batch` CLI subcommand: it runs, resumes, inspects, and lists Phase 3 documentation-generation batches.

## When to use this page

- **Register the `batch` subcommand** on the root `livewiki` Commander program and route its subcommands (`status`, `resume`, `--only`, `list`, or implicit `<runId>`).
- **Render human-readable status and result reports** for a batch run, including tokens, estimated USD, failures with retry commands, and degraded-page recovery notes.
- **Map a batch run's terminal status string to a process exit code** (`completed` → 0, `completed_with_failures` → 1, `aborted` → 2) while honoring `--json`.
- **Surface compact per-attempt diagnostic history** for stage-4 failures so operators can correlate CLI output with the persisted checkpoint `error.message`.

## How it fits

`packages/cli/src/commands/batch.ts` is the Phase 3 entry point inside the `packages/cli` surface. It registers a single `batch` command on the root Commander `program` and delegates the actual work to two core modules: `@livewiki/core/batch` owns the long-running actions (`runBatch`, `resumeBatch`, `runOnly`), and `@livewiki/core/batch-status` owns the read-only actions (`buildStatusReport`, `listRuns`). All structured output is funneled through `emit()` from `../output.js` so a single call site produces both the JSON payload and its human counterpart, and the file also owns the small formatting helpers that turn a status/result/list payload into the text shown when `--json` is *not* set, plus a one-line exit-code mapper.

In the wider CLI architecture this module sits between the root program in `cli.ts` and the core batch engines. The root program calls `registerBatch` once during boot; every batch-shaped user request then enters the action handler, resolves the repo root, and routes to either the run/resume/runOnly engines or the status/list reports. Because `emit()` is the only output sink, swapping `--json` on or off changes presentation without touching the dispatch logic. The exit-code mapper closes the loop: it reads the terminal `status` string that the engines return, translates it into `process.exitCode`, and lets Node finish pending I/O before the process actually ends — which keeps Windows libuv handles from being torn down mid-write. In short, `commands/batch.ts` is the thin CLI adapter that turns engine results into a stable, scriptable surface.

## Diagram

```mermaid
%% livewiki/diagrams/commands-batch.mmd
```

## Command registration and dispatch

<!-- lw:anchors packages/cli/src/commands/batch.ts#registerBatch -->

`registerBatch` is the single exported hook that the CLI's root program calls to attach the `batch` subcommand tree. Its signature is:

```ts
export function registerBatch(program: Command): void
```

It takes the Commander root `program` and returns nothing; it mutates `program` by adding a `batch` command with three options (`--only`, `--no-refine`, `--concurrency`) and one action handler that performs all subcommand dispatch.

The action handler first resolves the absolute repo root (`resolveRepoRoot(opts.repo)` plus `path.resolve(process.cwd(), repoRoot)`), parses `concurrency` to a number if provided, and then branches on positional `args` and the `--only` flag. The branches, in source order, are:

1. `args.length === 0 && !opts.only` — implicit `batch status` of the last run. Calls `buildStatusReport(absRoot)`, emits JSON or human output, and sets the exit code.
2. `sub === "list"` — calls `listRuns(absRoot)`, emits, and returns without touching `setExitCode` (list is informational).
3. `sub === "status"` — same as the implicit case but with an optional numeric `runId`; throws `invalid runId` if the positional arg is non-numeric.
4. `sub === "resume"` — calls `resumeBatch(...)`, forwarding `noRefine: true` only when Commander's negated `--no-refine` produced `opts.refine === false`, and forwarding `concurrency` only when the user set it. Throws a usage error if no `runId` is given.
5. `opts.only` — calls `runOnly(...)` with the requested target. The `runId` positional is accepted for symmetry but ignored; `runOnly` always resumes the last run's task.
6. Positional numeric fallback — `batch <runId>` is treated as an alias for `batch status <runId>`.

Any other first arg throws an `unknown subcommand` error that prints a short usage line.

Two side effects of the dispatch deserve attention:

- **Source-comment guard on `--only`:** without an explicit `if (args.length === 0 && !opts.only)` check, `batch --only <target>` with no positional `runId` silently printed status and re-ran nothing (a bug that caused three "rehearsal" status reads in a row).
- **Exit code path:** every terminal branch that reports a run's status finishes with `setExitCode(absRoot, status, json)`. The handler's `try` block wraps everything; the `catch` writes the error to stderr, sets `process.exitCode = 1`, and returns. The source comment explains why a bare `process.exit(1)` is avoided: it can crash libuv on Windows when async handles are still open.

## Human output formatters

<!-- lw:anchors packages/cli/src/commands/batch.ts#formatStatusHuman packages/cli/src/commands/batch.ts#formatResultHuman packages/cli/src/commands/batch.ts#formatListHuman packages/cli/src/commands/batch.ts#USAGE_INCOMPLETE_NOTE -->

The four formatters below turn structured reports into the text shown when `--json` is absent. They share a "tokens first, USD second" layout and embed `USAGE_INCOMPLETE_NOTE` whenever totals are partial.

### formatStatusHuman

```ts
export function formatStatusHuman(report: Awaited<ReturnType<typeof buildStatusReport>>): string
```

Takes a status report (same shape `buildStatusReport` returns) and returns a multi-line string. It prints a header with run id and status, start/finish timestamps, and an authoritative `tasks: <done>, <failed>` line drawn from `report.run.summary` — explicitly *not* from `report.byModule.length`, which is scoped to stage 4 and previously disagreed with the run's own end-of-run tally.

It then renders a "Tokens (primary metric)" block (total plus per-stage breakdown, plus `USAGE_INCOMPLETE_NOTE` when `usageIncomplete` is set), followed by a "USD (estimated)" block that is either omitted or marked `(no price)` when the model has no pricing entry. A "Per module (tokens)" block follows if any modules are present.

For failures, it lists each entry as `[code] module: message`, and — for `f.stage === 4` — calls `appendStage4Diagnostics` to attach a compact per-attempt sequence under `    attempts:`. Each failure ends with a `retry: <command>` line.

### formatResultHuman

```ts
export function formatResultHuman(result: Awaited<ReturnType<typeof runBatch>>): string
```

Takes a run result (same shape `runBatch` returns) and returns a multi-line summary. It prints tokens (with `USAGE_INCOMPLETE_NOTE` when partial), an "estimated" USD line when pricing is available, and uses the authoritative `result.tasksDone` and `result.failures.length` counters instead of `byModule.length`.

The formatter is also the place where several "never-silent" signals are surfaced: degraded pages under the relaxed contract (count, never a failure), a `circuit breaker: TRIGGERED` line, preserved human/mixed/unparseable flows hub and auxiliary/topics hub entries, deterministic pre-LLM flow-skipped candidates, stale generated pages removed by repartition cleanup, and an exhausted topic plan that is treated as optional/additive rather than as a batch failure. Each entry that needs operator action prints its own `retry:` line.

### formatListHuman

```ts
function formatListHuman(runs: Awaited<ReturnType<typeof listRuns>>): string
```

Takes the array returned by `listRuns` and returns one summary line per run (id, status, started ISO, finished ISO or `(running)`). When the array is empty it returns the literal string `Batch runs:\n  (none)` instead of producing an empty header.

### USAGE_INCOMPLETE_NOTE

```ts
export const USAGE_INCOMPLETE_NOTE =
  "Note: totals are incomplete — some attempts have unknown usage. Prefer proxy/provider billing for wire cost.";
```

A shared string constant exported so both `formatStatusHuman` and `formatResultHuman` can paste the exact same disclaimer under their token totals whenever the report flags `usageIncomplete`.

## Stage-4 diagnostic rendering

<!-- lw:anchors packages/cli/src/commands/batch.ts#appendStage4Diagnostics packages/cli/src/commands/batch.ts#formatDiagnosticLine -->

These two helpers implement the "B2" compact per-attempt sequence that appears in `batch status` output for failed stage-4 tasks. They mirror the format `repair_exhausted` uses inside `core/batch.ts`, so the CLI output and the persisted checkpoint `error.message` agree on shape.

### formatDiagnosticLine

```ts
function formatDiagnosticLine(d: {
  attempt: number;
  stopReason?: string;
  outcome: string;
  errors: Array<{ code: string }>;
}): string
```

Takes one diagnostic entry (an attempt number, an optional LLM `stopReason`, an `outcome` string, and a list of error objects each with a `code`) and returns a single string of the form:

```
attempt <n>: <stopReason> -> <outcome>[, code1, code2, ...]
```

Two details are worth knowing:

- **`stopReason` fallback:** when the LLM did not provide one (e.g. `llm_error` outcomes), it is rendered as the literal `"-"` so the column stays aligned.
- **Code deduplication:** `error.code` values are de-duplicated, but the *first-seen order* is preserved so a reader can match codes against the validator enumeration without surprises.

The bracketed `[code1, code2, ...]` suffix is omitted entirely when the entry carries no errors.

### appendStage4Diagnostics

```ts
function appendStage4Diagnostics(
  lines: string[],
  report: Awaited<ReturnType<typeof buildStatusReport>>,
  failureTaskId: number,
): void
```

Takes the line accumulator, the full status report, and the failing task's `taskId`, and mutates `lines` in place by pushing a header (`    attempts:`) and one `formatDiagnosticLine(d)` per entry in `task.diagnosticHistory`. It is intentionally silent — it returns without touching `lines` — when:

- the report has no matching task, or
- the task has no `diagnosticHistory`, or
- `diagnosticHistory` is empty.

Those silent-fallback cases cover the two real-world scenarios named in the source comment: checkpoints written before diagnostics existed (CONTRACT I5), and tasks that never reached the LLM (e.g. `refused_human_page`).

## Exit-code mapping

<!-- lw:anchors packages/cli/src/commands/batch.ts#setExitCode -->

```ts
function setExitCode(repoRoot: string, status: string, json: boolean): void
```

Takes the resolved repo root (currently unused inside the body but kept in the signature so callers don't have to thread a different value), the run's terminal `status` string, and the `json` flag, and sets `process.exitCode` to one of three values:

- `0` when `status === "completed"`,
- `1` when `status === "completed_with_failures"`,
- `2` when `status === "aborted"`.

The `json` flag short-circuits all three assignments — `--json` always exits 0 so structured pipelines can rely on the JSON payload, not the numeric code, for run state. The source comment notes that this is invoked as the *final* statement of each action handler; assigning `process.exitCode` instead of calling `process.exit` lets Node drain pending I/O before the process actually terminates, which is the same Windows-libuv hazard called out in the catch branch of `registerBatch`.