---
title: CLI scaffold through init orchestration — command surface, output formatting, batch diagnostics, anchor ledger, batch state, manifest and import resolution
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
  - packages/core/src/batch-state.ts#DIAGNOSTIC_MAX_ERRORS
  - packages/core/src/batch-state.ts#DIAGNOSTIC_TEXT_CAP
  - packages/core/src/batch-state.ts#summarizeDiagnosticErrors
  - packages/core/src/batch.ts#accumulateUsage
  - packages/core/src/batch.ts#aggregateTotals
  - packages/core/src/db.ts#CURRENT_SCHEMA_VERSION
  - packages/core/src/export.ts#buildMarker
  - packages/core/src/export.ts#detectMarker
  - packages/core/src/manifest.ts#buildManifest
  - packages/core/src/manifest.ts#computeSnapshotHash
  - packages/core/src/import-resolution.ts#expandWorkspaceGlob
  - packages/core/src/import-resolution.ts#hasPackageManifest
updated: 2026-07-21
modules:
  - cli-src
  - commands
  - core-src-01
  - core-src-02
  - core-src-03
  - core-src-04
  - core-src-06
  - core-src-05
---

# CLI scaffold through init orchestration

This page explains how a `livewiki` invocation enters through the CLI surface, is dispatched to the `init` orchestrator, and during that walk touches the output helpers, batch diagnostic surfacing, the anchor ledger (with its parse-error boundary), the batch-state diagnostic caps, the SQLite index schema, the export marker builders, the manifest persistence layer, and the import-resolution glob expansion used by the workspace map.

## Purpose
<!-- lw:anchors packages/cli/src/cli.ts#createProgram packages/cli/src/cli.ts#readVersion packages/cli/src/cli.ts#resolveRepoRoot packages/cli/src/cli.ts#run -->

The end-to-end flow starts when the user runs the `livewiki` binary; `run` invokes `createProgram`, which builds a `commander` `Command` named `livewiki` whose version is sourced from the package manifest via `readVersion`. Each registered subcommand calls `resolveRepoRoot` to canonicalize the `--repo` argument before delegating to the matching `registerX` in `commands/` (notably `init` and `batch`), producing a documented repository snapshot under `.livewiki/` along with a persisted manifest. `emit` from `output.ts` writes either human or JSON output to stdout so the same command satisfies the SPEC requirement of producing both shapes from a single dispatch.

## Ordered flow
<!-- lw:anchors packages/cli/src/output.ts#emit packages/cli/src/output.ts#emitHuman packages/cli/src/output.ts#emitJson packages/cli/src/commands/batch.ts#formatListHuman packages/core/src/db.ts#CURRENT_SCHEMA_VERSION packages/core/src/import-resolution.ts#expandWorkspaceGlob packages/core/src/import-resolution.ts#hasPackageManifest -->

1. `run(argv)` parses the command line through the `commander` program built by `createProgram`, with `readVersion` supplying the `--version` value from `@livewiki/cli`'s package manifest.
2. `resolveRepoRoot` resolves the `--repo` flag to an absolute path before any handler runs; subcommands call it from inside `commands/*.ts`.
3. Each `registerX` (e.g. `registerInit`, `registerBatch`) attaches a subcommand to the shared `Command`; the `init` handler ultimately calls `runInit` from `@livewiki/core/init`.
4. `runInit` walks the repo, calls the indexer to populate the SQLite index opened with `openIndex`, whose schema version is pinned by `CURRENT_SCHEMA_VERSION = 4`.
5. While resolving module edges, `runInit` reaches into `import-resolution.ts` and asks `expandWorkspaceGlob` to enumerate workspace package directories; for each candidate it uses `hasPackageManifest` to confirm a `package.json` is present before adding it to the workspace map.
6. Once modules and their edges are known, `runInit` lays out `livewiki/`, generates auxiliary pages, and emits the diagram files; the manifest is then written via `buildManifest`, with `computeSnapshotHash` fingerprinting the `livewiki/` tree excluding the manifest itself.
7. Output is funneled through `emit`, which delegates to `emitHuman` (multi-line plain text) or `emitJson` (single-line JSON with a trailing newline) based on the `--json` flag inherited from the parent program.
8. For `livewiki batch <run>`, the registered handler reuses `resolveRepoRoot` and `emit`, then calls `runBatch`/`resumeBatch`/`runOnly` from `@livewiki/core/batch`; the `batch status` subcommand uses `formatListHuman` to render run history and `formatDiagnosticLine` to surface per-task errors.

## Diagram

```mermaid
%% livewiki/diagrams/flow-cli-src-to-core-src-05.mmd
```

## Invariants

- `createProgram` is the only construction site for the root `Command`; every subcommand inherits `--json` and `--repo` so `emit` and `resolveRepoRoot` behave consistently across the surface.
- `readVersion` reads the version string at module-load time from `@livewiki/cli`'s package manifest — `--version` is therefore deterministic relative to the installed package and does not require a repo to exist.
- `emit` is the single stdout writer: human output goes through `emitHuman` (multi-line, plain) and JSON output through `emitJson` (one line, trailing newline), guaranteeing that JSON parsing on stdout is safe line-by-line.
- The SQLite index opened during `runInit` (and by `batch-status`) always reflects `CURRENT_SCHEMA_VERSION`; migrations keep `meta.schema_version` aligned so the index can be deleted and rebuilt without losing correctness.
- `expandWorkspaceGlob` and `hasPackageManifest` together define the workspace map: a directory is treated as a workspace package iff its absolute path is returned by the glob expansion AND `hasPackageManifest(absRoot, dir)` returns true. The flow detector's per-occurrence external accounting and the module graph both consume the same `ResolvedImportEdge` stream, so they cannot disagree about where an import resolved.
- `buildManifest` and `computeSnapshotHash` produce a manifest whose `snapshotHash` deliberately excludes the manifest file itself, preventing CI loops where writing the manifest would change the hash and trigger another write.
- `formatListHuman` and `formatDiagnosticLine` render against `summarizeDiagnosticErrors`, which is bounded by `DIAGNOSTIC_MAX_ERRORS` (50) and per-message `DIAGNOSTIC_TEXT_CAP` (200); the human formatters therefore never blow up on pathological stage-4 outputs.

## Failure and recovery
<!-- lw:anchors packages/cli/src/commands/batch.ts#appendStage4Diagnostics packages/cli/src/commands/batch.ts#formatDiagnosticLine packages/core/src/anchor-ledger.ts#AnchorParseError packages/core/src/anchor-ledger.ts#AnchorParseError.constructor packages/core/src/anchor-ledger.ts#assigneeFor packages/core/src/batch-state.ts#DIAGNOSTIC_MAX_ERRORS packages/core/src/batch-state.ts#DIAGNOSTIC_TEXT_CAP packages/core/src/batch-state.ts#summarizeDiagnosticErrors packages/core/src/batch.ts#accumulateUsage packages/core/src/batch.ts#aggregateTotals packages/core/src/export.ts#buildMarker packages/core/src/export.ts#detectMarker packages/core/src/manifest.ts#buildManifest packages/core/src/manifest.ts#computeSnapshotHash -->

The CLI surface never calls `process.exit(1)` from inside an action handler; instead, the action handler catches errors and writes them to stderr then sets `process.exitCode = 1`. The only place a fatal `process.exit` happens is in `packages/cli/src/index.ts`, where `run(process.argv).catch(...)` writes `livewiki: fatal error — <message>` to stderr and exits non-zero — this path is the last-resort recovery when no subcommand handler caught the error itself.

When `runInit` is invoked, malformed or absent `package.json` files in candidate workspace directories are filtered out by `hasPackageManifest`, so an unparseable manifest cannot enter the workspace map; `expandWorkspaceGlob` itself just enumerates path candidates and does not interpret the package contents.

For batch diagnostics, `appendStage4Diagnostics` is invoked per task; its per-message length is bounded by `DIAGNOSTIC_TEXT_CAP` and the per-task count by `DIAGNOSTIC_MAX_ERRORS` via `summarizeDiagnosticErrors`. The supplied source does not show an explicit "drop on overflow" branch, but the caps make overflow impossible by construction (entries beyond the cap are never added). `formatDiagnosticLine` then renders the surviving diagnostics for the human reporter, while `accumulateUsage` folds per-attempt `StageUsage` into the running total and `aggregateTotals` combines two such totals — both helpers are pure functions of their inputs and do not throw on empty usage objects.

When the anchor-ledger walks a wiki page and hits a malformed anchor line, it throws `AnchorParseError` (constructor signature: `constructor(wikiPath: string, cause: Error)`); the ledger's caller is expected to surface this through `assigneeFor(owner, inManualBlock)` so the resulting debt row is attributed to the appropriate owner. The supplied source does not show a specific catch site for `AnchorParseError`, so the excerpt does not establish exhaustive recovery behavior — pages with unparseable anchors may halt the ledger for that page until the source is fixed.

Export-time marker management uses `buildMarker(sourceRel)` to construct the exact generated marker and `detectMarker(text)` to locate it inside an existing file; the `export.test.ts` source notes that a preflight failure leaves the destination tree unchanged (no partial-write recovery beyond an idempotent rerun), and an unforeseen filesystem failure during write or removal may leave the export partially updated — exit is 1 in that case and a rerun is the documented recovery.

For the manifest, `buildManifest` and `computeSnapshotHash` are pure helpers; the IO side (`writeManifestIfChanged`) only writes when the hash changed, so a failed write leaves the previous manifest on disk and the next successful invocation can retry without producing a divergent snapshot.

## Related pages

- [cli-src](../cli-src.md)
- [commands](../commands.md)
- [core-src-01](../core-src-01.md)
- [core-src-02](../core-src-02.md)
- [core-src-03](../core-src-03.md)
- [core-src-04](../core-src-04.md)
- [core-src-06](../core-src-06.md)
- [core-src-05](../core-src-05.md)
- [How it works](index.md)