---
title: livewiki update command
owner: generated
anchors:
  - packages/cli/src/commands/update.ts#formatHuman
  - packages/cli/src/commands/update.ts#registerUpdate
---

# livewiki update command

The `livewiki update` command records incremental documentation work and emits a focused package for the next update.

## When to use this page

- **Run** `livewiki update` to calculate documentation changes since the last documented commit.
- **Configure** the snippet window passed to the work-package loader.
- **Record** an estimated token count after documentation has been written back.
- **Learn** how the command emits human-readable or JSON output.

## How it fits

`packages/cli/src/commands/update.ts` registers the `update` subcommand on the Commander CLI. It coordinates the root resolver, output emitter, status runner, and incremental-update services provided by `@livewiki/core/update`.

The default flow calls `loadWorkPackage` to gather debt, snippets, valid anchors, and impact data. Separate option branches record documentation written back or indicate that `--llm` requires the batch workflow; neither branch emits the default work package.

## Diagram

```mermaid
%% livewiki/diagrams/commands-update.mmd
```

## Registering and routing the command

<!-- lw:anchors packages/cli/src/commands/update.ts#registerUpdate -->

`registerUpdate` attaches the incremental documentation command and its action to the existing CLI program.

```ts
export function registerUpdate(program: Command): void
```

This function takes the root Commander program and returns no value; it modifies the program by adding the `update` subcommand and its options.

The action resolves `repoRoot` from the current working directory and `resolveRepoRoot`. It then selects one of three visible paths:

1. `--record-write <tokens>` parses a decimal integer and rejects a negative or non-numeric value by writing an error to stderr, setting exit code `1`, and returning without producing a work package.
2. `--llm` writes a message directing the user to the batch workflow, sets exit code `1`, and returns without calling the configured API from this command.
3. The default path parses `--snippet-window <lines>` or uses `20`, then passes only a positive finite value as `snippetWindow` to `loadWorkPackage`.

The normal path builds a summary containing the package and a saved ratio. That ratio is calculated against a fixed estimate of `12,500` tokens for rereading a medium source repository and is bounded below at `0`; it is not clamped to an upper bound. `emit` receives either this object for JSON output or `formatHuman(pkg)` for terminal output.

The action is wrapped in `try`/`catch`. A caught error writes its message to stderr, sets `process.exitCode = 1`, and returns; the command does not force immediate process termination on that path.

## Formatting the work package

<!-- lw:anchors packages/cli/src/commands/update.ts#formatHuman -->

`formatHuman` turns the resolved incremental-update package into a bounded terminal report.

```ts
export function formatHuman(pkg: Awaited<ReturnType<typeof loadWorkPackage>>): string
```

This function takes the package produced by `loadWorkPackage` and returns a multiline string describing its manifest, debt, snippets, anchors, and impact.

The formatter first reports the last documented commit when the manifest exists and explains that initialization is needed when it is absent. It displays at most the first five debt entries, followed by one count for additional entries when the debt exceeds five.

The impact section reports change impact only when the package is for a Git repository. Otherwise, it prints `impact: unavailable (not a git repository)`. For Git repositories, it shows counts of changed symbols, affected pages, and importers, plus a truncation notice when the impact data was truncated.

Finally, the formatter reports the package’s estimated token and byte counts and compares the package size with the same fixed `12,500`-token full-read estimate used in the command action.