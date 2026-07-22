---
title: CLI invocation through cross-module documentation pipeline
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
  - packages/core/src/batch.ts#attemptStage4Generation
  - packages/core/src/batch-state.ts#DIAGNOSTIC_MAX_ERRORS
  - packages/core/src/batch-state.ts#DIAGNOSTIC_TEXT_CAP
  - packages/core/src/import-resolution.ts#expandWorkspaceGlob
  - packages/core/src/import-resolution.ts#hasPackageManifest
  - packages/core/src/export.ts#buildMarker
  - packages/core/src/export.ts#detectMarker
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

# CLI invocation through cross-module documentation pipeline

This page explains the end-to-end behavior of a `livewiki` CLI invocation as it propagates from the commander program through the command boundary, the persistent SQLite index, the stage-4 artifact pipeline, the batch orchestrator, import resolution, deterministic export, and the manifest writer.

## Purpose
<!-- lw:anchors packages/cli/src/cli.ts#createProgram packages/cli/src/cli.ts#readVersion packages/cli/src/cli.ts#resolveRepoRoot packages/cli/src/cli.ts#run -->

A user runs the published `livewiki` binary; `packages/cli/src/index.ts` forwards `process.argv` into `run`, which is the orchestrator that builds a `Command` via `createProgram` and registers every phase subcommand (`init`, `index`, `status`, `update`, `verify`, `serve`, `batch`, `export`, `view`, `pointer`). `readVersion` reads the version from `@livewiki/cli`'s `package.json` so the program advertises a real version, and `resolveRepoRoot` normalizes `--repo` (or falls back to `process.cwd()`) before any subcommand handler runs. The end product is a populated `.livewiki/` working tree (deterministic without LLM, plus LLM-generated pages when `init --batch` or `batch <run>` completes), a `.livewiki/index.db` SQLite index, a flattened `.livewiki/export/<target>/` snapshot, and a `.livewiki/.manifest.json` handoff that downstream stages can resume across machines.

The boundary between `cli-src` and the `@livewiki/core/*` packages is narrow by design: every `registerX` function in `packages/cli/src/commands/` resolves `--repo` through `resolveRepoRoot`, calls a `core` operation, and routes the structured result through `emit`. The CLI never re-implements core logic — it only adapts commander options to function arguments and adapts structured results back to either human-readable text or a single-line JSON-with-newline payload.

## Ordered flow
<!-- lw:anchors packages/cli/src/output.ts#emit packages/cli/src/output.ts#emitHuman packages/cli/src/output.ts#emitJson packages/cli/src/commands/batch.ts#formatDiagnosticLine packages/cli/src/commands/batch.ts#formatListHuman packages/core/src/anchor-ledger.ts#assigneeFor packages/core/src/anchor-ledger.ts#AnchorParseError packages/core/src/anchor-ledger.ts#AnchorParseError.constructor -->

1. `packages/cli/src/index.ts` calls `run(process.argv)`; any unhandled error is written to `stderr` as `livewiki: fatal error — <message>` and exits non-zero.
2. `run` calls `createProgram` to build the commander `Command` (name `livewiki`), wires global flags `--json` and `--repo`, and registers every subcommand through its `registerX` helper.
3. `readVersion` is consulted during program construction so `--version` reports the real `package.json` version string of `@livewiki/cli`.
4. Commander parses argv; the chosen subcommand's action handler resolves the working repo root via `resolveRepoRoot(repoOpt)`.
5. The subcommand's action handler invokes a `core` operation (`runInit`, `runIndexer`, `runLedger`, `runVerify`, `runBatch`, `exportWiki`, etc.) with the structured inputs.
6. The handler routes the structured result through `emit` from `packages/cli/src/output.ts`: when `--json` is set, `emitJson` writes one JSON line with a trailing newline (safe for `JSON.parse` line-by-line); otherwise `emitHuman` writes a multi-line human block via the per-command formatter (`formatHuman`, `formatStatusHuman`, `formatListHuman`, `formatDiagnosticLine`).
7. The core side opens (or reuses) `.livewiki/index.db`; `openIndex` reads `meta.schema_version` and, if the on-disk value is less than `CURRENT_SCHEMA_VERSION`, runs the registered migrations.
8. The indexer walks the repo under the configured `ignores`, hashes files (`sha256`), parses TypeScript/JavaScript/Python with tree-sitter, and upserts `files`, `symbols`, and (in later phases) the module/edge tables.
9. `import-resolution` resolves every imported specifier into a `ResolvedImportEdge`; `expandWorkspaceGlob` enumerates workspace packages and `hasPackageManifest` decides whether a directory hosts a `package.json` that contributes to the workspace graph.
10. The batch orchestrator loads config, validates that `provider`/`model` are present (else `MissingProviderConfigError`), and walks modules through the four pipeline stages; for stage 4 it invokes `attemptStage4Generation`, accumulates per-attempt usage via `accumulateUsage`, and aggregates stage totals via `aggregateTotals`.
11. The anchor-ledger reconciles page anchors against the indexed symbols, generating `debt` rows; when the source page cannot be parsed, `AnchorParseError`'s constructor is called with the wiki path and the underlying cause, and `assigneeFor` decides who owns the resulting debt row based on the page's `owner` and whether the symbol sits inside a manual block.
12. The status surface caps diagnostic history (`DIAGNOSTIC_MAX_ERRORS = 50`, `DIAGNOSTIC_TEXT_CAP = 200`) and `appendStage4Diagnostics` appends stage-4 diagnostic lines via `formatDiagnosticLine`; `formatListHuman` produces the human report of runs.
13. The deterministic export layer reads `livewiki/`, rewrites links/fragments, decorates each generated file with a marker built by `buildMarker` and validated by `detectMarker`, and writes the flattened tree to `.livewiki/export/<target>/`.
14. `buildManifest` assembles `.livewiki/.manifest.json` and `computeSnapshotHash` hashes the snapshot of `livewiki/` (excluding the manifest itself); the manifest is only rewritten when the snapshot hash changes (OpenWiki convention, anti-loop in CI).
15. The program exits with the subcommand's reported code (zero on success, non-zero on failures such as verify errors, circuit-breaker abort, or preflight failure during export).

## Diagram

```mermaid
%% livewiki/diagrams/flow-cli-src-to-core-src-06.mmd
```

## Invariants

- `cli-src` never reaches into `core` internals beyond the documented public exports; every action handler resolves `--repo` through `resolveRepoRoot` before calling a core operation.
- `CURRENT_SCHEMA_VERSION` is bumped as the inventory grows; `openIndex` applies registered migrations when the on-disk `meta.schema_version` is older, and the CLI never bypasses this when opening the index for a run.
- `emit` is the single sink for CLI output: one JSON line with a trailing newline under `--json`, otherwise a multi-line human block; both branches append exactly one terminator (`emitHuman` writes `text + "\n"` when the input lacks a trailing newline; `emitJson` always appends `"\n"`).
- The batch orchestrator records every LLM attempt via `accumulateUsage` (no silent drops) and aggregates stage totals via `aggregateTotals`; `attemptStage4Generation` is the only call site that may invoke a stage-4 generation.
- `DIAGNOSTIC_MAX_ERRORS` (50) caps the diagnostic-history length and `DIAGNOSTIC_TEXT_CAP` (200) caps per-line length, so the report stays bounded regardless of run size; `appendStage4Diagnostics` is the only writer of the stage-4 portion.
- Anchor debt is attributed by `assigneeFor`, with `AnchorParseError` reserved for the case where a wiki page cannot be parsed at all — the constructor carries the wiki path and the underlying cause so the caller can attribute the failure.
- `expandWorkspaceGlob` and `hasPackageManifest` together define the strict workspace-package resolver used by both the module graph and the stage-5 flow detector; they never diverge because there is exactly one resolver.
- `buildMarker` and `detectMarker` are the only writers/readers of the generated-file marker; a missing marker on an export file is a contract violation that the export command fails closed on.
- `buildManifest` rewrites `.livewiki/.manifest.json` only when `computeSnapshotHash` reports a changed snapshot; CI loops stay free of redundant commits.

## Failure and recovery
<!-- lw:anchors packages/cli/src/commands/batch.ts#appendStage4Diagnostics packages/core/src/batch.ts#attemptStage4Generation packages/core/src/batch-state.ts#DIAGNOSTIC_MAX_ERRORS packages/core/src/batch-state.ts#DIAGNOSTIC_TEXT_CAP packages/core/src/import-resolution.ts#expandWorkspaceGlob packages/core/src/import-resolution.ts#hasPackageManifest packages/core/src/export.ts#buildMarker packages/core/src/export.ts#detectMarker packages/core/src/manifest.ts#buildManifest packages/core/src/manifest.ts#computeSnapshotHash -->

The supplied source makes several recovery paths visible. `attemptStage4Generation` is wrapped by the bounded corrective-repair loop: the initial call plus two repair attempts are allowed before the task is recorded as failed and the snapshot is rolled back; recovery happens via the snapshot → write → verify → restore/remove transactional gate described in `core-src-03`. A failed task marks `failed` with the reason in the checkpoint and the run continues unless the circuit breaker fires (three consecutive failures or greater than 50% task failure rate), in which case the orchestrator aborts the run and the status surfaces it as `completed_with_failures` with a non-zero exit.

`AnchorParseError`'s constructor (`constructor(wikiPath: string, cause: Error)`) is the explicit failure surface when a page's frontmatter or anchor block cannot be parsed; callers receive the wiki path and the underlying cause so the failure can be attributed to the right page without leaking details that don't help recovery.

Diagnostics are bounded: `appendStage4Diagnostics` truncates history to `DIAGNOSTIC_MAX_ERRORS` (50 entries) and trims individual lines to `DIAGNOSTIC_TEXT_CAP` (200 characters); the report keeps the most recent entries, so recovery from a flooded diagnostic stream is just a rerun with the same checkpoint.

Import resolution fails closed: `expandWorkspaceGlob` and `hasPackageManifest` never guess when a specifier cannot be resolved, and the module graph simply omits the edge — a flow detector that walks an unresolved edge would fail the cross-module reconciliation, so the resolver's strict mode is the deliberate recovery boundary. The supplied excerpts do not establish a retry path for an unresolvable workspace package.

Export preflight runs before any write; a preflight failure leaves `.livewiki/export/<target>/` unchanged and the command exits non-zero, with a second run repairing state idempotently. `buildMarker` decorates every generated file and `detectMarker` validates them; a missing marker causes export to fail closed, and `--force` is the explicit override that bypasses overwrite refusal.

`buildManifest` only writes when `computeSnapshotHash` reports a change, so a no-op rerun is a no-op on disk; a manifest that diverges from the snapshot is repaired on the next successful run.

The supplied source does not establish exhaustive behavior for every failure branch (notably the exact retry policy around `attemptStage4Generation`'s repair budget when the second response is structurally valid but contains invented keys, and the per-subcommand behavior for non-batch commands beyond what their action handlers explicitly throw); the excerpts above describe only the paths visible in the cited source.

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
