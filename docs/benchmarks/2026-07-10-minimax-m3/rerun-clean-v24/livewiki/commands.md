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

This page documents the per-command registration modules under `packages/cli/src/commands/`, each of which wires a single Commander subcommand into the `livewiki` CLI and routes invocation to the corresponding core orchestrator.

## When to use this page

- **Register** a new `livewiki` subcommand by adding a sibling file and calling its `register*` function from `packages/cli/src/cli.ts`.
- **Trace** the human-output formatting (token totals, USD estimates, hub preservation, etc.) back to the `format*Human` helpers defined alongside each registration.
- **Adjust** exit-code semantics (`process.exitCode` mapping for batch/init/export/verify) by editing the small `setExitCode`-style blocks inside each command's action handler.

## How it fits

These files live under `packages/cli/src/commands/` and are consumed exclusively by the top-level CLI entry point `packages/cli/src/cli.ts`, which assembles them in registration order. Each module exports a single `register*(program)` function that attaches a Commander command and delegates to `@livewiki/core/*` for the actual work. Local helpers in this folder are limited to JSON-or-human emission, exit-code selection, and the few stub actions used by not-yet-implemented phases (4 and 7). Because every handler wraps its core call in a `try`/`catch` that writes to stderr and sets `process.exitCode = 1` rather than calling `process.exit(1)`, the surrounding code can rely on the event loop draining even on Windows. The visible behavior below comes directly from the source excerpt; this page does not claim completeness beyond it.

## batch command

<!-- lw:anchors packages/cli/src/commands/batch.ts#registerBatch packages/cli/src/commands/batch.ts#setExitCode packages/cli/src/commands/batch.ts#formatStatusHuman packages/cli/src/commands/batch.ts#formatResultHuman packages/cli/src/commands/batch.ts#formatListHuman packages/cli/src/commands/batch.ts#appendStage4Diagnostics packages/cli/src/commands/batch.ts#formatDiagnosticLine packages/cli/src/commands/batch.ts#USAGE_INCOMPLETE_NOTE -->

The `livewiki batch` family is the Phase 3 orchestrator interface. It exposes subcommands `status` (default), `resume`, `--only <target>`, and `list`, and uses three terminal exit codes (`0` completed, `1` completed with failures, `2` aborted circuit-breaker).

```ts
export function registerBatch(program: Command): void
```

The handler reads `command.args`, dispatches to `buildStatusReport`, `listRuns`, `resumeBatch`, or `runOnly`, and pipes results through the shared `emit` helper. Commander's `--no-refine` is mapped to the boolean `opts.refine === false`, and that case is forwarded as `noRefine: true` only to `resumeBatch`. When parsing of `runId` fails, or when an unknown subcommand is supplied, the handler `throw`s an `Error`; the surrounding `try`/`catch` writes to stderr and sets `process.exitCode = 1`.

```ts
function setExitCode(repoRoot: string, status: string, json: boolean): void
```

`setExitCode` is the sole authority for the batch exit-code mapping and is intentionally a no-op when `--json` is set so structured-output callers always observe exit 0.

```ts
export function formatStatusHuman(report: Awaited<ReturnType<typeof buildStatusReport>>): string
```

`formatStatusHuman` is the token-first human report: it prints run identifiers, `tasksDone`/`tasksFailed` from `report.run.summary`, per-stage token counts, the `USAGE_INCOMPLETE_NOTE` constant when `t.usageIncomplete` is set, a USD-estimate block only when at least one model has pricing, and a per-module breakdown when `report.byModule` is non-empty. Failure entries include `f.error.code`, `f.error.message`, the per-attempt diagnostic sequence for stage-4 tasks (via `appendStage4Diagnostics`), and `f.retryCommand`.

```ts
export function formatResultHuman(result: Awaited<ReturnType<typeof runBatch>>): string
```

`formatResultHuman` is the analogous formatter for a finished `runBatch`/`resumeBatch`/`runOnly` result: tokens, optional USD, authoritative `tasksDone`/`failures` counts, the `circuit breaker: TRIGGERED` line, the three `skipped*Hub` lines when a human/mixed/unparseable hub was preserved, and a per-skip entry for every entry in `result.skippedFlowCandidates`.

```ts
function formatListHuman(runs: Awaited<ReturnType<typeof listRuns>>): string
```

`formatListHuman` is a thin wrapper that emits `(none)` for an empty list and one aligned row per run with id, status, start, and finish timestamps.

```ts
function appendStage4Diagnostics(
  lines: string[],
  report: Awaited<ReturnType<typeof buildStatusReport>>,
  failureTaskId: number,
): void
```

`appendStage4Diagnostics` is a side-effect helper: it looks up `failureTaskId` in `report.tasks`, returns silently when the task has no `diagnosticHistory`, and otherwise pushes an `attempts:` block whose entries are produced by `formatDiagnosticLine`.

```ts
function formatDiagnosticLine(d: {
  attempt: number;
  stopReason?: string;
  outcome: string;
  errors: Array<{ code: string }>;
}): string
```

`formatDiagnosticLine` renders one ordered per-attempt line `attempt <n>: <stopReason> -> <outcome> [<deduped codes>]`. `stopReason` falls back to `"-"` when the LLM did not provide one (e.g. `llm_error`), and codes are deduplicated while preserving first-seen order to match the validator enumeration.

```ts
export const USAGE_INCOMPLETE_NOTE =
  "Note: totals are incomplete — some attempts have unknown usage. Prefer proxy/provider billing for wire cost.";
```

`USAGE_INCOMPLETE_NOTE` is the shared one-line caveat that both `formatStatusHuman` and `formatResultHuman` interpolate when `usageIncomplete` is true. The same excerpt does not establish exhaustive handling across every consumer, but every visible call site in this file uses it the same way.

## export command

<!-- lw:anchors packages/cli/src/commands/export.ts#registerExport packages/cli/src/commands/export.ts#exportErrorToResult packages/cli/src/commands/export.ts#emit -->

`livewiki export <target>` is the Phase 6 Lot 6A writer that copies the flattened wiki into `.livewiki/export/<target>/`, with `--force` to overwrite marker-less destinations and `--push` reserved for Lot 6B (always rejected with exit 1 in this lot).

```ts
export function registerExport(program: Command): void
```

The handler validates the target via `validateTarget` first, converting any thrown `ExportError` through `exportErrorToResult` so the JSON contract is honored before any work is attempted. The actual `exportWiki` call is wrapped in a second `try`/`catch` to keep the global fatal handler from receiving unexpected throws. `--force` and `--push` are forwarded only when the corresponding option was set.

```ts
function exportErrorToResult(
  absRoot: string,
  target: ExportTarget,
  err: unknown,
): ExportResult
```

`exportErrorToResult` returns a structured `ExportResult` with `ok: false`. For an `ExportError`, it copies `err.issues` directly; for any other error it constructs a single `write_failed` `ExportIssue` whose `detail` is `err.message` when `err instanceof Error`, else `String(err)`. The excerpt does not establish behavior for a thrown `null`/primitive beyond that fallback.

```ts
function emit(json: boolean, result: ExportResult): void
```

`emit` is the only writer in this file: it sets `process.exitCode` from `result.ok` (0 on success, 1 otherwise), emits `{ ok, export }` as JSON when `--json` is set, and otherwise prints the one-line summary plus a structured issue list. `--json` failures intentionally exit 1 here.

## index command

<!-- lw:anchors packages/cli/src/commands/index-cmd.ts#registerIndex packages/cli/src/commands/index-cmd.ts#collectIgnore packages/cli/src/commands/index-cmd.ts#emit packages/cli/src/commands/index-cmd.ts#formatLedgerHuman -->

`livewiki index` is the Phase 1+2 reindex entry point: it (re)extracts symbols, refreshes hashes, and chains the anchor ledger so changed/moved/deleted detection is part of the same invocation.

```ts
export function registerIndex(program: Command): void
```

The action merges `loadConfig().ignores` with the repeatable `--ignore` CLI flag (additive, not overriding), forwards them to `runIndexer`, and then calls `runLedger` unless Commander maps `--no-ledger` to `opts.ledger === false`. `quiet` is computed as `json || opts.quiet`, so hooks get no stdout and `--json` callers get structured output. `loadConfig` throws on malformed JSON by design (the source calls this a "T0 fail-closed" posture); the catch handler writes to stderr and sets `process.exitCode = 1`.

```ts
function collectIgnore(value: string, previous: string[]): string[]
```

`collectIgnore` is the Commander arg-collector for the repeatable `--ignore <pattern>` flag: it appends each occurrence to `previous` and returns the new array.

```ts
function emit(
  json: boolean,
  quiet: boolean,
  indexResult: IndexResult,
  ledgerResult: LedgerResult | null,
): void
```

`emit` returns immediately when `quiet && !json`, otherwise writes either a combined `{ ok, index, ledger }` JSON envelope or the human formatters. It is intentionally narrow — it does not touch exit codes, leaving that to the action's `try`/`catch`.

```ts
function formatLedgerHuman(r: LedgerResult): string
```

`formatLedgerHuman` prints a small ledger summary: pages processed/skipped, anchors upserted, the `+changed +moved +deleted` debt breakdown, undocumented-symbol count, and a `moved pairs:` block listing every `from → to` pair from `r.movedPairs`.

## init command

<!-- lw:anchors packages/cli/src/commands/init.ts#registerInit packages/cli/src/commands/init.ts#formatHuman -->

`livewiki init` is the Phase 3 onboarding step: it creates `livewiki/` and `.livewiki/`, indexes, generates deterministic layout (quickstart + diagrams + manifest), and — with `--batch` — runs the full LLM pipeline. `--plan` is a no-LLM, no-writes preview, and `--no-refine` skips stage-2 LLM refinement.

```ts
export function registerInit(program: Command): void
```

The handler resolves the repo, maps Commander's `--no-refine` to a `noRefine: true` flag (only forwarded when `opts.refine === false`), forwards `batch`/`plan` only when they were explicitly set, and pipes the result through `emit`. The batch exit code is propagated as `process.exitCode = result.batchExitCode` only when `--json` is not set; `--json` always exits 0 per the batch CLI convention. The catch handler uses `process.exitCode = 1` instead of `process.exit(1)` to avoid the libuv `STATUS_STACK_BUFFER_OVERRUN` described in the file-level comment.

```ts
function formatHuman(result: { plan?: InitPlanReport; filesWritten: string[]; batchSummary?: { runId: number; status: string; tasksDone: number; tasksFailed: number }; batchExitCode?: 0 | 1 | 2; skippedFlowsHub?: { path: string; owner: "human" | "mixed" | null }; skippedAuxiliaryHub?: { path: string; owner: "human" | "mixed" | null }; skippedTopicsHub?: { path: string; owner: "human" | "mixed" | null }; skippedFlowCandidates?: Array<{ slug: string; code: string; message: string }> }): string
```

`formatHuman` is a single-shape formatter that branches on `result.plan`: when present, it renders the plan summary with an ordered `prioritized` list and exits; otherwise it prints the file-write manifest, the three `skipped*Hub` preservation lines when present, one line per `skippedFlowCandidates` entry, and the optional `batchSummary` block including `batchExitCode`.

## pointer command

<!-- lw:anchors packages/cli/src/commands/pointer.ts#registerPointer packages/cli/src/commands/pointer.ts#promptYesNo packages/cli/src/commands/pointer.ts#formatPointerResult packages/cli/src/commands/pointer.ts#formatStatusHuman packages/cli/src/commands/pointer.ts#_internal -->

`livewiki pointer` implements SPEC inviolable rule #2: writes to `AGENTS.md`/`CLAUDE.md` happen **only** behind `--write-pointer`/`--yes`, an interactive y/N prompt on a TTY, or a removal confirmation. No silent writes.

```ts
export function registerPointer(program: Command): void
```

The handler validates `--file` against `POINTER_FILES`, rejects unknown values with exit 1, and then routes into three modes: `--remove`, `--write-pointer`/`--yes`, or default (status read + optional TTY prompt). The non-TTY, no-flag path explicitly fails closed by writing a rule-explanation to stderr and setting `process.exitCode = 1` — both for the write path and for `--remove` without an explicit flag.

```ts
async function promptYesNo(question: string): Promise<boolean>
```

`promptYesNo` writes the question to stdout, listens for a single newline (or EOF) on stdin, trims/lowercases the answer, and resolves `true` only for `y`/`yes`. It does not echo the user's input and does not validate against an empty prompt on EOF — `""` resolves to `false`.

```ts
function formatPointerResult(
  result: { file: PointerFile; action: string; bytesWritten: number },
  verb: "wrote" | "removed",
): string
```

`formatPointerResult` selects a verb past tense from `(verb, action)`: `"wrote"` for `inserted`, `"updated"` for `replaced`, `"unchanged"` otherwise, and `"removed"` for the remove verb. It omits the byte-delta line when `bytesWritten === 0`.

```ts
function formatStatusHuman(status: { present: boolean; file: PointerFile | null; inner?: string }): string
```

`formatStatusHuman` returns a single-line "not present" message when `!status.present`, or a delimited fence of the existing pointer's inner block when present.

```ts
export const _internal = { nodeFs };
```

`_internal` re-exports `nodeFs` for tests; it is not exposed to userspace and does not affect runtime behavior.

## serve, status, stub, update, verify, view

<!-- lw:anchors packages/cli/src/commands/serve.ts#registerServe packages/cli/src/commands/status.ts#registerStatus packages/cli/src/commands/stub.ts#makeStubAction packages/cli/src/commands/update.ts#registerUpdate packages/cli/src/commands/update.ts#formatHuman packages/cli/src/commands/verify.ts#registerVerify packages/cli/src/commands/view.ts#registerView -->

```ts
export function registerServe(program: Command): void
```

`registerServe` wires `livewiki serve` to `makeStubAction({ name: "serve", phase: 4, planned: "MCP server stdio with 6 tools (livewiki_quickstart/read/search/debt/write_doc/resolve_debt)" })`; the Phase 4 implementation will replace this stub.

```ts
export function registerStatus(program: Command): void
```

`registerStatus` registers `livewiki status` (Phase 1/2), accepts `--top <n>` (parsed via `Number.parseInt` with a default of `10`), delegates to `runStatus(repoRoot, { topN })`, emits JSON or human output through `formatStatusHuman`, and on any error writes to stderr and sets `process.exitCode = 1`. It does not set a non-zero exit code based on the report content — only on thrown errors.

```ts
export function makeStubAction(info: StubInfo)
```

`makeStubAction` returns an async action handler that honors the parent program's `--json`/`--repo` via `optsWithGlobals`, resolves the repo root, and emits a structured stub payload (`ok: false`, `stub`, `phase`, `repoRoot`, `message`, `planned`) or the matching human line. Every stub exits 0 because the command "executed" — only the underlying implementation is missing. `StubInfo` carries `name`, `phase: number` (1-7), and a one-line `planned` description.

```ts
export function registerUpdate(program: Command): void
```

`registerUpdate` is the Phase 5 incremental entry point. It supports `--record-write <tokens>`, `--llm` (rejected with exit 1 and a redirect to `batch resume`/`init --batch`), `--snippet-window <lines>`, and the default work-package emission. The `--record-write` path validates a non-negative integer (rejecting `NaN`/negative), lazily imports `recordDocWrittenBack`, estimates `bytes = tokens * 4`, and exits. The default path calls `loadWorkPackage`, computes an economy ratio against `12500` estimated full-read tokens, and emits both via `formatHuman` and a JSON `{ ok, package, economy }` envelope.

```ts
function formatHuman(pkg: Awaited<ReturnType<typeof loadWorkPackage>>): string
```

`formatHuman` prints the work package header, the manifest's `lastDocumentedCommit` and `pendingBatch` when present, the first five debt entries (with an ellipsis for the rest), counts of `snippets` and `validAnchors`, the token/byte estimate, and the focused-vs-full-read thesis line.

```ts
export function registerVerify(program: Command): void
```

`registerVerify` registers `livewiki verify` (Phase 2, CI-friendly). It calls `runVerify`, swallows errors into stderr + `process.exitCode = 1`, emits JSON or `formatVerifyHuman`, and then sets `process.exitCode = 1` whenever `result.ok === false`. It does not differentiate error severities in the exit code — any non-OK result is exit 1.

```ts
export function registerView(program: Command): void
```

`registerView` wires `livewiki view` to `makeStubAction({ name: "view", phase: 7, planned: "static site with client-side search + Mermaid + templates as data" })`. The `--template <name>` (default `agent`) and `--out <dir>` options are declared on the command but the stub action ignores them; Phase 7 is the planned replacement.
