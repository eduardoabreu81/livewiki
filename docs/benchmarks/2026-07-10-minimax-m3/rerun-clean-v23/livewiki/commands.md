---
title: CLI command registrations for livewiki
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
  - packages/cli/src/commands/export.ts#emit
  - packages/cli/src/commands/export.ts#exportErrorToResult
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

# CLI command registrations for livewiki

The `packages/cli/src/commands` module wires every `livewiki` subcommand into Commander and shapes its human-readable and JSON output.

## When to use this page

- **Register** a new subcommand against the root Commander program by calling the right `register*` function.
- **Format** structured results for terminal output (JSON or human) using the `format*Human` and `emit` helpers.
- **Diagnose** why a subcommand fails — every `register*` handler has a visible `try`/`catch` that writes to stderr and sets `process.exitCode`.
- **Stub** a future-phase command without writing per-command boilerplate by reusing `makeStubAction`.

## How it fits

This module lives inside the `packages/cli` workspace and is the per-command layer that the root `cli.ts` aggregator consumes. Each file exports one `register*(program: Command): void` function that attaches a subcommand to Commander, plus internal helpers that format human output, normalize errors, or interactively prompt the user. Files like `export.ts`, `init.ts`, `index-cmd.ts`, `pointer.ts`, `update.ts`, `verify.ts`, `status.ts`, `batch.ts`, `serve.ts`, and `view.ts` sit directly between Commander and the `@livewiki/core/*` domain logic. `stub.ts` is shared by the not-yet-implemented commands (`serve`, `view`) so they return a structured `ok: false, stub: ...` payload instead of throwing.

## batch command
<!-- lw:anchors packages/cli/src/commands/batch.ts#registerBatch packages/cli/src/commands/batch.ts#USAGE_INCOMPLETE_NOTE packages/cli/src/commands/batch.ts#formatDiagnosticLine packages/cli/src/commands/batch.ts#appendStage4Diagnostics packages/cli/src/commands/batch.ts#formatStatusHuman packages/cli/src/commands/batch.ts#formatResultHuman packages/cli/src/commands/batch.ts#formatListHuman packages/cli/src/commands/batch.ts#setExitCode -->

`batch` is the Phase 3 orchestrator. The handler distinguishes subcommands (`status`, `resume`, `list`, or an implicit `status <runId>` / `--only`) and forwards to `@livewiki/core/batch` and `@livewiki/core/batch-status`. It is registered with:

```ts
export function registerBatch(program: Command): void
```

The export

```ts
export const USAGE_INCOMPLETE_NOTE =
```

is appended to human output whenever totals are incomplete. `formatDiagnosticLine` and `appendStage4Diagnostics` build the per-attempt sequence printed under failed stage-4 failures; their signatures are:

```ts
function formatDiagnosticLine(d: {
  attempt: number;
  stopReason?: string;
  outcome: string;
  errors: Array<{ code: string }>;
}): string
```

```ts
function appendStage4Diagnostics(
  lines: string[],
  report: Awaited<ReturnType<typeof buildStatusReport>>,
  failureTaskId: number,
): void
```

`appendStage4Diagnostics` exits silently when the failed task has no `diagnosticHistory` — i.e. the checkpoint pre-dates diagnostics or the task never reached the LLM. The three human formatters return strings consumed by the central `emit` helper. Their signatures:

```ts
export function formatStatusHuman(report: Awaited<ReturnType<typeof buildStatusReport>>): string
export function formatResultHuman(result: Awaited<ReturnType<typeof runBatch>>): string
function formatListHuman(runs: Awaited<ReturnType<typeof listRuns>>): string
```

The exit-code policy is:

```ts
function setExitCode(repoRoot: string, status: string, json: boolean): void
```

In `--json` mode this is a no-op (JSON always exits 0). Otherwise `completed` → 0, `completed_with_failures` → 1, `aborted` → 2. Unhandled throws inside the action write `livewiki batch: error — <message>` to stderr and set `process.exitCode = 1`; the handler never calls `process.exit`.

## export command
<!-- lw:anchors packages/cli/src/commands/export.ts#registerExport packages/cli/src/commands/export.ts#exportErrorToResult packages/cli/src/commands/export.ts#emit -->

`export` writes a flattened snapshot of `livewiki/` to `.livewiki/export/<target>/`. It is registered with:

```ts
export function registerExport(program: Command): void
```

The action validates the target up front, wraps `exportWiki` in `try`/`catch`, and routes everything through `exportErrorToResult` so the JSON contract holds even when validation or writing throws. `exportErrorToResult` returns an `ExportResult` with `ok: false`, an `ExportError.issues` array, or a synthesized `write_failed` issue for unexpected errors; non-`Error` thrown values reach it via `err instanceof Error ? err.message : String(err)`. `emit` writes the chosen payload and sets `process.exitCode` to `0` on success and `1` on any failure before writing output.

## index command
<!-- lw:anchors packages/cli/src/commands/index-cmd.ts#registerIndex packages/cli/src/commands/index-cmd.ts#collectIgnore packages/cli/src/commands/index-cmd.ts#emit packages/cli/src/commands/index-cmd.ts#formatLedgerHuman -->

`index` reindexes the repo and then chains the anchor-ledger. Registered with:

```ts
export function registerIndex(program: Command): void
```

`--ignore` is collected by:

```ts
function collectIgnore(value: string, previous: string[]): string[]
```

which appends to Commander's running list. The handler merges `.livewiki/config.json` `ignores` with the CLI flag so every entry point shares the same semantics — `loadConfig` throws on malformed JSON, which is intentional fail-closed behavior. `formatLedgerHuman` turns a `LedgerResult` into the multi-line ledger summary; its signature is:

```ts
function formatLedgerHuman(r: LedgerResult): string
```

`emit` honors three modes: quiet (no stdout), JSON (`{ ok, index, ledger }`), and human (index + ledger blocks). The `--no-ledger` flag maps to `opts.ledger === false`. Errors caught by the handler write to stderr and set `process.exitCode = 1` rather than calling `process.exit`.

## init command
<!-- lw:anchors packages/cli/src/commands/init.ts#registerInit packages/cli/src/commands/init.ts#formatHuman -->

`init` creates `livewiki/` and `.livewiki/`, indexes, generates layout, and (with `--batch`) triggers the full LLM pipeline. Registered with:

```ts
export function registerInit(program: Command): void
```

The action invokes `runInit` and forwards `batchExitCode` to `process.exitCode` so non-JSON callers see the same status mapping as `batch`. `--no-refine` is mapped to `opts.refine === false` — never `opts.noRefine`. `formatHuman` has the signature:

```ts
function formatHuman(result: { plan?: InitPlanReport; filesWritten: string[]; batchSummary?: { runId: number; status: string; tasksDone: number; tasksFailed: number }; batchExitCode?: 0 | 1 | 2; skipp
```

(truncated by the symbol table — see source for the full shape) and prints a `--plan` preview, an `OK` summary with written files, then `batchSummary` and any `skippedFlowsHub` / `skippedAuxiliaryHub` / `skippedTopicsHub` / `skippedFlowCandidates` notices. Throws in the action set `process.exitCode = 1` rather than calling `process.exit`, to avoid the libuv `STATUS_STACK_BUFFER_OVERRUN` observed on Windows when async handles were open.

## pointer command
<!-- lw:anchors packages/cli/src/commands/pointer.ts#registerPointer packages/cli/src/commands/pointer.ts#promptYesNo packages/cli/src/commands/pointer.ts#formatPointerResult packages/cli/src/commands/pointer.ts#formatStatusHuman packages/cli/src/commands/pointer.ts#_internal -->

`pointer` manages the opt-in `AGENTS.md` / `CLAUDE.md` block. Registered with:

```ts
export function registerPointer(program: Command): void
```

This handler enforces an "inviolable rule #2" — it never writes outside `livewiki/` except via `--write-pointer` (or its alias `--yes`) or an explicit interactive `y/N`. The interactive prompt is:

```ts
async function promptYesNo(question: string): Promise<boolean>
```

It resolves to `true` only when the trimmed, lowercased answer is `y` or `yes`. On `--remove` without a flag and without a TTY the handler fails closed (writes an error and sets `process.exitCode = 1`) rather than risk a silent destructive edit. `formatPointerResult` and `formatStatusHuman` turn the underlying result objects into terminal output; signatures:

```ts
function formatPointerResult(
  result: { file: PointerFile; action: string; bytesWritten: number },
  verb: "wrote" | "removed",
): string
```

```ts
function formatStatusHuman(status: { present: boolean; file: PointerFile | null; inner?: string }): string
```

`--file` is validated against `POINTER_FILES`; an invalid value writes to stderr and sets `process.exitCode = 1` before the action body runs. The re-export

```ts
export const _internal = { nodeFs }
```

exists for tests and is intentionally not exposed to userspace.

## serve, status, stub, update, verify, view
<!-- lw:anchors packages/cli/src/commands/serve.ts#registerServe packages/cli/src/commands/status.ts#registerStatus packages/cli/src/commands/stub.ts#makeStubAction packages/cli/src/commands/update.ts#registerUpdate packages/cli/src/commands/update.ts#formatHuman packages/cli/src/commands/verify.ts#registerVerify packages/cli/src/commands/view.ts#registerView -->

The remaining files follow the same `register*(program: Command): void` shape. Signatures:

```ts
export function registerServe(program: Command): void
export function registerStatus(program: Command): void
export function registerUpdate(program: Command): void
export function registerVerify(program: Command): void
export function registerView(program: Command): void
```

`serve` and `view` delegate to `makeStubAction` from `stub.ts`:

```ts
export function makeStubAction(info: StubInfo) {
```

which returns an action handler that always emits `ok: false` with `stub`, `phase`, and `planned` fields (human or JSON depending on `--json`) and exits 0. `status` runs `@livewiki/core/status`'s `run` and either prints JSON or `formatStatusHuman`; it honors `--top <n>` and sets `process.exitCode = 1` on a caught throw. `verify` runs `runVerify` and explicitly sets `process.exitCode = 1` when `result.ok` is `false`, so it is CI-friendly by construction.

`update` is the Phase 5 incremental entry point. It branches on three flags. `--record-write <tokens>` validates a non-negative integer, then calls `recordDocWrittenBack` and exits. `--llm` is rejected in this lot with a stderr hint to use `batch resume` or `init --batch` and `process.exitCode = 1`. The default branch loads the work package via `loadWorkPackage`, computes an "economy" ratio against an estimated full-read baseline (12,500 tokens for ~50KB of source), and emits:

```ts
function formatHuman(pkg: Awaited<ReturnType<typeof loadWorkPackage>>): string
```

which prints `lastDocumentedCommit`, `pendingBatch`, the first five debt items, snippet and anchor counts, and the estimated token/byte figures. All `update` throws reach the same stderr-plus-`process.exitCode = 1` path, never `process.exit`.

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
- Flow: [CLI entry to core-src-04 export — semantic product flow](flows/cli-src-to-core-src-04.md)
- [Batch orchestration, configuration, index, and diagram generation](core-src-03.md) — dependency
- [Stage-5 planning, prompt templates, and safe disk I/O core](core-src-08.md) — dependency
- [Livewiki core source — export, flows, frontmatter, gitignore, hashes](core-src-04.md) — dependency
<!-- livewiki:navigate:end -->
