---
title: CLI batch stage-4 / stage-5 walk through the core slice
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
  - packages/core/src/db.ts#CURRENT_SCHEMA_VERSION
  - packages/core/src/batch-state.ts#DIAGNOSTIC_MAX_ERRORS
  - packages/core/src/batch-state.ts#DIAGNOSTIC_TEXT_CAP
  - packages/core/src/anchor-ledger.ts#AnchorParseError
  - packages/core/src/anchor-ledger.ts#AnchorParseError.constructor
  - packages/core/src/anchor-ledger.ts#assigneeFor
  - packages/core/src/batch.ts#accumulateUsage
  - packages/core/src/batch.ts#aggregateTotals
  - packages/core/src/batch.ts#attemptStage4Generation
  - packages/core/src/import-resolution.ts#expandWorkspaceGlob
  - packages/core/src/import-resolution.ts#hasPackageManifest
  - packages/core/src/manifest.ts#buildManifest
  - packages/core/src/manifest.ts#computeSnapshotHash
  - packages/core/src/navigation.ts#buildDisplayTitleFallbacks
  - packages/core/src/navigation.ts#buildNavigateBlock
updated: 2026-07-22
modules:
  - cli-src
  - commands
  - core-src-01
  - core-src-03
  - core-src-02
  - core-src-05
  - core-src-06
  - core-src-07
---

# CLI batch stage-4 / stage-5 walk through the core slice

This page explains the end-to-end path that turns a `livewiki batch` invocation into persisted stage-4 / stage-5 artifacts and aggregated run reports, traversing the CLI scaffold, the commander batch action, and the core orchestration, persistence, and navigation helpers.

## Purpose
<!-- lw:anchors packages/cli/src/cli.ts#createProgram packages/cli/src/cli.ts#readVersion packages/cli/src/cli.ts#resolveRepoRoot packages/cli/src/cli.ts#run packages/cli/src/output.ts#emit packages/cli/src/output.ts#emitHuman packages/cli/src/output.ts#emitJson -->

The flow starts when a user runs the `livewiki` binary on a target repository and ends with stage-4 page writes, a stage-5 flow artifact, an updated SQLite index at schema version 4, and a human or JSON run report emitted through `packages/cli/src/output.ts`. The CLI scaffold in `packages/cli/src/cli.ts` builds the commander `Command` via `createProgram`, resolves the version string through `readVersion`, anchors the target via `resolveRepoRoot`, and dispatches the chosen subcommand from `run`. Output is normalised through `emit`, which fans out to `emitHuman` for plain text or `emitJson` for line-stable JSON. Every CLI subcommand therefore enters the same output contract before crossing into `@livewiki/core`.

## Ordered flow
<!-- lw:anchors packages/cli/src/commands/batch.ts#appendStage4Diagnostics packages/cli/src/commands/batch.ts#formatDiagnosticLine packages/cli/src/commands/batch.ts#formatListHuman packages/core/src/db.ts#CURRENT_SCHEMA_VERSION packages/core/src/batch-state.ts#DIAGNOSTIC_MAX_ERRORS packages/core/src/batch-state.ts#DIAGNOSTIC_TEXT_CAP packages/core/src/anchor-ledger.ts#AnchorParseError packages/core/src/anchor-ledger.ts#AnchorParseError.constructor packages/core/src/anchor-ledger.ts#assigneeFor packages/core/src/batch.ts#accumulateUsage packages/core/src/batch.ts#aggregateTotals packages/core/src/batch.ts#attemptStage4Generation -->

1. `packages/cli/src/cli.ts#createProgram` registers every subcommand (init, index, status, update, verify, serve, batch, export, view, pointer) and `run` parses argv.
2. `readVersion` reads the package version and `resolveRepoRoot` normalises the `--repo` flag.
3. `livewiki batch <run>` invokes the action registered in `packages/cli/src/commands/batch.ts`, which calls `runBatch`, `resumeBatch`, or `runOnly` from `@livewiki/core/batch`.
4. The batch orchestrator (`packages/core/src/batch.ts`) walks the repo, identifies modules, and for each stage-4 task calls `attemptStage4Generation`.
5. Stage-4 generation collects per-attempt usage through `accumulateUsage`, persists each attempt into the checkpoint, and rolls up totals via `aggregateTotals`.
6. `packages/core/src/anchor-ledger.ts` upserts anchors into the SQLite cache at `CURRENT_SCHEMA_VERSION = 4` and assigns an owner through `assigneeFor`, throwing `AnchorParseError` (constructed via `AnchorParseError.constructor`) on malformed wiki pages.
7. Diagnostic history is appended to the checkpoint with `appendStage4Diagnostics`, bounded by `DIAGNOSTIC_MAX_ERRORS = 50` entries and `DIAGNOSTIC_TEXT_CAP = 200` characters per diagnostic.
8. The orchestrator writes the manifest, optionally persists stage-5 flow artifacts, and exits with status `completed_with_failures` when at least one task failed.
9. `livewiki batch status` reads checkpoints through `buildStatusReport` / `listRuns`; the action formats them with `formatListHuman` and `formatDiagnosticLine`, then routes the result through `emit`.

## Diagram

```mermaid
%% livewiki/diagrams/flow-cli-src-to-core-src-07.mmd
```

## Invariants

- `CURRENT_SCHEMA_VERSION = 4` is the authoritative SQLite cache schema that every code path that opens the index must agree on; opening an older cache triggers the v2→v3 or v3→v4 migrations defined alongside it.
- `DIAGNOSTIC_MAX_ERRORS = 50` and `DIAGNOSTIC_TEXT_CAP = 200` bound the per-task diagnostic history that `appendStage4Diagnostics` writes into `batch_tasks.checkpoint_json`; older entries are dropped when the cap is reached.
- `assigneeFor` returns one of the fixed `Assignee` values; pages with `owner: human` and `inManualBlock: true` must always be classified so the ledger never rewrites a manual block.
- `attemptStage4Generation` records usage on every attempt — never zero — and `accumulateUsage` and `aggregateTotals` sum those entries without double-counting the same attempt.
- `computeSnapshotHash` and `buildManifest` together gate manifest rewrites so a no-op cycle does not bump `updatedAt`.
- `buildDisplayTitleFallbacks` and `buildNavigateBlock` consume the same `Module[]` snapshot that produced the pages, so navigation never references a module that does not exist on disk.

## Failure and recovery
<!-- lw:anchors packages/core/src/import-resolution.ts#expandWorkspaceGlob packages/core/src/import-resolution.ts#hasPackageManifest packages/core/src/manifest.ts#buildManifest packages/core/src/manifest.ts#computeSnapshotHash packages/core/src/navigation.ts#buildDisplayTitleFallbacks packages/core/src/navigation.ts#buildNavigateBlock -->

The supplied source confirms several defensive branches inside the documented slice. `packages/core/src/import-resolution.ts#expandWorkspaceGlob` falls back to the conservative branch when a workspace package is ambiguous, and the supplied excerpt does not establish exhaustive recovery behaviour beyond that conservative path. `hasPackageManifest` short-circuits when the directory is missing a package manifest rather than throwing, so the indexer keeps walking the rest of the tree.

`packages/core/src/manifest.ts#buildManifest` calls `writeManifestIfChanged` so `computeSnapshotHash` short-circuits manifest rewrites on no-op cycles; the supplied excerpt does not show a separate rollback path. `packages/core/src/navigation.ts#buildDisplayTitleFallbacks` returns a `Map` keyed by module id, and `buildNavigateBlock` consumes the same map; if a module is missing from the fallback table the navigation block falls back to the raw module id rather than failing.

The supplied excerpt is truncated, so exhaustive failure-mode coverage (for example the exact circuit-breaker threshold and the response when `expandWorkspaceGlob` yields zero packages) is not visible here.

## Related pages

- [How it works](index.md)
- [cli-src](../cli-src.md)
- [commands](../commands.md)
- [core-src-01](../core-src-01.md)
- [core-src-03](../core-src-03.md)
- [core-src-02](../core-src-02.md)
- [core-src-05](../core-src-05.md)
- [core-src-06](../core-src-06.md)
- [core-src-07](../core-src-07.md)