---
title: CLI scaffold through export hashing
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
  - packages/core/src/manifest.ts#buildManifest
  - packages/core/src/manifest.ts#computeSnapshotHash
  - packages/core/src/export.ts#buildMarker
  - packages/core/src/export.ts#detectMarker
updated: 2026-07-22
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

# CLI scaffold through export hashing

This page explains how an end-to-end `livewiki` invocation hands off from the commander scaffold in `cli-src`, through the per-subcommand action handlers in `commands`, into the batch pipeline persisted by the SQLite index under `core-src-03`, reports status via the diagnostic aggregation in `core-src-02`, resolves workspace import edges in `core-src-05`, and finally writes the on-disk manifest and export markers served by `core-src-04` and `core-src-06`.

## Purpose
<!-- lw:anchors packages/cli/src/cli.ts#createProgram packages/cli/src/cli.ts#readVersion packages/cli/src/cli.ts#resolveRepoRoot packages/cli/src/cli.ts#run packages/cli/src/output.ts#emit packages/cli/src/output.ts#emitHuman packages/cli/src/output.ts#emitJson packages/cli/src/commands/batch.ts#appendStage4Diagnostics packages/cli/src/commands/batch.ts#formatDiagnosticLine packages/cli/src/commands/batch.ts#formatListHuman -->

The flow begins when the executable entry `index.ts` invokes `run` against `process.argv`. `run` then asks `createProgram` to assemble the commander `Command` tree, reading the version string with `readVersion`, and routes the parsed action through `resolveRepoRoot` to normalize the target directory before any subcommand handler runs. The CLI entry contract is:

```ts
export async function run(argv: readonly string[]): Promise<void> {
```

Output is funnelled through a single emitter helper:

```ts
export function emit(
```

whose `emitHuman` and `emitJson` siblings split the two formatting paths (multi-line text vs single-line `JSON.stringify` + newline). The `batch` subcommand attaches three human-formatting helpers — `appendStage4Diagnostics`, `formatDiagnosticLine`, and `formatListHuman` — that decorate the `BatchStatusReport` produced by `core-src-02` before delegation back to `emit`. The outcome of this section is a fully resolved command context (argv → repo root → handler) with output framing ready for either machine or human consumers.

## Ordered flow
<!-- lw:anchors packages/core/src/anchor-ledger.ts#AnchorParseError packages/core/src/anchor-ledger.ts#AnchorParseError.constructor packages/core/src/anchor-ledger.ts#assigneeFor packages/core/src/batch.ts#accumulateUsage packages/core/src/batch.ts#aggregateTotals packages/core/src/batch.ts#attemptStage4Generation packages/core/src/batch-state.ts#DIAGNOSTIC_MAX_ERRORS packages/core/src/batch-state.ts#DIAGNOSTIC_TEXT_CAP -->

1. `index.ts` calls `packages/cli/src/cli.ts#run` with `process.argv`; `run` asks `createProgram` for a `Command` and `readVersion` for the `--version` string, then dispatches the matched subcommand.
2. Each `registerX(program)` from `packages/cli/src/commands/` attaches its action handler. The `batch` action resolves the repo root via `packages/cli/src/cli.ts#resolveRepoRoot`, then delegates to `@livewiki/core/batch`.
3. `packages/core/src/batch.ts#runBatch` orchestrates the four-stage pipeline (varredura, identificação, priorização, documentação). On stage 4 it calls `packages/core/src/batch.ts#attemptStage4Generation` per module; usage rows feed into `packages/core/src/batch.ts#accumulateUsage` and finally into `packages/core/src/batch.ts#aggregateTotals`.
4. Diagnostic history is capped by `packages/core/src/batch-state.ts#DIAGNOSTIC_MAX_ERRORS` (50) and message text by `packages/core/src/batch-state.ts#DIAGNOSTIC_TEXT_CAP` (200) so persisted checkpoints stay bounded.
5. Persisted anchors and debt rows pass through `packages/core/src/anchor-ledger.ts#assigneeFor` to derive the page assignee (agent for `generated` pages, human for `human` pages, mixed pages resolve to agent). Parse failures surface as `packages/core/src/anchor-ledger.ts#AnchorParseError` — instantiated via `packages/core/src/anchor-ledger.ts#AnchorParseError.constructor` — and bubble back to the CLI as a non-zero exit.
6. Stage 5 (semantic product flows) consumes the same `ResolvedImportEdge` rows built by `packages/core/src/import-resolution.ts#expandWorkspaceGlob` and `packages/core/src/import-resolution.ts#hasPackageManifest`; `manifest.ts` then writes the on-disk ledger; `export.ts` emits deterministic destination markers.

## Diagram

```mermaid
%% livewiki/diagrams/flow-cli-src-to-core-src-04.mmd
```

## Invariants

- `cli-src` owns argv parsing and stdout framing; downstream modules never call `process.stdout.write` directly — every subcommand funnels through `packages/cli/src/output.ts#emit` (or its `emitHuman` / `emitJson` siblings).
- The `livewiki` program name, the `--version` string produced by `packages/cli/src/cli.ts#readVersion`, and the resolved repo root produced by `packages/cli/src/cli.ts#resolveRepoRoot` are the only side effects the scaffold may commit before handing control to a command handler.
- Stage-4 tasks keep failure-isolation: a single module failure marks the task `failed`, persists the diagnostic into `usageHistory`, and lets the orchestrator continue — the circuit breaker in `core-src-03` trips only after three consecutive failures or > 50% failure rate.
- Diagnostic rows are clamped by `packages/core/src/batch-state.ts#DIAGNOSTIC_MAX_ERRORS` and `packages/core/src/batch-state.ts#DIAGNOSTIC_TEXT_CAP` so checkpoints stay queryable and bounded in size.
- Anchor parse failures route through `packages/core/src/anchor-ledger.ts#AnchorParseError` — instantiated via `packages/core/src/anchor-ledger.ts#AnchorParseError.constructor(wikiPath, cause)` — and never silently rewrite a wiki page.
- `packages/core/src/db.ts#CURRENT_SCHEMA_VERSION` is `4`; the SQLite cache is always treated as derived state, never as the source of truth.
- `packages/core/src/import-resolution.ts#hasPackageManifest` and `packages/core/src/import-resolution.ts#expandWorkspaceGlob` are the single resolver the flow detector and the module graph share, so the graph and the stage-5 flow signals cannot disagree.
- `packages/core/src/export.ts#detectMarker` recognises the exact marker produced by `packages/core/src/export.ts#buildMarker` and refuses to overwrite destination files unless `--force` is supplied.
- `packages/core/src/manifest.ts#computeSnapshotHash` fingerprints the on-disk snapshot so `buildManifest` only rewrites `livewiki/.manifest.json` when the content actually changed (anti-loop in CI).

## Failure and recovery
<!-- lw:anchors packages/core/src/db.ts#CURRENT_SCHEMA_VERSION packages/core/src/manifest.ts#buildManifest packages/core/src/manifest.ts#computeSnapshotHash packages/core/src/export.ts#buildMarker packages/core/src/export.ts#detectMarker -->

The orchestrator's failure policy is documented inline in `packages/core/src/batch.ts`: a task failure is recorded with its reason and the run continues; the circuit breaker aborts only after three consecutive failures or > 50% failure rate, leaving the run in `completed_with_failures` with non-zero exit. Per-task diagnostics are appended through `packages/cli/src/commands/batch.ts#appendStage4Diagnostics`, formatted by `packages/cli/src/commands/batch.ts#formatDiagnosticLine` (subject to `DIAGNOSTIC_TEXT_CAP`), and listed by `packages/cli/src/commands/batch.ts#formatListHuman`. Anchor parser failures surface as `AnchorParseError` via `AnchorParseError.constructor`; on the CLI this becomes a non-zero exit propagated by `packages/cli/src/cli.ts#run` so the calling shell or CI runner sees it. Stage-4 usage accounting is consolidated with `packages/core/src/batch.ts#accumulateUsage` into `packages/core/src/batch.ts#aggregateTotals` across repair attempts so failed retries don't double-count.

The export subsystem (`packages/core/src/export.ts#buildMarker` / `packages/core/src/export.ts#detectMarker`) keeps a strict no-clobber contract: the transform and preflight run before any write, and a preflight failure leaves the destination tree unchanged; an unforeseen filesystem failure during write/remove leaves the export partially updated and the command exits 1, with an idempotent rerun repairing it. The manifest writer in `packages/core/src/manifest.ts#buildManifest` only rewrites `livewiki/.manifest.json` when `packages/core/src/manifest.ts#computeSnapshotHash` reports a change, which closes the loop where a CI machine would otherwise churn the file on every run. The source excerpt is truncated by token budget and does not establish exhaustive behavior for every recovery path beyond the ones quoted here.

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