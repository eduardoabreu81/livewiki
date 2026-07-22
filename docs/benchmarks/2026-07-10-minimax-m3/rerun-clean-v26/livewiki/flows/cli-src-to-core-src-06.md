---
title: CLI scaffold through batch pipeline to manifest persistence
owner: generated
anchors:
  - packages/cli/src/cli.ts#createProgram
  - packages/cli/src/cli.ts#run
  - packages/cli/src/cli.ts#resolveRepoRoot
  - packages/cli/src/output.ts#emit
  - packages/cli/src/commands/batch.ts#formatListHuman
  - packages/core/src/anchor-ledger.ts#AnchorParseError
  - packages/core/src/batch-state.ts#DIAGNOSTIC_MAX_ERRORS
  - packages/core/src/batch.ts#attemptStage4Generation
  - packages/core/src/batch.ts#aggregateTotals
  - packages/core/src/db.ts#CURRENT_SCHEMA_VERSION
  - packages/core/src/import-resolution.ts#expandWorkspaceGlob
  - packages/core/src/export.ts#detectMarker
  - packages/core/src/manifest.ts#buildManifest
  - packages/core/src/manifest.ts#computeSnapshotHash
updated: 2026-07-22
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

# CLI scaffold through batch pipeline to manifest persistence

This page explains how a `livewiki` invocation flows from the commander program through argument resolution, the batch orchestration layer, artifact generation, import resolution, flow detection, and finally into the on-disk manifest that records the snapshot hash.

## Purpose
<!-- lw:anchors packages/cli/src/cli.ts#createProgram packages/cli/src/cli.ts#run packages/cli/src/cli.ts#resolveRepoRoot -->

The CLI starts with a commander `Command` produced by `export function createProgram(): Command {` in `packages/cli/src/cli.ts`. That program receives argv via `export async function run(argv: readonly string[]): Promise<void> {`, which resolves a repository root through `export function resolveRepoRoot(repoOpt: string | undefined): string {`. The flow produces a fully populated `.livewiki/.manifest.json` written by `export function buildManifest(args: {` in `manifest.ts` together with a fresh snapshot hash from `export async function computeSnapshotHash(repoRoot: string): Promise<string> {`. A registered batch subcommand invokes the four-stage documentation pipeline (`runBatch`, `resumeBatch`, `runOnly`) and ends by emitting either human-formatted status or `--json` output through the shared helper.

## Ordered flow
<!-- lw:anchors packages/cli/src/output.ts#emit packages/cli/src/commands/batch.ts#formatListHuman packages/core/src/batch-state.ts#DIAGNOSTIC_MAX_ERRORS packages/core/src/batch.ts#attemptStage4Generation packages/core/src/batch.ts#aggregateTotals packages/core/src/db.ts#CURRENT_SCHEMA_VERSION packages/core/src/import-resolution.ts#expandWorkspaceGlob packages/core/src/export.ts#detectMarker -->

1. `createProgram` wires every subcommand handler (init, index, status, update, verify, serve, batch, export, view, pointer) onto the root commander program.
2. `run` receives argv and delegates to the matched subcommand; `resolveRepoRoot` validates and normalises the `--repo` option before any disk read.
3. The batch command handler resolves the repo, then calls `runBatch` / `resumeBatch` / `runOnly` from `@livewiki/core/batch`.
4. The orchestrator opens the SQLite index with `export const CURRENT_SCHEMA_VERSION = 4;` enforced as the schema header, walks imports, and produces a module graph via `import-resolution.ts`.
5. `async function expandWorkspaceGlob(absRoot: string, glob: string): Promise<string[]> {` enumerates workspace packages exactly once so both the module graph and the stage-5 flow detector consume a single source of truth.
6. Stage 4 runs `async function attemptStage4Generation(`, normalising and validating the artifact; on failure the checkpoint records diagnostic lines up to `export const DIAGNOSTIC_MAX_ERRORS = 50;` entries.
7. Per-task usage is folded with `function aggregateTotals(a: StageUsage, b: StageUsage): StageUsage {`, and per-run totals are summarised; the status surface calls `function formatListHuman(runs: Awaited<ReturnType<typeof listRuns>>): string {` for the human output mode.
8. The shared `export function emit(` helper dispatches to `emitHuman` (plain text) or `emitJson` (single-line JSON with trailing newline). On the export side, `function detectMarker(text: string): string | null {` is the single function that recognises the generated-marker sentinel on flow pages.
9. Once the run completes, `buildManifest` assembles `version`, `lastDocumentedCommit`, `updatedAt`, and `pendingBatch`, then `computeSnapshotHash` fingerprints the `livewiki/` tree (excluding the manifest itself).
10. `writeManifestIfChanged` rewrites `.livewiki/.manifest.json` only when the new content actually differs, closing the loop without forcing an unconditional write.

## Diagram
```mermaid
%% livewiki/diagrams/flow-cli-src-to-core-src-06.mmd
```

## Invariants

- The SQLite index always reflects `CURRENT_SCHEMA_VERSION = 4`; any older DB opens triggers the v2→v3 or v3→v4 migration path, and the manifest is treated as derived (it is regenerated from `livewiki/`, not authoritative).
- Anchor parsing is fail-loud: malformed frontmatter or section markers raise `AnchorParseError` (constructed via `constructor(wikiPath: string, cause: Error) {`) so the batch never silently accepts garbage anchors.
- Import resolution stays a single resolver: `expandWorkspaceGlob` enumerates workspace packages exactly once, and both the module graph and the stage-5 flow detector consume those edges so they cannot disagree.
- `detectMarker` is the only function that recognises the generated-marker sentinel on flow pages; no other component invents or rewrites that sentinel.
- `buildManifest` always writes `version`, `lastDocumentedCommit`, `updatedAt`, `pendingBatch`, and `snapshotHash`; `computeSnapshotHash` hashes only the `livewiki/` tree and skips `.manifest.json` so the manifest cannot self-loop.

## Failure and recovery
<!-- lw:anchors packages/core/src/anchor-ledger.ts#AnchorParseError packages/core/src/manifest.ts#buildManifest packages/core/src/manifest.ts#computeSnapshotHash -->

The batch pipeline keeps failure visible: a failed task is marked `'failed'` in its checkpoint with the reason recorded, and `aggregateTotals` continues to fold usage from the attempts that did succeed. Consecutive failures trip a circuit breaker so the run aborts instead of looping; diagnostic history stays bounded at `DIAGNOSTIC_MAX_ERRORS` entries and `DIAGNOSTIC_TEXT_CAP` characters per entry so the checkpoint payload does not blow up. When `attemptStage4Generation` exhausts its repair attempts, the page restore path is rejected rather than silently overwritten. `AnchorParseError` short-circuits anchor-driven logic instead of being swallowed, and the resulting JSON or human output still flows through `emit` so callers see a structured failure. The manifest step is fail-soft at the file level: `buildManifest` produces a fresh manifest payload, `computeSnapshotHash` fingerprints only the `livewiki/` tree (skipping `.manifest.json` itself so the write cannot self-loop), and `writeManifestIfChanged` skips the write when the new content matches the existing file, so a failing snapshot hash still does not corrupt prior state. The supplied excerpt does not establish exhaustive failure coverage of the batch resume or `--only` paths; behaviour beyond what is visible here is not asserted.

## Related pages
- [cli-src module](../cli-src.md)
- [commands module](../commands.md)
- [core-src-01 module](../core-src-01.md)
- [core-src-03 module](../core-src-03.md)
- [core-src-02 module](../core-src-02.md)
- [core-src-05 module](../core-src-05.md)
- [core-src-04 module](../core-src-04.md)
- [core-src-06 module](../core-src-06.md)
- [How it works](index.md)