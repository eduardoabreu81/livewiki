---
title: CLI command surface (livewiki/commands)
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

# CLI command surface (livewiki/commands)

This page documents the `livewiki` command-line subcommand layer in `packages/cli/src/commands/`, which wires Commander actions to `@livewiki/core/*` modules and to a small shared stub helper.

## When to use this page

- **Add or modify a `livewiki <cmd>`** by editing the matching `registerX(program: Command)` in `packages/cli/src/commands/<cmd>.ts`.
- **Format JSON vs. human output for an existing command** by tracing its `emit(json, payload, formatHuman(...))` call site.
- **Decide exit-code policy (success / completed_with_failures / aborted)** by reading `setExitCode` in `batch.ts` and the explicit `process.exitCode = 1` lines in other commands.
- **Reuse the Phase-0 stub for an unimplemented command** by calling `makeStubAction({ name, phase, planned })` from `stub.ts`.

## How it fits

The files under `packages/cli/src/commands/` are the leaf layer of the CLI: each one exports a `registerX(program: Command): void` that attaches a single subcommand (and any of its sub-subcommands) to the root `livewiki` Commander program. They delegate domain work to packages under `@livewiki/core/*` (e.g. `core/batch`, `core/indexer`, `core/anchor-ledger`, `core/status`, `core/verify`, `core/pointer`, `core/update`, `core/init`) and rely on a small set of shared helpers from `packages/cli/src/cli.ts` (`resolveRepoRoot`) and `packages/cli/src/output.ts` (`emit`).

`stub.ts` is a Phase-0 helper that produces a uniform "this command is planned for phase N" action handler; `serve.ts`, `export.ts`, and `view.ts` are the current callers that wrap it. `init.ts`, `batch.ts`, `index-cmd.ts`, `status.ts`, `pointer.ts`, `update.ts`, and `verify.ts` carry real implementations. Together they form the user-visible surface of the `livewiki` binary, and the formatting functions (`formatStatusHuman`, `formatResultHuman`, `formatListHuman`, `formatHuman`, `formatPointerResult`, `formatStatusHuman` in `pointer.ts`, `formatLedgerHuman`) shape the human-readable text that is emitted alongside the structured JSON.

## batch command

<!-- lw:anchors packages/cli/src/commands/batch.ts#registerBatch packages/cli/src/commands/batch.ts#USAGE_INCOMPLETE_NOTE packages/cli/src/commands/batch.ts#formatDiagnosticLine packages/cli/src/commands/batch.ts#appendStage4Diagnostics packages/cli/src/commands/batch.ts#formatStatusHuman packages/cli/src/commands/batch.ts#formatResultHuman packages/cli/src/commands/batch.ts#formatListHuman packages/cli/src/commands/batch.ts#setExitCode -->

`batch.ts` registers `livewiki batch` (Phase 3) with the action signature `export function registerBatch(program: Command): void` and dispatches based on positional args (`status`, `list`, `resume`, an alias `<runId>`, or `--only <target>`). The action pulls options via `command.optsWithGlobals<BatchOptions & { args?: string[] }>()`, resolves `repoRoot` with `resolveRepoRoot`, and forwards to `buildStatusReport`, `listRuns`, `resumeBatch`, or `runOnly`. `--no-refine` is mapped by Commander to `opts.refine === false` and is translated into `{ noRefine: true }` only when `refine === false`. The catch block writes `livewiki batch: error — <message>` to stderr, sets `process.exitCode = 1` (chosen over `process.exit(1)` so Node can drain pending async handles), and returns.

A shared string `export const USAGE_INCOMPLETE_NOTE = "Note: totals are incomplete — some attempts have unknown usage. Prefer proxy/provider billing for wire cost."` is appended after the tokens line in both `formatStatusHuman` and `formatResultHuman` when `t.usageIncomplete` is set.

`function formatDiagnosticLine(d: { attempt: number; stopReason?: string; outcome: string; errors: Array<{ code: string }> }): string` renders a single line `attempt N: <stopReason> -> <outcome> [<code>, ...]`, falling back to `"-"` for `stopReason` when the LLM did not provide one and deduplicating `errors[].code` while preserving first-seen order. `function appendStage4Diagnostics(lines, report, failureTaskId): void` looks up the failed task by `taskId` and, when `diagnosticHistory` is non-empty (CONTRACT I5: missing on pre-diagnostic checkpoints), appends an `attempts:` block to `lines`; it returns silently when the history is absent or the task never reached the LLM.

`export function formatStatusHuman(report: Awaited<ReturnType<typeof buildStatusReport>>): string` is the token-first human renderer for `batch status`. It prints the run header (`run #N (status)`, `started`, optional `finished`), a `Tokens (primary metric)` block with totals plus per-stage breakdown, a conditional `USAGE_INCOMPLETE_NOTE`, a separate `USD (estimated, table as of <date>)` block (or an `omitted` line when no model has pricing), a `Per module (tokens)` table, and a `Failures (n)` list. For each failure with `stage === 4` it invokes `appendStage4Diagnostics` to attach the per-task attempt sequence before the `retry: <cmd>` line.

`export function formatResultHuman(result: Awaited<ReturnType<typeof runBatch>>): string` mirrors the same token-first approach for a finished `runBatch` result, printing `run #N (status)`, tokens, optional `USAGE_INCOMPLETE_NOTE`, optional `USD (estimated)`, tasks done / failures counts, a `circuit breaker: TRIGGERED` line when set, and a `Failures:` block.

`function formatListHuman(runs: Awaited<ReturnType<typeof listRuns>>): string` emits a `Batch runs:` header followed by `#<id>  <status>  started <iso>  finished <iso|(running)>` per row, or `(none)` when the array is empty.

`function setExitCode(repoRoot: string, status: string, json: boolean): void` is the shared exit-code mapper: when `--json` is set it returns immediately (structured output always exits 0 by CLI convention); otherwise it maps `completed` → 0, `completed_with_failures` → 1, `aborted` → 2, by writing `process.exitCode`. Callers must invoke it as the final statement of the action handler so that Node can drain pending I/O before exit. The excerpt does not establish behavior for status values other than these three; callers that surface them would be a no-op.

## export command

<!-- lw:anchors packages/cli/src/commands/export.ts#registerExport -->

`export.ts` registers `livewiki export <target>` with `export function registerExport(program: Command): void` and attaches a single `--push <remote>` option. The action body is a Phase-6 stub created by `makeStubAction({ name: "export", phase: 6, planned: "one-way transformation: flatten namespace, rewrite links, strip anchor frontmatter" })`, so the visible behavior is whatever `makeStubAction` performs (see `stub.ts` below). The excerpt does not show the real Phase-6 implementation.

## index command

<!-- lw:anchors packages/cli/src/commands/index-cmd.ts#registerIndex packages/cli/src/commands/index-cmd.ts#collectIgnore packages/cli/src/commands/index-cmd.ts#emit packages/cli/src/commands/index-cmd.ts#formatLedgerHuman -->

`index-cmd.ts` registers `livewiki index` with `export function registerIndex(program: Command): void` and supports `--ignore <pattern>` (repeatable), `--no-ledger` (Commander maps this to `ledger: false`), and `--quiet`. The action calls `runIndexer(repoRoot, { extraIgnores?, quiet })` followed by `runLedger(repoRoot, { quiet })` when `opts.ledger !== false`. The `quiet` flag for the core calls is `json || quiet`, so `--json` and `--quiet` both suppress human output but only `--json` produces a JSON payload. On error it writes `livewiki index: error — <message>` to stderr and sets `process.exitCode = 1`.

`function collectIgnore(value: string, previous: string[]): string[]` is the Commander accumulator passed to `.option("--ignore <pattern>", ..., collectIgnore, [])`; it returns `previous.concat(value)`, so repeated `--ignore` flags append into one array.

`function emit(json: boolean, quiet: boolean, indexResult: IndexResult, ledgerResult: LedgerResult | null): void` is the local dispatcher: it returns immediately when `quiet && !json` (hooks want no stdout), emits a `{ ok: true, index, ledger }` JSON line when `json` is set, otherwise writes `formatIndexHuman(indexResult)` followed by `formatLedgerHuman(ledgerResult)` (only when the ledger ran). Stderr continues to carry errors.

`function formatLedgerHuman(r: LedgerResult): string` prints the `livewiki ledger: OK` header, the `pages / anchors upsert / debt` counters (debt formatted as `+changed +moved +deleted`), the undocumented-symbol count, and a `moved pairs:` block when `r.movedPairs` is non-empty.

## init command

<!-- lw:anchors packages/cli/src/commands/init.ts#registerInit packages/cli/src/commands/init.ts#formatHuman -->

`init.ts` registers `livewiki init` with `export function registerInit(program: Command): void` and supports `--batch`, `--plan`, and `--no-refine` (Commander maps the latter to `refine === false`, which `registerInit` translates into `{ noRefine: true }`). The action resolves `repoRoot` through `resolveRepoRoot(opts.repo)` and absolute-izes it, then calls `runInit({ repoRoot, batch?, plan?, noRefine?, quiet: json })`. On success it `emit`s the structured payload and the human formatter, and — when not in `--json` and `result.batchExitCode !== undefined` — sets `process.exitCode = result.batchExitCode` so the batch exit code propagates (`--json` always exits 0 by convention; without `--batch` the base init is success). On error it writes `livewiki init: error — <message>` to stderr and sets `process.exitCode = 1`; the comment in the source explains that `process.exitCode` is used in place of `process.exit(1)` to avoid the libuv `STATUS_STACK_BUFFER_OVERRUN` on Windows when async handles (fetch, SQLite WAL, watcher) are still open.

`function formatHuman(result: { plan?: InitPlanReport; filesWritten: string[]; batchSummary?: { runId: number; status: string; tasksDone: number; tasksFailed: number }; batchExitCode?: 0 | 1 | 2 }): string` branches on `result.plan`: when present it prints the `livewiki init --plan (no writes, no LLM):` header plus `modules / files / symbols / edges` counts and the `Ordered (prioritized):` list (one `id (paths files, symbols symbols)` line each). Otherwise it prints `livewiki init: OK`, the per-file `files written` list, and — when a batch ran — the `batch run #N: <status>`, `tasks: D done, F failed`, and (when defined) `exit code: <0|1|2>` lines.

## pointer command

<!-- lw:anchors packages/cli/src/commands/pointer.ts#registerPointer packages/cli/src/commands/pointer.ts#promptYesNo packages/cli/src/commands/pointer.ts#formatPointerResult packages/cli/src/commands/pointer.ts#formatStatusHuman packages/cli/src/commands/pointer.ts#_internal -->

`pointer.ts` registers `livewiki pointer` with `export function registerPointer(program: Command): void` and supports `--write-pointer`, `--remove`, `--file <name>` (validated against `POINTER_FILES`, which yields `AGENTS.md`/`CLAUDE.md`), `--yes` (alias of `--write-pointer`), and `--block <text>`. The action resolves the repo, validates `--file` (writing `livewiki pointer: --file must be one of ...` to stderr and setting `process.exitCode = 1` on mismatch), and then dispatches by mode. For `--remove` without `--write-pointer`/`--yes`, it asks `promptYesNo` on TTY; in non-TTY without a flag it fails closed with `livewiki pointer --remove: requires --write-pointer (or --yes) in non-interactive mode.` and exits 1. For the write path it emits the read-only status when already present on TTY, otherwise `promptYesNo` to add the block. With `--write-pointer`/`--yes` (or after a confirmed prompt) it calls `insertPointer(repoRoot, { file?, block? })`; with `--remove` it calls `removePointer(repoRoot, { file? })`. Errors are caught and turned into a stderr line plus `process.exitCode = 1`. The CLI never writes outside `livewiki/` automatically — pointer writes to `AGENTS.md`/`CLAUDE.md` are gated by flag or TTY confirmation per Inviolable rule #2.

`async function promptYesNo(question: string): Promise<boolean>` writes `question` to stdout, listens on `process.stdin` for `"data"` (resolves on the first `\n`) and `"end"` (resolves when stdin closes without a newline), and treats the trimmed lowercased input as `true` only when it equals `"y"` or `"yes"`.

`function formatPointerResult(result: { file: PointerFile; action: string; bytesWritten: number }, verb: "wrote" | "removed"): string` emits `livewiki pointer: <verbPast> <file>`, where `verbPast` is mapped from `verb` and `result.action`: for `"wrote"` it becomes `"wrote"` when `action === "inserted"`, `"updated"` when `action === "replaced"`, and `"unchanged"` otherwise; for `"removed"` it is always `"removed"`. When `bytesWritten !== 0` a second line with the signed byte delta is appended.

`function formatStatusHuman(status: { present: boolean; file: PointerFile | null; inner?: string }): string` returns `livewiki pointer: not present (run with --write-pointer to add)` when the block is absent, and `livewiki pointer: present in <file>\n  ---\n<inner>\n  ---` otherwise.

`export const _internal = { nodeFs }` re-exports `nodeFs` for tests; it is not part of the user-facing surface and is intentionally not exposed to userspace.

## serve command

<!-- lw:anchors packages/cli/src/commands/serve.ts#registerServe -->

`serve.ts` registers `livewiki serve` with `export function registerServe(program: Command): void` and attaches no local options. The action body is a Phase-4 stub from `makeStubAction({ name: "serve", phase: 4, planned: "MCP server stdio with 6 tools (livewiki_quickstart/read/search/debt/write_doc/resolve_debt)" })`. The excerpt does not show the real Phase-4 implementation.

## status command

<!-- lw:anchors packages/cli/src/commands/status.ts#registerStatus -->

`status.ts` registers `livewiki status` with `export function registerStatus(program: Command): void` and supports `--top <n>` (default string `"10"`, parsed with `Number.parseInt(opts.top, 10)` and falling back to `10` when `opts.top` is empty). The action resolves `repoRoot` from `opts.repo ?? "."`, calls `runStatus(repoRoot, { topN })`, and — when `--json` is set — writes `{ ok: true, ...report }` to stdout, otherwise writes `formatStatusHuman(report)`. Errors are caught and turned into a stderr line plus `process.exitCode = 1`. The command itself does not set a non-zero exit code on `report.ok === false`; that is the core formatter's concern.

## stub helper

<!-- lw:anchors packages/cli/src/commands/stub.ts#makeStubAction -->

`stub.ts` defines `export interface StubInfo { name: string; phase: number; planned: string }` and exports `export function makeStubAction(info: StubInfo)`. The returned action handler is `async (_options, command) => Promise<void>`; it reads globals via `command.optsWithGlobals<StubOptions>()`, calls `resolveRepoRoot(opts.repo)`, and `emit`s a JSON payload `{ ok: false, stub, phase, repoRoot, message: "stub da Fase 0 — implementação prevista para Fase N", planned }` (or its human form `livewiki <name>: stub (Fase N da SPEC). Implementação prevista: <planned>`) and then returns. The handler does not call `process.exit`; exit code is left at its default (0), which matches the "command executed, just not implemented" contract. `serve.ts`, `export.ts`, and `view.ts` are the call sites in this excerpt.

## update command

<!-- lw:anchors packages/cli/src/commands/update.ts#registerUpdate packages/cli/src/commands/update.ts#formatHuman -->

`update.ts` registers `livewiki update` with `export function registerUpdate(program: Command): void` and supports `--llm`, `--record-write <tokens>`, and `--snippet-window <lines>` (default string `"20"`). The action resolves `repoRoot` and dispatches in three modes. (1) `--record-write`: parses the value with `Number.parseInt`, validates it as a non-negative integer (otherwise writes `livewiki update: --record-write requires a non-negative integer ...` to stderr and exits 1), dynamically imports `recordDocWrittenBack` from `@livewiki/core/update`, estimates bytes as `tokens * 4`, and emits `{ ok: true, recorded: { tokens, bytes } }` plus the human line `recorded N tokens written back (est. B bytes)`. (2) `--llm`: writes a stderr line directing the user to `livewiki batch resume <runId>` or `livewiki init --batch`, sets `process.exitCode = 1`, and returns without calling the API. (3) Default: parses `snippetWindow` (passing `{ snippetWindow }` only when finite and positive), calls `loadWorkPackage(repoRoot, { snippetWindow? })`, computes an `economy` summary against an estimated `12500` full-read tokens, and emits the structured payload plus `formatHuman(pkg)`. Errors are caught and produce a stderr line plus `process.exitCode = 1`; the source comment again prefers `process.exitCode` over `process.exit(1)` to avoid the libuv Windows assert.

`function formatHuman(pkg: Awaited<ReturnType<typeof loadWorkPackage>>): string` prints the `livewiki update — work package:` header, the `lastDocumentedCommit` (or `(none)`), a `pendingBatch: run #N (D/T)` line when `pkg.manifest.pendingBatch` exists, the first five debt items as `[<event>] <symbol_key> (assignee=<a>, wiki=<path>)` followed by `... +N more` when truncated, the `snippets` and `validAnchors` counts, and a `Thesis:` line comparing the package size to the estimated `~12500` full-read tokens.

## verify command

<!-- lw:anchors packages/cli/src/commands/verify.ts#registerVerify -->

`verify.ts` registers `livewiki verify` with `export function registerVerify(program: Command): void` and supports no local options. The action resolves `repoRoot` from `opts.repo ?? "."`, awaits `runVerify(repoRoot)`, writes the result as JSON when `--json` is set or as `formatVerifyHuman(result)` otherwise, and — when `!result.ok` — sets `process.exitCode = 1` so the command is CI-friendly. Errors are caught and turned into a stderr line plus `process.exitCode = 1`. The excerpt does not show what `runVerify` actually checks (broken anchors, altered manual blocks, internal links are described only in the description string).

## view command

<!-- lw:anchors packages/cli/src/commands/view.ts#registerView -->

`view.ts` registers `livewiki view` with `export function registerView(program: Command): void` and supports `--template <name>` (default `"agent"`) and `--out <dir>`. The action body is a Phase-7 stub from `makeStubAction({ name: "view", phase: 7, planned: "static site with client-side search + Mermaid + templates as data" })`. The excerpt does not show the real Phase-7 implementation.

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
- [CLI source and end-to-end test scaffolding](cli-src.md) — dependency and dependent
<!-- livewiki:navigate:end -->
