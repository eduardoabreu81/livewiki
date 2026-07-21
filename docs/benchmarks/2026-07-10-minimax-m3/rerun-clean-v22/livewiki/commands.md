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

This page documents how the livewiki CLI wires its subcommands to `commander` and how each handler produces JSON or human output.

## When to use this page

- **Add** a new top-level `livewiki <cmd>` by writing a `registerX(program)` that returns a `Promise<void>` and follows the existing flag conventions.
- **Choose** the right exit-code pattern (e.g. `process.exitCode = 1` instead of `process.exit(1)`) by reading the helpers in each module.
- **Convert** a thrown error into a structured JSON result with a helper like `exportErrorToResult` so global fatal handlers stay quiet.
- **Stub** a future-phase command by reusing `makeStubAction` rather than hand-writing the boilerplate.

## How it fits

The `commands/` directory sits under `packages/cli/src/`. Each file exports one or more `registerX` functions that the CLI root program (`packages/cli/src/cli.ts`) calls to attach a subcommand to the shared `Command` instance. Every subcommand inherits the global `--json` and `--repo` flags from the parent program, and most commands read those via `command.optsWithGlobals()`. Output rendering is delegated to a shared `emit` helper from `packages/cli/src/output.js`, so JSON mode and human mode share the same exit-code logic. Errors are caught inside the action handler and turned into `process.exitCode = 1` after writing to stderr, never `process.exit(1)`, to avoid libuv assert crashes on Windows when async handles are open.

## `batch` — run, resume, and inspect a documentation batch
<!-- lw:anchors packages/cli/src/commands/batch.ts#registerBatch packages/cli/src/commands/batch.ts#setExitCode packages/cli/src/commands/batch.ts#USAGE_INCOMPLETE_NOTE packages/cli/src/commands/batch.ts#formatStatusHuman packages/cli/src/commands/batch.ts#formatResultHuman packages/cli/src/commands/batch.ts#formatListHuman packages/cli/src/commands/batch.ts#formatDiagnosticLine packages/cli/src/commands/batch.ts#appendStage4Diagnostics -->

The `batch` subcommand dispatches on positional args to one of `status`, `resume`, `--only <target>`, or `list`. No args means "status of the last run". The action handler uses `command.args ?? []` rather than relying on Commander's positional parsing, because the dispatch logic mixes plain subcommands, a `--only` flag, and a numeric `<runId>` in the same place.

```ts
export function registerBatch(program: Command): void {
```

Exit codes follow the `setExitCode` mapping below: `completed` → `0`, `completed_with_failures` → `1`, `aborted` → `2`. `--json` always exits `0` regardless of status (structured output overrides the documented mapping).

```ts
function setExitCode(repoRoot: string, status: string, json: boolean): void {
```

`USAGE_INCOMPLETE_NOTE` is a shared human-output string that both `formatStatusHuman` and `formatResultHuman` append when `usageIncomplete` is set on the totals. It tells the user to prefer proxy/provider billing for wire cost when token counters are partial.

```ts
export const USAGE_INCOMPLETE_NOTE =
  "Note: totals are incomplete — some attempts have unknown usage. Prefer proxy/provider billing for wire cost.";
```

`formatStatusHuman` renders a token-first status report (input/output per stage, with USD as an "estimated" secondary line and "omitted without drama" when no pricing exists). For each failure on stage 4, it calls `appendStage4Diagnostics` to append the per-attempt diagnostic sequence.

```ts
export function formatStatusHuman(report: Awaited<ReturnType<typeof buildStatusReport>>): string {
```

`formatResultHuman` renders the end-of-run summary returned by `runBatch`. It also surfaces preserved human/mixed/unparseable hub skips (`skippedFlowsHub`, `skippedAuxiliaryHub`, `skippedTopicsHub`) and any deterministic pre-LLM `skippedFlowCandidates`, so a preserved hub is never silent. The `tasksDone` / `tasksFailed` counters come from the authoritative per-task counters persisted by `finalizeRun`, not from `byModule.length` (which previously disagreed with `batch status` for the same run).

```ts
export function formatResultHuman(result: Awaited<ReturnType<typeof runBatch>>): string {
```

`formatListHuman` is a thin wrapper over `listRuns`: it prints `#id status started finished` lines, or `(none)` when the run list is empty.

```ts
function formatListHuman(runs: Awaited<ReturnType<typeof listRuns>>): string {
```

`formatDiagnosticLine` and `appendStage4Diagnostics` together implement the stage-4 "attempts:" trailer that mirrors `repair_exhausted` in `core/batch.ts`. `formatDiagnosticLine` deduplicates error codes by first-seen order and falls back to `"-"` when `stopReason` is missing (e.g. `llm_error` outcomes).

```ts
function formatDiagnosticLine(d: {
  attempt: number;
  stopReason?: string;
  outcome: string;
  errors: Array<{ code: string }>;
}): string {
```

`appendStage4Diagnostics` looks up the failed task by `taskId` in the report's task list and silently returns when `diagnosticHistory` is empty (checkpoints that pre-date diagnostics, or tasks that never reached the LLM such as `refused_human_page`).

```ts
function appendStage4Diagnostics(
  lines: string[],
  report: Awaited<ReturnType<typeof buildStatusReport>>,
  failureTaskId: number,
): void {
```

Any thrown error inside the `batch` action is caught, written to stderr as `livewiki batch: error — <message>`, and converted to `process.exitCode = 1`. The handler does not rethrow, so the global fatal handler never sees batch-specific failures.

## `export` — write a flattened wiki snapshot
<!-- lw:anchors packages/cli/src/commands/export.ts#registerExport packages/cli/src/commands/export.ts#exportErrorToResult packages/cli/src/commands/export.ts#emit -->

`livewiki export <target>` is Phase 6 Lot 6A — local deterministic transformation only. The action handler validates the target up front, then calls `exportWiki` inside a try/catch so any thrown error becomes a structured `ExportResult` (rather than escaping to the global fatal handler). `--push <remote>` is reserved for Lot 6B and is rejected at runtime by `exportWiki` itself; the handler passes the option through unchanged.

```ts
export function registerExport(program: Command): void {
```

`exportErrorToResult` converts either an `ExportError` (with its structured `issues` array) or any other thrown value into an `ok: false` `ExportResult`. For non-`ExportError` throws, it extracts the message with `err instanceof Error ? err.message : String(err)` so a thrown `null` or primitive cannot crash the catch handler.

```ts
function exportErrorToResult(
  absRoot: string,
  target: ExportTarget,
  err: unknown,
): ExportResult {
```

`emit` sets `process.exitCode` before writing to stdout: `0` on success, `1` on failure (including JSON failures, per the documented contract). JSON mode writes a single line `{"ok": <bool>, "export": <result>}`; human mode prints a one-line summary followed by a structured issue list.

```ts
function emit(json: boolean, result: ExportResult): void {
```

## `index` — reindex the repo and sync the anchor ledger
<!-- lw:anchors packages/cli/src/commands/index-cmd.ts#registerIndex packages/cli/src/commands/index-cmd.ts#collectIgnore packages/cli/src/commands/index-cmd.ts#emit packages/cli/src/commands/index-cmd.ts#formatLedgerHuman -->

`livewiki index` (re)indexes the repo and then chains the anchor-ledger so changed/moved/deleted detection runs in the same invocation. The action handler merges `.livewiki/config.json` `ignores` with the CLI `--ignore` flag (the CLI flag is additive). `loadConfig` throws on malformed JSON — that is intentional fail-closed behavior; the error is caught at the top of the action handler and converted to a `process.exitCode = 1` with the message written to stderr.

```ts
export function registerIndex(program: Command): void {
```

`collectIgnore` is the Commander accumulator for the repeatable `--ignore <pattern>` flag: it appends each new value to the previous array.

```ts
function collectIgnore(value: string, previous: string[]): string[] {
```

The local `emit` accepts both `json` and `quiet` flags. When `quiet && !json`, it writes nothing to stdout (stderr still carries errors) — this is the mode used by Phase 5 hooks. JSON mode emits `{ok, index, ledger}` on one line; human mode writes the indexer human format and, when a ledger ran, the ledger human format.

```ts
function emit(
  json: boolean,
  quiet: boolean,
  indexResult: IndexResult,
  ledgerResult: LedgerResult | null,
): void {
```

`formatLedgerHuman` prints the ledger summary as `pages processed/skipped`, `anchors upsert`, a per-event debt line (`+N changed +N moved +N deleted`), and the moved-pair list when present.

```ts
function formatLedgerHuman(r: LedgerResult): string {
```

## `init` — initialize livewiki and optionally run the batch pipeline
<!-- lw:anchors packages/cli/src/commands/init.ts#registerInit packages/cli/src/commands/init.ts#formatHuman -->

`livewiki init` creates `livewiki/` and `.livewiki/`, indexes the repo, and generates a deterministic layout (quickstart, diagrams, manifest) without an LLM. `--batch` triggers the full LLM pipeline (stages 1–4); `--plan` shows the module plan without writing or calling an LLM; `--no-refine` skips LLM refinement of stage 2 (Commander maps `--no-refine` to `refine === false`, never to `noRefine`).

```ts
export function registerInit(program: Command): void {
```

When `--batch` is used, `result.batchExitCode` is propagated via `process.exitCode` (only when `--json` is *not* set; `--json` always exits `0`). Without `--batch`, the exit code is always `0`. The action handler wraps `runInit` in try/catch; any thrown error becomes a stderr write + `process.exitCode = 1`.

`formatHuman` produces two distinct outputs depending on whether `result.plan` is present. In `--plan` mode it prints the ordered module list and totals (modules, files, symbols, edges). Otherwise it lists every written file and, when present, the batch summary plus the same preserved-hub lines as `formatResultHuman` (`skippedFlowsHub`, `skippedAuxiliaryHub`, `skippedTopicsHub`, and `skippedFlowCandidates`).

```ts
function formatHuman(result: { plan?: InitPlanReport; filesWritten: string[]; batchSummary?: { runId: number; status: string; tasksDone: number; tasksFailed: number }; batchExitCode?: 0 | 1 | 2; skippedFlowsHub?: { path: string; owner: "human" | "mixed" | null }; skippedAuxiliaryHub?: { path: string; owner: "human" | "mixed" | null }; skippedTopicsHub?: { path: string; owner: "human" | "mixed" | null }; skippedFlowCandidates?: Array<{ slug: string; code: string; message: string }> }): string {
```

## `pointer` — opt-in pointer in `AGENTS.md` / `CLAUDE.md`
<!-- lw:anchors packages/cli/src/commands/pointer.ts#registerPointer packages/cli/src/commands/pointer.ts#promptYesNo packages/cli/src/commands/pointer.ts#formatPointerResult packages/cli/src/commands/pointer.ts#formatStatusHuman packages/cli/src/commands/pointer.ts#_internal -->

`livewiki pointer` is the Phase 5 command for managing the livewiki pointer block. SPEC inviolable rule #2 requires an explicit flag (`--write-pointer` or `--yes`) or interactive confirmation before writing; the action handler implements that by detecting `process.stdin.isTTY` and routing through `promptYesNo` when a TTY is present. No flag AND no TTY → fail-closed with `process.exitCode = 1` and a stderr message. `--remove` follows the same pattern but is even more cautious: removal without an explicit flag is refused unless `--write-pointer` / `--yes` is set or a TTY prompt is answered.

```ts
export function registerPointer(program: Command): void {
```

`promptYesNo` writes the question to stdout, then reads one line from `process.stdin` and resolves `true` only when the trimmed lowercase answer is `y` or `yes`. It binds both `data` and `end` listeners so EOF on a non-TTY stream still resolves the promise instead of hanging.

```ts
async function promptYesNo(question: string): Promise<boolean> {
```

`formatPointerResult` renders the result of an insert/remove with a verb computed from the `action` field returned by the core helper (`inserted` → "wrote", `replaced` → "updated", else → "unchanged"; removes always render as "removed"). It appends a signed byte delta only when the delta is non-zero.

```ts
function formatPointerResult(
  result: { file: PointerFile; action: string; bytesWritten: number },
  verb: "wrote" | "removed",
): string {
```

`formatStatusHuman` is the read-only status renderer: it prints `not present (run with --write-pointer to add)` or the current block wrapped in `---` fences for diff-ability.

```ts
function formatStatusHuman(status: { present: boolean; file: PointerFile | null; inner?: string }): string {
```

`_internal` re-exports `nodeFs` for tests. It is not part of the user-facing API and is intentionally suffixed with an underscore.

```ts
export const _internal = { nodeFs };
```

## `serve` — start the MCP server (stub)
<!-- lw:anchors packages/cli/src/commands/serve.ts#registerServe -->

`livewiki serve` is a Phase 4 stub. The handler delegates entirely to `makeStubAction` with `name: "serve"`, `phase: 4`, and the planned description "MCP server stdio with 6 tools (livewiki_quickstart/read/search/debt/write_doc/resolve_debt)". Replacing this stub is the entire job for Phase 4 — no flag changes are needed at the registration site.

```ts
export function registerServe(program: Command): void {
```

## `status` — index report with debt and undocumented counts
<!-- lw:anchors packages/cli/src/commands/status.ts#registerStatus -->

`livewiki status` runs `@livewiki/core/status#run` with a `topN` from `--top <n>` (default 10), then renders either JSON (`{ok, ...report}`) or human output via `@livewiki/core/status#formatHuman`. Errors thrown by `runStatus` are caught, written to stderr, and converted to `process.exitCode = 1`. Commander 12 does not pass global options in the first action argument, so the handler reads `optsWithGlobals()` instead.

```ts
export function registerStatus(program: Command): void {
```

## `stub` — shared boilerplate for unimplemented commands
<!-- lw:anchors packages/cli/src/commands/stub.ts#makeStubAction -->

`makeStubAction` returns a Commander action handler that emits a structured stub payload via the shared `emit` helper. The JSON shape is `{ok: false, stub, phase, repoRoot, message, planned}`; the human shape is `livewiki <name>: stub (Fase <phase> da SPEC). Implementação prevista: <planned>`. Both modes exit `0` — a stub is a "command executed but not implemented" success, not an error.

```ts
export function makeStubAction(info: StubInfo) {
```

Replacing a stub at the call site (e.g. `serve.ts`, `view.ts`) preserves the `(options, command) => Promise<void>` signature, so the parent program does not need to change.

## `update` — emit a work package or record a write-back
<!-- lw:anchors packages/cli/src/commands/update.ts#registerUpdate packages/cli/src/commands/update.ts#formatHuman -->

`livewiki update` is the Phase 5 incremental-mode command. It has three branches inside the action handler, dispatched in this order:

1. `--record-write <tokens>`: validates a non-negative integer, then calls `recordDocWrittenBack` from `@livewiki/core/update` with `bytes = tokens * 4` (since bytes are not available at the CLI boundary), and emits a `{ok, recorded: {tokens, bytes}}` summary.
2. `--llm`: writes a stderr message pointing the user at `livewiki batch resume <runId>` / `livewiki init --batch` and sets `process.exitCode = 1` — full LLM mode is delegated to `batch`, not implemented inside `update`.
3. Default (no flag): loads the work package via `loadWorkPackage(repoRoot, {snippetWindow})` and emits it together with an `economy` object that compares `packageTokens` against an estimated full-repo read (`12500` tokens for ~50 KB of medium source).

```ts
export function registerUpdate(program: Command): void {
```

`formatHuman` prints the work package summary in human mode: manifest info (`lastDocumentedCommit`, `pendingBatch`), the first 5 debt items (with a `+N more` trailer when truncated), snippet and validAnchor counts, the estimated token/byte total, and a one-line economy thesis.

```ts
function formatHuman(pkg: Awaited<ReturnType<typeof loadWorkPackage>>): string {
```

Errors thrown anywhere in the handler become a stderr write plus `process.exitCode = 1`, consistent with the other commands' libuv-safe exit pattern.

## `verify` — validate anchors, manual blocks, and internal links
<!-- lw:anchors packages/cli/src/commands/verify.ts#registerVerify -->

`livewiki verify` calls `@livewiki/core/verify#run` and renders the result as JSON or human output via `formatVerifyHuman`. The action handler wraps `runVerify` in try/catch: a thrown error is logged to stderr and converted to `process.exitCode = 1`. After a successful call, `process.exitCode = 1` is also set when `result.ok === false`, making the command CI-friendly per the SPEC ("Exits with non-zero on failure").

```ts
export function registerVerify(program: Command): void {
```

The handler does not call `setExitCode` itself — the `if (!result.ok) process.exitCode = 1` line at the bottom is the only exit-code assignment, and it is skipped entirely when `result.ok` is true.

## `view` — generate the static site (stub)
<!-- lw:anchors packages/cli/src/commands/view.ts#registerView -->

`livewiki view` is a Phase 7 stub. It registers `--template <agent|docs>` (default `agent`) and `--out <dir>` (default `.livewiki/site/`), then delegates the action to `makeStubAction` with `name: "view"`, `phase: 7`, and the planned description "static site with client-side search + Mermaid + templates as data". The flags are declared now so that future implementations can read them from `command.optsWithGlobals()` without changing the registration shape.

```ts
export function registerView(program: Command): void {
```

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
- Flow: [CLI bootstrap to wiki export (cli-src to core-src-04)](flows/cli-src-to-core-src-04.md)
- [Batch orchestration, config, index DB, and diagram generators](core-src-03.md) — dependency
- [Core prompt, I/O allowlist, symbol extraction, status and topic planning](core-src-08.md) — dependency
- [Wiki export, flow detection, and parser helpers](core-src-04.md) — dependency
<!-- livewiki:navigate:end -->
