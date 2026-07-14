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

## batch command (Phase 3)
<!-- lw:anchors packages/cli/src/commands/batch.ts#registerBatch packages/cli/src/commands/batch.ts#USAGE_INCOMPLETE_NOTE packages/cli/src/commands/batch.ts#formatDiagnosticLine packages/cli/src/commands/batch.ts#appendStage4Diagnostics -->

`registerBatch` attaches the `livewiki batch` command to a Commander program. It dispatches among four subcommands:

- no args → status of the last run
- `batch status [<runId>]` → build a status report
- `batch resume <runId>` → continue pending/failed tasks
- `batch list` → list runs
- positional `<runId>` → alias for status

Two options are exposed on the root: `--only <target>` (re-run one task) and `--no-refine` (skip LLM refinement of stage 2). Errors are written to stderr and `process.exitCode` is set to `1` so Node drains pending I/O before exiting. The shared `USAGE_INCOMPLETE_NOTE` constant is emitted in both status and result human output when `usageIncomplete` is true, advising the user to prefer proxy/provider billing for wire cost.

`formatDiagnosticLine` renders one compact ordered line per diagnostic entry (`attempt N: <stopReason> -> <outcome> [codes]`), deduplicating error codes while preserving first-seen order. `appendStage4Diagnostics` augments a list of human-output lines with the per-attempt diagnostic sequence of a failed stage-4 task when `diagnosticHistory` is present on the checkpoint.

## batch human output formatting
<!-- lw:anchors packages/cli/src/commands/batch.ts#formatStatusHuman packages/cli/src/commands/batch.ts#formatResultHuman packages/cli/src/commands/batch.ts#formatListHuman packages/cli/src/commands/batch.ts#setExitCode -->

`formatStatusHuman` produces a token-first report: total tokens, per-stage tokens, an optional USD "estimated" block (omitted when no model has pricing), per-module tokens, and a failure list. For each stage-4 failure the per-attempt diagnostic sequence is appended.

`formatResultHuman` summarizes a run result with the same token-first discipline plus circuit-breaker and failure sections.

`formatListHuman` enumerates known runs with id, status, started/finished timestamps; an empty repo prints `(none)`.

`setExitCode` maps run status to a process exit code (`completed` → `0`, `completed_with_failures` → `1`, `aborted` → `2`). When `--json` is used, exit code is left at `0` to preserve structured-output convention.

## export command
<!-- lw:anchors packages/cli/src/commands/export.ts#registerExport -->

`registerExport` attaches `livewiki export <target>` with `--push <remote>`. The current implementation is a Phase-0 stub produced via `makeStubAction`; the planned behavior is a one-way transformation that flattens the namespace, rewrites links, and strips anchor frontmatter, with optional push to a git remote.

## index command (Phase 1+2)
<!-- lw:anchors packages/cli/src/commands/index-cmd.ts#registerIndex packages/cli/src/commands/index-cmd.ts#collectIgnore packages/cli/src/commands/index-cmd.ts#emit packages/cli/src/commands/index-cmd.ts#formatLedgerHuman -->

`registerIndex` attaches `livewiki index`. It accepts repeatable `--ignore <pattern>`, `--no-ledger` (skip the anchor-ledger pass), and `--quiet` (suppress human output without producing JSON — used by hooks). It chains the indexer and, unless `--no-ledger` is set, the anchor-ledger. Missing `.livewiki/` is auto-created silently; missing `livewiki/` is reported as info. Errors set `process.exitCode = 1`.

`collectIgnore` is the Commander accumulator for repeatable `--ignore` values, appending each new entry to `previous`.

`emit` centralizes output: in quiet+non-JSON mode it writes nothing; in JSON mode it writes `{ ok, index, ledger }`; otherwise it writes the human indexer formatter followed by `formatLedgerHuman` when a ledger result exists.

`formatLedgerHuman` summarizes the ledger pass: pages processed/skipped, anchors upserted, debt by event (`changed`/`moved`/`deleted`), undocumented symbol count, and any moved pairs.

## init command (Phase 3)
<!-- lw:anchors packages/cli/src/commands/init.ts#registerInit packages/cli/src/commands/init.ts#formatHuman -->

`registerInit` attaches `livewiki init`. Flags:

- `--batch` → run the full LLM pipeline (stages 1–4)
- `--plan` → emit the heuristic module plan without writing or calling the LLM
- `--no-refine` → skip LLM refinement of stage 2 (Commander exposes this as `refine === false`, not `noRefine`)

`runInit` is invoked with the resolved repo root and translated options. In JSON mode the result object is emitted as-is; otherwise `formatHuman` renders it. When `--batch` was used and JSON was not requested, `process.exitCode` is set to `batchExitCode`. Errors set `process.exitCode = 1` (the comment notes that `process.exit(1)` is avoided because abrupt exit can trigger libuv STATUS_STACK_BUFFER_OVERRUN on Windows while async handles are still open).

`formatHuman` has two layouts: with `plan` it prints module/file/symbol/edge counts and the ordered list; without `plan` it lists files written plus an optional batch summary block (runId, status, tasks done/failed, exit code).

## pointer command (Phase 5)
<!-- lw:anchors packages/cli/src/commands/pointer.ts#registerPointer packages/cli/src/commands/pointer.ts#promptYesNo packages/cli/src/commands/pointer.ts#formatPointerResult packages/cli/src/commands/pointer.ts#formatStatusHuman packages/cli/src/commands/pointer.ts#_internal -->

`registerPointer` attaches `livewiki pointer`. Per SPEC inviolable rule #2, the pointer in `AGENTS.md`/`CLAUDE.md` is **never** written automatically — it requires an explicit flag (`--write-pointer` or `--yes`) or interactive confirmation on a TTY. Supported flags: `--remove`, `--file <name>` (must be a member of `POINTER_FILES`), `--block <text>` (custom block content), and `--yes`.

Modes:

- no flags → read-only status
- `--write-pointer` / `--yes` → write the block
- `--remove` → remove the block (destructive; prompts on TTY unless an explicit flag is set)

In non-TTY mode without an explicit flag, the command fails closed: stderr message plus `process.exitCode = 1`. Errors set `process.exitCode = 1`.

`promptYesNo` reads a single line from stdin and resolves to `true` only for `y` or `yes` (case-insensitive).

`formatPointerResult` produces a one- or two-line summary using past-tense verbs derived from `action` (`inserted` → "wrote", `replaced` → "updated", unchanged cases) or the literal "removed", plus a `+/-N bytes` annotation when non-zero.

`formatStatusHuman` either reports "not present (run with --write-pointer to add)" or prints the existing block fenced between `---` markers with the file it lives in.

`_internal` re-exports `nodeFs` for tests; it is not part of the user-facing surface.

## serve command
<!-- lw:anchors packages/cli/src/commands/serve.ts#registerServe -->

`registerServe` attaches `livewiki serve`. The current implementation is a Phase-0 stub via `makeStubAction`; the planned behavior is an MCP server on stdio exposing six tools (`livewiki_quickstart`, `read`, `search`, `debt`, `write_doc`, `resolve_debt`).

## status command (Phase 1/2)
<!-- lw:anchors packages/cli/src/commands/status.ts#registerStatus -->

`registerStatus` attaches `livewiki status`. It accepts `--top <n>` (default `10`) for the size of the "top files" list. It runs the core status reporter and emits either JSON (`{ ok, ...report }`) or the human formatter. Errors set `process.exitCode = 1` so the event loop can drain.

## stub helper (Phase 0)
<!-- lw:anchors packages/cli/src/commands/stub.ts#makeStubAction -->

`makeStubAction(info)` returns a Commander action handler that:

- inherits globals (`--json`, `--repo`) via `optsWithGlobals()`
- emits a structured stub record (`ok: false`, `stub`, `phase`, `repoRoot`, `message`, `planned`) under JSON
- emits a human line of the form `livewiki <name>: stub (Fase <phase> da SPEC). Implementação prevista: <planned>`
- always exits `0` (the command executed; it is simply not implemented yet)

`StubInfo` carries `name`, `phase` (SPEC phase 1–7), and a short `planned` description.

## update command (Phase 5)
<!-- lw:anchors packages/cli/src/commands/update.ts#registerUpdate packages/cli/src/commands/update.ts#formatHuman -->

`registerUpdate` attaches `livewiki update`. Flags:

- `--llm` → pay debt via the configured API (currently returns exit `1` with a stderr hint to use `livewiki batch resume` or `livewiki init --batch`)
- `--record-write <tokens>` → records doc-written-back metrics and exits (does not emit a work package); validates that the value is a non-negative integer
- `--snippet-window <lines>` (default `20`) → window per anchor

Default behavior emits a work package: `{ ok, package, economy }` in JSON, where `economy` compares `pkg.tokensEstimated` against an estimated `~12500`-token full-repo read. Errors set `process.exitCode = 1`.

`formatHuman` prints the manifest pointer (`lastDocumentedCommit`, optional `pendingBatch`), the first 5 debt items, snippet/anchor counts, the token estimate, and a one-line thesis statement.

## verify command (Phase 2)
<!-- lw:anchors packages/cli/src/commands/verify.ts#registerVerify -->

`registerVerify` attaches `livewiki verify`. It runs the core validator and either writes JSON (`VerifyResult`) or the human formatter. CI-friendly: if `result.ok` is `false`, `process.exitCode` is set to `1`. Errors during the run set `process.exitCode = 1` after writing to stderr (avoiding `process.exit(1)` so Node drains pending stderr I/O).

## view command
<!-- lw:anchors packages/cli/src/commands/view.ts#registerView -->

`registerView` attaches `livewiki view`. The current implementation is a Phase-0 stub via `makeStubAction`. It accepts `--template <name>` (default `agent`, alternative `docs`) and `--out <dir>` (default `.livewiki/site/`). The planned behavior is a self-contained static site (HTML+CSS+JS) with client-side search and Mermaid, with templates carried as data.