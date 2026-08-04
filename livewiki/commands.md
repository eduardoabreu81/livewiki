---
title: CLI command registry for the livewiki workspace
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
  - packages/cli/src/commands/export.ts#emitReadme
  - packages/cli/src/commands/export.ts#exportErrorToResult
  - packages/cli/src/commands/export.ts#registerExport
  - packages/cli/src/commands/export.ts#runReadmeExport
  - packages/cli/src/commands/index-cmd.ts#collectIgnore
  - packages/cli/src/commands/index-cmd.ts#emit
  - packages/cli/src/commands/index-cmd.ts#formatLedgerHuman
  - packages/cli/src/commands/index-cmd.ts#registerIndex
  - packages/cli/src/commands/init.ts#formatHuman
  - packages/cli/src/commands/init.ts#registerInit
  - packages/cli/src/commands/install.ts#formatDetectionHuman
  - packages/cli/src/commands/install.ts#formatPlanHuman
  - packages/cli/src/commands/install.ts#formatResultJson
  - packages/cli/src/commands/install.ts#formatResultsHuman
  - packages/cli/src/commands/install.ts#promptYesNo
  - packages/cli/src/commands/install.ts#readSources
  - packages/cli/src/commands/install.ts#registerInstall
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
  - packages/cli/src/commands/view.ts#openBrowser
  - packages/cli/src/commands/view.ts#registerView
---

# CLI command registry

This page documents the livewiki CLI command handlers that wire Commander subcommands to core operations and output formatting.

## When to use this page

- **Add** a new `livewiki <cmd>` subcommand by following the Commander-12 registration pattern used here.
- **Debug** a command's exit code, JSON contract, or interactive prompt by consulting the relevant handler's error branches.
- **Refactor** shared formatters (`formatHuman`, `emit`) without breaking per-command output shapes.
- **Map** each CLI subcommand to its core package (indexer, batch, export, install, pointer, verify, view).

## How it fits

The `commands/` directory under `packages/cli/src` is the registry layer between Commander's `Command` tree and the core packages under `@livewiki/core/*`. Each file owns one user-facing subcommand (`init`, `index`, `status`, `batch`, `export`, `install`, `pointer`, `update`, `verify`, `view`, `serve`); `stub.ts` provides the shared `makeStubAction` helper used until a command's SPEC phase is implemented. Handlers normalize global flags (`--json`, `--repo`), resolve the repo root, call core, and emit either JSON or human output through `../output.js`. Most handlers catch thrown errors and convert them into a stable JSON envelope with `process.exitCode` (never `process.exit`), letting the event loop drain before exit.

## Diagram

```mermaid
%% livewiki/diagrams/commands.mmd
```

## Batch subcommand
<!-- lw:anchors packages/cli/src/commands/batch.ts#USAGE_INCOMPLETE_NOTE packages/cli/src/commands/batch.ts#appendStage4Diagnostics packages/cli/src/commands/batch.ts#formatDiagnosticLine packages/cli/src/commands/batch.ts#formatListHuman packages/cli/src/commands/batch.ts#formatResultHuman packages/cli/src/commands/batch.ts#formatStatusHuman packages/cli/src/commands/batch.ts#registerBatch packages/cli/src/commands/batch.ts#setExitCode -->

The `batch` subcommand drives long-running, multi-stage documentation generation runs and exposes the result, status, resume, and list views used by CI and operators. It is the only CLI handler that aggregates token totals, USD estimates, circuit-breaker state, and per-task diagnostic histories across the four batch stages; every helper below exists to make those states observable without leaking internals to JSON consumers.

### registerBatch

```ts
export function registerBatch(program: Command): void {
```

`registerBatch` attaches the `batch` command and its `status` / `resume` / `list` / `--only` sub-flows to the Commander program. The handler reads global flags via `optsWithGlobals`, resolves the absolute repo root from `--repo`, parses `--concurrency` as a number (validated 1..16 by core), and routes to `buildStatusReport`, `resumeBatch`, `runOnly`, or `listRuns` depending on positional args. The branch order is deliberate: when both positional args and `--only` are absent, it falls back to status of the last run. Exit codes follow the 0=success / 1=completed_with_failures / 2=aborted mapping propagated through `setExitCode`.

### USAGE_INCOMPLETE_NOTE

```ts
export const USAGE_INCOMPLETE_NOTE =
```

A shared constant used by `formatStatusHuman` and `formatResultHuman` to surface incomplete-usage instructions in human output. It is reused across both formats so the wording stays consistent regardless of which batch view is rendered.

### formatDiagnosticLine

```ts
function formatDiagnosticLine(d: {
```

`formatDiagnosticLine` renders one compact ordered line per diagnostic entry. It mirrors the `repair_exhausted` line shape from `core/batch.ts` so the human output matches what is persisted in the checkpoint error message. `stopReason` falls back to `"-"` when the LLM did not supply one (for example, `llm_error` outcomes). Codes are deduplicated while preserving first-seen order so the user can match against the validator enumeration.

### appendStage4Diagnostics

```ts
function appendStage4Diagnostics(
```

`appendStage4Diagnostics` prints the compact per-attempt sequence for failed stage-4 tasks, derived from `diagnosticHistory`. The function falls back silently when the checkpoint pre-dates diagnostics (CONTRACT I5) or when the task never reached the LLM (for example, `refused_human_page`).

### formatListHuman

```ts
function formatListHuman(runs: Awaited<ReturnType<typeof listRuns>>): string {
```

`formatListHuman` formats the result of `listRuns` for human consumption under the `batch list` subcommand. It pairs with `emit(json, …, formatListHuman(runs))` and never has to translate an error since `listRuns` does not surface one to the caller.

### formatStatusHuman

```ts
export function formatStatusHuman(report: Awaited<ReturnType<typeof buildStatusReport>>): string {
```

`formatStatusHuman` renders the batch status report. It reuses `USAGE_INCOMPLETE_NOTE` so the user sees the same incomplete-usage hint as in the result view.

### formatResultHuman

```ts
export function formatResultHuman(result: Awaited<ReturnType<typeof runBatch>>): string {
```

`formatResultHuman` renders the output of `runBatch` / `resumeBatch` / `runOnly` for human consumption. It also pulls in `appendStage4Diagnostics` to expand failed stage-4 attempts inline and shares `USAGE_INCOMPLETE_NOTE` with `formatStatusHuman`.

### setExitCode

```ts
function setExitCode(repoRoot: string, status: string, json: boolean): void {
```

`setExitCode` translates the string `status` returned by core into the documented exit code (0/1/2) and assigns it to `process.exitCode` so Node can drain pending I/O before exit. In `--json` mode it preserves exit 0 to follow the structured-output convention used elsewhere.

## Export subcommand
<!-- lw:anchors packages/cli/src/commands/export.ts#emit packages/cli/src/commands/export.ts#emitReadme packages/cli/src/commands/export.ts#exportErrorToResult packages/cli/src/commands/export.ts#registerExport packages/cli/src/commands/export.ts#runReadmeExport -->

The `export` subcommand fans a generated wiki out to a chosen target — flattened copy, GitHub/GitLab wiki mirror, or `README.md` injection — while keeping a single stable JSON envelope across all targets. Every error path funnels through `exportErrorToResult` so consumers can branch on `result.ok` without parsing free-form stderr.

### registerExport

```ts
export function registerExport(program: Command): void {
```

`registerExport` attaches `livewiki export <target>` and dispatches the `readme` target through `runReadmeExport` before calling `validateTarget`. For other targets (`generic`, `github-wiki`, `gitlab-wiki`) it wraps `exportWiki` in a try/catch and converts any thrown `ExportError` (or unexpected error) into a structured `ExportResult` so the JSON contract is always honored. The `--push` flag is rejected with exit 1 before any write (reserved for Lot 6B). Exit codes are 0 on success and 1 on invalid target, preflight failure, write failure, or `--push` — JSON uses the same mapping.

### exportErrorToResult

```ts
function exportErrorToResult(
```

`exportErrorToResult` converts an `ExportError` (or any other unexpected error) into a structured `ExportResult` with `ok: false` and a structured issue list. Detail extraction uses `err instanceof Error ? err.message : String(err)` so a thrown `null` or primitive does not crash the catch handler that would otherwise touch `.message` directly.

### emit

```ts
function emit(json: boolean, result: ExportResult): void {
```

`emit` writes the export result to stdout as either JSON or human output (delegated to `../output.js`) and sets `process.exitCode`. It is invoked both on the success path returned by `exportWiki` and on the failure path produced by `exportErrorToResult`.

### runReadmeExport

```ts
async function runReadmeExport(
```

`runReadmeExport` orchestrates the `readme` target: it delegates to core's `exportReadme`, applies `--yes` semantics, and routes any `ReadmeExportError` through a try/catch so the structured payload still reaches the caller. The repo-root file path is fixed; the marker-block contract governs overwrites.

### emitReadme

```ts
function emitReadme(json: boolean, result: ReadmeExportResult): void {
```

`emitReadme` writes the readme-export payload to stdout as either JSON or human text and assigns the appropriate exit code via `process.exitCode`. It pairs with `runReadmeExport` to keep the `readme` target on the same envelope shape as the flatten/copy targets.

## Index subcommand
<!-- lw:anchors packages/cli/src/commands/index-cmd.ts#collectIgnore packages/cli/src/commands/index-cmd.ts#emit packages/cli/src/commands/index-cmd.ts#formatLedgerHuman packages/cli/src/commands/index-cmd.ts#registerIndex -->

The `index` subcommand walks the source tree, builds the anchor ledger, and chains the documentation-debt report when the user has not opted out via `--no-ledger`. It is the cheapest way to populate `livewiki/index.json` and to surface undocumented-symbol counts before deciding whether to launch a full `batch` run.

### registerIndex

```ts
export function registerIndex(program: Command): void {
```

`registerIndex` attaches the `index` command and chains the anchor-ledger after the indexer when `--no-ledger` is not passed. It merges `.livewiki/config.json` `ignores` with the CLI `--ignore` flag so every entry point shares the same semantics; `loadConfig` is intentionally fail-closed on malformed JSON. A `--quiet` flag suppresses human output without producing JSON (used by hooks). On caught errors the handler writes to stderr and sets `process.exitCode = 1` so Node can drain the event loop before exit.

### collectIgnore

```ts
function collectIgnore(value: string, previous: string[]): string[] {
```

`collectIgnore` is the Commander variadic collector for `--ignore <pattern>`; each invocation appends the supplied pattern to `previous`. It is the additive counterpart to the configured `ignores` list.

### emit

```ts
function emit(
```

`emit` writes either JSON or human output for indexer + ledger results. In `--quiet` mode without `--json` it returns immediately (the hook only wants debt detection, surfaced separately via `status --json`). JSON mode emits a combined envelope `{ ok: true, index, ledger }`.

### formatLedgerHuman

```ts
function formatLedgerHuman(r: LedgerResult): string {
```

`formatLedgerHuman` renders the ledger report after the indexer line. It includes pages processed/skipped, anchors upserted, debt by event, undocumented-symbol counts, and an optional list of moved pairs.

## Init subcommand
<!-- lw:anchors packages/cli/src/commands/init.ts#formatHuman packages/cli/src/commands/init.ts#registerInit -->

The `init` subcommand bootstraps a repo with `livewiki/` skeleton files and optionally drives a first batch run end-to-end. It is the canonical entry point for greenfield setups and the only handler that combines a heuristic plan, a full LLM pipeline, and an explicit no-write dry run behind a single command.

### registerInit

```ts
export function registerInit(program: Command): void {
```

`registerInit` attaches `livewiki init` with `--batch` (full LLM pipeline), `--plan` (heuristic plan, no LLM, no writes), `--no-refine` (Commander maps this to `refine === false`), and `--concurrency` (validated 1..16 by core). The handler resolves the repo root, calls `runInit`, emits JSON or human output, and propagates `result.batchExitCode` to `process.exitCode` outside `--json` mode (always 0 in JSON mode, following the batch CLI convention). On caught errors it sets `process.exitCode = 1` rather than calling `process.exit(1)` (FIX L rev2: avoid libuv `STATUS_STACK_BUFFER_OVERRUN` when Node has pending async handles).

### formatHuman

```ts
function formatHuman(result: { plan?: InitPlanReport; filesWritten: string[]; batchSummary?: { runId: number; status: string; tasksDone: number; tasksFailed: number }; batchExitCode?: 0 | 1 | 2; skipp
```

`formatHuman` renders the init result for human output. It includes the optional plan report, the list of files written, the batch summary (when `--batch` is used), and the various `skipped…` slots describing flows/auxiliary/topics hubs and candidate flow/topic plans that init deliberately skipped.

## Install subcommand
<!-- lw:anchors packages/cli/src/commands/install.ts#formatDetectionHuman packages/cli/src/commands/install.ts#formatPlanHuman packages/cli/src/commands/install.ts#formatResultJson packages/cli/src/commands/install.ts#formatResultsHuman packages/cli/src/commands/install.ts#promptYesNo packages/cli/src/commands/install.ts#readSources packages/cli/src/commands/install.ts#registerInstall -->

The `install` subcommand wires livewiki hooks, the shared skill, and (optionally) the MCP template into one or more known coding-agent installations. It is fail-closed on unknown agents, supports a fully non-interactive path via `--yes`, and offers a print-only dry run via `--print` so users can audit writes before committing.

### registerInstall

```ts
export function registerInstall(program: Command): void {
```

`registerInstall` attaches `livewiki install` with `--agents <csv>`, `--yes`, `--print`, and `--write-pointer`. It validates `--agents` against `AGENT_REGISTRY` and exits 2 on any unknown value (exit 2 is reserved for invalid `--agents`). The handler honors `LIVEWIKI_HOME` to override `os.homedir()` so tests/smoke runs can point at a throwaway HOME. Without `--yes` and outside TTY it fails closed; `--print` is a full dry-run with zero writes. Exit codes are 0 (including "nothing to do"), 1 (write refusal/error), 2 (invalid `--agents`).

### readSources

```ts
async function readSources(): Promise<InstallSources> {
```

`readSources` loads the install sources (MCP template, hook templates, shared skill) bundled with the CLI package. The sources are then passed to `planInstall` so the action handler stays a thin coordinator.

### promptYesNo

```ts
async function promptYesNo(question: string): Promise<boolean> {
```

`promptYesNo` runs the interactive y/N prompt for confirmation. It is the shared counterpart to the `--yes` script-friendly flag.

### formatDetectionHuman

```ts
function formatDetectionHuman(
```

`formatDetectionHuman` renders the detection table (one row per known agent, indicating whether it was detected and where). It is emitted both on the dry-run path and before the confirmation prompt on the apply path.

### formatPlanHuman

```ts
function formatPlanHuman(plan: readonly InstallAction[], toInstall: readonly AgentId[]): string {
```

`formatPlanHuman` renders the planned `InstallAction` list alongside the targeted `AgentId` set. It is paired with `formatDetectionHuman` so the user sees both the detection results and the exact writes before confirming.

### formatResultJson

```ts
function formatResultJson(r: { action: InstallAction; applied: boolean; detail?: string }) {
```

`formatResultJson` shapes the per-action JSON entry (`action`, `applied`, optional `detail`). It is consumed by the `--json` emit path inside `registerInstall`.

### formatResultsHuman

```ts
function formatResultsHuman(
```

`formatResultsHuman` renders the human summary after `applyInstall` returns, showing each action's outcome. It pairs with `formatResultJson` to keep the JSON and human output describing the same per-action truth.

## Pointer subcommand
<!-- lw:anchors packages/cli/src/commands/pointer.ts#_internal packages/cli/src/commands/pointer.ts#formatPointerResult packages/cli/src/commands/pointer.ts#formatStatusHuman packages/cli/src/commands/pointer.ts#promptYesNo packages/cli/src/commands/pointer.ts#registerPointer -->

The `pointer` subcommand manages the agent-facing block (`<!-- livewiki:pointer -->`) that downstream agents consume. Per Inviolable rule #2, every write — insert or remove — requires an explicit opt-in (`--write-pointer` or `--yes`) or an interactive confirmation on a TTY; the read-only status path is the only mode that touches zero bytes.

### registerPointer

```ts
export function registerPointer(program: Command): void {
```

`registerPointer` attaches `livewiki pointer` and enforces Inviolable rule #2: pointer writes are never automatic and require either `--write-pointer`/`--yes` or an interactive confirmation on a TTY. The `--remove` branch is treated as destructive and re-prompts even when an explicit flag is present, while still requiring `--write-pointer` or `--yes` in non-TTY mode. `--file` is validated against `POINTER_FILES` (AGENTS.md or CLAUDE.md) and exits 1 on an unknown value. No positional args means status-only (read-only).

### promptYesNo

```ts
async function promptYesNo(question: string): Promise<boolean> {
```

`promptYesNo` is the pointer's interactive confirmation helper, used by the insert and remove paths. It is the local counterpart to the `--yes`/`--write-pointer` opt-in flags.

### formatPointerResult

```ts
function formatPointerResult(
```

`formatPointerResult` renders the result of `insertPointer` / `removePointer` for human output. It accepts an `operation` label so the same formatter covers both the inserted and removed flows.

### formatStatusHuman

```ts
function formatStatusHuman(status: { present: boolean; file: PointerFile | null; inner?: string }): string {
```

`formatStatusHuman` renders the read-only status view (no flags) for the pointer, showing whether the block is present, which file holds it, and (when relevant) the inner content. It is paired with `formatPointerResult` for symmetry.

### _internal

```ts
export const _internal = { nodeFs };
```

`_internal` is the cross-package seam for tests; it re-exports `nodeFs` so suite code can substitute a stub filesystem when exercising the pointer handlers without touching the production FS.

## Serve subcommand
<!-- lw:anchors packages/cli/src/commands/serve.ts#registerServe -->

The `serve` subcommand is the planned MCP stdio entry point. Until Phase 4 ships, it returns a structured stub payload via `makeStubAction` so downstream consumers can detect the unimplemented state without parsing stderr.

### registerServe

```ts
export function registerServe(program: Command): void {
```

`registerServe` attaches `livewiki serve`, which today is a Phase 4 stub handled by `makeStubAction({ name: "serve", phase: 4, planned: "MCP server stdio with 6 tools (livewiki_quickstart/read/search/debt/write_doc/resolve_debt)" })`. When the MCP server implementation lands, the stub is replaced with a real action that keeps the same `(cmd: Command) => Promise<void>` shape.

## Status subcommand
<!-- lw:anchors packages/cli/src/commands/status.ts#registerStatus -->

The `status` subcommand is the cheap, read-only debt snapshot that hooks and CI call between indexer runs. It powers the `--diff` pre-commit preview and the top-N debt list, both of which are computed in core so the handler stays a thin formatter.

### registerStatus

```ts
export function registerStatus(program: Command): void {
```

`registerStatus` attaches `livewiki status` with `--top <n>` (default 10) and `--diff` (read-only pre-commit preview of anchors the uncommitted working-tree diff would invalidate). The `--diff` branch uses `previewWorkingTreeDebt` and degrades to exit 1 + a structured error when the repo is not a git repo (never a stack trace). On caught errors the handler writes to stderr and sets `process.exitCode = 1` so Node can drain pending I/O before exit.

## Stub helper
<!-- lw:anchors packages/cli/src/commands/stub.ts#makeStubAction -->

`stub.ts` provides the single shared action factory used by every Phase-N placeholder. Centralizing the stub shape keeps the JSON contract stable across commands and makes the "this command is not yet implemented" state machine-readable.

### makeStubAction

```ts
export function makeStubAction(info: StubInfo) {
```

`makeStubAction` builds a Commander action handler for unimplemented subcommands. Each stub honors global `--json` and `--repo`, emits a structured `{ ok: false, stub, phase, repoRoot, message, planned }` payload, and exits with code 0 (the command was executed — only the SPEC phase is missing). Once a phase ships, the caller replaces `makeStubAction(...)` with the real implementation while keeping the same `(cmd: Command) => Promise<void>` signature.

## Update subcommand
<!-- lw:anchors packages/cli/src/commands/update.ts#formatHuman packages/cli/src/commands/update.ts#registerUpdate -->

The `update` subcommand is the Phase 5 incremental entry point: it records write-back metrics, exposes a work package for an in-session agent to pay down debt, and explicitly rejects the `--llm` shortcut in favor of `batch resume` / `init --batch`.

### registerUpdate

```ts
export function registerUpdate(program: Command): void {
```

`registerUpdate` attaches `livewiki update`, the Phase 5 incremental entry point. It handles three modes:

- `--record-write <tokens>` records a write-back metric (validates a non-negative integer) and exits; bytes are estimated at 4 chars/token.
- `--llm` is rejected with a stderr hint pointing at `batch resume` / `init --batch` (exit 1) since incremental → full-mode delegation is not implemented in this handler.
- The default mode loads a work package via `loadWorkPackage` with `--snippet-window` (default 20) and emits it for the in-session agent to pay the debt.

Exit codes follow the init/batch pattern: 0 on success, 1 on usage or state error (repo not initialized).

### formatHuman

```ts
export function formatHuman(pkg: Awaited<ReturnType<typeof loadWorkPackage>>): string {
```

`formatHuman` renders the work package for human output. It surfaces the debt list, snippets, valid anchors, estimated tokens, and the economy-vs-full-read summary (`~50KB of medium source ≈ 12500 tokens`) that frames the incremental-mode thesis.

## Verify subcommand
<!-- lw:anchors packages/cli/src/commands/verify.ts#registerVerify -->

The `verify` subcommand is the integrity gate that compares the rendered wiki against the live anchor ledger and source tree. It is safe to run at any time and is the CI signal of choice for detecting drift between code and documentation.

### registerVerify

```ts
export function registerVerify(program: Command): void {
```

`registerVerify` attaches `livewiki verify`, which validates the wiki against the index: broken anchors, altered manual blocks, and internal links. The handler wraps `runVerify` in a try/catch and sets `process.exitCode = 1` rather than calling `process.exit(1)` (FIX L rev2: drain pending I/O). On success it emits JSON or human output; on `result.ok === false` it sets `process.exitCode = 1` so CI can detect failures.

## View subcommand
<!-- lw:anchors packages/cli/src/commands/view.ts#openBrowser packages/cli/src/commands/view.ts#registerView -->

The `view` subcommand builds a self-contained static site from the canonical `livewiki/` wiki, optionally opens it in the platform browser, and pins badge freshness to a configurable window. It is the human-facing counterpart to `verify`: where `verify` is the integrity gate, `view` is the renderable artifact.

### registerView

```ts
export function registerView(program: Command): void {
```

`registerView` attaches `livewiki view`, which builds a self-contained static site from the canonical `livewiki/` wiki. Options: `--template <agent|docs>`, `--out <dir>` (default `.livewiki/site/`), `--badge-days <n>` (default 7; 0 disables), `--ref <tag|sha>` (read-only build from a git ref without touching the working tree), and `--no-open`. `--badge-days` is validated as a non-negative integer; an invalid value emits `{ ok: false, error: { code: "invalid_badge_days", detail } }` and exits 1. On caught errors the handler distinguishes `ViewError` (carrying `err.code`) from generic throws and emits either `{ code, detail }` or `view_failed`. Exit codes are 0 on success, 1 on failure. The path to `index.html` is always printed.

### openBrowser

```ts
function openBrowser(target: string): boolean {
```

`openBrowser` spawns the platform opener (`start` on Windows, `open` on macOS, `xdg-open` elsewhere) with `shell: false`, `detached: true`, and unref'd stdio so the CLI can exit without waiting for the browser. It is best-effort: a missing opener never fails the command because the path has already been printed, and the boolean return surfaces to `registerView` for the `opened` field of the JSON output.

<!-- livewiki:navigate:start -->
## Navigate

- Flow: [CLI command surface to core pipeline wiring](flows/cli-src-to-core-src-02.md)
- [core indexing, imports, flows, and frontmatter](core-src-04.md) — dependency
- [Safe I/O, section guarding, status reporting, and symbol extraction](core-src-09.md) — dependency
- [Stage 4 artifact normalization, validation, and auxiliary page assembly](core-src-01.md) — dependency

> Coverage note: this module's source (12 files, ~75k chars) exceeded the prompt budget and was excerpted; this page documents the closed-list symbols.
<!-- livewiki:navigate:end -->
