---
title: CLI dispatch to core pipeline stages
owner: generated
anchors:
  - packages/cli/src/cli.ts#createProgram
  - packages/cli/src/cli.ts#run
  - packages/cli/src/commands/batch.ts#formatDiagnosticLine
  - packages/cli/src/commands/batch.ts#appendStage4Diagnostics
  - packages/cli/src/output.ts#emit
  - packages/cli/src/output.ts#emitJson
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

# CLI dispatch to core pipeline stages

This page explains how a `livewiki` invocation moves from the Commander program through the per-command registration modules, into the core orchestrator and its state, manifest, import-resolution, anchor-ledger, and navigation sinks.

## Purpose
<!-- lw:anchors packages/cli/src/cli.ts#createProgram packages/cli/src/cli.ts#run packages/cli/src/output.ts#emit packages/cli/src/output.ts#emitJson -->

The flow starts when a user runs the `livewiki` binary, which calls `run` in `packages/cli/src/cli.ts` after Commander assembles a `Command` instance via `createProgram`. The CLI parses argv, dispatches to the registered subcommand under `packages/cli/src/commands/` (notably `batch`), and the handler eventually delegates to `@livewiki/core/batch` so the orchestrator can drive indexing, module identification, and stage-4 generation. The end product this page explains is the chain of core helpers — usage aggregation, anchor-ledger assignment, manifest writing, import-edge resolution, and navigation rendering — that together turn the staged run into a navigable wiki and a status report.

## Ordered flow
<!-- lw:anchors packages/core/src/batch.ts#accumulateUsage packages/core/src/batch.ts#aggregateTotals packages/core/src/batch.ts#attemptStage4Generation packages/core/src/batch-state.ts#DIAGNOSTIC_MAX_ERRORS packages/core/src/batch-state.ts#DIAGNOSTIC_TEXT_CAP -->

1. `run` calls `createProgram` (Commander) and the matching `register*(program)` under `packages/cli/src/commands/` attaches a subcommand and its action; `resolveRepoRoot` pins the repo root.
2. The `batch` action calls into `@livewiki/core/batch`, which opens the SQLite index opened by `db.ts` (schema version pinned by `CURRENT_SCHEMA_VERSION`) and runs the staged pipeline.
3. Stage 2 uses `import-resolution.ts` to produce resolved import edges: `expandWorkspaceGlob` enumerates workspace packages, `hasPackageManifest` gates `package.json` discovery, and `resolveImportEdges` (consumed by `resolveModuleEdges` in `modules.ts`) feeds the module graph.
4. Stage 4 calls `attemptStage4Generation` per module; each attempt appends bounded diagnostics, and the CLI surface in `commands/batch.ts` exposes `appendStage4Diagnostics` and `formatDiagnosticLine` so callers can summarize stage-4 failures against `DIAGNOSTIC_MAX_ERRORS` (50) and `DIAGNOSTIC_TEXT_CAP` (200).
5. Usage is folded with `accumulateUsage` (per attempt) and `aggregateTotals` (stage + module + run totals); checkpoints land in `batch_tasks.checkpoint_json` per the shape in `batch-state.ts`.
6. The manifest writer (`manifest.ts`) calls `computeSnapshotHash` over `livewiki/` and uses `buildManifest` to emit `.livewiki/.manifest.json` (only file allowed in `.livewiki/`), enabling cross-machine handoff.
7. Stage 5 / page rendering calls `navigation.ts`, where `buildDisplayTitleFallbacks` derives fallback titles and `buildNavigateBlock` assembles per-module navigation; the CLI command emits results via `emit` / `emitJson`.

## Diagram
```mermaid
%% livewiki/diagrams/flow-cli-src-to-core-src-07.mmd
```

## Invariants

- The CLI program is always a Commander instance returned by `createProgram`, and every registered subcommand receives the resolved repo root from `resolveRepoRoot` before it touches the filesystem.
- Per `db.ts`, the SQLite index is opened at the schema version recorded by `CURRENT_SCHEMA_VERSION` (= 4); older schemas must migrate before the batch driver reads rows, otherwise the index is treated as missing and reindexed.
- Stage-4 diagnostic surfacing stays within the caps enforced by `DIAGNOSTIC_MAX_ERRORS` (50) and `DIAGNOSTIC_TEXT_CAP` (200) characters per error; callers MUST NOT bypass these caps when emitting to `commands/batch.ts`.
- `anchor-ledger.ts` reports parse failures through `AnchorParseError` (constructed via `AnchorParseError.constructor` with the offending wiki path and the underlying cause), and `assigneeFor` is the single owner-resolution rule shared by the ledger and the artifact layer.
- Usage accumulation is monotonic: `accumulateUsage` appends each attempt's `usageHistory` entry and `aggregateTotals` is a pure fold across runs; the status report never invents intermediate totals.
- `manifest.ts` is the only writer allowed to place a file inside `.livewiki/` (the manifest itself), and `buildManifest` MUST call `computeSnapshotHash` over `livewiki/` excluding the manifest to avoid the CI rewrite loop.
- `import-resolution.ts` is the single resolver: both the module graph and the stage-5 flow detector consume `ResolvedImportEdge` rows produced from `expandWorkspaceGlob` and `hasPackageManifest`, so signal and graph cannot disagree.
- `navigation.ts` rendering keys (`buildDisplayTitleFallbacks`, `buildNavigateBlock`) are deterministic for the same `Module[]` input; the CLI's `emit` / `emitJson` only format the already-rendered text.

## Failure and recovery
<!-- lw:anchors packages/cli/src/commands/batch.ts#formatDiagnosticLine packages/cli/src/commands/batch.ts#appendStage4Diagnostics packages/core/src/anchor-ledger.ts#AnchorParseError packages/core/src/anchor-ledger.ts#AnchorParseError.constructor packages/core/src/anchor-ledger.ts#assigneeFor packages/core/src/db.ts#CURRENT_SCHEMA_VERSION packages/core/src/import-resolution.ts#expandWorkspaceGlob packages/core/src/import-resolution.ts#hasPackageManifest packages/core/src/manifest.ts#buildManifest packages/core/src/manifest.ts#computeSnapshotHash packages/core/src/navigation.ts#buildDisplayTitleFallbacks packages/core/src/navigation.ts#buildNavigateBlock -->

When a stage-4 attempt fails to produce a valid artifact, `attemptStage4Generation` records a diagnostic into the task checkpoint, and the CLI surface reads it back through `appendStage4Diagnostics` so a single line per error is formatted by `formatDiagnosticLine` against the `DIAGNOSTIC_MAX_ERRORS` / `DIAGNOSTIC_TEXT_CAP` budget. The orchestrator marks the task `failed` with the diagnostic and continues with the next module rather than aborting the run, per the batch recovery policy.

If the ledger encounters a malformed `livewiki/*.md`, it throws `AnchorParseError` constructed via `AnchorParseError.constructor` with the wiki path and the underlying `cause`; callers in the stage-2 sync path treat the throw as a soft failure (the file is skipped, debt rows are still written) so the rest of the index keeps progressing. Owner-assignment fallbacks live inside `assigneeFor`: when `owner` is ambiguous or the symbol sits inside a `<!-- livewiki:manual -->` block, the function resolves to the agent assignee so a downstream `changed` / `moved` debt row can be attributed without blocking on a missing human owner.

For the SQLite index, `openIndex` checks `schema_version` against `CURRENT_SCHEMA_VERSION`; a mismatch triggers an in-place migration via the bundled migrator, and only when migration succeeds does the batch driver reopen the handle — the index is never read at the wrong schema. If `manifest.ts` detects that `computeSnapshotHash` matches the previously persisted hash, `buildManifest` is a no-op via `writeManifestIfChanged`, so a failed CI run that produced no real edits does not loop the manifest writer. `import-resolution.ts` is strict (no guessing): when `expandWorkspaceGlob` finds no workspace `package.json` or `hasPackageManifest` returns `false` for a candidate directory, the resolver emits an unresolved edge with a diagnostic kind instead of throwing, letting stage-2 continue while the flow detector records the unaccounted external.

When `navigation.ts` cannot derive a display title from a module's frontmatter, `buildDisplayTitleFallbacks` produces a slug-derived fallback and `buildNavigateBlock` still emits a valid Markdown block; the resulting page renders without a navigation hole rather than failing the whole render pass. The supplied source does not show a fallback for `run` itself beyond writing to stderr and setting `process.exitCode = 1` — that recovery path is exhausted in the visible excerpt, so this page does not claim a richer recovery contract for uncaught dispatcher errors.

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
