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

## `batch` command (Phase 3)
<!-- lw:anchors packages/cli/src/commands/batch.ts#registerBatch packages/cli/src/commands/batch.ts#USAGE_INCOMPLETE_NOTE packages/cli/src/commands/batch.ts#setExitCode -->

The `livewiki batch` command drives a full-documentation run. `registerBatch` attaches the `batch` subcommand tree to the top-level `program`. Its dispatcher routes by positional argument:

- no args → status of the last run via `buildStatusReport`,
- `list` → `listRuns`,
- `status [runId]` → `buildStatusReport(absRoot, runId)`,
- `resume <runId>` → `resumeBatch` (with `noRefine` when `--no-refine` was passed),
- `--only <target> <runId>` → `runOnly`.

Commander maps `--no-refine` to `opts.refine === false`; the dispatcher spreads `{ noRefine: true }` only when that property is `false`. Errors are written to stderr and surfaced via `process.exitCode = 1` so Node can drain pending I/O before exit.

`setExitCode(repoRoot, status, json)` translates a run status into an exit code without calling `process.exit` directly:

| status | exit code |
| --- | --- |
| `completed` | 0 |
| `completed_with_failures` | 1 |
| `aborted` (circuit breaker) | 2 |

When `--json` is set the function returns early and the structured-output convention of exit 0 is preserved.

`USAGE_INCOMPLETE_NOTE` is a shared string that warns the user when totals are incomplete (some attempts have unknown usage) and steers them toward proxy/provider billing for wire cost. It is interpolated by both `formatStatusHuman` and `formatResultHuman`.

## `batch` human formatters
<!-- lw:anchors packages/cli/src/commands/batch.ts#formatStatusHuman packages/cli/src/commands/batch.ts#formatResultHuman packages/cli/src/commands/batch.ts#formatListHuman packages/cli/src/commands/batch.ts#formatDiagnosticLine packages/cli/src/commands/batch.ts#appendStage4Diagnostics -->

`formatStatusHuman` renders a status report with tokens as the primary metric and USD as a secondary line. Tokens are printed first per stage and per module; USD appears only when at least one stage or total has a price, otherwise a single line records that USD was omitted. When `usageIncomplete` is set, `USAGE_INCOMPLETE_NOTE` is appended under the token totals. For each stage-4 failure the formatter appends a per-task diagnostic sequence.

`formatResultHuman` prints a single-run summary with token totals, an optional estimated USD line, done/failures counts, a `circuit breaker: TRIGGERED` line when applicable, and a `Failures:` block with retry commands.

`formatListHuman` renders the `list` subcommand output: each run id, status, started timestamp, and finished timestamp (or `(running)` if null).

`formatDiagnosticLine(d)` produces one compact ordered line per diagnostic entry: `attempt <n>: <stopReason|"-"> -> <outcome> [<code>, ...]`. Error codes are deduplicated while preserving first-seen order so the user can match against the validator enumeration.

`appendStage4Diagnostics(lines, report, failureTaskId)` finds the failed task and, when `diagnosticHistory` is present and non-empty, appends an `attempts:` block whose lines come from `formatDiagnosticLine`. It returns silently for checkpoints that pre-date diagnostics or for tasks that never reached the LLM (e.g. `refused_human_page`).

## `export` command (Phase 6, stub)
<!-- lw:anchors packages/cli/src/commands/export.ts#registerExport -->

`registerExport` attaches the `export <target>` subcommand and delegates its action to `makeStubAction` with `phase: 6`. The planned transformation is one-way: flatten namespace, rewrite links, strip anchor frontmatter. The `--push <remote>` flag is declared but unused by the stub.

## `index` command
<!-- lw:anchors packages/cli/src/commands/index-cmd.ts#registerIndex packages/cli/src/commands/index-cmd.ts#collectIgnore packages/cli/src/commands/index-cmd.ts#emit packages/cli/src/commands/index-cmd.ts#formatLedgerHuman -->

`registerIndex` attaches the `index` subcommand. It reindexes the repository and, by default, chains the anchor-ledger pass so changed/moved/deleted debt is recomputed in the same invocation. Options:

- `--ignore <pattern>` — repeatable, accumulated by `collectIgnore`,
- `--no-ledger` — skip the ledger pass (Commander exposes this as `opts.ledger === false`),
- `--quiet` — suppress human output without producing JSON (used by hooks).

`collectIgnore(value, previous)` returns `previous.concat(value)` so Commander can build an array across repeated `--ignore` flags. Only `extraIgnores` is forwarded when the array is non-empty.

`emit(json, quiet, indexResult, ledgerResult)` centralizes output. When `quiet && !json` it returns immediately (hooks rely on a separate `status --json` call to detect debt, so no stdout is emitted). In JSON mode it prints a single object `{ ok: true, index, ledger }`. In human mode it prints `formatIndexHuman(indexResult)` followed by `formatLedgerHuman(ledgerResult)` when the ledger ran.

`formatLedgerHuman(r)` renders the ledger result as a status line, processed/skipped page counts, anchor upsert count, debt breakdown (`+changed +moved +deleted`), undocumented symbol count, and a moved-pairs list when present.

## `init` command (Phase 3)
<!-- lw:anchors packages/cli/src/commands/init.ts#registerInit packages/cli/src/commands/init.ts#formatHuman -->

`registerInit` attaches the `init` subcommand. Without `--batch` it creates `livewiki/` and `.livewiki/`, indexes, and emits a deterministic layout (quickstart, diagrams, manifest) with no LLM. With `--batch` the full LLM pipeline (stages 1–4) runs. `--plan` produces the module plan without writes or LLM. `--no-refine` skips LLM refinement of stage 2 (stage 2 stays heuristic-only).

The action calls `runInit` with the resolved repo root and propagates `--batch`, `--plan`, and a derived `noRefine` flag (`opts.refine === false`). When `--json` is not set, the batch exit code is forwarded via `process.exitCode`. Errors are reported to stderr and the process is left to drain via `process.exitCode = 1`.

`formatHuman(result)` produces two distinct renderings:

- **Plan mode** (`result.plan` set): a `livewiki init --plan (no writes, no LLM):` heading followed by module count, file count, symbol count, edge count, and the prioritized ordered module list.
- **Standard mode**: `livewiki init: OK`, every file written, and an optional `batch run #<id>: <status>` block with task counts and exit code.

## `pointer` command (Phase 5)
<!-- lw:anchors packages/cli/src/commands/pointer.ts#registerPointer packages/cli/src/commands/pointer.ts#promptYesNo packages/cli/src/commands/pointer.ts#formatPointerResult packages/cli/src/commands/pointer.ts#formatStatusHuman packages/cli/src/commands/pointer.ts#_internal -->

`registerPointer` attaches the `pointer` subcommand. Per inviolable rule #2 the command never writes outside `livewiki/` automatically: a write requires `--write-pointer` (or its alias `--yes`) or an interactive y/N confirmation in a TTY. In non-interactive mode without one of those flags the command writes a stderr message and sets `process.exitCode = 1`.

The action validates `--file` against `POINTER_FILES`, then routes by mode:

- **No flags**: reports current status (read-only) using `formatStatusHuman`.
- **`--write-pointer` / `--yes`**: inserts via `insertPointer` with an optional `--block <text>` override (otherwise `buildPointerBlock()` is used) and renders with `formatPointerResult(result, "wrote")`.
- **`--remove`**: requires `--write-pointer`/`--yes` in non-interactive mode; in a TTY it prompts via `promptYesNo` before calling `removePointer`. Result is rendered with `formatPointerResult(result, "removed")`.
- **TTY + no flag**: reads current status. If the pointer is present, prints it; otherwise prompts the user with the would-be block and inserts on confirmation.

`promptYesNo(question)` writes the question to stdout, then resolves on the first newline (or stdin `end`) by comparing the lowercased answer to `y`/`yes`. It pauses stdin after resolution.

`formatPointerResult(result, verb)` maps the action enum onto a past tense verb: `inserted → wrote`, `replaced → updated`, otherwise `unchanged` (or `removed` for the removal verb). It prints the target file and, when nonzero, a signed byte delta.

`formatStatusHuman(status)` returns either `livewiki pointer: not present (run with --write-pointer to add)` or a fenced block showing the inner content of the existing pointer.

`_internal = { nodeFs }` re-exports `node:fs/promises` so tests can stub filesystem access without exposing anything to user-space.

## `serve` command (Phase 4, stub)
<!-- lw:anchors packages/cli/src/commands/serve.ts#registerServe -->

`registerServe` attaches the `serve` subcommand and delegates to `makeStubAction` with `phase: 4`. The stub describes the planned behavior: an MCP server on stdio exposing six tools (`livewiki_quickstart`, `read`, `search`, `debt`, `write_doc`, `resolve_debt`).

## `status` command
<!-- lw:anchors packages/cli/src/commands/status.ts#registerStatus -->

`registerStatus` attaches the `status` subcommand. It resolves the repo root, parses `--top <n>` (default `10`) into an integer `topN`, and runs `runStatus(repoRoot, { topN })`. In JSON mode it writes `{ ok: true, ...report }`; otherwise it writes `formatStatusHuman(report)`. Errors set `process.exitCode = 1`. The command reports open debt, undocumented symbols, and pending batch progress.

## `stub` helper
<!-- lw:anchors packages/cli/src/commands/stub.ts#makeStubAction -->

`makeStubAction(info)` returns a Commander action handler that honors the inherited `--json` and `--repo` globals via `command.optsWithGlobals()`. It emits a structured `{ ok: false, stub, phase, repoRoot, message, planned }` payload under `--json`, or a single human line `livewiki <name>: stub (Fase <phase> ...). Implementação prevista: <planned>`. Exit code is left at 0 because the command itself executed — only its implementation is pending. The exported `StubInfo` interface carries `name`, `phase`, and a short `planned` description. The helper is used by `registerExport`, `registerServe`, and `registerView` to defer their Phase 6/4/7 work without breaking the CLI surface.

## `update` command (Phase 5)
<!-- lw:anchors packages/cli/src/commands/update.ts#registerUpdate packages/cli/src/commands/update.ts#formatHuman -->

`registerUpdate` attaches the `update` subcommand. The action runs in three modes:

1. **`--record-write <tokens>`**: validates a non-negative integer, computes `bytes = tokens * 4` (chars-per-token estimate), and calls `recordDocWrittenBack`. Emits `{ ok: true, recorded: { tokens, bytes } }` (JSON) or `recorded N tokens written back (est. M bytes)` (human). Does not emit a work package.
2. **`--llm`**: writes a stderr message explaining that this delegates to the batch orchestrator and sets `process.exitCode = 1`. The expected workflow is `livewiki init --batch` (start) or `livewiki batch resume <runId>` (continue).
3. **Default**: parses `--snippet-window <lines>` (default `20`), calls `loadWorkPackage`, computes an `economy.savedRatio` against an estimated full-read baseline of 12500 tokens, and emits `{ ok: true, package, economy }` or `formatHuman(pkg)`.

`formatHuman(pkg)` prints the package header: `lastDocumentedCommit`, any pending batch progress, the first 5 debt items with event/symbol_key/assignee/wiki_path, a `+N more` line if debt is larger, snippet and `validAnchors` counts, the estimated token/byte total, and a one-line thesis comparing the focused package against a full repo re-read.

`runStatus` is re-exported so other commands can reuse the status driver.

## `verify` command
<!-- lw:anchors packages/cli/src/commands/verify.ts#registerVerify -->

`registerVerify` attaches the `verify` subcommand. It calls `runVerify(repoRoot)` and emits either the raw `VerifyResult` (JSON) or `formatVerifyHuman(result)` (human). On any thrown error it writes stderr and sets `process.exitCode = 1`. When `result.ok === false` (broken anchors, altered manual blocks, or internal-link issues) it also sets `process.exitCode = 1`, making the command CI-friendly. The success path leaves `process.exitCode` untouched so other code paths can override it if needed.

## `view` command (Phase 7, stub)
<!-- lw:anchors packages/cli/src/commands/view.ts#registerView -->

`registerView` attaches the `view` subcommand and delegates to `makeStubAction` with `phase: 7`. The stub declares `--template <name>` (default `agent`) and `--out <dir>` (default `.livewiki/site/`). The planned behavior is a self-contained static site with HTML/CSS/JS, client-side search, Mermaid rendering, and templates as data.