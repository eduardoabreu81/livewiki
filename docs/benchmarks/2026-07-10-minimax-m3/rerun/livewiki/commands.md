---
title: commands
owner: generated
anchors:
  - packages/cli/src/commands/batch.ts#registerBatch
  - packages/cli/src/commands/batch.ts#formatStatusHuman
  - packages/cli/src/commands/batch.ts#formatResultHuman
  - packages/cli/src/commands/batch.ts#formatListHuman
  - packages/cli/src/commands/batch.ts#setExitCode
  - packages/cli/src/commands/export.ts#registerExport
  - packages/cli/src/commands/index-cmd.ts#registerIndex
  - packages/cli/src/commands/index-cmd.ts#collectIgnore
  - packages/cli/src/commands/index-cmd.ts#emit
  - packages/cli/src/commands/index-cmd.ts#formatLedgerHuman
  - packages/cli/src/commands/init.ts#registerInit
  - packages/cli/src/commands/init.ts#formatHuman
  - packages/cli/src/commands/pointer.ts#registerPointer
  - packages/cli/src/commands/pointer.ts#promptYesNo
  - packages/cli/src/commands/pointer.ts#formatPointerResult
  - packages/cli/src/commands/pointer.ts#formatStatusHuman
  - packages/cli/src/commands/pointer.ts#_internal
  - packages/cli/src/commands/serve.ts#registerServe
  - packages/cli/src/commands/status.ts#registerStatus
  - packages/cli/src/commands/stub.ts#makeStubAction
  - packages/cli/src/commands/update.ts#registerUpdate
  - packages/cli/src/commands/update.ts#formatHuman
  - packages/cli/src/commands/verify.ts#registerVerify
  - packages/cli/src/commands/view.ts#registerView
---

# commands

CLI command registrations for the `livewiki` binary. Each module exports a
`registerX(program: Command): void` that wires a subcommand to its handler.
All commands honor the global `--json` and `--repo` flags through
`command.optsWithGlobals()`.

Error handling convention (post `FIX L (rev2)`): handlers use
`process.exitCode = 1` instead of `process.exit(1)` so the event loop can
drain open async handles (fetch, SQLite WAL, file watchers) before exit —
avoids libuv `STATUS_STACK_BUFFER_OVERRUN` (0xC0000409) on Windows.

## batch — Phase 3 orchestrator (`packages/cli/src/commands/batch.ts`)

Runs / resumes / inspects a full-documentation batch. Subcommands:

- `batch status [<runId>]` (default) — run report
- `batch resume <runId>` — continue pending/failed tasks
- `batch --only <target> <runId>` — re-run a single task
- `batch list` — list runs

Exit codes:

- `0` = completed (success)
- `1` = completed_with_failures
- `2` = aborted (circuit breaker)
- `--json` always exits `0` (structured output)

Flags: `--only <target>` re-runs a single task; `--no-refine` skips LLM
refinement of stage 2.

### <a id="packages/cli/src/commands/batch.ts#registerBatch"></a>registerBatch

```ts
export function registerBatch(program: Command): void
```

Wires the `batch` subcommand. Dispatches on positional `args[0]`:

- no args → `buildStatusReport(absRoot)` for the last run.
- `list` → `listRuns(absRoot)`.
- `status [runId]` → `buildStatusReport(absRoot, runId)`.
- `resume <runId>` → `resumeBatch({ repoRoot, noRefine? })`.
- `--only <target>` with a numeric positional → `runOnly({ repoRoot, onlyTarget })`.
- numeric positional alone → alias for `status <runId>`.
- anything else → throws an error with usage hint.

All output flows through `emit(json, payload, human)`. Errors are written
to stderr and set `process.exitCode = 1`.

### <a id="packages/cli/src/commands/batch.ts#formatStatusHuman"></a>formatStatusHuman

```ts
function formatStatusHuman(
  report: Awaited<ReturnType<typeof buildStatusReport>>,
): string
```

Renders the run report. **Token-first** (ad87319): tokens are the primary
metric, USD is secondary and silently omitted when no pricing exists.

Layout:

- Header: `run #<id> (<status>)`, started/finished timestamps.
- `Tokens (primary metric):` — totals line and one line per stage.
- `USD (estimated, table as of <date>):` — totals + per-stage lines, each
  showing `(no price)` if the model lacks pricing; if no model has pricing
  at all, prints a single `USD: omitted (no model with pricing …)` line.
- `Per module (tokens):` — one line per module: `name pad-aligned, input +
  output, optional ~$usd`.
- `Failures (n):` — `[code] module: message` followed by `retry: <command>`.

### <a id="packages/cli/src/commands/batch.ts#formatResultHuman"></a>formatResultHuman

```ts
function formatResultHuman(
  result: Awaited<ReturnType<typeof runBatch>>,
): string
```

Renders a run result (returned by `resumeBatch` or `runOnly`). Same
token-first convention. Shows `tasks done: N`, `failures: N`, and a
`circuit breaker: TRIGGERED` line when `circuitBreakerTriggered` is true.
Failures block mirrors `formatStatusHuman`.

### <a id="packages/cli/src/commands/batch.ts#formatListHuman"></a>formatListHuman

```ts
function formatListHuman(runs: Awaited<ReturnType<typeof listRuns>>): string
```

Header `Batch runs:` followed by one line per run:
`#<id>  <status padded>  started <iso>  finished <iso | (running)>`. Empty
list prints `(none)`.

### <a id="packages/cli/src/commands/batch.ts#setExitCode"></a>setExitCode

```ts
function setExitCode(repoRoot: string, status: string, json: boolean): void
```

Maps run status to process exit code:

- `--json` → return immediately (exit `0`).
- `completed` → `process.exit(0)`.
- `completed_with_failures` → `process.exit(1)`.
- `aborted` → `process.exit(2)`.

## export — Phase 6 stub (`packages/cli/src/commands/export.ts`)

`livewiki export <target>` — exports the wiki to a repo-wiki format
(`github-wiki`, `gitlab-wiki`, `generic` / flattened md directory). Optional
`--push <remote>` publishes.

### <a id="packages/cli/src/commands/export.ts#registerExport"></a>registerExport

```ts
export function registerExport(program: Command): void
```

Currently delegates to `makeStubAction({ name: "export", phase: 6, planned:
"one-way transformation: flatten namespace, rewrite links, strip anchor
frontmatter" })`.

## index — Phase 1+2 (`packages/cli/src/commands/index-cmd.ts`)

`(re)indexes` the repo and chains the anchor-ledger. Idempotent and
incremental.

Behavior per SPEC §"CLI commands" (commit 300ad58):

- Missing `.livewiki/` is auto-created **without warning**.
- Missing `livewiki/` emits an info note suggesting `init`.
- Never requires `init` first.
- Phase 2 chains `runLedger` after the indexer.

Flags:

- `--ignore <pattern>` (repeatable) — adds patterns to the indexer's ignore set.
- `--no-ledger` — skip ledger (index code only).
- `--quiet` — suppress human output without producing JSON. Used by hooks
  (Phase 5) and the post-commit template. Distinct from `--json`.

### <a id="packages/cli/src/commands/index-cmd.ts#registerIndex"></a>registerIndex

```ts
export function registerIndex(program: Command): void
```

Runs `runIndexer(repoRoot, { extraIgnores?, quiet })`, then if
`opts.ledger !== false` runs `runLedger(repoRoot, { quiet })`. `quiet` is
`json || quiet`. On error writes to stderr and calls `process.exit(1)`
(legacy; FIXME candidate for `process.exitCode = 1`).

### <a id="packages/cli/src/commands/index-cmd.ts#collectIgnore"></a>collectIgnore

```ts
function collectIgnore(value: string, previous: string[]): string[]
```

Commander parser accumulator for repeatable `--ignore <pattern>`: returns
`previous.concat(value)`.

### <a id="packages/cli/src/commands/index-cmd.ts#emit"></a>emit

```ts
function emit(
  json: boolean,
  quiet: boolean,
  indexResult: IndexResult,
  ledgerResult: LedgerResult | null,
): void
```

Output dispatcher:

- `quiet && !json` → return (no stdout; stderr still carries errors).
- `json` → `JSON.stringify({ ok: true, index, ledger }) + "\n"`.
- else → `formatIndexHuman(indexResult) + "\n"` followed by
  `formatLedgerHuman(ledgerResult) + "\n"` when present.

### <a id="packages/cli/src/commands/index-cmd.ts#formatLedgerHuman"></a>formatLedgerHuman

```ts
function formatLedgerHuman(r: LedgerResult): string
```

Header `livewiki ledger: OK`, then per line:

- `pages: <processed> processed, <skipped> skipped`
- `anchors: <n> upsert`
- `debt: +<changed> changed +<moved> moved +<deleted> deleted`
- `undocumented: <n>`
- optional `moved pairs:` block listing `from → to`.

## init — Phase 3 (`packages/cli/src/commands/init.ts`)

`livewiki init` — creates `livewiki/` + `.livewiki/`, indexes, generates
deterministic layout (quickstart + diagrams + manifest). No LLM in base
mode.

Flags:

- `--batch` — triggers the full LLM pipeline (stages 1–4).
- `--plan` — shows the module plan (heuristic, NO LLM, no writes).
- `--no-refine` — skips LLM refinement of stage 2 (only with `--batch`).

Exit codes mirror `batch`: `0` success, `1`/`2` from `batchExitCode` when
`--batch` was used (propagated via `process.exitCode`; `--json` always
preserves `0`).

### <a id="packages/cli/src/commands/init.ts#registerInit"></a>registerInit

```ts
export function registerInit(program: Command): void
```

Calls `runInit({ repoRoot, batch?, plan?, noRefine?, quiet: json })`,
forwards to `emit(json, payload, formatHuman(result))`. When
`!json && result.batchExitCode !== undefined`, sets
`process.exitCode = result.batchExitCode`. Errors set
`process.exitCode = 1` (FIX L rev2).

### <a id="packages/cli/src/commands/init.ts#formatHuman"></a>formatHuman

```ts
function formatHuman(result: {
  plan?: InitPlanReport;
  filesWritten: string[];
  batchSummary?: {
    runId: number;
    status: string;
    tasksDone: number;
    tasksFailed: number;
  };
  batchExitCode?: 0 | 1 | 2;
}): string
```

Two branches:

- **Plan mode (`result.plan`)** — `livewiki init --plan (no writes, no LLM):`
  followed by modules count, files count, symbols count, edges count, and
  the ordered list `id (N files, M symbols)`.
- **Write mode** — `livewiki init: OK` with `files written: N` and one
  path per line. If `batchSummary`, adds `batch run #<id>: <status>` and
  `tasks: <done> done, <failed> failed`, plus optional `exit code: <n>`.

## pointer — Phase 5 opt-in (`packages/cli/src/commands/pointer.ts`)

Manages the `livewiki` pointer block in `AGENTS.md` / `CLAUDE.md`. **Never
automatic** — Inviolable rule #2 (SPEC). The command only writes when
explicitly flagged (`--write-pointer` / `--yes`) or after an interactive
y/N confirmation on a TTY.

Flags:

- `--write-pointer` — write the block (skips confirmation).
- `--yes` — alias for `--write-pointer`.
- `--remove` — remove the block instead of inserting.
- `--file <name>` — force `AGENTS.md` or `CLAUDE.md` (default: auto-detect).
- `--block <text>` — custom block content (default: `buildPointerBlock()`).

### <a id="packages/cli/src/commands/pointer.ts#registerPointer"></a>registerPointer

```ts
export function registerPointer(program: Command): void
```

Modes dispatched in order:

1. `--remove`:
   - With `--write-pointer` / `--yes` → calls `removePointer(repoRoot, { file? })`.
   - TTY without explicit flag → prompts; on cancel emits `{ ok: false, cancelled: true }`.
   - Non-TTY without explicit flag → fail closed (`exitCode = 1`).
2. `--write-pointer` / `--yes` → writes (no prompt).
3. TTY, no flag, no `--remove`:
   - If `readPointerStatus().present` → emits status and returns.
   - Else prompts to add the block, showing the block that will be added.
4. Non-TTY, no flag → fail closed (never automatic).

Write path: `insertPointer(repoRoot, { file?, block? })`. All operations
emit JSON or human output through `emit(json, payload, human)`. Errors set
`process.exitCode = 1`.

### <a id="packages/cli/src/commands/pointer.ts#promptYesNo"></a>promptYesNo

```ts
async function promptYesNo(question: string): Promise<boolean>
```

Writes `question` to stdout and reads one line from stdin. Accepts `y`,
`yes` (case-insensitive, trimmed) as truthy. Returns `false` for any other
input or empty line.

### <a id="packages/cli/src/commands/pointer.ts#formatPointerResult"></a>formatPointerResult

```ts
function formatPointerResult(
  result: { file: PointerFile; action: string; bytesWritten: number },
  verb: "wrote" | "removed",
): string
```

First line: `livewiki pointer: <verb-past> <file>` where `verb-past` is
computed from `result.action`:

- `verb = "wrote"`: `inserted` → `wrote`, `replaced` → `updated`, else
  `unchanged`.
- `verb = "removed"`: always `removed`.

Second line (when `bytesWritten !== 0`): `(<±N> bytes)` with explicit sign.

### <a id="packages/cli/src/commands/pointer.ts#formatStatusHuman"></a>formatStatusHuman

```ts
function formatStatusHuman(status: {
  present: boolean;
  file: PointerFile | null;
  inner?: string;
}): string
```

- Not present: `livewiki pointer: not present (run with --write-pointer to add)`.
- Present: `livewiki pointer: present in <file>` followed by the block
  fenced between `---` markers.

### <a id="packages/cli/src/commands/pointer.ts#_internal"></a>_internal

```ts
export const _internal = { nodeFs };
```

Re-exports `node:fs/promises` for tests. Not exposed to userspace.

## serve — Phase 4 stub (`packages/cli/src/commands/serve.ts`)

`livewiki serve` — starts the MCP server on stdio.

### <a id="packages/cli/src/commands/serve.ts#registerServe"></a>registerServe

```ts
export function registerServe(program: Command): void
```

Deleg