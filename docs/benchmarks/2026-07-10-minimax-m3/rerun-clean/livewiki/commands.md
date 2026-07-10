---
title: CLI commands
owner: generated
anchors:
  - packages/cli/src/commands/batch.ts#formatListHuman
  - packages/cli/src/commands/batch.ts#formatResultHuman
  - packages/cli/src/commands/batch.ts#formatStatusHuman
  - packages/cli/src/commands/batch.ts#registerBatch
  - packages/cli/src/commands/batch.ts#setExitCode
  - packages/cli/src/commands/export.ts#registerExport
  - packages/cli/src/commands/index-cmd.ts#collectIgnore
  - packages/cli/src/commands/index-cmd.ts#emit
  - packages/cli/src/commands/index-cmd.ts#formatLedgerHuman
  - packages/cli/src/commands/index-cmd.ts#registerIndex
  - packages/cli/src/commands/init.ts#formatHuman
  - packages/cli/src/commands/init.ts#registerInit
  - packages/cli/src/commands/pointer.ts#_internal
  - packages/cli/src/commands/pointer.ts#formatPointerResult
  - packages/cli/src/commands/pointer.ts#formatStatusHuman
  - packages/cli/src/commands/pointer.ts#promptYesNo
  - packages/cli/src/commands/pointer.ts#registerPointer
  - packages/cli/src/commands/serve.ts#registerServe
  - packages/cli/src/commands/status.ts#registerStatus
  - packages/cli/src/commands/stub.ts#makeStubAction
  - packages/cli/src/commands/update.ts#formatHuman
  - packages/cli/src/commands/update.ts#registerUpdate
  - packages/cli/src/commands/verify.ts#registerVerify
  - packages/cli/src/commands/view.ts#registerView
---

# CLI commands

The `commands` module wires Commander.js subcommands into `livewiki`. Each
file in `packages/cli/src/commands/` registers one user-facing command (or a
small family of related subcommands) onto the root `Command` instance, then
delegates the actual work to `@livewiki/core/*`. A shared `makeStubAction`
helper builds the Phase-0 placeholders (`export`, `serve`, `view`); once a
phase ships, the caller replaces the stub with the real handler, keeping the
`(cmd: Command) => Promise<void>` signature.

Most commands share a common contract:

- `--json` (global) → emit a structured payload, exit 0.
- human mode → emit a multi-line, scannable report and propagate a status
  exit code.
- `--repo <dir>` (global) → pick a non-CWD repository.
- failures go to **stderr**; results to **stdout**; process exit code is
  set via `process.exitCode` (not `process.exit`) so Node can drain
  in-flight async handles (libuv `STATUS_STACK_BUFFER_OVERRUN`
  mitigation — see `init.ts` and `update.ts` for the rationale).

## batch (Phase 3)

`packages/cli/src/commands/batch.ts` registers the `livewiki batch` family:
run/resume/inspect a full-documentation batch.

### Subcommands and exit codes

- `batch status [<runId>]` (default with no args) — show the run report.
- `batch resume <runId>` — continue pending/failed tasks.
- `batch --only <target> <runId>` — re-run a single task (module or
  task-id).
- `batch list` — list known runs.

Exit codes (set by `setExitCode`):

- `0` — `completed`
- `1` — `completed_with_failures`
- `2` — `aborted` (circuit breaker)

### Flags

- `--only <target>` — re-run one task (module or task-id).
- `--no-refine` — skip LLM refinement of stage 2.

### `#packages/cli/src/commands/batch.ts#registerBatch`

`registerBatch(program)` attaches the `batch` command to Commander and
dispatches on the first positional argument: empty → status of the last
run; `list`; `status [runId]`; `resume <runId>`; `--only <target>`;
otherwise treats the arg as a numeric `runId` (alias for `status`).
On parse/runtime errors, writes to stderr and uses `process.exitCode = 1`
(no abrupt `process.exit`).

### `#packages/cli/src/commands/batch.ts#formatStatusHuman`

`formatStatusHuman(report)` renders the run report with a **token-first**
layout (ad87319): tokens are the primary metric, USD is a secondary
"estimated" block that is silently omitted when no model has pricing.
Sections: header + timestamps; "Tokens (primary metric)" with totals and
per-stage breakdown; "USD (estimated, table as of <date>)" or an explicit
"omitted" line; optional per-module lines; failures with retry commands.

### `#packages/cli/src/commands/batch.ts#formatResultHuman`

`formatResultHuman(result)` is the resume/write-runner counterpart: a
token-first line, optional `USD (estimated)` or "omitted" line, tasks
done/failed counts, an optional `circuit breaker: TRIGGERED` line, and a
failures block with retry commands.

### `#packages/cli/src/commands/batch.ts#formatListHuman`

`formatListHuman(runs)` lists runs as `#<id>  <status>  started <iso>  finished <iso|(running)>`. Returns `(none)` when there are no runs.

### `#packages/cli/src/commands/batch.ts#setExitCode`

`setExitCode(repoRoot, status, json)` maps the status string to a process
exit code. When `--json` is set, the function is a no-op so structured
output always exits `0` (batch CLI convention).

## export (Phase 6, stub)

`packages/cli/src/commands/export.ts` registers the `livewiki export
<target>` command. Phase-0 stub via `makeStubAction`. Real implementation
in Phase 6 will transform the wiki into a repository-wiki format
(`github-wiki` / `gitlab-wiki` / generic flattened md directory) and
optionally push via `--push <remote>`.

### `#packages/cli/src/commands/export.ts#registerExport`

`registerExport(program)` attaches `export <target>` with a single option
`--push <remote>`. Until Phase 6 it reports itself as a stub (`ok: false`)
with the planned transformation described in the `planned` field.

## index (Phase 1 + 2)

`packages/cli/src/commands/index-cmd.ts` registers `livewiki index`, which
(re)indexes the repo and syncs the anchor ledger. Idempotent and
incremental: missing `.livewiki/` is auto-created **without warning**
(commit 300ad58); if `livewiki/` is also missing, emits an info note
suggesting `init`. Phase 2 chains `runLedger` after `runIndexer` so the
same invocation re-detects changed/moved/deleted anchors.

### Flags

- `--ignore <pattern>` — repeatable; appended to the default ignore
  list. Parsed via `collectIgnore`.
- `--no-ledger` — index code only, skip ledger.
- `--quiet` — suppress human output **without** producing JSON. Used by
  hooks (Phase 5) and the post-commit template. Distinct from `--json`.

### `#packages/cli/src/commands/index-cmd.ts#registerIndex`

`registerIndex(program)` attaches the `index` command. It reads
`optsWithGlobals()` (commander 12 does not pass globals through the action's
first arg), then either calls `runIndexer` only or chains `runLedger`. The
`emit` helper decides between JSON, human, and silent modes. Errors go to
stderr with `process.exit(1)` (synchronous failure path).

### `#packages/cli/src/commands/index-cmd.ts#collectIgnore`

`collectIgnore(value, previous)` is a Commander value-collector: returns
`previous.concat(value)`. Used as the parser for `--ignore <pattern>` so
multiple flags accumulate into an array.

### `#packages/cli/src/commands/index-cmd.ts#emit`

`emit(json, quiet, indexResult, ledgerResult)` handles three output
modes:

- `quiet && !json` → nothing on stdout (errors still go to stderr).
- `json` → JSON `{ ok: true, index, ledger }`.
- human → `formatIndexHuman` then, if present, `formatLedgerHuman`.

### `#packages/cli/src/commands/index-cmd.ts#formatLedgerHuman`

`formatLedgerHuman(r)` renders the ledger result: `pages` processed /
skipped, anchors upserted, debt delta (`+changed +moved +deleted`),
undocumented-symbol count, and an optional moved-pairs list (`from → to`).

## init (Phase 3)

`packages/cli/src/commands/init.ts` registers `livewiki init`, which
creates `livewiki/` + `.livewiki/`, indexes, and generates the
deterministic layout (quickstart + diagrams + manifest). No LLM by default.

### Flags

- `--batch` — trigger the full LLM pipeline (stages 1-4).
- `--plan` — show the heuristic module plan, no writes, no LLM.
- `--no-refine` — skip LLM refinement of stage 2 (only meaningful with
  `--batch`).

### Exit codes

- `--json` → always `0` (structured output).
- Without `--batch` → always `0` (base init is a success).
- With `--batch` → propagates the batch exit code (`statusToExitCode`
  in core): `0` success, `1` completed_with_failures, `2` aborted.

### `#packages/cli/src/commands/init.ts#registerInit`

`registerInit(program)` attaches `init` and forwards `batch`, `plan`, and
`noRefine` to `runInit`. The `--plan` branch returns immediately and never
writes. On success the batch exit code is propagated via
`process.exitCode` (not `process.exit`) so the event loop can drain
async handles before exit.

### `#packages/cli/src/commands/init.ts#formatHuman`

`formatHuman(result)` renders two distinct shapes depending on whether
the call came from `--plan`:

- `--plan` → summary (modules, files, symbols, edges) plus an ordered
  (prioritized) module list with file counts and symbol counts.
- otherwise → "init: OK", the list of files written, and an optional
  batch summary block with run id, status, tasks done/failed, and exit
  code.

## pointer (Phase 5)

`packages/cli/src/commands/pointer.ts` manages the optional pointer block
in `AGENTS.md` / `CLAUDE.md`. Implements **Inviolable rule #2**:

> Pointer in `AGENTS.md` / `CLAUDE.md`: only with an explicit flag
> (`--write-pointer`) or interactive confirmation. Never automatic.

### Modes

- no flags → show current status (read-only).
- `--write-pointer` (or `--yes`) → write the block, no prompt.
- no flag + TTY → interactive `y/N` prompt.
- `--remove` → remove the block.
- no flag **and** no TTY (e.g. agent via subprocess) → fail closed; no
  silent writes, ever.

### Flags

- `--write-pointer` — explicit opt-in, skips confirmation.
- `--yes` — alias of `--write-pointer`.
- `--remove` — remove the block instead of inserting.
- `--file <name>` — force `AGENTS.md` or `CLAUDE.md` (default: auto).
- `--block <text>` — custom block content (default: `buildPointerBlock()`).

### `#packages/cli/src/commands/pointer.ts#registerPointer`

`registerPointer(program)` attaches the `pointer` command and routes to
three branches:

1. `--remove` — destructive; prompts on TTY when no explicit flag, else
   requires `--write-pointer` or `--yes` in non-interactive mode.
2. `--write-pointer` / `--yes` (or `wantsWrite = true`) — executes the
   write unconditionally.
3. no flag + TTY — if pointer already present, prints status; otherwise
   shows the block to be added and asks `y/N`.
4. no flag + no TTY → prints the "never automatic" error and sets
   `process.exitCode = 1`.

`--file` values are validated against `POINTER_FILES` (`AGENTS.md`,
`CLAUDE.md`); invalid values fail with a stderr message. Errors set
`process.exitCode = 1`.

### `#packages/cli/src/commands/pointer.ts#promptYesNo`

`promptYesNo(question)` writes `question` to stdout and resolves to
`true` only when the user types `y` or `yes` (case-insensitive). Reads
exactly one line from stdin; listens for both `data` (newline terminates)
and `end` (EOF).

### `#packages/cli/src/commands/pointer.ts#formatPointerResult`

`formatPointerResult(result, verb)` maps the core `result.action`
(`inserted` / `replaced` / `unchanged`) to a friendly past tense (`wrote`
/ `updated` / `unchanged`) and appends a signed byte delta when the byte
count is non-zero.

### `#packages/cli/src/commands/pointer.ts#formatStatusHuman`

`formatStatusHuman(status)` prints either "not present (run with
`--write-pointer` to add)" or "present in <file>" followed by a fenced
code block containing the inner block.

### `#packages/cli/src/commands/pointer.ts#_internal`

Re-exports `nodeFs` for tests as the namespace `_internal`. Not part of
the public surface.

## serve (Phase 4, stub)

`packages/cli/src/commands/serve.ts` registers `livewiki serve`, the MCP
stdio server. Phase-0 stub via `makeStubAction`; real implementation will
expose 6 tools (`livewiki_quickstart`, `livewiki_read`, `livewiki_search`,
`livewiki_debt`, `livewiki_write_doc`, `livewiki_resolve_debt`).

### `#packages/cli/src/commands/serve.ts#registerServe`

`registerServe(program)` attaches `serve` (no positional args, no local
options). Until Phase 4 the stub emits a structured `ok: false` with the
planned tool list.

## status (Phase 1/2)

`packages/cli/src/commands/status.ts` registers `livewiki status`, which
reports open debt, undocumented symbols, and pending batch state.
Phase 1 covers files + symbols; debt + undocumented enter in Phase 2.

### `#packages/cli/src/commands/status.ts#registerStatus`

`registerStatus(program)` attaches `status` and supports:

- `--top <n>` — size of the top list (default 10).

The action uses `optsWithGlobals()` to inherit `--json` / `--repo`, then
emits either the JSON envelope (`{ ok: true, ...report }`) or
`formatStatusHuman(report)`. Errors go to stderr with `process.exit(1)`.

## stub (helper)

`packages/cli/src/commands/stub.ts` provides `makeStubAction`, the
Phase-0 command factory.

### `#packages/cli/src/commands/stub.ts#makeStubAction`

`makeStubAction(info)` returns a Commander action that:

- reads `--json` / `--repo` via `command.optsWithGlobals()`,
- always exits `0` ("command executed — just not implemented yet"),
- emits a structured payload: `{ ok: false, stub, phase, repoRoot,
  message, planned }`,
- emits a one-line human message: `"livewiki <name>: stub (Fase <phase>
  da SPEC). Implementação prevista: <planned>"`.

`StubInfo = { name, phase, planned }` documents the upstream command
name, the SPEC phase number (1-7),