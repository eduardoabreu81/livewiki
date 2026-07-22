---
title: CLI dispatch into core pipeline (export and flow-sink landing)
owner: generated
anchors:
  - packages/cli/src/cli.ts#createProgram
  - packages/cli/src/cli.ts#run
  - packages/cli/src/cli.ts#resolveRepoRoot
  - packages/cli/src/output.ts#emit
  - packages/cli/src/commands/batch.ts#formatListHuman
  - packages/core/src/anchor-ledger.ts#AnchorParseError
  - packages/core/src/batch.ts#accumulateUsage
  - packages/core/src/batch.ts#attemptStage4Generation
  - packages/core/src/batch-state.ts#DIAGNOSTIC_MAX_ERRORS
  - packages/core/src/db.ts#CURRENT_SCHEMA_VERSION
  - packages/core/src/import-resolution.ts#expandWorkspaceGlob
  - packages/core/src/manifest.ts#computeSnapshotHash
  - packages/core/src/export.ts#detectMarker
  - packages/core/src/export.ts#buildMarker
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

# CLI dispatch into core pipeline (export and flow-sink landing)

This page explains the end-to-end path by which a `livewiki` invocation enters the CLI program, fans out into the per-command registration modules, drives the core batch/export pipeline, and lands generated content under the export sink guarded by a generated-content marker.

## Purpose
<!-- lw:anchors packages/cli/src/cli.ts#createProgram packages/cli/src/cli.ts#run packages/cli/src/cli.ts#resolveRepoRoot -->

The flow starts when `livewiki` is launched: `packages/cli/src/index.ts` calls

```ts
export async function run(argv: readonly string[]): Promise<void> {
```

inside `cli.ts`, which itself sits behind `createProgram()` — declared as

```ts
export function createProgram(): Command {
```

```ts
export function resolveRepoRoot(repoOpt: string | undefined): string {
```

resolves the repository root from the per-command `--repo` flag before any core orchestration runs, anchoring every downstream call to the same on-disk location. Output is funneled through `packages/cli/src/output.ts#emit`, which routes either to a JSON line or to human text based on the program's `--json` flag, ensuring every core result reaches the user through one consistent formatter surface.

## Ordered flow
<!-- lw:anchors packages/cli/src/output.ts#emit packages/cli/src/commands/batch.ts#formatListHuman packages/core/src/batch.ts#accumulateUsage packages/core/src/batch-state.ts#DIAGNOSTIC_MAX_ERRORS packages/core/src/db.ts#CURRENT_SCHEMA_VERSION packages/core/src/import-resolution.ts#expandWorkspaceGlob packages/core/src/manifest.ts#computeSnapshotHash -->

1. The `livewiki` binary loads `packages/cli/src/index.ts`, which calls `run(argv)` from `packages/cli/src/cli.ts`; uncaught exceptions land in stderr and yield a fatal exit code.
2. `cli.ts` assembles the program: `createProgram()` imports each per-command registration module from `packages/cli/src/commands/` (`init`, `index-cmd`, `status`, `update`, `verify`, `serve`, `batch`, `export`, `view`, `pointer`) and attaches them in registration order.
3. Commander dispatches the chosen subcommand. Each handler uses `resolveRepoRoot(options.repo)` to compute the absolute repo root before invoking the corresponding core orchestrator.
4. For `init --batch` and `batch run`, `packages/core/src/batch.ts` runs the batch loop. `accumulateUsage` (`packages/core/src/batch.ts#accumulateUsage`) folds each `usageHistory` entry into per-stage totals, and stage-4 generation is wrapped in `attemptStage4Generation` (`packages/core/src/batch.ts#attemptStage4Generation`) so that a single bad LLM response can retry without losing the whole run.
5. During batch state persistence, the checkpoint serializer in `packages/core/src/batch-state.ts` caps diagnostic lines via the constant `export const DIAGNOSTIC_MAX_ERRORS = 50;` from `packages/core/src/batch-state.ts#DIAGNOSTIC_MAX_ERRORS` so the persisted `checkpoint_json` stays bounded.
6. Concurrent index access flows through `packages/core/src/db.ts`, which gates writes behind `export const CURRENT_SCHEMA_VERSION = 4;` (from `packages/core/src/db.ts#CURRENT_SCHEMA_VERSION`); mismatched versions refuse to open rather than silently migrating stale data.
7. The module graph is built by `packages/core/src/import-resolution.ts`. The symbol `expandWorkspaceGlob` (`packages/core/src/import-resolution.ts#expandWorkspaceGlob`) lists workspace package roots before the resolver stitches import specifiers to repo-relative files, keeping the batch's module identities stable.
8. The manifest is computed and written by `packages/core/src/manifest.ts`. `computeSnapshotHash` (`packages/core/src/manifest.ts#computeSnapshotHash`) hashes the contents of `livewiki/` excluding the manifest itself, producing the value the pipeline uses to decide whether the snapshot changed between runs.
9. Once the snapshot is final, the CLI ships it to the export stage. `packages/cli/src/commands/export.ts` delegates to `packages/core/src/export.ts`. `detectMarker` (signature `function detectMarker(text: string): string | null {`) reads any pre-existing generated-content marker; `buildMarker` (signature `function buildMarker(sourceRel: string): string {`) constructs the canonical marker the exporter stamps on every rewritten page so later runs can detect drift.
10. Output reaches the user through `emit`. For the `batch` command, `formatListHuman` (`packages/cli/src/commands/batch.ts#formatListHuman`) renders per-run rows for the human form; JSON mode goes through the same `emit` dispatch.

## Diagram
```mermaid
%% livewiki/diagrams/flow-cli-src-to-core-src-04.mmd
```

## Invariants

- Every subcommand registration leaves through `resolveRepoRoot` before any core call, so repo-bound writes never touch a path outside the user-named root.
- Stage-4 attempts are bounded by `attemptStage4Generation`; a single failure rolls the inner attempt, not the run.
- Persisted diagnostic history is bounded by `DIAGNOSTIC_MAX_ERRORS` and the related `DIAGNOSTIC_TEXT_CAP` so `checkpoint_json` stays within the schema budget.
- The SQLite index only accepts clients matching `CURRENT_SCHEMA_VERSION`; older or newer versions are refused at open time, leaving the snapshot cache coherent.
- The export tree never writes into `livewiki/` and is marked with the canonical output of `buildMarker` so subsequent runs can call `detectMarker` against either side.
- The CLI's `--json` flag is the single switch between `emitHuman` and `emitJson`, so every command produces either human text or a single JSON line — never both.

## Failure and recovery
<!-- lw:anchors packages/core/src/anchor-ledger.ts#AnchorParseError packages/core/src/batch.ts#attemptStage4Generation packages/core/src/export.ts#detectMarker packages/core/src/export.ts#buildMarker -->

Each command handler wraps its core call in a `try`/`catch`; the catch writes to stderr and sets `process.exitCode = 1` rather than calling `process.exit(1)`, so the event loop drains even on Windows before the non-zero exit surfaces. The boundary key `packages/cli/src/cli.ts#run` is the safety net above every per-command registration: any rejection that escapes a handler is caught here, formatted as `livewiki: fatal error — <message>`, and the process exits non-zero. Anchor parsing failures surface as `AnchorParseError` (declared as `export class AnchorParseError extends Error {`) raised from the ledger pipeline, which the batch runner records into the failing task's checkpoint while the surrounding run continues; the rest of the batch is unaffected and the failed task can be retried with `livewiki batch --only`. Stage-4 failures are localized inside `attemptStage4Generation`, which can retry the generation slot; if every attempt is exhausted, the task is marked failed and the orchestrator moves on. Export preflight failures (collision, broken links, missing diagram) leave the destination tree unchanged and return exit 1; if a partial write does occur, an idempotent rerun re-detects existing files via `detectMarker` and only refreshes what changed. The supplied source excerpt does not establish the full retry policy for export write errors beyond the idempotent rerun guarantee visible in `packages/core/src/export.ts`.

## Related pages

- [cli-src](../cli-src.md)
- [commands](../commands.md)
- [core-src-01](../core-src-01.md)
- [core-src-03](../core-src-03.md)
- [core-src-02](../core-src-02.md)
- [core-src-05](../core-src-05.md)
- [core-src-06](../core-src-06.md)
- [core-src-04](../core-src-04.md)
- [How it works](index.md)