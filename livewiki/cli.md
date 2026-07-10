---
title: "@livewiki/cli — the livewiki command-line surface"
owner: generated
anchors:
  - packages/cli/src/cli-batch-e2e-subdirs.test.ts#defaultHandler
  - packages/cli/src/cli-batch-e2e-subdirs.test.ts#isStage2RefinePrompt
  - packages/cli/src/cli-batch-e2e-subdirs.test.ts#makeRefineHandler
  - packages/cli/src/cli-batch-e2e-subdirs.test.ts#runCli
  - packages/cli/src/cli-batch-e2e-subdirs.test.ts#startStubServer
  - packages/cli/src/cli-batch-e2e-subdirs.test.ts#writeCode
  - packages/cli/src/cli-batch-e2e-subdirs.test.ts#writeOpenAiConfig
  - packages/cli/src/cli-batch-e2e.test.ts#defaultHandler
  - packages/cli/src/cli-batch-e2e.test.ts#runCli
  - packages/cli/src/cli-batch-e2e.test.ts#startStubServer
  - packages/cli/src/cli-batch-e2e.test.ts#writeCode
  - packages/cli/src/cli-batch-e2e.test.ts#writeConfig
  - packages/cli/src/cli-e2e.test.ts#cliBin
  - packages/cli/src/cli-e2e.test.ts#runCli
  - packages/cli/src/cli-e2e.test.ts#statusDebt
  - packages/cli/src/cli-e2e.test.ts#writeCode
  - packages/cli/src/cli-e2e.test.ts#writeWiki
  - packages/cli/src/cli.ts#createProgram
  - packages/cli/src/cli.ts#readVersion
  - packages/cli/src/cli.ts#resolveRepoRoot
  - packages/cli/src/cli.ts#run
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
  - packages/cli/src/output.ts#emit
  - packages/cli/src/output.ts#emitHuman
  - packages/cli/src/output.ts#emitJson
---

# @livewiki/cli

`@livewiki/cli` is a thin `commander`-based wrapper around
[`@livewiki/core`](core.md) — see that page for the actual logic behind
every command below. This package's job is argument parsing, exit-code
plumbing, and formatting (`--json` vs. human-readable), never business
logic.

## Program setup and global flags

<!-- lw:anchors packages/cli/src/cli.ts#createProgram packages/cli/src/cli.ts#run packages/cli/src/cli.ts#readVersion packages/cli/src/cli.ts#resolveRepoRoot -->

`createProgram()` (`cli.ts`) builds the `commander` `Command` tree: it
sets the program name/description/version (`readVersion` reads
`@livewiki/cli`'s own `package.json`, resolved relative to the built
file so it works both from `src/` and `dist/`), declares the two global
flags every command inherits —

- `--json` — parseable, structured output (every command supports it).
- `--repo <path>` — target repo directory, default `.`.

— and registers every subcommand (`registerInit`, `registerIndex`,
`registerStatus`, `registerUpdate`, `registerVerify`, `registerServe`,
`registerBatch`, `registerExport`, `registerView`, `registerPointer`).
`run(argv)` is the actual CLI entry point, calling
`program.parseAsync(argv)`. `resolveRepoRoot(repoOpt)` is the shared
helper every command uses to turn `--repo` into an absolute path
(`path.resolve(process.cwd(), repoOpt ?? ".")`).

## Output formatting

<!-- lw:anchors packages/cli/src/output.ts#emit packages/cli/src/output.ts#emitHuman packages/cli/src/output.ts#emitJson -->

`output.ts` is the single choke point every command's output passes
through: `emitJson(data)` writes one line of `JSON.stringify(data)` (safe
for line-by-line `JSON.parse` by an agent piping the CLI's stdout);
`emitHuman(text)` writes plain multi-line text. `emit(json, data, human)`
is the one-liner commands actually call — pass both a data object and a
human string, and it picks the right one based on the `--json` flag.
Every command in `commands/` follows this pattern; never write both.

## `livewiki init` — deterministic layout + optional full pipeline

<!-- lw:anchors packages/cli/src/commands/init.ts#registerInit packages/cli/src/commands/init.ts#formatHuman -->

`registerInit` wires `--batch` (run the full LLM documentation pipeline),
`--plan` (show the heuristic module plan — no LLM calls, no writes), and
`--no-refine` (skip the stage-2 LLM refinement, only meaningful with
`--batch`) onto `core`'s `runInit`. Exit-code handling matters here: when
`--batch` ran, `result.batchExitCode` (computed by
`core/batch.ts`'s `statusToExitCode`) is propagated via
`process.exitCode` — **except** under `--json`, which always exits 0
(structured output is the CLI-convention contract; a caller parsing JSON
should inspect the payload, not the exit code). `formatHuman` renders
either the `--plan` report (module list with file/symbol counts) or the
full init report (files written + batch summary, if any).

## `livewiki index` — reindex + anchor ledger

<!-- lw:anchors packages/cli/src/commands/index-cmd.ts#registerIndex packages/cli/src/commands/index-cmd.ts#collectIgnore packages/cli/src/commands/index-cmd.ts#emit packages/cli/src/commands/index-cmd.ts#formatLedgerHuman -->

`registerIndex` runs `core`'s indexer (`runIndexer`) and then, unless
`--no-ledger` is passed, the anchor ledger (`runLedger`) — a single
`livewiki index` call keeps the code index and the wiki's debt/anchor
state in sync (see [core.md](core.md#indexing-pipeline-walker-parser-symbols-db-indexer)).
`--ignore <pattern>` is repeatable (`collectIgnore` accumulates it into
an array) for extra glob patterns beyond `.gitignore`. `--quiet`
(distinct from `--json`) suppresses human-readable stdout without
producing structured output — this is what the git `post-commit` hook
template uses so a routine commit doesn't spam the terminal; the hook
checks for debt separately via `livewiki status --json`. `.livewiki/` is
auto-created without warning if missing; `livewiki/` missing only
produces an informational note (never an error — `init` is never a hard
prerequisite for `index`). `formatLedgerHuman` renders the anchor-ledger
half of the report (pages processed/skipped, anchors upserted, debt by
event, undocumented count, and any moved-symbol pairs detected).

## `livewiki status`

<!-- lw:anchors packages/cli/src/commands/status.ts#registerStatus -->

`registerStatus` is a straightforward wrapper over `core`'s `status.run`
— this is the same report the MCP `livewiki_debt` tool serves. `--top
<n>` controls how many "top files by symbol count" entries appear in the
human-readable output (default 10).

## `livewiki verify`

<!-- lw:anchors packages/cli/src/commands/verify.ts#registerVerify -->

`registerVerify` wraps `core`'s `verify.run` and is deliberately minimal
— its entire job is CI-friendliness: exit non-zero whenever
`result.ok === false` (any `error`-severity issue), regardless of
`--json`. This is the command CI pipelines and the Phase 5 acceptance
criterion ("verify passes clean — exit 0 **and** zero issues of any
severity") are built around.

## `livewiki update` — incremental debt-paying mode

<!-- lw:anchors packages/cli/src/commands/update.ts#registerUpdate packages/cli/src/commands/update.ts#formatHuman -->

`registerUpdate` is the CLI face of Phase 5's incremental flow (see
[core.md](core.md#incremental-update-phase-5)). With no flags, it emits
a "work package" — open debt, source snippets per changed symbol,
currently-valid anchor keys, and an estimated token cost
(`core`'s `loadWorkPackage`) — for an in-session agent to consume and pay
down one symbol at a time; the human output includes a one-line "economy"
pitch comparing the package's token cost to a rough full-repo re-read
(~12,500 tokens). `--record-write <tokens>` records that N tokens were
written back after the agent pays debt (calls `core`'s
`recordDocWrittenBack`, estimating bytes at 4 chars/token). `--llm`
doesn't do incremental work itself — it prints guidance pointing at
`livewiki batch resume`/`livewiki init --batch`, since full-pipeline
LLM calls are `batch.ts`'s job, not `update.ts`'s.

## `livewiki batch` — inspect/resume/rerun full documentation runs

<!-- lw:anchors packages/cli/src/commands/batch.ts#registerBatch packages/cli/src/commands/batch.ts#formatStatusHuman packages/cli/src/commands/batch.ts#formatResultHuman packages/cli/src/commands/batch.ts#formatListHuman packages/cli/src/commands/batch.ts#setExitCode -->

`registerBatch` exposes four sub-forms under one `batch` command:

- **`batch`** (no args) or **`batch <runId>`** or **`batch status
  [<runId>]`** — status report for the last (or a specific) run
  (`buildStatusReport`), rendered token-first (`formatStatusHuman`: tokens
  are the primary metric per stage/module; USD appears as a clearly
  "estimated" secondary line, or is omitted with an explanatory line when
  no pricing entry exists for the model used).
- **`batch resume <runId>`** — continues a partially-run/interrupted
  batch (`core`'s `resumeBatch`), rendered by `formatResultHuman`.
- **`batch --only <target> <runId>`** — re-runs exactly one task
  (`runOnly`), for retrying a single failed module without re-running
  the whole pipeline.
- **`batch list`** — lists all runs (`listRuns`/`formatListHuman`).

`setExitCode` maps run status to process exit code (`completed`→0,
`completed_with_failures`→1, `aborted`→2) — except under `--json`, which
always exits 0 (same convention as `init`).

## Stub commands (not yet implemented)

<!-- lw:anchors packages/cli/src/commands/stub.ts#makeStubAction packages/cli/src/commands/serve.ts#registerServe packages/cli/src/commands/export.ts#registerExport packages/cli/src/commands/view.ts#registerView -->

`stub.ts#makeStubAction` is the shared factory for commands whose SPEC
phase hasn't landed yet: it emits a structured `{ ok: false, stub, phase,
planned }` payload (or the human equivalent) and exits 0 (the command
ran fine, it's just a stub — not an error). At the time of writing:

- `registerServe` (`livewiki serve`) — was a Phase 4 stub; the MCP server
  itself now exists as `@livewiki/mcp` (see [mcp.md](mcp.md)), started
  directly via `npx @livewiki/mcp --repo <path>` rather than through this
  CLI command — check `serve.ts` for the current wiring before assuming
  it's still a stub.
- `registerExport` (`livewiki export`) — Phase 6 (export to
  github-wiki/gitlab-wiki/generic), post-MVP, still a stub.
- `registerView` (`livewiki view`) — Phase 7 (local viewer), post-MVP,
  still a stub.

## `livewiki pointer` — opt-in AGENTS.md/CLAUDE.md block

<!-- lw:anchors packages/cli/src/commands/pointer.ts#registerPointer packages/cli/src/commands/pointer.ts#promptYesNo packages/cli/src/commands/pointer.ts#formatPointerResult packages/cli/src/commands/pointer.ts#formatStatusHuman packages/cli/src/commands/pointer.ts#_internal -->

`registerPointer` is the CLI surface for `core`'s opt-in pointer
mechanism (see [core.md](core.md#repo-hygiene-helpers-gitignore-and-pointer)).
The command is deliberately fail-closed: with no flags, it only reports
current status (read-only). Writing requires **either** `--write-pointer`
(or its alias `--yes`) **or** an interactive TTY confirmation
(`promptYesNo` reads a `y`/`N` line from stdin) — if there's no flag and
no TTY (e.g. an agent invoking the CLI as a subprocess without the flag),
it refuses and prints instructions rather than silently deciding for the
user. `--remove` follows the same fail-closed pattern, with its own
confirmation prompt (removal is more destructive, so it doesn't
piggyback on a bare `--write-pointer` unless that flag or `--yes` was
explicitly passed for the remove itself). `--file <name>` forces
`AGENTS.md` or `CLAUDE.md` instead of auto-detecting which exists.
`--block <text>` overrides the default block content. `formatPointerResult`/
`formatStatusHuman` render the write/remove outcome and the read-only
status view respectively. `_internal` re-exports `node:fs/promises` for
the test suite only — not part of the public command surface.

## Hook templates and the document-as-you-go skill

Two Phase 5 deliverables ship as static files rather than code, under
`packages/cli/templates/` and `packages/cli/skills/`:

- **`templates/git/post-commit`** — a bash hook that runs `livewiki index
  --quiet` after every commit and never blocks it (always exits 0),
  printing a debt summary only if `livewiki status --json` reports open
  debt. Installed via git's `core.hooksPath` (see `templates/README.md`
  for the recommended setup).
- **`templates/claude-code/settings.local.json`** — a Claude Code Stop
  hook template with the equivalent behavior for that environment.
- **`skills/document-as-you-go/SKILL.md`** — the agent-facing skill
  description: after finishing a task, run `livewiki status --json`,
  and pay any debt found either via the MCP `livewiki_write_doc` tool or
  by editing the wiki directly and running `livewiki verify`.

`templates.test.ts` (in `src/`) is the test coverage for these static
assets — it checks the hook scripts and settings JSON are well-formed
and reference the right commands, not runtime behavior.

## Testing

<!-- lw:anchors packages/cli/src/cli-e2e.test.ts#cliBin packages/cli/src/cli-e2e.test.ts#runCli packages/cli/src/cli-e2e.test.ts#writeCode packages/cli/src/cli-e2e.test.ts#writeWiki packages/cli/src/cli-e2e.test.ts#statusDebt packages/cli/src/cli-batch-e2e.test.ts#startStubServer packages/cli/src/cli-batch-e2e.test.ts#defaultHandler packages/cli/src/cli-batch-e2e.test.ts#runCli packages/cli/src/cli-batch-e2e.test.ts#writeCode packages/cli/src/cli-batch-e2e.test.ts#writeConfig packages/cli/src/cli-batch-e2e-subdirs.test.ts#startStubServer packages/cli/src/cli-batch-e2e-subdirs.test.ts#defaultHandler packages/cli/src/cli-batch-e2e-subdirs.test.ts#isStage2RefinePrompt packages/cli/src/cli-batch-e2e-subdirs.test.ts#makeRefineHandler packages/cli/src/cli-batch-e2e-subdirs.test.ts#runCli packages/cli/src/cli-batch-e2e-subdirs.test.ts#writeCode packages/cli/src/cli-batch-e2e-subdirs.test.ts#writeOpenAiConfig -->

The CLI's E2E suites are the project's critical regression net for
end-to-end behavior — `init.ts`/`batch.ts` are explicitly excluded from
unit coverage and rely on these instead:

- **`cli-e2e.test.ts`** — basic end-to-end flow: builds a temp repo
  (`writeCode`), a wiki (`writeWiki`), runs the CLI binary as a real
  subprocess (`cliBin` resolves the built `dist/cli.js`, `runCli`
  spawns it), and checks debt via `statusDebt`.
- **`cli-batch-e2e.test.ts`** — the critical E2E for `init --batch`
  against a stub Anthropic-shaped HTTP server (`startStubServer` +
  `defaultHandler`), covering exit-code propagation
  (aborted/completed_with_failures/completed/`--json`) and the
  `architecture/overview.md` cross-check between quickstart links and
  page anchors.
- **`cli-batch-e2e-subdirs.test.ts`** — the rev2 empirical-fix regression
  suite: subdirectory module layouts, NodeNext import resolution, and an
  `openai-compat`-shaped stub server (`writeOpenAiConfig`,
  `isStage2RefinePrompt`/`makeRefineHandler` distinguish stage-4 doc-gen
  calls from stage-2 refinement calls in the stub's request handler).

## See also

- [core.md](core.md) — the `@livewiki/core` logic every command here
  wraps.
- [mcp.md](mcp.md) — the MCP server, a sibling package exposing much of
  the same functionality (read/write/search/debt) to MCP clients instead
  of a terminal.
