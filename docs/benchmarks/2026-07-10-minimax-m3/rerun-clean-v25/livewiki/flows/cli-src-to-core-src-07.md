---
title: cli-src to core-src-07 — Command invocation through navigation hub emission
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
  - packages/core/src/batch.ts#accumulateUsage
  - packages/core/src/batch.ts#aggregateTotals
  - packages/core/src/batch.ts#attemptStage4Generation
  - packages/core/src/db.ts#CURRENT_SCHEMA_VERSION
  - packages/core/src/import-resolution.ts#expandWorkspaceGlob
  - packages/core/src/import-resolution.ts#hasPackageManifest
  - packages/core/src/manifest.ts#buildManifest
  - packages/core/src/manifest.ts#computeSnapshotHash
  - packages/core/src/navigation.ts#buildDisplayTitleFallbacks
  - packages/core/src/navigation.ts#buildNavigateBlock
updated: 2026-07-21
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

# cli-src to core-src-07 — Command invocation through navigation hub emission

This page explains how a `livewiki` CLI invocation propagates through the commander program, output formatters, batch orchestration, deterministic artifact pipeline, persisted index, import resolution, manifest IO, and navigation hub generation until the terminal user sees a structured JSON line or a human-readable report.

## Purpose
<!-- lw:anchors packages/cli/src/cli.ts#createProgram packages/cli/src/cli.ts#readVersion packages/cli/src/cli.ts#resolveRepoRoot packages/cli/src/cli.ts#run -->

The flow begins when `index.ts` forwards `process.argv` to `run`, which calls `createProgram` to assemble the commander `Command` tree. Each subcommand action handler resolves `--repo` via `resolveRepoRoot` and reads the livewiki version through `readVersion`. The program produces a single observable terminal artifact — either a one-line JSON document or a multi-line human report — emitted through `emit`/`emitHuman`/`emitJson`. The walk ends with navigation metadata (`buildDisplayTitleFallbacks`, `buildNavigateBlock`) shaping hub pages that the terminal user can navigate.

## Ordered flow
<!-- lw:anchors packages/cli/src/commands/batch.ts#appendStage4Diagnostics packages/cli/src/commands/batch.ts#formatDiagnosticLine packages/cli/src/commands/batch.ts#formatListHuman packages/core/src/batch-state.ts#DIAGNOSTIC_MAX_ERRORS packages/core/src/batch-state.ts#DIAGNOSTIC_TEXT_CAP packages/core/src/batch.ts#accumulateUsage packages/core/src/batch.ts#aggregateTotals packages/core/src/batch.ts#attemptStage4Generation packages/core/src/db.ts#CURRENT_SCHEMA_VERSION packages/core/src/import-resolution.ts#expandWorkspaceGlob packages/core/src/import-resolution.ts#hasPackageManifest packages/core/src/manifest.ts#buildManifest packages/core/src/manifest.ts#computeSnapshotHash -->

1. `run(argv)` in `cli.ts` constructs the commander program via `createProgram`, attaching global `--json` and `--repo` flags and registering every phase's subcommand (`init`, `index`, `status`, `update`, `verify`, `serve`, `batch`, `export`, `view`, `pointer`).
2. The chosen subcommand action (e.g. `batch.ts`, `init.ts`, `export.ts`) calls `resolveRepoRoot`, then invokes a `@livewiki/core` operation such as `runBatch`, `runInit`, `exportWiki`, `insertPointer`, or `runIndexer`.
3. Output shaping routes through `commands/batch.ts` helpers: `formatListHuman` renders run lists, `formatDiagnosticLine` and `appendStage4Diagnostics` cap diagnostics at `DIAGNOSTIC_MAX_ERRORS = 50` rows with `DIAGNOSTIC_TEXT_CAP = 200` chars, before delegating to `emit`.
4. `batch.ts` orchestrates the resumable run: it loads `.livewiki/config.json`, opens the SQLite index at `CURRENT_SCHEMA_VERSION = 4`, walks modules, and records usage per call via `accumulateUsage` and `aggregateTotals`.
5. For each module task, `attemptStage4Generation` calls the LLM, normalizes and validates the Markdown artifact, applies bounded mechanical repair, then transactionalizes the write (snapshot → write → verify → restore/remove).
6. The indexer and import pipeline under `core-src-05` extract imports via tree-sitter and resolve them with `import-resolution.ts`: `expandWorkspaceGlob` expands workspace globs, `hasPackageManifest` detects package roots, and `resolveImportEdges` produces the `ResolvedImportEdge` shape consumed by the module graph and stage-5 flow detector.
7. `manifest.ts` writes `.livewiki/.manifest.json`: `buildManifest` composes the snapshot (last documented commit, pending batch pointer) and `computeSnapshotHash` hashes `livewiki/` excluding the manifest itself to break CI loops.
8. `navigation.ts` reads the resulting `livewiki/` tree: `buildDisplayTitleFallbacks` derives deterministic display titles for modules, and `buildNavigateBlock` writes the "How it works" hub block that points at sibling flow and module pages.
9. The chosen subcommand returns its result through `emit`, which serializes JSON via `emitJson` (one line + newline) or writes human text via `emitHuman`, exiting with the appropriate code.

## Diagram

```mermaid
%% livewiki/diagrams/flow-cli-src-to-core-src-07.mmd
```

## Invariants

- Every CLI invocation exits through `emit`/`emitHuman`/`emitJson`, so stdout is either a single JSON line terminated by `\n` or a multi-line human document — never both interleaved.
- `CURRENT_SCHEMA_VERSION = 4` is the contract between `db.ts` and every consumer that opens `<repoRoot>/.livewiki/index.db`; bumping it triggers the schema-version gate in `openIndex`.
- Stage-4 artifacts are repaired mechanically only for a bounded code set; `flowDiagramPlaceholder`, `anchor_in_disallowed_section`, `anchor_missing_in_required_section`, and `anchor_missing_required_tier` are deliberately fail-closed and stay repairable by prompt only.
- `assigneeFor(owner, inManualBlock)` assigns `human` to a manual block owner and `agent` to a generated owner — page-level mixed ownership routes the generated portion to `agent` (the generated part wins per the inviolable rule captured in `anchor-ledger.ts`).
- `buildManifest` always embeds `pendingBatch` (or `null`) so a partial run can be resumed across machines; `computeSnapshotHash` excludes the manifest file itself to keep the hash stable.
- `AnchorParseError` (constructed via `constructor(wikiPath, cause)`) is the only thrown path for malformed anchor ranges — never a bare `Error` from `anchor-ledger.ts`.

## Failure and recovery
<!-- lw:anchors packages/cli/src/output.ts#emit packages/cli/src/output.ts#emitHuman packages/cli/src/output.ts#emitJson packages/core/src/anchor-ledger.ts#AnchorParseError packages/core/src/anchor-ledger.ts#AnchorParseError.constructor packages/core/src/anchor-ledger.ts#assigneeFor packages/core/src/navigation.ts#buildDisplayTitleFallbacks packages/core/src/navigation.ts#buildNavigateBlock -->

When a subcommand action throws, `index.ts`'s `.catch` writes a `livewiki: fatal error — <message>` line to stderr and lets Node drain before exiting non-zero — so a thrown exception is always visible and the process never silently exits 0. Inside `batch.ts`, a failed task is recorded as `failed` with the reason on its checkpoint, and the orchestrator continues until the circuit breaker (3 consecutive failures or >50% failure rate) aborts the run with status `completed_with_failures`; the report then lists each failed module with the literal `livewiki batch resume <runId>` command the user can paste. `AnchorParseError` thrown by `anchor-ledger.ts` (constructed via `AnchorParseError.constructor(wikiPath, cause)`) bubbles up to the CLI's `catch` and is surfaced verbatim — there is no swallow-and-continue path in the supplied source. The supplied excerpt for the navigation stage does not visibly establish a failure branch for `buildDisplayTitleFallbacks` or `buildNavigateBlock`, so this page scopes navigation behavior to the normal path and does not claim recovery semantics beyond what the source shows.

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
