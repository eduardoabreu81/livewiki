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

## batch

<!-- lw:anchors packages/cli/src/commands/batch.ts#registerBatch packages/cli/src/commands/batch.ts#USAGE_INCOMPLETE_NOTE packages/cli/src/commands/batch.ts#formatDiagnosticLine packages/cli/src/commands/batch.ts#appendStage4Diagnostics packages/cli/src/commands/batch.ts#formatStatusHuman packages/cli/src/commands/batch.ts#formatResultHuman packages/cli/src/commands/batch.ts#formatListHuman packages/cli/src/commands/batch.ts#setExitCode -->

`packages/cli/src/commands/batch.ts` wires the Phase 3 `batch` command group on the Commander program. The exported `registerBatch` declares a single `batch` command whose action dispatches by positional args to one of four modes: implicit status (`args.length === 0`), `list`, `status [runId]`, `resume <runId>`, or the `--only <target>` re-run path. It also accepts `--only` and `--no-refine`, with the latter normalized to a `noRefine` flag passed through to the core batch orchestrator. Errors are written to stderr and the process exit code is set via `process.exitCode` (never `process.exit`) so that Node can drain pending async handles before terminating.

The file exports `USAGE_INCOMPLETE_NOTE`, a single shared string emitted by both human formatters whenever the token totals are not fully accounted for (some attempts have unknown usage). It also houses the human output helpers `formatStatusHuman`, `formatResultHuman`, and `formatListHuman`, the diagnostic helpers `formatDiagnosticLine` (one compact line per attempt with deduplicated error codes) and `appendStage4Diagnostics` (extends the status lines with the per-task attempt sequence for failed stage-4 tasks), and `setExitCode`, which maps the orchestrator status string to a CLI exit code (`completed` → 0, `completed_with_failures` → 1, `aborted` → 2) while preserving exit 0 whenever `--json` is in effect.

## export

<!-- lw:anchors packages/cli/src/commands/export.ts#registerExport -->

`packages/cli/src/commands/export.ts` registers `livewiki export <target>` as a Phase 6 stub via `registerExport`. It accepts `--push <remote>` and delegates the action to `makeStubAction`, which announces the planned behavior (one-way transformation: flatten namespace, rewrite links, strip anchor frontmatter).

## index-cmd

<!-- lw:anchors packages/cli/src/commands/index-cmd.ts#registerIndex packages/cli/src/commands/index-cmd.ts#collectIgnore packages/cli/src/commands/index-cmd.ts#emit packages/cli/src/commands/index-cmd.ts#formatLedgerHuman -->

`packages/cli/src/commands/index-cmd.ts` exposes `registerIndex`, which wires the `(re)index` command. The action runs the indexer (then the anchor ledger unless `--no-ledger` is set), accepts repeatable `--ignore <pattern>` flags consumed by `collectIgnore`, and honors `--quiet` and `--json` to control output. The internal `emit` helper decides between structured JSON, the indexer's human formatter, and (when a ledger ran) `formatLedgerHuman`, which summarizes `pagesProcessed`, `pagesSkipped`, `anchorsUpserted`, per-event debt counters, undocumented symbol count, and any moved pairs. Errors are reported to stderr and `process.exitCode` is set to 1.

## init

<!-- lw:anchors packages/cli/src/commands/init.ts#registerInit packages/cli/src/commands/init.ts#formatHuman -->

`packages/cli/src/commands/init.ts` registers the Phase 3 `init` command via `registerInit`, accepting `--batch` (full LLM pipeline), `--plan` (heuristic, no writes, no LLM), and `--no-refine` (Commander normalizes the negation to `refine === false`). The result is emitted via the shared `emit` helper, whose third argument is produced by `formatHuman`: in plan mode it lists module/file/symbol/edge counts and the ordered module list; in normal mode it lists files written, the optional batch summary, and the propagated `batchExitCode`. When `--json` is absent and `batchExitCode` is defined, the command forwards it to `process.exitCode`.

## pointer

<!-- lw:anchors packages/cli/src/commands/pointer.ts#registerPointer packages/cli/src/commands/pointer.ts#promptYesNo packages/cli/src/commands/pointer.ts#formatPointerResult packages/cli/src/commands/pointer.ts#formatStatusHuman packages/cli/src/commands/pointer.ts#_internal -->

`packages/cli/src/commands/pointer.ts` implements the opt-in AGENTS.md/CLAUDE.md pointer from Phase 5. `registerPointer` declares the command with flags `--write-pointer`, `--remove`, `--file <name>`, `--yes`, and `--block <text>`, and routes to one of four modes: read-only status, explicit write (`--write-pointer` or `--yes`), interactive confirmation (TTY only), or removal (also gated by flag or TTY confirmation). Writes are strictly "never automatic": without an explicit flag and without a TTY, the command fails closed. The file also exports `promptYesNo` (reads one line from stdin and resolves true only on `y`/`yes`), `formatPointerResult` (renders the verb/byte-delta summary after a write or remove), `formatStatusHuman` (renders the current block or a "not present" hint), and `_internal`, a re-export of `nodeFs` for tests only.

## serve

<!-- lw:anchors packages/cli/src/commands/serve.ts#registerServe -->

`packages/cli/src/commands/serve.ts` registers the `serve` command via `registerServe` and delegates the action to a Phase 4 stub (`makeStubAction`); the planned behavior is an MCP stdio server exposing six tools (`livewiki_quickstart`, `read`, `search`, `debt`, `write_doc`, `resolve_debt`).

## status

<!-- lw:anchors packages/cli/src/commands/status.ts#registerStatus -->

`packages/cli/src/commands/status.ts` exposes `registerStatus`, which wires the Phase 1/2 `status` command. It accepts `--top <n>` (default 10) and runs the core status reporter, then either prints the structured JSON or the human-formatted summary. Errors set `process.exitCode = 1`.

## stub

<!-- lw:anchors packages/cli/src/commands/stub.ts#makeStubAction -->

`packages/cli/src/commands/stub.ts` provides `makeStubAction`, a factory that returns a Commander action handler for Phase 0 placeholders. It honors inherited `--json` and `--repo`, resolves the repo root, and emits a structured stub record (name, phase, repoRoot, message, planned description) or a one-line human stub message, with exit code 0 (the command ran; it is just not yet implemented).

## update

<!-- lw:anchors packages/cli/src/commands/update.ts#registerUpdate packages/cli/src/commands/update.ts#formatHuman -->

`packages/cli/src/commands/update.ts` registers the Phase 5 `update` command via `registerUpdate`. It branches on `--record-write <tokens>` (records a write-back metric via the imported `recordDocWrittenBack`), `--llm` (currently a degraded path that tells the caller to use the batch orchestrator and exits 1), or the default branch, which loads the work package and emits it through the shared `emit` helper alongside an `economy` summary (estimated full-read tokens vs. package tokens). `formatHuman` renders `lastDocumentedCommit`, optional `pendingBatch`, the first five debt entries with assignee/wiki columns, snippet and valid-anchor counts, the estimated token count, and a one-line thesis about focused packages versus re-reading the repo. The file also re-exports `runStatus` for reuse.

## verify

<!-- lw:anchors packages/cli/src/commands/verify.ts#registerVerify -->

`packages/cli/src/commands/verify.ts` exposes `registerVerify`, which wires the CI-friendly `verify` command. It runs the core verifier, emits structured JSON or the human summary, and sets `process.exitCode = 1` whenever `result.ok` is false (so CI fails when anchors, manual blocks, or internal links are broken).

## view

<!-- lw:anchors packages/cli/src/commands/view.ts#registerView -->

`packages/cli/src/commands/view.ts` registers `livewiki view` via `registerView` as a Phase 7 stub, accepting `--template <name>` (default `agent`) and `--out <dir>` (default `.livewiki/site/`). The action delegates to `makeStubAction` with the planned behavior of a self-contained static site featuring client-side search and Mermaid diagrams.