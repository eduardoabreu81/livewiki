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

Commander bindings for the `livewiki` CLI. Each module under `packages/cli/src/commands/` exports one or more `register*(program)` helpers that wire a subcommand onto the root `Command`. Output is funneled through `emit()` from `../output.js` so `--json` and human formats stay consistent.

## batch
<!-- lw:anchors packages/cli/src/commands/batch.ts#registerBatch packages/cli/src/commands/batch.ts#USAGE_INCOMPLETE_NOTE packages/cli/src/commands/batch.ts#formatStatusHuman packages/cli/src/commands/batch.ts#formatResultHuman packages/cli/src/commands/batch.ts#formatListHuman packages/cli/src/commands/batch.ts#setExitCode -->

Phase 3 entry point: run, resume, re-run a single task, list, or inspect runs.

Subcommands:

- `batch status [<runId>]` (default) — run report.
- `batch resume <runId>` — continue pending/failed tasks.
- `batch --only <target> <runId>` — re-run a single task by module or task id.
- `batch list` — list runs.

Flags: `--only <target>`, `--no-refine` (skip LLM refinement of stage 2; Commander maps this to `opts.refine === false`, **not** `noRefine`).

Exit codes (set by `setExitCode`):

- `0` — `completed`
- `1` — `completed_with_failures`
- `2` — `aborted` (circuit breaker)

`--json` always exits `0` (structured output convention). Error handling uses `process.exitCode = 1` (never `process.exit(1)`) to avoid the libuv `STATUS_STACK_BUFFER_OVERRUN` crash on Windows when async handles (fetch, SQLite WAL, watcher) are still open.

Human formatters are token-first (ad87319): tokens are the primary metric, USD is secondary and omitted without drama when no model has pricing. `formatStatusHuman` emits per-stage + per-module token totals plus an optional "USD (estimated)" block, with a `Failures` section listing `[error.code] module: message` and the retry command. `formatResultHuman` is the post-run summary and includes a `circuit breaker: TRIGGERED` line when applicable. `formatListHuman` enumerates runs with id, status, started, finished.

`USAGE_INCOMPLETE_NOTE` is the shared human-only caveat: *"Note: totals are incomplete — some attempts have unknown usage. Prefer proxy/provider billing for wire cost."* It is appended whenever the report has `totals.usageIncomplete === true`.

## export
<!-- lw:anchors packages/cli/src/commands/export.ts#registerExport -->

Phase 6 stub. `livewiki export <target>` exports the wiki to a repository-wiki format (`github-wiki`, `gitlab-wiki`, `generic`). `--push <remote>` publishes. Uses `makeStubAction` with planned behavior: "one-way transformation: flatten namespace, rewrite links, strip anchor frontmatter".

## index
<!-- lw:anchors packages/cli/src/commands/index-cmd.ts#registerIndex packages/cli/src/commands/index-cmd.ts#collectIgnore packages/cli/src/commands/index-cmd.ts#emit packages/cli/src/commands/index-cmd.ts#formatLedgerHuman -->

`livewiki index` — (re)indexes the repo and (by default) chains the anchor ledger. Idempotent and incremental. Missing `.livewiki/` is auto-created **without warning**; missing `livewiki/` only emits an info note pointing at `init`. Never requires `init` first.

Flags:

- `--ignore <pattern>` — repeatable; collected by `collectIgnore` into `opts.ignore`.
- `--no-ledger` — index code only, skip ledger. Commander maps to `opts.ledger === false`.
- `--quiet` — suppresses human output without producing JSON (used by Phase 5 hooks). Distinct from `--json`: `--quiet` writes nothing to stdout; `--json` writes structured data.

`emit` decides between quiet/no-output, JSON, or human output. `formatLedgerHuman` prints `pages processed/skipped`, `anchors upserted`, debt breakdown by event (`changed`/`moved`/`deleted`), undocumented count, and any `movedPairs`.

## init
<!-- lw:anchors packages/cli/src/commands/init.ts#registerInit packages/cli/src/commands/init.ts#formatHuman -->

`livewiki init` (Phase 3) — creates `livewiki/` + `.livewiki/`, indexes, generates deterministic layout (quickstart + diagrams + manifest), no LLM by default.

Flags:

- `--batch` — run the full LLM documentation pipeline.
- `--plan` — show the heuristic module plan without writing or calling the LLM.
- `--no-refine` — skip LLM refinement of stage 2 (stage 2 stays heuristic-only).

`formatHuman` has two modes. With `--plan` it prints module count, file count, symbol count, edge count, and the ordered (prioritized) module list. Without `--plan` it prints `OK`, the written files, and (if `--batch` ran) the batch summary (`runId`, status, tasks done/failed) plus the propagated `batchExitCode`.

Exit code: `--json` keeps `0`; otherwise `batchExitCode` (from `statusToExitCode` in core) is propagated via `process.exitCode`. Base init without `--batch` always exits `0`.

## pointer
<!-- lw:anchors packages/cli/src/commands/pointer.ts#registerPointer packages/cli/src/commands/pointer.ts#promptYesNo packages/cli/src/commands/pointer.ts#formatPointerResult packages/cli/src/commands/pointer.ts#formatStatusHuman packages/cli/src/commands/pointer.ts#_internal -->

`livewiki pointer` — opt-in pointer in `AGENTS.md` / `CLAUDE.md` (Phase 5). Enforces **Inviolable rule #2**: the pointer is only written with an explicit flag (`--write-pointer` or alias `--yes`) or interactive confirmation. **Never automatic.**

Modes:

- No flags — read-only status.
- `--write-pointer` — writes the block; skips confirmation.
- `--remove` — removes the block (destructive; asks for confirmation in TTY mode, requires `--write-pointer`/`--yes` in non-TTY mode).
- `--file <name>` — force `AGENTS.md` or `CLAUDE.md` (default: auto-detect). Validated against `POINTER_FILES`.
- `--block <text>` — custom block content; default is `buildPointerBlock()` (1 paragraph).

Failure modes that fail closed:

- `--remove` without flag in non-TTY → exit `1`, error written to stderr.
- Any write without flag and without TTY → exit `1`, error written to stderr. The error explicitly reminds the user: *"Without explicit confirmation, livewiki NEVER writes outside livewiki/ — except AGENTS.md/CLAUDE.md with conscious opt-in."*

`promptYesNo` reads one line from stdin and accepts `y`/`yes` (case-insensitive). `formatPointerResult` maps internal `insertPointer`/`removePointer` actions to verbs: `wrote` for `inserted`, `updated` for `replaced`, `unchanged` for no-op, `removed` for removal, plus a byte-delta line. `formatStatusHuman` shows either "not present" with a `--write-pointer` hint or the existing block between `---` fences.

`_internal` re-exports `{ nodeFs }` for tests; not part of the user-facing surface.

## serve
<!-- lw:anchors packages/cli/src/commands/serve.ts#registerServe -->

Phase 4 stub. `livewiki serve` starts the MCP server on stdio. Planned: 6 tools (`livewiki_quickstart`, `read`, `search`, `debt`, `write_doc`, `resolve_debt`).

## status
<!-- lw:anchors packages/cli/src/commands/status.ts#registerStatus -->

`livewiki status` — Phase 1/2 index report (open debt, undocumented symbols, pending batch). Delegates to `runStatus` from `@livewiki/core/status` and reuses its `formatStatusHuman` for human output. `--top <n>` controls the size of the top-files list (default `10`). Honors the global `--json` and `--repo`. Errors are written to stderr with `process.exit(1)`.

## stub
<!-- lw:anchors packages/cli/src/commands/stub.ts#makeStubAction -->

Phase 0 helper. `makeStubAction(info)` returns a Commander action handler that:

- inherits `--json` and `--repo` via `command.optsWithGlobals()` (Commander 12 passes `(options, command)` for commands with no positional args);
- emits either a JSON object (`ok: false`, `stub`, `phase`, `repoRoot`, `message`, `planned`) or a human one-liner;
- always exits `0` (the command executed — it just isn't implemented yet).

Real implementations replace the stub call with a concrete action while keeping the same `(cmd: Command) => Promise<void>` signature.

Used by `registerExport` (Phase 6), `registerServe` (Phase 4), and `registerView` (Phase 7).

## update
<!-- lw:anchors packages/cli/src/commands/update.ts#registerUpdate packages/cli/src/commands/update.ts#formatHuman -->

Phase 5 incremental mode. `livewiki update` emits a work package (debt + snippets + `validAnchors` + estimated tokens) for the in-session agent to pay the debt. With `--llm`, the command is meant to delegate to the batch orchestrator (full mode, Phase 3); in the current revision it prints a hint to use `livewiki batch resume <runId>` or `livewiki init --batch` and exits `1`.

Modes:

- `--record-write <tokens>` — records that `N` tokens were written back; estimates bytes as `tokens * 4`. Validates that the value is a non-negative integer; exits `1` with a clear error otherwise. Does not emit a package.
- `--llm` — see above; exits `1` in this revision.
- default — calls `loadWorkPackage(repoRoot, { snippetWindow? })` and emits a summary.

`formatHuman` prints the work-package header (`lastDocumentedCommit`, optional `pendingBatch` progress), up to 5 debt entries of the form `[event] symbol_key (assignee=X, wiki=Y)`, snippet/`validAnchors` counts, the estimated token/byte total, and the economy thesis line: *"focused package vs re-reading repo (~12500 tokens) = economy."* The JSON summary includes an `economy` block with `estimatedFullReadTokens`, `packageTokens`, and `savedRatio`.

Error handling uses `process.exitCode = 1` (never `process.exit(1)`) for the same libuv reason as `batch`/`init`.

## verify
<!-- lw:anchors packages/cli/src/commands/verify.ts#registerVerify -->

`livewiki verify` — validates the wiki against the index: broken anchors, altered manual blocks, internal links. CI-friendly: non-zero exit on failure.

Behavior:

- `--json` writes `VerifyResult` to stdout.
- Human mode writes `formatVerifyHuman(result)` to stdout.
- On thrown errors: writes `livewiki verify: error — <message>` to stderr and `process.exit(1)`.
- On `!result.ok`: `process.exit(1)` (CI failure signal).

## view
<!-- lw:anchors packages/cli/src/commands/view.ts#registerView -->

Phase 7 stub. `livewiki view` generates a self-contained static site (HTML+CSS+JS) with client-side search and Mermaid. Flags: `--template <name>` (`agent` dense/technical, or `docs` clean; default `agent`) and `--out <dir>` (default `.livewiki/site/`). Planned: templates-as-data rendering.