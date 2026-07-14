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

# commands

CLI command registrations for `livewiki`. Each module exports one or more `register*` functions that wire Commander subcommands, plus internal helpers for human-output formatting and stub orchestration.

## batch — registration and subcommands
<!-- lw:anchors packages/cli/src/commands/batch.ts#registerBatch -->

`registerBatch(program)` registers the top-level `batch` command on the supplied `Command`. It exposes four behaviours dispatched on positional args: default (`status` of the last run), `list`, `status [runId]`, `resume <runId>`, and `--only <target> <runId>` for re-running a single task. Errors are written to stderr; `process.exitCode` is set (not `process.exit`) to avoid the libuv crash on Windows when async handles are still open. Options `--only` and `--no-refine` (which Commander maps to `opts.refine === false`) are forwarded to the underlying `runOnly` / `resumeBatch` calls from `@livewiki/core/batch`.

## batch — diagnostics formatting
<!-- lw:anchors packages/cli/src/commands/batch.ts#formatDiagnosticLine packages/cli/src/commands/batch.ts#appendStage4Diagnostics -->

`formatDiagnosticLine(d)` renders one compact ordered line per diagnostic entry. The shape is `attempt N: <stopReason> -> <outcome> [code1, code2, ...]` with `stopReason` defaulting to `"-"` when the LLM did not supply one and error codes deduplicated while preserving first-seen order. `appendStage4Diagnostics(lines, report, failureTaskId)` locates the failed task by id and, if `diagnosticHistory` is present, appends an `attempts:` block with one `formatDiagnosticLine` line per entry. It returns silently for tasks whose checkpoint predates diagnostics or which never reached the LLM.

## batch — human output
<!-- lw:anchors packages/cli/src/commands/batch.ts#formatStatusHuman packages/cli/src/commands/batch.ts#formatResultHuman packages/cli/src/commands/batch.ts#formatListHuman packages/cli/src/commands/batch.ts#USAGE_INCOMPLETE_NOTE -->

`formatStatusHuman(report)` emits the run header, ISO start/finish timestamps, a tokens-primary block with the global total and per-stage breakdown, and a secondary USD block marked "estimated" that is omitted without drama when no model has pricing. Per-module lines include token counts and an optional USD tail. Failed stage-4 tasks get the appended diagnostic sequence from `appendStage4Diagnostics`. When totals are partial the shared `USAGE_INCOMPLETE_NOTE` is appended to the tokens section, nudging users to proxy/provider billing for wire cost. `formatResultHuman(result)` produces the same token-first ordering for live batch results, adds a `tasks done` / `failures` / circuit-breaker summary, and emits `Failures:` lines for each error. `formatListHuman(runs)` renders the `batch list` view, printing one line per run with id, status, started, and finished timestamps (or `(running)`).

## batch — exit code policy
<!-- lw:anchors packages/cli/src/commands/batch.ts#setExitCode -->

`setExitCode(repoRoot, status, json)` maps a run status to a process exit code. The `--json` path always exits 0 (structured output is the contract); otherwise `completed → 0`, `completed_with_failures → 1`, `aborted → 2`. Callers invoke this as the final action-handler statement so Node can drain pending I/O before exit.

## export — stub
<!-- lw:anchors packages/cli/src/commands/export.ts#registerExport -->

`registerExport(program)` adds `export <target>` (Phase 6). It accepts an optional `--push <remote>` flag and currently delegates to `makeStubAction({ name: "export", phase: 6, planned: "one-way transformation: flatten namespace, rewrite links, strip anchor frontmatter" })`.

## index — registration
<!-- lw:anchors packages/cli/src/commands/index-cmd.ts#registerIndex -->

`registerIndex(program)` registers the `index` command. It accepts repeatable `--ignore <pattern>`, `--no-ledger` to skip the ledger pass (Commander maps this to `ledger: false`), and `--quiet` to suppress human output without producing JSON. Missing `.livewiki/` is auto-created silently; a missing `livewiki/` emits an info note suggesting `init`. The indexer runs first and then the anchor-ledger is chained (Phase 2) unless `--no-ledger` is set, so `livewiki index` re-detects changed/moved/deleted symbols along with the reindex.

## index — option accumulator and output
<!-- lw:anchors packages/cli/src/commands/index-cmd.ts#collectIgnore packages/cli/src/commands/index-cmd.ts#emit packages/cli/src/commands/index-cmd.ts#formatLedgerHuman -->

`collectIgnore(value, previous)` is the Commander accumulator: it returns `previous.concat(value)`, letting `--ignore` repeat safely. `emit(json, quiet, indexResult, ledgerResult)` is the output switch: when `quiet && !json` it returns silently so hooks don't spam stdout; when `json` it writes `{ ok: true, index, ledger }`; otherwise it writes the indexer human output followed by the ledger human output if present. `formatLedgerHuman(r)` prints the ledger summary: pages processed/skipped, anchors upserted, the `+changed +moved +deleted` debt breakdown, undocumented count, and any moved pairs in arrow form.

## init — registration
<!-- lw:anchors packages/cli/src/commands/init.ts#registerInit -->

`registerInit(program)` registers `init` (Phase 3). Flags: `--batch` triggers the full LLM pipeline, `--plan` shows the module plan without writes or LLM, and `--no-refine` (Commander-mapped to `opts.refine === false`) skips LLM refinement of stage 2 when combined with `--batch`. After `runInit`, the batch exit code is propagated to `process.exitCode` only when `--json` is not set; `--json` preserves exit 0 per batch CLI convention. Errors write to stderr and set `process.exitCode = 1` instead of calling `process.exit(1)` to avoid the libuv assert on Windows.

## init — human output
<!-- lw:anchors packages/cli/src/commands/init.ts#formatHuman -->

`formatHuman(result)` renders two shapes. With a plan present (the `--plan` path) it prints module/file/symbol/edge counts and the ordered (prioritized) module list. Otherwise it prints the OK header, lists each file written, and — when a batch run was attached — appends a `batch run #N` block with status, tasks done/failed, and the propagated exit code.

## pointer — registration
<!-- lw:anchors packages/cli/src/commands/pointer.ts#registerPointer -->

`registerPointer(program)` registers the `pointer` command (Phase 5). Per Inviolable rule #2 the pointer is never written automatically: no flags prints status read-only; `--write-pointer` (or its alias `--yes`) opts in explicitly; `--remove` deletes the block; `--file <name>` forces `AGENTS.md` or `CLAUDE.md` (validated against `POINTER_FILES`); `--block <text>` overrides the default `buildPointerBlock()` content. On a TTY without `--write-pointer`, an interactive confirmation runs via `promptYesNo`. Without TTY and without `--write-pointer`/`--yes`, the command fails closed with a stderr message and `process.exitCode = 1`. The `--remove` path additionally prompts when interactive, and requires `--write-pointer`/`--yes` in non-interactive mode.

## pointer — interactive prompt and result formatting
<!-- lw:anchors packages/cli/src/commands/pointer.ts#promptYesNo packages/cli/src/commands/pointer.ts#formatPointerResult packages/cli/src/commands/pointer.ts#formatStatusHuman packages/cli/src/commands/pointer.ts#_internal -->

`promptYesNo(question)` writes the prompt to stdout, reads one line from stdin (resolving on either a newline or `end`), and resolves to true iff the trimmed lowercase answer is `y` or `yes`. `formatPointerResult(result, verb)` renders a verb-correct line — `wrote` for insert, `updated` for replace, `unchanged` for no-op, `removed` for delete — followed by a signed byte delta when nonzero. `formatStatusHuman(status)` prints a one-line "not present" hint when the block is absent, or the file name with the block fenced between `---` markers when present. `_internal` is `{ nodeFs }`, re-exported for tests so the pointer path can be stubbed without reaching into private module state.

## serve — stub
<!-- lw:anchors packages/cli/src/commands/serve.ts#registerServe -->

`registerServe(program)` registers `serve` (Phase 4). The action delegates to `makeStubAction({ name: "serve", phase: 4, planned: "MCP server stdio with 6 tools (livewiki_quickstart/read/search/debt/write_doc/resolve_debt)" })`.

## status — registration
<!-- lw:anchors packages/cli/src/commands/status.ts#registerStatus -->

`registerStatus(program)` registers the `status` command. It accepts `--top <n>` (default `10`) to bound the top-files list and inherits `--json` and `--repo` from the parent program via `optsWithGlobals()`. The human branch prints the status report from `@livewiki/core/status`; the JSON branch emits `{ ok: true, ...report }`. Errors write to stderr and set `process.exitCode = 1`.

## stub — helper
<!-- lw:anchors packages/cli/src/commands/stub.ts#makeStubAction -->

`makeStubAction(info)` is the Phase 0 stub factory. The returned action handler reads `--json` and `--repo` via `optsWithGlobals()`, resolves the repo root, and emits a structured `{ ok: false, stub, phase, repoRoot, message, planned }` payload (or the matching human line) describing which phase the command will be implemented in. Exit code is implicitly 0 — the command executed, it just isn't implemented yet.

## update — registration
<!-- lw:anchors packages/cli/src/commands/update.ts#registerUpdate -->

`registerUpdate(program)` registers `update` (Phase 5, incremental mode). Flags: `--record-write <tokens>` records that N tokens of doc were written back (estimated bytes = tokens × 4); `--llm` is currently a stub that tells the user to call `livewiki batch resume <runId>` or `livewiki init --batch`; `--snippet-window <lines>` (default `20`) bounds per-anchor snippets when emitting the work package. The default path emits a work package containing debt + snippets + validAnchors + estimated tokens, plus an `economy` summary that compares the package size against an estimated ~12500 tokens for re-reading the repo. Errors set `process.exitCode = 1` rather than calling `process.exit(1)`.

## update — human output
<!-- lw:anchors packages/cli/src/commands/update.ts#formatHuman -->

`formatHuman(pkg)` prints the work-package header. When the manifest is missing it surfaces a hint to run `livewiki init`; otherwise it prints `lastDocumentedCommit` and an optional `pendingBatch` line (`run #N (done/total)`). It then lists up to five debt entries as `[event] symbol_key (assignee=…, wiki=…)`, a `… +N more` overflow line when applicable, the snippets/validAnchors counts, and the estimated tokens with a byte approximation. The closing thesis line states the economy rationale (focused package vs. re-reading the repo).

## verify — registration
<!-- lw:anchors packages/cli/src/commands/verify.ts#registerVerify -->

`registerVerify(program)` registers `verify`. It runs the validator from `@livewiki/core/verify`, emits JSON when `--json` is set or the human-formatted report otherwise, and sets `process.exitCode = 1` when `result.ok` is false — making it CI-friendly. Errors from the validator write to stderr and set `process.exitCode = 1` without an abrupt `process.exit`.

## view — stub
<!-- lw:anchors packages/cli/src/commands/view.ts#registerView -->

`registerView(program)` registers `view` (Phase 7). It accepts `--template <name>` (`agent` | `docs`, default `agent`) and `--out <dir>` (default `.livewiki/site/`) and delegates to `makeStubAction({ name: "view", phase: 7, planned: "static site with client-side search + Mermaid + templates as data" })`.