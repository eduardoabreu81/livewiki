---
title: commands
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

## batch — registerBatch

<!-- lw:anchors packages/cli/src/commands/batch.ts#registerBatch packages/cli/src/commands/batch.ts#USAGE_INCOMPLETE_NOTE packages/cli/src/commands/batch.ts#setExitCode -->

`registerBatch` wires the `batch` command onto a Commander `program`. It supports subcommands `status` (with optional `<runId>`), `resume <runId>`, `list`, and the `--only <target>` flag (which re-runs a single task against the `<runId>` given as the first positional). With no positional argument, `batch` reports the status of the most recent run. Output is emitted via `emit(json, payload, human)`, and the exit code is set by `setExitCode` based on the run status when `--json` is not in use. Errors are written to stderr and surfaced as `process.exitCode = 1` so Node can drain pending I/O (libuv-friendly).

`USAGE_INCOMPLETE_NOTE` is the shared human-readable string that signals the totals include some attempts whose usage is unknown; it is appended after the token totals in both status and result human output.

`setExitCode(repoRoot, status, json)` maps run status to process exit codes: `completed → 0`, `completed_with_failures → 1`, `aborted → 2`. When `json` is true, the exit code is left untouched so structured output always exits 0.

## batch — diagnostics & human formatters

<!-- lw:anchors packages/cli/src/commands/batch.ts#formatDiagnosticLine packages/cli/src/commands/batch.ts#appendStage4Diagnostics packages/cli/src/commands/batch.ts#formatStatusHuman packages/cli/src/commands/batch.ts#formatResultHuman packages/cli/src/commands/batch.ts#formatListHuman -->

`formatDiagnosticLine` renders one compact line per attempt for stage-4 tasks: `attempt <n>: <stopReason> -> <outcome> [code1, code2]`. It dedupes error codes while preserving first-seen order, and falls back to `-` when `stopReason` is missing.

`appendStage4Diagnostics` is a no-op when the failed task has no `diagnosticHistory` (e.g. pre-CONTRACT I5 checkpoints, or tasks that never reached the LLM such as `refused_human_page`). Otherwise it appends `attempts:` followed by one `formatDiagnosticLine` per attempt.

`formatStatusHuman` builds the multi-section text report: token totals per stage and per module, USD line (estimated) omitted when no pricing is available, and a failures block. For each failure with `stage === 4`, `appendStage4Diagnostics` is invoked against the resolved task to attach the attempt sequence.

`formatResultHuman` produces the post-run summary: token totals, an estimated USD line (or an "unknown/incomplete" / "omitted" variant), counts of tasks done and failures, an optional `circuit breaker: TRIGGERED` line, and a failures block.

`formatListHuman` prints one row per run from `listRuns`, or `(none)` when empty.

## export — registerExport

<!-- lw:anchors packages/cli/src/commands/export.ts#registerExport -->

`registerExport` adds the `export <target>` command. Its body is a Phase-6 stub produced by `makeStubAction` with the planned behavior "one-way transformation: flatten namespace, rewrite links, strip anchor frontmatter". An optional `--push <remote>` flag is declared.

## index-cmd — registerIndex

<!-- lw:anchors packages/cli/src/commands/index-cmd.ts#registerIndex packages/cli/src/commands/index-cmd.ts#collectIgnore packages/cli/src/commands/index-cmd.ts#emit packages/cli/src/commands/index-cmd.ts#formatLedgerHuman -->

`registerIndex` adds the `index` command. It runs the indexer over the resolved repo root and, unless `--no-ledger` is given, also runs the anchor-ledger. Repeated `--ignore <pattern>` values are accumulated by `collectIgnore`. `--quiet` suppresses human output without emitting JSON (used by hooks); `--json` and `--quiet` together produce structured output. The ledger's `quiet` flag is the OR of both so hooks don't spam the terminal.

`collectIgnore(value, previous)` returns `previous.concat(value)` — the standard Commander repeatable-option accumulator.

`emit(json, quiet, indexResult, ledgerResult)` is the output router. When `quiet && !json`, nothing is written. When `json`, both results are serialized as one object. Otherwise, both human formatters are concatenated with newlines.

`formatLedgerHuman` renders a short block summarizing processed/skipped pages, anchors upserted, debt counters (`changed`/`moved`/`deleted`), undocumented symbol count, and any `movedPairs` from the ledger result.

## init — registerInit

<!-- lw:anchors packages/cli/src/commands/init.ts#registerInit packages/cli/src/commands/init.ts#formatHuman -->

`registerInit` adds the `init` command. It accepts `--batch` (run the full LLM pipeline), `--plan` (show the heuristic module plan without LLM or writes), and `--no-refine` (which Commander translates to `opts.refine === false`; the option is then re-mapped to `noRefine: true` for `runInit`). The base init is always exit 0; when `--batch` is used and `--json` is not, the batch exit code is propagated via `process.exitCode`. Errors use `process.exitCode = 1` to avoid the libuv assert that abrupt `process.exit(1)` can trigger with open async handles.

`formatHuman` switches between two layouts based on whether `plan` is present. Plan mode prints module count, files, symbols, edges, and the ordered list. Otherwise it prints the OK header, the list of files written, and — when `--batch` produced a summary — the run id, status, tasks done/failed, and exit code.

## pointer — registerPointer

<!-- lw:anchors packages/cli/src/commands/pointer.ts#registerPointer packages/cli/src/commands/pointer.ts#promptYesNo packages/cli/src/commands/pointer.ts#formatPointerResult packages/cli/src/commands/pointer.ts#formatStatusHuman packages/cli/src/commands/pointer.ts#_internal -->

`registerPointer` adds the `pointer` command (Phase 5). It implements Inviolable Rule #2 — a write to `AGENTS.md`/`CLAUDE.md` only happens via explicit flag or interactive confirmation. Modes:

- No flags: read-only status (or interactive prompt if TTY and not already present).
- `--write-pointer` / `--yes`: write the block, skipping confirmation.
- `--remove`: remove the block; in non-TTY mode this still requires `--write-pointer` / `--yes`.
- `--file <name>`: forces one of `POINTER_FILES`; an invalid value writes to stderr and sets `process.exitCode = 1`.
- `--block <text>`: custom block content (defaults to `buildPointerBlock()`).

`promptYesNo(question)` writes the question to stdout and resolves to `true` only for `y` / `yes` (case-insensitive). It listens for `data` until a newline, then removes listeners and pauses stdin.

`formatPointerResult(result, verb)` renders the write/remove outcome. The verb is reconciled with `result.action`: `inserted → "wrote"`, `replaced → "updated"`, otherwise `"unchanged"` for writes, or `"removed"` for the remove path. A signed-bytes line is appended only when `bytesWritten !== 0`.

`formatStatusHuman(status)` reports `not present` (with a hint to run `--write-pointer`) or `present in <file>` followed by the inner block delimited by `---`.

`_internal` re-exports `{ nodeFs }` for tests only — it is not part of userspace.

## serve — registerServe

<!-- lw:anchors packages/cli/src/commands/serve.ts#registerServe -->

`registerServe` adds the `serve` command as a Phase-4 stub via `makeStubAction`, with the planned MCP-server description (stdio transport, 6 tools: `livewiki_quickstart/read/search/debt/write_doc/resolve_debt`).

## status — registerStatus

<!-- lw:anchors packages/cli/src/commands/status.ts#registerStatus -->

`registerStatus` adds the `status` command. It accepts `--top <n>` (parsed as an integer, default 10) and runs `@livewiki/core/status`. JSON mode serializes the full report; human mode defers to the core's `formatStatusHuman`. Errors set `process.exitCode = 1` without an abrupt exit.

## stub — makeStubAction

<!-- lw:anchors packages/cli/src/commands/stub.ts#makeStubAction -->

`makeStubAction(info)` returns an async Commander action handler used by Phase-0 command stubs. It reads `--json` and `--repo` via `optsWithGlobals`, then emits a payload containing `ok: false`, the stub `name`, the `phase`, the resolved `repoRoot`, a localized message, and the planned description. The human text mirrors the structured payload. Exit code is always 0 (the stub ran; it is just unimplemented).

## update — registerUpdate

<!-- lw:anchors packages/cli/src/commands/update.ts#registerUpdate packages/cli/src/commands/update.ts#formatHuman -->

`registerUpdate` adds the `update` command (Phase 5, incremental mode). It supports three branches:

1. `--record-write <tokens>`: validates the token count (non-negative integer), calls `recordDocWrittenBack` with `bytes = tokens * 4`, and emits a confirmation. No work package is loaded.
2. `--llm`: writes a stderr message explaining that this delegates to the batch orchestrator (full mode) and sets `process.exitCode = 1` — it does not run any pipeline here.
3. Default: loads the work package via `loadWorkPackage` with the (validated, positive) `--snippet-window`, computes an `economy` summary comparing `packageTokens` against an `estimatedFullReadTokens` of 12500, and emits the package alongside the summary.

Errors funnel through `process.exitCode = 1` (no abrupt exit).

`formatHuman` prints the work-package header, `lastDocumentedCommit` (and `pendingBatch` if present), up to five debt entries (with a `+N more` line when truncated), snippet/anchor counts, the estimated tokens and bytes, and the one-line "thesis" line about focused-package economy.

## verify — registerVerify

<!-- lw:anchors packages/cli/src/commands/verify.ts#registerVerify -->

`registerVerify` adds the `verify` command. It runs `@livewiki/core/verify` and emits either the raw JSON result or the human formatter output. When the result's `ok` is false, `process.exitCode` is set to 1 (CI-friendly). Errors use `process.exitCode = 1` so Node can drain the event loop.

## view — registerView

<!-- lw:anchors packages/cli/src/commands/view.ts#registerView -->

`registerView` adds the `view` command as a Phase-7 stub via `makeStubAction`. It declares `--template <name>` (default `agent`) and `--out <dir>` (default `.livewiki/site/`) with the planned behavior "static site with client-side search + Mermaid + templates as data".