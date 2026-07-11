---
title: commands
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

# commands

CLI command registrations for the `livewiki` tool. Each module exports a `registerX(program)` function that attaches a subcommand to the root Commander program, plus helpers for output formatting and stub actions used by Phase 0 placeholders.

## batch

<!-- lw:anchors packages/cli/src/commands/batch.ts#registerBatch packages/cli/src/commands/batch.ts#formatStatusHuman packages/cli/src/commands/batch.ts#formatResultHuman packages/cli/src/commands/batch.ts#formatListHuman packages/cli/src/commands/batch.ts#setExitCode -->

Phase 3 subcommands for running, resuming, and inspecting documentation batches.

Subcommands:

- `batch` (no args) — status of the last run.
- `batch status [<runId>]` — run report (default).
- `batch resume <runId>` — continue pending/failed tasks.
- `batch --only <target> <runId>` — re-run a single task (module or task-id).
- `batch list` — list runs.

Flags:

- `--only <target>` — re-run one task.
- `--no-refine` — skip LLM refinement of stage 2.

Exit codes (without `--json`):

- `0` = completed (success)
- `1` = completed_with_failures
- `2` = aborted (circuit breaker)

Errors set `process.exitCode = 1` (never abrupt `process.exit`, to avoid libuv `STATUS_STACK_BUFFER_OVERRUN` on Windows when async handles are open).

Human output is token-first (tokens are the primary metric); USD appears as a separate estimated line and is omitted without drama when no model pricing exists.

## export

<!-- lw:anchors packages/cli/src/commands/export.ts#registerExport -->

Phase 6 stub. Currently a placeholder via `makeStubAction`. Planned behaviour: export the wiki to a repo-wiki format (github-wiki, gitlab-wiki, generic) with optional `--push <remote>` to publish.

## index

<!-- lw:anchors packages/cli/src/commands/index-cmd.ts#registerIndex packages/cli/src/commands/index-cmd.ts#collectIgnore packages/cli/src/commands/index-cmd.ts#emit packages/cli/src/commands/index-cmd.ts#formatLedgerHuman -->

Phase 1 + 2: re-indexes the repository and chains the anchor ledger. Idempotent and incremental.

Flags:

- `--ignore <pattern>` — additional pattern to ignore (repeatable; accumulated by `collectIgnore`).
- `--no-ledger` — skip ledger (index code only).
- `--quiet` — suppress human output without producing JSON (used by Phase 5 hooks).

Auto-creates `.livewiki/` without warning. Emits an info note when `livewiki/` is also missing (suggesting `init`). Never requires `init` first. Quiet mode writes nothing to stdout but stderr still carries errors; structured JSON is produced when `--json` is set.

## init

<!-- lw:anchors packages/cli/src/commands/init.ts#registerInit packages/cli/src/commands/init.ts#formatHuman -->

Phase 3 (real): creates `livewiki/` + `.livewiki/`, indexes, and generates a deterministic layout (quickstart + diagrams + manifest). No LLM by default.

Flags:

- `--batch` — triggers the full LLM pipeline (stages 1–4).
- `--plan` — shows the module plan (heuristic, no LLM, no writes).
- `--no-refine` — skips LLM refinement of stage 2 (stage 2 stays heuristic-only). Note: Commander maps `--no-refine` to `opts.refine === false`, not `opts.noRefine`.

Exit codes:

- Without `--batch`: always `0` on success.
- With `--batch`: propagates the batch exit code (`0`, `1`, or `2`) via `process.exitCode`.
- `--json` always exits `0` (structured output convention).

## pointer

<!-- lw:anchors packages/cli/src/commands/pointer.ts#registerPointer packages/cli/src/commands/pointer.ts#promptYesNo packages/cli/src/commands/pointer.ts#formatPointerResult packages/cli/src/commands/pointer.ts#formatStatusHuman packages/cli/src/commands/pointer.ts#_internal -->

Phase 5: opt-in pointer in `AGENTS.md` / `CLAUDE.md`. Honors Inviolable rule #2 — never automatic.

Modes:

- No flags — show current status (read-only).
- `--write-pointer` — writes the block (explicit opt-in, no prompt). `--yes` is an alias.
- `--remove` — removes the block.
- `--file <name>` — force `AGENTS.md` or `CLAUDE.md` (default: auto-detect).
- `--block <text>` — custom block content (default: `buildPointerBlock()`).

TTY behaviour: without `--write-pointer` / `--yes` and a TTY is detected, an interactive `y/N` prompt is shown. Without a flag and no TTY, the command fails closed (non-zero exit, instructions to use `--write-pointer`). `--remove` is more cautious and likewise fails closed in non-interactive mode without an explicit flag.

`_internal` re-exports `nodeFs` for tests only; it is not exposed to userspace.

## serve

<!-- lw:anchors packages/cli/src/commands/serve.ts#registerServe -->

Phase 4 stub via `makeStubAction`. Planned: start the MCP server on stdio with 6 tools (`livewiki_quickstart`, `read`, `search`, `debt`, `write_doc`, `resolve_debt`).

## status

<!-- lw:anchors packages/cli/src/commands/status.ts#registerStatus -->

Phase 1/2: shows open debt, undocumented symbols, and pending batch state. Options: `--top <n>` (default `10`) for the top-files list.

## stub

<!-- lw:anchors packages/cli/src/commands/stub.ts#makeStubAction -->

Helper for Phase 0 command stubs. The returned action handler accepts the inherited global options (`--json`, `--repo`) via `optsWithGlobals()` and emits a structured stub response with `ok: false`, the planned phase, and a human-readable explanation. Exit code is `0` (the command executed — it is just not implemented yet). Real implementations replace the stub with the same `(options, command) => Promise<void>` signature.

## update

<!-- lw:anchors packages/cli/src/commands/update.ts#registerUpdate packages/cli/src/commands/update.ts#formatHuman -->

Phase 5 (incremental mode). Emits a work package containing debt, snippets, validAnchors, and estimated tokens for the in-session agent to pay the debt.

Flags:

- `--llm` — pay debt via the configured API (delegates to the batch orchestrator).
- `--record-write <tokens>` — records that N tokens were written back (economy metric). Bytes are estimated at 4 chars/token. Exit `1` if the value is not a non-negative integer.
- `--snippet-window <lines>` — window per anchor (default `20`).

Default mode emits a package whose `economy` block compares `packageTokens` against an estimated full-read baseline of `12500` tokens and reports a `savedRatio`.

Exit codes: `0` on success (package emitted or write recorded), `1` on usage/state errors.

## verify

<!-- lw:anchors packages/cli/src/commands/verify.ts#registerVerify -->

Phase 2, CI-friendly: validates the wiki against the index — broken anchors, altered manual blocks, and internal links. Exit `1` if `result.ok` is false so CI can fail the build.

## view

<!-- lw:anchors packages/cli/src/commands/view.ts#registerView -->

Phase 7 stub via `makeStubAction`. Planned: generate a self-contained static site (HTML + CSS + JS) with client-side search and Mermaid, using `--template agent|docs` (default `agent`) and `--out <dir>` (default `.livewiki/site/`).