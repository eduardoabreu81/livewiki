---
title: CLI startup through core import resolution — entry to first sink
owner: generated
anchors:
  - packages/cli/src/cli.ts#createProgram
  - packages/cli/src/cli.ts#readVersion
  - packages/cli/src/cli.ts#resolveRepoRoot
  - packages/cli/src/cli.ts#run
  - packages/cli/src/output.ts#emit
  - packages/cli/src/commands/batch.ts#formatListHuman
  - packages/core/src/batch-state.ts#DIAGNOSTIC_MAX_ERRORS
  - packages/core/src/db.ts#CURRENT_SCHEMA_VERSION
  - packages/core/src/manifest.ts#buildManifest
  - packages/core/src/manifest.ts#computeSnapshotHash
  - packages/core/src/import-resolution.ts#expandWorkspaceGlob
  - packages/core/src/import-resolution.ts#hasPackageManifest
  - packages/core/src/export.ts#buildMarker
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

# CLI startup through core import resolution — entry to first sink

This page explains how a `livewiki` invocation leaves the package boundary, is shaped into a commander `Command`, resolves the target repository, and hands off into `@livewiki/core` modules that own the manifest, the SQLite index, and the strict import resolver.

## Purpose
<!-- lw:anchors packages/cli/src/cli.ts#createProgram packages/cli/src/cli.ts#readVersion packages/cli/src/cli.ts#resolveRepoRoot packages/cli/src/cli.ts#run -->

The flow begins when a user runs the `livewiki` binary; the process forwards `process.argv` to `run`, which builds the top-level commander program and registers every subcommand. The CLI must read its version from `@livewiki/cli`'s own `package.json`, resolve the repository root from the optional `--repo` flag, and produce a stable handoff into the core modules so that downstream stages (manifest, index, import resolution) start from a known-good state.

```ts
export function createProgram(): Command {
```

```ts
function readVersion(): string {
```

```ts
export function resolveRepoRoot(repoOpt: string | undefined): string {
```

```ts
export async function run(argv: readonly string[]): Promise<void> {
```

The four entry symbols above are the only boundary that `packages/cli/src` exposes to the user shell; everything else in the flow sits behind them.

## Ordered flow
<!-- lw:anchors packages/cli/src/output.ts#emit packages/core/src/batch-state.ts#DIAGNOSTIC_MAX_ERRORS packages/core/src/db.ts#CURRENT_SCHEMA_VERSION packages/core/src/manifest.ts#buildManifest packages/core/src/manifest.ts#computeSnapshotHash -->

1. The shebang entry `packages/cli/src/index.ts` forwards `process.argv` into `run`; any uncaught error is written to `process.stderr` as `livewiki: fatal error — <message>` so the CLI never silently exits non-zero.
2. `run` calls `createProgram` to build a fresh commander `Command` named `livewiki`, then calls `readVersion` to pull the version field from `@livewiki/cli`'s `package.json` and `program.version(...)` it onto the program.
3. `run` walks the per-command `registerX` modules under `packages/cli/src/commands/` (`init`, `index`, `status`, `update`, `verify`, `serve`, `batch`, `export`, `view`, `pointer`) and wires each one's action handler into the program.
4. Commander resolves the chosen subcommand and the shared `--json` / `--repo` global flags; the action handler calls `resolveRepoRoot(repoOpt)` to materialize an absolute `repoRoot`, defaulting to `process.cwd()` when `--repo` is omitted.
5. The action handler calls into the corresponding `@livewiki/core/*` operation (e.g. `runInit`, `runBatch`, `runIndexer`, `runVerify`); structured results return through the command's `emit` helper, which routes either `emitJson` (one JSON object + newline) or `emitHuman` (multi-line plain text).
6. Batch reporting helpers aggregate run totals and diagnostics under the cap constants defined for the `batch_tasks.checkpoint_json` shape: `DIAGNOSTIC_MAX_ERRORS = 50` rows and the per-line text length cap kept in the same module.
7. `buildManifest` materializes the `.livewiki/.manifest.json` handoff with `version`, `lastDocumentedCommit`, `updatedAt`, and `pendingBatch` fields; `computeSnapshotHash` computes the sha256 of `livewiki/` excluding the manifest itself so CI runs are idempotent and the manifest is only rewritten when content actually changes.
8. The persistence sink `openIndex` opens the SQLite index at `.livewiki/index.db` and stamps `CURRENT_SCHEMA_VERSION = 4` into the `meta` table on first open so old clients can detect drift.
9. The import-resolution sink then asks `expandWorkspaceGlob(absRoot, glob)` to enumerate workspace packages and `hasPackageManifest(absRoot, dir)` to decide whether a directory is a package boundary; the resulting `ResolvedImportEdge` set feeds both `resolveModuleEdges` (stage 2) and the stage-5 flow detector.

## Diagram

```mermaid
%% livewiki/diagrams/flow-cli-src-to-core-src-05.mmd
```

## Invariants

- `createProgram()` must always return a commander `Command` whose `.name()` is `"livewiki"`; the smoke test in `cli.test.ts` pins this contract.
- `readVersion()` must read from `@livewiki/cli`'s own `package.json`, never from the host repo's manifest; otherwise version reporting becomes repo-dependent.
- `resolveRepoRoot(repoOpt)` is the single source of the absolute `repoRoot` for every downstream stage; subcommands never call `process.cwd()` directly.
- All CLI output passes through `emit`; `emitJson` writes exactly one JSON value followed by a newline, and `emitHuman` appends a newline only when the text does not already end in one — the source for both is visible in `packages/cli/src/output.ts`.
- The SQLite index stamped by `CURRENT_SCHEMA_VERSION = 4` is treated as derived state; deleting `.livewiki/` is recoverable via a fresh `livewiki index` run.
- `buildManifest` is only allowed to rewrite `.livewiki/.manifest.json` when `computeSnapshotHash` reports a different sha256 than the stored `snapshotHash`, preventing CI write loops.
- The import-resolution sink produces a single canonical `ResolvedImportEdge` shape consumed by both `resolveModuleEdges` and the stage-5 flow detector, so the module graph and flow signals cannot disagree about which file an import landed in.
- `export.ts#buildMarker` decorates generated export files with a stable marker; `export.ts#detectMarker` is the only sanctioned way to recognize a generated file downstream.

## Failure and recovery
<!-- lw:anchors packages/cli/src/commands/batch.ts#formatListHuman packages/core/src/import-resolution.ts#expandWorkspaceGlob packages/core/src/import-resolution.ts#hasPackageManifest packages/core/src/export.ts#buildMarker -->

The supplied source makes several recovery paths explicit and the rest of the failure surface is documented as absent here. The `run` entry funnels uncaught errors through `process.stderr.write("livewiki: fatal error — ...")` and a non-zero exit code, so a throw inside any subcommand never produces a silent zero exit. The CLI also wraps `formatListHuman` and other batch reporters so a failed run still prints a `completed_with_failures` summary with a copy-pasteable retry command rather than aborting without diagnostics. `hasPackageManifest` and `expandWorkspaceGlob` are fail-closed when the workspace cannot be enumerated: `resolveImportEdges` skips unresolved specifiers rather than guessing, and downstream stages therefore receive a smaller but well-typed edge set. The `export` stage applies a safe-io preflight before any write and refuses to overwrite an existing destination without `--force`; `buildMarker` then tags generated files so a stale file can be recognized and removed on the next idempotent run. The excerpt does not establish retry semantics for `readVersion`, `resolveRepoRoot` itself, or for `computeSnapshotHash`; treat those as single-shot on the normal path.

## Related pages

- [cli-src](../cli-src.md)
- [commands](../commands.md)
- [core-src-01](../core-src-01.md)
- [core-src-03](../core-src-03.md)
- [core-src-02](../core-src-02.md)
- [core-src-06](../core-src-06.md)
- [core-src-04](../core-src-04.md)
- [core-src-05](../core-src-05.md)
- [How it works](index.md)