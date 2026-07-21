---
title: CLI bootstrap to wiki export (cli-src to core-src-04)
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
  - core-src-02
  - core-src-03
  - core-src-05
  - core-src-06
  - core-src-04
---

# CLI bootstrap to wiki export (cli-src to core-src-04)

This page explains the end-to-end path from a `livewiki` CLI invocation through the orchestrator, ledger, batch state, and manifest persistence to a flattened wiki export tree under `.livewiki/export/<target>/`.

## Purpose
<!-- lw:anchors packages/cli/src/cli.ts#createProgram packages/cli/src/cli.ts#readVersion packages/cli/src/cli.ts#resolveRepoRoot packages/cli/src/cli.ts#run packages/cli/src/output.ts#emit packages/cli/src/output.ts#emitHuman packages/cli/src/output.ts#emitJson -->

The flow starts when the user invokes the `livewiki` binary (via `packages/cli/src/index.ts`, which calls `run(process.argv)`). `createProgram` builds the `commander` program, `readVersion` reads `@livewiki/cli`'s version from its manifest, and `resolveRepoRoot` translates the optional `--repo` flag into an absolute repo root. Each registered subcommand (`batch`, `export`, `init`, etc.) routes its final payload through `emit` from `output.ts`, which dispatches to `emitHuman` for text output or `emitJson` for structured `--json` output. The flow produces two things: a CLI report on stdout (human text or JSON, exactly one trailing newline) and, when the `export` subcommand runs, a flattened snapshot tree at `.livewiki/export/<target>/` that never modifies `livewiki/` itself.

## Ordered flow
<!-- lw:anchors packages/cli/src/commands/batch.ts#appendStage4Diagnostics packages/cli/src/commands/batch.ts#formatDiagnosticLine packages/cli/src/commands/batch.ts#formatListHuman packages/core/src/anchor-ledger.ts#AnchorParseError packages/core/src/anchor-ledger.ts#AnchorParseError.constructor packages/core/src/anchor-ledger.ts#assigneeFor packages/core/src/batch-state.ts#DIAGNOSTIC_MAX_ERRORS packages/core/src/batch-state.ts#DIAGNOSTIC_TEXT_CAP packages/core/src/batch-state.ts#summarizeDiagnosticErrors packages/core/src/batch.ts#accumulateUsage packages/core/src/batch.ts#aggregateTotals packages/core/src/db.ts#CURRENT_SCHEMA_VERSION -->

1. `cli-src` — `index.ts` calls `run(argv)`; `createProgram` registers all subcommands and `readVersion` reads the version string.
2. `cli-src` — `resolveRepoRoot(repoOpt)` converts `--repo` into an absolute path that downstream commands reuse.
3. `commands` — the chosen subcommand handler (e.g. `registerBatch`, `registerExport`) reads its options and calls into `@livewiki/core`.
4. `core-src-05` / `core-src-03` — `imports.ts` collects raw specifiers; `import-resolution.ts` resolves them via `expandWorkspaceGlob` and `hasPackageManifest`; `indexer.run` upserts files and symbols into the SQLite index opened with `CURRENT_SCHEMA_VERSION = 4`.
5. `core-src-01` — `anchor-ledger.ts` syncs wiki anchors against the index. When an anchor fails to parse, it throws `AnchorParseError` via `constructor(wikiPath, cause)`; the ledger uses `assigneeFor(owner, inManualBlock)` to decide human vs. agent ownership.
6. `core-src-02` / `core-src-03` — the batch orchestrator (`batch.ts`) drives stage 4 and stage 5; per-task usage is recorded with `accumulateUsage` and rolled up with `aggregateTotals`.
7. `core-src-02` — diagnostic history is appended with `appendStage4Diagnostics` and capped by `DIAGNOSTIC_MAX_ERRORS = 50` and `DIAGNOSTIC_TEXT_CAP = 200`; `summarizeDiagnosticErrors` produces the per-task summary.
8. `commands` — `batch.ts` formats the result via `formatListHuman`, `formatDiagnosticLine`, and `emit` (which delegates to `emitHuman` / `emitJson`).
9. `core-src-06` — `manifest.ts#buildManifest` and `computeSnapshotHash` persist the `livewiki/.manifest.json` snapshot hash (excluding the manifest itself).
10. `core-src-04` — `export.ts` reads the `livewiki/` snapshot, builds per-file markers via `buildMarker(sourceRel)` and `detectMarker(text)`, and emits a flattened tree under `.livewiki/export/<target>/` without touching the source snapshot.

## Diagram
```mermaid
%% livewiki/diagrams/flow-cli-src-to-core-src-04.mmd
```

## Invariants

- `resolveRepoRoot` must always return a string before any handler body runs; every subcommand depends on it as the first repo anchor.
- The SQLite index is treated as a derived cache; `CURRENT_SCHEMA_VERSION` must stay aligned with `meta.schema_version`, so deleting `.livewiki/` and rebuilding must not lose correctness.
- The orchestrator writes generated pages transactionally (snapshot → write → verify → restore on failure); partial pages must never be observable on disk after a failure.
- Anchor parse failures are isolated to a single page: `AnchorParseError` carries `wikiPath` and `cause`, never crashing the whole ledger run.
- Manual blocks are owned by humans; `assigneeFor(owner, inManualBlock)` resolves to `human` when the anchor sits inside a manual block, even on a page whose `owner` is `generated`.
- The `livewiki/` snapshot is the source of truth; the export tree under `.livewiki/export/<target>/` is a derived artifact and must never modify the source.
- Stage-4 diagnostic history is bounded: at most `DIAGNOSTIC_MAX_ERRORS` errors per task, each trimmed to `DIAGNOSTIC_TEXT_CAP` characters, so the checkpoint JSON stays compact.
- `computeSnapshotHash` deliberately excludes `.manifest.json` itself; rewriting the manifest never changes the hash and therefore cannot trigger a redundant re-write.

## Failure and recovery
<!-- lw:anchors packages/core/src/import-resolution.ts#expandWorkspaceGlob packages/core/src/import-resolution.ts#hasPackageManifest packages/core/src/manifest.ts#buildManifest packages/core/src/manifest.ts#computeSnapshotHash packages/core/src/export.ts#buildMarker packages/core/src/export.ts#detectMarker -->

When `import-resolution.ts` cannot expand a workspace glob or cannot find a package manifest, `expandWorkspaceGlob` / `hasPackageManifest` surface a resolvable error; the CLI routes that to stderr and sets `process.exitCode = 1` rather than calling `process.exit(1)`, avoiding libuv assert crashes on Windows. If `computeSnapshotHash` returns a value that does not match the stored one, `buildManifest` rewrites the manifest idempotently; the snapshot-hash exclusion of the manifest itself prevents a CI write loop. For `livewiki export <target>`, `buildMarker(sourceRel)` stamps each flattened output and `detectMarker(text)` recognises an existing one on a rerun; the export preflight runs before any write — a preflight failure leaves the destination tree unchanged, and an unforeseen mid-write filesystem failure leaves the derived export partially updated and returns exit 1. The documentation explicitly states the contract is not transactional and an idempotent rerun is the recovery path. The supplied source does not establish exhaustive failure and recovery behaviour for every code path in this flow; only the recovery flows named above are visible in the excerpt.

## Related pages

- [cli-src](../cli-src.md)
- [commands](../commands.md)
- [core-src-01](../core-src-01.md)
- [core-src-02](../core-src-02.md)
- [core-src-03](../core-src-03.md)
- [core-src-05](../core-src-05.md)
- [core-src-06](../core-src-06.md)
- [core-src-04](../core-src-04.md)
- [How it works](index.md)