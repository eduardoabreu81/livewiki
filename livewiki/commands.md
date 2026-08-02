---
title: CLI command handlers
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

# CLI command handlers

This page documents the per-command registration and formatting helpers that the `livewiki` CLI wires onto a Commander program.

## When to use this page

- **Reference** a specific command's flags, exit-code semantics, or human/JSON output shape when implementing or reviewing the CLI surface.
- **Trace** how a command delegates to its `@livewiki/core` counterpart (e.g. `init` → `runInit`, `verify` → `runVerify`) and where the action handler swallows exceptions to honor the JSON contract.
- **Extend** the CLI by adding a new command module under `packages/cli/src/commands/` that exports a `registerXxx(program: Command): void` matching the pattern used here.
- **Diagnose** stub vs. real behaviour: `serve` is currently a stub created via `makeStubAction`, while `init`, `index`, `status`, `verify`, `view`, `batch`, `export`, `update`, `pointer`, and `install` are implemented.

## How it fits

The `commands/` directory lives inside `packages/cli/src/` and sits between the top-level `cli.ts` (which assembles the Commander program and the global `--json` / `--repo` flags) and the `@livewiki/core` packages that hold the real implementation. Each file in this directory owns exactly one top-level user-facing command and exposes a `registerX(program: Command): void` that `cli.ts` calls to attach the command, its description, its flags, and its action handler. Output shaping — JSON vs. human — flows through `../output.js` (`emit` / `emitJson` / `emitHuman`) and `path.resolve(process.cwd(), resolveRepoRoot(opts.repo ?? "."))` is the recurring pattern for locating the repository root. Several commands also share a small stub helper (`stub.ts`) used by the still-unimplemented `serve`.

## `batch` — run/resume/inspect the full-documentation pipeline

<!-- lw:anchors packages/cli/src/commands/batch.ts#registerBatch packages/cli/src/commands/batch.ts#USAGE_INCOMPLETE_NOTE packages/cli/src/commands/batch.ts#formatStatusHuman packages/cli/src/commands/batch.ts#formatResultHuman packages/cli/src/commands/batch.ts#formatListHuman packages/cli/src/commands/batch.ts#formatDiagnosticLine packages/cli/src/commands/batch.ts#appendStage4Diagnostics packages/cli/src/commands/batch.ts#setExitCode -->

The `batch` command owns Phase 3 orchestration: status, resume, list, and `--only` re-run of a single task. Its subcommands are dispatched by inspecting positional `args` inside the action handler — no second-level `program.command()` is used.

```ts
export function registerBatch(program: Command): void
```

`registerBatch` declares `--only <target>`, `--no-refine` (Commander maps it to `refine === false`, not `noRefine`), and `--concurrency <n>` (validated in core as an integer in `1..16`; the CLI only forwards it when defined). With no positional args it falls through to `buildStatusReport(absRoot)`; `status [<runId>]` calls `buildStatusReport(absRoot, runId)` and throws on a non-numeric `runId`; `list` calls `listRuns`; `resume <runId>` calls `resumeBatch`; `--only <target> <runId>` calls `runOnly`. Exit codes follow the batch convention `0 = completed`, `1 = completed_with_failures`, `2 = aborted`, applied by `setExitCode(absRoot, status, json)`.

```ts
function formatStatusHuman(report: Awaited<ReturnType<typeof buildStatusReport>>): string
function formatResultHuman(result: Awaited<ReturnType<typeof runBatch>>): string
function formatListHuman(runs: Awaited<ReturnType<typeof listRuns>>): string
function formatDiagnosticLine(d: { ... }): string
function appendStage4Diagnostics(...): void
function setExitCode(repoRoot: string, status: string, json: boolean): void
export const USAGE_INCOMPLETE_NOTE = ...
```

Both `formatStatusHuman` and `formatResultHuman` append `USAGE_INCOMPLETE_NOTE` when the run was left in an unfinished state so the user sees the missing-arg hint alongside the report. `formatDiagnosticLine` produces one compact ordered line per diagnostic entry (deduplicated by code, first-seen order preserved) and `appendStage4Diagnostics` decorates failed stage-4 tasks with the per-attempt sequence derived from `diagnosticHistory`; if the checkpoint pre-dates diagnostics (CONTRACT I5) or the task never reached the LLM, the helpers fall back silently rather than crashing. `setExitCode` maps the batch status string to the `0/1/2` exit code via `path.join(repoRoot, ...)` resolution.

## `export` — flatten the wiki or synthesize a README

<!-- lw:anchors packages/cli/src/commands/export.ts#registerExport packages/cli/src/commands/export.ts#exportErrorToResult packages/cli/src/commands/export.ts#emit packages/cli/src/commands/export.ts#runReadmeExport packages/cli/src/commands/export.ts#emitReadme -->

`export` covers Phase 6 Lot 6A: local deterministic flattening to `.livewiki/export/<target>/` for `generic`, `github-wiki`, and `gitlab-wiki`, plus the `readme` target which is dispatched separately and goes through `@livewiki/core/readme-export`.

```ts
export function registerExport(program: Command): void
```

`registerExport` declares `--force`, `--yes` (readme only), and `--push <remote>`. The action handler short-circuits on `target === "readme"` by calling `runReadmeExport(absRoot, json, opts.yes === true)`, before any `validateTarget` call, because the readme pipeline has different write semantics (repo-root file, marker-block contract, `--yes` opt-in). For the other targets, `validateTarget(target)` is invoked first; any throw — `ExportError` for an unknown target, or any other unexpected error during `exportWiki` — is funneled through `exportErrorToResult` so the JSON payload always has a stable `ok: false` shape with a structured `issues` list and the global fatal handler never receives a thrown `ExportError`.

```ts
function exportErrorToResult(repoRoot: string, target: ExportTarget, err: unknown): ExportResult
function emit(json: boolean, result: ExportResult): void
async function runReadmeExport(repoRoot: string, json: boolean, yes: boolean): Promise<void>
function emitReadme(json: boolean, result: ReadmeExportResult): void
```

`exportErrorToResult` derives `detail` via `err instanceof Error ? err.message : String(err)` so a thrown `null` or primitive does not crash the catch handler. `emit` sets `process.exitCode` (FIX L rev2: never `process.exit`). The exit-code mapping is `0` for success and `1` for any failure — invalid target, preflight failure, write failure, or `--push` (rejected in Lot 6A). JSON mode uses the same codes; there is no batch-style `0/1/2` ladder here.

## `index-cmd` — reindex the repo and sync the anchor ledger

<!-- lw:anchors packages/cli/src/commands/index-cmd.ts#registerIndex packages/cli/src/commands/index-cmd.ts#collectIgnore packages/cli/src/commands/index-cmd.ts#emit packages/cli/src/commands/index-cmd.ts#formatLedgerHuman -->

`livewiki index` is idempotent and incremental: it extracts symbols, updates hashes, and (Phase 2) chains the anchor-ledger step so changed/moved/deleted anchors are detected in the same pass.

```ts
export function registerIndex(program: Command): void
```

The action loads `.livewiki/config.json` via `loadConfig(repoRoot)` (which throws on malformed JSON — fail-closed by design), merges `resolveExtraIgnores(config)` with CLI-supplied `--ignore` patterns, and runs the indexer. `--no-ledger` maps Commander-style to `opts.ledger === false` and skips the ledger pass. `--quiet` suppresses human output without producing JSON (used by Phase 5 hooks); `--json` also suppresses human output but emits a structured payload. `loadConfig` failures fall through to the catch branch, which writes to stderr and sets `process.exitCode = 1` so Node can drain pending I/O before exiting.

```ts
function collectIgnore(value: string, previous: string[]): string[]
function emit(json: boolean, quiet: boolean, indexResult: IndexResult, ledgerResult: LedgerResult | null): void
function formatLedgerHuman(r: LedgerResult): string
```

`collectIgnore` is the Commander variadic aggregator for repeatable `--ignore`. `emit` returns early when `quiet && !json`, writes JSON when `json`, and otherwise prints the indexer human output followed by `formatLedgerHuman(ledgerResult)`. The ledger human formatter reports `pages processed/skipped`, `anchors upsert`, the `+changed +moved +deleted` debt deltas, and any moved pairs as `from → to` lines.

## `init` — bootstrap the wiki and optionally run the LLM pipeline

<!-- lw:anchors packages/cli/src/commands/init.ts#registerInit packages/cli/src/commands/init.ts#formatHuman -->

`livewiki init` creates `livewiki/` and `.livewiki/`, indexes, and generates the deterministic layout (quickstart + diagrams + manifest) without any LLM call. Adding `--batch` triggers the full Phase 3 LLM pipeline; `--plan` prints the heuristic module plan without writing; `--no-refine` skips stage-2 LLM refinement (Commander maps to `opts.refine === false`).

```ts
export function registerInit(program: Command): void
```

The action delegates to `runInit(...)` from `@livewiki/core/init`, then emits a structured payload via `emit`. The batch exit code is propagated only in human mode (`!json && result.batchExitCode !== undefined`) so `--json` callers always see exit 0 (batch CLI convention). The catch branch writes to stderr and sets `process.exitCode = 1`; it deliberately uses `process.exitCode` rather than `process.exit(1)` (FIX L rev2) because abrupt exit can trigger a libuv `STATUS_STACK_BUFFER_OVERRUN` on Windows when async handles (in-flight fetch, SQLite WAL, watcher) are still open.

```ts
function formatHuman(result: { plan?: InitPlanReport; filesWritten: string[]; ... }): string
```

`formatHuman` is the only formatting helper exported for `init` and renders the plan summary, files written, batch summary (run id, status, tasks done/failed), batch exit code, and the `skippedFlowsHub` / `skippedAuxiliaryHub` / `skippedTopicsHub` / `skippedFlowCandidates` / `skippedTopicPlan` skip reasons when present.

## `install` — configure MCP entries and shared assets for coding agents

<!-- lw:anchors packages/cli/src/commands/install.ts#registerInstall packages/cli/src/commands/install.ts#readSources packages/cli/src/commands/install.ts#promptYesNo packages/cli/src/commands/install.ts#formatDetectionHuman packages/cli/src/commands/install.ts#formatPlanHuman packages/cli/src/commands/install.ts#formatResultsHuman packages/cli/src/commands/install.ts#formatResultJson -->

`livewiki install` detects which coding agents are present (`claude-code`, `codex`, `cursor`, `kimi`, `gemini`) and configures the MCP entry, hook templates, the shared skill, and the opt-in pointer. Safety defaults: every target is shown before being written; `--print` is a full dry-run with zero writes; without `--yes` a TTY confirmation is required and non-TTY fails closed; the pointer additionally needs `--write-pointer` or its own interactive confirmation.

```ts
export function registerInstall(program: Command): void
```

The action validates `--agents <csv>` first and exits with `process.exitCode = 2` (invalid `--agents`) before any detection, mapping empty or unrecognized ids against `AGENT_REGISTRY`. Home resolution honors `LIVEWIKI_HOME` env var over `os.homedir()` — a documented seam for tests and smoke runs. The action builds the plan via `planInstall({ repoRoot, home, agents: toInstall, sources, writePointer })`, prints it under `--print`, and otherwise prompts or applies depending on flags.

```ts
async function readSources(): Promise<InstallSources>
async function promptYesNo(question: string): Promise<boolean>
function formatDetectionHuman(detections: AgentDetection[], home: string): string
function formatPlanHuman(plan: readonly InstallAction[], toInstall: readonly AgentId[]): string
function formatResultsHuman(...): string
function formatResultJson(r: { action: InstallAction; applied: boolean; detail?: string }): string
```

`readSources` loads the templates and skill that ship inside the CLI package. `promptYesNo` performs the TTY y/N confirmation used by both `install` and `pointer`. The detection, plan, and result formatters produce the human-readable summary and the per-action JSON shape (action id, applied flag, optional detail) consumed by automation.

## `pointer` — manage the AGENTS.md / CLAUDE.md opt-in block

<!-- lw:anchors packages/cli/src/commands/pointer.ts#registerPointer packages/cli/src/commands/pointer.ts#promptYesNo packages/cli/src/commands/pointer.ts#formatPointerResult packages/cli/src/commands/pointer.ts#formatStatusHuman packages/cli/src/commands/pointer.ts#_internal -->

`livewiki pointer` implements Inviolable rule #2: writing to `AGENTS.md` / `CLAUDE.md` is **never automatic** — it requires `--write-pointer` (or its alias `--yes`) or an interactive TTY confirmation. No flag and no TTY fails closed with exit code 1.

```ts
export function registerPointer(program: Command): void
```

The action validates `--file <name>` against `POINTER_FILES` (`AGENTS.md`, `CLAUDE.md`) up front. Mode dispatch is based on flags: `--remove` removes the block (destructive — asks for confirmation when TTY is available, otherwise requires `--write-pointer` or `--yes`); `--write-pointer` or `--yes` triggers a write; no flag and a TTY triggers an interactive prompt; no flag and no TTY prints an instructional error.

```ts
async function promptYesNo(question: string): Promise<boolean>
function formatPointerResult(result: PointerResult, mode: "wrote" | "removed"): string
function formatStatusHuman(status: { present: boolean; file: PointerFile | null; inner?: string }): string
export const _internal = { nodeFs }
```

`formatPointerResult` formats the structured write/remove result with the chosen mode label. `formatStatusHuman` renders the read-only status block used when `pointer` is invoked without mutating flags. The `_internal` re-export surfaces `nodeFs` for tests that need to swap filesystem behaviour; it is the only non-function symbol exported from this module.

## `serve` — MCP server (Phase 4 stub)

<!-- lw:anchors packages/cli/src/commands/serve.ts#registerServe -->

`livewiki serve` is registered as a Phase 4 stub today. The full implementation will start the MCP server on stdio with six tools (`livewiki_quickstart`, `livewiki_read`, `livewiki_search`, `livewiki_debt`, `livewiki_write_doc`, `livewiki_resolve_debt`).

```ts
export function registerServe(program: Command): void
```

`registerServe` delegates to `makeStubAction({ name: "serve", phase: 4, planned: "..." })`. It accepts `--json` and `--repo` from the parent program via `optsWithGlobals()`; the stub action emits a structured `ok: false` payload with `stub`, `phase`, `repoRoot`, and the `planned` description, and exits 0 — the command was executed, it is just not implemented yet. When Phase 4 lands the caller replaces the stub with the real action, keeping the same `(options, command) => Promise<void>` shape.

## `status` — debt, undocumented symbols, and `--diff` preview

<!-- lw:anchors packages/cli/src/commands/status.ts#registerStatus -->

`livewiki status` reports the open debt, undocumented symbols, and pending batch from Phase 1/2, and supports `--diff` as a read-only preview of anchors the uncommitted working-tree diff would invalidate (backlog #5).

```ts
export function registerStatus(program: Command): void
```

The action uses `optsWithGlobals()` to read `--json` and `--repo`. `--top <n>` (default `10`) controls how many files appear in the top list and is parsed with `Number.parseInt`. When `--diff` is passed, `previewWorkingTreeDebt(repoRoot)` is called; if it returns `notGitRepo`, the action writes either the JSON `{ ok: false, error: "not_a_git_repo", diffPreview }` payload or the human `formatDiffPreviewHuman(preview)` to stderr/stderr-derived output and sets `process.exitCode = 1` (no stack trace). Otherwise it delegates to `runStatus(repoRoot, { topN })` from `@livewiki/core/status` and emits either JSON or the human formatter output. The catch branch writes to stderr and sets `process.exitCode = 1`, letting Node drain pending I/O.

## `stub` — helper for Phase-0 command placeholders

<!-- lw:anchors packages/cli/src/commands/stub.ts#makeStubAction -->

`stub.ts` is the shared helper for commands that are wired into the CLI but not yet implemented. It guarantees the stub honors `--json` / `--repo` (via `optsWithGlobals()`), emits structured output, and exits 0 — the command was executed, it is just a placeholder.

```ts
export function makeStubAction(info: StubInfo): (options: Record<string, unknown>, command: Command) => Promise<void>
```

`StubInfo` carries `{ name, phase, planned }`. The returned action reads options via `command.optsWithGlobals<StubOptions>()`, resolves the repo root via `resolveRepoRoot(opts.repo)`, and emits either the JSON `{ ok: false, stub, phase, repoRoot, message, planned }` or the human `livewiki <name>: stub (Fase <phase> ...)` line via `emit`. Only `serve` currently uses it; once each phase lands, the caller swaps the stub for the real action while preserving the `(options, command) => Promise<void>` signature.

## `update` — incremental debt work package

<!-- lw:anchors packages/cli/src/commands/update.ts#registerUpdate packages/cli/src/commands/update.ts#formatHuman -->

`livewiki update` is the heart of the Phase 5 incremental mode: with no flags it emits a work package (debt + snippets + validAnchors + estimated tokens) for the in-session agent to pay the debt; with `--llm` it delegates to the batch orchestrator (Phase 3, full mode); with `--record-write <tokens>` it accounts for docs written back so the economy ratio (`write` vs. `package`) can be tracked in `.livewiki/` and surfaced by `status --json`.

```ts
export function registerUpdate(program: Command): void
```

The action handles three paths in order: `--record-write` parses the token count with `Number.parseInt`, rejects non-negative-integer input via stderr + `process.exitCode = 1`, and (because `bytes` are not available at the CLI layer) estimates `bytes = tokens * 4` before calling `recordDocWrittenBack`; `--llm` writes an explanatory message to stderr and exits 1 (delegation is performed by `batch resume` / `init --batch`, not silently here); the default path parses `--snippet-window <lines>` (default `20`), calls `loadWorkPackage(repoRoot, ...)` only when `Number.isFinite(snippetWindow) && snippetWindow > 0`, and emits the package via `formatHuman`.

```ts
export function formatHuman(pkg: Awaited<ReturnType<typeof loadWorkPackage>>): string
```

The human formatter is the only formatter exported for `update`. Exit codes follow the `init`/`batch` convention: `0` on success (package emitted or write recorded), `1` on usage or state errors (e.g. repo not initialized).

## `verify` — validate wiki against the index

<!-- lw:anchors packages/cli/src/commands/verify.ts#registerVerify -->

`livewiki verify` checks anchors, altered manual blocks, and internal links against the canonical index. It is designed to be CI-friendly: non-zero exit on failure.

```ts
export function registerVerify(program: Command): void
```

The action delegates to `runVerify(repoRoot)` from `@livewiki/core/verify`. Any thrown error is caught, written to stderr, and `process.exitCode = 1` is set so Node drains pending stderr I/O before exiting (mirroring the `init`/`status` pattern). On the success path the result is emitted as either JSON or the `formatVerifyHuman(result)` human output, and `process.exitCode = 1` is set when `!result.ok` so CI sees the failure without inspecting JSON.

## `view` — build the self-contained static site

<!-- lw:anchors packages/cli/src/commands/view.ts#registerView packages/cli/src/commands/view.ts#openBrowser -->

`livewiki view` is the Phase 7 command: it builds a self-contained static site (HTML + CSS + JS) with client-side search and Mermaid diagrams from the canonical `livewiki/`, writing to `.livewiki/site/` by default or `--out <dir>` for publication elsewhere, and opens it in the system browser unless `--no-open` is passed. `--badge-days <n>` (default `7`, `0` disables) sets the git-history window for the new/updated freshness badges. The site path is always printed.

```ts
export function registerView(program: Command): void
function openBrowser(target: string): boolean
```

The action validates `--badge-days` first — it must be a non-negative integer; on failure the action writes either `emitJson({ ok: false, error: { code: "invalid_badge_days", detail } })` or `emitHuman("livewiki view: FAILED [invalid_badge_days] ...")` and sets `process.exitCode = 1` before doing any build. On success it calls `buildSite({ repoRoot, outDir?, template: "agent" | "docs", badgeDays })`, computes `indexHtml = path.join(result.outDir, "index.html")`, and (unless `--no-open` → `opts.open === false`) calls `openBrowser(indexHtml)`. The result is emitted via `emitJson` / `emitHuman`; exit codes are `0` on success and `1` on `ViewError` or any other failure (uses `process.exitCode`, never `process.exit`, per FIX L rev2).

`openBrowser` dispatches a detached, unref'd, `stdio: "ignore"`, `shell: false` child process — `cmd /c start "" <target>` on Windows, `open <target>` on macOS, `xdg-open <target>` elsewhere. The `child.on("error", () => {})` handler swallows spawn failures so a missing opener never fails the command (the path has already been printed); the function returns `true` even on failure to keep the human/JSON output symmetric with the success case.

<!-- livewiki:navigate:start -->
## Navigate

- Flow: [CLI to persistence flow — entry through `livewiki batch` to the SQLite index](flows/cli-src-01-to-core-src-05.md)
- [Core Repair, Status, Sectioning, Symbols, and Risk Pipeline](core-src-11.md) — dependency
- [Core runtime config, schema, diagrams, diff preview, and export](core-src-05.md) — dependency
- [core prompts, presets, pricing, and README export](core-src-10.md) — dependency

> Coverage note: this module's source (12 files, ~74k chars) exceeded the prompt budget and was excerpted; this page documents the closed-list symbols.
<!-- livewiki:navigate:end -->
