---
title: cli-src → core-src-04 — export marker contract for stage-5 flows
owner: generated
anchors:
  - packages/cli/src/cli.ts#createProgram
  - packages/cli/src/cli.ts#run
  - packages/cli/src/output.ts#emit
  - packages/core/src/manifest.ts#buildManifest
  - packages/core/src/db.ts#CURRENT_SCHEMA_VERSION
  - packages/core/src/export.ts#buildMarker
  - packages/core/src/export.ts#detectMarker
updated: 2026-07-21
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

# cli-src → core-src-04 — export marker contract for stage-5 flows

This page explains how a `livewiki` command line invocation flows through the CLI surface, the stage-4/5 orchestrator, and the deterministic core subsystems until it reaches the export writer that stamps generated content with a recognizable marker.

## Purpose
<!-- lw:anchors packages/cli/src/cli.ts#createProgram packages/cli/src/cli.ts#run packages/cli/src/output.ts#emit -->

The flow begins when a user runs the `livewiki` binary; `run` builds a `Command` via `createProgram`, and the registered subcommand hands its result to `emit`, which standardises human or `--json` output. The page documents how that CLI invocation ultimately reaches `export.ts`, which writes a generated marker into every flattened file under `.livewiki/export/<target>/`.

```
export function createProgram(): Command {
```

```
export async function run(argv: readonly string[]): Promise<void> {
```

```
export function emit(
```

## Ordered flow
<!-- lw:anchors packages/core/src/manifest.ts#buildManifest packages/core/src/db.ts#CURRENT_SCHEMA_VERSION -->

1. `run` parses `process.argv` and delegates to `createProgram`, which returns the `commander` `Command` with every phase's subcommand registered.
2. The chosen subcommand (typically `export`, `init`, `batch`, or `verify`) resolves the repo root and calls into a `core` package under `@livewiki/core/*`.
3. The core package opens the SQLite index via `db.ts`, whose schema version is pinned by `CURRENT_SCHEMA_VERSION`, ensuring the orchestrator and ledger see a consistent shape.
4. `manifest.ts#buildManifest` reads the current `livewiki/` snapshot, computes its hash, and writes `.livewiki/.manifest.json` for cross-machine handoff.
5. Stage-5 flow candidates detected in `core-src-04/flows.ts` are produced as flow pages alongside the deterministic `structure.mmd` / `modules.mmd` overviews.
6. `export.ts` flattens the `livewiki/` snapshot into `.livewiki/export/<target>/`, prepending `buildMarker` to every generated file and tagging the run as deterministic.
7. `detectMarker` later recognises the same marker on re-export so idempotent runs do not double-tag content.

```
export function buildManifest(args: {
```

```
export const CURRENT_SCHEMA_VERSION = 4;
```

## Diagram

```mermaid
%% livewiki/diagrams/flow-cli-src-to-core-src-04.mmd
```

## Invariants

- The CLI's single `Command` instance, produced by `createProgram`, must remain the only entry point invoked by `run(process.argv)`; every subcommand inherits `--json` and `--repo` from that program.
- `emit` must always be the last step of a subcommand handler so human and JSON output stay byte-stable.
- `CURRENT_SCHEMA_VERSION` defines the schema that the orchestrator, anchor ledger, and stage-5 flow detector all observe; bumping it requires a migration.
- `buildManifest` produces a manifest that always carries `version`, `snapshotHash`, `updatedAt`, and optional `pendingBatch`; the snapshot hash excludes the manifest itself.
- Every file written under `.livewiki/export/<target>/` is prefixed with the output of `buildMarker(sourceRel)`, and `detectMarker(text)` must recognise that prefix on subsequent passes.

## Failure and recovery
<!-- lw:anchors packages/core/src/export.ts#buildMarker packages/core/src/export.ts#detectMarker -->

`export.ts` runs a safe-io preflight against the destination before any write, and a preflight failure leaves the destination tree untouched; the command returns exit 1 in that case. If the destination already contains generated files, `export.ts` refuses to overwrite unless `--force` is supplied, and stale generated files are removed before the new run writes. The supplied source does not establish other recovery paths (e.g., transactional rollback mid-write); the contract documented in `export.ts` is the visible behaviour, and unforeseen filesystem failures may leave the export partially updated, with an idempotent rerun repairing it.

```
function buildMarker(sourceRel: string): string {
```

```
function detectMarker(text: string): string | null {
```

## Related pages

- [How it works](index.md)
- [../cli-src.md](../cli-src.md)
- [../commands.md](../commands.md)
- [../core-src-01.md](../core-src-01.md)
- [../core-src-03.md](../core-src-03.md)
- [../core-src-02.md](../core-src-02.md)
- [../core-src-05.md](../core-src-05.md)
- [../core-src-06.md](../core-src-06.md)
- [../core-src-04.md](../core-src-04.md)
