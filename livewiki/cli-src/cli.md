---
title: Livewiki CLI Program Assembly and Context Resolution
owner: generated
anchors:
- packages/cli/src/cli.ts#createProgram
- packages/cli/src/cli.ts#readVersion
- packages/cli/src/cli.ts#resolveRepoRoot
- packages/cli/src/cli.ts#run
---

# Livewiki CLI Program Assembly and Context Resolution

This page documents how the `livewiki` command-line interface builds its command tree and resolves the repository root that downstream commands rely on.

## When to use this page

- Trace how the CLI turns a raw argument vector into a parsed, registered `commander` program.
- Learn where the CLI version string comes from and why it is read synchronously.
- Understand how `--repo` is turned into an absolute repository path for command contexts.
- See the full set of subcommands that the scaffold registers so `--help` shows the complete surface.

## How it fits

The `cli.ts` file is the top-level launcher of the `@livewiki/cli` package. It does not implement any domain logic itself; instead it constructs a `commander` program, attaches global options and a version, and delegates to per-command register functions living in `./commands/`. The same file also provides the small helpers that `run()` and the command registers use to read the package version and compute the repository root. Downstream command files import `resolveRepoRoot` to build the `CommandContext` they operate on.

## Diagram

```mermaid
%% livewiki/diagrams/cli-src-cli.mmd
```

## Version retrieval

<!-- lw:anchors packages/cli/src/cli.ts#readVersion -->

The CLI needs to report its own version in `--version` output and inside help text. Because the version is baked into the package manifest at build time and does not change during a process's lifetime, reading it synchronously avoids needless async plumbing in a path that is already asynchronous elsewhere.

```ts
function readVersion(): string {
```

The function takes no arguments and returns the version string. It constructs a `URL` from the current module's `import.meta.url`, then resolves `../package.json` relative to it — a path that works both in `src/` and in `dist/` because both directories sit at the same depth inside the package. It reads the file with `readFileSync`, parses it as JSON, and returns the `version` field. If the file is missing or the JSON is malformed, the `catch` branch returns the fallback `"0.0.0"`; the same fallback applies when the parsed object has no `version` property. This fail-open behavior ensures the CLI still starts even if the manifest is unavailable, though the reported version will not be meaningful.

## Program assembly

<!-- lw:anchors packages/cli/src/cli.ts#createProgram -->

The heart of this file is the factory that builds the entire `livewiki` command surface. Its purpose is twofold: expose a stable, discoverable interface and make `--help` reflect every command that the tooling supports, including stubs that later phases will flesh out.

```ts
export function createProgram(): Command {
```

The function takes no arguments and returns a configured `commander.Command`. It starts by creating a new `Command`, names it `livewiki`, provides a human-readable description, and attaches the version obtained from `readVersion()`. It then defines two global options shared by every subcommand: `--json` for parseable output and `--repo <path>` for pointing at the target repository, defaulting to `"."`. After that, it calls `registerInit`, `registerIndex`, `registerStatus`, `registerUpdate`, `registerVerify`, `registerServe`, `registerBatch`, `registerExport`, `registerView`, `registerPointer`, `registerInstall`, `registerConfig`, and `registerBaseline` in order — each of those functions attaches one subcommand to the program. Once all registers have run, the fully built program is returned.

## Program execution

<!-- lw:anchors packages/cli/src/cli.ts#run -->

The `run` function is the entry point that the package's binary invokes with the arguments passed on the command line. Its job is to turn that raw vector into an executed command, handling option parsing, subcommand dispatch, and any asynchronous work inside the selected command.

```ts
export async function run(argv: readonly string[]): Promise<void> {
```

The function takes a read-only array of strings (the arguments) and returns a promise that resolves once parsing and command execution finish. It builds a fresh program via `createProgram()` so each invocation starts from a clean state, then calls `parseAsync()` on it. Using the async variant matters because several registered commands perform file-system or network operations that return promises. When parsing succeeds, any errors thrown by a command propagate out of this function to the caller, which is responsible for reporting them.

## Repository root resolution

<!-- lw:anchors packages/cli/src/cli.ts#resolveRepoRoot -->

Commands that operate on a repository need a single, absolute path to that repository, regardless of whether the user supplied `--repo` or accepted the default. This helper normalizes that input so downstream code never has to reason about relative paths.

```ts
export function resolveRepoRoot(repoOpt: string | undefined): string {
```

The function takes an optional string (the value of the `--repo` option, if given) and returns the absolute repository path as a string. It calls `nodePath.resolve()` with the current working directory and the option value, defaulting to `"."` when `repoOpt` is undefined. This means the result is always an absolute path: a relative `--repo` value is anchored to the process's working directory, and the default resolves to that working directory itself. There is no validation of whether the resolved path exists or is a directory — that check is left to the commands that consume this value when they construct their `CommandContext`.

## Tests

Covered by `packages/cli/src/cli.test.ts` (same-name test file on disk).
Likely also exercised by `packages/cli/src/cli-batch-e2e-prose-tier.test.ts` (name-prefix match, not verified).
Likely also exercised by `packages/cli/src/cli-batch-e2e-subdirs.test.ts` (name-prefix match, not verified).
Likely also exercised by `packages/cli/src/cli-batch-e2e.test.ts` (name-prefix match, not verified).
Likely also exercised by `packages/cli/src/cli-batch-stage5-e2e.test.ts` (name-prefix match, not verified).
Likely also exercised by `packages/cli/src/cli-e2e.test.ts` (name-prefix match, not verified).
Likely also exercised by `packages/cli/src/cli-export-e2e.test.ts` (name-prefix match, not verified).
Likely also exercised by `packages/cli/src/cli-serve-e2e.test.ts` (name-prefix match, not verified).
Likely also exercised by `packages/cli/src/cli-view-e2e.test.ts` (name-prefix match, not verified).
