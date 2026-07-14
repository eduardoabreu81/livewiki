---
title: commands
owner: generated
anchors:
  - packages/cli/src/commands/batch.ts#USAGE_INCOMPLETE_NOTE
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

# commands

Commander registration and human-output formatters for the livewiki CLI. Each
file under `packages/cli/src/commands/` exports a `register*` function that
attaches one subcommand to the root `program`. Commands that are not yet
implemented for their target SPEC phase use the stub helper.

Exit-code policy across real commands: `--json` always exits 0 (structured
output, batch CLI convention). Without `--json`, exit codes follow the batch
contract — `0` success, `1` failures, `2` aborted circuit breaker. Errors set
`process.exitCode` (not `process.exit`) so libuv can drain open async handles
(fetch / SQLite WAL / watcher) before termination.

## batch
<!-- lw:anchors packages/cli/src/commands/batch.ts#registerBatch packages/cli/src/commands/batch.ts#setExitCode -->

`registerBatch` registers `livewiki batch` (Phase 3). Subcommands dispatch on
positional args: no args ⇒ status of the last run; `list` ⇒ enumerate runs;
`status [runId]` ⇒ run report (default); `resume <runId>` ⇒ continue
pending/failed tasks via `resumeBatch`; `--only <target> <runId>` ⇒ re-run a
single task via `runOnly`. All subcommands resolve the repo root via
`resolveRepoRoot`, emit through `emit`, and route through `setExitCode`.

`setExitCode` maps `completed` → 0, `completed_with_failures` → 1, `aborted`
→ 2. It is a no-op when `--json` is set.

The `--no-refine` flag is mapped by Commander to `opts.refine === false`
(not `opts.noRefine`); `resume` spreads `noRefine: true` only when that
condition holds.

## batch human output
<!-- lw:anchors packages/cli/src/commands/batch.ts#formatStatusHuman packages/cli/src/commands/batch.ts#formatResultHuman packages/cli/src/commands/batch.ts#formatListHuman packages/cli/src/commands/batch.ts#USAGE_INCOMPLETE_NOTE -->

`formatStatusHuman` renders a run report: header (run id + status + started/finished
+ actor), then a **tokens-first** block (total + per-stage) followed by a
secondary USD block only when at least one model has pricing. Per-module
tokens are listed when present; failures are appended as `[code] module: msg`
plus their retry command.

`formatResultHuman` renders a `resume` / `runOnly` result with the same
tokens-first / USD-secondary ordering, a tasks/failures summary, a
`circuit breaker: TRIGGERED` line when applicable, and a failures block.

`formatListHuman` prints a single-line summary per run with id, status,
started-at, and finished-at (or `(running)`).

When `totals.usageIncomplete` is true, both `formatStatusHuman` and
`formatResultHuman` append the shared `USAGE_INCOMPLETE_NOTE` string:
"Note: totals are incomplete — some attempts have unknown usage. Prefer
proxy/provider billing for wire cost."

## export
<!-- lw:anchors packages/cli/src/commands/export.ts#registerExport -->

`registerExport` registers `livewiki export <target>` (Phase 6). Currently
delegates to `makeStubAction` with `name: "export"`, `phase: 6`, and the
planned description "one-way transformation: flatten namespace, rewrite
links, strip anchor frontmatter". Accepts `--push <remote>` for git publish.

## index
<!-- lw:anchors packages/cli/src/commands/index-cmd.ts#registerIndex packages/cli/src/commands/index-cmd.ts#collectIgnore packages/cli/src/commands/index-cmd.ts#emit packages/cli/src/commands/index-cmd.ts#formatLedgerHuman -->

`registerIndex` registers `livewiki index` (Phase 1+2). Options: `--ignore
<pattern>` (repeatable), `--no-ledger` (skip ledger), `--quiet` (suppress
human output without producing JSON — used by Phase 5 hooks). Runs the
indexer, then chains `runLedger` unless `--no-ledger` was given; both call
share the same `quiet: json || quiet` flag.

`collectIgnore` is the Commander accumulator for `--ignore`: returns
`previous.concat(value)`.

`emit` centralises output. Quiet mode without JSON writes nothing to stdout;
JSON mode writes `{ ok: true, index, ledger }`; human mode writes the
indexer's human output followed by `formatLedgerHuman` when present.

`formatLedgerHuman` renders the ledger result as a multi-line report:
pages processed/skipped, anchors upserted, debt counter (`+changed +moved
+deleted`), undocumented count, and an optional list of moved pairs.

Missing `.livewiki/` is auto-created without warning. Missing `livewiki/`
emits an info note suggesting `init`. `livewiki index` never requires `init`
first.

## init
<!-- lw:anchors packages/cli/src/commands/init.ts#registerInit packages/cli/src/commands/init.ts#formatHuman -->

`registerInit` registers `livewiki init` (Phase 3). Flags: `--batch` triggers
the full LLM pipeline, `--plan` prints the heuristic plan with no LLM and no
writes, `--no-refine` skips LLM refinement of stage 2 (mapped to
`opts.refine === false` then spread as `noRefine: true`). Resolves the repo,
runs `runInit`, emits through `emit`, and propagates `result.batchExitCode`
to `process.exitCode` when `--batch` was used and `--json` was not.

`formatHuman` renders two shapes. In `--plan` mode it prints the ordered
module list with file and symbol counts. In normal mode it lists files
written and, when present, a `batch run #N: status` block with tasks done /
failed and the exit code.

## pointer
<!-- lw:anchors packages/cli/src/commands/pointer.ts#registerPointer packages/cli/src/commands/pointer.ts#promptYesNo packages/cli/src/commands/pointer.ts#formatPointerResult packages/cli/src/commands/pointer.ts#formatStatusHuman packages/cli/src/commands/pointer.ts#_internal -->

`registerPointer` registers `livewiki pointer` (Phase 5). The pointer block
in `AGENTS.md` / `CLAUDE.md` is **never** written automatically (Inviolable
rule #2): the command fails closed when invoked without `--write-pointer` /
`--yes` in a non-TTY context.

Modes:
- no flags + TTY + pointer already present ⇒ show status
- no flags + TTY + pointer absent ⇒ interactive prompt with `promptYesNo`
- `--write-pointer` / `--yes` ⇒ write (`insertPointer`)
- `--remove` ⇒ remove (`removePointer`); requires explicit confirmation
  in non-TTY mode
- `--file <name>` restricts the target to `AGENTS.md` or `CLAUDE.md`
- `--block <text>` overrides `buildPointerBlock()` with custom content

`promptYesNo` writes the question to stdout, listens for a single line on
stdin, and resolves `true` when the trimmed lowercase answer equals `y` or
`yes` (and `false` otherwise, including on EOF).

`formatPointerResult` renders `wrote` / `updated` / `removed` / `unchanged`
plus a signed byte delta. `formatStatusHuman` reports absence with an
invitation to use `--write-pointer`, or prints the pointer block fenced
between `---` markers.

`_internal` re-exports `nodeFs` for tests only and is not part of the public
surface.

## serve
<!-- lw:anchors packages/cli/src/commands/serve.ts#registerServe -->

`registerServe` registers `livewiki serve` (Phase 4). Currently delegates to
`makeStubAction` with `name: "serve"`, `phase: 4`, and the planned
description "MCP server stdio with 6 tools (livewiki_quickstart/read/search/
debt/write_doc/resolve_debt)".

## status
<!-- lw:anchors packages/cli/src/commands/status.ts#registerStatus -->

`registerStatus` registers `livewiki status` (Phase 1/2). Options: `--top
<n>` (default `10`). Resolves the repo, runs `runStatus` with `topN`, and
emits JSON or human output. Phase 1 reports files + symbols; Phase 2 adds
debt + undocumented.

## stub
<!-- lw:anchors packages/cli/src/commands/stub.ts#makeStubAction -->

`makeStubAction(info)` returns a Commander action handler for Phase 0 stubs.
It reads `--json` and `--repo` via `command.optsWithGlobals()`, resolves the
repo root, and emits either structured JSON `{ ok: false, stub, phase,
repoRoot, message, planned }` or a one-line human message. Exit code is 0
(command ran — it just isn't implemented yet). Real implementations replace
the stub with their own `(options, command) => Promise<void>` handler,
preserving the signature.

## update
<!-- lw:anchors packages/cli/src/commands/update.ts#registerUpdate packages/cli/src/commands/update.ts#formatHuman -->

`registerUpdate` registers `livewiki update` (Phase 5, the heart of the
incremental mode). Three execution paths:
1. `--record-write <tokens>`: validates a non-negative integer, calls
   `recordDocWrittenBack` with an estimated byte count (`tokens * 4`), and
   emits the recording. Does not emit a work package.
2. `--llm`: currently writes a stderr message redirecting users to
   `livewiki batch resume <runId>` or `livewiki init --batch`, and exits 1.
   TODO: full delegation to the batch orchestrator.
3. Default: calls `loadWorkPackage` with `--snippet-window <lines>` (default
   20) and emits a structured summary that includes the package plus an
   `economy` block comparing package tokens to an estimated 12,500-token
   full-repo re-read.

`formatHuman` renders the manifest (lastDocumentedCommit, pendingBatch when
present), the first five debt items with `[event] symbol_key (assignee, wiki)`,
the snippet count, validAnchors count, the estimated tokens/bytes, and the
"focused package vs re-reading repo" thesis line.

The file also re-exports `runStatus` from `@livewiki/core/status` so other
modules can import it through this entry point.

## verify
<!-- lw:anchors packages/cli/src/commands/verify.ts#registerVerify -->

`registerVerify` registers `livewiki verify` (Phase 2, CI-friendly). Resolves
the repo, runs `runVerify`, emits JSON or `formatVerifyHuman` output, and
exits 1 when `result.ok` is false so CI pipelines can gate on it.

## view
<!-- lw:anchors packages/cli/src/commands/view.ts#registerView -->

`registerView` registers `livewiki view` (Phase 7). Currently delegates to
`makeStubAction` with `name: "view"`, `phase: 7`, and the planned description
"static site with client-side search + Mermaid + templates as data". Accepts
`--template <name>` (default `agent`) and `--out <dir>` (default
`.livewiki/site/`).
