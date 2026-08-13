---
title: Indexing and ledger command
owner: generated
anchors:
  - packages/cli/src/commands/index-cmd.ts#collectIgnore
  - packages/cli/src/commands/index-cmd.ts#emit
  - packages/cli/src/commands/index-cmd.ts#formatLedgerHuman
  - packages/cli/src/commands/index-cmd.ts#registerIndex
---

# Indexing and ledger command

The index command reindexes a repository and synchronizes its anchor ledger while selecting human-readable, JSON, or quiet output.

## When to use this page

- **Run** `livewiki index` to refresh extracted symbols, hashes, and anchor debt for a repository.
- **Combine** configured ignore patterns with repeatable `--ignore` options for a narrower indexing walk.
- **Select** JSON output or quiet operation when integrating the command with automation.
- **Inspect** ledger changes and moved pairs from the command's human-readable report.

## How it fits

This module is the command-line adapter for the repository indexer and anchor-ledger services. It sits at `packages/cli/src/commands/index-cmd.ts` in the CLI command layer, translates Commander options into service inputs, and renders the results for a terminal or automation consumer. The excerpt does not establish the complete call graph beyond these direct service and configuration interactions.

## Diagram

```mermaid
%% livewiki/diagrams/commands-index-cmd.mmd
```

## Command registration and option preparation

<!-- lw:anchors packages/cli/src/commands/index-cmd.ts#registerIndex packages/cli/src/commands/index-cmd.ts#collectIgnore -->

`livewiki index` needs a single command surface that gathers the repository path, ignore patterns, and output preferences before invoking the indexing pipeline.

`export function registerIndex(program: Command): void {`

This function takes a Commander command tree and returns no value.

`registerIndex` registers the `index` command and its `--ignore`, `--no-ledger`, and `--quiet` options. The action resolves the repository from the current working directory and an optional `--repo` path, loads configuration, combines configured and command-line ignores, and then runs the indexer. The ledger runs afterward unless `--no-ledger` sets the derived `ledger` option to `false`.

`function collectIgnore(value: string, previous: string[]): string[] {`

This function takes one new ignore pattern and the patterns accumulated so far, and returns the combined list.

Commander invokes `collectIgnore` for each repeatable `--ignore` value. The function appends the new value to the previous array; the caller then concatenates the configured patterns with those accumulated from the command line. A malformed configuration is passed to `loadConfig`, whose error path the visible code records as a deliberate fail-closed behavior, and the command catches that error, writes a message to standard error, and sets `process.exitCode` to `1`.

## Indexing and ledger orchestration

The command's central purpose is to keep indexing and ledger synchronization in one incremental operation while respecting the selected output mode.

The action awaits the indexer with `extraIgnores` only when at least one configured or command-line ignore exists, and passes `quiet: json || quiet` to suppress human output in either automated mode. It then conditionally awaits the anchor ledger when `opts.ledger` is not `false`. Any error from configuration loading, indexing, or ledger processing is written as `livewiki index: error — …` to standard error, after which the process is marked with a nonzero exit code.

## Output selection

<!-- lw:anchors packages/cli/src/commands/index-cmd.ts#emit -->

Once both stages finish, the command needs one deterministic rendering path for human and machine consumers.

```ts
function emit(
  json: boolean,
  quiet: boolean,
  indexResult: IndexResult,
  ledgerResult: LedgerResult | null,
): void
```

This function takes JSON and quiet flags plus index and optional ledger results, and returns no value.

`emit` first returns without writing to standard output when quiet mode is active without JSON. For JSON mode it writes an object containing `index` and `ledger`; for normal human output it writes the indexer's human formatter, then adds a ledger report when a ledger result exists. The source does not show a separate error branch inside `emit`; errors are handled by the surrounding command action.

## Ledger human-readable formatting

<!-- lw:anchors packages/cli/src/commands/index-cmd.ts#formatLedgerHuman -->

The ledger report needs a compact terminal summary that makes changed, moved, deleted, and undocumented symbols visible without requiring consumers to parse JSON.

`function formatLedgerHuman(r: LedgerResult): string {`

This function takes a ledger result and returns a newline-joined human-readable report.

`formatLedgerHuman` always begins with a successful ledger status and reports processed pages, skipped pages, upserted anchors, event counts for changed, moved, and deleted anchors, and undocumented symbols. When `r.movedPairs.length > 0`, it appends a `moved pairs:` section and one indented `from → to` line per pair.