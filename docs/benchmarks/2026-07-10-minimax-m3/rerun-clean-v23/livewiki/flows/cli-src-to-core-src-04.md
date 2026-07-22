---
title: CLI entry to core-src-04 export — semantic product flow
owner: generated
anchors:
  - packages/cli/src/cli.ts#createProgram
  - packages/cli/src/cli.ts#readVersion
  - packages/cli/src/cli.ts#resolveRepoRoot
  - packages/cli/src/cli.ts#run
  - packages/cli/src/output.ts#emit
  - packages/cli/src/output.ts#emitHuman
  - packages/cli/src/output.ts#emitJson
  - packages/cli/src/commands/batch.ts#appendStage4Diagnostics
  - packages/cli/src/commands/batch.ts#formatDiagnosticLine
  - packages/cli/src/commands/batch.ts#formatListHuman
  - packages/core/src/anchor-ledger.ts#AnchorParseError
  - packages/core/src/anchor-ledger.ts#AnchorParseError.constructor
  - packages/core/src/anchor-ledger.ts#assigneeFor
  - packages/core/src/batch.ts#accumulateUsage
  - packages/core/src/batch.ts#aggregateTotals
  - packages/core/src/batch.ts#attemptStage4Generation
  - packages/core/src/batch-state.ts#DIAGNOSTIC_MAX_ERRORS
  - packages/core/src/batch-state.ts#DIAGNOSTIC_TEXT_CAP
  - packages/core/src/db.ts#CURRENT_SCHEMA_VERSION
  - packages/core/src/import-resolution.ts#expandWorkspaceGlob
  - packages/core/src/import-resolution.ts#hasPackageManifest
  - packages/core/src/manifest.ts#buildManifest
  - packages/core/src/manifest.ts#computeSnapshotHash
  - packages/core/src/export.ts#buildMarker
  - packages/core/src/export.ts#detectMarker
updated: 2026-07-21
modules:
  - cli-src
  - commands
  - core-src-01
  - core-src-03
  - core-src-02
  - core-src-05
  - core-src-06
  - core-src-04
---

# CLI entry to core-src-04 export — semantic product flow

This page explains the end-to-end path that begins at the livewiki CLI bin and ends at the deterministic export sink in core-src-04, threading through Commander wiring, batch orchestration, manifest persistence, and the SQLite-backed index.

## Purpose
<!-- lw:anchors packages/cli/src/cli.ts#createProgram packages/cli/src/cli.ts#readVersion packages/cli/src/cli.ts#resolveRepoRoot packages/cli/src/cli.ts#run -->

The flow starts when the user invokes the `livewiki` binary; `index.ts` delegates to `run` in `packages/cli/src/cli.ts`, which builds the Commander program via `createProgram`, resolves the working directory through `resolveRepoRoot`, and reports the version computed by `readVersion`. It produces a configured `Command` tree that every per-phase subcommand (`init`, `batch`, `export`, …) attaches to, ready to dispatch an end-to-end pipeline that walks from the CLI surface down to the deterministic exporters in core-src-04.

```ts
export function createProgram(): Command {
function readVersion(): string {
export function resolveRepoRoot(repoOpt: string | undefined): string {
export async function run(argv: readonly string[]): Promise<void> {
```

## Ordered flow
<!-- lw:anchors packages/cli/src/output.ts#emit packages/cli/src/output.ts#emitHuman packages/cli/src/output.ts#emitJson packages/cli/src/commands/batch.ts#appendStage4Diagnostics packages/cli/src/commands/batch.ts#formatDiagnosticLine packages/cli/src/commands/batch.ts#formatListHuman packages/core/src/anchor-ledger.ts#AnchorParseError packages/core/src/anchor-ledger.ts#AnchorParseError.constructor packages/core/src/anchor-ledger.ts#assigneeFor packages/core/src/batch.ts#accumulateUsage packages/core/src/batch.ts#aggregateTotals packages/core/src/batch.ts#attemptStage4Generation packages/core/src/batch-state.ts#DIAGNOSTIC_MAX_ERRORS packages/core/src/batch-state.ts#DIAGNOSTIC_TEXT_CAP -->

1. The `livewiki` bin (`packages/cli/src/index.ts`) calls `run(process.argv)`, which delegates to `packages/cli/src/cli.ts#run`.
2. `createProgram` constructs the Commander `Command`, naming it `livewiki`; `readVersion` supplies the version string; `resolveRepoRoot` normalizes the `--repo` argument.
3. Each `register*(program)` in `packages/cli/src/commands` attaches a subcommand (`init`, `index-cmd`, `status`, `update`, `verify`, `batch`, `export`, `pointer`, plus the `serve`/`view` stubs).
4. Every command routes its result through `emit` in `packages/cli/src/output.ts`, which dispatches to `emitHuman` (multi-line text) or `emitJson` (single-line JSON), honoring `--json` everywhere.
5. For `livewiki batch <run>`, `commands/batch.ts` calls into `@livewiki/core/batch` (`runBatch`/`resumeBatch`/`runOnly`) and surfaces diagnostics through `appendStage4Diagnostics` and `formatDiagnosticLine`; list-style output is rendered by `formatListHuman`.
6. Inside the batch orchestrator (core-src-03 / core-src-02), `attemptStage4Generation` runs a single LLM call per module, recording usage. `accumulateUsage` and `aggregateTotals` merge per-attempt `StageUsage` so the final report credits repairs without inventing duplicates.
7. Diagnostic and message text length is bounded before persistence by `DIAGNOSTIC_MAX_ERRORS` and `DIAGNOSTIC_TEXT_CAP` (`packages/core/src/batch-state.ts`).
8. Anchor reconciliation (core-src-01) walks each `livewiki/*.md` page, throws `AnchorParseError` (`constructor(wikiPath, cause)`) on malformed sections, and assigns ownership via `assigneeFor`, producing the `changed`/`moved`/`deleted` debt rows.
9. core-src-05 expands workspace packages through `expandWorkspaceGlob` and `hasPackageManifest` so the module graph and import resolver share one edge model.
10. core-src-06 stamps the snapshot via `buildManifest` and `computeSnapshotHash`, writing `livewiki/.manifest.json` so cross-machine handoff of interrupted batch runs is reproducible.
11. core-src-04 exports the wiki deterministically; `detectMarker` and `buildMarker` rewrite links and stamp every generated page so the destination tree is byte-stable under reruns.

```ts
export function emit(
export function emitHuman(text: string): void {
export function emitJson(data: unknown): void {
function appendStage4Diagnostics(
function formatDiagnosticLine(d: {
function formatListHuman(runs: Awaited<ReturnType<typeof listRuns>>): string {
async function attemptStage4Generation(
function accumulateUsage(
function aggregateTotals(a: StageUsage, b: StageUsage): StageUsage {
export const DIAGNOSTIC_MAX_ERRORS = 50;
export const DIAGNOSTIC_TEXT_CAP = 200;
export class AnchorParseError extends Error {
constructor(wikiPath: string, cause: Error) {
function assigneeFor(owner: Owner, inManualBlock: boolean): Assignee {
```

## Diagram

```mermaid
%% livewiki/diagrams/flow-cli-src-to-core-src-04.mmd
```

## Invariants
- `createProgram` is the single Commander root; every subcommand must be attached through a `register*` function in `packages/cli/src/commands`, never through a side import of `Command`.
- Output of any CLI action flows through `emit` so the `--json`/human split is enforced uniformly via `emitJson` vs `emitHuman`.
- The SQLite index must open at `CURRENT_SCHEMA_VERSION = 4`; an older schema forces a reindex, never a silent overwrite.
- `DIAGNOSTIC_MAX_ERRORS` and `DIAGNOSTIC_TEXT_CAP` must be applied before any diagnostic list reaches the checkpoint JSON, so persisted reports stay bounded regardless of model verbosity.
- `AnchorParseError` is raised on malformed section markers and carries both the offending `wikiPath` and the underlying `cause`; downstream stages must surface, not swallow, the cause.
- `buildManifest` and `computeSnapshotHash` operate on `livewiki/` contents with the manifest itself excluded, so the hash is stable under repeated writes.
- `expandWorkspaceGlob` and `hasPackageManifest` are the single source of truth for workspace edges — the module graph and the stage-5 flow detector must read from the same resolver output.

## Failure and recovery
<!-- lw:anchors packages/core/src/db.ts#CURRENT_SCHEMA_VERSION packages/core/src/import-resolution.ts#expandWorkspaceGlob packages/core/src/import-resolution.ts#hasPackageManifest packages/core/src/manifest.ts#buildManifest packages/core/src/manifest.ts#computeSnapshotHash packages/core/src/export.ts#buildMarker packages/core/src/export.ts#detectMarker -->

The supplied source shows the following failure and recovery surfaces for this walk. When a single batch task fails inside `attemptStage4Generation`, the orchestrator marks the task `'failed'` with the reason recorded in its checkpoint and continues with the remaining work; the batch keeps running until either three consecutive failures or a >50% failure rate trips the circuit breaker, at which point the run aborts and is reported as `status = 'completed_with_failures'` with a non-zero exit code. `accumulateUsage` and `aggregateTotals` credit repair attempts without producing duplicate usage entries — the `usageHistory` list is the single source of truth for "current usage", and the status reporter aggregates it on read so a retried task never inflates the totals.

When the anchor ledger (core-src-01) encounters malformed Markdown frontmatter or section markers, it throws `AnchorParseError`; the constructor stores both the offending `wikiPath` and the underlying `cause`, and the upstream command formats the diagnostic line through `formatDiagnosticLine` / `appendStage4Diagnostics` without losing the original reason. The SQLite index opens against `CURRENT_SCHEMA_VERSION`, and an older stored version triggers the in-place migration path defined in `db.ts` (idempotent migrations, never destructive); an unforeseen schema mismatch returns a clear error rather than silently rewriting tables. The supplied excerpt does not show the full migration step list, so the exhaustive behavior of an unmappable schema is not established here.

`import-resolution.ts` refuses to guess on unresolved specifiers: `expandWorkspaceGlob` and `hasPackageManifest` either return a concrete file list / boolean or throw, so the module graph and stage-5 flow detector cannot drift from each other when a workspace package moves or disappears. `manifest.ts` only writes `livewiki/.manifest.json` when the computed snapshot hash actually changes via `computeSnapshotHash` and `buildManifest`, preventing CI loops when nothing on disk has shifted. Finally, `export.ts` runs a preflight against the destination tree before any write; a preflight failure leaves `.livewiki/export/<target>/` unchanged, `buildMarker` and `detectMarker` are used to stamp only the actually-written files, and an unforeseen filesystem failure surfaces as exit code 1 with the contract that an idempotent rerun repairs the partial state. The supplied excerpt does not establish exhaustive behavior for every error class (for example, network-level LLM failures inside `attemptStage4Generation`); those paths live behind the `LlmClient` adapter and are not visible here.

## Related pages
- [cli-src](../cli-src.md)
- [commands](../commands.md)
- [core-src-01](../core-src-01.md)
- [core-src-03](../core-src-03.md)
- [core-src-02](../core-src-02.md)
- [core-src-05](../core-src-05.md)
- [core-src-06](../core-src-06.md)
- [core-src-04](../core-src-04.md)
- [How it works](index.md)