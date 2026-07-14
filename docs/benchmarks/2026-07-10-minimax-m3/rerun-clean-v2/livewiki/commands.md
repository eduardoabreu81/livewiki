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

The `commands/` module wires livewiki subcommands into the Commander `program` instance. Each `registerX` function mounts one command on the top-level CLI (`livewiki <cmd>`). The module also contains shared formatters, the stub factory used by Phase-0 placeholders, and helpers such as the `--ignore` collector and the pointer `promptYesNo`.

Conventions:

- Global flags `--json` and `--repo` are inherited from the parent program and read via `command.optsWithGlobals()`.
- Human output is token-first: tokens are the primary metric, USD appears as a secondary "estimated" line (or is omitted without drama when no pricing exists in the model table).
- Exit codes follow a layered convention. `--json` always exits 0 (structured output). Base commands exit 0 on success; commands that delegate to a run status (`init --batch`, `batch`) propagate the batch exit code (`0 = completed`, `1 = completed_with_failures`, `2 = aborted`).
- Errors set `process.exitCode` rather than calling `process.exit(...)` directly, so the event loop can drain (avoids libuv `STATUS_STACK_BUFFER_OVERRUN` on Windows when async handles are open).

## batch (Phase 3)
<!-- lw:anchors packages/cli/src/commands/batch.ts#registerBatch packages/cli/src/commands/batch.ts#formatStatusHuman packages/cli/src/commands/batch.ts#formatResultHuman packages/cli/src/commands/batch.ts#formatListHuman packages/cli/src/commands/batch.ts#setExitCode -->

`registerBatch` mounts `livewiki batch`, the Phase-3 orchestrator. It dispatches on positional args:

- No args: status of the last run (`buildStatusReport` → `formatStatusHuman`).
- `batch list`: enumerates runs (`listRuns` → `formatListHuman`).
- `batch status [<runId>]`: alias of the no-args form, optionally scoped.
- `batch resume <runId>`: continues pending/failed tasks (`resumeBatch` → `formatResultHuman`).
- `--only <target>`: re-runs one task via `runOnly`.
- `<runId>` (bare integer): alias of `status <runId>`.

Flags:

- `--only <target>` — re-run a single module or task-id.
- `--no-refine` — skip LLM refinement of stage 2; forwarded only when set.

All status and result paths route through `setExitCode`, which maps `completed → 0`, `completed_with_failures → 1`, `aborted → 2` (unless `--json` is set, in which case `--json` always exits 0). Errors are caught, written to stderr, and surfaced via `process.exitCode = 1`.

The formatters are token-first per `ad87319`:

- `formatStatusHuman` prints run header (id, status, started/finished timestamps, startedBy), then token totals (input + output, with models in parentheses), then per-stage token lines, then a USD block (estimated, with `pricingRefDate`) only if at least one model has a price, then per-module token lines, then failures with `[code] module: message` and `retry:` line.
- `formatResultHuman` prints run header, token totals, optional USD line, task counts, optional `circuit breaker: TRIGGERED`, and the same failure block when present.
- `formatListHuman` prints `Batch runs:` followed by one row per run: `#id  STATUS  started ISO  finished ISO|(running)`.

## export (stub, Phase 6)
<!-- lw:anchors packages/cli/src/commands/export.ts#registerExport -->

`registerExport` mounts `livewiki export <target>` and binds it to `makeStubAction({ name: "export", phase: 6, planned: "one-way transformation: flatten namespace, rewrite links, strip anchor frontmatter" })`. The action honors `--push <remote>` for the future git publish, but the body is the Phase-0 stub emitter today.

## index (Phase 1+2)
<!-- lw:anchors packages/cli/src/commands/index-cmd.ts#registerIndex packages/cli/src/commands/index-cmd.ts#collectIgnore packages/cli/src/commands/index-cmd.ts#emit packages/cli/src/commands/index-cmd.ts#formatLedgerHuman -->

`registerIndex` mounts `livewiki index`. It is idempotent and incremental: missing `.livewiki/` is auto-created without warning; a missing `livewiki/` emits an info note (suggesting `init`, Phase 3) but never refuses.

Flags:

- `--ignore <pattern>` — repeatable, accumulated by `collectIgnore(value, previous)` which `return previous.concat(value)`. Forwarded as `extraIgnores` only when at least one value exists.
- `--no-ledger` — skip the anchor-ledger post-pass; commander surfaces this as `opts.ledger === false`.
- `--quiet` — suppress human output without producing JSON (used by hooks, Phase 5). `emit` treats `quiet` and `json` as twin suppressors of human output.

The action runs `runIndexer` (from `@livewiki/core/indexer`), then chains `runLedger` (from `@livewiki/core/anchor-ledger`) unless `--no-ledger` was passed. Results are passed to the local `emit(json, quiet, indexResult, ledgerResult)`, which:

- Returns silently when `quiet && !json` (so hooks consume no stdout; stderr still carries errors).
- In `--json` mode, prints `{ ok: true, index, ledger }` as a single line.
- Otherwise prints `formatIndexHuman(indexResult)` followed by `formatLedgerHuman(ledgerResult)` if present.

`formatLedgerHuman` renders a one-shot summary: `pages` (processed/skipped), `anchors` upserts, debt by event (`changed`, `moved`, `deleted`), undocumented symbol count, and any moved pairs.

## init (Phase 3)
<!-- lw:anchors packages/cli/src/commands/init.ts#registerInit packages/cli/src/commands/init.ts#formatHuman -->

`registerInit` mounts `livewiki init`, which creates `livewiki/` + `.livewiki/`, indexes the repo, and lays out deterministic scaffold (quickstart, diagrams, manifest) without any LLM call.

Flags:

- `--batch` — runs the full LLM pipeline (stages 1–4).
- `--plan` — shows the heuristic module plan, with no LLM call and no writes.
- `--no-refine` — forwarded to the batch pipeline to skip LLM refinement of stage 2.

The action calls `runInit` and forwards whichever flags were explicitly set (the spread-conditional pattern keeps `undefined` out of the payload). Output goes through `emit`, then propagates `result.batchExitCode` into `process.exitCode` (unless `--json` was passed, which preserves exit 0 per batch CLI convention). Errors set `process.exitCode = 1` rather than calling `process.exit(1)` — this is the FIX L (rev2) pattern shared across commands, intended to keep libuv from asserting on a non-empty handle queue on Windows.

`formatHuman` has two modes:

- Plan mode (`result.plan` present): prints `modules/files/symbols/edges` counts, then the ordered prioritized list with `(N files, M symbols)` per item.
- Apply mode: prints `files written: <N>` followed by one path per line, then the batch summary block when `result.batchSummary` exists (`run #id: status`, `tasks: D done, F failed`, and the resolved exit code).

## pointer (Phase 5 — opt-in AGENTS.md / CLAUDE.md)
<!-- lw:anchors packages/cli/src/commands/pointer.ts#registerPointer packages/cli/src/commands/pointer.ts#promptYesNo packages/cli/src/commands/pointer.ts#formatPointerResult packages/cli/src/commands/pointer.ts#formatStatusHuman packages/cli/src/commands/pointer.ts#_internal -->

`registerPointer` mounts `livewiki pointer`, which manages the livewiki pointer block in `AGENTS.md` or `CLAUDE.md`. Per SPEC inviolable rule #2, writes are **never automatic**: they require an explicit flag (`--write-pointer` / `--yes`) or an interactive confirmation on a TTY. No flag and no TTY → the command fails closed with a clear message instructing the user to pass `--write-pointer`.

Modes:

- No flags → status only (`readPointerStatus` → `formatStatusHuman`).
- `--write-pointer` / `--yes` → write `buildPointerBlock()` (or `--block <text>` if provided) into the target file via `insertPointer`.
- `--remove` → strip the block via `removePointer`. Removal is destructive: without an explicit flag it asks for confirmation on a TTY and fails closed in non-interactive mode.

Other behaviors:

- `--file <name>` — force `AGENTS.md` or `CLAUDE.md`; anything outside `POINTER_FILES` writes to stderr and exits `1`. The value list is sourced from `@livewiki/core/pointer`.
- `--block <text>` — custom block payload; default is `buildPointerBlock()`.

`promptYesNo(question)` writes the prompt to stdout and resolves a single-line `y` / `yes` answer (case-insensitive). It listens for either the first `\n` on `process.stdin` or an `end` event, then resolves. Non-`y`/`yes` answers (including empty input) resolve to `false`.

`formatPointerResult(result, verb)` renders `"livewiki pointer: <verb> <file>"` plus a `(+N bytes)` line when the byte delta is nonzero. The past-tense verb is computed from `result.action` (`inserted → wrote`, `replaced → updated`, otherwise `unchanged`; removal always yields `removed`).

`formatStatusHuman(status)` returns `livewiki pointer: not present (run with --write-pointer to add)` when `status.present` is false, otherwise `present in <file>` followed by the captured inner block between `---` fences.

`_internal` is a test-only re-export of `nodeFs` from `node:fs/promises`. It is not part of the public API and exists solely so tests can stub filesystem operations.

## serve (stub, Phase 4)
<!-- lw:anchors packages/cli/src/commands/serve.ts#registerServe -->

`registerServe` mounts `livewiki serve` and binds it to `makeStubAction({ name: "serve", phase: 4, planned: "MCP server stdio with 6 tools (livewiki_quickstart/read/search/debt/write_doc/resolve_debt)" })`. The Phase-4 implementation will start the MCP server over stdio.

## status (Phase 1/2)
<!-- lw:anchors packages/cli/src/commands/status.ts#registerStatus -->

`registerStatus` mounts `livewiki status`, which renders the open-debt, undocumented-symbol, and pending-batch report. Phase 1 covers files + symbols; debt and undocumented enter in Phase 2.

Flags:

- `--top <n>` — how many files to show in the top list (default `10`, parsed with `Number.parseInt`; `NaN` falls through to `10`).

The action calls `runStatus(repoRoot, { topN })` from `@livewiki/core/status`. `--json` emits `{ ok: true, ...report }`; human mode prints `formatStatusHuman(report) + "\n"`. Errors write to stderr and exit 1.

## stub (Phase-0 placeholder helper)
<!-- lw:anchors packages/cli/src/commands/stub.ts#makeStubAction -->

`makeStubAction(info)` returns an `async (options, command)` action handler bound to a single subcommand placeholder. It:

- Reads `--json` and `--repo` via `command.optsWithGlobals()`, then resolves the repo root with `resolveRepoRoot(opts.repo)`.
- Emits a structured `{ ok: false, stub, phase, repoRoot, message, planned }` payload in `--json` mode, or `livewiki <name>: stub (Fase <phase> da SPEC). Implementação prevista: <planned>` on stdout otherwise.
- Exits 0 by default — invoking the stub is "the command ran, just unimplemented."

`StubInfo` carries `name`, `phase` (1–7 per the SPEC phases), and `planned` (a short sentence describing the future behavior). When the actual phase lands, callers replace `makeStubAction(...)` with the real implementation while keeping the same `(cmd: Command) => Promise<void>` shape.

## update (Phase 5 — incremental mode)
<!-- lw:anchors packages/cli/src/commands/update.ts#registerUpdate packages/cli/src/commands/update.ts#formatHuman -->

`registerUpdate` mounts `livewiki update`, the heart of the incremental workflow. Default behavior emits a work package — debt, snippets, validAnchors, and an estimated token count — for an in-session agent to pay. With `--llm`, the command delegates to the batch orchestrator (full mode, Phase 3); with `--record-write <tokens>`, it accounts for documentation written back without emitting a package.

Flags:

- `--llm` — delegate to batch (full mode). Today this is a stub that prints a guidance message and exits 1; the real path forwards to `runBatch` once that wiring lands.
- `--record-write <tokens>` — non-negative integer; tokens recorded via `recordDocWrittenBack` (dynamic import from `@livewiki/core/update`). Bytes are estimated at 4 chars/token. Output: `{ ok: true, recorded: { tokens, bytes } }`.
- `--snippet-window <lines>` — snippet window per anchor (default `20`); only forwarded when finite and > 0.

Default path:

- `loadWorkPackage(repoRoot, { snippetWindow? })` produces the package.
- A `summary` is computed for `--json` mode, comparing `pkg.tokensEstimated` against `estimatedFullReadTokens = 12500` and emitting `economy = max(0, 1 - pkg.tokensEstimated / estimatedFullReadTokens)` rounded to three decimal places.
- Human output via `formatHuman` shows the manifest header (`lastDocumentedCommit`, optional `pendingBatch` as `run #id (done/total)`), then debt (`[event] symbol_key (assignee=X, wiki=Y)` for the first 5, with a `... +N more` overflow line), then `snippets` and `validAnchors` counts, and finishes with the token estimate and the economy thesis line.

Error paths set `process.exitCode = 1` (FIX L rev2 pattern).

## verify (Phase 2 — CI-friendly)
<!-- lw:anchors packages/cli/src/commands/verify.ts#registerVerify -->

`registerVerify` mounts `livewiki verify`, which validates the wiki against the index: broken anchors, altered manual blocks, and internal links. `runVerify` returns a `VerifyResult`; in `--json` mode the full result is printed, otherwise `formatVerifyHuman(result)` is rendered. The CI-friendly contract is `exit code ≠ 0` whenever `result.ok` is false — i.e., `process.exit(1)` is called when validation fails. Errors caught around `runVerify` write to stderr and exit 1 as well.

## view (stub, Phase 7)
<!-- lw:anchors packages/cli/src/commands/view.ts#registerView -->

`registerView` mounts `livewiki view` and binds it to `makeStubAction({ name: "view", phase: 7, planned: "static site with client-side search + Mermaid + templates as data" })`. The command accepts `--template <name>` (default `agent`; the future `docs` template is the alternative) and `--out <dir>` (default `.livewiki/site/`) — both declarative for the eventual Phase-7 implementation that will emit a self-contained HTML+CSS+JS site with client-side search and Mermaid diagrams.