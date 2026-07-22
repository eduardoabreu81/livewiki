---
title: CLI command dispatch into the core batch pipeline down to the persisted manifest
owner: generated
anchors:
  - packages/cli/src/cli.ts#createProgram
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
  - packages/core/src/batch-state.ts#DIAGNOSTIC_MAX_ERRORS
  - packages/core/src/batch-state.ts#DIAGNOSTIC_TEXT_CAP
  - packages/core/src/batch.ts#accumulateUsage
  - packages/core/src/batch.ts#aggregateTotals
  - packages/core/src/batch.ts#attemptStage4Generation
  - packages/core/src/db.ts#CURRENT_SCHEMA_VERSION
  - packages/core/src/export.ts#buildMarker
  - packages/core/src/export.ts#detectMarker
  - packages/core/src/import-resolution.ts#expandWorkspaceGlob
  - packages/core/src/import-resolution.ts#hasPackageManifest
  - packages/core/src/manifest.ts#buildManifest
  - packages/core/src/manifest.ts#computeSnapshotHash
updated: 2026-07-21
modules:
  - cli-src
  - commands
  - core-src-01
  - core-src-03
  - core-src-02
  - core-src-05
  - core-src-04
  - core-src-06
---

# CLI command dispatch into the core batch pipeline down to the persisted manifest

This page explains how a single `livewiki ...` invocation travels from the commander-based entry point in `cli-src`, through a registered command module under `commands`, into the `core-src` batch orchestrator, and finally lands as a `.livewiki/.manifest.json` snapshot on disk.

## Purpose
<!-- lw:anchors packages/cli/src/cli.ts#createProgram packages/cli/src/cli.ts#resolveRepoRoot packages/cli/src/output.ts#emit -->

The flow starts when the `livewiki` binary is executed and the published `packages/cli/src/index.ts` calls into the commander program. `createProgram` assembles the surface and each per-command registration attaches an action handler that resolves the repo root and routes the call into a `@livewiki/core/*` module. The end product is either a freshly written or freshly updated `.livewiki/.manifest.json` whose `snapshotHash` fingerprints the on-disk `livewiki/` snapshot, plus the JSON-or-human status report emitted by `emit`.

The CLI is the boundary between the user-facing shell and the deterministic core. `createProgram()` returns a commander `Command` named `livewiki` with every Phase 0+5 subcommand registered. `resolveRepoRoot(repoOpt: string | undefined): string` is the single entry-side helper that normalises the optional `--repo` flag into an absolute path every command shares. `emit`, `emitHuman`, and `emitJson` from `packages/cli/src/output.ts` are the only places stdout is written; every command funnels success, failure, and stub messages through them so `--json` and human rendering stay byte-stable.

## Ordered flow
<!-- lw:anchors packages/cli/src/cli.ts#run packages/cli/src/output.ts#emitHuman packages/cli/src/output.ts#emitJson packages/cli/src/commands/batch.ts#appendStage4Diagnostics packages/cli/src/commands/batch.ts#formatDiagnosticLine packages/cli/src/commands/batch.ts#formatListHuman packages/core/src/batch.ts#accumulateUsage packages/core/src/batch.ts#aggregateTotals packages/core/src/batch.ts#attemptStage4Generation -->

1. `index.ts` parses `process.argv` and awaits `run(argv)` from `cli.ts`.
2. `createProgram` returns the commander tree with `init`, `index`, `status`, `update`, `verify`, `serve`, `batch`, `export`, `view`, and `pointer` registered in order.
3. The matching command module under `packages/cli/src/commands/` reads its options, calls `resolveRepoRoot(options.repo)`, and dispatches into the corresponding `@livewiki/core/*` orchestrator (`runBatch`, `runInit`, `runIndexer`, `runLedger`, `exportWiki`, etc.).
4. Core modules open the SQLite index (`db.ts`) with the active `CURRENT_SCHEMA_VERSION`, walk the repo, persist symbols, run stage-2 module identification (heuristic + opt-in LLM refine), and write usage into `batch_tasks.checkpoint_json`.
5. Stage-4 generation calls `attemptStage4Generation`; bounded repair retries via `accumulateUsage` so each attempt contributes one entry to `usageHistory` without duplication.
6. Aggregate reporting goes through `aggregateTotals` to roll per-stage and per-module usage into `BatchStatusReport` rows.
7. Human-readable rendering for the `batch status` subcommand flows through `appendStage4Diagnostics`, `formatDiagnosticLine`, and `formatListHuman`, all of which feed into `emitHuman` so output stays single-sink.
8. The `manifest` writer produces a new `.livewiki/.manifest.json` only when `computeSnapshotHash` differs from the previous `snapshotHash`, after which `buildManifest` stamps the file and the cycle can be resumed cross-machine via `batch resume`.

## Diagram

```mermaid
%% livewiki/diagrams/flow-cli-src-to-core-src-06.mmd
```

## Invariants

- The commander program assembled by `createProgram` is named `livewiki`; smoke tests in `cli.test.ts` fail loudly if any registered subcommand disappears.
- `resolveRepoRoot` is the single repo-root resolver every command shares; commands never reimplement path resolution locally.
- All CLI stdout passes through `emit` / `emitHuman` / `emitJson`. `--json` is a flag on every command, and `emitJson` always writes exactly one line followed by a newline so downstream `JSON.parse` is safe.
- The SQLite index opened by core modules is stamped with `CURRENT_SCHEMA_VERSION = 4`; any older version triggers migration. The DB is derived — `.livewiki/` can be deleted and rebuilt from source.
- `usageHistory` on every task is always a list, starting at attempt 1; `accumulateUsage` and `aggregateTotals` merge without duplicating.
- The manifest writer is the only code that may appear under `.livewiki/` besides the SQLite index and config; `buildManifest` refuses to write when `computeSnapshotHash` matches the stored value, preventing an infinite CI loop.
- Manual blocks (the `# lw:manual` surface) are sacred and never modified, deleted, or rewritten by any stage of this flow.

## Failure and recovery
<!-- lw:anchors packages/core/src/anchor-ledger.ts#AnchorParseError packages/core/src/anchor-ledger.ts#AnchorParseError.constructor packages/core/src/anchor-ledger.ts#assigneeFor packages/core/src/batch-state.ts#DIAGNOSTIC_MAX_ERRORS packages/core/src/batch-state.ts#DIAGNOSTIC_TEXT_CAP packages/core/src/db.ts#CURRENT_SCHEMA_VERSION packages/core/src/export.ts#buildMarker packages/core/src/export.ts#detectMarker packages/core/src/import-resolution.ts#expandWorkspaceGlob packages/core/src/import-resolution.ts#hasPackageManifest packages/core/src/manifest.ts#buildManifest packages/core/src/manifest.ts#computeSnapshotHash -->

The supplied source surfaces a bounded set of failure paths. `AnchorParseError` and its `constructor(wikiPath, cause)` carry the offending wiki page path and underlying parse cause from the ledger into the status report, where `appendStage4Diagnostics` and `formatDiagnosticLine` cap visible problems at `DIAGNOSTIC_MAX_ERRORS = 50` entries and each message at `DIAGNOSTIC_TEXT_CAP = 200` characters — anything beyond those caps is truncated, not silently dropped.

Stage-4 generation runs through `attemptStage4Generation`; the supplied excerpt shows a single retry path rather than an unbounded one, with `accumulateUsage` adding each retry's usage without duplication. If a run finishes with at least one failed task, the orchestrator marks it `completed_with_failures` and `exit ≠ 0`; a `batch resume` against the same `repoRoot` re-reads `.livewiki/.manifest.json` (the snapshot hash from `computeSnapshotHash`) and continues from the last checkpoint, so an interrupted run is hand-off-able to another machine.

`db.ts` exposes `CURRENT_SCHEMA_VERSION`; opening an older index triggers migrations. The exporter stamps every derived file with `buildMarker` and rejects stale leftovers via `detectMarker`, refusing to overwrite without `--force`. `import-resolution.ts` provides `expandWorkspaceGlob` and `hasPackageManifest` so the stage-5 flow detector never has to guess about a missing workspace manifest — fail-closed, not fail-open.

The supplied excerpt does not establish exhaustive behavior for every path (e.g. the commander-level exit-code selection for `serve` and `view` Phase-7 stubs, the deep retry policy of the LLM adapter); this page scopes its claims to what the cited source visibly contains.

## Related pages

- [How it works](index.md)
- [cli-src](../cli-src.md)
- [commands](../commands.md)
- [core-src-01](../core-src-01.md)
- [core-src-03](../core-src-03.md)
- [core-src-02](../core-src-02.md)
- [core-src-05](../core-src-05.md)
- [core-src-04](../core-src-04.md)
- [core-src-06](../core-src-06.md)