---
title: commands
owner: generated
anchors:
  - packages/cli/src/commands/batch.ts#registerBatch
  - packages/cli/src/commands/batch.ts#USAGE_INCOMPLETE_NOTE
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

## batch
<!-- lw:anchors packages/cli/src/commands/batch.ts#registerBatch packages/cli/src/commands/batch.ts#USAGE_INCOMPLETE_NOTE packages/cli/src/commands/batch.ts#formatStatusHuman packages/cli/src/commands/batch.ts#formatResultHuman packages/cli/src/commands/batch.ts#formatListHuman packages/cli/src/commands/batch.ts#setExitCode -->

`livewiki batch` (Phase 3) manages full-documentation batch runs. Subcommands:

- `batch status [<runId>]` (default) — run report
- `batch resume <runId>` — continue pending/failed tasks
- `batch --only <target> <runId>` — re-run a single task
- `batch list` — list runs

Exit codes: `0` = completed, `1` = completed_with_failures, `2` = aborted (circuit breaker). `--json` always exits `0`.

Commander maps `--no-refine` to `opts.refine === false`; the action spreads `{ noRefine: true }` only when that flag is set. Errors are reported on stderr and surfaced via `process.exitCode = 1` rather than `process.exit` to avoid libuv asserts when async handles are open.

`formatStatusHuman`, `formatResultHuman`, and `formatListHuman` render token-first output (tokens are the primary metric; USD is a secondary estimated line, omitted when no pricing exists). `USAGE_INCOMPLETE_NOTE` is appended when `totals.usageIncomplete` is true, warning that totals are incomplete and proxy/provider billing should be preferred for wire cost.

`setExitCode(repoRoot, status, json)` returns immediately when `--json` is set; otherwise maps run status to exit codes 0/1/2.

## export
<!-- lw:anchors packages/cli/src/commands/export.ts#registerExport -->

`livewiki export <target>` (Phase 6) exports the wiki to a repository-wiki format: `github-wiki`, `gitlab-wiki`, or generic (flattened md directory). `--push <remote>` publishes the result. Implemented as a Phase 6 stub via `makeStubAction`; planned behavior is a one-way transformation that flattens the namespace, rewrites links, and strips anchor frontmatter.

## index
<!-- lw:anchors packages/cli/src/commands/index-cmd.ts#registerIndex packages/cli/src/commands/index-cmd.ts#collectIgnore packages/cli/src/commands/index-cmd.ts#emit packages/cli/src/commands/index-cmd.ts#formatLedgerHuman -->

`livewiki index` reindexes the repo and (in Phase 2) chains the anchor-ledger to sync anchors. Idempotent and incremental. A missing `.livewiki/` is auto-created without warning; a missing `livewiki/` triggers an info note suggesting `init`. Never requires `init` first.

Flags:

- `--ignore <pattern>` — repeatable; collected by `collectIgnore` into an array passed as `extraIgnores`.
- `--no-ledger` — skips the ledger (code-only reindex). Commander exposes this as `opts.ledger === false`.
- `--quiet` — suppresses human output without producing JSON (used by hooks).

`emit(json, quiet, indexResult, ledgerResult)` writes JSON `{ ok, index, ledger }` when `--json` is set; otherwise writes the human formatter for the indexer plus `formatLedgerHuman` for the ledger (when present). When `quiet && !json`, nothing is written to stdout.

`formatLedgerHuman` prints pages processed/skipped, upserted anchors, debt by event (changed/moved/deleted), undocumented symbols, and any moved pairs.

## init
<!-- lw:anchors packages/cli/src/commands/init.ts#registerInit packages/cli/src/commands/init.ts#formatHuman -->

`livewiki init` (Phase 3) creates `livewiki/` and `.livewiki/`, indexes, and generates the deterministic layout (quickstart + diagrams + manifest). No LLM by default.

Flags:

- `--batch` — triggers the full LLM pipeline (stages 1–4).
- `--plan` — shows the module plan (heuristic; no LLM, no writes).
- `--no-refine` — skips LLM refinement of stage 2 (stage 2 stays heuristic-only). Commander maps this to `opts.refine === false`.

The action calls `runInit` and emits JSON or human output. `formatHuman` renders `--plan` output (module count, file/symbol/edge totals, ordered prioritized modules) when a plan is present; otherwise prints `filesWritten` and, when applicable, a batch summary (`runId`, `status`, tasks done/failed, and the propagated exit code). Without `--json`, the batch exit code is propagated via `process.exitCode`.

## pointer
<!-- lw:anchors packages/cli/src/commands/pointer.ts#registerPointer packages/cli/src/commands/pointer.ts#promptYesNo packages/cli/src/commands/pointer.ts#formatPointerResult packages/cli/src/commands/pointer.ts#formatStatusHuman packages/cli/src/commands/pointer.ts#_internal -->

`livewiki pointer` (Phase 5) manages the livewiki pointer block in `AGENTS.md` / `CLAUDE.md`. Inviolable rule #2: the pointer is **never** automatic — it requires `--write-pointer` (or `--yes`) or interactive confirmation.

Modes:

- No flags → read-only status.
- `--write-pointer` / `--yes` → writes the block (skips confirmation).
- `--remove` → removes the block; in non-TTY without `--write-pointer`/`--yes` the command fails closed.
- `--file <name>` — forces `AGENTS.md` or `CLAUDE.md`; validated against `POINTER_FILES`.
- `--block <text>` — custom block content; defaults to `buildPointerBlock()`.

In a TTY without flags, `readPointerStatus` is consulted: if the block is already present, status is printed; otherwise `promptYesNo` asks for confirmation and prints the block to be added. Without a TTY and without an opt-in flag, the command errors out and sets `process.exitCode = 1`.

`promptYesNo` reads one line from stdin and accepts `y` / `yes` (case-insensitive). `formatPointerResult` derives the past tense verb from the underlying `result.action` (`inserted` → "wrote", `replaced` → "updated", otherwise "unchanged"; removal always reports "removed"). `formatStatusHuman` prints "not present" when missing or the inner block fenced between `---` markers when present.

`_internal` re-exports `nodeFs` for tests and is not part of the public surface.

## serve, status, view
<!-- lw:anchors packages/cli/src/commands/serve.ts#registerServe packages/cli/src/commands/status.ts#registerStatus packages/cli/src/commands/stub.ts#makeStubAction packages/cli/src/commands/view.ts#registerView -->

`livewiki serve` (Phase 4) starts the MCP server on stdio. Implemented as a Phase 4 stub via `makeStubAction`; planned: 6 tools (`livewiki_quickstart`, `read`, `search`, `debt`, `write_doc`, `resolve_debt`).

`livewiki status` (Phase 1/2) shows open debt, undocumented symbols, and pending batch state. `--top <n>` controls the top list length (default 10). Emits JSON when `--json` is set; otherwise delegates human rendering to `@livewiki/core/status`.

`livewiki view` (Phase 7) generates a self-contained static site (HTML+CSS+JS) in `.livewiki/site/` with client-side search and Mermaid. `--template <agent|docs>` selects the visual template (default `agent`); `--out <dir>` overrides the output directory. Implemented as a Phase 7 stub.

`makeStubAction(info)` returns a Commander action that inherits global `--json` and `--repo`, emits a structured `{ ok: false, stub, phase, repoRoot, message, planned }` payload (or human text), and exits 0 — Phase 0 stub convention.

## update
<!-- lw:anchors packages/cli/src/commands/update.ts#registerUpdate packages/cli/src/commands/update.ts#formatHuman -->

`livewiki update` (Phase 5) is the incremental mode entry point.

Modes:

- `--record-write <tokens>` — records the size of doc written back (4 chars/token byte estimate) and exits without emitting a package.
- `--llm` — currently errors out (exit 1) with guidance to use `livewiki batch resume <runId>` or `livewiki init --batch`.
- Default — calls `loadWorkPackage(repoRoot, { snippetWindow? })` and emits the package plus an economy summary (`estimatedFullReadTokens = 12500`, `savedRatio = 1 - packageTokens / estimatedFullReadTokens`).

Flags: `--snippet-window <lines>` (default 20). The action reads options via `optsWithGlobals` and surfaces errors via `process.exitCode = 1`.

`formatHuman` prints `lastDocumentedCommit`, pending batch progress, the first 5 debt items (`[event] symbol_key (assignee=…, wiki=…)`), snippet/validAnchor counts, and the estimated token/byte totals with the "focused package vs re-reading repo" thesis.

## verify
<!-- lw:anchors packages/cli/src/commands/verify.ts#registerVerify -->

`livewiki verify` validates the wiki against the index: broken anchors, altered manual blocks, and internal links. JSON output when `--json` is set; otherwise delegates to `@livewiki/core/verify`'s human formatter. CI-friendly: exits non-zero (`process.exit(1)`) when `result.ok` is false.