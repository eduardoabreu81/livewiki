---
title: CLI command surface to core pipeline wiring
owner: generated
anchors:
  - packages/cli/src/cli.ts#createProgram
  - packages/cli/src/cli.ts#readVersion
  - packages/cli/src/cli.ts#resolveRepoRoot
  - packages/cli/src/cli.ts#run
  - packages/cli/src/output.ts#emitHuman
  - packages/cli/src/commands/batch.ts#registerBatch
  - packages/cli/src/output.ts#emitJson
  - packages/cli/src/commands/export.ts#registerExport
  - packages/cli/src/commands/index-cmd.ts#registerIndex
  - packages/cli/src/output.ts#emit
  - packages/core/src/db.ts#CURRENT_SCHEMA_VERSION
  - packages/core/src/batch-status.ts#buildStatusReport
  - packages/core/src/batch-status.ts#listRuns
updated: 2026-08-04
modules:
  - cli-src
  - commands
  - core-src-01
  - core-src-03
  - core-src-04
  - core-src-05
  - core-src-10
  - core-src-02
---

# CLI command surface to core pipeline wiring

This page explains how a user invocation on the livewiki CLI reaches the core batch, init, indexing, and orchestration subsystems and surfaces the results through the unified output formatter.

## Purpose
<!-- lw:anchors packages/cli/src/cli.ts#createProgram packages/cli/src/cli.ts#readVersion packages/cli/src/cli.ts#resolveRepoRoot packages/cli/src/cli.ts#run -->

The flow begins when the user runs the `livewiki` binary — `packages/cli/src/index.ts` forwards `process.argv` into the CLI driver. `run` then constructs the Commander program, registers every subcommand, and resolves the repository root before dispatching to the chosen handler. `createProgram` owns the Commander tree and the global flags (`--json`, `--repo`), `readVersion` synchronously reads the `@livewiki/cli` package metadata, and `resolveRepoRoot` turns the optional `--repo` flag into an absolute path anchored at `process.cwd()`. The signature for the entry driver and the helpers, copied byte-for-byte from the symbol table, are:

```ts
export async function run(argv: readonly string[]): Promise<void>
export function createProgram(): Command
function readVersion(): string
export function resolveRepoRoot(repoOpt: string | undefined): string
```

Together these four entry-side helpers produce a `CommandContext` — JSON-or-human mode, repo path, version — that every subcommand inherits. The output of this stage is a fully configured `Command` with global options normalized and a target repo resolved to a canonical absolute path.

## Ordered flow
<!-- lw:anchors packages/cli/src/output.ts#emitHuman packages/cli/src/commands/batch.ts#registerBatch packages/cli/src/output.ts#emitJson packages/cli/src/commands/export.ts#registerExport packages/cli/src/commands/index-cmd.ts#registerIndex packages/cli/src/output.ts#emit -->

1. `run(argv)` parses argv, constructs the Commander program with `createProgram`, and registers every subcommand handler — `registerBatch`, `registerExport`, `registerIndex`, plus the other phase commands — by calling them in turn against the `Command` tree.
2. The matching command's action resolves the repo root via `resolveRepoRoot`, derives `--json` mode from the inherited global flags, and builds a `CommandContext`.
3. The handler calls `loadConfig(repoRoot)` to read `.livewiki/config.json`, then `applyDefaults` to backfill provider, language, and ignore defaults so callers never see an undefined provider, and finally `resolveBaseUrl` to derive the host URL used by the publish path.
4. For `init`, the handler calls `buildPlan` (deterministic, no LLM, no writes when `--plan` is set) and, in the full path, generates `structure.mmd`, `modules.mmd`, per-module `classes.mmd`, the manifest, and `regenerateArchitectureOverview`.
5. For `index`, the handler chains the core indexer with the anchor ledger; the ledger re-extracts anchors from the wiki with `extractAnchors` and `slugify`, marks section anchors against their preceding heading, and flags manual blocks so verify can distinguish protected zones from generated prose.
6. For `batch`, the handler forwards to `runBatch` / `resumeBatch` / `runOnly`; during stage 4 the mechanical repairer `repairStage4ArtifactMechanically` applies the closed set of deterministic fixes (escape unmatched inline delimiters, append missing section anchors, fill empty anchored sections, remove duplicate section anchors, strip invented manual markers, sync upper-bound frontmatter anchors) and re-validates before returning. Anything outside that closed set fails closed and returns `null`.
7. Stage 5 builds the cross-module semantic product-flow layer: `detectFlowCandidates` runs over the index facts (modules, edges, key groups, signals), `assignFlowKeySections` tags every candidate key with the section that documents it, and the orchestrator emits a deterministic Mermaid flowchart from those facts.
8. The topic planner runs `buildTopicPlanningInventory` against the closed evidence set and `assignTopicKeySections` distributes keys across the four closed topic groups (`contract`, `state`, `output`, `failure`).
9. The handler produces its final report through `emit(json, data, human)`; `emit` dispatches to `emitJson` (one line, JSON, newline-terminated) or `emitHuman` (multi-line text, newline-terminated). The handler then sets `process.exitCode` and lets the event loop drain rather than calling `process.exit`. The signatures copied byte-for-byte from the symbol table:

```ts
export function emitHuman(text: string): void
export function emitJson(data: unknown): void
export function emit(json: boolean, data: unknown, human: string): void
export function registerBatch(program: Command): void
export function registerExport(program: Command): void
export function registerIndex(program: Command): void
```

## Diagram

```mermaid
%% livewiki/diagrams/flow-cli-src-to-core-src-02.mmd
```

## Invariants

- The CLI is the single sink for stdout — every byte of user-visible output goes through `emit`, `emitJson`, or `emitHuman`. Handlers never write directly to `process.stdout`.
- Handlers set `process.exitCode` instead of calling `process.exit`; the event loop drains pending I/O before Node exits.
- `resolveRepoRoot` always produces an absolute path anchored at `process.cwd()`; relative `--repo` values are resolved relative to the current working directory only.
- `applyDefaults` backfills provider, language, and ignore defaults so downstream code never observes an undefined config field; credentials never enter the file — API keys stay in `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`.
- The anchor extractor flags any anchor that falls inside a manual block via the derived `inManualBlock` marker; `verify` uses that flag to distinguish anchor invalidation from manual-block protection.
- `repairStage4ArtifactMechanically` operates only on the closed set of `MECHANICAL_STAGE4_CODES`; failures outside that set fail closed (returns `null`) and the validator surfaces the underlying `ArtifactValidationError` codes.
- `detectFlowCandidates` is a pure function — no disk I/O, no DB access, no LLM, and deterministic under input reordering (shuffled modules/edges and remapped insert orders produce byte-identical output).
- The CLI and core agree on which edge exists: the import resolver produces a single `ResolvedImportEdge` shape consumed by both the module graph and the flow detector, so the two cannot disagree about where an import resolved.

## Failure and recovery
<!-- lw:anchors packages/core/src/db.ts#CURRENT_SCHEMA_VERSION packages/core/src/batch-status.ts#buildStatusReport packages/core/src/batch-status.ts#listRuns -->

The CLI entry catches thrown errors inside each command action and converts them into a stable JSON envelope, setting `process.exitCode` (never `process.exit`) so the event loop drains before exit. The package surfaces its current persistence shape through `CURRENT_SCHEMA_VERSION`:

```ts
export const CURRENT_SCHEMA_VERSION = 8
```

Older `.livewiki/index.db` files are migrated up to the current shape by the migration ladder in `db.ts`; because the database is a derived cache (rule #3), deleting `.livewiki/` is non-destructive and the next `livewiki index` rebuilds it from disk. The CLI does not surface schema-version mismatches as fatal errors — it surfaces them as status output, leaving recovery in the user's hands (rerun index, or remove `.livewiki/` to start clean).

Batch orchestration persists checkpoints through `batch_runs` and `batch_tasks` so partial runs survive interruption; `livewiki batch status [<runId>]` aggregates them through `buildStatusReport`, and `livewiki batch list` enumerates the persisted runs through `listRuns`. The signatures copied byte-for-byte from the symbol table:

```ts
export async function buildStatusReport(
export async function listRuns(repoRoot: string): Promise<Array<{
```

When a task fails, the orchestrator marks it `failed` with a reason in the checkpoint and continues; a circuit breaker trips after 3 consecutive failures or when more than 50% of tasks fail, marking the run `completed_with_failures` (or `aborted`) and setting a non-zero exit code. The status report surfaces the failed task list with a ready-to-paste retry command, and `batch resume <runId>` re-runs only the pending or failed tasks against the persisted checkpoints. The supplied source does not show a CLI-level retry of the synchronous helpers `readVersion` / `resolveRepoRoot`; those either succeed synchronously or surface as immediate throws that the action handler converts into the JSON error envelope.

## Related pages

- [cli-src](../cli-src.md)
- [commands](../commands.md)
- [core-src-01](../core-src-01.md)
- [core-src-03](../core-src-03.md)
- [core-src-04](../core-src-04.md)
- [core-src-05](../core-src-05.md)
- [core-src-10](../core-src-10.md)
- [core-src-02](../core-src-02.md)
- [How it works](index.md)