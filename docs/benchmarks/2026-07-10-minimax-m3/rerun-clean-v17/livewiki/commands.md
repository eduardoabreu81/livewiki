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

This module wires the `livewiki` CLI subcommands. Each file under `packages/cli/src/commands/` exports one or more `registerXxx` functions that attach a command to the root `Command` program (Commander 12). The shared `StubInfo` / `makeStubAction` helper exists so Phase-0 placeholders can keep a uniform `(json | human)` output while waiting for their real implementation.

## `batch` — run/resume/inspect a Phase-3 batch
<!-- lw:anchors packages/cli/src/commands/batch.ts#registerBatch packages/cli/src/commands/batch.ts#USAGE_INCOMPLETE_NOTE packages/cli/src/commands/batch.ts#formatStatusHuman packages/cli/src/commands/batch.ts#formatResultHuman packages/cli/src/commands/batch.ts#formatListHuman -->

`registerBatch(program)` attaches the top-level `livewiki batch` command. With no positional args it reports the status of the most recent run; with subcommands it dispatches to `list`, `status [runId]`, `resume <runId>`, or `--only <target> <runId>`. The `--no-refine` flag is forwarded as `noRefine: true` to `resumeBatch` / `runOnly` (Commander flips `--no-<x>` into the boolean `<x>` field, not `no<x>`). Exit codes follow the SPEC: `completed` → 0, `completed_with_failures` → 1, `aborted` → 2; `--json` always exits 0 because the structured payload is the contract.

`USAGE_INCOMPLETE_NOTE` is a shared, exported string rendered on both the status and result human outputs whenever totals are incomplete (some attempts report unknown usage). It nudges users toward the proxy / provider billing for the authoritative wire cost.

`formatStatusHuman(report)` renders the run summary. Tokens are the primary metric (input + output, with model list in parens); USD is secondary — a separate "estimated" block when any model has pricing, otherwise an "omitted" line — and per-module token / USD rows are shown if present. Each failure entry gets a `retry:` command, and stage-4 failures additionally get the diagnostic sequence appended.

`formatResultHuman(result)` mirrors the status layout for a freshly returned `runBatch` result: tokens first, optional USD, then `tasks done`, `failures`, and a `circuit breaker: TRIGGERED` line when applicable. Each failure prints its error code, module, message, and retry command.

`formatListHuman(runs)` prints the `batch list` view: one row per run with id, status, started/finished ISO timestamps; emits `(none)` when the run table is empty.

## `batch` — diagnostics + exit-code helper
<!-- lw:anchors packages/cli/src/commands/batch.ts#appendStage4Diagnostics packages/cli/src/commands/batch.ts#formatDiagnosticLine packages/cli/src/commands/batch.ts#setExitCode -->

`formatDiagnosticLine(d)` is the per-attempt one-liner used inside `repair_exhausted` style output: `attempt <n>: <stopReason|-> -> <outcome> [<deduped codes>]`. Codes are deduplicated while preserving first-seen order so the visible sequence matches the validator enumeration.

`appendStage4Diagnostics(lines, report, failureTaskId)` is the helper `formatStatusHuman` calls for each stage-4 failure. It looks up the task by id, silently returns when the checkpoint predates diagnostics or the task never reached the LLM, otherwise pushes an `attempts:` block followed by one `formatDiagnosticLine` row per diagnostic entry.

`setExitCode(repoRoot, status, json)` translates a run `status` string into `process.exitCode`. With `--json` it is a no-op (the structured payload is the contract). For human output it maps `completed` → 0, `completed_with_failures` → 1, `aborted` → 2. Always invoked as the final statement of the action handler so the event loop drains before exit.

## `export` — Phase-6 stub
<!-- lw:anchors packages/cli/src/commands/export.ts#registerExport -->

`registerExport(program)` attaches `livewiki export <target>` and currently delegates to `makeStubAction({ name: "export", phase: 6, planned: "one-way transformation: flatten namespace, rewrite links, strip anchor frontmatter" })`. Accepts `--push <remote>` (declared as an option; ignored until Phase 6). Once the phase lands the stub is replaced with a real action of the same signature.

## `index` — reindex + ledger sync
<!-- lw:anchors packages/cli/src/commands/index-cmd.ts#registerIndex packages/cli/src/commands/index-cmd.ts#collectIgnore packages/cli/src/commands/index-cmd.ts#emit packages/cli/src/commands/index-cmd.ts#formatLedgerHuman -->

`registerIndex(program)` attaches `livewiki index`. Options: `--ignore <pattern>` (repeatable; aggregated via `collectIgnore`), `--no-ledger` (skip the anchor-ledger pass), `--quiet` (suppress human output without producing JSON — used by Phase-5 hooks). The action resolves the repo root, runs the core indexer, then chains the anchor-ledger unless `--no-ledger` is set, and feeds both results to the local `emit`. Missing `.livewiki/` is auto-created silently; a missing `livewiki/` only emits an info note (no hard dependency on `init`).

`collectIgnore(value, previous)` is the Commander accumulator for `--ignore`: `previous.concat(value)`, so repeated flags compose into a flat list passed as `extraIgnores`.

`emit(json, quiet, indexResult, ledgerResult)` decides what to write and where:
- `quiet && !json` → nothing on stdout (stderr still carries errors).
- `json` → `{ ok: true, index, ledger }` on stdout.
- otherwise → `formatIndexHuman(indexResult)` followed by `formatLedgerHuman(ledgerResult)` when present.

`formatLedgerHuman(r)` renders the ledger summary: pages processed / skipped, anchor upserts, debt by event (`changed`/`moved`/`deleted`), undocumented symbol count, and a `moved pairs:` block when any pairs exist.

## `init` — initialize livewiki + optional LLM pipeline
<!-- lw:anchors packages/cli/src/commands/init.ts#registerInit packages/cli/src/commands/init.ts#formatHuman -->

`registerInit(program)` attaches `livewiki init`. Options: `--batch` (run the full LLM pipeline), `--plan` (show the heuristic module plan; no LLM, no writes), `--no-refine` (skip LLM refinement of stage 2 — effective only with `--batch`). The action resolves the repo root, translates Commander's `--no-refine` into the `noRefine: true` flag the core expects (`opts.refine === false`, never `opts.noRefine`), invokes `runInit`, and forwards the result to `emit`. The batch exit code is propagated to `process.exitCode` only for the human path; `--json` preserves exit 0 per batch CLI convention. Errors are reported on stderr and `process.exitCode = 1` is set so the event loop can drain (avoids the libuv `STATUS_STACK_BUFFER_OVERRUN` that abrupt `process.exit(1)` can trigger on Windows when async handles — fetch, SQLite WAL, watcher — are still open).

`formatHuman(result)` branches on `result.plan`. When present (`init --plan`), it prints the module plan header, totals (modules / files / symbols / edges), and the prioritized `Ordered:` list. Otherwise it prints `init: OK`, the `files written` list, and — when `--batch` ran — a batch summary block with run id, status, tasks done/failed, and propagated exit code.

## `pointer` — opt-in AGENTS.md / CLAUDE.md pointer
<!-- lw:anchors packages/cli/src/commands/pointer.ts#registerPointer packages/cli/src/commands/pointer.ts#promptYesNo packages/cli/src/commands/pointer.ts#formatPointerResult packages/cli/src/commands/pointer.ts#formatStatusHuman packages/cli/src/commands/pointer.ts#_internal -->

`registerPointer(program)` attaches `livewiki pointer`. The action enforces Inviolable rule #2 — *"Pointer in AGENTS.md/CLAUDE.md: only with an explicit flag (`--write-pointer`) or interactive confirmation. Never automatic."* Mode dispatch:
- no flags → read-only status (auto-detects or honours `--file`).
- `--write-pointer` / `--yes` → writes the block (explicit opt-in, no prompt).
- TTY without flags → interactive `promptYesNo` flow; if the pointer is already present the status is shown and no write occurs.
- non-TTY without `--write-pointer` / `--yes` → fail closed: stderr message + exit code 1.
- `--remove` → removes the block, with the same explicit-flag / confirmation guard (removal is destructive so confirmation is requested even when a TTY is present without an explicit flag).

`--file <name>` is validated against `POINTER_FILES` (`AGENTS.md` / `CLAUDE.md`); invalid values print to stderr and exit 1. `--block <text>` overrides the default `buildPointerBlock()` content.

`promptYesNo(question)` writes the prompt to stdout, subscribes to stdin `data` / `end`, collects a single line, and resolves `true` for any case-insensitive `y` / `yes` prefix; pauses stdin after the first newline.

`formatPointerResult(result, verb)` picks the past tense based on `verb` (`wrote` / `removed`) and the underlying action (`inserted` → "wrote", `replaced` → "updated", other → "unchanged"), then prints the file plus a signed byte delta when non-zero.

`formatStatusHuman(status)` returns a one-line "not present — run with `--write-pointer` to add" when the pointer is absent, otherwise renders `present in <file>` followed by the block contents delimited by `---` fences.

`_internal = { nodeFs }` is a re-export of the `node:fs/promises` namespace used by the pointer code; the `_internal` prefix signals that it is reserved for tests and is not part of the userspace surface.

## `serve` — Phase-4 stub
<!-- lw:anchors packages/cli/src/commands/serve.ts#registerServe -->

`registerServe(program)` attaches `livewiki serve` and delegates to `makeStubAction({ name: "serve", phase: 4, planned: "MCP server stdio with 6 tools (livewiki_quickstart/read/search/debt/write_doc/resolve_debt)" })`. When Phase 4 lands the stub is replaced with the real `(cmd) => Promise<void>` action.

## `status` — open debt + undocumented symbols
<!-- lw:anchors packages/cli/src/commands/status.ts#registerStatus -->

`registerStatus(program)` attaches `livewiki status`. The single option is `--top <n>` (default `10`, parsed as base-10 int). The action uses `command.optsWithGlobals()` to read both local options and the global `--json` / `--repo`, calls `runStatus(repoRoot, { topN })`, and writes the report via JSON or `formatStatusHuman` based on `--json`. Errors are reported on stderr and `process.exitCode = 1` is set so Node drains pending I/O.

## `stub` — Phase-0 helper for placeholder commands
<!-- lw:anchors packages/cli/src/commands/stub.ts#makeStubAction -->

`makeStubAction(info)` returns a Commander action handler. It reads `--json` / `--repo` from `command.optsWithGlobals()`, resolves the repo root, and calls `emit` with a uniform payload — `{ ok: false, stub: info.name, phase, repoRoot, message: "stub da Fase 0 — implementação prevista para Fase <N>", planned }` for JSON, or a one-line human message — and always exits 0 (the command executed; it just isn't implemented yet). Once the corresponding phase ships, the caller replaces `makeStubAction({...})` with the real `(options, command) => Promise<void>` action, keeping the same signature.

## `update` — incremental mode + token accounting
<!-- lw:anchors packages/cli/src/commands/update.ts#registerUpdate packages/cli/src/commands/update.ts#formatHuman -->

`registerUpdate(program)` attaches `livewiki update`. The action dispatches on three mutually exclusive paths:

1. `--record-write <tokens>` — validates the arg (non-negative int), records the metric via `recordDocWrittenBack` (with bytes estimated as `tokens * 4`), and emits a one-line confirmation. No work package is produced in this branch.
2. `--llm` — currently fail-closed with a stderr message pointing the user at `init --batch` or `batch resume <runId>`; full delegation to the batch orchestrator lands with Phase 3.
3. default — loads the work package via `loadWorkPackage(repoRoot, { snippetWindow? })`, computes a one-line "economy" summary (estimated full-read baseline = 12500 tokens, saved ratio = `1 - pkg.tokensEstimated / 12500`, clamped at 0), and emits both the structured summary and `formatHuman(pkg)`.

Global `--json` / `--repo` are read via `optsWithGlobals()`. Errors use `process.exitCode = 1` (not `process.exit(1)`) to keep libuv happy on Windows when async handles are open.

`formatHuman(pkg)` prints the work package header. If the manifest is absent it instructs the user to run `livewiki init`; otherwise it shows `lastDocumentedCommit`, an optional `pendingBatch: run #<id> (<done>/<total>)` line, up to the first 5 debt items with `[event] key (assignee=…, wiki=…)`, a `… +N more` continuation when the debt list is longer, the snippet / valid-anchor counts, the estimated-tokens / bytes line, and the thesis: focused package vs. re-reading the repo (~12500 tokens) for economy.

## `verify` — CI-friendly wiki validation
<!-- lw:anchors packages/cli/src/commands/verify.ts#registerVerify -->

`registerVerify(program)` attaches `livewiki verify`. The action invokes `runVerify(repoRoot)`, writes the structured result via `--json` or `formatVerifyHuman` for human output, and sets `process.exitCode = 1` whenever `result.ok === false` (CI-friendly). Errors are reported on stderr with `process.exitCode = 1`, again letting the event loop drain before exit.

## `view` — Phase-7 stub
<!-- lw:anchors packages/cli/src/commands/view.ts#registerView -->

`registerView(program)` attaches `livewiki view` and delegates to `makeStubAction({ name: "view", phase: 7, planned: "static site with client-side search + Mermaid + templates as data" })`. Options `--template <name>` (`agent` | `docs`, default `agent`) and `--out <dir>` (default `.livewiki/site/`) are declared but ignored until Phase 7.