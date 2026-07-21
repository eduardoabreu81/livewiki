---
title: CLI bootstrap to manifest persistence
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
  - packages/core/src/import-resolution.ts#expandWorkspaceGlob
  - packages/core/src/import-resolution.ts#hasPackageManifest
  - packages/core/src/manifest.ts#buildManifest
  - packages/core/src/manifest.ts#computeSnapshotHash
updated: 2026-07-21
modules:
  - cli-src
  - commands
  - core-src-01
  - core-src-02
  - core-src-03
  - core-src-04
  - core-src-05
  - core-src-06
---

# CLI bootstrap to manifest persistence

This page explains how a `livewiki` invocation progresses from CLI parsing in `cli-src` through subcommand registration and human/JSON output, into the core pipeline that builds the persisted wiki and finally writes the deterministic manifest snapshot under `.livewiki/`.

## Purpose
<!-- lw:anchors packages/cli/src/cli.ts#createProgram packages/cli/src/cli.ts#readVersion packages/cli/src/cli.ts#resolveRepoRoot packages/cli/src/cli.ts#run -->

The flow begins when the user invokes the `livewiki` binary: `packages/cli/src/index.ts` calls `run(process.argv)`, which delegates to `createProgram()` to assemble the `commander` `Command`, registering every subcommand (`init`, `index`, `status`, `update`, `verify`, `serve`, `batch`, `export`, `view`, `pointer`) with shared `--json` and `--repo` flags. `readVersion()` supplies the version string from `@livewiki/cli`'s `package.json`, and `resolveRepoRoot(repoOpt)` turns the `--repo` option into an absolute path that every handler trusts as the workspace root. `run(argv)` is the single bootstrap, with this signature:

```ts
export async function run(argv: readonly string[]): Promise<void>
```

The end state is a persisted `.livewiki/.manifest.json` (via `core-src-06`) that snapshots the wiki tree's contents hash so a follow-up `init` or CI run can decide whether the wiki has changed and must be re-documented.

## Ordered flow
<!-- lw:anchors packages/cli/src/output.ts#emit packages/cli/src/output.ts#emitHuman packages/cli/src/output.ts#emitJson packages/cli/src/commands/batch.ts#appendStage4Diagnostics packages/cli/src/commands/batch.ts#formatDiagnosticLine packages/cli/src/commands/batch.ts#formatListHuman packages/core/src/anchor-ledger.ts#assigneeFor packages/core/src/batch-state.ts#DIAGNOSTIC_MAX_ERRORS packages/core/src/batch-state.ts#DIAGNOSTIC_TEXT_CAP packages/core/src/db.ts#CURRENT_SCHEMA_VERSION packages/core/src/manifest.ts#buildManifest packages/core/src/manifest.ts#computeSnapshotHash -->

1. `index.ts` calls `run(process.argv)`; `run` calls `createProgram()` and parses argv on the `commander` `Command`.
2. Each subcommand handler in `packages/cli/src/commands/` reads `--repo` via `resolveRepoRoot()` and `--json` via the shared options object, then performs its work.
3. Handlers funnel results through `emit` (in `output.ts`), which selects between `emitHuman(text)` (single trailing newline) and `emitJson(data)` (`JSON.stringify` plus newline) so the SPEC contract of "human AND `--json`" is satisfied uniformly.
4. The `batch` handler invokes `runBatch` / `resumeBatch` / `runOnly` from `core-src-03`; checkpoints accumulate stage-4 LLM usage via `accumulateUsage` and `aggregateTotals` (both in `packages/core/src/batch.ts`) and stash per-task `usageHistory` plus `diagnosticHistory` into `batch_tasks.checkpoint_json`.
5. `batch-state.ts` defines `DIAGNOSTIC_MAX_ERRORS = 50` and `DIAGNOSTIC_TEXT_CAP = 200`, the caps enforced by `summarizeDiagnosticErrors` when surfacing stage-4 diagnostics; `appendStage4Diagnostics` and `formatDiagnosticLine` (in `commands/batch.ts`) shape that summary for `batch status` output, and `formatListHuman` renders the run list.
6. Across stage 1–4 the indexer opens the SQLite cache through `openIndex`; `CURRENT_SCHEMA_VERSION = 4` in `packages/core/src/db.ts` is written into `meta.schema_version` so migrations know whether to rebuild. `core-src-04` exports the wiki snapshot to `.livewiki/export/<target>/` via deterministic helpers such as `buildMarker(sourceRel)` and `detectMarker(text)`.
7. `core-src-05` walks the repo, collects imports, runs `expandWorkspaceGlob(absRoot, glob)` and `hasPackageManifest(absRoot, dir)` from `packages/core/src/import-resolution.ts` to resolve workspace specifiers against per-package `tsconfig.json`, and emits module edges.
8. `core-src-01`'s anchor-ledger pipeline (`AnchorParseError`, its `constructor(wikiPath, cause)`, and `assigneeFor(owner, inManualBlock)`) reconciles wiki anchors with the SQLite index and stamps each anchor with a generated-vs-human assignee.
9. `core-src-06` (`packages/core/src/manifest.ts`) finishes the run by calling `buildManifest({ repoRoot, lastDocumentedCommit, pendingBatch })` and, if the new manifest differs from disk, writing it via the safe-io allowlist. The companion `computeSnapshotHash(repoRoot)` hashes `livewiki/` minus the manifest itself, so the snapshot hash is stable under repeated identical runs and `manifest`-only changes never invalidate it.

## Diagram

```mermaid
%% livewiki/diagrams/flow-cli-src-to-core-src-06.mmd
```

## Invariants

- `createProgram()` is the single source of subcommand registration; removing a `registerX` call is the only way to add or drop a CLI command, and `cli.test.ts` fails the build if the registered set drifts.
- `--repo` is always resolved through `resolveRepoRoot` before any handler reads a path; handlers must not re-derive the workspace root.
- Every handler routes its stdout through `emit` / `emitHuman` / `emitJson`; ad-hoc `console.log` would break the SPEC contract of "human AND `--json`" and would not be machine-parseable.
- The SQLite index is a derived cache: `CURRENT_SCHEMA_VERSION` is the only authority for whether the schema is current, and `openIndex` re-creates a fresh DB if `meta.schema_version` is missing or older.
- `computeSnapshotHash` excludes the manifest itself from the digest so writing `.livewiki/.manifest.json` never changes its own `snapshotHash`, preventing an infinite re-write loop in CI.
- Diagnostic history is bounded by `DIAGNOSTIC_MAX_ERRORS` and `DIAGNOSTIC_TEXT_CAP`; the status reporter must surface the trimmed summary via `summarizeDiagnosticErrors` rather than the raw array, so `--json` output stays small.
- Generated anchor owners (`assigneeFor(owner, inManualBlock)`) are computed once during the ledger pass; downstream `verify` checks must not reassign them.

## Failure and recovery
<!-- lw:anchors packages/core/src/anchor-ledger.ts#AnchorParseError packages/core/src/anchor-ledger.ts#AnchorParseError.constructor packages/core/src/batch-state.ts#summarizeDiagnosticErrors packages/core/src/batch.ts#accumulateUsage packages/core/src/batch.ts#aggregateTotals packages/core/src/export.ts#buildMarker packages/core/src/export.ts#detectMarker packages/core/src/import-resolution.ts#expandWorkspaceGlob packages/core/src/import-resolution.ts#hasPackageManifest -->

The `run` bootstrap catches unhandled rejections and writes `livewiki: fatal error — <message>` to stderr, then sets `process.exitCode = 1`; per the `commands` page digest, subcommand handlers translate caught errors into `process.exitCode = 1` after writing to stderr rather than `process.exit(1)`, so async handles on Windows do not trigger libuv asserts. When the anchor-ledger cannot parse a wiki page it constructs `new AnchorParseError(wikiPath, cause)` (signature `constructor(wikiPath: string, cause: Error)`); the thrown error surfaces up to `verify` and `init` which then emit a structured `--json` failure with the offending path and cause chain. Stage-4 diagnostics are accumulated by `appendStage4Diagnostics` and `accumulateUsage`; `summarizeDiagnosticErrors` enforces `DIAGNOSTIC_MAX_ERRORS` and `DIAGNOSTIC_TEXT_CAP`, and `aggregateTotals` keeps per-attempt usage arrays from double-counting across repair rounds. Import resolution failure paths are bounded by `expandWorkspaceGlob` and `hasPackageManifest`: unresolved workspace globs and missing package manifests are reported as structured errors rather than swallowed, and the resolver never invents a file path. The export stage in `core-src-04` uses `buildMarker` / `detectMarker` to verify that a previously generated file is still the livewiki output (so `--force` is the only path to overwrite); an export preflight failure leaves the destination tree untouched. The supplied source excerpt does not show a transactional rollback path for `computeSnapshotHash` itself, and `buildManifest`'s write is idempotent via `writeManifestIfChanged`, so a failed write simply leaves the prior manifest in place for the next run to overwrite; the excerpt does not establish exhaustive behavior beyond that. The batch orchestrator's circuit breaker (3 consecutive task failures or >50% failure rate) aborts the run and leaves `batch_runs.status = 'completed_with_failures'`; this is the only retry boundary visible in the cited source.

## Related pages

- [How it works](index.md)
- [cli-src](../cli-src.md)
- [commands](../commands.md)
- [core-src-01](../core-src-01.md)
- [core-src-02](../core-src-02.md)
- [core-src-03](../core-src-03.md)
- [core-src-04](../core-src-04.md)
- [core-src-05](../core-src-05.md)
- [core-src-06](../core-src-06.md)