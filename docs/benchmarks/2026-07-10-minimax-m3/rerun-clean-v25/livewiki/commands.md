---
title: livewiki commands
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

# livewiki commands

This page documents the per-command registration modules under `packages/cli/src/commands/`, each of which wires a `commander` command into the top-level `livewiki` program.

## When to use this page

- **Register a new CLI subcommand** by following the `registerX(program: Command)` pattern used in every file under `packages/cli/src/commands/`.
- **Match command output to a specific formatter** when triaging `--json` vs. human output across batch, init, update, and export.
- **Trace pointer/AGENTS.md behavior** when auditing the explicit-opt-in rules enforced in `commands/pointer.ts`.
- **Stub a not-yet-implemented phase** using `makeStubAction` rather than writing a fresh handler.

## How it fits

The `commands` folder is the boundary between the `commander` program in `packages/cli/src/cli.ts` and the `core` packages under `@livewiki/core/*`. Each `registerX` function calls `program.command(...)` and binds an action handler that resolves `--repo`, calls a `core` operation (`runInit`, `runBatch`, `runIndexer`, `runLedger`, `runVerify`, etc.), and routes the result through `emit` from `packages/cli/src/output.js`. The folder also hosts pure formatter helpers (`formatHuman`, `formatStatusHuman`, `formatListHuman`, `formatDiagnosticLine`) that translate structured results into human-readable lines, plus a `stub.ts` helper that registered commands (`serve`, `view`) use to advertise planned-but-not-implemented phases. The `pointer.ts` module additionally enforces Inviolable rule #2 by reading stdin/`isTTY` to decide whether a write is interactive. The excerpts below reflect the source as supplied; behavior beyond what is visible here (e.g., downstream consumers in `core/`) is not documented on this page.

## `batch` command and formatters
<!-- lw:anchors packages/cli/src/commands/batch.ts#registerBatch packages/cli/src/commands/batch.ts#USAGE_INCOMPLETE_NOTE packages/cli/src/commands/batch.ts#formatStatusHuman packages/cli/src/commands/batch.ts#formatResultHuman packages/cli/src/commands/batch.ts#formatListHuman packages/cli/src/commands/batch.ts#setExitCode -->

The `batch` module binds `livewiki batch ...` and dispatches to one of four subcommands based on positional args: default status, `list`, `status [runId]`, `resume <runId>`, or `--only <target> <runId>`. The handler reads `--json` and `--repo` from `optsWithGlobals()`, resolves the repo via `resolveRepoRoot(opts.repo)`, and converts relative paths with `path.resolve(process.cwd(), repoRoot)`. Commander maps `--no-refine` to `opts.refine === false`, which the action handler forwards as `noRefine: true` only when `refine === false`.

```ts
export function registerBatch(program: Command): void {
```

Throws from the underlying `core/batch` operations (or explicit usage errors such as `unknown subcommand: ${sub}`) are caught in a single `try/catch`; the handler writes `livewiki batch: error — <message>` to stderr and assigns `process.exitCode = 1` rather than calling `process.exit(1)`. The comment near the catch explains the choice as a libuv/Windows safety fix: abrupt `process.exit` can crash Node while async handles are still open.

```ts
export const USAGE_INCOMPLETE_NOTE =
  "Note: totals are incomplete — some attempts have unknown usage. Prefer proxy/provider billing for wire cost.";
```

This shared string is appended to human output whenever `usageIncomplete` is true in either status or result totals, so both formatters stay aligned.

```ts
export function formatStatusHuman(report: Awaited<ReturnType<typeof buildStatusReport>>): string {
```

The status formatter is token-first: it prints `tasks done/failed` from `report.run.summary` (a Priority-0 fix that prefers the persisted `finalizeRun` counts over `byModule.length`), then the token totals with per-stage breakdown. When `usageIncomplete` is true it appends `USAGE_INCOMPLETE_NOTE`. USD is rendered only when at least one entry has a non-null `costUsd`; otherwise the line `USD: omitted (no model with pricing in table as of ...)` is emitted without drama. Per-module rows appear only when `report.byModule.length > 0`, and failed stage-4 tasks list per-attempt diagnostics followed by a `retry: <cmd>` line.

```ts
export function formatResultHuman(result: Awaited<ReturnType<typeof runBatch>>): string {
```

The result formatter mirrors the status formatter but is keyed off `result.runId`/`result.status`. It prints token totals, `USAGE_INCOMPLETE_NOTE` when applicable, USD as `USD (estimated): $X` when priced, and an explicit `USD: ...` line when totals are zero/incomplete. Preserved human/mixed/unparseable hubs (`skippedFlowsHub`, `skippedAuxiliaryHub`, `skippedTopicsHub`) are never silent — each prints a `hub: preserved` line with the recorded owner. Likewise `skippedFlowCandidates` items are listed individually so deterministic pre-LLM flow skips surface in output.

```ts
function formatListHuman(runs: Awaited<ReturnType<typeof listRuns>>): string {
```

Lists every run as `#<id>  <status>  started <iso>  finished <iso|(running)>`. With no runs it prints `(none)` and returns.

```ts
function setExitCode(repoRoot: string, status: string, json: boolean): void {
```

Maps status to exit codes: `completed` → 0, `completed_with_failures` → 1, `aborted` → 2. When `json` is true the function returns early so `--json` callers always exit 0 per the documented batch contract. The handler always invokes this as its last statement so Node drains pending I/O before exiting.

## batch diagnostics helpers
<!-- lw:anchors packages/cli/src/commands/batch.ts#formatDiagnosticLine packages/cli/src/commands/batch.ts#appendStage4Diagnostics -->

```ts
function formatDiagnosticLine(d: {
  attempt: number;
  stopReason?: string;
  outcome: string;
  errors: Array<{ code: string }>;
}): string {
```

Builds one `attempt N: <stopReason> -> <outcome> [code1, code2, ...]` line per diagnostic entry. `stopReason` falls back to `-` when the LLM did not supply one (e.g., `llm_error` outcomes), and error codes are deduplicated while preserving first-seen order so the user can match the output against the validator enumeration.

```ts
function appendStage4Diagnostics(
  lines: string[],
  report: Awaited<ReturnType<typeof buildStatusReport>>,
  failureTaskId: number,
): void {
```

Locates the failed task by `taskId` and, if `diagnosticHistory` is present and non-empty, pushes a `    attempts:` block followed by one indented `formatDiagnosticLine` per entry. When the checkpoint pre-dates diagnostics (CONTRACT I5) or the task never reached the LLM (e.g., `refused_human_page`), the function returns silently rather than printing an empty section.

## `export` command
<!-- lw:anchors packages/cli/src/commands/export.ts#registerExport packages/cli/src/commands/export.ts#exportErrorToResult packages/cli/src/commands/export.ts#emit -->

```ts
export function registerExport(program: Command): void {
```

Binds `livewiki export <target>` with `--force` and `--push <remote>` flags. Targets are validated up front via `validateTarget`; a thrown `ExportError` is converted to a structured `ExportResult` so the JSON contract stays intact even on invalid targets. The action handler also wraps `exportWiki` in `try/catch`, routing any unexpected error through `exportErrorToResult` so nothing escapes to the global fatal handler. `--push` is reserved for Lot 6B and is rejected with exit 1 before any write — the comment in source flags this as the Phase 6 Lot 6A boundary.

```ts
function exportErrorToResult(
  absRoot: string,
  target: ExportTarget,
  err: unknown,
): ExportResult {
```

Two branches: an `ExportError` keeps its structured `issues`, otherwise a synthetic `write_failed` `ExportIssue` is built from `err instanceof Error ? err.message : String(err)`. The handler relies on this to keep `ExportError` from escaping the command.

```ts
function emit(json: boolean, result: ExportResult): void {
```

Sets `process.exitCode` before writing (0 on success, 1 on `ok: false`; JSON failures also exit 1). In JSON mode it writes `{ ok, export }`; in human mode it writes a one-line summary plus a `[severity] code path: detail` block per issue.

## `index` command and ledger formatter
<!-- lw:anchors packages/cli/src/commands/index-cmd.ts#registerIndex packages/cli/src/commands/index-cmd.ts#collectIgnore packages/cli/src/commands/index-cmd.ts#emit packages/cli/src/commands/index-cmd.ts#formatLedgerHuman -->

```ts
export function registerIndex(program: Command): void {
```

Binds `livewiki index` with `--ignore <pattern>` (repeatable via `collectIgnore`), `--no-ledger`, and `--quiet`. The action merges `resolveExtraIgnores(config)` with the CLI `--ignore` flag so every entry point shares the configured ignore semantics; `loadConfig` throws on malformed JSON intentionally (the comment calls this T0 fail-closed). Both the indexer and the ledger run with `quiet: json || quiet`. `--no-ledger` is read as `opts.ledger === false`. Errors are caught, written to stderr, and converted to `process.exitCode = 1` without calling `process.exit`.

```ts
function collectIgnore(value: string, previous: string[]): string[] {
```

Used as the `Commander` collector for repeated `--ignore`; it simply concatenates the value to the running array.

```ts
function emit(
  json: boolean,
  quiet: boolean,
  indexResult: IndexResult,
  ledgerResult: LedgerResult | null,
): void {
```

When `quiet && !json` it returns immediately (hooks run with `--quiet` get no stdout). JSON mode writes `{ ok: true, index, ledger }`. Human mode writes the indexer's human output followed by the ledger's human output when `ledgerResult` is non-null.

```ts
function formatLedgerHuman(r: LedgerResult): string {
```

Renders a `livewiki ledger: OK` header, processed/skipped page counts, upsert counts, a `debt: +N changed +N moved +N deleted` line, undocumented-symbol count, and a `moved pairs:` block listing every `from → to` entry when present.

## `init` command and human output
<!-- lw:anchors packages/cli/src/commands/init.ts#registerInit packages/cli/src/commands/init.ts#formatHuman -->

```ts
export function registerInit(program: Command): void {
```

Binds `livewiki init` with `--batch`, `--plan`, and `--no-refine`. The action resolves `--repo`, computes `noRefine = opts.refine === false` (the comment reminds readers that Commander maps `--no-refine` to `refine === false`, never to `noRefine`), and calls `runInit` with the optional flags. Results are forwarded to `emit` along with `formatHuman(result)`. When not in `--json` mode and the batch produced a `batchExitCode`, that code is propagated to `process.exitCode`; `--json` preserves exit 0 per the batch CLI convention. The error branch sets `process.exitCode = 1` and explains in a comment why `process.exit` is avoided (libuv `STATUS_STACK_BUFFER_OVERRUN` on Windows with open async handles).

```ts
function formatHuman(result: { plan?: InitPlanReport; filesWritten: string[]; ... }): string {
```

When `result.plan` is present (i.e., `--plan` was used), the formatter prints module counts, file/symbol/edge totals, and an ordered prioritized list. Otherwise it prints `livewiki init: OK`, the list of written files, and — when present — `flows/auxiliary/topics hub: preserved` lines for any hub skipped because of a human/mixed/unparseable owner (R10.1 C). Pre-LLM `skippedFlowCandidates` items are also listed individually (R10.1 K). If a batch run was triggered it prints `batch run #N: <status>`, tasks done/failed, and the propagated exit code.

## `pointer` command (Inviolable rule #2)
<!-- lw:anchors packages/cli/src/commands/pointer.ts#registerPointer packages/cli/src/commands/pointer.ts#promptYesNo packages/cli/src/commands/pointer.ts#formatPointerResult packages/cli/src/commands/pointer.ts#formatStatusHuman packages/cli/src/commands/pointer.ts#_internal -->

```ts
export function registerPointer(program: Command): void {
```

Binds `livewiki pointer` with `--write-pointer`, `--remove`, `--file <name>`, `--yes`, and `--block <text>`. The action validates `--file` against `POINTER_FILES` and exits with code 1 on a mismatch. The flow has three modes:

- `--remove`: requires explicit confirmation; without `--write-pointer`/`--yes`, it asks interactively on a TTY, otherwise it fails closed (`requires --write-pointer (or --yes) in non-interactive mode`) per rule #2.
- `--write-pointer` (or `--yes`): performs the write unconditionally; on a TTY with no write flag and the block already present, the status is printed instead of re-writing.
- No flag, no TTY: fails closed with an explanatory stderr message that explicitly states livewiki never writes outside `livewiki/` except into AGENTS.md/CLAUDE.md with conscious opt-in.

```ts
async function promptYesNo(question: string): Promise<boolean> {
```

Writes `question` to stdout, listens on `process.stdin` for a single line or EOF, and resolves `true` only when the trimmed lowercase input equals `y` or `yes`. Non-interactive EOF still resolves to `false` by default.

```ts
function formatPointerResult(
  result: { file: PointerFile; action: string; bytesWritten: number },
  verb: "wrote" | "removed",
): string {
```

When `verb === "wrote"` it picks between `wrote` (action `inserted`), `updated` (action `replaced`), and `unchanged`; otherwise it always prints `removed`. A `(+N bytes)` or `(-N bytes)` line follows when `bytesWritten !== 0`.

```ts
function formatStatusHuman(status: { present: boolean; file: PointerFile | null; inner?: string }): string {
```

Returns `livewiki pointer: not present ...` when the block is absent; otherwise prints `present in <file>` followed by the inner block fenced with `---`.

```ts
export const _internal = { nodeFs };
```

A test-only re-export of `node:fs/promises` so test harnesses can substitute a virtual filesystem without going through `livewiki` itself. Not intended for userspace.

## `status` command
<!-- lw:anchors packages/cli/src/commands/status.ts#registerStatus -->

```ts
export function registerStatus(program: Command): void {
```

Binds `livewiki status` with `--top <n>`. The action reads `--json`/`--repo` from `optsWithGlobals()`, parses `--top` (default 10), calls `runStatus(repoRoot, { topN })`, and either writes `{ ok: true, ...report }` JSON or `formatStatusHuman(report)` followed by a newline. Errors are caught and converted to `process.exitCode = 1` without calling `process.exit`.

## `update` command (incremental mode)
<!-- lw:anchors packages/cli/src/commands/update.ts#registerUpdate packages/cli/src/commands/update.ts#formatHuman -->

```ts
export function registerUpdate(program: Command): void {
```

Binds `livewiki update` with `--llm`, `--record-write <tokens>`, and `--snippet-window <lines>`. The action has three branches:

- `--record-write <tokens>`: parses the integer (rejecting non-finite or negative values with a stderr message and `process.exitCode = 1`), dynamically imports `recordDocWrittenBack` from `@livewiki/core/update`, estimates bytes at 4 chars/token, and emits a JSON record of `{ ok: true, recorded: { tokens, bytes } }`.
- `--llm`: writes an explanatory stderr message (`delegates to the batch orchestrator ...`) and sets `process.exitCode = 1` — the source explicitly does not delegate from this command.
- Default: calls `loadWorkPackage(repoRoot, { snippetWindow })`, computes an `economy` summary against an estimated ~12,500-token full repo re-read, and emits the package through `formatHuman`. Errors are caught and routed to `process.exitCode = 1`.

```ts
function formatHuman(pkg: Awaited<ReturnType<typeof loadWorkPackage>>): string {
```

Prints a `livewiki update — work package:` header; if `pkg.manifest` is missing it prints `(manifest missing — run 'livewiki init' first)`. Otherwise it prints `lastDocumentedCommit`, a `pendingBatch: run #N (done/total)` line when present, the first five debt entries as `[event] symbol_key (assignee=X, wiki=...)`, then a `+N more` line when debt exceeds five. Snippet count, valid-anchor count, and estimated tokens/bytes are listed, and a closing thesis line states the focused-package economy versus a full repo re-read.

## `verify` command (CI-friendly)
<!-- lw:anchors packages/cli/src/commands/verify.ts#registerVerify -->

```ts
export function registerVerify(program: Command): void {
```

Binds `livewiki verify` with no local flags. The action reads `--json`/`--repo` from `optsWithGlobals()`, calls `runVerify(repoRoot)`, and either writes the raw `VerifyResult` as JSON or `formatVerifyHuman(result)`. When `result.ok` is false the handler sets `process.exitCode = 1` so CI fails the build on broken anchors, altered manual blocks, or invalid internal links. A `try/catch` wraps the call to write a stderr error and set `process.exitCode = 1`; the comment notes that an abrupt exit after writing stderr can crash libuv on Windows while I/O is pending.

## Stub helpers and phase-stubs
<!-- lw:anchors packages/cli/src/commands/stub.ts#makeStubAction packages/cli/src/commands/serve.ts#registerServe packages/cli/src/commands/view.ts#registerView -->

```ts
export function makeStubAction(info: StubInfo) {
```

Returns an async action that reads `--json`/`--repo` from `optsWithGlobals()` and emits a `{ ok: false, stub, phase, repoRoot, message, planned }` JSON payload (or a one-line human stub message). The helper exists so not-yet-implemented commands can advertise their SPEC phase and planned behavior without diverging from the production action signature `(options, command)`.

```ts
export function registerServe(program: Command): void {
```

Binds `livewiki serve` and delegates to `makeStubAction({ name: "serve", phase: 4, planned: "MCP server stdio with 6 tools (livewiki_quickstart/read/search/debt/write_doc/resolve_debt)" })`. As supplied, this command is a Phase 4 stub.

```ts
export function registerView(program: Command): void {
```

Binds `livewiki view` with `--template <name>` (default `agent`) and `--out <dir>` (default `.livewiki/site/`). The action delegates to `makeStubAction({ name: "view", phase: 7, planned: "static site with client-side search + Mermaid + templates as data" })`. As supplied, this command is a Phase 7 stub; the supplied excerpt does not establish behavior beyond the stub emission.

<!-- livewiki:navigate:start -->
## Navigate

- [Quickstart](quickstart.md)
- [Tasks](tasks.md)
- [Architecture](architecture/overview.md)
- Flow: [cli-src → core-src-04 — export marker contract for stage-5 flows](flows/cli-src-to-core-src-04.md)
- [Batch orchestration, config, index schema, and deterministic diagrams](core-src-03.md) — dependency
- [Core source — prompts, safe I/O, status, symbols, topics](core-src-08.md) — dependency
- [Export, frontmatter, flows, and hashing primitives](core-src-04.md) — dependency
<!-- livewiki:navigate:end -->
