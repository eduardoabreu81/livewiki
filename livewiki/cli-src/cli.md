---
title: Command-line entry point for the livewiki CLI
owner: generated
anchors:
  - packages/cli/src/cli.ts#createProgram
  - packages/cli/src/cli.ts#readVersion
  - packages/cli/src/cli.ts#resolveRepoRoot
  - packages/cli/src/cli.ts#run
---

# Command-line entry point for the livewiki CLI

This page documents the module that boots the `livewiki` command, wires up Commander, and dispatches every subcommand the tool exposes.

## When to use this page

- **Add or rename a subcommand** of the `livewiki` CLI by editing the `createProgram` registration block.
- **Trace how a global flag like `--repo` is resolved** into a concrete repository path before a command runs.
- **Understand how the published version string is read** when a user runs `livewiki --version`.
- **Follow the boot path** from `run(argv)` into the Commander argument parser and into the registered command handlers.

## How it fits

The `packages/cli/src/cli.ts` module is the front door of the `@livewiki/cli` package. It depends on `commander` for argument parsing and on `node:path` / `node:fs` for filesystem helpers, and it pulls in a `register*` function for every subcommand the CLI exposes (init, index, status, update, verify, serve, batch, export, view, pointer, install). Each `register*` is responsible for attaching its own subcommand and handler to the `Command` instance — those handlers live in sibling files under `packages/cli/src/commands/`. This module's job is narrow: build the program, read its version, resolve the target repository, and run the parser. The actual command logic lives elsewhere.

A note on the orchestrator's own terminology: "lw:anchors" and "lw:manual" below are page-generation markers that this page emits so the livewiki tooling can rewrite it; they are not part of the runtime CLI.

## Diagram

```mermaid
%% livewiki/diagrams/cli-src-cli.mmd
```

## Version resolution

<!-- lw:anchors packages/cli/src/cli.ts#readVersion -->

The CLI needs to answer `livewiki --version` with the version string baked into this package's `package.json`. Because the package is published both as source (`src/cli.ts`) and as a built bundle (`dist/cli.js`), the resolver must locate `package.json` relative to the current module URL rather than a hard-coded path.

```ts
function readVersion(): string {
```

`readVersion` takes no arguments and returns the version string. It starts from `import.meta.url`, constructs a `file://` URL pointing at `../package.json` relative to the current module, synchronously reads and JSON-parses it, and returns `parsed.version`. If the file cannot be read or parsed, or if the parsed object has no `version` field, the function falls back to the literal string `"0.0.0"`. The rationale comment explains why the read is synchronous: the package.json is static at build time and the caller (`run`) is already async, so a synchronous read keeps the boot path simple. The visible evidence establishes a try/catch fallback to `"0.0.0"`; it does not establish any guarantee about what happens when the file is malformed beyond that fallback.

## Program assembly

<!-- lw:anchors packages/cli/src/cli.ts#createProgram -->

A Commander program is the data structure the rest of the CLI hangs off. Every subcommand, every global flag, and the version banner are attached to a single `Command` instance, which is then handed to the parser.

```ts
export function createProgram(): Command {
```

`createProgram` takes no arguments and returns a fully configured `Command`. It instantiates Commander, sets the binary name to `"livewiki"`, attaches a project description that points users at `VISION.md` and `SPEC.md`, and calls `.version(readVersion())` so `--version` reports the package version. It then registers two global flags — `--json` for machine-readable output and `--repo <path>` (default `"."`) for the target repository — and finally calls each of the eleven `register*` helpers to attach a subcommand. The function returns the assembled `Command` so the caller can drive parsing. The comment block over the registrations notes that the surface mirrors the `SPEC.md` "CLI commands" section and is registered from the scaffold so `--help` always shows the complete picture.

## Boot path

<!-- lw:anchors packages/cli/src/cli.ts#run -->

The actual entry point is `run`: it builds the program and lets Commander parse the arguments. There is no custom error handling here — Commander's own parser does the validation and reporting.

```ts
export async function run(argv: readonly string[]): Promise<void> {
```

`run` takes the raw argument vector (typically `process.argv`) and returns a `Promise<void>` that resolves once parsing completes. It calls `createProgram()`, then awaits `program.parseAsync(argv as string[])`. The `as string[]` cast is necessary because Commander's `parseAsync` accepts `string[]` while this signature uses `readonly string[]` to discourage in-place mutation by callers. Errors thrown by individual subcommands are not visibly caught in this module; the orchestrator above `run` is responsible for any process-level error handling.

## Repository root resolution

<!-- lw:anchors packages/cli/src/cli.ts#resolveRepoRoot -->

The `--repo` flag accepts either a relative or an absolute path, and the rest of the CLI wants a single absolute path it can pass into a `CommandContext`. This helper is the boundary that turns the user's input into that canonical form.

```ts
export function resolveRepoRoot(repoOpt: string | undefined): string {
```

`resolveRepoRoot` takes the value of `--repo` (which may be `undefined` when the user did not pass the flag) and returns an absolute path as a string. It calls `nodePath.resolve(process.cwd(), repoOpt ?? ".")`. When `repoOpt` is `undefined`, it defaults to `"."`, which means `resolveRepoRoot()` with no flag returns the current working directory. Because `nodePath.resolve` treats its second argument as relative to the first when the second is not absolute, both relative paths like `"../other-repo"` and absolute paths like `"/var/www/livewiki"` are accepted. The visible source establishes the `undefined` → `"."` fallback and the resolution against `process.cwd()`; it does not establish any further validation, normalization, or existence check on the resolved path — callers rely on Node's filesystem APIs to surface missing directories.

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
