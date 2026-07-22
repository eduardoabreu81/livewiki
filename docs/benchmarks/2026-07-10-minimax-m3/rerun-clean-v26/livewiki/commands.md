---
title: CLI command registrations
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

# CLI command registrations

This page documents the Commander action handlers and helpers that wire each `livewiki` subcommand to its `@livewiki/core` implementation.

## When to use this page

- **Add** a new CLI subcommand by following the `registerX(program)` pattern used here and delegating real work to `@livewiki/core`.
- **Adjust** how a command formats human output or sets `process.exitCode` without ever calling `process.exit`.
- **Inspect** how `--json`, `--repo`, and `--quiet` flags are inherited from the parent program via `optsWithGlobals()`.
- **Reason about** interactive vs. non-interactive modes (for example, the pointer command's `promptYesNo` flow and the explicit opt-in rules).

## How it fits

`packages/cli/src/commands/` sits between the Commander entry point in `packages/cli/src/cli.ts` and the domain logic in `@livewiki/core/*`. Each file exports one `registerX(program)` that attaches a subcommand to the root program. Some files (for example `stub.ts` and `pointer.ts`) also export small helpers reused across commands. The command layer is responsible for argument parsing, output formatting, and exit-code propagation; it intentionally avoids calling `process.exit` so Node can drain pending I/O before terminating.

## Batch command and status/result formatting

<!-- lw:anchors packages/cli/src/commands/batch.ts#registerBatch packages/cli/src/commands/batch.ts#setExitCode packages/cli/src/commands/batch.ts#formatStatusHuman packages/cli/src/commands/batch.ts#formatResultHuman packages/cli/src/commands/batch.ts#formatListHuman -->

The batch subcommand dispatches on positional arguments: with no args it reports the last run's status, `list` enumerates runs, `status [runId]` reports a specific run, `resume <runId>` continues a pending run, and `--only <target> <runId>` re-runs a single task. Any unrecognised argument is rejected with a usage error.

```ts
export function registerBatch(program: Command): void
```

`setExitCode` translates a run status into `process.exitCode`: `completed` → 0, `completed_with_failures` → 1, `aborted` → 2. When `--json` is active the helper is a no-op so structured output always exits 0.

```ts
function setExitCode(repoRoot: string, status: string, json: boolean): void
```

`formatStatusHuman` and `formatResultHuman` render token-first reports: token totals are primary, USD cost is secondary and labelled "estimated". `formatListHuman` produces a compact table of run ids and statuses. Failure sections include a `retry:` line; failed stage-4 tasks also append a per-attempt diagnostic sequence.

## Batch diagnostics helpers and shared note

<!-- lw:anchors packages/cli/src/commands/batch.ts#USAGE_INCOMPLETE_NOTE packages/cli/src/commands/batch.ts#formatDiagnosticLine packages/cli/src/commands/batch.ts#appendStage4Diagnostics -->

When token totals are incomplete (some attempts report unknown usage) the human output appends the shared `USAGE_INCOMPLETE_NOTE` so users know to rely on provider billing rather than the displayed totals.

```ts
export const USAGE_INCOMPLETE_NOTE =
  "Note: totals are incomplete — some attempts have unknown usage. Prefer proxy/provider billing for wire cost.";
```

`formatDiagnosticLine` renders one compact ordered line per attempt, deduplicating error codes while preserving first-seen order. `appendStage4Diagnostics` walks `task.diagnosticHistory` for a failed stage-4 task and appends the lines; it returns silently when the history is empty or when the task never reached the LLM.

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

## Export command and error shaping

<!-- lw:anchors packages/cli/src/commands/export.ts#registerExport packages/cli/src/commands/export.ts#exportErrorToResult packages/cli/src/commands/export.ts#emit -->

`registerExport` validates the target up front, then wraps `exportWiki` in a try/catch so any thrown `ExportError` or unexpected error is converted into a structured `ExportResult`. The `--push` flag is reserved for Lot 6B and rejected before any write. Exit codes: 0 on success, 1 on invalid target, preflight failure, write failure, or `--push` in this lot.

```ts
export function registerExport(program: Command): void
```

`exportErrorToResult` distinguishes `ExportError` (which carries an `issues` list) from generic errors (mapped to a single `write_failed` issue using `err instanceof Error ? err.message : String(err)`). `emit` sets `process.exitCode` before writing, so JSON failures also exit 1.

```ts
function exportErrorToResult(
  absRoot: string,
  target: ExportTarget,
  err: unknown,
): ExportResult
```

```ts
function emit(json: boolean, result: ExportResult): void
```

## Index command, ignore accumulator, and ledger formatter

<!-- lw:anchors packages/cli/src/commands/index-cmd.ts#registerIndex packages/cli/src/commands/index-cmd.ts#collectIgnore packages/cli/src/commands/index-cmd.ts#emit packages/cli/src/commands/index-cmd.ts#formatLedgerHuman -->

`registerIndex` merges `.livewiki/config.json` ignores with the repeatable `--ignore` flag, then runs the indexer followed by the anchor-ledger (unless `--no-ledger` is passed). `loadConfig` throwing on malformed JSON is intentional fail-closed behaviour — corrupt config is never silently ignored.

```ts
export function registerIndex(program: Command): void
```

`collectIgnore` is the Commander accumulator for repeatable `--ignore <pattern>`: each invocation concatenates the new value onto the previous list.

```ts
function collectIgnore(value: string, previous: string[]): string[]
```

`emit` honours the `--quiet` flag (suppresses human output but keeps JSON) and `formatLedgerHuman` renders the ledger summary including the moved-pairs list when present.

```ts
function emit(
  json: boolean,
  quiet: boolean,
  indexResult: IndexResult,
  ledgerResult: LedgerResult | null,
): void
```

```ts
function formatLedgerHuman(r: LedgerResult): string
```

## Init command and human formatter

<!-- lw:anchors packages/cli/src/commands/init.ts#registerInit packages/cli/src/commands/init.ts#formatHuman -->

`registerInit` drives the deterministic Phase 3 setup (creates `livewiki/` + `.livewiki/`, indexes, generates layout) with no LLM by default. With `--batch` it triggers the full LLM pipeline, `--plan` shows a heuristic plan without writing, and `--no-refine` skips stage-2 refinement. The exit code propagates `batchExitCode` from core (0/1/2) when `--json` is not set; `--json` preserves exit 0 per batch convention.

```ts
export function registerInit(program: Command): void
```

`formatHuman` branches on whether `result.plan` is present: when set, it lists modules/files/symbols/edges without writing; otherwise it lists `filesWritten`, surfaces any preserved hubs or skipped flow/topics plans (never silent), and prints the batch summary.

```ts
function formatHuman(result: { plan?: InitPlanReport; filesWritten: string[]; batchSummary?: { runId: number; status: string; tasksDone: number; tasksFailed: number }; batchExitCode?: 0 | 1 | 2; skipp
```

The error branch in `registerInit` sets `process.exitCode = 1` instead of calling `process.exit(1)`, because an abrupt exit can crash libuv while async handles (fetch, SQLite WAL, watcher) are still open.

## Pointer command and prompt/status helpers

<!-- lw:anchors packages/cli/src/commands/pointer.ts#registerPointer packages/cli/src/commands/pointer.ts#promptYesNo packages/cli/src/commands/pointer.ts#formatPointerResult packages/cli/src/commands/pointer.ts#formatStatusHuman packages/cli/src/commands/pointer.ts#_internal -->

`registerPointer` enforces the SPEC's "Inviolable rule #2": writes only with an explicit flag (`--write-pointer` / `--yes`) or interactive confirmation. Without flags it shows read-only status. Without a flag AND without a TTY it fails closed with a stderr message — never a silent write. `--remove` follows the same rules but is treated as more destructive.

```ts
export function registerPointer(program: Command): void
```

`promptYesNo` writes the question to stdout and resolves on the first newline (or stdin end) when the trimmed answer equals `y` or `yes`. `formatPointerResult` and `formatStatusHuman` render write/remove outcomes and the present/not-present status block. `_internal` re-exports `nodeFs` for tests; it is not part of userspace.

```ts
async function promptYesNo(question: string): Promise<boolean>
```

```ts
function formatStatusHuman(status: { present: boolean; file: PointerFile | null; inner?: string }): string
```

```ts
export const _internal = { nodeFs };
```

## Stub action factory

<!-- lw:anchors packages/cli/src/commands/stub.ts#makeStubAction -->

`makeStubAction` returns a Commander action that emits a structured `{ ok: false, stub, phase, repoRoot, message, planned }` payload (or human text), inheriting `--json` and `--repo` from the parent program. Commands still in their planned phase (`serve`, `view`) use this factory so the surface area stays consistent before their real implementations land.

```ts
export function makeStubAction(info: StubInfo)
```

```ts
export interface StubInfo {
  name: string;
  /** Fase da SPEC em que o comando será implementado (1-7). */
  phase: number;
  /** Frase curta do que o comando vai fazer quando implementado. */
  planned: string;
}
```

## Serve and view registrations

<!-- lw:anchors packages/cli/src/commands/serve.ts#registerServe packages/cli/src/commands/view.ts#registerView -->

Both `serve` (Phase 4 MCP stdio server) and `view` (Phase 7 static site) are registered via `makeStubAction` with their target phase and a short `planned` description. Replacing the stub with a real handler keeps the same `(options, command) => Promise<void>` signature.

```ts
export function registerServe(program: Command): void
```

```ts
export function registerView(program: Command): void
```

## Status registration

<!-- lw:anchors packages/cli/src/commands/status.ts#registerStatus -->

`registerStatus` runs the core status report, optionally trimming the per-file top list with `--top <n>` (default 10). Errors are written to stderr and `process.exitCode` is set to 1 instead of calling `process.exit`, so Node can drain pending I/O before terminating.

```ts
export function registerStatus(program: Command): void
```

## Update command and work-package formatter

<!-- lw:anchors packages/cli/src/commands/update.ts#registerUpdate packages/cli/src/commands/update.ts#formatHuman -->

`registerUpdate` is the Phase 5 incremental entry point. It branches on three modes: `--record-write <tokens>` records a write-back metric without emitting a package; `--llm` currently exits with code 1 and points the user at the batch orchestrator (full mode); the default mode loads a work package and reports a `savedRatio` economy figure against an estimated full-read token budget.

```ts
export function registerUpdate(program: Command): void
```

`formatHuman` renders the manifest summary (last documented commit, optional pending batch), the first five debt items with their assignee/wiki path, snippet and validAnchor counts, and the token/byte estimate. It also surfaces the thesis: a focused package is cheaper than re-reading the whole repo.

```ts
function formatHuman(pkg: Awaited<ReturnType<typeof loadWorkPackage>>): string
```

The `--record-write` path validates the token count (`non-negative integer`) and estimates bytes via `tokens * 4` because the CLI caller does not pass byte counts; the metric is recorded against `wikiPath: "(manual)"`.

## Verify registration

<!-- lw:anchors packages/cli/src/commands/verify.ts#registerVerify -->

`registerVerify` validates the wiki against the index (broken anchors, altered manual blocks, internal links) and exits non-zero on failure, making it CI-friendly. Errors during verification are written to stderr and `process.exitCode` is set to 1; the action does not call `process.exit`.

```ts
export function registerVerify(program: Command): void
```

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
- Flow: [CLI scaffold through export hashing](flows/cli-src-to-core-src-04.md)
- ["Core pipeline: batch orchestration, config, db, and diagrams"](core-src-03.md) — dependency
- [core-src-08 — prompts, safe I/O, status, symbol extraction, and topic planning](core-src-08.md) — dependency
- [Core export, frontmatter, gitignore, flow detection, and hashing](core-src-04.md) — dependency
<!-- livewiki:navigate:end -->
