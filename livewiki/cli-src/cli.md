---
title: livewiki CLI entry: program assembly and invocation
owner: generated
anchors:
- packages/cli/src/cli.ts#createProgram
- packages/cli/src/cli.ts#readVersion
- packages/cli/src/cli.ts#resolveRepoRoot
- packages/cli/src/cli.ts#run
---

# livewiki CLI entry: program assembly and invocation

This page documents the `cli.ts` module's role as the CLI process's assembly and dispatch point, where the `commander` program is built, configured, and executed.

## When to use this page

- **Trace how the `livewiki` command starts** — from `run(argv)` down through program parsing and dispatch.
- **Understand how global flags (`--json`, `--repo`) are wired** and how the bare-invocation onboarding flow decides between help, hint, or config wizard.
- **See how the version string is resolved** from the package manifest and how `repoRoot` is derived from the `--repo` option.
- **Learn which subcommands exist** and how they are registered into the program surface.

## How it fits

This module is the top-level entry for the `livewiki` CLI package. It imports all command registration functions from sibling `commands/*` modules, sets up global options, and defines the behavior for a bare invocation (no subcommand). It also exports two small helpers — `readVersion()` and `resolveRepoRoot()` — that other parts of the CLI use for version reporting and repository path resolution. The module's `run` function is the actual process entry point that the package's bin script calls.

## Diagram

```mermaid
%% livewiki/diagrams/cli-src-cli.mmd
```

## Program assembly

<!-- lw:anchors packages/cli/src/cli.ts#createProgram packages/cli/src/cli.ts#readVersion packages/cli/src/cli.ts#resolveRepoRoot -->

`createProgram()` constructs the full `commander` `Command` object that defines the `livewiki` CLI surface. It sets the program name to `livewiki`, attaches a human-readable description pointing readers to the project's VISION.md and SPEC.md, and calls `version(readVersion())` so that `--version` prints the package version from the manifest.

`readVersion()` is a synchronous helper that reads `@livewiki/cli`'s `package.json` relative to the current module's URL, parses it as JSON, and returns the `version` field — or falls back to the string `"0.0.0"` if the file is missing, unparseable, or lacks the field. The fallback is a fail-open branch: any `readFileSync` or `JSON.parse` error returns the default version instead of throwing. The function computes the manifest path via `new URL("../package.json", import.meta.url)`, which stays correct for both source (`src/cli.ts`) and built (`dist/cli.js`) layouts because both sit at the same depth inside the package.

After configuring global flags — `--json` for parseable output and `--repo <path>` for the target repository, defaulting to `.` — the function registers every subcommand by calling each `register*` function from the `commands` directory: `init`, `index`, `status`, `update`, `verify`, `serve`, `batch`, `export`, `view`, `pointer`, `install`, `config`, and `baseline`. This registration makes all commands visible in `--help` output even when their implementations are still stubs.

Finally, `createProgram()` attaches an action handler for a bare invocation (no subcommand). That handler reads the global options, resolves the repository root via `resolveRepoRoot()`, checks whether the repo is configured via `isConfigured()`, and then calls `decideBareInvocation()` to pick one of three outcomes: display help, print a one-line hint (when there's no TTY or `--json` is active), or run the interactive config wizard via `runConfigFlow()`. The wizard path also resolves the livewiki home directory from the environment using `resolveLivewikiHome(process.env)`.

`resolveRepoRoot(repoOpt)` is a small pure helper: it takes the `--repo` option value (or `undefined` when the default `.` was applied at the commander level) and returns an absolute path by resolving it against `process.cwd()` using `node:path.resolve`. This gives all commands a canonical absolute repository root for building the `CommandContext`.

## Invocation flow

<!-- lw:anchors packages/cli/src/cli.ts#run -->

`run(argv)` is the exported async entry point that the CLI binary calls with the process arguments. It creates the program via `createProgram()`, then awaits `program.parseAsync(argv as string[])` to parse the arguments and dispatch to the matching subcommand or the bare-invocation action. Because `parseAsync` is async, any registered command handlers that return promises are awaited before `run` resolves, ensuring the process exits only after command work completes. The function casts the `argv` array to the type `commander` expects; the cast is purely for TypeScript type-compatibility with `commander`'s signature and does not alter the array contents.

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
