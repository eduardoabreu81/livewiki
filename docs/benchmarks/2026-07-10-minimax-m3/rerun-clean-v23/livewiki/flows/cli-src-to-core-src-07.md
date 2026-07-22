---
title: CLI entry to navigation rendering across core-src modules
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

# CLI entry to navigation rendering across core-src modules

This page explains how a single `livewiki` invocation propagates from the commander program built in `cli-src` through the `commands` adapters, into the orchestrator and persistence layer in `core-src-03`/`core-src-02`, then through module identification (`core-src-05`), manifest persistence (`core-src-06`), and finally to navigation hub rendering in `core-src-07`.

## Purpose
<!-- lw:anchors packages/cli/src/cli.ts#createProgram packages/cli/src/cli.ts#readVersion packages/cli/src/cli.ts#resolveRepoRoot packages/cli/src/cli.ts#run packages/cli/src/output.ts#emit packages/cli/src/output.ts#emitHuman packages/cli/src/output.ts#emitJson -->

The CLI bin (`packages/cli/src/index.ts`) hands `process.argv` to `run`, which delegates program construction to:

```ts
export function createProgram(): Command {
```

The version string is read from the package's own `package.json` by:

```ts
function readVersion(): string {
```

before the root path is normalized through:

```ts
export function resolveRepoRoot(repoOpt: string | undefined): string {
```

Every subcommand ultimately serializes output through:

```ts
export function emit(
```

which dispatches to:

```ts
export function emitHuman(text: string): void {
export function emitJson(data: unknown): void {
```

so that a single `--json` switch flips the whole CLI between structured and human forms. The flow's purpose is to turn that argv into a persisted `.livewiki/index.db`, a written `.livewiki/.manifest.json`, and a rendered navigation hub that lists every module page.

## Ordered flow
<!-- lw:anchors packages/core/src/anchor-ledger.ts#AnchorParseError packages/core/src/anchor-ledger.ts#AnchorParseError.constructor packages/core/src/anchor-ledger.ts#assigneeFor packages/core/src/batch-state.ts#DIAGNOSTIC_MAX_ERRORS packages/core/src/batch-state.ts#DIAGNOSTIC_TEXT_CAP packages/core/src/batch.ts#accumulateUsage packages/core/src/batch.ts#aggregateTotals packages/core/src/batch.ts#attemptStage4Generation packages/core/src/import-resolution.ts#expandWorkspaceGlob packages/core/src/import-resolution.ts#hasPackageManifest packages/core/src/db.ts#CURRENT_SCHEMA_VERSION packages/core/src/manifest.ts#buildManifest packages/core/src/manifest.ts#computeSnapshotHash packages/core/src/navigation.ts#buildDisplayTitleFallbacks packages/core/src/navigation.ts#buildNavigateBlock -->

1. The bin (`packages/cli/src/index.ts`) imports `run` from `./cli.js` and calls `run(process.argv)`. `run` calls `createProgram()` to build a commander `Command`, attaches every subcommand, and dispatches the matched one.
2. The matched subcommand (for example `batch`) calls `resolveRepoRoot(repoOpt)` so the orchestrator and the persistence layer operate on a concrete path inside the safe-IO boundary.
3. The command's action (`registerBatch` and friends) routes into the `core` module that owns that phase: `runBatch`/`resumeBatch`/`runOnly` for batch, `runIndexer` + `runLedger` for index, `runStatus`/`runInit`/`runVerify`/`exportWiki` for the others. Output is funneled through `emit` → `emitHuman`/`emitJson`.
4. Inside `runBatch`, stage 2 fans out per-module tasks. Module identification uses import edges resolved by:

```ts
async function expandWorkspaceGlob(absRoot: string, glob: string): Promise<string[]> {
async function hasPackageManifest(absRoot: string, dir: string): Promise<boolean> {
```

so a workspace glob is expanded against the manifest file presence test. The resulting graph feeds the LLM refine step (or the deterministic fallback).
5. Stage 4 generation is attempted per task by:

```ts
async function attemptStage4Generation(
```

within a circuit breaker. Per-attempt usage is folded by:

```ts
function accumulateUsage(
function aggregateTotals(a: StageUsage, b: StageUsage): StageUsage {
```

into the run totals. Diagnostic lists surfaced back to the CLI are capped by `export const DIAGNOSTIC_MAX_ERRORS = 50;` and `export const DIAGNOSTIC_TEXT_CAP = 200;` before persistence.
6. When an anchor marker is malformed, `anchor-ledger.ts` throws:

```ts
export class AnchorParseError extends Error {
  constructor(wikiPath: string, cause: Error) {
```

and the ledger calls:

```ts
function assigneeFor(owner: Owner, inManualBlock: boolean): Assignee {
```

to attribute the resulting debt row to either the agent or a human owner. `verify` surfaces these as `AnchorParseError`-typed debt rows.
7. Persisted state is stored under `export const CURRENT_SCHEMA_VERSION = 4;` in `.livewiki/index.db`. `db.openIndex` runs idempotent migrations; older repositories upgrade in place.
8. Stage 6 writes the manifest through:

```ts
export function buildManifest(args: {
export async function computeSnapshotHash(repoRoot: string): Promise<string> {
```

to `livewiki/.manifest.json`; `writeManifestIfChanged` skips the rewrite when the snapshot hash is unchanged (anti-loop in CI).
9. Navigation rendering walks module presentations and writes `livewiki/flows/index.md` plus per-module `## Related pages` blocks via:

```ts
export function buildDisplayTitleFallbacks(modules: Module[]): Map<string, string> {
function buildNavigateBlock(
```

so the CLI's `status` / `verify` / `batch status` outputs and the on-disk wiki agree on every title.

## Diagram

```mermaid
%% livewiki/diagrams/flow-cli-src-to-core-src-07.mmd
```

## Invariants

- Every CLI subcommand dispatches through `emit` (which fans out to `emitHuman` / `emitJson`), so `--json` is the single switch that flips the whole CLI between the two output forms.
- `run` always resolves the repo root via `resolveRepoRoot` before any command action reads or writes inside `livewiki/` or `.livewiki/`; subcommands that need a concrete path call it themselves rather than relying on a global.
- `db.openIndex` opens (or creates) `.livewiki/index.db` and writes `CURRENT_SCHEMA_VERSION = 4` into `meta` on first open; subsequent opens run idempotent migrations, so older repositories upgrade in place without data loss.
- Diagnostic lists surfaced by the CLI are capped: at most `DIAGNOSTIC_MAX_ERRORS = 50` entries, each truncated to `DIAGNOSTIC_TEXT_CAP = 200` characters before persistence, so a runaway failure cannot bloat the report.
- Anchor reconciliation never overwrites a `lw:manual` block: `assigneeFor` returns a human-assigned row when the anchor lives inside a manual block, otherwise an agent-assigned row.
- `writeManifestIfChanged` only rewrites `.livewiki/.manifest.json` when the snapshot hash produced by `computeSnapshotHash` changes, which keeps CI from looping on a stable doc tree.
- `buildDisplayTitleFallbacks` produces a `Map<moduleId, fallbackTitle>` that `buildNavigateBlock` consumes; the per-module `## Related pages` block therefore lists the same set of modules the navigation hub does.

## Failure and recovery
<!-- lw:anchors packages/cli/src/commands/batch.ts#appendStage4Diagnostics packages/cli/src/commands/batch.ts#formatDiagnosticLine packages/cli/src/commands/batch.ts#formatListHuman -->

When a stage-4 attempt fails, the orchestrator marks the task `failed` with the diagnostic reason in the checkpoint and continues — the circuit breaker only aborts the run after 3 consecutive failures or a >50% failure rate. Per-attempt usage is still folded by `accumulateUsage` and `aggregateTotals`, so the final `BatchStatusReport` reflects every retry's tokens and cost. Recoverable repair codes (`flow_diagram_too_large`, `invalid_flow_diagram`, `anchor_in_disallowed_section`, `anchor_missing_in_required_section`, `anchor_missing_required_tier`) trigger one prompt-only repair attempt; codes the mechanical last-slot fallback does not support return `null` rather than risk corrupting the artifact. The accumulated diagnostics are then appended through `appendStage4Diagnostics`, formatted by `formatDiagnosticLine`, and the run list rendered for humans by `formatListHuman` so the CLI surfaces a bounded retry-ready report rather than an unbounded stack trace. The supplied excerpt does not establish the exhaustive set of retry codes, only the ones visible in the source.

When `anchor-ledger.ts` encounters a malformed marker, it throws `AnchorParseError` via its `constructor(wikiPath, cause)` so the caller can attach the wiki path and the underlying parser error; the ledger then routes the resulting debt row through `assigneeFor`, which returns a human-owned row when the anchor lives inside a manual block (preserving the inviolable rule that the agent never rewrites human content). For non-manual markers, `assigneeFor` returns the agent-owned row so a subsequent `livewiki batch` run can re-derive the marker from the code index.

The supplied source does not show any other rollback path for the navigation hub (`buildDisplayTitleFallbacks` / `buildNavigateBlock`); the excerpt shows them only as rendering helpers, so this page does not invent a recovery story for navigation.

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