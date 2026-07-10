<think>
The user wants me to generate a complete Markdown page for the livewiki commands module. Let me analyze the requirements:

1. Output must be Markdown with frontmatter
2. Frontmatter must contain: title, owner: generated, anchors (list)
3. Use ONLY keys from the closed list - I have 24 canonical keys
4. Section markers `<!-- lw:anchors key1 key2 -->` distribute remaining keys across sections
5. Frontmatter anchors list MUST only contain keys from the closed list
6. If information missing, write "TODO: <reason>"
7. Keep prose tight

Let me organize the 24 keys by file/module:

**batch.ts** (5 keys):
- packages/cli/src/commands/batch.ts#formatListHuman
- packages/cli/src/commands/batch.ts#formatResultHuman
- packages/cli/src/commands/batch.ts#formatStatusHuman
- packages/cli/src/commands/batch.ts#registerBatch
- packages/cli/src/commands/batch.ts#setExitCode

**export.ts** (1 key):
- packages/cli/src/commands/export.ts#registerExport

**index-cmd.ts** (4 keys):
- packages/cli/src/commands/index-cmd.ts#collectIgnore
- packages/cli/src/commands/index-cmd.ts#emit
- packages/cli/src/commands/index-cmd.ts#formatLedgerHuman
- packages/cli/src/commands/index-cmd.ts#registerIndex

**init.ts** (2 keys):
- packages/cli/src/commands/init.ts#formatHuman
- packages/cli/src/commands/init.ts#registerInit

**pointer.ts** (5 keys):
- packages/cli/src/commands/pointer.ts#_internal
- packages/cli/src/commands/pointer.ts#formatPointerResult
- packages/cli/src/commands/pointer.ts#formatStatusHuman
- packages/cli/src/commands/pointer.ts#promptYesNo
- packages/cli/src/commands/pointer.ts#registerPointer

**serve.ts** (1 key):
- packages/cli/src/commands/serve.ts#registerServe

**status.ts** (1 key):
- packages/cli/src/commands/status.ts#registerStatus

**stub.ts** (1 key):
- packages/cli/src/commands/stub.ts#makeStubAction

**update.ts** (2 keys):
- packages/cli/src/commands/update.ts#formatHuman
- packages/cli/src/commands/update.ts#registerUpdate

**verify.ts** (1 key):
- packages/cli/src/commands/verify.ts#registerVerify

**view.ts** (1 key):
- packages/cli/src/commands/view.ts#registerView

Let me structure the page logically by command. I'll organize sections like:

1. Overview
2. batch command
3. export command
4. index command
5. init command
6. pointer command
7. serve command
8. status command
9. stub helper
10. update command
11. verify command
12. view command

Let me write the page now. I need to ensure I use all 24 keys in the frontmatter anchors list.

Let me draft the page:

```markdown
---
title: CLI Commands
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

# CLI Commands

Reference documentation for every `livewiki` subcommand implemented under `packages/cli/src/commands/`. Each module exports `registerXxx(program: Command): void` that wires a commander subcommand, its options, and its action handler.

Common conventions:

- All commands inherit `--json` and `--repo` from the root program.
- Errors print to stderr; `--json` consumers always receive structured output and exit code 0 when the action ran.
- Exit codes: 0 = success, 1 = failure / completed with failures / usage error, 2 = aborted (circuit breaker) — used by `batch`.

## batch

`livewiki batch <run>` — Phase 3 orchestrator. Subcommands: `status [<runId>]` (default), `resume <runId>`, `list`, `--only <target> <runId>`.

<!-- lw:anchors packages/cli/src/commands/batch.ts#registerBatch packages/cli/src/commands/batch.ts#formatStatusHuman packages/cli/src/commands/batch.ts#formatResultHuman packages/cli/src/commands/batch.ts#formatListHuman packages/cli/src/commands/batch.ts#setExitCode -->

### registerBatch

Wires the `batch` subcommand. Resolves the repo root, dispatches on positional args:

- No args → `buildStatusReport(repoRoot)` (latest run).
- `list` → `listRuns(repoRoot)`.
- `status [runId]` → `buildStatusReport(repoRoot, runId)`.
- `resume <runId>` → `resumeBatch({ repoRoot, ...noRefine })`.
- `--only <target>` → `runOnly({ repoRoot, onlyTarget })`.
- Numeric first arg → treated as `status <runId>`.

Errors set `process.exitCode = 1` (avoids the libuv `STATUS_STACK_BUFFER_OVERRUN` issue that `process.exit(1)` triggers on Windows when async handles are open).

### formatStatusHuman

Renders a token-first status report. Order: header → tokens (total + per stage) → USD line (omitted without drama when no pricing exists) → per-module table → failures.

### formatResultHuman

Renders a batch run result: run id, status, token totals, USD (estimated), tasks done, failures, and circuit-breaker flag.

### formatListHuman

Renders the run list with id, status, started/finished ISO timestamps.

### setExitCode

Maps run status to exit code, but only for human output. `--json` always exits 0 (structured-output convention).

| status | exit code |
|---|---|
| completed | 0 |
| completed_with_failures | 1 |
| aborted | 2 |

## export

`livewiki export <target>` — Phase 6. Currently a Phase-0 stub produced via `makeStubAction`.

<!-- lw:anchors packages/cli/src/commands/export.ts#registerExport -->

### registerExport

Declares `--push <remote>`. Implementation: one-way transformation (flatten namespace, rewrite links, strip anchor frontmatter) for github-wiki / gitlab-wiki / generic formats.

## index

`livewiki index` — (re)indexes the repo + runs the anchor ledger. Idempotent, incremental.

<!-- lw:anchors packages/cli/src/commands/index-cmd.ts#registerIndex packages/cli/src/commands/index-cmd.ts#collectIgnore packages/cli/src/commands/index-cmd.ts#emit packages/cli/src/commands/index-cmd.ts#formatLedgerHuman -->

### registerIndex

Wires `index` with options:

- `--ignore <pattern>` (repeatable; collected by `collectIgnore`).
- `--no-ledger` — skip the anchor-ledger chain.
- `--quiet` — suppress human output without producing JSON (used by Phase 5 hooks).

Missing `.livewiki/` is auto-created silently; missing `livewiki/` emits an info note pointing to `init`. The command never requires `init` first.

### collectIgnore

Commander accumulator for `--ignore`: `previous.concat(value)`.

### emit

Single output sink. Behaviour:

| json | quiet | stdout |
|---|---|---|
| true | any | `{ ok: true, index, ledger }` JSON |
| false | true | (nothing) |
| false | false | `formatIndexHuman` + `formatLedgerHuman` |

### formatLedgerHuman

Human renderer for `LedgerResult`: pages processed/skipped, anchors upserted, debt breakdown (`+changed +moved +deleted`), undocumented count, moved pairs.

## init

`livewiki init` — Phase 3. Creates `livewiki/` + `.livewiki/`, indexes, generates deterministic layout (quickstart + diagrams + manifest) without LLM.

<!-- lw:anchors packages/cli/src/commands/init.ts#registerInit packages/cli/src/commands/init.ts#formatHuman -->

### registerInit

Options:

- `--batch` — triggers the full LLM pipeline.
- `--plan` — prints the heuristic module plan, no LLM, no writes.
- `--no-refine` — skips LLM refinement of stage 2 (heuristic only).

Propagates the batch exit code via `process.exitCode` when `--json` is not set; `--json` always exits 0.

### formatHuman

Two layouts:

- `--plan` → modules / files / symbols / edges + ordered list.
- otherwise → `files written` listing, plus optional `batchSummary` block (runId, status, tasks done/failed, exit code).

## pointer

`livewiki pointer` — opt-in pointer in `AGENTS.md` / `CLAUDE.md` (Phase 5). Subject to SPEC §"Inviolable rules" #2: **never automatic**.

<!-- lw:anchors packages/cli/src/commands/pointer.ts#registerPointer packages/cli/src/commands/pointer.ts#promptYesNo packages/cli/src/commands/pointer.ts#formatPointerResult packages/cli/src/commands/pointer.ts#formatStatusHuman packages/cli/src/commands/pointer.ts#_internal -->

### registerPointer

Modes:

| invocation | behaviour |
|---|---|
| no flag, TTY | if pointer present → status; else interactive y/N prompt showing the block to be added |
| no flag, non-TTY | fail closed: stderr + `exitCode = 1` (never silent write) |
| `--write-pointer` / `--yes` | writes the block, no prompt |
| `--remove` | removes the block; with TTY and no flag, asks for confirmation; without TTY and no flag, fail closed |
| `--file <name>` | force `AGENTS.md` or `CLAUDE.md` (default: auto-detect) |
| `--block <text>` | custom block content (default: `buildPointerBlock()`) |

### promptYesNo

Writes `question` to stdout, reads one line from stdin, resolves `true` for `y`/`yes` (case-insensitive). Used by the interactive TTY branch.

### formatPointerResult

Renders a write/remove result: `{file}, +{bytes}` (or `unchanged` when `bytesWritten === 0`).

### formatStatusHuman

Two-line output: `not present` with a hint to run `--write-pointer`, or `present in <file>` with the existing block fenced between `---` markers.

### _internal

Re-export bag for tests: `{ nodeFs }`. Not part of the user-facing API.

## serve

`livewiki serve` — Phase 4. Currently a Phase-0 stub produced via `makeStubAction`.

<!-- lw:anchors packages/cli/src/commands/serve.ts#registerServe -->

### registerServe

Planned behaviour: MCP server on stdio with six tools — `livewiki_quickstart`, `read`, `search`, `debt`, `write_doc`, `resolve_debt`.

## status

`livewiki status` — Phase 1 (files + symbols) / Phase 2 (debt + undocumented).

<!-- lw:anchors packages/cli/src/commands/status.ts#registerStatus -->

### registerStatus

Reads `--top <n>` (default 10) and forwards to `runStatus(repoRoot, { topN })`. Renders JSON or human output via `formatStatusHuman` from `@livewiki/core/status`.

## stub

Helper used by Phase-0 commands (`export`, `serve`, `view`) before their phase lands.

<!-- lw:anchors packages/cli/src/commands/stub.ts#makeStubAction -->

### makeStubAction

Builds an action handler matching commander's `(options, command)` signature. Inherits `--json` and `--repo` from the parent program via `optsWithGlobals()`. Emits a structured `{ ok: false, stub, phase, repoRoot, message, planned }` payload (or human line) and exits 0.

## update

`livewiki update` — Phase 5 (incremental mode, heart of the product).

<!-- lw:anchors packages/cli/src/commands/update.ts#registerUpdate packages/cli/src/commands/update.ts#formatHuman -->

### registerUpdate

Modes:

| invocation | behaviour |
|---|---|
| no flag | emits the work package (debt + snippets + validAnchors + tokens) |
| `--record-write <tokens>` | records the metric and exits; bytes are estimated at `tokens * 4` |
| `--llm` | currently fails closed with a hint to use `batch resume` / `init --batch` |
| `--snippet-window <lines>` | default 20 |

The package output includes an `economy` summary comparing `pkg.tokensEstimated` against an estimated full-read baseline of 12 500 tokens.

### formatHuman

Renders: `lastDocumentedCommit`, optional `pendingBatch` progress, first 5 debt items, snippet/validAnchor counts, and the economy thesis line.

## verify

`livewiki verify` — Phase 2. CI-friendly: validates wiki against the index.

<!-- lw:anchors packages/cli/src/commands/verify.ts#registerVerify -->

### registerVerify

Runs `runVerify(repoRoot)`, emits JSON or `formatVerifyHuman`. Exits 1 when `result.ok` is false. Catches startup errors and exits 1.

## view

`livewiki view` — Phase 7. Currently a Phase-0 stub produced via `makeStubAction`.

<!-- lw:anchors packages/cli/src/commands/view.ts#registerView -->

### registerView

Planned behaviour: self-contained static site (HTML + CSS + JS) with client-side search and Mermaid. Options `--template <agent|docs>` (default `agent`) and `--out <dir>` (default `.livewiki/site/`).
```

Let me count my keys used in section markers vs the frontmatter. I need every key to be in both the frontmatter anchors list AND assigned to a section marker. Let me verify:

Frontmatter anchors (24):
1. packages/cli/src/commands/batch.ts#formatListHuman
2. packages/cli/src/commands/batch.ts#formatResultHuman
3. packages/cli/src/commands/batch.ts#formatStatusHuman
4. packages/cli/src/commands/batch.ts#registerBatch
5. packages/cli/src/commands/batch.ts#setExitCode
6. packages/cli/src/commands/export.ts#registerExport
7. packages/cli/src/commands/index-cmd.ts#collectIgnore
8. packages/cli/src/commands/index-cmd.ts#emit
9. packages/cli/src/commands/index-cmd.ts#formatLedgerHuman
10. packages/cli/src/commands/index-cmd.ts#registerIndex
11. packages/cli/src/commands/init.ts#formatHuman
12. packages/cli/src/commands/init.ts#registerInit
13. packages/cli/src/commands/pointer.ts#_internal
14. packages/cli/src/commands/pointer.ts#formatPointerResult
15. packages/cli/src/commands/pointer.ts#formatStatusHuman
16. packages/cli/src/commands/pointer.ts#promptYesNo
17. packages/cli/src/commands/pointer.ts#registerPointer
18. packages/cli/src/commands/serve.ts#registerServe
19. packages/cli/src/commands/status.ts#registerStatus
20. packages/cli/src/commands/stub.ts#makeStubAction
21. packages/cli/src/commands/update.ts#formatHuman
22. packages/cli/src/commands/update.ts#registerUpdate
23. packages/cli/src/commands/verify.ts#registerVerify
24. packages/cli/src/commands/view.ts#registerView

Section markers:
- batch section: 5 keys (formatListHuman, formatResultHuman, formatStatusHuman, registerBatch, setExitCode) ✓
- export section: 1 key (registerExport) ✓
- index section: 4 keys (registerIndex, collectIgnore, emit, formatLedgerHuman) ✓
- init section: 2 keys (registerInit, formatHuman) ✓
- pointer section: 5 keys (registerPointer, promptYesNo, formatPointerResult, formatStatusHuman, _internal) ✓
- serve section: 1 key (registerServe) ✓
- status section: 1 key (registerStatus) ✓
- stub section: 1 key (makeStubAction) ✓
- update section: 2 keys (registerUpdate, formatHuman) ✓
- verify section: 1 key (registerVerify) ✓
- view section: 1 key (registerView) ✓

Total: 5+1+4+2+5+1+1+1+2+1+1 = 24 ✓

All keys are assigned exactly once. Good.

Let me double-check my facts against the source code:

1. batch.ts: 
   - Exit codes 0/1/2 for completed/completed_with_failures/aborted ✓
   - Token-first format ✓
   - Subcommands: status, resume, list, --only ✓
   - Uses process.exitCode not process.exit ✓

2. export.ts: stub via makeStubAction ✓

3. index-cmd.ts:
   - --ignore, --no-ledger, --quiet ✓
   - Auto-create .livewiki/ silently ✓
   - emit handles JSON/quiet ✓

4. init.ts:
   - --batch
</think>

