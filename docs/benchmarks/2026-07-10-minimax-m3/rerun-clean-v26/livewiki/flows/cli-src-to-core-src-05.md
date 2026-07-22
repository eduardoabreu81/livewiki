---
title: CLI entry through stage-5 import resolution
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
  - packages/core/src/db.ts#CURRENT_SCHEMA_VERSION
  - packages/core/src/batch-state.ts#DIAGNOSTIC_MAX_ERRORS
  - packages/core/src/batch-state.ts#DIAGNOSTIC_TEXT_CAP
  - packages/core/src/manifest.ts#buildManifest
  - packages/core/src/manifest.ts#computeSnapshotHash
  - packages/core/src/export.ts#buildMarker
  - packages/core/src/export.ts#detectMarker
  - packages/core/src/import-resolution.ts#expandWorkspaceGlob
  - packages/core/src/import-resolution.ts#hasPackageManifest
updated: 2026-07-22
modules:
  - cli-src
  - commands
  - core-src-01
  - core-src-03
  - core-src-02
  - core-src-06
  - core-src-04
  - core-src-05
---

# CLI entry through stage-5 import resolution

This page explains the end-to-end behavior of running a `livewiki` batch CLI invocation, from process startup through the stage-5 import-resolution sink that closes the walk.

## Purpose
<!-- lw:anchors packages/cli/src/cli.ts#createProgram packages/cli/src/cli.ts#readVersion packages/cli/src/cli.ts#resolveRepoRoot packages/cli/src/cli.ts#run packages/cli/src/output.ts#emit packages/cli/src/output.ts#emitHuman packages/cli/src/output.ts#emitJson -->

The flow starts when a user invokes the `livewiki` binary: `index.ts` is the executable entry and calls into `packages/cli/src/cli.ts#run`, which delegates to the commander scaffold built by `packages/cli/src/cli.ts#createProgram`. The version is read by `packages/cli/src/cli.ts#readVersion`, and `packages/cli/src/cli.ts#resolveRepoRoot` turns the optional `--repo` flag into an absolute repository root that every downstream command reuses.

```ts
export function createProgram(): Command {
function readVersion(): string {
export function resolveRepoRoot(repoOpt: string | undefined): string {
export async function run(argv: readonly string[]): Promise<void> {
```

```ts
export function emit(
export function emitHuman(text: string): void {
export function emitJson(data: unknown): void {
```

The CLI produces a batch run: a human-readable or JSON status report via `emitHuman`/`emitJson` (both routed through `packages/cli/src/output.ts#emit`), a persisted `.manifest.json` describing the run, and — at the end of the walk — a `ResolvedImportEdge` set covering every external import specifier that the repo actually uses.

## Ordered flow
<!-- lw:anchors packages/cli/src/commands/batch.ts#appendStage4Diagnostics packages/cli/src/commands/batch.ts#formatDiagnosticLine packages/cli/src/commands/batch.ts#formatListHuman packages/core/src/anchor-ledger.ts#AnchorParseError packages/core/src/anchor-ledger.ts#AnchorParseError.constructor packages/core/src/anchor-ledger.ts#assigneeFor packages/core/src/batch.ts#accumulateUsage packages/core/src/batch.ts#aggregateTotals packages/core/src/batch.ts#attemptStage4Generation packages/core/src/db.ts#CURRENT_SCHEMA_VERSION packages/core/src/batch-state.ts#DIAGNOSTIC_MAX_ERRORS packages/core/src/batch-state.ts#DIAGNOSTIC_TEXT_CAP -->

1. The `livewiki` binary (`packages/cli/src/index.ts`) calls `run(process.argv)` in `packages/cli/src/cli.ts`.
2. `run` resolves the repo root via `packages/cli/src/cli.ts#resolveRepoRoot`, then invokes the commander `Command` produced by `packages/cli/src/cli.ts#createProgram` (the scaffold registers `init`, `index`, `status`, `update`, `verify`, `serve`, `batch`, `export`, `view`, and `pointer`).
3. The selected subcommand handler in `packages/cli/src/commands/` parses its options (including `--json`/`--repo`) and calls `packages/cli/src/output.ts#emit` to route stdout to either `emitHuman` or `emitJson`.
4. For the `batch` subcommand, the handler in `packages/cli/src/commands/batch.ts` calls `runBatch`, `resumeBatch`, or `runOnly` from `@livewiki/core/batch`. Stage-4 diagnostic surfacing flows through `formatDiagnosticLine`, `appendStage4Diagnostics`, and `formatListHuman` (`packages/cli/src/commands/batch.ts`).
5. Inside `packages/core/src/batch.ts`, `attemptStage4Generation` invokes the LLM per module task; `accumulateUsage` and `aggregateTotals` shape `StageUsage` rows.
6. `packages/core/src/batch-state.ts` defines the diagnostic caps:
   ```ts
   export const DIAGNOSTIC_MAX_ERRORS = 50;
   export const DIAGNOSTIC_TEXT_CAP = 200;
   ```
   These bound how many error rows `appendStage4Diagnostics` keeps and how much per-error text `formatDiagnosticLine` may emit before the report is truncated.
7. `packages/core/src/db.ts` opens the SQLite cache at `.livewiki/index.db` and stamps `schema_version` against `CURRENT_SCHEMA_VERSION`:
   ```ts
   export const CURRENT_SCHEMA_VERSION = 4;
   ```
8. `packages/core/src/anchor-ledger.ts` walks every page in `livewiki/`, parses anchors (raising `AnchorParseError` from `AnchorParseError.constructor` on malformed wiki pages), and uses `assigneeFor` to map each page's `owner` to a debt `assignee` (`agent` for generated pages, `human` for human-owned ones).
9. `packages/core/src/manifest.ts` writes `livewiki/.manifest.json` (the only writer) carrying the cross-machine handoff state; `computeSnapshotHash` fingerprints `livewiki/` content excluding the manifest itself, and `buildManifest` assembles the final document.
10. `packages/core/src/export.ts` consumes the snapshot for local export; `detectMarker` parses the livewiki generated marker from existing pages and `buildMarker` re-emits it on export, keeping anchor metadata stable.
11. Finally, `packages/core/src/import-resolution.ts` consumes the imported-specifier records: `expandWorkspaceGlob` resolves workspace `tsconfig` references to filesystem paths, and `hasPackageManifest` decides whether a given directory is a workspace package boundary. Together they produce the `ResolvedImportEdge` set that closes the walk.

```ts
async function expandWorkspaceGlob(absRoot: string, glob: string): Promise<string[]> {
async function hasPackageManifest(absRoot: string, dir: string): Promise<boolean> {
```

## Diagram

```mermaid
%% livewiki/diagrams/flow-cli-src-to-core-src-05.mmd
```

## Invariants

- The CLI scaffold (`createProgram`) is the only place that registers every `livewiki` subcommand; `run` always goes through commander, never directly to a handler.
- `resolveRepoRoot` returns an absolute path that every downstream module reads; nothing inside `@livewiki/core` re-prompts for `--repo`.
- `emitHuman` always appends a single trailing newline if absent; `emitJson` always emits exactly one JSON object followed by a newline, so `JSON.parse` works line-by-line.
- `DIAGNOSTIC_MAX_ERRORS = 50` and `DIAGNOSTIC_TEXT_CAP = 200` cap the diagnostic history that `appendStage4Diagnostics` appends and `formatDiagnosticLine` renders — the report is bounded, never unbounded.
- The SQLite index is derived: `CURRENT_SCHEMA_VERSION = 4` is stamped on every open and is the migration target for `db.ts`.
- `AnchorParseError` is the only error class raised from `anchor-ledger.ts` when a wiki page's anchor block is malformed; `assigneeFor` resolves every page `owner` to either `agent` or `human` and never silently leaves an `assignee` undefined.
- `computeSnapshotHash` excludes `.manifest.json` from its own input so the manifest cannot induce a write-loop in CI.
- `expandWorkspaceGlob` and `hasPackageManifest` together drive the single resolver: the module graph and stage-5 flow signals share the same `ResolvedImportEdge` rows and cannot disagree about an import's target.

## Failure and recovery
<!-- lw:anchors packages/core/src/manifest.ts#buildManifest packages/core/src/manifest.ts#computeSnapshotHash packages/core/src/export.ts#buildMarker packages/core/src/export.ts#detectMarker packages/core/src/import-resolution.ts#expandWorkspaceGlob packages/core/src/import-resolution.ts#hasPackageManifest -->

The supplied source is truncated; the excerpt does not establish exhaustive behavior for every error path, so this section limits itself to the failure and recovery branches visible in the cited source.

The CLI is fail-loud on runtime errors: `run(process.argv).catch(...)` in `index.ts` writes `livewiki: fatal error — <message>` to stderr and exits non-zero; commander handles usage errors (such as `--help` on a missing subcommand) internally before that catch fires. The visible contract is non-zero exit on unhandled error and a structured stderr line.

`AnchorParseError` (constructed via `AnchorParseError.constructor(wikiPath, cause)`) is raised by `anchor-ledger.ts` when a wiki page cannot be parsed; the ledger surfaces it so the offending `wikiPath` is identifiable. `assigneeFor` short-circuits manual blocks (`inManualBlock`) to keep human-owned anchors from being rewritten on disk — a recovery path that prevents the ledger from overwriting protected content even when the parse itself succeeds.

`attemptStage4Generation` in `batch.ts` operates under a circuit breaker — repeated stage-4 failures force the run to `completed_with_failures` with non-zero exit; usage accumulates via `accumulateUsage` / `aggregateTotals` so the status report shows the cost of the failed attempts and the retry command is reproduced in the report.

`export.ts` (which exposes `detectMarker` / `buildMarker`) refuses to touch `livewiki/` itself; a preflight failure leaves the destination unchanged, and an unforeseen filesystem failure during write returns exit 1 with the export partially updated (the documented contract is honest, not transactional — an idempotent rerun repairs it).

`import-resolution.ts` is strict: an import specifier that cannot be resolved exactly (relative, workspace package, or npm package) is dropped from the `ResolvedImportEdge` set rather than guessed; `expandWorkspaceGlob` only matches workspace references present in the relevant `tsconfig`, and `hasPackageManifest` is the sole check that promotes a directory to a workspace-package boundary. There is no fallback resolver in the cited source.

The `.manifest.json` writer (`buildManifest` + `computeSnapshotHash`) is keyed on a sha256 of `livewiki/` content excluding the manifest itself, so a manifest write cannot trigger its own rewrite loop in CI. A no-op snapshot hash short-circuits the rewrite rather than emitting an unchanged manifest.

## Related pages

- [cli-src](../cli-src.md)
- [commands](../commands.md)
- [core-src-01](../core-src-01.md)
- [core-src-03](../core-src-03.md)
- [core-src-02](../core-src-02.md)
- [core-src-06](../core-src-06.md)
- [core-src-04](../core-src-04.md)
- [core-src-05](../core-src-05.md)
- [How it works](index.md)