---
title: "Export command"
owner: generated
anchors:
  - packages/cli/src/commands/export.ts#emit
  - packages/cli/src/commands/export.ts#emitReadme
  - packages/cli/src/commands/export.ts#exportErrorToResult
  - packages/cli/src/commands/export.ts#registerExport
  - packages/cli/src/commands/export.ts#runReadmeExport
---

# Export command

The `livewiki export` command turns the project's curated wiki into a deliverable artifact on disk: either a flattened snapshot under `.livewiki/export/<target>/` (for `generic`, `github-wiki`, and `gitlab-wiki` targets) or a synthesized repository-root `README.md` (for the `readme` target).

## When to use this page

- **Register or extend** the `export` subcommand on the Commander program.
- **Trace** how a thrown `ExportError` (or any unexpected error) is converted into the structured JSON payload the CLI contract promises.
- **Reason about** the dry-run versus write semantics for the `readme` target and how `--yes` flips them.
- **Understand** why `--push` is rejected up front in this lot and where the exit code is decided.

## How it fits

`packages/cli/src/commands/export.ts` is part of the `@livewiki/cli` package and lives under `src/commands/`. It defines the `export <target>` subcommand by calling `registerExport(program)` from the top-level CLI wiring in `packages/cli/src/cli.ts`. The flatten/copy pipeline (for `generic`, `github-wiki`, `gitlab-wiki`) and the `validateTarget` guard both come from `@livewiki/core/export`; the README synthesis path reuses `exportReadme` and the `ReadmeExportResult` contract from `@livewiki/core/readme-export`. Repo-root resolution (`resolveRepoRoot`) is shared with the rest of the CLI. This file is the glue that decides which core entry point to invoke, normalizes errors into a stable result shape, and renders either JSON or human output before setting `process.exitCode`.

## Diagram

```mermaid
%% livewiki/diagrams/commands-export.mmd
```

## Command registration and dispatch

<!-- lw:anchors packages/cli/src/commands/export.ts#registerExport -->

The entry point exposed by this file is the registration call that wires `livewiki export <target>` onto the root Commander program.

```ts
export function registerExport(program: Command): void {
```

`registerExport` takes the shared Commander `program` and returns nothing; it attaches the `export <target>` subcommand, declares the `--force`, `--yes`, and `--push` flags, and installs the async action handler that resolves options, picks the dispatch branch, and emits the final result. Inside the action handler it merges global options (`optsWithGlobals`), resolves the repository root via `resolveRepoRoot(opts.repo)`, and computes an absolute path before doing anything else — that absolute root is what every downstream core call sees.

The handler then performs two up-front branches before any flattening work runs. First, if `target === "readme"` it delegates to `runReadmeExport` and returns; the README path has different write semantics (a repo-root file with a marker-block contract and an opt-in `--yes`) and must never enter the flatten/copy pipeline. Second, it calls `validateTarget(target)` inside its own `try/catch`; on failure it converts the thrown error with `exportErrorToResult`, calls `emit`, and returns so an unknown target never reaches the global fatal-error handler. After validation, the handler invokes `exportWiki({ repoRoot, target, ...(opts.force ? { force: true } : {}), ...(opts.push !== undefined ? { push: opts.push } : {}) })` and again wraps the call: any throw is funneled through `exportErrorToResult` and then emitted. The action handler itself never calls `process.exit`; `process.exitCode` is set inside `emit` so the Node process can still flush stdout cleanly.

## Error-to-result normalization

<!-- lw:anchors packages/cli/src/commands/export.ts#exportErrorToResult -->

The CLI promises a stable JSON contract: every export attempt, success or failure, produces an `ExportResult` shaped object with `ok`, `target`, `outDir`, `pagesWritten`, `pagesRemoved`, and `issues`. To honor that promise when core throws, the file owns one small adapter.

```ts
function exportErrorToResult(
  absRoot: string,
  target: ExportTarget,
  err: unknown,
): ExportResult {
```

`exportErrorToResult` takes the absolute repository root, the validated target name, and any value caught from a `try/catch`. When `err` is an `ExportError` it returns a structured failure with `ok: false`, the canonical `outDir` (`<absRoot>/.livewiki/export/<target>`), zero counters, and the error's own `issues` list — including any preflight issues that `ExportError` already aggregated. For any other thrown value it derives a single `ExportIssue` with `code: "write_failed"`, `severity: "error"`, `path: "(export)"`, and a `detail` string built as `err instanceof Error ? err.message : String(err)` so a thrown primitive or `null` does not crash the catch handler. The visible evidence is the `err instanceof Error` branch only; the converter handles both an `ExportError` and an "anything else" path, and the `ExportError` branch preserves the issues list verbatim.

## Result emission and exit code

<!-- lw:anchors packages/cli/src/commands/export.ts#emit -->

Every code path in the action handler ends at `emit`, which is the only place that decides the exit code for the flatten/copy targets.

```ts
function emit(json: boolean, result: ExportResult): void {
```

`emit` takes a `json` flag and the structured `ExportResult`. It computes `exitCode = result.ok ? 0 : 1` and assigns `process.exitCode` before writing anything, so a JSON-mode failure still exits `1`. In JSON mode it writes a single line of the form `{"ok": <bool>, "export": <result>}` to stdout. In human mode it prints a one-line summary ("`livewiki export <target>: N written, N removed, N issue(s)`") followed, only when `result.issues.length > 0`, by an indented list of `[severity] code path: detail` entries. The function never throws on empty issues and never prints a trailing newline issue block when there are no issues.

## README export flow

<!-- lw:anchors packages/cli/src/commands/export.ts#runReadmeExport packages/cli/src/commands/export.ts#emitReadme -->

The `readme` target is handled by its own two-symbol pipeline so the README contract (dry-run preview by default, write only with `--yes`, marker-block safety) stays separate from the snapshot pipeline.

```ts
async function runReadmeExport(
  absRoot: string,
  json: boolean,
  yes: boolean,
): Promise<void> {
```

`runReadmeExport` takes the absolute repository root, the `json` flag, and the parsed `yes` boolean from `--yes`. It calls `exportReadme(absRoot, { yes })` inside a `try/catch`. On success it sets `process.exitCode` to `result.ok ? 0 : 1` and forwards the `ReadmeExportResult` to `emitReadme`. On any thrown value it forces `process.exitCode = 1` and, when the error is a `ReadmeExportError` with `code === "missing_wiki"` (or any other unexpected error), it calls `emitReadme` with an explicit refused result containing `action: "refused"`, `dryRun: !yes`, the canonical `path` (`<absRoot>/README.md`), zero byte delta, the captured `refusal` detail string, and an empty notes array. The README flow is therefore fail-closed: a missing wiki or an unexpected exception produces a `ReadmeExportResult` with `ok: false` and exits `1`.

```ts
function emitReadme(json: boolean, result: ReadmeExportResult): void {
```

`emitReadme` takes the `json` flag and the `ReadmeExportResult` produced by `runReadmeExport`; it does not set the exit code itself. In JSON mode it writes `{"ok": <bool>, "readme": <result>}` as a single line. In human mode it picks one of four lines based on `result.ok`, `result.dryRun`, and `result.action`:

- refused (`!result.ok`) prints "`livewiki export readme: refused`" followed by `result.refusal` when defined;
- dry-run with `action === "unchanged"` prints "README.md already up to date; nothing to do.";
- dry-run with a create or update action prints "would create README.md" or "would update README.md" and a hint to pass `--yes`, optionally followed by a `--- preview ---` block built from `result.preview` when defined;
- a real write prints "created" or "updated README.md" with a signed `bytesChanged` count.

After the status line it appends a `note: <note>` line for every entry in `result.notes`. The README emission never references pagesWritten or pagesRemoved because those counters belong to the snapshot pipeline.
