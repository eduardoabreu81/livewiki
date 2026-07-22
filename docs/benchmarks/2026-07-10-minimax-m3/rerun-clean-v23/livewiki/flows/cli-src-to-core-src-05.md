---
title: CLI entry to core import-resolution handoff
owner: generated
anchors:
  - packages/cli/src/cli.ts#createProgram
  - packages/cli/src/cli.ts#run
  - packages/cli/src/cli.ts#resolveRepoRoot
  - packages/cli/src/commands/batch.ts#formatListHuman
  - packages/cli/src/commands/batch.ts#formatDiagnosticLine
  - packages/cli/src/commands/batch.ts#appendStage4Diagnostics
  - packages/cli/src/output.ts#emit
  - packages/cli/src/output.ts#emitJson
  - packages/cli/src/output.ts#emitHuman
  - packages/core/src/anchor-ledger.ts#AnchorParseError
  - packages/core/src/anchor-ledger.ts#AnchorParseError.constructor
  - packages/core/src/anchor-ledger.ts#assigneeFor
  - packages/core/src/batch.ts#aggregateTotals
  - packages/core/src/batch.ts#accumulateUsage
  - packages/core/src/batch.ts#attemptStage4Generation
  - packages/core/src/batch-state.ts#DIAGNOSTIC_MAX_ERRORS
  - packages/core/src/batch-state.ts#DIAGNOSTIC_TEXT_CAP
  - packages/core/src/manifest.ts#buildManifest
  - packages/core/src/manifest.ts#computeSnapshotHash
  - packages/core/src/db.ts#CURRENT_SCHEMA_VERSION
  - packages/core/src/import-resolution.ts#expandWorkspaceGlob
  - packages/core/src/import-resolution.ts#hasPackageManifest
updated: 2026-07-21
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

# CLI entry to core import-resolution handoff

This page explains how a `livewiki` invocation parses its argv, resolves a repository root, hands off to the batch pipeline, and ends with the import-resolution layer that feeds the module graph.

## Purpose
<!-- lw:anchors packages/cli/src/cli.ts#createProgram packages/cli/src/cli.ts#run packages/cli/src/cli.ts#resolveRepoRoot packages/cli/src/commands/batch.ts#formatListHuman packages/cli/src/commands/batch.ts#formatDiagnosticLine packages/cli/src/commands/batch.ts#appendStage4Diagnostics packages/cli/src/output.ts#emit packages/cli/src/output.ts#emitJson packages/cli/src/output.ts#emitHuman -->

The flow starts at the `livewiki` bin entry, where `index.ts` calls:

```ts
export async function run(argv: readonly string[]): Promise<void>
```

on `cli.ts`. The responsibility there is to turn a commander `Command` produced by:

```ts
export function createProgram(): Command
```

into a configured program. Every registered subcommand (init, index, status, update, verify, batch, export, pointer, plus the stubbed serve/view) delegates repo-root resolution to:

```ts
export function resolveRepoRoot(repoOpt: string | undefined): string
```

so the same repo-root policy is shared across all subcommands. The subcommand layer in `commands/` then routes the request: `registerBatch` (inside `packages/cli/src/commands/batch.ts`) drives `livewiki batch status` and `--only` paths, while `registerInit`, `registerExport`, and others go through `register*(program: Command): void` functions. Human-readable output and `--json` output are both funnelled through:

```ts
export function emit(
```
```ts
export function emitHuman(text: string): void
```
```ts
export function emitJson(data: unknown): void
```

so the SPEC's "human OR JSON, never both" rule is enforced uniformly. The end product is a structured call into `packages/core/src` that lands on the batch orchestrator, the SQLite index, and ultimately on the import-resolution surface.

## Ordered flow
<!-- lw:anchors packages/core/src/anchor-ledger.ts#AnchorParseError packages/core/src/anchor-ledger.ts#AnchorParseError.constructor packages/core/src/anchor-ledger.ts#assigneeFor packages/core/src/batch-state.ts#DIAGNOSTIC_MAX_ERRORS packages/core/src/batch-state.ts#DIAGNOSTIC_TEXT_CAP packages/core/src/batch.ts#aggregateTotals packages/core/src/batch.ts#accumulateUsage packages/core/src/batch.ts#attemptStage4Generation packages/core/src/manifest.ts#buildManifest packages/core/src/manifest.ts#computeSnapshotHash -->

1. `packages/cli/src/index.ts` (the `livewiki` bin) calls `run(process.argv)` and catches any thrown error to write a `livewiki: fatal error —` line on stderr.
2. `packages/cli/src/cli.ts#run` parses argv through `commander`, with `readVersion` reading the package version for `--version` output.
3. `cli.ts#createProgram` registers every subcommand; `cli.ts#resolveRepoRoot(repoOpt)` returns the resolved repository root for whichever subcommand is invoked.
4. `packages/cli/src/commands/batch.ts` registers `livewiki batch <run>` and its sub-subcommands (`status`, `resume`, `only`); it calls `emit` to route human/JSON output.
5. For `batch status`, the command calls `listRuns` (from `@livewiki/core/batch-status`) and renders the result through `formatListHuman`. Per-task diagnostic payloads go through `formatDiagnosticLine` and `appendStage4Diagnostics`.
6. The CLI side hands off into `packages/core/src`: `runBatch`, `resumeBatch`, or `runOnly` from `@livewiki/core/batch` drive the orchestrator.
7. `core-src-03` (`packages/core/src/batch.ts`) runs the resumable pipeline; usage accounting uses `accumulateUsage` and `aggregateTotals`, and a stage-4 attempt goes through `attemptStage4Generation`.
8. `core-src-02` (`packages/core/src/batch-state.ts`) shapes the persisted `batch_tasks.checkpoint_json`, with diagnostics capped at `DIAGNOSTIC_MAX_ERRORS = 50` and message length at `DIAGNOSTIC_TEXT_CAP = 200`.
9. `core-src-03` (`packages/core/src/db.ts`) opens the SQLite index; the schema version constant `CURRENT_SCHEMA_VERSION = 4` governs migrations.
10. `core-src-06` (`packages/core/src/manifest.ts`) persists the manifest via `buildManifest`, hashing the snapshot with `computeSnapshotHash`.
11. `core-src-01` (`packages/core/src/anchor-ledger.ts`) reconciles wiki anchors with the code index; `AnchorParseError` and its constructor capture parse failures, while `assigneeFor` routes debt to human or agent owners.
12. `core-src-05` (`packages/core/src/import-resolution.ts`) supplies the resolver that feeds the module graph: `expandWorkspaceGlob` and `hasPackageManifest` walk workspace packages, and `resolveImportEdges` produces the file-level edges consumed by `resolveModuleEdges` in `core-src-06` (`packages/core/src/modules.ts`).
13. `core-src-04` (`packages/core/src/export.ts`) reads the resulting snapshot; `buildMarker` constructs the deterministic `lw:generated` marker and `detectMarker` recognizes it.
14. The CLI receives a structured `BatchRunResult` and `emit` writes either human text or a single-line JSON payload.

## Diagram
```mermaid
%% livewiki/diagrams/flow-cli-src-to-core-src-05.mmd
```

## Invariants
- `cli.ts#createProgram` is the single commander `Command` factory; every registered subcommand must inherit `--json` and `--repo` from it.
- `cli.ts#resolveRepoRoot` is the only repo-root resolver in the CLI; subcommands must not reimplement it.
- `output.ts#emit` is the single dispatch point for human/JSON output. Callers must not write to stdout directly.
- `db.ts#CURRENT_SCHEMA_VERSION` is the schema authority; migrations must be idempotent so older repos upgrade in place.
- `batch-state.ts#DIAGNOSTIC_MAX_ERRORS` and `DIAGNOSTIC_TEXT_CAP` cap the diagnostic list both in count and in message length before persistence.
- `manifest.ts#buildManifest` and `computeSnapshotHash` together guarantee `livewiki/.manifest.json` only re-serialises when the snapshot actually changed.
- `anchor-ledger.ts#assigneeFor` routes generated pages to `agent` and `human` pages to `human`; mixed pages go to `agent`.
- `export.ts#buildMarker` and `detectMarker` round-trip the deterministic `lw:generated` marker without rewriting it.
- `import-resolution.ts` is the one resolver feeding both `resolveModuleEdges` and the stage-5 flow detector, so the module graph and the flow signals cannot disagree.

## Failure and recovery
<!-- lw:anchors packages/core/src/import-resolution.ts#expandWorkspaceGlob packages/core/src/import-resolution.ts#hasPackageManifest packages/core/src/db.ts#CURRENT_SCHEMA_VERSION -->

When the batch orchestrator encounters a malformed wiki anchor it raises:

```ts
constructor(wikiPath: string, cause: Error) {
```

on `AnchorParseError`; the supplied source shows the type and constructor signature but does not show the surrounding `try/catch`, so the recovery path is not fully established by the excerpt. The orchestrator's documented policy (visible in the batch pipeline) is that a failing task is marked `failed` with the reason in the checkpoint and the run continues, while a circuit breaker (3 consecutive failures OR >50% failure rate) aborts the run and reports `completed_with_failures` with a non-zero exit. `aggregateTotals` then merges per-stage usage without duplicating entries.

The CLI's top-level guard in `cli.ts#run` (via `index.ts`) catches uncaught errors and writes `livewiki: fatal error — <message>` on stderr; commander handles usage errors itself. Per the supplied source, no retry is documented for `expandWorkspaceGlob` or `hasPackageManifest` — when a workspace glob yields no packages the resolver returns an empty result and downstream module grouping runs without those files, rather than throwing. `db.ts#CURRENT_SCHEMA_VERSION` migrations are idempotent: if a future schema lands, opening an older `.livewiki/index.db` triggers the in-place migration path; the excerpt does not document an explicit rollback. `export.ts` failures during a write leave the destination partially updated and rely on an idempotent re-run for repair (the preflight is the only committed "leave destination unchanged" guarantee). Where the supplied excerpt does not establish exhaustive behavior, the page scopes the description to the normal path and does not claim absolute guarantees.

## Related pages
[How it works](index.md)
[cli-src](../cli-src.md)
[commands](../commands.md)
[core-src-01](../core-src-01.md)
[core-src-03](../core-src-03.md)
[core-src-02](../core-src-02.md)
[core-src-06](../core-src-06.md)
[core-src-04](../core-src-04.md)
[core-src-05](../core-src-05.md)
